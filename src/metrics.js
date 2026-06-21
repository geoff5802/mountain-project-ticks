// Read queries for the UI: per-route recency indicators + recent ticks for expand.
import { config } from './config.js';

// "Recent" = climbed today or yesterday (date-only source, deliberately loose).
// "Week"   = trailing 7 calendar days. Both computed on climbed_date.
export function getRouteRows(db) {
  // Windows are capped at today: crowd-sourced ticks can carry future dates
  // (data-entry slips) or a 1969 sentinel for dateless ticks; neither should
  // count toward "recently climbed".
  return db.prepare(`
    SELECT r.mp_id, r.name, r.location, r.url, r.avg_stars, r.route_type, r.rating,
           r.pitches, r.length_ft, r.last_seen_at,
           (SELECT MAX(climbed_date) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date <= date('now','localtime')) AS last_climbed,
           (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date BETWEEN date('now','localtime','-1 day') AND date('now','localtime')) AS climbed_recent,
           (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id
              AND t.climbed_date BETWEEN date('now','localtime','-6 days') AND date('now','localtime')) AS climbed_week,
           (SELECT COUNT(*) FROM ticks t WHERE t.route_mp_id = r.mp_id) AS total_ticks
    FROM routes r
    ORDER BY r.name COLLATE NOCASE
  `).all();
}

// Most-recent N ticks per route (window function), for the expandable detail panel.
export function getRecentTicksByRoute(db) {
  const rows = db.prepare(`
    SELECT route_mp_id, climbed_date, style, lead_style, text, comment, user_name, user_id
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY route_mp_id ORDER BY climbed_date DESC, submitted_at DESC
      ) AS rn
      FROM ticks
    ) WHERE rn <= ?
    ORDER BY route_mp_id, climbed_date DESC, submitted_at DESC
  `).all(config.recentTicksPerRoute);

  const byRoute = {};
  for (const r of rows) {
    (byRoute[r.route_mp_id] ||= []).push({
      date: r.climbed_date,
      style: [r.style, r.lead_style].filter(Boolean).join(' / ') || null,
      user: r.user_name || null,
      userId: r.user_id || null,
      // Only the user's free-form comment (style is shown separately); avoids the
      // redundant auto-generated "· Lead." line for comment-less ticks.
      text: r.comment || null,
    });
  }
  return byRoute;
}

export function getLastCrawl(db) {
  return db.prepare(`
    SELECT started_at, finished_at, status, routes_seen, ticks_inserted, ticks_updated
    FROM crawl_runs WHERE finished_at IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get();
}
