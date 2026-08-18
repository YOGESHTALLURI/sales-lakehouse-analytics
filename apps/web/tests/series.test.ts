import { describe, expect, it } from 'vitest';
import type { DailySalesPoint } from '../src/api/types';
import { bucketSeries, downsample, isGranularity } from '../src/lib/series';

function point(date: string, revenue: number, orders = 1, units = 2): DailySalesPoint {
  return { date, revenue, orderCount: orders, unitsSold: units };
}

describe('bucketSeries', () => {
  const series = [
    point('2026-08-03', 100), // Monday
    point('2026-08-04', 200),
    point('2026-08-09', 50), // Sunday, same ISO week
    point('2026-08-10', 400), // Monday, next week
    point('2026-09-01', 25),
  ];

  it('leaves the daily series exactly as the API sent it', () => {
    const daily = bucketSeries(series, 'daily');

    expect(daily).toHaveLength(series.length);
    expect(daily.map((row) => row.revenue)).toEqual([100, 200, 50, 400, 25]);
  });

  it('sums whole ISO weeks, Monday to Sunday', () => {
    const weekly = bucketSeries(series, 'weekly');

    expect(weekly).toHaveLength(3);
    expect(weekly[0]?.revenue).toBe(350);
    expect(weekly[1]?.revenue).toBe(400);
  });

  it('sums calendar months', () => {
    const monthly = bucketSeries(series, 'monthly');

    expect(monthly).toHaveLength(2);
    expect(monthly[0]?.revenue).toBe(750);
    expect(monthly[1]?.revenue).toBe(25);
  });

  it('carries order and unit counts through the same buckets', () => {
    const monthly = bucketSeries(series, 'monthly');

    expect(monthly[0]?.orderCount).toBe(4);
    expect(monthly[0]?.unitsSold).toBe(8);
  });

  it('keeps zero-revenue days rather than dropping them', () => {
    // The series is gap-filled by the warehouse; discarding the zeros here would
    // silently reintroduce the gaps.
    const withGap = bucketSeries([point('2026-08-03', 0), point('2026-08-04', 10)], 'daily');
    expect(withGap).toHaveLength(2);
  });
});

describe('downsample', () => {
  it('returns the input untouched when it already fits', () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it('averages into the requested number of buckets', () => {
    expect(downsample([0, 10, 20, 30], 2)).toEqual([5, 25]);
  });

  it('never returns an empty bucket for a non-empty series', () => {
    const result = downsample(Array.from({ length: 365 }, (_, index) => index), 28);

    expect(result).toHaveLength(28);
    expect(result.every((value) => Number.isFinite(value))).toBe(true);
  });
});

describe('isGranularity', () => {
  it('guards the value that arrives from the URL', () => {
    expect(isGranularity('weekly')).toBe(true);
    expect(isGranularity('hourly')).toBe(false);
    expect(isGranularity(null)).toBe(false);
  });
});
