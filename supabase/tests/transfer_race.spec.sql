begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

-- Fixtures distinct from projection_triggers.spec.sql (33000000...).
insert into public.stores (store_id, code, name) values
  ('42000000-0000-4000-8000-000000000001', 'RACE-A', 'Race Store A'),
  ('42000000-0000-4000-8000-000000000002', 'RACE-B', 'Race Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('42000000-0000-4000-8000-000000000011', '42000000-0000-4000-8000-000000000001', 'Till A', 'race-device-a', 'hash'),
  ('42000000-0000-4000-8000-000000000012', '42000000-0000-4000-8000-000000000002', 'Till B', 'race-device-b', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('42000000-0000-4000-8000-000000000021', 'RACE-SKU', 'Race SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('42000000-0000-4000-8000-000000000102', 'store_manager', '42000000-0000-4000-8000-000000000001', 'Race Manager', 'hash', now());

-- Scenario 1 (transfer ...0303): dispatched is inserted PHYSICALLY FIRST but
-- carries a LATER clock reading than the received event inserted second.
-- The state machine must not rely on server_ts ordering, only on physical
-- arrival, and must still resolve to 'received' exactly once.
select public.ingest_transfer_event(row(
  '42000000-0000-4000-8000-000000000203'::uuid,
  '42000000-0000-4000-8000-000000000011'::uuid,
  '42000000-0000-4000-8000-000000000001'::uuid,
  '2026-03-01 09:00:00.900+00'::timestamptz,
  '2026-03-01 09:00:00.900+00'::timestamptz,
  'race-test',
  1,
  '42000000-0000-4000-8000-000000000303'::uuid,
  'transfer_dispatched',
  '42000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"42000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '42000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '42000000-0000-4000-8000-000000000303'),
  'in_transit',
  'scenario 1: dispatch alone advances a fresh transfer to in_transit'
);

select public.ingest_transfer_event(row(
  '42000000-0000-4000-8000-000000000204'::uuid,
  '42000000-0000-4000-8000-000000000012'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '2026-03-01 09:00:00.100+00'::timestamptz,
  '2026-03-01 09:00:00.100+00'::timestamptz,
  'race-test',
  1,
  '42000000-0000-4000-8000-000000000303'::uuid,
  'transfer_received',
  '42000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"42000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '42000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '42000000-0000-4000-8000-000000000303'),
  'received',
  'scenario 1: dispatch-then-receive advances to received even though the receive event''s own clock reading is earlier'
);

select is(
  (select count(*)::int from public.pending_transfer_receipts where transfer_id = '42000000-0000-4000-8000-000000000303'),
  0,
  'scenario 1: no pending receipt left once dispatched arrived first'
);

select is(
  (select count(*)::int from public.stock_events where source_ref_id = '42000000-0000-4000-8000-000000000204' and event_type = 'transfer_in'),
  1,
  'scenario 1: exactly one transfer_in stock event, not duplicated'
);

-- Replay of the SAME dispatched event_id (idempotent retry/at-least-once
-- delivery) must be a no-op and must never regress the now-'received' state.
select is(
  public.ingest_transfer_event(row(
    '42000000-0000-4000-8000-000000000203'::uuid,
    '42000000-0000-4000-8000-000000000011'::uuid,
    '42000000-0000-4000-8000-000000000001'::uuid,
    '2026-03-01 09:00:00.900+00'::timestamptz,
    '2026-03-01 09:00:00.900+00'::timestamptz,
    'race-test',
    1,
    '42000000-0000-4000-8000-000000000303'::uuid,
    'transfer_dispatched',
    '42000000-0000-4000-8000-000000000001'::uuid,
    '42000000-0000-4000-8000-000000000002'::uuid,
    '[{"sku_id":"42000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
    null,
    '42000000-0000-4000-8000-000000000102'::uuid
  )::public.transfer_events),
  false,
  'scenario 1: replaying the same dispatched event_id is a no-op (append-only ingest is idempotent)'
);

select is(
  (select state from public.transfers where transfer_id = '42000000-0000-4000-8000-000000000303'),
  'received',
  'scenario 1: replayed dispatch does not regress state away from received'
);

-- Scenario 2 (transfer ...0304): the EXACT INVERSE ordering — transfer_received
-- is inserted PHYSICALLY FIRST (with a LATER clock reading), transfer_dispatched
-- arrives second (with an EARLIER clock reading).
select public.ingest_transfer_event(row(
  '42000000-0000-4000-8000-000000000206'::uuid,
  '42000000-0000-4000-8000-000000000012'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '2026-03-01 10:00:00.900+00'::timestamptz,
  '2026-03-01 10:00:00.900+00'::timestamptz,
  'race-test',
  1,
  '42000000-0000-4000-8000-000000000304'::uuid,
  'transfer_received',
  '42000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"42000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '42000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '42000000-0000-4000-8000-000000000304'),
  'requested',
  'scenario 2: receipt physically arriving before dispatch is held, not silently applied'
);

select is(
  (select count(*)::int from public.pending_transfer_receipts where transfer_id = '42000000-0000-4000-8000-000000000304'),
  1,
  'scenario 2: out-of-order receipt is queued in pending_transfer_receipts'
);

select public.ingest_transfer_event(row(
  '42000000-0000-4000-8000-000000000207'::uuid,
  '42000000-0000-4000-8000-000000000011'::uuid,
  '42000000-0000-4000-8000-000000000001'::uuid,
  '2026-03-01 10:00:00.100+00'::timestamptz,
  '2026-03-01 10:00:00.100+00'::timestamptz,
  'race-test',
  1,
  '42000000-0000-4000-8000-000000000304'::uuid,
  'transfer_dispatched',
  '42000000-0000-4000-8000-000000000001'::uuid,
  '42000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"42000000-0000-4000-8000-000000000021","qty":5}]'::jsonb,
  null,
  '42000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '42000000-0000-4000-8000-000000000304'),
  'received',
  'scenario 2: dispatch draining the held receipt advances to received exactly once'
);

select is(
  (select count(*)::int from public.pending_transfer_receipts where transfer_id = '42000000-0000-4000-8000-000000000304'),
  0,
  'scenario 2: pending receipt drained after dispatch arrives'
);

select * from finish();

rollback;
