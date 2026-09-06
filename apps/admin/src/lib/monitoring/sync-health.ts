import type { SupabaseClient } from "@supabase/supabase-js";

export type StalenessBucket = "under_1_min" | "under_5_min" | "under_30_min" | "under_4_hours" | "over_4_hours" | "never_synced";

export type TillSyncHealthRow = {
  till_id: string;
  store_id: string;
  till_label: string;
  store_code: string;
  store_name: string;
  server_ts: string | null;
  queue_depth: number | null;
  oldest_pending_event_at: string | null;
  last_successful_sync_at: string | null;
  consecutive_failures: number | null;
  app_version: string | null;
  schema_version: number | null;
};

export type AppVersionCohort = {
  appVersion: string;
  tillCount: number;
};

export type SyncHealthOverview = {
  tills: TillSyncHealthRow[];
  cohorts: AppVersionCohort[];
  oversoldSkuCount: number;
};

export async function loadSyncHealthOverview(supabase: SupabaseClient): Promise<SyncHealthOverview> {
  const [tillsResult, oversoldResult] = await Promise.all([
    supabase
      .from("sync_health_latest_by_till")
      .select(
        "till_id, store_id, till_label, store_code, store_name, server_ts, queue_depth, oldest_pending_event_at, last_successful_sync_at, consecutive_failures, app_version, schema_version",
      )
      .order("store_code", { ascending: true })
      .order("till_label", { ascending: true }),
    supabase.from("current_stock_by_store_sku").select("*", { count: "exact", head: true }).eq("is_oversold", true),
  ]);

  if (tillsResult.error !== null) {
    throw new Error(`Failed to load sync health overview: ${tillsResult.error.message}`);
  }
  if (oversoldResult.error !== null) {
    throw new Error(`Failed to load oversold SKU count: ${oversoldResult.error.message}`);
  }

  const tills = (tillsResult.data ?? []) as TillSyncHealthRow[];

  return {
    tills,
    cohorts: buildAppVersionCohorts(tills),
    oversoldSkuCount: oversoldResult.count ?? 0,
  };
}

export function buildAppVersionCohorts(tills: readonly TillSyncHealthRow[]): AppVersionCohort[] {
  const counts = new Map<string, number>();

  for (const till of tills) {
    const key = till.app_version ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([appVersion, tillCount]) => ({ appVersion, tillCount }))
    .sort((a, b) => b.tillCount - a.tillCount);
}

export function classifyStaleness(serverTs: string | null, now: Date = new Date()): StalenessBucket {
  if (serverTs === null) return "never_synced";

  const elapsedAt = new Date(serverTs).getTime();
  if (Number.isNaN(elapsedAt)) return "never_synced";

  const elapsedMinutes = (now.getTime() - elapsedAt) / 60_000;

  if (elapsedMinutes < 1) return "under_1_min";
  if (elapsedMinutes < 5) return "under_5_min";
  if (elapsedMinutes < 30) return "under_30_min";
  if (elapsedMinutes < 240) return "under_4_hours";
  return "over_4_hours";
}

export const STALENESS_BUCKET_LABELS: Record<StalenessBucket, string> = {
  under_1_min: "< 1 min",
  under_5_min: "< 5 min",
  under_30_min: "< 30 min",
  under_4_hours: "< 4 h",
  over_4_hours: "> 4 h",
  never_synced: "Never synced",
};

export type StoreStatus = "online" | "lagging" | "offline";

export type StoreSyncSummary = {
  storeId: string;
  storeCode: string;
  storeName: string;
  tillCount: number;
  status: StoreStatus;
  worstStaleness: StalenessBucket;
  totalQueueDepth: number;
  mostRecentServerTs: string | null;
};

export type FleetSummary = {
  totalStores: number;
  onlineStores: number;
  offlineOrLaggingStores: number;
  totalActiveTills: number;
};

const STATUS_BY_BUCKET: Record<StalenessBucket, StoreStatus> = {
  under_1_min: "online",
  under_5_min: "online",
  under_30_min: "online",
  under_4_hours: "lagging",
  over_4_hours: "offline",
  never_synced: "offline",
};

const STATUS_SEVERITY: Record<StoreStatus, number> = { online: 0, lagging: 1, offline: 2 };

export function buildStoreSummaries(tills: readonly TillSyncHealthRow[], now: Date = new Date()): StoreSyncSummary[] {
  const byStore = new Map<string, TillSyncHealthRow[]>();
  for (const till of tills) {
    const list = byStore.get(till.store_id) ?? [];
    list.push(till);
    byStore.set(till.store_id, list);
  }

  return [...byStore.entries()]
    .map(([storeId, storeTills]) => {
      const staleness = storeTills.map((till) => classifyStaleness(till.server_ts, now));
      const worstStaleness = staleness.reduce(
        (worst, current) => (STATUS_SEVERITY[STATUS_BY_BUCKET[current]] > STATUS_SEVERITY[STATUS_BY_BUCKET[worst]] ? current : worst),
        staleness[0] ?? "never_synced",
      );
      const mostRecentServerTs =
        storeTills
          .map((till) => till.server_ts)
          .filter((ts): ts is string => ts !== null)
          .sort()
          .at(-1) ?? null;

      return {
        storeId,
        storeCode: storeTills[0]?.store_code ?? "",
        storeName: storeTills[0]?.store_name ?? "",
        tillCount: storeTills.length,
        status: STATUS_BY_BUCKET[worstStaleness],
        worstStaleness,
        totalQueueDepth: storeTills.reduce((sum, till) => sum + (till.queue_depth ?? 0), 0),
        mostRecentServerTs,
      };
    })
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
}

export function buildFleetSummary(storeSummaries: readonly StoreSyncSummary[]): FleetSummary {
  return {
    totalStores: storeSummaries.length,
    onlineStores: storeSummaries.filter((store) => store.status === "online").length,
    offlineOrLaggingStores: storeSummaries.filter((store) => store.status !== "online").length,
    totalActiveTills: storeSummaries.reduce((sum, store) => sum + store.tillCount, 0),
  };
}
