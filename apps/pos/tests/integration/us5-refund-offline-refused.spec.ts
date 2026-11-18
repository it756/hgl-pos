import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import type { AnyTillEvent } from "@hgl/events";
import { CartStore } from "../../src/lib/cart/store";
import type { Tender } from "../../src/lib/tenders/types";
import { ShiftEventQueue } from "../../src/lib/events/queue";
import { SaleEventQueue } from "../../src/lib/events/sale";
import { RefundConnectivityError, signInForRefundVerification, verifyRefundEligibility } from "../../src/lib/events/refund";
import { SyncEngine, type SyncUploader } from "../../src/lib/sync/engine";
import { ReliableClock, type NetworkTimeSource } from "../../src/lib/time/clock";

// T109 (FR-012, User Story 5): an OFFLINE till attempting to refund a sale
// from a DIFFERENT till (cross-till) or an earlier day (cross-day/history)
// must be refused with a clear, actionable connectivity error and must make
// ZERO local writes — unlike void.ts's same-till-session void, this flow
// (refund.ts) is deliberately non-offline-capable: `verifyRefundEligibility`
// (and the `signInForRefundVerification` step-up auth call that precedes
// it) are the only two network calls in the till app, and both accept an
// injectable `fetchImpl` for exactly this reason. This spec injects a
// `fetchImpl` that always rejects (simulating an offline/unreachable till)
// and asserts the local DB is byte-for-byte unchanged from before the
// attempt — the core FR-012 guarantee.

const TILL_ID = "aaaaaaaa-5000-4000-8000-000000000001";
const ORIGINAL_TILL_ID = "aaaaaaaa-5000-4000-8000-000000000099"; // the cross-till sale's real till — never touched by this spec's local db
const STORE_ID = "bbbbbbbb-5000-4000-8000-000000000002";
const CASHIER_ID = "cccccccc-5000-4000-8000-000000000003";
const SHIFT_ID = "dddddddd-5000-4000-8000-000000000004";
const SKU_ID = "eeeeeeee-5000-4000-8000-000000000005";
// A sale_id that (per the scenario) belongs to ORIGINAL_TILL_ID from a prior
// day — this till has no local record of it at all, which is exactly why a
// cross-till/cross-day refund can only ever be resolved via the online
// verify-refund call, never a local lookup.
const CROSS_TILL_SALE_ID = "ffffffff-5000-4000-8000-000000000006";

class FakeNetworkTime implements NetworkTimeSource {
  constructor(private time: Date) {}
  async now(): Promise<Date> {
    return this.time;
  }
}

class RejectingUploader implements SyncUploader {
  async upload(): Promise<never> {
    throw new Error("upload() should never be reached — this spec asserts no event is ever queued");
  }
}

async function seedSyncedClock(db: ReturnType<typeof createMemoryDb>, now: Date): Promise<ReliableClock> {
  const clock = new ReliableClock({ db, networkTime: new FakeNetworkTime(now), now: () => now });
  await clock.sync();
  return clock;
}

/** Snapshot of every table an offline refund attempt could conceivably touch. */
async function snapshotLocalState(db: ReturnType<typeof createMemoryDb>) {
  return {
    saleEvents: await db.query<Record<string, unknown>>("SELECT * FROM sale_events ORDER BY event_id"),
    sales: await db.query<Record<string, unknown>>("SELECT * FROM sales ORDER BY sale_id"),
    stockEvents: await db.query<Record<string, unknown>>("SELECT * FROM stock_events ORDER BY event_id"),
    currentStock: await db.query<Record<string, unknown>>("SELECT * FROM current_stock_by_store_sku ORDER BY sku_id"),
    refundVerifications: await db.query<Record<string, unknown>>("SELECT * FROM local_refund_verifications ORDER BY refund_event_id"),
    uploadQueue: await db.query<Record<string, unknown>>("SELECT * FROM local_upload_queue ORDER BY queue_id"),
  };
}

describe("US5 — cross-till/cross-day refund refused while offline (FR-012)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("throws RefundConnectivityError from verifyRefundEligibility and leaves the local DB completely unchanged", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-01T09:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RejectingUploader(), now: () => now });

    // Baseline: this till already has an open shift with one completed sale
    // of its own, so "unchanged" is a meaningful assertion (not just "still
    // empty").
    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });

    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 1, unitPrice: 40, priceVersionId: "11111111-5000-4000-8000-000000000007" });
    const tenders: Tender[] = [{ type: "cash", amount: 40, reference: null }];
    const saleQueue = new SaleEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await saleQueue.completeSale({ cashierId: CASHIER_ID, shiftId: SHIFT_ID, cart: cart.getState(), tenders });

    const before = await snapshotLocalState(db);
    const queueDepthBefore = await syncEngine.queueDepth();

    const offlineFetch: typeof fetch = () => Promise.reject(new Error("simulated offline till: fetch never reaches the network"));

    let thrown: unknown;
    try {
      await verifyRefundEligibility({
        endpoint: "https://example.supabase.co/functions/v1/verify-refund",
        accessToken: "test-access-token",
        originalSaleId: CROSS_TILL_SALE_ID,
        refundReason: "customer return",
        fetchImpl: offlineFetch,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RefundConnectivityError);
    expect((thrown as Error).message).toMatch(/connectivity is required/i);
    expect((thrown as Error).message).toMatch(/cross-till or historical refund/i);

    // Core FR-012 guarantee: the failed verification attempt produced
    // exactly zero local writes — no stock/sale/refund-verification row,
    // and the upload queue is untouched.
    expect(await snapshotLocalState(db)).toEqual(before);
    expect(await syncEngine.queueDepth()).toBe(queueDepthBefore);
  });

  it("also refuses at the sign-in step-up (before verify-refund is ever attempted) when offline", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-01T09:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RejectingUploader(), now: () => now });

    const shiftQueue = new ShiftEventQueue({ db, syncEngine, clock, tillId: TILL_ID, storeId: STORE_ID, appVersion: "1.0.0-test" });
    await shiftQueue.openShift({ shiftId: SHIFT_ID, cashierId: CASHIER_ID, openingFloat: 100 });

    const before = await snapshotLocalState(db);

    const offlineFetch: typeof fetch = () => Promise.reject(new Error("simulated offline till: fetch never reaches the network"));

    await expect(
      signInForRefundVerification({
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "test-anon-key",
        email: "manager@example.com",
        password: "hunter2",
        fetchImpl: offlineFetch,
      }),
    ).rejects.toThrow(RefundConnectivityError);

    expect(await snapshotLocalState(db)).toEqual(before);
  });

  it("refuses a cross-till sale even when the sale_id happens to exist locally under a DIFFERENT till (no cross-till local read is ever trusted)", async () => {
    const db = createMemoryDb();
    const now = new Date("2026-04-01T09:00:00.000Z");
    const clock = await seedSyncedClock(db, now);
    const syncEngine = new SyncEngine({ db, uploader: new RejectingUploader(), now: () => now });

    // A sale completed on a DIFFERENT till, replicated into this till's
    // local db (e.g. via a prior sync pull) — refund.ts must not treat this
    // as sufficient for a local refund; it always requires the online
    // verify-refund round trip regardless of what's cached locally.
    const otherTillClock = await seedSyncedClock(db, now);
    const otherTillSyncEngine = new SyncEngine({ db, uploader: new RejectingUploader(), now: () => now });
    const otherTillShiftId = "dddddddd-5000-4000-8000-000000000099";
    const otherTillShiftQueue = new ShiftEventQueue({
      db,
      syncEngine: otherTillSyncEngine,
      clock: otherTillClock,
      tillId: ORIGINAL_TILL_ID,
      storeId: STORE_ID,
      appVersion: "1.0.0-test",
    });
    await otherTillShiftQueue.openShift({ shiftId: otherTillShiftId, cashierId: CASHIER_ID, openingFloat: 100 });

    const cart = new CartStore();
    cart.addLine({ skuId: SKU_ID, unitType: "quantity", qty: 1, unitPrice: 40, priceVersionId: "11111111-5000-4000-8000-000000000007" });
    const otherTillSaleQueue = new SaleEventQueue({
      db,
      syncEngine: otherTillSyncEngine,
      clock: otherTillClock,
      tillId: ORIGINAL_TILL_ID,
      storeId: STORE_ID,
      appVersion: "1.0.0-test",
    });
    const otherTillSale = await otherTillSaleQueue.completeSale({
      cashierId: CASHIER_ID,
      shiftId: otherTillShiftId,
      cart: cart.getState(),
      tenders: [{ type: "cash", amount: 40, reference: null }],
    });

    const before = await snapshotLocalState(db);
    const offlineFetch: typeof fetch = () => Promise.reject(new Error("simulated offline till"));

    await expect(
      verifyRefundEligibility({
        endpoint: "https://example.supabase.co/functions/v1/verify-refund",
        accessToken: "test-access-token",
        originalSaleId: otherTillSale.sale_id,
        refundReason: "customer return",
        fetchImpl: offlineFetch,
      }),
    ).rejects.toThrow(RefundConnectivityError);

    // Unchanged apart from the pre-seeded other-till sale itself (which the
    // refused refund attempt never wrote to).
    expect(await snapshotLocalState(db)).toEqual(before);
  });
});
