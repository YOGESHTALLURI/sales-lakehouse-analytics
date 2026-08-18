import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getDailySales,
  getRevenueSummary,
  getSalesByCity,
  getSalesByProduct,
} from '../src/warehouse/analytics.js';
import { closeWarehouse, toMoney, toNumber } from '../src/warehouse/connection.js';

/**
 * Analytics against a warehouse small enough to verify by hand.
 *
 * Phase 4's exit criterion is that returned totals match independently
 * calculated warehouse values. A fixture built from the 10,000-order seed could
 * not do that — you would be comparing the code against itself. Every expected
 * number below is arithmetic stated in a comment.
 *
 * The star schema here mirrors what the Python ETL writes, so these specs also
 * pin the contract between the two languages.
 */

let workDir: string;
let warehousePath: string;

/**
 * Two customers in different cities, two products in different categories, and
 * four sales across three days — with one quiet day in between.
 *
 *   2026-03-01  Pune / Aarav    Headphones  2 x 1000.00 = 2000.00
 *   2026-03-01  Pune / Aarav    Coffee      1 x  250.50 =  250.50
 *   2026-03-02  (no sales)
 *   2026-03-03  Kochi / Meera   Headphones  3 x  900.00 = 2700.00
 *   2026-03-03  Kochi / Meera   Coffee      4 x  200.00 =  800.00
 *
 *   total revenue 5750.50  orders 2   customers 2   units 10
 *   Electronics 4700.00     Grocery 1050.50
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

insert into dim_customer values
  (1, 'c-1', 'Aarav Sharma', 'Pune', 'Maharashtra', '2026-01-01 09:00:00+00'),
  (2, 'c-2', 'Meera Nair', 'Kochi', 'Kerala', '2026-01-01 09:00:00+00');

insert into dim_product values
  (1, 'p-1', 'ELEC-0001', 'Headphones', 'Electronics', 1000.00, true),
  (2, 'p-2', 'GROC-0001', 'Filter Coffee', 'Grocery & Gourmet', 250.50, false);

insert into dim_date values
  (20260301, '2026-03-01', 1, 3, 'March', 1, 2026, true),
  (20260302, '2026-03-02', 2, 3, 'March', 1, 2026, false),
  (20260303, '2026-03-03', 3, 3, 'March', 1, 2026, false);

insert into fact_sales values
  (1, 'o-1', 'i-1', 1, 1, 20260301, 2, 1000.00, 2000.00),
  (2, 'o-1', 'i-2', 1, 2, 20260301, 1,  250.50,  250.50),
  (3, 'o-2', 'i-3', 2, 1, 20260303, 3,  900.00, 2700.00),
  (4, 'o-2', 'i-4', 2, 2, 20260303, 4,  200.00,  800.00);

insert into warehouse_metadata values ('published_at', '2026-03-03T12:00:00Z');
`;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'analytics-'));
  warehousePath = path.join(workDir, 'sales.duckdb');

  const instance = await DuckDBInstance.create(warehousePath);
  const connection = await instance.connect();
  await connection.run(FIXTURE_SQL);
  connection.closeSync();
  instance.closeSync();
}, 60_000);

afterAll(async () => {
  closeWarehouse();
  await rm(workDir, { recursive: true, force: true });
});

afterEach(() => {
  // The module caches a handle keyed on file identity; drop it so a spec that
  // swaps the file cannot be served a stale one by an earlier spec's cache.
  closeWarehouse();
});

describe('type coercion', () => {
  it('converts a bigint, which JSON.stringify would otherwise throw on', () => {
    expect(toNumber(19_836n)).toBe(19_836);
  });

  it('converts a DuckDB decimal to its real value', () => {
    // DuckDB returns DECIMAL as { value, scale }: 3167849614 at scale 2.
    expect(toNumber({ value: 3_167_849_614n, scale: 2 })).toBeCloseTo(31_678_496.14, 2);
  });

  it('treats a null aggregate over no rows as zero', () => {
    expect(toNumber(null)).toBe(0);
    expect(toMoney(null)).toBe(0);
  });

  it('rounds money to two places', () => {
    expect(toMoney(3359.68778661576)).toBe(3359.69);
  });
});

describe('revenue summary', () => {
  it('matches the totals computed by hand', async () => {
    const summary = await getRevenueSummary(warehousePath);

    // 2000.00 + 250.50 + 2700.00 + 800.00
    expect(summary.totalRevenue).toBe(5750.5);
    expect(summary.orderCount).toBe(2);
    expect(summary.customerCount).toBe(2);
    // 2 + 1 + 3 + 4
    expect(summary.unitsSold).toBe(10);
    // 5750.50 / 2
    expect(summary.averageOrderValue).toBe(2875.25);
  });

  it('reports the warehouse as ready with its publish time', async () => {
    const summary = await getRevenueSummary(warehousePath);

    expect(summary.warehouseReady).toBe(true);
    expect(summary.generatedAt).toBe('2026-03-03T12:00:00Z');
    expect(summary.range).toEqual({ from: '2026-03-01', to: '2026-03-03' });
  });

  it('restricts totals to the requested window', async () => {
    const summary = await getRevenueSummary(warehousePath, { from: '2026-03-03' });

    // Only the second order falls in range: 2700.00 + 800.00
    expect(summary.totalRevenue).toBe(3500);
    expect(summary.orderCount).toBe(1);
    expect(summary.unitsSold).toBe(7);
  });

  it('returns zeros rather than NaN for a window with no sales', async () => {
    const summary = await getRevenueSummary(warehousePath, {
      from: '2026-03-02',
      to: '2026-03-02',
    });

    expect(summary.totalRevenue).toBe(0);
    expect(summary.orderCount).toBe(0);
    // The divide must be guarded; NaN would serialise as null and break a KPI card.
    expect(summary.averageOrderValue).toBe(0);
    expect(summary.warehouseReady).toBe(true);
  });
});

describe('sales by product', () => {
  it('groups revenue by category, highest first', async () => {
    const result = await getSalesByProduct(warehousePath);

    expect(result.categories).toEqual([
      // 2000.00 + 2700.00
      { category: 'Electronics', revenue: 4700, unitsSold: 5, orderCount: 2 },
      // 250.50 + 800.00
      { category: 'Grocery & Gourmet', revenue: 1050.5, unitsSold: 5, orderCount: 2 },
    ]);
  });

  it('ranks top products by revenue', async () => {
    const result = await getSalesByProduct(warehousePath);

    expect(result.topProducts.map((product) => product.sku)).toEqual(['ELEC-0001', 'GROC-0001']);
    expect(result.topProducts[0]).toMatchObject({
      sku: 'ELEC-0001',
      name: 'Headphones',
      category: 'Electronics',
      revenue: 4700,
      unitsSold: 5,
    });
  });

  it('honours topN', async () => {
    const result = await getSalesByProduct(warehousePath, {}, 1);

    expect(result.topProducts).toHaveLength(1);
    // Categories are not limited by topN — only the product ranking is.
    expect(result.categories).toHaveLength(2);
  });

  it('still reports a retired product that has historical sales', async () => {
    const result = await getSalesByProduct(warehousePath);

    // GROC-0001 is inactive. Dropping it would make past revenue disappear the
    // moment a product is withdrawn.
    expect(result.topProducts.some((product) => product.sku === 'GROC-0001')).toBe(true);
  });
});

describe('sales by city', () => {
  it('groups revenue by city, highest first', async () => {
    const result = await getSalesByCity(warehousePath);

    expect(result.cities).toEqual([
      // 2700.00 + 800.00
      { city: 'Kochi', state: 'Kerala', revenue: 3500, orderCount: 1, customerCount: 1 },
      // 2000.00 + 250.50
      { city: 'Pune', state: 'Maharashtra', revenue: 2250.5, orderCount: 1, customerCount: 1 },
    ]);
  });
});

describe('daily sales', () => {
  it('includes a zero for a day with no sales', async () => {
    const result = await getDailySales(warehousePath);

    // 2026-03-02 has no facts. It must appear as a zero, or the chart would jump
    // straight from the 1st to the 3rd and misrepresent the trend.
    expect(result.series).toEqual([
      { date: '2026-03-01', revenue: 2250.5, orderCount: 1, unitsSold: 3 },
      { date: '2026-03-02', revenue: 0, orderCount: 0, unitsSold: 0 },
      { date: '2026-03-03', revenue: 3500, orderCount: 1, unitsSold: 7 },
    ]);
  });

  it('is ascending by date', async () => {
    const result = await getDailySales(warehousePath);
    const dates = result.series.map((point) => point.date);

    expect([...dates].sort()).toEqual(dates);
  });

  it('sums to the revenue summary total', async () => {
    const [series, summary] = await Promise.all([
      getDailySales(warehousePath),
      getRevenueSummary(warehousePath),
    ]);

    const summed = series.series.reduce((total, point) => total + point.revenue, 0);

    // Two endpoints disagreeing about the same sales would be the worst kind of
    // bug: both look plausible in isolation.
    expect(summed).toBe(summary.totalRevenue);
  });
});

describe('when no warehouse has been published', () => {
  const missing = path.join(tmpdir(), 'definitely-absent', 'sales.duckdb');

  it('reports revenue as not ready, with zeros', async () => {
    const summary = await getRevenueSummary(missing);

    expect(summary.warehouseReady).toBe(false);
    expect(summary.generatedAt).toBeNull();
    expect(summary).toMatchObject({
      totalRevenue: 0,
      orderCount: 0,
      customerCount: 0,
      unitsSold: 0,
      averageOrderValue: 0,
    });
  });

  it('returns empty collections rather than failing', async () => {
    const [product, city, daily] = await Promise.all([
      getSalesByProduct(missing),
      getSalesByCity(missing),
      getDailySales(missing),
    ]);

    expect(product).toMatchObject({ warehouseReady: false, categories: [], topProducts: [] });
    expect(city).toMatchObject({ warehouseReady: false, cities: [] });
    expect(daily).toMatchObject({ warehouseReady: false, series: [] });
  });

  it('echoes the requested range so a chart can still label itself', async () => {
    const summary = await getRevenueSummary(missing, { from: '2026-01-01', to: '2026-06-30' });

    expect(summary.range).toEqual({ from: '2026-01-01', to: '2026-06-30' });
  });

  it('treats a zero-byte file as unpublished, not as a corrupt warehouse', async () => {
    const empty = path.join(workDir, 'empty.duckdb');
    await writeFile(empty, '');

    // A failed publish can leave one behind; it is indistinguishable from
    // "no pipeline has run" as far as a caller is concerned.
    expect((await getRevenueSummary(empty)).warehouseReady).toBe(false);
  });

  it('treats a non-DuckDB file as unpublished rather than throwing', async () => {
    const garbage = path.join(workDir, 'garbage.duckdb');
    await writeFile(garbage, 'this is not a database');

    expect((await getRevenueSummary(garbage)).warehouseReady).toBe(false);
  });
});
