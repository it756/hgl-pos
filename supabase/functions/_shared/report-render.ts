// Shared CSV/PDF rendering helpers for report-export and report-scheduler.
// No new npm dependency — CSV is joined strings, and the PDF is a
// hand-rolled minimal single-content-stream PDF, the same low-level
// approach as apps/pos/src/lib/peripherals/receipt.ts's digital receipt,
// just adapted here for a plain text table instead of a receipt strip.

export type ReportRow = Record<string, string | number | boolean | null>;

export function rowsToCsv(rows: ReportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }
  return lines.join("\n");
}

function escapeCsvCell(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const PDF_PAGE_WIDTH_PT = 792; // US Letter width at 72pt/inch — wide enough for most tabular reports
const PDF_MARGIN_PT = 24;
const PDF_FONT_SIZE_PT = 8;
const PDF_LINE_HEIGHT_PT = 11;
const PDF_COLUMN_MIN_WIDTH_CHARS = 10;

function escapePdfText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function formatCell(value: string | number | boolean | null, width: number): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
}

// Single tall page sized to the row count (no fixed-page pagination) — same
// simplifying choice as receipt.ts. Fine for the row counts these v1
// reports produce; real pagination is left as follow-up if reports grow
// large enough to need it.
export function rowsToPdf(title: string, rows: ReportRow[]): Uint8Array {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const columnWidth = Math.max(PDF_COLUMN_MIN_WIDTH_CHARS, headers.length > 0 ? Math.floor(96 / headers.length) : 12);

  const lines: string[] = [title, ""];
  if (headers.length > 0) {
    lines.push(headers.map((header) => formatCell(header.toUpperCase(), columnWidth)).join(" "));
    lines.push("-".repeat((columnWidth + 1) * headers.length));
  }
  for (const row of rows) {
    lines.push(headers.map((header) => formatCell(row[header], columnWidth)).join(" "));
  }
  if (rows.length === 0) lines.push("(no rows)");

  const height = PDF_MARGIN_PT * 2 + Math.max(lines.length, 1) * PDF_LINE_HEIGHT_PT;
  const contentStream = lines
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

export type ReportKind =
  | "sales_by_store"
  | "sales_by_cashier"
  | "sales_by_sku"
  | "inventory_on_hand"
  | "transfer_history"
  | "till_reconciliation";

export const REPORT_KINDS: readonly ReportKind[] = [
  "sales_by_store",
  "sales_by_cashier",
  "sales_by_sku",
  "inventory_on_hand",
  "transfer_history",
  "till_reconciliation",
];

export type ReportParams = {
  from: string;
  to: string;
  store_id?: string;
};

/** `to` is exclusive — one day past the requested end date. */
export function toRangeTimestamps(params: ReportParams): { fromTs: string; toTs: string } {
  const fromTs = new Date(`${params.from}T00:00:00.000Z`).toISOString();
  const toExclusive = new Date(`${params.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return { fromTs, toTs: toExclusive.toISOString() };
}

export type NameMaps = {
  storeNames: Map<string, string>;
  skuNames: Map<string, string>;
  tillLabels: Map<string, string>;
  userNames: Map<string, string>;
};

// deno-lint-ignore no-explicit-any
export async function loadNameMaps(supabase: any): Promise<NameMaps> {
  const [storesResult, skusResult, tillsResult, usersResult] = await Promise.all([
    supabase.from("stores").select("store_id, name"),
    supabase.from("skus").select("sku_id, name"),
    supabase.from("tills").select("till_id, label"),
    supabase.from("users").select("user_id, full_name"),
  ]);

  const storeRows: { store_id: string; name: string }[] = storesResult.data ?? [];
  const skuRows: { sku_id: string; name: string }[] = skusResult.data ?? [];
  const tillRows: { till_id: string; label: string }[] = tillsResult.data ?? [];
  const userRows: { user_id: string; full_name: string }[] = usersResult.data ?? [];

  return {
    storeNames: new Map(storeRows.map((row) => [row.store_id, row.name])),
    skuNames: new Map(skuRows.map((row) => [row.sku_id, row.name])),
    tillLabels: new Map(tillRows.map((row) => [row.till_id, row.label])),
    userNames: new Map(userRows.map((row) => [row.user_id, row.full_name])),
  };
}

// deno-lint-ignore no-explicit-any
export async function buildReportRows(supabase: any, report: ReportKind, params: ReportParams): Promise<ReportRow[]> {
  const { fromTs, toTs } = toRangeTimestamps(params);
  const names = await loadNameMaps(supabase);

  switch (report) {
    case "sales_by_store":
    case "sales_by_cashier":
      return buildSalesRows(supabase, report, fromTs, toTs, params.store_id, names);
    case "sales_by_sku":
      return buildSalesBySkuRows(supabase, fromTs, toTs, params.store_id, names);
    case "inventory_on_hand":
      return buildInventoryOnHandRows(supabase, params.store_id, names);
    case "transfer_history":
      return buildTransferHistoryRows(supabase, fromTs, toTs, params.store_id, names);
    case "till_reconciliation":
      return buildReconciliationRows(supabase, fromTs, toTs, params.store_id, names);
  }
}

type SaleRow = {
  store_id: string;
  till_id: string;
  cashier_id: string;
  client_ts: string;
  grand_total: number;
  discount_total: number;
  tax_total: number;
};

async function buildSalesRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  report: "sales_by_store" | "sales_by_cashier",
  fromTs: string,
  toTs: string,
  storeId: string | undefined,
  names: NameMaps,
): Promise<ReportRow[]> {
  let query = supabase
    .from("sales")
    .select("store_id, till_id, cashier_id, client_ts, grand_total, discount_total, tax_total")
    .eq("latest_status", "completed")
    .gte("client_ts", fromTs)
    .lt("client_ts", toTs);
  if (storeId !== undefined) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error !== null) throw new Error(`Failed to load sales: ${error.message}`);
  const sales: SaleRow[] = data ?? [];

  const groupKey = report === "sales_by_store" ? "store_id" : "cashier_id";
  const grouped = new Map<string, { store_id: string; sale_count: number; net_sales: number; discount_total: number; tax_total: number }>();
  for (const sale of sales) {
    const key = report === "sales_by_store" ? sale.store_id : sale.cashier_id;
    const row = grouped.get(key) ?? { store_id: sale.store_id, sale_count: 0, net_sales: 0, discount_total: 0, tax_total: 0 };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    row.discount_total += sale.discount_total;
    row.tax_total += sale.tax_total;
    grouped.set(key, row);
  }

  return [...grouped.entries()].map(([key, row]) => ({
    [groupKey === "store_id" ? "store" : "cashier"]: groupKey === "store_id" ? names.storeNames.get(key) ?? key : names.userNames.get(key) ?? key,
    store: names.storeNames.get(row.store_id) ?? row.store_id,
    sale_count: row.sale_count,
    net_sales: row.net_sales.toFixed(2),
    discount_total: row.discount_total.toFixed(2),
    tax_total: row.tax_total.toFixed(2),
  }));
}

async function buildSalesBySkuRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fromTs: string,
  toTs: string,
  storeId: string | undefined,
  names: NameMaps,
): Promise<ReportRow[]> {
  let query = supabase.from("sale_events").select("store_id, client_ts, items").eq("status", "completed").gte("client_ts", fromTs).lt("client_ts", toTs);
  if (storeId !== undefined) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error !== null) throw new Error(`Failed to load sale line items: ${error.message}`);
  const events: { items: unknown }[] = data ?? [];

  const grouped = new Map<string, { qty_sold: number; line_total: number }>();
  for (const event of events) {
    const items: { sku_id: string; qty: number; line_total: number }[] = Array.isArray(event.items) ? event.items : [];
    for (const item of items) {
      const row = grouped.get(item.sku_id) ?? { qty_sold: 0, line_total: 0 };
      row.qty_sold += item.qty;
      row.line_total += item.line_total;
      grouped.set(item.sku_id, row);
    }
  }

  return [...grouped.entries()].map(([skuId, row]) => ({
    sku: names.skuNames.get(skuId) ?? skuId,
    qty_sold: row.qty_sold,
    line_total: row.line_total.toFixed(2),
  }));
}

async function buildInventoryOnHandRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  storeId: string | undefined,
  names: NameMaps,
): Promise<ReportRow[]> {
  let query = supabase.from("current_stock_by_store_sku").select("store_id, sku_id, qty_on_hand, qty_in_transit_out, qty_in_transit_in, is_oversold");
  if (storeId !== undefined) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error !== null) throw new Error(`Failed to load on-hand stock: ${error.message}`);
  const rows: { store_id: string; sku_id: string; qty_on_hand: number; qty_in_transit_out: number; qty_in_transit_in: number; is_oversold: boolean }[] =
    data ?? [];

  return rows.map((row) => ({
    store: names.storeNames.get(row.store_id) ?? row.store_id,
    sku: names.skuNames.get(row.sku_id) ?? row.sku_id,
    qty_on_hand: row.qty_on_hand,
    qty_in_transit_out: row.qty_in_transit_out,
    qty_in_transit_in: row.qty_in_transit_in,
    is_oversold: row.is_oversold,
  }));
}

async function buildTransferHistoryRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fromTs: string,
  toTs: string,
  storeId: string | undefined,
  names: NameMaps,
): Promise<ReportRow[]> {
  let query = supabase
    .from("transfers")
    .select("transfer_id, source_store_id, destination_store_id, state, requested_at, received_at, last_event_server_ts")
    .gte("last_event_server_ts", fromTs)
    .lt("last_event_server_ts", toTs);
  if (storeId !== undefined) query = query.or(`source_store_id.eq.${storeId},destination_store_id.eq.${storeId}`);

  const { data, error } = await query;
  if (error !== null) throw new Error(`Failed to load transfer history: ${error.message}`);
  const rows: {
    transfer_id: string;
    source_store_id: string;
    destination_store_id: string;
    state: string;
    requested_at: string | null;
    received_at: string | null;
  }[] = data ?? [];

  return rows.map((row) => ({
    transfer_id: row.transfer_id,
    source_store: names.storeNames.get(row.source_store_id) ?? row.source_store_id,
    destination_store: names.storeNames.get(row.destination_store_id) ?? row.destination_store_id,
    state: row.state,
    requested_at: row.requested_at,
    received_at: row.received_at,
  }));
}

async function buildReconciliationRows(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  fromTs: string,
  toTs: string,
  storeId: string | undefined,
  names: NameMaps,
): Promise<ReportRow[]> {
  let query = supabase
    .from("shifts")
    .select("shift_id, store_id, till_id, cashier_id, closed_at, opening_float, cash_counted, system_cash, over_short")
    .eq("status", "closed")
    .gte("closed_at", fromTs)
    .lt("closed_at", toTs);
  if (storeId !== undefined) query = query.eq("store_id", storeId);

  const { data, error } = await query;
  if (error !== null) throw new Error(`Failed to load shifts: ${error.message}`);
  const rows: {
    shift_id: string;
    store_id: string;
    till_id: string;
    cashier_id: string;
    closed_at: string;
    opening_float: number;
    cash_counted: number | null;
    system_cash: number;
    over_short: number | null;
  }[] = data ?? [];

  return rows.map((row) => ({
    shift_id: row.shift_id,
    store: names.storeNames.get(row.store_id) ?? row.store_id,
    till: names.tillLabels.get(row.till_id) ?? row.till_id,
    cashier: names.userNames.get(row.cashier_id) ?? row.cashier_id,
    closed_at: row.closed_at,
    opening_float: row.opening_float.toFixed(2),
    system_cash: row.system_cash.toFixed(2),
    cash_counted: row.cash_counted !== null ? row.cash_counted.toFixed(2) : null,
    over_short: row.over_short !== null ? row.over_short.toFixed(2) : null,
  }));
}
