"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { IDb } from "../lib/db";
import { verifySupervisorPin, type SupervisorIdentity } from "../lib/auth/cashier-session";
import { Button } from "./ui/button";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"] as const;

export type SupervisorPinDialogProps = {
  db: IDb;
  title: string;
  description?: string;
  onCancel: () => void;
  onApproved: (supervisor: SupervisorIdentity) => void;
};

// Manager-override gate shared by void-item/void-sale/suspend â€” any active
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
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open && !checking) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[60] flex w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-outline-variant bg-surface-container-lowest p-5 text-on-surface shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="text-headline-md font-semibold text-on-surface">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-body-md text-on-surface-variant">
            {description ?? "A store manager or HQ admin must enter their PIN to authorize this."}
          </DialogPrimitive.Description>

          <div className="flex h-12 items-center justify-center rounded-lg border border-outline-variant bg-surface text-headline-md font-headline-md tracking-[0.5em] text-on-surface">
            {pin.length > 0 ? "•".repeat(pin.length) : <span className="text-body-md tracking-normal text-on-surface-variant">Enter PIN</span>}
          </div>

          {error !== null && <p className="text-body-md font-body-md text-destructive">{error}</p>}

          <div className="grid grid-cols-3 gap-2">
            {PIN_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="lg"
                className="text-body-lg"
                disabled={checking}
                onClick={() => handleKeyPress(key)}
              >
                {key === "clear" ? "Clear" : key === "back" ? "⌫" : key}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" disabled={checking} onClick={onCancel}>
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}