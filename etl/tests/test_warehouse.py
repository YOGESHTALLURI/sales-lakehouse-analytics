"""Transform, quality-gate and atomic-publish behaviour.

Runs entirely on a temp directory: the fixture snapshot is written to Parquet and
the warehouse is built from those files, exactly as a real run does after
downloading from the lake. No PostgreSQL, no MinIO.
"""

from __future__ import annotations

import shutil
from contextlib import closing
from decimal import Decimal
from pathlib import Path

import duckdb
import pytest

from conftest import make_snapshot
from etl.config import WarehouseConfig
from etl.lake import LakeRun, write_parquet_locally
from etl.quality import QualityError, run_checks
from etl.transform import build_star_schema
from etl.warehouse import build_and_publish


def _build(paths: dict[str, Path]) -> duckdb.DuckDBPyConnection:
    connection = duckdb.connect(":memory:")
    build_star_schema(connection, paths)
    return connection


def _scalar(connection: duckdb.DuckDBPyConnection, sql: str):
    return connection.execute(sql).fetchone()[0]


class TestStarSchema:
    def test_dimensions_are_populated(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            assert _scalar(connection, "select count(*) from dim_customer") == 2
            assert _scalar(connection, "select count(*) from dim_product") == 2

    def test_excludes_cancelled_orders_from_facts(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            # The fixture has 4 order items; one belongs to a cancelled order.
            # A cancelled order is not a sale, so counting it would inflate every
            # revenue figure the dashboard shows.
            assert _scalar(connection, "select count(*) from fact_sales") == 3

            cancelled_item = "f0000000-0000-4000-8000-000000000004"
            assert (
                _scalar(
                    connection,
                    f"select count(*) from fact_sales where order_item_id = '{cancelled_item}'",
                )
                == 0
            )

    def test_revenue_is_quantity_times_historical_price(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            total = _scalar(connection, "select sum(revenue) from fact_sales")

            # 2 x 1000.00  +  1 x 200.00  +  3 x 950.00
            assert total == Decimal("5050.00")

    def test_keeps_the_price_at_sale_not_the_catalogue_price(
        self, parquet_run: dict[str, Path]
    ) -> None:
        with closing(_build(parquet_run)) as connection:
            # The discounted line sold at 200.00 while the catalogue says 250.50.
            sold = _scalar(
                connection,
                """
                select unit_price from fact_sales
                 where order_item_id = 'f0000000-0000-4000-8000-000000000002'
                """,
            )
            catalogue = _scalar(
                connection, "select current_unit_price from dim_product where sku = 'GROC-0001'"
            )

            assert sold == Decimal("200.00")
            assert catalogue == Decimal("250.50")

    def test_date_dimension_is_gap_free(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            dates = [
                row[0].isoformat()
                for row in connection.execute(
                    "select full_date from dim_date order by full_date"
                ).fetchall()
            ]

            # Sales fall on 03-01 and 03-04. The two quiet days in between must
            # still exist, or the daily-revenue chart would skip them instead of
            # showing zero.
            assert dates == ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]

    def test_date_attributes_are_correct(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            row = connection.execute(
                """
                select date_key, day, month, month_name, quarter, year, is_weekend
                  from dim_date where full_date = '2026-03-01'
                """
            ).fetchone()

            # 1 March 2026 is a Sunday.
            assert row == (20260301, 1, 3, "March", 1, 2026, True)

    def test_surrogate_keys_are_deterministic(self, tmp_path: Path) -> None:
        # A full refresh must produce identical keys from identical raw data,
        # otherwise two rebuilds of the same lake run cannot be compared.
        snapshot = make_snapshot()
        first_paths = write_parquet_locally(snapshot, tmp_path / "a")
        second_paths = write_parquet_locally(snapshot, tmp_path / "b")

        with closing(_build(first_paths)) as first, closing(_build(second_paths)) as second:
            query = "select customer_id, customer_key from dim_customer order by customer_key"
            assert first.execute(query).fetchall() == second.execute(query).fetchall()

            facts = "select order_item_id, sale_key from fact_sales order by sale_key"
            assert first.execute(facts).fetchall() == second.execute(facts).fetchall()

    def test_every_fact_joins_to_all_three_dimensions(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            unjoinable = _scalar(
                connection,
                """
                select count(*) from fact_sales f
                  left join dim_customer c on c.customer_key = f.customer_key
                  left join dim_product  p on p.product_key  = f.product_key
                  left join dim_date     d on d.date_key     = f.date_key
                 where c.customer_key is null or p.product_key is null or d.date_key is null
                """,
            )
            assert unjoinable == 0

    def test_inactive_products_keep_their_sales_history(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            # GROC-0001 is retired but was sold. It must still appear in the
            # dimension and keep its fact, or historical revenue would vanish
            # when a product is withdrawn.
            sales = _scalar(
                connection,
                """
                select count(*) from fact_sales f
                  join dim_product p on p.product_key = f.product_key
                 where p.sku = 'GROC-0001' and p.active = false
                """,
            )
            assert sales == 1


class TestQualityChecks:
    def test_all_checks_pass_on_a_valid_warehouse(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            results = run_checks(connection)

            failed = [result for result in results if not result.passed]
            assert failed == []
            assert len(results) >= 12

    def test_detects_broken_revenue_arithmetic(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            # Proves the gate can actually fail rather than passing vacuously.
            connection.execute("update fact_sales set revenue = revenue + 1 where sale_key = 1")

            failed = {result.name for result in run_checks(connection) if not result.passed}
            assert "revenue_matches_quantity_times_price" in failed

    def test_the_schema_itself_refuses_to_orphan_a_fact(self, parquet_run: dict[str, Path]) -> None:
        # The `fact_joins_*` checks are defence in depth: the DDL's foreign keys
        # make an orphaned fact impossible in the first place, so the build fails
        # at insert rather than at the gate. Asserting the constraint fires is the
        # honest way to cover this invariant — pretending the check catches it
        # would be testing nothing.
        with (
            closing(_build(parquet_run)) as connection,
            pytest.raises(duckdb.ConstraintException),
        ):
            connection.execute("delete from dim_customer where customer_key = 1")

    def test_detects_a_gap_in_the_date_dimension(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            connection.execute("delete from dim_date where full_date = '2026-03-02'")

            failed = {result.name for result in run_checks(connection) if not result.passed}
            assert "date_dimension_gap_free" in failed

    def test_detects_an_incomplete_fact_table(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            connection.execute("delete from fact_sales where sale_key = 1")

            failed = {result.name for result in run_checks(connection) if not result.passed}
            assert "fact_count_matches_source" in failed

    def test_the_schema_itself_refuses_a_duplicated_order_item(
        self, parquet_run: dict[str, Path]
    ) -> None:
        # Same reasoning as above: `unique_order_item` is backstopped by a UNIQUE
        # constraint, so double-counting a sale cannot reach the gate.
        with (
            closing(_build(parquet_run)) as connection,
            pytest.raises(duckdb.ConstraintException),
        ):
            connection.execute(
                """
                    insert into fact_sales
                    select 99, order_id, order_item_id, customer_key, product_key,
                           date_key, quantity, unit_price, revenue
                      from fact_sales where sale_key = 1
                    """
            )

    def test_detects_a_negative_measure(self, parquet_run: dict[str, Path]) -> None:
        with closing(_build(parquet_run)) as connection:
            # No CHECK constraint covers sign, so this one genuinely depends on
            # the quality gate.
            connection.execute("update fact_sales set quantity = -1 where sale_key = 1")

            failed = {result.name for result in run_checks(connection) if not result.passed}
            assert "positive_quantity" in failed


class TestAtomicPublish:
    def _run(self) -> LakeRun:
        return LakeRun(
            run_id="00000000-0000-4000-8000-000000000000",
            run_date="2026-03-04",
            prefix="raw/run_date=2026-03-04/run_id=00000000-0000-4000-8000-000000000000/",
            files=[],
        )

    def test_publishes_and_records_provenance(
        self, parquet_run: dict[str, Path], tmp_path: Path
    ) -> None:
        config = WarehouseConfig(path=tmp_path / "warehouse" / "sales.duckdb")

        result = build_and_publish(config, self._run(), parquet_run, "2026-03-04T10:00:00Z")

        assert result.path.exists()
        assert result.warehouse_counts["fact_sales"] == 3

        with closing(duckdb.connect(str(config.path), read_only=True)) as connection:
            metadata = dict(
                connection.execute("select key, value from warehouse_metadata").fetchall()
            )

        # A warehouse file found on disk must be able to say where it came from.
        assert metadata["run_id"] == self._run().run_id
        assert metadata["lake_prefix"] == self._run().prefix
        assert metadata["excluded_order_statuses"] == "cancelled"

    def test_leaves_no_temporary_file_behind(
        self, parquet_run: dict[str, Path], tmp_path: Path
    ) -> None:
        config = WarehouseConfig(path=tmp_path / "sales.duckdb")

        build_and_publish(config, self._run(), parquet_run, "2026-03-04T10:00:00Z")

        assert not config.temp_path.exists()

    def test_drops_staging_views_so_the_published_file_stands_alone(
        self, parquet_run: dict[str, Path], tmp_path: Path
    ) -> None:
        config = WarehouseConfig(path=tmp_path / "sales.duckdb")
        build_and_publish(config, self._run(), parquet_run, "2026-03-04T10:00:00Z")

        # The views pointed at a temp directory that no longer exists. Leaving
        # them would hand the API a view onto missing files.
        with closing(duckdb.connect(str(config.path), read_only=True)) as connection:
            views = connection.execute(
                "select count(*) from duckdb_views() where view_name like 'raw_%'"
            ).fetchone()[0]

        assert views == 0

    def test_a_failing_build_leaves_the_previous_warehouse_untouched(
        self, parquet_run: dict[str, Path], tmp_path: Path
    ) -> None:
        config = WarehouseConfig(path=tmp_path / "sales.duckdb")

        # Publish a good warehouse first.
        build_and_publish(config, self._run(), parquet_run, "2026-03-04T10:00:00Z")
        good_bytes = config.path.read_bytes()

        # Now corrupt the source so the quality gate must reject the rebuild:
        # order_items references a product the products file no longer contains.
        broken = tmp_path / "broken"
        broken.mkdir()
        for path in parquet_run.values():
            shutil.copy(path, broken / path.name)

        with closing(duckdb.connect(":memory:")) as scratch:
            scratch.execute(
                f"""
                copy (
                    select * from read_parquet('{(broken / "order_items.parquet").as_posix()}')
                     where false
                ) to '{(broken / "order_items.parquet").as_posix()}' (format parquet)
                """
            )

        broken_paths = {name: broken / f"{name}.parquet" for name in parquet_run}

        with pytest.raises(QualityError):
            build_and_publish(config, self._run(), broken_paths, "2026-03-04T11:00:00Z")

        # Readers keep the last known-good warehouse. A silently wrong warehouse
        # is worse than a stale one.
        assert config.path.read_bytes() == good_bytes
        assert not config.temp_path.exists()
