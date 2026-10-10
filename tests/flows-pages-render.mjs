import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import { liveEntry, phaseView } from "../shared/flows-live-worker.js";
import { phaseAt, expectedNightlySession, freshHeaders } from "../shared/flows-freshness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BASELINE_FILE = path.join(HERE, "fixtures-pages-render-baseline.json");
const UPDATE = process.env.PAGES_RENDER_UPDATE === "1";
const ONLY = process.env.PAGES_RENDER_ONLY ? new RegExp(process.env.PAGES_RENDER_ONLY) : null;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };
const NOW = Date.parse("2026-08-24T15:25:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const WIDTHS = [320, 390, 1440];

const dir = mkdtempSync(path.join(tmpdir(), "flows-pages-"));
try {
  execFileSync("node", [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", path.join(dir, "p.json")], { stdio: "pipe" });
} catch (error) {
  console.error("the pipeline itself failed to run, so no page can be rendered against its emit");
  console.error(String(error.stdout || "") + String(error.stderr || ""));
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}

const emitted = (name) => {
  const flat = path.join(dir, "p-" + name.replace(":", "-") + ".json");
  if (existsSync(flat)) return JSON.parse(readFileSync(flat, "utf8"));
  const raw = path.join(dir, "p-" + name + ".json");
  return existsSync(raw) ? JSON.parse(readFileSync(raw, "utf8")) : null;
};

const liveFile = (key) => emitted("live-" + (key.startsWith("live:") ? key.slice(5) : key));

const entryFor = (payload) => {
  const f = payload && payload.fresh;
  if (!f) return null;
  return liveEntry({ readAt: Date.parse(f.readAt), session: f.session, cadenceS: f.cadenceS, source: f.source }, Date.parse(f.readAt), NOW, null);
};

const nightlyEntry = (p) => {
  if (!p) return { state: "pending", reason: "unpublished", klass: "nightly" };
  const meta = { readAt: Date.parse(p.generatedAt || p.readAt || "2026-08-24T22:00:00Z"), session: p.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
  return liveEntry(meta, meta.readAt, NOW, null);
};

const READ = {
  version: 1, status: "fallback", ticker: "NVDA", generated: false, label: "Deterministic reading", model: null, modelName: null, neurons: null, tokens: null,
  provenance: "Deterministic reading: assembled from templates over the dossier's facts.", note: null, why: "cooldown",
  fingerprint: "d1.abc", asOf: iso(NOW), session: "2026-08-24", generatedAt: null, coverage: { ok: 8, partial: 2, withheld: 2, pending: 0 },
  tags: [{ code: "dealer-pinned", label: "Dealers pinning", sentence: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", evidence: ["options.state"] }],
  sections: {
    identity: { text: "NVIDIA designs graphics processors and data-centre accelerators.", cites: [{ id: "identity.description", label: "Company description", display: "profile", asOf: iso(NOW), kind: "identity", grade: 2 }] },
    now: { text: "The last price is $127.40, +1.27% from the previous close.", cites: [{ id: "price.last", label: "Last price", display: "$127.40", asOf: iso(NOW), kind: "price", grade: 3 }] },
    drivers: [{ text: "The implied dealer state is pinned on the vendor's convention (dealers long calls, short puts).", cites: [{ id: "options.state", label: "Implied dealer state", display: "pinned", asOf: iso(NOW), kind: "options", grade: 2 }] }],
    tensions: [], watch: [], unknown: [{ text: "Fundamentals are withheld, so nothing is claimed about revenue.", missing: ["fundamentals"] }],
  },
  refused: [],
};

function answer(route, u) {
  const q = u.searchParams;
  switch (route) {
    case "board": return emitted("board-" + (q.get("side") || "long"));
    case "market": case "events": case "scoretrack": case "meta": case "flowalerts": case "pulse": case "news":
    case "political": case "unusual": case "movers": case "universe": case "regime": case "ideas": case "focus": case "roster": case "record": case "brief":
      return emitted(route) || { status: "pending" };
    case "sectors": return emitted("sector-trix") || { status: "pending", rows: [] };
    case "sector-premium": return emitted("sector-premium") || { status: "pending", sectors: [] };
    case "card": return emitted("card-" + q.get("t")) || { status: "pending" };
    case "card-x": return emitted("card-x-" + q.get("t")) || { status: "pending" };
    case "hist": return emitted("hist-" + q.get("t")) || { status: "pending" };
    case "ai-usage": return { spend: { neurons: 4200, cap: 30000, calls: 40 } };
    case "summary": return { status: "ok", scope: q.get("t") || "", summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
    case "lk": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",")) {
        const p = liveFile("live:" + k);
        keys[k] = p ? { status: "ok", payload: p, updatedAt: Date.parse(p.fresh.readAt), fresh: entryFor(p) } : { status: "pending", fresh: { state: "pending", reason: "unpublished", klass: "market" } };
      }
      return { serverNow: NOW, phase: phaseView(phaseAt(NOW, null)), keys };
    }
    case "now": {
      const keys = {};
      for (const k of String(q.get("k") || "").split(",").filter(Boolean)) {
        const id = k.startsWith("live:") ? k : "live:" + k;
        const p = liveFile(id);
        keys[id] = p ? entryFor(p) : { state: "pending", reason: "unpublished", klass: "market" };
      }
      for (const k of String(q.get("n") || "").split(",").filter(Boolean)) keys[k] = nightlyEntry(emitted(k.replace(":", "-")));
      return { serverNow: NOW, tier1: { at: iso(NOW - 120000), okAt: iso(NOW - 120000), why: null }, clock: null,
        expected: expectedNightlySession(NOW, null), phase: phaseView(phaseAt(NOW, null)), keys };
    }
    default: return null;
  }
}

const SPECS = [
  { id: "login", fn: "loginPage", url: "/flows/login/", dock: false },
  { id: "overview", fn: "overviewPage", url: "/flows/" },
  { id: "long", fn: "sidePage", args: { side: "long" }, url: "/flows/long/" },
  { id: "short", fn: "sidePage", args: { side: "short" }, url: "/flows/short/" },
  { id: "watch", fn: "watchPage", url: "/flows/watch/" },
  { id: "market", fn: "marketPage", url: "/flows/market/" },
  { id: "unusual", fn: "unusualPage", url: "/flows/unusual/" },
  { id: "events", fn: "eventsPage", url: "/flows/events/" },
  { id: "political", fn: "politicalPage", url: "/flows/political/" },
  { id: "strategy", fn: "strategyPage", url: "/flows/strategy/?t=NVDA" },
  { id: "desk", fn: "deskPage", url: "/flows/desk/" },
  { id: "ask", fn: "askPage", url: "/flows/ask/", dock: false },
  { id: "track", fn: "trackPage", url: "/flows/track/" },
  { id: "history", fn: "historyPage", url: "/flows/history/" },
  { id: "ticker", fn: "tickerPage", url: "/flows/ticker/?t=NVDA" },
];

const pageFunctions = Object.keys(PAGES.FLOWS_PAGES).filter((k) => typeof PAGES.FLOWS_PAGES[k] === "function").sort();
const covered = SPECS.map((s) => s.fn).filter((fn, i, all) => all.indexOf(fn) === i).sort();
assert.deepEqual(covered, pageFunctions, "every page function in FLOWS_PAGES is rendered by this suite");
checks++;

const RULES = {
  contrast: ["color-contrast"],
  names: ["button-name", "link-name", "input-button-name", "label", "select-name", "aria-input-field-name", "image-alt", "aria-command-name", "aria-toggle-field-name"],
  structure: ["page-has-heading-one", "heading-order", "empty-heading", "duplicate-id-aria", "aria-valid-attr", "aria-valid-attr-value", "aria-allowed-attr", "aria-required-attr", "aria-roles", "html-has-lang", "document-title"],
};

async function mount(page, html, url) {
  const asked = [];
  let inflight = 0;
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":{"code":"rt_off"}}' });
    if (u.pathname.startsWith("/api/flows/")) {
      const r = u.pathname.slice("/api/flows/".length);
      asked.push(r);
      const body = answer(r, u) || { status: "pending" };
      let headers = { "X-Server-Now": String(NOW) };
      if (body && body.generatedAt && body.sessionDate) {
        const meta = { readAt: Date.parse(body.generatedAt), session: body.sessionDate, cadenceS: 86400, source: "actions", klass: "nightly" };
        try { headers = { ...headers, ...freshHeaders(meta, NOW, null).headers, "X-Payload-Updated": String(Date.parse(body.generatedAt)) }; } catch {}
      }
      return route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
    }
    if (u.pathname.startsWith("/flows/") || u.pathname === "/") return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    return route.fulfill({ status: 404, body: "" });
  });
  const track = (r) => { if (/\/api\/flows\//.test(r.url())) inflight += r._d; };
  page.on("request", (r) => { r._d = 1; track(r); });
  page.on("requestfinished", (r) => { r._d = -1; track(r); });
  page.on("requestfailed", (r) => { r._d = -1; track(r); });
  await page.clock.install({ time: new Date(NOW) });
  await page.goto("https://example.test" + url, { waitUntil: "load" });
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }" });
  await page.waitForTimeout(400);
  let stable = 0;
  let last = -1;
  for (let i = 0; i < 160 && stable < 4; i++) {
    await page.waitForTimeout(100);
    const size = await page.evaluate(() => document.getElementsByTagName("*").length + document.body.innerText.length);
    if (inflight === 0 && size === last) stable++;
    else stable = 0;
    last = size;
  }
  return asked;
}

const measure = () => {
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(e);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const heads = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")];
  const shown = heads.filter(visible);
  let skipped = 0;
  let prev = 0;
  for (const h of shown) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) skipped++;
    prev = level;
  }
  const interactive = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]")]
    .filter((e) => visible(e) && !e.closest("[inert]") && !e.closest(".visually-hidden") && !e.disabled);
  const small = interactive.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width < 44 || r.height < 44;
  });
  const tiny = interactive.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width < 24 || r.height < 24;
  });
  return {
    h1: heads.filter((h) => h.tagName === "H1").length,
    h1Visible: shown.filter((h) => h.tagName === "H1").length,
    skippedLevels: skipped,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    targets: interactive.length,
    targetsUnder44: small.length,
    targetsUnder24: tiny.length,
    nodes: document.getElementsByTagName("*").length,
  };
};

async function axeCounts(page) {
  await page.evaluate(AXE);
  const result = await page.evaluate(async (rules) => {
    const all = [...new Set(Object.values(rules).flat())];
    const run = await window.axe.run(document, { runOnly: { type: "rule", values: all }, resultTypes: ["violations"] });
    return run.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n) => n.target.join(" ")) }));
  }, RULES);
  const byRule = Object.fromEntries(result.map((v) => [v.id, v.nodes]));
  const sum = (ids) => ids.reduce((t, id) => t + (byRule[id] || 0), 0);
  return {
    contrast: sum(RULES.contrast),
    names: sum(RULES.names),
    structure: sum(RULES.structure),
    detail: result,
  };
}

async function dockState(page, width) {
  const tab = page.locator("#askDockTab");
  if (!(await tab.count())) return { present: false };
  const tabShown = await tab.isVisible();
  const before = await page.evaluate(() => {
    const panel = document.getElementById("askDockPanel");
    return { role: panel.getAttribute("role"), hidden: panel.hidden, modal: panel.getAttribute("aria-modal") };
  });
  if (tabShown) await tab.click();
  else {
    await page.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    await page.keyboard.press("?");
  }
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => {
    const panel = document.getElementById("askDockPanel");
    const dock = document.getElementById("askDock");
    const inertIds = ["flowsMain", "fxSide", "fxBar", "fxTabs"].filter((id) => { const n = document.getElementById(id); return n && n.inert; });
    const focusable = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !e.disabled && !panel.contains(e) && !e.closest("[inert]") && getComputedStyle(e).visibility !== "hidden";
      });
    const a = document.activeElement;
    return {
      role: panel.getAttribute("role"), modal: panel.getAttribute("aria-modal"), hidden: panel.hidden, isOpen: dock.classList.contains("is-open"),
      expanded: document.getElementById("askDockTab").getAttribute("aria-expanded"), inertIds, tabbableBehind: focusable.length,
      focusInside: !!a && panel.contains(a), label: panel.getAttribute("aria-label"),
    };
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => {
    const panel = document.getElementById("askDockPanel");
    return { hidden: panel.hidden, inert: ["flowsMain", "fxSide", "fxBar", "fxTabs"].some((id) => { const n = document.getElementById(id); return n && n.inert; }),
      focusOnTab: document.activeElement === document.getElementById("askDockTab") };
  });
  return { present: true, tabShown, width, before, open, closed };
}

const RATCHET = ["contrast", "names", "structure", "overflowPx", "targetsUnder24"];
const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};
const measured = {};
const failures = [];
const notes = [];

const browser = await launch();
const started = Date.now();
try {
  for (const spec of SPECS) {
    for (const width of WIDTHS) {
      if (ONLY && !ONLY.test(`${spec.id}@${width}`)) continue;
      const coarse = width < 600;
      const ctx = await browser.newContext({
        viewport: { width, height: coarse ? 844 : 900 }, deviceScaleFactor: 1, hasTouch: coarse, isMobile: coarse, reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
      const key = `${spec.id}@${width}`;
      try {
        const html = String(PAGES[spec.fn]({ username: "anilkaya", ...(spec.args || {}) }));
        const asked = await mount(page, html, spec.url);
        const m = await page.evaluate(measure);
        const a = await axeCounts(page);
        const dock = spec.dock === false ? { present: false } : await dockState(page, width);
        measured[key] = { ...m, overflowPx: Math.max(0, m.overflowX), contrast: a.contrast, names: a.names, structure: a.structure, requests: asked.length, coarse };

        const label = `${spec.id} at ${width}px`;
        eq(m.h1, 1, `${label}: exactly one h1`);
        eq(m.skippedLevels, 0, `${label}: visible headings skip no level`);
        eq(errors.length, 0, `${label}: no uncaught page errors ${errors.join(" | ")}`);
        if (spec.dock !== false) {
          ok(dock.present, `${label}: the Ask dock is on the page`);
          if (dock.present) {
            const narrow = width < 1200;
            eq(dock.before.hidden, true, `${label}: the dock starts closed`);
            eq(dock.open.isOpen && dock.open.expanded === "true" && dock.open.hidden === false, true, `${label}: the dock opens (${dock.tabShown ? "tab" : "? key, the only opener below 768px"}) and the tab says so`);
            eq(dock.open.role, narrow ? "dialog" : "complementary", `${label}: the open dock is a ${narrow ? "dialog" : "complementary landmark"}`);
            eq(dock.open.modal, narrow ? "true" : null, `${label}: aria-modal exactly when it is a dialog`);
            ok(!!dock.open.label, `${label}: the dock has an accessible name`);
            if (narrow) {
              eq(dock.open.tabbableBehind, 0, `${label}: nothing outside the open dialog can take focus`);
              ok(dock.open.inertIds.includes("flowsMain"), `${label}: the main region is inert behind the dialog`);
              eq(dock.open.focusInside, true, `${label}: focus moved into the dialog`);
            } else {
              eq(dock.open.inertIds.length, 0, `${label}: the page stays usable beside the side panel`);
            }
            eq(dock.closed.hidden, true, `${label}: Escape closes the dock`);
            eq(dock.closed.inert, false, `${label}: closing releases the inert regions`);
            if (dock.tabShown) eq(dock.closed.focusOnTab, true, `${label}: focus returns to the Ask tab`);
          }
        }

        const base = baseline[key];
        if (!UPDATE) {
          if (!base) failures.push(`${key}: no baseline entry; run PAGES_RENDER_UPDATE=1 node flows-pages-render.mjs`);
          else {
            const metrics = coarse ? [...RATCHET, "targetsUnder44"] : RATCHET;
            for (const metric of metrics) {
              const now = measured[key][metric];
              const where = a.detail.filter((v) => (RULES[metric] || []).includes(v.id)).map((v) => ({ id: v.id, sample: v.sample }));
              if (now > base[metric]) failures.push(`${key}: ${metric} ${now} is over its baseline ${base[metric]} ${JSON.stringify(where)}`);
              else if (now < base[metric]) notes.push(`${key}: ${metric} ${now} is under its baseline ${base[metric]}; lower it with PAGES_RENDER_UPDATE=1`);
            }
          }
        }
      } catch (error) {
        failures.push(`${spec.id}@${width}: ${String(error && error.message || error).slice(0, 400)}`);
      } finally {
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
}

if (UPDATE && ONLY) {
  console.error("PAGES_RENDER_UPDATE rewrites the whole baseline and cannot be combined with PAGES_RENDER_ONLY");
  process.exit(1);
}
if (UPDATE) {
  const next = {};
  for (const [key, m] of Object.entries(measured)) {
    next[key] = { contrast: m.contrast, names: m.names, structure: m.structure, overflowPx: m.overflowPx, targetsUnder24: m.targetsUnder24, ...(m.coarse ? { targetsUnder44: m.targetsUnder44 } : {}) };
  }
  writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 1) + "\n");
  console.log(`baseline written for ${Object.keys(next).length} page and width pairs`);
} else {
  if (!ONLY) {
    ok(Object.keys(measured).length === SPECS.length * WIDTHS.length, `every page rendered at every width (${Object.keys(measured).length})`);
    const extra = Object.keys(baseline).filter((k) => !(k in measured));
    ok(extra.length === 0, `the baseline names no page that was not rendered: ${extra.join(", ")}`);
  }
}

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) {
  const rows = Object.entries(measured).map(([key, m]) => `| ${key} | ${m.h1} | ${m.skippedLevels} | ${m.overflowX} | ${m.contrast} | ${m.names} | ${m.structure} | ${m.targets} | ${m.targetsUnder44} | ${m.targetsUnder24} | ${m.nodes} |`);
  appendFileSync(summary, [
    "### flows-pages-render",
    "",
    "| page@width | h1 | skipped levels | overflow px | contrast | unnamed | structure | targets | under 44 | under 24 | nodes |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n"));
}

for (const n of notes) console.log("  improved: " + n);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`✓ flows-pages-render: ${checks} checks — ${SPECS.length} pages at ${WIDTHS.join("/")} px against the dry-run emit (${Math.round((Date.now() - started) / 1000)} s): one h1, no skipped heading level, no page error, the dock a dialog with focus and inert behind it when narrow and a landmark beside the page when wide, and the counts of contrast failures, unnamed controls, structure failures, overflow pixels and small touch targets held at their committed baseline`);
