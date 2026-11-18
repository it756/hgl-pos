import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T088: a future-dated price_version can already be cached locally (having
// arrived via sync ahead of its effective date) alongside the current one.
// resolvePrice() must switch to it purely by crossing effective_from on the
// till's own (network-time-corrected) clock — no network calls required
// after the single initial sync.

const STORE_ID = "bbbbbbbb-3000-4000-8000-000000000001";
const SKU_ID = "eeeeeeee-3000-4000-8000-000000000002";
const CURRENT_PRICE_VERSION_ID = "ffffffff-3000-4000-8000-000000000003";
const FUTURE_PRICE_VERSION_ID = "ffffffff-3000-4000-8000-000000000004";

const EFFECTIVE_BOUNDARY = new Date("2026-02-01T00:00:00.000Z");

class CountingNetworkTime implements NetworkTimeSource {
  callCount = 0;
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    this.callCount += 1;
    return this.time;
  }
}

describe("effective-dated price transition — resolved entirely from local data as the till's clock advances", () => {
  it("stays on the current price before effective_from, then switches to the future-dated price after crossing it, with zero extra network calls", async () => {
    const db = createMemoryDb();
    await ensurePriceVersionsTable(db);
    db.seed("price_versions", "price_version_id", {
      price_version_id: CURRENT_PRICE_VERSION_ID,
      sku_id: SKU_ID,
      store_id: null,
      unit_price: 10,
      currency: "ZMW",
      effective_from: "2026-01-01T00:00:00.000Z",
      created_by_user_id: "cccccccc-3000-4000-8000-000000000005",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    // Already cached locally even though not yet effective (arrived via sync ahead of schedule).
    db.seed("price_versions", "price_version_id", {
      price_version_id: FUTURE_PRICE_VERSION_ID,
      sku_id: SKU_ID,
      store_id: null,
      unit_price: 14,
      currency: "ZMW",
      effective_from: EFFECTIVE_BOUNDARY.toISOString(),
      created_by_user_id: "cccccccc-3000-4000-8000-000000000005",
      created_at: "2026-01-15T00:00:00.000Z",
    });

    let currentTime = new Date("2026-01-20T00:00:00.000Z"); // before the boundary
    const networkTime = new CountingNetworkTime(currentTime);
    const clock = new ReliableClock({ db, networkTime, now: () => currentTime });
    await clock.sync(); // the ONLY network-time call in this test

    const beforeBoundary = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: (await clock.trustedNow()).toISOString() });
    expect(beforeBoundary?.price_version_id).toBe(CURRENT_PRICE_VERSION_ID);
    expect(beforeBoundary?.unit_price).toBe(10);

    // Advance the till's local clock across the effective_from boundary while offline.
    currentTime = new Date("2026-02-02T00:00:00.000Z");

    const afterBoundary = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: (await clock.trustedNow()).toISOString() });
    expect(afterBoundary?.price_version_id).toBe(FUTURE_PRICE_VERSION_ID);
    expect(afterBoundary?.unit_price).toBe(14);

    // No network time calls beyond the single initial sync.
    expect(networkTime.callCount).toBe(1);
  });
});
