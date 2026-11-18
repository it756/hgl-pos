-- Bootstraps a till's very first PowerSync/Supabase JWT from its existing
-- opaque device credential (see mint-device-jwt Edge Function). Unlike
-- rotate_device_credential, this RPC must be callable WITHOUT an existing
-- device JWT (that's exactly what it produces) — authorization is the
-- credential check alone, granted to `anon`.

create or replace function public.verify_device_credential(
  p_till_id uuid,
  p_credential text
)
returns table (
  store_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored_hash text;
  till_store_id uuid;
begin
  select t.device_credential_hash, t.store_id
  into stored_hash, till_store_id
  from public.tills t
  where t.till_id = p_till_id
    and t.retired_at is null;

  if stored_hash is null or extensions.crypt(p_credential, stored_hash) <> stored_hash then
    raise exception 'device credential is invalid' using errcode = '42501';
  end if;

  perform public.append_audit(
    null,
    'till.device_session.mint',
    'till',
    p_till_id,
    null,
    null
  );

  store_id := till_store_id;
  return next;
end;
$$;

grant execute on function public.verify_device_credential(uuid, text) to anon, authenticated;
