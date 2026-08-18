import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useQueryState } from '../../hooks/useQueryState';
import {
  comparisonLabel,
  DEFAULT_RANGE,
  isRangePresetId,
  type RangePresetId,
} from '../../lib/dateRange';
import { isGranularity, type Granularity } from '../../lib/series';
import { CategoryPanel } from '../analytics/CategoryPanel';
import { KpiCards } from '../analytics/KpiCards';
import { RangeSelect } from '../analytics/RangeSelect';
import { RevenuePanel } from '../analytics/RevenuePanel';
import { TopProductsPanel } from '../analytics/TopProductsPanel';
import { useAnalyticsData } from '../analytics/useAnalyticsData';
import { WarehouseNotice } from '../analytics/WarehouseNotice';
import { PipelineCard } from '../pipeline/PipelineCard';

const TOP_N = 5;

/**
 * The landing dashboard: headline measures, the revenue trend, category mix, the
 * best-selling products and the pipeline's state.
 *
 * Reporting window and granularity live in the URL, so a particular view of the
 * dashboard can be linked to and the back button steps through them.
 */
export function OverviewPage() {
  useDocumentTitle('Overview');

  const query = useQueryState();

  const rangeRaw = query.get('range');
  const rangeId: RangePresetId = isRangePresetId(rangeRaw) ? rangeRaw : DEFAULT_RANGE;

  const granularityRaw = query.get('by');
  const granularity: Granularity = isGranularity(granularityRaw) ? granularityRaw : 'daily';

  const data = useAnalyticsData(rangeId, { topN: TOP_N });
  const warehouseReady = data.revenue.data?.warehouseReady;

  return (
    <>
      <PageHeader
        title="Analytics overview"
        description="Warehouse-backed measures for the selected reporting window."
        actions={
          <RangeSelect value={rangeId} onChange={(value) => query.set({ range: value })} />
        }
      />

      <div className="space-y-6">
        {warehouseReady === false ? <WarehouseNotice /> : null}

        <KpiCards data={data} comparedWith={comparisonLabel(rangeId)} />

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <RevenuePanel
              result={data.daily}
              granularity={granularity}
              onGranularityChange={(value) => query.set({ by: value })}
            />
          </div>
          <CategoryPanel result={data.byProduct} />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <TopProductsPanel result={data.byProduct} topN={TOP_N} />
            <p className="mt-3 text-sm">
              <Link
                to="/analytics"
                className="inline-flex items-center gap-1.5 font-medium text-brand hover:text-brand-hover"
              >
                See the full analytics breakdown
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </p>
          </div>
          <PipelineCard />
        </div>
      </div>
    </>
  );
}
