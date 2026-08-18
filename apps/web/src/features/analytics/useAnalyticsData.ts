import { useCallback } from 'react';
import { api } from '../../api/client';
import type {
  DailySales,
  RevenueSummary,
  SalesByCity,
  SalesByProduct,
} from '../../api/types';
import { useAsync, type AsyncResult } from '../../hooks/useAsync';
import { previousRange, resolveRange, type RangePresetId } from '../../lib/dateRange';
import { usePipeline } from '../pipeline/PipelineProvider';

/**
 * Every warehouse query a dashboard needs, for one reporting window.
 *
 * The four requests run in parallel and each panel renders as soon as its own
 * resolves — a slow city aggregate does not hold up the revenue chart.
 *
 * `publishToken` is a dependency of all of them, which is how a successful
 * pipeline run refreshes the dashboard: the token changes, the queries re-run
 * against the newly published warehouse file.
 */

export interface AnalyticsData {
  readonly revenue: AsyncResult<RevenueSummary>;
  /**
   * The equal-length window before this one, for the KPI deltas. `undefined`
   * where no comparison exists, such as "all time".
   */
  readonly previous: AsyncResult<RevenueSummary | undefined>;
  readonly daily: AsyncResult<DailySales>;
  readonly byProduct: AsyncResult<SalesByProduct>;
  readonly byCity: AsyncResult<SalesByCity | undefined>;
  readonly refreshAll: () => void;
}

export interface AnalyticsOptions {
  readonly topN: number;
  /** The city breakdown is only shown on the analytics page. */
  readonly includeCity?: boolean;
}

export function useAnalyticsData(
  rangeId: RangePresetId,
  { topN, includeCity = false }: AnalyticsOptions,
): AnalyticsData {
  const { publishToken } = usePipeline();

  const range = resolveRange(rangeId);
  const comparison = previousRange(rangeId);

  const revenue = useAsync((signal) => api.revenue(range, signal), [
    range.from,
    range.to,
    publishToken,
  ]);

  const previous = useAsync<RevenueSummary | undefined>(
    (signal) => (comparison ? api.revenue(comparison, signal) : Promise.resolve(undefined)),
    [comparison?.from, comparison?.to, publishToken],
  );

  const daily = useAsync((signal) => api.dailySales(range, signal), [
    range.from,
    range.to,
    publishToken,
  ]);

  const byProduct = useAsync((signal) => api.salesByProduct({ ...range, topN }, signal), [
    range.from,
    range.to,
    topN,
    publishToken,
  ]);

  const byCity = useAsync<SalesByCity | undefined>(
    (signal) => (includeCity ? api.salesByCity(range, signal) : Promise.resolve(undefined)),
    [range.from, range.to, includeCity, publishToken],
  );

  const refreshAll = useCallback(() => {
    revenue.refresh();
    previous.refresh();
    daily.refresh();
    byProduct.refresh();
    byCity.refresh();
  }, [revenue, previous, daily, byProduct, byCity]);

  return { revenue, previous, daily, byProduct, byCity, refreshAll };
}
