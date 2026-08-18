-- Reference data: the entities a sale points at.
--
-- Conventions shared by every migration in this directory:
--   * Do not write BEGIN/COMMIT. The runner wraps each file in one transaction,
--     so a failing statement rolls the whole migration back.
--   * UUID primary keys generated server-side by the built-in gen_random_uuid()
--     (PostgreSQL 13+; pgcrypto is not required).
--   * Money is numeric(12,2). Never floating point.
--   * timestamptz for instants, date for calendar days.
--   * A rule that must hold no matter which client writes the row is a CHECK
--     constraint here, not application-only validation.

-- Case-insensitive text, so two customers cannot register the same address with
-- different capitalisation. citext is a trusted extension, creatable by the
-- database owner without superuser rights.
create extension if not exists citext;

create table customers (
    id         uuid         primary key default gen_random_uuid(),
    name       varchar(120) not null,
    email      citext       not null,
    city       varchar(80)  not null,
    state      varchar(80)  not null,
    created_at timestamptz  not null default now(),

    constraint customers_email_unique unique (email),
    constraint customers_name_not_blank  check (btrim(name)  <> ''),
    constraint customers_city_not_blank  check (btrim(city)  <> ''),
    constraint customers_state_not_blank check (btrim(state) <> ''),
    constraint customers_email_length    check (length(email) <= 200),
    -- Deliberately permissive: reject the obviously malformed, and leave real
    -- deliverability to whatever eventually sends mail.
    constraint customers_email_shape
        check (email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')
);

comment on table  customers        is 'Operational customer records. OLTP only; analytics read the warehouse.';
comment on column customers.email is 'Case-insensitive and unique across all customers.';

-- Dashboards group revenue by city, and the ETL builds dim_customer from these
-- columns, so the pairing is worth indexing.
create index customers_state_city_idx on customers (state, city);

create table products (
    id         uuid           primary key default gen_random_uuid(),
    sku        varchar(40)    not null,
    name       varchar(160)   not null,
    category   varchar(80)    not null,
    unit_price numeric(12, 2) not null,
    active     boolean        not null default true,
    created_at timestamptz    not null default now(),

    constraint products_sku_unique unique (sku),
    constraint products_sku_not_blank      check (btrim(sku)      <> ''),
    constraint products_name_not_blank     check (btrim(name)     <> ''),
    constraint products_category_not_blank check (btrim(category) <> ''),
    constraint products_unit_price_non_negative check (unit_price >= 0)
);

comment on table  products            is 'Product catalogue. Current prices only; historical sale prices live on order_items.';
comment on column products.unit_price is 'Catalogue price today. Changing it must never restate past revenue.';
comment on column products.active     is 'Inactive products may not be added to new orders. Existing orders keep them.';

create index products_category_idx on products (category);
