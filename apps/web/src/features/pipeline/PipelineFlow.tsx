import { Check, Database, HardDrive, LoaderCircle, X } from 'lucide-react';
import type { PipelineRunStatus } from '../../api/types';
import { cx } from '../../lib/cx';

/**
 * The three boundaries a run moves data across.
 *
 * The contract reports one status for the whole run, not per stage, so this shows
 * the run's state across all three rather than inventing per-stage progress it
 * cannot know. The labels themselves are the point: PostgreSQL is operational,
 * MinIO holds the immutable raw extract, DuckDB serves analytics.
 */

const STAGES = [
  { label: 'PostgreSQL', caption: 'Operational extract', icon: Database },
  { label: 'MinIO', caption: 'Raw Parquet lake', icon: HardDrive },
  { label: 'DuckDB', caption: 'Star-schema warehouse', icon: Database },
] as const;

export interface PipelineFlowProps {
  /** `undefined` when no run has ever happened. */
  status: PipelineRunStatus | undefined;
}

export function PipelineFlow({ status }: PipelineFlowProps) {
  const succeeded = status === 'succeeded';
  const running = status === 'running';
  const failed = status === 'failed';

  return (
    <ol className="flex items-start justify-between gap-2">
      {STAGES.map((stage, index) => (
        <li key={stage.label} className="flex flex-1 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-center text-center">
            <span
              className={cx(
                'flex size-12 items-center justify-center rounded-full border',
                succeeded && 'border-positive-line bg-positive-surface',
                running && 'border-brand-line bg-brand-surface',
                failed && 'border-critical-line bg-critical-surface',
                !status && 'border-dashed border-line-strong bg-surface-sunken',
              )}
            >
              <stage.icon
                aria-hidden
                className={cx(
                  'size-5',
                  succeeded && 'text-positive',
                  running && 'text-brand',
                  failed && 'text-critical',
                  !status && 'text-ink-faint',
                )}
                strokeWidth={1.75}
              />
            </span>

            <span className="mt-2 text-sm font-medium text-ink">{stage.label}</span>
            <span className="text-xs text-ink-faint">{stage.caption}</span>
          </div>

          {index < STAGES.length - 1 ? <Connector status={status} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Connector({ status }: { status: PipelineRunStatus | undefined }) {
  return (
    <span aria-hidden className="mt-6 flex flex-1 items-center gap-1.5">
      <Rule status={status} />
      <span
        className={cx(
          'flex size-5 shrink-0 items-center justify-center rounded-full border',
          status === 'succeeded' && 'border-positive-line bg-positive-surface text-positive',
          status === 'running' && 'border-brand-line bg-brand-surface text-brand',
          status === 'failed' && 'border-critical-line bg-critical-surface text-critical',
          !status && 'border-line bg-surface text-ink-faint',
        )}
      >
        {status === 'succeeded' ? (
          <Check className="size-3" strokeWidth={3} />
        ) : status === 'running' ? (
          <LoaderCircle className="size-3 animate-spin" strokeWidth={3} />
        ) : status === 'failed' ? (
          <X className="size-3" strokeWidth={3} />
        ) : null}
      </span>
      <Rule status={status} />
    </span>
  );
}

function Rule({ status }: { status: PipelineRunStatus | undefined }) {
  return (
    <span
      className={cx(
        'h-px flex-1',
        status === 'succeeded' && 'bg-positive-line',
        status === 'running' && 'bg-brand-line',
        status === 'failed' && 'bg-critical-line',
        !status && 'bg-line',
      )}
    />
  );
}
