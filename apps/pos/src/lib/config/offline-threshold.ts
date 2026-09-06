// Offline-threshold config (T111, NFR-014/EC-08). Values mirror the
// `stores` table defaults from supabase/migrations/0001_master_data.sql
// (offline_threshold_minutes_trading/overnight). The pos app has no
// composition root and no local `stores` table synced yet (see repo memory
// note on PowerSync bucket-sync not being wired) — callers pass any known
// per-store override in at construction time (same shape as
// `lib/till/services.ts`'s factories taking `storeId` as a parameter rather
// than resolving it themselves); absent an override, these defaults apply.

export const DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING = 240;
export const DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT = 1_440;

// Matches the trading-window definition already used by
// apps/pos/src/app/sync-health/page.tsx (single source of truth now).
export const TRADING_HOURS_START = 7;
export const TRADING_HOURS_END = 22;

export type OfflineThresholdConfig = {
  tradingMinutes: number;
  overnightMinutes: number;
};

export const DEFAULT_OFFLINE_THRESHOLD_CONFIG: OfflineThresholdConfig = {
  tradingMinutes: DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING,
  overnightMinutes: DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT,
};

// A raw `stores` row (or a partial fetch of it) as it would arrive from
// Postgres/PowerSync once that sync path is wired.
export type StoreOfflineThresholdRow = {
  offline_threshold_minutes_trading?: number | null;
  offline_threshold_minutes_overnight?: number | null;
};

export function offlineThresholdConfigFromStoreRow(row: StoreOfflineThresholdRow | null | undefined): OfflineThresholdConfig {
  return {
    tradingMinutes: row?.offline_threshold_minutes_trading ?? DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING,
    overnightMinutes: row?.offline_threshold_minutes_overnight ?? DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT,
  };
}

export function isWithinTradingHours(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= TRADING_HOURS_START && hour < TRADING_HOURS_END;
}

export function resolveOfflineThresholdMinutes(
  config: OfflineThresholdConfig = DEFAULT_OFFLINE_THRESHOLD_CONFIG,
  now: Date = new Date(),
): number {
  return isWithinTradingHours(now) ? config.tradingMinutes : config.overnightMinutes;
}

export type OfflineWarningInput = {
  lastSuccessfulSyncAt: string | null;
  oldestPendingEventAt: string | null;
  now?: Date;
  config?: OfflineThresholdConfig;
};

export type OfflineWarningState = {
  isBeyondThreshold: boolean;
  elapsedMinutes: number | null;
};

// Shared "offline beyond threshold" evaluation (NFR-014), used by both the
// /sync-health page and the top-bar SyncStatusChip so the two surfaces never
// drift out of sync on what counts as "beyond threshold".
export function evaluateOfflineWarning(input: OfflineWarningInput): OfflineWarningState {
  const referenceIso = input.lastSuccessfulSyncAt ?? input.oldestPendingEventAt;
  if (referenceIso === null) return { isBeyondThreshold: false, elapsedMinutes: null };

  const referenceAt = new Date(referenceIso).getTime();
  if (Number.isNaN(referenceAt)) return { isBeyondThreshold: false, elapsedMinutes: null };

  const now = input.now ?? new Date();
  const elapsedMinutes = (now.getTime() - referenceAt) / 60_000;
  const thresholdMinutes = resolveOfflineThresholdMinutes(input.config, now);

  return { isBeyondThreshold: elapsedMinutes > thresholdMinutes, elapsedMinutes };
}
