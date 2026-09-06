"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SessionClaims } from "../lib/supabase/claims";

const AuthContext = createContext<SessionClaims | null>(null);

export function AuthProvider({ claims, children }: { claims: SessionClaims | null; children: ReactNode }) {
  return <AuthContext.Provider value={claims}>{children}</AuthContext.Provider>;
}

export function useSessionClaims(): SessionClaims | null {
  return useContext(AuthContext);
}
