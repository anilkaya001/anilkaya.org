CREATE TABLE IF NOT EXISTS flows_ai_summary (
  scope        TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  llm          INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)),
  model        TEXT,
  fingerprint  TEXT NOT NULL,
  guard        TEXT,
  generated_at TEXT NOT NULL
);
