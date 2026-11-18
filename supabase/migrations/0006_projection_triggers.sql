-- Trigger-maintained projections and companion stock events.

create or replace function public.apply_stock_event_to_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.current_stock_by_store_sku (
    store_id,
    sku_id,
    qty_on_hand,
    last_event_server_ts
  )
  values (
    new.store_id,
    new.sku_id,
    new.delta_qty,
    new.server_ts
  )
  on conflict (store_id, sku_id) do update
  set qty_on_hand = public.current_stock_by_store_sku.qty_on_hand + excluded.qty_on_hand,
      last_event_server_ts = greatest(
        coalesce(public.current_stock_by_store_sku.last_event_server_ts, excluded.last_event_server_ts),
        excluded.last_event_server_ts
      );

  return new;
end;
$$;

create trigger stock_events_project_after_insert
  after insert on public.stock_events
  for each row execute function public.apply_stock_event_to_projection();

create or replace function public.cash_tender_total(tenders jsonb)
returns numeric
language sql
stable
as $$
  select coalesce(sum((tender->>'amount')::numeric), 0)
  from jsonb_array_elements(tenders) as tender
  where tender->>'type' = 'cash'
$$;

create or replace function public.insert_stock_events_from_sale()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stock_sign numeric(14, 3);
begin
  insert into public.sales (
    sale_id,
    event_id,
    till_id,
    store_id,
    cashier_id,
    shift_id,
    client_ts,
    server_ts,
    app_version,
    schema_ver,
    status,
    latest_status,
    subtotal,
    discount_total,
    tax_total,
    grand_total,
    original_sale_id,
    refund_kind
  )
  values (
    new.sale_id,
    new.event_id,
    new.till_id,
    new.store_id,
    new.cashier_id,
    new.shift_id,
    new.client_ts,
    new.server_ts,
    new.app_version,
    new.schema_ver,
    new.status,
    new.status,
    new.subtotal,
    new.discount_total,
    new.tax_total,
    new.grand_total,
    new.original_sale_id,
    new.refund_kind
  );

  if new.original_sale_id is not null then
    update public.sales
    set latest_status = new.status
    where sale_id = new.original_sale_id;
  end if;

  stock_sign := case
    when new.status = 'completed' then -1
    when new.status in ('voided', 'refunded') then 1
    else 0
  end;

  if stock_sign <> 0 then
    insert into public.stock_events (
      event_id,
      till_id,
      store_id,
      client_ts,
      server_ts,
      app_version,
      schema_ver,
      sku_id,
      event_type,
      delta_qty,
      source_ref_id,
      batch_no,
      expiry_date
    )
    select
      gen_random_uuid(),
      new.till_id,
      new.store_id,
      new.client_ts,
      new.server_ts,
      new.app_version,
      new.schema_ver,
      item.sku_id,
      case when stock_sign < 0 then 'sale' else 'refund' end,
      stock_sign * item.qty,
      new.event_id,
      item.batch_no,
      item.expiry_date
    from jsonb_to_recordset(new.items) as item(
      sku_id uuid,
      qty numeric,
      batch_no text,
      expiry_date date
    );
  end if;

  update public.shifts
  set system_cash = system_cash + case
    when new.status = 'completed' then public.cash_tender_total(new.tenders)
    when new.status in ('voided', 'refunded') then -public.cash_tender_total(new.tenders)
    else 0
  end
  where shift_id = new.shift_id;

  return new;
end;
$$;

create trigger sale_events_project_after_insert
  after insert on public.sale_events
  for each row execute function public.insert_stock_events_from_sale();

create or replace function public.apply_shift_event_to_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.event_kind = 'shift_open' then
    insert into public.shifts (
      shift_id,
      till_id,
      store_id,
      cashier_id,
      opened_at,
      opening_float,
      status
    )
    values (
      new.shift_id,
      new.till_id,
      new.store_id,
      new.cashier_id,
      new.server_ts,
      (new.payload->>'opening_float')::numeric,
      'open'
    )
    on conflict (shift_id) do update
    set till_id = excluded.till_id,
        store_id = excluded.store_id,
        cashier_id = excluded.cashier_id,
        opened_at = least(public.shifts.opened_at, excluded.opened_at),
        opening_float = excluded.opening_float;
  else
    update public.shifts
    set closed_at = new.server_ts,
        cash_counted = (new.payload->>'cash_counted')::numeric,
        status = 'closed'
    where shift_id = new.shift_id;

    if not found then
      insert into public.shifts (
        shift_id,
        till_id,
        store_id,
        cashier_id,
        opened_at,
        closed_at,
        opening_float,
        cash_counted,
        status
      )
      values (
        new.shift_id,
        new.till_id,
        new.store_id,
        new.cashier_id,
        new.server_ts,
        new.server_ts,
        0,
        (new.payload->>'cash_counted')::numeric,
        'closed'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger shift_events_project_after_insert
  after insert on public.shift_events
  for each row execute function public.apply_shift_event_to_projection();

create or replace function public.apply_transfer_transit_delta(
  p_source_store_id uuid,
  p_destination_store_id uuid,
  p_line_items jsonb,
  p_sign numeric,
  p_server_ts timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.current_stock_by_store_sku (
    store_id,
    sku_id,
    qty_in_transit_out,
    last_event_server_ts
  )
  select p_source_store_id, item.sku_id, p_sign * item.qty, p_server_ts
  from jsonb_to_recordset(p_line_items) as item(sku_id uuid, qty numeric)
  on conflict (store_id, sku_id) do update
  set qty_in_transit_out = public.current_stock_by_store_sku.qty_in_transit_out + excluded.qty_in_transit_out,
      last_event_server_ts = greatest(
        coalesce(public.current_stock_by_store_sku.last_event_server_ts, excluded.last_event_server_ts),
        excluded.last_event_server_ts
      );

  insert into public.current_stock_by_store_sku (
    store_id,
    sku_id,
    qty_in_transit_in,
    last_event_server_ts
  )
  select p_destination_store_id, item.sku_id, p_sign * item.qty, p_server_ts
  from jsonb_to_recordset(p_line_items) as item(sku_id uuid, qty numeric)
  on conflict (store_id, sku_id) do update
  set qty_in_transit_in = public.current_stock_by_store_sku.qty_in_transit_in + excluded.qty_in_transit_in,
      last_event_server_ts = greatest(
        coalesce(public.current_stock_by_store_sku.last_event_server_ts, excluded.last_event_server_ts),
        excluded.last_event_server_ts
      );
end;
$$;

create or replace function public.insert_transfer_stock_events(
  p_event public.transfer_events,
  p_event_type text,
  p_store_id uuid,
  p_line_items jsonb,
  p_sign numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.stock_events (
    event_id,
    till_id,
    store_id,
    client_ts,
    server_ts,
    app_version,
    schema_ver,
    sku_id,
    event_type,
    delta_qty,
    source_ref_id
  )
  select
    gen_random_uuid(),
    (p_event).till_id,
    p_store_id,
    (p_event).client_ts,
    (p_event).server_ts,
    (p_event).app_version,
    (p_event).schema_ver,
    item.sku_id,
    p_event_type,
    p_sign * item.qty,
    (p_event).event_id
  from jsonb_to_recordset(p_line_items) as item(sku_id uuid, qty numeric);
end;
$$;

create or replace function public.apply_transfer_receipt(
  p_event public.transfer_events,
  p_line_items jsonb,
  p_variance_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dispatched_items jsonb;
begin
  select dispatched_line_items
  into dispatched_items
  from public.transfers
  where transfer_id = (p_event).transfer_id;

  perform public.insert_transfer_stock_events(
    p_event,
    'transfer_in',
    (p_event).destination_store_id,
    p_line_items,
    1
  );

  perform public.apply_transfer_transit_delta(
    (p_event).source_store_id,
    (p_event).destination_store_id,
    dispatched_items,
    -1,
    (p_event).server_ts
  );

  update public.transfers
  set state = case when p_variance_items is null then 'received' else 'received_with_variance' end,
      received_line_items = p_line_items,
      variance_line_items = coalesce(p_variance_items, variance_line_items),
      received_at = coalesce(received_at, (p_event).server_ts),
      last_event_server_ts = greatest(coalesce(last_event_server_ts, (p_event).server_ts), (p_event).server_ts)
  where transfer_id = (p_event).transfer_id;
end;
$$;

create or replace function public.apply_transfer_event_to_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pending_receipt public.pending_transfer_receipts%rowtype;
  already_dispatched boolean;
begin
  if new.event_kind = 'transfer_requested' then
    insert into public.transfers (
      transfer_id,
      source_store_id,
      destination_store_id,
      state,
      requested_at,
      last_event_server_ts
    )
    values (
      new.transfer_id,
      new.source_store_id,
      new.destination_store_id,
      'requested',
      new.server_ts,
      new.server_ts
    )
    on conflict (transfer_id) do update
    set requested_at = coalesce(public.transfers.requested_at, excluded.requested_at),
        last_event_server_ts = greatest(coalesce(public.transfers.last_event_server_ts, excluded.last_event_server_ts), excluded.last_event_server_ts);
  elsif new.event_kind = 'transfer_dispatched' then
    -- A redelivered/duplicate dispatch (new event_id, same transfer_id) must not
    -- double-apply the stock-side effects below, even though the transfers.state
    -- UPSERT further down already guards itself via its own CASE expression.
    select exists (
      select 1 from public.transfers
      where transfer_id = new.transfer_id
        and dispatched_at is not null
    ) into already_dispatched;

    if not already_dispatched then
      perform public.insert_transfer_stock_events(new, 'transfer_out', new.source_store_id, new.line_items, -1);
    end if;

    insert into public.transfers (
      transfer_id,
      source_store_id,
      destination_store_id,
      state,
      dispatched_line_items,
      dispatched_at,
      last_event_server_ts
    )
    values (
      new.transfer_id,
      new.source_store_id,
      new.destination_store_id,
      'in_transit',
      new.line_items,
      new.server_ts,
      new.server_ts
    )
    on conflict (transfer_id) do update
    set state = case
          when public.transfers.state in ('received', 'received_with_variance') then public.transfers.state
          else 'in_transit'
        end,
        dispatched_line_items = excluded.dispatched_line_items,
        dispatched_at = coalesce(public.transfers.dispatched_at, excluded.dispatched_at),
        last_event_server_ts = greatest(coalesce(public.transfers.last_event_server_ts, excluded.last_event_server_ts), excluded.last_event_server_ts);

    if not already_dispatched then
      perform public.apply_transfer_transit_delta(
        new.source_store_id,
        new.destination_store_id,
        new.line_items,
        1,
        new.server_ts
      );
    end if;

    for pending_receipt in
      select * from public.pending_transfer_receipts
      where transfer_id = new.transfer_id
      order by received_at, held_at
    loop
      perform public.apply_transfer_receipt(
        new,
        pending_receipt.line_items,
        pending_receipt.variance_items
      );

      if pending_receipt.event_kind = 'transfer_variance' and pending_receipt.variance_items is not null then
        perform public.insert_transfer_stock_events(
          new,
          'transfer_variance',
          new.destination_store_id,
          pending_receipt.variance_items,
          1
        );
      end if;

      delete from public.pending_transfer_receipts
      where event_id = pending_receipt.event_id;
    end loop;
  elsif new.event_kind = 'transfer_received' then
    if exists (
      select 1 from public.transfers
      where transfer_id = new.transfer_id
        and dispatched_at is not null
    ) then
      perform public.apply_transfer_receipt(new, new.line_items, null);
    else
      insert into public.transfers (
        transfer_id,
        source_store_id,
        destination_store_id,
        state,
        last_event_server_ts
      )
      values (
        new.transfer_id,
        new.source_store_id,
        new.destination_store_id,
        'requested',
        new.server_ts
      )
      on conflict (transfer_id) do nothing;

      insert into public.pending_transfer_receipts (
        event_id,
        transfer_id,
        source_store_id,
        destination_store_id,
        event_kind,
        line_items,
        received_at
      )
      values (
        new.event_id,
        new.transfer_id,
        new.source_store_id,
        new.destination_store_id,
        new.event_kind,
        new.line_items,
        new.server_ts
      )
      on conflict (event_id) do nothing;
    end if;
  elsif new.event_kind = 'transfer_variance' then
    if exists (
      select 1 from public.transfers
      where transfer_id = new.transfer_id
        and dispatched_at is not null
    ) then
      perform public.insert_transfer_stock_events(new, 'transfer_variance', new.destination_store_id, new.variance_items, 1);

      update public.transfers
      set state = 'received_with_variance',
          variance_line_items = new.variance_items,
          last_event_server_ts = greatest(coalesce(last_event_server_ts, new.server_ts), new.server_ts)
      where transfer_id = new.transfer_id;
    else
      insert into public.pending_transfer_receipts (
        event_id,
        transfer_id,
        source_store_id,
        destination_store_id,
        event_kind,
        line_items,
        variance_items,
        received_at
      )
      values (
        new.event_id,
        new.transfer_id,
        new.source_store_id,
        new.destination_store_id,
        new.event_kind,
        new.line_items,
        new.variance_items,
        new.server_ts
      )
      on conflict (event_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;

create trigger transfer_events_project_after_insert
  after insert on public.transfer_events
  for each row execute function public.apply_transfer_event_to_projection();

create or replace function public.apply_adjustment_event_to_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.event_kind = 'adjustment_approved' then
    insert into public.stock_events (
      event_id,
      till_id,
      store_id,
      client_ts,
      server_ts,
      app_version,
      schema_ver,
      sku_id,
      event_type,
      delta_qty,
      source_ref_id,
      reason_code,
      notes
    )
    values (
      gen_random_uuid(),
      new.till_id,
      new.store_id,
      new.client_ts,
      new.server_ts,
      new.app_version,
      new.schema_ver,
      new.sku_id,
      'adjustment',
      new.delta_qty,
      new.event_id,
      new.reason_code,
      new.notes
    );
  end if;

  return new;
end;
$$;

create trigger adjustment_events_project_after_insert
  after insert on public.adjustment_events
  for each row execute function public.apply_adjustment_event_to_projection();

create or replace function public.defer_price_change_projection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return new;
end;
$$;

create trigger price_change_events_project_after_insert
  after insert on public.price_change_events
  for each row execute function public.defer_price_change_projection();