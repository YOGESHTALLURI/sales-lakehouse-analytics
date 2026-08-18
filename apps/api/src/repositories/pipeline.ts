import type { Pool } from 'pg';
import { ApiError } from '../http/errors.js';

/**
 * Pipeline run control and audit.
 *
 * This reads and writes PostgreSQL, which is correct and not a boundary
 * violation: `pipeline_runs` is operational state about the platform, not
 * analytics. It also has to survive the warehouse file being replaced on every
 * publish, and it must be able to report a *failed* run — which a
 * warehouse-resident record could never do, since a failed run publishes nothing.
 */

export type PipelineRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface PipelineRun {
  runId: string;
  status: PipelineRunStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  lakePrefix: string | null;
  rowCounts: Record<string, number>;
  errorSummary: string | null;
}

export interface PipelineStatus {
  current: PipelineRun | null;
  lastSuccessful: PipelineRun | null;
}

interface RawRun {
  id: string;
  status: PipelineRunStatus;
  started_at: Date;
  completed_at: Date | null;
  duration_seconds: string | null;
  lake_prefix: string | null;
  row_counts: Record<string, number> | null;
  error_summary: string | null;
}

// duration is computed in SQL so a caller never has to subtract two timestamps
// and risk disagreeing with another caller about the same run.
const RUN_COLUMNS = `id::text as id,
        status,
        started_at,
        completed_at,
        extract(epoch from (completed_at - started_at)) as duration_seconds,
        lake_prefix,
        row_counts,
        error_summary`;

function mapRun(row: RawRun): PipelineRun {
  return {
    runId: row.id,
    status: row.status,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
    durationSeconds:
      row.duration_seconds === null
        ? null
        : Math.round(Number.parseFloat(row.duration_seconds) * 10) / 10,
    lakePrefix: row.lake_prefix,
    rowCounts: row.row_counts ?? {},
    errorSummary: row.error_summary,
  };
}

const ACTIVE_STATUSES = "('queued', 'running')";

/**
 * Accept a run by enqueueing it for the ETL worker.
 *
 * The API deliberately does not execute the pipeline. Running it in-process would
 * put Python in the Node container and block a request thread for the duration;
 * starting a container would require the Docker socket, handing an
 * internet-facing service root-equivalent control of the host. Enqueueing keeps
 * the work in the ETL container where it belongs, and `pipeline_runs` serves as
 * both queue and audit trail.
 */
export async function enqueueRun(pool: Pool): Promise<PipelineRun> {
  try {
    const result = await pool.query<RawRun>(
      `insert into pipeline_runs (status)
       values ('queued')
       returning ${RUN_COLUMNS}`,
    );

    return mapRun(result.rows[0]!);
  } catch (error) {
    // A partial unique index permits one queued-or-running row, so a concurrent
    // second request loses this race at the database rather than by an
    // application check two API replicas could both pass.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { constraint?: string }).constraint === 'pipeline_runs_single_active_run'
    ) {
      throw ApiError.conflict(
        'conflict',
        'A pipeline run is already queued or running. Wait for it to finish.',
      );
    }
    throw error;
  }
}

export async function getStatus(pool: Pool): Promise<PipelineStatus> {
  const [current, lastSuccessful] = await Promise.all([
    pool.query<RawRun>(
      `select ${RUN_COLUMNS} from pipeline_runs order by started_at desc limit 1`,
    ),
    pool.query<RawRun>(
      `select ${RUN_COLUMNS}
         from pipeline_runs
        where status = 'succeeded'
        order by completed_at desc nulls last
        limit 1`,
    ),
  ]);

  return {
    current: current.rows[0] ? mapRun(current.rows[0]) : null,
    lastSuccessful: lastSuccessful.rows[0] ? mapRun(lastSuccessful.rows[0]) : null,
  };
}

export async function findRun(pool: Pool, runId: string): Promise<PipelineRun | undefined> {
  const result = await pool.query<RawRun>(
    `select ${RUN_COLUMNS} from pipeline_runs where id = $1`,
    [runId],
  );

  const row = result.rows[0];
  return row ? mapRun(row) : undefined;
}

/** True while a run is queued or executing, so the UI can disable its button. */
export async function hasActiveRun(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ active: string }>(
    `select count(*)::text as active from pipeline_runs where status in ${ACTIVE_STATUSES}`,
  );

  return Number.parseInt(result.rows[0]!.active, 10) > 0;
}
