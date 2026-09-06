import { SaleEventSchema, type SaleEvent, type SaleLineItemSchema } from "@hgl/events";
import type { z } from "zod";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "../sync/engine";
import type { ReliableClock } from "../time/clock";
import type { CartState } from "../cart/store";
import type { Tender } from "../tenders/types";
import { sumTenderAmounts } from "../tenders/types";
import { nextEventId } from "./id";
import { ensureShiftTables } from "./queue";

// Sale event builder + persistence (T071). Mirrors the shift.ts/queue.ts
// split (pure builder + stateful queue) in a single file since this phase
// only allocates one task/file for it. `completeSale()` also performs the
// *local* stock deduction and shift system-cash update that
// supabase/migrations/0006_projection_triggers.sql's
// `insert_stock_events_from_sale()` trigger otherwise does server-side —
// duplicated here deliberately so a sale is fully resolved (stock + cash-up
// preview) with zero connectivity (NFR-003), not just queued for later.

export type SaleLineItem = z.infer<typeof SaleLineItemSchema>;

export const TENDER_TOTAL_EPSILON = 0.01;

function toSaleLineItem(line: CartState["lines"][number]): SaleLineItem {
  return {
    sku_id: line.skuId,
    price_version_id: line.priceVersionId,
    unit_price: line.unitPrice,
    qty: line.qty,
    line_discount: line.lineDiscount,
    line_total: line.lineTotal,
    promotion_id: line.promotionId,
    batch_no: line.batchNo,
    expiry_date: line.expiryDate,
  };
}

export type BuildSaleEventParams = {
  eventId: string;
  tillId: string;
  storeId: string;
  clientTs: string;
  appVersion: string;
  schemaVer: number;
  saleId: string;
  cashierId: string;
  shiftId: string;
  cart: CartState;
  tenders: Tender[];
};

export function buildSaleEvent(params: BuildSaleEventParams): SaleEvent {
  return SaleEventSchema.parse({
    event_id: params.eventId,
    till_id: params.tillId,
    store_id: params.storeId,
    client_ts: params.clientTs,
    app_version: params.appVersion,
    schema_ver: params.schemaVer,
    kind: "sale",
    sale_id: params.saleId,
    cashier_id: params.cashierId,
    shift_id: params.shiftId,
    status: "completed",
    items: params.cart.lines.map(toSaleLineItem),
    tenders: params.tenders,
    subtotal: params.cart.subtotal,
    discount_total: params.cart.discountTotal,
    tax_total: 0, // placeholder — real fiscal breakdown ships with 002-fiscalisation
    grand_total: params.cart.grandTotal,
    original_sale_id: null,
    refund_kind: null,
  });
}

// ---------- Persistence (shared with void.ts) ----------

export type SaleEventRow = {
  event_id: string;
  till_id: string;
  store_id: string;
  client_ts: string;
  app_version: string;
  schema_ver: number;
  sale_id: string;
  cashier_id: string;
  shift_id: string;
  status: SaleEvent["status"];
  items: string;
  tenders: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  original_sale_id: string | null;
  refund_kind: SaleEvent["refund_kind"];
};

export async function getSaleEventById(db: IDb, saleId: string): Promise<SaleEvent | null> {
  await ensureSaleTables(db);
  const rows = await db.query<SaleEventRow>(`SELECT * FROM sale_events WHERE sale_id = ?`, [saleId]);
  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  return SaleEventSchema.parse({
    event_id: row.event_id,
    till_id: row.till_id,
    store_id: row.store_id,
    client_ts: row.client_ts,
    app_version: row.app_version,
    schema_ver: row.schema_ver,
    kind: "sale",
    sale_id: row.sale_id,
    cashier_id: row.cashier_id,
    shift_id: row.shift_id,
    status: row.status,
    items: JSON.parse(row.items) as unknown,
    tenders: JSON.parse(row.tenders) as unknown,
    subtotal: row.subtotal,
    discount_total: row.discount_total,
    tax_total: row.tax_total,
    grand_total: row.grand_total,
    original_sale_id: row.original_sale_id,
    refund_kind: row.refund_kind,
  });
}

export async function persistSaleEvent(db: IDb, event: SaleEvent): Promise<void> {
  await ensureSaleTables(db);
  await db.insert(
    `INSERT INTO sale_events (
      event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
      sale_id, cashier_id, shift_id, status, items, tenders,
      subtotal, discount_total, tax_total, grand_total, original_sale_id, refund_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING`,
    [
      event.event_id,
      event.till_id,
      event.store_id,
      event.client_ts,
      event.client_ts,
      event.app_version,
      event.schema_ver,
      event.sale_id,
      event.cashier_id,
      event.shift_id,
      event.status,
      JSON.stringify(event.items),
      JSON.stringify(event.tenders),
      event.subtotal,
      event.discount_total,
      event.tax_total,
      event.grand_total,
      event.original_sale_id,
      event.refund_kind,
    ],
  );
}

export async function persistSaleProjection(db: IDb, event: SaleEvent): Promise<void> {
  await ensureSaleTables(db);
  await db.insert(
    `INSERT INTO sales (
      sale_id, event_id, till_id, store_id, cashier_id, shift_id, client_ts, server_ts,
      app_version, schema_ver, status, latest_status, subtotal, discount_total, tax_total,
      grand_total, original_sale_id, refund_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sale_id) DO NOTHING`,
    [
      event.sale_id,
      event.event_id,
      event.till_id,
      event.store_id,
      event.cashier_id,
      event.shift_id,
      event.client_ts,
      event.client_ts,
      event.app_version,
      event.schema_ver,
      event.status,
      event.status,
      event.subtotal,
      event.discount_total,
      event.tax_total,
      event.grand_total,
      event.original_sale_id,
      event.refund_kind,
    ],
  );

  // Mirrors the server trigger's "latest_status follows the newest linked event".
  if (event.original_sale_id !== null) {
    await db.insert(`UPDATE sales SET latest_status = ? WHERE sale_id = ?`, [event.status, event.original_sale_id]);
  }
}

const STOCK_SIGN_BY_STATUS: Record<SaleEvent["status"], -1 | 1> = {
  completed: -1,
  voided: 1,
  refunded: 1,
};

/** Local mirror of `insert_stock_events_from_sale()`'s stock-side effect — keeps the till's own ledger authoritative offline. */
export async function applyLocalStockDeduction(db: IDb, event: SaleEvent): Promise<void> {
  await ensureStockTables(db);
  const sign = STOCK_SIGN_BY_STATUS[event.status];

  for (const item of event.items) {
    const stockEventId = crypto.randomUUID();
    await db.insert(
      `INSERT INTO stock_events (
        event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver,
        sku_id, event_type, delta_qty, source_ref_id, batch_no, expiry_date, reason_code, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(event_id) DO NOTHING`,
      [
        stockEventId,
        event.till_id,
        event.store_id,
        event.client_ts,
        event.client_ts,
        event.app_version,
        event.schema_ver,
        item.sku_id,
        sign < 0 ? "sale" : "refund",
        sign * item.qty,
        event.event_id,
        item.batch_no,
        item.expiry_date,
      ],
    );

    await db.insert(
      `INSERT INTO current_stock_by_store_sku (store_id, sku_id, qty_on_hand, last_event_server_ts)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(store_id, sku_id) DO UPDATE SET
        qty_on_hand = qty_on_hand + excluded.qty_on_hand,
        last_event_server_ts = excluded.last_event_server_ts`,
      [event.store_id, item.sku_id, sign * item.qty, event.client_ts],
    );
  }
}

const CASH_SIGN_BY_STATUS: Record<SaleEvent["status"], -1 | 1> = {
  completed: 1,
  voided: -1,
  refunded: -1,
};

/** Local mirror of the server trigger's `shifts.system_cash` cash-tender update. */
export async function applyCashTenderToShiftSystemCash(db: IDb, event: SaleEvent): Promise<void> {
  await ensureShiftTables(db);
  const cashTotal = event.tenders.filter((tender) => tender.type === "cash").reduce((sum, tender) => sum + tender.amount, 0);
  if (cashTotal === 0) {
    return;
  }

  const delta = CASH_SIGN_BY_STATUS[event.status] * cashTotal;
  await db.insert(`UPDATE shifts SET system_cash = system_cash + ? WHERE shift_id = ?`, [delta, event.shift_id]);
}

export async function ensureSaleTables(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS sale_events (
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
    )`,
  );
  await db.insert(`CREATE UNIQUE INDEX IF NOT EXISTS sale_events_sale_id_idx ON sale_events (sale_id)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS sale_events_till_ts_idx ON sale_events (till_id, server_ts)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS sale_events_cashier_ts_idx ON sale_events (cashier_id, server_ts)`);

  await db.insert(
    `CREATE TABLE IF NOT EXISTS sales (
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
    )`,
  );
  await db.insert(`CREATE UNIQUE INDEX IF NOT EXISTS sales_event_idx ON sales (event_id)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS sales_till_ts_idx ON sales (till_id, server_ts)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS sales_shift_idx ON sales (store_id, shift_id)`);
}

export async function ensureStockTables(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS stock_events (
      event_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      client_ts TEXT NOT NULL,
      server_ts TEXT NOT NULL,
      app_version TEXT NOT NULL,
      schema_ver INTEGER NOT NULL,
      sku_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'refund', 'transfer_out', 'transfer_in', 'transfer_variance', 'adjustment', 'count_correction')),
      delta_qty REAL NOT NULL,
      source_ref_id TEXT,
      batch_no TEXT,
      expiry_date TEXT,
      reason_code TEXT,
      notes TEXT
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS stock_events_store_sku_ts_idx ON stock_events (store_id, sku_id, server_ts)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS stock_events_till_ts_idx ON stock_events (till_id, server_ts)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS stock_events_source_ref_idx ON stock_events (source_ref_id)`);

  await db.insert(
    `CREATE TABLE IF NOT EXISTS current_stock_by_store_sku (
      store_id TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      qty_on_hand REAL NOT NULL DEFAULT 0,
      qty_in_transit_out REAL NOT NULL DEFAULT 0,
      qty_in_transit_in REAL NOT NULL DEFAULT 0,
      is_oversold INTEGER NOT NULL DEFAULT 0,
      last_event_server_ts TEXT,
      PRIMARY KEY (store_id, sku_id)
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS current_stock_last_event_idx ON current_stock_by_store_sku (store_id, last_event_server_ts)`);
}

// ---------- Queue (persist + enqueue for upload) ----------

export type SaleEventQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  clock: ReliableClock;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export type CompleteSaleParams = {
  cashierId: string;
  shiftId: string;
  cart: CartState;
  tenders: Tender[];
};

export class SaleEventQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #clock: ReliableClock;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: SaleEventQueueOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#clock = options.clock;
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureSaleTables(this.#db);
    await ensureStockTables(this.#db);
    await ensureShiftTables(this.#db);
  }

  async completeSale(params: CompleteSaleParams): Promise<SaleEvent> {
    await this.init();
    await this.#clock.assertFinancialClockAllowed();

    if (params.cart.lines.length === 0) {
      throw new Error("completeSale: cart has no line items");
    }

    const tenderTotal = sumTenderAmounts(params.tenders);
    if (Math.abs(tenderTotal - params.cart.grandTotal) > TENDER_TOTAL_EPSILON) {
      throw new Error(`completeSale: tender total (${tenderTotal}) does not match cart grand total (${params.cart.grandTotal})`);
    }

    const clientTs = (await this.#clock.trustedNow()).toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const event = buildSaleEvent({
      eventId,
      tillId: this.#tillId,
      storeId: this.#storeId,
      clientTs,
      appVersion: this.#appVersion,
      schemaVer: localSchemaVersion,
      saleId: eventId, // sale_id == event_id for a completed sale (data-model.md §2.2)
      cashierId: params.cashierId,
      shiftId: params.shiftId,
      cart: params.cart,
      tenders: params.tenders,
    });

    await persistSaleEvent(this.#db, event);
    await persistSaleProjection(this.#db, event);
    await applyLocalStockDeduction(this.#db, event);
    await applyCashTenderToShiftSystemCash(this.#db, event);

    await this.#syncEngine.enqueue(event);
    return event;
  }

  async getSale(saleId: string): Promise<SaleEvent | null> {
    await this.init();
    return getSaleEventById(this.#db, saleId);
  }
}
