import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadRolloutRecords } from "../../../lib/rollout/service";
import { loadStoreOptions } from "../../../lib/catalog/options";
import { RolloutDashboard } from "../../../components/rollout-dashboard";

export default async function RolloutPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [records, stores] = await Promise.all([loadRolloutRecords(supabase), loadStoreOptions(supabase)]);

  return (
    <main className="p-md">
      <RolloutDashboard records={records} stores={stores} canWrite={claims.role === "hq_admin"} />
    </main>
  );
}
