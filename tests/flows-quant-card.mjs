import assert from "node:assert/strict";
import fs from "node:fs";
import { nightlySource } from "./lib/source-scan.mjs";
import * as BS from "../shared/flows-quant-bs.js";
import * as SMILE from "../shared/flows-quant-smile.js";
import * as DENSITY from "../shared/flows-quant-density.js";
import * as WORLD from "../shared/flows-quant-world.js";
import * as ENGINE from "../shared/flows-quant-engine.js";
import * as TIME from "../shared/flows-quant-time.js";
import * as QC from "../shared/flows-quant-card.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";
import { priceSale } from "../shared/flows-premium.js";
import { bucketsOf, BUCKET_LINES, eventBucket } from "../shared/flows-quant-structures.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const near = (a, b, tol, m) => {
  assert.ok(typeof a === "number" && Number.isFinite(a), `${m}: got ${a}`);
  assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (|diff| ${Math.abs(a - b)} > ${tol})`);
  n++;
};

const SESSION = "2026-09-21";
const AS_OF_MS = TIME.closeUtcMs(SESSION);
const SPOT = 100, R = 0.04;
const SVI = Object.freeze({ a: 0.006, b: 0.06, rho: -0.55, m: 0.02, sigma: 0.12 });
const code = (day) => day.slice(2).replace(/-/g, "");

function sessionWorld(asOfDay, expiries, { sd, beta = 0, jumps = [] }) {
  const asOfMs = TIME.closeUtcMs(asOfDay);
  return expiries.map((expiry) => {
    const T = TIME.yearFraction(asOfMs, expiry), hSessions = TIME.remainingSessions(asOfMs, expiry), tau = hSessions / TIME.SESSIONS_PER_YEAR;
    const w = sd * sd * tau + beta * tau * tau + jumps.reduce((a, j) => a + (expiry >= j.date ? j.J * j.J : 0), 0);
    return {
      expiry, T, dte: TIME.calendarDays(asOfDay, expiry), sessions: TIME.sessionsBetween(asOfDay, expiry), hSessions, rows: [],
      slice: { method: "flat", T, F: 100, D: 1, params: { sigma: Math.sqrt(w / T) } },
    };
  });
}

function vendorChain({ ticker = "SYN", expiries = ["2026-10-02", "2026-10-16", "2026-10-23", "2026-11-20", "2026-12-18"],
  step = 2.5, lo = 70, hi = 130, rate = R, pct = false, seed = "v" } = {}) {
  const rng = WORLD.xoshiro128ss(seed);
  const rows = [];
  for (const expiry of expiries) {
    const T = TIME.yearFraction(AS_OF_MS, expiry);
    const F = SPOT * Math.exp(rate * T), D = Math.exp(-rate * T);
    const scale = Math.sqrt(T / (32 / 365));
    for (let K = lo; K <= hi + 1e-9; K += step) {
      const k = Math.log(K / F);
      const svi = { ...SVI, a: SVI.a * scale * scale, b: SVI.b * scale * scale };
      const vol = Math.sqrt(SMILE.sviW(svi, k) / T);
      for (const type of ["C", "P"]) {
        const price = BS.black76(F, D, K, vol, T, type);
        const half = Math.max(0.01, 0.012 * price);
        const mid = price + (rng.uniform() - 0.5) * half;
        const bid = Math.max(0, Math.round((mid - half) * 100) / 100), ask = Math.round((mid + half) * 100) / 100 + 0.01;
        const otm = type === "C" ? K >= SPOT : K <= SPOT;
        const oi = Math.round((otm ? 5000 : 1800) * Math.exp(-Math.abs(k) / 0.1)) + 50;
        rows.push({
          option_symbol: ticker + code(expiry) + type + String(Math.round(K * 1000)).padStart(8, "0"),
          nbbo_bid: String(bid), nbbo_ask: String(ask),
          implied_volatility: String(pct ? vol * 100 : vol * (1 + (rng.uniform() - 0.5) * 0.1)),
          open_interest: oi, volume: Math.round(oi / 7), last_tape_time: "2026-09-21T19:58:00Z",
        });
      }
    }
  }
  return rows;
}

{
  const rows = vendorChain({ pct: true });
  rows.push({ ...rows[0] });
  rows.push({ ...rows[1], option_symbol: rows[1].option_symbol.replace(/^SYN/, "SYN1") });
  rows.push({ ...rows[2], option_symbol: "SYN260918C00100000" });
  const staleRow = rows.find((r) => r.option_symbol === "SYN261002P00095000");
  staleRow.last_tape_time = "2026-09-18T15:00:00Z";
  const got = QC.chainRowsByExpiry(rows, { ticker: "SYN", sessionDate: SESSION });
  eq(got.divisor, 100, "a chain quoting IV in percent is read with a divisor of 100, from its own median");
  eq(got.foreign, 1, "an adjusted series (SYN1) is not the ticker's own chain and is counted, not read");
  eq(got.expired, 1, "an expiry at or before the session is dropped and counted");
  ok(got.expiries.every((e) => e.rows.every((r) => typeof r.bid === "number" && typeof r.K === "number")),
     "feed strings arrive as numbers");
  const syms = got.expiries.flatMap((e) => e.rows.map((r) => r.sym));
  eq(syms.length, new Set(syms).size, "a contract repeated across pages is read once");
  ok(got.expiries.every((e) => e.rows.every((r, i, a) => i === 0 || a[i - 1].K <= r.K)), "rows are sorted by strike");
  const stale = got.expiries.find((e) => e.expiry === "2026-10-02").rows.find((r) => r.K === 95 && r.type === "P");
  eq(stale.untraded, true, "a quote whose last tape predates the session is kept for the fit and marked untraded");
  ok(got.expiries[0].rows.every((r) => r.ivSeed === null || r.ivSeed < 3), "the seed IV is a fraction after the divisor");
}

{
  const rows = vendorChain();
  const priced = rows.map((r) => priceSale(r, { spot: SPOT, asOf: SESSION })).filter(Boolean);
  const q = QC.quoteImpliedVols(priced, { spot: SPOT, rate: R });
  let worst = 0, counted = 0;
  for (const p of q) {
    if (p.iv === null || p.expiry !== "2026-10-23") continue;
    const T = p.days / 365, F = SPOT * Math.exp(R * T);
    const truth = Math.sqrt(SMILE.sviW({ ...SVI, a: SVI.a * T / (32 / 365), b: SVI.b * T / (32 / 365) }, Math.log(p.strike / F)) / T);
    if (Math.abs(Math.log(p.strike / F)) > 0.15) continue;
    worst = Math.max(worst, Math.abs(p.iv - truth)); counted++;
  }
  ok(counted >= 10 && worst < 0.01, `the NBBO mid inverts to within a vol point of the smile that priced it on ${counted} near quotes (worst ${(worst * 100).toFixed(2)} points)`);
  ok(q.every((p) => "ivVendor" in p), "and keeps the feed's figure beside it as a seed, never as the reading");
  const garbage = priced.map((p) => (p.strike >= 128 ? { ...p, bid: 0.01, ask: 0.05, mid: 0.03 } : p));
  const qg = QC.quoteImpliedVols(garbage, { spot: SPOT, rate: R });
  ok(qg.filter((p) => p.strike >= 128).every((p) => p.iv === null), "minimum-tick wing quotes invert to nothing (defect 2)");
}

{
  const rowsB = [
    { strike: 40, call_gamma_oi: "1e5", put_gamma_oi: "-9e5" }, { strike: 42.5, call_gamma_oi: "3e5", put_gamma_oi: "-4e5" },
    { strike: 45, call_gamma_oi: "8e5", put_gamma_oi: "-1e5" }, { strike: 48, call_gamma_oi: "2e5", put_gamma_oi: "-2e6" },
  ];
  const b = QC.bookLevels(rowsB, { spot: 43.23 });
  ok(b.putWall <= 43.23 && 43.23 <= b.callWall,
     `card B's book: the put wall ${b.putWall} sits at or below spot 43.23 and the call wall ${b.callWall} at or above it, although the largest put gamma is at 48 (defect 4)`);
  eq(b.putSign, "dealer", "negative put gamma is read as dealer-signed");
  const holder = QC.bookLevels(rowsB.map((r) => ({ ...r, put_gamma_oi: String(-Number(r.put_gamma_oi)) })), { spot: 43.23 });
  eq([holder.putWall, holder.callWall, holder.putSign], [b.putWall, b.callWall, "holder"], "holder-signed puts give the same walls");
  near(holder.gex, b.gex, 1e-6, "and the same book net, since the put sign is read before summing");
  const mixed = QC.bookLevels(rowsB.map((r, i) => ({ ...r, put_gamma_oi: i % 2 ? "3e5" : "-3e5" })), { spot: 43.23 });
  ok(mixed.putSign === "mixed" && mixed.magnet === null && mixed.gex === null,
     "a book whose put leg carries both signs publishes no magnet and no net rather than a guess");
  eq(QC.bookLevels([], { spot: 43.23 }), null, "an empty book is no levels at all");
  eq(QC.bookLevels([{ price: "43.23", call_gamma_oi: "1e6", put_gamma_oi: "-1e6" }], { spot: 43.23 }), null,
     "UW-F14: a row carrying only `price`, the underlying's, is not a strike: it would stack the whole book on the spot as both walls");
  eq(QC.bookLevels(rowsB.map((r) => ({ ...r, price: "43.23" })), { spot: 43.23 }).callWall, b.callWall, "while the strike is what places a row that has both");
}

const RATE = { r: R, method: "constant", n: 0 };
const vchain = QC.chainRowsByExpiry(vendorChain(), { ticker: "SYN", sessionDate: SESSION });
const slices = QC.buildSlices(vchain.expiries, { spot: SPOT, asOfMs: AS_OF_MS, rate: R });

{
  ok(slices.built.length === 5 && slices.built.every((e) => e.slice.method === "svi" || e.slice.method === "svi-repaired"),
     `five expiries fit a raw SVI smile from their quotes (${slices.built.map((e) => e.slice.method).join(", ")})`);
  const zero = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2 });
  ok(zero && zero.px !== null, "a put book below spot and a call book above it give a zero-gamma level");
  const contracts = [];
  for (const e of slices.built) for (const r of e.rows) {
    if (!(r.oi > 0)) continue;
    contracts.push({ K: r.K, T: e.T, type: r.type, oi: r.oi, sigma: SMILE.sliceVolK(e.slice, Math.log(r.K / e.slice.F)) });
  }
  const near30 = slices.built.slice().sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
  const total = (x) => contracts.reduce((s, c) => {
    const g = BS.bsmGreeks({ S: x, K: c.K, r: near30.r, q: near30.qImpl, sigma: c.sigma, T: c.T, type: c.type });
    return s + (c.type === "C" ? 1 : -1) * c.oi * 100 * g.gamma * x * x * 0.01;
  }, 0);
  ok(Math.sign(total(zero.px - 0.3)) !== Math.sign(total(zero.px + 0.3)),
     `total dealer gamma re-evaluated by brute force changes sign across ${zero.px} (F3)`);
  eq(zero.why, "flip.coverage-unmeasured", "without the feed's expiry book the coverage is named as unmeasured");
  const covered = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: 1e12 });
  ok(covered.coverage < 0.5 && covered.g === 1 && covered.why === "flip.coverage",
     "and against a book far larger than the fetched contracts the level is graded weak");
  eq(covered.profile.x.length, covered.profile.g.length, "the published profile pairs each spot with its gamma");
}

function grossOfBuilt() {
  let v = 1e12, c = 0;
  for (let i = 0; i < 12 && !(c > 0.1); i++) { v /= 10; c = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: v }).coverage; }
  return c * v;
}

{
  const rows = vendorChain();
  const expiryRows = [...new Set(rows.map((r) => QC.parseSymbol(r.option_symbol).expiry))].map((expiry) => {
    const T = TIME.yearFraction(AS_OF_MS, expiry);
    const scale = Math.sqrt(T / (32 / 365));
    let c = 0, p = 0;
    for (const r of rows) {
      const q = QC.parseSymbol(r.option_symbol);
      if (q.expiry !== expiry) continue;
      const F = SPOT * Math.exp(R * T);
      const vol = Math.sqrt(SMILE.sviW({ ...SVI, a: SVI.a * scale * scale, b: SVI.b * scale * scale }, Math.log(q.strike / F)) / T);
      const g = BS.bsmGreeks({ S: SPOT, K: q.strike, r: R, q: 0, sigma: vol, T, type: q.type }).gamma * r.open_interest * 100;
      if (q.type === "C") c += g; else p += g;
    }
    return { expiry, dte: Math.round(T * 365), call_gex: String(c), put_gex: String(-p) };
  });
  const dollars = expiryRows.map((e) => ({ ...e, call_gex: String(Number(e.call_gex) * SPOT * SPOT / 100), put_gex: String(Number(e.put_gex) * SPOT * SPOT / 100) }));
  const pass = (subset, gammaUnit, vendor) => QP.preparePass({ rowsByTicker: new Map([["SYN", subset]]), sessionDate: SESSION, rate: RATE, spotOf: () => SPOT,
    atrOf: () => 2, expiriesOf: () => vendor, ...(gammaUnit ? { gammaUnit } : {}) }).preps.get("SYN").zero;
  const whole = pass(rows, null, expiryRows);
  ok(whole.coverage > 0.85 && whole.coverage < 1.15 && whole.g === 2 && whole.why === "flip.convention",
     `UW-F2: a complete chain measures coverage ${whole.coverage} against the feed's share-gamma book once both are in dollars per 1%, and its flip is capped at grade 2 with flip.convention because the sign rests on the feed's convention`);
  {
    const grades = [];
    const gross = grossOfBuilt();
    for (const target of [0.2, 0.4, 0.6, 0.8, 0.9, 1, 1.1, 1.5, 3]) {
      const z = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: gross / target });
      grades.push([z.coverage, z.g, z.why]);
    }
    for (const vg of [null, 0, -1, NaN]) {
      const z = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: vg });
      ok(z.g === 2 && z.coverage === null && z.why === "flip.coverage-unmeasured", `a feed book of ${vg} leaves the coverage unmeasured and the flip at grade 2, never 3 (g ${z.g}, ${z.why})`);
    }
    ok(grades.every(([, g]) => g <= 2), `no flip is graded 3 at any coverage (${grades.map((x) => x.join("/")).join(" ")})`);
    ok(grades.some(([c, g, w]) => c >= 0.85 && g === 2 && w === "flip.convention") && grades.some(([c, g, w]) => c >= 0.5 && c < 0.85 && g === 2 && w === "flip.coverage") &&
       grades.some(([c, g, w]) => c < 0.5 && g === 1 && w === "flip.coverage"),
       "the coverage stays a second cap: good coverage is held at 2 by the convention, fair coverage keeps flip.coverage at 2 and weak coverage keeps grade 1");
  }
  const quarter = pass(rows.filter((_, i) => i % 4 === 0), null, expiryRows);
  ok(quarter.coverage > 0.15 && quarter.coverage < 0.4 && quarter.g === 1 && quarter.why === "flip.coverage",
     `and a quarter of the contracts measures ${quarter.coverage} and grades the zero-gamma level weak, where dollars divided by shares published ` +
     "27.15 and grade 3 (the coverage control could not fire for any spot above ten)");
  const inDollars = pass(rows.filter((_, i) => i % 4 === 0), "pct$", dollars);
  near(inDollars.coverage, quarter.coverage, 1e-9, "the same chain against a feed book already in dollars per 1% (unit pct$) reads the same coverage: the conversion follows the resolved unit");
  ok(QP.vendorGrossPer1pct(1000, 100, "share") === 1e5 && QP.vendorGrossPer1pct(1000, 100, "pct$") === 1000 &&
     QP.vendorGrossPer1pct(1000, null, "share") === null && QP.vendorGrossPer1pct(null, 100, "share") === null && QP.vendorGrossPer1pct(0, 100, "share") === null,
     "and a book with no spot or no gross measures no coverage rather than a wrong one");
  const worker = nightlySource();
  ok(/gammaUnit: variationRun\.unit\.used/.test(worker), "the nightly hands the pass the unit the variation probe resolved");
}

{
  const priced = QC.parityRate(QC.chainRowsByExpiry(vendorChain({ ticker: "SPX", rate: 0.047 }), { ticker: "SPX", sessionDate: SESSION }).expiries,
    { spot: SPOT, asOfMs: AS_OF_MS, symbol: "SPX" });
  ok(priced && Math.abs(priced.r - 0.047) < 0.004, `SPX parity recovers the rate its quotes were priced at (${priced && priced.r} against 0.047)`);
  eq(priced.method, "parity:SPX", "and names where it came from");
  const tr = QC.treasuryRate({ data: { data: [{ value: 4.17, date: "2026-09-21" }, { value: 4.3, date: "2026-09-18" }], name: "3month" } });
  near(tr.r, Math.log(1.0417), 1e-5, "the three-month yield in the feed's nested envelope is read at its latest date, continuously compounded");
  eq(QC.chooseRate({}).method, "constant", "with neither the documented constant stands in");
  eq(QC.chooseRate({ parity: priced, treasury: tr }).method, "parity:SPX", "and parity outranks the bill");
  const run = QP.rateFromRuns({ rowsByTicker: new Map(), spotOf: () => null, sessionDate: SESSION, treasuryRaw: [{ value: 4.17, date: "2026-09-21" }] });
  eq(run.method, "treasury:3month", "the pipeline falls back to the bill when no SPX or SPY chain was read");
}

const GARCH = Object.freeze({ status: "ok", omega: 0.045, alpha: 0.05, beta: 0.9, nu: 7, lambda: -0.1, avg21Vol: 24, nextVol: 23,
  sigma2Next: Math.pow(0.23, 2) / 252, persistence: 0.95, grade: 3, why: [], converged: true });
const CLOSES = (() => { const c = [100]; const rng = WORLD.xoshiro128ss("closes"); for (let i = 0; i < 260; i++) c.push(c[c.length - 1] * Math.exp(0.015 * WORLD.normalDraw(rng))); return c; })();

{
  const law = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  eq(law.knots.map((k) => k.h), [1, 2, 3, 5, 10, 21, 42, 63, 126], "a graded GARCH fit is simulated into nine horizons, with knots at 1, 2 and 3 sessions so a weekly is never a power-scaled copy of the 5-session law");
  ok(law.model === "garch" && law.grade === 3, "and is graded");
  for (const k of law.knots) {
    near(DENSITY.lawMean(DENSITY.lawBinned({ S: 1, edges: k.edges, means: k.means })), Math.exp(R * k.h / 252), 1e-9,
      `the ${k.h}-session law is drift-neutral to the risk-free forward`);
  }
  const again = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  eq(JSON.stringify(again), JSON.stringify(law), "the same ticker and session draw the same law, path for path");
  const weak = QP.garchLaw({ garch: { ...GARCH, grade: 1, why: ["garch.not-converged"] }, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R });
  ok(weak.model === "ewma" && weak.grade === 1 && weak.why.includes("model.ewma") && weak.why.includes("garch.not-converged"),
     "an unsettled fit is not simulated: P falls back to EWMA-normal at grade 1 and says why (spec 2.7)");
  const law21 = QC.lawAtSessions(QC.compactLaw(law), { sessions: 17, forwardOverSpot: 1.002, S: SPOT });
  near(DENSITY.lawMean(law21) / SPOT, 1.002, 1e-6, "the compacted law interpolated to 17 sessions is re-shifted to that expiry's forward");
  ok(QC.compactLaw(law).knots.every((k) => k.edges.every((e) => e === null || String(e).replace(/^0\.0*/, "").replace(".", "").length <= 6)),
     "and is stored at five significant digits");
}

{
  const raw = { data: [
    { source: "estimation", report_date: "2026-10-29", report_time: "unknown", post_earnings_move_1d: null, expected_move_perc: null },
    { source: "company", report_date: "2026-07-30", report_time: "postmarket", post_earnings_move_1d: "-0.071", expected_move_perc: "0.05" },
    { source: "company", report_date: "2026-04-30", report_time: "premarket", post_earnings_move_1d: "0.042", expected_move_perc: "0.06" },
    { source: "company", report_date: "2026-01-29", report_time: "postmarket", post_earnings_move_1d: "0.03", expected_move_perc: "0.05" },
  ] };
  const ev = QP.earningsFromVendor(raw, { sessionDate: SESSION });
  eq(ev.mask, ["2026-01-30", "2026-04-30", "2026-07-31"],
     "a postmarket report hits the next session and a premarket one its own day, and those sessions are masked from the GARCH fit");
  eq([ev.next.date, ev.next.latest], ["2026-10-29", "2026-10-30"],
     "an unknown-time upcoming report is dated by the EARLIER of its two possible sessions (a premarket report would hit it), " +
     "so an expiry on the report day is read as holding the event and short premium through it is vetoed; the later session rides beside it");
  const fri = QP.earningsFromVendor({ data: [{ source: "company", report_date: "2026-10-16", report_time: "unknown" }] }, { sessionDate: SESSION });
  eq(fri.next.date, "2026-10-16", "a Friday report of unknown time is on that Friday's expiry, not the Monday after it");
  const pct = QP.earningsFromVendor({ data: raw.data.map((r) => ({ ...r, expected_move_perc: r.expected_move_perc === null ? null : String(100 * Number(r.expected_move_perc)) })) }, { sessionDate: SESSION });
  near(pct.realizedOverImplied, 0.7, 1e-12, "and an expected move quoted in percent is read on the same scale as the realised one");
  eq(ev.next.confirmed, false, "and an estimated date is not confirmed");
  eq(ev.moves, [-0.071, 0.042, 0.03], "the historical one-day moves are kept newest first");
  near(ev.realizedOverImplied, 0.7, 1e-12, "and realised over implied is their median ratio");
}

const FACT_INPUT = () => ({
  built: slices.built, spot: SPOT, atr: 2, asOfDay: SESSION,
  card: {
    strikeSumCrossing: 101.5, regime: { bookGammaRaw: 2e4, bookGamma: 2e6, flowGamma: -4e5 },
    panels: {
      pricedMove: { status: "ok", ivRank: 0.62, rv30: 0.21 },
      levels: { status: "ok", levels: [{ kind: "max_pain", px: 100 }] },
      gamma: { status: "ok", flowPeakLong: 105, flowPeakShort: 95 },
    },
  },
  garch: GARCH, zero: QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2 }),
  book: { callWall: 105, putWall: 95, magnet: 100, putSign: "dealer" },
  event: { date: "2026-10-20", confirmed: true, moves: [0.05, -0.04, 0.06, -0.03, 0.07, -0.05] },
  jump: { J: 0.05, meanAbs: 0.05 * Math.sqrt(2 / Math.PI), why: null },
  crossSection: { rr25Pct: 0.7 },
});

{
  const SD = 0.4, J = 0.05;
  const event = { date: "2026-10-20" };
  const built = sessionWorld(SESSION, ["2026-10-16", "2026-10-23", "2026-11-20"], { sd: SD, jumps: [{ date: event.date, J }] });
  const j = QC.eventJump(built, event);
  near(j.J, J, 1e-6, "the event jump is the first post-event slice's model-free variance above the diffusion the next slice implies, on the session clock (E2)");
  near(j.diffusiveVol, SD, 1e-6, "with the diffusion read off the same two slices");
  near(j.meanAbs, J * Math.sqrt(2 / Math.PI), 1e-6, "and its mean absolute move under the normal convention kept for the strait case");
  eq([j.front, j.back], ["2026-10-23", "2026-11-20"], "read from the two expiries after the event");
  eq(QC.eventJump(sessionWorld(SESSION, ["2026-10-23", "2026-11-20"], { sd: SD }), event).J, null,
     "and a term structure flat in session time prices no jump, which is absent rather than zero");
  eq(QC.eventJump(built.map((e) => ({ ...e, hSessions: undefined })), event).why, "event.clock",
     "an expiry with no session count has no clock and no jump, and says so");
}

{
  const SD = 0.4, J = 0.05;
  const CASES = [
    ["asOf Fri 2026-10-09, event Mon 10-12 pre-open; front Mon 10-12, back Fri 10-16", "2026-10-09", "2026-10-12", "2026-10-12", "2026-10-16", -29.9],
    ["asOf Fri 2026-10-09, event Tue 10-13 pre-open; front Wed 10-14, back Fri 10-16", "2026-10-09", "2026-10-13", "2026-10-14", "2026-10-16", -29.9],
    ["asOf Thu 2026-10-08, event Thu AMC to Fri; front Fri 10-09, back Fri 10-16", "2026-10-08", "2026-10-09", "2026-10-09", "2026-10-16", 3.6],
    ["asOf Wed 2026-10-07, event Thu AMC to Fri; front Fri 10-09, back Fri 10-16", "2026-10-07", "2026-10-09", "2026-10-09", "2026-10-16", 7.0],
    ["asOf Fri 2026-10-09, event Wed AMC to Thu; front Fri 10-16, back Fri 10-23", "2026-10-09", "2026-10-15", "2026-10-16", "2026-10-23", 0],
    ["asOf Fri 2026-10-09, event Tue AMC to Wed; front Wed 10-14, back Fri 10-23", "2026-10-09", "2026-10-14", "2026-10-14", "2026-10-23", -12.0],
    ["asOf Wed 2026-11-25, event Mon 11-30 pre-open, Thanksgiving week; front Mon 11-30, back Fri 12-04", "2026-11-25", "2026-11-30", "2026-11-30", "2026-12-04", -51.2],
  ];
  for (const [label, asOfDay, date, front, back, calendarErr] of CASES) {
    const built = sessionWorld(asOfDay, [front, back], { sd: SD, jumps: [{ date, J }] });
    const got = QC.eventJump(built, { date });
    near(got.J, J, 1e-4, `${label}: the event move is 5.00% on the session clock`);
    near(got.meanAbs, J * Math.sqrt(2 / Math.PI), 1e-4, `and its mean absolute move follows`);
    const cal = SMILE.eventVariance({
      front: { T: built[0].T, vol: Math.sqrt(SMILE.sliceTotalVariance(built[0].slice, 0) / built[0].T) },
      back: { T: built[1].T, vol: Math.sqrt(SMILE.sliceTotalVariance(built[1].slice, 0) / built[1].T) },
    });
    near((cal.eventSd / J - 1) * 100, calendarErr, 0.1, `while the same two slices read on the calendar clock miss by ${calendarErr}% (the negative control)`);
    ok(calendarErr === 0 || Math.abs(cal.eventSd - J) > 0.0005, "which is far outside the +-0.01 point the session clock keeps");
  }
}

{
  const facts = QC.engineFacts(FACT_INPUT());
  const ids = facts.map((f) => f.id);
  eq(ids.length, new Set(ids).size, "every fact id is unique");
  ok(facts.every((f) => QC.FACT_UNITS.includes(f.u)), "every fact carries a unit from the published enum");
  ok(facts.every((f) => Number.isInteger(f.g) && f.g >= 0 && f.g <= 3), "every grade is on the 0-3 robustness scale");
  ok(facts.every((f) => f.v !== null || (f.g === 0 && typeof f.why === "string")), "a fact with no value is withheld with a code, never a zero");
  ok(facts.every((f) => typeof f.why !== "string" || !/\s/.test(f.why)), "a reason is a code, never prose");
  const by = Object.fromEntries(facts.map((f) => [f.id, f]));
  ok(by["vrp.trailing.21"].g === 1 && by["vrp.trailing.21"].why === "vrp.trailing-rv",
     "the VRP against trailing realised is published graded weak and says so (defect 7)");
  const cm30 = QC.constantMaturity(slices.built, 30);
  const exW = (e) => SMILE.sliceTotalVariance(e.slice, 0) - (e.expiry >= "2026-10-20" ? 0.05 * 0.05 : 0);
  const lo30 = { tau: cm30.lo.hSessions / 252, w: exW(cm30.lo) }, hi30 = { tau: cm30.hi.hSessions / 252, w: exW(cm30.hi) };
  ok(cm30.lo.expiry < "2026-10-20" && cm30.hi.expiry >= "2026-10-20", "the fixture's thirty-day point sits between a slice before the event and one after it");
  const ivEx = Math.sqrt((lo30.w + (cm30.tau - lo30.tau) / (hi30.tau - lo30.tau) * (hi30.w - lo30.w)) / (30 / 365));
  near(by["vrp.rel.21"].v, (ivEx - 0.24) / 0.24, 1e-3,
    "while vrp.rel.21 is implied against the GARCH forward, ex-event on the implied side: the jump comes out of each slice that holds it, then the thirty-day point is interpolated (D4, W06-P10)");
  near(by["vrp.var.21"].v, ivEx * ivEx - 0.24 * 0.24, 1e-4, "and in variance terms");
  ok(by["level.putWall"].v <= SPOT && by["level.callWall"].v >= SPOT, "walls in the facts are the book's");
  eq(by["level.strikeSumCrossing"].v, 101.5, "and the strike-sum crossing rides under its own id beside level.flip");
  ok(by["skew.rr25.30.pct"].x === true, "a cross-sectional percentile is tagged x");
  ok(by["move.event"].v > 0 && by["move.event.ratio"].v > 0, "an event between two fitted slices yields an implied jump and its ratio to history");
  eq([by["gex.book"].v, by["gex.book"].u, by["gex.book"].g], [2e6, "usdPer1pct", 2],
     "gex.book is the card's dollar book per 1%, the figure the ticker tile prints, graded fair at most: the dealer sign it rests on is a convention (UW-F5)");
  {
    const rawOnly = FACT_INPUT();
    rawOnly.card.regime = { bookGammaRaw: 2e4, flowGamma: -4e5 };
    const gb = QC.engineFacts(rawOnly).find((f) => f.id === "gex.book");
    ok(gb.v === null && gb.g === 0 && gb.why === "book.no-spot",
       "UW-F3: with no dollar book (no spot) gex.book is withheld as book.no-spot, where it published the raw share-gamma under the usdPer1pct unit");
    const none = FACT_INPUT();
    none.card.regime = { flowGamma: -4e5 };
    ok(QC.engineFacts(none).find((f) => f.id === "gex.book").why === "book.absent", "and a card with no book at all stays book.absent");
  }
  {
    const input = FACT_INPUT();
    const at = input.zero.atSpot;
    ok(Number.isFinite(at) && at !== 0, `the profile publishes its dealer gamma at spot (${at})`);
    const agree = QC.engineFacts({ ...input, card: { ...input.card, regime: { ...input.card.regime, bookGamma: Math.sign(at) * 2e6 } } }).find((f) => f.id === "level.flip");
    const clash = QC.engineFacts({ ...input, card: { ...input.card, regime: { ...input.card.regime, bookGamma: -Math.sign(at) * 2e6 } } });
    const cf = clash.find((f) => f.id === "level.flip");
    {
      const capped = FACT_INPUT();
      capped.zero = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: grossOfBuilt() / 0.95 });
      ok(capped.zero.coverage >= 0.85 && capped.zero.g === 2 && capped.zero.why === "flip.convention", "a real good-coverage zeroGammaOf result is the engineFacts input below");
      const facts = QC.engineFacts(capped);
      const flip = facts.find((f) => f.id === "level.flip"), count = facts.find((f) => f.id === "level.flip.count");
      ok(flip.g === 2 && flip.why === "flip.convention" && count.g === 2, `engineFacts carries the capped grade to level.flip (g ${flip.g}, ${flip.why}) and level.flip.count (g ${count.g})`);
    }
    {
      const raised = FACT_INPUT();
      raised.zero = { ...raised.zero, g: 3, why: null };
      const rf = QC.engineFacts(raised).find((f) => f.id === "level.flip");
      ok(rf.g <= 2, `engineFacts holds a flip handed in at grade 3 to the cap (g ${rf.g})`);
    }
    ok(agree.g === input.zero.g && agree.why === (input.zero.why || undefined), "a book whose sign agrees with the profile at spot leaves the flip's grade as the coverage set it");
    ok(cf.g === 1 && cf.why === "flip.sign-at-spot" && clash.find((f) => f.id === "level.flip.count").g <= 1,
       `UW-F9: a book the opposite sign of our own profile at spot caps the flip at grade 1 and says flip.sign-at-spot (g ${cf.g}, ${cf.why})`);
    const painThin = FACT_INPUT();
    painThin.card.panels.levels.levels = [{ kind: "max_pain", px: 100, expiry: "2026-09-25", share: 0.05, thin: true, line: 0.25 }];
    const pf = QC.engineFacts(painThin).find((f) => f.id === "level.maxPain");
    ok(pf.g === 1 && pf.why === "pain.thin-expiry" && by["level.maxPain"].g === 2,
       "UW-F13: max pain read off an expiry that holds a sliver of the book is graded 1 with pain.thin-expiry, where a full one stays 2");
  }
  const degenerate = QC.engineFacts({ ...FACT_INPUT(), garch: { ...GARCH, grade: 2, why: ["garch.alpha-degenerate"] } });
  const dg = Object.fromEntries(degenerate.map((f) => [f.id, f]));
  ok(dg["garch.avg.21"].g === 2 && dg["garch.avg.21"].why === "garch.alpha-degenerate" && dg["vrp.rel.21"].g <= 2,
     "a degenerate GARCH grades its forecast and every VRP built on it at most 2, naming the reason (defect 6)");
}

{
  const withVol = (vol, extra = {}) => {
    const input = FACT_INPUT();
    input.card = { ...input.card, x: { vol } };
    return QC.engineFacts({ ...input, ...extra });
  };
  const get = (facts, id) => facts.find((f) => f.id === id);
  const FLOORED = { v: 1, iv30Pct: 0.698, iv30: 0.3 };

  const real = withVol(FLOORED, { coneThin: false });
  const pf = get(real, "iv.pctile.30.1y");
  eq([pf.v, pf.u, pf.g, "why" in pf], [0.698, "frac", 2, false], "W06-P1(a): the cone's one-year percentile is published as iv.pctile.30.1y, a fraction graded 2 on a full cone");
  eq(get(real, "iv.rank.1y").v, 0.62, "and the rank rides under its own id at the pricedMove value");
  eq(get(real, "iv.pct.30"), undefined, "P1-41: iv.pct.30 is no longer emitted, with a rank or without one");
  eq(get(withVol(FLOORED, { coneThin: false }), "iv.pct.30"), undefined, "so the rank has one id and the percentile another");
  ok(pf.v !== get(real, "iv.rank.1y").v, "a rank of 0.62 and a percentile of 0.698 are two facts, never one value under two ids");
  const low = withVol(FLOORED, { coneThin: true });
  eq([get(low, "iv.pctile.30.1y").v, get(low, "iv.pctile.30.1y").g], [0.698, 1], "a cone the leg flagged thin (under its 200-sample floor) is graded 1, the same value");
  eq(get(withVol(FLOORED), "iv.pctile.30.1y").g, 2, "and an unknown sample count is not guessed thin");
  eq(get(withVol(FLOORED, { coneThin: null }), "iv.pctile.30.1y").g, 2, "nor is an explicit null");
  for (const [label, facts] of [
    ["a card with no x block", QC.engineFacts(FACT_INPUT())],
    ["a vol summary the leg marked unavailable", withVol({ v: 1, status: "unavailable", code: "read-failed" })],
    ["a cone that carried no percentile", withVol({ v: 1, iv30Pct: null })],
    ["a percentile above one", withVol({ v: 1, iv30Pct: 70 })],
    ["a negative percentile", withVol({ v: 1, iv30Pct: -0.1 })],
    ["a non-numeric percentile", withVol({ v: 1, iv30Pct: "0.7" })],
  ]) {
    const f = get(facts, "iv.pctile.30.1y");
    eq([f.v, f.g, f.why, f.u], [null, 0, "iv.pctile-absent", "frac"], `${label}: the percentile is withheld as iv.pctile-absent, and the rank is never put in its place`);
  }
  eq(get(withVol(FLOORED), "iv.pctile.30.1y").v, 0.698, "a percentile of exactly the cone's value is kept to four places");
  eq([get(withVol({ v: 1, iv30Pct: 0 }), "iv.pctile.30.1y").v, get(withVol({ v: 1, iv30Pct: 1 }), "iv.pctile.30.1y").v], [0, 1], "and both ends of the unit interval are values, not absences");
  const sizeWith = JSON.stringify(real).length, sizeWithout = JSON.stringify(real.filter((f) => f.id !== "iv.pctile.30.1y")).length;
  ok(sizeWith - sizeWithout > 30 && sizeWith - sizeWithout < 90, `the fact costs about sixty bytes a card (${sizeWith - sizeWithout})`);
  {
    const bucketOf = (facts) => bucketsOf(Object.fromEntries(facts.map((f) => [f.id, f])), "A").iv;
    eq(bucketOf([{ id: "iv.rank.1y", v: 0.07, g: 2 }, { id: "iv.pctile.30.1y", v: 0.7, g: 2 }]), { bucket: "mid", g: 2 },
      "P0-35: a rank of 0.07 with a percentile of 0.70 buckets mid, not low: the IV axis is read from the percentile");
    eq(bucketOf([{ id: "iv.rank.1y", v: 0.9, g: 2 }, { id: "iv.pctile.30.1y", v: 0.1, g: 1 }]), { bucket: "low", g: 1 },
      "and a rank of 0.90 with a percentile of 0.10 buckets low, at the percentile's own grade");
    eq(bucketOf([{ id: "iv.rank.1y", v: 0.9, g: 2 }]), { bucket: null, g: 0 },
      "a card with a rank and no percentile has no IV bucket: the rank is never put in its place");
    eq(bucketOf([{ id: "iv.pctile.30.1y", v: null, g: 0 }, { id: "iv.rank.1y", v: 0.9, g: 2 }]), { bucket: null, g: 0 },
      "nor does one whose percentile is withheld");
    eq([0.2499, 0.25, 0.5, 0.75, 0.7501].map((v) => bucketOf([{ id: "iv.pctile.30.1y", v, g: 2 }]).bucket), ["low", "mid", "mid", "mid", "high"],
      "the buckets keep the lines 0.25 and 0.75, inclusive on the mid side");
    eq([BUCKET_LINES.IV_LOW, BUCKET_LINES.IV_HIGH], [0.25, 0.75], "which are the lines the reading and the screen tier apply to a real percentile");
    const withRank = withVol({ v: 1, iv30Pct: 0.7 }, { coneThin: false });
    ok(get(withRank, "iv.pctile.30.1y").v === 0.7, "and the card's fact the bucket reads is the cone's percentile");
  }
}

{
  const sd2 = 0.16, J = 0.05, beta = 0.02;
  const world = (days, post, extra = () => 0) => days.map((d, i) => {
    const tau = d / 252;
    return { tau, w: (sd2 * tau + beta * tau * tau + (post[i] ? J * J : 0)) * (1 + extra(i)), post: post[i] };
  });
  const three = SMILE.eventTermFit(world([4, 16, 60], [false, true, true]));
  near(three.beta / beta, 1, 0.01, "a planted curvature beta is recovered to 1% on three expiries, one of them before the event");
  near(three.J / J, 1, 0.01, "with the event on its own at the same 1%");
  near(three.sigma2 / sd2, 1, 0.01, "and the diffusion");
  eq([three.n, three.k, three.dof, three.exact, three.seJ], [3, 3, 0, true, null], "three expiries and three unknowns leave no degree of freedom, so no standard error is claimed");
  const noBeta = SMILE.eventTermFit(world([4, 16, 60], [false, true, true]).map((p) => ({ ...p, w: p.w - beta * p.tau * p.tau })));
  near(noBeta.beta, 0, 1e-9, "with no curvature planted the fitted curvature is nil");
  const two = SMILE.eventTermFit(world([5, 10], [true, true], () => 0).map((p) => ({ ...p, w: sd2 * p.tau + J * J })));
  const old = SMILE.eventVariance({ front: { T: 5 / 252, vol: Math.sqrt((sd2 * 5 / 252 + J * J) * 252 / 5) }, back: { T: 10 / 252, vol: Math.sqrt((sd2 * 10 / 252 + J * J) * 252 / 10) } });
  near(two.J, old.eventSd, 1e-12, "two expiries reproduce the two-slice estimator exactly");
  near(two.sigma, old.diffusiveVol, 1e-12, "diffusion included");
  eq([two.beta, two.dof, two.exact], [null, 0, true], "with no curvature term and no spare degree of freedom");
  const rng = WORLD.xoshiro128ss("event-term");
  const days = [3, 8, 15, 22, 36, 64];
  const post = [false, false, true, true, true, true];
  let inside = 0, runs = 200, seen = 0;
  for (let r = 0; r < runs; r++) {
    const fit = SMILE.eventTermFit(world(days, post, () => 0.004 * WORLD.normalDraw(rng)));
    if (fit.seJ2 === null) continue;
    seen++;
    if (Math.abs(fit.J2 - J * J) <= 3.182 * fit.seJ2) inside++;
  }
  ok(seen === runs && inside / runs > 0.92 && inside / runs < 1, `with 0.4% noise on six expiries the 95% band on J^2 (Student t on its three degrees of freedom) holds ${inside} of ${runs} runs`);
  const fit6 = SMILE.eventTermFit(world(days, post, () => 0));
  ok(fit6.dof === 3 && fit6.seJ2 !== null && fit6.seJ2 < 1e-9 && fit6.resid < 1e-12, "and an exact world gives a nil residual and a nil standard error on three degrees of freedom");
  const bent = SMILE.eventTermFit(world(days, post, (i) => (i === 3 ? 0.08 : 0)));
  ok(bent.resid > QC.QUANT_CARD_LINES.EVENT_FIT_RESID && bent.seJ2 > fit6.seJ2, "an expiry 8% off the line shows in the residual and widens the standard error");
  eq(SMILE.eventTermFit(world([5, 10], [true, true]).map((p) => ({ ...p, w: sd2 * p.tau }))).why, "event.no-premium", "no variance above the diffusion is no premium, absent and not zero");
  eq(SMILE.eventTermFit([{ tau: 5 / 252, w: 0.02, post: true }, { tau: 10 / 252, w: 0.015, post: true }]).why, "event.inverted", "a back expiry with less variance than the front is inverted");
  eq(SMILE.eventTermFit([{ tau: 5 / 252, w: 0.02, post: false }, { tau: 10 / 252, w: 0.03, post: false }]).why, "event.slices", "no expiry holding the event is no fit");
  eq(SMILE.eventTermFit([{ tau: 5 / 252, w: 0.02, post: true }]).why, "event.slices", "and one expiry alone is none either");
  const lone = SMILE.eventTermFit([{ tau: 4 / 252, w: sd2 * 4 / 252, post: false }, { tau: 9 / 252, w: sd2 * 9 / 252 + J * J, post: true }]);
  near(lone.J, J, 1e-12, "a single expiry after the event is enough when one before it fixes the diffusion");
}

{
  const T = 30 / 365;
  const flat = { method: "flat", T, F: 100, D: 1, params: { sigma: 0.35 } };
  const mf = DENSITY.modelFreeWindow(flat);
  near(mf.w / (0.35 * 0.35 * T), 1, 1e-6, "the model-free variance of a flat smile is its total variance, inside the 1e-6 quantile window");
  ok(mf.eps === 1e-6 && mf.range[0] < -0.4 && mf.range[1] > 0.4, "and the window is the one-in-a-million quantiles of the slice's own law");
  const svi = { method: "svi", T, F: 100, D: 1, params: SVI };
  const m = DENSITY.rndMoments(svi);
  near(DENSITY.modelFreeWindow(svi).w, -2 * m.meanLog, 1e-6, "a skewed smile's model-free variance is minus twice the mean log return of its own density");
  ok(DENSITY.modelFreeWindow(svi).w > SMILE.sliceTotalVariance(svi, 0), "which exceeds the at-the-money variance the smile's wings add to");
  const mix = SMILE.mixturePrice({ F: 100, T, diffusiveVol: 0.3, up: Math.exp(0.08 - Math.log(Math.cosh(0.08))), down: Math.exp(-0.08 - Math.log(Math.cosh(0.08))), weights: [0.5, 0.5] }).slice;
  near(DENSITY.modelFreeWindow(mix).w, 0.3 * 0.3 * T + 2 * Math.log(Math.cosh(0.08)), 1e-6, "and a two-point event on a diffusion adds exactly its log-contract variance, 2 ln cosh J");
  eq(DENSITY.modelFreeWindow(flat, { eps: 0.7 }), null, "a window that is not a window is nothing");
}

{
  const normInv = (p) => BS.normInv(p);
  const t5cdf = (t) => { const th = Math.atan(t / Math.sqrt(5)); return 0.5 + (th + Math.sin(th) * (Math.cos(th) + 2 / 3 * Math.pow(Math.cos(th), 3))) / Math.PI; };
  const t5inv = (u) => { let lo = -80, hi = 80; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (t5cdf(mid) < u) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const N = 160;
  const us = Array.from({ length: N }, (_, i) => (i + 0.5) / N);
  const unit = {
    gaussian: us.map((u) => normInv(u)),
    laplace: us.map((u) => -Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5)) / Math.SQRT2),
    t5: us.map((u) => t5inv(u) / Math.sqrt(5 / 3)),
  };
  const nodesOf = (law, sd) => {
    if (law === "twoPoint") return [[-sd, 0.5], [sd, 0.5]];
    if (law === "skewCrash") { const p = 0.25; return [[-sd * Math.sqrt((1 - p) / p), p], [sd * Math.sqrt(p / (1 - p)), 1 - p]]; }
    return unit[law].map((y) => [sd * y, 1 / N]);
  };
  const mgfLog = (nodes) => Math.log(nodes.reduce((a, [y, w]) => a + w * Math.exp(y), 0));
  const sdForJ = (law, J2) => { let lo = 1e-4, hi = 1; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (2 * mgfLog(nodesOf(law, mid)) < J2) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const sliceOf = (nodes, tau, sigmaD) => {
    const m = mgfLog(nodes);
    return { method: "mixture", T: tau, F: 100, D: 1, params: { components: nodes.map(([y, w]) => ({ f: Math.exp(y - m), w })), sigmaD } };
  };
  const SIGMA = 0.35;
  const MJ_BANDS = { gaussian: [-0.5, 0.5], twoPoint: [-0.5, 0.5], laplace: [-5.5, 0.5], t5: [-9.5, 0.5], skewCrash: [-5.5, 0.5] };
  const IDENT = { gaussian: [], laplace: [], t5: [], twoPoint: [], skewCrash: [] };
  const bands = { gaussian: [-0.6, 0.6], laplace: [-12, -2], t5: [-9, -2], twoPoint: [3, 27], skewCrash: [-2, 3] };
  const ATM = { gaussian: [], laplace: [], t5: [], twoPoint: [], skewCrash: [] };
  let worst = 0, cases = 0;
  for (const law of Object.keys(bands)) {
    for (const Jt of [0.03, 0.05, 0.08, 0.12]) {
      for (const [d1, d2] of [[2, 9], [6, 13], [3, 31]]) {
        const nodes = nodesOf(law, sdForJ(law, Jt * Jt));
        const truth = Math.sqrt(2 * mgfLog(nodes));
        const t1 = d1 / 252, t2 = d2 / 252;
        const s1 = sliceOf(nodes, t1, SIGMA), s2 = sliceOf(nodes, t2, SIGMA);
        const mk = (slice, d, expiry) => ({ expiry, T: d / 365, dte: d, sessions: d, hSessions: d, rows: [], slice });
        const built = [mk(s1, d1, "2026-10-23"), mk(s2, d2, "2026-11-20")];
        const got = QC.eventJump(built, { date: "2026-10-20" });
        const err = (got.J / truth - 1) * 100;
        worst = Math.max(worst, Math.abs(err));
        cases++;
        const atm = SMILE.eventVariance({ front: { T: t1, vol: SMILE.sliceVolK(s1, 0) }, back: { T: t2, vol: SMILE.sliceVolK(s2, 0) } });
        ATM[law].push((atm.eventSd / truth - 1) * 100);
        ok(Math.abs(err) < 0.5, `${law} J=${Jt} ${d1}/${d2}: the model-free event size is within 0.5% of the law's log-contract size (${err.toFixed(3)}%)`);
        near(got.diffusiveVol, SIGMA, 2e-4, `${law} J=${Jt} ${d1}/${d2}: and the diffusion is the one planted`);
        const m = mgfLog(nodes);
        const trueM = nodes.reduce((a, [y, w]) => a + w * Math.abs(Math.exp(y - m) - 1), 0);
        const gate = truth * truth >= SIGMA * SIGMA * t1;
        const label = `${law} J=${Jt} ${d1}/${d2}`;
        eq(got.shapeWhy === null, gate, `${label}: the shape is identified exactly where the event variance reaches the front's diffusion variance (${(truth * truth / (SIGMA * SIGMA * t1)).toFixed(2)})`);
        const mErr = (got.meanAbs / trueM - 1) * 100;
        if (gate) {
          const [blo, bhi] = MJ_BANDS[law];
          ok(mErr >= blo && mErr <= bhi, `${label}: the identified mean absolute event move is inside the measured band ${blo} to ${bhi}% (${mErr.toFixed(2)}%)`);
          near(got.kappa, got.meanAbs / got.J, 1e-9, `${label}: and kappa_J is that move over J_MF`);
          const mutant = (Math.sqrt(2 / Math.PI) * truth / trueM - 1) * 100;
          if (law === "laplace" || law === "twoPoint") ok(mutant < blo || mutant > bhi, `${label}: the mutant that keeps sqrt(2/pi) J_MF where the shape is identified misses by ${mutant.toFixed(1)}%, outside the band`);
          IDENT[law].push(mErr);
        } else {
          near(got.meanAbs, Math.sqrt(2 / Math.PI) * got.J, 1e-12, `${label}: where it is not, the move is the normal convention on J_MF`);
          eq([got.kappa, got.shape, got.shapeWhy], [null, null, "event.shape-unidentified"], `${label}: and says so, with no kappa`);
          const f = Object.fromEntries(QC.engineFacts({ ...FACT_INPUT(), built, zero: null, event: { date: "2026-10-20", confirmed: true, moves: [0.05, -0.04, 0.06] }, jump: got }).map((x) => [x.id, x]));
          eq([f["move.event"].g <= 1, f["move.event"].why], [true, "event.shape-unidentified"], `${label}: the fact is graded at most 1 and carries the code`);
        }
      }
    }
  }
  ok(cases === 60 && worst < 0.5, `all ${cases} cases of the five-law grid hold J_MF within 0.5% (worst ${worst.toFixed(3)}%)`);
  for (const [law, [lo, hi]] of Object.entries(bands)) {
    const r = ATM[law];
    ok(r.every((e) => e >= lo && e <= hi), `negative control, ${law}: the at-the-money two-slice estimator misses by ${Math.min(...r).toFixed(1)} to ${Math.max(...r).toFixed(1)}% (band ${lo} to ${hi})`);
  }
  for (const law of Object.keys(IDENT)) ok(IDENT[law].length >= 3, `${law}: the shape is identified on ${IDENT[law].length} of the 12 cases, the mean absolute move off by ${Math.min(...IDENT[law]).toFixed(2)} to ${Math.max(...IDENT[law]).toFixed(2)}%`);
  ok(Math.max(...ATM.twoPoint) > 15 && Math.min(...ATM.laplace) < -9, "the at-the-money error is large where the event is far from normal, which is the error the model-free size removes");
}

{
  const T1 = 4 / 252, T2 = 12 / 252, SIGMA = 0.3;
  const comps = (pts) => { const m = Math.log(pts.reduce((a, [y, w]) => a + w * Math.exp(y), 0)); return { m, parts: pts.map(([y, w]) => ({ f: Math.exp(y - m), w })) }; };
  const entry = (slice, d, expiry) => ({ expiry, T: d / 365, dte: d, sessions: d, hSessions: d, rows: [], slice });
  const pre = (d) => entry({ method: "flat", T: d / 252, F: 100, D: 1, params: { sigma: SIGMA } }, d, "2026-10-16");
  const withEvent = (pts) => {
    const { parts } = comps(pts);
    const mk = (d, expiry) => entry({ method: "mixture", T: d / 252, F: 100, D: 1, params: { components: parts, sigmaD: SIGMA } }, d, expiry);
    return [pre(2), mk(4, "2026-10-23"), mk(12, "2026-11-20")];
  };
  const skew = [[-0.12 * Math.sqrt(3), 0.25], [0.12 / Math.sqrt(3), 0.75]];
  const sym = Array.from({ length: 64 }, (_, i) => [0.12 * BS.normInv((i + 0.5) / 64), 1 / 64]);
  const third = (pts) => { const mu = pts.reduce((a, [y, w]) => a + w * y, 0); return pts.reduce((a, [y, w]) => a + w * Math.pow(y - mu, 3), 0); };
  const gs = withEvent(skew), gy = withEvent(sym);
  const ev = { date: "2026-10-20" };
  const js = QC.eventJump(gs, ev), jy = QC.eventJump(gy, ev);
  ok(third(skew) < 0 && js.k3 < 0, "a crash-skewed event shows a negative risk-neutral third cumulant");
  near(js.k3 / third(skew), 1, 0.02, "which is the planted third cumulant of the event to 2%, the pre-event slice taken off the post-event one");
  near(jy.k3, 0, 1e-6, "while a symmetric event of the same size has none, which kappa_J alone cannot show");
  ok(js.kappa !== null && jy.kappa !== null && Math.abs(js.kappa - jy.kappa) < 0.05, `the skewed law's kappa_J (${js.kappa}) is close to the normal one's (${jy.kappa}), so only the cumulant tells them apart`);
  eq(QC.eventJump(gs.slice(1), ev).k3, null, "with no slice before the event the third cumulant is absent, not zero");
  const em = QC.engineEvent({ date: "2026-10-20", confirmed: true, moves: [0.05] }, js, QC.engineFacts({ ...FACT_INPUT(), built: gs, event: { date: ev.date, moves: [0.05, 0.04, 0.06] }, jump: js, zero: null }));
  ok(em.k3 === Number(js.k3.toPrecision(3)) && (em.kappa === null || em.kappa === Number(js.kappa.toFixed(3))), "and the card's event block carries it with kappa_J and the shape");
}

{
  const facts = QC.engineFacts(FACT_INPUT());
  const law = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  const state = { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich };
  const block0 = QC.runCardEngine({ ticker: "SYN", asOfMs: AS_OF_MS, spot: SPOT, rate: RATE, expiries: slices.input, facts, state, pLaw: law,
    levels: { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 }, event: null, atr: 2 });
  const exp = block0.expiries;
  ok(exp.length === 5 && exp.every((e) => Array.isArray(e.smile.kq) && e.smile.kq.length === 2 && e.smile.kq[0] < 0 && e.smile.kq[1] > 0),
     "every published expiry carries kq, the log-moneyness span of the strikes that were quoted, and the page hatches the law outside it");
  ok(exp.every((e) => { const b = slices.built.find((x) => x.expiry === e.expiry).slice; return e.smile.kq[0] === Number(b.kMin.toFixed(3)) && e.smile.kq[1] === Number(b.kMax.toFixed(3)); }),
     "kq is the fitted slice's own span to three decimals");
  eq(exp[0].smile.cal, null, "the first expiry has nothing before it to be checked against, so its calendar result is null");
  ok(exp.slice(1).every((e) => e.smile.cal === 1), "and each later one carries the calendar no-arbitrage result against the one before: 1 when it holds");
  const bytes = JSON.stringify(exp.map((e) => ({ kq: e.smile.kq, cal: e.smile.cal }))).length;
  ok(bytes < 260, `which costs ${bytes} bytes on a five-expiry card`);
}

{
  const ratioOf = (J, n, rng) => {
    const hist = Array.from({ length: n }, () => Math.abs(J * WORLD.normalDraw(rng))).sort((a, b) => a - b);
    const med = n % 2 ? hist[(n - 1) / 2] : (hist[n / 2 - 1] + hist[n / 2]) / 2;
    return (J * Math.sqrt(2 / Math.PI)) / med;
  };
  const rng = WORLD.xoshiro128ss("fair-event");
  for (const n of [6, 8, 12]) {
    const ratios = Array.from({ length: 4000 }, () => ratioOf(0.06, n, rng));
    const over = ratios.filter((r) => r >= 1.25).length / ratios.length;
    ok(over > 0.3 && over < 0.9, `under fair pricing and ${n} past moves the retired 1.25 line called the event overpriced ${(over * 100).toFixed(0)}% of the time`);
    ok(ratios.every((r) => eventBucket({ date: "2026-10-20", after: "2026-09-21", ratio: r, g: 2 }, "2026-10-23").bucket === "fair"),
       `and the engine's bucket for all ${ratios.length} of them is fair: an implied mean over a historical median is not a price test`);
  }
  near(Math.sqrt(2 / Math.PI) / 0.6744897501960817, 1.183, 1e-3, "because the ratio of a normal's mean absolute move to its median absolute move is 1.183 before any sampling noise");
  eq(eventBucket({ date: "2026-10-20", after: "2026-09-21", ratio: 0.5 }, "2026-10-23").bucket, "fair", "and a ratio of 0.5 is not called underpriced either");
  eq(eventBucket({ date: "2026-10-30", after: "2026-09-21", ratio: 3 }, "2026-10-23"), { bucket: "none", g: 3, inside: false }, "an event after the expiry is no event for it, as before");
  ok(!("EVENT_UNDER" in BUCKET_LINES) && !("EVENT_OVER" in BUCKET_LINES), "and the 0.8 and 1.25 lines are gone from the published bucket lines");
}

{
  const SD = 0.3, J = 0.06, AVG = GARCH.avg21Vol / 100;
  const dayAt = (d) => new Date(Date.parse(SESSION + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);
  const slice = (d, ev) => sessionWorld(SESSION, [dayAt(d)], { sd: SD, jumps: [{ date: dayAt(ev), J }] })[0];
  const tauAt = (days) => TIME.sessionsBetween(SESSION, dayAt(days)) / TIME.SESSIONS_PER_YEAR;
  const displayVol = (days) => Math.sqrt(SD * SD * tauAt(days) / (days / 365));
  const CASES = [
    ["A, interior, the event between the slices and before thirty days", [21, 49], 25],
    ["B, interior, the event between the slices and after thirty days", [21, 49], 35],
    ["C, one 21-day slice that holds the event", [21], 10],
    ["C, one 21-day slice, the event after it and inside thirty days", [21], 25],
    ["C, one 40-day slice that holds the event", [40], 10],
    ["C, one 40-day slice, the event after thirty days and inside it", [40], 35],
  ];
  for (const [label, days, ev] of CASES) {
    const built = days.map((d) => slice(d, ev));
    const event = { date: dayAt(ev), confirmed: true, moves: [0.05, -0.04, 0.06, -0.03, 0.07, -0.05] };
    const cm = QC.constantMaturity(built, 30, { date: event.date, J2: J * J });
    near(cm.w, SD * SD * tauAt(30), 1e-12, `W06-P10 case ${label}: the thirty-day ex-event total variance is the diffusion's on the session clock, exactly`);
    near(cm.vol, displayVol(30), 1e-12, `and its ACT/365 display vol is that variance over 30/365`);
    const by = Object.fromEntries(QC.engineFacts({ ...FACT_INPUT(), built, zero: null, event, jump: { J, meanAbs: J * Math.sqrt(2 / Math.PI), why: null } })
      .map((f) => [f.id, f]));
    near(by["vrp.vol.21"].v + AVG, displayVol(30), 1e-4, `and vrp.vol.21 is read against it in case ${label}`);
    near(Math.sqrt(by["vrp.var.21"].v + AVG * AVG), displayVol(30), 1e-4, `as is vrp.var.21 in case ${label}`);
    ok(by["vrp.vol.21"].why === undefined, `with no vrp.event-inside code once the jump is removed in case ${label}`);
    if (days.length === 2) {
      near(by["term.slope.30_90.exEvent"].v, displayVol(30) / displayVol(90) - 1, 1.5e-4,
        `and the ex-event term slope of a flat session diffusion is the display convention's alone in case ${label} (${by["term.slope.30_90.exEvent"].v})`);
    }
  }
  const built = [slice(21, 35), slice(49, 35)];
  const raw = QC.constantMaturity(built, 30), none = QC.constantMaturity(built, 30, null);
  eq([none.vol, none.w], [raw.vol, raw.w], "with no event to remove the constant maturity is the market's own, event included");
  ok(raw.vol > displayVol(30) + 1e-3, `and iv.cm.30 still carries the share of the jump the interpolation holds (${raw.vol})`);
  const far = QC.constantMaturity([slice(21, 200), slice(49, 200)], 30, { date: dayAt(200), J2: J * J });
  near(far.vol, displayVol(30), 1e-12, "an event after every slice the point reads removes nothing");
  const dayShift = QC.constantMaturity(built, 30, null);
  ok(dayShift.tau === tauAt(30), "the point sits at the session count of the thirty calendar days, not at thirty over 365");
}

{
  const facts = QC.engineFacts(FACT_INPUT());
  const law = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  const state = { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich };
  const levels = { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 };
  const input = { ticker: "SYN", asOfMs: AS_OF_MS, spot: SPOT, rate: RATE, expiries: slices.input, facts, state, pLaw: law, levels, event: null, atr: 2 };
  const block = QC.runCardEngine(input);
  const direct = ENGINE.runEngine({ ticker: "SYN", asOf: AS_OF_MS, spot: SPOT, rate: R, rateMethod: RATE.method, expiries: slices.input, facts: QC.factMap(facts),
    state: QC.engineState(state), pLaw: law, levels, curves: false });
  const byId = new Map(direct.structures.map((s) => [s.id, s]));
  ok(block.structures.length >= 1 && block.structures.length <= QC.QUANT_CARD_LINES.PUBLISH_STRUCTURES,
     `the card publishes ${block.structures.length} priced structures of ${block.priced}`);
  ok(block.structures.every((s) => JSON.stringify(s) === JSON.stringify(byId.get(s.id))),
     "each is the engine's own structure object, byte for byte, which is what the Worker route returns as well");
  eq(block.ideas, direct.ideas, "with the engine's ranking");
  ok(block.ideas.every((id) => block.structures.some((s) => s.id === id)), "and every idea id resolves to a published structure");
  eq(JSON.stringify(QC.runCardEngine(input)), JSON.stringify(block), "the block is byte-identical on a rerun");
  ok(block.pLaw && block.pLaw.knots.length === 9 && QC.runCardEngine({ ...input, publishLaw: false }).pLaw === null,
     "the law rides the card and is left off when the caller already holds it");
  for (const rank of [undefined, "v1", "nope"]) eq(JSON.stringify(QC.runCardEngine({ ...input, rank })), JSON.stringify(block), `the card block under rank ${JSON.stringify(rank)} is the block it always was`);
  const ranked = QC.runCardEngine({ ...input, rank: "v2" });
  eq(ranked.rank, "v2", "rank v2 is carried onto the card block");
  ok(!("rank" in block), "and the v1 block has no rank field");
  ok(ranked.structures.length > 0 && ranked.structures.every((s) => s.scoreRaw !== undefined && s.rankV2 && s.rankV2.sessions >= 1), "whose published structures carry scoreRaw and the basis of their v2 score");
  ok(ranked.structures.every((s) => block.structures.every((o) => o.id !== s.id || o.score === s.scoreRaw)), "scoreRaw is the score the v1 block publishes for the same structure");
  {
    const prep = { built: slices.built, input: slices.input, asOfMs: AS_OF_MS, zero: QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2 }) };
    const nightly = () => QP.engineBlock({ ticker: "SYN", sessionDate: SESSION, spot: SPOT, atr: 2, card: {}, prep, rate: RATE, garch: GARCH, law, event: null, state, strikes: [] });
    const was = process.env.FLOWS_RANK;
    try {
      delete process.env.FLOWS_RANK;
      const off = nightly();
      process.env.FLOWS_RANK = "v2";
      const on = nightly();
      process.env.FLOWS_RANK = "true";
      const stray = nightly();
      ok(!("rank" in off) && !("rank" in stray) && JSON.stringify(off) === JSON.stringify(stray), "the nightly's engine block is v1 unless FLOWS_RANK is exactly v2");
      eq(on.rank, "v2", "and with FLOWS_RANK=v2 it publishes the v2 ranking and says so");
    } finally {
      if (was === undefined) delete process.env.FLOWS_RANK; else process.env.FLOWS_RANK = was;
    }
  }

  const idea = block.structures.find((s) => new Set(s.legs.map((l) => l.expiry)).size === 1);
  ok(idea, "the published set holds a single-expiry structure for the re-pricer to reproduce");
  {
    const re = QC.repriceStructure({ engine: block, legs: idea.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty })),
      expiry: idea.expiry, cost: idea.price.fill });
    near(re.popQ, idea.prob.popQ, 1e-4, `the browser re-pricer reproduces ${idea.id}'s risk-neutral POP from the published smile`);
    near(re.maxLoss === null ? 0 : re.maxLoss, idea.maxLoss === null ? 0 : idea.maxLoss, 0.011, "and its max loss");
    near(re.evQ, idea.ev.q, 0.2, "and its risk-neutral EV to within the published legs' rounding");
    ok(re.popP !== null && Math.abs(re.popP - idea.prob.popP) < 0.02, `and its real-world POP from the card's law (${re.popP} against ${idea.prob.popP})`);
    const moved = QC.repriceStructure({ engine: block, legs: idea.legs.map((l, i) => ({ type: l.type, K: l.k + (i === 0 ? 2.5 : 0), side: l.side, qty: l.qty })), expiry: idea.expiry });
    ok(moved && moved.model !== re.model, "and re-prices when a strike is dragged, with no round trip");
  }

  ok(!QC.engineStale({ cardSession: "2026-09-21", blockAsOf: "2026-09-21", expectedSession: "2026-09-21" }) &&
     QC.engineStale({ cardSession: "2026-09-18", blockAsOf: "2026-09-18", expectedSession: "2026-09-21" }) &&
     QC.engineStale({ cardSession: "2026-09-21", blockAsOf: "2026-09-18", expectedSession: "2026-09-21" }) &&
     !QC.engineStale({ cardSession: null, blockAsOf: null, expectedSession: "2026-09-21" }),
     "the strategy route reads a card as stale when its session is behind the last one to close, or its engine block behind the card");
  const staleBlock = QC.runCardEngine({ ...input, stale: true });
  ok(staleBlock.structures.length > 0 && staleBlock.structures.every((s) => s.grade <= 1) && staleBlock.structures.some((s) => s.gradeWhy.includes("card.stale")),
     "and pricing a live chain against a stale card's law caps every grade at 1 and says why");
  const fat = { ticker: "SYN", sessionDate: SESSION, generatedAt: "x", pad: "y".repeat(120 * 1024) };
  const split = QP.attachEngine(fat, block);
  ok(split.split && split.card.engine.status === "split" && split.card.engine.key === "card-x:SYN" && split.extra.engine === block,
     "a card that would pass the 128KB ingest cap with its engine block publishes the block under card-x and points to it");
  const fits = QP.attachEngine({ ticker: "SYN", sessionDate: SESSION }, block);
  ok(!fits.split && fits.card.engine === block, "while one that fits carries it inline");
}

{
  const { buildQuantBundle, BUNDLE_OUT } = await import("../scripts/build-flows-quant-bundle.mjs");
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const fresh = await buildQuantBundle();
  const committed = fs.readFileSync(path.join(root, BUNDLE_OUT), "utf8");
  eq(committed, fresh, `${BUNDLE_OUT} is exactly what the generator builds from the shared modules today; regenerate it, never edit it`);
  ok(!/^\s*\/[/*]/m.test(committed) && committed.startsWith("var FlowsQuant="), "the bundle is emitted without a banner and starts with the global it defines");
  const sandbox = { window: {} };
  vm.runInNewContext(committed + "\nwindow.FlowsQuant = FlowsQuant;", sandbox);
  const FQ = sandbox.window.FlowsQuant;
  ok(FQ && typeof FQ.repriceStructure === "function" && typeof FQ.black76 === "function", "the bundle defines FlowsQuant with the re-pricer and Black-76");
  const facts = QC.engineFacts(FACT_INPUT());
  const law = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  const block = QC.runCardEngine({ ticker: "SYN", asOfMs: AS_OF_MS, spot: SPOT, rate: RATE, expiries: slices.input, facts,
    state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich }, pLaw: law,
    levels: { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 }, atr: 2 });
  const plain = JSON.parse(JSON.stringify(block));
  const legs = [{ type: "P", K: 95, side: -1, qty: 1 }, { type: "P", K: 90, side: 1, qty: 1 }];
  const a = QC.repriceStructure({ engine: plain, legs, expiry: "2026-10-23" });
  const b = FQ.repriceStructure({ engine: plain, legs, expiry: "2026-10-23" });
  eq(JSON.stringify(b), JSON.stringify(a), "and the browser build re-prices a put spread exactly as the shared module does");
  near(FQ.black76(100, 0.99, 105, 0.3, 0.25, "C"), BS.black76(100, 0.99, 105, 0.3, 0.25, "C"), 0, "down to Black-76 itself");

  const EXP = "2026-10-23";
  const shaped = (type) => vendorChain({ seed: "lab" }).filter((r) => r.option_symbol.includes(code(EXP) + type)).map((r) => ({
    sym: r.option_symbol, k: QC.parseSymbol(r.option_symbol).strike, bid: Number(r.nbbo_bid), ask: Number(r.nbbo_ask),
    iv: Number(r.implied_volatility), vol: r.volume, oi: r.open_interest,
  }));
  const calls = shaped("C"), puts = shaped("P");
  const rows = QC.bookRows(calls, puts, "SYN");
  ok(rows.length === calls.length + puts.length && rows.every((r, i) => i === 0 || rows[i - 1].K <= r.K),
     `the strategy route's book reads back into engine rows one per listed contract, strike-ordered (${rows.length})`);
  const compact = QC.compactLaw(law);
  const routeIn = { ticker: "SYN", asOfMs: AS_OF_MS + 5 * 3600 * 1000 + 777, spot: 100.37, rate: RATE, expiries: [{ expiry: EXP, rows }], facts,
    state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich }, pLaw: compact,
    levels: { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 }, event: null, atr: 2, fits: true };
  const route = JSON.parse(JSON.stringify(QC.runCardEngine(routeIn)));
  ok(route.fits.length === 1 && route.asOfMs === routeIn.asOfMs && route.stale === false && route.structures.length >= 2,
     `with fits requested the block carries the fitted slice, the clock it was priced at and the stale flag (${route.structures.length} structures)`);
  const labIn = {
    asOfMs: route.asOfMs, spot: route.spot, facts: route.facts, state: route.state, pLaw: route.pLaw, levels: route.levels,
    event: route.event, stale: route.stale, books: [{ fit: route.fits[0], rows }],
  };
  const setupB = FQ.labSetup(labIn), setupM = QC.labSetup(labIn);
  let same = 0;
  for (const s of route.structures) {
    const cand = {
      family: s.family, expiry: s.expiry, dir: s.dir, rules: s.rules,
      legs: s.legs.map((l) => ({ type: l.type, K: l.k, side: l.side, qty: l.qty, expiry: l.expiry })),
      snapped: s.legs.filter((l) => l.snapped).map((l) => ({ K: l.k, rule: l.snapped })),
    };
    const want = { ...s };
    delete want.id;
    const fromBundle = FQ.priceStructure(setupB, cand, { detail: !!s.grid });
    const fromModule = ENGINE.priceStructure(setupM, cand, { detail: !!s.grid });
    eq(JSON.stringify(fromBundle), JSON.stringify(want), `the page's engine re-prices ${s.id} (${s.family}) byte for byte as the Worker published it`);
    eq(JSON.stringify(fromModule), JSON.stringify(want), `and so does the shared module the Worker runs (${s.id})`);
    same++;
  }
  ok(same === route.structures.length && route.structures.some((s) => s.grid),
     "every published structure, including one carrying its scenario grid, is reproduced in the page from the fit alone");
  const putKs = rows.filter((r) => r.type === "P" && r.bid > 0 && r.ask >= r.bid).map((r) => r.K);
  let spreads = 0;
  for (let i = 1; i < putKs.length; i++) {
    const cr = FQ.priceStructure(setupB, { family: "put-credit-spread", expiry: EXP,
      legs: [{ type: "P", K: putKs[i], side: -1, qty: 1 }, { type: "P", K: putKs[i - 1], side: 1, qty: 1 }] });
    if (!cr || !(cr.price.fill < 0) || cr.profitUnbounded || cr.lossUnbounded) continue;
    spreads++;
    eq(cr.maxProfit.toFixed(2), (-cr.price.fill * 100).toFixed(2),
       `a put credit spread ${putKs[i]}/${putKs[i - 1]} prints its credit and its maximum profit as one number (${cr.price.fill} a share, ${cr.maxProfit} a lot)`);
    eq(cr.capital.value.toFixed(2), (-cr.maxLoss).toFixed(2),
       `and its capital is its maximum loss to the cent, whichever sign each was rounded from (${cr.capital.value} against ${cr.maxLoss})`);
  }
  ok(spreads >= 5, `the sweep priced enough credit spreads to mean something (${spreads})`);
  const own =route.structures.find((s) => s.legs.length >= 2);
  const fam = FQ.STRUCTURES.find((f) => f.id === own.family);
  ok(fam && FQ.familyDirection(fam, route.state) !== undefined, "the catalogue and its direction rule ride the bundle");
  const built = FQ.structureLegs(setupB, own.family, FQ.DELTA_TARGETS[own.family][0], EXP);
  ok(built && built.legs.length === own.legs.length, `the page builds ${own.family} legs by delta from the same slice (${built && built.legs.length} legs)`);
  const mid = FQ.priceStructure(setupB, { family: own.family, expiry: EXP, legs: built.legs, basis: "mid" });
  const fill = FQ.priceStructure(setupB, { family: own.family, expiry: EXP, legs: built.legs });
  near(mid.ev.q - fill.ev.q, (fill.price.fill - fill.price.mid) * 100, 0.02,
       "a mid cost basis moves EV by exactly the quarter-spread the fill pays over the mid");
  eq(fill.price, mid.price, "while the quoted prices it reports stay the market's");
  const custom = FQ.priceStructure(setupB, { family: "custom", fam: { id: "custom", risk: "undefined", dir: "neutral" }, expiry: EXP,
    legs: [{ type: "P", K: 95, side: -1, qty: 1 }] });
  ok(custom && custom.capital.kind === "reg-t" && custom.grade <= 2, "a hand-built naked put is priced, capitalised on Reg-T and capped at grade 2");
  const flat = QC.contractFit({ expiry: EXP, asOfMs: routeIn.asOfMs, spot: 100.37, rate: R, row: rows.find((r) => r.type === "P" && r.K === 95) });
  const flatSet = FQ.labSetup({ ...labIn, books: [{ fit: flat, rows: rows.filter((r) => r.type === "P" && r.K === 95) }] });
  const sp = FQ.priceStructure(flatSet, { family: "short-put", expiry: EXP, legs: [{ type: "P", K: 95, side: -1, qty: 1 }], basis: "mid" });
  near(sp.legs[0].model, sp.legs[0].mid, 1e-4, "a desk line priced on its own contract's implied vol reproduces its mid");
  {
    const q95 = rows.find((r) => r.type === "P" && r.K === 95);
    const spreadRel = (q95.ask - q95.bid) / ((q95.ask + q95.bid) / 2);
    const z = Math.abs(Math.log(95 / flat.forward.F)) / (flat.slice.params.sigma * Math.sqrt(flat.T));
    ok(spreadRel <= 0.1 && z <= 1, `the 95 put is a tight quote (${(100 * spreadRel).toFixed(1)}% wide) ${z.toFixed(2)} standard deviations from the forward`);
    ok(sp.gradeParts.fit === 2 && sp.prob.popQ > 0.5 && sp.prob.popP !== null,
       "so a flat slice on it grades 2, not the 1 every desk line used to carry, with a risk-neutral and a real-world chance of profit");
  }
  const shared = new Map();
  let lines = 0, sameLines = 0;
  for (const r of rows.filter((x) => x.type === "P" && x.bid > 0)) {
    const fitR = QC.contractFit({ expiry: EXP, asOfMs: routeIn.asOfMs, spot: 100.37, rate: R, row: r });
    if (!fitR) continue;
    const cand = { family: "short-put", expiry: EXP, legs: [{ type: "P", K: r.K, side: -1, qty: 1 }], basis: "natural" };
    const alone = FQ.priceStructure(FQ.labSetup({ ...labIn, books: [{ fit: fitR, rows: [r] }] }), cand);
    const pooled = FQ.priceStructure(FQ.labSetup({ ...labIn, books: [{ fit: fitR, rows: [r] }], lawCache: shared }), cand);
    lines++;
    if (JSON.stringify(alone) === JSON.stringify(pooled)) sameLines++;
  }
  ok(lines >= 10 && sameLines === lines && shared.size === 1,
     `a desk that shares one real-world law cache across its lines prices every one of them to the byte it prices alone (${sameLines} of ${lines}), from one law for the expiry rather than one per line (${shared.size})`);

  const { READ_BUNDLE_ENTRY, READ_BUNDLE_OUT } = await import("../scripts/build-flows-quant-bundle.mjs");
  const readFresh = await buildQuantBundle(READ_BUNDLE_ENTRY);
  const readCommitted = fs.readFileSync(path.join(root, READ_BUNDLE_OUT), "utf8");
  eq(readCommitted, readFresh, `${READ_BUNDLE_OUT} is exactly what the generator builds from the same shared modules; regenerate it, never edit it`);
  ok(readCommitted.startsWith("var FlowsQuant=") && readCommitted.length * 3 < committed.length,
     `the read build defines the same global at under a third of the full build (${readCommitted.length} against ${committed.length} bytes)`);
  const readBox = { window: {} };
  vm.runInNewContext(readCommitted + "\nwindow.FlowsQuant = FlowsQuant;", readBox);
  const FR = readBox.window.FlowsQuant;
  const tickerSrc = fs.readFileSync(path.join(root, "assets/js/flows-ticker.js"), "utf8");
  const tickerUses = [...new Set([...tickerSrc.matchAll(/\bFQ\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))].sort();
  ok(tickerUses.length >= 5, `the dossier reads the engine through FQ (${tickerUses.join(", ")})`);
  for (const k of tickerUses) ok(typeof FR[k] === "function", `and the read build it loads exports ${k}, so no dossier chart falls back to its silence for want of a function`);
  ok(typeof FR.repriceStructure !== "function" && typeof FR.priceStructure !== "function",
     "while it carries no re-pricer: the dossier reads what the Worker priced and prices nothing itself");
  const withSmile = plain.expiries.filter((e) => e && e.smile && e.forward);
  ok(withSmile.length >= 1, `the card's engine block carries fitted smiles to read (${withSmile.length})`);
  let readSame = 0, readN = 0;
  for (const e of withSmile) {
    const a = FQ.sliceFromSummary(e), b = FR.sliceFromSummary(e);
    for (const x of [85, 95, 100, 105, 115]) {
      readN++;
      if (FQ.riskNeutralCdf(a, x) === FR.riskNeutralCdf(b, x) && FQ.sliceVolK(a, Math.log(x / 100)) === FR.sliceVolK(b, Math.log(x / 100))) readSame++;
    }
  }
  eq(readSame, readN, `and both builds read every fitted smile to the same bit (${readSame} of ${readN} points)`);
}

console.log(`✓ flows-quant-card: ${n} assertions — feed chain rows read once, in fractions and by the ticker's own series; ` +
  "quote IVs within a vol point of the smile that priced them, minimum-tick wings refused; the book's walls on their own " +
  "side of spot whatever the put sign; a zero-gamma level that brute force confirms; SPX parity and the bill as rate " +
  "sources; a seeded, drift-neutral, five-digit P law with the EWMA fallback; earnings sessions dated for the mask; " +
  "numbered facts with units, grades and codes; the card block as the engine's own structures; a browser re-pricer that " +
  "agrees with them; and the card-x split at the ingest cap");
