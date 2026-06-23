// Vercel Function: serves the catalog page. Reachable at "/" via the rewrite in
// vercel.json. No-framework functions use a default `fetch` export.
import { config as appConfig } from '../src/config.js';
import { getClient, migrate } from '../src/db.js';
import { getRouteRows, getRecentTicksByRoute, getLastCrawl } from '../src/metrics.js';
import { renderPage } from '../src/render.js';

export default {
  async fetch() {
    try {
      const client = getClient();
      await migrate(client); // idempotent; ensures schema exists on a fresh DB
      const [routes, ticksByRoute, lastCrawl] = await Promise.all([
        getRouteRows(client), getRecentTicksByRoute(client), getLastCrawl(client),
      ]);
      const html = renderPage({ areas: appConfig.areas, routes, ticksByRoute, lastCrawl });
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    } catch (err) {
      console.error('[page] render failed:', err);
      return new Response('Catalog temporarily unavailable. Check that the database is reachable and seeded (run the crawl).', {
        status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
