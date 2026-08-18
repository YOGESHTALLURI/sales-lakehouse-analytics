import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { getDataset } from '../src/api/fixtures/dataset';
import { setScenario } from '../src/api/fixtures/scenario';
import { isApiRequestError } from '../src/api/http';

/**
 * The fixtures stand in for endpoints that do not exist yet, so what matters is
 * that they agree with docs/api/openapi.yaml — envelope shapes, documented error
 * codes, per-field `issues[]`, and the `warehouseReady: false` contract.
 *
 * Anything asserted here should hold identically once `VITE_API_FIXTURES=0`. If a
 * test starts failing against the real API, the fixtures drifted and this suite
 * is the thing that says so.
 */

async function expectApiError(
  promise: Promise<unknown>,
): Promise<{ status: number; code: string; issues: readonly { path: string; message: string }[] }> {
  try {
    await promise;
  } catch (error) {
    if (!isApiRequestError(error)) throw error;
    return { status: error.status, code: error.code, issues: error.issues };
  }

  throw new Error('Expected the request to fail, but it resolved.');
}

describe('list envelopes', () => {
  beforeEach(() => setScenario('ready'));

  it('returns data with the documented pagination envelope', async () => {
    const page = await api.listCustomers({ limit: 2, offset: 0 });

    expect(page.data).toHaveLength(2);
    expect(page.pagination).toEqual({ limit: 2, offset: 0, total: 501 });
  });

  it('paginates by offset without changing the total', async () => {
    const first = await api.listOrders({ limit: 5, offset: 0 });
    const second = await api.listOrders({ limit: 5, offset: 5 });

    expect(first.pagination.total).toBe(second.pagination.total);
    expect(first.data[0]?.id).not.toBe(second.data[0]?.id);
  });

  it('filters products to the active catalogue', async () => {
    const page = await api.listProducts({ limit: 200, active: true });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.every((product) => product.active)).toBe(true);
  });

  it('rejects a reversed date range on the field that is wrong', async () => {
    const failure = await expectApiError(
      api.listOrders({ from: '2026-08-18', to: '2026-01-01' }),
    );

    expect(failure.status).toBe(400);
    expect(failure.issues[0]?.path).toBe('from');
  });
});

describe('creating a customer', () => {
  beforeEach(() => setScenario('ready'));

  it('reports every invalid field, not just the first', async () => {
    const failure = await expectApiError(
      api.createCustomer({ name: '', email: 'not-an-email', city: '', state: '' }),
    );

    expect(failure.status).toBe(400);
    expect(failure.code).toBe('validation_failed');
    expect(failure.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['name', 'email', 'city', 'state']),
    );
  });

  it('rejects a duplicate email as a conflict, not a validation failure', async () => {
    const existing = getDataset().customers[0];
    expect(existing).toBeDefined();

    const failure = await expectApiError(
      api.createCustomer({
        name: 'Someone Else',
        // Compared case-insensitively, as the contract documents.
        email: existing!.email.toUpperCase(),
        city: 'Pune',
        state: 'Maharashtra',
      }),
    );

    expect(failure.status).toBe(409);
    expect(failure.code).toBe('conflict');
  });

  it('adds the created customer to the list', async () => {
    const created = await api.createCustomer({
      name: 'Test Person',
      email: 'test.person@example.com',
      city: 'Kochi',
      state: 'Kerala',
    });

    const page = await api.listCustomers({ limit: 1 });
    expect(page.data[0]?.id).toBe(created.id);
    expect(page.pagination.total).toBe(502);
  });
});

describe('creating an order', () => {
  beforeEach(() => setScenario('ready'));

  it('captures the catalogue price when the client omits it', async () => {
    const dataset = getDataset();
    const customer = dataset.customers[0]!;
    const product = dataset.products.find((candidate) => candidate.active)!;

    const order = await api.createOrder({
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 3 }],
    });

    expect(order.items[0]?.unitPriceAtSale).toBe(product.unitPrice);
    expect(order.items[0]?.lineTotal).toBeCloseTo(product.unitPrice * 3, 2);
    expect(order.orderTotal).toBeCloseTo(product.unitPrice * 3, 2);
  });

  it('rejects the same product twice, naming the offending line', async () => {
    const dataset = getDataset();
    const customer = dataset.customers[0]!;
    const product = dataset.products.find((candidate) => candidate.active)!;

    const failure = await expectApiError(
      api.createOrder({
        customerId: customer.id,
        items: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 2 },
        ],
      }),
    );

    expect(failure.status).toBe(400);
    expect(failure.issues.map((issue) => issue.path)).toContain('items.1.productId');
  });

  it('refuses a retired product with the documented conflict code', async () => {
    const dataset = getDataset();
    const customer = dataset.customers[0]!;
    const retired = dataset.products.find((candidate) => !candidate.active)!;

    const failure = await expectApiError(
      api.createOrder({ customerId: customer.id, items: [{ productId: retired.id, quantity: 1 }] }),
    );

    expect(failure.status).toBe(409);
    expect(failure.code).toBe('product_inactive');
  });

  it('refuses an unknown customer', async () => {
    const product = getDataset().products.find((candidate) => candidate.active)!;

    const failure = await expectApiError(
      api.createOrder({
        customerId: '00000000-0000-4000-8000-000000000000',
        items: [{ productId: product.id, quantity: 1 }],
      }),
    );

    expect(failure.status).toBe(404);
    expect(failure.code).toBe('customer_not_found');
  });

  it('rejects a future order date', async () => {
    const dataset = getDataset();
    const customer = dataset.customers[0]!;
    const product = dataset.products.find((candidate) => candidate.active)!;

    const failure = await expectApiError(
      api.createOrder({
        customerId: customer.id,
        orderDate: '2099-01-01',
        items: [{ productId: product.id, quantity: 1 }],
      }),
    );

    expect(failure.issues.map((issue) => issue.path)).toContain('orderDate');
  });
});

describe('analytics before any pipeline run', () => {
  beforeEach(() => setScenario('empty-warehouse'));

  it('returns zeros and empty arrays rather than an error', async () => {
    const [revenue, byProduct, byCity, daily] = await Promise.all([
      api.revenue(),
      api.salesByProduct(),
      api.salesByCity(),
      api.dailySales(),
    ]);

    expect(revenue.warehouseReady).toBe(false);
    expect(revenue.totalRevenue).toBe(0);
    expect(revenue.orderCount).toBe(0);
    expect(revenue.averageOrderValue).toBe(0);

    expect(byProduct.categories).toEqual([]);
    expect(byProduct.topProducts).toEqual([]);
    expect(byCity.cities).toEqual([]);
    expect(daily.series).toEqual([]);
  });

  it('reports the warehouse as down on the health endpoint', async () => {
    const health = await api.health();

    expect(health.status).toBe('ok');
    expect(health.dependencies.postgres.status).toBe('up');
    // Not required for readiness — an unbuilt warehouse is not an outage.
    expect(health.dependencies.warehouse.status).toBe('down');
  });
});

describe('analytics once the warehouse is published', () => {
  beforeEach(() => setScenario('ready'));

  it('reports averageOrderValue as revenue divided by orders', async () => {
    const revenue = await api.revenue();

    expect(revenue.warehouseReady).toBe(true);
    expect(revenue.orderCount).toBeGreaterThan(0);
    expect(revenue.averageOrderValue).toBeCloseTo(revenue.totalRevenue / revenue.orderCount, 1);
  });

  it('gap-fills the daily series across every calendar day in range', async () => {
    const daily = await api.dailySales({ from: '2026-08-01', to: '2026-08-10' });

    expect(daily.series).toHaveLength(10);
    expect(daily.series[0]?.date).toBe('2026-08-01');
    expect(daily.series.at(-1)?.date).toBe('2026-08-10');

    const dates = daily.series.map((point) => point.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('orders categories and top products by revenue descending', async () => {
    const byProduct = await api.salesByProduct({ topN: 5 });

    expect(byProduct.topProducts).toHaveLength(5);

    const revenues = byProduct.topProducts.map((product) => product.revenue);
    expect([...revenues].sort((left, right) => right - left)).toEqual(revenues);
    expect(byProduct.categories[0]?.revenue).toBeGreaterThanOrEqual(
      byProduct.categories.at(-1)?.revenue ?? 0,
    );
  });

  it('reports the window it applied, not the one that was asked for', async () => {
    const revenue = await api.revenue({ from: '2026-08-01', to: '2026-08-10' });

    expect(revenue.range?.from).toBe('2026-08-01');
    expect(revenue.range?.to).toBe('2026-08-10');
    expect(revenue.generatedAt).toBeTruthy();
  });
});

describe('pipeline runs', () => {
  beforeEach(() => setScenario('empty-warehouse'));

  it('publishes the warehouse only when the run completes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));

    expect((await api.revenue()).warehouseReady).toBe(false);

    const run = await api.runPipeline();
    expect(run.status).toBe('running');

    // Mid-run: still nothing published. This is the state the dashboard must not
    // mistake for an error.
    expect((await api.revenue()).warehouseReady).toBe(false);

    vi.advanceTimersByTime(8_000);

    const status = await api.pipelineStatus();
    expect(status.current?.status).toBe('succeeded');
    expect(status.lastSuccessful?.runId).toBe(status.current?.runId);
    expect(status.current?.rowCounts?.factSales).toBeGreaterThan(0);

    const revenue = await api.revenue();
    expect(revenue.warehouseReady).toBe(true);
    expect(revenue.totalRevenue).toBeGreaterThan(0);
  });

  it('refuses a second run while one is active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));

    await api.runPipeline();
    const failure = await expectApiError(api.runPipeline());

    expect(failure.status).toBe(409);
    expect(failure.code).toBe('conflict');
  });

  it('records an error summary and leaves the warehouse unpublished on failure', async () => {
    setScenario('pipeline-failure');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T10:00:00.000Z'));

    await api.runPipeline();
    vi.advanceTimersByTime(8_000);

    const status = await api.pipelineStatus();
    expect(status.current?.status).toBe('failed');
    expect(status.current?.errorSummary).toBeTruthy();
    expect(status.lastSuccessful).toBeNull();
    expect((await api.revenue()).warehouseReady).toBe(false);
  });
});

describe('the error scenario', () => {
  beforeEach(() => setScenario('error'));

  it('fails analytics with a 500 while leaving operational endpoints working', async () => {
    const failure = await expectApiError(api.revenue());
    expect(failure.status).toBe(500);

    const customers = await api.listCustomers({ limit: 1 });
    expect(customers.data).toHaveLength(1);
  });
});
