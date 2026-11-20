import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export type CategoryRow = {
  category_id: string;
  code: string;
  name: string;
  parent_category_id: string | null;
  is_active: boolean;
};

export type BarcodeRow = { barcode: string; sku_id: string; is_primary: boolean };

export type SkuRow = {
  sku_id: string;
  code: string;
  name: string;
  barcode: string | null;
  category_id: string | null;
  unit_type: "quantity" | "weight";
  track_batch: boolean;
  track_expiry: boolean;
  is_active: boolean;
  updated_at: string;
  barcodes: BarcodeRow[];
};

export type AvailabilityRow = {
  store_id: string;
  sku_id: string;
  is_stocked: boolean;
  reorder_point: number | null;
  reorder_qty: number | null;
};

export const SkuInputSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(40),
  name: z.string().trim().min(1, "Name is required").max(200),
  category_id: z.string().uuid().nullable(),
  unit_type: z.enum(["quantity", "weight"]),
  track_batch: z.boolean(),
  track_expiry: z.boolean(),
});
export type SkuInput = z.infer<typeof SkuInputSchema>;

export const CategoryInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Code may only contain letters, digits, - and _"),
  name: z.string().trim().min(1, "Name is required").max(120),
  parent_category_id: z.string().uuid().nullable(),
});

export const BarcodeSchema = z.string().trim().regex(/^[0-9A-Za-z-]{4,64}$/, "Barcode must be 4-64 letters/digits");

const nonNegativeOrNull = z.number().finite().nonnegative("Must be ≥ 0").nullable();
export const AvailabilityInputSchema = z.object({
  store_id: z.string().uuid(),
  sku_id: z.string().uuid(),
  is_stocked: z.boolean(),
  reorder_point: nonNegativeOrNull,
  reorder_qty: nonNegativeOrNull,
});
export type AvailabilityInput = z.infer<typeof AvailabilityInputSchema>;

export async function loadCategories(supabase: SupabaseClient): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from("sku_categories")
    .select("category_id, code, name, parent_category_id, is_active")
    .order("code", { ascending: true });
  if (error !== null) throw new Error(`Failed to load categories: ${error.message}`);
  return (data ?? []);
}

export async function loadSkus(supabase: SupabaseClient): Promise<SkuRow[]> {
  const [skus, barcodes] = await Promise.all([
    supabase
      .from("skus")
      .select("sku_id, code, name, barcode, category_id, unit_type, track_batch, track_expiry, is_active, updated_at")
      .order("code", { ascending: true }),
    supabase.from("sku_barcodes").select("barcode, sku_id, is_primary"),
  ]);
  if (skus.error !== null) throw new Error(`Failed to load SKUs: ${skus.error.message}`);
  if (barcodes.error !== null) throw new Error(`Failed to load barcodes: ${barcodes.error.message}`);

  const bySku = new Map<string, BarcodeRow[]>();
  for (const barcode of (barcodes.data ?? []) as BarcodeRow[]) {
    const list = bySku.get(barcode.sku_id) ?? [];
    list.push(barcode);
    bySku.set(barcode.sku_id, list);
  }
  return ((skus.data ?? []) as Omit<SkuRow, "barcodes">[]).map((sku) => ({
    ...sku,
    barcodes: (bySku.get(sku.sku_id) ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
  }));
}

export async function loadAvailability(supabase: SupabaseClient, storeId: string): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase
    .from("store_sku_availability")
    .select("store_id, sku_id, is_stocked, reorder_point, reorder_qty")
    .eq("store_id", storeId);
  if (error !== null) throw new Error(`Failed to load store availability: ${error.message}`);
  return ((data ?? []) as AvailabilityRow[]).map((row) => ({
    ...row,
    reorder_point: row.reorder_point === null ? null : Number(row.reorder_point),
    reorder_qty: row.reorder_qty === null ? null : Number(row.reorder_qty),
  }));
}
