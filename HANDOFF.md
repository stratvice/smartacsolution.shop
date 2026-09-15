# HANDOFF — 24x7 Customer Support website + admin CMS

**Status:** Feature-complete against the original brief. All 23 acceptance tests pass.
Lead email notifications were added afterwards — see
[§15 Lead email notifications](#15-lead-email-notifications). That feature is
code-complete but **not yet delivering real email**: it is waiting on a Resend
API key and a verified sending domain.
**Last verified:** 2026-09-13
**Project folder:** `E:\Sarfarz website data\websaf`

Everything needed to continue is inside this folder. Start at [How to run](#8-how-to-run).

---

## 1. What has been implemented

A static landing page was converted into a fully database-driven website with a
secure admin panel and lead management system. **The public page's visual design
is unchanged** — same markup, same `style.css`, same layout, cards, buttons,
spacing, images and animations. Only the *source of the content* changed: it now
comes from PostgreSQL instead of being hard-coded.

### Public website
- Original landing page rendered from the database (hero, ticker, about,
  services, why-choose-us, process steps, testimonials, FAQ, contact, footer).
- Automatic visitor location detection with graceful degradation.
- Location-aware copy: `{{city}}` / `{{state}}` / `{{country}}` tokens in any
  heading or description resolve to the visitor's detected location, falling
  back to configured defaults.
- Working enquiry form that writes a lead to the database, with client-side and
  server-side validation, a honeypot, and rate limiting.
- Dynamic SEO meta tags, plus generated `robots.txt` and `sitemap.xml`.

### Location detection (order of preference)
1. Location resolved on a previous visit (localStorage, 7-day TTL).
2. Browser geolocation → coordinates posted to the server → reverse geocoded
   server-side via OpenStreetMap Nominatim.
3. Server-side IP lookup (ipwho.is).
4. Configured defaults (`default_city` / `default_state` in Settings).

The browser permission prompt is shown **at most once per visitor** — the answer
is remembered, so a denial is never re-asked. Detection never blocks page render,
and a lead with no detectable location is still saved.

### Admin panel
Dashboard, Leads, Landing Page, Services, Testimonials, FAQs, Media, Settings,
Logout. Responsive, styled to match the public site's palette and typography.

- **Dashboard** — total / new / contacted / interested / converted / closed lead
  counts, total services, and a recent-leads table.
- **Leads** — search, filter by status / service / location / date range, detail
  drawer, status change (inline or in drawer), free-text notes field plus a
  timestamped note history, delete, click-to-call, WhatsApp, CSV export. The
  drawer also shows the email-notification outcome for that lead
  (SENT / FAILED / NOT_ATTEMPTED, with timestamp, recipients and any error).
- **Landing Page** — all 11 page sections editable, with add / remove / reorder
  repeaters for hero stats, ticker items, about images, about features, about
  stats, why-choose cards, process steps and footer links.
- **Services / Testimonials / FAQs** — full CRUD with enable/disable and ordering.
- **Media** — upload, preview, replace, delete, alt text.
- **Settings** — company, contact, CTAs, social links, location defaults, SEO,
  **Lead Email Notifications** (on/off switch, add/remove recipient addresses,
  Send Test Email) and change-your-own-password.

Saving anywhere in the admin is live on the public site on the next request.

---

## 2. Current project architecture

| Layer | Choice | Rationale |
|---|---|---|
| Server | Node.js + Express 5 | Renders the *existing* HTML as a template, so the design is preserved exactly |
| Views | EJS (server-rendered) | The original markup with values swapped for `<%= %>` — deliberately **not** a React rewrite, to avoid visual drift |
| ORM / DB | Prisma 6 + PostgreSQL | Migrations committed under `prisma/migrations` |
| Auth | JWT in an httpOnly cookie + bcrypt (cost 12) | No session table required; works for both pages and APIs |
| Images | Cloudinary, with local-disk fallback | Binaries never stored in the database — only URL + metadata |
| Geo | Nominatim + ipwho.is | Both keyless, both called **server-side** so no third-party key or client IP handling reaches the browser |

There is **no separate frontend build step**. The server renders the site; front-end
assets are plain files under `public/`.

### Request flow
```
Browser → Express
            ├── /                 → routes/public.js   → services/content.js → Prisma → views/index.ejs
            ├── /api/*            → routes/api.public.js   (public, rate-limited)
            ├── /api/admin/*      → routes/api.admin.js    (JWT-gated, 401 JSON)
            └── /admin/*          → routes/admin.js        (JWT-gated, redirects to login)
```
`/api/admin` is mounted **before** `/api` in `src/server.js` — the public router
ends in a catch-all 404 that would otherwise swallow every admin API request.
Do not reorder those two lines.

### Content caching
`src/services/content.js` caches the assembled page for 30 seconds. Every admin
write calls `invalidate()`, so admin changes appear immediately. If you add a new
admin write path, call `content.invalidate()` from it.

---

## 3. Frontend setup

No build, no bundler, no framework. To work on the front end, edit these directly:

| File | Purpose |
|---|---|
| `views/index.ejs` | The landing page — original markup, tokenised |
| `public/style.css` | Original stylesheet, **unmodified** |
| `public/js/geo.js` | Visitor location detection |
| `public/js/lead-form.js` | Enquiry form submit + client-side validation |
| `public/images/` | Original images |
| `public/admin/admin.css`, `public/admin/admin.js` | Admin panel styling and shared JS helpers |

Third-party libraries (Bootstrap 5, jQuery, Owl Carousel, AOS, Font Awesome) load
from CDNs, exactly as in the original page. The Content-Security-Policy in
`src/server.js` is scoped to those specific CDNs — **if you add a new CDN, add it
to the CSP or it will be silently blocked.**

---

## 4. Backend setup

```bash
npm install
```

Entry point is `src/server.js`. It validates the environment on boot and exits
immediately if `DATABASE_URL` or a sufficiently strong `JWT_SECRET` is missing.

| Path | Purpose |
|---|---|
| `src/config/env.js` | Environment parsing + fail-fast validation |
| `src/lib/prisma.js` | Prisma client singleton |
| `src/lib/auth.js` | Password hashing, JWT sign/verify, cookie handling, password policy |
| `src/lib/storage.js` | Image storage adapter + content-based image validation |
| `src/lib/geo.js` | Reverse geocoding, IP lookup, in-process cache |
| `src/lib/format.js` | tel/WhatsApp links, `{{city}}` interpolation, star rendering |
| `src/middleware/` | Auth gates, rate limiters, zod validation |
| `src/routes/` | Public page, public API, admin pages, admin API |
| `src/services/content.js` | Assembles page content; cache invalidation |

---

## 5. Database setup

### Schema
`prisma/schema.prisma` — PostgreSQL. Models:

| Model | Holds |
|---|---|
| `Admin` | Login accounts (bcrypt hash only — never a plaintext password) |
| `PageSection` | One row per page section; `content` is JSON shaped per section |
| `Service` | Service cards: title, description, badge, icon, image, button text/link, order, active |
| `Testimonial` | Reviews: name, location, text, rating, image, order, active |
| `Faq` | Question, answer, order, active |
| `Lead` | Enquiries + location + UTM + status + notes |
| `LeadNote` | Timestamped note trail per lead |
| `Media` | Image URL + metadata (never the binary) |
| `SiteSetting` | Key/value settings grouped: general, contact, social, location, cta, seo |

`LeadStatus` enum: `NEW`, `CONTACTED`, `INTERESTED`, `CONVERTED`, `CLOSED`.

### Migrations
`prisma/migrations/20260911183147_init/migration.sql` — standard PostgreSQL DDL,
committed. Verified to apply cleanly to a completely empty database.

### Two ways to get a database

**Option A — real PostgreSQL (what production should use).**
Create a database (Neon, Supabase, RDS, self-hosted), set `DATABASE_URL` in
`.env`, then run the migration + seed commands below.

**Option B — local development without installing PostgreSQL.**
The repo ships a **dev-only** PostgreSQL: PGlite (Postgres compiled to WASM)
exposed over the real Postgres wire protocol, in `scripts/pglite-server.mjs`.
`.env` currently points at this. It accepts **one connection at a time** — see
[Known limitations](#11-known-limitations).

---

## 6. Admin panel URL

| Environment | URL |
|---|---|
| Local | `http://localhost:3000/admin` |
| Login page | `http://localhost:3000/admin/login` |

`/admin` redirects to `/admin/dashboard` when signed in, or to the login page when not.

**Credentials are intentionally not recorded in this repository.** An admin
account with username `admin` already exists in the local development database.
If the password is not available, reset or create one in a single command:

```bash
npm run create:admin -- --email you@example.com --username admin --password 'YourStrongPass1'
```

Re-running with an existing email or username resets that account's password.
Password policy: minimum 10 characters, with an uppercase letter, a lowercase
letter and a number.

---

## 7. Required environment variables

Names only — **never commit real values.** `.env` is git-ignored; `.env.example`
is the committed template with the same key names and placeholder values.

The `.env` file is **present in the project folder** and already configured for
local development. Do not commit it, and do not paste its contents into chat,
issues or documentation.

### Required — the server refuses to boot without these
| Name | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Minimum 32 characters. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |

### Optional — sensible defaults if unset
| Name | Notes |
|---|---|
| `NODE_ENV` | `development` / `production` |
| `PORT` | Default `3000` |
| `APP_URL` | Public base URL; used for canonical URL and sitemap |
| `JWT_EXPIRES_IN` | Default `8h` |
| `COOKIE_NAME` | Auth cookie name |
| `COOKIE_SECURE` | **Must be `true` in production (HTTPS)** |
| `STORAGE_DRIVER` | `local` or `cloudinary` |
| `CLOUDINARY_CLOUD_NAME` | Required when `STORAGE_DRIVER=cloudinary` |
| `CLOUDINARY_API_KEY` | Required when `STORAGE_DRIVER=cloudinary` |
| `CLOUDINARY_API_SECRET` | Required when `STORAGE_DRIVER=cloudinary` |
| `CLOUDINARY_FOLDER` | Upload folder name |
| `MAX_UPLOAD_MB` | Default `5` |
| `CORS_ORIGINS` | Comma-separated. Empty = same-origin only (recommended) |
| `NOMINATIM_URL` | Reverse geocoding endpoint |
| `NOMINATIM_USER_AGENT` | Required by Nominatim's usage policy |
| `IP_GEO_URL` | IP geolocation endpoint |
| `GEO_CACHE_TTL_MIN` | Geo cache lifetime |
| `LOGIN_RATE_MAX` | Default `5` |
| `LOGIN_RATE_WINDOW_MIN` | Default `15` |
| `LEAD_RATE_MAX` | Default `5` |
| `LEAD_RATE_WINDOW_MIN` | Default `10` |
| `TEST_EMAIL_RATE_MAX` | Default `5` — cap on the admin's Send Test Email button |
| `TEST_EMAIL_RATE_WINDOW_MIN` | Default `10` |
| `RESEND_API_KEY` | **Needed for lead email notifications.** Without it leads are still saved; no email is sent. See [§15](#15-lead-email-notifications) |
| `EMAIL_FROM` | **Needed for lead email notifications.** Must be an address on a Resend-verified domain |
| `EMAIL_REPLY_TO` | Fallback reply-to when the lead left no email address |
| `RESEND_API_URL` | Defaults to `https://api.resend.com/emails`. Override only for local testing |
| `EMAIL_TIMEZONE` | Default `Asia/Kolkata` — timezone shown in the notification email |
| `EMAIL_TIMEOUT_MS` | Default `10000` |
| `SEED_ADMIN_EMAIL` | Default for `npm run create:admin` only |
| `SEED_ADMIN_USERNAME` | Default for `npm run create:admin` only |
| `SEED_ADMIN_PASSWORD` | Optional convenience for non-interactive admin creation |

---

## 8. How to run

### Against a real PostgreSQL
```bash
npm install
# set DATABASE_URL and JWT_SECRET in .env
npm run setup          # migrate deploy + generate + seed
npm run create:admin   # create your login
npm start              # http://localhost:3000
```

### Against the bundled local PGlite database (current local setup)
Two terminals:
```bash
# terminal 1 — database
npm run db:local       # listens on 127.0.0.1:5433

# terminal 2 — app
npm start              # http://localhost:3000
```

Or restart both together (needed after force-killing the app — see limitations):
```bash
npm run dev:restart
```

| Script | Does |
|---|---|
| `npm start` | Run the server |
| `npm run dev` | Run with nodemon (auto-restart on file change) |
| `npm run db:local` | Start the dev-only local PostgreSQL |
| `npm run dev:restart` | Restart local DB + app together, then health-check |
| `npm run setup` | `migrate deploy` + `generate` + `seed` |
| `npm run prisma:studio` | Browse the database in a GUI |

Health check: `curl http://localhost:3000/healthz` → `{"ok":true,"db":"up"}`

---

## 9. How to run migrations

**Apply existing migrations (production and normal use):**
```bash
npx prisma migrate deploy
npx prisma generate
```

**After changing `prisma/schema.prisma`, create a new migration:**
```bash
npx prisma migrate dev --name describe_your_change
```

> `migrate dev` needs a shadow database and therefore a second connection. It
> **does not work against the bundled PGlite database.** Point `DATABASE_URL` at
> a real PostgreSQL to author new migrations. Against PGlite, use
> `npx prisma db push` for quick local schema syncing (this does not produce a
> committed migration file — generate the real migration later against Postgres).

**Generating a migration file without a live database:**
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migration.sql
```
This is how the committed init migration was produced.

**Destructive reset (drops all data, development only — run this yourself):**
```bash
npx prisma migrate reset
```
Never run that against production. It irreversibly destroys all data. Prisma's
CLI will ask for confirmation.

---

## 10. How to seed the database

```bash
npm run db:seed
```

`prisma/seed.js` contains the exact content that was hard-coded in the original
static page: 39 settings, 11 page sections, 3 services, 4 testimonials, 5 FAQs
and 7 media records.

**The seed is idempotent and non-destructive.** Verified behaviour:

- Running it on an empty database populates everything.
- Running it repeatedly does **not** duplicate rows (three consecutive runs were
  verified to produce identical counts).
- Running it **does not overwrite content you have edited in the admin.** Settings
  are upserted with their labels/grouping refreshed but their *values* left alone;
  services are upserted by slug with no update; testimonials, FAQs and media are
  only inserted when the table is empty or the row is missing.

That last point matters: **re-seeding will not restore default content.** To get
factory defaults back you must reset the database (`npx prisma migrate reset`,
destructive) and then seed again.

**Full recreation from zero — verified working:**
```bash
npx prisma migrate deploy    # applies init migration to an empty database
npx prisma generate
npm run db:seed              # populates all original content
npm run create:admin         # create a login
```

---

## 11. Known limitations

| # | Limitation | Impact / workaround |
|---|---|---|
| 1 | **Bundled PGlite dev database accepts one connection at a time** | Force-killing the app orphans the connection slot and the next start reports `db: down`. Always restart both with `npm run dev:restart`. Does not affect real PostgreSQL. |
| 2 | **`prisma migrate dev` does not work against PGlite** | It needs a shadow database. Use a real PostgreSQL to author new migrations; use `prisma db push` for quick local iteration. |
| 3 | **Never run against a real hosted PostgreSQL yet** | The committed migration was verified against an empty PGlite (real Postgres wire protocol + DDL), but not yet against Neon/Supabase/RDS. Expect it to work; verify on first deploy. |
| 4 | **Cloudinary path is coded but never exercised with live credentials** | No API keys were available. The adapter, replace-and-delete logic and driver switching are implemented; test with real keys before relying on it in production. |
| 5 | **Local disk storage does not survive a redeploy** | `STORAGE_DRIVER=local` is dev-only. Set `STORAGE_DRIVER=cloudinary` in production. |
| 6 | **Rate limits are in-memory** | Counters are per-process, so they do not coordinate across multiple instances, and they reset on restart. Use a shared store (e.g. Redis) if you scale horizontally. |
| 7 | **No automated test suite** | All 23 acceptance tests were executed manually via scripted HTTP calls and a real browser session. There is no `npm test`. |
| 8 | **Logo and favicon settings are empty** | The original page referenced `assets/images/GSZ.png`, which 404s on the live original site too. Upload a logo in Admin → Media, then set it in Admin → Settings → Company. |
| 9 | **CSV export is capped at 10,000 rows** | Hard limit in `src/routes/api.admin.js`. Raise it or add chunking if lead volume grows. |
| 10 | **Single admin role** | The `Admin.role` column exists and defaults to `ADMIN`, but no role-based permission checks are implemented — every signed-in admin can do everything. |
| 11 | **Lead email notifications are built but not yet delivering** | The feature is complete and tested end-to-end, but `RESEND_API_KEY` and a verified `EMAIL_FROM` domain are still unset, so no real email has ever been delivered. See [§15](#15-lead-email-notifications). No WhatsApp alert exists. |
| 12 | **Geo providers are free, unauthenticated and rate-limited** | Nominatim and ipwho.is impose usage policies. There is an in-process cache, but consider a paid provider at higher traffic. |
| 13 | **Media library has no pagination UI** | The API supports `page`/`perPage`; the admin page renders all items. Fine for hundreds, not thousands. |
| 14 | **Prisma CLI deprecation warning** | `package.json#prisma` is deprecated and will be removed in Prisma 7; migrate to `prisma.config.ts` before upgrading. Harmless today. |
| 15 | **Three dev-only npm advisories** | All inside the Prisma CLI's own dependency (`deepmerge-ts`). Runtime dependencies audit clean. Not in the request path. |
| 16 | **The local PGlite database has no Prisma migration history** | It was originally created with `db push`, not `migrate deploy`, so `_prisma_migrations` does not exist and `migrate deploy` fails with `P3005`. Baselining also fails because PGlite's wire protocol does not support the schema engine's advisory locks. Both committed migrations are valid and will apply normally to a real PostgreSQL. Locally, use `prisma db push`. |

---

## 12. What remains to be implemented

Nothing from the original brief is outstanding. These are the natural next steps,
in rough priority order:

1. **Finish the Resend setup so lead notification emails actually send** — this
   is the only half-finished feature in the project. Exact steps are in
   [§15.6](#156-exact-remaining-steps-for-real-delivery).
2. **Point at a real hosted PostgreSQL** and run `npm run setup` against it —
   the one remaining unverified step before production.
3. **Configure Cloudinary** (`STORAGE_DRIVER=cloudinary` + keys) and re-test
   upload / replace / delete with live credentials.
4. **Replace the placeholder branding** — upload a logo and favicon, and review
   the seeded contact details, which are the original site's.
5. **Automated tests** — the 23 acceptance checks are currently manual.
6. **Production hardening** — `NODE_ENV=production`, a freshly generated
   `JWT_SECRET`, `COOKIE_SECURE=true`, `APP_URL` set, behind a TLS proxy
   (`trust proxy` is already configured).
7. Optional: role-based permissions, media pagination, shared-store rate limiting.

---

## 13. Important files and their purpose

### Configuration
| File | Purpose |
|---|---|
| `package.json` | Dependencies and all npm scripts |
| `.env` | **Live secrets — git-ignored, present on disk, never commit** |
| `.env.example` | Committed template; same key names, placeholder values |
| `.gitignore` | Excludes `.env`, `node_modules`, uploads, local DB data and logs |

### Database
| File | Purpose |
|---|---|
| `prisma/schema.prisma` | All models, enums and indexes |
| `prisma/migrations/20260911183147_init/migration.sql` | Committed init migration |
| `prisma/migrations/migration_lock.toml` | Pins the provider to PostgreSQL |
| `prisma/seed.js` | The original page's content as reproducible, idempotent seed data |

### Backend
| File | Purpose |
|---|---|
| `src/server.js` | App wiring, security middleware, CSP, route mount order, error handling |
| `src/config/env.js` | Environment parsing and fail-fast validation |
| `src/lib/prisma.js` | Prisma client singleton |
| `src/lib/auth.js` | bcrypt hashing, JWT, auth cookie, password policy |
| `src/lib/storage.js` | Storage adapter (Cloudinary/local) + magic-byte image validation |
| `src/lib/geo.js` | Reverse geocoding, IP lookup, caching, private-IP detection |
| `src/lib/format.js` | tel/WhatsApp link builders, `{{city}}` interpolation, star icons |
| `src/lib/http.js` | `asyncHandler`, `HttpError`, fetch-with-timeout |
| `src/lib/mailer.js` | Resend transport. Never throws; redacts credentials from provider errors |
| `src/lib/email-template.js` | Notification email markup (HTML + plain text) |
| `src/services/leadNotifier.js` | Recipient config, validation, send, status write-back, test email |
| `src/middleware/auth.js` | Loads the admin from the cookie; page and API gates |
| `src/middleware/rateLimit.js` | Login, lead, geo and admin-API limiters |
| `src/middleware/validate.js` | zod validation with one error per field |
| `src/routes/public.js` | Landing page, `robots.txt`, `sitemap.xml` |
| `src/routes/api.public.js` | `POST /api/leads`, geo resolve, public read-only content |
| `src/routes/api.admin.js` | All protected CRUD APIs, CSV export, stats |
| `src/routes/admin.js` | Admin pages, login and logout handlers |
| `src/services/content.js` | Assembles page content from the DB; cache + invalidation |

### Frontend
| File | Purpose |
|---|---|
| `views/index.ejs` | The landing page — original markup, tokenised |
| `views/admin/*.ejs` | Admin screens (login, dashboard, leads, landing-page, services, testimonials, faqs, media, settings) |
| `views/partials/admin-{head,foot,end}.ejs` | Admin shell; split so page scripts land inside `<body>` |
| `views/404.ejs`, `views/error.ejs` | Error pages |
| `public/style.css` | **Original stylesheet, unmodified** |
| `public/js/geo.js` | Visitor location detection |
| `public/js/lead-form.js` | Form submit + client-side validation |
| `public/admin/admin.css` | Admin styling (site palette and typography) |
| `public/admin/admin.js` | Shared admin JS: API wrapper, toasts, repeaters, drawers |
| `public/images/` | Original images |
| `public/uploads/` | Local image uploads (git-ignored) |

### Scripts and reference
| File | Purpose |
|---|---|
| `scripts/create-admin.js` | Create or reset an admin account (hidden password prompt) |
| `scripts/pglite-server.mjs` | **Dev-only** local PostgreSQL over the Postgres wire protocol |
| `scripts/dev-restart.sh` | Restart local DB + app together, then health-check |
| `docs/original-static-page.html` | The page exactly as it was before this work, for visual comparison |
| `README.md` | Full setup, environment, security and deployment documentation |
| `HANDOFF.md` | This file |

---

## 14. Gotchas for whoever picks this up

1. **Do not reorder the route mounts in `src/server.js`.** `/api/admin` must be
   mounted before `/api`, or every admin API request returns 404 instead of 401.
2. **Call `content.invalidate()` from any new admin write path**, or the public
   page will serve stale content for up to 30 seconds.
3. **`public/style.css` is the original file. Leave it alone** unless a change is
   genuinely required — preserving the design was an explicit requirement.
4. **The top-bar location wrapper carries an inline `display:inline`.** The
   original stylesheet has `.topbar span{display:none}` below 575px (to hide the
   `|` separators); without the inline style, the location text the original page
   showed would be hidden on phones.
5. **Adding a CDN means updating the CSP** in `src/server.js`, or the resource is
   blocked silently.
6. **Passing text with non-ASCII characters through a shell command can corrupt
   it** (an em dash became `U+FFFD` this way during testing). Use a JSON file with
   `curl --data-binary @file`, or edit through the admin UI.
7. **Uploads are validated by file content, not the declared MIME type.** A file
   renamed to `.png` that is not really an image is rejected by design.
8. **Never let an email failure affect a lead.** `notifyNewLead()` is called
   *after* `res.json()` and is wrapped so it cannot throw. If you touch that
   path, keep it that way — see [§15.7](#157-failure-behaviour-do-not-regress-this).

---

## 15. Lead email notifications

Added after the original brief. Every new enquiry is emailed to a list of
recipients that the admin manages from the panel.

**Status: code-complete and tested end to end, but NOT yet delivering real
email.** It is waiting on two values in `.env` — see
[§15.6](#156-exact-remaining-steps-for-real-delivery).

### 15.1 What was implemented

- A notification email is sent for every new lead, to **multiple recipients** at
  once (all on a single message, so each person gets an identical copy).
- Recipients and the on/off switch are stored in the existing `site_settings`
  table and edited in **Admin → Settings → Lead Email Notifications**. Changing
  them needs **no code change and no redeploy**.
- **Send Test Email** button in that same card, rate-limited separately from the
  rest of the admin API.
- Per-lead delivery outcome recorded on the `Lead` row and shown in the lead
  detail drawer.
- Recipient addresses are validated in the browser **and again server-side** —
  the server check is the guarantee; an invalid address rejects the whole save.

New files: `src/lib/mailer.js`, `src/lib/email-template.js`,
`src/services/leadNotifier.js`.

New migration: `prisma/migrations/20260913090000_lead_email_notifications`
(adds the `NotifyStatus` enum and four `notify*` columns to `leads` — purely
additive, no data loss).

**No new npm dependencies.** The Resend HTTP API is called with the project's
existing `fetchWithTimeout` helper, the same pattern `src/lib/geo.js` uses.

### 15.2 Multiple recipients — how it works

| | |
|---|---|
| Setting key | `lead_email_recipients` (group `notifications`, type `textarea`) |
| Stored as | One address per line, lower-cased, de-duplicated |
| Accepted input | Newlines, commas or semicolons — normalised on save |
| Maximum | 25 (Resend itself allows 50 per message) |
| On/off key | `lead_email_enabled` — `"true"` / `"false"` |

Adding, removing or reordering recipients in the admin takes effect on the very
next lead. Removing an address stops it receiving immediately.

### 15.3 Current recipient configuration

As currently stored in the database:

```
lead_email_enabled     = true
lead_email_recipients  = vikash.digiguy@gmail.com
                         vikash.stratvice@gmail.com
```

Both addresses are intended to receive **every** new lead notification. Do not
reset or overwrite them.

### 15.4 Resend integration status

| Item | Status |
|---|---|
| Provider | Resend, called server-side at `https://api.resend.com/emails` |
| Integration code | Complete. Verified against Resend's published API contract (Bearer auth, snake_case `reply_to`, `to` array, `{id}` success body) |
| Connectivity | Confirmed. A live call with a deliberately invalid key returned `401: API key is invalid` — the request reaches Resend and is well-formed |
| `RESEND_API_KEY` | **Not set** |
| `EMAIL_FROM` | **Still the placeholder `leads@yourdomain.com`** |
| Verified sending domain | **Not done** |
| Real inbox delivery | **Never achieved** |

Because the key is absent, `mailer.send()` returns at its configuration guard
and **no HTTP request is made at all**. That is the sole reason no email
arrives. There is no known defect in the code.

### 15.5 Required configuration

Both live in `.env` only (git-ignored). Never in source, the database,
`README.md`, this file, or logs.

| Variable | Required | Notes |
|---|---|---|
| `RESEND_API_KEY` | **Yes** | Created at <https://resend.com/api-keys>. Scope: **Sending access** only. Shown once |
| `EMAIL_FROM` | **Yes** | e.g. `24x7 Customer Support <leads@yourdomain.com>`. Must be on a Resend-**verified** domain |
| `EMAIL_REPLY_TO` | No | Fallback when the lead left no email address |
| `EMAIL_TIMEZONE` | No | Default `Asia/Kolkata` |
| `EMAIL_TIMEOUT_MS` | No | Default `10000` |
| `RESEND_API_URL` | No | Override only for local testing against a stub |

`.env.example` carries the same key names with empty/placeholder values.

#### Verified-domain requirement — mandatory for this project

Resend only delivers to arbitrary recipients from a domain you have verified.

- `onboarding@resend.dev` needs no DNS **but only delivers to the email address
  on the Resend account**. With two different recipient addresses the second one
  gets a `403`, so it is **not sufficient here** — useful only as a one-off
  smoke test.
- A domain you control **must** be added at <https://resend.com/domains>. Resend
  then generates the DNS records for that specific domain — an SPF `TXT`, an SPF
  `MX`, and DKIM records (recently-added domains may get `CNAME` records
  instead). The exact host names and values are shown in the Resend dashboard
  and must be copied from there verbatim. They are per-domain and deliberately
  not written down here, because they cannot be known in advance.
- Records go on the **`send` subdomain**, not the root. A subdomain such as
  `send.yourdomain.com` is Resend's recommendation, to isolate sending
  reputation.
- Typically verifies within 15 minutes; DNS can take up to 72 hours.

A free mailbox domain (gmail.com, yahoo.com …) **cannot** be used as the sender.
Recipients may be Gmail addresses — only the *from* address is restricted.

### 15.6 Exact remaining steps for real delivery

1. Create the API key at <https://resend.com/api-keys> with **Sending access**.
2. Add and verify the sending domain at <https://resend.com/domains>, copying
   the generated DNS records into the domain's DNS host. **Wait until Resend
   reports "Verified"** — do not assume it.
3. In `.env`, set `RESEND_API_KEY` to the new key and `EMAIL_FROM` to an address
   on the verified domain.
4. Restart: `npm run dev:restart` (the environment is read once at boot).
5. **Admin → Settings** — the amber "not configured" banner should disappear.
   Confirm both recipients are listed and the toggle is on.
6. Press **Send Test Email** and check both inboxes (check spam too — a freshly
   verified domain has no sending reputation).
7. Submit a real enquiry from the public site and confirm both inboxes receive
   it, and that **Admin → Leads → (open lead) → Email notification** shows
   `SENT`.

### 15.7 Failure behaviour (do not regress this)

```
visitor submits → validate → save lead → 201 returned to visitor
                                       → THEN attempt email (setImmediate)
                                       → success: log + mark SENT
                                       → failure: log + mark FAILED
```

The email attempt happens **after** the response is sent and cannot throw into
the request. A lead is never lost, delayed or rolled back because of email, and
the visitor always sees the success message. Verified against an unreachable
provider, a rejecting provider, and a completely unconfigured one.

`Lead.notifyStatus` is `NOT_ATTEMPTED` (switched off, or no recipients), `SENT`,
or `FAILED`; `notifyAt`, `notifyRecipients` and `notifyError` carry the detail.
Provider errors pass through a sanitiser that redacts anything key-shaped
(`re_…`, `Bearer …`) before it is logged or stored.

### 15.8 Current testing status

Tested with a local stub speaking Resend's exact API contract, because no key
was available:

| Check | Result |
|---|---|
| Both recipients on one message | Pass |
| Adding a third recipient | Pass — all three included |
| Removing a recipient | Pass — stops receiving immediately |
| Invalid address rejected server-side | Pass — whole save rejected, nothing stored |
| Test Email button | Pass — success and failure both reported correctly |
| Real lead from the public form | Pass — saved, notification built and dispatched |
| Email content | Pass — name, phone, email, service, message, location, source, date/time, UTMs, Call + WhatsApp buttons |
| Lead survives email failure | Pass — verified three ways |
| Secrets hygiene | Pass — key absent from database, frontend, logs, README, HANDOFF, `.env.example` |
| **Real inbox delivery** | **NOT TESTED — blocked on the API key and verified domain** |

Read every "Pass" above as *the correct request is built and dispatched*, not as
proof that mail arrives. Nothing has yet reached a real inbox.
