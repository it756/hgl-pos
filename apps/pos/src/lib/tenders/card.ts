import { TenderSchema } from "@hgl/events";
import type { Tender } from "./types";

// Card tender adapter (T069): reader-token flow — only a masked PAN
// (last 4 digits) and an opaque reader token are ever handled here; the
// full PAN never enters app code / never gets persisted (FR-003 scope).

export type CardReaderResult = {
  amount: number;
  reference: string;
  cardReaderToken: string;
  /** Last 4 digits only — the reader hardware retains the full PAN, never the app. */
  panLastFour: string;
};

export function maskPan(panLastFour: string): string {
  if (!/^\d{4}$/.test(panLastFour)) {
    throw new Error("maskPan: expected exactly 4 digits");
  }
  return `****${panLastFour}`;
}

export function buildCardTender(result: CardReaderResult): Tender {
  return TenderSchema.parse({
    type: "card",
    amount: result.amount,
    reference: result.reference,
    card_masked_pan: maskPan(result.panLastFour),
    card_reader_token: result.cardReaderToken,
  });
}

// Card-reader hardware integration (serial/USB bridge or Tauri plugin) isn't
// wired yet — this stub fails loudly rather than fabricating a fake read.
export function readCardFromReader(): Promise<CardReaderResult> {
  return Promise.reject(
    new Error("Card reader integration is not wired yet; call buildCardTender() with a real CardReaderResult."),
  );
}
