import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../../support/memory-db";
import {
  applyPromotionsToLines,
  calculateBogoDiscount,
  calculateBundleDiscount,
  calculateDateRangeDiscount,
  calculateLoyaltyTierDiscount,
  ensurePromotionsTable,
  findActivePromotions,
  type BogoPayload,
  type BundlePayload,
  type LoyaltyTierPayload,
  type PromotionCartLine,
  type PromotionRow,
} from "../../../src/lib/pricing/promotions";

// T076: promotions engine pure-calculation coverage (FR-025) — BOGO
// 1-get-1-free, buy-2-get-1-half-price, bundle, loyalty tier — plus the
// query layer's date-range/store-scope filtering and the "best single
// discount per line wins" stacking policy documented in promotions.ts.

const SKU_A = "sku-a-000-0000-0000-000000000001";
const SKU_B = "sku-b-000-0000-0000-000000000002";
const STORE_ID = "store-000-0000-0000-000000000009";

describe("calculateBogoDiscount", () => {
  it("1-get-1-free (buy 1 get 1, 100% off the free unit): every complete pair discounts one unit in full", () => {
    const payload: BogoPayload = { buy: 1, get: 1, discount_pct: 100 };

    expect(calculateBogoDiscount(payload, 2, 10)).toBe(10); // 1 full pair -> 1 free unit
    expect(calculateBogoDiscount(payload, 4, 10)).toBe(20); // 2 full pairs -> 2 free units
    expect(calculateBogoDiscount(payload, 3, 10)).toBe(10); // 1 full pair + 1 unpaired unit (no discount)
    expect(calculateBogoDiscount(payload, 1, 10)).toBe(0); // no complete pair yet
  });

  it("buy-2-get-1-half-price: every complete group of 3 discounts the 3rd unit by 50%", () => {
    const payload: BogoPayload = { buy: 2, get: 1, discount_pct: 50 };

    expect(calculateBogoDiscount(payload, 3, 10)).toBe(5); // 1 group -> half off 1 unit
    expect(calculateBogoDiscount(payload, 6, 10)).toBe(10); // 2 groups -> half off 2 units
    expect(calculateBogoDiscount(payload, 2, 10)).toBe(0); // group incomplete
    expect(calculateBogoDiscount(payload, 5, 10)).toBe(5); // 1 group + 2 unpaired units
  });
});

describe("calculateDateRangeDiscount", () => {
  it("applies a percentage discount", () => {
    expect(calculateDateRangeDiscount({ discount_pct: 20 }, 100)).toBe(20);
  });

  it("applies a flat amount discount, capped at the line subtotal", () => {
    expect(calculateDateRangeDiscount({ discount_amount: 5 }, 100)).toBe(5);
    expect(calculateDateRangeDiscount({ discount_amount: 500 }, 100)).toBe(100);
  });
});

describe("calculateLoyaltyTierDiscount", () => {
  const payload: LoyaltyTierPayload = { tier: "gold", discount_pct: 10 };

  it("applies the tier discount only when the customer's tier matches", () => {
    expect(calculateLoyaltyTierDiscount(payload, 100, "gold")).toBe(10);
  });

  it("applies zero discount for a non-matching or missing tier", () => {
    expect(calculateLoyaltyTierDiscount(payload, 100, "silver")).toBe(0);
    expect(calculateLoyaltyTierDiscount(payload, 100, null)).toBe(0);
  });
});

describe("calculateBundleDiscount", () => {
  const payload: BundlePayload = { bundle_sku_ids: [SKU_A, SKU_B], bundle_price: 15 };

  it("discounts one complete bundle set down to the bundle price, anchored on the first bundle SKU", () => {
    const lines: PromotionCartLine[] = [
      { lineId: "line-a", skuId: SKU_A, qty: 1, unitPrice: 10 },
      { lineId: "line-b", skuId: SKU_B, qty: 1, unitPrice: 10 },
    ];

    const result = calculateBundleDiscount(payload, lines);
    expect(result).toEqual({ anchorLineId: "line-a", discount: 5 }); // (10 + 10) - 15
  });

  it("scales the discount by the number of complete sets, limited by the scarcest bundle SKU", () => {
    const lines: PromotionCartLine[] = [
      { lineId: "line-a", skuId: SKU_A, qty: 3, unitPrice: 10 },
      { lineId: "line-b", skuId: SKU_B, qty: 2, unitPrice: 10 },
    ];

    const result = calculateBundleDiscount(payload, lines);
    expect(result).toEqual({ anchorLineId: "line-a", discount: 10 }); // 2 complete sets: (10+10)*2 - 15*2 = 10
  });

  it("returns null when the cart is missing one of the required bundle SKUs", () => {
    const lines: PromotionCartLine[] = [{ lineId: "line-a", skuId: SKU_A, qty: 1, unitPrice: 10 }];
    expect(calculateBundleDiscount(payload, lines)).toBeNull();
  });
});

describe("applyPromotionsToLines — best-single-discount-per-line stacking policy", () => {
  it("picks the single best-value promotion per line when multiple promotions could apply", () => {
    const lines: PromotionCartLine[] = [{ lineId: "line-a", skuId: SKU_A, qty: 1, unitPrice: 100 }];
    const promotions = [
      { promotionId: "promo-small", type: "date_range_discount" as const, payload: { discount_pct: 5 }, appliesToSkuIds: null, storeId: null, effectiveFrom: null, effectiveTo: null },
      { promotionId: "promo-big", type: "date_range_discount" as const, payload: { discount_pct: 25 }, appliesToSkuIds: null, storeId: null, effectiveFrom: null, effectiveTo: null },
    ];

    const discounts = applyPromotionsToLines(lines, promotions);
    expect(discounts).toEqual([{ lineId: "line-a", promotionId: "promo-big", discount: 25 }]);
  });

  it("applies a loyalty-tier promotion only when the cart's customer context matches the tier", () => {
    const lines: PromotionCartLine[] = [{ lineId: "line-a", skuId: SKU_A, qty: 1, unitPrice: 100 }];
    const promotions = [
      { promotionId: "promo-gold", type: "loyalty_tier" as const, payload: { tier: "gold", discount_pct: 10 }, appliesToSkuIds: null, storeId: null, effectiveFrom: null, effectiveTo: null },
    ];

    expect(applyPromotionsToLines(lines, promotions, { customerTier: "gold" })).toEqual([
      { lineId: "line-a", promotionId: "promo-gold", discount: 10 },
    ]);
    expect(applyPromotionsToLines(lines, promotions, { customerTier: "silver" })).toEqual([]);
  });
});

describe("findActivePromotions (query layer)", () => {
  function seedPromotion(db: ReturnType<typeof createMemoryDb>, row: Partial<PromotionRow> & { promotion_id: string }): void {
    db.seed("promotions", "promotion_id", {
      type: "date_range_discount",
      payload: JSON.stringify({ discount_pct: 10 }),
      applies_to_sku_ids: null,
      store_id: null,
      effective_from: null,
      effective_to: null,
      is_active: 1,
      ...row,
    });
  }

  it("excludes promotions outside their active date window", async () => {
    const db = createMemoryDb();
    await ensurePromotionsTable(db);
    seedPromotion(db, { promotion_id: "promo-past", effective_from: "2025-01-01T00:00:00.000Z", effective_to: "2025-02-01T00:00:00.000Z" });
    seedPromotion(db, { promotion_id: "promo-current", effective_from: "2026-01-01T00:00:00.000Z", effective_to: "2026-12-31T00:00:00.000Z" });

    const active = await findActivePromotions(db, { storeId: STORE_ID, skuId: SKU_A, atTime: "2026-06-01T00:00:00.000Z" });
    expect(active.map((p) => p.promotionId)).toEqual(["promo-current"]);
  });

  it("excludes promotions scoped to a different SKU list", async () => {
    const db = createMemoryDb();
    await ensurePromotionsTable(db);
    seedPromotion(db, { promotion_id: "promo-other-sku", applies_to_sku_ids: JSON.stringify([SKU_B]) });
    seedPromotion(db, { promotion_id: "promo-this-sku", applies_to_sku_ids: JSON.stringify([SKU_A]) });
    seedPromotion(db, { promotion_id: "promo-unscoped", applies_to_sku_ids: null });

    const active = await findActivePromotions(db, { storeId: STORE_ID, skuId: SKU_A, atTime: "2026-06-01T00:00:00.000Z" });
    expect(active.map((p) => p.promotionId).sort()).toEqual(["promo-this-sku", "promo-unscoped"]);
  });
});
