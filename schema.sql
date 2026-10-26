CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT,
  name         TEXT,
  created_at   INTEGER,
  signed_in_at INTEGER
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
  last_day       TEXT,
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

CREATE INDEX IF NOT EXISTS mastery_attempts_by_received ON mastery_attempts (received_at);

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

CREATE INDEX IF NOT EXISTS skill_attempts_by_received ON skill_attempts (received_at);

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

CREATE TABLE IF NOT EXISTS flows_payload (
  id         TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  chash      TEXT,
  session    TEXT,
  quality    INTEGER NOT NULL DEFAULT 0,
  epoch      INTEGER NOT NULL DEFAULT 0,
  asof       INTEGER NOT NULL DEFAULT 0,
  rev        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS flows_login_failures (
  username TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 1000000),
  first_at INTEGER NOT NULL CHECK (first_at > 0)
);

CREATE INDEX IF NOT EXISTS flows_login_failures_by_first ON flows_login_failures (first_at);

CREATE TABLE IF NOT EXISTS flows_ai_usage (
  day        TEXT PRIMARY KEY,
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0)
);

CREATE TABLE IF NOT EXISTS flows_ai_usage_model (
  day        TEXT NOT NULL,
  model      TEXT NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  PRIMARY KEY (day, model)
);

CREATE TABLE IF NOT EXISTS flows_ai_summary (
  scope        TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  llm          INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)),
  model        TEXT,
  fingerprint  TEXT NOT NULL,
  guard        TEXT,
  generated_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS flows_live (
  id         TEXT PRIMARY KEY CHECK (id GLOB 'live:*'),
  payload    TEXT NOT NULL,
  read_at    INTEGER NOT NULL CHECK (read_at > 0),
  session    TEXT NOT NULL,
  cadence_s  INTEGER NOT NULL CHECK (cadence_s > 0),
  source     TEXT NOT NULL CHECK (source IN ('worker', 'actions')),
  writer     TEXT NOT NULL,
  updated_at INTEGER NOT NULL CHECK (updated_at > 0)
);

CREATE TABLE IF NOT EXISTS flows_tape (
  ticker           TEXT PRIMARY KEY CHECK (length(ticker) BETWEEN 1 AND 10),
  payload          TEXT,
  read_at          INTEGER,
  session          TEXT,
  legs             INTEGER NOT NULL DEFAULT 0,
  refreshing_until INTEGER,
  last_served      INTEGER
);

CREATE TABLE IF NOT EXISTS flows_clock (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  day                     TEXT,
  trading                 INTEGER,
  early_close             INTEGER,
  tape_at                 INTEGER,
  tape_moved_at           INTEGER,
  live_dispatched_at      INTEGER,
  live_done_at            INTEGER,
  live_redispatched_at    INTEGER,
  nightly_day             TEXT,
  nightly_dispatched_at   INTEGER,
  nightly_redispatched_at INTEGER,
  summary_stamp           TEXT,
  updated_at              INTEGER,
  tier1_at                INTEGER,
  tier1_ok_at             INTEGER,
  tier1_why               TEXT,
  closed_probe_at         INTEGER,
  closed_days             TEXT,
  dispatch_why            TEXT,
  summary_at              INTEGER,
  uw_daily                INTEGER,
  uw_daily_at             INTEGER
);

CREATE TABLE IF NOT EXISTS flows_ledger (
  day           TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ticks         INTEGER NOT NULL DEFAULT 0,
  t1_last_at    INTEGER,
  t1_gap_ms     INTEGER NOT NULL DEFAULT 0,
  t1_gap_end    INTEGER,
  t1_ok         INTEGER NOT NULL DEFAULT 0,
  t1_fail       INTEGER NOT NULL DEFAULT 0,
  t1_ok_at      INTEGER,
  t1_ok_gap_ms  INTEGER NOT NULL DEFAULT 0,
  t1_ok_gap_end INTEGER,
  focus_ok      INTEGER NOT NULL DEFAULT 0,
  focus_partial INTEGER NOT NULL DEFAULT 0,
  focus_fail    INTEGER NOT NULL DEFAULT 0,
  focus_ok_at   INTEGER,
  focus_gap_ms  INTEGER NOT NULL DEFAULT 0,
  focus_gap_end INTEGER,
  t2_passes     INTEGER NOT NULL DEFAULT 0,
  t2_first_at   INTEGER,
  t2_last_at    INTEGER,
  t2_gap_ms     INTEGER NOT NULL DEFAULT 0,
  t2_gap_end    INTEGER,
  t2_calls      INTEGER NOT NULL DEFAULT 0,
  t2_failed     INTEGER NOT NULL DEFAULT 0,
  stale_ticks   INTEGER NOT NULL DEFAULT 0,
  stale_over_s  INTEGER,
  stale_key     TEXT,
  nightly_at    INTEGER,
  nightly_runs  INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  t1_calls      INTEGER NOT NULL DEFAULT 0,
  focus_calls   INTEGER NOT NULL DEFAULT 0,
  uw_daily_max  INTEGER,
  uw_daily_at   INTEGER
);

CREATE TRIGGER IF NOT EXISTS flows_archive_immutable
BEFORE UPDATE ON flows_payload
WHEN OLD.id GLOB 'board:*:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  OR OLD.id GLOB 'scores:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
BEGIN
  SELECT RAISE(ABORT, 'flows archive rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS flows_permanent_no_update
BEFORE UPDATE ON flows_payload
WHEN OLD.id GLOB 'ideas:[0-9]*'
  OR OLD.id GLOB 'ideas-out:[0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'flows permanent archive rows cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS flows_permanent_no_delete
BEFORE DELETE ON flows_payload
WHEN OLD.id GLOB 'ideas:[0-9]*'
  OR OLD.id GLOB 'ideas-out:[0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'flows permanent archive rows cannot be removed');
END;

CREATE TABLE IF NOT EXISTS flows_dossier_cache (
  ticker     TEXT NOT NULL CHECK (length(ticker) BETWEEN 1 AND 10),
  kind       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL CHECK (fetched_at > 0),
  payload    TEXT NOT NULL CHECK (length(payload) <= 8192),
  PRIMARY KEY (ticker, kind)
) WITHOUT ROWID;

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

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_i
AFTER INSERT ON flows_payload
WHEN NEW.chash IS NOT NULL
  AND NEW.id <> 'manifest'
  AND NEW.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  INSERT INTO flows_payload (id, payload, updated_at)
  VALUES ('manifest', json_object(NEW.id, json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch)), NEW.updated_at)
  ON CONFLICT(id) DO UPDATE SET
    payload = json_set(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || NEW.id || '"',
      json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch)),
    updated_at = NEW.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_u
AFTER UPDATE ON flows_payload
WHEN (NEW.chash IS NOT NULL OR OLD.chash IS NOT NULL)
  AND NEW.id <> 'manifest'
  AND NEW.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  INSERT INTO flows_payload (id, payload, updated_at)
  VALUES ('manifest', json_object(NEW.id, CASE WHEN NEW.chash IS NULL THEN json('null') ELSE json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch) END), NEW.updated_at)
  ON CONFLICT(id) DO UPDATE SET
    payload = json_set(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || NEW.id || '"',
      CASE WHEN NEW.chash IS NULL THEN json('null') ELSE json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch) END),
    updated_at = NEW.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_d
AFTER DELETE ON flows_payload
WHEN OLD.id <> 'manifest'
  AND OLD.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  UPDATE flows_payload
  SET payload = json_remove(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || OLD.id || '"')
  WHERE id = 'manifest';
END;

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

CREATE TABLE IF NOT EXISTS ff_wire (
  id TEXT PRIMARY KEY NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('house', 'member')),
  member_id TEXT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN ('armed', 'paused', 'retired')),
  status_at INTEGER NOT NULL CHECK (status_at > 0),
  current_version INTEGER NOT NULL CHECK (current_version >= 1),
  origin TEXT CHECK (origin IS NULL OR length(origin) BETWEEN 3 AND 24),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  CHECK ((layer = 'house' AND member_id IS NULL AND (id GLOB 'h-t[0-9][0-9]' OR id GLOB 'h-t[0-9][0-9][a-z]')) OR (layer = 'member' AND member_id IS NOT NULL AND length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*' AND length(id) = 18 AND id GLOB 'w-[a-z2-7]*' AND id NOT GLOB 'w-*[^a-z2-7]*'))
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ff_wire_by_member ON ff_wire (member_id, status);
CREATE TABLE IF NOT EXISTS ff_wire_version (
  wire_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  template TEXT NOT NULL CHECK (template IN ('T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'custom')),
  cadence TEXT NOT NULL CHECK (cadence IN ('nightly', 'live', 'rail')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('names', 'sector', 'universe', 'watchlist')),
  control TEXT NOT NULL CHECK (control IN ('fact', 'bh', 'sr')),
  exp_week REAL CHECK (exp_week IS NULL OR exp_week >= 0),
  clause_hash TEXT NOT NULL CHECK (length(clause_hash) = 10 AND clause_hash NOT GLOB '*[^0-9a-f]*'),
  ast_json TEXT NOT NULL CHECK (length(ast_json) <= 4096),
  ast_hash TEXT NOT NULL CHECK (length(ast_hash) = 64 AND ast_hash NOT GLOB '*[^0-9a-f]*'),
  sentence TEXT NOT NULL CHECK (length(sentence) BETWEEN 1 AND 280),
  registry_version INTEGER NOT NULL CHECK (registry_version >= 1),
  effective_session TEXT NOT NULL CHECK (effective_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  PRIMARY KEY (wire_id, version)
) WITHOUT ROWID;
CREATE TRIGGER IF NOT EXISTS ff_wire_version_frozen BEFORE UPDATE ON ff_wire_version BEGIN SELECT RAISE(ABORT, 'ff_wire_version is frozen'); END;
CREATE TRIGGER IF NOT EXISTS ff_wire_version_kept BEFORE DELETE ON ff_wire_version BEGIN SELECT RAISE(ABORT, 'ff_wire_version is kept'); END;
CREATE TABLE IF NOT EXISTS ff_wire_symbol (
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  symbol TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 10 AND symbol NOT GLOB '*[^A-Z0-9.-]*'),
  wire_id TEXT NOT NULL,
  PRIMARY KEY (member_id, symbol, wire_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_state (
  wire_id TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 64),
  version INTEGER NOT NULL CHECK (version >= 1),
  phase TEXT NOT NULL CHECK (phase IN ('pending', 'firing', 'cooling')),
  cnt INTEGER NOT NULL DEFAULT 0 CHECK (cnt >= 0),
  last_session TEXT NOT NULL CHECK (last_session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  cool_until TEXT CHECK (cool_until IS NULL OR cool_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  detector_json TEXT CHECK (detector_json IS NULL OR length(detector_json) <= 512),
  PRIMARY KEY (wire_id, subject),
  CHECK (phase <> 'cooling' OR cool_until IS NOT NULL)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_hit (
  stream TEXT NOT NULL CHECK (stream = 'house' OR (length(stream) BETWEEN 3 AND 32 AND stream NOT GLOB '*[^a-z0-9_.-]*')),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  hit_id TEXT NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'),
  wire_id TEXT NOT NULL,
  wire_version INTEGER NOT NULL CHECK (wire_version >= 1),
  member_id TEXT,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 64),
  symbol TEXT CHECK (symbol IS NULL OR (length(symbol) BETWEEN 1 AND 10 AND symbol NOT GLOB '*[^A-Z0-9.-]*')),
  sector TEXT CHECK (sector IS NULL OR length(sector) BETWEEN 1 AND 40),
  dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 160),
  session TEXT NOT NULL CHECK (session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  session_label TEXT NOT NULL CHECK (length(session_label) BETWEEN 1 AND 24),
  fired_at INTEGER NOT NULL CHECK (fired_at > 0),
  data_as_of INTEGER NOT NULL CHECK (data_as_of > 0),
  evaluator TEXT NOT NULL CHECK (evaluator IN ('nightly', 'live', 'rail')),
  evaluator_version TEXT NOT NULL CHECK (length(evaluator_version) BETWEEN 1 AND 40),
  evidence_json TEXT NOT NULL CHECK (length(evidence_json) <= 4096),
  state TEXT NOT NULL CHECK (state IN ('delivered', 'held')),
  withdrawn_at INTEGER CHECK (withdrawn_at IS NULL OR withdrawn_at > 0),
  withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 1 AND 120),
  PRIMARY KEY (stream, seq),
  UNIQUE (wire_id, dedupe_key),
  UNIQUE (hit_id),
  CHECK ((member_id IS NULL AND stream = 'house') OR (member_id IS NOT NULL AND stream = member_id)),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ff_hit_by_wire ON ff_hit (wire_id, seq);
CREATE INDEX IF NOT EXISTS ff_hit_by_symbol ON ff_hit (stream, symbol, seq);
CREATE TRIGGER IF NOT EXISTS ff_hit_frozen BEFORE UPDATE OF stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state ON ff_hit BEGIN SELECT RAISE(ABORT, 'ff_hit is frozen'); END;
CREATE TRIGGER IF NOT EXISTS ff_hit_kept BEFORE DELETE ON ff_hit BEGIN SELECT RAISE(ABORT, 'ff_hit is kept'); END;
CREATE TABLE IF NOT EXISTS ff_hit_mark (
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  hit_id TEXT NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'),
  mark TEXT CHECK (mark IS NULL OR mark IN ('pinned', 'dismissed')),
  feedback TEXT CHECK (feedback IS NULL OR feedback IN ('useful', 'noise')),
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  PRIMARY KEY (member_id, hit_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_note (
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  wire_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  PRIMARY KEY (member_id, wire_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_house_off (
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  wire_id TEXT NOT NULL CHECK (wire_id GLOB 'h-t[0-9][0-9]' OR wire_id GLOB 'h-t[0-9][0-9][a-z]'),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  PRIMARY KEY (member_id, wire_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_mute (
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  symbol TEXT NOT NULL CHECK (length(symbol) BETWEEN 1 AND 10 AND symbol NOT GLOB '*[^A-Z0-9.-]*'),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  PRIMARY KEY (member_id, symbol)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_member (
  member_id TEXT PRIMARY KEY NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  read_seq INTEGER NOT NULL DEFAULT 0 CHECK (read_seq >= 0),
  house_read_seq INTEGER NOT NULL DEFAULT 0 CHECK (house_read_seq >= 0),
  budget_b INTEGER NOT NULL DEFAULT 2 CHECK (budget_b IN (1, 2, 5)),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  seen_at INTEGER CHECK (seen_at IS NULL OR seen_at > 0)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_receipt (
  wire_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  session TEXT NOT NULL CHECK (session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('evaluated', 'not_evaluated')),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64),
  looks INTEGER NOT NULL DEFAULT 0 CHECK (looks >= 0),
  looks_expected INTEGER CHECK (looks_expected IS NULL OR looks_expected >= 0),
  names_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (names_evaluated >= 0),
  names_absent INTEGER NOT NULL DEFAULT 0 CHECK (names_absent >= 0),
  absent_json TEXT CHECK (absent_json IS NULL OR length(absent_json) <= 2048),
  hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0),
  hits_capped INTEGER NOT NULL DEFAULT 0 CHECK (hits_capped >= 0),
  late INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)),
  evaluated_at INTEGER CHECK (evaluated_at IS NULL OR evaluated_at > 0),
  upgraded_at INTEGER CHECK (upgraded_at IS NULL OR upgraded_at > 0),
  run_id TEXT CHECK (run_id IS NULL OR length(run_id) BETWEEN 1 AND 64),
  PRIMARY KEY (wire_id, version, session),
  CHECK (status = 'evaluated' OR reason IS NOT NULL)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_record (
  wire_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  period TEXT NOT NULL CHECK (period = 'all' OR period GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  firings INTEGER NOT NULL DEFAULT 0 CHECK (firings >= 0),
  sessions INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  budget REAL CHECK (budget IS NULL OR budget >= 0),
  placebo REAL CHECK (placebo IS NULL OR placebo >= 0),
  placebo_n INTEGER CHECK (placebo_n IS NULL OR placebo_n >= 0),
  confirmation REAL CHECK (confirmation IS NULL OR (confirmation >= 0 AND confirmation <= 1)),
  confirm_n INTEGER CHECK (confirm_n IS NULL OR confirm_n >= 0),
  lat_p50_s REAL CHECK (lat_p50_s IS NULL OR lat_p50_s >= 0),
  lat_p95_s REAL CHECK (lat_p95_s IS NULL OR lat_p95_s >= 0),
  coverage REAL CHECK (coverage IS NULL OR (coverage >= 0 AND coverage <= 1)),
  null_reasons TEXT CHECK (null_reasons IS NULL OR length(null_reasons) <= 512),
  updated_at INTEGER NOT NULL CHECK (updated_at > 0),
  PRIMARY KEY (wire_id, version, period)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_confirm (
  hit_id TEXT PRIMARY KEY NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'),
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'not_confirmed', 'unobservable')),
  share REAL CHECK (share IS NULL OR (share >= 0 AND share <= 1)),
  n INTEGER CHECK (n IS NULL OR n >= 0),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64),
  filled_at INTEGER NOT NULL CHECK (filled_at > 0),
  CHECK (status = 'confirmed' OR status = 'not_confirmed' OR (share IS NULL AND reason IS NOT NULL))
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_run (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 8 AND 64),
  kind TEXT NOT NULL CHECK (kind IN ('nightly', 'live', 'calib', 'rail')),
  session TEXT NOT NULL CHECK (session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 16),
  slots TEXT CHECK (slots IS NULL OR length(slots) <= 200),
  src_hash TEXT CHECK (src_hash IS NULL OR length(src_hash) BETWEEN 8 AND 64),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'superseded')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_until INTEGER CHECK (lease_until IS NULL OR lease_until > 0),
  started_at INTEGER CHECK (started_at IS NULL OR started_at > 0),
  finished_at INTEGER CHECK (finished_at IS NULL OR finished_at > 0),
  error TEXT CHECK (error IS NULL OR length(error) <= 240),
  wires_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (wires_evaluated >= 0),
  names_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (names_evaluated >= 0),
  hits_written INTEGER NOT NULL DEFAULT 0 CHECK (hits_written >= 0),
  unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  version TEXT CHECK (version IS NULL OR length(version) <= 40)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_switches (
  scope TEXT NOT NULL CHECK (scope IN ('evaluator', 'template', 'house', 'wire', 'member', 'channel')),
  target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 40),
  state TEXT NOT NULL CHECK (state IN ('on', 'hold', 'off')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120),
  set_at INTEGER NOT NULL CHECK (set_at > 0),
  PRIMARY KEY (scope, target)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ff_arch (
  session TEXT NOT NULL CHECK (session GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 16),
  src TEXT NOT NULL CHECK (src IN ('strips', 'breadth', 'alerts')),
  body TEXT NOT NULL CHECK (length(body) <= 131072),
  PRIMARY KEY (session, slot, src)
);
