import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  loadGenerationProfile,
  loadSeedSettings,
  loadVocabulary,
  seedsDir,
  type SeedSettings,
} from '../../src/seed/config.js';
import { generateDataset, type GeneratedDataset } from '../../src/seed/generate.js';
import { loadDataset } from '../../src/seed/load.js';
import { validateDataset } from '../../src/seed/validate.js';
import { migrate } from '../../src/db/migrations.js';
import {
  assertPostgresReachable,
  createTemporaryDatabase,
  type TemporaryDatabase,
} from './support/database.js';

/**
 * The generator's own validation says the dataset should be loadable. This suite
 * checks that claim against the real schema, which is the only thing that can
 * confirm the validator and the CHECK constraints actually agree.
 */

const directory = seedsDir();
const vocabulary = loadVocabulary(directory);
const profile = loadGenerationProfile(directory);

function build(overrides: Partial<SeedSettings> = {}): GeneratedDataset {
  return generateDataset({ ...loadSeedSettings({}), ...overrides }, vocabulary, profile);
}

// Reduced volume for the behavioural assertions; a separate spec below loads the
// full documented dataset.
const REDUCED = { customers: 80, products: 40, orders: 600 };

let db: TemporaryDatabase;

beforeAll(async () => {
  await assertPostgresReachable();
  db = await createTemporaryDatabase('seed');
  await migrate(db.pool);
  await loadDataset(db.pool, build(REDUCED), { allowDestructive: true });
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

async function count(table: string): Promise<number> {
  const result = await db.pool.query<{ n: string }>(`select count(*)::text as n from ${table}`);
  return Number.parseInt(result.rows[0]!.n, 10);
}

describe('loading a generated dataset', () => {
  it('inserts exactly the rows that were generated', async () => {
    const dataset = build(REDUCED);

    expect(await count('customers')).toBe(dataset.customers.length);
    expect(await count('products')).toBe(dataset.products.length);
    expect(await count('orders')).toBe(dataset.orders.length);
    expect(await count('order_items')).toBe(dataset.orderItems.length);
  });

  it('stores the generated primary keys rather than database-assigned ones', async () => {
    const dataset = build(REDUCED);
    const expected = dataset.customers[0]!;

    const result = await db.pool.query<{ name: string; email: string }>(
      'select name, email from customers where id = $1',
      [expected.id],
    );

    expect(result.rows[0]).toEqual({ name: expected.name, email: expected.email });
  });

  it('preserves money exactly, with no floating-point drift', async () => {
    const report = validateDataset(build(REDUCED));

    const result = await db.pool.query<{ revenue: string }>(
      'select coalesce(sum(quantity * unit_price_at_sale), 0)::text as revenue from order_items',
    );

    // numeric arithmetic in PostgreSQL must agree with the generator's
    // paise-based total to the last cent.
    expect(Number.parseFloat(result.rows[0]!.revenue)).toBeCloseTo(
      Number.parseFloat(report.statistics.totalRevenue),
      2,
    );
  });

  it('replaces rather than appends when re-seeded', async () => {
    const before = await count('orders');

    await loadDataset(db.pool, build(REDUCED), { allowDestructive: true });

    // Truncate-then-insert: a second run must not double the data.
    expect(await count('orders')).toBe(before);
    expect(await count('order_items')).toBe(
      build(REDUCED).orderItems.length,
    );
  });

  it('leaves pipeline_runs alone, because audit history is not seed data', async () => {
    await db.pool.query(
      "insert into pipeline_runs (status, completed_at, lake_prefix) values ('succeeded', now(), 'raw/run_date=2026-08-18/run_id=x/')",
    );

    await loadDataset(db.pool, build(REDUCED), { allowDestructive: true });

    expect(await count('pipeline_runs')).toBe(1);
    await db.pool.query('delete from pipeline_runs');
  });

  it('rolls back completely when a row violates the schema', async () => {
    const before = {
      customers: await count('customers'),
      orders: await count('orders'),
    };

    const corrupt = build(REDUCED);
    // Something the validator would catch but that is planted after validation,
    // to prove the load itself is transactional.
    corrupt.orders[10]!.status = 'refunded';

    await expect(
      loadDataset(db.pool, corrupt, { allowDestructive: true }),
    ).rejects.toThrow(/rolled back/);

    // The truncate happened inside the same transaction, so the previous data
    // must still be there.
    expect(await count('customers')).toBe(before.customers);
    expect(await count('orders')).toBe(before.orders);
  });

  it('refuses to truncate when destructive operations are not permitted', async () => {
    await expect(
      loadDataset(db.pool, build(REDUCED), { allowDestructive: false }),
    ).rejects.toThrow(/Refusing to truncate/);
  });
});

describe('the loaded data supports the analytics the dashboard needs', () => {
  it('joins every order item to a product and a customer', async () => {
    const result = await db.pool.query<{ orphans: string }>(`
      select count(*)::text as orphans
        from order_items i
        left join orders o   on o.id = i.order_id
        left join products p on p.id = i.product_id
        left join customers c on c.id = o.customer_id
       where o.id is null or p.id is null or c.id is null
    `);

    // The warehouse will build fact_sales from exactly this join.
    expect(result.rows[0]!.orphans).toBe('0');
  });

  it('produces revenue for every category', async () => {
    const result = await db.pool.query<{ category: string }>(`
      select p.category
        from order_items i
        join products p on p.id = i.product_id
       group by p.category
      having sum(i.quantity * i.unit_price_at_sale) > 0
    `);

    expect(result.rows.length).toBe(10);
  });

  it('produces revenue across many cities', async () => {
    const result = await db.pool.query<{ n: string }>(`
      select count(distinct c.city)::text as n
        from order_items i
        join orders o    on o.id = i.order_id
        join customers c on c.id = o.customer_id
    `);

    expect(Number.parseInt(result.rows[0]!.n, 10)).toBeGreaterThan(15);
  });
});

describe('the full documented dataset', () => {
  let full: TemporaryDatabase;

  beforeAll(async () => {
    full = await createTemporaryDatabase('seed_full');
    await migrate(full.pool);
  }, 120_000);

  afterAll(async () => {
    await full?.drop();
  });

  it('loads at the scale the plan asks for', async () => {
    const dataset = build();
    const report = validateDataset(dataset);
    expect(report.ok).toBe(true);

    const result = await loadDataset(full.pool, dataset, { allowDestructive: true });

    expect(result.customers).toBe(500);
    expect(result.products).toBe(100);
    expect(result.orders).toBe(10_000);
    expect(result.orderItems).toBeGreaterThan(10_000);

    const rows = await full.pool.query<{ n: string }>(
      'select count(*)::text as n from order_items',
    );
    expect(Number.parseInt(rows.rows[0]!.n, 10)).toBe(dataset.orderItems.length);
  }, 120_000);
});
