import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { generatePartyCode, PARTY_TTL_MS } from "@/lib/constants";
import { eq } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim().slice(0, 80);
  const nickname = String(body.nickname ?? "").trim().slice(0, 40) || null;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  let profileId = await getEffectiveProfileId(env);
  const db = getDb(env);

  if (profileId) {
    const existing = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (existing.length === 0) {
      await db.insert(profiles).values({ id: profileId, isAnonymous: nickname ? 0 : 1, nickname });
    } else if (nickname && !existing[0].nickname) {
      await db.update(profiles).set({ nickname }).where(eq(profiles.id, profileId));
    }
  }

  const partyId = crypto.randomUUID();
  const now = Date.now();

  let code = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    code = generatePartyCode();
    const conflict = await db.select().from(parties).where(eq(parties.code, code)).limit(1);
    if (conflict.length === 0) break;
    if (attempt === 4) return NextResponse.json({ error: "code-gen-failed" }, { status: 500 });
  }

  await db.batch([
    db.insert(parties).values({
      id: partyId, code, title,
      hostProfileId: profileId!,
      createdAt: now,
      expiresAt: now + PARTY_TTL_MS,
    }),
    db.insert(partyMembers).values({
      partyId, profileId: profileId!, role: "host",
    }),
  ]);

  return NextResponse.json({ id: partyId, code, title, createdAt: now, expiresAt: now + PARTY_TTL_MS });
}
