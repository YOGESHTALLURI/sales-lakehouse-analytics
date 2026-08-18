"""End-to-end pipeline run against real PostgreSQL and real MinIO.

Requires the Compose stack, so it is skipped unless `ETL_INTEGRATION=1`:

    docker compose run --rm -e ETL_INTEGRATION=1 etl python -m pytest -q

This is the spec that proves the pieces compose. The unit specs each verify one
module against fixtures; only this one exercises a repeatable-read extract, a real
S3 upload, a real download with checksum verification, a DuckDB build on a shared
volume, and the PostgreSQL audit record — in that order, as a single run.
"""

from __future__ import annotations

import uuid
from contextlib import closing

import duckdb
import pytest
from sqlalchemy import text

from conftest import skip_without_services
from etl.audit import release_stale_running_runs
from etl.config import load_config
from etl.extract import create_postgres_engine, extract_snapshot
from etl.lake import create_s3_client, read_manifest
from etl.run_pipeline import main

pytestmark = [pytest.mark.integration, skip_without_services]


@pytest.fixture
def config():
    return load_config()


@pytest.fixture
def engine(config):
    engine = create_postgres_engine(config.postgres)
    # A previous spec or a killed container may hold the single active-run slot.
    release_stale_running_runs(engine)
    yield engine
    engine.dispose()


def _latest_run(engine) -> dict[str, object]:
    with engine.connect() as connection:
        row = connection.execute(
            text(
                """
                select id::text as id, status, row_counts, lake_prefix, error_summary
                  from pipeline_runs
                 order by started_at desc
                 limit 1
                """
            )
        ).one()
    return dict(row._mapping)


class TestFullRun:
    def test_a_run_succeeds_and_publishes_a_queryable_warehouse(self, config, engine) -> None:
        assert main([]) == 0

        record = _latest_run(engine)
        assert record["status"] == "succeeded"
        assert record["error_summary"] is None
        assert record["lake_prefix"].startswith("raw/run_date=")

        counts = record["row_counts"]
        assert counts["orders"] > 0
        assert counts["factSales"] > 0

        # The warehouse must be readable by exactly the access pattern the API
        # uses: read-only, on the shared volume.
        with closing(duckdb.connect(str(config.warehouse.path), read_only=True)) as connection:
            facts = connection.execute("select count(*) from fact_sales").fetchone()[0]
            assert facts == counts["factSales"]

            # The star schema must actually join, which is the whole point of it.
            revenue = connection.execute(
                """
                select sum(f.revenue)
                  from fact_sales f
                  join dim_customer c on c.customer_key = f.customer_key
                  join dim_product  p on p.product_key  = f.product_key
                  join dim_date     d on d.date_key     = f.date_key
                """
            ).fetchone()[0]
            assert revenue > 0

    def test_the_warehouse_knows_which_lake_run_produced_it(self, config, engine) -> None:
        assert main([]) == 0
        record = _latest_run(engine)

        with closing(duckdb.connect(str(config.warehouse.path), read_only=True)) as connection:
            metadata = dict(
                connection.execute("select key, value from warehouse_metadata").fetchall()
            )

        assert metadata["run_id"] == record["id"]
        assert metadata["lake_prefix"] == record["lake_prefix"]

    def test_the_manifest_describes_the_run_that_was_uploaded(self, config, engine) -> None:
        assert main([]) == 0
        record = _latest_run(engine)

        client = create_s3_client(config.lake)
        manifest = read_manifest(client, config.lake, record["lake_prefix"])

        assert manifest["run_id"] == record["id"]
        assert len(manifest["files"]) == 4
        assert all(len(file["sha256"]) == 64 for file in manifest["files"])
        assert manifest["row_counts"]["orders"] == record["row_counts"]["orders"]

    def test_consecutive_runs_add_to_the_lake_instead_of_replacing(self, config, engine) -> None:
        assert main([]) == 0
        first = _latest_run(engine)["lake_prefix"]

        assert main([]) == 0
        second = _latest_run(engine)["lake_prefix"]

        assert first != second

        # Both prefixes must still hold a full run. The lake is the raw history;
        # a run that overwrote its predecessor would destroy it.
        client = create_s3_client(config.lake)
        for prefix in (first, second):
            listing = client.list_objects_v2(Bucket=config.lake.bucket, Prefix=prefix)
            assert listing["KeyCount"] == 5, prefix

    def test_a_second_concurrent_run_is_refused(self, engine) -> None:
        with engine.begin() as connection:
            connection.execute(text("insert into pipeline_runs (status) values ('running')"))

        try:
            # Exit code 2 is the documented "already running" outcome. Enforced by
            # a partial unique index, so two ETL containers cannot both proceed.
            assert main([]) == 2
        finally:
            release_stale_running_runs(engine)

    def test_release_stale_frees_a_blocked_slot(self, engine) -> None:
        with engine.begin() as connection:
            connection.execute(text("insert into pipeline_runs (status) values ('running')"))

        assert main(["--release-stale"]) == 0
        assert _latest_run(engine)["status"] == "succeeded"


class TestFailureHandling:
    def test_a_failed_run_is_recorded_and_leaves_the_warehouse_intact(
        self, config, engine, monkeypatch
    ) -> None:
        assert main([]) == 0
        good_bytes = config.warehouse.path.read_bytes()

        # Point at a bucket that does not exist, so the run fails after claiming
        # its slot but before writing anything.
        monkeypatch.setenv("LAKE_BUCKET", f"missing-{uuid.uuid4()}")

        assert main([]) == 1

        record = _latest_run(engine)
        assert record["status"] == "failed"
        assert record["error_summary"]

        # Readers keep the last known-good warehouse.
        assert config.warehouse.path.read_bytes() == good_bytes
        assert not config.warehouse.temp_path.exists()


class TestExtractConsistency:
    def test_the_snapshot_is_referentially_complete(self, engine) -> None:
        snapshot = extract_snapshot(engine)

        customer_ids = set(snapshot.tables["customers"].column("id").to_pylist())
        order_ids = set(snapshot.tables["orders"].column("id").to_pylist())

        # Reading the four tables in separate transactions could produce an order
        # whose items are missing, or items whose order is missing. One
        # repeatable-read transaction is what rules that out.
        for customer_id in snapshot.tables["orders"].column("customer_id").to_pylist():
            assert customer_id in customer_ids

        for order_id in snapshot.tables["order_items"].column("order_id").to_pylist():
            assert order_id in order_ids

    def test_money_arrives_as_exact_decimal_not_float(self, engine) -> None:
        snapshot = extract_snapshot(engine)

        prices = snapshot.tables["order_items"].column("unit_price_at_sale")

        # decimal128(12,2): a float column would lose exactness before the data
        # ever reached Parquet.
        assert str(prices.type) == "decimal128(12, 2)"
