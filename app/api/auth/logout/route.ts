import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { destroySession } from "@/lib/auth";

export const runtime = "edge";

export async function POST() {
  const env = getCloudflareContext().env as Env;
  await destroySession(env);
  return NextResponse.json({ ok: true });
}
