import { ApiRequestError } from '../http';
import type { PipelineRun, PipelineStatus } from '../types';
import { getDataset } from './dataset';
import { getScenario } from './scenario';
import { publish } from './warehouse';

/**
 * An in-memory pipeline run, settled on read rather than by a timer.
 *
 * Deriving the run's state from elapsed time means there is no background timer
 * to leak, the UI's polling loop is exercised exactly as it will be against the
 * real API, and a test can drive the whole lifecycle by controlling the clock.
 */

const RUN_DURATION_MS = 7_000;

let currentRun: PipelineRun | undefined;
let lastSuccessfulRun: PipelineRun | undefined;
let runCounter = 0;

function runId(): string {
  runCounter += 1;
  const suffix = String(runCounter).padStart(12, '0');
  return `1f0c2c1e-2a4b-4b8e-9c1a-${suffix}`;
}

function rowCounts(): PipelineRun['rowCounts'] {
  const dataset = getDataset();
  const orderItems = dataset.orders.reduce((sum, order) => sum + order.items.length, 0);

  return {
    customers: dataset.customers.length,
    products: dataset.products.length,
    orders: dataset.orders.length,
    orderItems,
    factSales: orderItems,
  };
}

/** Settle a run whose simulated duration has elapsed. */
function reconcile(now: number): void {
  if (!currentRun || currentRun.status !== 'running') return;

  const startedAt = new Date(currentRun.startedAt).getTime();
  const elapsed = now - startedAt;
  if (elapsed < RUN_DURATION_MS) return;

  const completedAt = new Date(startedAt + RUN_DURATION_MS).toISOString();
  const durationSeconds = RUN_DURATION_MS / 1000;

  if (getScenario() === 'pipeline-failure') {
    currentRun = {
      ...currentRun,
      status: 'failed',
      completedAt,
      durationSeconds,
      errorSummary:
        'Data quality check failed: 12 fact_sales rows have no matching dim_product key. The warehouse was not replaced.',
    };
    return;
  }

  // The warehouse is only replaced once the run succeeds, which is what makes
  // the dashboard change at this moment and not before.
  publish(completedAt);

  currentRun = {
    ...currentRun,
    status: 'succeeded',
    completedAt,
    durationSeconds,
    rowCounts: rowCounts(),
    errorSummary: null,
  };
  lastSuccessfulRun = currentRun;
}

export function getPipelineStatus(now: number = Date.now()): PipelineStatus {
  reconcile(now);

  return {
    current: currentRun ?? null,
    lastSuccessful: lastSuccessfulRun ?? null,
  };
}

/** `409` while a run is active, matching the documented single-run rule. */
export function startPipelineRun(now: number = Date.now()): PipelineRun {
  reconcile(now);

  if (currentRun?.status === 'running') {
    throw new ApiRequestError(409, 'conflict', 'A pipeline run is already in progress.');
  }

  const startedAt = new Date(now).toISOString();
  currentRun = {
    runId: runId(),
    status: 'running',
    startedAt,
    completedAt: null,
    durationSeconds: null,
    lakePrefix: `raw/run_date=${startedAt.slice(0, 10)}/run_id=${runId()}/`,
    rowCounts: {},
    errorSummary: null,
  };

  return currentRun;
}

/**
 * Seed a completed run so the `ready` scenario does not claim the warehouse
 * appeared without one. Timestamped in the past so it reads as history.
 */
export function seedSucceededRun(publishedAt: string): void {
  if (lastSuccessfulRun) return;

  const completed = new Date(publishedAt).getTime();
  const run: PipelineRun = {
    runId: runId(),
    status: 'succeeded',
    startedAt: new Date(completed - RUN_DURATION_MS).toISOString(),
    completedAt: new Date(completed).toISOString(),
    durationSeconds: RUN_DURATION_MS / 1000,
    lakePrefix: `raw/run_date=${publishedAt.slice(0, 10)}/run_id=${runId()}/`,
    rowCounts: rowCounts(),
    errorSummary: null,
  };

  currentRun = run;
  lastSuccessfulRun = run;
}

/** Test seam. */
export function resetPipeline(): void {
  currentRun = undefined;
  lastSuccessfulRun = undefined;
  runCounter = 0;
}
