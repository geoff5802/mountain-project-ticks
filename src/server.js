// Tiny local web server for the catalog. Reads the SQLite DB and renders the
// table. Run with: npm run serve  (then open the printed URL)
import http from 'node:http';
import { config } from './config.js';
import { openDb } from './db.js';
import { getRouteRows, getRecentTicksByRoute, getLastCrawl } from './metrics.js';
import { renderPage } from './render.js';

const db = openDb(config.dbPath);

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (path !== '/') {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }
  try {
    const html = renderPage({
      routes: getRouteRows(db),
      ticksByRoute: getRecentTicksByRoute(db),
      lastCrawl: getLastCrawl(db),
    });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Error: ' + err);
  }
});

server.listen(config.port, () => {
  console.log(`Catalog for ${config.areaName} → http://localhost:${config.port}`);
  console.log(`(DB: ${config.dbPath}; run "npm run crawl" to refresh data)`);
});
