# Feature Specification: Retail POS System — 16-Store Supermarket Rollout

**Project**: Harvest Group Retail POS
**Feature Branch**: `001-retail-pos-mvp`
**Status**: Ready for Planning (all open items closed — see §13 Clarifications)
**Created**: 2026-08-31
**Input**: Harvest Group Retail POS Requirements Specification (internal doc, 16-store rollout)
**Related systems**: Harvest LPG ERP (sibling system — shares stack pattern, hardware pattern, and fiscalization approach; no data integration between the two)
**Constitution**: [.specify/memory/constitution.md](../../.specify/memory/constitution.md) — v1.0.0

---

## 1. Overview

Harvest Group operates 16 retail supermarket stores and needs a purpose-built Point of Sale system covering till operations, inter-store inventory transfers, centralized price management, and multi-store reporting. The system is **standalone** — it does not integrate with SAP B1 and owns its own financial/sales reporting.

The defining constraint is **full offline operation at the till**: a cashier must be able to scan, total, tender, and complete a sale — with correct local stock deduction — with zero network connectivity, and have that sale sync durably and idempotently once connectivity returns. This constraint shapes nearly every other decision in this spec (data model, conflict resolution, sync topology, rollout order).

### 1.1 Goals

- Replace/introduce POS at 16 stores with a system that never blocks checkout on network state.
- Give HQ a single, near-real-time, consolidated view of sales and stock across all stores.
- Guarantee stock and financial figures are auditable, idempotent under retry, and never silently corrected or overwritten.
- Roll out safely: one pilot store first, staged expansion, zero big-bang deploys.

### 1.2 Non-Goals (see §14 for full Out of Scope)

- No SAP B1 integration.
- No till-to-till or LAN-local communication of any kind.
- No coordinator/Hub device at store level.
- No cross-till visibility at the cashier layer (admin/reporting layer only).

---

## 2. Scope

### 2.1 In Scope

POS core (sale, returns, voids, tenders, shifts), inventory & stock ledger, inter-store transfers, central price engine with promotions, multi-store reporting, offline-first sync via PowerSync/Supabase, role-based access control, phased 16-store rollout.

### 2.2 Out of Scope (this spec)

SAP B1 integration, ZRA Smart Invoice/VSDC fiscalization, till-to-till/LAN communication, a store-level coordinator device, final hosting/terminal procurement contracts (hardware _spec_ is in scope, procurement is not), loyalty program business rules beyond "loyalty-tier pricing" as a price-engine input.

---

## 3. User Scenarios & Acceptance Testing _(mandatory)_

User journeys are prioritised so that each priority band is an independently-deliverable slice of value. Priorities correspond to the phased rollout in §11.

### User Story 1 — Offline Sale at the Till (Priority: P1) 🎯 MVP

**Journey**: A cashier can complete a full sale — scan, cart, tender, receipt, stock deduction — with zero network connectivity, and the sale syncs correctly on reconnect.

**Why this priority**: This is the load-bearing capability of the entire system. Every other feature exists in service of this one. If offline sale does not work, no store can open.

**Independent Test**: Provision a single till, disconnect it from WAN, complete 20 sales across cash/card/mobile-money tenders, print receipts, then reconnect and verify every sale and every stock event has synced exactly once to Supabase with `server_ts` assigned.

**Acceptance Scenarios**:

1. **Given** a till has no network connectivity and a cached price list, **When** a cashier scans items, applies a tender, and completes the sale, **Then** the sale is written locally, stock is decremented locally via a `sale` stock event, a receipt is printed or issued digitally, and the transaction is queued for sync — all without any network call blocking the flow.
2. **Given** a sale was made on Till 3 in the current session, **When** a void is issued from Till 3 in that same session, **Then** the void succeeds fully offline.
3. **Given** a till has a queued sale awaiting sync, **When** the device is power-cycled, **Then** the queued sale survives the restart and uploads on the next successful sync.

_(Covers FR-001…FR-011, FR-013, FR-021, NFR-001, NFR-003, NFR-004; corresponds to rollout Phase 1.)_

---

### User Story 2 — Centrally-Managed Prices & Promotions (Priority: P1)

**Journey**: HQ maintains a single price list and promotions catalog; price changes propagate to every till (immediately when online, on reconnect when offline); a completed sale is stamped with the price active at time of sale and is never retroactively re-priced.

**Why this priority**: A supermarket cannot open without a priced catalog; promotions and effective-dated prices are day-1 business needs, not a follow-on.

**Independent Test**: Change a SKU price at HQ, verify all online tills reflect it within their sync interval; take a till offline before the change, complete a sale at the old price, reconnect, and verify the sale record still carries the old price while the till's catalog now shows the new price.

**Acceptance Scenarios**:

1. **Given** HQ changes a SKU's price (or schedules a future effective-dated price), **When** a store's till is online, it receives the update on next sync; if offline, it continues using its last cached price until reconnect, **Then** a sale is always stamped with the price active on the till at time of sale, and that price is never retroactively altered after the sale is recorded, even after the till later syncs a newer price.
2. **Given** a BOGO promotion is active for a date range, **When** a cashier scans a qualifying combination during that range, **Then** the promotion is applied and both the base price and the promotion identifier are stamped onto the sale record.
3. **Given** a price change is committed at HQ, **When** the audit log is queried, **Then** it shows actor, timestamp, old value, new value, and scope (SKU / store / promotion).

_(Covers FR-023…FR-028, FR-038, NFR-010; corresponds to rollout Phase 1 (read-only price list) → Phase 3 (full promotions).)_

---

### User Story 3 — Stock Ledger, Counts & Oversell Handling (Priority: P2)

**Journey**: Store staff perform stock counts and adjustments; the system tracks stock via an append-only event ledger; concurrent offline sales that push stock negative are surfaced as "Oversold" for manager follow-up rather than blocked at the till.

**Why this priority**: Trails Phase 1 (checkout) but must land before Phase 3 (multi-store). Without a working stock ledger and oversell surfacing, the pilot store cannot be trusted to hold shrinkage under control before expansion.

**Independent Test**: Set stock for a SKU to 1, take two tills offline, sell 1 unit on each till, reconnect both, verify `current_stock` = −1, the SKU appears as "Oversold" on the Inventory Dashboard, and neither sale was blocked or lost.

**Acceptance Scenarios**:

1. **Given** two tills at different stores (or the same store) are both offline and both hold a cached stock count showing 1 unit of the same SKU, **When** both cashiers complete a sale for that SKU before either reconnects, **Then** both sales succeed locally (no blocking), and once both sync, the derived `current_stock` reflects both deltas (potentially negative), the SKU is auto-flagged "Oversold" on the Inventory Dashboard, and no stock event is lost or double-applied.
2. **Given** a till has pending, unsynced `sale` events still queued locally, **When** a cashier or manager performs a physical stock count, **Then** the count delta is computed against the till's full local ledger _including_ its own unsynced pending events, not a stale cached total, and the resulting event is tagged `count_correction`.
3. **Given** a stock adjustment above the configured threshold is submitted, **When** approval is missing, **Then** the adjustment is not applied and the request is queued for approval with reason code, actor, and timestamp.

_(Covers FR-013, FR-016, FR-017, FR-021, FR-022; corresponds to rollout Phase 2.)_

---

### User Story 4 — Inter-Store Transfers with Variance (Priority: P2)

**Journey**: A source store dispatches stock to a destination store; the destination confirms receipt; any variance between dispatched and received quantity is captured as its own event, never silently absorbed.

**Why this priority**: Required for multi-store operation (Phase 3). Not required for the single-store pilot, so lands after Phase 1/2.

**Independent Test**: Dispatch 50 units from Store A, confirm receipt of 48 at Store B, and verify: Store A shows −50 via `transfer_out`, Store B shows +48 via `transfer_in`, a separate variance event records the missing 2, and the transfer UI state machine shows "received" only after "dispatched" regardless of event arrival order at the server.

**Acceptance Scenarios**:

1. **Given** Store A dispatches 50 units of a SKU to Store B, **When** dispatch is confirmed, **Then** a `transfer_out` event fires at Store A and the stock enters an "in transit" state (not sellable at either store), **And when** Store B receives only 48 units and confirms receipt, **Then** a `transfer_in` event fires for 48 units and a separate variance event records the 2-unit discrepancy — the variance is never silently absorbed into the transfer quantity.
2. **Given** `transfer_in` arrives at the server before `transfer_out` due to network timing, **When** a manager views the transfer, **Then** the UI state is driven by a server-side state machine on the paired events and never shows "received" before "dispatched."

_(Covers FR-014, FR-015; corresponds to rollout Phase 3.)_

---

### User Story 5 — Cross-Till Refund Requiring Connectivity (Priority: P2)

**Journey**: A customer wants to refund a sale that happened on a different till or on a prior day; the till requires live connectivity to confirm the original sale exists server-side before processing the refund.

**Why this priority**: A necessary correctness rule but a relatively rare flow. Staff train on it as the one intentionally non-offline operation.

**Independent Test**: Take a till offline, attempt to process a refund against yesterday's sale from another till — verify the till refuses and shows a clear "connectivity required" message; reconnect, retry, verify the refund completes and generates a linked refund record.

**Acceptance Scenarios**:

1. **Given** a customer wants to refund a sale made yesterday on a different till, **When** the refund is attempted while the till is offline, **Then** the till clearly informs the operator that connectivity is required and does not process a refund locally.
2. **Given** the till is online, **When** a refund against a historical cross-till sale is submitted, **Then** the system confirms the original sale exists server-side, records a new linked refund record (never mutating the original sale), and issues a `refund` stock event.

_(Covers FR-005, FR-012, FR-028; corresponds to rollout Phase 1 (behavior gate) with full flows finalized in Phase 3.)_

---

### User Story 6 — Extended Offline Operation & Reconnect (Priority: P2)

**Journey**: A store operates for multiple days with no HQ connectivity; sales continue; on reconnect the backlog uploads durably without duplication or loss.

**Why this priority**: This is the operational proof of the whole architecture and is validated during Phase 5 hardening — but its acceptance criteria must be stated up-front so Phase 1 code is written to satisfy them.

**Independent Test**: Disconnect a pilot till from the WAN for 3 days of trading, complete a representative volume of sales, then reconnect and verify: full backlog uploads in batches, no timeout, no duplicate events on the server (per `event_id` upsert), and no lost events versus the local ledger.

**Acceptance Scenarios**:

1. **Given** a store loses HQ connectivity for 3 days (per the pre-go-live drill in §11 Phase 5), **When** tills continue operating throughout, **Then** no sale is lost, local storage does not corrupt on power loss, the operator sees a visible "offline beyond threshold" warning, and on reconnect the backlog uploads in batches with no timeout/overload failure.
2. **Given** a fleet-wide reconnect after a regional ISP outage, **When** all affected tills come back online, **Then** reconnect uses exponential backoff with jitter and the backend absorbs the burst without connection-pool exhaustion.

_(Covers NFR-003, NFR-004, NFR-007, NFR-010, NFR-014, EC-01, EC-02, EC-11, EC-12; corresponds to rollout Phase 5.)_

---

### User Story 7 — Consolidated Multi-Store Reporting for HQ (Priority: P3)

**Journey**: HQ views sales, inventory, and reconciliation data across all 16 stores from a single dashboard; reports are exportable and can be scheduled.

**Why this priority**: Full reporting is Phase 4 — the pilot store can operate on lightweight reports; the consolidated multi-store dashboard becomes valuable once several stores are live.

**Independent Test**: With sales data from at least 2 stores, run each report type (sales, inventory, till reconciliation) and verify: it segments correctly, exports as CSV and PDF, and completes within the SLA to be defined during planning.

**Acceptance Scenarios**:

1. **Given** sales data from multiple stores, **When** HQ opens the consolidated dashboard, **Then** it shows totals segmentable by store, till, cashier, SKU/category, and hour/day, all sourced from the cloud-synced picture.
2. **Given** any completed report, **When** the user requests export or schedules delivery, **Then** the report is produced in CSV and PDF and can be scheduled for email delivery.

_(Covers FR-029…FR-034; corresponds to rollout Phase 4.)_

---

### User Story 8 — Canary Deploy of a New App/Schema Version (Priority: P3)

**Journey**: A new version is deployed first to a single pilot store, tills on old and new schema versions sync against the same backend without error, and rollout proceeds in stages.

**Why this priority**: A workflow/ops user story rather than a customer-facing one, but it is the mechanism by which every future change reaches production safely.

**Independent Test**: Deploy version N+1 to one pilot store while the other 15 remain on N; produce sales from both cohorts; verify the backend accepts events from both schema versions and no store on either version experiences data loss or upgrade failure.

**Acceptance Scenarios**:

1. **Given** a new app/schema version is deployed, **When** it is rolled out, **Then** it goes to exactly one pilot store first, tills on the old and new schema version can both sync against the same backend without error (backward-compatible migration), and rollout to the remaining 15 stores is staged, never simultaneous.
2. **Given** an "offline for 3 days" drill has been executed on the pilot store, **When** its result is captured in the rollout record, **Then** rollout may progress to further stores; without a passed drill, rollout is blocked.

_(Covers NFR-013, NFR-015, EC-13; corresponds to rollout Phase 5.)_

---

### User Story 9 — Offline Cashier Login, Shift Open & Cash-Up (Priority: P1)

**Journey**: A cashier logs in at a till, opens their shift with a declared opening float, sells throughout the shift, then performs cash-up at the end — all with zero network connectivity, using credentials cached at the till's last successful sync. The till's own connection to PowerSync uses a separate, long-lived device credential and MUST NOT force the cashier to re-authenticate mid-shift when the sync layer reconnects.

**Why this priority**: Hard prerequisite for User Story 1. A till that cannot authenticate a cashier or open/close a shift offline cannot sell offline. This is the mechanism that makes cashier attribution and cash accountability work in the offline-first model, and it is the boundary between the device-level PowerSync credential (EC-10) and the human identity used for shift and sale attribution.

**Independent Test**: Provision a till with a synced user roster, disconnect it from WAN, log in as a cashier using a locally-cached PIN, open a shift with a declared opening float, complete 20 sales, close the shift with cash-up, reconnect, and verify: the login was validated against the cached credential (no network call), and the shift-open and shift-close records synced exactly once with correct cashier attribution and correct over/short calculation.

**Acceptance Scenarios**:

1. **Given** a till has a cached user roster from its last successful sync and is now offline, **When** a cashier enters valid credentials (PIN or password), **Then** the till authenticates them against the cached, hashed credential locally with no network call and grants access appropriate to their role.
2. **Given** a cashier is logged in on an offline till, **When** they open a shift with a declared opening float and later perform cash-up, **Then** both operations write append-only shift lifecycle events locally with cashier attribution and are queued for idempotent sync — no operation blocks on connectivity.
3. **Given** a cashier record was updated at HQ (new hire, PIN change, or role change) while a till was offline, **When** the till is still offline, **Then** the update does not take effect at that till; the affected cashier cannot log in with the new credential, and staff are trained on this behaviour. Once the till syncs, the update becomes effective.
4. **Given** the sync layer needs to re-authenticate to PowerSync after an extended offline stretch, **When** it does so, **Then** it uses the till's device-level credential and MUST NOT force the currently-logged-in cashier to re-enter their PIN.

_(Covers FR-008, FR-035, FR-040, FR-041, FR-042, NFR-003, NFR-009; corresponds to rollout Phase 1.)_

---

### Edge Cases

Grouped by category; each MUST be covered by a test before go-live.

**Connectivity**

- EC-01: Rapid connect/disconnect ("flapping") MUST NOT thrash or double-fire the upload queue — reconnect attempts are debounced.
- EC-02: App/device restart mid-upload MUST resume the queue from disk; a crash mid-sync MUST NOT lose or duplicate events.
- EC-03: Each till (or the store's shared uplink) needs its own working path to the internet; shared cellular failover is the store-level mitigation, not a per-till guarantee.

**Ordering & causality**

- EC-04: If `transfer_in` reaches the server before `transfer_out` due to network timing, stock totals remain correct, but the in-transit status shown in the UI MUST be driven by a server-side state machine on the paired events — never raw arrival order — so a manager can never see "received" before "dispatched."
- EC-05: A stock count's delta MUST be computed against the till's full local ledger, including its own unsynced pending events.
- EC-19: Concurrent HQ price changes for the same SKU produce multiple `price_versions` rows. Resolution order is deterministic: `store_id IS NOT NULL` before `store_id IS NULL` (store override wins over global), then `effective_from DESC`, then `server_ts DESC`. All versions are retained; the audit log carries every change.

**Data integrity & isolation**

- EC-06: PowerSync sync rules MUST be correctly scoped per `store_id`/`till_id`; this boundary has no Hub as backup, so it requires explicit test coverage before rollout.
- EC-07: Event IDs MUST NOT collide across cloned/imaged devices during bulk provisioning. Use `till_id + local_sequence_number` composite keys rather than bare random UUIDs if devices are imaged rather than individually provisioned.
- EC-16: Reports over a date range MUST carry a `provisional_until_server_ts` marker while any till has been offline through that range. A daily total for day D is definitive only once no till in the fleet has an unresolved offline stretch overlapping D. Backfilled events silently rewrite historical totals otherwise; this marker is a report-layer contract, not a mutation of stored data.

**Identity & provisioning**

- EC-08: A till MUST NOT run longer than a defined threshold of hours without at least attempting a sync; a documented recovery procedure (pull the local queue before wiping/replacing a device) must exist.
- EC-09: A new till onboarding while its store is offline is a real constraint (not a gap): initial catalog/price/stock pull requires connectivity (FR-039).

**Auth**

- EC-10: Two credentials coexist at every till and MUST be kept strictly distinct: (a) a **device-level credential** issued to the till itself and used to authenticate to PowerSync — long-lived so a till offline for multiple days can resume sync on reconnect without human re-auth; (b) a **cashier credential** (PIN or password) used for cashier login at the start of a shift, validated locally against a cached, hashed copy pulled during the till's last sync. Local sale, shift, login, and cash-up operations MUST NOT require a live auth token or any network call.
- EC-14: Cashier credential and roster updates (new hire, PIN change, role/permission change, off-boarding) take effect at a till only after the till has synced. A newly-hired cashier cannot log in at an offline till until that till reconnects; an off-boarded cashier remains valid at an offline till until the same sync. This is a documented, trained-for constraint, and the offline-threshold policy (EC-08) bounds how stale the local roster can become.
- EC-17: The till app MUST perform an NTP sync at least every 12 hours while online, MUST persist its last-known-reliable timestamp, and MUST refuse to record new sales, shift lifecycle events, or promotion evaluations if current local time differs from that timestamp by more than 15 minutes. Effective-dated prices, promotion end-times, and shift boundaries all depend on a trustworthy till clock; a skewed clock silently corrupts them.
- EC-18: Sync-health snapshots (`sync_health_snapshots`) MUST NOT share the general PowerSync upload queue with sales/shift/stock events. During a fleet-wide reconnect the observability data must not be stuck behind the very backlog it describes. Snapshots go via a dedicated lightweight `POST /internal/sync-health-snapshot` endpoint. Rate limit: ≤ 1 snapshot per 10 s per till; server-side dedup by `snapshot_id`.

**Scale & backlog**

- EC-11: A till offline for days MUST upload its backlog in batches, not a single burst that could time out or overload the backend.
- EC-12: A regional outage causing simultaneous fleet-wide reconnects MUST be handled with exponential backoff _plus jitter_; backend connection pooling MUST be sized for peak simultaneous reconnects, not steady-state load.
- EC-15: Under fleet-wide reconnect load (up to ~64 tills reconnecting simultaneously), upload batches MUST be bounded (≤ 100 events, 250 ms inter-batch pause); backoff jitter width MUST be ≥ 30 s on attempt 1 and grow with attempt number; the backend connection pool MUST be sized for peak simultaneous reconnect (target: 150-connection transaction-mode pool, 300 `max_connections`), validated during the Phase 5 drill.

**Rollout & schema**

- EC-13: Staged/canary deploys mean tills on different app/schema versions sync against the same backend concurrently; all schema migrations during rollout MUST be backward-compatible.
- EC-20: A column referenced in a PowerSync sync rule MUST have been present in the schema for at least one prior released app version before the sync rule that references it is deployed. Stricter statement of the general backward-compatible-migrations rule (Principle IV, NFR-015) specifically for the sync-rule ↔ schema coupling.

---

## 4. Functional Requirements _(mandatory)_

Requirements are numbered for traceability (FR-xxx). Each is independently testable.

### 4.1 Point of Sale (Core)

- **FR-001**: System MUST support product lookup by barcode scan, SKU entry, and name search.
- **FR-002**: System MUST support both quantity-based and weight-based line items in the cart.
- **FR-003**: System MUST support cash, card, and mobile money (MTN, Airtel) tender types, including split tender across multiple types in a single transaction.
- **FR-004**: System MUST support line-level and basket-level discounts.
- **FR-005**: System MUST support voids, returns, and refunds, gated by manager/approval thresholds where configured.
- **FR-006**: System MUST support holding/parking a sale and resuming it later at the same or a different till session on the same device.
- **FR-007**: System MUST support physical receipt printing and an optional digital receipt.
- **FR-008**: System MUST support shift/till management: opening float declaration, cash-up, and over/short reporting.
- **FR-009**: System MAY support an optional customer-facing display.
- **FR-010**: No checkout code path may block on a network call (ties to NFR-001).
- **FR-011**: A void MUST only be issuable from the same till session that created the original sale (US1 §2, US5).
- **FR-012**: A refund against a sale from a different till or a prior day MUST require live connectivity to confirm the original sale exists server-side before proceeding.
- **FR-040**: Cashier authentication at the till MUST succeed offline using credentials cached from the till's last successful sync; the login code path MUST NOT perform any network call and MUST NOT depend on a live auth token (US9, EC-10).
- **FR-041**: Shift open (with opening float declaration), shift close (cash-up), and over/short calculation MUST all complete fully offline. Shift lifecycle events MUST be persisted as append-only records with cashier attribution and queued for idempotent sync (§8.1).
- **FR-042**: A cashier user record created or modified at HQ MUST NOT be usable at a till until that till has synced the update (EC-14). This staleness state MUST be surfaced to store managers via the sync-health dashboard so a "cashier missing at till" report during onboarding is diagnosable, not mysterious.
- **FR-043**: Cashier credentials MUST be stored at the till as a salted hash only; the plaintext PIN or password MUST NOT be persisted, logged, or transmitted. Failed-login lockout MUST operate locally so it cannot be bypassed by taking the till offline.
- **FR-044**: The till app MUST synchronise its system clock via NTP at least every 12 hours while online, MUST persist its last-known-reliable timestamp, and MUST refuse to record new sales, shift lifecycle events, or promotion evaluations if current local time differs from the last-known-reliable timestamp by more than 15 minutes. This is the client-side complement to the `server_ts` financial-ordering rule (EC-17).

### 4.2 Inventory & Stock Management

- **FR-013**: System MUST maintain a per-store stock position derived from an append-only stock-event ledger (§8), not a directly-editable "current stock" field.
- **FR-014**: System MUST support the inter-store transfer workflow: request → dispatch → in-transit → receive/confirm, with variance captured as a distinct event at receipt (US4).
- **FR-015**: System MUST support central-warehouse-to-store replenishment using the same event model.
- **FR-016**: System MUST support stock counts / cycle counts, recorded as `count_correction` events, shown as a distinct line in reconciliation reports — never merged into ordinary shrinkage figures.
- **FR-017**: System MUST support stock adjustments with mandatory reason codes and an approval chain for adjustments above a configurable threshold.
- **FR-018**: System MUST generate low-stock/reorder alerts based on derived stock levels and configured thresholds.
- **FR-019**: System MUST support supplier/procurement linkage for replenishment.
- **FR-020**: System MUST support batch and expiry tracking for FMCG/perishable SKUs.
- **FR-021**: System MUST NOT block a sale locally due to insufficient stock while offline; oversell is allowed and auto-flagged (US3, §8.3).
- **FR-022**: System MUST surface any SKU with negative derived stock as an "Oversold" status on the Inventory Dashboard, distinct from ordinary low-stock alerts.

### 4.3 Price Engine

- **FR-023**: System MUST maintain a central price list per SKU with optional store-level overrides.
- **FR-024**: System MUST propagate price changes to all POS terminals when online, and on reconnect for terminals that were offline at time of change.
- **FR-025**: System MUST support a promotions engine covering date-ranged discounts, BOGO variants (buy-1-get-1-free, buy-2-get-1-half-price), bundle pricing, and loyalty-tier pricing.
- **FR-026**: System MUST maintain a full price-change audit trail: who changed it, when, and the old value → new value.
- **FR-027**: System MUST support effective-dated pricing, allowing a price change to be scheduled for a future date/time.
- **FR-028**: A completed sale MUST permanently retain the price active on the till at time of sale; no retroactive re-pricing after the fact (US2).

### 4.4 Reporting

- **FR-029**: System MUST provide sales reports segmentable by store, till, cashier, SKU/category, and hour/day.
- **FR-030**: System MUST provide inventory reports: stock on hand, transfer history, and variance/shrinkage — with count-correction events shown separately from other shrinkage causes.
- **FR-031**: System MUST provide a consolidated multi-store dashboard for head office.
- **FR-032**: System MUST provide till reconciliation reports comparing cash-up figures against system totals.
- **FR-033**: Reports MUST be exportable as CSV and PDF, and support scheduled email delivery.
- **FR-034**: Report generation MUST meet a defined SLA (see NFR-002; exact figures to be set during planning).

### 4.5 Supporting Modules

- **FR-035**: System MUST support user/role management for cashier, store manager, and HQ admin roles, each with distinct permissions.
- **FR-036**: System MUST maintain store/branch master data.
- **FR-037**: System MAY support customer management, including optional loyalty and credit accounts.
- **FR-038**: System MUST maintain a system-wide, immutable audit log covering price changes and stock adjustments at minimum.
- **FR-039**: A fresh/new till onboarding MUST require live connectivity for its initial catalog/price/stock pull; there is no local device to seed from (no Hub design — §9).

---

## 5. Non-Functional Requirements

- **NFR-001 (Performance)**: Scan-to-total transaction time target < 2 seconds. No checkout path blocks on network I/O.
- **NFR-002 (Performance)**: Report generation SLA to be defined per report type during planning; large multi-store reports may run asynchronously.
- **NFR-003 (Availability)**: Full offline sale + stock deduction at the till with zero connectivity (see §8, §9).
- **NFR-004 (Durability)**: Local data (SQLite, WAL mode) MUST survive power loss without corruption.
- **NFR-005 (Independence)**: Each till syncs independently, directly to PowerSync/Supabase; no dependency on any other till or local coordinating device.
- **NFR-006 (Isolation)**: Cross-till/cross-store stock visibility is admin-panel-only, resolved via cloud sync; tills never see each other's state, on LAN or otherwise.
- **NFR-007 (Resilience)**: Secondary/cellular failover connection recommended per store (shared uplink).
- **NFR-008 (Scalability)**: Must support 16 stores at launch with headroom for additional stores, and multiple concurrent tills per store.
- **NFR-009 (Security)**: Role-based access control across all modules; data encrypted at rest and in transit; PCI-relevant handling wherever card payment data touches the POS.
- **NFR-010 (Integrity)**: Transaction logs are immutable. Full audit trail for price changes and stock adjustments. Sync operations are idempotent and safely retryable — no double-application of stock deductions on retry.
- **NFR-012 (Usability)**: Minimal-click cashier flow; fast onboarding/training time for new cashiers.
- **NFR-013 (Maintainability)**: Centralized configuration and deployment management across 16 sites; canary/staged rollout — never a big-bang deploy to all stores.
- **NFR-014 (DR/Backup)**: Local data must survive extended HQ-connectivity loss (days, not just hours). Central database has automated backups and a tested restore procedure. A till offline beyond a defined threshold surfaces an operator-visible warning.
- **NFR-015 (Deployment)**: Schema migrations during staged rollout MUST be backward-compatible, since old- and new-version tills sync against the same backend concurrently.

---

## 6. Key Entities / Data Model

| Entity                              | Key Attributes                                                                                                                                      | Notes                                                                                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Store**                           | `store_id`, name, address, region                                                                                                                   | Master data; scopes PowerSync sync rules                                                                                                                                                                      |
| **Till**                            | `till_id`, `store_id`, device identity, device-level credential                                                                                     | One row per physical/logical till; owns its own local SQLite + PowerSync client                                                                                                                               |
| **SKU / Product**                   | `sku_id`, name, barcode, category, unit type (qty/weight), batch/expiry fields                                                                      | Central catalog, store-scoped subset synced per till                                                                                                                                                          |
| **Price**                           | `sku_id`, `store_id` (nullable = global), value, `effective_from`, version                                                                          | Versioned and effective-dated; never mutated in place — new version supersedes                                                                                                                                |
| **Promotion**                       | type (date-range / BOGO / bundle / loyalty-tier), applicable SKUs, date range                                                                       | Feeds the price engine at time of sale                                                                                                                                                                        |
| **Stock Event** (append-only, §8.1) | `event_id` (client UUID or `till_id`+`local_sequence_number`), `store_id`, `sku_id`, `till_id`, `event_type`, `delta_qty`, `client_ts`, `server_ts` | Source of truth for stock; `current_stock` is derived, never stored raw                                                                                                                                       |
| **Sale / Transaction**              | `sale_id`, `till_id`, `cashier_id`, line items, tender(s), stamped price(s), status (completed/void/refunded)                                       | Immutable once completed; voids/refunds are new linked records, not mutations                                                                                                                                 |
| **Transfer**                        | `transfer_id`, source store, destination store, requested/dispatched/in-transit/received qty, variance                                              | State machine driven server-side from paired `transfer_out`/`transfer_in` events                                                                                                                              |
| **Shift**                           | `till_id`, `cashier_id`, opening float, closing cash-up, over/short                                                                                 | Shift open and cash-up are append-only lifecycle events per §8.1 — the row is the projection; the events are the source of truth. Fully offline-capable (US9).                                                |
| **User**                            | `user_id`, role (cashier / store manager / HQ admin), permissions, salted-hash credential                                                           | Locally-cached copy per till holds hashed credential and role for cashiers assigned to that store; refreshed on every sync. HQ-side changes take effect at a till only after that till syncs (EC-14, FR-042). |
| **Audit Log Entry**                 | actor, action, `old_value`, `new_value`, timestamp                                                                                                  | Immutable                                                                                                                                                                                                     |

---

## 7. Architecture Decisions (Summary)

| Layer                  | Decision                                                                              | Rationale                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend/App           | Next.js, TypeScript                                                                   | Reuse of proven Harvest LPG ERP pattern                                                                                                             |
| Terminal OS            | **Windows** (10/11 IoT Enterprise or Pro)                                             | Corrects earlier Android assumption; matches project's actual hardware direction and OPOS/UPOS ecosystem                                            |
| App shell              | **Tauri 2** with **PowerSync Tauri SDK** (alpha, accepted risk)                       | Lighter footprint than Electron; native filesystem SQLite persists across updates. Electron + Node.js SDK is the documented fallback (see Phase 0a) |
| Local client-side data | Plain SQLite via PowerSync watched-query hooks                                        | No TanStack DB or extra client-side layer                                                                                                           |
| Kiosk lockdown         | Windows Assigned Access / Shell Launcher                                              | Locks terminal to POS app only                                                                                                                      |
| Fleet MDM              | Microsoft Intune                                                                      | Silent remote deploy + kiosk config across 16 sites                                                                                                 |
| OTA updates            | Tier 1: Tauri updater plugin (JS bundle, delta + code-signed); Tier 2: Intune (shell) | Same canary discipline as backend deploys; only applied at till-idle safe points                                                                    |
| Backend                | Supabase / Postgres                                                                   | Reuse of proven pattern; logical replication required for PowerSync                                                                                 |
| Offline sync           | SQLite (local-first, per till) + PowerSync Tauri SDK                                  | Enables NFR-003/004/005 without hand-rolled sync protocol                                                                                           |
| Conflict resolution    | Additive stock-event deltas, never last-write-wins overwrites                         | Makes concurrent offline writes commutative (§8)                                                                                                    |
| Store topology         | No coordinator/Hub device — every till connects independently                         | Removes a per-store single point of failure; trade-off documented in §9                                                                             |
| Integration            | Standalone; no SAP B1                                                                 | Own financial/sales reporting stack                                                                                                                 |

All decisions here are ratified by the Constitution (v1.1.0) and MUST NOT be changed without a constitutional amendment.

---

## 8. Conflict Resolution Rules (Stock Events)

Core principle: **stock changes are additive delta events, never absolute overwrites.**

### 8.1 Ingest rule

Postgres upserts on `event_id`. A duplicate `event_id` arriving twice (e.g., retried after a dropped ack) is a no-op — this is what makes sync idempotent (NFR-010).

### 8.2 Rules by scenario

| Scenario                          | Rule                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overselling while offline         | Sale is never blocked locally. `current_stock` may go negative once synced. SKU is auto-flagged "Oversold" for manager review (FR-021, FR-022). Treated as a business/ops issue, not a system fault.                                                                 |
| Stock count / physical correction | `delta_qty = counted_qty − full local ledger total (including unsynced pending events)`, tagged `count_correction`. Always shown as a distinct reconciliation line, never merged into shrinkage (FR-016).                                                            |
| Transfers                         | `transfer_out` fires at dispatch (source); `transfer_in` fires only at confirmed receipt (destination). Stock is "in transit" between the two — not sellable at either store. Variance at receipt is its own event, never absorbed into `transfer_in` (FR-014, US4). |
| Price during offline sale         | Till uses its last-synced cached price; that price is stamped permanently onto the sale. No retroactive re-pricing on reconnect (FR-028).                                                                                                                            |
| Voids                             | Same-till-session only (FR-011).                                                                                                                                                                                                                                     |
| Refunds across tills/days         | Requires connectivity to confirm the original sale server-side first — the one intentionally non-offline-capable flow (FR-012).                                                                                                                                      |
| Clock skew                        | `client_ts` is for on-device debugging only. `server_ts`, assigned on ingest, is authoritative for financial ordering and reporting.                                                                                                                                 |

---

## 9. Sync Topology — Independent Per-Till Sync

**Decision**: No Store Hub / coordinator device. Each till has its own local SQLite, its own PowerSync client, its own direct connection to Supabase.

- Cross-till and cross-store stock visibility is admin-panel-only (NFR-006); tills never communicate with each other, on LAN or otherwise.
- During a WAN outage, each till only knows its own local state — an accepted trade-off, since cross-till visibility was never a cashier-facing need.
- **Removed** vs. a Hub design: coordinator hardware to provision/patch/fail per store, election logic.
- **Changed**: cloud connection count per store goes from 1 (Hub) to N (every till); sync-health monitoring must be per-till, not per-store, for precise fault isolation.
- **Real cost**: no local device buffers recent events. A till that is lost, bricked, or stolen with unsynced sales in its queue loses that data permanently. This requires an explicit ops policy (§12).

---

## 10. Success Criteria _(mandatory — measurable, technology-agnostic)_

### Measurable Outcomes

- **SC-001**: 100 % of sales attempted at a pilot till during a 3-day disconnected-from-WAN drill complete successfully, print or issue a receipt, and appear exactly once server-side after reconnect (no duplicates, no losses).
- **SC-002**: 95 % of scan-to-total transactions complete in under 2 seconds on the target terminal hardware, measured across a representative daily traffic sample.
- **SC-003**: After a fleet-wide simultaneous reconnect from a simulated regional ISP outage, 100 % of tills successfully upload their backlogs without operator intervention and the backend absorbs the reconnect burst without dropping requests.
- **SC-004**: For any concurrent-offline oversell scenario across two or more tills, the derived `current_stock` after both tills sync equals the exact sum of the deltas involved, and the affected SKU is surfaced as "Oversold" on the Inventory Dashboard within one sync cycle.
- **SC-005**: Every completed sale in the system carries the price that was cached on the till at time of sale; a random-sample audit of 100 sales across pre- and post-price-change windows shows zero retroactive re-pricing.
- **SC-006**: Every price change and every stock adjustment above the approval threshold has a complete audit-log entry (actor, timestamp, old → new, scope); an audit spot-check of 50 changes shows 100 % completeness.
- **SC-007**: HQ can open the consolidated multi-store dashboard and see totals across all live stores; each defined report meets its per-report SLA (to be set during planning) at representative data volume.
- **SC-008**: Rollout progresses one pilot store first and never simultaneously across the remaining fleet; a rollout record exists for each store containing the pilot soak result, the offline drill result, and the schema-compatibility verification.
- **SC-009**: A newly-provisioned till, previously unknown to the system, requires no more than one operator-assisted connectivity session to complete its initial catalog/price/stock pull and reach an operational state.
- **SC-010**: New cashiers, given the standard training pack, reach independent operation on the till (successful shift open, minimum 20 sales without supervisor intervention, correct cash-up) within a defined training-time target to be set during planning.
- **SC-011**: During an offline drill, 100 % of cashier login, shift-open, and shift-close operations complete locally against cached credentials with no network dependency, and on reconnect every shift lifecycle event syncs exactly once with correct cashier attribution and correct over/short reconciliation.

---

## 11. Rollout Plan (Milestones)

| Phase                                                      | Scope                                                                                                                                                                                                                              | Exit Criteria                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0a — Offline-write spike** (before all other work) | Smallest possible end-to-end slice on the actual Tauri + PowerSync Tauri SDK stack: one till, one offline sale, sync on reconnect. Purpose: surface any blocking alpha-SDK instability before the rest of the MVP is built on top. | One offline sale completes locally, syncs exactly once on reconnect. If BLOCKED: fall back to Electron + PowerSync Node.js SDK (documented in [research.md §1](research.md)) — this decision MUST be made here, not later. |
| **Phase 0 — Foundation**                                   | Auth/roles, store & till master data, local DB schema, PowerSync sync rules per store, basic sync-health screen                                                                                                                    | Sync rules verified isolated per store (EC-06)                                                                                                                                                                             |
| **Phase 1 — MVP core** (1 pilot store)                     | Offline-capable checkout/POS (US1), shift/cash-up, read-only centrally-set price list (US2 basic)                                                                                                                                  | A full offline sale + reconnect sync cycle passes on real hardware                                                                                                                                                         |
| **Phase 2 — Inventory** (pilot store)                      | Stock counts, adjustments, low-stock alerts, oversell flagging (US3)                                                                                                                                                               | Overselling scenario (US3 §1) verified end-to-end                                                                                                                                                                          |
| **Phase 3 — Multi-store**                                  | Inter-store transfers (US4), full price engine (US2 promotions, effective-dated pricing, audit trail), per-till sync rolled to additional stores                                                                                   | Transfer variance and in-transit state machine (EC-04) verified across two real stores                                                                                                                                     |
| **Phase 4 — Reporting**                                    | Sales/inventory reports, till reconciliation, HQ multi-store dashboard (US7)                                                                                                                                                       | Report SLA (NFR-002) met against representative data volume                                                                                                                                                                |
| **Phase 5 — Hardening & full rollout**                     | DR drills ("offline for 3 days", US6), alerting, canary deploy tooling (US8), staged rollout to remaining stores                                                                                                                   | 3-day offline drill passes with zero data loss; canary deploy proven on 1 store before wider rollout                                                                                                                       |

---

## 12. Operational Policies (from Edge Cases)

- **Offline threshold policy**: define the maximum hours a till may run without attempting a sync before it is flagged and staff are alerted (ties to EC-08, NFR-014).
- **Device loss/recovery procedure**: documented steps to attempt to pull a local queue before wiping or replacing a device suspected lost, bricked, or stolen.
- **Health dashboard**: per-till (not just per-store) connectivity, sync lag, and last-successful-sync timestamp, with fast alerting (e.g., WhatsApp/SMS webhook).
- **Cashier training**: explicitly cover the two non-obvious behavioral flows — (a) overselling is possible and is a normal, trained-for ops scenario, not a bug; (b) cross-till/day refunds require connectivity.

---

## 13. Clarifications

All items originally open have been resolved prior to this spec being finalized:

| #   | Question                                                       | Resolution                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Sync engine choice                                             | PowerSync, syncing against Supabase/Postgres (§7)                                                                                                                                                                                          |
| 2   | Conflict-resolution model for concurrent offline stock changes | Additive stock-event deltas, never overwrites (§8)                                                                                                                                                                                         |
| 3   | MVP build order / rollout plan                                 | Single pilot store first, phased expansion (§11)                                                                                                                                                                                           |
| 4   | Terminal hardware & network spec                               | **Windows** POS terminals (Windows 10/11 IoT Enterprise or Pro), Tauri shell, PowerSync Tauri SDK (alpha, with Electron/Node.js SDK fallback); dual-WAN per store with cellular failover (see Constitution v1.1.0 §Additional Constraints) |
| 5   | Cross-till/store visibility design                             | Independent per-till sync; visibility is admin-panel-only, no Hub (§9)                                                                                                                                                                     |
| 6   | Sync data-flow edge cases                                      | Full catalog closed (§3 Edge Cases)                                                                                                                                                                                                        |

No open items remain for planning to begin. Any new ambiguity discovered during implementation should be logged here with its resolution before the affected code is merged.

---

## 14. Out of Scope (Explicit)

- SAP B1 integration of any kind.
- **ZRA Smart Invoice / VSDC fiscalisation** — deliberately deferred to a **companion spec (`002-fiscalisation`, planned)**. This MVP spec is developed and tested without fiscalisation. Per Constitution v1.0.0 Principle V, fiscalisation is a compliance gate for shipping the sales module to a live store: **pilot go-live is blocked** until the companion spec lands. NFR-011 in this document remains as a forward reference to that gate; it is not something this spec builds.
- Any till-to-till or LAN-local communication or a store-level coordinator/Hub device.
- Final hosting contract, terminal procurement vendor selection, and per-store ISP contracts (hardware/network _requirements_ are specified in the Constitution §Additional Constraints; procurement execution is not part of this spec).
- Loyalty program business rules beyond loyalty-tier pricing as an input to the price engine.
- Cashier-facing cross-till stock visibility (deliberately admin-panel-only per NFR-006).

---

## 15. Assumptions

- The target **Windows POS terminal hardware** described in the Constitution (§Additional Constraints v1.1.0) will be procured and provisioned per store, enrolled to Microsoft Intune, and locked down via Windows Assigned Access / Shell Launcher. This spec assumes the hardware baseline is met, not something this spec has to prove.
- The **PowerSync Tauri SDK is currently alpha** (accepted risk, Constitution v1.1.0). Phase 0a (§11) validates the offline-write path against the actual SDK before any other work. If Phase 0a fails, the pre-authorised fallback is Electron + PowerSync's Node.js SDK; the switch decision is made at Phase 0a, not later.
- Supabase logical replication will be enabled for the deployment's Postgres instance, since PowerSync requires it.
- ZRA Smart Invoice / VSDC fiscalization is implementable through the same integration approach already proven on the Harvest LPG ERP; no novel fiscalization work is expected here beyond wiring it in.
- Each store has, or will have, both a primary ISP link and a 4G/LTE failover router; where a store lacks the failover today, that gap is treated as a rollout blocker for that store, not a system defect.
- Store staff will be trained on: (a) same-till-session voids being offline-capable while cross-till/day refunds are not, (b) overselling being an expected, manager-followed-up scenario rather than a bug, (c) cashier roster changes at HQ take effect at a till only after that till has synced (EC-14).
- Reporting SLA figures and training-time targets referenced in §10 will be finalized during planning; they are placeholders here so success criteria can be stated up-front and refined without re-specifying the feature.
- Cashier authentication is a PIN or password held at the till only as a salted hash (FR-043). The PIN policy (length, rotation cadence, lockout threshold on failed attempts, replay of a returning cashier's PIN) will be finalised during planning; it MUST at minimum align with the Constitution's PCI-relevant handling stance for tills that also process card payments.
- The maximum offline-threshold policy (per EC-08) implicitly bounds cashier-roster staleness (per EC-14); tightening one tightens the other. Both numbers will be set together during planning.

---

## 16. Review & Acceptance Checklist

- [ ] Every FR has at least one corresponding scenario or edge case it can be tested against.
- [ ] Every NFR has a measurable or observably-testable condition (see §10).
- [ ] Stock-event model (§6, §8) reviewed against all oversell/count/transfer scenarios in §3.
- [ ] Sync topology (§9) trade-offs (no Hub, per-till data loss risk) acknowledged and an operational mitigation exists (§12).
- [ ] Rollout plan (§11) confirms pilot-store-first with no phase requiring simultaneous multi-store go-live.
- [x] Fiscalisation (NFR-011) explicitly deferred to companion spec `002-fiscalisation`; blocks pilot go-live, not MVP build (§14).
- [ ] No open clarifications remain (§13) before planning/tasks generation proceeds.
- [ ] Constitution v1.0.0 principles (I–VII) map cleanly to at least one FR/NFR or User Story each.
