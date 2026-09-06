-- Trigger-maintained projection tables.
-- These tables are read models; projection triggers are added in 0006_projection_triggers.sql.

create table public.current_stock_by_store_sku (
  store_id uuid not null references public.stores(store_id),
  sku_id uuid not null references public.skus(sku_id),
  qty_on_hand numeric(14, 3) not null default 0,
  qty_in_transit_out numeric(14, 3) not null default 0,
  qty_in_transit_in numeric(14, 3) not null default 0,
  is_oversold boolean generated always as (qty_on_hand < 0) stored,
  last_event_server_ts timestamptz,
  primary key (store_id, sku_id)
);

create table public.shifts (
  shift_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  cashier_id uuid not null references public.users(user_id),
  opened_at timestamptz not null,
  closed_at timestamptz,
  opening_float numeric(14, 2) not null,
  cash_counted numeric(14, 2),
  system_cash numeric(14, 2) not null default 0,
  over_short numeric(14, 2) generated always as (cash_counted - system_cash - opening_float) stored,
  status text not null check (status in ('open', 'closed')),
  constraint shifts_closed_after_opened check (closed_at is null or closed_at >= opened_at),
  constraint shifts_closed_requires_cash_counted check (status = 'open' or cash_counted is not null)
);

create table public.sales (
  sale_id uuid primary key,
  event_id uuid not null unique references public.sale_events(event_id),
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  cashier_id uuid not null references public.users(user_id),
  shift_id uuid not null,
  client_ts timestamptz not null,
  server_ts timestamptz not null,
  app_version text not null,
  schema_ver int not null,
  status text not null check (status in ('completed', 'voided', 'refunded')),
  latest_status text not null check (latest_status in ('completed', 'voided', 'refunded')),
  subtotal numeric(14, 2) not null,
  discount_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null,
  original_sale_id uuid,
  refund_kind text check (
    refund_kind is null or refund_kind in ('same_till_session_void', 'same_till_history', 'cross_till')
  )
);

create table public.transfers (
  transfer_id uuid primary key,
  source_store_id uuid not null references public.stores(store_id),
  destination_store_id uuid not null references public.stores(store_id),
  state text not null check (state in ('requested', 'dispatched', 'in_transit', 'received', 'received_with_variance')),
  dispatched_line_items jsonb,
  received_line_items jsonb,
  variance_line_items jsonb,
  requested_at timestamptz,
  dispatched_at timestamptz,
  received_at timestamptz,
  last_event_server_ts timestamptz,
  constraint transfers_distinct_stores check (source_store_id <> destination_store_id),
  constraint transfers_dispatched_line_items_array check (
    dispatched_line_items is null or jsonb_typeof(dispatched_line_items) = 'array'
  ),
  constraint transfers_received_line_items_array check (
    received_line_items is null or jsonb_typeof(received_line_items) = 'array'
  ),
  constraint transfers_variance_line_items_array check (
    variance_line_items is null or jsonb_typeof(variance_line_items) = 'array'
  )
);

create table public.pending_transfer_receipts (
  event_id uuid primary key references public.transfer_events(event_id),
  transfer_id uuid not null,
  source_store_id uuid not null references public.stores(store_id),
  destination_store_id uuid not null references public.stores(store_id),
  event_kind text not null check (event_kind in ('transfer_received', 'transfer_variance')),
  line_items jsonb not null,
  variance_items jsonb,
  received_at timestamptz not null,
  held_at timestamptz not null default now(),
  constraint pending_transfer_receipts_line_items_array check (jsonb_typeof(line_items) = 'array'),
  constraint pending_transfer_receipts_variance_items_array check (
    variance_items is null or jsonb_typeof(variance_items) = 'array'
  )
);

alter table public.sale_events
  add constraint sale_events_shift_id_fk foreign key (shift_id) references public.shifts(shift_id) deferrable initially deferred;

create index current_stock_by_store_sku_oversold_idx
  on public.current_stock_by_store_sku (store_id, sku_id)
  where is_oversold;
create index current_stock_by_store_sku_last_event_idx
  on public.current_stock_by_store_sku (store_id, last_event_server_ts desc);

create index shifts_store_status_opened_idx on public.shifts (store_id, status, opened_at desc);
create index shifts_till_opened_idx on public.shifts (till_id, opened_at desc);
create index shifts_cashier_opened_idx on public.shifts (cashier_id, opened_at desc);

create index sales_store_server_ts_idx on public.sales (store_id, server_ts desc);
create index sales_till_server_ts_idx on public.sales (till_id, server_ts desc);
create index sales_cashier_server_ts_idx on public.sales (cashier_id, server_ts desc);
create index sales_shift_idx on public.sales (store_id, shift_id);
create index sales_original_sale_id_idx on public.sales (original_sale_id) where original_sale_id is not null;

create index transfers_source_store_state_idx on public.transfers (source_store_id, state, last_event_server_ts desc);
create index transfers_destination_store_state_idx on public.transfers (destination_store_id, state, last_event_server_ts desc);
create index transfers_requested_at_idx on public.transfers (requested_at desc);

create index pending_transfer_receipts_transfer_id_idx on public.pending_transfer_receipts (transfer_id);
create index pending_transfer_receipts_destination_store_idx
  on public.pending_transfer_receipts (destination_store_id, held_at desc);