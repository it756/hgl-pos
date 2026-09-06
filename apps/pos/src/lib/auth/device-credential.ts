import type { IDb } from "../db";

export const DEVICE_CREDENTIAL_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_DEVICE_CREDENTIAL_ROTATE_PATH = "/auth/device-credential/rotate";

export type DeviceCredentialState = {
  till_id: string;
  credential: string;
  expires_at: string;
  rotated_at: string;
};

export type RotateDeviceCredentialResponse = {
  credential: string;
  expires_at: string;
};

export type DeviceCredentialManagerOptions = {
  db: IDb;
  tillId: string;
  rotateEndpointUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  authorizationToken?: (currentCredential: string) => Promise<string> | string;
  refreshWindowMs?: number;
};

export class DeviceCredentialManager {
  readonly #db: IDb;
  readonly #tillId: string;
  readonly #rotateEndpointUrl: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #authorizationToken: (currentCredential: string) => Promise<string> | string;
  readonly #refreshWindowMs: number;

  constructor(options: DeviceCredentialManagerOptions) {
    this.#db = options.db;
    this.#tillId = options.tillId;
    this.#rotateEndpointUrl = options.rotateEndpointUrl;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.#authorizationToken = options.authorizationToken ?? ((currentCredential) => currentCredential);
    this.#refreshWindowMs = options.refreshWindowMs ?? DEVICE_CREDENTIAL_REFRESH_WINDOW_MS;
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureDeviceCredentialTable(this.#db);
  }

  async read(): Promise<DeviceCredentialState | null> {
    await this.init();
    const rows = await this.#db.query<DeviceCredentialState>(
      `SELECT till_id, credential, expires_at, rotated_at
      FROM local_device_credential
      WHERE till_id = ?`,
      [this.#tillId],
    );
    return rows[0] ?? null;
  }

  async save(response: RotateDeviceCredentialResponse): Promise<DeviceCredentialState> {
    const state = toCredentialState(this.#tillId, response, this.#now());
    await this.init();
    await this.#db.insert(
      `INSERT INTO local_device_credential (till_id, credential, expires_at, rotated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(till_id) DO UPDATE SET
        credential = excluded.credential,
        expires_at = excluded.expires_at,
        rotated_at = excluded.rotated_at`,
      [state.till_id, state.credential, state.expires_at, state.rotated_at],
    );
    return state;
  }

  shouldRotate(state: DeviceCredentialState | null = null): boolean {
    if (state === null) return true;

    const expiresAt = new Date(state.expires_at).getTime();
    if (Number.isNaN(expiresAt)) return true;

    return expiresAt - this.#now().getTime() <= this.#refreshWindowMs;
  }

  async rotate(): Promise<DeviceCredentialState> {
    const current = await this.read();
    if (current === null) {
      throw new Error("device credential rotation requires an existing credential");
    }

    const authorizationToken = await this.#authorizationToken(current.credential);
    const response = await this.#fetch(this.#rotateEndpointUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authorizationToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ till_id: this.#tillId, current_credential: current.credential }),
    });

    if (!response.ok) {
      throw new Error(`device credential rotation failed with HTTP ${response.status}`);
    }

    return this.save(parseRotateResponse(await response.json()));
  }

  async rotateIfDue(): Promise<DeviceCredentialState | null> {
    const current = await this.read();
    if (!this.shouldRotate(current)) return current;
    return this.rotate();
  }
}

export async function ensureDeviceCredentialTable(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_device_credential (
      till_id TEXT PRIMARY KEY,
      credential TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      rotated_at TEXT NOT NULL
    )`,
  );
}

function parseRotateResponse(value: unknown): RotateDeviceCredentialResponse {
  if (!isRecord(value) || typeof value.credential !== "string" || typeof value.expires_at !== "string") {
    throw new Error("device credential rotation response is invalid");
  }

  const expiresAt = new Date(value.expires_at).getTime();
  if (Number.isNaN(expiresAt)) {
    throw new Error("device credential rotation response has invalid expires_at");
  }

  return { credential: value.credential, expires_at: value.expires_at };
}

function toCredentialState(tillId: string, response: RotateDeviceCredentialResponse, now: Date): DeviceCredentialState {
  return {
    till_id: tillId,
    credential: response.credential,
    expires_at: response.expires_at,
    rotated_at: now.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
