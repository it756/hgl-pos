import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT,
  DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING,
  evaluateOfflineWarning,
  isWithinTradingHours,
  offlineThresholdConfigFromStoreRow,
  resolveOfflineThresholdMinutes,
} from "../../../src/lib/config/offline-threshold";

// T111 coverage. Defaults mirror supabase/migrations/0001_master_data.sql's
// `stores` columns (offline_threshold_minutes_trading/overnight).

describe("offline-threshold.ts", () => {
  it("isWithinTradingHours() is true at 07:00 and false just before/after the window", () => {
    expect(isWithinTradingHours(new Date(2026, 0, 1, 7, 0))).toBe(true);
    expect(isWithinTradingHours(new Date(2026, 0, 1, 21, 59))).toBe(true);
    expect(isWithinTradingHours(new Date(2026, 0, 1, 6, 59))).toBe(false);
    expect(isWithinTradingHours(new Date(2026, 0, 1, 22, 0))).toBe(false);
  });

  it("resolveOfflineThresholdMinutes() picks trading vs overnight minutes from config", () => {
    const config = { tradingMinutes: 60, overnightMinutes: 90 };
    expect(resolveOfflineThresholdMinutes(config, new Date(2026, 0, 1, 12, 0))).toBe(60);
    expect(resolveOfflineThresholdMinutes(config, new Date(2026, 0, 1, 2, 0))).toBe(90);
  });

  it("offlineThresholdConfigFromStoreRow() falls back to defaults for null/missing columns", () => {
    expect(offlineThresholdConfigFromStoreRow(null)).toEqual({
      tradingMinutes: DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING,
      overnightMinutes: DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT,
    });
    expect(
      offlineThresholdConfigFromStoreRow({
        offline_threshold_minutes_trading: 120,
        offline_threshold_minutes_overnight: null,
      }),
    ).toEqual({ tradingMinutes: 120, overnightMinutes: DEFAULT_OFFLINE_THRESHOLD_MINUTES_OVERNIGHT });
  });

  it("evaluateOfflineWarning() flags beyond-threshold once elapsed exceeds the trading threshold", () => {
    const now = new Date(2026, 0, 1, 12, 0);
    const justUnder = new Date(now.getTime() - (DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING - 1) * 60_000).toISOString();
    const justOver = new Date(now.getTime() - (DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING + 1) * 60_000).toISOString();

    expect(
      evaluateOfflineWarning({ lastSuccessfulSyncAt: justUnder, oldestPendingEventAt: null, now }).isBeyondThreshold,
    ).toBe(false);
    expect(
      evaluateOfflineWarning({ lastSuccessfulSyncAt: justOver, oldestPendingEventAt: null, now }).isBeyondThreshold,
    ).toBe(true);
  });

  it("evaluateOfflineWarning() falls back to oldestPendingEventAt when never synced, and is safe with no reference at all", () => {
    const now = new Date(2026, 0, 1, 12, 0);
    const justOver = new Date(now.getTime() - (DEFAULT_OFFLINE_THRESHOLD_MINUTES_TRADING + 1) * 60_000).toISOString();

    expect(
      evaluateOfflineWarning({ lastSuccessfulSyncAt: null, oldestPendingEventAt: justOver, now }).isBeyondThreshold,
    ).toBe(true);
    expect(evaluateOfflineWarning({ lastSuccessfulSyncAt: null, oldestPendingEventAt: null, now })).toEqual({
      isBeyondThreshold: false,
      elapsedMinutes: null,
    });
  });
});
