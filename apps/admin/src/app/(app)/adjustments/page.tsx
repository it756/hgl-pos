import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { listAdjustmentHistory, listPendingAdjustments, loadAdjustmentCatalog } from "../../../lib/adjustments/service";
import { loadSettings } from "../../../lib/settings/schema";
import { AdjustmentsDashboard } from "../../../components/adjustments-dashboard";
import { AdjustmentHistory, NewAdjustmentButton } from "../../../components/adjustments/adjustment-panels";

export default async function AdjustmentsPage() {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const [pending, catalog, history, settings, usersResult] = await Promise.all([
    listPendingAdjustments(supabase),
    loadAdjustmentCatalog(supabase),
    listAdjustmentHistory(supabase),
    loadSettings(supabase),
    supabase.from("users").select("user_id, full_name"),
  ]);
  if (usersResult.error !== null) throw new Error(`Failed to load users: ${usersResult.error.message}`);
  const userNames = Object.fromEntries(((usersResult.data ?? []) as { user_id: string; full_name: string }[]).map((u) => [u.user_id, u.full_name]));
  const isManager = claims.role === "store_manager";

  return (
    <main className="flex flex-col gap-lg p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-md font-body-md text-on-surface-variant">
          Approval threshold: ±{settings.adjustment_approval_threshold_qty} units
          {isManager ? "" : " · adjustments are raised by store managers; HQ has read-only access here."}
        </p>
        {isManager && <NewAdjustmentButton skus={catalog.skus} threshold={settings.adjustment_approval_threshold_qty} />}
      </div>
      <AdjustmentsDashboard
        pending={pending}
        skus={catalog.skus}
        stores={catalog.stores}
        currentUserId={claims.userId}
        canResolve={isManager}
      />
      <AdjustmentHistory
        history={history}
        skus={catalog.skus}
        stores={catalog.stores}
        userNames={userNames}
      />
    </main>
  );
}