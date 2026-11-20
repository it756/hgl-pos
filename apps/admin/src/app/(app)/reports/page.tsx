import { requireRole } from "../../../lib/auth/session";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { loadSkuOptions, loadStoreOptions } from "../../../lib/catalog/options";
import { loadSalesReport } from "../../../lib/reports/sales";
import { loadInventoryReport } from "../../../lib/reports/inventory";
import { loadReconciliationReport } from "../../../lib/reports/reconciliation";
import { computeProvisionalMarker, parseOptionalStoreId, parseReportDateRange, toRangeTimestamps, type ReportSearchParams } from "../../../lib/reports/shared";
import Link from "next/link";
import { ReportsDashboard } from "../../../components/reports-dashboard";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const claims = await requireRole(["hq_admin", "store_manager"]);
  const supabase = await createSupabaseServerClient();

  const resolvedSearchParams = await searchParams;
  const range = parseReportDateRange(resolvedSearchParams);
  const isStoreManager = claims.role === "store_manager";
  // store_manager is pinned to their own store regardless of the query string — RLS
  // would scope the underlying queries anyway, but this keeps the filter UI honest.
  const storeId = isStoreManager ? (claims.storeId ?? undefined) : parseOptionalStoreId(resolvedSearchParams);

  const { toTs } = toRangeTimestamps(range);

  const [sales, inventory, reconciliation, stores, skus, categoriesResult, provisional] = await Promise.all([
    loadSalesReport(supabase, { range, storeId }),
    loadInventoryReport(supabase, { range, storeId }),
    loadReconciliationReport(supabase, { range, storeId }),
    loadStoreOptions(supabase),
    loadSkuOptions(supabase),
    supabase.from("sku_categories").select("category_id, name"),
    computeProvisionalMarker(supabase, toTs, storeId),
  ]);

  if (categoriesResult.error !== null) {
    throw new Error(`Failed to load SKU categories: ${categoriesResult.error.message}`);
  }
  const categories: { category_id: string; name: string }[] = categoriesResult.data ?? [];

  return (
    <main className="flex flex-col gap-sm p-md">
      <div className="flex justify-end">
        <Link href="/reports/schedules" className="text-body-md font-medium text-primary hover:underline">
          Scheduled delivery →
        </Link>
      </div>
      <ReportsDashboard
        range={range}
        storeId={storeId}
        stores={stores}
        categories={categories}
        skus={skus}
        isStoreManager={isStoreManager}
        sales={sales}
        inventory={inventory}
        reconciliation={reconciliation}
        provisional={provisional}
      />
    </main>
  );
}
