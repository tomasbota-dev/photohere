import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { profiles } from "@/lib/schema";
import { getCurrentProfileIdFromSession } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { Providers } from "./providers";
import { SiteHeader, type HeaderProfile } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "photohere",
  description: "Create a party, share the code, collect every photo from everyone.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
  colorScheme: "dark light",
};

export const runtime = "edge";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const env = getCloudflareContext().env as Env;
  const session = await getCurrentProfileIdFromSession(env);
  let profile: HeaderProfile | null = null;
  if (session) {
    const rows = await getDb(env).select().from(profiles).where(eq(profiles.id, session.profileId)).limit(1);
    if (rows.length > 0) {
      profile = { email: rows[0].email, isAnonymous: rows[0].isAnonymous === 1 };
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <Providers>
          <SiteHeader profile={profile} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
