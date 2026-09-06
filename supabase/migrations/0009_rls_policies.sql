-- RLS policies — Retail POS 001-retail-pos-mvp
-- Applies AFTER PowerSync sync-rule filtering. Two-layer defence per research.md §3.4.
-- Assumes Supabase Auth JWTs with POS domain claims in app_metadata:
-- role, store_id, till_id, device_id.
--
-- Helper functions read those claims via `auth.jwt()`.

create or replace function public.claim_role() returns text
  language sql stable as $$
    select coalesce(
      nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
      nullif(auth.jwt() ->> 'pos_role', ''),
      case
        when auth.jwt() ->> 'role' in ('cashier', 'store_manager', 'hq_admin', 'device')
          then auth.jwt() ->> 'role'
        else null
      end,
      'anonymous'
    )
$$;

create or replace function public.claim_store_id() returns uuid
  language sql stable as $$
    select coalesce(
      nullif(auth.jwt() -> 'app_metadata' ->> 'store_id', ''),
      nullif(auth.jwt() ->> 'store_id', ''),
      nullif(auth.jwt() ->> 'store_id', '')
    )::uuid
$$;

create or replace function public.claim_till_id() returns uuid
  language sql stable as $$
    select coalesce(
      nullif(auth.jwt() -> 'app_metadata' ->> 'till_id', ''),
      nullif(auth.jwt() ->> 'till_id', ''),
      nullif(auth.jwt() ->> 'till_id', '')
    )::uuid
$$;

create or replace function public.claim_user_id() returns uuid
  language sql stable as $$
    select (auth.jwt() ->> 'sub')::uuid
$$;

-- ============================================================
-- Master data
-- ============================================================

alter table stores enable row level security;
create policy stores_read_all_authenticated on stores for select
  using (auth.role() = 'authenticated');
create policy stores_write_hq on stores for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table tills enable row level security;
create policy tills_read_store_scope on tills for select
  using (
    public.claim_role() = 'hq_admin'
    or store_id = public.claim_store_id()
  );
create policy tills_write_hq on tills for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table users enable row level security;
create policy users_read_store_scope on users for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() = 'cashier' and store_id = public.claim_store_id())
    or (public.claim_role() = 'device' and store_id = public.claim_store_id() and role = 'cashier' and is_active)
    or user_id = public.claim_user_id()
  );
create policy users_write_hq on users for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table skus enable row level security;
create policy skus_read_authenticated on skus for select
  using (auth.role() = 'authenticated');
create policy skus_write_hq on skus for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table price_versions enable row level security;
create policy price_versions_read_scope on price_versions for select
  using (
    public.claim_role() = 'hq_admin'
    or store_id is null
    or store_id = public.claim_store_id()
  );
-- No direct writes; only price_change_events trigger inserts here.
create policy price_versions_write_deny on price_versions for all
  using (false) with check (false);

alter table promotions enable row level security;
create policy promotions_read_scope on promotions for select
  using (
    public.claim_role() = 'hq_admin'
    or store_id is null
    or store_id = public.claim_store_id()
  );
create policy promotions_write_hq on promotions for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

-- ============================================================
-- Event tables — insert-only, role-typed
-- ============================================================

alter table stock_events enable row level security;
create policy stock_events_read on stock_events for select
  using (
    public.claim_role() = 'hq_admin'
    or store_id = public.claim_store_id()
  );
-- Direct stock_events inserts from tills are only allowed for 'count_correction';
-- 'sale'/'refund' rows arrive via the sale_events AFTER INSERT trigger. Uploader
-- may be the cashier (online) OR the till device credential (backlog upload after
-- cashier JWT expiry).
create policy stock_events_insert_count_correction on stock_events for insert
  with check (
    till_id = public.claim_till_id()
    and store_id = public.claim_store_id()
    and event_type = 'count_correction'
    and public.claim_role() in ('cashier', 'device')
  );

alter table sale_events enable row level security;
create policy sale_events_read on sale_events for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() = 'cashier' and till_id = public.claim_till_id())
  );
-- cashier_id is validated as DATA via a BEFORE INSERT trigger (must reference a
-- cashier at this store), not via auth.claim_user_id() — otherwise offline
-- backlogs whose cashier JWT has expired would fail RLS on reconnect.
create policy sale_events_insert_by_own_till on sale_events for insert
  with check (
    till_id = public.claim_till_id()
    and store_id = public.claim_store_id()
    and (
      (public.claim_role() = 'cashier' and cashier_id = public.claim_user_id())
      or public.claim_role() = 'device'
    )
  );

alter table shift_events enable row level security;
create policy shift_events_read on shift_events for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() = 'cashier' and till_id = public.claim_till_id())
  );
create policy shift_events_insert_by_own_till on shift_events for insert
  with check (
    till_id = public.claim_till_id()
    and store_id = public.claim_store_id()
    and (
      (public.claim_role() = 'cashier' and cashier_id = public.claim_user_id())
      or public.claim_role() = 'device'
    )
  );

-- Prevents a device credential from impersonating an off-boarded or cross-store
-- cashier during a backlog upload.
create or replace function tg_validate_cashier_belongs_to_store()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from users u
    where u.user_id = new.cashier_id
      and u.store_id = new.store_id
      and u.role = 'cashier'
  ) then
    raise exception 'cashier_id % is not a cashier at store %', new.cashier_id, new.store_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger sale_events_cashier_check
  before insert on sale_events
  for each row execute function tg_validate_cashier_belongs_to_store();

create trigger shift_events_cashier_check
  before insert on shift_events
  for each row execute function tg_validate_cashier_belongs_to_store();

alter table transfer_events enable row level security;
create policy transfer_events_read on transfer_events for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager'
      and (source_store_id = public.claim_store_id()
         or destination_store_id = public.claim_store_id()))
  );
create policy transfer_events_insert_by_manager on transfer_events for insert
  with check (
    public.claim_role() = 'store_manager'
    and actor_user_id = public.claim_user_id()
    and (
      (event_kind in ('transfer_requested', 'transfer_dispatched')
        and source_store_id = public.claim_store_id())
      or
      (event_kind in ('transfer_received', 'transfer_variance')
        and destination_store_id = public.claim_store_id())
    )
  );

alter table adjustment_events enable row level security;
create policy adjustment_events_read on adjustment_events for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() in ('store_manager', 'cashier') and store_id = public.claim_store_id())
  );
create policy adjustment_events_insert_request on adjustment_events for insert
  with check (
    store_id = public.claim_store_id()
    and requested_by_user_id = public.claim_user_id()
    and (
      -- cashier or manager can request
      (event_kind = 'adjustment_requested' and public.claim_role() in ('cashier', 'store_manager'))
      -- only manager can approve/reject
      or (event_kind in ('adjustment_approved', 'adjustment_rejected')
          and public.claim_role() = 'store_manager'
          and approver_user_id = public.claim_user_id())
    )
  );

alter table price_change_events enable row level security;
create policy price_change_events_read_hq on price_change_events for select
  using (public.claim_role() = 'hq_admin');
create policy price_change_events_insert_hq on price_change_events for insert
  with check (
    public.claim_role() = 'hq_admin'
    and changed_by_user_id = public.claim_user_id()
  );

-- ============================================================
-- Projections — read-only to clients, written only by triggers
-- ============================================================

alter table current_stock_by_store_sku enable row level security;
create policy stock_projection_read on current_stock_by_store_sku for select
  using (
    public.claim_role() = 'hq_admin'
    or store_id = public.claim_store_id()
  );
create policy stock_projection_write_deny on current_stock_by_store_sku for all
  using (false) with check (false);

alter table shifts enable row level security;
create policy shifts_read on shifts for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() = 'cashier' and till_id = public.claim_till_id())
  );
create policy shifts_write_deny on shifts for all
  using (false) with check (false);

alter table sales enable row level security;
create policy sales_read on sales for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() = 'cashier' and till_id = public.claim_till_id())
  );
create policy sales_write_deny on sales for all
  using (false) with check (false);

alter table transfers enable row level security;
create policy transfers_read on transfers for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager'
      and (source_store_id = public.claim_store_id()
         or destination_store_id = public.claim_store_id()))
  );
create policy transfers_write_deny on transfers for all
  using (false) with check (false);

-- ============================================================
-- Sync-health tables
-- ============================================================

alter table sync_health_snapshots enable row level security;
create policy sync_health_read on sync_health_snapshots for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  );
-- Any till JWT (cashier or device) can push heartbeats for its own till_id.
create policy sync_health_insert_own_till on sync_health_snapshots for insert
  with check (
    public.claim_role() in ('cashier', 'device')
    and till_id = public.claim_till_id()
    and store_id = public.claim_store_id()
  );

alter table sync_health_alerts enable row level security;
create policy sync_health_alerts_read on sync_health_alerts for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  );
-- Written only by pg_cron / SECURITY DEFINER function; no direct grants.
create policy sync_health_alerts_write_deny on sync_health_alerts for all
  using (false) with check (false);

-- ============================================================
-- Audit log — append-only via SECURITY DEFINER function
-- ============================================================

alter table audit_log enable row level security;
create policy audit_log_read on audit_log for select
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager'
        and (
          (new_value ->> 'store_id')::uuid = public.claim_store_id()
          or (old_value ->> 'store_id')::uuid = public.claim_store_id()
        ))
  );
create policy audit_log_write_deny on audit_log for all
  using (false) with check (false);
-- Actual writes go through public.append_audit(...) which is SECURITY DEFINER
-- and callable by any authenticated role.