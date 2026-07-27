import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { photos, partyMembers, parties, likes, comments, profiles } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES } from "@/lib/constants";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const partyCode = (url.searchParams.get("party") ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "party required" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const rows = await db.select({
    id: photos.id, partyId: photos.partyId, uploaderProfileId: photos.uploaderProfileId,
    r2Key: photos.r2Key, width: photos.width, height: photos.height, bytes: photos.bytes,
    contentType: photos.contentType, createdAt: photos.createdAt,
    uploaderNickname: profiles.nickname,
  })
  .from(photos)
  .leftJoin(profiles, eq(photos.uploaderProfileId, profiles.id))
  .where(eq(photos.partyId, party.id))
  .orderBy(desc(photos.createdAt));
  if (rows.length === 0) return NextResponse.json({ photos: [] });

  const photoIds = rows.map((r) => r.id);
  const likeCounts = await db.select({
    photoId: likes.photoId, count: sql<number>`count(*)`.as("count"),
  }).from(likes).where(inArray(likes.photoId, photoIds)).groupBy(likes.photoId);
  const likeCountMap = new Map(likeCounts.map((r) => [r.photoId, Number(r.count)]));

  const likedByMe = profileId ? await db.select({ photoId: likes.photoId }).from(likes)
    .where(and(inArray(likes.photoId, photoIds), eq(likes.profileId, profileId))) : [];
  const likedSet = new Set(likedByMe.map((r) => r.photoId));

  const commentCounts = await db.select({
    photoId: comments.photoId, count: sql<number>`count(*)`.as("count"),
  }).from(comments).where(inArray(comments.photoId, photoIds)).groupBy(comments.photoId);
  const commentCountMap = new Map(commentCounts.map((r) => [r.photoId, Number(r.count)]));

  const out = rows.map((r) => ({
    ...r,
    uploaderNickname: r.uploaderNickname ?? null,
    liked: likedSet.has(r.id),
    likeCount: likeCountMap.get(r.id) ?? 0,
    commentCount: commentCountMap.get(r.id) ?? 0,
  }));

  return NextResponse.json({ photos: out });
}

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const key = String(body.key ?? "");
  const bytes = Number(body.bytes ?? 0);
  const contentType = String(body.contentType ?? "");
  const width = body.width ? Number(body.width) : null;
  const height = body.height ? Number(body.height) : null;
  if (!partyCode || !key || !bytes || !contentType) return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  if (bytes > MAX_PHOTO_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const head = await env.PHOTOS_BUCKET.head(key);
  if (!head) return NextResponse.json({ error: "object-not-found" }, { status: 404 });
  if (head.size !== bytes) return NextResponse.json({ error: "size-mismatch" }, { status: 400 });

  const id = crypto.randomUUID();
  await db.insert(photos).values({
    id, partyId: party.id, uploaderProfileId: profileId,
    r2Key: key, width, height, bytes, contentType,
  });
  return NextResponse.json({ id });
}
