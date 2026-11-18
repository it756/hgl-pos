-- Append-only event tables for the retail POS MVP.
-- Projection-maintenance triggers are installed in later migrations.

create table public.stock_events (
  event_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  sku_id uuid not null references public.skus(sku_id),
  event_type text not null check (
    event_type in ('sale', 'refund', 'transfer_out', 'transfer_in', 'transfer_variance', 'adjustment', 'count_correction')
  ),
  delta_qty numeric(14, 3) not null,
  source_ref_id uuid,
  batch_no text,
  expiry_date date,
  reason_code text,
  notes text,
  constraint stock_events_reason_required check (
    event_type not in ('adjustment', 'count_correction') or reason_code is not null
  )
);

create table public.sale_events (
  event_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  sale_id uuid not null unique,
  cashier_id uuid not null references public.users(user_id),
  shift_id uuid not null,
  status text not null check (status in ('completed', 'voided', 'refunded')),
  items jsonb not null,
  tenders jsonb not null,
  subtotal numeric(14, 2) not null,
  discount_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null,
  original_sale_id uuid,
  refund_kind text check (
    refund_kind is null or refund_kind in ('same_till_session_void', 'same_till_history', 'cross_till')
  ),
  constraint sale_events_items_array check (jsonb_typeof(items) = 'array'),
  constraint sale_events_tenders_array check (jsonb_typeof(tenders) = 'array'),
  constraint sale_events_refund_requires_original check (
    status = 'completed' or original_sale_id is not null
  )
);

create table public.shift_events (
  event_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  shift_id uuid not null,
  cashier_id uuid not null references public.users(user_id),
  event_kind text not null check (event_kind in ('shift_open', 'shift_close')),
  payload jsonb not null,
  constraint shift_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint shift_events_one_kind_per_shift unique (shift_id, event_kind)
);

create table public.transfer_events (
  event_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  transfer_id uuid not null,
  event_kind text not null check (
    event_kind in ('transfer_requested', 'transfer_dispatched', 'transfer_received', 'transfer_variance')
  ),
  source_store_id uuid not null references public.stores(store_id),
  destination_store_id uuid not null references public.stores(store_id),
  line_items jsonb not null,
  variance_items jsonb,
  actor_user_id uuid not null references public.users(user_id),
  constraint transfer_events_distinct_stores check (source_store_id <> destination_store_id),
  constraint transfer_events_line_items_array check (jsonb_typeof(line_items) = 'array'),
  constraint transfer_events_variance_items_array check (
    variance_items is null or jsonb_typeof(variance_items) = 'array'
  ),
  constraint transfer_events_variance_requires_payload check (
    event_kind <> 'transfer_variance' or variance_items is not null
  )
);

create table public.adjustment_events (
  event_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  adjustment_id uuid not null,
  event_kind text not null check (event_kind in ('adjustment_requested', 'adjustment_approved', 'adjustment_rejected')),
  sku_id uuid not null references public.skus(sku_id),
  delta_qty numeric(14, 3) not null,
  reason_code text not null,
  requested_by_user_id uuid not null references public.users(user_id),
  approver_user_id uuid references public.users(user_id),
  notes text,
  constraint adjustment_events_approval_actor check (
    (event_kind = 'adjustment_requested' and approver_user_id is null)
    or (event_kind in ('adjustment_approved', 'adjustment_rejected') and approver_user_id is not null)
  )
);

create table public.price_change_events (
  event_id uuid primary key,
  till_id uuid not null,
  store_id uuid references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  app_version text not null,
  schema_ver int not null,
  price_version_id uuid not null unique,
  sku_id uuid not null references public.skus(sku_id),
  old_unit_price numeric(14, 4),
  new_unit_price numeric(14, 4) not null check (new_unit_price >= 0),
  effective_from timestamptz not null,
  changed_by_user_id uuid not null references public.users(user_id),
  reason text
);

create or replace function public.prevent_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'event tables are append-only: % is not allowed on %.%', tg_op, tg_table_schema, tg_table_name
    using errcode = '25006';
end;
$$;

create trigger stock_events_append_only
  before update or delete on public.stock_events
  for each row execute function public.prevent_event_mutation();

create trigger sale_events_append_only
  before update or delete on public.sale_events
  for each row execute function public.prevent_event_mutation();

create trigger shift_events_append_only
  before update or delete on public.shift_events
  for each row execute function public.prevent_event_mutation();

create trigger transfer_events_append_only
  before update or delete on public.transfer_events
  for each row execute function public.prevent_event_mutation();

create trigger adjustment_events_append_only
  before update or delete on public.adjustment_events
  for each row execute function public.prevent_event_mutation();

create trigger price_change_events_append_only
  before update or delete on public.price_change_events
  for each row execute function public.prevent_event_mutation();

create or replace function public.ingest_stock_event(row_data public.stock_events)
returns boolean
language plpgsql
as $$
begin
  -- INSERT ... SELECT (composite).* bypasses column DEFAULTs entirely, and a
  -- client-supplied value can't be trusted as authoritative "server received"
  -- time — so this is always server-assigned, never taken from the caller.
  row_data.server_ts := now();
  insert into public.stock_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.ingest_sale_event(row_data public.sale_events)
returns boolean
language plpgsql
as $$
begin
  row_data.server_ts := now();
  insert into public.sale_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.ingest_shift_event(row_data public.shift_events)
returns boolean
language plpgsql
as $$
begin
  row_data.server_ts := now();
  insert into public.shift_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.ingest_transfer_event(row_data public.transfer_events)
returns boolean
language plpgsql
as $$
begin
  row_data.server_ts := now();
  insert into public.transfer_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.ingest_adjustment_event(row_data public.adjustment_events)
returns boolean
language plpgsql
as $$
begin
  row_data.server_ts := now();
  insert into public.adjustment_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create or replace function public.ingest_price_change_event(row_data public.price_change_events)
returns boolean
language plpgsql
as $$
begin
  row_data.server_ts := now();
  insert into public.price_change_events
  select (row_data).*
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create index stock_events_store_sku_server_ts_idx on public.stock_events (store_id, sku_id, server_ts);
create index stock_events_till_server_ts_idx on public.stock_events (till_id, server_ts desc);
create index stock_events_source_ref_id_idx on public.stock_events (source_ref_id);

create index sale_events_store_shift_idx on public.sale_events (store_id, shift_id);
create index sale_events_till_server_ts_idx on public.sale_events (till_id, server_ts desc);
create index sale_events_store_server_ts_idx on public.sale_events (store_id, server_ts desc);
create index sale_events_cashier_server_ts_idx on public.sale_events (cashier_id, server_ts desc);
create index sale_events_original_sale_id_idx on public.sale_events (original_sale_id) where original_sale_id is not null;

create index shift_events_store_shift_idx on public.shift_events (store_id, shift_id);
create index shift_events_till_server_ts_idx on public.shift_events (till_id, server_ts desc);
create index shift_events_cashier_server_ts_idx on public.shift_events (cashier_id, server_ts desc);

create index transfer_events_transfer_id_idx on public.transfer_events (transfer_id);
create index transfer_events_store_server_ts_idx on public.transfer_events (store_id, server_ts desc);
create index transfer_events_source_store_server_ts_idx on public.transfer_events (source_store_id, server_ts desc);
create index transfer_events_destination_store_server_ts_idx on public.transfer_events (destination_store_id, server_ts desc);
create index transfer_events_till_server_ts_idx on public.transfer_events (till_id, server_ts desc);

create index adjustment_events_adjustment_id_idx on public.adjustment_events (adjustment_id);
create index adjustment_events_store_server_ts_idx on public.adjustment_events (store_id, server_ts desc);
create index adjustment_events_till_server_ts_idx on public.adjustment_events (till_id, server_ts desc);
create index adjustment_events_requested_by_server_ts_idx on public.adjustment_events (requested_by_user_id, server_ts desc);

create index price_change_events_sku_store_effective_idx
  on public.price_change_events (sku_id, store_id, effective_from desc, server_ts desc);
create index price_change_events_store_server_ts_idx on public.price_change_events (store_id, server_ts desc);
create index price_change_events_till_server_ts_idx on public.price_change_events (till_id, server_ts desc);