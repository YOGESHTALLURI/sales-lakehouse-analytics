import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { DependencyState } from './types.js';

/**
 * The OLTP connection pool. This is the only PostgreSQL client in the service,
 * and analytics code must never import it — that boundary is what keeps the
 * dashboard honest about reading the warehouse.
 */
export function createPostgresPool(config: AppConfig): Pool {
  const pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    // A readiness probe must fail fast rather than hang behind a dead socket.
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 10_000,
    max: 10,
  });

  // When an idle client's connection dies — PostgreSQL restarting, a dropped
  // socket — pg re-emits the failure as an 'error' event on the pool itself.
  // Node terminates the process on an unhandled 'error' event, so without this
  // listener a routine database restart would kill the API instead of leaving
  // it up to report the outage through /health.
  //
  // Only the reduced description is logged: a raw pg error can carry the
  // client's connection parameters.
  pool.on('error', (error) => {
    console.error(`[api] idle PostgreSQL client failed: ${describeError(error)}`);
  });

  return pool;
}

/** Probe OLTP reachability with the cheapest possible round trip. */
export async function checkPostgres(pool: Pool): Promise<DependencyState> {
  try {
    await pool.query('select 1');
    return { status: 'up' };
  } catch (error) {
    return {
      status: 'down',
      detail: describeError(error),
    };
  }
}

/**
 * Reduce an unknown thrown value to a short, safe diagnostic.
 *
 * pg attaches the failing client — and therefore its connection parameters,
 * password included — to some errors, so the object itself is never surfaced.
 * Only the driver code and message are used, any embedded connection URI is
 * redacted defensively, and the result is length-capped so a verbose driver
 * message cannot dominate a health response.
 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'unknown error';
  }

  const code = (error as { code?: string }).code;
  const message = error.message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[redacted-uri]')
    .trim()
    .slice(0, 160);

  if (code) {
    return message ? `${code}: ${message}` : code;
  }

  return message || error.name;
}
