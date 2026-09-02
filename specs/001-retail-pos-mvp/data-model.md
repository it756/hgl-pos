# Phase 1 Data Model — Retail POS 001-retail-pos-mvp

**Purpose**: Concrete Postgres schema for the MVP. Every table is either **master data** (mutable, HQ-owned), an **event table** (append-only, immutable), or a **projection** (derived from events by trigger, safe to read but never manually edited).

Naming: `snake_case`. Timestamps: `timestamptz` (Postgres stores UTC). UUIDs: `uuid`, generated client-side (never `gen_random_uuid()` server-side for events — the client owns `event_id`). Money: `numeric(14, 2)` for currency, `numeric(14, 4)` for unit prices where fractional currency matters. Quantities: `numeric(14, 3)` to support weight-based lines (FR-002).

All event tables carry the same required columns:

```sql
event_id     uuid    PRIMARY KEY,          -- client-generated, dedup key
till_id      uuid    NOT NULL,             -- origin till (writer)
store_id     uuid    NOT NULL,             -- for sync-rule partitioning
client_ts    timestamptz NOT NULL,         -- device local time; debugging only
server_ts    timestamptz NOT NULL DEFAULT now(),  -- authoritative for money math
app_version  text    NOT NULL,             -- for canary diagnostics
schema_ver   int     NOT NULL              -- for backward-compat detection
```

## 1. Master data (mutable, HQ-owned)

### 1.1 `stores`

| Column                                | Type                                    | Notes                           |
| ------------------------------------- | --------------------------------------- | ------------------------------- |
| `store_id`                            | uuid PK                                 |                                 |
| `code`                                | text UNIQUE NOT NULL                    | Human-readable e.g. `HG-LSK-01` |
| `name`                                | text NOT NULL                           |                                 |
| `region`                              | text                                    |                                 |
| `timezone`                            | text NOT NULL DEFAULT `'Africa/Lusaka'` | Drives trading-hours logic      |
| `offline_threshold_minutes_trading`   | int NOT NULL DEFAULT 240                | For alerts, EC-08               |
| `offline_threshold_minutes_overnight` | int NOT NULL DEFAULT 1440               |                                 |
| `created_at` / `updated_at`           | timestamptz                             |                                 |

### 1.2 `tills`

| Column                   | Type                        | Notes                                                                                                                      |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `till_id`                | uuid PK                     |                                                                                                                            |
| `store_id`               | uuid FK → `stores` NOT NULL |                                                                                                                            |
| `label`                  | text NOT NULL               | e.g. `Till 3`                                                                                                              |
| `device_identity`        | text UNIQUE NOT NULL        | Windows machine identifier — SMBIOS UUID (preferred) or a stable derivation of hardware serial + Intune-assigned device ID |
| `device_credential_hash` | text NOT NULL               | Argon2id hash of the PowerSync device credential                                                                           |
| `local_sequence_hwm`     | bigint NOT NULL DEFAULT 0   | Last observed high-water sequence for this till's events (server-side)                                                     |
| `provisioned_at`         | timestamptz                 |                                                                                                                            |
| `retired_at`             | timestamptz                 | Nullable — set on device retirement, not delete                                                                            |

### 1.3 `users`

| Column                      | Type                                                                   | Notes                              |
| --------------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `user_id`                   | uuid PK                                                                | Same identity Supabase Auth uses   |
| `role`                      | text NOT NULL CHECK (`role IN ('cashier','store_manager','hq_admin')`) |                                    |
| `store_id`                  | uuid FK → `stores`                                                     | NULL for `hq_admin`                |
| `full_name`                 | text NOT NULL                                                          |                                    |
| `pin_hash`                  | text NOT NULL                                                          | Argon2id, salt embedded; FR-043    |
| `pin_updated_at`            | timestamptz NOT NULL                                                   |                                    |
| `is_active`                 | boolean NOT NULL DEFAULT true                                          | Off-boarding = `false`, not delete |
| `created_at` / `updated_at` | timestamptz                                                            |                                    |

**Notes**: `pin_hash` is synced down to the till via `store_users[store_id]` bucket. The PIN itself never leaves the till plaintext, never touches Postgres. Local lockout state is till-local (see §3.7).

### 1.4 `skus`

| Column         | Type                                                       | Notes                                                           |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `sku_id`       | uuid PK                                                    |                                                                 |
| `code`         | text UNIQUE NOT NULL                                       | Human-readable SKU code                                         |
| `barcode`      | text                                                       | Nullable; some SKUs have multiple barcodes → see `sku_barcodes` |
| `name`         | text NOT NULL                                              |                                                                 |
| `category_id`  | uuid FK → `sku_categories`                                 |                                                                 |
| `unit_type`    | text NOT NULL CHECK (`unit_type IN ('quantity','weight')`) | FR-002                                                          |
| `track_batch`  | boolean NOT NULL DEFAULT false                             | FR-020                                                          |
| `track_expiry` | boolean NOT NULL DEFAULT false                             | FR-020                                                          |
| `is_active`    | boolean NOT NULL DEFAULT true                              |                                                                 |

### 1.5 `sku_barcodes`, `sku_categories`, `suppliers`, `sku_suppliers`

Straightforward join tables; details deferred until Phase 2 implementation (FR-018, FR-019).

### 1.6 `store_sku_availability`

| Column          | Type                          | Notes                         |
| --------------- | ----------------------------- | ----------------------------- |
| `store_id`      | uuid FK NOT NULL              |                               |
| `sku_id`        | uuid FK NOT NULL              |                               |
| `reorder_point` | numeric(14,3)                 | FR-018                        |
| `is_stocked`    | boolean NOT NULL DEFAULT true | Drives `store_catalog` bucket |
| PK              | (`store_id`, `sku_id`)        |                               |

### 1.7 `price_versions`

| Column               | Type                               | Notes                          |
| -------------------- | ---------------------------------- | ------------------------------ |
| `price_version_id`   | uuid PK                            | Stamped onto every sale line   |
| `sku_id`             | uuid FK NOT NULL                   |                                |
| `store_id`           | uuid FK                            | NULL = global default (FR-023) |
| `unit_price`         | numeric(14,4) NOT NULL             |                                |
| `currency`           | text NOT NULL DEFAULT `'ZMW'`      |                                |
| `effective_from`     | timestamptz NOT NULL               | FR-027                         |
| `created_by_user_id` | uuid FK → `users` NOT NULL         |                                |
| `created_at`         | timestamptz NOT NULL DEFAULT now() |                                |

**Strictly append-only** (Principle V). No `effective_to`, no `superseded_by` — a "price change" is a new row with a later `effective_from`. The active price at time `T` is resolved by this query, and this query alone (EC-19):

```sql
select *
from price_versions
where sku_id = $1
  and (store_id = $2 or store_id is null)
  and effective_from <= $3               -- time of sale
order by
  (store_id is null),                    -- store override wins over global
  effective_from desc,
  server_ts desc                          -- tie-break for same-instant HQ writes
limit 1;
```

### 1.8 `promotions`

| Column                            | Type                                                                                   | Notes                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `promotion_id`                    | uuid PK                                                                                |                                                                    |
| `type`                            | text NOT NULL CHECK (`type IN ('date_range_discount','bogo','bundle','loyalty_tier')`) | FR-025                                                             |
| `payload`                         | jsonb NOT NULL                                                                         | Type-specific config (e.g. `{"buy":1,"get":1,"discount_pct":100}`) |
| `applies_to_sku_ids`              | uuid[]                                                                                 | Or via `promotion_skus` join for large sets                        |
| `store_id`                        | uuid FK                                                                                | NULL = fleet-wide                                                  |
| `effective_from` / `effective_to` | timestamptz                                                                            |                                                                    |
| `is_active`                       | boolean NOT NULL DEFAULT true                                                          |                                                                    |

## 2. Event tables (append-only, immutable)

Every event table has the common columns above plus:

### 2.1 `stock_events`

The Principle II core.

| Column          | Type                                                                                                                                     | Notes                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Common          | (see above)                                                                                                                              |                                                                                                                                 |
| `sku_id`        | uuid FK NOT NULL                                                                                                                         |                                                                                                                                 |
| `event_type`    | text NOT NULL CHECK (`event_type IN ('sale','refund','transfer_out','transfer_in','transfer_variance','adjustment','count_correction')`) |                                                                                                                                 |
| `delta_qty`     | numeric(14,3) NOT NULL                                                                                                                   | Signed                                                                                                                          |
| `source_ref_id` | uuid                                                                                                                                     | FK-like reference to `sale_events.event_id` / `transfer_events.event_id` / `adjustment_events.event_id` (typed by `event_type`) |
| `batch_no`      | text                                                                                                                                     | If SKU tracks batches (FR-020)                                                                                                  |
| `expiry_date`   | date                                                                                                                                     | If SKU tracks expiry                                                                                                            |
| `reason_code`   | text                                                                                                                                     | Required for `adjustment` and `count_correction`                                                                                |
| `notes`         | text                                                                                                                                     |                                                                                                                                 |

Indexes:

- `(store_id, sku_id, server_ts)` — projection maintenance, oversell scans
- `(till_id, server_ts DESC)` — sync-health, per-till diagnostics
- `(source_ref_id)` — join to parent event

### 2.2 `sale_events`

| Column             | Type                                                                                                             | Notes                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common             | (see above)                                                                                                      |                                                                                                                                                       |
| `sale_id`          | uuid NOT NULL UNIQUE                                                                                             | Business ID exposed on receipts (equal to `event_id` for a `completed` sale; a matching `refund`/`void` event references this via `original_sale_id`) |
| `cashier_id`       | uuid FK → `users` NOT NULL                                                                                       |                                                                                                                                                       |
| `shift_id`         | uuid FK → `shifts` NOT NULL                                                                                      | Attribution to the shift projection                                                                                                                   |
| `status`           | text NOT NULL CHECK (`status IN ('completed','voided','refunded')`)                                              | Initial always `completed`; state change comes via a linked event, never in-place update                                                              |
| `items`            | jsonb NOT NULL                                                                                                   | Array of line items (see §2.2.1)                                                                                                                      |
| `tenders`          | jsonb NOT NULL                                                                                                   | Array of tender applications (see §2.2.2)                                                                                                             |
| `subtotal`         | numeric(14,2) NOT NULL                                                                                           |                                                                                                                                                       |
| `discount_total`   | numeric(14,2) NOT NULL DEFAULT 0                                                                                 |                                                                                                                                                       |
| `tax_total`        | numeric(14,2) NOT NULL DEFAULT 0                                                                                 | Placeholder — real fiscal breakdown ships with `002-fiscalisation`                                                                                    |
| `grand_total`      | numeric(14,2) NOT NULL                                                                                           |                                                                                                                                                       |
| `original_sale_id` | uuid                                                                                                             | Non-null on refund/void events; points at the sale being adjusted                                                                                     |
| `refund_kind`      | text CHECK (`refund_kind IS NULL OR refund_kind IN ('same_till_session_void','same_till_history','cross_till')`) | Constrains FR-011 / FR-012 enforcement                                                                                                                |

#### 2.2.1 Line item JSONB shape

```json
{
  "sku_id": "uuid",
  "price_version_id": "uuid",
  "unit_price": "numeric",
  "qty": "numeric",
  "line_discount": "numeric",
  "line_total": "numeric",
  "promotion_id": "uuid | null",
  "batch_no": "string | null",
  "expiry_date": "date | null"
}
```

`price_version_id` stamps the exact price version used — enforces FR-028 immutability.

#### 2.2.2 Tender JSONB shape

```json
{
  "type": "cash | card | mobile_money_mtn | mobile_money_airtel",
  "amount": "numeric",
  "reference": "string | null",
  "card_masked_pan": "string | null",
  "card_reader_token": "string | null"
}
```

`card_masked_pan` is at most last-4 digits. Full PAN, CVV, and track data MUST NOT be persisted — Principle VII / NFR-009. `card_reader_token` is a certified reader's token, opaque to the app.

**Every sale event also emits companion `stock_events`** (one per line) via `AFTER INSERT` trigger. `delta_qty` = `-qty` for a `completed` sale; `+qty` for a `refunded` sale (referencing `original_sale_id`).

Indexes:

- `(store_id, shift_id)` — cash-up
- `(cashier_id, server_ts DESC)` — cashier reports
- `(sale_id)` — refund lookup
- `(original_sale_id)` where non-null — void/refund chain

### 2.3 `shift_events`

| Column       | Type                                                               | Notes                                                                                                            |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Common       | (see above)                                                        |                                                                                                                  |
| `shift_id`   | uuid NOT NULL                                                      | Same for the open + close pair                                                                                   |
| `cashier_id` | uuid FK → `users` NOT NULL                                         |                                                                                                                  |
| `event_kind` | text NOT NULL CHECK (`event_kind IN ('shift_open','shift_close')`) |                                                                                                                  |
| `payload`    | jsonb NOT NULL                                                     | Open: `{"opening_float": 500.00}`; Close: `{"cash_counted": 8320.00, "tender_breakdown": {...}, "notes": "..."}` |

Pair enforcement: exactly one `shift_open` and at most one `shift_close` per `shift_id`, enforced by a partial unique index (`shift_id`, `event_kind`) — the projection trigger errors on duplicate. Offline-capable per US9.

### 2.4 `transfer_events`

| Column                 | Type                                                                                                                       | Notes                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Common                 | (see above)                                                                                                                |                             |
| `transfer_id`          | uuid NOT NULL                                                                                                              | Same for the whole transfer |
| `event_kind`           | text NOT NULL CHECK (`event_kind IN ('transfer_requested','transfer_dispatched','transfer_received','transfer_variance')`) |                             |
| `source_store_id`      | uuid FK → `stores` NOT NULL                                                                                                |                             |
| `destination_store_id` | uuid FK → `stores` NOT NULL                                                                                                |                             |
| `line_items`           | jsonb NOT NULL                                                                                                             | Array of `{ sku_id, qty }`  |
| `variance_items`       | jsonb                                                                                                                      | Only on `transfer_variance` |
| `actor_user_id`        | uuid FK → `users` NOT NULL                                                                                                 | Who confirmed this step     |

Companion `stock_events`:

- `transfer_dispatched` → `stock_events(event_type='transfer_out', delta_qty=-qty, store_id=source, source_ref_id=event_id)`
- `transfer_received` → `stock_events(event_type='transfer_in', delta_qty=+qty, store_id=destination, source_ref_id=event_id)`
- `transfer_variance` → `stock_events(event_type='transfer_variance', delta_qty=<signed>, store_id=destination, source_ref_id=event_id)`

Between dispatch and receipt, stock is "in transit" — see §3.4 `transfers` projection. This is what makes EC-04 correct even when events arrive out of order.

### 2.5 `adjustment_events`

| Column                 | Type                                                                                                       | Notes                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Common                 | (see above)                                                                                                |                                                           |
| `adjustment_id`        | uuid NOT NULL                                                                                              |                                                           |
| `event_kind`           | text NOT NULL CHECK (`event_kind IN ('adjustment_requested','adjustment_approved','adjustment_rejected')`) | Approval chain FR-017                                     |
| `sku_id`               | uuid FK NOT NULL                                                                                           |                                                           |
| `delta_qty`            | numeric(14,3) NOT NULL                                                                                     |                                                           |
| `reason_code`          | text NOT NULL                                                                                              |                                                           |
| `requested_by_user_id` | uuid FK → `users` NOT NULL                                                                                 |                                                           |
| `approver_user_id`     | uuid FK → `users`                                                                                          | Non-null on `adjustment_approved` / `adjustment_rejected` |
| `notes`                | text                                                                                                       |                                                           |

Only `adjustment_approved` emits a companion `stock_events` row (`event_type='adjustment'`) — requested/rejected do not touch stock.

### 2.6 `price_change_events`

| Column               | Type                                                                                  | Notes                            |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| Common               | (see above; `till_id` is a special "hq-console" UUID because HQ writes via admin app) |                                  |
| `price_version_id`   | uuid NOT NULL                                                                         | The new version being introduced |
| `sku_id`             | uuid FK NOT NULL                                                                      |                                  |
| `store_id`           | uuid FK                                                                               | NULL for global                  |
| `old_unit_price`     | numeric(14,4)                                                                         | NULL for first-ever price        |
| `new_unit_price`     | numeric(14,4) NOT NULL                                                                |                                  |
| `effective_from`     | timestamptz NOT NULL                                                                  |                                  |
| `changed_by_user_id` | uuid FK → `users` NOT NULL                                                            |                                  |
| `reason`             | text                                                                                  |                                  |

Trigger creates the corresponding row in `price_versions`. No mutation of prior versions — supersession is derived by the query in §1.7 (EC-19). Feeds the audit trail (FR-026, SC-005, SC-006).

### 2.7 `sync_health_snapshots`

Already described in [research.md §4.2](research.md). Full DDL:

```sql
create table sync_health_snapshots (
  snapshot_id uuid primary key,
  till_id uuid not null references tills(till_id),
  store_id uuid not null references stores(store_id),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  queue_depth int not null,
  oldest_pending_event_at timestamptz,
  last_successful_sync_at timestamptz,
  consecutive_failures int not null default 0,
  app_version text not null,
  schema_version int not null
);
create index on sync_health_snapshots (till_id, server_ts desc);
create index on sync_health_snapshots (store_id, server_ts desc);
```

`snapshot_id` is client-generated — dedup on retry works the same way as any event.

### 2.8 `sync_health_alerts`

| Column      | Type                                                                                 | Notes                              |
| ----------- | ------------------------------------------------------------------------------------ | ---------------------------------- |
| `alert_id`  | uuid PK                                                                              |                                    |
| `till_id`   | uuid FK NOT NULL                                                                     |                                    |
| `store_id`  | uuid FK NOT NULL                                                                     |                                    |
| `opened_at` | timestamptz NOT NULL DEFAULT now()                                                   |                                    |
| `closed_at` | timestamptz                                                                          | NULL while alert is firing         |
| `reason`    | text NOT NULL CHECK (`reason IN ('stale_sync','queue_backlog','repeated_failures')`) |                                    |
| `payload`   | jsonb                                                                                | Snapshot details at time of firing |

### 2.9 `audit_log`

| Column          | Type                               | Notes                                                                           |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| `audit_id`      | uuid PK                            |                                                                                 |
| `actor_user_id` | uuid FK → `users`                  | Nullable for system events                                                      |
| `action`        | text NOT NULL                      | e.g. `price.change`, `adjustment.approve`, `user.role_change`, `till.provision` |
| `entity_type`   | text NOT NULL                      |                                                                                 |
| `entity_id`     | uuid NOT NULL                      |                                                                                 |
| `old_value`     | jsonb                              |                                                                                 |
| `new_value`     | jsonb                              |                                                                                 |
| `server_ts`     | timestamptz NOT NULL DEFAULT now() |                                                                                 |

Append-only, enforced by policy (no `UPDATE`/`DELETE` grants).

## 3. Projection tables (trigger-maintained, safe to read)

Projections exist so PowerSync can stream a stable, small row set to clients without them having to sum events on-device.

### 3.1 `current_stock_by_store_sku`

| Column                 | Type                                                   | Notes                                                            |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `store_id`             | uuid FK NOT NULL                                       |                                                                  |
| `sku_id`               | uuid FK NOT NULL                                       |                                                                  |
| `qty_on_hand`          | numeric(14,3) NOT NULL                                 | Sum of `stock_events.delta_qty` where `store_id`, `sku_id` match |
| `qty_in_transit_out`   | numeric(14,3) NOT NULL DEFAULT 0                       | For source store between dispatch and receipt                    |
| `qty_in_transit_in`    | numeric(14,3) NOT NULL DEFAULT 0                       | For destination store between dispatch and receipt               |
| `is_oversold`          | boolean GENERATED ALWAYS AS (`qty_on_hand < 0`) STORED | FR-022                                                           |
| `last_event_server_ts` | timestamptz                                            | For UI freshness display                                         |
| PK                     | (`store_id`, `sku_id`)                                 |                                                                  |

Maintained by `AFTER INSERT ON stock_events` trigger.

### 3.2 `shifts`

| Column          | Type                                                                                    | Notes                                     |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `shift_id`      | uuid PK                                                                                 |                                           |
| `till_id`       | uuid FK NOT NULL                                                                        |                                           |
| `store_id`      | uuid FK NOT NULL                                                                        |                                           |
| `cashier_id`    | uuid FK NOT NULL                                                                        |                                           |
| `opened_at`     | timestamptz NOT NULL                                                                    | From `shift_open.server_ts`               |
| `closed_at`     | timestamptz                                                                             | From `shift_close.server_ts`              |
| `opening_float` | numeric(14,2) NOT NULL                                                                  |                                           |
| `cash_counted`  | numeric(14,2)                                                                           |                                           |
| `system_cash`   | numeric(14,2)                                                                           | Sum of cash tenders on this shift's sales |
| `over_short`    | numeric(14,2) GENERATED ALWAYS AS (`cash_counted - system_cash - opening_float`) STORED |                                           |
| `status`        | text NOT NULL CHECK (`status IN ('open','closed')`)                                     |                                           |

### 3.3 `sales`

Header projection of `sale_events` for reports and refund lookup. Same columns as `sale_events` minus the JSONB bulk plus `latest_status` (denormalised through void/refund chain traversal).

### 3.4 `transfers`

| Column                                           | Type                                                                                                         | Notes                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfer_id`                                    | uuid PK                                                                                                      |                                                                                                                                             |
| `source_store_id` / `destination_store_id`       | uuid FK                                                                                                      |                                                                                                                                             |
| `state`                                          | text NOT NULL CHECK (`state IN ('requested','dispatched','in_transit','received','received_with_variance')`) | Server-side state machine — see EC-04. Never advances backwards; `dispatched` is required before `received` regardless of raw arrival order |
| `dispatched_line_items`                          | jsonb                                                                                                        |                                                                                                                                             |
| `received_line_items`                            | jsonb                                                                                                        |                                                                                                                                             |
| `variance_line_items`                            | jsonb                                                                                                        |                                                                                                                                             |
| `requested_at` / `dispatched_at` / `received_at` | timestamptz                                                                                                  | From respective event `server_ts`                                                                                                           |

State-machine logic lives in the `transfer_events` trigger — the projection can only move forward. If `transfer_received` arrives first, the projection stays at `requested` and the trigger holds the received event on a small `pending_transfer_receipts` side table until the matching `transfer_dispatched` lands.

## 4. Row-Level Security summary

Full policies in [contracts/rls-policies.sql](contracts/rls-policies.sql). Summary:

| Table                                                          | Read                                                             | Write                                                                                                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Master data (`stores`, `skus`, `price_versions`, `promotions`) | Cashier + Store manager: own `store_id` or global; HQ admin: all | HQ admin only                                                                                                                                          |
| `users`                                                        | Store-scoped for cashier/manager; all for HQ                     | HQ admin only                                                                                                                                          |
| `tills`                                                        | Store-scoped read                                                | HQ admin only                                                                                                                                          |
| Event tables                                                   | Cashier/manager: rows for own store; HQ: all                     | Insert-only; role must match the event type (e.g. cashier can insert `sale_events` for their `till_id`; only manager can insert `adjustment_approved`) |
| Projections                                                    | Store-scoped                                                     | Never — write is DENY, only triggers write                                                                                                             |
| `sync_health_snapshots`                                        | Store-scoped for manager, all for HQ                             | Any authenticated till JWT for own `till_id`                                                                                                           |
| `audit_log`                                                    | Store-scoped for manager, all for HQ                             | INSERT via SECURITY DEFINER function only; no UPDATE/DELETE grants                                                                                     |

## 5. What lives on the till (SQLite)

Not every Postgres table is streamed to the till. The till holds:

| Table                                          | Contents                                               | Bucket                       |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------- |
| `skus`                                         | Store-stocked subset only                              | `store_catalog[store_id]`    |
| `sku_barcodes`, `sku_categories`, `promotions` | Store-scoped                                           | `store_catalog[store_id]`    |
| `price_versions`                               | Store + global, effective now or in future             | `store_prices[store_id]`     |
| `current_stock_by_store_sku`                   | Read-only, this store only                             | `store_stock[store_id]`      |
| `stock_events`                                 | This store's, last 30 days (for count-correction base) | `store_stock[store_id]`      |
| `users`                                        | Cashiers assigned to this store, with `pin_hash`       | `store_users[store_id]`      |
| `sale_events`, `shift_events`                  | This till only, own writes                             | `till_own_activity[till_id]` |
| `sync_health_local`                            | Local-only, NOT synced                                 | —                            |

Explicitly NOT on the till: other tills' sales/shifts, other stores' anything, `audit_log`, `sync_health_snapshots`, `adjustment_events` from other cashiers.

## 6. Indexes and performance notes

- Every event table indexes `(store_id, server_ts DESC)` for admin queries and `(till_id, server_ts DESC)` for sync-health.
- `sale_events (cashier_id, server_ts DESC)` for cashier reports.
- `sale_events (sale_id)` unique, for refund lookup.
- `current_stock_by_store_sku` partial index on `WHERE is_oversold` for the Oversold dashboard (SC-004).
- Table partitioning is **not** used for MVP; at 16 stores × ~10 sales/store × 12 h = ~2 000 sale_events/day fleet-wide, partitioning is premature. Revisit at Phase 5 if data volume warrants.
