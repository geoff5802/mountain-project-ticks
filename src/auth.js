// Password-gate helpers (used by middleware.js + api/login.js). The cookie holds
// an HMAC of the password, so changing SITE_PASSWORD invalidates old cookies and
// the raw password is never stored in the cookie.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'mp_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function expectedToken(password) {
  if (!password) return null;
  return createHmac('sha256', password).update('mp-tick-catalog/auth/v1').digest('hex');
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// True when the request carries a cookie matching the configured password.
export function isAuthed(cookieHeader, password) {
  const expected = expectedToken(password);
  if (!expected) return false;
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  return !!token && safeEqual(token, expected);
}

// Set-Cookie value to issue after a correct password.
export function authCookie(password) {
  return `${COOKIE_NAME}=${expectedToken(password)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}
