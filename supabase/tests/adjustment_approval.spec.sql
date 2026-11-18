-- T099: adjustment_events stock-projection side (audit side already covered
-- by supabase/tests/audit_completeness.spec.sql, fixture prefix 36000000).
-- Asserts: adjustment_requested alone never touches stock; adjustment_approved
-- creates exactly one companion stock_events row with the correct signed
-- delta_qty and updates current_stock_by_store_sku correctly;
-- adjustment_rejected never touches stock either.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

insert into public.stores (store_id, code, name) values
  ('41000000-0000-4000-8000-000000000001', 'ADJ-A', 'Adjustment Approval Store A');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('41000000-0000-4000-8000-000000000011', '41000000-0000-4000-8000-000000000001', 'Till A', 'adj-approval-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('41000000-0000-4000-8000-000000000021', 'ADJ-SKU', 'Adjustment Approval SKU', 'quantity'),
  ('41000000-0000-4000-8000-000000000022', 'ADJ-SKU-2', 'Adjustment Approval SKU 2', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('41000000-0000-4000-8000-000000000101', 'store_manager', '41000000-0000-4000-8000-000000000001', 'Adjustment Approval Manager', 'hash', now()),
  ('41000000-0000-4000-8000-000000000102', 'cashier', '41000000-0000-4000-8000-000000000001', 'Adjustment Approval Cashier', 'hash', now());

-- adjustment_requested alone: no stock_events row, no current_stock row.
insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id) values
  ('41000000-0000-4000-8000-000000000201', '41000000-0000-4000-8000-000000000011', '41000000-0000-4000-8000-000000000001', now(), now(), 'adj-test', 1, '41000000-0000-4000-8000-000000000301', 'adjustment_requested', '41000000-0000-4000-8000-000000000021', -4.000, 'damaged', '41000000-0000-4000-8000-000000000102');

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '41000000-0000-4000-8000-000000000201'),
  0,
  'adjustment_requested alone creates no companion stock_events row'
);

select is(
  (select count(*)::int from public.current_stock_by_store_sku where store_id = '41000000-0000-4000-8000-000000000001' and sku_id = '41000000-0000-4000-8000-000000000021'),
  0,
  'adjustment_requested alone does not create/touch a current_stock_by_store_sku row'
);

-- adjustment_approved: exactly one companion stock_events row, correct
-- signed delta_qty, and current_stock_by_store_sku updated correctly.
insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id) values
  ('41000000-0000-4000-8000-000000000202', '41000000-0000-4000-8000-000000000011', '41000000-0000-4000-8000-000000000001', now(), now(), 'adj-test', 1, '41000000-0000-4000-8000-000000000301', 'adjustment_approved', '41000000-0000-4000-8000-000000000021', -4.000, 'damaged', '41000000-0000-4000-8000-000000000102', '41000000-0000-4000-8000-000000000101');

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '41000000-0000-4000-8000-000000000202'),
  1,
  'adjustment_approved creates exactly one companion stock_events row'
);

select is(
  (select event_type from public.stock_events where source_ref_id = '41000000-0000-4000-8000-000000000202'),
  'adjustment',
  'the companion stock_events row is categorized as event_type=adjustment'
);

select is(
  (select delta_qty from public.stock_events where source_ref_id = '41000000-0000-4000-8000-000000000202'),
  -4.000,
  'the companion stock_events row carries the correct signed delta_qty'
);

select is(
  (select qty_on_hand from public.current_stock_by_store_sku where store_id = '41000000-0000-4000-8000-000000000001' and sku_id = '41000000-0000-4000-8000-000000000021'),
  -4.000,
  'current_stock_by_store_sku is updated by the approved adjustment delta'
);

-- adjustment_rejected (different SKU, so it can't be confused with the
-- approved one above): no companion stock event, no stock projection row.
insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id) values
  ('41000000-0000-4000-8000-000000000203', '41000000-0000-4000-8000-000000000011', '41000000-0000-4000-8000-000000000001', now(), now(), 'adj-test', 1, '41000000-0000-4000-8000-000000000302', 'adjustment_rejected', '41000000-0000-4000-8000-000000000022', -6.000, 'damaged', '41000000-0000-4000-8000-000000000102', '41000000-0000-4000-8000-000000000101');

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '41000000-0000-4000-8000-000000000203'),
  0,
  'adjustment_rejected creates no companion stock_events row'
);

select is(
  (select count(*)::int from public.current_stock_by_store_sku where store_id = '41000000-0000-4000-8000-000000000001' and sku_id = '41000000-0000-4000-8000-000000000022'),
  0,
  'adjustment_rejected does not create/touch a current_stock_by_store_sku row'
);

select * from finish();

rollback;
