<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Bump rationale: MINOR — the Additional Constraints stack is materially amended.
The ratified terminal-hardware baseline changes from Android to Windows, and
new mandatory rows are added (app shell, kiosk lockdown, fleet MDM, OTA
mechanism). Frontend/backend/sync-engine stack unchanged. All seven Core
Principles unchanged.

Modified sections:
  - Additional Constraints → Technology stack (terminal platform + shell + MDM + OTA)
Modified principles: none — Principles I–VII are platform-agnostic.
Added principles: none.
Removed sections: none.

Templates requiring updates: all compatible; no template edit needed.

Follow-up TODOs:
  - TODO(RATIFICATION_DATE): Confirm 2026-08-31 with the sponsor.
  - PowerSync Tauri SDK is currently alpha (feature spec 001 §14). Phase 0a
    spike MUST validate offline-write end-to-end before Phase 0 begins.
    Documented fallback: a **Tauri sidecar hosting the PowerSync Node.js
    SDK** (feature spec 001 research.md §12). Electron migration is
    explicitly rejected. If the sidecar fallback is triggered, this section
    requires a further PATCH amendment recording the switch.

Prior versions:
  - v1.0.0 (2026-08-31): Initial ratification. Terminal baseline was Android
    12+ POS terminals; superseded by this amendment.
-->

# Harvest Group Retail POS Constitution

## Core Principles

### I. Offline-First At The Till (NON-NEGOTIABLE)

Every code path that a cashier can hit during a sale MUST complete without any
network dependency. Product lookup, cart, tender capture, stock decrement,
receipt render, and shift/cash-up MUST all execute against the till's local
SQLite (WAL mode) database and MUST NOT block on, wait for, or fail because of
a remote call.

Rules:

- No checkout, refund-in-same-session, void-in-same-session, or shift-close
  code path MAY perform a synchronous network call in its critical path.
- Local writes MUST be atomic and crash-safe (SQLite WAL, `fsync` on commit
  for financial rows); a power loss mid-transaction MUST NOT corrupt the
  local ledger.
- Peripheral I/O (printer, card reader, scanner, cash drawer) MUST have retry
  and timeout logic that is independent of the sync layer; a stuck printer
  MUST NOT stall sync, and a stuck sync MUST NOT stall a printer.
- Any feature that genuinely requires connectivity (cross-till historical
  refund, admin panel, HQ reports) MUST be labelled online-only in the UI and
  in staff training material — silent degradation is not acceptable.

Rationale: Losing a sale because a WAN link flapped is a direct revenue and
customer-trust loss. Offline resilience is the load-bearing requirement of
this system and every other design decision defers to it.

### II. Event-Sourced Additive Stock (NON-NEGOTIABLE)

Stock quantity MUST NOT be represented as a mutable "current_stock" field that
is overwritten. Every stock-affecting action MUST be persisted as an
append-only `stock_events` row with an immutable, signed `delta_qty` and a
typed `event_type` (`sale`, `refund`, `transfer_out`, `transfer_in`,
`adjustment`, `count_correction`).

Rules:

- `current_stock` for any `(store_id, sku_id)` MUST be derived server-side by
  aggregating `stock_events`; the derivation MUST NOT be duplicated as an
  independently-writable column that clients can overwrite.
- Every stock event MUST carry a client-generated `event_id` (UUID or
  `till_id + local_sequence_number` composite) which is the unique dedup key
  for sync upsert.
- `count_correction` events MUST be reported as a distinct line item in
  reconciliation reports and MUST NOT be silently folded into "shrinkage" or
  "adjustment" categories.
- Transfers MUST fire `transfer_out` at dispatch and `transfer_in` only at
  confirmed receipt; the in-transit state MUST be modelled explicitly and
  MUST NOT be inferred from raw event arrival order.
- Overselling (stock going negative after concurrent offline sales sync) MUST
  NOT be prevented by blocking sales at the till; it MUST be surfaced as an
  "Oversold" status on the inventory dashboard for manager follow-up.

Rationale: Additive deltas are commutative and associative, so concurrent
offline writes from multiple tills always converge to the same total
regardless of sync order. This is the mathematical basis for the sync
guarantee — any design that treats stock as a mutable field forfeits it.

### III. Independent Per-Till Sync

Each till MUST sync directly to PowerSync/Supabase over its own connection.
The system MUST NOT introduce a store-level coordinator, hub, LAN broker, or
any other local intermediary that other tills depend on.

Rules:

- A till MUST NOT read from, write to, or query another till or any local
  server on the store LAN as part of its normal operation.
- Cross-till and cross-store stock visibility MUST be served exclusively from
  the cloud-synced admin/reporting panel; the cashier UI MUST NOT expose
  another till's live state.
- PowerSync sync rules MUST partition rows by `store_id` (and by `till_id`
  where applicable) so a till only receives its own store's catalogue,
  pricing, and stock state.
- Isolation between stores and tills MUST have automated test coverage
  before any multi-store rollout — a sync-rule bug now has full blast radius
  and MUST NOT ship untested.

Rationale: Every additional local coordinator is another failure surface to
provision, patch, monitor, and recover. Per-till sync moves the failure
domain into the cloud where it is already monitored, and keeps store-level
outages independent per till.

### IV. Idempotent, Backward-Compatible Sync Contract

Every operation that crosses the sync boundary MUST be safely retryable and
schema changes MUST NOT break older client versions that are still in the
field during a staged rollout.

Rules:

- Server ingest MUST upsert on `event_id`; a duplicate event MUST be a no-op,
  never a double application.
- The local upload queue MUST be persisted to disk (not memory-only) and MUST
  be resumable across app restarts and device reboots.
- Reconnect logic MUST use exponential backoff with jitter; a fleet-wide
  reconnect after a regional outage MUST NOT be a synchronised burst.
- Large backlogs MUST be uploaded in bounded batches; a single upload MUST
  NOT attempt to flush an unbounded queue in one request.
- Schema migrations MUST be backward-compatible across at least one prior
  released app version; destructive column drops, type narrowings, or
  required-field additions on synced tables MUST be deferred behind a
  documented deprecation window that outlives the slowest-updating till.
- `server_ts` (assigned on ingest) MUST be the authoritative timestamp for
  financial ordering and reporting; `client_ts` is retained for on-device
  debugging only and MUST NOT be used for money math.

Rationale: A retry-safe, version-tolerant sync contract is the only way a
16-store fleet can be operated without coordinated downtime and without
losing events when networks flap.

### V. Auditable, Immutable Financial & Price Records

Sales, refunds, price changes, and stock adjustments MUST leave a complete,
immutable audit trail suitable for finance and fiscal review.

Rules:

- Sale records MUST be append-only. Corrections MUST be issued as
  compensating refund/void records that reference the original; existing sale
  rows MUST NOT be edited in place.
- Prices MUST be a versioned, effective-dated record. A completed offline
  sale MUST be stamped with the cached price it used and MUST NOT be
  retroactively re-priced when the till reconnects.
- Every price change MUST record actor, timestamp, old value, new value, and
  scope (SKU / store / promotion); this trail MUST be queryable from the
  admin panel.
- Every stock adjustment MUST record a reason code, actor, and (where the
  threshold applies) approver; unapproved adjustments above the threshold
  MUST NOT be applied.
- Fiscalisation (ZRA Smart Invoice / VSDC) MUST be treated as a compliance
  gate for the sales module; a sales feature that cannot produce a compliant
  fiscal record MUST NOT be shipped to a live store.

Rationale: Finance, audit, and the ZRA regulator all require reconstructible
history. Any design that mutates historical rows in place forfeits that
capability and creates a compliance defect.

### VI. Staged Rollout, Canary Deploys, Reversible Migrations

No change — application code, sync rules, or database migration — MUST be
deployed to all 16 stores simultaneously.

Rules:

- Every production change MUST land in a single pilot store first, soak for
  a defined observation window, and only then progress in stages to the rest
  of the fleet.
- Deploys MUST occur outside trading hours OR use a blue/green cutover; a
  trading-hours restart of a till is not an acceptable deploy strategy.
- Database migrations MUST be reversible or paired with a documented
  forward-fix path; irreversible schema changes MUST require explicit
  written sign-off recorded in the amendment log for this constitution.
- A per-store connectivity, sync-lag, and last-successful-sync dashboard MUST
  exist and MUST be green for the pilot store before rollout progresses.
- An "offline for 3 days" drill MUST be executed against the pilot store
  before general rollout; the drill result MUST be captured in the rollout
  record.

Rationale: A fleet-wide bad deploy is a 16-store outage. Staging and
reversibility convert catastrophic incidents into one-store incidents.

### VII. Security, RBAC & Regulatory Compliance By Default

Every module MUST enforce role-based access control, encryption, and the
applicable regulatory constraints from the first commit — not as a follow-up
hardening pass.

Rules:

- Every user-facing action MUST resolve against an explicit role (cashier,
  store manager, HQ admin, or a narrower role) and MUST reject unauthorised
  actions server-side; client-side gating alone is not sufficient.
- Data MUST be encrypted in transit (TLS) and at rest (Postgres storage
  encryption and, for the on-till SQLite database, OS-level disk encryption
  or SQLCipher).
- Card payment data MUST be handled in a PCI-relevant manner: the POS
  application MUST NOT persist full PAN, CVV, or track data; card capture
  MUST occur on certified reader hardware and only tokens or masked
  references MUST reach application storage.
- A till MUST authenticate to PowerSync using a device-level credential
  distinct from the cashier session token so a long-offline till can resume
  sync without a mid-shift re-login.
- Every price change, stock adjustment, refund, and role change MUST be
  written to the system-wide audit log; the audit log MUST be append-only.

Rationale: Retail POS handles payment data, regulated fiscal records, and
staff-with-cash-access identity — retrofitting security into a system that
was not built for it is significantly more expensive and error-prone than
building it in.

## Additional Constraints

**Technology stack (fixed for MVP through Phase 5):**

- Frontend / app: Next.js, TypeScript
- Terminal OS: **Windows** (Windows 10/11 IoT Enterprise or Pro; final SKU tied to Intune-enrolment support and OPOS/UPOS driver availability)
- App shell: **Tauri 2** wrapping the Next.js bundle, using **PowerSync's official Tauri SDK** (native Rust-backed filesystem SQLite that persists across app updates). The Tauri SDK is currently alpha — accepted risk vs. Electron's heavier footprint. Documented fallback if Phase 0a (feature spec 001 §11) surfaces blocking instability: **a Tauri sidecar hosting the PowerSync Node.js SDK** (shell, build pipeline, kiosk, OTA all unchanged). Electron migration is explicitly rejected.
- Local client-side data layer: plain SQLite through PowerSync's own watched-query hooks — NO additional client-side layer (e.g. TanStack DB).
- Kiosk lockdown: **Windows Assigned Access / Shell Launcher** (terminal is locked to the POS app; cashiers cannot reach the desktop).
- Fleet MDM: **Microsoft Intune** for silent remote deployment, kiosk configuration, and native-shell installer distribution.
- OTA updates:
  - Tier 1 (JS/web bundle, most updates): **Tauri's built-in updater plugin** with delta updates and code signing. Applied only at safe points (till idle, no open shift). Same canary/staged discipline as any deploy (Principle VI).
  - Tier 2 (native shell, rare): new installer version distributed via Intune.
- Terminal hardware: barcode scanner, thermal receipt printer, card reader, cash drawer trigger (all OPOS/UPOS-compatible); UPS/battery backup; local storage sized for the offline SQLite event queue.
- Backend: Supabase / Postgres, with Postgres logical replication enabled.
- Offline sync: PowerSync client SDK (Tauri flavour) on each till, syncing to Supabase.
- Standalone: NO SAP B1 integration; this system owns its own sales and
  financial reporting.

Deviations from this stack MUST be approved via a constitutional amendment
(Governance section below) — they are not routine engineering decisions.
The **Tauri-sidecar Node.js SDK** fallback path is pre-authorised by this
amendment provided it is triggered by a documented Phase 0a spike failure.

**Per-store network baseline:**

- Primary: fibre or DSL over store LAN/WiFi
- Secondary: 4G/LTE dual-WAN cellular failover router with automatic failover
- No dedicated per-store coordinator device (see Principle III).

**AI-assisted build tooling:**

- Daily driver model: Claude Sonnet 5 for scaffolding, CRUD, UI, and routine
  implementation.
- Escalation: Claude Opus 5 for the offline sync engine and stock-conflict
  resolution logic specifically — these MUST NOT be delegated to the daily
  driver model without a human reviewer versed in the conflict spec.
- Sonnet 4.6 is deprecated in Copilot from 2026-09-01; agent configuration
  MUST target Sonnet 5 by that date.

**Explicit non-goals (do not build):**

- Peer-to-peer till discovery on the store LAN.
- A local store server / hub / coordinator.
- Retroactive re-pricing of completed sales after a price sync.
- Cross-till stock queries from the cashier UI.

## Development Workflow & Quality Gates

Feature planning and delivery MUST pass the following gates:

1. **Constitution Check (planning gate):** Every `plan.md` MUST include an
   explicit mapping of the feature to Principles I–VII, flagging any
   principle it touches. Violations MUST be justified in the
   `Complexity Tracking` section of the plan or the plan MUST be revised.
2. **Sync-boundary review:** Any change that adds or modifies a synced table,
   a stock event type, a price record, or a sync rule MUST be reviewed by an
   engineer familiar with Principles II, III, and IV before merge.
3. **Offline drill (pre-release gate):** Before a release is promoted beyond
   the pilot store, a documented offline drill MUST be executed on the pilot
   till: run the till disconnected from WAN for at least 8 hours of trading,
   verify sales complete, then verify full backlog upload on reconnect with
   zero duplicate or lost events.
4. **Rollout progression:** Progression from pilot to fleet MUST require the
   per-store sync-health dashboard to be green (defined lag threshold, no
   stale `last_successful_sync`) for the pilot for a defined soak period.
5. **Post-incident:** Any incident that reveals a gap in this constitution
   MUST trigger a proposed amendment within one working week; the incident
   MUST NOT be closed by a code fix alone if the principle itself was silent.

## Governance

This constitution supersedes ad-hoc engineering preference and informal
practice. Where this document conflicts with a ticket, a plan, or an
individual preference, this document wins until it is formally amended.

**Amendment procedure:**

- Amendments MUST be proposed as a pull request that edits this file and
  updates the Sync Impact Report at the top.
- Amendments MUST be reviewed and approved by at least one engineering lead
  and one Harvest Group operations representative before merge.
- Emergency amendments (e.g. a regulator changes a fiscal requirement) MAY
  be merged on the authority of the engineering lead alone, but MUST be
  ratified through the normal review within one working week.

**Versioning policy** (semantic):

- MAJOR: A principle is removed, renumbered so as to break existing
  references, or redefined in a way that invalidates code already in
  production (e.g. dropping the offline-first requirement).
- MINOR: A new principle is added, or an existing principle is materially
  expanded with new mandatory rules.
- PATCH: Wording clarifications, typo fixes, rationale additions, or
  non-semantic reorganisation that does not change what is required.

**Compliance review:**

- Every plan-level Constitution Check MUST cite the constitution version it
  was reviewed against.
- The constitution MUST be re-read and re-affirmed at the start of every
  phase transition in the rollout plan (Phase 0 → 1 → 2 → 3 → 4 → 5); a
  transition MUST NOT proceed without that affirmation being recorded.
- Runtime engineering guidance (agent instructions, agent files, and any
  future `AGENTS.md` or `copilot-instructions.md`) MUST defer to this
  constitution and MUST NOT contradict it.

**Version**: 1.1.0 | **Ratified**: 2026-08-31 | **Last Amended**: 2026-09-02
