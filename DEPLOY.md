# Deploying the API to Heroku

This is the **backend API** (NestJS). The client (`canvas-jewlery`) and admin
(`canvas-jewlery-admin`) are static Vite SPAs — deploy those to a static host
(Netlify, Vercel, Cloudflare Pages, or Heroku static) and point them at this
API's URL, not at a Heroku dyno.

## What's already wired for Heroku

- **`Procfile`** — release phase runs migrations then the (insert-only) seed;
  the web dyno runs `node dist/main`.
- **`DATABASE_URL` + SSL** — the app and the migration CLI both read Heroku's
  `DATABASE_URL` and enable SSL automatically (see `src/config/database.config.ts`).
- **Build** — `heroku-postbuild` runs `nest build`; the seed JSON is copied into
  `dist` (nest-cli assets), so migrations and seed run as **compiled JS** — no
  dev dependencies needed at release/runtime.
- **`engines.node`** pins Node 20.
- **`PORT`** is provided by Heroku and already honored by `main.ts`.

## One-time setup

```bash
# from the canvas-jewlery-server directory (its own git repo)
heroku create your-app-name
heroku addons:create heroku-postgresql:essential-0   # sets DATABASE_URL

# Required secrets
heroku config:set JWT_SECRET="$(openssl rand -hex 32)"
heroku config:set STAFF_API_KEY="$(openssl rand -hex 24)"

# CORS — the exact origins of your deployed client + admin (no trailing slash).
# If omitted, ANY origin is allowed (fine for a first smoke test, not for prod).
heroku config:set CORS_ORIGIN="https://your-client.example,https://your-admin.example"

# S3 storage for order STLs (required)
heroku config:set AWS_REGION="eu-central-1" S3_BUCKET="your-bucket" \
  AWS_ACCESS_KEY_ID="…" AWS_SECRET_ACCESS_KEY="…" S3_PRESIGN_TTL_SEC="300"

# Twilio (optional — without it, OTP codes are logged instead of texted)
heroku config:set TWILIO_ACCOUNT_SID="…" TWILIO_AUTH_TOKEN="…" TWILIO_FROM="+1…"

heroku config:set DB_SYNCHRONIZE=false   # must stay false; schema via migrations
```

## Deploy

```bash
git push heroku main
```

On each push Heroku will: install deps → `nest build` → **release phase**
(`migration:run:prod` + `seed:translations:prod`) → start the web dyno.

Verify:

```bash
curl https://your-app-name.herokuapp.com/translations      # public bundle
heroku logs --tail
```

## How translations behave on deploy

The release-phase seed is **insert-only** (`ON CONFLICT DO NOTHING`):

- New keys you added to the frontend dictionaries get inserted.
- Values a translator edited in the **admin are never overwritten** — the DB is
  the source of truth for existing keys; the dictionaries are the fallback +
  bootstrap.

To reset the DB back to the dictionary contents (discarding admin edits), run
once, deliberately:

```bash
heroku run "SEED_OVERWRITE=true npm run seed:translations:prod"
```

## Notes / gotchas

- **Frontends:** build the client with `VITE_API_BASE=https://your-app-name.herokuapp.com`
  and make sure that origin is in `CORS_ORIGIN` here. The admin defaults its API
  base via `VITE_API_BASE` too (staff key is entered at runtime, never built in).
- **Migrations & seed run compiled** — they do not need `ts-node`, so Heroku's
  default dev-dependency pruning is fine.
- **DB plan:** `essential-0` is the cheapest paid Postgres; there is no free tier.
- **Subdirectory repo:** if this server lives in a subfolder of a larger monorepo
  on GitHub, either deploy from its own git repo (as here) or use the
  `subdir` buildpack — Heroku expects `package.json` at the repo root.
