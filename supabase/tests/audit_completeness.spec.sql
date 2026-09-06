-- T142: SC-006 requires every price change and every threshold-adjustment
-- approval/rejection to produce an audit_log row. This asserts the two
-- projection triggers that call public.append_audit (0007's
-- apply_price_change_event_to_versions, 0016's
-- apply_adjustment_event_to_projection) actually do so end-to-end, by
-- inserting real events and inspecting audit_log — not just reading the
-- trigger source.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into public.stores (store_id, code, name) values
  ('36000000-0000-4000-8000-000000000001', 'AUD-A', 'Audit Store A');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('36000000-0000-4000-8000-000000000011', '36000000-0000-4000-8000-000000000001', 'Till A', 'audit-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('36000000-0000-4000-8000-000000000021', 'AUD-SKU', 'Audit SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('36000000-0000-4000-8000-000000000101', 'store_manager', '36000000-0000-4000-8000-000000000001', 'Audit Manager', 'hash', now()),
  ('36000000-0000-4000-8000-000000000102', 'cashier', '36000000-0000-4000-8000-000000000001', 'Audit Cashier', 'hash', now());

-- Price change: exactly one audit_log row, entity_type=price_version,
-- action=price_changed, new_value carries the new unit price.
insert into public.price_change_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  price_version_id, sku_id, old_unit_price, new_unit_price, effective_from,
  changed_by_user_id, reason
) values (
  '36000000-0000-4000-8000-000000000201', '36000000-0000-4000-8000-000000000011',
  '36000000-0000-4000-8000-000000000001', now(), now(), 'audit-test', 1,
  '36000000-0000-4000-8000-000000000301', '36000000-0000-4000-8000-000000000021',
  10.00, 12.50, now(), '36000000-0000-4000-8000-000000000101', 'audit test price change'
);

select is(
  (select count(*)::int from public.audit_log where entity_type = 'price_version' and entity_id = '36000000-0000-4000-8000-000000000301'),
  1,
  'price change event produces exactly one audit_log row'
);

select is(
  (select action from public.audit_log where entity_type = 'price_version' and entity_id = '36000000-0000-4000-8000-000000000301'),
  'price_changed',
  'price change audit row records action price_changed'
);

select is(
  ((select new_value from public.audit_log where entity_type = 'price_version' and entity_id = '36000000-0000-4000-8000-000000000301') ->> 'unit_price')::numeric,
  12.50,
  'price change audit row new_value carries the new unit price'
);

-- Adjustment request: no audit row yet (only approve/reject are audited).
insert into public.adjustment_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id
) values (
  '36000000-0000-4000-8000-000000000202', '36000000-0000-4000-8000-000000000011',
  '36000000-0000-4000-8000-000000000001', now(), now(), 'audit-test', 1,
  '36000000-0000-4000-8000-000000000401', 'adjustment_requested', '36000000-0000-4000-8000-000000000021',
  -5.000, 'damaged', '36000000-0000-4000-8000-000000000102'
);

select is(
  (select count(*)::int from public.audit_log where entity_type = 'sku' and entity_id = '36000000-0000-4000-8000-000000000021'),
  0,
  'adjustment request alone does not produce an audit_log row'
);

-- Adjustment approval: exactly one audit_log row, entity_type=sku,
-- action=adjustment.adjustment_approved.
insert into public.adjustment_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id
) values (
  '36000000-0000-4000-8000-000000000203', '36000000-0000-4000-8000-000000000011',
  '36000000-0000-4000-8000-000000000001', now(), now(), 'audit-test', 1,
  '36000000-0000-4000-8000-000000000401', 'adjustment_approved', '36000000-0000-4000-8000-000000000021',
  -5.000, 'damaged', '36000000-0000-4000-8000-000000000102', '36000000-0000-4000-8000-000000000101'
);

select is(
  (select count(*)::int from public.audit_log where entity_type = 'sku' and entity_id = '36000000-0000-4000-8000-000000000021' and action = 'adjustment.adjustment_approved'),
  1,
  'adjustment approval produces exactly one audit_log row'
);

select is(
  ((select new_value from public.audit_log where action = 'adjustment.adjustment_approved' and entity_id = '36000000-0000-4000-8000-000000000021') ->> 'adjustment_id')::uuid,
  '36000000-0000-4000-8000-000000000401'::uuid,
  'adjustment approval audit row new_value carries the adjustment_id'
);

-- Adjustment rejection (different adjustment_id): also produces an audit row.
insert into public.adjustment_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id
) values (
  '36000000-0000-4000-8000-000000000204', '36000000-0000-4000-8000-000000000011',
  '36000000-0000-4000-8000-000000000001', now(), now(), 'audit-test', 1,
  '36000000-0000-4000-8000-000000000402', 'adjustment_rejected', '36000000-0000-4000-8000-000000000021',
  -3.000, 'damaged', '36000000-0000-4000-8000-000000000102', '36000000-0000-4000-8000-000000000101'
);

select is(
  (select count(*)::int from public.audit_log where entity_type = 'sku' and entity_id = '36000000-0000-4000-8000-000000000021' and action = 'adjustment.adjustment_rejected'),
  1,
  'adjustment rejection produces exactly one audit_log row'
);

-- A rejected adjustment must NOT move the stock projection (only approved
-- adjustments emit a companion stock_event, per apply_adjustment_event_to_projection).
select is(
  (select count(*)::int from public.stock_events where source_ref_id = '36000000-0000-4000-8000-000000000402'),
  0,
  'adjustment rejection does not emit a companion stock event'
);

-- Total audit rows for this fixture: 1 price change + 2 adjustment (approve+reject) = 3.
select is(
  (select count(*)::int from public.audit_log where entity_id in (
    '36000000-0000-4000-8000-000000000301',
    '36000000-0000-4000-8000-000000000021'
  )),
  3,
  'exactly three audit rows exist across price-change and adjustment fixtures'
);

select * from finish();
rollback;
