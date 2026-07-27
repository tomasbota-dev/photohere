import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const targetProfileId = String(body.profileId ?? "");
  if (!partyCode || !targetProfileId) return NextResponse.json({ error: "fields required" }, { status: 400 });
  const callerProfileId = await getEffectiveProfileId(env);
  if (!callerProfileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  if (callerProfileId === targetProfileId) return NextResponse.json({ error: "cannot-kick-self" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, callerProfileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const target = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, targetProfileId))).limit(1);
  if (target.length === 0) return NextResponse.json({ error: "not-member" }, { status: 404 });
  if (target[0].role === "host") return NextResponse.json({ error: "cannot-kick-host" }, { status: 400 });

  await db.delete(partyMembers).where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, targetProfileId)));
  return NextResponse.json({ ok: true });
}
