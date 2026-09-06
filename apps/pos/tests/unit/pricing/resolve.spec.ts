import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../support/memory-db";
import { ensurePriceVersionsTable, resolvePrice, type PriceVersionRow } from "../../../src/lib/pricing/resolve";

// T075: canonical effective-dated price resolution (data-model.md §1.7,
// EC-19) — store override wins over global, then latest effective_from,
// then latest created_at (this till's local stand-in for server_ts, per
// resolve.ts's own header comment) as a tie-break for concurrent HQ writes.

const SKU_ID = "sku-0000-0000-0000-000000000001";
const STORE_ID = "store-000-0000-0000-000000000002";
const USER_ID = "user-0000-0000-0000-000000000003";

function seedPriceVersion(db: ReturnType<typeof createMemoryDb>, row: Partial<PriceVersionRow> & { price_version_id: string }): void {
  db.seed("price_versions", "price_version_id", {
    sku_id: SKU_ID,
    store_id: null,
    unit_price: 0,
    currency: "ZMW",
    effective_from: "2026-01-01T00:00:00.000Z",
    created_by_user_id: USER_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    ...row,
  });
}

describe("resolvePrice", () => {
  it("returns null when no price version exists at or before the given time", async () => {
    const db = createMemoryDb();
    await ensurePriceVersionsTable(db);

    const result = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: "2026-01-01T00:00:00.000Z" });
    expect(result).toBeNull();
  });

  it("ignores future-dated price versions and resolves the most recent effective_from that is <= sale time", async () => {
    const db = createMemoryDb();
    seedPriceVersion(db, { price_version_id: "pv-1", unit_price: 10, effective_from: "2026-01-01T00:00:00.000Z" });
    seedPriceVersion(db, { price_version_id: "pv-2", unit_price: 20, effective_from: "2026-06-01T00:00:00.000Z" });

    const beforeFutureChange = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: "2026-02-01T00:00:00.000Z" });
    expect(beforeFutureChange?.unit_price).toBe(10);

    const afterFutureChange = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: "2026-07-01T00:00:00.000Z" });
    expect(afterFutureChange?.unit_price).toBe(20);
  });

  it("store override precedence: a store-scoped price wins over a global price at the same effective date", async () => {
    const db = createMemoryDb();
    seedPriceVersion(db, { price_version_id: "pv-global", store_id: null, unit_price: 10, effective_from: "2026-01-01T00:00:00.000Z" });
    seedPriceVersion(db, { price_version_id: "pv-store", store_id: STORE_ID, unit_price: 8, effective_from: "2026-01-01T00:00:00.000Z" });

    const resolved = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: "2026-01-02T00:00:00.000Z" });
    expect(resolved?.unit_price).toBe(8);
    expect(resolved?.price_version_id).toBe("pv-store");
  });

  it("a store override never leaks into a different store's resolution", async () => {
    const db = createMemoryDb();
    const otherStoreId = "store-000-0000-0000-000000000099";
    seedPriceVersion(db, { price_version_id: "pv-global", store_id: null, unit_price: 10, effective_from: "2026-01-01T00:00:00.000Z" });
    seedPriceVersion(db, { price_version_id: "pv-store", store_id: STORE_ID, unit_price: 8, effective_from: "2026-01-01T00:00:00.000Z" });

    const resolved = await resolvePrice(db, { skuId: SKU_ID, storeId: otherStoreId, atTime: "2026-01-02T00:00:00.000Z" });
    expect(resolved?.unit_price).toBe(10);
    expect(resolved?.price_version_id).toBe("pv-global");
  });

  it("EC-19: concurrent HQ price changes for the same sku/effective_from tie-break by latest created_at (server_ts)", async () => {
    const db = createMemoryDb();
    seedPriceVersion(db, {
      price_version_id: "pv-earlier-write",
      unit_price: 12,
      effective_from: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T09:00:00.000Z",
    });
    seedPriceVersion(db, {
      price_version_id: "pv-later-write",
      unit_price: 15,
      effective_from: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T09:00:05.000Z",
    });

    const resolved = await resolvePrice(db, { skuId: SKU_ID, storeId: STORE_ID, atTime: "2026-01-02T00:00:00.000Z" });
    expect(resolved?.price_version_id).toBe("pv-later-write");
    expect(resolved?.unit_price).toBe(15);
  });
});
