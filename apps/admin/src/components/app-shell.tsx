import type { ReactNode } from "react";
import type { PosRole } from "../lib/supabase/claims";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";

export function AppShell({ role, children }: { role: PosRole | null; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar role={role} />
      <div className="flex min-h-screen flex-1 flex-col ml-sidebar-width">
        <AppTopbar />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
