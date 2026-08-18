import { Database, Inbox, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { AsyncStatus } from '../hooks/useAsync';
import { Card, CardHeader } from './ui/Card';
import { ChartSkeleton, TableSkeleton } from './ui/Skeleton';
import { EmptyState, ErrorState } from './ui/States';

/**
 * A panel and its four states, decided in one place.
 *
 * Loading, error, empty and `warehouseReady: false` are not variations a panel
 * gets to improvise: a dashboard where one card shows a spinner, another shows
 * zeros and a third shows an error banner is how this UI would look broken. Every
 * analytics surface routes through here, so all four look deliberate.
 */

/**
 * Panel-level copy for `warehouseReady: false`. Kept short because the page
 * carries one full explanation with the run button; repeating it in every panel
 * would turn a normal state into a wall of warnings.
 */
export const WAREHOUSE_NOT_READY = {
  title: 'No warehouse data yet',
  description: 'Run the data pipeline to publish the DuckDB warehouse this panel reads.',
} as const;

export type PanelSkeleton = 'chart' | 'table' | 'none';

export interface DataPanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  level?: 2 | 3;

  status: AsyncStatus;
  error: unknown;
  onRetry?: () => void;
  /** True while refetching with data already on screen. */
  refreshing?: boolean;

  /** Whether anything has been loaded yet; keeps stale data visible on refetch. */
  hasData: boolean;
  /** Analytics only: `false` until a run publishes the warehouse. Not an error. */
  warehouseReady?: boolean;
  /** Warehouse ready, but nothing matched the current filters. */
  isEmpty?: boolean;

  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Shown inside the not-built state — normally the run-pipeline button. */
  warehouseAction?: ReactNode;

  skeleton?: PanelSkeleton;
  skeletonColumns?: number;
  children: ReactNode;
}

export function DataPanel({
  title,
  description,
  actions,
  level = 2,
  status,
  error,
  onRetry,
  refreshing = false,
  hasData,
  warehouseReady,
  isEmpty = false,
  emptyIcon = Inbox,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  warehouseAction,
  skeleton = 'chart',
  skeletonColumns = 4,
  children,
}: DataPanelProps) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        level={level}
        actions={
          <>
            {refreshing ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-faint" role="status">
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                Updating
              </span>
            ) : null}
            {actions}
          </>
        }
      />
      {renderBody()}
    </Card>
  );

  function renderBody(): ReactNode {
    if (status === 'error' && !hasData) {
      return <ErrorState error={error} onRetry={onRetry} />;
    }

    if (status === 'loading' && !hasData) {
      if (skeleton === 'table') {
        return <TableSkeleton columns={skeletonColumns} label={`Loading ${title.toLowerCase()}`} />;
      }
      if (skeleton === 'chart') {
        return <ChartSkeleton label={`Loading ${title.toLowerCase()}`} />;
      }
      return null;
    }

    if (warehouseReady === false) {
      return (
        <EmptyState
          icon={Database}
          title={WAREHOUSE_NOT_READY.title}
          description={WAREHOUSE_NOT_READY.description}
          action={warehouseAction}
        />
      );
    }

    if (isEmpty) {
      return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />;
    }

    return children;
  }
}
