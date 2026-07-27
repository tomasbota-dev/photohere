# photohere — Plan

A web app where people create or join "parties" via a code, upload photos to the party gallery, and other members can view, like, comment, and download them. Built for events (weddings, birthdays, etc.).

## Goal

Slick, light, super snappy, good-looking. As close to **$0/month** as possible at MVP scale, excluding the domain (user provides their own free domain).

## Stack (Cloudflare path)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router, RSC, Tailwind v4, shadcn/ui, Geist font) | Familiar React DX, RSC for snappy first paint, deploys to Workers |
| Deploy | Cloudflare Workers via `@opennextjs/cloudflare` | Generous free tier, globally fast, same provider as DB + storage |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM | 5GB free, 5M reads/day; Drizzle is light + has first-class D1 support |
| Storage | Cloudflare R2 — HMAC-presigned URLs | 10GB free, **$0 egress** (the key cost lever) |
| Auth | Resend magic link + anonymous device profile fallback | Zero-cost, low-friction, recoverable across devices |
| Email | Resend free tier (100/day, 3,000/mo) | Free at MVP volume |
| Cron | Cloudflare Cron Trigger | Free, runs the 90-day sweep daily |
| DNS/SSL | Cloudflare (free) | Free DNS + SSL when domain is wired |

## Locked decisions

- **Auth**: Resend email magic link primary; anonymous device profile (`profile_id` cookie) for casual entry; merge anonymous into authenticated profile on first sign-in.
- **Storage**: signed R2 URLs (short TTL) for both upload and read. Never public buckets.
- **Privacy**: party code-gated; no SEO; no public galleries.
- **Auto-delete**: party + all photos deleted **90 days after party creation** (`expires_at = created_at + 90 * 86400 * 1000`). Visible countdown in UI.
- **Photo cap**: 15 MB per upload.
- **Photos per party**: unlimited.
- **Rate limit**: 10 uploads/min per uploader per party (in-memory via timestamp check).
- **Comments**: 500 chars max, plain text, HTML-escaped on render.
- **Likes**: one per profile per photo (enforced by PK); un-liking allowed by same profile.
- **Permissions**:
  - Host can: kick members, delete the party.
  - Host cannot: delete others' photos or comments.
  - Photo author can: delete their own photo(s).
  - Comment author can: delete their own comment(s).
- **Colors**: indigo-500 accent, warm off-white `#fafaf9` light, true-black `#0a0a0b` dark.
- **Domain**: placeholder `APP_URL` env var until user wires their domain.
- **Orphaned R2 objects**: daily cron also deletes `parties/<party_id>/` objects older than 24h that have no matching `photos` row.

## Cost projection at MVP

| Item | Allowance | Cost |
|---|---|---|
| Workers requests | 100k/day | $0 |
| Workers CPU | 10ms/invocation | $0 (lean handlers + R2-direct uploads keep us under) |
| D1 reads/writes | 5M / 100k per day | $0 |
| R2 storage | 10 GB | $0; then $0.015/GB-month |
| R2 operations | 1M Class A, 10M Class B/month | $0 |
| R2 egress | unlimited | **$0** |
| Resend | 100/day, 3,000/mo | $0 |
| Cloudflare DNS + SSL | unlimited | $0 |

**Total at MVP: $0/month.**

## Schema (D1 via Drizzle)

```
profiles(id TEXT PK, email TEXT UNIQUE NULL, created_at INT, is_anonymous INT DEFAULT 1)
sessions(token_hash TEXT PK, profile_id TEXT, expires_at INT)
magic_links(token_hash TEXT PK, profile_id TEXT, email TEXT, expires_at INT, used INT DEFAULT 0)
parties(id TEXT PK, code TEXT UNIQUE, title TEXT, host_profile_id TEXT,
        created_at INT, expires_at INT)
party_members(party_id, profile_id, role TEXT, joined_at INT, PK(party_id, profile_id))
photos(id TEXT PK, party_id, uploader_profile_id, r2_key TEXT,
       width INT, height INT, bytes INT, content_type TEXT, created_at INT)
likes(photo_id, profile_id, created_at INT, PK(photo_id, profile_id))
comments(id TEXT PK, photo_id, profile_id, body TEXT, created_at INT)
```

Note: `party_members.role` is `'host'` or `'member'`. PK on `(party_id, profile_id)`.

## Parties & codes

- Code = 6-char base32 (no ambiguous chars: no `0/O`, `1/I/L`). e.g. `AB3X9K`. Generated server-side, unique-checked in a retry loop.
- Deep links: `/j/[code]` (for QR codes at events), `/p/[code]` (gallery itself).

## Auth flow

1. First visit → middleware mints `profile_id` (UUID), sets HttpOnly cookie + mirrors in `localStorage` via a tiny client script. No email required.
2. Anonymous user can create/join parties immediately.
3. Optional "Continue with email" → enter email → server generates magic token (32-byte URL-safe random), stores `magic_links(token_hash=sha256(token), profile_id, email, expires_at=now+15min)`, emails the link via Resend.
4. User clicks link → `/auth/verify?token=...` → server hashes token, looks up `magic_links` row, validates `used=0` and not expired, marks `used=1`.
5. If email unknown to any `profiles` row → upgrade current anonymous `profiles` row to `{email, is_anonymous=0}`.
6. If email already exists on another `profiles` row → **merge**: in a single D1 transaction, rewrite `party_members.profile_id`, `photos.uploader_profile_id`, `likes.profile_id`, `comments.profile_id` from the anonymous `profile_id` to the existing one (dedup PKs where needed), delete the anonymous profile, swap current session's `profile_id` to the existing one.
7. Issue session: store `sessions(token_hash=sha256(sessionToken), profile_id, expires_at=now+30days)`, set HttpOnly cookie `session=<sessionToken>`.
8. All subsequent requests re-validate session via middleware, slide `expires_at` +30days on activity.

## R2 upload + read flow

1. Client `POST /api/upload-url` with party code + content-length + content-type → server validates party membership + size ≤ 15MB → returns `{ uploadUrl (presigned PUT, 5min TTL), key }` where `key = parties/<party_id>/<uuid>.<ext>`.
2. Client `PUT` bytes directly to R2 (bypasses Worker CPU).
3. Client `POST /api/photos` with `key` + metadata → server HEADs the R2 object to confirm size matches declared → inserts `photos` row.
4. Gallery: `GET /api/photos?party=<code>` returns rows; client lazily `GET /api/photo-url?id=<photoId>` per visible photo for a 10-min presigned GET URL.
5. Download: `GET /api/photo-download?id=<photoId>` → presigned URL with `response-content-disposition=attachment`.

## 90-day cron sweep

Daily 03:00 UTC → `GET /api/cron/sweep`:
- Require `CRON_SECRET` header.
- Select `parties WHERE expires_at < now`.
- For each: list-and-delete R2 objects under `parties/<party_id>/`, then delete `photos`/`comments`/`likes`/`party_members`/`parties` rows in a D1 batch.
- Orphan sweep: list all R2 objects under `parties/` prefixes, find keys not referenced in `photos` and older than 24h, delete them.

## UI behavior re: expiry

- `/create`: helper text "Parties and all photos are automatically deleted 90 days after creation."
- `/p/[code]` header: subtle pill showing "Expires in N days"; amber within final 7 days, red within final day.
- `/me`: lists parties with per-party expiry; parties already swept are simply gone from the list.

## Pages / routes

Pages: `/`, `/create`, `/j/[code]`, `/p/[code]`, `/p/[code]/[photoId]`, `/me`, `/auth/request`, `/auth/verify` (route).

API: `/api/party` (POST create), `/api/party/join` (POST), `/api/party/members` (GET, host-only), `/api/party/kick` (POST, host-only), `/api/upload-url` (POST), `/api/photos` (GET list, POST insert), `/api/photo/delete` (POST, author-only), `/api/like` (POST/DELETE), `/api/comment` (POST), `/api/comment/delete` (POST, author-only), `/api/photo-url` (GET presigned read URL), `/api/photo-download` (GET presigned download URL), `/api/me` (GET), `/api/auth/request-link` (POST), `/api/auth/verify` (GET), `/api/auth/logout` (POST), `/api/cron/sweep` (GET, cron-only).

## Design system

- Tailwind v4, shadcn/ui (Button, Input, Dialog, Toast, Tooltip, Skeleton, DropdownMenu, Avatar).
- Geist font (sans + mono).
- Light mode default + dark mode toggle (system-pref).
- Colors: indigo-500 accent on warm off-white `#fafaf9` (light), true-black `#0a0a0b` (dark).
- Masonry via CSS `columns` (no lib) — responsive 2/3/4 col.
- Lightbox: custom Dialog + swipe handlers (avoid heavy deps).
- `next/image` with `placeholder=empty` + lazy presigned URL fetch.
- All interactions optimistic via `useOptimistic` + `revalidate`.
- Skeletons for first paint, zero spinners.

## Repo layout

```
photohere/
  app/
    layout.tsx  globals.css  page.tsx  providers.tsx
    create/page.tsx
    j/[code]/page.tsx
    p/[code]/page.tsx
    p/[code]/[photoId]/page.tsx
    me/page.tsx
    auth/request/page.tsx
    auth/verify/route.ts
    api/
      party/route.ts
      party/join/route.ts
      party/members/route.ts
      party/kick/route.ts
      upload-url/route.ts
      photos/route.ts
      photo/delete/route.ts
      photo-url/route.ts
      photo-download/route.ts
      like/route.ts
      comment/route.ts
      comment/delete/route.ts
      me/route.ts
      auth/request-link/route.ts
      auth/verify/route.ts
      auth/logout/route.ts
      cron/sweep/route.ts
  lib/
    db.ts  schema.ts  r2.ts  auth.ts  resend.ts  jwt.ts  utils.ts  constants.ts
  components/
    ui/                         (shadcn primitives)
    party-gallery.tsx  photo-card.tsx  lightbox.tsx
    join-form.tsx  create-form.tsx  sign-in-button.tsx
    expiry-pill.tsx  party-header.tsx  upload-button.tsx
  drizzle/                      (migrations .sql)
  middleware.ts
  wrangler.toml
  next.config.mjs
  drizzle.config.ts
  package.json  tsconfig.json  tailwind.config.ts  postcss.config.mjs
  .env.example  .gitignore
```

## Env vars / bindings

- `AUTH_SECRET` (32-byte random — JWT/session signing)
- `RESEND_API_KEY`
- `RESEND_FROM` (initially `onboarding@resend.dev`)
- `APP_URL` (placeholder until domain wired)
- `CRON_SECRET`
- `DB` — D1 binding
- `PHOTOS_BUCKET` — R2 binding
- Cron Trigger in `wrangler.toml`: `crons = ["0 3 * * *"]` (daily 03:00 UTC).

## Build order (high-level)

1. Scaffold repo (Next.js, Tailwind v4, shadcn, Drizzle, wrangler, middleware).
2. D1 schema + Drizzle migration + local apply.
3. Anonymous device profile middleware + `/api/me`.
4. Create + join party flows + pages.
5. R2 presigned upload route + direct-upload client hook + `/api/photos` insert.
6. Gallery page (masonry + lazy presigned GET URLs + skeletons).
7. Lightbox + download.
8. Optimistic like + comment + comments drawer.
9. `/me` page.
10. Resend magic-link wiring + profile merge.
11. Cron sweep route + Cron Trigger.
12. Host powers: kick + delete party.
13. Author powers: delete own photo + own comment.
14. Design polish: dark mode toggle, toasts, spacing pass.
15. `wrangler deploy`, bind custom domain later, verify Resend domain.

Detailed step-by-step implementation in `IMPLEMENTATION_GUIDE.md`.