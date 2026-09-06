"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../../lib/auth/cashier-session";
import { createShiftEventQueue, getTillId } from "../../../lib/till/services";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

export default function ShiftOpenPage() {
  const db = useDb();
  const router = useRouter();

  const [session, setSession] = useState<CashierSession | null | undefined>(undefined);
  const [openingFloat, setOpeningFloat] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      const sessionManager = new CashierSessionManager({ db });
      const current = await sessionManager.getCurrentSession();
      if (cancelled) return;

      if (current === null) {
        router.replace("/login");
        return;
      }

      const tillId = await getTillId(db);
      if (tillId !== null) {
        const queue = createShiftEventQueue(db, tillId, current.store_id ?? "");
        const existingOpenShift = await queue.getOpenShift();
        if (!cancelled && existingOpenShift !== null) {
          router.replace("/");
          return;
        }
      }

      if (!cancelled) setSession(current);
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  async function handleSubmit() {
    if (session === null || session === undefined) return;

    const parsedFloat = Number(openingFloat);
    if (!Number.isFinite(parsedFloat) || parsedFloat < 0) {
      setError("Enter a valid opening float amount.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const tillId = await getTillId(db);
      if (tillId === null) {
        setError("This till has not been provisioned yet — cannot open a shift.");
        return;
      }
      if (session.store_id === null) {
        setError("Cashier has no assigned store — cannot open a shift.");
        return;
      }

      const queue = createShiftEventQueue(db, tillId, session.store_id);
      await queue.openShift({
        shiftId: crypto.randomUUID(),
        cashierId: session.user_id,
        openingFloat: parsedFloat,
      });

      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (session === undefined) return null;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center p-md">
      <Card>
        <CardHeader>
          <CardTitle>Open shift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          <p className="text-body-md font-body-md text-on-surface-variant">
            Count the starting cash float and enter the amount below to begin trading.
          </p>

          <label className="flex flex-col gap-1">
            <span className="text-label-md font-label-md text-on-surface-variant">Opening float (ZMW)</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(event) => setOpeningFloat(event.target.value)}
              className="h-14 rounded-lg border border-outline-variant bg-surface px-md text-headline-md font-headline-md text-on-surface"
              placeholder="0.00"
            />
          </label>

          {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

          <Button type="button" size="lg" disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? "Opening shift…" : "Open shift"}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
