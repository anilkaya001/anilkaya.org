# anilkaya.org — project handbook for coding agents

Personal site of Anıl Kaya: a landing page, an Articles section, and the
**Econometrics Lab** — an interactive course platform that runs real Python
(statsmodels) in the browser via Pyodide/WebAssembly.

The browser frontend has no framework, frontend bundler/build step, or runtime
npm dependency. It is plain HTML, CSS, and vanilla JavaScript. Wrangler bundles
the Worker modules during deployment. The committed npm dependencies under
`tests/` are development-only and power verification.

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
- `.assetsignore` excludes Worker code, `shared/`, tests, the private article
  template, `CNAME`, local secrets, schema, Markdown, dotfiles, and configuration
  from the Cloudflare static bundle. `CNAME` remains in Git for GitHub Pages.
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
| `lab/index.html` | Crawlable topic catalogue, progressively enhanced from `TOPIC_META`. |
| `lab/course.html` | Private routing template rewritten for canonical course-slug pages. |
| `lab/lesson.html` | Noindexed static fallback for legacy lesson URLs. |
| `worker.js` | Routing, response policy, OAuth, API, D1 synchronization, SEO rewriting. |
| `shared/session.js` | Defensive HMAC-SHA256 session sign/verify and cookie helpers. |
| `shared/course-points.js` | Server scoring manifest used to derive points from progress. |
| `shared/course-seo.js` | Canonical course slugs, metadata, and crawlable module outlines. |
| `schema.sql` | D1 `users`, `progress`, and `stats` tables. |
| `assets/js/curriculum.js` | Seven-topic metadata, browser scoring manifest, and OLS curriculum. |
| `assets/js/curriculum-data.js` | IV, DiD, VAR, panel, logit, and GMM curricula. |
| `assets/js/curriculum-questions.js` | Additional authored question stages. |
| `assets/js/storage.js` | Validated, guarded persistence with in-memory fallback and key migration. |
| `assets/js/lab-core.js` | Pyodide loader, Python editor, execution, output, and figures. |
| `assets/js/lab-course.js` | Course player, grading, progress, points, navigation, splitter. |
| `assets/js/auth.js` | API detection and monotonic cross-device synchronization. |
| `assets/js/gamify.js` | Local points/streak state and rendering. |
| `assets/js/lab-ui.js`, `lab-fx.js` | Catalogue and visual feedback. |
| `assets/css/base.css`, `lab.css` | Design system and Lab/course UI. |
| `assets/version.txt` | Canonical browser-asset cache version. |
| `tests/contracts.mjs` | Curriculum/schema/scoring/asset/session contracts. |
| `tests/worker-regression.mjs` | Real local Wrangler routing, headers, API, and D1 tests. |
| `tests/regression.mjs` | Full Playwright browser regression suite. |

## Curriculum and stage contracts

`window.TOPIC_META` contains exactly:

```text
ols 20 · iv2sls 31 · did 29 · var 30 · panel 30 · logit 32 · gmm 33
```

Every curriculum has four modules. Each module owns ordered stages. Progress is
currently stored by stage index, so inserting or reordering stages changes the
meaning of existing progress. Append stages or ship an explicit migration.

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
and multi-select 20. `tests/contracts.mjs` proves that authored curricula, the
browser manifest, and `shared/course-points.js` remain identical.

Both client and server derive points from unique completed stages. This repairs
legacy local under-counts and stale/tampered totals. Client-submitted point
totals are deliberately ignored; D1 recomputes its exact total atomically from
the merged progress rows.

## Client persistence

All browser storage access must go through `window.IEWTStorage`:

- `iewt:progress` → `{ [topicId]: { done: [stageIndex, ...] } }`
- `iewt:gamify` → `{ points, streak, last }`, with zero-padded local date
  `YYYY-MM-DD`
- `iewt:guideW` → guide-column width percentage
- `iewt:splitW` → legacy width key, migrated once to `iewt:guideW`

`storage.js` validates shapes, bounds, dates, and numbers. Every native
`localStorage` operation is inside `try/catch`; an in-memory copy preserves the
current page when storage is unavailable.

When signed in, the client unions local and remote progress, uploads the merged
sets, then refreshes exact server-derived points and monotonic streak state. D1
uses an atomic JSON-union UPSERT, so overlapping snapshots cannot delete
completed stages.

## API contract

Every `/api/*` response, including errors, is JSON and `Cache-Control: no-store`.
Errors use:

```json
{ "error": { "code": "unauthorized", "message": "Authentication required" } }
```

- `GET /api/me` → `200 { user: { id, email, name } | null }`
- `GET /api/progress` → `200 { progress }`; signed-out → JSON 401
- `PUT /api/progress` body `{ model, done }` → `{ ok: true, done }`
- `GET /api/stats` → `{ stats: { points, streak, last } }`
- `PUT /api/stats` body `{ streak, last }` → `{ ok: true, stats }`
- Unknown API routes are JSON 404. Unsupported methods are JSON 405 with
  `Allow`. JSON bodies are streamed with a 16 KiB limit and validated.

Progress models and indexes are allowlisted against the scoring manifest.
Stats writes accept only a bounded streak and a valid activity date no more than
one UTC day ahead. Older writes cannot replace newer activity, and a stale
next-day device cannot reduce a known consecutive streak. Points are recomputed
exactly from progress.

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

The current browser-asset version is the integer in `assets/version.txt`
(currently `17`). Every local CSS, JavaScript, and font reference in HTML and
every `@font-face` URL must use that exact `?v=` value.

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

- all seven curricula, four modules each, every stage schema, scoring manifest,
  local asset existence/versioning, and hardened sessions;
- real Worker-first routing, canonical redirects, all seven crawlable metadata
  and syllabus variants,
  response-cloned asset byte integrity, conditional caching, security headers,
  JSON API errors, OAuth failure behavior, D1 user isolation, concurrent
  progress union, and exact derived points;
- no horizontal overflow or browser errors across 320/390/768/1440 widths,
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

- JavaScript remains IIFE-based and framework-free; globals are deliberate:
  `Lab`, `Auth`, `Gamify`, `FX`, `IEWTStorage`, `CURRICULUM`, `TOPIC_META`,
  and `toast`.
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
