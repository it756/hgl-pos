# Implementation Plan: Retail POS System — 16-Store Supermarket Rollout

**Branch**: `001-retail-pos-mvp` | **Date**: 2026-08-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from [specs/001-retail-pos-mvp/spec.md](spec.md)
**Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md) — v1.1.0

## Summary

Build an offline-first retail POS for 16 Harvest Group supermarkets: local-first **Windows till app (Next.js in a Tauri 2 shell using the PowerSync Tauri SDK, alpha)** with per-till filesystem SQLite; Supabase/Postgres backend with sync rules partitioned by `store_id` (and `till_id` where required); event-sourced stock (`stock_events`) and shift lifecycle (`shift_events`) tables that upsert on client-generated `event_id` for idempotent, retryable sync; a Next.js admin/reporting app for HQ, store managers, and audit; per-till sync-queue observability wired to both an in-app sync-health screen and a HQ dashboard. Fiscalisation (ZRA/VSDC) is deferred to companion spec `002-fiscalisation` and gates pilot go-live, not this MVP build.

Technical approach in one paragraph: append-only event tables on Postgres — `stock_events`, `sale_events`, `shift_events`, `transfer_events`, `adjustment_events`, `price_change_events` — plus mutable read-model projections (`current_stock_by_store_sku`, `shifts`, `sales`, `transfers`) maintained by triggers. Every event carries a client-generated `event_id` (`till_id` + `local_sequence_number` composite) and gets `server_ts` assigned on ingest. PowerSync bucket definitions partition rows by `store_id` for catalog/prices/stock and by `till_id` for the till's own shift and sale history. Roles (cashier, store manager, HQ admin) are enforced in three places: (a) Postgres RLS on read/write, (b) PowerSync sync-rule parameters that scope what each JWT can pull, (c) client-side route guards for UX. Sync-queue observability is a first-class module: a `sync_health_snapshots` table receiving heartbeats from every till, an admin dashboard reading it, and Postgres alerts (via `pg_cron` + a webhook Edge Function) firing when a till's lag crosses threshold.

## Technical Context

**Language/Version**: TypeScript 5.5+ (all apps), Node.js 20 LTS (Supabase Edge Functions, build tooling), Postgres 15 (Supabase managed), Rust stable (Tauri shell build)
**Primary Dependencies**: Next.js 15 (App Router), React 19, **Tauri 2 shell + PowerSync Tauri SDK (alpha) + tauri-plugin-updater; WebView2 runtime on Windows**, Supabase JS client v2, Zod (runtime validation of event payloads), Drizzle ORM for local SQLite typing and Postgres migrations, shadcn/ui + Tailwind for admin UI, TanStack Table for reports
**Storage**: Postgres 15 on Supabase (source of truth, logical replication enabled for PowerSync); SQLite (WAL mode) per till via PowerSync Tauri SDK (native filesystem, persists across app updates); Supabase Storage for report PDF exports
**Testing**: Vitest (unit, all packages), Playwright (admin E2E), **WebDriverIO + tauri-driver (Windows POS E2E)**, custom offline-drill harness (Playwright driving an emulated till through disconnect scenarios), pgTAP for Postgres tests (RLS and projection triggers)
**Target Platform**: **Windows 10/11 IoT Enterprise or Pro on POS terminals (Tauri shell, kiosk-locked via Assigned Access / Shell Launcher, Intune-managed)**; modern desktop browsers (admin app, Chromium 120+); Supabase managed Postgres for backend
**Project Type**: Multi-app monorepo (**Windows Tauri till app** + web admin app + Supabase backend + PowerSync sync-rules) — pnpm workspaces
**Performance Goals**: Scan-to-total p95 < 2 s (NFR-001, SC-002); shift open + first sale < 5 s cold start on target Windows POS hardware; report generation SLA to be finalised per report type (NFR-002, SC-007 — placeholder pending report-query planning); PowerSync catch-up of a 24 h backlog (~2 000 events per till) uploaded in ≤ 60 s on 4G at target hardware
**Constraints**: Offline-first at the till — no network in the sale critical path (Principle I); local SQLite WAL, atomic writes (NFR-004); events append-only (Principle II); PowerSync sync rules partition by `store_id` / `till_id` (Principle III); idempotent upsert on `event_id`; backward-compatible schema migrations only (Principle IV, NFR-015); staged deploys never fleet-wide (Principle VI); **PowerSync Tauri SDK is alpha — Phase 0a spike gates all further work; Electron + Node.js SDK is the pre-authorised fallback (Constitution v1.1.0)**
**Scale/Scope**: 16 stores at launch; ~4 tills/store → ~64 tills; ~50 000 SKUs central catalog, ~15 000 SKUs per store subset; peak ~10 concurrent sales/store; sync-queue peak ~200 events/s fleet-wide during evening cash-up burst; ~30 admin/HQ users; ~350 cashier user records

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #   | Principle                                             | This feature's touch points                                                                                                                                                                                                                                                                       | Compliance                                                                                                                                                                             |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I   | Offline-First At The Till (NON-NEGOTIABLE)            | POS sale + shift + cashier login paths, local SQLite via PowerSync SDK, printer/reader I/O isolated from sync                                                                                                                                                                                     | **PASS** — the entire till app is designed around this; verified by Phase 5 offline drill (US6, SC-001, SC-011)                                                                        |
| II  | Event-Sourced Additive Stock (NON-NEGOTIABLE)         | `stock_events`, `shift_events`, `transfer_events`, `adjustment_events` — all append-only; `current_stock` derived; `event_id` dedup                                                                                                                                                               | **PASS** — no mutable stock column exists in the design                                                                                                                                |
| III | Independent Per-Till Sync                             | Direct till → PowerSync/Supabase; no store LAN broker; sync rules partitioned by `store_id`/`till_id`; cross-till visibility admin-only                                                                                                                                                           | **PASS** — architecture forbids Hub; sync-rule isolation tested per [research.md](research.md) §3                                                                                      |
| IV  | Idempotent, Backward-Compatible Sync Contract         | `event_id` upsert; persisted upload queue; exponential backoff + jitter; batched backlog upload; migrations reviewed for backward compat                                                                                                                                                          | **PASS** — design covers all rules; migration review is a per-PR gate                                                                                                                  |
| V   | Auditable, Immutable Financial & Price Records        | Sales/refunds/voids as new linked records; `price_versions` table; `audit_log` append-only; adjustments carry reason + actor + approver                                                                                                                                                           | **PASS** for MVP; **fiscalisation gate deferred** to companion spec `002-fiscalisation` and blocks pilot go-live, not this build ([spec.md §14](spec.md))                              |
| VI  | Staged Rollout, Canary Deploys, Reversible Migrations | US8 canary story; migration strategy in [research.md](research.md) §6; per-store sync-health dashboard                                                                                                                                                                                            | **PASS** — canary tooling built in Phase 5                                                                                                                                             |
| VII | Security, RBAC & Regulatory Compliance                | Postgres RLS + PowerSync sync-rule params + client route guards; salted-hash cashier PINs (Argon2id, native Rust in the Tauri shell); device-level credential distinct from cashier session; TLS in transit; **SQLCipher** for the on-till SQLite database (supported by the PowerSync Tauri SDK) | **PASS** — three-layer enforcement designed in [contracts/rls-policies.sql](contracts/rls-policies.sql) and [contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml) |

**Initial gate result: PASS.** No violations require justification in Complexity Tracking. Fiscalisation deferral is a scoping decision that respects Principle V (fiscalisation still gates live-store shipment; this spec just doesn't build it).

## Project Structure

### Documentation (this feature)

```text
specs/001-retail-pos-mvp/
├── plan.md                           # This file
├── research.md                       # Phase 0 — sync tables, sync rules per role, queue monitoring, wrapper choice
├── data-model.md                     # Phase 1 — full entity + event table schemas
├── quickstart.md                     # Phase 1 — bootstrap steps
├── contracts/                        # Phase 1
│   ├── powersync-sync-rules.yaml
│   ├── events.schema.ts
│   ├── http-api.md
│   └── rls-policies.sql
├── checklists/
│   └── requirements.md               # (already exists)
└── tasks.md                          # Phase 2 output — NOT created by /speckit.plan
```

### Source Code (repository root)

```text
apps/
├── pos/                              # Windows POS app — Next.js (static export) wrapped by Tauri 2
│   ├── src/
│   │   ├── app/                      # Next.js App Router: /login, /shift, /sale, /sync-health
│   │   ├── components/               # Cart, tender, receipt-preview, cash-up sheet, sync badge
│   │   ├── lib/
│   │   │   ├── db/                   # PowerSync Tauri SDK init, SQLite migrations, Drizzle schemas
│   │   │   ├── events/               # Event builders + Zod validation
│   │   │   ├── sync/                 # Sync-engine wiring, health probe, backoff/jitter, queue metrics
│   │   │   ├── auth/                 # Local cashier PIN check (Argon2id in the Tauri Rust shell), device credential
│   │   │   ├── peripherals/          # OPOS/UPOS adapters — printer, scanner, card reader, drawer trigger
│   │   │   └── pricing/              # Effective-dated price lookup + promotions engine
│   │   └── styles/
│   ├── src-tauri/                    # Tauri Rust shell (main.rs, tauri.conf.json, updater config, signing)
│   └── tests/
│       ├── unit/                     # Vitest — event builders, pricing, cash-up math
│       ├── integration/              # Vitest + in-memory PowerSync — offline sale, queue survival across restart
│       └── e2e/                      # WebDriverIO + tauri-driver flows — happy-path sale, offline drill, shift lifecycle
│
├── admin/                            # Next.js web admin app — HQ + store manager dashboards
│   ├── src/
│   │   ├── app/                      # /reports, /inventory, /prices, /transfers, /sync-health, /audit
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── supabase/             # Server + browser Supabase clients (role-gated)
│   │   │   ├── reports/              # Report queries + CSV/PDF export
│   │   │   └── monitoring/           # Sync-health dashboard queries
│   │   └── styles/
│   └── tests/
│       ├── unit/
│       └── e2e/                      # Playwright — HQ dashboard, price change flow, audit trail
│
supabase/
├── migrations/                       # Sequential SQL migrations (backward-compatible only, NFR-015)
├── functions/                        # Deno Edge Functions
│   ├── provision-till/               # Device-credential minting for a new till
│   ├── verify-refund/                # Cross-till refund server-side sale confirmation
│   ├── sync-health-alerts/           # pg_cron-triggered webhook for stale tills
│   └── report-export/                # PDF rendering + storage
├── seed/                             # Reference data (stores, initial roles, sample SKUs)
└── tests/                            # pgTAP tests — RLS policies, projection triggers, event upsert idempotency
│
powersync/
├── sync-rules.yaml                   # Authoritative bucket + sync-rule definitions per role/store
└── tests/                            # PowerSync sync-rule tests (isolation between stores/tills)
│
packages/
├── events/                           # Shared TS types + Zod schemas for every event type
├── contracts/                        # Shared TS types for HTTP APIs
├── db-shared/                        # Shared Drizzle/SQL type definitions
└── config/                           # eslint, tsconfig base, prettier
│
docs/
└── ops/                              # Runbooks: offline-drill.md, canary.md (Phase 5), device-recovery.md
```

**Structure Decision**: pnpm-workspaces monorepo. Two apps (`apps/pos` **Windows Tauri till**, `apps/admin` web) share typed event contracts via `packages/events`. Sync rules live in a top-level `powersync/` directory (not inside an app) because they are backend policy authored and reviewed independently of either client. Supabase migrations, Edge Functions, and pgTAP tests live under `supabase/` so `supabase db reset` and `supabase functions deploy` work out of the box.

## Complexity Tracking

No Constitution Check violations. Complexity Tracking is intentionally empty.

## Post-Design Constitution Re-Check

**Re-check status**: **PASS.** Phase 1 artefacts ([data-model.md](data-model.md), [contracts/powersync-sync-rules.yaml](contracts/powersync-sync-rules.yaml), [contracts/rls-policies.sql](contracts/rls-policies.sql), [contracts/events.schema.ts](contracts/events.schema.ts), [contracts/http-api.md](contracts/http-api.md), [quickstart.md](quickstart.md)) introduce no new violations of Principles I–VII. Trace of each principle to concrete artefacts is in [research.md](research.md) §7. Fiscalisation deferral to `002-fiscalisation` remains the only scoping note against Principle V and is documented in [spec.md §14](spec.md).
