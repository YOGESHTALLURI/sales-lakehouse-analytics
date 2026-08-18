import { ChartColumn } from 'lucide-react';
import type { SalesByProduct } from '../../api/types';
import { CategoryBarChart } from '../../components/charts/CategoryBarChart';
import { ChartDataTable } from '../../components/charts/ChartDataTable';
import { DataPanel } from '../../components/DataPanel';
import type { AsyncResult } from '../../hooks/useAsync';
import { formatCount, formatMoney } from '../../lib/format';

export interface CategoryPanelProps {
  result: AsyncResult<SalesByProduct>;
}

export function CategoryPanel({ result }: CategoryPanelProps) {
  const categories = result.data?.categories ?? [];

  return (
    <DataPanel
      title="Sales by category"
      status={result.status}
      error={result.error}
      onRetry={result.refresh}
      refreshing={result.isRefreshing}
      hasData={result.data !== undefined}
      warehouseReady={result.data?.warehouseReady}
      isEmpty={categories.length === 0}
      emptyIcon={ChartColumn}
      emptyTitle="No category sales in this window"
      skeleton="chart"
    >
      <CategoryBarChart categories={categories} />

      <ChartDataTable
        caption="Revenue, units and order count for each product category."
        rows={categories}
        rowKey={(row) => row.category}
        columns={[
          { key: 'category', header: 'Category', cell: (row) => row.category },
          {
            key: 'revenue',
            header: 'Revenue',
            align: 'right',
            cell: (row) => formatMoney(row.revenue),
          },
          {
            key: 'units',
            header: 'Units',
            align: 'right',
            cell: (row) => formatCount(row.unitsSold),
          },
          {
            key: 'orders',
            header: 'Orders',
            align: 'right',
            cell: (row) => formatCount(row.orderCount),
          },
        ]}
      />
    </DataPanel>
  );
}
