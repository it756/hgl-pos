-- Contract indexes not already introduced with the base table migrations.

create index if not exists stock_events_store_server_ts_idx
  on public.stock_events (store_id, server_ts desc);

create index if not exists shift_events_store_server_ts_idx
  on public.shift_events (store_id, server_ts desc);