import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import type { AnyTillEvent } from "@hgl/events";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T077: full offline sale (US1 Independent Test sub-goal), the upload
// queue surviving a simulated app restart, and syncing exactly once
// (EC-02) once the till reconnects.

const TILL_ID = "aaaaaaaa-1000-4000-8000-000000000001";
const STORE_ID = "bbbbbbbb-1000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-1000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-1000-4000-8000-000000000004";
const SKU_ID = "eeeeeeee-1000-4000-8000-000000000005";

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

async function seedSyncedClock(db: ReturnType<typeof createMemoryDb>, now: Date): Promise<ReliableClock> {
  const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
  await clock.sync();
  return clock;
}

describe("US1 — full offline sale, queue survives a restart, syncs exactly once", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("completes an offline sale, deducts stock and cash-up cash locally, then drains the upload queue exactly once after a restart", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-01T09:00:00.000Z");
    await ensurePriceVersionsTable(db);
    db.seed("price_versions", "price_version_id", {
      price_version_id: "ffffffff-1000-4000-8000-000000000006",
      sku_id: SKU_ID,
      store_id: null,
      unit_price: 25,
      currency: "ZMW",
      effective_from: "2026-01-01T00:00:00.000Z",
      created_by_user_id: CASHIER_ID,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const clock1 = await seedSyncedClock(db, now);
    const uploader = new RecordingUploader();
    const syncEngine1 = new SyncEngine({ db, uploader, now: () => now });

    const shiftQueue1 = new ShiftEventQueue({ db, syncEngine: syncEngine1, clock: clock1, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue1.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 200 });

    const price = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: now.toISOString() });
    expect(price).not.toBeNull();

    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 3, unitPrice: price!.unit_price, priceVersionId: price!.price_version_id });
    const cartState = cart.getState();
    expect(cartState.grandTotal).toBe(75);

    const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];

    const saleQueue1 = new SaleEventQueue({ db, syncEngine: syncEngine1, clock: clock1, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    const saleEvent = await saleQueue1.completeSale({ cashierId: CASHIER_ID, shiftId: SHIFT_ID, cart: cartState, tenders });

    expect(saleEvent.status).toBe("completed");

    const stockRows = await db.query<{ qty_on_hand: number }>(
      "SELECT qty_on_hand FROM current_stock_by_store_sku WHERE store_id = ? AND sku_id = ?",
      [STORE_ID, SKU_ID],
    );
    expect(stockRows[0]?.qty_on_hand).toBe(-3);

    const shiftRowsAfterSale = await db.query<{ system_cash: number }>("SELECT system_cash FROM shifts WHERE shift_id = ?", [SHIFT_ID]);
    expect(shiftRowsAfterSale[0]?.system_cash).toBe(75);

    // ---- Simulated restart: brand-new instances, same persisted MemoryDb ----
    const clock2 = await seedSyncedClock(db, now);
    const syncEngine2 = new SyncEngine({ db, uploader, now: () => now });
    const saleQueue2 = new SaleEventQueue({ db, syncEngine: syncEngine2, clock: clock2, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });

    const reloadedSale = await saleQueue2.getSale(saleEvent.sale_id);
    expect(reloadedSale?.sale_id).toBe(saleEvent.sale_id);
    expect(reloadedSale?.grand_total).toBe(75);

    // shift_open + sale = 2 queued events, still pending after the restart.
    expect(await syncEngine2.queueDepth()).toBe(2);

    // ---- Sync exactly once (EC-02) ----
    const firstDrain = await syncEngine2.drainOnce();
    expect(firstDrain).toEqual({ attempted: 2, uploaded: 2, failed: 0, nextAttemptAt: null });
    expect(uploader.uploaded.map((event) => event.event_id)).toEqual([...new Set(uploader.uploaded.map((event) => event.event_id))]);

    const secondDrain = await syncEngine2.drainOnce();
    expect(secondDrain).toEqual({ attempted: 0, uploaded: 0, failed: 0, nextAttemptAt: null });
    expect(uploader.uploaded).toHaveLength(2);
  });

  it("rejects a sale whose tender total does not match the cart grand total", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-01T09:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 200 });

    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 1, unitPrice: 50, priceVersionId: "ffffffff-1000-4000-8000-000000000006" });

    const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    const underpaidTenders: Tender[] = [{ type: "cash", amount: 10, reference: null }];

    await expect(saleQueue.completeSale({ cashierId: CASHIER_ID, shiftId: SHIFT_ID, cart: cart.getState(), tenders: underpaidTenders })).rejects.toThrow(
      /tender total/,
    );
  });
});
