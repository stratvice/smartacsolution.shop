# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single Express 5 server that renders a marketing landing page ("24x7 Customer
Support") from MySQL via EJS, plus an admin CMS at `/admin` for editing every
piece of that page and managing the leads it captures. There is no frontend
build step and no test suite — `public/` is served as plain static files.

The original page was a static HTML file (kept at `docs/original-static-page.html`).
Preserving its markup, CSS and animations byte-for-byte was an explicit project
requirement: `views/index.ejs` is that file with values swapped for `<%= %>`,
and `public/style.css` is the original stylesheet. Don't restyle either unless
asked.

Deployed on Hostinger shared hosting at `smartacsolution.shop`; see
**Deployment** below, which constrains several design decisions.

## Commands

```bash
npm run dev            # nodemon on src/server.js
npm start              # plain node
npm run db:init        # create tables from db/schema.sql (idempotent)
npm run db:seed        # upserts by key; never clobbers an edited value
npm run setup          # db:init && db:seed
npm run create:admin   # interactive; or -- --email x --username y --password 'Z'
```

You need a MySQL/MariaDB 10.5+ database and a `.env` (copy `.env.example`).
`DATABASE_URL` is a `mysql://` URL; add `?socket=/path/to/mysql.sock` on hosts
whose MySQL doesn't listen on TCP.

### Verifying a change

There are no automated tests. Check `GET /healthz` (returns `{ok, db}`), and
exercise the page or admin screen by hand. On the server, runtime output is
captured in `console.log` in the app directory.

## Architecture

```
Browser → Express (src/server.js)
   /api/admin/*  → routes/api.admin.js   JWT-gated, 401 JSON
   /api/*        → routes/api.public.js  rate-limited, ends in a catch-all 404
   /admin/*      → routes/admin.js       JWT-gated, redirects to login
   /             → routes/public.js      → services/content.js → views/index.ejs
```

**Data layer.** `src/lib/prisma.js` is **not Prisma** — it's a hand-written
adapter over `mysql2` that deliberately keeps Prisma's call shapes
(`findMany`/`findUnique`/`create`/`update`/`upsert`/`count`/`groupBy`,
`$queryRaw`, `$transaction`). It was swapped in wholesale because Prisma's
native Rust query engine panics inside Hostinger's CloudLinux container, and
keeping the API identical meant ~90 call sites didn't have to change. The name
is kept so those call sites read naturally.

Things to know before extending it:

- It implements only what the app calls, and **throws on unsupported filter
  operators** rather than silently returning wrong rows. Add operators to
  `buildWhere` as needed.
- Column types are introspected via `SHOW COLUMNS` and cached per process.
  MariaDB reports JSON columns as `longtext`, so genuinely-JSON columns are
  also declared explicitly in `JSON_COLUMNS`. Add to it when you add one.
- `$transaction` is `Promise.all`, **not** a real transaction — no rollback.
  This is the one place the adapter still diverges from Prisma's semantics.
- `upsert` is check-then-insert, so two concurrent upserts of the same unique
  key can race into a duplicate-key error rather than one becoming an update.
- Relations are matched to parents by `id`, so `findMany` borrows `id` into the
  `SELECT` when `include` is used with a `select` that omits it, then strips it
  from the results. Keep that behaviour if you touch `findMany`.

**Content model.** Everything on the page is a database row. `page_sections`
holds one row per section with a section-shaped JSON `content` blob (see
`scripts/seed.js` for the canonical shapes); `services`/`testimonials`/`faqs`
are ordered, soft-activated lists; `site_settings` is a flat key/value store
grouped as `general | contact | social | seo | cta | location | notifications`,
flattened to `{key: value}` for templates.

**Schema.** `db/schema.sql` is the source of truth, applied by
`scripts/init-db.js`. Every `CREATE TABLE` is `IF NOT EXISTS`, so re-running is
safe. There is no migration tool — for a schema change, edit both the SQL and
any affected code, and write the `ALTER` yourself.

**Caching.** `services/content.js` assembles and caches the whole page for 30s.
Every admin write path must call `content.invalidate()` — `api.admin.js` wraps
most responses in a local `live(res, payload)` helper that does this.

**Location-aware copy.** Any admin-entered string may contain `{{city}}`,
`{{state}}`, `{{country}}`; `lib/format.js:personalise()` substitutes them and
tidies dangling prepositions, falling back to the `default_city` /
`default_state` settings. Resolution order for a visitor: `visitor_loc` cookie →
browser geolocation (`public/js/geo.js`, prompts at most once ever) →
server-side IP lookup → configured defaults. Detection never blocks rendering,
and a lead with no location is still saved.

**Auth.** JWT in an httpOnly cookie; no session table. `loadAdmin` runs globally
and re-reads the admin row per request, so deactivating an account kills live
sessions. `requireAdminPage` redirects, `requireAdminApi` returns 401 JSON.

**Validation.** zod schemas live next to their routes; the `validate(schema,
source)` middleware replaces `req.body` with parsed data, and puts parsed query
params on `req.validatedQuery` rather than back on `req.query`. Throw
`HttpError` from `lib/http.js` for anything client-facing; wrap async handlers
in `asyncHandler` so rejections reach the error middleware, which logs 5xx and
returns a generic message.

**Email.** Lead notifications go through `lib/mailer.js` →
`services/leadNotifier.js`. Three transports: `smtp` (Gmail and anything
else), `resend` (HTTP API, no ports to be blocked) and `sendmail` (the host's
own mail program, no credential at all but unsigned and easily filtered).

`EMAIL_DRIVER` forces one. Left unset, `config/env.js` resolves it from what
is usable — SMTP credentials, then a Resend key, then a mail program at
`SENDMAIL_PATH` — so a server with no mail config still sends if the host
provides a way. Under `sendmail` the from-address is forced to the site's own
domain: there is no account behind it, and any other domain fails SPF.

The recipient list and on/off switch are `site_settings` rows
(`lead_email_recipients`, `lead_email_enabled`) editable from the admin panel;
only credentials are env. Optional — the app boots and captures leads with it
unconfigured, and `mailer.describeTransport()` is what the settings page shows.

**Uploads.** `lib/storage.js` switches on `STORAGE_DRIVER` (`local` |
`cloudinary`). Only the URL and metadata are stored in `media`, never the
binary. Files are validated by magic bytes, not the declared MIME type.

## Deployment

Hostinger shared hosting, behind LiteSpeed/Passenger. Three properties of that
environment shape the code:

1. **No native binaries.** Prisma's Rust engine panics there — hence the
   `mysql2` adapter. Don't reintroduce a dependency that ships a native engine.
2. **MySQL is socket-only**, not listening on TCP, hence `?socket=` in
   `DATABASE_URL`.
3. **Each deploy builds into a new directory** (`hbuilds/versions/<uuid>`) and
   deletes the previous one. Anything written next to the app is therefore
   destroyed on the next deploy. Two consequences, both already handled:
   - `src/config/load-env.js` loads `./.env`, then walks up for a `.env.shared`
     held outside the versioned tree. Precedence: real environment > `./.env` >
     `../.env.shared`. Production config lives in `.env.shared` in the domain
     root.
   - `UPLOAD_DIR` must point outside the deployed tree for `STORAGE_DRIVER=local`,
     or uploaded images are deleted while their `media` rows survive and 404.
     `server.js` serves it from a dedicated `/uploads` static mount.

Deploys pull from GitHub (`stratvice/smartacsolution.shop`, branch `main`).
`npm run db:init` and `db:seed` are run manually over SSH, not on deploy.

## Invariants

- **`/api/admin` must stay mounted before `/api`** in `src/server.js`. The public
  router ends in a catch-all 404 that otherwise swallows every admin API call.
- **Any new admin write calls `content.invalidate()`**, or the public page serves
  stale content for up to 30s.
- **An email failure must never affect a lead.** `notifyNewLeadInBackground()` is
  called *after* `res.json()` and cannot throw; failures are recorded on the lead
  row (`notifyStatus`/`notifyError`) only.
- **Adding a CDN means updating the CSP** in `src/server.js` — helmet is
  configured with an explicit allowlist and blocks silently otherwise.
- **Client IP comes from `req.ip`**, never from `X-Forwarded-For` directly. The
  app sets `trust proxy`; reading the header and taking `[0]` returns whatever
  the client sent, letting anyone forge the IP recorded against a lead.
- **Search terms are escaped for LIKE** in the adapter's `contains`/`startsWith`.
  Unescaped `%` and `_` behave as wildcards and match everything.
- The admin page routes import `leadWhere` / `leadQuerySchema` / `STATUSES` from
  `routes/api.admin.js`; keep lead filtering defined there so pages and API agree.
- The top-bar location wrapper carries an inline `display:inline` that defeats
  `.topbar span{display:none}` under 575px. Removing it hides the location on
  phones.
- Rate limiters use the default in-memory store, so limits are per process. The
  app server may run several — treat the configured numbers as a floor.

`HANDOFF.md` is the original project history. It predates the MySQL migration
and describes Prisma, PostgreSQL and PGlite, none of which exist here any more —
read it for intent, not for mechanics.
