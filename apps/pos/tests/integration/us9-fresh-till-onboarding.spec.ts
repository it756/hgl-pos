import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { CashierSessionManager, ensureCashierSessionTables } from "../../src/lib/auth/cashier-session";
import { DeviceCredentialManager } from "../../src/lib/auth/device-credential";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { getTillId } from "../../src/lib/till/services";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T148 catch-up coverage (closes SC-009 measurement gap): fresh-till
// onboarding — provision, pull initial data in one online session,
// disconnect, verify the till is fully operational offline.
//
// SCOPE NOTE: apps/pos has no PowerSync `.connect()`/bucket-sync wiring yet
// (confirmed repo-wide — see the "no composition root yet" note in
// tasks.md's Phase 4 implementation notes) — catalog/prices/stock/roster
// pull-down is not implemented client-side, only server-side (the
// provision-till Edge Function + PowerSync sync-rules). This test therefore
// covers the boundary contract SC-009 actually cares about: given (a) a
// successful POST /provision-till response is saved locally as this till's
// device credential, and (b) the cashier roster this till needs is present
// locally (standing in for a completed initial sync pull), the till can
// then go fully offline — zero network calls — through the entire login →
// shift-open → shift-close lifecycle. Real PowerSync bucket-sync wiring is
// tracked separately; extend this test once `.connect()` lands.

const STORE_ID = "44444444-0000-4000-8000-000000000001";
const TILL_ID = "55555555-0000-4000-8000-000000000002";
const CASHIER_ID = "66666666-0000-4000-8000-000000000003";
const SHIFT_ID = "77777777-0000-4000-8000-000000000004";
const OPERATOR_USER_ID = "88888888-0000-4000-8000-000000000005";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class RecordingUploader implements SyncUploader {
  async upload(): Promise<void> {}
}

describe("US9 — fresh-till onboarding: provision + one online session, then fully offline", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("saves the provisioned credential, then runs the full login/shift lifecycle with zero network calls", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-03-01T09:00:00.000Z");

    // ---- One online session: provisioning ----
    const provisionFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          till_id: TILL_ID,
          credential: "opaque-device-credential",
          expires_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
          initial_sync_ready: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", provisionFetch);

    const provisionResponse = await fetch("https://supabase.local/functions/v1/provision-till", {
      method: "POST",
      headers: { authorization: "Bearer store-manager-jwt", "content-type": "application/json" },
      body: JSON.stringify({
        store_id: STORE_ID,
        label: "Till 1",
        device_identity: "test-device-smbios-uuid",
        operator_user_id: OPERATOR_USER_ID,
      }),
    });
    expect(provisionResponse.ok).toBe(true);
    const provisioned = (await provisionResponse.json()) as {
      till_id: string;
      credential: string;
      expires_at: string;
      initial_sync_ready: boolean;
    };
    expect(provisioned.initial_sync_ready).toBe(true);

    const credentialManager = new DeviceCredentialManager({
      db,
      tillId: provisioned.till_id,
      rotateEndpointUrl: "https://supabase.local/functions/v1/auth/device-credential/rotate",
      now: () => now,
    });
    await credentialManager.save({ credential: provisioned.credential, expires_at: provisioned.expires_at });

    // Stand-in for the initial catalog/prices/stock/roster pull completing
    // in this same online session — see SCOPE NOTE above.
    await ensureCashierSessionTables(db);
    await db.insert(
      `INSERT INTO users (
        user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [CASHIER_ID, "cashier", STORE_ID, "Fresh Till Cashier", "$argon2id$stored-hash", now.toISOString(), 1, now.toISOString(), now.toISOString()],
    );

    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
    await clock.sync();

    expect(provisionFetch).toHaveBeenCalledTimes(1);

    // ---- Disconnect: any further network call is a test failure ----
    const disconnectedFetch = vi.fn().mockRejectedValue(new Error("network unreachable — till is offline"));
    vi.stubGlobal("fetch", disconnectedFetch);

    const resolvedTillId = await getTillId(db);
    expect(resolvedTillId).toBe(TILL_ID);

    invokeMock.mockResolvedValueOnce(true);
    const sessionManager = new CashierSessionManager({ db });
    const loginResult = await sessionManager.login(CASHIER_ID, "1234");
    expect(loginResult.ok).toBe(true);

    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });
    const queue = new ShiftEventQueue({
      db,
      syncEngine,
      clock,
      tillId: TILL_ID,
      storeId: STORE_ID,
      appVersion: "1.0.0-test",
    });

    await queue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 300 });
    await queue.closeShift({ shiftId: SHIFT_ID, cashCounted: 300, tenderBreakdown: { cash: 300 }, notes: null });

    const closedShift = await queue.getShift(SHIFT_ID);
    expect(closedShift?.status).toBe("closed");
    expect(closedShift?.over_short).toBe(0);

    // The entire offline lifecycle — resolving till identity, login,
    // opening and closing a shift — made zero calls through the
    // "disconnected" fetch stub.
    expect(disconnectedFetch).not.toHaveBeenCalled();
  });
});
