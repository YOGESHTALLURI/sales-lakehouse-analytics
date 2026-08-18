/**
 * Chart configuration, defined once.
 *
 * Colours are `var(--color-chart-*)` strings rather than hex literals: SVG
 * resolves custom properties in `fill` and `stroke`, so the palette has exactly
 * one definition — src/styles/theme.css — instead of a duplicate list here that
 * silently drifts from it.
 */

export const CHART_SERIES = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)',
] as const;

export const CHART_INK = {
  grid: 'var(--color-chart-grid)',
  axis: 'var(--color-chart-axis)',
  track: 'var(--color-chart-track)',
} as const;

/** Series colour by index, wrapping rather than running out. */
export function seriesColor(index: number): string {
  return CHART_SERIES[index % CHART_SERIES.length] ?? CHART_SERIES[0];
}

/**
 * Axis label styling. Left uninferred rather than annotated as `SVGProps`:
 * Recharts narrows `tick` to its own text props, and the wider React type is not
 * assignable to it.
 */
export const AXIS_TICK = {
  fill: CHART_INK.axis,
  fontSize: 12,
};

export const CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

export const CHART_HEIGHT = 280;

/** Cartesian grid: horizontal rules only. Vertical lines add ink, not meaning. */
export const GRID_PROPS = {
  stroke: CHART_INK.grid,
  strokeDasharray: '3 3',
  vertical: false,
} as const;
