import { describe, expect, it } from "vitest";
import { DeviceSessionManager } from "../../../src/lib/auth/device-session";
import { createMemoryDb } from "../../support/memory-db";

const TILL_ID = "35000000-0000-4000-8000-000000000011";
const MINT_URL = "https://supabase.local/functions/v1/mint-device-jwt";
const ANON_KEY = "anon-key-placeholder";

function managerWithFetch(fetchImpl: typeof fetch, now: () => Date = () => new Date("2026-01-01T00:00:00.000Z")) {
  return new DeviceSessionManager({
    db: createMemoryDb(),
    tillId: TILL_ID,
    mintEndpointUrl: MINT_URL,
    anonKey: ANON_KEY,
    getCredential: () => Promise.resolve("current-opaque-credential"),
    fetchImpl,
    now,
  });
}

describe("DeviceSessionManager", () => {
  it("mints and persists a session, forwarding the anon key + current credential", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({ access_token: "signed.jwt.token", expires_at: "2026-01-01T01:00:00.000Z" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const manager = managerWithFetch(fetchImpl);
    const state = await manager.mint();

    expect(state).toEqual({
      till_id: TILL_ID,
      access_token: "signed.jwt.token",
      expires_at: "2026-01-01T01:00:00.000Z",
      minted_at: "2026-01-01T00:00:00.000Z",
    });
    expect(capturedUrl).toBe(MINT_URL);
    expect(capturedInit?.headers).toMatchObject({ authorization: `Bearer ${ANON_KEY}` });
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      till_id: TILL_ID,
      credential: "current-opaque-credential",
    });

    const persisted = await manager.read();
    expect(persisted).toEqual(state);
  });

  it("throws on a non-OK response instead of silently persisting nothing", async () => {
    const fetchImpl = (async () => new Response(null, { status: 403 })) as typeof fetch;
    const manager = managerWithFetch(fetchImpl);

    await expect(manager.mint()).rejects.toThrow(/HTTP 403/);
  });

  it("shouldRefresh: true when missing, true within the refresh window, false otherwise", async () => {
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const manager = managerWithFetch((async () => new Response(null, { status: 500 })) as typeof fetch, now);

    expect(manager.shouldRefresh(null)).toBe(true);
    expect(
      manager.shouldRefresh({
        till_id: TILL_ID,
        access_token: "x",
        expires_at: "2026-01-01T00:05:00.000Z", // 5 min away, inside the 10 min default window
        minted_at: "2025-12-31T23:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      manager.shouldRefresh({
        till_id: TILL_ID,
        access_token: "x",
        expires_at: "2026-01-01T01:00:00.000Z", // 1 hour away, outside the window
        minted_at: "2025-12-31T23:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("mintIfDue re-mints only when a refresh is due", async () => {
    let mintCount = 0;
    const fetchImpl = (async () => {
      mintCount += 1;
      return new Response(
        JSON.stringify({ access_token: `token-${mintCount}`, expires_at: "2026-01-01T02:00:00.000Z" }),
        { status: 200 },
      );
    }) as typeof fetch;

    const manager = managerWithFetch(fetchImpl);

    const first = await manager.mintIfDue();
    expect(first?.access_token).toBe("token-1");
    expect(mintCount).toBe(1);

    const second = await manager.mintIfDue();
    expect(second?.access_token).toBe("token-1");
    expect(mintCount).toBe(1);
  });
});
