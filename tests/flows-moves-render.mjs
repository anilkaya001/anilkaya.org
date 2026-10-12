import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as M from "../shared/flows-moves0.js";
import { rarityText } from "../shared/flows-targets.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS } from "../server/routes/flows-pages.js";
import { HttpError } from "../server/http.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const HTML = PAGES.movesPage({ username: "test" });
const FORBID = /\b(unusual|alert|alerts|screen|rare|radar|sigma)\b/i;
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-moves.css"), "utf8");
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-moves.js"), "utf8");
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const REQUEST = "universe?cols=t,sec,chg,iv30p,ed,mcap,sig,f2,f3";

const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
ok(/^FLOWS_MOVES = "on"$/m.test(wrangler), "the switch ships on: the owner opened the Moves page to every member on 2026-10-12");

{
  const doc = HTML;
  eq((doc.match(/<h1[ >]/g) || []).length, 1, "one h1");
  ok(/<title>Flows — Moves<\/title>/.test(doc), "the title says Moves");
  ok(!FORBID.test(doc.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "")),
    "no forbidden word in the page's own text, title or description");
  const nav = /<aside class="fx-side"[\s\S]*?<\/aside>/.exec(doc)[0];
  ok(/href="\/flows\/moves\/"[^>]*aria-current="page"/.test(nav) && nav.includes(">Moves<"), "the rail names Moves on its own page");
  ok(/href="\/flows\/moves\/"/.test(PAGES.marketPage({ username: "test" })), "and every other page links it in the rail now that it is open to members");
  ok(/\/assets\/js\/flows-moves\.js\?v=\d+/.test(doc) && /\/assets\/css\/flows-moves\.css\?v=\d+/.test(doc), "the controller and the sheet are versioned");
  ok(!/flows-chart\.js/.test(doc), "no chart script: a ranked list needs none");
  for (const w of M.HEADER_SENTENCES) ok(M.wordCount(w) <= M.HEADER_WORDS_MAX, "a header sentence stays inside fourteen words: " + w);
  ok(!FORBID.test(M.HEADER_SENTENCES.join(" ")), "and uses none of the forbidden words");
  for (const w of [M.LINE, M.CAPTION, M.APART, M.GRADE_NOTE, ...M.VIEW_SENTENCES]) ok(JS.includes(JSON.stringify(w).slice(1, -1)), "the controller carries the leaf's sentence: " + w);
  ok(M.LINE === "A ranking, not a test: no error rate measured." && JS.includes(M.LINE), "the one-line statement stays");
  eq(M.VIEWS, ["field", "map", "sectors"], "the three views");
  const panes = [...doc.matchAll(/<div class="mv-pane" id="(mvPane\w+)" role="tabpanel" aria-labelledby="(mvTab\w+)"([^>]*)>/g)];
  eq(panes.map((x) => [x[1], x[2]]), [["mvPaneField", "mvTabField"], ["mvPaneMap", "mvTabMap"], ["mvPaneSectors", "mvTabSectors"]], "three tab panels, each labelled by its tab");
  eq(panes.map((x) => /\bhidden\b/.test(x[3])), [false, true, true], "Field is the default panel; the other two start hidden");
  ok(/id="mvTabs"[^>]*\bhidden\b/.test(doc), "the tab host stays hidden until the script builds it");
  ok(!COLOUR_LITERAL.test(CSS), "the sheet holds no colour literal: tokens only");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgb(1, 2, 3); }"), "and the scan catches a planted literal");
}

{
  ok(FLOWS_PAGE_SLUGS.includes("moves"), "the route table lists the page");
  const mk = (mode, owner) => {
    const rows = flowsPageRows({
      currentFlowsUser: async () => ({ username: "u" }),
      readFlowsSummary: async () => null,
      isOwner: () => owner,
    });
    const row = rows.find((r) => r.id === "flows.pages.moves");
    return row.handler({ request: new Request("https://x.test/flows/moves/"), env: mode === undefined ? {} : { FLOWS_MOVES: mode }, url: new URL("https://x.test/flows/moves/") });
  };
  const status = async (mode, owner) => { try { return (await mk(mode, owner)).status; } catch (e) { ok(e instanceof HttpError, "a refusal is an HttpError"); return e.status; } };
  eq(await status(undefined, true), 200, "unset: the owner is served");
  eq(await status(undefined, false), 404, "unset: a member gets the 404 of an unknown page");
  eq(await status("owner", false), 404, "owner: a member gets 404");
  eq(await status("on", false), 200, "on: a member is served");
  eq(await status("off", true), 404, "off: even the owner gets 404");
  eq(await status("garbage", false), 404, "an unknown value fails closed for a member");
}

const NIGHT = "2026-10-09";
const T = 1e12;
const NAMES = [
  ["UP1", 0.06, 0.30, 60, "Technology", 3 * T, 0.02, 20, 4], ["UP2", 0.045, 0.45, 60, "Technology", 1 * T, 0.015, 30, 7], ["UP3", 0.01, 0.20, 60, "Financials", 0.5 * T], ["UP4", 0.002, 0.25, null, "Technology", 0.3 * T],
  ["DN1", -0.07, 0.35, 60, "Financials", 0.8 * T, 0.03, 12, 2], ["DN2", -0.02, 0.15, 60, "Financials", 0.2 * T, 0.03, 12, 2], ["DN3", -0.005, 0.40, 60, "Technology", 0.1 * T],
  ["ZH", 0.052, 0.30, 60, "Technology", 0.12 * T, 0.01, 9, 0], ["ONE", 0.04, 0.30, 60, "Financials", 0.11 * T, 0.01, 9, 1],
  ["EV1", 0.12, 0.30, 5, "Technology", 0.4 * T], ["EV2", -0.09, 0.40, 21, "Financials", 0.15 * T], ["NOIV", 0.2, null, 60, "Utilities", 0.1 * T], ["ZIV", -0.2, 0, 60, null, 0.1 * T],
  ["HC1", 0.03, 0.30, 60, "Health Care", 0.6 * T], ["HC2", -0.01, 0.20, 60, "Health Care", 0.25 * T], ["NS1", 0.02, 0.25, 60, null, 0.05 * T], ["NC1", 0.05, 0.30, 60, "Utilities", null],
];
const universe = (names, o = {}) => {
  const sectors = [...new Set(names.map((n) => n[4]).filter(Boolean))];
  const body = {
    status: "ok", sessionDate: o.session || NIGHT, t: names.map((n) => n[0]),
    cols: { chg: names.map((n) => Math.round(n[1] * 1e4)), iv30p: names.map((n) => (n[2] === null ? null : Math.round(n[2] * 1e4))), ed: names.map((n) => n[3]),
      sig: names.map((n) => (n[6] === undefined ? null : Math.round(n[6] * 1e5))), f2: names.map((n) => (n[7] === undefined ? null : n[7])), f3: names.map((n) => (n[8] === undefined ? null : n[8])) },
    units: { chg: ["frac", 1e4], iv30p: ["frac", 1e4], ed: ["sessions", 1], sig: ["fraction", 1e5], f2: ["days per 252", 1], f3: ["days per 252", 1] },
  };
  if (!o.noSec) { body.sectors = sectors; body.sec = names.map((n) => (n[4] ? sectors.indexOf(n[4]) : null)); }
  if (!o.noCap) { body.cols.mcap = names.map((n) => (n[5] === null ? null : Math.round(n[5] / 1e8))); body.units.mcap = ["usd", 1e-8]; }
  return body;
};

const mOf = (n) => (n[2] !== null && n[2] > 0 ? M.ivDays(n[1], n[2]) : null);
const measured = (names, o = {}) => names.filter((n) => mOf(n) !== null).map((n) => ({ t: n[0], m: mOf(n), event: n[3] !== null && n[3] <= 21, sector: o.noSec ? null : n[4], cap: o.noCap ? null : n[5] }));

const expected = (names) => {
  const all = measured(names);
  const clean = all.filter((x) => !x.event);
  return {
    up: clean.filter((x) => x.m > 0).sort((a, b) => b.m - a.m).map((x) => x.t),
    down: clean.filter((x) => x.m < 0).sort((a, b) => a.m - b.m).map((x) => x.t),
    apart: all.filter((x) => x.event).sort((a, b) => Math.abs(b.m) - Math.abs(a.m)).map((x) => x.t),
    abs: clean.map((x) => Math.abs(x.m)),
    byT: Object.fromEntries(all.map((x) => [x.t, x.m])),
    rarity: Object.fromEntries(names.filter((n) => n[6] !== undefined).map((n) => {
      const k = Math.abs(n[1]) / n[6];
      const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
      return [n[0], level ? rarityText({ k: level, sigmaRef: n[6], route: "empirical", hits: level === 3 ? n[8] : n[7] }) : null];
    })),
  };
};

const med = (a) => { const s = [...a].sort((x, y) => x - y); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const sectorsExpected = (names, o = {}) => {
  const by = new Map();
  for (const x of measured(names, o).filter((y) => !y.event)) { const k = x.sector || "No sector"; by.set(k, [...(by.get(k) || []), x.m]); }
  return [...by].map(([name, ms]) => { const b = ms.filter((m) => Math.abs(m) > 2).length; return { name, n: ms.length, median: med(ms), beyond: b, share: Math.round((100 * b) / ms.length) + "%" }; });
};
const sortedSectors = (rows, key, dir) => rows.slice().sort((a, b) => (key === "name" ? (a.name < b.name ? -1 : 1) : a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * dir || (a.name < b.name ? -1 : 1));
const mapExpected = (names, o = {}) => {
  const all = measured(names, o);
  const cap = !o.noCap;
  const drawn = all.filter((x) => (cap ? x.cap > 0 : true)).map((x) => ({ ...x, w: cap ? x.cap : 1 }));
  const off = all.filter((x) => cap && !(x.cap > 0)).map((x) => x.t).sort();
  const g = new Map();
  for (const x of drawn) { const k = x.sector || "No sector"; g.set(k, { name: k, total: (g.get(k) ? g.get(k).total : 0) + x.w, items: [...(g.get(k) ? g.get(k).items : []), x] }); }
  const groups = [...g.values()].sort((a, b) => (a.name === "No sector") - (b.name === "No sector") || b.total - a.total || (a.name < b.name ? -1 : 1));
  for (const x of groups) x.items.sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1));
  return { drawn, off, groups, total: drawn.reduce((s, x) => s + x.w, 0) };
};
const signedText = (m) => M.signedIvDays(m);
const SHAPE = { up: "▲", down: "▼", flat: "◆" };
const shareText = (w, total) => { const p = (100 * w) / total; return p < 0.1 ? "<0.1%" : p.toFixed(1) + "%"; };

const FAKE_RT = `(() => { const UI = window.FlowsUI; const cbs = {};
  window.__rtFire = () => (cbs.px || []).forEach((f) => f());
  window.__strips = null;
  window.FlowsUI = Object.freeze({ ...UI, rt: { connect: () => ({ on: (k, f) => { (cbs[k] = cbs[k] || []).push(f); } }), feeds: () => Boolean(window.__strips), strips: () => window.__strips } }); })();`;

async function mount(browser, width, names, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...(opts.context || {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const asked = [];
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-rt.js") return r.fulfill({ contentType: "text/javascript", body: FAKE_RT });
    if (opts.mutate && u.pathname === "/assets/js/flows-moves.js") {
      const src = fs.readFileSync(path.join(ROOT, u.pathname), "utf8");
      assert.ok(src.includes(opts.mutate[0]), "the planted build must change the served module");
      return r.fulfill({ contentType: "text/javascript", body: src.replace(opts.mutate[0], opts.mutate[1]) });
    }
    if (u.pathname === "/assets/js/flows-moves.js" && opts.js) return r.fulfill({ contentType: "text/javascript", body: opts.js });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      asked.push(u.pathname.slice(11) + u.search);
      if (u.pathname === "/api/flows/universe") return r.fulfill({ contentType: "application/json", status: opts.status || 200, body: JSON.stringify(opts.body || universe(names, opts)) });
      return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/moves/" + (opts.hash || ""));
  await page.waitForFunction(() => /Ranked|could not|not published|No name/.test(document.getElementById("mvStatus").textContent), null, { timeout: 15000 });
  return { ctx, page, errors, asked };
}

const read = (page) => page.evaluate(() => {
  const col = (id) => Array.from(document.querySelectorAll("#" + id + " .mv-row"), (r) => ({
    t: r.querySelector(".mv-t").textContent, m: r.querySelector(".mv-m").textContent, c: r.querySelector(".mv-c").textContent,
    n: r.querySelector(".mv-n") ? r.querySelector(".mv-n").textContent : null,
    r: r.querySelector(".mv-r") ? r.querySelector(".mv-r").textContent : null,
  }));
  return { up: col("mvUp"), down: col("mvDown"), apart: col("mvApart"), line: document.getElementById("mvLine").textContent, ctx: document.getElementById("mvCtx").textContent,
    text: document.getElementById("flowsMain").innerText, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    heads: Array.from(document.querySelectorAll("h1,h2,h3"), (h) => h.tagName) };
});

const viewState = (page) => page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('#mvTabs [role="tab"]'));
  return {
    list: document.querySelector("#mvTabs [role=tablist]") ? document.querySelector("#mvTabs [role=tablist]").getAttribute("aria-label") : null,
    tabs: tabs.map((b) => ({ id: b.id, label: b.textContent, sel: b.getAttribute("aria-selected"), tab: b.tabIndex, ctl: b.getAttribute("aria-controls"), focus: document.activeElement === b })),
    panes: ["mvPaneField", "mvPaneMap", "mvPaneSectors"].map((id) => { const p = document.getElementById(id); return { id, hidden: p.hidden, role: p.getAttribute("role"), by: p.getAttribute("aria-labelledby") }; }),
    hash: location.hash,
  };
});
const waitView = (page, view) => page.waitForFunction((v) => location.hash === "#view=" + v && !document.getElementById("mvPane" + v[0].toUpperCase() + v.slice(1)).hidden, view, { timeout: 8000 });

const settled = (page) => page.waitForFunction(() => {
  const cv = document.querySelector(".mv-map");
  if (!cv) return false;
  const w = cv.getBoundingClientRect().width;
  const r = Math.max(0, ...Array.from(document.querySelectorAll(".mv-tile"), (t) => t.getBoundingClientRect().right)) - cv.getBoundingClientRect().left;
  return w > 0 && Math.abs(r - w) < 0.6;
});
const readMap = async (page) => {
  try { await settled(page); } catch (e) {
    console.log(JSON.stringify(await page.evaluate(() => { const cv = document.querySelector(".mv-map"); const r = cv.getBoundingClientRect(); return { w: r.width, h: r.height, n: document.querySelectorAll(".mv-tile").length, right: Math.max(...Array.from(document.querySelectorAll(".mv-tile"), (t) => t.getBoundingClientRect().right)) - r.left, narrow: document.getElementById("mvPaneMap").dataset.narrow }; })));
    throw e;
  }
  return readMapNow(page);
};
const readMapNow = (page) => page.evaluate(() => {
  const cv = document.querySelector(".mv-map");
  const cr = cv.getBoundingClientRect();
  const rel = (r) => ({ x: r.x - cr.x, y: r.y - cr.y, w: r.width, h: r.height });
  const tiles = Array.from(document.querySelectorAll(".mv-tile"), (a) => {
    const v = a.querySelector(".mv-tl-v"), t = a.querySelector(".mv-tl-t");
    return { t: a.dataset.t, dir: a.dataset.dir, step: a.dataset.step, event: a.hasAttribute("data-event"), href: a.getAttribute("href"), ...rel(a.getBoundingClientRect()),
      label: v ? v.textContent : null, tick: t ? t.textContent : null, bg: getComputedStyle(a).backgroundColor, fg: v ? getComputedStyle(v).color : null,
      text: v ? [rel(v.getBoundingClientRect()), rel(t.getBoundingClientRect())] : [], tabbable: a.getAttribute("tabindex") !== "-1" };
  });
  const groups = Array.from(document.querySelectorAll(".mv-grp"), (g) => { const l = g.querySelector(".mv-grp-l"); return { name: g.dataset.sector, ...rel(g.getBoundingClientRect()), pill: l ? rel(l.getBoundingClientRect()) : null }; });
  return { cw: cr.width, ch: cr.height, tiles, groups,
    sentence: document.querySelector("#mvMap .mv-sentence").textContent, notes: Array.from(document.querySelectorAll("#mvMap .mv-note"), (n) => n.textContent),
    legend: Array.from(document.querySelectorAll("#mvMap .mv-leg-i"), (i) => i.textContent), text: document.getElementById("mvMap").textContent };
});

const readTable = (page) => page.evaluate(() => Array.from(document.querySelectorAll("#mvMap .mv-map-t tbody tr"), (r) => ({
  t: r.querySelector(".mv-t").textContent, ev: Boolean(r.querySelector(".mv-ev")), sector: r.querySelector(".mv-c-sec").textContent, m: r.querySelector(".mv-c-m").textContent.trim(), area: r.querySelector(".mv-c-a").textContent,
})));

const readSectors = (page) => page.evaluate(() => ({
  rows: Array.from(document.querySelectorAll("#mvSectors tbody tr"), (r) => ({
    name: r.querySelector(".mv-sn").textContent, sub: r.querySelector(".mv-sub").textContent, n: r.querySelector('[data-k="n"]').textContent,
    median: r.querySelector('[data-k="median"] .mv-mv').textContent.trim(), glyph: r.querySelector('[data-k="median"] .mv-g').textContent,
    barDir: r.querySelector(".mv-bar").dataset.dir, barW: r.querySelector(".mv-bar").style.getPropertyValue("--w"), beyond: r.querySelector('[data-k="beyond"]').textContent, share: r.querySelector('[data-k="share"]').textContent })),
  sort: Array.from(document.querySelectorAll("#mvSectors thead th"), (h) => h.getAttribute("aria-sort")),
  scale: document.querySelector("#mvSectors .mv-scale").textContent, sentence: document.querySelector("#mvSectors .mv-sentence").textContent,
  notes: Array.from(document.querySelectorAll("#mvSectors .mv-note"), (n) => n.textContent), text: document.getElementById("mvSectors").textContent,
  narrow: document.getElementById("mvPaneSectors").dataset.narrow, namesShown: getComputedStyle(document.querySelector("#mvSectors thead th.mv-c-names")).display !== "none",
  scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
}));

const lum = (rgb) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); };
const parseColour = (s) => {
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) return m[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(Number);
  const c = /^color\(srgb ([^)]+)\)$/.exec(s);
  if (c) return c[1].split(/\s+/).slice(0, 3).map((x) => Number(x) * 255);
  return null;
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function exercise(browser, names, jsOverride) {
  const bad = [];
  const chk = (c, m) => { checks++; if (!c) bad.push(m); };
  const { ctx, page, errors } = await mount(browser, 1440, names, { js: jsOverride, context: { reducedMotion: "reduce" } });
  page.setDefaultTimeout(4000);
  const vs = await viewState(page);
  chk(vs.list === "View" && vs.tabs.map((t) => t.label).join() === "Field,Map,Sectors", "a tablist of three tabs");
  chk(vs.tabs.filter((t) => t.sel === "true").length === 1 && vs.tabs[0].sel === "true", "Field is selected by default");
  chk(vs.tabs.map((t) => t.tab).join() === "0,-1,-1", "roving tabindex");
  chk(vs.tabs.every((t, i) => t.ctl === ["mvPaneField", "mvPaneMap", "mvPaneSectors"][i] && vs.panes[i].by === t.id && vs.panes[i].role === "tabpanel"), "tabs and panels point at each other");
  chk(vs.panes.map((p) => p.hidden).join() === "false,true,true" && vs.hash === "", "only Field shows and the URL is untouched on load");

  await page.focus("#mvTabField");
  const step = async (key, view, label) => {
    await page.keyboard.press(key);
    try { await waitView(page, view); } catch { bad.push(label + ": no switch to " + view); return; }
    const s = await viewState(page);
    chk(s.tabs.find((t) => t.sel === "true").label.toLowerCase() === view && s.tabs.find((t) => t.focus) && s.tabs.find((t) => t.focus).label.toLowerCase() === view, label + ": the tab is selected and focused");
    chk(s.panes.filter((p) => !p.hidden).length === 1, label + ": one panel shows");
  };
  await step("ArrowRight", "map", "ArrowRight");
  await step("ArrowRight", "sectors", "ArrowRight");
  await step("ArrowRight", "field", "wrap forward");
  await step("ArrowLeft", "sectors", "wrap back");
  await step("Home", "field", "Home");
  await step("End", "sectors", "End");

  const secExp = sectorsExpected(names);
  let sr = await readSectors(page);
  {
    const want = sortedSectors(secExp, "median", -1);
    chk(JSON.stringify(sr.rows.map((r) => r.name)) === JSON.stringify(want.map((r) => r.name)), "sectors default to median, largest first");
    for (const w of want) {
      const r = sr.rows.find((x) => x.name === w.name);
      if (!r) { chk(false, "sector row " + w.name); continue; }
      chk(r.n === String(w.n) && r.beyond === String(w.beyond) && r.share === w.share, w.name + ": names, beyond 2 and share equal the independent count");
      chk(r.median === SHAPE[M.dirOf(w.median)] + " " + signedText(w.median) && r.glyph === SHAPE[M.dirOf(w.median)] && r.barDir === M.dirOf(w.median), w.name + ": the median prints its sign and shape and the bar leans its way");
    }
    const top = Math.max(...secExp.map((x) => Math.abs(x.median)));
    const scale = Math.max(0.5, Math.ceil(top * 2) / 2);
    chk(sr.scale.includes(signedText(-scale) + " to " + signedText(scale)), "the bar scale is stated");
    for (const w of want) { const r = sr.rows.find((x) => x.name === w.name); if (r) chk(near(parseFloat(r.barW), (Math.abs(w.median) / scale) * 50, 1e-6), w.name + ": the bar is the median on the stated scale"); }
    chk(sr.sort.join() === "none,none,descending,none,none", "the median column says descending");
  }
  await page.focus("#mvSectors thead th:nth-child(1) button");
  await page.keyboard.press("Enter");
  sr = await readSectors(page);
  chk(JSON.stringify(sr.rows.map((r) => r.name)) === JSON.stringify(sortedSectors(secExp, "name", 1).map((r) => r.name)) && sr.sort[0] === "ascending", "Enter on the Sector header sorts by name ascending and says so");
  chk(await page.evaluate(() => document.activeElement.className === "mv-sort" && document.activeElement.textContent === "Sector"), "focus stays on the header button");
  await page.keyboard.press("Space");
  sr = await readSectors(page);
  chk(sr.sort[0] === "descending" && sr.rows[0].name === sortedSectors(secExp, "name", -1)[0].name, "Space flips it");
  await page.focus("#mvSectors thead th:nth-child(4) button");
  await page.keyboard.press("Enter");
  sr = await readSectors(page);
  chk(JSON.stringify(sr.rows.map((r) => r.beyond)) === JSON.stringify(sortedSectors(secExp, "beyond", -1).map((r) => String(r.beyond))), "the beyond-2 column sorts by count, largest first");
  chk(!FORBID.test(sr.text) && [sr.sentence, ...sr.notes].every((x) => M.wordCount(x) <= 14), "the sectors copy is short and clean");

  await page.focus("#mvTabSectors");
  await page.keyboard.press("ArrowLeft");
  await waitView(page, "map");
  const me = mapExpected(names);
  const mp = await readMap(page);
  chk(mp.sentence === M.MAP_CAP_LINE, "the map says its area is market cap");
  chk(JSON.stringify(mp.tiles.map((x) => x.t).sort()) === JSON.stringify(me.drawn.map((x) => x.t).sort()), "a tile for every measured name with a market cap, no other");
  const byT = Object.fromEntries(me.drawn.map((x) => [x.t, x]));
  let sumArea = 0, label = 0;
  for (const t of mp.tiles) {
    const e = byT[t.t];
    if (!e) continue;
    const area = t.w * t.h;
    sumArea += area;
    chk(Math.abs(area - (e.w / me.total) * mp.cw * mp.ch) <= 0.01 * (e.w / me.total) * mp.cw * mp.ch + 1, t.t + ": tile area is its share of market cap");
    chk(t.dir === M.dirOf(e.m) && t.step === String(M.stepOf(e.m)) && t.event === e.event && t.href === "/flows/ticker/?t=" + t.t, t.t + ": direction, colour step, event outline and link");
    if (t.label !== null) { label++; chk(t.label === SHAPE[t.dir] + " " + signedText(e.m) && t.tick === t.t, t.t + ": a labelled tile prints its shape and its sign"); chk(t.tabbable, t.t + ": a labelled tile is a tab stop"); }
    else chk(!t.tabbable, t.t + ": an unlabelled tile is out of the tab order");
  }
  chk(label >= 4, "the big tiles carry labels");
  chk(near(sumArea, mp.cw * mp.ch, 0.002 * mp.cw * mp.ch), "the tiles fill the map " + sumArea + " vs " + mp.cw * mp.ch);
  for (const a of mp.tiles) {
    chk(a.x >= -0.5 && a.y >= -0.5 && a.x + a.w <= mp.cw + 0.5 && a.y + a.h <= mp.ch + 0.5, a.t + ": inside the map");
    for (const b of mp.tiles) if (a.t < b.t) chk(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5, a.t + " and " + b.t + " do not overlap");
  }
  chk(JSON.stringify(mp.groups.map((g) => g.name)) === JSON.stringify(me.groups.map((g) => g.name)), "sector blocks run by market cap, No sector last");
  for (const g of mp.groups) {
    const e = me.groups.find((x) => x.name === g.name);
    if (e) chk(near(g.w * g.h, (e.total / me.total) * mp.cw * mp.ch, 0.01 * mp.cw * mp.ch * (e.total / me.total) + 1), g.name + ": block area is its share of market cap");
    if (g.pill) for (const t of mp.tiles) for (const r of t.text) chk(g.pill.x + g.pill.w <= r.x || r.x + r.w <= g.pill.x || g.pill.y + g.pill.h <= r.y || r.y + r.h <= g.pill.y, g.name + " label clears " + t.t);
  }
  chk(mp.legend.length === 10 && mp.legend.some((x) => x.includes("−3 or more")) && mp.legend.some((x) => x.includes("+3 or more")) && mp.legend.slice(0, 4).every((x) => x.includes("▼")) && mp.legend.slice(5, 9).every((x) => x.includes("▲")), "the key prints signs and shapes");
  chk(mp.notes.some((n) => n.startsWith("1 name has no market cap")) && mp.notes.some((n) => /^\d+ names? ha(s|ve) no usable prior-close IV/.test(n)), "names left off the map are counted");
  chk(!FORBID.test(mp.text) && mp.notes.every((x) => M.wordCount(x) <= 14), "the map copy is clean");
  const rgbOf = (t) => parseColour(t.bg);
  const colours = mp.tiles.filter((t) => rgbOf(t));
  const up = colours.filter((t) => t.dir === "up" && t.step !== "0").map((t) => t.bg), dn = colours.filter((t) => t.dir === "down" && t.step !== "0").map((t) => t.bg);
  chk(up.length > 0 && dn.length > 0 && !up.some((c) => dn.includes(c)), "rising and falling tiles never share a fill");
  for (const t of mp.tiles.filter((x) => x.fg && parseColour(x.bg) && parseColour(x.fg))) chk(contrast(parseColour(t.bg), parseColour(t.fg)) >= 4.5, t.t + ": label text reaches 4.5:1");
  for (const dir of ["up", "down"]) {
    const steps = new Map(mp.tiles.filter((t) => t.dir === dir && t.step !== "0").map((t) => [t.step, t.bg]));
    chk(new Set(steps.values()).size === steps.size, dir + ": each colour step has its own fill");
  }
  await page.click(".mv-alt > summary");
  await page.waitForSelector("#mvMap .mv-map-t tbody tr");
  const rows = await readTable(page);
  const wantRows = [...me.groups.flatMap((g) => g.items.map((x) => ({ t: x.t, ev: x.event, sector: g.name, m: SHAPE[M.dirOf(x.m)] + " " + signedText(x.m), area: shareText(x.w, me.total) }))), ...me.off.map((t) => { const x = measured(names).find((y) => y.t === t); return { t, ev: x.event, sector: x.sector || "No sector", m: SHAPE[M.dirOf(x.m)] + " " + signedText(x.m), area: "—" }; })];
  chk(JSON.stringify(rows) === JSON.stringify(wantRows), "the table lists every name in map order with its sector, sign and area share");

  const wasHash = await page.evaluate(() => location.hash);
  chk(wasHash === "#view=map", "the URL carries the view");
  await page.goto("https://example.test/flows/moves/?r=1#view=sectors");
  await page.waitForFunction(() => /Ranked/.test(document.getElementById("mvStatus").textContent));
  const rs = await viewState(page);
  chk(rs.tabs[2].sel === "true" && !rs.panes[2].hidden && rs.panes[0].hidden, "a loaded #view=sectors opens Sectors");
  await page.goto("https://example.test/flows/moves/?r=2#view=nonsense");
  await page.waitForFunction(() => /Ranked/.test(document.getElementById("mvStatus").textContent));
  chk((await viewState(page)).tabs[0].sel === "true", "an unknown view falls back to Field");
  await page.evaluate(() => { location.hash = "#view=map"; });
  await page.waitForFunction(() => !document.getElementById("mvPaneMap").hidden);
  chk((await viewState(page)).tabs[1].sel === "true", "a hash change switches the view");
  chk(errors.length === 0, "no page error: " + errors.join("; "));
  await ctx.close();
  return bad;
}

const browser = await launch();
const exp = expected(NAMES);

for (const width of [1440, 390, 320]) {
  const { ctx, page, errors, asked } = await mount(browser, width, NAMES);
  const got = await read(page);
  eq(got.up.map((x) => x.t), exp.up, `${width}: risers are ranked by IV-days, largest first, from the definition worked independently`);
  eq(got.down.map((x) => x.t), exp.down, `${width}: fallers likewise, most negative first`);
  eq(got.apart.map((x) => x.t), exp.apart, `${width}: names with earnings inside 21 sessions are ranked apart, not in the lists`);
  ok(!got.up.concat(got.down).some((x) => ["NOIV", "ZIV", "EV1", "EV2"].includes(x.t)), `${width}: no iv30p, zero iv30p, or event name in the clean lists`);
  for (const x of got.up.concat(got.down)) {
    const want = M.signedIvDays(exp.byT[x.t]);
    eq(x.m, want + " IV-days", `${width}: ${x.t} prints its move in IV-days`);
    const k = exp.abs.filter((a) => a >= Math.abs(exp.byT[x.t])).length;
    eq(x.n, `${k} of ${exp.abs.length} names this far out today`, `${width}: ${x.t} prints how many names today were as far out, a count and not a probability`);
  }
  ok(got.apart.every((x) => x.n === null && x.r === null), `${width}: the event names print no cross-section count and no rarity`);
  let rarities = 0;
  for (const x of got.up.concat(got.down)) {
    eq(x.r, exp.rarity[x.t] === undefined ? null : exp.rarity[x.t], `${width}: ${x.t} prints the rarity the reader rule gives, or nothing when the published scale or the multiple is missing`);
    if (x.r !== null) rarities++;
  }
  ok(rarities >= 5, `${width}: at least five rows print a rarity (${rarities})`);
  ok(got.up.find((x) => x.t === "ZH").r.includes("rarer than 1 in 250") && got.up.find((x) => x.t === "ZH").r.includes("at 95%"), `${width}: a zero count is floored at 1 in 250 and says so`);
  ok(got.up.find((x) => x.t === "ONE").r.includes("rarer than 1 in 250 sessions") && !/about 1 in 252/.test(got.text), `${width}: the empirical route is floored at 1 in 250, never printed past it`);
  ok(got.down.find((x) => x.t === "DN2").r === null && got.up.find((x) => x.t === "UP3").r === null, `${width}: a sub-2x move or a name with no published scale prints no rarity`);
  ok(!/\bsigma\b/i.test(got.text) && !/probab|chance/i.test(got.text), `${width}: no sigma wording and no probability claim`);
  ok(got.line.includes(M.LINE) && got.line.includes(M.CAPTION), `${width}: the one-line statement and the IV caption are printed`);
  ok(got.ctx.includes("Nightly, session " + NIGHT) && got.ctx.includes("Median |m|") && got.ctx.includes("beyond 3"), `${width}: the context line names the population and the session`);
  ok(!FORBID.test(got.text), `${width}: no forbidden word in the rendered text`);
  eq(got.heads.filter((h) => h === "H1").length, 1, `${width}: one h1`);
  ok(got.scrollW <= got.innerW, `${width}: no horizontal overflow (${got.scrollW} <= ${got.innerW})`);
  eq(asked, [REQUEST], `${width}: exactly one data request, the existing universe read with the market-cap column, no new payload`);
  eq(errors, [], `${width}: no page error`);
  await ctx.close();
}

{
  const problems = await exercise(browser, NAMES);
  eq(problems, [], "the tabs, the map, the table and the sectors view all hold at 1440 px");
}

for (const width of [768, 390, 320]) {
  for (const view of ["map", "sectors"]) {
    const { ctx, page, errors } = await mount(browser, width, NAMES, { hash: "#view=" + view });
    const g = await read(page);
    ok(g.scrollW <= g.innerW, `${width} ${view}: no horizontal overflow (${g.scrollW} <= ${g.innerW})`);
    eq(errors, [], `${width} ${view}: no page error`);
    if (view === "map") {
      const shown = await page.evaluate(() => ({ map: getComputedStyle(document.querySelector(".mv-map")).display, tiles: document.querySelectorAll(".mv-tile").length, open: document.querySelector(".mv-alt").open, rows: document.querySelectorAll("#mvMap .mv-map-t tbody tr").length, key: getComputedStyle(document.querySelector(".mv-leg")).display }));
      if (width >= M.NARROW_PX) ok(shown.map !== "none" && shown.tiles === mapExpected(NAMES).drawn.length && !shown.open, `${width}: wide enough, the map is drawn and the table waits behind its summary`);
      else {
        eq([shown.map, shown.tiles, shown.open, shown.key], ["none", 0, true, "none"], `${width}: under 640 px the map gives way to the list`);
        eq(shown.rows, mapExpected(NAMES).drawn.length + mapExpected(NAMES).off.length, `${width}: and the list holds every name`);
      }
    } else {
      const sr = await readSectors(page);
      const want = sortedSectors(sectorsExpected(NAMES), "median", -1);
      eq(sr.rows.map((r) => [r.name, r.n, r.beyond, r.share]), want.map((r) => [r.name, String(r.n), String(r.beyond), r.share]), `${width}: the sector rows`);
      if (width < M.NARROW_PX) ok(sr.narrow === "1" && !sr.namesShown && sr.rows.every((r, i) => r.sub === want[i].n + (want[i].n === 1 ? " name" : " names")), `${width}: the Names column folds under the sector name`);
    }
    await ctx.close();
  }
}

{
  const { ctx, page } = await mount(browser, 390, NAMES, { hash: "#view=sectors", context: { hasTouch: true, isMobile: true } });
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#mvTabs [role="tab"], #mvSectors th:not(.mv-c-names) .mv-sort')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent, Math.round(r.height)]; }));
  ok(sizes.length === 7 && sizes.every(([, hgt]) => hgt >= 44), "tabs and sort buttons reach 44 px on a coarse pointer: " + JSON.stringify(sizes));
  await page.click("#mvTabMap");
  await page.waitForSelector("#mvMap .mv-map-t tbody tr");
  const links = await page.evaluate(() => [...document.querySelectorAll("#mvMap .mv-map-t .mv-t")].slice(0, 6).map((a) => Math.round(a.getBoundingClientRect().height)));
  ok(links.length === 6 && links.every((x) => x >= 44), "table links reach 44 px on a coarse pointer");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES, { context: { reducedMotion: "reduce" }, hash: "#view=map" });
  const moving = await page.evaluate(() => [...document.querySelectorAll(".mv-tile, .mv-bar, .mv-map")].every((e) => { const c = getComputedStyle(e); return parseFloat(c.transitionDuration) === 0 && (c.animationName === "none" || parseFloat(c.animationDuration) === 0); }));
  ok(moving, "the map has no transition or animation under reduced motion");
  await page.focus("#mvTabMap");
  await page.keyboard.press("ArrowRight");
  ok((await viewState(page)).tabs[2].sel === "true", "and a tab switch under reduced motion is immediate");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES, { noCap: true, hash: "#view=map" });
  const mp = await readMap(page);
  const drawn = measured(NAMES).length;
  eq(mp.tiles.length, drawn, "with no market-cap column every measured name is a tile");
  eq(mp.sentence, M.MAP_EQUAL_LINE, "and the sentence says every tile has the same area");
  const areas = mp.tiles.map((t) => t.w * t.h);
  ok(areas.every((a) => near(a, mp.cw * mp.ch / drawn, 0.01 * mp.cw * mp.ch / drawn + 1)), "tiles share the map equally");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES, { noSec: true, hash: "#view=sectors" });
  const sr = await readSectors(page);
  eq(sr.rows.map((r) => [r.name, r.n]), [["No sector", String(measured(NAMES).filter((x) => !x.event).length)]], "with no sector column every name is under No sector");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES, { hash: "#view=map" });
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { UP1: [10, -0.06, 0.30], UP2: [10, 0.045, 0.45], DN1: [10, -0.07, 0.35], LIVE9: [10, 0.05, 0.25] } };
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  const mp = await readMap(page);
  eq(mp.tiles.map((t) => t.t).sort(), ["DN1", "UP1", "UP2"], "a newer live roster redraws the map from the live names, with sector and cap taken from the nightly; a name the nightly lacks has no cap and stays off");
  eq(mp.tiles.find((t) => t.t === "UP1").dir, "down", "and the live move sets the direction");
  await page.click("#mvTabSectors");
  await page.waitForFunction(() => !document.getElementById("mvPaneSectors").hidden);
  const sr = await readSectors(page);
  const live = [["UP1", -0.06, 0.30, 60, "Technology"], ["UP2", 0.045, 0.45, 60, "Technology"], ["DN1", -0.07, 0.35, 60, "Financials"], ["LIVE9", 0.05, 0.25, null, null]];
  eq(sr.rows.map((r) => [r.name, r.n, r.beyond]).sort(), sectorsExpected(live).map((r) => [r.name, String(r.n), String(r.beyond)]).sort(), "and the sectors view counts the live roster");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES, { hash: "#view=map" });
  await page.hover(".mv-map");
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { UP1: [10, -0.06, 0.30] } };
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  eq((await readMap(page)).tiles.length, mapExpected(NAMES).drawn.length, "the map is held while the pointer is on it");
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => document.querySelectorAll(".mv-tile").length === 1);
  ok(true, "and applies the waiting arrival when the pointer leaves");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES);
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { LIVE1: [10, 0.05, 0.25], LIVE2: [10, -0.01, 0.2], EV1: [10, 0.5, 0.3], UP1: [10, 0.03, null] } };
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  let got = await read(page);
  eq(got.up.map((x) => x.t), ["LIVE1"], "a newer live session replaces the population with the live roster alone");
  ok(got.ctx.includes("Live roster, session 2026-10-12"), "and the context line says so");
  eq(got.apart.map((x) => x.t), ["EV1"], "an earnings name stays apart on the live roster, its event flag taken from the nightly");
  ok(!got.up.concat(got.down).some((x) => x.t === "UP1"), "a live row without iv30p is absent, never zero");
  await ctx.close();
}

{
  const { ctx, page } = await mount(browser, 1440, NAMES);
  const strip = { status: "ok", session: "2026-10-12", fields: ["px", "chg", "iv30p"], rows: { LIVE1: [10, 0.05, 0.25], LIVE2: [10, -0.01, 0.2] } };
  await page.hover("#mvUp");
  await page.evaluate((s) => { window.__strips = s; window.__rtFire(); }, strip);
  let got = await read(page);
  eq(got.up.map((x) => x.t), exp.up, "THE ORDER IS HELD while the pointer is on the list: a live arrival does not reorder it");
  ok(got.ctx.includes("Order held while you read."), "and says the order is held");
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector(".mv-held"));
  got = await read(page);
  eq(got.up.map((x) => x.t), ["LIVE1"], "when the pointer leaves, the waiting arrival is applied");
  await ctx.close();
}

for (const [label, o, kind, text] of [
  ["a pending universe", { body: { status: "pending" } }, "pending", /not published/],
  ["a failed read", { status: 500, body: {} }, "unreadable", /could not be loaded/],
]) {
  const { ctx, page } = await mount(browser, 390, NAMES, o);
  ok(text.test(await page.textContent("#mvStatus")), label + " says so in the status line");
  eq((await read(page)).up, [], label + " draws no row");
  for (const v of ["Map", "Sectors"]) {
    await page.click("#mvTab" + v);
    await page.waitForFunction((id) => !document.getElementById(id).hidden, "mvPane" + v);
    eq(await page.getAttribute("#mv" + v + " [data-empty]", "data-empty"), kind, `${label}: the ${v} panel says ${kind}`);
  }
  await ctx.close();
}

{
  const flat = NAMES.map((n) => [n[0], n[1], null, n[3], n[4], n[5]]);
  const { ctx, page } = await mount(browser, 390, flat);
  for (const v of ["Map", "Sectors"]) {
    await page.click("#mvTab" + v);
    await page.waitForFunction((id) => !document.getElementById(id).hidden, "mvPane" + v);
    eq(await page.getAttribute("#mv" + v + " [data-empty]", "data-empty"), "quiet", `with no usable implied volatility the ${v} panel is empty and says so`);
  }
  await ctx.close();
}

{
  const rnd = (() => { let a = 12345; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const SECT = ["Technology", "Financials", "Health Care", "Energy", "Utilities", "Materials", null];
  const big = Array.from({ length: 260 }, (_, i) => ["B" + String(i).padStart(3, "0"), (rnd() - 0.5) * 0.12, 0.15 + rnd() * 0.5, rnd() < 0.1 ? 3 : 60, SECT[Math.floor(rnd() * SECT.length)], Math.exp(2 + rnd() * 6) * 1e9]);
  const { ctx, page } = await mount(browser, 1100, big, { hash: "#view=map" });
  const mp = await readMap(page);
  const me = mapExpected(big);
  eq(mp.tiles.length, me.drawn.length, "260 names: every one is a tile");
  let sum = 0, worstRel = 0;
  for (const t of mp.tiles) { const e = me.drawn.find((x) => x.t === t.t); const want = (e.w / me.total) * mp.cw * mp.ch; sum += t.w * t.h; worstRel = Math.max(worstRel, Math.abs(t.w * t.h - want) / want); }
  ok(worstRel < 0.05, "260 names: every tile's area is its market-cap share (worst relative error " + worstRel.toFixed(4) + ")");
  ok(near(sum, mp.cw * mp.ch, 0.002 * mp.cw * mp.ch), "260 names: the tiles fill the map");
  let overlaps = 0;
  for (let i = 0; i < mp.tiles.length; i++) for (let j = i + 1; j < mp.tiles.length; j++) { const a = mp.tiles[i], b = mp.tiles[j]; if (!(a.x + a.w <= b.x + 0.6 || b.x + b.w <= a.x + 0.6 || a.y + a.h <= b.y + 0.6 || b.y + b.h <= a.y + 0.6)) overlaps++; }
  eq(overlaps, 0, "260 names: no two tiles overlap");
  const aspects = mp.groups.map((g) => Math.max(g.w / g.h, g.h / g.w));
  ok(Math.max(...aspects) < 6, "260 names: sector blocks stay near-square (squarified)");
  await ctx.close();
}

const mutate = (src, from, to) => { assert.equal(src.split(from).length - 1, 1, "mutation target occurs once: " + from); return src.replace(from, to); };
const MUTANTS = {
  "colour does not follow the sign": ['const dirOf = (m) => (m > 0 ? "up" : m < 0 ? "down" : "flat");', 'const dirOf = (m) => (m !== 0 ? "up" : "flat");'],
  "median takes the upper middle": ["return sorted.length % 2 ? sorted[k] : (sorted[k - 1] + sorted[k]) / 2;", "return sorted[k];"],
  "tile area follows the square root of cap": ["const w = capMode ? x.cap : 1;", "const w = capMode ? Math.sqrt(x.cap) : 1;"],
  "beyond 2 counts only rises": ["Math.abs(m) > SECTOR_BEYOND", "m > SECTOR_BEYOND"],
  "share uses the wrong denominator": ["share: beyond / ms.length", "share: beyond / (ms.length + 1)"],
  "the printed sign is dropped": ['return (m < 0 ? "−" : m > 0 ? "+" : "") + s;', "return s;"],
  "the hash is not restored": ["(field|map|sectors)(?=$|[&;])", "(field)(?=$|[&;])"],
  "event names lose their outline": ['"data-event": x.event ? "" : null,', '"data-event": null,'],
  "sorting does not say so": ['c.k === key ? (dir > 0 ? "ascending" : "descending") : "none"', '"none"'],
  "event names count in the sectors": ["sectorStats(M.clean)", "sectorStats(M.all)"],
};
for (const [name, [from, to]] of Object.entries(MUTANTS)) {
  const mutated = mutate(JS, from, to);
  const problems = await exercise(browser, NAMES, mutated).catch((e) => ["threw: " + e.message.split("\n")[0]]);
  ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (" + problems.length + " failures, first: " + problems[0] + ")");
}

for (const [name, from, to] of [
  ["a floor of 1 in 1000", "const FLOOR_N = 250;", "const FLOOR_N = 1000;"],
  ["the 3x level taken at 2x", "const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;", "const level = k >= 2 ? 2 : 0;"],
  ["a rounded-up count", "Math.round(1 / p)", "Math.ceil(1 / p)"],
]) {
  const { ctx, page } = await mount(browser, 1440, NAMES, { mutate: [from, to] });
  const got = await read(page);
  const exp = expected(NAMES);
  const wrong = got.up.concat(got.down).some((x) => x.r !== (exp.rarity[x.t] === undefined ? null : exp.rarity[x.t]));
  ok(wrong, "planted wrong build is caught by the rarity comparison: " + name);
  await ctx.close();
}

await browser.close();
console.log(`✓ flows-moves-render: ${checks} assertions — the kill switch and its four modes, the page's static text and token-only sheet, the Field lists, and the Map and Sectors tabs in Chromium at 1440, 768, 390 and 320 px against a stubbed universe: tab semantics, arrow, Home and End keys and the #view= hash, treemap areas equal to market-cap shares and never overlapping, direction and step on every tile with a printed sign and shape, sector medians, counts, shares and bars equal to an independent computation, keyboard sorting, the phone list, the live roster, held order, the pending, failed, empty, no-sector and no-cap states, 44 px targets, reduced motion, one data request, and ${Object.keys(MUTANTS).length} planted wrong builds that each fail`);
