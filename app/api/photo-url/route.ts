import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { photos, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { presignGet } from "@/lib/r2";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getCloudflareContext().env as Env;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = getDb(env);
  const rows = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const photo = rows[0];

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photo.partyId), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const url_ = await presignGet(env, photo.r2Key);
  return NextResponse.json({ url: url_ });
}
