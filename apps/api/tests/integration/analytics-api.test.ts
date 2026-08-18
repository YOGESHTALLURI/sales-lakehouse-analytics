import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrations.js';
import { closeWarehouse } from '../../src/warehouse/connection.js';
import {
  assertPostgresReachable,
  createTemporaryDatabase,
  type TemporaryDatabase,
} from './support/database.js';

/**
 * Analytics and pipeline-control endpoints over HTTP.
 *
 * These need PostgreSQL for `pipeline_runs`, which is why they are integration
 * specs. The warehouse itself is a temporary DuckDB file, so the analytics
 * assertions stay hand-verifiable.
 */

let db: TemporaryDatabase;
let app: Express;
let workDir: string;
let warehousePath: string;

/**
 * One customer, one product, two sales on consecutive days.
 *
 *   2026-05-01  Pune  4 x 500.00 = 2000.00
 *   2026-05-02  Pune  1 x 250.00 =  250.00
 *   total 2250.00, 2 orders, 5 units
 */
const FIXTURE_SQL = `
create table dim_customer (
    customer_key bigint primary key, customer_id varchar, name varchar,
    city varchar, state varchar, created_at timestamptz);
create table dim_product (
    product_key bigint primary key, product_id varchar, sku varchar, name varchar,
    category varchar, current_unit_price decimal(12,2), active boolean);
create table dim_date (
    date_key integer primary key, full_date date, day integer, month integer,
    month_name varchar, quarter integer, year integer, is_weekend boolean);
create table fact_sales (
    sale_key bigint primary key, order_id varchar, order_item_id varchar,
    customer_key bigint, product_key bigint, date_key integer,
    quantity integer, unit_price decimal(12,2), revenue decimal(14,2));
create table warehouse_metadata (key varchar primary key, value varchar);

insert into dim_customer values (1,'c-1','Aarav','Pune','Maharashtra','2026-01-01 09:00:00+00');
insert into dim_product  values (1,'p-1','ELEC-0001','Headphones','Electronics',500.00,true);
insert into dim_date values
  (20260501,'2026-05-01',1,5,'May',2,2026,false),
  (20260502,'2026-05-02',2,5,'May',2,2026,true);
insert into fact_sales values
  (1,'o-1','i-1',1,1,20260501,4,500.00,2000.00),
  (2,'o-2','i-2',1,1,20260502,1,250.00, 250.00);
insert into warehouse_metadata values ('published_at','2026-05-02T10:00:00Z');
`;

async function writeWarehouse(target: string, sql: string): Promise<void> {
  const instance = await DuckDBInstance.create(target);
  const connection = await instance.connect();
  await connection.run(sql);
  connection.closeSync();
  instance.closeSync();
}

beforeAll(async () => {
  await assertPostgresReachable();
  db = await createTemporaryDatabase('analytics_api');
  await migrate(db.pool);

  workDir = await mkdtemp(path.join(tmpdir(), 'analytics-api-'));
  warehousePath = path.join(workDir, 'sales.duckdb');
  await writeWarehouse(warehousePath, FIXTURE_SQL);

  app = createApp({
    pool: db.pool,
    warehousePath,
    checks: {
      postgres: async () => ({ status: 'up' }),
      warehouse: async () => ({ status: 'up' }),
    },
  });
}, 120_000);

afterAll(async () => {
  closeWarehouse();
  await db?.drop();
  await rm(workDir, { recursive: true, force: true });
});

describe('GET /api/analytics/revenue', () => {
  it('serves the warehouse totals', async () => {
    const response = await request(app).get('/api/analytics/revenue').expect(200);

    expect(response.body).toMatchObject({
      warehouseReady: true,
      generatedAt: '2026-05-02T10:00:00Z',
      totalRevenue: 2250,
      orderCount: 2,
      customerCount: 1,
      unitsSold: 5,
      averageOrderValue: 1125,
    });
  });

  it('serializes every measure as a JSON number', async () => {
    const response = await request(app).get('/api/analytics/revenue').expect(200);

    // DuckDB returns counts as bigint and money as {value,scale}. Either would
    // crash JSON.stringify or reach the client as an object, so the response
    // shape is worth asserting directly.
    for (const key of ['totalRevenue', 'orderCount', 'customerCount', 'unitsSold']) {
      expect(typeof response.body[key], key).toBe('number');
    }
  });

  it('applies the date window', async () => {
    const response = await request(app)
      .get('/api/analytics/revenue?from=2026-05-02&to=2026-05-02')
      .expect(200);

    expect(response.body.totalRevenue).toBe(250);
    expect(response.body.orderCount).toBe(1);
  });

  it('rejects a malformed date', async () => {
    const response = await request(app).get('/api/analytics/revenue?from=01-05-2026').expect(400);

    expect(response.body.error.code).toBe('validation_failed');
  });

  it('rejects an impossible calendar date', async () => {
    await request(app).get('/api/analytics/revenue?from=2026-02-30').expect(400);
  });

  it('rejects an inverted range', async () => {
    const response = await request(app)
      .get('/api/analytics/revenue?from=2026-06-01&to=2026-01-01')
      .expect(400);

    expect(response.body.error.issues[0].path).toBe('from');
  });

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    // Silently ignoring `groupBy` would let a caller believe a filter applied.
    await request(app).get('/api/analytics/revenue?groupBy=city').expect(400);
  });
});

describe('the other analytics endpoints', () => {
  it('groups by product and category', async () => {
    const response = await request(app).get('/api/analytics/sales-by-product').expect(200);

    expect(response.body.categories).toEqual([
      { category: 'Electronics', revenue: 2250, unitsSold: 5, orderCount: 2 },
    ]);
    expect(response.body.topProducts[0]).toMatchObject({ sku: 'ELEC-0001', revenue: 2250 });
  });

  it('honours topN', async () => {
    const response = await request(app)
      .get('/api/analytics/sales-by-product?topN=1')
      .expect(200);

    expect(response.body.topProducts).toHaveLength(1);
  });

  it('rejects a topN outside the documented bounds', async () => {
    await request(app).get('/api/analytics/sales-by-product?topN=0').expect(400);
    await request(app).get('/api/analytics/sales-by-product?topN=500').expect(400);
  });

  it('groups by city', async () => {
    const response = await request(app).get('/api/analytics/sales-by-city').expect(200);

    expect(response.body.cities).toEqual([
      { city: 'Pune', state: 'Maharashtra', revenue: 2250, orderCount: 2, customerCount: 1 },
    ]);
  });

  it('returns a gap-filled daily series', async () => {
    const response = await request(app).get('/api/analytics/daily-sales').expect(200);

    expect(response.body.series).toEqual([
      { date: '2026-05-01', revenue: 2000, orderCount: 1, unitsSold: 4 },
      { date: '2026-05-02', revenue: 250, orderCount: 1, unitsSold: 1 },
    ]);
  });
});

describe('when no warehouse exists', () => {
  it('reports not-ready with zeros instead of reading PostgreSQL', async () => {
    const emptyApp = createApp({
      pool: db.pool,
      warehousePath: path.join(workDir, 'absent.duckdb'),
      checks: {
        postgres: async () => ({ status: 'up' }),
        warehouse: async () => ({ status: 'down' }),
      },
    });

    const response = await request(emptyApp).get('/api/analytics/revenue').expect(200);

    // PostgreSQL holds 0 orders in this throwaway database, so a fallback would
    // also read zero — which is why warehouseReady is the assertion that matters.
    expect(response.body.warehouseReady).toBe(false);
    expect(response.body.totalRevenue).toBe(0);
    expect(response.body.generatedAt).toBeNull();

    closeWarehouse();
  });
});

describe('warehouse freshness after a publish', () => {
  // The ETL publishes by renaming a temporary file over the published path. On
  // Linux, where the stack actually runs, that succeeds while a reader holds the
  // old file open — which is exactly the case a cached DuckDB handle would get
  // wrong. Windows locks an open file and fails the rename with EBUSY, so the
  // scenario cannot be reproduced on a Windows host. CI runs on Linux and does
  // exercise it; skipping is honest, whereas rewriting the test to close the
  // handle first would assert nothing about cache invalidation.
  it.skipIf(process.platform === 'win32')('serves the new data once the file is replaced', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'swap-'));
    const target = path.join(scratch, 'sales.duckdb');
    const replacement = path.join(scratch, 'next.duckdb');

    try {
      await writeWarehouse(target, FIXTURE_SQL);

      const swapApp = createApp({
        pool: db.pool,
        warehousePath: target,
        checks: {
          postgres: async () => ({ status: 'up' }),
          warehouse: async () => ({ status: 'up' }),
        },
      });

      const before = await request(swapApp).get('/api/analytics/revenue').expect(200);
      expect(before.body.totalRevenue).toBe(2250);

      // Build a different warehouse and rename it over the published path, which
      // is exactly how the ETL publishes.
      await writeWarehouse(
        replacement,
        FIXTURE_SQL.replace("(1,'o-1','i-1',1,1,20260501,4,500.00,2000.00)", "(1,'o-1','i-1',1,1,20260501,9,500.00,4500.00)"),
      );
      await rename(replacement, target);

      const after = await request(swapApp).get('/api/analytics/revenue').expect(200);

      // A cached DuckDB handle would keep reading the old inode and serve 2250
      // forever, so the dashboard would never reflect a pipeline run.
      expect(after.body.totalRevenue).toBe(4750);
      expect(after.body.unitsSold).toBe(10);
    } finally {
      closeWarehouse();
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('pipeline control', () => {
  it('reports no runs on a fresh database', async () => {
    const response = await request(app).get('/api/pipeline/status').expect(200);

    expect(response.body).toEqual({ current: null, lastSuccessful: null });
  });

  it('accepts a run with 202 and queues it for the ETL worker', async () => {
    const response = await request(app).post('/api/pipeline/run').expect(202);

    // 202, not 201: the API deliberately does not execute the pipeline. Running
    // it in-process would put Python in the Node image; starting a container
    // would need the Docker socket.
    expect(response.body.status).toBe('queued');
    expect(response.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.completedAt).toBeNull();
  });

  it('refuses a second run while one is active', async () => {
    const response = await request(app).post('/api/pipeline/run').expect(409);

    // Enforced by a partial unique index, so two API replicas cannot both pass
    // an application-level check.
    expect(response.body.error.code).toBe('conflict');
  });

  it('exposes the queued run as current', async () => {
    const response = await request(app).get('/api/pipeline/status').expect(200);

    expect(response.body.current.status).toBe('queued');
    expect(response.body.lastSuccessful).toBeNull();
  });

  it('reports a completed run with duration, counts and lake prefix', async () => {
    await db.pool.query(
      `update pipeline_runs
          set status = 'succeeded',
              completed_at = started_at + interval '4.5 seconds',
              row_counts = '{"orders": 10, "factSales": 20}'::jsonb,
              lake_prefix = 'raw/run_date=2026-05-02/run_id=abc/'
        where status = 'queued'`,
    );

    const response = await request(app).get('/api/pipeline/status').expect(200);

    expect(response.body.current).toMatchObject({
      status: 'succeeded',
      durationSeconds: 4.5,
      rowCounts: { orders: 10, factSales: 20 },
      lakePrefix: 'raw/run_date=2026-05-02/run_id=abc/',
      errorSummary: null,
    });
    expect(response.body.lastSuccessful.runId).toBe(response.body.current.runId);
  });

  it('allows a new run once the previous one finished', async () => {
    await request(app).post('/api/pipeline/run').expect(202);
    await db.pool.query("update pipeline_runs set status='failed', completed_at=now(), error_summary='boom' where status='queued'");
  });

  it('surfaces a failure summary but keeps the last successful run', async () => {
    const response = await request(app).get('/api/pipeline/status').expect(200);

    expect(response.body.current.status).toBe('failed');
    expect(response.body.current.errorSummary).toBe('boom');
    // The dashboard must still be able to say when data was last good.
    expect(response.body.lastSuccessful.status).toBe('succeeded');
  });
});
