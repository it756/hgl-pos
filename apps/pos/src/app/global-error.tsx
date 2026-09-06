"use client";

import { useEffect } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { KioskErrorScreen } from "../components/kiosk-error-screen";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

// Catches errors thrown by the root layout itself (e.g. DB init failure).
// Next.js requires this to render its own <html>/<body> since it replaces
// the root layout entirely.
export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  useEffect(() => {
    console.error("POS root layout error boundary caught:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className={inter.variable}>
        <KioskErrorScreen error={error} onRetry={reset} />
      </body>
    </html>
  );
}
