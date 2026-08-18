import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import type { AppConfig } from '../config.js';
import type { DependencyState } from './types.js';

/**
 * Probe the published DuckDB warehouse.
 *
 * A missing file is an expected state, not a fault: a freshly started stack has
 * no warehouse until the first pipeline run publishes one. `/health` therefore
 * reports it without failing readiness, and analytics endpoints will report
 * `warehouseReady: false` rather than substituting PostgreSQL results.
 */
export async function checkWarehouse(config: AppConfig): Promise<DependencyState> {
  try {
    await access(config.warehousePath, constants.R_OK);
  } catch {
    return {
      status: 'down',
      detail: 'warehouse not published yet; run the pipeline',
    };
  }

  try {
    const stats = await stat(config.warehousePath);

    if (!stats.isFile()) {
      return { status: 'down', detail: 'warehouse path is not a file' };
    }

    if (stats.size === 0) {
      return { status: 'down', detail: 'warehouse file is empty' };
    }

    return { status: 'up', detail: `published ${stats.mtime.toISOString()}` };
  } catch {
    return { status: 'unknown', detail: 'warehouse path could not be inspected' };
  }
}
