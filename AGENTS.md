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
  paths the in-process suites drive. Every `cappedAi` that builds `meteredAi`,
  the reading's `deps.ai` or an inline `askModels` argument must have a second
  argument that is not a `null`, `undefined`, `void` or other non-function
  literal; that the reader really reads the day's spend is proved by
  `flows-reading-worker`, which drives the summary and Ask routes through
  `worker.js` with `flows_ai_usage` past the cap and requires that no model
  is reached. At run time (`guardAi`), the in-process suites hand `worker.js`
  a binding whose `run` throws unless it is called from inside `cappedAi`'s
  own lines.

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
| `schema.sql` | D1 `users`, `progress`, `stats`, `mastery`, idempotent `mastery_attempts`, minimal `placement`, and per-owner `learning_sync` generation tables; the Flows tables, including `flows_live` (only `live:*` ids), `flows_tape`, `flows_clock` and the trigger that makes dated archive rows immutable; the model spend (`flows_ai_usage`, `flows_ai_usage_model`), board summary and Neuron (`flows_ai_summary`, `flows_neuron`) tables. `tests/academy-contract.mjs` builds three `node:sqlite` databases (this file, every `migrations/*.sql` in number order, the Worker's first-use DDL) and holds their tables, columns by name, CHECK clauses (literals compared verbatim), indexes, triggers and views equal; only `users`, `progress` and `stats` have no first-use DDL. Every `CREATE` and `DROP` of a table, index, trigger or view in `worker.js` and `shared/`, whatever its case or spacing, must sit inside a top-level DDL constant the suite evaluates, so inline DDL cannot escape the comparison. Every `ALTER TABLE` in `worker.js` and `shared/` must be one of the sites the suite lists, and each column it adds must be declared with the same type in this file and the migrations. |
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
| `tests/landing-motion.mjs` | The landing page's motion in Chromium with no server: under reduced motion the particle field draws one still frame (eight passes, as bright as the settled trail the old loop built; a single pass measures 0.56 of it), draws it once at load and once per viewport change, redraws it at the device scale after a context restore, and fires no animation frame after the first second; the marquee's Pause button (WCAG 2.2.2) is reached by Tab, toggled by Enter, Space and a click whether or not it keeps focus, holds after focus leaves, and stays under reduced motion because the prices still auto-update; a refresh that lands while paused is held until Play in both views, a Pause and Play with nothing held leaves the bar and its focused control in place, and a refresh while playing renders at once; the bar stays below the footer at 320, 390 and 1280 px. |
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
| `scripts/flows-ws-probe.mjs`, `.github/workflows/flows-ws-probe.yml`, `tests/flows-ws-probe-contract.mjs` | The vendor socket probe, dispatch only: handshake three ways, one connection per channel, concurrent connections, joins per connection, lag against each frame's own stamp. It prints key names and statistics, never payload values or the token. The contract runs it against a fake vendor that speaks the WebSocket protocol by hand. |
| `shared/flows-neuron-screen.js`, `tests/flows-neuron-screen.mjs` | `screenReading`: a Neuron reading from a universe row alone, for a name with no card. A leaf that imports the consolidated state table (`STATE_LINES`, `structuresForState` in `flows-neuron.js`), `BUCKET_LINES` and `sessionsBetween`, and is imported by no module that imports it back. Facts are graded 0 or 1 and each prints its unit; a null input is withheld under its own key with its reason; dealer delta and vanna are the vendor's numbers with no direction claimed, charm a sign only at grade 0. The test compares 27 synthetic states with `regimeState` and runs every emitted sentence through the ask guard. |
| `shared/flows-neuron-coverage.js` | The nightly's Neuron coverage ledger `{universe, priced, standAside, family, screen, unpriceable, expired, stale, missing}` (published in `meta.neuron`, checked by `neuronChecks` in `health.mjs`), built from each card's tier as the Worker would name it and the screen reading of every universe name that has no card. |
| `shared/flows-dossier.js`, `tests/flows-dossier-contract.mjs` | The per-name dossier, a leaf that imports only `flows-cross.js`: the packet model, one pure builder per kind (twelve), the sanitiser every third-party string passes, `renderDossierForModel`, `dossierFacts`, `dossierSilences`, `dossierFingerprint`. The contract runs it on the nightly payloads and the spec-conformant vendor fixtures, fuzzes the sanitiser, proves each reducer touches only the fields the weekly probe lists (a recording `Proxy`), and holds the fingerprint stable under price and age noise. |
| `shared/flows-dossier-vendor.js` | The vendor side of the dossier: `unwrap` of the `{data}` envelope, one reducer per route (13) that returns a small extract and names its fields (`DOSSIER_READS`, the list `scripts/flows-probe-list.json` holds strict), and the dossier's quote extract. No I/O. |
| `shared/flows-dossier-worker.js`, `tests/flows-dossier-reads.mjs`, `tests/dossier-harness.mjs`, `tests/dossier-fixtures.mjs` | `assembleDossier(env, ctx, ticker, deps, opts)`: the one primary-key D1 batch (`DOSSIER_SQL`, 13 statements), the vendor fan-out through the caller's `fetchVendor` and limiter, the `flows_dossier_cache` rows (`DOSSIER_SCHEMA_SQL`, `migrations/0016_flows_dossier_cache.sql`), the Cache API entries, the single flight and the 30-second assembled copy. `worker.js` supplies `uwFetch`, the limiter, the quote path and the route. The reads suite counts round trips, rows read, vendor calls and CPU on a counting D1 fake over `node:sqlite` and a stubbed vendor. |
| `tests/gen-dossier-fixtures.py`, `tests/fixtures-dossier-vendor.json` | The vendor fixtures for the dossier, written from the 200-response schema of each operation in `docs/uw-openapi.yaml` (names, JSON types, nullability and the string-typed numerics checked against the spec before anything is written; the spec's sha256 is in the file). `tests/flows-probe-contract.mjs` holds the probe list to the same names. |
| `shared/flows-reading.js`, `tests/flows-reading.mjs`, `tests/reading-archetypes.mjs` | The per-name reading's pure half, a leaf over `flows-dossier.js` and the Ask guard: the 22-code tag table and `heldTags` (every rule over grade-2 facts of an ok or partial packet, thresholds in `TAG_LINES`), `promptForReading`, `parseReading`, `vetReading`, `readingFallback`, `readingShape`, and `askPick` for the Ask box. `reading-archetypes.mjs` builds six dossiers from the harness (the harness name, earnings-week momentum, crowded short, quiet, no card, all vendor packets withheld). The suite holds each threshold from both sides, the fallback to the checks a model's wording must pass, and some thirty adversarial replies. |
| `shared/flows-reading-worker.js`, `tests/flows-reading-worker.mjs`, `tests/flows-reading-render.mjs` | `readingFor(env, ctx, ticker, deps, opts)`: the stored reading under `flows_neuron` scope `read:<T>`, the intraday floor, the fingerprint, the claim, the one capped model call in `ctx.waitUntil`, the cooldown after a refusal, `FLOWS_READ_MODE`. `worker.js` supplies the deps (`readingDeps`) and `summaryResponse`. The worker suite drives it through `worker.js` with a scripted AI binding and the dossier harness; the render suite is Chromium against `page.route` stubs of the ticker page. |
| `shared/flows-cross.js` | The `universe` payload's column store (`UNIVERSE_COLUMNS`, one integer column per key, decoded by `units`) and its 100 KiB budget, shed by column priority when over. The nightly's dealer columns are dollars per 1% move over average daily dollar volume (`gexAdv`, `dex`, `vanna`, `charm`) and keep the vendor's sign; `im5` and `im30` are the vendor's implied-move fractions. On 670 synthetic names the payload is 96,158 bytes without them, 108,249 with them unbudgeted, and 100,505 after the shedder drops `adx`, `dGamma` and `gexRatio`; the run's `shed` list is the measurement that counts. |
| `assets/js/flows-fresh.js` | The client freshness helper (`FlowsUI.freshFrom`, `heartbeat`); every key a heartbeat reads registers its server verdict with the pill, which is the worst case over its sources (`FlowsUI.freshAggregate`, in `flows-ui.js`), so a page needs no line per region. |
| `tests/flows-live-contract.mjs` | Live-layer builders, phases and states, byte ceilings, the one-writer scans, the `--live` dry run and the client helper. |
| `shared/flows-rt.js` | The real-time rail's pure half: the frozen envelope, topic table, row columns and close codes, the owner switches (`rtSwitches`), `streamEntry` (the `entryOf` shape plus the lag guard), the parse of the 256-byte client messages, per-topic sequence counter and `createSeq` gap detector, the 240-call budget, lag statistics, the latest-wins and append-dedupe merges, the REST shapers `shapePx`, `shapeFl`, `shapeGx`, `shapeMk`, `shapeNw` (vendor body to neutral frame, calling the stored live keys' own shapers), `mergeTopic`, and `RT_UPSTREAM`, the one table from topic to REST request and to vendor socket channels. |
| `shared/flows-rt-hub.js` | `RtHub` (demand, roster, scheduler tick, merge, frames, degrade and resync, hello, status; no REST in it), `createRestUpstream` (the REST adapter: every path, cursor, rotation, deadline and 429 pause lives here), `createHub`, `loadRosterFromD1` (one read-only batch) and the `Pulse` Durable Object class wiring hibernatable sockets and alarms to the hub. Imports no `cloudflare:workers`, so Node loads it. |
| `shared/flows-rt-routes.js` | `serveRt`: `/api/rt/ws`, `/api/rt/snap`, `/api/rt/status` inside `route()`; the kill switches, the audience gate, the origin check, and the forward to the one named object. |
| `tests/flows-rt-contract.mjs`, `tests/rt-fixtures.mjs` | The rail with no server: envelope, shaper parity with the stored keys, merges, sequences, freshness classes and the lag guard, the adapter against a stub vendor, the hub on a fake clock (demand, closed sessions, degrade and recovery, hibernation, kill switches), the routes against a fake namespace, the roster SQL over `node:sqlite`, and CPU and bytes per poll. `rt-fixtures.mjs` is the shared fake vendor. |
| `tests/flows-rt-server.mjs` | The rail in real workerd with persisted Durable Object storage, a loopback fake vendor and real WebSocket clients. |
| `assets/js/flows-rt.js` | The rail's browser half, attached as `FlowsUI.rt`: one WebSocket per tab with refcounted topics, the ladder socket, then `GET /api/rt/snap` every 5 s, then the pages' own heartbeats (and `off` when the rail answers 401, 403 or 404), per-topic sequence and epoch handling (a gap sends `{t:"rs"}` and holds the topic until a snapshot; a new epoch discards its state), `rt:<topic>` freshness entries that are dropped when the transport falls, rAF-conflated listeners (`FlowsUI.rt.on`), and the adapters the pages read: `strips()` (px rows mapped back to the `live:strips` body, `fields` from `meta.cols`), `quote(t)`, `market(base)`, `alerts()`, `news()`, `gex(t)`, `feeds(k)`. It never touches the DOM. |
| `tests/flows-rt-client.mjs` | The client in Chromium with `page.routeWebSocket` and `page.route` stubs, no workerd: merges by quote time, sequence gaps, epoch changes, control frames, the bye codes, reconnect backoff on a paused fake clock, the ladder down and back up, freshness entries dropped, a hidden tab, the 256-byte cap, the board, home, unusual, market and ticker pages fed from the stream, a hostile headline that never reaches `innerHTML`, timer and listener census after close, the existing heartbeat unchanged, and the client against the real `RtHub` over a bridged socket (a lost frame, a restart, a vendor outage). `RT_ONLY=measure` prints the receive-path cost, DOM writes and bytes a minute instead. |
| `assets/js/flows-net.js`, `assets/css/flows-net.css` | The flow network, attached as `FlowsUI.net` (`model`, `mount`, `of`) and loaded only by the unusual page, whose hero it is. `model(rows, o)` is pure: each flagged window's premium is split by the vendor's ask-side and bid-side attribution (the rest, left between the quotes or never split, is Unattributed) and routed side, sector (the nightly universe's; the top five and Other once there are more than six), name (the largest ten, fewer on a narrow screen, and Other names), then lean (calls at ask and puts at bid bullish, calls at bid and puts at ask bearish, by convention) or expiry horizon (calendar days from the window's own Eastern date), so every layer, every hop and every node's outgoing edges sum to the same premium. Every layer is ranked by premium, largest at the top (rank numerals on the names), with the residual buckets last whatever their size (Other or Other names, then No sector, Sector unread, Sector pending; No expiry in the Expiry output); name, sector and expiry nodes carry `contracts`, the windows' summed `size`, only when every window states one, and side and lean nodes never do. `mount(host)` draws it as a real 3D scene on Canvas 2D: the layers stand as vertical glass planes on a shallow arc facing the viewer, nodes are lit spheres stacked by rank, edges tapered ribbons, a perspective floor grid with soft shadows, depth fog, and one painter's sort per frame over spheres, ribbons and depth slices of the pulses (an in-place insertion sort over arrays built at rebuild, no allocation per frame). The camera has a field of view, yaw and pitch: a slow sway at rest, held still while a mouse is over it; a pointer or horizontal touch drag orbits it (yaw within 55 degrees, 30 on a phone, pitch within 22) with inertia; a double click or tap, R or 0 on a node, or the corner control recentres it. Each frame fits the scene to the canvas and arranges the labels: 27 arrangements of label sides and per-layer forms (one line, two lines with the premium beneath, the name alone; the sector and name layers choose their form separately, since the name column's projected pitch is 22 to 41 px at 1440 and the two-line form is 36 px tall) are tried in order with the four layer captions in the collision set, each column spread apart, and the first with no collision is drawn. A label that has slid more than half its layer's projected pitch (the tier's column pitch on the phone), or more than its own size, from its sphere's centre is a collision too, so a chip is never nearer another sphere than its own; where no arrangement fits, a drag or the sway (sampled at eight phases) is clamped to the widest angle at which one does, so no label leaves the canvas, meets another or drifts from its sphere at any angle, and every sector and name shows its premium at 768 px and at both yaw limits at 1440. A label still displaced by more than 4 px draws a 1.5 px leader in its node's colour. The chip behind a sector or name label is opaque (0.9) and drawn at full opacity under dimmed text, so a lit ribbon never crosses a glyph; the tooltip takes the side (right, left, above, below) that covers the least of the lit subgraph and the captions. Reordered data glides to its new rank. Light runs along each path in proportion to its premium and a window that arrives while the page is open fires a flare. Hover, focus or a table row lights a subgraph; it stops drawing when the tab is hidden or the canvas is off screen and draws one still frame at the rest angle under reduced motion, where a drag repaints that frame and leaves no animation running; below 560 px the layers become rows with ranks left to right. The node hit targets (one roving tab stop, arrow keys between nodes, names linking to the ticker page), the canvas's spoken summary and the table of the 24 largest paths are its accessible half. It reads `/api/flows/universe` once for sectors and nothing else; the unusual controller hands it the alerts it already holds. |
| `tests/flows-net-render.mjs` | The flow network on the real unusual page in Chromium against `page.route` stubs, no server: layer counts and premium conservation through every layer, hop and node against an independent sum in Node, the ranking on screen at rest, at the yaw and pitch limits, after reordering data and under reduced motion, contracts in the tooltips, mouse and touch orbit (clamps, inertia, recentring, a vertical touch still scrolling the page), hit targets after a rotation, the painter's back-to-front order, hover, row and keyboard highlighting, the table and the canvas label, the freshness pill, the Expiry output, a flare on a new window, focus kept through a rebuild, pause when hidden or off screen, reduced motion, the pending, empty, failed and unread states, no overflow, no label or caption collision and every label within half a pitch of its own sphere (the suite's own pitch from the projected spheres, tier-aware on the phone) at 320, 390, 700, 768, 1024, 1280 and 1440 px in both outputs over a 9 by 5 yaw and pitch grid with the limits, along sixteen points of the sway path and where a long drag stops (which must be an angle that fits with 1.5 degrees further not fitting, or the literal limit), every sector and name label carrying its premium at 768 at rest and at 1440 at both yaw limits, a dark chip pixel beside NVDA's rank numeral, the tooltip clear of the pinned subgraph, the first tap on Recentre after a touch drag, a host 0, 20 or 40 px wide laid out at its stage's own 16, 36 or 56 px (the stage's negative margins; none reaches `size()`'s 640 px fallback), and CPU per frame at 200 or more edges and 400 pulses. `NET_SHOTS=<dir>` saves screenshots. |
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
- `GET /api/rt/ws`, `/api/rt/snap` and `/api/rt/status` are the Flows real-time
  rail (see "Real-time rail"); they use the Flows session, not the learning one.
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
finishes in `ctx.waitUntil`, and the next read picks the result up. Slow kinds
(identity and fundamentals 24 h, positioning 24 h, earnings 12 h, analysts 6 h)
live in `flows_dossier_cache (ticker, kind)`, one row of at most 8 KiB each,
written once per refresh. News (5 min), the dark-pool levels (60 s) and the
quote (5 s) are Cache API entries, and a complete dossier is kept whole for 30
seconds (`/assembled/<T>`), which is what a burst of reads of one name costs.
Concurrent reads of one name share one flight. The limiter refusing, the vendor
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
  held?: "floor" | "fingerprint", retryAfterS?
}
```

- `ready` is a stored model reading served as it was written: every cite resolved at
  write time, so the prose and the chips describe the same figures. `generating` and
  `fallback` carry the deterministic reading built from the current dossier by
  `readingFallback` (templates over the same facts, every sentence cited, passing the
  same checks a model's wording must). `generating` means a model call is in flight or
  was just started and the page should poll the summary. `fallback` means none is
  coming: `why` is `off` (`FLOWS_READ_MODE=off`), `no-model`, `store`, or `cooldown`
  (a refused, unparsable or failed attempt; `retryAfterS` says how long, and the
  provenance names the reason, the daily budget being spent among them). `absent` is a
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
  fingerprint = dossier fingerprint + the model signature + reading version. A reading
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
  added facts. The answer carries `dossierFacts`.
- `FLOWS_READ_MODE` (`wrangler.toml` [vars], default `on`): `off` makes `read` the
  deterministic reading with no row read and no model call. Anything but `off` means on.
- Not proven offline: that a real model keeps to these rules. Every test uses scripted
  replies. The first live readings are the first evidence of the refusal rate; DEPLOY.md
  10.5m says where to look.

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
lists all five with `demanded`. Tier 1, Tier 2 and the nightly are
unchanged and remain the fallback. The hub reads D1 (the roster and the clock
row, one batch at start and every five minutes, and again after 30 seconds
when a read failed or timed out, keeping the roster it holds or the base names
meanwhile) and never writes it; it adds no `live:*` key, never touches the
`UW_ONDEMAND` limiter (its own budget is `FLOWS_RT_CALLS_PER_MIN`, default 240),
and never calls `env.AI`. The upstream
sits behind `createRestUpstream` so a WebSocket upstream can replace it
without touching the hub or the client: the hub calls only `start(plan,
handlers)`, `stop()`, `tick(now)`, `paused(now)` and `state()`, and receives
neutral frames `{k, readAt, items, vendorAt, meta, full, answered}` whose
`items` are already the wire's row shapes. `RT_UPSTREAM` maps each topic to its
REST request and to the vendor socket channels (px: `price:<T>`, later
`stock_screener`; fl: `flow-alerts`; gx: `gex:<T>`; mk: `market_tide`,
`net_flow:<T>`; nw: `news`). The WebSocket upstream is not implemented.

Routes, all inside `route()` so the finalizer sees every response (a 101 keeps
its `webSocket` through `new Response(response.body, response)`):

- `GET /api/rt/ws` (Upgrade): Flows session, same-origin, audience gate, then
  the verified user and expiry travel to the object in `X-RT-User` and
  `X-RT-Exp` (any client `X-RT-*` and the cookie are stripped). Query `k`
  (topics, default all) and `f` (focus ticker). At most `FLOWS_RT_USER_CAP`
  (3) sockets per user: the next gets a `ctl.bye` with code 4009 and is closed.
- `GET /api/rt/snap?k=px,fl,mk`: the same envelopes as a JSON array, from the
  object's memory, `no-store`, with `X-Fresh-*` of the worst frame. It wakes
  the hub and waits up to 3 s for a cold topic.
- `GET /api/rt/status`: owner only. Mode, audience, upstream, sockets by user,
  per-topic sequence, last-frame age, last upstream error, vendor lag p50/p95
  (hub receive time minus vendor timestamp), calls in the last minute and hour
  by topic, the degraded episode and the kill switches.

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
- Rows. `px`: `[ticker, qt, ...23 strip values]` (`meta.cols` on snapshots),
  latest wins by vendor quote time, changed rows only (`qa` is not a change).
  `fl`: the `live:alerts` row plus `id` and `ts`, ascending, appended and
  deduped by alert id, at most 200 a frame, `meta.cursor`, `meta.dropped`,
  `meta.truncated`. `gx`: `[ticker, atMs, px, gOi, gVol, gDir, flow, lagS]`,
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

The browser half is `assets/js/flows-rt.js`, `FlowsUI.rt`, loaded after
`flows-ui.js` (and `flows-fresh.js` where the page has it) on the boards, the
home page, the market page, the unusual page and the ticker. It codes against the
envelope above and assumes no cadence. It walks a ladder: the socket; on a
failure, a no-reconnect bye (4001, 4003, 4009, 4011, 4012) or repeated failures,
`GET /api/rt/snap` every 5 s with the socket probed again after 1, 2, 4 and 8 s and
then every minute; the pages' own heartbeats underneath always; and `off` for the
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

Source scans go through `tests/lib/source-scan.mjs`, never a raw read of
`worker.js`: `workerSource()` is the Worker's whole import closure, `slice()`
throws on a missing marker or a cut across a module boundary, `expect()`
takes a `min` of at least 1, and `absent()` requires a positive `anchor` that
must match the same source, so no scan passes on an empty match.

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
over a window's runs); and `tests/lib/d1-fake.mjs` (the counting D1 fake over
`node:sqlite` that `flows-reads-contract` uses: trips, rows read by query
plan, rows written, and the fail, throw, hang and slow switches). New CPU
ceilings and new in-process D1 suites use these rather than another copy.

GitHub Actions runs these gates on pushes to `main`, on pull requests, and by
manual dispatch. It uses pinned dependencies from `tests/package-lock.json`.

`npm test` is `node run.mjs`, the fail-late runner. It runs every suite
registered in `tests/suites.json`, in that file's order and with `tests/` as
the working directory, whatever an earlier suite did; kills a suite at its
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
is set. **Every `test:*` script in `tests/package.json` needs an entry in
`tests/suites.json`** (name, class `N`, `C` or `W`, `medianS`, and an
optional `group`, `fast` or `shard`, default `shard`; only `contracts` and
`run` are `fast`), or the runner refuses to start and exits 2.
`node run.mjs --only a,b` (from `tests/`, names without the `test:` prefix)
runs those suites alone, `--bail` stops at the first failure as the old
chain did, and `--timeout-scale=x` multiplies every timeout on a slow
machine (a timeout past `setTimeout`'s 2^31-1 ms is held there, so a very
large scale switches timeouts off rather than firing them at once).
`--group fast|shard` runs one group, in manifest order. `--shard i/n` runs
the i-th of n shards of the `shard` group: longest `medianS` first into the
cheapest shard, a shard charged 24 s of Chromium install when it takes its
first `C` or `W` suite, equal medians taken in manifest order and an equal
cost given to the lower shard, the fast suites weighed and then left out;
each shard runs in manifest order.
`--needs-browser` with either prints `true` or `false` (whether the
selection holds a `C` or `W` suite) and runs nothing. An empty shard or
group, a bad `i/n`, an unknown group, and `--only` with `--shard` or
`--group` are usage errors (exit 2) that run nothing. `npm run test:x`
still runs one suite by itself, and `npm test` with no flag still runs the
whole chain.

In CI (`.github/workflows/regression.yml`) the chain runs as a `fast` job
(full history and `ASSET_DIFF_BASE`, the Worker dry run, then
`node run.mjs --group fast`, no Chromium), six `shard` jobs (a matrix of
`--shard 1/6` to `6/6`, fail-fast off, a shallow checkout, Chromium installed
only when `--needs-browser` answers `true`), and `test`, which needs both,
runs `if: always()`, and is green only when the fast job and every shard
succeeded. `test` is the job a ruleset on `main` should require (A-15); as
of 2026-10-05 `main` has no branch protection and no ruleset, so nothing
requires it yet and Workers Builds still deploys `main` on merge. **Adding a suite, or refreshing
a `medianS`, means changing `tests/suites.json` AND republishing
`PUBLISHED_SHARDS` in `tests/run-contract.mjs` with the new six-shard
packing (unchanged when no suite moves), then running
`node run-contract.mjs` from `tests/`.** The contract
holds the packing equal to that table, so a suites.json entry alone turns
`run` red in the fast job (`THE SIX-SHARD ASSIGNMENT EQUALS THE PUBLISHED
TABLE`), and its message prints the packing computed now in the table's shape,
ready to paste.

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
flows-ws-probe-contract
flows-vol-contract
flows-positioning-contract
flows-legs-contract
flows-live-contract    flows-freshness-contract
flows-starts-contract  flows-rt-contract
flows-quant-card       flows-track-render
flows-quant-audit
flows-pipeline-contract  flows-reads-contract  flows-ledger-contract
flows-verdict-contract
flows-readers-contract   flows-readers-render
markets-contract         flows-desk-client
landing-motion
flows-basis-contract     flows-desk-wiring
flows-neuron-screen
lib-contract
flows-dossier-contract   flows-dossier-reads
flows-reading   flows-reading-worker   flows-reading-render
flows-rt-client          flows-net-render
run-contract
```

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

`lib-contract` was measured on 2026-10-05: about 3 s with no server and 239 checks (240 with
`PW_CHROMIUM_PATH` set, which adds a real launch; in this sandbox it is
`/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, and CI leaves it unset). It builds a
throwaway git repository for the served-tree semantics, drives the CPU budget on an injected clock, and runs
`scripts/bump-assets.mjs` on a copy of the pages and sheets it lists from Git without the tool. It reads no
history, so no diff against a base can turn it red, but it does constrain the tree: it fails when the committed
pages and sheets do not pass `bump-assets --check` (see "Asset versioning"), and when an unignored symlink to
nothing would fail the asset upload. It needs Node 22.13 or newer for `node:sqlite`.

`flows-dossier-contract` was measured on 2026-10-03: 11 s with no server and 14,249 assertions. It builds
every packet from the nightly payload fixtures and from `tests/fixtures-dossier-vendor.json`, proves with a
recording `Proxy` that each reducer reads only the fields `DOSSIER_READS` names and the probe list holds,
fuzzes the sanitiser with instruction, markup, URL, bidi, role-marker and obfuscated text, runs the renderer to
every budget from 400 to 12,000 tokens, and checks the fingerprint over 120 random price levels.
`flows-dossier-reads` was measured the same day: 4.4 s and 232 checks. It imports `worker.js` into Node with the
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
`flows-reads-contract` runs the Neuron's own assertions with `FLOWS_READ_MODE=off` and filters the dossier's trips
out of them; a final block prices the reading: a summary hit reads 3 rows (the Neuron's two and the reading's one),
a miss 18 before the response and 30 with the background generation.

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
`flows-rt-contract` was measured on 2026-10-03: about 20 s with no server, 1,118
assertions, on a machine shared with other suites. It drives the real hub on a
fake clock and fake sockets against a stub vendor, loads `Pulse` with a fake
`ctx`, runs the roster SQL over `node:sqlite` (so it needs Node 22.13 and runs
under `--disable-warning=ExperimentalWarning`), and prints the CPU per poll and
the bytes per frame it measured: on a 157-name roster with every row changing,
px costs about 3 ms of CPU a poll and 31.7 KB a frame, fl 0.3 ms, gx 0.7 ms,
mk 0.3 ms, nw 0.5 ms; a px snapshot is 32 KB, an fl snapshot 81 KB.
`flows-rt-server` boots workerd four times (the rail, a Saturday, the switch off,
production cadence) with persisted Durable Object storage, because raw workerd
with in-memory Durable Object storage crashes when an alarm fires; the first
three run at `FLOWS_RT_SCALE=0.2`, the last at real cadence and takes a minute
of wall time by itself. It needs `FLOWS_TEST_SANDBOX=1` in the sandbox and was
measured on 2026-10-03 at 151 s with 158 assertions. It also prints the vendor
calls a minute at real cadence for one socket on all five topics with one focus
ticker (px 12, fl 12, gx 4, mk 12, nw 2 on 2026-10-05; gx was 59 before it
read focus tickers only) and the alert-to-client latency it saw (p50 2.1 s,
p95 4.5 s over 40 alerts).
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
it is registered in `tests/suites.json` as class `C`. It serves `unusualPage` itself, the assets from disk and the alerts, the universe
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
`run-contract` (the `run` suite) was measured on 2026-10-05: 15 to 21 s with no
server and 379 assertions, almost all of it waiting out the fixtures' timeouts
and kill graces. It checks `tests/suites.json` against `package.json`, then
spawns `run.mjs` against fixture suites in a temporary directory: a failure, a
hang that ignores SIGTERM, a flaky suite, a detached process that holds a
suite's output open past its timeout, 3 MiB on one unterminated line, 80 wide
failures under the step-summary limit, a ✓ split across the 64 KiB pipe chunk,
a child left in a suite's group after the suite exits 0 and after it leaves on
SIGTERM, a timeout scale past `setTimeout`'s range, and the runner itself sent
SIGTERM, SIGINT, SIGHUP, two SIGINTs 5 ms apart and a second SIGINT 800 ms
later mid-suite. Its process checks read `/proc` where it exists and `ps`
elsewhere, so it runs on macOS too.

Confirmed to need one: `flows-rt-server`, `flows-overview-contract`, `flows-board-render`,
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
  `LEARNING_PATHS`, `toast`, `COURSE_STAGE_IDS`, `COURSE_SKILLS`,
  `SKILL_CATALOG`, `SKILL_BY_ID`, `SkillMasteryScheduler`, `PROJECT_CATALOG`,
  `PROJECT_BY_ID`, `FlowsUI`, and `FlowsQuant`. The rail's browser
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
