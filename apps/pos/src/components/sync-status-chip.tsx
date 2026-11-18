"use client";

import { useEffect, useState } from "react";
import { useDb } from "../lib/db/provider";
import { readQueueDepth } from "../lib/sync/engine";
import { evaluateOfflineWarning } from "../lib/config/offline-threshold";
import { getSupabaseUrl } from "../lib/till/services";
import { Badge } from "./ui/badge";

const POLL_INTERVAL_MS = 5_000;
const PROBE_TIMEOUT_MS = 4_000;

type LatestSyncHealthRow = {
  last_successful_sync_at: string | null;
  oldest_pending_event_at: string | null;
};

// Inline top-bar status chip — replaces the old floating corner OfflineBadge.
// Also surfaces the "offline beyond configured threshold" warning (NFR-014,
// T112) rather than a separate competing badge — see tasks.md implementation
// notes for T111-T114 for why this was folded in here instead of a new
// `OfflineBadge.tsx`.
export function SyncStatusChip() {
  const db = useDb();
  const [isOnline, setIsOnline] = useState(true);
  const [offlineReason, setOfflineReason] = useState<string | null>(null);
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [beyondThreshold, setBeyondThreshold] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const { online, reason } = await checkReachable();
      if (!cancelled) {
        setIsOnline(online);
        setOfflineReason(online ? null : reason);
      }

      try {
        const depth = await readQueueDepth(db);
        if (!cancelled) setQueueDepth(depth);
      } catch {
        // The /sync-health page surfaces detailed failures; the chip just keeps its last known value.
      }

      try {
        const rows = await db.query<LatestSyncHealthRow>(
          `SELECT last_successful_sync_at, oldest_pending_event_at
          FROM sync_health_local
          ORDER BY client_ts DESC
          LIMIT 1`,
        );
        const latest = rows[0];
        const { isBeyondThreshold } = evaluateOfflineWarning({
          lastSuccessfulSyncAt: latest?.last_successful_sync_at ?? null,
          oldestPendingEventAt: latest?.oldest_pending_event_at ?? null,
        });
        if (!cancelled) setBeyondThreshold(isBeyondThreshold);
      } catch {
        // sync_health_local may not exist yet (reporter not started this session) — no warning in that case.
        if (!cancelled) setBeyondThreshold(false);
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [db]);

  const pendingLabel = queueDepth === null ? "" : ` · ${queueDepth} pending`;
  const variant = beyondThreshold ? "destructive" : isOnline ? "success" : "warning";
  const label = beyondThreshold ? "Offline (beyond threshold)" : isOnline ? "Online" : "Offline";

  return (
    <Badge role="status" variant={variant} title={offlineReason ?? undefined}>
      {label}
      {pendingLabel}
    </Badge>
  );
}

// navigator.onLine/the window online-offline events are unreliable in the
// Tauri/WebView2 shell (observed flapping true/false with no actual
// connectivity change) — probe the same CORS-enabled, unauthenticated
// endpoint ReliableClock already relies on instead. Any completed response
// (even non-2xx) proves the network path to the backend is up; only a
// thrown/timed-out fetch means genuinely offline. `reason` is a diagnostic
// aid surfaced as the badge's tooltip — not shown anywhere else.
async function checkReachable(): Promise<{ online: boolean; reason: string | null }> {
  let supabaseUrl: string;
  try {
    supabaseUrl = getSupabaseUrl();
  } catch (error) {
    const fallback = typeof navigator === "undefined" ? true : navigator.onLine;
    return { online: fallback, reason: fallback ? null : `no Supabase URL configured: ${errorMessage(error)}` };
  }

  try {
    await fetch(`${supabaseUrl}/functions/v1/server-time`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { online: true, reason: null };
  } catch (error) {
    return { online: false, reason: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
