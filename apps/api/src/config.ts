import { z } from 'zod';

/**
 * Environment contract for the API, mirroring the documented variables in
 * `.env.example`. Parsing happens once at startup and fails loudly: a service
 * that boots with a missing database password only to fail on the first
 * request is harder to diagnose than one that refuses to start.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),

  WAREHOUSE_PATH: z.string().min(1).default('/warehouse/sales.duckdb'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  /** Path to the published DuckDB file. Read-only from this process. */
  warehousePath: string;
}

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Build the typed configuration from an environment map. Takes `env` as an
 * argument rather than reading `process.env` directly so tests can supply a
 * fixture without mutating global state.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    // Report the variable names only. Values may contain credentials.
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(issues);
  }

  const value = parsed.data;

  return {
    nodeEnv: value.NODE_ENV,
    port: value.API_PORT,
    logLevel: value.LOG_LEVEL,
    postgres: {
      host: value.POSTGRES_HOST,
      port: value.POSTGRES_PORT,
      database: value.POSTGRES_DB,
      user: value.POSTGRES_USER,
      password: value.POSTGRES_PASSWORD,
    },
    warehousePath: value.WAREHOUSE_PATH,
  };
}
