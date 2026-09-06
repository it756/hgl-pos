"use client";

import { useEffect, useState } from "react";
import { useDb } from "../lib/db/provider";
import { readQueueDepth } from "../lib/sync/engine";
import { evaluateOfflineWarning } from "../lib/config/offline-threshold";
import { Badge } from "./ui/badge";

const POLL_INTERVAL_MS = 5_000;

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
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [queueDepth, setQueueDepth] = useState<number | null>(null);
  const [beyondThreshold, setBeyondThreshold] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
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
    <Badge role="status" variant={variant}>
      {label}
      {pendingLabel}
    </Badge>
  );
}
