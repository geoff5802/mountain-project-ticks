// Read queries for the UI: per-route recency indicators + recent ticks for expand.
// All async (libSQL client). Recency is computed on climbed_date and capped at
// today so future-dated / sentinel ticks don't inflate the windows.
import { config } from './config.js';

export async function getRouteRows(client) {
  const res = await client.execute(`
    SELECT r.mp_id, r.area_id, r.name, r.location, r.url, r.avg_stars, r.route_type, r.rating,
           r.pitches, r.length_ft, r.last_seen_at,
           (SELECT MAX(climbed_date) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date <= date('now','localtime')) AS last_climbed,
           (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date BETWEEN date('now','localtime','-1 day') AND date('now','localtime')) AS climbed_recent,
           (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date BETWEEN date('now','localtime','-6 days') AND date('now','localtime')) AS climbed_week,
           COALESCE(r.tick_total, (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id)) AS all_time
    FROM routes r
    ORDER BY r.name COLLATE NOCASE
  `);
  return res.rows;
}

export async function getRecentTicksByRoute(client) {
  const res = await client.execute({
    sql: `SELECT route_mp_id, climbed_date, style, lead_style, text, comment, user_name
          FROM (
            SELECT *, ROW_NUMBER() OVER (
              PARTITION BY route_mp_id ORDER BY climbed_date DESC, submitted_at DESC
            ) AS rn FROM ticks
          ) WHERE rn <= ?
          ORDER BY route_mp_id, climbed_date DESC, submitted_at DESC`,
    args: [config.recentTicksPerRoute],
  });
  const byRoute = {};
  for (const r of res.rows) {
    (byRoute[r.route_mp_id] ||= []).push({
      date: r.climbed_date,
      style: [r.style, r.lead_style].filter(Boolean).join(' / ') || null,
      user: r.user_name || null,
      // Only the user's free-form comment (style shown separately).
      text: r.comment || null,
    });
  }
  return byRoute;
}

export async function getLastCrawl(client) {
  const res = await client.execute(`
    SELECT started_at, finished_at, status, routes_seen, ticks_inserted, ticks_updated
    FROM crawl_runs WHERE finished_at IS NOT NULL
    ORDER BY id DESC LIMIT 1`);
  return res.rows[0] || null;
}
