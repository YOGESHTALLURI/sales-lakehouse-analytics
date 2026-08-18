import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

/**
 * Support for integration specs that need a real PostgreSQL.
 *
 * Each spec provisions its own throwaway database, so a spec can never see
 * another spec's rows and can never touch the development database.
 */

/**
 * Load the repository `.env` if present.
 *
 * Integration tests run from the host, where the API's Compose environment does
 * not apply, so connection settings come from `.env` with `.env.example`
 * defaults as the fallback. Parsed here rather than with a dependency: the file
 * format we need is `KEY=value` lines.
 */
function loadDotEnv(): Record<string, string> {
  const url = new URL('../../../../../.env', import.meta.url);
  const parsed: Record<string, string> = {};

  let contents: string;
  try {
    contents = readFileSync(url, 'utf8');
  } catch {
    return parsed;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    parsed[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }

  return parsed;
}

const dotEnv = loadDotEnv();

function setting(key: string, fallback: string): string {
  return process.env[key] ?? dotEnv[key] ?? fallback;
}

export interface ConnectionSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Database used to issue CREATE/DROP DATABASE. */
  adminDatabase: string;
}

export function connectionSettings(): ConnectionSettings {
  return {
    // From the host, PostgreSQL is published on POSTGRES_HOST_PORT, not the
    // in-network 5432 that the API container uses.
    host: setting('POSTGRES_TEST_HOST', 'localhost'),
    port: Number.parseInt(setting('POSTGRES_HOST_PORT', '55432'), 10),
    user: setting('POSTGRES_USER', 'sales_app'),
    password: setting('POSTGRES_PASSWORD', 'local_dev_password_change_me'),
    adminDatabase: setting('POSTGRES_DB', 'sales'),
  };
}

/** Fail with an actionable message rather than an opaque ECONNREFUSED. */
export async function assertPostgresReachable(): Promise<void> {
  const settings = connectionSettings();
  const pool = new Pool({ ...settings, database: settings.adminDatabase, max: 1 });

  try {
    await pool.query('select 1');
  } catch (error) {
    throw new Error(
      `Integration tests need PostgreSQL on ${settings.host}:${settings.port}. ` +
        'Start it with `docker compose up -d postgres`. ' +
        `Original error: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  } finally {
    await pool.end();
  }
}

export interface TemporaryDatabase {
  name: string;
  pool: Pool;
  drop(): Promise<void>;
}

let counter = 0;

/**
 * Create an empty database and return a pool connected to it.
 *
 * The name is derived from a caller-supplied label and a per-process counter
 * rather than randomness, so a leaked database is traceable to the spec that
 * created it.
 */
export async function createTemporaryDatabase(label: string): Promise<TemporaryDatabase> {
  const settings = connectionSettings();
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24);
  const name = `test_${safeLabel}_${process.pid}_${++counter}`;

  const admin = new Pool({ ...settings, database: settings.adminDatabase, max: 1 });

  try {
    // Identifiers cannot be parameterised; the name is built from a sanitised
    // label, a pid and a counter, so it contains only [a-z0-9_].
    await admin.query(`drop database if exists "${name}"`);
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }

  const pool = new Pool({ ...settings, database: name, max: 4 });
  pool.on('error', () => {
    // A throwaway database is dropped while pools may still hold idle clients.
    // Swallowing here keeps that teardown race from failing an otherwise green
    // spec; the production pool logs instead (see dependencies/postgres.ts).
  });

  return {
    name,
    pool,
    async drop() {
      await pool.end();

      const cleanup = new Pool({ ...settings, database: settings.adminDatabase, max: 1 });
      try {
        await cleanup.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
