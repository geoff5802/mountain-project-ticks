// Ingest job: for each configured area, sync the route catalog from the CSV
// export, then fetch the newest page of ticks per route and upsert (deduped on
// MP tick id). Exposed as runCrawl() so both the CLI (npm run crawl) and the
// Vercel /api/crawl function can call it. Writes are batched per route to keep
// round-trips low against a remote (Turso) database.
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { getClient, migrate } from './db.js';
import { fetchCatalogCsv, fetchTicksPage } from './mp.js';
import { parseCsvToObjects } from './csv.js';
import {
  nowIso, parseClimbedDate, cleanTickText, deriveComment,
  orNull, intOrNull, floatOrNull,
} from './util.js';

const routeIdFromUrl = (url) => {
  const m = String(url || '').match(/\/route\/(\d+)\//);
  return m ? Number(m[1]) : null;
};

const UPSERT_ROUTE = `
  INSERT INTO routes (mp_id, area_id, name, location, url, avg_stars, route_type,
                      rating, pitches, length_ft, area_lat, area_lng, first_seen_at, last_seen_at, raw)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(mp_id) DO UPDATE SET
    area_id=excluded.area_id, name=excluded.name, location=excluded.location, url=excluded.url,
    avg_stars=excluded.avg_stars, route_type=excluded.route_type, rating=excluded.rating,
    pitches=excluded.pitches, length_ft=excluded.length_ft, area_lat=excluded.area_lat,
    area_lng=excluded.area_lng, last_seen_at=excluded.last_seen_at, raw=excluded.raw`;

const INSERT_TICK = `
  INSERT INTO ticks (id, route_mp_id, climbed_date, submitted_at, src_updated_at,
                     style, lead_style, pitches, text, comment, user_id, user_name, observed_at, raw)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

const UPDATE_TICK = `
  UPDATE ticks SET climbed_date=?, submitted_at=?, src_updated_at=?, style=?, lead_style=?,
                   pitches=?, text=?, comment=?, user_id=?, user_name=?, raw=? WHERE id=?`;

async function syncCatalog(client, area) {
  const csv = await fetchCatalogCsv(area.id);
  const rows = parseCsvToObjects(csv);
  const now = nowIso();
  const areaId = Number(area.id);
  const stmts = [];
  const routes = [];
  for (const r of rows) {
    const mpId = routeIdFromUrl(r.URL);
    if (!mpId) continue;
    stmts.push({
      sql: UPSERT_ROUTE,
      args: [
        mpId, areaId, r.Route || '(unnamed)', orNull(r.Location), r.URL,
        floatOrNull(r['Avg Stars']), orNull(r['Route Type']), orNull(r.Rating),
        intOrNull(r.Pitches), intOrNull(r.Length), floatOrNull(r['Area Latitude']),
        floatOrNull(r['Area Longitude']), now, now, JSON.stringify(r),
      ],
    });
    routes.push({ mpId, name: r.Route });
  }
  if (stmts.length) await client.batch(stmts, 'write');
  return routes;
}

function tickFields(t) {
  const style = orNull(t.style) || null;
  const leadStyle = orNull(t.leadStyle) || null;
  const text = cleanTickText(t.text);
  const comment = deriveComment(text, style, leadStyle);
  const user = t.user && typeof t.user === 'object' ? t.user : null;
  return {
    id: intOrNull(t.id),
    climbed: parseClimbedDate(t.date),
    submitted: orNull(t.createdAt) || null,
    updated: orNull(t.updatedAt) || null,
    style, leadStyle,
    pitches: intOrNull(t.pitches),
    text, comment,
    userId: user ? intOrNull(user.id) : null,
    userName: user ? (orNull(user.name) || null) : null,
    raw: JSON.stringify(t),
  };
}

async function ingestTicksForRoute(client, route, counters) {
  // v1: only page 1 (newest 250) — covers far more than the windows we report.
  const payload = await fetchTicksPage(route.mpId, 1);
  const ticks = Array.isArray(payload?.data) ? payload.data : [];
  const now = nowIso();

  const ex = await client.execute({
    sql: 'SELECT id, src_updated_at FROM ticks WHERE route_mp_id = ?',
    args: [route.mpId],
  });
  const seen = new Map(ex.rows.map((r) => [Number(r.id), r.src_updated_at]));

  const stmts = [];
  let ins = 0, upd = 0;
  for (const t of ticks) {
    const f = tickFields(t);
    if (f.id == null) continue;
    if (!seen.has(f.id)) {
      stmts.push({ sql: INSERT_TICK, args: [
        f.id, route.mpId, f.climbed, f.submitted, f.updated, f.style, f.leadStyle,
        f.pitches, f.text, f.comment, f.userId, f.userName, now, f.raw] });
      ins++;
    } else if (seen.get(f.id) !== f.updated) {
      stmts.push({ sql: UPDATE_TICK, args: [
        f.climbed, f.submitted, f.updated, f.style, f.leadStyle, f.pitches,
        f.text, f.comment, f.userId, f.userName, f.raw, f.id] });
      upd++;
    }
  }
  if (stmts.length) await client.batch(stmts, 'write');
  counters.inserted += ins;
  counters.updated += upd;
  return { total: payload?.total ?? null };
}

export async function runCrawl({ log = () => {} } = {}) {
  const client = getClient();
  await migrate(client);
  const ins = await client.execute({ sql: 'INSERT INTO crawl_runs (started_at) VALUES (?)', args: [nowIso()] });
  const runId = Number(ins.lastInsertRowid);
  const counters = { inserted: 0, updated: 0 };
  const errors = [];
  let routesSeen = 0;

  for (const area of config.areas) {
    let routes;
    try {
      routes = await syncCatalog(client, area);
      log(`[crawl] ${area.name}: ${routes.length} routes`);
    } catch (err) {
      errors.push({ stage: 'catalog', area: area.id, error: String(err) });
      log(`[crawl] ${area.name}: catalog failed — ${err}`);
      continue;
    }
    routesSeen += routes.length;
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      try {
        const { total } = await ingestTicksForRoute(client, route, counters);
        if (total != null) {
          await client.execute({ sql: 'UPDATE routes SET tick_total=? WHERE mp_id=?', args: [total, route.mpId] });
        }
      } catch (err) {
        errors.push({ area: area.id, route: route.mpId, name: route.name, error: String(err) });
      }
      if ((i + 1) % 40 === 0 || i === routes.length - 1) {
        log(`[crawl] ${area.name}: ticks ${i + 1}/${routes.length}`);
      }
    }
  }

  const status = errors.length === 0 ? 'ok' : 'partial';
  await client.execute({
    sql: `UPDATE crawl_runs SET finished_at=?, status=?, routes_seen=?, ticks_inserted=?,
          ticks_updated=?, errors=? WHERE id=?`,
    args: [nowIso(), status, routesSeen, counters.inserted, counters.updated,
           errors.length ? JSON.stringify(errors) : null, runId],
  });
  const summary = { status, routesSeen, inserted: counters.inserted, updated: counters.updated, errors: errors.length };
  log(`[crawl] done: ${status} — ${counters.inserted} new, ${counters.updated} updated, ${errors.length} errors`);
  return summary;
}

// CLI entry: node src/crawl.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCrawl({ log: console.log }).catch((err) => {
    console.error('[crawl] fatal:', err);
    process.exitCode = 1;
  });
}
