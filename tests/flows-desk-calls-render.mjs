import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import * as P from "../shared/flows-premium.js";
import { carryOf, deltaBand } from "../shared/flows-quant-forward.js";
import { syxChain, NODE_Q, REPO, openDesk, showView } from "./desk-fixtures.mjs";
import { ratioTextExact, dollarsTextExact, ratioMicroExact } from "./lib/pc-oracle.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

const SC_FAM = Object.freeze({ id: "custom", risk: "undefined", dir: "neutral" });
const asOfOf = (p) => Math.min(NODE_Q.closeUtcMs(p.asOf), Date.parse(p.generatedAt));
const fitOf = (p, r) => {
  const eng = p.engine, rate = eng.rate;
  const asOfMs = asOfOf(p);
  const row = { K: r.strike, type: "C", bid: r.bid, ask: r.ask, oi: r.oi, volume: r.volume, sym: r.symbol, ivSeed: r.iv, opposite: r.opposite };
  const input = { expiry: r.expiry, asOfMs, spot: p.spot, rate: rate.r, rateMethod: rate.method, facts: eng.facts, expiries: eng.expiries, row };
  return { fit: NODE_Q.contractFit(input), asOfMs, row };
};
const bandOracle = (p, r) => {
  const { fit } = fitOf(p, r);
  if (!fit) return null;
  const c = fit.slice.contract;
  const se = carryOf({ S: p.spot, r: fit.forward.r, T: fit.T, q: fit.forward.carry === "card" ? fit.forward.q : null }).se;
  return deltaBand({ F: fit.forward.F, se, K: r.strike, sigma: c.iv, T: fit.T, held: c.via === "own" ? "C" : "P", veto: false });
};
const setupOf = (p, r) => {
  const eng = p.engine;
  const { fit, asOfMs, row } = fitOf(p, r);
  if (!fit) return null;
  return NODE_Q.labSetup({ asOfMs, spot: p.spot, facts: eng.facts, state: eng.state, pLaw: eng.pLaw, event: eng.event, stale: eng.stale, crossesEarnings: r.crossesEarnings, books: [{ fit, rows: [row] }], lawCache: new Map() });
};
const engOf = (p, r, shares) => {
  const setup = setupOf(p, r);
  if (!setup) return null;
  const legs = shares ? [{ type: "S", side: 1, qty: 1 }, { type: "C", K: r.strike, side: -1, qty: 1 }] : [{ type: "C", K: r.strike, side: -1, qty: 1 }];
  return NODE_Q.priceStructure(setup, shares ? { family: "covered-call", expiry: r.expiry, legs, basis: "natural" } : { family: "custom", fam: SC_FAM, expiry: r.expiry, legs, basis: "natural" });
};

const PAYLOADS = () => ({
  SYX101: syxChain("SYX101", { spot: 100 }),
  SYX102: syxChain("SYX102", { spot: 52.4, start: 30, facts: [{ id: "carry.implied", v: 0.08, u: "frac", g: 3 }] }),
  SYX103: syxChain("SYX103", { spot: 410, start: 300, vol: 0.28, card: false }),
});

const TERMS = (o = {}) => ({ n: 100, cv: "delta", h: 0.3, f: 0.1, bp: null, ...o });
const expectedOf = (payloads, syms, t) => {
  const out = new Map();
  for (const sym of syms) {
    const p = payloads[sym];
    for (const r of p.rows) {
      const e = p.engine && p.engine.status === "ok" ? engOf(p, r, t.cv === "shares") : null;
      const leg = e && e.legs.find((l) => l.type !== "S");
      const band = e ? bandOracle(p, r) : null;
      const delta = leg && !(band && band.band === "dash") ? Math.abs(leg.delta) : null;
      const line = P.shortCallLine({ bid: r.bid, strike: r.strike }, { spot: p.spot, delta, days: r.days, contracts: t.n, convention: t.cv, haircut: t.h, floor: t.f, buyingPower: t.bp });
      out.set(sym + "|" + r.strike + "|" + r.expiry, { r, p, e, delta, line, band });
    }
  }
  return out;
};

const infoClick = (page, q) => page.evaluate((x) => document.querySelector(x).click(), q);
const key = (d) => d.t + "|" + d.strike + "|" + d.expiry;
const readRows = (page) => page.$$eval("#dkList .dk-row", (rs) => rs.map((r) => {
  const name = (c) => c.className.replace(/dk-c\s+/, "").split(" ")[0].replace(/^dk-/, "");
  const main = (c) => [...c.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const cs = [...r.querySelectorAll(".dk-c")];
  return {
    t: r.dataset.t, strike: r.dataset.strike, expiry: r.dataset.expiry, n: r.dataset.n, m1: r.dataset.m1, bind: r.dataset.bind, ratio: r.dataset.ratio, pc: r.dataset.pc, premiumC: r.dataset.premiumC, strategy: r.dataset.strategy, itm: r.classList.contains("is-itm"),
    cells: Object.fromEntries(cs.map((c) => [name(c), main(c)])),
    titles: Object.fromEntries(cs.map((c) => [name(c), c.getAttribute("title")])),
    subs: Object.fromEntries(cs.map((c) => [name(c), (c.querySelector(".dk-sub") || {}).textContent || null])),
  };
}));

const usdC = (c) => "$" + Math.round(c / 100).toLocaleString("en-US");
const ratioText = (v) => { const p = v * 100; return (p >= 10 ? p.toFixed(1) : p.toFixed(2)) + "%"; };
const annText = (v) => { const p = v * 100; return p > 99999 ? "> 99,999%" : Math.round(p).toLocaleString("en-US") + "%"; };

const ready = (page, n = 1) => page.waitForFunction((k) => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= k && !!document.querySelector("#dkScatter svg g"), n, { timeout: 20000 });
const queryOf = (t, extra = "") => {
  const q = new URLSearchParams({ t: "SYX101,SYX102", strategy: "sc" });
  if (t.n !== 100) q.set("n", String(t.n));
  if (t.cv !== "delta") q.set("cv", t.cv);
  if (t.h !== 0.3) q.set("h", String(+(t.h * 100).toFixed(2)));
  if (t.f !== 0.1) q.set("f", String(+(t.f * 100).toFixed(2)));
  if (t.bp !== null) q.set("bp", String(t.bp));
  return "?" + q.toString() + extra;
};

const parseCsv = (text) => {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\r") continue; else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

const errors = [];
const browser = await chromium.launch();
const payloads = PAYLOADS();
const SYMS = ["SYX101", "SYX102"];

try {
  {
    const page = await openDesk(browser, { payloads, query: "?t=SYX101,SYX102&strategy=cc", errors });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='cc']").length >= 48, null, { timeout: 20000 });
    const labels = await page.$$eval("#deskStrategy .ui-seg-i", (b) => b.map((x) => x.textContent.trim()));
    same(labels, ["Puts", "Calls", "Both", "Short calls"], "Sell has four items and the first three keep their names");
    const covered = await readRows(page);
    const askedBefore = page.asked.length;
    await page.locator("#deskStrategy .ui-seg-i", { hasText: "Short calls" }).click();
    await ready(page, 48);
    eq(page.asked.length, askedBefore + 2, "Calls to Short calls asks the server once per name for its own ranking");
    const scAsks = page.asked.slice(askedBefore);
    ok(scAsks.every((q) => q.get("strategy") === "sc" && !q.has("h") && !q.has("f")), "and each ask names the strategy, leaving the default collateral terms to the server");
    ok(page.url().includes("strategy=sc"), "the address says sc");
    const rows = await readRows(page);
    eq(rows.length, 48, "every call is a line");
    const want = expectedOf(payloads, SYMS, TERMS());
    let diff = 0;
    for (const r of rows) {
      const w = want.get(key(r));
      if (!w || !w.line.ok || Number(r.m1) !== w.line.m1C || r.bind !== w.line.binding || Number(r.n) !== w.line.n) diff++;
    }
    eq(diff, 0, "each row's collateral, binding and contracts equal the oracle priced on the naked engine reading");
    const coveredWin = new Map(covered.map((r) => [key(r), r.cells.pq]));
    ok(rows.some((r) => r.cells.pq !== coveredWin.get(key(r))), "Win % changes to the naked call's chance, not the buy-write's");
    await page.locator("#deskStrategy .ui-seg-i", { hasText: /^Calls$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='cc']").length >= 48, null, { timeout: 10000 });
    eq(page.asked.length, askedBefore + 4, "and back to Calls asks once per name again, for the covered-call ranking");
    ok(page.asked.slice(askedBefore + 2).every((q) => q.get("strategy") === "cc"), "with the covered-call strategy");
    ok(!(await page.$("#dkTerms:not([hidden])")), "the Terms pill hides outside Short calls");
    await page.close();
  }

  const scenarios = [
    ["defaults", TERMS()],
    ["haircut 20 floor 5", TERMS({ h: 0.2, f: 0.05 })],
    ["Reg-T style", TERMS({ cv: "regt" })],
    ["shares held", TERMS({ cv: "shares" })],
    ["one contract", TERMS({ n: 1 })],
    ["100,000 contracts", TERMS({ n: 100000 })],
    ["buying power 25,000", TERMS({ bp: 25000 })],
    ["buying power 400,000", TERMS({ bp: 400000 })],
    ["buying power 1,000", TERMS({ bp: 1000 })],
  ];
  const marks = new Map();
  for (const [label, t] of scenarios) {
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    const rows = await readRows(page);
    const want = expectedOf(payloads, SYMS, t);
    let bad = 0, shown = 0;
    for (const r of rows) {
      const w = want.get(key(r)), l = w.line;
      shown++;
      const dash = !!(w.band && w.band.band === "dash");
      if (!l.ok) {
        if (!(dash && t.cv === "delta" && r.cells.ratio === "—" && r.cells.nd === "—" && r.cells.pq === "—" && r.cells.ev === "—")) bad++;
        continue;
      }
      if (r.cells.ratio !== ratioTextExact(l.bidC, l.m1C) || r.pc !== r.cells.ratio || r.cells.ann !== annText(l.annRatio)) bad++;
      if (r.subs.ratio !== dollarsTextExact(l.bidC) + " ÷ " + dollarsTextExact(l.m1C, false)) bad++;
      if (r.premiumC !== String(l.bidC)) bad++;
      if (r.cells.collat !== usdC(l.collateralC)) bad++;
      if (r.cells.prem !== (l.n === 0 ? "$0" : usdC(l.premiumC))) bad++;
      const leg = w.e && w.e.legs.find((x) => x.type !== "S");
      const dl = leg ? Math.abs(leg.delta) : null;
      const nd = w.e && !dash ? (t.cv === "shares" ? 1 - dl : -dl) : null;
      const ndText = nd === null ? "—" : (nd < 0 ? "−" : "+") + Math.abs(nd).toFixed(2);
      const pm = !!(w.band && w.band.band === "pm");
      if (r.cells.nd !== ndText + (pm && nd !== null ? " ± " + w.band.half.toFixed(2) : "")) bad++;
      const pq = w.e && !dash ? Math.round(w.e.prob.popQ * 100) + "%" : "—";
      if (pm ? !(r.cells.pq.startsWith(pq + " ± ") && /^\d+%$/.test(r.cells.pq.slice(pq.length + 3))) : r.cells.pq !== pq) bad++;
      if (w.e && w.e.ev.p !== null && l.n > 0) {
        const ev = w.e.ev.p * l.n;
        const txt = (ev < 0 ? "−" : ev > 0 ? "+" : "") + "$" + Math.abs(Math.round(ev)).toLocaleString("en-US");
        if (r.cells.ev !== txt) bad++;
      }
      if (Math.abs(Number(r.ratio) - l.ratio) > 1e-6) bad++;
    }
    eq(bad, 0, `${label}: all ${shown} rows show the oracle's premium, collateral, ratio, annualised ratio, net delta, win and EV`);
    const pts = await page.$$eval("#dkScatter svg g > [data-bind]", (ns) => ns.map((n) => (n.tagName === "circle" ? [n.getAttribute("cx"), n.getAttribute("cy")] : [n.getAttribute("x"), n.getAttribute("y")]).map(Number)));
    marks.set(label, pts);
    if (t.bp === null) {
      const pill = await page.$eval("#dkTerms", (n) => n.textContent.trim());
      const summary = t.cv === "delta" ? `Delta ${+(t.h * 100).toFixed(2)}% / floor ${+(t.f * 100).toFixed(2)}%` : t.cv === "regt" ? "Reg-T style" : "Shares held";
      eq(pill, `${t.n.toLocaleString("en-US")} × · ${summary}`, `${label}: the Terms pill prints the live assumption`);
    }
    await page.close();
  }
  same(marks.get("one contract"), marks.get("defaults"), "contracts move dollars, never a point on the frontier (1 against 100)");
  same(marks.get("100,000 contracts"), marks.get("defaults"), "nor 100,000");
  same(marks.get("buying power 25,000"), marks.get("defaults"), "nor buying power");
  ok(JSON.stringify(marks.get("Reg-T style")) !== JSON.stringify(marks.get("defaults")), "but the convention does");

  {
    const t = TERMS({ bp: 400000 });
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    const want = expectedOf(payloads, SYMS, t);
    const lines = [...want.values()].filter((w) => w.line.ok);
    const plan = await page.$eval("#deskPlan", (n) => n.dataset.plan);
    const { best, affordable } = P.planShortCalls(lines.map((w) => w.line));
    const bw = lines.find((w) => w.line === best);
    ok(plan.includes(`${best.n}× ${bw.r.ticker} ${bw.r.strike.toFixed(2)} call expiring ${bw.r.expiry} earns ${usdC(best.timeValueC)} of time value`), `the plan names the line that earns the most time value (${plan.slice(0, 120)})`);
    ok(plan.includes(`${affordable} of ${lines.length} lines affordable`) && plan.includes("counts at most 100 contracts"), "with its affordable count and the ask as a ceiling");
    ok(/Delta 30% of notional, floor 10%/.test(plan), "and the convention in its sentence");
    ok((await page.$eval("#dkP-frontier, #dkP-plan", (n) => n.textContent)).includes("Uncovered: loss has no cap."), "the uncovered chip is on the page");
    await page.close();
  }

  {
    const t = TERMS();
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    const want = expectedOf(payloads, SYMS, t);
    const rows = await readRows(page);
    const itm = rows.find((r) => r.itm && r.t === "SYX101");
    ok(itm, "an in-the-money strike is styled");
    const w = want.get(key(itm));
    ok(w.line.intrC > 0 && Math.abs(Number(itm.ratio) - w.line.tvC / w.line.m1C) < 1e-6 && Number(itm.ratio) < w.line.bidC / w.line.m1C, "its ratio counts time value, not the gross bid");
    const anns = rows.map((r) => [Number(r.t === "SYX101" ? 0 : 0), r]);
    void anns;
    const order = rows.map((r) => want.get(key(r)).line.annRatio);
    ok(order.every((v, i) => i === 0 || order[i - 1] >= v - 1e-12), "the default order is the annualised ratio, descending");
    const server = rows.map((r) => want.get(key(r)).r.annualized);
    ok(server.some((v, i) => i > 0 && server[i - 1] < v - 1e-12), "which is not the server's covered-call yield order");
    await showView(page, "lines");
    const ranks = await page.$$eval("#deskRank option", (o) => o.map((x) => x.value));
    same(ranks, ["annualized", "premiumRatio", "ratio", "premium", "cushionSigmas", "collectible", "edge"], "the rank menu lists the short-call keys, the gross premium over collateral among them");
    const labelsOf = await page.$$eval("#deskRank option", (o) => o.map((x) => x.textContent));
    ok(labelsOf.includes("Premium ÷ collateral, in-the-money value included") && labelsOf.includes("Time value ÷ collateral"), "the gross ratio and the time-value ratio are named apart");
    await page.selectOption("#deskRank", "ratio");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("rank") === "ratio");
    const byRatio = (await readRows(page)).map((r) => Number(r.ratio));
    ok(byRatio.every((v, i) => i === 0 || byRatio[i - 1] >= v - 1e-9), "ranking by time value over collateral sorts by that ratio");
    await page.selectOption("#deskRank", "premiumRatio");
    await page.waitForFunction(() => new URL(location.href).searchParams.get("rank") === "premiumRatio");
    const gross = (await readRows(page)).map((r) => { const l = want.get(key(r)).line; return l.bidC / l.m1C; });
    ok(gross.length === 48 && gross.every((v, i) => i === 0 || gross[i - 1] >= v - 1e-12), "ranking by Premium ÷ collateral sorts by the whole bid over the collateral, intrinsic value included");
    ok(gross.some((v, i) => i > 0 && Number(byRatio[i - 1]) !== 0 && v !== gross[i - 1]), "and the order is its own");
    await page.selectOption("#deskRank", "premium");
    await page.waitForTimeout(300);
    await page.locator("#deskStrategy .ui-seg-i", { hasText: /^Calls$/ }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("rank") === "annualized", null, { timeout: 5000 }).catch(() => {});
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads, query: queryOf(TERMS()), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    const geo = await page.evaluate(() => {
      const svg = document.querySelector("#dkScatter svg");
      const ys = [...svg.querySelectorAll("text")].filter((t) => /^[\d,]+%$/.test(t.textContent) && t.getAttribute("text-anchor") === "end").map((t) => [Number(t.textContent.replace(/[,%]/g, "")) / 100, Number(t.getAttribute("y")) - 4]);
      const xs = [...svg.querySelectorAll("text")].filter((t) => /^\.\d\d$/.test(t.textContent) && t.getAttribute("text-anchor") === "middle").map((t) => [Number(t.textContent), Number(t.getAttribute("x"))]);
      const pts = [...svg.querySelectorAll("g > [data-bind]")].map((n) => ({ bind: n.getAttribute("data-bind"), shape: n.tagName, pos: n.tagName === "circle" ? [Number(n.getAttribute("cx")), Number(n.getAttribute("cy"))] : n.tagName === "rect" ? [Number(n.getAttribute("x")) + Number(n.getAttribute("width")) / 2, Number(n.getAttribute("y")) + Number(n.getAttribute("height")) / 2] : null }));
      const rings = [...svg.querySelectorAll("g > circle:not([data-bind])")].map((n) => [Number(n.getAttribute("cx")), Number(n.getAttribute("cy"))]);
      const guide = svg.querySelector(".dk-floor");
      return { ys, xs, pts, rings, guide: guide ? Number(guide.getAttribute("x1")) : null };
    });
    ok(geo.ys.length >= 3 && geo.xs.length >= 3, "the axes carry labelled ticks");
    const [[y1, p1], [y2, p2]] = [geo.ys[1], geo.ys[geo.ys.length - 1]];
    const yPix = (v) => p1 + (Math.sqrt(v) - Math.sqrt(y1)) * (p2 - p1) / (Math.sqrt(y2) - Math.sqrt(y1));
    const [[x1, q1], [x2, q2]] = [geo.xs[0], geo.xs[geo.xs.length - 1]];
    const xPix = (v) => q1 + (v - x1) * (q2 - q1) / (x2 - x1);
    const want = expectedOf(payloads, SYMS, TERMS());
    const wantPts = [...want.values()].filter((w) => w.line.ok && w.e).map((w) => ({ x: w.delta, y: w.line.annRatio, bind: w.line.binding }));
    let misses = 0;
    const capped = geo.pts.filter((p) => p.shape === "path").length;
    for (const w of wantPts) {
      const px = xPix(w.x);
      const hit = geo.pts.some((p) => p.pos && Math.abs(p.pos[0] - px) < 1.2 && (Math.abs(p.pos[1] - yPix(w.y)) < 1.2 || w.y > y2 * 1.5));
      if (!hit) misses++;
    }
    ok(misses <= capped, `every point sits at the pixel its (|net delta|, annualised ratio) maps to, within 1 px (${misses} off, ${capped} pinned)`);
    const brute = wantPts.filter((p) => !wantPts.some((q) => q !== p && q.x <= p.x && q.y >= p.y && (q.x < p.x || q.y > p.y)));
    const uniq = new Set(brute.map((p) => p.x + "|" + p.y));
    eq(geo.rings.length, uniq.size, `the ringed efficient set equals the brute-force Pareto set (${uniq.size})`);
    ok(Math.abs(geo.guide - xPix(0.1 / 0.3)) < 1, `the floor guide sits at floor over haircut (${geo.guide} vs ${xPix(0.1 / 0.3).toFixed(1)})`);
    const floorN = geo.pts.filter((p) => p.bind === "floor").length;
    eq(geo.pts.filter((p) => p.shape === "rect").length >= floorN - 0, true, "the floor-bound lines are diamonds");
    ok(geo.pts.filter((p) => p.bind === "floor").every((p) => p.shape === "rect" || p.shape === "path"), "a diamond (or a pinned triangle) marks where the floor sets the collateral");
    ok(geo.pts.filter((p) => p.bind === "delta").every((p) => p.shape === "circle" || p.shape === "path"), "and a dot where delta does");
    const legend = flat(await page.$eval("#dkFrontierM .tl-legend", (n) => n.textContent));
    ok(/Delta sets collateral/.test(legend) && /Floor sets collateral/.test(legend) && /Frontier/.test(legend), "the legend names what each shape means");
    ok(/100 contracts · collateral: Delta 30% of notional, floor 10% · premium = the bid/.test(legend), "and the assumption line is always printed");
    await page.locator("#dkFrontierM .ui-seg-i", { hasText: "Win % (implied)" }).click();
    await page.waitForFunction(() => /implied chance of profit/.test(document.querySelector("#dkScatter svg").getAttribute("aria-label")));
    eq(await page.$$eval("#dkScatter svg .dk-floor", (n) => n.length), 0, "no floor guide on the Win axis");
    await page.close();
  }

  for (const cv of ["regt", "shares"]) {
    const page = await openDesk(browser, { payloads, query: queryOf(TERMS({ cv })), errors });
    await ready(page, 48);
    eq(await page.$$eval("#dkScatter svg .dk-floor", (n) => n.length), 0, `${cv}: no floor guide`);
    await page.close();
  }

  {
    const t = TERMS();
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    await showView(page, "lines");
    const want = expectedOf(payloads, SYMS, t);
    const rows = await readRows(page);
    const sample = rows.slice(0, 3).concat(rows.filter((r) => r.itm).slice(0, 1));
    for (const r of sample) {
      const w = want.get(key(r));
      await page.evaluate((q) => document.querySelector(q).click(), `#dkList .dk-row[data-t="${r.t}"][data-strike="${r.strike}"][data-expiry="${r.expiry}"] .ui-info`);
      await page.waitForSelector("#fxPop:popover-open");
      const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
      const text = flat(await page.locator("#fxPop").textContent());
      const m = /100 × ([\d.]+) × max\(30% × ([\d.]+), 10%\)/.exec(facts.Collateral || "");
      ok(m, `the collateral fact prints its formula (${(facts.Collateral || "").slice(0, 90)})`);
      const again = P.shortCallCollateral({ convention: "delta", spot: Number(m[1]), strike: Number(r.strike), delta: Number(m[2]), haircut: 0.3, floor: 0.1 });
      ok(Math.abs(again.m1C - w.line.m1C) <= 1 && facts.Collateral.includes(`$${(w.line.m1C / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} each`), "recomputing the printed formula gives the printed collateral");
      ok(facts["Premium ÷ collateral"].startsWith(ratioTextExact(w.line.bidC, w.line.m1C) + " = " + dollarsTextExact(w.line.bidC) + " ÷ " + dollarsTextExact(w.line.m1C)) && /intrinsic value included/.test(facts["Premium ÷ collateral"]), `the Premium ÷ collateral fact prints the ratio and both dollar amounts of one contract (${facts["Premium ÷ collateral"].slice(0, 90)})`);
      ok(/time value only/.test(facts["Time value ÷ collateral"]) && /annualised over/.test(facts["Time value ÷ collateral"]), "and the time-value ratio keeps its own fact");
      ok(/sold into the/.test(facts.Premium) && /not used for any figure/.test(facts.Premium), "the premium fact says it is the bid and the mid is unused");
      ok(/Reg-T style/.test(Object.keys(facts).join()) && /strategy lab adds the option's value/.test(facts["Reg-T style"]), "the Reg-T comparator is always shown, with the lab's difference named");
      ok(/Assignment/.test(Object.keys(facts).join()) && /short stock/.test(facts.Assignment), "assignment is spelled out");
      ok(!/\bAI\b/.test(text), "no bare AI word");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
    }
    await page.close();
  }

  {
    const t = TERMS();
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    await showView(page, "lines");
    const want = expectedOf(payloads, SYMS, t);
    let flagged = 0, expectedFlags = 0, wrong = 0;
    for (const w of want.values()) {
      if (w.p.ticker !== "SYX102" || !w.e) continue;
      const D = P.dividendsToExpiry({ spot: w.p.spot, r: w.e.carry.r, q: w.e.carry.q, years: w.e.T });
      const watch = D > 0 && w.line.tvC / 10000 < D;
      if (!watch) continue;
      expectedFlags++;
      await page.evaluate((q) => document.querySelector(q).click(), `#dkList .dk-row[data-t="SYX102"][data-strike="${w.r.strike}"][data-expiry="${w.r.expiry}"] .ui-info`);
      await page.waitForSelector("#fxPop:popover-open");
      const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
      if (/early assignment is a live possibility/.test(facts["Early exercise"])) flagged++; else wrong++;
      await page.keyboard.press("Escape");
      await page.waitForSelector("#fxPop:not(:popover-open)", { state: "attached" });
      if (expectedFlags >= 4) break;
    }
    ok(expectedFlags > 0, "the dividend fixture has lines whose time value is under the dividends to expiry");
    eq(wrong, 0, `each of them says early assignment is live (${flagged} of ${expectedFlags})`);
    const quiet = [...want.values()].find((w) => w.p.ticker === "SYX101");
    await page.evaluate((q) => document.querySelector(q).click(), `#dkList .dk-row[data-t="SYX101"][data-strike="${quiet.r.strike}"][data-expiry="${quiet.r.expiry}"] .ui-info`);
    await page.waitForSelector("#fxPop:popover-open");
    const facts = await page.$$eval("#fxPop dt", (dts) => Object.fromEntries(dts.map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
    ok(!/live possibility/.test(facts["Early exercise"]), "a name with no dividend carries no such flag");
    await page.close();
  }

  {
    const page = await openDesk(browser, { payloads: { SYX103: payloads.SYX103 }, query: "?t=SYX103&strategy=sc", errors });
    await ready(page, 1);
    const rows = await readRows(page);
    ok(rows.length > 0 && rows.every((r) => r.cells.ev === "—" || r.cells.ev === ""), "a name with no card has no real-world EV, shown as a dash");
    ok(rows.every((r) => r.titles.ev && r.titles.ev.length > 10), "and the dash carries its reason");
    await page.close();
  }

  {
    const noQ = () => { Object.defineProperty(window, "FlowsQuant", { get() { return undefined; }, set() {}, configurable: true }); };
    const page = await openDesk(browser, { payloads, query: queryOf(TERMS()), errors, init: noQ });
    await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 48 || document.querySelector("#dkList .ui-silent"), null, { timeout: 15000 });
    await page.waitForFunction(() => /No delta could be read/.test(document.querySelector("#dkFrontierM").textContent), null, { timeout: 15000 }).catch(() => {});
    const text = flat(await page.locator("#dkFrontierM").textContent());
    ok(/No delta could be read for these lines, so delta-adjusted collateral is withheld; the Reg-T style needs no delta/.test(text), "with the engine bundle missing, one banner says delta-adjusted collateral is withheld");
    await page.close();
    const page2 = await openDesk(browser, { payloads, query: queryOf(TERMS({ cv: "regt" })), errors, init: noQ });
    await page2.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='sc']").length >= 48, null, { timeout: 15000 });
    const rows = await readRows(page2);
    ok(rows.every((r) => r.m1 !== null && r.cells.ratio.endsWith("%") && r.cells.nd === "—"), "the Reg-T style still computes collateral and ratio with no engine, and the delta stays a dash");
    await page2.close();
  }

  {
    const page = await openDesk(browser, { payloads, query: "?t=SYX101,SYX102&strategy=sc&n=250&cv=regt&h=25&f=5", errors });
    await ready(page, 48);
    eq(await page.$eval("#dkTerms", (n) => n.textContent.trim()), "250 × · Reg-T style", "the URL carries the terms and the pill reads them");
    await page.locator("#dkTerms").click();
    await page.waitForSelector("#dkScDialog[open]");
    eq(await page.$eval("#dkScN", (n) => n.value), "250", "the dialog shows contracts");
    eq(await page.$eval("#dkScCv-regt", (n) => n.checked), true, "and the convention");
    eq(await page.$eval("#dkScH", (n) => n.disabled), true, "the haircut is disabled outside delta");
    const modalFocus = await page.evaluate(() => document.querySelector("#dkScDialog").contains(document.activeElement));
    ok(modalFocus, "focus is inside the modal");
    await page.locator("#dkScCv-delta").check();
    await page.waitForFunction(() => /Delta 25% \/ floor 5%/.test(document.querySelector("#dkTerms").textContent));
    ok(true, "the pill follows the dialog at once, never stale");
    await page.fill("#dkScN", "");
    for (const bad of ["0", "1e2", "2.5", "1,00"]) {
      await page.fill("#dkScN", bad);
      eq(await page.$eval("#dkScN", (n) => n.getAttribute("aria-invalid")), "true", `${JSON.stringify(bad)} is flagged invalid`);
      eq(flat(await page.locator("#dkScNErr").textContent()), "Contracts must be a whole number from 1 to 100,000.", "with the sentence");
      ok(/^250 ×/.test(await page.$eval("#dkTerms", (n) => n.textContent)), "and the last valid terms keep driving the page");
      ok(new URL(page.url()).searchParams.get("n") === "250", "and the address");
    }
    await page.fill("#dkScN", "2k");
    await page.waitForFunction(() => /^2,000 ×/.test(document.querySelector("#dkTerms").textContent));
    await page.fill("#dkScH", "4");
    eq(await page.$eval("#dkScH", (n) => n.getAttribute("aria-invalid")), "true", "a haircut under 5% is refused");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#dkScDialog").open);
    eq(await page.evaluate(() => document.activeElement.id), "dkTerms", "Escape closes the dialog and focus returns to the pill");
    await page.locator("#dkTerms").click();
    await page.locator("#dkScReset").click();
    await page.waitForFunction(() => /^100 × · Delta 30% \/ floor 10%/.test(document.querySelector("#dkTerms").textContent));
    const sp = new URL(page.url()).searchParams;
    ok(!sp.has("n") && !sp.has("cv") && !sp.has("h") && !sp.has("f"), "Reset leaves the address with none of n, cv, h, f: defaults are never written");
    await page.close();
  }

  {
    const t = TERMS();
    const page = await openDesk(browser, { payloads, query: queryOf(t), errors, viewport: { width: 1440, height: 900 } });
    await ready(page, 48);
    await showView(page, "lines");
    await page.locator(".ui-exp > summary").click();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".ui-exp-i", { hasText: /^CSV$/ }).click()]);
    const grid = parseCsv(fs.readFileSync(await dl.path(), "utf8").slice(1));
    same(grid[0], ["Ticker", "Structure", "Expiry", "Chain session", "Days to expiry", "Strike (USD)", "Contracts used (contracts)", "Collateral per contract (USD)", "Collateral on contracts used (USD)", "Collateral convention", "Haircut (fraction)", "Floor (fraction)", "Premium ÷ collateral (fraction)", "Time value ÷ collateral (fraction)", "Annualised time value ÷ collateral (fraction)", "Net delta (delta)", "Net delta band (delta)", "Win probability (implied) (fraction)", "Win probability (real-world) (fraction)", "Expected value (real-world) on contracts used (USD)", "Reg-T style collateral per contract (USD)"], "the export has exactly the stated columns and units");
    ok(!grid[0].some((c) => /^(bid|ask|spot)\b|quoted|^Premium \(/i.test(c)) && !grid[0].some((c) => /premium \(usd\)/i.test(c)), "no bid, ask, premium or spot column: the feed's quoted figures are not exported");
    const body = grid.slice(1, -2);
    ok(body.length === 48 && body.every((r) => r[1] === "short call, uncovered" && r[9] === "Delta-adjusted"), "every line is a row, named as uncovered, with its convention");
    ok(body.every((r) => r.every((c) => !/−/.test(c))), "no U+2212 in a CSV number");
    ok(body.every((r) => /^-?[\d.]+$/.test(r[15]) || r[15] === ""), "net delta is a plain signed number or empty");
    ok(body.some((r) => Number(r[15]) < 0), "naked net delta is negative");
    ok(body.every((r) => r[16] === "" || (/^[\d.]+$/.test(r[16]) && Number(r[16]) > 0 && r[15] !== "")), "the delta band is empty or a positive half-width beside a delta");
    ok(body.some((r) => r[16] !== ""), "and some line carries one");
    const wantCsv = expectedOf(payloads, SYMS, t);
    let csvBad = 0;
    for (const r of body) {
      const w = [...wantCsv.values()].find((x) => x.p.ticker === r[0] && x.r.expiry === r[2] && x.r.strike === Number(r[5]));
      const exact = w && w.line.ok ? ratioMicroExact(w.line.bidC, w.line.m1C) : null;
      if (!w || String(exact) !== r[12]) csvBad++;
    }
    eq(csvBad, 0, "the Premium ÷ collateral column is the whole bid over the collateral, half-up to six decimals from integer cents, on every line");
    await page.close();
  }

  {
    const stat = [];
    const page = await openDesk(browser, {
      payloads, query: queryOf(TERMS()), errors,
      before: async (p) => { await p.route("**/assets/js/flows-desk-calls.js*", (r) => r.fulfill({ status: 404, body: "" })); },
    });
    await page.waitForSelector("#dkScLoad .ui-defer", { timeout: 15000 });
    const msg = flat(await page.locator("#dkScLoad .ui-defer").textContent());
    ok(/short-call view is unavailable/.test(msg) && /Retry/.test(msg), `a 404 for the chunk shows the slot message and Retry (${msg})`);
    await page.evaluate(() => document.querySelector("#dkList .ui-silent button").click());
    await page.waitForSelector("#fxPop:popover-open");
    ok(/Loading the short-call view/.test(flat(await page.locator("#fxPop").textContent())), "the lines say what is loading rather than showing the covered figures");
    await page.keyboard.press("Escape");
    stat.push(msg);
    await page.unroute("**/assets/js/flows-desk-calls.js*");
    await page.locator("#dkScLoad .ui-defer button").click();
    await ready(page, 48);
    ok(true, "and Retry recovers the view");
    await page.close();
    const saver = await openDesk(browser, { payloads, query: queryOf(TERMS()), errors, init: () => { Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }); } });
    await saver.waitForSelector("#dkScLoad .ui-defer", { timeout: 15000 });
    ok(/Data Saver is on/.test(flat(await saver.locator("#dkScLoad .ui-defer").textContent())), "Data Saver asks before loading");
    await saver.locator("#dkScLoad .ui-defer button").click();
    await ready(saver, 48);
    ok(true, "and pressing it loads the view");
    await saver.close();
    const plain = await openDesk(browser, { payloads, query: "?t=SYX101&strategy=csp", errors });
    await plain.waitForSelector("#dkList .dk-row", { state: "attached" });
    eq(await plain.$$eval("script[src*='flows-desk-calls']", (n) => n.length), 0, "the chunk is never fetched on Puts");
    eq(await plain.evaluate(() => performance.getEntriesByType("resource").filter((e) => /flows-desk-calls/.test(e.name)).length), 0, "no request for it either");
    await plain.close();
  }

  for (const width of [320, 390, 1024, 1440]) {
    const page = await openDesk(browser, { payloads, query: queryOf(TERMS({ bp: 25000 })), errors, viewport: { width, height: 800 } });
    await ready(page, 48);
    for (const view of ["frontier", "lines"]) {
      await showView(page, view);
      const m = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, w: innerWidth, y: document.documentElement.scrollHeight, h: innerHeight }));
      ok(m.x <= m.w + 1 && m.y <= m.h + 1, `${width}px ${view}: no sideways scroll and no page scroll (${m.x}x${m.y} in ${m.w}x${m.h})`);
    }
    await page.close();
  }

  {
    const src = fs.readFileSync(new URL("assets/js/flows-desk-calls.js", REPO), "utf8");
    ok(!/\bAI\b/.test(src) && !/\bEastern\b|\bET\b|\bUTC\b/.test(src), "the chunk names no model binding and no zone");
    const banned = /\bat (the )?(ask|bid)\b/i;
    const pages = await import("../shared/flows-pages.js");
    const html = pages.deskPage({ username: "t" });
    const scCopy = [...html.matchAll(/<p data-k="(sc-[^"]+|t-ratio|t-collat)">([\s\S]*?)<\/p>/g)].map((m) => m[2]);
    ok(scCopy.length >= 20, `the page carries ${scCopy.length} short-call copy keys`);
    ok(scCopy.every((s) => !banned.test(s) && !/\bAI\b/.test(s)), "none says at the ask or at the bid, and none names a model");
    ok(!banned.test(src), "nor does the chunk");
  }

  {
    const cutOf = (o) => ({ nRaw: 6000, nIn: 4210, nOut: 48, k: 25, truncated: false, shed: [], ...o });
    const served = {
      ...payloads,
      SYX101: { ...payloads.SYX101, cut: cutOf({}) },
      SYX102: { ...payloads.SYX102, cut: cutOf({ nRaw: 960, nIn: 700, truncated: true }) },
    };
    const statusOf = (page) => page.$eval("#deskStatus", (n) => ({ hidden: n.classList.contains("visually-hidden"), text: n.textContent.replace(/\s+/g, " ").trim(), height: n.getBoundingClientRect().height }));
    {
      const page = await openDesk(browser, { payloads: served, query: "?t=SYX101,SYX102&strategy=sc", errors });
      await ready(page, 48);
      const st = await statusOf(page);
      ok(!st.hidden && st.height > 0, "the note on how the list was cut is on the page, not only in the screen-reader footnote");
      ok(st.text.includes("Ranked from 4,210 eligible calls; 48 sent.") && !st.text.includes("Top 25 exact"), `a ranked chain says how many eligible calls were read and how many were sent, in one short line (${st.text.slice(0, 160)})`);
      ok(st.text.includes("SYX102: Partial chain: first 960 contracts read (page limit); ranking covers these only and is not exact."), "a chain cut by the page ceiling says the ranking is not exact");
      const foot = await page.$eval("#deskFoot", (n) => n.textContent.replace(/\s+/g, " "));
      ok(foot.includes("SYX101: Ranked from 4,210 eligible calls; 48 sent. Top 25 exact for annualised time value over collateral; other orders rank sent rows only.") && foot.includes("SYX102: Partial chain: first 960 contracts read"), "the full sentences stay in the footnote and the Lines information");
      await showView(page, "lines");
      await infoClick(page, '#dkLinesM [aria-label="About lines"]');
      await page.waitForSelector("#fxPop:popover-open");
      ok(flat(await page.locator("#fxPop").textContent()).includes("Ranked from 4,210 eligible calls; 48 sent. Top 25 exact for annualised time value over collateral; other orders rank sent rows only."), "the Lines information carries the whole sentence, with what is exact and what is not");
      await page.keyboard.press("Escape");
      await page.locator("#deskStrategy .ui-seg-i", { hasText: /^Calls$/ }).click();
      await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='cc']").length >= 48, null, { timeout: 10000 });
      ok(!/Ranked from|Partial chain/.test((await statusOf(page)).text), "outside Short calls there is no cut note");
      await page.close();
    }
    {
      const one = { ...payloads, SYX101: { ...payloads.SYX101, cut: cutOf({ nRaw: 7, truncated: true, shed: [{ why: "budget" }] }) } };
      const page = await openDesk(browser, { payloads: one, query: "?t=SYX101&strategy=sc", errors });
      await ready(page, 24);
      const st = await statusOf(page);
      ok(st.text.includes("Partial chain: the site's market-data budget ran out after 7 contracts; ranking covers these only and is not exact."), `a chain the feed budget cut short says so and names the contracts read (${st.text.slice(0, 160)})`);
      ok(!/SYX101: /.test(st.text.replace(/^\d+ symbols? priced.*?(?=Partial)/, "")), "one name carries no symbol prefix");
      await page.close();
    }
    const CORE_RAW = fs.readFileSync(new URL("assets/js/flows-desk.js", REPO), "utf8");
    const planted = CORE_RAW.replace("staleQuotes, ...cuts, earnBits.join", "staleQuotes, earnBits.join");
    ok(planted !== CORE_RAW, "the planted build removes the cut lines from the status");
    const bad = await openDesk(browser, { payloads: served, query: "?t=SYX101,SYX102&strategy=sc", errors: [], before: async (p) => { await p.route(/\/assets\/js\/flows-desk\.js(\?.*)?$/, (r) => r.fulfill({ contentType: "text/javascript", body: planted })); } });
    await ready(bad, 48);
    ok(!/Ranked from/.test((await statusOf(bad)).text), "PLANTED WRONG BUILD IS CAUGHT (cut note): without the line the status does not carry it, and the probe above fails");
    await bad.close();
  }

  {
    const CALLS = "assets/js/flows-desk-calls.js", CORE = "assets/js/flows-desk.js";
    const MUTS = [
      ["sort by the server's annualised yield", CALLS, [["annualized: (r) => (r.__sc ? r.__sc.annRatio : null),", "annualized: (r) => r.annualized,"]], "order"],
      ["floor guide at f times h", CALLS, [["const guide = terms.f / terms.h;", "const guide = terms.f * terms.h;"]], "geometry"],
      ["binding marker inverted", CALLS, [["const flo = p.r.__sc.binding === \"floor\";", "const flo = p.r.__sc.binding !== \"floor\";"]], "geometry"],
      ["signed net delta plotted", CALLS, [["Math.abs(sc.netDelta)", "sc.netDelta"]], "geometry"],
      ["collateral shown on one contract", CALLS, [["cellOf(\"dk-collat\", \"Collateral\", usdC(sc.collateralC)", "cellOf(\"dk-collat\", \"Collateral\", usdC(sc.m1C)"]], "rows"],
      ["export carries the premium", CALLS, [["{ label: \"Contracts used\", unit: \"contracts\"", "{ label: \"Premium\", unit: \"USD\", get: (r) => r.premium },\n    { label: \"Contracts used\", unit: \"contracts\""]], "export"],
      ["Short calls asks for the covered-call ranking", CORE, [["both: \"both\", sc: \"sc\" };", "both: \"both\", sc: \"cc\" };"]], "reuse"],
      ["shares convention keeps the naked pricing", CALLS, [["function engFor(r) {\n    if (terms.cv === \"shares\") {", "function engFor(r) {\n    if (false) {"]], "shares"],
    ];
    const serve = (rel, edits) => {
      let text = fs.readFileSync(new URL(rel, REPO), "utf8");
      for (const [a, b] of edits) { assert.equal(text.split(a).length - 1, 1, "mutant applies once: " + a.slice(0, 40)); text = text.replace(a, () => b); }
      return async (p) => { await p.route(new RegExp("/" + rel.replace(/[.]/g, "\\.") + "(\\?.*)?$"), (r) => r.fulfill({ contentType: "text/javascript", body: text })); };
    };
    const probe = async (kind, before) => {
      const bad = [];
      if (kind === "reuse") {
        const page = await openDesk(browser, { payloads, query: "?t=SYX101,SYX102&strategy=cc", errors: [], before });
        await page.waitForFunction(() => document.querySelectorAll("#dkList .dk-row[data-strategy='cc']").length >= 48, null, { timeout: 20000 });
        const n = page.asked.length;
        await page.locator("#deskStrategy .ui-seg-i", { hasText: "Short calls" }).click();
        await ready(page, 48);
        if (page.asked.length !== n + 2 || !page.asked.slice(n).every((q) => q.get("strategy") === "sc")) bad.push("no sc request");
        await page.close();
        return bad;
      }
      const t = TERMS(kind === "shares" ? { cv: "shares" } : {});
      const page = await openDesk(browser, { payloads, query: queryOf(t), errors: [], before, viewport: { width: 1440, height: 900 } });
      await ready(page, 48);
      const want = expectedOf(payloads, SYMS, t);
      const rows = await readRows(page);
      if (kind === "rows" || kind === "shares") {
        for (const r of rows) {
          const w = want.get(key(r)), l = w.line;
          if (r.cells.collat !== usdC(l.collateralC)) bad.push("collateral " + key(r));
          const pq = w.e && !(w.band && w.band.band === "dash") ? Math.round(w.e.prob.popQ * 100) + "%" : "—";
          const have = r.cells.pq.replace(/ ± \d+%$/, "");
          if (have !== pq) bad.push("win " + key(r));
        }
      }
      if (kind === "order") {
        const order = rows.map((r) => want.get(key(r)).line.annRatio);
        if (!order.every((v, i) => i === 0 || order[i - 1] >= v - 1e-12)) bad.push("order");
      }
      if (kind === "geometry") {
        const g = await page.evaluate(() => {
          const svg = document.querySelector("#dkScatter svg");
          const xs = [...svg.querySelectorAll("text")].filter((n) => /^\.\d\d$/.test(n.textContent) && n.getAttribute("text-anchor") === "middle").map((n) => [Number(n.textContent), Number(n.getAttribute("x"))]);
          const guide = svg.querySelector(".dk-floor");
          const pts = [...svg.querySelectorAll("g > [data-bind]")].map((n) => ({ bind: n.getAttribute("data-bind"), shape: n.tagName }));
          const minX = Math.min(...[...svg.querySelectorAll("g > [data-bind]")].map((n) => Number(n.getAttribute("cx") || n.getAttribute("x") || 0)));
          return { xs, guide: guide ? Number(guide.getAttribute("x1")) : null, pts, minX };
        });
        const [[x1, q1], [x2, q2]] = [g.xs[0], g.xs[g.xs.length - 1]];
        const xPix = (v) => q1 + (v - x1) * (q2 - q1) / (x2 - x1);
        if (g.guide === null || Math.abs(g.guide - xPix(0.1 / 0.3)) > 1) bad.push("guide");
        if (g.pts.some((p) => (p.bind === "floor") !== (p.shape === "rect" || p.shape === "path"))) bad.push("marker shape");
        if (g.minX < xPix(0) - 1) bad.push("signed delta drawn left of zero");
        if (g.xs.length && xPix(x1) > 0 && Math.abs(xPix(x1) - q1) > 1) bad.push("axis");
      }
      if (kind === "export") {
        await showView(page, "lines");
        await page.locator(".ui-exp > summary").click();
        const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(".ui-exp-i", { hasText: /^CSV$/ }).click()]);
        const head = parseCsv(fs.readFileSync(await dl.path(), "utf8").slice(1))[0];
        if (head.some((c) => /^Premium \(/.test(c))) bad.push("premium column exported");
      }
      await page.close();
      return bad;
    };
    for (const kind of ["rows", "order", "geometry", "export", "reuse", "shares"]) {
      const good = await probe(kind, null);
      same(good, [], `the unmutated build passes the ${kind} probe`);
    }
    for (const [name, rel, edits, kind] of MUTS) {
      const bad = await probe(kind, serve(rel, edits));
      ok(bad.length > 0, `PLANTED WRONG BUILD IS CAUGHT (${kind}): ${name}`);
    }
  }

  eq(errors.length, 0, `no uncaught page error across the whole session (${errors[0] || ""})`);
} finally {
  await browser.close();
}

console.log(`✓ flows-desk-calls-render: ${checks} assertions — Short calls asking the server for its own ranking, every row's premium, collateral, ratio, annualised ratio, net delta, win and EV against the oracle under nine sets of terms, points that never move with contracts or buying power, the frontier at its independently mapped pixels with its Pareto set and floor guide, the formulas in the information popovers recomputed, the early-assignment flag, the missing-engine and no-card paths, the Terms dialog and its URL round trip, the export with no quoted figure, the chunk's failure and Data Saver paths, and no sideways scroll`);
