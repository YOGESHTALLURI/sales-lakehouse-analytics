import { ChartColumn } from 'lucide-react';
import { useMemo } from 'react';
import type { DailySales } from '../../api/types';
import { ChartDataTable } from '../../components/charts/ChartDataTable';
import { RevenueTrendChart } from '../../components/charts/RevenueTrendChart';
import { DataPanel } from '../../components/DataPanel';
import { BareSelect } from '../../components/ui/Field';
import type { AsyncResult } from '../../hooks/useAsync';
import { formatCount, formatMoney } from '../../lib/format';
import {
  bucketSeries,
  GRANULARITIES,
  GRANULARITY_LABELS,
  type Granularity,
} from '../../lib/series';

const GRANULARITY_OPTIONS = GRANULARITIES.map((value) => ({
  value,
  label: GRANULARITY_LABELS[value],
}));

export interface RevenuePanelProps {
  result: AsyncResult<DailySales>;
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
}

/**
 * Revenue over time, with the underlying figures one keystroke away.
 *
 * Weekly and monthly views sum the daily points the API returned; the daily view
 * plots them untouched.
 */
export function RevenuePanel({ result, granularity, onGranularityChange }: RevenuePanelProps) {
  const series = result.data?.series ?? [];
  const points = useMemo(() => bucketSeries(series, granularity), [series, granularity]);

  const hasRevenue = series.some((point) => point.revenue > 0);

  return (
    <DataPanel
      title="Revenue over time"
      status={result.status}
      error={result.error}
      onRetry={result.refresh}
      refreshing={result.isRefreshing}
      hasData={result.data !== undefined}
      warehouseReady={result.data?.warehouseReady}
      isEmpty={points.length === 0 || !hasRevenue}
      emptyIcon={ChartColumn}
      emptyTitle="No sales in this window"
      emptyDescription="Every day in the selected range has zero revenue. Try a wider window."
      skeleton="chart"
      actions={
        <BareSelect
          label="Granularity"
          className="h-9 w-auto"
          value={granularity}
          options={GRANULARITY_OPTIONS}
          onChange={(event) => {
            const next = event.target.value;
            if (GRANULARITIES.some((candidate) => candidate === next)) {
              onGranularityChange(next as Granularity);
            }
          }}
        />
      }
    >
      <RevenueTrendChart points={points} bucketed={granularity !== 'daily'} />

      <ChartDataTable
        caption={`Revenue, orders and units by ${granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week' : 'month'}, for the selected window.`}
        rows={points}
        rowKey={(row) => row.date}
        columns={[
          { key: 'period', header: 'Period', cell: (row) => row.label },
          {
            key: 'revenue',
            header: 'Revenue',
            align: 'right',
            cell: (row) => formatMoney(row.revenue),
          },
          {
            key: 'orders',
            header: 'Orders',
            align: 'right',
            cell: (row) => formatCount(row.orderCount),
          },
          {
            key: 'units',
            header: 'Units',
            align: 'right',
            cell: (row) => formatCount(row.unitsSold),
          },
        ]}
      />
    </DataPanel>
  );
}
