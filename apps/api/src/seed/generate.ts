import { createHash } from 'node:crypto';
import type { GenerationProfile, SeedSettings, Vocabulary } from './config.js';
import { SeededRandom, weightEntries } from './random.js';

/**
 * Synthetic sales data generation.
 *
 * Pure: no database, no clock, no filesystem. Given the same settings,
 * vocabulary and profile it returns byte-identical rows, which is what makes
 * the dataset reproducible on any machine and testable without infrastructure.
 */

export interface GeneratedCustomer {
  id: string;
  name: string;
  email: string;
  city: string;
  state: string;
  createdAt: string;
}

export interface GeneratedProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: string;
  active: boolean;
  createdAt: string;
}

export interface GeneratedOrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPriceAtSale: string;
}

export interface GeneratedOrder {
  id: string;
  customerId: string;
  orderDate: string;
  status: string;
  createdAt: string;
}

export interface GeneratedDataset {
  settings: SeedSettings;
  customers: GeneratedCustomer[];
  products: GeneratedProduct[];
  orders: GeneratedOrder[];
  orderItems: GeneratedOrderItem[];
}

const MS_PER_DAY = 86_400_000;

/** Money as a fixed 2-decimal string: no float drift, and `numeric` accepts it verbatim. */
function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function toIsoDate(dayIndex: number, epochDay: number): string {
  return new Date((epochDay + dayIndex) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * A deterministic instant for created_at.
 *
 * Derived from the order's calendar date rather than the wall clock, so
 * re-running the generator does not change a single timestamp.
 */
function timestampFor(date: string, random: SeededRandom): string {
  const hour = random.int(6, 22);
  const minute = random.int(0, 59);
  const second = random.int(0, 59);
  return `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(
    second,
  ).padStart(2, '0')}.000Z`;
}

function generateCustomers(
  settings: SeedSettings,
  vocabulary: Vocabulary,
  random: SeededRandom,
  firstDay: number,
): GeneratedCustomer[] {
  const locationWeights = vocabulary.locations.map((location) => ({
    value: location,
    weight: location.weight,
  }));

  const customers: GeneratedCustomer[] = [];
  const usedEmails = new Set<string>();

  for (let index = 0; index < settings.customers; index++) {
    const first = random.pick(vocabulary.firstNames);
    const last = random.pick(vocabulary.lastNames);
    const location = random.weighted(locationWeights);

    // The name pool is smaller than the customer count by design, so the email
    // carries a sequence suffix. Uniqueness is guaranteed by construction
    // rather than hoped for, because customers.email is a unique constraint.
    const localPart = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '');
    const email = `${localPart}.${index + 1}@example.com`;

    if (usedEmails.has(email)) {
      throw new Error(`Generator produced a duplicate email: ${email}`);
    }
    usedEmails.add(email);

    // Customers accumulate across the window; earlier signups can order sooner.
    const createdDay = random.int(0, Math.max(0, settings.customers > 1 ? 60 : 0));

    customers.push({
      id: random.uuid(),
      name: `${first} ${last}`,
      email,
      city: location.city,
      state: location.state,
      createdAt: timestampFor(toIsoDate(-createdDay, firstDay), random),
    });
  }

  return customers;
}

function generateProducts(
  settings: SeedSettings,
  vocabulary: Vocabulary,
  profile: GenerationProfile,
  random: SeededRandom,
  firstDay: number,
): GeneratedProduct[] {
  const products: GeneratedProduct[] = [];
  const usedNames = new Set<string>();
  const perCategoryCount = new Map<string, number>();

  for (let index = 0; index < settings.products; index++) {
    // Round-robin across categories so every category is represented even when
    // the product count is small, then vary the name within it.
    const category = vocabulary.categories[index % vocabulary.categories.length]!;
    const sequence = (perCategoryCount.get(category.name) ?? 0) + 1;
    perCategoryCount.set(category.name, sequence);

    let name = `${random.pick(category.modifiers)} ${random.pick(category.nouns)}`;
    // Distinct names keep product charts readable. Fall back to a variant
    // suffix rather than looping forever on a small vocabulary.
    if (usedNames.has(name)) {
      name = `${name} (${sequence})`;
    }
    usedNames.add(name);

    const [low, high] = category.priceBand;
    // Log-uniform, biased low. Retail prices span two orders of magnitude, so a
    // linear draw over the band makes flagship items as common as everyday ones
    // and inflates average order value far beyond anything plausible. Drawing in
    // log space makes each price decade equally likely; squaring the variate
    // then shifts mass towards the cheap end, which is where a real catalogue's
    // volume sits.
    const skew = random.next() ** 2;
    const logLow = Math.log(low);
    const unitPrice = Math.exp(logLow + skew * (Math.log(high) - logLow));

    products.push({
      id: random.uuid(),
      sku: `${category.skuPrefix}-${String(sequence).padStart(4, '0')}`,
      name,
      category: category.name,
      unitPrice: money(unitPrice),
      active: !random.chance(profile.inactiveProductShare),
      createdAt: timestampFor(toIsoDate(-random.int(0, 90), firstDay), random),
    });
  }

  return products;
}

/**
 * Build the day pool that orders are drawn from.
 *
 * Each day appears in proportion to its seasonality and weekday weight, so
 * picking a day uniformly from this pool yields the intended shape without
 * rejection sampling.
 */
function buildDayWeights(
  profile: GenerationProfile,
  firstDay: number,
  totalDays: number,
): { value: number; weight: number }[] {
  const weights: { value: number; weight: number }[] = [];

  for (let dayIndex = 0; dayIndex < totalDays; dayIndex++) {
    const date = new Date((firstDay + dayIndex) * MS_PER_DAY);
    const month = String(date.getUTCMonth() + 1);
    // getUTCDay is 0 for Sunday; the profile uses ISO numbering (Monday = 1).
    const isoWeekday = String(date.getUTCDay() === 0 ? 7 : date.getUTCDay());

    const seasonal = profile.monthlySeasonality[month] ?? 1;
    const weekday = profile.weekdayWeight[isoWeekday] ?? 1;

    weights.push({ value: dayIndex, weight: seasonal * weekday });
  }

  return weights;
}

function generateOrders(
  settings: SeedSettings,
  profile: GenerationProfile,
  customers: GeneratedCustomer[],
  products: GeneratedProduct[],
  random: SeededRandom,
  firstDay: number,
  totalDays: number,
): { orders: GeneratedOrder[]; orderItems: GeneratedOrderItem[] } {
  const dayWeights = buildDayWeights(profile, firstDay, totalDays);
  const itemCountWeights = weightEntries(profile.itemsPerOrder);
  const quantityWeights = weightEntries(profile.quantityPerItem);
  const settledStatusWeights = weightEntries(profile.statusWeights.settled);
  const recentStatusWeights = weightEntries(profile.statusWeights.recent);

  // Only active products can appear on a new order — the same rule the API will
  // enforce. Inactive ones keep whatever history they already have.
  const sellableByCategory = new Map<string, GeneratedProduct[]>();
  for (const product of products) {
    if (!product.active) continue;
    const bucket = sellableByCategory.get(product.category);
    if (bucket) bucket.push(product);
    else sellableByCategory.set(product.category, [product]);
  }

  const categoryWeights = weightEntries(profile.categoryDemand).filter(
    (entry) => (sellableByCategory.get(entry.value)?.length ?? 0) > 0,
  );

  if (categoryWeights.length === 0) {
    throw new Error('No sellable products in any category with positive demand');
  }

  const priceByProductId = new Map(products.map((p) => [p.id, Number.parseFloat(p.unitPrice)]));

  // A loyal minority places a disproportionate share of orders, so
  // top-customer analysis has something real to find.
  const loyalCount = Math.max(1, Math.round(customers.length * profile.repeatCustomers.loyalShare));
  const loyal = random.sample(customers, loyalCount);
  const { repeatShare } = profile.repeatCustomers;

  const lastDayIndex = totalDays - 1;
  const orders: GeneratedOrder[] = [];
  const orderItems: GeneratedOrderItem[] = [];

  for (let index = 0; index < settings.orders; index++) {
    const customer = random.chance(repeatShare) ? random.pick(loyal) : random.pick(customers);
    const dayIndex = random.weighted(dayWeights);
    const orderDate = toIsoDate(dayIndex, firstDay);

    const daysAgo = lastDayIndex - dayIndex;
    const status = random.weighted(
      daysAgo <= profile.statusWeights.recentWindowDays ? recentStatusWeights : settledStatusWeights,
    );

    const orderId = random.uuid();

    orders.push({
      id: orderId,
      customerId: customer.id,
      orderDate,
      status,
      createdAt: timestampFor(orderDate, random),
    });

    // order_items has a unique (order_id, product_id): a repeated product must
    // become a larger quantity, not a second line. Track what this order holds.
    const lineCount = Number.parseInt(random.weighted(itemCountWeights), 10);
    const chosen = new Set<string>();

    for (let line = 0; line < lineCount; line++) {
      const category = random.weighted(categoryWeights);
      const product = random.pick(sellableByCategory.get(category)!);

      if (chosen.has(product.id)) {
        continue;
      }
      chosen.add(product.id);

      const catalogue = priceByProductId.get(product.id)!;
      const { discountChance, minMultiplier, maxMultiplier } = profile.salePriceVariance;
      // Diverging from the catalogue price is the point: it makes the
      // warehouse's use of the historical price observable.
      const multiplier = random.chance(discountChance)
        ? random.float(minMultiplier, maxMultiplier)
        : 1;

      orderItems.push({
        id: random.uuid(),
        orderId,
        productId: product.id,
        quantity: Number.parseInt(random.weighted(quantityWeights), 10),
        unitPriceAtSale: money(catalogue * multiplier),
      });
    }
  }

  return { orders, orderItems };
}

/**
 * Generate the full dataset.
 *
 * `firstDay`/`totalDays` are whole days since the Unix epoch, so the window is
 * pure integer arithmetic with no timezone or DST involvement.
 */
export function generateDataset(
  settings: SeedSettings,
  vocabulary: Vocabulary,
  profile: GenerationProfile,
): GeneratedDataset {
  const endDay = Math.floor(Date.parse(`${settings.endDate}T00:00:00Z`) / MS_PER_DAY);

  if (!Number.isFinite(endDay)) {
    throw new Error(`Invalid SEED_END_DATE: ${settings.endDate}`);
  }

  // Approximate a month as 30 days: the window only has to be a stable,
  // documented length, and calendar-month arithmetic would add nothing.
  const totalDays = settings.months * 30;
  const firstDay = endDay - (totalDays - 1);

  const random = new SeededRandom(settings.seed);

  const customers = generateCustomers(settings, vocabulary, random, firstDay);
  const products = generateProducts(settings, vocabulary, profile, random, firstDay);
  const { orders, orderItems } = generateOrders(
    settings,
    profile,
    customers,
    products,
    random,
    firstDay,
    totalDays,
  );

  return { settings, customers, products, orders, orderItems };
}

/**
 * Stable checksum of a dataset.
 *
 * Lets a test assert that a documented seed still produces exactly the dataset
 * it produced before, which is the only way "reproducible on any machine"
 * stops being an untested claim.
 */
export function datasetChecksum(dataset: GeneratedDataset): string {
  const hash = createHash('sha256');

  const push = (parts: (string | number | boolean)[]): void => {
    hash.update(parts.join(''));
    hash.update(' ');
  };

  for (const c of dataset.customers) push([c.id, c.name, c.email, c.city, c.state, c.createdAt]);
  for (const p of dataset.products)
    push([p.id, p.sku, p.name, p.category, p.unitPrice, p.active, p.createdAt]);
  for (const o of dataset.orders) push([o.id, o.customerId, o.orderDate, o.status, o.createdAt]);
  for (const i of dataset.orderItems)
    push([i.id, i.orderId, i.productId, i.quantity, i.unitPriceAtSale]);

  return hash.digest('hex');
}
