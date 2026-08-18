# Warehouse directory

The DuckDB analytical warehouse lives here when the stack runs outside Docker,
and on the `warehouse-data` named volume when it runs under Compose
(`WAREHOUSE_PATH`, default `/warehouse/sales.duckdb`).

The database file is a **build artefact**, not source. It is produced by

```
docker compose run --rm etl python -m etl.run_pipeline
```

and is therefore git-ignored — only this README is committed. Rebuilding it
from PostgreSQL through the raw lake must always be possible from a clean
clone; if the file is ever missing, run the pipeline again.

The ETL writes a temporary database first and swaps it into place only after
every data-quality check passes, so readers never observe a half-built star
schema. The API opens this file read-only.
