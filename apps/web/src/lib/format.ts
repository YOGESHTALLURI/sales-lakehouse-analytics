/**
 * Every number, date and duration the UI renders is formatted here.
 *
 * Money is Indian Rupees, which is not a matter of swapping the symbol: `en-IN`
 * groups digits in lakhs and crores, so 428300 renders as ₹4,28,300 rather than
 * ₹428,300, and compact notation produces ₹4.3L rather than ₹430K. A component
 * that called `Intl` itself would eventually get one of those wrong.
 */

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const moneyPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const wholeNumber = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

const percent = new Intl.NumberFormat('en-IN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const timestamp = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const relative = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

/** Rounded to the rupee. For headline measures and aggregates. */
export function formatMoney(value: number): string {
  return money.format(value);
}

/** Two decimal places. For catalogue prices and line totals. */
export function formatMoneyPrecise(value: number): string {
  return moneyPrecise.format(value);
}

/** Lakh/crore compact notation. For chart axes and dense table cells. */
export function formatMoneyCompact(value: number): string {
  return moneyCompact.format(value);
}

export function formatCount(value: number): string {
  return wholeNumber.format(value);
}

/** `ratio` is a fraction: 0.124 renders as 12.4%. */
export function formatPercent(ratio: number): string {
  return percent.format(ratio);
}

/**
 * Parse an ISO calendar date as local midnight.
 *
 * `new Date('2026-08-18')` is parsed as UTC midnight, which formats as the
 * previous day in any negative-offset timezone. Order dates are calendar dates
 * with no timezone, so they must not be shifted by one.
 */
export function parseCalendarDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

/** `18 Aug` — for chart axes and other dense contexts. */
export function formatDayMonth(iso: string): string {
  return dayMonth.format(parseCalendarDate(iso));
}

/** `18 Aug 2026` — for calendar dates such as `orderDate`. */
export function formatDate(iso: string): string {
  return dayMonthYear.format(parseCalendarDate(iso));
}

/** `18 Aug 2026, 10:32 pm` — for RFC 3339 instants such as `createdAt`. */
export function formatDateTime(iso: string): string {
  return timestamp.format(new Date(iso));
}

export function formatDuration(seconds: number): string {
  if (seconds < 1) return 'under a second';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `8 minutes ago`. `now` is injectable so tests need no clock control. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return relative.format(-Math.round(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return relative.format(-Math.round(elapsed / HOUR), 'hour');
  return relative.format(-Math.round(elapsed / DAY), 'day');
}

/** Today as `YYYY-MM-DD` in the viewer's timezone. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Shift a calendar date by whole days, staying in `YYYY-MM-DD`. */
export function shiftIsoDate(iso: string, days: number): string {
  const date = parseCalendarDate(iso);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}
