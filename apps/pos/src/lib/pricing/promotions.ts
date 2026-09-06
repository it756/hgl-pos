import type { IDb } from "../db";

// Promotions engine (T066): date-range discounts, BOGO variants, bundle
// pricing, loyalty-tier pricing (FR-025). Split into (1) a query layer that
// loads currently-active promotion rows, and (2) pure calculation functions
// so the discount math is independently testable without a DB (see T076).
//
// Stacking policy (not specified by the spec): the *best single discount*
// per line wins across all matching non-bundle promotions — promotions are
// not additive/stackable in this MVP.

export type PromotionType = "date_range_discount" | "bogo" | "bundle" | "loyalty_tier";

export type DateRangeDiscountPayload = { discount_pct: number } | { discount_amount: number };
export type BogoPayload = { buy: number; get: number; discount_pct: number };
export type BundlePayload = { bundle_sku_ids: string[]; bundle_price: number };
export type LoyaltyTierPayload = { tier: string; discount_pct: number };
export type PromotionPayload = DateRangeDiscountPayload | BogoPayload | BundlePayload | LoyaltyTierPayload;

export type Promotion = {
  promotionId: string;
  type: PromotionType;
  payload: PromotionPayload;
  /** null = no SKU restriction (applies to every SKU in scope). */
  appliesToSkuIds: string[] | null;
  storeId: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type PromotionRow = {
  promotion_id: string;
  type: PromotionType;
  payload: string;
  applies_to_sku_ids: string | null;
  store_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  is_active: number | boolean;
};

export type FindActivePromotionsParams = {
  storeId: string;
  skuId: string;
  atTime: string;
};

export async function findActivePromotions(db: IDb, params: FindActivePromotionsParams): Promise<Promotion[]> {
  await ensurePromotionsTable(db);

  const rows = await db.query<PromotionRow>(
    `SELECT * FROM promotions
    WHERE is_active = 1
      AND (store_id = ? OR store_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY (store_id IS NULL) ASC`,
    [params.storeId, params.atTime, params.atTime],
  );

  return rows.map(parsePromotionRow).filter((promotion) => promotionAppliesToSku(promotion, params.skuId));
}

function parsePromotionRow(row: PromotionRow): Promotion {
  return {
    promotionId: row.promotion_id,
    type: row.type,
    payload: JSON.parse(row.payload) as PromotionPayload,
    appliesToSkuIds: row.applies_to_sku_ids === null ? null : (JSON.parse(row.applies_to_sku_ids) as string[]),
    storeId: row.store_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

function promotionAppliesToSku(promotion: Promotion, skuId: string): boolean {
  return promotion.appliesToSkuIds === null || promotion.appliesToSkuIds.includes(skuId);
}

// ---------- Pure calculation ----------

export type PromotionCartLine = {
  lineId: string;
  skuId: string;
  qty: number;
  unitPrice: number;
};

export type PromotionDiscount = {
  lineId: string;
  promotionId: string;
  discount: number;
};

export type PromotionContext = {
  customerTier?: string | null;
};

export function calculateDateRangeDiscount(payload: DateRangeDiscountPayload, lineSubtotal: number): number {
  if ("discount_pct" in payload) {
    return round2(lineSubtotal * (payload.discount_pct / 100));
  }
  return round2(Math.min(payload.discount_amount, lineSubtotal));
}

export function calculateBogoDiscount(payload: BogoPayload, qty: number, unitPrice: number): number {
  const groupSize = payload.buy + payload.get;
  if (groupSize <= 0) {
    return 0;
  }

  const fullGroups = Math.floor(qty / groupSize);
  const remainder = qty - fullGroups * groupSize;
  const discountedUnits = fullGroups * payload.get + Math.max(0, remainder - payload.buy);

  return round2(discountedUnits * unitPrice * (payload.discount_pct / 100));
}

export function calculateLoyaltyTierDiscount(
  payload: LoyaltyTierPayload,
  lineSubtotal: number,
  customerTier: string | null,
): number {
  if (customerTier === null || customerTier !== payload.tier) {
    return 0;
  }
  return round2(lineSubtotal * (payload.discount_pct / 100));
}

export type BundleDiscountResult = { anchorLineId: string; discount: number };

export function calculateBundleDiscount(payload: BundlePayload, lines: PromotionCartLine[]): BundleDiscountResult | null {
  const matchedLines = payload.bundle_sku_ids.map((skuId) => lines.find((line) => line.skuId === skuId));
  if (matchedLines.some((line) => line === undefined)) {
    return null; // bundle is incomplete — not every required SKU is in the cart
  }
  const resolvedLines = matchedLines as PromotionCartLine[];

  const completeSets = Math.min(...resolvedLines.map((line) => Math.floor(line.qty)));
  if (completeSets <= 0) {
    return null;
  }

  const regularTotal = resolvedLines.reduce((sum, line) => sum + line.unitPrice, 0) * completeSets;
  const discount = Math.max(0, regularTotal - payload.bundle_price * completeSets);

  return { anchorLineId: resolvedLines[0]!.lineId, discount: round2(discount) };
}

export function applyPromotionsToLines(
  lines: PromotionCartLine[],
  promotions: Promotion[],
  context: PromotionContext = {},
): PromotionDiscount[] {
  const bestByLine = new Map<string, PromotionDiscount>();
  const considerBest = (lineId: string, promotionId: string, discount: number): void => {
    if (discount <= 0) {
      return;
    }
    const existing = bestByLine.get(lineId);
    if (existing === undefined || discount > existing.discount) {
      bestByLine.set(lineId, { lineId, promotionId, discount });
    }
  };

  for (const promotion of promotions) {
    if (promotion.type === "bundle") {
      const result = calculateBundleDiscount(promotion.payload as BundlePayload, lines);
      if (result !== null) {
        considerBest(result.anchorLineId, promotion.promotionId, result.discount);
      }
      continue;
    }

    for (const line of lines) {
      if (!promotionAppliesToSku(promotion, line.skuId)) {
        continue;
      }
      const lineSubtotal = line.qty * line.unitPrice;

      if (promotion.type === "date_range_discount") {
        considerBest(line.lineId, promotion.promotionId, calculateDateRangeDiscount(promotion.payload as DateRangeDiscountPayload, lineSubtotal));
      } else if (promotion.type === "bogo") {
        considerBest(line.lineId, promotion.promotionId, calculateBogoDiscount(promotion.payload as BogoPayload, line.qty, line.unitPrice));
      } else if (promotion.type === "loyalty_tier") {
        considerBest(
          line.lineId,
          promotion.promotionId,
          calculateLoyaltyTierDiscount(promotion.payload as LoyaltyTierPayload, lineSubtotal, context.customerTier ?? null),
        );
      }
    }
  }

  return [...bestByLine.values()];
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export async function ensurePromotionsTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS promotions (
      promotion_id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('date_range_discount', 'bogo', 'bundle', 'loyalty_tier')),
      payload TEXT NOT NULL,
      applies_to_sku_ids TEXT,
      store_id TEXT,
      effective_from TEXT,
      effective_to TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.insert(
    `CREATE INDEX IF NOT EXISTS promotions_active_window_idx
    ON promotions (store_id, effective_from, effective_to)`,
  );
}
