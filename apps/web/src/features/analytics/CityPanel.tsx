import { MapPin } from 'lucide-react';
import type { SalesByCity } from '../../api/types';
import { DataPanel } from '../../components/DataPanel';
import { TBody, TableCaption, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import type { AsyncResult } from '../../hooks/useAsync';
import { formatCount, formatMoney } from '../../lib/format';

export interface CityPanelProps {
  result: AsyncResult<SalesByCity | undefined>;
}

/**
 * Revenue by customer city.
 *
 * The share bar is drawn relative to the leading city and hidden from assistive
 * technology, because the figure beside it says the same thing precisely.
 */
export function CityPanel({ result }: CityPanelProps) {
  const cities = result.data?.cities ?? [];
  const leader = cities[0]?.revenue ?? 0;

  return (
    <DataPanel
      title="Sales by city"
      description="Ordered by revenue, joined through the customer dimension."
      status={result.status}
      error={result.error}
      onRetry={result.refresh}
      refreshing={result.isRefreshing}
      hasData={result.data !== undefined}
      warehouseReady={result.data?.warehouseReady}
      isEmpty={cities.length === 0}
      emptyIcon={MapPin}
      emptyTitle="No city sales in this window"
      skeleton="table"
      skeletonColumns={5}
    >
      <TableFrame>
        <TableCaption>
          Revenue, order count and distinct customers for each city, ordered by revenue.
        </TableCaption>
        <THead>
          <tr>
            <Th>City</Th>
            <Th>State</Th>
            <Th align="right">Revenue</Th>
            <Th className="w-40">Share</Th>
            <Th align="right">Orders</Th>
            <Th align="right">Customers</Th>
          </tr>
        </THead>
        <TBody>
          {cities.map((city) => (
            <Tr key={`${city.city}-${city.state}`}>
              <Td className="font-medium text-ink">{city.city}</Td>
              <Td className="whitespace-nowrap">{city.state}</Td>
              <Td align="right" className="font-medium text-ink">
                {formatMoney(city.revenue)}
              </Td>
              <Td>
                <span aria-hidden className="block h-1.5 w-full rounded-full bg-chart-track">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${leader === 0 ? 0 : Math.round((city.revenue / leader) * 100)}%` }}
                  />
                </span>
              </Td>
              <Td align="right">{formatCount(city.orderCount)}</Td>
              <Td align="right">{formatCount(city.customerCount)}</Td>
            </Tr>
          ))}
        </TBody>
      </TableFrame>
    </DataPanel>
  );
}
