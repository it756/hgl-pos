import { describe, expect, it } from "vitest";

// T114 (US6, SC-013): approximate load harness for a 32-till simultaneous
// reconnect against local Supabase.
//
// SCOPING — read before trusting this test's "coverage":
// There is no real PowerSync bucket-sync wiring yet, and no HTTP event-
// ingest endpoint exists yet either (apps/pos/src/lib/sync/engine.ts's
// SyncEngine.drain()/upload() path is stubbed — see repo memory notes and
// apps/pos/src/lib/till/services.ts's `notImplementedUploader`). A full,
// faithful "32 real PowerSync clients reconnect and drain their real
// upload queues" harness is therefore not buildable in this environment.
//
// What this DOES exercise: 32 concurrent simulated "tills" each issuing a
// bounded sequence of sequential HTTP requests against local Supabase's
// `/auth/v1/health` endpoint (the same endpoint apps/pos/src/lib/time/clock.ts's
// `HttpDateHeaderTimeSource` already uses as its network-time/connectivity
// probe — i.e. the one real network call every reconnect flow makes today),
// pausing BATCH_PAUSE_MS between requests per till to mirror
// engine.ts's batched-upload pacing (MAX_UPLOAD_BATCH_SIZE/BATCH_PAUSE_MS).
// This is a connection-pool/concurrency smoke test (SC-013's "pool headroom"
// and "per-till progress" concerns), NOT a test of event-upload correctness
// or idempotency — that's T115 (E2E offline drill) and T116 (pgTAP replay)
// once the real ingest endpoint exists.
//
// Requires local Supabase running (`supabase start`). If unreachable, the
// whole suite is skipped (reported clearly below) rather than failing —
// this file is not meant to gate `pnpm test` on machines without local
// Supabase up.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const HEALTH_ENDPOINT = `${SUPABASE_URL}/auth/v1/health`;

const TILL_COUNT = 32;
const REQUESTS_PER_TILL = 5;
// Mirrors apps/pos/src/lib/sync/engine.ts's BATCH_PAUSE_MS (250 ms pause between batches).
const BATCH_PAUSE_MS = 250;
const REACHABILITY_TIMEOUT_MS = 2_000;
const PER_REQUEST_TIMEOUT_MS = 5_000;

const reachable = await isSupabaseReachable(HEALTH_ENDPOINT);

describe.skipIf(!reachable)("reconnect-storm: 32-till simultaneous reconnect (SC-013)", () => {
  it(
    "every till completes its full request sequence with in-order progress and no failures under 32-way concurrency",
    async () => {
      const tillIds = Array.from({ length: TILL_COUNT }, (_, index) => `sim-till-${index}`);

      const results = await Promise.all(tillIds.map((tillId) => runSimulatedTill(tillId)));

      for (const result of results) {
        // Pool headroom: no request for this till was rejected/errored.
        expect(result.failures, `till ${result.tillId} had failed requests: ${JSON.stringify(result.failures)}`).toHaveLength(0);
        // Per-till progress: this till's own requests completed in order, none skipped.
        expect(result.completedSequence).toEqual(Array.from({ length: REQUESTS_PER_TILL }, (_, i) => i));
      }

      expect(results).toHaveLength(TILL_COUNT);
    },
    // Generous ceiling: 32 tills * 5 requests * ~250ms pause, run concurrently — bounds against a hung/overloaded pool.
    60_000,
  );
});

if (!reachable) {
  describe("reconnect-storm: 32-till simultaneous reconnect (SC-013)", () => {
    it.skip(`skipped — local Supabase not reachable at ${SUPABASE_URL}; run 'supabase start' to exercise this harness`, () => {});
  });
}

type SimulatedTillResult = {
  tillId: string;
  completedSequence: number[];
  failures: { sequence: number; status: number | null; error: string | null }[];
};

async function runSimulatedTill(tillId: string): Promise<SimulatedTillResult> {
  const completedSequence: number[] = [];
  const failures: SimulatedTillResult["failures"] = [];

  for (let sequence = 0; sequence < REQUESTS_PER_TILL; sequence += 1) {
    try {
      const response = await fetchWithTimeout(HEALTH_ENDPOINT, PER_REQUEST_TIMEOUT_MS);
      if (response.ok) {
        completedSequence.push(sequence);
      } else {
        failures.push({ sequence, status: response.status, error: null });
      }
    } catch (error) {
      failures.push({ sequence, status: null, error: error instanceof Error ? error.message : String(error) });
    }

    if (sequence < REQUESTS_PER_TILL - 1) {
      await pause(BATCH_PAUSE_MS);
    }
  }

  return { tillId, completedSequence, failures };
}

async function isSupabaseReachable(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, REACHABILITY_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
