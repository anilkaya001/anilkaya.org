#!/usr/bin/env node
/* =============================================================
   render-preview.mjs — draw the gated pages the way a reader will
   get them, and say what came out.

   WHY THIS EXISTS, AND IT IS NOT A TEST. tests/ asserts properties;
   this renders pictures. The distinction earned its keep three
   times in one afternoon: a sparkline whose visibility depended on
   a JS listener firing, a 3px sector band that decayed from its
   first pixel and never showed its colour, and an equal-height
   rule copied onto a grid where it opened 200px of void under
   every sparse region. Every DOM probe passed all three. One of
   them asserted the third AS AN INVARIANT and scored it green.

   A COMPUTED STYLE IS EVIDENCE A RULE APPLIED, NOT THAT THE PAGE
   READS. That is the whole argument for this file.

   WHAT IT DOES NOT DO is reach the live site: this container's
   egress proxy refuses anilkaya.org, so nothing here can confirm
   what production is serving. It renders the REPOSITORY's own
   emitters and assets — the same HTML shared/flows-pages.js
   writes, the same stylesheets, the same controllers — with only
   the network answered from fixtures. That is the closest a
   sandbox gets to the live UI, and the gap is named rather than
   papered over: CI and the Cloudflare deploy check are what say a
   push actually shipped.

   USAGE
     node scripts/render-preview.mjs [--out DIR] [--cards DIR]

   `--cards` points at a directory of emitted cards, which is what
   makes the ticker page real rather than hand-written:
     node scripts/flows-pipeline.mjs --dry-run --emit /tmp/e/
     node scripts/render-preview.mjs --cards /tmp/e/

   Without it the ticker is skipped and the script says so. It
   exits non-zero if any page threw, so it can gate a push.
   ============================================================= */
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* PLAYWRIGHT LIVES UNDER tests/, AND THIS FILE DOES NOT. Node resolves
   node_modules by walking up from the IMPORTING file, so a bare
   `import "playwright"` from scripts/ finds nothing — the browser toolchain is
   a devDependency of the suite. Reaching for it explicitly is honest about
   that: this is a development tool that borrows the test rig, and it says so
   rather than asking the repository root to carry a dependency only it uses. */
const { chromium } = createRequire(path.join(ROOT, "tests/package.json"))("playwright");
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
/* THE DEFAULT IS OUTSIDE THE REPOSITORY, deliberately. A default that wrote
   PNGs into the working tree would put them in front of the next `git add -A`,
   and a screenshot is not a source file. */
const OUT = argOf("--out", path.join(os.tmpdir(), "flows-render-preview"));
const CARDS = argOf("--cards", null);
mkdirSync(OUT, { recursive: true });

const pages = await import(path.join(ROOT, "shared/flows-pages.js"));
const CSS = ["assets/css/base.css", "assets/css/flows.css"]
  .map((f) => `<style>${readFileSync(path.join(ROOT, f), "utf8")}</style>`).join("\n");
const js = (f) => readFileSync(path.join(ROOT, "assets/js", f), "utf8");

/* A page is assembled the way the Worker serves it, then its <link> and
   <script src> are swapped for the files themselves — so what renders is this
   working tree and not whatever a cache holds. */
function inline(html, scripts) {
  let out = html.replace(/<link rel="stylesheet"[^>]*>/g, "").replace("</head>", CSS + "</head>");
  for (const f of scripts) {
    out = out.replace(new RegExp(`<script src="[^"]*${f.replace(".", "\\.")}[^"]*"[^>]*></script>`),
      `<script>${js(f)}</script>`);
  }
  /* The dock's renderer is fetched on demand and is not part of any page's
     first paint; leaving the tag in would only 404 against a stub. */
  return out.replace(/<script src="[^"]*flows-dock\.js[^"]*"[^>]*><\/script>/, "");
}

const stubFetch = (map) => `<script>
const S = ${JSON.stringify(map)};
window.fetch = (u) => {
  const k = Object.keys(S).find((k) => String(u).includes(k));
  const body = k ? S[k] : { status: "pending", rows: [] };
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => "application/json" },
    json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
};
</script>`;

const FIX = JSON.parse(readFileSync(path.join(ROOT, "scripts/render-preview.fixtures.json"), "utf8"));

const browser = await chromium.launch();
let failed = 0;
const report = [];

async function shot(name, html, { width = 1440, height = 1400, settle = 2500, probe = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  /* SERVED FROM AN ORIGIN, NOT setContent, SO THAT ASSET PATHS RESOLVE.

     setContent renders on about:blank, where `url("/assets/img/...")` has no
     base to resolve against: the browser never issues the request, and the
     ground fell back to its colour with nothing reporting a thing. That is
     the same blindness the font note in the ticker block records — a preview
     that cannot load what the page loads is not previewing the page.

     IMAGES AND FONTS BOTH. The first pass routed only images, on the argument
     that serving fonts would move every measurement this file has recorded
     for these pages. It moves them TOWARD the truth: the ticker block's own
     note says CI loads the real face and this harness only ever rendered the
     fallback, which is how a font-dependent layout failed on CI and passed
     here. A number measured against a face no reader has is not a
     measurement. Once an origin exists the fonts are requested for real, so
     the choice is between serving them and logging a 404 per page. */
  await page.route(/^https:\/\/preview\.local\//, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/") return r.fulfill({ contentType: "text/html", body: html });
    const f = /^\/assets\/fonts\/([A-Za-z0-9._-]+\.(?:woff2?|ttf|otf))$/.exec(u.pathname);
    if (f) {
      try {
        return r.fulfill({
          contentType: f[1].endsWith(".woff2") ? "font/woff2" : "font/woff",
          body: readFileSync(path.join(ROOT, "assets/fonts", f[1])),
        });
      } catch { return r.fulfill({ status: 404, body: "" }); }
    }
    const m = /^\/assets\/img\/([A-Za-z0-9._-]+)$/.exec(u.pathname);
    if (m) {
      const ext = m[1].slice(m[1].lastIndexOf(".") + 1).toLowerCase();
      const type = ext === "svg" ? "image/svg+xml"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
      try {
        return r.fulfill({ contentType: type, body: readFileSync(path.join(ROOT, "assets/img", m[1])) });
      } catch { return r.fulfill({ status: 404, body: "" }); }
    }
    return r.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://preview.local/", { waitUntil: "load" });
  await page.waitForTimeout(settle);
  const seen = probe ? await page.evaluate(probe) : {};
  /* EVERY PAGE, NOT JUST THE ONE A SUITE SWEEPS: does any SVG draw text
     outside its own canvas? SVG clips silently — no overflow, no error, no
     console line — so a label that runs off the edge simply is not there and
     the drawing looks finished.

     THIS IS HERE BECAUSE THE TYPEFACE CHANGED. Setting Flows in Inter made
     every string a little wider than the mono face the rails were sized
     against, and the gamma plate's sub-line went 4px past its canvas.

     AND IT WOULD NOT HAVE CAUGHT THAT ONE — stated plainly, because a check
     whose reach is assumed is worse than no check. Verified by reverting the
     fix and re-running: these pages render ONE ticker card, and the label
     that clipped was on a different name in the corpus. What found it was
     tests/flows-card-render, which sweeps every emitted card; that suite is
     where this question is asked with real coverage.

     This is the second net, and what it covers is whatever these pages
     actually drew — every chart on the board, overview and market pages,
     which no card sweep renders at all. A width constant that was right for
     one face is wrong for the next one, and neither face announces it. */
  const spill = await page.evaluate(() => {
    const out = [];
    for (const svg of document.querySelectorAll("svg")) {
      const box = svg.getBoundingClientRect();
      if (!(box.width > 0)) continue;
      for (const t of svg.querySelectorAll("text")) {
        if (!(t.textContent || "").trim()) continue;
        const r = t.getBoundingClientRect();
        if (!(r.width > 0)) continue;
        /* 2px of slack, the same tolerance flows-card-render allows: an
           antialiased glyph edge is not an overflowing label. */
        if (r.left < box.left - 2 || r.right > box.right + 2) {
          out.push((svg.getAttribute("class") || svg.parentElement?.id || "svg") +
            ' "' + t.textContent.trim().slice(0, 32) + '" by ' +
            Math.round(Math.max(box.left - r.left, r.right - box.right)) + "px");
        }
      }
    }
    return [...new Set(out)];
  });
  if (spill.length) { seen.textSpill = spill.slice(0, 8); failed++; }
  const file = path.join(OUT, name + ".png");
  /* THE SHUTTER OPENS AT THE TOP OF THE PAGE, WHATEVER THE PROBE DID. A probe
     that focuses an element scrolls it into view, and a full-page capture that
     starts from wherever it was left renders a screenful of empty ground —
     measured, on the ticker, after the cursor drive was added there.
     `behavior: "instant"` because the section sets scroll-behavior: smooth and
     an animated scroll is still moving when the capture starts. */
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.screenshot({ path: file });
  await ctx.close();
  if (errs.length) failed++;
  report.push({ name, file, errors: errs.slice(0, 3), ...seen });
}

/* ---- the board ---- */
await shot("board-long",
  inline(stubFetch({ "board?side=long": FIX.boardLong }) +
    pages.FLOWS_PAGES.sidePage({ username: "preview", side: "long" }),
    ["nav.js", "flows-cursor.js", "flows-ui.js", "flows-board.js"]),
  { probe: () => {
      const c = [...document.querySelectorAll(".fd-card")];
      return { cards: c.length,
        heights: [...new Set(c.map((x) => Math.round(x.getBoundingClientRect().height)))].length,
        lines: [...document.querySelectorAll(".fd-sparkline")].length,
        sectors: [...document.querySelectorAll(".fd-sect")].length };
    } });

/* ---- the overview ---- */
await shot("overview",
  inline(stubFetch(FIX.overview) +
    pages.FLOWS_PAGES.overviewPage({ username: "preview", summary: FIX.summary }),
    ["nav.js", "flows-cursor.js", "flows-ui.js", "flows-overview.js"]),
  { height: 1600, probe: () => {
      const r = [...document.querySelectorAll(".cc-region")];
      return { regions: r.length,
        regionHeights: [...new Set(r.map((x) => Math.round(x.getBoundingClientRect().height)))].length,
        tiles: document.querySelectorAll(".cc-tile").length,
        /* THE TWO FACTS THE STRIP STOPPED CARRYING, read back off the page
           they moved to. The Flagged tile lost "nightly read" with the rest
           of the strip's prose, on the claim that this subtitle already
           carried the cadence — it carried only the instant, and for one
           commit the cadence was published nowhere. Rendered here so the
           claim is checked against a picture rather than repeated. */
        alertsSub: document.getElementById("ccAlertsSub")?.textContent.trim() || "",
        flaggedTile: [...document.querySelectorAll(".cc-tile")]
          .filter((t) => t.querySelector(".cc-tile-k")?.textContent.trim() === "Flagged windows")
          .map((t) => t.querySelector(".cc-tile-v")?.textContent.trim())[0] || "",
        tileSubs: document.querySelectorAll(".cc-tile-s").length,
        verdictNotes: document.querySelectorAll(".cc-verdict-note").length,
        /* EVENNESS IS MEASURED, NOT ASSERTED. The strip drew four tiles then
           three at a different width for months, and every DOM probe over it
           passed — because "the rule applied" and "the row reads even" are
           different questions. These two are rounded rect counts: 1 and 1
           means every tile is the same size, anything else names how many
           distinct sizes a reader is being shown. */
        /* One line per value, or the strip is taller than it needs to be. */
        tileValueLines: new Set([...document.querySelectorAll(".cc-tile-v")]
          .map((v) => Math.round(v.getBoundingClientRect().height
            / parseFloat(getComputedStyle(v).lineHeight)))).size,
        tileLabelTops: new Set([...document.querySelectorAll(".cc-tile-k")]
          .map((k) => Math.round(k.getBoundingClientRect().top))).size,
        tileWidths: new Set([...document.querySelectorAll(".cc-tile")]
          .map((t) => Math.round(t.getBoundingClientRect().width))).size,
        tileHeights: new Set([...document.querySelectorAll(".cc-tile")]
          .map((t) => Math.round(t.getBoundingClientRect().height))).size,
        neuronWords: document.querySelectorAll(".ak-w").length,

        /* THE SAME CHART CENSUS THE TICKER GETS, because the directive is
           about the section and not about one page. Identical rules: a
           drawing a reader is told to ignore is furniture, a drawing that
           prints its own reading declares data-fx-read="face", and whatever
           is left in `bare` is work nobody has done yet. */
        charts: (() => {
          const drawn = [...document.querySelectorAll("#flowsMain svg")]
            .filter((s) => s.getAttribute("aria-hidden") !== "true")
            .filter((s) => s.querySelector("path, rect, circle, line, polyline, polygon"));
          const bare = drawn.filter((s) => s.dataset.fxCursor !== "on");
          const left = bare.filter((s) => s.dataset.fxRead !== "face");
          const where = (s) => {
            const r = s.closest("section, .cc-region, [id]");
            return (r && (r.id || r.className) || "?") + "." +
              (s.getAttribute("class") || "-");
          };
          return { drawn: drawn.length, cursor: drawn.length - bare.length,
                   face: bare.length - left.length,
                   bare: [...new Set(left.map(where))].join(" ") };
        })(),

        /* DRIVEN, NOT COUNTED — the same check the ticker gets, and for the
           reason it earned there: a spec whose points carry empty rows or a
           label off the wrong field registers cleanly and announces nothing.
           Seventeen of these are per-row score strips built from one shared
           spec, so one sample of each KIND is the useful report rather than
           nineteen near-identical lines. */
        reads: (() => {
          const seenKind = new Set(), out = [];
          for (const s of document.querySelectorAll('svg[data-fx-cursor="on"]')) {
            const kind = s.getAttribute("class") || "-";
            if (seenKind.has(kind)) continue;
            seenKind.add(kind);
            s.focus();
            s.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
            const box = document.querySelector(".fx-read");
            out.push(kind + ": " + (box && !box.hidden ? box.textContent.trim() : "SAID NOTHING"));
            s.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          }
          return out;
        })() };
    } });

/* THE STRIP AT ITS TWO NARROWER COUNTS. The seven-column track hands the
   strip 4 columns under 1100px and 2 under 620px — counts chosen because
   they divide a row evenly and leave no short final row, which is the exact
   failure the auto-fit track produced at full width. Neither step had ever
   been rendered, and "the media query matched" is not "the row reads even":
   both are asserted the same way the wide one is, on measured rects. */
for (const [name, width] of [["overview-1000", 1000], ["overview-600", 600]]) {
  await shot(name,
    inline(stubFetch(FIX.overview) +
      pages.FLOWS_PAGES.overviewPage({ username: "preview", summary: FIX.summary }),
      ["nav.js", "flows-cursor.js", "flows-ui.js", "flows-overview.js"]),
    { width, height: 1600, probe: () => ({
        tiles: document.querySelectorAll(".cc-tile").length,
        tileValueLines: new Set([...document.querySelectorAll(".cc-tile-v")]
          .map((v) => Math.round(v.getBoundingClientRect().height
            / parseFloat(getComputedStyle(v).lineHeight)))).size,
        tileWidths: new Set([...document.querySelectorAll(".cc-tile")]
          .map((t) => Math.round(t.getBoundingClientRect().width))).size,
        /* A row's worth of tiles must be a whole row. Seven into four is
           4+3, and the short row is what made the strip ragged before — so
           the count that matters is how many DISTINCT widths the reader is
           shown, which stays 1 only if the last row's tiles are sized by the
           track rather than by what is left over. */
        docScroll: document.documentElement.scrollWidth <= window.innerWidth,
      }) });
}

/* ---- the market level ----
   THE ONE PAGE WHOSE GRIDS ARE FED BY SEVEN INDEPENDENT FEEDS. Each pulse
   card answers its own silence, so a fixture short of a feed still draws
   seven children and every count below still reads 7 — a card carrying a
   silence line and a card carrying a table are indistinguishable from a
   child count alone. The DISTINCT-SIZE counts are what separate them:
   the seven cards hold a chart, four tables and a month strip, so their
   heights are legitimately many, while their WIDTHS must collapse to the
   number of columns the track is running — 1 while the grid is one column,
   and no more than 2 where the tide and totals cards span two. Anything
   above that is a card sized by what was left over rather than by the
   track, which is the defect the .cc-strip measurements caught. */
const marketProbe = () => {
  const sizes = (sel) => {
    const kids = [...document.querySelectorAll(sel)].flatMap((g) => [...g.children]);
    const rect = (k) => k.getBoundingClientRect();
    /* DISTINCT HEIGHTS ACROSS A WHOLE GRID IS NOT AN EVENNESS READING, and
       reporting it as one nearly bought a fix this grid did not need. Seven
       cards over four rows SHOULD show four heights: `align-items: stretch`
       sizes each card to its own row, and a row holding a table is taller
       than a row holding a month strip. That is the lesson the .cc comment
       records from the other direction — `grid-auto-rows: 1fr` was copied
       onto a grid of unlike regions and opened 200px of void under the
       sparse ones.

       The question a reader actually asks is whether two cards SIDE BY SIDE
       differ. So the children are bucketed by their rounded top edge — one
       bucket per rendered row, wraps included — and what is reported is the
       worst row: how many distinct heights appear within a single row, and
       how many pixels separate the tallest from the shortest there. 1 and 0
       mean every row is internally even, whatever the grid totals. */
    const rows = new Map();
    for (const k of kids) {
      const r = rect(k), top = Math.round(r.top);
      if (!rows.has(top)) rows.set(top, []);
      rows.get(top).push(r);
    }
    const spreads = [...rows.values()].map((rs) => ({
      kinds: new Set(rs.map((r) => Math.round(r.height))).size,
      gap: Math.round(Math.max(...rs.map((r) => r.height)) - Math.min(...rs.map((r) => r.height))),
    }));
    return { children: kids.length, rows: rows.size,
      widths: new Set(kids.map((k) => Math.round(rect(k).width))).size,
      heights: new Set(kids.map((k) => Math.round(rect(k).height))).size,
      worstRowKinds: Math.max(...spreads.map((x) => x.kinds)),
      worstRowGapPx: Math.max(...spreads.map((x) => x.gap)) };
  };
  /* The extremes' grid is addressed through its panel. `.mk-movers-grid` on
     its own also matches the net-impact card's two-column split inside the
     pulse, and pooling four columns with two would report six children and a
     second width that belongs to a different track. */
  return { pulse: sizes(".mk-pulse-grid"), movers: sizes("#mktMovers .mk-movers-grid"),
    /* A silence is a card too, so the cards that actually DREW are counted
       by what only a fed card emits: a table, a chart host or the month
       strip. Seven means no feed fell back. */
    pulseDrawn: [...document.querySelectorAll(".mk-pulse-grid > *")]
      .filter((c) => c.querySelector(".flows-table, .mk-tide, .mk-sea, .mk-movers")).length,
    docScroll: document.documentElement.scrollWidth <= window.innerWidth };
};

/* THE VIEWPORT IS THE PICTURE — shot() does not capture full page — and this
   route runs 5391px at 1440, 6327 at 1000 and 7171 at 600 with the fixture
   below. A 1400px viewport would have cut every pulse card out of the PNG
   while the probe still reported all seven, which is the exact split between
   a measurement and a rendering this file exists to close. */
for (const [name, width, height] of
     [["market", 1440, 5600], ["market-1000", 1000, 6500], ["market-600", 600, 7400]]) {
  await shot(name,
    inline(stubFetch(FIX.market) + pages.FLOWS_PAGES.marketPage({ username: "preview" }),
      /* flows-ui.js is deliberately absent: the page emits no tag for it and
         the controller mirrors what it needs rather than importing it. */
      ["nav.js", "flows-market.js"]),
    { width, height, probe: marketProbe });
}

/* ---- the reader, only when real cards were emitted ---- */
if (CARDS && existsSync(CARDS)) {
  const { TICKER_PANEL_KEYS } = await import(path.join(ROOT, "shared/flows-panels.js"));
  const all = readdirSync(CARDS).filter((f) => f.startsWith("-card-"))
    .map((f) => JSON.parse(readFileSync(path.join(CARDS, f), "utf8")));
  const best = all.map((c) => ({ c, n: TICKER_PANEL_KEYS.filter((k) => c.panels && c.panels[k]).length }))
    .sort((a, b) => b.n - a.n)[0];
  if (best) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    const pageHTML = pages.FLOWS_PAGES.tickerPage({ username: "preview" });

    /* THE CATCH-ALL SERVED THE PAGE'S HTML TO THE PAGE'S OWN SCRIPT TAGS.
       a catch-all route answering with `contentType: "text/html"` replies to
       EVERY request, and
       the ticker document carries `<script src>` for nav, the panel library
       and the controller — each of which was handed the document and tried
       to parse "<!doctype html" as JavaScript. That is the three
       `SyntaxError: Unexpected token '<'` this block reported the first time
       it ever ran, and it had been sitting unvalidated because the ticker is
       skipped unless --cards is passed. A tool whose whole claim is "a
       computed style is evidence a rule applied, not that the page reads"
       does not get to ship a page that threw and call the run clean.

       Assets are now served as assets, from this working tree, so the page
       boots the way the Worker boots it. */
    /* ORDER MATTERS AND IT IS BACKWARDS FROM READING ORDER. Playwright tries
       route handlers in REVERSE registration order — the last one added is
       consulted first. With the catch-all registered last it answered every
       request before the asset handlers were reached, so each <script src>
       got a 204 with an empty body: no controller, no fetch, no card. The
       probe reported `fetches: 0`, which is the number that named this.

       (The original harness accidentally relied on the same rule: its
       flows-drawers route was registered AFTER the catch-all, which is the
       only reason that one file ever loaded.)

       So the catch-all goes FIRST and the specific handlers after it. */
    await page.route("**/*", (r) => r.request().resourceType() === "document"
      ? r.fulfill({ contentType: "text/html", body: pageHTML })
      : r.fulfill({ status: 204, body: "" }));
    await page.route(/\/assets\/js\/[a-z0-9-]+\.js/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      try {
        return r.fulfill({ contentType: "text/javascript", body: js(file) });
      } catch {
        /* A script the tree does not have is an empty body, not the document:
           an honest 200 with nothing in it fails visibly at the feature that
           needed it rather than as a parse error three frames away. */
        return r.fulfill({ contentType: "text/javascript", body: "" });
      }
    });
    /* THE WEBFONT, BECAUSE THE STICKY BAR'S HEIGHT DEPENDS ON IT.
       flows-ticker.js measures the bar and writes --ft-bar-h, which every
       panel's scroll-margin-top is built from; its own comment records that
       the identity row wraps at a different count under the fallback face and
       that the first-paint height came out 42px short. Serving no fonts meant
       this harness only ever rendered the fallback, so barH and --ft-bar-h
       agreed here (148 = 148) while CI, which loads the real face, failed
       with "panel 201, bar ends 218". A preview that cannot reproduce a
       font-dependent layout is not previewing the page a reader gets. */
    await page.route(/\/assets\/fonts\/[A-Za-z0-9._-]+\.(woff2?|ttf|otf)/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      try {
        return r.fulfill({
          contentType: file.endsWith(".woff2") ? "font/woff2" : "font/woff",
          body: readFileSync(path.join(ROOT, "assets/fonts", file)),
        });
      } catch { return r.fulfill({ status: 404, body: "" }); }
    });
    await page.route(/\/assets\/css\/[a-z0-9-]+\.css/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      try {
        return r.fulfill({ contentType: "text/css", body: readFileSync(path.join(ROOT, "assets/css", file), "utf8") });
      } catch { return r.fulfill({ contentType: "text/css", body: "" }); }
    });

    /* AND THE IMAGES, FOR THE SAME REASON THE FONTS ARE SERVED. The ground is
       now an SVG file rather than a gradient written in the stylesheet, so a
       harness that 404s it renders the FALLBACK colour and reports a page
       nobody gets — the same class of blindness the font note above records,
       and the reason the first atmosphere edit went into a token that was
       never painted without anything catching it. */
    await page.route(/\/assets\/img\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp|avif)/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      const type = ext === "svg" ? "image/svg+xml"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
      try {
        return r.fulfill({ contentType: type, body: readFileSync(path.join(ROOT, "assets/img", file)) });
      } catch { return r.fulfill({ status: 404, body: "" }); }
    });

    /* THE CARD STUB IS INSTALLED BEFORE THE CONTROLLER RUNS, not after.
       addInitScript lands in the page before any of its own script executes;
       the old page.evaluate() ran AFTER goto(), so the controller had already
       fetched, missed, and drawn its empty state — which is why the ticker
       badge read "?" on a card that is right here. */
    await page.addInitScript((card) => {
      window.__fetches = 0;
      /* HEADERS ANSWER PER NAME, NOT ONE STRING FOR ALL OF THEM. getJSON reads
         X-Payload-Updated and Numbers it; a stub that returns
         "application/json" for every header makes that NaN. It survived as
         `|| null`, but a stub that lies about one header will lie about the
         next one someone reads. */
      window.fetch = () => {
        window.__fetches += 1;
        return Promise.resolve({ ok: true, status: 200,
          headers: { get: (h) => (String(h).toLowerCase() === "content-type"
            ? "application/json" : null) },
          json: () => Promise.resolve(card), text: () => Promise.resolve(JSON.stringify(card)) });
      };
    }, best.c);
    await page.goto("https://preview.test/flows/ticker/?t=" + encodeURIComponent(best.c.ticker));
    /* WAIT FOR THE CARD, NOT FOR A CLOCK. A fixed timeout reported "Loading
       the name…" as though it were the finished page — the screenshot then
       shows a spinner and the probe numbers describe an empty grid. */
    await page.waitForFunction(
      () => { const t = document.getElementById("ftTicker");
        return !!(t && t.textContent && t.textContent.trim() && t.textContent.trim() !== "\u2014"); },
      null, { timeout: 20000 },
    ).catch(() => {});
    await page.waitForTimeout(3500);
    const seen = await page.evaluate(() => {
      const p = [...document.querySelectorAll(".ft-panel[data-panel]")];
      const rows = new Map();
      for (const x of p) {
        const r = x.getBoundingClientRect(), top = Math.round(r.top);
        if (!rows.has(top)) rows.set(top, []);
        /* THE KEY TRAVELS WITH THE RECT. A worst-gap number with no names is
           a number nobody can act on: it says this page has an uneven row and
           refuses to say which, so the next reader re-measures by hand. */
        rows.get(top).push({ h: r.height, w: r.width, k: x.getAttribute("data-panel") });
      }
      const spread = [...rows.values()].map((rs) =>
        Math.round(Math.max(...rs.map((r) => r.h)) - Math.min(...rs.map((r) => r.h))));
      const worstRow = [...rows.values()].sort((a, b) =>
        (Math.max(...b.map((r) => r.h)) - Math.min(...b.map((r) => r.h))) -
        (Math.max(...a.map((r) => r.h)) - Math.min(...a.map((r) => r.h))))[0] || [];
      /* #ftTicker, NOT .ft-tk. The badge the controller fills is an id; the
         class this probe asked for does not exist on this page, so it reported
         "?" whether the card had loaded or not — a probe that cannot tell its
         two outcomes apart. */
      return { ticker: (document.getElementById("ftTicker") || {}).textContent || "?",
        fetches: window.__fetches || 0,
        panels: p.length,
        panelHeights: [...new Set(p.map((x) => Math.round(x.getBoundingClientRect().height)))].length,
        /* The evenness question a reader actually asks, same as the Market
           and verdict-strip probes: do two panels SIDE BY SIDE differ. */
        panelRows: rows.size,
        worstRowGapPx: spread.length ? Math.max(...spread) : 0,
        worstRowPanels: worstRow.map((r) => r.k + " " + Math.round(r.h)).join(" | "),
        /* AND WHETHER A ROW IS FULL, which the gap alone cannot say: a row
           holding ONE span-2 panel in a three-column grid has a gap of zero
           and a column of void beside it. Reporting evenness without
           occupancy is how a layout gets "improved" by emptying rows. */
        voidRows: (() => {
          const g = document.querySelector(".ft-grid");
          if (!g) return "no grid";
          const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).length;
          const gw = g.getBoundingClientRect().width;
          const short = [];
          for (const rs of rows.values()) {
            const span = rs.reduce((a, r) => a + r.w, 0);
            /* 40px of slack for the column gap, so a genuinely full row is not
               reported as short by the gutter between its two panels. */
            if (span < gw - 40) short.push(rs.map((r) => r.k).join("+") + " " +
              Math.round(span) + "/" + Math.round(gw));
          }
          return cols + "col " + (short.length ? short.join(" ; ") : "none");
        })(),
        /* The two definition layers this commit stops drawing, read back off
           the page rather than asserted: both must still be in the document
           and both must be clipped out of the grid. */
        questionsInDoc: document.querySelectorAll(".ft-panel-q").length,
        questionsDrawn: [...document.querySelectorAll(".ft-panel-q")]
          .filter((q) => q.getBoundingClientRect().width > 2).length,
        blurbsInDoc: document.querySelectorAll(".ft-group-b").length,
        blurbsDrawn: [...document.querySelectorAll(".ft-group-b")]
          .filter((b) => b.getBoundingClientRect().width > 2).length,
        /* THE STICKY BAR AND THE NUMBER PANELS SCROLL AGAINST. CI failed with
           "panel 201, bar ends 218": an anchored panel landed 17px UNDER the
           bar. --ft-bar-h is written from a measurement of the bar, so the
           two disagreeing means the measurement was taken against a different
           layout than the one the reader gets. Clipping .ft-group-b out of
           flow changes that height, so this reports BOTH and their gap
           instead of leaving the cause to be reasoned about. */
        barH: Math.round((document.querySelector(".ft-bar") || { getBoundingClientRect: () => ({ height: 0 }) })
          .getBoundingClientRect().height),
        barVar: (document.getElementById("ftGrid") || document.querySelector(".ft-grid"))
          ? getComputedStyle(document.getElementById("ftGrid") || document.querySelector(".ft-grid"))
            .getPropertyValue("--ft-bar-h").trim() : "",
        statusLine: (document.getElementById("ftStatus") || {}).textContent || "",
        /* AND THE BOX IT DRAWS. Emptying the text left a bordered, padded
           element above the identity row, which reads as a region that
           failed rather than one with nothing to say. Height, not text, is
           what says whether it is gone. */
        statusBoxH: Math.round(((document.getElementById("ftStatus") || {})
          .getBoundingClientRect ? document.getElementById("ftStatus")
          .getBoundingClientRect().height : 0)),
        stations: document.querySelectorAll(".ft-station").length,

        /* ---- THE FOUR SURFACES THIS WAVE ADDED, EACH COUNTED RATHER THAN
               TRUSTED. All four are written by the controller, so "the markup
               is served" says nothing about whether a reader sees anything;
               what these report is what actually drew. ---- */

        /* Six cards, or fewer when a panel did not read — a panel that did
           not read gets no card on purpose, so this is a floor rather than a
           fixed number. A ZERO here means the strip is served and empty,
           which is the state worth seeing. */
        cards: document.querySelectorAll(".ft-card").length,
        /* ONE HEIGHT FOR EVERY FIGURE IN THE ROW, or the row reads uneven.
           A count of distinct tops: 1 means the six cards share a baseline,
           anything else names how many the reader is being shown. */
        cardFigureTops: new Set([...document.querySelectorAll(".ft-card-v")]
          .map((v) => Math.round(v.getBoundingClientRect().top))).size,
        cardHeights: new Set([...document.querySelectorAll(".ft-card")]
          .map((c) => Math.round(c.getBoundingClientRect().height))).size,
        /* A card whose figure is the em dash is a card that should not have
           been drawn: its panel read, and then it had nothing to say. */
        cardsDash: [...document.querySelectorAll(".ft-card-v")]
          .filter((v) => v.textContent.trim() === "\u2014").length,

        /* The findings index, and the denominator it states. A list with no
           denominator reads as a census, so the sentence is captured whole
           rather than counted. */
        brief: document.querySelectorAll(".ft-brief-i").length,
        briefSaid: (document.getElementById("ftBriefS") || {}).textContent || "",
        /* Every finding must be a link INTO the page; one that points at a
           panel this document does not contain is a door onto nothing. */
        briefDead: [...document.querySelectorAll(".ft-brief-a")]
          .filter((a) => !document.querySelector(a.getAttribute("href"))).length,

        /* The sector peers arrive on an idle fetch, so at this instant they
           may legitimately be absent; what must never happen is the strip
           claiming an EMPTY sector before the boards have been read. */
        related: document.querySelectorAll(".ft-rel-c").length,
        relatedSaid: (document.getElementById("ftRelS") || {}).textContent || "",

        /* THE CHARTS A READER CAN ACTUALLY INTERROGATE, AS A CENSUS RATHER
           THAN A SCORE. A bare count went from 1 to 7 in one wave, which
           tells you a wave happened and not whether it finished: 7 of 7 and
           7 of 14 print the same number. The directive is that every chart
           reads out, so the number that matters is the REMAINDER, named.

           An <svg> with no marks is furniture — a rule, a legend swatch, an
           icon — and a cursor on it would read out nothing. So the census
           counts only drawings that placed marks, and lists the panel each
           uncovered one sits in, which is the address of the work left.

           MARKS ALONE WERE NOT ENOUGH. A legend key is an <svg> holding a
           drawn line, so the first census counted the path panel's two
           swatches as charts and reported that panel short while both of its
           real drawings already read out. The discriminator is the one the
           renderers already set: a swatch carries aria-hidden, which is the
           author saying in the markup that there is nothing here to read.
           Anything a reader is told to ignore is furniture by the page's own
           account, and a cursor on it would announce a colour. */
        charts: (() => {
          const drawn = [...document.querySelectorAll(".ft-panel svg, #ftGrid svg")]
            .filter((s) => s.getAttribute("aria-hidden") !== "true")
            .filter((s) => s.querySelector("path, rect, circle, line, polyline, polygon"));
          const bare = drawn.filter((s) => s.dataset.fxCursor !== "on");
          const where = (s) => {
            const p = s.closest("[data-panel]");
            /* THE PANEL AND THE DRAWING. A panel can hold more than one chart
               — a path panel draws its delta and its premium separately — so
               naming only the panel sends the next reader to a panel whose
               other drawing already reads out, looking for a bug that is not
               there. The class is which drawing. */
            return ((p && p.dataset.panel) || (s.closest("section") || {}).id || "?") +
              "." + (s.getAttribute("class") || "-");
          };
          /* A DRAWING THAT PRINTS ITS OWN READING NEEDS NO CURSOR, AND THAT
             HAS TO BE A CLAIM THE RENDERER MAKES, NOT ONE THIS PROBE INFERS.
             Two drawings here hold ONE observation each — the score dial and
             the priced-move band — and each prints every number it encodes
             on its own face. A cursor on either would step through a list of
             one and announce a figure already on screen. The renderers say
             so with data-fx-read="face", in the open and next to the reason,
             so "every chart reads out" is checkable here instead of being a
             remembered exception. Anything left in `bare` is work. */
          const face = bare.filter((s) => s.dataset.fxRead === "face");
          const left = bare.filter((s) => s.dataset.fxRead !== "face");
          return { drawn: drawn.length, cursor: drawn.length - bare.length,
                   face: face.length, bare: [...new Set(left.map(where))].join(" ") };
        })(),
        cursors: document.querySelectorAll('svg[data-fx-cursor="on"]').length,

        /* REGISTERED IS NOT READING. The census above proves every drawing
           asked for a cursor; it cannot tell a spec that reads out from one
           whose points carry empty rows, a label off the wrong field, or a
           coordinate the search never matches — all of which register
           cleanly and announce nothing. So every cursor is DRIVEN here and
           its first reading is captured.

           BY KEYBOARD, NOT BY POINTER, and that is not merely convenient.
           Playwright's mouse is viewport-relative, so a chart below the fold
           reports nothing and looks broken; and the keyboard path is the one
           a reader without a mouse actually takes, so driving it exercises
           the live region and the arrow stepping at the same time. Focus,
           one ArrowRight, read what the page says. A cursor that announces
           an empty string is the defect this probe exists to catch. */
        reads: [...document.querySelectorAll('svg[data-fx-cursor="on"]')].map((s) => {
          s.focus();
          s.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
          const box = document.querySelector(".fx-read");
          const said = box && !box.hidden ? box.textContent.trim() : "";
          s.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          const p = s.closest("[data-panel]");
          return ((p && p.dataset.panel) || "?") + ": " + (said || "SAID NOTHING");
        }) };
    });
    /* BACK TO THE TOP BEFORE THE PICTURE, because the cursor drive above
       calls focus() sixteen times and focus() scrolls its element into view —
       the page is thousands of pixels down by this line, and the render came
       out as a screenful of empty ground. `behavior: "instant"` because the
       section sets scroll-behavior: smooth and an animated scroll is still
       moving when the shutter opens. */
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(OUT, "ticker.png") });

    /* THE PHONE-WIDTH HIT TEST, BECAUSE A TOUCH TARGET IS NOT A GEOMETRY.
       flows-ticker-contract walks a column of pixels with elementFromPoint
       and counts the rows that actually reach the tab; a declared 44px
       pseudo-element passes any rect assertion while being clipped, covered
       or scrolled out of reach. Repeated here so the failure is visible in a
       render rather than only in CI — and this version also names WHAT is at
       the point when the tab is not, which is the fact the assertion cannot
       carry and the one that identifies the cover. */
    /* RELOADED AT 320, NOT RESIZED INTO IT. The cursor drive above calls
       focus() on sixteen charts and focus() scrolls its element into view, so
       by this line the page is thousands of pixels down — and a sticky bar on
       a scrolled page reports the position it is STUCK at, which is not the
       position a reader arriving at this address would find it in. Measured:
       resizing gave the bar a top of 70 while a fresh load at the same width
       gives it its real one. The contract mounts a fresh page; so does this. */
    await page.setViewportSize({ width: 320, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".ft-tab", { timeout: 15000 });
    /* AND THE SCROLL IS RESET WITH behavior:"instant". The section sets
       scroll-behavior: smooth, so a plain scrollTo(0, 0) ANIMATES and a read
       on the next line sees the position the page is still leaving. Measured:
       it reported the bar stuck at 70 with scrollY still 9,441. */
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    seen.above = await page.evaluate(() => {
      const bar = document.getElementById("ftBar");
      const r = bar ? bar.getBoundingClientRect() : null;
      const of = (id) => { const e = document.getElementById(id);
        return e && !e.hidden ? id + " " + Math.round(e.getBoundingClientRect().height) : null; };
      const cs = bar ? getComputedStyle(bar) : {};
      return { barTop: r ? Math.round(r.top) : null, viewport: window.innerHeight,
               pos: cs.position, top: cs.top, scrollY: Math.round(window.scrollY),
               order: [...document.querySelectorAll("#flowsMain > *")]
                 .map((e) => (e.id || e.className || e.tagName) + "@" +
                   Math.round(e.getBoundingClientRect().top)).join(" "),
               stack: ["ftHero", "ftCards", "ftBrief", "ftFlags", "ftRel"].map(of)
                 .filter(Boolean).join(" | ") };
    });
    const tap = await page.evaluate(() => {
      const b = document.querySelector(".ft-tab");
      if (!b) return { box: 0, span: 0, over: "no .ft-tab in the document" };
      const r = b.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      let span = 0;
      for (let y = Math.round(r.top) - 25; y <= Math.round(r.bottom) + 25; y++) {
        if (document.elementFromPoint(cx, y) === b) span++;
      }
      const mid = document.elementFromPoint(cx, Math.round(r.top + r.height / 2));
      const name = (el) => !el ? "nothing"
        : el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
          (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).join(".") : "");
      return { box: Math.round(r.height), span,
               at: Math.round(r.top) + "," + cx,
               over: name(mid) + (mid && b.contains(mid) ? " (inside the tab)" : "") };
    });
    seen.tap = tap;
    /* THE BODY MUST NOT SCROLL SIDEWAYS, whatever scrolls inside it. The
       rail, the tab strip and the identity line are each `overflow-x: auto`
       on purpose — they are meant to run off their own edge — but the
       DOCUMENT running off its edge is a different thing and it is a bug.
       Reported with the widest offender named, since "true" alone sends the
       next reader hunting through a 26,000px page. */
    /* THE SAME TOPBAR GEOMETRY tests/regression.mjs asserts on the public
       pages, measured here because that suite cannot reach a gated route. The
       Flows bar carries MORE than the public one — the pill plus a search
       field, a sign-out and an avatar — so if the public bar is tight at
       320px this one is tighter, and nothing else would have told us. Direct
       geometry rather than scrollWidth, for the reason that suite records:
       body{overflow-x:hidden} swallows a clipped bar silently. */
    seen.topbar = await page.evaluate(() => {
      const pill = document.querySelector(".pill");
      if (!pill) return "no pill";
      const parts = [pill, document.querySelector(".topbar__social"),
        document.querySelector(".flows-find"), document.querySelector(".topbar__tools")]
        .filter(Boolean);
      const right = Math.max(...parts.map((n) => n.getBoundingClientRect().right));
      const left = Math.min(...parts.map((n) => n.getBoundingClientRect().left));
      const off = [...pill.querySelectorAll("a")]
        .filter((a) => a.getBoundingClientRect().right > window.innerWidth + 1 ||
                       a.getBoundingClientRect().left < -1)
        .map((a) => a.textContent.trim().slice(0, 12));
      return Math.round(window.innerWidth - right) + "px slack, left " + Math.round(left) +
        (off.length ? ", OFF-SCREEN: " + off.join(",") : "");
    });

    seen.wide = await page.evaluate(() => {
      const de = document.documentElement;
      if (de.scrollWidth <= de.clientWidth) return false;
      const over = [...document.querySelectorAll("#flowsMain *")]
        .map((e) => [e, Math.round(e.getBoundingClientRect().right)])
        .filter(([, r]) => r > de.clientWidth + 1)
        .sort((a, b) => b[1] - a[1])[0];
      return de.scrollWidth + " > " + de.clientWidth +
        (over ? ", widest: " + (over[0].id || over[0].className || over[0].tagName) +
          " to " + over[1] : "");
    });
    /* AND A PICTURE AT THE WIDTH THE HIT TEST IS ABOUT. The probe above
       reports a number; this is the page that number describes, which is
       where a reader would see the bar sitting below four stacked blocks
       rather than under the name it belongs to. */
    await page.screenshot({ path: path.join(OUT, "ticker-320.png") });

    await ctx.close();
    if (errs.length) failed++;
    report.push({ name: "ticker", file: path.join(OUT, "ticker.png"), errors: errs.slice(0, 3), ...seen });
  }
} else {
  report.push({ name: "ticker", skipped: "no --cards directory; run flows-pipeline.mjs --dry-run --emit first" });
}

await browser.close();
for (const r of report) {
  const { name, file, errors, skipped, ...rest } = r;
  if (skipped) { console.log(`- ${name}: SKIPPED (${skipped})`); continue; }
  console.log(`- ${name}: ${JSON.stringify(rest)}`);
  console.log(`  -> ${file}${errors && errors.length ? "\n  ERRORS: " + errors.join(" | ") : ""}`);
}
console.log(failed ? `\n${failed} page(s) threw` : "\nevery page rendered clean");
process.exit(failed ? 1 : 0);
