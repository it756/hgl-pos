begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

insert into public.stores (store_id, code, name) values
  ('33000000-0000-4000-8000-000000000001', 'PROJ-A', 'Projection Store A'),
  ('33000000-0000-4000-8000-000000000002', 'PROJ-B', 'Projection Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('33000000-0000-4000-8000-000000000011', '33000000-0000-4000-8000-000000000001', 'Till A', 'projection-device-a', 'hash'),
  ('33000000-0000-4000-8000-000000000012', '33000000-0000-4000-8000-000000000002', 'Till B', 'projection-device-b', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('33000000-0000-4000-8000-000000000021', 'PROJ-SKU', 'Projection SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('33000000-0000-4000-8000-000000000101', 'cashier', '33000000-0000-4000-8000-000000000001', 'Projection Cashier', 'hash', now()),
  ('33000000-0000-4000-8000-000000000102', 'store_manager', '33000000-0000-4000-8000-000000000001', 'Projection Manager', 'hash', now());

select public.ingest_shift_event(row(
  '33000000-0000-4000-8000-000000000201'::uuid,
  '33000000-0000-4000-8000-000000000011'::uuid,
  '33000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 08:00:00+00'::timestamptz,
  '2026-01-01 08:00:01+00'::timestamptz,
  'projection-test',
  1,
  '33000000-0000-4000-8000-000000000301'::uuid,
  '33000000-0000-4000-8000-000000000101'::uuid,
  'shift_open',
  '{"opening_float": 100}'::jsonb
)::public.shift_events);

select public.ingest_sale_event(row(
  '33000000-0000-4000-8000-000000000202'::uuid,
  '33000000-0000-4000-8000-000000000011'::uuid,
  '33000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 08:05:00+00'::timestamptz,
  '2026-01-01 08:05:01+00'::timestamptz,
  'projection-test',
  1,
  '33000000-0000-4000-8000-000000000302'::uuid,
  '33000000-0000-4000-8000-000000000101'::uuid,
  '33000000-0000-4000-8000-000000000301'::uuid,
  'completed',
  '[{"sku_id":"33000000-0000-4000-8000-000000000021","qty":2,"batch_no":"B1","expiry_date":"2026-12-31"}]'::jsonb,
  '[{"type":"cash","amount":20}]'::jsonb,
  20,
  0,
  0,
  20,
  null,
  null
)::public.sale_events);

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '33000000-0000-4000-8000-000000000202'),
  1,
  'completed sale emits one companion stock event'
);

select is(
  (select delta_qty from public.stock_events where source_ref_id = '33000000-0000-4000-8000-000000000202'),
  -2.000,
  'completed sale companion stock event deducts sold quantity'
);

select is(
  (select qty_on_hand from public.current_stock_by_store_sku where store_id = '33000000-0000-4000-8000-000000000001' and sku_id = '33000000-0000-4000-8000-000000000021'),
  -2.000,
  'sale companion stock event updates stock projection'
);

select public.ingest_transfer_event(row(
  '33000000-0000-4000-8000-000000000203'::uuid,
  '33000000-0000-4000-8000-000000000012'::uuid,
  '33000000-0000-4000-8000-000000000002'::uuid,
  '2026-01-01 09:00:00+00'::timestamptz,
  '2026-01-01 09:00:01+00'::timestamptz,
  'projection-test',
  1,
  '33000000-0000-4000-8000-000000000303'::uuid,
  'transfer_received',
  '33000000-0000-4000-8000-000000000001'::uuid,
  '33000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"33000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '33000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select count(*)::int from public.pending_transfer_receipts where transfer_id = '33000000-0000-4000-8000-000000000303'),
  1,
  'transfer_received before dispatch is held as a pending receipt'
);

select is(
  (select state from public.transfers where transfer_id = '33000000-0000-4000-8000-000000000303'),
  'requested',
  'out-of-order transfer receipt leaves transfer in requested state'
);

select public.ingest_transfer_event(row(
  '33000000-0000-4000-8000-000000000204'::uuid,
  '33000000-0000-4000-8000-000000000011'::uuid,
  '33000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 09:05:00+00'::timestamptz,
  '2026-01-01 09:05:01+00'::timestamptz,
  'projection-test',
  1,
  '33000000-0000-4000-8000-000000000303'::uuid,
  'transfer_dispatched',
  '33000000-0000-4000-8000-000000000001'::uuid,
  '33000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"33000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '33000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select count(*)::int from public.pending_transfer_receipts where transfer_id = '33000000-0000-4000-8000-000000000303'),
  0,
  'dispatch drains the matching pending transfer receipt'
);

select is(
  (select state from public.transfers where transfer_id = '33000000-0000-4000-8000-000000000303'),
  'received',
  'dispatch after held receipt advances transfer to received'
);

select public.ingest_transfer_event(row(
  '33000000-0000-4000-8000-000000000205'::uuid,
  '33000000-0000-4000-8000-000000000011'::uuid,
  '33000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 09:10:00+00'::timestamptz,
  '2026-01-01 09:10:01+00'::timestamptz,
  'projection-test',
  1,
  '33000000-0000-4000-8000-000000000303'::uuid,
  'transfer_requested',
  '33000000-0000-4000-8000-000000000001'::uuid,
  '33000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"33000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '33000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '33000000-0000-4000-8000-000000000303'),
  'received',
  'late requested event does not regress a received transfer'
);

select * from finish();

rollback;
