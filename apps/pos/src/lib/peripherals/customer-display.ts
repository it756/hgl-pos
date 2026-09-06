import { runPeripheralOperation } from "./index";
import type { PeripheralAdapter, PeripheralOperationOptions } from "./index";

// Optional customer-facing display (T074, FR-009 — MAY). Rendering is a
// pure function of the current checkout state; the adapter itself is a
// separate, not-yet-implemented hardware integration (pole display /
// second monitor), same "interface now, hardware later" split as the rest
// of this directory (T043).

export type CustomerDisplayLine = {
  text: string;
  align?: "left" | "center" | "right";
};

export type CustomerDisplayState =
  | { kind: "idle"; message: string }
  | { kind: "line_item"; skuName: string; qty: number; unitPrice: number; lineTotal: number }
  | { kind: "total"; grandTotal: number }
  | { kind: "tender_prompt"; amountDue: number }
  | { kind: "change_due"; amount: number }
  | { kind: "thank_you" };

export type CustomerDisplayAdapter = PeripheralAdapter<"customer_display"> & {
  show(state: CustomerDisplayState, options?: PeripheralOperationOptions): Promise<void>;
  clear(options?: PeripheralOperationOptions): Promise<void>;
};

export function renderCustomerDisplayLines(state: CustomerDisplayState): CustomerDisplayLine[] {
  switch (state.kind) {
    case "idle":
      return [{ text: state.message, align: "center" }];
    case "line_item":
      return [
        { text: state.skuName, align: "left" },
        { text: `${state.qty} x ${state.unitPrice.toFixed(2)} = ${state.lineTotal.toFixed(2)}`, align: "right" },
      ];
    case "total":
      return [
        { text: "TOTAL", align: "left" },
        { text: state.grandTotal.toFixed(2), align: "right" },
      ];
    case "tender_prompt":
      return [
        { text: "AMOUNT DUE", align: "left" },
        { text: state.amountDue.toFixed(2), align: "right" },
      ];
    case "change_due":
      return [
        { text: "CHANGE", align: "left" },
        { text: state.amount.toFixed(2), align: "right" },
      ];
    case "thank_you":
      return [{ text: "Thank you!", align: "center" }];
  }
}

export async function showOnCustomerDisplay(
  display: CustomerDisplayAdapter,
  state: CustomerDisplayState,
  options?: PeripheralOperationOptions,
): Promise<void> {
  await runPeripheralOperation((signal) => display.show(state, { ...options, signal }), options);
}
