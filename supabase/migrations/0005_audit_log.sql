-- Immutable audit log and controlled append function.

create table public.audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(user_id),
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  server_ts timestamptz not null default now(),
  constraint audit_log_old_value_object check (old_value is null or jsonb_typeof(old_value) = 'object'),
  constraint audit_log_new_value_object check (new_value is null or jsonb_typeof(new_value) = 'object')
);

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.prevent_event_mutation();

create or replace function public.append_audit(
  p_actor_user_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_audit_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (
    audit_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    old_value,
    new_value
  ) values (
    p_audit_id,
    p_actor_user_id,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old_value,
    p_new_value
  )
  on conflict (audit_id) do nothing;

  return p_audit_id;
end;
$$;

grant execute on function public.append_audit(uuid, text, text, uuid, jsonb, jsonb, uuid) to authenticated;

create index audit_log_actor_server_ts_idx on public.audit_log (actor_user_id, server_ts desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, server_ts desc);
create index audit_log_action_server_ts_idx on public.audit_log (action, server_ts desc);
create index audit_log_new_value_store_idx
  on public.audit_log (((new_value ->> 'store_id')::uuid), server_ts desc)
  where new_value ? 'store_id';
create index audit_log_old_value_store_idx
  on public.audit_log (((old_value ->> 'store_id')::uuid), server_ts desc)
  where old_value ? 'store_id';