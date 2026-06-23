// The web server — used for BOTH local dev (npm run serve) and the Vercel
// deployment (Vercel detects this as the Node server entrypoint). Handles every
// route: the catalog page, the login page/gate, and the cron crawl endpoint.
// The password gate is active only when SITE_PASSWORD is set (so local dev is open).
import http from 'node:http';
import { config } from './config.js';
import { getClient, migrate } from './db.js';
import { getRouteRows, getRecentTicksByRoute, getLastCrawl } from './metrics.js';
import { renderPage } from './render.js';
import { isAuthed, authCookie } from './auth.js';
import { runCrawl } from './crawl.js';

const client = getClient();
await migrate(client);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sendHtml = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
const sendText = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(body);
const sendJson = (res, status, obj) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
const redirect = (res, location, headers = {}) =>
  res.writeHead(302, { Location: location, ...headers }).end();

const safeNext = (raw) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function loginPage({ next = '/', error = null } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in — Tick Catalog</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  form { display: grid; gap: .75rem; width: min(20rem, 90vw); padding: 1.5rem; border: 1px solid #8884; border-radius: 12px; }
  h1 { font-size: 1.15rem; margin: 0; }
  input { font: inherit; padding: .55rem .65rem; border: 1px solid #999; border-radius: 8px; }
  button { font: inherit; font-weight: 600; padding: .55rem; border: 0; border-radius: 8px; background: #c0392b; color: #fff; cursor: pointer; }
  .err { color: #c0392b; font-size: .85rem; margin: 0; }
</style></head>
<body>
  <form method="POST" action="/login?next=${esc(encodeURIComponent(next))}">
    <h1>Tick Catalog</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const password = process.env.SITE_PASSWORD || '';

  // Cron crawl endpoint — its own Bearer auth, never the password gate.
  if (path === '/api/crawl') {
    const secret = process.env.CRON_SECRET || '';
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) return sendText(res, 401, 'Unauthorized');
    try {
      const summary = await runCrawl({ log: console.log });
      return sendJson(res, 200, { ok: true, ...summary });
    } catch (err) {
      console.error('[crawl] failed:', err);
      return sendJson(res, 500, { ok: false, error: String(err) });
    }
  }

  // Login page + form handler (reachable without auth).
  if (path === '/login') {
    const next = safeNext(url.searchParams.get('next'));
    if (req.method === 'POST') {
      const entered = new URLSearchParams(await readBody(req)).get('password') || '';
      if (password && entered === password) return redirect(res, next, { 'Set-Cookie': authCookie(password) });
      return sendHtml(res, 401, loginPage({ next, error: 'Incorrect password' }));
    }
    return sendHtml(res, 200, loginPage({ next }));
  }

  if (path === '/favicon.ico') return res.writeHead(204).end();

  // Password gate for everything else.
  if (password && !isAuthed(req.headers.cookie, password)) {
    return redirect(res, `/login?next=${encodeURIComponent(path)}`);
  }

  // Catalog page.
  if (path === '/') {
    const [routes, ticksByRoute, lastCrawl] = await Promise.all([
      getRouteRows(client), getRecentTicksByRoute(client), getLastCrawl(client),
    ]);
    return sendHtml(res, 200, renderPage({ areas: config.areas, routes, ticksByRoute, lastCrawl }));
  }

  return sendText(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[server] error:', err);
    if (!res.headersSent) sendText(res, 500, 'Internal error');
  });
});

server.on('listening', () => {
  const { port } = server.address();
  console.log(`Tick Catalog → http://localhost:${port}`);
});

// Vercel provides PORT; locally fall back to config.port (with retry if busy).
function start(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${port} is in use — trying ${port + 1}…`);
      start(port + 1, attemptsLeft - 1);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
  server.listen(port);
}
start(Number(process.env.PORT) || config.port, 10);
