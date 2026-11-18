begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.stores (store_id, code, name) values
  ('38000000-0000-4000-8000-000000000001', 'SALE-T', 'Sale Ingest Store');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('38000000-0000-4000-8000-000000000011', '38000000-0000-4000-8000-000000000001', 'Sale Ingest Till', 'sale-ingest-device', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('38000000-0000-4000-8000-000000000021', 'SALE-INGEST-SKU', 'Sale Ingest SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('38000000-0000-4000-8000-000000000101', 'cashier', '38000000-0000-4000-8000-000000000001', 'Sale Ingest Cashier', 'hash', now());

-- First ingest of a brand-new sale event.
select is(
  public.ingest_sale_event(row(
    '38000000-0000-4000-8000-000000000201'::uuid,
    '38000000-0000-4000-8000-000000000011'::uuid,
    '38000000-0000-4000-8000-000000000001'::uuid,
    '2026-01-01 10:00:00+00'::timestamptz,
    '2026-01-01 10:00:01+00'::timestamptz,
    'sale-ingest-test',
    1,
    '38000000-0000-4000-8000-000000000202'::uuid,
    '38000000-0000-4000-8000-000000000101'::uuid,
    '38000000-0000-4000-8000-000000000301'::uuid,
    'completed',
    '[{"sku_id":"38000000-0000-4000-8000-000000000021","qty":3,"batch_no":"B1","expiry_date":"2026-12-31"}]'::jsonb,
    '[{"type":"cash","amount":30}]'::jsonb,
    30, 0, 0, 30,
    null, null
  )::public.sale_events),
  true,
  'first ingest of a new sale event returns true'
);

select is(
  (select count(*)::int from public.sale_events where event_id = '38000000-0000-4000-8000-000000000201'),
  1,
  'exactly one sale_events row exists for the new event_id'
);

-- Re-ingest with the SAME event_id/sale_id but a different (bogus) payload.
select is(
  public.ingest_sale_event(row(
    '38000000-0000-4000-8000-000000000201'::uuid,
    '38000000-0000-4000-8000-000000000011'::uuid,
    '38000000-0000-4000-8000-000000000001'::uuid,
    '2026-01-01 10:00:00+00'::timestamptz,
    '2026-01-01 10:00:01+00'::timestamptz,
    'sale-ingest-test',
    1,
    '38000000-0000-4000-8000-000000000202'::uuid,
    '38000000-0000-4000-8000-000000000101'::uuid,
    '38000000-0000-4000-8000-000000000301'::uuid,
    'completed',
    '[{"sku_id":"38000000-0000-4000-8000-000000000021","qty":99,"batch_no":"B1","expiry_date":"2026-12-31"}]'::jsonb,
    '[{"type":"cash","amount":999}]'::jsonb,
    999, 0, 0, 999,
    null, null
  )::public.sale_events),
  false,
  'duplicate event_id re-ingest is a no-op (returns false)'
);

select is(
  (select count(*)::int from public.sale_events where event_id = '38000000-0000-4000-8000-000000000201'),
  1,
  'row count for the event_id is still exactly 1 after the duplicate re-ingest'
);

select is(
  (select grand_total from public.sale_events where event_id = '38000000-0000-4000-8000-000000000201'),
  30.00,
  'original payload (grand_total) is unchanged, not overwritten by the duplicate re-ingest'
);

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '38000000-0000-4000-8000-000000000201'),
  1,
  'completed sale emits exactly one companion stock_events row'
);

select is(
  (select delta_qty from public.stock_events where source_ref_id = '38000000-0000-4000-8000-000000000201'),
  -3.000,
  'companion stock_events row has delta_qty equal to the negative of the sold quantity'
);

select * from finish();

rollback;
