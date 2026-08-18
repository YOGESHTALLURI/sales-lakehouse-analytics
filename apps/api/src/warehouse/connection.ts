import { stat } from 'node:fs/promises';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

/**
 * Read-only access to the published DuckDB warehouse.
 *
 * Nothing in this directory may import `pg`, or anything that reaches it. Every
 * analytics figure this service publishes has to come from the warehouse, and an
 * architecture test asserts that boundary by inspecting these files' imports —
 * a convenient PostgreSQL fallback here would quietly erase the separation the
 * whole project exists to demonstrate.
 */

/** Values DuckDB hands back that are not directly JSON-serialisable. */
interface DuckDBDecimalLike {
  value: bigint;
  scale: number;
}

/**
 * Coerce a DuckDB scalar to a JSON-safe number.
 *
 * Necessary because `JSON.stringify` throws on `bigint`, and DuckDB returns
 * `DECIMAL` as `{ value, scale }`. The queries in this module cast to
 * `::integer` and `::double` precisely so this stays a safety net rather than the
 * main path — but an uncast column would otherwise crash a response at
 * serialisation time, far from its cause.
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);

  if (typeof value === 'object' && 'value' in value && 'scale' in value) {
    const decimal = value as DuckDBDecimalLike;
    return Number(decimal.value) / 10 ** decimal.scale;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Money rounded to two places, so a double's tail never reaches the client. */
export function toMoney(value: unknown): number {
  return Math.round(toNumber(value) * 100) / 100;
}

/** Scalars the analytics queries bind. Narrower than DuckDB accepts, on purpose:
 * every parameter here is a validated date, a small integer, or null. */
export type WarehouseParam = string | number | boolean | null;

export interface WarehouseHandle {
  /** When the ETL published this warehouse, from `warehouse_metadata`. */
  publishedAt: string | null;
  query<T extends Record<string, unknown>>(sql: string, params?: WarehouseParam[]): Promise<T[]>;
}

/**
 * Identity of the file a cached connection was opened against.
 *
 * The ETL publishes by renaming a temporary file over the published path, which
 * changes the inode. A cached DuckDB handle keeps reading the *old* inode, so it
 * would serve pre-pipeline data forever. Comparing identity on every request is
 * a sub-millisecond stat that makes a stale dashboard impossible; reopening
 * costs ~20ms and only happens after an actual publish.
 */
interface FileIdentity {
  ino: number;
  size: number;
  mtimeMs: number;
}

interface CachedConnection {
  identity: FileIdentity;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  publishedAt: string | null;
}

let cached: CachedConnection | undefined;

function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function fileIdentity(path: string): Promise<FileIdentity | undefined> {
  try {
    const stats = await stat(path);
    // A zero-byte file is a failed or in-flight publish, not a warehouse.
    if (!stats.isFile() || stats.size === 0) return undefined;
    return { ino: stats.ino, size: stats.size, mtimeMs: stats.mtimeMs };
  } catch {
    return undefined;
  }
}

function closeCached(): void {
  if (!cached) return;
  try {
    cached.connection.closeSync();
    cached.instance.closeSync();
  } catch {
    // Already closed, or the underlying file vanished. Either way the handle is
    // being discarded, so a failure here is not worth propagating.
  }
  cached = undefined;
}

async function readPublishedAt(connection: DuckDBConnection): Promise<string | null> {
  try {
    const result = await connection.runAndReadAll(
      "select value from warehouse_metadata where key = 'published_at'",
    );
    const row = result.getRowObjects()[0];
    return row ? String(row.value) : null;
  } catch {
    // A warehouse from before metadata existed is still queryable; it simply
    // cannot say when it was published.
    return null;
  }
}

/**
 * Open the warehouse, or return `undefined` when there is nothing to open.
 *
 * `undefined` is an expected state, not an error: a fresh stack has no warehouse
 * until the first pipeline run. Callers translate it into `warehouseReady: false`
 * with empty results.
 */
export async function openWarehouse(path: string): Promise<WarehouseHandle | undefined> {
  const identity = await fileIdentity(path);

  if (!identity) {
    closeCached();
    return undefined;
  }

  if (!cached || !sameFile(cached.identity, identity)) {
    closeCached();

    try {
      const instance = await DuckDBInstance.create(path, { access_mode: 'READ_ONLY' });
      const connection = await instance.connect();
      cached = {
        identity,
        instance,
        connection,
        publishedAt: await readPublishedAt(connection),
      };
    } catch {
      // A corrupt or partially written file is indistinguishable from "not
      // published yet" as far as a caller is concerned.
      closeCached();
      return undefined;
    }
  }

  const active = cached;

  return {
    publishedAt: active.publishedAt,
    async query<T extends Record<string, unknown>>(sql: string, params?: WarehouseParam[]) {
      const result = await active.connection.runAndReadAll(sql, params ?? []);
      return result.getRowObjects() as T[];
    },
  };
}

/** Release the cached handle. Called on shutdown and between tests. */
export function closeWarehouse(): void {
  closeCached();
}
