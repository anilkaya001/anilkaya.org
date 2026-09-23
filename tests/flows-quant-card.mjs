import assert from "node:assert/strict";
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
     "vendor strings arrive as numbers");
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
  ok(q.every((p) => "ivVendor" in p), "and keeps the vendor's figure beside it as a seed, never as the reading");
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
  eq(zero.why, "flip.coverage-unmeasured", "without the vendor's expiry book the coverage is named as unmeasured");
  const covered = QC.zeroGammaOf(slices.built, { spot: SPOT, atr: 2, vendorGross: 1e12 });
  ok(covered.coverage < 0.5 && covered.g === 1 && covered.why === "flip.coverage",
     "and against a book far larger than the fetched contracts the level is graded weak");
  eq(covered.profile.x.length, covered.profile.g.length, "the published profile pairs each spot with its gamma");
}

{
  const priced = QC.parityRate(QC.chainRowsByExpiry(vendorChain({ ticker: "SPX", rate: 0.047 }), { ticker: "SPX", sessionDate: SESSION }).expiries,
    { spot: SPOT, asOfMs: AS_OF_MS, symbol: "SPX" });
  ok(priced && Math.abs(priced.r - 0.047) < 0.004, `SPX parity recovers the rate its quotes were priced at (${priced && priced.r} against 0.047)`);
  eq(priced.method, "parity:SPX", "and names where it came from");
  const tr = QC.treasuryRate({ data: { data: [{ value: 4.17, date: "2026-09-21" }, { value: 4.3, date: "2026-09-18" }], name: "3month" } });
  near(tr.r, Math.log(1.0417), 1e-5, "the three-month yield in the vendor's nested envelope is read at its latest date, continuously compounded");
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
  ok(law.model === "garch" && law.grade === 3 && law.knots.length === 6, "a graded GARCH fit is simulated into six horizons");
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
    strikeSumCrossing: 101.5, regime: { bookGammaRaw: 2e6, flowGamma: -4e5 },
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
  const flat = (expiry, T, vol) => ({ expiry, T, slice: { method: "flat", T, F: 100, D: 1, params: { sigma: vol } } });
  const j = QC.eventJump([flat("2026-10-16", 25 / 365, 0.3), flat("2026-10-23", 32 / 365, 0.45), flat("2026-11-20", 60 / 365, 0.38)], { date: "2026-10-20" });
  const w1 = 0.45 * 0.45 * 32 / 365, w2 = 0.38 * 0.38 * 60 / 365, sd2 = (w2 - w1) / ((60 - 32) / 365);
  near(j.J, Math.sqrt(w1 - sd2 * 32 / 365), 1e-9, "the event jump is the first post-event slice's variance above the diffusion the next slice implies (E2)");
  eq([j.front, j.back], ["2026-10-23", "2026-11-20"], "read from the two expiries after the event");
  eq(QC.eventJump([flat("2026-10-23", 32 / 365, 0.3), flat("2026-11-20", 60 / 365, 0.3)], { date: "2026-10-20" }).J, null,
     "and a flat term structure prices no jump, which is absent rather than zero");
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
  const ivEx = Math.sqrt((cm30.w - 0.05 * 0.05) / (30 / 365));
  near(by["vrp.rel.21"].v, (ivEx - 0.24) / 0.24, 1e-3,
    "while vrp.rel.21 is implied against the GARCH forward, ex-event on the implied side when earnings fall inside thirty days (D4)");
  near(by["vrp.var.21"].v, ivEx * ivEx - 0.24 * 0.24, 1e-4, "and in variance terms");
  ok(by["level.putWall"].v <= SPOT && by["level.callWall"].v >= SPOT, "walls in the facts are the book's");
  eq(by["level.strikeSumCrossing"].v, 101.5, "and the strike-sum crossing rides under its own id beside level.flip");
  ok(by["skew.rr25.30.pct"].x === true, "a cross-sectional percentile is tagged x");
  ok(by["move.event"].v > 0 && by["move.event.ratio"].v > 0, "an event between two fitted slices yields an implied jump and its ratio to history");
  const degenerate = QC.engineFacts({ ...FACT_INPUT(), garch: { ...GARCH, grade: 2, why: ["garch.alpha-degenerate"] } });
  const dg = Object.fromEntries(degenerate.map((f) => [f.id, f]));
  ok(dg["garch.avg.21"].g === 2 && dg["garch.avg.21"].why === "garch.alpha-degenerate" && dg["vrp.rel.21"].g <= 2,
     "a degenerate GARCH grades its forecast and every VRP built on it at most 2, naming the reason (defect 6)");
}

{
  const facts = QC.engineFacts(FACT_INPUT());
  const law = QP.garchLaw({ garch: GARCH, ticker: "SYN", sessionDate: SESSION, closes: CLOSES, rate: R, paths: 2048 });
  const state = { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich };
  const levels = { callWall: 105, putWall: 95, magnet: 100, flip: 99, maxPain: 100, atr: 2 };
  const input = { ticker: "SYN", asOfMs: AS_OF_MS, spot: SPOT, rate: RATE, expiries: slices.input, facts, state, pLaw: law, levels, event: null, atr: 2 };
  const block = QC.runCardEngine(input);
  const direct = ENGINE.runEngine({ ticker: "SYN", asOf: AS_OF_MS, spot: SPOT, rate: R, expiries: slices.input, facts: QC.factMap(facts),
    state: QC.engineState(state), pLaw: law, levels, curves: false });
  const byId = new Map(direct.structures.map((s) => [s.id, s]));
  ok(block.structures.length >= 1 && block.structures.length <= QC.QUANT_CARD_LINES.PUBLISH_STRUCTURES,
     `the card publishes ${block.structures.length} priced structures of ${block.priced}`);
  ok(block.structures.every((s) => JSON.stringify(s) === JSON.stringify(byId.get(s.id))),
     "each is the engine's own structure object, byte for byte, which is what the Worker route returns as well");
  eq(block.ideas, direct.ideas, "with the engine's ranking");
  ok(block.ideas.every((id) => block.structures.some((s) => s.id === id)), "and every idea id resolves to a published structure");
  eq(JSON.stringify(QC.runCardEngine(input)), JSON.stringify(block), "the block is byte-identical on a rerun");
  ok(block.pLaw && block.pLaw.knots.length === 6 && QC.runCardEngine({ ...input, publishLaw: false }).pLaw === null,
     "the law rides the card and is left off when the caller already holds it");

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
}

console.log(`✓ flows-quant-card: ${n} assertions — vendor chain rows read once, in fractions and by the ticker's own series; ` +
  "quote IVs within a vol point of the smile that priced them, minimum-tick wings refused; the book's walls on their own " +
  "side of spot whatever the put sign; a zero-gamma level that brute force confirms; SPX parity and the bill as rate " +
  "sources; a seeded, drift-neutral, five-digit P law with the EWMA fallback; earnings sessions dated for the mask; " +
  "numbered facts with units, grades and codes; the card block as the engine's own structures; a browser re-pricer that " +
  "agrees with them; and the card-x split at the ingest cap");
