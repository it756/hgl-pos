import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T087: FR-028 — a price change that syncs down after a sale completes
// must never retroactively alter that sale's stamped price_version_id/unit_price.

const TILL_ID = "aaaaaaaa-2000-4000-8000-000000000001";
const STORE_ID = "bbbbbbbb-2000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-2000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-2000-4000-8000-000000000004";
const SKU_ID = "eeeeeeee-2000-4000-8000-000000000005";
const OLD_PRICE_VERSION_ID = "ffffffff-2000-4000-8000-000000000006";
const NEW_PRICE_VERSION_ID = "ffffffff-2000-4000-8000-000000000007";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class ThrowingUploader implements SyncUploader {
  async upload(): Promise<void> {
    throw new Error("upload should not be called in this test");
  }
}

describe("price immutability — a completed sale keeps its stamped price after a newer price syncs down", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("resolvePrice() picks up the new price, but the already-completed sale keeps the old price_version_id and unit_price", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-01T09:00:00.000Z");

    await ensurePriceVersionsTable(db);
    db.seed("price_versions", "price_version_id", {
      price_version_id: OLD_PRICE_VERSION_ID,
      sku_id: SKU_ID,
      store_id: null,
      unit_price: 10,
      currency: "ZMW",
      effective_from: "2026-01-01T00:00:00.000Z",
      created_by_user_id: CASHIER_ID,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
    await clock.sync();
    const syncEngine = new SyncEngine({ db, uploader: new ThrowingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 200 });

    // Sale is completed while the OLD price is the only price_versions row.
    const oldPrice = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: now.toISOString() });
    expect(oldPrice?.price_version_id).toBe(OLD_PRICE_VERSION_ID);

    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 2, unitPrice: oldPrice!.unit_price, priceVersionId: oldPrice!.price_version_id });
    const cartState = cart.getState();
    const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];

    const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    const saleEvent = await saleQueue.completeSale({ cashierId: CASHIER_ID, shiftId: SHIFT_ID, cart: cartState, tenders });

    // A newer price_version now "syncs down" (arrives after the sale completed).
    await db.insert(
      `INSERT INTO price_versions (price_version_id, sku_id, store_id, unit_price, currency, effective_from, created_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [NEW_PRICE_VERSION_ID, SKU_ID, null, 15, "ZMW", "2026-02-01T00:00:00.000Z", CASHIER_ID, "2026-02-01T00:00:00.000Z"],
    );

    // (a) A fresh lookup now resolves to the NEW price.
    const freshLookup = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: now.toISOString() });
    expect(freshLookup?.price_version_id).toBe(NEW_PRICE_VERSION_ID);
    expect(freshLookup?.unit_price).toBe(15);

    // (b) The already-completed sale's persisted event is untouched.
    const reloadedSale = await saleQueue.getSale(saleEvent.sale_id);
    expect(reloadedSale?.items).toHaveLength(1);
    expect(reloadedSale?.items[0]?.price_version_id).toBe(OLD_PRICE_VERSION_ID);
    expect(reloadedSale?.items[0]?.unit_price).toBe(10);
    expect(reloadedSale?.grand_total).toBe(20);
  });
});
