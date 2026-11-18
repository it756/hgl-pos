import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import type { AnyTillEvent } from "@hgl/events";
import { buildShiftOpenEvent } from "../../src/lib/events/shift";
import { nextEventId } from "../../src/lib/events/id";
import { SyncEngine, type SyncUploader, type UploadQueueRow } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T150 [US6] EC-01 — flap-debounce test, adapted from tasks.md's
// "Playwright + network shaper toggles connectivity at 200ms intervals for
// 60s" E2E spec to a Vitest integration test.
//
// HONEST SCOPING: apps/pos has no Playwright and no network-shaping-proxy
// infrastructure. "Flapping every ~200ms" is expressed here as many
// consecutive SyncEngine.drainOnce() calls whose uploader alternates
// success/failure, rather than real wall-clock timing.
//
// ALSO HONEST ABOUT A WIRING GAP: sync/health.ts's SyncHealthReporter is
// constructed WITH a SyncEngine and reads its queueDepth()/
// oldestPendingEventAt() for its own periodic snapshot, but the
// `consecutive_failures` counter it maintains only tracks failures of
// *posting that health snapshot* to an HTTP endpoint (see
// SyncHealthReporter#flushOne/postSnapshot) — it is never incremented or
// reset by SyncEngine.drainOnce()'s own upload outcomes. SyncEngine and
// sync/health.ts are therefore NOT wired together for upload-failure
// tracking. This test asserts on SyncEngine's OWN internal failure state
// instead (the `status` / `attempt_count` / `last_error` columns it
// maintains on `local_upload_queue`), since that is what is actually
// connected to drain failures.

const TILL_ID = "33330000-1000-4000-8000-000000000001";
const STORE_ID = "33330000-1000-4000-8000-000000000002";
const CASHIER_ID = "33330000-1000-4000-8000-000000000003";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class FlappingUploader implements SyncUploader {
  readonly uploaded: AnyTillEvent[] = [];
  readonly attempts: { succeeded: boolean }[] = [];
  #failNext: boolean;
  #flapping = true;

  constructor(startWithFailure: boolean) {
    this.#failNext = startWithFailure;
  }

  /** Simulates the connection settling down — every attempt succeeds from here on. */
  stopFlapping(): void {
    this.#flapping = false;
  }

  async upload(events: AnyTillEvent[]): Promise<void> {
    const shouldFail = this.#flapping && this.#failNext;
    this.#failNext = !this.#failNext;
    this.attempts.push({ succeeded: !shouldFail });
    if (shouldFail) {
      throw new Error("simulated flapping connection failure");
    }
    this.uploaded.push(...events);
  }
}

describe("EC-01 — flapping connection: no double-uploads, eventual full drain, sane local failure-tracking state", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("never double-uploads across alternating success/failure drains, and fully drains once the connection settles", async () => {
    const db = createMemoryDb();
    let simulatedNow = new Date("2026-05-01T12:00:00.000Z");
    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(simulatedNow), now: () => simulatedNow });
    await clock.sync();

    const uploader = new FlappingUploader(true);
    const syncEngine = new SyncEngine({ db, uploader, now: () => simulatedNow, pause: async () => {} });

    const CYCLES = 25;
    const producedEventIds: string[] = [];

    for (let i = 0; i < CYCLES; i += 1) {
      const eventId = await nextEventId(db, TILL_ID);
      const event = buildShiftOpenEvent({
        eventId,
        tillId: TILL_ID,
        storeId: STORE_ID,
        clientTs: (await clock.trustedNow()).toISOString(),
        appVersion: "1.0.0-test",
        schemaVer: 1,
        shiftId: crypto.randomUUID(),
        cashierId: CASHIER_ID,
        openingFloat: 100,
      });

      await syncEngine.enqueue(event);
      producedEventIds.push(event.event_id);

      await syncEngine.drainOnce();

      // Clear the backoff window (capped at 5 min) before the next cycle so
      // every drain call has something pending/failed-and-due to attempt —
      // faithfully reproducing "flapping under load" rather than idle waiting.
      simulatedNow = new Date(simulatedNow.getTime() + 6 * 60_000);
    }

    // ---- (a) never double-uploaded, even with retries interleaved ----
    const uploadedIdsSoFar = uploader.uploaded.map((event) => event.event_id);
    expect(new Set(uploadedIdsSoFar).size).toBe(uploadedIdsSoFar.length);
    expect(uploader.attempts.some((attempt) => !attempt.succeeded)).toBe(true);
    expect(uploader.attempts.some((attempt) => attempt.succeeded)).toBe(true);

    // ---- (c) sync-engine-local failure tracking is sane mid-flap ----
    const midFlapFailedRows = await db.query<UploadQueueRow>("SELECT * FROM local_upload_queue WHERE status = 'failed'");
    for (const row of midFlapFailedRows) {
      expect(row.attempt_count).toBeGreaterThanOrEqual(1);
      expect(row.last_error).not.toBeNull();
    }

    // ---- (b) failures stop; the queue eventually fully drains ----
    uploader.stopFlapping();
    for (let guard = 0; guard < 50; guard += 1) {
      const depth = await syncEngine.queueDepth();
      if (depth === 0) break;
      simulatedNow = new Date(simulatedNow.getTime() + 6 * 60_000);
      const result = await syncEngine.drainOnce();
      expect(result.failed).toBe(0); // once flapping has stopped, drains never fail again
    }

    expect(await syncEngine.queueDepth()).toBe(0);

    const finalUploadedIds = uploader.uploaded.map((event) => event.event_id);
    expect(new Set(finalUploadedIds).size).toBe(finalUploadedIds.length); // still no duplicates
    expect([...finalUploadedIds].sort()).toEqual([...producedEventIds].sort()); // every event landed exactly once

    // ---- (c) local failure-tracking state resets sanely once uploads succeed ----
    const finalRows = await db.query<UploadQueueRow>("SELECT * FROM local_upload_queue");
    expect(finalRows).toHaveLength(CYCLES);
    for (const row of finalRows) {
      expect(row.status).toBe("uploaded");
      expect(row.last_error).toBeNull();
    }
  });
});
