import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell";
import { requireSessionClaims } from "../../lib/auth/session";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const claims = await requireSessionClaims();
  return <AppShell role={claims.role}>{children}</AppShell>;
}
