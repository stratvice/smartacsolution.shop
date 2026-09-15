# 24x7 Customer Support — dynamic website + admin CMS

The original static landing page, now fully database-driven, with a secure admin
panel and lead management system. **The public page's markup, CSS, layout and
animations are unchanged** — every piece of text, image, button and link is now
read from PostgreSQL instead of being hard-coded.

- **Website** — `/`
- **Admin panel** — `/admin`

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js + Express 5 | Renders the *existing* HTML as an EJS template, so the design is byte-for-byte preserved |
| Views | EJS | The original markup with values swapped for `<%= %>` — no React rewrite, no visual drift |
| Database | PostgreSQL + Prisma 6 | As specified; migrations committed under `prisma/migrations` |
| Auth | JWT in an httpOnly cookie + bcrypt (cost 12) | No session table needed; works for both pages and APIs |
| Images | Cloudinary, with a local-disk fallback | Binaries never go in the database — only the URL + metadata |
| Geo | OpenStreetMap Nominatim + ipwho.is | Both keyless, both called **server-side** so no third-party key or client IP handling reaches the browser |

---

## Quick start

```bash
npm install
```

Then pick a database (see below), and:

```bash
npm run setup          # migrate + generate + seed the existing page content
npm run create:admin   # create your login
npm start              # http://localhost:3000
```

---

## 1. Database setup

### Option A — your own PostgreSQL (production)

Create a database anywhere (Neon, Supabase, RDS, self-hosted), then put the
connection string in `.env`:

```
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
```

Apply the schema and seed the content that was on the original page:

```bash
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

`npm run setup` runs all three in one go.

### Option B — local development without installing PostgreSQL

The repo ships a dev-only PostgreSQL (PGlite, Postgres compiled to WASM) exposed
over the real Postgres wire protocol. **Development only** — it accepts a single
connection at a time.

```bash
npm run db:local       # terminal 1 — listens on 127.0.0.1:5433
```

`.env` is already pointed at it:

```
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/postgres?sslmode=disable&pgbouncer=true&connection_limit=1"
```

Then in terminal 2: `npx prisma db push && npm run db:seed && npm start`.

> Because PGlite allows only one connection, restart the database and the app
> together: `npm run dev:restart`.

---

## 2. Create the first admin account

Interactive (password is hidden as you type):

```bash
npm run create:admin
```

Or non-interactive:

```bash
npm run create:admin -- --email you@example.com --username admin --password 'YourStrongPass1'
```

Password policy: at least 10 characters with an uppercase letter, a lowercase
letter and a number. Only the bcrypt hash is stored. Re-running with an existing
email or username resets that account's password.

Sign in at **http://localhost:3000/admin/login**.

---

## 3. Run it

```bash
npm run dev     # nodemon, auto-restarts on file changes
npm start       # plain node
```

There is no separate frontend build — the server renders the site. Front-end
assets are plain files under `public/`.

| URL | What |
|---|---|
| `/` | Public landing page |
| `/admin/login` | Sign in |
| `/admin/dashboard` | Lead counts + recent leads |
| `/admin/leads` | Search / filter / export / manage leads |
| `/admin/landing-page` | Edit every section of the page |
| `/admin/services` | Service CRUD |
| `/admin/testimonials` | Testimonial CRUD |
| `/admin/faqs` | FAQ CRUD |
| `/admin/media` | Upload / replace / delete images |
| `/admin/settings` | Company, contact, CTAs, social, SEO, password |
| `/healthz` | Health + DB check |
| `/robots.txt`, `/sitemap.xml` | Generated from your SEO settings |

---

## 4. Environment variables

Copy `.env.example` to `.env`. Everything secret lives here and `.env` is
git-ignored.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **yes** | PostgreSQL connection string |
| `JWT_SECRET` | **yes** | ≥32 chars. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | | `development` / `production` |
| `PORT` | | default `3000` |
| `APP_URL` | | Public base URL; used for canonical + sitemap |
| `COOKIE_SECURE` | | **Set `true` in production (HTTPS)** |
| `JWT_EXPIRES_IN` | | default `8h` |
| `STORAGE_DRIVER` | | `local` (dev) or `cloudinary` |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | for cloud | Required when `STORAGE_DRIVER=cloudinary` |
| `MAX_UPLOAD_MB` | | default `5` |
| `CORS_ORIGINS` | | Comma-separated. Empty = same-origin only (recommended) |
| `LOGIN_RATE_MAX` / `LOGIN_RATE_WINDOW_MIN` | | default 5 per 15 min |
| `LEAD_RATE_MAX` / `LEAD_RATE_WINDOW_MIN` | | default 5 per 10 min |
| `NOMINATIM_URL` / `IP_GEO_URL` | | Keyless geo providers |
| `SEED_ADMIN_*` | | Defaults for `create:admin` only |

The server refuses to boot if `DATABASE_URL` or a strong `JWT_SECRET` is missing.

### Switching to Cloudinary

```
STORAGE_DRIVER=cloudinary
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

Existing local images keep working; new uploads go to Cloudinary. The Media page
shows which driver is active.

---

## 5. How the content model works

| Model | Holds |
|---|---|
| `Admin` | Login accounts (bcrypt hash only) |
| `PageSection` | One row per page section; `content` is JSON shaped per section |
| `Service` | Service cards — title, description, badge, icon, image, button text/link, order, active |
| `Testimonial` | Reviews — name, location, text, rating, image, order, active |
| `Faq` | Question / answer / order / active |
| `Lead` | Enquiries + location + UTM + status |
| `LeadNote` | Timestamped note trail per lead |
| `Media` | Image URL + metadata (never the binary) |
| `SiteSetting` | Key/value settings grouped as general, contact, social, location, cta, seo |

Saving in the admin writes to the database and clears the page cache, so the
public site reflects the change on the next request.

### Location-aware copy

Any heading or description may contain `{{city}}`, `{{state}}` or `{{country}}`:

```
#1 Appliance Repair in {{city}}   ->   #1 Appliance Repair in Gurugram
```

If detection fails the token falls back to `default_city` / `default_state` in
Settings → Location, so the sentence always reads correctly.

---

## 6. Location detection

1. A location resolved on a previous visit (localStorage, 7-day TTL).
2. Browser geolocation → coordinates sent to the server → reverse geocoded.
3. Server-side IP lookup.
4. Nothing — the page renders with the configured defaults.

**The permission prompt is shown at most once per visitor.** The answer is
remembered, so a denial is never re-asked. Detection never blocks rendering, and
a lead with no detectable location is still saved.

---

## 7. Security

- bcrypt (cost 12) password hashing; password policy enforced on create + change
- JWT in an httpOnly, SameSite=Lax cookie; deactivated accounts are rejected mid-session
- Admin pages redirect to login; admin APIs return 401 JSON
- Server-side validation on every write (zod) **and** matching client-side validation
- Rate limiting: login (5 / 15 min), lead submission (5 / 10 min), geo, admin API
- Login responses are identical and time-equalised for unknown vs. wrong-password
- Uploads are validated by **file content (magic bytes)**, not the client-declared MIME type
- CSV export neutralises spreadsheet formula injection
- Helmet + a CSP restricted to the CDNs the page actually uses
- CORS closed by default (same-origin)
- 5xx errors log server-side and return a generic message — no internals leak
- A honeypot field silently drops bot submissions
- `/admin` and `/api/admin` are disallowed in robots.txt

---

## 8. Project layout

```
prisma/
  schema.prisma          Models
  migrations/            Committed SQL migrations
  seed.js                The original page's content as seed data
src/
  server.js              App wiring, security middleware, error handling
  config/env.js          Env parsing + fail-fast validation
  lib/                   prisma, auth, storage, geo, formatting helpers
  middleware/            auth gates, rate limits, validation
  routes/
    public.js            Landing page, robots.txt, sitemap.xml
    api.public.js        POST /api/leads, geo resolve, public content
    admin.js             Admin pages + login/logout
    api.admin.js         Protected CRUD APIs
  services/content.js    Assembles page content, cache invalidation
views/
  index.ejs              The original page, tokenised
  admin/                 Admin screens
  partials/              Admin shell
public/
  style.css              Original stylesheet, untouched
  images/                Original images
  uploads/               Local image uploads
  js/geo.js              Location detection
  js/lead-form.js        Form submit + validation
  admin/                 Admin CSS + JS
docs/
  original-static-page.html   The page as it was before this work, for reference
scripts/
  create-admin.js        Admin account creation
  pglite-server.mjs      Dev-only local PostgreSQL
  dev-restart.sh         Restart dev DB + app together
```

---

## 9. Deploying

1. Provision PostgreSQL, set `DATABASE_URL`.
2. Set `NODE_ENV=production`, a fresh `JWT_SECRET`, `APP_URL`, and `COOKIE_SECURE=true`.
3. Set `STORAGE_DRIVER=cloudinary` + keys (local disk does not survive a redeploy).
4. `npm ci && npx prisma migrate deploy && npx prisma generate && npm run db:seed`
5. `npm start` behind a TLS-terminating proxy (`trust proxy` is already set).
6. `npm run create:admin` once.
