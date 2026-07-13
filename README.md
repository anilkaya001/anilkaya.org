# anilkaya.org

Personal site of **Anıl Kaya** — *In Econometrics We Trust* — plus the
**Econometrics Lab**, a staged course platform that runs genuine Python,
statsmodels, NumPy, SciPy, pandas, and matplotlib in the browser through
Pyodide/WebAssembly.

The browser frontend is hand-written semantic HTML, CSS, and vanilla JavaScript.
There is no frontend framework, frontend build step, or runtime npm dependency;
Wrangler bundles the Worker modules when deploying. Pyodide and its scientific
packages load from pinned jsDelivr paths only when a learner runs Python. The
pinned npm dependencies under `tests/` are verification tools, not application
dependencies.

## Runtime

`worker.js` is a Cloudflare Worker with Static Assets. It runs before asset
delivery and provides:

- static HTML/CSS/JS/font/image delivery through the `ASSETS` binding;
- consistent security and caching headers;
- canonical `/lab/<course-slug>/` metadata, crawlable outlines, and structured-data rewriting;
- Google OAuth and signed session cookies under `/auth/*`;
- JSON progress/streak APIs under `/api/*` backed by D1 database `iewt`;
- atomic cross-device progress unions and exact progress-derived points.

As observed on 2026-07-12, the apex used the Worker API while
`www.anilkaya.org` still used GitHub Pages to redirect to the apex. Dashboard
deployment settings and custom-domain state are external to this repository;
verify them before operational changes.

## Repository map

```text
index.html                      landing page
articles/                       articles index and reusable template
lab/index.html                  Econometrics Lab catalogue
lab/course.html                 backing template for clean course-slug pages
assets/css/                     design system and section styles
assets/js/curriculum*.js        curricula, browser scoring manifest, questions
assets/js/lab-core.js           Pyodide runtime and Python editor
assets/js/lab-course.js         course player, grading, progress, splitter
assets/js/storage.js            validated, guarded browser persistence
assets/js/auth.js               Worker API detection and synchronization
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

`assets/js/curriculum.js` declares `TOPIC_META` and the OLS curriculum.
`assets/js/curriculum-data.js` adds IV/2SLS, DiD, VAR, panel, logit, and GMM.
Each topic has four modules made from `read`, `code`, `interactive`, and
question stages. `assets/js/curriculum-questions.js` adds true/false,
multi-select, numeric, and fill-in-the-blank questions.

To change or add course content:

1. update `TOPIC_META` and the appropriate curriculum source;
2. preserve existing stage ordering or provide a progress-index migration;
3. update both scoring manifests in `curriculum.js` and
   `shared/course-points.js` if stage rewards/order changed;
4. bump `assets/version.txt` and every local `?v=` reference for browser-asset
   changes;
5. run the full test suite.

The contract test verifies topic IDs, module/stage counts, every stage schema,
the scoring manifest, local asset existence, and cache-version consistency.

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

The suite executes curriculum/session contracts, a real local Wrangler Worker
with D1 and static assets, and Playwright across all 205 course stages. GitHub
Actions runs it on pushes to `main`, pull requests, and manual dispatch.

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
