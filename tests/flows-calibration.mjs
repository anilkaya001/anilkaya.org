import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as CAL from "../scripts/flows-legs/calibration.mjs";
import * as ST from "../shared/flows-stats.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`); checks++; };

eq(CAL.isoWeek("2026-01-01"), "2026-W01", "2026-01-01 is in ISO week 1");
eq(CAL.isoWeek("2025-12-29"), "2026-W01", "the Monday before it already belongs to 2026-W01");
eq(CAL.isoWeek("2027-01-01"), "2026-W53", "2027-01-01 closes 2026-W53");
eq(CAL.isoWeek("2026-10-09"), "2026-W41", "a Friday inside a week");
eq(CAL.isoWeek("2026-10-05"), CAL.isoWeek("2026-10-11"), "Monday and Sunday of one week agree");
eq(CAL.addDays("2026-02-27", 2), "2026-03-01", "addDays crosses a month");
eq(CAL.weekdaysBefore("2026-10-05", "2026-10-12"), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"], "weekdaysBefore drops the weekend and the end day");
ok(!CAL.isDay("2026-02-30") && !CAL.isDay("26-01-01") && CAL.isDay("2026-02-28"), "isDay refuses a day the calendar does not have");

const mk = (over = {}) => ({
  t: "AAA", family: "put-credit-spread", dir: "up", grade: 2, expiry: "2026-10-16", dte: 30,
  legs: [["P", 95, -1, 1, "2026-10-16"], ["P", 90, 1, 1, "2026-10-16"]], fill: -1.2,
  mid: -1.25, natural: -1.1, spot: 100, div: null, popQ: 0.7, popP: 0.75, pMaxQ: 0.6, pMaxP: 0.66, touchQ: [0.4],
  evQ: -3, evP: 12, capital: 380, archived: "2026-09-16", ...over,
});
const bar = (d, c, h = c + 1, l = c - 1) => ({ d, h, l, c });

{
  const block = {
    spot: 100, ideas: ["s2", "s1"],
    structures: [
      { id: "s1", family: "iron-condor", dir: "neutral", grade: 1, expiry: "2026-10-16", dte: 30, legs: [], price: { fill: 1 } },
      {
        id: "s2", family: "put-credit-spread", dir: "up", grade: 2, expiry: "2026-10-16", dte: 30,
        legs: [{ type: "P", k: 95, expiry: "2026-10-16", side: -1, qty: 1 }, { type: "P", k: 90, expiry: "2026-10-16", side: 1, qty: 1 }],
        price: { mid: -1.25, natural: -1.1, fill: -1.2, model: -1 }, carry: { dividend: null },
        prob: { popQ: 0.7, popP: 0.75, pMaxProfitQ: 0.6, pMaxProfitP: 0.66, touchShortQ: [0.4] }, ev: { q: -3, p: 12 }, capital: { kind: "max-loss", value: 380 },
      },
    ],
  };
  const r = CAL.ideaRecord(block, "AAA");
  eq([r.t, r.family, r.expiry, r.fill, r.spot, r.popP, r.popQ, r.capital], ["AAA", "put-credit-spread", "2026-10-16", -1.2, 100, 0.75, 0.7, 380], "the lead idea (ideas[0], not the first structure) is frozen with its fill, spot and both chances");
  eq(r.legs, [["P", 95, -1, 1, "2026-10-16"], ["P", 90, 1, 1, "2026-10-16"]], "its legs are strike, side, quantity and expiry");
  eq(CAL.ideaRecord({ ...block, ideas: [] }, "AAA"), null, "no ranked idea, no trial");
  eq(CAL.ideaRecord({ ...block, structures: [{ ...block.structures[1], price: { mid: 1 } }] }, "AAA"), null, "an idea with no fill is not a trial");
  eq(CAL.ideaRecord({ ...block, spot: null }, "AAA"), null, "nor is one with no spot");
  const flipped = { ...r, legs: [r.legs[1], r.legs[0]] };
  eq(CAL.identityOf(flipped), CAL.identityOf(r), "the identity does not depend on the order of the legs");
  ok(CAL.identityOf({ ...r, legs: [["P", 95, -1, 1, "2026-10-16"], ["P", 85, 1, 1, "2026-10-16"]] }) !== CAL.identityOf(r), "a changed strike is a new identity");
  ok(CAL.identityOf({ ...r, expiry: "2026-10-23", legs: r.legs.map((l) => [l[0], l[1], l[2], l[3], "2026-10-23"]) }) !== CAL.identityOf(r), "a changed expiry is a new identity");
  const row = CAL.archiveRow({ t: "AAA", id: "put-credit-spread", structure: "put credit spread", dir: "up", grade: 2 }, r);
  const back = CAL.trialOf(row);
  eq([back.t, back.family, back.expiry, back.fill], [r.t, r.family, r.expiry, r.fill], "an archive row gives its trial back");
  eq(CAL.trialOf({ ...row, trial: { ...row.trial, legs: [["X", 1, 1, 1, "2026-10-16"]] } }), null, "a leg of an unknown type makes the row unreadable, not a trial");
  eq(CAL.trialOf({ ...row, trial: { ...row.trial, fill: "1" } }), null, "a fill that is not a number does too");
  const payload = CAL.archivePayload([row], { sessionDate: "2026-09-16", generatedAt: "2026-09-16T22:00:00Z", built: 3 });
  eq([payload.v, payload.n, payload.status], [2, 1, "ok"], "the archive payload carries the trials");
}

{
  const day = (n) => CAL.addDays("2026-09-16", n);
  const RUN = "2026-10-16";
  const bars = (closes, from = "2026-09-17") => closes.map((c, i) => bar(CAL.addDays(from, i), c));
  const res = (trial, series, run = RUN) => CAL.resolveTrial(trial, series, run);

  let o = res(mk(), { bars: [bar("2026-10-15", 100), bar("2026-10-16", 100)] });
  eq([o.status, o.profit, o.reachedMax, o.touched, o.close, o.closeDate], ["resolved", 1, 1, 0, 100, "2026-10-16"], "a put credit spread that expires out of the money profits and reaches its maximum");
  near(o.pnl, 1.2, 1e-9, "its P&L per share is the credit");
  o = res(mk(), { bars: [bar("2026-10-16", 94)] });
  eq([o.profit, o.reachedMax, o.touched], [1, 0, 1], "a close between the breakeven (93.80) and the short strike profits without the maximum, and the day that closed there touched the strike");
  near(o.pnl, 0.2, 1e-9, "by the credit less the intrinsic value");
  o = res(mk(), { bars: [bar("2026-10-16", 93.81)] });
  eq(o.profit, 1, "one cent above the breakeven is a profit");
  o = res(mk(), { bars: [bar("2026-10-16", 93.79)] });
  eq(o.profit, 0, "one cent below it is not");
  o = res(mk(), { bars: [bar("2026-10-16", 80)] });
  near(o.pnl, -3.8, 1e-9, "a close below the long strike loses the width less the credit");
  eq(res(mk(), { bars: [bar("2026-10-16", 95)] }).reachedMax, 1, "the maximum region includes its edge");
  eq(res(mk(), { bars: [bar("2026-10-16", 94.99)] }).reachedMax, 0, "and not what is just inside it");

  o = res(mk(), { bars: [bar("2026-09-16", 90, 90, 80), bar("2026-09-17", 101, 102, 99.5), bar("2026-10-16", 100)] });
  eq(o.touched, 0, "a low on the archive night itself is not a touch of the idea");
  o = res(mk(), { bars: [bar("2026-09-17", 101, 102, 99.5), bar("2026-09-30", 96, 97, 94.9), bar("2026-10-16", 100)] });
  eq(o.touched, 1, "a daily low through a short put strike is a touch even though the close came back");
  o = res(mk(), { bars: [bar("2026-09-30", 96, 97, 95), bar("2026-10-16", 100)] });
  eq(o.touched, 1, "a low exactly on the strike counts");
  o = res(mk(), { bars: [bar("2026-09-30", 96, 97, 95.01), bar("2026-10-16", 100)] });
  eq(o.touched, 0, "and one cent above does not");

  const call = mk({ family: "bear-call-spread", legs: [["C", 105, -1, 1, "2026-10-16"], ["C", 110, 1, 1, "2026-10-16"]], fill: -1.5 });
  eq(res(call, { bars: [bar("2026-10-02", 104, 105.5, 103), bar("2026-10-16", 101)] }).touched, 1, "a daily high through a short call strike is a touch");
  eq(res(call, { bars: [bar("2026-10-02", 104, 104.9, 103), bar("2026-10-16", 101)] }).touched, 0, "and a high short of it is not");
  eq(res(call, { bars: [bar("2026-10-16", 108)] }).profit, 0, "a bear call spread closing at 108 has lost more than the 1.50 credit");

  const long = mk({ family: "long-call", legs: [["C", 100, 1, 1, "2026-10-16"]], fill: 2.5 });
  const lo = res(long, { bars: [bar("2026-10-16", 102.4)] });
  eq([lo.profit, lo.reachedMax, lo.touched], [0, null, null], "a long call under its breakeven loses; it has no maximum and no short strike to touch");
  eq(res(long, { bars: [bar("2026-10-16", 102.6)] }).profit, 1, "and over it profits");

  const cc = mk({ family: "covered-call", legs: [["S", null, 1, 1, null], ["C", 105, -1, 1, "2026-10-16"]], fill: 98, div: 0.5 });
  eq(res(cc, { bars: [bar("2026-10-16", 103)] }).profit, 1, "a covered call counts the dividend the stock leg collects");
  eq(res(cc, { bars: [bar("2026-10-16", 97.6)] }).profit, 1, "so a close of 97.60 against a fill of 98 is still ahead by the 0.50");
  eq(res(cc, { bars: [bar("2026-10-16", 97.4)] }).profit, 0, "and 97.40 is not");
  eq(res(cc, { bars: [bar("2026-10-16", 120)] }).reachedMax, 1, "a close past the short call is the covered call's maximum");

  eq(res(mk({ legs: [["C", 100, -1, 1, "2026-10-16"], ["C", 100, 1, 1, "2026-11-20"]], family: "long-calendar" }), { bars: [bar("2026-10-16", 100)] }).why, "multi-expiry", "a calendar cannot be settled from a close at the front expiry");
  eq(res(mk(), { bars: [bar("2026-10-16", 100)], breaks: ["2026-10-01"] }).why, "price-break", "a split between the archive night and the expiry excludes the idea");
  eq(res(mk(), { bars: [bar("2026-10-16", 100)], breaks: ["2026-09-01"] }).status, "resolved", "one before it does not");
  eq(res(mk({ expiry: "2026-09-16", legs: [["P", 95, -1, 1, "2026-09-16"]] }), { bars: [] }).why, "expired-on-archive", "an expiry on or before the archive night is excluded");
  eq(res(mk(), null).why, "no-bars", "no series at all is pending, not a loss");
  eq(res(mk(), { bars: [bar("2026-10-14", 100)] }).why, "no-close", "a series that ends before the expiry is pending");
  eq(res(mk({ expiry: "2026-10-23", legs: [["P", 95, -1, 1, "2026-10-23"]] }), { bars: [bar("2026-10-16", 100)] }).why, "not-due", "an idea that expires after the run is not due");

  o = res(mk({ expiry: "2026-10-09", legs: [["P", 95, -1, 1, "2026-10-09"], ["P", 90, 1, 1, "2026-10-09"]] }), { bars: [bar("2026-10-07", 99), bar("2026-10-08", 96), bar("2026-10-12", 70)] });
  eq([o.status, o.closeDate, o.close], ["resolved", "2026-10-08", 96], "an expiry on a market holiday settles on the last close before it, never on the session after");
  o = res(mk(), { bars: [bar("2026-10-16", 100), bar("2026-10-19", 60), bar("2026-10-20", 60)] }, "2026-10-16");
  eq(o.close, 100, "LOOK-AHEAD: bars dated after the run are cut before anything is read");
  o = res(mk({ expiry: "2026-10-15", legs: [["P", 95, -1, 1, "2026-10-15"], ["P", 90, 1, 1, "2026-10-15"]] }), { bars: [bar("2026-10-15", 100), bar("2026-10-16", 60)] }, "2026-10-15");
  eq(o.close, 100, "LOOK-AHEAD: a close dated after the run's own session is never the expiry close");
  eq(res(mk({ expiry: "2026-10-15", legs: [["P", 95, -1, 1, "2026-10-15"], ["P", 90, 1, 1, "2026-10-15"]] }), { bars: [bar("2026-10-16", 60)] }, "2026-10-15").status, "pending", "and a series holding only later bars settles nothing");
  eq(res(mk({ expiry: "2026-10-15", legs: [["P", 95, -1, 1, "2026-10-15"], ["P", 90, 1, 1, "2026-10-15"]] }), { bars: [bar("2026-10-14", 100), bar("2026-10-16", 60)] }, "2026-10-15").status, "pending", "LOOK-AHEAD: a bar from after the run does not turn a session whose close has not arrived into a holiday settled on the day before");
  const even = mk({ legs: [["P", 100, -1, 1, "2026-10-16"], ["P", 90, 1, 1, "2026-10-16"]], fill: -2 });
  eq(res(even, { bars: [bar("2026-10-16", 98)] }).profit, 0, "a close exactly on the breakeven (98.00) is not a profit: the chance of profit is of a gain, not of getting even");
  eq(res(even, { bars: [bar("2026-10-16", 98.01)] }).profit, 1, "and a cent above is");
  eq(res(mk({ family: "long-call", legs: [["C", 100, 1, 1, "2026-10-16"]], fill: 2.5 }), { bars: [bar("2026-10-16", 102.5)] }).profit, 0, "nor is a long call closing exactly at strike plus premium");

  const a = mk(), b = mk({ archived: "2026-09-16" });
  eq(res(a, { bars: bars([100, 99, 98, 99, 97, 100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 100, 99, 100, 101, 100, 99, 100, 101, 102, 103, 104, 105, 104, 100]) }), res(b, { bars: bars([100, 99, 98, 99, 97, 100, 101, 102, 103, 104, 105, 104, 103, 102, 101, 100, 99, 100, 101, 100, 99, 100, 101, 102, 103, 104, 105, 104, 100]) }), "the same trial and bars resolve to the same outcome");
  ok(day(0) === "2026-09-16", "helper day() agrees");
}

{
  const rng = ST.mulberry32(20261010);
  const ps = [], ys = [];
  for (let i = 0; i < 1500; i++) { const p = rng(); ps.push(p); ys.push(rng() < Math.min(1, Math.max(0, p * 0.8 + 0.12)) ? 1 : 0); }
  const state = CAL.emptyState();
  ps.forEach((p, i) => CAL.foldOutcome(state, { week: "2026-W" + String(1 + (i % 37)).padStart(2, "0"), profit: ys[i], popP: p, popQ: p }));
  const view = CAL.modelView(state.popP, 1);
  const ref = ST.reliability(ps, ys, { bins: 10 });
  near(view.brier, ref.brier, 1e-6, "the binned accumulator's Brier score equals the leaf's on the raw data");
  near(view.reliability, ref.reliability, 1e-6, "its reliability term");
  near(view.resolution, ref.resolution, 1e-6, "its resolution term");
  near(view.uncertainty, ref.uncertainty, 1e-6, "its uncertainty term");
  near(view.withinBin, ref.withinBin, 1e-6, "its within-bin variance");
  near(view.withinCovariance, ref.withinCovariance, 1e-6, "and its within-bin covariance");
  near(view.reliability - view.resolution + view.uncertainty + view.withinBin - 2 * view.withinCovariance, view.brier, 1e-5, "THE DECOMPOSITION SUMS TO THE BRIER SCORE");
  near(view.logScore, ST.logScore(ps, ys), 1e-6, "the log score matches the leaf's");
  eq(view.n, 1500, "every forecast is counted once");
  eq(view.bins.length, 10, "ten bins");
  ok(view.bins.every((b) => b.n === 0 || (b.ci && b.ci[0] <= b.y && b.y <= b.ci[1])), "each occupied bin's Wilson interval holds its observed frequency");
  const wide = CAL.modelView(state.popP, 4);
  ok(wide.bins.every((b, i) => b.n === 0 || (wide.bins[i].ci[1] - wide.bins[i].ci[0]) > (view.bins[i].ci[1] - view.bins[i].ci[0])), "a design effect of 4 widens every interval");
}

{
  const run = (slope, seed, N = 3000, weeks = 60) => {
    const rng = ST.mulberry32(seed);
    const state = CAL.emptyState();
    for (let i = 0; i < N; i++) {
      const p = 0.05 + 0.9 * rng();
      const truth = Math.min(1, Math.max(0, 0.5 + slope * (p - 0.5)));
      CAL.foldOutcome(state, { week: "w" + (i % weeks), profit: rng() < truth ? 1 : 0, popP: p, popQ: p });
    }
    const eff = CAL.effectiveCount(state.clusters);
    const view = CAL.modelView(state.popP, eff.deff);
    const used = view.bins.filter((b) => b.n > 0);
    return used.filter((b) => b.p >= b.ci[0] && b.p <= b.ci[1]).length / used.length;
  };
  let cov = 0, miss = 0;
  const reps = 60;
  for (let s = 0; s < reps; s++) { cov += run(1, 1000 + s); miss += run(0.35, 5000 + s); }
  ok(cov / reps >= 0.9, `A CALIBRATED MODEL'S CURVE LIES ON THE DIAGONAL WITHIN THE WILSON INTERVALS in at least 90% of bins (${(cov / reps).toFixed(3)} over ${reps} simulations)`);
  ok(miss / reps <= 0.5, `and a model whose chances carry a third of the information they claim does not (${(miss / reps).toFixed(3)})`);
}

{
  const balanced = {};
  for (let k = 0; k < 25; k++) balanced["w" + k] = [10, k % 2 ? 9 : 1];
  const e = CAL.effectiveCount(balanced);
  near(e.n, 250, 0, "n counts every idea");
  ok(e.icc > 0.5, `alternating clusters of mostly wins and mostly losses show a large intra-cluster correlation (${e.icc})`);
  near(e.nEff, ST.effectiveN({ n: 250, k: 25, icc: e.rho }), 1e-9, "effective n agrees with the leaf's design-effect formula for equal clusters");
  ok(e.nEff < 250 / 2, `and is a fraction of n (${e.nEff.toFixed(1)})`);
  const indep = {};
  const rng = ST.mulberry32(7);
  for (let k = 0; k < 30; k++) { let s = 0; for (let i = 0; i < 12; i++) s += rng() < 0.5 ? 1 : 0; indep["w" + k] = [12, s]; }
  const ei = CAL.effectiveCount(indep);
  ok(Math.abs(ei.icc) < 0.1 && ei.nEff > 200, `independent outcomes give an intra-cluster correlation near zero and an effective n well over half of n (${ei.icc.toFixed(3)}, ${ei.nEff.toFixed(0)} of 360)`);
  const few = CAL.effectiveCount({ a: [20, 10], b: [20, 10], c: [20, 10] });
  eq([few.rho, few.floored], [0.1, true], "with fewer than 20 clusters the correlation is floored at 0.1 whatever the data say");
  near(few.nEff, 3 * 20 / (1 + 19 * 0.1), 1e-9, "and effective n follows the floor");
  eq(CAL.effectiveCount({}).nEff, 0, "no clusters, no effective n");
  eq(CAL.iccOf({ a: [5, 5] }), null, "one cluster has no estimate");
  const many = {};
  for (let k = 0; k < 40; k++) many["w" + k] = [3, 3 * (k % 2)];
  eq(CAL.effectiveCount(many).floored, false, "from 20 clusters the estimate stands without the floor");
}

const makeStore = () => {
  const m = new Map();
  const log = { reads: [], writes: [], records: [], fetches: [] };
  const fail = { read: new Set(), publish: false, record: null };
  const barsHeld = new Map();
  const orphan = new Map();
  const deps = (sessionDate, extra = {}) => ({
    sessionDate, generatedAt: sessionDate + "T22:00:00Z",
    readKey: async (k) => {
      log.reads.push(k);
      if (fail.read.has(k)) return { payload: null, failed: true, status: 500 };
      return m.has(k) ? { payload: structuredClone(m.get(k)) } : { payload: null, absent: true, status: 200 };
    },
    publish: async (k, p) => { if (fail.publish) throw new Error("HTTP 503"); log.writes.push(k); m.set(k, structuredClone(p)); },
    record: async (prefix, p) => {
      const key = `${prefix}:${p.sessionDate}`;
      log.records.push(key);
      if (fail.record) return { state: fail.record, key, line: `  ${prefix} archive: ${fail.record}` };
      if (!m.has(key)) { m.set(key, structuredClone(p)); return { state: "written", key, line: `  ${key} recorded` }; }
      if (JSON.stringify(m.get(key)) === JSON.stringify(p)) return { state: "unchanged", key, line: `  ${key} unchanged` };
      let r = 1;
      while (m.has(`${key}:r${r}`)) r++;
      m.set(`${key}:r${r}`, structuredClone(p));
      return { state: "revision", key: `${key}:r${r}`, line: `  ${key}:r${r}` };
    },
    barsFor: async (t) => barsHeld.get(t) || null,
    fetchBars: async (t) => { log.fetches.push(t); return orphan.get(t) || null; },
    ...extra,
  });
  return { m, log, fail, barsHeld, orphan, deps };
};

const archiveNight = (store, d, trials) => {
  const rows = trials.map((t) => {
    const { archived, ...rest } = t;
    const { t: ticker, family, dir, grade, ...trial } = rest;
    return { t: ticker, id: family, structure: family, dir, grade, trial };
  });
  store.m.set(`ideas:${d}`, CAL.archivePayload(rows, { sessionDate: d, generatedAt: d + "T22:00:00Z", built: rows.length }));
};

const leg = (type, k, side, expiry) => [type, k, side, 1, expiry];
const pcs = (t, expiry, over = {}) => mk({ t, expiry, legs: [leg("P", 95, -1, expiry), leg("P", 90, 1, expiry)], ...over });
const flat = (from, to, c) => { const out = []; for (let d = from; d <= to; d = CAL.addDays(d, 1)) { const w = new Date(d + "T00:00:00Z").getUTCDay(); if (w && w !== 6) out.push(bar(d, c)); } return out; };

{
  const S = makeStore();
  archiveNight(S, "2026-09-14", [pcs("AAA", "2026-10-16"), pcs("BBB", "2026-10-16", { popP: 0.6, popQ: 0.55 })]);
  archiveNight(S, "2026-09-15", [pcs("AAA", "2026-10-16"), pcs("CCC", "2026-10-23")]);
  archiveNight(S, "2026-09-16", [pcs("AAA", "2026-10-16", { legs: [leg("P", 96, -1, "2026-10-16"), leg("P", 90, 1, "2026-10-16")] })]);
  S.m.set("ideas:2026-10-16", CAL.archivePayload([{ t: "ZZZ", id: "x", structure: "x", dir: null, grade: 1, trial: (({ t, family, dir, grade, archived, ...r }) => r)(pcs("ZZZ", "2026-10-16")) }], { sessionDate: "2026-10-16", generatedAt: "x" }));
  S.barsHeld.set("AAA", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  S.barsHeld.set("BBB", { bars: flat("2026-09-14", "2026-10-16", 90), breaks: [] });
  S.barsHeld.set("CCC", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  S.barsHeld.set("ZZZ", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });

  const r = await CAL.runCalibration(S.deps("2026-10-16"));
  eq(r.state, "published", "the run publishes");
  ok(S.log.reads.every((k) => k === "calib" || (/^ideas:\d{4}-\d{2}-\d{2}$/.test(k) && k.slice(6) < "2026-10-16")), `LOOK-AHEAD: only calib and archives dated before the run are ever read (${S.log.reads.filter((k) => k !== "calib" && k.slice(6) >= "2026-10-16").join(",") || "none"})`);
  ok(!S.log.reads.includes("ideas:2026-10-16"), "tonight's own archive is never read, though it is in the store");
  ok(S.log.reads.length <= 350, `rows read stay far under 350 (${S.log.reads.length})`);
  const out = S.m.get("ideas-out:2026-10-16");
  eq(out.rows.map((x) => x.id.split("|")[0] + x.status).sort(), ["AAAresolved", "AAAresolved", "BBBresolved"], "the three identities that expired are resolved: AAA's re-recommendation on the second night is no new trial, its changed strike is");
  eq(out.rows.filter((x) => x.t === "AAA").length, 2, "two AAA trials, not three");
  ok(!out.rows.some((x) => x.t === "CCC" || x.t === "ZZZ"), "an idea that expires a week later and tonight's own are not resolved");
  const cal = S.m.get("calib");
  eq([cal.through, cal.firstArchive, cal.counts.resolved, cal.counts.pending, cal.counts.lost, cal.n, cal.measured], ["2026-10-16", "2026-09-14", 3, 0, 0, 3, false], "calib counts three resolved ideas and is not measured");
  eq(cal.popP, null, "BELOW n_eff 100 NO RELIABILITY IS PUBLISHED");
  eq(cal.counts.unresolvedShare, 0, "the unresolved share is published, zero here");
  ok(cal.nEff > 0 && cal.nEff < 3.0001, `effective n is under n for three ideas in one cluster (${cal.nEff})`);
  const before = S.log.writes.length;
  const again = await CAL.runCalibration(S.deps("2026-10-16"));
  eq([again.state, S.log.writes.length], ["unchanged", before], "running the same session again writes nothing");
  const earlier = await CAL.runCalibration(S.deps("2026-10-15"));
  eq(earlier.state, "unchanged", "a run dated before calib's own through date adds nothing either");

  S.barsHeld.set("CCC", { bars: flat("2026-09-14", "2026-10-23", 80), breaks: [] });
  const next = await CAL.runCalibration(S.deps("2026-10-23"));
  eq(next.state, "published", "the next week's run publishes");
  const cal2 = S.m.get("calib");
  eq([cal2.counts.resolved, cal2.n, cal2.through], [4, 4, "2026-10-23"], "and adds CCC once, leaving the three already folded alone");
  eq(S.m.get("ideas-out:2026-10-23").rows.map((x) => x.t), ["CCC"], "its outcome row holds only what resolved that night");
  ok(S.log.reads.filter((k) => k === "ideas:2026-10-23").length === 0 && S.log.reads.filter((k) => k === "ideas:2026-10-22").length === 1, "reading stops the day before the run");
  const reads = S.log.reads.length;
  const again2 = await CAL.runCalibration(S.deps("2026-10-26"));
  eq(again2.state, "published", "a quiet week still publishes calib");
  eq(S.m.has("ideas-out:2026-10-26"), false, "but writes no outcome row when nothing resolved");
  ok(S.log.reads.length - reads <= 90, `and its archive window is bounded (${S.log.reads.length - reads} reads)`);
}

{
  const S = makeStore();
  const names = [];
  for (let i = 0; i < 5; i++) names.push("S" + i);
  const orphans = [];
  for (let i = 0; i < 5; i++) orphans.push("O" + i);
  archiveNight(S, "2026-09-14", [...names, ...orphans].map((t) => pcs(t, "2026-10-16", { popP: 0.8, popQ: 0.75 })));
  for (const t of names) S.barsHeld.set(t, { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  for (const t of orphans) S.orphan.set(t, { bars: flat("2026-09-14", "2026-10-16", 80), breaks: [] });
  const none = await CAL.runCalibration(S.deps("2026-10-16", { orphanCap: 0 }));
  const c1 = S.m.get("calib");
  eq([c1.counts.resolved, c1.counts.pending, c1.counts.unresolvedShare], [5, 5, 0.5], "SURVIVOR BIAS: with no budget to fetch closes for names that left the deep set, half the ideas are unresolved and the published share says so");
  eq(S.log.fetches.length, 0, "no close was fetched");
  ok(none.line.includes("unresolved share 50.0%"), "and the nightly log says it too");
  const pend = c1.state.pending.map((p) => p.t).sort();
  eq(pend, orphans, "the pending ones are exactly the orphans");
  const next = await CAL.runCalibration(S.deps("2026-10-17", { orphanCap: 15 }));
  const c2 = S.m.get("calib");
  eq([c2.counts.resolved, c2.counts.pending, c2.counts.unresolvedShare], [10, 0, 0], "the next night fetches their closes and resolves them");
  eq(S.log.fetches.slice().sort(), orphans, "one fetch per orphan name");
  const outs = S.m.get("ideas-out:2026-10-17").rows;
  ok(outs.length === 5 && outs.every((o) => o.profit === 0 && o.pnl < 0), "and every one of them lost, which a survivors-only record would have hidden");
  const survivorsOnly = c1.state.popP.bins.reduce((s, b) => s + b[3] - 2 * b[4] + b[2], 0) / 5;
  const withOrphans = c2.state.popP.bins.reduce((s, b) => s + b[3] - 2 * b[4] + b[2], 0) / 10;
  ok(withOrphans > survivorsOnly + 0.1, `the Brier score with the orphans (${withOrphans.toFixed(3)}) is worse than survivors alone (${survivorsOnly.toFixed(3)})`);
  eq(next.fetched, 5, "the run reports its fetches");
}

{
  const S = makeStore();
  const many = [];
  for (let i = 0; i < 20; i++) many.push("N" + String(i).padStart(2, "0"));
  archiveNight(S, "2026-09-14", many.map((t) => pcs(t, "2026-10-16")));
  for (const t of many) S.orphan.set(t, { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  await CAL.runCalibration(S.deps("2026-10-16"));
  eq(S.log.fetches.length, 15, "THE FETCH BUDGET HOLDS: fifteen closes a night, whatever is waiting");
  eq(S.m.get("calib").counts.pending, 5, "the other five wait");
  await CAL.runCalibration(S.deps("2026-10-17"));
  eq([S.log.fetches.length, S.m.get("calib").counts.resolved, S.m.get("calib").counts.pending], [20, 20, 0], "and are fetched the next night");
  eq(new Set(S.log.fetches).size, 20, "no name is fetched twice");
}

{
  const S = makeStore();
  archiveNight(S, "2026-09-14", [pcs("GONE", "2026-10-02"), pcs("OK", "2026-10-02")]);
  S.barsHeld.set("OK", { bars: flat("2026-09-14", "2026-10-02", 100), breaks: [] });
  await CAL.runCalibration(S.deps("2026-10-05"));
  eq(S.m.get("calib").counts.pending, 1, "an idea with no close stays pending for a while");
  await CAL.runCalibration(S.deps("2026-10-12"));
  eq(S.m.get("calib").counts.pending, 1, "up to fourteen days past its expiry");
  await CAL.runCalibration(S.deps("2026-10-19"));
  const c = S.m.get("calib");
  eq([c.counts.pending, c.counts.lost, c.counts.unresolvedShare], [0, 1, 0.5], "then it is lost, recorded as lost and counted in the unresolved share");
  ok(S.m.get("ideas-out:2026-10-19").rows.some((r) => r.status === "lost" && r.t === "GONE"), "in the outcome row");
}

{
  const S = makeStore();
  archiveNight(S, "2026-09-14", [pcs("AAA", "2026-10-16"), pcs("BBB", "2026-10-16", { legs: [leg("P", 95, -1, "2026-10-16"), leg("P", 95, 1, "2026-11-20")], family: "long-calendar" })]);
  S.barsHeld.set("AAA", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  S.barsHeld.set("BBB", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  await CAL.runCalibration(S.deps("2026-10-16"));
  const c = S.m.get("calib");
  eq([c.counts.resolved, c.counts.excluded], [1, { "multi-expiry": 1 }], "an idea that cannot be settled from a close is excluded, named, and not counted as a miss or a hit");
  eq(c.counts.unresolvedShare, 0, "and not in the unresolved share");
}

{
  const S = makeStore();
  archiveNight(S, "2026-09-14", [pcs("AAA", "2026-10-16")]);
  S.barsHeld.set("AAA", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  S.fail.read.add("ideas:2026-09-30");
  const r = await CAL.runCalibration(S.deps("2026-10-16"));
  eq([r.state, S.m.has("calib"), S.m.has("ideas-out:2026-10-16")], ["skipped", false, false], "AN UNREADABLE ARCHIVE ROW STOPS THE RUN: an idea expiring in the gap must not be skipped for good");
  S.fail.read.clear();
  S.fail.read.add("calib");
  eq((await CAL.runCalibration(S.deps("2026-10-16"))).state, "skipped", "so does an unreadable calib row, which would otherwise restart the count");
  S.fail.read.clear();
  S.fail.record = "lost";
  const lost = await CAL.runCalibration(S.deps("2026-10-16"));
  eq([lost.state, S.m.has("calib")], ["skipped", false], "an outcome that cannot be recorded leaves calib untouched");
  S.fail.record = null;
  S.fail.publish = true;
  eq((await CAL.runCalibration(S.deps("2026-10-16"))).state, "lost", "a calib that cannot be published is reported");
  S.fail.publish = false;
  const good = await CAL.runCalibration(S.deps("2026-10-16"));
  eq([good.state, S.m.get("calib").counts.resolved], ["published", 1], "and the retry folds the idea exactly once");
  const orows = Object.keys(Object.fromEntries(S.m)).filter((k) => k.startsWith("ideas-out:"));
  eq(orows, ["ideas-out:2026-10-16"], "the retried outcome row was identical, so it is not recorded twice");
  eq((await CAL.runCalibration(S.deps("not-a-date"))).state, "skipped", "a run with no session date does nothing");
}

{
  const S = makeStore();
  archiveNight(S, "2026-09-14", [pcs("AAA", "2026-10-16")]);
  S.m.set("ideas:2026-09-15", { v: 2, sessionDate: "2026-09-30", rows: [] });
  S.m.set("ideas:2026-09-16", { v: 2, sessionDate: "2026-09-16", rows: [{ t: "BAD", id: "x", trial: { legs: "no" } }, null, { t: "THIN", id: "iron-condor", structure: "iron condor", dir: null, grade: 1 }] });
  S.barsHeld.set("AAA", { bars: flat("2026-09-14", "2026-10-16", 100), breaks: [] });
  const r = await CAL.runCalibration(S.deps("2026-10-16"));
  eq([r.outside, r.malformed, S.m.get("calib").counts.resolved], [1, 2, 1], "an archive row dated differently from its key, and rows that are not trials, are skipped and counted; a thin row with no trial is not a malformed one");
  const wide = CAL.readWindow({ sessionDate: "2026-10-16", through: "2025-01-01", firstArchive: null });
  ok(wide.length <= 145, `a run that missed months reads at most the capped window (${wide.length} weekdays)`);
  eq(CAL.readWindow({ sessionDate: "2026-10-16", through: null, firstArchive: "2026-10-12" }), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"], "and never reads before the first archive it has seen");
}

{
  const src = fs.readFileSync(path.join(ROOT, "scripts/flows-legs/calibration.mjs"), "utf8");
  ok(!/\bfetch\(|process\.env|Date\.now|new Date\(\)/.test(src), "the leg has no network, environment or clock of its own: its vendor, store and bars come in through its arguments");
  ok(/ideas:\$\{d\}/.test(src) && !/ideas:\$\{sessionDate\}/.test(src), "and no read key is built from the run's own session date");
}

console.log(`✓ flows-calibration: ${checks} assertions`);
