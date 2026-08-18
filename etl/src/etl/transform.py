"""Build the DuckDB star schema from the raw Parquet run.

Written as SQL rather than dataframe code. The transform is relational — joins,
grouping, surrogate-key assignment — and SQL states that directly, so a reviewer
can read the modelling decisions instead of reconstructing them from a chain of
method calls. It is also why the plan's Polars dependency is not used: it would
add a heavy dependency to express the same joins less clearly.

Two modelling decisions are load-bearing and documented inline below: cancelled
orders are excluded, and surrogate keys are rebuilt deterministically.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

# A cancelled order is not a sale. Including it would inflate every revenue
# figure the dashboard shows by the cancellation rate. The rows are not lost —
# they remain in the lake forever and in PostgreSQL — they simply are not facts.
EXCLUDED_ORDER_STATUSES = ("cancelled",)

DIMENSION_DDL = """
create table dim_customer (
    customer_key bigint      primary key,
    customer_id  varchar     not null unique,
    name         varchar     not null,
    city         varchar     not null,
    state        varchar     not null,
    created_at   timestamptz not null
);

create table dim_product (
    product_key        bigint        primary key,
    product_id         varchar       not null unique,
    sku                varchar       not null unique,
    name               varchar       not null,
    category           varchar       not null,
    current_unit_price decimal(12,2) not null,
    active             boolean       not null
);

create table dim_date (
    date_key   integer primary key,
    full_date  date    not null unique,
    day        integer not null,
    month      integer not null,
    month_name varchar not null,
    quarter    integer not null,
    year       integer not null,
    is_weekend boolean not null
);

create table fact_sales (
    sale_key      bigint        primary key,
    order_id      varchar       not null,
    order_item_id varchar       not null unique,
    customer_key  bigint        not null references dim_customer(customer_key),
    product_key   bigint        not null references dim_product(product_key),
    date_key      integer       not null references dim_date(date_key),
    quantity      integer       not null,
    unit_price    decimal(12,2) not null,
    revenue       decimal(14,2) not null
);
"""


def _staging_sql(paths: dict[str, Path]) -> str:
    """Expose the downloaded Parquet files as views.

    The warehouse is built from these views, so every figure it publishes is
    traceable to a file in the lake.
    """
    return "\n".join(
        f"create view raw_{name} as select * from read_parquet('{path.as_posix()}');"
        for name, path in paths.items()
    )


def build_star_schema(connection: duckdb.DuckDBPyConnection, paths: dict[str, Path]) -> None:
    """Populate dimensions and facts. Assumes an empty database."""
    connection.execute(_staging_sql(paths))
    connection.execute(DIMENSION_DDL)

    # Surrogate keys are assigned by row_number over a deterministic ordering of
    # the natural key. The pipeline is a full refresh, so a rebuild from the same
    # lake run must produce identical keys — otherwise two rebuilds of the same
    # raw data would disagree and nothing downstream could be compared.
    connection.execute(
        """
        insert into dim_customer
        select row_number() over (order by id) as customer_key,
               id, name, city, state, created_at
          from raw_customers
        """
    )

    connection.execute(
        """
        insert into dim_product
        select row_number() over (order by id) as product_key,
               id, sku, name, category, unit_price, active
          from raw_products
        """
    )

    # dim_date spans exactly the sold days, generated rather than derived from the
    # facts, so a day with no sales still exists. That is what lets the daily
    # revenue chart show a zero instead of skipping the date entirely.
    connection.execute(
        """
        insert into dim_date
        with bounds as (
            select min(order_date) as first_day, max(order_date) as last_day
              from raw_orders
             where status not in ('cancelled')
        ),
        days as (
            select unnest(generate_series(first_day, last_day, interval 1 day))::date as full_date
              from bounds
        )
        select cast(strftime(full_date, '%Y%m%d') as integer) as date_key,
               full_date,
               cast(strftime(full_date, '%d') as integer)     as day,
               cast(strftime(full_date, '%m') as integer)     as month,
               strftime(full_date, '%B')                      as month_name,
               quarter(full_date)                             as quarter,
               cast(strftime(full_date, '%Y') as integer)      as year,
               isodow(full_date) >= 6                         as is_weekend
          from days
        """
    )

    # revenue is computed once, here, and stored. Recomputing it in every
    # analytics query would risk two endpoints disagreeing about the same sale.
    connection.execute(
        """
        insert into fact_sales
        select row_number() over (order by i.id) as sale_key,
               o.id                             as order_id,
               i.id                             as order_item_id,
               c.customer_key,
               p.product_key,
               d.date_key,
               i.quantity,
               i.unit_price_at_sale             as unit_price,
               cast(i.quantity * i.unit_price_at_sale as decimal(14,2)) as revenue
          from raw_order_items i
          join raw_orders   o on o.id = i.order_id
          join dim_customer c on c.customer_id = o.customer_id
          join dim_product  p on p.product_id  = i.product_id
          join dim_date     d on d.full_date   = o.order_date
         where o.status not in ('cancelled')
        """
    )


def source_row_counts(connection: duckdb.DuckDBPyConnection) -> dict[str, int]:
    """Row counts as read back from the lake, for the audit record."""
    counts: dict[str, int] = {}
    for name in ("customers", "products", "orders", "order_items"):
        counts[name] = connection.execute(f"select count(*) from raw_{name}").fetchone()[0]
    return counts


def warehouse_row_counts(connection: duckdb.DuckDBPyConnection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in ("dim_customer", "dim_product", "dim_date", "fact_sales"):
        counts[table] = connection.execute(f"select count(*) from {table}").fetchone()[0]
    return counts


def record_metadata(
    connection: duckdb.DuckDBPyConnection,
    *,
    run_id: str,
    lake_prefix: str,
    published_at: str,
    schema_version: str,
    pipeline_version: str,
) -> None:
    """Stamp the warehouse with the run that produced it.

    The analytics API reads this to populate `generatedAt`, and it means a
    warehouse file found on disk can always say where it came from.
    """
    connection.execute(
        """
        create table warehouse_metadata (
            key   varchar primary key,
            value varchar not null
        )
        """
    )
    connection.executemany(
        "insert into warehouse_metadata values (?, ?)",
        [
            ("run_id", run_id),
            ("lake_prefix", lake_prefix),
            ("published_at", published_at),
            ("schema_version", schema_version),
            ("pipeline_version", pipeline_version),
            ("excluded_order_statuses", ",".join(EXCLUDED_ORDER_STATUSES)),
        ],
    )
