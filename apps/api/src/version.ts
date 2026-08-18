/**
 * Service identity reported by GET /health.
 *
 * Kept as a constant rather than read from package.json at runtime so the value
 * is identical whether the service runs from `src` via tsx or from compiled
 * `dist`. A test asserts it stays in step with package.json.
 */
export const SERVICE_NAME = 'sales-lakehouse-api';
export const SERVICE_VERSION = '0.1.0';
