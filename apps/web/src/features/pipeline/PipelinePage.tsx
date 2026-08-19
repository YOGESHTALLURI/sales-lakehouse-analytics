import { CircleCheck, Clock, Database, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PipelineRun } from '../../api/types';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Callout } from '../../components/ui/Callout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { describeError } from '../../lib/describeError';
import { formatCount, formatDateTime, formatDuration, formatRelativeTime } from '../../lib/format';
import { PipelineFlow } from './PipelineFlow';
import { usePipeline } from './PipelineProvider';
import { ROW_COUNT_FIELDS, runStatusLabel, runStatusTone } from './runPresentation';
import { RunPipelineButton } from './RunPipelineButton';

/**
 * Pipeline control and audit.
 *
 * Everything shown here is read from the persisted `pipeline_runs` record, so it
 * survives a reload and is not a client-side guess about what the ETL is doing.
 */
export function PipelinePage() {
  useDocumentTitle('Data pipeline');

  const { status, isLoading, error, refresh, isRunning, startError, dismissStartError } =
    usePipeline();

  const current = status?.current ?? null;
  const lastSuccessful = status?.lastSuccessful ?? null;

  return (
    <>
      <PageHeader
        title="Data pipeline"
        description="Extract the operational database into an immutable raw run in the lake, then rebuild and publish the DuckDB warehouse from it."
        actions={<RunPipelineButton />}
      />

      {startError !== undefined ? (
        <Callout tone="caution" className="mb-6" onDismiss={dismissStartError}>
          {describeError(startError).message}
        </Callout>
      ) : null}

      {error !== undefined && status === undefined ? (
        <Card>
          <ErrorState error={error} onRetry={refresh} />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card>
              <CardHeader
                title="Current run"
                description={
                  isRunning
                    ? 'Refreshing automatically every two seconds while the run is active.'
                    : undefined
                }
                actions={
                  current ? (
                    <Badge
                      tone={runStatusTone(current.status)}
                      dot
                      pulse={current.status === 'running' || current.status === 'queued'}
                    >
                      {runStatusLabel(current.status)}
                    </Badge>
                  ) : null
                }
              />

              <CardBody className="space-y-6">
                {isLoading ? (
                  <Skeleton className="h-28 w-full rounded-lg" />
                ) : current === null ? (
                  <EmptyState
                    icon={Database}
                    title="No pipeline run yet"
                    description="The warehouse is published by a run. Start one to build it from the current operational data."
                    action={<RunPipelineButton />}
                  />
                ) : (
                  <>
                    <PipelineFlow status={current.status} />

                    {current.status === 'failed' && current.errorSummary ? (
                      <Callout tone="critical" title="The run failed">
                        {current.errorSummary} The previously published warehouse was left in
                        place, so analytics continue to serve the last good data.
                      </Callout>
                    ) : null}

                    <RunDetails run={current} />
                  </>
                )}
              </CardBody>
            </Card>

            {current && Object.keys(current.rowCounts ?? {}).length > 0 ? (
              <Card>
                <CardHeader
                  title="Rows moved"
                  description="Source counts captured at extraction time, and the resulting fact rows."
                />
                <CardBody>
                  <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                    {ROW_COUNT_FIELDS.map((field) => {
                      const value = current.rowCounts?.[field.key];
                      if (value === undefined) return null;

                      return (
                        <div
                          key={field.key}
                          className="rounded-lg border border-line bg-surface-sunken/50 px-4 py-3"
                        >
                          <dt className="text-xs text-ink-muted">{field.label}</dt>
                          <dd
                            className="mt-1 text-xl font-semibold tracking-tight text-ink"
                            data-numeric
                          >
                            {formatCount(value)}
                          </dd>
                          <dd className="mt-0.5 text-[11px] text-ink-faint">{field.hint}</dd>
                        </div>
                      );
                    })}
                  </dl>
                </CardBody>
              </Card>
            ) : null}
          </div>

          <Card>
            <CardHeader title="Last successful run" />
            <CardBody>
              {isLoading ? (
                <Skeleton className="h-24 w-full rounded-lg" />
              ) : lastSuccessful === null ? (
                <p className="text-sm text-ink-muted">
                  No run has completed successfully, so no warehouse has been published.
                </p>
              ) : (
                <div className="space-y-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-positive">
                    <CircleCheck aria-hidden className="size-4" strokeWidth={2} />
                    Warehouse published{' '}
                    {lastSuccessful.completedAt
                      ? formatRelativeTime(lastSuccessful.completedAt)
                      : 'recently'}
                  </p>
                  <RunDetails run={lastSuccessful} />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function RunDetails({ run }: { run: PipelineRun }) {
  return (
    <dl className="space-y-3 text-sm">
      <Detail label="Run id">
        <code className="break-all font-mono text-xs text-ink-soft">{run.runId}</code>
      </Detail>

      <Detail label="Started">{formatDateTime(run.startedAt)}</Detail>

      <Detail label="Completed">
        {run.completedAt ? (
          formatDateTime(run.completedAt)
        ) : (
          <span className="flex items-center gap-1.5 text-brand">
            <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            In progress
          </span>
        )}
      </Detail>

      <Detail label="Duration">
        {run.durationSeconds === null || run.durationSeconds === undefined ? (
          <span className="flex items-center gap-1.5 text-ink-muted">
            <Clock aria-hidden className="size-3.5" />
            Not finished
          </span>
        ) : (
          formatDuration(run.durationSeconds)
        )}
      </Detail>

      {run.lakePrefix ? (
        <Detail label="Lake prefix">
          <code className="break-all font-mono text-xs text-ink-soft">{run.lakePrefix}</code>
        </Detail>
      ) : null}
    </dl>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
