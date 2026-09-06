-- Rollout record tracking for User Story 8 (Phase 12), T129/SC-008: one
-- record per store per app_version capturing the three go/no-go signals a
-- canary rollout stage needs before progressing to the next store cohort —
-- pilot soak result, offline drill result, schema-compat verification.
-- Written by HQ admins from the admin console as each stage completes
-- (docs/ops/canary.md); read by both hq_admin (fleet-wide) and
-- store_manager (their own store only, for visibility into why/when their
-- store received a given version).

create table public.rollout_records (
  rollout_record_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id),
  app_version text not null,
  pilot_soak_result text not null default 'pending' check (
    pilot_soak_result in ('pending', 'pass', 'fail')
  ),
  offline_drill_result text not null default 'pending' check (
    offline_drill_result in ('pending', 'pass', 'fail')
  ),
  schema_compat_verified boolean not null default false,
  notes text,
  created_by_user_id uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, app_version)
);

create index rollout_records_store_idx on public.rollout_records (store_id, created_at desc);

alter table public.rollout_records enable row level security;

create policy rollout_records_read on public.rollout_records for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  );

create policy rollout_records_write_hq on public.rollout_records for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin' and created_by_user_id = public.claim_user_id());
