import { describe, expect, it } from "vitest";
import { createMemoryDb } from "../support/memory-db";
import { ensureSkuTables, findSkuByBarcode } from "../../src/lib/pricing/lookup";
import { ensurePriceVersionsTable, resolvePrice } from "../../src/lib/pricing/resolve";
import { ensurePromotionsTable, findActivePromotions } from "../../src/lib/pricing/promotions";
import { CartStore } from "../../src/lib/cart/store";

// T151 — scan-to-total perf sample.
//
// WHAT THIS MEASURES: the pure client-side logic pipeline a single
// "scan → line added → totals recalculated" interaction exercises —
// barcode lookup (pricing/lookup.ts), effective-dated price resolution
// (pricing/resolve.ts), active-promotion lookup + re-evaluation
// (pricing/promotions.ts), and cart line/total recalculation
// (cart/store.ts) — against the in-memory `IDb` fake (tests/support/
// memory-db.ts), run 1000 times to get a stable p50/p95/p99.
//
// WHAT THIS DOES NOT MEASURE (the honest gap vs. NFR-001/SC-002's real
// "p95 < 2s" budget): real Windows Tauri WebView UI paint/re-render, real
// barcode-scanner hardware latency, real SQLite (WAL) disk I/O on the
// till's own filesystem, and any PowerSync/network round-trip. Those can
// only be measured on the Phase 0a reference device with real hardware —
// this bench cannot reach them. The budget asserted below (`P95_BUDGET_MS`)
// is therefore a MUCH TIGHTER threshold appropriate for pure JS/SQL logic
// with zero UI/hardware I/O, not a substitute for the real end-to-end NFR.
//
// PURPOSE: wire into CI as a regression guard on the logic layer's OWN
// contribution to scan-to-total latency (e.g. an accidentally-quadratic
// promotion match or an N+1 query creeping in), not as proof NFR-001/
// SC-002 is met on real hardware.

const STORE_ID = "10000000-1000-4000-8000-000000000001";
const CASHIER_ID = "20000000-1000-4000-8000-000000000002";
const AT_TIME = "2026-06-01T09:00:00.000Z";
const ITERATIONS = 1000;
const WARMUP_ITERATIONS = 50;
const P95_BUDGET_MS = 50;

type CatalogSku = { skuId: string; code: string; barcode: string };

const CATALOG: CatalogSku[] = [
  { skuId: "30000000-1000-4000-8000-000000000001", code: "SKU-0001", barcode: "6001000000011" },
  { skuId: "30000000-1000-4000-8000-000000000002", code: "SKU-0002", barcode: "6001000000028" },
  { skuId: "30000000-1000-4000-8000-000000000003", code: "SKU-0003", barcode: "6001000000035" },
  { skuId: "30000000-1000-4000-8000-000000000004", code: "SKU-0004", barcode: "6001000000042" },
  { skuId: "30000000-1000-4000-8000-000000000005", code: "SKU-0005", barcode: "6001000000059" },
];

async function seedCatalog(db: ReturnType<typeof createMemoryDb>): Promise<void> {
  await ensureSkuTables(db);
  await ensurePriceVersionsTable(db);
  await ensurePromotionsTable(db);

  CATALOG.forEach((sku, index) => {
    db.seed("skus", "sku_id", {
      sku_id: sku.skuId,
      code: sku.code,
      barcode: sku.barcode,
      name: `Perf Bench Item ${index + 1}`,
      category_id: null,
      unit_type: "quantity",
      track_batch: 0,
      track_expiry: 0,
      is_active: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    db.seed("price_versions", "price_version_id", {
      price_version_id: `40000000-1000-4000-8000-00000000000${index + 1}`,
      sku_id: sku.skuId,
      store_id: null,
      unit_price: 10 + index * 5,
      currency: "ZMW",
      effective_from: "2026-01-01T00:00:00.000Z",
      created_by_user_id: CASHIER_ID,
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });

  // Two active promotions, each scoped to a subset of the catalog, so
  // findActivePromotions/applyPromotionsToLines does real matching work
  // (not just an empty-result no-op) on every iteration.
  db.seed("promotions", "promotion_id", {
    promotion_id: "50000000-1000-4000-8000-000000000001",
    type: "date_range_discount",
    payload: JSON.stringify({ discount_pct: 10 }),
    applies_to_sku_ids: JSON.stringify([CATALOG[0]!.skuId, CATALOG[1]!.skuId]),
    store_id: null,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: "2026-12-31T00:00:00.000Z",
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  db.seed("promotions", "promotion_id", {
    promotion_id: "50000000-1000-4000-8000-000000000002",
    type: "bogo",
    payload: JSON.stringify({ buy: 1, get: 1, discount_pct: 50 }),
    applies_to_sku_ids: JSON.stringify([CATALOG[2]!.skuId]),
    store_id: null,
    effective_from: "2026-01-01T00:00:00.000Z",
    effective_to: "2026-12-31T00:00:00.000Z",
    is_active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
}

/** One "scan → line added → totals recalculated" interaction, start to finish. */
async function runScanToTotal(db: ReturnType<typeof createMemoryDb>, catalogIndex: number): Promise<number> {
  const sku = CATALOG[catalogIndex % CATALOG.length]!;

  const skuRow = await findSkuByBarcode(db, sku.barcode);
  if (skuRow === null) throw new Error(`bench setup bug: sku not found for barcode ${sku.barcode}`);

  const price = await resolvePrice(db, { skuId: skuRow.sku_id, storeId: STORE_ID, atTime: AT_TIME });
  if (price === null) throw new Error(`bench setup bug: no price for sku ${skuRow.sku_id}`);

  const promotions = await findActivePromotions(db, { storeId: STORE_ID, skuId: skuRow.sku_id, atTime: AT_TIME });

  // Fresh cart per scan: this measures the marginal cost of ONE scan, not
  // an artificially-growing 1000-line basket (which would confound the
  // per-scan number with cart-size-dependent recalculation cost).
  const cart = new CartStore();
  cart.addLine({ skuId: skuRow.sku_id, unitType: "quantity", qty: 1, unitPrice: price.unit_price, priceVersionId: price.price_version_id });
  cart.applyPromotions(promotions);

  return cart.getState().grandTotal;
}

function percentile(sortedAscending: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  return sortedAscending[Math.min(Math.max(rank, 0), sortedAscending.length - 1)]!;
}

describe("T151 — scan-to-total logic-layer perf sample", () => {
  it(`p95 stays under ${P95_BUDGET_MS}ms across ${ITERATIONS} scan-to-total iterations (logic layer only)`, async () => {
    const db = createMemoryDb();
    await seedCatalog(db);

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      await runScanToTotal(db, i);
    }

    const durationsMs: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const start = performance.now();
      await runScanToTotal(db, i);
      durationsMs.push(performance.now() - start);
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    // eslint-disable-next-line no-console -- perf numbers are meant to be visible in CI/local test output
    console.log(`[T151 scan-to-total] p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms (n=${ITERATIONS})`);

    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });
});
