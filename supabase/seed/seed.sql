-- Local development seed data for the HGL POS pilot store.
-- Passwords and PINs are development-only; rotate all credentials outside local dev.

set search_path = public, extensions;

insert into public.stores (store_id, code, name, region, timezone) values
  ('35000000-0000-4000-8000-000000000001', 'PILOT-001', 'Harvest Group Pilot Store', 'Lusaka', 'Africa/Lusaka'),
  ('35000000-0000-4000-8000-000000000002', 'PILOT-002', 'Harvest Group Kitwe Store', 'Copperbelt', 'Africa/Lusaka')
on conflict (store_id) do update
set code = excluded.code,
    name = excluded.name,
    region = excluded.region,
    timezone = excluded.timezone,
    updated_at = now();

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash, provisioned_at) values
  (
    '35000000-0000-4000-8000-000000000011',
    '35000000-0000-4000-8000-000000000001',
    'Till 1',
    'pilot-store-till-1',
    extensions.crypt('dev-only-seed-credential', extensions.gen_salt('bf')),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000012',
    '35000000-0000-4000-8000-000000000001',
    'Till 2',
    'pilot-store-till-2',
    extensions.crypt('dev-only-seed-credential', extensions.gen_salt('bf')),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000013',
    '35000000-0000-4000-8000-000000000002',
    'Till 1',
    'kitwe-store-till-1',
    extensions.crypt('dev-only-seed-credential', extensions.gen_salt('bf')),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000014',
    '35000000-0000-4000-8000-000000000002',
    'Till 2',
    'kitwe-store-till-2',
    extensions.crypt('dev-only-seed-credential', extensions.gen_salt('bf')),
    now()
  )
on conflict (till_id) do update
set store_id = excluded.store_id,
    label = excluded.label,
    device_identity = excluded.device_identity,
    device_credential_hash = excluded.device_credential_hash,
    provisioned_at = excluded.provisioned_at,
    retired_at = null;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_4at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_confirm_status,
  is_sso_user,
  is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000101',
    'authenticated',
    'authenticated',
    'hq.admin@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"HQ Admin"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000102',
    'authenticated',
    'authenticated',
    'store.manager@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Pilot Store Manager"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000103',
    'authenticated',
    'authenticated',
    'cashier.one@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"till_id":"35000000-0000-4000-8000-000000000011"}'::jsonb,
    '{"full_name":"Cashier One"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000104',
    'authenticated',
    'authenticated',
    'cashier.two@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"till_id":"35000000-0000-4000-8000-000000000012"}'::jsonb,
    '{"full_name":"Cashier Two"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000105',
    'authenticated',
    'authenticated',
    'kitwe.manager@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Kitwe Store Manager"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000106',
    'authenticated',
    'authenticated',
    'cashier.three@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"till_id":"35000000-0000-4000-8000-000000000013"}'::jsonb,
    '{"full_name":"Cashier Three"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '35000000-0000-4000-8000-000000000107',
    'authenticated',
    'authenticated',
    'cashier.four@hgl.local',
    extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"till_id":"35000000-0000-4000-8000-000000000014"}'::jsonb,
    '{"full_name":"Cashier Four"}'::jsonb,
    now(),
    now(),
    '',
    '',
    '',
    '',
    0,
    false,
    false
  )
on conflict (id) do update
set email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = now();

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) values
  (
    '35000000-0000-4000-8000-000000000501',
    '35000000-0000-4000-8000-000000000101',
    '35000000-0000-4000-8000-000000000101',
    '{"sub":"35000000-0000-4000-8000-000000000101","email":"hq.admin@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000502',
    '35000000-0000-4000-8000-000000000102',
    '35000000-0000-4000-8000-000000000102',
    '{"sub":"35000000-0000-4000-8000-000000000102","email":"store.manager@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000503',
    '35000000-0000-4000-8000-000000000103',
    '35000000-0000-4000-8000-000000000103',
    '{"sub":"35000000-0000-4000-8000-000000000103","email":"cashier.one@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000504',
    '35000000-0000-4000-8000-000000000104',
    '35000000-0000-4000-8000-000000000104',
    '{"sub":"35000000-0000-4000-8000-000000000104","email":"cashier.two@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000505',
    '35000000-0000-4000-8000-000000000105',
    '35000000-0000-4000-8000-000000000105',
    '{"sub":"35000000-0000-4000-8000-000000000105","email":"kitwe.manager@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000506',
    '35000000-0000-4000-8000-000000000106',
    '35000000-0000-4000-8000-000000000106',
    '{"sub":"35000000-0000-4000-8000-000000000106","email":"cashier.three@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000507',
    '35000000-0000-4000-8000-000000000107',
    '35000000-0000-4000-8000-000000000107',
    '{"sub":"35000000-0000-4000-8000-000000000107","email":"cashier.four@hgl.local"}'::jsonb,
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do update
set user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

-- PIN hashes below are Argon2id (m=19456,t=3,p=1,v=19) generated to match
-- apps/pos/src-tauri/src/pin.rs::verify_pin's hardcoded params exactly — a
-- mismatched t-cost silently fails PIN verification (see repo memory notes).
insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active) values
  ('35000000-0000-4000-8000-000000000101', 'hq_admin', null, 'HQ Admin', '$argon2id$v=19$m=19456,t=2,p=1$adminseedonly$not-used-for-pos-pin-login', now(), true),
  ('35000000-0000-4000-8000-000000000102', 'store_manager', '35000000-0000-4000-8000-000000000001', 'Pilot Store Manager', '$argon2id$v=19$m=19456,p=1,t=3$o2Nl8FGHR5ZoGy41pCk8Vw$wT0JYciv5+Afpj5hXFg59B2pUICOr6CIBp1BKMrf0rM', now(), true),
  ('35000000-0000-4000-8000-000000000103', 'cashier', '35000000-0000-4000-8000-000000000001', 'Cashier One', '$argon2id$v=19$m=19456,p=1,t=3$un7mhIjlloRcgbwXCOvMaQ$BWwBrRpJyW/xm99wM5yeMh+rjESjQjczWubIF0m8IVc', now(), true),
  ('35000000-0000-4000-8000-000000000104', 'cashier', '35000000-0000-4000-8000-000000000001', 'Cashier Two', '$argon2id$v=19$m=19456,p=1,t=3$tFq+4HWgk+mjfS6ehVrWsQ$5LbkaJT655vl3CFxbaPa/SKfv2ib4wLEG3MxYOPCZMc', now(), true),
  ('35000000-0000-4000-8000-000000000105', 'store_manager', '35000000-0000-4000-8000-000000000002', 'Kitwe Store Manager', '$argon2id$v=19$m=19456,p=1,t=3$o+KTdyjtEc8pdhzxnP1Yuw$kml7y/QLFjkY6lPTkVHHBGJ3kmfjZDdh6pTs8qo9AwE', now(), true),
  ('35000000-0000-4000-8000-000000000106', 'cashier', '35000000-0000-4000-8000-000000000002', 'Cashier Three', '$argon2id$v=19$m=19456,p=1,t=3$+ynsD+kn1SFl5fi5EdhKww$vT/Cc66I4k663shJRb7c6dvQqAZ+CT/ebkx61qXOfCc', now(), true),
  ('35000000-0000-4000-8000-000000000107', 'cashier', '35000000-0000-4000-8000-000000000002', 'Cashier Four', '$argon2id$v=19$m=19456,p=1,t=3$0LOvRcbfBmypSoRiavOS7A$enNUsDoZNouSQM7AZ8bXM+375DSIt3v5ZGwLOjeOLPI', now(), true)
on conflict (user_id) do update
set role = excluded.role,
    store_id = excluded.store_id,
    full_name = excluded.full_name,
    pin_hash = excluded.pin_hash,
    pin_updated_at = excluded.pin_updated_at,
    is_active = excluded.is_active,
    updated_at = now();

insert into public.sku_categories (category_id, code, name) values
  ('35000000-0000-4000-8000-000000000021', 'GROCERY', 'Grocery'),
  ('35000000-0000-4000-8000-000000000022', 'FRESH', 'Fresh Produce'),
  ('35000000-0000-4000-8000-000000000023', 'HOUSEHOLD', 'Household')
on conflict (category_id) do update
set code = excluded.code,
    name = excluded.name,
    updated_at = now();

with generated_skus as (
  select
    i,
    ('35000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid as sku_id,
    case
      when i <= 17 then '35000000-0000-4000-8000-000000000021'::uuid
      when i <= 34 then '35000000-0000-4000-8000-000000000022'::uuid
      else '35000000-0000-4000-8000-000000000023'::uuid
    end as category_id,
    case when i in (18, 19, 20, 21, 22) then 'weight' else 'quantity' end as unit_type
  from generate_series(1, 50) as sku(i)
)
insert into public.skus (sku_id, code, barcode, name, category_id, unit_type, track_batch, track_expiry, is_active)
select
  sku_id,
  'PILOT-SKU-' || lpad(i::text, 3, '0'),
  lpad((600000000000 + i)::text, 13, '0'),
  case
    when i <= 17 then 'Grocery Item ' || lpad(i::text, 2, '0')
    when i <= 34 then 'Fresh Produce Item ' || lpad((i - 17)::text, 2, '0')
    else 'Household Item ' || lpad((i - 34)::text, 2, '0')
  end,
  category_id,
  unit_type,
  i in (1, 7, 18, 25, 40),
  i in (18, 19, 20, 21, 22, 23, 24),
  true
from generated_skus
on conflict (sku_id) do update
set code = excluded.code,
    barcode = excluded.barcode,
    name = excluded.name,
    category_id = excluded.category_id,
    unit_type = excluded.unit_type,
    track_batch = excluded.track_batch,
    track_expiry = excluded.track_expiry,
    is_active = excluded.is_active,
    updated_at = now();

with generated_skus as (
  select
    i,
    ('35000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid as sku_id
  from generate_series(1, 50) as sku(i)
)
insert into public.sku_barcodes (barcode, sku_id, is_primary)
select
  lpad((600000000000 + i)::text, 13, '0'),
  sku_id,
  true
from generated_skus
on conflict (barcode) do update
set sku_id = excluded.sku_id,
    is_primary = excluded.is_primary;

with generated_skus as (
  select
    i,
    ('35000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid as sku_id
  from generate_series(1, 50) as sku(i)
)
insert into public.store_sku_availability (store_id, sku_id, reorder_point, is_stocked)
select
  '35000000-0000-4000-8000-000000000001',
  sku_id,
  case when i <= 17 then 12 when i <= 34 then 8 else 5 end,
  true
from generated_skus
on conflict (store_id, sku_id) do update
set reorder_point = excluded.reorder_point,
    is_stocked = excluded.is_stocked,
    updated_at = now();

-- PILOT-002 stocks the same 50-SKU catalog (needed for the transfer-workflow
-- and multi-store-report seed scenarios below).
with generated_skus as (
  select
    i,
    ('35000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid as sku_id
  from generate_series(1, 50) as sku(i)
)
insert into public.store_sku_availability (store_id, sku_id, reorder_point, is_stocked)
select
  '35000000-0000-4000-8000-000000000002',
  sku_id,
  case when i <= 17 then 12 when i <= 34 then 8 else 5 end,
  true
from generated_skus
on conflict (store_id, sku_id) do update
set reorder_point = excluded.reorder_point,
    is_stocked = excluded.is_stocked,
    updated_at = now();

with generated_skus as (
  select
    i,
    ('35000000-0000-4000-8000-' || lpad((1000 + i)::text, 12, '0'))::uuid as sku_id,
    ('35000000-0000-4000-8000-' || lpad((2000 + i)::text, 12, '0'))::uuid as price_version_id
  from generate_series(1, 50) as sku(i)
)
insert into public.price_versions (
  price_version_id,
  sku_id,
  store_id,
  unit_price,
  currency,
  effective_from,
  created_by_user_id
)
select
  price_version_id,
  sku_id,
  null,
  round((4.50 + (i * 1.15))::numeric, 4),
  'ZMW',
  '2026-01-01 00:00:00+00'::timestamptz,
  '35000000-0000-4000-8000-000000000101'
from generated_skus
on conflict (price_version_id) do update
set sku_id = excluded.sku_id,
    store_id = excluded.store_id,
    unit_price = excluded.unit_price,
    currency = excluded.currency,
    effective_from = excluded.effective_from,
    created_by_user_id = excluded.created_by_user_id;

-- ============================================================================
-- Event history (idempotent via `where not exists` guards, since event tables
-- are append-only and have no natural on-conflict target for full rows).
-- Inserting directly into event tables is intentional: sales/shifts/
-- current_stock_by_store_sku/transfers/price_versions/audit_log are all
-- trigger-maintained projections (0006/0007) — seeding the event tables is
-- enough to populate them correctly.
-- ============================================================================

-- Bulk initial on-hand stock count (count_correction) for every store/SKU
-- pair, so /inventory and /warehouse show a fully-populated catalog rather
-- than only the handful of SKUs touched by the demo sales below. Two SKUs at
-- PILOT-001 are deliberately under-counted to guarantee a low-stock alert
-- (SKU 012, qty 8 <= reorder_point 12) and an oversell after the sales below
-- consume more than is on hand (SKU 013, qty 3; two sales below sell 2+2=4).
insert into public.stock_events (
  event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
  sku_id, event_type, delta_qty, reason_code, notes
)
select
  gen_random_uuid(),
  case a.store_id
    when '35000000-0000-4000-8000-000000000001'::uuid then '35000000-0000-4000-8000-000000000011'::uuid
    else '35000000-0000-4000-8000-000000000013'::uuid
  end,
  a.store_id,
  now() - interval '7 days',
  now() - interval '7 days',
  'seed-script',
  1,
  a.sku_id,
  'count_correction',
  case
    when a.store_id = '35000000-0000-4000-8000-000000000001' and a.sku_id = '35000000-0000-4000-8000-000000001012' then 8
    when a.store_id = '35000000-0000-4000-8000-000000000001' and a.sku_id = '35000000-0000-4000-8000-000000001013' then 3
    else a.reorder_point * 3
  end,
  'initial_stock_count',
  'Seed: initial on-hand count'
from public.store_sku_availability a
where not exists (
  select 1 from public.stock_events se
  where se.store_id = a.store_id and se.sku_id = a.sku_id and se.reason_code = 'initial_stock_count'
);

-- Shift S1: PILOT-001 / Till 1 / Cashier One — closed 3 days ago, reconciled
-- exactly (over_short = 0).
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000611', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days', now() - interval '3 days', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000601', '35000000-0000-4000-8000-000000000103', 'shift_open',
  '{"opening_float": 500.00}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000611');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000701', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days' + interval '1 hour', now() - interval '3 days' + interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000701', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000601', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001001","qty":2,"unit_price":5.65,"line_total":11.30},{"sku_id":"35000000-0000-4000-8000-000000001002","qty":1,"unit_price":6.80,"line_total":6.80},{"sku_id":"35000000-0000-4000-8000-000000001013","qty":2,"unit_price":19.45,"line_total":38.90}]'::jsonb,
  '[{"type":"cash","amount":57.00}]'::jsonb,
  57.00, 0, 0, 57.00
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000701');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000702', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days' + interval '2 hours', now() - interval '3 days' + interval '2 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000702', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000601', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001003","qty":1,"unit_price":7.95,"line_total":7.95}]'::jsonb,
  '[{"type":"cash","amount":7.95}]'::jsonb,
  7.95, 0, 0, 7.95
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000702');

-- Sale 703 is completed then immediately voided in the same shift/session
-- (same_till_session_void) to exercise the void flow + stock reversal.
insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000703', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days' + interval '3 hours', now() - interval '3 days' + interval '3 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000703', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000601', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001004","qty":1,"unit_price":9.10,"line_total":9.10}]'::jsonb,
  '[{"type":"cash","amount":9.10}]'::jsonb,
  9.10, 0, 0, 9.10
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000703');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total, original_sale_id, refund_kind)
select '35000000-0000-4000-8000-000000000704', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days' + interval '3 hours 5 minutes', now() - interval '3 days' + interval '3 hours 5 minutes', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000704', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000601', 'voided',
  '[{"sku_id":"35000000-0000-4000-8000-000000001004","qty":1,"unit_price":9.10,"line_total":9.10}]'::jsonb,
  '[{"type":"cash","amount":9.10}]'::jsonb,
  9.10, 0, 0, 9.10, '35000000-0000-4000-8000-000000000703', 'same_till_session_void'
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000704');

insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000612', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '3 days' + interval '8 hours', now() - interval '3 days' + interval '8 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000601', '35000000-0000-4000-8000-000000000103', 'shift_close',
  '{"cash_counted": 565.95}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000612');

-- Shift S2: PILOT-001 / Till 2 / Cashier Two — closed 2 days ago, deliberately
-- short by 0.45 (over_short <> 0) to exercise till-reconciliation reporting.
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000621', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days', now() - interval '2 days', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000602', '35000000-0000-4000-8000-000000000104', 'shift_open',
  '{"opening_float": 300.00}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000621');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000705', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days' + interval '1 hour', now() - interval '2 days' + interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000705', '35000000-0000-4000-8000-000000000104', '35000000-0000-4000-8000-000000000602', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001005","qty":2,"unit_price":10.25,"line_total":20.50},{"sku_id":"35000000-0000-4000-8000-000000001013","qty":2,"unit_price":19.45,"line_total":38.90}]'::jsonb,
  '[{"type":"cash","amount":59.40}]'::jsonb,
  59.40, 0, 0, 59.40
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000705');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000706', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days' + interval '2 hours', now() - interval '2 days' + interval '2 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000706', '35000000-0000-4000-8000-000000000104', '35000000-0000-4000-8000-000000000602', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001006","qty":1,"unit_price":11.40,"line_total":11.40},{"sku_id":"35000000-0000-4000-8000-000000001007","qty":1,"unit_price":12.55,"line_total":12.55}]'::jsonb,
  '[{"type":"cash","amount":23.95}]'::jsonb,
  23.95, 0, 0, 23.95
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000706');

insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000622', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days' + interval '8 hours', now() - interval '2 days' + interval '8 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000602', '35000000-0000-4000-8000-000000000104', 'shift_close',
  '{"cash_counted": 382.90}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000622');

-- Shift S3: PILOT-001 / Till 1 / Cashier One — closed yesterday. Sale 707 is
-- left completed and untouched: the refund-eligible target for US5 manual
-- testing (verify-refund Edge Function / admin refund UI). Sale 708 gets
-- refunded via a DIFFERENT till's shift below (cross-till refund).
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000631', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 day', now() - interval '1 day', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000603', '35000000-0000-4000-8000-000000000103', 'shift_open',
  '{"opening_float": 400.00}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000631');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000707', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 day' + interval '1 hour', now() - interval '1 day' + interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000707', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000603', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001008","qty":3,"unit_price":13.70,"line_total":41.10}]'::jsonb,
  '[{"type":"cash","amount":41.10}]'::jsonb,
  41.10, 0, 0, 41.10
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000707');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000708', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 day' + interval '2 hours', now() - interval '1 day' + interval '2 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000708', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000603', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001009","qty":1,"unit_price":14.85,"line_total":14.85}]'::jsonb,
  '[{"type":"cash","amount":14.85}]'::jsonb,
  14.85, 0, 0, 14.85
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000708');

insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000632', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 day' + interval '8 hours', now() - interval '1 day' + interval '8 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000603', '35000000-0000-4000-8000-000000000103', 'shift_close',
  '{"cash_counted": 455.95}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000632');

-- Shift S4: PILOT-001 / Till 2 / Cashier Two — left OPEN (currently active),
-- hosts the cross-till refund of sale 708 above (refund_kind = 'cross_till').
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000641', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 hours', now() - interval '2 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000604', '35000000-0000-4000-8000-000000000104', 'shift_open',
  '{"opening_float": 250.00}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000641');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total, original_sale_id, refund_kind)
select '35000000-0000-4000-8000-000000000709', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 hour', now() - interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000709', '35000000-0000-4000-8000-000000000104', '35000000-0000-4000-8000-000000000604', 'refunded',
  '[{"sku_id":"35000000-0000-4000-8000-000000001009","qty":1,"unit_price":14.85,"line_total":14.85}]'::jsonb,
  '[{"type":"cash","amount":14.85}]'::jsonb,
  14.85, 0, 0, 14.85, '35000000-0000-4000-8000-000000000708', 'cross_till'
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000709');

-- Shift S5: PILOT-002 / Till 1 / Cashier Three — left OPEN, gives the 2nd
-- store some activity of its own.
insert into public.shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
select '35000000-0000-4000-8000-000000000651', '35000000-0000-4000-8000-000000000013', '35000000-0000-4000-8000-000000000002',
  now() - interval '3 hours', now() - interval '3 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000605', '35000000-0000-4000-8000-000000000106', 'shift_open',
  '{"opening_float": 200.00}'::jsonb
where not exists (select 1 from public.shift_events where event_id = '35000000-0000-4000-8000-000000000651');

insert into public.sale_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sale_id, cashier_id, shift_id, status, items, tenders, subtotal, discount_total, tax_total, grand_total)
select '35000000-0000-4000-8000-000000000710', '35000000-0000-4000-8000-000000000013', '35000000-0000-4000-8000-000000000002',
  now() - interval '2 hours', now() - interval '2 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000710', '35000000-0000-4000-8000-000000000106', '35000000-0000-4000-8000-000000000605', 'completed',
  '[{"sku_id":"35000000-0000-4000-8000-000000001030","qty":1,"unit_price":39.00,"line_total":39.00}]'::jsonb,
  '[{"type":"cash","amount":39.00}]'::jsonb,
  39.00, 0, 0, 39.00
where not exists (select 1 from public.sale_events where event_id = '35000000-0000-4000-8000-000000000710');

-- Adjustment A1: cashier-requested, manager-approved (populates a stock_events
-- 'adjustment' row via the 0006 trigger).
insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id, notes)
select '35000000-0000-4000-8000-000000000811', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '1 day', now() - interval '1 day', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000801', 'adjustment_requested',
  '35000000-0000-4000-8000-000000001010', -3, 'damaged', '35000000-0000-4000-8000-000000000103', null, 'Seed: damaged stock found on shelf'
where not exists (select 1 from public.adjustment_events where event_id = '35000000-0000-4000-8000-000000000811');

insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id, notes)
select '35000000-0000-4000-8000-000000000812', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001',
  now() - interval '23 hours', now() - interval '23 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000801', 'adjustment_approved',
  '35000000-0000-4000-8000-000000001010', -3, 'damaged', '35000000-0000-4000-8000-000000000103', '35000000-0000-4000-8000-000000000102', 'Seed: approved by store manager'
where not exists (select 1 from public.adjustment_events where event_id = '35000000-0000-4000-8000-000000000812');

-- Adjustment A2: still pending approval (for testing the /adjustments queue).
insert into public.adjustment_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, adjustment_id, event_kind, sku_id, delta_qty, reason_code, requested_by_user_id, approver_user_id, notes)
select '35000000-0000-4000-8000-000000000821', '35000000-0000-4000-8000-000000000013', '35000000-0000-4000-8000-000000000002',
  now() - interval '1 hour', now() - interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000802', 'adjustment_requested',
  '35000000-0000-4000-8000-000000001045', -2, 'count_variance', '35000000-0000-4000-8000-000000000106', null, 'Seed: pending manager approval'
where not exists (select 1 from public.adjustment_events where event_id = '35000000-0000-4000-8000-000000000821');

-- Transfer T1: PILOT-001 -> PILOT-002, dispatched 20 units of SKU 020,
-- received only 18 (short-pick) -> ends in 'received_with_variance'.
insert into public.transfer_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, transfer_id, event_kind, source_store_id, destination_store_id, line_items, variance_items, actor_user_id)
select '35000000-0000-4000-8000-000000000911', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days', now() - interval '2 days', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000901', 'transfer_requested', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002',
  '[{"sku_id":"35000000-0000-4000-8000-000000001020","qty":20}]'::jsonb, null, '35000000-0000-4000-8000-000000000102'
where not exists (select 1 from public.transfer_events where event_id = '35000000-0000-4000-8000-000000000911');

insert into public.transfer_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, transfer_id, event_kind, source_store_id, destination_store_id, line_items, variance_items, actor_user_id)
select '35000000-0000-4000-8000-000000000912', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days' + interval '1 hour', now() - interval '2 days' + interval '1 hour', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000901', 'transfer_dispatched', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002',
  '[{"sku_id":"35000000-0000-4000-8000-000000001020","qty":20}]'::jsonb, null, '35000000-0000-4000-8000-000000000102'
where not exists (select 1 from public.transfer_events where event_id = '35000000-0000-4000-8000-000000000912');

insert into public.transfer_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, transfer_id, event_kind, source_store_id, destination_store_id, line_items, variance_items, actor_user_id)
select '35000000-0000-4000-8000-000000000913', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000002',
  now() - interval '1 day', now() - interval '1 day', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000901', 'transfer_received', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002',
  '[{"sku_id":"35000000-0000-4000-8000-000000001020","qty":18}]'::jsonb, null, '35000000-0000-4000-8000-000000000105'
where not exists (select 1 from public.transfer_events where event_id = '35000000-0000-4000-8000-000000000913');

insert into public.transfer_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, transfer_id, event_kind, source_store_id, destination_store_id, line_items, variance_items, actor_user_id)
select '35000000-0000-4000-8000-000000000914', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000002',
  now() - interval '1 day' + interval '5 minutes', now() - interval '1 day' + interval '5 minutes', 'seed-script', 1,
  '35000000-0000-4000-8000-000000000901', 'transfer_variance', '35000000-0000-4000-8000-000000000001', '35000000-0000-4000-8000-000000000002',
  '[{"sku_id":"35000000-0000-4000-8000-000000001020","qty":18}]'::jsonb,
  '[{"sku_id":"35000000-0000-4000-8000-000000001020","qty":-2}]'::jsonb, '35000000-0000-4000-8000-000000000105'
where not exists (select 1 from public.transfer_events where event_id = '35000000-0000-4000-8000-000000000914');

-- Price changes: populate price_versions (new effective-dated row) + audit_log
-- automatically via the 0007 trigger, for /prices + /audit + /audit/prices.
insert into public.price_change_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason)
select '35000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-000000000000', null,
  now() - interval '6 hours', now() - interval '6 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000005011', '35000000-0000-4000-8000-000000001001', 5.65, 6.25, now() - interval '6 hours', '35000000-0000-4000-8000-000000000101', 'Seed: cost increase'
where not exists (select 1 from public.price_change_events where event_id = '35000000-0000-4000-8000-000000005001');

insert into public.price_change_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, price_version_id, sku_id, old_unit_price, new_unit_price, effective_from, changed_by_user_id, reason)
select '35000000-0000-4000-8000-000000005002', '00000000-0000-4000-8000-000000000000', '35000000-0000-4000-8000-000000000002',
  now() - interval '5 hours', now() - interval '5 hours', 'seed-script', 1,
  '35000000-0000-4000-8000-000000005012', '35000000-0000-4000-8000-000000001002', null, 7.50, now() - interval '5 hours', '35000000-0000-4000-8000-000000000101', 'Seed: regional pricing override'
where not exists (select 1 from public.price_change_events where event_id = '35000000-0000-4000-8000-000000005002');

-- Sync health: one healthy till, one stale (beyond both trading/overnight
-- thresholds), one with a queue backlog >= 100 — one seeded row per alert
-- reason, then materialize alerts immediately (pg_cron would otherwise take
-- up to a minute after `supabase db reset`).
insert into public.sync_health_snapshots (snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, last_successful_sync_at, consecutive_failures, app_version, schema_version)
select '35000000-0000-4000-8000-000000006001', '35000000-0000-4000-8000-000000000011', '35000000-0000-4000-8000-000000000001',
  now() - interval '5 minutes', now() - interval '5 minutes', 0, null, now() - interval '5 minutes', 0, 'seed-script', 1
where not exists (select 1 from public.sync_health_snapshots where snapshot_id = '35000000-0000-4000-8000-000000006001');

insert into public.sync_health_snapshots (snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, last_successful_sync_at, consecutive_failures, app_version, schema_version)
select '35000000-0000-4000-8000-000000006002', '35000000-0000-4000-8000-000000000012', '35000000-0000-4000-8000-000000000001',
  now() - interval '2 days', now() - interval '2 days', 0, null, now() - interval '2 days', 0, 'seed-script', 1
where not exists (select 1 from public.sync_health_snapshots where snapshot_id = '35000000-0000-4000-8000-000000006002');

insert into public.sync_health_snapshots (snapshot_id, till_id, store_id, client_ts, server_ts, queue_depth, oldest_pending_event_at, last_successful_sync_at, consecutive_failures, app_version, schema_version)
select '35000000-0000-4000-8000-000000006003', '35000000-0000-4000-8000-000000000013', '35000000-0000-4000-8000-000000000002',
  now() - interval '2 minutes', now() - interval '2 minutes', 150, now() - interval '30 minutes', now() - interval '1 day', 0, 'seed-script', 1
where not exists (select 1 from public.sync_health_snapshots where snapshot_id = '35000000-0000-4000-8000-000000006003');

select public.check_sync_health_and_alert();
