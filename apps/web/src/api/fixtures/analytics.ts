import { shiftIsoDate } from '../../lib/format';
import type {
  CategorySales,
  CitySales,
  DailySales,
  DailySalesPoint,
  DateRangeQuery,
  Order,
  RevenueSummary,
  SalesByCity,
  SalesByProduct,
  TopProduct,
  WarehouseMeta,
} from '../types';
import type { WarehouseSnapshot } from './warehouse';

/**
 * Warehouse aggregates, derived from the published snapshot the way the DuckDB
 * queries will derive them from `fact_sales`.
 *
 * The zero-valued exports below are the `warehouseReady: false` responses. They
 * are the shape the real API returns before any pipeline run: every measure 0,
 * every array empty, and explicitly *not* an error.
 */

const UNREADY: WarehouseMeta = {
  warehouseReady: false,
  generatedAt: null,
  range: { from: null, to: null },
};

export const EMPTY_REVENUE: RevenueSummary = {
  ...UNREADY,
  totalRevenue: 0,
  orderCount: 0,
  customerCount: 0,
  unitsSold: 0,
  averageOrderValue: 0,
};

export const EMPTY_SALES_BY_PRODUCT: SalesByProduct = {
  ...UNREADY,
  categories: [],
  topProducts: [],
};

export const EMPTY_SALES_BY_CITY: SalesByCity = { ...UNREADY, cities: [] };

export const EMPTY_DAILY_SALES: DailySales = { ...UNREADY, series: [] };

/** Guard against a hand-typed range asking for a thousand years of days. */
const MAX_SERIES_DAYS = 1_500;

interface ResolvedRange {
  readonly from: string;
  readonly to: string;
}

function resolveRange(snapshot: WarehouseSnapshot, query: DateRangeQuery): ResolvedRange {
  return {
    from: query.from ?? snapshot.range.from,
    to: query.to ?? snapshot.range.to,
  };
}

function metaFor(snapshot: WarehouseSnapshot, range: ResolvedRange): WarehouseMeta {
  return {
    warehouseReady: true,
    generatedAt: snapshot.publishedAt,
    range: { from: range.from, to: range.to },
  };
}

function ordersInRange(snapshot: WarehouseSnapshot, range: ResolvedRange): readonly Order[] {
  return snapshot.orders.filter(
    (order) => order.orderDate >= range.from && order.orderDate <= range.to,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function unitsIn(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function deriveRevenue(
  snapshot: WarehouseSnapshot,
  query: DateRangeQuery,
): RevenueSummary {
  const range = resolveRange(snapshot, query);
  const orders = ordersInRange(snapshot, range);

  const totalRevenue = round2(orders.reduce((sum, order) => sum + order.orderTotal, 0));
  const unitsSold = orders.reduce((sum, order) => sum + unitsIn(order), 0);
  const customers = new Set(orders.map((order) => order.customerId));

  return {
    ...metaFor(snapshot, range),
    totalRevenue,
    orderCount: orders.length,
    customerCount: customers.size,
    unitsSold,
    // Guarded division, exactly as the contract documents it.
    averageOrderValue: orders.length === 0 ? 0 : round2(totalRevenue / orders.length),
  };
}

export function deriveSalesByProduct(
  snapshot: WarehouseSnapshot,
  query: DateRangeQuery & { topN?: number },
): SalesByProduct {
  const range = resolveRange(snapshot, query);
  const orders = ordersInRange(snapshot, range);
  const topN = query.topN ?? 10;

  interface CategoryAccumulator extends CategorySales {
    orders: Set<string>;
  }
  interface ProductAccumulator extends TopProduct {
    orders: Set<string>;
  }

  const byCategory = new Map<string, CategoryAccumulator>();
  const byProduct = new Map<string, ProductAccumulator>();

  for (const order of orders) {
    for (const item of order.items) {
      const category = categoryOf(snapshot, item.productId) ?? 'Uncategorised';

      const categoryRow = byCategory.get(category) ?? {
        category,
        revenue: 0,
        unitsSold: 0,
        orderCount: 0,
        orders: new Set<string>(),
      };
      categoryRow.revenue += item.lineTotal;
      categoryRow.unitsSold += item.quantity;
      categoryRow.orders.add(order.id);
      byCategory.set(category, categoryRow);

      const productRow = byProduct.get(item.productId) ?? {
        productId: item.productId,
        sku: item.sku,
        name: item.productName,
        category,
        revenue: 0,
        unitsSold: 0,
        orders: new Set<string>(),
      };
      productRow.revenue += item.lineTotal;
      productRow.unitsSold += item.quantity;
      productRow.orders.add(order.id);
      byProduct.set(item.productId, productRow);
    }
  }

  const categories: CategorySales[] = [...byCategory.values()]
    .map(({ orders: distinct, revenue, ...rest }) => ({
      ...rest,
      revenue: round2(revenue),
      orderCount: distinct.size,
    }))
    .sort((left, right) => right.revenue - left.revenue);

  const topProducts: TopProduct[] = [...byProduct.values()]
    .map(({ orders: _orders, revenue, ...rest }) => ({ ...rest, revenue: round2(revenue) }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, topN);

  return { ...metaFor(snapshot, range), categories, topProducts };
}

/**
 * `fact_sales` joins `dim_product` for the category, so the fixture resolves it
 * from the product rather than trusting a value copied onto the line item.
 */
function categoryOf(snapshot: WarehouseSnapshot, productId: string): string | undefined {
  categoryIndex ??= buildCategoryIndex(snapshot);
  return categoryIndex.get(productId);
}

let categoryIndex: Map<string, string> | undefined;

function buildCategoryIndex(snapshot: WarehouseSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  for (const order of snapshot.orders) {
    for (const item of order.items) {
      if (!index.has(item.productId)) index.set(item.productId, skuCategory(item.sku));
    }
  }
  return index;
}

/** SKU prefixes carry the category in this dataset, as they do in the seed. */
const SKU_CATEGORIES: Readonly<Record<string, string>> = {
  ELEC: 'Electronics',
  HOME: 'Home & Kitchen',
  FASH: 'Fashion',
  GROC: 'Grocery',
  BEAU: 'Beauty',
  SPRT: 'Sports & Fitness',
  BOOK: 'Books',
  TOYS: 'Toys & Games',
  STAT: 'Stationery',
  CARE: 'Personal Care',
};

function skuCategory(sku: string): string {
  return SKU_CATEGORIES[sku.split('-')[0] ?? ''] ?? 'Uncategorised';
}

export function deriveSalesByCity(
  snapshot: WarehouseSnapshot,
  query: DateRangeQuery,
): SalesByCity {
  const range = resolveRange(snapshot, query);
  const orders = ordersInRange(snapshot, range);

  const locations = new Map(
    snapshot.customers.map((customer) => [
      customer.id,
      { city: customer.city, state: customer.state },
    ]),
  );

  interface CityAccumulator extends CitySales {
    customers: Set<string>;
  }

  const byCity = new Map<string, CityAccumulator>();

  for (const order of orders) {
    const location = locations.get(order.customerId);
    if (!location) continue;

    const key = `${location.city}|${location.state}`;
    const row = byCity.get(key) ?? {
      city: location.city,
      state: location.state,
      revenue: 0,
      orderCount: 0,
      customerCount: 0,
      customers: new Set<string>(),
    };

    row.revenue += order.orderTotal;
    row.orderCount += 1;
    row.customers.add(order.customerId);
    byCity.set(key, row);
  }

  const cities: CitySales[] = [...byCity.values()]
    .map(({ customers, revenue, ...rest }) => ({
      ...rest,
      revenue: round2(revenue),
      customerCount: customers.size,
    }))
    .sort((left, right) => right.revenue - left.revenue);

  return { ...metaFor(snapshot, range), cities };
}

export function deriveDailySales(
  snapshot: WarehouseSnapshot,
  query: DateRangeQuery,
): DailySales {
  const range = resolveRange(snapshot, query);
  const orders = ordersInRange(snapshot, range);

  const byDate = new Map<string, DailySalesPoint>();
  for (const order of orders) {
    const row = byDate.get(order.orderDate) ?? {
      date: order.orderDate,
      revenue: 0,
      orderCount: 0,
      unitsSold: 0,
    };

    row.revenue += order.orderTotal;
    row.orderCount += 1;
    row.unitsSold += unitsIn(order);
    byDate.set(order.orderDate, row);
  }

  // Gap-filled from the calendar, the way the real query joins `dim_date`: a day
  // with no sales is a zero, never a missing point.
  const series: DailySalesPoint[] = [];
  let cursor = range.from;

  for (let day = 0; day <= MAX_SERIES_DAYS && cursor <= range.to; day += 1) {
    const row = byDate.get(cursor);
    series.push(
      row
        ? { ...row, revenue: round2(row.revenue) }
        : { date: cursor, revenue: 0, orderCount: 0, unitsSold: 0 },
    );
    cursor = shiftIsoDate(cursor, 1);
  }

  return { ...metaFor(snapshot, range), series };
}

/** Test seam: the category index is memoised across snapshots. */
export function resetAnalyticsCache(): void {
  categoryIndex = undefined;
}
