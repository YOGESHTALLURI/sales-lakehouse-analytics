# Frontend workstream brief (Phase 5)

This brief exists because Phase 5 (frontend) is being built **in parallel** with
Phases 3 and 4 (ETL, warehouse and analytics APIs) by a separate workstream. It
defines what the frontend owns, what it must not touch, and how it proceeds
before the analytics endpoints exist.

Read [CLAUDE.md](../CLAUDE.md) and [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)
first. This document adds the frontend-specific detail those two do not carry.

---

## 1. Scope

**In scope — everything under `apps/web/`:**

- Sales management pages: customers, products, order creation, order history
- Analytics dashboard: KPI cards, daily revenue chart, category and top-product
  charts, city breakdown
- Pipeline control panel: run button, live status, row counts, last success time
- Frontend tests

**Out of scope — do not edit these:**

| Path | Owner |
|---|---|
| `apps/api/**` | Backend workstream |
| `etl/**` | Backend workstream (Phase 3) |
| `data/postgres/**` | Backend workstream |
| `docs/api/openapi.yaml` | Backend workstream — the contract |
| `compose.yaml` | Backend workstream (adding the `etl` service concurrently) |
| `.github/workflows/**` | Backend workstream |
| `IMPLEMENTATION_PLAN.md`, root `README.md` | Coordinate before touching |

If the frontend needs a contract change, **do not edit the contract** — write the
request in `apps/web/CONTRACT-REQUESTS.md` and flag it. The backend workstream
owns `openapi.yaml` and two workstreams editing it will conflict.

**Branch:** `feat/frontend`, cut from the latest `main`.

---

## 2. Architecture in one screen

```
React UI ──> Express API ──> PostgreSQL      (operational: customers/products/orders)
             Express API ──> DuckDB          (analytics: read-only star schema)
                            Python ETL ──> MinIO (immutable raw Parquet) ──> DuckDB
```

The rule that matters for the UI: **analytics endpoints read the DuckDB
warehouse, never PostgreSQL.** The warehouse does not exist until a pipeline run
publishes it. So the dashboard has a first-class state the frontend must handle:

> `warehouseReady: false` — no pipeline has run yet. Every measure is `0`, every
> array empty. This is **not** an error. Show an empty state that tells the user
> to run the pipeline, with the run button right there.

Getting this wrong is the most likely way to ship a broken-looking dashboard.

---

## 3. What already exists

`main` currently has Phases 0–2 merged and working:

- **PostgreSQL schema** — `customers`, `products`, `orders`, `order_items`,
  `pipeline_runs`
- **Seeded data** — 500 customers across 30 Indian cities, 100 products across 10
  categories, 10,000 orders / ~21,000 line items over 12 months
- **Operational API, live and tested** — `POST`/`GET` for customers, products and
  orders, plus `GET /:id`
- **`GET /health`** — dependency-aware readiness
- **CI** — GitHub Actions on every push

**Not built yet (Phases 3–4, in flight):** `/api/analytics/*` and
`/api/pipeline/*`. They are fully specified in the contract, which is why you can
build against them now. See §5.

Start the backend you develop against:

```bash
cp .env.example .env
docker compose up -d --build
sh scripts/wait-for-services.sh
docker compose exec api npm run migrate
docker compose exec api npm run seed
curl -s localhost:4000/api/customers?limit=2
```

---

## 4. Stack and conventions

Chosen in [IMPLEMENTATION_PLAN.md §3](../IMPLEMENTATION_PLAN.md). Do not
substitute:

- **React + TypeScript + Vite**, added as the `apps/web` npm workspace
- **Recharts** for charts
- **Vitest** for tests (already the workspace standard), with
  `@testing-library/react`

Match the existing code's character — read `apps/api/src/` for the house style:

- `strict` TypeScript. No `any`, no non-null assertions to silence the compiler.
- Comments explain **why**, never what. If a line needs no explanation, it gets
  no comment.
- Dependency-light. Every new package needs a reason you can defend. In
  particular: no CSS framework, no state-management library, and no data-fetching
  library unless you can say concretely what hand-written code it replaces.
  React's built-ins plus a small `apiClient` module are enough at this size.
- Money is Indian Rupees. Format with
  `new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
  Never re-derive a total in the browser that the API already computed.

### Vite dev server, and why the proxy matters

The API currently has **no CORS middleware**, so a browser on `:5173` calling
`:4000` directly will be blocked. Use Vite's dev proxy instead — it is the right
tool regardless, and it keeps dev and production on the same relative URLs:

```ts
// vite.config.ts
server: {
  port: 5173,
  proxy: {
    '/api':    { target: 'http://localhost:4000', changeOrigin: true },
    '/health': { target: 'http://localhost:4000', changeOrigin: true },
  },
}
```

Then call `/api/...` with no host. The backend workstream will add server-side
CORS for the containerised build; do not wait for it.

---

## 5. The contract is the source of truth

[`docs/api/openapi.yaml`](api/openapi.yaml) fully specifies every endpoint,
including the four analytics ones that do not exist yet. **Read it — do not infer
shapes from this summary.** It is authoritative; the tables below are a map.

### Shapes you will consume

List endpoints return an envelope:

```ts
{ data: T[], pagination: { limit: number, offset: number, total: number } }
```

`limit` 1–200 (default 50), `offset` ≥ 0.

```ts
type Customer = { id, name, email, city, state, createdAt }
type Product  = { id, sku, name, category, unitPrice: number, active: boolean, createdAt }

type OrderItem = {
  id, productId, sku, productName,
  quantity: number, unitPriceAtSale: number, lineTotal: number
}
type Order = {
  id, customerId, customerName, orderDate, status,
  items: OrderItem[], itemCount: number, orderTotal: number, createdAt
}
type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'
```

Every analytics response carries the warehouse envelope:

```ts
type WarehouseMeta = {
  warehouseReady: boolean
  generatedAt: string | null
  range: { from: string | null, to: string | null }
}

type RevenueSummary  = WarehouseMeta & {
  totalRevenue, orderCount, customerCount, unitsSold, averageOrderValue
}
type SalesByProduct  = WarehouseMeta & {
  categories: { category, revenue, unitsSold, orderCount }[]
  topProducts: { productId, sku, name, category, revenue, unitsSold }[]
}
type SalesByCity     = WarehouseMeta & {
  cities: { city, state, revenue, orderCount, customerCount }[]
}
type DailySales      = WarehouseMeta & {
  series: { date, revenue, orderCount, unitsSold }[]   // gap-filled, ascending
}

type PipelineRun = {
  runId, status: 'running' | 'succeeded' | 'failed',
  startedAt, completedAt: string | null, durationSeconds: number | null,
  lakePrefix: string | null,
  rowCounts: { customers?, products?, orders?, orderItems?, factSales? },
  errorSummary: string | null
}
type PipelineStatus = { current: PipelineRun | null, lastSuccessful: PipelineRun | null }
```

`daily-sales` is gap-filled from `dim_date`, so days with no sales arrive as zero
rather than being absent — plot the series as given, do not fill gaps yourself.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/customers` | `limit`, `offset` |
| `POST` | `/api/customers` | `{name, email, city, state}` → 201 · 400 · **409** duplicate email |
| `GET` | `/api/products` | `limit`, `offset`, `category`, `active` |
| `POST` | `/api/products` | `{sku, name, category, unitPrice, active?}` → 201 · 400 · **409** duplicate SKU |
| `GET` | `/api/orders` | `limit`, `offset`, `customerId`, `status`, `from`, `to` |
| `POST` | `/api/orders` | see below → 201 · 400 · **404** · **409** |
| `POST` | `/api/pipeline/run` | 202 accepted · **409** a run is already active |
| `GET` | `/api/pipeline/status` | poll this while a run is active |
| `GET` | `/api/analytics/revenue` | `from`, `to` |
| `GET` | `/api/analytics/sales-by-product` | `from`, `to`, `topN` (default 10) |
| `GET` | `/api/analytics/sales-by-city` | `from`, `to` |
| `GET` | `/api/analytics/daily-sales` | `from`, `to` |

Order creation body:

```json
{
  "customerId": "uuid",
  "orderDate": "2026-08-18",
  "status": "pending",
  "items": [{ "productId": "uuid", "quantity": 2, "unitPriceAtSale": 799.99 }]
}
```

`orderDate` defaults to today and may not be in the future. `unitPriceAtSale` is
optional — omit it and the server captures the catalogue price inside the
transaction. 1–50 items, quantity 1–1000.

### Errors — and the one that improves your forms

```ts
{ error: { code: string, message: string, issues?: { path: string, message: string }[] } }
```

`message` is safe to display. On a `400`, `issues[]` gives **per-field** errors
with dotted paths (`"email"`, `"items.1.productId"`). Map those onto the
corresponding inputs rather than showing one banner — the API is doing the work
for you.

Codes worth handling distinctly:

| Code | Status | Meaning for the UI |
|---|---|---|
| `validation_failed` | 400 | Field-level errors in `issues[]` |
| `conflict` | 409 | Duplicate email or SKU — point at that field |
| `customer_not_found` | 404 | Stale selection; refresh the list |
| `product_not_found` | 404 | Stale selection; refresh the list |
| `product_inactive` | 409 | Product is retired. Exclude inactive products from the order form (`?active=true`) so this is rare — but handle it |

Two rules the order form must respect, both enforced server-side:

- **One line per product.** A repeated product returns 400 on
  `items.<n>.productId`. Merge into a single line with a larger quantity in the
  UI instead of letting the user create duplicates.
- **Only active products** may be added to a new order.

---

## 6. Working before Phases 3 and 4 land

You are **not blocked**. Build the whole dashboard against the contract:

1. One `apiClient` module is the only place that talks HTTP. Types come from the
   contract shapes above.
2. Add fixtures matching the contract exactly, including a
   `warehouseReady: false` variant and an error variant. Serve them behind a flag
   (e.g. `VITE_API_FIXTURES=1`) so the full UI is demoable today.
3. Tests use the fixtures directly and must never need a running backend — the
   existing suites hold that line and CI depends on it.

When the analytics endpoints land, flipping the flag off should be the only
change required. If it is not, the fixtures drifted from the contract.

Keep the operational pages (customers, products, orders) on the **real** API from
the start — those endpoints exist and are seeded with 10,000 orders, which is
also a genuine test of pagination.

---

## 7. What to build

Per [IMPLEMENTATION_PLAN.md §9](../IMPLEMENTATION_PLAN.md), Phase 5:

### Sales management
- **Customers** — paginated list, create form
- **Products** — paginated list with category and active filters, create form
- **Orders** — history list with status and date filters, expandable line items
- **Create order** — pick a customer, add multiple products with quantities,
  running total, submit atomically

### Analytics dashboard
- **KPI cards** — total revenue, orders, customers, units, average order value
- **Daily revenue** — time series from `daily-sales`
- **Category and top products** — from `sales-by-product`
- **City breakdown** — from `sales-by-city`
- Every panel needs **loading, empty, error and `warehouseReady: false`** states

### Pipeline control
- Run button → `POST /api/pipeline/run`
- Poll `GET /api/pipeline/status` while `status === 'running'`; **stop polling**
  when it settles, and stop on unmount
- Show row counts, duration, last successful run, and `errorSummary` on failure
- Disable the button while a run is active; handle the 409 if it races
- When a run succeeds, refresh the dashboard queries

### Quality bar
- Keyboard usable: real `<label>`s, focus states, forms submittable by Enter
- Charts need accessible text alternatives — a screen reader gets nothing from an
  SVG, so pair each chart with the underlying numbers in a table or summary
- No layout shift when a number goes from `0` to a real value

---

## 8. Verification before handing work over

```bash
npm run typecheck --workspace @sales-lakehouse/web
npm test --workspace @sales-lakehouse/web
npm run build --workspace @sales-lakehouse/web    # must pass; CI will run it
```

Then check the real thing in a browser against the running API: create a
customer, create a product, create a multi-item order, and confirm it appears in
the order list. A green test suite is not evidence the app works.

---

## 9. Git rules

These are not negotiable and differ from common defaults:

- **Never run `git add`, `git commit`, `git push` or `git merge`.** The repository
  owner does all of it. Hand over a ready-to-paste Conventional Commit message
  instead.
- **Never add a `Co-Authored-By` trailer** to a commit message.
- Never work directly on `main`. Never force-push or rewrite history.
- Commit in coherent slices — scaffold, then sales pages, then dashboard, then
  pipeline panel — not one large commit at the end.
- Before each handoff, report: files changed, checks run with their results, and
  the suggested commit message.

`main` will move while you work, as Phases 3 and 4 merge. Ask the repository
owner to pull and merge `main` into `feat/frontend` at those points rather than
doing it yourself.

### The one merge conflict to expect

Both workstreams add npm dependencies, so **`package-lock.json` will conflict**.
It is generated, so do not hand-resolve it. On conflict:

```bash
git checkout --theirs package-lock.json   # or --ours; either is a starting point
npm install                               # regenerates it correctly
```

`apps/web/package.json` needs no change to the root `package.json` — the root
already declares `workspaces: ["apps/*"]`, so a new `apps/web/package.json` is
picked up by `npm install` automatically. Do not edit the root manifest.
