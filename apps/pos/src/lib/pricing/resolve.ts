import type { IDb } from "../db";

// Effective-dated price resolver (T065). Implements the canonical query
// from data-model.md §1.7 verbatim (EC-19): store override wins over
// global, then latest `effective_from`, then latest `server_ts` as a
// tie-break for concurrent HQ writes. `price_versions` has no local
// `server_ts` column (it's master data, not an event) — `created_at` is
// its till-local equivalent (row is written once, at sync-down time), and
// the table's own index is already ordered this way (see schema.ts's
// `price_versions_lookup_idx`).

export type PriceVersionRow = {
  price_version_id: string;
  sku_id: string;
  store_id: string | null;
  unit_price: number;
  currency: string;
  effective_from: string;
  created_by_user_id: string;
  created_at: string;
};

export type ResolvePriceParams = {
  skuId: string;
  storeId: string;
  /** ISO timestamp of the sale — the point in time to resolve the price at. */
  atTime: string;
};

export async function resolvePrice(db: IDb, params: ResolvePriceParams): Promise<PriceVersionRow | null> {
  await ensurePriceVersionsTable(db);

  const rows = await db.query<PriceVersionRow>(
    `SELECT * FROM price_versions
    WHERE sku_id = ?
      AND (store_id = ? OR store_id IS NULL)
      AND effective_from <= ?
    ORDER BY
      (store_id IS NULL) ASC,
      effective_from DESC,
      created_at DESC
    LIMIT 1`,
    [params.skuId, params.storeId, params.atTime],
  );

  return rows[0] ?? null;
}

export async function ensurePriceVersionsTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS price_versions (
      price_version_id TEXT PRIMARY KEY,
      sku_id TEXT NOT NULL,
      store_id TEXT,
      unit_price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'ZMW',
      effective_from TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
  await db.insert(
    `CREATE INDEX IF NOT EXISTS price_versions_lookup_idx
    ON price_versions (sku_id, store_id, effective_from, created_at)`,
  );
}
