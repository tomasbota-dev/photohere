import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const partyCode = (url.searchParams.get("party") ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "party required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const members = await db.select({
    profileId: partyMembers.profileId, role: partyMembers.role, joinedAt: partyMembers.joinedAt,
    nickname: profiles.nickname, email: profiles.email,
  })
  .from(partyMembers)
  .leftJoin(profiles, eq(partyMembers.profileId, profiles.id))
  .where(eq(partyMembers.partyId, party.id));

  return NextResponse.json({ members });
}
