-- Report infrastructure for User Story 7 (Phase 11): storage bucket for
-- report-export output, a schedules table for report-scheduler, and the
-- pg_cron -> Edge Function bridge.
--
-- Deliberately does NOT introduce a new "provisional" computation here —
-- EC-16's provisional_until_server_ts marker is computed in application code
-- (apps/admin/src/lib/reports/shared.ts) directly from the existing
-- sync_health_latest_by_till view (0014), so no new view/function is needed
-- for that part.

-- ============================================================
-- report_schedules (T123): what to run, for whom, how often
-- ============================================================

create table public.report_schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  report text not null check (
    report in ('sales_by_store', 'sales_by_cashier', 'sales_by_sku', 'inventory_on_hand', 'transfer_history', 'till_reconciliation')
  ),
  params jsonb not null default '{}'::jsonb,
  format text not null check (format in ('csv', 'pdf')),
  recipient_email text not null,
  cadence text not null check (cadence in ('daily', 'weekly')),
  store_id uuid references public.stores(store_id),
  created_by_user_id uuid not null references public.users(user_id),
  is_active boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  constraint report_schedules_params_object check (jsonb_typeof(params) = 'object')
);

create index report_schedules_due_idx on public.report_schedules (is_active, cadence, last_run_at);

alter table public.report_schedules enable row level security;

create policy report_schedules_read on public.report_schedules for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  );

create policy report_schedules_write on public.report_schedules for all
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  )
  with check (
    created_by_user_id = public.claim_user_id()
    and (
      public.claim_role() = 'hq_admin'
      or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    )
  );

-- Runs as the table owner (postgres), which bypasses RLS — matches how
-- pg_cron itself runs (superuser), so no security definer is needed here.
create or replace function public.due_report_schedules()
returns setof public.report_schedules
language sql
stable
set search_path = public, pg_temp
as $$
  select *
  from public.report_schedules
  where is_active
    and (
      last_run_at is null
      or (cadence = 'daily' and last_run_at < now() - interval '1 day')
      or (cadence = 'weekly' and last_run_at < now() - interval '7 days')
    )
$$;

-- ============================================================
-- pg_cron -> report-scheduler Edge Function bridge
-- ============================================================
-- Requires pg_net (HTTP from Postgres) and, per-environment, a Vault secret
-- named 'report_scheduler_service_role_key' holding the project's service
-- role key so the Edge Function call can authenticate:
--   select vault.create_secret('<service-role-key>', 'report_scheduler_service_role_key');
-- The service role key is deliberately NOT stored in a plain table — any
-- hq_admin-readable table would let that role fully bypass RLS by reading
-- the key back out via PostgREST. Vault secrets are never exposed through
-- the PostgREST API surface (only "public"/"storage"/"graphql_public"
-- schemas are, per supabase/config.toml), so this avoids that privilege
-- escalation path entirely.

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_report_scheduler()
returns void
language plpgsql
security definer
set search_path = public, pg_temp, extensions, vault
as $$
declare
  service_role_key text;
  functions_base_url text := coalesce(
    current_setting('app.settings.functions_base_url', true),
    'http://127.0.0.1:54321/functions/v1'
  );
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'vault schema unavailable; skipping scheduled report run';
    return;
  end if;

  execute
    'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into service_role_key
    using 'report_scheduler_service_role_key';

  if service_role_key is null then
    raise notice 'report_scheduler_service_role_key not configured in Vault; skipping scheduled report run';
    return;
  end if;

  perform net.http_post(
    url := functions_base_url || '/report-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_role_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'hgl-pos-report-scheduler') then
    perform cron.unschedule('hgl-pos-report-scheduler');
  end if;
end;
$$;

select cron.schedule(
  'hgl-pos-report-scheduler',
  '0 * * * *',
  $$select public.trigger_report_scheduler();$$
);

-- ============================================================
-- Storage bucket for report-export output (T122)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('report-exports', 'report-exports', false)
on conflict (id) do nothing;

-- Objects are written under "<store_id>/..." or "consolidated/..." — an
-- hq_admin may read any export, a store_manager only their own store's.
create policy report_exports_read on storage.objects for select
  using (
    bucket_id = 'report-exports'
    and (
      public.claim_role() = 'hq_admin'
      or (public.claim_role() = 'store_manager' and (storage.foldername(name))[1] = public.claim_store_id()::text)
    )
  );
-- Writes go through the report-export/report-scheduler Edge Functions using
-- the service role key, which bypasses RLS — no insert policy needed here.
