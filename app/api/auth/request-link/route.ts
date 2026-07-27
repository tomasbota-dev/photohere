import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { magicLinks } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/resend";
import { MAGIC_LINK_TTL_MS } from "@/lib/constants";
import { sha256, randomToken } from "@/lib/utils";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getCloudflareContext().env as Env;
  const body: any = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "invalid-email" }, { status: 400 });

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + MAGIC_LINK_TTL_MS;
  const db = getDb(env);
  await db.insert(magicLinks).values({ tokenHash, profileId, email, expiresAt });

  const url = `${env.APP_URL}/auth/verify?token=${token}`;
  try {
    await sendMagicLinkEmail(env, email, url);
  } catch {
    return NextResponse.json({ error: "send-failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
