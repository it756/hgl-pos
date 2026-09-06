import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadVisibleStock } from "../../../lib/warehouse/service";
import { loadSkuOptions, loadStoreOptions } from "../../../lib/catalog/options";
import { WarehouseDashboard } from "../../../components/warehouse-dashboard";

export default async function WarehousePage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [stock, skus, stores] = await Promise.all([
    loadVisibleStock(supabase),
    loadSkuOptions(supabase),
    loadStoreOptions(supabase),
  ]);

  return (
    <main className="p-md">
      <WarehouseDashboard
        stock={stock}
        skus={skus}
        stores={stores}
        currentUserId={claims.userId}
        currentStoreId={claims.storeId}
        role={claims.role}
      />
    </main>
  );
}
