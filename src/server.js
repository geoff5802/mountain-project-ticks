// Local dev web server for the catalog. Reads the libSQL DB and renders the
// table. Run with: npm run serve  (then open the printed URL)
import http from 'node:http';
import { config } from './config.js';
import { getClient, migrate } from './db.js';
import { getRouteRows, getRecentTicksByRoute, getLastCrawl } from './metrics.js';
import { renderPage } from './render.js';

const client = getClient();
await migrate(client);

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (path !== '/') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  try {
    const [routes, ticksByRoute, lastCrawl] = await Promise.all([
      getRouteRows(client), getRecentTicksByRoute(client), getLastCrawl(client),
    ]);
    const html = renderPage({ areas: config.areas, routes, ticksByRoute, lastCrawl });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Error: ' + err);
  }
});

// Logged once on the successful bind (reports the real port after any fallback).
server.on('listening', () => {
  const { port } = server.address();
  console.log(`Tick Catalog → http://localhost:${port}`);
  console.log(`(DB: ${config.dbUrl}; run "npm run crawl" to refresh data)`);
});

// Bind the configured port, falling back to the next few if it's taken.
function start(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${port} is in use — trying ${port + 1}…`);
      start(port + 1, attemptsLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`No free port found near ${config.port}. Is the catalog already running? Set PORT=<n> and retry.`);
      process.exit(1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
  server.listen(port);
}
start(config.port, 10);
