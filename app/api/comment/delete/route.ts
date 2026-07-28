import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const rows = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  if (rows[0].profileId !== profileId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  await db.delete(comments).where(eq(comments.id, id));
  return NextResponse.json({ ok: true });
}
