import { describe, expect, it } from 'vitest';
import {
  loadGenerationProfile,
  loadSeedSettings,
  loadVocabulary,
  seedsDir,
  type SeedSettings,
} from '../src/seed/config.js';
import { datasetChecksum, generateDataset, type GeneratedDataset } from '../src/seed/generate.js';
import { validateDataset } from '../src/seed/validate.js';

const directory = seedsDir();
const vocabulary = loadVocabulary(directory);
const profile = loadGenerationProfile(directory);

function build(overrides: Partial<SeedSettings> = {}): GeneratedDataset {
  return generateDataset({ ...loadSeedSettings({}), ...overrides }, vocabulary, profile);
}

/** A smaller dataset for assertions that do not need the full volume. */
function small(overrides: Partial<SeedSettings> = {}): GeneratedDataset {
  return build({ customers: 60, products: 30, orders: 400, ...overrides });
}

describe('documented defaults', () => {
  it('match .env.example, so no environment yields the documented dataset', () => {
    const settings = loadSeedSettings({});

    expect(settings).toEqual({
      seed: 20_260_818,
      customers: 500,
      products: 100,
      orders: 10_000,
      months: 12,
      endDate: '2026-08-18',
    });
  });

  it('anchors the window to a fixed date, not the clock', () => {
    // Anchoring to today would change the dataset daily and break the
    // reproducibility the plan requires.
    const first = build().orders.map((o) => o.orderDate).sort()[0];
    const second = build().orders.map((o) => o.orderDate).sort()[0];

    expect(first).toBe(second);
    expect(first).toBe('2025-08-24');
  });
});

describe('reproducibility', () => {
  it('produces a byte-identical dataset for the documented seed', () => {
    // This checksum is a deliberate tripwire. It covers primary keys, names,
    // prices, dates and statuses, so ANY change to the generator, the
    // vocabulary or the generation profile will fail this test. When that
    // happens the change was either intended — update the value below and say
    // so in the commit — or it was an accident this test just caught.
    expect(datasetChecksum(build())).toBe(
      'b0c78778b5cb80444fa2f02f0a4821e9a84fb4ac7a1efea5d52a3f19ea51d4b6',
    );
  });

  it('produces identical rows across two runs in the same process', () => {
    expect(build()).toEqual(build());
  });

  it('produces a different dataset for a different seed', () => {
    expect(datasetChecksum(small({ seed: 1 }))).not.toBe(datasetChecksum(small({ seed: 2 })));
  });

  it('generates stable primary keys, not database-assigned ones', () => {
    // Keys come from the seeded stream, which is what makes the whole dataset
    // comparable between runs and machines.
    expect(small().customers.map((c) => c.id)).toEqual(small().customers.map((c) => c.id));
  });
});

describe('requested volumes', () => {
  it('honours the configured counts exactly', () => {
    const dataset = small();

    expect(dataset.customers).toHaveLength(60);
    expect(dataset.products).toHaveLength(30);
    expect(dataset.orders).toHaveLength(400);
  });

  it('meets the plan’s minimum scale at the documented settings', () => {
    const dataset = build();

    expect(dataset.customers.length).toBe(500);
    expect(dataset.products.length).toBe(100);
    expect(dataset.orders.length).toBeGreaterThanOrEqual(10_000);
    expect(dataset.orderItems.length).toBeGreaterThan(dataset.orders.length);
  });

  it('gives every order between one and five line items', () => {
    const dataset = small();
    const counts = new Map<string, number>();

    for (const item of dataset.orderItems) {
      counts.set(item.orderId, (counts.get(item.orderId) ?? 0) + 1);
    }

    expect(counts.size).toBe(dataset.orders.length);
    for (const count of counts.values()) {
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(5);
    }
  });
});

describe('validation', () => {
  it('passes at the documented settings', () => {
    const report = validateDataset(build());

    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('passes at awkward small volumes', () => {
    // One customer and one product still has to produce a loadable dataset:
    // the loyal-customer sample and the per-category round robin both have
    // edge cases at count 1.
    for (const settings of [
      { customers: 1, products: 1, orders: 1 },
      { customers: 2, products: 10, orders: 5 },
      { customers: 500, products: 10, orders: 50 },
    ]) {
      const report = validateDataset(build(settings));
      expect(report.issues, JSON.stringify(settings)).toEqual([]);
    }
  });

  it('reports an issue when the dataset is tampered with', () => {
    // Proves the validator can actually fail, rather than passing vacuously.
    const dataset = small();
    dataset.orderItems[0]!.quantity = 0;

    const report = validateDataset(dataset);

    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.rule)).toContain('quantity_positive');
  });

  it('detects a broken foreign key', () => {
    const dataset = small();
    dataset.orders[0]!.customerId = '00000000-0000-4000-8000-000000000000';

    expect(validateDataset(dataset).issues.map((i) => i.rule)).toContain('order_customer_exists');
  });
});

describe('database constraints are respected up front', () => {
  const dataset = build();

  it('keeps customer emails unique case-insensitively', () => {
    const emails = dataset.customers.map((c) => c.email.toLowerCase());

    expect(new Set(emails).size).toBe(emails.length);
  });

  it('keeps product SKUs unique', () => {
    const skus = dataset.products.map((p) => p.sku);

    expect(new Set(skus).size).toBe(skus.length);
  });

  it('never repeats a product within one order', () => {
    const seen = new Set<string>();

    for (const item of dataset.orderItems) {
      const key = `${item.orderId}:${item.productId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('uses only statuses the schema allows', () => {
    const allowed = new Set(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);

    for (const order of dataset.orders) {
      expect(allowed.has(order.status)).toBe(true);
    }
  });

  it('writes money as fixed two-decimal strings', () => {
    for (const product of dataset.products) {
      expect(product.unitPrice).toMatch(/^\d+\.\d{2}$/);
    }
    for (const item of dataset.orderItems) {
      expect(item.unitPriceAtSale).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('never sells an inactive product', () => {
    const inactive = new Set(dataset.products.filter((p) => !p.active).map((p) => p.id));

    expect(inactive.size).toBeGreaterThan(0);
    for (const item of dataset.orderItems) {
      expect(inactive.has(item.productId)).toBe(false);
    }
  });

  it('keeps every order date inside the requested window', () => {
    for (const order of dataset.orders) {
      expect(order.orderDate >= '2025-08-24').toBe(true);
      expect(order.orderDate <= '2026-08-18').toBe(true);
    }
  });
});

describe('the data is interesting enough to chart', () => {
  const dataset = build();

  const orderById = new Map(dataset.orders.map((o) => [o.id, o]));
  const productById = new Map(dataset.products.map((p) => [p.id, p]));

  function revenueBy(key: (orderDate: string, category: string) => string): Map<string, number> {
    const totals = new Map<string, number>();

    for (const item of dataset.orderItems) {
      const order = orderById.get(item.orderId)!;
      const category = productById.get(item.productId)!.category;
      const bucket = key(order.orderDate, category);
      const revenue = Number.parseFloat(item.unitPriceAtSale) * item.quantity;
      totals.set(bucket, (totals.get(bucket) ?? 0) + revenue);
    }

    return totals;
  }

  it('covers essentially every day in the window, so the time series has no gaps', () => {
    const days = new Set(dataset.orders.map((o) => o.orderDate));

    expect(days.size).toBeGreaterThanOrEqual(355);
  });

  it('shows a festive-season peak well above the trough', () => {
    const byMonth = revenueBy((orderDate) => orderDate.slice(0, 7));
    // Ignore the two partial months at the window edges.
    const fullMonths = [...byMonth].filter(
      ([month]) => month !== '2025-08' && month !== '2026-08',
    );
    const values = fullMonths.map(([, revenue]) => revenue);
    const peak = Math.max(...values);
    const trough = Math.min(...values);

    // A flat series would make the daily-revenue chart meaningless.
    expect(peak / trough).toBeGreaterThan(1.3);

    const busiest = fullMonths.sort((a, b) => b[1] - a[1])[0]![0];
    expect(['2025-10', '2025-11']).toContain(busiest);
  });

  it('spreads revenue unevenly across categories', () => {
    const byCategory = revenueBy((_orderDate, category) => category);
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    const shares = [...byCategory.values()].map((value) => value / total).sort((a, b) => b - a);

    expect(byCategory.size).toBe(10);
    // Leading category clearly ahead, but not the entire business.
    expect(shares[0]!).toBeGreaterThan(0.15);
    expect(shares[0]!).toBeLessThan(0.6);
    expect(shares.at(-1)!).toBeLessThan(0.05);
  });

  it('concentrates orders on a loyal minority', () => {
    const perCustomer = new Map<string, number>();
    for (const order of dataset.orders) {
      perCustomer.set(order.customerId, (perCustomer.get(order.customerId) ?? 0) + 1);
    }

    const ranked = [...perCustomer.values()].sort((a, b) => b - a);
    const topFifth = ranked.slice(0, Math.round(ranked.length * 0.2));
    const topFifthShare =
      topFifth.reduce((a, b) => a + b, 0) / ranked.reduce((a, b) => a + b, 0);

    // Uniform customers would leave top-customer analysis with nothing to find.
    expect(topFifthShare).toBeGreaterThan(0.4);
  });

  it('diverges the sale price from the catalogue price often enough to matter', () => {
    const catalogue = new Map(dataset.products.map((p) => [p.id, p.unitPrice]));
    const diverged = dataset.orderItems.filter(
      (item) => catalogue.get(item.productId) !== item.unitPriceAtSale,
    ).length;

    // This is what makes the warehouse's use of the historical price observable
    // rather than a claim in a document.
    const share = diverged / dataset.orderItems.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.5);
  });

  it('produces an average order value in a plausible retail range', () => {
    const revenue = dataset.orderItems.reduce(
      (total, item) => total + Number.parseFloat(item.unitPriceAtSale) * item.quantity,
      0,
    );
    const averageOrderValue = revenue / dataset.orders.length;

    expect(averageOrderValue).toBeGreaterThan(500);
    expect(averageOrderValue).toBeLessThan(10_000);
  });

  it('leaves recent orders unsettled and old orders delivered', () => {
    const recent = dataset.orders.filter((o) => o.orderDate >= '2026-08-05');
    const old = dataset.orders.filter((o) => o.orderDate <= '2025-12-31');

    const pendingShare = recent.filter((o) => o.status === 'pending').length / recent.length;
    const deliveredShare = old.filter((o) => o.status === 'delivered').length / old.length;

    expect(pendingShare).toBeGreaterThan(0.15);
    expect(deliveredShare).toBeGreaterThan(0.6);
  });
});
