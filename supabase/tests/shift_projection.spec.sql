begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

-- T062: shift_close arriving before shift_open must still project correctly
-- once both events land, regardless of arrival order (offline tills can
-- upload their backlog out of order — see apply_shift_event_to_projection()
-- in supabase/migrations/0006_projection_triggers.sql).

insert into public.stores (store_id, code, name) values
  ('34000000-0000-4000-8000-000000000001', 'SHIFTPROJ-A', 'Shift Projection Store A');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('34000000-0000-4000-8000-000000000011', '34000000-0000-4000-8000-000000000001', 'Till A', 'shiftproj-device-a', 'hash');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('34000000-0000-4000-8000-000000000101', 'cashier', '34000000-0000-4000-8000-000000000001', 'Shift Projection Cashier', 'hash', now());

-- shift_close lands first (out of order). Inserted directly (not via
-- ingest_shift_event) because this test exercises the projection TRIGGER's
-- out-of-order server_ts handling and needs to control server_ts precisely —
-- the ingest function correctly always assigns server_ts := now() itself
-- (see device_backlog_ingest.spec.sql), so it can't be used to simulate this.
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload) values (
  '34000000-0000-4000-8000-000000000201'::uuid,
  '34000000-0000-4000-8000-000000000011'::uuid,
  '34000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 08:30:00+00'::timestamptz,
  '2026-01-01 08:30:01+00'::timestamptz,
  'shift-projection-test',
  1,
  '34000000-0000-4000-8000-000000000301'::uuid,
  '34000000-0000-4000-8000-000000000101'::uuid,
  'shift_close',
  '{"cash_counted": 620.00, "tender_breakdown": {"cash": 620.00}, "notes": null}'::jsonb
);

select is(
  (select status from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  'closed',
  'out-of-order shift_close alone still projects a closed shift row'
);

select is(
  (select opening_float from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  0.00,
  'shift row inserted by an out-of-order close uses a 0 opening_float placeholder'
);

select is(
  (select cash_counted from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  620.00,
  'out-of-order shift_close still records cash_counted'
);

-- shift_open lands second, with an earlier server_ts than the close.
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload) values (
  '34000000-0000-4000-8000-000000000202'::uuid,
  '34000000-0000-4000-8000-000000000011'::uuid,
  '34000000-0000-4000-8000-000000000001'::uuid,
  '2026-01-01 08:00:00+00'::timestamptz,
  '2026-01-01 08:00:01+00'::timestamptz,
  'shift-projection-test',
  1,
  '34000000-0000-4000-8000-000000000301'::uuid,
  '34000000-0000-4000-8000-000000000101'::uuid,
  'shift_open',
  '{"opening_float": 100.00}'::jsonb
);

select is(
  (select opening_float from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  100.00,
  'late-arriving shift_open backfills the real opening_float once it lands'
);

select is(
  (select opened_at from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  '2026-01-01 08:00:01+00'::timestamptz,
  'late-arriving shift_open corrects opened_at to its own (earlier) server_ts'
);

select is(
  (select status from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  'closed',
  'shift stays closed once the open event lands — the earlier close is not reopened'
);

select is(
  (select cash_counted from public.shifts where shift_id = '34000000-0000-4000-8000-000000000301'),
  620.00,
  'cash_counted from the earlier-landed close is unaffected by the open event landing later'
);

select * from finish();

rollback;
