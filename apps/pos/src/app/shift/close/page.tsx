"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../../lib/db/provider";
import { CashierSessionManager, type CashierSession } from "../../../lib/auth/cashier-session";
import { createShiftEventQueue, getTillId } from "../../../lib/till/services";
import type { ShiftRow } from "../../../lib/events/queue";
import { calculateOverShort } from "../../../lib/shift/cash-up";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";

export default function ShiftClosePage() {
  const db = useDb();
  const router = useRouter();

  const [session, setSession] = useState<CashierSession | null>(null);
  const [tillId, setTillId] = useState<string | null>(null);
  const [openShift, setOpenShift] = useState<ShiftRow | null | undefined>(undefined);
  const [cashCounted, setCashCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const sessionManager = new CashierSessionManager({ db });
        const current = await sessionManager.getCurrentSession();
        if (cancelled) return;

        if (current === null) {
          router.replace("/login");
          return;
        }
        setSession(current);

        const resolvedTillId = await getTillId(db);
        if (cancelled) return;
        setTillId(resolvedTillId);

        if (resolvedTillId === null || current.store_id === null) {
          setOpenShift(null);
          return;
        }

        const queue = createShiftEventQueue(db, resolvedTillId, current.store_id);
        const shift = await queue.getOpenShift();
        if (!cancelled) setOpenShift(shift);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [db, router]);

  const parsedCashCounted = Number(cashCounted);
  const validCashCounted = cashCounted.length > 0 && Number.isFinite(parsedCashCounted) && parsedCashCounted >= 0;
  const overShortPreview =
    openShift !== null && openShift !== undefined && validCashCounted
      ? calculateOverShort({
          openingFloat: openShift.opening_float,
          systemCash: openShift.system_cash,
          cashCounted: parsedCashCounted,
        })
      : null;

  async function handleSubmit() {
    if (session === null || tillId === null || openShift === null || openShift === undefined) return;
    if (!validCashCounted) {
      setError("Enter the counted cash amount.");
      return;
    }
    if (session.store_id === null) {
      setError("Cashier has no assigned store — cannot close this shift.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const queue = createShiftEventQueue(db, tillId, session.store_id);
      await queue.closeShift({
        shiftId: openShift.shift_id,
        cashCounted: parsedCashCounted,
        tenderBreakdown: { cash: parsedCashCounted },
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });

      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (openShift === undefined) return null;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center p-md">
      <Card>
        <CardHeader>
          <CardTitle>Cash-up / end shift</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          {loadError !== null && (
            <p className="text-body-md font-body-md text-destructive">Could not load shift: {loadError}</p>
          )}

          {openShift === null && loadError === null && (
            <p className="text-body-md font-body-md text-on-surface-variant">
              No shift is currently open on this till.
            </p>
          )}

          {openShift !== null && (
            <>
              <dl className="grid grid-cols-2 gap-y-1 text-body-md font-body-md">
                <dt className="text-on-surface-variant">Opening float</dt>
                <dd className="text-right text-on-surface">{openShift.opening_float.toFixed(2)} ZMW</dd>
              </dl>

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Cash counted (ZMW)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={cashCounted}
                  onChange={(event) => setCashCounted(event.target.value)}
                  className="h-14 rounded-lg border border-outline-variant bg-surface px-md text-headline-md font-headline-md text-on-surface"
                  placeholder="0.00"
                />
              </label>

              {overShortPreview !== null && (
                <p className="text-body-md font-body-md text-on-surface-variant">
                  {overShortPreview === 0
                    ? "Balanced against the opening float."
                    : overShortPreview > 0
                      ? `${overShortPreview.toFixed(2)} ZMW over the opening float.`
                      : `${Math.abs(overShortPreview).toFixed(2)} ZMW short against the opening float.`}
                  {" "}
                  Final over/short is confirmed once this shift syncs.
                </p>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-label-md font-label-md text-on-surface-variant">Notes (optional)</span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className="min-h-20 rounded-lg border border-outline-variant bg-surface px-md py-2 text-body-md font-body-md text-on-surface"
                />
              </label>

              {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

              <Button
                type="button"
                size="lg"
                variant="destructive"
                disabled={submitting || !validCashCounted}
                onClick={() => void handleSubmit()}
              >
                {submitting ? "Closing shift…" : "Close shift"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
