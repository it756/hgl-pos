"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Schema } from "@powersync/common";
import { appDataDir } from "@tauri-apps/api/path";
import type { IDb } from "./interface";
import { SidecarDb } from "./sidecar";
import { TauriSdkDb } from "./tauri-sdk";
import { connectPowerSync } from "../sync/connect";
import { MAX_UPLOAD_BATCH_SIZE, SyncEngine } from "../sync/engine";
import { CashierSessionManager } from "../auth/cashier-session";
import {
  createDeviceSessionManager,
  createReliableClock,
  createSupabaseUploader,
  createSyncHealthReporter,
  getPowerSyncEndpoint,
  getTillId,
} from "../till/services";

// Empty until the backend connector (.connect()) is wired — domain tables are
// currently read/written via raw SQL through IDb, not PowerSync's typed views.
const posSyncSchema = new Schema({});

// How often to re-check/re-mint the till's device session once connected —
// independent of the token's own TTL (see DeviceSessionManager's refresh window).
const DEVICE_SESSION_POLL_MS = 5 * 60 * 1_000;

// How often to drain the local upload queue (Gap A: SyncEngine -> Postgres).
// Substrate-agnostic (plain HTTP), so this runs for Tauri AND the sidecar path.
const UPLOAD_DRAIN_POLL_MS = 30 * 1_000;

// How often to re-sync network time (clock.ts's own staleness window is 12h —
// this just needs to run comfortably more often than that, not on every boot).
const CLOCK_SYNC_POLL_MS = 15 * 60 * 1_000;

// research.md §4.2: tills push a sync-health heartbeat "every 60 seconds when
// online" — this both writes the local sync_health_local row (read by the
// /sync-health page) and attempts to POST it to the server.
const SYNC_HEALTH_POLL_MS = 60 * 1_000;

const DbContext = createContext<IDb | null>(null);

export type DbProviderProps = {
  children: ReactNode;
  sidecarEndpoint?: string;
};

export function DbProvider({ children, sidecarEndpoint }: DbProviderProps) {
  const [db, setDb] = useState<IDb | null>(null);
  const [initError, setInitError] = useState<Error | null>(null);

  useEffect(() => {
    // Constructing/initializing the DB must stay inside this client-only
    // effect: it never runs during SSR/static-export prerendering, where no
    // Tauri IPC or sidecar backend is reachable.
    let cancelled = false;
    let instance: IDb;
    let sessionPollId: ReturnType<typeof setInterval> | undefined;
    let uploadDrainPollId: ReturnType<typeof setInterval> | undefined;
    let clockSyncPollId: ReturnType<typeof setInterval> | undefined;
    let syncHealthPollId: ReturnType<typeof setInterval> | undefined;

    try {
      instance = createDb(sidecarEndpoint);
    } catch (err) {
      setInitError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    instance
      .init()
      .then(async () => {
        if (cancelled) return;
        setDb(instance);

        // Best-effort only: a till with no provisioning yet, or no network to
        // mint/connect, must not block local-first app usage (Principle I).
        uploadDrainPollId = setInterval(() => void drainUploadQueueIfProvisioned(instance), UPLOAD_DRAIN_POLL_MS);
        void drainUploadQueueIfProvisioned(instance);

        // Financial writes (sale/shift/refund) refuse to proceed until this has
        // run at least once (see ReliableClock.assertFinancialClockAllowed()).
        clockSyncPollId = setInterval(() => void syncClockBestEffort(instance), CLOCK_SYNC_POLL_MS);
        void syncClockBestEffort(instance);

        syncHealthPollId = setInterval(() => void reportSyncHealthIfProvisioned(instance), SYNC_HEALTH_POLL_MS);
        void reportSyncHealthIfProvisioned(instance);

        if (instance instanceof TauriSdkDb) {
          sessionPollId = setInterval(() => void keepDeviceSessionFresh(instance), DEVICE_SESSION_POLL_MS);
          await connectPowerSyncIfProvisioned(instance);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setInitError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      if (sessionPollId !== undefined) clearInterval(sessionPollId);
      if (uploadDrainPollId !== undefined) clearInterval(uploadDrainPollId);
      if (clockSyncPollId !== undefined) clearInterval(clockSyncPollId);
      if (syncHealthPollId !== undefined) clearInterval(syncHealthPollId);
      void instance.close();
    };
  }, [sidecarEndpoint]);

  if (initError !== null) {
    // Surfaced by the nearest error boundary (apps/pos/src/app/error.tsx / global-error.tsx).
    throw initError;
  }

  if (db === null) {
    return <DbStartingScreen />;
  }

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): IDb {
  const db = useContext(DbContext);
  if (db === null) {
    throw new Error("useDb() must be called within a DbProvider");
  }
  return db;
}

function createDb(sidecarEndpoint?: string): IDb {
  if (isTauriRuntime()) {
    return new TauriSdkDb({ schema: posSyncSchema, dbLocationAsync: appDataDir });
  }

  if (sidecarEndpoint !== undefined && sidecarEndpoint !== "") {
    return new SidecarDb({ endpoint: sidecarEndpoint });
  }

  throw new Error(
    "No PowerSync backend available: not running inside Tauri and no sidecar endpoint configured (NEXT_PUBLIC_POWERSYNC_SIDECAR_URL).",
  );
}

type TauriGlobal = typeof globalThis & { __TAURI_INTERNALS__?: { invoke?: unknown } };

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (globalThis as TauriGlobal).__TAURI_INTERNALS__?.invoke === "function";
}

async function keepDeviceSessionFresh(db: TauriSdkDb): Promise<void> {
  try {
    const tillId = await getTillId(db);
    if (tillId === null) return;
    await createDeviceSessionManager(db, tillId).mintIfDue();
  } catch (err) {
    console.error("Device session refresh failed (will retry on next poll):", err);
  }
}

async function connectPowerSyncIfProvisioned(db: TauriSdkDb): Promise<void> {
  try {
    const tillId = await getTillId(db);
    if (tillId === null) return; // Fresh, unprovisioned till — nothing to sync yet.
    await createDeviceSessionManager(db, tillId).mintIfDue();
    await connectPowerSync(db, getPowerSyncEndpoint());
  } catch (err) {
    console.error("PowerSync connect skipped (offline-first app usage continues regardless):", err);
  }
}

async function syncClockBestEffort(db: IDb): Promise<void> {
  try {
    await createReliableClock(db).sync();
  } catch (err) {
    console.error("Network time sync failed (financial writes stay blocked until it succeeds):", err);
  }
}

async function reportSyncHealthIfProvisioned(db: IDb): Promise<void> {
  try {
    const tillId = await getTillId(db);
    if (tillId === null) return; // Fresh, unprovisioned till — no till_id to report yet.

    // store_id isn't known until a cashier has logged in at least once (it's
    // read from the roster, not the device credential) — best-effort skip.
    const session = await new CashierSessionManager({ db }).getCurrentSession();
    if (session?.store_id == null) return;

    const reporter = createSyncHealthReporter(db, tillId, session.store_id);
    await reporter.recordSnapshot();
    await reporter.flushOne();
  } catch (err) {
    console.error("Sync health snapshot failed (will retry on next poll):", err);
  }
}

async function drainUploadQueueIfProvisioned(db: IDb): Promise<void> {
  try {
    const tillId = await getTillId(db);
    if (tillId === null) return; // Fresh, unprovisioned till — nothing queued yet.

    const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
    // Drain repeatedly while a batch came back full, so a long offline stretch
    // doesn't take many poll intervals to clear once connectivity returns.
    let result = await syncEngine.drainOnce();
    while (result.uploaded === MAX_UPLOAD_BATCH_SIZE) {
      result = await syncEngine.drainOnce();
    }
  } catch (err) {
    console.error("Upload queue drain failed (will retry on next poll):", err);
  }
}

function DbStartingScreen() {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "system-ui" }}>
      <p>Starting till database…</p>
    </div>
  );
}
