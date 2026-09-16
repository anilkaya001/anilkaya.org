CREATE TABLE IF NOT EXISTS flows_payload (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at > 0)
);

CREATE TABLE IF NOT EXISTS flows_login_failures (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000),
  first_at INTEGER NOT NULL CHECK (first_at > 0)
);
