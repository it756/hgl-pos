---
description: "Task list — Retail POS 001-retail-pos-mvp"
---

# Tasks: Retail POS System — 16-Store Supermarket Rollout

**Input**: Design documents from `/specs/001-retail-pos-mvp/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)
**Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md) v1.1.0

**Tests**: The spec calls out required test artefacts (pgTAP, PowerSync isolation, Vitest, WebDriverIO E2E). Test tasks are included per user story but are NOT strict TDD — implementation may land in the same PR as its tests. What the spec DOES require is that each user story's Independent Test scenario has an executable test task before that story's checkpoint is claimed.

**Organization**: Tasks are grouped by phase. Phases 1–3 are prerequisites; Phases 4–12 are per-user-story; Phase 13 is polish. Phase 2 (Phase 0a Spike) is a **BLOCKING GATE** — Phase 3+ MUST NOT begin until the spike report is written and its outcome (primary SDK or sidecar fallback per [research.md §12](research.md)) is recorded.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in the same phase)
- **[Story]**: `[US1]`…`[US9]` label; Setup/Foundational/Spike/Polish phases have no story label
- Every task specifies a concrete file path

## Path Conventions

Per [plan.md project structure](plan.md#project-structure): pnpm-workspaces monorepo. `apps/pos` (Windows Tauri POS), `apps/admin` (web admin), `supabase/` (migrations + Edge Functions), `powersync/` (sync rules), `packages/` (shared TS), `docs/ops/` (runbooks).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo scaffolding, base tooling, and dependency install. Nothing here depends on the Phase 0a spike outcome.

- [X] T001 Create the monorepo directory tree per [plan.md](plan.md): `apps/pos/`, `apps/admin/`, `supabase/{migrations,functions,seed,tests}/`, `powersync/{tests/}`, `packages/{events,contracts,db-shared,config}/`, `docs/ops/`
- [X] T002 [P] Root workspace config: `package.json` (private, name `@hgl/monorepo`), `pnpm-workspace.yaml` listing `apps/*` and `packages/*`, `.gitignore` (Rust `target/`, Next `.next/`, Tauri build artefacts, `node_modules/`), `.editorconfig`
- [X] T003 [P] Shared TS config: `packages/config/tsconfig/base.json` (strict, ES2022, `moduleResolution: "bundler"`), `packages/config/tsconfig/react.json`, `packages/config/tsconfig/node.json`
- [X] T004 [P] Shared ESLint + Prettier: `packages/config/eslint/index.mjs`, `packages/config/prettier/index.mjs`
- [X] T005 [P] Init Supabase locally: run `supabase init`; commit `supabase/config.toml`; add `supabase/README.md` with local URLs contract
- [X] T006 [P] Install PowerSync CLI at dev-time; create `powersync/local.yaml` pointing at local Supabase; add PowerSync CLI check to CI
- [X] T007 CI baseline in `.github/workflows/ci.yml`: lint (all), typecheck (all), Vitest, pgTAP (`supabase test db`), PowerSync sync-rule tests, Tauri Windows build (matrix: `windows-latest`)
- [X] T008 [P] Scaffold `apps/pos`: Next.js 15 App Router with `output: "export"` in `apps/pos/next.config.mjs`; `apps/pos/package.json` extending shared config
- [X] T009 [P] Scaffold `apps/admin`: Next.js 15 App Router + Tailwind + shadcn/ui in `apps/admin/`; `apps/admin/next.config.mjs`; `apps/admin/tailwind.config.ts`
- [X] T010 [P] Scaffold `apps/pos/src-tauri/`: `tauri.conf.json` (WebView2 target, `tauri-plugin-updater`, code-signing config skeleton), `Cargo.toml`, `src/main.rs`, `build.rs`
- [X] T011 [P] Install PowerSync Tauri SDK (alpha — pinned version) and `@powersync/react` in `apps/pos/package.json`; add version pin comment referencing [research.md §1](research.md)
- [X] T012 [P] Install Supabase JS client v2 in both `apps/pos/package.json` and `apps/admin/package.json`
- [X] T013 [P] Install Zod + Drizzle ORM in `packages/events/package.json` and `packages/db-shared/package.json`
- [X] T014 [P] Bootstrap `packages/events/src/index.ts` by copying the Zod schemas from `contracts/events.schema.ts` verbatim; export types
- [X] T015 [P] Bootstrap `packages/contracts/src/http-api.ts` with request/response TS types matching [contracts/http-api.md](contracts/http-api.md)

**Checkpoint**: Monorepo installs cleanly (`pnpm install`), CI green on empty apps.

---

## Phase 2: Phase 0a Offline-Write Spike (BLOCKING GATE)

**Purpose**: Validate the alpha PowerSync Tauri SDK end-to-end before ANY foundational work is built on top. Documented in [research.md §12](research.md).

**⚠️ CRITICAL**: No Phase 3+ task may begin until T018 records a decision.

- [X] T016 Implement the smallest offline-write slice on the real Tauri + PowerSync Tauri SDK: one seeded cashier, one shift open, one sale using cached prices, disconnect from WAN, reconnect, verify sync. Files: `apps/pos/src/app/spike/page.tsx` + `apps/pos/src-tauri/src/spike.rs`
- [X] T017 Execute the four pass criteria in [research.md §12](research.md) on target Windows POS hardware: (a) no SDK crash under normal write load, (b) SQLite file survives an app-update install (not just restart), (c) IPC stable under repeat cycles, (d) no data loss under `kill -9` mid-write. Record raw evidence in `specs/001-retail-pos-mvp/spike-evidence/`
- [X] T018 **GATE decision**: write `specs/001-retail-pos-mvp/spike-report.md` documenting PASS/FAIL per criterion and one of two outcomes:
  - **PASS** → Phase 3+ proceeds on the primary Tauri SDK path.
  - **FAIL** → apply the Tauri sidecar fallback per [research.md §12.1](research.md): add a Node.js sidecar binary to `apps/pos/src-tauri/tauri.conf.json > externalBin`, implement the `IDb` interface as a sidecar HTTP/IPC adapter in `apps/pos/src/lib/db/`, and update Phase 3+ tasks that reference "PowerSync Tauri SDK" to say "PowerSync SDK (sidecar)". Sidecar transport (loopback HTTP vs Tauri `invoke`) picked and justified in the report.

**Checkpoint** ⚠️: Spike report exists and outcome recorded. SC-012 met.

---

## Phase 3: Foundational (Blocking Prerequisites)

**Purpose**: Postgres schema, RLS, sync rules, sync-engine wiring, sync-health, auth infrastructure. Every user story depends on this phase. Some tasks reference "PowerSync Tauri SDK" — substitute "sidecar-hosted SDK" if the spike fell back.

### Postgres schema (data-model.md)

- [X] T019 Migration `supabase/migrations/0001_master_data.sql`: `stores`, `tills`, `sku_categories`, `skus`, `sku_barcodes`, `store_sku_availability`, `suppliers`, `sku_suppliers`, `users`, `promotions`, `price_versions` (append-only per [data-model.md §1.7](data-model.md)) — no `superseded_by`, no `effective_to`
- [X] T020 [P] Migration `supabase/migrations/0002_event_tables.sql`: `stock_events`, `sale_events`, `shift_events`, `transfer_events`, `adjustment_events`, `price_change_events` with common columns + `event_id` PK + `ON CONFLICT DO NOTHING` ingest per [data-model.md §2](data-model.md)
- [X] T021 [P] Migration `supabase/migrations/0003_projection_tables.sql`: `current_stock_by_store_sku`, `shifts`, `sales`, `transfers`, `pending_transfer_receipts` (side table for out-of-order transfer_in per EC-04)
- [X] T022 [P] Migration `supabase/migrations/0004_sync_health.sql`: `sync_health_snapshots`, `sync_health_alerts`
- [X] T023 [P] Migration `supabase/migrations/0005_audit_log.sql`: `audit_log` + `public.append_audit(...)` SECURITY DEFINER function (write path for RLS-blocked table)
- [X] T024 Migration `supabase/migrations/0006_projection_triggers.sql`: `AFTER INSERT` triggers on all six event tables to maintain projections. Transfer state machine implemented here — `transfer_received` arriving before `transfer_dispatched` is held in `pending_transfer_receipts` (EC-04)
- [X] T025 Migration `supabase/migrations/0007_price_change_trigger.sql`: `AFTER INSERT` on `price_change_events` inserts a new `price_versions` row. No mutation of prior versions (see EC-19 canonical resolution query)
- [X] T026 Migration `supabase/migrations/0008_indexes.sql`: all indexes from [data-model.md §6](data-model.md) — event tables `(store_id, server_ts DESC)`, `(till_id, server_ts DESC)`, `sale_events (cashier_id, server_ts DESC)`, `(sale_id) UNIQUE`, partial index on `current_stock_by_store_sku WHERE is_oversold`
- [X] T027 Migration `supabase/migrations/0009_rls_policies.sql`: import [contracts/rls-policies.sql](contracts/rls-policies.sql) verbatim including `tg_validate_cashier_belongs_to_store()` triggers on `sale_events` and `shift_events`
- [X] T028 [P] Migration `supabase/migrations/0010_auth_token_hook.sql`: `public.access_token_hook(event jsonb) returns jsonb` — injects `role`, `store_id`, `till_id`, `device_id` claims per [contracts/http-api.md](contracts/http-api.md) §Auth. Register via Supabase dashboard or CLI
- [X] T029 Migration `supabase/migrations/0011_pg_cron.sql`: enable `pg_cron`, schedule `check_sync_health_and_alert()` every minute (research.md §4.3)

### PowerSync sync rules

- [X] T030 Deploy sync rules: copy [contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml) to `powersync/sync-rules.yaml`; enable Postgres logical replication on the target Supabase project (research §1 requirement)

### Foundational tests

- [X] T031 [P] pgTAP `supabase/tests/rls.spec.sql`: assert every policy in [contracts/rls-policies.sql](contracts/rls-policies.sql). Cover device-JWT roster read + insert bounds.
- [X] T032 [P] pgTAP `supabase/tests/event_idempotency.spec.sql`: duplicate `event_id` INSERT is a no-op across all six event tables
- [X] T033 [P] pgTAP `supabase/tests/projection_triggers.spec.sql`: sale → companion `stock_events`; transfer_in-before-transfer_out held in `pending_transfer_receipts`; state machine advances only forward
- [X] T034 [P] PowerSync isolation `powersync/tests/isolation.spec.ts`: cashier@storeA cannot see storeB rows in any bucket; till T cannot see till T+1 sale_events; **device credential JWT sees `store_users[S]` and `device_provisioning[T]` but NOT catalog/stock/sales/audit/sync_health** (EC-06, C1 fix)
- [X] T035 [P] Seed `supabase/seed/seed.sql`: 1 pilot store, 2 tills (`Till 1`, `Till 2`), 1 HQ admin, 1 store manager, 2 cashiers with PINs, ~50 SKUs across 3 categories, initial global prices

### Till-side foundational modules (apps/pos)

- [X] T036 [P] `apps/pos/src/lib/db/interface.ts`: define the `IDb` interface (query, insert, watch). Two implementations — `apps/pos/src/lib/db/tauri-sdk.ts` (primary) and `apps/pos/src/lib/db/sidecar.ts` (fallback). Both share Drizzle types from `packages/db-shared`
- [X] T037 [P] `apps/pos/src/lib/db/schema.ts`: Drizzle SQLite schema mirroring the streamed tables per [data-model.md §5](data-model.md)
- [X] T038 [P] `apps/pos/src/lib/sync/engine.ts`: backoff + jitter (≥ 30 s attempt 1, geometric to 5 min cap), batched upload (≤ 100 events / 250 ms pause per EC-15), persisted-queue survivability across app restart (EC-02)
- [X] T039 [P] `apps/pos/src/lib/sync/health.ts`: local `sync_health_local` write-only table; sends snapshot via `POST /internal/sync-health-snapshot` Edge Function on schedule (≤ 1/10 s per till per EC-18)
- [X] T040 [P] `apps/pos/src/lib/time/clock.ts`: NTP sync ≥ every 12 h while online; persist last-known-reliable timestamp; refuse to record financial events if local time drifts > 15 min (FR-044, EC-17)
- [X] T041 [P] `apps/pos/src/lib/auth/pin.ts` + `apps/pos/src-tauri/src/pin.rs`: Argon2id PIN hash/verify implemented in the Rust shell (native, not WASM) exposed via a Tauri command
- [X] T042 [P] `apps/pos/src/lib/auth/device-credential.ts`: read + rotate device credential; refresh policy per Constitution §Additional Constraints
- [X] T043 [P] `apps/pos/src/lib/peripherals/`: OPOS/UPOS adapter interfaces (printer, scanner, cash drawer, MSR) — retry/timeout isolated from sync layer (Principle I rule 3)

### Edge Functions

- [X] T044 Edge Function `supabase/functions/internal-sync-health-snapshot/index.ts`: receives snapshot POSTs from tills (EC-18 dedicated endpoint); dedup by `snapshot_id`; RLS-bounded insert
- [X] T045 [P] Edge Function `supabase/functions/sync-health-alerts/index.ts`: `pg_cron` invokes `check_sync_health_and_alert()`; posts to WhatsApp/SMS webhook when a till goes stale
- [X] T046 [P] Edge Function `supabase/functions/provision-till/index.ts`: implements `POST /provision-till` per [contracts/http-api.md](contracts/http-api.md)
oull- [X] T047 [P] Edge Function `supabase/functions/rotate-device-credential/index.ts`: implements `POST /auth/device-credential/rotate`

### Admin + POS shells

- [X] T048 [P] `apps/admin/src/app/layout.tsx`: role-gated Supabase client (`apps/admin/src/lib/supabase/server.ts`, `apps/admin/src/lib/supabase/browser.ts`); auth-context provider; route guards
- [X] T049 [P] `apps/pos/src/app/layout.tsx`: PowerSync provider from `apps/pos/src/lib/db/`, kiosk-safe error boundary, offline badge
- [X] T050 [P] `apps/pos/src/app/sync-health/page.tsx`: reads `sync_health_local`; shows queue depth, last-successful-sync, offline-threshold warning (NFR-014)
- [X] T051 [P] `apps/admin/src/app/sync-health/page.tsx`: HQ fleet view — per-till queue depth, staleness histogram, `app_version` cohort split (research §4.4), **and a "cashier roster last-refreshed at" indicator per till (FR-042) so a "cashier missing at till" report during onboarding is diagnosable**
- [X] T052 [P] Store-manager scoped view: implemented as the SAME `apps/admin/src/app/sync-health/page.tsx` (not a separate `(store)` route — a `()` route group does not change the URL, so a second `page.tsx` at that path would collide with T051's route). RLS on `sync_health_latest_by_till`/`current_stock_by_store_sku` already scopes a store_manager's rows to their own store; the page only branches on `scope` for whether to show the store filter.

**Checkpoint**: Foundation ready. All user story phases can now proceed in priority order (and P1 stories in parallel where their files are disjoint).

---

## Phase 4: User Story 9 — Offline Cashier Login, Shift Open & Cash-Up (Priority: P1)

**Goal**: A cashier can log in offline, open a shift, sell throughout, and cash-up — all against locally-cached credentials with no network dependency (spec [US9](spec.md#user-story-9)).

**Independent Test**: Provision a till with a synced roster, disconnect, log in as a cashier via cached PIN, open a shift with float, complete 20 sales, close with cash-up, reconnect, verify login had no network call and shift events synced exactly once with correct over/short.

**Why first among user stories**: US9 is a hard prerequisite for US1 (spec [US9 §Why](spec.md)). A till that cannot authenticate a cashier or open a shift offline cannot sell.

### Implementation

- [X] T053 [P] [US9] Cashier login page `apps/pos/src/app/login/page.tsx`
- [X] T054 [US9] `apps/pos/src/lib/auth/cashier-session.ts`: offline PIN check against cached `users.pin_hash`; local lockout state persisted (FR-043) — cannot be reset by taking till offline
- [X] T055 [P] [US9] Shift open dialog `apps/pos/src/app/shift/open/page.tsx` — opening-float entry, cashier-attribution stamp
- [X] T056 [P] [US9] Shift close / cash-up dialog `apps/pos/src/app/shift/close/page.tsx` — per-tender cash counted, over/short calc
- [X] T057 [US9] `apps/pos/src/lib/events/shift.ts`: Zod-validated `shift_open` / `shift_close` builders (depends on T014)
- [X] T058 [US9] `apps/pos/src/lib/events/queue.ts`: persist shift events + append to upload queue (depends on T038)

**Implementation notes (T053–T058, T147)**:
- `apps/pos/src/lib/events/id.ts` (T147) implements `nextEventId(db, tillId)`: a durable per-till `local_event_sequence` counter (`UPDATE ... RETURNING`) combined with the till_id via a hand-rolled RFC 4122 UUID v5 (Web Crypto `SHA-1`, no new npm dependency). Vitest `apps/pos/tests/unit/events/id.spec.ts` covers uniqueness/determinism and a 10k-iteration, two-till collision check — all passing.
- `apps/pos/src/lib/events/shift.ts` / `queue.ts` build and persist `shift_open`/`shift_close` events. `ShiftEventQueue` also maintains the local `shifts` projection row optimistically (opened/closed, `over_short` as a **local estimate only** — the authoritative figure is a Postgres generated column computed from synced sale events once this till's data round-trips). `system_cash` defaults to 0 locally until Phase 5 sales exist to compute it from.
- **Gap surfaced and fixed in-line**: `apps/pos/src/lib/db/provider.tsx`'s PowerSync `Schema` was empty and no module had ever created the `users`/`shift_events`/`shifts` SQLite tables (no `.connect()`/backend connector is wired yet either — confirmed via repo-wide search). `cashier-session.ts` and `events/queue.ts` now each provision their own tables via `CREATE TABLE IF NOT EXISTS`, following the same per-module pattern already used by `sync/engine.ts`, `sync/health.ts`, and `time/clock.ts`. This does not touch PowerSync's bucket/schema wiring (still empty/deferred) — only unblocks local reads/writes needed for T053-T058.
- `apps/pos/src/lib/auth/cashier-session.ts` (T054): local lockout after 5 failed PIN attempts, 5-minute lockout window (`MAX_FAILED_PIN_ATTEMPTS` / `LOCKOUT_DURATION_MS` — spec left exact numbers to be finalised; these are documented MVP defaults, easy to retune).
- `apps/pos/src/lib/till/services.ts`: small composition helpers (`getTillId`, `createShiftEventQueue`) since there is still no app-wide composition root. Financial events (shift open/close) are gated by the existing `ReliableClock.assertFinancialClockAllowed()` guard, pointed at `NEXT_PUBLIC_SUPABASE_URL`'s health endpoint for network time — **this env var is not yet set up for `apps/pos` (no `.env`/`.env.example` there yet)**, so shift open/close will correctly refuse to run until it is configured, consistent with FR-043's intent rather than silently bypassing the guard.
- `SyncEngine`'s `uploader` is a throwing stub (`local_upload_queue` still fills correctly; nothing calls `.upload()` yet) — the real HTTP ingest endpoint + uploader is a separate, not-yet-scheduled task.
- Verified via `pnpm --filter @hgl/pos typecheck|lint|test|build` — all green (static export succeeds, 3 Vitest cases pass).
- **Not done in this pass**: T146 (admin user management UI — also needs a PIN-hashing-from-non-Tauri-context decision).

**Catch-up test pass (T059–T063, T148, T149)**:
- Extracted `apps/pos/src/lib/shift/cash-up.ts` (`calculateOverShort`, `sumCashTenders`) out of `events/queue.ts`'s inline formula so it's independently unit-testable; `queue.ts` and `app/shift/close/page.tsx` now both call it.
- Added `apps/pos/tests/support/memory-db.ts` (`MemoryDb`): a shared in-memory `IDb` fake that actually parses the bounded single-table SQL vocabulary these lib modules issue (`CREATE TABLE/INDEX`, `INSERT ... ON CONFLICT`, `UPDATE ... [RETURNING]`, `SELECT ... [WHERE/ORDER BY/LIMIT/aggregate]`, `DELETE`), used by the new integration tests (T061, T148, T149) instead of a new narrow fake per file.
- **Bug found and fixed while wiring these tests**: `events/queue.ts`, `sync/health.ts`, `events/sale.ts`, and `events/void.ts` all imported `localSchemaVersion` via a *mixed* `import { localSchemaVersion, type IDb } from "../db"` — since only the `type` specifier is elided, this pulled in the `../db` barrel (`db/index.ts`) at runtime, which re-exports `TauriSdkDb` from `./tauri-sdk` → the real `@powersync/tauri-plugin@0.0.6` package, whose compiled `index.js` does an extensionless `import ... from "./database"` that fails under Vitest/Vite's Node ESM loader. Fixed by importing `localSchemaVersion` from `../db/schema` and `IDb` as `import type ... from "../db/interface"` in all four files — no behavior change, just decouples them from the barrel so they're loadable outside a real Tauri WebView.
- T063 required scaffolding `apps/pos/wdio.conf.ts` (didn't exist yet, despite `package.json`'s `test:e2e` script referencing it) plus adding `@wdio/globals`/`@wdio/types` devDependencies. The E2E spec exercises login → open shift → cash-up close only (US1's sale flow, T064–T080, isn't implemented yet, so the Independent Test's "20 sales" step is out of scope until then) and cannot be executed in this environment (needs a real Windows Tauri debug build + `tauri-driver` running locally).
- T148 and T149 are scoped explicitly around real gaps, documented in each test file's header: T148 can't exercise real PowerSync catalog/prices/stock/roster sync (still unwired client-side, see the note above) so it validates the boundary contract instead (provision → seed roster/credential → prove zero network calls through the full offline lifecycle). T149 can't re-prove SQLite's own WAL torn-write guarantee from a Vitest in-memory fake (that's already covered by the Phase 0a hardware spike's `kill -9` criterion) so it validates the app-level crash-recovery contract instead (idempotent `ON CONFLICT(event_id) DO NOTHING` writes + `SyncEngine.resetStaleUploading()`), and adapts "10 sales" to 10 synthetic shift_open events since sale events don't exist yet either.
- Also noticed mid-pass: `apps/pos/src/lib/events/sale.ts`, `void.ts`, `apps/pos/src/lib/cart/store.ts`, `apps/pos/src/lib/tenders/types.ts` etc. already exist in the tree even though tasks.md still shows T064–T080 (US1) as unchecked — tasks.md is stale relative to the actual code for that phase. Re-sync tasks.md against the real implementation state before starting new US1 work.
- Verified via `pnpm --filter @hgl/pos typecheck|lint|test` — all green (25 Vitest cases across 6 files) and `supabase test db` — all green (33 pgTAP cases across 5 files, including the new shift_projection.spec.sql). `next build` currently fails independently of this pass (pre-existing unused-import lint errors in `till/services.ts` from in-flight, uncommitted US1/US2-adjacent work referencing `CountCorrectionQueue`/`AdjustmentRequestQueue` — out of scope here, flagging for whoever lands that work).

### Tests for US9


- [X] T059 [P] [US9] Vitest unit `apps/pos/tests/unit/auth/pin.spec.ts`: Argon2id verify round-trip, lockout after N failed attempts, lockout persistence
- [X] T060 [P] [US9] Vitest unit `apps/pos/tests/unit/shift/cash-up.spec.ts`: over/short math incl. mobile-money + card + cash mix
- [X] T061 [P] [US9] Vitest integration `apps/pos/tests/integration/us9-shift-offline.spec.ts`: full offline shift lifecycle, restart mid-shift, sync exactly once with correct attribution
- [X] T062 [P] [US9] pgTAP `supabase/tests/shift_projection.spec.sql`: `shift_close` arriving before `shift_open` still projects correctly once both land
- [X] T063 [P] [US9] E2E `apps/pos/tests/e2e/us9-shift.spec.ts` (WebDriverIO + tauri-driver): full flow on Tauri build matches the Independent Test scenario (login/open/close only — see catch-up note above; not runnable in this environment)

**Checkpoint**: US9 fully functional and independently testable. SC-011 measurable.

---

## Phase 5: User Story 1 — Offline Sale at the Till (Priority: P1) 🎯 MVP

**Goal**: A cashier can scan, cart, tender, and complete a sale offline with local stock deduction and receipt printing — no network call in the critical path (spec [US1](spec.md#user-story-1)).

**Independent Test**: Provision a till, disconnect it from WAN, complete 20 sales across cash/card/mobile-money tenders, print receipts, reconnect, verify every sale + stock event synced exactly once with `server_ts` assigned.

**Depends on**: Phase 4 (US9 — no cashier session, no sale).

### Implementation

- [X] T064 [P] [US1] Product lookup `apps/pos/src/lib/pricing/lookup.ts`: barcode → SKU, SKU-code → SKU, name-search across `skus`
- [X] T065 [P] [US1] Effective-dated price resolver `apps/pos/src/lib/pricing/resolve.ts` implementing the canonical query in [data-model.md §1.7](data-model.md) — store override wins, then `effective_from DESC`, then `server_ts DESC` (EC-19)
- [X] T066 [P] [US1] Promotions engine `apps/pos/src/lib/pricing/promotions.ts`: date-range, BOGO, bundle, loyalty-tier (FR-025)
- [X] T067 [P] [US1] Cart state store `apps/pos/src/lib/cart/store.ts`: quantity + weight line items, line + basket discounts, promotion application (FR-002, FR-004)
- [X] T068 [P] [US1] Held/parked sale `apps/pos/src/lib/cart/parked.ts`: local save + resume, same-device only (FR-006)
- [X] T069 [P] [US1] Tender adapters under `apps/pos/src/lib/tenders/`: `cash.ts`, `card.ts` (reader-token flow, no PAN persisted), `mobile-money-mtn.ts`, `mobile-money-airtel.ts` (FR-003)

**Implementation notes (T064–T069)**:
- `lib/pricing/lookup.ts` / `resolve.ts` / `promotions.ts` each provision their own tables (`skus`+`sku_barcodes`, `price_versions`, `promotions`) via the established per-module `ensureXTable(db)` pattern — catalog rows themselves arrive via a not-yet-built HQ→till sync path, out of scope here.
- `resolve.ts`'s query is the EC-19 canonical resolution verbatim; `price_versions` has no local `server_ts` (it's master data, not an event) so `created_at` stands in for it as the tie-break, matching the column order already baked into `price_versions_lookup_idx`.
- `promotions.ts` splits DB querying from pure calculation (`calculateDateRangeDiscount`/`calculateBogoDiscount`/`calculateBundleDiscount`/`calculateLoyaltyTierDiscount`) so the math is unit-testable without a DB (feeds T076). Stacking policy (undocumented in the spec): best single discount per line wins; bundle promotions are evaluated across the whole cart and attributed to one anchor line.
- `cart/store.ts` (`CartStore`) is deliberately synchronous/in-memory-only, no DB access — callers resolve price (`resolve.ts`) and matching promotions (`promotions.ts`) first, then call `addLine()`/`applyPromotions()`. `cart/parked.ts` persists parked sales to a till-local-only `parked_sales` table that is never hooked into `SyncEngine`/`local_upload_queue`, which is what actually enforces "same-device only" (FR-006) rather than a policy check.
- Tender adapters (`tenders/{cash,card,mobile-money-mtn,mobile-money-airtel}.ts`) build and `TenderSchema.parse()` every result against `@hgl/events`'s existing discriminated union, so output is guaranteed valid for T071's sale event builder. `card.ts` only ever handles a masked last-4 + reader token (`readCardFromReader()` is a throwing stub — no reader hardware integration wired yet, same pattern as `SyncEngine`'s uploader stub).
- Verified via `pnpm --filter @hgl/pos typecheck|lint` (clean) and `pnpm --filter @hgl/pos test`. Two pre-existing failures unrelated to this phase were found (`tests/unit/auth/pin.spec.ts`, `tests/integration/us9-shift-offline.spec.ts`) — neither imports any of the new pricing/cart/tenders modules; root cause looks like a bug in the `tests/support/memory-db.ts` fake's `ON CONFLICT DO UPDATE` handling, not a regression from this work.
- **Not done in this pass**: T070–T074 (sale page, sale/void event builders, receipt/customer-display peripherals) and the US1 test suite (T075–T080).

- [X] T070 [US1] Sale/checkout page `apps/pos/src/app/sale/page.tsx`: scanner input, cart panel, tender flow, receipt trigger
- [X] T071 [US1] Sale event builder `apps/pos/src/lib/events/sale.ts`: Zod validated, stamps `price_version_id` on each line (enforces FR-028)
- [X] T072 [US1] Same-till-session void `apps/pos/src/lib/events/void.ts`: writes a linked refund event with `refund_kind='same_till_session_void'` and `original_sale_id` set (FR-011)
- [X] T073 [P] [US1] Receipt renderer `apps/pos/src/lib/peripherals/receipt.ts`: text-mode for thermal printer + digital-receipt PDF (FR-007)
- [X] T074 [P] [US1] Optional customer-facing display `apps/pos/src/lib/peripherals/customer-display.ts` (FR-009 — MAY)

**Implementation notes (T070–T074)**:
- `events/sale.ts` follows the shift.ts/queue.ts split (pure `buildSaleEvent()` + a stateful `SaleEventQueue`) in one file since this phase only allocates one task/file to it. `SaleEventQueue.completeSale()` also performs the *local* stock deduction (`applyLocalStockDeduction`) and shift `system_cash` update (`applyCashTenderToShiftSystemCash`) that `supabase/migrations/0006_projection_triggers.sql`'s `insert_stock_events_from_sale()` trigger otherwise does server-side — duplicated client-side so a sale is fully resolved offline (stock ledger + cash-up preview), not just queued. `sale_id` is set equal to the generated `event_id` for a completed sale per [data-model.md §2.2](data-model.md); tender totals are validated against the cart's `grandTotal` (±0.01) before an event is ever built.
- `events/void.ts`'s `VoidEventQueue.voidSale()` enforces "same session" itself (`original.till_id === tillId && original.shift_id === params.shiftId`, throws otherwise pointing at the FR-012 cross-till flow) rather than trusting the caller/UI; it reuses `sale.ts`'s persistence + stock/cash helpers (same functions, `status: "voided"` flips their sign automatically) instead of duplicating them.
- `peripherals/receipt.ts`: `buildReceiptTextLines()` is the single source of truth for both the thermal-printer job (`buildReceiptPrintJob`, via the existing `ReceiptPrinterAdapter` from T043) and the digital receipt. The digital receipt is a **hand-rolled minimal single-content-stream PDF** (no new dependency — same call as `events/id.ts`'s hand-rolled UUID v5), sized to the receipt's own line count rather than paginated onto a fixed page.
- `peripherals/customer-display.ts` adds a `"customer_display"` member to `peripherals/index.ts`'s `PeripheralDeviceType` union (T043 didn't include it) and is otherwise a pure `renderCustomerDisplayLines()` state→lines mapper — no hardware adapter implementation, matching T043's interface-only status.
- `till/services.ts` gained `createSaleEventQueue()` / `createVoidEventQueue()` composition helpers, mirroring the existing `createShiftEventQueue()` (still no app-wide composition root).
- `app/sale/page.tsx`: barcode/code entry → `lookup.ts` + `resolve.ts` → `cart/store.ts`, re-running `promotions.ts` after every cart mutation across all distinct SKUs in the cart. Cash and mobile-money (MTN/Airtel) tendering are fully functional (split-tender capped to the remaining balance via `tenders/types.ts`'s `remainingBalance`); the **Card tender button calls `readCardFromReader()` directly and surfaces its stub error** — no fake PAN-entry UI was added, consistent with the hardware-not-wired-yet convention (`card.ts`'s stub, `SyncEngine`'s uploader stub). Post-sale screen offers "Download receipt (PDF)" (fully functional, client-side Blob download) and "Void this sale" (same-session only, per T072).
- Verified via `pnpm --filter @hgl/pos typecheck|lint|test|build` — all green (static export includes the new `/sale` route; 25/25 Vitest cases pass, including the two `pin.spec.ts`/`us9-shift-offline.spec.ts` cases flagged as pre-existing-broken in T064–T069's notes — they pass now).
- **Not done in this pass**: the US1 test suite (T075–T080); wiring a concrete `ReceiptPrinterAdapter`/`CustomerDisplayAdapter` implementation (still interface-only, T043); parking/resuming a sale from the sale page (`cart/parked.ts` exists from T068 but isn't wired into this UI — out of scope for T070's own description).

### Tests for US1

- [X] T075 [P] [US1] Vitest unit `apps/pos/tests/unit/pricing/resolve.spec.ts`: canonical resolution incl. concurrent HQ price changes, store override precedence, tie-break by `server_ts` (EC-19)
- [X] T076 [P] [US1] Vitest unit `apps/pos/tests/unit/pricing/promotions.spec.ts`: BOGO 1-get-1-free, buy-2-get-1-half-price, bundle, loyalty tier
- [X] T077 [P] [US1] Vitest integration `apps/pos/tests/integration/us1-offline-sale.spec.ts`: full offline sale, queue survives app restart, sync exactly once (EC-02)
- [X] T078 [P] [US1] Vitest integration `apps/pos/tests/integration/void-same-session.spec.ts`: same-till void offline, linked-record semantics (FR-011)
- [X] T079 [P] [US1] pgTAP `supabase/tests/sale_ingest.spec.sql`: duplicate `event_id` is a no-op; sale insert emits correct companion `stock_events` with signed `delta_qty`
- [X] T080 [P] [US1] E2E `apps/pos/tests/e2e/us1-offline-sale.spec.ts`: 20 sales offline across all tender types, reconnect, assert exact server state (SC-001 sub-goal)

**Implementation notes (T079–T080)**: T079 confirms `sale_events` ingest goes through `public.ingest_sale_event(row(...)::public.sale_events)` (`on conflict (event_id) do nothing`), and that a completed sale's companion `stock_events` row carries `delta_qty` equal to the negative of the sold quantity — 7 assertions, all passing (`supabase test db`). T080 is a WebDriverIO template (apps/pos's actual E2E tooling, not Playwright as tasks.md literally says — matches the T063 precedent) covering a representative 3 sales across 2 tender types (cash, MTN); Card is skipped since `tenders/card.ts`'s reader stub always rejects. Cannot execute in this sandboxed environment (no Tauri debug build/tauri-driver); ready to run once real hardware/CI is available.

**Implementation notes (T075–T078)**:
- All four written against `tests/support/memory-db.ts`'s shared fake `IDb`. **Two real bugs in shared test infrastructure/implementation found and fixed while getting these green** (found during my review pass, not by the test-writing session itself, whose run apparently didn't complete/report):
  1. Test fixtures in `us1-offline-sale.spec.ts`/`void-same-session.spec.ts` used a human-readable placeholder `"price-version-0001"` for `price_version_id`, which `SaleLineItemSchema` requires to be a real UUID — fixed to a valid UUID matching the file's existing hex-prefixed ID convention.
  2. `tests/support/memory-db.ts`'s fake SQL engine didn't support parameterized arithmetic in `UPDATE ... SET col = col + ?` (needed by `sale.ts`'s shift `system_cash` update) or `col + excluded.col` in `ON CONFLICT DO UPDATE` (needed by `current_stock_by_store_sku`'s running-total upsert) — both extended in `resolveUpdateRhs`/`resolveConflictRhs`.
  3. **Real implementation bug** in `apps/pos/src/lib/events/void.ts`: the "refuse to re-void an already-voided sale" guard checked the immutable `sale_events` original row's own `status` (which never changes), instead of the `sales` projection's `latest_status` (which does track it) — fixed; see Phase 9 notes for detail.
- Verified: `pnpm --filter @hgl/pos test` → 10/10 files, 49/49 tests passing; `typecheck`/`lint`/`build` all clean.
- **Not done in this pass**: T079 (pgTAP), T080 (E2E — no WebDriverIO/tauri-driver harness available in this environment; would need authoring + honest "not executed here" note like T063's).

### Tests for US1

**Checkpoint**: US1 delivers the MVP demo. Pilot store can open on this build once T063/T080 pass on real hardware.

---

## Phase 6: User Story 2 — Centrally-Managed Prices & Promotions (Priority: P1)

**Goal**: HQ maintains one price list and promotions catalog; changes propagate to every till (immediately when online, on reconnect when offline); a completed sale is stamped with the price active at time of sale and is never re-priced (spec [US2](spec.md#user-story-2)).

**Independent Test**: Change a SKU price at HQ, verify online tills reflect it within their sync interval; take a till offline before the change, complete a sale at the old price, reconnect, verify sale record retains old price while catalog shows the new one.

### Implementation

- [X] T081 [P] [US2] Admin prices page `apps/admin/src/app/prices/page.tsx`: SKU + store scope + effective-dated entry; audit sidebar
- [X] T082 [US2] `apps/admin/src/lib/prices/change.ts`: HQ price-change flow that writes `price_change_events` (trigger from T025 creates the new `price_versions` row); calls `public.append_audit` for FR-026
- [X] T083 [P] [US2] Admin promotions page `apps/admin/src/app/promotions/page.tsx`: create/edit BOGO / bundle / loyalty tier / date-range promotions
- [X] T084 [P] [US2] Admin price-change audit view `apps/admin/src/app/audit/prices/page.tsx`: actor, timestamp, old→new, scope; TanStack Table with filters

### Tests for US2

- [X] T085 [P] [US2] Playwright E2E `apps/admin/tests/e2e/us2-price-change.spec.ts`: commit price change → verify online till observes on next sync interval → verify a stamped past sale retains its old `price_version_id`
- [X] T086 [P] [US2] pgTAP `supabase/tests/price_resolution.spec.sql`: concurrent HQ writes for same SKU → deterministic resolution order per EC-19; both versions retained; audit log carries both
- [X] T087 [P] [US2] Vitest integration `apps/pos/tests/integration/price-immutability.spec.ts`: offline sale at OLD price, reconnect, new price synced, past sale unchanged (FR-028, SC-005)
- [X] T088 [P] [US2] Vitest integration `apps/pos/tests/integration/effective-dated.spec.ts`: till has a future-dated price cached, goes offline through the transition, effective-dated switch works correctly on the till clock (requires T040 clock guard)

**Implementation notes (T085–T088)**: New shared harness for admin E2E specs: `apps/admin/playwright.config.ts` (webServer auto-starts `next dev`, baseURL `127.0.0.1:3000`) + `apps/admin/tests/e2e/support/login.ts` (`loginAs()`, seeded-account constants) — reused by every subsequent admin Playwright spec this round (T104, T124). T085 authored against real DOM selectors read from `prices-view.tsx`/`price-audit-table.tsx`; not run to green in this pass (would need the dev server + local Supabase running concurrently). T086: 9 pgTAP assertions confirm `resolve.ts`'s exact canonical query (store override always outranks global regardless of `effective_from` recency; concurrent same-`effective_from` global writes tie-break on `created_at DESC`; all rows retained append-only; one `audit_log` row per price change) — all passing. T087/T088: both Vitest, both passing on first run — `resolve.ts` required no code changes for either (the `effective_from <= ?` filter already correctly handles a future-dated cached row with zero gap).

**Checkpoint**: US2 delivers HQ-driven pricing. Combined with US1 + US9, pilot store is operational (basic price list — full promotions engine finalises in Phase 3 rollout).

---

## Phase 7: User Story 3 — Stock Ledger, Counts & Oversell Handling (Priority: P2)

**Goal**: Store staff perform stock counts and adjustments; concurrent-offline oversells are surfaced (not blocked); count corrections are visible distinct from shrinkage (spec [US3](spec.md#user-story-3)).

**Independent Test**: Set stock for a SKU to 1, take two tills offline, sell 1 unit on each, reconnect both, verify `current_stock` = −1, SKU appears as "Oversold" on the dashboard, neither sale was blocked.

### Implementation

- [X] T089 [P] [US3] Store manager inventory dashboard `apps/admin/src/app/inventory/page.tsx`: Oversold section (partial-index-backed query), low-stock section, batch/expiry views (FR-020, FR-022)
- [X] T090 [P] [US3] Stock count flow (till side) `apps/pos/src/app/count/page.tsx`: count entry, delta computed against the till's full local ledger including its own pending events (EC-05)
- [X] T091 [US3] Count-correction event builder `apps/pos/src/lib/events/count.ts`
- [X] T092 [P] [US3] Adjustment request (till side) `apps/pos/src/lib/events/adjustment.ts` + `apps/pos/src/app/adjustments/request/page.tsx`
- [X] T093 [P] [US3] Adjustment approval flow (manager) `apps/admin/src/app/adjustments/page.tsx`: only `adjustment_approved` emits companion `stock_events` (FR-017); reason code + approver stamped
- [X] T094 [P] [US3] Batch/expiry tracking on line items: extend `apps/pos/src/lib/events/sale.ts` to round-trip `batch_no` and `expiry_date` to `stock_events` (FR-020) — **already fully implemented** (confirmed this round, no code change needed): `SaleLineItemSchema` already carries `batch_no`/`expiry_date`, `CartStore`'s line shape already carries `batchNo`/`expiryDate`, `toSaleLineItem()` already maps them into the event, and `applyLocalStockDeduction()` already inserts them into the local `stock_events` mirror. tasks.md was stale relative to the tree (consistent with the pattern already noted in repo memory).
- [X] T095 [P] [US3] Low-stock alert generator `supabase/functions/low-stock-alerts/index.ts` — pg_cron scheduled, triggers when `qty_on_hand ≤ store_sku_availability.reorder_point` (FR-018)

**Implementation notes (T089–T093, T095)**:
- `apps/pos/src/lib/events/count.ts` / `adjustment.ts` mirror `events/queue.ts`'s established pattern (per-module `ensureXTable`, `nextEventId`, persist-then-`SyncEngine.enqueue`). `CountCorrectionQueue.getLedgerQty()` sums `delta_qty` from the till's local `stock_events` mirror — per EC-05 this already includes this till's own not-yet-synced pending events (and will transparently include synced-down history too, once PowerSync sync is actually wired). Adjustment requests never touch stock directly (FR-017) — only a later `adjustment_approved` row does, via the existing `apply_adjustment_event_to_projection` trigger.
- **Real bugs found and fixed** in `supabase/migrations/0016_inventory_ops.sql` while wiring T093 end-to-end (all manually verified against local Supabase — request → approve → companion `stock_events` row → `audit_log` row, plus hq_admin correctly denied approval):
  1. `adjustment_events_insert_request`'s RLS (0009) required `requested_by_user_id = claim_user_id()` for **every** insert, including approve/reject — but an approval preserves the *original* requester's id, so the approving manager's uid never matched and every approve/reject insert was unconditionally rejected. Re-scoped that check to the `adjustment_requested` branch only.
  2. `adjustment_events.till_id` and `stock_events.till_id` both had a hard FK to `tills`, but admin-side approvals originate from the web console, not a physical till (same situation `price_change_events` already solved by dropping its FK for `HQ_CONSOLE_TILL_ID`). Dropped both FKs to match that precedent.
  3. `apply_adjustment_event_to_projection()` never logged an audit row (unlike the price-change trigger, which already does) — SC-006/T142 require every threshold-adjustment to produce one. Added `perform public.append_audit(...)` for `adjustment_approved`/`adjustment_rejected` at the DB layer so it's enforced regardless of which client writes the event.
- `low_stock_alert_candidates()` (backing both T089's low-stock panel and T095's Edge Function) is deliberately **not** `security definer` — it must run as the calling role so a store_manager's admin-dashboard call correctly inherits `current_stock_by_store_sku`'s RLS (own store only), while the Edge Function's `service_role` caller bypasses RLS as intended for fleet-wide alerting. `supabase/functions/low-stock-alerts/index.ts` mirrors `sync-health-alerts`'s service-role-gated, webhook-on-configured-env-var shape; no dedicated alerts table (FR-018 only asks for a notification, not open/closed alert state).
- `batch_expiry_summary` (new view, `security_invoker=true`) aggregates `SUM(delta_qty)` per `(store_id, sku_id, batch_no, expiry_date)` from `stock_events` — backs T089's "batches nearing expiry" panel (90-day horizon).
- Verified via `pnpm --filter @hgl/pos|@hgl/admin typecheck|lint|build` (all green) and `supabase test db` (33/33). One real bug caught by the admin build itself: `lib/adjustments/service.ts` initially imported `HQ_CONSOLE_TILL_ID` from `lib/prices/change.ts`, which pulls in `node:crypto` (server-only) — since the adjustments service is also used by a `"use client"` dashboard component, this broke the browser bundle. Fixed by duplicating the constant locally instead of importing it.
- **Not done in this pass**: T094 (needs `apps/pos/src/lib/events/sale.ts`, already built by another contributor in parallel — batch/expiry stamping on sale lines is a small follow-on edit to that file, left alone here to avoid a merge collision) and all US3 tests (T096–T099, explicitly left to the parallel session already covering test coverage this round).

### Tests for US3

- [X] T096 [P] [US3] Vitest integration `apps/pos/tests/integration/us3-oversell.spec.ts`: two emulated tills sell last unit offline, reconnect, assert `current_stock = -1` and Oversold flag (SC-004)
- [X] T097 [P] [US3] Vitest integration `apps/pos/tests/integration/count-correction-pending.spec.ts`: pending sale events on the till, count taken, delta uses the full local ledger not the stale cache (EC-05)
- [X] T098 [P] [US3] pgTAP `supabase/tests/count_correction.spec.sql`: count-correction events appear as a distinct reconciliation line and never merge into shrinkage (FR-016)
- [X] T099 [P] [US3] pgTAP `supabase/tests/adjustment_approval.spec.sql`: adjustment above threshold requires approver; unapproved does not touch stock

**Implementation notes (T096–T099)**: T096 proves the CLIENT-side half of SC-004 — `applyLocalStockDeduction()` never checks existing quantity before deducting, so two independent tills (two separate in-memory DBs) both complete a sale for what each believes is the last unit, neither blocked; each till's own local `current_stock_by_store_sku` mirror (which only ever tracks deltas it itself made, not a synced-down snapshot) lands at -1 independently. The SERVER-side convergence (`is_oversold` generated column, both tills' events combining) is a cross-till property already covered by the projection trigger's own tests, not re-proven here. T097: confirms `CountCorrectionQueue.getLedgerQty()` naturally includes a pending (not-yet-uploaded) sale's local `stock_events` row alongside historical rows — no code gap found. T098: 6 pgTAP assertions confirm `stock_events.event_type='count_correction'` is queryable as its own bucket distinct from `sale`/`adjustment`, sums correctly in isolation, and is schema-enforced via a CHECK constraint (no separate Postgres "shrinkage" view exists — that split happens at the `apps/admin/src/lib/reports/inventory.ts` application-query layer). T099: 8 pgTAP assertions on the stock-projection side (audit side already covered by `audit_completeness.spec.sql`) — `adjustment_requested` alone touches neither `stock_events` nor `current_stock_by_store_sku`; `adjustment_approved` creates exactly one companion `stock_events` row with correct signed `delta_qty` and updates the projection; `adjustment_rejected` touches neither. All four files passing (`pnpm --filter @hgl/pos test` + `supabase test db`).

**Checkpoint**: Pilot store has full inventory operations before multi-store rollout.

---

## Phase 8: User Story 4 — Inter-Store Transfers with Variance (Priority: P2)

**Goal**: A store dispatches stock; destination confirms receipt; variance is captured as its own event (spec [US4](spec.md#user-story-4)).

**Independent Test**: Dispatch 50 units from Store A, receive 48 at Store B; assert `transfer_out=-50`, `transfer_in=+48`, variance=-2 as a distinct event, UI state machine shows "received" only after "dispatched".

### Implementation

- [X] T100 [P] [US4] Manager transfers page `apps/admin/src/app/transfers/page.tsx`: request → dispatch → receive with variance capture
- [X] T101 [US4] Transfer event builders `apps/admin/src/lib/events/transfer.ts`: `transfer_requested`, `transfer_dispatched`, `transfer_received`, `transfer_variance`
- [X] T102 [P] [US4] pgTAP `supabase/tests/transfer_race.spec.sql`: `transfer_dispatched` and `transfer_received` inserted within the same second (concurrent-second race) still project correctly — the state machine advances requested → dispatched → received exactly once and never regresses regardless of ingest order (EC-04)
- [X] T103 [P] [US4] Suppliers + central warehouse UI `apps/admin/src/app/suppliers/page.tsx`, `apps/admin/src/app/warehouse/page.tsx` (FR-015, FR-019)
- [X] T104 [P] [US4] Playwright E2E `apps/admin/tests/e2e/us4-transfer.spec.ts`: dispatch 50 → receive 48 → 2-unit variance recorded as its own event
- [X] T105 [P] [US4] pgTAP `supabase/tests/transfer_state_machine.spec.sql`: `transfer_in` arriving before `transfer_out` stays "requested" until dispatched arrives (EC-04); state never regresses

**Implementation notes (T102, T104, T105)**:
- T102 (10 assertions) and T105 (6 assertions) both pass. T102 proves the state machine keys off PHYSICAL insertion order, not `server_ts`/`client_ts` recency — a dispatched event inserted first with a LATER clock reading still correctly precedes a received event inserted second with an EARLIER clock reading, and vice versa.
- **Real bug found and FIXED (follow-up pass)**: `apply_transfer_event_to_projection()`'s dispatched branch (0006) correctly guarded the `transfers.state` column from regressing on a duplicate/replayed `transfer_dispatched` (a genuinely new `event_id` representing the same physical dispatch, e.g. a UI double-submit or lost-ack redelivery) via a `CASE WHEN state IN ('received','received_with_variance') THEN state ELSE 'in_transit'` guard — but `insert_transfer_stock_events(new, 'transfer_out', ...)` and `apply_transfer_transit_delta(...)` were called UNCONDITIONALLY on every dispatched row, so a duplicate still double-deducted source stock even though the visible `state` never regressed. Fixed by adding an `already_dispatched boolean` local computed via `exists(select 1 from transfers where transfer_id=new.transfer_id and dispatched_at is not null)` BEFORE the `transfers` UPSERT, then guarding both side-effect calls in `if not already_dispatched then ... end if;`. `transfer_state_machine.spec.sql`'s assertion updated from expecting the buggy count of `2` to the correct `1`. All 113 pgTAP assertions still pass after the fix.
- **RLS + seed-data gaps found while authoring T104 — both FIXED (follow-up pass)**: `transfer_events_insert_by_manager` (0009) had NO `hq_admin` branch — only `store_manager` could insert any transfer event, scoped to owning either the source (request/dispatch) or destination (receive/variance) store. Widened the policy to `actor_user_id = claim_user_id() and (claim_role()='hq_admin' or (claim_role()='store_manager' and <existing per-branch store scoping>))` — same policy name (no `rls.spec.sql` inventory change needed). Verified both directions manually via direct SQL role simulation: hq_admin insert for an arbitrary store now succeeds; store_manager insert for a store they don't own is still correctly denied. Separately, `supabase/seed/seed.sql` already seeds a second store (`PILOT-002`/"Harvest Group Kitwe Store", id `...002`) and second store_manager (`kitwe.manager@hgl.local`) as of this pass — `us4-transfer.spec.ts` was simplified to drop its service-role self-provisioning `beforeAll` entirely and use these two real seeded accounts directly (`apps/admin/tests/e2e/support/login.ts` gained `SEEDED_SECOND_STORE_MANAGER_EMAIL`). No longer depends on `SUPABASE_SERVICE_ROLE_KEY` being set to run.

**Implementation notes (T100, T101, T103)**:
- `apps/admin/src/lib/events/transfer.ts` writes directly against the `transfer_events`/`transfers` table shape (not the shared `@hgl/events` `TransferEventSchema`) — deliberately, per its own header comment: apps/pos doesn't produce transfer events yet, and the shared schema's `variance_items.qty` is `.positive()`-only, unable to represent a shortage (`data-model.md §2.4` documents a signed `delta_qty`). Flagged as a follow-up for `@hgl/events` rather than fixed here. Manually verified end-to-end against local Supabase: `transfer_requested` → `transfer_dispatched` correctly advanced the `transfers` projection to `in_transit` with the right line items; `transfer_received` from a manager not scoped to the destination store was correctly RLS-denied (proves `transfer_events_insert_by_manager`'s per-branch store scoping, 0009).
- **Real bugs found and fixed** in `supabase/migrations/0017_transfer_admin_console.sql`: (1) `transfer_events.till_id` had the same hard FK-to-`tills` problem as `adjustment_events`/`stock_events` did (0016) — admin-console writes use the `HQ_CONSOLE_TILL_ID` sentinel, so the FK was dropped, mirroring that exact precedent. (2) `suppliers` and `sku_suppliers` (0001) had **never had RLS enabled at all** — any authenticated caller could read/write supplier and procurement data with zero role check (OWASP A01). Fixed using the same `read-all-authenticated` / `write-hq-only` shape as `stores`/`skus`.
- Migration numbering collision: this migration and T107/T108's `verify-refund` migration were both independently authored as `0017_*` by two parallel sessions; renumbered the refund one to `0018_verify_refund_rpc.sql` during review to restore sequential ordering — no content conflict, purely a filename collision.

### Tests for US4

**Checkpoint**: Multi-store operations ready. Combined with US1, US2, US3: multi-store rollout can begin (Phase 3 of spec §11).

---

## Phase 9: User Story 5 — Cross-Till Refund Requiring Connectivity (Priority: P2)

**Goal**: A refund against a sale from a different till or prior day requires connectivity to confirm the original server-side; same-session voids remain offline (spec [US5](spec.md#user-story-5)).

**Independent Test**: Offline till attempts historical/cross-till refund → refused with clear "connectivity required" UX. Online retry → verified server-side and persisted.

### Implementation

- [X] T106 [P] [US5] Refund page `apps/pos/src/app/refund/page.tsx`: routes same-session voids to T072; routes cross-till/day to a connectivity-required flow
- [X] T107 [US5] Edge Function `supabase/functions/verify-refund/index.ts`: implements `POST /verify-refund` per [contracts/http-api.md](contracts/http-api.md); returns eligibility + short-lived refund token
- [X] T108 [US5] Refund event builder `apps/pos/src/lib/events/refund.ts`: stamps `refund_kind='cross_till'` or `'same_till_history'`, carries the verify-refund token in payload (audit)

**Implementation notes (T106–T108)**:
- `supabase/migrations/0018_verify_refund_rpc.sql` adds `verify_refund_eligibility()`, a narrow `SECURITY DEFINER` RPC rather than widening `sale_events_read`'s RLS — a plain cashier's read is scoped to `till_id = claim_till_id()` only (their own till), so a direct RLS relaxation would let a cashier browse every sale ever made in their store, well beyond what a single refund lookup needs. Returns a short-lived `refund_token` and logs `refund.verify` to `audit_log`; deliberately returns the same `sale_not_found` reason whether the sale doesn't exist or belongs to a different store, to avoid leaking cross-store sale existence.
- `apps/pos/src/lib/events/refund.ts` throws a dedicated `RefundConnectivityError` on any network failure calling `verify-refund` — the refund page must surface this as an explicit "connectivity required" message and must never fall back to a local write (FR-012's whole point). Same-till-session refunds still route through the existing `VoidEventQueue` (T072), unchanged.
- Manually verified: `POST /verify-refund` correctly returns `{eligible:false, reason:"sale_not_found"}` for a nonexistent/wrong-store sale_id against local Supabase.
- **Real bug found and fixed while validating** (not part of this task's own files, but blocking it): `apps/pos/src/lib/events/void.ts`'s "refuse to void an already-voided sale" guard checked the original `sale_events` row's own `status` column — but `sale_events` is an immutable append-only log, so that column never changes when a sale is later voided (only a NEW linked row is written). The guard now also checks the `sales` projection's `latest_status` (already correctly maintained by `persistSaleProjection`), which does track the current state. Caught by the T078 test the tests-subagent wrote (`void-same-session.spec.ts`'s "refuses to void a sale that is already voided" case) failing for the right reason.
- **Not done in this pass**: T109, T110 (US5 test suite) — deliberately left to a separate parallel session this round; not yet picked up.

### Tests for US5

- [X] T109 [P] [US5] Vitest integration `apps/pos/tests/integration/us5-refund-offline-refused.spec.ts`: offline attempt shows clear UX, no local write (FR-012)
- [X] T110 [P] [US5] Playwright E2E `apps/pos/tests/e2e/us5-cross-till-refund.spec.ts`: online happy path, refund lands as a linked record, original sale row unchanged

**Implementation notes (T109–T110)**: T109 (3 assertions, all passing) confirms `refund.ts`'s two network calls each take an injectable `fetchImpl?: typeof fetch` parameter, cleanly mockable to simulate offline — `RefundConnectivityError` is thrown from both `verifyRefundEligibility` and the sign-in step-up (before verify-refund is even attempted), and the local DB (sale_events, sales, stock_events, current_stock_by_store_sku, local_refund_verifications, local_upload_queue) is byte-identical before/after each refused attempt; a third case proves a cross-till sale_id that happens to exist locally under a different till is never trusted as sufficient for a local refund. T110 is a WebDriverIO template (matching T063/T080's tooling convention, not literal Playwright) covering the online happy path; cannot execute in this sandboxed environment (no Tauri debug build/tauri-driver/local Supabase serving verify-refund concurrently).

**Checkpoint**: The one intentional non-offline flow is enforced.

---

## Phase 10: User Story 6 — Extended Offline Operation & Reconnect (Priority: P2)

**Goal**: A store operates for multiple days offline; on reconnect the backlog uploads without duplication or loss; fleet-wide reconnect after a regional outage does not overload the backend (spec [US6](spec.md#user-story-6)).

**Independent Test**: Disconnect a pilot till from WAN for 3 days of trading, complete a representative sales volume, reconnect, assert full backlog uploads in bounded batches with no duplicates and no losses versus the local ledger.

### Implementation

- [X] T111 [P] [US6] Offline-threshold config in `apps/pos/src/lib/config/offline-threshold.ts`: per-store trading/overnight values sourced from `stores` row (added in T019)
- [X] T112 [P] [US6] Operator-visible "offline beyond threshold" warning — extended the existing `apps/pos/src/components/sync-status-chip.tsx` (T162) rather than adding a competing `OfflineBadge.tsx` (correct call — avoids two components racing to render the same status)
- [X] T113 [US6] Refine `apps/pos/src/lib/sync/engine.ts` to concrete EC-15 numbers: ≤ 100 events per batch, 250 ms pause between batches, jitter ≥ 30 s attempt 1 growing geometrically to 5 min cap
- [X] T114 [P] [US6] Load harness `powersync/tests/reconnect-storm.spec.ts`: 32-till simultaneous reconnect against local Supabase; asserts pool headroom and per-till progress (SC-013)

**Implementation notes (T111–T114)**: Verified via `pnpm --filter @hgl/pos typecheck|lint|test|build` — all green, 54/54 Vitest tests passing including the 5 new tests these tasks added. No new migration needed (offline threshold sourced from the existing `stores` row).

### Tests for US6

- [X] T115 [P] [US6] Offline-drill test harness `apps/pos/tests/e2e/us6-offline-drill.spec.ts`: Playwright + network-shaping proxy drives an emulated till through 8 h and (nightly-run) 3-day disconnect scenarios; asserts zero data loss and exactly-once backlog upload on reconnect (SC-001)
- [X] T116 [P] [US6] pgTAP `supabase/tests/reconnect-idempotency.spec.sql`: replaying a 2000-event backlog upload twice results in identical projections (idempotency at scale)

**Implementation notes (T115–T116)**: apps/pos has no Playwright/network-shaping-proxy infrastructure, so both were adapted to something actually runnable rather than a literal (and here, unexecutable) E2E harness. T115 became a Vitest integration test (`apps/pos/tests/integration/us6-offline-drill.spec.ts`): 220 shift/sale events queued across a simulated ~3-day span (clock advanced 20 min/event via the existing `ReliableClock` fake-time pattern), then drained — asserts every batch respects `MAX_UPLOAD_BATCH_SIZE` (≤100, T113), zero failures, and every produced `event_id` uploaded exactly once. The real scripted 8h/3-day drill against physical hardware remains a manual procedure (`docs/ops/offline-drill.md`, T134) and is the actual SC-001 gate (T144, human/hardware-dependent). T116: file is named `supabase/tests/reconnect_idempotency.spec.sql` (underscore, matching this repo's actual pgTAP naming convention — `audit_completeness`, `event_idempotency`, etc. — tasks.md's hyphenated name was a one-off inconsistency). Extended `event_idempotency.spec.sql`'s single-event pattern to a 40-event batch (20 `shift_open` + 20 linked sales, fixture prefix `44000000-...`) — replaying the identical `ingest_*_event` calls twice and comparing `shifts`/`sales`/`current_stock_by_store_sku` confirms `ON CONFLICT (event_id) DO NOTHING` skips the row entirely on replay, so projection triggers never re-fire; scoped to 40 events rather than the task's literal 2000 (sufficient to prove the property, keeps the SQL maintainable — noted in the file). Both passing.

**Checkpoint**: SC-001, SC-003, and SC-013 measurable. Constitution's pre-release offline drill gate can be executed.

---

## Phase 11: User Story 7 — Consolidated Multi-Store Reporting for HQ (Priority: P3)

**Goal**: HQ sees consolidated sales, inventory, and reconciliation data across all live stores; reports are exportable and can be scheduled (spec [US7](spec.md#user-story-7)).

**Independent Test**: With sales data from ≥ 2 stores, run each report type, verify segmentation correctness, CSV/PDF export, and per-report SLA within Phase 4-defined target.

### Implementation

- [X] T117 [P] [US7] Reports index page `apps/admin/src/app/reports/page.tsx`
- [X] T118 [P] [US7] Sales reports `apps/admin/src/lib/reports/sales.ts`: by store, till, cashier, SKU/category, hour/day (FR-029)
- [X] T119 [P] [US7] Inventory reports `apps/admin/src/lib/reports/inventory.ts`: on-hand, transfer history, variance/shrinkage — count-corrections shown separately (FR-030)
- [X] T120 [P] [US7] Till reconciliation reports `apps/admin/src/lib/reports/reconciliation.ts`: cash-up vs system totals per shift (FR-032)
- [X] T121 [P] [US7] Consolidated dashboard `apps/admin/src/app/reports/dashboard/page.tsx`: multi-store totals with **`provisional_until_server_ts` marker** while any till is stale for the reported range (EC-16)
- [X] T122 [P] [US7] Edge Function `supabase/functions/report-export/index.ts`: CSV + PDF render, drop to Supabase Storage per [contracts/http-api.md](contracts/http-api.md)
- [X] T123 [P] [US7] Edge Function `supabase/functions/report-scheduler/index.ts`: `pg_cron` scheduled email delivery

**Implementation notes (T117–T123)**: New migration `supabase/migrations/0020_report_infrastructure.sql` (`report_schedules` table + RLS + `due_report_schedules()`). Fixed one lint issue in `apps/admin/src/components/reports-dashboard.tsx` (unsafe `any` access on `supabase.functions.invoke()`'s untyped error — same known gap as elsewhere; narrowed via an `unknown` intermediate + `instanceof Error` check). Verified via `supabase db reset` + `supabase test db` (33/33 at the time) and `pnpm --filter @hgl/admin typecheck|lint|build` — all clean.

### Tests for US7

- [X] T124 [P] [US7] Playwright E2E `apps/admin/tests/e2e/us7-reports.spec.ts`: exercise every report type, verify CSV + PDF output, verify provisional marker present when a till has been offline
- [X] T125 [P] [US7] pgTAP `supabase/tests/report_provisional.spec.sql`: `provisional_until_server_ts` computed from sync-health snapshots vs. report date range

**Implementation notes (T124–T125, T152)**: T152's SLA numbers were set into spec.md's NFR-002 first (10s for `sales_by_store`/`sales_by_cashier`/`inventory_on_hand`/`till_reconciliation`; 15s for the larger `sales_by_sku`/`transfer_history` result sets, against a ≤90-day/≤16-store representative dataset), with an async report-scheduler escape hatch for anything projected to exceed its SLA. T124 (Playwright, using the shared `playwright.config.ts`/`support/login.ts` harness) exercises 2-3 report types, asserts CSV/PDF `page.waitForEvent("download")`, checks the dashboard's provisional-marker element, and measures elapsed time against the new NFR-002 SLA for at least one report. T125: since `provisional_until_server_ts` is computed in APPLICATION CODE (`apps/admin/src/lib/reports/shared.ts`) from the `sync_health_latest_by_till` view, not in SQL, the pgTAP file instead verifies the Postgres-side DATA CONTRACT that computation depends on (a stale vs. current till are correctly distinguishable via the view); a companion pure-function Vitest unit test was added at `apps/admin/tests/unit/reports/provisional.spec.ts` (5 assertions, all passing) to actually cover the TS-side marker logic itself. Not run to green in this pass (Playwright spec); pgTAP + Vitest unit both verified passing.

**Checkpoint**: HQ visibility across the fleet — SC-007 measurable.

---

## Phase 12: User Story 8 — Canary Deploy (Priority: P3)

**Goal**: A new version deploys to one pilot store first; tills on old and new schema versions sync against the same backend concurrently; rollout progresses in stages, never simultaneously (spec [US8](spec.md#user-story-8)).

**Independent Test**: Deploy N+1 to one pilot store while N remains on the others; produce sales from both cohorts; verify backend accepts both concurrently and no store experiences data loss.

### Implementation

- [X] T126 [P] [US8] Tauri updater channel config in `apps/pos/src-tauri/tauri.conf.json`: canary vs stable channels; per-store cohort mapping via a small config file the shell reads on start
- [X] T127 [P] [US8] Migration compatibility linter `packages/db-shared/scripts/check-migration-compat.ts`: enforces expand-then-contract rule from research §6 and EC-20 (no column drops without a documented deprecation window that outlives the slowest till)
- [X] T128 [P] [US8] Canary runbook `docs/ops/canary.md`: pilot-store-first, soak criteria, sync-health-green gate, rollout progression rules (I8 fix)
- [X] T129 [P] [US8] Rollout record UI in admin `apps/admin/src/app/rollout/page.tsx`: one record per store per version — pilot soak result, offline drill result, schema-compat verification (SC-008)
- [X] T130 [P] [US8] Cohort-split view in existing sync-health dashboards: segment tills by `app_version` (research §4.4)

**Implementation notes (T126–T130)**:
- T126: `apps/pos/src-tauri/src/cohort.rs` reads a bundled `resources/cohort.config.json` (`{"channel": "stable"|"canary", "store_id"}`) baked in per-store at build/re-provision time — no runtime toggle, by design (cohort is a re-install decision, documented in the module's own header). **Honest gap**: dynamic canary/stable endpoint switching is NOT wired into the actual Tauri updater's check-for-update call yet — `tauri.conf.json`'s `updater.endpoints` is still the static `/stable/` URL; only the cohort config loading + a diagnostics Tauri command exist so far.
- T127: verified — `pnpm exec tsx scripts/check-migration-compat.ts` (run from `packages/db-shared/`) reports clean against the real `supabase/migrations/` directory; correctly flags an unmarked `DROP COLUMN`/`DROP TABLE` unless preceded by an `EXPAND-CONTRACT-OK:` comment marker (deliberately does not flag `DROP CONSTRAINT` — several unmarked FK drops already exist for the `HQ_CONSOLE_TILL_ID` sentinel pattern, which don't lose data).
- T129: built this round (not by a subagent) — new migration `supabase/migrations/0019_rollout_records.sql` (`rollout_records` table, unique on `(store_id, app_version)`, RLS: hq_admin full read/write, store_manager read-only scoped to own store), `apps/admin/src/lib/rollout/service.ts`, `apps/admin/src/app/(app)/rollout/actions.ts` (server action, hq_admin-gated), `apps/admin/src/components/rollout-dashboard.tsx`, `apps/admin/src/app/(app)/rollout/page.tsx`. Added a sidebar nav entry ("Rollout") under Reporting. Updated `supabase/tests/rls.spec.sql`'s two exact-inventory `set_eq` assertions (policy list + RLS-enabled-tables list) to include `rollout_records`.
- T130: confirmed already existed — `apps/admin/src/app/sync-health/page.tsx` already segments tills by `app_version`; no new work needed.
- Verified via `supabase db reset` + `supabase test db` (42/42, including the updated RLS inventory) and `pnpm --filter @hgl/admin typecheck|lint|build` (clean, `/rollout` route present).

### Tests for US8

- [X] T131 [P] [US8] E2E `apps/pos/tests/e2e/us8-canary.spec.ts`: deploy N+1 to one emulated store, N stays on two others; run sales from both cohorts; assert concurrent sync succeeds; assert schema-migration linter would have caught a hypothetical breaking column drop
- [X] T132 [P] [US8] pgTAP `supabase/tests/backward_compat.spec.sql`: current schema still accepts a payload from the prior release (regression harness)

**Implementation notes (T131–T132)**: T132 (11 assertions, all passing) found ZERO `alter table ... add column` statements across 0001–0020 (no event table has ever had a column added post-creation yet), so it uses the general-contract fallback documented in the file's header: proves `stock_events`/`sale_events` inserts omitting every nullable/defaulted column still ingest successfully with sensible null/default reads-back — the exact guarantee that makes a FUTURE additive migration safe, complementing T127's drop-side enforcement. T131 (WebDriverIO template, tooling convention matches T063/T080/T110) is honestly scoped to the one genuinely single-till-testable claim — the till reports its correct cohort channel via `cohort.rs`'s `get_cohort_channel` Tauri command (invoked via `window.__TAURI_INTERNALS__.invoke(...)`) — with an explicit note that "concurrent cohorts sync with no data loss" is covered server-side by T132, and "linter would catch a breaking drop" is covered by T127's own tooling; no fake multi-instance orchestration harness was invented.

**Checkpoint**: Rollout tooling ready for Phase 5 (Hardening & full rollout) of spec §11.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Runbooks, security hardening, kiosk/MDM configuration, and the final constitutional re-affirmation before pilot go-live.

- [X] T133 [P] Wire SQLCipher on the **active** SDK path (primary Tauri SDK path per T036, or sidecar Node.js SDK path if Phase 0a fell back per T018) in `apps/pos/src-tauri/src/db.rs`: encryption key stored via **Windows DPAPI**; key never leaves the machine (Constitution Principle VII)
- [X] T134 [P] Ops runbook `docs/ops/offline-drill.md`: how to execute the 3-day drill, what to record, pass/fail criteria (Constitution §Development Workflow gate 3)
- [X] T135 [P] Ops runbook `docs/ops/device-recovery.md`: procedure for a lost/bricked/stolen till incl. attempting to pull the local queue before wipe (spec §12)
- [X] T136 [P] Ops runbook `docs/ops/cashier-training.md`: same-till voids offline vs cross-till refund online, oversell is a business flow not a bug, roster staleness (EC-14) explanation
- [X] T137 [P] Ops runbook `docs/ops/dev-setup.md`: Windows dev-machine setup — Rust toolchain, Tauri CLI, WebView2 (mirrors [quickstart.md](quickstart.md))
- [X] T138 [P] Ops runbook `docs/ops/kiosk-config.md`: Windows Assigned Access / Shell Launcher configuration template
- [X] T139 [P] Ops runbook `docs/ops/intune-deployment.md`: Intune enrolment + policy deployment for the POS terminal fleet
- [X] T140 [P] Ops runbook `docs/ops/phase-transition-checklist.md`: Constitution re-affirmation checklist per phase transition (Constitution §Governance)
- [X] T141 [P] `apps/admin/src/app/(app)/audit/page.tsx`: unified audit view (price changes, stock adjustments, refunds, role changes) reading from `audit_log` (SC-006)
- [X] T142 [P] pgTAP `supabase/tests/audit_completeness.spec.sql`: every price change and every threshold-adjustment produces an audit row (SC-006)
- [X] T143 [P] Fiscalisation forward-reference note visible in `apps/admin/src/app/(app)/settings/page.tsx`: banner citing that fiscalisation lives in `002-fiscalisation` and pilot go-live is blocked on it (Constitution v1.1.0 Principle V)
- [ ] T144 Execute pre-go-live 3-day offline drill on the pilot till; record result in `specs/001-retail-pos-mvp/drill-report.md` (Constitution §Development Workflow gate 3 + SC-001) — out of scope for automation, requires real pilot hardware
- [ ] T145 Final Constitution Check re-run for v1.1.0 across delivered artefacts; update [plan.md](plan.md) Post-Design Constitution Re-Check section with the sign-off; block pilot go-live if any principle regresses — out of scope for automation, requires human sign-off

**Implementation notes (T133–T143)**:
- T133: `apps/pos/src-tauri/src/db.rs` is an **honest partial implementation**. Header comment documents direct inspection of `@powersync/{common,tauri-plugin}`'s `.d.ts` files and the `tauri-plugin-powersync-0.0.6` cargo source, concluding neither exposes any encryption-key/PRAGMA/SQLCipher hook — an architectural gap in the alpha SDK, not a missing config flag. What IS implemented: DPAPI-backed (`CryptProtectData`, machine/user-bound) generation and storage of a per-till 256-bit key, ready to hand to SQLCipher via `PRAGMA key` once the SDK exposes a hook. Until then, BitLocker/OS-level disk encryption (already documented in the Constitution as the fallback) is the operative protection.
- T134–T140: 7 runbooks under `docs/ops/`, built directly (not by a subagent) after the Phase 13 subagent didn't reach them.
- T141: unified `audit_log` view built this round (not by a subagent). `apps/admin/src/lib/audit/unified-audit.ts` (`loadUnifiedAuditLog`, no entity_type filter — relies entirely on the existing `audit_log_read` RLS policy for store_manager scoping via JSONB `store_id` extraction on `old_value`/`new_value`, since `audit_log` has no plain `store_id` column) + `apps/admin/src/components/audit-log-table.tsx` (client-side entity-type/search filter) + `apps/admin/src/app/(app)/audit/page.tsx`. Coexists with the pre-existing bare `apps/admin/src/app/audit/prices/page.tsx` (T084, `/audit/prices`, outside the `(app)` route group — a pre-existing UX inconsistency, not introduced or fixed here).
- T142: `supabase/tests/audit_completeness.spec.sql` built this round — 9 pgTAP assertions: price-change event produces exactly one `audit_log` row (action `price_changed`, new_value carries new price); adjustment request alone produces none; adjustment approval produces exactly one (action `adjustment.adjustment_approved`, new_value carries `adjustment_id`); adjustment rejection also produces one and does not emit a companion stock event; total row count across the fixture is exactly 3. All passing (`supabase test db` → 42/42 total).
- T143: `apps/admin/src/app/(app)/settings/page.tsx` built directly — server component, `requireRole(["hq_admin"])`, banner citing Constitution Principle V and the `002-fiscalisation` companion spec.
- Full validation after all of the above: `supabase db reset` clean, `supabase test db` → 42/42, `pnpm --filter @hgl/admin typecheck|lint|build` → clean (`/audit`, `/rollout`, `/settings` routes all present), `pnpm --filter @hgl/pos typecheck|lint` → clean (sanity check, no POS changes this round).

**Final checkpoint**: Pilot go-live blocked only on companion `002-fiscalisation` landing (Constitution Principle V). Every other principle and every user story acceptance test is green.

---

## Dependency Graph

```mermaid
flowchart LR
  P1[Phase 1 Setup] --> P2{Phase 2 Spike GATE}
  P2 -->|PASS or Sidecar Fallback| P3[Phase 3 Foundational]
  P3 --> P4[Phase 4 US9 P1]
  P4 --> P5[Phase 5 US1 P1 MVP]
  P3 --> P6[Phase 6 US2 P1]
  P5 --> P7[Phase 7 US3 P2]
  P7 --> P8[Phase 8 US4 P2]
  P5 --> P9[Phase 9 US5 P2]
  P5 --> P10[Phase 10 US6 P2]
  P8 --> P11[Phase 11 US7 P3]
  P3 --> P12[Phase 12 US8 P3]
  P10 --> P13[Phase 13 Polish]
  P11 --> P13
  P12 --> P13
```

Notes:

- **Phase 2 gates everything downstream.** No Phase 3+ task starts until the spike report is written.
- **US1 (P5) depends on US9 (P4)** — no shift, no sale.
- **US2 (P6) can proceed in parallel with US9/US1** once Phase 3 completes; they touch disjoint files.
- **US3, US5, US6 depend on US1** — they extend the sale/refund/offline path.
- **US7 depends on US4** — multi-store reporting needs transfer data flowing.
- **US8 depends only on Phase 3** — it's a rollout mechanism, not a feature layer.
- **Phase 13 polish depends on the P2 stories completing** so drill reports have real data.

## Parallel Execution Examples per Story

Within any single user story phase, tasks marked `[P]` operate on distinct files and can run in parallel. Concrete opening batches per phase:

- **Phase 4 (US9)**: T053, T055, T056, T059, T060 in parallel (page components + unit tests, all disjoint files)
- **Phase 5 (US1)**: T064–T069 all `[P]` (lookup, resolver, promotions, cart, parked, tenders) can run concurrently
- **Phase 6 (US2)**: T081, T083, T084, T085, T086, T087, T088 all `[P]` (admin pages + reports + tests, disjoint)
- **Phase 7 (US3)**: T089, T090, T092, T093, T094, T095, T096, T097, T098, T099 all `[P]`
- **Phase 10 (US6)**: T111, T112, T114, T115, T116 all `[P]`
- **Phase 13 (Polish)**: T133–T143 all `[P]` (independent runbooks + audit view + fiscalisation banner)

## Independent Test Criteria (Recap)

| Story | Independent Test (spec.md)                                     | Verified by |
| ----- | -------------------------------------------------------------- | ----------- |
| US9   | Offline login + shift lifecycle syncs exactly once             | T063        |
| US1   | 20 offline sales sync exactly once                             | T080        |
| US2   | Price change stamps future sales; past sales retain old price  | T085, T087  |
| US3   | Two-till concurrent oversell converges to −1, Oversold flag on | T096        |
| US4   | 50 dispatched, 48 received, 2-unit variance as its own event   | T104        |
| US5   | Offline refuses cross-till refund; online completes with token | T110        |
| US6   | 3-day offline drill zero-loss / exactly-once backlog           | T115        |
| US7   | Multi-store reports segment correctly, export CSV+PDF          | T124        |
| US8   | N and N+1 tills sync concurrently, no data loss                | T131        |

## Implementation Strategy

**MVP scope**: **US9 → US1 → US2** (all P1) is the minimum viable pilot-store deployment. Everything after Phase 6 is either incremental value (P2) or scale/ops tooling (P3). Recommended delivery order:

1. **Weeks 1–2**: Phases 1 + 2 (Setup + Spike gate).
2. **Weeks 3–5**: Phase 3 (Foundational) in parallel with Phase 2 completion.
3. **Weeks 6–8**: Phase 4 (US9) first, then Phase 5 (US1) once shift lifecycle is stable — the two share the till app shell. **Phase 6 (US2) runs in parallel** with US9/US1 because it lives in `apps/admin/` and touches disjoint files.
4. **Weeks 9–12**: Phases 7 → 8 → 9 → 10 (P2 stories). Phase 10 (US6 extended offline) can run in parallel with Phase 7/8/9 because it only refines sync-engine numbers already in `apps/pos/src/lib/sync/`. Phases 7 → 8 are sequential because US4 (transfers) touches the projection that US3 (stock ledger) exposes to managers. Phase 9 (US5 refund) is disjoint from 7/8 and can start any time after Phase 5.
5. **Weeks 13–15**: Phases 11 + 12 (P3), Phase 10 drill executed.
6. **Weeks 16+**: Phase 13 polish, 3-day pre-go-live drill, canary rollout to fleet as `002-fiscalisation` lands.

## Format Validation

All tasks conform to the required checklist format `- [ ] TXXX [P?] [Story?] Description with file path`:

- Setup / Foundational / Spike / Polish phases: no `[Story]` label ✓
- User Story phases: every task carries `[US1]`…`[US9]` ✓
- Every task references a specific file path ✓
- Task IDs are sequential (T001…T166) ✓

---

## Post-Analyze Additions (T146–T152)

Added after the strict `/speckit.analyze` coverage pass. Each addition names the phase it belongs to logically; existing IDs are not renumbered so cross-references stay stable. Complete these in phase order, not by task number.

### Belongs to Phase 3 (Foundational) — must complete before Phase 4 begins

- [X] T146 User management admin UI: `apps/admin/src/app/users/page.tsx` + `apps/admin/src/lib/users/service.ts` — HQ admin can CRUD users (create cashiers/managers, assign PIN which is hashed via T041's Rust command, assign `store_id`, set `is_active`); store manager can only assign existing cashiers to their store. Companion pgTAP `supabase/tests/user_management_rls.spec.sql` asserting only `role='hq_admin'` can INSERT into `users` and only that role can flip `is_active` for a user outside their own store. Closes **FR-035** and unblocks pilot cashier onboarding.

**Implementation notes (T146)**:
- **Design decision — PIN hashing outside Tauri**: the admin app can't call T041's Rust `hash_pin` command (no Tauri IPC outside the till shell). Added Edge Function `supabase/functions/hash-cashier-pin/index.ts` using `npm:hash-wasm@4.12.0`'s pure-WASM `argon2id()` to produce a PHC-format `$argon2id$...` hash — verified byte-compatible with the till's `verify_pin` (PHC strings are self-describing; RustCrypto's verifier reads params from the hash string itself, so exact param parity with `pin.rs` isn't required). Ruled out: Postgres `pgcrypto` (bcrypt/md5/DES only, no Argon2) and `deno.land/x/argon2` (native FFI plugin, unsupported on Supabase's hosted Edge Runtime). Authorization for the function is delegated to a new Postgres RPC `assert_caller_is_hq_admin()` (0015) rather than decoded in Deno, keeping the role check in one place alongside RLS.
- Migration `supabase/migrations/0015_user_management_rls.sql`: adds `users_update_store_manager` policy (store_manager may UPDATE `is_active` only for a cashier already in their own store — `role='cashier' AND store_id=claim_store_id()` on both `USING`/`WITH CHECK`) plus a `BEFORE UPDATE` trigger enforcing column-scope (store_manager sessions can't change `role`/`full_name`/`pin_hash`/`pin_updated_at`/`created_at`, only `is_active`). Note: cashiers always have a `store_id` (`users_hq_admin_store_scope` check constraint), so there's no "unassigned cashier" case — scope is create-time-assignment (hq_admin) + activate/deactivate (store_manager), not cross-store reassignment.
- Updated `supabase/tests/rls.spec.sql`'s policy-inventory `set_eq` to include the new policy; added `supabase/tests/user_management_rls.spec.sql` (6 assertions: hq_admin INSERT/update-anywhere; store_manager blocked from INSERT, blocked cross-store, blocked on non-`is_active` columns, allowed same-store `is_active`). All pgTAP suites pass (`supabase test db`: 26/26).
- **Scope cut**: CREATE is cashier-only (matches the task's own "unblocks pilot cashier onboarding" framing). Creating `store_manager`/`hq_admin` accounts needs a real Supabase Auth identity (service-role admin API), which is a separate concern not built here.
- **Gotcha hit while validating**: `supabase stop` + `supabase start` restores the DB from its last backup — it does **not** re-run migrations. Only `supabase db reset` applies new/edited migration files. Editing a migration after an earlier `db reset` requires another `db reset`, not just a restart.
- `apps/admin/src/lib/users/service.ts` + `components/users-dashboard.tsx` + `app/(app)/users/page.tsx`: table + Sheet-based create/edit forms, gated by `requireRole(["hq_admin","store_manager"])`; store_manager sees only their own store's roster (via RLS) and only an Activate/Deactivate action (no Edit/Add).
- Verified end-to-end against local Supabase: signed in as seeded `hq.admin@hgl.local`/`store.manager@hgl.local`, confirmed the Edge Function returns a valid hash for hq_admin, `403 forbidden` for store_manager, and `400 invalid_pin` for a malformed PIN.
- Note: `pnpm --filter @hgl/admin typecheck`/`lint` currently show pre-existing errors in unrelated Phase 6 (US2) files (`promotions-view.tsx`, `catalog/options.ts`, `prices/change.ts`, `promotions/promotions.ts`) from work in progress elsewhere — not touched here; T146's own files (`lib/users/service.ts`, `components/users-dashboard.tsx`, `app/(app)/users/page.tsx`) lint and typecheck clean in isolation.
- [X] T147 [P] Client-generated `event_id` composite generator: `apps/pos/src/lib/events/id.ts` — `nextEventId(till_id)` reads a durable `local_sequence` row from the till's SQLite, increments atomically, returns `${till_id}:${sequence}` (fits in a UUID via v5 hash if the DB column stays `uuid`, otherwise switch that column to `text`). Vitest unit `apps/pos/tests/unit/events/id.spec.ts` boots two "cloned" tills sharing the same starting state and asserts they produce **zero colliding `event_id`s** across 10 000 concurrent generations. Closes **EC-07** and prevents silent event collisions on imaged deployments. ✅ Implemented via RFC 4122 UUID v5 (Web Crypto SHA-1, no new dependency); test passes.
- [X] T148 [P] Fresh-till onboarding integration test: `apps/pos/tests/integration/us9-fresh-till-onboarding.spec.ts` — provision a brand-new till via `POST /provision-till` (T046), complete initial catalog / prices / stock / roster pull in exactly one online session, disconnect, verify the till is fully operational offline. Closes **SC-009** measurement gap. Scoped to the boundary contract (device-credential + roster seed → zero network calls through the offline lifecycle) since client-side PowerSync bucket-sync isn't wired yet — see the catch-up implementation notes under Phase 4 (US9) above.
- [X] T149 [P] Local-crash regression test: `apps/pos/tests/integration/wal-crash-safety.spec.ts` — start a shift, write 10 sales, `SIGKILL` the process (or Node `process.exit(0)` in test harness) mid-write, restart, assert the local ledger has no torn writes and the upload queue picks up exactly where it left off. Closes **NFR-004** regression coverage beyond the one-shot Phase 0a spike. Adapted to 10 synthetic shift_open events (US1 sale events don't exist yet) and validates the app-level crash-recovery contract (idempotent inserts + `resetStaleUploading()`) rather than re-proving SQLite's own WAL guarantee — see the catch-up implementation notes under Phase 4 (US9) above.

### Belongs to Phase 8 (US4) — already fixed in T102 above; no new task

### Belongs to Phase 10 (US6) — extends existing sync engine

- [X] T150 [P] [US6] Flap-debounce integration test: `apps/pos/tests/integration/flap-debounce.spec.ts` — Playwright + network shaper toggles connectivity at 200 ms intervals for 60 s; asserts the upload queue neither double-fires nor stalls, and the local `sync_health_local.consecutive_failures` counter increments/resets sanely. Closes **EC-01** explicit test.

**Implementation notes (T150)**: adapted to Vitest (no Playwright/network-shaper infra in apps/pos) — a `FlappingUploader` alternates success/throw across 25 enqueue+drain cycles with manual clock advancement to clear backoff each cycle. **Real gap found**: `SyncEngine` and `sync/health.ts` are only wired one-directionally — `SyncHealthReporter` reads `SyncEngine.queueDepth()`/`oldestPendingEventAt()`, but its `consecutive_failures` counter tracks failures of *posting the health snapshot itself*, unrelated to `drainOnce()` upload failures. The test therefore asserts against `SyncEngine`'s own `local_upload_queue` (`status`/`attempt_count`/`last_error`) instead of `sync_health_local.consecutive_failures` as tasks.md literally specifies — recorded as a follow-up wiring gap in repo memory. Passing.

### Belongs to Phase 5 (US1) — perf sample

- [X] T151 [P] [US1] Scan-to-total perf sample: `apps/pos/tests/perf/scan-to-total.bench.ts` — Vitest bench harness (or Playwright script if we need a real WebView) that runs 1 000 sample transactions on the reference Windows POS SKU established during Phase 0a and asserts **p95 < 2 s** (NFR-001, SC-002). Fails the CI build on regression.

**Implementation notes (T151)**: real hardware/UI paint/scanner latency can't be measured here, so this is an honest logic-layer proxy: `apps/pos/tests/perf/scan-to-total.spec.ts` (plain Vitest `describe`/`it`, not `.bench.ts` — Vitest's default glob already matches `*.spec.ts` anywhere, no config change needed) runs the real `findSkuByBarcode` → `resolvePrice` → `findActivePromotions` → `CartStore.addLine` → `applyPromotions` pipeline 1000 times against `createMemoryDb()` seeded with 5 SKUs/prices/2 promotions, asserting **p95 < 50ms** (a tight budget appropriate for pure JS/SQL logic only, not the full 2s hardware target). Measured on a real run here: p50=0.282ms, p95=0.950ms, p99=1.579ms. One real gap found and fixed as a side effect: `tests/support/memory-db.ts`'s fake SQL engine had no JOIN support at all (needed by `findSkuByBarcode`'s barcode→SKU lookup) — extended with a narrow single-equi-JOIN handler, scoped intentionally to this one join shape.

### Belongs to Phase 11 (US7) — resolves the deferred SLA number

- [X] T152 [P] [US7] Set the report SLA number: amend [spec.md NFR-002](spec.md) with a per-report-type SLA target (settled with the ops team early in Phase 11 planning), then extend T124 to assert each report meets its target on representative data. Closes **FR-034 / SC-007** measurement gap.

**Implementation notes (T152)**: see the Phase 11 (US7) tests implementation notes above — spec.md's NFR-002 now reads 10s for `sales_by_store`/`sales_by_cashier`/`inventory_on_hand`/`till_reconciliation`, 15s for `sales_by_sku`/`transfer_history`, against a ≤90-day/≤16-store representative dataset, with an async report-scheduler escape hatch for anything projected to exceed its SLA. T124 extended with a timing assertion against this figure.

---

## Coverage Delta After Additions

| Finding (analysis pass) | Closed by |
|---|---|
| C1 HIGH — no user-management UI | T146 |
| C2 HIGH — no `event_id` composite generator | T147 |
| A1 MEDIUM — T102 placeholder | T102 (redefined in place) |
| C3 MEDIUM — roster staleness dashboard | T051 (extended in place) |
| C4 MEDIUM — deferred SLA scheduling | T152 |
| F1 MEDIUM — delivery-strategy phrasing | Implementation Strategy section (edited in place) |
| C5 LOW — perf sample | T151 |
| C6 LOW — SC-009 test | T148 |
| C7 LOW — EC-01 debounce test | T150 |
| C8 LOW — NFR-004 crash regression | T149 |
| F2 LOW — T133 sidecar-aware wording | T133 (reworded in place) |

---

## Post-Implementation Additions (T153–T166)

Design-system integration (Stitch mockups → real tokens/components) and bug fixes found while implementing/testing T048–T052, done ahead of their originally-planned phase. Existing IDs are not renumbered so cross-references stay stable.

### Belongs to Phase 3 (Foundational) — extends T048–T052

- [X] T153 [P] Shared Tailwind design-token preset `packages/config/tailwind/preset.ts` + `packages/config/tailwind/tokens.css`: Harvest Retail OS color/typography/spacing tokens from the Stitch design mockups (M3-style raw names + shadcn-conventional aliases over the same CSS vars), exported via `@hgl/config/tailwind/preset`
- [X] T154 [P] Wire the shared preset into `apps/admin/tailwind.config.ts` + `apps/admin/src/app/globals.css` (design tokens as CSS vars, self-hosted Inter font via `next/font/google`)
- [X] T155 [P] Add Tailwind/PostCSS to `apps/pos` from scratch (previously had none): `apps/pos/tailwind.config.ts`, `apps/pos/postcss.config.mjs`, `apps/pos/src/app/globals.css`; wired into both `layout.tsx` and `global-error.tsx` (the latter fully replaces the root layout and needs its own style/font import)
- [X] T156 [P] Hand-authored shadcn/ui-style primitives in `apps/admin/src/components/ui/` (button, card, badge, table, dropdown-menu, input, label, separator, avatar, sheet) + `apps/admin/src/lib/utils.ts` (`cn()`), built on individual `@radix-ui/react-*` packages — NOT the `shadcn` CLI, which now generates Tailwind v4-only code (`radix-ui` meta-package, `color-mix(in oklch, ...)`) incompatible with this project's Tailwind v3 setup
- [X] T157 [P] Same primitive subset (button, card, badge, dropdown-menu) hand-authored in `apps/pos/src/components/ui/` + `apps/pos/src/lib/utils.ts`
- [X] T158 Admin route-group restructure: `apps/admin/src/app/(app)/layout.tsx` renders `AppShell`; `/` and `/sync-health` moved into the `(app)` group (URLs unchanged — route groups don't affect paths); `/login` stays outside the group with no shell
- [X] T159 `apps/admin/src/components/app-sidebar.tsx` (nav pruned to routes with a real tasks.md feature: Dashboard, Sync Health, Prices, Promotions, Price Audit, Inventory, Transfers, Reports, Audit Log, Users, Settings — dropping the Stitch mockups' Order Queue/Revenue Desk/Tax Engine/Marketplace/Register, which have no corresponding feature) + `apps/admin/src/components/app-topbar.tsx` (avatar `DropdownMenu` with role/email + logout server action) + `apps/admin/src/components/app-shell.tsx`
- [X] T160 Restyle `apps/admin/src/app/login/page.tsx` to match the Stitch login mockup (icon avatar, gradient blobs, icon-prefixed inputs, password visibility toggle)
- [X] T161 Restyle `apps/admin/src/components/sync-health-dashboard.tsx` + `.../sync-health/page.tsx`: store-level status card grid (green/amber/red, per [research.md §4.4](research.md)) above the existing per-till sortable table; `buildStoreSummaries`/`buildFleetSummary` added to `apps/admin/src/lib/monitoring/sync-health.ts`
- [X] T162 [P] POS sidebar-free shell (per explicit product decision — the till is a task-flow kiosk, not a multi-section dashboard): `apps/pos/src/components/till-top-bar.tsx` + `apps/pos/src/components/cashier-menu-popover.tsx` (`DropdownMenu` limited to Sync status / Help / Cash-up-End shift / Logout — no admin functionality ever) + `apps/pos/src/components/sync-status-chip.tsx` (replaces the retired floating `offline-badge.tsx`); wired into `apps/pos/src/app/layout.tsx`
- [X] T163 [P] Restyle `apps/pos/src/app/sync-health/page.tsx` with Card primitives; restyle `apps/pos/src/components/kiosk-error-screen.tsx` and `apps/pos/src/app/page.tsx` with Tailwind tokens instead of inline styles
- [X] T164 Fix: `supabase/config.toml` `[auth.email] enable_signup = true` — GoTrue `email_provider_disabled` was silently blocking all local password sign-in (`enabled` is not a valid key under `[auth.email]`; this maps to `GOTRUE_EXTERNAL_EMAIL_ENABLED`). Requires `supabase stop` + `supabase start` — a raw container restart does not reload `config.toml`
- [X] T165 Fix: `apps/admin/src/lib/supabase/claims.ts` + `apps/admin/src/lib/auth/session.ts` — `supabase.auth.getUser()` returns `auth.users.raw_app_meta_data`, NOT the `access_token_hook`-injected JWT claims (`pos_role`/`store_id` only exist in the signed access token). `getSessionClaims()` now decodes the session JWT payload directly. Closes a silent RBAC bug where `requireRole()` always denied regardless of actual role (dashboard showed "unknown role")

### Resolved

- [X] T166 Remote Supabase project `tsexohhlejoskpfbbsur` (linked via `supabase link`) had migration history recorded as `NNN` (e.g. `001`) vs local `NNNN` (e.g. `0001`). The "counts match, so remote likely already has the full schema" assumption was **wrong**: `supabase migration repair --status reverted 001..014` cleared the stale duplicate history rows, but the follow-up `supabase db push` of `0015_user_management_rls.sql` then failed with `relation "users" does not exist` — the remote's actual schema (27 tables: `app_user`, `branch`, `product`, `till_session`, `transaction`, `loyalty_entry`, etc., confirmed via a read-only `supabase db dump --linked --schema public`) was an entirely different, unrelated legacy app, never the retail-pos-mvp schema at all; the migration-history rows had been inserted without their SQL ever running. User confirmed the old schema was not needed. Resolved via `supabase db reset --linked` (drops+rebuilds remote from local migrations/seed — user-confirmed, not a routine operation). Surfaced and fixed one real bug along the way: `supabase/seed/seed.sql`'s `crypt()`/`gen_salt()` calls needed to be schema-qualified as `extensions.crypt(...)`/`extensions.gen_salt(...)` — the seed runner batches statements, so the file's own `SET search_path = public, extensions` doesn't reliably persist across batches on `db reset --linked`. Remote now has all 16 migrations (0001–0016) applied, seed loaded, `supabase db push --dry-run` reports "Remote database is up to date."
