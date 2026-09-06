-- User management RLS scope (T146). Extends 0009_rls_policies.sql's
-- `users_write_hq` (hq_admin: full CRUD) with a narrow store_manager UPDATE
-- policy: a store manager may only toggle `is_active` (and no-op `store_id`)
-- for a cashier already in their own store — they can never INSERT/DELETE,
-- touch another store's cashier, or change any other column (role,
-- full_name, pin_hash, pin_updated_at, created_at). Column-scoping is
-- enforced by a trigger since RLS alone is row-level, not column-level.
-- (Cashiers always have a store_id — see `users_hq_admin_store_scope` — so
-- there is no "unassigned cashier" case to additionally support here.)

create policy users_update_store_manager on users for update
  using (
    public.claim_role() = 'store_manager'
    and role = 'cashier'
    and store_id = public.claim_store_id()
  )
  with check (
    public.claim_role() = 'store_manager'
    and role = 'cashier'
    and store_id = public.claim_store_id()
  );

create or replace function public.enforce_users_store_manager_update_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.claim_role() = 'store_manager' then
    if new.role is distinct from old.role
      or new.full_name is distinct from old.full_name
      or new.pin_hash is distinct from old.pin_hash
      or new.pin_updated_at is distinct from old.pin_updated_at
      or new.created_at is distinct from old.created_at
    then
      raise exception 'store manager may only update store_id and is_active' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger users_store_manager_update_scope
  before update on public.users
  for each row
  execute function public.enforce_users_store_manager_update_scope();

-- Callable via RPC from the `hash-cashier-pin` Edge Function (T146) so PIN
-- hashing authorization stays centralized in Postgres alongside the RLS
-- policies above, rather than duplicating a parallel role check in Deno.
create or replace function public.assert_caller_is_hq_admin()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if public.claim_role() <> 'hq_admin' then
    raise exception 'only hq_admin may hash cashier PINs' using errcode = '42501';
  end if;
end;
$$;

grant execute on function public.assert_caller_is_hq_admin() to authenticated;
