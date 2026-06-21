# Mountain Project Tick Catalog

A local, zero-dependency tool that catalogs every climbing route in a Mountain Project
area and shows **what's getting climbed right now** — derived from crowd-sourced "tick"
data (a tick = a logged ascent, often with a comment).

It answers questions a static guidebook can't:

- *What got climbed here in the past day? This week?*
- *When was this route last climbed?*
- *What are people saying about conditions?* (e.g. *"very wet"*, *"hot temps, hard 5.7"*)

Default area: **Cathedral Ledge, NH** (`105908823`). The area is a one-line config change,
so the same tool works for any Mountain Project area.

> **Status:** v1 — runs locally. See [`SPEC.md`](./SPEC.md) for the full design, data
> sources, and decisions. Hosting + an access gate are a planned V2.

## What you get

A sortable, filterable table of every route in the area with its basic info (grade, type,
pitches, length, stars) **plus** three recency columns computed from tick data:

| Column | Meaning |
|---|---|
| **Last climbed** | Most recent climbed date on record |
| **Past day~** | Climbed today/yesterday (a loose indicator — source dates are date-only) |
| **This week** | Climbed in the trailing 7 days |

Click any route to expand its **recent ticks**: date, style (Lead/Follow/TR, Onsight/etc.),
climber, and their comment — the conditions/beta you actually want before driving out.

## Requirements

- **Node.js ≥ 22.5** — uses the built-in `node:sqlite` and global `fetch`. **No `npm install`,
  no native modules, no API keys.**

## Quickstart

```bash
npm run crawl     # fetch catalog + newest ticks into data/catalog.sqlite (~2 min)
npm run serve     # serve the table at http://localhost:4173
```

Run `crawl` once a day (cron / launchd) to keep the recency columns fresh. Tick IDs are
stable, so re-running only adds new ticks — history accumulates and the first run does the
heavy lifting; later runs are quick.

Point it at a different area:

```bash
AREA_ID=105720495 AREA_NAME="Smith Rock" npm run crawl
```

Other env knobs (see `src/config.js`): `THROTTLE_MS`, `PER_PAGE`, `DB_PATH`, `PORT`,
`RECENT_TICKS`.

## How it works

Two robots-permitted, cookieless endpoints — no headless browser, no scraping of rendered
HTML:

1. **Catalog** — `GET /route-finder-export?selectedIds=<AREA_ID>&…` returns the whole area
   as CSV in a single request (265 routes for Cathedral).
2. **Ticks** — `GET /api/v2/routes/<ROUTE_ID>/ticks?per_page=250&page=1` is a public,
   paginated JSON API. Each tick has a **stable id** (used for dedup), a climbed date, a
   submission timestamp, style fields, the comment text, and the climber.

The crawler is deliberately light and polite: ~266 requests once a day, throttled, with an
identifying User-Agent and retry/backoff. Data lands in a local SQLite file; the recency
columns are plain SQL queries over the stored ticks (so "this month", trends, etc. are easy
to add later with no schema change).

## Project layout

```
src/config.js   area + crawl settings (env-overridable)
src/mp.js       Mountain Project HTTP client (throttle, retries/backoff)
src/csv.js      CSV parser for the catalog export
src/db.js       node:sqlite schema + connection
src/crawl.js    ingest job: catalog sync + tick ingest (dedup on tick id)
src/metrics.js  read queries for the UI
src/render.js   HTML page (client-side sort/filter/expand)
src/server.js   local web server
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

## Roadmap (V2)

- Hosting + a simple access gate
- Optional full tick-history backfill
- Multiple areas at once; trend charts over time
