import type { IDb } from "../db";
import type { CartState } from "./store";

// Held/parked sale (T068): local save + resume, same-device only (FR-006).
// `parked_sales` is a till-local-only table — it is never handed to
// SyncEngine/local_upload_queue and carries no `event_id`/`till_id`-scoped
// event row, so a parked sale can never be resumed from a different till;
// that's what makes this "same-device only" rather than a policy check.

export type ParkedSaleSummary = {
  parked_sale_id: string;
  till_id: string;
  cashier_id: string;
  label: string | null;
  parked_at: string;
};

export type ParkSaleParams = {
  tillId: string;
  storeId: string;
  cashierId: string;
  cart: CartState;
  label?: string | null;
};

export async function parkSale(db: IDb, params: ParkSaleParams): Promise<string> {
  await ensureParkedSalesTable(db);

  const parkedSaleId = crypto.randomUUID();
  await db.insert(
    `INSERT INTO parked_sales (
      parked_sale_id, till_id, store_id, cashier_id, label, cart_state, parked_at, resumed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      parkedSaleId,
      params.tillId,
      params.storeId,
      params.cashierId,
      params.label ?? null,
      JSON.stringify(params.cart),
      new Date().toISOString(),
    ],
  );
  return parkedSaleId;
}

export async function listParkedSales(db: IDb, tillId: string): Promise<ParkedSaleSummary[]> {
  await ensureParkedSalesTable(db);
  return db.query<ParkedSaleSummary>(
    `SELECT parked_sale_id, till_id, cashier_id, label, parked_at
    FROM parked_sales
    WHERE till_id = ? AND resumed_at IS NULL
    ORDER BY parked_at DESC`,
    [tillId],
  );
}

export async function resumeParkedSale(db: IDb, parkedSaleId: string): Promise<CartState> {
  await ensureParkedSalesTable(db);

  const rows = await db.query<{ cart_state: string }>(
    `SELECT cart_state FROM parked_sales WHERE parked_sale_id = ? AND resumed_at IS NULL`,
    [parkedSaleId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`resumeParkedSale: no parked sale found (or already resumed) for ${parkedSaleId}`);
  }

  await db.insert(`UPDATE parked_sales SET resumed_at = ? WHERE parked_sale_id = ?`, [new Date().toISOString(), parkedSaleId]);
  return JSON.parse(row.cart_state) as CartState;
}

export async function discardParkedSale(db: IDb, parkedSaleId: string): Promise<void> {
  await ensureParkedSalesTable(db);
  await db.insert(`DELETE FROM parked_sales WHERE parked_sale_id = ?`, [parkedSaleId]);
}

export async function ensureParkedSalesTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS parked_sales (
      parked_sale_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      label TEXT,
      cart_state TEXT NOT NULL,
      parked_at TEXT NOT NULL,
      resumed_at TEXT
    )`,
  );
  await db.insert(
    `CREATE INDEX IF NOT EXISTS parked_sales_till_idx ON parked_sales (till_id, resumed_at, parked_at)`,
  );
}
