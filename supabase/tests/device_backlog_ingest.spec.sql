-- Regression test for a real bug found while wiring event upload (Gap A):
-- ingest_sale_event/ingest_shift_event use `on conflict (event_id) do nothing`,
-- and Postgres requires the conflict-visibility check to pass the table's
-- SELECT RLS policy — which `sale_events_read`/`shift_events_read` did not
-- grant to the 'device' role (only hq_admin/store_manager/cashier), even
-- though 'device' IS allowed to INSERT (backlog upload after a cashier JWT
-- expires). This made every device-role ingest call fail with "new row
-- violates row-level security policy", entirely unnoticed because every
-- other ingest test in this suite runs as the postgres superuser (bypassing
-- RLS) rather than as `authenticated` with real device-role JWT claims.

-- Also regression-tests a second bug found the same way: PostgREST builds an
-- RPC's composite row-type parameter from JSON via something equivalent to
-- `jsonb_populate_record(null::table, json)` — a JSON body that omits
-- server_ts (as any real client naturally would, expecting the column's
-- DEFAULT now() to apply) leaves that field NULL, and `insert ... select
-- (row_data).*` bypasses column DEFAULTs entirely, causing a NOT NULL
-- violation. Every existing ingest test called these functions via a plain
-- SQL `row(...)` constructor supplying an explicit server_ts positionally,
-- which never exercises this path.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into public.stores (store_id, code, name) values
  ('39000000-0000-4000-8000-000000000001', 'DEV-ING', 'Device Ingest Store');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000001', 'Device Ingest Till', 'device-ingest-till', 'hash');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('39000000-0000-4000-8000-000000000101', 'cashier', '39000000-0000-4000-8000-000000000001', 'Device Ingest Cashier', 'hash', now());

insert into public.skus (sku_id, code, name, unit_type) values
  ('39000000-0000-4000-8000-000000000021', 'DEV-INGEST-SKU', 'Device Ingest SKU', 'quantity');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"39000000-0000-4000-8000-000000000011","role":"authenticated","app_metadata":{"role":"device","store_id":"39000000-0000-4000-8000-000000000001","till_id":"39000000-0000-4000-8000-000000000011"}}',
  true
);

select lives_ok(
  $$select public.ingest_shift_event(row(
    '39000000-0000-4000-8000-000000000201'::uuid,
    '39000000-0000-4000-8000-000000000011'::uuid,
    '39000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'device-ingest-test', 1,
    '39000000-0000-4000-8000-000000000301'::uuid,
    '39000000-0000-4000-8000-000000000101'::uuid,
    'shift_open', '{"opening_float": 0}'::jsonb
  )::public.shift_events)$$,
  'device-role JWT can ingest a shift_event (backlog upload after cashier JWT expiry)'
);

select lives_ok(
  $$select public.ingest_sale_event(row(
    '39000000-0000-4000-8000-000000000202'::uuid,
    '39000000-0000-4000-8000-000000000011'::uuid,
    '39000000-0000-4000-8000-000000000001'::uuid,
    now(), now(), 'device-ingest-test', 1,
    '39000000-0000-4000-8000-000000000302'::uuid,
    '39000000-0000-4000-8000-000000000101'::uuid,
    '39000000-0000-4000-8000-000000000301'::uuid,
    'completed', '[{"sku_id":"39000000-0000-4000-8000-000000000021","qty":1}]'::jsonb,
    '[{"type":"cash","amount":10}]'::jsonb,
    10, 0, 0, 10, null, null
  )::public.sale_events)$$,
  'device-role JWT can ingest a sale_event (backlog upload after cashier JWT expiry)'
);

-- Simulates PostgREST's actual JSON-to-composite decoding (jsonb_populate_record),
-- which is what a real till's HTTP call goes through -- omitting server_ts entirely.
select lives_ok(
  $$select public.ingest_shift_event(jsonb_populate_record(null::public.shift_events, '{
    "event_id": "39000000-0000-4000-8000-000000000203",
    "till_id": "39000000-0000-4000-8000-000000000011",
    "store_id": "39000000-0000-4000-8000-000000000001",
    "client_ts": "2026-01-01T00:00:00Z",
    "app_version": "device-ingest-test",
    "schema_ver": 1,
    "shift_id": "39000000-0000-4000-8000-000000000303",
    "cashier_id": "39000000-0000-4000-8000-000000000101",
    "event_kind": "shift_close",
    "payload": {"cash_counted": 0, "tender_breakdown": {}, "notes": null}
  }'::jsonb))$$,
  'omitting server_ts (as a real HTTP client would) does not violate NOT NULL -- the ingest function assigns it server-side'
);

select isnt(
  (select server_ts from public.shift_events where event_id = '39000000-0000-4000-8000-000000000203'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'server_ts is server-assigned (now()), never left null or trusted from a client-supplied value'
);

select * from finish();

rollback;
