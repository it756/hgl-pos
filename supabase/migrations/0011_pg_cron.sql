-- Sync-health alert scheduler.

create extension if not exists pg_cron with schema extensions;

create or replace function public.sync_health_alert_candidates()
returns table (
  till_id uuid,
  store_id uuid,
  reason text,
  payload jsonb
)
language sql
stable
set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (s.till_id)
      s.till_id,
      s.store_id,
      s.server_ts,
      s.queue_depth,
      s.oldest_pending_event_at,
      s.last_successful_sync_at,
      s.consecutive_failures,
      s.app_version,
      s.schema_version
    from public.sync_health_snapshots s
    order by s.till_id, s.server_ts desc
  ), base as (
    select
      t.till_id,
      t.store_id,
      l.server_ts as last_snapshot_at,
      l.queue_depth,
      l.oldest_pending_event_at,
      l.last_successful_sync_at,
      l.consecutive_failures,
      l.app_version,
      l.schema_version,
      case
        when (now() at time zone st.timezone)::time between time '07:00' and time '22:00'
          then st.offline_threshold_minutes_trading
        else st.offline_threshold_minutes_overnight
      end as stale_after_minutes,
      coalesce(l.server_ts, t.provisioned_at) as stale_basis_at
    from public.tills t
    join public.stores st on st.store_id = t.store_id
    left join latest l on l.till_id = t.till_id
    where t.retired_at is null
      and t.provisioned_at is not null
  )
  select
    b.till_id,
    b.store_id,
    'stale_sync'::text as reason,
    jsonb_build_object(
      'last_snapshot_at', b.last_snapshot_at,
      'stale_after_minutes', b.stale_after_minutes,
      'checked_at', now()
    ) as payload
  from base b
  where b.stale_basis_at < now() - make_interval(mins => b.stale_after_minutes)
  union all
  select
    b.till_id,
    b.store_id,
    'queue_backlog'::text as reason,
    jsonb_build_object(
      'queue_depth', b.queue_depth,
      'oldest_pending_event_at', b.oldest_pending_event_at,
      'last_snapshot_at', b.last_snapshot_at,
      'checked_at', now()
    ) as payload
  from base b
  where coalesce(b.queue_depth, 0) >= 100
  union all
  select
    b.till_id,
    b.store_id,
    'repeated_failures'::text as reason,
    jsonb_build_object(
      'consecutive_failures', b.consecutive_failures,
      'last_successful_sync_at', b.last_successful_sync_at,
      'last_snapshot_at', b.last_snapshot_at,
      'app_version', b.app_version,
      'schema_version', b.schema_version,
      'checked_at', now()
    ) as payload
  from base b
  where coalesce(b.consecutive_failures, 0) >= 5
$$;

create or replace function public.check_sync_health_and_alert()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inserted_count int;
begin
  insert into public.sync_health_alerts (alert_id, till_id, store_id, reason, payload)
  select gen_random_uuid(), till_id, store_id, reason, payload
  from public.sync_health_alert_candidates()
  on conflict (till_id, reason) where closed_at is null do nothing;

  get diagnostics inserted_count = row_count;

  update public.sync_health_alerts a
  set closed_at = now()
  where a.closed_at is null
    and not exists (
      select 1
      from public.sync_health_alert_candidates() c
      where c.till_id = a.till_id
        and c.reason = a.reason
    );

  return inserted_count;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hgl-pos-sync-health-alerts') then
    perform cron.unschedule('hgl-pos-sync-health-alerts');
  end if;
end;
$$;

select cron.schedule(
  'hgl-pos-sync-health-alerts',
  '* * * * *',
  $$select public.check_sync_health_and_alert();$$
);