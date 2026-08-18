import {
  openWarehouse,
  toMoney,
  toNumber,
  type WarehouseHandle,
  type WarehouseParam,
} from './connection.js';

/**
 * Warehouse-backed analytics.
 *
 * Every query casts explicitly: `::integer` for counts, `::double` for money,
 * `strftime` for dates. Left uncast, DuckDB returns `bigint` (which
 * `JSON.stringify` throws on), `DECIMAL` as `{value, scale}`, and `DATE` as
 * `{days}` — all of which would fail at serialisation time rather than here.
 *
 * No PostgreSQL import appears in this file, and an architecture test enforces
 * that. When there is no warehouse, these return zeros with
 * `warehouseReady: false` rather than substituting operational data.
 */

export interface WarehouseMeta {
  warehouseReady: boolean;
  generatedAt: string | null;
  range: { from: string | null; to: string | null };
}

export interface RevenueSummary extends WarehouseMeta {
  totalRevenue: number;
  orderCount: number;
  customerCount: number;
  unitsSold: number;
  averageOrderValue: number;
}

export interface CategoryTotal {
  category: string;
  revenue: number;
  unitsSold: number;
  orderCount: number;
}

export interface TopProduct {
  productId: string;
  sku: string;
  name: string;
  category: string;
  revenue: number;
  unitsSold: number;
}

export interface SalesByProduct extends WarehouseMeta {
  categories: CategoryTotal[];
  topProducts: TopProduct[];
}

export interface CityTotal {
  city: string;
  state: string;
  revenue: number;
  orderCount: number;
  customerCount: number;
}

export interface SalesByCity extends WarehouseMeta {
  cities: CityTotal[];
}

export interface DailyPoint {
  date: string;
  revenue: number;
  orderCount: number;
  unitsSold: number;
}

export interface DailySales extends WarehouseMeta {
  series: DailyPoint[];
}

export interface AnalyticsRange {
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Restrict facts to the requested window.
 *
 * `$1 is null or …` keeps one prepared statement for every filter combination
 * instead of concatenating SQL per case.
 */
const DATE_FILTER = `($1 is null or d.full_date >= $1::date)
                 and ($2 is null or d.full_date <= $2::date)`;

function params(range: AnalyticsRange): WarehouseParam[] {
  return [range.from ?? null, range.to ?? null];
}

function emptyMeta(range: AnalyticsRange): WarehouseMeta {
  return {
    warehouseReady: false,
    generatedAt: null,
    range: { from: range.from ?? null, to: range.to ?? null },
  };
}

/**
 * Report the window actually covered.
 *
 * Defaults to the extent of the facts in range rather than echoing the request,
 * so a chart can label itself honestly when the caller passed no bounds.
 */
async function resolveMeta(
  warehouse: WarehouseHandle,
  range: AnalyticsRange,
): Promise<WarehouseMeta> {
  const rows = await warehouse.query<{ from_date: string | null; to_date: string | null }>(
    `select strftime(min(d.full_date), '%Y-%m-%d') as from_date,
            strftime(max(d.full_date), '%Y-%m-%d') as to_date
       from fact_sales f
       join dim_date d on d.date_key = f.date_key
      where ${DATE_FILTER}`,
    params(range),
  );

  const row = rows[0];

  return {
    warehouseReady: true,
    generatedAt: warehouse.publishedAt,
    range: {
      from: row?.from_date ?? range.from ?? null,
      to: row?.to_date ?? range.to ?? null,
    },
  };
}

export async function getRevenueSummary(
  warehousePath: string,
  range: AnalyticsRange = {},
): Promise<RevenueSummary> {
  const warehouse = await openWarehouse(warehousePath);

  if (!warehouse) {
    return {
      ...emptyMeta(range),
      totalRevenue: 0,
      orderCount: 0,
      customerCount: 0,
      unitsSold: 0,
      averageOrderValue: 0,
    };
  }

  const rows = await warehouse.query<Record<string, unknown>>(
    `select round(coalesce(sum(f.revenue), 0), 2)::double as total_revenue,
            count(distinct f.order_id)::integer            as order_count,
            count(distinct f.customer_key)::integer        as customer_count,
            coalesce(sum(f.quantity), 0)::integer          as units_sold
       from fact_sales f
       join dim_date d on d.date_key = f.date_key
      where ${DATE_FILTER}`,
    params(range),
  );

  const row = rows[0] ?? {};
  const totalRevenue = toMoney(row.total_revenue);
  const orderCount = toNumber(row.order_count);

  return {
    ...(await resolveMeta(warehouse, range)),
    totalRevenue,
    orderCount,
    customerCount: toNumber(row.customer_count),
    unitsSold: toNumber(row.units_sold),
    // Guard the divide rather than publishing NaN for an empty window.
    averageOrderValue: orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0,
  };
}

export async function getSalesByProduct(
  warehousePath: string,
  range: AnalyticsRange = {},
  topN = 10,
): Promise<SalesByProduct> {
  const warehouse = await openWarehouse(warehousePath);

  if (!warehouse) {
    return { ...emptyMeta(range), categories: [], topProducts: [] };
  }

  const categories = await warehouse.query<Record<string, unknown>>(
    `select p.category,
            round(sum(f.revenue), 2)::double     as revenue,
            sum(f.quantity)::integer             as units_sold,
            count(distinct f.order_id)::integer  as order_count
       from fact_sales f
       join dim_product p on p.product_key = f.product_key
       join dim_date    d on d.date_key    = f.date_key
      where ${DATE_FILTER}
      group by p.category
      order by sum(f.revenue) desc`,
    params(range),
  );

  const topProducts = await warehouse.query<Record<string, unknown>>(
    `select p.product_id,
            p.sku,
            p.name,
            p.category,
            round(sum(f.revenue), 2)::double as revenue,
            sum(f.quantity)::integer        as units_sold
       from fact_sales f
       join dim_product p on p.product_key = f.product_key
       join dim_date    d on d.date_key    = f.date_key
      where ${DATE_FILTER}
      group by p.product_id, p.sku, p.name, p.category
      order by sum(f.revenue) desc
      limit $3`,
    [...params(range), topN],
  );

  return {
    ...(await resolveMeta(warehouse, range)),
    categories: categories.map((row) => ({
      category: String(row.category),
      revenue: toMoney(row.revenue),
      unitsSold: toNumber(row.units_sold),
      orderCount: toNumber(row.order_count),
    })),
    topProducts: topProducts.map((row) => ({
      productId: String(row.product_id),
      sku: String(row.sku),
      name: String(row.name),
      category: String(row.category),
      revenue: toMoney(row.revenue),
      unitsSold: toNumber(row.units_sold),
    })),
  };
}

export async function getSalesByCity(
  warehousePath: string,
  range: AnalyticsRange = {},
): Promise<SalesByCity> {
  const warehouse = await openWarehouse(warehousePath);

  if (!warehouse) {
    return { ...emptyMeta(range), cities: [] };
  }

  const cities = await warehouse.query<Record<string, unknown>>(
    `select c.city,
            c.state,
            round(sum(f.revenue), 2)::double       as revenue,
            count(distinct f.order_id)::integer    as order_count,
            count(distinct f.customer_key)::integer as customer_count
       from fact_sales f
       join dim_customer c on c.customer_key = f.customer_key
       join dim_date     d on d.date_key     = f.date_key
      where ${DATE_FILTER}
      group by c.city, c.state
      order by sum(f.revenue) desc`,
    params(range),
  );

  return {
    ...(await resolveMeta(warehouse, range)),
    cities: cities.map((row) => ({
      city: String(row.city),
      state: String(row.state),
      revenue: toMoney(row.revenue),
      orderCount: toNumber(row.order_count),
      customerCount: toNumber(row.customer_count),
    })),
  };
}

export async function getDailySales(
  warehousePath: string,
  range: AnalyticsRange = {},
): Promise<DailySales> {
  const warehouse = await openWarehouse(warehousePath);

  if (!warehouse) {
    return { ...emptyMeta(range), series: [] };
  }

  // Driven from dim_date with a LEFT JOIN, so a day without sales appears as a
  // zero instead of vanishing from the series. An inner join here would make the
  // chart silently skip quiet days and misrepresent a trend.
  const series = await warehouse.query<Record<string, unknown>>(
    `select strftime(d.full_date, '%Y-%m-%d')             as date,
            round(coalesce(sum(f.revenue), 0), 2)::double as revenue,
            count(distinct f.order_id)::integer           as order_count,
            coalesce(sum(f.quantity), 0)::integer         as units_sold
       from dim_date d
       left join fact_sales f on f.date_key = d.date_key
      where ${DATE_FILTER}
      group by d.full_date
      order by d.full_date`,
    params(range),
  );

  return {
    ...(await resolveMeta(warehouse, range)),
    series: series.map((row) => ({
      date: String(row.date),
      revenue: toMoney(row.revenue),
      orderCount: toNumber(row.order_count),
      unitsSold: toNumber(row.units_sold),
    })),
  };
}
