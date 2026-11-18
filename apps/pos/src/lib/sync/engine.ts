import { AnyTillEventSchema, type AnyTillEvent } from "@hgl/events";
import type { IDb } from "../db";

// EC-15 concrete numbers (T113 verified these already match — no change
// needed): batches capped at 100 events, 250 ms pause between batches,
// backoff starting at >= 30 s on attempt 1 and growing geometrically to a
// 5 min cap (see calculateBackoffDelayMs below for the jitter/growth math).
export const MAX_UPLOAD_BATCH_SIZE = 100;
export const BATCH_PAUSE_MS = 250;
export const INITIAL_BACKOFF_MS = 30_000;
export const MAX_BACKOFF_MS = 300_000;

export type UploadQueueStatus = "pending" | "uploading" | "failed" | "uploaded";

export type UploadQueueRow = {
  queue_id: string;
  event_id: string;
  event_kind: AnyTillEvent["kind"];
  payload: string;
  status: UploadQueueStatus;
  attempt_count: number;
  created_at: string;
  next_attempt_at: string;
};

export type SyncUploader = {
  upload(events: AnyTillEvent[]): Promise<void>;
  /**
   * Optional per-event upload. When implemented, drainOnce() uses this
   * instead of upload() so one permanently-failing event (e.g. a duplicate
   * that will always 409) can't block every other queued event behind it
   * from ever being marked uploaded — each row gets its own outcome/backoff.
   * Uploaders that only implement upload() keep today's all-or-nothing
   * batch behavior unchanged.
   */
  uploadOne?(event: AnyTillEvent): Promise<void>;
};

export type SyncEngineOptions = {
  db: IDb;
  uploader: SyncUploader;
  now?: () => Date;
  random?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
};

export type DrainResult = {
  attempted: number;
  uploaded: number;
  failed: number;
  nextAttemptAt: string | null;
};

export class SyncEngine {
  readonly #db: IDb;
  readonly #uploader: SyncUploader;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #pause: (milliseconds: number) => Promise<void>;

  constructor(options: SyncEngineOptions) {
    this.#db = options.db;
    this.#uploader = options.uploader;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#pause = options.pause ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureUploadQueueTable(this.#db);
  }

  async enqueue(event: AnyTillEvent): Promise<void> {
    const parsedEvent = AnyTillEventSchema.parse(event);
    const nowIso = this.#now().toISOString();

    await this.init();
    await this.#db.insert(
      `INSERT INTO local_upload_queue (
        queue_id,
        event_id,
        event_kind,
        payload,
        status,
        attempt_count,
        created_at,
        next_attempt_at
      ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(event_id) DO NOTHING`,
      [crypto.randomUUID(), parsedEvent.event_id, parsedEvent.kind, JSON.stringify(parsedEvent), nowIso, nowIso],
    );
  }

  async drainOnce(): Promise<DrainResult> {
    await this.init();

    const nowIso = this.#now().toISOString();
    const rows = await this.#db.query<UploadQueueRow>(
      `SELECT queue_id, event_id, event_kind, payload, status, attempt_count, created_at, next_attempt_at
      FROM local_upload_queue
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
      [nowIso, MAX_UPLOAD_BATCH_SIZE],
    );

    if (rows.length === 0) {
      return { attempted: 0, uploaded: 0, failed: 0, nextAttemptAt: null };
    }

    const events = rows.map((row) => AnyTillEventSchema.parse(JSON.parse(row.payload)));
    await this.markUploading(rows, nowIso);

    if (this.#uploader.uploadOne) {
      return this.#drainPerEvent(rows, events, this.#uploader.uploadOne.bind(this.#uploader));
    }

    try {
      await this.#uploader.upload(events);
      const uploadedAt = this.#now().toISOString();
      await this.markUploaded(rows, uploadedAt);
      await this.#pause(BATCH_PAUSE_MS);

      return { attempted: rows.length, uploaded: rows.length, failed: 0, nextAttemptAt: null };
    } catch (error) {
      const failedAt = this.#now();
      const retryDelay = calculateBackoffDelayMs(nextAttemptNumber(rows), this.#random);
      const nextAttemptAt = new Date(failedAt.getTime() + retryDelay).toISOString();
      await this.markFailed(rows, nextAttemptAt, errorMessage(error));

      return { attempted: rows.length, uploaded: 0, failed: rows.length, nextAttemptAt };
    }
  }

  async #drainPerEvent(
    rows: UploadQueueRow[],
    events: AnyTillEvent[],
    uploadOne: (event: AnyTillEvent) => Promise<void>,
  ): Promise<DrainResult> {
    let uploaded = 0;
    let failed = 0;
    let nextAttemptAt: string | null = null;

    const pairs = rows.map((row, index) => ({ row, event: events[index] }));
    for (const { row, event } of pairs) {
      if (event === undefined) continue;
      try {
        await uploadOne(event);
        uploaded += 1;
        await this.markUploaded([row], this.#now().toISOString());
      } catch (error) {
        failed += 1;
        const retryDelay = calculateBackoffDelayMs(row.attempt_count + 1, this.#random);
        const rowNextAttemptAt = new Date(this.#now().getTime() + retryDelay).toISOString();
        nextAttemptAt = nextAttemptAt === null ? rowNextAttemptAt : nextAttemptAt;
        await this.markFailed([row], rowNextAttemptAt, errorMessage(error));
      }
    }

    await this.#pause(BATCH_PAUSE_MS);
    return { attempted: rows.length, uploaded, failed, nextAttemptAt };
  }

  async queueDepth(): Promise<number> {
    await this.init();
    return readQueueDepth(this.#db);
  }

  async oldestPendingEventAt(): Promise<string | null> {
    await this.init();
    return readOldestPendingEventAt(this.#db);
  }

  async resetStaleUploading(cutoffIso: string): Promise<void> {
    await this.init();
    await this.#db.insert(
      `UPDATE local_upload_queue
      SET status = 'failed', locked_at = NULL, last_error = 'upload reset after app restart'
      WHERE status = 'uploading'
        AND locked_at <= ?`,
      [cutoffIso],
    );
  }

  async markUploading(rows: UploadQueueRow[], lockedAt: string): Promise<void> {
    for (const row of rows) {
      await this.#db.insert(
        `UPDATE local_upload_queue
        SET status = 'uploading', attempt_count = attempt_count + 1, locked_at = ?, last_error = NULL
        WHERE queue_id = ?`,
        [lockedAt, row.queue_id],
      );
    }
  }

  async markUploaded(rows: UploadQueueRow[], uploadedAt: string): Promise<void> {
    for (const row of rows) {
      await this.#db.insert(
        `UPDATE local_upload_queue
        SET status = 'uploaded', uploaded_at = ?, locked_at = NULL, last_error = NULL
        WHERE queue_id = ?`,
        [uploadedAt, row.queue_id],
      );
    }
  }

  async markFailed(rows: UploadQueueRow[], nextAttemptAt: string, lastError: string): Promise<void> {
    for (const row of rows) {
      await this.#db.insert(
        `UPDATE local_upload_queue
        SET status = 'failed', next_attempt_at = ?, locked_at = NULL, last_error = ?
        WHERE queue_id = ?`,
        [nextAttemptAt, lastError, row.queue_id],
      );
    }
  }
}

export async function ensureUploadQueueTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_upload_queue (
      queue_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL UNIQUE,
      event_kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'failed', 'uploaded')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      created_at TEXT NOT NULL,
      next_attempt_at TEXT NOT NULL,
      locked_at TEXT,
      uploaded_at TEXT,
      last_error TEXT
    )`,
  );
  await db.insert(
    `CREATE INDEX IF NOT EXISTS local_upload_queue_pending_idx
    ON local_upload_queue (status, next_attempt_at, created_at)`,
  );
}

export function calculateBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const boundedAttempt = Math.max(1, Math.floor(attempt));
  const baseDelay = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** (boundedAttempt - 1));
  const jitter = Math.floor(baseDelay * 0.2 * random());
  return Math.min(MAX_BACKOFF_MS, baseDelay + jitter);
}

// Read-only queue stats usable without a SyncEngine instance (e.g. a UI status badge).
export async function readQueueDepth(db: IDb): Promise<number> {
  await ensureUploadQueueTable(db);
  const rows = await db.query<{ count: number }>(
    "SELECT COUNT(*) as count FROM local_upload_queue WHERE status IN ('pending', 'uploading', 'failed')",
  );
  return rows[0]?.count ?? 0;
}

export async function readOldestPendingEventAt(db: IDb): Promise<string | null> {
  await ensureUploadQueueTable(db);
  const rows = await db.query<{ created_at: string | null }>(
    "SELECT MIN(created_at) as created_at FROM local_upload_queue WHERE status IN ('pending', 'uploading', 'failed')",
  );
  return rows[0]?.created_at ?? null;
}

function nextAttemptNumber(rows: UploadQueueRow[]): number {
  return Math.max(...rows.map((row) => row.attempt_count + 1), 1);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
