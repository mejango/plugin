import type { Metadata } from "next";
import { Anton } from "next/font/google";

import { Providers } from "@/app/providers";

// Self-hosted by Next: no CDN round-trip, no swap flash on the one face that
// carries the whole brand.
const anton = Anton({ weight: "400", subsets: ["latin"], display: "swap", variable: "--font-display" });

import "./globals.css";

export const metadata: Metadata = {
  title: "telligence money network",
  description: "Give your machine a money engine so it can fundraise, process revenues, and manage incentives between machines.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpolygon points='50,4 90,27 90,73 50,96 10,73 10,27' fill='none' stroke='%23999' stroke-width='5'/%3E%3Ccircle cx='50' cy='50' r='30' fill='%23eee'/%3E%3Ccircle cx='50' cy='50' r='22' fill='none' stroke='%23777' stroke-width='6'/%3E%3Ccircle cx='50' cy='50' r='12' fill='%23555'/%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={anton.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
