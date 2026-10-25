import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";
import * as PAGES from "../shared/flows-pages.js";
import * as M from "../shared/flows-moves0.js";
import { rarityText } from "../shared/flows-targets.js";
import * as SIG from "../shared/flows-moves-sig.js";
import { flowsPageRows, FLOWS_PAGE_SLUGS } from "../server/routes/flows-pages.js";
import { HttpError } from "../server/http.js";
import * as FX from "./lib/moves-fixture.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };
const HTML = PAGES.movesPage({ username: "test" });
const JS = fs.readFileSync(path.join(ROOT, "assets/js/flows-moves.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets/css/flows-moves.css"), "utf8");
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow)(?![-\w])/;
const COLOUR_FN = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/;
const FORBID = /\b(unusual|alert|alerts|screen|rare|sigma|radar)\b|\bat (the )?(ask|bid)\b/i;
const NOT_BUILT = /\bq\s*(<=|≤|<)|\bNOW\b|\bHawkes\b|1 in [\d,]+ of/;
const MINUS = "−", DASH = "—";
const SQRT252 = Math.sqrt(252);
const stripHtml = (h) => h.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<aside class="ak-dock"[\s\S]*?<\/aside>/, "").replace(/<aside class="fx-side"[\s\S]*?<\/aside>/, "");

const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
ok(/^FLOWS_MOVES = "on"$/m.test(wrangler), "the switch ships on: the owner opened the Moves page to every member on 2026-10-12");

{
  const text = stripHtml(HTML);
  eq((HTML.match(/<h1[ >]/g) || []).length, 1, "one h1");
  ok(/<title>Flows — Moves<\/title>/.test(HTML), "the title says Moves");
  ok(/<h1 id="fxTitle">Large moves<\/h1>/.test(HTML) && /data-fx-hero/.test(HTML), "the heading says Large moves");
  ok(!FORBID.test(text), "no forbidden word in the page's own text, title or description");
  ok(!NOT_BUILT.test(text) && !NOT_BUILT.test(JS), "no q, no flagged, no Hawkes and no boundary claim anywhere in the page or script");
  const nav = /<aside class="fx-side"[\s\S]*?<\/aside>/.exec(HTML)[0];
  ok(/href="\/flows\/moves\/"[^>]*aria-current="page"/.test(nav) && nav.includes(">Moves<"), "the rail names Moves on its own page");
  ok(/href="\/flows\/moves\/"/.test(PAGES.marketPage({ username: "test" })), "and every other page links it in the rail");
  ok(/\/assets\/js\/flows-moves\.js\?v=\d+/.test(HTML) && /\/assets\/css\/flows-moves\.css\?v=\d+/.test(HTML), "the controller and the sheet are versioned");
  ok(!/flows-feeds\.css|flows-chart\.js/.test(HTML), "no feeds sheet and no chart script");
  ok(/data-flows-page="moves"/.test(HTML), "the page owns the one-screen shell hook");
  for (const w of M.HEADER_SENTENCES) ok(M.wordCount(w) <= M.HEADER_WORDS_MAX, "a header sentence stays inside fourteen words: " + w);
  ok(!FORBID.test(M.HEADER_SENTENCES.join(" ")), "and uses none of the forbidden words");
  for (const w of [M.LINE, M.CAPTION, M.APART, ...M.RADAR_SENTENCES]) ok(JS.includes(JSON.stringify(w).slice(1, -1)), "the controller carries the leaf's sentence: " + w);
  ok(!JS.includes("not yet published") && JS.includes(JSON.stringify(SIG.SIG_FLAGGED_LINE).slice(1, -1)), "the muted note is gone and the test's sentence is carried");
  const panels = [...HTML.matchAll(/role="tab" aria-selected="(\w+)" aria-controls="(\w+)" data-v="(\w+)"/g)];
  eq(panels.map((x) => [x[2], x[3], x[1]]), [["mvMain", "field", "true"], ["mvLists", "lists", "false"], ["mvRail", "detail", "false"]], "three phone tabs control three panels, Field first");
  for (const id of ["mvMain", "mvLists", "mvRail", "mvPlot", "mvNow", "mvApart", "mvMoreDlg", "mvInfoDlg", "mvDir", "mvEarn", "mvSector", "mvClear", "mvFreeze"]) ok(new RegExp('id="' + id + '"').test(HTML), "the shell carries #" + id);
  const sentences = text.replace(/<[^>]+>/g, ". ").split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 3);
  for (const s of sentences) ok(M.wordCount(s) <= 14, "a sentence of the served HTML stays short: " + s.slice(0, 60));
  ok(!COLOUR_LITERAL.test(CSS), "the sheet holds no colour literal: tokens only");
  ok(!COLOUR_FN.test(JS.replace(/&#39;/g, "")), "and neither does the script");
  ok(COLOUR_LITERAL.test(CSS + "\n.x { color: #fff; }") && COLOUR_LITERAL.test(CSS + "\n.x { background: rgb(1, 2, 3); }"), "and the scan catches a planted literal");
  ok(!/(^|[^-\w])transition\b/.test(CSS.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "")), "every transition sits inside no-preference");
  ok(!/\bglobalThis\.|(?<![\w.])window\.[A-Za-z]+\s*=(?!=)/.test(JS.replace(/globalThis\.__MovesTest/, "")), "no new global");
  ok(!/scroll/.test(CSS.replace(/touch-action/g, "")) || !/overflow(-y)?:\s*(auto|scroll)/.test(CSS), "the sheet scrolls nothing");
}

{
  ok(FLOWS_PAGE_SLUGS.includes("moves"), "the route table lists the page");
  const mk = (mode, owner) => {
    const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => owner });
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

const LIST = FX.names();
const BODY = FX.universe(LIST);
const DEC = FX.decoded(BODY);
const pctT = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "") + Math.abs(+(v * 100).toFixed(1)).toFixed(1) + "%";
const sgn1 = (m) => (m < 0 ? MINUS : m > 0 ? "+" : "") + Math.abs(m).toFixed(1);
const typPct = (x) => (x * 100).toFixed(x * 100 >= 10 ? 0 : 1) + "%";
const PIN = ["SPY", "QQQ"];
const quant = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(0.995 * s.length) - 1)] : 0; };

const model = (rows) => {
  const all = [];
  for (const r of rows) {
    if (!(r.iv > 0)) continue;
    const m = r.chg / (r.iv / SQRT252);
    const z = r.sig > 0 ? r.chg / r.sig : null;
    all.push({ ...r, m, a: Math.abs(m), z, event: r.ed !== null && r.ed <= 21 });
  }
  const plotted = all.filter((x) => x.z !== null);
  const xmax = Math.min(12, Math.max(3, Math.ceil(quant(plotted.map((x) => Math.abs(x.z))))));
  const ymax = Math.min(10, Math.max(3, Math.ceil(quant(plotted.map((x) => x.a)))));
  const capMax = Math.max(0, ...plotted.filter((x) => !PIN.includes(x.t)).map((x) => x.cap || 0));
  return { all, plotted, xmax, ymax, capMax };
};
const byA = (a, b) => b.a - a.a || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
const rarityFull = (x) => {
  if (!(x.sig > 0)) return null;
  const k = Math.abs(x.chg) / x.sig;
  const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
  const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;
  if (!level || hits === null || !Number.isInteger(hits) || hits < 0 || hits > 252) return null;
  return rarityText({ k: level, sigmaRef: x.sig, route: "empirical", hits });
};
const chipOf = (full) => (full === null ? DASH : /rarer than 1 in 250/.test(full) ? "beyond 1 in 250" : /about (1 in \d+)/.exec(full)[1]);

{
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(JS, sandbox);
  const T = sandbox.__MovesTest;
  ok(T && typeof T.rarityParts === "function", "the page exposes its pure functions only where there is no document");
  for (const level of [2, 3]) {
    for (let hits = 0; hits <= 252; hits++) {
      const sig = 0.02;
      const x = { chg: level * sig + 0.001, sig, f2: level === 2 ? hits : 99, f3: level === 3 ? hits : 99 };
      const got = T.rarityParts(x);
      const want = rarityText({ k: level, sigmaRef: sig, route: "empirical", hits });
      eq(got.text, want, "the rarity sentence equals the leaf's rarityText at level " + level + ", " + hits + " of 252");
      eq(got.short, chipOf(want), "and its short form is the leaf's own phrase at " + hits);
    }
  }
  eq(T.rarityParts({ chg: 0.03, sig: 0.02, f2: null, f3: null }), null, "a missing count is no sentence, never a guess");
  eq(T.rarityParts({ chg: 0.03, sig: null, f2: 3, f3: 1 }), null, "a missing typical day is no sentence");
  eq(T.rarityParts({ chg: 0.019, sig: 0.01, f2: 3, f3: 1 }), T.rarityParts({ chg: 0.019, sig: 0.01, f2: 3, f3: 1 }), "deterministic");
  eq(T.rarityParts({ chg: 0.0199, sig: 0.01, f2: 3, f3: 1 }), null, "1.99 typical days has no count");
  for (const [chg, iv] of [[-0.031, 0.35], [0.0231, 0.3], [0, 0.3], [-0.08, 0.4]]) eq(T.ivDays(chg, iv), M.ivDays(chg, iv), "ivDays equals the leaf for " + chg + " / " + iv);
  for (const bad of [null, 0, -1, NaN, "0.3"]) eq(T.ivDays(0.02, bad), null, "ivDays of " + String(bad) + " is null");
  eq(T.signed(-1.04), MINUS + "1.0", "a negative prints U+2212");
  eq(T.signed(0), "0.0", "zero prints no sign");
  const rows = DEC.map((r) => ({ t: r.t, chg: r.chg, iv30p: r.iv, sig: r.sig, cap: r.cap }));
  const pts = rows.map((r) => M.radarPoint(r)).filter(Boolean);
  const mine = model(DEC);
  const fromLeaf = M.radarDomain(pts);
  eq(fromLeaf, { xmax: mine.xmax, ymax: mine.ymax }, "the leaf's domain equals the independent quantile rule");
  const jj = (v) => JSON.parse(JSON.stringify(v));
  const fromPage = jj(T.domainOf(mine.all.map((x) => ({ z: x.z, a: x.a }))));
  eq(fromPage, fromLeaf, "and the page's domain equals the leaf's");
  eq(jj(T.domainOf([])), { xmax: 3, ymax: 3 }, "an empty field has the smallest domain");
  eq(jj(T.domainOf([{ z: 99, a: 99 }])), { xmax: 12, ymax: 10 }, "the domain is capped at 12 and 10");
  for (const r of [2.5, 4, 7, 14]) {
    for (const dir of ["up", "dn", "fl"]) {
      const d = T.markerPath(dir, r);
      let area;
      if (dir === "fl") area = Math.PI * r * r;
      else {
        const n = (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
        const pts2 = [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]];
        area = Math.abs(pts2[0][0] * (pts2[1][1] - pts2[2][1]) + pts2[1][0] * (pts2[2][1] - pts2[0][1]) + pts2[2][0] * (pts2[0][1] - pts2[1][1])) / 2;
        ok(dir === "up" ? pts2[0][1] < 0 : pts2[0][1] > 0, "a triangle points " + dir);
      }
      ok(Math.abs(area - Math.PI * r * r) < 1e-6 * area + 1e-9, "a " + dir + " marker has the area of a circle of radius " + r);
    }
  }
  ok(T.radiusOf(null, 1, 14) === 2.5 && T.radiusOf(1, 1, 14) === 14 && Math.abs(T.radiusOf(0.25, 1, 14) - 7) < 1e-12 && T.radiusOf(1e-9, 1, 14) === 2.5, "the radius is the square root of cap over the largest, floored at 2.5 px");
}

const FAKE_RT = `(() => { const UI = window.FlowsUI; const cbs = {};
  window.__rtFire = () => (cbs.px || []).forEach((f) => f());
  window.__strips = null;
  window.FlowsUI = Object.freeze({ ...UI, rt: { connect: () => ({ on: (k, f) => { (cbs[k] = cbs[k] || []).push(f); } }), feeds: () => Boolean(window.__strips), strips: () => window.__strips } }); })();`;

async function mount(browser, w, h, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce", ...(o.context || {}) });
  const page = await ctx.newPage();
  if (o.now) await page.clock.setFixedTime(new Date(o.now));
  const errors = [];
  const asked = [];
  const cardHits = {};
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    if (u.pathname === "/assets/js/flows-rt.js") return r.fulfill({ contentType: "text/javascript", body: FAKE_RT });
    if (u.pathname === "/assets/js/flows-moves.js" && o.js) return r.fulfill({ contentType: "text/javascript", body: o.js });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: "" });
      return r.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/")) asked.push(u.pathname + u.search);
    if (u.pathname === "/api/flows/universe") return r.fulfill({ contentType: "application/json", status: o.status || 200, body: JSON.stringify(o.body || BODY), headers: { "X-Payload-Updated": String(Date.parse(FX.GENERATED_AT)) } });
    if (u.pathname === "/api/flows/card") {
      const t = u.searchParams.get("t");
      cardHits[t] = (cardHits[t] || 0) + 1;
      if (o.cardFail && (o.cardFail === "*" || o.cardFail === t) && cardHits[t] === 1) return r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      if (t === "NOCARD") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "absent" }) });
      return r.fulfill({ contentType: "application/json", body: JSON.stringify(FX.CARD(t)) });
    }
    if (u.pathname.startsWith("/api/")) return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    if (u.pathname === "/flows/ticker/") return r.fulfill({ contentType: "text/html", body: "<title>ticker</title><p>ticker stub</p>" });
    return r.fulfill({ contentType: "text/html; charset=utf-8", body: HTML });
  });
  await page.goto("https://example.test/flows/moves/");
  await page.waitForSelector("#mv[data-ready]", { timeout: 15000 });
  await page.waitForTimeout(o.settle === undefined ? 350 : o.settle);
  return { ctx, page, errors, asked, cardHits };
}

const fit = (page) => page.evaluate(() => {
  const se = document.scrollingElement;
  const inner = (el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5); };
  const dl = document.querySelector("dialog[open]");
  return { v: se.scrollHeight <= innerHeight, h: se.scrollWidth <= innerWidth, dlg: dl ? inner(dl) && dl.scrollHeight <= dl.clientHeight + 1 && dl.scrollWidth <= dl.clientWidth + 1 : true, sh: se.scrollHeight, ih: innerHeight, sw: se.scrollWidth, iw: innerWidth };
});

const clipped = (page) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && r.width > 0 && r.height > 0; };
  for (const panel of document.querySelectorAll(".mv-panel")) {
    if (!vis(panel)) continue;
    const pr = panel.getBoundingClientRect();
    for (const el of panel.querySelectorAll("*")) {
      if (!vis(el) || (el.closest("svg") && el.tagName !== "svg")) continue;
      if (el.closest(".mv-listbox, .mv-plot")) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.left < pr.left - 1 || r.top < pr.top - 1) out.push(panel.id + ":" + el.className + ":" + Math.round(r.bottom - pr.bottom));
      if (el.matches(".kv, .mv-st, .mv-chip, .mv-tk") && el.scrollWidth > el.clientWidth + 1) out.push("text " + el.className + ":" + el.textContent.slice(0, 20));
    }
    for (const box of panel.querySelectorAll(".mv-listbox")) {
      if (!vis(box)) continue;
      const br = box.getBoundingClientRect();
      for (const c of box.children) { const r = c.getBoundingClientRect(); if (r.bottom > br.bottom + 1 || r.right > br.right + 1) out.push("child of " + box.id + " " + c.className + " " + Math.round(r.bottom - br.bottom)); }
    }
  }
  for (const el of document.querySelectorAll(".mv-chip")) if (vis(el) && el.scrollWidth > el.clientWidth + 1) out.push("chip " + el.textContent);
  return out;
});

const dots = (page) => page.evaluate(() => {
  const svg = document.getElementById("mvSvg");
  return {
    xmax: +svg.dataset.xmax, ymax: +svg.dataset.ymax, l: +svg.dataset.l, t: +svg.dataset.t, w: +svg.dataset.w, h: +svg.dataset.h,
    plotW: document.getElementById("mvPlot").clientWidth, plotH: document.getElementById("mvPlot").clientHeight,
    pts: Array.from(svg.querySelectorAll(".pt"), (e) => {
      const b = e.getBoundingClientRect(), s = svg.getBoundingClientRect();
      return { t: e.dataset.t, cls: e.getAttribute("class"), r: e.dataset.r === undefined ? null : +e.dataset.r, x: +e.dataset.x, y: +e.dataset.y, d: e.getAttribute("d"), tr: e.getAttribute("transform"), cx: b.left + b.width / 2 - s.left, cy: b.top + b.height / 2 - s.top, bw: b.width, bh: b.height, tab: (e.closest(".hit") || e).getAttribute("tabindex"), role: (e.closest(".hit") || e).getAttribute("role"), hidden: e.getAttribute("aria-hidden"), label: (e.closest(".hit") || e).getAttribute("aria-label"), sel: e.hasAttribute("data-sel") };
    }),
    rings: Array.from(svg.querySelectorAll(".ring"), (e) => ({ t: e.dataset.ring, r: +e.getAttribute("r"), cx: +e.getAttribute("cx"), cy: +e.getAttribute("cy"), off: e.getAttribute("class").includes("off") })),
    labels: Array.from(svg.querySelectorAll(".lab"), (e) => ({ t: e.dataset.lab, text: e.textContent, sel: e.getAttribute("class").includes("sel") })),
    refs: Array.from(svg.querySelectorAll(".ref"), (e) => e.dataset.ref),
    shapes: svg.querySelectorAll("path.boundary, .bound, [data-boundary]").length,
  };
});

const listRows = (page, id) => page.evaluate((i) => Array.from(document.querySelectorAll("#" + i + " .mv-row"), (r) => ({ t: r.dataset.t, m: r.querySelector('[data-k="m"]').textContent, chg: r.querySelector('[data-k="chg"]').textContent, how: r.querySelector('[data-k="how"]').textContent, title: r.title, label: r.getAttribute("aria-label"), cur: r.getAttribute("aria-current"), tab: r.tabIndex })), id);

const railKv = (page) => page.evaluate(() => {
  const out = {};
  for (const e of document.querySelectorAll("#mvRail .kv")) out[e.children[0].textContent] = e.children[1].textContent;
  const g = (s) => { const e = document.querySelector("#mvRail " + s); return e ? e.innerText : null; };
  const sp = document.querySelector("#mvRail .mv-spark polyline");
  return { kv: out, big: g(".big"), st: g(".mv-st"), why: g(".why"), say: g('[data-k="say"]'), open: document.querySelector("#mvRail .mv-open") ? document.querySelector("#mvRail .mv-open").getAttribute("href") : null, spark: sp ? sp.getAttribute("points").split(" ").length : 0, text: document.getElementById("mvRail").innerText, dates: Array.from(document.querySelectorAll("#mvRail .mv-dates span"), (e) => e.textContent) };
});

const VIEWPORTS = [[1440, 820, {}], [1024, 768, {}], [390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]];

class Stop extends Error {}
async function exercise(browser, js, early) {
  const problems = [];
  const P = (c, m) => { if (c) { checks++; return; } problems.push(m); if (early) throw new Stop(m); };
  const same = (a, b, m) => P(JSON.stringify(a) === JSON.stringify(b), m + " " + (JSON.stringify(a) === JSON.stringify(b) ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)));
  const M0 = model(DEC);
  const ranked = M0.all.filter((x) => !x.event).sort(byA);
  const apart = M0.all.filter((x) => x.event).sort(byA);
  try {
    for (const [w, h, extra] of VIEWPORTS) {
      const phone = w < 900;
      const { ctx, page, errors, asked } = await mount(browser, w, h, { context: extra, js });
      P(await page.evaluate(() => matchMedia("(pointer:coarse)").matches) === phone, w + ": the phone context is a coarse pointer and the others are not");
      const check = async (label) => {
        const f = await fit(page);
        P(f.v && f.h, w + "x" + h + " " + label + ": the page does not scroll (" + f.sh + " of " + f.ih + ", " + f.sw + " of " + f.iw + ")");
        P(f.dlg, w + "x" + h + " " + label + ": an open dialog sits inside the viewport and scrolls nothing");
        const cl = await clipped(page);
        P(cl.length === 0, w + "x" + h + " " + label + ": nothing clipped or past its panel " + cl.slice(0, 3).join(" | "));
      };
      const views = phone ? ["field", "lists", "detail"] : ["field"];
      for (const v of views) {
        if (phone) { await page.click('#mvSeg5 [data-v="' + v + '"]'); await page.waitForTimeout(150); }
        await check(v);
        if (v === "field") {
          const filters = [["up", async () => page.click('#mvDir [data-dir="up"]')], ["down", async () => page.click('#mvDir [data-dir="down"]')], ["earn", async () => { await page.click('#mvDir [data-dir="down"]'); await page.click("#mvEarn"); }], ["sector", async () => { await page.click("#mvEarn"); await page.selectOption("#mvSector", "Technology"); }]];
          for (const [name, act] of filters) { await act(); await page.waitForTimeout(80); await check("filter " + name); }
          await page.click("#mvClear");
          await page.waitForTimeout(80);
          await check("cleared");
        }
        if (v === "lists") {
          await page.click("#mvMore");
          await page.waitForTimeout(100);
          await check("show more dialog");
          await page.keyboard.press("Escape");
        }
        if (v === "field" || phone && v === "field") {
          await page.click("#mvInfoBtn");
          await page.waitForTimeout(100);
          await check("info dialog");
          await page.keyboard.press("Escape");
        }
        if (!phone && v === "field") {
          await page.click("#mvMore");
          await page.waitForTimeout(100);
          await check("show more dialog");
          await page.keyboard.press("Escape");
        }
      }
      if (phone) {
        const bad = await page.evaluate(() => Array.from(document.querySelectorAll(".mv-seg5 button, .mv-panel button, .mv-panel select, .mv-open, .mv-ibtn, .mv-row"), (b) => { const r = b.getBoundingClientRect(); return r.width && r.height && Math.min(r.width, r.height) < 43.5 && getComputedStyle(b).display !== "none" ? b.className + ":" + b.textContent.slice(0, 12) + ":" + Math.round(r.height) : null; }).filter(Boolean));
        P(bad.length === 0, "coarse pointer: every control in view is 44 px " + bad.join(" | "));
      }
      P(errors.length === 0, w + ": no page error " + errors.join(" | "));
      P(asked.every((a) => /^\/api\/flows\/(universe\?cols=t,sec,chg,iv30p,sig,f2,f3,ed,mcap|card\?t=[A-Z0-9]+)$/.test(a)), w + ": no request beyond the universe projection and cards " + asked.join(","));
      P(asked.filter((a) => a.startsWith("/api/flows/universe")).length === 1, w + ": one universe read");
      await ctx.close();
    }

    {
      const { ctx, page, asked, cardHits } = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z" });
      const d = await dots(page);
      const compact = d.plotW < 560;
      P(d.l === (compact ? 34 : 44) && d.t === 10 && Math.abs(d.w - (d.plotW - d.l - 12)) < 1e-6 && Math.abs(d.h - (d.plotH - 10 - (compact ? 30 : 34))) < 1e-6, "the plot box is the host minus the margins");
      P(d.xmax === M0.xmax && d.ymax === M0.ymax, "the axes' extent is the 99.5th percentile rule: " + d.xmax + "," + d.ymax + " vs " + M0.xmax + "," + M0.ymax);
      const px = (z) => d.l + ((Math.max(-d.xmax, Math.min(d.xmax, z)) + d.xmax) / (2 * d.xmax)) * d.w;
      const py = (a) => d.t + (1 - Math.max(0, Math.min(d.ymax, a)) / d.ymax) * d.h;
      const rMax = compact ? 10 : 14;
      const plottedNames = new Set(M0.plotted.map((x) => x.t));
      same([...new Set(d.pts.map((p) => p.t))].sort(), [...plottedNames].sort(), "every name with a typical day and an implied day is drawn once, and no other");
      P(!d.pts.some((p) => ["NOIV", "NOSIG"].includes(p.t)), "a name with no implied volatility or no typical day is not drawn");
      let bad = 0, badR = 0, badShape = 0, badMid = 0, badRing = 0, area = 0;
      for (const x of M0.plotted) {
        const p = d.pts.find((q) => q.t === x.t);
        if (!p) { bad++; continue; }
        if (Math.abs(p.x - px(x.z)) > 0.01 || Math.abs(p.y - py(x.a)) > 0.01) bad++;
        const pin = PIN.includes(x.t);
        const dir = x.m > 0 ? "up" : x.m < 0 ? "dn" : "fl";
        if (!p.cls.split(" ").includes(dir)) badShape++;
        if (pin) { if (p.bw < 8.9 || p.bw > 9.6 || Math.abs(p.cx - p.x) > 0.6) badMid++; continue; }
        const r = x.cap > 0 && M0.capMax > 0 ? Math.max(2.5, rMax * Math.sqrt(x.cap / M0.capMax)) : 2.5;
        if (Math.abs(p.r - r) > 0.001) badR++;
        if (Math.abs(p.cx - p.x) > 0.6) badMid++;
        const n = (p.d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).map(Number);
        if (dir !== "fl") {
          const a = Math.abs(n[0] * (n[3] - n[5]) + n[2] * (n[5] - n[1]) + n[4] * (n[1] - n[3])) / 2;
          if (Math.abs(a - Math.PI * r * r) > 0.01 * Math.PI * r * r + 1e-6) area++;
          if (dir === "up" ? !(n[1] < 0) : !(n[1] > 0)) badShape++;
        }
        const ring = d.rings.find((q) => q.t === x.t);
        if (x.event ? !ring || ring.r <= p.r : !!ring) badRing++;
      }
      P(bad === 0, "every dot sits at the independent position of its typical days and implied multiple (" + bad + " off)");
      P(badR === 0, "dot radius is the square root of market cap over the largest, floored at 2.5 px (" + badR + " off)");
      P(area === 0, "every triangle has the area of its circle (" + area + " off)");
      P(badShape === 0, "direction is the class and the shape of the marker (" + badShape + " off)");
      P(badMid === 0, "markers are centred on their data position (" + badMid + " off)");
      P(badRing === 0, "a ring surrounds exactly the names reporting within 30 days (" + badRing + " off)");
      const edge = d.pts.find((p) => p.t === "EDGE");
      P(Math.abs(edge.x - (d.l + d.w)) < 0.01 && Math.abs(edge.y - d.t) < 0.01, "a name beyond the axis is drawn at the edge, not off the plot");
      const pins = d.pts.filter((p) => p.cls.includes("pin"));
      same(pins.map((p) => p.t).sort(), [...PIN].sort(), "SPY and QQQ are pinned as squares");
      P(d.pts.every((p) => (p.tab !== null) === (p.role === "button") && (p.tab === null) === (p.hidden === "true")), "a dot is either a button or hidden from the tree");
      P(d.pts.filter((p) => p.tab !== null).length <= 62 + 2, "at most sixty dots and the pins take the tab order");
      same(d.refs.sort(), [...[-3, -2, 2, 3].filter((v) => Math.abs(v) < d.xmax).map((v) => "x" + v), "y1"].sort(), "the reference marks are straight lines at 2 and 3 typical days and 1x implied");
      P(d.shapes === 0, "no boundary curve is drawn");
      const stamp = await page.locator("#mvStamp").innerText();
      P(/Oct 16/.test(stamp) && /read Oct 17 00:31 TRT/.test(stamp), "the stamp prints the read in TRT: " + stamp);
      P(new RegExp(M0.plotted.length + " of " + DEC.length + " names with a typical day").test(stamp), "and the number of names measured");
      P(!/UTC|GMT/.test(await page.locator("body").innerText()), "no other zone is named");
      P((await page.locator("#mvCount").innerText()) === M0.plotted.length + " of " + M0.plotted.length + " shown", "the count reads every drawn name");
      const fn = await page.locator("#mvFnote").innerText();
      P(fn.includes(M.X_LINE) && fn.includes(M.Y_LINE) && fn.includes(M.SIZE_LINE) && fn.includes(M.REF_LINE), "the foot carries the four reading sentences");
      const noSig = M0.all.length - M0.plotted.length;
      P(fn.includes(noSig + (noSig === 1 ? " name has" : " names have") + " no typical day"), "and counts the names it cannot draw");
      const clippedN = M0.plotted.filter((x) => Math.abs(x.z) > d.xmax || x.a > d.ymax).length;
      P(clippedN > 0 && fn.includes(clippedN + (clippedN === 1 ? " name is" : " names are") + " beyond the axis"), "and the names beyond the axis");
      P(d.labels.some((l) => l.t === "SPY" && l.text === "SPY " + (M0.plotted.find((x) => x.t === "SPY").m > 0 ? "▲" : "▼") + " " + pctT(M0.plotted.find((x) => x.t === "SPY").chg)), "a pin carries its label with the day's change");
      P(d.labels.filter((l) => l.sel).length === 1, "the selected name is labelled");

      const now = await listRows(page, "mvNow");
      const nBox = await page.evaluate(() => document.getElementById("mvNow").clientHeight);
      same(now.map((r) => r.t), ranked.slice(0, now.length).map((x) => x.t), "Large now lists the names outside the earnings window by IV-days, largest first");
      P(now.length === Math.min(ranked.length, Math.max(1, Math.floor(nBox / 36))), "and shows as many rows as fit");
      for (const r of now) {
        const x = ranked.find((y) => y.t === r.t);
        P(r.m === sgn1(x.m) && r.chg === pctT(x.chg), r.t + " prints its IV-days and its day's change");
        const full = rarityFull(x);
        P(r.how === chipOf(full), r.t + " chip is the rarityText phrase: " + r.how + " vs " + chipOf(full));
        P(r.title === (full === null ? ("" + r.title) : full), r.t + " title is exactly rarityText");
        P(full === null || r.label.includes(full), r.t + " spoken label carries the sentence");
      }
      const ap = await listRows(page, "mvApart");
      same(ap.map((r) => r.t), apart.slice(0, 3).map((x) => x.t), "names reporting within 30 days are ranked apart, three of them");
      P(ap.every((r) => r.how === ""), "an earnings name carries no rarity chip");
      P((await page.locator("#mvNowNote").innerText()) === now.length + " of " + ranked.length && (await page.locator("#mvApartNote").innerText()) === "3 of " + apart.length, "both notes count");
      P(!(await page.locator("#mvMore").isHidden()), "Show more is offered when the list is longer than the room");

      const big = await page.evaluate(() => { const r = document.querySelector('#mvNow .mv-row[data-t="BIGUP"], #mvApart .mv-row[data-t="BIGUP"]'); return r ? r.querySelector('[data-k="chg"]').textContent : null; });
      P(big === null || big === "+9.4%", "a stored 940 on the 1e4 scale prints as +9.4%, not +940%: " + big);
      const sel = ranked[0];
      let rk = await railKv(page);
      same(rk.big, sel.t, "the first name is selected at load");
      P(rk.open === "/flows/ticker/?t=" + sel.t, "Open ticker links to the ticker page");
      same(rk.kv["Typical day"], sel.sig === null ? DASH : typPct(sel.sig), "typical day");
      same(rk.kv["In typical days"], sgn1(sel.z), "typical days moved");
      same(rk.kv["Implied day"], typPct(sel.iv / SQRT252), "implied day is 30-day IV over the square root of 252");
      same(rk.kv["Times implied"], sel.a.toFixed(1) + "×", "times implied");
      same(rk.kv["IV-days"], sgn1(sel.m), "IV-days");
      const full = rarityFull(sel);
      P(rk.say === (full ? full[0].toUpperCase() + full.slice(1) + "." : rk.say), "the drill sentence is rarityText");
      same(rk.kv["Past 2 typical"], sel.f2 + " of 252", "the beyond-2 count");
      same(rk.kv["Past 3 typical"], sel.f3 + " of 252", "the beyond-3 count");
      P(rk.spark === 21, "the 21-session sparkline holds the card's last 21 closes (" + rk.spark + ")");
      P(rk.kv.Conviction === "64 /100" && rk.kv["IV rank"] === "42" && rk.kv["Dealer γ book"] === "Long" && rk.kv["Latest flow"] === "+$12.5M", "card context is read, with units");
      const wantSig = SIG.sigRun(DEC).items.find((i) => i.t === sel.t);
      const wantLine = wantSig.state === "tested" ? (wantSig.flag ? SIG.SIG_FLAGGED_LINE : SIG.SIG_PLAIN_LINE) : SIG.SIG_REASONS[wantSig.state];
      P(rk.text.includes(wantLine) && !rk.text.includes("not yet published"), "the drill panel carries the significance result or the reason for none: " + wantLine);
      P(cardHits[sel.t] === 1, "the card is asked for once");
      P(asked.indexOf("/api/flows/card?t=" + sel.t) > asked.findIndex((a) => a.startsWith("/api/flows/universe")), "after the universe, never before first paint");

      await page.click('#mvNow .mv-row[data-t="' + now[1].t + '"]');
      await page.waitForTimeout(450);
      rk = await railKv(page);
      same(rk.big, now[1].t, "a click on a row selects it");
      const nx = ranked.find((y) => y.t === now[1].t);
      same(rk.kv["Times implied"], nx.a.toFixed(1) + "×", "and the rail follows");
      P((await listRows(page, "mvNow"))[1].cur === "true", "the row says it is current");
      const dd = await dots(page);
      P(dd.pts.filter((p) => p.sel).map((p) => p.t).join() === now[1].t && dd.labels.some((l) => l.sel && l.t === now[1].t), "and so does the dot, with its label");
      const evRow = apart[0];
      await page.click('#mvApart .mv-row[data-t="' + evRow.t + '"]');
      await page.waitForTimeout(450);
      rk = await railKv(page);
      P(/Earnings in \d+ sessions?/.test(rk.text) && rk.text.includes(M.APART), "an earnings name says so in the rail: event not separated");

      const countBefore = await page.locator(".pt:not(.off)").count();
      await page.click('#mvDir [data-dir="up"]');
      await page.waitForTimeout(100);
      const upN = M0.plotted.filter((x) => x.m > 0).length;
      P((await page.locator("#mvCount").innerText()) === upN + " of " + M0.plotted.length + " shown", "Up filters the field to risers");
      const upRows = await listRows(page, "mvNow");
      same(upRows.map((r) => r.t), ranked.filter((x) => x.m > 0).slice(0, upRows.length).map((x) => x.t), "and Large now to risers");
      const offDots = await page.evaluate(() => Array.from(document.querySelectorAll(".pt.off"), (e) => e.dataset.t));
      same(offDots.sort(), M0.plotted.filter((x) => !(x.m > 0) && !PIN.includes(x.t)).map((x) => x.t).sort(), "the others fade and take no part");
      P((await page.locator('#mvDir [data-dir="up"]').getAttribute("aria-pressed")) === "true", "the toggle says it is pressed");
      await page.click('#mvDir [data-dir="down"]');
      await page.waitForTimeout(100);
      same((await listRows(page, "mvNow")).map((r) => r.t), ranked.filter((x) => x.m < 0).slice(0, upRows.length).map((x) => x.t), "Down shows fallers");
      P((await page.locator("#mvClear").isVisible()), "Clear appears with a filter");
      await page.click("#mvEarn");
      await page.waitForTimeout(100);
      P((await page.locator("#mvNow").innerText()).includes("ranked below"), "Earnings week leaves the main list pointing at the ranked-apart one");
      same((await listRows(page, "mvApart")).map((r) => r.t), apart.filter((x) => x.m < 0).slice(0, 3).map((x) => x.t), "and keeps the direction filter in the ranked-apart list");
      await page.click("#mvClear");
      await page.selectOption("#mvSector", "Financials");
      await page.waitForTimeout(100);
      same((await listRows(page, "mvNow")).map((r) => r.t), ranked.filter((x) => x.sector === "Financials").slice(0, upRows.length).map((x) => x.t), "a sector filters the list");
      await page.click("#mvClear");
      await page.waitForTimeout(100);
      P((await page.locator(".pt:not(.off)").count()) === countBefore, "Clear restores the field");

      await page.click('#mvDir [data-dir="down"]');
      await page.waitForTimeout(80);
      const kept = await dots(page);
      same(kept.pts.filter((p) => p.cls.includes("pin")).map((p) => p.t).sort(), [...PIN].sort(), "the pins stay when a filter hides everything they are not");
      await page.click("#mvClear");

      const first = await page.locator('.hit[tabindex="0"]').first();
      await first.focus();
      const before = await page.evaluate(() => document.activeElement.dataset.t);
      const xb = (await dots(page)).pts.find((p) => p.t === before);
      await page.keyboard.press("ArrowLeft");
      const after = await page.evaluate(() => ({ t: document.activeElement.dataset.t, sel: document.querySelector(".pt[data-sel]") && document.querySelector(".pt[data-sel]").dataset.t }));
      const xa = (await dots(page)).pts.find((p) => p.t === after.t);
      P(after.t !== before && xa.x < xb.x && after.sel === after.t, "ArrowLeft moves to a dot on the left and selects it");
      await page.keyboard.press("ArrowRight");
      const back = await page.evaluate(() => document.activeElement.dataset.t);
      const xc = (await dots(page)).pts.find((p) => p.t === back);
      P(xc.x > xa.x, "ArrowRight moves back to the right");
      await Promise.all([page.waitForURL("**/flows/ticker/?t=*"), page.keyboard.press("Enter")]);
      P(new URL(page.url()).searchParams.get("t") === back, "Enter opens the ticker page of the focused dot");
      await ctx.close();
    }

    {
      const { ctx, page, cardHits } = await mount(browser, 1440, 820, { js });
      await page.focus('#mvNow .mv-row[tabindex="0"]');
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(700);
      P(Object.keys(cardHits).length <= 2, "four quick moves down the list ask for one more card, not four: " + Object.keys(cardHits).join());
      await page.keyboard.press("Home");
      await page.keyboard.press("ArrowDown");
      const f = await page.evaluate(() => ({ t: document.activeElement.dataset.t, cur: document.querySelector('#mvNow .mv-row[aria-current="true"]').dataset.t }));
      P(f.t === f.cur && f.t === ranked[1].t, "ArrowDown moves down the list and selects");
      await page.keyboard.press("End");
      const e = await page.evaluate(() => document.activeElement.closest("#mvApart") !== null || document.activeElement.closest("#mvNow") !== null);
      P(e, "End stays in the lists");
      await page.keyboard.press("Home");
      P((await page.evaluate(() => document.activeElement.dataset.t)) === ranked[0].t, "Home returns to the first row");
      await page.click("#mvMore");
      const n = await page.locator("#mvMoreG button").count();
      const T = await page.locator("#mvMoreT").innerText();
      P(T === "Largest " + n + " of " + ranked.length + ", in IV-days" && n > 6, "Show more lists the largest that fit: " + T);
      same(await page.evaluate(() => Array.from(document.querySelectorAll("#mvMoreG b"), (b) => b.textContent)), ranked.slice(0, n).map((x) => x.t), "in IV-days order");
      await page.keyboard.press("ArrowRight");
      P(await page.evaluate(() => document.activeElement.closest("#mvMoreG") !== null), "arrows move inside the dialog grid");
      await page.click('#mvMoreG button:nth-child(3)');
      await page.waitForTimeout(300);
      P((await railKv(page)).big === ranked[2].t, "choosing a name in the dialog selects it");
      await page.click("#mvInfoBtn");
      const info = await page.locator("#mvInfoB").innerText();
      P(/Not built yet: parts of the move, flow clusters and replay\./.test(info) && !/a significance test/.test(info), "the info dialog says what is not built");
      for (const w of SIG.SIG_INFO_SENTENCES) P(info.includes(w), "the info dialog states the test's limit: " + w);
      P(info.includes(M.REF_LINE) && !FORBID.test(info) && !NOT_BUILT.test(info), "and holds no forbidden word");
      for (const s of info.split(/(?<=\.)\s+/)) P(M.wordCount(s) <= 14, "an info sentence stays short: " + s.slice(0, 50));
      await page.keyboard.press("Escape");
      P(await page.evaluate(() => !document.querySelector("dialog[open]")), "Escape closes it");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, context: { reducedMotion: "reduce" } });
      P(await page.evaluate(() => document.getAnimations().length) === 0, "reduced motion: nothing animates");
      P(await page.evaluate(() => getComputedStyle(document.querySelector(".mv-row")).transitionDuration) === "0s", "reduced motion: no transition");
      const text = await page.locator("#flowsMain").innerText();
      P(!FORBID.test(text) && !NOT_BUILT.test(text), "no forbidden word in the rendered text");
      P(!/(^|[\s(])-\d/.test(text) && !text.includes("NaN") && !text.includes("undefined") && !/\bnull\b/.test(text), "no hyphen minus, NaN, undefined or null in the rendered text");
      await ctx.close();
    }

    {
      const { ctx, page, asked } = await mount(browser, 1440, 820, { js, cardFail: "*" });
      P((await page.locator("#mvRail").innerText()).includes("could not be read (HTTP 500)"), "a card that fails says so and says the move is unaffected");
      await page.click("#mvRetry");
      await page.waitForTimeout(300);
      const rk = await railKv(page);
      P(rk.spark === 21 && rk.kv.Conviction === "64 /100", "Retry reads the card");
      P(asked.filter((a) => a.startsWith("/api/flows/card")).length === 2, "the card was asked for twice");
      await page.click('#mvNow .mv-row:nth-child(2)');
      await page.waitForTimeout(400);
      await ctx.close();
    }

    {
      const odd = FX.names(30);
      odd.push(["NOCARD", 0.6, 0.3, 60, "Energy", 1e11, 0.02, 9, 1]);
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: FX.universe(odd) });
      P((await railKv(page)).big === "NOCARD", "the largest move is selected at load");
      P((await page.locator("#mvRail").innerText()).includes("NOCARD has no Flows card"), "a name with no card says so and shows no invented context");
      await ctx.close();
    }

    {
      const list = [];
      for (let i = 0; i < 40; i++) list.push(["Q" + String(i).padStart(2, "0"), 0.001, 0.3, 60, "Utilities", 1e10, 0.01, 5, 1]);
      for (let i = 0; i < 6; i++) list.push(["FLAG" + i, 0.035 + i * 0.001, 0.3, 60, "Technology", 2e10, 0.01, 0, 0]);
      list.push(["NEAR", 0.06, 0.3, 60, "Technology", 1e10, 0.01, 9, 4]);
      list.push(["EVT", 0.05, 0.3, 5, "Technology", 1e10, 0.01, 0, 0]);
      list.push(["NOSC", 0.05, 0.3, 60, "Technology", 1e10, null, null, null]);
      const dec = FX.decoded(FX.universe(list));
      const want = SIG.sigRun(dec);
      const refRej = (() => { const ps = want.items.map((i) => i.p); const live = ps.map((p, i) => [p, i]).filter(([p]) => p !== null).sort((a, b) => a[0] - b[0]); let cut = 0; live.forEach(([p], k) => { if (p <= ((k + 1) * 0.1) / live.length) cut = k + 1; }); return new Set(live.slice(0, cut).map(([, i]) => i)); })();
      P(want.items.filter((i) => i.state === "tested" && refRej.has(want.items.indexOf(i))).length === 6 && want.flagged === 6 && want.m === 47, "the scenario has six flagged among 47 counted names");
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: FX.universe(list) });
      const fn = await page.locator("#mvFnote").innerText();
      P(fn.includes("6 of 7 tested names are beyond the usual after correction."), "the foot counts the flagged names: " + fn.slice(-90));
      const pick = async (t) => {
        const hit = await page.evaluate((x) => { const r = document.querySelector('.mv-row[data-t="' + x + '"]'); if (r) { r.click(); return null; } const e = document.querySelector('.pt[data-t="' + x + '"]'); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, t);
        if (hit) await page.mouse.click(hit[0], hit[1]);
        await page.waitForTimeout(120);
        return railKv(page);
      };
      let rk = await pick("FLAG5");
      P(rk.text.includes(SIG.SIG_FLAGGED_LINE), "a flagged name says it is beyond the usual");
      const w2 = want.items.find((i) => i.t === "FLAG5");
      same([rk.kv["p, own rate"], rk.kv["p, adjusted"]], [w2.p.toFixed(3), w2.adj.toFixed(3)], "its p and adjusted p");
      rk = await pick("NEAR");
      P(rk.text.includes(SIG.SIG_PLAIN_LINE) && !rk.text.includes(SIG.SIG_FLAGGED_LINE), "a tested name that does not pass says so");
      const wn = want.items.find((i) => i.t === "NEAR");
      same(rk.kv["p, adjusted"], wn.adj.toFixed(3), "its adjusted p is over the cut");
      rk = await pick("EVT");
      P(rk.text.includes(SIG.SIG_REASONS.event) && rk.kv["p, own rate"] === undefined, "an earnings name is refused with its reason");
      rk = await pick("Q00");
      P(rk.text.includes(SIG.SIG_REASONS.below) && rk.kv["p, adjusted"] === undefined, "a small move is not tested and says why");
      rk = await pick("NOSC");
      P(rk.big === "NOSC" && rk.text.includes(SIG.SIG_REASONS.noscale), "a name with no scale gets a reason, never a zero");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, body: { status: "pending" } });
      const note = await page.locator("#mvNote").innerText();
      P(/not published yet/.test(note) && await page.locator("#mvStage").isHidden(), "a pending universe says so and draws nothing");
      await ctx.close();
      const m2 = await mount(browser, 1440, 820, { js, status: 500 });
      P(/could not be loaded/.test(await m2.page.locator("#mvNote").innerText()) && await m2.page.locator("#mvStage").isHidden(), "a failed read says so and draws nothing");
      await m2.ctx.close();
      const nocap = await mount(browser, 1440, 820, { js, body: FX.universe(LIST, { noCap: true }) });
      const dn = await dots(nocap.page);
      P(dn.pts.filter((p) => !p.cls.includes("pin")).every((p) => p.r === 2.5), "with no market cap column every dot is the smallest size");
      P((await nocap.page.locator("#mvFnote").innerText()).includes("No market cap is published"), "and the foot says so");
      await nocap.ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 1440, 820, { js, now: "2026-10-19T14:05:00Z" });
      const strips = (rows, session) => page.evaluate(([r, s]) => { window.__strips = { status: "ok", fields: ["chg", "iv30p"], rows: r, session: s }; window.__rtFire(); }, [rows, session]);
      await strips({ LIVE1: [0.08, 0.4], LIVE2: [-0.03, 0.3], BIGUP: [0.01, 0.4] }, "2026-10-19");
      await page.waitForTimeout(150);
      P(/Live roster/.test(await page.locator("#mvStamp").innerText()), "a roster for a newer session replaces the population and says so");
      P((await page.locator("#mvStamp").innerText()).includes("1 of 3 names with a typical day"), "and counts it");
      const live = await listRows(page, "mvNow");
      const val = { LIVE1: 0.08 / (0.4 / SQRT252), LIVE2: 0.03 / (0.3 / SQRT252), BIGUP: 0.01 / (0.4 / SQRT252) };
      same(live.map((r) => r.t), Object.keys(val).sort((x, y) => val[y] - val[x]), "the live roster is ranked by IV-days");
      await page.click("#mvFreeze");
      const st = await page.locator("#mvStamp").innerText();
      P(/Frozen at 17:05 TRT/.test(st) && st.includes(M.FROZEN_LINE), "Freeze prints the time in TRT and says scores are held: " + st);
      P((await page.locator("#mvFreeze").getAttribute("aria-pressed")) === "true" && (await page.locator("#mvFreeze").innerText()) === "Resume", "the button becomes Resume");
      await strips({ LIVE3: [0.2, 0.4], LIVE1: [0.08, 0.4] }, "2026-10-19");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvNow")).map((r) => r.t), live.map((r) => r.t), "while frozen the lists do not move");
      await page.click("#mvFreeze");
      await page.waitForTimeout(150);
      same((await listRows(page, "mvNow")).map((r) => r.t)[0], "LIVE3", "Resume applies the held read");
      P(!/Frozen/.test(await page.locator("#mvStamp").innerText()), "and the frozen line goes");
      await ctx.close();
    }

    {
      const { ctx, page } = await mount(browser, 390, 844, { js, context: VIEWPORTS[2][2] });
      P((await page.locator("#mvSeg5").evaluate((e) => getComputedStyle(e).display)) === "grid", "the phone shows the three-way switch");
      await page.focus('#mvSeg5 [aria-selected="true"]');
      await page.keyboard.press("ArrowRight");
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "lists", "ArrowRight on the switch opens Lists");
      await page.click('#mvNow .mv-row:nth-child(2)');
      await page.waitForTimeout(400);
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "detail", "choosing a row opens Detail on a phone");
      P((await railKv(page)).big === ranked[1].t, "for that name");
      await page.click('#mvSeg5 [data-v="field"]');
      await page.waitForTimeout(150);
      const dd = await dots(page);
      const target = dd.pts.find((p) => p.t === ranked[3].t);
      const box = await page.locator("#mvPlot").boundingBox();
      await page.touchscreen.tap(box.x + target.x + 5, box.y + target.y + 5);
      await page.waitForTimeout(300);
      P(await page.evaluate(() => document.getElementById("mvStage").dataset.view) === "detail" && (await railKv(page)).big === ranked[3].t, "a tap within 22 px of a dot selects it");
      await ctx.close();
    }
  } catch (e) {
    if (!(e instanceof Stop)) problems.push("threw: " + String(e && e.message).split("\n")[0]);
  }
  return problems;
}

const browser = await launch();

{
  const bad = await exercise(browser, undefined, false);
  eq(bad, [], "the page passes the whole exercise: " + bad.slice(0, 3).join(" | "));
}

const MUTANTS = [
  ["IV-days without the square root of 252", "(num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / (iv / SQRT_YEAR))", "(num(chg) === null || num(iv) === null || !(iv > 0) ? null : chg / iv)"],
  ["typical days lose their sign", "z: sig !== null && sig > 0 ? r.chg / sig : null", "z: sig !== null && sig > 0 ? Math.abs(r.chg) / sig : null"],
  ["a name with no typical day drawn at zero", "z: sig !== null && sig > 0 ? r.chg / sig : null", "z: sig !== null && sig > 0 ? r.chg / sig : 0"],
  ["dot area linear in market cap", "rMax * Math.sqrt(cap / capMax)", "rMax * (cap / capMax)"],
  ["the earnings window is one session short", "event: ed !== null && ed <= EVENT_SESSIONS", "event: ed !== null && ed < EVENT_SESSIONS"],
  ["earnings names ranked with the rest", "now: ok.filter((x) => !x.event).sort(byA)", "now: ok.sort(byA)"],
  ["the 1-in-250 floor removed", "SESSIONS / hits > FLOOR_N", "SESSIONS / hits > FLOOR_N * 4"],
  ["the two and three typical day counts swapped", "const hits = level === 3 ? x.f3 : level === 2 ? x.f2 : null;", "const hits = level === 3 ? x.f2 : level === 2 ? x.f3 : null;"],
  ["a hyphen for a minus", "const signed = (m) => (m < 0 ? MINUS :", "const signed = (m) => (m < 0 ? \"-\" :"],
  ["up and down swapped", "const dirOf = (m) => (m > 0 ? \"up\" : m < 0 ? \"dn\" : \"fl\");", "const dirOf = (m) => (m > 0 ? \"dn\" : m < 0 ? \"up\" : \"fl\");"],
  ["Up filter shows fallers", "!(S.dir === \"up\" && !(x.m > 0))", "!(S.dir === \"up\" && !(x.m < 0))"],
  ["Freeze does not hold the order", "function holding() { return S.frozen || S.listHeld; }", "function holding() { return S.listHeld; }"],
  ["the pins dropped", "const PINS = [\"SPY\", \"QQQ\"];", "const PINS = [\"SPYX\"];"],
  ["the axis set by the single largest name", "const DOMAIN_Q = 0.995;", "const DOMAIN_Q = 1;"],
  ["the read time printed in UTC", "F.time(readAt)", "new Date(readAt).toISOString().slice(11, 16) + \" UTC\""],
  ["every hover asks for a card at once", "else cardTimer = setTimeout(() => { if (S.sel === t) run(); }, 220);", "else run();"],
  ["Show more ignores the room in the dialog", "Math.max(1, Math.floor((innerHeight - 24 - 170) / 44))", "999"],
  ["the market cap column used as the typical day", "sig: sig ? sig[i] : null, f2", "sig: cap ? cap[i] / 1e12 : null, f2"],
  ["a boundary curve drawn", "s += '<line class=\"ref\" data-ref=\"y1\"", "s += '<path class=\"boundary\" d=\"M0,0\"/><line class=\"ref\" data-ref=\"y1\""],
  ["the percent change multiplied twice", "const pct = (v) => F.pct(v, 1, true);", "const pct = (v) => F.pct(v * 100, 1, true);"],
  ["no correction: the raw p against the level", "const flag = it.state === \"tested\" && adj[i] <= q;", "const flag = it.state === \"tested\" && it.p <= q;"],
  ["no add-one in the page's rate", "p: (hits + 1) / (SESSIONS + 1) };\n  }\n  function sigRun", "p: hits / SESSIONS };\n  }\n  function sigRun"],
  ["names below 2 left out of the correction", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: 1 };\n    const level", "return { t: x.t, state: \"below\", z, level: null, hits: null, p: null };\n    const level"],
  ["earnings names tested", "if (ed !== null && ed <= EVENT_SESSIONS) return { t: x.t, state: \"event\"", "if (false) return { t: x.t, state: \"event\""],
  ["the flagged sentence on every tested name", "return g.state === \"tested\" ? (g.flag ? SIG_FLAGGED_LINE : SIG_PLAIN_LINE)", "return g.state === \"tested\" ? SIG_FLAGGED_LINE"],
  ["the foot counts the tested as flagged", "M.sg.flagged + \" of \"", "M.sg.tested + \" of \""],
  ["the old muted note back", "<span class=\"sub c\" data-k=\"sig\">' + esc(sigLine(x)) + \"</span>\"", "<span class=\"sub c\" data-k=\"sig\">Significance test: not yet published.</span>\""],
  ["the adjusted p shown as the raw p", "kv(\"p, adjusted\", x.sg.adj.toFixed(3))", "kv(\"p, adjusted\", x.sg.p.toFixed(3))"],
  ["a ring on every name", "if (x.event) s += '<circle", "if (true) s += '<circle"],
];
for (const [name, from, to] of MUTANTS) {
  ok(JS.split(from).length === 2, "the planted build changes the module exactly once: " + name);
  const mutated = JS.replace(from, to);
  const problems = await exercise(browser, mutated, true).catch((e) => ["threw: " + String(e.message).split("\n")[0]]);
  ok(problems.length > 0, "PLANTED WRONG BUILD CAUGHT: " + name + " (first: " + problems[0] + ")");
}

await browser.close();
console.log(`✓ flows-moves-render: ${checks} assertions — the Moves page in Chromium against a synthetic universe of the real shape, no server and no vendor data: no page scroll, no clipped cell and every dialog inside the viewport at 1440x820, 1024x768 and 390x844 in every panel and filter; each dot at the independent position of its typical days and implied multiple, sized by the square root of market cap, shaped by direction and ringed for earnings; the axes by the 99.5th percentile rule; SPY and QQQ pinned; the lists in IV-days with earnings names ranked apart; every rarity sentence equal to rarityText for all 253 counts at both levels; filters, Freeze and the live roster; the drill panel with a lazy card, a failure and a Retry; the keyboard and a phone tap; TRT; no boundary, q or flagged claim; and ${MUTANTS.length} planted wrong builds that each fail`);
