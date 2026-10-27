CREATE TABLE IF NOT EXISTS member_state (
  member_id TEXT PRIMARY KEY NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  wl_kid INTEGER,
  wl_iv TEXT,
  wl_ct TEXT,
  wl_ver INTEGER NOT NULL DEFAULT 0 CHECK (typeof(wl_ver) = 'integer' AND wl_ver >= 0),
  device_only INTEGER NOT NULL DEFAULT 0 CHECK (device_only IN (0, 1)),
  seen_ms INTEGER,
  visit_ms INTEGER,
  prev_seen_ms INTEGER,
  updated_ms INTEGER NOT NULL,
  CHECK ((wl_kid IS NULL) = (wl_iv IS NULL) AND (wl_iv IS NULL) = (wl_ct IS NULL)),
  CHECK (wl_kid IS NULL OR (typeof(wl_kid) = 'integer' AND wl_kid BETWEEN 0 AND 4294967295)),
  CHECK (wl_iv IS NULL OR (typeof(wl_iv) = 'text' AND length(wl_iv) = 16 AND wl_iv NOT GLOB '*[^A-Za-z0-9_-]*')),
  CHECK (wl_ct IS NULL OR (typeof(wl_ct) = 'text' AND length(wl_ct) = 3520 AND wl_ct NOT GLOB '*[^A-Za-z0-9_-]*')),
  CHECK (wl_ct IS NULL OR wl_ver >= 1),
  CHECK (device_only = 0 OR wl_ct IS NULL),
  CHECK ((seen_ms IS NULL) = (visit_ms IS NULL)),
  CHECK (visit_ms IS NULL OR visit_ms <= seen_ms),
  CHECK (prev_seen_ms IS NULL OR (visit_ms IS NOT NULL AND prev_seen_ms < visit_ms))
);
CREATE TABLE IF NOT EXISTS member_export (
  id INTEGER PRIMARY KEY,
  member_id TEXT NOT NULL CHECK (length(member_id) BETWEEN 3 AND 32 AND member_id NOT GLOB '*[^a-z0-9_.-]*'),
  page TEXT NOT NULL CHECK (length(page) BETWEEN 1 AND 32 AND page NOT GLOB '*[^a-z0-9-]*'),
  n_rows INTEGER NOT NULL CHECK (typeof(n_rows) = 'integer' AND n_rows >= 0),
  cols TEXT NOT NULL CHECK (length(cols) BETWEEN 1 AND 512 AND cols NOT GLOB '*[^a-z0-9_,]*'),
  at_ms INTEGER NOT NULL CHECK (typeof(at_ms) = 'integer')
);
CREATE INDEX IF NOT EXISTS member_export_by_member ON member_export (member_id, at_ms);
CREATE INDEX IF NOT EXISTS member_export_by_at ON member_export (at_ms);
