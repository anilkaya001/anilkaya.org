# Fire & Forget lane B: the store and the API

Lane B is the member-facing half of Fire & Forget on the Worker: the D1 store, the health view, the preview shaping, the digest and the export, and the fourteen rows of the `/api/ff/*` route family. It reads and writes the sixteen `ff_` tables of `migrations/0026_ff.sql` and nothing else of the site's data. It makes no vendor call, imports no model module and calls no `fetch`.

## Files

| File | What it is |
|---|---|
| `server/ff-store.js` | The only module that holds `ff_` SQL. `SQL` is a registry of statements, each declared with the member-scoped names it binds; `createFfStore({ ensureFf })` returns the I/O methods; `bootstrapFf(db)` is the first-use DDL (`FF_SCHEMA_SQL` from `shared/ff-schema.js`). Pure helpers: `validateCompiled`, `validateHit`, `evidenceProblems`, `encodeCursor`, `decodeCursor`, `mergeStreams`, `namesOf`. |
| `server/ff-health.js` | Health states (live, resting, degraded, down, unknown) from the contract's `HEALTH_RULES`, the shared 30 s cache, the weak ETag, the route availability view, `dueNightly`, `unreadView`. |
| `server/ff-preview.js` | `previewView`: shapes the engine's dry run for the composer, with the first check in TRT and the absent-with-reason law. |
| `server/ff-records.js` | The view shapes: wires, versions, house wires, hits, receipts, records, the symbol panel, `limitsView`, `absent`. |
| `server/ff-digest.js` | `digestSession`, `buildDigest` and the `DIGEST` window constants. |
| `server/ff-export.js` | `exportRange`, `buildExport` and `EXPORT`. |
| `server/routes/flows-ff.js` | `flowsFfRows(deps)`, the route family. |
| `tests/lib/d1-budget-ff.mjs` | The row-budget lines (lane 0's file) plus `FF_ROUTE_CEILINGS`, one ceiling in rows read, rows written and round trips for each route. |
| `tests/ff-b-*.mjs`, `tests/lib/ff-b-*.mjs`, `tests/suites/ff-b-*.json` | The suites below. |

## What lane G wires

Nothing here is registered in `worker.js` yet. The integration lane adds:

1. `createRouter(..., flowsFfRows(deps))` in the route table, where `deps` is
   - `store`: `createFfStore({ ensureFf })`, `ensureFf` being a single-flight `bootstrapFf(env.DB)` kept in the Worker's one `state` object;
   - `flowsStore`: an object with `readMany(env, keys)` answering a `Map` of key to `{ payload, updatedAt }` from `flows_payload` (one `WHERE id IN (...)` statement; the route asks for `universe`, and `ff-metrics` on preview);
   - `core`: lane A's adapter, `{ compile({ body, templateHint, universe, now }), effectiveSession(now), newWireId(), preview({ compiled, snapshot, universe, now }) }`. `compile` answers `{ ok: true, version, symbols }` or `{ ok: false, code, detail? }` with a code from `COMPILE_CODES`; `version` carries the `ff_wire_version` columns (`ast_json`, `ast_hash`, `clause_hash`, `sentence`, `template`, `cadence`, `scope_kind`, `control`, `exp_week` and the rest `validateCompiled` names);
   - `readClock(db)`, `readLiveRows(db, keys, now)`: the Worker's existing readers of the `flows_clock` row and the live rows;
   - `cache`: a `Map` held in the Worker's state, used for the 30 s switch and health copies (absent means no cache);
   - `runAuth(request, env, url)`: answers `"nightly"`, `"live"` or `null` for `/api/ff/run`, using the bearer rules of the ingest door;
   - `evaluate({ env, ctx, cadence, session, kind, now })`: lane A's evaluator entry; absent, `/api/ff/run` answers `ff_evaluator_unavailable`;
   - `firstCheck({ cadence, now, effectiveSession, clockRow })`: the first-check rule; absent, the preview prints the first check as absent with its reason;
   - `now`: defaults to `Date.now`.
2. The three rate-limit bindings `FF_WRITE` (10 a minute), `FF_HEAVY` (6 a minute) and `FF_HEALTH` (4 a minute) in `wrangler.toml`, with namespace ids that no other binding uses. The limiters are flood brakes and fail open, as `memberAllowed` does; the quotas below are the real limits.
3. `FF_MODE` (`on`, `shadow`, anything else is off), `FF_ROUTE_WIRES`, `FF_ROUTE_INBOX`, `FF_ROUTE_FIRE` and `FF_ROUTE_EXPORT` (`on`, anything else is off) in `[vars]`. Every switch fails closed.
4. `D1_USERS` rows in `tests/lib/d1-budget.mjs` for `server/ff-store.js` and `server/ff-health.js`, so `flows-d1-budget` prices the new statements.
5. A call to `evaluate` from the live and nightly firings if the evaluator is to run in the Worker; lane B only stores what it writes (`hitWrite`, `stateWrite`, `receiptWrite`, `recordWrite`, `startRun`, `finishRun`, all fenced by the run's attempt token).

## Gates, in the order every route takes them

1. The route table's method gate (405 with `Allow`) and the Flows session gate (401). `/api/ff/run` has `auth: "none"` and takes its own credential.
2. `memberId(session)` is the member, always. No query field, body field or header ever names a member: a request that carries `member` or `member_id` is refused as an unknown field (`only(body, [...])`) or ignored (query). Every statement in the registry binds the member through `guardBinds`, and `tests/ff-b-batteries-isolation.mjs` classifies every statement the fake D1 executed and fails on one that does not.
3. Master switch `FF_MODE`: `off` is `ff_off` with `reason: "mode_off"`, even for the health poll. `shadow` serves the pages with an empty inbox (hits are `[]`, a hit by id is `ff_hit_not_found`, a mark is refused).
4. The route flag for the part (`wires`, `inbox`, `fire`, `export`): `ff_off` with `reason: "route_off"` and the route name.
5. Mutations require same origin (`requireSameOrigin`).
6. The rate-limit binding.
7. The channel switch in `ff_switches` (`inbox`, `export`), cached for 30 s; `reason: "channel_off"`.
8. Arming (create, restore, adjust, follow a house wire) also reads `ff_switches` for the member's own switch: `member_off`, and `switches_unreadable` when the table cannot be read (new wires fail closed; reads do not).

A member's own data is never visible to another member. A wire, hit, note or receipt that is not the caller's is `ff_wire_not_found` or `ff_hit_not_found` with a 404, the same answer as one that does not exist, so a 403 never leaks existence.

## Routes

All bodies are JSON with `v` (the API version) and `serverNow`. Errors use the site's `{ error: { code, message, details? } }` shape and the frozen codes of `shared/ff-contract.js`.

| Route | Methods | What it does |
|---|---|---|
| `/api/ff/health` | GET | The member's health view: state, line, TRT times, unread counts, route availability, `pollAfterS` (60 while the market is open, 300 otherwise). Weak `ETag` over the state tuple (never the time); `If-None-Match` answers 304. Two round trips and three rows when warm; four trips and six rows cold. |
| `/api/ff/wires` | GET | `?id=` one wire with its versions (last 20) and note; otherwise `?status=live|armed|paused|retired` (default `live`) up to 100 wires with `limits` (armed, universe, live, budget B). |
| | POST | Arms a wire. Body `{ ast, template?, title?, origin? }`, header `Idempotency-Key`. The wire id is derived from `sha256([member, key])` so a retry returns the same wire (`replayed: true`) and a reused key with a different definition is `attempt_conflict`. The quota check and the insert are one atomic statement. |
| | PATCH | Adjust or change status. Body `{ id, version?, status? | title?, ast?, template? }`. `version` is the base version the member opened (required when the definition changes); a stale base is `ff_version_immutable` with the current version. A new definition writes a new immutable version; retire and restore are status changes that keep every version; a title alone changes no version. A house wire is `ff_house_readonly`. |
| `/api/ff/house` | GET, POST | The house wires with the member's follow state and the record; POST `{ id, follow }` opts out of or back into one (following needs arming). |
| `/api/ff/hits` | GET | The inbox. `?state=all|unread|pinned|archived`, `?limit=` (default 12, at most 30), `?cursor=`; the member stream and the house stream merged newest first with a cursor that carries both positions. `?id=` is one hit with its evidence. Muted names, opted-out house wires and dismissed hits are filtered in SQL, and a page never reads more than a scan window. |
| | POST | `{ id, mark?: pinned|dismissed|null, feedback?: useful|noise|null }`. |
| `/api/ff/read` | POST | Moves the read cursors: `{ all: true }` or `{ readSeq, houseReadSeq }`. The cursors only advance and are clamped to the stream's last sequence. |
| `/api/ff/preview` | POST | `{ ast, template? }` compiles and dry-runs against `ff-metrics` (and the live rows for a live wire) and answers the sentence, the subjects that would match now, the first check in TRT and the expected weekly rate band. Writes nothing. One round trip. |
| `/api/ff/receipts`, `/api/ff/records` | GET | `?wire=` (`&session=`, `&limit=` / `&version=`, `&week=`): what a wire did on each session and the aggregate record. |
| `/api/ff/symbol` | GET | `?t=` the name panel: the member's wires on that name, at most three, with their last hit, and the mute state. |
| `/api/ff/digest` | GET | `?d=` a session date within the last 10 sessions. The day's hits grouped by wire, the rarity ranking, the hygiene list (wires silent for 30 sessions), and whether the window was complete. |
| `/api/ff/export` | GET | `?from=&to=` (at most 31 days) as CSV: UTF-8 byte order mark, CRLF lines, `fired_at` as ISO 8601 with `+03:00`, a leading apostrophe on any text that starts with `=`, `+`, `-`, `@`, tab or CR. At most 1,000 rows from each stream; `X-FF-Complete: 0` says the window was cut. The export is not filtered by mutes. |
| `/api/ff/mute` | POST | `{ symbol, mute }`, at most 500 names. |
| `/api/ff/note` | PUT, DELETE | `{ wire, body }` (at most the contract's `noteChars`), or `?wire=`. |
| `/api/ff/run` | POST | The evaluator's door. `auth: "none"`; the route answers `ff_off` when the master switch is off, `unauthorized` without a `runAuth` credential, then delegates to `evaluate` (`ff_evaluator_unavailable` when none is wired). |

## Quotas and concurrency

- Armed 50, universe-wide 5, live 5, versions per wire per session 10, mutes 500, budget B in {1, 2, 5} (default 2), as in `LIMITS`. A quota is one `INSERT ... SELECT` whose guard subquery counts the member's rows in the same statement, so two concurrent creates cannot both pass at 49. A refusal reads the counts once to say which limit (`ff_wire_limit` with `limit: armed|universe|live|capacity`, or `ff_budget_exceeded` with the used, adding and maximum budget).
- Hit write caps: 10 a wire a session, 25 a member a session, the house 10 nightly and 20 live a wire. A hit for a session more than four days older than its stream's latest is refused (`force` for a backfill). The caps count over the newest rows of the stream and are a backstop; the evaluator enforces them first.
- Every state, hit, receipt and record write is fenced by the run's `attempts` token, so a worker that lost its lease writes nothing.
- A hit key is `(stream, seq)` with a gapless sequence taken inside the insert; the dedupe key makes a retry a no-op, and the count of what landed is `changes() > 0`, never the batch length.

## Row budgets

`tests/ff-b-budget.mjs` loads twelve members with 25 wires and five names each into the counting D1 fake, runs every route and holds its rows read, rows written and trips to `FF_ROUTE_CEILINGS`. The ceiling must hold and must not be loose (read within the larger of 2 and a quarter of the ceiling). The planned API line of `flows-d1-budget` (`ff.api`) is built from the same ceilings: 470 rows written and about 58,000 rows read a day for twelve members, under the 70,000 the test allows so the nightly and the live loop keep their share. The worst case is the export at 2,000 rows read.

## Tests

| Suite | What it holds |
|---|---|
| `ff-b-routes` | Wire lifecycle, isolation (member A cannot list, read, adjust, retire, mute, note or count member B's wires, and the answer is 404), the member id never read from a query, body or header, the inbox (filters, pagination, cursors, mutes, notes, shadow mode, floods of muted rows), reads (absent with reason, digest completeness, export), gates (methods, bodies, same origin, limiters, store failures, no vendor call) and route flags. About 1,550 checks. |
| `ff-b-health` | The truth table of health states against an independent restatement, the ETag, the cache, the gates. |
| `ff-b-store` | Hit writes, refusals, caps, versions, monotone rule, run fencing and leases, the SQL registry (every statement binds the member; no unregistered SQL), the compiled-record gate, the source rules. |
| `ff-b-budget` | The ceilings above. |
| `ff-b-mutants-store`, `ff-b-mutants-routes` | 131 planted wrong builds, each an exact-once source transform loaded as a data URL (production is never edited). A build is killed when a detector that passes the correct build fails an assertion. The planted builds include the member id taken from the query string, a statement that does not bind the member, a 403 where a 404 belongs, a quota checked and inserted apart, an idempotency key ignored, a stale version accepted, a restore that skips the guard, an unclamped read cursor, a digest that claims completeness it does not have, and a formula-injection export. |

## Known limits

- The hit caps and the digest window are bounded by the newest rows of a stream, not by an index on `(stream, session, seq)`. Interleaved sessions can exceed a cap; an index would make the digest and the caps exact.
- Account deletion is not possible: the contract's triggers freeze hits and versions.
- A retired wire does not count against the armed limit and is not capped.
- Unread counts include held and muted rows until the member reads; `/api/ff/read` is the exact figure.
- There is no mute-list endpoint: the mute state is read through `/api/ff/symbol`.
- The inbox groups more than three hits of one wire in a session on the client from the flat rows; the digest groups on the server.
- `ff-eval.js` is not built here. The store has the write primitives and `/api/ff/run` the delegation hook.
- `PATCH` takes `version` (the base version) which the contract does not list; it is how an adjust becomes optimistic.
