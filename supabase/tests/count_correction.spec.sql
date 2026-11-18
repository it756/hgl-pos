-- T098: count-correction stock_events must appear as their own distinct
-- reconciliation line and never be merged into or conflated with
-- shrinkage/adjustment events. No dedicated "shrinkage" DB view exists yet
-- (apps/admin/src/lib/reports/inventory.ts does that split at the
-- application-query level, not in Postgres) — this asserts directly on
-- stock_events.event_type, which is the ground truth the app layer reads.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.stores (store_id, code, name) values
  ('40000000-0000-4000-8000-000000000001', 'CC-A', 'Count Correction Store A');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', 'Till A', 'cc-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('40000000-0000-4000-8000-000000000021', 'CC-SKU', 'Count Correction SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('40000000-0000-4000-8000-000000000101', 'cashier', '40000000-0000-4000-8000-000000000001', 'Count Correction Cashier', 'hash', now());

-- A sale (event_type='sale') and an adjustment (event_type='adjustment') as
-- distractor rows alongside two count_correction rows.
insert into public.stock_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sku_id, event_type, delta_qty, source_ref_id, reason_code, notes) values
  ('40000000-0000-4000-8000-000000000201', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now(), now(), 'cc-test', 1, '40000000-0000-4000-8000-000000000021', 'sale', -5.000, null, null, null),
  ('40000000-0000-4000-8000-000000000202', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now(), now(), 'cc-test', 1, '40000000-0000-4000-8000-000000000021', 'adjustment', -2.000, null, 'damaged', null),
  ('40000000-0000-4000-8000-000000000203', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now(), now(), 'cc-test', 1, '40000000-0000-4000-8000-000000000021', 'count_correction', -1.500, null, 'cycle-count', 'shrinkage found'),
  ('40000000-0000-4000-8000-000000000204', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now(), now(), 'cc-test', 1, '40000000-0000-4000-8000-000000000021', 'count_correction', 3.000, null, 'cycle-count', 'found extra stock');

-- 1) count_correction rows are their own distinct event_type bucket.
select is(
  (select count(*)::int from public.stock_events where store_id = '40000000-0000-4000-8000-000000000001' and sku_id = '40000000-0000-4000-8000-000000000021' and event_type = 'count_correction'),
  2,
  'both count_correction rows are queryable as their own distinct event_type bucket'
);

-- 2) count_correction rows are never counted as 'adjustment' or 'sale'.
select is(
  (select count(*)::int from public.stock_events where store_id = '40000000-0000-4000-8000-000000000001' and sku_id = '40000000-0000-4000-8000-000000000021' and event_type = 'adjustment'),
  1,
  'adjustment rows remain their own bucket, not inflated by count_correction rows'
);

select is(
  (select count(*)::int from public.stock_events where store_id = '40000000-0000-4000-8000-000000000001' and sku_id = '40000000-0000-4000-8000-000000000021' and event_type = 'sale'),
  1,
  'sale rows remain their own bucket, not inflated by count_correction rows'
);

-- 3) Summing count_correction alone gives the net reconciliation figure
--    (-1.5 + 3.0 = 1.5), independent of sale/adjustment deltas.
select is(
  (select sum(delta_qty) from public.stock_events where store_id = '40000000-0000-4000-8000-000000000001' and sku_id = '40000000-0000-4000-8000-000000000021' and event_type = 'count_correction'),
  1.500,
  'summing count_correction rows alone gives the net reconciliation figure, uncontaminated by sale/adjustment deltas'
);

-- 4) The full ledger total across all event types is still correct
--    (-5 + -2 + -1.5 + 3 = -5.5), proving the distinction is additive, not exclusive.
select is(
  (select sum(delta_qty) from public.stock_events where store_id = '40000000-0000-4000-8000-000000000001' and sku_id = '40000000-0000-4000-8000-000000000021'),
  -5.500,
  'the overall stock ledger total still sums correctly across all event types'
);

-- 5) event_type is a hard CHECK-constrained enum (schema-level guarantee
--    that a count_correction row can never silently be miscategorized).
select throws_ok(
  $$ insert into public.stock_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sku_id, event_type, delta_qty)
     values ('40000000-0000-4000-8000-000000000299', '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000001', now(), now(), 'cc-test', 1, '40000000-0000-4000-8000-000000000021', 'shrinkage', -1) $$,
  '23514',
  null,
  'event_type is schema-constrained: an invalid category like ''shrinkage'' cannot be inserted, only the defined enum values'
);

select * from finish();

rollback;
