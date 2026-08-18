import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError } from '../http/errors.js';
import { enqueueRun, getStatus } from '../repositories/pipeline.js';
import {
  getDailySales,
  getRevenueSummary,
  getSalesByCity,
  getSalesByProduct,
} from '../warehouse/analytics.js';

/**
 * Analytics and pipeline-control routes.
 *
 * The analytics handlers receive only a warehouse path — no pool — so there is
 * nothing for them to fall back to. The pipeline handlers take the pool because
 * `pipeline_runs` is operational state, which is a different boundary.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date as YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

const rangeQuery = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    topN: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'The start of the range is after its end.',
    path: ['from'],
  });

function parseRange(query: unknown) {
  const result = rangeQuery.safeParse(query);
  if (!result.success) {
    throw ApiError.fromZod(result.error);
  }
  return result.data;
}

export interface AnalyticsRouterOptions {
  warehousePath: string;
  pool: Pool;
}

export function createAnalyticsRouter({ warehousePath, pool }: AnalyticsRouterOptions): Router {
  const router = Router();

  router.get('/api/analytics/revenue', async (request, response) => {
    const { from, to } = parseRange(request.query);
    response.json(await getRevenueSummary(warehousePath, { from, to }));
  });

  router.get('/api/analytics/sales-by-product', async (request, response) => {
    const { from, to, topN } = parseRange(request.query);
    response.json(await getSalesByProduct(warehousePath, { from, to }, topN));
  });

  router.get('/api/analytics/sales-by-city', async (request, response) => {
    const { from, to } = parseRange(request.query);
    response.json(await getSalesByCity(warehousePath, { from, to }));
  });

  router.get('/api/analytics/daily-sales', async (request, response) => {
    const { from, to } = parseRange(request.query);
    response.json(await getDailySales(warehousePath, { from, to }));
  });

  // 202, not 201: the run is accepted for the ETL worker to execute, and no
  // resource is complete at the moment of the response.
  router.post('/api/pipeline/run', async (_request, response) => {
    response.status(202).json(await enqueueRun(pool));
  });

  router.get('/api/pipeline/status', async (_request, response) => {
    response.json(await getStatus(pool));
  });

  return router;
}
