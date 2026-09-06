import { requireRole } from "../../lib/auth/session";
import { createSupabaseServerClient } from "../../lib/supabase/server";
import { loadPriceCatalog } from "../../lib/prices/change";
import { loadPriceAuditLog } from "../../lib/audit/price-audit";
import { PricesView } from "../../components/prices/prices-view";

export default async function PricesPage() {
  await requireRole(["hq_admin"]);
  const supabase = await createSupabaseServerClient();

  const [catalog, auditLog] = await Promise.all([loadPriceCatalog(supabase), loadPriceAuditLog(supabase, 20)]);

  return (
    <main className="p-md">
      <PricesView
        skus={catalog.skus}
        stores={catalog.stores}
        activePrices={catalog.activePrices}
        auditLog={auditLog}
      />
    </main>
  );
}
