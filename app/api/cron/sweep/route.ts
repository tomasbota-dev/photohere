import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, photos, likes, comments, partyMembers } from "@/lib/schema";
import { eq, lt } from "drizzle-orm";
import { ORPHAN_TTL_MS } from "@/lib/constants";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb(env);
  const now = Date.now();

  const expired = await db.select().from(parties).where(lt(parties.expiresAt, now));
  for (const party of expired) {
    const photosRows = await db.select().from(photos).where(eq(photos.partyId, party.id));
    for (const p of photosRows) await env.PHOTOS_BUCKET.delete(p.r2Key);
    await sweepOrphans(env, party.id, photosRows.map((p) => p.r2Key), now);
    for (const p of photosRows) {
      await db.batch([
        db.delete(likes).where(eq(likes.photoId, p.id)),
        db.delete(comments).where(eq(comments.photoId, p.id)),
      ]);
    }
    await db.batch([
      db.delete(photos).where(eq(photos.partyId, party.id)),
      db.delete(partyMembers).where(eq(partyMembers.partyId, party.id)),
      db.delete(parties).where(eq(parties.id, party.id)),
    ]);
  }

  const live = await db.select().from(parties).where(lt(now, parties.expiresAt));
  for (const party of live) {
    const refs = await db.select({ r2Key: photos.r2Key }).from(photos).where(eq(photos.partyId, party.id));
    await sweepOrphans(env, party.id, refs.map((r) => r.r2Key), now, false);
  }

  return NextResponse.json({ swept: expired.length });
}

async function sweepOrphans(env: Env, partyId: string, refKeys: string[], now: number, requireExpired = true) {
  const prefix = `parties/${partyId}/`;
  const listed = await env.PHOTOS_BUCKET.list({ prefix });
  const refSet = new Set(refKeys);
  for (const obj of listed.objects) {
    if (!refSet.has(obj.key) && (now - obj.uploaded.getTime() > ORPHAN_TTL_MS)) {
      await env.PHOTOS_BUCKET.delete(obj.key);
    }
  }
}
