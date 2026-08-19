import { Clock } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/Badge';
import { Card, CardBody, CardFooter, CardHeader } from '../../components/ui/Card';
import { Callout } from '../../components/ui/Callout';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/States';
import { describeError } from '../../lib/describeError';
import { formatRelativeTime } from '../../lib/format';
import { PipelineFlow } from './PipelineFlow';
import { usePipeline } from './PipelineProvider';
import { runStatusLabel, runStatusTone } from './runPresentation';
import { RunPipelineButton } from './RunPipelineButton';

/**
 * The pipeline summary that sits on the dashboard: state, the three boundaries,
 * when the warehouse was last published, and the run control.
 */
export function PipelineCard() {
  const { status, isLoading, error, refresh, startError, dismissStartError } = usePipeline();

  const current = status?.current ?? null;
  const lastSuccessful = status?.lastSuccessful ?? null;

  return (
    <Card>
      <CardHeader
        title="Pipeline status"
        actions={
          current ? (
            <Badge
              tone={runStatusTone(current.status)}
              dot
              pulse={current.status === 'running' || current.status === 'queued'}
            >
              {runStatusLabel(current.status)}
            </Badge>
          ) : isLoading ? null : (
            <Badge tone="neutral" dot>
              Never run
            </Badge>
          )
        }
      />

      {error !== undefined && status === undefined ? (
        <ErrorState error={error} onRetry={refresh} />
      ) : (
        <>
          <CardBody className="space-y-6">
            {isLoading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : (
              <PipelineFlow status={current?.status} />
            )}

            {startError !== undefined ? (
              <Callout tone="caution" onDismiss={dismissStartError}>
                {describeError(startError).message}
              </Callout>
            ) : null}

            {current?.status === 'failed' && current.errorSummary ? (
              <Callout tone="critical" title="The last run failed">
                {current.errorSummary}
              </Callout>
            ) : null}
          </CardBody>

          <CardFooter className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm">
              <Clock aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
              <span>
                <span className="block text-xs text-ink-muted">Last successful run</span>
                <span className="block font-medium text-ink">
                  {isLoading ? (
                    <Skeleton className="mt-1 h-4 w-24" />
                  ) : lastSuccessful?.completedAt ? (
                    formatRelativeTime(lastSuccessful.completedAt)
                  ) : (
                    'None yet'
                  )}
                </span>
              </span>
            </span>

            <span className="flex items-center gap-2">
              <Link
                to="/pipeline"
                className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink"
              >
                Run details
              </Link>
              <RunPipelineButton />
            </span>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
