import type { GeneratedDataset } from './generate.js';

/**
 * Validate a generated dataset before anything touches the database.
 *
 * The database would reject most violations anyway, but a failed INSERT halfway
 * through 40,000 rows reports one bad row with no context. Checking here names
 * the rule that broke and how widely, which is what makes the generator
 * debuggable — and it is the "validation report" the plan asks to be committed
 * alongside the generator.
 */

export interface ValidationIssue {
  rule: string;
  detail: string;
  affected: number;
}

export interface DatasetStatistics {
  customers: number;
  products: number;
  activeProducts: number;
  orders: number;
  orderItems: number;
  citiesCovered: number;
  categoriesCovered: number;
  distinctOrderDays: number;
  firstOrderDate: string;
  lastOrderDate: string;
  totalRevenue: string;
  averageOrderValue: string;
  averageItemsPerOrder: string;
  ordersWithoutItems: number;
  customersWithOrders: number;
  discountedLineShare: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  statistics: DatasetStatistics;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MONEY_PATTERN = /^\d+\.\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_STATUSES = new Set(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']);

export function validateDataset(dataset: GeneratedDataset): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (rule: string, detail: string, affected: number): void => {
    if (affected > 0) issues.push({ rule, detail, affected });
  };

  const { customers, products, orders, orderItems } = dataset;

  // ── Volumes match what was asked for ──────────────────────────────────────
  if (customers.length !== dataset.settings.customers) {
    add(
      'requested_customer_count',
      `expected ${dataset.settings.customers} customers, generated ${customers.length}`,
      1,
    );
  }
  if (products.length !== dataset.settings.products) {
    add(
      'requested_product_count',
      `expected ${dataset.settings.products} products, generated ${products.length}`,
      1,
    );
  }
  if (orders.length !== dataset.settings.orders) {
    add(
      'requested_order_count',
      `expected ${dataset.settings.orders} orders, generated ${orders.length}`,
      1,
    );
  }

  // ── Keys ──────────────────────────────────────────────────────────────────
  const customerIds = new Set(customers.map((c) => c.id));
  const productIds = new Set(products.map((p) => p.id));
  const orderIds = new Set(orders.map((o) => o.id));

  add(
    'unique_customer_id',
    'two customers share a primary key',
    customers.length - customerIds.size,
  );
  add('unique_product_id', 'two products share a primary key', products.length - productIds.size);
  add('unique_order_id', 'two orders share a primary key', orders.length - orderIds.size);
  add(
    'unique_order_item_id',
    'two order items share a primary key',
    orderItems.length - new Set(orderItems.map((i) => i.id)).size,
  );

  const malformedIds = [
    ...customers.map((c) => c.id),
    ...products.map((p) => p.id),
    ...orders.map((o) => o.id),
    ...orderItems.map((i) => i.id),
  ].filter((id) => !UUID_PATTERN.test(id)).length;
  add('uuid_v4_shape', 'identifier is not a valid UUID v4', malformedIds);

  // ── Business uniqueness the schema enforces ───────────────────────────────
  const emails = customers.map((c) => c.email.toLowerCase());
  add(
    'unique_customer_email',
    'customers.email is unique and case-insensitive in PostgreSQL',
    emails.length - new Set(emails).size,
  );
  add(
    'unique_product_sku',
    'products.sku is unique in PostgreSQL',
    products.length - new Set(products.map((p) => p.sku)).size,
  );

  // ── Referential integrity ─────────────────────────────────────────────────
  add(
    'order_customer_exists',
    'order references a customer that is not in the dataset',
    orders.filter((o) => !customerIds.has(o.customerId)).length,
  );
  add(
    'order_item_order_exists',
    'order item references an order that is not in the dataset',
    orderItems.filter((i) => !orderIds.has(i.orderId)).length,
  );
  add(
    'order_item_product_exists',
    'order item references a product that is not in the dataset',
    orderItems.filter((i) => !productIds.has(i.productId)).length,
  );

  // ── Domain constraints, mirroring the CHECK constraints ───────────────────
  add(
    'customer_email_shape',
    'email would fail customers_email_shape',
    customers.filter((c) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)).length,
  );
  add(
    'blank_text',
    'a required text column is blank, which the not-blank checks reject',
    [
      ...customers.flatMap((c) => [c.name, c.city, c.state]),
      ...products.flatMap((p) => [p.sku, p.name, p.category]),
    ].filter((value) => value.trim() === '').length,
  );
  add(
    'money_scale',
    'price is not a fixed two-decimal string',
    [...products.map((p) => p.unitPrice), ...orderItems.map((i) => i.unitPriceAtSale)].filter(
      (value) => !MONEY_PATTERN.test(value),
    ).length,
  );
  add(
    'quantity_positive',
    'quantity would fail order_items_quantity_positive',
    orderItems.filter((i) => !Number.isInteger(i.quantity) || i.quantity < 1).length,
  );
  add(
    'order_status_known',
    'status would fail orders_status_known',
    orders.filter((o) => !ORDER_STATUSES.has(o.status)).length,
  );
  add(
    'order_date_shape',
    'order_date is not YYYY-MM-DD',
    orders.filter((o) => !DATE_PATTERN.test(o.orderDate)).length,
  );

  // ── One line per product per order ────────────────────────────────────────
  const linesPerOrder = new Map<string, Set<string>>();
  let duplicateLines = 0;
  for (const item of orderItems) {
    let seen = linesPerOrder.get(item.orderId);
    if (!seen) {
      seen = new Set();
      linesPerOrder.set(item.orderId, seen);
    }
    if (seen.has(item.productId)) duplicateLines++;
    seen.add(item.productId);
  }
  add(
    'one_line_per_product',
    'order repeats a product, which order_items_one_line_per_product rejects',
    duplicateLines,
  );

  // ── Every order must sell something ───────────────────────────────────────
  const ordersWithoutItems = orders.filter((o) => !linesPerOrder.has(o.id)).length;
  add('order_has_items', 'order has no line items and therefore no revenue', ordersWithoutItems);

  // ── Only active products on new orders ────────────────────────────────────
  const inactiveIds = new Set(products.filter((p) => !p.active).map((p) => p.id));
  add(
    'active_products_only',
    'order item sells an inactive product',
    orderItems.filter((i) => inactiveIds.has(i.productId)).length,
  );

  // ── Order dates inside the requested window ───────────────────────────────
  const dates = orders.map((o) => o.orderDate).sort();
  const firstOrderDate = dates[0] ?? dataset.settings.endDate;
  const lastOrderDate = dates[dates.length - 1] ?? dataset.settings.endDate;
  add(
    'order_date_within_window',
    `order falls after SEED_END_DATE (${dataset.settings.endDate})`,
    orders.filter((o) => o.orderDate > dataset.settings.endDate).length,
  );

  // ── Statistics ────────────────────────────────────────────────────────────
  let revenuePaise = 0;
  let discountedLines = 0;
  const catalogueById = new Map(products.map((p) => [p.id, p.unitPrice]));

  for (const item of orderItems) {
    revenuePaise += Math.round(Number.parseFloat(item.unitPriceAtSale) * 100) * item.quantity;
    if (catalogueById.get(item.productId) !== item.unitPriceAtSale) discountedLines++;
  }

  const revenue = revenuePaise / 100;
  const payingOrders = linesPerOrder.size;

  const statistics: DatasetStatistics = {
    customers: customers.length,
    products: products.length,
    activeProducts: products.filter((p) => p.active).length,
    orders: orders.length,
    orderItems: orderItems.length,
    citiesCovered: new Set(customers.map((c) => c.city)).size,
    categoriesCovered: new Set(products.map((p) => p.category)).size,
    distinctOrderDays: new Set(dates).size,
    firstOrderDate,
    lastOrderDate,
    totalRevenue: revenue.toFixed(2),
    averageOrderValue: (payingOrders > 0 ? revenue / payingOrders : 0).toFixed(2),
    averageItemsPerOrder: (payingOrders > 0 ? orderItems.length / payingOrders : 0).toFixed(2),
    ordersWithoutItems,
    customersWithOrders: new Set(orders.map((o) => o.customerId)).size,
    discountedLineShare: (orderItems.length > 0 ? discountedLines / orderItems.length : 0).toFixed(
      3,
    ),
  };

  return { ok: issues.length === 0, issues, statistics };
}

/** Human-readable report for `npm run seed` output and the demo script. */
export function formatValidationReport(report: ValidationReport): string {
  const s = report.statistics;
  const lines = [
    `customers            ${s.customers} across ${s.citiesCovered} cities`,
    `products             ${s.products} (${s.activeProducts} active) across ${s.categoriesCovered} categories`,
    `orders               ${s.orders} on ${s.distinctOrderDays} distinct days`,
    `order items          ${s.orderItems} (avg ${s.averageItemsPerOrder} per order)`,
    `date range           ${s.firstOrderDate} to ${s.lastOrderDate}`,
    `total revenue        ${s.totalRevenue}`,
    `average order value  ${s.averageOrderValue}`,
    `repeat coverage      ${s.customersWithOrders} of ${s.customers} customers placed an order`,
    `discounted lines     ${(Number.parseFloat(s.discountedLineShare) * 100).toFixed(1)}%`,
  ];

  if (report.ok) {
    lines.push('validation           passed');
  } else {
    lines.push('validation           FAILED');
    for (const issue of report.issues) {
      lines.push(`  ${issue.rule}: ${issue.detail} (${issue.affected} affected)`);
    }
  }

  return lines.join('\n');
}
