import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").toUpperCase().trim();
  const nickname = String(body.nickname ?? "").trim().slice(0, 40) || null;
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, code)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  let profileId = await getEffectiveProfileId(env);
  if (!profileId) {
    profileId = await getOrMintProfile(env);
  } else {
    const existing = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (existing.length === 0) {
      await db.insert(profiles).values({ id: profileId, isAnonymous: nickname ? 0 : 1, nickname });
    } else if (nickname && !existing[0].nickname) {
      await db.update(profiles).set({ nickname }).where(eq(profiles.id, profileId));
    }
  }

  const alreadyMember = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (alreadyMember.length === 0) {
    await db.insert(partyMembers).values({ partyId: party.id, profileId, role: "member" });
  }

  return NextResponse.json({ id: party.id, code: party.code, title: party.title, createdAt: party.createdAt, expiresAt: party.expiresAt });
}
