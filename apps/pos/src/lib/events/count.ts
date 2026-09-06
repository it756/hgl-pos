import { StockEventSchema, type StockEvent } from "@hgl/events";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "../sync/engine";
import { nextEventId } from "./id";

// Till-side stock count / count-correction (T090/T091). Delta is computed
// against the till's full local ledger — including this till's own
// not-yet-synced pending stock_events, per EC-05 — not a stale cached
// total. `stock_events` here is the same local mirror table used for
// reading synced-down history once sync is wired (see events/queue.ts's
// header comment on the equivalent `shifts`/`shift_events` gap); until
// then this simply reflects whatever this till has locally recorded.

export type RecordCountParams = {
  skuId: string;
  countedQty: number;
  reasonCode: string;
  notes: string | null;
};

export type CountCorrectionQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  now?: () => Date;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export class CountCorrectionQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #now: () => Date;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: CountCorrectionQueueOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#now = options.now ?? (() => new Date());
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureStockEventsTable(this.#db);
  }

  async getLedgerQty(skuId: string): Promise<number> {
    await this.init();
    const rows = await this.#db.query<{ total: number | null }>(
      `SELECT SUM(delta_qty) AS total FROM stock_events WHERE store_id = ? AND sku_id = ?`,
      [this.#storeId, skuId],
    );
    return rows[0]?.total ?? 0;
  }

  async recordCount(params: RecordCountParams): Promise<StockEvent> {
    await this.init();

    const ledgerQty = await this.getLedgerQty(params.skuId);
    const deltaQty = params.countedQty - ledgerQty;
    const clientTs = this.#now().toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const event = StockEventSchema.parse({
      event_id: eventId,
      till_id: this.#tillId,
      store_id: this.#storeId,
      client_ts: clientTs,
      app_version: this.#appVersion,
      schema_ver: localSchemaVersion,
      kind: "stock",
      sku_id: params.skuId,
      event_type: "count_correction",
      delta_qty: deltaQty,
      source_ref_id: null,
      batch_no: null,
      expiry_date: null,
      reason_code: params.reasonCode,
      notes: params.notes,
    });

    await this.#persistEvent(event);
    await this.#syncEngine.enqueue(event);
    return event;
  }

  async #persistEvent(event: StockEvent): Promise<void> {
    await this.#db.insert(
      `INSERT INTO stock_events (
        event_id, till_id, store_id, client_ts, server_ts, app_version,
        schema_ver, sku_id, event_type, delta_qty, source_ref_id, batch_no,
        expiry_date, reason_code, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING`,
      [
        event.event_id,
        event.till_id,
        event.store_id,
        event.client_ts,
        event.client_ts,
        event.app_version,
        event.schema_ver,
        event.sku_id,
        event.event_type,
        event.delta_qty,
        event.source_ref_id,
        event.batch_no,
        event.expiry_date,
        event.reason_code,
        event.notes,
      ],
    );
  }
}

export async function ensureStockEventsTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS stock_events (
      event_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      client_ts TEXT NOT NULL,
      server_ts TEXT NOT NULL,
      app_version TEXT NOT NULL,
      schema_ver INTEGER NOT NULL,
      sku_id TEXT NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'sale', 'refund', 'transfer_out', 'transfer_in', 'transfer_variance', 'adjustment', 'count_correction'
      )),
      delta_qty REAL NOT NULL,
      source_ref_id TEXT,
      batch_no TEXT,
      expiry_date TEXT,
      reason_code TEXT,
      notes TEXT
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS stock_events_store_sku_idx ON stock_events (store_id, sku_id)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS stock_events_till_ts_idx ON stock_events (till_id, server_ts)`);
}
