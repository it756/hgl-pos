import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "HGL Admin",
  description: "Harvest Group retail POS — HQ / store-manager admin",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
