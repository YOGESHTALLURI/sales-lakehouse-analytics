import { Router } from 'express';
import type { DependencyChecks, DependencyState } from '../dependencies/types.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../version.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  dependencies: {
    postgres: DependencyState;
    warehouse: DependencyState;
  };
}

/**
 * Dependencies that must be reachable for the API to call itself ready.
 *
 * PostgreSQL is required: every operational endpoint needs it. The warehouse is
 * deliberately absent — it does not exist until a pipeline run publishes it, and
 * reporting a brand-new stack as unhealthy for that reason would be misleading.
 */
const REQUIRED: ReadonlyArray<keyof HealthReport['dependencies']> = ['postgres'];

export function createHealthRouter(checks: DependencyChecks): Router {
  const router = Router();

  router.get('/health', async (_request, response) => {
    // Probe concurrently: a slow dependency should not serialise behind another.
    const [postgres, warehouse] = await Promise.all([
      checks.postgres(),
      checks.warehouse(),
    ]);

    const dependencies = { postgres, warehouse };
    const ready = REQUIRED.every((name) => dependencies[name].status === 'up');

    const report: HealthReport = {
      status: ready ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      dependencies,
    };

    // 503 lets Docker, Compose and any orchestrator act on readiness directly.
    response.status(ready ? 200 : 503).json(report);
  });

  return router;
}
