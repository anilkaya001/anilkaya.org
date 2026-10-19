import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const EMIT = nightlyEmit();
const rd = (f) => JSON.parse(fs.readFileSync(path.join(EMIT, f), "utf8"));
const T = "AAPL";
const card = rd(`-card-${T}.json`);
const AT = "2026-10-02T14:30:00.000Z";
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const PAGE_HTML = FLOWS_PAGES.tickerPage({ username: "test" });
const SRC_PATH = "/assets/js/flows-ticker.js";
const SRC = fs.readFileSync(path.join(ROOT, SRC_PATH), "utf8");
const LOADING_READING = "Loading the reading.";
const LOADING_DOSSIER = "Loading this name's dossier.";
const GRACE_LAND_MS = 30;
const GRACE_HELD_MS = 250;

const cite = (id, label, display, o = {}) => ({ id, label, display, asOf: "2026-10-02T14:24:00.000Z", kind: id.split(".")[0], grade: 3, ...o });
const LEAD = "The last price is $127.40, +1.27% from the previous close.";
const READ = {
  version: 1, status: "ready", ticker: T, generated: true, label: "Model wording", model: "@cf/test", modelName: "Test", neurons: 56, tokens: { in: 5400, out: 700 },
  provenance: "Model wording.", note: null, why: null, fingerprint: "d1.abc", asOf: AT, session: "2026-10-01", generatedAt: "2026-10-02T14:31:00.000Z",
  coverage: { ok: 10, partial: 1, withheld: 1, pending: 0 }, tags: [],
  sections: {
    identity: { text: "Example Technologies sells software to mid-sized firms.", cites: [cite("identity.description", "Profile", "Example Technologies", { untrusted: true, asOf: null })] },
    now: { text: LEAD, cites: [cite("price.last", "Last price", "$127.40")] },
    drivers: [{ text: "News flow is steady.", cites: [cite("news.count24h", "Headlines in the last 24 hours", "4")] }],
    tensions: [{ text: "Flow leans to puts while price is stretched.", cites: [cite("flow.strip.lean", "Lean", "0.47")] }],
    unknown: [{ text: "Fundamentals are withheld.", missing: ["fundamentals"] }],
    watch: [{ text: "Below the gamma flip dealers turn short gamma.", cites: [cite("options.engine.level.flip", "Gamma flip", "$124.00")] }],
  },
  refused: [],
};
const SUMMARY = { status: "quiet", scope: T, summary: null, ideas: [], tier: "family", code: null, why: "x", read: READ };
const CARD_X = rd(`-card-x-${T}.json`);
const HIST = fs.existsSync(path.join(EMIT, `-hist-${T}.json`)) ? rd(`-hist-${T}.json`) : { status: "absent" };

const browser = await chromium.launch();

function gates() {
  const g = {};
  for (const k of ["summary", "card-x", "hist"]) {
    let open;
    const p = new Promise((r) => { open = r; });
    g[k] = { p, open, requested: 0, answered: 0 };
  }
  return g;
}

async function load(plan, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const g = gates();
  for (const k of Object.keys(plan)) {
    if (plan[k] && typeof plan[k] === "object") g[k].afterTape = plan[k].afterTape;
    else if (plan[k] !== "held") g[k].open();
  }
  await page.addInitScript((cfg) => {
    let hold = cfg.hold;
    window.__first = null;
    window.__graceSeen = 0;
    const native = window.setTimeout.bind(window), held = [];
    const release = () => { hold = false; while (held.length) { const [fn, args] = held.shift(); native(fn, 0, ...args); } };
    if (hold) window.setTimeout = (fn, ms, ...args) => {
      if (hold && ms === cfg.ms && typeof fn === "function") { window.__graceSeen++; held.push([fn, args]); return -1; }
      return native(fn, ms, ...args);
    };
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.getElementById("ftStatus");
      if (!s) return;
      const grab = () => {
        if (window.__first || s.textContent === "Loading the name…") return;
        const q = (id) => { const e = document.getElementById(id); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
        window.__first = { grid: q("ftGrid"), rail: q("ftReadRail"), verdict: q("ftVerdict"), strip: q("ftStrip"), modules: document.querySelectorAll("#ftGrid > [id]").length, pending: document.querySelectorAll("#ftGrid .ui-state[data-state='pending']").length, graceSeen: window.__graceSeen };
        release();
      };
      new MutationObserver(grab).observe(s, { childList: true, characterData: true, subtree: true });
    });
  }, { hold: !!o.holdGrace, ms: GRACE_HELD_MS });
  const body = { card, "card-x": CARD_X, hist: HIST, summary: SUMMARY, tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(card.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} } };
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === SRC_PATH && o.src) return route.fulfill({ contentType: "text/javascript", body: o.src });
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      const gate = g[key];
      if (gate) { gate.requested++; await gate.p; gate.answered++; }
      if (key === "tape") for (const k of Object.keys(g)) if (g[k].afterTape !== undefined) setTimeout(() => g[k].open(), g[k].afterTape);
      const b = key === "board" ? { status: "pending", rows: [] } : body[key] === undefined ? { status: "pending" } : body[key];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(b) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/ticker/?t=" + encodeURIComponent(T));
  return { page, ctx, g, errors };
}

const painted = (page, ms = 9000) => page.waitForFunction(() => !!window.__first, null, { timeout: ms }).then(() => true, () => false);
const first = (page) => page.evaluate(() => window.__first);
const snap = (page) => page.evaluate(() => {
  const q = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
  const seen = new Set(), dup = [];
  for (const e of document.querySelectorAll("[id]")) { if (seen.has(e.id)) dup.push(e.id); seen.add(e.id); }
  return {
    modules: [...document.querySelectorAll("#ftGrid > [id]")].map((e) => e.id),
    dup,
    chartSvgs: document.querySelectorAll("#ftGlanceChart svg").length,
    glanceHosts: document.querySelectorAll("#ftGlanceChart, #ftGlanceCards").length,
    glanceCards: document.querySelectorAll(".ftg-card").length,
    claims: document.querySelectorAll("#ftReadRail .ft-claim").length,
    rail: q("#ftReadRail"),
    lead: q("#ftReadRail .ft-rail-lead") || q("#ftReadRail .ft-claim-t"),
    verdict: q("#ftVerdict"),
    strip: q("#ftStrip"),
    pending: document.querySelectorAll("#ftGrid .ui-state[data-state='pending']").length,
    heroLoading: document.getElementById("ftHero").classList.contains("is-loading"),
    title: document.getElementById("ftHeroT").textContent,
  };
});
const railFilled = (page) => page.waitForFunction((lead) => (document.getElementById("ftReadRail")?.textContent || "").includes(lead), LEAD, { timeout: 15000 }).then(() => true, () => false);
const dossierFilled = (page) => page.waitForFunction((n) => document.querySelectorAll("#ftGrid .ui-state[data-state='pending']").length <= n, base.pending, { timeout: 15000 }).then(() => true, () => false);
const whyOf = async (page) => {
  await page.evaluate(() => document.querySelector("#ftGrid .ui-state[data-state='pending']").click());
  await page.waitForFunction(() => { const p = document.getElementById("fxPop"); return p && !p.hidden && p.textContent.trim(); }, null, { timeout: 5000 });
  const t = await page.evaluate(() => document.getElementById("fxPop").textContent.replace(/\s+/g, " ").trim());
  await page.keyboard.press("Escape");
  return t;
};

const arm = (page) => page.evaluate(() => {
  const root = document.querySelector("#ftGlanceChart > .ftg-chart");
  if (root) root.dataset.fpKeep = "1";
  const b = [...document.querySelectorAll("#ftDock .ft-dock-b")].find((x) => x.getAttribute("aria-disabled") !== "true");
  if (b) b.click();
  const on = document.querySelector('.ft-sheet .ft-sheet-tab[aria-selected="true"]');
  return { root: !!root, mod: on ? on.dataset.mod : null };
});
const kept = (page) => page.evaluate(() => {
  const root = document.querySelector("#ftGlanceChart > .ftg-chart");
  const sheet = document.querySelector(".ft-sheet");
  const on = sheet && sheet.querySelector('.ft-sheet-tab[aria-selected="true"]');
  return { root: !!(root && root.dataset.fpKeep === "1"), roots: document.querySelectorAll("#ftGlanceChart > .ftg-chart").length, mod: on ? on.dataset.mod : null, seated: on ? !!(sheet.querySelector(".ft-sheet-b > #" + on.dataset.mod)) : false };
});

let base;
base = { pending: 0 };
try {
  {
    const { page, ctx, errors } = await load({ summary: 0, "card-x": 0, hist: 0 });
    ok(await painted(page), "BASELINE: the page paints with every route instant");
    ok(await railFilled(page), "baseline: the reading fills the rail");
    await page.waitForTimeout(500);
    base = await snap(page);
    const f = await first(page);
    ok(base.modules.length >= 8, "baseline draws the dossier modules (" + base.modules.length + ")");
    eq(base.dup, [], "baseline: no duplicate ids");
    ok(base.chartSvgs >= 1, "baseline: the chart is drawn (" + base.chartSvgs + " svg)");
    ok(base.glanceCards >= 4, "baseline: glance cards drawn");
    ok(base.lead && base.lead.startsWith(LEAD), "baseline: the reading rail leads with the now sentence");
    ok(!f.rail.includes(LOADING_READING) && f.pending === base.pending, "a normal open paints with its summary and dossier already in (the 250 ms grace)");
    ok(base.verdict && base.verdict.length > 20, "baseline: a verdict line is drawn");
    eq(errors, [], "baseline: no page error");
    await ctx.close();
  }

  {
    const { page, ctx, g, errors } = await load({ summary: "held", "card-x": 0, hist: 0 });
    ok(await painted(page), "SUMMARY HELD: the page paints while the summary route has not answered");
    ok(g.summary.requested >= 1 && g.summary.answered === 0, "the summary was asked for and is still unanswered at first paint");
    const f = await first(page);
    ok(f.modules >= 8, "the hero and the dossier modules are drawn before the summary (" + f.modules + ")");
    ok(f.rail.includes(LOADING_READING), "the reading rail says " + LOADING_READING + " while the summary is out: " + f.rail.slice(0, 80));
    eq(f.pending, base.pending, "a landed dossier is not shown as pending");
    let s = await snap(page);
    ok(!s.heroLoading, "the hero is out of its loading state");
    eq(s.title, T, "the hero names the ticker");
    g.summary.open();
    ok(await railFilled(page), "the late summary fills the rail");
    await page.waitForTimeout(500);
    s = await snap(page);
    ok(s.lead.startsWith(LEAD), "the rail leads with the now sentence");
    ok(!s.rail.includes(LOADING_READING), "and the loading sentence is gone");
    eq(s.modules, base.modules, "the late summary ends in the same modules, in the same order");
    eq(s.dup, [], "no duplicate id after the late summary");
    eq(s.chartSvgs, base.chartSvgs, "one chart svg, not a second mount");
    eq(s.glanceCards, base.glanceCards, "the glance cards are not doubled");
    eq(s.claims, base.claims, "the claims are numbered as on the baseline");
    eq(s.verdict, base.verdict, "the verdict line is the baseline's");
    eq(s.strip, base.strip, "and so is the strip");
    eq(errors, [], "no page error");
    await ctx.close();
  }

  {
    const { page, ctx, g, errors } = await load({ summary: "held", "card-x": "held", hist: "held" });
    ok(await painted(page), "ALL THREE HELD: the card alone is enough to paint");
    eq(g.summary.answered + g["card-x"].answered + g.hist.answered, 0, "none of the three routes had answered");
    const f = await first(page);
    ok(f.rail.includes(LOADING_READING), "the rail says it is loading");
    ok(f.pending > base.pending, "the dossier modules are drawn as pending (" + f.pending + " against " + base.pending + ")");
    ok((await whyOf(page)).includes(LOADING_DOSSIER), "and the reason they give is that the dossier is loading");
    ok(f.modules >= 8, "the page still draws its modules from the card");
    ok(f.strip && f.strip.length > "Neuron".length && !/No read$/.test(f.strip), "the verdict strip is never blank while the summary is out: " + f.strip);
    const armed = await arm(page);
    ok(armed.root && armed.mod, "(setup) the glance chart is mounted and a module is open in place (" + armed.mod + ")");
    g["card-x"].open(); g.hist.open();
    ok(await dossierFilled(page), "card-x and hist landing repaint the dossier modules");
    await page.waitForTimeout(400);
    const k = await kept(page);
    ok(k.root && k.roots === 1, "the late dossier reaches the glance through update(): the mounted chart is the same node");
    eq(k.mod, armed.mod, "the module open in place is still open after the late dossier");
    ok(k.seated, "and it is seated in the sheet, not lost");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".ft-sheet"), null, { timeout: 5000 });
    let s = await snap(page);
    ok(s.rail.includes(LOADING_READING), "the summary is still out and the rail still says so after the repaint");
    eq(s.dup, [], "one repaint leaves no duplicate id");
    eq(s.chartSvgs, base.chartSvgs, "the chart is not mounted twice by the repaint");
    eq(s.glanceHosts, 2, "one chart host and one cards host");
    eq(s.glanceCards, base.glanceCards, "the glance cards are not doubled by the repaint");
    g.summary.open();
    ok(await railFilled(page), "the summary then lands");
    await page.waitForTimeout(500);
    s = await snap(page);
    eq(s.modules, base.modules, "all three late: the same modules as the baseline");
    eq(s.dup, [], "no duplicate id");
    eq(s.chartSvgs, base.chartSvgs, "the chart is not mounted twice");
    eq(s.glanceCards, base.glanceCards, "the glance cards match the baseline");
    eq(s.claims, base.claims, "claims match");
    eq(s.verdict, base.verdict, "all three late: the verdict line is the baseline's");
    eq(s.lead, base.lead, "and the rail's lead");
    eq(errors, [], "no page error");
    await ctx.close();
  }

  {
    const { page, ctx, g, errors } = await load({ summary: { afterTape: 5000 }, "card-x": 0, hist: 0 });
    ok(await painted(page, 14000), "FIVE-SECOND SUMMARY: the page paints");
    eq(g.summary.answered, 0, "and paints before the summary answers, five seconds after the card is accepted");
    ok(await railFilled(page), "the summary lands");
    await page.waitForTimeout(500);
    const s = await snap(page);
    eq(s.verdict, base.verdict, "a slow summary ends in the baseline's verdict line");
    eq(s.modules, base.modules, "and the baseline's modules");
    eq(s.dup, [], "no duplicate id");
    eq(s.chartSvgs, base.chartSvgs, "the chart is not mounted twice");
    eq(errors, [], "no page error");
    await ctx.close();
  }

  {
    const { page, ctx, g } = await load({ summary: { afterTape: 1500 }, "card-x": 0, hist: 0 });
    ok(await painted(page, 14000), "1.5 SECOND SUMMARY: the page paints");
    eq(g.summary.answered, 0, "before the summary answers, 1.5 s after the card is accepted");
    ok(await railFilled(page), "the summary lands");
    await page.waitForTimeout(400);
    const s = await snap(page);
    eq(s.verdict, base.verdict, "the 1.5 s summary ends in the baseline's verdict line");
    eq(s.modules, base.modules, "and modules");
    await ctx.close();
  }

  {
    const { page, ctx } = await load({ summary: 0, "card-x": { afterTape: GRACE_LAND_MS }, hist: { afterTape: GRACE_LAND_MS } }, { holdGrace: true });
    ok(await painted(page), "GRACE: a dossier that lands after the card, inside the grace, paints");
    const f = await first(page);
    ok(f.graceSeen >= 1, "the first paint armed a " + GRACE_HELD_MS + " ms grace (held by the test until the paint, so a slow machine cannot expire it)");
    eq(f.pending, base.pending, "and the dossier is already in the first paint, which waited the grace for it");
    ok(!f.rail.includes(LOADING_READING), "with the reading");
    await ctx.close();
  }

  {
    const { page, ctx, g } = await load({ summary: 0, "card-x": "held", hist: 0 });
    ok(await painted(page), "CARD-X HELD: paints on the grace alone");
    const f = await first(page);
    ok(f.pending > base.pending, "a dossier route past the grace is drawn as pending");
    ok((await whyOf(page)).includes(LOADING_DOSSIER), "with the loading reason");
    ok(!f.rail.includes(LOADING_READING), "while the landed summary's reading is drawn");
    g["card-x"].open();
    ok(await dossierFilled(page), "the dossier fills when card-x lands");
    await ctx.close();
  }

  const MUTANTS = [
    ["first paint waits on the summary", (s) => s.replace("await Promise.race([Promise.all([cxP, histP]), new Promise((r) => setTimeout(r, DOSSIER_GRACE_MS))]);", "await Promise.all([neuronP, cxP, histP]);"), "painted"],
    ["no grace for the two fast dossier routes", (s) => s.replace("const DOSSIER_GRACE_MS = 250;", "const DOSSIER_GRACE_MS = 0;"), "grace"],
    ["a late summary is never applied", (s) => s.replace("else neuronP.then((neuron) => {", "else neuronP.then((neuron) => { return;"), "summary"],
    ["a late card-x and hist are never applied", (s) => s.replace("Promise.all([cxP, histP]).then(([cx, hist]) => {", "Promise.all([cxP, histP]).then(([cx, hist]) => { return;"), "dossier"],
    ["the late dossier is stored but never repainted", (s) => s.replace("if (STATE.hist === waiting) STATE.hist = joined(hist, card);\n        paintDossier(card);", "if (STATE.hist === waiting) STATE.hist = joined(hist, card);"), "dossier"],
    ["the late dossier remounts the page", (s) => s.replace("if (STATE.hist === waiting) STATE.hist = joined(hist, card);\n        paintDossier(card);", "if (STATE.hist === waiting) STATE.hist = joined(hist, card);\n        if (card.lite) paintLite(card); else paintAll();"), "remount"],
    ["the rail says there is no reading while the summary loads", (s) => s.replace('statePillOf(wait ? "pending" : "quiet"), wait ? "Loading the reading." : "No reading is available for this name."', 'statePillOf("quiet"), "No reading is available for this name."'), "rail"],
  ];
  for (const [name, mutate, kind] of MUTANTS) {
    const src = mutate(SRC);
    ok(src !== SRC, "(setup) the planted build applies: " + name);
    const plan = kind === "dossier" || kind === "remount" ? { summary: 0, "card-x": "held", hist: "held" } : kind === "grace" ? { summary: 0, "card-x": { afterTape: GRACE_LAND_MS }, hist: { afterTape: GRACE_LAND_MS } } : { summary: "held", "card-x": 0, hist: 0 };
    const { page, ctx, g } = await load(plan, { src, holdGrace: kind === "grace" });
    const did = await painted(page, 5000);
    let failed;
    if (!did) failed = true;
    else if (kind === "painted") failed = g.summary.answered > 0;
    else if (kind === "rail") failed = !(await first(page)).rail.includes(LOADING_READING);
    else if (kind === "remount") {
      const armed = await arm(page);
      ok(armed.root && armed.mod, "(setup) the planted build has a mounted chart and a module open in place");
      g["card-x"].open(); g.hist.open();
      await dossierFilled(page);
      await page.waitForTimeout(400);
      const k = await kept(page);
      failed = !k.root || k.mod !== armed.mod || !k.seated;
    }
    else if (kind === "grace") {
      const f = await first(page);
      failed = f.rail.includes(LOADING_READING) || f.pending > base.pending;
    } else if (kind === "summary") {
      g.summary.open();
      failed = !(await railFilled(page));
    } else {
      g["card-x"].open(); g.hist.open();
      failed = !(await dossierFilled(page));
    }
    ok(failed, "PLANTED WRONG BUILD FAILS: " + name);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`flows-ticker-firstpaint-render: ${checks} checks passed`);
