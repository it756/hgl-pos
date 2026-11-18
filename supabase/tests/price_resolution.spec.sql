-- T086: deterministic price resolution order for concurrent HQ writes.
-- Mirrors apps/pos/src/lib/pricing/resolve.ts's canonical query verbatim:
-- WHERE sku_id=? AND (store_id=? OR store_id IS NULL) AND effective_from<=?
-- ORDER BY (store_id IS NULL) ASC, effective_from DESC, created_at DESC LIMIT 1

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into public.stores (store_id, code, name) values
  ('39000000-0000-4000-8000-000000000001', 'PR-A', 'Price Res Store A'),
  ('39000000-0000-4000-8000-000000000002', 'PR-B', 'Price Res Store B');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000001', 'Till A', 'price-res-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('39000000-0000-4000-8000-000000000021', 'PR-SKU', 'Price Res SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('39000000-0000-4000-8000-000000000101', 'hq_admin', null, 'Price Res HQ Admin', 'hash', now());

-- PV1: global, effective 2026-01-01
insert into public.price_change_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason
) values (
  '39000000-0000-4000-8000-000000000201', '39000000-0000-4000-8000-000000000011', null,
  '2026-01-01 00:00:00+00', '2026-01-01 00:00:00+00', 'price-res-test', 1,
  '39000000-0000-4000-8000-000000000301', '39000000-0000-4000-8000-000000000021',
  null, 10.00, '2026-01-01 00:00:00+00', '39000000-0000-4000-8000-000000000101', 'initial global price'
);

-- PV2: global, effective 2026-01-03 (later HQ write)
insert into public.price_change_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason
) values (
  '39000000-0000-4000-8000-000000000202', '39000000-0000-4000-8000-000000000011', null,
  '2026-01-03 00:00:05+00', '2026-01-03 00:00:05+00', 'price-res-test', 1,
  '39000000-0000-4000-8000-000000000302', '39000000-0000-4000-8000-000000000021',
  10.00, 12.00, '2026-01-03 00:00:00+00', '39000000-0000-4000-8000-000000000101', 'global price bump'
);

-- PV3: store-A override, effective 2026-01-02 (earlier than PV2's effective_from)
insert into public.price_change_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason
) values (
  '39000000-0000-4000-8000-000000000203', '39000000-0000-4000-8000-000000000011', '39000000-0000-4000-8000-000000000001',
  '2026-01-02 00:00:05+00', '2026-01-02 00:00:05+00', 'price-res-test', 1,
  '39000000-0000-4000-8000-000000000303', '39000000-0000-4000-8000-000000000021',
  10.00, 9.00, '2026-01-02 00:00:00+00', '39000000-0000-4000-8000-000000000101', 'store A override'
);

-- PV4: global, SAME effective_from as PV2 but created (server_ts) later — concurrent HQ write tie-break.
insert into public.price_change_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason
) values (
  '39000000-0000-4000-8000-000000000204', '39000000-0000-4000-8000-000000000011', null,
  '2026-01-03 00:10:00+00', '2026-01-03 00:10:00+00', 'price-res-test', 1,
  '39000000-0000-4000-8000-000000000304', '39000000-0000-4000-8000-000000000021',
  12.00, 13.00, '2026-01-03 00:00:00+00', '39000000-0000-4000-8000-000000000101', 'concurrent global write'
);

-- Resolution helper mirrored inline for each assertion (resolve.ts's exact query).

-- 1) Store B (no override) at 2026-01-01T12:00, before any later prices: resolves PV1.
select is(
  (select price_version_id from public.price_versions
   where sku_id = '39000000-0000-4000-8000-000000000021'
     and (store_id = '39000000-0000-4000-8000-000000000002' or store_id is null)
     and effective_from <= '2026-01-01 12:00:00+00'
   order by (store_id is null) asc, effective_from desc, created_at desc limit 1),
  '39000000-0000-4000-8000-000000000301'::uuid,
  'store with no override resolves the only effective global price'
);

-- 2) Store B at 2026-01-04: concurrent global writes (PV2/PV4) tie-break by created_at DESC -> PV4.
select is(
  (select price_version_id from public.price_versions
   where sku_id = '39000000-0000-4000-8000-000000000021'
     and (store_id = '39000000-0000-4000-8000-000000000002' or store_id is null)
     and effective_from <= '2026-01-04 00:00:00+00'
   order by (store_id is null) asc, effective_from desc, created_at desc limit 1),
  '39000000-0000-4000-8000-000000000304'::uuid,
  'concurrent global writes with the same effective_from tie-break on created_at DESC'
);

-- 3) Store A at 2026-01-04: store override (PV3) wins over any global row, even though
--    PV3's effective_from is earlier than the global PV2/PV4.
select is(
  (select price_version_id from public.price_versions
   where sku_id = '39000000-0000-4000-8000-000000000021'
     and (store_id = '39000000-0000-4000-8000-000000000001' or store_id is null)
     and effective_from <= '2026-01-04 00:00:00+00'
   order by (store_id is null) asc, effective_from desc, created_at desc limit 1),
  '39000000-0000-4000-8000-000000000303'::uuid,
  'store override wins over global regardless of effective_from recency'
);

-- 4) Store A at 2026-01-01T12:00: store override not yet effective -> falls back to global PV1.
select is(
  (select price_version_id from public.price_versions
   where sku_id = '39000000-0000-4000-8000-000000000021'
     and (store_id = '39000000-0000-4000-8000-000000000001' or store_id is null)
     and effective_from <= '2026-01-01 12:00:00+00'
   order by (store_id is null) asc, effective_from desc, created_at desc limit 1),
  '39000000-0000-4000-8000-000000000301'::uuid,
  'not-yet-effective store override is excluded, falls back to effective global price'
);

-- Append-only: all four price_versions rows retained, no mutation of earlier rows.
select is(
  (select count(*)::int from public.price_versions where sku_id = '39000000-0000-4000-8000-000000000021'),
  4,
  'all four concurrent price_versions rows are retained (append-only)'
);

select is(
  (select unit_price from public.price_versions where price_version_id = '39000000-0000-4000-8000-000000000301'),
  10.00,
  'earliest price_versions row is never mutated by later writes'
);

select is(
  (select unit_price from public.price_versions where price_version_id = '39000000-0000-4000-8000-000000000302'),
  12.00,
  'PV2 unit_price unchanged by the later concurrent PV4 write'
);

-- audit_log carries one row per price_change_event.
select is(
  (select count(*)::int from public.audit_log where entity_type = 'price_version' and entity_id in (
    '39000000-0000-4000-8000-000000000301',
    '39000000-0000-4000-8000-000000000302',
    '39000000-0000-4000-8000-000000000303',
    '39000000-0000-4000-8000-000000000304'
  )),
  4,
  'each price change event produces exactly one audit_log row'
);

select is(
  (select action from public.audit_log where entity_id = '39000000-0000-4000-8000-000000000304'),
  'price_changed',
  'audit row action is price_changed'
);

select * from finish();
rollback;
