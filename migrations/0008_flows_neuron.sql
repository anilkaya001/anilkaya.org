CREATE TABLE IF NOT EXISTS flows_neuron (
  scope        TEXT PRIMARY KEY,
  version      INTEGER NOT NULL,
  fingerprint  TEXT NOT NULL,
  summary      TEXT NOT NULL,
  ideas        TEXT NOT NULL,
  llm          INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)),
  model        TEXT,
  guard        TEXT,
  generated_at TEXT NOT NULL
);
