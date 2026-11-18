import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { CountCorrectionQueue } from "../../src/lib/events/count";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T097 (EC-05): a stock count must be reconciled against the till's FULL
// local ledger — including this till's own not-yet-synced pending
// stock_events — not a stale synced-down total. `CountCorrectionQueue.
// getLedgerQty()` (count.ts) sums delta_qty straight from the local
// stock_events mirror, which naturally includes any pending rows written
// there by SaleEventQueue.completeSale()'s applyLocalStockDeduction.

const TILL_ID = "aaaaaaaa-5000-4000-8000-000000000001";
const STORE_ID = "bbbbbbbb-5000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-5000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-5000-4000-8000-000000000004";
const SKU_ID = "eeeeeeee-5000-4000-8000-000000000005";

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

describe("count-correction reconciles against the full local ledger, including pending events (EC-05)", () => {
  it("a count taken after an offline sale reflects that sale's pending stock event, not just historical synced-down rows", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-20T09:00:00.000Z");

    await ensurePriceVersionsTable(db);
    db.seed("price_versions", "price_version_id", {
      price_version_id: "ffffffff-5000-4000-8000-000000000006",
      sku_id: SKU_ID,
      store_id: null,
      unit_price: 12,
      currency: "ZMW",
      effective_from: "2026-01-01T00:00:00.000Z",
      created_by_user_id: CASHIER_ID,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
    await clock.sync();
    const syncEngine = new SyncEngine({ db, uploader: new ThrowingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });

    // A historical, already-synced-down stock event (e.g. from a prior day's
    // count-correction or a prior sale that has already round-tripped).
    const countQueue = new CountCorrectionQueue({ db, syncEngine, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await countQueue.init();
    await db.insert(
      `INSERT INTO stock_events (event_id, till_id, store_id, client_ts, server_ts, app_version, schema_ver, sku_id, event_type, delta_qty, source_ref_id, batch_no, expiry_date, reason_code, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "10000000-5000-4000-8000-000000000001",
        TILL_ID,
        STORE_ID,
        "2026-04-19T08:00:00.000Z",
        "2026-04-19T08:00:00.000Z",
        "1.0.0-test",
        1,
        SKU_ID,
        "count_correction",
        20,
        null,
        null,
        null,
        "initial-stock",
        null,
      ],
    );

    // Historical ledger alone: 20 units.
    expect(await countQueue.getLedgerQty(SKU_ID)).toBe(20);

    // Complete an OFFLINE sale for 3 units — this writes a PENDING (not yet
    // synced/uploaded) stock_events row locally via applyLocalStockDeduction.
    const price = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: now.toISOString() });
    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 3, unitPrice: price!.unit_price, priceVersionId: price!.price_version_id });
    const cartState = cart.getState();
    const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];

    const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await saleQueue.completeSale({ cashierId: CASHIER_ID, shiftId: SHIFT_ID, cart: cartState, tenders });

    // The sale's stock_events row is still pending upload — confirm it's
    // genuinely un-synced from this till's own perspective.
    expect(await syncEngine.queueDepth()).toBeGreaterThan(0);

    // The ledger query must now reflect BOTH the historical row AND the
    // sale's pending local row: 20 - 3 = 17.
    const ledgerAfterSale = await countQueue.getLedgerQty(SKU_ID);
    expect(ledgerAfterSale).toBe(17);

    // Perform a physical count of 17 — the resulting correction event's
    // delta must be zero (count matches the full ledger, pending sale included).
    const correction = await countQueue.recordCount({ skuId: SKU_ID, countedQty: 17, reasonCode: "cycle-count", notes: null });
    expect(correction.delta_qty).toBe(0);

    // A DIFFERENT counted value (say a genuine shrinkage of 1) produces the
    // correctly-scoped delta against the pending-inclusive ledger, not the
    // stale 20-unit historical total (which would have wrongly implied -3).
    const shrinkageCorrection = await countQueue.recordCount({ skuId: SKU_ID, countedQty: 16, reasonCode: "cycle-count", notes: "1 unit shrinkage" });
    expect(shrinkageCorrection.delta_qty).toBe(-1);
  });
});
