import { SyncHealthSnapshotSchema, type SyncHealthSnapshot } from "@hgl/events";
import { localSchemaVersion } from "../db/schema";
import type { IDb } from "../db/interface";
import type { SyncEngine } from "./engine";

export const MIN_SYNC_HEALTH_INTERVAL_MS = 10_000;

export type SyncHealthReporterOptions = {
  db: IDb;
  syncEngine: SyncEngine;
  endpoint: string;
  accessToken: () => Promise<string>;
  tillId: string;
  storeId: string;
  appVersion: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
};

export type SyncHealthScheduleOptions = {
  intervalMs?: number;
  signal?: AbortSignal;
};

export class SyncHealthReporter {
  readonly #db: IDb;
  readonly #syncEngine: SyncEngine;
  readonly #endpoint: string;
  readonly #accessToken: () => Promise<string>;
  readonly #tillId: string;
  readonly #storeId: string;
  readonly #appVersion: string;
  readonly #now: () => Date;
  readonly #fetch: typeof fetch;
  #lastSuccessfulSyncAt: string | null = null;
  #consecutiveFailures = 0;
  #lastPostAttemptAt = 0;

  constructor(options: SyncHealthReporterOptions) {
    this.#db = options.db;
    this.#syncEngine = options.syncEngine;
    this.#endpoint = options.endpoint;
    this.#accessToken = options.accessToken;
    this.#tillId = options.tillId;
    this.#storeId = options.storeId;
    this.#appVersion = options.appVersion;
    this.#now = options.now ?? (() => new Date());
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureSyncHealthLocalTable(this.#db);
  }

  async recordSnapshot(): Promise<SyncHealthSnapshot> {
    await this.init();

    const snapshot = SyncHealthSnapshotSchema.parse({
      snapshot_id: crypto.randomUUID(),
      till_id: this.#tillId,
      store_id: this.#storeId,
      client_ts: this.#now().toISOString(),
      queue_depth: await this.#syncEngine.queueDepth(),
      oldest_pending_event_at: await this.#syncEngine.oldestPendingEventAt(),
      last_successful_sync_at: this.#lastSuccessfulSyncAt,
      consecutive_failures: this.#consecutiveFailures,
      app_version: this.#appVersion,
      schema_version: localSchemaVersion,
    });

    await this.#db.insert(
      `INSERT INTO sync_health_local (
        snapshot_id,
        till_id,
        store_id,
        client_ts,
        queue_depth,
        oldest_pending_event_at,
        last_successful_sync_at,
        consecutive_failures,
        app_version,
        schema_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id) DO NOTHING`,
      [
        snapshot.snapshot_id,
        snapshot.till_id,
        snapshot.store_id,
        snapshot.client_ts,
        snapshot.queue_depth,
        snapshot.oldest_pending_event_at,
        snapshot.last_successful_sync_at,
        snapshot.consecutive_failures,
        snapshot.app_version,
        snapshot.schema_version,
      ],
    );

    return snapshot;
  }

  async flushOne(): Promise<boolean> {
    await this.init();

    const nowMs = this.#now().getTime();
    if (nowMs - this.#lastPostAttemptAt < MIN_SYNC_HEALTH_INTERVAL_MS) return false;

    const rows = await this.#db.query<SyncHealthLocalRow>(
      `SELECT snapshot_id, till_id, store_id, client_ts, queue_depth, oldest_pending_event_at,
        last_successful_sync_at, consecutive_failures, app_version, schema_version
      FROM sync_health_local
      WHERE sent_at IS NULL
      ORDER BY client_ts ASC
      LIMIT 1`,
    );
    const row = rows[0];
    if (row === undefined) return false;

    this.#lastPostAttemptAt = nowMs;
    const snapshot = SyncHealthSnapshotSchema.parse(row);

    try {
      await this.postSnapshot(snapshot);
      const sentAt = this.#now().toISOString();
      this.#lastSuccessfulSyncAt = sentAt;
      this.#consecutiveFailures = 0;
      await this.#db.insert("UPDATE sync_health_local SET sent_at = ? WHERE snapshot_id = ?", [sentAt, snapshot.snapshot_id]);
      return true;
    } catch (error) {
      this.#consecutiveFailures += 1;
      await this.#db.insert("UPDATE sync_health_local SET last_error = ? WHERE snapshot_id = ?", [errorMessage(error), snapshot.snapshot_id]);
      return false;
    }
  }

  start(options: SyncHealthScheduleOptions = {}): () => void {
    const intervalMs = Math.max(options.intervalMs ?? MIN_SYNC_HEALTH_INTERVAL_MS, MIN_SYNC_HEALTH_INTERVAL_MS);
    const intervalId = window.setInterval(() => {
      if (options.signal?.aborted) return;
      void this.recordSnapshot().then(() => this.flushOne());
    }, intervalMs);

    const stop = () => window.clearInterval(intervalId);
    options.signal?.addEventListener("abort", stop, { once: true });
    return stop;
  }

  async postSnapshot(snapshot: SyncHealthSnapshot): Promise<void> {
    const token = await this.#accessToken();
    const response = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new Error(`sync health snapshot failed: ${response.status} ${response.statusText}`);
    }
  }
}

export async function ensureSyncHealthLocalTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS sync_health_local (
      snapshot_id TEXT PRIMARY KEY,
      till_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      client_ts TEXT NOT NULL,
      queue_depth INTEGER NOT NULL DEFAULT 0 CHECK (queue_depth >= 0),
      oldest_pending_event_at TEXT,
      last_successful_sync_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
      app_version TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      sent_at TEXT,
      last_error TEXT
    )`,
  );
  await db.insert(
    `CREATE INDEX IF NOT EXISTS sync_health_local_unsent_idx
    ON sync_health_local (sent_at, client_ts)`,
  );
}

type SyncHealthLocalRow = SyncHealthSnapshot & {
  sent_at?: string | null;
  last_error?: string | null;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
