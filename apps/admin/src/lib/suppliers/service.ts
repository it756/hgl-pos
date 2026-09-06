import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSkuOptions, type SkuOption } from "../catalog/options";

export type { SkuOption };

export type SupplierRow = {
  supplier_id: string;
  code: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

export type SkuSupplierLink = {
  sku_id: string;
  supplier_id: string;
  supplier_sku_code: string | null;
  is_primary: boolean;
};

const SUPPLIER_COLUMNS = "supplier_id, code, name, contact_name, phone, email, is_active";

// `suppliers_read_all_authenticated` RLS (0017) — any authenticated role may
// read the supplier directory; only hq_admin may write (FR-019).
export async function listSuppliers(supabase: SupabaseClient): Promise<SupplierRow[]> {
  const { data, error } = await supabase.from("suppliers").select(SUPPLIER_COLUMNS).order("code", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load suppliers: ${error.message}`);
  }
  const rows: SupplierRow[] = data ?? [];
  return rows;
}

export async function listSkuSupplierLinks(supabase: SupabaseClient): Promise<SkuSupplierLink[]> {
  const { data, error } = await supabase
    .from("sku_suppliers")
    .select("sku_id, supplier_id, supplier_sku_code, is_primary")
    .order("supplier_id", { ascending: true });
  if (error !== null) {
    throw new Error(`Failed to load SKU-supplier links: ${error.message}`);
  }
  const rows: SkuSupplierLink[] = data ?? [];
  return rows;
}

export async function loadSupplierCatalog(supabase: SupabaseClient): Promise<{ skus: SkuOption[] }> {
  const skus = await loadSkuOptions(supabase);
  return { skus };
}

export type CreateSupplierInput = {
  code: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
};

// hq_admin only — enforced by `suppliers_write_hq` RLS (0017).
export async function createSupplier(supabase: SupabaseClient, input: CreateSupplierInput): Promise<void> {
  const { error } = await supabase.from("suppliers").insert({
    supplier_id: crypto.randomUUID(),
    code: input.code,
    name: input.name,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
  });
  if (error !== null) {
    throw new Error(`Failed to create supplier: ${error.message}`);
  }
}

export async function setSupplierActive(supabase: SupabaseClient, supplierId: string, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from("suppliers")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("supplier_id", supplierId);
  if (error !== null) {
    throw new Error(`Failed to update supplier: ${error.message}`);
  }
}

export type LinkSkuSupplierInput = {
  skuId: string;
  supplierId: string;
  supplierSkuCode: string | null;
  isPrimary: boolean;
};

// hq_admin only — enforced by `sku_suppliers_write_hq` RLS (0017). Upserts on
// the table's (sku_id, supplier_id) primary key so re-linking the same pair
// just updates the supplier's own SKU code / primary flag.
export async function linkSkuToSupplier(supabase: SupabaseClient, input: LinkSkuSupplierInput): Promise<void> {
  const { error } = await supabase.from("sku_suppliers").upsert(
    {
      sku_id: input.skuId,
      supplier_id: input.supplierId,
      supplier_sku_code: input.supplierSkuCode,
      is_primary: input.isPrimary,
    },
    { onConflict: "sku_id,supplier_id" },
  );
  if (error !== null) {
    throw new Error(`Failed to link SKU to supplier: ${error.message}`);
  }
}
