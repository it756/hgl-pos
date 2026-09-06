-- Price-change event projection into immutable price versions.

create or replace function public.apply_price_change_event_to_versions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.price_versions (
    price_version_id,
    sku_id,
    store_id,
    unit_price,
    effective_from,
    created_by_user_id,
    created_at
  )
  values (
    new.price_version_id,
    new.sku_id,
    new.store_id,
    new.new_unit_price,
    new.effective_from,
    new.changed_by_user_id,
    new.server_ts
  )
  on conflict (price_version_id) do nothing;

  perform public.append_audit(
    new.changed_by_user_id,
    'price_changed',
    'price_version',
    new.price_version_id,
    jsonb_build_object(
      'sku_id', new.sku_id,
      'store_id', new.store_id,
      'unit_price', new.old_unit_price
    ),
    jsonb_build_object(
      'sku_id', new.sku_id,
      'store_id', new.store_id,
      'unit_price', new.new_unit_price,
      'effective_from', new.effective_from,
      'reason', new.reason
    )
  );

  return new;
end;
$$;

create trigger price_change_events_versions_after_insert
  after insert on public.price_change_events
  for each row execute function public.apply_price_change_event_to_versions();