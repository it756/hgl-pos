import type { User } from "@supabase/supabase-js";

export type PosRole = "cashier" | "store_manager" | "hq_admin" | "device";

export type SessionClaims = {
  userId: string;
  email: string | null;
  role: PosRole | null;
  storeId: string | null;
};

// getUser() returns auth.users.raw_app_meta_data, NOT the JWT claims the
// access-token hook injects (pos_role/store_id) — those only exist in the
// signed access token, so the caller must decode it separately.
export function readSessionClaims(user: User | null, jwtClaims: Record<string, unknown> | null): SessionClaims | null {
  if (user === null) return null;

  return {
    userId: user.id,
    email: user.email ?? null,
    role: readRole(jwtClaims?.pos_role),
    storeId: typeof jwtClaims?.store_id === "string" ? jwtClaims.store_id : null,
  };
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payloadSegment = token.split(".")[1];
  if (payloadSegment === undefined) return null;

  try {
    const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readRole(value: unknown): PosRole | null {
  return value === "cashier" || value === "store_manager" || value === "hq_admin" || value === "device"
    ? value
    : null;
}
