import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { DbProvider } from "../lib/db/provider";
import { TillTopBar } from "../components/till-top-bar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "HGL POS",
  description: "Harvest Group retail POS — till app",
};

const sidecarEndpoint = process.env.NEXT_PUBLIC_POWERSYNC_SIDECAR_URL;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <DbProvider sidecarEndpoint={sidecarEndpoint}>
          <TillTopBar />
          {children}
        </DbProvider>
      </body>
    </html>
  );
}
