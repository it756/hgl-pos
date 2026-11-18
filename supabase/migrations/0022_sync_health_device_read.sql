-- Fix: sync_health_read never granted SELECT to the cashier/device role that
-- inserts its own till's snapshots. PostgREST's default insert Prefer header
-- requests the row back (RETURNING), and RETURNING is filtered by the same
-- SELECT policy — so every device-role insert into sync_health_snapshots
-- failed with "new row violates row-level security policy" even though the
-- insert's own WITH CHECK passed, since the row couldn't be returned.
-- Same class of bug as the pre-existing sale_events_read/shift_events_read
-- device-SELECT gap (see 0002/RLS notes) — missed on this table originally.
alter policy sync_health_read on public.sync_health_snapshots
  using (
    public.claim_role() = 'hq_admin'
    or (public.claim_role() = 'store_manager' and store_id = public.claim_store_id())
    or (public.claim_role() in ('cashier', 'device') and till_id = public.claim_till_id())
  );
