"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useDb } from "../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../lib/auth/cashier-session";
import { createShiftEventQueue, getTillId } from "../lib/till/services";
import { CashierMenuPopover } from "./cashier-menu-popover";
import { SyncStatusChip } from "./sync-status-chip";
import { ThemeToggle } from "./theme-toggle";
import { Badge } from "./ui/badge";

export type TillTopBarProps = {
  storeLabel?: string;
  tillLabel?: string;
};

type HeaderState = {
  session: CashierSession | null;
  shiftOpenedAt: string | null;
};

// Deliberately no persistent sidebar or tab bar here — the till is a
// task-flow kiosk, not a multi-section dashboard. All secondary/cashier
// actions live in the popover menu instead.
export function TillTopBar({ storeLabel, tillLabel }: TillTopBarProps) {
  const db = useDb();
  const router = useRouter();
  const pathname = usePathname();
  const sessionManager = useMemo(() => new CashierSessionManager({ db }), [db]);
  const identity = [storeLabel, tillLabel].filter((value): value is string => value !== undefined).join(" · ");
  const [state, setState] = useState<HeaderState>({ session: null, shiftOpenedAt: null });

  // Re-read on navigation so login/logout and shift open/close are reflected without a reload.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const session = await sessionManager.getCurrentSession();
        let shiftOpenedAt: string | null = null;
        if (session !== null && session.store_id !== null) {
          const tillId = await getTillId(db);
          if (tillId !== null) {
            const shift = await createShiftEventQueue(db, tillId, session.store_id).getOpenShift();
            shiftOpenedAt = shift?.opened_at ?? null;
          }
        }
        if (!cancelled) setState({ session, shiftOpenedAt });
      } catch {
        // Header chips are informational only; pages surface their own load errors.
        if (!cancelled) setState({ session: null, shiftOpenedAt: null });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [db, sessionManager, pathname]);

  async function handleLogout() {
    await sessionManager.logout();
    setState({ session: null, shiftOpenedAt: null });
    router.replace("/login");
  }

  const { session, shiftOpenedAt } = state;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-on-nav/10 bg-nav px-3.5 text-nav-muted">
      <span className="mr-1 text-body-lg font-bold text-on-nav">Till</span>
      {identity !== "" && <Badge variant="nav">{identity}</Badge>}
      <span className="flex-1" />
      <SyncStatusChip />
      {session !== null && (
        <Badge variant="nav" className="hidden sm:inline-flex">
          {shiftOpenedAt !== null ? `Shift open ${formatTime(shiftOpenedAt)}` : "Shift closed"}
        </Badge>
      )}
      {session !== null && (
        <Badge variant="nav" className="hidden md:inline-flex">
          {session.full_name}, {session.role.replace(/_/g, " ")}
        </Badge>
      )}
      <ThemeToggle />
      <CashierMenuPopover onLogout={() => void handleLogout()} />
    </header>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toTimeString().slice(0, 5);
}
