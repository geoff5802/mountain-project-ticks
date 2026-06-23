// Vercel Routing Middleware: a simple password gate. Runs before every request
// except the login + cron endpoints (see matcher). The gate is ACTIVE only when
// SITE_PASSWORD is set; with it unset the site is open (handy for previews/local).
// Node.js runtime so we can use node:crypto in src/auth.js.
import { next } from '@vercel/functions';
import { isAuthed } from './src/auth.js';

export const config = {
  runtime: 'nodejs',
  // Gate everything except: the cron endpoint (own Bearer auth), the login
  // page/handler, the favicon, and Vercel internals.
  matcher: ['/((?!api/crawl|api/login|login|favicon\\.ico|_vercel).*)'],
};

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD || '';
  if (!password) return next(); // gate disabled when no password configured

  if (isAuthed(request.headers.get('cookie'), password)) return next();

  const { pathname, search } = new URL(request.url);
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname + search);
  return Response.redirect(loginUrl, 302);
}
