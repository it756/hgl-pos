import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { DbProvider } from "../lib/db/provider";
import { TillTopBar } from "../components/till-top-bar";
import { DEFAULT_THEME, themeBootstrapScript } from "../lib/theme/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "HGL POS",
  description: "Harvest Group retail POS — till app",
};

const sidecarEndpoint = process.env.NEXT_PUBLIC_POWERSYNC_SIDECAR_URL;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The bootstrap script may change data-theme before hydration.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${inter.variable} min-h-screen bg-background text-on-background antialiased`}>
        <DbProvider sidecarEndpoint={sidecarEndpoint}>
          <TillTopBar />
          {children}
        </DbProvider>
      </body>
    </html>
  );
}
