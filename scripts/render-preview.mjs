#!/usr/bin/env node

import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const { chromium } = createRequire(path.join(ROOT, "tests/package.json"))("playwright");
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const OUT = argOf("--out", path.join(os.tmpdir(), "flows-render-preview"));
const CARDS = argOf("--cards", null);
mkdirSync(OUT, { recursive: true });

const pages = await import(path.join(ROOT, "shared/flows-pages.js"));
const CSS = ["assets/css/base.css", "assets/css/flows.css"]
  .map((f) => `<style>${readFileSync(path.join(ROOT, f), "utf8")}</style>`).join("\n");
const js = (f) => readFileSync(path.join(ROOT, "assets/js", f), "utf8");

function inline(html, scripts) {
  let out = html.replace(/<link rel="stylesheet"[^>]*>/g, "").replace("</head>", CSS + "</head>");
  for (const f of scripts) {
    out = out.replace(new RegExp(`<script src="[^"]*${f.replace(".", "\\.")}[^"]*"[^>]*></script>`),
      `<script>${js(f)}</script>`);
  }

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

  const spill = await page.evaluate(() => {
    const out = [];
    for (const svg of document.querySelectorAll("svg")) {
      const box = svg.getBoundingClientRect();
      if (!(box.width > 0)) continue;
      for (const t of svg.querySelectorAll("text")) {
        if (!(t.textContent || "").trim()) continue;
        const r = t.getBoundingClientRect();
        if (!(r.width > 0)) continue;

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

  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.screenshot({ path: file });
  await ctx.close();
  if (errs.length) failed++;
  report.push({ name, file, errors: errs.slice(0, 3), ...seen });
}

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

await shot("overview",
  inline(stubFetch(FIX.overview) +
    pages.FLOWS_PAGES.overviewPage({ username: "preview", summary: FIX.summary }),
    ["nav.js", "flows-cursor.js", "flows-ui.js", "flows-overview.js"]),
  { height: 1600, probe: () => {
      const r = [...document.querySelectorAll(".cc-region")];
      return { regions: r.length,
        regionHeights: [...new Set(r.map((x) => Math.round(x.getBoundingClientRect().height)))].length,
        tiles: document.querySelectorAll(".cc-tile").length,

        alertsSub: document.getElementById("ccAlertsSub")?.textContent.trim() || "",
        flaggedTile: [...document.querySelectorAll(".cc-tile")]
          .filter((t) => t.querySelector(".cc-tile-k")?.textContent.trim() === "Flagged windows")
          .map((t) => t.querySelector(".cc-tile-v")?.textContent.trim())[0] || "",
        tileSubs: document.querySelectorAll(".cc-tile-s").length,
        verdictNotes: document.querySelectorAll(".cc-verdict-note").length,

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

        docScroll: document.documentElement.scrollWidth <= window.innerWidth,
      }) });
}

const marketProbe = () => {
  const sizes = (sel) => {
    const kids = [...document.querySelectorAll(sel)].flatMap((g) => [...g.children]);
    const rect = (k) => k.getBoundingClientRect();

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

  return { pulse: sizes(".mk-pulse-grid"), movers: sizes("#mktMovers .mk-movers-grid"),

    pulseDrawn: [...document.querySelectorAll(".mk-pulse-grid > *")]
      .filter((c) => c.querySelector(".flows-table, .mk-tide, .mk-sea, .mk-movers")).length,
    docScroll: document.documentElement.scrollWidth <= window.innerWidth };
};

for (const [name, width, height] of
     [["market", 1440, 5600], ["market-1000", 1000, 6500], ["market-600", 600, 7400]]) {
  await shot(name,
    inline(stubFetch(FIX.market) + pages.FLOWS_PAGES.marketPage({ username: "preview" }),

      ["nav.js", "flows-market.js"]),
    { width, height, probe: marketProbe });
}

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

    await page.route("**/*", (r) => r.request().resourceType() === "document"
      ? r.fulfill({ contentType: "text/html", body: pageHTML })
      : r.fulfill({ status: 204, body: "" }));
    await page.route(/\/assets\/js\/[a-z0-9-]+\.js/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      try {
        return r.fulfill({ contentType: "text/javascript", body: js(file) });
      } catch {

        return r.fulfill({ contentType: "text/javascript", body: "" });
      }
    });

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

    await page.route(/\/assets\/img\/[A-Za-z0-9._-]+\.(svg|png|jpe?g|webp|avif)/i, (r) => {
      const file = new URL(r.request().url()).pathname.split("/").pop();
      const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      const type = ext === "svg" ? "image/svg+xml"
        : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/" + ext;
      try {
        return r.fulfill({ contentType: type, body: readFileSync(path.join(ROOT, "assets/img", file)) });
      } catch { return r.fulfill({ status: 404, body: "" }); }
    });

    const fixture = (name) => {
      try { return JSON.parse(readFileSync(path.join(CARDS, "-" + name + ".json"), "utf8")); }
      catch { return null; }
    };
    await page.addInitScript((seed) => {
      window.__fetches = 0;

      const pick = (url) => {
        const u = String(url || "");
        if (u.indexOf("/api/flows/flowalerts") >= 0) return seed.alerts;
        if (u.indexOf("/api/flows/events") >= 0) return seed.events;
        if (u.indexOf("side=short") >= 0) return seed.short;
        if (u.indexOf("/api/flows/board") >= 0) return seed.long;
        return seed.card;
      };
      window.fetch = (url) => {
        window.__fetches += 1;
        const body = pick(url);
        return Promise.resolve({ ok: true, status: 200,
          headers: { get: (h) => (String(h).toLowerCase() === "content-type"
            ? "application/json" : null) },
          json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
      };
    }, {
      card: best.c,
      alerts: fixture("flowalerts"),
      events: fixture("events"),
      long: fixture("board-long"),
      short: fixture("board-short"),
    });
    await page.goto("https://preview.test/flows/ticker/?t=" + encodeURIComponent(best.c.ticker));

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

        rows.get(top).push({ h: r.height, w: r.width, k: x.getAttribute("data-panel") });
      }
      const spread = [...rows.values()].map((rs) =>
        Math.round(Math.max(...rs.map((r) => r.h)) - Math.min(...rs.map((r) => r.h))));
      const worstRow = [...rows.values()].sort((a, b) =>
        (Math.max(...b.map((r) => r.h)) - Math.min(...b.map((r) => r.h))) -
        (Math.max(...a.map((r) => r.h)) - Math.min(...a.map((r) => r.h))))[0] || [];

      return { ticker: (document.getElementById("ftTicker") || {}).textContent || "?",
        fetches: window.__fetches || 0,
        panels: p.length,
        panelHeights: [...new Set(p.map((x) => Math.round(x.getBoundingClientRect().height)))].length,

        panelRows: rows.size,
        worstRowGapPx: spread.length ? Math.max(...spread) : 0,
        worstRowPanels: worstRow.map((r) => r.k + " " + Math.round(r.h)).join(" | "),

        voidRows: (() => {
          const g = document.querySelector(".ft-grid");
          if (!g) return "no grid";
          const cols = getComputedStyle(g).gridTemplateColumns.split(/\s+/).length;
          const gw = g.getBoundingClientRect().width;
          const short = [];
          for (const rs of rows.values()) {
            const span = rs.reduce((a, r) => a + r.w, 0);

            if (span < gw - 40) short.push(rs.map((r) => r.k).join("+") + " " +
              Math.round(span) + "/" + Math.round(gw));
          }
          return cols + "col " + (short.length ? short.join(" ; ") : "none");
        })(),

        questionsInDoc: document.querySelectorAll(".ft-panel-q").length,
        questionsDrawn: [...document.querySelectorAll(".ft-panel-q")]
          .filter((q) => q.getBoundingClientRect().width > 2).length,
        blurbsInDoc: document.querySelectorAll(".ft-group-b").length,
        blurbsDrawn: [...document.querySelectorAll(".ft-group-b")]
          .filter((b) => b.getBoundingClientRect().width > 2).length,

        barH: Math.round((document.querySelector(".ft-bar") || { getBoundingClientRect: () => ({ height: 0 }) })
          .getBoundingClientRect().height),
        barVar: (document.getElementById("ftGrid") || document.querySelector(".ft-grid"))
          ? getComputedStyle(document.getElementById("ftGrid") || document.querySelector(".ft-grid"))
            .getPropertyValue("--ft-bar-h").trim() : "",
        statusLine: (document.getElementById("ftStatus") || {}).textContent || "",

        statusBoxH: Math.round(((document.getElementById("ftStatus") || {})
          .getBoundingClientRect ? document.getElementById("ftStatus")
          .getBoundingClientRect().height : 0)),
        stations: document.querySelectorAll(".ft-station").length,

        cards: document.querySelectorAll(".ft-card").length,

        cardFigureTops: new Set([...document.querySelectorAll(".ft-card-v")]
          .map((v) => Math.round(v.getBoundingClientRect().top))).size,
        cardHeights: new Set([...document.querySelectorAll(".ft-card")]
          .map((c) => Math.round(c.getBoundingClientRect().height))).size,

        cardsDash: [...document.querySelectorAll(".ft-card-v")]
          .filter((v) => v.textContent.trim() === "\u2014").length,

        brief: document.querySelectorAll(".ft-brief-i").length,
        briefSaid: (document.getElementById("ftBriefS") || {}).textContent || "",

        briefDead: [...document.querySelectorAll(".ft-brief-a")]
          .filter((a) => !document.querySelector(a.getAttribute("href"))).length,

        related: document.querySelectorAll(".ft-rel-c").length,
        relatedSaid: (document.getElementById("ftRelS") || {}).textContent || "",

        charts: (() => {
          const drawn = [...document.querySelectorAll(".ft-panel svg, #ftGrid svg")]
            .filter((s) => s.getAttribute("aria-hidden") !== "true")
            .filter((s) => s.querySelector("path, rect, circle, line, polyline, polygon"));
          const bare = drawn.filter((s) => s.dataset.fxCursor !== "on");
          const where = (s) => {
            const p = s.closest("[data-panel]");

            return ((p && p.dataset.panel) || (s.closest("section") || {}).id || "?") +
              "." + (s.getAttribute("class") || "-");
          };

          const face = bare.filter((s) => s.dataset.fxRead === "face");
          const left = bare.filter((s) => s.dataset.fxRead !== "face");
          return { drawn: drawn.length, cursor: drawn.length - bare.length,
                   face: face.length, bare: [...new Set(left.map(where))].join(" ") };
        })(),
        cursors: document.querySelectorAll('svg[data-fx-cursor="on"]').length,

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

    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await page.screenshot({ path: path.join(OUT, "ticker.png") });

    for (const w of [360, 390, 400, 410, 420, 440, 460, 479, 480, 520, 640]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector(".ft-tab", { timeout: 15000 });
      seen["topbar" + w] = await page.evaluate(() => {
        const pill = document.querySelector(".pill");
        if (!pill) return "no pill";
        const parts = [pill, document.querySelector(".topbar__social"),
          document.querySelector(".flows-find"), document.querySelector(".topbar__tools")]
          .filter(Boolean).filter((n) => n.getBoundingClientRect().width > 0);
        const right = Math.max(...parts.map((n) => n.getBoundingClientRect().right));
        const off = [...pill.querySelectorAll("a")]
          .filter((a) => a.getBoundingClientRect().right > window.innerWidth + 1)
          .map((a) => a.textContent.trim().slice(0, 12));
        return Math.round(window.innerWidth - right) + (off.length ? " OFF:" + off.join(",") : "");
      });
    }

    await page.setViewportSize({ width: 320, height: 900 });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector(".ft-tab", { timeout: 15000 });

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
