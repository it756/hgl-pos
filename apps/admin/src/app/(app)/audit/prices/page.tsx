import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { loadPriceAuditLog } from "../../../../lib/audit/price-audit";
import { loadSkuOptions, loadStoreOptions } from "../../../../lib/catalog/options";
import { PriceAuditTable } from "../../../../components/audit/price-audit-table";

export default async function PriceAuditPage() {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [auditLog, skus, stores] = await Promise.all([
    loadPriceAuditLog(supabase, 500),
    loadSkuOptions(supabase),
    loadStoreOptions(supabase),
  ]);

  return (
    <main className="p-md">
      <PriceAuditTable auditLog={auditLog} skus={skus} stores={stores} />
    </main>
  );
}
