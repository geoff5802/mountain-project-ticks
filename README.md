# Mountain Project Tick Catalog

A tool that catalogs every climbing route across one or more Mountain Project areas and
shows **what's getting climbed right now** — derived from crowd-sourced "tick" data
(a tick = a logged ascent, often with a comment).

It answers questions a static guidebook can't:

- *What got climbed here in the past day? This week?*
- *When was this route last climbed?*
- *What are people saying about conditions?* (e.g. *"very wet"*, *"hot temps, hard 5.7"*)

Areas are configured in `src/config.js` and shown as **tabs** in the UI. Ships with
**Cathedral Ledge** and **Whitehorse Ledge** (NH); adding another area is one line.

Storage is **libSQL** (`@libsql/client`): a local file in dev, and a hosted
[Turso](https://turso.tech) database in production — the same code and SQL run in both.

> **Status:** v1 runs locally; the storage layer is ready for the Vercel deployment
> (see [`SPEC.md`](./SPEC.md) §9). An env-managed password gate ships with the hosted build.

## What you get

A sortable, filterable, **tabbed** table (one tab per area) of every route with its basic
info (grade, type, pitches, length, stars) **plus** three recency columns computed from
tick data:

| Column | Meaning |
|---|---|
| **Last climbed** | Most recent climbed date on record |
| **Past day~** | Climbed today/yesterday (a loose indicator — source dates are date-only) |
| **This week** | Climbed in the trailing 7 days |

Click any route to expand its **recent ticks**: date, style (Lead/Follow/TR, Onsight/etc.),
climber, and their comment — the conditions/beta you actually want before driving out.

## Requirements

- **Node.js ≥ 22.5** (global `fetch`) and one dependency, the libSQL client.

```bash
npm install
```

## Quickstart

```bash
npm run crawl     # crawl every configured area into data/catalog.sqlite (~3-4 min)
npm run serve     # serve the tabbed table at http://localhost:4173
```

Run `crawl` once a day (cron / launchd) to keep the recency columns fresh. Tick IDs are
stable, so re-running only adds new ticks — history accumulates and the first run does the
heavy lifting; later runs are quick.

**Add an area:** append to the `AREAS` list in `src/config.js` — the crawler and the UI
tabs pick it up automatically. Each entry is `{ id, name, slug }` where `id` is the MP area
id from the area URL.

Env knobs (see `src/config.js`): `THROTTLE_MS`, `PER_PAGE`, `PORT`, `RECENT_TICKS`, and
`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` (point storage at a hosted Turso DB instead of the
local file).

## How it works

Two robots-permitted, cookieless endpoints — no headless browser, no scraping of rendered
HTML:

1. **Catalog** — `GET /route-finder-export?selectedIds=<AREA_ID>&…` returns the whole area
   as CSV in a single request (265 routes for Cathedral).
2. **Ticks** — `GET /api/v2/routes/<ROUTE_ID>/ticks?per_page=250&page=1` is a public,
   paginated JSON API. Each tick has a **stable id** (used for dedup), a climbed date, a
   submission timestamp, style fields, the comment text, and the climber.

The crawler is deliberately light and polite: it iterates the configured areas (one CSV
request each) plus one tick request per route, once a day, throttled, with an identifying
User-Agent and retry/backoff. Writes are batched per route so it stays efficient against a
remote (Turso) database too. The recency columns are plain SQL queries over the stored
ticks (so "this month", trends, etc. are easy to add later with no schema change).

## Project layout

```
src/config.js   areas list + crawl/storage settings (env-overridable)
src/mp.js       Mountain Project HTTP client (throttle, retries/backoff)
src/csv.js      CSV parser for the catalog export
src/db.js       libSQL client + schema/migrations
src/crawl.js    runCrawl(): per-area catalog sync + tick ingest (dedup on tick id)
src/metrics.js  read queries for the UI
src/render.js   tabbed HTML page (client-side area tabs / sort / filter / expand)
src/server.js   local dev web server (no auth)
src/auth.js     password-gate helpers (HMAC cookie)
middleware.js   Vercel Routing Middleware — the password gate
api/index.js    Vercel Function — serves the catalog page ("/")
api/login.js    Vercel Function — login page + form handler ("/login")
api/crawl.js    Vercel Function — daily crawl, run by Vercel Cron
vercel.json     cron schedule + rewrites + function maxDuration
SPEC.md         full design, data sources, schema, decisions, roadmap
```

## Data notes & etiquette

- Tick climbed-dates are **user-entered and can be backdated**, and ticks appear only once
  submitted — so a given day's counts can grow as late entries arrive. The recency columns
  are **indicators, not exact tallies**. (Future-dated and dateless ticks are excluded from
  the windows.)
- This is for **personal use**. The crawler stays on robots-permitted endpoints, identifies
  itself, throttles, and runs at most once daily. Tick comments are user-authored — the UI
  attributes and links back to Mountain Project. Don't redistribute the data publicly.

## Deploy to Vercel (Turso + password gate)

The hosted build is lean: three Vercel Functions + Routing Middleware + a daily cron, all
reusing the `src/` modules. See `.env.example` for the variables.

1. **Create a Turso database** and grab its URL + token:
   ```bash
   turso db create mountain-ticks
   turso db show mountain-ticks --url      # -> TURSO_DATABASE_URL
   turso db tokens create mountain-ticks   # -> TURSO_AUTH_TOKEN
   ```
2. **Seed it once, from your machine** (avoids the function time limit on the big first
   crawl):
   ```bash
   TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… npm run crawl
   ```
3. **Link & deploy** with the Vercel CLI (`vercel`), then set env vars in the project:
   `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `SITE_PASSWORD`, `CRON_SECRET`.
4. **Deploy to production** (`vercel --prod`). Vercel registers the cron from `vercel.json`
   (daily 09:00 UTC → `/api/crawl`) and sends it `Authorization: Bearer $CRON_SECRET`.

**Password gate:** active whenever `SITE_PASSWORD` is set — visitors get a sign-in page; a
correct password sets a signed cookie. Change the password anytime by editing the env var in
the Vercel dashboard (no code change). Unset = open (handy for local/preview). Local
`npm run serve` is unauthenticated by design; use `vercel dev` to exercise the full gated
flow locally.

> Steady-state: the daily cron re-checks every route (~1 request each) and fits the 300s
> function limit. If you add many more areas, split the cron per area or move to a queue.

## Roadmap

- Optional full tick-history backfill
- Trend charts over time; richer per-route history
