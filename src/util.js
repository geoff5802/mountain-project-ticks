// Small pure helpers: date parsing, tick-text cleanup, sleeping/backoff.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff with a cap (ms), used on 429/5xx/network errors.
export const backoffMs = (attempt) => Math.min(30_000, 500 * 2 ** (attempt - 1));

export const nowIso = () => new Date().toISOString();

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// MP tick `date` looks like "Jun 19, 2026, 12:00 am" (always midnight => date-only).
// Returns "YYYY-MM-DD" or null. Parsed manually to stay timezone-independent.
export function parseClimbedDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/^\s*([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const day = String(Number(m[2])).padStart(2, '0');
  const month = String(mon).padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

const ENTITIES = {
  '&middot;': '·',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
};

// The tick `text` field is HTML-ish and may be `false`/null. Decode entities,
// normalize whitespace, and trim. Returns null when there is no usable text.
export function cleanTickText(text) {
  if (text === false || text == null) return null;
  let s = String(text);
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s || null;
}

// Best-effort extraction of just the user's free-form comment from the cleaned
// text, stripping MP's auto-generated prefix ("· 2 pitches.  Lead / Onsight. ...").
// Heuristic by design; the full cleaned text is always retained separately.
export function deriveComment(cleaned, style, leadStyle) {
  if (!cleaned) return null;
  let s = cleaned;
  s = s.replace(/^·\s*/, '');
  s = s.replace(/^\d+\s+pitch(?:es)?\.\s*/i, '');
  if (style) {
    const sty = style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lead = leadStyle ? leadStyle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;
    const re = lead
      ? new RegExp(`^${sty}\\s*/\\s*${lead}\\.\\s*`, 'i')
      : new RegExp(`^${sty}\\.\\s*`, 'i');
    s = s.replace(re, '');
  }
  s = s.trim();
  return s || null;
}

// node:sqlite rejects `undefined` and JS booleans; coerce to null/int.
export const orNull = (v) => (v === undefined || v === false ? null : v);
export const intOrNull = (v) => {
  if (v === undefined || v === null || v === '' || v === false) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
export const floatOrNull = (v) => {
  if (v === undefined || v === null || v === '' || v === false) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
