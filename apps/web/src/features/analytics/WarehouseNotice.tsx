import { Database, Play } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { usePipeline } from '../pipeline/PipelineProvider';

/**
 * The one full explanation of `warehouseReady: false`, with the action that
 * resolves it.
 *
 * This is the state a fresh clone opens on, so it is written as an instruction
 * rather than a warning — nothing is broken, the pipeline simply has not run.
 */
export function WarehouseNotice() {
  const { start, isStarting, isRunning } = usePipeline();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-wrap items-center gap-4 rounded-xl border border-brand-line bg-brand-surface px-6 py-5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-surface">
        <Database aria-hidden className="size-5 text-brand" strokeWidth={1.75} />
      </span>

      <div className="min-w-0 flex-1">
        <h2 id={headingId} className="text-sm font-semibold text-ink">
          The warehouse has not been built yet
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Analytics read the DuckDB warehouse, which a pipeline run publishes from the immutable
          raw lake — they never fall back to the operational database. Until a run finishes, every
          measure below is genuinely zero.
        </p>
      </div>

      <Button onClick={start} loading={isStarting} disabled={isRunning}>
        {isRunning ? null : <Play aria-hidden className="size-4" />}
        {isRunning ? 'Pipeline running' : 'Run pipeline'}
      </Button>
    </section>
  );
}
