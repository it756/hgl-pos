-- RLS-safe (security_invoker) view backing the admin sync-health dashboards.
-- One row per non-retired till, left-joined to its most recent heartbeat so a
-- till that has never synced still shows up (NULLs) instead of disappearing.

create view public.sync_health_latest_by_till
with (security_invoker = true)
as
select
  t.till_id,
  t.store_id,
  t.label as till_label,
  st.code as store_code,
  st.name as store_name,
  latest.server_ts,
  latest.queue_depth,
  latest.oldest_pending_event_at,
  latest.last_successful_sync_at,
  latest.consecutive_failures,
  latest.app_version,
  latest.schema_version
from public.tills t
join public.stores st on st.store_id = t.store_id
left join lateral (
  select
    s.server_ts,
    s.queue_depth,
    s.oldest_pending_event_at,
    s.last_successful_sync_at,
    s.consecutive_failures,
    s.app_version,
    s.schema_version
  from public.sync_health_snapshots s
  where s.till_id = t.till_id
  order by s.server_ts desc
  limit 1
) latest on true
where t.retired_at is null;

grant select on public.sync_health_latest_by_till to authenticated;
