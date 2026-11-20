import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../support/memory-db";
import { filterBrowseItems, loadBrowseCatalog } from "../../../src/lib/catalog/browse";

const STORE_ID = "store-1";
const OTHER_STORE_ID = "store-2";
const AT = "2026-06-01T00:00:00.000Z";

type Db = ReturnType<typeof createMemoryDb>;

function seedSku(db: Db, skuId: string, name: string, extra: Record<string, string | number | null> = {}): void {
  db.seed("skus", "sku_id", {
    sku_id: skuId,
    code: `code-${skuId}`,
    barcode: `bc-${skuId}`,
    name,
    category_id: null,
    unit_type: "quantity",
    track_batch: 0,
    track_expiry: 0,
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  });
}

function seedPrice(db: Db, id: string, skuId: string, unitPrice: number, extra: Record<string, string | null> = {}): void {
  db.seed("price_versions", "price_version_id", {
    price_version_id: id,
    sku_id: skuId,
    store_id: null,
    unit_price: unitPrice,
    currency: "ZMW",
    effective_from: "2026-01-01T00:00:00.000Z",
    created_by_user_id: "user-1",
    created_at: "2026-01-01T00:00:00.000Z",
    ...extra,
  });
}

function seedCategory(db: Db, id: string, name: string): void {
  db.seed("sku_categories", "category_id", {
    category_id: id,
    code: id,
    name,
    parent_category_id: null,
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

describe("loadBrowseCatalog", () => {
  it("resolves prices with the same precedence as resolvePrice (store override, then latest effective_from)", async () => {
    const db = createMemoryDb();
    seedSku(db, "sku-a", "Apple");
    seedPrice(db, "pv-global-old", "sku-a", 10);
    seedPrice(db, "pv-global-new", "sku-a", 12, { effective_from: "2026-03-01T00:00:00.000Z" });
    seedPrice(db, "pv-store", "sku-a", 9, { store_id: STORE_ID });
    seedPrice(db, "pv-other-store", "sku-a", 1, { store_id: OTHER_STORE_ID, effective_from: "2026-05-01T00:00:00.000Z" });
    seedPrice(db, "pv-future", "sku-a", 99, { store_id: STORE_ID, effective_from: "2026-12-01T00:00:00.000Z" });

    const { items } = await loadBrowseCatalog(db, { storeId: STORE_ID, atTime: AT });

    expect(items).toHaveLength(1);
    expect(items[0]?.price?.price_version_id).toBe("pv-store");
  });

  it("falls back to the latest global price and returns null when no price is effective", async () => {
    const db = createMemoryDb();
    seedSku(db, "sku-a", "Apple");
    seedSku(db, "sku-b", "Bread");
    seedPrice(db, "pv-1", "sku-a", 10);
    seedPrice(db, "pv-2", "sku-a", 12, { effective_from: "2026-03-01T00:00:00.000Z" });
    seedPrice(db, "pv-b-future", "sku-b", 5, { effective_from: "2026-12-01T00:00:00.000Z" });

    const { items } = await loadBrowseCatalog(db, { storeId: STORE_ID, atTime: AT });
    const bySku = new Map(items.map((item) => [item.sku.sku_id, item]));

    expect(bySku.get("sku-a")?.price?.unit_price).toBe(12);
    expect(bySku.get("sku-b")?.price).toBeNull();
  });

  it("joins this store's stock, sorts by name, skips inactive SKUs and only returns categories in use", async () => {
    const db = createMemoryDb();
    seedCategory(db, "cat-bakery", "Bakery");
    seedCategory(db, "cat-unused", "Unused");
    seedSku(db, "sku-b", "Bread", { category_id: "cat-bakery" });
    seedSku(db, "sku-a", "Apple");
    seedSku(db, "sku-x", "Inactive", { is_active: 0 });
    db.seed("current_stock_by_store_sku", "sku_id", { store_id: STORE_ID, sku_id: "sku-b", qty_on_hand: 4 });

    const { items, categories } = await loadBrowseCatalog(db, { storeId: STORE_ID, atTime: AT });

    expect(items.map((item) => item.sku.name)).toEqual(["Apple", "Bread"]);
    expect(items[0]?.qtyOnHand).toBeNull();
    expect(items[1]?.qtyOnHand).toBe(4);
    expect(categories.map((category) => category.name)).toEqual(["Bakery"]);
  });
});

describe("filterBrowseItems", () => {
  it("filters by category and by name, code or barcode", async () => {
    const db = createMemoryDb();
    seedSku(db, "sku-a", "Apple juice", { category_id: "cat-drinks" });
    seedSku(db, "sku-b", "Bread loaf", { category_id: "cat-bakery", barcode: "600100" });
    const { items } = await loadBrowseCatalog(db, { storeId: STORE_ID, atTime: AT });

    expect(filterBrowseItems(items, { categoryId: "cat-bakery", search: "" }).map((i) => i.sku.sku_id)).toEqual(["sku-b"]);
    expect(filterBrowseItems(items, { categoryId: null, search: "JUICE" }).map((i) => i.sku.sku_id)).toEqual(["sku-a"]);
    expect(filterBrowseItems(items, { categoryId: null, search: "6001" }).map((i) => i.sku.sku_id)).toEqual(["sku-b"]);
    expect(filterBrowseItems(items, { categoryId: null, search: "code-sku-a" }).map((i) => i.sku.sku_id)).toEqual(["sku-a"]);
  });
});
