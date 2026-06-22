// Renders the full self-contained HTML page (data embedded as JSON; sorting,
// filtering and row-expansion are done client-side in vanilla JS).
import { config, MP_BASE } from './config.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Escape `<` so a literal "</script>" inside any tick text can't close the
// embedded JSON <script> block early.
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

export function renderPage({ routes, ticksByRoute, lastCrawl }) {
  const updated = lastCrawl?.finished_at
    ? `Last updated ${esc(lastCrawl.finished_at)} — ${esc(lastCrawl.status)}, ` +
      `${lastCrawl.ticks_inserted ?? 0} new ticks across ${lastCrawl.routes_seen ?? 0} routes`
    : 'No crawl has completed yet — run <code>npm run crawl</code>.';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.areaName)} — Tick Catalog</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 1rem 1.25rem 4rem; }
  h1 { font-size: 1.3rem; margin: 0 0 .25rem; }
  .meta { color: #666; margin: 0 0 1rem; font-size: .85rem; }
  .controls { display: flex; gap: .75rem; flex-wrap: wrap; align-items: center; margin-bottom: .75rem; }
  input, select { font: inherit; padding: .35rem .5rem; border: 1px solid #bbb; border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; }
  thead th { position: sticky; top: 0; background: Canvas; border-bottom: 2px solid #ccc; text-align: left;
             padding: .45rem .5rem; cursor: pointer; user-select: none; white-space: nowrap; font-size: .8rem; }
  thead th .arr { color: #999; font-size: .7rem; }
  tbody td { padding: .4rem .5rem; border-bottom: 1px solid #eee3; vertical-align: top; }
  tbody tr.route { cursor: pointer; }
  tbody tr.route:hover { background: #80808018; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .hot { font-weight: 700; color: #c0392b; }
  .warm { font-weight: 600; }
  .muted { color: #999; }
  a { color: inherit; }
  .detail td { background: #80808012; padding: .5rem .75rem .75rem 1.75rem; }
  .tick { padding: .3rem 0; border-bottom: 1px dashed #8884; }
  .tick:last-child { border-bottom: 0; }
  .tick .d { font-variant-numeric: tabular-nums; color: #555; }
  .tick .s { color: #777; }
  .tick .who { font-weight: 600; }
  .tick .t { display: block; margin-top: .15rem; white-space: pre-wrap; }
  .count { color: #666; font-size: .85rem; margin-left: .5rem; }
  footer { margin-top: 1.5rem; color: #999; font-size: .78rem; }
</style>
</head>
<body>
  <h1>${esc(config.areaName)} — Tick Catalog</h1>
  <p class="meta">${updated}. Data from <a href="${MP_BASE}/area/${esc(config.areaId)}" target="_blank" rel="noreferrer">Mountain Project</a>. Click a row for recent ticks.</p>
  <div class="controls">
    <input id="filter" type="search" placeholder="Filter by route or area…" autocomplete="off">
    <select id="type"><option value="">All types</option></select>
    <span class="count" id="count"></span>
  </div>
  <table id="tbl">
    <thead><tr id="head"></tr></thead>
    <tbody id="body"></tbody>
  </table>
  <footer>Recency is an indicator from crowd-sourced ticks; climbed dates are user-entered and can be backdated, so counts may grow as late entries arrive.</footer>

<script id="routes" type="application/json">${jsonForScript(routes)}</script>
<script id="ticks" type="application/json">${jsonForScript(ticksByRoute)}</script>
<script>
const ROUTES = JSON.parse(document.getElementById('routes').textContent);
const TICKS  = JSON.parse(document.getElementById('ticks').textContent);
const MP = ${JSON.stringify(MP_BASE)};

const COLS = [
  { key: 'name',          label: 'Route',     type: 'text' },
  { key: 'location',      label: 'Area',      type: 'text' },
  { key: 'rating',        label: 'Grade',     type: 'text' },
  { key: 'route_type',    label: 'Type',      type: 'text' },
  { key: 'pitches',       label: 'P',         type: 'num'  },
  { key: 'length_ft',     label: 'Ft',        type: 'num'  },
  { key: 'avg_stars',     label: 'Stars',     type: 'num'  },
  { key: 'last_climbed',  label: 'Last climbed', type: 'text' },
  { key: 'climbed_recent',label: 'Past day~', type: 'num'  },
  { key: 'climbed_week',  label: 'This week', type: 'num'  },
  { key: 'all_time',      label: 'All-time',  type: 'num'  },
];

let sortKey = 'climbed_week', sortDir = -1;
const expanded = new Set();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortArea = (loc) => (loc || '').split(' > ')[0] || '';

function cmp(a, b, key, type) {
  let x = a[key], y = b[key];
  if (type === 'num') { x = x ?? -1; y = y ?? -1; return (x - y) * sortDir; }
  x = (x ?? '').toString().toLowerCase(); y = (y ?? '').toString().toLowerCase();
  return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
}

function buildHead() {
  document.getElementById('head').innerHTML = COLS.map(c => {
    const arr = c.key === sortKey ? (sortDir < 0 ? ' ▼' : ' ▲') : '';
    const cls = c.type === 'num' ? ' style="text-align:right"' : '';
    return '<th data-key="' + c.key + '"' + cls + '>' + esc(c.label) + '<span class="arr">' + arr + '</span></th>';
  }).join('');
  document.querySelectorAll('#head th').forEach(th => th.onclick = () => {
    const k = th.dataset.key;
    if (k === sortKey) sortDir *= -1; else { sortKey = k; sortDir = COLS.find(c => c.key === k).type === 'num' ? -1 : 1; }
    render();
  });
}

function tickHtml(routeId) {
  const list = TICKS[routeId] || [];
  if (!list.length) return '<em class="muted">No ticks stored yet.</em>';
  return list.map(t =>
    '<div class="tick"><span class="d">' + esc(t.date || '—') + '</span> ' +
    (t.style ? '<span class="s">' + esc(t.style) + '</span> ' : '') +
    (t.user ? '<span class="who">' + esc(t.user) + '</span>' : '<span class="muted">anonymous</span>') +
    (t.text ? '<span class="t">' + esc(t.text) + '</span>' : '') + '</div>'
  ).join('');
}

function cell(r, c) {
  if (c.key === 'name') return '<a href="' + esc(MP + '/route/stats/' + r.mp_id) + '" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">' + esc(r.name) + '</a>';
  if (c.key === 'location') return esc(shortArea(r.location));
  if (c.key === 'avg_stars') return r.avg_stars == null ? '' : Number(r.avg_stars).toFixed(1);
  if (c.key === 'last_climbed') return r.last_climbed ? esc(r.last_climbed) : '<span class="muted">—</span>';
  if (c.key === 'climbed_recent' || c.key === 'climbed_week') {
    const v = r[c.key] || 0;
    const cls = v > 0 ? (c.key === 'climbed_recent' ? 'hot' : 'warm') : 'muted';
    return '<span class="' + cls + '">' + v + '</span>';
  }
  const v = r[c.key];
  return v == null || v === '' ? '<span class="muted">—</span>' : esc(v);
}

function render() {
  buildHead();
  const q = document.getElementById('filter').value.trim().toLowerCase();
  const type = document.getElementById('type').value;
  let rows = ROUTES.filter(r =>
    (!type || r.route_type === type) &&
    (!q || (r.name || '').toLowerCase().includes(q) || (r.location || '').toLowerCase().includes(q)));
  const col = COLS.find(c => c.key === sortKey);
  rows.sort((a, b) => cmp(a, b, sortKey, col.type) || (a.name || '').localeCompare(b.name || ''));

  const body = document.getElementById('body');
  let html = '';
  for (const r of rows) {
    html += '<tr class="route" data-id="' + r.mp_id + '">' +
      COLS.map(c => '<td' + (c.type === 'num' ? ' class="num"' : '') + '>' + cell(r, c) + '</td>').join('') + '</tr>';
    if (expanded.has(r.mp_id)) {
      html += '<tr class="detail"><td colspan="' + COLS.length + '">' + tickHtml(r.mp_id) + '</td></tr>';
    }
  }
  body.innerHTML = html;
  body.querySelectorAll('tr.route').forEach(tr => tr.onclick = () => {
    const id = Number(tr.dataset.id);
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    render();
  });
  document.getElementById('count').textContent = rows.length + ' of ' + ROUTES.length + ' routes';
}

(function init() {
  const types = [...new Set(ROUTES.map(r => r.route_type).filter(Boolean))].sort();
  document.getElementById('type').insertAdjacentHTML('beforeend',
    types.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join(''));
  document.getElementById('filter').addEventListener('input', render);
  document.getElementById('type').addEventListener('change', render);
  render();
})();
</script>
</body>
</html>`;
}
