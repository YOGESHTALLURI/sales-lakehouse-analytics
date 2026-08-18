/** Reachability of one dependency, as documented in docs/api/openapi.yaml. */
export interface DependencyState {
  status: 'up' | 'down' | 'unknown';
  /** Short diagnostic hint. Never contains credentials or connection strings. */
  detail?: string;
}

/**
 * The readiness probes GET /health runs. Injected into the app so tests can
 * exercise every health outcome without a running database or warehouse.
 */
export interface DependencyChecks {
  postgres(): Promise<DependencyState>;
  warehouse(): Promise<DependencyState>;
}
