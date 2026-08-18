import { RefreshCw } from 'lucide-react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useQueryState } from '../../hooks/useQueryState';
import {
  comparisonLabel,
  DEFAULT_RANGE,
  isRangePresetId,
  type RangePresetId,
} from '../../lib/dateRange';
import { formatDate, formatDateTime } from '../../lib/format';
import { isGranularity, type Granularity } from '../../lib/series';
import { CategoryPanel } from './CategoryPanel';
import { CityPanel } from './CityPanel';
import { KpiCards } from './KpiCards';
import { RangeSelect } from './RangeSelect';
import { RevenuePanel } from './RevenuePanel';
import { TopProductsPanel } from './TopProductsPanel';
import { useAnalyticsData } from './useAnalyticsData';
import { WarehouseNotice } from './WarehouseNotice';
import { TOP_N } from '../../api/endpoints';

/**
 * The full analytics view: everything the overview shows, plus the city
 * breakdown and the window the warehouse actually applied.
 */
export function AnalyticsPage() {
  useDocumentTitle('Analytics');

  const query = useQueryState();

  const rangeRaw = query.get('range');
  const rangeId: RangePresetId = isRangePresetId(rangeRaw) ? rangeRaw : DEFAULT_RANGE;

  const granularityRaw = query.get('by');
  const granularity: Granularity = isGranularity(granularityRaw) ? granularityRaw : 'daily';

  const data = useAnalyticsData(rangeId, { topN: TOP_N.default, includeCity: true });

  const meta = data.revenue.data;
  const warehouseReady = meta?.warehouseReady;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={describeSource()}
        actions={
          <>
            <RangeSelect value={rangeId} onChange={(value) => query.set({ range: value })} />
            <Button variant="secondary" onClick={data.refreshAll}>
              <RefreshCw aria-hidden className="size-4" />
              Refresh
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {warehouseReady === false ? <WarehouseNotice /> : null}

        <KpiCards data={data} comparedWith={comparisonLabel(rangeId)} />

        <RevenuePanel
          result={data.daily}
          granularity={granularity}
          onGranularityChange={(value) => query.set({ by: value })}
        />

        <div className="grid gap-6 xl:grid-cols-2">
          <CategoryPanel result={data.byProduct} />
          <TopProductsPanel result={data.byProduct} topN={TOP_N.default} />
        </div>

        <CityPanel result={data.byCity} />
      </div>
    </>
  );

  /**
   * The warehouse reports the window it applied and when it was published, which
   * is more honest than repeating what was asked for.
   */
  function describeSource(): string {
    if (!meta?.warehouseReady) {
      return 'Every measure here is read from the DuckDB warehouse, never from the operational database.';
    }

    const from = meta.range?.from;
    const to = meta.range?.to;
    const window = from && to ? `${formatDate(from)} to ${formatDate(to)}` : 'all available dates';
    const published = meta.generatedAt
      ? `, published ${formatDateTime(meta.generatedAt)}`
      : '';

    return `Warehouse data covering ${window}${published}.`;
  }
}
