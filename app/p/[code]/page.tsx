import { notFound } from "next/navigation";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { PartyGallery } from "@/components/party-gallery";
import { JoinForm } from "@/components/join-form";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export default async function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const env = getCloudflareContext().env as Env;
  const db = getDb(env);

  const partyRows = await db.select().from(parties).where(eq(parties.code, code.toUpperCase())).limit(1);
  if (partyRows.length === 0) notFound();
  const party = partyRows[0];

  const profileId = await getEffectiveProfileId(env);
  let role: "host" | "member" | null = null;
  if (profileId) {
    const memberRows = await db.select().from(partyMembers)
      .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
    if (memberRows.length > 0) role = memberRows[0].role as "host" | "member";
  }
  if (!role) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <section className="w-full max-w-sm space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Join party</h1>
            <p className="text-sm text-muted-foreground">You're joining party <span className="font-mono">{code.toUpperCase()}</span></p>
          </header>
          <JoinForm initialCode={code} />
        </section>
      </main>
    );
  }

  return <PartyGallery code={party.code} title={party.title} expiresAt={party.expiresAt} role={role} currentProfileId={profileId} />;
}
