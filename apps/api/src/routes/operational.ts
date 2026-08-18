import { Router } from 'express';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { ApiError } from '../http/errors.js';
import {
  createCustomer,
  createProduct,
  findCustomer,
  findProduct,
  listCustomers,
  listProducts,
} from '../repositories/catalogue.js';
import { createOrder, findOrder, listOrders } from '../repositories/orders.js';
import {
  customerCreate,
  listCustomersQuery,
  listOrdersQuery,
  listProductsQuery,
  orderCreate,
  productCreate,
} from '../schemas/index.js';

/**
 * Operational routes: PostgreSQL only.
 *
 * Express 5 forwards a rejected handler promise to the error handler, so these
 * throw ApiError and let one place render the envelope.
 */

/** Parse with a schema or throw the documented validation failure. */
function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw ApiError.fromZod(result.error);
  }
  return result.data;
}

export function createOperationalRouter(pool: Pool): Router {
  const router = Router();

  // ── Customers ─────────────────────────────────────────────────────────────

  router.post('/api/customers', async (request, response) => {
    const input = parse(customerCreate, request.body);
    response.status(201).json(await createCustomer(pool, input));
  });

  router.get('/api/customers', async (request, response) => {
    const query = parse(listCustomersQuery, request.query);
    response.json(await listCustomers(pool, query));
  });

  router.get('/api/customers/:id', async (request, response) => {
    const customer = await findCustomer(pool, requireUuid(request.params.id, 'id'));

    if (!customer) {
      throw ApiError.notFound('not_found', 'No customer exists with that id.');
    }

    response.json(customer);
  });

  // ── Products ──────────────────────────────────────────────────────────────

  router.post('/api/products', async (request, response) => {
    const input = parse(productCreate, request.body);
    response.status(201).json(await createProduct(pool, input));
  });

  router.get('/api/products', async (request, response) => {
    const query = parse(listProductsQuery, request.query);
    response.json(await listProducts(pool, query));
  });

  router.get('/api/products/:id', async (request, response) => {
    const product = await findProduct(pool, requireUuid(request.params.id, 'id'));

    if (!product) {
      throw ApiError.notFound('not_found', 'No product exists with that id.');
    }

    response.json(product);
  });

  // ── Orders ────────────────────────────────────────────────────────────────

  router.post('/api/orders', async (request, response) => {
    const input = parse(orderCreate, request.body);
    response.status(201).json(await createOrder(pool, input));
  });

  router.get('/api/orders', async (request, response) => {
    const query = parse(listOrdersQuery, request.query);

    if (query.from && query.to && query.from > query.to) {
      throw ApiError.validation([
        { path: 'from', message: 'The start of the range is after its end.' },
      ]);
    }

    response.json(await listOrders(pool, query));
  });

  router.get('/api/orders/:id', async (request, response) => {
    const order = await findOrder(pool, requireUuid(request.params.id, 'id'));

    if (!order) {
      throw ApiError.notFound('not_found', 'No order exists with that id.');
    }

    response.json(order);
  });

  return router;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate a path parameter before it reaches SQL.
 *
 * Without this, a malformed id reaches PostgreSQL and comes back as an invalid
 * -input-syntax error, which would surface as a 500 for what is really a client
 * mistake.
 */
function requireUuid(value: string | undefined, path: string): string {
  if (!value || !UUID.test(value)) {
    throw ApiError.validation([{ path, message: 'Expected a UUID.' }]);
  }
  return value;
}
