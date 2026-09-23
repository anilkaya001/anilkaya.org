CREATE TABLE IF NOT EXISTS flows_live (
  id         TEXT PRIMARY KEY CHECK (id GLOB 'live:*'),
  payload    TEXT NOT NULL,
  read_at    INTEGER NOT NULL CHECK (read_at > 0),
  session    TEXT NOT NULL,
  cadence_s  INTEGER NOT NULL CHECK (cadence_s > 0),
  source     TEXT NOT NULL CHECK (source IN ('worker', 'actions')),
  writer     TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at > 0)
);

CREATE TABLE IF NOT EXISTS flows_tape (
  ticker           TEXT PRIMARY KEY CHECK (length(ticker) BETWEEN 1 AND 10),
  payload          TEXT,
  read_at          INTEGER,
  session          TEXT,
  legs             INTEGER NOT NULL DEFAULT 0,
  refreshing_until INTEGER,
  last_served      INTEGER
);

CREATE TABLE IF NOT EXISTS flows_clock (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  day                     TEXT,
  trading                 INTEGER,
  early_close             INTEGER,
  tape_at                 INTEGER,
  tape_moved_at           INTEGER,
  live_dispatched_at      INTEGER,
  live_done_at            INTEGER,
  live_redispatched_at    INTEGER,
  nightly_day             TEXT,
  nightly_dispatched_at   INTEGER,
  nightly_redispatched_at INTEGER,
  summary_stamp           TEXT,
  updated_at              INTEGER
);

CREATE TRIGGER IF NOT EXISTS flows_archive_immutable
BEFORE UPDATE ON flows_payload
WHEN OLD.id GLOB 'board:*:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  OR OLD.id GLOB 'scores:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
BEGIN
  SELECT RAISE(ABORT, 'flows archive rows are immutable');
END;
