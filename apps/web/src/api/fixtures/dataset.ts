import { shiftIsoDate, todayIso } from '../../lib/format';
import type { Customer, Order, OrderItem, OrderStatus, Product } from '../types';

/**
 * A deterministic synthetic dataset shaped like the seeded database: 501
 * customers, 100 products and 10,001 orders over twelve months.
 *
 * The sizes match what the live operational API currently reports, so
 * pagination, filtering and the documented limits are exercised for real rather
 * than against a handful of rows. Analytics fixtures are derived from these same
 * orders, so every figure on the dashboard reconciles with the order list.
 *
 * This mirrors the repository's own generator: one fixed seed, same output on
 * every machine. It is display data for a UI built ahead of Phases 3 and 4, not
 * a second source of business truth.
 */

const SEED = 20260818;

/** mulberry32 — small, fast and reproducible across engines. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEX = '0123456789abcdef';

/** A v4-shaped identifier drawn from the seeded stream, not `crypto`. */
function uuid(random: () => number): string {
  let out = '';
  for (let index = 0; index < 36; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) out += '-';
    else if (index === 14) out += '4';
    else if (index === 19) out += HEX.charAt(8 + Math.floor(random() * 4));
    else out += HEX.charAt(Math.floor(random() * 16));
  }
  return out;
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) throw new Error('Cannot pick from an empty list.');
  return value;
}

function integerBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Pick an index from cumulative weights, so the shape of the data is stable. */
function weightedIndex(random: () => number, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let threshold = random() * total;

  for (let index = 0; index < weights.length; index += 1) {
    threshold -= weights[index] ?? 0;
    if (threshold <= 0) return index;
  }
  return weights.length - 1;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Diya', 'Ananya', 'Ishaan', 'Kabir', 'Meera',
  'Priya', 'Rohan', 'Saanvi', 'Arjun', 'Nikhil', 'Kavya', 'Riya', 'Aditi',
  'Vikram', 'Neha', 'Rahul', 'Sneha', 'Manish', 'Pooja', 'Karthik', 'Divya',
  'Suresh', 'Lakshmi', 'Anil', 'Farhan', 'Zoya', 'Yash',
] as const;

const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Menon', 'Reddy', 'Nair', 'Patel', 'Desai',
  'Chatterjee', 'Bose', 'Gupta', 'Rao', 'Singh', 'Kulkarni', 'Joshi', 'Pillai',
  'Kapoor', 'Bhatt', 'Ghosh', 'Naidu',
] as const;

const LOCATIONS = [
  { city: 'Mumbai', state: 'Maharashtra' },
  { city: 'Pune', state: 'Maharashtra' },
  { city: 'Nagpur', state: 'Maharashtra' },
  { city: 'Bengaluru', state: 'Karnataka' },
  { city: 'Mysuru', state: 'Karnataka' },
  { city: 'Hubballi', state: 'Karnataka' },
  { city: 'Hyderabad', state: 'Telangana' },
  { city: 'Warangal', state: 'Telangana' },
  { city: 'Chennai', state: 'Tamil Nadu' },
  { city: 'Coimbatore', state: 'Tamil Nadu' },
  { city: 'Madurai', state: 'Tamil Nadu' },
  { city: 'Kochi', state: 'Kerala' },
  { city: 'Thiruvananthapuram', state: 'Kerala' },
  { city: 'Kozhikode', state: 'Kerala' },
  { city: 'Ahmedabad', state: 'Gujarat' },
  { city: 'Surat', state: 'Gujarat' },
  { city: 'Vadodara', state: 'Gujarat' },
  { city: 'Jaipur', state: 'Rajasthan' },
  { city: 'Jodhpur', state: 'Rajasthan' },
  { city: 'Udaipur', state: 'Rajasthan' },
  { city: 'New Delhi', state: 'Delhi' },
  { city: 'Gurugram', state: 'Haryana' },
  { city: 'Noida', state: 'Uttar Pradesh' },
  { city: 'Lucknow', state: 'Uttar Pradesh' },
  { city: 'Kanpur', state: 'Uttar Pradesh' },
  { city: 'Kolkata', state: 'West Bengal' },
  { city: 'Bhubaneswar', state: 'Odisha' },
  { city: 'Patna', state: 'Bihar' },
  { city: 'Indore', state: 'Madhya Pradesh' },
  { city: 'Chandigarh', state: 'Punjab' },
] as const;

interface CategorySpec {
  readonly name: string;
  readonly prefix: string;
  readonly minPrice: number;
  readonly maxPrice: number;
  /** Relative demand, so charts show real variation rather than noise. */
  readonly demand: number;
  readonly nouns: readonly string[];
  readonly qualifiers: readonly string[];
}

const CATEGORY_SPECS: readonly CategorySpec[] = [
  {
    name: 'Electronics',
    prefix: 'ELEC',
    minPrice: 1499,
    maxPrice: 89999,
    demand: 20,
    nouns: [
      'Wireless Headphones', 'Bluetooth Speaker', 'Smart Watch', '4K Monitor',
      'Laptop Sleeve', 'Power Bank', 'Mechanical Keyboard', 'Webcam',
      'Tablet Stand', 'Noise-Cancelling Earbuds',
    ],
    qualifiers: ['Pro', 'Lite', 'Max', 'Studio', 'Everyday'],
  },
  {
    name: 'Home & Kitchen',
    prefix: 'HOME',
    minPrice: 249,
    maxPrice: 18999,
    demand: 16,
    nouns: [
      'Pressure Cooker', 'Cast Iron Skillet', 'Storage Jar Set', 'Table Lamp',
      'Cotton Bedsheet', 'Mixer Grinder', 'Ceramic Dinner Set', 'Wall Clock',
      'Vacuum Flask', 'Laundry Basket',
    ],
    qualifiers: ['Classic', 'Compact', 'Premium', 'Everyday', 'Heritage'],
  },
  {
    name: 'Fashion',
    prefix: 'FASH',
    minPrice: 399,
    maxPrice: 7999,
    demand: 14,
    nouns: [
      'Cotton Kurta', 'Linen Shirt', 'Running Shoes', 'Leather Belt',
      'Denim Jacket', 'Silk Saree', 'Woollen Scarf', 'Canvas Sneakers',
      'Chino Trousers', 'Rain Jacket',
    ],
    qualifiers: ['Slim Fit', 'Regular', 'Handloom', 'Festive', 'Everyday'],
  },
  {
    name: 'Grocery',
    prefix: 'GROC',
    minPrice: 49,
    maxPrice: 1299,
    demand: 13,
    nouns: [
      'Green Tea', 'Basmati Rice', 'Cold-Pressed Oil', 'Masala Blend',
      'Roasted Almonds', 'Filter Coffee', 'Millet Flour', 'Organic Honey',
      'Dark Chocolate', 'Mixed Pickle',
    ],
    qualifiers: ['Roasted', 'Organic', 'Estate', 'Small-Batch', 'Everyday'],
  },
  {
    name: 'Beauty',
    prefix: 'BEAU',
    minPrice: 149,
    maxPrice: 3499,
    demand: 11,
    nouns: [
      'Face Serum', 'Sunscreen Lotion', 'Hair Oil', 'Lip Balm', 'Sheet Mask',
      'Body Butter', 'Cleansing Gel', 'Kajal Pencil', 'Nail Care Kit',
      'Beard Balm',
    ],
    qualifiers: ['Brightening', 'Hydrating', 'Ayurvedic', 'Daily', 'Repair'],
  },
  {
    name: 'Sports & Fitness',
    prefix: 'SPRT',
    minPrice: 299,
    maxPrice: 24999,
    demand: 8,
    nouns: [
      'Yoga Mat', 'Dumbbell Pair', 'Cricket Bat', 'Badminton Racquet',
      'Skipping Rope', 'Resistance Bands', 'Football', 'Cycling Helmet',
      'Gym Gloves', 'Foam Roller',
    ],
    qualifiers: ['Pro', 'Training', 'Match', 'Beginner', 'Competition'],
  },
  {
    name: 'Books',
    prefix: 'BOOK',
    minPrice: 149,
    maxPrice: 1999,
    demand: 6,
    nouns: [
      'Short Story Collection', 'History of Trade', 'Data Modelling Primer',
      'Poetry Anthology', 'Illustrated Atlas', 'Regional Cookbook',
      'Biography', 'Travel Journal', 'Grammar Workbook', 'Design Reader',
    ],
    qualifiers: ['Revised', 'Illustrated', 'Annotated', 'Pocket', 'Collector'],
  },
  {
    name: 'Toys & Games',
    prefix: 'TOYS',
    minPrice: 199,
    maxPrice: 5999,
    demand: 5,
    nouns: [
      'Wooden Puzzle', 'Building Blocks', 'Board Game', 'Remote Car',
      'Craft Kit', 'Soft Toy', 'Card Game', 'Science Set', 'Modelling Clay',
      'Kite Set',
    ],
    qualifiers: ['Junior', 'Family', 'Deluxe', 'Starter', 'Travel'],
  },
  {
    name: 'Stationery',
    prefix: 'STAT',
    minPrice: 39,
    maxPrice: 2499,
    demand: 4,
    nouns: [
      'Gel Pen Pack', 'Ruled Notebook', 'Sketch Pencils', 'Desk Organiser',
      'Sticky Notes', 'Fountain Pen', 'File Folder', 'Highlighter Set',
      'Drawing Pad', 'Stapler',
    ],
    qualifiers: ['Executive', 'Student', 'Archival', 'Everyday', 'Compact'],
  },
  {
    name: 'Personal Care',
    prefix: 'CARE',
    minPrice: 99,
    maxPrice: 4999,
    demand: 3,
    nouns: [
      'Electric Trimmer', 'Bamboo Toothbrush', 'Hand Wash', 'Shaving Kit',
      'Hair Dryer', 'Nail Clipper Set', 'Face Towel', 'Talc Powder',
      'Deodorant', 'Foot Cream',
    ],
    qualifiers: ['Sensitive', 'Rechargeable', 'Herbal', 'Travel', 'Family'],
  },
] as const;

export const CATEGORY_NAMES: readonly string[] = CATEGORY_SPECS.map((spec) => spec.name);

const STATUS_WEIGHTS: ReadonlyArray<readonly [OrderStatus, number]> = [
  ['delivered', 54],
  ['shipped', 15],
  ['confirmed', 12],
  ['pending', 11],
  ['cancelled', 8],
];

/** Twelve monthly multipliers, peaking through the festive quarter. */
const SEASONALITY = [0.82, 0.86, 0.95, 0.98, 1.02, 0.94, 0.9, 1.0, 1.12, 1.35, 1.28, 1.05] as const;
const PEAK_SEASONALITY = 1.35;

const CUSTOMER_COUNT = 501;
const PRODUCT_COUNT = 100;
const ORDER_COUNT = 10_001;
const WINDOW_DAYS = 364;

export interface Dataset {
  readonly customers: Customer[];
  readonly products: Product[];
  readonly orders: Order[];
  /** Inclusive calendar window the orders span, for analytics defaults. */
  readonly range: { readonly from: string; readonly to: string };
}

function buildCustomers(random: () => number, today: string): Customer[] {
  const customers: Customer[] = [];
  const seenEmails = new Set<string>();

  for (let index = 0; index < CUSTOMER_COUNT; index += 1) {
    const first = pick(random, FIRST_NAMES);
    const last = pick(random, LAST_NAMES);
    const location = pick(random, LOCATIONS);

    // A numeric suffix only where one is needed keeps most addresses realistic
    // while guaranteeing the uniqueness the API enforces on email.
    const base = `${first}.${last}`.toLowerCase();
    let email = `${base}@example.com`;
    let suffix = 2;
    while (seenEmails.has(email)) {
      email = `${base}${suffix}@example.com`;
      suffix += 1;
    }
    seenEmails.add(email);

    const day = shiftIsoDate(today, -integerBetween(random, 0, WINDOW_DAYS + 30));
    const time = `${pad(integerBetween(random, 1, 23))}:${pad(integerBetween(random, 0, 59))}`;

    customers.push({
      id: uuid(random),
      name: `${first} ${last}`,
      email,
      city: location.city,
      state: location.state,
      createdAt: `${day}T${time}:00.000Z`,
    });
  }

  return customers;
}

function buildProducts(random: () => number, today: string): Product[] {
  const products: Product[] = [];
  const perCategory = PRODUCT_COUNT / CATEGORY_SPECS.length;

  for (const spec of CATEGORY_SPECS) {
    for (let index = 0; index < perCategory; index += 1) {
      const noun = spec.nouns[index % spec.nouns.length] ?? 'Item';
      const qualifier = pick(random, spec.qualifiers);
      const day = shiftIsoDate(today, -integerBetween(random, 30, WINDOW_DAYS + 60));

      products.push({
        id: uuid(random),
        sku: `${spec.prefix}-${pad(index + 1, 4)}`,
        name: `${qualifier} ${noun}`,
        category: spec.name,
        unitPrice: round2(spec.minPrice + random() * (spec.maxPrice - spec.minPrice)),
        // A handful of retired products, so the order form's active-only filter
        // and the documented `product_inactive` conflict are both reachable.
        active: random() > 0.07,
        createdAt: `${day}T${pad(integerBetween(random, 0, 23))}:${pad(integerBetween(random, 0, 59))}:00.000Z`,
      });
    }
  }

  return products;
}

function buildOrders(
  random: () => number,
  today: string,
  customers: readonly Customer[],
  products: readonly Product[],
): Order[] {
  const activeProducts = products.filter((product) => product.active);
  const catalogue = activeProducts.length > 0 ? activeProducts : products;

  // Category demand drives which products sell, so the category chart has a
  // deliberate shape instead of ten near-identical bars.
  const productWeights = catalogue.map((product) => {
    const spec = CATEGORY_SPECS.find((candidate) => candidate.name === product.category);
    return spec?.demand ?? 1;
  });

  // A repeat-customer core: a fifth of customers place most of the orders.
  const loyalCount = Math.floor(customers.length * 0.2);
  const customerWeights = customers.map((_, index) => (index < loyalCount ? 6 : 1));

  const statuses = STATUS_WEIGHTS.map(([status]) => status);
  const statusWeights = STATUS_WEIGHTS.map(([, weight]) => weight);

  const orders: Order[] = [];

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    // Sample a day, then accept it in proportion to that month's seasonality.
    let dayOffset = integerBetween(random, 0, WINDOW_DAYS);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const month = Number(shiftIsoDate(today, -dayOffset).slice(5, 7)) - 1;
      const weight = SEASONALITY[month] ?? 1;
      if (random() <= weight / PEAK_SEASONALITY) break;
      dayOffset = integerBetween(random, 0, WINDOW_DAYS);
    }

    const orderDate = shiftIsoDate(today, -dayOffset);
    const customer = customers[weightedIndex(random, customerWeights)];
    if (!customer) continue;

    const lineCount = integerBetween(random, 1, 5);
    const chosen = new Set<number>();
    const items: OrderItem[] = [];

    for (let line = 0; line < lineCount; line += 1) {
      const productIndex = weightedIndex(random, productWeights);
      // One line per product: the API rejects duplicates, so generated data must
      // not contain a shape the API itself would refuse.
      if (chosen.has(productIndex)) continue;
      chosen.add(productIndex);

      const product = catalogue[productIndex];
      if (!product) continue;

      const quantity = integerBetween(random, 1, 4);
      // Historical prices drift from the current catalogue price, which is the
      // whole reason `unitPriceAtSale` is captured per line.
      const unitPriceAtSale = round2(product.unitPrice * (0.9 + random() * 0.2));

      items.push({
        id: uuid(random),
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        quantity,
        unitPriceAtSale,
        lineTotal: round2(unitPriceAtSale * quantity),
      });
    }

    if (items.length === 0) continue;

    const time = `${pad(integerBetween(random, 6, 21))}:${pad(integerBetween(random, 0, 59))}`;

    orders.push({
      id: uuid(random),
      customerId: customer.id,
      customerName: customer.name,
      orderDate,
      status: statuses[weightedIndex(random, statusWeights)] ?? 'pending',
      items,
      itemCount: items.length,
      orderTotal: round2(items.reduce((sum, item) => sum + item.lineTotal, 0)),
      createdAt: `${orderDate}T${time}:00.000Z`,
    });
  }

  return orders;
}

let cached: Dataset | undefined;

/** Built once on first use; every later call sees the same rows. */
export function getDataset(): Dataset {
  if (cached) return cached;

  const random = createRandom(SEED);
  const today = todayIso();

  const customers = buildCustomers(random, today);
  const products = buildProducts(random, today);
  const orders = buildOrders(random, today, customers, products);

  // Newest first, matching the documented list order.
  customers.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  products.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  orders.sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  cached = {
    customers,
    products,
    orders,
    range: { from: shiftIsoDate(today, -WINDOW_DAYS), to: today },
  };

  return cached;
}

/** Test seam: forget the dataset, including rows created through the API. */
export function resetDataset(): void {
  cached = undefined;
}
