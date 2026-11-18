"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../lib/db/provider";
import { CashierSessionManager } from "../lib/auth/cashier-session";
import { CashierMenuPopover } from "./cashier-menu-popover";

export type TillTopBarProps = {
  storeLabel?: string;
  tillLabel?: string;
};

// Deliberately no persistent sidebar here — the till is a task-flow kiosk,
// not a multi-section dashboard. All secondary/cashier actions live in the
// popover menu instead.
export function TillTopBar({ storeLabel, tillLabel }: TillTopBarProps) {
  const db = useDb();
  const router = useRouter();
  const sessionManager = useMemo(() => new CashierSessionManager({ db }), [db]);
  const identity = [storeLabel, tillLabel].filter((value): value is string => value !== undefined).join(" · ");

  async function handleLogout() {
    await sessionManager.logout();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant bg-surface px-md py-sm">
      <span className="text-body-md font-body-md font-semibold text-on-surface">{identity || "Harvest POS"}</span>
      <CashierMenuPopover onLogout={() => void handleLogout()} />
    </header>
  );
}
