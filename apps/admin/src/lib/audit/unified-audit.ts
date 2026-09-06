import type { SupabaseClient } from "@supabase/supabase-js";

// Unified audit view (T141, SC-006) — every append-only audit_log row
// regardless of entity_type (price changes, stock adjustments, refunds,
// role changes), unlike the price-specific view at
// apps/admin/src/app/audit/prices/page.tsx (T084). RLS (`audit_log_read`,
// 0009) already scopes store_manager to rows whose old/new_value carries
// their own store_id; hq_admin sees everything. No client-side scoping
// needed here.
export type AuditLogEntry = {
  audit_id: string;
  server_ts: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
};

type AuditLogRow = {
  audit_id: string;
  server_ts: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  users: { full_name: string } | { full_name: string }[] | null;
};

export async function loadUnifiedAuditLog(supabase: SupabaseClient, limit = 500): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("audit_id, server_ts, actor_user_id, action, entity_type, entity_id, old_value, new_value, users(full_name)")
    .order("server_ts", { ascending: false })
    .limit(limit);

  if (error !== null) {
    throw new Error(`Failed to load audit log: ${error.message}`);
  }

  const rows: AuditLogRow[] = data ?? [];
  return rows.map((row) => {
    const actor = Array.isArray(row.users) ? row.users[0] : row.users;
    return {
      audit_id: row.audit_id,
      server_ts: row.server_ts,
      actor_user_id: row.actor_user_id,
      actor_name: actor?.full_name ?? null,
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      old_value: row.old_value,
      new_value: row.new_value,
    };
  });
}
