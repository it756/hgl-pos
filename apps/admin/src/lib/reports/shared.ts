import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSyncHealthOverview, type TillSyncHealthRow } from "../monitoring/sync-health";

export type ReportDateRange = {
  /** Inclusive start day, "YYYY-MM-DD". */
  from: string;
  /** Inclusive end day, "YYYY-MM-DD". */
  to: string;
};

export type ReportSearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_RANGE_DAYS = 30;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readStringParam(searchParams: ReportSearchParams, key: string): string | undefined {
  const value = searchParams[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseReportDateRange(searchParams: ReportSearchParams): ReportDateRange {
  const from = readStringParam(searchParams, "from") ?? toIsoDate(new Date(Date.now() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000));
  const to = readStringParam(searchParams, "to") ?? toIsoDate(new Date());
  return { from, to };
}

export function parseOptionalStoreId(searchParams: ReportSearchParams): string | undefined {
  return readStringParam(searchParams, "store_id");
}

/**
 * Range bounds as timestamptz strings for `.gte`/`.lt` filtering. `toTs` is
 * exclusive — one day past the requested end date — so the end date itself
 * is fully included.
 */
export function toRangeTimestamps(range: ReportDateRange): { fromTs: string; toTs: string } {
  const fromTs = new Date(`${range.from}T00:00:00.000Z`).toISOString();
  const toExclusive = new Date(`${range.to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return { fromTs, toTs: toExclusive.toISOString() };
}

export type ProvisionalMarker = {
  isProvisional: boolean;
  /**
   * Earliest un-synced event timestamp among stale tills — the point after
   * which trailing offline data could still rewrite this report's totals.
   * Null when the report isn't provisional.
   */
  provisionalUntilServerTs: string | null;
  staleTillIds: string[];
};

// EC-16: a till is "stale for the reported range" when it still has a
// pending (un-synced) event whose client timestamp falls at or before the
// report's end-of-range — that event could belong within the reported
// window and hasn't landed in the cloud-synced picture yet. This reuses the
// same `sync_health_latest_by_till` view (via loadSyncHealthOverview) that
// the sync-health dashboard is built from, rather than inventing a second,
// different staleness definition.
function isStaleForRange(till: TillSyncHealthRow, rangeToTs: string): boolean {
  return till.oldest_pending_event_at !== null && till.oldest_pending_event_at <= rangeToTs;
}

// Pure core of the provisional-marker computation (T125 companion unit
// test: apps/admin/tests/unit/reports/provisional.spec.ts). Split out from
// computeProvisionalMarker so it can be exercised with plain fixture data
// and no Supabase/DB mocking — the async wrapper below only adds the
// network fetch via loadSyncHealthOverview.
export function deriveProvisionalMarker(tills: readonly TillSyncHealthRow[], rangeToTs: string, storeId?: string): ProvisionalMarker {
  const relevantTills = storeId === undefined ? tills : tills.filter((till) => till.store_id === storeId);
  const staleTills = relevantTills.filter((till) => isStaleForRange(till, rangeToTs));

  if (staleTills.length === 0) {
    return { isProvisional: false, provisionalUntilServerTs: null, staleTillIds: [] };
  }

  const earliestPending = staleTills
    .map((till) => till.oldest_pending_event_at)
    .filter((ts): ts is string => ts !== null)
    .sort()
    .at(0);

  return {
    isProvisional: true,
    provisionalUntilServerTs: earliestPending ?? null,
    staleTillIds: staleTills.map((till) => till.till_id),
  };
}

export async function computeProvisionalMarker(
  supabase: SupabaseClient,
  rangeToTs: string,
  storeId?: string,
): Promise<ProvisionalMarker> {
  const overview = await loadSyncHealthOverview(supabase);
  return deriveProvisionalMarker(overview.tills, rangeToTs, storeId);
}
