import { describe, expect, it } from "vitest";
import { deriveProvisionalMarker } from "../../../src/lib/reports/shared";
import type { TillSyncHealthRow } from "../../../src/lib/monitoring/sync-health";

// T125 companion unit test: `provisional_until_server_ts` (EC-16) is
// computed in application code, NOT in SQL — see
// supabase/tests/report_provisional.spec.sql for the pgTAP coverage of the
// `sync_health_latest_by_till` view's data contract this logic reads from.
// `deriveProvisionalMarker` is the pure core of
// apps/admin/src/lib/reports/shared.ts's `computeProvisionalMarker`
// (extracted so it can be tested here with plain fixture rows and no
// Supabase/DB mocking).

function till(overrides: Partial<TillSyncHealthRow>): TillSyncHealthRow {
  return {
    till_id: "till-1",
    store_id: "store-1",
    till_label: "Till 1",
    store_code: "S1",
    store_name: "Store 1",
    server_ts: null,
    queue_depth: null,
    oldest_pending_event_at: null,
    last_successful_sync_at: null,
    consecutive_failures: null,
    app_version: null,
    schema_version: null,
    ...overrides,
  };
}

const RANGE_TO_TS = "2026-01-02T00:00:00.000Z";

describe("deriveProvisionalMarker", () => {
  it("is not provisional when no till has a pending event at or before the range end", () => {
    const tills = [
      till({ till_id: "a", oldest_pending_event_at: null }),
      till({ till_id: "b", oldest_pending_event_at: "2026-01-05T00:00:00.000Z" }), // after the range end
    ];

    const marker = deriveProvisionalMarker(tills, RANGE_TO_TS);

    expect(marker).toEqual({ isProvisional: false, provisionalUntilServerTs: null, staleTillIds: [] });
  });

  it("is provisional when a till has a pending event at or before the range end", () => {
    const tills = [
      till({ till_id: "stale", oldest_pending_event_at: "2026-01-01T07:55:00.000Z" }),
      till({ till_id: "current", oldest_pending_event_at: null }),
    ];

    const marker = deriveProvisionalMarker(tills, RANGE_TO_TS);

    expect(marker.isProvisional).toBe(true);
    expect(marker.staleTillIds).toEqual(["stale"]);
    expect(marker.provisionalUntilServerTs).toBe("2026-01-01T07:55:00.000Z");
  });

  it("treats a pending event exactly at the range end as stale (inclusive boundary)", () => {
    const tills = [till({ till_id: "boundary", oldest_pending_event_at: RANGE_TO_TS })];

    const marker = deriveProvisionalMarker(tills, RANGE_TO_TS);

    expect(marker.isProvisional).toBe(true);
    expect(marker.staleTillIds).toEqual(["boundary"]);
  });

  it("uses the earliest pending timestamp across multiple stale tills", () => {
    const tills = [
      till({ till_id: "later", oldest_pending_event_at: "2026-01-01T09:00:00.000Z" }),
      till({ till_id: "earlier", oldest_pending_event_at: "2026-01-01T07:55:00.000Z" }),
    ];

    const marker = deriveProvisionalMarker(tills, RANGE_TO_TS);

    expect(marker.provisionalUntilServerTs).toBe("2026-01-01T07:55:00.000Z");
    expect(marker.staleTillIds.sort()).toEqual(["earlier", "later"]);
  });

  it("scopes to a single store when storeId is provided", () => {
    const tills = [
      till({ till_id: "in-store", store_id: "store-a", oldest_pending_event_at: "2026-01-01T07:55:00.000Z" }),
      till({ till_id: "other-store", store_id: "store-b", oldest_pending_event_at: "2026-01-01T07:55:00.000Z" }),
    ];

    const marker = deriveProvisionalMarker(tills, RANGE_TO_TS, "store-a");

    expect(marker.staleTillIds).toEqual(["in-store"]);
  });
});
