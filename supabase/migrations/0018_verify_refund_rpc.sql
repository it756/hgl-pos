-- Cross-till refund verification RPC (T107, FR-012 / User Story 5).
--
-- The existing sale_events RLS (0009) scopes a plain cashier's SELECT to
-- `till_id = claim_till_id()` only (till_own_activity, per
-- contracts/powersync-sync-rules.yaml) — a cashier genuinely cannot read
-- another till's sale_events row directly, even within their own store.
-- Rather than widening that read policy (which would let a cashier browse
-- every sale ever made in their store, well beyond what this one lookup
-- needs), this narrow SECURITY DEFINER RPC performs the one specific,
-- store-scoped lookup the verify-refund Edge Function needs and returns
-- only the fields required to authorise + build the refund event.

create or replace function public.verify_refund_eligibility(
  p_original_sale_id uuid,
  p_refund_reason text
)
returns table (
  eligible boolean,
  reason text,
  refund_token uuid,
  sale_id uuid,
  till_id uuid,
  store_id uuid,
  cashier_id uuid,
  shift_id uuid,
  items jsonb,
  tenders jsonb,
  subtotal numeric,
  discount_total numeric,
  tax_total numeric,
  grand_total numeric,
  server_ts timestamptz,
  already_refunded boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_role text := public.claim_role();
  caller_store_id uuid := public.claim_store_id();
  caller_user_id uuid := public.claim_user_id();
  found_sale record;
  new_refund_token uuid := gen_random_uuid();
begin
  if caller_role not in ('cashier', 'store_manager', 'device', 'hq_admin') then
    raise exception 'caller is not allowed to verify refunds' using errcode = '42501';
  end if;

  if trim(coalesce(p_refund_reason, '')) = '' then
    raise exception 'refund_reason is required' using errcode = '22023';
  end if;

  -- Join sale_events (not just the sales header projection) for the full
  -- items/tenders JSONB — the till needs these to build a refund event
  -- that faithfully reverses the original sale's stock + cash effects
  -- (mirrors how void.ts reuses the original's items/tenders verbatim).
  select se.sale_id, se.till_id, se.store_id, se.cashier_id, se.shift_id,
    se.items, se.tenders, se.subtotal, se.discount_total, se.tax_total, se.grand_total,
    se.server_ts, s.latest_status
  into found_sale
  from public.sale_events se
  join public.sales s on s.sale_id = se.sale_id
  where se.sale_id = p_original_sale_id
    and se.status = 'completed'
  limit 1;

  -- Not found, or belongs to a different store than the caller's (cashier/
  -- store_manager/device are all store-scoped; hq_admin may look up any
  -- store). Returning the same "sale_not_found" reason for both cases
  -- avoids leaking whether a sale_id exists in another store.
  if not found or (caller_role <> 'hq_admin' and found_sale.store_id is distinct from caller_store_id) then
    eligible := false;
    reason := 'sale_not_found';
    return next;
    return;
  end if;

  if found_sale.latest_status <> 'completed' then
    eligible := false;
    reason := 'already_refunded';
    sale_id := found_sale.sale_id;
    till_id := found_sale.till_id;
    store_id := found_sale.store_id;
    server_ts := found_sale.server_ts;
    already_refunded := true;
    return next;
    return;
  end if;

  perform public.append_audit(
    caller_user_id,
    'refund.verify',
    'sale',
    found_sale.sale_id,
    null,
    jsonb_build_object('refund_token', new_refund_token, 'refund_reason', p_refund_reason)
  );

  eligible := true;
  reason := null;
  refund_token := new_refund_token;
  sale_id := found_sale.sale_id;
  till_id := found_sale.till_id;
  store_id := found_sale.store_id;
  cashier_id := found_sale.cashier_id;
  shift_id := found_sale.shift_id;
  items := found_sale.items;
  tenders := found_sale.tenders;
  subtotal := found_sale.subtotal;
  discount_total := found_sale.discount_total;
  tax_total := found_sale.tax_total;
  grand_total := found_sale.grand_total;
  server_ts := found_sale.server_ts;
  already_refunded := false;
  return next;
end;
$$;

grant execute on function public.verify_refund_eligibility(uuid, text) to authenticated;
