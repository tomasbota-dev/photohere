import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { destroySession } from "@/lib/auth";

export const runtime = "edge";

export async function POST() {
  const env = getRequestContext().env as Env;
  await destroySession(env);
  return NextResponse.json({ ok: true });
}
