import { Package } from 'lucide-react';
import type { SalesByProduct } from '../../api/types';
import { DataPanel } from '../../components/DataPanel';
import { TBody, TableCaption, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import type { AsyncResult } from '../../hooks/useAsync';
import { formatCount, formatMoney } from '../../lib/format';
import { categoryIcon } from '../products/categoryIcon';

export interface TopProductsPanelProps {
  result: AsyncResult<SalesByProduct>;
  /** Shown in the header so the panel states its own scope. */
  topN: number;
}

/**
 * Highest-revenue products, ordered by the API.
 *
 * Already a table, so it needs no separate data-table alternative — the numbers
 * are the presentation.
 */
export function TopProductsPanel({ result, topN }: TopProductsPanelProps) {
  const products = result.data?.topProducts ?? [];

  return (
    <DataPanel
      title="Top products"
      description={`The ${topN} highest-revenue products in this window.`}
      status={result.status}
      error={result.error}
      onRetry={result.refresh}
      refreshing={result.isRefreshing}
      hasData={result.data !== undefined}
      warehouseReady={result.data?.warehouseReady}
      isEmpty={products.length === 0}
      emptyIcon={Package}
      emptyTitle="No product sales in this window"
      skeleton="table"
      skeletonColumns={4}
    >
      <TableFrame>
        <TableCaption>
          Products ranked by revenue, with the units sold and category for each.
        </TableCaption>
        <THead>
          <tr>
            <Th className="w-12">#</Th>
            <Th>Product</Th>
            <Th>Category</Th>
            <Th align="right">Units</Th>
            <Th align="right">Revenue</Th>
          </tr>
        </THead>
        <TBody>
          {products.map((product, index) => {
            const Icon = categoryIcon(product.category);

            return (
              <Tr key={product.productId}>
                <Td className="text-ink-faint" align="left">
                  {index + 1}
                </Td>
                <Td>
                  <span className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-sunken">
                      <Icon aria-hidden className="size-4 text-ink-muted" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{product.name}</span>
                      <span className="block text-xs text-ink-faint">{product.sku}</span>
                    </span>
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{product.category}</Td>
                <Td align="right">{formatCount(product.unitsSold)}</Td>
                <Td align="right" className="font-medium text-ink">
                  {formatMoney(product.revenue)}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </TableFrame>
    </DataPanel>
  );
}
