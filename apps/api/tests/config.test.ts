import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const REQUIRED_ENV = {
  POSTGRES_DB: 'sales',
  POSTGRES_USER: 'sales_app',
  POSTGRES_PASSWORD: 'local_dev_password_change_me',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('applies documented defaults when only the required variables are set', () => {
    const config = loadConfig({ ...REQUIRED_ENV });

    expect(config.port).toBe(4000);
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.warehousePath).toBe('/warehouse/sales.duckdb');
    expect(config.postgres).toMatchObject({ host: 'localhost', port: 5432 });
  });

  it('coerces numeric variables supplied as strings', () => {
    const config = loadConfig({ ...REQUIRED_ENV, API_PORT: '4100', POSTGRES_PORT: '55432' });

    expect(config.port).toBe(4100);
    expect(config.postgres.port).toBe(55_432);
  });

  it('rejects a missing database password instead of starting', () => {
    const { POSTGRES_PASSWORD: _omitted, ...withoutPassword } = REQUIRED_ENV;

    expect(() => loadConfig(withoutPassword)).toThrow(ConfigError);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...REQUIRED_ENV, API_PORT: '70000' })).toThrow(ConfigError);
  });

  it('names the offending variable without echoing its value', () => {
    const secret = 'super-secret-value';

    try {
      loadConfig({ ...REQUIRED_ENV, POSTGRES_PASSWORD: secret, LOG_LEVEL: 'verbose' });
      expect.unreachable('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain('LOG_LEVEL');
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
