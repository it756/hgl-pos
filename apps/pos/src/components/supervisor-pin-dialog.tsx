"use client";

import { useState } from "react";
import type { IDb } from "../lib/db";
import { verifySupervisorPin, type SupervisorIdentity } from "../lib/auth/cashier-session";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export type SupervisorPinDialogProps = {
  db: IDb;
  title: string;
  description?: string;
  onCancel: () => void;
  onApproved: (supervisor: SupervisorIdentity) => void;
};

// Manager-override gate shared by void-item/void-sale/suspend — any active
// store_manager/hq_admin's PIN unlocks it, independent of who's logged in.
export function SupervisorPinDialog({ db, title, description, onCancel, onApproved }: SupervisorPinDialogProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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

  async function handleSubmit(): Promise<void> {
    if (pin.length === 0) return;
    setChecking(true);
    setError(null);
    try {
      const supervisor = await verifySupervisorPin(db, pin);
      if (supervisor === null) {
        setError("Invalid supervisor PIN.");
        setPin("");
        return;
      }
      onApproved(supervisor);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/50 p-md">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <p className="text-body-md font-body-md text-on-surface-variant">
            {description ?? "A store manager or HQ admin must enter their PIN to authorize this."}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-sm">
          <div className="flex h-12 items-center justify-center rounded-lg border border-outline-variant bg-surface text-headline-md font-headline-md tracking-[0.5em] text-on-surface">
            {pin.length > 0 ? "•".repeat(pin.length) : <span className="text-on-surface-variant">Enter PIN</span>}
          </div>

          {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

          <div className="grid grid-cols-3 gap-2">
            {PIN_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="lg"
                disabled={checking}
                onClick={() => handleKeyPress(key)}
              >
                {key === "clear" ? "Clear" : key === "back" ? "⌫" : key}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="flex-1" disabled={checking} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={checking || pin.length === 0}
              onClick={() => void handleSubmit()}
            >
              {checking ? "Checking…" : "Approve"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
