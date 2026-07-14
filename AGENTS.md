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
Browser ──► Cloudflare Worker (worker.js; runs before assets)
              ├─ /auth/*  Google OAuth → HMAC-signed session cookie
              ├─ /api/*   JSON API backed by D1 (SQLite)
              ├─ /lab/<course-slug>/ → crawlable course HTML via HTMLRewriter
              └─ everything else → ASSETS binding
```

- `wrangler.toml` is the Worker source of truth: name `anilkaya`, entrypoint
  `worker.js`, static directory `.`, binding `ASSETS`, and D1 binding `DB` to
  database name `iewt`.
- `assets.run_worker_first = true` is required. Without it, matching static
  assets bypass `worker.js`, disabling response headers, cache policy, and
  course metadata rewriting.
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

### External deployment state

Repository files cannot prove Workers Builds branch mapping, dashboard secrets,
custom domains, staging environments, or deployment gates. Verify those in the
Cloudflare dashboard before changing production assumptions.

As observed on 2026-07-12, the apex used the Worker API while
`www.anilkaya.org` was still served by GitHub Pages and redirected to the apex.
The `CNAME` file therefore supports a live hybrid redirect path; do not remove
it until `www` is attached to the Worker and verified.

## File map

| Path | Role |
|---|---|
| `index.html` | Landing page and particle-field hero. |
| `articles/index.html`, `articles/_template/` | Articles index and article template. |
| `lab/index.html` | Crawlable academy catalogue plus learner dashboard, guided paths, search, filters, and reset dialog. |
| `lab/course.html` | Private routing template rewritten for canonical course-slug pages; loads only the selected course payload. |
| `lab/lesson.html` | Noindexed static fallback for legacy lesson URLs. |
| `worker.js` | Routing, response policy, OAuth, API, D1 synchronization, SEO rewriting. |
| `shared/session.js` | Defensive HMAC-SHA256 session sign/verify and cookie helpers. |
| `shared/course-points.js` | Server scoring manifest used to derive points from progress. |
| `shared/course-seo.js` | Canonical course slugs, metadata, and crawlable module outlines. |
| `schema.sql` | D1 `users`, `progress`, `stats`, and per-owner `learning_sync` generation tables. |
| `assets/js/course-catalog.js` | Lightweight course metadata, prerequisites/outcomes, learning paths, and browser scoring manifest. |
| `assets/js/curriculum.js` | Canonical OLS authoring source. |
| `assets/js/curriculum-data.js` | Canonical IV, DiD, VAR, panel, logit, and GMM authoring sources. |
| `assets/js/curriculum-questions.js` | Additional authored question stages applied before payload generation. |
| `assets/data/courses/<topic>.json` | Committed, generated `schemaVersion: 1` payload loaded only for the selected course. |
| `scripts/generate-course-payloads.mjs` | Deterministically regenerates the seven per-course JSON payloads and stable stage IDs. |
| `assets/js/storage.js` | Validated owner-scoped v2 persistence, legacy migration, reset, and in-memory fallback. |
| `assets/js/lab-core.js` | Pyodide loader, Python editor, execution, output, and figures. |
| `assets/js/lab-course.js` | Course player, grading, progress, points, navigation, splitter. |
| `assets/js/auth.js` | Account binding, serialized owner-checked synchronization, and server-first reset coordination. |
| `assets/js/gamify.js` | Local points/streak state and rendering. |
| `assets/js/lab-ui.js`, `lab-fx.js` | Academy dashboard/path/search/reset UI and visual feedback. |
| `assets/css/base.css`, `lab.css` | Design system and Lab/course UI. |
| `assets/version.txt` | Canonical browser-asset cache version. |
| `tests/contracts.mjs` | Curriculum/payload/scoring/storage/asset/session contracts. |
| `tests/worker-regression.mjs` | Real local Wrangler routing, headers, API, and D1 tests. |
| `tests/regression.mjs` | Full Playwright browser regression suite. |

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

Commit all changed files under `assets/data/courses/`. The generator adds
`schemaVersion: 1` and stable per-module stage IDs, while current progress is
still stored by flattened stage index. Inserting or reordering stages therefore
changes the meaning of existing progress; append stages or ship an explicit
progress migration.

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
current page when storage is unavailable. `resetLearning()` clears progress and
gamification for an explicit or active owner, records the confirmed reset
generation, and deliberately preserves `iewt:guideW`.

When signed in, the client serializes mutations, binds them to the verified
account and a mutation epoch, unions local and remote progress, uploads only
missing work, then refreshes exact server-derived points and monotonic streak
state. Every authenticated progress/stats request carries `X-IEWT-Owner`.
Progress and stats PUTs also carry the latest owner-scoped
`X-IEWT-Generation`. D1 uses an atomic JSON-union UPSERT guarded by that
generation, so overlapping snapshots cannot delete completed stages and a
delayed pre-reset write cannot recreate cleared data.

## API contract

Every `/api/*` response, including errors, is JSON and `Cache-Control: no-store`.
Errors use:

```json
{ "error": { "code": "unauthorized", "message": "Authentication required" } }
```

- `GET /api/me` → `200 { user: { id, email, name } | null }`
- `GET /api/progress` → `200 { progress, generation }`; signed-out → JSON 401
- `PUT /api/progress` with `X-IEWT-Generation`, body `{ model, done }` → `{ ok: true, done, generation }`
- `DELETE /api/progress` → `{ ok: true, progress: {}, stats: { points: 0, streak: 0, last: null }, generation }`
- `GET /api/stats` → `{ stats: { points, streak, last }, generation }`
- `PUT /api/stats` with `X-IEWT-Generation`, body `{ streak, last }` → `{ ok: true, stats, generation }`
- Unknown API routes are JSON 404. Unsupported methods are JSON 405 with
  `Allow`. JSON bodies are streamed with a 16 KiB limit and validated.

Authenticated PUT/DELETE requests require an exact `X-IEWT-Owner` match with
the verified session user. Conflicting `Origin` or `Sec-Fetch-Site` metadata is
rejected, and browser cross-origin use is blocked by the custom owner header
plus the absence of CORS permission. Missing or mismatched mutation ownership
returns JSON `409 account_changed`; identified cross-origin mutation attempts
return JSON 403. The two authenticated GET routes allow the owner header to be
absent for compatibility, but reject a present mismatch with the same 409
response.

Missing, malformed, or stale `X-IEWT-Generation` values on PUT return JSON
`409 reset_required` with the current generation in both the response body and
header. The client discards the affected owner's stale local learning state
before any later upload. DELETE deliberately does not require the old
generation: it atomically increments the server value and returns the new one.

Progress models and indexes are allowlisted against the scoring manifest.
Stats writes accept only a bounded streak and a valid activity date no more than
one UTC day ahead. Older writes cannot replace newer activity, and a stale
next-day device cannot reduce a known consecutive streak. Points are recomputed
exactly from progress. Reset uses prepared statements in one D1 `batch()`
transaction: it increments `learning_sync.generation`, deletes every progress
row for the verified user, and resets that user's points, streak, and
last-activity value without touching another user. `schema.sql` provisions the
table and the Worker has an idempotent first-use fallback for databases that
predate it.

Sign-out is `POST /auth/logout`, not a link or GET. It is same-origin protected,
requires the verified owner's `X-IEWT-Owner` when a valid session exists, clears
the session cookie only after those checks, and returns JSON. Do not restore a
GET logout route; that would reintroduce forced-logout CSRF.

## Worker invariants

1. **Preserve response objects when mutating them.** The single finalizer must
   begin with `new Response(response.body, response)`. Rebuilding an existing
   asset response from a status/header dictionary can corrupt
   `Content-Encoding` at the edge.
2. **Every route uses the finalizer**, including auth, API success/errors,
   rewritten HTML, static assets, 404s, and unexpected exceptions.
3. Full security headers apply to every response. CSP applies only to HTML and
   permits jsDelivr plus eval/WebAssembly evaluation required by Pyodide.
4. HTML is `no-cache`; successful/304 versioned assets are immutable for one
   year; other successful/304 assets cache for one hour; API/auth is `no-store`.
5. HTML sends one `Clear-Site-Data: "cache"` repair unless the `cachefix`
   cookie is present. Keep this until the historical encoding incident is no
   longer operationally relevant.
6. Every `/lab/<valid-course-slug>/` receives an apex-domain canonical, exact
   title/description, Open Graph/Twitter fields, visible H1 and four-module
   outline, related course links, and one parseable Course + Breadcrumb JSON-LD
   graph. Generic and invalid legacy routes never return an indexable shell.
7. Malformed, oversized, wrongly signed, or expired sessions fail closed as an
   anonymous user and never throw a request-level 500.

Dashboard Transform Rules can override Worker headers after code runs. A
post-deploy header smoke test is mandatory; remove or align stale dashboard
rules if live headers differ from `worker.js`.

## Asset versioning

The browser-asset version is always the integer read from `assets/version.txt`.
Do not copy a current value into documentation or automation. Every local CSS,
JavaScript, and font reference in HTML, the course shell's
`data-asset-version`, and every `@font-face` URL must use that exact `?v=`
value.

When any file under `assets/css/`, `assets/js/`, or `assets/fonts/` changes:

1. increment `assets/version.txt`;
2. update every versioned HTML/CSS reference;
3. run the contract test.

The contract test compares changed browser assets with `assets/version.txt`,
so a missing bump fails CI.

## Testing and CI

```bash
# Requires Node.js 22 or newer.
cd tests
npm ci
npx playwright install chromium
npm test

# From the repository root: bundle/config validation without deployment
./tests/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/anilkaya-dry-run
```

The suites prove:

- all seven curricula, four modules each, every stage schema, exact generated
  per-course payloads and IDs, payload-size budgets, scoring manifests,
  owner-scoped v2 migration/reset behavior, local asset existence/versioning,
  and hardened sessions;
- real Worker-first routing, canonical redirects, all seven crawlable metadata
  and syllabus variants,
  response-cloned asset byte integrity, conditional caching, security headers,
  JSON API errors, OAuth and POST-only logout behavior, D1 user isolation,
  concurrent progress union, owner-header and same-origin enforcement,
  generation-fenced transactional reset, stale-write rejection, and exact
  derived points;
- academy dashboard metrics, four learning paths, search/level/status filters,
  single-course payload isolation, anonymous and signed-in reset safety, no
  horizontal overflow or browser errors across 320/390/768/1440 widths,
  WCAG-AA faint text, pill geometry, 44×44 primary course targets (including
  range inputs), ≥16 px text inputs, every stage heading outline, rapid
  navigation, preserved unsaved work during sync, splitter migration and
  keyboard persistence, blocked/malformed/quota-limited storage, score
  reconciliation, boot live-region output, grading edge cases, exact rewards,
  and duplicate-award prevention.

GitHub Actions runs these gates on pushes to `main`, on pull requests, and by
manual dispatch. It uses pinned dependencies from `tests/package-lock.json`.

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

## Design and accessibility invariants

- JavaScript remains IIFE-based and framework-free; production globals are
  deliberate: `Lab`, `Auth`, `Gamify`, `FX`, `IEWTStorage`, `TOPIC_META`,
  `TOPIC_BY_ID`, `COURSE_STAGE_POINTS`, `LEARNING_PATHS`, and `toast`.
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
