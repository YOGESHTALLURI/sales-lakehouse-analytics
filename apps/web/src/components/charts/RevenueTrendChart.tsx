import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount, formatMoney, formatMoneyCompact } from '../../lib/format';
import type { SeriesPoint } from '../../lib/series';
import { AXIS_TICK, CHART_HEIGHT, CHART_MARGIN, GRID_PROPS, seriesColor } from './chartTheme';
import { ChartTooltip } from './ChartTooltip';

/**
 * Revenue over time.
 *
 * The series arrives gap-filled from `dim_date`, so it is plotted exactly as
 * given — a day with no sales is a real zero in the line, not a break in it.
 */

export interface RevenueTrendChartProps {
  points: readonly SeriesPoint[];
  /** Weekly and monthly buckets span a range, so the tooltip says which. */
  bucketed: boolean;
}

export function RevenueTrendChart({ points, bucketed }: RevenueTrendChartProps) {
  return (
    <div className="px-2 pb-2" aria-hidden>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={[...points]} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_PROPS} />

          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            padding={{ left: 8, right: 8 }}
          />
          <YAxis
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={72}
            tickFormatter={formatMoneyCompact}
          />

          <Tooltip
            cursor={{ stroke: seriesColor(0), strokeDasharray: '4 4' }}
            content={(tooltip) => {
              const point = tooltip.payload?.[0]?.payload as SeriesPoint | undefined;
              if (tooltip.active !== true || !point) return null;

              return (
                <ChartTooltip
                  title={point.label}
                  subtitle={bucketed && point.endDate !== point.date ? `through ${point.endDate}` : undefined}
                  rows={[
                    { label: 'Revenue', value: formatMoney(point.revenue), color: seriesColor(0) },
                    { label: 'Orders', value: formatCount(point.orderCount) },
                    { label: 'Units', value: formatCount(point.unitsSold) },
                  ]}
                />
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="revenue"
            stroke={seriesColor(0)}
            strokeWidth={2}
            fill={seriesColor(0)}
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-surface)' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
