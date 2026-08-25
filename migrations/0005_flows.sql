-- Flows: the credential-gated options-flow board.
--
-- Like market_snapshot, the Worker also creates these on demand (self-heal on
-- the "no such table" failure), because Workers Builds does not apply
-- migrations to an existing D1 database. Applying this file is still the
-- correct deployment step; the self-heal only stops a missed migration from
-- silently degrading the section.

-- Published board payloads, keyed "board:long" / "board:short". The value is
-- already-serialized JSON: the Worker hands the stored string straight to the
-- response body without parsing it, so serving cost is constant in payload
-- size. That matters because Workers Free allows 10 ms of CPU per invocation.
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
