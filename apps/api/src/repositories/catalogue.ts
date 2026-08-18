import type { Pool } from 'pg';
import { ApiError, conflictFromUniqueViolation } from '../http/errors.js';
import type { CustomerCreate, PaginationQuery, ProductCreate } from '../schemas/index.js';

/**
 * Customer and product persistence.
 *
 * PostgreSQL only. Nothing in this file may be reused by an analytics endpoint —
 * those read the warehouse, which is the separation the whole project exists to
 * demonstrate.
 */

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  city: string;
  state: string;
  createdAt: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPrice: number;
  active: boolean;
  createdAt: string;
}

export interface Page<T> {
  data: T[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * `numeric` arrives from pg as a string to avoid float loss in transit. The
 * contract publishes money as a JSON number, so the conversion happens once,
 * here, at the boundary — never in the middle of an arithmetic chain.
 */
function toMoney(value: string): number {
  return Number.parseFloat(value);
}

function toIso(value: Date): string {
  return value.toISOString();
}

// ── Customers ───────────────────────────────────────────────────────────────

interface RawCustomer {
  id: string;
  name: string;
  email: string;
  city: string;
  state: string;
  created_at: Date;
}

function mapCustomer(row: RawCustomer): CustomerRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    city: row.city,
    state: row.state,
    createdAt: toIso(row.created_at),
  };
}

export async function createCustomer(pool: Pool, input: CustomerCreate): Promise<CustomerRow> {
  try {
    const result = await pool.query<RawCustomer>(
      `insert into customers (name, email, city, state)
       values ($1, $2, $3, $4)
       returning id, name, email, city, state, created_at`,
      [input.name, input.email, input.city, input.state],
    );

    return mapCustomer(result.rows[0]!);
  } catch (error) {
    const conflict = conflictFromUniqueViolation(error, {
      customers_email_unique: 'A customer with that email already exists.',
    });
    if (conflict) throw conflict;
    throw error;
  }
}

export async function listCustomers(pool: Pool, query: PaginationQuery): Promise<Page<CustomerRow>> {
  const [rows, total] = await Promise.all([
    pool.query<RawCustomer>(
      `select id, name, email, city, state, created_at
         from customers
        order by created_at desc, id
        limit $1 offset $2`,
      [query.limit, query.offset],
    ),
    pool.query<{ total: string }>('select count(*)::text as total from customers'),
  ]);

  return {
    data: rows.rows.map(mapCustomer),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: Number.parseInt(total.rows[0]!.total, 10),
    },
  };
}

export async function findCustomer(pool: Pool, id: string): Promise<CustomerRow | undefined> {
  const result = await pool.query<RawCustomer>(
    'select id, name, email, city, state, created_at from customers where id = $1',
    [id],
  );

  const row = result.rows[0];
  return row ? mapCustomer(row) : undefined;
}

// ── Products ────────────────────────────────────────────────────────────────

interface RawProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit_price: string;
  active: boolean;
  created_at: Date;
}

function mapProduct(row: RawProduct): ProductRow {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unitPrice: toMoney(row.unit_price),
    active: row.active,
    createdAt: toIso(row.created_at),
  };
}

export async function createProduct(pool: Pool, input: ProductCreate): Promise<ProductRow> {
  try {
    const result = await pool.query<RawProduct>(
      `insert into products (sku, name, category, unit_price, active)
       values ($1, $2, $3, $4, $5)
       returning id, sku, name, category, unit_price, active, created_at`,
      [input.sku, input.name, input.category, input.unitPrice.toFixed(2), input.active],
    );

    return mapProduct(result.rows[0]!);
  } catch (error) {
    const conflict = conflictFromUniqueViolation(error, {
      products_sku_unique: 'A product with that SKU already exists.',
    });
    if (conflict) throw conflict;
    throw error;
  }
}

export interface ListProductsQuery extends PaginationQuery {
  category?: string;
  active?: boolean;
}

export async function listProducts(
  pool: Pool,
  query: ListProductsQuery,
): Promise<Page<ProductRow>> {
  // Both filters are optional. Passing null and testing for it keeps one
  // prepared statement instead of concatenating SQL per filter combination.
  const category = query.category ?? null;
  const active = query.active ?? null;

  const where = `where ($1::text is null or category = $1::text)
                   and ($2::boolean is null or active = $2::boolean)`;

  const [rows, total] = await Promise.all([
    pool.query<RawProduct>(
      `select id, sku, name, category, unit_price, active, created_at
         from products
        ${where}
        order by created_at desc, id
        limit $3 offset $4`,
      [category, active, query.limit, query.offset],
    ),
    pool.query<{ total: string }>(
      `select count(*)::text as total from products ${where}`,
      [category, active],
    ),
  ]);

  return {
    data: rows.rows.map(mapProduct),
    pagination: {
      limit: query.limit,
      offset: query.offset,
      total: Number.parseInt(total.rows[0]!.total, 10),
    },
  };
}

export async function findProduct(pool: Pool, id: string): Promise<ProductRow | undefined> {
  const result = await pool.query<RawProduct>(
    'select id, sku, name, category, unit_price, active, created_at from products where id = $1',
    [id],
  );

  const row = result.rows[0];
  return row ? mapProduct(row) : undefined;
}

export { ApiError };
