-- Local development seed data for the HGL POS pilot store.
-- Passwords and PINs are development-only; rotate all credentials outside local dev.

set search_path = public, extensions;

insert into public.stores (store_id, code, name, region, timezone) values
  ('35000000-0000-4000-8000-000000000001', 'PILOT-001', 'Harvest Group Pilot Store', 'Lusaka', 'Africa/Lusaka')
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
    '$argon2id$v=19$m=19456,t=2,p=1$pilotstoretillone$dev-only-device-credential-placeholder',
    now()
  ),
  (
    '35000000-0000-4000-8000-000000000012',
    '35000000-0000-4000-8000-000000000001',
    'Till 2',
    'pilot-store-till-2',
    '$argon2id$v=19$m=19456,t=2,p=1$pilotstoretilltwo$dev-only-device-credential-placeholder',
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
  created_at,
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
  )
on conflict (provider_id, provider) do update
set user_id = excluded.user_id,
    identity_data = excluded.identity_data,
    updated_at = now();

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active) values
  ('35000000-0000-4000-8000-000000000101', 'hq_admin', null, 'HQ Admin', '$argon2id$v=19$m=19456,t=2,p=1$adminseedonly$not-used-for-pos-pin-login', now(), true),
  ('35000000-0000-4000-8000-000000000102', 'store_manager', '35000000-0000-4000-8000-000000000001', 'Pilot Store Manager', '$argon2id$v=19$m=19456,t=2,p=1$managerseedonly$not-used-for-pos-pin-login', now(), true),
  ('35000000-0000-4000-8000-000000000103', 'cashier', '35000000-0000-4000-8000-000000000001', 'Cashier One', '$argon2id$v=19$m=19456,t=2,p=1$KLOnSjxsFltxIBSsdTb9DQ$VrrWhxodn3uJYuo3H6LUMJPzppz0uUFUFD2GtR9Ozds', now(), true),
  ('35000000-0000-4000-8000-000000000104', 'cashier', '35000000-0000-4000-8000-000000000001', 'Cashier Two', '$argon2id$v=19$m=19456,t=2,p=1$KMY/Ui5s1uvbz+CxIQiYjw$jlBxDsTGk5J1WsHXK4y5JwWLRoJ1wo6WmPV8ejHyUTI', now(), true)
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
