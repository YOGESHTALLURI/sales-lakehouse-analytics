import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CategorySales } from '../../api/types';
import { formatCount, formatMoney, formatMoneyCompact } from '../../lib/format';
import { AXIS_TICK, CHART_INK, CHART_MARGIN, GRID_PROPS, seriesColor } from './chartTheme';
import { ChartTooltip } from './ChartTooltip';

/**
 * Revenue by category as a ranked horizontal bar chart.
 *
 * Horizontal because category names are words: rotated labels under vertical
 * bars are harder to read than a left-aligned list. The unfilled track behind
 * each bar shows each category's share of the leader at a glance.
 */

export interface CategoryBarChartProps {
  categories: readonly CategorySales[];
}

const ROW_HEIGHT = 40;
const MIN_HEIGHT = 200;

export function CategoryBarChart({ categories }: CategoryBarChartProps) {
  const height = Math.max(MIN_HEIGHT, categories.length * ROW_HEIGHT);

  return (
    <div className="px-2 pb-2" aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={[...categories]} layout="vertical" margin={CHART_MARGIN} barSize={14}>
          <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />

          <XAxis
            type="number"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatMoneyCompact}
          />
          <YAxis
            type="category"
            dataKey="category"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={132}
          />

          <Tooltip
            cursor={{ fill: 'var(--color-surface-sunken)' }}
            content={(tooltip) => {
              const row = tooltip.payload?.[0]?.payload as CategorySales | undefined;
              if (tooltip.active !== true || !row) return null;

              return (
                <ChartTooltip
                  title={row.category}
                  rows={[
                    { label: 'Revenue', value: formatMoney(row.revenue), color: seriesColor(0) },
                    { label: 'Units', value: formatCount(row.unitsSold) },
                    { label: 'Orders', value: formatCount(row.orderCount) },
                  ]}
                />
              );
            }}
          />

          <Bar
            dataKey="revenue"
            fill={seriesColor(0)}
            radius={[0, 4, 4, 0]}
            background={{ fill: CHART_INK.track, radius: 4 }}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
