import { SaleEventSchema, type SaleEvent } from "@hgl/events";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "../sync/engine";
import type { ReliableClock } from "../time/clock";
import { nextEventId } from "./id";
import {
  applyCashTenderToShiftSystemCash,
  applyLocalStockDeduction,
  ensureSaleTables,
  getSaleEventById,
  persistSaleEvent,
  persistSaleProjection,
} from "./sale";

// Same-till-session void (T072, FR-011): reverses a completed sale made in
// the *current* shift on *this* till by writing a linked `voided` sale
// event (`refund_kind='same_till_session_void'`, `original_sale_id` set).
// Anything else — a different till, or an earlier shift/day on this till —
// must go through the connectivity-required cross-till refund flow (US5,
// FR-012); that check is enforced here, not left to the caller/UI.

export type VoidEventQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  clock: ReliableClock;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export type VoidSaleParams = {
  saleId: string;
  cashierId: string;
  /** Must equal the currently open shift on this till — enforces "same session". */
  shiftId: string;
};

export class VoidEventQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #clock: ReliableClock;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: VoidEventQueueOptions) {
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
  }

  async voidSale(params: VoidSaleParams): Promise<SaleEvent> {
    await this.init();
    await this.#clock.assertFinancialClockAllowed();

    const original = await getSaleEventById(this.#db, params.saleId);
    if (original === null) {
      throw new Error(`voidSale: no local sale found for sale ${params.saleId}`);
    }
    if (original.status !== "completed") {
      throw new Error(`voidSale: sale ${params.saleId} is already ${original.status}`);
    }
    // `sale_events` is an immutable log — the original row's own `status`
    // never changes when it's later voided/refunded (only a NEW linked row
    // is written). Whether it's ALREADY been voided/refunded is tracked on
    // the `sales` projection's `latest_status` instead (see
    // persistSaleProjection's "latest_status follows the newest linked
    // event" comment).
    const projectionRows = await this.#db.query<{ latest_status: string }>(
      `SELECT latest_status FROM sales WHERE sale_id = ?`,
      [params.saleId],
    );
    const latestStatus = projectionRows[0]?.latest_status ?? original.status;
    if (latestStatus !== "completed") {
      throw new Error(`voidSale: sale ${params.saleId} is already ${latestStatus}`);
    }
    if (original.till_id !== this.#tillId || original.shift_id !== params.shiftId) {
      throw new Error(
        `voidSale: sale ${params.saleId} was not made in this till's current shift — use the cross-till refund flow instead (FR-012)`,
      );
    }

    const clientTs = (await this.#clock.trustedNow()).toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const voidEvent = SaleEventSchema.parse({
      event_id: eventId,
      till_id: this.#tillId,
      store_id: this.#storeId,
      client_ts: clientTs,
      app_version: this.#appVersion,
      schema_ver: localSchemaVersion,
      kind: "sale",
      sale_id: eventId, // its own identity — original_sale_id carries the link back
      cashier_id: params.cashierId,
      shift_id: original.shift_id,
      status: "voided",
      items: original.items,
      tenders: original.tenders,
      subtotal: original.subtotal,
      discount_total: original.discount_total,
      tax_total: original.tax_total,
      grand_total: original.grand_total,
      original_sale_id: original.sale_id,
      refund_kind: "same_till_session_void",
    });

    await persistSaleEvent(this.#db, voidEvent);
    await persistSaleProjection(this.#db, voidEvent);
    await applyLocalStockDeduction(this.#db, voidEvent);
    await applyCashTenderToShiftSystemCash(this.#db, voidEvent);

    await this.#syncEngine.enqueue(voidEvent);
    return voidEvent;
  }
}
