import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import type { AnyTillEvent } from "@hgl/events";
import { CashierSessionManager, ensureCashierSessionTables } from "../../src/lib/auth/cashier-session";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T061 catch-up coverage: full offline shift lifecycle (US9 Independent
// Test), including a simulated app restart mid-shift (new module instances
// constructed against the same persisted MemoryDb — the same pattern a real
// process restart would produce against the same on-disk SQLite file), and
// exactly-once sync with correct cashier attribution once the till drains
// its upload queue.

const TILL_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const STORE_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-0000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-0000-4000-8000-000000000004";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class RecordingUploader implements SyncUploader {
  readonly uploaded: AnyTillEvent[] = [];
  async upload(events: AnyTillEvent[]): Promise<void> {
    this.uploaded.push(...events);
  }
}

async function seedCashier(db: ReturnType<typeof createMemoryDb>): Promise<void> {
  await ensureCashierSessionTables(db);
  await db.insert(
    `INSERT INTO users (
      user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [CASHIER_ID, "cashier", STORE_ID, "Offline Cashier", "$argon2id$stored-hash", "2026-01-01T00:00:00.000Z", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
}

describe("US9 — full offline shift lifecycle survives a restart and syncs exactly once", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("logs in, opens a shift, restarts mid-shift, closes, and drains the upload queue exactly once with correct attribution", async () => {
    const db = createMemoryDb();
    await seedCashier(db);

    const now = new Date("2026-02-01T08:00:00.000Z");
    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
    await clock.sync();

    // ---- Session 1: login + open shift ----
    invokeMock.mockResolvedValueOnce(true);
    const sessionManager1 = new CashierSessionManager({ db });
    const loginResult = await sessionManager1.login(CASHIER_ID, "1234");
    expect(loginResult.ok).toBe(true);

    const uploader = new RecordingUploader();
    const syncEngine1 = new SyncEngine({ db, uploader, now: () => now });
    const queue1 = new ShiftEventQueue({
      db,
      syncEngine: syncEngine1,
      clock,
      tillId: TILL_ID,
      storeId: STORE_ID,
      appVersion: "1.0.0-test",
    });

    await queue1.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 500 });

    // ---- Simulated restart: brand-new instances, same persisted MemoryDb ----
    const sessionManager2 = new CashierSessionManager({ db });
    const currentSession = await sessionManager2.getCurrentSession();
    expect(currentSession?.user_id).toBe(CASHIER_ID);

    const clock2 = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
    const syncEngine2 = new SyncEngine({ db, uploader, now: () => now });
    const queue2 = new ShiftEventQueue({
      db,
      syncEngine: syncEngine2,
      clock: clock2,
      tillId: TILL_ID,
      storeId: STORE_ID,
      appVersion: "1.0.0-test",
    });

    const openShiftAfterRestart = await queue2.getOpenShift();
    expect(openShiftAfterRestart).not.toBeNull();
    expect(openShiftAfterRestart?.shift_id).toBe(SHIFT_ID);
    expect(openShiftAfterRestart?.opening_float).toBe(500);

    // ---- Close the shift (still fully offline) ----
    await queue2.closeShift({
      shiftId: SHIFT_ID,
      cashCounted: 500,
      tenderBreakdown: { cash: 500 },
      notes: null,
    });

    const closedShift = await queue2.getShift(SHIFT_ID);
    expect(closedShift?.status).toBe("closed");
    expect(closedShift?.over_short).toBe(0);

    // ---- Sync exactly once ----
    expect(await syncEngine2.queueDepth()).toBe(2);

    const firstDrain = await syncEngine2.drainOnce();
    expect(firstDrain).toEqual({ attempted: 2, uploaded: 2, failed: 0, nextAttemptAt: null });
    expect(uploader.uploaded).toHaveLength(2);
    for (const event of uploader.uploaded) {
      expect(event.kind).toBe("shift");
      if (event.kind === "shift") {
        expect(event.cashier_id).toBe(CASHIER_ID);
        expect(event.shift_id).toBe(SHIFT_ID);
      }
    }
    expect(uploader.uploaded.map((event) => event.event_id)).toEqual([...new Set(uploader.uploaded.map((event) => event.event_id))]);

    const secondDrain = await syncEngine2.drainOnce();
    expect(secondDrain).toEqual({ attempted: 0, uploaded: 0, failed: 0, nextAttemptAt: null });
    expect(uploader.uploaded).toHaveLength(2);
  });
});
