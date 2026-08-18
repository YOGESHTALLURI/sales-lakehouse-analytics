import { z } from 'zod';

/**
 * Runtime schemas mirroring docs/api/openapi.yaml.
 *
 * Every bound here — lengths, ranges, enums — matches a documented constraint
 * and, where the database also enforces it, the corresponding CHECK constraint.
 * TypeScript types alone cannot reject a malformed request body at runtime.
 */

/** `.strict()` everywhere: the contract sets additionalProperties: false. */

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((value) => {
    // A NaN check is not enough: Date silently rolls impossible days over, so
    // 2026-02-30 becomes 2026-03-02 and parses "successfully". Round-tripping
    // catches it here, instead of letting PostgreSQL reject the date and turn a
    // client mistake into a 500.
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

export const orderStatus = z.enum([
  'pending',
  'confirmed',
  'shipped',
  'delivered',
  'cancelled',
]);

export type OrderStatus = z.infer<typeof orderStatus>;

// ── Customers ───────────────────────────────────────────────────────────────

export const customerCreate = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Length capped to match customers_email_length; the shape check mirrors
    // customers_email_shape so a rejection reads the same from either layer.
    email: z.string().trim().toLowerCase().email().max(200),
    city: z.string().trim().min(1).max(80),
    state: z.string().trim().min(1).max(80),
  })
  .strict();

export type CustomerCreate = z.infer<typeof customerCreate>;

export const listCustomersQuery = paginationQuery;

// ── Products ────────────────────────────────────────────────────────────────

/** Money: two decimal places, non-negative, and inside numeric(12,2). */
const money = z
  .number()
  .nonnegative()
  .max(9_999_999_999.99, 'Exceeds numeric(12,2)')
  .refine(
    (value) => Number.isInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'At most two decimal places',
  );

export const productCreate = z
  .object({
    sku: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(80),
    unitPrice: money,
    active: z.boolean().default(true),
  })
  .strict();

export type ProductCreate = z.infer<typeof productCreate>;

export const listProductsQuery = paginationQuery.extend({
  category: z.string().trim().min(1).max(80).optional(),
  // Query strings carry no types, so accept the two spellings a client sends.
  active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

// ── Orders ──────────────────────────────────────────────────────────────────

export const orderItemCreate = z
  .object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
    /** Omitted means "use the catalogue price", captured inside the transaction. */
    unitPriceAtSale: money.optional(),
  })
  .strict();

export const orderCreate = z
  .object({
    customerId: z.string().uuid(),
    orderDate: isoDate.optional(),
    status: orderStatus.default('pending'),
    items: z.array(orderItemCreate).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    // order_items has a unique (order_id, product_id): a repeated product must
    // arrive as a larger quantity, not a second line. Rejecting here names the
    // offending index instead of surfacing a raw constraint violation.
    const seen = new Map<string, number>();

    value.items.forEach((item, index) => {
      const first = seen.get(item.productId);
      if (first !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'productId'],
          message: `Duplicates item ${first}. Combine them into one line with a larger quantity.`,
        });
      } else {
        seen.set(item.productId, index);
      }
    });
  });

export type OrderCreate = z.infer<typeof orderCreate>;

export const listOrdersQuery = paginationQuery.extend({
  customerId: z.string().uuid().optional(),
  status: orderStatus.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;
