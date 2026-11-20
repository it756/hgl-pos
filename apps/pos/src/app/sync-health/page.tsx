"use client";

import { useEffect, useState } from "react";
import { useDb } from "../../lib/db/provider";
import { evaluateOfflineWarning } from "../../lib/config/offline-threshold";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

const POLL_INTERVAL_MS = 5_000;

type SyncHealthLocalRow = {
  snapshot_id: string;
  till_id: string;
  client_ts: string;
  queue_depth: number;
  oldest_pending_event_at: string | null;
  last_successful_sync_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
};

export default function SyncHealthPage() {
  const db = useDb();
  const [latest, setLatest] = useState<SyncHealthLocalRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const rows = await db.query<SyncHealthLocalRow>(
          `SELECT snapshot_id, till_id, client_ts, queue_depth, oldest_pending_event_at,
            last_successful_sync_at, consecutive_failures, last_error
          FROM sync_health_local
          ORDER BY client_ts DESC
          LIMIT 1`,
        );
        if (!cancelled) {
          setLatest(rows[0] ?? null);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [db]);

  const warning = buildOfflineWarningMessage(latest);

  return (
    <main className="mx-auto max-w-xl p-3.5">
      <Card>
        <CardHeader>
          <CardTitle>Sync health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loadError !== null && (
            <p className="text-body-md font-body-md text-destructive">Could not read sync health: {loadError}</p>
          )}
          {latest === null && loadError === null && (
            <p className="text-body-md font-body-md text-on-surface-variant">No sync activity recorded yet.</p>
          )}

          {latest !== null && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-md gap-y-2 text-body-md font-body-md">
              <dt className="text-on-surface-variant">Queue depth</dt>
              <dd className="text-on-surface">
                {latest.queue_depth} pending event{latest.queue_depth === 1 ? "" : "s"}
              </dd>

              <dt className="text-on-surface-variant">Last successful sync</dt>
              <dd className="text-on-surface">{formatRelative(latest.last_successful_sync_at)}</dd>

              <dt className="text-on-surface-variant">Oldest pending event</dt>
              <dd className="text-on-surface">{formatRelative(latest.oldest_pending_event_at)}</dd>

              <dt className="text-on-surface-variant">Consecutive failures</dt>
              <dd className="text-on-surface">{latest.consecutive_failures}</dd>

              {latest.last_error !== null && (
                <>
                  <dt className="text-on-surface-variant">Last error</dt>
                  <dd className="text-on-surface">{latest.last_error}</dd>
                </>
              )}
            </dl>
          )}

          {warning !== null && (
            <p role="alert" className="rounded-lg bg-warning-container px-4 py-3 text-body-md font-body-md text-warning">
              {warning}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function buildOfflineWarningMessage(row: SyncHealthLocalRow | null): string | null {
  if (row === null) return null;

  const { isBeyondThreshold, elapsedMinutes } = evaluateOfflineWarning({
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    oldestPendingEventAt: row.oldest_pending_event_at,
  });
  if (!isBeyondThreshold || elapsedMinutes === null) return null;

  return `This till has not synced in over ${formatDuration(elapsedMinutes)}. Notify a manager if this continues.`;
}

function formatRelative(iso: string | null): string {
  if (iso === null) return "Never";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "Unknown";

  const minutes = Math.max(0, (Date.now() - at) / 60_000);
  return `${formatDuration(minutes)} ago`;
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}
