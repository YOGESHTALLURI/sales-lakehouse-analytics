import { API_PATHS } from './endpoints';
import { fixtureTransport } from './fixtures/transport';
import { httpTransport, type QueryParams, type Transport } from './http';
import type {
  Customer,
  CustomerCreate,
  DailySales,
  DateRangeQuery,
  HealthReport,
  Order,
  OrderCreate,
  OrderQuery,
  Page,
  PageQuery,
  PipelineRun,
  PipelineStatus,
  Product,
  ProductCreate,
  ProductQuery,
  RevenueSummary,
  SalesByCity,
  SalesByProduct,
  SalesByProductQuery,
} from './types';

/**
 * The only module that talks to the API.
 *
 * Components call these functions; nothing else knows a path, a query-string
 * convention or an HTTP verb.
 */

/**
 * Fixtures are off unless explicitly requested. `/api/analytics/*` and
 * `/api/pipeline/*` are live now that Phases 3 and 4 are merged, so the default
 * is the real backend. Setting `VITE_API_FIXTURES=1` is the whole switch back to
 * fixtures — no other line changes.
 */
export const USING_FIXTURES = import.meta.env.VITE_API_FIXTURES === '1';

const transport: Transport = USING_FIXTURES ? fixtureTransport : httpTransport;

function pageParams(query: PageQuery): QueryParams {
  return { limit: query.limit, offset: query.offset };
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthReport> {
    return transport.get<HealthReport>(API_PATHS.health, undefined, signal);
  },

  // ── Operational ────────────────────────────────────────────────────────────

  listCustomers(query: PageQuery = {}, signal?: AbortSignal): Promise<Page<Customer>> {
    return transport.get<Page<Customer>>(API_PATHS.customers, pageParams(query), signal);
  },

  createCustomer(input: CustomerCreate, signal?: AbortSignal): Promise<Customer> {
    return transport.post<Customer>(API_PATHS.customers, input, signal);
  },

  listProducts(query: ProductQuery = {}, signal?: AbortSignal): Promise<Page<Product>> {
    return transport.get<Page<Product>>(
      API_PATHS.products,
      { ...pageParams(query), category: query.category, active: query.active },
      signal,
    );
  },

  createProduct(input: ProductCreate, signal?: AbortSignal): Promise<Product> {
    return transport.post<Product>(API_PATHS.products, input, signal);
  },

  listOrders(query: OrderQuery = {}, signal?: AbortSignal): Promise<Page<Order>> {
    return transport.get<Page<Order>>(
      API_PATHS.orders,
      {
        ...pageParams(query),
        customerId: query.customerId,
        status: query.status,
        from: query.from,
        to: query.to,
      },
      signal,
    );
  },

  createOrder(input: OrderCreate, signal?: AbortSignal): Promise<Order> {
    return transport.post<Order>(API_PATHS.orders, input, signal);
  },

  // ── Pipeline ───────────────────────────────────────────────────────────────

  runPipeline(signal?: AbortSignal): Promise<PipelineRun> {
    return transport.post<PipelineRun>(API_PATHS.pipelineRun, undefined, signal);
  },

  pipelineStatus(signal?: AbortSignal): Promise<PipelineStatus> {
    return transport.get<PipelineStatus>(API_PATHS.pipelineStatus, undefined, signal);
  },

  // ── Analytics (warehouse-backed) ───────────────────────────────────────────

  revenue(query: DateRangeQuery = {}, signal?: AbortSignal): Promise<RevenueSummary> {
    return transport.get<RevenueSummary>(API_PATHS.revenue, { ...query }, signal);
  },

  salesByProduct(
    query: SalesByProductQuery = {},
    signal?: AbortSignal,
  ): Promise<SalesByProduct> {
    return transport.get<SalesByProduct>(API_PATHS.salesByProduct, { ...query }, signal);
  },

  salesByCity(query: DateRangeQuery = {}, signal?: AbortSignal): Promise<SalesByCity> {
    return transport.get<SalesByCity>(API_PATHS.salesByCity, { ...query }, signal);
  },

  dailySales(query: DateRangeQuery = {}, signal?: AbortSignal): Promise<DailySales> {
    return transport.get<DailySales>(API_PATHS.dailySales, { ...query }, signal);
  },
} as const;
