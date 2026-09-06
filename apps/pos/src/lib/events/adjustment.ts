import { AdjustmentEventSchema, type AdjustmentEvent } from "@hgl/events";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "../sync/engine";
import { nextEventId } from "./id";

// Till-side adjustment request (T092). Requests never touch stock directly
// (FR-017) — only an `adjustment_approved` event (written by a manager via
// the admin console, apps/admin/src/lib/adjustments/service.ts) causes a
// companion stock_events row, via the projection trigger from T024.

export type RequestAdjustmentParams = {
  skuId: string;
  deltaQty: number;
  reasonCode: string;
  notes: string | null;
  requestedByUserId: string;
};

export type AdjustmentRequestQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  now?: () => Date;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export class AdjustmentRequestQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #now: () => Date;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: AdjustmentRequestQueueOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#now = options.now ?? (() => new Date());
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureAdjustmentEventsTable(this.#db);
  }

  async requestAdjustment(params: RequestAdjustmentParams): Promise<AdjustmentEvent> {
    await this.init();

    const clientTs = this.#now().toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const event = AdjustmentEventSchema.parse({
      event_id: eventId,
      till_id: this.#tillId,
      store_id: this.#storeId,
      client_ts: clientTs,
      app_version: this.#appVersion,
      schema_ver: localSchemaVersion,
      kind: "adjustment",
      adjustment_id: crypto.randomUUID(),
      event_kind: "adjustment_requested",
      sku_id: params.skuId,
      delta_qty: params.deltaQty,
      reason_code: params.reasonCode,
      requested_by_user_id: params.requestedByUserId,
      approver_user_id: null,
      notes: params.notes,
    });

    await this.#persistEvent(event);
    await this.#syncEngine.enqueue(event);
    return event;
  }

  async #persistEvent(event: AdjustmentEvent): Promise<void> {
    await this.#db.insert(
      `INSERT INTO adjustment_events (
        event_id, till_id, store_id, client_ts, server_ts, app_version,
        schema_ver, adjustment_id, event_kind, sku_id, delta_qty,
        reason_code, requested_by_user_id, approver_user_id, notes
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
        event.adjustment_id,
        event.event_kind,
        event.sku_id,
        event.delta_qty,
        event.reason_code,
        event.requested_by_user_id,
        event.approver_user_id,
        event.notes,
      ],
    );
  }
}

export async function ensureAdjustmentEventsTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS adjustment_events (
      event_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      client_ts TEXT NOT NULL,
      server_ts TEXT NOT NULL,
      app_version TEXT NOT NULL,
      schema_ver INTEGER NOT NULL,
      adjustment_id TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('adjustment_requested', 'adjustment_approved', 'adjustment_rejected')),
      sku_id TEXT NOT NULL,
      delta_qty REAL NOT NULL,
      reason_code TEXT NOT NULL,
      requested_by_user_id TEXT NOT NULL,
      approver_user_id TEXT,
      notes TEXT
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS adjustment_events_adjustment_id_idx ON adjustment_events (adjustment_id)`);
}
