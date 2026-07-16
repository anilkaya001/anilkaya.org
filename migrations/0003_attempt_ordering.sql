-- Attempt-ordering guard: record the day of the last-applied attempt on each
-- scheduling row so a late-flushed stale attempt (offline cross-device sync)
-- cannot rewind an item's review level/due_day. Additive and idempotent at the
-- runtime layer, where worker.js adds the column on the "no such column" failure
-- because Workers Builds does not apply migrations to an existing D1 database.
-- SQLite has no ADD COLUMN IF NOT EXISTS; apply this file only to a database that
-- predates the column.
ALTER TABLE mastery ADD COLUMN last_day TEXT;
ALTER TABLE skill_mastery ADD COLUMN last_day TEXT;
