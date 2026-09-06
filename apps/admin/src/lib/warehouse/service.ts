import type { SupabaseClient } from "@supabase/supabase-js";

export type StoreStockRow = {
  store_id: string;
  sku_id: string;
  qty_on_hand: number;
  qty_in_transit_out: number;
  qty_in_transit_in: number;
};

// `stock_projection_read` RLS (0009) already scopes store_manager to their
// own store and hq_admin to every store — no store filter is applied here,
// the dashboard groups/filters client-side by whichever store the viewer
// selects (FR-015: any store can act as the replenishment source, "central
// warehouse" is a UI framing over the same stock/transfer model, not a
// separate schema concept).
export async function loadVisibleStock(supabase: SupabaseClient): Promise<StoreStockRow[]> {
  const { data, error } = await supabase
    .from("current_stock_by_store_sku")
    .select("store_id, sku_id, qty_on_hand, qty_in_transit_out, qty_in_transit_in")
    .order("store_id", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load stock: ${error.message}`);
  }
  const rows: StoreStockRow[] = data ?? [];
  return rows;
}
