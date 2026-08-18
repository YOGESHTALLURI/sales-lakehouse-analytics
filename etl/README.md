# ETL: PostgreSQL → immutable lake → DuckDB warehouse

One command performs one full, auditable run:

```bash
docker compose run --rm etl python -m etl.run_pipeline
docker compose run --rm etl python -m etl.run_pipeline --verbose        # log every step
docker compose run --rm etl python -m etl.run_pipeline --release-stale  # after a killed run
```

Tests:

```bash
docker compose run --rm etl python -m pytest -q                          # unit, no services
docker compose run --rm -e ETL_INTEGRATION=1 etl python -m pytest -q     # + end-to-end
docker compose run --rm etl sh -c 'ruff check src tests && ruff format --check src tests'
```

Python is only needed inside the container. Nothing here has to be installed on
the host.

## What a run does

| Step | Module | Why it is a separate step |
|---|---|---|
| 1. Claim the active-run slot | `audit.py` | A partial unique index on `pipeline_runs` makes two concurrent runs impossible at the database level |
| 2. Extract one snapshot | `extract.py` | Single REPEATABLE READ transaction across all four tables |
| 3. Write Parquet, checksum, upload | `lake.py` | Checksums are computed over the bytes actually sent |
| 4. Upload the manifest | `lake.py` | Makes the run auditable without opening a Parquet file |
| 5. **Read the run back from the lake** | `lake.py` | See below — this is the step that matters |
| 6. Build the star schema, run checks | `transform.py`, `quality.py` | Nothing is published until every invariant holds |
| 7. Publish atomically | `warehouse.py` | `Path.replace` — readers never see a half-built warehouse |
| 8. Record the outcome | `audit.py` | A failed run leaves a sanitised summary, not silence |

### Step 5 is the one that makes this a lake

Building the warehouse from the snapshot still in memory would be faster, and it
would make the lake a decorative copy that nothing depends on — a broken round
trip would go unnoticed until someone actually needed the raw history. So the
warehouse is built from files downloaded back out of MinIO, with every SHA-256
verified against the manifest first. If the round trip is broken, the run fails.

## Decisions worth knowing

**Cancelled orders are excluded from `fact_sales`.** A cancelled order is not a
sale; counting it would inflate every revenue figure the dashboard shows by the
cancellation rate. Nothing is lost — the rows stay in PostgreSQL and in the lake
forever — they simply are not facts. The completeness check compares against
*non-cancelled* source items, so a real completeness bug cannot hide behind the
expected gap. `warehouse_metadata.excluded_order_statuses` records this inside
the published file.

**Money is `decimal128(12,2)` end to end.** PostgreSQL `numeric` → Arrow decimal →
Parquet decimal → DuckDB `decimal`. A float anywhere in that chain would lose
exactness invisibly, and a test asserts the type survives the round trip.

**Surrogate keys are rebuilt deterministically** with `row_number()` over the
natural key. The pipeline is a full refresh, so two rebuilds from the same lake
run must produce identical keys — otherwise nothing downstream could be compared.

**`dim_date` is generated, not derived from the facts**, spanning every day in
range. A day with no sales must exist as a zero, or the daily-revenue chart would
silently skip it.

**The transform is SQL, not dataframes.** The work is relational — joins,
grouping, key assignment — and SQL states the modelling decisions where a reviewer
can read them. This is why the plan's suggested Polars dependency is not used: it
would add a heavy dependency to express the same joins less clearly. PyArrow
handles Parquet I/O; DuckDB handles the transform.

**Quality checks are partly defence in depth.** Foreign keys and `UNIQUE` in the
warehouse DDL already make an orphaned fact or a double-counted sale impossible,
so those failures surface at insert rather than at the gate. The checks only this
gate can catch are the arithmetic, completeness, sign and date-coverage ones —
those are the ones with tests proving they fail when violated.

## Verified behaviour

Confirmed against the running stack, not only in tests:

- 10,001 orders / 21,103 items extracted → 19,836 facts. The 1,267 difference is
  exactly the cancelled orders, which the completeness check asserts.
- Two consecutive runs produce **identical file checksums** (Parquet output is
  deterministic for unchanged data) but **separate run prefixes** — the lake
  accumulates rather than overwrites.
- A run pointed at a non-existent bucket fails, records a sanitised summary, and
  leaves the published warehouse **byte-identical**, with no `.tmp` residue.
- A second concurrent run exits `2` and is refused by the database index.

## Configuration

Everything comes from the environment documented in `.env.example`: `POSTGRES_*`,
`MINIO_*`, `LAKE_BUCKET`, `LAKE_RAW_PREFIX`, `WAREHOUSE_PATH`. `config.py` parses
it once and fails loudly, because discovering a wrong bucket name after extracting
20,000 rows wastes the run and muddies the audit trail.

## Lake layout

```text
s3://sales-lake/raw/run_date=2026-08-18/run_id=<uuid>/
    customers.parquet
    products.parquet
    orders.parquet
    order_items.parquet
    manifest.json     row counts, per-file SHA-256, schema and pipeline version
```

Hive-style partitioning, so any engine can prune by date or run. Bucket
versioning is enabled by `infra/minio/create-bucket.sh`, and a run refuses to
write into a prefix that already holds objects — three independent reasons a
previous extract cannot be destroyed.
