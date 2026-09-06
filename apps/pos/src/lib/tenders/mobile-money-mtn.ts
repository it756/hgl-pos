import { TenderSchema } from "@hgl/events";
import type { Tender } from "./types";

export function buildMobileMoneyMtnTender(amount: number, reference: string): Tender {
  return TenderSchema.parse({ type: "mobile_money_mtn", amount, reference });
}
