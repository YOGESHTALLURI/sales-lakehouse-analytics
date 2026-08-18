import type { DailySalesPoint } from '../api/types';
import { parseCalendarDate } from './format';

/**
 * Display transformations over the daily series.
 *
 * The API returns one gap-filled point per day and that is what gets plotted.
 * Bucketing to weeks or months, and thinning a 365-point series down to a
 * sparkline, change how the same numbers are *drawn* — no measure is recomputed
 * that the warehouse already reported.
 */

export const GRANULARITIES = ['daily', 'weekly', 'monthly'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const GRANULARITY_LABELS: Readonly<Record<Granularity, string>> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function isGranularity(value: string | null | undefined): value is Granularity {
  return GRANULARITIES.some((candidate) => candidate === value);
}

export interface SeriesPoint extends DailySalesPoint {
  /** Human label for the bucket, e.g. `18 Aug` or `Aug 2026`. */
  readonly label: string;
  /** Inclusive end of the bucket, for the tooltip on weekly and monthly views. */
  readonly endDate: string;
}

const MONTHS = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' });
const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });

function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === 'monthly') return date.slice(0, 7);
  if (granularity === 'daily') return date;

  // ISO weeks start on Monday; group by the Monday that owns the day.
  const parsed = parseCalendarDate(date);
  const weekday = (parsed.getDay() + 6) % 7;
  parsed.setDate(parsed.getDate() - weekday);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

export function bucketSeries(
  series: readonly DailySalesPoint[],
  granularity: Granularity,
): SeriesPoint[] {
  const buckets = new Map<string, { point: DailySalesPoint; endDate: string }>();

  for (const point of series) {
    const key = bucketKey(point.date, granularity);
    const existing = buckets.get(key);

    if (existing) {
      existing.point.revenue += point.revenue;
      existing.point.orderCount += point.orderCount;
      existing.point.unitsSold += point.unitsSold;
      existing.endDate = point.date;
      continue;
    }

    buckets.set(key, {
      point: { date: key, revenue: point.revenue, orderCount: point.orderCount, unitsSold: point.unitsSold },
      endDate: point.date,
    });
  }

  return [...buckets.values()].map(({ point, endDate }) => ({
    ...point,
    revenue: Math.round(point.revenue * 100) / 100,
    endDate,
    label:
      granularity === 'monthly'
        ? MONTHS.format(parseCalendarDate(`${point.date}-01`))
        : DAY_MONTH.format(parseCalendarDate(point.date)),
  }));
}

/**
 * Thin a series to at most `target` points by averaging equal-width buckets.
 *
 * A sparkline is ~120px wide; drawing 365 points into it produces noise rather
 * than a trend.
 */
export function downsample(values: readonly number[], target: number): number[] {
  if (values.length <= target) return [...values];

  const size = values.length / target;
  const output: number[] = [];

  for (let bucket = 0; bucket < target; bucket += 1) {
    const start = Math.floor(bucket * size);
    const end = Math.min(values.length, Math.floor((bucket + 1) * size));
    let sum = 0;

    for (let index = start; index < end; index += 1) sum += values[index] ?? 0;
    output.push(end > start ? sum / (end - start) : 0);
  }

  return output;
}
