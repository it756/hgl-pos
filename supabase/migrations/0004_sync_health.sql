-- Sync-health telemetry and alert tables.

create table public.sync_health_snapshots (
  snapshot_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  queue_depth int not null check (queue_depth >= 0),
  oldest_pending_event_at timestamptz,
  last_successful_sync_at timestamptz,
  consecutive_failures int not null default 0 check (consecutive_failures >= 0),
  app_version text not null,
  schema_version int not null,
  constraint sync_health_snapshot_store_till_match unique (snapshot_id, store_id, till_id)
);

create table public.sync_health_alerts (
  alert_id uuid primary key,
  till_id uuid not null references public.tills(till_id),
  store_id uuid not null references public.stores(store_id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  reason text not null check (reason in ('stale_sync', 'queue_backlog', 'repeated_failures')),
  payload jsonb,
  constraint sync_health_alerts_closed_after_opened check (closed_at is null or closed_at >= opened_at),
  constraint sync_health_alerts_payload_object check (payload is null or jsonb_typeof(payload) = 'object')
);

create index sync_health_snapshots_till_server_ts_idx
  on public.sync_health_snapshots (till_id, server_ts desc);
create index sync_health_snapshots_store_server_ts_idx
  on public.sync_health_snapshots (store_id, server_ts desc);
create index sync_health_snapshots_queue_depth_idx
  on public.sync_health_snapshots (store_id, queue_depth desc, server_ts desc)
  where queue_depth > 0;

create index sync_health_alerts_till_opened_idx
  on public.sync_health_alerts (till_id, opened_at desc);
create index sync_health_alerts_store_opened_idx
  on public.sync_health_alerts (store_id, opened_at desc);
create index sync_health_alerts_open_idx
  on public.sync_health_alerts (store_id, reason, opened_at desc)
  where closed_at is null;

create unique index sync_health_alerts_one_open_per_till_reason
  on public.sync_health_alerts (till_id, reason)
  where closed_at is null;