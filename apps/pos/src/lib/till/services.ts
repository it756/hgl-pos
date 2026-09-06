import { HttpDateHeaderTimeSource, ReliableClock } from "../time/clock";
import { SyncEngine, type SyncUploader } from "../sync/engine";
import { ShiftEventQueue } from "../events/queue";
import { SaleEventQueue } from "../events/sale";
import { VoidEventQueue } from "../events/void";
import { CountCorrectionQueue } from "../events/count";
import { AdjustmentRequestQueue } from "../events/adjustment";
import { RefundEventQueue } from "../events/refund";
import type { IDb } from "../db";

// Small composition helpers shared by the till's cashier/shift pages.
// There is no app-wide composition root yet, so each page resolves till
// identity and constructs its own service instances via these helpers.

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0-dev";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// T038 built the local upload-queue engine ahead of the HTTP ingest endpoint
// that will actually POST queued events to Supabase; that endpoint + a real
// SyncUploader land in a later sync-wiring task. `enqueue()` only writes to
// `local_upload_queue` and never calls `upload()`, so this throwing stub is
// safe until that work lands — nothing here silently drops events.
const notImplementedUploader: SyncUploader = {
  upload() {
    return Promise.reject(
      new Error("Event upload is not wired yet — events remain queued locally in local_upload_queue."),
    );
  },
};

export async function getTillId(db: IDb): Promise<string | null> {
  await db.init();
  const rows = await db.query<{ till_id: string }>(`SELECT till_id FROM local_device_credential LIMIT 1`);
  return rows[0]?.till_id ?? null;
}

export function createReliableClock(db: IDb): ReliableClock {
  if (SUPABASE_URL === undefined) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured; cannot verify network time for financial events.");
  }
  return new ReliableClock({ db, networkTime: new HttpDateHeaderTimeSource(`${SUPABASE_URL}/auth/v1/health`) });
}

export function createShiftEventQueue(db: IDb, tillId: string, storeId: string): ShiftEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
  return new ShiftEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createSaleEventQueue(db: IDb, tillId: string, storeId: string): SaleEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
  return new SaleEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createVoidEventQueue(db: IDb, tillId: string, storeId: string): VoidEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
  return new VoidEventQueue({ db, syncEngine, clock, tillId, storeId, appVersion: APP_VERSION });
}

export function createCountCorrectionQueue(db: IDb, tillId: string, storeId: string): CountCorrectionQueue {
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
  return new CountCorrectionQueue({ db, syncEngine, tillId, storeId, appVersion: APP_VERSION });
}

export function createAdjustmentRequestQueue(db: IDb, tillId: string, storeId: string): AdjustmentRequestQueue {
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
  return new AdjustmentRequestQueue({ db, syncEngine, tillId, storeId, appVersion: APP_VERSION });
}

export function createRefundEventQueue(db: IDb, tillId: string, storeId: string): RefundEventQueue {
  const clock = createReliableClock(db);
  const syncEngine = new SyncEngine({ db, uploader: notImplementedUploader });
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
