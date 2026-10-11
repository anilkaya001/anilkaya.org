CREATE TABLE IF NOT EXISTS flows_ai_outcome (
  day TEXT NOT NULL,
  surface TEXT NOT NULL,
  model TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0 CHECK (n >= 0),
  ms_sum INTEGER NOT NULL DEFAULT 0 CHECK (ms_sum >= 0),
  ms_max INTEGER NOT NULL DEFAULT 0 CHECK (ms_max >= 0),
  PRIMARY KEY (day, surface, model, outcome, reason)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS flows_ai_reject (
  surface TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 49),
  at INTEGER NOT NULL CHECK (at > 0),
  model TEXT NOT NULL,
  reason TEXT NOT NULL,
  culprit TEXT NOT NULL CHECK (length(culprit) <= 40),
  PRIMARY KEY (surface, slot)
) WITHOUT ROWID;
