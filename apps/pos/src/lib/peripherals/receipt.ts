import type { Tender } from "../tenders/types";
import { runPeripheralOperation, retryPeripheralOperation } from "./index";
import type { PeripheralOperationOptions, ReceiptLine, ReceiptPrintJob, ReceiptPrinterAdapter } from "./index";

// Receipt renderer (T073, FR-007): text-mode for the thermal printer, plus a
// digital-receipt PDF. Both are built from the same line-array source of
// truth so wording never drifts between the printed copy and the digital
// one. Takes already-resolved display data (SKU names etc.) rather than a
// raw `SaleEvent` — peripherals modules stay DB-free, matching the other
// adapters in this directory.

export type ReceiptLineItem = {
  skuName: string;
  qty: number;
  unitPrice: number;
  lineDiscount: number;
  lineTotal: number;
};

export type ReceiptData = {
  storeName: string;
  storeAddress?: string | null;
  tillLabel: string;
  cashierName: string;
  saleId: string;
  /** ISO timestamp — the sale's `client_ts`. */
  clientTs: string;
  status: "completed" | "voided" | "refunded";
  items: readonly ReceiptLineItem[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  grandTotal: number;
  tenders: readonly Tender[];
  changeDue?: number;
};

const RECEIPT_WIDTH_CHARS = 32;

function describeTenderType(type: Tender["type"]): string {
  switch (type) {
    case "cash":
      return "Cash";
    case "card":
      return "Card";
    case "mobile_money_mtn":
      return "MTN Mobile Money";
    case "mobile_money_airtel":
      return "Airtel Money";
  }
}

export function buildReceiptTextLines(data: ReceiptData): string[] {
  const lines: string[] = [];
  lines.push(data.storeName);
  if (data.storeAddress !== null && data.storeAddress !== undefined) {
    lines.push(data.storeAddress);
  }
  lines.push(`Till: ${data.tillLabel}  Cashier: ${data.cashierName}`);
  lines.push(`Sale: ${data.saleId}`);
  lines.push(`Date: ${data.clientTs}`);
  lines.push("-".repeat(RECEIPT_WIDTH_CHARS));

  for (const item of data.items) {
    lines.push(`${item.skuName}`);
    lines.push(`  ${item.qty} x ${item.unitPrice.toFixed(2)} = ${item.lineTotal.toFixed(2)}`);
    if (item.lineDiscount > 0) {
      lines.push(`  Discount: -${item.lineDiscount.toFixed(2)}`);
    }
  }

  lines.push("-".repeat(RECEIPT_WIDTH_CHARS));
  lines.push(`Subtotal: ${data.subtotal.toFixed(2)}`);
  if (data.discountTotal > 0) {
    lines.push(`Discount: -${data.discountTotal.toFixed(2)}`);
  }
  if (data.taxTotal > 0) {
    lines.push(`Tax: ${data.taxTotal.toFixed(2)}`);
  }
  lines.push(`TOTAL: ${data.grandTotal.toFixed(2)}`);
  lines.push("-".repeat(RECEIPT_WIDTH_CHARS));

  for (const tender of data.tenders) {
    lines.push(`${describeTenderType(tender.type)}: ${tender.amount.toFixed(2)}`);
  }
  if (data.changeDue !== undefined && data.changeDue > 0) {
    lines.push(`Change: ${data.changeDue.toFixed(2)}`);
  }

  if (data.status !== "completed") {
    lines.push("");
    lines.push(`** ${data.status.toUpperCase()} **`);
  }

  return lines;
}

export function buildReceiptPrintJob(data: ReceiptData): ReceiptPrintJob {
  const lines: ReceiptLine[] = buildReceiptTextLines(data).map((text) => ({ text }));
  return {
    receiptId: data.saleId,
    lines,
    cutPaper: true,
    openDrawer: data.tenders.some((tender) => tender.type === "cash"),
  };
}

export async function printReceipt(
  printer: ReceiptPrinterAdapter,
  data: ReceiptData,
  options?: PeripheralOperationOptions,
): Promise<void> {
  const job = buildReceiptPrintJob(data);
  await retryPeripheralOperation(() =>
    runPeripheralOperation((signal) => printer.printReceipt(job, { ...options, signal }), options),
  );
}

// ---------- Digital receipt (PDF) ----------
//
// Hand-rolled minimal single-content-stream PDF (no new dependency — same
// call as events/id.ts's hand-rolled UUID v5). The page is sized to the
// receipt's own line count rather than paginating onto a fixed page, so it
// renders like a single continuous receipt strip.

const PDF_PAGE_WIDTH_PT = 226.77; // 80mm thermal-equivalent width at 72pt/inch
const PDF_MARGIN_PT = 14;
const PDF_FONT_SIZE_PT = 8;
const PDF_LINE_HEIGHT_PT = 10;
const PDF_MAX_CHARS_PER_LINE = 38; // fits Courier at 8pt within PDF_PAGE_WIDTH_PT

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }

  const words = line.split(" ");
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > maxChars) {
      if (current.length > 0) {
        wrapped.push(current);
      }
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    wrapped.push(current);
  }
  return wrapped;
}

export function renderDigitalReceiptPdf(data: ReceiptData): Uint8Array {
  const wrapped = buildReceiptTextLines(data).flatMap((line) => wrapLine(line, PDF_MAX_CHARS_PER_LINE));
  const height = PDF_MARGIN_PT * 2 + Math.max(wrapped.length, 1) * PDF_LINE_HEIGHT_PT;

  const contentStream = wrapped
    .map((line, index) => {
      const y = height - PDF_MARGIN_PT - index * PDF_LINE_HEIGHT_PT;
      return `BT /F1 ${PDF_FONT_SIZE_PT} Tf ${PDF_MARGIN_PT} ${y.toFixed(2)} Td (${escapePdfText(line)}) Tj ET`;
    })
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH_PT.toFixed(2)} ${height.toFixed(2)}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}
