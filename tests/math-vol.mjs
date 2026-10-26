import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as V from "../shared/flows-vol.js";
import * as S from "../shared/flows-stats.js";
import * as FE from "../shared/flows-features.js";
import * as CR from "../shared/flows-cross.js";
import * as SM from "../shared/flows-quant-smile.js";
import * as EV from "../shared/flows-event-variance.js";
import * as WORLD from "../shared/flows-quant-world.js";
import { GARCH_ANNUALISE } from "../shared/flows-garch.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-vol.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-vol-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

const close = (a, b, rel, abs = 0) => {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));
};

function problems() {
  const bad = [];
  return { bad, say: (m) => { if (bad.length < 10) bad.push(m); } };
}

function volBattery(M) {
  const { bad, say } = problems();
  for (const sc of FX.series) {
    const bars = sc.bars.map(([d, o, h, l, c]) => ({ d, o, h, l, c }));
    const e = sc.expect;
    for (const n of [5, 10, 21, 63]) {
      if (!close(M.closeToCloseVol(bars, n), e.c2c[n], 1e-12)) say(`${sc.name}: close-to-close ${n} ${M.closeToCloseVol(bars, n)} against ${e.c2c[n]}`);
      const yz = M.yangZhang(bars, n).vol;
      if (!close(yz, e.yz[n], 1e-12)) say(`${sc.name}: Yang-Zhang ${n} ${yz} against ${e.yz[n]}`);
      const pk = M.parkinsonVol(bars, n).vol;
      if (!close(pk, e.park[n], 1e-12)) say(`${sc.name}: Parkinson ${n} ${pk} against ${e.park[n]}`);
      const gp = M.gapShare(bars, n).share;
      if (!close(gp, e.gap[n], 1e-11)) say(`${sc.name}: overnight share ${n} ${gp} against ${e.gap[n]}`);
    }
    const roll = M.rollingVol(e.returns, 21);
    if (roll.length !== e.roll21.length) say(`${sc.name}: ${roll.length} rolling windows against ${e.roll21.length}`);
    else for (let k = 0; k < roll.length; k++) if (roll[k].i !== e.roll21[k][0] || !close(roll[k].vol, e.roll21[k][1], 1e-9)) { say(`${sc.name}: rolling window ${k} ${roll[k].vol} against ${e.roll21[k][1]}`); break; }
    const daily = M.dailyYangZhangVariance(bars);
    if (daily.length !== e.daily.length) say(`${sc.name}: ${daily.length} daily variances against ${e.daily.length}`);
    else for (let k = 0; k < daily.length; k++) if (!close(daily[k].v, e.daily[k], 1e-12, 1e-18)) { say(`${sc.name}: daily Yang-Zhang variance ${k} ${daily[k].v} against ${e.daily[k]}`); break; }
    const est = M.rvEstimators({ closes: bars.map((b) => b.c), highLow: bars.map((b) => [b.h, b.l]) });
    for (const k of ["closeToClose", "zeroMeanRms", "parkinson"]) if (!close(est[k], e.estimators[k], 1e-12)) say(`${sc.name}: ${k} ${est[k]} against ${e.estimators[k]}`);
  }
  for (const rc of FX.rank) {
    const got = M.ivRankPercentile(rc.history, rc.current);
    if (!close(got.rank, rc.rank, 1e-12)) say(`rank of ${rc.current} in ${rc.history.length} values (today ${rc.todayIn ? "in" : "out"}): ${got.rank} against ${rc.rank}`);
    if (!close(got.percentile, rc.pct, 1e-12)) say(`percentile of ${rc.current} in ${rc.history.length} values (today ${rc.todayIn ? "in" : "out"}): ${got.percentile} against ${rc.pct}`);
  }
  for (const ec of FX.event) {
    const f = M.forwardVol(ec.front, ec.back);
    if ((f.code ?? null) !== ec.fwd.code) say(`${ec.kind} forward code ${f.code} against ${ec.fwd.code}`);
    else if (ec.fwd.code === null && !close(f.vol, ec.fwd.vol, 1e-10)) say(`${ec.kind} forward ${f.vol} against ${ec.fwd.vol}`);
  }
  for (const zc of FX.z) {
    const got = M.zAgainst(zc.x, zc.xs, { min: zc.min });
    if (zc.degenerate) { if (got.z !== null || got.code !== "degenerate") say(`a constant history of ${zc.n} values of ${zc.x}: z ${got.z} (${got.code})`); }
    else if (!close(got.z, zc.z, 1e-12, 1e-12)) say(`z of ${zc.x} against ${zc.n} values: ${got.z} against ${zc.z}`);
  }
  return bad;
}

function eventBattery(terms, shape = (r) => r) {
  const { bad, say } = problems();
  for (const ec of FX.event) {
    const got = shape(terms(ec.front, ec.back));
    const e = ec.expect;
    if ((got.code ?? null) !== e.code) { say(`${ec.kind} event ${JSON.stringify(ec.front)} ${JSON.stringify(ec.back)}: code ${got.code} against ${e.code}`); continue; }
    if (e.code === null || e.code === "no-premium") {
      if (!close(got.diffusiveVol, e.diffusive, 1e-9)) say(`${ec.kind} event: diffusive ${got.diffusiveVol} against ${e.diffusive}`);
    }
    if (e.code === null) {
      if (!close(got.eventSd, e.sd, 1e-8)) say(`${ec.kind} event: sd ${got.eventSd} against ${e.sd}`);
      if (!close(got.eventMeanAbs, e.meanAbs, 1e-8)) say(`${ec.kind} event: mean absolute ${got.eventMeanAbs} against ${e.meanAbs}`);
    } else if (got.eventSd !== null || got.eventMeanAbs !== null) say(`${ec.kind} event with code ${e.code} still carries a figure: ${got.eventSd}`);
  }
  for (const s of [0.2, 0.4, 1.1]) {
    const a = terms({ vol: s, T: 7 / 365 }, { vol: s, T: 30 / 365 });
    const b = shape(a);
    if ((b.code ?? null) !== "no-premium") say(`a flat curve at ${s} is ${b.code}`);
  }
  return bad;
}

const WHY_TO_CODE = { "event.slices": "input-absent", "event.inverted": "calendar-arbitrage", "event.no-premium": "no-premium" };

function adapterBattery(Sm) {
  const { bad, say } = problems();
  for (const ec of FX.event) {
    const leaf = EV.eventTerms(ec.front, ec.back);
    const a = V.eventVariance(ec.front, ec.back);
    const b = Sm.eventVariance({ front: ec.front, back: ec.back });
    if (JSON.stringify(a) !== JSON.stringify(leaf)) say(`${ec.kind} flows-vol event ${JSON.stringify(a)} against the leaf ${JSON.stringify(leaf)}`);
    const code = b.why === null ? null : WHY_TO_CODE[b.why];
    if (code !== leaf.code || b.eventSd !== leaf.eventSd || b.eventMeanAbs !== leaf.eventMeanAbs || b.diffusiveVol !== leaf.diffusiveVol) say(`${ec.kind} smile event ${JSON.stringify(b)} against the leaf ${JSON.stringify(leaf)}`);
  }
  return bad;
}

const nudged = (x) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
};

function statsBattery(St, Fe) {
  const { bad, say } = problems();
  for (const v of [0.1, 0.3, 1.1, 12.3]) {
    for (const n of [3, 40, 252]) {
      const xs = Array(n).fill(v);
      xs[n - 1] = nudged(v);
      if (St.sampleVar(xs) !== 0) say(`one value an ulp above ${v} in ${n} has a variance of ${St.sampleVar(xs)}, not the exact zero the rounding floor gives`);
      const ys = Array(n).fill(v);
      ys[n - 1] = v * (1 + 1e-7);
      if (!(St.sampleVar(ys) > 0)) say(`one value 1e-7 above ${v} in ${n} makes no variance`);
      const zs = Array(n).fill(v);
      zs[n - 1] = v * (1 + 2e-9);
      if (!(St.sampleVar(zs) > 0)) say(`one value 2e-9 above ${v} in ${n} makes no variance`);
      const flatY = Array.from({ length: n }, (_, i) => i);
      if (St.pearson(flatY, xs) !== null || St.spearman(flatY, xs) !== null) say(`a correlation against a series an ulp from constant is not null (${n} points)`);
    }
  }
  if (St.sampleVar([1e5, 1e5 + 1e-3, 1e5 + 2e-3]) <= 0) say("a price of 1e5 moving by a tenth of a cent is real data and has a variance");
  if (St.sampleVar([0, 2.220446049250313e-16, -2.220446049250313e-16]) <= 0) say("a returns series of a few ulps around zero is judged against its own scale and has a variance");
  for (const n of [3, 10, 60, 252]) {
    for (const [a, b] of [[1, 0], [2, 1], [0.1, 3.3], [7.77, -2.1], [-0.3, 0.7], [1e-3, 5]]) {
      const x = Array.from({ length: n }, (_, i) => Math.sin(i) * 3 + i / 7);
      const r = St.pearson(x, x.map((v) => a * v + b)), r2 = St.pearson(x, x.map((v) => -a * v + b));
      const s = Math.sign(a);
      if (!(Math.abs(r) <= 1 && s * r >= 1 - 1e-12) || !(Math.abs(r2) <= 1 && -s * r2 >= 1 - 1e-12)) say(`exactly collinear data (${n} points, slope ${a}) gives ${r} and ${r2}, not ${s} and ${-s}`);
    }
  }
  for (const pc of FX.pearson) {
    const got = St.pearson(pc.x, pc.y);
    if (pc.r === null ? got !== null : !close(got, pc.r, 1e-12, 1e-12)) say(`pearson of ${pc.x.length} points (${pc.x[0]}, ${pc.y[0]}): ${got} against ${pc.r}`);
  }
  for (const fc of FX.flatVar) {
    const got = St.sampleVar(fc.values);
    if (got !== 0) say(`the variance of ${fc.values.length} copies of ${fc.values[0]} is ${got}, not exactly zero`);
  }
  for (const xc of FX.xsec) {
    const v = xc.values;
    const head = JSON.stringify(v).slice(0, 56);
    const pr = St.percentileRank(v);
    if (pr.length !== xc.percentileRank.length || pr.some((x, i) => !close(x, xc.percentileRank[i], 1e-12))) say(`average-rank percentile of ${head}: ${JSON.stringify(pr).slice(0, 70)} against ${JSON.stringify(xc.percentileRank).slice(0, 70)}`);
    v.forEach((x, i) => { if (xc.share[i] !== null && !close(St.shareAtOrBelow(x, v), xc.share[i], 1e-12)) say(`share at or below ${x} in ${head}: ${St.shareAtOrBelow(x, v)} against ${xc.share[i]}`); });
    if (xc.var !== null && !close(St.sampleVar(v), xc.var, 1e-12, 1e-15)) say(`sample variance of ${head}: ${St.sampleVar(v)} against ${xc.var}`);
    for (const [p, want] of Object.entries(xc.quantile)) if (!close(St.quantile(v, Number(p)), want, 1e-12, 1e-12)) say(`quantile ${p} of ${head}: ${St.quantile(v, Number(p))} against ${want}`);
    if (Fe) {
      for (const [p, want] of Object.entries(xc.winsorize)) {
        const got = Fe.winsorize(v, Number(p));
        if (got.length !== want.length || got.some((x, i) => !(want[i] === null ? !Number.isFinite(x) : close(x, want[i], 1e-12, 1e-12)))) say(`winsorize at ${p} of ${head}: ${JSON.stringify(got).slice(0, 70)} against ${JSON.stringify(want).slice(0, 70)}`);
      }
      const z = Fe.robustZ(v);
      if (z.length !== xc.robustZ.length || z.some((x, i) => !close(x, xc.robustZ[i], 5e-5, 5e-5))) say(`robust z of ${head}: ${JSON.stringify(z).slice(0, 80)} against ${JSON.stringify(xc.robustZ).slice(0, 80)}`);
      const clean = v.filter((x) => x !== null);
      if (xc.mad !== null && !close(Fe.mad(clean), xc.mad, 2e-6)) say(`scaled median absolute deviation ${Fe.mad(clean)} against ${xc.mad}`);
    }
  }
  if (Fe) {
    for (const mc of FX.move) {
      const got = Fe.horizonMove(mc.vol, { sessions: mc.sessions });
      if (!close(got, mc.move, 1e-14)) say(`horizon move of ${mc.vol} over ${mc.sessions} sessions: ${got} against ${mc.move}`);
    }
    if (Fe.horizonMove(0) !== null || Fe.horizonMove(null) !== null || Fe.horizonMove(0.3, { sessions: 0 }) !== null) say("a zero volatility, an absent one or a zero horizon is not a move");
  }
  return bad;
}

eq(volBattery(V).join("; "), "", `${FX.series.length} bar histories (close-to-close, Yang-Zhang, Parkinson, overnight share, a rolling 21-session window, the daily range variance) at a 252-session year and ddof 1, ${FX.rank.length} rank and percentile cases (percentile is the share at or below, today included when it is in the history), ${FX.event.length} term-structure cases (event move and forward volatility, exact rational algebra) and ${FX.z.length} z-scores, held to numpy, scipy and mpmath`);
eq(statsBattery(S, FE).join("; "), "", `Pearson, the average-rank percentile, the linear quantile, winsorising, the robust z and the horizon move held to numpy and scipy over ${FX.xsec.length} vectors with ties, holes and flat series`);

const FLAT = FX.event.filter((e) => e.kind === "flat");
ok(FLAT.length > 300 && FLAT.every((e) => e.expect.code === "no-premium"), "the fixture holds a flat term structure at many tenors, which the exact algebra reads as no event premium");
ok(FLAT.every((e) => V.eventVariance(e.front, e.back).code === "no-premium" && V.eventVariance(e.front, e.back).eventSd === null), "so a flat curve is no event premium and never a zero-sized event move");

const plan = FX.rank[0];
ok(plan.history.length === 253 && close(plan.rank, 1 / 6, 1e-12) && close(plan.pct, 252 / 253, 1e-12), "the audit's fixture: 251 sessions at 20 per cent, one at 80, today 30 gives a rank of 16.7 per cent and a percentile of 99.6 per cent, 83 points apart");
const rp = V.ivRankPercentile(plan.history, 0.3);
ok(Math.round(rp.rank * 1000) / 10 === 16.7 && Math.round(rp.percentile * 1000) / 10 === 99.6, "and production prints both figures from them");

for (const [name, a, b] of [
  ["the trading year", FE.TRADING_YEAR, V.TRADING_YEAR],
  ["the garch annualiser squared", Math.round(GARCH_ANNUALISE ** 2 * 1e9) / 1e9, 252],
]) eq(a, b, `${name} is 252 sessions in every module that annualises`);
eq(V.CALENDAR_YEAR, 365, "and the implied side's calendar year is 365 days");

const smileShape = (r) => ({ ...r, code: r.why === null ? null : WHY_TO_CODE[r.why] });
const smileTerms = (front, back) => SM.eventVariance({ front, back });
eq(eventBattery(EV.eventTerms).join("; "), "", `the event move of ${FX.event.length} term structures (the front expiry's variance in excess of the diffusive forward variance) held to exact rational algebra, with a flat curve no premium at every tenor`);
eq(eventBattery(V.eventVariance).join("; "), "", "and flows-vol.js answers the same");
eq(eventBattery(smileTerms, smileShape).join("; "), "", "and so does flows-quant-smile.js, which now carries no formula of its own");
eq(adapterBattery(SM).join("; "), "", "the two callers return what the one leaf returns, figure for figure, with the smile's reasons mapped one to one");
const rankBad = [];
for (const rc of FX.rank) {
  const a = V.ivRankPercentile(rc.history, rc.current);
  const b = WORLD.ivRankPercentile({ history: rc.history, current: rc.current });
  if (!(close(a.rank, b.rank, 1e-15) && close(a.percentile, b.percentile, 1e-15)) && rankBad.length < 5) rankBad.push(`${rc.current} in ${rc.history.length}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`);
}
eq(rankBad.join("; "), "", "the two IV rank and percentile implementations (flows-vol.js and the quant world) agree whether or not today is in the history");
const pctBad = [];
for (const xc of FX.xsec) {
  const vals = xc.values.map((x) => (x === null ? NaN : x));
  const a = CR.pctRanks(vals);
  vals.forEach((x, i) => { const b = S.shareAtOrBelow(x, vals); if (!close(a[i], b, 1e-15) && pctBad.length < 5) pctBad.push(`${x}: ${a[i]} against ${b}`); });
  vals.forEach((x) => { const b = CR.pctOf(vals, x); const c = S.shareAtOrBelow(x, vals); if (!close(b, c, 1e-15) && pctBad.length < 5) pctBad.push(`pctOf ${x}: ${b} against ${c}`); });
}
eq(pctBad.join("; "), "", "the three share-at-or-below implementations (flows-stats.js, and pctRanks and pctOf in flows-cross.js) agree on every vector");

const ownBad = [];
for (const zc of FX.z) {
  const got = CR.ownZ(zc.xs, zc.x, { min: zc.min });
  if (zc.degenerate ? got.z !== null : !close(got.z, zc.z, 1e-12, 1e-12)) ownBad.push(`${zc.x} against ${zc.n}: ${got.z}`);
}
eq(ownBad.join("; "), "", "the cross module's own-history z-score gives the same z, and no z at all for a constant history");

const VOL_MUTANTS = [
  ["realized volatility annualised on 365 days", [["const closeToClose = sd === null ? null : sd * Math.sqrt(TRADING_YEAR);", "const closeToClose = sd === null ? null : sd * Math.sqrt(CALENDAR_YEAR);"]]],
  ["the rolling window divides by n", [["const v = (s2 - (s * s) / n) / (n - 1);", "const v = (s2 - (s * s) / n) / n;"]]],
  ["the Yang-Zhang weight is inverted", [["const k = 0.34 / (1.34 + (n + 1) / (n - 1));\n  const s2", "const k = 0.34 / (1.34 + (n - 1) / (n + 1));\n  const s2"]]],
  ["the Yang-Zhang range term takes the wrong weight", [["+ (1 - k) * (rs.reduce((a, b) => a + b, 0) / n);", "+ k * (rs.reduce((a, b) => a + b, 0) / n);"]]],
  ["the Parkinson constant is halved", [["return { vol: Math.sqrt((s / (4 * n * Math.LN2)) * TRADING_YEAR), code: null };", "return { vol: Math.sqrt((s / (2 * n * Math.LN2)) * TRADING_YEAR), code: null };"]]],
  ["the overnight share is upside down", [["return { share: vo / vc, code: null };", "return { share: vc / vo, code: null };"]]],
  ["the percentile is strict", [["percentile: shareAtOrBelow(x, h),", "percentile: h.filter((v) => v < x).length / h.length,"]]],
  ["the rank divides by the high", [["rank: hi > lo ? (x - lo) / (hi - lo) : null,", "rank: hi > lo ? (x - lo) / hi : null,"]]],
  ["the forward divides by the back time", [["return { vol: Math.sqrt(w / (t2 - t1)), code: null };", "return { vol: Math.sqrt(w / t2), code: null };"]]],
  ["the rank is taken over the history alone", [["const lo = Math.min(...h, x);\n  const hi = Math.max(...h, x);", "const lo = Math.min(...h);\n  const hi = Math.max(...h);"]]],
  ["the z-score is not scaled", [["return { z: (x - m) / sd, n: v.length, mean: m, sd, code: null };", "return { z: (x - m), n: v.length, mean: m, sd, code: null };"]]],
];
const EVENT_MUTANTS = [
  ["the event move is taken on the back expiry's time", [["const j2 = t1 * t2 * (s1 - s2) * (s1 + s2) / (t2 - t1);", "const j2 = t2 * t2 * (s1 - s2) * (s1 + s2) / (t2 - t1);"]]],
  ["the mean absolute move is the wrong multiple", [["eventMeanAbs: j * Math.sqrt(2 / Math.PI), code: null", "eventMeanAbs: j * Math.sqrt(1 / Math.PI), code: null"]]],
  ["the premium is a difference of products, so a flat curve reads as an event", [["const j2 = t1 * t2 * (s1 - s2) * (s1 + s2) / (t2 - t1);", "const j2 = s1 * s1 * t1 - sd2 * t1;"]]],
  ["the diffusive variance divides by the back time", [["const sd2 = (s2 * s2 * t2 - s1 * s1 * t1) / (t2 - t1);", "const sd2 = (s2 * s2 * t2 - s1 * s1 * t1) / t2;"]]],
  ["a falling total variance is not flagged", [["if (!(sd2 > 0)) return { ...none, code: \"calendar-arbitrage\" };", ""]]],
  ["a back expiry that is not later is accepted", [["|| !(t2 > t1)) return", "|| !(t2 >= t1)) return"]]],
];
const STATS_MUTANTS = [
  ["a one-ulp difference has a variance", "shared/flows-stats.js", [["return hi - lo <= DEGENERATE_REL * big;", "return hi === lo;"]]],
  ["a real spread is called flat", "shared/flows-stats.js", [["export const DEGENERATE_REL = 1e-9;", "export const DEGENERATE_REL = 1e-3;"]]],
  ["spearman ranks the noise", "shared/flows-stats.js", [["  if (isFlat(pts.map((p) => p[0])) || isFlat(pts.map((p) => p[1]))) return null;\n  return pearson(ranks(", "  return pearson(ranks("]]],
  ["a correlation can exceed one", "shared/flows-stats.js", [["Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)))", "sxy / Math.sqrt(sxx * syy)"]]],
  ["the variance divides by n", "shared/flows-stats.js", [["/ (v.length - 1);\n}", "/ v.length;\n}"]]],
  ["a constant series has a noise variance", "shared/flows-stats.js", [["if (flat(v)) return 0;", ""]]],
  ["a constant series has a correlation", "shared/flows-stats.js", [["  if (isFlat(pts.map((p) => p[0])) || isFlat(pts.map((p) => p[1]))) return null;\n  let mx = 0", "  let mx = 0"]]],
  ["the percentile rank divides by m", "shared/flows-stats.js", [["out[idx[k]] = avgRank / (m + 1);", "out[idx[k]] = avgRank / m;"]]],
  ["ties take the lowest rank", "shared/flows-stats.js", [["const avgRank = (i + j) / 2 + 1;", "const avgRank = i + 1;"]]],
  ["the share at or below is strict", "shared/flows-stats.js", [["for (const y of v) if (y <= x) k++;", "for (const y of v) if (y < x) k++;"]]],
  ["the quantile rounds up to the next value", "shared/flows-stats.js", [["const lo = Math.floor(h);\n  const hi = Math.ceil(h);\n  return sorted[lo] + (h - lo)", "const lo = Math.ceil(h);\n  const hi = Math.ceil(h);\n  return sorted[lo] + (h - lo)"]]],
  ["the median absolute deviation is unscaled", "shared/flows-features.js", [["return 1.4826 * median(xs.map", "return median(xs.map"]]],
  ["winsorising clips the top at the bottom quantile", "shared/flows-features.js", [["const hi = quantile(values, 1 - p);", "const hi = quantile(values, p);"]]],
  ["the robust z clamps at five", "shared/flows-features.js", [["export function robustZ(values, { clamp = 3 } = {}) {", "export function robustZ(values, { clamp = 5 } = {}) {"]]],
  ["the robust z scale is the deviation alone", "shared/flows-features.js", [["let scale = Math.max(mad(ok, m), span(0.25, 0.75, 1.349), span(0.10, 0.90, 2.563));\n\n  if (!Number.isFinite(scale) || scale <= 1e-12) {\n    const mean", "let scale = mad(ok, m);\n\n  if (!Number.isFinite(scale) || scale <= 1e-12) {\n    const mean"]]],
  ["the horizon move uses the calendar year", "shared/flows-features.js", [["export function horizonMove(annualVol, { sessions = HORIZON_SESSIONS, periodsPerYear = TRADING_YEAR } = {}) {", "export function horizonMove(annualVol, { sessions = HORIZON_SESSIONS, periodsPerYear = 365 } = {}) {"]]],
];
const salt = () => Math.floor(Math.random() * 1e6);
for (const [name, transforms] of VOL_MUTANTS) {
  let mod;
  try { mod = await loadMutated("shared/flows-vol.js", transforms, { salt: salt() }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(volBattery(mod).length > 0, `planted wrong build must fail: ${name}`);
}
for (const [name, transforms] of EVENT_MUTANTS) {
  let mod;
  try { mod = await loadMutated("shared/flows-event-variance.js", transforms, { salt: salt() }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(eventBattery(mod.eventTerms).length > 0, `planted wrong build must fail: ${name}`);
}
{
  let mod;
  try { mod = await loadMutated("shared/flows-quant-smile.js", [["\"no-premium\": \"event.no-premium\"", "\"no-premium\": \"event.inverted\""]], { salt: salt() }); } catch (e) { assert.fail(`the planted build 'the smile's no-premium reason is the inverted one' did not load: ${e.message}`); }
  ok(adapterBattery(mod).length > 0, "planted wrong build must fail: the smile's no-premium reason is the inverted one");
}
for (const [name, rel, transforms] of STATS_MUTANTS) {
  let mod;
  try { mod = await loadMutated(rel, transforms, { salt: salt() }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  const bad = rel.endsWith("flows-stats.js") ? statsBattery(mod, null) : statsBattery(S, mod);
  ok(bad.length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-vol: ${checks} assertions - realized volatility, Yang-Zhang, Parkinson, the overnight share, IV rank against percentile, event variance, forward volatility, the z-score, Pearson, percentile rank, quantile, winsorising and the robust z held to numpy, scipy and exact rational algebra, a flat curve and a constant series read as no premium and no correlation, the duplicate implementations agree, and ${VOL_MUTANTS.length + EVENT_MUTANTS.length + STATS_MUTANTS.length + 1} planted wrong builds that each fail`);
