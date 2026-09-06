import type { SupabaseClient } from "@supabase/supabase-js";
import { toRangeTimestamps, type ReportDateRange } from "./shared";

export type SalesByStoreRow = { store_id: string; sale_count: number; net_sales: number; discount_total: number; tax_total: number };
export type SalesByTillRow = { till_id: string; store_id: string; sale_count: number; net_sales: number };
export type SalesByCashierRow = { cashier_id: string; store_id: string; sale_count: number; net_sales: number };
export type SalesBySkuRow = { sku_id: string; category_id: string | null; qty_sold: number; line_total: number };
export type SalesByHourRow = { hour: number; sale_count: number; net_sales: number };
export type SalesByDayRow = { day: string; sale_count: number; net_sales: number };

export type SalesReport = {
  byStore: SalesByStoreRow[];
  byTill: SalesByTillRow[];
  byCashier: SalesByCashierRow[];
  bySku: SalesBySkuRow[];
  byHour: SalesByHourRow[];
  byDay: SalesByDayRow[];
};

export type SalesReportParams = {
  range: ReportDateRange;
  storeId?: string;
};

type SaleRow = {
  store_id: string;
  till_id: string;
  cashier_id: string;
  client_ts: string;
  grand_total: number;
  discount_total: number;
  tax_total: number;
};

type SaleEventRow = {
  store_id: string;
  client_ts: string;
  items: unknown;
};

type SaleLineItem = {
  sku_id: string;
  qty: number;
  line_total: number;
};

type SkuCategoryRow = { sku_id: string; category_id: string | null };

// FR-029: sales reports segmentable by store, till, cashier, SKU/category,
// hour/day. `sales` (the header projection) has everything needed for the
// store/till/cashier/hour/day segments in one row per sale. The SKU/category
// segment needs per-line data, which only exists in `sale_events.items`
// JSONB (§2.2.1 data-model.md) — so that's fetched separately and flattened
// here rather than duplicated into the `sales` projection.
export async function loadSalesReport(supabase: SupabaseClient, params: SalesReportParams): Promise<SalesReport> {
  const { fromTs, toTs } = toRangeTimestamps(params.range);

  let salesQuery = supabase
    .from("sales")
    .select("store_id, till_id, cashier_id, client_ts, grand_total, discount_total, tax_total")
    .eq("latest_status", "completed")
    .gte("client_ts", fromTs)
    .lt("client_ts", toTs);
  if (params.storeId !== undefined) {
    salesQuery = salesQuery.eq("store_id", params.storeId);
  }

  let eventsQuery = supabase
    .from("sale_events")
    .select("store_id, client_ts, items")
    .eq("status", "completed")
    .gte("client_ts", fromTs)
    .lt("client_ts", toTs);
  if (params.storeId !== undefined) {
    eventsQuery = eventsQuery.eq("store_id", params.storeId);
  }

  const [salesResult, eventsResult, skuResult] = await Promise.all([
    salesQuery,
    eventsQuery,
    supabase.from("skus").select("sku_id, category_id"),
  ]);

  if (salesResult.error !== null) throw new Error(`Failed to load sales: ${salesResult.error.message}`);
  if (eventsResult.error !== null) throw new Error(`Failed to load sale line items: ${eventsResult.error.message}`);
  if (skuResult.error !== null) throw new Error(`Failed to load SKU categories: ${skuResult.error.message}`);

  const sales: SaleRow[] = salesResult.data ?? [];
  const events: SaleEventRow[] = eventsResult.data ?? [];
  const skus: SkuCategoryRow[] = skuResult.data ?? [];
  const categoryBySkuId = new Map(skus.map((sku) => [sku.sku_id, sku.category_id]));

  return {
    byStore: aggregateByStore(sales),
    byTill: aggregateByTill(sales),
    byCashier: aggregateByCashier(sales),
    bySku: aggregateBySku(events, categoryBySkuId),
    byHour: aggregateByHour(sales),
    byDay: aggregateByDay(sales),
  };
}

function aggregateByStore(sales: readonly SaleRow[]): SalesByStoreRow[] {
  const byStore = new Map<string, SalesByStoreRow>();
  for (const sale of sales) {
    const row = byStore.get(sale.store_id) ?? {
      store_id: sale.store_id,
      sale_count: 0,
      net_sales: 0,
      discount_total: 0,
      tax_total: 0,
    };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    row.discount_total += sale.discount_total;
    row.tax_total += sale.tax_total;
    byStore.set(sale.store_id, row);
  }
  return [...byStore.values()].sort((a, b) => b.net_sales - a.net_sales);
}

function aggregateByTill(sales: readonly SaleRow[]): SalesByTillRow[] {
  const byTill = new Map<string, SalesByTillRow>();
  for (const sale of sales) {
    const row = byTill.get(sale.till_id) ?? { till_id: sale.till_id, store_id: sale.store_id, sale_count: 0, net_sales: 0 };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    byTill.set(sale.till_id, row);
  }
  return [...byTill.values()].sort((a, b) => b.net_sales - a.net_sales);
}

function aggregateByCashier(sales: readonly SaleRow[]): SalesByCashierRow[] {
  const byCashier = new Map<string, SalesByCashierRow>();
  for (const sale of sales) {
    const row = byCashier.get(sale.cashier_id) ?? {
      cashier_id: sale.cashier_id,
      store_id: sale.store_id,
      sale_count: 0,
      net_sales: 0,
    };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    byCashier.set(sale.cashier_id, row);
  }
  return [...byCashier.values()].sort((a, b) => b.net_sales - a.net_sales);
}

function aggregateBySku(events: readonly SaleEventRow[], categoryBySkuId: Map<string, string | null>): SalesBySkuRow[] {
  const bySku = new Map<string, SalesBySkuRow>();
  for (const event of events) {
    const items: SaleLineItem[] = Array.isArray(event.items) ? (event.items as SaleLineItem[]) : [];
    for (const item of items) {
      const row = bySku.get(item.sku_id) ?? {
        sku_id: item.sku_id,
        category_id: categoryBySkuId.get(item.sku_id) ?? null,
        qty_sold: 0,
        line_total: 0,
      };
      row.qty_sold += item.qty;
      row.line_total += item.line_total;
      bySku.set(item.sku_id, row);
    }
  }
  return [...bySku.values()].sort((a, b) => b.line_total - a.line_total);
}

function aggregateByHour(sales: readonly SaleRow[]): SalesByHourRow[] {
  const byHour = new Map<number, SalesByHourRow>();
  for (const sale of sales) {
    const hour = new Date(sale.client_ts).getUTCHours();
    const row = byHour.get(hour) ?? { hour, sale_count: 0, net_sales: 0 };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    byHour.set(hour, row);
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour);
}

function aggregateByDay(sales: readonly SaleRow[]): SalesByDayRow[] {
  const byDay = new Map<string, SalesByDayRow>();
  for (const sale of sales) {
    const day = sale.client_ts.slice(0, 10);
    const row = byDay.get(day) ?? { day, sale_count: 0, net_sales: 0 };
    row.sale_count += 1;
    row.net_sales += sale.grand_total;
    byDay.set(day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
