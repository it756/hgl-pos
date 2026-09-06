begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.stores (store_id, code, name) values
  ('32000000-0000-4000-8000-000000000001', 'IDEMP-A', 'Idempotency Store A'),
  ('32000000-0000-4000-8000-000000000002', 'IDEMP-B', 'Idempotency Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('32000000-0000-4000-8000-000000000011', '32000000-0000-4000-8000-000000000001', 'Till A', 'idemp-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('32000000-0000-4000-8000-000000000021', 'IDEMP-SKU', 'Idempotency SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('32000000-0000-4000-8000-000000000101', 'cashier', '32000000-0000-4000-8000-000000000001', 'Cashier A', 'hash', now()),
  ('32000000-0000-4000-8000-000000000102', 'store_manager', '32000000-0000-4000-8000-000000000001', 'Manager A', 'hash', now()),
  ('32000000-0000-4000-8000-000000000103', 'hq_admin', null, 'HQ Admin', 'hash', now());

create or replace function public.event_idempotency_ok(
  first_sql text,
  second_sql text,
  event_table regclass,
  test_event_id uuid
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  first_inserted boolean;
  second_inserted boolean;
  row_count int;
begin
  execute first_sql into first_inserted;
  execute second_sql into second_inserted;
  execute format('select count(*) from %s where event_id = $1', event_table)
  using test_event_id
  into row_count;

  return first_inserted and not second_inserted and row_count = 1;
end;
$$;

select ok(public.event_idempotency_ok(
  $$select public.ingest_stock_event(row(
    '32000000-0000-4000-8000-000000000201'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000021'::uuid,
    'count_correction', 5, null, null, null, 'cycle_count', null
  )::public.stock_events)$$,
  $$select public.ingest_stock_event(row(
    '32000000-0000-4000-8000-000000000201'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000021'::uuid,
    'count_correction', 5, null, null, null, 'cycle_count', null
  )::public.stock_events)$$,
  'public.stock_events'::regclass,
  '32000000-0000-4000-8000-000000000201'::uuid),
  'stock_events ingest is idempotent by event_id'
);

select ok(public.event_idempotency_ok(
  $$select public.ingest_shift_event(row(
    '32000000-0000-4000-8000-000000000202'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000302'::uuid,
    '32000000-0000-4000-8000-000000000101'::uuid,
    'shift_open', '{"opening_float": 0}'::jsonb
  )::public.shift_events)$$,
  $$select public.ingest_shift_event(row(
    '32000000-0000-4000-8000-000000000202'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000302'::uuid,
    '32000000-0000-4000-8000-000000000101'::uuid,
    'shift_open', '{"opening_float": 0}'::jsonb
  )::public.shift_events)$$,
  'public.shift_events'::regclass,
  '32000000-0000-4000-8000-000000000202'::uuid),
  'shift_events ingest is idempotent by event_id'
);

select ok(public.event_idempotency_ok(
  $$select public.ingest_sale_event(row(
    '32000000-0000-4000-8000-000000000203'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000303'::uuid,
    '32000000-0000-4000-8000-000000000101'::uuid,
    '32000000-0000-4000-8000-000000000302'::uuid,
    'completed', '[{"sku_id":"32000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
    '[{"type":"cash","amount":10}]'::jsonb,
    10, 0, 0, 10, null, null
  )::public.sale_events)$$,
  $$select public.ingest_sale_event(row(
    '32000000-0000-4000-8000-000000000203'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000303'::uuid,
    '32000000-0000-4000-8000-000000000101'::uuid,
    '32000000-0000-4000-8000-000000000302'::uuid,
    'completed', '[{"sku_id":"32000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
    '[{"type":"cash","amount":10}]'::jsonb,
    10, 0, 0, 10, null, null
  )::public.sale_events)$$,
  'public.sale_events'::regclass,
  '32000000-0000-4000-8000-000000000203'::uuid),
  'sale_events ingest is idempotent by event_id'
);

select ok(public.event_idempotency_ok(
  $$select public.ingest_transfer_event(row(
    '32000000-0000-4000-8000-000000000204'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000304'::uuid,
    'transfer_requested',
    '32000000-0000-4000-8000-000000000001'::uuid,
    '32000000-0000-4000-8000-000000000002'::uuid,
    '[{"sku_id":"32000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
    null,
    '32000000-0000-4000-8000-000000000102'::uuid
  )::public.transfer_events)$$,
  $$select public.ingest_transfer_event(row(
    '32000000-0000-4000-8000-000000000204'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000304'::uuid,
    'transfer_requested',
    '32000000-0000-4000-8000-000000000001'::uuid,
    '32000000-0000-4000-8000-000000000002'::uuid,
    '[{"sku_id":"32000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
    null,
    '32000000-0000-4000-8000-000000000102'::uuid
  )::public.transfer_events)$$,
  'public.transfer_events'::regclass,
  '32000000-0000-4000-8000-000000000204'::uuid),
  'transfer_events ingest is idempotent by event_id'
);

select ok(public.event_idempotency_ok(
  $$select public.ingest_adjustment_event(row(
    '32000000-0000-4000-8000-000000000205'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000305'::uuid,
    'adjustment_requested',
    '32000000-0000-4000-8000-000000000021'::uuid,
    1, 'count_variance',
    '32000000-0000-4000-8000-000000000101'::uuid,
    null,
    null
  )::public.adjustment_events)$$,
  $$select public.ingest_adjustment_event(row(
    '32000000-0000-4000-8000-000000000205'::uuid,
    '32000000-0000-4000-8000-000000000011'::uuid,
    '32000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000305'::uuid,
    'adjustment_requested',
    '32000000-0000-4000-8000-000000000021'::uuid,
    1, 'count_variance',
    '32000000-0000-4000-8000-000000000101'::uuid,
    null,
    null
  )::public.adjustment_events)$$,
  'public.adjustment_events'::regclass,
  '32000000-0000-4000-8000-000000000205'::uuid),
  'adjustment_events ingest is idempotent by event_id'
);

select ok(public.event_idempotency_ok(
  $$select public.ingest_price_change_event(row(
    '32000000-0000-4000-8000-000000000206'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    null,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000306'::uuid,
    '32000000-0000-4000-8000-000000000021'::uuid,
    null,
    10,
    now(),
    '32000000-0000-4000-8000-000000000103'::uuid,
    'initial price'
  )::public.price_change_events)$$,
  $$select public.ingest_price_change_event(row(
    '32000000-0000-4000-8000-000000000206'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    null,
    now(), now(), 'idempotency-test', 1,
    '32000000-0000-4000-8000-000000000306'::uuid,
    '32000000-0000-4000-8000-000000000021'::uuid,
    null,
    10,
    now(),
    '32000000-0000-4000-8000-000000000103'::uuid,
    'initial price'
  )::public.price_change_events)$$,
  'public.price_change_events'::regclass,
  '32000000-0000-4000-8000-000000000206'::uuid),
  'price_change_events ingest is idempotent by event_id'
);

select * from finish();

rollback;