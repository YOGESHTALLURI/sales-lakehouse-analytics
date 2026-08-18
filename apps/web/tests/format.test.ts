import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDate,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatMoneyPrecise,
  formatRelativeTime,
  parseCalendarDate,
  shiftIsoDate,
  todayIso,
} from '../src/lib/format';

/**
 * Money is the value most likely to be quietly wrong, because `en-IN` differs
 * from `en-US` in grouping as well as symbol.
 */

describe('money', () => {
  it('groups in lakhs, not thousands', () => {
    // The mockup's $428,300 is ₹4,28,300 here — not ₹428,300.
    expect(formatMoney(428_300)).toBe('₹4,28,300');
  });

  it('groups crores at the next boundary', () => {
    expect(formatMoney(18_422_750)).toBe('₹1,84,22,750');
  });

  it('keeps two decimals for catalogue prices and line totals', () => {
    expect(formatMoneyPrecise(306.2)).toBe('₹306.20');
  });

  it('uses lakh notation when compacted for an axis', () => {
    expect(formatMoneyCompact(430_000)).toContain('L');
    expect(formatMoneyCompact(430_000)).not.toContain('K');
  });

  it('renders zero without falling back to a dash', () => {
    expect(formatMoney(0)).toBe('₹0');
  });
});

describe('counts', () => {
  it('groups Indian-style', () => {
    expect(formatCount(10_001)).toBe('10,001');
    expect(formatCount(1_000_000)).toBe('10,00,000');
  });
});

describe('calendar dates', () => {
  it('parses a date-only string as local midnight, not UTC', () => {
    const parsed = parseCalendarDate('2026-08-18');

    // Parsing as UTC would render as the 17th anywhere west of Greenwich.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(18);
  });

  it('formats without shifting the day', () => {
    expect(formatDate('2026-08-18')).toBe('18 Aug 2026');
  });

  it('shifts across a month boundary', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('shifts across a leap day', () => {
    expect(shiftIsoDate('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('renders today in the same format the API expects', () => {
    expect(todayIso(new Date(2026, 7, 8))).toBe('2026-08-08');
  });
});

describe('durations and elapsed time', () => {
  it('describes sub-minute runs in seconds', () => {
    expect(formatDuration(7)).toBe('7s');
  });

  it('describes longer runs in minutes and seconds', () => {
    expect(formatDuration(92)).toBe('1m 32s');
    expect(formatDuration(120)).toBe('2m');
  });

  it('reports minutes elapsed since a run completed', () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z');
    const eightMinutesAgo = new Date(now - 8 * 60_000).toISOString();

    expect(formatRelativeTime(eightMinutesAgo, now)).toBe('8 minutes ago');
  });

  it('avoids "0 minutes ago" for something that just happened', () => {
    const now = Date.parse('2026-08-18T12:00:00.000Z');
    expect(formatRelativeTime(new Date(now - 5_000).toISOString(), now)).toBe('just now');
  });
});
