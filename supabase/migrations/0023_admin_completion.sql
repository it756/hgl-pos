-- Admin console completion (Phase 14, T146+): master-data management,
-- stock counts, system settings, till administration, customers/loyalty.
-- Additive only (check-migration-compat.ts): new tables/columns/policies/
-- functions; nothing is dropped.

-- ============================================================
-- Shared: sentinel till id + audit actor resolution
-- ============================================================

-- Mirrors HQ_CONSOLE_TILL_ID in apps/admin/src/lib/prices/change.ts — rows
-- originating from the web console rather than a physical till.
create or replace function public.hq_console_till_id()
returns uuid
language sql
immutable
as $$ select '00000000-0000-4000-8000-000000000000'::uuid $$;

-- audit_log.actor_user_id references public.users; a device JWT's `sub` (or
-- any non-staff caller) is not a users row, so resolve to null instead of
-- letting the FK abort the audited write.
create or replace function public.audit_actor_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.user_id from public.users u where u.user_id = public.claim_user_id()
$$;

-- Generic master-data audit trigger. TG_ARGV[0] = name of the uuid column
-- used as audit_log.entity_id. Secrets are stripped before logging.
create or replace function public.audit_master_data_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entity_column text := tg_argv[0];
  old_json jsonb;
  new_json jsonb;
  entity uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_json := to_jsonb(old) - 'pin_hash' - 'device_credential_hash';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_json := to_jsonb(new) - 'pin_hash' - 'device_credential_hash';
  end if;

  if tg_op = 'UPDATE' and old_json = new_json then
    return new;
  end if;

  entity := coalesce(new_json ->> entity_column, old_json ->> entity_column)::uuid;

  perform public.append_audit(
    public.audit_actor_user_id(),
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    entity,
    old_json,
    new_json
  );

  return coalesce(new, old);
end;
$$;

create trigger stores_audit
  after insert or update or delete on public.stores
  for each row execute function public.audit_master_data_change('store_id');

create trigger sku_categories_audit
  after insert or update or delete on public.sku_categories
  for each row execute function public.audit_master_data_change('category_id');

create trigger skus_audit
  after insert or update or delete on public.skus
  for each row execute function public.audit_master_data_change('sku_id');

create trigger sku_barcodes_audit
  after insert or update or delete on public.sku_barcodes
  for each row execute function public.audit_master_data_change('sku_id');

create trigger store_sku_availability_audit
  after insert or update or delete on public.store_sku_availability
  for each row execute function public.audit_master_data_change('sku_id');

create trigger users_audit
  after insert or update or delete on public.users
  for each row execute function public.audit_master_data_change('user_id');

-- ============================================================
-- RLS gap fix: catalog tables shipped without RLS in 0001/0009
-- ============================================================

alter table public.sku_categories enable row level security;
create policy sku_categories_read_authenticated on public.sku_categories for select
  using (auth.role() = 'authenticated');
create policy sku_categories_write_hq on public.sku_categories for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table public.sku_barcodes enable row level security;
create policy sku_barcodes_read_authenticated on public.sku_barcodes for select
  using (auth.role() = 'authenticated');
create policy sku_barcodes_write_hq on public.sku_barcodes for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table public.store_sku_availability
  add column reorder_qty numeric(14, 3) check (reorder_qty is null or reorder_qty >= 0);

alter table public.store_sku_availability enable row level security;
create policy store_sku_availability_read_authenticated on public.store_sku_availability for select
  using (auth.role() = 'authenticated');
create policy store_sku_availability_write_hq on public.store_sku_availability for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');
-- Store managers tune stocking/reorder levels for their own store only;
-- they cannot add a SKU to a store's range (no INSERT) — that's an HQ
-- ranging decision.
create policy store_sku_availability_update_store_manager on public.store_sku_availability for update
  using (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
  with check (public.claim_role() = 'store_manager' and store_id = public.claim_store_id());

create or replace function public.enforce_store_sku_availability_manager_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.claim_role() = 'store_manager'
    and (new.sku_id is distinct from old.sku_id or new.created_at is distinct from old.created_at)
  then
    raise exception 'store manager may only update stocking and reorder levels' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger store_sku_availability_manager_scope
  before update on public.store_sku_availability
  for each row execute function public.enforce_store_sku_availability_manager_scope();

-- ============================================================
-- System settings (typed in apps/admin/src/lib/settings/schema.ts)
-- ============================================================

create table public.system_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  description text,
  updated_by_user_id uuid references public.users(user_id),
  updated_at timestamptz not null default now()
);

alter table public.system_settings enable row level security;
create policy system_settings_read_authenticated on public.system_settings for select
  using (auth.role() = 'authenticated');
create policy system_settings_write_hq on public.system_settings for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

create or replace function public.audit_system_setting_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.value = new.value then
    return new;
  end if;

  perform public.append_audit(
    public.audit_actor_user_id(),
    'system_settings.' || lower(tg_op),
    'system_setting',
    md5(new.key)::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('key', old.key, 'value', old.value) end,
    jsonb_build_object('key', new.key, 'value', new.value)
  );
  return new;
end;
$$;

create trigger system_settings_audit
  after insert or update on public.system_settings
  for each row execute function public.audit_system_setting_change();

insert into public.system_settings (key, value, description) values
  ('adjustment_approval_threshold_qty', '10'::jsonb,
    'Adjustments with |quantity| above this need a second manager approval (FR-017).'),
  ('expiry_warning_days', '14'::jsonb,
    'Batches expiring within this many days appear on the inventory dashboard.'),
  ('low_stock_alert_emails', '[]'::jsonb,
    'Recipients for low-stock alert emails (FR-018).'),
  ('receipt_header', '"Harvest Group"'::jsonb,
    'Text printed at the top of till receipts.'),
  ('receipt_footer', '"Thank you for shopping with us"'::jsonb,
    'Text printed at the bottom of till receipts.'),
  ('default_report_timezone', '"Africa/Lusaka"'::jsonb,
    'Timezone used for report day boundaries when a store has none.')
on conflict (key) do nothing;

-- ============================================================
-- Till administration (hq_admin, from the web console)
-- ============================================================

create or replace function public.admin_reset_till_credential(p_till_id uuid)
returns table (credential text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_credential text := encode(extensions.gen_random_bytes(32), 'base64');
  new_expires_at timestamptz := now() + interval '90 days';
  till_store_id uuid;
begin
  if public.claim_role() <> 'hq_admin' then
    raise exception 'only hq_admin may reset till credentials' using errcode = '42501';
  end if;

  update public.tills t
  set device_credential_hash = extensions.crypt(new_credential, extensions.gen_salt('bf'))
  where t.till_id = p_till_id and t.retired_at is null
  returning t.store_id into till_store_id;

  if till_store_id is null then
    raise exception 'till % not found or retired', p_till_id using errcode = 'P0002';
  end if;

  perform public.append_audit(
    public.audit_actor_user_id(),
    'till.device_credential.admin_reset',
    'till',
    p_till_id,
    null,
    jsonb_build_object('store_id', till_store_id, 'credential_expires_at', new_expires_at)
  );

  credential := new_credential;
  expires_at := new_expires_at;
  return next;
end;
$$;

grant execute on function public.admin_reset_till_credential(uuid) to authenticated;

create or replace function public.retire_till(p_till_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  till_store_id uuid;
begin
  if public.claim_role() <> 'hq_admin' then
    raise exception 'only hq_admin may retire tills' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required to retire a till' using errcode = '22023';
  end if;

  update public.tills t
  set retired_at = now()
  where t.till_id = p_till_id and t.retired_at is null
  returning t.store_id into till_store_id;

  if till_store_id is null then
    raise exception 'till % not found or already retired', p_till_id using errcode = 'P0002';
  end if;

  perform public.append_audit(
    public.audit_actor_user_id(),
    'till.retire',
    'till',
    p_till_id,
    null,
    jsonb_build_object('store_id', till_store_id, 'reason', trim(p_reason))
  );
end;
$$;

grant execute on function public.retire_till(uuid, text) to authenticated;

-- ============================================================
-- Stock counts / cycle counts (FR-016)
-- ============================================================

create table public.stock_counts (
  count_id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id),
  category_id uuid references public.sku_categories(category_id),
  status text not null default 'open' check (status in ('open', 'submitted', 'cancelled')),
  notes text,
  created_by_user_id uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  closed_by_user_id uuid references public.users(user_id),
  closed_at timestamptz,
  constraint stock_counts_closed_fields check (
    (status = 'open' and closed_at is null and closed_by_user_id is null)
    or (status <> 'open' and closed_at is not null and closed_by_user_id is not null)
  )
);

create table public.stock_count_lines (
  count_id uuid not null references public.stock_counts(count_id),
  sku_id uuid not null references public.skus(sku_id),
  expected_qty numeric(14, 3) not null,
  counted_qty numeric(14, 3) check (counted_qty is null or counted_qty >= 0),
  correction_qty numeric(14, 3),
  counted_at timestamptz,
  primary key (count_id, sku_id)
);

create index stock_counts_store_status_idx on public.stock_counts (store_id, status, created_at desc);

create or replace function public.can_manage_store(p_store_id uuid)
returns boolean
language sql
stable
as $$
  select public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and p_store_id = public.claim_store_id())
$$;

alter table public.stock_counts enable row level security;
create policy stock_counts_read on public.stock_counts for select
  using (public.can_manage_store(store_id));
-- Lifecycle transitions only via the SECURITY DEFINER RPCs below.
create policy stock_counts_write_deny on public.stock_counts for all
  using (false) with check (false);

alter table public.stock_count_lines enable row level security;
create policy stock_count_lines_read on public.stock_count_lines for select
  using (exists (
    select 1 from public.stock_counts c
    where c.count_id = stock_count_lines.count_id and public.can_manage_store(c.store_id)
  ));
create policy stock_count_lines_update_open on public.stock_count_lines for update
  using (exists (
    select 1 from public.stock_counts c
    where c.count_id = stock_count_lines.count_id and c.status = 'open' and public.can_manage_store(c.store_id)
  ))
  with check (exists (
    select 1 from public.stock_counts c
    where c.count_id = stock_count_lines.count_id and c.status = 'open' and public.can_manage_store(c.store_id)
  ));

create or replace function public.enforce_stock_count_line_update_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Clients may only record a count; expected/correction are server-owned.
  if current_user in ('authenticated', 'anon')
    and (new.count_id is distinct from old.count_id
      or new.sku_id is distinct from old.sku_id
      or new.expected_qty is distinct from old.expected_qty
      or new.correction_qty is distinct from old.correction_qty)
  then
    raise exception 'only counted_qty may be updated on a count line' using errcode = '42501';
  end if;
  new.counted_at := case when new.counted_qty is null then null else now() end;
  return new;
end;
$$;

create trigger stock_count_lines_update_scope
  before update on public.stock_count_lines
  for each row execute function public.enforce_stock_count_line_update_scope();

create or replace function public.start_stock_count(p_store_id uuid, p_category_id uuid, p_notes text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.audit_actor_user_id();
  new_count_id uuid := gen_random_uuid();
  line_count int;
begin
  if not public.can_manage_store(p_store_id) or actor is null then
    raise exception 'caller may not run stock counts for this store' using errcode = '42501';
  end if;

  insert into public.stock_counts (count_id, store_id, category_id, notes, created_by_user_id)
  values (new_count_id, p_store_id, p_category_id, nullif(trim(coalesce(p_notes, '')), ''), actor);

  insert into public.stock_count_lines (count_id, sku_id, expected_qty)
  select new_count_id, a.sku_id, coalesce(c.qty_on_hand, 0)
  from public.store_sku_availability a
  join public.skus s on s.sku_id = a.sku_id
  left join public.current_stock_by_store_sku c on c.store_id = a.store_id and c.sku_id = a.sku_id
  where a.store_id = p_store_id
    and a.is_stocked
    and s.is_active
    and (p_category_id is null or s.category_id = p_category_id);

  get diagnostics line_count = row_count;
  if line_count = 0 then
    raise exception 'no stocked SKUs match this count scope' using errcode = '22023';
  end if;

  return new_count_id;
end;
$$;

grant execute on function public.start_stock_count(uuid, uuid, text) to authenticated;

-- Writes one count_correction stock event per counted line whose counted
-- quantity differs from the CURRENT derived stock (not the snapshot), so
-- sales rung up during the count are not double-corrected.
create or replace function public.submit_stock_count(p_count_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.audit_actor_user_id();
  count_row public.stock_counts%rowtype;
  line record;
  current_qty numeric(14, 3);
  correction numeric(14, 3);
  corrections int := 0;
begin
  select * into count_row from public.stock_counts where count_id = p_count_id for update;
  if not found then
    raise exception 'stock count % not found', p_count_id using errcode = 'P0002';
  end if;
  if not public.can_manage_store(count_row.store_id) or actor is null then
    raise exception 'caller may not submit this stock count' using errcode = '42501';
  end if;
  if count_row.status <> 'open' then
    raise exception 'stock count % is already %', p_count_id, count_row.status using errcode = '22023';
  end if;

  for line in
    select l.sku_id, l.counted_qty
    from public.stock_count_lines l
    where l.count_id = p_count_id and l.counted_qty is not null
  loop
    select coalesce(c.qty_on_hand, 0) into current_qty
    from public.current_stock_by_store_sku c
    where c.store_id = count_row.store_id and c.sku_id = line.sku_id;
    current_qty := coalesce(current_qty, 0);
    correction := line.counted_qty - current_qty;

    update public.stock_count_lines
    set correction_qty = correction
    where count_id = p_count_id and sku_id = line.sku_id;

    if correction <> 0 then
      insert into public.stock_events (
        event_id, till_id, store_id, client_ts, app_version, schema_ver,
        sku_id, event_type, delta_qty, source_ref_id, reason_code, notes
      ) values (
        gen_random_uuid(), public.hq_console_till_id(), count_row.store_id, now(), 'admin-web', 1,
        line.sku_id, 'count_correction', correction, p_count_id, 'cycle_count', count_row.notes
      );
      corrections := corrections + 1;
    end if;
  end loop;

  update public.stock_counts
  set status = 'submitted', closed_at = now(), closed_by_user_id = actor
  where count_id = p_count_id;

  perform public.append_audit(
    actor,
    'stock_count.submit',
    'stock_count',
    p_count_id,
    null,
    jsonb_build_object('store_id', count_row.store_id, 'corrections', corrections)
  );

  return corrections;
end;
$$;

grant execute on function public.submit_stock_count(uuid) to authenticated;

create or replace function public.cancel_stock_count(p_count_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.audit_actor_user_id();
  count_store_id uuid;
begin
  select store_id into count_store_id from public.stock_counts where count_id = p_count_id and status = 'open';
  if count_store_id is null then
    raise exception 'open stock count % not found', p_count_id using errcode = 'P0002';
  end if;
  if not public.can_manage_store(count_store_id) or actor is null then
    raise exception 'caller may not cancel this stock count' using errcode = '42501';
  end if;

  update public.stock_counts
  set status = 'cancelled', closed_at = now(), closed_by_user_id = actor
  where count_id = p_count_id;
end;
$$;

grant execute on function public.cancel_stock_count(uuid) to authenticated;

-- ============================================================
-- Customers & loyalty (FR-037, optional)
-- ============================================================

create table public.loyalty_tiers (
  tier_id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]+$'),
  name text not null,
  rank int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  customer_id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  phone text unique,
  email text,
  loyalty_tier_id uuid references public.loyalty_tiers(tier_id),
  credit_limit numeric(14, 2) check (credit_limit is null or credit_limit >= 0),
  home_store_id uuid references public.stores(store_id),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_full_name_idx on public.customers (lower(full_name));
create index customers_loyalty_tier_idx on public.customers (loyalty_tier_id);

alter table public.loyalty_tiers enable row level security;
create policy loyalty_tiers_read_authenticated on public.loyalty_tiers for select
  using (auth.role() = 'authenticated');
create policy loyalty_tiers_write_hq on public.loyalty_tiers for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table public.customers enable row level security;
create policy customers_read_staff on public.customers for select
  using (public.claim_role() in ('hq_admin', 'store_manager', 'cashier', 'device'));
create policy customers_insert_staff on public.customers for insert
  with check (public.claim_role() in ('hq_admin', 'store_manager'));
create policy customers_update_staff on public.customers for update
  using (public.claim_role() in ('hq_admin', 'store_manager'))
  with check (public.claim_role() in ('hq_admin', 'store_manager'));

create trigger loyalty_tiers_audit
  after insert or update or delete on public.loyalty_tiers
  for each row execute function public.audit_master_data_change('tier_id');

create trigger customers_audit
  after insert or update or delete on public.customers
  for each row execute function public.audit_master_data_change('customer_id');
