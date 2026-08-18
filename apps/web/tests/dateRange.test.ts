import { describe, expect, it } from 'vitest';
import {
  comparisonLabel,
  DEFAULT_RANGE,
  deltaRatio,
  isRangePresetId,
  previousRange,
  resolveRange,
} from '../src/lib/dateRange';

const TODAY = '2026-08-18';

describe('resolveRange', () => {
  it('includes today, so a 7-day window is 12–18 August', () => {
    expect(resolveRange('last-7', TODAY)).toEqual({ from: '2026-08-12', to: TODAY });
  });

  it('sends no bounds at all for all-time', () => {
    // The contract defaults to the earliest and latest fact when from/to are
    // absent, so guessing a wide range here would override the warehouse.
    expect(resolveRange('all', TODAY)).toEqual({});
  });
});

describe('previousRange', () => {
  it('is the equal-length window ending the day before this one starts', () => {
    expect(previousRange('last-7', TODAY)).toEqual({ from: '2026-08-05', to: '2026-08-11' });
  });

  it('does not overlap the current window', () => {
    const current = resolveRange('last-30', TODAY);
    const comparison = previousRange('last-30', TODAY);

    expect(comparison?.to).toBeDefined();
    expect(comparison?.to! < current.from!).toBe(true);
  });

  it('has no comparison for all-time', () => {
    expect(previousRange('all', TODAY)).toBeUndefined();
  });
});

describe('deltaRatio', () => {
  it('reports a rise as a positive fraction', () => {
    expect(deltaRatio(112.4, 100)).toBeCloseTo(0.124);
  });

  it('reports a fall as a negative fraction', () => {
    expect(deltaRatio(80, 100)).toBeCloseTo(-0.2);
  });

  it('declines to divide by a zero baseline', () => {
    // Growth from nothing is not a percentage, and "∞%" on a card is worse than
    // showing no delta at all.
    expect(deltaRatio(500, 0)).toBeUndefined();
  });
});

describe('preset identity', () => {
  it('accepts a known id and rejects anything else', () => {
    expect(isRangePresetId('last-30')).toBe(true);
    expect(isRangePresetId('last-31')).toBe(false);
    expect(isRangePresetId(null)).toBe(false);
  });

  it('describes the comparison window in words', () => {
    expect(comparisonLabel(DEFAULT_RANGE)).toBe('previous 30 days');
    expect(comparisonLabel('all')).toBe('previous period');
  });
});
