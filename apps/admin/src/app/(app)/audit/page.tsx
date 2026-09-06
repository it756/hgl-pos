import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadUnifiedAuditLog } from "../../../lib/audit/unified-audit";
import { AuditLogTable } from "../../../components/audit-log-table";

export default async function AuditPage() {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const entries = await loadUnifiedAuditLog(supabase);

  return (
    <main className="p-md">
      <AuditLogTable entries={entries} />
    </main>
  );
}
