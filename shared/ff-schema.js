const MEMBER = "length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'";
const SESSION = "GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
const SYMBOL = "length(symbol) BETWEEN 1 AND 10 AND symbol NOT GLOB '*[^A-Z0-9.-]*'";
const FROZEN_HIT = "stream, seq, hit_id, wire_id, wire_version, member_id, subject, symbol, sector, dedupe_key, session, " +
  "session_label, fired_at, data_as_of, evaluator, evaluator_version, evidence_json, state";

export const FF_SCHEMA_SQL = Object.freeze([
  "CREATE TABLE IF NOT EXISTS ff_wire (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "layer TEXT NOT NULL CHECK (layer IN ('house', 'member')), " +
    "member_id TEXT, " +
    "title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80), " +
    "status TEXT NOT NULL CHECK (status IN ('armed', 'paused', 'retired')), " +
    "status_at INTEGER NOT NULL CHECK (status_at > 0), " +
    "current_version INTEGER NOT NULL CHECK (current_version >= 1), " +
    "origin TEXT CHECK (origin IS NULL OR length(origin) BETWEEN 3 AND 24), " +
    "created_at INTEGER NOT NULL CHECK (created_at > 0), " +
    "CHECK ((layer = 'house' AND member_id IS NULL AND (id GLOB 'h-t[0-9][0-9]' OR id GLOB 'h-t[0-9][0-9][a-z]')) OR " +
    `(layer = 'member' AND member_id IS NOT NULL AND ${MEMBER} AND length(id) = 18 AND id GLOB 'w-[a-z2-7]*' AND id NOT GLOB 'w-*[^a-z2-7]*'))` +
    ") WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS ff_wire_by_member ON ff_wire (member_id, status)",

  "CREATE TABLE IF NOT EXISTS ff_wire_version (" +
    "wire_id TEXT NOT NULL, " +
    "version INTEGER NOT NULL CHECK (version >= 1), " +
    "template TEXT NOT NULL CHECK (template IN ('T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'custom')), " +
    "cadence TEXT NOT NULL CHECK (cadence IN ('nightly', 'live', 'rail')), " +
    "scope_kind TEXT NOT NULL CHECK (scope_kind IN ('names', 'sector', 'universe', 'watchlist')), " +
    "control TEXT NOT NULL CHECK (control IN ('fact', 'bh', 'sr')), " +
    "exp_week REAL CHECK (exp_week IS NULL OR exp_week >= 0), " +
    "clause_hash TEXT NOT NULL CHECK (length(clause_hash) = 10 AND clause_hash NOT GLOB '*[^0-9a-f]*'), " +
    "ast_json TEXT NOT NULL CHECK (length(ast_json) <= 4096), " +
    "ast_hash TEXT NOT NULL CHECK (length(ast_hash) = 64 AND ast_hash NOT GLOB '*[^0-9a-f]*'), " +
    "sentence TEXT NOT NULL CHECK (length(sentence) BETWEEN 1 AND 280), " +
    "registry_version INTEGER NOT NULL CHECK (registry_version >= 1), " +
    `effective_session TEXT NOT NULL CHECK (effective_session ${SESSION}), ` +
    "created_at INTEGER NOT NULL CHECK (created_at > 0), " +
    "PRIMARY KEY (wire_id, version)) WITHOUT ROWID",
  "CREATE TRIGGER IF NOT EXISTS ff_wire_version_frozen BEFORE UPDATE ON ff_wire_version " +
    "BEGIN SELECT RAISE(ABORT, 'ff_wire_version is frozen'); END",
  "CREATE TRIGGER IF NOT EXISTS ff_wire_version_kept BEFORE DELETE ON ff_wire_version " +
    "BEGIN SELECT RAISE(ABORT, 'ff_wire_version is kept'); END",

  "CREATE TABLE IF NOT EXISTS ff_wire_symbol (" +
    `member_id TEXT NOT NULL CHECK (${MEMBER}), ` +
    `symbol TEXT NOT NULL CHECK (${SYMBOL}), ` +
    "wire_id TEXT NOT NULL, " +
    "PRIMARY KEY (member_id, symbol, wire_id)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_state (" +
    "wire_id TEXT NOT NULL, " +
    "subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 64), " +
    "version INTEGER NOT NULL CHECK (version >= 1), " +
    "phase TEXT NOT NULL CHECK (phase IN ('pending', 'firing', 'cooling')), " +
    "cnt INTEGER NOT NULL DEFAULT 0 CHECK (cnt >= 0), " +
    `last_session TEXT NOT NULL CHECK (last_session ${SESSION}), ` +
    `cool_until TEXT CHECK (cool_until IS NULL OR cool_until ${SESSION}), ` +
    "detector_json TEXT CHECK (detector_json IS NULL OR length(detector_json) <= 512), " +
    "PRIMARY KEY (wire_id, subject), " +
    "CHECK (phase <> 'cooling' OR cool_until IS NOT NULL)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_hit (" +
    "stream TEXT NOT NULL CHECK (stream = 'house' OR (length(stream) BETWEEN 3 AND 32 AND stream NOT GLOB '*[^a-z0-9_.-]*')), " +
    "seq INTEGER NOT NULL CHECK (seq >= 1), " +
    "hit_id TEXT NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'), " +
    "wire_id TEXT NOT NULL, " +
    "wire_version INTEGER NOT NULL CHECK (wire_version >= 1), " +
    "member_id TEXT, " +
    "subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 64), " +
    "symbol TEXT CHECK (symbol IS NULL OR (length(symbol) BETWEEN 1 AND 10 AND symbol NOT GLOB '*[^A-Z0-9.-]*')), " +
    "sector TEXT CHECK (sector IS NULL OR length(sector) BETWEEN 1 AND 40), " +
    "dedupe_key TEXT NOT NULL CHECK (length(dedupe_key) BETWEEN 1 AND 160), " +
    `session TEXT NOT NULL CHECK (session ${SESSION}), ` +
    "session_label TEXT NOT NULL CHECK (length(session_label) BETWEEN 1 AND 24), " +
    "fired_at INTEGER NOT NULL CHECK (fired_at > 0), " +
    "data_as_of INTEGER NOT NULL CHECK (data_as_of > 0), " +
    "evaluator TEXT NOT NULL CHECK (evaluator IN ('nightly', 'live', 'rail')), " +
    "evaluator_version TEXT NOT NULL CHECK (length(evaluator_version) BETWEEN 1 AND 40), " +
    "evidence_json TEXT NOT NULL CHECK (length(evidence_json) <= 4096), " +
    "state TEXT NOT NULL CHECK (state IN ('delivered', 'held')), " +
    "withdrawn_at INTEGER CHECK (withdrawn_at IS NULL OR withdrawn_at > 0), " +
    "withdrawn_reason TEXT CHECK (withdrawn_reason IS NULL OR length(withdrawn_reason) BETWEEN 1 AND 120), " +
    "PRIMARY KEY (stream, seq), " +
    "UNIQUE (wire_id, dedupe_key), " +
    "UNIQUE (hit_id), " +
    "CHECK ((member_id IS NULL AND stream = 'house') OR (member_id IS NOT NULL AND stream = member_id)), " +
    "CHECK ((withdrawn_at IS NULL) = (withdrawn_reason IS NULL))) WITHOUT ROWID",
  "CREATE INDEX IF NOT EXISTS ff_hit_by_wire ON ff_hit (wire_id, seq)",
  "CREATE INDEX IF NOT EXISTS ff_hit_by_symbol ON ff_hit (stream, symbol, seq)",
  `CREATE TRIGGER IF NOT EXISTS ff_hit_frozen BEFORE UPDATE OF ${FROZEN_HIT} ON ff_hit ` +
    "BEGIN SELECT RAISE(ABORT, 'ff_hit is frozen'); END",
  "CREATE TRIGGER IF NOT EXISTS ff_hit_kept BEFORE DELETE ON ff_hit " +
    "BEGIN SELECT RAISE(ABORT, 'ff_hit is kept'); END",

  "CREATE TABLE IF NOT EXISTS ff_hit_mark (" +
    `member_id TEXT NOT NULL CHECK (${MEMBER}), ` +
    "hit_id TEXT NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'), " +
    "mark TEXT CHECK (mark IS NULL OR mark IN ('pinned', 'dismissed')), " +
    "feedback TEXT CHECK (feedback IS NULL OR feedback IN ('useful', 'noise')), " +
    "updated_at INTEGER NOT NULL CHECK (updated_at > 0), " +
    "PRIMARY KEY (member_id, hit_id)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_note (" +
    `member_id TEXT NOT NULL CHECK (${MEMBER}), ` +
    "wire_id TEXT NOT NULL, " +
    "body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500), " +
    "updated_at INTEGER NOT NULL CHECK (updated_at > 0), " +
    "PRIMARY KEY (member_id, wire_id)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_house_off (" +
    `member_id TEXT NOT NULL CHECK (${MEMBER}), ` +
    "wire_id TEXT NOT NULL CHECK (wire_id GLOB 'h-t[0-9][0-9]' OR wire_id GLOB 'h-t[0-9][0-9][a-z]'), " +
    "created_at INTEGER NOT NULL CHECK (created_at > 0), " +
    "PRIMARY KEY (member_id, wire_id)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_mute (" +
    `member_id TEXT NOT NULL CHECK (${MEMBER}), ` +
    `symbol TEXT NOT NULL CHECK (${SYMBOL}), ` +
    "created_at INTEGER NOT NULL CHECK (created_at > 0), " +
    "PRIMARY KEY (member_id, symbol)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_member (" +
    `member_id TEXT PRIMARY KEY NOT NULL CHECK (${MEMBER}), ` +
    "read_seq INTEGER NOT NULL DEFAULT 0 CHECK (read_seq >= 0), " +
    "house_read_seq INTEGER NOT NULL DEFAULT 0 CHECK (house_read_seq >= 0), " +
    "budget_b INTEGER NOT NULL DEFAULT 2 CHECK (budget_b IN (1, 2, 5)), " +
    "created_at INTEGER NOT NULL CHECK (created_at > 0), " +
    "seen_at INTEGER CHECK (seen_at IS NULL OR seen_at > 0)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_receipt (" +
    "wire_id TEXT NOT NULL, " +
    "version INTEGER NOT NULL CHECK (version >= 1), " +
    `session TEXT NOT NULL CHECK (session ${SESSION}), ` +
    "status TEXT NOT NULL CHECK (status IN ('evaluated', 'not_evaluated')), " +
    "reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64), " +
    "looks INTEGER NOT NULL DEFAULT 0 CHECK (looks >= 0), " +
    "looks_expected INTEGER CHECK (looks_expected IS NULL OR looks_expected >= 0), " +
    "names_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (names_evaluated >= 0), " +
    "names_absent INTEGER NOT NULL DEFAULT 0 CHECK (names_absent >= 0), " +
    "absent_json TEXT CHECK (absent_json IS NULL OR length(absent_json) <= 2048), " +
    "hits INTEGER NOT NULL DEFAULT 0 CHECK (hits >= 0), " +
    "hits_capped INTEGER NOT NULL DEFAULT 0 CHECK (hits_capped >= 0), " +
    "late INTEGER NOT NULL DEFAULT 0 CHECK (late IN (0, 1)), " +
    "evaluated_at INTEGER CHECK (evaluated_at IS NULL OR evaluated_at > 0), " +
    "upgraded_at INTEGER CHECK (upgraded_at IS NULL OR upgraded_at > 0), " +
    "run_id TEXT CHECK (run_id IS NULL OR length(run_id) BETWEEN 1 AND 64), " +
    "PRIMARY KEY (wire_id, version, session), " +
    "CHECK (status = 'evaluated' OR reason IS NOT NULL)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_record (" +
    "wire_id TEXT NOT NULL, " +
    "version INTEGER NOT NULL CHECK (version >= 1), " +
    "period TEXT NOT NULL CHECK (period = 'all' OR period GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'), " +
    "firings INTEGER NOT NULL DEFAULT 0 CHECK (firings >= 0), " +
    "sessions INTEGER NOT NULL DEFAULT 0 CHECK (sessions >= 0), " +
    "budget REAL CHECK (budget IS NULL OR budget >= 0), " +
    "placebo REAL CHECK (placebo IS NULL OR placebo >= 0), " +
    "placebo_n INTEGER CHECK (placebo_n IS NULL OR placebo_n >= 0), " +
    "confirmation REAL CHECK (confirmation IS NULL OR (confirmation >= 0 AND confirmation <= 1)), " +
    "confirm_n INTEGER CHECK (confirm_n IS NULL OR confirm_n >= 0), " +
    "lat_p50_s REAL CHECK (lat_p50_s IS NULL OR lat_p50_s >= 0), " +
    "lat_p95_s REAL CHECK (lat_p95_s IS NULL OR lat_p95_s >= 0), " +
    "coverage REAL CHECK (coverage IS NULL OR (coverage >= 0 AND coverage <= 1)), " +
    "null_reasons TEXT CHECK (null_reasons IS NULL OR length(null_reasons) <= 512), " +
    "updated_at INTEGER NOT NULL CHECK (updated_at > 0), " +
    "PRIMARY KEY (wire_id, version, period)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_confirm (" +
    "hit_id TEXT PRIMARY KEY NOT NULL CHECK (length(hit_id) = 20 AND hit_id NOT GLOB '*[^a-z2-7]*'), " +
    "status TEXT NOT NULL CHECK (status IN ('confirmed', 'not_confirmed', 'unobservable')), " +
    "share REAL CHECK (share IS NULL OR (share >= 0 AND share <= 1)), " +
    "n INTEGER CHECK (n IS NULL OR n >= 0), " +
    "reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 64), " +
    "filled_at INTEGER NOT NULL CHECK (filled_at > 0), " +
    "CHECK (status = 'confirmed' OR status = 'not_confirmed' OR (share IS NULL AND reason IS NOT NULL))) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_run (" +
    "id TEXT PRIMARY KEY NOT NULL CHECK (length(id) BETWEEN 8 AND 64), " +
    "kind TEXT NOT NULL CHECK (kind IN ('nightly', 'live', 'calib', 'rail')), " +
    `session TEXT NOT NULL CHECK (session ${SESSION}), ` +
    "slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 16), " +
    "slots TEXT CHECK (slots IS NULL OR length(slots) <= 200), " +
    "src_hash TEXT CHECK (src_hash IS NULL OR length(src_hash) BETWEEN 8 AND 64), " +
    "status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'superseded')), " +
    "attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), " +
    "lease_until INTEGER CHECK (lease_until IS NULL OR lease_until > 0), " +
    "started_at INTEGER CHECK (started_at IS NULL OR started_at > 0), " +
    "finished_at INTEGER CHECK (finished_at IS NULL OR finished_at > 0), " +
    "error TEXT CHECK (error IS NULL OR length(error) <= 240), " +
    "wires_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (wires_evaluated >= 0), " +
    "names_evaluated INTEGER NOT NULL DEFAULT 0 CHECK (names_evaluated >= 0), " +
    "hits_written INTEGER NOT NULL DEFAULT 0 CHECK (hits_written >= 0), " +
    "unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0), " +
    "rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0), " +
    "rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0), " +
    "version TEXT CHECK (version IS NULL OR length(version) <= 40)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_switches (" +
    "scope TEXT NOT NULL CHECK (scope IN ('evaluator', 'template', 'house', 'wire', 'member', 'channel')), " +
    "target TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 40), " +
    "state TEXT NOT NULL CHECK (state IN ('on', 'hold', 'off')), " +
    "reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 120), " +
    "set_at INTEGER NOT NULL CHECK (set_at > 0), " +
    "PRIMARY KEY (scope, target)) WITHOUT ROWID",

  "CREATE TABLE IF NOT EXISTS ff_arch (" +
    `session TEXT NOT NULL CHECK (session ${SESSION}), ` +
    "slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 16), " +
    "src TEXT NOT NULL CHECK (src IN ('strips', 'breadth', 'alerts')), " +
    "body TEXT NOT NULL CHECK (length(body) <= 131072), " +
    "PRIMARY KEY (session, slot, src))",
]);

export const FF_TABLES = Object.freeze([
  "ff_wire", "ff_wire_version", "ff_wire_symbol", "ff_state", "ff_hit", "ff_hit_mark", "ff_note", "ff_house_off", "ff_mute",
  "ff_member", "ff_receipt", "ff_record", "ff_confirm", "ff_run", "ff_switches", "ff_arch",
]);
