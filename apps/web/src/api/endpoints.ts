/**
 * Every path the UI knows about, in one place. No component builds a URL.
 */
export const API_PATHS = {
  health: '/health',
  customers: '/api/customers',
  products: '/api/products',
  orders: '/api/orders',
  pipelineRun: '/api/pipeline/run',
  pipelineStatus: '/api/pipeline/status',
  revenue: '/api/analytics/revenue',
  salesByProduct: '/api/analytics/sales-by-product',
  salesByCity: '/api/analytics/sales-by-city',
  dailySales: '/api/analytics/daily-sales',
} as const;

export type ApiPath = (typeof API_PATHS)[keyof typeof API_PATHS];

/** Contract-documented pagination bounds. */
export const PAGE_LIMITS = {
  min: 1,
  max: 200,
  default: 50,
} as const;

/** Contract-documented `topN` bounds for sales-by-product. */
export const TOP_N = {
  min: 1,
  max: 100,
  default: 10,
} as const;
