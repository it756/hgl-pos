-- User management RLS (T146): only hq_admin can INSERT into `users`;
-- store_manager may UPDATE `is_active` only for a cashier already in their
-- own store, and cannot touch any other column or any user outside their
-- own store.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.stores (store_id, code, name) values
  ('32000000-0000-4000-8000-000000000001', 'UMG-A', 'User Mgmt Store A'),
  ('32000000-0000-4000-8000-000000000002', 'UMG-B', 'User Mgmt Store B');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('32000000-0000-4000-8000-000000000101', 'cashier', '32000000-0000-4000-8000-000000000001', 'Cashier A', 'hash', now()),
  ('32000000-0000-4000-8000-000000000102', 'cashier', '32000000-0000-4000-8000-000000000002', 'Cashier B', 'hash', now());

create or replace function public.umg_test_insert_rejected(
  test_user_id uuid,
  test_store_id uuid
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at)
  values (test_user_id, 'cashier', test_store_id, 'Rejected Insert', 'hash', now());

  return false;
exception when others then
  return true;
end;
$$;

create or replace function public.umg_test_update_rejected(
  test_user_id uuid,
  new_is_active boolean
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  affected_rows int;
begin
  update public.users set is_active = new_is_active where user_id = test_user_id;
  -- RLS USING-clause mismatches don't raise — they just make the row
  -- invisible to the UPDATE, silently affecting 0 rows.
  get diagnostics affected_rows = row_count;
  return affected_rows = 0;
exception when others then
  return true;
end;
$$;

create or replace function public.umg_test_column_scope_rejected(
  test_user_id uuid
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.users set full_name = 'Renamed By Store Manager' where user_id = test_user_id;
  return false;
exception when others then
  return true;
end;
$$;

-- hq_admin: full CRUD, including INSERT and flipping is_active for a user
-- outside any particular store scope (hq_admin has no store_id).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000000901","role":"authenticated","app_metadata":{"role":"hq_admin"}}',
  true
);

select lives_ok(
  $$
    insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at)
    values ('32000000-0000-4000-8000-000000000104', 'cashier', '32000000-0000-4000-8000-000000000002', 'Cashier C', 'hash', now())
  $$,
  'hq_admin can INSERT a new cashier'
);

select lives_ok(
  $$update public.users set is_active = false where user_id = '32000000-0000-4000-8000-000000000102'$$,
  'hq_admin can flip is_active for a user in any store'
);

-- store_manager scoped to store A: can toggle its own cashier, cannot
-- touch store B's cashier or non-scoped columns.
select set_config(
  'request.jwt.claims',
  '{"sub":"32000000-0000-4000-8000-000000000902","role":"authenticated","app_metadata":{"role":"store_manager","store_id":"32000000-0000-4000-8000-000000000001"}}',
  true
);

select ok(
  public.umg_test_insert_rejected('32000000-0000-4000-8000-000000000105', '32000000-0000-4000-8000-000000000001'),
  'store_manager cannot INSERT a new user'
);

select lives_ok(
  $$update public.users set is_active = false where user_id = '32000000-0000-4000-8000-000000000101'$$,
  'store_manager can flip is_active for a cashier already in their own store'
);

select ok(
  public.umg_test_update_rejected('32000000-0000-4000-8000-000000000102', false),
  'store_manager cannot flip is_active for a cashier outside their own store'
);

select ok(
  public.umg_test_column_scope_rejected('32000000-0000-4000-8000-000000000101'),
  'store_manager cannot change columns other than store_id/is_active'
);

select * from finish();

rollback;
