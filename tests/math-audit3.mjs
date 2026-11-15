import assert from "node:assert/strict";
import { bootUI, bootModules } from "./lib/ui-boot.mjs";
import { pagePick, pageSource } from "./lib/page-slice.mjs";
import { loadMutated } from "./truth/mutants.mjs";
import * as CAL from "../shared/flows-calendar.js";
import { NODE_Q, engineBlock } from "./desk-fixtures.mjs";
import { world } from "./lib/macro-world.mjs";

let checks = 0;
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const UI = bootUI();
const { F, DASH } = UI;
const isNum = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MINUS = "−";

const group = (n) => n.replace(/\B(?=(\d{3})+$)/g, ",");
function halfUpInt(num, den) {
  const N = BigInt(num), D = BigInt(den);
  const q = N / D, r = N % D;
  return 2n * r >= D ? q + 1n : q;
}
function fixed(units, dp) {
  const s = units.toString().padStart(dp + 1, "0");
  return dp ? s.slice(0, s.length - dp) + "." + s.slice(s.length - dp) : s;
}
function decimal(str) {
  const neg = str.startsWith("-");
  const [i, f = ""] = (neg ? str.slice(1) : str).split(".");
  return { neg, n: BigInt(i + f), scale: f.length };
}
function roundDecimal(str, dp, shift = 0) {
  const { neg, n, scale } = decimal(str);
  const num = n * 10n ** BigInt(dp + shift), den = 10n ** BigInt(scale);
  return { neg, units: halfUpInt(num, den), dp };
}

const h = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, kids: kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false) });
const textOf = (n) => (n === null || n === undefined ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : (n.kids || []).map(textOf).join(""));
const glyph = () => h("svg", null);

function sessionsAfter(from, to) {
  let n = 0;
  for (let t = Date.parse(from + "T00:00:00Z") + 864e5; t <= Date.parse(to + "T00:00:00Z"); t += 864e5) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (CAL.isSession(d)) n++;
  }
  return n;
}
function nextSessionAfter(d) {
  for (let t = Date.parse(d + "T00:00:00Z") + 864e5; ; t += 864e5) {
    const x = new Date(t).toISOString().slice(0, 10);
    if (CAL.isSession(x)) return x;
  }
}
function impactOf(d, time) {
  const on = CAL.isSession(d) ? d : nextSessionAfter(d);
  const after = nextSessionAfter(d);
  if (time === "premarket") return { early: on, late: on };
  if (time === "postmarket") return { early: after, late: after };
  return { early: on, late: CAL.isSession(d) ? after : on };
}
function weekEnd(origin) {
  let last = origin;
  for (let t = Date.parse(origin + "T00:00:00Z"); ; t += 864e5) {
    const x = new Date(t).toISOString().slice(0, 10);
    if (CAL.isSession(x)) last = x;
    if (new Date(t).getUTCDay() === 0) return last;
  }
}
const sessionsOf2026 = CAL.SESSION_DAYS.filter((d) => d >= "2026-01-02" && d <= "2026-11-30");

function home(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const FOCUS = { asOf: null, ahead: null, origin: null };
  const MK = { today: null };
  const ov = pagePick("assets/js/flows-overview.js", ["dayOk", "passed", "calendarPassed", "reportAhead", "sessionsSaid", "daysSaid", "earningsMark", "pair"],
    { F, DASH, isNum, h, glyph, FOCUS, UI: { freshness: { market: () => ({ today: MK.today }) } } }, p.overview || []);
  const below = pagePick("assets/js/flows-overview-below.js", ["moveSaid"], { F, DASH, isNum }, p.below || []);

  for (let k = 1; k <= 3000; k++) {
    const u = halfUpInt(k, 10); const want = u === 0n ? "±<0.1%" : "±" + fixed(u, 1) + "%";
    const got = below.moveSaid(Number((k / 10000).toFixed(4)));
    if (got !== want) { say(`priced move ${k / 10000}: ${got} against ${want}`); break; }
  }
  outer: for (let a = 0; a <= 300; a++) for (let b = 0; a + b <= 300; b++) {
    if (a + b === 0) continue;
    const u = halfUpInt(100 * a, a + b); const want = u === 0n && a > 0 ? "<1%" : fixed(u, 0) + "%";
    const got = textOf(ov.pair(a, b, "w")[1]);
    if (got !== want) { say(`chip share ${a}/${b}: ${got} against ${want}`); break outer; }
  }
  let seen = 0;
  for (const S of sessionsOf2026) {
    const origin = CAL.nextSession(S);
    FOCUS.asOf = S; FOCUS.ahead = CAL.ahead(S); FOCUS.origin = origin;
    const last = FOCUS.ahead[FOCUS.ahead.length - 1];
    for (let t = Date.parse(S + "T00:00:00Z"); t <= Date.parse(last + "T00:00:00Z"); t += 864e5) {
      const today = new Date(t).toISOString().slice(0, 10);
      for (let j = 0; j <= 25; j += 3) {
        const report = CAL.addSessions(origin, j);
        const sdte = sessionsAfter(origin, report);
        const want = today <= report ? sessionsAfter(today, report) : -sessionsAfter(report, today);
        const got = ov.reportAhead(sdte, origin, today);
        seen++;
        if (got !== want) { say(`report ${report} from ${today} (nightly ${S}): ${got} sessions against ${want}`); break; }
      }
    }
  }
  if (seen < 10000) say(`only ${seen} report counts were checked`);
  FOCUS.asOf = "2026-08-24"; FOCUS.ahead = CAL.ahead("2026-08-24"); FOCUS.origin = "2026-08-25"; MK.today = "2026-08-24";
  const tag = ov.earningsMark({ edte: 43, ed: "2026-10-07" }, { sdte: 20, d: "2026-09-23" });
  if (!tag || textOf(tag) !== "21s") say(`the board tag of a report on Sep 23 read on Aug 24 is ${tag ? textOf(tag) : "absent"}, not 21s`);
  const days = ov.earningsMark({ edte: 43, ed: "2026-10-07" }, null);
  if (!days || textOf(days) !== "44d") say(`the calendar-day tag of a report on Oct 7 read on Aug 24 is ${days ? textOf(days) : "absent"}, not 44d`);
  FOCUS.asOf = "2026-09-03"; FOCUS.ahead = CAL.ahead("2026-09-03"); FOCUS.origin = "2026-09-04"; MK.today = "2026-09-08";
  if (ov.reportAhead(2, "2026-09-04", "2026-09-08") !== 1) say("over Labor Day a report on Sep 9 read on Sep 8 is not the next session");
  MK.today = "2026-09-15";
  if (ov.reportAhead(5, "2026-09-04", "2026-09-15", "2026-09-17") !== null) say("a reader's day past the session list is placed by a guess instead of a dash");
  if (ov.reportAhead(5, "2026-09-04", "2026-09-15", "2026-09-11") !== -1) say("a report dated before the reader's day is not past when the list cannot place the day");
  return bad;
}

async function events(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const EV = await loadMutated("shared/flows-events.js", p.events || [], { salt: 1 });
  const CT = await loadMutated("shared/flows-catalysts.js", p.catalysts || [], { salt: 2 });
  let n = 0;
  for (const G of ["2026-08-25", "2026-09-04", "2026-11-25", "2026-12-24", "2026-03-30"]) {
    const end = weekEnd(G);
    for (let t = Date.parse(G + "T00:00:00Z") - 3 * 864e5; t <= Date.parse(G + "T00:00:00Z") + 40 * 864e5; t += 864e5) {
      const d = new Date(t).toISOString().slice(0, 10);
      for (const time of ["premarket", "postmarket", "unknown"]) {
        const row = EV.eventRow({ ticker: "SYX101", next_earnings_date: d, er_time: time, close: 50 }, { iv30: 0.4, impliedMovePerc: 0.05 }, { gateOrigin: G });
        const imp = impactOf(d, time);
        const want = imp.early < G ? null : sessionsAfter(G, imp.early);
        n++;
        if (row.sdte !== want) { say(`report ${d} ${time} from ${G}: ${row.sdte} sessions against ${want}`); break; }
        if (row.di !== imp.early) { say(`report ${d} ${time}: placed on ${row.di}, moves ${imp.early}`); break; }
        if (row.imSpans !== (imp.late <= end)) { say(`report ${d} ${time} from ${G}: spans ${row.imSpans} though the week ends ${end}`); break; }
        if (row.imSpans !== true && row.evp !== null) { say(`report ${d} ${time}: an event premium from a move that does not span it`); break; }
      }
    }
  }
  if (n < 500) say("too few event rows were checked");
  const built = EV.buildEvents([], { gateOrigin: "2026-09-04", sessionDate: "2026-09-03" });
  same(built.week, ["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], "the week list skips Labor Day");
  const at = (day) => ({ time: day + "T14:30:00Z", event: "CPI m/m" });
  const econ = CT.shapeEconomicCalendar(["2026-08-25", "2026-08-28", "2026-08-31", "2026-09-08"].map(at), { sessionDate: "2026-08-24" });
  const wantSd = econ.rows.map((r) => Math.max(0, sessionsAfter("2026-08-25", r.day)));
  if (JSON.stringify(econ.rows.map((r) => r.sd)) !== JSON.stringify(wantSd)) say(`macro session counts ${econ.rows.map((r) => r.sd)} against ${wantSd} from day zero`);
  const rg = CT.reactionGauge([{ t: "SYX101", realized: 0.044996, em: 0.04 }, { t: "SYX102", realized: 0.04449, em: 0.0955 }]);
  if (rg.rows[0][3] !== 0.044996 / 0.04 || rg.rows[1][1] !== 0.04449) say("the reaction rows are rounded before they are printed");
  const page = pagePick("assets/js/flows-events.js", ["ISO", "n", "dayOfReport", "sessionDays", "typical"], { F, DASH, UI }, p.page || []);
  if (F.px(rg.rows[0][3], 2) !== "1.12") say(`the ratio 1.1249 prints ${F.px(rg.rows[0][3], 2)}`);
  if (F.pct(rg.rows[1][1], 1, true) !== "+4.4%") say(`the realized move 4.449% prints ${F.pct(rg.rows[1][1], 1, true)}`);
  for (const [chg, sig, want] of [[0.0071, 0.02, "+0.4"], [0.0031, 0.02, "+0.2"], [-0.0012, 0.03, MINUS + "<0.1"], [0.0012, 0.03, "+<0.1"]]) {
    const got = page.typical(Math.log1p(chg) / sig);
    if (got !== want) say(`typical days of ${chg} over ${sig}: ${got} against ${want}`);
  }
  if (page.dayOfReport({ d: "2026-08-29", di: "2026-08-31" }) !== "2026-08-31") say("a Saturday report is not drawn on the Monday it moves");
  same(page.sessionDays({ gateOrigin: "2026-09-04", week: built.week }), built.week, "the week ahead draws the payload's sessions");
  if (page.sessionDays({ gateOrigin: "2026-09-04" }).includes("2026-09-07")) say("the week ahead draws Labor Day as a session");
  const src = pageSource("assets/js/flows-events.js", p.page || []);
  if (/the run's own session date/.test(src)) say("day zero is still called the run's own session date");
  if (/× the priced move/.test(src)) say("the reaction ratio is still called a multiple of the priced move");
  return bad;
}

async function desk(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const PR = await loadMutated("shared/flows-premium.js", p.premium || [], { salt: 3 });
  for (const [K, bid] of [[110, 1], [100, 3.4], [85, 16.2], [104.5, 2.05]]) {
    const row = { strategy: "cc", strike: K, bid, ask: bid + 0.1, mid: bid + 0.05, type: "C", expiry: "2026-12-18", days: 30, breakeven: 100 - bid };
    PR.attachMidIv(row, { spot: 100 });
    const want = row.ivMid > 0 ? Math.log((K + bid) / 100) / (row.ivMid * Math.sqrt(30 / 365)) : null;
    if (want === null || Math.abs(row.upSigmas - want) > 1e-12) say(`uncovered cushion of the ${K} call: ${row.upSigmas} against ${want}`);
  }
  const ctx = bootModules(["flows-desk.js", "flows-desk-calls.js"], { "flows-desk.js": p.deskPage || [], "flows-desk-calls.js": p.callsPage || [] }, { noDocument: true });
  const DT = ctx.__FlowsDeskTest, CT = ctx.__FlowsDeskCallsTest;
  for (const [name, line] of [["shared", PR.shortCallLine], ["page", CT.shortCallLine]]) {
    const a = line({ bid: 11, strike: 90 }, { spot: 100, delta: 0.85, days: 30, contracts: 100, convention: "delta", haircut: 0.3, floor: 0.1, buyingPower: 5000 });
    if (a.n !== 1 || a.deltaShares !== 85 || a.deltaDollarsC !== 850000) say(`${name} short call sized to ${a.n}: ${a.deltaShares} shares, ${a.deltaDollarsC} cents of delta`);
  }
  const terms = { cv: "delta" };
  const pick = pagePick("assets/js/flows-desk-calls.js", ["cushionOf", "KEYS"], { terms, isNum }, p.callsPage || []);
  const A = { cushionSigmas: 2.33, upSigmas: 0.028, __sc: { ok: true, premiumC: 110000 } }, B = { cushionSigmas: 0.42, upSigmas: 0.405, __sc: { ok: true, premiumC: 120000 }, premium: 400 };
  A.premium = 1100;
  if (!(pick.KEYS.premium(B) > pick.KEYS.premium(A))) say("Premium received does not rank the larger printed premium first");
  if (pick.KEYS.cushionSigmas(A) !== 0.028) say("the uncovered cushion is the covered call's downside cushion");
  terms.cv = "shares";
  if (pick.KEYS.cushionSigmas(A) !== 2.33) say("shares held lost the covered call's cushion");
  let r = 7;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r; };
  for (let i = 0; i < 4000; i++) {
    const c = 1 + (rnd() % 900000), q = rnd() % (c * 3), dp = rnd() % 3;
    const units = halfUpInt(BigInt(q) * 10n ** BigInt(dp + 2), c);
    const want = units === 0n && q > 0 ? "<" + (dp ? "0." + "0".repeat(dp - 1) + "1" : "1") + "%" : fixed(units, dp) + "%";
    const got = DT.exactPct(q, c, dp);
    if (got !== want) { say(`exact percent ${q}/${c} at ${dp}: ${got} against ${want}`); break; }
  }
  if (DT.exactPct(2900, 80000, 2) !== "3.63%") say("a put at 8 for 0.29 is not 3.63%");
  if (DT.exactPct(1100 * 365, 50000 * 146, 0) !== "6%") say("5.5% annualised does not round to 6%");
  const c = DT.lineCents({ bid: 0.29, collateral: 800, extrinsic: 0.29, days: 30, strategy: "csp" });
  if (!c || c.premiumC !== 2900 || c.collateralC !== 80000 || c.timeC !== 2900) say("the line's cents are not the cents shown");
  return bad;
}

async function strategy(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const usd = F.unit.of("money");
  const pick = pagePick("assets/js/flows-strategy.js", ["dollars", "gusd", "whole", "kf", "tenthsOf"], { F, isNum, DASH, usd }, p.page || []);
  for (let m = 50000; m <= 60000; m += 5) {
    const s = (m / 1000).toFixed(3);
    const { units } = roundDecimal(s, 2);
    const want = fixed(units, 2).replace(/\.?0+$/, "");
    if (pick.kf(Number(s)) !== want) { say(`strike or breakeven ${s}: ${pick.kf(Number(s))} against ${want}`); break; }
  }
  for (let k = -5000; k <= 5000; k++) {
    const v = k / 2;
    const units = halfUpInt(Math.abs(k), 2);
    const want = v === 0 ? "$0" : (v < 0 ? MINUS : "+") + (units === 0n ? "<$1" : "$" + group(units.toString()));
    if (pick.whole(v) !== want) { say(`grid dollars ${v}: ${pick.whole(v)} against ${want}`); break; }
  }
  if (pick.gusd(-12.5) !== MINUS + "$13") say(`theta of -12.5 prints ${pick.gusd(-12.5)}`);
  for (let k = 0; k <= 10000; k++) {
    const v = k / 10000;
    const want = v >= 0.9995 ? 1000 : Number(halfUpInt(k, 10));
    if (pick.tenthsOf(v) !== want) { say(`chance of profit ${v}: ${pick.tenthsOf(v)} tenths against ${want}`); break; }
  }
  const E = "2026-12-18";
  const { expiryProfile } = await import("../shared/flows-quant-engine.js");
  const st = {
    legs: [{ type: "S", K: null, side: 1, qty: 1, expiry: null }, { type: "C", K: 105, side: -1, qty: 1, expiry: E }], basis: "fill", expiry: E,
    setup: { expiries: new Map([[E, { slice: { D: 0.98, F: 100.6 } }]]) }, bookErr: new Set(), books: new Map(),
  };
  const mf = pagePick("assets/js/flows-strategy.js", ["modelFree"], { st, isNum, spot: () => 100, rowOf: () => ({ bid: 3.10, ask: 3.20 }), Q: { expiryProfile } }, p.page || []).modelFree();
  const div = 100 / 0.98 - 100.6, cost = 100 - (3.15 + 0.25 * (3.10 - 3.15));
  if (!mf.prof || Math.abs(mf.prof.maxProfit - (105 + div - cost)) > 1e-9) say(`covered call chart maximum ${mf.prof && mf.prof.maxProfit} against ${105 + div - cost} with the carried dividend`);
  const ENG = await loadMutated("shared/flows-quant-engine.js", p.engine || [], { salt: 4 });
  const eng = engineBlock("SYX301", "2026-09-29", 100);
  const asOfMs = Date.parse("2026-09-29T20:00:00Z");
  const row = { K: 100, type: "C", bid: 3.1, ask: 3.14, oi: 500, volume: 10, sym: "x", ivSeed: 0.4 };
  const fit = NODE_Q.contractFit({ expiry: "2026-10-16", asOfMs, spot: 100, rate: 0.04, row });
  const setup = NODE_Q.labSetup({ asOfMs, spot: 100, facts: [], state: null, pLaw: eng.pLaw, event: null, stale: false, books: [{ fit, rows: [row] }], lawCache: new Map() });
  const FAM = { id: "custom", risk: "defined", dir: "neutral" };
  const long = ENG.priceStructure(setup, { family: "custom", fam: FAM, expiry: "2026-10-16", legs: [{ type: "C", K: 100, side: 1, qty: 1 }], basis: "natural" });
  if (!long || long.profitUnbounded !== true || long.prob.pMaxProfitQ !== null) say(`an unbounded maximum profit has a chance of ${long && long.prob.pMaxProfitQ}`);
  const short = ENG.priceStructure(setup, { family: "custom", fam: { ...FAM, risk: "undefined" }, expiry: "2026-10-16", legs: [{ type: "C", K: 100, side: -1, qty: 1 }], basis: "natural" });
  if (!short || short.lossUnbounded !== true || short.prob.pMaxLossQ !== null) say(`an unbounded maximum loss has a chance of ${short && short.prob.pMaxLossQ}`);
  const src = pageSource("assets/js/flows-strategy.js", p.page || []) + pageSource("shared/flows-pages.js", p.pages || []);
  if (/plus a quarter of the spread/.test(src)) say("the fill is still called a quarter of the spread");
  if (/Math\.abs\((?:d|del|sh|bw)\)\.toFixed\(/.test(src)) say("a signed figure is still printed with a local toFixed");
  return bad;
}

function glance(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const G = bootModules(["flows-ui.js", "flows-ticker-glance.js"], { "flows-ticker-glance.js": p.page || [] }).window.FlowsUI.tickerGlance;
  const days = [];
  for (let t = Date.parse("2025-08-01T00:00:00Z"); days.length < 260; t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); if (CAL.isSession(d)) days.push(d); }
  const candles = days.map((d, i) => { const c = 100 + 20 * Math.sin(i / 17); return [d, c, c + 1.5 + (i % 7) / 3, c - 1.5 - (i % 5) / 4, c, 1000]; });
  const yr = candles.slice(-252);
  const lo = Math.min(...yr.map((r) => r[3])), hi = Math.max(...yr.map((r) => r[2])), S = candles[candles.length - 1][4];
  const card = { ticker: "SYX401", sessionDate: days[days.length - 1], panels: { context: { status: "ok", candles, week52Pos: 0.98 }, pricedMove: { status: "ok", spot: S, iv30: 0.455, ivRank: 0.36 } } };
  const cone = { status: "ok", iv30: 0.503, tenors: [{ days: 30, min: 0.3736, max: 0.5421, rangePos: (0.503 - 0.3736) / (0.5421 - 0.3736) }] };
  const next = { d: days[days.length - 1] < "2026-09-01" ? "2026-09-17" : "2026-12-17", sessions: 12, when: "postmarket" };
  const cards = (cardX) => G.model.cards(card, { cardX });
  const range = cards({}).find((c) => c.id === "range");
  const want = F.pct((S - lo) / (hi - lo), 0);
  if (range.fig.text !== want) say(`the range card prints ${range.fig.text} of the way, its own ends give ${want}`);
  const vol = cards({ cone }).find((c) => c.id === "volatility");
  if (vol.fig.text !== F.pct(0.503, 1) || vol.sub !== "IV rank 77") say(`the volatility card prints ${vol.fig.text} with ${vol.sub}, its own year ranks it 77`);
  const volPm = cards({}).find((c) => c.id === "volatility");
  if (volPm.sub !== "IV rank 36") say(`without a cone the screener rank goes with the screener IV, not ${volPm.sub}`);
  const other = { status: "ok", next, impliedNext: { em: 0.0443877, d: "2026-08-31" }, events: [] };
  const earnOther = cards({ earnings: other }).find((c) => c.id === "earnings");
  if (earnOther.parts.priced !== null) say(`a priced move for another report date is printed for this one (${earnOther.parts.priced})`);
  const own = { ...other, impliedNext: { em: 0.0443877, d: next.d } };
  const earnOwn = cards({ earnings: own }).find((c) => c.id === "earnings");
  if (earnOwn.parts.priced !== 0.0443877) say("the report's own priced move is not printed");
  const term = { status: "ok", eventMove: { sd: 0.0667 } };
  const earnTerm = cards({ earnings: own, term }).find((c) => c.id === "earnings");
  if (Math.abs(earnTerm.parts.priced - 0.0667 / Math.sqrt(Math.PI / 2)) > 1e-15) say(`the card's priced move ${earnTerm.parts.priced} is not the term deviation on the mean-move basis`);
  return bad;
}

async function macro(p = {}) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const M = await loadMutated("shared/flows-macro.js", p.shared || [], { salt: 5 });
  let flagged = 0, s = 11;
  const rnd = () => { s = (s * 69069 + 1) % 4294967296; return s / 4294967296; };
  for (let rep = 0; rep < 60; rep++) {
    const all = Array.from({ length: 500 }, (_, i) => { const n = 20 + Math.floor(rnd() * 7); let k = 0; for (let j = 0; j < n; j++) if (rnd() < 0.5) k++; return { ticker: "SYX" + String(i).padStart(3, "0"), sector: "S", years: n, positive_closes: k }; });
    const top = all.sort((a, b) => b.positive_closes / b.years - a.positive_closes / a.years).slice(0, 50);
    flagged += M.performersTable({ data: top }).survive;
  }
  if (flagged > 6) say(`fair coins screened from 500 names flag ${flagged} survivors over 60 runs`);
  const sr = (unit, a, b) => ({ status: "ok", unit, interval: "monthly", points: [["2026-08-01", a], ["2026-09-01", b]] });
  const rs = M.periodic(sr("percent", -0.9, 0.4), { daily: false });
  if (Math.abs(rs.chgPrev - 1.3) > 1e-12 || rs.chgUnit !== "pts") say(`a percent series from -0.9 to 0.4 changes by ${rs.chgPrev} ${rs.chgUnit || ""}`);
  const cpi = M.periodic(sr("index", 110.179, 111.16), { daily: false });
  if (Math.abs(cpi.chgPrev - (111.16 / 110.179 - 1)) > 1e-15 || cpi.chgUnit) say("an index series lost its ratio");
  const c = M.parseContract("ESV6", "ES", "2026-10-27");
  if (!c || c.label !== "Oct ’26") say(`the contract month reads ${c && c.label}, like a date`);
  const w = world("ok");
  w.session = "2026-12-15";
  const out = M.buildMacro(w, { test: true });
  const rows = (w.seasonYearMonth.SPY.body.data || w.seasonYearMonth.SPY.body);
  const jan = rows.filter((r) => +r.month === 1 && +r.year <= 2026 && +r.open > 0).length;
  const spy = out.seasonality.funds.next.find((r) => r[0] === "SPY");
  if (!spy || spy[1] !== jan) say(`December's next-month cell counts ${spy && spy[1]} Januaries of ${jan}`);
  const PV = await loadMutated("scripts/flows-legs/private.mjs", p.private || [], { salt: 6 });
  const cos = Array.from({ length: 300 }, (_, i) => ({ npm_ticker: "SYPM" + String(i).padStart(3, "0"), name: "Sample Co " + i, sector: "Technology", sub_sectors: [] }));
  const uw = async (path, params) => {
    if (/companies/.test(path) && !/companies\/SYPM/.test(path)) { const o = +params.offset || 0; return { data: cos.slice(o, o + (+params.limit || 200)) }; }
    const m = /(SYPM\d{3})/.exec(path);
    if (!m || /funding|pricing|management|investors/.test(path)) return { data: [] };
    return { data: { total_funding: String(1e9 - +m[1].slice(4) * 1e6), investor_count: 5, latest_price: null } };
  };
  let prior = null;
  const nights = [];
  for (const session of ["2026-10-26", "2026-10-27", "2026-10-28"]) {
    const o = await PV.runPrivateSectors({ uw, session, prior, sectors: ["Technology"], cap: 1000 });
    nights.push(o.sectors.Technology);
    prior = { sectors: o.sectors };
  }
  for (const [i, e] of nights.entries()) {
    if (e.top[0][0] !== "SYPM000") say(`night ${i + 1}: the largest private peer is ${e.top[0][0]}`);
  }
  if (nights[2].listed !== 300) say(`night 3 lists ${nights[2].listed} of 300 companies`);
  const priv = pagePick("assets/js/flows-ticker-private.js", ["COPY", "say", "REFRESH_MS", "num", "text", "investorModel"], { F }, p.privatePage || []);
  const inv = priv.investorModel({ at: 1000, match: { name: "Sample Capital", companyCount: null, companies: [] } }, 2000);
  if (inv.line === priv.COPY.none) say("a matched investor with no count is called not an investor");
  const mp = pageSource("assets/js/flows-macro.js", p.macroPage || []);
  if (/chg\(n\.chg1\) : "", b\.at/.test(mp) || /chg\(nf\.chg1\) : "", bf\.at/.test(mp)) say("a live rate is still printed beside the nightly change");
  if (!/F\.pct\(ck\.gap, 2\)/.test(mp)) say("the crypto gap is printed too coarse to clear its own threshold");
  if (!/mk\.holders\.n >= 3/.test(mp)) say("the three-holder line is printed for fewer than three holders");
  if (!/F\.pct\(mk\.spread, 1\)\.replace\("%", " pts"\)/.test(mp)) say("the spread is printed as a percent");
  if (!/e\.why === "unit" \? esc\(say\("series\.unit"\)\)/.test(mp)) say("every failed series is said to have no unit");
  if (!/rates\.horizon\.short/.test(mp)) say("the rates change carries no horizon");
  return bad;
}

const BLOCKS = [
  ["Home: the priced move, the chip share, the session counts and the board tags", home],
  ["Events: report sessions, the spanning move, the week, macro counts, reaction digits, typical days and the copy", events],
  ["Premium desk: the uncovered cushion, the sized delta, the premium rank and exact percents", desk],
  ["Strategy lab: strikes, dollars, the gap, the dividend in the chart and unbounded odds", strategy],
  ["Ticker glance: one range, one volatility source, one report", glance],
  ["Macro: the screened correction, percent series, contract months, December's January, private peers and the page", macro],
];

for (const [name, fn] of BLOCKS) {
  const bad = await fn();
  same(bad, [], name + " equals the oracle");
}

const PLANTS = [
  ["the priced move rounds the binary product", home, { below: [['"±" + F.pct(Math.abs(im), 1)', '"±" + (Math.abs(im) * 100).toFixed(1) + "%"']] }],
  ["the chip share rounds the binary product", home, { overview: [["F.pct(a / (a + b), 0)", 'Math.round((a / (a + b)) * 100) + "%"']] }],
  ["the session count is a weekday count", home, { overview: [["return list.filter((x) => x > from && x <= to).length;", 'let n = 0; for (let t = Date.parse(from + "T12:00:00Z") + 864e5; t <= Date.parse(to + "T12:00:00Z"); t += 864e5) if (![0, 6].includes(new Date(t).getUTCDay())) n++; return n;']] }],
  ["the board tag prints the nightly's count unaged", home, { overview: [["const s = reportAhead(ev && ev.sdte, origin, today, ev && (ev.di || ev.d));", "const s = isNum(ev && ev.sdte);"]] }],
  ["the report count ignores the report time", events, { events: [["const n = calendarBetween(origin, imp.early);", "const n = calendarBetween(origin, earningsDate);"]] }],
  ["the spanning test reads the earlier session", events, { events: [["return !imp || !end ? null : imp.late <= end;", "return !imp || !end ? null : imp.early <= end;"]] }],
  ["the event premium ignores the span", events, { events: [["evp: spans !== true || vendorMove === null", "evp: vendorMove === null"]] }],
  ["macro prints count from the run's session", events, { catalysts: [["return n === null ? null : Math.max(0, n - 1);", "return n;"]] }],
  ["the reaction rows are rounded", events, { catalysts: [["[p.t, p.realized, p.em, p.ratio]", "[p.t, Number(p.realized.toFixed(4)), Number(p.em.toFixed(4)), Number(p.ratio.toFixed(3))]"]] }],
  ["typical days use a local toFixed", events, { page: [["const typical = (z) => (n(z) === null ? DASH : F.signed(n(z), 1));", 'const typical = (z) => (n(z) === null ? DASH : (z > 0 ? "+" : z < 0 ? "\\u2212" : "") + Math.abs(z).toFixed(1));']] }],
  ["a weekend report is drawn on its date", events, { page: [['const dayOfReport = (r) => (r && ISO.test(String(r.di || "")) ? r.di : r ? r.d : null);', "const dayOfReport = (r) => (r ? r.d : null);"]] }],
  ["the uncovered cushion is the downside cushion", desk, { premium: [["sigmaMove(p.strike + p.bid, spot, p.ivMid, years)", "sigmaMove(spot, p.breakeven, p.ivMid, years)"]] }],
  ["the shared delta counts the requested contracts", desk, { premium: [["deltaShares: d === null ? null : d * SHARES_PER_CONTRACT * n,", "deltaShares: d === null ? null : d * SHARES_PER_CONTRACT * contracts,"]] }],
  ["the page delta counts the requested contracts", desk, { callsPage: [["deltaDollarsC: d === null ? null : roundCents(d * SHARES_PER_CONTRACT * S * n),", "deltaDollarsC: d === null ? null : roundCents(d * SHARES_PER_CONTRACT * S * contracts),"]] }],
  ["Premium received ranks one contract", desk, { callsPage: [["premium: (r) => (r.__sc && r.__sc.ok ? r.__sc.premiumC : null),", "premium: (r) => r.premium,"]] }],
  ["the uncovered rank reads the downside cushion", desk, { callsPage: [['const cushionOf = (r) => (terms.cv === "shares" ? r.cushionSigmas : isNum(r.upSigmas));', "const cushionOf = (r) => r.cushionSigmas;"]] }],
  ["exact percents truncate", desk, { deskPage: [["const q = (2n * BigInt(p) * 10n ** BigInt(dp + 2) + BigInt(c)) / (2n * BigInt(c));", "const q = (BigInt(p) * 10n ** BigInt(dp + 2)) / BigInt(c);"]] }],
  ["strikes round the binary double", strategy, { page: [['const kf = (K) => { if (isNum(+K) === null) return DASH; const s = F.px(+K, 2); return s.includes(".") ? s.replace(/\\.?0+$/, "") : s; };', "const kf = (K) => (isNum(K) === null ? DASH : String(+(+K).toFixed(2)));"]] }],
  ["grid dollars round half toward plus infinity", strategy, { page: [['const dollars = (v) => { const s = F.int(v, true); return s === DASH ? s : s.replace(/^([+−]?<?)/, "$1$"); };', 'const dollars = (v) => (v < 0 ? "−" : v > 0 ? "+" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("en-US");']] }],
  ["the gap rounds the binary product", strategy, { page: [["const tenthsOf = (v) => {", "const tenthsOf = (v) => Math.round(v * 1000); const tenthsOld = (v) => {"]] }],
  ["the chart drops the carried dividend", strategy, { page: [["{ type: l.type, K: l.K, side: l.side, qty: l.qty, div }", "{ type: l.type, K: l.K, side: l.side, qty: l.qty }"]] }],
  ["an unbounded profit has a zero chance", strategy, { engine: [["pMaxProfitQ: prof.maxProfit === null ? null : rpr(lawIntervalsProb(qLaw, prof.maxProfitAt)),", "pMaxProfitQ: rpr(lawIntervalsProb(qLaw, prof.maxProfitAt)),"]] }],
  ["the fill copy says a quarter of the spread", strategy, { pages: [["Mid plus a quarter of the half-spread (an eighth of the spread)", "Mid plus a quarter of the spread"]] }],
  ["the range reads the closes' position", glance, { page: [["const pos = hi !== null && lo !== null && hi > lo && S !== null ? (S - lo) / (hi - lo) : null;", "const pos = num(ctx.week52Pos) !== null ? ctx.week52Pos : hi !== null && hi > lo && S !== null ? (S - lo) / (hi - lo) : null;"]] }],
  ["the volatility rank is the screener's beside the cone", glance, { page: [["const rk = coneIv !== null ? coneRank(cone) : ivRank(card);", "const rk = ivRank(card);"]] }],
  ["a priced move for another date is printed", glance, { page: [["iN.em > 0 && next && isoOk(next.d) && iN.d === next.d ? iN.em : null;", "iN.em > 0 ? iN.em : null;"]] }],
  ["the card prints the deviation as the mean move", glance, { page: [["return { sd, mean: sd / SD_OVER_MEAN_ABS, src: \"term\" };", "return { sd, mean: sd, src: \"term\" };"]] }],
  ["the correction counts only the names listed", macro, { shared: [["const screened = Math.max(PERFORMERS_SCREENED, items.length);", "const screened = items.length;"]] }],
  ["a percent series changes by a ratio", macro, { shared: [["const points = sr.unit === \"percent\";", "const points = false;"]] }],
  ["the contract month reads like a date", macro, { shared: [['label: MONTH_NAMES[mi] + " \\u2019" + String(y).slice(2)', 'label: MONTH_NAMES[mi] + " " + String(y).slice(2)']] }],
  ["December drops this year's January", macro, { shared: [['monthRows(body, month, slot === "next" && month < sm ? sy + 1 : sy)', "monthRows(body, month, sy)"]] }],
  ["the private table keeps only the current page", macro, { private: [["const top = walking ? fresh.concat((before.top || []).filter((e) => Array.isArray(e) && !seen.has(e[0]))) : fresh;", "const top = fresh;"]] }],
  ["a matched investor with no count is called none", macro, { privatePage: [['line: n === null ? say("uncounted")', 'line: n === null ? say("none")']] }],
  ["the live rate sits beside the nightly change", macro, { macroPage: [["return tile(p, px(b.rate, PAIR_DP(p)), sinceClose(b.rate, n), b.at", 'return tile(p, px(b.rate, PAIR_DP(p)), n && n.status === "ok" ? chg(n.chg1) : "", b.at']] }],
  ["the crypto gap prints one decimal", macro, { macroPage: [["✕ ${F.pct(ck.gap, 2)}", "✕ ${F.pct(ck.gap, 1)}"], ['{ gap: F.pct(ck.gap, 2) }', '{ gap: F.pct(ck.gap, 1) }']] }],
];

let killed = 0;
for (const [name, fn, patches] of PLANTS) {
  const bad = await fn(patches);
  assert.ok(bad.length > 0, `the planted wrong build "${name}" must fail`);
  killed++;
  checks++;
}

console.log(`math-audit3: ${checks} checks; six oracle blocks hold and ${killed} planted wrong builds each fail`);
