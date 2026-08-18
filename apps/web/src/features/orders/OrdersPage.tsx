import { ChevronDown, ChevronRight, Plus, ShoppingCart, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import { PAGE_LIMITS } from '../../api/endpoints';
import type { Order } from '../../api/types';
import { DataPanel } from '../../components/DataPanel';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClasses } from '../../components/ui/Button';
import { CardFooter } from '../../components/ui/Card';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, TableCaption, TableFrame, Td, Th, THead, Tr } from '../../components/ui/Table';
import { useAsync } from '../../hooks/useAsync';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useQueryState } from '../../hooks/useQueryState';
import { formatCount, formatDate, formatMoneyPrecise, todayIso } from '../../lib/format';
import { isOrderStatus, ORDER_STATUS_OPTIONS, orderStatusLabel, orderStatusTone } from './orderStatus';

const COLUMN_COUNT = 7;

/** Order history with the filters the contract supports, and line items on demand. */
export function OrdersPage() {
  useDocumentTitle('Sales');

  const query = useQueryState();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const limit = query.getNumber('limit', PAGE_LIMITS.default);
  const offset = query.getNumber('offset', 0);
  const statusRaw = query.get('status') ?? '';
  const status = isOrderStatus(statusRaw) ? statusRaw : undefined;
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';

  const result = useAsync(
    (signal) =>
      api.listOrders(
        {
          limit,
          offset,
          status,
          from: from === '' ? undefined : from,
          to: to === '' ? undefined : to,
        },
        signal,
      ),
    [limit, offset, statusRaw, from, to],
  );

  const orders = result.data?.data ?? [];
  const pagination = result.data?.pagination;
  const filtered = statusRaw !== '' || from !== '' || to !== '';

  function toggle(orderId: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  return (
    <>
      <PageHeader
        title="Sales"
        description="Every order recorded in PostgreSQL, newest first."
        actions={
          <Link to="/sales/new" className={buttonClasses('primary', 'md')}>
            <Plus aria-hidden className="size-4" />
            New order
          </Link>
        }
      />

      {/* Filters live in the URL, so a filtered view can be shared and the back
          button steps back through them. */}
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface px-6 py-4 shadow-card">
        <div className="w-48">
          <SelectField
            label="Status"
            value={statusRaw}
            placeholder="Any status"
            options={ORDER_STATUS_OPTIONS}
            onChange={(event) => query.set({ status: event.target.value, offset: undefined })}
          />
        </div>

        <div className="w-44">
          <TextField
            label="Ordered from"
            type="date"
            value={from}
            max={to === '' ? todayIso() : to}
            onChange={(event) => query.set({ from: event.target.value, offset: undefined })}
          />
        </div>

        <div className="w-44">
          <TextField
            label="Ordered to"
            type="date"
            value={to}
            min={from === '' ? undefined : from}
            max={todayIso()}
            onChange={(event) => query.set({ to: event.target.value, offset: undefined })}
          />
        </div>

        {filtered ? (
          <Button
            variant="ghost"
            onClick={() =>
              query.set({ status: undefined, from: undefined, to: undefined, offset: undefined })
            }
          >
            <X aria-hidden className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </div>

      <DataPanel
        title="Order history"
        status={result.status}
        error={result.error}
        onRetry={result.refresh}
        refreshing={result.isRefreshing}
        hasData={result.data !== undefined}
        isEmpty={orders.length === 0}
        emptyIcon={ShoppingCart}
        emptyTitle={filtered ? 'No orders match these filters' : 'No orders yet'}
        emptyDescription={
          filtered
            ? 'Widen the date range or clear the status filter.'
            : 'Record the first sale to see it here.'
        }
        skeleton="table"
        skeletonColumns={6}
      >
        <TableFrame>
          <TableCaption>
            Orders with customer, date, status, line count and total. Each row expands to show its
            line items.
          </TableCaption>
          <THead>
            <tr>
              <Th className="w-10">
                <span className="sr-only">Expand</span>
              </Th>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Total</Th>
            </tr>
          </THead>
          <TBody>
            {orders.map((order) => {
              const open = expanded.has(order.id);

              return (
                <Fragment key={order.id}>
                  <Tr>
                    <Td>
                      <button
                        type="button"
                        onClick={() => toggle(order.id)}
                        aria-expanded={open}
                        aria-controls={`order-items-${order.id}`}
                        className="flex size-7 items-center justify-center rounded-md text-ink-muted hover:bg-surface-sunken hover:text-ink"
                      >
                        {open ? (
                          <ChevronDown aria-hidden className="size-4" />
                        ) : (
                          <ChevronRight aria-hidden className="size-4" />
                        )}
                        <span className="sr-only">
                          {open ? 'Hide' : 'Show'} line items for order{' '}
                          {order.id.slice(0, 8)}
                        </span>
                      </button>
                    </Td>
                    <Td className="font-mono text-xs text-ink-muted">{order.id.slice(0, 8)}</Td>
                    <Td className="font-medium text-ink">
                      {order.customerName ?? (
                        <span className="font-mono text-xs text-ink-muted">
                          {order.customerId.slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(order.orderDate)}</Td>
                    <Td>
                      <Badge tone={orderStatusTone(order.status)} dot>
                        {orderStatusLabel(order.status)}
                      </Badge>
                    </Td>
                    <Td align="right">{formatCount(order.itemCount)}</Td>
                    <Td align="right" className="font-medium text-ink">
                      {formatMoneyPrecise(order.orderTotal)}
                    </Td>
                  </Tr>

                  {open ? <OrderItemsRow order={order} /> : null}
                </Fragment>
              );
            })}
          </TBody>
        </TableFrame>

        {pagination ? (
          <CardFooter>
            <Pagination
              limit={pagination.limit}
              offset={pagination.offset}
              total={pagination.total}
              noun="orders"
              disabled={result.isRefreshing}
              onOffsetChange={(next) => query.set({ offset: next === 0 ? undefined : next })}
              onLimitChange={(next) =>
                query.set({
                  limit: next === PAGE_LIMITS.default ? undefined : next,
                  offset: undefined,
                })
              }
            />
          </CardFooter>
        ) : null}
      </DataPanel>
    </>
  );
}

/**
 * The line items of one order.
 *
 * `unitPriceAtSale` is shown rather than the product's current price: that is the
 * whole reason the API captures it, and displaying today's catalogue price here
 * would misreport history.
 */
function OrderItemsRow({ order }: { order: Order }) {
  return (
    <tr id={`order-items-${order.id}`} className="bg-surface-sunken/40">
      <td colSpan={COLUMN_COUNT} className="px-4 py-4">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Line items for order {order.id}, with the price captured at the time of sale.
            </caption>
            <THead>
              <tr>
                <Th>SKU</Th>
                <Th>Product</Th>
                <Th align="right">Quantity</Th>
                <Th align="right">Price at sale</Th>
                <Th align="right">Line total</Th>
              </tr>
            </THead>
            <TBody>
              {order.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-mono text-xs text-ink-muted">{item.sku}</Td>
                  <Td className="text-ink">{item.productName}</Td>
                  <Td align="right">{formatCount(item.quantity)}</Td>
                  <Td align="right">{formatMoneyPrecise(item.unitPriceAtSale)}</Td>
                  <Td align="right" className="font-medium text-ink">
                    {formatMoneyPrecise(item.lineTotal)}
                  </Td>
                </Tr>
              ))}
            </TBody>
            <tfoot className="border-t border-line">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-right font-medium text-ink-soft">
                  Order total
                </td>
                <td className="px-4 py-3 text-right font-semibold text-ink" data-numeric>
                  {formatMoneyPrecise(order.orderTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </td>
    </tr>
  );
}
