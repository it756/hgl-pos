import { TenderSchema } from "@hgl/events";
import { round2, type Tender } from "./types";

export function buildCashTender(amount: number): Tender {
  return TenderSchema.parse({ type: "cash", amount, reference: null });
}

export function calculateChangeDue(amountTendered: number, amountDue: number): number {
  if (amountTendered < amountDue) {
    throw new Error("calculateChangeDue: amountTendered is less than amountDue");
  }
  return round2(amountTendered - amountDue);
}
