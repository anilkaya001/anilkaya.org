# Fire & Forget: the Phase 0 contract

Status: frozen on merge. Version 1 (`FF_CONTRACT_VERSION`, `REGISTRY_VERSION`, `AST_VERSION` in `shared/ff-contract.js`). A change to anything below is a pull request that changes this file, `shared/ff-contract.js` and `tests/ff-contract.mjs` together, and a change to a table is migration 0027 and a contract version bump. Lanes only create new files; every edit to a shared file belongs to lane G.

Sources: the owner-approved consultations (product and architecture, definition and statistics, and three Phase 0 consultations on data model, evaluation and registry), checked against the code. Where the consultations disagreed or were wrong about this repository, the ruling and the reason are in "Where this differs from the consultations".

## 1. What the product is

Fire & Forget is what Flows produces without anyone asking, in three layers:

- **House wires.** Written by the platform, registered in code, run once a night or once a tick across the whole universe for every member, each with a published record. They are the ten templates T01 to T10 that the data allows. New members are subscribed to all of them; "subscribed" means the absence of an opt-out row.
- **Member wires.** A standing condition a member writes once. The second layer.
- **Receipts.** For every armed wire and every session or night: `evaluated` or `not evaluated` with the reason. A failed or late run shows `— not evaluated: <reason>`, never "no hit".

Words: the condition is a **wire**, a firing is a **hit**. The word for an instruction to trade does not appear in any copy, route, table or file; `COPY_BANNED` lists it. Nothing is ever counted across members. A hit carries no "bullish" or "bearish" label, no forecast and no advice. No word in `COPY_BANNED` appears in any copy. Every clock time is shown in TRT with a session label.

A wire's record is calibration (firings on shuffled past sessions against the false-alarm budget), confirmation (for opening-flow wires, the share of flagged opening flow that appears in next-day open interest), latency p50 and p95, firing count and coverage. **No price outcome is scored anywhere**: no hit rate on price moves, no return columns, no reference price. Funds join their own prices to the timestamped export. A member's note on a wire is private, labelled "Your note", and never delivered or exported.

## 2. Architecture and data flow

```text
nightly (Actions)                         Worker (Cloudflare)                       browser
 scripts/flows-pipeline.mjs
  stage ff  ->  ff-metrics, ff-carry  -->  ingest door (flows_payload)
  then POST /api/ff/run {nightly}  ----->  server/ff-eval.js
                                             claims ff_run (lease), reads wires, evaluates
                                             writes ff_hit, ff_receipt, ff_state, ff_record
live loops
  Tier 2 (Actions) writes live:*  ------>  ingestLive -> ctx.waitUntil(evaluateTick)
  Tier 1 (Worker cron) writes live:*      same function, same tables
half-hourly housekeeping  -------------->  gap check: retries pending runs, writes not_evaluated
                                           receipts, prunes ff_run, closes live receipts
                                                                                   mark, inbox, fire, wires, digest
                                                                                   read /api/ff/*
```

1. **Evaluation happens inside Cloudflare.** The Actions runner has no D1 binding and the repository is public, so a runner log must never hold a member's wire. The nightly leg is member-free: it computes metric values and, for the hist-backed anomaly metrics, the z, from data it already holds, and posts them as the `ff-metrics` product. `POST /api/ff/run` (bearer only, the same tokens as ingest) starts the Worker's evaluation. Housekeeping retries a run that is pending, failed or past its lease, so the leg's call is a convenience and the cron is the guarantee.
2. **Evaluation never calls the vendor and reads only what the pipeline already holds.** Nothing under `shared/ff-*`, `server/ff-*` or the FF scripts imports the vendor clients or the model modules; `FORBIDDEN` in the contract lists them and `tests/ff-contract.mjs` scans every FF file for them.
3. **Three-valued logic.** Every clause is true, false or unknown. Absent, stale, out-of-range or thin data is unknown with a reason and an em dash, never zero. Only true fires.
4. **Baselines live in the leg.** `ff-metrics` ships the value, the z (to 0.01), the baseline count and a floored flag for each anomaly metric, from `hist:<T>` (252 dated sessions). The Worker never rolls a baseline, there is no baseline table, and no history needs to warm up for the available metrics. A metric whose history does not exist (T04) is warming.
5. **v1 live wires are facts.** There is no z on a partial-day value. Live wires read one source key, use level or event metrics, and carry a persistence count. Per-message evaluation on the real-time rail is deferred; `rail` is reserved in the cadence and evaluator checks.
6. **Delivery in v1 is the in-app inbox and the digest.** Push, webhooks, email and the fund feed are phase 3, and any payload leaving Flows will carry Flows-computed metrics only until the vendor licensing question is settled.

## 3. Tables (migration `0026_ff.sql`)

The DDL is `shared/ff-schema.js`; `migrations/0026_ff.sql`, the FF block of `schema.sql` and the constant are held equal by `tests/academy-contract.mjs` and `tests/ff-contract.mjs`. The Worker's first-use path probes one table and runs the constant only on a missing-table error; it does not add statements to every cold start. No table has a foreign key into any other lane's tables (the member-state lane's migration 0025 is independent of this one), and `member_id` is plain text in the member-state format.

| Table | Rows | Rule |
|---|---|---|
| `ff_wire` | one per wire | identity and lifecycle only: `layer` (house, member), `member_id`, `title`, `status` (armed, paused, retired), `current_version`, `origin` (a house wire a member copied, as `h-t01@3`). Member ids are `w-` and 16 random base32 characters; house ids are `h-t01`…`h-t10` and `h-t07a`, `h-t07b`, permanent and never reused. |
| `ff_wire_version` | one per version | the definition: `template`, `cadence` (nightly, live, rail reserved), `scope_kind` (names, sector, universe, watchlist reserved), `control` (fact, bh, sr reserved), `exp_week`, `clause_hash`, `ast_json`, `ast_hash`, `sentence`, `registry_version`, `effective_session`. Frozen by triggers: no update, no delete. Adjust makes a new version. |
| `ff_wire_symbol` | one per wire and name | the editable index of the current version's names (`names` scope only), rewritten in the Adjust batch. |
| `ff_state` | exceptions only | per wire and subject: `phase` (pending, firing, cooling), `cnt`, `last_session`, `cool_until` (a session date, required for cooling), `detector_json`. No row means armed with count zero and no quiet period, so a quiet tick writes nothing here. |
| `ff_hit` | one per hit | frozen by triggers: only `withdrawn_at` and `withdrawn_reason` may change, and no row is deleted. Two streams: `house` (one row per event, not one per member) and the member id (the member's own wires). `seq` is gapless per stream. Evidence at most 4 KiB. State is `delivered` or `held` and never changes. |
| `ff_hit_mark` | sparse | per member and hit: `pinned` or `dismissed`, and `useful` or `noise`. The per-member fields that cannot sit on a shared house row. |
| `ff_note` | sparse | "Your note", per member and wire, at most 500 characters, on member and house wires alike. No export or digest path selects from it. |
| `ff_house_off` | opt-outs | a member who turned a house wire off. |
| `ff_mute` | sparse | a muted name, at most 500 per member. |
| `ff_member` | created on first read | the two inbox cursors (`read_seq`, `house_read_seq`, the latter set to the house stream's current maximum when the row is created, so a new member does not open on the whole history) and `budget_b` (1, 2 or 5; default 2). |
| `ff_receipt` | one per armed wire, version and session | `evaluated` or `not_evaluated`; a `not_evaluated` row must carry a reason. A late run may upgrade it (`late`, `upgraded_at`), never the other way. |
| `ff_record` | one per wire, version and period | Member wires have the period `all` only, written by each evaluation; the week in progress is computed on read from the hits and receipts. House wires have `all` nightly and one `YYYY-Www` row a week (New York session date) from the calibration leg. Calibration, confirmation, latency, firings, sessions, coverage. A NULL figure is an em dash with its reason in `null_reasons`; `firings = 0` is a real zero. No column matches `px`, `price`, `ret`, `pnl` or `iv`. |
| `ff_confirm` | T02 hits | per hit: `confirmed`, `not_confirmed` or `unobservable`. An unobservable hit has no share and a reason; it never counts as not confirmed. |
| `ff_run` | one per kind and session | the heartbeat and the lease: `nightly:<session>`, `live:<session>`, `calib:<YYYY-Www>`. A live tick upserts its session's single row at its end (ticks counted in `attempts`, the last slot, the last ok time, a bitmap of the evaluated slots in `slots`, the running hit count, and the rows the run read and wrote, so the budget's planned figures can be replaced by the 95th percentile of twenty sessions); the nightly run claims its row with a lease and finishes it. No secondary index. Kept 14 days. |
| `ff_switches` | rare | scope (evaluator, template, house, wire, member, channel), target, state on, hold or off. No row means on. |
| `ff_arch` | 28 rows a session | the intraday archive (strips snapshots at each Tier 2 landing, the final breadth and alerts), written only when the `channel:archive` switch is on. It exists so intraday detectors can arm after 60 sessions. |

**Write discipline.** D1 bills a row for every table row and every index entry a statement touches, so the costs come from the DDL and `tests/ff-contract.mjs` derives them from it: five rows for a hit, two for a wire (its member index) and for an archive row (a rowid table, because its bodies are large), one for every other table, and the test fails when an index is added that the budget does not price. Every table but the archive is `WITHOUT ROWID`. Upserts are `ON CONFLICT DO UPDATE ... WHERE` something changed; `INSERT OR REPLACE` is never used, because it deletes the row and every index entry and inserts them again. A cursor only advances and is written only when it does. `cool_until` is an absolute session date, never a counter decremented each night. A hit's `seq` is assigned inside its insert statement. A hit's state rows are three over its life: `firing` at the hit, `cooling` at the exit (or deleted when the exit comes after the quiet period), deleted when the quiet period ends.

**Retention.** Hits, versions, receipts and records are kept in version 1 (about half a gigabyte a year in all); run rows are kept 14 days and archive rows 120 sessions. A retention job for the rest and the alert at 6 GB of the 10 GB database are a later row, and declare their delete rows when they arrive.

Column types: every `*_at` is integer epoch milliseconds in UTC; `session` is the New York trading date of the data evaluated, not the date on the clock when evaluation ran.

The row budget is declared in `tests/lib/d1-budget-ff.mjs` (lane B owns the file after Phase 0) and priced into `tests/lib/d1-budget.mjs`: about 3,100 rows written and 93,000 read on a weekday, which leaves the daily ledger about 120 rows of headroom under its 30 per cent guard, and a worst case of 2.4 MB of hit evidence a session under the hit caps. The next lane to declare rows needs the per-lane allocation change to that guard, a separate pull request.

## 4. The wire: AST v1

```json
{"v":1,"cadence":"live","scope":{"kind":"universe"},"all":[{"m":"contract.dte","op":"<=","x":21},{"m":"contract.premium","op":">=","x":1000000}],"persist":1,"cooldown":{"unit":"session","n":1}}
```

- `scope` is `{"kind":"universe"}`, `{"kind":"sector","sector":"<name>"}` or `{"kind":"names","symbols":[…]}` (unique, uppercase, sorted, in the universe). `watchlist` is reserved and refused (`ff_scope_reserved`) until the member-state lane lands.
- `all` is a flat conjunction of clauses `{m, op, x}`. `op` is `>=`, `<=` or `==`. There is no or, no not and no expression language; a template that needs an or is two wires (T07).
- The server derives `control` (`bh` if any clause is on an anomaly metric, otherwise `fact`), `q` (0.05), the hysteresis, the step, the floor and the z space, and stores them with the registry version in a derived block of the stored body. A client that sends any of them is refused. Arming therefore copies the registry into the version, and a later registry edit cannot change an armed version.
- Limits (`LIMITS`): 1 to 8 clauses, at most 2 per metric (that allows a band), at most 25 symbols, persistence 1 to 3 nightly and 1 to 4 live, a cooldown of 1, 2, 5, 10 or 20 sessions on a nightly wire (5 unless the member chooses) and 1, the rest of the session, on a live wire, a stored body of at most 4 KiB, a sentence of at most 280 characters, a title of at most 80, 50 armed wires per member of which at most 5 universe-scope and at most 5 live, 2,000 armed member wires in all, at most 10 versions per wire per session, 500 mutes. A threshold must lie in the metric's range and be a multiple of the unit's threshold step; a finer one is `ff_grammar_precision`. The sum of `exp_week` over a member's armed anomaly wires may not exceed the member's weekly budget B (1, 2 or 5 false alarms, default 2): `ff_budget_exceeded`.
- A live wire is all facts and reads one source key. A sector metric cannot be combined with another subject. A client cannot save a clause on a warming or hidden metric.
- Canonical JSON sorts keys, writes numbers in their shortest round-trip form with minus zero as zero, and refuses NaN and infinity. `ast_hash` is SHA-256 over the canonical stored body including the derived block. `clause_hash` is the first 10 hex characters of SHA-256 over the canonical clauses sorted by their canonical strings, so reordering clauses does not move it; scope, cadence, control and title are outside it.
- A member can edit the label, the clauses, thresholds, persistence, cooldown, scope, armed or paused, and the note. Cadence cannot change (a new wire), control, the null law and the metric formulas never. Every Adjust makes a new version, clears the wire's `ff_state` when `clause_hash` changes and keeps it when only the scope changes. House wires cannot be edited; a member can turn one off or copy it (`origin`). Arming an unmodified copy while still following the source is refused: `ff_house_duplicate`.

## 5. Metrics, units and precision

The registry is `METRICS` in the contract and `docs/ff/inventory.md` is its human twin; the test holds them equal. Entry shape: id, unit, subject (ticker, window, sector), kind (fact, anomaly), edge (state, event), cadence, per-cadence source `{key, path}`, range, staleness, baseline, null law, hysteresis, status (ready, limited, warming, hidden), reason, unlock, label.

- **Ids** match `METRIC_ID_RE`: `domain.name[.<n>d][.suffix]` with domains flow, vol, oi, px, contract, earn, sector, desk and suffixes `chg1d`, `z20`, `pct252`, `zvov`, `x0`. One id names one number with one unit; units live in the registry, never in the id. Ids sit inside `ast_hash` and are never renamed; a retired metric becomes `hidden`.
- **Units** are the closed set usd, contracts, sigma, vol_pt, pct, pctile, ratio, sessions, days, bool. Each has a comparison `step` and a threshold step `xStep`. Values are rounded half away from zero on scaled integers; the rounded value is what is compared and what the evidence stores, so a hit never shows "2.99σ" against a threshold of 3.00σ and "3.00" never fails to fire. sigma 0.01 (thresholds on a 0.25 grid), usd $1,000 ($10,000), vol points 0.1 (0.5), percent 0.1 (0.5), ratio 0.01 (0.05), percentile 1 (5), contracts 1 (100).
- **Robust z**: `z = (x − median20) / max(1.4826 · MAD20, floor)`, the baseline being the 20 sessions before the current one, at least 15 of them valid (counted on the session calendar, so a missed night is visible) or the value is unknown `warming` with the count (`— baseline 11/20 sessions`). The floor is `max(abs, rel · |median20|)`, in log units for ratios, and the evidence says "denominator floored" when it applied. A flat baseline therefore gives z = 0.00 for x = 0 and 50.00 for x = $5M at a $100k floor, never infinity.
- **Staleness**: nightly values must carry the most recent completed session (`maxAgeSessions` 0; 5 for slow fields such as the report date), counted in sessions on the XNYS calendar; live values must be younger than 1,800 s (two Tier 2 periods) and belong to today's session; Tier 1 sources 720 s. Stale is unknown, never carried forward. Event metrics (flagged windows) are deduplicated by contract and span start, not aged out.
- **Ranges**: a value outside its range is unknown `out_of_range`, never clipped.
- **Hysteresis defaults**: sigma 0.5; usd the larger of 10% and $50,000; contracts the larger of 10% and 100; vol points 0.5; percent 1.0; percentile 5; ratio 5% (re-arm below 0.95 θ); sessions 0; events none.

## 6. Templates and house wires

| Template | House wire | Cadence | Control | Verdict |
|---|---|---|---|---|
| T01 Earnings run-up | `h-t01` | nightly | bh | available |
| T02 Opening confirmed | `h-t02` | nightly | fact | limited |
| T03 Short-dated OTM aggression | `h-t03` | live, nightly catch-up | fact | available |
| T04 Hedge demand on my names | `h-t04` | nightly | bh | warming |
| T05 Vol break without a catalyst | `h-t05` | nightly | bh | available |
| T06 Upside skew flip | `h-t06` | nightly | fact | limited |
| T07 Implied move vs history | `h-t07a`, `h-t07b` | nightly | fact | available |
| T08 Sector premium surge with breadth | `h-t08` | nightly | bh | available |
| T09 Overwrite window | none | none | fact | hidden |
| T10 Pin into expiry | none | none | fact | hidden |

The default clauses are `TEMPLATES[].ast` in the contract; the reasons for each verdict are in `docs/ff/inventory.md`. House wires live in code (`shared/ff-house.js`, lane A): `{id, version, effective_session, template, title, sentence, ast, pinned ast_hash}`; the housekeeping cron inserts them with insert-or-ignore, and an entry whose `ast_hash` differs from the stored one for the same id and version is not evaluated (receipt `registry_conflict`). A new house version takes effect at a session boundary; a house wire that breaks mid-session is switched off, not re-versioned. The house AST has the same shape and the same canonicaliser as a member's; nothing a member cannot write appears in it.

## 7. Statistics

- **Facts** (a clause on a level or event metric) need provenance, persistence and hysteresis only. Their record shows expected against observed firings on shuffled sessions.
- **Anomalies** (a clause on a z metric) carry a registered null: the Student t with 5 degrees of freedom. The p-value is the upper tail at z for `>=` and the lower tail for `<=`; several anomaly clauses in one wire take the maximum p (intersection–union, valid without independence). Upper tails: t = 3.0 gives 0.0150, 2.5 gives 0.0272, 2.0 gives 0.0510. Any wire with an anomaly clause is a Benjamini–Hochberg family at q = 0.05 over the scope's names with valid inputs; a name is a hit only if BH rejects it, every anomaly threshold passes and every fact clause is true (facts filter after BH, because gating before it breaks the uniformity of the null p-values). A member's names-scope wire is a family of its own names; it is never pooled across members.
- **Alpha-investing and LORD are not used** for monitoring: they control false discoveries over an ordered stream and their wealth runs out in calm periods. Intraday Shiryaev–Roberts detectors (`control = 'sr'`) are reserved until `ff_arch` holds 60 sessions.
- **State machine** per (wire, subject): entry when all clauses are true for `persist` consecutive looks; exit when any clause is false at its threshold relaxed by the hysteresis; unknown freezes the count and the phase. A `state` metric needs an observed false before the true, so a new wire or version never fires on its first look; an `event` metric fires whenever the condition is true and the wire is not already firing. After a hit the wire re-arms only on exit. One hit per key per session.
- **Cooldown**: after a hit the wire is quiet on that subject for `cooldown.n` sessions counted on the XNYS calendar, the hit's own session being the first, so 1 is the rest of the session. In the quiet period looks are still read and the exit rule still runs, but nothing counts towards persistence and no hit is written. The wire re-arms when the exit has been observed and the quiet period has ended; looks from the first session after the quiet period count. The state row keeps the phase `firing` until the exit and then `cooling` until `cool_until`, so a hit costs state rows only for as long as it is quiet. A live wire's cooldown is the session and nothing else: its dedupe key already holds one hit per subject per session, so it writes no state row for the quiet period.
- **Budget**: `exp_week` is the wire's expected false alarms a week under its null; the member's armed wires sum to at most B.

## 8. Hits, ids and evidence

- `subject` is `n:<SYMBOL>`, `c:<SYMBOL>:<OCC>`, `s:<SECTOR>` or `u`; the prefix fixes the segments, and any segment containing `:` or `|` is rejected.
- `dedupe_key = <subject>:<session>[:<clause_hash>][:r<n>]`. The clause hash is on member keys only (an Adjust that changes the clauses re-fires; A to B to A does not re-fire A's events); house keys carry none (a house wire fires at most once per subject per session whatever the version). `:r<n>` is written only by an operator-approved rerun of withdrawn data. **The evaluator is not in the key**, so a retry or the nightly catch-up cannot double a hit.
- `hit_id` is the first 20 characters of the lowercase RFC 4648 base32 of SHA-256 over the UTF-8 text `wire_id|dedupe_key`.
- Insert: `INSERT … SELECT COALESCE(MAX(seq),0)+1 … WHERE NOT EXISTS (same wire_id and dedupe_key)`, conditional on the wire's current version being armed. A duplicate consumes no sequence number, so `seq` stays gapless per stream. Rows are frozen; bad data is withdrawn (`withdrawn_at`, `withdrawn_reason`), stays visible as withdrawn, and a corrected rerun writes `:r1` keys.
- Storage caps: 10 hits per member wire and 25 per member per session, 500 member hits per session overall, and 10 per nightly house wire and 20 per live house wire per session, all ranked by absolute statistic then subject. A house wire on a market-wide volatility night could otherwise write hundreds of rows. A hit over a cap is not written but is counted in the receipt's `hits_capped` and in the record's firings, and the inbox says how many more there were. The inbox groups more than 3 hits of one wire in one session when it reads them.
- Evidence (at most 4 KiB, frozen at fire time) holds each clause's value, threshold, relation and tick, the z, the baseline count and the floored flag where there is one, the source key and its as-of time, the registry and evaluator versions and the sentence. It never holds a price; the validator rejects the keys `px`, `ref_px`, `ret*`, `pnl*`, `price` and `iv`. Re-evaluating the frozen clause values reproduces the decision.
- Hit sentence: `<SYMBOL> <metric label> <verb> <value> (<threshold relation>) · <session label> · <HH:MM> TRT`, with the closed verbs crossed above, crossed below, entered, left, reached, appeared. An event hit adds "flagged by the data vendor". The forbidden copy words are `COPY_BANNED` in the contract and the forecast and modal lexicon of the Ask guard; an absent value is `— <reason>`.

## 9. Receipts, records and the reason vocabulary

- A receipt exists for every armed wire and every session or night (not for holidays). A session of a live wire with zero looks is `not_evaluated`. The half-hourly gap check writes `run_late` when no heartbeat has landed by 20:30 ET; a later successful run may upgrade it to `evaluated` until the next 09:30 ET open, after which it is final and never goes back.
- Wire-level reasons (`RECEIPT_REASONS`): run_failed, run_late, source_stale, source_missing, record_truncated, switch_off, switch_hold, metric_warming, metric_hidden, evaluator_error, registry_conflict, metrics_superseded, registry_version, no_looks. Per-name reasons (`ABSENT_REASONS`, in `absent_json`, at most 2 KiB): stale, missing, thin, warming, out_of_range, not_carded, not_in_live_set, record_truncated, event_inside_window, sector_coverage, short_history, unit_unverified. The vocabulary is enforced in `shared/ff-contract.js` and not by a SQL check, because it will grow and changing a CHECK means rebuilding the table.
- `record_truncated` covers `live:alerts`, which keeps 180 rows: at its cap with the oldest kept row newer than the previous tick's newest, events were dropped and the receipt says so.
- The digest is computed when read, with no model, in four quadrants: House·Nightly, House·Live, Yours·Nightly, Yours·Live. Each ends with its receipts line, for example "14 evaluated, 1 not evaluated: run_late".
- The export is CSV with the columns `EXPORT_COLUMNS`, times in ISO 8601 with `+03:00`, no price column, no note.

## 10. Health

States: **live** (session open, evaluator heartbeat no older than twice its cadence, nightly current), **resting** (session closed, nightly current), **degraded** (exactly one thing late), **down**, and **unknown**, shown as an em dash with the reason. Healthy is live and resting; only live breathes. Thresholds are `HEALTH_RULES` and the truth table is `tests/fixtures-ff-contract.json`: with a 300 s cadence, live up to 600 s, degraded to 900 s, down beyond; a nightly one session late is degraded, two is down; a recorded evaluator error is degraded; a missing input is unknown; an unreachable health endpoint is down on the client. The mark polls `/api/ff/health` every 60 s with an ETag while the tab is visible. Unread counts are cheap by construction (the stream's maximum `seq` minus the cursor, capped at "99+"); the inbox applies mutes and opt-outs when it reads.

## 11. Time

All stored times are UTC epoch milliseconds. Display is TRT (fixed UTC+3) with a session label from `data_as_of`, never `fired_at`, and the latency is shown separately: `16:42 TRT · open+12m`, `open+1h05m` after the first hour, `close` for a nightly, `pre-open` and `post-close` outside the session, each with the US session date. The US open is 16:30 TRT in summer time and 17:30 TRT in winter time, the regular close 23:00 or 00:00, an early close 20:00 or 21:00 TRT; boundaries come from the calendar (`shared/flows-time.js`, `shared/flows-freshness.js`), never from a fixed clock time. "First check at" is computed by lane A's `ff-session.js` under America/New_York rules and labelled "scheduled": nightly 17:30 ET after the next close (00:30 TRT under EDT, 01:30 under EST), live the next 5-minute or 15-minute tick not before 09:35 ET.

## 12. Routes, pages and errors

The router matches exact paths, so no route carries a path parameter: ids travel in the query or the body. `member_id` always comes from the session and never from the request; every mutating request checks the origin.

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/ff/health` | GET | flows | state, evaluator times, unread counts; ETag |
| `/api/ff/wires` | GET, POST, PATCH | flows | list or one by id; create; adjust or change status |
| `/api/ff/house` | GET, POST | flows | house wires with records; follow or leave one |
| `/api/ff/hits` | GET, POST | flows | list or one by id; mark or give feedback |
| `/api/ff/read` | POST | flows | advance the two inbox cursors |
| `/api/ff/preview` | POST | flows | would-hit now and coverage, never later prices |
| `/api/ff/receipts` | GET | flows | by wire, version or session |
| `/api/ff/records` | GET | flows | calibration, confirmation, latency, firings, coverage |
| `/api/ff/symbol` | GET | flows | own wires on one name (`?t=`) |
| `/api/ff/digest` | GET | flows | `?d=` |
| `/api/ff/export` | GET | flows | CSV of hits (`?from=&to=`) |
| `/api/ff/mute` | POST | flows | mute or unmute a name |
| `/api/ff/note` | PUT, DELETE | flows | Your note |
| `/api/ff/run` | POST | none | bearer only, internal: `{cadence, session}` |

Pages are canonical with their trailing slash, like every Flows page, and the bare form is a 308 row to it (all GET and HEAD, auth none, the sign-in page for an anonymous reader): `/flows/fire/`, `/flows/inbox/` (`?hit=<hit_id>`), `/flows/digest/`, `/flows/wires/` (`?wire=<wire_id>`). The router family id is `ff`. The sidebar mark links to `/flows/wires/`, beside the Inbox and Fire entries.

Error codes were added to `server/errors.js` in Phase 0 and are listed in `ERROR_CODES`: ff_off, ff_wire_not_found, ff_hit_not_found, ff_wire_limit, ff_symbol_outside_universe, ff_grammar_invalid, ff_grammar_precision, ff_metric_unavailable, ff_version_immutable, ff_house_readonly, ff_house_duplicate, ff_scope_reserved, ff_note_too_long, ff_cursor_invalid, ff_evaluator_unavailable, ff_export_range, ff_budget_exceeded.

## 13. Switches

`FF_MODE` (`wrangler.toml` vars): `on` runs normally, `shadow` evaluates and stores every hit as held and delivers nothing (how a house wire builds calibration before release), anything else or nothing is off and fails closed. `FF_ROUTE_WIRES`, `FF_ROUTE_INBOX`, `FF_ROUTE_FIRE` and `FF_ROUTE_EXPORT` are `on` or else off, read like the `FLOWS_*` variables; an off route answers `— unavailable: <reason>`, never an empty list. `ff_switches` rows are read once per run: the most restrictive matching row wins (off over hold over on) and no row means on. **off**: not evaluated, receipt reason `switch_off`. **hold**: evaluated, hits stored as `held`, counted in the record, never delivered when the hold is lifted. An unreadable switch table turns evaluation off while reading past hits keeps working.

## 14. The browser contract

- Attributes: `data-ff-page` (fire, inbox, digest, wires), `data-ff-hit`, `data-ff-wire`, `data-ff-state` (live, resting, degraded, down, unknown), `data-ff-absent="<reason>"`, `data-ff-slot` (`mark` in the sidebar footer, filled by lane F; `name-panel` on the ticker page, filled by lane E; `history` reserved for the phase 2 preview strip; `record` reserved for the record).
- Tokens (`assets/css/flows-ff-tokens.css`, lane U): `--ff-live`, `--ff-resting`, `--ff-degraded`, `--ff-down`, `--ff-unknown`, `--ff-hit`, `--ff-absent`, `--ff-ink`, `--ff-ink-dim`, `--ff-rule`, `--ff-surface`, each mapped onto the existing global tokens; no colour literal anywhere. New classes use the prefix `ffx-`; the existing `.ff-brand` and `.ff-word` rules are lane F's to extend.
- Events on `document`: `ff:unread` `{house, member, total}`, `ff:health` `{state, evaluator}`, `ff:read` `{stream, seq}`. Lane F is the only poller; D and E listen.
- Browser properties on the existing global, never a new global: `FlowsUI.ffKernel`, `ffClient`, `ffMark`, `ffFire`, `ffInbox`, `ffWires`, `ffDigest`, `ffNamePanel`. Scripts are strict IIFEs and import nothing; a duration, a time or a session label is never computed in the browser, the API returns display-ready strings.
- The ring breathes on a 4.2 s ease-in-out cycle only when `data-ff-state="live"` and never under `prefers-reduced-motion`.
- Every page fits without page scroll or clipped text at 1920×1080, 1920×940, 1440×820, 1024×768, 1024×660, 390×844 and 390×664, with `100svh` on a phone and a truncation that carries an ellipsis and a `title`.

## 15. Lanes and the files they own

Lanes only create new files named below; test artifacts are named by the lane's prefix from the table below (`ff-a-` for lane A) so that no two lanes can collide: `tests/<prefix>*.mjs`, `tests/lib/<prefix>*.mjs`, `tests/fixtures-<prefix>*.json`, `tests/suites/<prefix>*.json`, `docs/ff/<prefix>*.md`, for example `tests/ff-a-grammar.mjs` and `tests/fixtures-ff-a-grammar.json`. `tests/ff-contract.mjs` fails a pull request that adds a file in the Fire & Forget namespace that no lane owns, and any FF source file that imports a forbidden module or calls the vendor.

| Lane | Owns | Prefix |
|---|---|---|
| Lane A, core pure leaves | `shared/ff-grammar.js`, `ff-stats.js` (the only robust z, t tail, BH, max-p), `ff-engine.js` (pure: snapshot, wires, state to hits, receipts, state), `ff-sentence.js`, `ff-session.js`, `ff-ids.js` (hit id, clause hash through `crypto.subtle`), `ff-house.js` | `ff-a-` |
| Lane B, store and API | `server/ff-store.js`, `ff-eval.js`, `ff-health.js`, `ff-preview.js`, `ff-records.js`, `ff-digest.js`, `ff-export.js`, `server/routes/flows-ff.js`, `tests/lib/d1-budget-ff.mjs` | `ff-b-` |
| Lane C, legs | `scripts/flows-legs/ff-metrics.mjs`, `ff-carry.mjs`, `ff-calibrate.mjs`, `scripts/flows-nightly/sections/ff.mjs`, `.github/workflows/flows-ff-calibrate.yml` | `ff-c-` |
| Lane U, UI kernel | `assets/css/flows-ff-tokens.css`, `assets/js/flows-ff-kernel.js` (fit, hooks), `assets/js/flows-ff-client.js` (`get`, `post`, error-code mapping) | `ff-u-` |
| Lane D, Fire page | `assets/js/flows-ff-fire.js`, `flows-ff-composer.js`, `flows-ff-preview.js`, `assets/css/flows-ff-fire.css`, `shared/ff-pages-fire.js` | `ff-d-` |
| Lane E, Inbox, Digest, Wires, name panel | `assets/js/flows-ff-inbox.js`, `flows-ff-evidence.js`, `flows-ff-digest.js`, `flows-ff-wires.js`, `flows-ff-name-panel.js`, `assets/css/flows-ff-inbox.css`, `shared/ff-pages-inbox.js` | `ff-e-` |
| Lane F, mark | `assets/js/flows-ff-mark.js`, `assets/css/flows-ff-mark.css` | `ff-f-` |
| Lane H, acceptance, built by a different agent from A to F | `tests/ff-accept-*.mjs`, `tests/lib/ff-accept-*.mjs`, `tests/fixtures-ff-accept-*.json`, `tests/suites/ff-accept-*.json` | `ff-accept-` |
| Lane G, integration, serial, after A to F | the shared files in `SHARED_EDITS`: `worker.js`, `server/router.js`, `shared/flows-pages.js`, `server/routes/flows-pages.js`, `shared/flows-products.js`, `server/store.js`, `shared/flows-ready.js`, `scripts/flows-pipeline.mjs`, `scripts/flows-nightly/stages.mjs`, `scripts/flows-legs/flow.mjs`, `shared/flows-positioning.js`, `wrangler.toml`, `wrangler.staging.toml`, `assets/js/nav.js`, `assets/css/flows.css`, `assets/version.txt`, `tests/lib/d1-budget.mjs`, `tests/flows-weight.mjs`, `tests/fixtures-pipeline-golden.json`, `tests/flows-registry-contract.mjs`, `DEPLOY.md` | none |

Sequence: Phase 0 (this) first; Lane A and Lane U next and small; then B, C, D, E, F and H in parallel, each coding against the contract and a test double; then G serially (the sidebar slot, the name-panel slot, the router family, the nav and About copy, the product registrations, the pipeline stage, the golden manifest, the cron hook, the one `ctx.waitUntil`, the weight ceilings, the staging file). G's gate: every acceptance test green and every planted wrong build red. G is budgeted at about 60 changed lines in shared files and a live-loop duration unchanged within 5%.

Generated files (`AGENTS.md`, `docs/index.md`) are regenerated by `node scripts/gen-docs.mjs` and never hand-merged; client lanes bump the asset version and are merged as a train, with `node scripts/bump-assets.mjs` and `--check` run once for the batch. `docs/modules.json` carries optional rows for every path above, so a lane adding its own files needs no edit there.

**Registration of the payloads** (`ff-metrics`, `ff-carry`, `ff-calibration`, each at most 96 KiB, non-gating for readiness) belongs to lane G together with the lane that writes them, because the registry suite requires the dry-run emit to write every registered key; the shapes and caps are in `PAYLOADS`.

## 16. Acceptance tests

Each has an independent oracle and a planted wrong build that must fail it; CI fails if a planted build passes. Lane H builds them.

- **H1** Robust z boundary. Median $1.00M, MAD $0.10M: x = $1.4447M gives z = 2.99946, shown 3.00, fires; x = $1.4439M gives 2.99406, shown 2.99, silent. Planted: compares the raw z.
- **H2** Flat baseline. All-zero baseline: x = 0 gives z = 0.00; x = $5M with a $100k floor gives 50.00, fires and says "floored". Planted: no floor (infinity or NaN).
- **H3** Missing baseline. 11 of 20 sessions is an em dash with "baseline 11/20 sessions", and a missed night leaves a count of 14 unknown. Planted: pads with zeros.
- **H4** Edge trigger. True for five looks is one hit; a dip inside the hysteresis band does not re-arm; a dip below it does; unknown freezes the phase. Planted: level-triggered.
- **H5** Dedupe. The same tick run twice, a nightly retry, and the catch-up pass over the same window each give one hit; an Adjust that changes the clauses and fires again in one session gives two. Planted: puts the evaluator name in the key.
- **H6** Tenant isolation. Member A cannot list, retire, count or read B's wires, hits, notes or marks; the per-name panel excludes B. Planted: reads the member from the query string.
- **H7** DST. At 17:00 TRT on 2026-03-06 (winter, open 17:30) the mark is resting; at 17:00 TRT on 2026-03-09 (summer, open since 16:30) it is live. Planted: hard-codes the open at 16:30.
- **H8** Mark animation. A stale heartbeat gives `data-ff-state="degraded"` and no running animation; reduced motion gives none in any state. Planted: breathes on page load.
- **H9** Zero vendor spend. With `fetch` stubbed the evaluators make no call, and no FF file imports a vendor client or a model module. Planted: fetches a missing name.
- **H10** No scroll. All seven viewports on every page, seeded with 200 hits, 8-clause wires and 25-name scopes: no page scroll, no overflowing scroll container, every truncation has an ellipsis and a title. Planted: renders every row.
- **H11** Premium Desk parity, where the desk's functions exist. Not used while T09 is hidden; the oracle waits for the unlock.
- **H12** Versioning. After an Adjust, an old hit renders the old sentence; retiring and restoring keeps the id and the version. Planted: renders the current version.
- **H13** Absent figures. A pending confirmation is an em dash with its reason ("unobservable: not among the ten largest changes"); the DOM never holds a zero for an absent figure; no price appears anywhere. Planted: defaults to 0.
- **H14** Loop isolation. If the engine throws, the live write still lands, the run row records the error and the mark goes degraded.
- **H15** Lint. No comments, no colour literal in FF files, none of `COPY_BANNED` in copy, every rendered time ends in TRT, and fixture tickers are `SY<letter><3 digits>` and absent from the universe file.

## 17. Deferred and forbidden

Deferred: evaluation on every real-time message; email, Slack, Symphony, webhooks, mobile push; team wires and sign-on; AI-written digest prose; an AI that drafts a wire (it may only propose a body the member confirms, inside the neuron cap); intraday Shiryaev–Roberts detectors (after 60 sessions of `ff_arch`); history preview and the noise budget strip (phase 2); the `watchlist` scope (after the member-state lane).

Forbidden: counts that aggregate wires across members; a free-form expression language; "bullish" or "bearish" labels on hits; a clock time without TRT; a price outcome of any kind; a vendor call from evaluation; the model in the evaluation path.

**Licensing blocker.** Selling vendor-derived data commercially to funds most likely needs a redistribution agreement. This has not been checked against the vendor's terms and is a probable blocker: the owner settles it before any sales demonstration, and until then anything that leaves Flows (export, later webhooks and feeds) carries Flows-computed metrics only.

## 18. Release

1. Merge in the sequence above. The migration is applied by hand, by name, once: `./tests/node_modules/.bin/wrangler d1 execute iewt --remote --file=./migrations/0026_ff.sql`, after migration 0025 if it has landed (they are independent). The Worker's first-use path covers a database that predates it.
2. `FF_MODE` ships `shadow` first; flip it to `on` when the house wires' record shows calibration inside the budget.
3. Verify the live headers after every deploy as for any page.

## 19. Where this differs from the consultations

- The first architecture answer put nightly evaluation in an Actions leg; one Phase 0 answer repeated that. It is rejected: the repository is public and runner logs are public, so a member's wire must not pass through a runner. The Worker evaluates, the leg is member-free (two of three Phase 0 answers and the first architecture answer agree).
- One answer kept a baseline table written by the Worker and seeded from `hist`; the other two removed it. It is removed: `hist` already holds 252 dated sessions in the leg's memory, a table would hold 136,000 numbers the Worker cannot derive, and the seed has no transport.
- Live z forms were proposed with a conservative one-sided argument; they are removed for version 1 because intraday flow is U-shaped and the argument assumes independent increments that the data does not give.
- Blind notices as hit rows were dropped in favour of receipts, as the lead's addendum requires, so they do not inflate firing counts or use sequence numbers.
- `ff_outcome` became `ff_confirm` and lost every price column; `ff_baseline` and `ff_heartbeat` do not exist (`ff_run` is the heartbeat and the lease); `ff_wire_version` was kept although one answer inlined the body into the wire, because H12 needs the old sentence and the record is keyed by version.
- Limits follow the owner-approved numbers (8 clauses, 50 wires, 5 universe wires) with the later refinements (at most 2 clauses per metric, 5 live wires, the budget sum).
- A fourth consultation priced the first draft's rows and found them undercounted (a live run row cost four writes, not two; a record for two periods two, not one). The ruling, applied here: `ff_hit`, `ff_receipt` and `ff_wire_version` are `WITHOUT ROWID`; one `ff_run` row per kind and session with no secondary index; no `ff_wire_by_layer`; member records for the period `all` only (a week-close write would only move the breach to Friday); caps on house hits; and the shared guard stays at 0.30 in this change, to be reworked as per-lane allocations in its own pull request.
- None of the three Phase 0 answers carried the cooldown of the product ruling (quiet for the rest of the session on a live wire and 5 sessions on a nightly wire after a hit, re-arming on exit). It is restored in the AST as a member-settable field with those defaults and in `ff_state` as the `cooling` phase; the one hit per key per session of the dedupe rule stays as the floor.
- Ids use the descriptive grammar, not the short ids of one answer, and house wire T07 is two wires.
- Path parameters, `Flows.ff.*` globals and a fixture prefix of `ZZ` were all proposed and do not fit this repository (exact-path router, no new globals, `SY<letter><3 digits>` fixtures).
- The consultation asked Phase 0 to register `ff-metrics` and `ff-calibration` as products. That cannot be done without a producer, because the registry suite requires the dry-run emit to write every registered key; it moves to lane G with lane C.
