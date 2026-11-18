import { HttpDateHeaderTimeSource, ReliableClock } from "../time/clock";
import { SyncEngine, type SyncUploader } from "../sync/engine";
import { SyncHealthReporter } from "../sync/health";
import { SupabaseSyncUploader } from "../sync/uploader";
import { ShiftEventQueue } from "../events/queue";
import { SaleEventQueue } from "../events/sale";
import { VoidEventQueue } from "../events/void";
import { CountCorrectionQueue } from "../events/count";
import { AdjustmentRequestQueue } from "../events/adjustment";
import { RefundEventQueue } from "../events/refund";
import { DeviceCredentialManager } from "../auth/device-credential";
import { DeviceSessionManager } from "../auth/device-session";
import type { IDb } from "../db";

// Small composition helpers shared by the till's cashier/shift pages.
// There is no app-wide composition root yet, so each page resolves till
// identity and constructs its own service instances via these helpers.

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0-dev";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const POWERSYNC_URL = process.env.NEXT_PUBLIC_POWERSYNC_URL;

// T038 built the local upload-queue engine ahead of the HTTP ingest endpoint
// that actually POSTs queued events to Supabase (createSupabaseUploader below,
// backed by the ingest_*_event RPCs in supabase/migrations/0002_event_tables.sql).

export async function getTillId(db: IDb): Promise<string | null> {
  await db.init();
  const rows = await db.query<{ till_id: string }>(`SELECT till_id FROM local_device_credential LIMIT 1`);
  return rows[0]?.till_id ?? null;
}

export function createReliableClock(db: IDb): ReliableClock {
  if (SUPABASE_URL === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured; cannot verify network time for financial events.");
  }
  return new ReliableClock({ db, networkTime: new HttpDateHeaderTimeSource(`${SUPABASE_URL}/functions/v1/server-time`) });
}

export function createSupabaseUploader(db: IDb, tillId: string): SyncUploader {
  const sessionManager = createDeviceSessionManager(db, tillId);
  return new SupabaseSyncUploader({
    supabaseUrl: getSupabaseUrl(),
    anonKey: getSupabaseAnonKey(),
    getAccessToken: async () => {
      const state = await sessionManager.mintIfDue();
      if (state === null) {
        throw new Error("no device session available; cannot upload events");
      }
      return state.access_token;
    },
  });
}

export function createShiftEventQueue(db: IDb, tillId: string, storeId: string): ShiftEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new ShiftEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createSaleEventQueue(db: IDb, tillId: string, storeId: string): SaleEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new SaleEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createVoidEventQueue(db: IDb, tillId: string, storeId: string): VoidEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new VoidEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createCountCorrectionQueue(db: IDb, tillId: string, storeId: string): CountCorrectionQueue {
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new CountCorrectionQueue({ db, syncEngine, tillId, storeId, appVersion: APP_VERSION });
}

export function createAdjustmentRequestQueue(db: IDb, tillId: string, storeId: string): AdjustmentRequestQueue {
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new AdjustmentRequestQueue({ db, syncEngine, tillId, storeId, appVersion: APP_VERSION });
}

export function createRefundEventQueue(db: IDb, tillId: string, storeId: string): RefundEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new RefundEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

// verify-refund (T107) needs both the project URL (to build the Edge
// Function/GoTrue endpoints) and the anon key (required by GoTrue's
// password-grant endpoint as the `apikey` header) — neither is used by any
// other apps/pos flow yet, since this is the one connectivity-required path.
export function getSupabaseUrl(): string {
  if (SUPABASE_URL === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured; cannot verify a cross-till refund online.");
  }
  return SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
  if (SUPABASE_ANON_KEY === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not configured; cannot verify a cross-till refund online.");
  }
  return SUPABASE_ANON_KEY;
}

export function getVerifyRefundEndpoint(): string {
  return `${getSupabaseUrl()}/functions/v1/verify-refund`;
}

export function getMintDeviceJwtEndpoint(): string {
  return `${getSupabaseUrl()}/functions/v1/mint-device-jwt`;
}

export function getPowerSyncEndpoint(): string {
  if (POWERSYNC_URL === undefined) {
    throw new Error("NEXT_PUBLIC_POWERSYNC_URL is not configured; cannot connect PowerSync for bucket sync.");
  }
  return POWERSYNC_URL;
}

export function getSyncHealthSnapshotEndpoint(): string {
  return `${getSupabaseUrl()}/functions/v1/internal-sync-health-snapshot`;
}

// Writes to `sync_health_local` (read by the /sync-health page and the
// top-bar chip's offline-threshold warning) — nothing calls this unless a
// caller schedules it (see DbProvider's health-report poll).
export function createSyncHealthReporter(db: IDb, tillId: string, storeId: string): SyncHealthReporter {
  const sessionManager = createDeviceSessionManager(db, tillId);
  const syncEngine = new SyncEngine({ db, uploader: createSupabaseUploader(db, tillId) });
  return new SyncHealthReporter({
    db,
    syncEngine,
    endpoint: getSyncHealthSnapshotEndpoint(),
    accessToken: async () => {
      const state = await sessionManager.mintIfDue();
      if (state === null) {
        throw new Error("no device session available; cannot post sync health snapshot");
      }
      return state.access_token;
    },
    tillId,
    storeId,
    appVersion: APP_VERSION,
  });
}

export function createDeviceCredentialManager(db: IDb, tillId: string): DeviceCredentialManager {
  return new DeviceCredentialManager({
    db,
    tillId,
    rotateEndpointUrl: `${getSupabaseUrl()}/functions/v1/rotate-device-credential`,
  });
}

export function createDeviceSessionManager(db: IDb, tillId: string): DeviceSessionManager {
  const credentialManager = createDeviceCredentialManager(db, tillId);
  return new DeviceSessionManager({
    db,
    tillId,
    mintEndpointUrl: getMintDeviceJwtEndpoint(),
    anonKey: getSupabaseAnonKey(),
    getCredential: async () => {
      const state = await credentialManager.read();
      if (state === null) {
        throw new Error("no device credential found; till must be provisioned before it can sync");
      }
      return state.credential;
    },
  });
}
