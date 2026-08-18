import { cx } from '../../lib/cx';

/**
 * Loading placeholders sized like the content they replace, so nothing jumps
 * when real values arrive.
 */

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('block animate-pulse rounded bg-surface-sunken', className)} />;
}

export interface TableSkeletonProps {
  rows?: number;
  columns: number;
  /** Announced once while the region loads. */
  label: string;
}

export function TableSkeleton({ rows = 8, columns, label }: TableSkeletonProps) {
  return (
    <div className="px-6 py-4" role="status" aria-label={label}>
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex gap-4">
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton
                key={column}
                className={cx('h-4 flex-1', column === 0 && 'max-w-[14rem]')}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChartSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cx('px-6 pb-6', className)}>
      <Skeleton className="h-[260px] w-full rounded-lg" />
    </div>
  );
}
