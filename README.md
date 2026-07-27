# photohere

Create a party, share the code, everyone uploads, likes, comments, downloads. Auto-deletes in 90 days.

## Stack

- Next.js 16 (App Router) on Cloudflare Workers (OpenNext adapter)
- Cloudflare D1 (SQLite) + Drizzle ORM
- Cloudflare R2 (signed URLs)
- Resend email magic-link auth
- Tailwind v4 + shadcn/ui + Geist

## Local dev

```bash
npm install
npm run db:migrate:local
npm run dev          # Next.js dev server (no CF bindings; some routes will 500)
npm run preview      # wrangler pages dev — bindings wired locally
```

## Configuration

Create `.env.local` (see `.env.example`):
- `AUTH_SECRET` — `openssl rand -hex 32`
- `RESEND_API_KEY` — from Resend dashboard
- `RESEND_FROM` — `onboarding@resend.dev` until your domain is verified
- `APP_URL` — `http://localhost:3000` locally
- `CRON_SECRET` — `openssl rand -hex 32`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`

For Workers deployment, set these as secrets:
```bash
wrangler secret put AUTH_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put CRON_SECRET
wrangler secret put R2_ACCOUNT_ID
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

## Deploy

```bash
wrangler d1 create photohere-db         # one-time; update wrangler.toml with the returned id
wrangler r2 bucket create photohere-photos
wrangler r2 bucket cors put photohere-photos --cors-file cors.json   # see below
npm run db:migrate:remote
npm run deploy
```

Create `cors.json`:
```json
{
  "corsRules": [{
    "allowedOrigins": ["https://your-domain"],
    "allowedMethods": ["PUT", "GET", "HEAD"],
    "allowedHeaders": ["Content-Type"],
    "maxAgeSeconds": 3600
  }]
}
```

## Roadmap

See `PLAN.md` and `IMPLEMENTATION_GUIDE.md`.
