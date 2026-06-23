// Vercel Function: the password gate's login page (GET) + form handler (POST).
// Reachable at /login via the rewrite in vercel.json. Excluded from the gate.
import { authCookie } from '../src/auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  <form method="POST" action="/api/login?next=${esc(encodeURIComponent(next))}">
    <h1>Tick Catalog</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</body></html>`;
}

const htmlResponse = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

const safeNext = (raw) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

export async function GET(request) {
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  return htmlResponse(loginPage({ next }));
}

export async function POST(request) {
  const password = process.env.SITE_PASSWORD || '';
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  const form = await request.formData();
  const entered = String(form.get('password') || '');

  if (password && entered === password) {
    return new Response(null, { status: 302, headers: { Location: next, 'Set-Cookie': authCookie(password) } });
  }
  return htmlResponse(loginPage({ next, error: 'Incorrect password' }), 401);
}
