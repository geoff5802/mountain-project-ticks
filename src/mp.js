// Mountain Project HTTP client. Two robots-permitted, cookieless endpoints:
//   - /route-finder-export   (CSV of all routes in an area)
//   - /api/v2/routes/{id}/ticks (paginated JSON tick data)
// Adds a global throttle, retries with backoff, and Retry-After handling.
import { config, MP_BASE } from './config.js';
import { sleep, backoffMs } from './util.js';

let lastRequestAt = 0;

async function throttle() {
  const wait = Math.max(0, lastRequestAt + config.throttleMs - Date.now());
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function request(url, { json = false } = {}) {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': config.userAgent,
          Accept: json ? 'application/json' : 'text/csv,text/plain,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (err) {
      if (attempt > config.maxRetries) throw err;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt > config.maxRetries) {
        throw new Error(`HTTP ${res.status} after ${attempt} attempts: ${url}`);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return json ? res.json() : res.text();
  }
}

function buildQuery(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export async function fetchCatalogCsv(areaId) {
  const params = { selectedIds: areaId, ...config.finderParams };
  const url = `${MP_BASE}/route-finder-export?${buildQuery(params)}`;
  return request(url, { json: false });
}

export async function fetchTicksPage(routeId, page = 1) {
  const url = `${MP_BASE}/api/v2/routes/${routeId}/ticks?per_page=${config.perPage}&page=${page}`;
  return request(url, { json: true });
}
