import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { VoidEventQueue } from "../../src/lib/events/void";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";
import type { AnyTillEvent } from "@hgl/events";

// T078: same-till-session void (FR-011) — reverses a completed sale made in
// the current shift on this till via a linked `voided` sale event
// (refund_kind='same_till_session_void', original_sale_id set), fully
// offline. Also asserts the FR-012 boundary: a different till/shift must be
// refused here and routed to the connectivity-required cross-till flow
// instead (US5, out of scope for this session per the task brief).

const TILL_ID = "aaaaaaaa-2000-4000-8000-000000000001";
const OTHER_TILL_ID = "aaaaaaaa-2000-4000-8000-000000000099";
const STORE_ID = "bbbbbbbb-2000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-2000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-2000-4000-8000-000000000004";
const OTHER_SHIFT_ID = "dddddddd-2000-4000-8000-000000000099";
const SKU_ID = "eeeeeeee-2000-4000-8000-000000000005";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class RecordingUploader implements SyncUploader {
  readonly uploaded: AnyTillEvent[] = [];
  async upload(events: AnyTillEvent[]): Promise<void> {
    this.uploaded.push(...events);
  }
}

async function completeASale(db: ReturnType<typeof createMemoryDb>, syncEngine: SyncEngine, clock: ReliableClock, shiftId: string, tillId: string) {
  const cart = new CartStore();
  cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 2, unitPrice: 30, priceVersionId: "ffffffff-2000-4000-8000-000000000006" });
  const cartState = cart.getState();
  const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];

  const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId, storeId: STORE_ID, appVersion: "1.0.0-test" });
  return saleQueue.completeSale({ cashierId: CASHIER_ID, shiftId, cart: cartState, tenders });
}

async function seedSyncedClock(db: ReturnType<typeof createMemoryDb>, now: Date): Promise<ReliableClock> {
  const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
  await clock.sync();
  return clock;
}

describe("US1 — same-till-session void (FR-011)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("reverses stock and cash for a same-session sale via a linked voided event, offline", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-05T10:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const uploader = new RecordingUploader();
    const syncEngine = new SyncEngine({ db, uploader, now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });

    const sale = await completeASale(db, syncEngine, clock, SHIFT_ID, TILL_ID);

    const stockAfterSale = await db.query<{ qty_on_hand: number }>(
      "SELECT qty_on_hand FROM current_stock_by_store_sku WHERE store_id = ? AND sku_id = ?",
      [STORE_ID, SKU_ID],
    );
    expect(stockAfterSale[0]?.qty_on_hand).toBe(-2);
    const shiftAfterSale = await db.query<{ system_cash: number }>("SELECT system_cash FROM shifts WHERE shift_id = ?", [SHIFT_ID]);
    expect(shiftAfterSale[0]?.system_cash).toBe(60);

    const voidQueue = new VoidEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    const voidEvent = await voidQueue.voidSale({ saleId: sale.sale_id, cashierId: CASHIER_ID, shiftId: SHIFT_ID });

    expect(voidEvent.status).toBe("voided");
    expect(voidEvent.original_sale_id).toBe(sale.sale_id);
    expect(voidEvent.refund_kind).toBe("same_till_session_void");
    expect(voidEvent.event_id).not.toBe(sale.event_id); // its own identity, not a reuse of the original

    const stockAfterVoid = await db.query<{ qty_on_hand: number }>(
      "SELECT qty_on_hand FROM current_stock_by_store_sku WHERE store_id = ? AND sku_id = ?",
      [STORE_ID, SKU_ID],
    );
    expect(stockAfterVoid[0]?.qty_on_hand).toBe(0); // fully reversed

    const shiftAfterVoid = await db.query<{ system_cash: number }>("SELECT system_cash FROM shifts WHERE shift_id = ?", [SHIFT_ID]);
    expect(shiftAfterVoid[0]?.system_cash).toBe(0); // cash reversed too

    const salesProjection = await db.query<{ sale_id: string; latest_status: string }>("SELECT sale_id, latest_status FROM sales WHERE sale_id = ?", [
      sale.sale_id,
    ]);
    expect(salesProjection[0]?.latest_status).toBe("voided"); // original sale's projection row follows the linked event's status

    // Both the sale and the void are queued for upload, distinct event_ids.
    expect(await syncEngine.queueDepth()).toBe(3); // shift_open + sale + void
    const drain = await syncEngine.drainOnce();
    expect(drain).toEqual({ attempted: 3, uploaded: 3, failed: 0, nextAttemptAt: null });
    expect(new Set(uploader.uploaded.map((event) => event.event_id)).size).toBe(3);
  });

  it("refuses to void a sale made on a different till (must use the cross-till refund flow instead, FR-012)", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-05T10:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });
    const sale = await completeASale(db, syncEngine, clock, SHIFT_ID, TILL_ID);

    const voidQueueOnOtherTill = new VoidEventQueue({ db, syncEngine, clock, tillId: OTHER_TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await expect(voidQueueOnOtherTill.voidSale({ saleId: sale.sale_id, cashierId: CASHIER_ID, shiftId: SHIFT_ID })).rejects.toThrow(
      /cross-till refund flow/,
    );
  });

  it("refuses to void a sale made in an earlier shift on the same till (a different session)", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-05T10:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });
    const sale = await completeASale(db, syncEngine, clock, SHIFT_ID, TILL_ID);

    const voidQueueInOtherShift = new VoidEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await expect(voidQueueInOtherShift.voidSale({ saleId: sale.sale_id, cashierId: CASHIER_ID, shiftId: OTHER_SHIFT_ID })).rejects.toThrow(
      /cross-till refund flow/,
    );
  });

  it("refuses to void a sale that is already voided", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-05T10:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });
    const sale = await completeASale(db, syncEngine, clock, SHIFT_ID, TILL_ID);

    const voidQueue = new VoidEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await voidQueue.voidSale({ saleId: sale.sale_id, cashierId: CASHIER_ID, shiftId: SHIFT_ID });

    await expect(voidQueue.voidSale({ saleId: sale.sale_id, cashierId: CASHIER_ID, shiftId: SHIFT_ID })).rejects.toThrow(/already voided/);
  });
});
