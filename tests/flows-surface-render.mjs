import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as FLOWS_PAGES from "../shared/flows-pages.js";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { cardX as fixtureCardX } from "./dossier-fixtures.mjs";
import { surfaceCard, SURFACE_EXPIRIES, SURFACE_GAMMA_DATES, sviParams } from "./lib/surface-card.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const MINUS = String.fromCharCode(0x2212);
const MIME = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };
const FILES = { glance: "assets/js/flows-ticker-glance.js", surface: "assets/js/flows-ticker-surface.js", ticker: "assets/js/flows-ticker.js", css: "assets/css/flows-ticker.css", flowsCss: "assets/css/flows.css" };
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, fs.readFileSync(path.join(ROOT, f), "utf8")]));

ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(/.test(SRC.surface), "the surface module holds no literal colour");
ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d|hsla?\(/.test(SRC.glance), "and neither does the glance module");
ok(!/getComputedStyle|cssVar\(/.test(SRC.glance), "the glance module paints only by class on a token");
const RAIL_CSS = SRC.css.split("\n").filter((l) => /\.ftg-|\.ftsf/.test(l)).join("\n");
ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/.test(RAIL_CSS), "and the rail and surface rules hold no literal colour");
ok(/--vol-1:/.test(SRC.flowsCss) && /--vol-6:/.test(SRC.flowsCss), "the six implied-volatility ramp stops are tokens");
ok(!/flows-ticker-scenes|m-surface|m-terrain/.test(SRC.ticker + fs.readFileSync(path.join(ROOT, "shared/flows-pages.js"), "utf8")), "the old scene modules and their dock buttons are gone");

const EMIT = nightlyEmit();
const base = JSON.parse(fs.readFileSync(path.join(EMIT, "-card-AAPL.json"), "utf8"));
const CARD = surfaceCard(base);
const T = CARD.ticker;
const S = CARD.panels.pricedMove.spot;
const X = fixtureCardX(T);
const cite = (id, label, display) => ({ id, label, display, asOf: "2026-08-24T20:00:00.000Z", kind: id.split(".")[0], grade: 3 });
const READ = { version: 1, status: "ready", ticker: T, generated: true, label: "Model wording", asOf: "2026-08-24T20:00:00.000Z", provenance: "x", coverage: { ok: 9, partial: 2, withheld: 0, pending: 1 }, tags: [], refused: [],
  sections: { identity: null, now: { text: "Dealers hold the name near the spot, and flow leans bullish into the report on November 18, which is a long sentence meant to need several lines of the rail.", cites: [cite("price.last", "Last price", "$214.14")] },
    drivers: [{ text: "Dealers are long gamma, so their hedging damps moves, and the flip level sits just below spot where the book turns short and moves are amplified, which is the first thing to watch.", cites: [cite("options.engine.gex.book", "Gamma book", "+$854M per 1%"), cite("options.engine.hedge.up1sd", "Hedging", MINUS + "$1.11B")] },
      { text: "Below the flip the book turns short gamma and the pinned read breaks.", cites: [cite("options.engine.level.flip", "Flip", "212.68")] }],
    tensions: [{ text: "Analysts lean buy while insiders sold.", cites: [cite("analysts.buy", "Analysts, buy share of ratings", "64% buy"), cite("insiders.net", "Insiders, net 90 days", MINUS + "$92.9M")] }],
    unknown: [{ text: "Fundamentals are withheld.", missing: ["fundamentals"] }], watch: [{ text: "Report Nov 18 after the close.", cites: [cite("events.next", "Report", "Nov 18")] }] } };
const HTML = FLOWS_PAGES.tickerPage({ username: "u", scenes: true });
const HTML_OFF = FLOWS_PAGES.tickerPage({ username: "u", scenes: false });
const browser = await chromium.launch();

const normCdf = (x) => {
  if (x < -8) return 0;
  if (x > 8) return 1;
  let term = x, sum = x;
  for (let n = 1; n < 400; n++) { term *= x * x / (2 * n + 1); sum += term; }
  return 0.5 + sum * Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
};
const sviW = (p, k) => p.a + p.b * (p.rho * (k - p.m) + Math.sqrt((k - p.m) * (k - p.m) + p.sigma * p.sigma));
const solve = (f, lo, hi) => { for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; } return (lo + hi) / 2; };
function independentSkew(e) {
  const p = e.smile.params, F = e.forward.F, T = e.T;
  const w = (k) => sviW(p, k);
  const callDelta = (k) => normCdf((-k + w(k) / 2) / Math.sqrt(w(k)));
  const kc = solve((k) => callDelta(k) - 0.25, -0.6, 0.6), kp = solve((k) => callDelta(k) - 0.75, -0.6, 0.6);
  const dns = solve((k) => k - w(k) / 2, -0.6, 0.6);
  const iv = (k) => Math.sqrt(w(k) / T);
  return { Kc: F * Math.exp(kc), Kp: F * Math.exp(kp), ivc: iv(kc), ivp: iv(kp), rr: iv(kp) - iv(kc), bf: (iv(kp) + iv(kc)) / 2 - iv(dns), atm: iv(0) };
}

async function boot(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: o.reduced ? "reduce" : "no-preference", hasTouch: !!o.touch, isMobile: !!o.touch });
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e)));
  const card = o.card || CARD;
  const neuron = { status: "ok", scope: T, summary: "Pinned near the spot, flow leaning bullish into the report.", ideas: [], tier: "priced", code: null, why: null, read: o.noRead ? { status: "generating", sections: {}, version: 1, ticker: T } : READ };
  const api = { card, summary: neuron, "card-x": X, hist: { status: "pending" }, tape: { status: "pending" }, meta: { status: "pending" }, events: { status: "pending", rows: [] },
    now: { serverNow: Date.parse(card.generatedAt || "2026-08-24T22:00:00Z"), phase: { phase: "closed", session: card.sessionDate, trading: false, endsAt: null }, keys: {} } };
  const mutate = o.mutate || {};
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/assets/")) {
      const f = path.join(ROOT, u.pathname);
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
      if (mutate[u.pathname]) return route.fulfill({ contentType: MIME[path.extname(f)], body: mutate[u.pathname](fs.readFileSync(f, "utf8")) });
      return route.fulfill({ path: f, contentType: MIME[path.extname(f)] || "application/octet-stream" });
    }
    if (u.pathname.startsWith("/api/flows/")) {
      const key = u.pathname.slice("/api/flows/".length);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(api[key] === undefined ? { status: "pending" } : api[key]) });
    }
    if (u.pathname.startsWith("/flows/ticker")) return route.fulfill({ contentType: "text/html; charset=utf-8", body: o.html || HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.routeWebSocket(/\/api\/rt\/ws/, (ws) => ws.close({ code: 4011, reason: "off" }));
  await page.goto("https://example.test/flows/ticker/?t=" + T);
  await page.waitForFunction(() => { const s = document.getElementById("ftStatus"); return s && s.textContent !== "Loading the name…"; }, null, { timeout: 15000 });
  await page.waitForSelector(".ftg-svg", { timeout: 10000 });
  await page.waitForTimeout(300);
  return page;
}

const railFacts = (page) => page.evaluate(() => {
  const svg = document.querySelector(".ftg-svg");
  const q = (s) => [...svg.querySelectorAll(s)];
  const a = (n, k) => +n.getAttribute(k);
  const axis = q("text.ftg-tx").filter((n) => n.getAttribute("text-anchor") === "end" && /^\d+(\.\d+)?$/.test(n.textContent) && a(n, "x") < 60).map((n) => [+n.textContent, a(n, "y") - 3.5]);
  const rail = svg.querySelector('[data-layer="gamma"]');
  const bbox = (n) => { const b = n.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height]; };
  const today = q("text.ftg-today-tx")[0];
  const hit = (n) => { const r = n.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
  return {
    axis, W: a(svg, "width"), H: a(svg, "height"),
    bars: rail ? [...rail.querySelectorAll("rect[data-k]")].map((n) => ({ k: +n.dataset.k, y: a(n, "y"), h: a(n, "height"), w: a(n, "width"), x: a(n, "x"), cls: n.getAttribute("class"), fill: n.getAttribute("fill") })) : [],
    d25: rail ? [...rail.querySelectorAll("circle[data-delta]")].map((n) => ({ d: n.dataset.delta, cx: a(n, "cx"), cy: a(n, "cy"), r: a(n, "r") })) : [],
    sig: (() => { const n = svg.querySelector("rect.ftg-sig"); return n ? { x: a(n, "x"), y: a(n, "y"), h: a(n, "height"), w: a(n, "width") } : null; })(),
    cursor: (() => { const n = svg.querySelector("line.ftg-xc"); return n ? a(n, "x1") : null; })(),
    ticks: q(".ftg-xt").map((g) => ({ e: g.dataset.expiry, on: g.getAttribute("aria-checked") === "true", x: a(g.querySelector("line"), "x1"), label: (g.querySelector("text") || {}).textContent || null, box: g.querySelector("text") ? bbox(g.querySelector("text")) : null, tab: g.getAttribute("tabindex"), hit: hit(g.querySelector("rect")) })),
    today: today ? bbox(today) : null,
    levels: Object.fromEntries(["call_wall", "put_wall", "max_pain", "gamma_flip"].map((k) => [k, q("line.ftg-lv.ftg-lv-" + k).map((n) => a(n, "y1"))])),
    spotRail: (() => { const n = svg.querySelector("line.ftg-rail-spot"); return n ? a(n, "y1") : null; })(),
    heads: q("text.ftg-rh").map((n) => n.textContent),
    sigText: q("text.ftg-sig-t").map((n) => n.textContent),
    smile: (() => { const n = svg.querySelector("polyline.ftg-sm"); return n ? n.getAttribute("points").split(" ").length : 0; })(),
    noFit: (svg.querySelector("text.ftg-nf-t") || {}).textContent || null,
    quotes: q("circle.ftg-qd").length,
    gn: q("rect.ftg-gn").map((n) => ({ k: +n.dataset.k, dash: getComputedStyle(n).strokeDasharray, fill: getComputedStyle(n).fill })),
    desc: document.getElementById(svg.getAttribute("aria-describedby")).textContent,
    readout: document.querySelector(".ftg-readout").textContent,
    legend: document.querySelector(".ftg-legend").textContent,
    sw: document.documentElement.scrollWidth, vw: innerWidth,
  };
});

function mapping(f) {
  const [a, b] = [f.axis[0], f.axis[f.axis.length - 1]];
  const B = (b[1] - a[1]) / (b[0] - a[0]), A = a[1] - B * a[0];
  for (const [v, y] of f.axis) near(A + B * v, y, 0.51, "the price axis is linear");
  return (v) => A + B * v;
}

const ENG = Object.fromEntries(CARD.engine.expiries.map((e) => [e.expiry, e]));
const dayWord = (iso) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+iso.slice(5, 7) - 1] + " " + +iso.slice(8, 10);
const sd = (iso) => ENG[iso].smile.atmIv * Math.sqrt(ENG[iso].T);

async function checkRail(page, expiry, label) {
  const f = await railFacts(page);
  const y = mapping(f);
  const row = ENG[expiry];
  eq(f.cursor !== null, true, `${label}: the expiry cursor is drawn`);
  const on = f.ticks.filter((t) => t.on);
  eq(on.map((t) => t.e), [expiry], `${label}: exactly the chosen expiry is the checked tick`);
  near(on[0].x, f.cursor, 0.01, `${label}: the cursor stands on its own tick`);
  const lv = Object.fromEntries(CARD.panels.levels.levels.map((l) => [l.kind === "zero_gamma" ? "gamma_flip" : l.kind, l.px]));
  for (const [k, px] of Object.entries(lv)) { ok(f.levels[k].length === 2, `${label}: ${k} is drawn left of the labels and across the rail`); for (const yy of f.levels[k]) near(yy, y(px), 1, `${label}: the ${k} line sits on the price axis`); }
  near(f.spotRail, y(S), 1, `${label}: spot crosses the rail on the same axis`);
  const strikes = CARD.panels.surface.strikes;
  const dateIdx = CARD.panels.surface.expiries.indexOf(expiry);
  ok(f.bars.length >= 10, `${label}: gamma bars are drawn for the strikes in the price window`);
  for (const b of f.bars) {
    near(b.y + b.h / 2, y(b.k), 1, `${label}: the ${b.k} strike's bar is centred on its price (within 1 px)`);
    const i = strikes.indexOf(b.k);
    const g = dateIdx >= 0 ? CARD.panels.surface.oi.gamma[i][dateIdx] : null;
    if (g === null) ok(/ftg-gn/.test(b.cls) && b.fill === null, `${label}: ${b.k} was not returned and is a dashed outline`);
    else ok(/ftg-g[ls]/.test(b.cls) && (g >= 0) === /ftg-gl/.test(b.cls), `${label}: ${b.k} is a ${g >= 0 ? "long" : "short"} bar`);
  }
  if (dateIdx >= 0) {
    const real = f.bars.filter((b) => /ftg-g[ls]/.test(b.cls)).map((b) => ({ k: b.k, w: b.w, g: CARD.panels.surface.oi.gamma[strikes.indexOf(b.k)][dateIdx] }));
    const mx = Math.max(...real.map((r) => Math.abs(r.g)));
    for (const r of real) near(r.w, Math.max(1, Math.abs(r.g) / mx * real.reduce((a, c) => (c.w / (Math.abs(c.g) / mx) > a ? c.w / (Math.abs(c.g) / mx) : a), 0)), 0.51, `${label}: bar width is proportional to the strike's gamma`);
  }
  if (row.smile.method !== "flat") {
    const ex = independentSkew(row);
    const put = f.d25.find((d) => d.d === "25Δp"), call = f.d25.find((d) => d.d === "25Δc");
    ok(put && call, `${label}: both 25-delta markers are drawn`);
    near(put.cy, y(ex.Kp), 1, `${label}: the 25-delta put sits at its own strike (${ex.Kp.toFixed(2)}) on the price axis`);
    near(call.cy, y(ex.Kc), 1, `${label}: and the 25-delta call at ${ex.Kc.toFixed(2)}`);
    ok(put.cy > call.cy && put.cx > call.cx, `${label}: the put is lower and to the right (higher volatility) of the call`);
    near(ex.rr, row.smile.rr25, 1.1e-4, `${label}: risk reversal agrees with the engine's stored figure (${ex.rr.toFixed(4)} vs ${row.smile.rr25})`);
    near(ex.bf, row.smile.bf25, 1.1e-4, `${label}: and butterfly (${ex.bf.toFixed(4)} vs ${row.smile.bf25})`);
    ok(f.smile > 20, `${label}: the smile is a curve through the strikes`);
  } else {
    eq(f.d25.length, 0, `${label}: an expiry with no fit carries no 25-delta marker`);
    eq(f.smile, 0, `${label}: and no curve`);
    ok(/no fit/.test(f.noFit || ""), `${label}: it says no fit at its at-the-money level (${f.noFit})`);
  }
  if (row.smile.method !== "flat") {
    const up = S * Math.exp(sd(expiry)), dn = S * Math.exp(-sd(expiry));
    ok(f.sig, `${label}: the one-sigma band is drawn`);
    near(f.sig.y, y(up), 1, `${label}: its top is spot * exp(+atm * sqrt(T)) = ${up.toFixed(2)}`);
    near(f.sig.y + f.sig.h, y(dn), 1, `${label}: its bottom is spot * exp(-atm * sqrt(T)) = ${dn.toFixed(2)}`);
    ok(f.sigText.some((t) => t.startsWith("+1 SD")) && f.sigText.some((t) => t.startsWith(MINUS + "1 SD")), `${label}: both ends are labelled with the true minus sign`);
  }
  ok(f.heads.every((h) => h.includes(dayWord(expiry))), `${label}: both rail headers carry the expiry (${f.heads.join(" | ")})`);
  const boxes = f.ticks.filter((t) => t.box).map((t) => t.box).concat(f.today ? [f.today] : []);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) ok(!overlap(boxes[i], boxes[j]), `${label}: time-axis labels ${i} and ${j} do not overlap`);
  return f;
}

function overlap(a, b) { return a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5; }

let runRail = async (page) => {
  const f = await checkRail(page, "2026-08-31", "default");
  return f;
};

const VP = { width: 1440, height: 820 };
{
  const page = await boot(VP);
  const m = await page.evaluate(({ card }) => {
    const G = window.FlowsUI.tickerGlance.model, Q = window.FlowsQuant;
    const xp = G.expiries(card, Q);
    return { rows: xp.rows.map((r) => ({ e: r.expiry, state: r.state, label: r.label, dte: r.dte, sessions: r.sessions, gamma: r.gamma && r.gamma.length, hasSlice: !!r.slice, quotes: r.quotes.length, sk: G.skew(r, Q) })), basis: xp.basis, cap: xp.cap, def: G.defaultExpiry(xp.rows), strikes: xp.strikes.length };
  }, { card: CARD });
  eq(m.rows.map((r) => r.e), [...new Set(SURFACE_GAMMA_DATES.concat(SURFACE_EXPIRIES.map((e) => e.expiry)))].sort(), "the rows are the union of the gamma grid's expiries and the engine's");
  eq(m.rows.map((r) => r.state), ["fit", "fit", "fit", "none", "none", "none", "repaired", "repaired", "repaired"], "fit state follows the engine's method: fitted, flat is no fit, repaired, and a date with no engine slice is no fit");
  eq(m.rows.map((r) => r.label), ["FITTED SVI", "FITTED SVI", "FITTED SVI", "NO FIT", "NO FIT", "NO FIT", "SVI, REPAIRED", "SVI, REPAIRED", "SVI, REPAIRED"], "and the chip words are the engine's");
  eq(m.def, "2026-08-31", "the cursor starts on the nearest expiry at least seven days out");
  eq(m.basis, "book", "gamma is the open-interest book when the card has one");
  for (const r of m.rows) {
    const e = ENG[r.e];
    if (!e || e.smile.method === "flat") { eq(r.sk, null, `${r.e}: no 25-delta figures without a fitted slice`); continue; }
    const ex = independentSkew(e);
    near(r.sk.Kp, ex.Kp, 1e-5, `${r.e}: 25-delta put strike matches the independent solve`);
    near(r.sk.Kc, ex.Kc, 1e-5, `${r.e}: 25-delta call strike matches`);
    near(r.sk.rr, ex.rr, 1e-7, `${r.e}: risk reversal matches`);
    near(r.sk.bf, ex.bf, 1e-7, `${r.e}: butterfly matches`);
    near(r.sk.rr, e.smile.rr25, 1.1e-4, `${r.e}: and the engine's stored risk reversal`);
    near(r.sk.bf, e.smile.bf25, 1.1e-4, `${r.e}: and its stored butterfly`);
    near(r.sk.atm, ex.atm, 1e-7, `${r.e}: at-the-money volatility matches`);
  }
  eq(m.rows.find((r) => r.e === "2026-08-26").quotes > 0, true, "an expiry the card measured keeps its quotes");
  eq(m.rows.find((r) => r.e === "2026-08-28").quotes, 0, "and one it did not carries none");
  eq(m.rows.find((r) => r.e === "2026-09-25").gamma, null, "an expiry with no gamma column has no gamma at all, not zeros");
  eq(m.rows.find((r) => r.e === "2026-09-09").hasSlice, false, "a gamma date the engine did not fit has no slice");
  await page.context().close();
}

{
  const page = await boot(VP);
  const f = await runRail(page);
  eq(f.errors, undefined, "no stray fact");
  const weekdays = (a, b2) => { let k = 0; const d = new Date(a + "T12:00:00Z"); while (d < new Date(b2 + "T12:00:00Z")) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6) k++; } return k; };
  const tickSessions = Object.fromEntries(f.ticks.map((t) => [t.e, weekdays(CARD.sessionDate, t.e)]));
  const inMonth = f.ticks;
  eq(inMonth.map((t) => t.e), [...new Set(SURFACE_GAMMA_DATES.concat(SURFACE_EXPIRIES.map((e) => e.expiry)))].sort().filter((e) => tickSessions[e] <= 20), "an expiry tick for every expiry inside the 20 sessions, and none beyond");
  const s = (t) => tickSessions[t.e];
  const sorted = inMonth.slice().sort((a, b) => s(a) - s(b));
  const slope = (sorted[sorted.length - 1].x - sorted[0].x) / (s(sorted[sorted.length - 1]) - s(sorted[0]));
  for (const t of sorted) near(t.x, sorted[0].x + slope * (s(t) - s(sorted[0])), 0.6, `the ${t.e} tick is on the linear forward axis`);
  const boxes = f.ticks.filter((t) => t.box).map((t) => t.box).concat(f.today ? [f.today] : []);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) ok(!overlap(boxes[i], boxes[j]), `the time-axis labels ${i} and ${j} do not overlap`);
  ok(f.ticks.length > boxes.length - 1, "every expiry keeps a tick and a hit target even where its label is thinned");
  for (const t of f.ticks) ok(t.hit[2] - t.hit[0] >= 13.5 && t.hit[3] - t.hit[1] >= 20, `the ${t.e} hit target is at least 14 by 20 px (${t.hit.map(Math.round)})`);
  eq(f.ticks.filter((t) => t.tab === "0").length, 1, "one roving tab stop among the expiry ticks");
  ok(!f.legend.includes("Q ±") && f.legend.includes("±1 SD") && f.legend.includes("25Δ"), `the legend names the band and the 25-delta markers (${f.legend})`);
  ok(f.desc.includes("Strike rail for the Aug 31 expiry") && f.desc.includes("25-delta put sits at") && f.desc.includes("on the vendor's convention (dealers long calls, short puts)"), "the chart's description reads the rail");
  eq(f.sw <= f.vw, true, "no horizontal overflow at 1440");
  eq(page.__errors, [], "no page error");

  const geo = await page.evaluate(() => {
    const svg = document.querySelector(".ftg-svg"), r = svg.getBoundingClientRect(), rail = svg.querySelector('[data-layer="gamma"]').getBoundingClientRect();
    const labels = [...svg.querySelectorAll(".ftg-lt")].map((n) => { const b = n.getBBox(); return [b.x, b.y, b.x + b.width, b.y + b.height, n.textContent]; });
    return { w: r.width, railLeft: rail.left - r.left, labels };
  });
  for (let i = 0; i < geo.labels.length; i++) for (let j = i + 1; j < geo.labels.length; j++) ok(!overlap(geo.labels[i], geo.labels[j]), `level labels ${geo.labels[i][4]} and ${geo.labels[j][4]} do not overlap`);

  const before = f.heads.join("|");
  await page.locator('.ftg-xt[data-expiry="2026-09-11"] rect').click();
  await page.waitForTimeout(150);
  const f2 = await checkRail(page, "2026-09-11", "after a click on the Sep 11 tick");
  ok(f2.heads.join("|") !== before, "the headers followed the cursor");
  ok(f2.cursor > f.cursor, "and the cursor moved right along the forward axis");
  await page.evaluate(() => { window.__ev = []; document.addEventListener("ft:expiry", (e) => window.__ev.push(e.detail)); });
  await page.locator('.ftg-xt[aria-checked="true"]').focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(100);
  const f3 = await railFacts(page);
  eq(f3.ticks.find((t) => t.on).e, f.ticks[f.ticks.findIndex((t) => t.e === "2026-09-11") - 1].e, "ArrowLeft moves the cursor to the previous expiry");
  ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("ftg-xt")), "and focus stays on the ticks");
  await page.keyboard.press("Home");
  eq((await railFacts(page)).ticks.find((t) => t.on).e, f.ticks[0].e, "Home reaches the first expiry");
  await page.keyboard.press("End");
  eq((await railFacts(page)).ticks.find((t) => t.on).e, f.ticks[f.ticks.length - 1].e, "End reaches the last expiry inside the month");
  const evs = await page.evaluate(() => window.__ev);
  ok(evs.length >= 3 && evs.every((e) => e.source === "chart" && typeof e.expiry === "string"), "each move announces ft:expiry from the chart");
  await page.locator('.ftg-xt[data-expiry="2026-08-31"] rect').click();

  const rp = await page.evaluate(() => { const svg = document.querySelector(".ftg-svg"), r = svg.getBoundingClientRect(); const b = svg.querySelector('[data-layer="gamma"] rect[data-k]').getBoundingClientRect(); return { x: b.left + 4, y: b.top + 1, rx: r.left }; });
  await page.mouse.move(rp.x, rp.y);
  await page.waitForTimeout(100);
  const hover = await page.evaluate(() => ({ t: document.querySelector(".ftg-readout").textContent, line: !document.querySelector(".ftg-cross-h").hasAttribute("hidden") }));
  ok(/Strike \d/.test(hover.t) && /IV \d/.test(hover.t) && /gamma/.test(hover.t) && /from spot/.test(hover.t) && hover.line, `hovering the rail reads strike, IV, gamma and distance from spot (${hover.t})`);
  await page.context().close();
}

{
  const page = await boot(VP);
  const f = await railFacts(page);
  const strikes = CARD.panels.surface.strikes;
  const y = mapping(f);
  const di = CARD.panels.surface.expiries.indexOf("2026-08-31");
  const nulls = strikes.filter((K, i) => CARD.panels.surface.oi.gamma[i][di] === null && f.bars.some((b) => b.k === K));
  ok(nulls.length >= 1, `the fixture has a missing cell at the default expiry (${nulls.length})`);
  eq(f.gn.map((g) => g.k).sort((a, b) => a - b), nulls.sort((a, b) => a - b), "each missing cell is a dashed outline and nothing else is");
  for (const g of f.gn) ok(g.dash !== "none" && /rgba\(0, 0, 0, 0\)|none/.test(g.fill), `${g.k}: a null cell is dashed and unfilled, never a zero-width bar`);
  const zero = f.bars.filter((b) => /ftg-g[ls]/.test(b.cls) && strikes.includes(b.k) && CARD.panels.surface.oi.gamma[strikes.indexOf(b.k)][di] === null);
  eq(zero.length, 0, "no solid bar is drawn at a strike whose gamma was not returned");
  await page.context().close();
}

{
  for (const [w, h] of [[1920, 1080], [1280, 800]]) {
    const page = await boot({ width: w, height: h });
    const f = await railFacts(page);
    const boxes = f.ticks.filter((t) => t.box).map((t) => t.box).concat(f.today ? [f.today] : []);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) ok(!overlap(boxes[i], boxes[j]), `${w}: time-axis labels ${i} and ${j} do not overlap`);
    eq(f.sw <= f.vw, true, `${w}: no horizontal overflow`);
    if (f.bars.length) { const y = mapping(f); for (const b of f.bars) near(b.y + b.h / 2, y(b.k), 1, `${w}: ${b.k} sits on the price axis`); }
    await page.context().close();
  }
}

{
  const page = await boot({ width: 390, height: 844 }, { touch: true });
  const f = await page.evaluate(() => ({
    chips: [...document.querySelectorAll(".ftg-xchip")].map((n) => ({ e: n.dataset.expiry, on: n.getAttribute("aria-pressed") === "true", h: n.getBoundingClientRect().height, w: n.getBoundingClientRect().width })),
    mini: [...document.querySelectorAll(".ftg-msvg")].map((n) => n.getAttribute("aria-label")),
    rail: !!document.querySelector('.ftg-svg [data-layer="gamma"] rect[data-k]'),
    sw: document.documentElement.scrollWidth, vw: innerWidth,
  }));
  eq(f.chips.length, 9, "on a phone the rail drops below the chart as an expiry chip row");
  ok(f.chips.every((c) => c.h >= 44 && c.w >= 44), "and every chip is a 44 px target");
  eq(f.chips.filter((c) => c.on).map((c) => c.e), ["2026-08-31"], "starting on the same default expiry");
  eq(f.mini.length, 2, "with two stacked mini charts, gamma by strike and the smile");
  eq(f.rail, false, "and no strike rail inside the price chart");
  eq(f.sw <= f.vw, true, "no horizontal overflow at 390");
  await page.locator('.ftg-xchip[data-expiry="2026-09-11"]').click();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ on: [...document.querySelectorAll(".ftg-xchip")].filter((n) => n.getAttribute("aria-pressed") === "true").map((n) => n.dataset.expiry), labels: [...document.querySelectorAll(".ftg-msvg")].map((n) => n.getAttribute("aria-label")) }));
  eq(after.on, ["2026-09-11"], "a chip moves the expiry");
  ok(after.labels.every((l) => l.includes("Sep 11")), "and both mini charts follow");
  eq(page.__errors, [], "no page error on a phone");
  await page.context().close();
}

const ready = async (page) => { await page.waitForSelector(".ftsf", { timeout: 10000 }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(150); await page.waitForSelector('.ftsf[data-motion="rest"]', { timeout: 10000 }); await page.waitForTimeout(100); };
const settle = async (page) => { await page.waitForSelector('.ftsf[data-motion="rest"]', { timeout: 10000 }); await page.waitForTimeout(60); };
{
  const page = await boot(VP);
  const tabs = await page.evaluate(() => ({ role: document.querySelector("#ftGTabs [role=tablist]").getAttribute("role"), tabs: [...document.querySelectorAll("#ftGTabs [role=tab]")].map((b) => [b.id, b.getAttribute("aria-selected"), b.getAttribute("aria-controls"), b.textContent]), rail: !document.getElementById("ftReadRail").hidden, surf: document.getElementById("ftGSurf").hidden }));
  eq(tabs.tabs.map((t) => t[3]), ["Price & levels", "Surface & terrain"], "the chart panel has a two-tab switch");
  eq(tabs.tabs.map((t) => t[1]), ["true", "false"], "starting on the price view");
  ok(tabs.rail && tabs.surf, "with the Reading rail up and the surface hidden");
  const dock = await page.evaluate(() => [...document.querySelectorAll(".ft-dock-b")].map((b) => b.textContent));
  ok(!dock.includes("Volatility surface") && !dock.includes("Gamma terrain"), `the dock no longer carries the two buttons (${dock.join(", ")})`);
  await page.evaluate(() => { window.__ev = []; document.addEventListener("ft:expiry", (e) => window.__ev.push(e.detail)); });
  await page.locator('.ftg-xt[data-expiry="2026-09-11"] rect').click();
  await page.locator("#ftTabPrice").focus();
  await page.keyboard.press("ArrowRight");
  await ready(page);
  const b = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    return { sel: q("#ftGTabs [role=tab]").map((t) => t.getAttribute("aria-selected")), rail: document.getElementById("ftReadRail").hidden, view: document.getElementById("ftGMain").dataset.view, a: document.getElementById("ftGlanceChart").hidden,
      chips: q(".ftsf-chip").map((c) => ({ e: c.dataset.expiry, on: c.getAttribute("aria-pressed") === "true", fit: c.querySelector(".ftsf-fit").textContent, st: c.dataset.state })),
      cv: q(".ftsf canvas").map((c) => ({ label: c.getAttribute("aria-label"), role: c.getAttribute("role"), tab: c.tabIndex, w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height })),
      key: document.querySelector(".ftsf-key").textContent, reset: !document.getElementById("ftGReset").hidden, range: document.getElementById("ftGRange").hidden,
      tables: q(".ftsf-tab table").length, h3: q(".ftsf h3").map((n) => n.textContent), panel: document.getElementById("ftGSurf").getBoundingClientRect().height, sw: document.documentElement.scrollWidth, vw: innerWidth };
  });
  eq(b.sel, ["false", "true"], "the arrow key moves to the surface tab");
  ok(b.rail && b.view === "surface" && b.a, "which hides the Reading rail and the price chart and gives the panel the full width");
  eq(b.chips.map((c) => c.fit), ["FITTED SVI", "FITTED SVI", "FITTED SVI", "NO FIT", "NO FIT", "NO FIT", "SVI, REPAIRED", "SVI, REPAIRED", "SVI, REPAIRED"], "an expiry chip row with the engine's fit word on each");
  eq(b.chips.filter((c) => c.on).map((c) => c.e), ["2026-09-11"], "the expiry chosen in the price view is kept");
  eq(b.cv.length, 2, "the terrain and the surface are canvases");
  ok(b.cv.every((c) => c.role === "img" && c.tab === 0 && c.label.length > 60 && c.w > 200 && c.h > 150), "each is a described, focusable image of usable size");
  ok(/implied vol/.test(b.key) && /% to \d+% across the fitted body/.test(b.key) && /gamma height scale ±/.test(b.key) && /98th percentile of cells/.test(b.key), `the key states both scales (${b.key})`);
  ok(b.reset && b.range, "the header swaps the range control for Reset view");
  eq(b.h3.length, 3, "three columns: terrain, surface and smile");
  ok(b.sw <= b.vw, "no horizontal overflow");
  eq(b.tables, 2, "two tables sit behind the disclosure");

  const mm = await page.evaluate(({ card }) => {
    const S = window.FlowsUI.tickerSurface.model.surface(card, window.FlowsQuant), Tm = window.FlowsUI.tickerSurface.model.terrain(S);
    const pts = [];
    for (const r of S.fit) for (const K of [S.K0, (S.K0 + S.K1) / 2, S.K1]) pts.push([r.expiry, K, S.wAt(r, K), S.ivAt(r, K)]);
    const pairs = S.mesh.filter((m) => m.u0 === 0).map((m) => [m.r0.expiry, m.r1.expiry, m.interp]);
    const mid = S.between(S.fit.find((r) => r.expiry === "2026-08-31"), S.fit.find((r) => r.expiry === "2026-09-11"), 0.5, (S.K0 + S.K1) / 2);
    return { K0: S.K0, K1: S.K1, ivLo: S.ivLo, ivHi: S.ivHi, fit: S.fit.map((r) => r.expiry), pts, pairs, rings: S.rings.map((r) => [r.r.expiry, r.iv, r.K]), breaks: S.calendar.breaks.length, checked: S.calendar.checked, mid, meshStates: S.mesh.map((m) => [m.r0.state, m.r1.state]),
      terrain: Tm ? { gaps: Tm.gaps, clipped: Tm.clipped, cap: Tm.cap, cells: Tm.cells.length, nulls: Tm.cells.filter((c) => c.h === null).length, maxh: Math.max(...Tm.cells.filter((c) => c.h !== null).map((c) => Math.abs(c.h))), rows: Tm.rows.map((r) => r.expiry) } : null,
      sqMin: S.sqMin, sqMax: S.sqMax, tx: S.rows.map((r) => [r.expiry, r.Tx]) };
  }, { card: CARD });
  const strikes = CARD.panels.surface.strikes;
  eq([mm.K0, mm.K1], [Math.min(...strikes), Math.max(...strikes)], "the strike axis is the gamma grid's range");
  eq(mm.fit, ["2026-08-26", "2026-08-28", "2026-08-31", "2026-09-11", "2026-09-18", "2026-09-25"], "the surface draws only expiries with a fitted slice");
  const wInd = (e, K) => sviW(ENG[e].smile.params, Math.log(K / ENG[e].forward.F));
  for (const [e, K, w, iv] of mm.pts) { near(w, wInd(e, K), 1e-12, `${e} at ${K}: total variance is the SVI formula in k = ln(K/F)`); near(iv, Math.sqrt(wInd(e, K) / ENG[e].T), 1e-9, `${e} at ${K}: implied vol is sqrt(w/T)`); }
  const ivs = [];
  for (const e of mm.fit) for (let i = 0; i < 23; i++) ivs.push(Math.sqrt(wInd(e, mm.K0 + (mm.K1 - mm.K0) * i / 22) / ENG[e].T));
  near(mm.ivLo, Math.floor(Math.min(...ivs) * 100) / 100, 1e-12, "the low end of the volatility scale is the fitted body's minimum, whole vol points");
  near(mm.ivHi, Math.ceil(Math.max(...ivs) * 100) / 100, 1e-12, "and the high end its maximum");
  eq(mm.pairs.map((p) => p.slice(0, 2)), [["2026-08-26", "2026-08-28"], ["2026-08-28", "2026-08-31"], ["2026-08-31", "2026-09-11"], ["2026-09-11", "2026-09-18"], ["2026-09-18", "2026-09-25"]], "mesh rows join consecutive fitted expiries only");
  eq(mm.pairs.map((p) => p[2]), [false, false, true, false, false], "and the row that spans the expiries with no fit is marked as interpolated");
  ok(mm.meshStates.every(([a, c]) => a !== "none" && c !== "none"), "no mesh row ever starts or ends on an expiry with no fit: those are rings, never bridged");
  eq(mm.rings.map((r) => r[0]), ["2026-09-02", "2026-09-04"], "each flat expiry the engine carries is a ring at its at-the-money level (a date with no engine slice has no level to draw)");
  for (const [e, iv] of mm.rings.map((r) => [r[0], r[1]])) near(iv, ENG[e].smile.atmIv, 1e-12, `${e}: the ring's height is the engine's at-the-money level`);
  const a = ENG["2026-08-31"], c = ENG["2026-09-11"], K = (mm.K0 + mm.K1) / 2;
  const w0 = wInd("2026-08-31", K), w1 = wInd("2026-09-11", K), Tm2 = (a.T + c.T) / 2;
  near(mm.mid.w, (w0 + w1) / 2, 1e-12, "between two fitted expiries total variance interpolates linearly in time at a fixed strike");
  near(mm.mid.iv, Math.sqrt((w0 + w1) / 2 / Tm2), 1e-12, "so implied vol between them is sqrt of that variance over the interpolated time, not the average of the two vols");
  eq(mm.breaks, 0, "the calendar check finds no break on a fixture whose total variance rises with time");
  ok(mm.checked > 100, `and it checked ${mm.checked} strike and expiry pairs`);
  const nullCells = CARD.panels.surface.oi.gamma.flat().filter((v) => v === null).length;
  eq(mm.terrain.nulls, nullCells, "the terrain keeps every missing gamma cell as a missing cell");
  eq(mm.terrain.gaps, nullCells, "and counts it as a gap, not a zero");
  eq(mm.terrain.rows, SURFACE_GAMMA_DATES, "the terrain has a column for each date the gamma grid carries");
  const mags = CARD.panels.surface.oi.gamma.flat().filter((v) => v !== null && v !== 0).map(Math.abs).sort((p, q) => p - q);
  near(mm.terrain.cap, mags[Math.min(mags.length - 1, Math.round(0.98 * (mags.length - 1)))], 0, "heights are scaled to the 98th percentile of the cells");
  ok(mm.terrain.maxh <= 1.25 + 1e-12, "and clipped at 1.25 times it");

  const sceneFacts = await page.evaluate(() => [...document.querySelectorAll(".ftsf canvas")].map((c) => ({ boxes: JSON.parse(c.dataset.boxes || "[]"), dropped: c.dataset.dropped, labels: c.dataset.labels, w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height })));
  for (const sc of sceneFacts) {
    ok(sc.boxes.length >= 8, `a scene prints at least eight labels (${sc.boxes.length})`);
    for (let i = 0; i < sc.boxes.length; i++) {
      const bx = sc.boxes[i];
      ok(bx[0] >= 0 && bx[1] >= 0 && bx[2] <= sc.w + 0.5 && bx[3] <= sc.h + 0.5, `label ${sc.labels.split("|")[i]} stays inside its canvas`);
      for (let j = i + 1; j < sc.boxes.length; j++) ok(!overlap(sc.boxes[i], sc.boxes[j]), `labels ${sc.labels.split("|")[i]} and ${sc.labels.split("|")[j]} do not overlap`);
    }
  }
  ok(sceneFacts.some((s) => /Flip|Call|Put|Pain/.test(s.labels)) && sceneFacts.every((s) => /spot/.test(s.labels)), "levels and spot are labelled on both scenes without crowding each other");

  await page.locator(".ftsf canvas").first().focus();
  const px0 = await page.evaluate(() => document.querySelectorAll(".ftsf canvas")[0].toDataURL().length + ":" + document.querySelectorAll(".ftsf canvas")[1].toDataURL().length);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await settle(page);
  const px1 = await page.evaluate(() => document.querySelectorAll(".ftsf canvas")[0].toDataURL().length + ":" + document.querySelectorAll(".ftsf canvas")[1].toDataURL().length);
  ok(px0 !== px1, "arrow keys turn the scene, and both scenes share the one camera");
  await page.locator("#ftGReset button").click();
  await settle(page);
  const px2 = await page.evaluate(() => document.querySelectorAll(".ftsf canvas")[0].toDataURL().length + ":" + document.querySelectorAll(".ftsf canvas")[1].toDataURL().length);
  eq(px2, px0, "Reset view returns both scenes to the rest view, pixel for pixel");

  await page.locator('.ftsf-chip[data-expiry="2026-08-26"]').click();
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => ({ on: [...document.querySelectorAll(".ftsf-chip")].filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.expiry), sm: document.querySelector(".ftsf-col-s h3").textContent, labels: [...document.querySelectorAll(".ftsf-smile svg")].map((s) => s.getAttribute("aria-label")), ev: window.__ev.slice(-1)[0] }));
  eq(sel.on, ["2026-08-26"], "a chip chooses the expiry");
  ok(/Aug 26/.test(sel.sm) && sel.labels.every((l) => l.includes("Aug 26")), `and the smile column follows (${sel.sm})`);
  eq(sel.ev, { expiry: "2026-08-26", source: "surface" }, "the choice is announced as ft:expiry from the surface");
  await page.locator('.ftsf-chip[data-expiry="2026-08-26"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  eq(await page.evaluate(() => document.querySelector('.ftsf-chip[aria-pressed="true"]').dataset.expiry), "2026-08-28", "ArrowRight on a chip moves to the next expiry");

  await page.locator("#ftTabPrice").click();
  await page.waitForFunction(() => document.getElementById("ftGMain").dataset.view === "price", null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({ rail: !document.getElementById("ftReadRail").hidden, view: document.getElementById("ftGMain").dataset.view, on: [...document.querySelectorAll(".ftg-xt")].filter((t) => t.getAttribute("aria-checked") === "true").map((t) => t.dataset.expiry), heads: [...document.querySelectorAll(".ftg-rh")].map((n) => n.textContent) }));
  ok(back.rail && back.view === "price", "back on the price view the Reading rail returns");
  eq(back.on, ["2026-08-28"], "and the chart's cursor is where the surface left the expiry");
  ok(back.heads.every((h) => h.includes("Aug 28")), "with its rail redrawn for it");
  eq(page.__errors, [], "no page error across the tab round trip");
  await page.context().close();
}

{
  const page = await boot({ width: 390, height: 844 }, { touch: true });
  await page.locator("#ftTabSurface").click();
  await ready(page);
  const f = await page.evaluate(() => {
    const cols = document.querySelector(".ftsf-cols"), cs = getComputedStyle(cols);
    return { overflowX: cs.overflowX, snap: cs.scrollSnapType, cards: [...document.querySelectorAll(".ftsf-col")].map((c) => Math.round(c.getBoundingClientRect().width)), sw: document.documentElement.scrollWidth, vw: innerWidth, chipH: Math.min(...[...document.querySelectorAll(".ftsf-chip")].map((c) => c.getBoundingClientRect().height)), reset: Math.round(document.querySelector("#ftGReset button").getBoundingClientRect().height) };
  });
  eq(f.overflowX, "auto", "on a phone the three columns are swipeable cards");
  ok(/x mandatory/.test(f.snap), "that snap to a card");
  ok(f.cards.length === 3 && f.cards.every((w) => w >= 280 && w <= 440), `each card is a readable width (${f.cards.join(", ")})`);
  ok(f.sw <= f.vw, "and the page does not scroll sideways");
  ok(f.chipH >= 44 && f.reset >= 44, "chips and Reset view are 44 px targets");
  eq(page.__errors, [], "no page error");
  await page.context().close();
}

{
  const page = await boot({ width: 320, height: 640 }, { touch: true });
  const a = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  ok(a.sw <= a.vw, "no sideways scroll at 320 in the price view");
  await page.locator("#ftTabSurface").click();
  await ready(page);
  const b = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  ok(b.sw <= b.vw, "nor in the surface view");
  await page.context().close();
}

{
  const page = await boot(VP, { reduced: true });
  await page.locator("#ftTabSurface").click();
  await ready(page);
  const an = await page.evaluate(() => ({ anims: document.getAnimations().length, tr: [...document.querySelectorAll(".ftsf *")].some((n) => getComputedStyle(n).transitionDuration !== "0s" && getComputedStyle(n).transitionProperty !== "none") }));
  eq(an.anims, 0, "under reduced motion nothing in the surface view is animating");
  await page.context().close();
}

{
  const fund = clone(CARD);
  delete fund.engine;
  fund.panels.surface = { status: "unavailable", reason: "no strike and expiry gamma for this fund" };
  fund.panels.ivSurface = { status: "unavailable" };
  const page = await boot(VP, { card: fund });
  const a = await page.evaluate(() => ({ rail: !!document.querySelector('.ftg-svg [data-layer="gamma"] rect[data-k]'), tick: document.querySelectorAll(".ftg-xt").length, svg: !!document.querySelector(".ftg-svg"), legend: document.querySelector(".ftg-legend").textContent }));
  eq(a.tick, 0, "a card with no expiries draws no expiry ticks");
  ok(a.svg && !a.rail, "and no rail, while the price chart still draws");
  const b = await page.evaluate(() => { const t = document.getElementById("ftTabSurface"); return { disabled: t.disabled, aria: t.getAttribute("aria-disabled"), title: t.title, view: document.getElementById("ftGMain").dataset.view || "price", hidden: document.getElementById("ftGSurf").hidden }; });
  ok(b.disabled && b.aria === "true", "a fund with neither surface nor smile has its surface tab disabled instead of opening a blank panel");
  ok(/^Not on this card: /.test(b.title) && /no strike and expiry gamma for this fund/.test(b.title) && /no fitted smile/i.test(b.title), `and the tab says why (${b.title})`);
  ok(b.view !== "surface" && b.hidden, "and the price view stays in place");
  eq(page.__errors, [], "no page error");
  await page.context().close();

  const noGamma = clone(CARD);
  noGamma.panels.surface = { status: "unavailable", reason: "gamma withheld" };
  const p2 = await boot(VP, { card: noGamma });
  await p2.locator("#ftTabSurface").click();
  await ready(p2);
  const c = await p2.evaluate(() => ({ cols: [...document.querySelectorAll(".ftsf-col")].map((n) => ({ canvas: !!n.querySelector("canvas"), silent: !!n.querySelector(".ui-silent"), text: n.textContent.replace(/\s+/g, " ").slice(0, 160) })), rows: document.querySelectorAll(".ftsf-chip").length }));
  eq(c.cols.map((x) => x.canvas), [false, true, false], "with no gamma grid the terrain is withheld with its reason and the volatility surface still draws");
  ok(c.cols[0].silent && /gamma/i.test(c.cols[0].text), "the terrain column names the gamma reason");
  eq(c.rows, 8, "the chips are the engine's expiries");
  await p2.context().close();

  const noEng = clone(CARD);
  delete noEng.engine;
  const p3 = await boot(VP, { card: noEng });
  const railOnly = await p3.evaluate(() => ({ ticks: document.querySelectorAll(".ftg-xt").length, heads: [...document.querySelectorAll(".ftg-rh")].map((n) => n.textContent), sm: document.querySelectorAll("polyline.ftg-sm").length, text: [...document.querySelectorAll('.ftg-svg [data-layer="gamma"] text')].map((n) => n.textContent).join("|"), sig: document.querySelectorAll(".ftg-svg rect.ftg-sig").length }));
  ok(railOnly.ticks > 0 && railOnly.sm === 0 && railOnly.sig === 0, "with gamma but no engine the rail keeps the gamma bars and says the smile is missing instead of drawing one " + JSON.stringify(railOnly));
  ok(/no fitted smile/i.test(railOnly.text), `in words (${railOnly.text})`);
  await p3.locator("#ftTabSurface").click();
  await ready(p3);
  const d = await p3.evaluate(() => ({ cols: [...document.querySelectorAll(".ftsf-col")].map((n) => ({ canvas: !!n.querySelector("canvas"), text: n.textContent.replace(/\s+/g, " ").slice(0, 140) })) }));
  eq(d.cols.map((x) => x.canvas), [true, false, false], "with gamma but no engine only the terrain draws");
  await p3.context().close();

  const off = await boot(VP, { html: HTML_OFF });
  const e = await off.evaluate(() => ({ tabs: document.querySelectorAll("#ftGTabs [role=tab]").length, rail: !!document.querySelector('.ftg-svg [data-layer="gamma"]') }));
  eq(e.tabs, 0, "with the scenes switch off the page has no surface tab and loads nothing");
  ok(e.rail, "but the price chart still carries the strike rail");
  await off.context().close();
}

{
  const arb = clone(CARD);
  const e = arb.engine.expiries.find((x) => x.expiry === "2026-09-11");
  e.smile.params = sviParams(e.T, 0.355, 0.15);
  const page = await boot(VP, { card: arb });
  await page.locator("#ftTabSurface").click();
  await ready(page);
  const r = await page.evaluate(({ card }) => { const S = window.FlowsUI.tickerSurface.model.surface(card, window.FlowsQuant); return { breaks: S.calendar.breaks.map((b) => [b.from, b.to, b.K]), checked: S.calendar.checked, note: document.querySelector(".ftsf-tab").textContent }; }, { card: arb });
  ok(r.breaks.length > 0 && r.breaks.every(([f, t]) => f === "2026-08-31" && t === "2026-09-11"), `a fitted expiry whose total variance falls below the one before it is found (${r.breaks.length} strikes)`);
  let count = 0;
  const strikes = arb.panels.surface.strikes, K0 = Math.min(...strikes), K1 = Math.max(...strikes);
  const fitted = arb.engine.expiries.filter((x) => x.smile.method !== "flat");
  for (let a = 0; a + 1 < fitted.length; a++) for (let K = K0; K <= K1 + 1e-9; K += 0.5) if (sviW(fitted[a + 1].smile.params, Math.log(K / fitted[a + 1].forward.F)) < sviW(fitted[a].smile.params, Math.log(K / fitted[a].forward.F)) - 1e-9) count++;
  eq(r.breaks.length, count, "and the count is the independent scan's");
  ok(/Calendar check: \d+ strikes where total variance falls with expiry/.test(r.note), "the table's note reports the break");
  await page.context().close();
}

const HOSTCSS = "position:fixed;left:20px;top:20px;width:1100px;height:540px;background:var(--surface-1);z-index:99999;display:flex;flex-direction:column";
const HALF = (n) => "position:fixed;left:" + (n ? 725 : 5) + "px;top:20px;width:700px;height:540px;background:var(--surface-1);z-index:99999;display:flex;flex-direction:column";
const YAW_MAX_DEG = 55, PITCH_MIN_DEG = 8, PITCH_MAX_DEG = 60, ZOOM_LO = 0.7, ZOOM_HI = 2.4;
const REST = { yaw: -34, pitch: 36, zoom: 1 };

async function openSurface(vp, o = {}) {
  const page = await boot(vp, o);
  await page.locator("#ftTabSurface").click();
  await ready(page);
  return page;
}
async function mountAt(page, id, o = {}) {
  await page.evaluate(({ id, card, expiry, css }) => {
    window.__apis = window.__apis || {};
    const host = document.createElement("div");
    host.id = "h-" + id;
    host.style.cssText = css;
    document.body.append(host);
    window.__apis[id] = window.FlowsUI.tickerSurface.mount(host, { card, expiry });
  }, { id, card: o.card || CARD, expiry: o.expiry || null, css: o.css || HOSTCSS });
}
const unmountAt = (page, id) => page.evaluate((id) => { window.__apis[id].destroy(); document.getElementById("h-" + id).remove(); delete window.__apis[id]; }, id);
const motionOf = (page, id) => page.evaluate((id) => window.__apis[id].motion(), id);
const viewOf = (page, id) => page.evaluate((id) => window.__apis[id].view(), id);
const rested = (page, id, timeout = 4000) => page.waitForFunction((id) => window.__apis[id].motion().state === "rest", id, { timeout });
const frames = (page, id) => page.evaluate((id) => window.__apis[id].stages.map((st) => st.cv.toDataURL()), id);
const canvasBox = async (page, id, n = 0) => (await page.locator("#h-" + id + " canvas").nth(n).boundingBox());
const near2 = (a, b, tol, m) => near(a, b, tol, m);

async function dragBy(page, id, dx, dy, o = {}) {
  const b = await canvasBox(page, id, 0);
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const n = o.steps || 12;
  for (let i = 1; i <= n; i++) { await page.mouse.move(x0 + (dx * i) / n, y0 + (dy * i) / n); if (o.gap) await page.waitForTimeout(o.gap); }
  if (!o.hold) await page.mouse.up();
  return { x: x0 + dx, y: y0 + dy };
}

async function chkClamp(page) {
  await mountAt(page, "c");
  await rested(page, "c");
  await dragBy(page, "c", 900, 700, { steps: 30, hold: true });
  const hi = await viewOf(page, "c");
  ok(hi.yaw <= YAW_MAX_DEG + 1e-9 && hi.pitch <= PITCH_MAX_DEG + 1e-9, `a hard drag one way stops at the clamps while the pointer is still down (yaw ${hi.yaw.toFixed(2)}, pitch ${hi.pitch.toFixed(2)})`);
  near2(hi.yaw, YAW_MAX_DEG, 1e-9, "yaw reaches exactly its limit");
  near2(hi.pitch, PITCH_MAX_DEG, 1e-9, "pitch reaches exactly its limit");
  await page.mouse.up();
  await rested(page, "c");
  await dragBy(page, "c", -2200, -1700, { steps: 40, hold: true });
  const lo = await viewOf(page, "c");
  near2(lo.yaw, -YAW_MAX_DEG, 1e-9, "and the other way stops at the other limit");
  near2(lo.pitch, PITCH_MIN_DEG, 1e-9, "pitch stops at its floor");
  await page.mouse.up();
  await rested(page, "c");
  await unmountAt(page, "c");
}

async function chkInertia(page) {
  await mountAt(page, "i");
  await rested(page, "i");
  await page.evaluate(() => window.__apis.i.go("front"));
  await rested(page, "i");
  const v0 = await viewOf(page, "i");
  await dragBy(page, "i", 36, 0, { steps: 6, hold: true });
  await page.mouse.up();
  const m = await motionOf(page, "i");
  ok(m.vy > 10, `a flick leaves the scene turning (${m.vy.toFixed(1)} deg/s)`);
  const a = await viewOf(page, "i");
  await page.waitForTimeout(120);
  const b = await viewOf(page, "i");
  ok(b.yaw - a.yaw > 0.05, "it keeps turning after the pointer is released, in the direction of the flick");
  await page.waitForTimeout(280);
  const mid = await motionOf(page, "i");
  ok(mid.vy < m.vy * 0.5, `and slows as it goes (${m.vy.toFixed(0)} to ${mid.vy.toFixed(0)} deg/s in 0.4 s)`);
  await rested(page, "i", 3000);
  const e = await motionOf(page, "i");
  eq([e.vy, e.vp], [0, 0], "inertia ends: no residual velocity once the loop stops");
  const c = await viewOf(page, "i");
  ok(c.yaw - v0.yaw > 3 && c.yaw - a.yaw > 0 && c.yaw - a.yaw < m.vy, `and the glide is short: ${(c.yaw - a.yaw).toFixed(1)} degrees after release, under one second at the ${m.vy.toFixed(0)} deg/s it was released at`);
  await page.waitForTimeout(300);
  eq(await viewOf(page, "i"), c, "and the scene is still");
  await dragBy(page, "i", 160, 0, { steps: 8, hold: true });
  await page.mouse.up();
  await page.waitForTimeout(40);
  const bx = await canvasBox(page, "i", 0);
  await page.mouse.move(bx.x + 30, bx.y + 30);
  await page.mouse.down();
  const s1 = await viewOf(page, "i");
  await page.waitForTimeout(150);
  eq(await viewOf(page, "i"), s1, "touching the scene again stops the glide at once");
  await page.mouse.up();
  await unmountAt(page, "i");
}

async function chkZoom(page) {
  await mountAt(page, "z");
  await rested(page, "z");
  const b = await canvasBox(page, "z", 0);
  await page.mouse.move(b.x + 40, b.y + 40);
  await page.mouse.wheel(0, -200);
  await rested(page, "z");
  ok((await viewOf(page, "z")).zoom > 1.1, "the wheel zooms in");
  for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -600);
  await rested(page, "z");
  near2((await viewOf(page, "z")).zoom, ZOOM_HI, 1e-9, "zoom in stops at its limit");
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 600);
  await rested(page, "z");
  near2((await viewOf(page, "z")).zoom, ZOOM_LO, 1e-9, "zoom out stops at its limit");
  await page.evaluate(() => {
    const cv = document.querySelector("#h-z canvas");
    const at = (id, x, y, type) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 11 }));
    const r = cv.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    at(11, cx - 20, cy, "pointerdown"); at(12, cx + 20, cy, "pointerdown");
    for (let i = 1; i <= 8; i++) { at(11, cx - 20 - i * 12, cy, "pointermove"); at(12, cx + 20 + i * 12, cy, "pointermove"); }
    at(11, cx, cy, "pointerup"); at(12, cx, cy, "pointerup");
  });
  await rested(page, "z");
  const pz = (await viewOf(page, "z")).zoom;
  ok(pz > 1.5, `spreading two fingers zooms in (${pz.toFixed(2)}) and does not orbit`);
  eq((await viewOf(page, "z")).yaw, REST.yaw, "a pinch leaves the yaw where it was");
  await page.keyboard.press("Tab");
  await unmountAt(page, "z");
}

async function chkKeys(page) {
  await mountAt(page, "k");
  await rested(page, "k");
  await page.locator("#h-k canvas").first().focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  near2((await viewOf(page, "k")).yaw, REST.yaw + 15, 1e-9, "each right arrow turns five degrees");
  near2((await viewOf(page, "k")).pitch, REST.pitch + 3, 1e-9, "and up tilts three");
  await page.keyboard.press("+");
  await rested(page, "k");
  near2((await viewOf(page, "k")).zoom, 1.2, 1e-9, "plus zooms in by a fifth");
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  await rested(page, "k");
  near2((await viewOf(page, "k")).zoom, 1 / 1.2, 1e-9, "minus zooms out");
  await page.keyboard.press("Home");
  await rested(page, "k");
  eq(await viewOf(page, "k"), REST, "Home glides back to the rest view exactly");
  await dragBy(page, "k", 120, 60, { steps: 6 });
  await rested(page, "k");
  ok((await viewOf(page, "k")).yaw !== REST.yaw, "a drag moves the view");
  const b = await canvasBox(page, "k", 0);
  await page.mouse.dblclick(b.x + 10, b.y + 10);
  await rested(page, "k");
  eq(await viewOf(page, "k"), REST, "a double click recentres exactly");
  await unmountAt(page, "k");
}

async function chkPresets(page) {
  await mountAt(page, "p");
  await rested(page, "p");
  for (const [name, to] of [["side", { yaw: 52, pitch: 14, zoom: 1 }], ["top", { yaw: 0, pitch: PITCH_MAX_DEG, zoom: 1 }], ["front", { yaw: 0, pitch: 14, zoom: 1 }], ["reset", REST]]) {
    const from = await viewOf(page, "p");
    const trace = await page.evaluate(({ name }) => new Promise((res) => {
      const api = window.__apis.p, t0 = performance.now(), out = [];
      document.querySelector('#h-p .ftsf-vb[data-view="' + name + '"]').click();
      const tick = () => { const v = api.view(); out.push([performance.now() - t0, v.yaw, v.pitch, api.motion().state]); if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(out); };
      requestAnimationFrame(tick);
    }), { name });
    const end = trace[trace.length - 1];
    near2(end[1], to.yaw, 1e-9, `${name}: yaw ends exactly on the preset`);
    near2(end[2], to.pitch, 1e-9, `${name}: pitch ends exactly on the preset`);
    const settledAt = (trace.find((r) => r[3] === "rest") || [9999])[0];
    ok(settledAt <= 720 && settledAt >= 300, `${name}: the glide takes ${Math.round(settledAt)} ms, under 700 and not a cut`);
    const dist = trace.map((r) => Math.hypot(r[1] - to.yaw, (r[2] - to.pitch) * 1.3));
    let mono = true;
    for (let i = 1; i < dist.length; i++) if (dist[i] > dist[i - 1] + 1e-6) mono = false;
    ok(mono, `${name}: the distance to the target never grows during the glide`);
    if (Math.hypot(from.yaw - to.yaw, from.pitch - to.pitch) > 5) ok(trace.some((r, i) => i > 0 && Math.hypot(r[1] - from.yaw, r[2] - from.pitch) > 0.5 && Math.hypot(r[1] - to.yaw, r[2] - to.pitch) > 0.5), `${name}: there are frames strictly between the two views`);
    const on = await page.evaluate(() => [...document.querySelectorAll("#h-p .ftsf-vb[data-view]")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.view));
    eq(on, [name], `${name}: its button is the one pressed`);
  }
  await unmountAt(page, "p");
}

async function chkAuto(page) {
  await mountAt(page, "a");
  await rested(page, "a");
  const btn = page.locator("#h-a .ftsf-auto");
  eq(await btn.getAttribute("aria-pressed"), "false", "Auto starts off");
  const y0 = (await viewOf(page, "a")).yaw;
  await btn.click();
  eq(await btn.getAttribute("aria-pressed"), "true", "the toggle is a pressed button");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  near2((await viewOf(page, "a")).yaw, y0, 1e-9, "it waits for the reader to be still before it drifts");
  await page.waitForTimeout(1700);
  const y1 = (await viewOf(page, "a")).yaw;
  ok(Math.abs(y1 - y0) > 0.8, `then it drifts gently (${(y1 - y0).toFixed(2)} degrees)`);
  ok((await motionOf(page, "a")).state === "moving", "and the loop runs while it does");
  const b = await canvasBox(page, "a", 0);
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  const y2 = (await viewOf(page, "a")).yaw;
  await page.waitForTimeout(500);
  near2((await viewOf(page, "a")).yaw, y2, 1e-9, "holding the scene pauses it");
  await page.mouse.up();
  await page.waitForTimeout(500);
  near2((await viewOf(page, "a")).yaw, y2, 1e-9, "and it stays paused for a moment after you let go");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(900);
  const hid = await motionOf(page, "a");
  const y3 = (await viewOf(page, "a")).yaw;
  await page.waitForTimeout(500);
  eq([(await viewOf(page, "a")).yaw, (await motionOf(page, "a")).frames], [y3, hid.frames], "a hidden tab turns nothing and runs no frame");
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.getElementById("h-a").style.transform = "translateY(-4000px)"; });
  await page.waitForTimeout(500);
  const off = await motionOf(page, "a");
  const y4 = (await viewOf(page, "a")).yaw;
  await page.waitForTimeout(500);
  eq([(await viewOf(page, "a")).yaw, (await motionOf(page, "a")).frames], [y4, off.frames], "a scene scrolled out of view turns nothing and runs no frame");
  await page.evaluate(() => { document.getElementById("h-a").style.transform = ""; });
  await page.waitForTimeout(600);
  await btn.click();
  await rested(page, "a");
  eq(await btn.getAttribute("aria-pressed"), "false", "toggling off ends the loop");
  await unmountAt(page, "a");
}

async function chkCensus(page) {
  await mountAt(page, "n");
  await rested(page, "n");
  const a = await motionOf(page, "n");
  await page.waitForTimeout(900);
  const b = await motionOf(page, "n");
  eq([b.paints, b.frames, b.state], [a.paints, a.frames, "rest"], "at rest nothing paints and no frame runs");
  await page.mouse.move(700, 300);
  await page.mouse.move(720, 310);
  await rested(page, "n");
  const c = await motionOf(page, "n");
  await page.waitForTimeout(700);
  eq((await motionOf(page, "n")).paints, c.paints, "after a hover settles the census is zero again");
  await unmountAt(page, "n");
}

function gammaWordIn(page, g) {
  return page.evaluate((g) => { const F = window.FlowsUI.F, traded = window.__apis.h.model.surface.xp.basis === "traded"; return (g < 0 ? window.FlowsUI.MINUS : g > 0 ? "+" : "") + (traded ? F.num(Math.abs(g)) : F.money(Math.abs(g))); }, g);
}

async function chkHover(page) {
  await mountAt(page, "h");
  await rested(page, "h");
  const pts = await page.evaluate(() => { const st = window.__apis.h.stages[0].s; return st.pool.slice(0, st.np).map((p) => ({ x: p.x, y: p.y, j: p.j, i: p.i, K: p.K, v: p.v })); });
  ok(pts.length > 60, `the terrain exposes ${pts.length} hit points, one for each drawn column`);
  const b = await canvasBox(page, "h", 0);
  const pick = (f) => pts.filter((p) => p.v !== null && Math.abs(p.v) > 1e6).reduce((a, p) => (f(p) < f(a) ? p : a));
  const A = pick((p) => p.x + p.y), B = pick((p) => -(p.x + p.y));
  ok(A.v !== B.v, "two distinct columns to hover");
  await page.mouse.move(b.x + A.x, b.y + A.y);
  await page.mouse.move(b.x + A.x + 0.5, b.y + A.y);
  await rested(page, "h");
  const m = await motionOf(page, "h");
  ok(m.hover && m.hover.j === A.j && m.hover.i === A.i, "the pointer picks the column under it");
  const row = await page.evaluate((j) => window.__apis.h.model.surface.rows.find((r) => r.j === j).expiry, A.j);
  const di = SURFACE_GAMMA_DATES.indexOf(row);
  const cardG = CARD.panels.surface.oi.gamma[A.i][di];
  eq(cardG, A.v, "its value is the card's own gamma cell");
  const tip = await page.evaluate(() => { const t = document.querySelector("#h-h .ftsf-tip:not([hidden])"); return t ? { l: t.querySelector(".ftsf-tip-l").textContent, v: t.querySelector(".ftsf-tip-v").textContent } : null; });
  ok(tip !== null, "a floating readout appears");
  eq(tip.v, await gammaWordIn(page, A.v), "and says the cell's value exactly once the count settles");
  const want = await page.evaluate(({ K, row }) => "$" + window.FlowsUI.F.px(K, K % 1 ? 1 : 0) + " " + window.FlowsUI.MID + " " + window.FlowsUI.F.day(row), { K: A.K, row });
  eq(tip.l, want, "with its strike and expiry");
  const lit = await page.evaluate(() => window.__apis.h.stages[0].cv.toDataURL());
  await page.mouse.move(b.x + B.x, b.y + B.y);
  const seen = new Set();
  const t0 = Date.now();
  let last = Date.now();
  let prev = null;
  while (Date.now() - t0 < 900) {
    const v = await page.evaluate(() => { const t = document.querySelector("#h-h .ftsf-tip:not([hidden]) .ftsf-tip-v"); return t ? t.textContent : null; });
    if (v !== prev) { seen.add(v); prev = v; last = Date.now(); }
    await page.waitForTimeout(8);
  }
  const expectB = await gammaWordIn(page, B.v);
  eq(prev, expectB, "the readout lands on the new cell's exact value");
  ok(seen.size >= 3, `and it counted through ${seen.size - 1} figures on the way`);
  ok(last - t0 < 700, `the count and the slide finish within 700 ms (${last - t0} ms)`);
  await rested(page, "h");
  ok((await page.evaluate(() => window.__apis.h.stages[0].cv.toDataURL())) !== lit, "the lit cell moved with the pointer");
  await page.mouse.move(5, 5);
  await rested(page, "h");
  eq(await page.evaluate(() => document.querySelectorAll("#h-h .ftsf-tip:not([hidden])").length), 0, "leaving the scene hides the readout");
  await unmountAt(page, "h");
}

async function chkSettled(page, reducedFrames) {
  const CARD2 = clone(CARD);
  CARD2.panels.surface.oi.gamma = CARD2.panels.surface.oi.gamma.map((r, i) => r.map((v, j) => (v === null ? null : Math.round(v * (1.7 - 0.9 * Math.sin(i + j))))));
  const alt = surfaceCard(JSON.parse(JSON.stringify(base)), { scale: { "2026-08-28": 1.25, "2026-08-31": 1.12, "2026-09-18": 0.9 } });
  CARD2.engine = alt.engine;
  await mountAt(page, "A", { css: HALF(0) });
  await mountAt(page, "B", { card: CARD2, css: HALF(1) });
  await rested(page, "A");
  await rested(page, "B");
  const A0 = await frames(page, "A"), B0 = await frames(page, "B");
  ok(A0[0] !== B0[0] && A0[1] !== B0[1], "the two cards draw differently");
  const ok1 = await page.evaluate((card) => window.__apis.A.update(card), CARD2);
  eq(ok1, true, "an update with the same shape is accepted");
  await page.waitForTimeout(170);
  const mid = await frames(page, "A");
  ok(mid[0] !== A0[0] && mid[0] !== B0[0], "mid-tween the terrain is neither the old nor the new frame");
  ok(mid[1] !== A0[1] && mid[1] !== B0[1], "and neither is the surface");
  await rested(page, "A", 1500);
  const A1 = await frames(page, "A");
  eq(A1[0] === B0[0] && A1[1] === B0[1], true, "once the tween ends the frame equals a fresh mount of the new card, pixel for pixel");
  const m = await motionOf(page, "A");
  eq([m.tween, m.grow], [1, 1], "and the tween and the grow are both at one");
  await page.evaluate(() => window.__apis.A.setExpiry("2026-09-11"));
  await page.waitForTimeout(160);
  const midE = await frames(page, "A");
  await rested(page, "A", 1500);
  const AE = await frames(page, "A");
  ok(midE[0] !== AE[0], "an expiry change rises the chosen row on the way");
  await unmountAt(page, "B");
  await mountAt(page, "B", { card: CARD2, expiry: "2026-09-11", css: HALF(1) });
  await rested(page, "B");
  const BE = await frames(page, "B");
  eq(AE[0] === BE[0] && AE[1] === BE[1], true, "after the move the frame equals a fresh mount at that expiry");
  await unmountAt(page, "A");
  await unmountAt(page, "B");
  await mountAt(page, "G");
  await page.waitForTimeout(110);
  const grow = await frames(page, "G");
  const gm = await motionOf(page, "G");
  ok(gm.grow < 1 && gm.state === "moving", "a fresh mount grows from the floor");
  await rested(page, "G", 1500);
  const done = await frames(page, "G");
  ok(grow[0] !== done[0] && grow[1] !== done[1], "the entry frames differ from the settled ones");
  if (reducedFrames) { eq(done, reducedFrames, "the settled frame equals the one drawn with reduced motion, pixel for pixel"); }
  await unmountAt(page, "G");
  return done;
}

async function chkReduced(page) {
  await mountAt(page, "r");
  const m = await motionOf(page, "r");
  eq([m.grow, m.state, m.reduced], [1, "rest", true], "under reduced motion a mount is settled at once");
  const btn = page.locator("#h-r .ftsf-auto");
  ok(await btn.isDisabled(), "Auto-rotate is switched off and says so");
  await page.evaluate(() => document.querySelector("#h-r .ftsf-auto").click());
  const y0 = (await viewOf(page, "r")).yaw;
  await page.waitForTimeout(2600);
  eq([(await viewOf(page, "r")).yaw, (await motionOf(page, "r")).state], [y0, "rest"], "it never turns");
  await page.evaluate(() => document.querySelector('#h-r .ftsf-vb[data-view="side"]').click());
  eq((await viewOf(page, "r")).yaw, 52, "a preset cuts straight to its view");
  const b = await canvasBox(page, "r", 0);
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.wheel(0, -300);
  ok((await viewOf(page, "r")).zoom > 1.2, "zoom lands at once");
  await dragBy(page, "r", 160, 0, { steps: 8, hold: true });
  await page.mouse.up();
  await rested(page, "r");
  eq([(await motionOf(page, "r")).vy, (await motionOf(page, "r")).state], [0, "rest"], "a flick does not glide");
  await unmountAt(page, "r");
}

async function chkCost(page) {
  await mountAt(page, "f");
  await rested(page, "f");
  const r = await page.evaluate(() => {
    const api = window.__apis.f;
    const t = [], q = [];
    const c = document.createElement("canvas");
    c.width = 360; c.height = 200;
    const x = c.getContext("2d");
    const refwork = () => { for (let n = 0; n < 1600; n++) { x.beginPath(); x.moveTo(n % 300, 10); x.lineTo(n % 300 + 9, 14); x.lineTo(n % 300 + 6, 40); x.lineTo(n % 300 - 3, 30); x.closePath(); x.globalAlpha = 0.5; x.fillStyle = "rgb(10,200,30)"; x.fill(); x.stroke(); } };
    for (let i = 0; i < 12; i++) { api.repaint(); refwork(); }
    for (let i = 0; i < 160; i++) {
      const a = performance.now(); api.repaint(); t.push(performance.now() - a);
      const b = performance.now(); refwork(); q.push(performance.now() - b);
    }
    t.sort((u, v) => u - v); q.sort((u, v) => u - v);
    return { sub: t[80], ref: q[80], p90: t[144] };
  });
  console.log(`  frame cost (both canvases): median ${r.sub.toFixed(2)} ms, p90 ${r.p90.toFixed(2)} ms, reference ${r.ref.toFixed(2)} ms, ratio ${(r.sub / r.ref).toFixed(2)}`);
  ok(r.sub < 3.5, `a frame of both scenes costs ${r.sub.toFixed(2)} ms at the median, under 3.5`);
  ok(r.sub / r.ref < 3, `and ${(r.sub / r.ref).toFixed(2)} times a reference canvas workload of the same path count, under 3`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const h0 = await cdp.send("Runtime.getHeapUsage");
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__apis.f.repaint(); });
  const h1 = await cdp.send("Runtime.getHeapUsage");
  const kib = (h1.usedSize - h0.usedSize) / 40 / 1024;
  ok(kib < 64, `a frame allocates ${kib.toFixed(1)} KiB, a small constant (no mesh or cell arrays are rebuilt)`);
  await cdp.detach();
  await unmountAt(page, "f");
}

async function chkTouch(page) {
  await mountAt(page, "t", { css: "position:fixed;left:16px;top:60px;width:358px;height:700px;background:var(--surface-1);z-index:99999;display:flex;flex-direction:column;container-type:inline-size" });
  await rested(page, "t");
  const ta = await page.evaluate(() => getComputedStyle(document.querySelector("#h-t canvas")).touchAction);
  eq(ta, "pan-y", "a canvas hands vertical panning to the page and keeps horizontal drags");
  const b = await canvasBox(page, "t", 0);
  const cdp = await page.context().newCDPSession(page);
  const touch = async (pts) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pts[0]] });
    for (const p of pts.slice(1)) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [p] }); await page.waitForTimeout(10); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const y0 = (await viewOf(page, "t")).yaw;
  await touch(Array.from({ length: 10 }, (_, i) => ({ x: cx - 60 + i * 12, y: cy })));
  await rested(page, "t", 3000);
  const y1 = (await viewOf(page, "t")).yaw;
  ok(Math.abs(y1 - y0) > 15, `a horizontal swipe on the scene turns it (${(y1 - y0).toFixed(1)} degrees)`);
  await touch(Array.from({ length: 10 }, (_, i) => ({ x: cx, y: cy - 60 + i * 12 })));
  await rested(page, "t", 3000);
  const y2 = (await viewOf(page, "t")).yaw;
  ok(Math.abs(y2 - y1) < 2, `a vertical swipe does not turn it, the page takes it (${(y2 - y1).toFixed(2)} degrees)`);
  await cdp.detach();
  await unmountAt(page, "t");
}

let REDUCED_FRAMES;
{
  const page = await boot(VP, { reduced: true });
  await page.locator("#ftTabSurface").click();
  await ready(page);
  await chkReduced(page);
  await mountAt(page, "x");
  await rested(page, "x");
  REDUCED_FRAMES = await frames(page, "x");
  await unmountAt(page, "x");
  eq(page.__errors, [], "no page error under reduced motion");
  await page.context().close();
}
{
  const page = await openSurface(VP);
  await chkClamp(page);
  await chkInertia(page);
  await chkZoom(page);
  await chkKeys(page);
  await chkPresets(page);
  await chkAuto(page);
  await chkCensus(page);
  await chkHover(page);
  await chkSettled(page, REDUCED_FRAMES);
  await chkCost(page);
  eq(page.__errors, [], "no page error across orbit, zoom, presets, auto-rotate, hover and tweens");
  await page.context().close();
}
{
  const page = await openSurface({ width: 390, height: 844 }, { touch: true });
  await chkTouch(page);
  eq(page.__errors, [], "no page error with touch");
  await page.context().close();
}

const MUTANTS = [
  ["the rail is drawn three pixels off the price axis", "/assets/js/flows-ticker-glance.js", (s) => s.replace("yy = y(K) - th / 2;", "yy = y(K) - th / 2 + 3;"), "rail"],
  ["the one-sigma band is half as wide", "/assets/js/flows-ticker-glance.js", (s) => s.replace("const up = S * Math.exp(row.sd), dn = S * Math.exp(-row.sd);", "const up = S * Math.exp(row.sd / 2), dn = S * Math.exp(-row.sd / 2);"), "rail"],
  ["the 25-delta put and call strikes are swapped", "/assets/js/flows-ticker-glance.js", (s) => s.replace('[[sk.Kp, sk.ivp, "ftg-d25p", "25Δp", true], [sk.Kc, sk.ivc, "ftg-d25c", "25Δc", false]]', '[[sk.Kc, sk.ivc, "ftg-d25p", "25Δp", true], [sk.Kp, sk.ivp, "ftg-d25c", "25Δc", false]]'), "rail"],
  ["a missing gamma cell is drawn as a zero bar", "/assets/js/flows-ticker-glance.js", (s) => s.replace("if (g === null) { s(\"rect\", { x: cxg - 3.5", "if (false) { s(\"rect\", { x: cxg - 3.5"), "rail"],
  ["the cursor starts on the first expiry", "/assets/js/flows-ticker-glance.js", (s) => s.replace("const r = rows.find((x) => x.dte >= 7) || rows[rows.length - 1];", "const r = rows[0];"), "rail"],
  ["time-axis labels are not thinned", "/assets/js/flows-ticker-glance.js", (s) => s.replace("for (const e of [ents[ents.length - 1]].concat(ents)) if (!kept.includes(e) && fits(e)) kept.push(e);", "for (const e of ents) if (!kept.includes(e)) kept.push(e);"), "rail"],
  ["the cursor ignores the clicked tick", "/assets/js/flows-ticker-glance.js", (s) => s.replace("g.addEventListener(\"click\", () => pick(e.r.expiry));", "g.addEventListener(\"click\", () => pick(rows[0].expiry));"), "click"],
  ["a flat expiry is drawn as a fitted curve", "/assets/js/flows-ticker-glance.js", (s) => s.replace("const st = sm && MSTATE[sm.method] ? MSTATE[sm.method] : [\"none\", \"NO FIT\"];", "const st = sm && MSTATE[sm.method] ? (sm.method === \"flat\" ? [\"fit\", \"FITTED SVI\"] : MSTATE[sm.method]) : [\"none\", \"NO FIT\"];"), "model"],
  ["the surface interpolates implied vol instead of total variance", "/assets/js/flows-ticker-surface.js", (s) => s.replace("const w = w0 + (w1 - w0) * u, T = r0.Tx + (r1.Tx - r0.Tx) * u;", "const w = (Math.sqrt(w0 / r0.Tx) * (1 - u) + Math.sqrt(w1 / r1.Tx) * u) ** 2 * (r0.Tx + (r1.Tx - r0.Tx) * u), T = r0.Tx + (r1.Tx - r0.Tx) * u;"), "surface"],
  ["the mesh bridges across an expiry with no fit by dropping the interpolation flag", "/assets/js/flows-ticker-surface.js", (s) => s.replace("const interp = r1.j - r0.j > 1;", "const interp = false;"), "surface"],
  ["the calendar check is switched off", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (w1 < w0 - 1e-9) out.calendar.breaks.push", "if (false) out.calendar.breaks.push"), "calendar"],
  ["an expiry with no fit is meshed as if it were fitted", "/assets/js/flows-ticker-surface.js", (s) => s.replace("const fitted = (r) => r.state !== \"none\" && r.slice && FQ && r.F > 0 && r.Tx > 0;", "const fitted = (r) => r.F > 0 && r.Tx > 0 && FQ && r.slice !== undefined && r.method !== null;"), "surface"],
  ["missing gamma cells become zeros in the terrain", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (g === null) { gaps++;", "if (g === null) { gaps++; cells.push({ i, j: r.j, K, g: 0, h: 0, clip: false }); return; }\n      if (false) { gaps++;"), "surface"],
];

async function mutantFacts(page, kind) {
  const out = [];
  const guard = async (name, fn) => { try { await fn(); } catch (e) { out.push(name + ": " + String(e.message).split("\n")[0]); } };
  if (kind === "rail") {
    await guard("rail", () => checkRail(page, "2026-08-31", "mutant"));
  } else if (kind === "click") {
    await guard("click", async () => {
      await page.locator('.ftg-xt[data-expiry="2026-09-11"] rect').click();
      await page.waitForTimeout(100);
      await checkRail(page, "2026-09-11", "mutant click");
    });
  } else if (kind === "model") {
    await guard("model", async () => {
      const states = await page.evaluate(({ card }) => window.FlowsUI.tickerGlance.model.expiries(card, window.FlowsQuant).rows.map((r) => r.state), { card: CARD });
      eq(states, ["fit", "fit", "fit", "none", "none", "none", "repaired", "repaired", "repaired"], "states");
    });
  } else {
    await guard(kind, async () => {
      const mm = await page.evaluate(({ card }) => {
        const S = window.FlowsUI.tickerSurface.model.surface(card, window.FlowsQuant);
        const m = S.between(S.fit[2], S.fit[3], 0.5, (S.K0 + S.K1) / 2);
        return { mid: m && m.iv, interp: S.mesh.filter((q) => q.u0 === 0).map((q) => q.interp), breaks: S.calendar.breaks.length, fitStates: S.mesh.map((q) => [q.r0.state, q.r1.state]), terrainNulls: window.FlowsUI.tickerSurface.model.terrain(S).cells.filter((c) => c.g === null).length };
      }, { card: kind === "calendar" ? MUTANT_ARB : CARD });
      const a = ENG["2026-08-31"], c = ENG["2026-09-11"], K = (Math.min(...CARD.panels.surface.strikes) + Math.max(...CARD.panels.surface.strikes)) / 2;
      const wInd = (e, KK) => sviW(ENG[e].smile.params, Math.log(KK / ENG[e].forward.F));
      if (kind === "surface") {
        near(mm.mid, Math.sqrt((wInd("2026-08-31", K) + wInd("2026-09-11", K)) / 2 / ((a.T + c.T) / 2)), 1e-12, "interpolated vol");
        eq(mm.interp, [false, false, true, false, false], "interp flags");
        ok(mm.fitStates.every(([p, q]) => p !== "none" && q !== "none"), "mesh states");
        eq(mm.terrainNulls, CARD.panels.surface.oi.gamma.flat().filter((v) => v === null).length, "null cells stay null");
      } else eq(mm.breaks > 0, true, "calendar break found");
    });
  }
  return out;
}
const MUTANT_ARB = clone(CARD);
{
  const e = MUTANT_ARB.engine.expiries.find((x) => x.expiry === "2026-09-11");
  e.smile.params = sviParams(e.T, 0.355, 0.15);
}

{
  const clean = await boot(VP);
  eq(await mutantFacts(clean, "rail"), [], "the unmutated rail passes the fact set the mutants must fail");
  await clean.context().close();
}
for (const [name, file, fn, kind] of MUTANTS) {
  const page = await boot(VP, { mutate: { [file]: fn }, card: kind === "calendar" ? MUTANT_ARB : CARD });
  const src = fs.readFileSync(path.join(ROOT, file.slice(1)), "utf8");
  ok(fn(src) !== src, `mutant "${name}" changes the module`);
  if (kind === "surface" || kind === "calendar") {
    await page.locator("#ftTabSurface").click();
    await ready(page).catch(() => {});
  }
  const got = await mutantFacts(page, kind);
  ok(got.length > 0, `planted wrong build "${name}" is caught (${got[0] || "NOT CAUGHT"})`);
  await page.context().close();
}


const ORBIT_MUTANTS = [
  ["a drag orbits without the yaw clamp", "/assets/js/flows-ticker-surface.js", (s) => s.replace("view.yaw = clamp(view.yaw + dy * DEG, -YAW_MAX, YAW_MAX);", "view.yaw = view.yaw + dy * DEG;"), "clamp"],
  ["inertia never decays", "/assets/js/flows-ticker-surface.js", (s) => s.replace("const k = Math.exp(-dt / 0.32);", "const k = 1;"), "inertia"],
  ["a data tween never reaches one", "/assets/js/flows-ticker-surface.js", (s) => s.replace("M.tw = p >= 1 || M.reduced ? 1 : Math.max(0, p);", "M.tw = Math.min(0.98, Math.max(0, p));"), "settled"],
  ["the entry grow never reaches one", "/assets/js/flows-ticker-surface.js", (s) => s.replace("M.grow = p >= 1 || M.reduced ? 1 : Math.max(0, p);", "M.grow = Math.min(0.97, Math.max(0, p));"), "settled"],
  ["a count-up stops short and leaves the mid-count figure on screen", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (p >= 1) { M.shown = M.cu.to; M.cu = null; }", "if (p >= 1) { M.cu = null; }").replace("M.shown = lerp(M.cu.from, M.cu.to, EASE.out(Math.max(0, p)));", "M.shown = lerp(M.cu.from, M.cu.to, EASE.out(Math.max(0, p)) * 0.8);"), "hover"],
  ["auto-rotate ignores reduced motion", "/assets/js/flows-ticker-surface.js", (s) => s.replace("autoBtn.disabled = M.reduced;", "autoBtn.disabled = false;").replace("M.auto = !M.auto && !M.reduced;", "M.auto = !M.auto;").replace("if (M.auto && !M.reduced && M.visible && M.inView) {", "if (M.auto && M.visible && M.inView) {"), "reduced"],
  ["auto-rotate keeps running in a hidden or off-screen scene", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (M.auto && !M.reduced && M.visible && M.inView) {", "if (M.auto && !M.reduced) {").replace("if (again && M.visible) M.raf", "if (again) M.raf"), "auto"],
  ["wheel zoom has no clamp", "/assets/js/flows-ticker-surface.js", (s) => s.replace("M.zt = clamp(z, ZOOM_MIN, ZOOM_MAX);", "M.zt = z;"), "zoom"],
  ["a preset cuts instead of gliding", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (M.reduced) cutTo(to);", "if (true) cutTo(to);"), "presets"],
  ["a double click does nothing", "/assets/js/flows-ticker-surface.js", (s) => s.replace('cv.addEventListener("dblclick"', 'cv.addEventListener("dblclickx"'), "keys"],
  ["the loop never stops at rest", "/assets/js/flows-ticker-surface.js", (s) => s.replace("if (again && M.visible) M.raf = requestAnimationFrame(step); else {", "if (true) M.raf = requestAnimationFrame(step); else {"), "census"],
  ["the canvas takes every touch, vertical ones included", "/assets/css/flows-ticker.css", (s) => s.replace("touch-action: pan-y;", "touch-action: none;"), "touch"],
];
const ORBIT_CHECK = { clamp: chkClamp, inertia: chkInertia, settled: (p) => chkSettled(p, null), hover: chkHover, reduced: chkReduced, auto: chkAuto, zoom: chkZoom, presets: chkPresets, keys: chkKeys, census: chkCensus, touch: chkTouch };
for (const [name, file, fn, kind] of ORBIT_MUTANTS) {
  const src = fs.readFileSync(path.join(ROOT, file.slice(1)), "utf8");
  ok(fn(src) !== src, `mutant "${name}" changes the file`);
  const page = await boot(kind === "touch" ? { width: 390, height: 844 } : VP, { mutate: { [file]: fn }, reduced: kind === "reduced", touch: kind === "touch" });
  let caught = null;
  try {
    await page.locator("#ftTabSurface").click();
    await ready(page);
    await ORBIT_CHECK[kind](page);
  } catch (e) { caught = String(e.message).split("\n")[0]; }
  ok(caught !== null, `planted wrong build "${name}" is caught (${caught || "NOT CAUGHT"})`);
  await page.context().close();
}

await browser.close();
console.log(`flows-surface-render: ${checks} assertions - the strike rail on one price axis, the expiry cursor and its one-sigma band, 25-delta, risk reversal and butterfly against an independent solve and the engine's own figures, missing cells as dashed outlines, thinned time-axis labels, the chart panel's tab, the three-up surface and terrain, total-variance interpolation and the calendar check, withheld states, and ${MUTANTS.length + ORBIT_MUTANTS.length} planted wrong builds, and the orbit: drag, flick inertia, wheel and pinch zoom with clamps, keys, double click, presets, auto-rotate that stops hidden, off screen and under reduced motion, the hover readout and its count-up, entry grow and data tweens that settle to the fresh-mount frame pixel for pixel, a zero paint census at rest, frame cost and touch`);
