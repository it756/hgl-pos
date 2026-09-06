import type { SupabaseClient } from "@supabase/supabase-js";

// Price-change entries from the immutable audit_log (FR-026/SC-005/SC-006).
// Every row here is written by the apply_price_change_event_to_versions
// trigger (0007_price_change_trigger.sql) via public.append_audit — this
// module only reads.
export type PriceAuditRow = {
  audit_id: string;
  server_ts: string;
  actor_user_id: string | null;
  actor_name: string | null;
  sku_id: string | null;
  store_id: string | null;
  old_unit_price: number | null;
  new_unit_price: number | null;
  effective_from: string | null;
  reason: string | null;
};

type AuditLogRow = {
  audit_id: string;
  server_ts: string;
  actor_user_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  users: { full_name: string } | { full_name: string }[] | null;
};

export async function loadPriceAuditLog(supabase: SupabaseClient, limit = 50): Promise<PriceAuditRow[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("audit_id, server_ts, actor_user_id, old_value, new_value, users(full_name)")
    .eq("entity_type", "price_version")
    .order("server_ts", { ascending: false })
    .limit(limit);

  if (error !== null) {
    throw new Error(`Failed to load price audit log: ${error.message}`);
  }

  return ((data ?? []) as AuditLogRow[]).map(toPriceAuditRow);
}

function toPriceAuditRow(row: AuditLogRow): PriceAuditRow {
  const actor = Array.isArray(row.users) ? row.users[0] : row.users;

  return {
    audit_id: row.audit_id,
    server_ts: row.server_ts,
    actor_user_id: row.actor_user_id,
    actor_name: actor?.full_name ?? null,
    sku_id: readString(row.new_value, "sku_id") ?? readString(row.old_value, "sku_id"),
    store_id: readString(row.new_value, "store_id") ?? readString(row.old_value, "store_id"),
    old_unit_price: readNumber(row.old_value, "unit_price"),
    new_unit_price: readNumber(row.new_value, "unit_price"),
    effective_from: readString(row.new_value, "effective_from"),
    reason: readString(row.new_value, "reason"),
  };
}

function readString(value: Record<string, unknown> | null, key: string): string | null {
  const raw = value?.[key];
  return typeof raw === "string" ? raw : null;
}

function readNumber(value: Record<string, unknown> | null, key: string): number | null {
  const raw = value?.[key];
  return typeof raw === "number" ? raw : null;
}
