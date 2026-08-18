import type { DateRangeQuery } from '../api/types';
import { shiftIsoDate, todayIso } from './format';

/**
 * Reporting windows, expressed the way the analytics endpoints take them.
 *
 * `all` sends no `from`/`to` at all, which is how the contract says to ask for
 * "the earliest fact to the latest" — guessing a wide range instead would be a
 * client-side opinion about data the warehouse owns.
 */

export const RANGE_PRESETS = [
  { id: 'last-7', label: 'Last 7 days', days: 7 },
  { id: 'last-30', label: 'Last 30 days', days: 30 },
  { id: 'last-90', label: 'Last 90 days', days: 90 },
  { id: 'last-365', label: 'Last 12 months', days: 365 },
  { id: 'all', label: 'All time', days: null },
] as const;

export type RangePresetId = (typeof RANGE_PRESETS)[number]['id'];

export const DEFAULT_RANGE: RangePresetId = 'last-30';

export function isRangePresetId(value: string | null | undefined): value is RangePresetId {
  return RANGE_PRESETS.some((preset) => preset.id === value);
}

export function rangePresetLabel(id: RangePresetId): string {
  return RANGE_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}

export function resolveRange(id: RangePresetId, today: string = todayIso()): DateRangeQuery {
  const preset = RANGE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset || preset.days === null) return {};

  return { from: shiftIsoDate(today, -(preset.days - 1)), to: today };
}

/**
 * The equal-length window immediately before this one.
 *
 * The KPI deltas the design asks for have no field in the contract, so they are
 * computed from a second call over this window. `undefined` where there is no
 * comparison to make — "all time" has nothing before it.
 */
export function previousRange(id: RangePresetId, today: string = todayIso()): DateRangeQuery | undefined {
  const preset = RANGE_PRESETS.find((candidate) => candidate.id === id);
  if (!preset || preset.days === null) return undefined;

  const current = resolveRange(id, today);
  if (!current.from) return undefined;

  const to = shiftIsoDate(current.from, -1);
  return { from: shiftIsoDate(to, -(preset.days - 1)), to };
}

/** How the delta is described to the reader, and to a screen reader. */
export function comparisonLabel(id: RangePresetId): string {
  const preset = RANGE_PRESETS.find((candidate) => candidate.id === id);
  return preset?.days === null || preset === undefined
    ? 'previous period'
    : `previous ${preset.days} days`;
}

/** Signed fraction, or `undefined` when there is no meaningful baseline. */
export function deltaRatio(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return (current - previous) / previous;
}
