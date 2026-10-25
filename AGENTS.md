# anilkaya.org — project handbook for coding agents

Personal site of Anıl Kaya: a landing page, an Articles section, and the
**Econometrics Lab** — an interactive course platform that runs real Python
(statsmodels) in the browser via Pyodide/WebAssembly.

The browser frontend has no framework, frontend bundler, or runtime npm
dependency. It is plain HTML, CSS, and vanilla JavaScript. Wrangler bundles the
Worker modules during deployment. Course authoring has one explicit generation
step that writes committed JSON payloads; production does not generate or
compile them. The committed npm dependencies under `tests/` are development-only
and power verification.

## Architecture

```text
Browser ──► Cloudflare edge
              ├─ /assets/*  served asset-first from the static bundle, no Worker
              │             invocation; the root `_headers` file sets its headers
              └─ everything else ──► Cloudflare Worker (worker.js; runs first)
                    ├─ /auth/*  Google OAuth → HMAC-signed session cookie
                    ├─ /api/*   owner-scoped JSON API backed by D1 (SQLite)
                    ├─ /api/rt/* Flows real-time rail → Pulse Durable Object
                    ├─ /lab/<course-slug>/ → crawlable course HTML via HTMLRewriter
                    └─ everything else → ASSETS binding
```

- `wrangler.toml` is the Worker source of truth: name `anilkaya`, entrypoint
  `worker.js`, static directory `.`, binding `ASSETS`, D1 binding `DB` to
  database name `iewt`, and the Durable Object binding `PULSE` to the
  SQLite-backed class `Pulse` (migration `v1`), which `worker.js` exports from
  `shared/flows-rt-hub.js`.
- `assets.run_worker_first = ["/*", "!/assets/*"]`. Every route except
  `/assets/*` invokes `worker.js` first, which keeps response headers, cache
  policy, and course metadata rewriting in the Worker; a plain `true` would
  put the Worker, its finalizer and an `ASSETS` binding fetch in front of every
  stylesheet, script, font and image as well. `/assets/*` is served asset-first
  by the edge, and the root `_headers` file (uploaded with the static bundle,
  never served) carries its policy: the same seven security headers, one-year
  immutable for `/assets/css/*`, `/assets/js/*` and `/assets/fonts/*`, one
  hour for `/assets/img/*`, `/assets/data/*` and the two version tokens
  `assets/version.txt` and `assets/fonts-version.txt`. The
  asset layer matches by path only, so an unversioned `/assets/css/*` request
  gets the immutable policy too, and a missing file under `/assets/` is
  answered by the asset layer's `404.html` with its path's policy and no CSP
  rather than by the Worker. `.gitignore` un-ignores `_headers` (its `_*` rule
  would drop it from the served tree) and `.assetsignore` must not list it.
- `assets.html_handling = "auto-trailing-slash"`. Each course has a descriptive
  canonical path such as `/lab/ordinary-least-squares/`. Legacy
  `/lab/course?m=<id>` and `/lab/lesson?m=<id>` forms receive a 308 redirect;
  missing or invalid IDs redirect to `/lab/` instead of exposing a soft 404.
- `.assetsignore` excludes Worker code, `server/`, `shared/`, `docs/` (the 1 MB
  vendor OpenAPI specification), tests, authoring-only combined
  curriculum scripts, the private article template, `CNAME`, local secrets,
  schema, Markdown, dotfiles, and configuration from the Cloudflare static
  bundle. `tests/contracts.mjs` holds `servedFiles()` equal to a declared list of
  pages and asset directories, so a new top-level file is declared or ignored.
  `CNAME` remains in Git for GitHub Pages.
- Secrets are bindings, never source: `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`.
- Invocation observability is enabled in `wrangler.toml`; application code
  emits structured logs only for unexpected failures and OAuth callback errors.
- The account is on Workers Paid (the owner confirmed it on 2026-10-10 from
  the Cloudflare invoice dated 2026-09-30, period to 2026-10-29). Until that
  upgrade D1 on Workers Free had two daily caps, both reset at 00:00 UTC and
  both shared by everything on the account, the audit's own queries included:
  **100,000 rows written and 5,000,000 rows read**. Paid bills D1 rows against
  monthly allowances instead of refusing at a daily cap, so read the current
  figures in the dashboard; the Worker's `503 store_quota` handling and the
  rows-read ceilings stay as the fuse, and every row budget below is still
  written in rows. The write cap is priced
  in DEPLOY.md section 10.4b; the read cap was found exceeded on 2026-09-29
  (an audit `SELECT` at about 21:36 UTC failed with error 7500). Who spent it,
  and whether the Worker's own reads and writes were refused, are unverified
  until `live:alerts.record.reads` continuity across that evening and the D1
  dashboard's rows read by hour are read. The Worker turns that error into
  `503 store_quota` with `Retry-After` to 00:00 UTC, serves the last good
  copy of a nightly Flows key (kept in `caches.default` for 24 hours, stamped
  `X-Fresh-State: stale`, `X-Fresh-Reason: store`) instead of a bare 503, and
  `tests/flows-reads-contract.mjs` holds a rows-read ceiling per read route.
  The copy lives only in a data centre that served the key within 24 hours
  and can be evicted earlier, so it softens a quota day for the colos readers
  use and guarantees nothing; it is proven on local workerd and a Cache API
  fake, not on the production edge. Budget any new query in rows, not only in
  round trips, and never scan a payload table or expand a `json_each` over a
  large array on a polled route.

- Workers AI is billed on the Paid plan beyond the 10,000 free neurons a day,
  and Cloudflare no longer refuses the call that would exceed it, so the Worker
  does: every model call goes through `cappedAi` (`shared/flows-ai.js`), which
  reads the day's recorded spend from `flows_ai_usage*` first and refuses at
  `FLOWS_AI_DAILY_CAP_NEURONS` (30,000, about $0.22 a day) or
  `FLOWS_AI_DAILY_CAP_CALLS` (2,500), or when the spend cannot be read. The
  refusal is the failure reason `budget`; the deterministic reading stands and
  the reader is told the site's own budget is spent. A reply that carries no
  `usage` is recorded from an estimate (`estimateUsage` in `shared/flows-ai.js`:
  characters over 3.7, `maxTokens` for a length stop or a reasoning reply,
  flagged `estimated`, never printed as a reading's reported cost), so the meter
  is not under-counted; a recording is one D1 batch with no read back, and a
  recorder that cannot write logs `ai spend not recorded` once per isolate. A
  model with no configured
  rate is priced at the dearest model on the plan. `tests/lib/ai-guard.mjs`
  holds this in two halves. Statically (`checkModelCalls`, run by
  `flows-neuron` and `flows-reading-worker`), it reads `worker.js`'s whole
  import closure plus every file under `shared/` and `server/` and allows
  exactly one read of the `AI` binding into a value, in `shared/flows-ai.js`:
  a property access, a bracketed or destructured read, a destructured
  parameter and any other bare `AI` token elsewhere fail, and only
  `!x.AI` and `Boolean(x && x.AI)` count as truthiness tests. A quoted `"AI"`
  string is not treated as a read (the entity allowlists need it), so computed
  access (`Reflect.get(env, "AI")`, a key held in a constant,
  `String.fromCharCode`) is caught only by the runtime guard, and only on the
  paths the in-process suites drive. `askModels(` appears once outside its own
  module, in `server/ai.js`, handed `deps.ai()`; every other model call is
  `aiCall(env, aiDeps(env), ...)` (the reading's is `deps.call`, bound to
  `aiCall(env, aiDeps(env, deps.ai), ...)`), and `aiDeps` is built once from
  `meteredAi(env)`. Every `cappedAi` that builds `meteredAi` or the reading's
  `deps.ai` must have a second
  argument that is not a `null`, `undefined`, `void` or other non-function
  literal; that the reader really reads the day's spend is proved by
  `flows-reading-worker`, which drives the summary and Ask routes through
  `worker.js` with `flows_ai_usage` past the cap and requires that no model
  is reached. At run time (`guardAi`), the in-process suites hand `worker.js`
  a binding whose `run` throws unless it is called from inside `cappedAi`'s
  own lines.

- Every member-facing vendor read passes a per-request `vendorGate(env,
  session)` where a vendor call would follow: the `MEMBER_VENDOR` rate-limit
  binding (60 a minute, keyed by `memberId(session)`, consulted at most once
  per request), then the shared `UW_ONDEMAND` budget. The shared budget is
  charged per vendor call in the chain and strategy builds: `serveCachedVendorRead`
  checks the member once before building and hands the builder `chargedFetch`,
  which takes one `UW_ONDEMAND` token before each `uwFetch` (the chain's
  option-contracts pages, ohlc, stock-state and the info read; the strategy
  context's breakdown, its dated retry, the exposure fallback, ohlc,
  stock-state, info and the SPY index read; an expiry's call and put pages and
  its engine stock-state). A cached info or index copy costs no token. A
  refusal in the middle of a build (`VendorRefused`, which the builders' own
  `.catch` handlers rethrow through `keepRefusal`) stops the remaining calls and
  is answered like a member refusal. The dossier, the stock-state quote and
  the screener classify are charged per call as well. The tape is charged once
  per refresh, and a premium refresh makes two vendor calls for that token. It
  covers
  `/api/flows/chain` (which the desk reads), `/api/flows/strategy`, the
  stock-state quote behind
  `/api/flows/live` and `/api/flows/now?t=`, the tape miss, the screener
  classify behind an unknown name's card, and the dossier fan-out of
  `/api/flows/dossier` and the summary route's reading (one member
  token per assembly; the Ask box takes none, because its dossier is cache-only). A refusal makes no further vendor call. Chain and strategy keep
  their copy six hours (`VENDOR_COPY_KEEP_SECONDS`) and serve it as a hit only
  inside its 120 s TTL; past the TTL a refused member gets the kept copy
  stamped `X-Fresh-State: stale`, `X-Fresh-Reason: throttled` with its true
  `X-Chain-Age`, or, with none kept, JSON `429 rate_limited` with
  `Retry-After: 60`. The quote keeps its `unavailable`/`throttled` body. The
  tape asks the member half of the gate before its `flows_tape` insert and lease
  claim: a refused member's read of a stale row is served `stale-throttled` (or
  `pending`/`throttled` with no usable row) and writes nothing, and an unknown
  name left unclassified by the refused gate is `pending` (`throttled`) before
  any insert. An unknown name's card read by a refused member answers
  `{status: "unavailable", why: "throttled"}` with `X-Fresh-Reason: throttled`
  and `Retry-After`, not a coverage verdict; the ticker page prints its
  `wh-throttled` copy. The dossier's vendor packets go `pending`, and the
  reading built from such a dossier is neither generated nor stored (see "Flows
  reading"). Both bindings are flood brakes and fail open. The Tier 1 and focus
  ticks consult neither; `tests/flows-reads-contract.mjs` and
  `tests/flows-dossier-reads.mjs` hold both sides.

### Vendor key and the project's MCP server

`.mcp.json` registers the vendor's hosted MCP server
(`https://unusualwhales.com/public-api/mcp`) with
`Authorization: Bearer ${UW_API_KEY}` expanded from the environment of an agent
session. Nothing in the site, the tests or the workflows reads the file. A
session with `UW_API_KEY` set can spend the vendor quota through those tools,
outside the Worker's limiter and the `x-uw-*` accounting that the plan budgets
against. Builders and reviewers must not call the vendor's tools or endpoints
unless a row says to, and an agent environment that does not need the vendor
should not carry the key.

### External deployment state

Repository files cannot prove Workers Builds branch mapping, dashboard secrets,
custom domains, staging environments, or deployment gates. Verify those in the
Cloudflare dashboard before changing production assumptions.

As observed on 2026-07-12, the apex used the Worker API while
`www.anilkaya.org` was still served by GitHub Pages and redirected to the apex.
The `CNAME` file therefore supports a live hybrid redirect path; do not remove
it until `www` is attached to the Worker and verified.

As verified on 2026-07-15, the zone-level `Security Headers` response transform
no longer writes a second Content-Security-Policy. The live HTML CSP therefore
comes from `worker.js` and permits the Cloudflare Web Analytics beacon. The
remaining transform rows still overlap several Worker headers, so compare live
header readback with this repository after any dashboard rule change.

## File map

The File map, the course counts, the production globals and the suite lists in
this file sit between `gen:` markers and are written by `node scripts/gen-docs.mjs`
from `docs/modules.json`, `docs/globals.json`, `tests/suites/*.json` and the
catalogue; edit those inputs and regenerate, never the text between markers.
A new tracked file needs a row in `docs/modules.json`. `docs/index.md` is the
full generated index, and `docs/map-2026-10-05.md` is the frozen system map
(a dated snapshot, never edited).

<!-- gen:filemap -->
| Path | Role |
|---|---|
| `index.html` | Landing page and particle-field hero. |
| `articles/index.html`, `articles/_template/` | Articles index and article template. |
| `lab/index.html` | Crawlable academy catalogue plus learner command center, daily-review entry point, guided paths, search, filters, and reset dialog. |
| `lab/placement/index.html` | Crawlable, dependency-light 15-question placement diagnostic with a three-course recommended route; does not load Pyodide. |
| `lab/review/index.html` | Dependency-light five-question Daily Mastery Review; does not load Pyodide. |
| `lab/course.html` | Private routing template rewritten for canonical course-slug pages; loads only the selected course payload. |
| `lab/lesson.html` | Noindexed static fallback for legacy lesson URLs. |
| `worker.js` | Routing, response policy, OAuth, API, D1 synchronization, SEO rewriting. |
| `_headers` | Edge policy for asset-first `/assets/*` responses: the Worker's security headers and by-path `Cache-Control`. |
| `shared/session.js` | Defensive HMAC-SHA256 session sign/verify and cookie helpers. |
| `shared/lab-sign-in.js` | The Lab session lifetime, the OAuth callback's `users` upsert (`created_at` once, `signed_in_at` on every sign-in, the column added on first use) and `labActiveAt`, the Google OAuth client's last known use that the nightly health gate reads through the ingest `clock` key. |
| `shared/course-points.js` | Server scoring manifest used to derive points from progress. |
| `shared/course-seo.js` | Canonical course slugs, metadata, and crawlable module outlines. |
| `shared/review-manifest.js` | Generated, answer-free Worker allowlist for stable review-item IDs. |
| `shared/mastery.js` | Server-compatible mastery transition and review-selection contract used by tests. |
| `schema.sql` | D1 `users`, `progress`, `stats`, `mastery`, idempotent `mastery_attempts`, minimal `placement`, and per-owner `learning_sync` generation tables; the Flows tables, including `flows_live` (only `live:*` ids), `flows_tape`, `flows_clock`, the trigger that makes dated archive rows immutable and the two triggers that make `ideas:<date>` and `ideas-out:<date>` rows (and their `:r<n>` revisions) neither updatable nor deletable, with `shared/flows-archive.js` holding the write-once decision, its refusals (`archive_permanent` for these keys) and `PERMANENT_ARCHIVE_KEY_RE`; the model spend (`flows_ai_usage`, `flows_ai_usage_model`), board summary and Neuron (`flows_ai_summary`, `flows_neuron`) tables. `tests/academy-contract.mjs` builds three `node:sqlite` databases (this file, every `migrations/*.sql` in number order, the Worker's first-use DDL) and holds their tables, columns by name, CHECK clauses (literals compared verbatim), indexes, triggers and views equal; only `users`, `progress` and `stats` have no first-use DDL. Every `CREATE` and `DROP` of a table, index, trigger or view in `worker.js` and `shared/`, whatever its case or spacing, must sit inside a top-level DDL constant the suite evaluates, so inline DDL cannot escape the comparison. Every `ALTER TABLE` in `worker.js` and `shared/` must be one of the sites the suite lists, and each column it adds must be declared with the same type in this file and the migrations. |
| `assets/js/course-catalog.js` | Lightweight course metadata, prerequisites/outcomes, and learning paths (`TOPIC_META`, `TOPIC_BY_ID`, `LEARNING_PATHS`). The browser scoring manifest is the generated `assets/js/stage-catalog.js` (`COURSE_STAGE_POINTS`, `COURSE_STAGE_IDS`). |
| `assets/js/curriculum.js` | Canonical OLS authoring source. |
| `assets/js/curriculum-data.js` | Canonical IV, DiD, VAR, panel, logit, and GMM authoring sources. |
| `assets/js/curriculum-questions.js` | Additional authored question stages applied before payload generation. |
| `assets/data/courses/<topic>/manifest.json`, `<topic>/<module>.json`, `<topic>.json` | Committed, generated `schemaVersion: 2` payloads. The course page fetches the manifest and then one file per module, only for the selected course; the whole-course `<topic>.json` is the fallback it requests when the manifest is missing. |
| `assets/data/review-bank.json` | Generated full assessment bank, loaded only by the Daily Mastery Review page. |
| `assets/data/placement-bank.json` | Authored 15-item diagnostic bank balanced across five question formats and three difficulty bands. |
| `scripts/flows-pipeline.mjs`, `scripts/flows-legs/` | The nightly Flows pipeline and its legs (also the `--live` Tier 2 entry), run by GitHub Actions; the Worker only stores what they ingest. |
| `server/http.js`, `server/errors.js`, `server/log.js`, `shared/flows-log.js`, `tests/server-kernel.mjs`, `tests/server-log.mjs` | The Worker-only HTTP kernel. `http.js`: `HttpError` (with `HttpError.of(code, message?, headers?, details?)`), `json`, `apiError`, `redirect`, `requireMethod`, `requireSameOrigin`, `requireMutationOwner`, `requireReadOwnerIfPresent`, `readBounded`, `readJSON`, `tickerParam`, `requireTicker`, `keepAlive`, `errorText`, `internalKey(namespace, path)` (the `https://flows-<namespace>.internal/<path>` Cache API keys) and `edgeCache` (`handle`, `get`, `put`, each failure a miss). `errors.js`: `ERRORS`, one frozen `[status, default message]` per code. `log.js`: `logFailure(level, event, fields, error)`, the one way the Worker writes an unexpected failure. The shape is built by `shared/flows-log.js`, a leaf the shared modules can import: `failureEntry`, `failureLine` and `emitFailure(sink, level, event, fields, error)` write one JSON line `{ event, message, level, route, code, ...fields, error }`, with `message` an alias of `event` for one release, `level` `warn` or `error`, `route` the caller's route or path, `code` the caller's or the error's own string code, `error` the text of the caught value or null, and reserved keys that a field cannot rewrite. Logging never throws (an unserialisable field falls back to a minimal line, a sink that fails is ignored). The Worker's sites, the live layer's injected `log` sinks, the reading, the AI failover and the rail's one-a-minute log all go through it; success is never logged or sampled, so it adds no events. `tests/server-log.mjs` holds the shape, drives a real site of each module, and scans the closure for a hand-built failure line. `server/` holds no top-level mutable binding, no comments and is excluded from the static bundle. The suite runs every helper against a verbatim copy of the helper it replaced over tables of requests, bodies, origins and tickers, holds every literal `new HttpError(status, "code"` in `worker.js` and `shared/` to the table's status, and holds the failure-log key order. Literal `new HttpError(` sites stay where they are (the ingest scans pin some); a module moves to `HttpError.of` with its own move. |
| `server/router.js`, `server/routes/flows-read.js`, `tests/server-router.mjs` | The Worker's route table, consulted first by `route()` and falling through to the remaining `if` chain. `createRouter(...families)` validates each row `{ id, path, methods, auth, handler }` (an absolute path and an id declared once, a non-empty list of HTTP methods or the single wildcard `["*"]` for a row whose handler owns its method policy, `auth` of `none` or `flows`, a handler), freezes it, and `handle(rc, gates)` returns `null` for a path with no row, else runs the method gate, then the session gate (`gates.flows`, a missing session being the 401 `unauthorized`), then the handler with `{ request, env, url, ctx, session }`: the order the Flows prefix block always had. `flowsReadRows(deps)` is the first family, 23 `GET` rows behind the Flows session: `board`, `brief`, `card`, `card-x`, `hist`, the overlaid `flowalerts`, `pulse` and `news`, and the fifteen plain nightly reads built by one `nightly(key, pending)` factory (`market`, `events`, `scoretrack`, `meta`, `political`, `unusual`, `movers`, `sectors`, `sector-premium`, `universe`, `regime`, `ideas`, `focus`, `roster`, `record`). The worker-local readers it needs (`readServed`, `readFlowsPayload`, `readWithOverlay`, `passthrough`, `recallLastGood`, `storeGone`, `absentKey`, `cardWithEngine`, `briefWithLive`, `nightlyFreshHeaders`) are injected, so `server/` imports nothing from `worker.js` or `cloudflare:`. A new route in this family is a row, never a new `if`; the ceiling enumeration in `flows-reads-contract` takes the table's paths plus the literals still in the chain (at least thirty together) and fails for any without a rows-read ceiling. The suite runs every row against a verbatim copy of the branch it replaced over eight stored-row worlds and seven store behaviours, comparing status, headers, body, errors and the order of calls. |
| `server/routes/flows-desk.js`, `tests/server-desk.mjs` | The flows-desk family in the route table: `flowsDeskRows(deps)` is three `GET` rows behind the Flows session, `chain` (keyed by ticker, strategy and rank, 120 rows), `strategy` (the context, or one expiry with or without the engine; a malformed expiry is `400 invalid_expiry` before any gate) and `live` (the stock-state quote). Each handler builds the member's `vendorGate` once and hands the Worker's single-flight `serveCachedVendorRead` (or `quoteResponse`) its key, gate and builder; the builders, the gate and the reader are injected and stay in `worker.js`, so the family names no limiter and makes no vendor call itself. `isRealDate` (a real calendar date in 2000 to 2100, so `2026-02-30` is `400 invalid_expiry` before any gate, cache key or vendor call) and `RANK_KEYS` are read by the handlers, not the Worker. The suite runs every row against a verbatim copy of the branch it replaced over the parameter grid (tickers, strategies, ranks, expiries, engine and refresh flags, two members), comparing status, headers, body, errors and the order of calls, and holds the 405-before-401 gate order. `tape`, `now` and `lk` stay in the chain for the live-layer family. |
| `server/routes/flows-ai.js`, `tests/server-ai.mjs` | The flows-ai family in the route table: `flowsAiRows(deps)` is four rows behind the Flows session, `ai-usage`, `summary` and `dossier` by `GET` and `ask` by `POST`. The handlers are the route bodies only: the board summary or a `summaryResponse` for a ticker (a malformed ticker is `400 invalid_ticker`), the dossier behind `ensureFlowsTables`, and the Ask box (same-origin check, the question, the `AI_ASK` flood brake with its `Retry-After`, the stored briefing with its live overlay, then `askAnswer`). Everything that reaches a model stays in `worker.js` behind `cappedAi` and `meteredAi` and is injected (`askSpend`, `summaryResponse`, `readFlowsSummary`, `neuronProvenance`, `dossierResponse`, `askQuestion`, `askAnswer`, `readFlowsPayload`, `briefWithLive`, and `ASK_FLOOD_PERIOD_S`, which the contract reads off the Worker); the module names no model binding, and `checkModelCalls` still reads it as part of `server/`. The prefix block's method gate is `GET` alone now that `ask` is a `POST` row. The suite runs every row against a verbatim copy of the branch it replaced over the parameter grid (tickers, board summaries, stored briefings, origins, limiter behaviours, three callers) and holds the 405-before-401 gate order. |
| `shared/flows-ai-broker.js`, `server/ai.js`, `tests/flows-ai-broker.mjs` | The AI broker and its outcome telemetry. `shared/flows-ai-broker.js` is pure: the four surfaces (`board`, `neuron`, `ask`, `read`), the fourteen outcomes (`clean`, `trimmed`, `refused`, `unparsable`, `overlong`, `empty`, `length`, `budget`, `class`, `user`, `allowance`, `capacity`, `plan`, `unreachable`), `chainFor`, `transportOutcome` (a reply with no text), `guardOutcome` (the stored `llm` and `guard` of a surface mapped to an outcome and a low-cardinality reason), `tokenOf` (a culprit, 40 characters, no control or bidi characters) and `foldCounters` (the owner block's shape: per surface and model, calls, outcomes, the share of calls that reached a model whose wording failed, mean and max latency, and the fifty latest refusals). `server/ai.js` is the I/O: `aiCall(env, deps, { surface, chain, messages, opts, onUsage })` runs `askModels(deps.ai(), ...)`, times it, settles a reply with no text itself and returns the reply with `call.settle(verdict, culprit)` for the surface to call once it has judged the wording (a second settle does nothing). A settle upserts one `flows_ai_outcome` row (day, surface, model, outcome, reason: `n`, `ms_sum`, `ms_max`) and, for a wording failure with a culprit, writes `flows_ai_reject (surface, slot 0..49)` in the same batch; it never throws, and a store that refuses it is logged once (`ai outcome not recorded`). `readAiBlock(env, deps, { days })` is the owner block in one trip (today's counters; up to seven days behind `days`) and `pruneAiOutcomes` keeps eight days, run in the 03:00 ET window. The block is mounted by the health and owner-view row (P1-27). Nothing in it reads the binding or runs a model: `shared/flows-ai.js` stays the only place. The suite covers the outcome table, the fold, `aiCall` against a scripted binding and a counting D1 (one trip a call, two rows for a refusal with a culprit, a ring that wraps at fifty, a refused or missing store, the budget refusal counted without the model asked), the block's trips and rows, retention, the registry and migration 0017 parity, and the scans. |
| `server/routes/flows-ingest.js`, `server/store.js`, `server/schema.js`, `tests/server-ingest.mjs` | The flows-ingest family, the store and the schema registry. `flowsIngestRows(deps)` is one row, `/api/flows/ingest` by `GET`, `POST` and `DELETE`, whose credential is its own bearer token (the nightly, the static live token on a loopback host, or the live OIDC token) and not the Flows session; the method gate, the credential checks and the key and scope rules run in the order the branch had them. `server/store.js` is the only module that holds `flows_payload` SQL: `createFlowsStore({ ensureFlowsTables })` has `read`, `metadata`, `listing`, `remove`, `createArchive` and `write` (the nightly's `meta` lands its ledger row in the same batch; its upsert sets `chash`, `session`, `quality`, `epoch` and `asof` back to NULL and zero and bumps `rev`, so a row the v1 writer replaced never carries metadata that describes other bytes), and the door's `doorRead`, `doorWrite`, `doorBatch`, `have`, `planWrite`, `planRead` and `quarantine`, and exports `storedFrom`, `ingestKeyParts`, `INGEST_VIEW_KEY_RE` and the listing limits; `worker.js` reads the nightly rows through the same store. `server/schema.js` is the registry of the Flows statements, `{ name, table, ddl, addedColumns, migration, owner }`: the twelve the Worker has always sent (built from the DDL each domain exports plus the six tables that were literals in `worker.js`, in the order it sent them), `flows_ai_outcome` and `flows_ai_reject` after them, then `flows_quarantine` and the three `flows_payload_manifest_*` triggers; `FLOWS_SCHEMA_SQL` is derived from it. `upgradeColumns(db, table, added, known?)` replaces `upgradeClockColumns` for every table: it adds only the columns a table lacks, tolerates `duplicate column`, rethrows anything else, and takes names and types only in the shapes `checkAdded` allows. `applySchema(db, registry)` is the bootstrap `ensureFlowsTables` runs: one batch of the CREATEs and one `PRAGMA table_info` per table that has added columns (today `flows_payload` and `flows_clock`, so twenty-two statements), then the upgrades. A new column on a registered table is one entry in its `addedColumns` list (`PAYLOAD_ADDED_COLUMNS`, `CLOCK_ADDED_COLUMNS`, `LEDGER_ADDED_COLUMNS`, which is empty today) plus the same column in the table's DDL, `schema.sql` and a migration, and it is added at first use instead of being refused by `batchWithLedger`. The suite runs the row against a verbatim copy of the branch it replaced over 7 credentials, 6 methods, 39 queries and 5 bodies (statements, call order, errors, bodies and the rows left behind), checks the store, the registry against the migrations and `schema.sql` (twenty statements), `upgradeColumns` against hostile names, races and refused batches, and the Worker scans. The door itself is `server/door.js` and `shared/flows-door.js`, below. |
| `shared/flows-door.js`, `server/door.js`, `tests/flows-door-v2.mjs` | The ingest door v2 in warn mode (B3a and B3), behind `FLOWS_DOOR_V2` (`wrangler.toml` [vars], shipped `warn` since 2026-10-24; only the exact word `warn` turns it on, so `enforce` is `off` until B3b). With the switch off the ingest route is byte for byte what it was, and `?op=` and `X-Content-Hash` are ignored. With `warn`, a non-archive, non-live write is inspected, its row gets metadata, and nothing is refused. `shared/flows-door.js` is the pure leaf (it imports `flows-live.js` and `flows-freshness.js` only): `canonicalize` (keys sorted; the volatile stamps `generatedAt`, `readAt`, `screenerReadAt`, `refreshedAt`, `producer` and `fresh.readAt` dropped; non-finite numbers and nesting past 64 levels named), `sha256Hex`, `inspect(key, text, { now })` (per-product structural findings derived from the dry-run emit, every payload of which passes with none: `not_object`, `missing_key`, `schema_version`, `depth`, `panel_shape`, `ticker_grammar`, `ticker_mismatch`, `session_format`, `instant_format`, `session_future` against the next session the calendar expects, `n_mismatch`, `column_length`, `units_missing`, `rows_type`, `row_shape`; range violations in the universe are flags that cost quality and are never structural; a pending placeholder has no required keys), the ordering tuple `(epoch, session, quality, asof)` with `quality = 4 x round(63 x ok base panels / base panels) + tier`, so a complete L1 (253) beats an L2 that misses a base panel (235) and a complete L2 (255) beats a complete L1, `casVerdict` (`new`; `unchanged` by canonical hash; `advance` on an equal or higher tuple; `superseded`), `regressionOf` (a later session's card that keeps under three quarters of the stored base panels), `assess` (adds `size_collapse` under 40 per cent of the stored size for the products whose size follows the universe, `stale_producer` and `hash_mismatch`), `membershipFlag`, `planOf` and `doorMode`. `server/door.js` is `createDoor({ store, ensureFlowsTables, storeGone, log })`: `write` (one batch reading the key's stored tuple and, for a ticker key, the universe's name list, then one write; the response gains `door { mode, chash, product, session, quality, epoch, asof, cas, would, flags, ring }`), and `operation` for `?op=batch` (up to 100 keys or 2 MiB, each judged on its own; archive keys, `live:` keys, `meta` and duplicates refused per item; writes in D1 batches of 16 that are bisected to the poison key when the store refuses one deterministically, and not when the failure looks transient, at most forty failed batches), `?op=have` (up to 90 `(key, chash)` pairs in one statement; answers `have` and `need`) and `?op=plan` (the nightly's planned card set for a session, kept as the row `plan`; an older session never replaces a newer one). Every would-have-refused finding lands in `flows_quarantine`, a ring of 200 rows (id is the position, pruned by id range; bodies of at most 64 KiB kept for the newest twenty; a per-producer brake that keeps no body after twenty events of one check in the newest forty). The regression guard only logs its count (`door would hold regressions`); a ring that cannot be written is logged and never fails an ingest. `X-Producer-Id` names the producer and `X-Producer-Epoch` declares its epoch. The enforcing compare-and-set SQL exists in the store (`doorWrite` with `enforce`) and is proved equal to `casVerdict` over every pair of 36 tuples, but no route passes it. The synthetic and fixture refusal is another row's hook and is not here. `tests/flows-door-v2.mjs` reads the dry-run emit and runs the leaf, the store and the route over the warn paths, the batch, `have` and `plan`, the off paths, the upgrade of an old database, the manifest triggers and the round trip off, warn, off, warn with row-content assertions, and plants twenty-one wrong builds that its batteries must fail. |
| `server/routes/flows-pages.js`, `tests/server-pages.mjs` | The flows-pages family in the route table: `flowsPageRows(deps)` is the sign-in page, `/flows`, the fourteen gated pages (`/flows/`, `long`, `short`, `watch`, `market`, `history`, `desk`, `strategy`, `ask`, `ticker`, `unusual`, `events`, `track`, `political`) and a 308 row for the bare form of each page but Home, all `GET` and `HEAD` with `auth: none`, because an anonymous visitor is answered with the sign-in page and HTTP 200, never a 401. The page list is one array, and the bare redirects and the `?t=` reader redirect (a 302 to the ticker page from Home, `long`, `short` and `watch`, before any session is read) are generated from it. A page row reads the session through the injected `currentFlowsUser`, for Home alone the board summary through `readFlowsSummary`, and then asks the injected `isOwner(env, username)` whether the member is an owner, which `market` and `unusual` take as `owner`. The public front door is two more rows with a 308 row for each bare form: `/flows/about/` and `/flows/glossary/`, answered to a signed-out reader with no session read, and the Flows 404 when `FLOWS_FRONT_DOOR` is `off` (a method other than `GET` and `HEAD` is the row's 405 first, where the chain answered 404 while the front door was off). The page functions are `shared/flows-pages.js`'s, and the family reads no store and names no vendor or model. `POST /flows/login` and `/flows/logout` stay in the chain for the auth family. The suite runs every row against a verbatim copy of the branch it replaced over every path, query, method, member and front-door setting (84,000 checks) and holds the Worker's table, scans and the absence of the old branches. |
| `tests/route-matrix.mjs`, `tests/fixtures-route-matrix.json` | The Worker's whole routing surface in process, with no server: every route literal and prefix family, as anonymous, Flows member, Flows owner and Lab user, under six methods (plus the rail with `PULSE` absent, the switch off and the rail on, and cross-origin and owner-mismatch mutations), on a pinned clock, a fake `ASSETS`, a refusing `fetch` and `tests/lib/d1-fake.mjs`. Status, `Allow`, `Content-Type`, `Cache-Control`, `Location`, `error.code`, the seven security headers, the `X-Fresh-*` set and the cookie names are compared with the snapshot; a behaviour change regenerates it with `node route-matrix.mjs --write` in a pull request that moves no code. The fake D1 cannot return `RETURNING` rows, so the `DELETE /api/progress` cell is a 500 on the fake only. It also holds `worker.js` to one top-level `const state = createState()` and no other top-level mutable state, and `server/` (when it exists) to none. |
| `tests/flows-engine-budget.mjs`, `tests/flows-d1-budget.mjs`, `tests/lib/d1-budget.mjs` | The engines' D1 budget as a contract, in rows, with no server. `tests/lib/d1-budget.mjs` holds the caps (100,000 rows written and 5,000,000 read a day on Workers Free), the cron firings expanded from `wrangler.toml` (a weekday is 108 Tier 1, 108 focus, 48 housekeeping and 48 summary firings, a weekend day the last two), the per-firing ceilings of each job, the Tier 2 pass, the nightly's keys, the rail's roster loads, the planned writers and readers with the plan row that builds each, and `D1_USERS`, the modules that prepare a statement. `flows-engine-budget` drives the real code on the counting fake: every one of a weekday's 312 `scheduled` firings through `worker.js` on one database with Tier 2 passes between them, one ingest of each nightly key class, the roster batch, and the focus tick's held-row query, which it also runs with counting SQL functions to settle the inference (SQLite visits each held name once and re-runs the inner field scan once per name, stopping at the px field: 44 elements against the fake's bound of 641 rows: 22 names and the 28 fields of a name's strip). The fake (`tests/lib/d1-fake.mjs`) now prices `json_each(payload, ...) AS r`, bare or aliased, over the rows a statement names, and a json_each nested in a correlated subquery once for each element of the scan it sits under. A ceiling must hold and must not be loose. `flows-d1-budget` sums every declared writer and reader against the caps (about 13,000 written and 336,000 read, with every firing counted as a cold start and the planned rows included) and fails when a module in the Worker's closure prepares a statement that no declaration prices. The observer (P1-25) is declared, not measured: its ceiling and `shared/flows-engine-verdicts.js` must arrive together. Whether D1 bills `json_each` elements and DDL as rows is not measurable on a local database, so both are counted. |
| `scripts/flows-legs/stamp.mjs`, `tests/flows-pipeline-golden.mjs`, `tests/fixtures-pipeline-golden.json`, `tests/lib/nightly-emit.mjs` | The nightly's pinned dry-run clock and the golden emit. `FLOWS_DRY_NOW` (an ISO instant ending in `Z`, honoured only with `--dry-run`, anything else throws) pins `stampNow()`/`stampDate()`, the one clock every payload stamp (`generatedAt`, `readAt`, `screenerReadAt`, `refreshedAt`) is read from; elapsed-time and deadline measures keep the wall clock, and the pipeline's own source scan fails on a bare `new Date().toISOString()`. `nightlyEmit()` builds the dry-run emit once (CI default clock `2026-08-24T21:45:00Z`) into `FLOWS_EMIT_DIR`, which `tests/run.mjs` sets to one directory per runner invocation and removes at the end, or into a temporary directory of its own; a mark holding a fingerprint of `scripts/` and `shared/` makes a stale directory rebuild. The eight emit consumers (`flows-card-render`, `flows-events-contract`, `flows-overlay-contract`, `flows-payload-shape`, `flows-positioning-contract`, `flows-strip`, `flows-ticker-contract`, `flows-unusual-contract`) read it instead of running their own. The golden suite (the first half of `test:pipeline`) hashes every emitted payload against the manifest, builds a second emit to prove two runs at one clock are byte-identical, and names the payload and top-level keys that moved; `node flows-pipeline-golden.mjs --write` regenerates the manifest after an intended change and `--against <emit dir of the old tree>` prints the leaf paths. |
| `shared/flows-evt.js`, `tests/flows-evt.mjs`, `tests/lib/evt-measure.mjs`, `tests/gen-moves-fixtures.py`, `tests/fixtures-moves-*.json` | The extreme-value leaf (F-21): no imports. The generalised Pareto fit by a profile likelihood in the shape (`betaHat` solves the scale for each shape, `fitGpd` minimises over it with Brent's method), the 90% and 95% profile-likelihood interval (`profileInterval`), survival and inverse survival, and the pooled shape of exceedances over each name's own threshold with the name-level scale set to its mean excess times (1 - xi) (`pooledShape`, `pooledInterval`, `exceedances`, `exceedanceGroups`). The suite holds the fit to scipy on committed reference samples (`gen-moves-fixtures.py` writes `fixtures-moves-gpd.json` with the generator's hash), the one-name profile interval to 88 to 92% coverage over 2,000 samples, the pooled shape to within 0.02 of the truth at 3,200 exceedances with spread scales (an inverse-variance weighted mean of per-name shapes lands outside that band), and publishes in `fixtures-moves-bands.json` what every later window rests on: the production-class true model's observed over predicted exceedances at 3 to 6 standard deviations for one seed and for ten, and the pooled interval's coverage on the dependent daily world (`w1dWorld`, with sector factors, common volatility shocks and per-name scales) at 400 seeds beside the independent-names figures. The pooled shape's variance under dependence by date: `pooledClustered` (the score of each exceedance with the scale moving with the shape, plus the correction for the estimated mean excess, summed by day and squared over the squared curvature), `pooledJackknife` (delete-a-block over six blocks of days with every threshold re-estimated, a t interval on blocks - 1 degrees of freedom, `tCritical95`) and `dateBootstrapShape` (blocks of days resampled with replacement, seeded), the first two held to an independent numpy implementation with numerical derivatives (`fixtures-moves-cluster.json`). On the dependent world the unclustered interval covers 88%, 84%, 72% and 32% at market weights 0, 0.2, 0.3 and 0.5, the score sandwich 86%, 84%, 79% and 59%, and the jackknife 92%, 93%, 91% and 74% (400 seeds): the 85 to 95% line is met up to 0.3 and not at 0.5, where the shape's sampling distribution is set by the few extreme market days of a 500-day sample. Tail diagnostics and laws: `hill` and `hillCurve` (xi over the root of k as its error), `meanExcess` and `meanExcessShape` (the weighted slope of the mean-excess line, xi over 1 - xi), `thresholdStability` (the pooled shape across a ladder of quantiles and the lowest from which every higher estimate lies within the spread two nested samples allow), `semiParametricLaw` (an empirical body and generalised Pareto tails fitted on each side, with `sf`, `cdf`, `isf` and `quantile`, the signed or the absolute law) and `covariateGpd` (a log scale linear in covariates with one shape, Newton in the coefficients inside Brent in the shape, standard errors from the step-scaled Hessian, `covariateGpdSf`), each held to numpy or scipy in `fixtures-moves-tail.json`. Reference scale and challengers: `referenceScale` (the root mean square of the sessions that are not scheduled events; counting an earnings session is the planted wrong build `sigma-ref-includes-earnings`, which the kill matrix now arms and kills), `dateJackknife` (a delete-a-block standard error for any statistic of the exceedance groups), and `hierarchicalShape` (a random-effects fit: each name's exact profile likelihood in the shape on a grid, a normal prior on the shapes with its centre and spread found by marginal likelihood, shrunken posterior means) with `CHALLENGERS`, the registry in which the pooled shape is the one baseline, the hierarchical fit a registered challenger and the per-name fit the reference; the suite scores all three, and the hierarchical fit has 17% less error than pooling when shapes spread by sector-like 0.15 and is no better when they are equal. The daily generator in `tests/truth/worlds.mjs` gains W1m (GJR-GARCH with Hansen skew-t innovations, sector correlation and a per-name log-scale error) and W2 (W1m with Poisson jumps, scheduled earnings sessions and splits, with adjusted and unadjusted closes). `FLOWS_EVT_DEEP=1` re-measures at 400 seeds; `node tests/flows-evt.mjs --write-bands` rewrites the committed bands. |
| `shared/flows-stats.js`, `tests/gen-stats-fixtures.py`, `tests/fixtures-stats.json`, `tests/flows-stats-contract.mjs` | The statistics leaf: no imports, no clock, no randomness beyond the seeded `mulberry32`. Mean, sample variance and deviation, median, quantiles, share at or below, average-rank percentile, Pearson and Spearman, the Wilson interval, effective n under clustering, the t critical value and the mean interval, the Newey-West standard error, a seeded stationary bootstrap and its interval, Brier, log score, the reliability table with the Murphy decomposition (reliability - resolution + uncertainty + within-bin variance - 2 x within-bin covariance, exact for binned forecasts), Benjamini-Hochberg. A null never becomes a zero: an empty or non-numeric input answers `null`. `gen-stats-fixtures.py` (scipy, numpy, statsmodels; the versions and the generator's SHA-256 are in the fixture) writes the committed JSON the contract reads without Python. Consumers: `shared/flows-vol.js`, `shared/flows-features.js`, `shared/flows-cross.js`, and the medians of `shared/flows-political.js`, `flows-premium.js`, `flows-dossier.js`, `flows-variation.js`, `flows-market.js` and `scripts/flows-quant-pipeline.mjs`. |
| `shared/flows-news.js`, `shared/flows-rows.js` | The one news row and the one vendor-rows reader. `newsFields(row)` is the nightly's `news` row (headline, source, createdAt, createdAtMs, major, sentiment, tickers, tags; null without a headline) and `newsRow(row, at)` is the same fields behind the rail's `id` and `ts`, so the nightly and the `nw` topic cannot drift. `rowsOf(body, key = "data")` (array or empty) is the reader behind `shared/flows-live.js`, the legs' `common.mjs` and the pulse's and political feed's `unwrapRows`; `rowsOrNull` (array or null) is `shared/flows-vol.js`'s and the default of `shared/flows-positioning.js`'s. |
| `scripts/flows-pipeline.mjs`, `scripts/flows-nightly/*.mjs`, `scripts/flows-nightly/sections/*.mjs` | The nightly. The entry is the command line: the session prelude and the unranked-refresh early return, `runLiveMode`, `main` (one `ctx`, eleven awaited sections), and a re-export of every name the suites import, so no suite imports a module path. The modules sit in layers and an import may only point down: `flags` (the process flags and the `FLOWS_DRY_NOW` pin), `vendor-params` (what is asked of the vendor and the call budget), `vendor` (`uw`, the permit queue, the read pace and the pool), `store` (ingest URL, the live credential, read, publish, retire, prune and the dated-key grammar; `hold` keeps a payload in the run's store without writing it, and `flushHeld` writes each held key that no later write landed, the latest payload first and the held one if that is refused: the vol leg's card-x for every name the flow leg rewrites is held so that one write carries both), `clock`, `rank` (scoring and shaping, `enrich`), `fixtures` (the dry run's synthetic vendor), `archive` (board memory, the dated walk, the record's inputs, the roster ledger), then the sections, `runUniverse` to `runClose` (`runCompute` between `runFocus` and `runClose`), none importing another; `stages` is a leaf. A section destructures what it reads from `ctx` and returns what a later one needs with `Object.assign(ctx, ...)`; `tests/flows-legs-contract.mjs` holds each declaration to its module, the layer rule and the no-comment rule for the whole tree. A test reads the nightly through `nightlySource()` (entry, then every module, each marked), `nightlySlice()` (throws when a slice crosses a module) or `nightlyExecution()` (the entry with each section spliced in where it runs) from `tests/lib/source-scan.mjs`, never by reading one file. |
| `scripts/flows-nightly/stages.mjs` | The nightly's stage table (`STAGES`: id, fatal or isolated, `needs`, declared `publishes`) and `createStageRunner`: `step(id)` for a fatal stage, `run(id, work, onError)` for an isolated one (the failure is recorded and handed to `onError`, a fatal one rethrows), `skip`, `note(key)` from `publish`, `detail(fields)` (at most six extra numbers or short strings on the open stage's record, never a record field; `vol-flow` adds `mlNames`, `mlFull`, `mlFirstBad` and `mlLaterBad` only when a multi-leg page failed, and `volFlushed` and `volFailed` only when a held vol payload had to be written on its own), `finish`, `records()`; given a `cpu` clock the runner adds `cpu` (whole milliseconds of the process's CPU time) to every record, and the dry run pins that clock to 0 with the stamp. `meta` is the last write of the nightly, after the health gate, and carries `stages` and `health` (`healthRecord`); `publishedStore.meta` is set earlier so the brief still reads it. The pipeline's pipeline-contract block holds the table to the source (every id once, in order, fatal stages stepped and isolated ones run) and to the dry run (every key declared, `meta` last). |
| `scripts/flows-nightly/sections/compute.mjs` | The compute stage, an isolated stage after `card-x` and before `roster`, once the vendor reads are done: it imports no vendor client, store or archive, so it cannot call the vendor or publish. `computeNames` runs the registered `COMPUTE_JOBS` (frozen, holding the Oracle job: `{ id, run(ticker, ctx) }`) over the carded names one at a time with a turn of the event loop between names; a name that spends more than `COMPUTE_NAME_CPU_MS` (1,000) of CPU is named in `over`, the stage stops before the next name once its share (names times that budget) is spent or the run's deadline has passed, and a job that throws costs that name that job only. Values are kept by job and ticker on `ctx.computed` for a later stage to publish. The stage record carries `cpu`, `names`, `jobs`, `over`, `failed` and `stopped`. |
| `shared/flows-conviction.js`, `tests/flows-conviction.mjs`, `tests/gen-conviction-fixtures.py`, `tests/fixtures-conviction.json`, `tests/conviction-sim.mjs` | Does conviction order outcomes (P2-22): a pure leaf over `flows-record.js`'s forward-close rule that scores each archived board name as a hit when it beat the session's equal-weight board average in its board's direction, fits `logit P(hit) = a + b·cnv/100` with a session-clustered sandwich and Student t on G-1 degrees of freedom, reads terciles of `cnv` with Wilson intervals on the effective count, the clustered top-minus-bottom gap and its minimum detectable size (2.8 standard errors), the pooled Spearman with a leave-one-session-out jackknife, and breadth's own coefficient. `evaluateConviction` returns `keep` (slope interval above zero and rising terciles), `relabel` (the number is an "Agreement index") or `pending` (under 60 scored sessions and 600 rows at the ten-session horizon, or no fit), published as `record.conviction`. The contract holds the estimators to numpy and scipy on 500 committed reference rows (`gen-conviction-fixtures.py` writes the JSON) and to simulated boards with a known slope. The History page that displayed it is removed. |
| `scripts/eval-garch-tails.mjs` | Prints the distribution of fitted nu, the probability of profit, dollars per lot and idea-order changes between the old and the new GARCH clip on a synthetic chain; the evidence for the break mask, not a suite. |
| `tests/gen-quant-audit.py` | Generator of `tests/fixtures-quant-audit.json`: the options engine's reference values from scipy, with the version, path count and seed in the fixture's provenance string. |
| `.github/dependabot.yml` | Monthly grouped dependency refresh for the development-only npm tree under `tests/` and for the GitHub Actions workflows. |
| `lab/challenge/`, `lab/projects/<project>/` | The skill-challenge page and the three project pages (`factor-pricing-lab`, `fx-volatility-risk`, `macro-forecasting-desk`); each carries a `data-asset-version` like the other Lab shells. |
| `scripts/generate-course-payloads.mjs` | Deterministically regenerates course payloads, stable stage IDs, the review bank, browser catalogue, and Worker manifest. |
| `assets/js/storage.js` | Validated owner-scoped v2 progress/mastery/placement persistence, retry outbox, legacy migration, reset, and in-memory fallback. |
| `assets/js/lab-core.js` | Pyodide loader, Python editor, execution, output, and figures. |
| `assets/js/lab-course.js` | Course player, grading, progress, points, navigation, splitter. |
| `assets/js/auth.js` | Account binding, one-request bootstrap hydration, serialized owner-checked synchronization, and server-first reset coordination. |
| `assets/js/gamify.js` | Local points/streak state and rendering. |
| `assets/js/mastery.js`, `review-catalog.js` | Browser mastery scheduler and lightweight answer-free dashboard catalogue. |
| `assets/js/lab-review.js` | Review-bank loading, five assessment renderers, grading, feedback, and retry-safe persistence. |
| `assets/js/placement.js` | Placement-bank loading, five accessible question renderers, deterministic scoring/routes, and minimal result persistence. |
| `assets/js/lab-ui.js`, `lab-fx.js` | Academy command-center/path/search/reset UI and visual feedback. |
| `assets/css/base.css`, `lab.css`, `review.css`, `placement.css` | Design system and Lab/course/review/placement UI. |
| `assets/version.txt` | Canonical cache version of `assets/css`, `assets/js` and `assets/data`: the `?v=` on every CSS and JavaScript reference. |
| `assets/fonts-version.txt` | Canonical cache version of the woff2 files under `assets/fonts/`: the `?v=` on every `@font-face` URL and font preload, untouched by an asset bump. |
| `tests/contracts.mjs` | Curriculum/payload/scoring/storage/asset/session contracts. |
| `tests/architecture.mjs` | The tree's shape, in about a second with no server: no import cycle over static and literal dynamic imports from `worker.js` and every script, the layer table (`shared/` imports `shared/` only, `scripts/` never `server/`, `cloudflare:*` only in `worker.js`, `assets/js` imports nothing), the declared leaves, no comment in any tracked JavaScript, CSS, HTML (inline script and style too), SQL, YAML, TOML, Python or ignore file (`docs/` excluded), and the browser floor table (Flows Safari 17 / Chrome 114 / Firefox 125, Lab and articles Safari 16.4 / Chrome 111 / Firefox 113): a feature above a surface's floor must be guarded in the window around it (`?.(`, `typeof`, `"x" in`, `&&`), and the table lists the Popover API at 17 and lookbehind at 16.4. Every check is proved by recorded mutations built in memory inside the suite. The global allowlist stays in `contracts.mjs`. |
| `tests/placement-contract.mjs` | Placement bank, scoring boundaries, route, privacy, no-JS, keyboard, and responsive runtime contracts. |
| `tests/worker-regression.mjs` | Real local Wrangler routing, headers, API, and D1 tests. |
| `tests/regression.mjs` | Full Playwright browser regression suite. |
| `shared/markets.js`, `assets/js/market-ticker.js` | The landing index ticker: the Worker's Yahoo parse (the change is against the previous session's close taken from the same response's dated bars, never `chartPreviousClose`; each quote keeps its own `asOf`, `asOfDay`, `prevClose`, `prevDay` and, when the response names the session of the quote's own day, `sessionEnd`) and the strip that prints each quote's own İstanbul time, `Close <weekday>` for a closed market (a close is a quote struck within five minutes of the exchange's `sessionEnd`; the lag of the quote behind the fetch decides only where there is none), and a dash for a quote with no base. |
| `tests/flows-copy-lint.mjs` | The vendor-term lint: no `at ask`, `at the ask`, `at bid` or `at the bid` in any browser, Worker, pipeline or model-visible string (an empty allowlist), and no quoted `NOW` badge in a browser file; it plants a string of each rule, and the network's side names (`Calls . ask side`, `Puts . bid side`, `Unsided`) and legend sentence are checked in `assets/js/flows-net.js`. The vendor's ask side is a fill above the midpoint for contract volume and its alert field is undocumented, so the lean is a convention. |
| `tests/flows-desk-client.mjs`, `tests/desk-fixtures.mjs` | The Premium desk's client alone: its pure functions (the frontier against a brute-force Pareto set, balance parsing, tenor buckets, cent sizing, net delta) in a Node `vm`, and the page in Chromium against payload fixtures built to the chain contract (basis, time-value yield, tooltips, banners); no server. `syxChain` builds the synthetic SYX chains the short-call suites use, `openDesk` takes a `before` hook for routes, and `showView` opens one of the desk's tabs. |
| `tests/flows-desk-wiring.mjs`, `tests/fixtures-desk-lab.json`, `tests/gen-desk-lab.py` | The desk's Win % (implied) against an independent reference: `gen-desk-lab.py` (mpmath at 40 digits) prices skewed SVI chains and takes the risk-neutral probability of profit by Breeden-Litzenberger, and the suite proves the page, given the card's smile expiries, lands within 0.5pp of it and of the strategy lab on every line, while the flat fit it replaced misses by 2.5pp; the carry and the smile each line was priced on are read back from its disclosure. Chromium against `page.route` stubs, no server. |
| `tests/markets-contract.mjs`, `tests/market-ticker-render.mjs` | The Yahoo parse against dated five-day responses (weekend, Tokyo morning, null trailing bar, no timestamps) and the strip rendered in Chromium with a fixed clock; neither starts a server. |
| `tests/landing-motion.mjs` | The landing page's motion in Chromium with no server: under reduced motion the particle field draws one still frame (eight passes, as bright as the settled trail the old loop built; a single pass measures 0.56 of it), draws it once at load and once per viewport change, redraws it at the device scale after a context restore, and fires no animation frame after the first second; the marquee's Pause button (WCAG 2.2.2) is reached by Tab, toggled by Enter, Space and a click whether or not it keeps focus, holds after focus leaves, and stays under reduced motion because the prices still auto-update; a refresh that lands while paused is held until Play in both views, a Pause and Play with nothing held leaves the bar and its focused control in place, and a refresh while playing renders at once; the bar stays below the footer at 320, 390 and 1280 px. |
| `shared/flows-time.js`, `tests/flows-time.mjs` | The Türkiye-time oracle, a leaf over `flows-freshness.js` alone. TRT is fixed UTC+3 arithmetic labelled with the literal `TRT` (Türkiye has no daylight time; the test proves it equal to `Europe/Istanbul` at every half hour of 2026-2028). `instantOf` takes a finite positive number, a `Date` or an ISO string with a time and an explicit `Z` or offset and answers null for a date-only, zone-less or impossible value, so a reader prints the dash; `clock`, `stamp`, `day` and `when` print TRT; `axisMinutes(v, sessionDay)` is minutes since 00:00 TRT of the session day, so a chart axis stays strictly increasing across TRT midnight when the winter close is 00:00, and `tick(m)` prints it modulo a day (never 24:00). `boundaries(day, clock)` derives pre-market, open, close and after-hours end in TRT only from `sessionOpen`, `sessionClose`, `easternInstant` and `closeMinutes`: 16:30 to 23:00 in US summer time, 17:30 to 00:00 in standard time, early closes 20:00 and 21:00; `sessionSaid`, `phaseSaid` and `nextOpenSaid` are the wordings. No importer yet, no asset. `TRT` is also in the Worker's `ASK_NOT_TICKERS`, because it is a real ticker. |
| `shared/flows-freshness.js` | The Eastern clock (arithmetic, proven equal to the IANA zone), market phases, the freshness threshold table, `X-Fresh-*` headers, and the live clock's due-tests. |
| `shared/flows-plan-facts.js`, `tests/flows-plan-facts.mjs` | Every platform cap per plan in one table, a leaf that imports nothing. `RESOURCES` is the meter list (vendor day and minute, D1, Worker, Durable Object, Workers AI, Analytics Engine, R2, Queues, Logs, GitHub), `FACTS` the other caps; each cell carries its source id (`SOURCES`: page, how it was read, date) and the Free cell is the downgrade column, the Paid cell the design column. `FLOWS_PLAN_WORKERS` is `free` or `paid` (unset: `paid`; a misspelt value: `free`), `FLOWS_UW_PLAN` is `unknown`, `advanced`, `startup`, `startup-annual` or `kafka` (unset or unrecognised: `unknown`, the minimum of each vendor row); `wrangler.toml` and the nightly's build step both record `advanced`, the API Advanced plan the owner's screenshot of the vendor's dashboard named on 2026-10-19 (source `uw.dashboard`: 100M daily requests included, kept as the day cap although the page also says unlimited requests per day; a two-year lookback, 730 days; the daily window resetting at 20:00 ET, the clock fact `uw.reset`; websockets included, quoted in the source because the table has no entitlement cells), and staging records none. The dashboard states no minute or concurrency line, so those Advanced cells stay null, and a null line that has an `ADVISORY` entry resolves to it (`capFrom` `advisory`, `capSource` naming where the cap came from): the minute line every governor and budget reads on Advanced is the 500 working line, never unlimited. `vendorDay(env)` is the stated reset with its source and date, or `assumed` for a plan whose window nobody has read. `lines(env)` is the one view a governor or a budget test reads; no other file reads either variable. `renewalState` reports the Workers Paid period and does not change a line. |
| `tests/flows-vendor-budget.mjs` | The vendor-budget contract, no server: the enforced per-minute ceilings (the rail's `callsPerMinute` through `hubConfig`, the `UW_ONDEMAND` and `MEMBER_VENDOR` limiters parsed from `wrangler.toml`) summed against `lines(env)['uw.min']` of `shared/flows-plan-facts.js` for every vendor plan and for the unread plan's minimum (Advanced, which states no minute line, held to the 500 working line, so its 603 is the same expected breach), the plan recorded in `wrangler.toml` moving no enforced ceiling while its day line rises to 100M, a rail ceiling raised past the line flagged as a breach, the vendor lines unmoved by `FLOWS_PLAN_WORKERS`, and the downgrade checklist of enforced settings above the Free column (today only the AI neuron cap). The governor reads the same table. |
| `shared/flows-ledger.js` | The per-day session ledger: the `flows_ledger` DDL, the statement builders the Tier 1 tick, the focus tick, the heartbeat write and the nightly's `meta` write append to a batch they already issue, the gap limits (the stale lines of `FRESH_CLASSES`), the view served as `ledger` on the ingest `clock` key, and the worst-key lapse the Tier 1 tick reads from the live rows. |
| `shared/flows-live.js`, `shared/flows-live-worker.js` | The live layer's key registry and pure builders; the Worker's Tier 1 tick, dispatch, watchdog, live ingest, `/api/flows/lk`, `/now`, `/tape` and read-time overlays. A strip row ends in `qa`, the vendor's `quote_time` as seconds behind the read, and the key's `ahead { n, maxS }` counts the stamps that run later than the read; `priorCloseBase` and `shapeStrips` fill a null `prev_close` from the last dated nightly close and say so in `prevFill`, and hold out a row the vendor dates before the session as an all-null row (DEPLOY.md 10.5i). `live:alerts:head` is the compact head of the same alerts record (the 20 largest-premium windows as facts, at most 8 KiB, breadth class, Actions writer): `shapeAlertsHead` builds it from the merged `live:alerts` payload the pass has just written, stamps it with that record's own `readAt` and vendor cursor, makes no vendor call, and `live.mjs` writes it only when `live:alerts` itself was written; it is the input compact enough for a model job to read without parsing the 120 KiB record. |
| `shared/flows-oidc.js` | The live credential: the GitHub OIDC claim policy (this repository by id, `flows-live.yml` on main), the pure JWT verifier the Worker runs, and the runner-side token request the `--live` leg uses. No shared secret. |
| `scripts/flows-legs/live.mjs`, `live-fake.mjs` | The Actions `--live` leg (Tier 2, `live:*` keys only) and its fake vendor for `--dry-run`. `runLiveLoop` keeps the loop alive between sessions when handed a `watch`, and `chainDispatch` sends any workflow_dispatch with the job's own token. |
| `scripts/flows-legs/witness.mjs`, `starts.mjs`, `watch.mjs` | The loop's mutual witness (Tier 1 older than 25 minutes, `live:breadth` older than 45, the nightly not landed by 21:00 ET, a broken chain, a blind ingest door; one deduplicated GitHub Issue per check, written and adopted only as `github-actions[bot]`, closed after three healthy ticks and reopened on a flap), the 17:30 ET nightly dispatch with the job's own token (a permanent refusal capped at four calls, a transient one retried every half hour to 20:30 ET), and the per-tick composition of the two over the OIDC ingest door. |
| `scripts/flows-legs/live-world-fake.mjs`, `live-day.mjs` | A fake GitHub API and a fake Worker world on a virtual clock, and the eight dry days `--live --dry-run` runs through them. |
| `shared/flows-basis.js`, `tests/flows-basis-contract.mjs` | The premium desk's basis: the vendor's `{data:{...}}` stock-state envelope, a spot that is only a regular-session price (`printOf`: the live print in the regular session, else the newest regular close), and the coherence gate between that spot and the chain (`coherence`: impossible asks, the strike bracket the `maybe_otm_only` request guarantees, one underlying fitted to the nearest expiries, a rebase past 0.25% or a refusal when the fit is too thin). The contract runs the Worker route in Node against a stubbed vendor. The desk's `asOf` is the New York date of the READ and `days` count from it; `UW_NOW` (an ISO instant, honoured only while `UW_BASE` redirects the vendor away from production) pins that read clock so the workerd suites' dated fixtures stay valid. |
| `shared/flows-vendor-core.js`, `tests/flows-rt-contract.mjs` | The pure leaf every vendor client reads: `vendorBaseInfo` and `vendorBase` accept `UW_BASE` only as the production origin, `http(s)` loopback (`127.0.0.1`, `localhost`) or an `http(s)` `*.test` host with no credentials, path, query or fragment, and otherwise answer the production origin with status `invalid`; `vendorRedirected` is true only for a loopback or `.test` base and is what unlocks the test-only `UW_NOW` and `FLOWS_RT_SCALE`; `vendorUrl`, `unwrap` (the vendor's `{data}` envelope), `classifyStatus` (`http_429`, `http_5xx`, `http_4xx`) and `retryAfterMs`. `uwFetch` in `worker.js` and the rail's REST adapter use it; the pipeline and the legs still read `FLOWS_UW_BASE_URL` directly. The allowed and refused base table is in `flows-rt-contract`, the Worker half in `flows-basis-contract`. |
| `shared/flows-vendor-ops.js` | The vendor operation registry, a data-only leaf: one entry for each of the 75 operations production reads, with `id`, `path` (the call template; `op` is the spec's operation when the two differ), `plan`, `licence`, `envelope`, `klass` (a `PACKET_CLASSES` name), `limiter` (`ondemand` for an operation the Worker serves on demand, `null` for one only an engine reads), `liveOnly`, `maxBytes` and `reads` (the fields the code reads, which the weekly probe holds strict); `opById`, `pathFor(id, params)` (each parameter is encoded as one path segment and a missing one is refused), `opsFor(limiter)`, `BUDGETS` (the consumer ceilings and windows) and `PLAN` (the observed key and the Startup plan). No vendor path is spelled anywhere else in `worker.js`, `shared/` or `scripts/` outside the fakes, `scripts/flows-probe.mjs` derives its strict read list from here, and `tests/flows-probe-contract.mjs` scans for a stray literal, holds every entry to the committed spec or `liveOnly`, and holds each `BUDGETS` figure equal to the code constant it names. |
| `shared/flows-tape-stats.js`, `tests/flows-tape-stats.mjs` | The option-print classifier, a leaf that imports nothing and reads no clock: `tierOf` sorts a fill against the NBBO into A (at or above the ask), a, m (the midpoint), b, B (at or below the bid) or n (no usable quote); `sideTagOf` reads the vendor's one side tag and `classifyPrint` returns the row (`side` -1, 0 or +1, `tier`, `tag`, `parity`, `basis`, a `flags` bitmask, `signed`). Where the tag and the tier disagree the print is unsigned and counted, never guessed. `sweepOf` reads both encodings of a sweep, `report_flags` containing `intermarket_sweep` or an upstream code (`upstream_condition_detail` on REST, `trade_code` on the socket) containing the whole token `isoi`, and never the equity enum. Multi-leg codes, canceled prints and the `dividend` and `arbitrage` tags keep a print out of every signed total; a large print exists only as ten times a premium floor the caller states. `aggregate` sums asked, bid and unclassified premium over rolling windows and `reconciles` holds them to gross within 1e-9; `askSplit`, `askShare` and `askShareRead` are the one ask-share definition, the rule of `tests/fixtures-ask-share.json` (a side counts only as a non-negative number, a window needs a positive premium, sides past the premium are scaled to it, windows are pooled, the coverage is sided dollars over every positive premium, and 0.65, 0.35 and 0.5 are compared as the whole percents printed). `tests/flows-tape-stats.mjs` runs synthetic tapes only, because the repository is public, and reads `tests/fixtures-ask-share.json` when that table is in the tree. |
| `shared/flows-premium.js`, `tests/flows-premium-contract.mjs` | The premium desk's ranking: gates, annualization, the strike divisor and `rankChain`. Its mid implied volatility inverts against a per-expiry forward (`forwardPlan`): the chain's own put-call parity over up to ten near-the-money two-sided pairs (mid of at least 0.05, spread under half the mid) when there are three or more, else the card's implied carry (`deskCarry`: grade 2 or better, and only when `coherence` returned `ok`), else the rate alone. A parity forward or a carry whose log gap from the rate forward exceeds `forwardGapLimit(years)` (2% plus 0.5 a year, capped at 15%) is not believed. A rebased chain takes no carry because its fitted spot has already absorbed the carry over the fit horizon, the nearest expiries, only: later expiries of a rebased chain keep the rate-only forward unless parity places them, so their mid IV stays biased (about 1.1 vol points at 180 days and 2.1 at 360 days at a 3% carry on an out-of-the-money-only chain), a limit pinned in `tests/flows-basis-contract.mjs`. `rankChain` returns the choice per expiry as `forwards` (an empty list on a `mismatch` payload). It also holds the short-call oracle the Short calls view is held to: `SC_DEFAULTS`, `roundCents` (integer cents, half-up), `parseContracts`, `parsePercent`, `shortCallCollateral` (delta-adjusted, Reg-T style, shares held), `dividendsToExpiry`, `shortCallLine` and `planShortCalls`. Sizing carries time value beside cash: `sizeToBuyingPower` returns `collectible` (the cash in), `timeValue` and `intrinsicValue` in integer cents, and `yieldOnDeployed` is time value over what is deployed, so an in-the-money line no longer counts its in-the-money value as a return; `betterDeployment` is the one comparator (most time value, then the smaller deployment) that `planBuyingPower` and `planShortCalls` pick the best line by, and a line with no time value is never best. `priceSale` snaps a difference under a nano-dollar to zero, so a bid equal to the intrinsic value has exactly zero time value. `crossesEarnings(expiry, date, announce, { asOf, readMs })` answers `null` when the report precedes every possible sale (`reportPrecedesSale`, with `saleDayOf` rolling to the next session after the close, DST and early closes included) and `rankChain` names each expiry's forward figure `F` beside its method. |
| `shared/flows-focus.js` | The home page's focus roster (Gold, Silver and Copper groups, the Mag 7, the metal funds and miners), the owner's holdings (`OWNER_HOLDINGS`: NASA, admitted to the universe past the ETF and liquidity gate by `ownerHeld` in `scripts/flows-nightly/rank.mjs` and guaranteed a deep card every night) and the NASDAQ-10 derivation from QQQ holdings. A leaf module: it imports nothing, so the Worker, the pipeline and the live leg can all read it without a cycle. |
| `scripts/flows-legs/focus.mjs`, `health.mjs` | The nightly `focus` and `roster` payload builders; the nightly health gate and its repair messages. |
| `scripts/flows-ws-probe.mjs`, `.github/workflows/flows-ws-probe.yml`, `tests/flows-ws-probe-contract.mjs` | The vendor socket probe, dispatch only: handshake three ways, one connection per channel from one list led by a negative control (`w03_nonexistent_channel_zz`), five firehoses at 5 s each, concurrent connections, joins per connection, lag against each frame's own stamp; per channel messages and bytes a second, inter-arrival p50/p95 and `created_at - executed_at` for prints. It prints key names and statistics, never payload values or the token, and its start record carries the computed duration the workflow's 30-minute timeout must cover. The contract runs it against a fake vendor that speaks the WebSocket protocol by hand. |
| `shared/flows-quant-dealer.js` | The dealer gamma profile (`gammaProfile`): a leaf with no imports. Per contract it precomputes `1/(sigma sqrt(T))`, the affine part of d1 in ln x and the signed weight, so each grid point is one logarithm and one exponential per contract instead of a full set of Black-Scholes greeks; output equals the greeks-based profile to 1e-12 of the profile's peak and the flip to 1e-9, at about a tenth of the CPU (`tests/flows-quant.mjs` holds the equality against a reference copy and the CPU ratio through `tests/lib/cpu-budget.mjs`). |
| `shared/flows-neuron-screen.js`, `tests/flows-neuron-screen.mjs` | `screenReading`: a Neuron reading from a universe row alone, for a name with no card. A leaf that imports the consolidated state table (`STATE_LINES`, `structuresForState` in `flows-neuron.js`), `BUCKET_LINES` and `sessionsBetween`, and is imported by no module that imports it back. Facts are graded 0 or 1 and each prints its unit; a null input is withheld under its own key with its reason; dealer delta and vanna are the vendor's numbers with no direction claimed, charm a sign only at grade 0. The test compares 27 synthetic states with `regimeState` and runs every emitted sentence through the ask guard. |
| `shared/flows-neuron-coverage.js` | The nightly's Neuron coverage ledger `{universe, priced, standAside, family, screen, unpriceable, expired, stale, missing}` (published in `meta.neuron`, checked by `neuronChecks` in `health.mjs`), built from each card's tier as the Worker would name it and the screen reading of every universe name that has no card. |
| `shared/flows-fact-ids.js`, `tests/flows-fact-ids.mjs`, `tests/fixtures-fact-ids.json` | The engine fact-id registry: one frozen entry per id `engineFacts` emits (`{meaning, unit, tenor, gradeRule, claimLines?, since, retired?}`), the `move.mad.<expiry>` family by prefix, `factEntry`, and the claim-line table `flows-neuron.js` re-exports as `CLAIM_LINES` (the `iv.*` ids use 0.25/0.75, `skew.rr25.30.pct` 0.2/0.8). A fact id never changes meaning: a new meaning is a new id and the old one is retired. `iv.pct.30`, the rank once stored under a percentile-looking id, is retired (`retired: {since, by}`, `retiredIds()`): `engineFacts` no longer emits it, it has no claim line and no label, and the dossier drops it from a card stored before the retirement (`RETIRED_ENGINE_FACTS`). The test holds every emitted id registered, every registered id emitted, every read of an engine id by the engine, the structures, the card, the Neuron and the reading (`ENGINE_LABELS`, `options.engine.<id>`) on a live entry, and the registry equal to the committed snapshot, which is append-only by review: a changed meaning, unit, tenor or claim line fails it with the instruction to retire the id. The dossier's packet ids outside `options.engine.*` are not registered. |
| `shared/flows-dossier.js`, `tests/flows-dossier-contract.mjs` | The per-name dossier, a leaf that imports only `flows-cross.js`: the packet model, one pure builder per kind (twelve), the sanitiser every third-party string passes, `renderDossierForModel`, `dossierFacts`, `dossierSilences`, `dossierFingerprint`. The contract runs it on the nightly payloads and the spec-conformant vendor fixtures, fuzzes the sanitiser, proves each reducer touches only the fields the weekly probe lists (a recording `Proxy`), and holds the fingerprint stable under price and age noise. |
| `shared/flows-dossier-vendor.js` | The vendor side of the dossier: `unwrap` of the `{data}` envelope, one reducer per route (13) that returns a small extract and names its fields (`DOSSIER_READS`, the list `scripts/flows-probe-list.json` holds strict; a spec name that `WIRE_RENAMES` maps to its wire name is read only as a fallback, the strict list holds the wire name instead, and the entry is retired when the spec is refreshed), and the dossier's quote extract. An extract whose shape changes carries `rv` (`EXTRACT_VERSIONS` in `flows-dossier.js`); a cached row without the current stamp is refetched on the next read rather than served for the rest of its TTL. No I/O. |
| `shared/flows-dossier-worker.js`, `tests/flows-dossier-reads.mjs`, `tests/dossier-harness.mjs`, `tests/dossier-fixtures.mjs` | `assembleDossier(env, ctx, ticker, deps, opts)`: the one primary-key D1 batch (`DOSSIER_SQL`, 13 statements), the vendor fan-out through the caller's `fetchVendor` and limiter, the `flows_dossier_cache` rows (`DOSSIER_SCHEMA_SQL`, `migrations/0016_flows_dossier_cache.sql`), the Cache API entries, the single flight and the 30-second assembled copy. `worker.js` supplies `uwFetch`, the limiter, the quote path and the route. The reads suite counts round trips, rows read, vendor calls and CPU on a counting D1 fake over `node:sqlite` and a stubbed vendor. |
| `tests/gen-probe-fixtures.py`, `tests/fixtures-live-probe.json`, `tests/fixtures-flows-legs-probe.json`, `tests/fixtures-vol-probe.json`, `tests/fixtures-flows-positioning.json` | The generator of the four fixtures that were once the first rows of one Actions probe run, now synthetic bodies built to the schema. Every row is invented (tickers `SYA101` and `SYB202`, `SYC303` and the like; the real symbols are only those the code keys on, such as `SPY` and `QQQ`) and every key and JSON type is checked against the observed wire shape in `scripts/flows-probe-shapes.json`, the generator exiting 1 where the two disagree; each file records `provenance.generator`, a `nature` that says it is not vendor data and the sha256 of the shape manifest, which `tests/flows-probe-contract.mjs` holds equal to the committed manifest. The consuming suites (`flows-basis`, `flows-legs`, `flows-live`, `flows-neuron-screen`, `flows-positioning`, `flows-vol`) work their expected figures by hand from these rows; run `python3 tests/gen-probe-fixtures.py` after a change to the manifest and read the diff. |
| `tests/gen-dossier-fixtures.py`, `tests/fixtures-dossier-vendor.json` | The vendor fixtures for the dossier, written from the 200-response schema of each operation in `docs/uw-openapi.yaml` and the wire names in `scripts/flows-probe-shapes.json`: JSON types, nullability and the string-typed numerics are checked against the spec and every key against the probe's observed shape, and the generator exits 1 where the two disagree (a key the wire did not carry, a declared rename the spec now documents, an unseen name the spec no longer lists); the spec's and the manifest's sha256 are in the file. `tests/flows-probe-contract.mjs` holds the probe list to the same names and the fixtures to the manifest, and fails any new fixture whose `source` calls its rows verbatim or from a live probe. |
| `shared/flows-reading.js`, `tests/flows-reading.mjs`, `tests/reading-archetypes.mjs` | The per-name reading's pure half, a leaf over `flows-dossier.js` and the Ask guard: the 22-code tag table and `heldTags` (every rule over grade-2 facts of an ok or partial packet, thresholds in `TAG_LINES`), `promptForReading`, `parseReading`, `vetReading`, `readingFallback`, `readingShape`, and `askPick` for the Ask box. `reading-archetypes.mjs` builds six dossiers from the harness (the harness name, earnings-week momentum, crowded short, quiet, no card, all vendor packets withheld). The suite holds each threshold from both sides, the fallback to the checks a model's wording must pass, and some thirty adversarial replies. |
| `shared/flows-reading-worker.js`, `tests/flows-reading-worker.mjs`, `tests/flows-reading-render.mjs` | `readingFor(env, ctx, ticker, deps, opts)`: the stored reading under `flows_neuron` scope `read:<T>`, the intraday floor, the fingerprint, the claim, the one capped model call in `ctx.waitUntil`, the cooldown after a refusal, `FLOWS_READ_MODE`. `worker.js` supplies the deps (`readingDeps`) and `summaryResponse`. The worker suite drives it through `worker.js` with a scripted AI binding and the dossier harness; the render suite is Chromium against `page.route` stubs of the ticker page. |
| `tests/flows-glance-frame-render.mjs` | The ticker's glance frame in Chromium against `page.route` stubs, no server: the top band, the verdict strip (the Neuron icon, eyebrow, one-line headline and engine chip, with no coverage bar and no agree or against wording), the reading rail (up to four numbered claims that dispatch `ft:focus` on hover and focus, the footnote line that swaps to a claim's cites, the all-sources and what-is-not-known popovers with TRT times), the dock and the in-place sheet (focus trap, inert page behind, Esc, arrows between tabs, the module returned to a same-height placeholder), the 1440x820 and 1920x1080 fit, the phone layout at 390 and 320, every reading state, and fourteen planted wrong builds. The chart and the six cards are stubbed behind `FlowsUI.tickerGlance.mount`. |
| `tests/flows-ticker-firstpaint-render.mjs` | The ticker's first paint on the card alone. `start()` in `flows-ticker.js` paints as soon as the card is in, after a 250 ms grace for the two fast dossier routes (`card-x`, `hist`); a route that has not answered is drawn as loading, never as absent (the reading rail says `Loading the reading.`, the verdict strip and card `Loading the Neuron's read.`, the dossier modules give `Loading this name's dossier.` as their reason) and is applied in place when it lands: the summary through `renderVerdict` (the rail, and the reading and claims handed to the glance's `update()`) and `buildWorlds`, card-x and hist through `paintDossier`, which rebuilds the dossier modules and the dock and hands card-x to `update()` without remounting the glance chart, dropping the surface view or closing a module open in place. `tests/flows-ticker-firstpaint-render.mjs` (Chromium, `page.route` over the dry-run emit's AAPL card, no server) holds each of summary, card-x and hist behind a gate the test opens (every delay counts from the page's request for the tape route, which it makes once the card is accepted, and the grace case holds the page's 250 ms timer until the first paint, so no ordering rests on the card's transfer time or the machine's load): the page paints with the summary out, with the dossier out and with all three out, a dossier inside the grace is in the first paint, a late dossier keeps the mounted chart node and the open sheet, and a summary at 1.5 s and 5 s or all three late end in the baseline's modules, verdict, strip, claims and glance cards with no duplicate id. Seven planted wrong builds must fail: the first paint waits on the summary, no grace, a late summary never applied, a late dossier never applied, a late dossier stored but not repainted, a late dossier that remounts the page, and a rail that says there is no reading while the summary loads. |
| `shared/flows-ai-salvage.js`, `tests/flows-ai-salvage.mjs` | The salvage leaf for a model reply that was cut off. `parseReadingPartial(text)` is a single-pass scanner (string, escape and depth state, no recursion, no eval) that returns every array element and top-level member that closed before the cut, marked `truncated`; `salvageReading(text, dossier, tags, opts)` vets that exactly as `vetReading` vets a whole reply, discards the model's own `unknown` list and puts `unknownEntries(dossier)` in its place with the note that the list of what is not known is the site's own, still needs `now` and a second section, and names `read:salvaged:<kept>` as its guard. `opts.trim` (off by default) also keeps the element cut inside its cites, cut back at a sentence boundary to the sentences the closed cites support and carrying only the cites a surviving sentence uses. It imports `flows-reading.js` and `flows-ask.js`, nothing imports it yet (the queue consumer and the output budget are F-45), and it makes no model call. The suite cuts nine valid replies at every UTF-8 byte offset and checks the items against the whole reply, the growth of the set, the sentence-boundary trims and the unknown list, and plants six wrong builds. |
| `shared/flows-targets.js`, `tests/flows-targets.mjs` | The canonical large-move targets, a leaf with no imports: the frozen definition table (35 ids: `move.k{2,3,4}.h{1,5}` with `.up` and `.dn`, `move.im{1,1.5,2}.h1`, `move.x{5,10,20}.h{1,5}`, `move.earn.im`, `move.earn.ratio`, `move.ret.h{1,5,21}` at the fifteen-quantile union, `move.live.res` as a reading, `move.z63.h{1,5}` as a sensitivity), its `TARGETS_VERSION` and `targetsHash` (a definition changed without a version bump fails the test's pinned history), `sigmaRef` (1.4826 x MAD of the trailing 252 regular-session, split-adjusted, break-free, non-event log returns, at least 200 else the name is not forecast and counted with the reason, `clockVersion` `sess-v0` with the weekend variance 0; a later estimate is a new id for new issues only), `impactSession(report_date, report_time)` (defined once, here), `threshold` and `resolves` (every event row carries a scale and a finite k, `move.earn.im` on `sigmaQE` of the impact session; a missing scale is `{ok:false, reason:"no scale"}` and resolves to null; the vendor's `implied_move_perc` is refused as a source), `earnRatio` within one track, `rarityText` (a k-multiple is always printed with how often such days occur for that name, the empirical route floored at 1 in 250, the model route at the audited `pFloor` it is given, the scan p printed `p below 0.00002` and never as 1 in N) and `cardField` (about 30 bytes a card). 670 names take about 40 ms of thread CPU. |
| `shared/flows-moves0.js`, `tests/flows-moves0.mjs` | The IV-days lens on Market's Extremes (Risers and Fallers, `Raw change` and `In IV-days`, on for the owner's account and off for members, the worker passing `rtIsOwner` to `marketPage` as `data-lens`) and the IV-days column in Home's Leaders. `m = chg / (iv30p / sqrt(252))`, with `iv30p` the previous trading day's 30-day IV (the vendor's `iv30d_1d`, never a current IV, which rises with the move and would rank the largest shocks lowest) and the vendor's `implied_move_perc` never a unit; a name with `iv30p` null or not positive is on no list, never zero; a name with earnings inside 21 sessions is ranked apart; the median and the count beyond 3 are over the clean names; one line of copy (`A ranking, not a test: no error rate measured.`) and the caption `IV as of the previous close.`, none of the words unusual, alert, screen or rare. The leaf is the oracle and the pages carry the one division, since a page cannot import a module; the test holds both pages to its digits. Market ranks one population at a time and names it: the whole nightly universe once the nightly for the live rows' session has landed, the live roster alone while the live session is newer, the nightly when the live rows are older or unavailable. Home reads `/api/flows/universe?cols=t,sec,chg,iv30p,ed` (14.5 KB of JSON for 670 names, about 3.3 KB gzipped) for the event mark and the nightly fallback. The order is held while a mouse pointer is on the module. Chromium against `page.route` stubs, no server. |
| `shared/flows-cross.js` | The `universe` payload's column store (`UNIVERSE_COLUMNS`, one integer column per key, decoded by `units`) and its 100 KiB budget, shed by column priority when over. The nightly's dealer columns are dollars per 1% move over average daily dollar volume (`gexAdv`, `dex`, `vanna`, `charm`) and keep the vendor's sign; `im5` and `im30` are the vendor's implied-move fractions. On 670 synthetic names the payload is 96,158 bytes without them, 108,249 with them unbudgeted, and 100,505 after the shedder drops `adx`, `dGamma` and `gexRatio`; `iv30p` (the vendor's `iv30d_1d`, the previous trading day's 30-day implied volatility, the denominator of the IV-days ranking) adds 2,681 bytes, so the same 670 names are 111,139 unbudgeted and 100,609 after the shedder drops `adx`, `dGamma`, `gexRatio` and `dIv1m` (priority 5, no reader). `iv30p` is priority 1 and is never shed, and `charm` is priority 3 so the Neuron screen keeps it; `tests/flows-legs-contract.mjs` holds both on the 670-name fixture. The run's `shed` list is the measurement that counts. `projectionColumns` and `projectUniverse` serve `GET /api/flows/universe?cols=t,sec,chg,iv30p,ed` (one to twelve column names, normalised and sorted, a 400 `invalid_cols` otherwise): the asked columns of the one payload row, about 14.5 KB for 670 names and five columns, kept in the Cache API for 300 s so a repeat read costs 0 D1 rows, never written over the whole universe's last good copy. |
| `assets/js/flows-fresh.js` | The client freshness helper (`FlowsUI.freshFrom`, `heartbeat`); every key a heartbeat reads registers its server verdict with the pill, which is the worst case over its sources, so a page needs no line per region. The pill says Live only when the market is open, the page has at least one entry registered `role: "primary"` (the rail registers the topics a page connects for: `px` where it asks for it) and every primary entry is inside its own live window with none stale (`FlowsUI.freshAll`, in `flows-ui.js`); the pill repaints itself when that window closes, a page with no primary entry never says Live and reads `Fresh · <age of the newest price read>`, and a `secondary` entry that is not live is listed in the details and demotes the pill to Fresh only when it is stale. |
| `tests/flows-live-contract.mjs` | Live-layer builders, phases and states, byte ceilings, the one-writer scans, the `--live` dry run and the client helper. |
| `shared/flows-rt.js` | The real-time rail's pure half: the frozen envelope, topic table, row columns and close codes, the owner switches (`rtSwitches`), `streamEntry` (the `entryOf` shape plus the lag guard), the parse of the 256-byte client messages, per-topic sequence counter and `createSeq` gap detector, the 240-call budget, lag statistics, the latest-wins and append-dedupe merges, the REST shapers `shapePx`, `shapeFl`, `shapeGx`, `shapeMk`, `shapeNw` (vendor body to neutral frame, calling the stored live keys' own shapers), `mergeTopic`, and `RT_UPSTREAM`, the one table from topic to REST request and to vendor socket channels. |
| `shared/flows-rt-socket.js` | The vendor socket upstream's pure half (P2-30): the socket URL (the only place the token is put in a URL), the channels a demand wants (per-ticker only, at most eight price and three gex), the ack and data parser, the backoff table, and the shapers that turn a socket payload into the same neutral frame and row the REST shapers give (`patchPxRow` and `mergePxRow` keep a focus name's option-flow columns current under a socket price). |
| `shared/flows-rt-hub.js` | `RtHub` (demand, roster, scheduler tick, merge, frames, degrade and resync, hello, status; no REST in it), `createRestUpstream` (the REST adapter: every path, cursor, rotation, deadline and 429 pause lives here), `createSocketUpstream` and `createCompositeUpstream` (the vendor socket upstream behind `FLOWS_RT_UPSTREAM`, shared by every member), `createHub`, `loadRosterFromD1` (one read-only batch) and the `Pulse` Durable Object class wiring hibernatable sockets and alarms to the hub. Imports no `cloudflare:workers`, so Node loads it. |
| `shared/flows-rt-routes.js` | `serveRt`: `/api/rt/ws`, `/api/rt/snap`, `/api/rt/status` inside `route()`; the kill switches, the audience gate, the origin check, and the forward to the one named object. |
| `tests/flows-rt-contract.mjs`, `tests/rt-fixtures.mjs` | The rail with no server: envelope, shaper parity with the stored keys, merges, sequences, freshness classes and the lag guard, the adapter against a stub vendor, the hub on a fake clock (demand, closed sessions, degrade and recovery, hibernation, kill switches), the routes against a fake namespace, the roster SQL over `node:sqlite`, and CPU and bytes per poll. `rt-fixtures.mjs` is the shared fake vendor. |
| `tests/flows-rt-server.mjs`, `tests/lib/ws-loopback.mjs` | The rail in real workerd with persisted Durable Object storage, a loopback fake vendor and real WebSocket clients. `ws-loopback.mjs` is an RFC 6455 vendor stand-in on loopback (it acknowledges and refuses joins, ticks, closes and drops on demand) that the vendor socket block dials from the Durable Object. |
| `assets/js/flows-rt.js` | The rail's browser half, attached as `FlowsUI.rt`: one WebSocket per tab with refcounted topics, the ladder socket, then `GET /api/rt/snap` every 5 s, then the pages' own heartbeats (and `off` when the rail answers 401, 403 or 404), per-topic sequence and epoch handling (a gap sends `{t:"rs"}` and holds the topic until a snapshot; a new epoch discards its state), `rt:<topic>` freshness entries that are dropped when the transport falls, rAF-conflated listeners (`FlowsUI.rt.on`), and the adapters the pages read: `strips()` (px rows mapped back to the `live:strips` body, `fields` from `meta.cols`), `quote(t)`, `market(base)`, `alerts()`, `news()`, `gex(t)`, `feeds(k)`. It never touches the DOM. |
| `tests/flows-rt-client.mjs` | The client in Chromium with `page.routeWebSocket` and `page.route` stubs, no workerd: merges by quote time, sequence gaps, epoch changes, control frames, the bye codes, reconnect backoff on a paused fake clock, the ladder down and back up, freshness entries dropped, a hidden tab, the 256-byte cap, the board, home, unusual, market and ticker pages fed from the stream, a hostile headline that never reaches `innerHTML`, timer and listener census after close, the existing heartbeat unchanged, and the client against the real `RtHub` over a bridged socket (a lost frame, a restart, a vendor outage). `RT_ONLY=measure` prints the receive-path cost, DOM writes and bytes a minute instead. |
| `assets/js/flows-link.js`, `tests/flows-link.mjs` | `FlowsUI.link`, the one selection and time-cursor mechanism, added to the existing global. `flows-ui.js` carries a queue stub; the first `join` (or any `emit` or `cursor`) loads this body from beside `flows-ui.js` with the same `?v=` and `attach` drains the queue. `join(owner, {channel A, B, C or null, kinds, clocks, on})` returns `{leave}`; `emit(owner, {kind ticker, sector, strike, expiry, side or time, value, source})` is refused unless the value passes the kind's validator; the last emission per channel wins and each member is called at most once per animation frame, never for its own emission; a member that joins late is handed the current selection; focus never moves; announcements go through one polite live region at most every five seconds; `cursor({tau, clock known or event})` carries its clock and a member that lists only the other clock is not handed it and the page is told; `describe()` is `{scene, mode, tau, clock, selection}` in at most 256 bytes. The state is the URL hash `#l=A:t=NVDA;B:s=XLK;tc=known@2026-10-05T14:41:00Z` and nothing else: no browser storage. A second window shares it only when asked: `popout(path)` (a path on this origin) adds a random `w=<16 hex>` group token to the hash, opens the path on the current selection and joins a `BroadcastChannel` named for the token; the other window opens on that hash and joins the same channel, each local change travels once as a delta, a message that is not a valid selection is ignored, and a received change is never sent back. The Network pop-out is `/flows/network/` (`networkPage`, controller `assets/js/flows-popout.js`), opened by the Market Network tab's Pop out button; the Now list's pop-out is `/flows/now/` (`nowPage`, controller `assets/js/flows-now.js`). The test is Chromium with `page.route` and no server. |
| `FlowsUI.defer`, `tests/flows-weight.mjs`, `tests/flows-defer-render.mjs` | `FlowsUI.defer(group, {when, el, label})` loads a group of scripts after the page's `load` event and returns a promise that resolves when they have run. A group is declared in the page as one `<i hidden data-defer="<group>" data-src="${v(path)}">` element per file (a list in one `data-src` is refused: the version scan cannot see past its first URL) and runs in declared order, one file after another: the next is requested only when the one before it has run, and the first failure stops the group, so a file never runs ahead of one it follows and a retry resumes at the file that failed. `when: "idle"` (default) waits for `requestIdleCallback` with a 1.5 s timeout; `when: "visible"` waits for `el` to come within 200 px of the viewport, then idle. Under `navigator.connection.saveData` the slot (`el`) gets a status line and a button and nothing is fetched until it is pressed; a failed fetch removes its script element, requests nothing further from the group and puts an unavailable line with Retry above the slot's own content, and the promise stays pending until a retry works. A second call for a group returns the first promise. `flows-ui.js` has one script loader, `loadJs`, shared by `defer` and the `FlowsUI.link` stub; `flows-dock.js` has the only other. The Unusual page loads `flows-net.js` this way (`defer("net", {when: "visible", el: #uaNet, label})`): the host is `.fn-host.is-slot` in the served HTML, so its height is reserved at first paint by container-query bands in `flows-net.css` (the mounted network's height at each card width, measured; the header's two-row wrap under 540 px too). When the alerts arrive empty, withheld, pending or failed, `flows-unusual.js` swaps `is-slot` for `.is-quiet`, whose own bands are the height of the network's empty state (about 450 to 790 px against 1,000 to 1,360 for the full scene), so the card is not a one-line message in a 1,100 px box once the network has mounted and nothing below it moves when it does; inside the Unusual page's one-screen stage `.fd-stage` instead lets the quiet host fill its own card and reserves nothing, because an absolutely placed card has nothing below it to move; a feed with rows swaps back. Until the module mounts it holds a table of the eight largest names by flagged premium with their lean by the convention, written by `flows-unusual.js` from the alerts it already has. `flows-defer-render` holds that nothing below the card moves when the network arrives, that the reservation never falls short of the mounted height by more than 6 px nor leaves more than 50 px empty at eleven widths on a fresh load, in the full scene and in the empty one (an empty feed and a 500 at 1440 and 390 px move nothing below the card, with a layout shift under 0.1), that a two-file group whose first file fails once requests nothing of the second and runs both in order after Retry, that Data Saver and a 404 leave the table in place, and that the request starts after the load event. `tests/flows-weight.mjs` weighs a route as its eager scripts plus the files `DEFERRED` lists for it (declared groups), the dock's `flows-ask.js` and the `flows-link.js` body, against a stated per-route allowance; it scans every `flows-*.js` for a second loader and for a `.defer("group")` call the route's `DEFERRED` entry does not list, runs the declaration checker on eight negative fixtures (a space and a comma in `data-src`, a file missing from `DEFERRED`, a table entry with no element on the page, an unversioned `data-src`, an element that is not hidden, a file that is also a script src, a file other than the table's), and prints the headroom of each route against the 1 KiB floor with the pending `EAGER_KERNEL` entries subtracted on live routes: the routes under the floor are the `BELOW_FLOOR` list, each with the row that relieves it, and the list must equal the computed set in both directions. The ticker's ceiling carries a named `TICKER_RAISE` (OD-08, 1,613 B, the cost of `FlowsUI.defer` on a route that defers no group): it is held at that size, asserted to be deleted as soon as the ticker defers as many bytes of group files as it was raised by, and printed on every run; the kernel entries state their size and a landed entry is measured against it (`FlowsUI.defer` 1.6 KB, so the V and L share of the kernel is held at 3.8 KB under the named `KERNEL_LIMIT` decision, not the 3.1 KB of section 2.10). `flows-defer-render` is Chromium with `page.route` and no server. |
| `assets/js/flows-overview-below.js`, `tests/flows-home-below-render.mjs`, `tests/lib/below-fold.mjs` | The Home page's deferred chunk (F-08 part a). `flows-overview.js` keeps the first-paint modules and the data reads; the painters of What changed, Volatility, Reporting and Headlines (`paintChanged`, `paintVol`, `paintEvents`, `paintNews`, `renderSpine`) are in this file, declared as `<i hidden data-defer="home-below">`, asked for with `FlowsUI.defer("home-below", {when: "visible", el: #hmChg})` and handed the helpers they use through `FlowsUI.homeKit` (the first-paint file publishes it before the chunk runs; the chunk calls `homeKit.attach` with the five painters and `homeKit.attached` says it has). A paint asked for before the chunk lands is held by key in `later()` and replayed from the current data when it does; one asked for afterwards runs at once. The bento puts What changed on the first screen at the xl, l and m fits, so the request is made after the load event and after the hero's first paint; at the s fit it waits for the Glance page of the pager and the other three pages request nothing. Until the chunk lands, Volatility, Reporting and Headlines show their own pending state and Reporting's numeral is a dash with that reason. The render test is Chromium and `page.route`, no server: no request before the load event, none at 390x844 before Glance opens, the hero and first-paint modules painted before the request, data before chunk and chunk before data, a 404 with Retry, Data Saver, 390 px, and the lower tiles' strip, compact and glance faces. The browser suites that read the lower modules open their pages through `revealBelow(browser)` (`tests/lib/below-fold.mjs`), whose flatten stylesheet turns the stage into a block of full-width tiles, makes the chunk's trigger fire at once and holds `page.goto` until it has attached. |
| `assets/js/flows-ticker-surface.js`, `tests/flows-surface-render.mjs`, `tests/lib/surface-card.mjs` | The ticker's Surface & terrain view, the second tab of the chart panel (`FlowsUI.tickerSurface`: `mount` and the pure `model.surface` and `model.terrain`), declared as `<i hidden data-defer="surface" id="ftSurface">` when `FLOWS_SCENES` is `on` (or `owner` and the member is an owner) and loaded by `FlowsUI.defer` when the tab opens. It replaces the old scenes module and the dock's Volatility surface and Gamma terrain buttons. Rows are the union of the gamma grid's expiries and the engine's, joined by `FlowsUI.tickerGlance.model.expiries`, so the chip row, the strike rail on the price view and these scenes read one list; a chip carries the engine's fit word (FITTED SVI, SVI, REPAIRED or NO FIT). Terrain: dealer gamma by strike and expiry as columns, heights to the 98th percentile (clipped at 1.25 times it, marked), a cell the vendor did not return a dashed outline and never a zero. Surface: the engine's stored SVI read through `FlowsQuant.sliceTotalVariance` in k = ln(K/F), total variance interpolated linearly in time at a fixed strike between consecutive fitted expiries (`between`), rows that span an expiry with no fit faded, an expiry with no fit a ring at its at-the-money level and never a curve, and a calendar check that scans total variance against time. Both share one camera and it orbits: pointer drag turns yaw (within 55 degrees) and pitch (8 to 60) and a flick glides on with inertia that decays out in under a second and stops at once on a touch; the wheel and a two-finger pinch zoom between 0.7 and 2.4; arrow keys, plus and minus, Home and a double click work from the keyboard and mouse; the Front, Side, Top and Reset buttons and Home glide the camera on an eased 520 ms path; an Auto toggle drifts the yaw gently once the reader has been still for 1.8 s, and it is off under reduced motion, in a hidden tab and out of view; a touch drag turns the scene sideways while `touch-action: pan-y` leaves vertical swipes to the page. One loop runs only while something moves (`data-motion` says moving, paused or rest, and the paint census is zero at rest). A fresh mount grows the bars and the mesh from the floor (640 ms, staggered by depth), an expiry change raises the chosen row, an update (`update(card)`, same shape only) tweens heights and implied vols from the old values over 520 ms, hover lights the column and row under the pointer with a rim, a lit crosshair and a floating readout whose figure counts up in 360 ms, and depth fog and a specular sheen shade the faces. Every settled frame is the frame a fresh reduced-motion mount draws, pixel for pixel, and the readout lands on the cell's exact value. Mesh vertices, cell geometry and the lookup table of colours are cached on the model and drawn from typed arrays, so a frame of both scenes costs about 2 ms and allocates tens of kilobytes. Strike, expiry and level labels go through one declutter pass that drops what would overlap and records every box, canvases are described with a table fallback, and on a phone the three columns are swipeable cards. A card with neither a smile nor a gamma grid shows the withheld reason. `tests/flows-surface-render.mjs` (Chromium, `page.route`, no server) holds the strike rail to the price axis within 1 px, the expiry cursor and its one-sigma band, 25-delta strikes, risk reversal and butterfly to an independent solve and to the engine's stored figures, null cells, thinned time-axis labels, the tab and keyboard, the calendar check, withheld states, the orbit, glide, zoom, auto-rotate, hover, tween, census, cost and touch checks and twenty-five planted wrong builds. `tests/lib/surface-card.mjs` builds its synthetic card. |
| `assets/js/flows-ticker-glance.js`, `tests/flows-glance-render.mjs` | The ticker glance's hero chart and six instrument cards, attached as `FlowsUI.tickerGlance` (`mount(card, hosts, opts)` and the pure `model(card, range, extra)` with `layout`, `cluster`, `cards`, `readout`, `describe`, `claims` and `evidence` beside it). `mount` fills two hosts, `ftGlanceChart` and `ftGlanceCards`, and returns `{ setRange, setExpiry, expiry, attach, update, destroy }` (`attach(hook)` is the seam the deferred live layer binds through); `opts` is `{ reading, summary, range }` plus `cardX` and `tape`, the two payloads the card alone does not carry (the dossier companion for earnings, short volume, insiders, the cone and NOPE, and the live tape for the session's cumulative premium), and `update({ reading, claims, cardX, tape, card })` repaints. The chart is one SVG sized from its host: closes for 20, 63, 126 or 252 sessions back, today, and 20 sessions forward in which Q (the card's implied range, orange, solid edges) and P (its realised range, blue, dashed) widen with the square root of time from the variance per session each range implies, both stepped at the report (half a session after the close for an after-close report, before for a pre-open one) by the implied event move for Q and the median realised report move for P, and no step when the report is not inside the horizon; the call wall, put wall, max pain, flip and spot as lines with right-edge labels placed by one clustering rule (labels merge into a stack a label height apart, centred on the mean of their levels, held inside the plot); the gamma dealers added today by strike as bars scaled to the largest, blue long and hatched orange short, under a header with the book figure on the vendor's convention; the Flows score by session under the price on one scale, today's bar emphasised; and a legend row that names, instead of drawing, every layer the card cannot supply. The chart is one tab stop whose arrow keys, Home, End and Escape move a crosshair across the sessions with the reading in a polite live region; its accessible description carries the close, both moves, the report, the levels and the dealer clause. The six cards (Signal, Volatility, Flow, Positioning, Earnings, Range) take each figure from the same card fields the lower modules read, show an em dash with the reason in the footer line when the input is absent, and become 68 px tiles of a title, a figure and a unit below 641 px of container width. Linking is a document event, `ft:focus` with `{ id, source }` (`mark`, `card` or `claim`): with a reading, claims are numbered in reading order (the `now` section, the drivers, the tensions, then the watch list, at most four, or `opts.claims`), `EVIDENCE` maps fact ids to layers and cards by prefix, marks stand on the first layer a claim evidences (flip, report, gamma, walls, cone), every layer and card declares `data-claims`, and a focused claim keeps its evidence and steps everything else back; with no reading there are no marks, no `data-claims` and no dimming. Every colour is a class on a token under the `.ftg-` rules of `flows-ticker.css`. `tests/flows-glance-render.mjs` (Chromium, `page.route`, no server) holds the cone, the step, the labels, the bars and every card figure to independent computations on the dry-run emit's real card, the absent-input states, the range control, the dimming, keyboard, sizing at 1440, 1920, 390 and 320 px, reduced motion, and thirteen planted wrong builds. Strike rail (current): when the card carries expiries, the right of the chart is no longer the aggregate gamma profile but a rail on the same price axis (`model.expiries`, `defaultExpiry`, `skew`, `miniRail`): dealer gamma by strike for the chosen expiry (a cell not returned is a dashed outline, never a zero), the smile with 25-delta put and call markers and the quotes the card holds, a one-sigma band of spot times exp(plus or minus the expiry's at-the-money volatility times the square root of T), and clickable expiry ticks on the forward axis (a radio group; labels thinned so none overlap the today label) that move the expiry cursor and announce `ft:expiry`. Under about 600 px the rail drops below as an expiry chip row and two mini charts. The 25-delta strikes come from `FlowsQuant.skewMetrics`, exported by the read bundle with `sliceTotalVariance`. |
| `assets/js/flows-ticker-live.js`, `tests/flows-glance-live-render.mjs` | The ticker glance's live layer, the deferred group `live`. `tickerPage` always declares `<i hidden data-defer="live" id="ftLive">`; `flows-ticker.js` connects the rail for `px`, `fl` and `gx` naming its own ticker and asks for the group with `FlowsUI.defer("live")` only in the regular session, on the first streamed quote or the first heartbeat that says `rth`, so a closed market never fetches it. The file adds `FlowsUI.tickerLive` (`start`, `state`, and the pure `model.geom`, `pathOf`, `sentence`, `flagged` and `flowFoot`) and binds to the mounted glance through `mount.attach(hook)`, the one seam `flows-ticker-glance.js` opens: the hook's `input` hands `model` the live price (`last`, which turns the right-edge label from Spot to Last and widens the y domain by the same 6 per cent pad only when the price leaves it) and a sticky domain (`dom`, never shrinking within one card and range), `drawn` and `cards` run after each full paint, `said` extends the chart's description, and `update` patches a session flow refresh into the Flow card in place. The price is drawn only while the rail's `px` entry is live by its own state (`FlowsUI.freshFrom` over `FlowsUI.rt.fresh("px")`, read again at the end of its live window and whenever the pill changes state); a stale, lagging or absent quote draws nothing, never a zero, and the description says why. In the today slot (from the card close to the next session, the session's own minutes in TRT from `F.open` over 390) it draws a dashed connector from the card close, the intraday path (points at least 10 s apart, at most 720, a gap over 150 s breaks it), a halo and a dot, turns the card-close dot into a hollow anchor and the axis date to the live session, and prints `Last <price> · HH:MM TRT` in the legend row; the today marker does not move. Each tick writes only the attributes that changed on the same elements; the svg is rebuilt only when the price leaves the domain or the quote stops being live. `gx` prints `Dealer γ now <$> per 1%` with the vendor's convention clause in its title and in the description, apart from the nightly gamma; `fl` rows the page already holds add `flagged <n> <$>` to the Flow card's foot. The pill prints `Live · <s> s behind the vendor` (the hub's read minus the quote's own stamp, hidden under 900 px). A heartbeat quote older than the streamed one keeps the streamed price, so the hero and the chart agree. No new request, payload, vendor or model call, no frame loop and no animation. `tests/flows-glance-live-render.mjs` (Chromium, `page.route` and `page.routeWebSocket`, a fake clock, no server) serves the real ticker page against the dry-run emit with rail frames and holds the dot to the model's own scale at every tick, the label, stamp, hero and pill, the same svg and path elements with zero removed nodes and no layout shift, zero writes at rest, the gx and fl patches, a session flow refresh that touches only the Flow card, one repaint when the price leaves the domain, the stale, silent and absent feeds, the requests made, the return to the closed look, reduced motion, 390 and 320 px, a closed market that never fetches the chunk, and eight planted wrong builds. |
| `assets/js/flows-ticker-movelab.js`, `tests/flows-movelab-render.mjs` | The Move lab on the ticker page, for every member. `tickerPage` always declares `<i hidden data-defer="movelab" id="ftMoveLab">`; `flows-ticker.js` adds `buildMoveLab`, which makes the `m-movelab` module for a card that is not an index or a fund and asks for the group with `FlowsUI.defer("movelab", {when: "visible"})`, handing the file the card, the card-x record, the card's spot and its daily closes. The file adds `FlowsUI.moveLab` (`mount`, and the pure `model`, `inputOf`, `rowOf`, `returnsOf`, `counted`, `frequency` and `fmt` the suite reads) and reads `GET /api/flows/universe?cols=ed,f2,f3,sig,t` once, only when the module nears the viewport. Three blocks. A size ladder of 1, 2, 3 and 4 times the name's typical daily move (`sig`, a fraction the nightly run publishes at scale 1e5; a figure of a quarter of the price or more is refused as a unit slip), each size with the price after a rise and after a fall (`spot x (1 +/- k x sig)`, to the cent), how many of the last 252 sessions moved that far (`f2` and `f3` for two and three times, report days left out; the card's own closes for one and four times, report days kept in, scaled to 252 when fewer returns are held and refused under 200) and how rare that is, in the sentence `frequencyText` writes, floor of 1 in 250 and an interval from five hits included, never a model probability. The options market's own implied move to the nearest end-of-week expiry from `panels.pricedMove` (`movePerc`, `low`, `high`), printed as the market's number and not a forecast. The earnings report, tagged event-contaminated when it is 21 sessions or fewer away (the card's `earnings.next.sessions`, else the universe's `ed`), with the market's report move. An absent input is a dash and its reason (no column, no row, too little history, no quote), never a zero, and a failed universe read offers Retry. A closing line says what the lab is not. No vendor call, no model call, no new global, no statistics jargon in its copy. `tests/flows-movelab-render.mjs` (Chromium, `page.route`, no server) holds every printed figure to an exact integer computation, `frequencyText` for all 253 counts and `sigmaRef`'s returns for the card counts, then the absent states, keyboard, touch hit areas, contrast, reduced motion and the 320 to 1440 px layout, and fails the planted wrong builds (the typical day taken as a percent, up and down swapped, the floor missing, and fifteen more). |
| `assets/js/flows-unusual-below.js`, `tests/flows-flow-below-render.mjs` | The Flow page's deferred chunk (F-08 part b), built the way the Home one is. `flows-unusual.js` keeps the head, chips, filters, the network slot, the take/load/stream code and the silences; the painters of the five lower modules (`paintTimeline`, `paintNames`, `paintUrgency`, `paintFeed`, `paintSurprise` and their notes builders) are in this file, declared as `<i hidden data-defer="flow-below">` and asked for with `FlowsUI.defer("flow-below", {when: "visible", el: #uaTimelineCard})`. The shared state and helpers go through `FlowsUI.flowKit` (`attach`, `attached`); a paint asked for earlier is held by key in `later()` and replayed from the current state, a filter pressed before the chunk lands is applied when it does, and the unavailable, pending and withheld states of Timeline, Names and Urgency are drawn by the first-paint file, so they show without the chunk. |
| `assets/js/flows-market-below.js`, `tests/flows-market-below-render.mjs` | The Market page's deferred chunk (F-08 part c), built the way Home's and Flow's are. `flows-market.js` keeps the head, the Tide, Breadth and Tape, the three index ETFs, Sector tides, the stale pill, the pulse stamp and every data read; the painters of Momentum, Extremes, Against the tape, the six pulse modules (Volume, Open interest, Net impact, Insiders, Dark pool, Seasonality), Advancers, Expiry, Volatility, Radar and Groups are in this file, declared as `<i hidden data-defer="market-below">` and asked for with `FlowsUI.defer("market-below", {when: "visible", el: #mkSectorsCard})`. Unlike Home's and Flow's, the request is made after the upper modules have drawn, from inside the data callback, because the Tide and Breadth have no reserved height and the trigger would otherwise be measured on the empty layout and fire at once. The shared helpers go through `FlowsUI.marketKit` (`attach`, `attached`); a paint asked for earlier is held by key in `later()` and replayed from the current data. |
| `scripts/approval-scene.mjs`, `scripts/approval-worlds.mjs`, `scripts/approval-frames.mjs`, `scripts/approval-checks.mjs`, `tests/fixtures-approval/`, `tests/approval-frames.mjs` | The approval render set of the Frontier programme (F-02): six placements (the Home network with the seam at the Name layer, the Moves page, the skyline, the terrain, the surface, Relations) rendered from fixtures at 1440x900 and 390x844 with `node scripts/render-preview.mjs --approval [--capture] --out <dir>`; `--capture` also records the 20-second Live and Ambient capture. The scene modules are pure (no DOM, no Node API) so the capture page inlines `approval-scene.mjs` and runs the same code in the browser. The fixtures are `placements.json` (what each placement is for and its use test), `world.json` (the sample worlds), `copy.json` (the five canonical strings, the Live and Ambient sentence, the seam sentence), `superseded-frames.json` (the 35 frames the 2026-10-05 19:20 direction replaced, by file name), `answers.json` (one slot per placement and OD-V1's, every value `null` until the owner answers) and `gates.json` (the rows that name OD-39 and the placements each waits for); `gateOf` resolves a row to `gated`, `changes` or `released` and a null answer is never read as a yes. `tests/approval-frames.mjs` (Chromium, no server) holds the DOM text lint (no "at ask" or "at bid", no "NOW", no FDR in a heading, no Unusual or Radar in a nav label or title, header sentence at most 14 words, chip at most 3), the canonical strings verbatim in the Moves frames, the Home network's draw list (no curve through a Name node, no pulse across two bands, conservation, one scale for sphere area and band width, no chip on a sphere), the skyline's label placer against its prisms, the terrain's signs, the surface's total variance, Relations' stability steps and the capture (Live still between arrivals, Ambient swaying), each with a negative fixture. Nothing under `assets/` or `shared/` is part of it. |
| `assets/js/flows-net.js`, `assets/css/flows-net.css` | The flow network, attached as `FlowsUI.net` (`model`, `mount`, `of`) and loaded only by the unusual page, whose hero it is. `model(rows, o)` is pure: each flagged window's premium is split by the vendor's ask-side and bid-side attribution (the rest, left between the quotes or never split, is Unattributed) and routed side, sector (the nightly universe's, with index products such as SPX and VIX filed as Index options and SPY, QQQ, IWM and DIA as Index funds; the top five and Other once there are more than six), name (the largest ten, fewer on a narrow screen, and Other names), then lean (calls at ask and puts at bid bullish, calls at bid and puts at ask bearish, by convention) or expiry horizon (calendar days from the window's own Eastern date), so every layer, every hop and every node's outgoing edges sum to the same premium. Every layer is ranked by premium, largest at the top (rank numerals on the names), with the residual buckets last after a gap 1.6 times the normal one whatever their size (Other or Other names, then No sector, Sector unread, Sector pending; No expiry in the Expiry output). `mount(host)` draws v3 on Canvas 2D, laid out to `programme/NETWORK-DIRECTION.md`: money is the shape, a sphere's area is its premium (r = 6 + 28 sqrt(v / the largest node) px at 1440, never under 9) and a band's width is its premium (0.75 px per $1M, floor 1.25 px; the scale tightens as 56 px over the largest node so its bands never outgrow its sphere above a $75M node), one scale for every node and band and a legend row under the scene that draws three reference circles and three band swatches on that same scale; bands are filled Sankey bands stacked at each node in rank order so a node's outgoing widths add to its total, screen-blended in the lean colours (#2ee37a, #ff5a4e, #4ea2ff; Other and No sector in slate #6f7d99); spheres are lit sprites with a specular highlight and a rim, a halo that grows with premium, fog by depth and a soft shadow on a perspective floor grid; four glass planes stand behind the layers on a shallow arc. The scene is laid out in rest screen pixels (four columns at equal spacing centred on the midline, every stack centred with equal gaps, chips 22 px tall on one x edge per column, all four headers carrying the same total, controls above and the legend below, nothing else inside the scene) and lifted into world space with the inverse of the rest camera, so the symmetry holds to the pixel at rest and the Ambient sway (8 degrees over 40 s, pitch fixed at 11, reduced at layout to the widest amplitude at which no chip meets a sphere, a chip or a header, sampled at sixteen phases with the spheres at their 1.03 breathing maximum) supplies the depth. Below 640 px the layers become rows (ranks left to right, chips under their spheres in as many tiers as keep them apart) on a 0.62 scale; between 640 and 1100 px the scale is 0.85 or 0.72 and the chips two lines when one line would not clear the next column. Motion has two classes, and the loop runs only while something moves. Live (every viewer): a window that arrives while the page is open flares its name (a 1.2 s ring) and lights its path, a band carries pulses only for premium that arrived in the last five minutes (one to four by that band's share of the busiest band's arrivals, zero when nothing arrived), ranks glide when new data reorders them, and the camera moves only while the reader drags it plus inertia that is over inside 8 s; at rest the paint census is zero. Ambient (the Ambient button, the `ambient` tag and a legend key reading `ambient motion, not data`): pulses along every band at 7 s down to 2.4 s a lap and one to four by premium, spheres breathing 1.00 to 1.03 in rank-staggered phases, and the yaw sway; it opens off for everyone and sits still until the reader presses Ambient, the reader's own click remembered in a first-party preference cookie `fn_ambient` (Path `/flows`, one year, the pattern of `flows_gate`; `localStorage` is reserved for `IEWTStorage`) and winning over both; `ambient:on` and `ambient:off` bubble from the host. No pass uses the `lighter` composite operation, and pulses are computed from the loop's clock with no per-frame allocation (batched by width into at most twenty strokes). hover, focus or a table row lights a subgraph and dims the rest, with a readout of the node's figure and share at the top right; Freeze stops the pulses, breathing, flares and sway in both classes (its label swaps to Resume and it carries no `aria-pressed`, so a screen reader hears one state; it is hidden under reduced motion, which draws one still frame). Below 640 px the four layer headers are drawn as dark chips with no band crossing them, and a hover readout always clears the headers. When the web font arrives after the first draw (`document.fonts.ready` and `loadingdone`, debounced to a frame and acted on only when the measured width of a reference string changed) the labels are measured again and the layout rebuilt, with keyboard focus kept. Under 540 px of module width the legend is two groups, each a title row over one row of three items, and the paths table rebalances its columns so no header truncates at 320 px. A pointer or horizontal touch drag orbits the camera (yaw within 55 degrees, 30 on a phone, pitch within 22, with inertia) but never past the angle at which a chip would meet a sphere, a chip or a header (`fits`, 6 bisections), so at 1440 it stops near 27 to 36 degrees; a double click or tap, R or 0 on a node, or Recentre returns it. The painter's order is floor, shadows, planes, bands, pulses, headers, spheres back to front, labels, and it stops when the tab is hidden or the canvas is off screen. `destroy()` cancels the loop, aborts the universe fetch, disconnects its observers and removes its listeners. The node hit targets (one roving tab stop after Freeze and Recentre, arrow keys between nodes, names linking to the ticker page), the canvas's spoken summary and the table of the 24 largest paths are its accessible half. It reads `/api/flows/universe` once for sectors and nothing else; the unusual controller hands it the alerts it already holds. |
| `tests/flows-net-render.mjs` | The flow network on the real unusual page in Chromium against `page.route` stubs, no server: layer counts and premium conservation through every layer, hop and node against an independent sum in Node, the ranking on screen at rest, at the reachable yaw and pitch limits, after reordering data and under reduced motion, Live at rest with a paint census of zero over 10 s, the arrival that lights only its own bands and expires after five minutes, the Ambient button, tag, legend, remembered choice and events, the owner default and the closed-session default, no `lighter` pass and no sway in Live, contracts in the tooltips, mouse and touch orbit (clamps at the angle where a label would collide, inertia, recentring, a vertical touch still scrolling the page), hit targets after a rotation, the painter's order, hover, row and keyboard highlighting, the table and the canvas label, the freshness pill, the Expiry output, a flare on a new window, focus kept through a rebuild, pause when hidden or off screen, reduced motion, the pending, empty, failed and unread states, no overflow, no label or caption collision and every label within half a pitch of its own sphere at 320, 390, 700, 768, 1024, 1280 and 1440 px in both outputs over a 9 by 5 yaw and pitch grid, along sixteen points of the sway path and where a long drag stops, and the v3 audit (`auditFn`, run in the page on `net.scene()`) at rest at 1440, 1024 and 390 (columns or rows equally spaced within 1 px, every stack centred on the midline within 1 px, chips on one x edge per column, sphere radius, band width and each node's outgoing slice sum on the stated scale, the same total on every header, the legend's reference circles and swatches on that scale) and over a 0 to 40 s sweep at 0.1 s (no chip over a sphere or a chip, nothing outside the canvas); a readout and header clearance audit (a hover readout at least 12 px clear of every header and inside the canvas) and eight mutants of the served module (equal spheres, bands not by premium, unequal columns, an off-centre stack, a ragged chip edge, a header with another total, headers up under the readout, headers down on the spheres) that the audit must fail; a delayed-font block at 320 and 700 px (the woff2 held back 3 s, then labels, layout and collisions re-checked once it lands); at 320 and 390 px the legend's three circles on one row and its three swatches on one row, and no table header with a scrollWidth over its clientWidth; breathing between 1.00 and 1.03, Freeze, `destroy()` leaving no observer or listener of its own, no retained heap after 3,000 frames and under 3 KiB allocated a frame; CPU per frame at 120 or more bands and 200 pulses, also with the raster forced to finish (a pixel read after every draw), held as a ratio to a reference canvas workload timed in the same interleaved windows rather than as milliseconds, since an absolute figure flaked at load 10 on identical code (limit 2.5 times the reference, floor 12 ms; 1.4 to 1.5 measured). `NET_SHOTS=<dir>` saves screenshots. |
| `tests/flows-starts-contract.mjs` | The starts and the witness: the live workflow's grants and drill input, the nightly dispatch, the witness's lines, debounce, dedupe, three-tick recovery and reopen, the kept-alive loop through the night, the weekend and the hop, the cron starters through the concurrency group, a whole weekday's request cost, and the vendor client's deadline. |
| `tests/flows-ledger-contract.mjs` | The ledger's SQL over a real SQLite (gaps clipped to the session, ok and failed ticks, partial focus reads, passes, the nightly's landing, retention), its zero-extra-round-trip and never-blocks-the-tick properties on the real tick functions, its ingest view, and the health gate's reading of it: gap lines at the stale lines, a nightly that never landed, cards failed or skipped, the roster shortfall and the 5xx burst. |
| `tests/flows-verdict-contract.mjs` | The two reversible verdicts, swept over a real SQLite clock and the real Tier 1 tick: a vendor that lags and recovers at every five-minute mark, a real closure's cost, a calendar holiday, a stalled tide with and without recovery, and the Tier 2 loop's waits. |
| `tests/flows-reads-contract.mjs` | The Worker's D1 round trips and rows read per read route, counted on a fake binding (the rows-read ceilings, the last good copy served while the store is unreadable): the single-flight schema bootstrap, the absent-card decision, the live overlays and the ticker reading. |
| `tests/flows-quant-audit.mjs`, `tests/fixtures-quant-audit.json` | The options engine against independent references: the horizon of a real-world law priced intraday, its 2,000,000-path scipy simulation at nine horizons, the Student t and Hansen skew-t quantiles and the Sobol net the pipeline draws through, dividends on the stock leg, the desk's carry, smile shape and in-the-money quotes, the earnings gate and the grades. The fixture's provenance string names the scipy version, the path count and the seed. |
| `tests/truth/*.mjs`, `tests/flows-truth.mjs`, `tests/rt-market-sim.mjs`, `tests/gen-truth-fixtures.py`, `tests/fixtures-truth.json` | The one synthetic market the statistics are judged on. `rng.mjs` is sfc32 seeded from sha256 (equal word for word to the Python twin in the generator script); `worlds.mjs` holds W1 (the production GARCH-skew-t class), W1d (the dependent daily world), W3 and W3b (marked Hawkes flow, negative-binomial flow counts with day effects and weather), W4 (look-ahead bait), W5 (open-interest lag), W6 (overfitting null), W7 (calibration worlds) and W8 (overlapping horizons); `intraday.mjs` is W9, the 670-name minute world, and W9o, its out-of-family preset; `runner.mjs` refuses to accept a result from a well-specified cell and to judge with no out-of-family world; `reference.mjs` holds the reference implementations the planted wrong builds are made from; `mutants.mjs` loads a copy of a module through a data URL with exact-once string transforms (production is never edited) and `detectors.mjs` holds the detector each mutant must fail and the correct build must pass. `flows-truth.mjs` prints the kill matrix; `FLOWS_TRUTH_DEEP=1` runs ten times the replications on fresh seeds and prints `FLAG` lines without failing. `rt-market-sim.mjs` serves one seeded event log as the vendor's REST routes and its socket protocol on a virtual clock, with the chaos knobs (drops, stalls, duplicates, reorders within 500 ms, malformed frames, caps, 429, lag spikes, clock skew, a silent channel, a missing periscope frame). The fixtures' provenance records the numpy and scipy versions and the sha256 of the script, and the suite fails when the script changed without a regenerate. `W1_BANDS` and the `w1-jumps-production-clip-in-filter` expectation pin today's winsorising limit (K 6): a change to it (F-22, or P3-16's K 6 to 10, which moves the measured tail ratio to about 0.965) fails `w1-bands` and the baseline of the `garchRecovery` mutants, and must re-pin `W1_BANDS` and flip that expectation in the same change. Most planted wrong builds mutate `reference.mjs` or `detectors.mjs`, not production code; each later row retargets its mutants at the production path it adds, one line in `mutants.mjs`. |
| `tests/flows-alert-grid.mjs`, `tests/truth/alert-reference.mjs`, `alert-grid.mjs`, `alert-detectors.mjs`, `alert-mutants.mjs`, `alertsim-evidence.mjs` | The alert decision grid (F-14), the acceptance contract every alert construction is judged by. `alert-reference.mjs`: BY with N fixed at the open on running p that only fall (so the union over a session is the BY set at the close), the null-cell bank, and the two registered constructions with the same 1, 5, 15 and 60 minute windows (A, a calibrated session-maximum law read through the cell nu-hat minus 1 and 1.5 s-hat; B, a per-increment transformed normal mixture, the overnight gap included, scaled by e to the c s-hat). `alert-grid.mjs`: the cells (the exact world; heterogeneous tails with scale error 0.1, 0.2 and 0.3 and random-sign sectors; the overnight-gap world; W9o with its nightly measurement and paused buckets), covered and report-only steps, the session-clustered FDR bound, the J x D power cells and their pre-registered weights, the BH challenger on residualised p, the macro-day stress cell and `decide()`, the registered rule. `alertsim-evidence.mjs` carries the alertsim4 and alertsim3 outputs the rule is also run on. `alert-mutants.mjs` plants five wrong builds through `mutants.mjs` and `alert-detectors.mjs` holds the detector each must fail. `FLOWS_TRUTH_DEEP=1` runs 670 names on fresh seeds and prints `FLAG` lines without failing. |
| `tests/gen-har-fixtures.py`, `tests/fixtures-har.json` | The daily-range HAR forecast's reference: `gen-har-fixtures.py` (statsmodels `OLS(...).fit(cov_type='HAC', cov_kwds={'maxlags': L})` on a seeded GARCH path with intraday-simulated bars) writes the bars, the daily Yang-Zhang variances, and the coefficients, Newey-West standard errors, forecast and 80% bounds at lags 5 and 20; `flows-vol-contract` holds `harFit` to them at 1e-6 and runs the forecast against the true GARCH forecast on simulated paths. |
| `assets/js/flows-export.js`, `tests/flows-export.mjs` | The export menu, attached to `FlowsUI` the way `flows-fresh.js` does (a re-frozen copy), loaded only on the boards (`/flows/long/`, `/flows/short/`, `/flows/watch/`) and the desk, before their controllers. `FlowsUI.csv` writes RFC 4180 with CRLF, a byte order mark, the unit in each header and two padded footer rows (source and as-of, then the export instant); a string cell that starts with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe, a finite number is written bare, and null, undefined, NaN and Infinity are empty. The menu offers CSV for the view as the reader sees it (sort and filter applied) and SVG and PNG of the board map and the desk frontier, serialised with computed colours so no custom property is left unresolved. Exports are limited to the site's own scores, model outputs and aggregates (OD-30): the board's last price and day change, and the desk's quoted premium, are not columns. The suite is Chromium with `page.route` stubs, no server, and reads each download back through an independent CSV parser. |
| `shared/flows-activity.js`, `scripts/flows-legs/activity.mjs` | The Unusual page's dated exchange-code unit. After the chain pass the nightly makes one call, `/api/option-activity/unusual` with `date` the session, `limit` 200 (the vendor's page maximum) and the largest premium first; `CALL_COST.activity` counts it, and `FLOWS_UNUSUAL_V2=off` makes no call and publishes `activity.status: "off"`. `buildActivityRows` keeps a row whose option symbol parses, whose volume is positive and whose last fill falls on the session's Eastern day (another day is counted in `offDate`; no fill time is kept and counted in `undated`); a sweep, floor, multi-leg, stock multi-leg or cross volume (`ACTIVITY_CLASSES` order) that is negative or above the row's volume is withheld as null for that class only. The classes overlap and are never summed. `mergeActivity` puts `cls` and `pm` (executed premium) on the ranked contract rows that are also in the screen, joined by the pipeline's own contract id; an unmatched row carries neither key. The payload gains `activity` (status, `asOf`, counts, at most 30 rows and 3 a name) and `basis.activity`; `volumeAsOf` stays null because the chain counter is still undated. The page adds the row description and a list of the screen's largest by premium. The lexicon test names "sweep" as an exception for `basis.activity` alone. |
| `tests/flows-readers-contract.mjs`, `tests/flows-readers-render.mjs` | What a reader is told about age: the tape's TTL against the close, the quote card's own read time, the news overlay; and the boards' live dots, the home page's pill and news card, driven with stubbed routes. The ticker's tape labels are in `tests/flows-ticker-contract.mjs`. |
| `scripts/prepush.mjs` | The local gate before a push: `node scripts/prepush.mjs [--base=<ref>] [--jobs=n] [--list]` names the suites a change can break and runs them in parallel with the always-on set (`contracts`, `docs`, `flows-weight`, `architecture`, `run`, `lib-contract` and the five Worker-table suites `server-kernel`, `server-rt`, `server-pages`, `server-router` and `route-matrix`, which scan whole trees the import closure cannot see). It joins `node run.mjs --affected-list` with a table of path rules for the render suites that a stylesheet or page change reaches but the import closure does not (`flows-pages-render`, `flows-glass-render`, `flows-overview`, `flows-home-onescreen` and their neighbours), prints one line per suite and the last 25 lines of each failure, and exits 1 on any failure. It reads no network and no vendor; the sandbox needs `PLAYWRIGHT_BROWSERS_PATH` and, for workerd suites, `FLOWS_TEST_SANDBOX=1`. |
| `assets/js/flows-status.js`, `assets/js/flows-status-latency.js`, `assets/js/flows-status-capacity.js`, `assets/js/flows-status-coverage.js`, `assets/css/flows-status.css`, `tests/flows-status-render.mjs`, `tests/lib/status-world.mjs` | The owner-only Status and Capacity page, `/flows/status/` (`statusPage`, a row in `server/routes/flows-pages.js` marked `ownerOnly`: a signed-in member who is not an owner gets the unknown-page 404, an anonymous visitor the sign-in page, and no switch opens it to members). It fits one screen with no page scroll at 1440x820, 1024x768 and 390x844: a title row, a readiness line (its blockers behind a button and a dialog), four slim tiles, a tablist of four tabs (Health, Capacity, Latency, Coverage; `FlowsUI.segmented` with arrow, Home and End keys, `aria-controls` and `aria-labelledby` to four tabpanels, the address `#view=` written with `replaceState` and read on load and on `hashchange`, the old `usage` landing on Capacity) over a grid of cards. Every card is a summary that fits its box: a state line, one or two gauges or a compact table whose rows are trimmed to the height the card has by `fit` (a `data-what` table loses trailing rows until nothing overflows and says `+N more <what> in Details`), re-run on resize; a Details button opens a native `dialog` that holds the full module, painted by the same code (the long tables, the stage ledger, the plan lines, the switches), so nothing is dropped, only moved. Below 641 px one card shows at a time, chosen by a second segmented switch (`aria-controls` the card). The sidebar's Operations group, shown to owners on every Flows page by `ownerNav`, links Status and Latency. Reads, each polled only for the tab that shows it and only while the page is visible (one timer, no read and no timer while hidden, one immediate read on return, the interval doubled after an error up to five minutes): `/api/rt/status` (30 s, 10 s on Latency), `/api/flows/ops` (60 s), `/api/flows/ops?part=ai` (once, Capacity and Latency), `/api/flows/ops?part=coverage` (5 min, Coverage), `/api/flows/lk?k=heartbeat` (60 s), `/api/flows/lk?k=strips:series` (5 min, Latency), `/api/flows/meta`, `/api/flows/ready` and `/api/flows/ai-usage` (5 min). It makes no vendor call and no model call, adds no payload and no global (`FlowsUI.statusKit` is a property). Health: the engines (nightly, Tier 1, focus, Tier 2, worst stale key, the GitHub dispatch refusal), the rail (each topic's lag from `lagMs` for stamped topics and `itemLagMs` for flagged alerts and news), the nightly run with its slowest stages, the read-only switches. Capacity: the vendor key's calls today (a reading counts as today's only while its vendor window, from the ops view, holds the page's clock, and the turn of that window is printed in TRT with the dashboard it is stated on) and the rail's minute against their lines, the model neurons and calls against the enforced 30,000 cap with the free allowance and the dollars beyond it, the platform meters (D1, Durable Objects, Workers requests: the allowance and a dash for use with its reason) and the cron ticks from the ledger, and the limits enforced. Latency: feed p50 and p95, the Tier 2 quote age per pass as a chart whose numbers are in a dialog, the stored feeds worst first, the timing of the engines, the socket and this browser. Coverage: every declared nightly and shared key by its size against the 100 KiB budget, its session against the nightly's, and the keys missing, then the nightly's cards built, failed and skipped. Every time is written `HH:MM TRT` (`HH:MM:SS TRT` for reads) by a local formatter that adds three hours (Türkiye has no daylight time), with the date only when it is not today, and no other zone is named. A source that cannot be read, or a value it does not carry, is a dash with its reason, never zero; what cannot be measured on the site (D1 rows, Durable Object use, Workers requests, option prints, the vendor's per-minute counter, the card rows' count) says so. Nothing is invented: there is no governor, no toggle and no projection. The panels are the deferred group `status-panels` (`flows-chart.js`, `flows-status-latency.js`, `flows-status-capacity.js`, `flows-status-coverage.js`, requested the first time a tab other than Health opens). `tests/lib/status-world.mjs` builds the fixtures, the Worker's real `opsBody` among them, and serves the page. The suite is Chromium with `page.route` stubs, no server: the routes each tab asks and no others, no page scroll, no clipped card and no horizontal scroll for four tabs at three viewports, every printed figure against its fixture, the dialogs, the phone's card switch, nulls and failures as dashes with reasons, TRT only, the refresh census over a paused clock, hidden-tab silence, error backoff, axe, and planted wrong builds (an unfitted card, a lost note, a frame lag for alerts, an Eastern clock, a fixed source count, the free allowance as the cap, a missing key as zero bytes, a share against the wrong budget, a zero for an absent figure) that must each fail. |
| `scripts/uw-spec-diff.mjs` | Reads two copies of the vendor's OpenAPI document in the layout `docs/uw-openapi.yaml` has and names what moved between them: operations added and removed, parameters added, removed or flipped between required and optional, new deprecations (a `deprecated: true` line or a description that says so), changed plan sentences and new changelog entries. `--check` exits 1 on any difference, 2 on a document it cannot read. It prints no response data; `docs/uw-openapi.md` says when to run it. |
| `tests/lib/affected.mjs`, `tests/ci-affected.mjs` | Affected-suite selection for pull requests: `node run.mjs --affected <base-ref>` (from `tests/`) reads `git diff --name-only <base>...HEAD`, joins each changed file to the suites whose import closure (the registry's walker, static and literal dynamic imports) or `covers` globs reach it, and runs those plus the whole `fast` group; `--affected-list` prints the selection without running, and with `--shard i/n` the shard keeps only its affected suites. Any doubt selects everything: an unreadable or empty diff, a file that maps to no suite (a deletion included), a file under `tests/lib/`, `tests/run.mjs`, the lockfile and `tests/package.json`, `.github/`, `wrangler*.toml`, `worker.js`, `.assetsignore` or `_headers`, or a file that reaches more than 40% of the suites. The workflow's `plan` job runs the list on pull requests only; the push-to-main run, the weekly schedule and manual dispatch never select, and a partial pull-request run writes no `tested-tree` status, so `scripts/ci-reuse.mjs` can never skip the push gate on a partial run. `ci-affected` proves exact selections on a miniature repository (leaf, transitive, literal dynamic import, covers, registry file), every fallback, the real `git diff`, and that selectors ignoring `covers` or transitive imports fail the same expectations. |
| `tests/lab-write-contract.mjs` | The Lab write limiter and the attempt ledgers with no server: `worker.js` in Node over `node:sqlite`, a counting `LAB_WRITE` fake (the 31st mutation in a window is a 429 with `Retry-After`, every mutation route is behind it, reads are not, a missing or failing limiter admits the write, a refused request makes no D1 trip), the attempt statements planned by primary key only, the `received_at` indexes and the 03:00 ET prune. |
| `tests/flows-pages-render.mjs`, `tests/fixtures-pages-render-baseline.json` | Every page function in `FLOWS_PAGES` (fifteen) rendered in Chromium at 320, 390 and 1440 px against the pipeline's dry-run emit, served from `page.route` with no server (about 2.5 minutes, 60 s of it the emit). Hard assertions: one `h1`, no skipped heading level, no page error, and the Ask dock (a dialog with `aria-modal`, nothing outside it focusable, focus inside and the main region `inert` when narrow; a complementary landmark beside a usable page when wide; Escape closes and focus returns to the tab). Counted against the committed baseline, which may fall but not rise: axe-core `color-contrast`, unnamed controls, structure rules, horizontal-overflow pixels, targets under 24 px, and (coarse pointer) targets under 44 px. `PAGES_RENDER_UPDATE=1` rewrites the baseline; the metrics go to `$GITHUB_STEP_SUMMARY`; no screenshot is kept. `axe-core` is pinned in `tests/package.json`; where `tests/node_modules` predates the pin, `NODE_PATH` can point at a directory that has it. |
| `wrangler.staging.toml`, `scripts/ops-probe.mjs`, `scripts/staging-load.mjs`, `tests/staging-contract.mjs` | The staging Worker's complete, separate configuration (own D1 and `PULSE`, namespaces 2101 to 2106, no cron, no route, no AI binding, live dispatch off, no secret); the external prober (`probe`: `/api/health` and one page, two failures to alert, a webhook from the environment) and the `smoke` checks; the 20-member poll and socket load test, which refuses production and prices a Free run first. `staging-contract` runs the configuration through wrangler's own reader and the tools against fakes, with no server. DEPLOY.md 10.6. |
| `docs/launch-checklist.md`, `scripts/launch-readiness.mjs`, `tests/launch-readiness.mjs` | The go/no-go list for the first paying member as a readback: ten lines in parts, each a repository check (config, schema, routes, source), a dated readback recorded in the checklist's table, or a part dropped by an owner decision. `node scripts/launch-readiness.mjs` prints which lines are true and exits 1 until all are. The test holds the checklist's parts table equal to the script's, every recorded row valid, and the admission rule: no paid surface (`shared/plans.js`, a `subscriptions` or `billing_events` table, a `/api/billing/` route, `FLOWS_BILLING_MODE` other than `off`) while a line is false. |
| `scripts/flows-legs/calibration.mjs`, `tests/flows-calibration.mjs`, `shared/flows-stats.js` | The track record of the engine's ideas. The pipeline archives each night's lead idea as a trial (`ideaRecord`: legs, fill, spot, both chances of profit) inside `ideas:<date>`; `runCalibration` reads the earlier dates, settles each identity (ticker, family, legs, expiry) once from the daily close on its expiry with the engine's own payoff and profit intervals, folds the outcome into cluster (ISO expiry week) and reliability accumulators, writes `ideas-out:<date>` then `calib`, and fetches at most 15 closes a night for names that left the deep set. No look-ahead: only dates before the run, bars cut at the run, an expiry on a holiday settles on the last close before it. Calendars and ideas across a split are excluded by name; ideas with no close are counted, never dropped. `calib` shows reliability only from effective n 100. `flows-stats.js` is the P1-51a leaf, byte-identical to the one on its own branch. |
| `shared/flows-dispersion.js`, `scripts/flows-legs/dispersion.mjs`, `tests/flows-dispersion.mjs` | Correlation and dispersion context for the Nasdaq-100. The leaf (imports only `flows-stats.js`) turns QQQ's holdings weights, the index's and members' 30-day implied volatilities and daily closes into the implied correlation (the weighted average pairwise correlation that reproduces the index's implied variance), the realised one over 21 and 63 sessions (the same quantity on the members' return series, equal to the brute-force weighted average of pairwise correlations), their difference and the index-to-members volatility ratio, each with its coverage: a member reporting inside the 30 days is excluded from the implied side and counted, a member with a gap or no movement in the window from the realised side. The leg reads members' bars from the run's candles and fetches closes for the rest at most 100 a week, caching them in the row's `state` (the Worker drops it); a new ISO week starts a new budget. |
| `tests/flows-deadline-render.mjs` | The Flows fetch wrapper's deadline (`bounded` in `assets/js/flows-ui.js`): every GET to `/api/flows/*` that carries no signal of its own is aborted at 20 s, or at its `deadlineMs`, and the timer stays armed until `json()`, `text()`, `blob()` or `arrayBuffer()` settles, so a body that stalls after its headers is bounded too; a caller's signal wins, a POST and any other URL are untouched, and a 401 still hangs. Home and Ask pass `deadlineMs: 15000`, the desk and strategy 45000. Chromium against a loopback HTTP server that hangs, or stalls after headers, and a paused page clock stepped with `runFor`: twelve pages each show a failure state, and a source scan holds every `AbortSignal.timeout` and `.any` in `assets/js` behind `?.`. A page test that jumps the fake clock past 20 s with a fetch in flight now aborts it, so such tests step the clock in 10 s pieces. |
| `tests/flows-chart-kernel.mjs`, `tests/fixtures-chart-kernel.mjs`, `tests/fixtures-chart-kernel.json`, `tests/lib/chart-page.mjs` | The chart kernel with no server. A `vm` block holds the scales (the old `lin` closure to the last digit, log, sqrt, band, session and their inverses), ticks (a log domain from zero included) and the registry; a Chromium block over a hermetic page (fixed colour tokens, no stylesheet) and a second with the shipped stylesheets holds U+2212 on negatives, the em dash for a null, a gap that is not zero, a zero that is not positive, the keyboard reaching every mark of each kind, a description that names the last value with its unit, the table and provenance, an update that keeps the crosshair and does not animate, and a frame-cost ratio against the v1 redraw. The 19 v1 calls are recorded at 390 and 960 px with the readout after a key press; `CHART_GOLDEN=write node flows-chart-kernel.mjs` rewrites the snapshot, which a reviewer must read before it is committed. |
| `docs/flows-design-system.md`, `tests/flows-kit-render.mjs` | The Flows design system v2: the surface, elevation, focus, density, data-type and sequential tokens and the `.ds-` kit (module, state chip, button, row, signed figure) that sit in `assets/css/flows.css`, the fourteen module states (`loading`, `quiet`, `partial`, `pending`, `stale`, `withheld`, `unavailable`, `signedOut`, `quota`, `plan`, `held`, `live`, `fresh`, `closed`), the colour-vision rule (a pair under CIEDE2000 20 in any of three simulations carries a printed sign and a shape) and the forced-colors rules. Every added rule is a `:root` property or a `.ds-` selector, so no page changes until it adopts a class. The test serves the shipped stylesheets from disk on a fake origin and renders the kit at 320, 390, 768 and 1440 px: no overflow, text at 4.5:1 over its composited surface, a 44 px hit area by `elementFromPoint`, visible focus by Tab, the named states, forced colors, reduced motion and a coarse pointer; Chromium, no server. |
| `tests/flows-glass-render.mjs`, `tests/lib/glass-world.mjs` | The liquid-glass contrast suite (design v3, Lane 1), the authority on the contrast budget of `docs/flows-design-system.md` (Materials v3). `tests/lib/glass-world.mjs` serves Home (`openHome`), Market (`openMarket` with the dry emit), the long board and the ticker (the emit's board, card, card-x and history rows with a deterministic reading) on `https://example.test` from `page.route` with no server, applies a mode and clears it again with `clearMode` so one page serves all four (`prefers-reduced-transparency: reduce` through CDP, `prefers-contrast: more` and `forced-colors: active` through `emulateMedia`, or an injected stylesheet with the `@supports not` token values), and measures: `measureText` makes every ink transparent (and the `background-clip: text` gradient of a `.ui-num` with it), screenshots the viewport at device scale 1, takes the brightest pixel under each text run's own line boxes (clipped by its scrolling ancestors; if any box has moved by more than 0.75 px between collecting it and the screenshot, because a deferred module mounted or a font arrived, the step is collected again, up to six times, rather than judged on the wrong pixels), composites the computed colour with its alpha and opacity chain over it and requires 4.5:1, or 3:1 at 24 px and from 18.66 px at weight 600, with every stop of a gradient ink tested; `measureMaterial` puts a `.ui-card` carrying every ink of the budget table (`--label-1`, `--label-2`, `--label-3`, `--down`, `--accent-ink`, `--up` and the ice, up and down `.ui-num` gradients) in the top band and the body on each radial centre of `--ground` with the page hidden beneath, so the material is measured over the bare aurora. `MUTANTS` holds the six planted wrong builds. `openLensRig` serves the real `sidePage` markup and stylesheets with no script on a fake origin and mounts a segmented control (the real `.ui-seg` and `.ui-seg-knob` rules) over a hairline grid, and `measureLens` screenshots the knob with the lens off and on (a control filter with a flat displacement map first proves the engine can bend a backdrop) and reads how far each grid line moved, to a tenth of a pixel; `lensMutants` holds the seven planted lens builds (a flat map, a map that pushes the middle, a map gentle at the rim, a missing filter, a missing `@supports` gate, a lens kept under reduced transparency and under forced colours). The suite runs the four pages at 1920x1080, 1440x820 and 390x844, the material probe at the three sizes (the blue pool's band and body held to the budget's rgb figures), the four fallback modes on every page at 1440x820 (opaque tokens, a flat sheen, a solid rim, no blur; `CanvasText` borders, hidden rims and a `Highlight` knob under forced colours), the floating sidebar, the tile layers, the glass bar controls, the segmented knob and the sidebar's site switcher, the refraction of four surfaces (one `#fx-lens` filter on each shell page right after the glyph sprite, `lensMap()` rebuilt from the markup, the `@supports` gate, the drops under reduced transparency, high contrast and forced colours, only the four named surfaces reading `--glass-lens`, and on the grid at least 2 px of displacement at the knob's rim and under 0.5 px at its centre, recorded as a fallback where the engine cannot bend a backdrop), reduced motion, a sweep of every shell page for a scrolling tile that still draws a rim (`openStaticShell`, `scrollRims`), the mask order and the vendor-prefix pairs in the source, and requires each planted wrong build (`--label-3` at 0.52 with the sheen at 0.065, `--mat-regular` at 0.50, the aurora alphas doubled, the reduced-transparency additions deleted, the rim left visible under forced colours, a sheen of 0.08 reaching 60%) and each of the seven lens builds to fail, with the free-scrolling card's rim as the fourteenth. Text inside `svg` (chart axis and level labels) is not measured: it sits over the chart's own marks, not over the glass, so the pixel under it says nothing about the material. |
| `assets/js/flows-index.js`, `assets/css/flows-index.css` | The sticky section index on Market and Ticker: an empty hidden `nav#fxIndex` in the page HTML that the script fills with one anchor chip per `.ui-mod[id]` in `#flowsMain` (title from the heading's own text nodes, in document order, fewer than three means hidden), rebuilt when a grid's children or its `hidden` change, with an IntersectionObserver whose one-pixel line sits 8 px below the modules' `scroll-margin-top` (where a jump lands them, under the strip) marking the module at that line (the module named by `location.hash` wins while it is on the line, so a jump to one of two side-by-side modules marks the one asked for). Ticker chips point at the ids its hash jump already understands. |
| `shared/flows-glossary.js`, `assets/css/flows-public.css`, `tests/flows-public-contract.mjs` | The public front door: `aboutPage` and `glossaryPage` in `shared/flows-pages.js`, served signed out at `/flows/about/` and `/flows/glossary/` (noindex, no data, no vendor call, `nav.js` the only script). Every glossary line is the exact string an information button on its page opens, and the contract fails when a line stops appearing in the source file it cites. |
| `tests/flows-index-render.mjs` | The index in Chromium with no server: the real market and ticker HTML with every script but `flows-index.js` stubbed, modules drawn into the ticker grid by hand, sticky position, scroll-spy, jumps by click and by address, keyboard, 320/390/768/1440 with no sideways scroll and thumb-sized chips. |
| `assets/js/flows-chart.js` | The Flows chart library and kernel (`FlowsUI.chart`: `mount`, `line`, `bars`, `diverging`, `heatmap`, `sparkline`, `gauge`, `payoff` and the primitives under them, plus the kernel: `kind(name, impl)` and `plot(host, spec)` over a closure `Map` registry (a duplicate name throws and the frozen object is never mutated), `scale` (linear, log, sqrt, band, session with closed hours compressed), `ticks` (labels through `F.unit` by kind name; a log domain with no positive part has none and one under a decade falls back to nice ticks), a two-dimensional `scrub` for bubble and scatter charts, a hidden description written from a kind's `data()` (the last value with its unit and time, then the low and the high), an optional table view and a provenance footer). The v1 calls are adapters over the same registry and render the same marks, held by node and attribute snapshots in `tests/fixtures-chart-kernel.json`. `dateTicks`, `fx1`, `tw` and `heightFor` are exported so that a controller keeps no copy of them (the ticker kept five), and `scrub` takes `ys`, `rs`, `yw` and `reach` for a chart whose marks are found in two dimensions, `first` to start the keyboard at the first mark, `xh` for the crosshair's opacity, `ariaHint` for the sentence after the label and, from a readout, `say` for the words announced. Split out of `flows-ui.js`. It re-publishes a new frozen `FlowsUI` with `chart` added, the way `flows-fresh.js` and `flows-rt.js` do, and `shared/flows-pages.js` emits it directly after `flows-ui.js` on the ten chart pages only (overview, the long and short boards, watch, desk, market, track, unusual, ticker, history, strategy); events, political, Ask and login never download it, so `FlowsUI.chart` is absent there. It duplicates the eight helpers `flows-ui.js` does not export (`paint`, `isoDay`, `AH`, `nextId`, `RAF`, `MON`, `spoken`, `moving`) rather than widening the frozen surface. Script order is load-bearing: a script that captured `window.FlowsUI` between the two would lose `chart`; `tests/flows-weight.mjs` and the worker and ticker contracts hold the order. |
| `scripts/gen-docs.mjs`, `docs/modules.json`, `docs/globals.json`, `docs/index.md`, `tests/docs-contract.mjs` | Generated documentation. `gen-docs.mjs` writes the File map, the course counts, the production globals and the suite lists in this file between their `gen:` markers, and `docs/index.md` (every tracked file with its role, its exports as `file#symbol`, and the suites that reach it), from `docs/modules.json` (one row per module: paths or globs, role, domain; a row with a `show` cell is also a File map line), `docs/globals.json`, `tests/suites/*.json` and the sources. `--check` exits 1 on drift. `docs-contract.mjs` fails on any difference, on a tracked file no row names and on a row that matches no file. |
| `scripts/map/audit.mjs` | The reference audit: the share of `path:line` references in the listed documents (default `AGENTS.md`, `DEPLOY.md`, `README.md` and the frozen `docs/map-2026-10-05.md`) whose file is missing or whose line is past the end, printed, or written to the step summary when `GITHUB_STEP_SUMMARY` is set. A report, not a gate. |
| `assets/js/flows-skyline.js`, `tests/flows-skyline-render.mjs` | The move skyline (F-95, placement 3) on the Market page. `FLOWS_SCENES` (`wrangler.toml` [vars], shipped `on`) is `on`, `owner` or off: the Worker passes `scenes` to `marketPage` when the switch is `on`, or is `owner` and the member is an owner (`FLOWS_RT_USERS`), and the page then emits the `mkSkylineCard` module and the `skyline` defer group, so a member's HTML carries neither. `flows-market.js` hands the universe it already reads to `FlowsUI.skyline.mount` when the module is within 200 px of the viewport; no new request or payload. `model(u)` is pure: `IV-days = chg / (iv30p / sqrt(252))` per priced name (the IV-days lens of `shared/flows-moves0.js`), prisms for the names at or beyond 2 IV-days, at most 40, a name with earnings inside 21 sessions marked as an event. A toggle (`FlowsUI.segmented`, arrow keys) sets what height shows. IV-days: the move itself, not a probability, no selection line, no error rate measured. How often: the count of days over the last year for that name as far out as the rung its move reached, read from the universe's `sig`, `f2` and `f3` (`sigmaProfile` through `buildUniverse`; a null cell is absence): 3x when the absolute change over `sig` is at least 3, 2x from 2, none under 2. N is 252 over the count, floored at 250 as `rarityText` does (a zero count or N over 250 is `rarer than 1 in 250`, drawn at the floor under a line above the prism), and height is `log10(N) / log10(250)` of the span on a labelled log axis ticked 1 in 2, 5, 10, 25, 50, 100 and the floor. A name with no scale, under 2 typical days, or with earnings inside 21 sessions is not drawn there and is named in a note; the option is off when none has a count. No p and no sigma wording; `assets/js` imports nothing, so the browser carries its own copy of the reader rule and the test holds every sentence equal to `rarityText`. Direction is on the colour channel (`--up-mark`, `--down-mark`) and in a triangle and sign in the tables; an event prism is paler with a dashed top. The three tallest in the active encoding (largest IV-days, or rarest) are called out with a box in the right margin (triangle, ticker, signed IV-days, the reader-rule sentence or the reason there is none): their prisms sit on the back edge, where nothing stands behind them, and each leader rises to its own lane above the skyline and runs to its stacked box, so none crosses a prism or another leader. Canvas 2D, a 2:1 dimetric projection, no label on any other prism; from 640 px of module width, below that the table of the three and the table of the names (a How often column, sorted by the active encoding) stand in. `tests/flows-skyline-render.mjs` (Chromium, `page.route`, no server) holds heights to IV-days and to `log10(N)` against independent sums and `rarityText`, the ticks, the toggle by key and click, the callouts and `labelProblems` at 640 to 1440 px and on 40 prisms, the absence note, a `buildUniverse` payload read back, pixel colour and tokens, the empty and unpublished states, no overflow at 320, 390 and 1440, and seventeen planted wrong builds. |
| `assets/js/flows-moves.js`, `assets/css/flows-moves.css`, `tests/flows-moves-render.mjs`, `tests/lib/moves-fixture.mjs` | The Moves page (`/flows/moves/`, F-57), a one-screen field of every name in the nightly universe: `universe?cols=t,sec,chg,iv30p,sig,f2,f3,ed,mcap` (plus the live roster's `px` strips when their session is newer). Across is the move in the name's own typical days (`chg / sig`, `sig` the nightly's typical daily move), up is the move as a multiple of the implied day (`abs(chg) / (iv30p / sqrt(252))`, the prior close's 30-day IV; the one page-side division, with `shared/flows-moves0.js` as its oracle). Each dot is a triangle for a riser, an inverted triangle for a faller and a circle for a flat name, its area the market cap (square root scale, 2.5 px floor, the smallest size for a name with no cap), ringed when earnings are within 21 sessions; SPY and QQQ are fixed squares kept whatever the filter; the axes run to the 99.5th percentile of the drawn names (at least 3, capped at 12 and 10) and a name past them is drawn at the edge and counted in the foot. Dashed lines at 2 and 3 typical days and at 1 times implied are reference marks, not a test; no boundary curve exists; the significance test is the one in `shared/flows-moves-sig.js`, which the page carries a copy of and the drill panel and the foot show. Filters (Up, Down, Earnings week, a sector, Clear) fade the other dots and re-rank the lists; Freeze holds the read, prints the time in TRT and applies the held one on Resume; the order also holds while the pointer or focus is in the lists. Large now ranks names outside the earnings window by IV-days; Earnings within 30 days ranks the others apart; rows show a short rarity chip and the whole sentence in the title and the drill panel, only through the `rarityText` rules of `shared/flows-targets.js` (a count of 252 from `f2` or `f3`, the 1-in-250 floor, never a model probability) and only from 2 typical days. Show more opens a dialog sized to the viewport. The drill panel gives the move against its typical and implied day, how often, the card's last 21 closes and context (conviction, IV rank, dealer book, latest flow) read lazily from `GET /api/flows/card?t=` after first paint with a Retry, and the test's sentence or the reason for none; the info dialog lists what is not built (parts of the move, flow clusters, replay). One screen at 1440x820, 1024x768 and 390x844 with no scroll and no inner scroll; a phone switches Field, Lists and Detail; arrow keys move between the sixty largest dots and the pins, Enter opens the ticker page, a tap selects the nearest dot within 22 px. Copy is held to fourteen words a sentence and none of unusual, alert, screen, rare, sigma or radar. `assets/js` imports nothing, so the page carries its own copy of the reader rule and the suite holds every sentence equal to `rarityText` for all 253 counts at both levels. No model, no vendor call, no new payload, no new global (`__MovesTest` exists only where there is no document). Gated by `FLOWS_MOVES` in `wrangler.toml` (shipped `on`; `owner` when unset, `on`, `off`; anything else fails closed for a member, and a refused request is the unknown-page 404). The suite is Chromium with `page.route` stubs, a synthetic universe (`tests/lib/moves-fixture.mjs`, no vendor data) and no server: zero scroll and nothing clipped in every panel, filter and dialog at three sizes, each dot's position, radius, shape and ring against an independent computation, lists, filters, Freeze, the live roster, the drill panel, a failed card and its Retry, the keyboard and a tap, and twenty-one planted wrong builds that each fail. |
| `shared/flows-moves-sig.js`, `tests/flows-moves-sig.mjs` | The Moves significance test. A leaf over `flows-stats.js` alone. For each name, `z = chg / sig` in the name's own typical days; below 2 typical days it is not tested but counted in the correction with p = 1; earnings within 21 sessions, no typical day and no published count are refused with a reason. Otherwise p is the add-one exceedance rate `(hits + 1) / 253` at the nearest level (`f2` from 2 to under 3 typical days, `f3` from 3), conservative for a move inside the level. Benjamini-Hochberg runs across every counted name at q = 0.10 and a name is beyond the usual when its adjusted p is at most q. The smallest p is 1 in 253, so few names pass except on a wide day. The page carries its own copy (`sigRun` in `__MovesTest`), the drill panel prints the sentence, p and adjusted p, the foot counts the flagged, and the info dialog states the limits (clustered market days inflate the test; a ranking aid, not a forecast). `tests/flows-moves-sig.mjs` holds the leaf to worked answers, an independent step-up reference on 300 random universes, the page's copy on 200, a seeded null universe's false-flag rate at or under 10%, power, the sentences, and 11 planted wrong builds. |
| `assets/js/flows-political.js`, `assets/css/flows-political.css`, `tests/flows-political-render.mjs` | The Political page (`/flows/political/`), stock first and one screen with no page scroll at 1440x820, 1024x768 and 390x844. Rows are tickers read from the one `GET /api/flows/political` row; people appear only as initials of evidence. Left panel: tabs Accumulating, Reducing and Convergence (counts with funds hidden; `FUND_TICKERS` behind a toggle), a Map or List switch and a Dollars or Filers switch. The map is a squarified treemap whose tile area is the square root of disclosed dollars (bought plus sold band midpoints; `treemapWeight`) or filers plus a dollar tiebreak, at most 18 tiles (12 on a phone), each with a ring of the median lag over the window (`blindShare`) and a state from `netBounds` and `stateOf`: low bound = bought low minus twice the sold midpoint, high bound = bought high minus an eighth of it, firm accumulating only when the low bound is above zero and no band is open, and no name is ever firm reducing. Right panel: the newest filings that name a stock, with a Show all dialog of all of them. Bottom rail for the selected name: disclosed dollars with range, breadth and median lag, the traded-versus-filed strip with the typically-unfiled band, Flows context and evidence. Flows context is one lazy `GET /api/flows/card?t=` per selected name, debounced 220 ms and cached, reading conviction, IV rank, dealer gamma book and flow, the last net premium and the price since the newest buy; an absent card or field is an em dash with its reason and a failure offers Retry. Phones switch between Stocks, Filings and Detail. Arrow keys move between tiles by geometry, Enter opens the ticker page. Only tokens, no colour literal. `tests/flows-political-render.mjs` (Chromium, `page.route` stubs on a synthetic payload of the real shape, no server) holds the scroll, areas, states, rings, strip, keyboard, card states and copy to independent computations and fails ten planted wrong builds. |
| `shared/flows-ready.js`, `tests/flows-ready.mjs` | The readiness leaf, a module over `flows-time.js` and `flows-freshness.js` alone. `readiness(state, now)` answers for the current session whether Flows can serve the open: the nightly landed for `expectedNightlySession` (the run record `meta`, then `universe`, `regime`, `events` and both `board` sides each at or beyond it), Tier 1 ticking in the session (`tier1At` within 11 minutes, `tier1OkAt` within 16, a holiday verdict skipped, an 11-minute grace after the open), the rail when the caller is an owner and the day is a trading day inside 04:00-20:00 ET (off, unreachable, degraded or a roster error each block), and the clock row. It returns `ok`, `blockers` (`code` and a plain `sentence`), `checks` (`ok`, `blocked` or `skipped` each), `expected`, the session the open belongs to, `minutesToOpen` and `opens` in TRT through `flows-time.js`. `healthOf` is the three-field public body. A null or unreadable input is a blocker, never a pass. `tests/flows-ready.mjs` holds each blocker from both sides at a pinned clock, the pre-market news cadence and its kill switch, and the one-call-one-row write. |
| `server/routes/flows-ready.js` | The ready family in the route table: `flowsReadyRows(deps)` is `GET /api/flows/ready` behind the Flows session and the anonymous `GET /api/health`. Readiness reads the clock row and one `store.metadata` call for the six nightly keys (about six rows and two trips, never a payload), asks the rail (`railReadiness` in `shared/flows-rt-routes.js`, a 1.5 s read of the object's own status) only for an owner, and answers `shared/flows-ready.js`'s body with `owner`. `FLOWS_READY` and `FLOWS_HEALTH` in `wrangler.toml` are `on`; anything else is a 404 `ready_off` or `health_off`. Health is `{ok, asOf, session}` computed from the calendar, no store, no clock row, no rail. The pre-market news pass (`premarketNewsTick` in `shared/flows-live-worker.js`, `FLOWS_PREMARKET_NEWS`) runs on the half-hourly housekeeping firing between 04:00 and 09:30 ET on trading days, makes one vendor call (the news headlines, limit 100) and upserts `live:news` for the day's session, at most 11 calls and 11 rows a day (`BUDGETS.premarketNews`). |
| `server/routes/flows-dispatch.js`, `tests/flows-dispatch-check.mjs` | The owner-only dispatch credential check: `flowsDispatchRows(deps)` is `POST /api/flows/dispatch-check` behind the Flows session. A non-owner is `403 owner_only` (`FLOWS_RT_USERS` through `isOwner`), a cross-origin call `403`, and a second call inside 60 s in one isolate `429 rate_limited` with `Retry-After: 60` (`state.dispatchCheckAt`). `checkDispatchCredential` in `shared/flows-live-worker.js` makes one read-only `GET /repos/{repo}/actions/workflows/{FLOWS_LIVE_WORKFLOW}` with the Worker's token (200 `ok`, 401 `bad-token`, 403 and 404 `no-access`, a network failure `unreachable`) and one `dispatchWorkflow` of the live workflow with `{origin: manual, drill: true}`, which opens one witness issue and closes it at once under the concurrency group `flows-live-drill`. The outcome is written to `flows_clock.dispatch_why` through `recordDispatchWhy` (one upsert, failure ignored, nothing written for a missing token). The body is `{ok, read, dispatch, recorded, repo, workflow, at}` and never carries the token or a header value. `tests/flows-dispatch-check.mjs` drives `worker.js` with a scripted GitHub for seven status pairs, the token-absent and store-failure cases, every principal and the rate limit, and fails seven planted wrong builds of the route. |
| `shared/flows-fixture-names.js`, `scripts/flows-legs/taint.mjs`, `tests/fixture-guard.mjs`, `tests/flows-fixture-guard-render.mjs` | The fixture guard (SYN-01 to SYN-11 of the 2026-10-13 synthetic audit): nothing invented can reach a member. `shared/flows-fixture-names.js` is the reserved namespace, a leaf that imports nothing: `FIXTURE_TICKER_RE` (SY, one letter, three digits, or GONE and one digit, which no exchange symbol can match because symbols hold no digits), `FIXTURE_TOKEN_RE` (a whole JSON string, never a word inside a headline), `isFixtureTicker`, `fixtureNameIn`, `fixtureMarked` (a top-level `fixture: true`), `fixtureHost` (loopback or a `.test` name, the only waiver), `fixtureRefusal(key, text)` and `FIXTURE_REFUSALS` (the 422 `fixture_ticker` and `fixture_payload` rows `server/errors.js` repeats). Worker door: `server/routes/flows-ingest.js` `contentRefusal(url, key, text)` refuses a fixture ticker key on every method, a body naming one and a stamped body before any D1 statement, and passes the request host into `ingestLive` for live keys; it is the one seam a later door (schema, compare-and-set, quarantine) extends. The read side answers 400 `invalid_ticker` for a fixture name off a test host (`requireTicker`, the summary route, the rail's `f`). No variable can switch the guard off: only the request host waives it. Pipeline: `publish()` in `scripts/flows-nightly/store.mjs` refuses before the network (`publishRefusal`: a fixture name, a stamped body, or `fixture_code` when `scripts/flows-legs/taint.mjs` says a fake ran) unless the ingest host is a test host, sets the exit code and throws an error with `fixtureLeak`, which `createStageRunner.run` rethrows even for an isolated stage; every dry-run payload that is an object is written with `fixture: true`; `targetRefusal` stops a run whose `FLOWS_UW_BASE_URL` is a redirect or invalid base from publishing to a non-test ingest, before the first vendor call, nightly and live. `taint.mjs` is a leaf (`touch`, `tainted`, `clearTaint`, the last for tests only); every export of `fixtures.mjs` and each fake constructor touches it on entry. Backstops: the health gate adds a `fixture-name` failure when any live body it already reads names a fixture; the client (`FlowsUI.fixture` in `assets/js/flows-ui.js`, a copy of the token and host rules the suite holds equal to the leaf) quarantines a page that is sent a fixture name or `fixture: true` (hidden main, the unavailable pill, one console error, later Flows requests held), drops rail frames that carry one and counts them in `stats.fixture`, and refuses a fixture `?t=` before asking for a card; `scripts/render-preview.mjs` runs on a `.test` origin and prints a Fixture data ribbon on every page. `tests/fixture-guard.mjs` (class N) holds the namespace table with five wrong rules, the Worker door and the pipeline battery against copies of the source with planted wrong builds each of which must fail, the dry-run stamp, the stage rethrow, the configuration preflight as spawned processes, the health line, the static confinement scan (a fixture token only in tests, docs, the fakes, the preview fixtures and the leaf; a fake called outside a dry-run branch; every fake taints on entry; only tests clear the taint) with its own mutations, the Vision sample-world strings absent from served files, and the dry emit stamped. `tests/flows-fixture-guard-render.mjs` (class C, `page.route`, no server) renders the long board and ticker from the dry emit on the production origin and on `.test` and loopback origins, the rail on both, a stamped real-named card, and five planted wrong builds of the served scripts. |
| `shared/flows-call-meter.js` | The vendor call meter, a pure leaf over the operation registry. `opIdOf(path)` names the registered operation a path belongs to (a literal route wins over a template that would also fit it, so `/api/darkpool/recent` is `darkpool-recent` and not `darkpool`; anything unregistered is `other`), `classOf(status, kind)` files an attempt as 2xx, 3xx, 4xx, 429, 5xx, timeout or network, `codeOf` names a failed one exactly (the HTTP status, or `timeout`, `network` or `parse`, an unreadable body being in the network class), and `createCallMeter` records one line per attempt (operation, milliseconds, declared bytes, class) into per-operation totals, a class tally and fixed latency buckets, folding operations past its cap into `other`; a failed attempt also counts under its code (at most eight codes an operation) and the first three keep a sample `{ code, ms, t, pg, a }`: the ticker's shape (`shapeOf`: plain, list, dot, slash, digit, long, other, read by `tickerOf` from the path slot or the query), the page (`pageOf`: the offset, else the page number) and the attempt, never the ticker, a URL or a token. `quantileMs`, `summarize` (the slowest operations by the time they cost, and `fails`: every operation with a failed attempt, worst first, with its codes and samples, cut by `fitFails` to twelve operations and 2,048 bytes with the cut counted in `failsOmitted`), `wireDelta`, `fails()` (the run's failures by operation and code) and `failsDelta` with `failLine` read it. The nightly's `uw()` records every attempt into one (`wire` in `scripts/flows-nightly/vendor.mjs`); `createStageRunner` takes a `wire()` reading and puts `{ ms, kb, bad }` on the record of a stage that made calls, and none on a stage that made none, and given a `fails()` reading adds `fail`, the stage's own failures as `op code: n` worst first (`multi-leg 422: 84`), clipped at 120 characters, so a dry run adds nothing and the golden hashes hold; `meta.vendor` is the summary and exists only when the run called the vendor. The Worker's `uwFetch` records into one held in its single state object when `FLOWS_METER` is `on`, and the same switch adds `Server-Timing: total;dur=<ms>` to every `/api` response; off, `uwFetch` is the unmetered function and no response changes. |
| `shared/flows-products.js`, `tests/flows-registry-contract.mjs`, `tests/lib/emit-keys.mjs` | The product registry, a data-only leaf over the live key registry: one frozen entry for each thing the pipeline stores (the 24 nightly globals, the four dated archive families with their write-once and permanent flags, `card`, `card-x` and `hist` keyed by ticker, and the live keys with the writer, class and byte cap the live registry gives them), each with its key or pattern, level, executor, epoch, byte cap, volatile stamps and the minutes after the close it is due. It also holds the six states a product can be in (`STATE`: ok, quiet, failed, unfetched, stale, pending), the twelve panel products a name's page shows (`PANELS`) and the contract each tier is held to (`CONTRACT`: a screen name is held to a quote, a chart, levels, a move, a volatility and a reading; a board or focus name to twelve), and which of the three name keys each tier should hold. `tests/flows-registry-contract.mjs` holds it to the door's grammar in `server/store.js` in both directions (every exact key the door accepts is a registered global and the three grouped boards are the rest), to the dated-archive and permanent-archive rules, to the ingest and ledger list kinds, to readiness's keys, to the live registry and the health gate's live keys, and to the dry-run emit, which must write nothing unregistered and every registered global. `tests/lib/emit-keys.mjs` maps the emit's files back to keys. |
| `shared/flows-contracts.js`, `tests/flows-contracts.mjs` | The payload contracts, a pure leaf over the registry and the card schema version. `validate(key, payload, ctx)` answers `{ ok, structural, flags, baseOk, tier }`: a structural failure (not an object, a key no product owns, a ticker that is not its key's, a session that is not a real date, a stamp that is not an instant, a schema version outside 2 to the builder's, a `depth` or panel state outside the vocabulary, a missing core panel, a universe whose columns do not match its count, a roster depth outside the five, a board on the wrong side or with a row that has no ticker, a number that is not finite, a dated key filed under another day, or a `SYN###` name or `fixture: true` anywhere outside a test) refuses the payload, while a soft flag (a panel an older card never had, a price of zero, a one-day move past minus 95%, a ticker outside the universe) never does. `checkPayload` returns the first failure, `canonical` and `canonicalHash` form the order-free, stamp-free content hash a door would compare. Nothing calls it from the Worker or the nightly yet. `tests/flows-contracts.mjs` validates every payload the dry-run emit writes, shows that without the test allowance every one that names a synthetic ticker is refused for that alone, and refuses an invalid corpus of planted payloads each by its code and path. |
| `shared/flows-coverage.js`, `server/routes/flows-pipeline.js`, `tests/flows-coverage.mjs` | What the pipeline can say about each name. `shared/flows-coverage.js` is pure: `cardProducts(card, cardX, hist)` reads a card into a state for each of the twelve panel products (a read that failed, a panel never requested and a panel that read and found nothing are different codes, and a chart of fewer than 200 bars or a surface of fewer than three expiries is quiet), `screenProducts` does the same from a universe row for a name with no card, `coverageLedger` is the whole-universe ledger (a column of codes for every product, counts, the contract's misses by product, the 100 worst), and `verifyCoverage` is the key-level check: from ids and sessions alone it holds every universe name to the name keys its roster tier should have for the expected session, with the predicates P1 (the card is the expected session's), P2 (card-x and hist carry the card's session), P4 (the roster dates the card as the card is dated) and P7 (the universe row has sig, f2, f3 and iv30p), a conservation check that every name is in exactly one state of every product, and a `complete` that is false for any failed or stale key, any stale or missing global, a cut or unreadable listing or no expected session. `GET /api/flows/coverage` (`server/routes/flows-pipeline.js`, `flowsPipelineRows`) serves that report to an owner and no one else: `FLOWS_COVERAGE` is `on` in `wrangler.toml` and anything but `on` is a 404 `coverage_off`, a member who is not an owner a 403, an unreadable universe a 503. It reads the universe and roster rows, the metadata (ids, sessions) of the registered globals and one listing of the three name kinds, about 500 rows in production and at most 2,027 (`COVERAGE_ROW_CEILING`), and holds the answer 60 s in the Cache API, behind the owner check. With `FLOWS_METER` on it adds the Worker's vendor call summary. `tests/flows-coverage.mjs` works every state on the dry-run emit and on planted holes, and drives the route through the router with a fake store and cache. |
| `tests/flows-read-failures.mjs`, `tests/flows-meter-worker.mjs` | Two small suites for the measured half of the data backbone. `flows-read-failures` holds the failed-is-not-empty rule: a card built with an empty failure list is byte for byte the card built with none, a failed read marks the panel it feeds `unavailable` with code `failed` and a reason that names the route and the HTTP status or the timeout, a panel no failed read feeds is untouched, `uw()` reaches its caller with `status` on every HTTP failure (404, a 503 that outlasts its retries, and a 429 that exhausts them) and as a timeout or a parse failure otherwise, the meter counts each attempt in the class it landed in, the nightly deadline is 30 s, 45 s for an option-contracts page and the two-year bars, and `FLOWS_UW_NIGHTLY_DEADLINE=off` restores the unbounded client, all against a loopback vendor. `flows-meter-worker` drives `worker.js` with `FLOWS_METER` off, on, malformed and unset: no timing header and an unmetered `uwFetch` unless the word is `on`, `Server-Timing: total;dur` on API answers (errors and 401s included) and never on a page, and the Worker's vendor meter counting a chain read and a vendor 503 as a 5xx, per instance. |
| `tests/pipeline-sim/*.mjs`, `tests/flows-pipeline-chaos.mjs` | The deterministic pipeline simulator and its invariant harness. `tests/pipeline-sim/clock.mjs` is a virtual clock that replaces `setTimeout`, `clearTimeout`, `Date.now` and `AbortSignal.timeout` and drives a promise by firing the earliest timer whenever nothing else can run, so the real `uw()` client, with its permit queue, backoff, `Retry-After` waits and deadlines, runs thousands of faulted calls in milliseconds; a promise that no timer can ever settle is reported as hung. `vendor.mjs` is a fake vendor behind `fetch` that serves the registered operations from a per-path script of faults (ok, a clean empty answer, 404 and 5xx, a 429 with `Retry-After`, a stall that never answers, a slow answer, a body that is not JSON) and refuses any origin but its own; `world.mjs` seeds one sfc32 stream from sha256 and keeps a trace. Eight worlds are built on them: `client` (the real `uw()` against scripted faults: attempts, results and failure kinds match an independent statement of the retry rules, no call outlives its bound, the meter's count, classes and exact failure codes equal what the vendor answered and every failure sample carries only its code, time, page and attempt, the rate floor stays inside its range), `cards` (the real `readDeepFeeds` into `buildCard`: the failed reads are exactly the scripted ones, the panels they feed are code failed and no other panel changes, a healthy card is byte for byte unchanged, every card validates), `cards-plan` (the same with the failures handed in), `store` (a night's keys with crashes, stale carries, absent and unsessioned keys, skewed sessions, cut and unreadable listings, stale globals: the verifier's states, counts, predicates, completeness and ordering equal a restatement from the world's own bookkeeping, conservation holds, no false green and no false alarm, and its frozen inputs are never written), `contracts` (planted corruptions refused by code and path, synthetic names refused outside a test, canonical form independent of key order and stamps), `meter` and `stages` (the codes, samples, the failure summary and its byte budget, and each stage's failure line), and `volflow` (`volflow.mjs`: the vol-flow stage on the virtual clock, the real `runFlowLeg` and `uw()` at the 150 ms pace and the real store's `hold`, `publish` and `flushHeld` against a store that answers in 2 s, with scripted multi-leg pages (short, full, a refused later page, a refused or failing first page) and refused card-x writes: every held vol section lands, a name whose write lands is written once and never vol-only first, a merged write refused once is written again and one refused for good falls back to the held payload, the multi-leg tally and the meter's codes equal the script, and the flow leg's time stays within 1.2 times its vendor calls at the pace plus 2 s and 6 s a failing chain, which an inline write on the lane breaks). `tests/flows-pipeline-chaos.mjs` runs all eight for 300 seeds (`volflow` on every tenth) or, with `FLOWS_TRUTH_DEEP=1`, 20,000, prints a table, and on a violation prints the seed, the first broken invariant and the last events, with the command that replays it. The door's own invariants (a write never replaces a newer, better or earlier-session row, a refused write leaves the last good row byte for byte) wait for the door that enforces them; nothing here models it. |
| `tests/truth/pipeline-detectors.mjs`, `tests/truth/pipeline-mutants.mjs`, `tests/flows-pipeline-mutants.mjs` | The pipeline's kill matrix. `tests/truth/pipeline-mutants.mjs` plants 61 wrong builds the way `alert-mutants.mjs` does, each an exact-once string transform of a production module loaded through a data URL, never an edit: no deadline on the nightly client, the long deadline missing, timeouts retried forever, a clean empty answer thrown as an error, a 404 read as empty, a 429 exhaustion with no status, an unreadable body left out of the meter, a failure code dropped from a panel, a healthy card carrying an empty failure list, a darkpool failure on the wrong panel, the stale comparison reversed, a report that is complete with a key missing, a cut listing read as a failure, an unreadable listing read as ok, a verifier that writes to its inputs, synthetic names allowed, the canonical form keeping stamps or key order, a card for another ticker accepted, a literal route filed under its template, a refusal filed as a client error, a stage that reports the run's wire time, a parse failure metered as a network one, an uncapped error backoff, a failure filed by its class, a summary that names only the slowest failures, a stage that does not name its failures, a flow write on the lane, a failed later multi-leg page counted as a first, a held vol payload written at once, a flush that drops an unlanded key or never falls back. `tests/truth/pipeline-detectors.mjs` holds one detector for each target (the vendor client, `flows-card.js`, `flows-coverage.js`, `flows-contracts.js`, the call meter, the stage runner, `flows-deepen.js`, and `volflowDetector` for the flow leg, the store and the client's backoff), each running its simulator world over seeded runs; Each baseline is loaded as its own module instance (`loadMutated`'s `salt`), so one detector's run leaves no pace in another's. `tests/flows-pipeline-mutants.mjs` requires that every detector passes the correct build and fails every mutant meant for it. |
| `scripts/flows-legs/sigma-ledger.mjs`, `tests/flows-data-fixes.mjs` | The typical-day scale for the whole universe. The nightly holds daily bars only for carded names, so `runSigmaLedger` keeps a rotating ledger inside the `regime` payload (`sigmaLedger`: ticker, scale at 1e5, count, `f2`, `f3`, day, plus a retry list for names short of history): tonight's fresh scales win, then up to 240 names with no scale or the oldest scale are re-read from the vendor's one-year daily bars, an entry older than 45 days is dropped, and a name short of 200 closes is not retried for 20 days. The universe publishes `sig`, `f2` and `f3` from the merged map with `sigmaBasis` (covered, fresh, rotated, short, oldest day), so coverage reaches an 856-name universe in about four nights at 240 vendor calls a night, never a guess. `shared/flows-events.js` `fitEvents` sheds far-dated rows of the `events` payload to stay under 120 KiB, below the 128 KiB ingest cap whose 413 stopped the events key advancing on 2026-10-15 and 2026-10-16. The suite uses synthetic bars only. |
| `server/routes/flows-ops.js`, `server/ops.js`, `tests/server-ops.mjs` | The owner operations family in the route table: `flowsOpsRows(deps)` is one `GET /api/flows/ops` row behind the Flows session, then `FLOWS_OPS` (`wrangler.toml`, `on`; anything else is a 404 `ops_off`, read before the owner check) and then the owner check (a member who is not an owner is a 403 `forbidden`, a POST is the 405 before the session). `server/ops.js` is the I/O: one D1 batch of the last seven `flows_ledger` days, the `flows_clock` row, the eleven live keys by primary key with `json_extract` of `fresh.vendorAt` guarded by `json_valid` (never `json_each`), the model day's `flows_ai_usage` and `flows_ai_usage_model` rows, and with `?part=ai` the two outcome statements `readAiBlock` sends (`foldCounters`), and with `?part=coverage` one primary-key lookup of the fixed `COVERAGE_KEYS` (the nightly and shared keys, never a card row): `length(payload)`, the write time and the session date of each, shaped by `coverageView` against the 100 KiB `UNIVERSE_BUDGET_BYTES` (a key never written is `present: false`, not zero bytes); at most 24 rows by default, 24 plus the key count with coverage and 280 with the outcome block, 0 written. The body (`v: 1`) carries the ledger days, the clock with Tier 1's verdict and the GitHub dispatch refusal, each stored feed's age and distance behind the vendor's stamp with its live and stale lines from the freshness table, the vendor reading (the newest of the clock row's and the Worker's own, from `x-uw-daily-req-count`) with the vendor window it was read in and whether that is the current one (`vendorWindow`: from 20:00 ET to 20:00 ET as `vendorDay` states it, a reading before 20:00 ET in the window that ends that evening and one after it in the next; the UTC day for a plan whose reset is unread), the current window with its basis, source and date, `dayBoundary` `stated` or `assumed`, and the engines' own call counts, the model day's spend against the enforced cap (`aiCapOf`: 30,000 neurons, 2,500 calls, readings stop at 75%, not the 10,000 free allowance), `lines(env)`, `planOf(env)` and `renewalState`, the enforced limits (`limitsOf`, held equal to `wrangler.toml` by the suite and by `flows-vendor-budget`) and an allowlist of switch values (`OPS_SWITCHES`, no secret-shaped name). A failed batch is a 200 with every stored part null and `why: store`. No vendor call, no model call, no plan variable read outside `shared/flows-plan-facts.js`. The suite runs the family over a seeded `node:sqlite` fake: gates and their order, one trip, the row ceilings, a refused batch, a payload that is not JSON, plan and cap variables, the switch allowlist and the Worker scans. |
| `assets/js/flows-relations.js`, `tests/flows-relations-render.mjs`, `tests/fixtures-relations.json`, `tests/gen-relations-fixtures.py` | The Relations tab on the Market page (`FlowsUI.relations`: `mount`, `model`, `pearson`, `partial`, `fisher`), under the `FLOWS_SCENES` switch. It relates the names that carry the day's flagged option windows, the data the page already reads from `/api/flows/flowalerts` and nothing else: each window's premium (and its net bullish premium, calls on the ask side and puts on the bid side minus the reverse, by convention) is put into ten-minute bins from its own `spanStart`, the twelve names with the most flagged premium and at least four active bins are kept, a bin with no window is zero, and every pair gets Pearson r, the Fisher z 95% interval on the bin count, and r in each half of the window. A pair is drawn only when its interval excludes zero, the absolute r is at least 0.3 and both halves keep the sign (`stable`); there are three relations (`Active together`, `Lean together` and `Beyond the market`) shown one at a time. `Beyond the market` is the partial correlation of the Active series after each is regressed on the mean of the kept names' standardised Active series (per half too), with the Fisher interval on n - 4 (one conditioned variable); it removes the day's shared flow burst, not stock-price moves, and says so. The page says how many of the pairs would pass by chance (5% of those tested), that windows arrive in bursts so the interval is too narrow, and that it is not a forecast. Fewer than 40 windows, 20 bins or three names is `thin` with the counts and no drawing; a failed or unpublished feed says so with its reason. It is a ring by sector (each node its ticker and its sector, every one labelled) beside a list of the tested pairs with a Show all dialog; under 900 px the ring and the list are a switch. Not built: price-residual and price partial-correlation layers (they need daily closes for the universe, which no stored payload carries) and the sector ETF return correlation (the sectors payload holds a smoothed TRIX series, whose correlation would be spurious). `tests/gen-relations-fixtures.py` (numpy, scipy; versions and its own SHA-256 in the fixture) writes three seeded worlds (a factor world, a null world and a short one) with the expected r, interval, halves and verdict of every pair; `tests/flows-relations-render.mjs` (Chromium, no server) holds the module to them at 1e-9, the thin, quiet, failed and pending states, three viewports, and fifteen planted wrong builds. |
| `assets/js/flows-net-map.js`, `assets/css/flows-net-map.css`, `tests/flows-net-map-render.mjs` | The Market page's flow network, condensed (`FlowsUI.netMap`: `mount`, `of`, `readout`), loaded as the `netmap` defer group after `flows-net.js` (its pure `FlowsUI.net.model` does the routing, so a premium is split, sectored and bucketed once, the way the Unusual page's scene does it). Four columns of chips on one screen, SVG not canvas: side (calls and puts on the ask or bid side, unsided), sector, name (the largest ten, fewer when the height asks, and Other names), and lean or expiry. Every chip carries its full label and its figure and share (`$41.3M · 25%`); a sector name is abbreviated only when it will not fit the chip, and then the full name is in the chip's title, accessible name and the readout. A chip is two lines whenever the height allows. Bands run between chips at a width that is the premium (one scale for every band, a legend swatch shows a round dollar figure on it), colour by dominant lean, and the chip's base carries the node's own bullish, unsided and bearish split. A persistent readout names the selected node's layer, its premium, its share of the total, where it comes from and where it goes, its windows and contracts, and the lean convention; at rest it is the largest name, a click, Enter or the arrow keys change it, and the selected paths are lit. Other and Other names say what they fold in and open a member list with each member's premium. The table twin lists every path by side, sector, name, lean or expiry, premium and share, top rows with Show all. Under 640 px one layer at a time is a switch and the legend is a button. `tests/flows-net-map-render.mjs` (Chromium, `page.route`, no server) audits every chip against independent sums over the same alert rows, its text against its width, chips and captions for overlap, the bands' widths, the readout, the legend and the table at 1440, 1024 and 390 px, and fails eleven planted wrong builds. The Unusual and Home scenes (`flows-net.js`) are unchanged. |
| `tests/flows-market-onescreen.mjs`, `tests/lib/market-fixtures.mjs` | The Market page's one-screen contract. `marketPage` is a title row with a tablist of eight views beside it, a hero strip (`#mkHero`: net tide, breadth, put to call, the three index ETFs and the IV median, painted by `flows-market.js` from the payloads the page already reads, the phone shows the first three) and the tab views (Tide, Sectors, Indices, Network, Extremes, Relations when `FLOWS_SCENES` allows it, Prints, Context) and a stage that fills the rest of the viewport (`100dvh`, no page scroll at 1440x820, 1024x768 or 390x844). The modules keep their ids and painters; each tab is a grid of one to five of them, the inactive panels are `inert` and `visibility: hidden` in the same box (so the charts keep their measured size and the deferred groups still load), the tab and the address (`#view=network`) agree, and under 900 px each panel shows one module at a time behind a second switch of the module titles. A fitter in `flows-market.js` hides the trailing rows of any list that does not fit its module, shrinks the tallest chart, falls to a compact padding last, and puts a Show all button in the header that opens the whole body in a dialog; native `UI.list` disclosures are off on this page. `tests/lib/market-fixtures.mjs` is the synthetic harness (thirty names with sectors, a bursty alerts feed, a universe with the skyline's columns, the preview fixtures for the rest) that opens the page in Chromium. `tests/flows-market-onescreen.mjs` sweeps every tab (and every module on a phone) at the three viewports for page scroll, sideways scroll and any element that leaves its module, checks inert and visibility, the tablist from the keyboard, the address, the Show all dialogs, 44 px targets, the scenes switch off and reduced motion, and fails nine planted wrong builds. |
| `shared/flows-deepen.js`, `scripts/flows-nightly/sections/deepen.mjs`, `tests/flows-deepen.mjs`, `docs/deepening.md` | The deepening rotation (design in `docs/deepening.md`): every name in the universe gets a full deep card within a bounded number of nights, without anyone choosing tickers. `shared/flows-deepen.js` is a pure leaf over `flows-universe.js`' session counter: `governor` sizes a night as the least of the cap (530, `FLOWS_DEEPEN_CAP`, hard ceiling 900), the backlog, the calls the day line leaves (85 per cent of `lines(env)['uw.day']`, which is the plan's 100M on the recorded Advanced plan, so this term no longer binds, and the 60,000 working line for an unread plan, less the larger of what the run has spent and the key's own daily count, `stats.dailySeen`, read from the vendor's counter header, and the baseline with its margin, at 38 calls a name) and the time the deadline leaves (80 per cent of the 90 minute `DEADLINE_MS`, at 6.5 s a name), and returns the pace that keeps the rotation under 80 per cent of the minute line (the minute line alone sets it, so a raised day line raises no rate); `planNight` reads the ledger (the `deepen` key: `at[T]` the session of a name's last deep read, `tries[T]` consecutive failures with a 1, 2, 4, 8 session backoff), takes never-read names first by liquidity and then the oldest read, and returns the names that are carried (a deep read within 40 sessions whose stored card is the one the ledger dated) so that no shallower card, cross read or card-x replaces them; `settleNight` counts a name read only when its card and card-x landed; an unreadable ledger chooses nothing and protects every card. `scripts/flows-nightly/sections/deepen.mjs` is the I/O: `deepen-plan` (isolated, after the boards) enriches the chosen names the run had not and adds them to the deep build that the existing chain, per-name read, volatility, flow, ownership, earnings, engine and card-x stages already run, and `deepen-ledger` (isolated, before the roster) writes the ledger. A rotation card is published with `depth: "deepened"` (roster tier `deep`, held to the board's contract) and its own session date; rotation names are kept out of the ideas list and its track record, the board's chain columns, the unusual screen, the vanna probe and the risk-reversal cohort, and `FLOWS_DEEPEN=off` returns the nightly to what it was. Borrow, short volume and the earnings history are now read for every carded name, which is why a cross-section name's Positioning and Earnings were empty. `tests/flows-deepen.mjs` holds the governor, the pick order, the ledger and the hold rules to worked answers, runs the 856-name universe through `tests/pipeline-sim/deepen.mjs`, and runs the dry-run emit with the rotation on, at a cap of 100 and off (fifteen payloads byte for byte equal to the off run). |
| `tests/flows-market-visual.mjs` | The Market page's drawn marks against independent computations from the dry-run emit (`tests/lib/market-fixtures.mjs` with `rich: true` serves the emit's market, pulse, regime and live payloads). The hero strip: the net tide is calls minus puts of the last pulse bucket with its legs and tone, breadth is the signed tilt by names with a three-part bar equal to the bought, level and sold shares, put to call is the premium ratio on a 0 to 2 meter with parity marked at half, each index ETF is the last bucket of its options tide and opens its dossier, the IV median is the payload's and its rank meter the rank. The sector heat map (`paintSectorTides`, a squarified treemap in `flows-market.js`): one tile for every sector, each area its share of the weight the larger of the absolute net premium and 6% of the largest within 0.4 percentage points, tiles inside the map, covering it, none overlapping, most net-bought first, tone by sign, value equal to the sector's last net. The tape tiles' meters: the call and put split, the two put to call scales, the offer shares and the rank. Run at 1440 and 390 px, with ten planted wrong builds (a tile chart left visible on another tab, area without the floor, tiles most net-sold first, swapped breadth segments, a wrong meter scale, an upside-down split, a dropped path, the wrong tide leg, a flipped tile tone, a wrong dossier link) that each fail. |
| `assets/js/flows-market-river.js`, `tests/flows-market-river-render.mjs` | The Market page's opening scene, the Session (`FlowsUI.river`: `model`, `layout`, `mount`, `of`, `sideOf`, `trtOf`), loaded as the `river` defer group into the first tab, `#view=session`, which is the page's default view. Depth is time: the open at the back, the last read at the front, under a now line stamped in TRT. The lanes across are the sectors of the names the vendor flagged today (the universe's sector, `Index funds` for SPY, QQQ, IWM and DIA, `No sector` for a name the universe lacks, `Sector unread` for every name when the universe has not published), ordered by flagged premium. Each flagged window of `/api/flows/flowalerts` is a lit sphere sprite (the one `flows-net.js` draws) at its `spanStart` minute in its name's lane, radius `0.03 + 0.12 sqrt(premium / largest)` in lane units so area follows premium on one scale; colour is the side by convention (a call with more ask than bid premium or a put with more bid green, bullish; the reverse red, bearish; no split or equal blue, unsided). The lane floor is tiled by the live breadth key's 5-minute steps and tinted by the sector's `net` at that step (the funds lane the sum of the ETF tides), slate with a dashed edge and a stated reason when the key is absent, for another session or missing the sector, never a zero. The market tide of `pulse` (calls up, puts down) stands on the left wall along the same minutes, only when it is the same session. Camera, fit, fog, floor grid, glass wall and label declutter follow `flows-ticker-surface.js` and `flows-net.js`; every colour is read from the page's tokens. No motion: a paint happens on mount, on data, on resize, on hover or focus, and never at rest. The accessible twin is a readout (`role=status`, the largest window at rest, the hovered or focused window or lane otherwise), a hit link over each of the 40 largest windows (one roving tab stop, arrows, Home, End, Escape; Enter opens the ticker page), a button over each lane header, a canvas description, and two tables (lanes with their tide; the largest windows with time in TRT, side, premium, expiry). A failed, pending or empty feed is a state with its reason. `tests/flows-market-river-render.mjs` (Chromium, `page.route`, no server) recomputes every lane sum, side, lane band, minute position, radius and screen projection from the fixture rows with its own camera, holds the tiles to the emitted breadth key and samples their pixels, checks labels for overlap, the TRT ticks, the now line, three viewports with no scroll, reduced motion, the keyboard, a zero paint census at rest, the frame cost against a reference canvas workload, the four states, and twelve planted wrong builds. |
| `assets/js/flows-market-floor.js`, `tests/flows-market-floor-render.mjs` | The Market page's opening view, the Floor (`FlowsUI.floor`: `model`, `layout`, `mount`, `of`, `sideOf`, `valueOf`, `classify`), loaded as the `floor` defer group into the first tab, `#view=floor`, which is the page's default (the Session river is the second tab). A lit perspective floor on Canvas 2D with one glass pillar for each class of what the vendor flagged today, read from `/api/flows/flowalerts` and the universe's sectors and nothing else (no new request, payload or vendor call): the four index funds (SPY, QQQ, IWM, DIA), the eleven sector ETFs (XLK to XLRE), any flagged class of other funds (Bonds, Commodities, Volatility, Crypto, International, by a fixed ticker table) and single stocks grouped by the universe's sector (`No sector`, or one `Sector unread` tile when the universe has not published). Rows run from the back in that order, each headed by its group's flagged premium and share, so the question of whether funds, sector ETFs or stocks draw the most is answered at a glance. A height switch (`FlowsUI.segmented`: Premium, Volume, Net lean) sets pillar height on one scale across every class: the sum of flagged premium, the sum of the windows' contract counts (a window with no count adds nothing and the class says how many windows the figure comes from; a class with none is a dash, never a zero), or the absolute net lean (calls on the ask side and puts on the bid side minus the reverse, by convention). Colour is lean by convention, `--up-mark`, `--down-mark` or slate when the net is within 10 per cent of premium, deepening to full at 60 per cent; the white stripe along each base is the class's share of all flagged premium relative to the largest; a class with nothing flagged is a dashed slate tile, never a zero. Pillars are glass boxes (vertical gradient, specular strip on the lit face, rim, soft shadow sprite, glow by share) drawn far to near with fog by depth. A persistent readout (`role=status`) names the hovered or selected class with premium, share, volume, lean and its top three names; clicking or pressing Enter on a pillar drills a side list (shown from 800 px of module width, never scrolling: its rows are fitted to the height) to that class's names ranked by premium, each linking to its ticker page, and the same list ranks all classes by the chosen measure at rest. On a phone the long rows wrap to six pillars a line. The camera orbits by drag (yaw within 40 degrees, pitch 18 to 62), by Shift and the arrow keys, and Recentre returns to the opening view; the arrows alone, Home and End move a roving tab stop over the pillars (opening on the tallest), Enter selects and Escape clears. Labels go through one declutter pass and class names stagger to a lower line where neighbours would meet. Every colour is read from the page's tokens. No loop: a paint happens on mount, on data, on resize, on the switch, on hover, focus or selection and while dragging, and never at rest. The accessible twin is the canvas description, a hit button over each pillar with a full spoken sentence, and a dialog with the classes ranked by premium and the 40 largest names. A failed, pending or empty feed is a state with its reason. `tests/flows-market-floor-render.mjs` (Chromium, `page.route`, no server) recomputes every class sum, share, lean, height on the shared scale, row and column, and projection from the fixture rows with its own camera, in all three measures at 1440x820, 1024x768 and 390x844, holds labels for overlap and the canvas for the page, checks the readout, the side list, the tables, the keyboard, the orbit and its clamps, pixel colours, the dash for a class with no count, no universe, the failure states, a zero paint census at rest, the frame cost against a reference canvas workload, and fourteen planted wrong builds. |
| `tests/flows-lean.mjs` | The one lean rule, held across the modules that derive it, with no server and no browser. A flagged window's premium is split into the dollars on the ask side, the bid side and neither (`FlowsUI.F.askSplit`); for a call the ask dollars are bullish and the bid dollars bearish, for a put the reverse, and the remainder is unsided, by convention. The suite loads `flows-ui.js` and the Floor, the River, the Network and Relations into a `vm` and runs each model on a known-answer table (a 510k against 490k call is +2% and not 100% bullish; a 300k, 100k and 600k-between call is +20%; the put mirror; a one-sided window; sides past the premium; no call or put) and on three seeded corpora of 300 windows, holding every tile, lane, name, network total and lean series to an independent sum, and every River sphere to the sphere rule the Now list uses (at least half the premium sided and at least 65% of the sided premium on one side). Thirteen planted wrong builds and a null calibration of the third Relations layer (K unrelated names must average r 0 and show no more than 7% of pairs, which the all-names factor fails at -1/(K-1)), among them the whole window added to its majority side, a put read as a call and the unsided premium counted as bullish, must each fail. |
| `tests/flows-brand-render.mjs` | The Fire & Forget trade-mark (`brandMark` in `shared/flows-pages.js`, the `.ff-brand` rules in `assets/css/flows.css`, no script and no global). A flame glyph and the words `Fire & Forget™` sit in the sidebar footer of every Flows page (a link to `/flows/about/` for members, to `/flows/status/#view=coverage` for owners through `ownerNav`), in the About header with a paragraph on what the rotation and live pipeline do and do not promise, and in the Status header; other surfaces reuse the class or `brandMark`. The glyph breathes (opacity and transform only) only while the page's own freshness pill reads live, fresh or closed, by a CSS `:has` rule over `#fxFresh`, so it makes no request and a page with no pill is still; it is static under reduced motion and drawn in `CanvasText` under forced colors. The suite is Chromium with `page.route`, no server: links and accessible name for member, owner and Status, the breathing and stillness states, reduced motion, forced colors, light and dark contrast, no sideways scroll at 320 to 1440 px, no performance claim in the About copy, and eleven planted wrong builds that each fail. |
| `tests/flows-home-onescreen.mjs`, `tests/lib/home-fixtures.mjs` | The Home page's one-screen contract, the bento (design v3, Lane 3). `overviewPage` is a header, a `#hmPager` (hidden above the s fit) and `#hmStage`, one CSS grid of fourteen tiles (thirteen with the network switch off): the tide hero with its five KPI cells, the Neuron tile, the flow network, Flagged, Sectors, Bullish, Bearish, Nearly in, Leaders, Metals, What changed, Volatility, Reporting and Headlines. `.hm` is a size container and four `@container hm` blocks choose the fit (`--hm-fit`: xl from 1400x800, l from 1040x640, m from 760x560, s below; the script reads the word and writes `data-fit`), so the Ask dock re-flows the page. Each tile is a size container and picks its face from its own box: full, compact (the fitter in `flows-overview.js` hides trailing rows, keeping at least two, and adds Show all), strip (one line, or a single row under 64 px), or glance (a numeral; the network at m and every tile of the s Glance page). Show all, Open and the Neuron's More move the live element into one `dialog.hm-sheet` and leave a `.hm-ph` placeholder on its grid area; Escape returns it. At s the four pages (Now, Flow, Names, Glance) are a `#hmPager` of 44 px buttons with arrow keys, Home and End, a swipe and `#page=` (the old `#view=` values map); tiles on other pages are `inert` and `visibility: hidden` but laid out. The network is the 3D scene at 640x340 or more, the condensed map at 260x180 or more and a glance below that, and remounts when the fit or the dock changes it. `tests/lib/home-fixtures.mjs` opens the page in Chromium against `page.route` stubs (`FITS`, `PAGES`, `openHome` with `rich` for the dry-run emit, `dock` and `openDock`). `tests/flows-home-onescreen.mjs` runs twenty viewports, with and without the network and on coarse pointers: the fit word, no page or inner scroll, nothing cut by its tile, no body hiding content without Show all; at xl, l and m every tile in its grid area to 1 px from independent column and row formulas, no overlap, the KPI cells on column lines at xl; row counts, eleven heat cells that the fitter never trims, the 3D stage at 300 px or more, numerals that are figures or a dash with a reason, captions of six words; the pager, swipe, address, sheet identity, dock re-flow, reduced motion and 24 and 44 px targets; and thirteen planted wrong builds. |
| `assets/js/flows-desk-calls.js`, `assets/css/flows-desk.css`, `tests/flows-desk-calls.mjs`, `tests/flows-desk-calls-render.mjs`, `tests/flows-desk-onescreen.mjs`, `tests/gen-shortcall-fixtures.py`, `tests/fixtures-shortcall.json` | The premium desk's Short calls view (`strategy=sc`, the fourth item of Sell) and the desk's one-screen stage. `assets/js/flows-desk-calls.js` is the deferred group `desk-calls` (`FlowsUI.deskCalls`, built on `FlowsUI.deskKit`, which `flows-desk.js` publishes and the chunk reads at call time): it prices the chain `strategy=cc` already fetches as uncovered short calls (the lab's `custom` family on the same smile and law, so Calls to Short calls makes no request), sized to N contracts (default 100 of 100 shares, a reading the page states) under a labelled collateral convention: delta-adjusted `100 x spot x max(h x absolute delta, f)` with h 30% and f 10% by default, a Reg-T style `100 x max(0.2 x spot - OTM, 0.1 x spot)`, or shares held (the covered call). Premium is the bid; the ratio is time value over collateral, annualised on 365 days; the terms live in a Terms dialog and the address (`n`, `cv`, `h`, `f`, defaults omitted). The frontier plots the annualised ratio on a square-root scale against the magnitude of net delta or implied win %, with the floor guide at f over h and a diamond where the floor binds. Money is integer cents with half-up ties. The export follows OD-30 (no bid, ask, premium or spot column). The pure oracle is `shortCallLine` and its helpers in `shared/flows-premium.js`. `assets/css/flows-desk.css` also holds the desk's one-screen stage: a tablist (Frontier, Lines, Smile, and Plan below 900 px) over a stage that fills the viewport, inactive panels `inert` and hidden in the same box, a Lines fitter with a Show all dialog, and a Filters dialog on a phone. `tests/gen-shortcall-fixtures.py` (Fractions) writes the cases of `tests/fixtures-shortcall.json`; `flows-desk-calls` holds the oracle and the chunk's copy to them in cents, 20,000 random draws to a BigInt reference, the engine ties and the planted wrong builds; `flows-desk-calls-render` holds every printed figure, the frontier's pixels, the popover formulas, the URL, the dialog, the export and the failure states; `flows-desk-onescreen` sweeps every state at 1440x820, 1024x768 and 390x844 for page scroll, clipping, inert panels and the Show all dialog, and fails six planted builds. |
| `assets/js/flows-feed-os.js`, `tests/flows-feeds-onescreen.mjs` | The one-screen stage for Unusual and Events (`/flows/unusual/`, `/flows/events/`). `feedTabs` in `shared/flows-pages.js` renders a tablist over a `#fdStage` whose `.fd-mod` children are stacked and only the one with `data-on` is visible (the others `inert` and `visibility: hidden`), with `#view=<tab>` in the address; `.flows-main` is `100dvh` with no page scroll at 1440x820, 1024x768 and 390x844, laid out by `assets/css/flows-feeds.css`. `flows-feed-os.js` wires the tabs (arrow keys, Home, End) and a fitter: it unhides rows the painter hid behind its own disclosure, finds the vertically stacked group of repeated siblings in a module body that adds the most height, hides trailing rows until nothing overflows (`fd-cut`), then trailing legend and note lines, and puts a Show all button in the module header that opens the whole body in a dialog; it re-runs on mutation, resize and font load. The Flow network module is `data-free` (its own host scrolls inside the module, the one place a module scrolls, because the scene is taller than one screen). Events no longer names an Eastern date (the run's own session date), prints its build time in TRT, and writes `No print` and `No date` where a day has no macro release or FDA date, with a line naming the next macro print and FDA date beyond the five sessions. `tests/flows-feeds-onescreen.mjs` (Chromium, `page.route`, no server) sweeps every tab of both pages at the three sizes for page scroll, sideways scroll, clipped content, inert and hidden inactive modules, the address and the keyboard, opens each Show all dialog, holds the Events copy, and fails three planted wrong builds. |
| `shared/flows-oracle.js`, `shared/flows-oracle-words.js`, `shared/flows-oracle-live.js`, `server/routes/flows-oracle.js`, `scripts/flows-legs/oracle.mjs`, `scripts/flows-nightly/sections/oracle.mjs`, `tests/flows-oracle.mjs`, `docs/oracle.md` | The Oracle, the Neuron's always-on view of each name (design in `docs/oracle.md`). `shared/flows-oracle.js` is a pure leaf that turns a card and its engine block into the stored record `oracle:<T>` (state, stance, at most three cheap or rich calls, context, withheld reasons, limits), with every sentence from `shared/flows-oracle-words.js` (no forecast, modal or advice word, and the model-implied footer on every call). A call comes only from a single-leg structure the engine published, and only when its edge clears the pre-registered bars. `COMPUTE_JOBS` now holds `ORACLE_JOB`; the isolated `oracle-publish` stage publishes `oracle:<T>`, the `oracle-top` ranking and the `oracle-norm` ledger (`FLOWS_ORACLE_BUILD=off` skips it). `GET /api/flows/oracle` (`?t=`, `?ts=`, `?top=1`) is a row in the route table behind `FLOWS_ORACLE` (`on`, `owner` or off, fail closed). `shared/flows-oracle-live.js` holds the seven live-flow detectors the client runs over the rail's alert rows. |
| `assets/css/flows-nn.css`, `assets/js/flows-nn-orb.js` | The Neuron identity (design v3 Lane 2). `flows-nn.css` holds the `--nn-*` tokens, the CSS orb (`.nn-orb`, the first paint and the fallback), the four-strip edge light (`.nn-edge`), the Ask screen edge `#nnScreen`, the wordmark, the app tile and the calc tile, the states (`idle`, `think`, `refresh`, `spoke`, `plain`, `off`, written as `data-nn` by `FlowsUI.nn`), motion only inside `prefers-reduced-motion: no-preference` with finite iteration counts, and the forced-colours block. The mark is the lens glyph (`g-neuron`, `g-neuron-s`; `g-calc` for arithmetic) and no mark carries four-fold rotational symmetry with curved arms. `assets/js/flows-nn-orb.js` is the deferred group `nn-orb` (`FlowsUI.nnOrb`: `mount`, `update`, `destroy`, `scan`): on every `.nn-orb` of 40 px or more outside `plain` and `off` it mounts a WebGL canvas that ray-traces a glass sphere per pixel (Schlick Fresnel, Snell's law with the indices 1.49, 1.51 and 1.53 for the three channels, eight-step emissive volumes from the Neuron tokens, a thin-film caustic along the upper third, an environment read once from the page's aurora and ground tokens). Idle is one frame; think and refresh run at most 30 frames a second, stop when the tab is hidden or the orb is off screen and after 180 s; spoke is one 720 ms bloom; reduced motion is one frame; no WebGL, a lost context, reduced transparency or forced colours leave the CSS orb. It is asked for by `flows-overview.js`, `flows-ticker.js` and `flows-oracle.js`. |
| `docs/design/neuron-icon.svg` | The master app icon of the Neuron: a glass sphere lit from the top left with the spectral caustic across its upper third. Not served; literal colours are allowed here. |
| `tests/flows-nn-render.mjs` | The Neuron identity in Chromium with no server: the lens glyph byte for byte and its 90 degree rotation, the server markup of every Home state, `FlowsUI.nn` on a paused clock, every animation's properties, iteration counts and 185 s bound, reduced motion and forced colours, the physics orb's pixels (rim against centre, hues in the top band, the key light, frame identity at idle, the frame census, the WebGL fallback) and the stylesheet scans, with planted wrong builds. |
| `assets/js/flows-oracle.js`, `assets/js/flows-oracle-core.js`, `assets/js/flows-oracle-boot.js`, `assets/css/flows-oracle.css` | The Neuron's always-on presence in the Flows shell (the client lane of the Oracle design; `FlowsUI.oracle`, `FlowsUI.oracleWords`, `FlowsUI.oracleLive` and `FlowsUI.oracleKit`, added to the existing global, no new one). `oracleShell(html, mode, slug)` in `shared/flows-pages.js` is the one server touch: for a member the switch allows (`FLOWS_ORACLE` is `on`, or `owner` for an owner; anything else is off and the page is byte for byte unchanged) it adds `<div id="fxOracle" hidden>`, two `<i hidden data-defer="oracle">` elements (the core, then the module; the stylesheet rides on the first as `data-css`), the 0.1 KB `flows-oracle-boot.js` that calls `FlowsUI.defer("oracle")` after the load event, a reserved 40 px `#orcHome` row on Home and a 40 px `#orcBand` row above the Unusual network, so nothing below them moves when they fill. The route `server/routes/flows-pages.js` wraps each rendered page in it. `flows-oracle-core.js` is pure: the wording tables (`STANCE_LINES`, 16 fixed strings, `MODEL_IMPLIED`, `callSay`, `liveSay`, each held to the Ask guard's forecast and modal lexicon and a 24-word sentence by `tests/flows-oracle-core.mjs`) and the seven live detectors `detect(state, rows, context, nowMs, {live, refuses})` over the flagged windows a page already holds (surge, same-strike repeat, lean flip by the site's convention, expiry cluster, sweep burst, size outlier, sector together), each compared with the name's own stored norm (a name with fewer than 20 windows of history or no stored context is silent), silent outside the regular session (Eastern arithmetic proven equal to the zone at every quarter hour of 2026), for the first 20 minutes, for a feed that is not live and for a fixture name, with a 30 minute cooldown per name and kind unless the strength rises, a cap of six messages in 30 minutes (the rest counted as quiet ones), an event multiplier of 1.5 inside 21 sessions of a report and dedupe by window id. `flows-oracle.js` reads `GET /api/flows/oracle?top=1` once, `?t=` for the ticker page and `?ts=` (at most 12, once in 30 s) for names the flow names that carry no context yet; a 404 or a failed read is the honest resting state with Retry, never an error wall. The orb is a 52 px glass disc (a button with `aria-haspopup="dialog"`, 44 px target) with states calm, watching (a turning arc), signal (a pill with the headline, a count badge; on a phone a toast for 6 s), conflict (a split rim) and stale (outlined); it opens a dialog sheet (380 px on a desktop, a 70 dvh bottom sheet on a phone) with the live messages, the name's record (stance chip with glyph and word, up to three call cards: cheap or rich badge with arrow, three tabular figures, `Show why` details on a grid-rows reveal, the model-implied line under every call) and the strongest names of the day; focus trap, `inert` page behind, Escape and scrim close and return focus to the orb, arrow keys move between cards, one polite announcement every five seconds. Motion is CSS only (the repository's spring tokens, `transform` and `opacity` and `clip-path`), none under reduced motion, no frame loop at rest. The preference is the first-party cookie `fn_oracle` (`on`, `quiet` or `off`, Path `/flows`; it can lower the page's mode, never raise it; Shift+N restores a hidden orb) and an optional `fn_oracle_haptic`. The ticker's reading rail gets a one-line `.orc-glance` button above its footer through `FlowsUI.oracle.glance(rail, ticker)`. It makes no vendor call and no model call, writes text and never markup, and names only TRT. |
| `tests/flows-oracle-core.mjs`, `tests/flows-oracle-render.mjs`, `tests/lib/oracle-fixtures.mjs`, `tests/lib/oracle-world.mjs` | The Neuron's client lane. `flows-oracle-core` loads the core in a bare `vm` and holds the formatters, every template and every detector threshold from both sides (at the bar and one dollar under it, at 64.4 and 64.6 per cent printed, 749 and 750 contracts, 19 and 20 minutes into the session) to independent computations, runs 400 random calls and every template through the Ask guard with modals on and the advice and lint lexicons, proves the Eastern arithmetic against the zone, and plants 28 wrong builds. `flows-oracle-render` (Chromium, `page.route`, no server) holds the sheet, the orb, the tab bar, the focus trap, the inert page, Escape and focus return at 1440, 1024, 390 and 320 px, the figures to an independent formatter, the dash for a null, TRT only, the resting state and Retry, the preference cookie, the glance block on a ticker rail, a scripted `fl` stream through the real detectors (messages, pill, count, throttled announcements, no message from a stale feed, a hostile ticker that never reaches `innerHTML`), reduced motion with no running animation, a zero paint census, a source scan for colour literals, comments, layout transitions and storage, and 12 planted wrong builds of the served files. `oracle-fixtures` builds records to the frozen contract with fixture tickers (`SYO001`...) and `oracle-world` serves a page and the routes. |
| `tests/flows-oracle-home-render.mjs` | The go-live checks of the Neuron outside the ticker (Chromium, `page.route` through `oracle-world`, no server): a pending `oracle-top` body (`status: "pending"`, `generatedAt` null) is the resting state on Home and in the sheet, never "No call clears the bar"; an empty published ranking names its session and never says tonight; Right now says the session is closed outside the regular session, that the page does not stream flow (with a link to Flow) on a page that connects no `fl`, and that the feed is not live on Flow; and the orb covers no figure of a visible board row on `/flows/long/` and `/flows/short/` at 1920x1080, 1440x820 and 390x844. |
| `scripts/research/flow-registry.json`, `scripts/research/flow-registry.mjs`, `tests/flows-flow-registry.mjs` | The flow signal registry (F-34), committed before any outcome is seen. `scripts/research/flow-registry.json` holds ten signals (Alert activity S1, Screen activity S2, Alert direction with sign S3, burst on vendor alerts S4, burst on large prints S4p, flow turned S5, live opening bound S6, the vendor's sweep-and-volume-over-open-interest rule S7 and unusual preset S8 as benchmarks, contract-level unusual volume S10), each with a live series beside its reconstruction (S1r and so on) that are never pooled, three horizons (the flag's publication to its session's close, the next close, five sessions) and so thirty tests, each pinned to an event target of `shared/flows-targets.js` on the typical-day scale at k = 3 (an up and a down target for a signed signal; the vendor's implied move and any model-owned sigma are refused), the table of targets pinned by version and hash, the five-rule protocol (returns start at the flag's publication, fits see only the past, the universe is the one as of each date, a live series is never pooled with its reconstruction, every name-day of the universe is evaluated), Benjamini-Hochberg at 0.05 across the thirty once per regime and Holm for S1 at the next close across S1's three horizons. `scripts/research/flow-registry.mjs` loads and validates it (a result, a stale targets table, a flipped protocol rule or a target outside F-11 is a problem). `tests/flows-flow-registry.mjs` pins each test's definition hash (a change of definition is a new id) and runs six leaks, each the registered protocol with one rule flipped, on a seeded null history: the registered protocol holds its 5%, and the return measured from the window start, a fit that sees the test day, today's universe applied to old dates, a live series pooled with its reconstruction, evaluation on outcome-selected days and on flagged days only each reject at least 90%. |
| `server/routes/flows-rt.js`, `tests/server-rt.mjs` | The rail family in the route table: `flowsRtRows({ serveRt })` is three rows, `/api/rt/ws`, `/api/rt/snap` and `/api/rt/status` (the paths are `RT_PATHS`, declared beside the handler in `shared/flows-rt-routes.js`), each with `methods: ["*"]` and `auth: "none"`. The rail answers its kill switch before it looks at the method or the session, so a mistyped, absent or off `FLOWS_RT_MODE` is a 404 `rt_off` even to an anonymous `OPTIONS`, and only then does it take the session (401), the method (405 naming GET), the audience (403) and the topic list (400); the router therefore gates neither, and the row hands the request to `serveRt` bound in `worker.js` with `json`, `HttpError`, `requireSameOrigin` and the session reader. The prefix branch stays in the chain for every other path under `/api/rt/`, through the same bound handler, so an unknown path is still the kill switch's 404 or a JSON `not_found`. The suite compares the rows with the branch they replaced over 6,000 requests (every path, query, method, environment with the rail on, off, unset, without its binding and for members, caller and upgrade-header set; status, headers, body, the error and the session reads) and scans the Worker for the single bound call. |
| `tests/film/capture.mjs`, `tests/film/assemble.mjs`, `assets/img/flows-walkthrough-v2.*`, `tests/flows-film-contract.mjs` | The Flows walkthrough film (v2) on the public About page. `capture.mjs` renders the real pages from the test fixtures at 1920x1080 on a virtual clock (15 fps, JPEG frames, every frame carrying a Sample data ribbon, scenes that cannot open are skipped and named in `manifest.json`, `--only 5,7` re-captures chosen scenes); `assemble.mjs` renders the title and end cards, joins the scenes with crossfades through ffmpeg into `flows-walkthrough-v2.mp4` (H.264, under 8 MB), its poster and English WebVTT captions, and checks the result with ffprobe. The About page plays it with controls, no autoplay and `preload="none"`; `flows-film` holds the markup, the sample-data caption and the file sizes. Not generated in CI: the committed files are the product, regenerated by hand with `node tests/film/capture.mjs --out <dir>` then `node tests/film/assemble.mjs --frames <dir> --out assets/img`. |
| `tests/flows-desk-audit.mjs`, `tests/flows-desk-audit-render.mjs` | The Premium desk audit's regression suites. `flows-desk-audit` (Node, no server) drives `worker.js` against stubbed vendor bodies: a missing, zero, negative or unreadable `prev_close` is `null` on the chain and strategy routes and never the spot (the Strategy hero prints a dash with its reason instead of a flat +0.00); the strategy route's engine (`engine=1`) prices off the regular close after the bell, before the open and on a weekend, reading the bars once and only when the state is not a regular print, and says it is unavailable when no regular price exists; a report that precedes every possible sale (`earnings.precedesSale`) leaves every line `null`, not `crosses`. Each is held by planted Worker builds loaded through `tests/truth/mutants.mjs`. `flows-desk-audit-render` (Chromium, `page.route`, no server) holds: no late response for the old side in the list after a Puts to Calls switch (a request token per entry, invalidated by `setSide`), a kept copy served under the rate limit saying so with its own read time in TRT and not promising that Refresh requotes it, the earnings line per symbol (passed date, report before the next sale, clear, undetermined, crossing), the best deployment being the line that earns the most time value (cash in shown beside it, the in-the-money part named as not income), the short-call `Premium ÷ collateral` rank asking the server for `yieldOnCollateral`, the Forward fact of each line and the cushion copy, no signed zero, one answer under six process time zones, the WCAG 2.5.8 spacing of every undersized target at four widths and axe clean on the populated desk at 390 and 1440. Each is held by planted wrong builds of the served script. |
<!-- /gen:filemap -->

## Curriculum and stage contracts

<!-- gen:courses -->
`window.TOPIC_META` in the lightweight `course-catalog.js` holds 12 courses
(365 stages in all, which `tests/contracts.mjs` and `tests/academy-contract.mjs`
pin):

```text
ols 20 · iv2sls 31 · did 29 · var 30 · panel 30 · logit 32 · gmm 33
foundations 32 · mle 32 · forecast 32 · coint 32 · financial 32
```

Courses by module count, each module owning ordered stages: 4 modules: `ols`,
`iv2sls`, `did`, `var`, `panel`, `logit`, `gmm`; 5 modules: `foundations`,
`mle`, `forecast`, `coint`, `financial`.
The generated review bank holds 106 items, the skill graph 84 skills,
the challenge bank 252 variants, and `LEARNING_PATHS` 5 guided paths.
<!-- /gen:courses -->
The canonical authoring inputs remain `curriculum.js`, `curriculum-data.js`, and
`curriculum-questions.js`; neither the catalogue nor the course page downloads
those heavyweight combined sources. Run this after any authored course change:

```bash
node scripts/generate-course-payloads.mjs
```

Commit all changed generated course payloads plus `assets/data/review-bank.json`,
`assets/js/review-catalog.js`, and `shared/review-manifest.js`. The generator
adds `schemaVersion: 2` and stable per-module stage IDs. Review IDs are globally
namespaced as `<course-id>:<stage-id>`. Current course progress is still stored
by flattened stage index, so inserting or reordering stages changes the meaning
of existing progress; append stages or ship an explicit progress migration.

Stage schemas:

- `read`: `{ type, title, html }`
- `code`: `{ type, title, code, note?/html? }`
- `interactive`: `{ type, title, note, params, template }`; template uses
  `{{paramName}}` placeholders.
- `quiz`: `{ type, title, prompt, choices, answer, hint?, explain?, points? }`
- `truefalse`: boolean `answer`
- `multi`: `choices` plus integer-index `answers[]`
- `numeric`: finite `answer`, non-negative `tol` and/or `rtol`, optional `unit`
- `fillblank`: prompt containing exactly one `___`, plus non-empty `accept[]`

Default rewards are read 5, code 10, interactive 10, and quiz 15. Authored
question rewards override defaults: true/false 10, fill-blank 15, numeric 20,
and multi-select 20. `tests/contracts.mjs` proves that authored curricula,
generated payloads, the browser manifest, and `shared/course-points.js` remain
identical. It also requires unique generated stage IDs and caps every module
file at 6,144 bytes gzip.

Both client and server derive points from unique completed stages. This repairs
legacy local under-counts and stale/tampered totals. Client-submitted point
totals are deliberately ignored; D1 recomputes its exact total atomically from
the merged progress rows.

## Client persistence

All browser storage access must go through `window.IEWTStorage`. Learning data
uses owner-scoped v2 envelopes:

- `iewt:progress:v2:<encoded-owner>` → `{ version: 2, owner, value: progress }`
- `iewt:gamify:v2:<encoded-owner>` → `{ version: 2, owner, value: gamify }`
- `iewt:mastery:v2:<encoded-owner>` → `{ version: 2, owner, value: mastery }`
- `iewt:mastery-outbox:v2:<encoded-owner>` → pending idempotent review attempts
- `iewt:placement:v2:<encoded-owner>` → `{ version: 2, owner, value: { band, score, total, completedDay, recommendedTopic } | null }`
- `iewt:sync:v2:<encoded-owner>` → `{ version: 2, owner, generation }`
- `iewt:activeOwner` → the account scope last verified and announced by this browser
- `iewt:guideW` → device-wide guide-column width percentage
- `iewt:splitW` → legacy width key, migrated once to `iewt:guideW`

The old `iewt:progress` and `iewt:gamify` values are anonymous-only migration
inputs and mirrors; authenticated state must never be copied into them. On its
first local binding, an account without an existing local scope may claim work
completed before sign-in. A returning local account scope stays isolated from
another account or anonymous profile on the same browser. Cross-tab owner
changes invalidate stale synchronization state.

`storage.js` validates owners, shapes, bounds, dates, numbers, and non-negative
safe-integer synchronization generations. Every native
`localStorage` operation is inside `try/catch`; an in-memory copy preserves the
current page when storage is unavailable. `resetLearning()` clears progress,
gamification, mastery, its retry outbox, and placement for an explicit or active
owner, records the confirmed reset generation, and deliberately preserves
`iewt:guideW`.

When signed in, the client serializes mutations, binds them to the verified
account and a mutation epoch, unions local and remote progress, uploads only
missing work, then refreshes exact server-derived points and monotonic streak
state. Initial signed-in hydration uses `/api/bootstrap`; granular endpoints
remain the mutation and compatibility surface. Every authenticated progress,
stats, mastery, and placement request carries `X-IEWT-Owner`. Their PUTs and the
standalone placement DELETE also carry the latest owner-scoped
`X-IEWT-Generation`. D1 uses an atomic JSON-union UPSERT guarded by that
generation, so overlapping snapshots cannot delete completed stages and a
delayed pre-reset write cannot recreate cleared data. Mastery attempts use a
stable attempt ID and a local outbox: signed-in retries are idempotent, while
signed-out review remains owner-scoped on the device.

## API contract

Every `/api/*` response, including errors, is JSON and `Cache-Control: no-store`.
Errors use:

```json
{ "error": { "code": "unauthorized", "message": "Authentication required" } }
```

- `GET /api/me` → `200 { user: { id, email, name } | null }`
- `GET /api/bootstrap` → signed-out `200 { user: null }`; signed-in `200 { user, progress, stats, mastery, placement, generation }`
- `GET /api/progress` → `200 { progress, generation }`; signed-out → JSON 401
- `PUT /api/progress` with `X-IEWT-Generation`, body `{ model, done }` → `{ ok: true, done, generation }`
- `DELETE /api/progress` → `{ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, mastery: {}, placement: null, generation }`
- `GET /api/stats` → `{ stats: { points, streak, last }, generation }`
- `PUT /api/stats` with `X-IEWT-Generation`, body `{ streak, last }` → `{ ok: true, stats, generation }`
- `GET /api/mastery` → `{ mastery, generation }`
- `PUT /api/mastery` with `X-IEWT-Generation`, body `{ itemId, attemptId, correct, hinted, day }` → `{ ok: true, record, duplicate, generation }`
- `GET /api/placement` → `{ placement: { band, score, total, completedDay, recommendedTopic } | null, generation }`
- `PUT /api/placement` with `X-IEWT-Generation` and the five-field placement summary → `{ ok: true, placement, generation }`
- `DELETE /api/placement` with `X-IEWT-Generation` → `{ ok: true, placement: null, generation }`
- `GET /api/v2/bootstrap` → signed-out `200 { user: null }`; signed-in the
  `/api/bootstrap` fields plus `stableProgress`, `skillMastery`, `preferences`
  and `projects`, with `generation`
- `PUT /api/v2/progress` with `X-IEWT-Generation`, body `{ courseId, stageId, complete: true }` → `{ ok: true, courseId, done, generation }`
- `PUT /api/v2/attempt` with `X-IEWT-Generation`, body `{ skillId, itemId, attemptId, correct, hinted, day }` → `{ ok: true, record, duplicate, generation }`; the attempt ID makes a retry idempotent and a reused ID with different data is `409 attempt_conflict`
- `PUT /api/v2/preferences` with `X-IEWT-Generation`, body `{ activePathId, sessionMinutes, weeklyGoalMinutes }` → `{ ok: true, preferences, generation }`
- `PUT /api/v2/project` with `X-IEWT-Generation`, body `{ projectId, mode, completedTaskIds }` → `{ ok: true, project, generation }`
- The v2 routes follow the same session, owner-header, same-origin and generation rules as the granular routes above.
- `GET /api/rt/ws`, `/api/rt/snap` and `/api/rt/status` are the Flows real-time
  rail (see "Real-time rail"); they use the Flows session, not the learning one.
- Unknown API routes are JSON 404. Unsupported methods are JSON 405 with
  `Allow`. JSON bodies are streamed with a 16 KiB limit and validated.
- Every vendor call the Worker makes outside the real-time rail (whose hub
  keeps its own adapter and `callTimeoutMs`) goes through `uwFetch`, whose
  fetch carries `AbortSignal.timeout`, so the deadline covers the body read
  too: 4 s by default (`RT_LIMITS.callTimeoutMs`, the rail's own per-call
  bound), 6 s for OHLC, the strategy desk's expiry breakdown, its dated retry
  and the greek-exposure fallback, 8 s for chain pages (the chain route and
  the strategy expiry pages), `LIVE_BUDGET.tier1TimeoutMs` (6 s) for the
  Tier 1 tick, the focus tick and the tape, and `UW_DOSSIER_DEADLINE_MS`
  (20 s) for the dossier's sources, whose foreground wait is its own 2.5 s
  per source and 3 s in all and whose remainder runs in `ctx.waitUntil`. The
  pipeline's `uw()` client calls the vendor outside the Worker and does not
  use `uwFetch`. Under `--live` (the Actions live leg) each call is bounded at
  `LIVE_VENDOR.timeoutMs` (20 s; `FLOWS_UW_TIMEOUT_MS` overrides it, from 100
  to 60,000 ms); the nightly run sets no per-call deadline.
  `UW_DOSSIER_DEADLINE_MS` matches the `--live` leg's bound, not the
  nightly's. An aborted call is
  JSON `504 chain_timeout` for a route whose caller throws, `null` for a
  caller that catches, and the quote card's `200` `unavailable` body with
  `why` `chain_timeout`. Before the deadline, a network failure or a body
  that cannot be read or parsed is `502 chain_upstream`, and the other codes
  are unchanged: a missing key `503 chain_unconfigured`, a vendor 429
  `429 chain_rate_limited`, any other vendor error status
  `502 chain_upstream`, and a body over the parse ceiling
  `502 chain_too_large`.

Authenticated PUT/DELETE requests require an exact `X-IEWT-Owner` match with
the verified session user. Conflicting `Origin` or `Sec-Fetch-Site` metadata is
rejected, and browser cross-origin use is blocked by the custom owner header
plus the absence of CORS permission. Missing or mismatched mutation ownership
returns JSON `409 account_changed`; identified cross-origin mutation attempts
return JSON 403. The four authenticated granular GET routes allow the owner
header to be absent for compatibility, but reject a present mismatch with the
same 409 response.

Every authenticated Lab mutation (the PUTs and DELETEs above and the four
`/api/v2/*` PUTs) is counted against the `LAB_WRITE` rate-limit binding, 30 a
minute per user id, after the session, origin and owner checks and before any D1
statement; the 31st answers JSON `429 rate_limited` with `Retry-After: 60`, and a
missing or failing binding admits the write. The browser treats a 429 as retryable
and keeps the attempt in its outbox. The 48-hour attempt-ledger prune is no longer
part of any request: the 03:00 ET housekeeping firing runs one indexed
`DELETE ... WHERE received_at < ?` per ledger (`migrations/0018`).

Missing, malformed, or stale `X-IEWT-Generation` values on PUT return JSON
`409 reset_required` with the current generation in both the response body and
header. The client discards the affected owner's stale local learning state
before any later upload. Full reset through `DELETE /api/progress` deliberately
does not require the old generation: it atomically increments the server value
and returns the new one. Standalone placement deletion is generation-fenced.

Progress models and indexes are allowlisted against the scoring manifest.
Stats writes accept only a bounded streak and a valid activity date no more than
one UTC day ahead. Older writes cannot replace newer activity, and a stale
next-day device cannot reduce a known consecutive streak. Points are recomputed
exactly from progress. Placement accepts only the fixed 15-question total, its
matching score band, a valid topic, and a completion date no more than one UTC
day ahead; individual answers never enter the API or D1. Reset uses prepared statements in one D1 `batch()`
transaction: it increments `learning_sync.generation`, deletes every progress,
mastery, mastery-attempt, and placement row for the verified user, and resets
that user's points, streak, and last-activity value without touching another
user. Mastery item IDs are allowlisted against the generated manifest; the attempt ledger
prevents a retry from incrementing counters twice. `schema.sql` provisions the
tables and the Worker has an idempotent first-use fallback for databases that
predate them.

Sign-out is `POST /auth/logout`, not a link or GET. It is same-origin protected,
requires the verified owner's `X-IEWT-Owner` when a valid session exists, clears
the session cookie only after those checks, and returns JSON. Do not restore a
GET logout route; that would reintroduce forced-logout CSRF.

## Flows Neuron reading

`GET /api/flows/summary?t=<ticker>` (behind the Flows session) answers for every
ticker, and the answer says which kind of reading it is. Old clients read
`status`, `summary`, `ideas` and `context`; these fields are added and none is
removed:

- `tier`: `priced` (the engine ranked ideas), `stand-aside` (the engine ran and
  no structure cleared; `code` is its `noTrade` code), `family` (a card with no
  engine block: the implied state and its structure family, unpriced),
  `screen` (no card, read from the universe row alone, no model and no vendor
  call), `unpriceable` (a board or focus card with no engine block, `code`
  `chain.absent` or `engine.absent`; or a universe row with no usable input,
  `screen.no-inputs`), `expired` (the card or row is two or more sessions
  behind the last close: the facts, no idea, no model, no spend) and `none` (not
  in the universe, `status: "absent"`). `tier` is `null` only while a name's
  card is pending, unreadable, or the store cannot be read.
- `code` and `why`: the machine code and the plain sentence for the tier. For
  `screen` a `code` is set only when the idea is No position (`event.window`,
  `premium.conflict`, `table.no-side`, `state.undetermined`).
- `screen` (screen and expired-row tiers only): the whole reading. Its `facts`
  each carry `label`, `display` (value and unit), `grade` (0 or 1) and `note`
  (the sign convention or the limit); `withheld` lists the inputs that were
  null or not in tonight's universe payload, each with its reason; `idea` is a
  family lean or No position; `limits` says what was not read.
- `verdictWord` is the tag beside the headline for the screen tiers.

The screen reading is computed at read time from the universe row (one batch
for the roster promise and the row, about `n + 40` rows read), kept in the Cache
API for five minutes, and never calls a model. A card one session behind the
last close keeps its tier with grades capped at 1; two or more behind, it is `expired`.
A family-tier card whose state is read but too weak for an idea abstains in
words (`abstentionIdea`) instead of leaving the reader nothing.

`read` (every summary answer, added after the tier contract; no field above was
removed or renamed): the name read as a stock, from the dossier. Its shape and rules
are in "Flows reading" below.

## Flows dossier

`GET /api/flows/dossier?t=<ticker>` (behind the Flows session) is the data half of
a per-name understanding layer: twelve typed packets for any name, assembled from
what the nightly and the live layer already hold, plus the vendor reads the
nightly never made (identity, fundamentals, analysts, news, ownership). It
serves the same tier semantics as `/api/flows/summary` (`tier`, `code`, `why`;
a name outside the universe is tier `none`, with a quote, its identity and its
news only), is JSON with `Cache-Control: no-store` and the `X-Fresh-*` headers,
and carries `X-Dossier-Fingerprint`, `X-Dossier-Tokens`, `X-Dossier-Vendor-Calls`
and `X-Dossier-Pending`. `&render=1` answers `text/plain`: the text a model is
shown. `&budget=<400..12000>` sets its token budget (default 3000).

The body is `{ ticker, tier, code, why, dossier, prompt: { tokensEst, budgetTokens,
shed, dropped }, trace }`. A packet is frozen at this shape:

```text
{ id, kind, title, status: ok|partial|withheld|unavailable|pending,
  source: { kind: nightly|live|vendor|engine, route|key }, asOf, session, ageS,
  klass: quote|tape|market|breadth|news|nightly|slow|static, ttlS,
  grade 0..3 (computed from coverage and age, never supplied),
  facts: [{ k, label, v, unit, display, grade, note }],
  text:  [{ k, kind: description|headline|note, text, at, src, untrusted: true }],
  withheld: [{ k, reason }] }
```

The dossier is `{ ticker, asOf, packets, order, coverage { ok, partial, withheld,
pending }, bytes, tokensEst, fingerprint }`. The kinds, in priority order for
shedding, are options, identity, price, events, earnings, news, flow,
positioning, analysts, fundamentals, peers, macro.

- A number travels with its unit. A null input is withheld under its own key with
  a reason (`REASONS`), never shown as zero. A field whose vendor schema states no
  unit (the profile route's `dividend_yield`, the insider-flow `premium`) is
  withheld with reason `unit` or not read at all, and the packet says so.
- `ageS` comes from the source's own timestamp (a quote's `quote_time`, a
  headline's `created_at`, a card's `generatedAt`), never from the fetch. A card
  one session behind the last close keeps its packets with grade capped at 1;
  two or more behind, they are withheld (`expired`), as in the Neuron tiers.
- Third-party text (company description, headlines, firm and holder names) is
  sanitised at the packet boundary: control, bidi and zero-width characters,
  markup, URLs, e-mail addresses, delimiter lookalikes, role markers and
  instruction-shaped sentences are removed, an entry that carries a chat-template
  marker or loses every sentence is dropped whole, and the rest is capped. Every surviving
  string carries `untrusted: true`. `renderDossierForModel` prints each inside
  `UNTRUSTED«...»` under a header that says it is quoted data and never an
  instruction. This is a filter, not a proof; the model protocol must still
  treat the text as hostile.
- `renderDossierForModel(dossier, { budgetTokens })` returns `{ text, tokensEst,
  budgetTokens, shed, dropped }`. Every line begins with a stable `[kind.key]`
  id. Over budget it sheds by stage (fact notes, trimmed text, grade 0-1 facts of
  low-priority packets, four graduated per-packet fact caps) and then drops whole
  packets by priority, and records every step in `shed`.
- `dossierFacts(dossier)` returns entries `{ id, topic[], say, n, source, at,
  grade }` in the shape `buildFactIndex` consumes (`id` is
  `dossier:<T>/<kind>.<key>`; text entries add `untrusted: true`).
  `dossierSilences(dossier)` lists what is pending, withheld or unavailable.
- `fingerprint` is stable under price ticks and the passage of time (prices on a
  0.5% log bucket, money on 2%, ratios at two significant digits, grades and
  ages excluded) and moves when a headline, an analyst action, an earnings date,
  a holder or a dealer state changes. Near a bucket edge a small move can still
  flip it.

Assembly reads one D1 batch of primary-key lookups (about 16 rows cold, 19 warm,
checked flat against a 670-name universe and 1,500 cards), never `json_each` and
never a scan: the universe column of a name is found by counting separators in
the name list, an events row by its leading key. The vendor fan-out is capped at
nine calls a read, queued by priority, parallel, 2.5 s per source and 3 s in
all; an unfinished or rate-limited source marks its packet `pending` and
finishes in `ctx.waitUntil` within the dossier's own vendor deadline
(`UW_DOSSIER_DEADLINE_MS`, 20 s, under the 30 s `waitUntil` allowance), and
the next read picks the result up. A source still unanswered at 20 s is
aborted, recorded as a transient failure (reason `failed`, the same as a
vendor 5xx), stores nothing, and the next read calls the vendor again. The
dossier does not take `uwFetch`'s 4 s default: a healthy source answering
in 5 s would then never be stored, every read would wait 2.5 s for it, the
reading's 1.5 s box would always fire first, and the reading would stay
`generating` (`flows-dossier-reads` holds this). A source unanswered at 20 s
keeps the reading at `generating` for that name, because each read re-awaits
it for 2.5 s, longer than the 1.5 s box; a source that answers in 20 to 30 s
is therefore not stored here, where an unbounded call would eventually have
been. The cure for the re-await is a 60 second negative marker in the Cache
API (`markUrl`, `MARK_TTL_S`), written when a source fails transiently
(a timeout, a 5xx or a network failure; a 429 or a plan refusal writes none)
and cleared by the next success: `planFetches` skips a marked source as
`failed-recently`, its packet reads `pending` with reason `failed`, and the
read neither calls nor awaits it. A read that starts before the aborted source
has failed still re-calls it once; when the reading's 1.5 s box fires before the
dossier is assembled, a vetted stored reading of the current `READING_VERSION`,
less than two sessions behind the last close, is served as `ready` with
`held: "previous"`, `refreshing: true`, its cite grades capped at 1 and no
tags (they are rules over the current facts, which are not yet known), read
concurrently with the assembly and costing no extra trip; with none, `generating`
as before. Slow kinds
(identity and fundamentals 24 h, positioning 24 h, earnings 12 h, analysts 6 h)
live in `flows_dossier_cache (ticker, kind)`, one row of at most 8 KiB each,
written once per refresh. News (5 min), the dark-pool levels (60 s) and the
quote (5 s) are Cache API entries, and a complete dossier is kept whole for 30
seconds (`/assembled/<T>`), which is what a burst of reads of one name costs.
Concurrent reads of one name share one flight (a cache-only read, which only the Ask box asks for, has its own). The limiter refusing, the vendor
failing or the store being unreadable are all `200` with the affected packets
`pending` or `unavailable`; none throws.

## Flows reading

`read` on `GET /api/flows/summary?t=<ticker>` is the model half of the per-name
understanding layer: what the company is, how its options market, flow, positioning,
news, fundamentals, sector and the market backdrop fit together, where they disagree,
and what is not known. It is separate from the Neuron's ideas: the options engine
stays the authority on structures and on every number, no ranked structure is ever
shown to or cited by the reading (`forReading` drops `options.idea.*`), and nothing in
`ideas`, `verdict` or `claims` depends on it. The summary route runs `tickerNeuron`
and `readingFor` concurrently and returns the Neuron's body plus `read`. A failure of
the reading is a `read` with status `unavailable`, never a failed summary.

```text
read: {
  version: 1,
  status: ready | generating | fallback | absent | unavailable,
  ticker, generated (bool), label: "Model wording" | "Deterministic reading",
  model, modelName, neurons, tokens: { in, out }   // all null unless generated
  provenance, note, why,                            // sentences; why is a short code
  fingerprint, asOf, session, generatedAt,          // the dossier's, ISO; generatedAt only when generated
  coverage: { ok, partial, withheld, pending },
  tags: [{ code, label, sentence, evidence: [fact id] }],
  sections: {
    identity: { text, cites } | null,   now: { text, cites } | null,
    drivers: [{ text, cites, tag? }],   tensions: [{ text, cites }],   watch: [{ text, cites }],
    unknown: [{ text, missing: [packet kind] }],
  },                                    // a cite is { id, label, display, asOf, kind, grade, ageS?, untrusted? }
  refused: [{ section, why, detail? }], // what the vet dropped from a model reply
  held?: "floor" | "fingerprint" | "limited" | "previous", refreshing?, retryAfterS?
}
```

- `ready` is a stored model reading served as it was written: every cite resolved at
  write time, so the prose and the chips describe the same figures. `held: "previous"`
  is a `ready` reading written for an earlier dossier of the current `READING_VERSION`
  (a version bump still retires every stored reading), served with its own
  `generatedAt`, `fingerprint` and a `note` while a new one is written, cooling down
  or refused: a failed regeneration never replaces a vetted reading. It is held only
  while its dossier is less than two sessions behind the last close and the name's tier
  is not `expired` (otherwise the deterministic reading of the current dossier is
  served), and each cite is served at no better grade than the same fact now has (its
  packet's grade, at most 1, when the fact is gone), at most 1 once a session has
  closed since it was written. Its `note` says an earlier dossier, or, when the dossier
  is the same and only the model signature moved, another model configuration; the
  Neuron's held note makes the same distinction. `refreshing: true`
  says a newer reading is being written (a claim younger than 90 seconds, a flight, or
  this call started one), and the ticker page keeps polling, inside its bounded
  schedule, while it is true; `refreshing: false` is a refusal cooling down or a store
  fault, and nothing is coming. `generating` and
  `fallback` carry the deterministic reading built from the current dossier by
  `readingFallback` (templates over the same facts, every sentence cited, passing the
  same checks a model's wording must). `generating` means a model call is in flight or
  was just started and the page should poll the summary. `fallback` means none is
  coming: `why` is `off` (`FLOWS_READ_MODE=off`), `no-model`, `store`, `cooldown`
  (a refused, unparsable or failed attempt; `retryAfterS` says how long, and the
  provenance names the reason, the daily budget being spent among them), or `limited`
  (the assembly had a vendor packet held back by a rate limit, read from the result's
  `trace.limited` or a `limited:` withheld reason, so it also covers a reader who joined
  another member's flight; no claim, no model call and no row write, `retryAfterS` 60,
  and a stored model reading of the same signature is served instead as `ready` with
  `held: "limited"`). One member's refusal therefore never writes the shared
  `read:<T>` row every member is served for the intraday floor. `absent` is a
  name for which no packet holds anything about the name (the market backdrop does not
  count): every packet is named unknown and no model is asked. A dossier that is still
  assembling after 1.5 s answers `generating` with no sections and finishes in `waitUntil`.
- The tags are a fixed table of 22 codes, each a deterministic rule with explicit
  thresholds (`TAG_LINES`) over grade-2 or better facts of ok or partial packets. The
  model may choose among the held tags and order them; a code that is not held is dropped
  and recorded. The rationale for every threshold is in the commit that set it.
- The prompt is the rendered dossier (budget 4,200 estimated tokens, the dossier's own
  shedding order) plus the held tags with their evidence ids, which stay citable
  whatever the render shed. The model answers one JSON object. `vetReading` drops a
  section that fails and records why; no `now` section, or fewer than two sections,
  refuses the whole reply and the deterministic reading stands. The checks: JSON shape and
  length caps; every cite exists, sits in an ok or partial packet at grade 1 or better and
  was shown to the model; every numeral appears in a cited fact (the Ask guard's
  normalisation, plus a sign forgiven only where words say the figure fell, and a unit
  check on %, x and K/M/B/T); the Ask guard's forecast and modal lexicon plus advice and
  certainty phrases; no markup, link, chat marker, refusal or second person; an entity
  guard (capitalised names, product codes and symbols the dossier never printed, and
  shouted words such as BUY); no run of seven words copied from a description or headline;
  a claim taken from a headline must say it is a headline's; dealer content needs the
  clause "on the vendor's convention (dealers long calls, short puts)"; identity must be
  grounded in the cited profile text; an unknown entry names packets that really are not
  ok and carries no figure.
- Storage and cost. One row per name in `flows_neuron`, scope `read:<T>` (no new table),
  written only with a vetted reading; the claim, the cooldown guard and a refused or
  failed attempt live on the sibling row `gen:read:<T>`, read concurrently with the
  dossier assembly once the intraday floor has missed (one more row, no sequential trip;
  never on a floor hit), and a vetted write releases the claim in the same batch. Until
  `gen:read:<T>` exists, a non-vetted guard the previous code left on `read:<T>` is the
  attempt. The Neuron's own row works the same way (`ticker:<T>` beside
  `gen:ticker:<T>`, both read in the summary's one batch, an answer `held: "previous"`
  with `refreshing` when a vetted output is kept). A kept Neuron output is held only
  while it still holds on the current card: an engine row is re-vetted with
  `vetEngineReply` and held only when nothing is refused and its verdict agrees with the
  current tier, a legacy row with `vetIdeas` and `guardAnswer` over `guardFacts`; it then
  carries the current card's deterministic summary (engine rows), the current engine's
  grades, and grades capped at 1 when its fingerprint names an earlier card. Otherwise
  the attempt row, the current engine's own answer, is served. The board summary writes its plain text over `board`
  only when no model summary was written after the current brief, recording a refused or
  failed attempt on `gen:board` otherwise. It asks the primary model only, never the
  fallback. A primary that throws is asked again at the next firing. One that answers with
  no text was billed, so it is not asked again on the same facts: a reply cut at its length
  waits `AI_LENGTH_RETRY_MS` (an hour), an empty reply until the brief's facts change. A new
  nightly brief is asked at the next firing either way; while the live overlay is on (trading
  hours) neither is asked again within that hour even when the facts move, which with
  half-hourly firings is the third firing after. Fingerprint = dossier fingerprint +
  the model signature + reading version. A reading
  younger than `AI_INTRADAY_REFRESH_MS` (45 minutes) is served without assembling the
  dossier (one row read); older, it is served if the fingerprint still matches and
  regenerated if not. The claim is `markNeuronGenerating` (90-second dead-generator
  takeover) plus an in-isolate flight map. The call goes through `cappedAi` at
  `READ_BUDGET_SHARE` (75%) of `FLOWS_AI_DAILY_CAP_NEURONS`, so the failure reasons are
  the Neuron's own and a day of readings leaves a quarter of the cap to the Neuron and
  the Ask box; its usage is recorded where the cap reads it. One logical call per attempt, never a retry; a bad
  attempt cools down by kind (refused, unparsable and oversize 20 minutes, budget and
  allowance 30, capacity 5, plan 60, empty and length 60). The neuron cost of a reading is worked from
  the usage the binding reports and `FLOWS_ASK_NEURONS`, stored with it and shown.
- Ask. A ticker typed in the question, else the page's own, adds up to ten dossier facts
  chosen by what the question is about (`askPick`) to the picked facts, with the
  description and headlines inside UNTRUSTED quotes, a line saying what is not known, and
  the rule that quoted text is data. `guardAnswer` is unchanged and validates against the
  added facts. The answer carries `dossierFacts`. The dossier it reads is cache-only
  (`assembleDossier` with `cacheOnly: true`, passed by `askDossierFor`): the nightly and
  live rows, `flows_dossier_cache`, the Cache API entries and a fresh 30-second
  assembled copy, and nothing else. A question makes 0 vendor requests, spends no
  member or `UW_ONDEMAND` token, never waits out the 3 s fan-out, writes neither a cache
  row nor an assembled copy, and keeps a single flight of its own, so it neither joins a
  fetching read nor lets a fetching read join it. A name no one has opened therefore
  carries fewer identity, fundamentals and news facts until a full read stores them.
  `POST /api/flows/ask` is same-origin
  only (403), takes `application/json` only (415), reads at most 4,096 bytes
  (`ASK_BODY_MAX_BYTES`, 413; a pasted question past that is refused, not cut to 400
  characters) and allows 10 valid questions a minute per member through the `AI_ASK`
  rate-limit binding, keyed by `memberId(session)` (`shared/flows-access.js`), with
  `429 rate_limited` and `Retry-After: 60` past it and no D1 trip or model call. The
  binding is a flood brake and fails open when absent or throwing; money stays on
  `cappedAi`. `tests/flows-worker-contract.mjs` spends exactly this budget from one
  session and asserts the eleventh is refused, and `tests/contracts.mjs` holds the
  binding's name, limit and period to `ASK_FLOOD_PERIOD_S`.
- `FLOWS_READ_MODE` (`wrangler.toml` [vars], default `on`): `off` makes `read` the
  deterministic reading with no row read and no model call. Anything but `off` means on.
- Not proven offline: that a real model keeps to these rules. Every test uses scripted
  replies. The first live readings are the first evidence of the refusal rate; DEPLOY.md
  10.5m says where to look.

## Flows front door

`GET /flows/about/` and `GET /flows/glossary/` answer a signed-out reader with a static page: what Flows does, what
it promises about its figures, what it is not, and the terms its information buttons define. Both are noindexed like
every Flows page, make no API or vendor call, load `nav.js` alone, and go through the finaliser (`no-store`, the
security headers, the HTML CSP). `FLOWS_FRONT_DOOR` (`wrangler.toml` [vars], default `on`): `off` turns both into the
Flows 404; anything else means on. The sign-in form links to both and the members' sidebar footer repeats the links.
The about copy states what the product is not; it is placeholder wording until counsel has read it (the plan's A-13),
and it makes no performance claim.

## Real-time rail

`/api/rt/*` is the fast data rail. One Durable Object class, `Pulse`
(`shared/flows-rt-hub.js`, one named instance `pulse:1`, hosted in this Worker
and written to move to its own Worker with only a `script_name` on the binding),
polls the vendor over REST while at least one socket, or one `/api/rt/snap`
request in the last 60 s, exists, and pushes what changed over hibernatable
WebSockets. No viewer means no vendor call, and a topic is polled only while a
socket subscribes to it or a `/api/rt/snap` named it in the last 60 s; `gx` is
polled only for the focus tickers of sockets that ask for it (at most three,
each every 15 s), and `/api/rt/snap?k=gx` with none answers cold at once. A
topic that leaves demand forgets its failures and leaves `degraded`; `status`
lists all five with `demanded`. Cadences (`rtCadenceMs` in `shared/flows-rt.js`):
px and fl every 5 s in the regular session and every 9 s in the pre-market and
post-market, mk every 20 s, gx every 15 s a name, nw every 30 s and every 60 s
outside the regular session. A cadence plus the one-second tick, the 4 s call
deadline and a second of margin must fit inside its class's live window, which a
table test in `flows-rt-contract` holds (9 s is the longest px and fl value it
admits against `rt`'s 15 s), and the freshness classes are unchanged. Tier 1,
Tier 2 and the nightly are unchanged and remain the fallback. The hub reads D1 (the roster and the clock
row, one batch at start and every five minutes, and again after 30 seconds
when a read failed or timed out, keeping the roster it holds or the base names
meanwhile) and never writes it; it adds no `live:*` key, never touches the
`UW_ONDEMAND` limiter (its own budget is `FLOWS_RT_CALLS_PER_MIN`, default 240),
and never calls `env.AI`. The upstream
sits behind `createRestUpstream` so a WebSocket upstream can replace it
without touching the hub or the client: the hub calls only `start(plan,
handlers)`, `stop()`, `tick(now)`, `paused(now)` and `state()` (and `park()`
where an upstream has one), and receives
neutral frames `{k, readAt, items, vendorAt, meta, full, answered}` whose
`items` are already the wire's row shapes. `RT_UPSTREAM` maps each topic to its
REST request and to the vendor socket channels (px: `price:<T>`; fl: `flow-alerts`; gx: `gex:<T>`; mk: `market_tide`,
`net_flow:<T>`; nw: `news`).

The vendor socket upstream (P2-30) is built and on in `wrangler.toml`. `createCompositeUpstream`
in `shared/flows-rt-hub.js`, over the pure half in `shared/flows-rt-socket.js`,
joins one outbound vendor WebSocket (`price:<T>` for at most eight focus names,
`gex:<T>` for three, `flow-alerts`, `news`; never a firehose; `mk` stays on REST)
and lets the REST adapter read any topic whose channel is unacknowledged,
refused or silent. `FLOWS_RT_UPSTREAM` is `socket`, anything else is `rest`;
`wrangler.toml` sets `socket`, `createHub` returns the unchanged REST adapter unless it is `socket`
(under either audience: members share the one vendor connection), and `FLOWS_RT_SOCKET_HOURS` (`session` in `wrangler.toml`, `rth` when unset)
bounds when the socket is open. The token is put in a URL in `socketUrl` alone.
It has run against fakes and a loopback socket server in workerd, and has not
yet been confirmed dialling the vendor from a Durable Object; DEPLOY.md 10.5n holds the design, the probe runs and the lag.

Credentials never leave the object in text. `createRedactor` (`shared/flows-rt.js`)
removes the Worker's secrets the object can see (`RT_SECRET_ENV`, eight characters
or more) in their raw, URL-encoded and base64 spellings, and any `token=`, `api_key=`
or `Bearer` value by its name; `RtHub` redacts every log entry through its one
`log` call, the whole `status()` body, the roster error and the REST adapter's
internal-error message, and the callers redact before they truncate, so a cut
cannot leave a prefix of a key. `status` names the upstream by host only. A socket
upstream must build its URL in one function, pass every error through the same
redactor before it truncates it, and keep `[observability.traces]` off: a span
records `url.full` with the query.

Routes, all inside `route()` so the finalizer sees every response (a 101 keeps
its `webSocket` through `new Response(response.body, response)`):

- `GET /api/rt/ws` (Upgrade): Flows session, same-origin, audience gate, then
  the verified user and expiry travel to the object in `X-RT-User` and
  `X-RT-Exp` (any client `X-RT-*` and the cookie are stripped). Query `k`
  (topics, default all) and `f` (focus ticker). At most `FLOWS_RT_USER_CAP`
  (3) sockets per user: the next gets a `ctl.bye` with code 4009 and is closed.
- `GET /api/rt/snap?k=px,fl,mk`: the same envelopes as a JSON array, from the
  object's memory, `no-store`, with `X-Fresh-*` of the worst frame. It wakes
  the hub and waits up to 3 s for a cold topic. Query `f` (a focus ticker,
  validated and uppercased, 400 `invalid_ticker` otherwise) keeps that name in
  the hub's screener call for 60 s after the last request naming it (at most
  eight names, no extra vendor call). The response carries `X-RT-Poll-Ms` and
  `X-RT-Poll-Cap-Ms`: the owner is told 5000 and 0, a member 15000 and 600000.
- `GET /api/rt/status`: owner only. Mode, audience, upstream, sockets by user,
  per-topic sequence, last-frame age, last upstream error, vendor lag p50/p95
  (hub receive time minus vendor timestamp), calls in the last minute and hour
  by topic, the degraded episode and the kill switches. Per topic it also holds `rttMs` (a
  poll's start to its read), `emptyFrames`, `itemLagMs` (fl and nw only: the read minus the
  newest new item's own timestamp; the first poll of an epoch is a backlog and is not
  sampled) and `time { demandedMs, liveMs, vendorLagMs, oursMs }`, accrued at each tick while the
  market is in session: a demanded topic that is not `live` for a vendor reason (`vendor-lag`,
  `vendor-skew`, `vendor-unstamped`) counts as vendor lag, for any other reason as ours. A gap
  of more than three alarm ceilings between ticks is `unobservedMs` and is charged to no class.
  All of it is memory, resets with the epoch (`ep`, `startedAt`), and nothing writes it to D1.
  The client's `FlowsUI.rt.measure()` adds `transitMs` (p50 and p95 of receive time minus the
  frame's `at`, against the offset the hello taught; an estimate, labelled as one).

Kill switches fail closed. `FLOWS_RT_MODE` is `on` or anything else is off
(routes answer JSON 404 `rt_off`, even to an anonymous caller; an absent
`PULSE` binding is the same and never throws). `FLOWS_RT_AUDIENCE` is
`members` or anything else is `owner`; the shipped value is `members`, so any
signed-in Flows member may open a socket or read `/api/rt/snap`, and `owner`
in `wrangler.toml` is the way back (a deploy overwrites the dashboard's variable
list, so the file is what the next deploy runs). Flows has no owner concept, so
`FLOWS_RT_USERS` (comma-separated member names, default `anilkaya`) names the
owners; an empty value admits nobody, and `status` is owner-only under either
audience. `FLOWS_RT_HINT` is the Durable Object location hint (`enam`). Test
only, honoured only while `UW_BASE` redirects the vendor: `UW_NOW` pins the hub
clock (it then advances with real time) and `FLOWS_RT_SCALE` (0.05 to 1) scales
every cadence, deadline and linger.

The wire contract is frozen in `shared/flows-rt.js` and the client codes
against exactly this:

- Envelope: `{"v":1,"k":"px|fl|gx|mk|nw|ctl","ep":<epoch ms, new on every hub
  (re)start>,"sq":<per-topic sequence, +1 per frame within an epoch>,"at":<hub
  send time ms>,"snap":true on a snapshot,"fresh":<the `entryOf` shape>,"meta":{},"rows":[]}`.
  `ctl` frames add `"t"` (`hello`, `hb`, `resync`, `degraded`, `closed`,
  `bye`), carry `sq` 0 and no `fresh`. One counter per topic: a shared counter
  manufactured 62,000 false gaps in the design measurement.
- A snapshot taken for one socket carries the topic's current `sq`, so the next
  broadcast is `sq + 1`. Every successful poll broadcasts one frame, with
  `rows: []` when nothing changed, because the frame is what refreshes `fresh`.
- Rows. `px`: `[ticker, qt, ...strip values]` (`meta.cols` on snapshots),
  latest wins by vendor quote time, changed rows only (`qa` is not a change).
  `fl`: the `live:alerts` row plus `id` and `ts`, ascending, appended and
  deduped by alert id, at most 200 a frame, `meta.cursor`, `meta.dropped`,
  `meta.truncated`. A hub with no cursor (a restart, a deploy) asks first for
  the last 15 minutes (`RT_LIMITS.flowFirstWindowMs`), not for the session
  start, so the tape does not rebuild from the newest 200 alerts of the day.
  `gx`: `[ticker, atMs, px, gOi, gVol, gDir, flow, lagS]`,
  one name per frame. `mk`: objects with an `id`, `tide` plus one per sector
  ETF (the `live:market` sector rows). `nw`: the nightly news row plus `id` and
  `ts`, at most 60.
- Client to server, at most 256 bytes: `{"t":"sub","k":[...],"f":"NVDA"}`,
  `{"t":"p","sq":{px:n}}` (a client more than 10 frames behind is closed with
  4008), `{"t":"rs","k":"px"}`. Anything else closes 1009.
- Close codes: 1009 bad message, 1008 flood, 4001 session expired, 4008
  laggard, 4009 connection cap, 4011 rail off, 4012 hub full. A server-side
  close is always preceded by `ctl.bye {reason, code}`, and that frame is the
  authority: a client closes its own end on it and does not reconnect on 4009,
  4011 or 4012. In the local workerd a close of a socket that has never sent a
  client message is acknowledged but never raises `close` in the client; a close
  of a socket that has sent one does.
- Revocation: the Worker forwards the member epoch it verified the session at
  in `X-RT-Uep` (the object falls back to its own lookup when the header is
  absent) and the hub keeps it in the socket's attachment. At every roster
  refresh, before the D1 read and whether or not that read succeeds, it checks
  each such socket against `FLOWS_CREDENTIALS`: a member who is gone, past their
  `until` day or on a different epoch gets `ctl.bye {reason:"member-revoked",
  code:4001}`, so revocation reaches the rail within `rosterMs` (5 minutes). A
  socket with no recorded epoch (an older attachment) is not checked.
- Freshness: classes `rt` (5/15/60), `rtSlow` (10/30/120), `rtNews` (30/75/300)
  apply their live and stale windows in the pre-market and post-market too. A
  frame of a stamped topic (`px`, `gx`, `mk`) is `live` only when the newest
  vendor timestamp in it is within `liveS` (plus the vendor's bar width, 60 s
  for `gx`, 300 s for `mk`) of the hub's read; otherwise `fresh` with reason
  `vendor-lag` (or `stale` past `staleS`), `vendor-unstamped` or `vendor-skew`,
  and `liveUntil` is null so no client extrapolates it back to live. Event
  topics (`fl`, `nw`) are live by the success of the poll.
- The hub polls only 04:00 to 20:00 ET on trading days (the repository's
  calendar plus the `flows_clock` verdict); outside it sends `ctl.closed`
  once and makes no vendor call.
- The alarm is set to the next thing due, not once a second: `RtHub.tick()`
  returns the least of the next demanded topic's due time (a pause pushes it to
  its end), the next heartbeat and the sweep, held to
  `RT_LIMITS.alarmMinMs` (250 ms) to `alarmMaxMs` (5 s), and the adapter polls
  every topic due within `coalesceMs` (1 s) together, so a viewer of px, fl, mk
  and nw costs about 12 alarms a minute (about 11,500 Durable Object requests
  and rows written a 16-hour day, not 57,600). `Pulse` remembers its own alarm
  (`armed`), reads `getAlarm` once after a wake, never moves an alarm later, and
  retries a failed `setAlarm` once inside the handler, throwing so the platform
  retries the handler if both fail. Out of session the gap is `closedTickMs`
  (9 s): measured in workerd on 2026-10-10, a socket held on a Saturday with a
  30 s gap saw the object hibernate between alarms, a new hub and a new `ep`
  on every wake (three epochs in 75 s, two `ctl.resync` frames and no
  heartbeat), because a pending alarm does not keep an object resident and the
  epoch and the per-topic sequences live in memory. The gap while any socket or
  snapshot reader is demanded therefore stays under 10 s; persisting only the
  epoch would break "+1 per frame within an epoch" and persisting every
  sequence costs a row per frame.

The browser half is `assets/js/flows-rt.js`, `FlowsUI.rt`, loaded after
`flows-ui.js` (and `flows-fresh.js` where the page has it) on the boards, the
home page, the market page, the unusual page and the ticker. It codes against the
envelope above and assumes no cadence. It walks a ladder: the socket; on a
failure, a no-reconnect bye (4001, 4003, 4009, 4011, 4012) or repeated failures,
`GET /api/rt/snap` (naming the page's focus ticker) every `X-RT-Poll-Ms` (5 s until the
first answer, then the server's word) with the socket probed again after 1, 2, 4 and 8 s and
then every minute, for at most `X-RT-Poll-Cap-Ms` when that is not 0 (a member's episode is
ten minutes, at most 40 requests; a hello, a returning tab or the market's reopening
starts a new one) and then on heartbeats; the pages' own heartbeats underneath always; and `off` for the
page load when the snapshot answers 401, 403 or 404, in which case the page
behaves exactly as it did before the rail. A tab hidden for 30 s closes its
socket and holds no timer. Streamed prices reach a board as the `live:strips`
body the board already reads, so its rule that a live price is never printed
beside a nightly change holds without a second copy of it, and a polled read does
not overwrite a streamed one while frames are arriving.

## Worker invariants

1. **Preserve response objects when mutating them.** The single finalizer must
   begin with `new Response(response.body, response)`. Rebuilding an existing
   asset response from a status/header dictionary can corrupt
   `Content-Encoding` at the edge.
2. **Every response `worker.js` serves uses the finalizer**: auth, API
   success/errors, rewritten HTML, the assets it still proxies outside
   `/assets/*`, 404s, and unexpected exceptions. `/assets/*` never reaches the
   finalizer; `_headers` is its policy.
3. Full security headers apply to every response: `worker.js` sets them on
   everything it serves and `_headers` repeats them, verbatim, on asset-first
   `/assets/*` responses. CSP applies only to HTML and
   permits jsDelivr plus eval/WebAssembly evaluation required by Pyodide, and
   the first-party Cloudflare Web Analytics beacon origins. Its `script-src`
   also carries a fresh `'nonce-…'` per HTML response (16 bytes from
   `crypto.getRandomValues`, base64), which no page uses: Cloudflare's
   JavaScript Detections reads it from the header and puts it on the inline
   script it injects to load `/cdn-cgi/challenge-platform/scripts/jsd/main.js`,
   which the policy otherwise refuses. Never `'unsafe-inline'` for scripts,
   never a fixed nonce, and no `no-transform` (it would also stop the edge's
   compression). `tests/route-matrix.mjs` holds the policy byte for byte with
   the nonce normalised, one 16-byte `script-src` nonce per HTML response,
   a different one each time, and no CSP on a non-HTML response.
4. HTML is `no-cache`; successful/304 versioned assets are immutable for one
   year; other successful/304 assets cache for one hour; API/auth is `no-store`.
   Under `/assets/*` the policy is written by path in `_headers` (`css`, `js`,
   `fonts` immutable; `img`, `data` and the two version tokens one hour),
   because the asset
   layer sees neither the query string nor the status. Three classes therefore
   differ from what the finalizer computed: `/assets/css|js|fonts/*` is
   immutable even without `?v=` (was one hour), `/assets/data/*` is one hour
   even without `?v=` (unversioned JSON such as
   `/assets/data/projects/provenance.json` was the platform default
   `public, max-age=0, must-revalidate`), and `/assets/img/*` is one hour even
   with `?v=` (`atmosphere.svg?v=` was immutable). A missing file under
   `/assets/css|js|fonts/*` is a 404 under that immutable policy;
   `tests/worker-regression.mjs` pins it and DEPLOY.md §9 bumps the version on
   the first forward deploy after a rollback.
5. HTML sends no `Clear-Site-Data`. The one-time `"cache"` repair for the
   2026-07 encoding incident was retired in #116, and
   `tests/worker-regression.mjs` asserts the header is absent. Do not bring it
   back: it empties every returning reader's cache of the immutable assets.
6. Every `/lab/<valid-course-slug>/` receives an apex-domain canonical, exact
   title/description, Open Graph/Twitter fields, visible H1 and module
   outline (four modules for the seven original courses, five for the five
   newer ones, which share the generic Open Graph image), related course links, and one parseable Course + Breadcrumb JSON-LD
   graph. Generic and invalid legacy routes never return an indexable shell.
7. Malformed, oversized, wrongly signed, or expired sessions fail closed as an
   anonymous user and never throw a request-level 500.

Dashboard Transform Rules can override Worker and `_headers` headers after
code runs. A post-deploy header smoke test is mandatory; remove or align stale
dashboard rules if live headers differ from `worker.js` or `_headers`.

## Asset versioning

Two integer tokens version the browser assets. `assets/version.txt` is the
asset version: every local CSS and JavaScript reference in HTML, the course
shell's `data-asset-version` and `ASSET_VERSION` in `shared/flows-pages.js`
carry it as `?v=`. `assets/fonts-version.txt` is the fonts version: every
`@font-face` URL in `base.css` and every font preload in HTML carry it
instead, so an asset bump changes no woff2 URL and a returning visitor keeps
the fonts cached for the year `_headers` promises. Do not copy a current
value of either into documentation or automation.

The fonts token sits beside `assets/version.txt`, not under `assets/fonts/`:
`_headers` makes `/assets/fonts/*` immutable, and a second rule matching the
same path joins its `Cache-Control` onto the first with a comma rather than
replacing it, so a token in that directory would need the detach syntax to
stay revalidatable. `/assets/fonts-version.txt` gets the same one-hour rule as
`/assets/version.txt`, and neither token is fetched by any page.

When any file under `assets/css/`, `assets/js/`, or `assets/data/` changes:

1. increment `assets/version.txt`;
2. update every non-font `/assets/...?v=` reference (CSS and JavaScript, and
   also the image and data references such as `atmosphere.svg?v=` in
   `base.css` and `flows.css`), every `data-asset-version` on the seven Lab
   shells (`lab/course.html`, `lab/review/`, `lab/placement/`,
   `lab/challenge/` and the three `lab/projects/*/` pages), and
   `ASSET_VERSION` in `shared/flows-pages.js`, which
   `tests/flows-features.mjs` holds equal to `assets/version.txt`; running
   `node scripts/bump-assets.mjs` does steps 1 and 2 and is the safe way;
3. run the contract test (`npm run test:contracts`).

`test:contracts` runs `contracts.mjs` and then `lib-contract.mjs`, and
`lib-contract` holds the committed tree to `node scripts/bump-assets.mjs
--check`. That gate is stricter than `contracts.mjs`, which checks only the
CSS and JavaScript references, the fonts and three of the seven shells
(course, review, placement): `--check` also fails on an image or data
`?v=` in any page or sheet that is off the asset version, and on a
`data-asset-version` on `lab/challenge/` or a `lab/projects/*/` page that
is. A hand bump that moves only CSS and JavaScript can therefore pass
`contracts.mjs` and still turn CI red; the failure names each stale file
and reference.

`node scripts/bump-assets.mjs` does steps 1 and 2: it increments the token,
moves every non-font `/assets/...?v=` in the HTML outside `tests/` and `docs/`
and in `assets/css/*.css`, every `data-asset-version` and `ASSET_VERSION`,
and sets every woff2 `?v=` to `assets/fonts-version.txt` (normally a no-op).
It never runs the course generator: a change to a Lab source that
`lab-suite.bundle.js` bundles still needs
`node scripts/generate-course-payloads.mjs`. `--check` changes nothing and
exits non-zero when any reference is off its token or, read with the contract
test's own pattern, carries no `?v=` at all, which is the quick test after a
merge. A bump gives such a reference its token, and refuses, writing nothing,
when the reference runs on past `.css`, `.js` or `.woff2` (a `.json` the
pattern reads as `.js`).

A blanket rewrite of `?v=<old>` to `?v=<new>` also catches the sixteen woff2
references (eight `@font-face` URLs in `base.css`, one Inter preload in each
of the eight pages that preload it). The Flows pages preload the same file
from `head()` in `shared/flows-pages.js`, whose `FONTS_VERSION` constant
(deliberately not `ASSET_VERSION` and not read through `v()`) is held equal to
`assets/fonts-version.txt` by `tests/flows-features.mjs`; `contracts.mjs` does
not scan that file, so those references are not in the sixteen, and
`bump-assets` never moves the constant. A merge takes such a rewrite from
another branch silently, because this branch's font lines are unchanged.
The contract test fails on the first moved font reference, naming the file
and the expected token. After a bump and after any merge, run
`grep -rn 'woff2?v=' --include=*.html --include=*.css .` from the repository
root and set every hit back to the integer in `assets/fonts-version.txt`;
the contract test's summary line then reports sixteen font references at
that token.

When a font under `assets/fonts/` changes:

1. set `assets/fonts-version.txt` to the new `assets/version.txt` value (the
   `@font-face` URLs change, so `base.css` changes and the asset version
   increments with it);
2. update every woff2 `?v=` in `base.css` and the HTML preloads, and
   `FONTS_VERSION` in `shared/flows-pages.js`;
3. run the contract test.

The fonts token is therefore the asset version at which a font last changed
and never runs ahead of `assets/version.txt`. The contract test compares
changed files under `assets/css|js|data/` with `assets/version.txt` and
changed fonts with `assets/fonts-version.txt`, so a missing bump of either
fails CI.

## Testing and CI

```bash
# Requires Node.js 22.13 or newer.
cd tests
npm ci
npx playwright install chromium
npm test

# From the repository root: bundle/config validation without deployment
./tests/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/anilkaya-worker-dry-run
```

The suites prove:

- all twelve curricula (four or five modules each), every stage schema, exact generated
  per-course payloads and IDs, deterministic review artefacts, the
  balanced 15-item placement bank and sanitized result contract,
  browser/server mastery-scheduler parity, payload-size budgets, scoring
  manifests, owner-scoped v2 migration/reset behavior, local asset
  existence/versioning, and hardened sessions;
- real Worker-first routing, canonical redirects, all twelve crawlable metadata
  and syllabus variants,
  response-cloned asset byte integrity, conditional caching, security headers,
  JSON API errors, OAuth and POST-only logout behavior, D1 user isolation,
  concurrent progress union, owner-header and same-origin enforcement, mastery
  idempotency, generation-fenced transactional reset, stale-write rejection,
  and exact derived points;
- academy cockpit fold visibility, placement routing, command-center metrics,
  the guided learning paths, search/level/status filters, all five placement and
  Daily Mastery Review formats, single-course payload
  isolation, anonymous and signed-in reset safety, no
  horizontal overflow or browser errors across 320/390/768/1440 widths,
  WCAG-AA faint text, pill geometry, 44×44 primary course targets (including
  range inputs), ≥16 px text inputs, every stage heading outline, rapid
  navigation, preserved unsaved work during sync, splitter migration and
  keyboard persistence, blocked/malformed/quota-limited storage, score
  reconciliation, boot live-region output, grading edge cases, exact rewards,
  and duplicate-award prevention.

Source scans go through `tests/lib/source-scan.mjs`, never a raw read of
`worker.js`: `workerSource()` is the Worker's whole import closure, `slice()`
throws on a missing marker or a cut across a module boundary, `expect()`
takes a `min` of at least 1, and `absent()` requires a positive `anchor` that
must match the same source, so no scan passes on an empty match.

**Fixture policy (the repository is public).** A fixture is invented and says
so, and nothing invented may reach a member. The guard is four independent
layers, each proved by planted wrong builds in `tests/fixture-guard.mjs` and
`tests/flows-fixture-guard-render.mjs`: the pipeline refuses before the network
(`publish()` in `scripts/flows-nightly/store.mjs`: a fixture name, a
`fixture: true` stamp, or any fake having run, unless the ingest host is
loopback or a `.test` name; and a fake vendor base never publishes to a
non-test ingest), the Worker's ingest door answers 422 `fixture_ticker` or
`fixture_payload` for the same, the read routes answer 400 `invalid_ticker`
for a fixture name, and the browser quarantines a page that is sent one. The
only waiver is the request host; no variable switches a guard off. Rules for
what goes into a fixture:

1. An invented ticker is `SY<letter><3 digits>` (`SYN` for screener names,
   `SYL`, `SYS` and `SYW` for live boards, `SYX` for anything else) or
   `GONE<digit>`: `shared/flows-fixture-names.js` is the one definition. Never
   a letters-only word, which is or can become a listing, and never a bare
   prefix rule, which would refuse a real symbol. Letters-only names are
   tolerated only in pure unit tests that never reach publish, ingest or a page.
2. A real symbol appears in a fixture only where the code keys on that name
   (SPY, QQQ, IWM, DIA, the XL* sector ETFs, the focus roster of
   `shared/flows-focus.js`, the Mag 7 in the focus tests). Its figures are
   invented, and the dry run says so: every object payload it writes carries
   `fixture: true`.
3. A fixture token (the namespace above) is written only in `tests/`, `docs/`,
   Markdown, `scripts/flows-nightly/fixtures.mjs`, `scripts/flows-legs/*-fake.mjs`,
   `scripts/flows-legs/fake-vendor.mjs`, `scripts/flows-legs/live-day.mjs`,
   `scripts/render-preview.fixtures.json` and `scripts/eval-garch-tails.mjs`.
   A fake is called outside those files only inside a dry-run branch, and each
   fake taints the process on entry (`scripts/flows-legs/taint.mjs`).
4. No real person's name and no real issuer attached to a real symbol: invent
   both, as `fakePoliticalRaws` does.
5. No vendor row, verbatim or clipped. A fixture is written from the vendor's
   OpenAPI document and `scripts/flows-probe-shapes.json` by a generator it
   names in `source` or `provenance.generator` (see `tests/gen-dossier-fixtures.py`
   and `tests/gen-probe-fixtures.py`). The four older probe-derived fixtures,
   `tests/fixtures-live-probe.json`, `tests/fixtures-flows-legs-probe.json`,
   `tests/fixtures-vol-probe.json` and `tests/fixtures-flows-positioning.json`,
   were regenerated that way on 2026-10-25 by `tests/gen-probe-fixtures.py`
   (invented values and tickers, keys and JSON types checked against
   `scripts/flows-probe-shapes.json`), so `LEGACY` in
   `tests/flows-probe-contract.mjs` is empty; it may never name anything but
   those four, and the suite holds each to its generator, a source that says
   it is not vendor data and the manifest hash. Purging the earlier rows from
   git history is the owner's decision.
6. The Lab teaching datasets (`assets/data/projects/*-synthetic-v1.csv`,
   `synthetic: true` in their provenance) are not tickers and stay.
7. The Flows Vision sample world (calibration, latency and budget figures with
   real symbols) is concept data. `tests/fixture-guard.mjs` fails when one of its
   signature figures appears in a served or Worker file; the latency tab and the
   ticker rebuild that port those boards must compute their figures.
8. A page rendered from the dry emit for a screenshot goes through
   `scripts/render-preview.mjs`, which serves it from a `.test` origin and prints
   a Fixture data ribbon; a screenshot without that ribbon is not evidence of
   what production shows.

The other shared test helpers live beside it, each held by
`tests/lib-contract.mjs` (run after `contracts.mjs` in `test:contracts`):
`tests/lib/browser.mjs` (`launch()` is `chromium.launch()` plus
`executablePath` from `PW_CHROMIUM_PATH` when that variable is set; unset, it
passes the caller's options untouched; a path that is not a file throws; only
`lib-contract` launches through it until the 29 `chromium.launch()` call sites
move over, so the sandbox's browser suites still need `PLAYWRIGHT_BROWSERS_PATH`);
`tests/lib/served-tree.mjs` (`servedFiles()`: the tracked and unignored
untracked files, a symlink to a file counted under its own name because
wrangler's walk follows links and uploads it, a symlink to a directory not;
a symlink to nothing that `.assetsignore` does not cover throws, because
wrangler `fs.stat`s every unignored entry and that rejection fails the whole
asset upload; all of it minus `.assetsignore` and wrangler's own
`/.assetsignore`, `/_redirects`, `/_headers`, matched by git's own gitignore
engine); `tests/lib/cpu-budget.mjs` (the thread CPU clock, the `flows-quant`
reference workload, interleaved subject and reference windows, a budget held
as a ratio to the reference with an absolute floor of the clock's resolution
over a window's runs); `tests/lib/d1-fake.mjs` (the counting D1 fake over
`node:sqlite` that `flows-reads-contract` uses: trips, rows read by query
plan, rows written, and the fail, throw, hang and slow switches). New CPU
ceilings and new in-process D1 suites use these rather than another copy.
`tests/lib/suite-registry.mjs` is the registry's scanner and checker (the import
closure walk, the class rule, the literal-read scan, the glob matcher, `--write`),
held by `run-contract`.

No member name lives in the source: the `FLOWS_CREDENTIALS` secret is the only
roster, `throttleBucket(username, members)` gives a name its own lockout counter
only when the secret lists it, `verifyFlowsSession` refuses a call with no
member map, and `scripts/generate-flows-credentials.mjs --mint` needs `--from`.
Tests take their twelve names from `tests/lib/fixture-roster.mjs`, and
`flows-auth-contract` fails on a roster read in, or a fixture name written as a
literal in, `worker.js`, `shared/`, `scripts/` or `server/`.

GitHub Actions runs these gates on pushes to `main`, on pull requests, by
manual dispatch, and on a weekly schedule (`17 6 * * 1`, Monday 06:17 UTC). It
uses pinned dependencies from `tests/package-lock.json`.

`npm test` is `node run.mjs`, the fail-late runner. It runs every suite
registered in `tests/suites/` (one file per suite), the `fast` suites first and
each group in name order, with `tests/` as the working directory, whatever an earlier suite did; kills a suite at its
`timeoutS`, else at the larger of 120 s and three times its `medianS`; and
exits 1 when any suite failed or timed out, 0 only when all passed, 2 on a
usage or manifest error before anything runs, and 128 plus the signal's
number (130, 143 or 129) when interrupted by SIGINT, SIGTERM or SIGHUP. The
signal is passed to the running suite's process group, which gets two seconds
to clean up before SIGKILL, and the table so far is still printed. A repeat
within 500 ms is the same interrupt (one Ctrl-C reaches the runner from the
terminal and again from npm when the script shell execs it), and only a
signal after that window kills the suite at once. When a suite exits,
whatever is left in its process group is killed. It prints a table
of every suite's result, seconds and assertions, and appends it as Markdown,
with the last 40 lines of each failure, to `$GITHUB_STEP_SUMMARY` when that
is set. **Every suite needs a file `tests/suites/<name>.json`**, one line:
`{"name": "x", "class": "N", "group": "shard", "timing": false, "medianS": 1.2, "shard": 3, "files": ["x.mjs"], "covers": []}`
(name, class `N`, `C` or `W`, `group` `fast` or `shard` (only `contracts` and
`run` are `fast`), `timing`, `medianS`, an optional `timeoutS`, a `shard` pin,
an optional `command`, `files` and `covers`). The runner refuses to start and
exits 2 on a `test:*` script with no file, a file whose `name` is not its own
file name, a suite with a script and a `command`, an empty `command`, and a pin
outside 1 to 6. A suite takes its command from its `test:<name>` script in
`tests/package.json`; a new suite should carry a `command` of its own instead,
so that adding it touches no line of `package.json` either, and a suite without
a script runs alone with `node run.mjs --only x`. A new suite is a new file and
nothing else, so two branches that each add one merge without a textual
conflict (the test builds such a repository and merges it, with the old
single-array `suites.json` as the control that does conflict).

The registry is the single list of what the suites are and what they read:
`files` are the files the suite's script runs (flags skipped), `timing` marks the
eight suites with an in-process CPU or wall-clock gate (the tag the flake policy
keys on), and `covers` are globs of the repository files the suite reads that
its import closure does not reach (pages, assets, schema, fixtures), which the
planned affected-suite selection joins to the closure. A helper is any other
`tests/*.mjs` or `tests/lib/*.mjs` that a suite's import closure reaches; there
is no list of them to edit. After writing the new file, `node
tests/lib/suite-registry.mjs --write` fills `class`, `group`, `timing` (false),
`files` and `covers` from the tree and never drops a `covers` entry that still
matches a file; without `--write` the same command checks the registry and exits
1 on a problem. `run-contract` holds it: a test file in no suite's `files` that no
suite's import closure reaches, a `class` that is not what the import closure
makes it (`W` if it reaches `tests/worker-server.mjs`, else `C` if it imports
`playwright` outside the optional launcher `tests/lib/browser.mjs`, else `N`), a
`files` list that differs from the script, an unknown `group`, a non-boolean
`timing`, a literal path the suite reads that no `covers` glob names, and a glob
that matches nothing each fail, proved on a miniature repository in a temporary
directory.
`node run.mjs --only a,b` (from `tests/`, names without the `test:` prefix)
runs those suites alone, `--bail` stops at the first failure as the old
chain did, and `--timeout-scale=x` multiplies every timeout on a slow
machine (a timeout past `setTimeout`'s 2^31-1 ms is held there, so a very
large scale switches timeouts off rather than firing them at once).
`--group fast|shard` runs one group, in manifest order. `--shard i/n` runs
the i-th of n shards of the `shard` group. At the CI count (12, `CI_SHARDS` in
`run.mjs`) a suite goes to the shard its own file pins; a suite with no valid
pin is placed after the pinned ones, longest `medianS` first into the cheapest
shard. At any other count nothing is pinned and every suite is placed that way,
a shard charged 24 s of Chromium install when it takes its first `C` or `W`
suite, equal medians taken in manifest order and an equal cost given to the
lower shard, the fast suites left out; each shard runs in manifest order.
`node run.mjs --repin` rewrites every pin to that packing, one line per file,
and strips the pin from a suite in the `fast` group.
`--needs-browser` with either prints `true` or `false` (whether the
selection holds a `C` or `W` suite) and runs nothing. An empty shard or
group, a bad `i/n`, an unknown group, and `--only` with `--shard` or
`--group` are usage errors (exit 2) that run nothing. `npm run test:x`
still runs one suite by itself, and `npm test` with no flag still runs the
whole chain.

**Flake policy.** Only a suite tagged `timing` in its `tests/suites/<name>.json` (an
in-process CPU or wall-clock gate; the manifest refuses the tag on any suite that
is not class `N`, so a Chromium or workerd suite is never retried) is run a second
time, and only when `CI` is `true`: locally the first failure is the result. A
timeout is not retried, because a hang is not a flake. A pass on the retry is
green and printed as `FLAKY` in the table, the step summary (with the first
attempt's last lines) and, under GitHub Actions, as a `::warning`; a second
failure is a failure. Every FLAKY outcome is to be answered by an entry in
`tests/quarantine.json`, `{suite, assertion, firstSeen, expires, issue}` with
`expires` at most seven days after `firstSeen`; the run says whether an
unexpired entry exists, and `run-contract` (the `run` suite, in the fast job)
fails the moment any entry is malformed, names a suite that is not tagged
`timing`, or has expired, so a flake is fixed or renewed in a reviewed pull
request (a renewal is a new entry with a new `firstSeen` and issue) inside the
week. The file is empty until a first flake is recorded. A flaky Chromium
interaction suite is fixed in the test: wait for the settled state, never an
intermediate one.

In CI (`.github/workflows/regression.yml`) the chain runs as a `fast` job
(full history and `ASSET_DIFF_BASE`, the Worker dry run, then
`node run.mjs --group fast`, no Chromium), twelve `shard` jobs (a matrix of
`--shard 1/12` to `12/12`, fail-fast off, a shallow checkout, Chromium installed
only when `--needs-browser` answers `true`), and `test`, which needs both,
runs `if: always()`, and is green only when the fast job and every shard
succeeded. `test` is the job a ruleset on `main` should require (A-15); as
of 2026-10-05 `main` has no branch protection and no ruleset, so nothing
requires it yet and Workers Builds still deploys `main` on merge.
On a push to `main` a fourth job, `reuse`, runs first (`scripts/ci-reuse.mjs`, read-only
token). The pull-request run's `test` job writes a `tested-tree` commit status on the PR
head, whose description is the git tree of the exact commit `fast` checked out and whose link
is the run. The push run takes the merged PR from the pushed commit, looks for a successful
`tested-tree` status by `github-actions[bot]` naming the pushed tree, and then reads the run
behind it through the Actions API: it must be completed and successful, event
`pull_request`, workflow `.github/workflows/regression.yml`, on that PR head, in this
repository. Only then are `fast` and the shards skipped (`test` requires them skipped),
about 32 runner-minutes saved and push-to-green about two minutes. Any doubt, an API error
included, runs the full gate; the weekly schedule and manual dispatch never reuse. `statuses:
write` belongs to the `test` job alone and `pull-requests: read` to `reuse` alone.

**Adding a suite
means adding `tests/suites/<name>.json` with a `command` and a `shard` pin from 1 to 6 and
running `node run-contract.mjs` from `tests/`; refreshing a `medianS` means
editing that one line.** There is no published table to republish
(`PUBLISHED_SHARDS` is gone). The contract holds each `shard`-group suite to a
pin (`EVERY SUITE OF THE SHARD GROUP PINS ITS SHARD`) and the twelve shards to a
balance: the heaviest, counted as medians plus the Chromium install, within
1.3 times the lightest (`A SHARD FAR OUTSIDE THE TOLERANCE FAILS`, whose
message prints the loads). Pin a new suite to the lightest shard; when a
refresh or a run of additions pushes the balance past the tolerance, run
`node run.mjs --repin` and commit the changed pins in their own pull request.
Moving CI to another shard count changes `CI_SHARDS` in `run.mjs`, the
workflow's three counts and the pins together, and `--repin` writes the pins.
Client pull requests that bump the asset token are merged in a train: the
integrator merges a batch, resolves any `?v=` and `assets/version.txt`
conflict by taking the base's values, and runs `node scripts/bump-assets.mjs`
and then `--check` once for the batch, not once per rebase. The same train ends
with `node run.mjs --repin` from `tests/` after each merge batch: pins chosen by
branches that were each balanced alone drift apart once their suites meet, and
the contract's balance line is where that shows.

### Which suites need the dev server, and which do not

Some suites boot workerd (`wrangler dev`, through `tests/worker-server.mjs`)
and some only need Node and Playwright. It is worth knowing which is which
BEFORE deciding what can be run before a push.

**In the agent sandbox, run the server suites with `FLOWS_TEST_SANDBOX=1`.**

```bash
cd tests && FLOWS_TEST_SANDBOX=1 node flows-worker-contract.mjs
```

With it set, `startWorker()` copies the regular files Git sees in the working
tree (`git ls-files --cached --others --exclude-standard`, skipping dot
directories) into a temporary directory and runs `wrangler dev` there. It also
sets `CLOUDFLARE_CF_FETCH_ENABLED=false` and `WRANGLER_SEND_METRICS=false`.
`HTTPS_PROXY` stays set and TLS verification stays on. CI leaves the variable
unset and runs exactly as before. Measured on 2026-09-23 with it set:
`flows-watch-render` passed in 12 seconds and `flows-worker-contract` in two to
five minutes, depending on load. Without it, under the same conditions, the
first suite was still silent when `timeout` killed it at 200 seconds.

The hang was never the network. `wrangler dev` watches its assets directory,
which is the repository root, with a watcher that follows symlinks, and no CLI
flag turns that watcher off. The sandbox tree is full of symlink loops:
`tests/node_modules/node_modules` points at its own parent, each worktree's
`tests/node_modules` is a symlink into that loop, and the main checkout holds
dozens of worktrees under `.claude/worktrees/`. The crawl consumed 4.3 GB of
memory in 80 seconds, and one run hit the 8 GB heap limit and ran out of
memory after seven minutes. That starves the reload: `reloadComplete` never
arrives, the ProxyWorker stays paused, and the port accepts connections
without answering. The `Request.cf` fetch through the proxy fails in under
three seconds and does not cause the hang. The copy contains no symlinks, so
the watcher has nothing to follow. Without the variable, a worktree with a
single symlinked `node_modules` often boots after all, because the loop
reaches `ELOOP` and the watcher disables itself. That made the failure look
intermittent.

**This list is measured, not inferred.** Grepping for `workerd` misclassifies
in both directions: `contracts.mjs` and `flows-weight.mjs` merely mention the
string and run fine, and a suite can need a server without naming it. Each
entry below was run and timed.

<!-- gen:suites-local -->
`tests/suites/` registers 180 suites: 130 that need only Node (N), 35 that also
need Playwright's Chromium (C) and 15 that boot workerd (W). The class is derived from
each suite's import closure, so this list cannot drift from it. A name is the
`test:<name>` script in `tests/package.json`: run one with `npm run test:<name>` or
`node run.mjs --only <name>` from `tests/`.

Confirmed to run with no server and no browser (N):

```
contracts                 run                       academy                   approval-frames
architecture              ci-affected               docs                      fixture-guard
flows                     flows-ai-broker           flows-ai-salvage          flows-alert-grid
flows-alerts              flows-basis               flows-brief               flows-calibration
flows-chain-panels        flows-contracts           flows-conviction          flows-copy-lint
flows-coverage            flows-d1-budget           flows-data-fixes          flows-deepen
flows-defer-render        flows-desk-audit          flows-desk-calls          flows-dispatch-check
flows-dispersion          flows-door-v2             flows-dossier             flows-dossier-reads
flows-engine-budget       flows-evt                 flows-fact-ids            flows-feeds-onescreen
flows-film                flows-flow-below-render   flows-flow-registry       flows-freshness
flows-garch               flows-glass-render        flows-home-below-render   flows-home-composition
flows-home-net-render     flows-home-onescreen      flows-lean                flows-ledger
flows-legs                flows-live                flows-market-below-render flows-market-floor-render
flows-market-onescreen    flows-market-river-render flows-market-visual       flows-meter-worker
flows-mint                flows-moves-render        flows-moves-sig           flows-net-map-render
flows-neuron              flows-neuron-screen       flows-nn-render           flows-now-render
flows-oracle              flows-oracle-core         flows-oracle-home-render  flows-oracle-live
flows-oracle-render       flows-overlay             flows-payload-shape       flows-permits
flows-pipeline-chaos      flows-pipeline-mutants    flows-plan-facts          flows-political
flows-political-render    flows-popout-render       flows-positioning         flows-probe
flows-public              flows-pulse               flows-quant               flows-quant-audit
flows-quant-card          flows-read-failures       flows-readers             flows-reading
flows-reading-worker      flows-reads               flows-ready               flows-record
flows-registry-contract   flows-relations-render    flows-rt                  flows-scores
flows-sign                flows-skyline-render      flows-starts              flows-stats
flows-stock               flows-tape-stats          flows-targets             flows-time
flows-truth               flows-universe            flows-variation           flows-vendor-budget
flows-verdict             flows-vol                 flows-warnings            flows-weight
flows-ws-probe            lab-write                 launch-readiness          markets
mastery                   pipeline                  route-matrix              server-ai
server-desk               server-ingest             server-kernel             server-log
server-ops                server-oracle             server-pages              server-router
server-rt                 staging
```

Confirmed to run with no server but with Chromium (C; set `PLAYWRIGHT_BROWSERS_PATH`):

```
flows-ask                 flows-brand-render        flows-chart-kernel        flows-deadline-render
flows-defaults-render     flows-desk-audit-render   flows-desk-calls-render   flows-desk-client
flows-desk-onescreen      flows-desk-wiring         flows-events              flows-export
flows-fixture-guard-render flows-glance-frame-render flows-glance-live-render  flows-glance-render
flows-index               flows-kit                 flows-link                flows-movelab-render
flows-moves0              flows-net-render          flows-pages-render        flows-readers-render
flows-reading-render      flows-render              flows-rt-client           flows-status-render
flows-strip               flows-surface-render      flows-ticker              flows-ticker-firstpaint-render
landing-motion            market-ticker             placement
```
<!-- /gen:suites-local -->

`placement-contract` needs Playwright's Chromium but no workerd: it serves the repository's
static files from its own `http.createServer` on loopback. Run it with
`PLAYWRIGHT_BROWSERS_PATH` set like the other browser suites.

`flows-pages-render` needs Chromium and no server, about 150 s (set `PLAYWRIGHT_BROWSERS_PATH`):
it runs the pipeline dry run once for its emit and renders every page function three times.

`market-ticker-render` needs Playwright's Chromium but no server: it serves the
landing script and a snapshot from `page.route` on a fake origin and fixes
`Date.now` in the page. Run it with `PLAYWRIGHT_BROWSERS_PATH` set like the
other browser suites.

`landing-motion` needs Chromium and no server either: it serves the real
`index.html` and its assets from disk through `page.route` and a stubbed
`/api/markets`. It traces the page under reduced motion and counts
`FireAnimationFrame` events (none after the first second, none after a
resize), checks the still frame is drawn and redrawn on resize, counts its
draws through a served copy of `particles.js` (one at load, one per viewport
change, a synthetic `contextrestored` at DPR 2 redrawn into every quadrant),
compares its brightness with a 40-pass settled reference and a single pass
served the same way, and drives the marquee's Pause button by keyboard and
mouse, waiting on each animation's `ready` and polling `currentTime` rather
than sleeping a fixed time. The held-refresh block installs `page.clock`,
serves an empty `particles.js` and three distinct snapshots, and runs once
with motion and once under reduced motion. Measured on 2026-10-05: about 35 s,
116 assertions, at a load average of about 5 (48 s at a load average of 15).

`flows-index-render` needs Chromium and no server, and `flows-public` neither: the first serves the real page HTML and
assets from `page.route` with every script but `flows-index.js` stubbed to nothing, the second imports `worker.js` into
Node with a bare `ASSETS` stub (the front door touches no binding). Set `PLAYWRIGHT_BROWSERS_PATH` for the first.

`flows-chart-kernel` needs Chromium and no server: it serves the chart scripts from disk through `page.route` on a fake origin and runs about 12 s. `flows-kit-render` needs Chromium and no server: it serves `base.css` and `flows.css` from disk through `page.route` and renders the design-system kit from markup the test holds, so it runs in a few seconds and fails on a token, a state or a hit area before any page adopts it.

`flows-desk-client` needs Chromium and no server either: `tests/desk-fixtures.mjs` serves the
assets from disk and the chain payloads from `page.route`, so the Premium desk runs against
fixtures built to the chain payload contract rather than against workerd. Its Node half runs
`assets/js/flows-desk.js` in a `vm` with no `document`, which is the only context that exposes
the desk's pure functions as `__FlowsDeskTest`. `flows-desk-wiring` is the same shape (Chromium, `page.route`,
no server); measured on 2026-09-30 at about 12 s, against 31 s for `flows-desk-client`.

`academy-contract` builds its three schema databases over `node:sqlite`, so it
needs Node 22.13 or newer and runs under `--disable-warning=ExperimentalWarning`
like the reads suite; measured on 2026-10-05 at under 1 s with no server. Its
DDL scan matches `CREATE` and `DROP` of a table, index, trigger or view in any
case and with any whitespace between the words, and a `CREATE` that is not
inside an evaluated top-level constant, or any `DROP` at all, fails it.

`flows-neuron-screen` was measured on 2026-09-30: 0.3 s with no server and 18,474 assertions. It runs
`screenReading` alone: the sign and size of book gamma worked by hand against the implied daily move, each
threshold from both sides, every input null or unpublished, 27 synthetic states compared with `regimeState`,
the vendor's own NVDA row through `buildUniverse` and the reading, and every sentence of 147 readings through
the ask guard with modals on. `flows-reads-contract` shifts the clock (`shiftClock`) to 2026-09-25 13:00 UTC for
the blocks that read a card dated 2026-09-24, because a card two sessions behind the real date is now tier
`expired`; a new fixture with a fixed session needs the same.

`lib-contract` was measured on 2026-10-05: about 3 s with no server and 257 checks (258 with
`PW_CHROMIUM_PATH` set, which adds a real launch; in this sandbox it is
`/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, and CI leaves it unset). It builds a
throwaway git repository for the served-tree semantics, drives the CPU budget on an injected clock, and runs
`scripts/bump-assets.mjs` on a copy of the pages and sheets it lists from Git without the tool. It reads no
history, so no diff against a base can turn it red, but it does constrain the tree: it fails when the committed
pages and sheets do not pass `bump-assets --check` (see "Asset versioning"), and when an unignored symlink to
nothing would fail the asset upload. It needs Node 22.13 or newer for `node:sqlite`.

`flows-neuron` was measured on 2026-10-05: about 4 s with no server and about 750 assertions. Its last blocks drive
`worker.js` through the dossier harness's counting D1 over `node:sqlite` (the kept Neuron output, its re-vet
against a new card, the board summary's `gen:board` row, and the real `scheduled()` board firing with a fallback
configured, which asks the primary alone: a thrown primary, a billed empty or cut reply on the same facts, and a
moved brief with the live overlay off and on), so it needs Node 22.13 or newer and runs under
`--disable-warning=ExperimentalWarning` like the reads suite.

`flows-dossier-contract` was measured on 2026-10-03: 11 s with no server and 14,249 assertions. It builds
every packet from the nightly payload fixtures and from `tests/fixtures-dossier-vendor.json`, proves with a
recording `Proxy` that each reducer reads only the fields `DOSSIER_READS` names and the probe list holds
(a `WIRE_RENAMES` spec name is read as a fallback and the strict list holds its wire name instead),
fuzzes the sanitiser with instruction, markup, URL, bidi, role-marker and obfuscated text, runs the renderer to
every budget from 400 to 12,000 tokens, and checks the fingerprint over 120 random price levels.
`flows-dossier-reads` was measured the same day: 4.4 s and 232 checks; on 2026-10-05, with the 5 s source held through the summary route, about 12 s and 241 checks. It imports `worker.js` into Node with the
counting D1 fake over `node:sqlite` (Node 22.13 or newer, run under `--disable-warning=ExperimentalWarning`) and
a stubbed vendor at `https://uw.test`, and asserts round trips, rows read cold and warm, vendor calls (eight cold
for a carded name, nine for a universe-only name with four queued), parallelism, the deadline and `pending`, the
single flight, the limiter's refusal, plan refusals cached, the 30-second copy and CPU as a ratio to the summary
route on the same fake. A fixture-dated suite there shifts the clock with `shiftClock`; it awaits `ctx.waitUntil`
before it clears the Cache fake, because the 30-second copy is written in the background.

`flows-reading` was measured on 2026-10-03: 2.8 s, 1,528 checks, no server. Its tag block holds every threshold
from both sides on the archetype dossiers (and the grade gate and the packet-status gate), the fallback is run
through the same checks as a model's wording, and some thirty adversarial replies go through `vetReading`:
invented figures, a difference of two cited figures, a forecast word of each kind, an invented customer, product
and symbol, an instruction obeyed from a poisoned description and headline, a cite to a pending, unseen or
unknown id, a tag not held, quote stuffing, oversize output, fenced JSON, prose, a dealer statement without the
convention and markup of every kind, then a 3,000-reply fuzz. Reading CPU on the momentum dossier: tags 0.1 ms,
fallback and shape 0.2 ms, prompt 0.5 ms, vet 1.7 ms.
`flows-reading-worker` was measured the same day: 5.9 s, 179 checks, no workerd (the dossier harness's counting D1
over `node:sqlite`, a scripted AI binding, Node 22.13 or newer, `--disable-warning=ExperimentalWarning`). It drives
`worker.js`: cold, hit, floor, fingerprint, refusal and cooldown, budget refusal, single flight, another isolate's
marker, kill switch, no model, store fault, the additive field, and the Ask box; it prints the CPU of a summary
call on the fake (stored reading 2.0 ms, none stored 4.6 ms, the dossier route from its copy 1.9 ms).
`flows-reading-render` needs Chromium and no server (set `PLAYWRIGHT_BROWSERS_PATH`): about 9 s, 63 checks, against
a fixture card and `page.route` stubs of the summary. It checks chips, labels, the three states, polling, no markup
from model text, keyboard focus and no horizontal scroll at 320, 390 and 1280.
`flows-ai-salvage` was measured on 2026-10-11: about 6 s with no server and 27,196 assertions, most of them cut offsets. The
scan of a reply cut at 3,000 characters costs 0.02 ms of CPU (a salvage with the vet, 1.3 ms, the vet being the cost); it needs no
Node floor beyond the suite's own. A reply whose text is malformed rather than cut (a token that is not JSON) keeps nothing, as
`parseReading` finds it, and the scan records the offset where the grammar broke (`malformedAt`).
`flows-reads-contract` runs the Neuron's own assertions with `FLOWS_READ_MODE=off` and filters the dossier's trips
out of them; a final block prices the reading: a summary hit reads 4 rows (the Neuron's card, its row and its claim row, and the reading's one), a miss 20 before the response and 32 with the background generation (the fake counts some of the background spend reads before the response; structurally a miss reads two rows more than before the claim rows, `gen:ticker:<T>` and `gen:read:<T>`, and no extra sequential trip).

`flows-starts-contract` was measured on 2026-09-29: about 4 s with no server. It
spawns the pipeline a handful of times as a child process, against loopback HTTP
servers standing in for the vendor and for GitHub's API, and runs everything else on
a virtual clock.

`flows-reads-contract` was measured on 2026-09-28: about 20 s with no server,
of which three blocks wait out the flights' deadlines (2 s for the schema
bootstrap and its 1.5 s retry, 12 s for the market snapshot's refresh); on
2026-09-30, with the rows-read ceilings and the last-good copy, 33 s of wall
time and about 1 s of CPU.
It imports `worker.js` into Node with a counting fake of the D1 binding over
`node:sqlite` (one trip per `first`, `all`, `run` or `batch`) and asserts how
many cross-region round trips each Flows read route costs, cold and warm.
`node:sqlite` loads without a flag only from Node 22.13.0, so
`tests/package.json` sets `engines.node` to `>=22.13`; on 22.5 through 22.12
the suite fails to import with `No such built-in module: node:sqlite`. The
suite runs under `--disable-warning=ExperimentalWarning`, which on 22.22.2
silences the SQLite notice and nothing else; the blanket `--no-warnings` would
also hide a deprecation raised by `worker.js` under Node.

`flows-verdict-contract` was measured on 2026-09-30: 15 s with no server, and
about 800 checks. It drives the real `rthTick` over a `node:sqlite` database
with the real schema, one Tier 1 tick per five-minute mark for a session, so it
needs Node 22.13 or newer like the ledger and reads suites.

`flows-ledger-contract` was measured on 2026-09-29: under one second with no
server. It drives the ledger's SQL and the real Tier 1, focus and heartbeat
functions over a `node:sqlite` binding, so it needs Node 22.13 or newer and
runs under `--disable-warning=ExperimentalWarning` like the reads suite.

`flows-readers-contract` was measured on 2026-09-30: under 1 s with no server,
on the same counting D1 fake and `node:sqlite` as `flows-reads-contract`, so it
takes the same Node floor. `flows-readers-render` about 10 s: Chromium against
stubbed `/api/flows/*` routes, a fake clock and `page.clock.runFor`, no workerd.

`flows-pipeline-contract` was measured on 2026-09-24: 123 s with no server (192 s
as the CI median in `tests/suites/`). It
was on neither list, so a source scan in it (every ingest call site must
`await ingestHeaders(`) went unrun until CI caught it.

`flows-quant` was measured on 2026-09-23: about 5 s with no server (8 s at a
load average of 4.6 on 4 cores). It spawns itself once more, as a fresh
process, to time the Worker path of the options engine (one 400-quote expiry
fitted and 24 structures priced) in a clean heap; that child is part of the
total. The child reads the main thread's own CPU clock
(`process.threadCpuUsage()`, wall clock only where it is missing), because
CPU time is what the Workers limit meters and a loaded machine inflates wall
time several-fold. That clock ticks at the kernel's resolution (4 ms in the
sandbox), so runs are timed in windows of five and the budget is read from
the window means. The child warms the engine first, so it does not measure a
cold isolate's first requests. Since 2026-09-30 it also times a fixed
reference workload in the same windows, and the budget is held as a ratio to
its median (worst case under 1.2, costliest window under 2.0): the absolute
median moved from 4.6 to 6.4 ms between runs of the same code on a shared
machine while the ratio held.
`flows-quant-audit` was measured on 2026-09-30: under 6 s with no server. It
builds three GARCH laws through the pipeline's 32,768-path draws and runs a
1.5M-draw JavaScript reference for the earnings overlay.
`flows-truth` was measured on 2026-10-11: 30 to 45 s on a machine at a load average of 9 (the kill matrix is a quarter of
it), 708 assertions, no server and no D1 fake. It loads the real `shared/flows-garch.js`, and its one socket block opens a
loopback listener on an ephemeral port that speaks the WebSocket protocol by hand; nothing in it calls the network.
`flows-alert-grid` was measured on 2026-10-11: about 120 s with no server on a machine at a load average of 3, 999
assertions, of which the kill matrix of five planted wrong builds is 45 s. It prints the covered and report-only cells,
the J x D power table for both constructions (sixty-minute rows included), the challenger arm, the macro-day stress cell
and the registered rule's choice with its margin. The exact world's 0.02 bar is held on a registered seed (a calibrated
rule fails it on about one seed in three); FLOWS_TRUTH_DEEP=1 runs 670 names on fresh seeds in roughly an hour and tests
it as q over H_N plus three standard errors. The detectors share one null-cell bank with the suite, so a wrong build that
touches only the table builder would not be seen by them.
`flows-rt-contract` was measured on 2026-10-11: about 32 s with no server, 1,288
assertions, on a machine shared with other suites. Its roster-read block drives
the hub on the fake clock through a D1 that hangs once and recovers within 35 s,
that hangs twice with no stacked 3 s timers and reads at least 30 s apart, that
never answers (the 25 base names are kept), and a hung five-minute refresh that
keeps the full roster. It drives the real hub on a
fake clock and fake sockets against a stub vendor, loads `Pulse` with a fake
`ctx`, runs the roster SQL over `node:sqlite` (so it needs Node 22.13 and runs
under `--disable-warning=ExperimentalWarning`), and prints the CPU per poll and
the bytes per frame it measured: on a 157-name roster with every row changing,
px costs about 3 ms of CPU a poll and 31.7 KB a frame, fl 0.3 ms, gx 0.7 ms,
mk 0.3 ms, nw 0.5 ms; a px snapshot is 32 KB, an fl snapshot 81 KB.
`flows-rt-server` boots workerd five times (the rail, a Saturday, the same Saturday
at production cadence for 75 s with a silent socket to prove the object keeps one
`ep` and sends no `ctl.resync`, the switch off, production cadence) with persisted Durable Object storage, because raw workerd
with in-memory Durable Object storage crashes when an alarm fires; the first
three run at `FLOWS_RT_SCALE=0.2`, the last at real cadence and takes a minute
of wall time by itself. It needs `FLOWS_TEST_SANDBOX=1` in the sandbox and was
measured on 2026-10-03 at 151 s with 158 assertions. It also prints the vendor
calls a minute at real cadence for one socket on all five topics with one focus
ticker (px 12, fl 12, gx 4, mk 6, nw 2 on 2026-10-10; mk was 12 at a 10 s
cadence and gx 59 before it read focus tickers only) and the alert-to-client
latency it saw (p50 2.1 s, p95 4.6 s over 40 alerts). Its first boot also opens
the upgrade by hand, with and without an offer of `permessage-deflate`, reads the
101's `Sec-WebSocket-Extensions` and parses each frame off the socket with
`tests/lib/ws-wire.mjs`: on local workerd the offer is accepted and the payload
travels at 0.15 of its JSON size (215 assertions on 2026-10-10).
`flows-rt-client` needs Chromium and no server: `page.routeWebSocket` plays the
hub for the stub tests, and for the integration block it bridges the page's
socket to a real `RtHub` driven by `rt-fixtures.mjs` on a virtual clock. It was
measured on 2026-10-03 at about 80 s with 260 checks, most of it real waiting
while the paused fake clock is stepped (`page.clock.pauseAt`, because an
installed clock otherwise keeps running in real time and fires the timers under
test early). Set `RT_ONLY` to a regular expression of section names (`merge`,
`gap`, `bye`, `backoff`, `poll`, `hub`, `board`, `home`, `unusual`, `market`,
`ticker`, ...) to run part of it; `RT_ONLY=measure` runs the measurement block
alone on the real clock and prints the numbers DEPLOY.md 10.5n quotes.
`flows-net-render` needs Chromium and no server (set `PLAYWRIGHT_BROWSERS_PATH`);
it is registered in `tests/suites/flows-net-render.json` as class `C`. It serves `unusualPage` itself, the assets from disk and the alerts, the universe
and every other `/api/flows/*` route from `page.route`, and closes the rail's
socket with 4011. It was measured on 2026-10-05 at about 75 s with 164 checks (load average 7.5);
the 3D version on 2026-10-10 at 115 s with 13,483 checks (load average 2), most of it
real waiting for glides, inertia and recentring and the label check at six camera angles per width
and output. The test hooks on the mounted net are `camera()`, `orbit(yaw, pitch)` (degrees, as a
drag would set them, painted at once), `recentre()`, `paints()` (one traced frame of the painter's
sequence), `labels()` (each with the pitch its displacement is judged against), `fits(yaw, pitch)`
(whether an arrangement fits there, the camera left where it was) and `node(id)`. It
prints two CPU figures: the median animation frame on the page, and a
synchronous loop of 240 frames (`FlowsUI.net.of(el).measure(240)`) at 360 edges
and 400 pulses. The loop is the steadier figure on a loaded machine, where
headless Chromium may run only a few animation frames a second; the suite holds
its median under 4 ms, a guard rather than the 2 ms target the module was built to.
`flows-quant-card` was measured the same day: under 2 s with no server. It
rebuilds the `FlowsQuant` bundle in memory and fails when the committed file
differs, then runs the bundle in a bare `vm` context against the modules.
`run-contract` (the `run` suite) was measured on 2026-10-05: 15 to 21 s (about 45 s on a loaded 4-core machine, with the scratch merge) with no
server and 379 assertions (about 550 since the suite registry became a directory),
almost all of it waiting out the fixtures' timeouts
and kill graces. It checks `tests/suites/` against `package.json`, the pins and
the shard balance, merges two branches that each add a suite in a scratch
repository, then
spawns `run.mjs` against fixture suites in a temporary directory: a failure, a
hang that ignores SIGTERM, a flaky suite, a detached process that holds a
suite's output open past its timeout, 3 MiB on one unterminated line, 80 wide
failures under the step-summary limit, a ✓ split across the 64 KiB pipe chunk,
a child left in a suite's group after the suite exits 0 and after it leaves on
SIGTERM, a timeout scale past `setTimeout`'s range, and the runner itself sent
SIGTERM, SIGINT, SIGHUP, two SIGINTs 5 ms apart and a second SIGINT 800 ms
later mid-suite. Its process checks read `/proc` where it exists and `ps`
elsewhere, so it runs on macOS too.

<!-- gen:suites-server -->
Confirmed to need one (W; set `FLOWS_TEST_SANDBOX=1` in the agent sandbox):

```
browser                   flows-board-render        flows-chain               flows-desk
flows-legacy              flows-market              flows-motion              flows-overview
flows-rt-server           flows-sections            flows-strategy            flows-unusual
flows-watch-render        flows-worker              worker
```
<!-- /gen:suites-server -->

`flows-strategy` was measured on 2026-09-23 at 13 s with `FLOWS_TEST_SANDBOX=1`
(CI median 22 s); it boots workerd for the strategy page and its `engine=1`
route. `flows-unusual-contract` was measured on 2026-09-24 at 80 to 92 s with
`FLOWS_TEST_SANDBOX=1`; it boots workerd through `startWorker`. `browser` is
`npm run test:browser` (`regression.mjs`: Chromium against `startWorker()`).

`flows-motion` was in NEITHER list until 2026-09-13 and was measured then: it
boots workerd, so without `FLOWS_TEST_SANDBOX=1` it hangs in this sandbox
until the timeout kills it. That matters beyond the bookkeeping — a suite
that HANGS reports as a failure to any runner that wraps
it in `timeout`, so an unmeasured suite can be mistaken for a real assertion
failure and sent chasing a defect that does not exist. If a suite produces no
output and dies at the timeout, confirm that it ran with
`FLOWS_TEST_SANDBOX=1` before reading it as red.
Anything not named in either list has not been measured — run it and find
out rather than assuming.

**Why this section exists.** `flows-card-render` was filed as needing a
server. It does not — it renders through `page.setContent` and finished in
nine seconds when measured locally (`tests/suites/` holds the CI median). Because it was skipped locally it went unrun for a whole
branch, and it then found three real defects at once: a drawer count left
behind by a new panel, a chart shipping `preserveAspectRatio="none"` so its
bar heights meant nothing, and an SVG label clipped off its own canvas by
the switch to Inter. All three were invisible to every check that WAS being
run, and all three cost a CI round trip each.

**Ordering matters less than it did.** Until 2026-10-05 `npm test` was one
chain of `&&` links that stopped at the first failure, so a suite near the
front hid every suite behind it, and a count or a threshold in a late suite
could be stale for a long time and say nothing. The runner now attempts every
suite and reports every failure of a run in its table, so read the whole table,
not the first red row. Under `--bail` the old masking returns: a suite after
the first failure is listed as not run, which says nothing about it.

## Local development

For production-equivalent routing and API behavior:

```bash
cd tests && npm ci && cd ..
./tests/node_modules/.bin/wrangler d1 execute iewt --local --file schema.sql
./tests/node_modules/.bin/wrangler dev --local
```

Put local-only OAuth values in `.dev.vars` (git-ignored). A plain
`python3 -m http.server` can preview individual static files, but it does not
implement canonical extensionless routing, Worker headers, auth, API, D1, or
HTML rewriting and is therefore not a complete test environment.

## Commentary

Source files carry no comments: JavaScript, CSS, HTML, SQL, YAML, TOML,
Python and the ignore files are code only. The reasoning behind a threshold, a
ceiling or a rule lives in the commit that set it (`git log -p` on the line)
and in `docs/`, never inline. Do not add comments, banners or doc blocks;
write the argument in the commit message. Generated files
(`assets/js/lab-suite.bundle.js`, `assets/js/review-catalog.js`,
`assets/js/stage-catalog.js`, `shared/review-manifest.js`,
`shared/stage-manifest.js`, `shared/skill-manifest.js`,
`shared/course-points.js`, `shared/course-seo.js`) are written by
`scripts/generate-course-payloads.mjs` without banners; edit the generator,
not its output. `docs/index.md` and the marked sections of this file are
written by `scripts/gen-docs.mjs` the same way. `assets/js/flows-quant.bundle.js` is generated the same way by
`scripts/build-flows-quant-bundle.mjs` (esbuild from the pinned
`tests/node_modules`, tree-shaken from `shared/flows-quant-browser.js`), and so
is `assets/js/flows-quant-read.bundle.js`, tree-shaken from
`shared/flows-quant-read.js`: the smile and law readers alone, for the ticker
dossier, which draws what the Worker priced and re-prices nothing. Run the
script after any change to a `shared/flows-quant-*` module the browser reaches;
it writes both, and never edit either bundle by hand. `scripts/strip-comments.mjs` is now a no-op on
this tree and stays only because a Workers Builds build command may still
invoke it; it can be retired once that dashboard field is confirmed clear.

## Design and accessibility invariants

- JavaScript remains IIFE-based and framework-free; production globals are
  deliberate:<!-- gen:globals -->
  `Lab`, `Auth`, `Gamify`, `FX`, `IEWTStorage`, `MasteryScheduler`,
  `REVIEW_ITEMS`, `TOPIC_META`, `TOPIC_BY_ID`, `COURSE_STAGE_POINTS`,
  `LEARNING_PATHS`, `toast`, `COURSE_STAGE_IDS`, `COURSE_SKILLS`,
  `SKILL_CATALOG`, `SKILL_BY_ID`, `SkillMasteryScheduler`, `PROJECT_CATALOG`,
  `PROJECT_BY_ID`, `FlowsUI`, and `FlowsQuant`.
  <!-- /gen:globals --> The rail's browser
  half is `FlowsUI.rt` (`connect`, `on`, `transport` and the adapters), added to
  the existing global rather than a new one, and the flow network is
  `FlowsUI.net` (`model`, `mount`, `of`), added the same way by the one page
  that loads it.
  (`flowsCardPrefetch` was on this list and went with the card dialog: it
  warmed a card on hover so a modal would open instantly, and a board row is a
  link to `/flows/ticker/?t=` now. `FlowsPanels` went with the ticker rebuild:
  the dossier's modules are drawn from `FlowsUI` inside `flows-ticker.js`, the
  only page that ever called the panel library, and `flows-panels.js` and
  `flows-drawers.js` are deleted. `FlowsCursor` went with `flows-cursor.js`,
  which no page emitted.)
  This list is an ALLOWLIST: a global that is not on it is an undocumented
  one. `tests/contracts.mjs` reads it from this paragraph and scans every
  script under `assets/js`. Each assignment to `window`, `globalThis` or
  `self` by a dotted or string-quoted key (`=` or any compound assignment,
  the logical `||=`, `&&=` and `??=` among them, and `++` or `--` on the
  same line before or after the key), and each `var`, `let`, `const`,
  `class` or `function` declaration (`function*` with the star on either
  side) at the script's top level (by bracket depth, over a scan that skips
  strings, templates, comments and regular expressions, a `/` after an
  operator, after a keyword such as `return` or `typeof`, or after the `)`
  that closes an `if`, `while`, `for` or `with` head opening one; a `var`,
  `let` or `const` wherever it stands at that depth, the body of a braceless
  `if` or `else` and a labelled statement included; every declarator of a
  list, at any indentation), must name a global on it. It fails outright on
  `Object.assign`, `Object.defineProperty`, `Object.defineProperties`,
  `Reflect.set` or `Reflect.defineProperty` with the global object itself as
  the target, on a top-level destructuring declaration, and on a file whose
  brackets it cannot balance. The only others it admits are
  `CURRICULUM` below, the `fetch` wrapper in `flows-ui.js` (in that file
  alone), and `globalThis.__<Name>Test` hooks bound only where there is no
  `document`. It is a scanner, not a parser, and it judges the top level
  by bracket depth alone, so the list of what it cannot see is not complete.
  Among the forms that create globals and pass it are: `this.Foo = 1` at
  the top level or inside a top-level arrow function (a classic script's
  top-level `this` is the global object even in strict mode, and most
  scripts here are `(() => { "use strict"; ... })()`); an alias of the
  global object (`const g = window; g.Foo = 1`), a computed key, `eval`,
  `new Function` and `with`; a destructuring or `for`-`in`/`of` assignment
  target (`[window.Foo] = a`, `({ a: window.Foo } = o)`,
  `for (window.Foo of xs)`); a `var` inside a top-level block, `for` head,
  `try` or `switch` (`for (var Foo = 0;;)`, `if (x) { var Foo = 1 }`); a
  function declared inside a top-level block in sloppy code; an assignment
  to an undeclared name in a file that is not strict; and a `/` it still
  misreads, such as a division after a `}` read as a regular expression
  (`x = {} / 2`), which hides any top-level declaration inside the misread
  span without the unbalanced-file failure whenever that span happens to
  balance. Every
  script under `assets/js` is strict except `curriculum.js`,
  `curriculum-data.js` (authoring inputs) and the two generated FlowsQuant
  bundles; keep a new script strict. `FlowsUI` is the shared Flows UI primitives (formatters that keep the
  minus U+2212 and the absent-value em dash, and the
  score-strip chart whose gap-is-not-zero contract is enforced in the
  primitive rather than re-derived per page) — the seed of the component
  layer, introduced with the Track page, since removed.
  `FlowsQuant` is the options engine's browser face: the generated bundle
  of the same `shared/flows-quant-*` modules the pipeline and the Worker run,
  exposing what `/flows/strategy/` needs to reprice a leg the reader edits,
  and the laws the ticker dossier's Two worlds module draws:
  `repriceStructure`, the smile and law readers it stands on, and the
  Black-76 primitives beneath them. The ticker dossier loads the read build
  instead, under the same global name: the six readers it calls and none of
  the pricer. It is a global because the strategy page
  is an IIFE with no module loader, and it is generated rather than written
  so a smile or a probability can never be computed one way on the server
  and another in the page.
  `CURRICULUM` is an authoring/generator input, not a production course-page
  payload. `globalThis.__FlowsDeskTest` and `globalThis.__IEWTPlacementTest` are
  test hooks that exist only so a `vm` context or Chromium can reach pure
  functions. `lesson-redirect.js` is an IIFE and declares no global.
- Design tokens live in `base.css`; typography is self-hosted subset Latin
  Modern. Re-subset from upstream for new glyph coverage rather than editing
  WOFF2 files.
- Matplotlib uses a Computer Modern-style, gridless theme; figures appear in
  the guide column.
- The course page has one topic `h1` followed by stage `h2` content without
  skipped heading levels.
- The adjustable divider is a keyboard-operable ARIA `separator` with numeric
  value attributes; it is not a slider.
- Primary course controls provide at least 44×44 CSS-pixel targets on coarse
  pointers; course text inputs are at least 16 px to prevent iOS focus zoom.
- Pyodide boot progress uses a non-empty `role="status"` live region.
- Pill tabs remain equal-width; the fixed-size indicator animates only
  `transform`.
