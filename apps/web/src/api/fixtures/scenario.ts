/**
 * Which fixture story the UI is being shown.
 *
 * The dashboard has four first-class states and only one of them is the happy
 * path, so each is reachable without editing code: append `?scenario=<name>` to
 * any URL, or set `VITE_FIXTURE_SCENARIO`.
 */

export const FIXTURE_SCENARIOS = [
  /** Warehouse published and populated. */
  'ready',
  /** No pipeline has ever run. Every analytics measure is 0. */
  'empty-warehouse',
  /** Analytics and pipeline requests fail, so error states are visible. */
  'error',
  /** A pipeline run that settles as `failed` with an error summary. */
  'pipeline-failure',
] as const;

export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

export const SCENARIO_LABELS: Readonly<Record<FixtureScenario, string>> = {
  ready: 'Warehouse published',
  'empty-warehouse': 'Warehouse not built',
  error: 'Analytics unavailable',
  'pipeline-failure': 'Pipeline run fails',
};

function isScenario(value: string | null | undefined): value is FixtureScenario {
  return FIXTURE_SCENARIOS.some((scenario) => scenario === value);
}

function readInitialScenario(): FixtureScenario {
  const fromEnv = import.meta.env.VITE_FIXTURE_SCENARIO;
  if (isScenario(fromEnv)) return fromEnv;

  if (typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('scenario');
    if (isScenario(fromUrl)) return fromUrl;
  }

  return 'ready';
}

let current: FixtureScenario | undefined;

export function getScenario(): FixtureScenario {
  current ??= readInitialScenario();
  return current;
}

/** Switching scenario re-reads the world, so callers must reset fixture state. */
export function setScenario(scenario: FixtureScenario): void {
  current = scenario;
}
