import { describe, expect, it } from "vitest";
import { calculateOverShort, sumCashTenders } from "../../../src/lib/shift/cash-up";

// T060 catch-up coverage for apps/pos/src/lib/shift/cash-up.ts, extracted
// from events/queue.ts's inline formula. Mirrors the authoritative Postgres
// generated column `shifts.over_short` and `cash_tender_total()`
// (supabase/migrations/0006_projection_triggers.sql): only cash tenders
// ever feed the drawer reconciliation — card and mobile-money settle
// through their own processor, independent of the till's cash count.

describe("calculateOverShort", () => {
  it("is zero when cash counted exactly matches opening float + system cash", () => {
    expect(calculateOverShort({ openingFloat: 500, systemCash: 320.5, cashCounted: 820.5 })).toBe(0);
  });

  it("is positive (over) when more cash is counted than expected", () => {
    expect(calculateOverShort({ openingFloat: 500, systemCash: 320.5, cashCounted: 830 })).toBeCloseTo(9.5);
  });

  it("is negative (short) when less cash is counted than expected", () => {
    expect(calculateOverShort({ openingFloat: 500, systemCash: 320.5, cashCounted: 810 })).toBeCloseTo(-10.5);
  });

  it("ignores card/mobile-money contributions entirely — only systemCash (cash-only) and cashCounted matter", () => {
    // Same cash mix, but systemCash already excludes card/mobile-money by
    // construction (see sumCashTenders below) — verifies the formula itself
    // doesn't need to know about non-cash tenders at all.
    const withoutNonCashTenders = calculateOverShort({ openingFloat: 200, systemCash: 150, cashCounted: 350 });
    expect(withoutNonCashTenders).toBe(0);
  });
});

describe("sumCashTenders", () => {
  it("sums only cash tenders out of a mixed cash + card + mobile-money basket", () => {
    const tenders = [
      { type: "cash" as const, amount: 50 },
      { type: "card" as const, amount: 120 },
      { type: "mobile_money_mtn" as const, amount: 75 },
      { type: "cash" as const, amount: 30 },
      { type: "mobile_money_airtel" as const, amount: 40 },
    ];

    expect(sumCashTenders(tenders)).toBe(80);
  });

  it("returns 0 for an all-card/mobile-money basket with no cash tender", () => {
    const tenders = [
      { type: "card" as const, amount: 100 },
      { type: "mobile_money_mtn" as const, amount: 50 },
    ];

    expect(sumCashTenders(tenders)).toBe(0);
  });

  it("returns 0 for an empty tender list", () => {
    expect(sumCashTenders([])).toBe(0);
  });

  it("sums multiple cash tenders on the same sale", () => {
    const tenders = [
      { type: "cash" as const, amount: 20 },
      { type: "cash" as const, amount: 15.5 },
    ];

    expect(sumCashTenders(tenders)).toBeCloseTo(35.5);
  });

  it("composes with calculateOverShort across a shift with a cash/card/mobile-money sales mix", () => {
    const salesTenders = [
      [{ type: "cash" as const, amount: 100 }],
      [{ type: "card" as const, amount: 250 }],
      [
        { type: "cash" as const, amount: 40 },
        { type: "mobile_money_airtel" as const, amount: 60 },
      ],
    ];

    const systemCash = salesTenders.reduce((total, tenders) => total + sumCashTenders(tenders), 0);
    expect(systemCash).toBe(140);

    // Cashier counts exactly opening float + the cash-only system total —
    // card/mobile-money amounts must not have leaked into the expectation.
    const overShort = calculateOverShort({ openingFloat: 500, systemCash, cashCounted: 640 });
    expect(overShort).toBe(0);
  });
});
