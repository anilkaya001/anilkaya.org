CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT NOT NULL,
  model_id   TEXT NOT NULL,
  done_json  TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER,
  PRIMARY KEY (user_id, model_id)
);

CREATE TABLE IF NOT EXISTS stats (
  user_id    TEXT PRIMARY KEY,
  points     INTEGER DEFAULT 0,
  streak     INTEGER DEFAULT 0,
  last       TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS learning_sync (
  user_id    TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0
             CHECK (generation BETWEEN 0 AND 9007199254740991)
);

CREATE TABLE IF NOT EXISTS mastery (
  user_id        TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  level          INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  due_day        TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
  correct        INTEGER NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 1000000),
  last_result    INTEGER CHECK (last_result IN (0, 1)),
  last_attempt_id TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS mastery_due_by_user ON mastery (user_id, due_day, item_id);

CREATE TABLE IF NOT EXISTS mastery_attempts (
  user_id     TEXT NOT NULL,
  attempt_id  TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  correct     INTEGER NOT NULL CHECK (correct IN (0, 1)),
  hinted      INTEGER NOT NULL CHECK (hinted IN (0, 1)),
  attempt_day TEXT NOT NULL,
  applied     INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS placement (
  user_id           TEXT PRIMARY KEY,
  band              TEXT NOT NULL CHECK (band IN ('foundation', 'applied', 'advanced')),
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 15),
  total             INTEGER NOT NULL CHECK (total = 15),
  completed_day     TEXT NOT NULL,
  recommended_topic TEXT NOT NULL CHECK (recommended_topic IN ('ols', 'iv2sls', 'did', 'var', 'panel', 'logit', 'gmm')),
  updated_at        INTEGER NOT NULL,
  CHECK (
    (band = 'foundation' AND score BETWEEN 0 AND 6) OR
    (band = 'applied' AND score BETWEEN 7 AND 11) OR
    (band = 'advanced' AND score BETWEEN 12 AND 15)
  )
);
