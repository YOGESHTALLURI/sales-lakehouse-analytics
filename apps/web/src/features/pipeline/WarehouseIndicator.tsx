import { Link } from 'react-router';
import { USING_FIXTURES } from '../../api/client';
import { formatRelativeTime } from '../../lib/format';
import { Skeleton } from '../../components/ui/Skeleton';
import { cx } from '../../lib/cx';
import { usePipeline } from './PipelineProvider';

/**
 * Whether the warehouse the dashboard reads is current, visible from every page.
 *
 * `warehouseReady: false` is a normal state for a fresh stack, so this reports it
 * plainly and links to where it can be fixed instead of looking like a fault.
 */
export function WarehouseIndicator() {
  const { status, isLoading, isRunning, error } = usePipeline();

  const lastSuccessful = status?.lastSuccessful ?? null;
  const failed = status?.current?.status === 'failed';

  const { tone, label, detail } = describe();

  return (
    <Link
      to="/pipeline"
      className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-sunken"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cx('size-2 shrink-0 rounded-full', tone, isRunning && 'animate-pulse')}
        />
        <span className="text-sm font-medium text-ink">{label}</span>
      </span>

      <span className="mt-0.5 block pl-4 text-xs text-ink-muted">
        {isLoading ? <Skeleton className="mt-1 h-3 w-28" /> : detail}
      </span>

      {USING_FIXTURES ? (
        <span className="mt-2 block pl-4 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Fixture data
        </span>
      ) : null}
    </Link>
  );

  function describe(): { tone: string; label: string; detail: string } {
    if (error !== undefined) {
      return { tone: 'bg-critical', label: 'Pipeline status unknown', detail: 'Could not reach the API' };
    }
    if (isRunning) {
      return { tone: 'bg-brand', label: 'Pipeline running', detail: 'Building the warehouse' };
    }
    if (failed) {
      return { tone: 'bg-critical', label: 'Last run failed', detail: 'The warehouse was not replaced' };
    }
    if (lastSuccessful?.completedAt) {
      return {
        tone: 'bg-positive',
        label: 'Warehouse up to date',
        detail: `Published ${formatRelativeTime(lastSuccessful.completedAt)}`,
      };
    }
    return { tone: 'bg-ink-faint', label: 'Warehouse not built', detail: 'No pipeline run yet' };
  }
}
