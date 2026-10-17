CREATE TABLE IF NOT EXISTS flows_quarantine (
  id          INTEGER PRIMARY KEY,
  payload_key TEXT NOT NULL,
  chash       TEXT,
  reason      TEXT NOT NULL,
  path        TEXT NOT NULL DEFAULT '',
  bytes       INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  producer    TEXT NOT NULL DEFAULT '',
  mode        TEXT NOT NULL CHECK (mode IN ('warn', 'held')),
  at          INTEGER NOT NULL CHECK (at > 0),
  braked      INTEGER NOT NULL DEFAULT 0 CHECK (braked IN (0, 1)),
  body        TEXT
);
