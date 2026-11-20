import type { SupabaseClient } from "@supabase/supabase-js";
import { PAGE_SIZE, dayBounds, type SalesFilters, type ShiftFilters } from "./filters";

export type SaleRow = {
  sale_id: string;
  event_id: string;
  till_id: string;
  store_id: string;
  cashier_id: string;
  shift_id: string;
  server_ts: string;
  client_ts: string;
  status: "completed" | "voided" | "refunded";
  latest_status: "completed" | "voided" | "refunded";
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
  original_sale_id: string | null;
  refund_kind: string | null;
};

const SALE_COLUMNS =
  "sale_id, event_id, till_id, store_id, cashier_id, shift_id, server_ts, client_ts, status, latest_status, subtotal, discount_total, tax_total, grand_total, original_sale_id, refund_kind";

export async function listSales(supabase: SupabaseClient, filters: SalesFilters): Promise<{ rows: SaleRow[]; total: number }> {
  const { fromTs, toTs } = dayBounds(filters.from, filters.to);
  let query = supabase.from("sales").select(SALE_COLUMNS, { count: "exact" });
  // A shift is already a bounded window; the date range would only hide its sales.
  if (filters.shiftId === null) query = query.gte("server_ts", fromTs).lt("server_ts", toTs);
  if (filters.storeId !== null) query = query.eq("store_id", filters.storeId);
  if (filters.tillId !== null) query = query.eq("till_id", filters.tillId);
  if (filters.cashierId !== null) query = query.eq("cashier_id", filters.cashierId);
  if (filters.shiftId !== null) query = query.eq("shift_id", filters.shiftId);
  if (filters.status !== null) query = query.eq("status", filters.status);
  if (filters.minTotal !== null) query = query.gte("grand_total", filters.minTotal);
  if (filters.maxTotal !== null) query = query.lte("grand_total", filters.maxTotal);

  const start = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.order("server_ts", { ascending: false }).range(start, start + PAGE_SIZE - 1);
  if (error !== null) throw new Error(`Failed to load sales: ${error.message}`);
  return { rows: (data ?? []), total: count ?? 0 };
}

export type SaleItem = {
  sku_id: string;
  price_version_id: string;
  unit_price: number;
  qty: number;
  line_discount?: number;
  line_total: number;
  promotion_id: string | null;
  batch_no: string | null;
  expiry_date: string | null;
};

export type Tender = { type: string; amount: number; reference: string | null; card_masked_pan?: string };

export type SaleDetail = {
  sale: SaleRow;
  items: SaleItem[];
  tenders: Tender[];
  related: SaleRow[];
  original: SaleRow | null;
  skus: Map<string, { code: string; name: string }>;
  promotions: Map<string, string>;
};

export async function loadSaleDetail(supabase: SupabaseClient, saleId: string): Promise<SaleDetail | null> {
  const { data, error } = await supabase.from("sales").select(SALE_COLUMNS).eq("sale_id", saleId).maybeSingle();
  if (error !== null) throw new Error(`Failed to load sale: ${error.message}`);
  if (data === null) return null;
  const sale = data;

  const [eventResult, relatedResult, originalResult] = await Promise.all([
    supabase.from("sale_events").select("items, tenders").eq("event_id", sale.event_id).maybeSingle(),
    supabase.from("sales").select(SALE_COLUMNS).eq("original_sale_id", sale.sale_id).order("server_ts"),
    sale.original_sale_id === null
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("sales").select(SALE_COLUMNS).eq("sale_id", sale.original_sale_id).maybeSingle(),
  ]);
  if (eventResult.error !== null) throw new Error(`Failed to load sale lines: ${eventResult.error.message}`);
  if (relatedResult.error !== null) throw new Error(`Failed to load refunds: ${relatedResult.error.message}`);

  const event: unknown = eventResult.data;
  const record = (typeof event === "object" && event !== null ? event : {}) as { items?: unknown; tenders?: unknown };
  const items: SaleItem[] = Array.isArray(record.items) ? (record.items as SaleItem[]) : [];
  const tenders: Tender[] = Array.isArray(record.tenders) ? (record.tenders as Tender[]) : [];

  const skuIds = [...new Set(items.map((item) => item.sku_id))];
  const promotionIds = [...new Set(items.map((item) => item.promotion_id).filter((id): id is string => id !== null))];
  const [skusResult, promotionsResult] = await Promise.all([
    skuIds.length === 0 ? Promise.resolve({ data: [], error: null }) : supabase.from("skus").select("sku_id, code, name").in("sku_id", skuIds),
    promotionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("promotions").select("promotion_id, type, payload").in("promotion_id", promotionIds),
  ]);

  return {
    sale,
    items,
    tenders,
    related: (relatedResult.data ?? []),
    original: (originalResult.data ?? null),
    skus: new Map(((skusResult.data ?? []) as { sku_id: string; code: string; name: string }[]).map((sku) => [sku.sku_id, { code: sku.code, name: sku.name }])),
    promotions: new Map(
      ((promotionsResult.data ?? []) as { promotion_id: string; type: string; payload: { name?: string } | null }[]).map((promotion) => [
        promotion.promotion_id,
        promotion.payload?.name ?? promotion.type.replace(/_/g, " "),
      ]),
    ),
  };
}

export type ShiftRow = {
  shift_id: string;
  till_id: string;
  store_id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  cash_counted: number | null;
  system_cash: number;
  over_short: number | null;
  status: "open" | "closed";
};

export async function listShifts(supabase: SupabaseClient, filters: ShiftFilters): Promise<{ rows: ShiftRow[]; total: number }> {
  const { fromTs, toTs } = dayBounds(filters.from, filters.to);
  let query = supabase
    .from("shifts")
    .select("shift_id, till_id, store_id, cashier_id, opened_at, closed_at, opening_float, cash_counted, system_cash, over_short, status", { count: "exact" })
    .gte("opened_at", fromTs)
    .lt("opened_at", toTs);
  if (filters.storeId !== null) query = query.eq("store_id", filters.storeId);
  if (filters.tillId !== null) query = query.eq("till_id", filters.tillId);
  if (filters.cashierId !== null) query = query.eq("cashier_id", filters.cashierId);
  if (filters.status !== null) query = query.eq("status", filters.status);
  if (filters.discrepancyOnly) query = query.neq("over_short", 0);

  const start = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query.order("opened_at", { ascending: false }).range(start, start + PAGE_SIZE - 1);
  if (error !== null) throw new Error(`Failed to load shifts: ${error.message}`);
  return { rows: (data ?? []), total: count ?? 0 };
}

export function summariseShifts(rows: readonly ShiftRow[]): { float: number; counted: number; system: number; overShort: number } {
  return rows.reduce(
    (totals, row) => ({
      float: totals.float + Number(row.opening_float),
      counted: totals.counted + Number(row.cash_counted ?? 0),
      system: totals.system + Number(row.system_cash),
      overShort: totals.overShort + Number(row.over_short ?? 0),
    }),
    { float: 0, counted: 0, system: 0, overShort: 0 },
  );
}
