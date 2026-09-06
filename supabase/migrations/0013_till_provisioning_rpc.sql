-- RPCs used by Edge Functions for till provisioning and credential rotation.

create or replace function public.provision_till(
  p_store_id uuid,
  p_label text,
  p_device_identity text,
  p_operator_user_id uuid
)
returns table (
  till_id uuid,
  credential text,
  expires_at timestamptz,
  initial_sync_ready boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_role text := public.claim_role();
  caller_store_id uuid := public.claim_store_id();
  new_till_id uuid := gen_random_uuid();
  new_credential text := encode(gen_random_bytes(32), 'base64');
  new_expires_at timestamptz := now() + interval '90 days';
begin
  if caller_role = 'store_manager' and caller_store_id is distinct from p_store_id then
    raise exception 'store manager cannot provision till for another store' using errcode = '42501';
  end if;

  if caller_role not in ('hq_admin', 'store_manager') then
    raise exception 'caller is not allowed to provision tills' using errcode = '42501';
  end if;

  insert into public.tills (
    till_id,
    store_id,
    label,
    device_identity,
    device_credential_hash,
    provisioned_at
  ) values (
    new_till_id,
    p_store_id,
    p_label,
    p_device_identity,
    crypt(new_credential, gen_salt('bf')),
    now()
  );

  perform public.append_audit(
    p_operator_user_id,
    'till.provision',
    'till',
    new_till_id,
    null,
    jsonb_build_object(
      'store_id', p_store_id,
      'label', p_label,
      'device_identity', p_device_identity,
      'credential_expires_at', new_expires_at
    )
  );

  till_id := new_till_id;
  credential := new_credential;
  expires_at := new_expires_at;
  initial_sync_ready := true;
  return next;
end;
$$;

grant execute on function public.provision_till(uuid, text, text, uuid) to authenticated;

create or replace function public.rotate_device_credential(
  p_till_id uuid,
  p_current_credential text
)
returns table (
  credential text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_role text := public.claim_role();
  caller_till_id uuid := public.claim_till_id();
  stored_hash text;
  new_credential text := encode(gen_random_bytes(32), 'base64');
  new_expires_at timestamptz := now() + interval '90 days';
begin
  if caller_role <> 'device' or caller_till_id is distinct from p_till_id then
    raise exception 'device credential rotation is only allowed for the caller till' using errcode = '42501';
  end if;

  select t.device_credential_hash
  into stored_hash
  from public.tills t
  where t.till_id = p_till_id
    and t.retired_at is null;

  if stored_hash is null or crypt(p_current_credential, stored_hash) <> stored_hash then
    raise exception 'current device credential is invalid' using errcode = '42501';
  end if;

  update public.tills
  set device_credential_hash = crypt(new_credential, gen_salt('bf'))
  where public.tills.till_id = p_till_id;

  perform public.append_audit(
    null,
    'till.device_credential.rotate',
    'till',
    p_till_id,
    null,
    jsonb_build_object('credential_expires_at', new_expires_at)
  );

  credential := new_credential;
  expires_at := new_expires_at;
  return next;
end;
$$;

grant execute on function public.rotate_device_credential(uuid, text) to authenticated;
