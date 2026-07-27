import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "./providers";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "photohere",
  description: "Create a party, share the code, collect every photo from everyone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <Providers>
          <header className="sticky top-0 z-40 border-b border-border/50 backdrop-blur bg-background/80">
            <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
              <Link href="/" className="font-mono text-sm tracking-tight">photohere</Link>
              <div className="flex items-center gap-1">
                <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground px-2">My parties</Link>
                <ThemeToggle />
              </div>
            </div>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
