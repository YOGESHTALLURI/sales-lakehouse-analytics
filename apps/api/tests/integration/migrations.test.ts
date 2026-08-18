import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defaultMigrationsDir,
  loadMigrations,
  migrate,
  readAppliedMigrations,
} from '../../src/db/migrations.js';
import {
  assertPostgresReachable,
  createTemporaryDatabase,
  type TemporaryDatabase,
} from './support/database.js';

/**
 * Phase 1's outstanding exit criterion: migrations run from a clean volume.
 *
 * Every assertion here runs against a database created empty moments earlier,
 * so nothing can pass because of leftover state.
 */

let db: TemporaryDatabase;

beforeAll(async () => {
  await assertPostgresReachable();
  db = await createTemporaryDatabase('migrations');
  await migrate(db.pool);
}, 60_000);

afterAll(async () => {
  await db?.drop();
});

async function rows<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
  const result = await db.pool.query<T>(sql, values);
  return result.rows;
}

/** Insert helpers that return the new id, so specs read as business steps. */
async function insertCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  const values = {
    name: 'Aarav Sharma',
    email: `aarav.${Math.abs(Date.parse('2026-08-18')) + Number(process.hrtime.bigint() % 100000n)}@example.com`,
    city: 'Pune',
    state: 'Maharashtra',
    ...overrides,
  };

  const [row] = await rows<{ id: string }>(
    'insert into customers (name, email, city, state) values ($1, $2, $3, $4) returning id',
    [values.name, values.email, values.city, values.state],
  );
  return row!.id;
}

async function insertProduct(overrides: Partial<Record<string, unknown>> = {}) {
  const values = {
    sku: `SKU-${process.hrtime.bigint() % 1000000n}`,
    name: 'Noise-Cancelling Headphones',
    category: 'Electronics',
    unit_price: '7499.00',
    ...overrides,
  };

  const [row] = await rows<{ id: string }>(
    'insert into products (sku, name, category, unit_price) values ($1, $2, $3, $4) returning id',
    [values.sku, values.name, values.category, values.unit_price],
  );
  return row!.id;
}

describe('migrations against a clean database', () => {
  it('creates every table the data model calls for', async () => {
    const tables = await rows<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );

    expect(tables.map((t) => t.table_name)).toEqual([
      'customers',
      'order_items',
      'orders',
      'pipeline_runs',
      'products',
      'schema_migrations',
    ]);
  });

  it('records what it applied', async () => {
    const [applied, files] = await Promise.all([
      readAppliedMigrations(db.pool),
      loadMigrations(defaultMigrationsDir()),
    ]);

    // Derived from the committed files rather than hardcoded: a new migration
    // must not fail an assertion that has nothing to do with it.
    expect(applied.map((m) => m.version)).toEqual(files.map((f) => f.version));
    expect(applied.every((m) => m.checksum.length === 64)).toBe(true);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const expected = (await loadMigrations(defaultMigrationsDir())).length;
    const result = await migrate(db.pool);

    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(expected);
  });

  it('stores money as numeric, never floating point', async () => {
    const columns = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type
         from information_schema.columns
        where table_schema = 'public'
          and column_name in ('unit_price', 'unit_price_at_sale')`,
    );

    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.data_type === 'numeric')).toBe(true);
  });
});

describe('customer constraints', () => {
  it('treats email as unique regardless of capitalisation', async () => {
    await insertCustomer({ email: 'repeat@example.com' });

    await expect(insertCustomer({ email: 'REPEAT@example.com' })).rejects.toThrow(
      /customers_email_unique/,
    );
  });

  it('rejects a malformed email', async () => {
    await expect(insertCustomer({ email: 'not-an-email' })).rejects.toThrow(
      /customers_email_shape/,
    );
  });

  it('rejects a whitespace-only name', async () => {
    await expect(insertCustomer({ name: '   ' })).rejects.toThrow(/customers_name_not_blank/);
  });
});

describe('product constraints', () => {
  it('rejects a duplicate SKU', async () => {
    await insertProduct({ sku: 'ELEC-0042' });

    await expect(insertProduct({ sku: 'ELEC-0042' })).rejects.toThrow(/products_sku_unique/);
  });

  it('rejects a negative price', async () => {
    await expect(insertProduct({ unit_price: '-1.00' })).rejects.toThrow(
      /products_unit_price_non_negative/,
    );
  });

  it('defaults new products to active', async () => {
    const id = await insertProduct();
    const [product] = await rows<{ active: boolean }>('select active from products where id = $1', [
      id,
    ]);

    expect(product?.active).toBe(true);
  });
});

describe('order constraints', () => {
  it('rejects an order for a customer that does not exist', async () => {
    await expect(
      db.pool.query('insert into orders (customer_id, order_date) values ($1, $2)', [
        '00000000-0000-4000-8000-000000000000',
        '2026-08-18',
      ]),
    ).rejects.toThrow(/orders_customer_fk/);
  });

  it('rejects an unknown status', async () => {
    const customerId = await insertCustomer();

    await expect(
      db.pool.query('insert into orders (customer_id, order_date, status) values ($1, $2, $3)', [
        customerId,
        '2026-08-18',
        'refunded',
      ]),
    ).rejects.toThrow(/orders_status_known/);
  });

  it('refuses to delete a customer who has orders', async () => {
    const customerId = await insertCustomer();
    await db.pool.query('insert into orders (customer_id, order_date) values ($1, $2)', [
      customerId,
      '2026-08-18',
    ]);

    // Restrict, not cascade: deleting a customer must never erase revenue.
    await expect(db.pool.query('delete from customers where id = $1', [customerId])).rejects.toThrow(
      /orders_customer_fk/,
    );
  });
});

describe('order item constraints', () => {
  async function newOrder() {
    const customerId = await insertCustomer();
    const [order] = await rows<{ id: string }>(
      'insert into orders (customer_id, order_date) values ($1, $2) returning id',
      [customerId, '2026-08-18'],
    );
    return order!.id;
  }

  it('rejects a zero or negative quantity', async () => {
    const orderId = await newOrder();
    const productId = await insertProduct();

    await expect(
      db.pool.query(
        'insert into order_items (order_id, product_id, quantity, unit_price_at_sale) values ($1, $2, 0, 10.00)',
        [orderId, productId],
      ),
    ).rejects.toThrow(/order_items_quantity_positive/);
  });

  it('allows one line per product and rejects a second', async () => {
    const orderId = await newOrder();
    const productId = await insertProduct();

    await db.pool.query(
      'insert into order_items (order_id, product_id, quantity, unit_price_at_sale) values ($1, $2, 2, 10.00)',
      [orderId, productId],
    );

    await expect(
      db.pool.query(
        'insert into order_items (order_id, product_id, quantity, unit_price_at_sale) values ($1, $2, 1, 10.00)',
        [orderId, productId],
      ),
    ).rejects.toThrow(/order_items_one_line_per_product/);
  });

  it('keeps the sale price when the catalogue price later changes', async () => {
    const orderId = await newOrder();
    const productId = await insertProduct({ unit_price: '100.00' });

    await db.pool.query(
      'insert into order_items (order_id, product_id, quantity, unit_price_at_sale) values ($1, $2, 1, 100.00)',
      [orderId, productId],
    );
    await db.pool.query('update products set unit_price = 250.00 where id = $1', [productId]);

    const [item] = await rows<{ unit_price_at_sale: string }>(
      'select unit_price_at_sale from order_items where order_id = $1',
      [orderId],
    );

    // The whole reason this column exists.
    expect(item?.unit_price_at_sale).toBe('100.00');
  });

  it('deletes line items with their order but keeps the product', async () => {
    const orderId = await newOrder();
    const productId = await insertProduct();

    await db.pool.query(
      'insert into order_items (order_id, product_id, quantity, unit_price_at_sale) values ($1, $2, 1, 10.00)',
      [orderId, productId],
    );
    await db.pool.query('delete from orders where id = $1', [orderId]);

    const items = await rows('select 1 from order_items where order_id = $1', [orderId]);
    const products = await rows('select 1 from products where id = $1', [productId]);

    expect(items).toHaveLength(0);
    expect(products).toHaveLength(1);
  });
});

describe('pipeline run audit constraints', () => {
  it('permits only one running pipeline at a time', async () => {
    await db.pool.query("insert into pipeline_runs (status) values ('running')");

    // Enforced by a partial unique index, so two API replicas cannot both
    // pass an application-level check and start concurrent runs.
    await expect(
      db.pool.query("insert into pipeline_runs (status) values ('running')"),
    ).rejects.toThrow(/pipeline_runs_single_active_run/);

    await db.pool.query(
      "update pipeline_runs set status = 'succeeded', completed_at = now() where status = 'running'",
    );

    // Once the first run finishes, a new one is allowed.
    await expect(
      db.pool.query("insert into pipeline_runs (status) values ('running')"),
    ).resolves.toBeDefined();

    await db.pool.query('delete from pipeline_runs');
  });

  it('rejects a finished run with no completion time', async () => {
    await expect(
      db.pool.query("insert into pipeline_runs (status) values ('succeeded')"),
    ).rejects.toThrow(/pipeline_runs_completion_consistent/);
  });

  it('rejects a running run that already claims a completion time', async () => {
    await expect(
      db.pool.query("insert into pipeline_runs (status, completed_at) values ('running', now())"),
    ).rejects.toThrow(/pipeline_runs_completion_consistent/);
  });

  it('rejects an error summary on a run that did not fail', async () => {
    await expect(
      db.pool.query(
        "insert into pipeline_runs (status, completed_at, error_summary) values ('succeeded', now(), 'boom')",
      ),
    ).rejects.toThrow(/pipeline_runs_error_only_on_failure/);
  });

  it('rejects a completion time before the start time', async () => {
    await expect(
      db.pool.query(
        "insert into pipeline_runs (status, started_at, completed_at) values ('succeeded', now(), now() - interval '1 hour')",
      ),
    ).rejects.toThrow(/pipeline_runs_not_backwards/);
  });
});
