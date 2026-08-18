import type { Pool, PoolClient } from 'pg';
import type { GeneratedDataset } from './generate.js';

/**
 * Load a generated dataset into PostgreSQL.
 *
 * One transaction for the whole load, so a failure leaves the database with the
 * data it had before rather than a half-populated catalogue.
 */

export class SeedLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedLoadError';
  }
}

/**
 * Tables the seed owns and may therefore clear.
 *
 * pipeline_runs is deliberately absent: it is the platform's audit history, not
 * seed data, and those runs really did happen. Truncate order matters less than
 * the CASCADE, but it is listed child-first for readability.
 */
const SEED_TABLES = ['order_items', 'orders', 'products', 'customers'] as const;

/**
 * PostgreSQL caps a statement at 65535 bound parameters. order_items binds 5
 * columns, so 1000 rows per statement stays far inside the limit for every
 * table while keeping the number of round trips small.
 */
const ROWS_PER_STATEMENT = 1000;

async function insertBatched(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): Promise<void> {
  if (rows.length === 0) return;

  const columnList = columns.join(', ');

  for (let offset = 0; offset < rows.length; offset += ROWS_PER_STATEMENT) {
    const batch = rows.slice(offset, offset + ROWS_PER_STATEMENT);
    const values: unknown[] = [];
    const tuples: string[] = [];

    for (const row of batch) {
      const placeholders = row.map((_, index) => `$${values.length + index + 1}`);
      tuples.push(`(${placeholders.join(', ')})`);
      values.push(...row);
    }

    await client.query(
      `insert into ${table} (${columnList}) values ${tuples.join(', ')}`,
      values,
    );
  }
}

export interface LoadResult {
  customers: number;
  products: number;
  orders: number;
  orderItems: number;
}

export interface LoadOptions {
  /** Refuse to truncate unless explicitly permitted. Defaults to the NODE_ENV check. */
  allowDestructive?: boolean;
  log?: (message: string) => void;
}

/**
 * Replace all seed data with the given dataset.
 *
 * Destructive by definition — it truncates before inserting — so it refuses to
 * run against a production environment unless explicitly overridden.
 */
export async function loadDataset(
  pool: Pool,
  dataset: GeneratedDataset,
  options: LoadOptions = {},
): Promise<LoadResult> {
  const log = options.log ?? (() => {});
  const allowDestructive = options.allowDestructive ?? process.env.NODE_ENV !== 'production';

  if (!allowDestructive) {
    throw new SeedLoadError(
      'Refusing to truncate seed tables with NODE_ENV=production. ' +
        'Set SEED_ALLOW_PRODUCTION=true if this really is intended.',
    );
  }

  const client = await pool.connect();

  try {
    await client.query('begin');

    log(`clearing ${SEED_TABLES.join(', ')}`);
    // One statement so foreign keys are never momentarily violated. CASCADE
    // covers dependants; pipeline_runs has no FK into these tables, so its
    // audit history survives.
    await client.query(`truncate table ${SEED_TABLES.join(', ')} cascade`);

    log(`inserting ${dataset.customers.length} customers`);
    await insertBatched(
      client,
      'customers',
      ['id', 'name', 'email', 'city', 'state', 'created_at'],
      dataset.customers.map((c) => [c.id, c.name, c.email, c.city, c.state, c.createdAt]),
    );

    log(`inserting ${dataset.products.length} products`);
    await insertBatched(
      client,
      'products',
      ['id', 'sku', 'name', 'category', 'unit_price', 'active', 'created_at'],
      dataset.products.map((p) => [
        p.id,
        p.sku,
        p.name,
        p.category,
        p.unitPrice,
        p.active,
        p.createdAt,
      ]),
    );

    log(`inserting ${dataset.orders.length} orders`);
    await insertBatched(
      client,
      'orders',
      ['id', 'customer_id', 'order_date', 'status', 'created_at'],
      dataset.orders.map((o) => [o.id, o.customerId, o.orderDate, o.status, o.createdAt]),
    );

    log(`inserting ${dataset.orderItems.length} order items`);
    await insertBatched(
      client,
      'order_items',
      ['id', 'order_id', 'product_id', 'quantity', 'unit_price_at_sale'],
      dataset.orderItems.map((i) => [
        i.id,
        i.orderId,
        i.productId,
        i.quantity,
        i.unitPriceAtSale,
      ]),
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw new SeedLoadError(
      `Seed load failed and was rolled back: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  } finally {
    client.release();
  }

  return {
    customers: dataset.customers.length,
    products: dataset.products.length,
    orders: dataset.orders.length,
    orderItems: dataset.orderItems.length,
  };
}
