import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { checkPostgres, createPostgresPool } from '../src/dependencies/postgres.js';

const ENV = {
  POSTGRES_DB: 'sales',
  POSTGRES_USER: 'sales_app',
  POSTGRES_PASSWORD: 'local_dev_password_change_me',
} satisfies NodeJS.ProcessEnv;

// Creating a Pool does not open a connection, so these run without PostgreSQL.
function newPool() {
  return createPostgresPool(loadConfig(ENV));
}

describe('createPostgresPool', () => {
  it('listens for idle-client errors so a database restart cannot kill the process', async () => {
    const pool = newPool();

    // pg re-emits a dead idle client as an 'error' event on the pool. Node
    // terminates the process on an unhandled 'error' event, which is exactly
    // how a PostgreSQL restart used to take the API down with it.
    expect(pool.listenerCount('error')).toBeGreaterThan(0);

    await pool.end();
  });

  it('survives an idle-client failure instead of throwing', async () => {
    const pool = newPool();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(() =>
        pool.emit('error', new Error('terminating connection due to administrator command')),
      ).not.toThrow();
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
      await pool.end();
    }
  });

  it('does not log the database password when an idle client fails', async () => {
    const pool = newPool();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      pool.emit('error', new Error('terminating connection due to administrator command'));

      const output = logged.mock.calls.flat().map(String).join(' ');
      expect(output).not.toContain(ENV.POSTGRES_PASSWORD);
      expect(output).not.toMatch(/postgres:\/\//);
    } finally {
      logged.mockRestore();
      await pool.end();
    }
  });
});

describe('checkPostgres error reporting', () => {
  it('redacts a connection URI that a driver error embeds', async () => {
    const pool = newPool();
    const leaky = new Error(
      `could not connect to postgres://sales_app:${ENV.POSTGRES_PASSWORD}@postgres:5432/sales`,
    );

    // Force the failure path without a real server.
    vi.spyOn(pool, 'query').mockRejectedValue(leaky as never);

    const state = await checkPostgres(pool);

    expect(state.status).toBe('down');
    expect(state.detail).toContain('[redacted-uri]');
    expect(state.detail).not.toContain(ENV.POSTGRES_PASSWORD);

    vi.restoreAllMocks();
    await pool.end();
  });

  it('surfaces the driver code so a health response is actionable', async () => {
    const pool = newPool();
    const refused = Object.assign(new Error('connect ECONNREFUSED 172.18.0.2:5432'), {
      code: 'ECONNREFUSED',
    });

    vi.spyOn(pool, 'query').mockRejectedValue(refused as never);

    const state = await checkPostgres(pool);

    expect(state.status).toBe('down');
    expect(state.detail).toContain('ECONNREFUSED');

    vi.restoreAllMocks();
    await pool.end();
  });
});
