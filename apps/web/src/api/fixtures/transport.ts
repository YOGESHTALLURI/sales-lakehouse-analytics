import { todayIso } from '../../lib/format';
import { API_PATHS } from '../endpoints';
import { ApiRequestError, type QueryParams, type Transport } from '../http';
import type {
  Customer,
  HealthReport,
  Order,
  OrderItem,
  OrderStatus,
  Page,
  Product,
  ValidationIssue,
} from '../types';
import { ORDER_STATUSES } from '../types';
import {
  deriveDailySales,
  deriveRevenue,
  deriveSalesByCity,
  deriveSalesByProduct,
  EMPTY_DAILY_SALES,
  EMPTY_REVENUE,
  EMPTY_SALES_BY_CITY,
  EMPTY_SALES_BY_PRODUCT,
  resetAnalyticsCache,
} from './analytics';
import { getDataset, resetDataset } from './dataset';
import { getPipelineStatus, resetPipeline, seedSucceededRun, startPipelineRun } from './pipeline';
import { getScenario } from './scenario';
import { getSnapshot, resetWarehouse } from './warehouse';

/**
 * The fixture half of the transport seam.
 *
 * It answers the same paths with the same shapes and the same failures as the
 * API, including per-field `issues[]`, duplicate conflicts and the documented
 * order-creation errors. Anything the UI relies on here it can rely on when
 * `VITE_API_FIXTURES=0`; anything that only works here is drift.
 */

// Enough delay to make loading states visible while developing, and none at all
// under test, where a fake clock would otherwise have to be threaded everywhere.
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 240;

function delay(signal: AbortSignal | undefined): Promise<void> {
  if (LATENCY_MS === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, LATENCY_MS);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readNumber(params: QueryParams | undefined, key: string): number | undefined {
  const raw = params?.[key];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readString(params: QueryParams | undefined, key: string): string | undefined {
  const raw = params?.[key];
  return raw === undefined ? undefined : String(raw);
}

function paginate<T>(rows: readonly T[], params: QueryParams | undefined): Page<T> {
  const limit = readNumber(params, 'limit') ?? 50;
  const offset = readNumber(params, 'offset') ?? 0;

  return {
    data: rows.slice(offset, offset + limit),
    pagination: { limit, offset, total: rows.length },
  };
}

function unavailable(): never {
  throw new ApiRequestError(
    500,
    'internal_error',
    'The warehouse could not be read. Check the API logs.',
  );
}

// ── Validation ───────────────────────────────────────────────────────────────

function requireText(
  issues: ValidationIssue[],
  value: unknown,
  path: string,
  maxLength: number,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ path, message: 'This field is required.' });
    return '';
  }
  if (value.length > maxLength) {
    issues.push({ path, message: `Must be ${maxLength} characters or fewer.` });
  }
  return value.trim();
}

function failIfInvalid(issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new ApiRequestError(400, 'validation_failed', 'Request validation failed.', issues);
  }
}

function asRecord(body: unknown): Readonly<Record<string, unknown>> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function newId(prefix: string): string {
  const random = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const counter = String(created).padStart(4, '0');
  created += 1;
  return `${random}-${counter}-4c1a-9b2d-${prefix.padEnd(12, '0').slice(0, 12)}`;
}

let created = 0;

// ── Mutations ────────────────────────────────────────────────────────────────

function createCustomer(body: unknown): Customer {
  const input = asRecord(body);
  const issues: ValidationIssue[] = [];

  const name = requireText(issues, input.name, 'name', 120);
  const email = requireText(issues, input.email, 'email', 200);
  const city = requireText(issues, input.city, 'city', 80);
  const state = requireText(issues, input.state, 'state', 80);

  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    issues.push({ path: 'email', message: 'Enter a valid email address.' });
  }

  failIfInvalid(issues);

  const dataset = getDataset();
  const taken = dataset.customers.some(
    (customer) => customer.email.toLowerCase() === email.toLowerCase(),
  );
  if (taken) {
    throw new ApiRequestError(409, 'conflict', 'A customer with that email already exists.');
  }

  const customer: Customer = {
    id: newId('customer'),
    name,
    email,
    city,
    state,
    createdAt: new Date().toISOString(),
  };

  dataset.customers.unshift(customer);
  return customer;
}

function createProduct(body: unknown): Product {
  const input = asRecord(body);
  const issues: ValidationIssue[] = [];

  const sku = requireText(issues, input.sku, 'sku', 40);
  const name = requireText(issues, input.name, 'name', 160);
  const category = requireText(issues, input.category, 'category', 80);

  const unitPrice = Number(input.unitPrice);
  if (input.unitPrice === undefined || input.unitPrice === '' || Number.isNaN(unitPrice)) {
    issues.push({ path: 'unitPrice', message: 'Enter a price.' });
  } else if (unitPrice < 0) {
    issues.push({ path: 'unitPrice', message: 'Must be zero or more.' });
  }

  failIfInvalid(issues);

  const dataset = getDataset();
  if (dataset.products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
    throw new ApiRequestError(409, 'conflict', 'A product with that SKU already exists.');
  }

  const product: Product = {
    id: newId('product'),
    sku,
    name,
    category,
    unitPrice: Math.round(unitPrice * 100) / 100,
    active: input.active === undefined ? true : Boolean(input.active),
    createdAt: new Date().toISOString(),
  };

  dataset.products.unshift(product);
  return product;
}

function createOrder(body: unknown): Order {
  const input = asRecord(body);
  const issues: ValidationIssue[] = [];
  const dataset = getDataset();

  const customerId = typeof input.customerId === 'string' ? input.customerId : '';
  if (customerId === '') issues.push({ path: 'customerId', message: 'Choose a customer.' });

  const orderDate = typeof input.orderDate === 'string' ? input.orderDate : todayIso();
  if (orderDate > todayIso()) {
    issues.push({ path: 'orderDate', message: 'The order date may not be in the future.' });
  }

  const status: OrderStatus = ORDER_STATUSES.find((candidate) => candidate === input.status)
    ?? 'pending';

  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0) {
    issues.push({ path: 'items', message: 'Add at least one product.' });
  }
  if (rawItems.length > 50) {
    issues.push({ path: 'items', message: 'An order may not exceed 50 lines.' });
  }

  const seenProducts = new Set<string>();
  rawItems.forEach((raw, index) => {
    const item = asRecord(raw);
    const productId = typeof item.productId === 'string' ? item.productId : '';
    const quantity = Number(item.quantity);

    if (productId === '') {
      issues.push({ path: `items.${index}.productId`, message: 'Choose a product.' });
    } else if (seenProducts.has(productId)) {
      issues.push({
        path: `items.${index}.productId`,
        message: 'This product is already on the order. Increase its quantity instead.',
      });
    }
    seenProducts.add(productId);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      issues.push({
        path: `items.${index}.quantity`,
        message: 'Enter a whole number between 1 and 1000.',
      });
    }
  });

  failIfInvalid(issues);

  const customer = dataset.customers.find((candidate) => candidate.id === customerId);
  if (!customer) {
    throw new ApiRequestError(404, 'customer_not_found', 'That customer no longer exists.');
  }

  const items: OrderItem[] = rawItems.map((raw) => {
    const item = asRecord(raw);
    const productId = String(item.productId);
    const product = dataset.products.find((candidate) => candidate.id === productId);

    if (!product) {
      throw new ApiRequestError(404, 'product_not_found', 'One of those products no longer exists.');
    }
    if (!product.active) {
      throw new ApiRequestError(
        409,
        'product_inactive',
        `${product.name} has been retired and cannot be added to a new order.`,
      );
    }

    const quantity = Number(item.quantity);
    // The server captures the catalogue price when the client omits it, so the
    // fixture must too — otherwise the form appears to work and then does not.
    const unitPriceAtSale =
      item.unitPriceAtSale === undefined ? product.unitPrice : Number(item.unitPriceAtSale);

    return {
      id: newId('item'),
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      quantity,
      unitPriceAtSale,
      lineTotal: Math.round(unitPriceAtSale * quantity * 100) / 100,
    };
  });

  const order: Order = {
    id: newId('order'),
    customerId: customer.id,
    customerName: customer.name,
    orderDate,
    status,
    items,
    itemCount: items.length,
    orderTotal: Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100,
    createdAt: new Date().toISOString(),
  };

  dataset.orders.unshift(order);
  return order;
}

// ── Routing ──────────────────────────────────────────────────────────────────

function health(): HealthReport {
  const snapshot = getSnapshot();

  return {
    status: 'ok',
    service: 'sales-lakehouse-api',
    version: '0.1.0',
    uptimeSeconds: 2098.2,
    dependencies: {
      postgres: { status: 'up' },
      warehouse: snapshot
        ? { status: 'up' }
        : { status: 'down', detail: 'warehouse not published yet; run the pipeline' },
    },
  };
}

function listProducts(params: QueryParams | undefined): Page<Product> {
  const category = readString(params, 'category');
  const active = readString(params, 'active');

  const rows = getDataset().products.filter((product) => {
    if (category !== undefined && product.category !== category) return false;
    if (active !== undefined && product.active !== (active === 'true')) return false;
    return true;
  });

  return paginate(rows, params);
}

function listOrders(params: QueryParams | undefined): Page<Order> {
  const customerId = readString(params, 'customerId');
  const status = readString(params, 'status');
  const from = readString(params, 'from');
  const to = readString(params, 'to');

  if (from !== undefined && to !== undefined && from > to) {
    throw new ApiRequestError(400, 'validation_failed', 'Request validation failed.', [
      { path: 'from', message: 'The start of the range is after its end.' },
    ]);
  }

  const rows = getDataset().orders.filter((order) => {
    if (customerId !== undefined && order.customerId !== customerId) return false;
    if (status !== undefined && order.status !== status) return false;
    if (from !== undefined && order.orderDate < from) return false;
    if (to !== undefined && order.orderDate > to) return false;
    return true;
  });

  return paginate(rows, params);
}

function handleGet(path: string, params: QueryParams | undefined): unknown {
  const analyticsFails = getScenario() === 'error';

  switch (path) {
    case API_PATHS.health:
      return health();

    case API_PATHS.customers:
      return paginate(getDataset().customers, params);

    case API_PATHS.products:
      return listProducts(params);

    case API_PATHS.orders:
      return listOrders(params);

    case API_PATHS.pipelineStatus: {
      if (analyticsFails) unavailable();
      const snapshot = getSnapshot();
      if (snapshot) seedSucceededRun(snapshot.publishedAt);
      return getPipelineStatus();
    }

    case API_PATHS.revenue: {
      if (analyticsFails) unavailable();
      const snapshot = getSnapshot();
      return snapshot
        ? deriveRevenue(snapshot, { from: readString(params, 'from'), to: readString(params, 'to') })
        : EMPTY_REVENUE;
    }

    case API_PATHS.salesByProduct: {
      if (analyticsFails) unavailable();
      const snapshot = getSnapshot();
      return snapshot
        ? deriveSalesByProduct(snapshot, {
            from: readString(params, 'from'),
            to: readString(params, 'to'),
            topN: readNumber(params, 'topN'),
          })
        : EMPTY_SALES_BY_PRODUCT;
    }

    case API_PATHS.salesByCity: {
      if (analyticsFails) unavailable();
      const snapshot = getSnapshot();
      return snapshot
        ? deriveSalesByCity(snapshot, {
            from: readString(params, 'from'),
            to: readString(params, 'to'),
          })
        : EMPTY_SALES_BY_CITY;
    }

    case API_PATHS.dailySales: {
      if (analyticsFails) unavailable();
      const snapshot = getSnapshot();
      return snapshot
        ? deriveDailySales(snapshot, {
            from: readString(params, 'from'),
            to: readString(params, 'to'),
          })
        : EMPTY_DAILY_SALES;
    }

    default:
      throw new ApiRequestError(404, 'not_found', `No fixture handles GET ${path}.`);
  }
}

function handlePost(path: string, body: unknown): unknown {
  switch (path) {
    case API_PATHS.customers:
      return createCustomer(body);

    case API_PATHS.products:
      return createProduct(body);

    case API_PATHS.orders:
      return createOrder(body);

    case API_PATHS.pipelineRun:
      if (getScenario() === 'error') unavailable();
      return startPipelineRun();

    default:
      throw new ApiRequestError(404, 'not_found', `No fixture handles POST ${path}.`);
  }
}

export const fixtureTransport: Transport = {
  async get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    await delay(signal);
    return handleGet(path, params) as T;
  },

  async post<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    await delay(signal);
    return handlePost(path, body) as T;
  },
};

/** Test seam: forget every mutation, run and published snapshot. */
export function resetFixtures(): void {
  resetDataset();
  resetPipeline();
  resetWarehouse();
  resetAnalyticsCache();
  created = 0;
}
