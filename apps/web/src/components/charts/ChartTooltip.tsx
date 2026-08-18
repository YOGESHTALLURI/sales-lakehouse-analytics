import type { ReactNode } from 'react';

/**
 * A tooltip styled from the tokens rather than Recharts' defaults.
 *
 * Recharts hands the payload to a render function, so this stays a plain
 * presentational component and needs none of the library's generic props.
 */

export interface TooltipRow {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}

export interface ChartTooltipProps {
  title: string;
  subtitle?: string;
  rows: readonly TooltipRow[];
}

export function ChartTooltip({ title, subtitle, rows }: ChartTooltipProps): ReactNode {
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 shadow-raised">
      <p className="text-xs font-semibold text-ink">{title}</p>
      {subtitle ? <p className="text-xs text-ink-faint">{subtitle}</p> : null}

      <dl className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <dt className="flex items-center gap-1.5 text-xs text-ink-muted">
              {row.color ? (
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
              ) : null}
              {row.label}
            </dt>
            <dd className="text-xs font-medium text-ink" data-numeric>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
