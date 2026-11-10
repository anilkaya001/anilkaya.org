=== docs/architecture/no-nightly.md ===
# Flows: no-nightly architecture

All times are TRT. US regular session: 16:30–23:00 TRT while the US is on daylight time, 17:30–00:00 TRT otherwise. Turkey has no DST, so the offset moves twice a year. Session phases come from the feed's market calendar, never from fixed clock times: `pre` (feed extended hours open until regular open), `regular`, `post`, `closed`, `halfday`.

## 0. Runtimes at a glance

| Runtime | Role | Cadence |
|---|---|---|
| DO `pacer` (singleton, SQLite storage) | scheduler, token bucket for the feed's minute line, leases, breakers, freshness ledger | alarm 5 s regular, 15 s pre/post, 60 s closed |
| DO `rail` (existing) | L0 polling and WebSocket fan-out; new topics `pulse`, `ff` | 5–15 s by topic, as today |
| Queue `q-fetch` → consumer `fetch` | feed calls, engines (pricing, GARCH), card assembly, door write | pushed by pacer |
| Queue `q-change` → consumer `ff` | Fire & Forget evaluation | batch ≤100 msgs or 1 s |
| Queues `q-fetch-dlq`, `q-change-dlq` → consumer `quarantine` | poison isolation | on DLQ delivery |
| Worker cron `* * * * *` | watchdog only: `pacer.ensureAlarm()`, `rail.ensureAlarm()`, close the `rt_pulse` minute row, run the outbox sweeper | 60 s |
| GitHub Actions | nothing scheduled except an external probe of `/api/pulse` every 15 min; `workflow_dispatch` for manual backfill or rebuild | — |

Both 5-minute crons, the Tier 2 Actions loop and the nightly workflow schedule go away. The deepening rotation is no longer a separate mechanism: the scheduler's score handles it.

## 1. Core loop

### 1.1 Data classes

Each per-name deep fetch splits into **intraday parts** (≈14 calls: quote, chain snapshot, IV surface, greeks exposure, flow, net premium, off-exchange prints) and **daily parts** (≈25 calls: open interest, candles, financials, earnings, ownership).

| Class | Content | Runtime | Target TTL regular | pre/post | closed |
|---|---|---|---|---|---|
| L0 live | px, flow alerts, gamma, market tide, news | rail | 5–15 s | 15–30 s | idle; heartbeat only |
| L1 market-wide | strips, alerts, breadth, regime-lite | pacer → q-fetch | 60 s | 5 min | 60 min |
| L2 focus/held | intraday parts of focus, held and viewed names | pacer → q-fetch | 60 s | 5 min | 60 min |
| L3 deep rolling | intraday parts of the deep set (163 core, grows to the universe) | pacer → q-fetch | 10 min | 30 min | 6 h |
| L4 universe light | 3-call refresh for all 856 names | pacer → q-fetch | 15 min | 60 min | 6 h |
| L5 daily | daily parts, every name | pacer → q-fetch | once per feed date, triggered by a watermark | same | same |
| L6 derived globals | board, regime, events | `fetch` consumer, triggered by change | debounce 60 s / 5 min / 30 min | same | same |

### 1.2 Task model (pacer SQLite `sched_task`)

`task_key` (`{sym}:{part}` or `g:{name}`), `class`, `ttl_s`, `cost_calls`, `last_ok_at`, `last_try_at`, `source_ts`, `fails`, `quarantined_until`, `attention`, `attn_at`, `lease_id`, `lease_until`, `fence`.

### 1.3 Score

```
U = min(age / ttl, 4) ^ 1.5                    age = now − last_ok_at; never fetched ⇒ U = 4^1.5
A = max(held, focus, 1 − e^(−viewers/3)) · 2^(−(now − attn_at)/15 min)
V = min(|r_5m| / σ_5m(GARCH), 2) / 2
W = min(armed_wires_on_task_metrics / 5, 1)
E = 1 if earnings/event within 2 sessions, a halt, or a flow alert on the name in the last 15 min; else 0
H = 0 if quarantined or the class breaker is open; else 0.5^fails

score = U · (1 + 2A + 1.5V + W + E) · H / cost_calls
```

Selection runs on every tick. A task is eligible when U ≥ 1. A task with U ≥ 0.5 becomes eligible only from spare budget. Tasks are picked greedily by score inside each class budget, then a lease is granted (`lease_until = now + 90 s`, `fence = ++epoch`) and the tasks go to `q-fetch` with `sendBatch`, one message per name bundle.

### 1.4 Minute-line budget (500 calls/min working line; dispatch cap 450, reserve 50)

| Phase | L0+L1 | L2 | L3+L4 | L5 | Reserve (retry/backfill) |
|---|---|---|---|---|---|
| regular | 100 | 110 | 200 | 40 | 50 |
| pre (daily watermark landed) | 30 | 20 | 50 | 350 | 50 |
| post | 40 | 30 | 180 | 200 | 50 |
| closed | 10 | 20 | 120 | 300 | 50 |

- Spare budget spills in this order: reserve → L3, L2 → L3, L3 → L5. Under an attention spike, L2 may borrow up to 60 from L3. L0 is never borrowed from.
- The rail holds a standing reservation of 70/min inside L0+L1 and reports its actual usage to pacer each minute. Pacer's ledger is the single source of truth for calls spent.
- Capacity in regular hours:
  - L3: 200/14 ≈ 14 deep names/min, so the 163-name core rotates every ≈12 min.
  - L4: all 856 names rotate every ≈20 min, using L3 spill.
  - L5: 856 × 25 = 21,400 calls. At 300–350/min that is 61–71 min, inside the closed/pre window.
  - Full universe deep (856 × 39 = 33,384 calls) is filled within one closed period. The deep set becomes the universe within a day.

### 1.5 Consumer `fetch`

- `max_batch_size` is 4 for L3/L5 and 8 for L1/L2. `limits.cpu_ms = 30000`. Engine CPU is ≤1,000 ms per name, so a batch uses ≤8 s.
- Steps per name:
  1. Call the feed.
  2. Run the engines on the intraday parts plus the cached daily parts (`part:d:{sym}`).
  3. Assemble `card:{sym}` and `card-x:{sym}`.
  4. Write through the door with CAS (§3).
  5. Report completion to pacer, one RPC per batch: `{task_key, ok, calls_used, source_ts, err_class}`.

## 2. Replacing the nightly

Definition: the **session boundary** for `session_date = D` (US trading date) fires when both of these are true:

1. The clock has passed regular close + 20 min (23:20 TRT on US daylight time, 00:20 TRT otherwise; half-days come from the calendar).
2. The feed's final daily candle for the sentinel set (SPY, QQQ, IWM) is present.

Pacer emits a `boundary:{D}` task exactly once. A write-once archive is a key `…:{D}` written with `base_version = null`, which means insert-only. A second write returns 409 and is counted as an error.

| Nightly duty | New cadence | Trigger | Write-once at boundary |
|---|---|---|---|
| universe build | additions intraday; removals only at the boundary | L4 screen, plus rail flow alerts promoting a name immediately (A = 1) | `universe:{D}` snapshot; the live `universe` key is CAS-updated |
| cards (163 deep) | L2 60 s / L3 10 min / closed 6 h | scheduler score | no (live key); `card:{sym}@close:{D}` snapshot taken at the boundary |
| card-x | with its card, same task | card task | `card-x:{sym}@close:{D}` |
| hist | one daily bar appended per name | L5 commit of the final candle after the boundary | yes, `hist:{sym}` row for D, insert-only by `(sym, D)` |
| board | recomputed on change | ≥1 card change, debounced 60 s | `board:{D}` at the boundary |
| regime | recomputed | L1 change, debounced 5 min | `regime:{D}` at the boundary |
| events | recomputed | L5 earnings/calendar change, plus every 30 min | `events:{D}` at the boundary |
| ideas archive | live ideas move with cards | card changes | `ideas:{D}` frozen at the boundary; not reconstructable later |
| calibration | scored when an outcome horizon's candle lands | L5 commit of candle D+h | `calib:{D_idea}:{h}` insert-only |
| record | append-only ledger | after `calib` writes | rows `(idea_id, h)` insert-only |
| deepening rotation | removed | U = 4 for never-fetched names | — |
| daily inputs (OI, candles, financials, earnings, ownership) | once per feed date | watermark: pacer probes the sentinel daily part every 10 min from boundary + 2 h until the feed's date advances; it is detected, never assumed | `part:d:{sym}` versioned by feed date |

## 3. Self-healing

### 3.1 Door CAS tuple
`(key, base_version, content_hash, fence, source_ts)`

- `content_hash` is sha-256 over canonical JSON, excluding `fetched_at` and all other volatile fields.
- Rules, in order:
  1. `fence < keys.fence` → 409 `stale_lease`. The task is dropped.
  2. `base_version ≠ keys.version` → 409 `conflict`. The consumer re-reads and recomputes, at most 2 times, then marks `fails++`.
  3. `content_hash = keys.hash` → 200 `unchanged`. D1 is not written; pacer gets `last_ok_at`. Freshness lives in pacer, not D1.
  4. Otherwise one D1 `batch()` (transaction) does the following: update the key with `version+1, hash, fence, source_ts, committed_at`, insert into `rt_outbox`, then send to `q-change`, then mark the outbox row sent.
- Payloads over 100 KiB are deterministically trimmed per schema (arrays capped in the documented order). If still too large, the result is `err_class = oversize`, which goes to quarantine.

### 3.2 D1 tables (new)

```
rt_outbox(id PK, key, version, hash, metrics_json, committed_at, sent_at)
rt_watermark(stream PK, session_date, high_seq, high_source_ts, updated_at)
rt_gap(id PK, stream, from_mark, to_mark, detected_at, filled_at, status, reason)
rt_quarantine(task_key PK, err_class, first_seen, last_seen, attempts, sample_error, release_at)
rt_breaker(name PK, state, opened_at, half_open_at, reason, trips_today)
rt_pulse(minute_ts PK, phase, beats, writes, unchanged, calls_used, calls_cap, in_flight, change_lag_hist, lag_hist_l0, lag_hist_l1, lag_hist_l2, lag_hist_l3, lag_hist_l5, fresh_json, hits, errors, quarantined, breakers_open, note)
rt_switch(name PK, value, set_at, set_by)
```

Existing door key table gains `version INTEGER, hash TEXT, fence INTEGER, source_ts INTEGER, committed_at INTEGER`. All are nullable; legacy rows are treated as version 0.

### 3.3 Mechanisms

- **Leases:** pacer grants `lease_until = now + 90 s` with a monotonic `fence`. When a lease expires with no report, `fails++` and the task is re-eligible. The fence stops a late zombie write from overwriting a newer one.
- **Watermarks:**
  - The rail updates `rt_watermark('rail:{topic}')` with its seq every 60 s.
  - Each class has `rt_watermark('class:{c}')` with `high_source_ts`.
  - L5 has `rt_watermark('daily:{feed_date}')` with done/total counts.
- **Outbox sweeper** (1-min cron): any `rt_outbox` row with `sent_at IS NULL AND committed_at < now − 10 s` is re-sent. Rows older than 24 h with `sent_at` set are deleted.
- **Gap detection and backfill:**
  - Rail seq jump → `rt_gap(stream='rail:{topic}')` → resync snapshot (exists today).
  - Any task with age > 3·ttl → `rt_gap(stream='task:{task_key}')`, and the task gets reserve budget.
  - At each boundary, a ledger check covers the last 30 `session_date`s for every write-once key family. If one is missing and reconstructable (hist, calib, record, board/regime from close snapshots), a backfill task goes into the reserve budget.
  - If it is not reconstructable (`ideas:{D}`, `card:@close:{D}`), a tombstone `{status:"missing", reason}` is written and rendered as "— not captured: system was down at close on D".
- **Poison quarantine:** a message goes to the DLQ when either:
  - 3 consecutive failures have the same `err_class` in `{parse, schema, engine, oversize, conflict_loop}`, or
  - queue `max_retries = 3` is exhausted.

  The `quarantine` consumer upserts `rt_quarantine` with `release_at = now + 30 min · 2^(attempts−1)`, capped at 24 h, and pacer sets H = 0. The UI shows the name's figures as "— held back: the feed returned unreadable data at 14:02 TRT".
- **Backpressure (AIMD in pacer):**
  - `in_flight` = leases granted − reports − expiries.
  - If `in_flight > 2 × per-tick dispatch`, or the `q-change` lag p95 is over 10 s, the L3/L4/L5 budgets are multiplied by 0.5.
  - Otherwise they grow by 10% per minute, up to the table values.
  - L0/L2 are never throttled by backpressure.
- **Circuit breakers:**
  - `feed-rate`: any 429 opens the breaker for `retry-after` or 60 s. L3–L5 freeze and L0+L1+L2 drop to 50%. Half-open admits 10 calls.
  - `feed-err`: 5xx/timeouts above 20% over 60 s opens it, with backoff 60 s → 120 s → … → 15 min. Half-open probes 5 calls.
  - `door`: D1 errors above 5% over 60 s opens it. Fetching pauses; commits are not buffered.
  - `ai`: when the daily neuron counter reaches 30,000, summaries stop and show "— summary paused: daily limit reached, resumes 00:00 TRT".
  - `d1-writes`: rows_written today above 1.2M stops L3–L5 writes; only L0–L2 commit.
- **Degraded modes, shown honestly:** each layer's state comes from freshness and the breakers (live/resting/degraded/down/unknown, same vocabulary as Fire & Forget). Stale values stay visible with their age. Nothing is filled in by interpolation.

## 4. Fire & Forget as the backbone

### 4.1 Event path

1. A door commit, or a rail frame with a hash change on a watched metric, produces `rt_outbox` → `q-change` message `{key, version, prev_version, metrics:{…}, source_ts, committed_at}` (≤8 KiB).
2. The rail fetches `ff_meta.watched_metrics` every 60 s and only enqueues those metrics, one message per frame tick.
3. Consumer `ff` uses `max_batch_size 100`, `max_batch_timeout 1 s`, `max_concurrency 2`. Per batch:
   1. Load the wire index (metric → wires), cached in module scope and keyed by `ff_meta.wires_version`.
   2. Group events by key and process versions in ascending order. Events with `version ≤ ff_wire_state.last_version` are skipped, so out-of-order and replayed events are no-ops. Each version is evaluated, so intermediate crossings are not lost.
   3. Read the other referenced metrics with one `SELECT … WHERE key IN (…)`.
   4. Run the pure engine `evaluate(snapshot, wires) → {hits, receipts}`.
   5. `INSERT OR IGNORE INTO ff_hits` and update `ff_wire_state(wire_id, subject, last_value, last_version, armed, health)` in one D1 batch.
   6. Hits actually inserted (`changes()`) go to `rail.publish('ff', hits)` and become WebSocket frames with per-topic seq.
4. The `nightly` cadence of `ff-eval.js` becomes `session`. Daily-metric wires fire when L5 parts commit pre-market. The `live` cadence is this path.

### 4.2 Idempotency

- `hit_id = sha256(wire_id | wire_rev | subject | trigger_key@version | edge)`. Edge-triggered: false → true, re-armed on true → false.
- Replay, DLQ re-drive or duplicate delivery produce the same ids, and `INSERT OR IGNORE` swallows them.
- Publishing happens only after commit. If the publish fails, clients recover through `/api/ff/hits?since_seq=` on resync.

### 4.3 Latency and wire health

- Latency targets: commit → hit on socket p95 ≤ 5 s, p99 ≤ 10 s. Feed observation → hit for L0 wires: p95 ≤ 12 s.
- Wire health comes from input freshness against the SLO of each input's layer:
  - `live`: within SLO.
  - `resting`: phase is closed and inputs are legitimately static.
  - `degraded`: between 1× and 3× SLO.
  - `down`: over 3× SLO, or a breaker is open on an input class.
  - `unknown`: no input observed yet.

## 5. "Organism breathing" surface

### 5.1 Single signal: Pulse

- A beat is one committed `(key, version)` whose content hash changed.
- The display is beats/min over the last full minute, plus a 60-cell strip, one cell per second, lit only if that second had ≥1 commit, plus the time since the last beat.
- Source: the rail `pulse` topic, one frame every 5 s with counts per second taken from commits; `rt_pulse` for history.
- A poll that returns identical data is not a beat. It only refreshes freshness.

### 5.2 Per-layer rows (L0, L1, L2, L3, L4, L5, Fire & Forget)

Each row shows: state word, freshness p95 against its SLO, last beat age, beats/min.

### 5.3 System row

- Feed line: `calls_used / 500` per minute.
- In-flight tasks.
- Change lag p50/p95/p99.
- Hits/min.
- Quarantined count.
- Open breakers, by name and reason.

### 5.4 Honesty rules

- No animation without a received frame. CSS transitions are triggered only by frame arrival. Colours use the existing status custom properties only.
- Percentiles come from fixed log buckets (250 ms · 2^n, 15 buckets) and show the bucket upper bound, with no smoothing past 1 minute.
- Socket loss freezes the surface: "— not connected since 14:02:11 TRT". Values older than 2 frames grey out.
- A missing minute row shows "— no measurement: scheduler restarted 14:03 TRT", not 0.
- Closed phase: "Resting — market closed, next session opens 16:30 TRT". During the closed phase, beats come honestly from L5/L3.

## 6. Latency SLOs (regular phase unless stated)

| Layer | Metric | p95 | p99 | Measured |
|---|---|---|---|---|
| L0 px/flow (5 s) | feed source_ts → client receive | 8 s | 15 s | frame carries source_ts; client acks a sampled frame once per minute; rail buckets it |
| L0 gamma/tide/news (15 s) | same | 20 s | 30 s | same |
| L1 | key age at read | 75 s | 120 s | pacer freshness ledger, sampled every minute |
| L2 | key age | 90 s | 150 s | same |
| L3 core 163 | key age | 15 min | 25 min | same |
| L3 rest of universe / L4 | key age | 60 min / 20 min | 90 / 30 min | same |
| L5 | universe on the current feed date | 100% by open − 15 min (16:15 / 17:15 TRT) | — | `rt_watermark('daily:{date}')` done/total |
| Fire & Forget | commit → socket | 5 s | 10 s | `committed_at` vs rail publish_ts, plus client ack |
| Archives | boundary → all write-once keys present | 45 min | 90 min | ledger check |
| Pulse availability | session minutes with an `rt_pulse` row and pacer tick < 15 s old | ≥ 99.5% | — | `rt_pulse` count; external Actions probe every 15 min |

SLO burn is computed per session from `rt_pulse` and shown at `/api/pulse?view=slo`.

## 7. Migration (8 PRs; each behind an `rt_switch` row, read with a 30 s cache)

1. **Pulse: breathe first.** Switch `PULSE`.
   - Scope:
     - `rt_pulse` and `rt_switch` tables.
     - Door and rail count commits and hash changes they already do.
     - The rail emits a `pulse` topic every 5 s.
     - A 1-min cron closes minute rows.
     - `/api/pulse`.
     - The UI pulse strip and per-layer rows from existing keys' `committed_at`.
   - Files:
     - `server/migrations` (`rt_pulse`, `rt_switch`)
     - `worker/rail` (pulse topic)
     - `worker/index.js` (cron `* * * * *`, route)
     - `web/js/pulse.js`
     - `web/css/pulse.css`
   - Rollback: `PULSE=off` hides the strip and turns the cron into a no-op.
2. **Door CAS and outbox.** Switch `DOOR_CAS`.
   - Scope: versioned columns, CAS rules, `rt_outbox`, the `q-change` producer and the outbox sweeper. No consumer yet: messages are acked and counted.
   - Files: `server/migrations`, `worker/door`, `wrangler` (queue bindings).
   - Rollback: off restores legacy last-write-wins. The columns are nullable.
3. **Mount Fire & Forget live.** Switches `FF_MOUNT` (API) and `FF_LIVE` (consumer).
   - Scope: mount `/api/ff/*`, add the `ff` consumer around `server/ff-eval.js`, `ff_wire_state` version guard, the rail `ff` topic and the UI hit feed.
   - Files: `worker/index.js`, `worker/consumers/ff.js`, `server/ff-eval.js`, `web/js/ff.js`.
   - Rollback: `FF_LIVE=off` acks and drops events; the nightly ff cadence is unchanged.
4. **Pacer in shadow.** Switch `PACER_MODE=off|shadow|enforce`.
   - Scope:
     - Pacer DO with token bucket, score, leases, breakers and `rt_breaker`.
     - The rail and Tier 1 report calls to it.
     - In shadow it computes schedules and budgets and logs to `rt_pulse.note`, but enforces nothing.
   - Files: `worker/do/pacer.js`, `worker/rail`, `worker/tier1`, `server/migrations`.
   - Rollback: off.
5. **L1/L2 via queue, quarantine.** Switch `LIVE_FROM_PACER`.
   - Scope:
     - The `q-fetch` consumer for L1 and L2 at 60 s, DLQ, the `quarantine` consumer and `rt_quarantine`.
     - The 5-min Tier 1 cron and focus tick become no-ops when the switch is on.
     - The Tier 2 Actions loop exits on the switch.
   - Files: `worker/consumers/fetch.js`, `worker/consumers/quarantine.js`, `worker/index.js`, `.github/workflows/tier2.yml`, `wrangler`.
   - Rollback: off resumes both crons and Tier 2.
6. **Parts split and rolling deep.** Switch `DEEP_ROLLING`.
   - Scope:
     - Engines ported to the Worker (pure ESM), `part:d:{sym}`, L3/L4/L5 classes and the daily watermark probe.
     - The nightly still runs but skips names whose card `committed_at` is newer than 12 h.
     - Shadow diff: the nightly writes `diff:{sym}` instead of overwriting while the switch is on.
   - Files: `server/engines/*`, `worker/consumers/fetch.js`, `worker/do/pacer.js`, `.github/workflows/nightly.yml`.
   - Rollback: off; the nightly writes everything.
7. **Session boundary and archives.** Switch `BOUNDARY_ARCHIVES`.
   - Scope: boundary detection from the feed calendar and sentinel candle; write-once hist, board, regime, events, ideas, calib and record; incremental L6 globals.
   - While on, the nightly archive steps become verifiers (compare, write nothing) for 10 sessions.
   - Files: `worker/do/pacer.js`, `worker/archives.js`, `.github/workflows/nightly.yml`.
   - Rollback: off; the nightly writes archives again. Boundary keys are left in place.
8. **Gaps, AIMD, honest degradation, retire the nightly.** Switch `NIGHTLY_OFF`.
   - Scope:
     - `rt_gap`, the ledger check, backfill and tombstones.
     - AIMD backpressure and the `d1-writes`/`ai` breakers.
     - Degraded copy in the UI and the SLO view.
     - The nightly schedule job exits immediately when `NIGHTLY_OFF=on`; `workflow_dispatch` stays.
     - The Actions external probe is added.
   - Files: `worker/do/pacer.js`, `worker/archives.js`, `web/js/pulse.js`, `.github/workflows/nightly.yml`, `.github/workflows/probe.yml`.
   - Rollback: `NIGHTLY_OFF