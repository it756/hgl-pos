"use client";

import { useEffect } from "react";
import { KioskErrorScreen } from "../components/kiosk-error-screen";

export type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Catches errors thrown by pages/segments nested under the root layout.
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("POS route error boundary caught:", error);
  }, [error]);

  return <KioskErrorScreen error={error} onRetry={reset} />;
}
