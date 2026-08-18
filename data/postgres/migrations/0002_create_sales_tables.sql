-- The sale itself, split across a header and its lines.
--
-- order_items exists even though the brief mentions only an orders table: a real
-- order contains several products, and one row per sold line is exactly the
-- grain fact_sales needs in the warehouse.

create table orders (
    id          uuid        primary key default gen_random_uuid(),
    customer_id uuid        not null,
    order_date  date        not null,
    status      varchar(20) not null default 'pending',
    created_at  timestamptz not null default now(),

    -- Restrict, not cascade: deleting a customer must never silently erase
    -- revenue history. Close the account instead.
    constraint orders_customer_fk
        foreign key (customer_id) references customers (id) on delete restrict,

    constraint orders_status_known
        check (status in ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled'))
);

comment on table  orders            is 'Order header. Line items and money live on order_items.';
comment on column orders.order_date is
    'Calendar day of the sale. "Not in the future" is enforced by the API, not by a CHECK: a clock-relative constraint would make the deterministic seed fail on a machine whose date differs.';

create index orders_customer_id_idx on orders (customer_id);
create index orders_order_date_idx  on orders (order_date);

create table order_items (
    id                 uuid           primary key default gen_random_uuid(),
    order_id           uuid           not null,
    product_id         uuid           not null,
    quantity           integer        not null,
    unit_price_at_sale numeric(12, 2) not null,

    -- Cascade: a line item has no meaning without its order.
    constraint order_items_order_fk
        foreign key (order_id) references orders (id) on delete cascade,
    -- Restrict: a product that has ever been sold cannot be deleted, or the
    -- warehouse would lose the dimension row its facts join to.
    constraint order_items_product_fk
        foreign key (product_id) references products (id) on delete restrict,

    constraint order_items_quantity_positive check (quantity > 0),
    constraint order_items_price_non_negative check (unit_price_at_sale >= 0),
    -- One line per product per order keeps the fact grain unambiguous: an
    -- additional unit is a larger quantity, not a second line.
    constraint order_items_one_line_per_product unique (order_id, product_id)
);

comment on table  order_items                    is 'One row per product sold on an order. Matches the fact_sales grain.';
comment on column order_items.unit_price_at_sale is
    'Price captured when the sale happened. Never restated when products.unit_price changes.';

create index order_items_order_id_idx   on order_items (order_id);
create index order_items_product_id_idx on order_items (product_id);
