// Central config. Everything here is overridable by environment variable so the
// target area can be swapped without code changes (e.g. AREA_ID=... npm run crawl).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const env = process.env;

export const config = {
  // Mountain Project area to catalog. Cathedral Ledge by default.
  areaId: env.AREA_ID || '105908823',
  areaName: env.AREA_NAME || 'Cathedral Ledge',

  // route-finder-export query params (the catalog source). Mirrors the route-finder
  // UI filters; defaults are wide-open for rock routes so we get every route.
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
    'mountain-tick-catalog/0.1 (personal, low-volume daily catalog; contact: local user)',
  throttleMs: Number(env.THROTTLE_MS || 400), // min gap between requests
  maxRetries: Number(env.MAX_RETRIES || 4),
  perPage: Number(env.PER_PAGE || 250), // tick API page size

  // Local storage + server.
  dbPath: env.DB_PATH || join(repoRoot, 'data', 'catalog.sqlite'),
  port: Number(env.PORT || 4173),

  // How many most-recent ticks to show in a route's expanded detail panel.
  recentTicksPerRoute: Number(env.RECENT_TICKS || 25),
};

export const MP_BASE = 'https://www.mountainproject.com';
