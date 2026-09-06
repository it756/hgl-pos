import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../supabase/server";
import { decodeJwtPayload, readSessionClaims, type PosRole, type SessionClaims } from "../supabase/claims";

const LOGIN_ROUTE = "/login" satisfies Route;
const HOME_ROUTE = "/" satisfies Route;

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user === null) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  const jwtClaims = sessionData.session !== null ? decodeJwtPayload(sessionData.session.access_token) : null;

  return readSessionClaims(userData.user, jwtClaims);
}

export async function requireSessionClaims(): Promise<SessionClaims> {
  const claims = await getSessionClaims();
  if (claims === null) redirect(LOGIN_ROUTE);
  return claims;
}

export async function requireRole(allowedRoles: readonly PosRole[]): Promise<SessionClaims> {
  const claims = await requireSessionClaims();
  if (claims.role === null || !allowedRoles.includes(claims.role)) {
    redirect(HOME_ROUTE);
  }
  return claims;
}
