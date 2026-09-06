import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadSyncHealthOverview } from "../../../lib/monitoring/sync-health";
import { SyncHealthDashboard } from "../../../components/sync-health-dashboard";

// Single page for both dashboards described in research.md §4.4 ("HQ fleet
// view" / "store-manager scoped view, same layout"): Postgres RLS on
// `sync_health_latest_by_till` and `current_stock_by_store_sku` already
// scopes a store_manager's rows to their own store, so one query + one page
// serves both audiences without a second, URL-colliding route.
export default async function SyncHealthPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();
  const overview = await loadSyncHealthOverview(supabase);

  return (
    <main className="p-md">
      <SyncHealthDashboard
        tills={overview.tills}
        cohorts={overview.cohorts}
        oversoldSkuCount={overview.oversoldSkuCount}
        scope={claims.role === "hq_admin" ? "fleet" : "store"}
      />
    </main>
  );
}
