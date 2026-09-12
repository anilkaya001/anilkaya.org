-- THE STANDING SUMMARY: one row per scope, rewritten only when the facts it
-- summarises change.
--
-- WHY A TABLE AND NOT A PAYLOAD KEY. The obvious home is flows_payload, beside
-- the seventeen surfaces the pipeline publishes, and it is the wrong one. The
-- cron's own stated rule is REFRESH, NEVER SEED: a cron that seeded keys would
-- be a second publisher with a second idea of the schema, and the ingest
-- allowlist admits no such key, so a Worker-written blob would arrive with no
-- publisher-side validation at all. This is Worker-owned data — generated
-- here, read here, never touched by the pipeline — and it says so by living in
-- its own table, exactly as flows_ai_usage does.
--
-- THE FINGERPRINT IS THE WHOLE COST CONTROL, and it is stored rather than
-- recomputed because the comparison has to survive a restart. The cron fires
-- 96 times a day; the briefing it summarises is published once a weekday and
-- the intraday refresh never rewrites that key. So the facts change on exactly
-- one firing, and a summary keyed on the clock would spend ninety-six times
-- what it needs — against a 10,000-neuron daily allowance that belongs to the
-- whole Cloudflare ACCOUNT and not to this route. It would also hand two
-- readers of the same board two different sentences about it, which is the
-- property the fact selector works hardest to guarantee.
--
-- `llm` RECORDS WHETHER A MODEL WROTE IT, and the column exists because the
-- answer is not inferable from the text. A summary that reads well may be the
-- deterministic fallback; one that reads badly may be the model's. The page
-- marks the two differently, and a reader is owed the distinction rather than
-- being left to guess from the prose. `guard` carries WHICH failure refused a
-- generation — an invented figure and a claim about the future are not the
-- same fault — and is null when nothing was refused.
--
-- THE SCOPE IS THE KEY, so per-card summaries share this table with the
-- board-wide one: 'board' for the whole session, 'card:NVDA' for one name.
-- One shape, one read path, and the per-card lane cannot drift from the
-- board-wide one because there is only one of each.
CREATE TABLE IF NOT EXISTS flows_ai_summary (
  scope        TEXT PRIMARY KEY,
  text         TEXT NOT NULL,
  llm          INTEGER NOT NULL DEFAULT 0 CHECK (llm IN (0, 1)),
  model        TEXT,
  fingerprint  TEXT NOT NULL,
  guard        TEXT,
  generated_at TEXT NOT NULL
);
