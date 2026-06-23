// Central config. Areas are listed here; the crawler and UI pick them up
// automatically, so adding an area is a one-line change. Everything is
// env-overridable so the same code runs locally and on Vercel.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const env = process.env;

// Mountain Project areas to catalog. Add more objects here to expand coverage.
export const AREAS = [
  { id: '105908823', name: 'Cathedral Ledge', slug: 'cathedral' },
  { id: '105909079', name: 'Whitehorse Ledge', slug: 'whitehorse' },
];

export const config = {
  areas: AREAS,

  // route-finder-export filters (shared across areas); wide-open for rock routes.
  finderParams: {
    type: 'rock',
    diffMinrock: '800',
    diffMaxrock: '12400',
    stars: '0',
    pitches: '0',
    sort1: 'area',
    sort2: 'rating',
  },

  // Politeness / robustness for the crawler.
  userAgent:
    env.MP_USER_AGENT ||
    'mountain-tick-catalog/0.2 (personal, low-volume daily catalog; contact: local user)',
  throttleMs: Number(env.THROTTLE_MS || 400),
  maxRetries: Number(env.MAX_RETRIES || 4),
  perPage: Number(env.PER_PAGE || 250),

  // Storage: libSQL/Turso. Local default is a file; on Vercel set TURSO_DATABASE_URL
  // (libsql://…) + TURSO_AUTH_TOKEN.
  dbUrl: env.TURSO_DATABASE_URL || env.DATABASE_URL || `file:${join(repoRoot, 'data', 'catalog.sqlite')}`,
  dbAuthToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || undefined,

  // Local dev server.
  port: Number(env.PORT || 4173),
  recentTicksPerRoute: Number(env.RECENT_TICKS || 25),

  // Secrets used by the hosted deployment (ignored locally).
  sitePassword: env.SITE_PASSWORD || '', // password gate (managed in env)
  cronSecret: env.CRON_SECRET || '',      // protects the /api/crawl endpoint
};

export const MP_BASE = 'https://www.mountainproject.com';
