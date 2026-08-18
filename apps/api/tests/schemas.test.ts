import { describe, expect, it } from 'vitest';
import {
  customerCreate,
  listOrdersQuery,
  listProductsQuery,
  orderCreate,
  paginationQuery,
  productCreate,
} from '../src/schemas/index.js';
import { ApiError } from '../src/http/errors.js';

/**
 * These schemas are the runtime half of the API contract, so the cases that
 * matter are the rejections — a type annotation cannot stop a bad request body.
 */

describe('paginationQuery', () => {
  it('applies the documented defaults', () => {
    expect(paginationQuery.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('coerces query strings, which never carry types', () => {
    expect(paginationQuery.parse({ limit: '25', offset: '100' })).toEqual({
      limit: 25,
      offset: 100,
    });
  });

  it('rejects a limit above the documented maximum', () => {
    expect(paginationQuery.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('rejects a negative offset and a fractional limit', () => {
    expect(paginationQuery.safeParse({ offset: '-1' }).success).toBe(false);
    expect(paginationQuery.safeParse({ limit: '1.5' }).success).toBe(false);
  });
});

describe('customerCreate', () => {
  const valid = {
    name: 'Aarav Sharma',
    email: 'aarav@example.com',
    city: 'Pune',
    state: 'Maharashtra',
  };

  it('accepts a well-formed customer', () => {
    expect(customerCreate.parse(valid)).toEqual(valid);
  });

  it('normalises email case, matching the citext column', () => {
    expect(customerCreate.parse({ ...valid, email: 'AARAV@Example.COM' }).email).toBe(
      'aarav@example.com',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(customerCreate.parse({ ...valid, name: '  Aarav Sharma  ' }).name).toBe('Aarav Sharma');
  });

  it('rejects a whitespace-only name, as the not-blank CHECK would', () => {
    expect(customerCreate.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('rejects a malformed email, as customers_email_shape would', () => {
    for (const email of ['not-an-email', 'a@b', '@example.com', 'a b@example.com']) {
      expect(customerCreate.safeParse({ ...valid, email }).success, email).toBe(false);
    }
  });

  it('rejects fields beyond the documented lengths', () => {
    expect(customerCreate.safeParse({ ...valid, name: 'a'.repeat(121) }).success).toBe(false);
    expect(
      customerCreate.safeParse({ ...valid, email: `${'a'.repeat(200)}@example.com` }).success,
    ).toBe(false);
  });

  it('rejects unknown properties, because the contract forbids them', () => {
    expect(customerCreate.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    expect(customerCreate.safeParse({ name: 'A', email: 'a@b.com' }).success).toBe(false);
  });
});

describe('productCreate', () => {
  const valid = { sku: 'ELEC-0001', name: 'Headphones', category: 'Electronics', unitPrice: 2499 };

  it('defaults active to true', () => {
    expect(productCreate.parse(valid).active).toBe(true);
  });

  it('accepts a zero price', () => {
    expect(productCreate.parse({ ...valid, unitPrice: 0 }).unitPrice).toBe(0);
  });

  it('rejects a negative price, as products_unit_price_non_negative would', () => {
    expect(productCreate.safeParse({ ...valid, unitPrice: -1 }).success).toBe(false);
  });

  it('rejects more than two decimal places, which numeric(12,2) would silently round', () => {
    expect(productCreate.safeParse({ ...valid, unitPrice: 10.999 }).success).toBe(false);
    expect(productCreate.parse({ ...valid, unitPrice: 10.99 }).unitPrice).toBe(10.99);
  });

  it('rejects a price beyond numeric(12,2)', () => {
    expect(productCreate.safeParse({ ...valid, unitPrice: 1e12 }).success).toBe(false);
  });

  it('rejects a non-numeric price rather than coercing it', () => {
    expect(productCreate.safeParse({ ...valid, unitPrice: '2499' }).success).toBe(false);
  });
});

describe('listProductsQuery', () => {
  it('accepts the boolean spellings a query string can carry', () => {
    expect(listProductsQuery.parse({ active: 'true' }).active).toBe(true);
    expect(listProductsQuery.parse({ active: 'false' }).active).toBe(false);
  });

  it('leaves active undefined when absent, so no filter is applied', () => {
    expect(listProductsQuery.parse({}).active).toBeUndefined();
  });

  it('rejects a non-boolean active value', () => {
    expect(listProductsQuery.safeParse({ active: 'maybe' }).success).toBe(false);
  });
});

describe('orderCreate', () => {
  const customerId = '11111111-1111-4111-8111-111111111111';
  const productA = '22222222-2222-4222-8222-222222222222';
  const productB = '33333333-3333-4333-8333-333333333333';

  const valid = { customerId, items: [{ productId: productA, quantity: 2 }] };

  it('defaults status to pending and leaves orderDate for the server', () => {
    const parsed = orderCreate.parse(valid);

    expect(parsed.status).toBe('pending');
    expect(parsed.orderDate).toBeUndefined();
  });

  it('requires at least one line item', () => {
    expect(orderCreate.safeParse({ customerId, items: [] }).success).toBe(false);
  });

  it('rejects more than fifty line items', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      productId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      quantity: 1,
    }));

    expect(orderCreate.safeParse({ customerId, items }).success).toBe(false);
  });

  it('rejects a duplicated product and names the offending index', () => {
    // order_items has a unique (order_id, product_id): a repeat must arrive as
    // a larger quantity, not a second line.
    const result = orderCreate.safeParse({
      customerId,
      items: [
        { productId: productA, quantity: 1 },
        { productId: productB, quantity: 1 },
        { productId: productA, quantity: 3 },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = ApiError.fromZod(result.error).issues?.[0];
      expect(issue?.path).toBe('items.2.productId');
      expect(issue?.message).toMatch(/Duplicates item 0/);
    }
  });

  it('rejects a zero or negative quantity, as order_items_quantity_positive would', () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(
        orderCreate.safeParse({ customerId, items: [{ productId: productA, quantity }] }).success,
        String(quantity),
      ).toBe(false);
    }
  });

  it('rejects a non-UUID customer or product id', () => {
    expect(orderCreate.safeParse({ ...valid, customerId: 'nope' }).success).toBe(false);
    expect(
      orderCreate.safeParse({ customerId, items: [{ productId: 'nope', quantity: 1 }] }).success,
    ).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(orderCreate.safeParse({ ...valid, status: 'refunded' }).success).toBe(false);
  });

  it('rejects a malformed date', () => {
    for (const orderDate of ['18-08-2026', '2026-8-1', '2026-02-30', 'yesterday']) {
      expect(orderCreate.safeParse({ ...valid, orderDate }).success, orderDate).toBe(false);
    }
  });

  it('accepts an optional explicit sale price', () => {
    const parsed = orderCreate.parse({
      customerId,
      items: [{ productId: productA, quantity: 1, unitPriceAtSale: 1999.5 }],
    });

    expect(parsed.items[0]?.unitPriceAtSale).toBe(1999.5);
  });

  it('rejects unknown properties on an item', () => {
    expect(
      orderCreate.safeParse({
        customerId,
        items: [{ productId: productA, quantity: 1, discount: 10 }],
      }).success,
    ).toBe(false);
  });
});

describe('listOrdersQuery', () => {
  it('accepts the documented filters', () => {
    const parsed = listOrdersQuery.parse({
      customerId: '11111111-1111-4111-8111-111111111111',
      status: 'delivered',
      from: '2026-01-01',
      to: '2026-06-30',
      limit: '10',
    });

    expect(parsed.status).toBe('delivered');
    expect(parsed.limit).toBe(10);
  });

  it('rejects an unknown status filter', () => {
    expect(listOrdersQuery.safeParse({ status: 'refunded' }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('renders the documented validation envelope', () => {
    const body = ApiError.validation([{ path: 'items.0.quantity', message: 'too small' }]).toBody();

    expect(body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed.',
        issues: [{ path: 'items.0.quantity', message: 'too small' }],
      },
    });
  });

  it('omits issues for errors that have none', () => {
    expect(ApiError.notFound('customer_not_found', 'gone').toBody()).toEqual({
      error: { code: 'customer_not_found', message: 'gone' },
    });
  });
});
