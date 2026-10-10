import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as D from "../shared/flows-dispersion.js";
import * as ST from "../shared/flows-stats.js";
import * as LEG from "../scripts/flows-legs/dispersion.mjs";
import { isoWeek } from "../scripts/flows-legs/calibration.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => { assert.ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`); checks++; };

const normal = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

function factorWorld({ n = 30, T = 3000, rho = 0.45, seed = 11, vol = 0.30 }) {
  const rng = ST.mulberry32(seed);
  const weightsRaw = Array.from({ length: n }, (_, i) => 1 / (i + 2));
  const total = weightsRaw.reduce((a, b) => a + b, 0);
  const names = Array.from({ length: n }, (_, i) => "M" + String(i).padStart(2, "0"));
  const sd = Array.from({ length: n }, (_, i) => (vol * (0.7 + 0.6 * (i % 7) / 6)) / Math.sqrt(252));
  const members = names.map((t, i) => ({ t, w: weightsRaw[i] / total, sd: sd[i], iv: sd[i] * Math.sqrt(252) }));
  const r = names.map(() => new Array(T));
  for (let t = 0; t < T; t++) {
    const f = normal(rng);
    for (let i = 0; i < n; i++) r[i][t] = sd[i] * (Math.sqrt(rho) * f + Math.sqrt(1 - rho) * normal(rng));
  }
  return { members, r, rho };
}

{
  eq(D.indexWeights([{ t: "A", w: 30 }, { t: "B", w: 10 }, { t: "A", w: 10 }, { t: "C", w: 0 }, { t: "D", w: null }, null]), [{ t: "A", w: 0.8 }, { t: "B", w: 0.2 }], "weights are normalised, a repeated ticker is summed and an empty one dropped");
  eq(D.indexWeights([]), [], "no holdings, no weights");
  ok(D.ivUsable(0.3) && !D.ivUsable(30) && !D.ivUsable(0.001) && !D.ivUsable(null) && !D.ivUsable(NaN), "an implied volatility must be a plausible annualised fraction: 30 (a percent) is refused, not scaled");
  const ret = D.logReturns([100, 110, null, 120, 0, 130]);
  near(ret[0], Math.log(1.1), 1e-12, "a log return");
  eq(ret.slice(1), [null, null, null, null], "a missing, zero or adjacent-to-missing close gives no return, never a zero");
}

{
  const W = factorWorld({ n: 30, T: 4000, rho: 0.45 });
  const members = W.members.map((m, i) => ({ t: m.t, w: m.w, r: W.r[i] }));
  const real = D.realisedCorrelation({ members, window: 4000 });
  near(real.rho, 0.45, 0.025, `a factor world with correlation 0.45 is recovered from 4000 days (${real.rho})`);
  eq([real.covered, real.excluded], [30, { noBars: 0, flat: 0, break: 0 }], "all thirty members are covered");

  const used = members.map((m) => ({ w: m.w, r: m.r.slice(-500) }));
  const sds = used.map((m) => Math.sqrt(ST.sampleVar(m.r)));
  let num = 0, den = 0;
  for (let i = 0; i < used.length; i++) for (let j = i + 1; j < used.length; j++) {
    const k = used[i].w * used[j].w * sds[i] * sds[j];
    num += k * ST.pearson(used[i].r, used[j].r);
    den += k;
  }
  near(D.realisedCorrelation({ members, window: 500 }).rho, num / den, 1e-4, "THE PORTFOLIO FORM EQUALS THE BRUTE-FORCE WEIGHTED AVERAGE OF ALL PAIRWISE CORRELATIONS");
  const scaled = members.map((m) => ({ ...m, w: m.w * 7 }));
  near(D.realisedCorrelation({ members: scaled, window: 500 }).rho, D.realisedCorrelation({ members, window: 500 }).rho, 1e-4, "and does not depend on the scale of the weights");

  const holes = members.map((m, i) => (i === 3 ? { ...m, r: m.r.map((x, k) => (k === m.r.length - 5 ? null : x)) } : i === 4 ? { ...m, r: m.r.map(() => 0) } : m));
  const withHoles = D.realisedCorrelation({ members: holes, window: 63 });
  eq([withHoles.covered, withHoles.excluded], [28, { noBars: 1, flat: 1, break: 0 }], "a member with a missing day in the window and a member that did not move are left out and counted");
  ok(withHoles.weightExcluded > 0 && withHoles.weightCovered + withHoles.weightExcluded > 0.999, "with their weight reported");
  eq(D.realisedCorrelation({ members: members.slice(0, 10), window: 63 }).why, "coverage", "ten members are too few for a reading");
  eq(D.realisedCorrelation({ members: members.map((m) => ({ ...m, r: m.r.slice(-5) })), window: 21 }).why, "coverage", "five days are too few for a 21-day window");
  near(real.avgVol, D.realisedCorrelation({ members, window: 4000 }).avgVol, 0, "the weighted average member volatility is reported annualised");
  ok(real.avgVol > 0.25 && real.avgVol < 0.45, `and lands where the world put it (${real.avgVol})`);

  const idx = (rho, list) => {
    const s1 = list.reduce((a, m) => a + m.w * m.iv, 0);
    const s2 = list.reduce((a, m) => a + m.w * m.w * m.iv * m.iv, 0);
    return Math.sqrt(s2 + rho * (s1 * s1 - s2));
  };
  const imp = D.impliedCorrelation({ indexIv: idx(0.45, W.members), members: W.members });
  near(imp.rho, 0.45, 1e-3, "the implied correlation recovers the correlation an index implied volatility was built from");
  eq([imp.covered, imp.weightCovered, imp.why, imp.clamped], [30, 1, null, false], "over all thirty members");
  near(imp.ratio, idx(0.45, W.members) / imp.avgIv, 1e-3, "the index to average-member volatility ratio is the dispersion context");
  ok(imp.ratio < 1, `an index trades under the average of its members' volatilities (${imp.ratio})`);

  const high = D.impliedCorrelation({ indexIv: 1.2, members: W.members });
  eq([high.rho, high.clamped], [1, true], "an index volatility the members cannot reproduce is clamped to 1 and says so");
  ok(high.raw > 1, `with the raw figure kept (${high.raw})`);
  eq(D.impliedCorrelation({ indexIv: null, members: W.members }).why, "index-iv", "no index volatility, no reading");
  eq(D.impliedCorrelation({ indexIv: 0.3, members: W.members.slice(0, 10) }).why, "coverage", "ten members, no reading");
  const noIv = D.impliedCorrelation({ indexIv: 0.3, members: W.members.map((m, i) => (i % 2 ? { ...m, iv: 35 } : m)) });
  eq([noIv.excluded.noIv, noIv.covered], [15, 15], "members whose implied volatility is not a plausible fraction are excluded and counted");
  eq(noIv.why, "coverage", "and with half the weight gone there is no reading");

  const big = W.members[0];
  const jump = 0.15;
  const J2 = (jump * jump) * (365 / 30);
  const wk = 0.02;
  const others = W.members.slice(1).map((m) => ({ ...m, w: m.w * (1 - wk) / (1 - big.w) }));
  const k = { ...big, w: wk };
  const exVol = [k, ...others];
  const s1 = exVol.reduce((a, m) => a + m.w * m.iv, 0);
  const s2 = exVol.reduce((a, m) => a + m.w * m.w * m.iv * m.iv, 0);
  const kTotal2 = k.iv * k.iv + J2;
  const indexVar = (s2 - wk * wk * k.iv * k.iv + wk * wk * kTotal2) + 0.45 * (s1 * s1 - s2);
  const withJump = [{ ...k, iv: Math.sqrt(kTotal2), event: false }, ...others];
  const naive = D.impliedCorrelation({ indexIv: Math.sqrt(indexVar), members: withJump });
  const excl = D.impliedCorrelation({ indexIv: Math.sqrt(indexVar), members: withJump.map((m, i) => (i === 0 ? { ...m, event: true } : m)) });
  ok(Math.abs(excl.rho - 0.45) < Math.abs(naive.rho - 0.45), `A PLANTED EARNINGS JUMP: leaving the reporting member out lands nearer the truth (${excl.rho}) than keeping its jump in (${naive.rho}), against 0.45`);
  ok(Math.abs(excl.rho - 0.45) < 0.02, `and within two points of it, the rest being the excluded member's own variance that stays in the index (${excl.rho})`);
  ok(naive.rho < 0.45, "the jump left in biases the figure down, because it inflates the denominator more than the numerator");
  eq([excl.excluded.event, excl.covered, excl.weightExcluded], [1, 29, 0.02], "and the exclusion is counted with its weight");
}

{
  const build = (n, het) => {
    const ms = Array.from({ length: n }, (_, i) => ({ t: "M" + i, w: het ? 1 / (i + 3) : 1 }));
    const tot = ms.reduce((a, m) => a + m.w, 0);
    ms.forEach((m, i) => { m.w /= tot; m.iv = het ? 0.2 + 0.3 * ((i * 37) % 11) / 10 : 0.3; });
    return ms;
  };
  const indexOf = (rho, ms) => {
    const s1 = ms.reduce((a, m) => a + m.w * m.iv, 0), s2 = ms.reduce((a, m) => a + m.w * m.w * m.iv * m.iv, 0);
    return Math.sqrt(s2 + rho * (s1 * s1 - s2));
  };
  const spread = (ms, target) => {
    const out = new Set();
    let acc = 0;
    for (let i = 0; i < ms.length && acc < target - 1e-9; i++) { const j = (i * 7) % ms.length; if (out.has(j)) continue; out.add(j); acc += ms[j].w; }
    return out;
  };
  for (const [het, tol] of [[false, 0.005], [true, 0.06]]) {
    const ms = build(100, het);
    for (const rho of [0.3, 0.45, 0.7]) {
      const idx = indexOf(rho, ms);
      for (const share of [0, 0.05, 0.1, 0.2, 0.3]) {
        const gone = spread(ms, share);
        const r = D.impliedCorrelation({ indexIv: idx, members: ms.map((m, i) => ({ ...m, event: gone.has(i) })) });
        near(r.rho, rho, tol, `EXCLUDED WEIGHT DOES NOT BIAS THE IMPLIED FIGURE: ${Math.round(share * 100)}% of the weight excluded, ${het ? "mixed" : "equal"} volatilities, planted ${rho} (${r.rho})`);
        eq(r.imputed, gone.size, "and the stand-ins are counted");
      }
    }
  }
  const ms = build(100, false);
  const idx = indexOf(0.45, ms);
  const top = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const noIv = D.impliedCorrelation({ indexIv: idx, members: ms.map((m, i) => (top.has(i) ? { ...m, iv: null } : m)) });
  near(noIv.rho, 0.45, 0.005, "members with no usable implied volatility are stood in for the same way");
  eq([noIv.excluded.noIv, noIv.imputed], [10, 10], "and counted");
  const gone = spread(ms, 0.1);
  const deep = D.impliedCorrelation({ indexIv: idx, members: ms.map((m, i) => ({ ...m, event: gone.has(i) })) });
  eq([deep.avgIv, deep.ratio === D.impliedCorrelation({ indexIv: idx, members: ms }).ratio], [0.3, true], "the average member volatility and the ratio come from the covered members alone");
}

{
  const W = factorWorld({ n: 40, T: 70, rho: 0.5, seed: 5 });
  const members = W.members.map((m) => ({ t: m.t, w: m.w, iv: m.iv, event: false }));
  const dates = [];
  for (let d = Date.parse("2026-06-01T00:00:00Z"); dates.length < 71; d += 86400000) { const w = new Date(d).getUTCDay(); if (w && w !== 6) dates.push(new Date(d).toISOString().slice(0, 10)); }
  const px = (i) => { let c = 100; const out = [[dates[0], c]]; for (let t = 0; t < 70; t++) { c *= Math.exp(W.r[i][t]); out.push([dates[t + 1], c]); } return out; };
  const series = new Map(members.map((m, i) => [m.t, px(i)]));
  const s1 = members.reduce((a, m) => a + m.w * m.iv, 0), s2 = members.reduce((a, m) => a + m.w * m.w * m.iv * m.iv, 0);
  const indexIv = Math.sqrt(s2 + 0.4 * (s1 * s1 - s2));
  const out = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "qqq-holdings:2026-09-01", indexIv, members, series });
  eq([out.status, out.asOf, out.sessions], ["ok", dates[70], 64], "a full set of members and closes gives an ok reading on the last 64 sessions");
  near(out.implied.rho, 0.4, 1e-3, "its implied correlation is the one built in");
  ok(Number.isFinite(out.realised[21].rho) && Number.isFinite(out.realised[63].rho), "and it carries both realised windows");
  near(out.crp[21], out.implied.rho - out.realised[21].rho, 1e-4, "the premium is implied minus realised on the 21-day window");
  near(out.crp[63], out.implied.rho - out.realised[63].rho, 1e-4, "and on the 63-day window");
  eq(out.realised[21].window, 21, "windows are named");

  const late = new Map(series);
  const staleNames = members.slice(0, 12).map((m) => m.t);
  const wStale = staleNames.reduce((a, t) => a + members.find((m) => m.t === t).w, 0);
  for (const t of staleNames) late.set(t, series.get(t).slice(0, -1));
  const partial = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: late });
  if (wStale < 0.2) {
    eq(partial.asOf, dates[70], "while at least 80% of the weight has the latest close, the window ends there");
    ok(partial.realised[63].excluded.noBars === 12, "and the members without it are counted as left out");
  }
  const heavy = new Map(series);
  const heavyStale = members.slice(0, 25).map((m) => m.t);
  for (const t of heavyStale) heavy.set(t, series.get(t).slice(0, -1));
  const back = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: heavy });
  eq(back.asOf, dates[69], "when more than 20% of the weight lacks the latest close the window ends a session earlier, with every member back in");
  eq(back.realised[63].covered, 40, "and all forty are covered on it");
  const none = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv: null, members, series: new Map() });
  eq([none.status, none.implied.why, none.realised[21].why, none.crp[21], none.asOf], ["withheld", "index-iv", "coverage", null, null], "nothing to read withholds the figure under its reasons");
  const onlyImplied = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: new Map() });
  eq([onlyImplied.status, onlyImplied.crp[21]], ["partial", null], "an implied reading with no closes is partial and has no premium");
  ok(JSON.stringify(out).length < 6000, `the view is small (${JSON.stringify(out).length} bytes)`);
  eq(JSON.stringify(D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "qqq-holdings:2026-09-01", indexIv, members, series })), JSON.stringify(out), "and deterministic");
}

{
  const W = factorWorld({ n: 40, T: 70, rho: 0.5, seed: 5 });
  const members = W.members.map((m) => ({ t: m.t, w: m.w, iv: m.iv, event: false }));
  const dates = [];
  for (let d = Date.parse("2026-06-01T00:00:00Z"); dates.length < 71; d += 86400000) { const w = new Date(d).getUTCDay(); if (w && w !== 6) dates.push(new Date(d).toISOString().slice(0, 10)); }
  const px = (i, split) => { let c = 100; const out = [[dates[0], c]]; for (let t = 0; t < 70; t++) { c *= Math.exp(W.r[i][t]); if (split && dates[t + 1] === split.d) c *= split.f; out.push([dates[t + 1], c]); } return out; };
  const s1 = members.reduce((a, m) => a + m.w * m.iv, 0), s2 = members.reduce((a, m) => a + m.w * m.w * m.iv * m.iv, 0);
  const indexIv = Math.sqrt(s2 + 0.4 * (s1 * s1 - s2));
  const clean = new Map(members.map((m, i) => [m.t, px(i)]));
  const base = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: clean });

  const heavy = members.slice(0, 3);
  const split = { d: dates[50], f: 0.5 };
  const splitSeries = new Map(clean);
  heavy.forEach((m, i) => splitSeries.set(m.t, px(i, split)));
  const blind = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: splitSeries });
  const aware = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: splitSeries, breaks: new Map(heavy.map((m) => [m.t, [split.d]])) });
  ok(Math.abs(blind.realised[63].rho - base.realised[63].rho) > 0.05, `A PLANTED SPLIT: three members halving inside the window move the realised correlation by more than five points (down: the jump lifts the members' own variances more than the index's) when the split is not known (${blind.realised[63].rho} against ${base.realised[63].rho})`);
  near(aware.realised[63].rho, base.realised[63].rho, 0.12, `and leaving them out as breaks restores it (${aware.realised[63].rho})`);
  ok(Math.abs(aware.realised[63].rho - base.realised[63].rho) < Math.abs(blind.realised[63].rho - base.realised[63].rho), "nearer the clean figure than the blind one");
  eq([aware.realised[63].excluded.break, aware.realised[63].covered], [3, 37], "the three are counted under break, not as missing bars");
  eq(aware.realised[21].excluded.break, 3, "and a break inside the 21-day window is inside the 63-day one");
  ok(aware.realised[63].weightExcluded > 0, "with their weight");

  const old = { d: dates[20], f: 0.5 };
  const oldSeries = new Map(clean);
  oldSeries.set(heavy[0].t, px(0, old));
  const older = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: oldSeries, breaks: new Map([[heavy[0].t, [old.d]]]) });
  eq([older.realised[21].excluded.break, older.realised[63].excluded.break], [0, 1], "a break older than 21 sessions leaves the 21-day window alone and excludes the member from the 63-day one");
  const outside = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: clean, breaks: new Map([[heavy[0].t, [dates[3]]]]) });
  eq(outside.realised[63].excluded.break, 0, "and a break before the window excludes nobody");
  eq(JSON.stringify(D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members, series: clean, breaks: null }).realised), JSON.stringify(base.realised), "no breaks given is the same as none");

  const order = [...members].sort((a, b) => a.w - b.w);
  let acc = 0;
  const few = new Set();
  for (const m of order) { if (acc + m.w > 0.04) break; few.add(m.t); acc += m.w; }
  const many = new Set();
  acc = 0;
  for (const m of order) { if (acc + m.w > 0.13) break; many.add(m.t); acc += m.w; }
  const withEvents = (set) => members.map((m) => ({ ...m, event: set.has(m.t) }));
  const small = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members: withEvents(few), series: clean });
  const large = D.buildDispersion({ sessionDate: dates[70], generatedAt: "x", source: "s", indexIv, members: withEvents(many), series: clean });
  eq([small.status, small.implied.weightExcluded < 0.1], ["ok", true], "a few percent of the weight excluded keeps the reading ok");
  eq([large.status, large.implied.weightExcluded > 0.1], ["partial", true], "more than a tenth of the weight excluded makes it partial, though the figure is still published");
  ok(Number.isFinite(large.implied.rho) && /a few correlation points/.test(large.notes.implied), "and the note states the size of what remains");
}

{
  const cal = ["2026-10-05", "2026-10-06", "2026-10-07"];
  const wt = new Map([["A", 0.5], ["B", 0.3], ["C", 0.2]]);
  const s = new Map([["A", [["2026-10-05", 1], ["2026-10-06", 2], ["2026-10-07", 3]]], ["B", [["2026-10-05", 1], ["2026-10-06", 2]]], ["C", []]]);
  eq(D.commonCalendar(s, wt, 5), ["2026-10-05", "2026-10-06"], "a date needs 80% of the weight that has any series, so a late close held by a minority is not the window end");
  eq(D.commonCalendar(s, wt, 1), ["2026-10-06"], "and the calendar is the last n of them");
  const al = D.alignReturns(new Map([["A", s.get("A")]]), ["2026-10-05", "2026-10-07"]);
  eq(al.get("A").length, 1, "alignment on a calendar that skips a day gives one return across it");
  void cal;
}

{
  const src = fs.readFileSync(path.join(ROOT, "shared/flows-dispersion.js"), "utf8");
  ok(!/Date\.now|new Date|Math\.random|\bfetch\(|process\./.test(src), "the leaf has no clock, randomness, network or environment");
  ok(/import \{ sampleVar \} from "\.\/flows-stats\.js"/.test(src) && (src.match(/^import /gm) || []).length === 1, "and imports the statistics leaf alone");
}

{
  const stocks = Array.from({ length: 30 }, (_, i) => ({ t: "M" + String(i).padStart(2, "0"), w: 30 - i }));
  const members = D.indexWeights(stocks);
  const dates = [];
  for (let d = Date.parse("2026-06-01T00:00:00Z"); dates.length < 80; d += 86400000) { const w = new Date(d).getUTCDay(); if (w && w !== 6) dates.push(new Date(d).toISOString().slice(0, 10)); }
  const rng = ST.mulberry32(3);
  const closesFor = (t, through) => {
    const out = []; let c = 100;
    for (const d of dates) { if (d > through) break; c *= Math.exp(0.012 * normal(rng)); out.push({ d, h: c, l: c, c }); }
    return { bars: out, breaks: [] };
  };
  const SESSION = dates[79];
  const inHand = new Set(members.slice(0, 20).map((m) => m.t));
  const held = new Map([...inHand].map((t) => [t, closesFor(t, SESSION)]));
  const fetched = [];
  const writes = [];
  const run = (over = {}) => LEG.runDispersion({
    sessionDate: SESSION, generatedAt: "g", stocks, asOfHoldings: "2026-10-01", indexIv: 0.28,
    ivOf: () => 0.3, eventOf: (t) => t === "M21",
    barsFor: async (t) => held.get(t) || null,
    fetchBars: async (t) => { fetched.push(t); return closesFor(t, SESSION); },
    prior: null, publish: async (k, p) => { writes.push([k, p]); }, ...over,
  });
  let first = await run();
  eq(first.state, "published", "the leg publishes");
  eq(writes[0][0], "dispersion", "under the dispersion key");
  eq(fetched.length, 10, "it fetches closes for exactly the ten members not in hand");
  eq(fetched, members.slice(20).map((m) => m.t), "largest weight first");
  const payload = writes[0][1];
  eq([payload.state.week, payload.state.calls], [isoWeek(SESSION), 10], "the week's calls are counted in the row");
  eq(Object.keys(payload.state.closes.c).sort(), members.slice(20).map((m) => m.t).sort(), "and only the names fetched are cached");
  eq(payload.implied.excluded.event, 1, "the member reporting inside the window is excluded from the implied side");
  ok(JSON.stringify(payload).length < 100 * 1024, `the row fits the ingest cap (${JSON.stringify(payload).length} bytes)`);

  fetched.length = 0;
  const second = await run({ prior: payload });
  eq(fetched.length, 0, "WEEKLY NOT NIGHTLY: the next night reads the cache and calls the vendor for nothing");
  eq(second.row.state.calls, 10, "and the count carries");
  const staleSession = dates[79];
  const stalePrior = structuredClone(payload);
  stalePrior.state.closes.dates = stalePrior.state.closes.dates.slice(0, -8);
  for (const t of Object.keys(stalePrior.state.closes.c)) stalePrior.state.closes.c[t] = stalePrior.state.closes.c[t].slice(0, -8);
  fetched.length = 0;
  await run({ prior: stalePrior });
  eq(fetched.length, 10, "a cache more than five sessions behind is refreshed");
  fetched.length = 0;
  const spent = structuredClone(stalePrior);
  spent.state.calls = 96;
  const capped = await run({ prior: spent });
  eq(fetched.length, 4, "THE WEEKLY BUDGET HOLDS: with 96 of 100 calls used this week only four more are made");
  eq(capped.row.state.calls, 100, "and the row says so");
  fetched.length = 0;
  const lastWeek = structuredClone(stalePrior);
  lastWeek.state.week = "2026-W01";
  lastWeek.state.calls = 100;
  await run({ prior: lastWeek });
  eq(fetched.length, 10, "a new ISO week starts a new budget");
  fetched.length = 0;
  const none = await run({ fetchBars: async () => { throw new Error("HTTP 429"); }, barsFor: async (t) => held.get(t) || null });
  eq(none.state, "published", "a vendor that refuses leaves the leg publishing what it can");
  const noIdx = await run({ indexIv: null });
  eq(noIdx.row.implied.why, "index-iv", "no index volatility is a named gap, not a skipped publish");
  const brk = [dates[70]];
  const withBreaks = new Map(held);
  const heldBroken = members[0].t;
  withBreaks.set(heldBroken, { ...held.get(heldBroken), breaks: [dates[70]] });
  fetched.length = 0;
  const viaHeld = await run({ barsFor: async (t) => withBreaks.get(t) || null });
  eq(viaHeld.row.realised[21].excluded.break, 1, "A SPLIT IN CANDLES IN HAND: the member is counted as a break on the realised side");
  const brokenFetch = members[25].t;
  fetched.length = 0;
  const viaFetch = await run({ fetchBars: async (t) => { fetched.push(t); const r = closesFor(t, SESSION); return t === brokenFetch ? { ...r, breaks: brk } : r; } });
  eq(viaFetch.row.realised[63].excluded.break, 1, "A SPLIT IN FETCHED CLOSES: the fetched member is counted as a break");
  eq(viaFetch.row.state.closes.k, { [brokenFetch]: brk }, "and the break is kept with the cached closes");
  fetched.length = 0;
  const viaCache = await run({ prior: viaFetch.row });
  eq(fetched.length, 0, "the next night reads the cache");
  eq(viaCache.row.realised[63].excluded.break, 1, "and still excludes the member, from the cached break");
  const aged = structuredClone(viaFetch.row);
  aged.state.closes.k[brokenFetch] = ["2000-01-03"];
  const forgotten = await run({ prior: aged });
  eq([forgotten.row.realised[63].excluded.break, forgotten.row.state.closes.k], [0, {}], "a cached break older than the cached closes is dropped");
  eq(Object.keys(first.row.state.closes.k), [], "no break, nothing kept");
  const bad = await run({ publish: async () => { throw new Error("HTTP 503"); } });
  eq(bad.state, "lost", "a publish that fails is reported");
  const skipped = await run({ stocks: [] });
  eq(skipped.state, "skipped", "no holdings, nothing to build");
  const unread = await run({ sessionDate: "bad" });
  eq(unread.state, "skipped", "and a session with no date");
}

console.log(`✓ flows-dispersion: ${checks} assertions`);
