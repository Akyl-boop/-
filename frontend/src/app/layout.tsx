import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Nexa Dashboard",
  description: "Premium Telegram commerce dashboard",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { themeColor: "#08080a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
