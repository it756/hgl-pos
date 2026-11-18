-- Admin completion (Phase 14, T146+ / 0023): stock-count lifecycle writes
-- count_correction events against CURRENT stock, catalog tables enforce
-- RLS, system settings + master data are audited, till admin RPCs are
-- hq_admin-only.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into public.stores (store_id, code, name) values
  ('37000000-0000-4000-8000-000000000001', 'ADM-A', 'Admin Store A'),
  ('37000000-0000-4000-8000-000000000002', 'ADM-B', 'Admin Store B');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('37000000-0000-4000-8000-000000000101', 'hq_admin', null, 'Admin HQ', 'hash', now()),
  ('37000000-0000-4000-8000-000000000102', 'store_manager', '37000000-0000-4000-8000-000000000001', 'Manager A', 'hash', now());

insert into public.skus (sku_id, code, name, unit_type) values
  ('37000000-0000-4000-8000-000000000201', 'ADM-SKU-1', 'Count Me', 'quantity'),
  ('37000000-0000-4000-8000-000000000202', 'ADM-SKU-2', 'Leave Me', 'quantity');

insert into public.store_sku_availability (store_id, sku_id, reorder_point, is_stocked) values
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000201', 5, true),
  ('37000000-0000-4000-8000-000000000001', '37000000-0000-4000-8000-000000000202', 5, true),
  ('37000000-0000-4000-8000-000000000002', '37000000-0000-4000-8000-000000000201', 5, true);

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash, provisioned_at) values
  ('37000000-0000-4000-8000-000000000301', '37000000-0000-4000-8000-000000000001', 'ADM-T1', 'adm-device-1', 'x', now());

-- Opening stock of 10 for SKU-1 at store A.
insert into public.stock_events (event_id, till_id, store_id, client_ts, app_version, schema_ver, sku_id, event_type, delta_qty, reason_code)
values ('37000000-0000-4000-8000-000000000401', public.hq_console_till_id(), '37000000-0000-4000-8000-000000000001', now(), 'test', 1,
  '37000000-0000-4000-8000-000000000201', 'count_correction', 10, 'opening');

select ok(
  exists (select 1 from public.audit_log where entity_type = 'skus' and entity_id = '37000000-0000-4000-8000-000000000201' and action = 'skus.insert'),
  'SKU insert is audited'
);

set local role authenticated;

-- ---------- store_manager: count lifecycle ----------
select set_config(
  'request.jwt.claims',
  '{"sub":"37000000-0000-4000-8000-000000000102","role":"authenticated","app_metadata":{"role":"store_manager","store_id":"37000000-0000-4000-8000-000000000001"}}',
  true
);

select throws_ok(
  $$select public.start_stock_count('37000000-0000-4000-8000-000000000002', null, null)$$,
  '42501',
  null,
  'store_manager cannot start a count for another store'
);

create temporary table adm_count as
  select public.start_stock_count('37000000-0000-4000-8000-000000000001', null, 'cycle count A') as count_id;
grant select on adm_count to authenticated;

select is(
  (select count(*)::int from public.stock_count_lines where count_id = (select count_id from adm_count)),
  2,
  'count snapshot includes every stocked SKU in scope'
);

select is(
  (select expected_qty from public.stock_count_lines
   where count_id = (select count_id from adm_count) and sku_id = '37000000-0000-4000-8000-000000000201'),
  10.000::numeric,
  'expected qty is snapshotted from derived stock'
);

select lives_ok(
  $$update public.stock_count_lines set counted_qty = 7
    where count_id = (select count_id from adm_count) and sku_id = '37000000-0000-4000-8000-000000000201'$$,
  'manager can record a counted quantity'
);

select throws_ok(
  $$update public.stock_count_lines set expected_qty = 99
    where count_id = (select count_id from adm_count) and sku_id = '37000000-0000-4000-8000-000000000201'$$,
  '42501',
  null,
  'expected qty is server-owned'
);

-- A sale-equivalent movement during the count (simulated as superuser).
reset role;
insert into public.stock_events (event_id, till_id, store_id, client_ts, app_version, schema_ver, sku_id, event_type, delta_qty, reason_code)
values ('37000000-0000-4000-8000-000000000402', public.hq_console_till_id(), '37000000-0000-4000-8000-000000000001', now(), 'test', 1,
  '37000000-0000-4000-8000-000000000201', 'adjustment', -1, 'damage');
set local role authenticated;

select is(
  public.submit_stock_count((select count_id from adm_count)),
  1,
  'submit writes one correction (uncounted lines are skipped)'
);

select is(
  (select sum(delta_qty) from public.stock_events
   where source_ref_id = (select count_id from adm_count) and event_type = 'count_correction'),
  -2.000::numeric,
  'correction is counted minus CURRENT stock (7 - 9), not minus the snapshot'
);

select is(
  (select qty_on_hand from public.current_stock_by_store_sku
   where store_id = '37000000-0000-4000-8000-000000000001' and sku_id = '37000000-0000-4000-8000-000000000201'),
  7.000::numeric,
  'derived stock equals the counted quantity after submit'
);

select throws_ok(
  $$select public.submit_stock_count((select count_id from adm_count))$$,
  '22023',
  null,
  'a submitted count cannot be submitted twice'
);

-- ---------- store_manager: catalog/settings/till scope ----------
select lives_ok(
  $$update public.store_sku_availability set reorder_point = 3
    where store_id = '37000000-0000-4000-8000-000000000001' and sku_id = '37000000-0000-4000-8000-000000000201'$$,
  'manager can tune reorder point for own store'
);

select is(
  (select reorder_point from public.store_sku_availability
   where store_id = '37000000-0000-4000-8000-000000000002' and sku_id = '37000000-0000-4000-8000-000000000201'),
  5.000::numeric,
  'manager update does not reach another store (RLS)'
);

select throws_ok(
  $$insert into public.sku_categories (category_id, code, name) values (gen_random_uuid(), 'ADM-CAT', 'Nope')$$,
  '42501',
  null,
  'manager cannot write categories'
);

select throws_ok(
  $$select public.retire_till('37000000-0000-4000-8000-000000000301', 'lost')$$,
  '42501',
  null,
  'manager cannot retire a till'
);

-- ---------- hq_admin: settings + till admin ----------
select set_config(
  'request.jwt.claims',
  '{"sub":"37000000-0000-4000-8000-000000000101","role":"authenticated","app_metadata":{"role":"hq_admin"}}',
  true
);

update public.system_settings set value = '25'::jsonb where key = 'adjustment_approval_threshold_qty';
select public.retire_till('37000000-0000-4000-8000-000000000301', 'stolen');

reset role;

select ok(
  exists (select 1 from public.audit_log
          where action = 'system_settings.update'
            and new_value = '{"key":"adjustment_approval_threshold_qty","value":25}'::jsonb
            and actor_user_id = '37000000-0000-4000-8000-000000000101'),
  'settings change is audited with the acting user'
);

select ok(
  (select retired_at is not null from public.tills where till_id = '37000000-0000-4000-8000-000000000301')
  and exists (select 1 from public.audit_log where action = 'till.retire' and entity_id = '37000000-0000-4000-8000-000000000301'),
  'hq_admin can retire a till and it is audited'
);

select * from finish();
rollback;
