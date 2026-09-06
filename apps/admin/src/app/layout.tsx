import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "../components/auth-provider";
import { getSessionClaims } from "../lib/auth/session";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "HGL Admin",
  description: "Harvest Group retail POS — HQ / store-manager admin",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const claims = await getSessionClaims();

  return (
    <html lang="en">
      <body className={inter.variable}>
        <AuthProvider claims={claims}>{children}</AuthProvider>
      </body>
    </html>
  );
}
