import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { downsample } from '../../lib/series';
import { seriesColor } from './chartTheme';

/**
 * A trend shape for a KPI card.
 *
 * Purely decorative — it carries no labels or scale, and the card's value and
 * delta already state the measure — so it is hidden from assistive technology
 * rather than announced as an unlabelled chart. The full numbers are in the
 * dashboard's daily-sales table.
 */

const POINTS = 28;

export interface SparklineProps {
  values: readonly number[];
}

export function Sparkline({ values }: SparklineProps) {
  if (values.length < 2) return null;

  const data = downsample(values, POINTS).map((value, index) => ({ index, value }));

  return (
    <div aria-hidden className="h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="value"
            stroke={seriesColor(0)}
            strokeWidth={1.75}
            fill={seriesColor(0)}
            fillOpacity={0.1}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
