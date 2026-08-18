import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../http/errors.js';
import type { ListOrdersQuery, OrderCreate } from '../schemas/index.js';
import type { Page } from './catalogue.js';

/**
 * Order persistence.
 *
 * The header and every line item are written in one transaction: an order that
 * exists without its items would be revenue the warehouse can never account
 * for, so a partial write is worse than no write.
 */

export interface OrderItemRow {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceAtSale: number;
  lineTotal: number;
}

export interface OrderRow {
  id: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  status: string;
  items: OrderItemRow[];
  itemCount: number;
  orderTotal: number;
  createdAt: string;
}

interface RawOrder {
  id: string;
  customer_id: string;
  customer_name: string;
  order_date: string;
  status: string;
  created_at: Date;
}

interface RawItem {
  id: string;
  order_id: string;
  product_id: string;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_at_sale: string;
  line_total: string;
}

/**
 * `order_date` is selected as text.
 *
 * pg would otherwise parse a `date` into a JS Date at local midnight, which
 * shifts the calendar day west of UTC. The stored day is the answer; formatting
 * it in SQL keeps it intact.
 */
const ORDER_COLUMNS = `o.id,
        o.customer_id,
        c.name as customer_name,
        to_char(o.order_date, 'YYYY-MM-DD') as order_date,
        o.status,
        o.created_at`;

function mapItem(row: RawItem): OrderItemRow {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    productName: row.product_name,
    quantity: row.quantity,
    unitPriceAtSale: Number.parseFloat(row.unit_price_at_sale),
    // Computed by PostgreSQL in numeric, so the published total never depends
    // on floating-point multiplication in JavaScript.
    lineTotal: Number.parseFloat(row.line_total),
  };
}

function assemble(order: RawOrder, items: OrderItemRow[]): OrderRow {
  return {
    id: order.id,
    customerId: order.customer_id,
    customerName: order.customer_name,
    orderDate: order.order_date,
    status: order.status,
    items,
    itemCount: items.length,
    // Summed in paise to keep the total exact for any realistic order size.
    orderTotal:
      items.reduce((total, item) => total + Math.round(item.lineTotal * 100), 0) / 100,
    createdAt: order.created_at.toISOString(),
  };
}

const ITEM_QUERY = `select i.id,
              i.order_id,
              i.product_id,
              p.sku,
              p.name as product_name,
              i.quantity,
              i.unit_price_at_sale,
              (i.quantity * i.unit_price_at_sale) as line_total
         from order_items i
         join products p on p.id = i.product_id
        where i.order_id = any($1::uuid[])
        order by p.name, i.id`;

async function itemsByOrder(
  client: Pool | PoolClient,
  orderIds: string[],
): Promise<Map<string, OrderItemRow[]>> {
  const grouped = new Map<string, OrderItemRow[]>();
  if (orderIds.length === 0) return grouped;

  // One query for the whole page rather than one per order: an N+1 here would
  // scale with page size for no benefit.
  const result = await client.query<RawItem>(ITEM_QUERY, [orderIds]);

  for (const row of result.rows) {
    const bucket = grouped.get(row.order_id);
    if (bucket) bucket.push(mapItem(row));
    else grouped.set(row.order_id, [mapItem(row)]);
  }

  return grouped;
}

interface CatalogueEntry {
  id: string;
  sku: string;
  name: string;
  unitPrice: string;
  active: boolean;
}

/**
 * Resolve every referenced product inside the transaction.
 *
 * `for share` holds a shared lock on each row for the transaction's duration, so
 * a product cannot be retired between this check and the insert. Reading the
 * price here is what captures the price at sale.
 */
async function resolveProducts(
  client: PoolClient,
  productIds: string[],
): Promise<Map<string, CatalogueEntry>> {
  const result = await client.query<{
    id: string;
    sku: string;
    name: string;
    unit_price: string;
    active: boolean;
  }>(
    `select id, sku, name, unit_price, active
       from products
      where id = any($1::uuid[])
      for share`,
    [productIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        sku: row.sku,
        name: row.name,
        unitPrice: row.unit_price,
        active: row.active,
      },
    ]),
  );
}

export async function createOrder(pool: Pool, input: OrderCreate): Promise<OrderRow> {
  const client = await pool.connect();

  try {
    await client.query('begin');

    // `for share` again: the order must not outlive its customer being deleted
    // mid-transaction. ON DELETE RESTRICT would catch it, but with a less
    // useful error than the documented 404.
    const customer = await client.query<{ id: string; name: string }>(
      'select id, name from customers where id = $1 for share',
      [input.customerId],
    );

    if (customer.rowCount === 0) {
      throw ApiError.notFound('customer_not_found', 'No customer exists with that id.');
    }

    const productIds = input.items.map((item) => item.productId);
    const catalogue = await resolveProducts(client, productIds);

    const missing = productIds.filter((id) => !catalogue.has(id));
    if (missing.length > 0) {
      throw ApiError.notFound(
        'product_not_found',
        `No product exists with id ${missing.join(', ')}.`,
      );
    }

    const retired = productIds.filter((id) => !catalogue.get(id)!.active);
    if (retired.length > 0) {
      const skus = retired.map((id) => catalogue.get(id)!.sku).join(', ');
      throw ApiError.conflict(
        'product_inactive',
        `Product ${skus} is retired and cannot be added to a new order.`,
      );
    }

    // Default to the current UTC day. The API owns this rule rather than a
    // CHECK constraint, because a clock-relative constraint would make the
    // deterministic seed unloadable on a machine whose date differs.
    const orderDate = input.orderDate ?? new Date().toISOString().slice(0, 10);

    if (input.orderDate && input.orderDate > new Date().toISOString().slice(0, 10)) {
      throw ApiError.validation([
        { path: 'orderDate', message: 'An order cannot be dated in the future.' },
      ]);
    }

    const inserted = await client.query<{ id: string; created_at: Date }>(
      `insert into orders (customer_id, order_date, status)
       values ($1, $2, $3)
       returning id, created_at`,
      [input.customerId, orderDate, input.status],
    );

    const orderId = inserted.rows[0]!.id;

    const values: unknown[] = [];
    const tuples = input.items.map((item, index) => {
      const entry = catalogue.get(item.productId)!;
      // An explicit price wins; otherwise the catalogue price is captured now,
      // so a later price change never restates this sale.
      const price =
        item.unitPriceAtSale === undefined ? entry.unitPrice : item.unitPriceAtSale.toFixed(2);

      values.push(orderId, item.productId, item.quantity, price);
      const base = index * 4;
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    });

    await client.query(
      `insert into order_items (order_id, product_id, quantity, unit_price_at_sale)
       values ${tuples.join(', ')}`,
      values,
    );

    const header = await client.query<RawOrder>(
      `select ${ORDER_COLUMNS}
         from orders o
         join customers c on c.id = o.customer_id
        where o.id = $1`,
      [orderId],
    );

    const items = await itemsByOrder(client, [orderId]);

    await client.query('commit');

    return assemble(header.rows[0]!, items.get(orderId) ?? []);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listOrders(pool: Pool, query: ListOrdersQuery): Promise<Page<OrderRow>> {
  const customerId = query.customerId ?? null;
  const status = query.status ?? null;
  const from = query.from ?? null;
  const to = query.to ?? null;

  const where = `where ($1::uuid is null or o.customer_id = $1::uuid)
                   and ($2::text is null or o.status = $2::text)
                   and ($3::date is null or o.order_date >= $3::date)
                   and ($4::date is null or o.order_date <= $4::date)`;

  const [headers, total] = await Promise.all([
    pool.query<RawOrder>(
      `select ${ORDER_COLUMNS}
         from orders o
         join customers c on c.id = o.customer_id
        ${where}
        order by o.order_date desc, o.created_at desc, o.id
        limit $5 offset $6`,
      [customerId, status, from, to, query.limit, query.offset],
    ),
    pool.query<{ total: string }>(
      `select count(*)::text as total from orders o ${where}`,
      [customerId, status, from, to],
    ),
  ]);

  const items = await itemsByOrder(
    pool,
    headers.rows.map((row) => row.id),
  );

  return {
    data: headers.rows.map((row) => assemble(row, items.get(row.id) ?? [])),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: Number.parseInt(total.rows[0]!.total, 10),
    },
  };
}

export async function findOrder(pool: Pool, id: string): Promise<OrderRow | undefined> {
  const header = await pool.query<RawOrder>(
    `select ${ORDER_COLUMNS}
       from orders o
       join customers c on c.id = o.customer_id
      where o.id = $1`,
    [id],
  );

  const row = header.rows[0];
  if (!row) return undefined;

  const items = await itemsByOrder(pool, [id]);
  return assemble(row, items.get(id) ?? []);
}
