import type { TenderSchema } from "@hgl/events";
import type { z } from "zod";

// Shared types/helpers for tender adapters (T069). Each adapter builds and
// zod-validates a `Tender` matching @hgl/events' `TenderSchema` exactly, so
// whatever the sale event builder (T071) stamps into `sale_events.tenders`
// is guaranteed to satisfy the wire contract at construction time, not just
// at submit time.

export type Tender = z.infer<typeof TenderSchema>;

export function sumTenderAmounts(tenders: readonly Tender[]): number {
  return round2(tenders.reduce((sum, tender) => sum + tender.amount, 0));
}

/** How much of `grandTotal` is still unpaid after `tenders` — drives split-tender UI (FR-003). */
export function remainingBalance(grandTotal: number, tenders: readonly Tender[]): number {
  return round2(Math.max(0, grandTotal - sumTenderAmounts(tenders)));
}

export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
