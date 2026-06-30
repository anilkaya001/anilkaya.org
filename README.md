# anilkaya.org

Personal site of **Anıl Kaya** — *In Econometrics We Trust*.

A fast, dependency-free static site served by **GitHub Pages** on the custom
domain [anilkaya.org](https://anilkaya.org), with DNS on Cloudflare.

## Stack & principles

- **No frameworks, no build step.** Hand-written semantic HTML + CSS + a single
  vanilla-JS canvas animation. Everything is same-origin, so there are no
  third-party requests on load.
- **Latin Modern** (self-hosted `woff2`, `font-display: swap`, preloaded) for all
  text — the classic LaTeX look.
- **Gold palette:** Mystic Gold `#af983f`, Harvest Gold `#da9100`,
  Celadon Gold `#c9c6ac`.
- **Accessible & efficient:** honours `prefers-reduced-motion` (static render),
  pauses the animation when the tab is hidden, and scales particle count to the
  viewport.

## Structure

```
.
├── index.html              # Landing page (animated gold field + headline)
├── 404.html                # Themed not-found page
├── CNAME                    # Custom domain (anilkaya.org)
├── robots.txt · sitemap.xml · site.webmanifest
├── assets/
│   ├── css/
│   │   ├── base.css         # Tokens, @font-face, reset, top bar, pill nav
│   │   ├── home.css         # Landing hero
│   │   ├── article.css      # Long-form reading layout
│   │   └── lab.css          # Econometrics Lab + Python IDE
│   ├── js/
│   │   ├── particles.js     # Canvas field engine
│   │   ├── auth.js          # Account scaffold (on-device now, Google later)
│   │   ├── lab-core.js      # Pyodide engine + IDE cells
│   │   ├── lessons.js       # Course content (data-driven)
│   │   └── lab-ui.js        # Lab home grid + lesson renderer + progress
│   ├── fonts/               # Latin Modern woff2 (see NOTICE.md)
│   └── img/                 # favicon.svg, etc.
├── articles/
│   ├── index.html           # Article listing
│   └── _template/           # Copy this to start a new article
└── lab/
    ├── index.html           # Lab home (model grid)
    └── lesson.html          # Generic lesson renderer (?m=<model>)
```

## Econometrics Lab

`/lab/` runs **real** econometrics in the browser via **Pyodide + statsmodels**
(CPython + NumPy/SciPy/pandas/statsmodels/matplotlib compiled to WebAssembly).
Estimation is genuine statsmodels output — not an approximation — and it runs on
the visitor's machine, so it costs nothing to serve and scales without limit.
Each lesson includes a **live Python IDE** (editable cells, Run, matplotlib
output). Progress is saved per-device in `localStorage`.

**Add a model:** append an object to `assets/js/lessons.js` (with `read` and
`code` steps) — no new HTML needed; `/lab/lesson.html?m=<id>` renders it and the
home grid picks it up automatically.

## Accounts — Phase 2 (Google sign-in) — scaffolded

The full backend is already in the repo and **inert on GitHub Pages**; it
activates when deployed to **Cloudflare Pages**:

- `functions/auth/*` — Google OAuth flow (`/auth/google`, `/auth/callback`, `/auth/logout`)
- `functions/api/me`, `functions/api/progress` — session + progress API (D1)
- `functions/_middleware.js`, `shared/session.js` — stateless signed-cookie sessions
- `schema.sql`, `wrangler.toml` — D1 database + Pages config

`auth.js` auto-detects the backend (falls back to on-device when absent), so the
site keeps working either way. **Deployment steps are in [`DEPLOY.md`](./DEPLOY.md).**

## Add an article

```bash
cp -r articles/_template articles/my-article-slug
```

1. Edit `articles/my-article-slug/index.html` — `<title>`, meta, canonical URL,
   and the `<article>` body.
2. Add a `<li>` linking to `/articles/my-article-slug/` in `articles/index.html`
   (newest first).
3. Optionally add the URL to `sitemap.xml`.

Styling is inherited automatically from `base.css` + `article.css`; you only
write content.

## Deploy

Pages publishes from the **`main`** branch (root). Any push to `main` rebuilds
and deploys automatically — usually live within a minute.
