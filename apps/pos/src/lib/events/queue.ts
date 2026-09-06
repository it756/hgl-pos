import type { ShiftEvent } from "@hgl/events";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import { calculateOverShort } from "../shift/cash-up";
import type { SyncEngine } from "../sync/engine";
import type { ReliableClock } from "../time/clock";
import { nextEventId } from "./id";
import { buildShiftCloseEvent, buildShiftOpenEvent } from "./shift";

// Persists shift_open / shift_close events locally and queues them for
// upload (T058). Also maintains the local `shifts` projection row
// optimistically so the till can answer "is a shift open right now"
// without waiting on a server round-trip — the same reason `shift_events`
// exists locally at all (offline-first, per US9 / EC-05's local-ledger
// pattern). `system_cash` / `over_short` written here are local estimates
// only; the authoritative figures are Postgres-generated columns computed
// from synced sale events and arrive once this row syncs back down.

export type ShiftRow = {
  shift_id: string;
  till_id: string;
  store_id: string;
  cashier_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  cash_counted: number | null;
  system_cash: number;
  over_short: number;
  status: "open" | "closed";
};

export type ShiftEventQueueOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  clock: ReliableClock;
  tillId: string;
  storeId: string;
  appVersion: string;
};

export type OpenShiftParams = {
  shiftId: string;
  cashierId: string;
  openingFloat: number;
};

export type CloseShiftParams = {
  shiftId: string;
  cashCounted: number;
  tenderBreakdown: Record<string, number>;
  notes: string | null;
};

export class ShiftEventQueue {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #clock: ReliableClock;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;

  constructor(options: ShiftEventQueueOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#clock = options.clock;
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureShiftTables(this.#db);
  }

  async openShift(params: OpenShiftParams): Promise<ShiftEvent> {
    await this.init();
    await this.#clock.assertFinancialClockAllowed();
    const clientTs = (await this.#clock.trustedNow()).toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const event = buildShiftOpenEvent({
      eventId,
      tillId: this.#tillId,
      storeId: this.#storeId,
      clientTs,
      appVersion: this.#appVersion,
      schemaVer: localSchemaVersion,
      shiftId: params.shiftId,
      cashierId: params.cashierId,
      openingFloat: params.openingFloat,
    });

    await this.#persistEvent(event);
    await this.#db.insert(
      `INSERT INTO shifts (
        shift_id, till_id, store_id, cashier_id, opened_at, closed_at,
        opening_float, cash_counted, system_cash, over_short, status
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, 0, 'open')
      ON CONFLICT(shift_id) DO NOTHING`,
      [params.shiftId, this.#tillId, this.#storeId, params.cashierId, clientTs, params.openingFloat],
    );

    await this.#syncEngine.enqueue(event);
    return event;
  }

  async closeShift(params: CloseShiftParams): Promise<ShiftEvent> {
    await this.init();
    await this.#clock.assertFinancialClockAllowed();

    const shift = await this.getShift(params.shiftId);
    if (shift === null) {
      throw new Error(`closeShift: no local shift row found for shift ${params.shiftId}`);
    }

    const clientTs = (await this.#clock.trustedNow()).toISOString();
    const eventId = await nextEventId(this.#db, this.#tillId);

    const event = buildShiftCloseEvent({
      eventId,
      tillId: this.#tillId,
      storeId: this.#storeId,
      clientTs,
      appVersion: this.#appVersion,
      schemaVer: localSchemaVersion,
      shiftId: params.shiftId,
      cashierId: shift.cashier_id,
      cashCounted: params.cashCounted,
      tenderBreakdown: params.tenderBreakdown,
      notes: params.notes,
    });

    await this.#persistEvent(event);

    const overShortEstimate = calculateOverShort({
      openingFloat: shift.opening_float,
      systemCash: shift.system_cash,
      cashCounted: params.cashCounted,
    });
    await this.#db.insert(
      `UPDATE shifts
      SET closed_at = ?, cash_counted = ?, over_short = ?, status = 'closed'
      WHERE shift_id = ?`,
      [clientTs, params.cashCounted, overShortEstimate, params.shiftId],
    );

    await this.#syncEngine.enqueue(event);
    return event;
  }

  async getOpenShift(): Promise<ShiftRow | null> {
    await this.init();
    const rows = await this.#db.query<ShiftRow>(
      `SELECT * FROM shifts WHERE till_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [this.#tillId],
    );
    return rows[0] ?? null;
  }

  async getShift(shiftId: string): Promise<ShiftRow | null> {
    await this.init();
    const rows = await this.#db.query<ShiftRow>(`SELECT * FROM shifts WHERE shift_id = ?`, [shiftId]);
    return rows[0] ?? null;
  }

  async #persistEvent(event: ShiftEvent): Promise<void> {
    await this.#db.insert(
      `INSERT INTO shift_events (
        event_id, till_id, store_id, client_ts, server_ts, app_version,
        schema_ver, shift_id, cashier_id, event_kind, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING`,
      [
        event.event_id,
        event.till_id,
        event.store_id,
        event.client_ts,
        event.client_ts,
        event.app_version,
        event.schema_ver,
        event.shift_id,
        event.cashier_id,
        event.event_kind,
        JSON.stringify(event.payload),
      ],
    );
  }
}

export async function ensureShiftTables(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS shift_events (
      event_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      client_ts TEXT NOT NULL,
      server_ts TEXT NOT NULL,
      app_version TEXT NOT NULL,
      schema_ver INTEGER NOT NULL,
      shift_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      event_kind TEXT NOT NULL CHECK (event_kind IN ('shift_open', 'shift_close')),
      payload TEXT NOT NULL,
      UNIQUE (shift_id, event_kind)
    )`,
  );

  await db.insert(
    `CREATE TABLE IF NOT EXISTS shifts (
      shift_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_float REAL NOT NULL,
      cash_counted REAL,
      system_cash REAL NOT NULL DEFAULT 0,
      over_short REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed'))
    )`,
  );

  await db.insert(`CREATE INDEX IF NOT EXISTS shifts_till_opened_idx ON shifts (till_id, opened_at)`);
  await db.insert(`CREATE INDEX IF NOT EXISTS shift_events_till_ts_idx ON shift_events (till_id, server_ts)`);
}
