# anilkaya.org

Personal site of **Anıl Kaya** — *In Econometrics We Trust* — plus the
**Econometrics Lab**, a staged course platform that runs genuine Python,
statsmodels, NumPy, SciPy, pandas, and matplotlib in the browser through
Pyodide/WebAssembly.

The browser frontend is hand-written semantic HTML, CSS, and vanilla JavaScript.
There is no frontend framework, runtime bundler, or runtime npm dependency;
Wrangler bundles the Worker modules when deploying. An authoring script writes
committed per-course JSON, so production needs no content build step. Pyodide
and its scientific packages load from pinned jsDelivr paths only when a learner
runs Python. The pinned npm dependencies under `tests/` are verification tools,
not application dependencies.

## Runtime

`worker.js` is a Cloudflare Worker with Static Assets. It runs before asset
delivery and provides:

- static HTML/CSS/JS/font/image delivery through the `ASSETS` binding;
- consistent security and caching headers;
- canonical `/lab/<course-slug>/` metadata, crawlable outlines, and structured-data rewriting;
- Google OAuth and signed session cookies under `/auth/*`;
- JSON progress/streak APIs under `/api/*` backed by D1 database `iewt`;
- atomic cross-device progress unions and exact progress-derived points;
- owner-bound, same-origin mutations plus a generation-fenced transactional reset.

As observed on 2026-07-12, the apex used the Worker API while
`www.anilkaya.org` still used GitHub Pages to redirect to the apex. Dashboard
deployment settings and custom-domain state are external to this repository;
verify them before operational changes.

## Repository map

```text
index.html                      landing page
articles/                       articles index and reusable template
lab/index.html                  academy dashboard, paths, search, and catalogue
lab/course.html                 backing template for clean course-slug pages
assets/css/                     design system and section styles
assets/js/course-catalog.js     lightweight catalogue, paths, and scoring metadata
assets/js/curriculum*.js        canonical course authoring sources and questions
assets/data/courses/            generated, committed per-course JSON payloads
scripts/generate-course-payloads.mjs  deterministic payload generator
assets/js/lab-core.js           Pyodide runtime and Python editor
assets/js/lab-course.js         course player, grading, progress, splitter
assets/js/storage.js            owner-scoped v2 persistence, migration, and sync generation
assets/js/auth.js               generation-fenced sync, reset, and POST sign-out coordination
shared/session.js               signed-session helpers
shared/course-points.js         server scoring manifest
shared/course-seo.js            canonical slugs and crawlable course metadata
worker.js · wrangler.toml       Worker implementation and configuration
schema.sql                      D1 schema
tests/                          contract, Worker-runtime, and browser suites
AGENTS.md                       complete engineering handbook
DEPLOY.md                       deployment and rollback runbook
```

## Econometrics Lab data model

This release is the complete core curriculum: seven courses and 205 assessed
learning stages spanning regression foundations, causal methods, panels, time
series, limited outcomes, and GMM. The catalogue and payload contracts are
designed for further method families without making unshipped-course claims.

`assets/js/course-catalog.js` is the small runtime catalogue: course metadata,
prerequisites, outcomes, four guided learning paths, and the browser scoring
manifest. `assets/js/curriculum.js` authors OLS; `curriculum-data.js` adds
IV/2SLS, DiD, VAR, panel, logit, and GMM; and
`curriculum-questions.js` appends the authored assessments. Each topic has four
modules made from `read`, `code`, `interactive`, and question stages.

The course shell fetches exactly one
`assets/data/courses/<topic>.json` payload. It does not download all seven
curricula. Generated payloads are committed, carry `schemaVersion: 1` and
stable stage IDs, and are capped by tests at 14 KiB gzip each.

To change or add course content:

1. update `course-catalog.js` and the appropriate curriculum authoring source;
2. preserve existing stage ordering or provide a progress-index migration;
3. update both scoring manifests in `course-catalog.js` and
   `shared/course-points.js` if stage rewards/order changed;
4. run `node scripts/generate-course-payloads.mjs` and commit the resulting
   JSON payload changes;
5. increment the integer in `assets/version.txt` and update every local `?v=`
   reference for browser-asset changes;
6. run the full test suite.

The contract test verifies topic IDs, module/stage counts, every stage schema,
payload equality/IDs/size, both scoring manifests, local asset existence, and
cache-version consistency. Always read the asset version from
`assets/version.txt`; do not maintain a second hardcoded version in scripts or
documentation.

## Academy experience and learning state

The Lab home provides a learner dashboard, resume target, curriculum-wide
metrics, four ordered learning paths, and course discovery by free-text search,
level, and completion status. Initial HTML still contains the real seven course
links and summaries, so the catalogue remains useful and crawlable without
JavaScript.

`IEWTStorage` stores learning data in validated v2 envelopes scoped to either
the anonymous learner or the exact verified account. Legacy `iewt:progress` and
`iewt:gamify` values migrate only through the anonymous scope; account scopes
stay separate on shared browsers. Guide width is device-wide and intentionally
survives a learning reset.

Anonymous reset clears only the active local learning scope. Signed-in reset is
server-first: `DELETE /api/progress` runs prepared D1 statements in one
`DB.batch()` transaction to increment that user's synchronization generation,
delete progress, and zero points, streak, and last activity. Local data is
cleared only after server success, and the exact owner captured when reset began
is cleared even if another tab changes the active account while the request is
pending. A serialized mutation lane and epoch order and invalidate the active
page's writes around the reset.

Authenticated progress/stats requests carry `X-IEWT-Owner`. Progress and stats
PUTs also carry the owner-scoped `X-IEWT-Generation` returned by the latest GET
or reset. D1 accepts a write only when that value still matches, so a delayed
pre-reset request cannot recreate cleared learning data. Mutations require an
exact owner match to the verified session user; conflicting `Origin` or
`Sec-Fetch-Site` metadata is rejected, while the custom header and lack of CORS
permission block browser cross-origin calls. Present-but-mismatched owner
headers on reads are also rejected. Sign-out is an owner-bound same-origin
`POST /auth/logout`, never a GET, to prevent forced-logout CSRF.

## Local development

Production-equivalent development requires Node.js 22 or newer and uses the
pinned Wrangler version:

```bash
cd tests
npm ci
npx playwright install chromium
cd ..

./tests/node_modules/.bin/wrangler d1 execute iewt --local --file schema.sql
./tests/node_modules/.bin/wrangler dev --local
```

For local Google OAuth, add git-ignored `.dev.vars`:

```dotenv
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=use-a-long-random-local-value
```

`python3 -m http.server` is only a limited static-file preview. It does not
reproduce extensionless routing, Worker response policy, HTML rewriting,
OAuth, APIs, or D1.

## Verification

```bash
cd tests
npm ci
npx playwright install chromium
npm test

cd ..
./tests/node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/anilkaya-dry-run
```

The suite executes curriculum/payload/storage/session contracts, a real local
Wrangler Worker with D1 and static assets, and Playwright across all 205 course
stages. It covers the academy dashboard and filters, one-course payload loading,
owner isolation, reset success/failure and stale-write rejection, same-origin
enforcement, POST-only logout, and responsive/accessibility regressions. GitHub Actions runs it on
pushes to `main`, pull requests, and manual dispatch.

## Deployment

See [`DEPLOY.md`](./DEPLOY.md). The short version is:

1. pass `npm test` and the Wrangler dry-run;
2. confirm D1 schema and secrets in the target Cloudflare account;
3. deploy the exact tested commit with pinned Wrangler;
4. run the documented production smoke tests;
5. verify dashboard header rules and both apex/`www` routing;
6. roll back immediately if response encoding, auth, or persistence differs.

Do not assume that a push deploys, that staging exists, or that CI gates an
external Workers Build merely because repository tests are green. Those are
dashboard settings and must be verified independently.
