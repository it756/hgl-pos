begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

create or replace function public.rls_test_shift_insert_rejected(
  test_event_id uuid,
  test_till_id uuid,
  test_store_id uuid,
  test_shift_id uuid,
  test_cashier_id uuid
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.shift_events (
    event_id, till_id, store_id, client_ts, app_version, schema_ver,
    shift_id, cashier_id, event_kind, payload
  ) values (
    test_event_id,
    test_till_id,
    test_store_id,
    now(), 'rls-test', 1,
    test_shift_id,
    test_cashier_id,
    'shift_open', '{"opening_float": 0}'::jsonb
  );

  return false;
exception when others then
  return true;
end;
$$;

select set_eq(
  $$
    select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'public'
    order by 1
  $$,
  $$
    values
      ('adjustment_events:adjustment_events_insert_request'),
      ('adjustment_events:adjustment_events_read'),
      ('audit_log:audit_log_read'),
      ('audit_log:audit_log_write_deny'),
      ('current_stock_by_store_sku:stock_projection_read'),
      ('customers:customers_insert_staff'),
      ('customers:customers_read_staff'),
      ('customers:customers_update_staff'),
      ('current_stock_by_store_sku:stock_projection_write_deny'),
      ('loyalty_tiers:loyalty_tiers_read_authenticated'),
      ('loyalty_tiers:loyalty_tiers_write_hq'),
      ('price_change_events:price_change_events_insert_hq'),
      ('price_change_events:price_change_events_read_hq'),
      ('price_versions:price_versions_read_scope'),
      ('price_versions:price_versions_write_deny'),
      ('promotions:promotions_read_scope'),
      ('promotions:promotions_write_hq'),
      ('report_schedules:report_schedules_read'),
      ('report_schedules:report_schedules_write'),
      ('rollout_records:rollout_records_read'),
      ('rollout_records:rollout_records_write_hq'),
      ('sale_events:sale_events_insert_by_own_till'),
      ('sale_events:sale_events_read'),
      ('sales:sales_read'),
      ('sales:sales_write_deny'),
      ('shift_events:shift_events_insert_by_own_till'),
      ('shift_events:shift_events_read'),
      ('shifts:shifts_read'),
      ('shifts:shifts_write_deny'),
      ('sku_barcodes:sku_barcodes_read_authenticated'),
      ('sku_barcodes:sku_barcodes_write_hq'),
      ('sku_categories:sku_categories_read_authenticated'),
      ('sku_categories:sku_categories_write_hq'),
      ('skus:skus_read_authenticated'),
      ('skus:skus_write_hq'),
      ('sku_suppliers:sku_suppliers_read_all_authenticated'),
      ('sku_suppliers:sku_suppliers_write_hq'),
      ('stock_count_lines:stock_count_lines_read'),
      ('stock_count_lines:stock_count_lines_update_open'),
      ('stock_counts:stock_counts_read'),
      ('stock_counts:stock_counts_write_deny'),
      ('stock_events:stock_events_insert_count_correction'),
      ('stock_events:stock_events_read'),
      ('store_sku_availability:store_sku_availability_read_authenticated'),
      ('store_sku_availability:store_sku_availability_update_store_manager'),
      ('store_sku_availability:store_sku_availability_write_hq'),
      ('stores:stores_read_all_authenticated'),
      ('stores:stores_write_hq'),
      ('suppliers:suppliers_read_all_authenticated'),
      ('suppliers:suppliers_write_hq'),
      ('sync_health_alerts:sync_health_alerts_read'),
      ('sync_health_alerts:sync_health_alerts_write_deny'),
      ('sync_health_snapshots:sync_health_insert_own_till'),
      ('sync_health_snapshots:sync_health_read'),
      ('system_settings:system_settings_read_authenticated'),
      ('system_settings:system_settings_write_hq'),
      ('tills:tills_read_store_scope'),
      ('tills:tills_write_hq'),
      ('transfer_events:transfer_events_insert_by_manager'),
      ('transfer_events:transfer_events_read'),
      ('transfers:transfers_read'),
      ('transfers:transfers_write_deny'),
      ('users:users_read_store_scope'),
      ('users:users_update_store_manager'),
      ('users:users_write_hq')
  $$,
  'installed RLS policies match the contract inventory'
);

select set_eq(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
    order by c.relname
  $$,
  $$
    values
      ('adjustment_events'),
      ('audit_log'),
      ('current_stock_by_store_sku'),
      ('customers'),
      ('loyalty_tiers'),
      ('price_change_events'),
      ('price_versions'),
      ('promotions'),
      ('report_schedules'),
      ('rollout_records'),
      ('sale_events'),
      ('sales'),
      ('shift_events'),
      ('shifts'),
      ('skus'),
      ('sku_barcodes'),
      ('sku_categories'),
      ('sku_suppliers'),
      ('stock_count_lines'),
      ('stock_counts'),
      ('stock_events'),
      ('store_sku_availability'),
      ('stores'),
      ('suppliers'),
      ('sync_health_alerts'),
      ('sync_health_snapshots'),
      ('system_settings'),
      ('tills'),
      ('transfer_events'),
      ('transfers'),
      ('users')
  $$,
  'all policy-protected tables have RLS enabled'
);

insert into public.stores (store_id, code, name) values
  ('31000000-0000-4000-8000-000000000001', 'RLS-A', 'RLS Store A'),
  ('31000000-0000-4000-8000-000000000002', 'RLS-B', 'RLS Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('31000000-0000-4000-8000-000000000011', '31000000-0000-4000-8000-000000000001', 'Till A', 'rls-device-a', 'hash'),
  ('31000000-0000-4000-8000-000000000012', '31000000-0000-4000-8000-000000000002', 'Till B', 'rls-device-b', 'hash');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('31000000-0000-4000-8000-000000000101', 'cashier', '31000000-0000-4000-8000-000000000001', 'Cashier A', 'hash', now()),
  ('31000000-0000-4000-8000-000000000102', 'cashier', '31000000-0000-4000-8000-000000000002', 'Cashier B', 'hash', now());

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"31000000-0000-4000-8000-000000000901","role":"authenticated","app_metadata":{"role":"device","store_id":"31000000-0000-4000-8000-000000000001","till_id":"31000000-0000-4000-8000-000000000011","device_id":"31000000-0000-4000-8000-000000000901"}}',
  true
);

select is(
  (select count(*)::int from public.users),
  1,
  'device JWT reads only its store cashier roster'
);

select lives_ok(
  $$
    insert into public.shift_events (
      event_id, till_id, store_id, client_ts, app_version, schema_ver,
      shift_id, cashier_id, event_kind, payload
    ) values (
      '31000000-0000-4000-8000-000000000201',
      '31000000-0000-4000-8000-000000000011',
      '31000000-0000-4000-8000-000000000001',
      now(), 'rls-test', 1,
      '31000000-0000-4000-8000-000000000301',
      '31000000-0000-4000-8000-000000000101',
      'shift_open', '{"opening_float": 0}'::jsonb
    )
  $$,
  'device JWT can insert shift events for its own till and store cashier'
);

select ok(
  public.rls_test_shift_insert_rejected(
    '31000000-0000-4000-8000-000000000202',
    '31000000-0000-4000-8000-000000000012',
    '31000000-0000-4000-8000-000000000002',
    '31000000-0000-4000-8000-000000000302',
    '31000000-0000-4000-8000-000000000102'
  ),
  'device JWT cannot insert shift events for another till/store'
);

select ok(
  public.rls_test_shift_insert_rejected(
    '31000000-0000-4000-8000-000000000203',
    '31000000-0000-4000-8000-000000000011',
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000303',
    '31000000-0000-4000-8000-000000000102'
  ),
  'device JWT cannot impersonate a cross-store cashier'
);

select * from finish();

rollback;