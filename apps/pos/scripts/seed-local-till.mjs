#!/usr/bin/env node
// Dev-only: seeds a POS till's LOCAL SQLite file directly, bypassing
// PowerSync sync (which isn't wired up yet — nothing in this codebase calls
// .connect() on the PowerSync db). Without this, a fresh till's local tables
// stay empty forever and e.g. the login screen shows "No cashiers are cached
// on this till yet." Requires Node 22.5+ for the built-in `node:sqlite`
// module (stable feature flag not required, but prints an ExperimentalWarning
// — harmless for a dev tool).
//
// Usage: node scripts/seed-local-till.mjs [--db-path <path>]
// The POS app (`tauri:dev`/the built .exe) MUST be closed while this runs —
// SQLite file locking will otherwise block writes.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const APP_IDENTIFIER = "com.harvestgroup.hglpos";
const DB_FILENAME = "powersync.db";

function resolveDbPath() {
  const flagIndex = process.argv.indexOf("--db-path");
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];

  const appData = process.env.APPDATA;
  if (!appData) {
    throw new Error("APPDATA env var not set — pass --db-path explicitly (this script targets Windows tills).");
  }
  return `${appData}\\${APP_IDENTIFIER}\\${DB_FILENAME}`;
}

// Matches this till's row in supabase/seed/seed.sql: Till 1 / PILOT-001.
const TILL_ID = "35000000-0000-4000-8000-000000000011";
const STORE_ID = "35000000-0000-4000-8000-000000000001";

// PIN hashes generated via `node scripts/gen-argon2-hash.mjs` (repo root),
// matching apps/pos/src-tauri/src/pin.rs::verify_pin's params exactly — same
// literals used in supabase/seed/seed.sql so cross-checking against Postgres
// stays easy.
const USERS = [
  {
    user_id: "35000000-0000-4000-8000-000000000102",
    role: "store_manager",
    full_name: "Pilot Store Manager",
    pin_hash:
      "$argon2id$v=19$m=19456,p=1,t=3$o2Nl8FGHR5ZoGy41pCk8Vw$wT0JYciv5+Afpj5hXFg59B2pUICOr6CIBp1BKMrf0rM",
  },
  {
    user_id: "35000000-0000-4000-8000-000000000103",
    role: "cashier",
    full_name: "Cashier One",
    pin_hash:
      "$argon2id$v=19$m=19456,p=1,t=3$un7mhIjlloRcgbwXCOvMaQ$BWwBrRpJyW/xm99wM5yeMh+rjESjQjczWubIF0m8IVc",
  },
  {
    user_id: "35000000-0000-4000-8000-000000000104",
    role: "cashier",
    full_name: "Cashier Two",
    pin_hash:
      "$argon2id$v=19$m=19456,p=1,t=3$tFq+4HWgk+mjfS6ehVrWsQ$5LbkaJT655vl3CFxbaPa/SKfv2ib4wLEG3MxYOPCZMc",
  },
];

// Same 50-SKU pilot catalog as supabase/seed/seed.sql (code/price formula
// duplicated here rather than shared — see repo memory notes on the
// two-independent-sources tradeoff accepted for this seed rewrite).
const SKUS = Array.from({ length: 50 }, (_, idx) => {
  const i = idx + 1;
  const categoryId =
    i <= 17 ? "grocery" : i <= 34 ? "fresh" : "household";
  const unitType = i >= 18 && i <= 22 ? "weight" : "quantity";
  const name =
    i <= 17
      ? `Grocery Item ${String(i).padStart(2, "0")}`
      : i <= 34
        ? `Fresh Produce Item ${String(i - 17).padStart(2, "0")}`
        : `Household Item ${String(i - 34).padStart(2, "0")}`;
  return {
    sku_id: `35000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
    code: `PILOT-SKU-${String(i).padStart(3, "0")}`,
    barcode: String(600000000000 + i).padStart(13, "0"),
    name,
    category_id: categoryId,
    unit_type: unitType,
    track_batch: [1, 7, 18, 25, 40].includes(i) ? 1 : 0,
    track_expiry: i >= 18 && i <= 24 ? 1 : 0,
    price_version_id: `35000000-0000-4000-8000-${String(2000 + i).padStart(12, "0")}`,
    unit_price: Math.round((4.5 + i * 1.15) * 10000) / 10000,
  };
});

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('cashier', 'store_manager', 'hq_admin')),
  store_id TEXT,
  full_name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  pin_updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_login_lockout (
  user_id TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS local_cashier_session (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  store_id TEXT,
  logged_in_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_device_credential (
  till_id TEXT PRIMARY KEY,
  credential TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parked_sales (
  parked_sale_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  label TEXT,
  cart_state TEXT NOT NULL,
  parked_at TEXT NOT NULL,
  resumed_at TEXT
);
CREATE TABLE IF NOT EXISTS adjustment_events (
  event_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  server_ts TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  adjustment_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('adjustment_requested', 'adjustment_approved', 'adjustment_rejected')),
  sku_id TEXT NOT NULL,
  delta_qty REAL NOT NULL,
  reason_code TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  approver_user_id TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS stock_events (
  event_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  server_ts TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  sku_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sale', 'refund', 'transfer_out', 'transfer_in', 'transfer_variance', 'adjustment', 'count_correction'
  )),
  delta_qty REAL NOT NULL,
  source_ref_id TEXT,
  batch_no TEXT,
  expiry_date TEXT,
  reason_code TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS local_event_sequence (
  till_id TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shift_events (
  event_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  server_ts TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  shift_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('shift_open', 'shift_close')),
  payload TEXT NOT NULL,
  UNIQUE (shift_id, event_kind)
);
CREATE TABLE IF NOT EXISTS shifts (
  shift_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_float REAL NOT NULL,
  cash_counted REAL,
  system_cash REAL NOT NULL DEFAULT 0,
  over_short REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed'))
);
CREATE TABLE IF NOT EXISTS local_refund_verifications (
  refund_event_id TEXT PRIMARY KEY,
  original_sale_id TEXT NOT NULL,
  refund_token TEXT NOT NULL,
  refund_reason TEXT NOT NULL,
  refund_kind TEXT NOT NULL CHECK (refund_kind IN ('same_till_history', 'cross_till')),
  verified_by_user_id TEXT NOT NULL,
  verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sale_events (
  event_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  server_ts TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  sale_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'voided', 'refunded')),
  items TEXT NOT NULL,
  tenders TEXT NOT NULL,
  subtotal REAL NOT NULL,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL,
  original_sale_id TEXT,
  refund_kind TEXT CHECK (refund_kind IS NULL OR refund_kind IN ('same_till_session_void', 'same_till_history', 'cross_till'))
);
CREATE TABLE IF NOT EXISTS sales (
  sale_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  server_ts TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_ver INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'voided', 'refunded')),
  latest_status TEXT NOT NULL CHECK (latest_status IN ('completed', 'voided', 'refunded')),
  subtotal REAL NOT NULL,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  grand_total REAL NOT NULL,
  original_sale_id TEXT,
  refund_kind TEXT CHECK (refund_kind IS NULL OR refund_kind IN ('same_till_session_void', 'same_till_history', 'cross_till'))
);
CREATE TABLE IF NOT EXISTS current_stock_by_store_sku (
  store_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  qty_on_hand REAL NOT NULL DEFAULT 0,
  qty_in_transit_out REAL NOT NULL DEFAULT 0,
  qty_in_transit_in REAL NOT NULL DEFAULT 0,
  is_oversold INTEGER NOT NULL DEFAULT 0,
  last_event_server_ts TEXT,
  PRIMARY KEY (store_id, sku_id)
);
CREATE TABLE IF NOT EXISTS skus (
  sku_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  category_id TEXT,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('quantity', 'weight')),
  track_batch INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sku_barcodes (
  barcode TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promotions (
  promotion_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('date_range_discount', 'bogo', 'bundle', 'loyalty_tier')),
  payload TEXT NOT NULL,
  applies_to_sku_ids TEXT,
  store_id TEXT,
  effective_from TEXT,
  effective_to TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_versions (
  price_version_id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL,
  store_id TEXT,
  unit_price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  effective_from TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS local_upload_queue (
  queue_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'failed', 'uploaded')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  locked_at TEXT,
  uploaded_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS sync_health_local (
  snapshot_id TEXT PRIMARY KEY,
  till_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  client_ts TEXT NOT NULL,
  queue_depth INTEGER NOT NULL DEFAULT 0 CHECK (queue_depth >= 0),
  oldest_pending_event_at TEXT,
  last_successful_sync_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  sent_at TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS local_clock_state (
  key TEXT PRIMARY KEY,
  network_time_at_sync TEXT NOT NULL,
  local_time_at_sync TEXT NOT NULL,
  offset_ms INTEGER NOT NULL,
  synced_at TEXT NOT NULL
);
`;

function main() {
  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec(CREATE_TABLES);

  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO local_device_credential (till_id, credential, expires_at, rotated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (till_id) DO UPDATE SET credential = excluded.credential, expires_at = excluded.expires_at, rotated_at = excluded.rotated_at`,
  ).run(TILL_ID, "dev-only-seed-credential", "2099-01-01T00:00:00.000Z", now);

  const insertUser = db.prepare(
    `INSERT INTO users (user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET role = excluded.role, store_id = excluded.store_id, full_name = excluded.full_name,
       pin_hash = excluded.pin_hash, pin_updated_at = excluded.pin_updated_at, updated_at = excluded.updated_at`,
  );
  for (const user of USERS) {
    insertUser.run(user.user_id, user.role, STORE_ID, user.full_name, user.pin_hash, now, now, now);
  }

  const insertSku = db.prepare(
    `INSERT INTO skus (sku_id, code, barcode, name, category_id, unit_type, track_batch, track_expiry, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT (sku_id) DO UPDATE SET code = excluded.code, name = excluded.name, unit_type = excluded.unit_type`,
  );
  const insertBarcode = db.prepare(
    `INSERT INTO sku_barcodes (barcode, sku_id, is_primary, created_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT (barcode) DO UPDATE SET sku_id = excluded.sku_id`,
  );
  const insertPrice = db.prepare(
    `INSERT INTO price_versions (price_version_id, sku_id, store_id, unit_price, currency, effective_from, created_by_user_id, created_at)
     VALUES (?, ?, NULL, ?, 'ZMW', ?, ?, ?)
     ON CONFLICT (price_version_id) DO UPDATE SET unit_price = excluded.unit_price`,
  );
  for (const sku of SKUS) {
    insertSku.run(
      sku.sku_id,
      sku.code,
      sku.barcode,
      sku.name,
      sku.category_id,
      sku.unit_type,
      sku.track_batch,
      sku.track_expiry,
      now,
      now,
    );
    insertBarcode.run(sku.barcode, sku.sku_id, now);
    insertPrice.run(sku.price_version_id, sku.sku_id, sku.unit_price, "2026-01-01T00:00:00.000Z", USERS[0].user_id, now);
  }

  db.prepare(`INSERT INTO local_event_sequence (till_id, next_seq) VALUES (?, 0) ON CONFLICT (till_id) DO NOTHING`).run(
    TILL_ID,
  );

  // An already-open shift so the app boots straight into "ready to sell"
  // rather than forcing a manual shift-open step for every test run.
  const shiftId = "35000000-0000-4000-8000-000000000601";
  db.prepare(
    `INSERT INTO shift_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, shift_id, cashier_id, event_kind, payload)
     VALUES (?, ?, ?, ?, ?, 'seed-local-till', 1, ?, ?, 'shift_open', ?)
     ON CONFLICT (shift_id, event_kind) DO NOTHING`,
  ).run(
    "35000000-0000-4000-8000-000000000611",
    TILL_ID,
    STORE_ID,
    now,
    now,
    shiftId,
    USERS[1].user_id,
    JSON.stringify({ opening_float: 500.0 }),
  );
  db.prepare(
    `INSERT INTO shifts (shift_id, till_id, store_id, cashier_id, opened_at, opening_float, system_cash, over_short, status)
     VALUES (?, ?, ?, ?, ?, 500.0, 0, 0, 'open')
     ON CONFLICT (shift_id) DO NOTHING`,
  ).run(shiftId, TILL_ID, STORE_ID, USERS[1].user_id, now);

  db.close();
  console.log(`Seeded local till DB at ${dbPath}`);
  console.log(`  Till: ${TILL_ID} (PILOT-001 / Till 1)`);
  console.log(`  Cashiers: ${USERS.map((u) => `${u.full_name} (PIN via supabase/seed/README.md)`).join(", ")}`);
  console.log(`  Open shift: ${shiftId} (Cashier One, opening float 500.00)`);
}

main();
