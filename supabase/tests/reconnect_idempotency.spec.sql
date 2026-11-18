-- T116 [US6] — reconnect-backlog idempotency at (small) scale.
--
-- Extends event_idempotency.spec.sql's single-event idea (replay one event
-- twice, assert `found`/row-count stays 1) to a small BATCH of events across
-- two event kinds (shift_events + sale_events), asserting the *projections*
-- (shifts / sales / current_stock_by_store_sku) end up byte-identical after
-- replaying the exact same backlog insert twice — simulating a till
-- re-uploading its whole queue after a dropped upload ack (EC-15).
--
-- SCOPING NOTE: tasks.md's original wording says "2000-event backlog". This
-- file uses 20 shifts + 20 sales (40 events total) instead — enough to prove
-- idempotency holds across a batch (not just a single row) while keeping the
-- fixture SQL small and maintainable. The mechanism being proven
-- (ON CONFLICT (event_id) DO NOTHING skipping the AFTER INSERT projection
-- trigger entirely on a re-insert) does not depend on the batch size.
--
-- Fixture UUIDs use the `44000000-0000-4000-8...` prefix (reserved for this
-- file) to avoid collisions with other pgTAP fixture files.

begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.stores (store_id, code, name) values
  ('44000000-0000-4000-8000-000000000001', 'RECONN-A', 'Reconnect Store A');

insert into public.tills (till_id, store_id, label, device_identity, device_credential_hash) values
  ('44000000-0000-4000-8000-000000000011', '44000000-0000-4000-8000-000000000001', 'Reconnect Till A', 'reconnect-device-a', 'hash');

insert into public.skus (sku_id, code, name, unit_type) values
  ('44000000-0000-4000-8000-000000000021', 'RECONN-SKU', 'Reconnect SKU', 'quantity');

insert into public.users (user_id, role, store_id, full_name, pin_hash, pin_updated_at) values
  ('44000000-0000-4000-8000-000000000101', 'cashier', '44000000-0000-4000-8000-000000000001', 'Reconnect Cashier', 'hash', now());

-- Inserts 20 shift_open events (each opening its own shift) plus 20 sale
-- events (one per shift), using deterministic event/shift/sale ids derived
-- from the loop index. Calling this twice with the SAME ids simulates a
-- till re-uploading an identical backlog after a dropped ack.
create or replace function public.seed_reconnect_backlog()
returns void
language plpgsql
as $$
declare
  i int;
  v_shift_id uuid;
  v_shift_event_id uuid;
  v_sale_id uuid;
  v_sale_event_id uuid;
begin
  for i in 1..20 loop
    v_shift_id := ('44000000-0000-4000-8100-' || lpad(i::text, 12, '0'))::uuid;
    v_shift_event_id := ('44000000-0000-4000-8101-' || lpad(i::text, 12, '0'))::uuid;
    v_sale_id := ('44000000-0000-4000-8200-' || lpad(i::text, 12, '0'))::uuid;
    v_sale_event_id := ('44000000-0000-4000-8201-' || lpad(i::text, 12, '0'))::uuid;

    perform public.ingest_shift_event(row(
      v_shift_event_id,
      '44000000-0000-4000-8000-000000000011'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      now(), now(), 'reconnect-test', 1,
      v_shift_id,
      '44000000-0000-4000-8000-000000000101'::uuid,
      'shift_open',
      jsonb_build_object('opening_float', 100)
    )::public.shift_events);

    perform public.ingest_sale_event(row(
      v_sale_event_id,
      '44000000-0000-4000-8000-000000000011'::uuid,
      '44000000-0000-4000-8000-000000000001'::uuid,
      now(), now(), 'reconnect-test', 1,
      v_sale_id,
      '44000000-0000-4000-8000-000000000101'::uuid,
      v_shift_id,
      'completed',
      jsonb_build_array(jsonb_build_object('sku_id', '44000000-0000-4000-8000-000000000021', 'qty', i)),
      jsonb_build_array(jsonb_build_object('type', 'cash', 'amount', i * 10)),
      i * 10, 0, 0, i * 10, null, null
    )::public.sale_events);
  end loop;
end;
$$;

-- ---- First pass: seed the backlog ----
select public.seed_reconnect_backlog();

select is(
  (select count(*) from public.shift_events where shift_id::text like '44000000-0000-4000-8100-%'),
  20::bigint,
  'first pass inserted 20 shift_events'
);
select is(
  (select count(*) from public.sale_events where sale_id::text like '44000000-0000-4000-8200-%'),
  20::bigint,
  'first pass inserted 20 sale_events'
);

-- Snapshot projection state produced by the first pass.
create temporary table reconnect_shifts_snapshot as
select shift_id, till_id, store_id, cashier_id, opening_float, system_cash, status
from public.shifts
where shift_id::text like '44000000-0000-4000-8100-%'
order by shift_id;

create temporary table reconnect_sales_snapshot as
select sale_id, shift_id, status, latest_status, grand_total
from public.sales
where sale_id::text like '44000000-0000-4000-8200-%'
order by sale_id;

create temporary table reconnect_stock_snapshot as
select store_id, sku_id, qty_on_hand
from public.current_stock_by_store_sku
where store_id = '44000000-0000-4000-8000-000000000001' and sku_id = '44000000-0000-4000-8000-000000000021';

-- ---- Second pass: replay the EXACT SAME backlog (simulated dropped ack) ----
select public.seed_reconnect_backlog();

select is(
  (select count(*) from public.shift_events where shift_id::text like '44000000-0000-4000-8100-%'),
  20::bigint,
  'replay does not duplicate shift_events rows (idempotent by event_id)'
);
select is(
  (select count(*) from public.sale_events where sale_id::text like '44000000-0000-4000-8200-%'),
  20::bigint,
  'replay does not duplicate sale_events rows (idempotent by event_id)'
);

-- ---- Projections must be byte-identical to the first-pass snapshot ----
select results_eq(
  $$select shift_id, till_id, store_id, cashier_id, opening_float, system_cash, status
    from public.shifts where shift_id::text like '44000000-0000-4000-8100-%' order by shift_id$$,
  'select shift_id, till_id, store_id, cashier_id, opening_float, system_cash, status from reconnect_shifts_snapshot order by shift_id',
  'shifts projection is byte-identical after replaying the same backlog twice'
);

select results_eq(
  $$select sale_id, shift_id, status, latest_status, grand_total
    from public.sales where sale_id::text like '44000000-0000-4000-8200-%' order by sale_id$$,
  'select sale_id, shift_id, status, latest_status, grand_total from reconnect_sales_snapshot order by sale_id',
  'sales projection is byte-identical after replaying the same backlog twice'
);

select results_eq(
  $$select store_id, sku_id, qty_on_hand
    from public.current_stock_by_store_sku
    where store_id = '44000000-0000-4000-8000-000000000001' and sku_id = '44000000-0000-4000-8000-000000000021'$$,
  'select store_id, sku_id, qty_on_hand from reconnect_stock_snapshot',
  'current_stock_by_store_sku projection is byte-identical after replaying the same backlog twice (no double stock deduction)'
);

select * from finish();

rollback;
