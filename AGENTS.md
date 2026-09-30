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
                    ├─ /lab/<course-slug>/ → crawlable course HTML via HTMLRewriter
                    └─ everything else → ASSETS binding
```

- `wrangler.toml` is the Worker source of truth: name `anilkaya`, entrypoint
  `worker.js`, static directory `.`, binding `ASSETS`, and D1 binding `DB` to
  database name `iewt`.
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
- `.assetsignore` excludes Worker code, `shared/`, tests, authoring-only combined
  curriculum scripts, the private article template, `CNAME`, local secrets,
  schema, Markdown, dotfiles, and configuration from the Cloudflare static
  bundle. `CNAME` remains in Git for GitHub Pages.
- Secrets are bindings, never source: `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET`.
- Invocation observability is enabled in `wrangler.toml`; application code
  emits structured logs only for unexpected failures and OAuth callback errors.
- D1 on Workers Free has two daily caps, both reset at 00:00 UTC and both
  shared by everything on the account, the audit's own queries included:
  **100,000 rows written and 5,000,000 rows read**. The write cap is priced
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
  the reader is told the site's own budget is spent. A model with no configured
  rate is priced at the dearest model on the plan. `tests/flows-neuron.mjs`
  scans `worker.js` so no call site can run the binding itself.

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
| `schema.sql` | D1 `users`, `progress`, `stats`, `mastery`, idempotent `mastery_attempts`, minimal `placement`, and per-owner `learning_sync` generation tables; the Flows tables, including `flows_live` (only `live:*` ids), `flows_tape`, `flows_clock` and the trigger that makes dated archive rows immutable. |
| `assets/js/course-catalog.js` | Lightweight course metadata, prerequisites/outcomes, learning paths, and browser scoring manifest. |
| `assets/js/curriculum.js` | Canonical OLS authoring source. |
| `assets/js/curriculum-data.js` | Canonical IV, DiD, VAR, panel, logit, and GMM authoring sources. |
| `assets/js/curriculum-questions.js` | Additional authored question stages applied before payload generation. |
| `assets/data/courses/<topic>.json` | Committed, generated `schemaVersion: 1` payload loaded only for the selected course. |
| `assets/data/review-bank.json` | Generated full assessment bank, loaded only by the Daily Mastery Review page. |
| `assets/data/placement-bank.json` | Authored 15-item diagnostic bank balanced across five question formats and three difficulty bands. |
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
| `tests/placement-contract.mjs` | Placement bank, scoring boundaries, route, privacy, no-JS, keyboard, and responsive runtime contracts. |
| `tests/worker-regression.mjs` | Real local Wrangler routing, headers, API, and D1 tests. |
| `tests/regression.mjs` | Full Playwright browser regression suite. |
| `shared/markets.js`, `assets/js/market-ticker.js` | The landing index ticker: the Worker's Yahoo parse (the change is against the previous session's close taken from the same response's dated bars, never `chartPreviousClose`; each quote keeps its own `asOf`, `asOfDay`, `prevClose`, `prevDay` and, when the response names the session of the quote's own day, `sessionEnd`) and the strip that prints each quote's own İstanbul time, `Close <weekday>` for a closed market (a close is a quote struck within five minutes of the exchange's `sessionEnd`; the lag of the quote behind the fetch decides only where there is none), and a dash for a quote with no base. |
| `tests/flows-desk-client.mjs`, `tests/desk-fixtures.mjs` | The Premium desk's client alone: its pure functions (the frontier against a brute-force Pareto set, balance parsing, tenor buckets, cent sizing, net delta) in a Node `vm`, and the page in Chromium against payload fixtures built to the chain contract (basis, time-value yield, tooltips, banners); no server. |
| `tests/flows-desk-wiring.mjs`, `tests/fixtures-desk-lab.json`, `tests/gen-desk-lab.py` | The desk's Win % (implied) against an independent reference: `gen-desk-lab.py` (mpmath at 40 digits) prices skewed SVI chains and takes the risk-neutral probability of profit by Breeden-Litzenberger, and the suite proves the page, given the card's smile expiries, lands within 0.5pp of it and of the strategy lab on every line, while the flat fit it replaced misses by 2.5pp; the carry and the smile each line was priced on are read back from its disclosure. Chromium against `page.route` stubs, no server. |
| `tests/markets-contract.mjs`, `tests/market-ticker-render.mjs` | The Yahoo parse against dated five-day responses (weekend, Tokyo morning, null trailing bar, no timestamps) and the strip rendered in Chromium with a fixed clock; neither starts a server. |
| `shared/flows-freshness.js` | The Eastern clock (arithmetic, proven equal to the IANA zone), market phases, the freshness threshold table, `X-Fresh-*` headers, and the live clock's due-tests. |
| `shared/flows-ledger.js` | The per-day session ledger: the `flows_ledger` DDL, the statement builders the Tier 1 tick, the focus tick, the heartbeat write and the nightly's `meta` write append to a batch they already issue, the gap limits (the stale lines of `FRESH_CLASSES`), the view served as `ledger` on the ingest `clock` key, and the worst-key lapse the Tier 1 tick reads from the live rows. |
| `shared/flows-live.js`, `shared/flows-live-worker.js` | The live layer's key registry and pure builders; the Worker's Tier 1 tick, dispatch, watchdog, live ingest, `/api/flows/lk`, `/now`, `/tape` and read-time overlays. A strip row ends in `qa`, the vendor's `quote_time` as seconds behind the read, and the key's `ahead { n, maxS }` counts the stamps that run later than the read; `priorCloseBase` and `shapeStrips` fill a null `prev_close` from the last dated nightly close and say so in `prevFill`, and hold out a row the vendor dates before the session as an all-null row (DEPLOY.md 10.5i). |
| `shared/flows-oidc.js` | The live credential: the GitHub OIDC claim policy (this repository by id, `flows-live.yml` on main), the pure JWT verifier the Worker runs, and the runner-side token request the `--live` leg uses. No shared secret. |
| `scripts/flows-legs/live.mjs`, `live-fake.mjs` | The Actions `--live` leg (Tier 2, `live:*` keys only) and its fake vendor for `--dry-run`. `runLiveLoop` keeps the loop alive between sessions when handed a `watch`, and `chainDispatch` sends any workflow_dispatch with the job's own token. |
| `scripts/flows-legs/witness.mjs`, `starts.mjs`, `watch.mjs` | The loop's mutual witness (Tier 1 older than 25 minutes, `live:breadth` older than 45, the nightly not landed by 21:00 ET, a broken chain, a blind ingest door; one deduplicated GitHub Issue per check, written and adopted only as `github-actions[bot]`, closed after three healthy ticks and reopened on a flap), the 17:30 ET nightly dispatch with the job's own token (a permanent refusal capped at four calls, a transient one retried every half hour to 20:30 ET), and the per-tick composition of the two over the OIDC ingest door. |
| `scripts/flows-legs/live-world-fake.mjs`, `live-day.mjs` | A fake GitHub API and a fake Worker world on a virtual clock, and the eight dry days `--live --dry-run` runs through them. |
| `shared/flows-basis.js`, `tests/flows-basis-contract.mjs` | The premium desk's basis: the vendor's `{data:{...}}` stock-state envelope, a spot that is only a regular-session price (`printOf`: the live print in the regular session, else the newest regular close), and the coherence gate between that spot and the chain (`coherence`: impossible asks, the strike bracket the `maybe_otm_only` request guarantees, one underlying fitted to the nearest expiries, a rebase past 0.25% or a refusal when the fit is too thin). The contract runs the Worker route in Node against a stubbed vendor. The desk's `asOf` is the New York date of the READ and `days` count from it; `UW_NOW` (an ISO instant, honoured only while `UW_BASE` redirects the vendor away from production) pins that read clock so the workerd suites' dated fixtures stay valid. |
| `shared/flows-focus.js` | The home page's focus roster (Gold, Silver and Copper groups, the Mag 7, the metal funds and miners) and the NASDAQ-10 derivation from QQQ holdings. A leaf module: it imports nothing, so the Worker, the pipeline and the live leg can all read it without a cycle. |
| `scripts/flows-legs/focus.mjs`, `health.mjs` | The nightly `focus` and `roster` payload builders; the nightly health gate and its repair messages. |
| `assets/js/flows-fresh.js` | The client freshness helper (`FlowsUI.freshFrom`, `heartbeat`); every key a heartbeat reads registers its server verdict with the pill, which is the worst case over its sources (`FlowsUI.freshAggregate`, in `flows-ui.js`), so a page needs no line per region. |
| `tests/flows-live-contract.mjs` | Live-layer builders, phases and states, byte ceilings, the one-writer scans, the `--live` dry run and the client helper. |
| `tests/flows-starts-contract.mjs` | The starts and the witness: the live workflow's grants and drill input, the nightly dispatch, the witness's lines, debounce, dedupe, three-tick recovery and reopen, the kept-alive loop through the night, the weekend and the hop, the cron starters through the concurrency group, a whole weekday's request cost, and the vendor client's deadline. |
| `tests/flows-ledger-contract.mjs` | The ledger's SQL over a real SQLite (gaps clipped to the session, ok and failed ticks, partial focus reads, passes, the nightly's landing, retention), its zero-extra-round-trip and never-blocks-the-tick properties on the real tick functions, its ingest view, and the health gate's reading of it: gap lines at the stale lines, a nightly that never landed, cards failed or skipped, the roster shortfall and the 5xx burst. |
| `tests/flows-verdict-contract.mjs` | The two reversible verdicts, swept over a real SQLite clock and the real Tier 1 tick: a vendor that lags and recovers at every five-minute mark, a real closure's cost, a calendar holiday, a stalled tide with and without recovery, and the Tier 2 loop's waits. |
| `tests/flows-reads-contract.mjs` | The Worker's D1 round trips and rows read per read route, counted on a fake binding (the rows-read ceilings, the last good copy served while the store is unreadable): the single-flight schema bootstrap, the absent-card decision, the live overlays and the ticker reading. |
| `tests/flows-quant-audit.mjs`, `tests/fixtures-quant-audit.json` | The options engine against independent references: the horizon of a real-world law priced intraday, its 2,000,000-path scipy simulation at nine horizons, the Student t and Hansen skew-t quantiles and the Sobol net the pipeline draws through, dividends on the stock leg, the desk's carry, smile shape and in-the-money quotes, the earnings gate and the grades. The fixture's provenance string names the scipy version, the path count and the seed. |
| `tests/flows-readers-contract.mjs`, `tests/flows-readers-render.mjs` | What a reader is told about age: the tape's TTL against the close, the quote card's own read time, the news overlay; and the boards' live dots, the home page's pill and news card, driven with stubbed routes. The ticker's tape labels are in `tests/flows-ticker-contract.mjs`. |

## Curriculum and stage contracts

`window.TOPIC_META` in the lightweight `course-catalog.js` contains exactly:

```text
ols 20 · iv2sls 31 · did 29 · var 30 · panel 30 · logit 32 · gmm 33
```

Every curriculum has four modules. Each module owns ordered stages. The
canonical authoring inputs remain `curriculum.js`, `curriculum-data.js`, and
`curriculum-questions.js`; neither the catalogue nor the course page downloads
those heavyweight combined sources. Run this after any authored course change:

```bash
node scripts/generate-course-payloads.mjs
```

Commit all changed generated course payloads plus `assets/data/review-bank.json`,
`assets/js/review-catalog.js`, and `shared/review-manifest.js`. The generator
adds `schemaVersion: 1` and stable per-module stage IDs. Review IDs are globally
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
identical. It also requires unique generated stage IDs and caps every course
payload at 14 KiB gzip.

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
- Unknown API routes are JSON 404. Unsupported methods are JSON 405 with
  `Allow`. JSON bodies are streamed with a 16 KiB limit and validated.

Authenticated PUT/DELETE requests require an exact `X-IEWT-Owner` match with
the verified session user. Conflicting `Origin` or `Sec-Fetch-Site` metadata is
rejected, and browser cross-origin use is blocked by the custom owner header
plus the absence of CORS permission. Missing or mismatched mutation ownership
returns JSON `409 account_changed`; identified cross-origin mutation attempts
return JSON 403. The four authenticated granular GET routes allow the owner
header to be absent for compatibility, but reject a present mismatch with the
same 409 response.

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
   the first-party Cloudflare Web Analytics beacon origins.
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
   title/description, Open Graph/Twitter fields, visible H1 and four-module
   outline, related course links, and one parseable Course + Breadcrumb JSON-LD
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
2. update every versioned CSS/JS reference and `ASSET_VERSION` in
   `shared/flows-pages.js`, which `tests/flows-features.mjs` holds equal to
   `assets/version.txt`;
3. run the contract test.

A blanket rewrite of `?v=<old>` to `?v=<new>` also catches the sixteen woff2
references (eight `@font-face` URLs in `base.css`, one Inter preload in each
of the eight pages that preload it), and a merge takes such a rewrite from
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
2. update every woff2 `?v=` in `base.css` and the HTML preloads;
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
./tests/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/anilkaya-dry-run
```

The suites prove:

- all seven curricula, four modules each, every stage schema, exact generated
  per-course payloads and IDs, deterministic 96-item review artefacts, the
  balanced 15-item placement bank and sanitized result contract,
  browser/server mastery-scheduler parity, payload-size budgets, scoring
  manifests, owner-scoped v2 migration/reset behavior, local asset
  existence/versioning, and hardened sessions;
- real Worker-first routing, canonical redirects, all seven crawlable metadata
  and syllabus variants,
  response-cloned asset byte integrity, conditional caching, security headers,
  JSON API errors, OAuth and POST-only logout behavior, D1 user isolation,
  concurrent progress union, owner-header and same-origin enforcement, mastery
  idempotency, generation-fenced transactional reset, stale-write rejection,
  and exact derived points;
- academy cockpit fold visibility, placement routing, command-center metrics,
  four learning paths, search/level/status filters, all five placement and
  Daily Mastery Review formats, single-course payload
  isolation, anonymous and signed-in reset safety, no
  horizontal overflow or browser errors across 320/390/768/1440 widths,
  WCAG-AA faint text, pill geometry, 44×44 primary course targets (including
  range inputs), ≥16 px text inputs, every stage heading outline, rapid
  navigation, preserved unsaved work during sync, splitter migration and
  keyboard persistence, blocked/malformed/quota-limited storage, score
  reconciliation, boot live-region output, grading edge cases, exact rewards,
  and duplicate-award prevention.

GitHub Actions runs these gates on pushes to `main`, on pull requests, and by
manual dispatch. It uses pinned dependencies from `tests/package-lock.json`.

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

Confirmed to run with no server:

```
contracts              flows-weight            flows-payload-shape
flows-scores-contract  flows-overlay-contract  flows-ticker-contract
flows-card-render      flows-card-contract     flows-strip
flows-features         flows-alerts-contract   flows-brief
flows-warnings         flows-sign              flows-ask
flows-stock-contract   flows-premium-contract  flows-pulse-contract
flows-events-contract  flows-mint-contract     flows-permits-contract
flows-political-contract  flows-record-contract  flows-universe-contract
flows-garch            flows-neuron            flows-quant
flows-chain-panels     flows-auth-contract     mastery-contract
academy-contract       flows-variation         flows-probe-contract
flows-vol-contract
flows-positioning-contract
flows-legs-contract
flows-live-contract    flows-freshness-contract
flows-starts-contract
flows-quant-card       flows-track-render
flows-quant-audit
flows-pipeline-contract  flows-reads-contract  flows-ledger-contract
flows-verdict-contract
flows-readers-contract   flows-readers-render
markets-contract         flows-desk-client
flows-basis-contract     flows-desk-wiring
```

`market-ticker-render` needs Playwright's Chromium but no server: it serves the
landing script and a snapshot from `page.route` on a fake origin and fixes
`Date.now` in the page. Run it with `PLAYWRIGHT_BROWSERS_PATH` set like the
other browser suites.

`flows-desk-client` needs Chromium and no server either: `tests/desk-fixtures.mjs` serves the
assets from disk and the chain payloads from `page.route`, so the Premium desk runs against
fixtures built to the chain payload contract rather than against workerd. Its Node half runs
`assets/js/flows-desk.js` in a `vm` with no `document`, which is the only context that exposes
the desk's pure functions as `__FlowsDeskTest`. `flows-desk-wiring` is the same shape (Chromium, `page.route`,
no server); measured on 2026-09-30 at about 12 s, against 31 s for `flows-desk-client`.

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

`flows-pipeline-contract` was measured on 2026-09-24: 123 s with no server. It
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
`flows-quant-card` was measured the same day: under 2 s with no server. It
rebuilds the `FlowsQuant` bundle in memory and fails when the committed file
differs, then runs the bundle in a bare `vm` context against the modules.

Confirmed to need one: `flows-overview-contract`, `flows-board-render`,
`flows-watch-render`, `flows-political-render`, `flows-ask-render`,
`flows-legacy-payload`, `flows-worker-contract`, `flows-desk-contract`,
`flows-chain-contract`, `flows-sections-contract`, `worker-regression`,
`placement-contract`, `flows-motion`, `flows-market-contract`, `flows-strategy` (measured on
2026-09-23: 13 s with `FLOWS_TEST_SANDBOX=1`; it boots workerd for the
strategy page and its `engine=1` route), `flows-unusual-contract` (measured on
2026-09-24: 80–92 s with `FLOWS_TEST_SANDBOX=1`; it boots workerd through
`startWorker`).

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
server. It does not — it renders through `page.setContent` and finishes in
nine seconds. Because it was skipped locally it went unrun for a whole
branch, and it then found three real defects at once: a drawer count left
behind by a new panel, a chart shipping `preserveAspectRatio="none"` so its
bar heights meant nothing, and an SVG label clipped off its own canvas by
the switch to Inter. All three were invisible to every check that WAS being
run, and all three cost a CI round trip each.

**Ordering matters too.** The suites run in sequence and the run stops at the
first failure, so a suite near the front hides every suite behind it. A count
or a threshold in a late suite can be stale for a long time and say nothing.
When a long-failing suite finally goes green, expect the ones behind it to
have something to say.

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
not its output. `assets/js/flows-quant.bundle.js` is generated the same way by
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
  deliberate: `Lab`, `Auth`, `Gamify`, `FX`, `IEWTStorage`, `MasteryScheduler`,
  `REVIEW_ITEMS`, `TOPIC_META`, `TOPIC_BY_ID`, `COURSE_STAGE_POINTS`,
  `LEARNING_PATHS`, `toast`, `FlowsUI`, and `FlowsQuant`.
  (`flowsCardPrefetch` was on this list and went with the card dialog: it
  warmed a card on hover so a modal would open instantly, and a board row is a
  link to `/flows/ticker/?t=` now. `FlowsPanels` went with the ticker rebuild:
  the dossier's modules are drawn from `FlowsUI` inside `flows-ticker.js`, the
  only page that ever called the panel library, and `flows-panels.js` and
  `flows-drawers.js` are deleted.)
  This list is an ALLOWLIST: a global that is not on it is an undocumented
  one. `FlowsUI` is the shared Flows UI primitives (formatters that keep the
  minus U+2212 and the absent-value em dash, and the
  score-strip chart whose gap-is-not-zero contract is enforced in the
  primitive rather than re-derived per page) — the seed of the component
  layer, introduced with `/flows/track/`.
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
  payload.
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
