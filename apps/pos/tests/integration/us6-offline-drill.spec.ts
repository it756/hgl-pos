import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import type { AnyTillEvent } from "@hgl/events";
import { buildShiftOpenEvent } from "../../src/lib/events/shift";
import { buildSaleEvent } from "../../src/lib/events/sale";
import { nextEventId } from "../../src/lib/events/id";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { SyncEngine, MAX_UPLOAD_BATCH_SIZE, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T115 [US6] — offline-drill proof, adapted from tasks.md's Playwright +
// network-shaping-proxy E2E spec to a Vitest integration test.
//
// HONEST SCOPING: apps/pos has no Playwright and no network-shaping-proxy
// infrastructure (E2E here is WebDriverIO + tauri-driver only, driving real
// UI navigation — see wdio.conf.ts — not simulated network conditions).
// Rather than force tooling that doesn't exist in this repo, this test
// proves the actual property SC-001/EC-15 care about — zero data loss and
// bounded-batch drain on reconnect — via a large synthetic backlog (220
// shift/sale events) queued locally across a simulated multi-day span
// (using ReliableClock's injectable `now`), then drained with repeated
// SyncEngine.drainOnce() calls until empty. The real scripted 8h/3-day
// drill against physical pilot hardware is a manual procedure already
// documented in docs/ops/offline-drill.md (T134); executing it and
// recording a pass/fail result is T144 — human/hardware-dependent, out of
// automation scope, and the actual SC-001 go-live gate.

const TILL_ID = "22220000-1000-4000-8000-000000000001";
const STORE_ID = "22220000-1000-4000-8000-000000000002";
const CASHIER_ID = "22220000-1000-4000-8000-000000000003";
const SKU_ID = "22220000-1000-4000-8000-000000000004";
const PRICE_VERSION_ID = "22220000-1000-4000-8000-000000000005";
const SHIFT_ID_FOR_SALES = "22220000-1000-4000-8000-000000000006";

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

describe("US6 — offline drill: large synthetic backlog, zero data loss, bounded-batch reconnect drain", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("queues 220 shift/sale events across a simulated 3-day offline span, then drains with zero loss, no duplicates, and every batch capped at MAX_UPLOAD_BATCH_SIZE", async () => {
    const db = createMemoryDb();

    // Simulated wall clock: advances 20 minutes per queued event, so 220
    // events span roughly 73 hours (~3 days) of "offline" time.
    let simulatedNow = new Date("2026-04-01T06:00:00.000Z");
    const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(simulatedNow), now: () => simulatedNow });
    await clock.sync();

    const uploader = new RecordingUploader();
    // Skip the real 250ms inter-batch pause — this test drives several
    // drain calls in a tight loop and only cares about batching/dedup.
    const syncEngine = new SyncEngine({ db, uploader, now: () => simulatedNow, pause: async () => {} });

    const TOTAL_EVENTS = 220;
    const producedEventIds: string[] = [];

    for (let i = 0; i < TOTAL_EVENTS; i += 1) {
      simulatedNow = new Date(simulatedNow.getTime() + 20 * 60_000);
      const clientTs = (await clock.trustedNow()).toISOString();
      const eventId = await nextEventId(db, TILL_ID);

      let event: AnyTillEvent;
      if (i % 2 === 0) {
        event = buildShiftOpenEvent({
          eventId,
          tillId: TILL_ID,
          storeId: STORE_ID,
          clientTs,
          appVersion: "1.0.0-test",
          schemaVer: 1,
          shiftId: crypto.randomUUID(),
          cashierId: CASHIER_ID,
          openingFloat: 100,
        });
      } else {
        const cart = new CartStore();
        cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 1, unitPrice: 10, priceVersionId: PRICE_VERSION_ID });
        const cartState = cart.getState();
        const tenders: Tender[] = [{ type: "cash", amount: cartState.grandTotal, reference: null }];
        event = buildSaleEvent({
          eventId,
          tillId: TILL_ID,
          storeId: STORE_ID,
          clientTs,
          appVersion: "1.0.0-test",
          schemaVer: 1,
          saleId: crypto.randomUUID(),
          cashierId: CASHIER_ID,
          shiftId: SHIFT_ID_FOR_SALES,
          cart: cartState,
          tenders,
        });
      }

      await syncEngine.enqueue(event);
      producedEventIds.push(event.event_id);
    }

    expect(new Set(producedEventIds).size).toBe(TOTAL_EVENTS); // sanity: no id collisions going in
    expect(await syncEngine.queueDepth()).toBe(TOTAL_EVENTS);

    // ---- Reconnect: drain in bounded batches until the queue is empty ----
    const batchSizes: number[] = [];
    for (;;) {
      const result = await syncEngine.drainOnce();
      if (result.attempted === 0) break;
      expect(result.attempted).toBeLessThanOrEqual(MAX_UPLOAD_BATCH_SIZE);
      expect(result.failed).toBe(0);
      expect(result.uploaded).toBe(result.attempted);
      batchSizes.push(result.attempted);
    }

    // Bounded batching: every batch but the last hit the cap exactly.
    expect(batchSizes.length).toBe(Math.ceil(TOTAL_EVENTS / MAX_UPLOAD_BATCH_SIZE));
    expect(batchSizes.slice(0, -1).every((size) => size === MAX_UPLOAD_BATCH_SIZE)).toBe(true);
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(TOTAL_EVENTS);

    // Zero data loss: every produced event uploaded exactly once — no drops, no duplicates.
    expect(uploader.uploaded).toHaveLength(TOTAL_EVENTS);
    const uploadedIds = uploader.uploaded.map((event) => event.event_id);
    expect(new Set(uploadedIds).size).toBe(TOTAL_EVENTS);
    expect([...uploadedIds].sort()).toEqual([...producedEventIds].sort());

    expect(await syncEngine.queueDepth()).toBe(0);
  });
});
