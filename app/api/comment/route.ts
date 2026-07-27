import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { comments, photos, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const photoId = String(body.photoId ?? "");
  const text = String(body.body ?? "").trim().slice(0, 500);
  if (!photoId || !text) return NextResponse.json({ error: "fields required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const db = getDb(env);
  const photoRows = await db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
  if (photoRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photoRows[0].partyId), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const id = crypto.randomUUID();
  await db.insert(comments).values({ id, photoId, profileId, body: text });
  const profRows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  return NextResponse.json({
    id, photoId, profileId, profileNickname: profRows[0]?.nickname ?? null, body: text, createdAt: Date.now(),
  });
}

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const photoId = url.searchParams.get("photoId");
  if (!photoId) return NextResponse.json({ error: "photoId required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const db = getDb(env);
  const photoRows = await db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
  if (photoRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photoRows[0].partyId), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const rows = await db.select({
    id: comments.id, photoId: comments.photoId, profileId: comments.profileId,
    body: comments.body, createdAt: comments.createdAt, profileNickname: profiles.nickname,
  })
  .from(comments)
  .leftJoin(profiles, eq(comments.profileId, profiles.id))
  .where(eq(comments.photoId, photoId))
  .orderBy(desc(comments.createdAt));
  return NextResponse.json({ comments: rows });
}
