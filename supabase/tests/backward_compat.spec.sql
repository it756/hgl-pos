begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

-- T132: backward-compatibility regression harness (research.md §6, EC-20:
-- expand-then-contract migration rule; enforced going forward by
-- packages/db-shared/scripts/check-migration-compat.ts, T127).
--
-- Ideally this test would reproduce a REAL historical case: a column added
-- to an event table in a migration LATER than that table's original
-- `create table`, then prove an insert shaped like the payload from BEFORE
-- that column existed still succeeds today. As of this writing there is no
-- such case in supabase/migrations/*.sql yet — every event table's columns
-- (stock_events, sale_events, shift_events, transfer_events,
-- adjustment_events, price_change_events) were all defined in their
-- original 0002_event_tables.sql `create table` statement; no migration
-- since has run `alter table ... add column` against any of them (checked
-- via `grep -i "add column" supabase/migrations/*.sql`, zero matches).
--
-- So instead this proves the GENERAL contract that makes future additive
-- (expand) migrations safe: every event table already has nullable and/or
-- defaulted columns beyond its historically-required core fields, and an
-- INSERT that omits them entirely (exactly what an old, not-yet-upgraded
-- till's client payload would look like against a future schema that adds
-- more optional columns) must still ingest successfully, with the omitted
-- columns reading back as their sensible null/default value rather than
-- erroring. This is the same guarantee check-migration-compat.ts's
-- EXPAND-CONTRACT-OK marker convention is protecting on the "drop" side —
-- this test protects the "add" side of the same expand-then-contract rule.
--
-- Fixture UUIDs use the '46000000-0000-4000-8000-' prefix (reserved for
-- this file) to avoid collisions with other pgTAP spec files.

select plan(11);

insert into public.stores (store_id, code, name) values
  ('46000000-0000-4000-8000-000000000001', 'BACKCOMPAT', 'Backward-Compat Store');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('46000000-0000-4000-8000-000000000011', '46000000-0000-4000-8000-000000000001', 'Backward-Compat Till', 'backcompat-device', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('46000000-0000-4000-8000-000000000021', 'BACKCOMPAT-SKU', 'Backward-Compat SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('46000000-0000-4000-8000-000000000101', 'cashier', '46000000-0000-4000-8000-000000000001', 'Backward-Compat Cashier', 'hash', now());

-- An "old-shaped" stock_events payload: only the columns that have always
-- been required are specified. server_ts (defaulted) and the nullable
-- source_ref_id/batch_no/expiry_date/reason_code/notes are all omitted,
-- exactly as an older client build that predates those fields would send.
insert into public.stock_events (
  event_id, till_id, store_id, client_ts, app_version, schema_ver, sku_id, event_type, delta_qty
) values (
  '46000000-0000-4000-8000-000000000201',
  '46000000-0000-4000-8000-000000000011',
  '46000000-0000-4000-8000-000000000001',
  '2026-01-01 08:00:00+00',
  'legacy-client-1.0.0',
  1,
  '46000000-0000-4000-8000-000000000021',
  'sale',
  -1
);

select is(
  (select count(*)::int from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  1,
  'old-shaped stock_events insert (omitting source_ref_id/batch_no/expiry_date/reason_code/notes) ingests successfully'
);

select is(
  (select source_ref_id from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::uuid,
  'omitted source_ref_id reads back as null'
);

select is(
  (select batch_no from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::text,
  'omitted batch_no reads back as null'
);

select is(
  (select expiry_date from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::date,
  'omitted expiry_date reads back as null'
);

select is(
  (select reason_code from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::text,
  'omitted reason_code reads back as null (allowed for a sale event_type)'
);

select is(
  (select notes from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::text,
  'omitted notes reads back as null'
);

select isnt(
  (select server_ts from public.stock_events where event_id = '46000000-0000-4000-8000-000000000201'),
  null::timestamptz,
  'omitted server_ts still receives its default (now())'
);

-- An "old-shaped" sale_events payload: discount_total/tax_total (both
-- defaulted to 0) and original_sale_id/refund_kind (both nullable) are all
-- omitted, exactly as a pre-promotions/pre-refund-tracking client build
-- would send.
insert into public.sale_events (
  event_id, till_id, store_id, client_ts, app_version, schema_ver,
  sale_id, cashier_id, shift_id, status, items, tenders, subtotal, grand_total
) values (
  '46000000-0000-4000-8000-000000000202',
  '46000000-0000-4000-8000-000000000011',
  '46000000-0000-4000-8000-000000000001',
  '2026-01-01 08:05:00+00',
  'legacy-client-1.0.0',
  1,
  '46000000-0000-4000-8000-000000000302',
  '46000000-0000-4000-8000-000000000101',
  '46000000-0000-4000-8000-000000000301',
  'completed',
  '[{"sku_id":"46000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
  '[{"type":"cash","amount":10}]'::jsonb,
  10,
  10
);

select is(
  (select count(*)::int from public.sale_events where event_id = '46000000-0000-4000-8000-000000000202'),
  1,
  'old-shaped sale_events insert (omitting discount_total/tax_total/original_sale_id/refund_kind) ingests successfully'
);

select is(
  (select discount_total from public.sale_events where event_id = '46000000-0000-4000-8000-000000000202'),
  0.00,
  'omitted discount_total defaults to 0'
);

select is(
  (select tax_total from public.sale_events where event_id = '46000000-0000-4000-8000-000000000202'),
  0.00,
  'omitted tax_total defaults to 0'
);

select is(
  (select original_sale_id from public.sale_events where event_id = '46000000-0000-4000-8000-000000000202'),
  null::uuid,
  'omitted original_sale_id reads back as null (allowed for a completed sale)'
);

select * from finish();

rollback;
