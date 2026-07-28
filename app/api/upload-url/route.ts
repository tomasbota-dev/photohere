import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, photos } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES, RATE_LIMIT_UPLOADS_PER_MIN, UPLOAD_URL_TTL_SEC } from "@/lib/constants";
import { presignPut } from "@/lib/r2";
import { eq, and, gte } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const contentType = String(body.contentType ?? "");
  const contentLength = Number(body.contentLength ?? 0);

  if (!partyCode || !contentType || !contentLength) return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  if (contentLength > MAX_PHOTO_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "not-image" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env) ?? (await getOrMintProfile(env));
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const since = Date.now() - 60_000;
  const recent = await db.select({ id: photos.id }).from(photos)
    .where(and(eq(photos.uploaderProfileId, profileId), gte(photos.createdAt, since), eq(photos.partyId, party.id))).limit(RATE_LIMIT_UPLOADS_PER_MIN + 1);
  if (recent.length >= RATE_LIMIT_UPLOADS_PER_MIN) return NextResponse.json({ error: "rate-limited" }, { status: 429 });

  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
  const key = `parties/${party.id}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await presignPut(env, key, contentType, contentLength);

  return NextResponse.json({ uploadUrl, key, partyId: party.id, expiresIn: UPLOAD_URL_TTL_SEC });
}
