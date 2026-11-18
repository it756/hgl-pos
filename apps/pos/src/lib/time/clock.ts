import type { IDb } from "../db";

export const NTP_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1_000;
export const MAX_FINANCIAL_CLOCK_DRIFT_MS = 15 * 60 * 1_000;
export const CLOCK_STATE_KEY = "reliable-clock";

export type ClockState = {
  key: typeof CLOCK_STATE_KEY;
  network_time_at_sync: string;
  local_time_at_sync: string;
  offset_ms: number;
  synced_at: string;
};

export type NetworkTimeSource = {
  now(signal?: AbortSignal): Promise<Date>;
};

export type ReliableClockOptions = {
  db: IDb;
  networkTime: NetworkTimeSource;
  now?: () => Date;
};

export type ClockAssessment = {
  allowed: boolean;
  reason: "ok" | "missing_sync" | "sync_stale" | "drift_exceeded";
  driftMs: number | null;
  syncedAt: string | null;
};

export class HttpDateHeaderTimeSource implements NetworkTimeSource {
  readonly #url: string;
  readonly #fetch: typeof fetch;

  constructor(url: string, fetchImpl: typeof fetch = fetch) {
    this.#url = url;
    // Native `fetch` throws "Illegal invocation" if called with a receiver
    // other than `window`/`globalThis` — binding here means callers can
    // safely invoke it as `this.#fetch(...)` (a mock fetchImpl in tests is
    // unaffected by this, which is why no test caught it).
    this.#fetch = fetchImpl.bind(globalThis);
  }

  async now(signal?: AbortSignal): Promise<Date> {
    // Reads the trusted timestamp from the JSON body (supabase/functions/
    // server-time), not a `Date` response header — `Date` isn't a
    // CORS-safelisted response header, so a cross-origin browser fetch
    // (till app vs Supabase are different origins/ports) can't read it via
    // response.headers.get("date") unless the server also sends
    // `Access-Control-Expose-Headers: Date`, which Supabase's own endpoints
    // do not. Response bodies have no such restriction.
    const response = await this.#fetch(this.#url, { method: "GET", cache: "no-store", signal });
    if (!response.ok) {
      throw new Error(`network time endpoint returned HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const now = typeof body === "object" && body !== null && "now" in body ? body.now : undefined;
    if (typeof now !== "string") {
      throw new Error('network time response did not include a valid "now" field');
    }

    const networkTime = new Date(now);
    if (Number.isNaN(networkTime.getTime())) {
      throw new Error("network time response included an invalid timestamp");
    }

    return networkTime;
  }
}

export class ReliableClock {
  readonly #db: IDb;
  readonly #networkTime: NetworkTimeSource;
  readonly #now: () => Date;

  constructor(options: ReliableClockOptions) {
    this.#db = options.db;
    this.#networkTime = options.networkTime;
    this.#now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureClockStateTable(this.#db);
  }

  async sync(signal?: AbortSignal): Promise<ClockState> {
    await this.init();

    const localBefore = this.#now().getTime();
    const networkTime = await this.#networkTime.now(signal);
    const localAfter = this.#now().getTime();
    const localMidpoint = new Date(Math.floor((localBefore + localAfter) / 2));
    const offsetMs = networkTime.getTime() - localMidpoint.getTime();
    const syncedAt = this.#now().toISOString();

    const state: ClockState = {
      key: CLOCK_STATE_KEY,
      network_time_at_sync: networkTime.toISOString(),
      local_time_at_sync: localMidpoint.toISOString(),
      offset_ms: offsetMs,
      synced_at: syncedAt,
    };

    await this.#db.insert(
      `INSERT INTO local_clock_state (key, network_time_at_sync, local_time_at_sync, offset_ms, synced_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        network_time_at_sync = excluded.network_time_at_sync,
        local_time_at_sync = excluded.local_time_at_sync,
        offset_ms = excluded.offset_ms,
        synced_at = excluded.synced_at`,
      [state.key, state.network_time_at_sync, state.local_time_at_sync, state.offset_ms, state.synced_at],
    );

    return state;
  }

  async assessFinancialClock(): Promise<ClockAssessment> {
    const state = await this.readState();
    if (state === null) {
      return { allowed: false, reason: "missing_sync", driftMs: null, syncedAt: null };
    }

    const localSyncedAt = new Date(state.local_time_at_sync).getTime();
    const elapsedMs = this.#now().getTime() - localSyncedAt;
    if (elapsedMs > NTP_SYNC_INTERVAL_MS) {
      return { allowed: false, reason: "sync_stale", driftMs: Math.abs(state.offset_ms), syncedAt: state.synced_at };
    }

    const driftMs = Math.abs(state.offset_ms);
    if (driftMs > MAX_FINANCIAL_CLOCK_DRIFT_MS) {
      return { allowed: false, reason: "drift_exceeded", driftMs, syncedAt: state.synced_at };
    }

    return { allowed: true, reason: "ok", driftMs, syncedAt: state.synced_at };
  }

  async assertFinancialClockAllowed(): Promise<void> {
    const assessment = await this.assessFinancialClock();
    if (assessment.allowed) return;

    throw new Error(`financial event clock guard blocked write: ${assessment.reason}`);
  }

  async trustedNow(): Promise<Date> {
    const state = await this.readState();
    if (state === null) {
      throw new Error("trusted clock is unavailable until network time sync completes");
    }

    return new Date(this.#now().getTime() + state.offset_ms);
  }

  async readState(): Promise<ClockState | null> {
    await this.init();
    const rows = await this.#db.query<ClockState>(
      `SELECT key, network_time_at_sync, local_time_at_sync, offset_ms, synced_at
      FROM local_clock_state
      WHERE key = ?`,
      [CLOCK_STATE_KEY],
    );
    return rows[0] ?? null;
  }
}

export async function ensureClockStateTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_clock_state (
      key TEXT PRIMARY KEY,
      network_time_at_sync TEXT NOT NULL,
      local_time_at_sync TEXT NOT NULL,
      offset_ms INTEGER NOT NULL,
      synced_at TEXT NOT NULL
    )`,
  );
}
