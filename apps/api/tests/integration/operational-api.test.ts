import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrations.js';
import {
  assertPostgresReachable,
  createTemporaryDatabase,
  type TemporaryDatabase,
} from './support/database.js';

/**
 * The operational API against a real PostgreSQL.
 *
 * Foreign keys, unique constraints, transactional rollback and `numeric`
 * arithmetic are all database behaviour — a mocked pool would let every one of
 * these assertions pass while the real thing was broken.
 */

let db: TemporaryDatabase;
let app: Express;

beforeAll(async () => {
  await assertPostgresReachable();
  db = await createTemporaryDatabase('operational_api');
  await migrate(db.pool);

  app = createApp({
    pool: db.pool,
    checks: {
      postgres: async () => ({ status: 'up' }),
      warehouse: async () => ({ status: 'down', detail: 'not published in tests' }),
    },
  });
}, 120_000);

afterAll(async () => {
  await db?.drop();
});

let sequence = 0;
const unique = (): string => `${Date.now().toString(36)}${++sequence}`;

async function newCustomer(overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/customers')
    .send({
      name: 'Aarav Sharma',
      email: `aarav.${unique()}@example.com`,
      city: 'Pune',
      state: 'Maharashtra',
      ...overrides,
    });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; email: string; name: string };
}

async function newProduct(overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/products')
    .send({
      sku: `SKU-${unique()}`,
      name: 'Noise-Cancelling Headphones',
      category: 'Electronics',
      unitPrice: 7499,
      ...overrides,
    });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as { id: string; sku: string; unitPrice: number };
}

describe('POST /api/customers', () => {
  it('creates a customer and returns the documented shape', async () => {
    const email = `create.${unique()}@example.com`;

    const response = await request(app)
      .post('/api/customers')
      .send({ name: 'Meera Nair', email, city: 'Kochi', state: 'Kerala' })
      .expect(201);

    expect(response.body).toMatchObject({
      name: 'Meera Nair',
      email,
      city: 'Kochi',
      state: 'Kerala',
    });
    expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(response.body.createdAt)).not.toBeNaN();
  });

  it('rejects a duplicate email with 409, regardless of capitalisation', async () => {
    const customer = await newCustomer();

    const response = await request(app)
      .post('/api/customers')
      .send({
        name: 'Someone Else',
        email: customer.email.toUpperCase(),
        city: 'Delhi',
        state: 'Delhi',
      })
      .expect(409);

    expect(response.body.error.code).toBe('conflict');
    expect(response.body.error.message).toMatch(/already exists/);
  });

  it('rejects an invalid body with the documented issue list', async () => {
    const response = await request(app)
      .post('/api/customers')
      .send({ name: '', email: 'nope', city: 'Pune', state: 'Maharashtra' })
      .expect(400);

    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.issues.map((i: { path: string }) => i.path).sort()).toEqual([
      'email',
      'name',
    ]);
  });

  it('rejects malformed JSON as a client error, not a 500', async () => {
    const response = await request(app)
      .post('/api/customers')
      .set('Content-Type', 'application/json')
      .send('{"name": ')
      .expect(400);

    expect(response.body.error.code).toBe('validation_failed');
  });
});

describe('GET /api/customers', () => {
  it('paginates and reports the unfiltered total', async () => {
    await newCustomer();
    await newCustomer();

    const response = await request(app).get('/api/customers?limit=1&offset=0').expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.limit).toBe(1);
    expect(response.body.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it('rejects a limit above the documented maximum', async () => {
    await request(app).get('/api/customers?limit=500').expect(400);
  });

  it('returns 404 for an unknown id and 400 for a malformed one', async () => {
    await request(app).get('/api/customers/00000000-0000-4000-8000-000000000000').expect(404);
    // Without path validation this would reach PostgreSQL and surface as a 500.
    await request(app).get('/api/customers/not-a-uuid').expect(400);
  });
});

describe('POST /api/products', () => {
  it('rejects a duplicate SKU with 409', async () => {
    const product = await newProduct();

    const response = await request(app)
      .post('/api/products')
      .send({ sku: product.sku, name: 'Other', category: 'Electronics', unitPrice: 100 })
      .expect(409);

    expect(response.body.error.message).toMatch(/SKU already exists/);
  });

  it('returns price as a number with two decimals preserved', async () => {
    const response = await request(app)
      .post('/api/products')
      .send({ sku: `SKU-${unique()}`, name: 'Kettle', category: 'Home & Kitchen', unitPrice: 1499.5 })
      .expect(201);

    expect(response.body.unitPrice).toBe(1499.5);
    expect(typeof response.body.unitPrice).toBe('number');
  });

  it('rejects a negative price', async () => {
    await request(app)
      .post('/api/products')
      .send({ sku: `SKU-${unique()}`, name: 'X', category: 'Y', unitPrice: -1 })
      .expect(400);
  });
});

describe('GET /api/products', () => {
  it('filters by category and by active flag', async () => {
    const category = `Cat-${unique()}`;
    await newProduct({ category });
    await newProduct({ category, active: false });

    const all = await request(app).get(`/api/products?category=${category}`).expect(200);
    const activeOnly = await request(app)
      .get(`/api/products?category=${category}&active=true`)
      .expect(200);

    expect(all.body.pagination.total).toBe(2);
    expect(activeOnly.body.pagination.total).toBe(1);
    expect(activeOnly.body.data[0].active).toBe(true);
  });
});

describe('POST /api/orders', () => {
  it('creates a multi-item order atomically and computes the totals', async () => {
    const customer = await newCustomer();
    const first = await newProduct({ unitPrice: 1000 });
    const second = await newProduct({ unitPrice: 250.5 });

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2026-08-01',
        items: [
          { productId: first.id, quantity: 2 },
          { productId: second.id, quantity: 3 },
        ],
      })
      .expect(201);

    expect(response.body).toMatchObject({
      customerId: customer.id,
      customerName: customer.name,
      orderDate: '2026-08-01',
      status: 'pending',
      itemCount: 2,
    });

    // 2 * 1000 + 3 * 250.50
    expect(response.body.orderTotal).toBe(2751.5);

    const lines = response.body.items as { productId: string; lineTotal: number }[];
    expect(lines.find((l) => l.productId === first.id)?.lineTotal).toBe(2000);
    expect(lines.find((l) => l.productId === second.id)?.lineTotal).toBe(751.5);
    for (const line of response.body.items) {
      expect(line.sku).toBeTruthy();
      expect(line.productName).toBeTruthy();
    }
  });

  it('captures the catalogue price at the moment of sale', async () => {
    const customer = await newCustomer();
    const product = await newProduct({ unitPrice: 500 });

    const order = await request(app)
      .post('/api/orders')
      .send({ customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    expect(order.body.items[0].unitPriceAtSale).toBe(500);

    // Reprice the catalogue, then re-read the order.
    await db.pool.query('update products set unit_price = 900 where id = $1', [product.id]);

    const reread = await request(app).get(`/api/orders/${order.body.id}`).expect(200);

    // The whole reason unit_price_at_sale exists: history must not move.
    expect(reread.body.items[0].unitPriceAtSale).toBe(500);
    expect(reread.body.orderTotal).toBe(500);
  });

  it('honours an explicit sale price over the catalogue price', async () => {
    const customer = await newCustomer();
    const product = await newProduct({ unitPrice: 1000 });

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1, unitPriceAtSale: 799.99 }],
      })
      .expect(201);

    expect(response.body.items[0].unitPriceAtSale).toBe(799.99);
  });

  it('defaults orderDate to today and status to pending', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: customer.id, items: [{ productId: product.id, quantity: 1 }] })
      .expect(201);

    expect(response.body.orderDate).toBe(new Date().toISOString().slice(0, 10));
    expect(response.body.status).toBe('pending');
  });

  it('returns 404 for an unknown customer', async () => {
    const product = await newProduct();

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: '00000000-0000-4000-8000-000000000000',
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(404);

    expect(response.body.error.code).toBe('customer_not_found');
  });

  it('returns 404 for an unknown product', async () => {
    const customer = await newCustomer();

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        items: [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      })
      .expect(404);

    expect(response.body.error.code).toBe('product_not_found');
  });

  it('returns 409 for a retired product', async () => {
    const customer = await newCustomer();
    const retired = await newProduct({ active: false });

    const response = await request(app)
      .post('/api/orders')
      .send({ customerId: customer.id, items: [{ productId: retired.id, quantity: 1 }] })
      .expect(409);

    expect(response.body.error.code).toBe('product_inactive');
    expect(response.body.error.message).toContain(retired.sku);
  });

  it('rejects a future order date', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2099-01-01',
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(400);

    expect(response.body.error.issues[0].path).toBe('orderDate');
  });

  it('persists nothing when any item is invalid', async () => {
    const customer = await newCustomer();
    const good = await newProduct();

    const before = await db.pool.query<{ n: string }>(
      'select count(*)::text as n from orders where customer_id = $1',
      [customer.id],
    );

    // The second item is unknown, so the whole request must fail. If the insert
    // were not transactional, the order header would survive without its items.
    await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        items: [
          { productId: good.id, quantity: 1 },
          { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
        ],
      })
      .expect(404);

    const after = await db.pool.query<{ n: string }>(
      'select count(*)::text as n from orders where customer_id = $1',
      [customer.id],
    );

    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it('rejects a duplicated product rather than surfacing a constraint violation', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    const response = await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        items: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 2 },
        ],
      })
      .expect(400);

    expect(response.body.error.code).toBe('validation_failed');
    expect(response.body.error.issues[0].path).toBe('items.1.productId');
  });
});

describe('GET /api/orders', () => {
  it('returns orders newest first with their items nested', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2026-01-15',
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(201);
    await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2026-06-20',
        items: [{ productId: product.id, quantity: 2 }],
      })
      .expect(201);

    const response = await request(app)
      .get(`/api/orders?customerId=${customer.id}`)
      .expect(200);

    expect(response.body.pagination.total).toBe(2);
    expect(response.body.data[0].orderDate).toBe('2026-06-20');
    expect(response.body.data[0].items).toHaveLength(1);
  });

  it('filters by status and by date range', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2025-12-01',
        status: 'delivered',
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(201);

    const delivered = await request(app)
      .get(`/api/orders?customerId=${customer.id}&status=delivered`)
      .expect(200);
    const inWindow = await request(app)
      .get(`/api/orders?customerId=${customer.id}&from=2025-11-01&to=2025-12-31`)
      .expect(200);
    const outsideWindow = await request(app)
      .get(`/api/orders?customerId=${customer.id}&from=2026-01-01&to=2026-01-31`)
      .expect(200);

    expect(delivered.body.pagination.total).toBe(1);
    expect(inWindow.body.pagination.total).toBe(1);
    expect(outsideWindow.body.pagination.total).toBe(0);
  });

  it('rejects an inverted date range', async () => {
    const response = await request(app)
      .get('/api/orders?from=2026-06-01&to=2026-01-01')
      .expect(400);

    expect(response.body.error.issues[0].path).toBe('from');
  });

  it('keeps the order date on the stored calendar day, not shifted by timezone', async () => {
    const customer = await newCustomer();
    const product = await newProduct();

    // A date parsed into a local-midnight Date and re-serialised in UTC shifts a
    // day west of Greenwich. Selecting the column as text avoids that entirely.
    await request(app)
      .post('/api/orders')
      .send({
        customerId: customer.id,
        orderDate: '2026-03-01',
        items: [{ productId: product.id, quantity: 1 }],
      })
      .expect(201);

    const response = await request(app)
      .get(`/api/orders?customerId=${customer.id}`)
      .expect(200);

    expect(response.body.data[0].orderDate).toBe('2026-03-01');
  });
});

describe('boundary between OLTP and analytics', () => {
  it('exposes no analytics route yet, so nothing can read PostgreSQL for reporting', async () => {
    // Phase 4 adds these against DuckDB. Until then they must not exist, rather
    // than quietly aggregating the operational database.
    for (const path of [
      '/api/analytics/revenue',
      '/api/analytics/sales-by-product',
      '/api/analytics/sales-by-city',
      '/api/analytics/daily-sales',
    ]) {
      const response = await request(app).get(path).expect(404);
      expect(response.body.error.code).toBe('not_found');
    }
  });
});
