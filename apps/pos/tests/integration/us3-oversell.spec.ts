import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T096: Constitution Principle II — oversell is expected and never blocked
// client-side. Two emulated tills, each with its OWN local database (unaware
// of the other), both independently sell the LAST unit of a SKU while
// offline. `applyLocalStockDeduction` (sale.ts) never reads/checks existing
// qty before deducting — it's a blind upsert `+=` — so nothing client-side
// would block either sale regardless of shared/separate DBs.
//
// SCOPE NOTE: this proves the "never blocked offline" half of SC-004. The
// other half — both sales later syncing and CONVERGING server-side to
// qty_on_hand = -1 with is_oversold = true — is a cross-till property that
// only exists once both tills' stock_events rows land in the same Postgres
// row; that server-side convergence is covered separately (see
// supabase/tests/projection_triggers.spec.sql and the stock projection
// trigger it exercises), not here.

const SKU_ID = "eeeeeeee-4000-4000-8000-000000000001";

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

async function sellLastUnit(tillId: string, storeId: string, cashierId: string, shiftId: string, now: Date) {
  const db = createMemoryDb();
  await ensurePriceVersionsTable(db);
  db.seed("price_versions", "price_version_id", {
    price_version_id: `ffffffff-4000-4000-8000-00000000000${tillId.slice(-1)}`,
    sku_id: SKU_ID,
    store_id: null,
    unit_price: 20,
    currency: "ZMW",
    effective_from: "2026-01-01T00:00:00.000Z",
    created_by_user_id: cashierId,
    created_at: "2026-01-01T00:00:00.000Z",
  });

  const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
  await clock.sync();
  const syncEngine = new SyncEngine({ db, uploader: new ThrowingUploader(), now: () => now });

  const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: "1.0.0-test" });
  await shiftQueue.openShift({ shiftId, cashierId, openingFloat: 100 });

  // This till only knows about its own local ledger — it never had a
  // synced-down "1 unit on hand" baseline to compare against, and it's
  // unaware the other till is about to (or already did) sell the same unit.
  const price = await resolvePrice(db, { skuId: SKU_ID, storeId, atTime: now.toISOString() });

  const cart = new CartStore();
  cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 1, unitPrice: price!.unit_price, priceVersionId: price!.price_version_id });
  const cartState = cart.getState();
  const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];

  const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: "1.0.0-test" });
  const saleEvent = await saleQueue.completeSale({ cashierId, shiftId, cart: cartState, tenders });

  const stockRows = await db.query<{ qty_on_hand: number }>(
    "SELECT qty_on_hand FROM current_stock_by_store_sku WHERE store_id = ? AND sku_id = ?",
    [storeId, SKU_ID],
  );

  return { saleEvent, qtyOnHand: stockRows[0]?.qty_on_hand ?? null };
}

describe("US3 — two-till concurrent oversell is never blocked client-side (SC-004)", () => {
  it("both tills independently complete a sale for the last unit of the same SKU, unaware of each other", async () => {
    const now = new Date("2026-04-15T09:00:00.000Z");
    const storeId = "bbbbbbbb-4000-4000-8000-000000000001";

    const tillA = await sellLastUnit("aaaaaaaa-4000-4000-8000-000000000001", storeId, "cccccccc-4000-4000-8000-000000000001", "dddddddd-4000-4000-8000-000000000001", now);
    const tillB = await sellLastUnit("aaaaaaaa-4000-4000-8000-000000000002", storeId, "cccccccc-4000-4000-8000-000000000002", "dddddddd-4000-4000-8000-000000000002", now);

    // Neither sale was blocked or throttled by an "insufficient stock" check.
    expect(tillA.saleEvent.status).toBe("completed");
    expect(tillB.saleEvent.status).toBe("completed");

    // Each till's local `current_stock_by_store_sku` mirror starts EMPTY (it
    // only ever records deltas this till itself has made, per sale.ts's own
    // header comment — it isn't a full synced-down snapshot). Selling 1 unit
    // with no prior local baseline row lands the local mirror at -1 on BOTH
    // tills independently — nothing client-side ever checked "do I have
    // enough stock" before allowing the sale to complete.
    expect(tillA.qtyOnHand).toBe(-1);
    expect(tillB.qtyOnHand).toBe(-1);
  });
});
