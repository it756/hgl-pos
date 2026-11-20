"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import {
  AvailabilityInputSchema,
  BarcodeSchema,
  CategoryInputSchema,
  SkuInputSchema,
  type AvailabilityInput,
} from "../../../lib/catalog/service";
import { MAX_IMPORT_ROWS, ImportRowSchema, type ImportRow } from "../../../lib/catalog/csv";
import { loadPriceCatalog, submitPriceChange } from "../../../lib/prices/change";
import { friendlyDbError, readBool, readField, readOptional, type ActionState } from "../../../lib/format";

function done(): ActionState {
  revalidatePath("/catalog");
  return { error: null, success: true };
}

export async function saveSku(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin"]);
  const skuId = readOptional(formData, "sku_id");
  const parsed = SkuInputSchema.safeParse({
    code: readField(formData, "code"),
    name: readField(formData, "name"),
    category_id: readOptional(formData, "category_id"),
    unit_type: readField(formData, "unit_type"),
    track_batch: readBool(formData, "track_batch"),
    track_expiry: readBool(formData, "track_expiry"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid SKU.", success: false };

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } =
    skuId === null
      ? await supabase.from("skus").insert({ sku_id: randomUUID(), ...parsed.data, is_active: true, created_at: nowIso, updated_at: nowIso })
      : await supabase.from("skus").update({ ...parsed.data, updated_at: nowIso }).eq("sku_id", skuId);
  if (error !== null) return { error: friendlyDbError(error, "A SKU with this code"), success: false };
  return done();
}

export async function setSkuActive(skuId: string, isActive: boolean): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("skus").update({ is_active: isActive, updated_at: new Date().toISOString() }).eq("sku_id", skuId);
  if (error !== null) return { error: friendlyDbError(error, "SKU") };
  revalidatePath("/catalog");
  return { error: null };
}

// skus.barcode mirrors the primary sku_barcodes row for older readers.
async function syncPrimaryBarcode(supabase: SupabaseClient, skuId: string): Promise<void> {
  const { data } = await supabase.from("sku_barcodes").select("barcode").eq("sku_id", skuId).eq("is_primary", true).maybeSingle();
  const row: unknown = data;
  const primary = typeof row === "object" && row !== null && "barcode" in row ? String(row.barcode) : null;
  await supabase.from("skus").update({ barcode: primary, updated_at: new Date().toISOString() }).eq("sku_id", skuId);
}

export async function addBarcode(skuId: string, rawBarcode: string, makePrimary: boolean): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const parsed = BarcodeSchema.safeParse(rawBarcode);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid barcode." };

  const supabase = await createSupabaseServerClient();
  if (makePrimary) {
    const cleared = await supabase.from("sku_barcodes").update({ is_primary: false }).eq("sku_id", skuId).eq("is_primary", true);
    if (cleared.error !== null) return { error: friendlyDbError(cleared.error, "Barcode") };
  }
  const { error } = await supabase.from("sku_barcodes").insert({ barcode: parsed.data, sku_id: skuId, is_primary: makePrimary });
  if (error !== null) return { error: friendlyDbError(error, `Barcode ${parsed.data}`) };
  await syncPrimaryBarcode(supabase, skuId);
  revalidatePath("/catalog");
  return { error: null };
}

export async function removeBarcode(skuId: string, barcode: string): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sku_barcodes").delete().eq("barcode", barcode).eq("sku_id", skuId);
  if (error !== null) return { error: friendlyDbError(error, "Barcode") };
  await syncPrimaryBarcode(supabase, skuId);
  revalidatePath("/catalog");
  return { error: null };
}

export async function setPrimaryBarcode(skuId: string, barcode: string): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  // Clear first: a partial unique index allows only one primary per SKU.
  const cleared = await supabase.from("sku_barcodes").update({ is_primary: false }).eq("sku_id", skuId).eq("is_primary", true);
  if (cleared.error !== null) return { error: friendlyDbError(cleared.error, "Barcode") };
  const { error } = await supabase.from("sku_barcodes").update({ is_primary: true }).eq("barcode", barcode).eq("sku_id", skuId);
  if (error !== null) return { error: friendlyDbError(error, "Barcode") };
  await syncPrimaryBarcode(supabase, skuId);
  revalidatePath("/catalog");
  return { error: null };
}

export async function saveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireRole(["hq_admin"]);
  const categoryId = readOptional(formData, "category_id");
  const parsed = CategoryInputSchema.safeParse({
    code: readField(formData, "code"),
    name: readField(formData, "name"),
    parent_category_id: readOptional(formData, "parent_category_id"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid category.", success: false };
  if (categoryId !== null && parsed.data.parent_category_id === categoryId) {
    return { error: "A category can't be its own parent.", success: false };
  }

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { error } =
    categoryId === null
      ? await supabase.from("sku_categories").insert({ category_id: randomUUID(), ...parsed.data, created_at: nowIso, updated_at: nowIso })
      : await supabase.from("sku_categories").update({ ...parsed.data, updated_at: nowIso }).eq("category_id", categoryId);
  if (error !== null) return { error: friendlyDbError(error, "A category with this code"), success: false };
  return done();
}

export async function setCategoryActive(categoryId: string, isActive: boolean): Promise<{ error: string | null }> {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("sku_categories")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("category_id", categoryId);
  if (error !== null) return { error: friendlyDbError(error, "Category") };
  revalidatePath("/catalog");
  return { error: null };
}

// hq_admin may range a SKU into any store (upsert); a store manager may only
// update existing rows for their own store (RLS + this check).
export async function saveAvailability(input: AvailabilityInput, exists: boolean): Promise<{ error: string | null }> {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const parsed = AvailabilityInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid values." };
  if (claims.role === "store_manager" && (parsed.data.store_id !== claims.storeId || !exists)) {
    return { error: "Ask HQ to range this SKU into your store first." };
  }

  const supabase = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { store_id, sku_id, ...values } = parsed.data;
  const { error } = exists
    ? await supabase.from("store_sku_availability").update({ ...values, updated_at: nowIso }).eq("store_id", store_id).eq("sku_id", sku_id)
    : await supabase.from("store_sku_availability").insert({ ...parsed.data, created_at: nowIso, updated_at: nowIso });
  if (error !== null) return { error: friendlyDbError(error, "Availability") };
  revalidatePath("/catalog");
  return { error: null };
}

export type ImportResult = {
  line: number;
  code: string;
  outcome: "created" | "updated" | "error";
  notes: string[];
};

export async function importCatalog(rows: { line: number; row: ImportRow }[]): Promise<{ error: string | null; results: ImportResult[] }> {
  const claims = await requireRole(["hq_admin"]);
  if (rows.length === 0) return { error: "Nothing to import.", results: [] };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `The limit is ${MAX_IMPORT_ROWS} rows per import.`, results: [] };

  const supabase = await createSupabaseServerClient();
  const [categories, skus, barcodes, prices] = await Promise.all([
    supabase.from("sku_categories").select("category_id, code"),
    supabase.from("skus").select("sku_id, code"),
    supabase.from("sku_barcodes").select("barcode, sku_id, is_primary"),
    loadPriceCatalog(supabase),
  ]);
  if (categories.error !== null || skus.error !== null || barcodes.error !== null) {
    return { error: "Failed to load the current catalog.", results: [] };
  }

  const categoryByCode = new Map((categories.data as { category_id: string; code: string }[]).map((c) => [c.code.toLowerCase(), c.category_id]));
  const skuByCode = new Map((skus.data as { sku_id: string; code: string }[]).map((s) => [s.code.toLowerCase(), s.sku_id]));
  const barcodeOwner = new Map((barcodes.data as { barcode: string; sku_id: string }[]).map((b) => [b.barcode, b.sku_id]));
  const skusWithPrimary = new Set((barcodes.data as { sku_id: string; is_primary: boolean }[]).filter((b) => b.is_primary).map((b) => b.sku_id));
  const globalPrice = new Map(prices.activePrices.filter((p) => p.store_id === null).map((p) => [p.sku_id, Number(p.unit_price)]));

  const results: ImportResult[] = [];
  for (const { line, row: candidate } of rows) {
    const reparsed = ImportRowSchema.safeParse(
      Object.fromEntries(Object.entries(candidate).map(([key, value]) => [key, value === null ? "" : String(value)])),
    );
    if (!reparsed.success) {
      results.push({ line, code: candidate.code, outcome: "error", notes: reparsed.error.issues.map((issue) => issue.message) });
      continue;
    }
    const row = reparsed.data;
    const notes: string[] = [];

    let categoryId: string | null = null;
    if (row.category_code !== null) {
      categoryId = categoryByCode.get(row.category_code.toLowerCase()) ?? null;
      if (categoryId === null) {
        results.push({ line, code: row.code, outcome: "error", notes: [`unknown category_code "${row.category_code}"`] });
        continue;
      }
    }

    const nowIso = new Date().toISOString();
    const fields = { code: row.code, name: row.name, category_id: categoryId, unit_type: row.unit_type, track_batch: row.track_batch, track_expiry: row.track_expiry };
    let skuId = skuByCode.get(row.code.toLowerCase());
    const isNew = skuId === undefined;
    if (skuId === undefined) {
      skuId = randomUUID();
      const { error } = await supabase.from("skus").insert({ sku_id: skuId, ...fields, is_active: true, created_at: nowIso, updated_at: nowIso });
      if (error !== null) {
        results.push({ line, code: row.code, outcome: "error", notes: [friendlyDbError(error, "SKU")] });
        continue;
      }
      skuByCode.set(row.code.toLowerCase(), skuId);
    } else {
      const { error } = await supabase.from("skus").update({ ...fields, updated_at: nowIso }).eq("sku_id", skuId);
      if (error !== null) {
        results.push({ line, code: row.code, outcome: "error", notes: [friendlyDbError(error, "SKU")] });
        continue;
      }
    }

    if (row.barcode !== null) {
      const owner = barcodeOwner.get(row.barcode);
      if (owner !== undefined && owner !== skuId) {
        notes.push(`barcode ${row.barcode} already belongs to another SKU — skipped`);
      } else if (owner === undefined) {
        const makePrimary = !skusWithPrimary.has(skuId);
        const { error } = await supabase.from("sku_barcodes").insert({ barcode: row.barcode, sku_id: skuId, is_primary: makePrimary });
        if (error !== null) {
          notes.push(`barcode not added: ${error.message}`);
        } else {
          barcodeOwner.set(row.barcode, skuId);
          if (makePrimary) {
            skusWithPrimary.add(skuId);
            await supabase.from("skus").update({ barcode: row.barcode }).eq("sku_id", skuId);
          }
        }
      }
    }

    if (row.price !== null && globalPrice.get(skuId) !== row.price) {
      try {
        await submitPriceChange(supabase, claims.userId, {
          sku_id: skuId,
          store_id: null,
          new_unit_price: row.price,
          effective_from: new Date().toISOString(),
          reason: "Catalog CSV import",
        });
        globalPrice.set(skuId, row.price);
        notes.push(`price set to ${row.price.toFixed(2)}`);
      } catch (priceError) {
        notes.push(priceError instanceof Error ? priceError.message : "price change failed");
      }
    }

    results.push({ line, code: row.code, outcome: isNew ? "created" : "updated", notes });
  }

  revalidatePath("/catalog");
  revalidatePath("/prices");
  return { error: null, results };
}
