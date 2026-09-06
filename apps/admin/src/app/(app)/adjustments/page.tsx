import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listPendingAdjustments, loadAdjustmentCatalog } from "../../../lib/adjustments/service";
import { AdjustmentsDashboard } from "../../../components/adjustments-dashboard";

export default async function AdjustmentsPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [pending, catalog] = await Promise.all([listPendingAdjustments(supabase), loadAdjustmentCatalog(supabase)]);

  return (
    <main className="p-md">
      <AdjustmentsDashboard
        pending={pending}
        skus={catalog.skus}
        stores={catalog.stores}
        currentUserId={claims.userId}
        canResolve={claims.role === "store_manager"}
      />
    </main>
  );
}
