import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../../support/memory-db";

// Hoisted so the vi.mock factory below can reference it (vi.mock calls are
// hoisted above imports by Vitest).
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { hashPin, verifyPin } from "../../../src/lib/auth/pin";
import {
  CashierSessionManager,
  ensureCashierSessionTables,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_PIN_ATTEMPTS,
} from "../../../src/lib/auth/cashier-session";

// T059 catch-up coverage. Argon2id itself is verified Rust-side
// (apps/pos/src-tauri/src/pin.rs's `hashes_and_verifies_pin_with_argon2id`
// cargo test) — there is no Argon2 implementation reachable from Vitest.
// What's tested here is the TS `TauriPinHasher` IPC contract (hash/verify
// invoke the right Tauri commands with the right args and round-trip their
// result), plus the local lockout state machine in `CashierSessionManager`
// that consumes `verifyPin`'s result.

describe("pin.ts — TauriPinHasher IPC contract", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("hash() invokes hash_pin with the raw PIN and returns the Argon2id hash", async () => {
    invokeMock.mockResolvedValueOnce("$argon2id$v=19$m=19456,t=2,p=1$salt$hash");
    const hash = await hashPin("123456");

    expect(invokeMock).toHaveBeenCalledWith("hash_pin", { pin: "123456" });
    expect(hash).toBe("$argon2id$v=19$m=19456,t=2,p=1$salt$hash");
  });

  it("verify() round-trips true for a hash produced by hash()", async () => {
    invokeMock.mockResolvedValueOnce("$argon2id$v=19$...");
    const hash = await hashPin("123456");

    invokeMock.mockResolvedValueOnce(true);
    const ok = await verifyPin("123456", hash);

    expect(invokeMock).toHaveBeenLastCalledWith("verify_pin", { pin: "123456", hash });
    expect(ok).toBe(true);
  });

  it("verify() returns false for a mismatching PIN", async () => {
    invokeMock.mockResolvedValueOnce(false);
    const ok = await verifyPin("000000", "$argon2id$v=19$...");
    expect(ok).toBe(false);
  });
});

const USER_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";

async function seedCashier(db: ReturnType<typeof createMemoryDb>): Promise<void> {
  await ensureCashierSessionTables(db);
  await db.insert(
    `INSERT INTO users (
      user_id, role, store_id, full_name, pin_hash, pin_updated_at, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [USER_ID, "cashier", STORE_ID, "Test Cashier", "$argon2id$stored-hash", "2026-01-01T00:00:00.000Z", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  );
}

describe("CashierSessionManager — offline lockout (T054/FR-043)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it(`locks out after ${String(MAX_FAILED_PIN_ATTEMPTS)} failed PIN attempts`, async () => {
    const db = createMemoryDb();
    await seedCashier(db);
    const manager = new CashierSessionManager({ db });

    invokeMock.mockResolvedValue(false);

    let lastResult;
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS; attempt += 1) {
      lastResult = await manager.login(USER_ID, "0000");
    }

    expect(lastResult).toEqual({ ok: false, reason: "locked", lockedUntil: expect.any(String) });
  });

  it("does not lock out before the Nth failed attempt", async () => {
    const db = createMemoryDb();
    await seedCashier(db);
    const manager = new CashierSessionManager({ db });

    invokeMock.mockResolvedValue(false);

    let lastResult;
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS - 1; attempt += 1) {
      lastResult = await manager.login(USER_ID, "0000");
    }

    expect(lastResult).toEqual({ ok: false, reason: "invalid_pin" });
  });

  it("rejects even a correct PIN while locked out (lockout, not just PIN mismatch)", async () => {
    const db = createMemoryDb();
    await seedCashier(db);
    const manager = new CashierSessionManager({ db });

    invokeMock.mockResolvedValue(false);
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS; attempt += 1) {
      await manager.login(USER_ID, "0000");
    }

    invokeMock.mockResolvedValueOnce(true);
    const result = await manager.login(USER_ID, "1234");

    expect(result).toEqual({ ok: false, reason: "locked", lockedUntil: expect.any(String) });
  });

  it("persists lockout state across a new manager instance sharing the same local DB (survives app restart)", async () => {
    const db = createMemoryDb();
    await seedCashier(db);

    invokeMock.mockResolvedValue(false);
    const firstInstance = new CashierSessionManager({ db });
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS; attempt += 1) {
      await firstInstance.login(USER_ID, "0000");
    }

    const secondInstance = new CashierSessionManager({ db });
    invokeMock.mockResolvedValueOnce(true);
    const result = await secondInstance.login(USER_ID, "1234");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("locked");
  });

  it("clears the lockout and allows login again once the lockout window has elapsed", async () => {
    const db = createMemoryDb();
    await seedCashier(db);

    let now = new Date("2026-01-01T00:00:00.000Z");
    invokeMock.mockResolvedValue(false);
    const manager = new CashierSessionManager({ db, now: () => now });
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS; attempt += 1) {
      await manager.login(USER_ID, "0000");
    }

    now = new Date(now.getTime() + LOCKOUT_DURATION_MS + 1_000);
    invokeMock.mockResolvedValueOnce(true);
    const result = await manager.login(USER_ID, "1234");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session.user_id).toBe(USER_ID);
  });

  it("resets failed-attempt count after a successful login", async () => {
    const db = createMemoryDb();
    await seedCashier(db);
    const manager = new CashierSessionManager({ db });

    invokeMock.mockResolvedValue(false);
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS - 2; attempt += 1) {
      await manager.login(USER_ID, "0000");
    }

    invokeMock.mockResolvedValueOnce(true);
    const successResult = await manager.login(USER_ID, "1234");
    expect(successResult.ok).toBe(true);

    invokeMock.mockResolvedValue(false);
    let lastResult;
    for (let attempt = 0; attempt < MAX_FAILED_PIN_ATTEMPTS - 1; attempt += 1) {
      lastResult = await manager.login(USER_ID, "0000");
    }
    expect(lastResult).toEqual({ ok: false, reason: "invalid_pin" });
  });
});
