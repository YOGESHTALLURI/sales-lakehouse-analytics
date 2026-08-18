"""Shared fixtures.

The unit specs build snapshots in memory and warehouses in a temp directory, so
they need neither PostgreSQL nor MinIO. Only specs marked `integration` do.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pyarrow as pa
import pytest

from etl.extract import SCHEMAS, Snapshot


def _table(name: str, rows: list[dict[str, object]]) -> pa.Table:
    """Build one table against its declared schema.

    Going through SCHEMAS rather than letting Arrow infer types means a fixture
    that would not survive the real Parquet round trip fails here.
    """
    schema = SCHEMAS[name]
    columns = [[row[field.name] for row in rows] for field in schema]
    return pa.Table.from_arrays(
        [pa.array(column, type=field.type) for column, field in zip(columns, schema, strict=True)],
        schema=schema,
    )


def make_snapshot(
    *,
    include_cancelled: bool = True,
    include_gap_day: bool = True,
) -> Snapshot:
    """A small, hand-checked dataset whose expected aggregates are obvious.

    Deliberately tiny: every assertion in the warehouse specs can be verified by
    reading this fixture, which is not true of the 10,000-order seed.
    """
    created = datetime(2026, 1, 1, 9, 30, tzinfo=UTC)

    customers = _table(
        "customers",
        [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "name": "Aarav Sharma",
                "email": "aarav@example.com",
                "city": "Pune",
                "state": "Maharashtra",
                "created_at": created,
            },
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "name": "Meera Nair",
                "email": "meera@example.com",
                "city": "Kochi",
                "state": "Kerala",
                "created_at": created,
            },
        ],
    )

    products = _table(
        "products",
        [
            {
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "sku": "ELEC-0001",
                "name": "Headphones",
                "category": "Electronics",
                "unit_price": Decimal("1000.00"),
                "active": True,
                "created_at": created,
            },
            {
                "id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "sku": "GROC-0001",
                "name": "Filter Coffee",
                "category": "Grocery & Gourmet",
                "unit_price": Decimal("250.50"),
                "active": False,
                "created_at": created,
            },
        ],
    )

    order_rows: list[dict[str, object]] = [
        {
            "id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "customer_id": "11111111-1111-4111-8111-111111111111",
            "order_date": date(2026, 3, 1),
            "status": "delivered",
            "created_at": created,
        },
        {
            "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "customer_id": "22222222-2222-4222-8222-222222222222",
            # Three days later, leaving 2026-03-02 and 03-03 with no sales, so
            # dim_date gap-filling has something to prove.
            "order_date": date(2026, 3, 4) if include_gap_day else date(2026, 3, 1),
            "status": "confirmed",
            "created_at": created,
        },
    ]

    item_rows: list[dict[str, object]] = [
        {
            "id": "f0000000-0000-4000-8000-000000000001",
            "order_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "product_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "quantity": 2,
            "unit_price_at_sale": Decimal("1000.00"),
        },
        {
            "id": "f0000000-0000-4000-8000-000000000002",
            "order_id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "product_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            # Below catalogue price on purpose: the warehouse must keep the
            # historical price, not the current one.
            "quantity": 1,
            "unit_price_at_sale": Decimal("200.00"),
        },
        {
            "id": "f0000000-0000-4000-8000-000000000003",
            "order_id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "product_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "quantity": 3,
            "unit_price_at_sale": Decimal("950.00"),
        },
    ]

    if include_cancelled:
        order_rows.append(
            {
                "id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "customer_id": "11111111-1111-4111-8111-111111111111",
                "order_date": date(2026, 3, 2),
                "status": "cancelled",
                "created_at": created,
            }
        )
        item_rows.append(
            {
                "id": "f0000000-0000-4000-8000-000000000004",
                "order_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "product_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "quantity": 5,
                "unit_price_at_sale": Decimal("1000.00"),
            }
        )

    return Snapshot(
        tables={
            "customers": customers,
            "products": products,
            "orders": _table("orders", order_rows),
            "order_items": _table("order_items", item_rows),
        }
    )


@pytest.fixture
def snapshot() -> Snapshot:
    return make_snapshot()


@pytest.fixture
def parquet_run(snapshot: Snapshot, tmp_path: Path) -> dict[str, Path]:
    """The fixture snapshot written to Parquet, as the warehouse would read it."""
    from etl.lake import write_parquet_locally

    return write_parquet_locally(snapshot, tmp_path / "lake")


def integration_enabled() -> bool:
    return os.environ.get("ETL_INTEGRATION", "").strip() == "1"


skip_without_services = pytest.mark.skipif(
    not integration_enabled(),
    reason="set ETL_INTEGRATION=1 and run inside Compose (postgres + minio required)",
)
