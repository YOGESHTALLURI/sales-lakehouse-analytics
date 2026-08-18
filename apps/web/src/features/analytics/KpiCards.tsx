import { Boxes, IndianRupee, ShoppingCart, Tag, Users } from 'lucide-react';
import { Sparkline } from '../../components/charts/Sparkline';
import { Card } from '../../components/ui/Card';
import { StatCard, type StatDelta } from '../../components/ui/StatCard';
import { ErrorState } from '../../components/ui/States';
import { formatCount, formatMoney } from '../../lib/format';
import { deltaRatio } from '../../lib/dateRange';
import type { AnalyticsData } from './useAnalyticsData';

/**
 * The five headline measures the plan requires.
 *
 * Two details worth knowing:
 *
 *  - The deltas are computed here from a second call over the preceding window,
 *    because the contract has no comparison field. It is the one figure this UI
 *    derives; every other number is rendered as the API reported it.
 *  - "Active customers" has no sparkline. `daily-sales` carries revenue, orders
 *    and units per day but no daily customer count, and inventing a shape for a
 *    measure the warehouse does not expose daily would be a lie in chart form.
 */

export interface KpiCardsProps {
  data: AnalyticsData;
  comparedWith: string;
}

export function KpiCards({ data, comparedWith }: KpiCardsProps) {
  const { revenue, previous, daily } = data;
  const summary = revenue.data;

  if (revenue.status === 'error' && summary === undefined) {
    return (
      <Card>
        <ErrorState error={revenue.error} onRetry={revenue.refresh} />
      </Card>
    );
  }

  const loading = revenue.status === 'loading' && summary === undefined;
  const series = daily.data?.series ?? [];

  const delta = (current: number | undefined, baseline: number | undefined): StatDelta | undefined => {
    if (current === undefined || baseline === undefined) return undefined;
    const ratio = deltaRatio(current, baseline);
    return ratio === undefined ? undefined : { ratio, comparedWith };
  };

  const spark = (values: readonly number[]) =>
    values.length > 1 ? <Sparkline values={values} /> : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard
        label="Total revenue"
        value={formatMoney(summary?.totalRevenue ?? 0)}
        icon={IndianRupee}
        loading={loading}
        delta={delta(summary?.totalRevenue, previous.data?.totalRevenue)}
        sparkline={spark(series.map((point) => point.revenue))}
      />

      <StatCard
        label="Orders"
        value={formatCount(summary?.orderCount ?? 0)}
        icon={ShoppingCart}
        loading={loading}
        delta={delta(summary?.orderCount, previous.data?.orderCount)}
        sparkline={spark(series.map((point) => point.orderCount))}
      />

      <StatCard
        label="Units sold"
        value={formatCount(summary?.unitsSold ?? 0)}
        icon={Boxes}
        loading={loading}
        delta={delta(summary?.unitsSold, previous.data?.unitsSold)}
        sparkline={spark(series.map((point) => point.unitsSold))}
      />

      <StatCard
        label="Active customers"
        value={formatCount(summary?.customerCount ?? 0)}
        icon={Users}
        loading={loading}
        delta={delta(summary?.customerCount, previous.data?.customerCount)}
        footnote="Distinct customers with a sale in range"
      />

      <StatCard
        label="Average order value"
        value={formatMoney(summary?.averageOrderValue ?? 0)}
        icon={Tag}
        loading={loading}
        delta={delta(summary?.averageOrderValue, previous.data?.averageOrderValue)}
        sparkline={spark(
          series.map((point) => (point.orderCount === 0 ? 0 : point.revenue / point.orderCount)),
        )}
      />
    </div>
  );
}
