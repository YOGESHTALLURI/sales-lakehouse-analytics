# @sales-lakehouse/web

The React interface for the sales lakehouse platform: sales management pages, the
warehouse-backed analytics dashboard, and pipeline control.

Part of the root npm workspace. Every command below can also be run from the
repository root with `--workspace @sales-lakehouse/web`.

```bash
npm install                # from the repository root, once
npm run dev                # http://localhost:5173
npm run typecheck
npm test
npm run build
```

---

## Running against the API

`GET /api/analytics/*` and `/api/pipeline/*` do not exist until Phases 3 and 4
merge, so **the UI serves itself from contract fixtures by default**.

| `VITE_API_FIXTURES` | Behaviour |
|---|---|
| unset or `1` (default) | Everything is served from fixtures. No backend needed. |
| `0` | Every request goes to the real API through the dev proxy. |

Flipping that flag is the only change required when the analytics endpoints land.
If anything else needs changing, the fixtures have drifted from the contract and
[`tests/fixtures.test.ts`](tests/fixtures.test.ts) is the place that should have
caught it.

Copy [`.env.example`](.env.example) to `.env.local` to override. `.env*` is
git-ignored, so the default lives in code rather than in an uncommittable file.

### Why a dev proxy rather than a base URL

The API has no CORS middleware, so a browser on `:5173` cannot call `:4000`
directly. [`vite.config.ts`](vite.config.ts) proxies `/api` and `/health`
instead, which means the app only ever uses relative paths and behaves the same
in development and in a container. No host name is compiled into the bundle.

To develop against the live backend:

```bash
# from the repository root
docker compose up -d --build
docker compose exec api npm run migrate
docker compose exec api npm run seed

VITE_API_FIXTURES=0 npm run dev --workspace @sales-lakehouse/web
```

### Fixture scenarios

The dashboard has four first-class states and only one of them is the happy path.
Each is reachable without editing code — append `?scenario=` to any URL:

| Scenario | What it shows |
|---|---|
| `ready` *(default)* | A published warehouse with twelve months of sales. |
| `empty-warehouse` | `warehouseReady: false`. Running the pipeline resolves it live. |
| `error` | Analytics and pipeline requests fail with `500`. |
| `pipeline-failure` | A run that settles as `failed` with an error summary. |

`http://localhost:5173/?scenario=empty-warehouse` is worth opening first: it is
the state a fresh clone actually starts in.

The fixture dataset is deterministic — one fixed seed, 501 customers, 100
products and 10,001 orders, matching the size of the seeded database so that
pagination and the documented limits are exercised for real. Analytics fixtures
are derived from those same orders, so every dashboard figure reconciles with the
order list, and from a **snapshot taken at publish time** rather than live data.
That reproduces the architecture's central rule: create an order, watch the
dashboard *not* change, run the pipeline, watch it move.

---

## Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | React 19 + TypeScript | [IMPLEMENTATION_PLAN.md §3](../../IMPLEMENTATION_PLAN.md) |
| Build | Vite | ” |
| Charts | Recharts 3 | ” — v3 because v2's peer range excludes React 19 |
| Styling | Tailwind CSS v4 | See the note below |
| Icons | lucide-react | Outline set, tree-shaken per icon |
| Routing | react-router | Filters and pagination are deep-linkable and survive the back button |
| Font | `@fontsource-variable/inter` | Self-hosted, so it works offline and in a container |
| Data fetching | none — `useAsync` | ~50 lines covers status, abort-on-unmount and refetch |
| State | React built-ins | One context for pipeline status; everything else is local or in the URL |
| Tests | Vitest + Testing Library | Workspace standard |

### The Tailwind decision

[`docs/frontend-brief.md`](../../docs/frontend-brief.md) §4 says "no CSS
framework". The repository owner asked for Tailwind explicitly, so this workspace
uses it; the brief and the instruction disagree and this note exists so the
divergence is not a surprise at review.

The argument for it: every colour, radius, shadow and font token is declared once
in [`src/styles/theme.css`](src/styles/theme.css) under Tailwind v4's `@theme`,
and a hard-coded value in a component is then visibly wrong. Hand-written CSS
applies no such pressure. Chart colours are consumed as `var(--color-chart-*)`
strings inside SVG paint attributes, so the palette has exactly one definition
rather than a TypeScript copy that drifts.

Spacing follows an 8px rhythm: even Tailwind steps only — 2, 4, 6, 8, 12.

---

## Layout

```
src/
  api/          Contract types, endpoint constants, the HTTP transport, fixtures
  app/          Route table, navigation, 404
  components/
    charts/     Recharts wrappers, chart theme, the data-table alternative
    layout/     App shell, sidebar, page header
    ui/         Button, Card, Badge, Field, Table, Pagination, StatCard, states
    DataPanel   The four panel states — loading, error, empty, warehouse-unbuilt
  features/     analytics · customers · orders · overview · pipeline · products
  hooks/        useAsync, usePolling, useSubmit, useQueryState, useAccumulatingList
  lib/          Formatting, date ranges, series bucketing, error descriptions
  styles/       Design tokens
```

Two rules hold the structure together:

- **`src/api/client.ts` is the only module that talks to the API.** No component
  knows a path, a verb or a query-string convention.
- **`src/components/DataPanel.tsx` decides the four states.** A dashboard where
  one card spins, another shows zeros and a third shows an error banner is how
  this UI would look broken.

---

## Accessibility

Not a pass at the end; these are the load-bearing ones.

- **Charts are paired with their numbers.** An SVG conveys nothing to a screen
  reader, so every chart carries a "View data table" disclosure containing the
  figures it plots. Sparklines are `aria-hidden` — the card's value and delta
  already say what they mean.
- **API validation reaches the right input.** A `400` carries `issues[]` with
  dotted paths, which [`useSubmit`](src/hooks/useSubmit.ts) maps onto fields via
  `aria-invalid` and `aria-describedby` rather than one banner.
- **Forms are pages, not modals** — linkable, no focus trap to get wrong, and the
  back button works as cancel.
- **Focus is always visible.** One `:focus-visible` rule in the token file; no
  component removes it.
- **Figures are tabular.** A measure going from `0` to `₹4,28,300` changes the
  digits without moving the layout.

## Money

Indian Rupees throughout, formatted only in [`src/lib/format.ts`](src/lib/format.ts).
`en-IN` regroups as well as re-symbolising: 428300 renders as **₹4,28,300**, and
compact axis labels use lakhs — **₹4.3L**, not ₹430K.

The one figure this UI derives is the KPI delta, computed from a second call over
the preceding equal-length window because the contract has no comparison field.
Everything else is rendered exactly as the API reported it. Before an order is
submitted the form shows an *estimated* total, because the API captures each
price inside the transaction and its total is the authoritative one.
