import type { Customer, Order } from '../types';
import { getDataset } from './dataset';
import { getScenario } from './scenario';

/**
 * The published warehouse, as a snapshot rather than a live view.
 *
 * This is the architectural rule the UI has to make visible: analytics read a
 * DuckDB file that a pipeline run published, so an order created a moment ago is
 * *not* in it. Deriving fixture analytics from a snapshot taken at publish time
 * reproduces that faithfully — create an order, see the dashboard stay put, run
 * the pipeline, watch it move.
 */

export interface WarehouseSnapshot {
  readonly orders: readonly Order[];
  readonly customers: readonly Customer[];
  readonly publishedAt: string;
  readonly range: { readonly from: string; readonly to: string };
}

let snapshot: WarehouseSnapshot | undefined;
let initialised = false;

function initialise(): void {
  if (initialised) return;
  initialised = true;

  // Only the `ready` story starts with a published warehouse. Every other
  // scenario begins where a fresh clone begins: nothing has run yet.
  if (getScenario() === 'ready') publish();
}

/** Take a new snapshot, as an ETL run's atomic publish step would. */
export function publish(publishedAt: string = new Date().toISOString()): WarehouseSnapshot {
  initialised = true;

  const dataset = getDataset();
  snapshot = {
    orders: [...dataset.orders],
    customers: [...dataset.customers],
    publishedAt,
    range: dataset.range,
  };

  return snapshot;
}

/** `undefined` until a run has published, which is `warehouseReady: false`. */
export function getSnapshot(): WarehouseSnapshot | undefined {
  initialise();
  return snapshot;
}

/** Test seam: forget the published warehouse. */
export function resetWarehouse(): void {
  snapshot = undefined;
  initialised = false;
}
