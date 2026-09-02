# Phase 0 Research — Retail POS 001-retail-pos-mvp

**Purpose**: Resolve every open technical unknown before Phase 1 design. Each section is Decision → Rationale → Alternatives considered, per the plan workflow.

## 1. Windows shell for a Next.js POS app

**Decision**: **Tauri 2** wrapping a Next.js **static export** (`output: "export"`), running on **Windows 10/11 IoT Enterprise or Pro**, using **PowerSync's official Tauri SDK** for offline storage and sync. Documented **Electron + PowerSync Node.js SDK** fallback if the Phase 0a spike (§12) fails.

**Rationale**:

- Windows was the correct target from the start; the earlier Capacitor/Android decision was based on the LPG ERP's terminal pattern and has been retracted at the spec level (feature spec 001 §14).
- Tauri's Rust-backed native filesystem SQLite (via the official PowerSync Tauri SDK) persists reliably across app updates. An earlier WASM/IndexedDB approach in Tauri's WebView had the opposite problem — local data reset on every build, which would silently destroy unsynced offline sales.
- Tauri's footprint is materially lighter than Electron on retail-grade POS hardware.
- Windows brings a mature OPOS/UPOS driver ecosystem for barcode scanners, receipt printers, cash drawers, and MSRs — simpler peripheral integration than the Android path.
- Kiosk mode (Windows Assigned Access / Shell Launcher) and fleet MDM (Microsoft Intune) are first-class Windows-native concerns rather than bolt-ons.

**Accepted risk**: the PowerSync Tauri SDK is currently alpha. The JS API is stable but the underlying Rust layer and IPC protocol may change. This is why Phase 0a (§12) exists — validate the SDK end-to-end **before** the rest of the MVP is built on it. Electron + PowerSync Node.js SDK is the pre-authorised fallback (Constitution v1.1.0).

**Alternatives considered**:

- **Electron + PowerSync Node.js SDK**: mature but heavier resource footprint; kept as the fallback path.
- **Capacitor + Android** (original assumption): retracted — terminals for this project are Windows-based, not Android.
- **PWA-in-browser / TWA**: no reliable native hardware plugin story on Windows POS terminals; card reader / cash drawer / printer integration would be fragile.
- **Native WPF/WinUI rewrite**: rejected by Constitution §Additional Constraints (frontend/app = Next.js/TypeScript).

## 2. Postgres event tables and projections

**Decision**: Six append-only event tables (one per event family) plus four projection tables maintained by `AFTER INSERT` triggers.

| Event table           | Written by                                                                                           | Notes                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `stock_events`        | Every till (sale, refund, count_correction, adjustment) and transfers                                | The Principle II core — all stock movement is a row here                           |
| `sale_events`         | POS till                                                                                             | Header + line items serialized in an `items JSONB` column; immutable once inserted |
| `shift_events`        | POS till                                                                                             | `shift_open` and `shift_close` records with float/cash-up JSON payload             |
| `transfer_events`     | Source till (`transfer_out`) and destination till (`transfer_in`) plus a `transfer_variance` variant | Also emits companion `stock_events` rows via trigger, so projections stay simple   |
| `adjustment_events`   | Store manager (approval flow)                                                                        | Also emits `stock_events` on approval                                              |
| `price_change_events` | HQ admin                                                                                             | Emits new rows into `price_versions`                                               |

| Projection table             | Rebuilt by                                     | Purpose                                               |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `current_stock_by_store_sku` | trigger on `stock_events` (sum of `delta_qty`) | Fast reads for reporting and low-stock alerts         |
| `shifts`                     | trigger on `shift_events`                      | Denormalised open/close pair with computed over/short |
| `sales`                      | trigger on `sale_events`                       | Header-view for reports and refund lookup             |
| `transfers`                  | trigger on `transfer_events`                   | State-machine projection driving the transfer UI      |

**Rationale**:

- Six distinct event families rather than one polymorphic mega-table because Postgres RLS + PowerSync sync-rule filters need typed row shapes to be efficient (index-friendly `WHERE event_type = ...` predicates are worse than dedicated tables at PowerSync scale).
- Projections are ordinary tables (not views/materialised views) because PowerSync sync rules stream ordinary tables efficiently but do not stream materialised views' refreshes. Triggers keep the projections eventually consistent within a single transaction.
- `transfer_events` emit companion `stock_events` via a trigger so downstream consumers (dashboards, `current_stock_by_store_sku`) don't have to special-case transfers. Correctness principle (Principle II) stays: `stock_events` remains the single source of truth for stock deltas.

**Alternatives considered**:

- **One `events` table with `type` column**: fewer tables, but RLS policies become one giant `CASE` expression and PowerSync sync-rule performance degrades noticeably beyond ~100 events/sec ingest.
- **Materialised views for projections**: PowerSync does not stream MV refreshes reliably; forces admin dashboard to hit Postgres directly and defeats the "everything HQ needs is already synced" pattern.
- **Store `current_stock` alongside `stock_events`**: violates Principle II. Rejected outright.

## 3. PowerSync sync rules per user role

**Decision**: Bucket-per-scope model. Each connected client falls into one of three role families and receives buckets whose `parameters` are derived from JWT claims.

### 3.1 JWT claim shape (issued by Supabase Auth + a custom claim hook)

Every JWT carries:

```json
{
  "sub": "<user_uuid>",
  "role": "cashier" | "store_manager" | "hq_admin",
  "store_id": "<uuid | null>",       // null for hq_admin (fleet-wide)
  "till_id": "<uuid | null>",        // set only for cashier tokens minted at a specific till
  "device_id": "<uuid | null>"       // set only for the till device-level credential
}
```

The custom claim hook is a Supabase Auth "access token hook" (Postgres function) — see [contracts/http-api.md](contracts/http-api.md) §Auth.

### 3.2 Bucket definitions

| Bucket                         | Parameters             | Rows included                                                                                                        | Consumed by                                           |
| ------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `store_catalog[store_id]`      | `store_id` from JWT    | `skus` scoped by `store_availability(store_id)`, `promotions` active for the store                                   | Cashier + Store manager tokens                        |
| `store_prices[store_id]`       | `store_id`             | `price_versions` where `store_id = :store_id OR store_id IS NULL` (global fallback)                                  | Cashier + Store manager                               |
| `store_stock[store_id]`        | `store_id`             | `current_stock_by_store_sku`, plus `stock_events` for this store from the last 30 days (older events are cloud-only) | Cashier + Store manager                               |
| `till_own_activity[till_id]`   | `till_id`              | This till's own `sale_events`, `shift_events` (own till only)                                                        | Cashier only                                          |
| `store_operations[store_id]`   | `store_id`             | `transfers` (in/out), `adjustments` awaiting approval, `low_stock_alerts`                                            | Store manager only (not cashier)                      |
| `store_users[store_id]`        | `store_id`             | `users` roster + salted-hash credential rows for cashiers assigned to that store                                     | Cashier + Store manager (both need to log in offline) |
| `fleet_all`                    | (none)                 | Every projection and every event table, fleet-wide                                                                   | HQ admin only                                         |
| `sync_health[store_id]`        | `store_id`             | `sync_health_snapshots` for the store's tills                                                                        | Store manager                                         |
| `sync_health_all`              | (none)                 | `sync_health_snapshots` fleet-wide                                                                                   | HQ admin                                              |
| `audit_log[store_id]`          | `store_id`             | Store-scoped audit entries                                                                                           | Store manager                                         |
| `audit_log_all`                | (none)                 | Fleet-wide audit                                                                                                     | HQ admin                                              |
| `device_provisioning[till_id]` | `till_id`, `device_id` | Device credential material, initial catalog seed                                                                     | Till device credential only, one-shot                 |

### 3.3 Role → bucket subscription

| Role                                                                       | Subscribes to                                                                                                                      | Rejects (via sync rule + RLS)                                                                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Cashier** (JWT `role=cashier`, `store_id=S`, `till_id=T`)                | `store_catalog[S]`, `store_prices[S]`, `store_stock[S]` (read-only projection), `till_own_activity[T]`, `store_users[S]`           | Cannot pull other tills' sales/shifts; cannot pull other stores; cannot pull audit or transfer-approval rows |
| **Store manager** (JWT `role=store_manager`, `store_id=S`)                 | `store_catalog[S]`, `store_prices[S]`, `store_stock[S]`, `store_operations[S]`, `store_users[S]`, `sync_health[S]`, `audit_log[S]` | Cannot pull other stores' data; cannot mint HQ-only price changes                                            |
| **HQ admin** (JWT `role=hq_admin`)                                         | `fleet_all`, `sync_health_all`, `audit_log_all`                                                                                    | Nothing at the sync layer (RLS still bounds writes)                                                          |
| **Till device credential** (JWT `role=device`, `device_id=D`, `till_id=T`) | `device_provisioning[T]` only, until first successful cashier login on the device                                                  | Not a human role; does NOT grant read of catalog/stock — that comes with the cashier JWT after login         |

### 3.4 Isolation guarantees

- No bucket exposes another store's rows to a cashier or store-manager token, per Principle III / NFR-006. This is enforced twice: PowerSync sync-rule parameterisation on `store_id`, and Postgres RLS on the same column (belt + braces — a bug in either alone doesn't leak).
- Cross-till visibility inside a store is admin-panel-only: cashier tokens receive `till_own_activity[T]` only, so Till 3 cannot see Till 4's sales history via the local DB. Store managers see the store's aggregate via `store_operations` and reports, not via a per-till sync bucket.
- Every sync rule is covered by a test in `powersync/tests/` that boots a fake JWT with each role and asserts row visibility.

**Rationale**:

- Parameterising buckets by JWT claim is the PowerSync-idiomatic way to do multi-tenant sync; putting the tenancy in the sync rule (not in a WHERE clause the client can trick) is what makes this safe.
- Two-layer enforcement (sync rules AND RLS) is deliberate: sync rules are policy for _what streams to the client_; RLS is policy for _what a client can write and read at HTTP-time_. A single layer is a single point of failure.

**Alternatives considered**:

- **RLS only, no sync-rule parameterisation**: PowerSync would then attempt to stream every row and rely on Postgres to filter — orders of magnitude more traffic and latency, and any RLS bug leaks fleet-wide.
- **Row-per-user buckets**: too fine-grained; explodes the number of buckets past what PowerSync sync-rule performance targets.
- **Per-role shared bucket without `store_id` parameter**: leaks stores to any store's manager. Rejected.

## 4. Sync queue monitoring

Monitoring is required by NFR-014, Principle IV, and Section 12 of the spec. It has three layers:

### 4.1 On-device: `sync_health_local` (SQLite, till-side)

A local, non-synced table on each till, updated by the sync engine:

| Column                    | Meaning                                                 |
| ------------------------- | ------------------------------------------------------- |
| `till_id`                 | The device's own ID                                     |
| `queue_depth`             | Rows in the PowerSync upload queue right now            |
| `oldest_pending_event_at` | `client_ts` of the oldest un-uploaded event (or `NULL`) |
| `last_upload_attempt_at`  | Client time of last upload attempt                      |
| `last_successful_sync_at` | Client time of last full sync round-trip                |
| `last_error`              | Last upload error string (truncated, no PII)            |
| `consecutive_failures`    | Backoff counter                                         |

This drives the in-app **Sync Health** screen (visible to any logged-in user; badge on the shell shows a coloured dot) and the "offline beyond threshold" operator warning (NFR-014).

### 4.2 Cloud-side: `sync_health_snapshots` (Postgres, synced back down)

Every till uploads a heartbeat row **every 60 seconds when online** and **on every reconnect** — the till pushes a compact `SyncHealthSnapshot` event to a lightweight Edge Function (or writes directly through a PowerSync bucket if latency allows).

Row shape:

| Column                    | Type        | Notes                                                 |
| ------------------------- | ----------- | ----------------------------------------------------- |
| `snapshot_id`             | uuid        | Client-generated dedup key                            |
| `till_id`                 | uuid        |                                                       |
| `store_id`                | uuid        |                                                       |
| `client_ts`               | timestamptz | Sample time on the till                               |
| `server_ts`               | timestamptz | Assigned on ingest — authoritative for staleness math |
| `queue_depth`             | int         |                                                       |
| `oldest_pending_event_at` | timestamptz |                                                       |
| `last_successful_sync_at` | timestamptz |                                                       |
| `consecutive_failures`    | int         |                                                       |
| `app_version`             | text        | For canary-rollout diagnostics (US8)                  |
| `schema_version`          | int         | Same reason                                           |

Because the till pushes on every reconnect, the _absence_ of a recent row for a till is itself the signal: if `MAX(server_ts) < now() - '15 minutes'` for a given `till_id`, that till is considered "sync-stale" — regardless of whether the till thinks it is fine.

### 4.3 Alerting: `pg_cron` + Edge Function webhook

A `pg_cron` job runs every minute:

```sql
SELECT public.check_sync_health_and_alert();
```

The function scans `sync_health_snapshots` for tills whose most recent `server_ts` is older than the configured `offline_threshold_hours` (per-store, defaults to 4 h during trading hours, 24 h overnight — final values set with ops team). For each stale till, it inserts into `sync_health_alerts` and (if not already firing) calls the `sync-health-alerts` Edge Function which posts to a WhatsApp/SMS webhook (NFR-014 requires "fast alerting channel").

### 4.4 Admin dashboards

Two dashboards, both in `apps/admin`:

- `/sync-health` (HQ) — fleet view: every till, current queue depth, staleness bucket, last-seen version. Sortable and filterable by store. Green/amber/red per-till pill; drill-down shows the last 24 h of that till's `sync_health_snapshots`.
- `/sync-health` (Store manager, scoped) — same layout, only shows their own store's tills, backed by the `sync_health[store_id]` bucket.

Metrics surfaced on both:

- Per-till `queue_depth` trend (spark-line)
- Fleet histogram of `last_successful_sync_at` buckets: <1 min, <5 min, <30 min, <4 h, >4 h
- Per-canary-cohort split (app version) for US8 rollout confidence
- "Oversold" SKU count from `current_stock_by_store_sku` (bleeds into inventory health but shown here for a single ops pane)

### 4.5 What we do NOT do

- No polling from the tills for cloud-side status; the till is the truth about its own queue.
- No dependency on external APM SaaS in the sale critical path; snapshots are ordinary Postgres rows, monitored with the same tools as everything else.
- No sync-health writes on the sale path — snapshots are written by a background worker in the till, so a broken sync-health metric can never break a sale.

**Rationale**:

- One table (`sync_health_snapshots`) rather than a metrics service means the same RLS/sync-rule model already used for the rest of the system covers it — no new auth surface, no new export pipeline.
- Absence-as-signal (server-side staleness math) is what catches the case a Hub design would have masked: a till whose device is dead cannot self-report; only server-side "haven't heard from this till" detects it.
- Alerting via `pg_cron` + Edge Function keeps the whole loop inside the Supabase stack — no separate alerting infrastructure to run.

**Alternatives considered**:

- **Cloud APM (Datadog, Grafana Cloud)**: overkill for 64 tills and adds a paid dependency outside the Supabase stack.
- **Push metrics only (no server-side staleness check)**: cannot detect a bricked/lost till, which is the exact scenario Section 12 says we need to catch.
- **Every event carries a health field**: bloats every insert; wrong layer of the stack.

## 5. Idempotent event ingest

**Decision**: Postgres `INSERT ... ON CONFLICT (event_id) DO NOTHING` on every event table. `event_id` is the primary key of every event table.

**Rationale**: A retried event MUST be a no-op (Principle IV, NFR-010). `ON CONFLICT DO NOTHING` is O(1) per row, correct under high concurrency, and observable (rows affected = 0 means dedup happened).

**Alternatives considered**:

- **Application-level dedup (SELECT then INSERT)**: race-prone under concurrent inserts and slower.
- **Advisory locks per event**: unnecessary complexity for a strictly monotonic key.

## 6. Schema-migration strategy (backward compatibility)

**Decision**: Expand-then-contract migrations, with a documented deprecation window of **≥ 2 released app versions** for any destructive change on a synced table.

- **Expand**: add columns as nullable, add tables, add optional event types. Old clients ignore them.
- **Migrate**: dual-write from application code for one release; backfill.
- **Contract**: only after the sync-health dashboard shows zero tills on the pre-migration app version, run the destructive drop/narrow migration.

**Rationale**: Direct enforcement of Principle IV ("MUST be backward-compatible across at least one prior released app version") and NFR-015. Sync-health dashboard already tracks `app_version` per till (§4.2), so "no old versions in the fleet" is verifiable, not assumed.

**Alternatives considered**:

- **Break-and-migrate windows**: unacceptable — tills that stayed offline through the deploy would lose events.

## 7. Design ↔ Principle trace

| Principle | Concrete artefact(s)                                                                                                                                                                                             | Where                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| I         | Zero network calls in sale/shift/login paths; all data reads via local SQLite through PowerSync SDK                                                                                                              | `apps/pos/src/lib/db`, `apps/pos/src/lib/auth`                                                                                                    |
| II        | Every stock-affecting write goes to a `*_events` table; `current_stock_by_store_sku` is a trigger-maintained projection                                                                                          | `supabase/migrations/*_stock_events.sql`, [data-model.md](data-model.md)                                                                          |
| III       | Sync buckets parameterised by `store_id`/`till_id`; no LAN discovery code; admin-only cross-till dashboards                                                                                                      | `powersync/sync-rules.yaml`, [contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml)                                           |
| IV        | PK on `event_id`; `ON CONFLICT DO NOTHING`; persisted queue via PowerSync SDK; batched backlog upload; exponential backoff + jitter in `apps/pos/src/lib/sync`                                                   | Ingest triggers, sync module                                                                                                                      |
| V         | `sale_events`/`shift_events`/`price_change_events`/`audit_log` all append-only; sales carry stamped `price_version_id`; adjustments carry `reason_code`+`approver_id`                                            | [data-model.md](data-model.md), [contracts/rls-policies.sql](contracts/rls-policies.sql)                                                          |
| VI        | Sync-health dashboard shows per-cohort `app_version`; migration policy §6; no fleet-wide deploy tooling built                                                                                                    | `apps/admin/src/app/sync-health`, docs/ops/canary.md (Phase 5)                                                                                    |
| VII       | RLS policies + sync-rule params + client route guards; Argon2id PIN hashing (WASM in `apps/pos/src/lib/auth`); SQLCipher for on-device SQLite; TLS everywhere; PCI-relevant card handling via reader tokens only | [contracts/rls-policies.sql](contracts/rls-policies.sql), [contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml), auth module |

## 8. Deferred / follow-on decisions

- **Report generation SLA per report type** — placeholder in NFR-002/SC-007. Set during Phase 4 planning against representative data volume.
- **Cashier training-time target** — placeholder in NFR-012/SC-010. Set with the ops team before pilot.
- **Offline-threshold hours (per-store, per-time-of-day)** — placeholder in EC-08. Set with the ops team; drives §4.3 alert function.
- **PIN policy** — placeholder in FR-043 / EC-14. Length, rotation, lockout threshold set with security review before Phase 1 implementation of `apps/pos/src/lib/auth`.
- **Fiscalisation** — deferred entirely to companion spec `002-fiscalisation`; blocks pilot go-live per Principle V.

## 9. Open questions to close before Phase 3

- **Store-manager approval flow for stock adjustments over threshold (FR-017)**: is approval always synchronous at the store, or can it be an HQ-side approval? Assume store-level for MVP; revisit before Phase 3 multi-store rollout.
- **Loyalty accounts (FR-037)**: spec says MAY; recommend deferring implementation to a follow-on spec and building only the price-engine loyalty-tier input for MVP.

None of these block Phase 1 design.

## 10. Fleet reconnect capacity plan

Concrete numbers for the mitigations behind EC-11, EC-12, EC-15, EC-18:

- Upload batches: ≤ 100 events per batch, 250 ms inter-batch pause.
- Retry jitter width: ≥ 30 s on attempt 1, geometric growth to a cap of 5 min.
- Sync-health snapshots: dedicated `POST /internal/sync-health-snapshot` Edge Function endpoint, NOT the general PowerSync upload queue. Rate-limited to 1 per 10 s per till, server-side dedup by `snapshot_id`.
- Postgres connection pool (Supabase PgBouncer): target 150 in transaction mode with `max_connections = 300` on the DB, validated in the Phase 5 drill with a simulated ~64-till simultaneous reconnect.
- Sync-rule deploys: forbidden during trading hours OR during any active reconnect-recovery window (per Constitution VI, made explicit here).
- Column-in-sync-rule rule: any column referenced by `powersync/sync-rules.yaml` MUST have shipped in the schema at least one released app version prior (EC-20).

## 11. Optimistic mutations — deliberately none

This system does not use optimistic client-side mutations for shared state. Every till write is an append-only event; `event_id` upsert makes retries no-ops (Principle IV). The classic optimistic-mutation problem class (rollback, re-apply, client-server conflict UI) does not exist here by design.

The nearest neighbour is the **price-read-staleness** case: a slow-connection till completes sales at price P1 while HQ has already committed P2 but the till has not yet synced the change. This is covered explicitly by FR-028 / SC-005 — the sale is stamped with the cached `price_version_id` at time of sale and is never retroactively re-priced. It is a business-decision surface (compensate the customer, absorb the difference, or bulk-refund), not a system reconciliation surface. Finance can quantify the exposure exactly from the `price_version_id` stamped on each affected sale line.

Master data (prices, promotions, users) is edited only at HQ and only online — it is never optimistically written at the till. There is therefore no client-side mutation of shared state that could conflict with a server-side truth.

Trustworthy local time is the one shared truth a till _reads locally_ and _writes financial results based on_: see EC-17 / FR-044 for the NTP + skew-refusal rule that keeps this correct. Deterministic resolution of concurrent HQ price changes is EC-19.

## 12. Phase 0a offline-write spike

Because the PowerSync Tauri SDK is alpha, Phase 0a is a mandatory de-risking task **before Phase 0 begins**. Scope:

- One till, running the actual Tauri + PowerSync Tauri SDK build (not a mock, not a browser dev-server).
- Log in offline against a pre-seeded cashier row.
- Open a shift, complete one sale using cached prices, print/render a receipt.
- Cycle the app and the machine; confirm the queued events survive.
- Bring the network back up; confirm the sale and the shift open sync exactly once to Supabase with correct `server_ts` assignment and no duplicates.

**Pass criteria** (all must hold):

- SDK does not crash under normal write load.
- Local SQLite file survives an app update install (not just a restart).
- IPC between Tauri Rust shell and the WebView JS is stable under repeat cycles.
- No data loss under `kill -9` mid-write.

**Failure ⇒ pre-authorised fallback**: switch to Electron + PowerSync's Node.js SDK. The switch decision is made here, at Phase 0a, not later — because after Phase 0 has landed, Tauri-specific code (updater config, native plugin adapters, Windows-shell integration) accretes fast.

**Deliverable**: a written spike report attached to the feature (`specs/001-retail-pos-mvp/spike-report.md`, when Phase 0a is executed) documenting pass/fail on each criterion and the resulting decision.
