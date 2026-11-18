import type { IDb } from "../db";

// Mints a short-lived Supabase-shaped JWT for PowerSync's fetch_credentials()
// (and any device-role-gated RPC) by exchanging the till's existing opaque
// device credential — see supabase/functions/mint-device-jwt and
// supabase/migrations/0021_device_session_rpc.sql. Deliberately does NOT go
// through a real Supabase Auth sign-in/session (see repo scope-out notes):
// the mint endpoint hand-signs the JWT itself, so there is no refresh_token,
// just re-mint before expiry using the same long-lived opaque credential.

export const DEVICE_SESSION_REFRESH_WINDOW_MS = 10 * 60 * 1_000;
export const DEFAULT_MINT_DEVICE_JWT_PATH = "/functions/v1/mint-device-jwt";

export type DeviceSessionState = {
  till_id: string;
  access_token: string;
  expires_at: string;
  minted_at: string;
};

export type MintDeviceJwtResponse = {
  access_token: string;
  expires_at: string;
};

export type DeviceSessionManagerOptions = {
  db: IDb;
  tillId: string;
  mintEndpointUrl: string;
  /** Supabase publishable/anon key — not secret, safe to bundle in app config. */
  anonKey: string;
  /** Reads the till's current opaque device credential (see DeviceCredentialManager.read()). */
  getCredential: () => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  refreshWindowMs?: number;
};

export class DeviceSessionManager {
  readonly #db: IDb;
  readonly #tillId: string;
  readonly #mintEndpointUrl: string;
  readonly #anonKey: string;
  readonly #getCredential: () => Promise<string>;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #refreshWindowMs: number;

  constructor(options: DeviceSessionManagerOptions) {
    this.#db = options.db;
    this.#tillId = options.tillId;
    this.#mintEndpointUrl = options.mintEndpointUrl;
    this.#anonKey = options.anonKey;
    this.#getCredential = options.getCredential;
    // Native fetch throws "Illegal invocation" unless bound to a Window-like receiver.
    this.#fetch = (options.fetchImpl ?? fetch).bind(globalThis);
    this.#now = options.now ?? (() => new Date());
    this.#refreshWindowMs = options.refreshWindowMs ?? DEVICE_SESSION_REFRESH_WINDOW_MS;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureDeviceSessionTable(this.#db);
  }

  async read(): Promise<DeviceSessionState | null> {
    await this.init();
    const rows = await this.#db.query<DeviceSessionState>(
      `SELECT till_id, access_token, expires_at, minted_at
      FROM local_device_session
      WHERE till_id = ?`,
      [this.#tillId],
    );
    return rows[0] ?? null;
  }

  async save(response: MintDeviceJwtResponse): Promise<DeviceSessionState> {
    const state = toSessionState(this.#tillId, response, this.#now());
    await this.init();
    await this.#db.insert(
      `INSERT INTO local_device_session (till_id, access_token, expires_at, minted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(till_id) DO UPDATE SET
        access_token = excluded.access_token,
        expires_at = excluded.expires_at,
        minted_at = excluded.minted_at`,
      [state.till_id, state.access_token, state.expires_at, state.minted_at],
    );
    return state;
  }

  shouldRefresh(state: DeviceSessionState | null = null): boolean {
    if (state === null) return true;

    const expiresAt = new Date(state.expires_at).getTime();
    if (Number.isNaN(expiresAt)) return true;

    return expiresAt - this.#now().getTime() <= this.#refreshWindowMs;
  }

  async mint(): Promise<DeviceSessionState> {
    const credential = await this.#getCredential();
    const response = await this.#fetch(this.#mintEndpointUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#anonKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ till_id: this.#tillId, credential }),
    });

    if (!response.ok) {
      throw new Error(`device session mint failed with HTTP ${response.status}`);
    }

    return this.save(parseMintResponse(await response.json()));
  }

  async mintIfDue(): Promise<DeviceSessionState | null> {
    const current = await this.read();
    if (!this.shouldRefresh(current)) return current;
    return this.mint();
  }
}

export async function ensureDeviceSessionTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_device_session (
      till_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      minted_at TEXT NOT NULL
    )`,
  );
}

function parseMintResponse(value: unknown): MintDeviceJwtResponse {
  if (!isRecord(value) || typeof value.access_token !== "string" || typeof value.expires_at !== "string") {
    throw new Error("device session mint response is invalid");
  }

  const expiresAt = new Date(value.expires_at).getTime();
  if (Number.isNaN(expiresAt)) {
    throw new Error("device session mint response has invalid expires_at");
  }

  return { access_token: value.access_token, expires_at: value.expires_at };
}

function toSessionState(tillId: string, response: MintDeviceJwtResponse, now: Date): DeviceSessionState {
  return {
    till_id: tillId,
    access_token: response.access_token,
    expires_at: response.expires_at,
    minted_at: now.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
