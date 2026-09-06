-- Admin-console transfer workflow (T100/T101/T103) + a pre-existing RLS gap
-- found while wiring the suppliers UI.

-- Transfer requests/dispatches/receipts/variances (T101) are written from
-- the web admin console by a store_manager, not a physical till — same
-- situation price_change_events / adjustment_events / stock_events already
-- solved (0002, 0016): drop the FK so a well-known sentinel till_id
-- (HQ_CONSOLE_TILL_ID, apps/admin/src/lib/events/transfer.ts) can be used.
alter table public.transfer_events drop constraint transfer_events_till_id_fkey;

-- Real bug found while building the Suppliers UI (T103): `suppliers` and
-- `sku_suppliers` (0001_master_data.sql) have NEVER had RLS enabled or any
-- policy defined, unlike every other master-data table (`stores`, `tills`,
-- `skus`, ...). Since Supabase grants the `authenticated`/`anon` roles table
-- privileges by default and relies on RLS for restriction, this means ANY
-- authenticated caller (and PostgREST's anon key, depending on grants) could
-- read AND write supplier/procurement data directly with zero role check
-- (OWASP A01 Broken Access Control). Fixed here using the exact same
-- read-all-authenticated / write-hq-only shape as `stores_read_all_authenticated`
-- / `stores_write_hq`, since supplier/procurement master data is an HQ-level
-- concern (FR-019), not a store-level one.
alter table public.suppliers enable row level security;
create policy suppliers_read_all_authenticated on public.suppliers for select
  using (auth.role() = 'authenticated');
create policy suppliers_write_hq on public.suppliers for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');

alter table public.sku_suppliers enable row level security;
create policy sku_suppliers_read_all_authenticated on public.sku_suppliers for select
  using (auth.role() = 'authenticated');
create policy sku_suppliers_write_hq on public.sku_suppliers for all
  using (public.claim_role() = 'hq_admin')
  with check (public.claim_role() = 'hq_admin');
