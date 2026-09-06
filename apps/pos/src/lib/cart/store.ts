import type { Promotion, PromotionCartLine, PromotionContext } from "../pricing/promotions";
import { applyPromotionsToLines } from "../pricing/promotions";

// Cart state store (T067): quantity + weight line items, line + basket
// discounts, promotion application (FR-002, FR-004). Pure in-memory
// state — no DB/IO. Prices are resolved (pricing/resolve.ts) and matching
// promotions are found (pricing/promotions.ts) by the *caller* before
// calling into this store, keeping the cart itself synchronous and easy
// to unit test.

export type CartLineInput = {
  skuId: string;
  unitType: "quantity" | "weight";
  qty: number;
  unitPrice: number;
  priceVersionId: string;
  batchNo?: string | null;
  expiryDate?: string | null;
};

export type CartLine = {
  lineId: string;
  skuId: string;
  unitType: "quantity" | "weight";
  qty: number;
  unitPrice: number;
  priceVersionId: string;
  batchNo: string | null;
  expiryDate: string | null;
  /** Manually applied by the cashier (FR-004), independent of promotions. */
  manualDiscount: number;
  /** Set by the last applyPromotions() call; null if no promotion matched. */
  promotionId: string | null;
  promotionDiscount: number;
  /** manualDiscount + promotionDiscount */
  lineDiscount: number;
  lineTotal: number;
};

export type CartState = {
  lines: CartLine[];
  basketDiscount: number;
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
};

export type CartListener = (state: CartState) => void;
export type Unsubscribe = () => void;

export class CartStore {
  #lines: CartLine[] = [];
  #basketDiscount = 0;
  readonly #listeners = new Set<CartListener>();

  getState(): CartState {
    return buildCartState(this.#lines, this.#basketDiscount);
  }

  addLine(input: CartLineInput): string {
    if (input.qty <= 0) {
      throw new Error("addLine: qty must be positive");
    }
    if (input.unitPrice < 0) {
      throw new Error("addLine: unitPrice cannot be negative");
    }

    const line: CartLine = {
      lineId: crypto.randomUUID(),
      skuId: input.skuId,
      unitType: input.unitType,
      qty: input.qty,
      unitPrice: input.unitPrice,
      priceVersionId: input.priceVersionId,
      batchNo: input.batchNo ?? null,
      expiryDate: input.expiryDate ?? null,
      manualDiscount: 0,
      promotionId: null,
      promotionDiscount: 0,
      lineDiscount: 0,
      lineTotal: round2(input.qty * input.unitPrice),
    };
    this.#lines.push(line);
    this.#emit();
    return line.lineId;
  }

  updateLineQty(lineId: string, qty: number): void {
    if (qty <= 0) {
      this.removeLine(lineId);
      return;
    }
    const line = this.#requireLine(lineId);
    line.qty = qty;
    recalculateLine(line);
    this.#emit();
  }

  removeLine(lineId: string): void {
    this.#lines = this.#lines.filter((line) => line.lineId !== lineId);
    this.#emit();
  }

  applyLineDiscount(lineId: string, amount: number): void {
    const line = this.#requireLine(lineId);
    line.manualDiscount = Math.max(0, amount);
    recalculateLine(line);
    this.#emit();
  }

  applyBasketDiscount(amount: number): void {
    this.#basketDiscount = Math.max(0, amount);
    this.#emit();
  }

  applyPromotions(promotions: Promotion[], context?: PromotionContext): void {
    const promotionLines: PromotionCartLine[] = this.#lines.map((line) => ({
      lineId: line.lineId,
      skuId: line.skuId,
      qty: line.qty,
      unitPrice: line.unitPrice,
    }));
    const discounts = applyPromotionsToLines(promotionLines, promotions, context);
    const byLineId = new Map(discounts.map((discount) => [discount.lineId, discount]));

    for (const line of this.#lines) {
      const discount = byLineId.get(line.lineId);
      line.promotionId = discount?.promotionId ?? null;
      line.promotionDiscount = discount?.discount ?? 0;
      recalculateLine(line);
    }
    this.#emit();
  }

  clear(): void {
    this.#lines = [];
    this.#basketDiscount = 0;
    this.#emit();
  }

  /** Replaces the current cart with a previously-parked one (cart/parked.ts). */
  restore(state: CartState): void {
    this.#lines = state.lines.map((line) => ({ ...line }));
    this.#basketDiscount = state.basketDiscount;
    this.#emit();
  }

  subscribe(listener: CartListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #requireLine(lineId: string): CartLine {
    const line = this.#lines.find((candidate) => candidate.lineId === lineId);
    if (line === undefined) {
      throw new Error(`Cart line ${lineId} not found`);
    }
    return line;
  }

  #emit(): void {
    const state = this.getState();
    for (const listener of this.#listeners) {
      listener(state);
    }
  }
}

function recalculateLine(line: CartLine): void {
  line.lineDiscount = round2(line.manualDiscount + line.promotionDiscount);
  line.lineTotal = round2(Math.max(0, line.qty * line.unitPrice - line.lineDiscount));
}

function buildCartState(lines: CartLine[], basketDiscount: number): CartState {
  const subtotal = round2(lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0));
  const lineDiscountTotal = round2(lines.reduce((sum, line) => sum + line.lineDiscount, 0));
  const discountTotal = round2(lineDiscountTotal + basketDiscount);
  const grandTotal = round2(Math.max(0, subtotal - discountTotal));

  return {
    lines: lines.map((line) => ({ ...line })),
    basketDiscount,
    subtotal,
    discountTotal,
    grandTotal,
  };
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
