# Device Recovery Runbook

Procedure for a lost, bricked, or stolen till.

## 1. Immediately revoke the device credential

The till authenticates to Supabase/PowerSync using a device-level credential
distinct from any cashier session (Constitution Principle VII). As soon as a
device is reported lost/stolen:

1. As `hq_admin`, call `supabase/functions/rotate-device-credential` for the
   affected `till_id` (or, if the device is unrecoverable, mark the `tills`
   row's `retired_at` so no future credential rotation succeeds for it).
2. Confirm in the admin sync-health dashboard
   (`apps/admin/src/app/(app)/sync-health/page.tsx`) that the till no longer
   appears as actively syncing after the credential is rotated/retired.

## 2. Attempt to recover the local event queue (if the device is merely lost,
   not destroyed, and can still be safely powered on by an authorised person)

If the till is bricked or its screen is inaccessible but the storage can be
removed and read on another machine, the on-till SQLite database (WAL mode,
per Constitution Principle I) contains:

- `local_upload_queue` — events written locally but not yet confirmed
  server-side. Every row here is a financial/stock event that has NOT yet
  landed in Postgres.
- `sale_events`, `shift_events`, `stock_events`, `adjustment_events` (local
  mirrors) — the till's complete local ledger.

Recovery steps:

1. **Do not** attempt to re-provision or wipe the device before this step.
2. Extract the SQLite database file from the till's app-data directory.
3. On a secure workstation, open the extracted database read-only and export
   `local_upload_queue` (and, if any rows there look stale/incomplete, the
   full event-table contents for the affected shift window) to CSV/JSON.
4. Hand the export to an engineer to manually verify/replay against Postgres
   (matching `event_id`s — the server's `ON CONFLICT (event_id) DO NOTHING`
   ingest, per Constitution Principle IV, makes a manual replay safe even if
   some rows already landed through a since-restored connection).
5. Document the recovered event count and any gap versus what the cashier/
   manager on shift recalls trading, in an incident note.

## 3. If recovery is not possible (device destroyed/inaccessible)

1. Rotate/retire the device credential (step 1) regardless.
2. Cross-reference the last successful sync snapshot
   (`sync_health_snapshots`) for the affected till to establish the latest
   confirmed server state — everything after that point and before the
   incident is the maximum possible data-loss window.
3. File an incident note citing the affected shift(s)/till, the estimated
   loss window, and whether a manual till-side reconciliation (cash count
   vs. last known system totals) is needed at the store.

## 4. Re-provisioning a replacement device

Use `POST /provision-till` (`supabase/functions/provision-till`) with a new
device identity for the same store — this issues a brand-new `till_id`
credential; the old till_id is never reused. Follow
`docs/ops/kiosk-config.md` and `docs/ops/intune-deployment.md` for physical
setup of the replacement unit.
