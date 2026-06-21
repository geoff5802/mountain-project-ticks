// SQLite storage via Node's built-in node:sqlite (no native deps).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}
