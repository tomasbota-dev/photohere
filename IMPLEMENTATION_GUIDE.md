# photohere — Implementation Guide

> **For the implementing model:** Read this document top to bottom before writing a single line of code. Do not skip steps. Do not reorder steps. Do not inlinearchitectural decisions of your own. If anything is ambiguous, follow the most literal reading of `PLAN.md` + this document. Everything below is prescriptive.

This guide produces a working MVP of `photohere`: a Next.js 15 app deployed to Cloudflare Workers, backed by D1 + R2, with Resend magic-link auth, party-gated photo galleries, optimistic likes/comments, host powers, a 90-day auto-delete cron, and zero-cost-at-MVP.

The repo lives at `/home/nexus/Desktop/projects/photohere` and is currently on git branch `plan/photohere-implementation`. Create a `feat/build` branch off `plan/photohere-implementation` before writing any code (instruction in step 0).

---

## 0. Pre-flight

0.1. Confirm you are in `/home/nexus/Desktop/projects/photohere`.
0.2. Confirm the working tree is clean (`git status`).
0.3. Create and switch to a new branch: `git checkout -b feat/build`.
0.4. Confirm Node.js ≥ 20.11 is installed (`node -v`); if not, do not proceed.
0.5. Confirm `wrangler` is installable; do not install yet — it will be a dev dependency in step 1.

The remainder is a linear sequence. Do not parallelize non-adjacent steps unless explicitly noted.

---

## 1. Scaffold the Next.js project

Use `create-next-app` with exact flags. Do not deviate.

1.1. From the repo root, run:

```
npx create-next-app@latest . --typescript --tailwind --app --src-dir=no --import-alias "@/*" --no-eslint --use-npm --no-turbopack
```

If `create-next-app` refuses because the directory is non-empty (it contains `LICENSE`, `README.md`, `PLAN.md`, `IMPLEMENTATION_GUIDE.md`, `.git`), answer **Yes** to proceed — those files are additive and will not conflict.

1.2. After scaffold, verify `package.json` exists with `next`, `react`, `react-dom`, `typescript`, `tailwindcss`.

1.3. Remove the default `app/page.tsx` boilerplate and the default `appglobals.css` contents; we replace them in step 7.

1.4. Verify `tsconfig.json` has `"paths": { "@/*": ["./*"] }`. If `create-next-app` placed source under a `src/` dir, do not move it — that contradicts our `--src-dir=no` flag; if it did, delete and re-run the scaffold.

1.5. Commit: `git add -A && git commit -m "Scaffold Next.js 15 project"`.

---

## 2. Install dependencies

Run a single command; do not add libraries later unless instructed.

```
npm install drizzle-orm @aws-sdk/client-s3 @aws-sdk/s3-request-presigner jose resend lucide-react clsx tailwind-merge nanoid @aws-sdk/types
npm install -D drizzle-kit wrangler @cloudflare/next-on-pages @opennextjs/cloudflare better-sqlite3 @types/better-sqlite3
```

Notes:
- `jose` is for JWT/session tokens (edge-compatible, uses WebCrypto).
- `nanoid` for short URL-safe IDs; we will also use `crypto.randomUUID()` where appropriate.
- `better-sqlite3` is local-dev only (D1 emulation).
- `@opennextjs/cloudflare` is the deploy adapter.

2.1. Commit: `git add -A && git commit -m "Install runtime and dev dependencies"`.

---

## 3. Configure Cloudflare (`wrangler.toml`)

Create `wrangler.toml` at repo root with exactly this content:

```toml
name = "photohere"
compatibility_date = "2025-01-15"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".open-next"

[vars]
APP_URL = "http://localhost:3000"
RESEND_FROM = "onboarding@resend.dev"

[[d1_databases]]
binding = "DB"
database_name = "photohere-db"
database_id = "placeholder-replace-after-create"
migrations_dir = "drizzle"

[[r2_buckets]]
binding = "PHOTOS_BUCKET"
bucket_name = "photohere-photos"

[triggers]
crons = ["0 3 * * *"]
```

3.1. Do not create the actual D1 / R2 resources yet — that happens in step 29 (deploy). The `database_id` placeholder is fine locally; we use `wrangler d1 migrations apply --local` for local dev.

3.2. Commit: `git add -A && git commit -m "Add wrangler.toml with D1, R2, cron bindings"`.

---

## 4. Configure Next.js for OpenNext (Cloudflare)

4.1. Replace `next.config.mjs` with:

```js
import type { NextConfig } from "next";

const config: NextConfig = {
  images: {
    unoptimized: true,
  },
  experimental: {
    nodeMiddleware: false,
  },
};

export default config;
```

Rationale: We disable `next/image` optimizer because Cloudflare Workers does not run the Next image optimization server. We serve R2 originals and rely on `<img loading="lazy" decoding="async">` + presigned URLs. Do not enable `remotePatterns`.

4.2. Create `open-next.config.ts` at repo root:

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
```

4.3. Add to `package.json` scripts:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "build:worker": "opennextjs-cloudflare && wrangler pages build",
  "preview": "wrangler pages dev",
  "deploy": "opennextjs-cloudflare && wrangler pages deploy",
  "db:generate": "drizzle-kit generate",
  "db:migrate:local": "wrangler d1 migrations apply photohere-db --local",
  "db:migrate:remote": "wrangler d1 migrations apply photohere-db --remote"
}
```

(Do not remove existing `scripts`; merge.)

4.4. Commit: `git add -A && git commit -m "Configure OpenNext adapter for Cloudflare"`.

---

## 5. Environment files

5.1. Create `.env.example`:

```
# Auth — 32-byte random hex (generate with: openssl rand -hex 32)
AUTH_SECRET=

# Resend — get from https://resend.com/api-keys
RESEND_API_KEY=
RESEND_FROM=onboarding@resend.dev

# Public app URL (used to build magic-link URLs)
APP_URL=http://localhost:3000

# Cron secret — 32-byte random hex; header required by /api/cron/sweep
CRON_SECRET=
```

5.2. Create `.env.local` with real placeholders for local dev (DO NOT commit it). The `.gitignore` from `create-next-app` already ignores `.env.local`. Also ignore `.env`:

Edit `.gitignore` and add (if not present):
```
.env
.env.*.local
.wrangler/
.open-next/
drizzle/meta/
```

5.3. Commit only `.env.example` and `.gitignore` updates: `git add -A && git commit -m "Add env example and gitignore patterns"`.

---

## 6. Tailwind v4 setup

6.1. Confirm `create-next-app` installed Tailwind v4. Inspect `package.json` — `tailwindcss` should be `^4.x`. If not, upgrade: `npm install -D tailwindcss@latest @tailwindcss/postcss@latest postcss@latest`.

6.2. Replace `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

6.3. Create `appglobals.css` (note: no `/` separator — this is the App Router root stylesheet name `app/globals.css`):

Wait — the file lives at `app/globals.css`. Use that exact path. Replace its contents with:

```css
@import "tailwindcss";

@theme {
  --color-background: #fafaf9;
  --color-foreground: #0a0a0b;
  --color-accent: #6366f1;
  --color-accent-foreground: #ffffff;
  --color-muted: #f5f5f4;
  --color-muted-foreground: #737373;
  --color-border: #e7e5e4;
  --color-radius: 0.75rem;
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;
}

@layer dark {
  @theme {
    --color-background: #0a0a0b;
    --color-foreground: #fafaf9;
    --color-accent: #6366f1;
    --color-accent-foreground: #ffffff;
    --color-muted: #18181b;
    --color-muted-foreground: #a1a1aa;
    --color-border: #27272a;
  }
}

html, body {
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

6.4. Install Geist fonts via `next/font` (已是 Next 15 内置): we'll wire them in step 7.3 in `app/layout.tsx`.

6.5. Delete `tailwind.config.ts` if it exists (Tailwind v4 is config-less; we use `@theme` in CSS).

6.6. Commit: `git add -A && git commit -m "Configure Tailwind v4 with theme tokens"`.

---

## 7. Root layout + providers

7.1. Create `app/providers.tsx`:

```tsx
"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
```

7.2. Install `next-themes`: `npm install next-themes`.

7.3. Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "photohere",
  description: "Create a party, share the code, collect every photo from everyone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

7.4. Install `geist`: `npm install geist`.

7.5. Commit: `git add -A && git commit -m "Wire Geist fonts and ThemeProvider in root layout"`.

---

## 8. shadcn/ui init

8.1. Run:

```
npx shadcn@latest init -d
```

Answer any prompts as: style = `new-york`, base color = `neutral`, CSS variables = yes. Do not let it touch `tailwind.config.ts` (we deleted it). If it errors due to no Tailwind config, create a minimal `tailwind.config.ts` empty (`export default {};`) only to satisfy the CLI, then delete it again afterward.

8.2. Components to install:

```
npx shadcn@latest add button input dialog toast tooltip skeleton dropdown-menu avatar label
```

8.3. Confirm `components/ui/` exists with the expected files. Do not edit them.

8.4. Commit: `git add -A && git commit -m "Init shadcn/ui and add base components"`.

---

## 9. Drizzle schema + config

9.1. Create `lib/schema.ts`:

```ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

const now = () => sql`(unixepoch() * 1000)`;

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  email: text("email").unique(),
  createdAt: integer("created_at").notNull().default(now),
  isAnonymous: integer("is_anonymous").notNull().default(1),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  profileId: text("profile_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const magicLinks = sqliteTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  profileId: text("profile_id").notNull(),
  email: text("email").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used").notNull().default(0),
});

export const parties = sqliteTable("parties", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  hostProfileId: text("host_profile_id").notNull(),
  createdAt: integer("created_at").notNull().default(now),
  expiresAt: integer("expires_at").notNull(),
});

export const partyMembers = sqliteTable("party_members", {
  partyId: text("party_id").notNull(),
  profileId: text("profile_id").notNull(),
  role: text("role").notNull(),
  joinedAt: integer("joined_at").notNull().default(now),
}, (t) => [primaryKey({ columns: [t.partyId, t.profileId] })]);

export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  partyId: text("party_id").notNull(),
  uploaderProfileId: text("uploader_profile_id").notNull(),
  r2Key: text("r2_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  bytes: integer("bytes").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const likes = sqliteTable("likes", {
  photoId: text("photo_id").notNull(),
  profileId: text("profile_id").notNull(),
  createdAt: integer("created_at").notNull().default(now),
}, (t) => [primaryKey({ columns: [t.photoId, t.profileId] })]);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  photoId: text("photo_id").notNull(),
  profileId: text("profile_id").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});
```

9.2. Create `drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
```

9.3. Run `npm run db:generate` to produce the first migration in `drizzle/`. Inspect the generated SQL — it should be a single `CREATE TABLE` chain. If Drizzle emits `CREATE TABLE` with `current_timestamp` instead of `unixepoch()`, manually edit the migration SQL to use `(unixepoch() * 1000)` for `created_at` defaults. Do not regenerate; just patch.

9.4. Commit: `git add -A && git commit -m "Add Drizzle schema and initial migration"`.

---

## 10. D1 client + bindings

10.1. Create `lib/db.ts`:

```ts
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface Env {
  DB: D1Database;
  PHOTOS_BUCKET: R2Bucket;
  AUTH_SECRET: string;
  RESEND_API_KEY: string;
  RESEND_FROM: string;
  APP_URL: string;
  CRON_SECRET: string;
}

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}
```

10.2. Create `lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data).then((buf) =>
    Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
  );
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map((b) => b.toString(16).padStart(2, "")).join("");
}
```

10.3. Commit: `git add -A && git commit -m "Add D1 client and crypto utils"`.

---

## 11. Constants

11.1. Create `lib/constants.ts`:

```ts
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PARTY_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export const UPLOAD_URL_TTL_SEC = 5 * 60;            // 5 min
export const READ_URL_TTL_SEC = 10 * 60;             // 10 min
export const ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;   // 24 h
export const RATE_LIMIT_UPLOADS_PER_MIN = 10;

const BASE32_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0/O,1/I/L,U
export function generatePartyCode(len = 6): string {
  let s = "";
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  for (let i = 0; i < len; i++) s += BASE32_ALPHABET[a[i] % BASE32_ALPHABET.length];
  return s;
}
```

11.2. Commit: `git add -A && git commit -m "Add app constants and party-code generator"`.

---

## 12. Auth library

12.1. Create `lib/auth.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, type Env } from "./db";
import { sessions, profiles } from "./schema";
import { eq, and, lt, gt } from "drizzle-orm";
import { SESSION_TTL_MS, SESSION_COOKIE, MAGIC_LINK_TTL_MS } from "./constants";
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
    maxAge: 60 * 60 * 24 * 365, // 1 year cookie lifetime; profile lives forever
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

  // Bind profile cookie to this profile id explicitly
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
  // Slide expiry
  const newExp = Date.now() + SESSION_TTL_MS;
  await db.update(sessions).set({ expiresAt: newExp }).where(eq(sessions.tokenHash, tokenHash));

  // Also ensure profileId cookie matches
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

// Merge anonymous profile into the existing authenticated profile.
export async function mergeProfiles(env: Env, anonProfileId: string, authProfileId: string): Promise<void> {
  const db = getDb(env);
  const jr = await db.transaction(async (tx) => {
    // Party memberships — dedup PK if member already joined the same party on the auth profile
    const memberships = await tx.select().from(partyMembers).where(eq(partyMembers.profileId, anonProfileId));
    for (const m of memberships) {
      await tx.delete(partyMembers).where(and(eq(partyMembers.partyId, m.partyId), eq(partyMembers.profileId, anonProfileId)));
      const existing = await tx.select().from(partyMembers).where(and(eq(partyMembers.partyId, m.partyId), eq(partyMembers.profileId, authProfileId))).limit(1);
      if (existing.length === 0) {
        await tx.insert(partyMembers).values({ partyId: m.partyId, profileId: authProfileId, role: m.role, joinedAt: m.joinedAt });
      }
    }
    // Photos
    await tx.update(photos).set({ uploaderProfileId: authProfileId }).where(eq(photos.uploaderProfileId, anonProfileId));
    // Likes — dedup PK
    const likeRows = await db.select().from(likes).where(eq(likes.profileId, anonProfileId));
    for (const l of likeRows) {
      await tx.delete(likes).where(and(eq(likes.photoId, l.photoId), eq(likes.profileId, anonProfileId)));
      const existingLike = await tx.select().from(likes).where(and(eq(likes.photoId, l.photoId), eq(likes.profileId, authProfileId))).limit(1);
      if (existingLike.length === 0) {
        await tx.insert(likes).values({ photoId: l.photoId, profileId: authProfileId, createdAt: l.createdAt });
      }
    }
    // Comments
    await tx.update(comments).set({ profileId: authProfileId }).where(eq(comments.profileId, anonProfileId));
    // Delete anon profile
    await tx.delete(profiles).where(eq(profiles.id, anonProfileId));
  });
  return jr;
}
```

Imports: add `import { partyMembers, photos, likes, comments } from "./schema";` at top, and `import { eq, and } from "drizzle-orm";`. The example above references these.

12.2. Project the actual profileId (combining session + cookie fallback). Create `getCurrentProfileId` that prefers session-validated profile, then falls back to cookie:

```ts
export async function getEffectiveProfileId(env: Env): Promise<string | null> {
  const fromSession = await getCurrentProfileIdFromSession(env);
  if (fromSession) return fromSession.profileId;
  return getCurrentProfileId(env);
}
```

(Reads like async-fns; `getCurrentProfileId(env)` returns a Promise — wrap accordingly. If it returns `null` and the request needs a profile, the route should mint one (see middleware step 13).)

12.3. Commit: `git add -A && git commit -m "Add auth library: profiles, sessions, magic-link merge"`.

---

## 13. Middleware (anonymous profile mint)

13.1. Create `middleware.ts` at repo root:

```ts
import { NextResponse, type NextRequest } from "next/server";

const PROFILE_COOKIE = "ph_profile";

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get(PROFILE_COOKIE)?.value) {
    res.cookies.set(PROFILE_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!api/cron|_next/static|_next/image|favicon.ico).*)"],
};
```

Notes: Middleware runs on every page request. We do NOT create the DB `profiles` row here — that would double-write. Instead, the `/api/me` route lazily upserts the profile row when called with a cookie value that has no row. This avoids writing on every middleware hit (D1 free write budget is 100k/day).

13.2. Commit: `git add -A && git commit -m "Add middleware to mint anonymous profile cookie"`.

---

## 14. `/api/me` route

14.1. Create `app/api/me/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { profiles, parties, partyMembers } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request, env: Env) {
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json(null);
  const db = getDb(env);
  // Lazy-ensure profile exists (middleware does NOT write DB)
  const existing = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (existing.length === 0) {
    await db.insert(profiles).values({ id: profileId, isAnonymous: 1 });
  }
  const p = existing[0] ?? { id: profileId, email: null, isAnonymous: 1, createdAt: Date.now() };

  // My parties (joins party_members <-> parties, order by created_at desc)
  const myParties = await db.select({
    id: parties.id,
    code: parties.code,
    title: parties.title,
    role: partyMembers.role,
    createdAt: parties.createdAt,
    expiresAt: parties.expiresAt,
  })
  .from(partyMembers)
  .innerJoin(parties, eq(partyMembers.partyId, parties.id))
  .where(eq(partyMembers.profileId, profileId))
  .orderBy(desc(parties.createdAt));

  return NextResponse.json({
    profileId: p.id,
    email: p.email,
    isAnonymous: !!p.isAnonymous,
    parties: myParties,
  });
}
```

14.2. Commit: `git add -A && git commit -m "Add /api/me route"`.

Note on OpenNext bindings: For the API routes to receive `env` as the second arg in the edge handler signature, we must export them in a way OpenNext understands. The simplest workable pattern on `@opennextjs/cloudflare` is to read the env from `process.env`-injected globals, OR use the `getRequestContext()` from `@opennextjs/cloudflare` (the package exports `getRequestContext()` which gives access to the env). Use `getRequestContext()` to obtain bindings:

14.3. Replace env-usage pattern in all routes. Each route must begin with:

```ts
import { getRequestContext } from "@opennextjs/cloudflare";
// inside handler:
const env = getRequestContext().env as Env;
```

Apply this to `/api/me` and all subsequent routes. Update the handler signatures to `export async function GET(req: Request)` (drop the env param). Apply this refactor consistently.

14.4. Re-commit: `git add -A && git commit -m "Use getRequestContext() for env bindings"`.

---

## 15. `lib/jwt.ts` (magic-link helpers)

15.1. Create `lib/jwt.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "./db";

export function getJwtSecret(env: Env): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

export async function signMagicLinkToken(env: Env, payload: object, ttlSec: number): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec} sec`)
    .sign(getJwtSecret(env));
}

export async function verifyMagicLinkToken(env: Env, token: string): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(env));
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

魔力链接不使用 JWT — 我们使用存储在 `magic_links` 中的不透明令牌。JWT 路径在这里是不必要的；我们已经通过 DB 行验证。从 codebase 中移除 `lib/jwt.ts`。不要导入它。

15.2. Commit: `git add -A && git commit -m "Remove unused JWT helpers (magic links use opaque DB tokens)""`.

---

## 16. `lib/resend.ts`

16.1. Create `lib/resend.ts`:

```ts
import { Resend } from "resend";
import type { Env } from "./db";

export function getResend(env: Env): Resend {
  return new Resend(env.RESEND_API_KEY);
}

export async function sendMagicLinkEmail(env: Env, toEmail: string, magicUrl: string): Promise<void> {
  const resend = getResend(env);
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to: toEmail,
    subject: "Sign in to photohere",
    html: `<p>Tap the link below to sign in to photohere.</p><p><a href="${magicUrl}">${magicUrl}</a></p><p style="color:#888;font-size:12px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`,
  }, { tags: [{ name: "type", value: "magic-link" }] });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
```

16.2. Commit: `git add -A && git commit -m "Add Resend client wrapper"`.

---

## 17. `lib/r2.ts` (presigned URLs)

17.1. Create `lib/r2.ts`:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "./db";
import { UPLOAD_URL_TTL_SEC, READ_URL_TTL_SEC } from "./constants";

// R2 endpoint shape: https://<accountid>.r2.cloudflarestorage.com
// We hardcode via env-bound constants? Cloudflare R2 does NOT auto-ship account-id; we must read it.
// We'll add an env var R2_ACCOUNT_ID below — include in Env type and .env.example.

export function getR2Client(env: Env): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflatestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

export async function presignPut(env: Env, key: string, contentType: string, contentLength: number): Promise<string> {
  const client = getR2Client(env);
  const cmd = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, cmd, { expiresIn: UPLOAD_URL_TTL_SEC });
}

export async function presignGet(env: Env, key: string, download = false): Promise<string> {
  const client = getR2Client(env);
  const cmd = new GetObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    ...(download ? { ResponseContentDisposition: `attachment; filename="${encodeURIComponent(key.split("/").pop())}"` } : {}),
  });
  return getSignedUrl(client, cmd, { expiresIn: READ_URL_TTL_SEC });
}
```

17.2. Update `lib/db.ts` `Env` interface to add (do NOT remove existing fields):

```ts
R2_ACCOUNT_ID: string;
R2_ACCESS_KEY_ID?: string;
R2_SECRET_ACCESS_KEY?: string;
R2_BUCKET_NAME: string;
```

Notes for the implementing model — reconcile the dual binding approach: when running on Workers, R2 is bound as `env.PHOTOS_BUCKET` (an `R2Bucket` interface) and we can call `env.PHOTOS_BUCKET.put()` directly without S3 SDK. When generating **presigned URLs**, however, the bound bucket interface does NOT sign URLs — we must use S3-compatible access keys. Two configurations:

  (a) Direct bucket access for server-side operations (upload verification HEAD, list, delete, etc.) via `env.PHOTOS_BUCKET.get/head/list/delete`.
  (b) S3 SDK only for signing presigned URLs.

Use both. Keep `presignPut` and `presignGet` using S3 SDK as written above. For server-side operations elsewhere, use `env.PHOTOS_BUCKET.<method>()` directly.

17.3. Add the new env vars to `.env.example`:

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=photohere-photos
```

17.4. Add the same keys to `wrangler.toml` `[vars]` (without secrets — actual access keys should be `wrangler secret put`, but for local dev we read from `.env.local`). For OpenNext / Workers, place R2 credentials as **secrets** (`wrangler secret put R2_ACCESS_KEY_ID` etc.), not `vars`. Document this in `.env.example` comments.

17.5. Commit: `git add -A && git commit -m "Add R2 presigned URL helpers and S3 env"`.

---

## 18. `lib/types.ts`

18.1. Create `lib/types.ts` so routes share response shapes:

```ts
export interface PartySummary {
  id: string;
  code: string;
  title: string;
  role: "host" | "member";
  createdAt: number;
  expiresAt: number;
}

export interface PhotoRow {
  id: string;
  partyId: string;
  uploaderProfileId: string;
  uploaderNickname: string | null;
  r2Key: string;
  width: number | null;
  height: number | null;
  bytes: number;
  contentType: string;
  createdAt: number;
  liked: boolean;
  likeCount: number;
  commentCount: number;
}

export interface CommentRow {
  id: string;
  photoId: string;
  profileId: string;
  profileNickname: string | null;
  body: string;
  createdAt: number;
}
```

We don't currently store `nickname` on `profiles`. Add a `nickname` column to the schema: `text("nickname")` (nullable, optional). Update `lib/schema.ts` and regenerate the migration. Update step 9.1 — but for forward consistency, modify it now:

18.2. Edit `lib/schema.ts` and add `nickname: text("nickname")` to the `profiles` table. Then regenerate the migration: `npm run db:generate`. This will produce migration `0001_*`. Inspect SQL — should be `ALTER TABLE profiles ADD COLUMN nickname TEXT;`

18.3. Commit: `git add -A && git commit -m "Add nickname column to profiles, regenerate migration"`.

Note: Profile nickname is set when the user creates their first party or joins one — we'll prompt on create/join form. For anonymous users, allow blank and store `null`.

---

## 19. `/api/party` create route (POST)

19.1. Create `app/api/party/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { generatePartyCode, PARTY_TTL_MS } from "@/lib/constants";
import { eq } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim().slice(0, 80);
  const nickname = String(body.nickname ?? "").trim().slice(0, 40) || null;
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  let profileId = await getEffectiveProfileId(env);
  const db = getDb(env);

  // Lazy-create profile row if missing
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

  // Generate a unique code with retry
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
```

19.2. Commit: `git add -A && git commit -m "Add /api/party POST (create)"`.

---

## 20. `/api/party/join` route

20.1. Create `app/api/party/join/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const code = String(body.code ?? "").toUpperCase().trim();
  const nickname = String(body.nickname ?? "").trim().slice(0, 40) || null;
  if (!code) return NextResponse.json({ error: "code required" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, code)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  let profileId = await getEffectiveProfileId(env);
  if (!profileId) {
    profileId = await getOrMintProfile(env);
  } else {
    // Lazy-ensure row exists
    const existing = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
    if (existing.length === 0) {
      await db.insert(profiles).values({ id: profileId, isAnonymous: nickname ? 0 : 1, nickname });
    } else if (nickname && !existing[0].nickname) {
      await db.update(profiles).set({ nickname }).where(eq(profiles.id, profileId));
    }
  }

  const alreadyMember = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (alreadyMember.length === 0) {
    await db.insert(partyMembers).values({ partyId: party.id, profileId, role: "member" });
  }

  return NextResponse.json({ id: party.id, code: party.code, title: party.title, createdAt: party.createdAt, expiresAt: party.expiresAt });
}
```

20.2. Commit: `git add -A && git commit -m "Add /api/party/join POST"`.

---

## 21. `/create` and `/j/[code]` pages

21.1. Create `components/create-form.tsx` (client):

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export function CreateForm() {
  const r = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/party", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, nickname }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not create party", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <label className="text-sm font-medium">Party title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sam & Alex's Wedding" maxLength={80} required />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Your name (optional)</label>
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Creating…" : "Create party"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Parties and all photos are automatically deleted 90 days after creation.
      </p>
    </form>
  );
}
```

(For the toast hook, `useToast` comes from shadcn's `use-toast.ts` — that file is auto-created by the `toast` component install. If not, run `npx shadcn@latest add toast` again; otherwise create `components/ui/use-toast.ts` from the shadcn source verbatim.)

21.2. Create `app/create/page.tsx`:

```tsx
import { CreateForm } from "@/components/create-form";

export default function CreatePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Create a party</h1>
          <p className="text-sm text-muted-foreground">Share the code. Everyone uploads. Everyone downloads.</p>
        </header>
        <CreateForm />
      </section>
    </main>
  );
}
```

21.3. Create `components/join-form.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const r = useRouter();
  const { toast } = useToast();
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const res = await fetch("/api/party/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, nickname }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      toast({ title: "Could not join", description: data.error });
      return;
    }
    r.push(`/p/${data.code}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-sm">
      <div className="space-y-2">
        <label className="text-sm font-medium">Party code</label>
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AB3X9K" maxLength={6} required className="font-mono uppercase" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Your name (optional)</label>
        <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Sam" maxLength={40} />
      </div>
      <Button type="submit" disabled={submitting} className="w-full">{submitting ? "Joining…" : "Join party"}</Button>
    </form>
  );
}
```

21.4. Create `app/j/[code]/page.tsx`:

```tsx
import { JoinForm } from "@/components/join-form";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Join party</h1>
          <p className="text-sm text-muted-foreground">You're joining party <span className="font-mono">{code.toUpperCase()}</span></p>
        </header>
        <JoinForm initialCode={code} />
      </section>
    </main>
  );
}
```

21.5. Replace `app/page.tsx` (landing) with a slick hero:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JoinForm } from "@/components/join-form";

export default function Home() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-16 lg:py-24 space-y-16">
        <header className="flex items-center justify-between">
          <span className="font-mono text-sm tracking-tight">photohere</span>
          <Link href="/auth/request" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </header>

        <section className="max-w-2xl space-y-8">
          <h1 className="text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05]">
            Every photo from everyone. <span className="text-muted-foreground">One link.</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Create a party. Share the code. Guests upload, like, comment and download. Auto-deletes in 90 days.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/create"><Button size="lg">Create a party</Button></Link>
          </div>
        </section>

        <section className="max-w-md space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Have a code?</h2>
          <JoinForm />
        </section>
      </div>
    </main>
  );
}
```

21.6. Commit: `git add -A && git commit -m "Add landing, /create, and /j/[code] pages"`.

---

## 22. `/api/upload-url` route

22.1. Create `app/api/upload-url/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, photos } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES, RATE_LIMIT_UPLOADS_PER_MIN, UPLOAD_URL_TTL_SEC } from "@/lib/constants";
import { presignPut } from "@/lib/r2";
import { eq, and, gte, desc } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const contentType = String(body.contentType ?? "");
  const contentLength = Number(body.contentLength ?? 0);

  if (!partyCode || !contentType || !contentLength) return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  if (contentLength > MAX_PHOTO_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });
  if (!contentType.startsWith("image/")) return NextResponse.json({ error: "not-image" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env) ?? (await getOrMintProfile(env));
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  // Rate limit: uploads within last 1 min by this profile in this party
  const since = Date.now() - 60_000;
  const recent = await db.select({ id: photos.id }).from(photos)
    .where(and(eq(photos.uploaderProfileId, profileId), gte(photos.createdAt, since), eq(photos.partyId, party.id))).limit(RATE_LIMIT_UPLOADS_PER_MIN + 1);
  if (recent.length >= RATE_LIMIT_UPLOADS_PER_MIN) return NextResponse.json({ error: "rate-limited" }, { status: 429 });

  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
  const key = `parties/${party.id}/${crypto.randomUUID()}.${ext}`;
  const uploadUrl = await presignPut(env, key, contentType, contentLength);

  return NextResponse.json({ uploadUrl, key, partyId: party.id, expiresIn: UPLOAD_URL_TTL_SEC });
}
```

22.2. Commit: `git add -A && git commit -m "Add /api/upload-url (presigned PUT)"`.

---

## 23. `/api/photos` GET + POST

23.1. Create `app/api/photos/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { photos, partyMembers, parties, likes, comments, profiles } from "@/lib/schema";
import { getEffectiveProfileId, getOrMintProfile } from "@/lib/auth";
import { MAX_PHOTO_BYTES } from "@/lib/constants";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const partyCode = (url.searchParams.get("party") ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "party required" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const rows = await db.select({
    id: photos.id, partyId: photos.partyId, uploaderProfileId: photos.uploaderProfileId,
    r2Key: photos.r2Key, width: photos.width, height: photos.height, bytes: photos.bytes,
    contentType: photos.contentType, createdAt: photos.createdAt,
    uploaderNickname: profiles.nickname,
  })
  .from(photos)
  .leftJoin(profiles, eq(photos.uploaderProfileId, profiles.id))
  .where(eq(photos.partyId, party.id))
  .orderBy(desc(photos.createdAt));
  if (rows.length === 0) return NextResponse.json({ photos: [] });

  const photoIds = rows.map((r) => r.id);
  const likeCounts = await db.select({
    photoId: likes.photoId, count: sql<number>`count(*)`.as("count"),
  }).from(likes).where(inArray(likes.photoId, photoIds)).groupBy(likes.photoId);
  const likeCountMap = new Map(likeCounts.map((r) => [r.photoId, Number(r.count)]));

  const likedByMe = profileId ? await db.select({ photoId: likes.photoId }).from(likes)
    .where(and(inArray(likes.photoId, photoIds), eq(likes.profileId, profileId))) : [];
  const likedSet = new Set(likedByMe.map((r) => r.photoId));

  const commentCounts = await db.select({
    photoId: comments.photoId, count: sql<number>`count(*)`.as("count"),
  }).from(comments).where(inArray(comments.photoId, photoIds)).groupBy(comments.photoId);
  const commentCountMap = new Map(commentCounts.map((r) => [r.photoId, Number(r.count)]));

  const out = rows.map((r) => ({
    ...r,
    uploaderNickname: r.uploaderNickname ?? null,
    liked: likedSet.has(r.id),
    likeCount: likeCountMap.get(r.id) ?? 0,
    commentCount: commentCountMap.get(r.id) ?? 0,
  }));

  return NextResponse.json({ photos: out });
}

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const key = String(body.key ?? "");
  const bytes = Number(body.bytes ?? 0);
  const contentType = String(body.contentType ?? "");
  const width = body.width ? Number(body.width) : null;
  const height = body.height ? Number(body.height) : null;
  if (!partyCode || !key || !bytes || !contentType) return NextResponse.json({ error: "missing-fields" }, { status: 400 });
  if (bytes > MAX_PHOTO_BYTES) return NextResponse.json({ error: "too-large" }, { status: 413 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];
  if (party.expiresAt < Date.now()) return NextResponse.json({ error: "expired" }, { status: 410 });

  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  // Verify object exists in R2 and size matches
  const head = await env.PHOTOS_BUCKET.head(key);
  if (!head) return NextResponse.json({ error: "object-not-found" }, { status: 404 });
  if (head.size !== bytes) return NextResponse.json({ error: "size-mismatch" }, { status: 400 });

  const id = crypto.randomUUID();
  await db.insert(photos).values({
    id, partyId: party.id, uploaderProfileId: profileId,
    r2Key: key, width, height, bytes, contentType,
  });
  return NextResponse.json({ id });
}
```

23.2. Commit: `git add -A && git commit -m "Add /api/photos GET + POST"`.

---

## 24. `/api/photo-url` and `/api/photo-download`

24.1. Create `app/api/photo-url/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { photos, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { presignGet } from "@/lib/r2";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
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
```

24.2. Create `app/api/photo-download/route.ts` — same as above but `presignGet(env, photo.r2Key, true)`.

24.3. Commit: `git add -A && git commit -m "Add /api/photo-url and /api/photo-download"`.

---

## 25. `/api/like` POST/DELETE

25.1. Create `app/api/like/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
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
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const photoId = String(body.photoId ?? "");
  if (!photoId) return NextResponse.json({ error: "photoId required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const guard = await assertMembership(env, photoId, profileId);
  if (!guard.ok) return NextResponse.json({ error: "forbidden" }, { status: guard.status });

  // Insert ignore on PK conflict
  const db = getDb(env);
  try {
    await db.insert(likes).values({ photoId, profileId });
  } catch {
    // Already liked — idempotent
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const env = getRequestContext().env as Env;
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
```

25.2. Commit: `git add -A && git commit -m "Add /api/like POST + DELETE"`.

---

## 26. `/api/comment` POST and `/api/comment/delete` POST

26.1. Create `app/api/comment/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { comments, photos, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and, desc } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const photoId = String(body.photoId ?? "");
  const text = String(body.body ?? "").trim().slice(0, 500);
  if (!photoId || !text) return NextResponse.json({ error: "fields required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const db = getDb(env);
  const photoRows = await db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
  if (photoRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photoRows[0].partyId), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const id = crypto.randomUUID();
  await db.insert(comments).values({ id, photoId, profileId, body: text });
  const profRows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  return NextResponse.json({
    id, photoId, profileId, profileNickname: profRows[0]?.nickname ?? null, body: text, createdAt: Date.now(),
  });
}

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const photoId = url.searchParams.get("photoId");
  if (!photoId) return NextResponse.json({ error: "photoId required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });

  const db = getDb(env);
  const photoRows = await db.select().from(photos).where(eq(photos.id, photoId)).limit(1);
  if (photoRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const memberRows = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, photoRows[0].partyId), eq(partyMembers.profileId, profileId))).limit(1);
  if (memberRows.length === 0) return NextResponse.json({ error: "not-member" }, { status: 403 });

  const rows = await db.select({
    id: comments.id, photoId: comments.photoId, profileId: comments.profileId,
    body: comments.body, createdAt: comments.createdAt, profileNickname: profiles.nickname,
  })
  .from(comments)
  .leftJoin(profiles, eq(comments.profileId, profiles.id))
  .where(eq(comments.photoId, photoId))
  .orderBy(desc(comments.createdAt));
  return NextResponse.json({ comments: rows });
}
```

26.2. Create `app/api/comment/delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
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
```

26.3. Commit: `git add -A && git commit -m "Add /api/comment POST+GET and /api/comment/delete POST"`.

---

## 27. `/api/photo/delete` POST (author-only)

27.1. Create `app/api/photo/delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { photos, likes, comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const rows = await db.select().from(photos).where(eq(photos.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const photo = rows[0];
  if (photo.uploaderProfileId !== profileId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Delete R2 object + cascading DB rows
  await env.PHOTOS_BUCKET.delete(photo.r2Key);
  await db.batch([
    db.delete(likes).where(eq(likes.photoId, id)),
    db.delete(comments).where(eq(comments.photoId, id)),
    db.delete(photos).where(eq(photos.id, id)),
  ]);
  return NextResponse.json({ ok: true });
}
```

27.2. Commit: `git add -A && git commit -m "Add /api/photo/delete (author-only, cascades)"`.

---

## 28. Party host powers: `/api/party/members`, `/api/party/kick`

28.1. Create `app/api/party/members/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function GET(req: Request) {
  const env = getRequestContext().env as Env;
  const url = new URL(req.url);
  const partyCode = (url.searchParams.get("party") ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "party required" }, { status: 400 });
  const profileId = await getEffectiveProfileId(env);
  if (!profileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const members = await db.select({
    profileId: partyMembers.profileId, role: partyMembers.role, joinedAt: partyMembers.joinedAt,
    nickname: profiles.nickname, email: profiles.email,
  })
  .from(partyMembers)
  .leftJoin(profiles, eq(partyMembers.profileId, profiles.id))
  .where(eq(partyMembers.partyId, party.id));

  return NextResponse.json({ members });
}
```

28.2. Create `app/api/party/kick/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, photos, likes, comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and, sql } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  const targetProfileId = String(body.profileId ?? "");
  if (!partyCode || !targetProfileId) return NextResponse.json({ error: "fields required" }, { status: 400 });
  const callerProfileId = await getEffectiveProfileId(env);
  if (!callerProfileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  if (callerProfileId === targetProfileId) return NextResponse.json({ error: "cannot-kick-self" }, { status: 400 });

  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, callerProfileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const target = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, targetProfileId))).limit(1);
  if (target.length === 0) return NextResponse.json({ error: "not-member" }, { status: 404 });
  if (target[0].role === "host") return NextResponse.json({ error: "cannot-kick-host" }, { status: 400 });

  await db.delete(partyMembers).where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, targetProfileId)));
  return NextResponse.json({ ok: true });
}
```

Note: Kicked users keep their photos, likes, and comments in the party (per "photo author owns photo" model). The host removes the *member*; the photos stay unless the author deletes them. Document this in the UI.

28.3. Also create `/api/party/delete` (host-only — deletes entire party + R2 sweep):

```ts
// app/api/party/delete/route.ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, photos, likes, comments } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
  const partyCode = String(body.partyCode ?? "").toUpperCase();
  if (!partyCode) return NextResponse.json({ error: "partyCode required" }, { status: 400 });
  const callerProfileId = await getEffectiveProfileId(env);
  if (!callerProfileId) return NextResponse.json({ error: "no-profile" }, { status: 401 });
  const db = getDb(env);
  const partyRows = await db.select().from(parties).where(eq(parties.code, partyCode)).limit(1);
  if (partyRows.length === 0) return NextResponse.json({ error: "not-found" }, { status: 404 });
  const party = partyRows[0];

  const caller = await db.select().from(partyMembers)
    .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, callerProfileId))).limit(1);
  if (caller.length === 0 || caller[0].role !== "host") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // R2 sweep all photos under prefix
  const photosRows = await db.select().from(photos).where(eq(photos.partyId, party.id));
  for (const p of photosRows) {
    await env.PHOTOS_BUCKET.delete(p.r2Key);
  }
  // Cascading DB cleanup
  const photoIds = photosRows.map((p) => p.id);
  for (const id of photoIds) {
    await db.batch([
      db.delete(likes).where(eq(likes.photoId, id)),
      db.delete(comments).where(eq(comments.photoId, id)),
    ]);
  }
  await db.batch([
    db.delete(photos).where(eq(photos.partyId, party.id)),
    db.delete(partyMembers).where(eq(partyMembers.partyId, party.id)),
    db.delete(parties).where(eq(parties.id, party.id)),
  ]);
  return NextResponse.json({ ok: true });
}
```

28.4. Commit: `git add -A && git commit -m "Add host powers: list members, kick, delete party"`.

---

## 29. Cron sweep route + final migrations

29.1. Create `app/api/cron/sweep/route.ts`:

```ts
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
  // CRON_SECRET check
  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!env.CRON_SECRET || provided !== env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb(env);
  const now = Date.now();

  // Expired parties
  const expired = await db.select().from(parties).where(lt(parties.expiresAt, now));
  for (const party of expired) {
    const photosRows = await db.select().from(photos).where(eq(photos.partyId, party.id));
    // R2 sweep
    for (const p of photosRows) await env.PHOTOS_BUCKET.delete(p.r2Key);
    // Also delete any orphan objects under prefix (best-effort: list, then delete ones missing from DB)
    await sweepOrphans(env, party.id, photosRows.map((p) => p.r2Key), now);
    // Cleanup DB
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

  // Orphan sweep for non-expired parties
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
```

29.2. Commit: `git add -A && git commit -m "Add cron sweep route"`.

---

## 30. Gallery page (`/p/[code]`)

This is the most complex UI. Build it carefully.

30.1. Create `components/expiry-pill.tsx`:

```tsx
"use client";
export function ExpiryPill({ expiresAt }: { expiresAt: number }) {
  const days = Math.ceil((expiresAt - Date.now()) / 86400000);
  const text = days <= 0 ? "Expiring today" : days === 1 ? "Expires tomorrow" : `Expires in ${days} days`;
  const color = days <= 1 ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30" :
                days <= 7 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" :
                "bg-muted text-muted-foreground border border-border";
  return <span className={`text-xs px-2 py-1 rounded-full font-medium ${color}`}>{text}</span>;
}
```

30.2. Create `components/upload-button.tsx` (client):

```tsx
"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

const MAX_BYTES = 15 * 1024 * 1024;

export function UploadButton({ partyCode }: { partyCode: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast({ title: `${file.name} too large`, description: "Max 15 MB." });
        fail++;
        continue;
      }
      try {
        const r1 = await fetch("/api/upload-url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partyCode, contentType: file.type, contentLength: file.size }),
        });
        if (!r1.ok) throw new Error("upload-url failed");
        const { uploadUrl, key } = await r1.json();
        const r2 = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        if (!r2.ok) throw new Error("R2 PUT failed");
        const dims = await readDims(file).catch(() => ({ width: null, height: null }));
        const r3 = await fetch("/api/photos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partyCode, key, bytes: file.size, contentType: file.type, width: dims.width, height: dims.height }),
        });
        if (!r3.ok) throw new Error("photos insert failed");
        ok++;
      } catch (e) {
        fail++;
      }
    }
    setUploading(false);
    if (ok > 0) toast({ title: `Uploaded ${ok} photo${ok > 1 ? "s" : ""}` });
    if (fail > 0) toast({ title: `Failed: ${fail}`, variant: "destructive" });
    // Reload gallery
    window.dispatchEvent(new Event("photohere:reload"));
  }

  return (
    <>
      <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
        {uploading ? "Uploading…" : "Upload photos"}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </>
  );
}

function readDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
```

30.3. Create `components/photo-card.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";

export function PhotoCard({ photo, onOpen, onLike }: { photo: any; onOpen: () => void; onLike: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(async (entries) => {
      if (entries[0].isIntersecting && !url && !loading) {
        setLoading(true);
        const r = await fetch(`/api/photo-url?id=${photo.id}`);
        const data = await r.json();
        setUrl(data.url);
        setLoading(false);
        obs.disconnect();
      }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [photo.id, url, loading]);

  return (
    <div ref={ref} className="break-inside-avoid mb-3 group relative">
      <div className="w-full aspect-[var(--ar)] bg-muted rounded-xl overflow-hidden cursor-pointer" style={{ aspectRatio: photo.width && photo.height ? `${photo.width}/${photo.height}` : "4/3" }} onClick={onOpen}>
        {url ? (
          <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="w-full h-full animate-pulse" />
        )}
      </div>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button onClick={onLike} className={`p-1.5 rounded-full bg-black/60 backdrop-blur text-white ${photo.liked ? "text-rose-400" : ""}`}>
          <Heart className="w-4 h-4" fill={photo.liked ? "currentColor" : "none"} />
        </button>
        <span className="px-1.5 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-xs flex items-center gap-1">
          <MessageCircle className="w-3 h-3" /> {photo.commentCount}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition">
        {photo.likeCount > 0 && <>{photo.likeCount} likes</>}
      </div>
    </div>
  );
}
```

30.4. Create `components/lightbox.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heart, Download, Trash2 } from "lucide-react";

interface LightboxProps {
  photo: any | null;
  onClose: () => void;
  onLike: (id: string) => void;
  onDelete?: (id: string) => void; // only when author
  isAuthor: boolean;
}

export function Lightbox({ photo, onClose, onLike, onDelete, isAuthor }: LightboxProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [dlUrl, setDlUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!photo) return;
    setUrl(null); setDlUrl(null); setComments([]);
    (async () => {
      const r1 = await fetch(`/api/photo-url?id=${photo.id}`);
      setUrl((await r1.json()).url);
      const r2 = await fetch(`/api/comment?photoId=${photo.id}`);
      setComments((await r2.json()).comments);
    })();
  }, [photo?.id]);

  async function doDownload() {
    if (!dlUrl) {
      const r = await fetch(`/api/photo-download?id=${photo.id}`);
      setDlUrl((await r.json()).url);
    }
    if (dlUrl) window.location.href = dlUrl;
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    const r = await fetch("/api/comment", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId: photo.id, body: body.trim() }),
    });
    if (r.ok) {
      const c = await r.json();
      setComments((p) => [c, ...p]);
      setBody("");
    }
  }

  return (
    <Dialog open={!!photo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        {photo && (
          <div className="grid md:grid-cols-[2fr_1fr] max-h-[85vh]">
            <div className="bg-black flex items-center justify-center min-h-[300px]">
              {url ? <img src={url} alt="" className="max-h-[85vh] max-w-full object-contain" /> : <div className="w-full h-full animate-pulse" />}
            </div>
            <div className="flex flex-col p-4 gap-3 overflow-hidden">
              <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => onLike(photo.id)} className={photo.liked ? "text-rose-500" : ""}>
                  <Heart fill={photo.liked ? "currentColor" : "none"} className="w-4 h-4" />&nbsp;{photo.likeCount}
                </Button>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={doDownload}><Download className="w-4 h-4" /></Button>
                  {isAuthor && onDelete && (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(photo.id)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">{photo.uploaderNickname ?? "Someone"} · {(photo.bytes / 1024).toFixed(0)} KB</div>
              <form onSubmit={addComment} className="flex gap-2">
                <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" maxLength={500} />
                <Button type="submit" size="sm">Send</Button>
              </form>
              <div className="overflow-y-auto flex-1 space-y-2">
                {comments.map((c) => (
                  <div key={c.id} className="text-sm">
                    <div className="font-medium">{c.profileNickname ?? "Someone"}</div>
                    <div>{escapeHtml(c.body)}</div>
                  </div>
                ))}
                {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
```

30.5. Create `components/party-gallery.tsx` (the main client component):

```tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PartyHeader } from "./party-header";
import { PhotoCard } from "./photo-card";
import { Lightbox } from "./lightbox";
import { UploadButton } from "./upload-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";

export function PartyGallery({ code, title, expiresAt, role, currentProfileId }: {
  code: string; title: string; expiresAt: number; role: "host" | "member"; currentProfileId: string | null;
}) {
  const r = useRouter();
  const { toast } = useToast();
  const [photos, setPhotos] = useState<any[] | null>(null);
  const [selIndex, setSelIndex] = useState<number | null>(null);
  const [optimisticLoves, setOptimisticLoves] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/photos?party=${code}`);
    if (res.status === 403) { r.push(`/j/${code}`); return; }
    if (res.ok) {
      const data = await res.json();
      setPhotos(data.photos);
    } else {
      setPhotos([]);
    }
  }, [code, r]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("photohere:reload", handler);
    return () => window.removeEventListener("photohere:reload", handler);
  }, [load]);

  async function toggleLike(id: string, liked: boolean) {
    setOptimisticLoves((p) => ({ ...p, [id]: !liked }));
    const method = liked ? "DELETE" : "POST";
    await fetch("/api/like", method === "POST" ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: id }),
    } : { method: "DELETE" });
    setOptimisticLoves((p) => ({}));
    load();
  }

  async function deletePhoto(id: string) {
    const r = await fetch("/api/photo/delete", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    });
    if (r.ok) {
      setPhotos((p) => p ? p.filter((x) => x.id !== id) : p);
      setSelIndex(null);
      toast({ title: "Photo deleted" });
    }
  }

  const selPhoto = selIndex !== null && photos ? photos[selIndex] : null;
  const computeLiked = (p: any) => optimisticLoves[p.id] ?? p.liked;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">
      <PartyHeader code={code} title={title} expiresAt={expiresAt} role={role} />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{photos ? `${photos.length} photos` : "Loading…"}</h2>
        <UploadButton partyCode={code} />
      </div>
      {photos === null ? (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] mb-3 rounded-xl" />)}
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">No photos yet. Be the first to upload.</div>
      ) : (
        <div className="columns-2 md:columns-3 lg:columns-4 gap-3">
          {photos.map((p, i) => (
            <PhotoCard
              key={p.id}
              photo={{ ...p, liked: computeLiked(p) }}
              onOpen={() => setSelIndex(i)}
              onLike={() => toggleLike(p.id, p.liked)}
            />
          ))}
        </div>
      )}
      <Lightbox
        photo={selPhoto ? { ...selPhoto, liked: computeLiked(selPhoto) } : null}
        onClose={() => setSelIndex(null)}
        onLike={(id) => toggleLike(id, selPhoto!.liked)}
        onDelete={currentProfileId && selPhoto && selPhoto.uploaderProfileId === currentProfileId ? deletePhoto : undefined}
        isAuthor={!!currentProfileId && !!selPhoto && selPhoto.uploaderProfileId === currentProfileId}
      />
    </main>
  );
}
```

30.6. Create `components/party-header.tsx`:

```tsx
"use client";
import { useState } from "react";
import { ExpiryPill } from "./expiry-pill";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

export function PartyHeader({ code, title, expiresAt, role }: { code: string; title: string; expiresAt: number; role: "host" | "member" }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  return (
    <header className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <ExpiryPill expiresAt={expiresAt} />
        {role === "host" && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">Host</span>}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <code className="font-mono text-lg tracking-wider bg-muted px-3 py-1.5 rounded-lg">{code}</code>
        <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(`${location.origin}/j/${code}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : "Copy join link"}
        </Button>
      </div>
    </header>
  );
}
```

30.7. Create `app/p/[code]/page.tsx` (server component):

```tsx
import { notFound, redirect } from "next/navigation";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { PartyGallery } from "@/components/party-gallery";
import { JoinForm } from "@/components/join-form";
import { eq, and } from "drizzle-orm";

export const runtime = "edge";

export default async function PartyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const env = getRequestContext().env as Env;
  const db = getDb(env);

  const partyRows = await db.select().from(parties).where(eq(parties.code, code.toUpperCase())).limit(1);
  if (partyRows.length === 0) notFound();
  const party = partyRows[0];

  const profileId = await getEffectiveProfileId(env);
  let role: "host" | "member" | null = null;
  if (profileId) {
    const memberRows = await db.select().from(partyMembers)
      .where(and(eq(partyMembers.partyId, party.id), eq(partyMembers.profileId, profileId))).limit(1);
    if (memberRows.length > 0) role = memberRows[0].role as "host" | "member";
  }
  if (!role) {
    // Show a join interstitial
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <section className="w-full max-w-sm space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Join party</h1>
            <p className="text-sm text-muted-foreground">You're joining party <span className="font-mono">{code.toUpperCase()}</span></p>
          </header>
          <JoinForm initialCode={code} />
        </section>
      </main>
    );
  }

  return <PartyGallery code={party.code} title={party.title} expiresAt={party.expiresAt} role={role} currentProfileId={profileId} />;
}
```

30.8. Create `app/p/[code]/[photoId]/page.tsx` (single-photo deep link — redirect to gallery with hash-less state). Simplest implementation: redirect to `/p/[code]` and let state rebuild. For MVP, this can be a thin server redirect:

```tsx
import { redirect } from "next/navigation";

export const runtime = "edge";

export default async function PhotoPage({ params }: { params: Promise<{ code: string; photoId: string }> }) {
  const { code } = await params;
  redirect(`/p/${code}`);
}
```

30.9. Commit: `git add -A && git commit -m "Add gallery page with masonry, lightbox, comments, optimistic likes"`.

---

## 31. `/me` page (signed-in user's parties)

31.1. Create `app/me/page.tsx`:

```tsx
import Link from "next/link";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { parties, partyMembers, profiles } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { ExpiryPill } from "@/components/expiry-pill";
import { eq, desc } from "drizzle-orm";

export const runtime = "edge";

export default async function MePage() {
  const env = getRequestContext().env as Env;
  const profileId = await getEffectiveProfileId(env);
  const db = getDb(env);

  if (!profileId) return <NotSignedIn />;

  const profileRows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  const profile = profileRows[0] ?? null;
  const myParties = await db.select({
    id: parties.id, code: parties.code, title: parties.title,
    role: partyMembers.role, createdAt: parties.createdAt, expiresAt: parties.expiresAt,
  })
  .from(partyMembers)
  .innerJoin(parties, eq(partyMembers.partyId, parties.id))
  .where(eq(partyMembers.profileId, profileId))
  .orderBy(desc(parties.createdAt));

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">My parties</h1>
        {profile && <p className="text-sm text-muted-foreground">{profile.isAnonymous ? "Anonymous" : profile.email} · <Link href="/auth/request" className="underline">{profile.isAnonymous ? "Sign in" : "Switch account"}</Link></p>}
      </header>
      {myParties.length === 0 ? (
        <p className="text-muted-foreground">You haven't joined any parties yet. <Link href="/" className="underline">Get started</Link>.</p>
      ) : (
        <ul className="divide-y">
          {myParties.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link href={`/p/${p.code}`} className="font-medium hover:underline">{p.title}</Link>
                  {p.role === "host" && <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/30">host</span>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{p.code}</div>
              </div>
              <ExpiryPill expiresAt={p.expiresAt} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NotSignedIn() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center space-y-4">
      <h1 className="text-2xl font-semibold">You're not signed in</h1>
      <p className="text-muted-foreground text-sm">Sign in with your email to keep your party list across devices.</p>
      <a href="/auth/request" className="underline">Continue with email</a>
    </main>
  );
}
```

31.2. Commit: `git add -A && git commit -m "Add /me page (list user's parties with expiry)"`.

---

## 32. Resend magic-link (auth pages + routes)

32.1. Create `app/auth/request/page.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

export default function AuthRequestPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/auth/request-link", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    if (r.ok) setSent(true);
    else toast({ title: "Could not send", variant: "destructive" });
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm space-y-3">
          <h1 className="text-2xl font-semibold">Check your inbox</h1>
          <p className="text-muted-foreground text-sm">We sent a sign-in link to <strong>{email}</strong>. The link expires in 15 minutes.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={onSubmit} className="max-w-sm w-full space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Enter your email — we'll send a one-tap link. No passwords.</p>
        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send link"}</Button>
      </form>
    </main>
  );
}
```

32.2. Create `app/api/auth/request-link/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { magicLinks } from "@/lib/schema";
import { getEffectiveProfileId } from "@/lib/auth";
import { sendMagicLinkEmail } from "@/lib/resend";
import { MAGIC_LINK_TTL_MS } from "@/lib/constants";
import { sha256, randomToken } from "@/lib/utils";

export const runtime = "edge";

export async function POST(req: Request) {
  const env = getRequestContext().env as Env;
  const body = await req.json().catch(() => ({}));
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
  } catch (e) {
    return NextResponse.json({ error: "send-failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
```

32.3. Create `app/auth/verify/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getRequestContext } from "@opennextjs/cloudflare";
import type { Env } from "@/lib/db";
import { getDb } from "@/lib/db";
import { magicLinks, profiles } from "@/lib/schema";
import { getEffectiveProfileId, issueSession, mergeProfiles } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { sha256 } from "@/lib/utils";
import { MAGIC_LINK_TTL_MS } from "@/lib/constants";

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

  // Find existing profile with this email
  const existing = await db.select().from(profiles).where(eq(profiles.email, targetEmail)).limit(1);
  let finalProfileId: string;
  if (existing.length === 0) {
    // Upgrade current anonymous profile
    if (anonProfileId) {
      await db.update(profiles).set({ email: targetEmail, isAnonymous: 0 }).where(eq(profiles.id, anonProfileId));
      finalProfileId = anonProfileId;
    } else {
      finalProfileId = crypto.randomUUID();
      await db.insert(profiles).values({ id: finalProfileId, email: targetEmail, isAnonymous: 0 });
    }
  } else {
    finalProfileId = existing[0].id;
    // Link anon profile into existing
    if (anonProfileId && anonProfileId !== finalProfileId) {
      await mergeProfiles(env, anonProfileId, finalProfileId);
    }
  }

  // Consume link
  await db.update(magicLinks).set({ used: 1 }).where(eq(magicLinks.tokenHash, tokenHash));
  // Issue session
  await issueSession(env, finalProfileId);

  return NextResponse.redirect(`${env.APP_URL}/me`);
}
```

32.4. Create `app/api/auth/logout/route.ts`:

```ts
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
```

32.5. Commit: `git add -A && git commit -m "Add Resend magic-link auth flow"`.

---

## 33. Dark mode toggle + nav polish

33.1. Create `components/theme-toggle.tsx`:

```tsx
"use client";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
      <Sun className="h-5 w-5 dark:hidden" /><Moon className="h-5 w-5 hidden dark:block" />
    </Button>
  );
}
```

33.2. Add a global nav skeleton to `app/layout.tsx`. Wrap children with:

```tsx
<header className="sticky top-0 z-40 border-b border-border/50 backdrop-blur bg-background/80">
  <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
    <Link href="/" className="font-mono text-sm tracking-tight">photohere</Link>
    <div className="flex items-center gap-1">
      <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground px-2">My parties</Link>
      <ThemeToggle />
    </div>
  </div>
</header>
```

(Add `import Link from "next/link"; import { ThemeToggle } from "@/components/theme-toggle";` to the layout. Place the header above `{children}` inside `<Providers>`.)

33.3. Commit: `git add -A && git commit -m "Add dark mode toggle and global nav"`.

---

## 34. Local run (do not skip)

34.1. Apply local migrations: `npm run db:migrate:local`.

34.2. Run `npm run dev`. Visit `http://localhost:3000`. Verify:
  - Landing page renders (no console errors).
  - Creating a party redirects to `/p/<code>` and shows the join interstitial for a fresh browser (different profile).
  - Joining via the same browser auto-jumps to the gallery.
  - Upload a small image — it should appear in the grid.
  - Click upload, like, comment all work locally (R2 calls will fail unless you set up R2 dev — that's fine; in dev `wrangler pages dev` will wire R2 binding).

34.3. Run `npm run preview` (this runs `wrangler pages dev`) to test the actual bindings locally. R2 may need a local mock — `wrangler pages dev` provides one. If problems, document in `README.md` and proceed (do not block).

34.4. Commit: `git add -A && git commit -m "Verify local dev"` (only if `README.md` or other files changed).

---

## 35. README

35.1. Replace `README.md` with:

```md
# photohere

Create a party, share the code, everyone uploads, likes, comments, downloads. Auto-deletes in 90 days.

## Stack

- Next.js 15 (App Router) on Cloudflare Workers (OpenNext adapter)
- Cloudflare D1 (SQLite) + Drizzle ORM
- Cloudflare R2 (signed URLs)
- Resend email magic-link auth
- Tailwind v4 + shadcn/ui + Geist

## Local dev

\`\`\`bash
npm install
npm run db:migrate:local
npm run dev          # Next.js dev server (no CF bindings; some routes will 500)
npm run preview      # wrangler pages dev — bindings wired locally
\`\`\`

## Configuration

Create `.env.local` (see `.env.example`):
- `AUTH_SECRET` — `openssl rand -hex 32`
- `RESEND_API_KEY` — from Resend dashboard
- `RESEND_FROM` — `onboarding@resend.dev` until your domain is verified
- `APP_URL` — `http://localhost:3000` locally
- `CRON_SECRET` — `openssl rand -hex 32`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

For Workers deployment, set these as secrets:
\`\`\`bash
wrangler secret put AUTH_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put CRON_SECRET
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
\`\`\`

## Deploy

\`\`\`bash
wrangler d1 create photohere-db         # one-time; update wrangler.toml with the returned id
wrangler r2 bucket create photohere-photos
wrangler r2 bucket cors put photohere-photos --cors-file cors.json   # see below
npm run db:migrate:remote
npm run deploy
\`\`\`

Create `cors.json`:
\`\`\`json
{
  "corsRules": [{
    "allowedOrigins": ["https://your-domain"],
    "allowedMethods": ["PUT", "GET", "HEAD"],
    "allowedHeaders": ["Content-Type"],
    "maxAgeSeconds": 3600
  }]
}
\`\`\`

## Roadmap

See `PLAN.md` and `IMPLEMENTATION_GUIDE.md`.
```

35.2. Commit: `git add -A && git commit -m "Update README with setup instructions"`.

---

## 36. Final cross-check

Before declaring done, run through:

36.1. `npx tsc --noEmit` — must pass with zero errors. Fix any type issues.

36.2. `npm run build` — must succeed (note: Workers full build requires `wrangler` credentials; if `npm run build` alone fails due to that, run `npm run build` which only runs `next build` per the merged scripts — confirm. If it runs the worker build chain instead, set `OPEN_NEXT_SKIP_ADAPTER=1` or `npm run build` should NOT include `opennextjs-cloudflare` — we left only `next build` in `build`). Verify `package.json` `scripts.build` is exactly `"next build"`.

36.3. Verify imports — no orphaned imports referencing deleted files (e.g. `lib/jwt.ts`).

36.4. Search for TODOs / placeholder `Env` casts and ensure they're consistent: everywhere `getRequestContext().env as Env` is used.

36.5. Confirm all `runtime = "edge"` declarations are present on every route file under `app/api/**`.

36.6. Last commit: `git add -A && git commit --allow-empty -m "Implementation complete"` if nothing else staged.

---

## 37. Handoff

Push the branch:
```
git push -u origin feat/build
```

Return a concise summary of:
- Total files created / modified.
- Any deviations from this guide and why.
- Known issues (e.g. R2 dev mock limitations).
- Next steps for the user (wire Resend domain, deploy) — verbatim from the README.

Do NOT merge to main, do NOT deploy, do NOT touch `wrangler.toml` `database_id` placeholder — the user will replace it after `wrangler d1 create`.

End of guide.