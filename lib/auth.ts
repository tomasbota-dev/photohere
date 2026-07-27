import { cookies } from "next/headers";
import { getDb, type Env } from "./db";
import { sessions, profiles, partyMembers, photos, likes, comments } from "./schema";
import { eq, and } from "drizzle-orm";
import { SESSION_TTL_MS } from "./constants";
import { sha256, randomToken } from "./utils";

export const SESSION_COOKIE = "ph_session";
export const PROFILE_COOKIE = "ph_profile";

export async function getOrMintProfile(env: Env): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(PROFILE_COOKIE)?.value;
  if (existing) return existing;

  const profileId = crypto.randomUUID();
  cookieStore.set(PROFILE_COOKIE, profileId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  const db = getDb(env);
  await db.insert(profiles).values({ id: profileId, isAnonymous: 1 });

  return profileId;
}

export async function getCurrentProfileId(env: Env): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(PROFILE_COOKIE)?.value ?? null;
}

export async function issueSession(env: Env, profileId: string): Promise<void> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const db = getDb(env);
  await db.insert(sessions).values({ tokenHash, profileId, expiresAt });

  const cookieStore = await cookies();
  cookieStore.set(PROFILE_COOKIE, profileId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
    path: "/",
  });
}

export async function getCurrentProfileIdFromSession(env: Env): Promise<{ profileId: string; sessionId: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tokenHash = await sha256(token);
  const db = getDb(env);
  const rows = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    return null;
  }
  const newExp = Date.now() + SESSION_TTL_MS;
  await db.update(sessions).set({ expiresAt: newExp }).where(eq(sessions.tokenHash, tokenHash));

  const cookieStore = await cookies();
  cookieStore.set(PROFILE_COOKIE, row.profileId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  return { profileId: row.profileId, sessionId: row.tokenHash };
}

export async function destroySession(env: Env): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = await sha256(token);
    const db = getDb(env);
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function mergeProfiles(env: Env, anonProfileId: string, authProfileId: string): Promise<void> {
  const db = getDb(env);
  await db.transaction(async (tx) => {
    const memberships = await tx.select().from(partyMembers).where(eq(partyMembers.profileId, anonProfileId));
    for (const m of memberships) {
      await tx.delete(partyMembers).where(and(eq(partyMembers.partyId, m.partyId), eq(partyMembers.profileId, anonProfileId)));
      const existing = await tx.select().from(partyMembers).where(and(eq(partyMembers.partyId, m.partyId), eq(partyMembers.profileId, authProfileId))).limit(1);
      if (existing.length === 0) {
        await tx.insert(partyMembers).values({ partyId: m.partyId, profileId: authProfileId, role: m.role, joinedAt: m.joinedAt });
      }
    }
    await tx.update(photos).set({ uploaderProfileId: authProfileId }).where(eq(photos.uploaderProfileId, anonProfileId));
    const likeRows = await db.select().from(likes).where(eq(likes.profileId, anonProfileId));
    for (const l of likeRows) {
      await tx.delete(likes).where(and(eq(likes.photoId, l.photoId), eq(likes.profileId, anonProfileId)));
      const existingLike = await tx.select().from(likes).where(and(eq(likes.photoId, l.photoId), eq(likes.profileId, authProfileId))).limit(1);
      if (existingLike.length === 0) {
        await tx.insert(likes).values({ photoId: l.photoId, profileId: authProfileId, createdAt: l.createdAt });
      }
    }
    await tx.update(comments).set({ profileId: authProfileId }).where(eq(comments.profileId, anonProfileId));
    await tx.delete(profiles).where(eq(profiles.id, anonProfileId));
  });
}

export async function getEffectiveProfileId(env: Env): Promise<string | null> {
  const fromSession = await getCurrentProfileIdFromSession(env);
  if (fromSession) return fromSession.profileId;
  return getCurrentProfileId(env);
}
