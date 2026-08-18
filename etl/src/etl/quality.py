"""Data-quality gate between building a warehouse and publishing it.

Every check runs against the freshly built temporary database. If any fails, the
run is marked failed and the previously published warehouse is left untouched —
readers keep the last known-good star schema rather than being handed a broken
one. A warehouse that is silently wrong is worse than a warehouse that is stale.
"""

from __future__ import annotations

from dataclasses import dataclass

import duckdb


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str


class QualityError(RuntimeError):
    def __init__(self, failures: list[CheckResult]) -> None:
        summary = "; ".join(f"{failure.name}: {failure.detail}" for failure in failures)
        super().__init__(f"{len(failures)} data-quality check(s) failed — {summary}")
        self.failures = failures


def _scalar(connection: duckdb.DuckDBPyConnection, sql: str) -> int:
    row = connection.execute(sql).fetchone()
    return int(row[0]) if row and row[0] is not None else 0


def run_checks(connection: duckdb.DuckDBPyConnection) -> list[CheckResult]:
    """Assert every invariant the star schema promises.

    Some of these are also enforced by the DDL — foreign keys make an orphaned
    fact impossible, UNIQUE makes a double-counted sale impossible — so those
    build failures surface at insert rather than here. They are kept as defence in
    depth: if a constraint is ever relaxed for a load-performance reason, the gate
    still holds. The checks that only this gate can catch are the arithmetic,
    completeness, sign and date-coverage ones.
    """
    results: list[CheckResult] = []

    def check(name: str, sql: str, expectation: str) -> None:
        offenders = _scalar(connection, sql)
        results.append(
            CheckResult(
                name=name,
                passed=offenders == 0,
                detail=expectation if offenders else "ok",
            )
        )

    # ── The warehouse must not be empty ──────────────────────────────────────
    facts = _scalar(connection, "select count(*) from fact_sales")
    results.append(
        CheckResult(
            name="fact_sales_not_empty",
            passed=facts > 0,
            detail="ok" if facts else "fact_sales has no rows; the warehouse would be useless",
        )
    )

    # ── Every fact joins to all three dimensions ─────────────────────────────
    # A star schema whose facts do not join is not a star schema. Left joins are
    # used deliberately: an inner join would hide the very rows being looked for.
    check(
        "fact_joins_customer",
        """
        select count(*) from fact_sales f
          left join dim_customer d on d.customer_key = f.customer_key
         where d.customer_key is null
        """,
        "fact rows reference a missing dim_customer",
    )
    check(
        "fact_joins_product",
        """
        select count(*) from fact_sales f
          left join dim_product d on d.product_key = f.product_key
         where d.product_key is null
        """,
        "fact rows reference a missing dim_product",
    )
    check(
        "fact_joins_date",
        """
        select count(*) from fact_sales f
          left join dim_date d on d.date_key = f.date_key
         where d.date_key is null
        """,
        "fact rows reference a missing dim_date",
    )

    # ── No null keys or measures ─────────────────────────────────────────────
    check(
        "no_null_keys",
        """
        select count(*) from fact_sales
         where sale_key is null or order_id is null or order_item_id is null
            or customer_key is null or product_key is null or date_key is null
            or quantity is null or unit_price is null or revenue is null
        """,
        "fact rows contain a null key or measure",
    )

    # ── Business identifiers unique within their dimension ───────────────────
    check(
        "unique_customer_id",
        """
        select count(*) from (
            select customer_id from dim_customer group by customer_id having count(*) > 1
        )
        """,
        "dim_customer repeats a customer_id",
    )
    check(
        "unique_product_sku",
        """
        select count(*) from (
            select sku from dim_product group by sku having count(*) > 1
        )
        """,
        "dim_product repeats a sku",
    )
    check(
        "unique_order_item",
        """
        select count(*) from (
            select order_item_id from fact_sales group by order_item_id having count(*) > 1
        )
        """,
        "fact_sales contains the same order item twice",
    )

    # ── The arithmetic the whole warehouse rests on ──────────────────────────
    check(
        "revenue_matches_quantity_times_price",
        """
        select count(*) from fact_sales
         where revenue <> cast(quantity * unit_price as decimal(14,2))
        """,
        "revenue does not equal quantity * unit_price",
    )

    # ── Measures are in a sane domain ────────────────────────────────────────
    check(
        "positive_quantity",
        "select count(*) from fact_sales where quantity <= 0",
        "fact rows have a non-positive quantity",
    )
    check(
        "non_negative_price",
        "select count(*) from fact_sales where unit_price < 0 or revenue < 0",
        "fact rows have a negative price or revenue",
    )

    # ── Completeness against the source read back from the lake ─────────────
    # The count deliberately excludes cancelled orders, matching the transform.
    # An equality check against all order_items would fail by exactly the
    # cancellation rate and mask a real completeness bug behind an expected gap.
    expected = _scalar(
        connection,
        """
        select count(*)
          from raw_order_items i
          join raw_orders o on o.id = i.order_id
         where o.status not in ('cancelled')
        """,
    )
    results.append(
        CheckResult(
            name="fact_count_matches_source",
            passed=facts == expected,
            detail=(
                "ok"
                if facts == expected
                else f"fact_sales has {facts} rows, non-cancelled source items number {expected}"
            ),
        )
    )

    # ── dim_date must be gap-free ───────────────────────────────────────────
    # The daily-revenue chart relies on this: a missing day would silently vanish
    # from the series rather than showing zero.
    span = connection.execute(
        "select count(*), date_diff('day', min(full_date), max(full_date)) + 1 from dim_date"
    ).fetchone()
    rows, expected_days = (int(span[0]), int(span[1])) if span and span[0] else (0, 0)
    results.append(
        CheckResult(
            name="date_dimension_gap_free",
            passed=rows == expected_days,
            detail=(
                "ok"
                if rows == expected_days
                else f"dim_date has {rows} rows across a {expected_days}-day span"
            ),
        )
    )

    # ── Every sold day exists in the date dimension ─────────────────────────
    check(
        "all_sold_days_present",
        """
        select count(*) from (
            select distinct o.order_date
              from raw_orders o
              join raw_order_items i on i.order_id = o.id
             where o.status not in ('cancelled')
               and o.order_date not in (select full_date from dim_date)
        )
        """,
        "a day with sales is missing from dim_date",
    )

    return results


def assert_quality(connection: duckdb.DuckDBPyConnection) -> list[CheckResult]:
    """Run every check and raise if any failed."""
    results = run_checks(connection)
    failures = [result for result in results if not result.passed]

    if failures:
        raise QualityError(failures)

    return results
