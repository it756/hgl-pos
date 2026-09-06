"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDb } from "../../lib/db/provider";
import {
  CashierSessionManager,
  type CashierRosterEntry,
} from "../../lib/auth/cashier-session";
import type { ShiftEventQueue } from "../../lib/events/queue";
import { createShiftEventQueue, getTillId } from "../../lib/till/services";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export default function LoginPage() {
  const db = useDb();
  const router = useRouter();
  const sessionManager = useMemo(() => new CashierSessionManager({ db }), [db]);

  const [roster, setRoster] = useState<CashierRosterEntry[] | null>(null);
  const [selectedUser, setSelectedUser] = useState<CashierRosterEntry | null>(null);
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const redirectAfterLogin = useCallback(
    async (storeId: string | null) => {
      const tillId = await getTillId(db);
      if (tillId !== null && storeId !== null) {
        const queue: ShiftEventQueue = createShiftEventQueue(db, tillId, storeId);
        const openShift = await queue.getOpenShift();
        router.replace(openShift === null ? "/shift/open" : "/");
        return;
      }
      // Till identity isn't provisioned locally yet — send the cashier
      // home rather than blocking login on an unrelated provisioning gap.
      router.replace("/");
    },
    [db, router],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadRosterAndSession() {
      try {
        const existing = await sessionManager.getCurrentSession();
        if (existing !== null) {
          if (!cancelled) await redirectAfterLogin(existing.store_id);
          return;
        }

        const cashiers = await sessionManager.listActiveCashiers();
        if (!cancelled) setRoster(cashiers);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }

    void loadRosterAndSession();
    return () => {
      cancelled = true;
    };
  }, [sessionManager, redirectAfterLogin]);

  function handleKeyPress(key: (typeof PIN_KEYS)[number]) {
    setError(null);
    if (key === "clear") {
      setPin("");
    } else if (key === "back") {
      setPin((current) => current.slice(0, -1));
    } else if (pin.length < 12) {
      setPin((current) => current + key);
    }
  }

  async function handleSubmit() {
    if (selectedUser === null || pin.length === 0) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = await sessionManager.login(selectedUser.user_id, pin);
      if (result.ok) {
        setPin("");
        await redirectAfterLogin(result.session.store_id);
        return;
      }

      setPin("");
      setError(describeLoginError(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md flex-col justify-center p-md">
      <Card>
        <CardHeader>
          <CardTitle>{selectedUser === null ? "Who's on the till?" : `Hi, ${selectedUser.full_name}`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-md">
          {loadError !== null && (
            <p className="text-body-md font-body-md text-destructive">Could not load cashier roster: {loadError}</p>
          )}

          {selectedUser === null && (
            <div className="grid grid-cols-2 gap-sm">
              {roster?.map((cashier) => (
                <Button
                  key={cashier.user_id}
                  type="button"
                  variant="outline"
                  size="lg"
                  className="h-16"
                  onClick={() => setSelectedUser(cashier)}
                >
                  {cashier.full_name}
                </Button>
              ))}
              {roster !== null && roster.length === 0 && (
                <p className="col-span-2 text-body-md font-body-md text-on-surface-variant">
                  No cashiers are cached on this till yet.
                </p>
              )}
            </div>
          )}

          {selectedUser !== null && (
            <div className="flex flex-col gap-md">
              <div className="flex items-center justify-center gap-2" aria-label="PIN entry">
                {Array.from({ length: Math.max(pin.length, 4) }).map((_, index) => (
                  <span
                    key={index}
                    className={`h-3 w-3 rounded-full ${index < pin.length ? "bg-primary" : "bg-surface-container-high"}`}
                  />
                ))}
              </div>

              {error !== null && <p className="text-center text-body-md font-body-md text-destructive">{error}</p>}

              <div className="grid grid-cols-3 gap-sm">
                {PIN_KEYS.map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant={key === "clear" || key === "back" ? "ghost" : "secondary"}
                    size="lg"
                    className="h-14 text-headline-md"
                    onClick={() => handleKeyPress(key)}
                  >
                    {key === "clear" ? "Clear" : key === "back" ? "⌫" : key}
                  </Button>
                ))}
              </div>

              <div className="flex gap-sm">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setSelectedUser(null);
                    setPin("");
                    setError(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="flex-1"
                  disabled={pin.length === 0 || submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? "Checking…" : "Log in"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function describeLoginError(result: { ok: false; reason: string; lockedUntil?: string }): string {
  switch (result.reason) {
    case "locked": {
      const until = result.lockedUntil !== undefined ? new Date(result.lockedUntil).toLocaleTimeString() : null;
      return until !== null
        ? `Too many failed attempts. Try again after ${until}.`
        : "Too many failed attempts. Try again shortly.";
    }
    case "invalid_pin":
      return "Incorrect PIN. Please try again.";
    case "inactive":
      return "This cashier account is no longer active.";
    case "not_found":
    default:
      return "Cashier not recognised on this till.";
  }
}
