"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../lib/db/provider";
import { CashierSessionManager } from "../lib/auth/cashier-session";
import { createShiftEventQueue, getTillId } from "../lib/till/services";

// "/" is never a real destination on its own — login/shift-open redirect
// here once they've resolved session/shift state, and this then routes on
// to the actual next screen instead of dead-ending on placeholder content.
export default function HomePage() {
  const db = useDb();
  const router = useRouter();
  const [unprovisioned, setUnprovisioned] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function redirect() {
      const sessionManager = new CashierSessionManager({ db });
      const session = await sessionManager.getCurrentSession();
      if (cancelled) return;
      if (session === null) {
        router.replace("/login");
        return;
      }

      const tillId = await getTillId(db);
      if (cancelled) return;
      if (tillId === null || session.store_id === null) {
        setUnprovisioned(true);
        return;
      }

      const queue = createShiftEventQueue(db, tillId, session.store_id);
      const openShift = await queue.getOpenShift();
      if (cancelled) return;
      router.replace(openShift === null ? "/shift/open" : "/sale");
    }

    void redirect();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  if (!unprovisioned) return null;

  return (
    <main className="p-md">
      <h1 className="text-headline-lg font-headline-lg font-bold text-on-surface">HGL POS</h1>
      <p className="mt-2 text-body-md font-body-md text-on-surface-variant">
        This till has not been provisioned yet — contact support to complete setup.
      </p>
    </main>
  );
}
