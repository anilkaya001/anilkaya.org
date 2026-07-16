-- Single-row cache for the landing-page market ticker. The Worker also creates
-- this table on demand (self-heal on the "no such table" failure), because
-- Workers Builds does not apply migrations to an existing D1 database.
CREATE TABLE IF NOT EXISTS market_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
