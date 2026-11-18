begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

-- T125: pgTAP coverage for the DATA CONTRACT that
-- apps/admin/src/lib/reports/shared.ts's computeProvisionalMarker (EC-16)
-- depends on — NOT the marker computation itself.
--
-- computeProvisionalMarker() / isStaleForRange() are plain application-layer
-- TypeScript (they read loadSyncHealthOverview()'s rows and compare
-- `oldest_pending_event_at <= rangeToTs`). There is no SQL function or
-- column for "provisional_until_server_ts" to test here — per
-- 0020_report_infrastructure.sql's own header comment, that marker is
-- deliberately computed in application code directly from the existing
-- `sync_health_latest_by_till` view (0014), so no new view/function exists
-- for pgTAP to exercise. What CAN and SHOULD be verified in Postgres is
-- that `sync_health_latest_by_till` itself correctly reflects each till's
-- latest snapshot (in particular `oldest_pending_event_at`, the exact
-- column the TS staleness predicate reads) — if that view's "most recent
-- snapshot per till" semantics ever regressed, the TS-side provisional
-- marker would silently compute wrong staleness with no SQL test catching
-- it. See apps/admin/tests/unit/reports/provisional.spec.ts for the
-- companion Vitest coverage of the actual computeProvisionalMarker/
-- isStaleForRange TypeScript logic (pure functions, no DB needed there).

select plan(7);

insert into public.stores (store_id, code, name) values
  ('45000000-0000-4000-8000-000000000001', 'PROVIS-A', 'Provisional Marker Test Store');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('45000000-0000-4000-8000-000000000011', '45000000-0000-4000-8000-000000000001', 'Stale Till', 'provis-device-stale', 'hash'),
  ('45000000-0000-4000-8000-000000000012', '45000000-0000-4000-8000-000000000001', 'Current Till', 'provis-device-current', 'hash');

-- Stale till: its only snapshot has an old client_ts/server_ts and a
-- non-null oldest_pending_event_at (a backlog it hasn't synced past yet).
insert into public.sync_health_snapshots (
  snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, app_version, schema_version
) values (
  '45000000-0000-4000-8000-000000000101',
  '45000000-0000-4000-8000-000000000011',
  '45000000-0000-4000-8000-000000000001',
  '2026-01-01 08:00:00+00', '2026-01-01 08:00:05+00',
  3, '2026-01-01 07:55:00+00',
  '1.0.0', 1
);

-- Current till: a recent snapshot with no backlog at all (fully synced).
insert into public.sync_health_snapshots (
  snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, app_version, schema_version
) values (
  '45000000-0000-4000-8000-000000000102',
  '45000000-0000-4000-8000-000000000012',
  '45000000-0000-4000-8000-000000000001',
  now(), now(),
  0, null,
  '1.0.0', 1
);

select is(
  (select server_ts from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000011'),
  '2026-01-01 08:00:05+00'::timestamptz,
  'view surfaces the stale till''s snapshot server_ts'
);

select is(
  (select oldest_pending_event_at from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000011'),
  '2026-01-01 07:55:00+00'::timestamptz,
  'stale till''s oldest_pending_event_at is surfaced (non-null backlog marker)'
);

select is(
  (select oldest_pending_event_at from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000012'),
  null,
  'current till has a null oldest_pending_event_at (fully synced, no backlog)'
);

-- Mirrors apps/admin's isStaleForRange() predicate directly: a report range
-- ending at 2026-01-02 should treat the stale till as stale, and the
-- current till as not stale, using the exact same "not null and <=" shape.
select ok(
  (select oldest_pending_event_at <= '2026-01-02 00:00:00+00'::timestamptz
     from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000011'),
  'stale till''s oldest_pending_event_at falls at-or-before the report range end (isStaleForRange would flag it)'
);

select ok(
  (select oldest_pending_event_at is null
     from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000012'),
  'current till''s oldest_pending_event_at is null (isStaleForRange would NOT flag it)'
);

-- Latest-snapshot-wins: a newer snapshot for the previously-stale till that
-- clears its backlog must make the view report it as caught up — this is
-- the core "order by server_ts desc limit 1" lateral-join contract the TS
-- staleness check implicitly relies on (it only ever reads the latest row).
insert into public.sync_health_snapshots (
  snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, app_version, schema_version
) values (
  '45000000-0000-4000-8000-000000000103',
  '45000000-0000-4000-8000-000000000011',
  '45000000-0000-4000-8000-000000000001',
  '2026-01-01 09:00:00+00', '2026-01-01 09:00:05+00',
  0, null,
  '1.0.0', 1
);

select is(
  (select oldest_pending_event_at from public.sync_health_latest_by_till where till_id = '45000000-0000-4000-8000-000000000011'),
  null,
  'once a newer snapshot clears the backlog, the view reflects the LATEST snapshot, not the earlier stale one'
);

select is(
  (select count(*)::int from public.sync_health_latest_by_till where till_id in (
    '45000000-0000-4000-8000-000000000011', '45000000-0000-4000-8000-000000000012'
  )),
  2,
  'view returns exactly one row per till even though the stale till now has two snapshot rows'
);

select * from finish();

rollback;
