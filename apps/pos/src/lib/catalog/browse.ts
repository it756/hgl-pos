import type { IDb } from "../db";
import { ensureSkuTables, type SkuRow } from "../pricing/lookup";
import { ensurePriceVersionsTable, type PriceVersionRow } from "../pricing/resolve";
import { ensureStockTables } from "../events/sale";

// Till product browser (sale screen tile grid + category chips). Read-only.
// Deliberately composed from single-table queries joined in memory rather
// than one correlated SQL query: the till catalog is store-scoped (sync
// rules only ship stocked SKUs for this store), so it's small, and this
// keeps the price precedence identical to pricing/resolve.ts — store
// override over global, then latest effective_from, then latest created_at.

export type CategoryRow = {
  category_id: string;
  code: string;
  name: string;
};

export type SellableSku = {
  sku: SkuRow;
  /** null when no price version is effective yet — the SKU can't be sold. */
  price: PriceVersionRow | null;
  /** null when the stock projection has no row for this SKU at this store. */
  qtyOnHand: number | null;
};

export type BrowseCatalog = {
  categories: CategoryRow[];
  items: SellableSku[];
};

export async function loadBrowseCatalog(db: IDb, params: { storeId: string; atTime: string }): Promise<BrowseCatalog> {
  await ensureSkuTables(db);
  await ensurePriceVersionsTable(db);
  await ensureStockTables(db);
  await ensureSkuCategoriesTable(db);

  const [skus, prices, stock, categories] = await Promise.all([
    db.query<SkuRow>(`SELECT * FROM skus WHERE is_active = 1 ORDER BY name ASC`),
    db.query<PriceVersionRow>(
      `SELECT * FROM price_versions WHERE (store_id = ? OR store_id IS NULL) AND effective_from <= ?`,
      [params.storeId, params.atTime],
    ),
    db.query<{ sku_id: string; qty_on_hand: number }>(
      `SELECT sku_id, qty_on_hand FROM current_stock_by_store_sku WHERE store_id = ?`,
      [params.storeId],
    ),
    db.query<CategoryRow>(`SELECT category_id, code, name FROM sku_categories WHERE is_active = 1 ORDER BY name ASC`),
  ]);

  const bestPriceBySku = new Map<string, PriceVersionRow>();
  for (const candidate of prices) {
    const current = bestPriceBySku.get(candidate.sku_id);
    if (current === undefined || comparePriceVersions(candidate, current) < 0) {
      bestPriceBySku.set(candidate.sku_id, candidate);
    }
  }

  const stockBySku = new Map(stock.map((row) => [row.sku_id, Number(row.qty_on_hand)]));

  const items = skus.map((sku) => ({
    sku,
    price: bestPriceBySku.get(sku.sku_id) ?? null,
    qtyOnHand: stockBySku.get(sku.sku_id) ?? null,
  }));

  const usedCategoryIds = new Set(skus.map((sku) => sku.category_id).filter((id): id is string => id !== null));
  return {
    categories: categories.filter((category) => usedCategoryIds.has(category.category_id)),
    items,
  };
}

export function filterBrowseItems(
  items: SellableSku[],
  filter: { categoryId: string | null; search: string },
): SellableSku[] {
  const term = filter.search.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.categoryId !== null && item.sku.category_id !== filter.categoryId) return false;
    if (term === "") return true;
    return (
      item.sku.name.toLowerCase().includes(term) ||
      item.sku.code.toLowerCase().includes(term) ||
      (item.sku.barcode ?? "").toLowerCase().includes(term)
    );
  });
}

/** Negative when `a` should win over `b` (same ordering as resolvePrice's ORDER BY). */
function comparePriceVersions(a: PriceVersionRow, b: PriceVersionRow): number {
  const aGlobal = a.store_id === null ? 1 : 0;
  const bGlobal = b.store_id === null ? 1 : 0;
  if (aGlobal !== bGlobal) return aGlobal - bGlobal;
  if (a.effective_from !== b.effective_from) return a.effective_from > b.effective_from ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1;
  return 0;
}

export async function ensureSkuCategoriesTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS sku_categories (
      category_id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_category_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.insert(`CREATE UNIQUE INDEX IF NOT EXISTS sku_categories_code_idx ON sku_categories (code)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS sku_categories_parent_idx ON sku_categories (parent_category_id)`);
}
