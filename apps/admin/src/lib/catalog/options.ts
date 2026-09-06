import type { SupabaseClient } from "@supabase/supabase-js";

export type SkuOption = {
  sku_id: string;
  code: string;
  name: string;
};

export type StoreOption = {
  store_id: string;
  code: string;
  name: string;
};

export async function loadSkuOptions(supabase: SupabaseClient): Promise<SkuOption[]> {
  const { data, error } = await supabase.from("skus").select("sku_id, code, name").eq("is_active", true).order("code", { ascending: true });
  if (error !== null) throw new Error(`Failed to load SKUs: ${error.message}`);
  const skus = (data ?? []) as SkuOption[];
  return skus;
}

export async function loadStoreOptions(supabase: SupabaseClient): Promise<StoreOption[]> {
  const { data, error } = await supabase.from("stores").select("store_id, code, name").order("code", { ascending: true });
  if (error !== null) throw new Error(`Failed to load stores: ${error.message}`);
  const stores = (data ?? []) as StoreOption[];
  return stores;
}
