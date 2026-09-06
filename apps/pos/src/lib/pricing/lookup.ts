import type { IDb } from "../db";

// Product lookup (T064): barcode -> SKU, SKU-code -> SKU, name-search.
// Pure query layer — no pricing/promotions logic here (see resolve.ts /
// promotions.ts). Catalog rows arrive via a not-yet-built HQ->till sync
// path; this module only owns the `skus` / `sku_barcodes` table DDL,
// following the per-module `ensureXTable` convention used elsewhere.

export type SkuRow = {
  sku_id: string;
  code: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  unit_type: "quantity" | "weight";
  track_batch: number | boolean;
  track_expiry: number | boolean;
  is_active: number | boolean;
};

export async function findSkuByBarcode(db: IDb, barcode: string): Promise<SkuRow | null> {
  await ensureSkuTables(db);

  // Most SKUs have a single barcode stored directly on `skus`; `sku_barcodes`
  // covers the (rarer) multi-barcode case, so it's checked first.
  const viaAlias = await db.query<SkuRow>(
    `SELECT s.* FROM sku_barcodes b
    JOIN skus s ON s.sku_id = b.sku_id
    WHERE b.barcode = ? AND s.is_active = 1
    LIMIT 1`,
    [barcode],
  );
  if (viaAlias[0] !== undefined) {
    return viaAlias[0];
  }

  const viaPrimary = await db.query<SkuRow>(`SELECT * FROM skus WHERE barcode = ? AND is_active = 1 LIMIT 1`, [barcode]);
  return viaPrimary[0] ?? null;
}

export async function findSkuByCode(db: IDb, code: string): Promise<SkuRow | null> {
  await ensureSkuTables(db);
  const rows = await db.query<SkuRow>(`SELECT * FROM skus WHERE code = ? AND is_active = 1 LIMIT 1`, [code]);
  return rows[0] ?? null;
}

export async function searchSkusByName(db: IDb, searchTerm: string, limit = 20): Promise<SkuRow[]> {
  await ensureSkuTables(db);
  const pattern = `%${escapeLikePattern(searchTerm)}%`;
  return db.query<SkuRow>(
    `SELECT * FROM skus WHERE is_active = 1 AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`,
    [pattern, limit],
  );
}

function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export async function ensureSkuTables(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS skus (
      sku_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      barcode TEXT,
      name TEXT NOT NULL,
      category_id TEXT,
      unit_type TEXT NOT NULL CHECK (unit_type IN ('quantity', 'weight')),
      track_batch INTEGER NOT NULL DEFAULT 0,
      track_expiry INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.insert(`CREATE UNIQUE INDEX IF NOT EXISTS skus_code_idx ON skus (code)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS skus_barcode_idx ON skus (barcode)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS skus_category_idx ON skus (category_id)`);

  await db.insert(
    `CREATE TABLE IF NOT EXISTS sku_barcodes (
      barcode TEXT PRIMARY KEY,
      sku_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS sku_barcodes_sku_idx ON sku_barcodes (sku_id)`);
}
