/**
 * Transcribed from docs/api/openapi.yaml, which is the source of truth.
 *
 * Optionality here mirrors each schema's `required` list rather than what the
 * live API happens to send today. Three fields are looser than a reading of the
 * brief's summary suggests, and the UI must survive their absence:
 *
 *   - `Order.customerName` is not required.
 *   - `WarehouseMeta.generatedAt` and `.range` are optional *and* nullable.
 *   - Every `PipelineRun.rowCounts` key is optional.
 */

export interface Pagination {
  limit: number;
  offset: number;
  total: number;
}

export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

// ── Operational ──────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  email: string;
  city: string;
  state: string;
  createdAt: string;
}

export interface CustomerCreate {
  name: string;
  email: string;
  city: string;
  state: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  active: boolean;
  createdAt: string;
}

export interface ProductCreate {
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  active?: boolean;
}

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface OrderItem {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPriceAtSale: number;
  lineTotal: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName?: string;
  orderDate: string;
  status: OrderStatus;
  items: OrderItem[];
  itemCount: number;
  orderTotal: number;
  createdAt: string;
}

export interface OrderItemCreate {
  productId: string;
  quantity: number;
  unitPriceAtSale?: number;
}

export interface OrderCreate {
  customerId: string;
  orderDate?: string;
  status?: OrderStatus;
  items: OrderItemCreate[];
}

// ── Query parameters ─────────────────────────────────────────────────────────

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export interface ProductQuery extends PageQuery {
  category?: string;
  active?: boolean;
}

export interface OrderQuery extends PageQuery {
  customerId?: string;
  status?: OrderStatus;
  from?: string;
  to?: string;
}

export interface DateRangeQuery {
  from?: string;
  to?: string;
}

export interface SalesByProductQuery extends DateRangeQuery {
  topN?: number;
}

// ── Analytics (DuckDB warehouse) ─────────────────────────────────────────────

export interface WarehouseMeta {
  warehouseReady: boolean;
  generatedAt?: string | null;
  range?: {
    from?: string | null;
    to?: string | null;
  };
}

export interface RevenueSummary extends WarehouseMeta {
  totalRevenue: number;
  orderCount: number;
  customerCount: number;
  unitsSold: number;
  averageOrderValue: number;
}

export interface CategorySales {
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
  categories: CategorySales[];
  topProducts: TopProduct[];
}

export interface CitySales {
  city: string;
  state: string;
  revenue: number;
  orderCount: number;
  customerCount: number;
}

export interface SalesByCity extends WarehouseMeta {
  cities: CitySales[];
}

export interface DailySalesPoint {
  date: string;
  revenue: number;
  orderCount: number;
  unitsSold: number;
}

export interface DailySales extends WarehouseMeta {
  /** Ascending and gap-filled from `dim_date`; plot as given. */
  series: DailySalesPoint[];
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

export type PipelineRunStatus = 'running' | 'succeeded' | 'failed';

export interface PipelineRowCounts {
  customers?: number;
  products?: number;
  orders?: number;
  orderItems?: number;
  factSales?: number;
}

export interface PipelineRun {
  runId: string;
  status: PipelineRunStatus;
  startedAt: string;
  completedAt?: string | null;
  durationSeconds?: number | null;
  lakePrefix?: string | null;
  rowCounts?: PipelineRowCounts;
  errorSummary?: string | null;
}

export interface PipelineStatus {
  current: PipelineRun | null;
  lastSuccessful: PipelineRun | null;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface DependencyState {
  status: 'up' | 'down' | 'unknown';
  detail?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  dependencies: {
    postgres: DependencyState;
    warehouse: DependencyState;
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'validation_failed'
  | 'not_found'
  | 'conflict'
  | 'customer_not_found'
  | 'product_not_found'
  | 'product_inactive'
  | 'internal_error';

export interface ValidationIssue {
  path: string;
  message: string;
}
