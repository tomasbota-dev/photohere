import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { likes, photos, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

async function assertMembership(env: Env, photoId: string, profileId: string) {
  const db = getDb(env);
  const photoRows = await db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
  if (photoRows.length === 0) return { ok: false, status: 404 as const };
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photoRows[0].partyId), eq(partyMembers.profileId, profileId))).limit(1);
  return memberRows.length === 0 ? { ok: false, status: 403 as const } : { ok: true as const };
}

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const photoId = String(body.photoId ?? "");
  if (!photoId) return NextResponse.json({ error: "photoId required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const guard = await assertMembership(env, photoId, profileId);
  if (!guard.ok) return NextResponse.json({ error: "forbidden" }, { status: guard.status });

  const db = getDb(env);
  try {
    await db.insert(likes).values({ photoId, profileId });
  } catch {
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const env = getCloudflareContext().env as Env;
  const url = new URL(req.url);
  const photoId = url.searchParams.get("photoId");
  if (!photoId) return NextResponse.json({ error: "photoId required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const guard = await assertMembership(env, photoId, profileId);
  if (!guard.ok) return NextResponse.json({ error: "forbidden" }, { status: guard.status });

  const db = getDb(env);
  await db.delete(likes).where(and(eq(likes.photoId, photoId), eq(likes.profileId, profileId)));
  return NextResponse.json({ ok: true });
}
