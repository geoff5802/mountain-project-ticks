// Daily ingest job: (1) sync the route catalog from the CSV export, then
// (2) fetch the newest page of ticks per route and upsert (dedup on MP tick id).
// Run with: npm run crawl
import { config } from './config.js';
import { openDb } from './db.js';
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

async function syncCatalog(db) {
  const csv = await fetchCatalogCsv();
  const rows = parseCsvToObjects(csv);
  const now = nowIso();

  const upsert = db.prepare(`
    INSERT INTO routes (mp_id, area_id, name, location, url, avg_stars, route_type,
                        rating, pitches, length_ft, area_lat, area_lng, first_seen_at, last_seen_at, raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(mp_id) DO UPDATE SET
      area_id=excluded.area_id, name=excluded.name, location=excluded.location, url=excluded.url,
      avg_stars=excluded.avg_stars, route_type=excluded.route_type, rating=excluded.rating,
      pitches=excluded.pitches, length_ft=excluded.length_ft, area_lat=excluded.area_lat,
      area_lng=excluded.area_lng, last_seen_at=excluded.last_seen_at, raw=excluded.raw
  `);

  const routes = [];
  for (const r of rows) {
    const mpId = routeIdFromUrl(r.URL);
    if (!mpId) continue;
    upsert.run(
      mpId, Number(config.areaId), r.Route || '(unnamed)', orNull(r.Location), r.URL,
      floatOrNull(r['Avg Stars']), orNull(r['Route Type']), orNull(r.Rating),
      intOrNull(r.Pitches), intOrNull(r.Length), floatOrNull(r['Area Latitude']),
      floatOrNull(r['Area Longitude']), now, now, JSON.stringify(r),
    );
    routes.push({ mpId, name: r.Route });
  }
  return routes;
}

async function ingestTicksForRoute(db, route, counters) {
  const existing = db.prepare('SELECT src_updated_at FROM ticks WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO ticks (id, route_mp_id, climbed_date, submitted_at, src_updated_at,
                       style, lead_style, pitches, text, comment, user_id, user_name, observed_at, raw)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const update = db.prepare(`
    UPDATE ticks SET climbed_date=?, submitted_at=?, src_updated_at=?, style=?, lead_style=?,
                     pitches=?, text=?, comment=?, user_id=?, user_name=?, raw=? WHERE id=?
  `);

  // v1: only page 1 (newest 250) — covers far more than the windows we report.
  const payload = await fetchTicksPage(route.mpId, 1);
  const ticks = Array.isArray(payload?.data) ? payload.data : [];
  const now = nowIso();

  for (const t of ticks) {
    const style = orNull(t.style) || null;
    const leadStyle = orNull(t.leadStyle) || null;
    const text = cleanTickText(t.text);
    const comment = deriveComment(text, style, leadStyle);
    const user = t.user && typeof t.user === 'object' ? t.user : null;
    const fields = [
      parseClimbedDate(t.date), orNull(t.createdAt), orNull(t.updatedAt),
      style, leadStyle, intOrNull(t.pitches), text, comment,
      user ? intOrNull(user.id) : null, user ? orNull(user.name) : null,
    ];

    const row = existing.get(t.id);
    if (!row) {
      insert.run(intOrNull(t.id), route.mpId, ...fields, now, JSON.stringify(t));
      counters.inserted++;
    } else if (row.src_updated_at !== orNull(t.updatedAt)) {
      update.run(...fields, JSON.stringify(t), intOrNull(t.id));
      counters.updated++;
    }
  }
  return { total: payload?.total ?? null, fetched: ticks.length };
}

async function main() {
  const db = openDb(config.dbPath);
  const run = db.prepare('INSERT INTO crawl_runs (started_at) VALUES (?)').run(nowIso());
  const runId = run.lastInsertRowid;
  const counters = { inserted: 0, updated: 0 };
  const errors = [];

  console.log(`[crawl] area ${config.areaId} (${config.areaName}) -> ${config.dbPath}`);

  let routes = [];
  try {
    routes = await syncCatalog(db);
    console.log(`[crawl] catalog: ${routes.length} routes`);
  } catch (err) {
    db.prepare('UPDATE crawl_runs SET finished_at=?, status=?, errors=? WHERE id=?')
      .run(nowIso(), 'failed', JSON.stringify([{ stage: 'catalog', error: String(err) }]), runId);
    console.error('[crawl] catalog fetch failed:', err);
    process.exitCode = 1;
    return;
  }

  const setTotal = db.prepare('UPDATE routes SET tick_total = ? WHERE mp_id = ?');
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    try {
      const { total } = await ingestTicksForRoute(db, route, counters);
      // The API's `total` is the authoritative all-time count; persist it so the
      // UI's "All-time" column isn't limited to the page-1 sample we store.
      if (total != null) setTotal.run(total, route.mpId);
      if ((i + 1) % 20 === 0 || i === routes.length - 1) {
        console.log(`[crawl] ticks ${i + 1}/${routes.length} (last: ${route.name}, all-time ${total ?? '?'})`);
      }
    } catch (err) {
      errors.push({ route: route.mpId, name: route.name, error: String(err) });
      console.warn(`[crawl] route ${route.mpId} (${route.name}) failed: ${err}`);
    }
  }

  const status = errors.length === 0 ? 'ok' : 'partial';
  db.prepare(`UPDATE crawl_runs SET finished_at=?, status=?, routes_seen=?, ticks_inserted=?,
              ticks_updated=?, errors=? WHERE id=?`)
    .run(nowIso(), status, routes.length, counters.inserted, counters.updated,
         errors.length ? JSON.stringify(errors) : null, runId);

  console.log(`[crawl] done: ${status} — ${counters.inserted} new ticks, ${counters.updated} updated, ${errors.length} route errors`);
  db.close();
}

main().catch((err) => {
  console.error('[crawl] fatal:', err);
  process.exitCode = 1;
});
