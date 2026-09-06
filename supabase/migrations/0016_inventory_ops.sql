-- Admin-side adjustment approvals (T093) and low-stock alerting (T095).

-- Bug fix: 0009's `adjustment_events_insert_request` required
-- `requested_by_user_id = claim_user_id()` for EVERY insert, including
-- approve/reject rows — but an approval preserves the ORIGINAL requester's
-- id (for lineage), so the approving manager's uid never matches and every
-- approve/reject insert was unconditionally rejected. Re-scope that check
-- to the `adjustment_requested` branch only; `approver_user_id =
-- claim_user_id()` already governs the approve/reject branch correctly.
drop policy adjustment_events_insert_request on public.adjustment_events;
create policy adjustment_events_insert_request on public.adjustment_events for insert
  with check (
    store_id = public.claim_store_id()
    and (
      (event_kind = 'adjustment_requested'
        and public.claim_role() in ('cashier', 'store_manager')
        and requested_by_user_id = public.claim_user_id())
      or (event_kind in ('adjustment_approved', 'adjustment_rejected')
          and public.claim_role() = 'store_manager'
          and approver_user_id = public.claim_user_id())
    )
  );

-- Adjustment approvals/rejections originate from the web admin console, not
-- a physical till — mirrors price_change_events' existing precedent
-- (0002_event_tables.sql, data-model.md §2.6): drop the FK so a well-known
-- sentinel till_id (HQ_CONSOLE_TILL_ID) can be used for those rows. The
-- companion stock_events row the trigger below inserts carries the same
-- sentinel till_id, so its FK must be dropped too.
alter table public.adjustment_events drop constraint adjustment_events_till_id_fkey;
alter table public.stock_events drop constraint stock_events_till_id_fkey;

-- Bug fix: unlike apply_price_change_event_to_versions (which already calls
-- append_audit), the adjustment projection trigger never logged an audit
-- row — SC-006 / T142 require every threshold-adjustment to produce one.
-- Logged here (DB layer) rather than from client code so it's enforced
-- regardless of which client writes the approve/reject event.
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

  if new.event_kind in ('adjustment_approved', 'adjustment_rejected') then
    perform public.append_audit(
      new.approver_user_id,
      'adjustment.' || new.event_kind,
      'sku',
      new.sku_id,
      null,
      jsonb_build_object(
        'adjustment_id', new.adjustment_id,
        'store_id', new.store_id,
        'delta_qty', new.delta_qty,
        'reason_code', new.reason_code
      )
    );
  end if;

  return new;
end;
$$;

-- Batch/expiry summary (T089 inventory dashboard, FR-022): net remaining
-- qty per (store, sku, batch, expiry), derived from the stock ledger.
-- security_invoker so the view is bound by the querying role's own RLS on
-- stock_events (0009_rls_policies.sql), not the view owner's.
create view public.batch_expiry_summary
with (security_invoker = true) as
select
  store_id,
  sku_id,
  batch_no,
  expiry_date,
  sum(delta_qty) as qty_remaining,
  max(server_ts) as last_event_server_ts
from public.stock_events
where batch_no is not null and expiry_date is not null
group by store_id, sku_id, batch_no, expiry_date;

-- Low-stock candidates (T089 dashboard + T095 alert function, FR-018):
-- current qty at/under the store's configured reorder point. Deliberately
-- NOT security definer — it must run as the calling role so it inherits
-- `current_stock_by_store_sku`'s RLS (a store_manager only ever sees their
-- own store; the Edge Function calls it as service_role, which bypasses
-- RLS entirely and sees every store, as intended for fleet-wide alerting).
create or replace function public.low_stock_alert_candidates()
returns table (
  store_id uuid,
  sku_id uuid,
  qty_on_hand numeric,
  reorder_point numeric
)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    c.store_id,
    c.sku_id,
    c.qty_on_hand,
    a.reorder_point
  from public.current_stock_by_store_sku c
  join public.store_sku_availability a
    on a.store_id = c.store_id and a.sku_id = c.sku_id
  where a.reorder_point is not null
    and a.is_stocked = true
    and c.qty_on_hand <= a.reorder_point
$$;

grant execute on function public.low_stock_alert_candidates() to authenticated, service_role;
