# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single Express 5 server that renders a marketing landing page ("24x7 Customer
Support") from PostgreSQL via EJS, plus an admin CMS at `/admin` for editing
every piece of that page and managing the leads it captures. There is no
frontend build step and no test suite — `public/` is served as plain static
files.

The original page was a static HTML file (kept at `docs/original-static-page.html`).
Preserving its markup, CSS and animations byte-for-byte was an explicit project
requirement: `views/index.ejs` is that file with values swapped for `<%= %>`,
and `public/style.css` is the untouched original. Do not restyle either unless
asked.

## Commands

```bash
npm run dev            # nodemon on src/server.js
npm start              # plain node
npm run setup          # prisma migrate deploy && generate && seed
npm run db:seed        # idempotent — upserts by key, never clobbers edited values
npm run create:admin   # interactive; or -- --email x --username y --password 'Z'
npm run prisma:studio
```

### Local database (PGlite)

`.env` points at a bundled dev-only Postgres (WASM, wire-protocol socket on
`127.0.0.1:5433`). It accepts **one connection at a time**, which shapes local
workflow:

```bash
npm run db:local       # terminal 1 — the database
npx prisma db push && npm run db:seed && npm start   # terminal 2
npm run dev:restart    # kills and restarts DB + app together (do this after any force-kill)
```

`prisma migrate dev` needs a shadow database and **does not work against
PGlite** — use `db push` locally, and author real migrations against a hosted
Postgres. To produce a migration file with no live database:

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

### Verifying a change

There are no automated tests. Check `GET /healthz` (returns `{ok, db}`), read
`.server.log` / `.pglite.log`, and exercise the page or admin screen by hand.

## Architecture

```
Browser → Express (src/server.js)
   /api/admin/*  → routes/api.admin.js   JWT-gated, 401 JSON
   /api/*        → routes/api.public.js  rate-limited, ends in a catch-all 404
   /admin/*      → routes/admin.js       JWT-gated, redirects to login
   /             → routes/public.js      → services/content.js → Prisma → views/index.ejs
```

**Content model.** Everything on the page is a database row. `PageSection` holds
one row per section with a section-shaped JSON `content` blob (see
`prisma/seed.js` for the canonical shapes); `Service`/`Testimonial`/`Faq` are
ordered, soft-activated lists; `SiteSetting` is a flat key/value store grouped as
`general | contact | social | seo | cta | location | notifications`, flattened to
`{key: value}` for templates.

**Caching.** `services/content.js` assembles and caches the whole page for 30s.
Every admin write path must call `content.invalidate()` — `api.admin.js` wraps
most responses in a local `live(res, payload)` helper that does this.

**Location-aware copy.** Any admin-entered string may contain `{{city}}`,
`{{state}}`, `{{country}}`; `lib/format.js:personalise()` substitutes them and
tidies dangling prepositions, falling back to the `default_city` / `default_state`
settings. Resolution order for a visitor: `visitor_loc` cookie → browser
geolocation (`public/js/geo.js`, prompts at most once ever) → server-side IP
lookup → configured defaults. Detection never blocks rendering, and a lead with
no location is still saved.

**Auth.** JWT in an httpOnly cookie; no session table. `loadAdmin` runs globally
and re-reads the admin row per request, so deactivating an account kills live
sessions. `requireAdminPage` redirects, `requireAdminApi` returns 401 JSON.

**Validation.** zod schemas live next to their routes; the `validate(schema,
source)` middleware replaces `req.body` with parsed data, and puts parsed query
params on `req.validatedQuery` rather than back on `req.query`. Throw
`HttpError` from `lib/http.js` for anything client-facing; wrap async handlers in
`asyncHandler` so rejections reach the error middleware, which logs 5xx and
returns a generic message.

**Email.** Lead notifications go through Resend (`lib/mailer.js` →
`services/leadNotifier.js`). The recipient list and on/off switch are
`site_settings` rows (`lead_email_recipients`, `lead_email_enabled`) editable from
the admin panel; only the API key is env. Optional — the app boots and captures
leads with it unconfigured.

**Uploads.** `lib/storage.js` switches on `STORAGE_DRIVER` (`local` | `cloudinary`).
Only the URL and metadata are stored in `Media`, never the binary. Files are
validated by magic bytes, not the declared MIME type.

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
- The admin page routes import `leadWhere` / `leadQuerySchema` / `STATUSES` from
  `routes/api.admin.js`; keep lead filtering defined there so pages and API agree.
- The top-bar location wrapper carries an inline `display:inline` that defeats
  `.topbar span{display:none}` under 575px. Removing it hides the location on
  phones.
- Non-ASCII text passed through a shell command can get corrupted — edit content
  through the admin UI or `curl --data-binary @file.json`.

`HANDOFF.md` is the long-form project history and has more detail on the email
integration and known limitations.
