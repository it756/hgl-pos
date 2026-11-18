-- Loosens the device-role isolation boundary (see powersync/tests/isolation.spec.ts
-- and supabase/functions/mint-device-jwt) so an unattended till can sync its
-- store's catalog, prices, and stock on its own device credential, without
-- waiting for a cashier to log in online first. Device still never gets
-- till_activity/store_operations/sync_health — those remain cashier/
-- store_manager-only. Mirrors the corresponding mint-device-jwt change.
create or replace function public.access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  metadata jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  event_user_id uuid := nullif(event ->> 'user_id', '')::uuid;
  requested_role text := nullif(metadata ->> 'role', '');
  requested_till_id_text text := nullif(metadata ->> 'till_id', '');
  requested_device_id_text text := nullif(metadata ->> 'device_id', '');
  requested_till_id uuid;
  requested_device_id uuid;
  user_role text;
  user_store_id uuid;
  domain_role text := 'anonymous';
  domain_store_id uuid;
  domain_till_id uuid;
  domain_device_id uuid;
begin
  if requested_till_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    requested_till_id := requested_till_id_text::uuid;
  end if;

  if requested_device_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    requested_device_id := requested_device_id_text::uuid;
  end if;

  select u.role, u.store_id
  into user_role, user_store_id
  from public.users u
  where u.user_id = event_user_id
    and u.is_active;

  if user_role is not null then
    domain_role := user_role;
    domain_store_id := user_store_id;

    if user_role = 'cashier'
      and requested_till_id is not null
      and exists (
        select 1
        from public.tills t
        where t.till_id = requested_till_id
          and t.store_id = user_store_id
          and t.retired_at is null
      ) then
      domain_till_id := requested_till_id;
    end if;
  elsif requested_role = 'device' and requested_till_id is not null then
    select t.store_id
    into domain_store_id
    from public.tills t
    where t.till_id = requested_till_id
      and t.retired_at is null;

    if domain_store_id is not null then
      domain_role := 'device';
      domain_till_id := requested_till_id;
      domain_device_id := coalesce(requested_device_id, event_user_id);
    end if;
  end if;

  metadata := jsonb_set(metadata, '{role}', to_jsonb(domain_role), true);
  metadata := jsonb_set(metadata, '{store_id}', coalesce(to_jsonb(domain_store_id), 'null'::jsonb), true);
  metadata := jsonb_set(metadata, '{till_id}', coalesce(to_jsonb(domain_till_id), 'null'::jsonb), true);
  metadata := jsonb_set(metadata, '{device_id}', coalesce(to_jsonb(domain_device_id), 'null'::jsonb), true);

  claims := jsonb_set(claims, '{app_metadata}', metadata, true);
  claims := jsonb_set(claims, '{pos_role}', to_jsonb(domain_role), true);
  claims := jsonb_set(claims, '{store_id}', coalesce(to_jsonb(domain_store_id), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{till_id}', coalesce(to_jsonb(domain_till_id), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{device_id}', coalesce(to_jsonb(domain_device_id), 'null'::jsonb), true);
  claims := jsonb_set(
    claims,
    '{store_catalog_store_id}',
    case when domain_role in ('cashier', 'store_manager', 'device') then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{store_prices_store_id}',
    case when domain_role in ('cashier', 'store_manager', 'device') then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{store_stock_store_id}',
    case when domain_role in ('cashier', 'store_manager', 'device') then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{store_users_store_id}',
    case when domain_role in ('cashier', 'store_manager', 'device') then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{till_activity_till_id}',
    case when domain_role = 'cashier' then to_jsonb(domain_till_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{store_operations_store_id}',
    case when domain_role = 'store_manager' then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{sync_health_store_id}',
    case when domain_role = 'store_manager' then to_jsonb(domain_store_id) else 'null'::jsonb end,
    true
  );
  claims := jsonb_set(
    claims,
    '{device_provisioning_till_id}',
    case when domain_role = 'device' then to_jsonb(domain_till_id) else 'null'::jsonb end,
    true
  );
  event := jsonb_set(event, '{claims}', claims, true);

  return event;
end;
$$;
