CREATE TABLE IF NOT EXISTS flows_ai_usage (
  day        TEXT PRIMARY KEY,
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0)
);
