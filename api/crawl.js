// Vercel Function: the daily crawl, invoked by Vercel Cron (see vercel.json).
// Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set;
// the same header lets you trigger it manually (e.g. the one-time backfill).
// No-framework functions use a default `fetch` export.
import { runCrawl } from '../src/crawl.js';

export default {
  async fetch(request) {
    const secret = process.env.CRON_SECRET || '';
    const auth = request.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    try {
      const summary = await runCrawl({ log: console.log });
      return Response.json({ ok: true, ...summary });
    } catch (err) {
      console.error('[crawl] failed:', err);
      return Response.json({ ok: false, error: String(err) }, { status: 500 });
    }
  },
};
