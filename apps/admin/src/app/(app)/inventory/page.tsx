import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadInventoryOverview } from "../../../lib/inventory/service";
import { InventoryDashboard } from "../../../components/inventory-dashboard";

export default async function InventoryPage() {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const overview = await loadInventoryOverview(supabase);

  return (
    <main className="p-md">
      <InventoryDashboard overview={overview} />
    </main>
  );
}
