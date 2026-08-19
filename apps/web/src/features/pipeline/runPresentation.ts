import type { BadgeTone } from '../../components/ui/Badge';
import type { PipelineRowCounts, PipelineRunStatus } from '../../api/types';

/** How a run's status and row counts are written, in one place. */

interface RunPresentation {
  readonly label: string;
  readonly tone: BadgeTone;
}

const RUN_STATUS: Readonly<Record<PipelineRunStatus, RunPresentation>> = {
  // The API does not execute the pipeline itself — it enqueues the run for the
  // ETL worker, which usually claims it within a couple of seconds. `queued` and
  // `running` are both "in flight" from here, so they share brand-toned pulsing
  // treatment; only the label tells them apart.
  queued: { label: 'Queued', tone: 'brand' },
  running: { label: 'Running', tone: 'brand' },
  succeeded: { label: 'Succeeded', tone: 'positive' },
  failed: { label: 'Failed', tone: 'critical' },
};

export function runStatusLabel(status: PipelineRunStatus): string {
  return RUN_STATUS[status].label;
}

export function runStatusTone(status: PipelineRunStatus): BadgeTone {
  return RUN_STATUS[status].tone;
}

/**
 * Row-count labels in pipeline order, extract first.
 *
 * Every key is optional in the contract, so this drives rendering: a count the
 * API did not send is left out rather than shown as zero, which would claim the
 * run moved no rows.
 */
export const ROW_COUNT_FIELDS: ReadonlyArray<{
  readonly key: keyof PipelineRowCounts;
  readonly label: string;
  readonly hint: string;
}> = [
  { key: 'customers', label: 'Customers', hint: 'Extracted from PostgreSQL' },
  { key: 'products', label: 'Products', hint: 'Extracted from PostgreSQL' },
  { key: 'orders', label: 'Orders', hint: 'Extracted from PostgreSQL' },
  { key: 'orderItems', label: 'Order items', hint: 'Extracted from PostgreSQL' },
  { key: 'factSales', label: 'fact_sales', hint: 'Loaded into the warehouse' },
];
