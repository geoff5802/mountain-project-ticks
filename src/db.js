// Storage via libSQL (@libsql/client): a local file URL in dev, a Turso
// libsql:// URL in production — same client, same SQL.
import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS routes (
  mp_id         INTEGER PRIMARY KEY,
  area_id       INTEGER NOT NULL,
  name          TEXT    NOT NULL,
  location      TEXT,
  url           TEXT    NOT NULL,
  avg_stars     REAL,
  route_type    TEXT,
  rating        TEXT,
  pitches       INTEGER,
  length_ft     INTEGER,
  area_lat      REAL,
  area_lng      REAL,
  tick_total    INTEGER,
  first_seen_at TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL,
  raw           TEXT
);
CREATE TABLE IF NOT EXISTS ticks (
  id             INTEGER PRIMARY KEY,
  route_mp_id    INTEGER NOT NULL,
  climbed_date   TEXT,
  submitted_at   TEXT,
  src_updated_at TEXT,
  style          TEXT,
  lead_style     TEXT,
  pitches        INTEGER,
  text           TEXT,
  comment        TEXT,
  user_id        INTEGER,
  user_name      TEXT,
  observed_at    TEXT    NOT NULL,
  raw            TEXT
);
CREATE INDEX IF NOT EXISTS ticks_route_climbed_idx ON ticks (route_mp_id, climbed_date DESC);
CREATE INDEX IF NOT EXISTS ticks_submitted_idx     ON ticks (submitted_at DESC);
CREATE TABLE IF NOT EXISTS crawl_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  status         TEXT NOT NULL DEFAULT 'running',
  routes_seen    INTEGER DEFAULT 0,
  ticks_inserted INTEGER DEFAULT 0,
  ticks_updated  INTEGER DEFAULT 0,
  errors         TEXT
);
`;

let _client;

export function getClient() {
  if (!_client) {
    // Ensure the parent dir exists for local file: URLs.
    const m = config.dbUrl.match(/^file:(.+)$/);
    if (m) mkdirSync(m[1].replace(/[^/]+$/, ''), { recursive: true });
    _client = createClient({ url: config.dbUrl, authToken: config.dbAuthToken });
  }
  return _client;
}

export async function migrate(client = getClient()) {
  await client.executeMultiple(SCHEMA);
  // Back-fill the tick_total column on DBs created before it existed.
  const cols = await client.execute('PRAGMA table_info(routes)');
  if (!cols.rows.some((r) => r.name === 'tick_total')) {
    await client.execute('ALTER TABLE routes ADD COLUMN tick_total INTEGER');
  }
  return client;
}
