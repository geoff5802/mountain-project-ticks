# Mountain Project Tick Catalog — Spec

> Status: **v1 + V2 build** — working app in this repo. Multi-area (Cathedral + Whitehorse)
> with tabs; storage on libSQL/Turso; a lean Vercel deployment (functions + cron) with an
> env-managed password gate. See `README.md` (incl. the Deploy section) and `src/` + `api/`.
> Last updated: 2026-06-23.
> Personal-use, access-gated catalog of climbing routes for a configurable Mountain
> Project (MP) area, augmented with "recently climbed" signals derived from tick data.

## 1. Goal

Maintain an independent, daily-refreshed catalog of every route in a target MP area
(starting with **Cathedral Ledge**, area id `105908823`; the area must be swappable
later). For each route, show the basic info from MP's route list **plus two new
columns**:

- **Climbed (last 24h)** — how many times the route was climbed in the last day.
- **Climbed (this week)** — how many times in the last 7 days.

Tick comments (free-form text like *"very wet"*, *"hot temps, hard 5.7"*) are captured
because they carry useful conditions/beta info. The app is for personal use and may be
hosted online but **access-gated** (not a public mirror of MP data).

## 2. Data sources (verified live on 2026-06-21)

Discovery was done with a headless browser network capture; **production needs no
browser** — both sources are plain HTTP GETs that work cookieless.

### 2.1 Route catalog — CSV export (one request, no crawl)

```
GET https://www.mountainproject.com/route-finder-export?selectedIds=<AREA_ID>&type=rock&diffMinrock=800&diffMaxrock=12400&stars=0&pitches=0&sort1=area&sort2=rating
→ 200 text/csv
```

For Cathedral Ledge this returns **265 routes** (~47 KB). Columns:

```
Route, Location, URL, "Avg Stars", "Your Stars", "Route Type", Rating, Pitches, Length, "Area Latitude", "Area Longitude"
```

Example row:

```
"Upper Refuse","Barber Wall > *Cathedral Ledge > New Hampshire",https://www.mountainproject.com/route/105938018/upper-refuse,3.1,-1,Trad,5.5,3,200,44.0622,-71.16582
```

- The `URL` column contains the route id (`105938018`) — this is the join key into the
  tick API. The whole "list page with basic info" is therefore **one GET**, no walking
  the area hierarchy.
- Export caps at ~1,000 rows; Cathedral (265) is well under. Multi-area / larger areas
  may need paging or multiple `selectedIds` later.

### 2.2 Tick data — JSON REST API (paginated, public, robots-allowed)

```
GET https://www.mountainproject.com/api/v2/routes/<ROUTE_ID>/ticks?per_page=250&page=1
→ 200 application/json   (works from a plain cookieless curl — no auth, no session)
```

Standard Laravel paginator envelope:

```json
{ "current_page": 1, "last_page": 1760, "per_page": 1, "total": 1760,
  "from": 1, "to": 1, "next_page_url": "...page=2", "prev_page_url": null,
  "first_page_url": "...", "last_page_url": "...", "path": "...", "links": [...],
  "data": [ /* ticks, newest-first */ ] }
```

Each tick object:

```json
{
  "id": 203207271,                       // STABLE per-tick id → dedup key (no hashing)
  "date": "Jun 19, 2026, 12:00 am",      // CLIMBED date — date-only (always midnight), user-backdatable
  "comment": null,                       // usually null; the real text is in `text`
  "style": "Lead",                       // Lead / Follow / TR / Solo / ""
  "leadStyle": "Onsight",                // Onsight / Flash / Redpoint / Fell/Hung / ""
  "pitches": 2,
  "text": " · Lead / Onsight. Led pitch one, Julia led pitch two. Very burly and hot temps. Fun but definitely a hard 5.7",
  "createdAt": "2026-06-20T02:59:34.000000Z",  // SUBMITTED at — real UTC timestamp
  "updatedAt": "2026-06-20T02:59:34.000000Z",
  "user": { "id": 109866365, "name": "Eric Rannestad" }   // or `false` when hidden/anonymous
}
```

Notes:
- **Newest-first ordering** → incremental "page until I hit a tick id I already stored"
  works.
- Sibling endpoints exist (`/stars`, `/ratings`, `/todos`) — out of scope for v1 but
  available (e.g. todos could power a future "popularity" signal).
- `text` is HTML-ish (contains `&middot;`, `\r\n`); needs light cleanup. The user-written
  comment is the portion after the auto-generated `"· Lead / Onsight."` prefix.
- `user` is `false` for private/anonymous ticks — store as null user.

### 2.3 robots.txt posture

`https://www.mountainproject.com/robots.txt` (for `User-agent: *`):

- **Disallowed:** `/admin* /ajax* /edit* /earth* /misc* /page-improvements* /data*`
- **`Crawl-delay: 60`**
- Both endpoints we use (`/api/v2/*` and `/route-finder-export`) are **NOT disallowed**.

We honor robots by staying on permitted paths and keeping volume tiny (see §5). The
old `/data/get-routes` API-key JSON API is deprecated (no new keys issued), so the
above is the realistic access path.

## 3. Architecture

```
┌─────────────────────────────┐     daily      ┌──────────────────────────┐
│  Ingest job (cron)          │ ─────────────▶ │  Postgres (or SQLite)    │
│  1. fetch catalog CSV       │   upsert       │   routes / ticks /       │
│  2. per route: GET ticks p1 │                │   crawl_runs             │
│  3. dedup + insert new      │                └──────────────────────────┘
└─────────────────────────────┘                            │ query
                                                            ▼
                                              ┌──────────────────────────┐
                                              │  Web UI (gated)          │
                                              │  sortable route table +  │
                                              │  24h / 7d climbed cols + │
                                              │  per-route tick detail   │
                                              └──────────────────────────┘
```

Stack (decided, §9): **local-first — Node.js + SQLite**, no cloud hosting at v1. An
ingest script (`crawl`) refreshes the DB; the UI is served locally. Hosting + an auth gate
are a **V2** concern (see §9 D1/D4). The schema and crawl logic are written to port cleanly
to Postgres/serverless later with no model changes.

## 4. Data model

```sql
-- One row per route currently (or recently) in the target area.
CREATE TABLE routes (
  mp_id        BIGINT PRIMARY KEY,          -- Mountain Project route id
  area_id      BIGINT NOT NULL,             -- area crawled under (supports multi-area later)
  name         TEXT   NOT NULL,
  location     TEXT,                        -- breadcrumb, e.g. "Barber Wall > *Cathedral Ledge > New Hampshire"
  url          TEXT   NOT NULL,
  avg_stars    REAL,
  route_type   TEXT,                        -- Trad / Sport / TR / Boulder / ...
  rating       TEXT,                        -- YDS etc, kept as string ("5.8", "5.10a R")
  pitches      INT,
  length_ft    INT,
  area_lat     REAL,
  area_lng     REAL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- updated each catalog sync; stale → route removed/moved
  raw          JSONB                        -- original CSV row, for forward-compat
);

-- One row per MP tick. id is MP's own tick id → natural dedup across daily crawls.
CREATE TABLE ticks (
  id           BIGINT PRIMARY KEY,          -- MP tick id
  route_mp_id  BIGINT NOT NULL REFERENCES routes(mp_id),
  climbed_date DATE   NOT NULL,             -- parsed from `date` (date-only)
  submitted_at TIMESTAMPTZ,                 -- parsed from `createdAt`
  src_updated_at TIMESTAMPTZ,               -- parsed from `updatedAt`
  style        TEXT,
  lead_style   TEXT,
  pitches      INT,
  text         TEXT,                        -- cleaned full tick text
  comment      TEXT,                        -- user-written portion only (derived from text), nullable
  user_id      BIGINT,                      -- null when hidden/anonymous
  user_name    TEXT,                        -- null / "Anonymous" when hidden
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when OUR crawler first saw it
  raw          JSONB
);
CREATE INDEX ticks_route_climbed_idx ON ticks (route_mp_id, climbed_date DESC);
CREATE INDEX ticks_submitted_idx     ON ticks (submitted_at DESC);

-- Crawl observability / idempotency.
CREATE TABLE crawl_runs (
  id            BIGSERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'running',  -- running / ok / partial / failed
  routes_seen   INT  DEFAULT 0,
  ticks_inserted INT DEFAULT 0,
  errors        JSONB                              -- per-route failures, for retry/alerting
);
```

## 5. Crawl logic

**Once per day:**

1. **Catalog sync.** GET the CSV (§2.1) for the configured area → parse → `UPSERT` into
   `routes`, refreshing `last_seen_at`. Routes not seen this run keep their old
   `last_seen_at` (a stale value flags removed/recategorized routes; we don't delete).
2. **Tick ingest (incremental).** For each active route:
   - `GET /api/v2/routes/{mp_id}/ticks?per_page=250&page=1`.
   - `INSERT … ON CONFLICT (id) DO NOTHING` for new ticks (and `DO UPDATE` if
     `updatedAt` changed, to catch edited comments).
   - Since ticks are newest-first, **page 1 (250 ticks) covers far more than a week** for
     any Cathedral route, so v1 fetches only page 1 per route per day. (Guard: if all 250
     on page 1 are new — impossible at this area's volume — fetch page 2, repeat.)
3. **Record** a `crawl_runs` row (counts + any per-route errors).

**Volume:** 1 CSV + ~265 tick calls / day. At ~300–500 ms spacing that's ~1.5–2 min
total — fits one serverless invocation. This is far gentler than a human browsing, and
runs once daily.

**Politeness & robustness:**
- Descriptive `User-Agent` identifying the project + a contact.
- Throttle (~300–500 ms between requests); exponential backoff on `429`/`5xx`; honor
  `Retry-After`.
- Validate each payload against the expected shape; on parse failure, store `raw`, log to
  `crawl_runs.errors`, and continue (don't fail the whole run for one bad route).
- Conditional GET / ETag on the CSV if supported.

**Backfill (optional, separate one-off job):** to load full tick history, loop pages
`1..last_page` per route with the same dedup. Not required for the 24h/7d feature.

## 6. Derived metrics — the "climbed recently" columns

The tick `date` (climbed date) is **date-only and user-backdatable**; `submitted_at` is a
precise timestamp. Per §9 D2 these columns are **indicators, not exact counts**, and are
computed on `climbed_date`:

- **Last climbed** = `MAX(climbed_date)` per route — always shown, so you can see recency
  even outside the windows.
- **Climbed (recent / "past day or so")** =
  `COUNT(*) WHERE climbed_date >= current_date - INTERVAL '1 day'` — a deliberately loose
  "climbed today or yesterday" indicator (the source date is date-only, so a precise
  rolling 24h isn't meaningful; an indicator is the goal).
- **Climbed (this week)** = `COUNT(*) WHERE climbed_date >= current_date - INTERVAL '6 days'`
  (trailing 7 calendar days).

**Important caveat to surface in the UI:** you only see a tick once it's *submitted*, and
people backdate. So a given day's count can **grow over subsequent days** as late entries
arrive. Don't treat a day's number as final. (This is inherent to the source data, not a
bug.)

These are cheap `GROUP BY route_mp_id` queries (optionally a materialized view refreshed
post-crawl). Storing raw ticks means "this month", "this year", and trend charts come for
free later with no schema change.

## 7. Web UI

- **Route table**: Route · Area/Location · Grade · Type · Pitches · Length · Avg
  Stars · **Last climbed** (date) · **Climbed recent** · **Climbed 7d** · link out to MP.
  Sortable (esp. by the climbed columns / last-climbed to see "what's hot now"); filter by
  grade range / type / area.
- **Row expand → recent ticks**: date, style/leadStyle, user, and the comment text
  (conditions/beta). Link each tick back to MP.
- **"Last updated" banner** from the latest successful `crawl_runs` row.
- **Access gate**: deferred to **V2** (when the app is pushed online). v1 runs locally and
  is unauthenticated.
- **Area is config-driven** (env/config), so swapping Cathedral → another area is a
  one-line change; `routes.area_id` supports holding several areas at once later.

## 8. Legal / operational posture

- MP's ToS does not condone scraping, and its owner (onX) has historically been
  aggressive about **redistribution** of this data (cease-and-desist + DMCA against the
  OpenBeta project). The exposure is concentrated in *publicly re-hosting* user content.
- Mitigations baked into this design: **personal use, access-gated** (not a public
  mirror); we stay on **robots-permitted** paths; **tiny daily volume**; a descriptive,
  contactable crawler User-Agent; and **attribution + link-back to MP** on every route and
  tick shown. Comments are stored and displayed only inside the gated app.
- Residual risk remains (undocumented internal API, ToS). Acceptable for a gated personal
  tool; revisit before any public launch.

## 9. Decisions (confirmed 2026-06-21)

| # | Decision | Resolution |
|---|----------|------------|
| D1 | Hosting | **Local-only** — Node.js + SQLite, no cloud hosting at v1 |
| D2 | Recency columns | **Indicators on `climbed_date`** ("past day or so" + this week); **always show most-recent climbed date** |
| D3 | Full-history backfill | **Skip** — first crawl's page 1 already populates recent windows (lowest effort) |
| D4 | Auth gate | **Deferred to V2** (added when pushed online) |
| D5 | Removed routes | **Keep + flag** via stale `last_seen_at`; never hard-delete |

## 10. Milestones / task breakdown

- **M0 — Scaffold:** Next.js app, DB connection, env + area config, migrations.
- **M1 — Catalog sync:** CSV fetch + parse → `routes` upsert; verify 265 Cathedral routes.
- **M2 — Tick ingest:** page-1 incremental fetch + dedup on tick id + `crawl_runs` logging
  + text/comment cleanup.
- **M3 — Metrics:** last-climbed + recent + 7d queries.
- **M4 — UI:** local sortable/filterable route table + per-route tick detail + "last
  updated" + attribution/link-back.
- **M5 — Run loop:** one `crawl` command with retries/backoff + simple scheduling guidance
  (local cron / launchd / manual).
- **V2 — Online:** hosting + auth gate, plus optional full-history backfill, multi-area
  support, trend charts, and use of `/todos`/`/ratings` siblings.

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Internal API changes/breaks (undocumented) | Medium | Thin adapter + schema validation + store `raw`; alert on parse-failure spike |
| Rate-limited / IP-blocked | Low (tiny volume) | Throttle, backoff, honor `Retry-After`, identifying UA, daily-only |
| ToS / redistribution claim | Low while gated | Personal + gated + attribution; no public mirror; revisit before any public launch |
| CSV export row cap (~1,000) | None for Cathedral | Page / multi-`selectedIds` when scaling to bigger areas |
| Backdated ticks revise counts | Certain (by design) | Document in UI; counts are "best known so far", not final |
```
