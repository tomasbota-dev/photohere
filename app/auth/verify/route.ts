import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { magicLinks, profiles } from "@/lib/schema";
import { getEffectiveProfileId, issueSession, mergeProfiles } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { sha256 } from "@/lib/utils";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return NextResponse.redirect(`${env.APP_URL}/auth/request?error=missing-token`);

  const tokenHash = await sha256(token);
  const db = getDb(env);
  const rows = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, tokenHash)).limit(1);
  if (rows.length === 0) return NextResponse.redirect(`${env.APP_URL}/auth/request?error=invalid`);
  const link = rows[0];
  if (link.used) return NextResponse.redirect(`${env.APP_URL}/auth/request?error=used`);
  if (link.expiresAt < Date.now()) return NextResponse.redirect(`${env.APP_URL}/auth/request?error=expired`);

  const anonProfileId = await getEffectiveProfileId(env);
  const targetEmail = link.email;

  const existing = await db.select().from(profiles).where(eq(profiles.email, targetEmail)).limit(1);
  let finalProfileId: string;
  if (existing.length === 0) {
    if (anonProfileId) {
      await db.update(profiles).set({ email: targetEmail, isAnonymous: 0 }).where(eq(profiles.id, anonProfileId));
      finalProfileId = anonProfileId;
    } else {
      finalProfileId = crypto.randomUUID();
      await db.insert(profiles).values({ id: finalProfileId, email: targetEmail, isAnonymous: 0 });
    }
  } else {
    finalProfileId = existing[0].id;
    if (anonProfileId && anonProfileId !== finalProfileId) {
      await mergeProfiles(env, anonProfileId, finalProfileId);
    }
  }

  await db.update(magicLinks).set({ used: 1 }).where(eq(magicLinks.tokenHash, tokenHash));
  await issueSession(env, finalProfileId);

  return NextResponse.redirect(`${env.APP_URL}/me`);
}
