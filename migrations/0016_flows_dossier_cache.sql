CREATE TABLE IF NOT EXISTS flows_dossier_cache (
  ticker     TEXT NOT NULL CHECK (length(ticker) BETWEEN 1 AND 10),
  kind       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL CHECK (fetched_at > 0),
  payload    TEXT NOT NULL CHECK (length(payload) <= 8192),
  PRIMARY KEY (ticker, kind)
) WITHOUT ROWID;
