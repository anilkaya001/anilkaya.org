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
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS skill_mastery_due_by_user ON skill_mastery (user_id, due_day, skill_id);

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

