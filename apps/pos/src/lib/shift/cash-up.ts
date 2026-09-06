import type { Tender } from "@hgl/events";

// Pure over/short math (T060 catch-up), extracted out of events/queue.ts and
// app/shift/close/page.tsx so both share one implementation. Mirrors the
// authoritative Postgres generated column `shifts.over_short`
// (`cash_counted - system_cash - opening_float`, data-model.md §2 shifts)
// and `cash_tender_total()` (supabase/migrations/0006_projection_triggers.sql):
// only cash tenders ever feed `system_cash` — card and mobile-money settle
// through their own processor reconciliation, never the drawer count.

export type OverShortInput = {
  openingFloat: number;
  systemCash: number;
  cashCounted: number;
};

export function calculateOverShort({ openingFloat, systemCash, cashCounted }: OverShortInput): number {
  return cashCounted - systemCash - openingFloat;
}

export function sumCashTenders(tenders: readonly Pick<Tender, "type" | "amount">[]): number {
  return tenders.reduce((total, tender) => (tender.type === "cash" ? total + tender.amount : total), 0);
}
