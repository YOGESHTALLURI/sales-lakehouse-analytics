import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { formatPercent } from '../../lib/format';
import { Skeleton } from './Skeleton';

/**
 * One headline measure.
 *
 * The value is rendered into a fixed-height row with tabular figures, so a card
 * showing 0 before the warehouse exists is exactly the same size as one showing
 * ₹4,28,300 afterwards.
 */

export interface StatDelta {
  /** Signed fraction: 0.124 means 12.4% up on the comparison window. */
  readonly ratio: number;
  /** What it is compared with, e.g. "previous 30 days". */
  readonly comparedWith: string;
}

export interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  delta?: StatDelta;
  /** A small trend visual; omitted where the contract has no daily measure. */
  sparkline?: ReactNode;
  footnote?: string;
  loading?: boolean;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  sparkline,
  footnote,
  loading = false,
}: StatCardProps) {
  const labelId = useId();

  return (
    // A labelled group, so the measure and its value are announced together
    // rather than as two unrelated fragments of text.
    <div
      role="group"
      aria-labelledby={labelId}
      className="rounded-xl border border-line bg-surface p-6 shadow-card"
    >
      <div className="flex items-start justify-between gap-4">
        <p id={labelId} className="text-sm font-medium text-ink-muted">
          {label}
        </p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-surface">
          <Icon aria-hidden className="size-4 text-brand" strokeWidth={2} />
        </span>
      </div>

      <p className="mt-3 h-9 text-3xl font-semibold tracking-tight text-ink" data-numeric>
        {loading ? <Skeleton className="mt-1.5 h-7 w-32" /> : value}
      </p>

      <div className="mt-2 flex h-5 items-center">
        {delta ? <DeltaLabel {...delta} /> : footnote ? (
          <p className="text-xs text-ink-faint">{footnote}</p>
        ) : null}
      </div>

      {sparkline ? <div className="mt-4 h-14">{sparkline}</div> : null}
    </div>
  );
}

function DeltaLabel({ ratio, comparedWith }: StatDelta) {
  const direction = ratio > 0.0005 ? 'up' : ratio < -0.0005 ? 'down' : 'flat';

  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : ArrowRight;
  const tone =
    direction === 'up' ? 'text-positive' : direction === 'down' ? 'text-critical' : 'text-ink-muted';
  const spoken =
    direction === 'flat'
      ? `Unchanged from the ${comparedWith}`
      : `${formatPercent(Math.abs(ratio))} ${direction === 'up' ? 'higher' : 'lower'} than the ${comparedWith}`;

  return (
    <p className={cx('flex items-center gap-1 text-xs font-medium', tone)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      <span aria-hidden data-numeric>
        {formatPercent(Math.abs(ratio))}
      </span>
      <span className="sr-only">{spoken}</span>
      <span className="font-normal text-ink-faint" aria-hidden>
        vs {comparedWith}
      </span>
    </p>
  );
}
