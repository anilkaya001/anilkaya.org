1. Merge order. Squash each PR only after CI is green. Rebase the next branch onto the new main before merging it.
   1. #280 (test-only, deterministic gate). It removes the flake that would otherwise block #276 and every later PR.
   2. #271 (member state). Merge it once CI on 9cb73c9 is green. The login@320 failure happens only locally (probably sandbox fonts), so CI decides. If it fails in CI as well, re-baseline that one screenshot inside #271.
   3. #276 (live ledger). Rebase onto main, re-run CI, merge.
   4. #278 (FF lane D UI). Merge main in. Keep the UI dormant: no route, no nav entry, so it ships without the integration. Give it its own flows-weight ceiling entry, then merge.
   5. FF integration branch, cut from main after #278.
   6. Math-audit PR. It is test- and docs-heavy, so it adds little conflict.
   7. Desk D1/D2 PR.
   8. Lane-4 PR.
   9. Production verification after each deploy, plus one full pass at the end.
   - Shared files (assets/version.txt, docs/modules.json, suites/*.json, flows-weight ceilings): never hand-merge them. On every rebase, take main's copy and regenerate. Bump version.txt only in the last commit before merge, and only one PR at a time may be in the merge queue.

2. Smallest correct scope for each item not started, with the decision already made:
   - **FF integration:**
     - Route `/flows/fire/` and a nav entry "Fire & Forget", placed after Ledger.
     - Add FlowsUI.ffClient as a thin fetch wrapper over `/api/ff/*` with the same error and dash handling as the ledger client.
     - Wire firePage in shared/flows-pages.js.
     - `/api/ff/run` imports server/ff-eval.js and calls it in-process. No sub-request.
     - Register the nightly `ff` stage after the flows stage, with product `ff.hits`.
     - wrangler.toml: `FF_ENABLED="1"`, `FF_MAX_WIRES_PER_MEMBER=10`, `FF_MAX_HITS_PER_RUN=200`, `FF_DIGEST_HOUR_TRT=08`.
     - One switch, FF_ENABLED. When it is off, the page shows "— paused by operator", not empty lists.
     - Hit id = sha256(wire_id | trading day in TRT | condition hash).
     - Inbox only in this PR; the digest comes in the next PR.
     - Health states: ok / stale / errored / paused.
     - House wires are seeded read-only.
     - No outcome scoring.
   - **Desk D1/D2:** move short-call (sc) ranking to the server as one ordered list with a stable tiebreak (premium, then id). The client only renders it. Add a parity test that runs on the same fixture and asserts the server and the old client ranking agree before the client copy is deleted. Include visual baselines in the same PR.
   - **Math audit:** only fixture-pinned assertions for the existing formulas, plus a docs table. Where a formula is wrong, fix it in the same PR together with its test. Nothing beyond that.
   - **Lane 4:**
     - Calendar in TRT, one screen.
     - The rd column shows "— no reference" when the input is missing.
     - Card-x compression goes behind the existing ceilings. If compression would push any ceiling up, drop compression and keep the ceiling.
   - **Production verification:** a scripted smoke run, not manual clicking. It checks:
     - the asset version matches main's version.txt;
     - /flows/ledger/, /flows/unusual/ and /flows/fire/ return 200 with the header present;
     - desk Short calls are non-empty, or show a dash with a reason;
     - no console errors.

3. Top 5 risks, each with its check:
   1. **member.state 600-row ceiling is too tight.** Its basis is an estimate read from source code, never measured, and a sweep of up to 500 deletes on a busy day plus visits could break it. Check: run a load fixture (100 members, a full sweep, re-seals) and assert the measured rows are under 600. Add a production metric for rows per run, alerting at 80%. Make the sweep chunked and resumable, so going over the ceiling defers work instead of failing.
   2. **Export or watchlist silently truncates at the ceiling.** Check: a test showing that hitting the ceiling returns "— limit reached, retry later", not partial data or a 0.
   3. **FF eval inside /api/ff/run blows CPU or the D1 budget.** Check: cap with FF_MAX_HITS_PER_RUN, use one batched D1 read of the wires and one batched insert with `INSERT OR IGNORE` on the deterministic id, and add it to the engine-budget gate. Assert the total stays under 30% with FF turned on.
   4. **Duplicate or missing hits from the nightly run and manual runs racing.** Check: an idempotency test that runs the same day twice and asserts the hit count is unchanged. Use a lock row per stage keyed by the TRT trading day.
   5. **Production verification shows a stale asset version or cached old JS** (because shared files were regenerated out of order). Check: the smoke script compares the deployed version.txt and the asset hash with the main commit and fails the deploy job on a mismatch. Also check that the times shown on every page are in TRT, with a test that sets the clock to a date near the DST switch.