import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import type { DependencyChecks } from './dependencies/types.js';
import { ApiError } from './http/errors.js';
import { createHealthRouter } from './routes/health.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createOperationalRouter } from './routes/operational.js';

export interface AppOptions {
  checks: DependencyChecks;
  /** Path to the published DuckDB file. Analytics routes mount only when set. */
  warehousePath?: string;
  /**
   * OLTP pool for the operational routes. Omit to mount only /health, which is
   * how the health specs avoid needing a database.
   */
  pool?: Pool;
}

/**
 * Build the Express application.
 *
 * Dependency probes and the pool are injected rather than constructed here so
 * tests can drive every outcome, and so later phases can add routes without this
 * factory learning how each store is reached.
 */
export function createApp({ checks, pool, warehousePath }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter(checks));

  if (pool) {
    app.use(createOperationalRouter(pool));

    if (warehousePath) {
      app.use(createAnalyticsRouter({ warehousePath, pool }));
    }
  }

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: { code: 'not_found', message: 'No route matches this request.' },
    });
  });

  app.use(errorHandler);

  return app;
}

/**
 * Terminal error handler.
 *
 * An ApiError is a deliberate, documented outcome and is rendered as thrown.
 * Anything else is a bug: it is logged in full and reported as a bare 500,
 * because a driver error can carry the connection string, and a stack trace
 * tells a caller about internals they have no business seeing.
 */
function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.status).json(error.toBody());
    return;
  }

  // A malformed JSON body is surfaced by express.json as a SyntaxError with a
  // status. It is a client mistake, not a server fault.
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    response.status(400).json({
      error: { code: 'validation_failed', message: 'Request body is not valid JSON.', issues: [] },
    });
    return;
  }

  console.error(`[api] unhandled error on ${request.method} ${request.path}`, error);

  response.status(500).json({
    error: { code: 'internal_error', message: 'An unexpected error occurred.' },
  });
}
