"use client";

import { Button } from "./ui/button";

export type KioskErrorScreenProps = {
  error: Error;
  onRetry: () => void;
};

// Full-screen, touch-friendly fallback: a kiosk cashier has no desktop/devtools
// to fall back to, so this must always offer a way forward.
export function KioskErrorScreen({ error, onRetry }: KioskErrorScreenProps) {
  return (
    <div className="grid h-screen place-items-center p-lg text-center">
      <div>
        <h1 className="mb-2 text-headline-lg font-headline-lg font-semibold text-on-surface">Till needs a restart</h1>
        <p className="mb-lg text-body-md font-body-md text-on-surface-variant">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button type="button" size="lg" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
