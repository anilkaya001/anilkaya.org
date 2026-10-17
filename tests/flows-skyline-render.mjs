import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as PAGES from "../shared/flows-pages.js";
import { flowsPageRows } from "../server/routes/flows-pages.js";
import { rarityText } from "../shared/flows-targets.js";
import { buildUniverse } from "../shared/flows-cross.js";
import { labelProblems } from "../scripts/approval-checks.mjs";
import { launch } from "./lib/browser.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const FIX = JSON.parse(read("scripts/render-preview.fixtures.json")).market;
const SRC = read("assets/js/flows-skyline.js");
const SKY = "/assets/js/flows-skyline.js";

const SESS = 252, FLOOR = 250, SPAN = 180;
const TICKS = [2, 5, 10, 25, 50, 100, 250];
const SECTORS = ["Technology", "Energy", "Financials"];
const ROWS = [
  ["NVDA", 0, 0.05, 0.30, 40, 0.02, 12, 3],
  ["AAPL", 0, -0.12, 0.30, 40, 0.015, 30, 2],
  ["MSFT", 0, 0.01, 0.30, 40, 0.012, 20, 6],
  ["TSLA", 0, 0.08, 0.50, 40, 0.025, 14, 0],
  ["META", 0, -0.065, 0.35, 40, 0.02, 15, 3],
  ["AMZN", 0, 0.055, 0.40, 40, 0.01, 25, 5],
  ["NFLX", 0, -0.1, 0.45, 40, 0.04, 3, 1],
  ["XOM", 1, -0.03, 0.25, 40, 0.015, 18, 4],
  ["CVX", 1, 0.045, 0.25, 40, 0.03, 10, 2],
  ["JPM", 2, 0.06, 0.20, 40, 0.01, 22, 1],
  ["GS", 2, -0.07, 0.40, 10, 0.02, 11, 2],
  ["BAC", 2, 0.02, null, 40, 0.012, 20, 5],
  ["WFC", 2, 0.05, 0.30, 40],
  ["C", 2, 0.01, 0.30, 40],
];
const universe = (rows, { scale = true, sectors = SECTORS } = {}) => {
  const u = {
    status: "ok", sessionDate: "2026-10-09", n: rows.length, t: rows.map((r) => r[0]), sectors, sec: rows.map((r) => r[1]),
    units: { chg: ["fraction", 1e4], iv30p: ["vol", 1e3], ed: ["sessions", 1] },
    cols: { chg: rows.map((r) => Math.round(r[2] * 1e4)), iv30p: rows.map((r) => (r[3] === null ? null : Math.round(r[3] * 1e3))), ed: rows.map((r) => r[4]) },
  };
  if (scale) {
    u.units.sig = ["fraction", 1e5];
    u.units.f2 = ["days per 252", 1];
    u.units.f3 = ["days per 252", 1];
    u.cols.sig = rows.map((r) => (r[5] === undefined ? null : Math.round(r[5] * 1e5)));
    u.cols.f2 = rows.map((r) => (r[6] === undefined ? null : r[6]));
    u.cols.f3 = rows.map((r) => (r[7] === undefined ? null : r[7]));
  }
  return u;
};

const expectM = (chg, iv) => chg * Math.sqrt(252) / iv;
const sgn = (m) => (m < 0 ? "−" : "+") + Math.abs(m).toFixed(1);
const WHY_TEXT = {
  event: "Earnings within 30 days: event not separated.",
  scale: "No typical-day move is published for this name.",
  under: "It moved under 2 typical days, below the lowest count published.",
};
const WHY_NOTE = { event: "Event not separated", scale: "No move scale published", under: "Under 2 typical days" };

function freqOf(r, event) {
  if (event) return { why: "event", freq: null };
  const sig = r[5];
  if (sig === undefined || sig === null) return { why: "scale", freq: null };
  const k = Math.abs(r[2]) / sig;
  const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;
  if (!level) return { why: "under", freq: null };
  const hits = level === 3 ? r[7] : r[6];
  const floored = hits === 0 || SESS / hits > FLOOR;
  return {
    why: "",
    freq: {
      level, hits, floored, n: floored ? FLOOR : SESS / hits,
      short: floored ? "rarer than 1 in 250" : "1 in " + Math.round(SESS / hits),
      sentence: rarityText({ k: level, sigmaRef: sig, route: "empirical", hits }),
    },
  };
}

const EXP = ROWS.filter((r) => r[3] !== null && Math.abs(expectM(r[2], r[3])) >= 2).map((r) => {
  const m = expectM(r[2], r[3]);
  const event = r[4] <= 21;
  return { t: r[0], m, event, ...freqOf(r, event) };
});
const BY_T = new Map(EXP.map((e) => [e.t, e]));
const H = (e) => Math.abs(e.m);
const MAXH = Math.max(...EXP.map(H));
const tie = (a, b) => (a.t < b.t ? -1 : 1);
const TALLEST = EXP.slice().sort((a, b) => H(b) - H(a) || tie(a, b)).slice(0, 3).map((e) => e.t);
const RAREST = EXP.filter((e) => e.freq).sort((a, b) => b.freq.n - a.freq.n || H(b) - H(a) || tie(a, b)).slice(0, 3).map((e) => e.t);
const ORDER = {
  ivdays: EXP.slice().sort((a, b) => H(b) - H(a) || tie(a, b)).map((e) => e.t),
  often: EXP.slice().sort((a, b) => (b.freq ? b.freq.n : 0) - (a.freq ? a.freq.n : 0) || H(b) - H(a) || tie(a, b)).map((e) => e.t),
};

{
  eq(EXP.map((e) => e.t).sort(), ["AAPL", "AMZN", "CVX", "GS", "JPM", "META", "NFLX", "NVDA", "TSLA", "WFC"], "the fixture's prisms worked by hand: ten names at or beyond 2 IV-days");
  eq(EXP.filter((e) => e.freq).map((e) => e.t).sort(), ["AAPL", "AMZN", "JPM", "META", "NFLX", "NVDA", "TSLA"], "seven of them carry a count");
  eq(TALLEST, ["AAPL", "JPM", "NFLX"], "the three tallest in IV-days");
  eq(RAREST, ["JPM", "TSLA", "AAPL"], "the three rarest: two at the floor (tallest first), then 1 in 126");
  eq(["JPM", "TSLA"].map((t) => BY_T.get(t).freq.sentence.includes("rarer than 1 in 250 sessions")), [true, true], "a count of 1 and a count of 0 are both floored by the reader rule");
  ok(BY_T.get("TSLA").freq.sentence.includes("at 95%"), "and a zero count adds the 95% bound");
}

{
  const rows = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => true, scenesOn: (env) => env.on });
  const market = rows.find((r) => r.id === "flows.pages.market");
  const get = async (env) => (await market.handler({ request: new Request("https://x.test/flows/market/"), env, url: new URL("https://x.test/flows/market/") })).text();
  ok((await get({ on: true })).includes('id="mkSkylineCard"'), "THE SKYLINE MODULE IS IN THE PAGE WHEN THE SWITCH PASSES");
  ok(!(await get({ on: false })).includes("mkSkyline"), "and absent when it does not");
  const bare = flowsPageRows({ currentFlowsUser: async () => ({ username: "u" }), readFlowsSummary: async () => null, isOwner: () => true }).find((r) => r.id === "flows.pages.market");
  ok(!(await bare.handler({ request: new Request("https://x.test/flows/market/"), env: {}, url: new URL("https://x.test/flows/market/") }).then((x) => x.text())).includes("mkSkyline"), "a router with no switch defaults to off");
  const w = read("worker.js");
  ok(/scenesOn: \(env, username\) => \{\s*const mode = String\(\(env && env\.FLOWS_SCENES\) \|\| ""\)\.trim\(\)\.toLowerCase\(\);\s*return mode === "on" \|\| \(mode === "owner" && rtIsOwner\(/.test(w), "the Worker admits FLOWS_SCENES=on for every member, and owner only for an owner");
  ok(/^FLOWS_SCENES = "on"$/m.test(read("wrangler.toml")), "wrangler.toml ships the switch on");
  ok(!PAGES.marketPage({ username: "u", owner: true }).includes("mkSkyline"), "an owner page without the switch has no skyline");
  ok(!/data-defer="skyline"/.test(PAGES.marketPage({ username: "u" })), "a member page declares no skyline group");
  eq(PAGES.marketPage({ username: "u", owner: true, scenes: true }).match(/<i\b[^>]*data-defer="skyline"[^>]*>/g).length, 1, "the owner page declares the group once");
  ok(!/requestAnimationFrame|setInterval|setTimeout|\.animate\(/.test(SRC), "the module runs no animation loop and no timer: a toggle repaints once, so reduced motion has nothing to turn off");
  ok(!/sigma/i.test(SRC) && !/probab|chance/i.test(SRC.replace(/not a probability\./, "")), "no sigma wording and no probability claim in the module's strings");
}

const HOOK = () => {
  window.__text = [];
  window.__dash = 0;
  const p = CanvasRenderingContext2D.prototype;
  const ft = p.fillText, sd = p.setLineDash, cr = p.clearRect;
  const mine = (g) => Boolean(g.canvas && g.canvas.classList && g.canvas.classList.contains("mk-sky-c"));
  p.clearRect = function (...a) { if (mine(this)) { window.__text = []; window.__dash = 0; } return cr.apply(this, a); };
  p.fillText = function (t, ...a) { if (mine(this)) window.__text.push(String(t)); return ft.call(this, t, ...a); };
  p.setLineDash = function (d) { if (mine(this) && d && d.length) window.__dash++; return sd.call(this, d); };
};

const assetRoute = (source) => async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === SKY) return route.fulfill({ body: source, contentType: "text/javascript" });
  const f = path.join(ROOT, u.pathname);
  if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
};

async function open(browser, { viewport = { width: 1440, height: 900 }, uni = universe(ROWS), source = SRC } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(HOOK);
  const page = await context.newPage();
  const log = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  const assets = assetRoute(source);
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    log.push(u.pathname);
    if (u.pathname.startsWith("/assets/")) return assets(route);
    if (u.pathname.startsWith("/api/rt/")) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "rt_off", message: "off" } }) });
    if (u.pathname.startsWith("/api/flows/universe")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(uni) });
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length) + u.search;
      const k = Object.keys(FIX).find((x) => key.includes(x.replace(/^flows\//, "")));
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(k ? FIX[k] : { status: "pending", rows: [] }) });
    }
    if (u.pathname.startsWith("/flows/")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGES.marketPage({ username: "test", owner: true, scenes: true }) });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/flows/market/", { waitUntil: "commit" });
  return { context, page, log, errors };
}

async function harness(browser, { width = 1100, uni = universe(ROWS), source = SRC, tokens = null, reducedMotion = "no-preference" } = {}) {
  const context = await browser.newContext({ viewport: { width: Math.max(width + 40, 360), height: 900 }, deviceScaleFactor: 1, reducedMotion });
  await context.addInitScript(HOOK);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const assets = assetRoute(source);
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) return assets(route);
    if (u.pathname === "/harness") {
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/css/base.css"><link rel="stylesheet" href="/assets/css/flows.css"><link rel="stylesheet" href="/assets/css/flows-market.css"></head><body><main id="flowsMain"><div id="mkSkyline" style="width:${width}px"></div></main><script src="/assets/js/flows-ui.js"></script><script src="/assets/js/flows-skyline.js"></script></body></html>`,
      });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("https://example.test/harness");
  await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.skyline && window.FlowsUI.segmented);
  if (tokens) await page.evaluate((t) => { for (const [k, v] of Object.entries(t)) document.documentElement.style.setProperty(k, v); }, tokens);
  await mountIn(page, uni);
  return { context, page, errors };
}

const mountIn = async (page, uni) => {
  await page.evaluate((u) => {
    const old = document.getElementById("mkSkyline");
    const host = old.cloneNode(false);
    old.replaceWith(host);
    window.__md = u;
    window.__text = [];
    window.__dash = 0;
    window.__mounted = window.FlowsUI.skyline.mount(host, u);
  }, uni);
  await sleep(250);
};

const reveal = async (page) => {
  await page.waitForSelector("#mkSkyline", { state: "attached", timeout: 15000 });
  await page.click("#mkT-extremes");
  if (await page.evaluate(() => getComputedStyle(document.getElementById("mkSub")).display !== "none")) await page.click("#mkSub button:has-text('Move skyline')");
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => document.getElementById("mkSkylineCard").scrollIntoView({ block: "center" }));
    if (await page.evaluate(() => Boolean(document.getElementById("mkSkyline").dataset.state))) return;
    await sleep(250);
  }
  throw new Error("the skyline never mounted");
};

const TAB = { ivdays: 0, often: 1 };
const tabs = (page) => page.locator('#mkSkyline [role="tab"]');
async function switchTo(page, mode, how = "click") {
  await page.evaluate(() => { window.__text = []; window.__dash = 0; });
  if (how === "key") {
    await page.locator('#mkSkyline [role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press(mode === "often" ? "ArrowRight" : "ArrowLeft");
  } else {
    await tabs(page).nth(TAB[mode]).click();
  }
  await page.waitForFunction((m) => document.getElementById("mkSkyline").dataset.mode === m, mode, { timeout: 5000 });
  await sleep(300);
}

const inspect = (page) => page.evaluate(() => {
  const host = document.getElementById("mkSkyline");
  const sc = window.__mounted && window.__mounted.scene ? window.__mounted.scene() : null;
  const canvas = host.querySelector("canvas");
  const rowsOf = (sel) => [...host.querySelectorAll(sel + " tbody tr")].map((tr) => ({ t: tr.dataset.t, dir: tr.dataset.dir, cells: [...tr.children].map((c) => c.textContent) }));
  let samples = [];
  if (sc && canvas && !canvas.hidden) {
    const g = canvas.getContext("2d");
    const its = sc.items;
    samples = its.map((it, i) => {
      const x = Math.round(it.x - it.w / 2), y = Math.round((it.yt + it.yb) / 2 + it.w / 4);
      const behind = its.slice(i + 1).some((o) => x >= o.x - o.w - 2 && x <= o.x + o.w + 2 && y >= o.yt - o.w * 0.5 - 20 && y <= o.yb + o.w * 0.5 + 2);
      const under = sc.callouts.some((c) => x >= c.x - 2 && x <= c.x + c.w + 2 && y >= c.y - 2 && y <= c.y + c.h + 2);
      return behind || under ? null : { t: it.t, dir: it.dir, d: Array.from(g.getImageData(x, y, 1, 1).data) };
    }).filter(Boolean);
  }
  return {
    mode: host.dataset.mode, state: host.dataset.state, text: window.__text.slice(), dash: window.__dash, samples,
    aria: canvas ? canvas.getAttribute("aria-label") : null, hidden: canvas ? canvas.hidden : null,
    rows: rowsOf(".mk-sky-t"), calls: rowsOf(".mk-sky-co"),
    captions: [...host.querySelectorAll("caption")].map((c) => c.textContent),
    notes: [...host.querySelectorAll(".mk-sky-n")].map((n) => ({ text: n.textContent, hidden: n.hidden || getComputedStyle(n).display === "none" })),
    tabs: [...host.querySelectorAll('[role="tab"]')].map((t) => ({ text: t.textContent, selected: t.getAttribute("aria-selected"), disabled: t.disabled })),
    sc: sc && {
      W: sc.W, H: sc.H, mode: sc.mode, unit: sc.unit, span: sc.span, axis: sc.axis,
      items: sc.items.map((i) => ({ t: i.t, h: i.h, v: i.v, d: i.yb - i.yt, dir: i.dir, event: i.event, floored: i.floored, x: i.x, yb: i.yb, yt: i.yt, w: i.w })),
      callouts: sc.callouts.map((c) => ({ t: c.t, head: c.head, glyph: c.glyph, lines: c.lines, x: c.x, y: c.y, w: c.w, h: c.h, dir: c.dir })),
      labels: sc.labels, leaders: sc.leaders, solids: sc.solids,
    },
  };
});

function verify(r, mode) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  const sc = r.sc;
  if (!sc) return ["the scene is missing"];
  need(r.mode === mode && sc.mode === mode, `the module is in ${r.mode}/${sc.mode}, not ${mode}`);
  const list = mode === "often" ? EXP.filter((e) => e.freq) : EXP;
  const got = sc.items.map((i) => i.t).sort(), want = list.map((e) => e.t).sort();
  need(JSON.stringify(got) === JSON.stringify(want), `prisms ${got} are not ${want}`);
  const unit = SPAN / Math.max(MAXH, 4);
  for (const i of sc.items) {
    const e = BY_T.get(i.t);
    if (!e) continue;
    const d = mode === "often" ? SPAN * Math.log10(e.freq ? e.freq.n : 1) / Math.log10(FLOOR) : H(e) * unit;
    need(Math.abs(i.h - H(e)) < 1e-9, `${i.t} carries |${e.m}| IV-days, not ${i.h}`);
    need(Math.abs(i.d - d) < 1e-6, `${i.t} drawn height ${i.d} is not ${d} in ${mode}`);
    need(i.dir === Math.sign(e.m), `${i.t} direction ${i.dir}`);
    need(i.event === (mode === "ivdays" && e.event), `${i.t} event mark ${i.event}`);
    need(i.floored === (mode === "often" && e.freq.floored), `${i.t} floor mark ${i.floored}`);
  }
  const ax = sc.axis;
  if (mode === "often") {
    need(ax.log === true && ax.title === "How often, log scale", "the axis says it is a log scale");
    need(JSON.stringify(ax.ticks.map((t) => t.text)) === JSON.stringify(TICKS.map((n) => (n === FLOOR ? "1 in 250 (floor)" : "1 in " + n))), "the printed tick values are 1 in 2, 5, 10, 25, 50, 100 and the 250 floor");
    ax.ticks.forEach((t, i) => need(Math.abs(t.y - (sc.H - 20 - SPAN * Math.log10(TICKS[i]) / Math.log10(FLOOR))) < 1e-6, `tick ${t.text} sits at ${t.y}, off the log position`));
    need(Math.abs(ax.span - SPAN) < 1e-6, "the axis is as long as the floor's height");
  } else {
    need(ax.log === false && ax.ticks.length === 1 && ax.ticks[0].text === "2 IV-days" && Math.abs(ax.ticks[0].y - (sc.H - 20 - unit)) < 1e-6, "the IV-days bar is two units long");
  }
  const calls = mode === "often" ? RAREST : TALLEST;
  need(JSON.stringify(sc.callouts.map((c) => c.t).sort()) === JSON.stringify(calls.slice().sort()), `callouts ${sc.callouts.map((c) => c.t)} are not ${calls}`);
  const expectText = new Set(ax.ticks.map((t) => t.text));
  if (ax.title) expectText.add(ax.title);
  for (const c of sc.callouts) {
    const e = BY_T.get(c.t);
    if (!e) continue;
    const said = e.freq ? e.freq.sentence : WHY_TEXT[e.why];
    need(c.lines.join(" ") === said, `${c.t} callout says "${c.lines.join(" ")}", not "${said}"`);
    need(c.head === `${c.t} ${sgn(e.m)} IV-days` && c.glyph === (e.m > 0 ? "▲" : "▼"), `${c.t} callout head "${c.glyph} ${c.head}" is not signed`);
    expectText.add(c.glyph);
    expectText.add(c.head);
    for (const l of c.lines) expectText.add(l);
  }
  need(JSON.stringify([...new Set(r.text)].sort()) === JSON.stringify([...expectText].sort()), `the canvas text is not the axis and the callouts only (${mode}): ${[...new Set(r.text)].filter((x) => !expectText.has(x))}`);
  const lp = labelProblems(sc.labels, sc.solids, { w: sc.W, h: sc.H }, sc.leaders);
  need(lp.length === 0, `callouts overlap: ${lp.join("; ")}`);
  const withHue = r.samples.filter((s) => Math.abs(s.d[0] - s.d[1]) > 20);
  for (const s of withHue) need(s.dir > 0 ? s.d[1] > s.d[0] : s.d[0] > s.d[1], `prism ${s.t} colour (${s.d}) carries its direction ${s.dir}`);
  need(withHue.filter((s) => s.dir > 0).length >= 1 && withHue.filter((s) => s.dir < 0).length >= 1, `at least one up and one down prism are sampled (${withHue.length} of ${r.samples.length})`);
  for (const x of r.rows) {
    const e = BY_T.get(x.t);
    need(Boolean(e) && x.dir === (e.m > 0 ? "up" : "down") && x.cells[3] === sgn(e.m) && x.cells[4].startsWith(e.m > 0 ? "▲" : "▼"), `${x.t} table direction and sign`);
    need(Boolean(e) && x.cells[5] === (e.freq ? e.freq.short : "—") && x.cells[6] === (e.why ? WHY_NOTE[e.why] : ""), `${x.t} table frequency and note: ${x.cells.slice(5)}`);
  }
  need(JSON.stringify(r.rows.map((x) => x.t)) === JSON.stringify(ORDER[mode]), `the table order ${r.rows.map((x) => x.t)} is not ${ORDER[mode]}`);
  need(JSON.stringify(r.calls.map((x) => x.t)) === JSON.stringify(sc.callouts.length ? ranked(mode) : []), `the callout table lists ${r.calls.map((x) => x.t)}`);
  for (const x of r.calls) {
    const e = BY_T.get(x.t);
    need(Boolean(e) && x.cells[2] === sgn(e.m) && x.cells[3] === (e.freq ? e.freq.sentence : WHY_TEXT[e.why]), `${x.t} callout table row`);
  }
  const dashWanted = mode === "ivdays";
  need(dashWanted ? r.dash > 0 : r.dash === 0, `event prisms are dashed in IV-days and not drawn in how-often (${r.dash} dashes)`);
  return bad;
}

const ranked = (mode) => (mode === "often" ? RAREST : TALLEST).slice().sort((a, b) => {
  const ea = BY_T.get(a), eb = BY_T.get(b);
  return mode === "often" ? eb.freq.n - ea.freq.n || H(eb) - H(ea) || tie(ea, eb) : H(eb) - H(ea) || tie(ea, eb);
});

const clean = async (page, mode) => {
  const r = await inspect(page);
  return { r, bad: verify(r, mode) };
};

const browser = await launch();
try {
  {
    const { context, page, log, errors } = await open(browser);
    await page.waitForFunction(() => window.FlowsUI && window.FlowsUI.marketKit, null, { timeout: 15000 });
    await reveal(page);
    await page.waitForFunction(() => document.querySelector("#mkSkyline canvas"), null, { timeout: 15000 });
    eq(log.filter((p) => p === SKY).length, 1, "THE SKYLINE FILE IS REQUESTED ONCE, after the universe was read, and mounts without its tab being open");
    await mountIn(page, await page.evaluate(async () => (await fetch("/api/flows/universe")).json()));
    const model = await page.evaluate(() => window.FlowsUI.skyline.model(window.__md));
    eq(model.prisms.map((p) => p.t).sort(), EXP.map((k) => k.t).sort(), "the model keeps exactly the names beyond 2 IV-days, a null previous IV and a small move left out");
    eq([model.plotted, model.absent.scale, model.absent.under, model.absent.event], [7, ["WFC"], ["CVX"], ["GS"]], "seven prisms carry a count; the model names the one with no published scale, the one under 2 typical days and the earnings name");
    eq(model.prisms.filter((p) => p.often).map((p) => [p.t, p.often.level, p.often.hits, p.often.floored]).sort(), EXP.filter((e) => e.freq).map((e) => [e.t, e.freq.level, e.freq.hits, e.freq.floored]).sort(), "each count is the rung's own: 3x for a name that moved 3 typical days, 2x below that");

    const iv = await clean(page, "ivdays");
    eq(iv.bad, [], "IV-DAYS: HEIGHT IS |IV-DAYS|, DIRECTION IS ON THE COLOUR CHANNEL AND IN THE TABLE, ONLY THE THREE TALLEST ARE LABELLED, AND NO LABEL SITS ON A PRISM");
    eq(iv.r.tabs, [{ text: "IV-days", selected: "true", disabled: false }, { text: "How often", selected: "false", disabled: false }], "the toggle offers IV-days and How often, IV-days first");
    ok(iv.r.notes.some((n) => /No selection line|no error rate has been measured/.test(n.text)) && iv.r.notes.some((n) => /Earnings within 30 days: event not separated\./.test(n.text)), "the module says no error rate is measured and names the event rows");
    ok(iv.r.notes.find((n) => n.text.includes("Height is the move in IV-days")) && iv.r.notes.filter((n) => n.hidden).length === 1, "the absent-names note is hidden while the picture is in IV-days");
    ok(/2 IV-days or more/.test(iv.r.aria) && iv.r.aria.includes("Called out, tallest first: AAPL") && iv.r.captions.length === 2, "the canvas is described with its callouts and two tables are the alternative");
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal overflow at 1440");

    await switchTo(page, "often", "key");
    const of = await clean(page, "often");
    eq(of.bad, [], "HOW OFTEN: HEIGHT IS THE COUNT OF PAST DAYS ON A LOG AXIS WITH PRINTED TICKS, FLOORED AT 1 IN 250, THE THREE RAREST ARE LABELLED WITH THE READER RULE'S SENTENCE, AND THE NAMES WITHOUT A COUNT ARE LISTED");
    eq(of.r.tabs.map((t) => t.selected), ["false", "true"], "the arrow key moved the selection to How often");
    const absent = of.r.notes.find((n) => n.text.startsWith("Drawn here:"));
    ok(absent && !absent.hidden && absent.text === "Drawn here: 7 of 10. Shown in IV-days only, not here: no typical-day move published: WFC; under 2 typical days, below the lowest count published: CVX; earnings within 30 days, event not separated: GS.", `the note lists who is not drawn and why (${absent && absent.text})`);
    ok(of.r.notes.some((n) => /log scale from 1 in 2 to 1 in 250/.test(n.text) && /not a forecast/.test(n.text)), "the note names the log scale, its range and that it is not a forecast");
    ok(!/sigma|probab|chance/i.test(of.r.notes.map((n) => n.text).join(" ") + of.r.aria + of.r.text.join(" ")), "no sigma wording and no probability claim anywhere on the module");
    ok(of.r.aria.includes("Called out, rarest first: JPM") && of.r.aria.includes("log scale"), "the canvas description follows the encoding");
    ok(of.r.sc.items.filter((i) => i.floored).map((i) => i.t).sort().join() === "JPM,TSLA", "the floor mark (a line above the prism) is on the two prisms at the floor and no other");
    const joined = of.r.sc.callouts.map((c) => c.lines.join(" "));
    ok(joined.length === 3 && joined.every((s) => /(?:about|rarer than) 1 in \d+ sessions for this name over the last year/.test(s)), "every frequency on the canvas is a 1 in N sessions sentence of the reader rule");
    const printed = joined.flatMap((s) => [...s.matchAll(/about 1 in (\d+) sessions/g)].map((m) => Number(m[1])));
    ok(printed.length >= 1 && printed.every((n) => n <= FLOOR), "and no 1 in N is printed past the floor");

    await switchTo(page, "ivdays", "key");
    eq((await clean(page, "ivdays")).bad, [], "the arrow key back repaints the IV-days picture exactly");
    await switchTo(page, "often", "click");
    eq((await clean(page, "often")).bad, [], "and a click on How often does the same as the key");
    eq(errors, [], "no page error");
    await context.close();
  }

  for (const width of [390, 320]) {
    const { context, page, errors } = await open(browser, { viewport: { width, height: 800 } });
    await reveal(page);
    await page.waitForFunction(() => document.querySelector("#mkSkyline table"), null, { timeout: 15000 });
    ok(await page.evaluate(() => document.querySelector("#mkSkyline canvas").hidden && document.querySelector("#mkSkyline details.mk-sky-d").hidden), `AT ${width} PX THE CALLOUT TABLE STANDS IN FOR THE CANVAS AND THE NAMES ARE ONE BUTTON AWAY`);
    for (const mode of ["ivdays", "often"]) {
      if (mode === "often") await switchTo(page, "often", "key");
      await page.click("#mkSkyline .nm-link");
      await page.waitForSelector("#mkSkyline dialog[open] .mk-sky-t");
      const r = await inspect(page);
      await page.keyboard.press("Escape");
      eq(r.calls.map((x) => x.t), ranked(mode), `${width}: the callout table lists the three ${mode === "often" ? "rarest" : "tallest"}`);
      eq(r.rows.map((x) => x.t), ORDER[mode], `${width}: the names table is ${mode === "often" ? "rarest" : "largest"} first`);
      const rects = await page.evaluate(() => [...document.querySelectorAll("#mkSkyline .mk-sky-co tbody tr")].map((tr) => { const b = tr.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
      ok(rects.length === 3 && rects.every((a, i) => a.x >= 0 && a.x + a.w <= width + 0.5 && (i === 0 || a.y >= rects[i - 1].y + rects[i - 1].h - 0.5)), `${width}: the callout rows are inside the viewport and do not overlap each other (${mode})`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${width}: no horizontal overflow (${mode})`);
    }
    eq(await tabs(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height >= 28)), [true, true], `${width}: the toggle's targets are at least 28 px tall`);
    eq(errors, [], `no page error at ${width}`);
    await context.close();
  }

  for (const width of [640, 700, 820, 1100, 1440]) {
    const { context, page, errors } = await harness(browser, { width });
    for (const mode of ["ivdays", "often"]) {
      if (mode === "often") await switchTo(page, "often", "click");
      const r = await inspect(page);
      eq(verify(r, mode), [], `AT ${width} PX THE ${mode === "often" ? "HOW-OFTEN" : "IV-DAYS"} PICTURE HOLDS: heights, ticks, callouts clear of every prism and of each other, no leader across a prism`);
      ok(r.sc.callouts.every((c) => c.x + c.w <= r.sc.W && c.x > 0) && r.sc.items.every((i) => i.x > 130), `${width}: the callouts are inside the frame and the prisms are right of the axis`);
    }
    eq(errors, [], `no page error at ${width}`);
    await context.close();
  }

  {
    const many = [];
    for (let i = 0; i < 55; i++) {
      const row = ["N" + String(i).padStart(2, "0"), i % 3, (i % 2 ? 1 : -1) * (0.05 + i * 0.001), 0.3, 40];
      many.push(i % 7 === 3 ? row : [...row, 0.01 + (i % 5) * 0.004, 4 + ((i * 7) % 26), (i * 3) % 9]);
    }
    const dense = universe(many);
    const { context, page } = await harness(browser, { width: 1100, uni: dense });
    const md = await page.evaluate(() => window.FlowsUI.skyline.model(window.__md));
    eq(md.prisms.length, 40, "AT MOST 40 PRISMS: 55 names beyond the line keep the 40 largest");
    eq(md.beyond, 55, "and the count beyond the line is still 55");
    const kept = new Set(md.prisms.map((p) => p.t));
    ok(many.slice().sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 40).every((r) => kept.has(r[0])), "the 40 are the 40 largest by IV-days");
    ok(md.plotted > 10 && md.plotted < 40, `some of the 40 carry a count and some are under 2 typical days (${md.plotted})`);
    for (const width of [640, 760, 900, 1100, 1440]) {
      for (const mode of ["ivdays", "often"]) {
        const lay = await page.evaluate(({ w, m }) => {
          const sc = window.FlowsUI.skyline.layout(window.FlowsUI.skyline.model(window.__md), w, 360, { mode: m });
          return { W: sc.W, H: sc.H, labels: sc.labels, solids: sc.solids, leaders: sc.leaders, n: sc.items.length };
        }, { w: width, m: mode });
        eq(labelProblems(lay.labels, lay.solids, { w: lay.W, h: lay.H }), [], `${lay.n} prisms at ${width} px, ${mode}: no callout touches a prism or another callout or leaves the frame`);
        ok(lay.labels.length === 3, `${width} ${mode}: three callouts`);
        eq(labelProblems(lay.labels, lay.solids, { w: lay.W, h: lay.H }, lay.leaders), [], `${width} ${mode}: and no leader crosses a prism or another leader, even with ${lay.n} prisms`);
      }
    }
    await context.close();
  }

  {
    const { context, page, errors } = await harness(browser, { width: 1100, uni: universe(ROWS, { scale: false }) });
    const r = await inspect(page);
    eq(r.tabs, [{ text: "IV-days", selected: "true", disabled: false }, { text: "How often", selected: "false", disabled: true }], "WITHOUT THE PER-NAME SCALE THE HOW-OFTEN OPTION IS OFF, NOT EMPTY");
    await page.locator('#mkSkyline [role="tab"][aria-selected="true"]').focus();
    await page.keyboard.press("ArrowRight");
    await sleep(300);
    eq((await inspect(page)).mode, "ivdays", "and the arrow key cannot select it");
    const after = await inspect(page);
    const off = after.notes.find((n) => n.text.startsWith("How often is off"));
    ok(off && !off.hidden && /Drawn here: 0 of 10\./.test(off.text) && /no typical-day move published: AAPL/.test(off.text), "the note says it is off and lists every name: none has a published scale");
    eq(after.sc.items.length, 10, "and all ten prisms are still drawn in IV-days");
    const unit = SPAN / Math.max(MAXH, 4);
    ok(after.sc.items.every((i) => Math.abs(i.d - i.h * unit) < 1e-6) && after.rows.every((x) => x.cells[5] === "—"), "the IV-days heights are unchanged by the missing columns and the table prints a dash for every frequency");
    ok(after.calls.every((x) => x.cells[3] === (x.t === "GS" ? WHY_TEXT.event : WHY_TEXT.scale)), "and each callout says why it has no frequency");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const part = universe(ROWS);
    part.cols.f3 = part.cols.f3.map((v, i) => (ROWS[i][0] === "AAPL" ? null : v));
    part.cols.sig = part.cols.sig.map((v, i) => (ROWS[i][0] === "NFLX" ? 0 : v));
    const { context, page } = await harness(browser, { width: 1100, uni: part });
    const md = await page.evaluate(() => window.FlowsUI.skyline.model(window.__md));
    eq(md.absent.scale.sort(), ["AAPL", "NFLX", "WFC"], "A MISSING COUNT OR A ZERO SCALE IS ABSENCE, NEVER ZERO: the name is listed, not drawn at the floor");
    eq(md.plotted, 5, "five prisms keep a count");
    await context.close();
  }

  {
    const vendor = (ticker, sector, close, prev, iv, earn) => ({ ticker, sector, marketcap: 1e11, close, prev_close: prev, iv30d_1d: iv, next_earnings_date: earn });
    const rows = [
      vendor("NVDA", "Technology", 105, 100, 0.30, "2026-12-01"), vendor("AAPL", "Technology", 88, 100, 0.30, "2026-12-01"),
      vendor("JPM", "Financials", 106, 100, 0.20, "2026-12-01"), vendor("GS", "Financials", 93, 100, 0.40, "2026-10-14"),
      vendor("WFC", "Financials", 105, 100, 0.30, "2026-12-01"), vendor("MSFT", "Technology", 101, 100, 0.30, "2026-12-01"),
    ];
    const sigma = new Map([["NVDA", { s: 0.02, f2: 12, f3: 3 }], ["AAPL", { s: 0.015, f2: 30, f3: 2 }], ["JPM", { s: 0.01, f2: 22, f3: 1 }], ["GS", { s: 0.02, f2: 11, f3: 2 }], ["MSFT", { s: 0.012, f2: 20, f3: 6 }]]);
    const built = buildUniverse(rows, { sessionDate: "2026-10-09", generatedAt: "2026-10-09T21:45:00Z", sigma });
    ok(built.status === "ok" && built.cols.sig && built.cols.f2 && built.cols.f3 && built.units.sig[0] === "fraction" && built.units.f2[0] === "days per 252", "the nightly's own universe builder publishes the three columns the skyline reads");
    const { context, page, errors } = await harness(browser, { width: 1100, uni: built });
    const md = await page.evaluate(() => window.FlowsUI.skyline.model(window.__md));
    eq(md.prisms.map((p) => [p.t, p.often ? [p.often.level, p.often.hits, p.often.floored, p.often.text] : p.why]).sort(),
      [["AAPL", [3, 2, false, rarityText({ k: 3, sigmaRef: 0.015, route: "empirical", hits: 2 })]], ["GS", "event"],
        ["JPM", [3, 1, true, rarityText({ k: 3, sigmaRef: 0.01, route: "empirical", hits: 1 })]],
        ["NVDA", [2, 12, false, rarityText({ k: 2, sigmaRef: 0.02, route: "empirical", hits: 12 })]], ["WFC", "scale"]].sort(),
      "THE SKYLINE READS THE NIGHTLY'S OWN PAYLOAD: sig, f2 and f3 decode to the rung, the count and the reader rule's sentence, a name outside the map is absence and the earnings name is apart");
    await switchTo(page, "often", "click");
    const r = await inspect(page);
    eq(r.sc.items.map((i) => i.t).sort(), ["AAPL", "JPM", "NVDA"], "and How often draws exactly the three with a count");
    eq(labelProblems(r.sc.labels, r.sc.solids, { w: r.sc.W, h: r.sc.H }, r.sc.leaders), [], "with every callout and leader clear");
    eq(errors, [], "no page error");
    await context.close();
  }

  {
    const { context, page } = await harness(browser, { width: 1100, uni: universe([["AAA", 0, 0.01, 0.3, 40], ["BBB", 1, -0.01, 0.3, 40]]) });
    ok(await page.evaluate(() => document.getElementById("mkSkyline").dataset.state === "quiet" && /That is a reading, not a forecast/.test(document.getElementById("mkSkyline").textContent)), "WHEN NOTHING CROSSES THE LINE THE MODULE SAYS SO IN TEXT");
    await context.close();
  }

  {
    const { context, page } = await harness(browser, { width: 1100, uni: { status: "pending", rows: [] } });
    ok(await page.evaluate(() => document.getElementById("mkSkyline").dataset.state === "pending" && /has not published/.test(document.getElementById("mkSkyline").textContent)), "AN UNPUBLISHED UNIVERSE IS A NAMED STATE, NOT AN EMPTY BOX");
    await context.close();
  }

  {
    const { context, page } = await harness(browser, { width: 1100, tokens: { "--up-mark": "#1e90ff", "--down-mark": "#ffd400" }, reducedMotion: "reduce" });
    await switchTo(page, "often", "key");
    const r = await inspect(page);
    const hue = r.samples.filter((s) => Math.abs(s.d[0] - s.d[1]) > 20 || Math.abs(s.d[2] - s.d[1]) > 40);
    ok(hue.filter((s) => s.dir > 0).every((s) => s.d[2] > s.d[0] + 40) && hue.filter((s) => s.dir < 0).every((s) => s.d[0] > s.d[2] + 40) && hue.length >= 3, `THE COLOURS ARE THE PAGE'S TOKENS: with the two marks recoloured the prisms follow (${hue.map((s) => s.t + ":" + s.d.slice(0, 3))})`);
    eq(verify(r, "often").filter((m) => !/colour/.test(m)), [], "and under reduced motion the toggle repaints the same picture");
    await context.close();
  }

  const MUTANTS = [
    ["height from the raw change", "h: Math.abs(m),", "h: Math.abs(c) * 100,"],
    ["direction reversed", "dir: m > 0 ? 1 : -1", "dir: m > 0 ? -1 : 1"],
    ["line at 1 IV-day", "const MIN = 2;", "const MIN = 1;"],
    ["event window ignored", "e <= EVENT", "e <= -1"],
    ["drawn height off the scale", ": p.h * unit }", ": Math.sqrt(p.h) * unit }"],
    ["a ticker label on each prism", "g.globalAlpha = 1;\n      g.strokeStyle = c;", "g.fillText(it.t, it.x, it.yt);\n      g.globalAlpha = 1;\n      g.strokeStyle = c;"],
    ["a linear axis labelled log", "const axisFrac = (n) => Math.log10(n) / Math.log10(FLOOR_N);", "const axisFrac = (n) => n / FLOOR_N;"],
    ["colour not tied to the direction", "const c = it.dir > 0 ? up : down;", "const c = up;"],
    ["IV-days printed without a sign", 'const sign = (v) => (v < 0 ? MINUS : v > 0 ? "+" : "");', 'const sign = () => "";'],
    ["a 1 in N printed past the floor", "const floored = hits === 0 || SESSIONS / hits > FLOOR_N;", "const floored = hits === 0;"],
    ["the 3x count taken at 2x", "const level = k >= 3 ? 3 : k >= 2 ? 2 : 0;", "const level = k >= 2 ? 2 : 0;"],
    ["the rung's count read from the wrong column", "const hits = level === 3 ? r.f3 : r.f2;", "const hits = r.f2;"],
    ["callouts for the most common days", "? (a, b) => b.often.n - a.often.n || byHeight(a, b)", "? (a, b) => a.often.n - b.often.n || byHeight(a, b)"],
    ["callout boxes over the prisms", "const r = { ...b, x: bx, y };", "const r = { ...b, x: Math.round(ox), y };"],
    ["leaders that cut across the grid", "r.path = [b.anchor, [b.anchor[0], lane], [ex, lane], [ex, cy], [bx, cy]];", "r.path = [b.anchor, [bx - 16, cy], [bx, cy]];"],
    ["a name with no published scale drawn at the floor", 'if (sig === null || !(sig > 0)) return { why: "scale" };', 'if (sig === null || !(sig > 0)) return { why: "", level: 3, hits: 0, floored: true, n: FLOOR_N, short: "rarer than 1 in 250", text: "" };'],
    ["a toggle that changes nothing", 'mode = i === 1 ? "often" : "ivdays"; render();', 'mode = "ivdays"; render();'],
  ];
  for (const [name, from, to] of MUTANTS) {
    ok(SRC.includes(from), `mutant "${name}" anchors on the served module`);
    let why = null, context = null;
    try {
      const h = await harness(browser, { width: 1100, source: SRC.replace(from, to) });
      context = h.context;
      const bad = verify(await inspect(h.page), "ivdays");
      await switchTo(h.page, "often", "click");
      why = bad[0] || verify(await inspect(h.page), "often")[0] || null;
    } catch (e) { why = "threw: " + String(e.message).split("\n")[0]; }
    console.log("  planted " + name + ": " + (why || "NOT CAUGHT").slice(0, 110));
    ok(why !== null, `THE PLANTED WRONG BUILD "${name}" FAILS THE KNOWN-ANSWER CHECKS`);
    if (context) await context.close();
  }
} finally {
  await browser.close();
}

console.log(`flows-skyline-render: ${checks} checks passed`);
