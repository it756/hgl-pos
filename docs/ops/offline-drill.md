# Offline Drill Runbook

Constitution Principle VI requires an "offline for 3 days" drill against the
pilot store before general rollout, and gate 3 of the Development Workflow
requires at least an 8-hour offline drill before any release is promoted
beyond the pilot store. This runbook covers both.

## Pre-drill checklist

- [ ] Pilot till (`Till 1` or `Till 2` at the pilot store) is on the build
      under test and has synced successfully at least once (`apps/pos`
      sync-health page shows `last_successful_sync_at` recent, queue depth 0).
- [ ] Cashier roster for the pilot store's till has synced within the last
      sync interval (EC-14 — a roster change made mid-drill won't reach an
      offline till).
- [ ] A store manager is available on-site to run representative trading:
      cashier login, shift open, sales across all tender types, at least one
      same-till void, a stock count, and a shift close.
- [ ] Confirm `NEXT_PUBLIC_SUPABASE_URL` is reachable from the till network
      under normal conditions (used by `ReliableClock`'s financial-event
      clock guard, `apps/pos/src/lib/time/clock.ts` — a till with a stale
      clock sync will refuse financial writes even before you disconnect it).

## 8-hour drill (pre-release gate)

1. Disconnect the till's WAN (unplug the LAN/WiFi uplink or block outbound
   traffic at the router — do not touch the till's power or local process).
2. Run a full trading day's representative volume: logins, shifts,
   sales (cash/card/mobile-money-mtn/mobile-money-airtel), same-till voids,
   stock counts, adjustment requests.
3. Confirm the till surfaces its offline state clearly (`SyncStatusChip` in
   `apps/pos/src/components/sync-status-chip.tsx`) and that no operation in
   step 2 was blocked or degraded.
4. After 8 hours, reconnect WAN.
5. Watch `apps/pos/src/app/sync-health/page.tsx` (till-local) and the admin
   fleet view (`apps/admin/src/app/(app)/sync-health/page.tsx`) until queue
   depth returns to 0.
6. Verify in Postgres that every locally-recorded event exists exactly once
   server-side (compare local `local_upload_queue`/`sale_events` row counts
   against `select count(*) from sale_events where till_id = '<till_id>'`,
   etc.) — no duplicates, no losses.

## 3-day drill (pre-rollout-progression gate)

Same procedure as the 8-hour drill, extended to a full 3 trading days
(or the equivalent trading volume compressed into a shorter window if a
full 3-day disconnect isn't operationally feasible for the pilot store —
document which approach was used and why in the drill report). Record:

- Total events recorded locally per event type (shift, sale, stock,
  adjustment).
- Total events landed server-side per type, post-reconnect.
- Any discrepancy, however small, is a **blocking** finding — do not
  progress rollout past the pilot store until it's root-caused.
- Backlog upload duration and whether it stayed within EC-15's batching
  behaviour (≤ 100 events per batch, 250 ms pause between batches — see
  `apps/pos/src/lib/sync/engine.ts`).
- Whether the offline-threshold warning correctly appeared once the till's
  store-specific trading/overnight threshold was exceeded (`stores.
  offline_threshold_minutes_trading` / `_overnight`; see
  `apps/pos/src/lib/config/offline-threshold.ts`).

## Recording the result

Write the outcome to `specs/001-retail-pos-mvp/drill-report.md` (T144) using
the sections above as headings. A rollout MUST NOT progress past the pilot
store on a drill that found any data-loss or duplication defect
(Constitution Principle VI).
