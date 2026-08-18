import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { DependencyChecks } from './dependencies/types.js';
import { createHealthRouter } from './routes/health.js';

export interface AppOptions {
  checks: DependencyChecks;
}

/**
 * Build the Express application.
 *
 * Dependency probes are injected rather than constructed here so tests can
 * drive every health outcome without a database, and so later phases can add
 * routes without this factory growing knowledge of how each store is reached.
 */
export function createApp({ checks }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter(checks));

  app.use((_request: Request, response: Response) => {
    response.status(404).json({
      error: { code: 'not_found', message: 'No route matches this request.' },
    });
  });

  app.use(errorHandler);

  return app;
}

/**
 * Terminal error handler. Logs the cause and returns the documented envelope
 * without the stack trace or any driver detail, which can contain credentials.
 */
function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  console.error('[api] unhandled error', error);

  response.status(500).json({
    error: {
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    },
  });
}
