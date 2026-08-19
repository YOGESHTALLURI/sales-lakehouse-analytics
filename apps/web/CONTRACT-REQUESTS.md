# API contract notes from the frontend

[`docs/api/openapi.yaml`](../../docs/api/openapi.yaml) is the source of truth for
the API. This file records places where the UI worked around a contract gap
instead of editing the contract directly, so the workaround is not mistaken for
an oversight.

Nothing here blocks the current UI. Each item states what it does today without
the requested change.

---

## 1. No daily customer count in `daily-sales`

**Requested:** add `customerCount` to each `DailySales.series` entry, or document
that it is deliberately out of scope.

**Why:** `GET /api/analytics/daily-sales` returns `revenue`, `orderCount` and
`unitsSold` per day, so the KPI cards for revenue, orders, units and average
order value can each carry a trend sparkline. "Active customers" cannot — a
distinct count is not additive, so it cannot be derived from the other fields.

**Today:** the *Active customers* card renders with no sparkline and a footnote
instead. It is not faked from a proxy measure.

**Cost note:** `COUNT(DISTINCT customer_key)` per day is more expensive than the
existing sums. If that is unwelcome on the hot path, saying so is a complete
answer and the card stays as it is.

---

## 2. No search parameter on `/api/customers` or `/api/products`

**Requested:** a `search` query parameter matching name/email on customers and
name/SKU on products.

**Why:** the order form has to let a user pick one customer out of 501 and one
product out of 100. With no server-side search, the picker loads pages of 200
(the documented maximum) and filters what it holds in the browser.

**Today:** the customer picker loads 200 at a time with a "Load more" control and
filters the loaded rows client-side, telling the user how many of the total it is
currently searching. It works, but it is not a pattern that survives the
catalogue growing.

See [`src/hooks/useAccumulatingList.ts`](src/hooks/useAccumulatingList.ts).

---

## 3. No way to enumerate product categories

**Requested:** either `GET /api/products/categories`, or a `categories` facet on
the product list response.

**Why:** the products page and the order form both offer a category filter, which
needs the set of categories that exist.

**Today:** [`src/features/products/useCategories.ts`](src/features/products/useCategories.ts)
requests one page of products at `limit=200` and derives the distinct set. That
covers the current catalogue of 100 products exactly, and quietly stops being
correct at 201.

---

## Noted, not requested

These are contract details the UI has accommodated. No change is being asked
for — they are recorded so the handling is not mistaken for an oversight.

- **`Order.customerName` is not in the schema's `required` list**, though the live
  API does send it. The order table renders a shortened `customerId` when it is
  absent rather than assuming it.
- **`PipelineRun.rowCounts` keys are all optional.** The "Rows moved" panel renders
  per key present; a missing count is omitted rather than shown as `0`, which
  would claim the run moved no rows.
- **`WarehouseMeta.generatedAt` and `range` are optional *and* nullable.** Both
  absences are handled.
- **The `GET /:id` endpoints** implemented in `apps/api/src/routes/operational.ts`
  are not in the contract. Nothing in the UI depends on them; the list envelopes
  carry everything needed.
