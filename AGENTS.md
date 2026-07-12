# anilkaya.org — project handbook for coding agents

Personal site of Anıl Kaya: a landing page, an Articles section, and the
**Econometrics Lab** — an interactive course platform that runs *real* Python
(statsmodels) in the browser via Pyodide/WebAssembly. No frameworks, no build
step, no npm dependencies at runtime: plain HTML + CSS + vanilla JS (IIFE
modules), served as Cloudflare Worker Static Assets with a small API.

## Architecture

```
Browser ──► Cloudflare Worker (worker.js)
              ├─ /auth/*  Google OAuth → HMAC-signed session cookie (shared/session.js)
              ├─ /api/*   JSON API backed by D1 (SQLite) — me / progress / stats
              └─ everything else → ASSETS binding (this repo, minus .assetsignore)
                   └─ /lab/course.html?m=<topic> + crawler UA → HTMLRewriter injects
                      per-topic title/description/canonical/og:image/Course JSON-LD
```

- **Hosting**: Cloudflare Workers with git integration ("Workers Builds").
  **Every push to `main` auto-deploys** (`npx wrangler deploy`). There is no
  staging environment — treat `main` as production.
- **wrangler.toml**: worker name `anilkaya`, assets directory `.` (repo root),
  binding `ASSETS`, D1 binding `DB` → database `iewt`
  (id `73c8c626-e971-44da-b8c1-21d6062cb9f2`).
- **.assetsignore** keeps `worker.js`, `shared/`, `tests/`, `schema.sql`,
  `*.md`, dotfiles out of the public bundle. Note: **`*.md` means this file
  and README are never served** — safe place for docs.
- **Secrets** (set in the Cloudflare dashboard → Worker → Settings → Variables,
  never in the repo): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `SESSION_SECRET`.
- **Domain**: anilkaya.org (CNAME file is a GitHub-Pages leftover; harmless).

## File map

| Path | Role |
|---|---|
| `index.html` | Landing page (particle-field hero). |
| `articles/index.html`, `articles/_template/` | Articles index + template for future posts. |
| `lab/index.html` | Lab home: topic grid rendered by `lab-ui.js` from `TOPIC_META`. |
| `lab/course.html` | The course player (one page for all topics, `?m=<id>`). |
| `lab/lesson.html` | Legacy redirect stub → course.html (noindexed). |
| `worker.js` | All server logic (see Architecture). |
| `shared/session.js` | HMAC-SHA256 session sign/verify + cookie helpers. |
| `schema.sql` | D1 schema. Apply: `wrangler d1 execute iewt --remote --file=./schema.sql`. |
| `assets/js/curriculum.js` | `TOPIC_META` (7 topics) + the full OLS curriculum + stage-count map. |
| `assets/js/curriculum-data.js` | Curricula for iv2sls, did, var, panel, logit, gmm (one big JSON assign). |
| `assets/js/curriculum-questions.js` | Extra authored quiz items, appended non-destructively per module. |
| `assets/js/lab-core.js` | Pyodide boot (v0.26.4 from jsDelivr) + code-cell factory (`window.Lab.makeCell`) + editor/highlight overlay + matplotlib capture. |
| `assets/js/lab-course.js` | Course player: flattens modules→stages, renders one stage at a time, progress, keyboard nav, resizable splitter. |
| `assets/js/lab-ui.js` | Lab home grid + account strip. |
| `assets/js/lab-fx.js` | Delight layer: confetti, correct/wrong flashes, coin fly, streak flame, page-turn. `window.FX`. |
| `assets/js/gamify.js` | Points/streak in `localStorage` + `window.Gamify` (`award/merge/paint`). |
| `assets/js/auth.js` | `window.Auth`; detects backend via `/api/me`, syncs progress+stats when signed in. |
| `assets/js/nav.js` | Pill nav: equal-width tabs + fixed-size gold indicator (transform-only animation). |
| `assets/js/particles.js` | Landing-page gold particle field (canvas), reduced-motion aware. |
| `assets/css/base.css` | Design tokens, fonts, reset, topbar/pill/buttons. Loaded everywhere. |
| `assets/css/home.css`, `lab.css`, `article.css` | Per-section styles. |
| `assets/fonts/LM-*.woff2` | Latin Modern, **subset** (Latin+Greek+math ranges, ~29-35 KB each). |
| `assets/img/og.png`, `og-<topic>.png` | 1200×630 social cards (generic + one per topic). |
| `tests/regression.mjs` | Self-contained Playwright suite (see Testing). |
| `.github/workflows/regression.yml` | Runs the suite on every push/PR. |

## Data structures

### Topics — `window.TOPIC_META` (curriculum.js)
```js
{ id: "ols", num: "01", title: "Ordinary Least Squares", level: "Beginner",
  blurb: "...", tags: ["regression","inference"], stages: 20 /* injected */ }
```
Topic ids: `ols`, `iv2sls`, `did`, `var`, `panel`, `logit`, `gmm`.
Stage counts: ols 20, iv2sls 31, did 29, var 30, panel 30, logit 32, gmm 33.

### Curriculum — `window.CURRICULUM[topicId]`
```js
{ id, title, modules: [ { id, title, summary, stages: [Stage, ...] } ] }  // 4 modules per topic
```

### Stage types (the course player renders exactly these)
- `read` — `{ type, title, html }` (rich HTML; `.katexish` for math lines, `.callout` boxes)
- `code` — `{ type, title, guide?/html?, code }` → live Python cell; Run executes in Pyodide
- `interactive` — `{ type, title, note, params: [{name,label,min,max,step,value}], template }`
  — template contains `{{param}}` placeholders, re-run debounced on slider input
- `quiz` — `{ type, title, prompt, choices: [..], answer: idx, hint, explain }`

`curriculum-questions.js` appends extra items with `moduleIndex` and extended
types handled by the same quiz renderer: `truefalse` (`answer: bool`),
`multi` (`answers: [idx,..]`), `numeric` (`answer`, `tolerance`),
`fillblank` (`answer` string(s)), plus more `quiz`.

### Client storage (localStorage, all guarded for Safari private mode)
- `iewt:progress` — `{ [topicId]: { done: [stageIndex, ...] } }`
- `iewt:gamify` — `{ points, streak, last }` (last = YYYY-MM-DD of last activity)
- `iewt:guideW` — persisted splitter width (% of course layout)

### D1 (schema.sql)
- `users(id "g_<google-sub>", email, name, created_at)`
- `progress(user_id, model_id, done_json, updated_at)` PK (user_id, model_id)
- `stats(user_id, points, streak, last, updated_at)`

### API (all JSON; 401 when signed out)
- `GET /api/me` → `{ user: { id, email, name } | null }`
- `GET/PUT /api/progress` → `{ progress: { [model]: { done: [] } } }` / body `{ model, done: [] }`
- `GET/PUT /api/stats` → `{ stats: { points, streak, last } }`
- Sign-in: `/auth/google` → Google → `/auth/callback` → 30-day `session` cookie; `/auth/logout`.

Points per stage type on completion: read 5, code 10, interactive 10, quiz 15.

## Worker behaviors you must preserve

1. **Never rebuild responses from an init dict.** Always
   `new Response(resp.body, resp)`. Rebuilding corrupts Content-Encoding at
   the edge → browsers get undecodable CSS/JS (this caused a full outage once).
2. **Security headers** on everything; CSP only on `text/html`. CSP allows
   `cdn.jsdelivr.net` scripts + `'unsafe-eval'`/`'wasm-unsafe-eval'` (Pyodide
   needs them) — don't tighten without testing the Lab.
3. **Crawler SEO path** (`/lab/course.html?m=X` + social/search UA regex):
   HTMLRewriter swaps title/description/canonical/og tags and appends
   per-topic `Course` + `BreadcrumbList` JSON-LD. Humans never hit this path.
4. **Caching self-heal**: HTML → `Cache-Control: no-cache` + a one-time
   `Clear-Site-Data: "cache"` (gated by `cachefix` cookie) to purge clients
   poisoned by the old encoding bug; `?v=` assets → immutable 1y; other
   assets → 1h. Keep this block last, after the API early-returns.

## Conventions

- **Cache busting**: every CSS/JS/font URL carries `?v=N` (currently
  **v=16**). If you change any asset, bump ALL `?v=` references in every
  HTML file (and the `@font-face` src urls in base.css) to N+1 — versioned
  assets are cached immutable for a year, so an unbumped change never reaches
  returning visitors.
- **JS style**: one IIFE per file, `"use strict"`, no globals except the
  deliberate `window.Lab / Auth / Gamify / FX / CURRICULUM / TOPIC_META /
  toast`. No TypeScript, no bundler, no framework.
- **Design tokens** (base.css `:root`): gold palette `--gold-mystic #af983f`,
  `--gold-harvest #da9100`, `--gold-celadon #c9c6ac`; ink tiers `--ink`,
  `--ink-dim`, `--ink-faint #8a8571` (WCAG-AA on the bg — don't darken);
  `--bg #0a0a08`. Serif = subset Latin Modern.
- **Fonts are subset.** If you need glyphs outside Latin/Greek/math operators
  (e.g. CJK, more arrows), re-subset from upstream Latin Modern — don't edit
  the woff2s. Greek β/ε and sub/superscripts intentionally render via the
  browser's fallback serif (the originals lacked them too).
- **Charts (matplotlib in Pyodide)**: Computer Modern font, gridless, figures
  are captured and shown in the guide column, styled in lab-core.
- **Accessibility invariants** (tested in CI): ≥16px inputs on touch (iOS
  zoom), 44px effective touch targets, heading outline h1→h2 without skips,
  keyboard-operable splitter (ARIA slider), `role=status` boot messages.
- **Pill nav**: tabs are equalized to the widest tab; the indicator is
  fixed-size and animates `transform` only. Don't reintroduce width morphing.

## Testing / CI

```bash
# from repo root (needs playwright-core + a Chromium binary):
cd tests && npm install --no-save playwright@1.48 && npx playwright install chromium
SITE_DIR=.. node regression.mjs        # exits 1 on any failure
```
The suite starts its own static server (port 8399) and asserts: no horizontal
overflow or console errors at 320/390/768/1440, `--ink-faint` contrast ≥ 4.5,
pill equal-width + transform-only, iOS editor ≥16px with matched overlay
metrics + pre-wrap, rapid-Next race (3 clicks → stage 4/20), heading outline.
GitHub Actions runs it on every push/PR (`regression.yml`). Keep it green.

Local preview: `python3 -m http.server 8000` from the repo root covers all
static behavior (the `/api/*` endpoints 404 → the site auto-falls back to
on-device mode). `wrangler dev` runs the full Worker if you need auth/API.

## SEO state (July 2026)

- JSON-LD: Person/WebSite/WebPage on home, CollectionPage + ItemList of 7
  `Course`s + breadcrumbs on /lab/, CollectionPage + breadcrumbs on /articles/,
  BreadcrumbList on course.html, per-topic Course injected at the edge.
- Each course topic self-canonicalizes (edge) and is listed in sitemap.xml.
- robots.txt → sitemap. lesson.html is `noindex`.
- Site is registered in Google Search Console; sitemap submitted.
- Titles: "Anıl Kaya — In Econometrics We Trust" (home), "… — Anıl Kaya"
  (sections). Keep the name in titles.

## Known pitfalls (learned the hard way)

- The Content-Encoding rule above (worker.js). Seriously.
- `.assetsignore` excludes `*.md` — putting a doc in the repo is safe, but a
  served page must not be markdown.
- Course topics ship ~150 KB of curriculum JS; it's fine — don't try to
  lazy-split it without measuring first.
- Pyodide boot takes seconds on first visit; the boot pill communicates
  progress. Don't run Python before `lab-core`'s ready promise resolves.
- All localStorage access must stay inside try/catch (Safari private mode).
- If a bug report says "site looks broken/unstyled": suspect stale client
  cache first (see the self-heal block) — verify server bytes before changing code.
