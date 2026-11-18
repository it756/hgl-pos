begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

-- Fixtures distinct from projection_triggers.spec.sql (33000000...) and
-- transfer_race.spec.sql (42000000...).
insert into public.stores (store_id, code, name) values
  ('43000000-0000-4000-8000-000000000001', 'SM-A', 'State Machine Store A'),
  ('43000000-0000-4000-8000-000000000002', 'SM-B', 'State Machine Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('43000000-0000-4000-8000-000000000011', '43000000-0000-4000-8000-000000000001', 'Till A', 'sm-device-a', 'hash'),
  ('43000000-0000-4000-8000-000000000012', '43000000-0000-4000-8000-000000000002', 'Till B', 'sm-device-b', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('43000000-0000-4000-8000-000000000021', 'SM-SKU', 'State Machine SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('43000000-0000-4000-8000-000000000102', 'store_manager', '43000000-0000-4000-8000-000000000001', 'State Machine Manager', 'hash', now());

-- Transfer #1 (...0301): dispatched -> received -> a LATE DUPLICATE dispatched
-- event (new event_id, same transfer_id). This is T105's core assertion:
-- state must never regress from 'received' back to 'in_transit'.
select public.ingest_transfer_event(row(
  '43000000-0000-4000-8000-000000000201'::uuid,
  '43000000-0000-4000-8000-000000000011'::uuid,
  '43000000-0000-4000-8000-000000000001'::uuid,
  '2026-04-01 09:00:00+00'::timestamptz,
  '2026-04-01 09:00:00+00'::timestamptz,
  'state-machine-test',
  1,
  '43000000-0000-4000-8000-000000000301'::uuid,
  'transfer_dispatched',
  '43000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"43000000-0000-4000-8000-000000000021","qty":10}]'::jsonb,
  null,
  '43000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '43000000-0000-4000-8000-000000000301'),
  'in_transit',
  'transfer #1: dispatch advances a fresh transfer to in_transit'
);

select public.ingest_transfer_event(row(
  '43000000-0000-4000-8000-000000000202'::uuid,
  '43000000-0000-4000-8000-000000000012'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '2026-04-01 09:05:00+00'::timestamptz,
  '2026-04-01 09:05:00+00'::timestamptz,
  'state-machine-test',
  1,
  '43000000-0000-4000-8000-000000000301'::uuid,
  'transfer_received',
  '43000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"43000000-0000-4000-8000-000000000021","qty":10}]'::jsonb,
  null,
  '43000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '43000000-0000-4000-8000-000000000301'),
  'received',
  'transfer #1: receipt after dispatch advances to received'
);

-- Duplicate/replayed transfer_dispatched: a genuinely NEW event_id (not a
-- same-row idempotent retry) representing the same physical dispatch
-- redelivered after a lost upload ack. Exercises the CASE guard in 0006's
-- dispatched branch (`when state in ('received','received_with_variance')
-- then state else 'in_transit'`).
select public.ingest_transfer_event(row(
  '43000000-0000-4000-8000-000000000203'::uuid,
  '43000000-0000-4000-8000-000000000011'::uuid,
  '43000000-0000-4000-8000-000000000001'::uuid,
  '2026-04-01 09:00:00+00'::timestamptz,
  '2026-04-01 09:10:00+00'::timestamptz,
  'state-machine-test',
  1,
  '43000000-0000-4000-8000-000000000301'::uuid,
  'transfer_dispatched',
  '43000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"43000000-0000-4000-8000-000000000021","qty":10}]'::jsonb,
  null,
  '43000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '43000000-0000-4000-8000-000000000301'),
  'received',
  'EC-04 regression guard: a duplicate/replayed transfer_dispatched never moves a received transfer back to in_transit'
);

-- The `already_dispatched` guard in apply_transfer_event_to_projection()
-- (0006_projection_triggers.sql) must prevent this duplicate dispatch from
-- double-deducting source stock, not just from regressing `state`.
select is(
  (select count(*)::int
   from public.stock_events
   where event_type = 'transfer_out'
     and source_ref_id in (
       select event_id from public.transfer_events
       where transfer_id = '43000000-0000-4000-8000-000000000301'
         and event_kind = 'transfer_dispatched'
     )),
  1,
  'a duplicate/replayed transfer_dispatched does not double-emit a transfer_out stock event'
);

-- Transfer #2 (...0302): brief EC-04 baseline (covered in depth already by
-- projection_triggers.spec.sql's 33000000 fixtures) for file self-sufficiency.
select public.ingest_transfer_event(row(
  '43000000-0000-4000-8000-000000000211'::uuid,
  '43000000-0000-4000-8000-000000000012'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '2026-04-01 10:00:00+00'::timestamptz,
  '2026-04-01 10:00:00+00'::timestamptz,
  'state-machine-test',
  1,
  '43000000-0000-4000-8000-000000000302'::uuid,
  'transfer_received',
  '43000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"43000000-0000-4000-8000-000000000021","qty":6}]'::jsonb,
  null,
  '43000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '43000000-0000-4000-8000-000000000302'),
  'requested',
  'transfer #2 (EC-04 baseline): receipt before dispatch stays requested'
);

select public.ingest_transfer_event(row(
  '43000000-0000-4000-8000-000000000212'::uuid,
  '43000000-0000-4000-8000-000000000011'::uuid,
  '43000000-0000-4000-8000-000000000001'::uuid,
  '2026-04-01 10:05:00+00'::timestamptz,
  '2026-04-01 10:05:00+00'::timestamptz,
  'state-machine-test',
  1,
  '43000000-0000-4000-8000-000000000302'::uuid,
  'transfer_dispatched',
  '43000000-0000-4000-8000-000000000001'::uuid,
  '43000000-0000-4000-8000-000000000002'::uuid,
  '[{"sku_id":"43000000-0000-4000-8000-000000000021","qty":6}]'::jsonb,
  null,
  '43000000-0000-4000-8000-000000000102'::uuid
)::public.transfer_events);

select is(
  (select state from public.transfers where transfer_id = '43000000-0000-4000-8000-000000000302'),
  'received',
  'transfer #2: subsequent dispatch drains the held receipt and advances to received'
);

select * from finish();

rollback;
