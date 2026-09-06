import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkuOptions, loadStoreOptions, type SkuOption, type StoreOption } from "../catalog/options";

export type { SkuOption, StoreOption };

export type OversoldRow = {
  store_id: string;
  sku_id: string;
  qty_on_hand: number;
};

export type LowStockRow = {
  store_id: string;
  sku_id: string;
  qty_on_hand: number;
  reorder_point: number;
};

export type BatchExpiryRow = {
  store_id: string;
  sku_id: string;
  batch_no: string;
  expiry_date: string;
  qty_remaining: number;
};

export type InventoryOverview = {
  oversold: OversoldRow[];
  lowStock: LowStockRow[];
  batchesNearingExpiry: BatchExpiryRow[];
  skus: SkuOption[];
  stores: StoreOption[];
};

const NEARING_EXPIRY_WINDOW_DAYS = 90;

export async function loadInventoryOverview(supabase: SupabaseClient): Promise<InventoryOverview> {
  const expiryHorizon = new Date(Date.now() + NEARING_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);

  const [oversoldResult, lowStockResult, batchResult, skus, stores] = await Promise.all([
    supabase.from("current_stock_by_store_sku").select("store_id, sku_id, qty_on_hand").eq("is_oversold", true),
    // Same candidate query used by the low-stock-alerts Edge Function
    // (T095, migration 0016) — one source of truth for "what's low".
    supabase.rpc("low_stock_alert_candidates"),
    supabase
      .from("batch_expiry_summary")
      .select("store_id, sku_id, batch_no, expiry_date, qty_remaining")
      .gt("qty_remaining", 0)
      .lte("expiry_date", expiryHorizon)
      .order("expiry_date", { ascending: true }),
    loadSkuOptions(supabase),
    loadStoreOptions(supabase),
  ]);

  if (oversoldResult.error !== null) throw new Error(`Failed to load oversold stock: ${oversoldResult.error.message}`);
  if (lowStockResult.error !== null) throw new Error(`Failed to load low-stock candidates: ${lowStockResult.error.message}`);
  if (batchResult.error !== null) throw new Error(`Failed to load batch/expiry summary: ${batchResult.error.message}`);

  const oversold: OversoldRow[] = oversoldResult.data ?? [];
  const lowStockData: unknown = lowStockResult.data ?? [];
  const lowStock: LowStockRow[] = Array.isArray(lowStockData) ? (lowStockData as LowStockRow[]) : [];
  const batchesNearingExpiry: BatchExpiryRow[] = batchResult.data ?? [];

  return { oversold, lowStock, batchesNearingExpiry, skus, stores };
}
