import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { DependencyChecks, DependencyState } from '../src/dependencies/types.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../src/version.js';

function appWith(postgres: DependencyState, warehouse: DependencyState) {
  const checks: DependencyChecks = {
    postgres: async () => postgres,
    warehouse: async () => warehouse,
  };
  return createApp({ checks });
}

describe('GET /health', () => {
  it('reports ok when PostgreSQL is up and the warehouse is published', async () => {
    const app = appWith({ status: 'up' }, { status: 'up', detail: 'published' });

    const response = await request(app).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      dependencies: {
        postgres: { status: 'up' },
        warehouse: { status: 'up' },
      },
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('stays ok when only the warehouse is missing', async () => {
    // A freshly started stack has no warehouse until the first pipeline run.
    // That is an expected state, not a fault, so readiness must not fail.
    const app = appWith(
      { status: 'up' },
      { status: 'down', detail: 'warehouse not published yet; run the pipeline' },
    );

    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.dependencies.warehouse.status).toBe('down');
  });

  it('reports degraded with 503 when PostgreSQL is unreachable', async () => {
    const app = appWith({ status: 'down', detail: 'Error (ECONNREFUSED)' }, { status: 'up' });

    const response = await request(app).get('/health').expect(503);

    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.postgres.status).toBe('down');
  });

  it('never leaks credentials in dependency detail', async () => {
    const app = appWith(
      { status: 'down', detail: 'Error (ECONNREFUSED)' },
      { status: 'down', detail: 'warehouse not published yet; run the pipeline' },
    );

    const response = await request(app).get('/health').expect(503);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toMatch(/password/i);
    expect(serialised).not.toMatch(/postgres:\/\//);
  });

  it('matches the version declared in package.json', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };

    expect(SERVICE_VERSION).toBe(pkg.version);
  });
});

describe('unmatched routes', () => {
  it('returns the documented error envelope', async () => {
    const app = appWith({ status: 'up' }, { status: 'up' });

    const response = await request(app).get('/does-not-exist').expect(404);

    expect(response.body).toEqual({
      error: { code: 'not_found', message: 'No route matches this request.' },
    });
  });
});
