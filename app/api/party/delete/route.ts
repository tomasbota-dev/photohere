import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, photos, likes, comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "partyCode required" }, { status: 400 });
  const callerProfileId = await getEffectiveProfileId(env);
  if (!callerProfileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, callerProfileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const photosRows = await db.select().from(photos).where(eq(photos.partyId, party.id));
  for (const p of photosRows) {
    await env.PHOTOS_BUCKET.delete(p.r2Key);
  }
  const photoIds = photosRows.map((p) => p.id);
  for (const id of photoIds) {
    await db.batch([
      db.delete(likes).where(eq(likes.photoId, id)),
      db.delete(comments).where(eq(comments.photoId, id)),
    ]);
  }
  await db.batch([
    db.delete(photos).where(eq(photos.partyId, party.id)),
    db.delete(partyMembers).where(eq(partyMembers.partyId, party.id)),
    db.delete(parties).where(eq(parties.id, party.id)),
  ]);
  return NextResponse.json({ ok: true });
}
