"""Extract a consistent snapshot of the operational tables.

Two properties matter here and neither is automatic:

1. **One snapshot.** All four tables are read inside a single REPEATABLE READ
   transaction. Reading them in four separate transactions could catch an order
   whose items were inserted after the orders query ran, producing a header with
   no lines — revenue the warehouse can never account for.

2. **Declared types.** Each table has an explicit Arrow schema rather than
   whatever Parquet infers from the first row group. Money stays `decimal128`, so
   it survives the round trip through the lake exactly; a float would not.
"""

from __future__ import annotations

from dataclasses import dataclass

import pyarrow as pa
from sqlalchemy import Engine, create_engine, text

from .config import PostgresConfig

# Order matters: dimensions before the tables that reference them, so a partial
# read is still interpretable.
TABLE_ORDER = ("customers", "products", "orders", "order_items")

UUID = pa.string()
MONEY = pa.decimal128(12, 2)
TIMESTAMP = pa.timestamp("us", tz="UTC")

SCHEMAS: dict[str, pa.Schema] = {
    "customers": pa.schema(
        [
            pa.field("id", UUID, nullable=False),
            pa.field("name", pa.string(), nullable=False),
            pa.field("email", pa.string(), nullable=False),
            pa.field("city", pa.string(), nullable=False),
            pa.field("state", pa.string(), nullable=False),
            pa.field("created_at", TIMESTAMP, nullable=False),
        ]
    ),
    "products": pa.schema(
        [
            pa.field("id", UUID, nullable=False),
            pa.field("sku", pa.string(), nullable=False),
            pa.field("name", pa.string(), nullable=False),
            pa.field("category", pa.string(), nullable=False),
            pa.field("unit_price", MONEY, nullable=False),
            pa.field("active", pa.bool_(), nullable=False),
            pa.field("created_at", TIMESTAMP, nullable=False),
        ]
    ),
    "orders": pa.schema(
        [
            pa.field("id", UUID, nullable=False),
            pa.field("customer_id", UUID, nullable=False),
            pa.field("order_date", pa.date32(), nullable=False),
            pa.field("status", pa.string(), nullable=False),
            pa.field("created_at", TIMESTAMP, nullable=False),
        ]
    ),
    "order_items": pa.schema(
        [
            pa.field("id", UUID, nullable=False),
            pa.field("order_id", UUID, nullable=False),
            pa.field("product_id", UUID, nullable=False),
            pa.field("quantity", pa.int32(), nullable=False),
            pa.field("unit_price_at_sale", MONEY, nullable=False),
        ]
    ),
}

# uuid and date columns are cast in SQL rather than in Python: the driver would
# otherwise hand back UUID and date objects that Arrow cannot map to the declared
# string/date32 fields without a per-row conversion.
QUERIES: dict[str, str] = {
    "customers": """
        select id::text as id, name, email::text as email, city, state, created_at
          from customers
         order by id
    """,
    "products": """
        select id::text as id, sku, name, category, unit_price, active, created_at
          from products
         order by id
    """,
    "orders": """
        select id::text as id, customer_id::text as customer_id, order_date, status, created_at
          from orders
         order by id
    """,
    "order_items": """
        select id::text as id,
               order_id::text as order_id,
               product_id::text as product_id,
               quantity,
               unit_price_at_sale
          from order_items
         order by id
    """,
}


class ExtractError(RuntimeError):
    """Raised when the source database cannot be read as expected."""


@dataclass(frozen=True)
class Snapshot:
    """One consistent read of every source table."""

    tables: dict[str, pa.Table]

    @property
    def row_counts(self) -> dict[str, int]:
        return {name: table.num_rows for name, table in self.tables.items()}


def create_postgres_engine(config: PostgresConfig) -> Engine:
    # pool_pre_ping so a stale pooled connection is detected before a long run
    # rather than failing mid-extract.
    return create_engine(config.sqlalchemy_url, pool_pre_ping=True, future=True)


def extract_snapshot(engine: Engine) -> Snapshot:
    """Read every source table in one repeatable-read transaction."""
    tables: dict[str, pa.Table] = {}

    with (
        engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection,
        # Explicit transaction so all four statements share one snapshot.
        connection.begin(),
    ):
        for name in TABLE_ORDER:
            schema = SCHEMAS[name]
            result = connection.execute(text(QUERIES[name]))
            rows = result.fetchall()

            columns = [[row[index] for row in rows] for index in range(len(schema.names))]

            try:
                tables[name] = pa.Table.from_arrays(
                    [
                        pa.array(column, type=field.type)
                        for column, field in zip(columns, schema, strict=True)
                    ],
                    schema=schema,
                )
            except (pa.ArrowInvalid, pa.ArrowTypeError) as error:
                raise ExtractError(
                    f"{name} does not match the declared schema for version {schema}: {error}"
                ) from error

    _assert_referentially_complete(tables)

    return Snapshot(tables=tables)


def _assert_referentially_complete(tables: dict[str, pa.Table]) -> None:
    """Fail before writing the lake if the snapshot is internally inconsistent.

    A lake object is immutable once uploaded, so a torn snapshot would be
    preserved for good. Checking here means a bad read costs nothing.
    """
    customer_ids = set(tables["customers"].column("id").to_pylist())
    product_ids = set(tables["products"].column("id").to_pylist())
    order_ids = set(tables["orders"].column("id").to_pylist())

    orphan_orders = [
        order_id
        for order_id, customer_id in zip(
            tables["orders"].column("id").to_pylist(),
            tables["orders"].column("customer_id").to_pylist(),
            strict=True,
        )
        if customer_id not in customer_ids
    ]
    if orphan_orders:
        raise ExtractError(
            f"{len(orphan_orders)} order(s) reference a customer missing from the snapshot"
        )

    item_orders = tables["order_items"].column("order_id").to_pylist()
    orphan_items = [order_id for order_id in item_orders if order_id not in order_ids]
    if orphan_items:
        raise ExtractError(
            f"{len(orphan_items)} order item(s) reference an order missing from the snapshot"
        )

    item_products = tables["order_items"].column("product_id").to_pylist()
    orphan_products = [pid for pid in item_products if pid not in product_ids]
    if orphan_products:
        raise ExtractError(
            f"{len(orphan_products)} order item(s) reference a product missing from the snapshot"
        )
