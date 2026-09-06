import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import type { AnyTillEvent } from "@hgl/events";
import { buildShiftOpenEvent } from "../../src/lib/events/shift";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";

// T149 catch-up coverage (closes NFR-004 regression gap beyond the one-shot
// Phase 0a hardware spike — see spike-report.md / spike-evidence/).
//
// SCOPE NOTE: this is a Vitest test against an in-memory fake DB, so it
// cannot re-prove SQLite's own WAL torn-write guarantee — that's a property
// of the real on-disk SQLite engine, already validated on real Windows POS
// hardware by the Phase 0a spike's `kill -9` criterion (T017d). What *is*
// exercised here is the app-level crash-recovery contract our code relies
// on: (1) every till-writable event write is a single, idempotent
// `INSERT ... ON CONFLICT(event_id) DO NOTHING` statement — which is what
// makes it safe to blindly retry a write the app isn't sure committed
// before a kill, without ever producing a duplicate or torn ledger entry —
// and (2) `SyncEngine.resetStaleUploading()`, which requeues rows a crash
// left stuck mid-upload so the queue "picks up exactly where it left off"
// on restart.
//
// Also, US1 (sale events, T064-T080) isn't implemented yet, so "write 10
// sales" is adapted to 10 synthetic till-writable events (shift_open events
// across 10 distinct shifts) built via the real, already-shipped
// buildShiftOpenEvent()/SyncEngine — the queue/crash-recovery mechanics
// exercised are identical regardless of which event kind is being written.

class RecordingUploader implements SyncUploader {
  readonly uploaded: AnyTillEvent[] = [];
  async upload(events: AnyTillEvent[]): Promise<void> {
    this.uploaded.push(...events);
  }
}

const TILL_ID = "99999999-0000-4000-8000-000000000001";
const STORE_ID = "aaaaaaa1-0000-4000-8000-000000000002";
const CASHIER_ID = "aaaaaaa2-0000-4000-8000-000000000003";

function buildTenSyntheticEvents(now: Date): AnyTillEvent[] {
  return Array.from({ length: 10 }, (_, index) =>
    buildShiftOpenEvent({
      eventId: `bbbbbbb${index}-0000-4000-8000-00000000000${index}`,
      tillId: TILL_ID,
      storeId: STORE_ID,
      clientTs: now.toISOString(),
      appVersion: "1.0.0-test",
      schemaVer: 1,
      shiftId: `ccccccc${index}-0000-4000-8000-00000000000${index}`,
      cashierId: CASHIER_ID,
      openingFloat: 100 + index,
    }),
  );
}

describe("Local-crash regression: upload queue survives a crash mid-drain and resumes exactly once (NFR-004)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("no torn writes: re-enqueuing the same 10 events after a simulated crash does not duplicate the local ledger", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-01T10:00:00.000Z");
    const events = buildTenSyntheticEvents(now);

    const syncEngine = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });
    for (const event of events) await syncEngine.enqueue(event);
    expect(await syncEngine.queueDepth()).toBe(10);

    // Simulate the app being unsure whether its last few enqueue() writes
    // committed before a kill, and conservatively retrying them all after
    // restart — each is a single idempotent statement, so this must be a
    // no-op, not a duplicate.
    const syncEngineAfterRestart = new SyncEngine({ db, uploader: new RecordingUploader(), now: () => now });
    for (const event of events) await syncEngineAfterRestart.enqueue(event);

    expect(await syncEngineAfterRestart.queueDepth()).toBe(10);
  });

  it("picks up exactly where it left off: rows stuck 'uploading' by a crash mid-drain are requeued and drained exactly once each", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-01T10:00:00.000Z");
    const events = buildTenSyntheticEvents(now);

    const uploaderBeforeCrash = new RecordingUploader();
    const syncEngineBeforeCrash = new SyncEngine({ db, uploader: uploaderBeforeCrash, now: () => now });
    for (const event of events) await syncEngineBeforeCrash.enqueue(event);

    // Simulate drainOnce() reaching the "locked for upload" point for all 10
    // rows and then the process being killed before upload() resolves and
    // before markUploaded()/markFailed() ever runs — the exact shape of a
    // "mid-write" crash for this queue.
    const rows = await db.query<{
      queue_id: string;
      event_id: string;
      event_kind: AnyTillEvent["kind"];
      payload: string;
      status: string;
      attempt_count: number;
      created_at: string;
      next_attempt_at: string;
    }>(
      `SELECT queue_id, event_id, event_kind, payload, status, attempt_count, created_at, next_attempt_at
      FROM local_upload_queue
      WHERE status IN ('pending', 'failed')
      ORDER BY created_at ASC
      LIMIT 100`,
    );
    expect(rows).toHaveLength(10);
    await syncEngineBeforeCrash.markUploading(rows, now.toISOString());
    expect(uploaderBeforeCrash.uploaded).toHaveLength(0); // crash happened before upload() ever completed

    // No torn writes: the ledger still has exactly 10 rows, none lost, none
    // duplicated, all now stuck 'uploading' (never marked uploaded/failed).
    expect(await db.query("SELECT queue_id FROM local_upload_queue WHERE status = 'uploading'")).toHaveLength(10);

    // ---- Restart: brand-new SyncEngine instance, same persisted MemoryDb ----
    const uploaderAfterRestart = new RecordingUploader();
    const nowAfterRestart = new Date(now.getTime() + 60_000);
    const syncEngineAfterRestart = new SyncEngine({ db, uploader: uploaderAfterRestart, now: () => nowAfterRestart });

    // Any 'uploading' row locked before this restart's boot time is stale —
    // requeue it (this is the app's own startup recovery step).
    await syncEngineAfterRestart.resetStaleUploading(nowAfterRestart.toISOString());

    const drainResult = await syncEngineAfterRestart.drainOnce();
    expect(drainResult).toEqual({ attempted: 10, uploaded: 10, failed: 0, nextAttemptAt: null });

    expect(uploaderAfterRestart.uploaded).toHaveLength(10);
    const uploadedEventIds = uploaderAfterRestart.uploaded.map((event) => event.event_id);
    expect(new Set(uploadedEventIds).size).toBe(10); // exactly once each, no duplicates
    expect(new Set(uploadedEventIds)).toEqual(new Set(events.map((event) => event.event_id)));

    // Queue is fully drained — a second drain finds nothing pending.
    expect(await syncEngineAfterRestart.queueDepth()).toBe(0);
  });
});
