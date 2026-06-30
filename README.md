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
│   │   ├── base.css         # Design tokens, @font-face, reset, shared type
│   │   ├── home.css         # Landing hero
│   │   └── article.css      # Long-form reading layout
│   ├── js/
│   │   └── particles.js     # Canvas field engine
│   ├── fonts/               # Latin Modern woff2 (see NOTICE.md)
│   └── img/                 # favicon.svg, etc.
└── articles/
    ├── index.html           # Article listing
    └── _template/           # Copy this to start a new article
```

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
