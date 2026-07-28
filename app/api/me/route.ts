import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { profiles, parties, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export const runtime = "edge";

export async function GET() {
  const env = getCloudflareContext().env as Env;
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json(null);
  const db = getDb(env);

  const existing = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (existing.length === 0) {
    await db.insert(profiles).values({ id: profileId, isAnonymous: 1 });
  }
  const p = existing[0] ?? { id: profileId, email: null, isAnonymous: 1, createdAt: Date.now() };

  const myParties = await db.select({
    id: parties.id,
    code: parties.code,
    title: parties.title,
    role: partyMembers.role,
    createdAt: parties.createdAt,
    expiresAt: parties.expiresAt,
  })
  .from(partyMembers)
  .innerJoin(parties, eq(partyMembers.partyId, parties.id))
  .where(eq(partyMembers.profileId, profileId))
  .orderBy(desc(parties.createdAt));

  return NextResponse.json({
    profileId: p.id,
    email: p.email,
    isAnonymous: !!p.isAnonymous,
    parties: myParties,
  });
}
