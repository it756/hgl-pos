import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SCHEMA_VERSION } from "@hgl/db-shared";
import { loadSkuOptions, loadStoreOptions, type SkuOption, type StoreOption } from "../catalog/options";

// price_change_events.till_id has no FK constraint — HQ writes via the admin
// app are stamped with this well-known value instead of a real till row
// (data-model.md §2.6).
export const HQ_CONSOLE_TILL_ID = "00000000-0000-4000-8000-000000000000";

const ADMIN_APP_VERSION = "admin-web";

export const PriceChangeInputSchema = z.object({
  sku_id: z.string().uuid(),
  store_id: z.string().uuid().nullable(),
  new_unit_price: z.number().finite().nonnegative(),
  effective_from: z.string().datetime({ offset: true }),
  reason: z.string().trim().max(500).nullable(),
});
export type PriceChangeInput = z.infer<typeof PriceChangeInputSchema>;

export type { SkuOption, StoreOption };

export type PriceCatalogRow = {
  sku_id: string;
  store_id: string | null;
  price_version_id: string;
  unit_price: number;
  currency: string;
  effective_from: string;
};

export type PriceCatalog = {
  skus: SkuOption[];
  stores: StoreOption[];
  activePrices: PriceCatalogRow[];
};

type PriceVersionRow = {
  price_version_id: string;
  sku_id: string;
  store_id: string | null;
  unit_price: number;
  currency: string;
  effective_from: string;
  created_at: string;
};

// Loads the current catalog view for the prices page: every active SKU,
// every store (for the scope selector), and the currently-active price
// version per (sku_id, store_id) — the same resolver logic as data-model.md
// §1.7, applied client-side over the append-only price_versions table.
export async function loadPriceCatalog(supabase: SupabaseClient): Promise<PriceCatalog> {
  const nowIso = new Date().toISOString();

  const [skus, stores, versionsResult] = await Promise.all([
    loadSkuOptions(supabase),
    loadStoreOptions(supabase),
    supabase
      .from("price_versions")
      .select("price_version_id, sku_id, store_id, unit_price, currency, effective_from, created_at")
      .lte("effective_from", nowIso)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  if (versionsResult.error !== null) throw new Error(`Failed to load price versions: ${versionsResult.error.message}`);

  const versions = (versionsResult.data ?? []) as PriceVersionRow[];
  const activePrices = pickActiveVersions(versions);

  return { skus, stores, activePrices };
}

// versions must already be ordered effective_from desc, created_at desc —
// the first row seen per (sku_id, store_id) key is the active one.
function pickActiveVersions(versions: readonly PriceVersionRow[]): PriceCatalogRow[] {
  const seen = new Set<string>();
  const rows: PriceCatalogRow[] = [];

  for (const version of versions) {
    const key = `${version.sku_id}:${version.store_id ?? "global"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      sku_id: version.sku_id,
      store_id: version.store_id,
      price_version_id: version.price_version_id,
      unit_price: version.unit_price,
      currency: version.currency,
      effective_from: version.effective_from,
    });
  }

  return rows;
}

// The active price for a single sku_id/store_id pair at the time of write —
// used to populate old_unit_price on the price_change_events row. Mirrors
// the store-override-wins-over-global resolver in data-model.md §1.7.
export async function resolveActivePrice(
  supabase: SupabaseClient,
  skuId: string,
  storeId: string | null,
): Promise<PriceVersionRow | null> {
  const nowIso = new Date().toISOString();

  async function latestFor(scopeStoreId: string | null): Promise<PriceVersionRow | null> {
    let query = supabase
      .from("price_versions")
      .select("price_version_id, sku_id, store_id, unit_price, currency, effective_from, created_at")
      .eq("sku_id", skuId)
      .lte("effective_from", nowIso)
      .order("effective_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    query = scopeStoreId === null ? query.is("store_id", null) : query.eq("store_id", scopeStoreId);

    const { data, error } = await query.maybeSingle();
    if (error !== null) throw new Error(`Failed to resolve active price: ${error.message}`);
    const row: PriceVersionRow | null = data;
    return row;
  }

  if (storeId !== null) {
    const storeRow = await latestFor(storeId);
    if (storeRow !== null) return storeRow;
  }

  return latestFor(null);
}

export type PriceChangeResult = {
  price_version_id: string;
};

// HQ price-change flow (T082, FR-026/FR-027): writes an immutable
// price_change_events row. The apply_price_change_event_to_versions trigger
// (0007_price_change_trigger.sql) creates the price_versions row and calls
// public.append_audit for the audit trail — this function does neither directly.
export async function submitPriceChange(
  supabase: SupabaseClient,
  changedByUserId: string,
  input: PriceChangeInput,
): Promise<PriceChangeResult> {
  const parsed = PriceChangeInputSchema.parse(input);
  const currentPrice = await resolveActivePrice(supabase, parsed.sku_id, parsed.store_id);

  const priceVersionId = randomUUID();
  const { error } = await supabase.from("price_change_events").insert({
    event_id: randomUUID(),
    till_id: HQ_CONSOLE_TILL_ID,
    store_id: parsed.store_id,
    client_ts: new Date().toISOString(),
    app_version: ADMIN_APP_VERSION,
    schema_ver: SCHEMA_VERSION,
    price_version_id: priceVersionId,
    sku_id: parsed.sku_id,
    old_unit_price: currentPrice?.unit_price ?? null,
    new_unit_price: parsed.new_unit_price,
    effective_from: parsed.effective_from,
    changed_by_user_id: changedByUserId,
    reason: parsed.reason,
  });

  if (error !== null) {
    throw new Error(`Failed to submit price change: ${error.message}`);
  }

  return { price_version_id: priceVersionId };
}
