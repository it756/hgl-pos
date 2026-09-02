import type { ReactNode } from "react";

export const metadata = {
  title: "HGL POS",
  description: "Harvest Group retail POS — till app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
