# API

Express + TypeScript service. It owns two clearly separated responsibilities:

- **Operational endpoints** read and write PostgreSQL.
- **Analytics endpoints** read the DuckDB warehouse, never PostgreSQL.

The HTTP contract lives in [../../docs/api/openapi.yaml](../../docs/api/openapi.yaml).

## Implemented so far

| Endpoint | Status |
|---|---|
| `GET /health` | Available — dependency-aware readiness |
| `/api/customers`, `/api/products`, `/api/orders` | Phase 2 |
| `/api/pipeline/*` | Phase 4 |
| `/api/analytics/*` | Phase 4 |

## Commands

Run from the repository root:

```bash
npm install                              # installs the workspace
npm run typecheck --workspace @sales-lakehouse/api
npm test --workspace @sales-lakehouse/api
npm run dev --workspace @sales-lakehouse/api
```

`npm run dev` needs `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` in the
environment; everything else falls back to the defaults documented in
`.env.example`. Under Compose those values come from `.env` automatically.

## Design notes

- **Config is parsed once, at startup.** `loadConfig` validates the environment
  with Zod and throws before the server listens. A service that boots with a
  missing password and fails on the first request is harder to diagnose.
- **`loadConfig` takes the environment as an argument** rather than reading
  `process.env` internally, so tests supply fixtures without mutating globals.
- **Dependency probes are injected into `createApp`.** Every `/health` outcome —
  ready, warehouse-missing, database-down — is covered by tests that need no
  running infrastructure.
- **A missing warehouse is not a failure.** A fresh stack has no DuckDB file
  until the first pipeline run, so `/health` reports it and still returns 200.
  Only PostgreSQL is required for readiness.
- **Error detail never carries credentials.** pg attaches the failing client —
  and therefore its password — to some errors, so only the driver code and
  message are surfaced, any embedded connection URI is redacted, and the result
  is length-capped. Tests assert a planted password never reaches a response.
- **A PostgreSQL restart must not kill the API.** pg re-emits a dead idle client
  as an `'error'` event on the pool, and Node terminates the process on an
  unhandled `'error'` event. `createPostgresPool` attaches a listener, so an
  outage leaves the service up reporting `degraded`, and recovery is automatic.
  Verified live: stopping PostgreSQL yields `503`, restarting it yields `200`,
  with uptime unbroken.
- **The container exec's tsx directly, not `npm run dev`.** A supervisor process
  at PID 1 survives a crashed server, leaving the container `Up (unhealthy)`
  forever so Docker's restart policy never fires; it also swallows SIGTERM.
  Exec'ing tsx makes a fatal error exit the container and lets
  `docker compose stop` shut down gracefully in about a second.
