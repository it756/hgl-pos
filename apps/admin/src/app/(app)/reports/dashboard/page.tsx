import { requireRole } from "../../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { loadStoreOptions } from "../../../../lib/catalog/options";
import { loadSalesReport } from "../../../../lib/reports/sales";
import { computeProvisionalMarker, parseReportDateRange, toRangeTimestamps, type ReportSearchParams } from "../../../../lib/reports/shared";
import { ConsolidatedDashboard } from "../../../../components/consolidated-dashboard";

export default async function ReportsDashboardPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const resolvedSearchParams = await searchParams;
  const range = parseReportDateRange(resolvedSearchParams);
  const { toTs } = toRangeTimestamps(range);

  // Consolidated view is deliberately fleet-wide (no store_id filter) — RLS
  // still scopes a store_manager's underlying rows to their own store.
  const [sales, stores, provisional] = await Promise.all([
    loadSalesReport(supabase, { range }),
    loadStoreOptions(supabase),
    computeProvisionalMarker(supabase, toTs),
  ]);

  return (
    <main className="p-md">
      <ConsolidatedDashboard range={range} stores={stores} byStore={sales.byStore} provisional={provisional} />
    </main>
  );
}
