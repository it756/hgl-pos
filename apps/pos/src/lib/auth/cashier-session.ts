import type { IDb } from "../db";
import { verifyPin } from "./pin";

// Offline cashier login (T054). PIN verification is entirely local against
// the cached `users` roster (synced down from HQ per FR-042/EC-14); lockout
// state is local SQLite so it cannot be reset by taking the till offline
// (FR-043).

export const MAX_FAILED_PIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 1_000;
export const CASHIER_SESSION_KEY = "current-cashier-session";

export type CashierRole = "cashier" | "store_manager" | "hq_admin";

export type CashierRosterEntry = {
  user_id: string;
  full_name: string;
  role: CashierRole;
};

export type CashierUserRow = {
  user_id: string;
  role: CashierRole;
  store_id: string | null;
  full_name: string;
  pin_hash: string;
  is_active: number | boolean;
};

export type CashierSession = {
  key: typeof CASHIER_SESSION_KEY;
  user_id: string;
  full_name: string;
  role: CashierRole;
  store_id: string | null;
  logged_in_at: string;
};

export type LoginResult =
  | { ok: true; session: CashierSession }
  | { ok: false; reason: "not_found" | "inactive" | "locked" | "invalid_pin"; lockedUntil?: string };

export type SupervisorIdentity = {
  user_id: string;
  full_name: string;
  role: CashierRole;
};

/** Manager-override gate (void item/void sale/suspend) — checked against the
 * full active store_manager/hq_admin roster, independent of who is currently
 * logged in as cashier. */
export async function verifySupervisorPin(db: IDb, pin: string): Promise<SupervisorIdentity | null> {
  await ensureCashierSessionTables(db);
  const candidates = await db.query<CashierUserRow>(
    `SELECT * FROM users WHERE role IN ('store_manager', 'hq_admin') AND is_active = 1`,
  );
  for (const candidate of candidates) {
    if (await verifyPin(pin, candidate.pin_hash)) {
      return { user_id: candidate.user_id, full_name: candidate.full_name, role: candidate.role };
    }
  }
  return null;
}

export type CashierSessionManagerOptions = {
  db: IDb;
  now?: () => Date;
};

type LockoutRow = {
  user_id: string;
  failed_attempts: number;
  locked_until: string | null;
};

export class CashierSessionManager {
  readonly #db: IDb;
  readonly #now: () => Date;

  constructor(options: CashierSessionManagerOptions) {
    this.#db = options.db;
    this.#now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    await this.#db.init();
    await ensureCashierSessionTables(this.#db);
  }

  async listActiveCashiers(): Promise<CashierRosterEntry[]> {
    await this.init();
    // No storeId filter: the local `users` table only ever holds the roster
    // for this till's own store (populated by the store_users PowerSync
    // bucket, parameterized by the till's own store_id — see
    // contracts/powersync-sync-rules.yaml), so no additional scoping is
    // needed client-side.
    return this.#db.query<CashierRosterEntry>(
      `SELECT user_id, full_name, role FROM users
      WHERE is_active = 1 AND role IN ('cashier', 'store_manager')
      ORDER BY full_name`,
    );
  }

  async login(userId: string, pin: string): Promise<LoginResult> {
    await this.init();

    const lockout = await this.#readLockout(userId);
    if (lockout?.locked_until !== null && lockout?.locked_until !== undefined) {
      if (new Date(lockout.locked_until).getTime() > this.#now().getTime()) {
        return { ok: false, reason: "locked", lockedUntil: lockout.locked_until };
      }
    }

    const users = await this.#db.query<CashierUserRow>(`SELECT * FROM users WHERE user_id = ?`, [userId]);
    const user = users[0];
    if (user === undefined) {
      return { ok: false, reason: "not_found" };
    }
    if (!user.is_active) {
      return { ok: false, reason: "inactive" };
    }

    const valid = await verifyPin(pin, user.pin_hash);
    if (!valid) {
      const lockedUntil = await this.#recordFailedAttempt(userId, lockout);
      return lockedUntil === null
        ? { ok: false, reason: "invalid_pin" }
        : { ok: false, reason: "locked", lockedUntil };
    }

    await this.#clearLockout(userId);

    const session: CashierSession = {
      key: CASHIER_SESSION_KEY,
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role,
      store_id: user.store_id,
      logged_in_at: this.#now().toISOString(),
    };
    await this.#persistSession(session);

    return { ok: true, session };
  }

  async getCurrentSession(): Promise<CashierSession | null> {
    await this.init();
    const rows = await this.#db.query<CashierSession>(
      `SELECT * FROM local_cashier_session WHERE key = ?`,
      [CASHIER_SESSION_KEY],
    );
    return rows[0] ?? null;
  }

  async logout(): Promise<void> {
    await this.init();
    await this.#db.insert(`DELETE FROM local_cashier_session WHERE key = ?`, [CASHIER_SESSION_KEY]);
  }

  async #readLockout(userId: string): Promise<LockoutRow | null> {
    const rows = await this.#db.query<LockoutRow>(
      `SELECT user_id, failed_attempts, locked_until FROM local_login_lockout WHERE user_id = ?`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async #recordFailedAttempt(userId: string, existing: LockoutRow | null): Promise<string | null> {
    const failedAttempts = (existing?.failed_attempts ?? 0) + 1;
    const lockedUntil =
      failedAttempts >= MAX_FAILED_PIN_ATTEMPTS
        ? new Date(this.#now().getTime() + LOCKOUT_DURATION_MS).toISOString()
        : null;

    await this.#db.insert(
      `INSERT INTO local_login_lockout (user_id, failed_attempts, locked_until)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        failed_attempts = excluded.failed_attempts,
        locked_until = excluded.locked_until`,
      [userId, failedAttempts, lockedUntil],
    );

    return lockedUntil;
  }

  async #clearLockout(userId: string): Promise<void> {
    await this.#db.insert(
      `INSERT INTO local_login_lockout (user_id, failed_attempts, locked_until)
      VALUES (?, 0, NULL)
      ON CONFLICT(user_id) DO UPDATE SET failed_attempts = 0, locked_until = NULL`,
      [userId],
    );
  }

  async #persistSession(session: CashierSession): Promise<void> {
    await this.#db.insert(
      `INSERT INTO local_cashier_session (key, user_id, full_name, role, store_id, logged_in_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        user_id = excluded.user_id,
        full_name = excluded.full_name,
        role = excluded.role,
        store_id = excluded.store_id,
        logged_in_at = excluded.logged_in_at`,
      [session.key, session.user_id, session.full_name, session.role, session.store_id, session.logged_in_at],
    );
  }
}

export async function ensureCashierSessionTables(db: IDb): Promise<void> {
  await db.insert(
    `CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('cashier', 'store_manager', 'hq_admin')),
      store_id TEXT,
      full_name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_updated_at TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await db.insert(`CREATE INDEX IF NOT EXISTS users_store_role_idx ON users (store_id, role)`);

  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_login_lockout (
      user_id TEXT PRIMARY KEY,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT
    )`,
  );

  await db.insert(
    `CREATE TABLE IF NOT EXISTS local_cashier_session (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      store_id TEXT,
      logged_in_at TEXT NOT NULL
    )`,
  );
}
