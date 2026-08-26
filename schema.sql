-- D1 schema for the Econometrics Lab.
-- Apply with:  wrangler d1 execute iewt --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,   -- "g_<google-sub>"
  email      TEXT,
  name       TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS progress (
  user_id    TEXT NOT NULL,
  model_id   TEXT NOT NULL,      -- e.g. "ols", "iv2sls"
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

-- Monotonic reset barrier. Browser writes are accepted only when their
-- generation matches this row; reset increments it before clearing state.
CREATE TABLE IF NOT EXISTS learning_sync (
  user_id    TEXT PRIMARY KEY,
  generation INTEGER NOT NULL DEFAULT 0
             CHECK (generation BETWEEN 0 AND 9007199254740991)
);

-- Per-assessment spaced-repetition state. Item ids are generator-stable stage
-- ids from shared/review-manifest.js; the Worker computes every transition.
CREATE TABLE IF NOT EXISTS mastery (
  user_id        TEXT NOT NULL,
  item_id        TEXT NOT NULL,
  level          INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  due_day        TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
  correct        INTEGER NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 1000000),
  last_result    INTEGER CHECK (last_result IN (0, 1)),
  last_attempt_id TEXT,
  last_day       TEXT,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS mastery_due_by_user ON mastery (user_id, due_day, item_id);

-- The short attempt ledger makes PUT /api/mastery idempotent even if a client
-- retries after losing the response. It is cleared by the learning reset.
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

-- Minimal placement result used to route a learner into the right starting
-- course. Individual answers are deliberately never stored server-side.
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

-- Academy 2.0 uses immutable stage ids, conceptual-skill mastery, learner
-- preferences, and minimal project task completion. This additive schema is
-- mirrored in migrations/0002_learning_v3.sql for existing production data.
-- Academy 2.0 additive learning schema.
CREATE TABLE IF NOT EXISTS progress_v3 (
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'migration')),
  PRIMARY KEY (user_id, course_id, stage_id)
);

CREATE INDEX IF NOT EXISTS progress_v3_by_user ON progress_v3 (user_id, course_id, completed_at);

CREATE TABLE IF NOT EXISTS skill_mastery (
  user_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 5),
  due_day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 1000000),
  correct INTEGER NOT NULL DEFAULT 0 CHECK (correct BETWEEN 0 AND 1000000),
  last_result INTEGER CHECK (last_result IN (0, 1)),
  last_attempt_id TEXT,
  last_day TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS skill_mastery_due_by_user ON skill_mastery (user_id, due_day, skill_id);

-- Single-row cache for the landing-page market ticker. Refreshed by the Worker
-- cron trigger; served (public, short-TTL) from /api/markets. No user data.
CREATE TABLE IF NOT EXISTS market_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_attempts (
  user_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  hinted INTEGER NOT NULL CHECK (hinted IN (0, 1)),
  attempt_day TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS learning_preferences (
  user_id TEXT PRIMARY KEY,
  active_path_id TEXT NOT NULL DEFAULT 'complete-core',
  session_minutes INTEGER NOT NULL DEFAULT 20 CHECK (session_minutes IN (10, 20, 45)),
  weekly_goal_minutes INTEGER NOT NULL DEFAULT 120 CHECK (weekly_goal_minutes BETWEEN 30 AND 1200),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_progress (
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('guided', 'unguided')),
  done_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

-- Flows: the credential-gated options-flow board.
-- Published board payloads. The value is already-serialized JSON: the Worker
-- hands the stored string straight to the response body without parsing it, so
-- serving cost is constant in payload size. That matters because Workers Free
-- allows 10 ms of CPU per invocation.
--
-- THE KEY SPACE, which is the whole retention story:
--
--   board:long, board:short   the LIVE boards the deck reads. Overwritten
--                             every session, exactly as before.
--   board:watch               the names inside the score's dead band, ranked
--                             by how close they are to leaving it. Overwritten
--                             every session.
--   board:<side>:YYYY-MM-DD   the IMMUTABLE dated copy of that session's
--                             board, byte-identical to what the reader saw.
--   card:<TICKER>             per-name detail. Overwritten; never dated.
--   meta                      one run diagnostic. Overwritten.
--
-- Before the dated keys existed this table could not answer "what did this
-- signal say about NVDA last week", because every morning's board:long
-- destroyed the previous one — while the product's own footer asserted a
-- 51-52% hit rate with no stored series capable of measuring it.
--
-- Growth is bounded by the pipeline, not by this schema: two dated rows are
-- written per run and the run deletes the dated keys older than 126 calendar
-- days (90 trading sessions), so the dated set settles at ~180 rows. The
-- deletes are issued one named key at a time, never as a LIKE pattern, so the
-- row count of a prune is knowable before it runs. That matters because the
-- free tier's 100,000 row writes a day are SHARED WITH THE LIVE LEARNING APP
-- above; the same budget is why flows_login_failures writes only on failure.
-- The ~50 cards are deliberately not dated: +50 rows a day to archive the
-- decorative half of the product, when every quantity needed to score a past
-- signal already sits on the board row.
--
-- No secondary index. Every access is by exact primary key — the reader asks
-- for one key, and the prune names the keys it deletes rather than scanning
-- for them — so an index on a prefix or a date would be write cost buying
-- nothing.
CREATE TABLE IF NOT EXISTS flows_payload (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at > 0)
);

-- Login throttling. Rows are written ONLY on a failed attempt and deleted on a
-- successful one, so the happy path costs no D1 writes at all — the free-tier
-- budget of 100,000 rows/day is shared with the live learning app, and a write
-- per request would put user-facing sync at risk.
CREATE TABLE IF NOT EXISTS flows_login_failures (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000),
  first_at INTEGER NOT NULL CHECK (first_at > 0)
);
