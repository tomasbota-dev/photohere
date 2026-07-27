import Link from "next/link";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { ExpiryPill } from "@/components/expiry-pill";
import { eq, desc } from "drizzle-orm";

export const runtime = "edge";

export default async function MePage() {
  const env = getCloudflareContext().env as Env;
  const profileId = await getEffectiveProfileId(env);
  const db = getDb(env);

  if (!profileId) return <NotSignedIn />;

  const profileRows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  const profile = profileRows[0] ?? null;
  const myParties = await db.select({
    id: parties.id, code: parties.code, title: parties.title,
    role: partyMembers.role, createdAt: parties.createdAt, expiresAt: parties.expiresAt,
  })
  .from(partyMembers)
  .innerJoin(parties, eq(partyMembers.partyId, parties.id))
  .where(eq(partyMembers.profileId, profileId))
  .orderBy(desc(parties.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">My parties</h1>
        {profile && <p className="text-sm text-muted-foreground">{profile.isAnonymous ? "Anonymous" : profile.email} · <Link href="/auth/request" className="underline">{profile.isAnonymous ? "Sign in" : "Switch account"}</Link></p>}
      </header>
      {myParties.length === 0 ? (
        <p className="text-muted-foreground">You haven't joined any parties yet. <Link href="/" className="underline">Get started</Link>.</p>
      ) : (
        <ul className="divide-y">
          {myParties.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link href={`/p/${p.code}`} className="font-medium hover:underline">{p.title}</Link>
                  {p.role === "host" && <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">host</span>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{p.code}</div>
              </div>
              <ExpiryPill expiresAt={p.expiresAt} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NotSignedIn() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center space-y-4">
      <h1 className="text-2xl font-semibold">You're not signed in</h1>
      <p className="text-muted-foreground text-sm">Sign in with your email to keep your party list across devices.</p>
      <a href="/auth/request" className="underline">Continue with email</a>
    </main>
  );
}
