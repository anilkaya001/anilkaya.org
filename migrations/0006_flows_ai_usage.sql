-- Flows: what this site spent on the Workers AI model, by day.
--
-- Like the tables in 0005, the Worker also creates this on demand
-- (ensureFlowsTables runs the same CREATE TABLE IF NOT EXISTS), because
-- Workers Builds does not apply migrations to an existing D1 database.
-- Applying this file is still the correct deployment step; the self-heal
-- only stops a missed migration from silently degrading the meter.

-- KEYED ON THE UTC DATE STRING, NOT ON A ROLLING WINDOW, because
-- Cloudflare's free allowance resets at a calendar boundary — 00:00 UTC —
-- and a meter whose period differs from the limit's period reports a
-- fraction of the wrong thing. One row per day, so this table grows by
-- one row per day and never needs a sweep.
--
-- TOKENS ARE STORED; NEURONS ARE NOT. Tokens are what the model actually
-- measured and reported back in its `usage` block. The neuron figure is
-- arithmetic over them at a published per-million rate, and rates change:
-- storing the derived number would stamp today's arithmetic onto the
-- history, so a corrected rate would leave every past day wrong and
-- unfixable. Deriving it at read time means a rate correction repairs the
-- whole record. worker.js holds the rate beside the model id for the same
-- reason — a rate belonging to a different model is a meter that reads
-- plausibly and is wrong.
--
-- The CHECK constraints are floors rather than decoration: a negative
-- count here would render as a negative spend and therefore as a
-- remaining balance LARGER than the allowance, which is a gauge lying in
-- the one direction that costs something.
CREATE TABLE IF NOT EXISTS flows_ai_usage (
  day        TEXT PRIMARY KEY,
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  tokens_in  INTEGER NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL DEFAULT 0 CHECK (tokens_out >= 0)
);
