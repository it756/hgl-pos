import { describe, expect, it } from "vitest";
import { parseSalesFilters, parseShiftFilters, dayBounds, toQueryString } from "../../../src/lib/sales/filters";
import { summariseShifts, type ShiftRow } from "../../../src/lib/sales/service";
import { buildStoreDayTotals, splitByDay, startOfDayInTimeZone, summariseSales, type SaleTotalsRow } from "../../../src/lib/dashboard/home";
import { activeHref, visibleNavGroups } from "../../../src/components/app-sidebar";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const UUID = "11111111-1111-4111-8111-111111111111";

describe("sales/shift filters", () => {
  it("defaults to the last 7 days and ignores malformed params", () => {
    const filters = parseSalesFilters({ store_id: "not-a-uuid", status: "weird", page: "-3", min_total: "abc" }, NOW);
    expect(filters).toMatchObject({ from: "2026-11-10", to: "2026-11-16", storeId: null, status: null, page: 1, minTotal: null });
  });

  it("keeps valid params, swaps inverted ranges", () => {
    const filters = parseSalesFilters({ from: "2026-11-15", to: "2026-11-01", shift_id: UUID, status: "refunded", page: "3", max_total: "99.5" }, NOW);
    expect(filters).toMatchObject({ from: "2026-11-01", to: "2026-11-15", shiftId: UUID, status: "refunded", page: 3, maxTotal: 99.5 });
    expect(parseShiftFilters({ discrepancy: "1", status: "open" }, NOW)).toMatchObject({ discrepancyOnly: true, status: "open" });
  });

  it("builds inclusive day bounds and compact query strings", () => {
    expect(dayBounds("2026-11-01", "2026-11-02")).toEqual({ fromTs: "2026-11-01T00:00:00.000Z", toTs: "2026-11-03T00:00:00.000Z" });
    expect(toQueryString({ a: "x", b: null, c: false, d: true, page: 2 })).toBe("?a=x&d=1&page=2");
    expect(toQueryString({ a: null })).toBe("");
  });

  it("totals shifts treating open (uncounted) shifts as zero counted", () => {
    const rows = [
      { opening_float: 100, cash_counted: 590, system_cash: 500, over_short: -10 },
      { opening_float: "50", cash_counted: null, system_cash: "20", over_short: null },
    ] as unknown as ShiftRow[];
    expect(summariseShifts(rows)).toEqual({ float: 150, counted: 590, system: 520, overShort: -10 });
  });
});

describe("home dashboard helpers", () => {
  it("finds local midnight for Africa/Lusaka (UTC+2)", () => {
    expect(startOfDayInTimeZone(new Date("2026-11-16T21:30:00.000Z"), "Africa/Lusaka").toISOString()).toBe("2026-11-15T22:00:00.000Z");
    expect(startOfDayInTimeZone(new Date("2026-11-16T22:30:00.000Z"), "Africa/Lusaka").toISOString()).toBe("2026-11-16T22:00:00.000Z");
    expect(startOfDayInTimeZone(new Date("2026-11-16T10:00:00.000Z"), "UTC").toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("nets refunds/voids out of sales and splits by day per store", () => {
    const rows: SaleTotalsRow[] = [
      { store_id: "a", status: "completed", grand_total: "100.10", server_ts: "2026-11-16T08:00:00Z" },
      { store_id: "a", status: "refunded", grand_total: 20, server_ts: "2026-11-16T09:00:00Z" },
      { store_id: "b", status: "completed", grand_total: 50, server_ts: "2026-11-15T09:00:00Z" },
    ];
    expect(summariseSales(rows)).toEqual({ netSales: 130.1, transactions: 2, refunds: 20 });
    const { today, yesterday } = splitByDay(rows, new Date("2026-11-16T00:00:00Z"));
    expect([today.length, yesterday.length]).toEqual([2, 1]);
    const byStore = buildStoreDayTotals(today, yesterday, [
      { store_id: "a", code: "A", name: "Alpha" },
      { store_id: "b", code: "B", name: "Beta" },
    ]);
    expect(byStore.map((s) => [s.storeName, s.netSales, s.previousNetSales])).toEqual([
      ["Alpha", 80.1, 0],
      ["Beta", 0, 50],
    ]);
  });
});

describe("sidebar", () => {
  it("highlights the longest matching route", () => {
    expect(activeHref("/")).toBe("/");
    expect(activeHref("/audit/prices")).toBe("/audit/prices");
    expect(activeHref("/audit")).toBe("/audit");
    expect(activeHref("/counts/abc")).toBe("/counts");
    expect(activeHref("/reports/schedules")).toBe("/reports");
    expect(activeHref("/auditx")).toBeNull();
  });

  it("hides HQ-only routes from store managers and everything from unknown roles", () => {
    const managerHrefs = visibleNavGroups("store_manager").flatMap((group) => group.items.map((item) => item.href));
    expect(managerHrefs).toContain("/counts");
    expect(managerHrefs).not.toContain("/prices");
    expect(managerHrefs).not.toContain("/settings");
    expect(managerHrefs).not.toContain("/stores");
    expect(visibleNavGroups(null)).toEqual([]);
    expect(visibleNavGroups("hq_admin").flatMap((group) => group.items).length).toBeGreaterThan(managerHrefs.length);
  });
});
