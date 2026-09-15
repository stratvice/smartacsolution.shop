# 24x7 Customer Support — dynamic website + admin CMS

The original static landing page, now fully database-driven, with a secure admin
panel and lead management system. **The public page's markup, CSS, layout and
animations are unchanged** — every piece of text, image, button and link is now
read from MySQL instead of being hard-coded.

- **Website** — `/`
- **Admin panel** — `/admin`

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Server | Node.js 20+ / Express 5 | Renders the *existing* HTML as an EJS template, so the design is byte-for-byte preserved |
| Views | EJS | The original markup with values swapped for `<%= %>` — no React rewrite, no visual drift |
| Database | MySQL / MariaDB via `mysql2` | Runs on the shared hosting this project deploys to |
| Auth | JWT in an httpOnly cookie + bcrypt (cost 12) | No session table needed; works for both pages and APIs |
| Images | Cloudinary, with a local-disk fallback | Binaries never go in the database — only the URL + metadata |
| Geo | OpenStreetMap Nominatim + ipwho.is | Both keyless, both called **server-side** so no third-party key or client IP handling reaches the browser |

There is no ORM. `src/lib/prisma.js` is a small hand-written adapter over
`mysql2` that keeps Prisma's method shapes — see [Why there's no ORM](#7-why-theres-no-orm).

---

## Quick start

```bash
npm install
cp .env.example .env     # then fill in DATABASE_URL and JWT_SECRET
npm run setup            # create tables + seed the original page content
npm run create:admin     # create your login
npm start                # http://localhost:3000
```

---

## 1. Database setup

You need MySQL 8+ or MariaDB 10.5+. Create a database and user, then set the
connection string in `.env`:

```
DATABASE_URL="mysql://user:password@localhost:3306/dbname"
```

If the password contains `@ : / ? # [ ] %`, URL-encode it (`@` → `%40`), or the
string parses wrong. Simplest to avoid those characters entirely.

**If your MySQL listens on a Unix socket rather than TCP** (common on shared
hosting), point at it explicitly and omit the port:

```
DATABASE_URL="mysql://user:password@localhost/dbname?socket=/var/lib/mysql/mysql.sock"
```

Then create the schema and seed the content that was on the original page:

```bash
npm run db:init    # applies db/schema.sql — idempotent, safe to re-run
npm run db:seed    # upserts content by key; never overwrites an edited value
```

`npm run setup` runs both.

### Schema changes

`db/schema.sql` is the source of truth and every `CREATE TABLE` is
`IF NOT EXISTS`. There is no migration tool: to change the schema, edit that
file, update any affected code, and apply the `ALTER TABLE` yourself. For a
fresh database, `db:init` alone is enough.

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
| `DATABASE_URL` | **yes** | `mysql://…`; add `?socket=…` for socket-only servers |
| `JWT_SECRET` | **yes** | ≥32 chars. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | | `development` / `production` |
| `PORT` | | default `3000`; most hosts set this for you |
| `APP_URL` | | Public base URL; used for canonical + sitemap |
| `COOKIE_SECURE` | | **Set `true` in production (HTTPS)** |
| `JWT_EXPIRES_IN` | | default `8h` |
| `STORAGE_DRIVER` | | `local` or `cloudinary` |
| `UPLOAD_DIR` | | Where `local` uploads are written. **Must be outside the deployed tree on any host that builds each release into a new directory** — see [Deploying](#10-deploying) |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | for cloud | Required when `STORAGE_DRIVER=cloudinary` |
| `MAX_UPLOAD_MB` | | default `5` |
| `CORS_ORIGINS` | | Comma-separated. Empty = same-origin only (recommended) |
| `RESEND_API_KEY` / `EMAIL_FROM` | | Lead notification email. Leads are saved normally without it |
| `LOGIN_RATE_MAX` / `LOGIN_RATE_WINDOW_MIN` | | default 5 per 15 min |
| `LEAD_RATE_MAX` / `LEAD_RATE_WINDOW_MIN` | | default 5 per 10 min |
| `NOMINATIM_URL` / `IP_GEO_URL` | | Keyless geo providers |
| `SEED_ADMIN_*` | | Defaults for `create:admin` only |

The server refuses to boot if `DATABASE_URL` or a strong `JWT_SECRET` is missing.

### Config that survives atomic deploys

Hosts that build each release into a new directory and flip a symlink delete the
previous directory — taking any `.env` next to the app with it. So the app also
looks for a **`.env.shared`** by walking up the directory tree from the app root,
letting you keep production config outside the deployed path.

Precedence: **real environment** (host-panel variables) > **`./.env`** > **`../.env.shared`**.

---

## 5. How the content model works

| Table | Holds |
|---|---|
| `admins` | Login accounts (bcrypt hash only) |
| `page_sections` | One row per page section; `content` is JSON shaped per section |
| `services` | Service cards — title, description, badge, icon, image, button text/link, order, active |
| `testimonials` | Reviews — name, location, text, rating, image, order, active |
| `faqs` | Question / answer / order / active |
| `leads` | Enquiries + location + UTM + status |
| `lead_notes` | Timestamped note trail per lead |
| `media` | Image URL + metadata (never the binary) |
| `site_settings` | Key/value settings grouped as general, contact, social, location, cta, seo, notifications |

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

## 7. Why there's no ORM

This project originally used Prisma. Prisma ships its query engine as a native
Rust binary, and that binary panics inside the CloudLinux container used by the
shared hosting this deploys to — both the library and binary engine types, on a
query as small as `SELECT 1`.

Rather than change hosts, `src/lib/prisma.js` was rewritten as a small adapter
over `mysql2` that presents the same method shapes Prisma did
(`findMany`, `findUnique`, `create`, `update`, `upsert`, `count`, `groupBy`,
`$queryRaw`, `$transaction`). Keeping the API identical meant none of the ~90
call sites across the routes, services and scripts had to change.

It implements only what this app uses and throws on unsupported filter operators
rather than quietly returning the wrong rows. Two behaviours differ from real
Prisma and are worth knowing:

- **`$transaction` is not a transaction.** It runs the operations concurrently
  with no rollback; a mid-batch failure leaves earlier writes committed.
- **Column types are introspected at runtime.** MariaDB reports JSON columns as
  `longtext`, so genuinely-JSON columns are also listed explicitly in
  `JSON_COLUMNS` — add to it if you add one.

If you move to a host that runs native binaries, reintroducing a real ORM is a
reasonable thing to do.

---

## 8. Security

- bcrypt (cost 12) password hashing; password policy enforced on create + change
- JWT in an httpOnly, SameSite=Lax cookie; deactivated accounts are rejected mid-session
- Admin pages redirect to login; admin APIs return 401 JSON
- Server-side validation on every write (zod) **and** matching client-side validation
- All SQL is parameterised; search terms are escaped so `%` and `_` match literally
- Client IP is taken from `req.ip` (behind `trust proxy`), never from a raw `X-Forwarded-For`, so it can't be forged
- Rate limiting: login (5 / 15 min), lead submission (5 / 10 min), geo, admin API. The store is in-memory, so limits apply **per process**
- Uploads are validated by **file content (magic bytes)**, not the client-declared MIME type
- CSV export neutralises spreadsheet formula injection
- Helmet + a CSP restricted to the CDNs the page actually uses
- CORS closed by default (same-origin)
- 5xx errors log server-side and return a generic message — no internals leak
- A honeypot field silently drops bot submissions
- `/admin` and `/api/admin` are disallowed in robots.txt

---

## 9. Project layout

```
db/
  schema.sql             Table definitions — the schema source of truth
src/
  server.js              App wiring, security middleware, error handling
  config/
    env.js               Env parsing + fail-fast validation
    load-env.js          Loads .env, then a .env.shared from outside the deploy
  lib/                   mysql2 adapter, auth, storage, geo, formatting helpers
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
  uploads/               Local uploads (dev default; see UPLOAD_DIR)
  js/geo.js              Location detection
  js/lead-form.js        Form submit + validation
  admin/                 Admin CSS + JS
docs/
  original-static-page.html   The page as it was before this work, for reference
scripts/
  init-db.js             Applies db/schema.sql
  seed.js                The original page's content as seed data
  create-admin.js        Admin account creation
```

---

## 10. Deploying

1. Provision MySQL/MariaDB and set `DATABASE_URL`.
2. Set `NODE_ENV=production`, a fresh `JWT_SECRET`, `APP_URL`, and `COOKIE_SECURE=true`.
3. **Set `UPLOAD_DIR` to a path outside the deployed directory** if using
   `STORAGE_DRIVER=local`. Hosts that build each release into a new folder
   delete the old one, so uploads stored inside it vanish on the next deploy
   while their `media` rows survive and 404. Alternatively use Cloudinary.
   The server warns at boot if this is misconfigured.
4. `npm ci && npm run db:init && npm run db:seed`
5. `npm start` behind a TLS-terminating proxy (`trust proxy` is already set).
6. `npm run create:admin` once.

On a host that replaces the app directory each deploy, keep production config in
a `.env.shared` one level above it — see
[Config that survives atomic deploys](#config-that-survives-atomic-deploys).

> `HANDOFF.md` is the original project history. It predates the MySQL migration
> and describes Prisma, PostgreSQL and PGlite, none of which exist here any
> more — read it for intent, not for mechanics.
