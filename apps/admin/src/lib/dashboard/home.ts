import type { SupabaseClient } from "@supabase/supabase-js";
import type { PosRole } from "../supabase/claims";
import { loadStoreOptions, type StoreOption } from "../catalog/options";
import { buildStoreSummaries, loadSyncHealthOverview, type StoreSyncSummary } from "../monitoring/sync-health";
import { deriveProvisionalMarker, type ProvisionalMarker } from "../reports/shared";
import { listPendingAdjustments } from "../adjustments/service";
import { loadSettings } from "../settings/schema";

export type SaleTotalsRow = {
  store_id: string;
  status: "completed" | "voided" | "refunded";
  grand_total: number | string;
  server_ts: string;
};

export type DayTotals = {
  netSales: number;
  transactions: number;
  refunds: number;
};

export type StoreDayTotals = DayTotals & {
  storeId: string;
  storeName: string;
  previousNetSales: number;
};

export type HomeAlerts = {
  oversoldSkus: number;
  lowStockSkus: number;
  expiringBatches: number;
  pendingAdjustments: number;
  openTransfers: number;
  openCounts: number;
  openShifts: number;
  offlineOrLaggingStores: number;
};

export type HomeDashboard = {
  role: PosRole | null;
  timezone: string;
  expiryWarningDays: number;
  today: DayTotals;
  yesterday: DayTotals;
  byStore: StoreDayTotals[];
  alerts: HomeAlerts;
  storeSync: StoreSyncSummary[];
  provisional: ProvisionalMarker;
};

// UTC instant of local midnight for the calendar day containing `at` in
// `timeZone`, derived from the zone's offset at that instant.
export function startOfDayInTimeZone(at: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);

  const localAsUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour"), read("minute"), read("second"));
  const offsetMs = localAsUtc - Math.floor(at.getTime() / 1000) * 1000;
  return new Date(Date.UTC(read("year"), read("month") - 1, read("day")) - offsetMs);
}

// Refunds/voids are separate `sales` rows referencing the original, so net
// sales = completed totals minus refunded/voided totals.
export function summariseSales(rows: readonly SaleTotalsRow[]): DayTotals {
  let gross = 0;
  let refunds = 0;
  let transactions = 0;
  for (const row of rows) {
    const amount = Number(row.grand_total);
    if (row.status === "completed") {
      gross += amount;
      transactions += 1;
    } else {
      refunds += amount;
    }
  }
  return { netSales: round2(gross - refunds), transactions, refunds: round2(refunds) };
}

export function splitByDay(
  rows: readonly SaleTotalsRow[],
  todayStart: Date,
): { today: SaleTotalsRow[]; yesterday: SaleTotalsRow[] } {
  const today: SaleTotalsRow[] = [];
  const yesterday: SaleTotalsRow[] = [];
  const boundary = todayStart.getTime();
  for (const row of rows) {
    (new Date(row.server_ts).getTime() >= boundary ? today : yesterday).push(row);
  }
  return { today, yesterday };
}

export function buildStoreDayTotals(
  todayRows: readonly SaleTotalsRow[],
  yesterdayRows: readonly SaleTotalsRow[],
  stores: readonly StoreOption[],
): StoreDayTotals[] {
  return stores
    .map((store) => {
      const today = summariseSales(todayRows.filter((row) => row.store_id === store.store_id));
      const previous = summariseSales(yesterdayRows.filter((row) => row.store_id === store.store_id));
      return { ...today, storeId: store.store_id, storeName: store.name, previousNetSales: previous.netSales };
    })
    .sort((a, b) => b.netSales - a.netSales);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function countOrThrow(result: { count: number | null; error: { message: string } | null }, label: string): number {
  if (result.error !== null) throw new Error(`Failed to load ${label}: ${result.error.message}`);
  return result.count ?? 0;
}

// All queries are RLS-scoped: a store_manager only sees their own store's
// rows, so the same loader serves both roles.
export async function loadHomeDashboard(
  supabase: SupabaseClient,
  role: PosRole | null,
  now: Date = new Date(),
): Promise<HomeDashboard> {
  const settings = await loadSettings(supabase);
  const timezone = settings.default_report_timezone;
  const todayStart = startOfDayInTimeZone(now, timezone);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const expiryHorizon = new Date(now.getTime() + settings.expiry_warning_days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const head = { count: "exact" as const, head: true };
  const [salesResult, stores, syncOverview, pending, oversold, lowStock, expiring, transfers, counts, shifts] = await Promise.all([
    supabase.from("sales").select("store_id, status, grand_total, server_ts").gte("server_ts", yesterdayStart.toISOString()),
    loadStoreOptions(supabase),
    loadSyncHealthOverview(supabase),
    listPendingAdjustments(supabase),
    supabase.from("current_stock_by_store_sku").select("*", head).eq("is_oversold", true),
    supabase.rpc("low_stock_alert_candidates"),
    supabase.from("batch_expiry_summary").select("*", head).gt("qty_remaining", 0).lte("expiry_date", expiryHorizon),
    supabase.from("transfers").select("*", head).in("state", ["requested", "dispatched", "in_transit"]),
    supabase.from("stock_counts").select("*", head).eq("status", "open"),
    supabase.from("shifts").select("*", head).eq("status", "open"),
  ]);

  if (salesResult.error !== null) throw new Error(`Failed to load sales: ${salesResult.error.message}`);
  if (lowStock.error !== null) throw new Error(`Failed to load low-stock candidates: ${lowStock.error.message}`);

  const saleRows = (salesResult.data ?? []) as SaleTotalsRow[];
  const { today, yesterday } = splitByDay(saleRows, todayStart);
  const storeSync = buildStoreSummaries(syncOverview.tills, now);
  const lowStockRows: unknown = lowStock.data ?? [];
  const visibleStores = role === "store_manager" ? stores.filter((store) => saleRows.some((row) => row.store_id === store.store_id)) : stores;

  return {
    role,
    timezone,
    expiryWarningDays: settings.expiry_warning_days,
    today: summariseSales(today),
    yesterday: summariseSales(yesterday),
    byStore: buildStoreDayTotals(today, yesterday, visibleStores),
    alerts: {
      oversoldSkus: countOrThrow(oversold, "oversold stock"),
      lowStockSkus: Array.isArray(lowStockRows) ? lowStockRows.length : 0,
      expiringBatches: countOrThrow(expiring, "expiring batches"),
      pendingAdjustments: pending.length,
      openTransfers: countOrThrow(transfers, "open transfers"),
      openCounts: countOrThrow(counts, "open stock counts"),
      openShifts: countOrThrow(shifts, "open shifts"),
      offlineOrLaggingStores: storeSync.filter((store) => store.status !== "online").length,
    },
    storeSync,
    provisional: deriveProvisionalMarker(syncOverview.tills, now.toISOString()),
  };
}
