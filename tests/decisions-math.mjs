import assert from "node:assert/strict";
import { bootUI } from "./lib/ui-boot.mjs";
import { loadCore, row, NOW } from "./lib/oracle-fixtures.mjs";
import { readFileSync } from "node:fs";
import { loadMutated } from "./truth/mutants.mjs";
import { mulberry32, sampleVar, pearson, spearman, isFlat } from "../shared/flows-stats.js";
import { foldNorm, foldBlk, blocksOf, normOf, emptyNorm, robustBlock, NORM_MAX_BYTES, NORM_MAX_NAMES, BLK_ALPHA } from "../scripts/flows-legs/oracle-norm.mjs";
import * as LIVE from "../shared/flows-oracle-live.js";
import { impliedWindowSessions, impliedHorizonFactor, impliedHorizonMove } from "../shared/flows-features.js";
import { buildPricedMove } from "../shared/flows-card.js";
import { isTradingDay } from "../shared/flows-freshness.js";
import { assessEvent, eventTerms } from "../shared/flows-event-variance.js";
import { askSplit, askShare, askShareRead } from "../shared/flows-tape-stats.js";
import { windowEntry } from "../shared/flows-sides.js";
import { settlementOf, expiryUtcMs, lastTradeMs, yearFraction, rootOfSymbol, isMonthly, etDayOf } from "../shared/flows-quant-time.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

const SRC = readFileSync(new URL("../assets/js/flows-oracle-core.js", import.meta.url), "utf8");
const mutate = (name) => Math.floor(Math.random() * 1e6) + name.length;

const Z90 = 1.2815515655446004;
const refBar = (n, scale = 1) => {
  const sigma = Math.min(1.5, Math.max(0, Math.log(n.premiumP90 / n.premiumMedian) / Z90));
  const w = n.premiumMedian * Math.exp(1.5 * sigma * sigma);
  const own = scale * (n.blk + 3.5 * Math.sqrt(n.blk * w));
  return { own, bar: Math.max(own, 500000), floor: own < 500000 };
};

const EXAMPLE = { premiumMedian: 266000, premiumP90: 900000, blk: 627000, blkN: 40 };

{
  const b = LIVE.surgeBar(EXAMPLE);
  near(b.bar, 3443000, 15000, "the worked bar for 1.5 windows a block, median 266K and p90 900K");
  eq(b.floor, false, "binds on the name's own level");
  const small = LIVE.surgeBar({ ...EXAMPLE, blk: 50000, premiumMedian: 60000, premiumP90: 150000 });
  eq([small.bar, small.floor], [500000, true], "a small name sits on the minimum");
  eq(LIVE.surgeBar({ ...EXAMPLE, blkN: 9 }), null, "nine sessions of history is no bar");
  eq(LIVE.surgeBar({ ...EXAMPLE, blk: null }), null, "no block level is no bar");
  eq(LIVE.surgeBar({ ...EXAMPLE, blk: undefined }), null, "an undefined one too");
  eq(LIVE.surgeBar({ ...EXAMPLE, premiumP90: 100000 }), null, "a p90 under the median is no bar");
  const ev = LIVE.surgeBar(EXAMPLE, 1.5);
  near(ev.own, b.own * 1.5, 1e-6, "an event scales the name's own level");
  const smallEv = LIVE.surgeBar({ ...EXAMPLE, blk: 50000, premiumMedian: 60000, premiumP90: 150000 }, 1.5);
  eq(smallEv.bar, 500000, "and never the minimum");
  for (let i = 0; i < 200; i++) {
    const n = { premiumMedian: 20000 + i * 9000, premiumP90: 20000 + i * 9000 + i * 31000, blk: i * 40000, blkN: 10 + (i % 50) };
    near(LIVE.surgeBar(n).bar, refBar(n).bar, 1e-6, `the bar matches the independent formula for case ${i}`);
  }
}

{
  const day = "2026-10-16";
  const rows = Array.from({ length: 6 }, () => ({ t: "SYO001", prem: 100000, size: 10 }));
  const folded = foldNorm(emptyNorm(), rows, day);
  const e = folded.t.SYO001;
  eq([e.length, e[5], e[6], e[7]], [8, day, Math.round(robustBlock(6, 13, 100000, 100000) / 1000), 1], "a new name is seeded from the day's robust level and one session of history");
  eq(folded.v, 2, "the ledger is version 2");
  const n = normOf(folded, "SYO001");
  eq([n.blkN, n.blk], [1, e[6] * 1000], "normOf reads the level in dollars");
  const legacy = { v: 1, t: { SYO001: [400, 266000, 900000, 80, 400, "2026-10-15"] } };
  eq(normOf(legacy, "SYO001"), { winN: 400, premiumMedian: 266000, premiumP90: 900000, sizeMedian: 80, sizeP90: 400, callShare: null, blk: null, blkN: 0 }, "a legacy entry is read with no block level");
  const moved = foldNorm(legacy, rows, day).t.SYO001;
  eq([moved.length, moved[7]], [8, 1], "and is converted on its next fold, starting its history at one session");
  eq(LIVE.surgeBar(normOf(foldNorm(legacy, rows, day), "SYO001")), null, "so it cannot fire a surge for nine more sessions");
}

{
  const prior = 627000;
  const wins = foldBlk(prior, 40, 200e6, 13, 0).blk;
  ok(wins <= 1.147 * prior && wins >= 1.14 * prior, `one 200M day raises a 627K level by ${(wins / prior - 1).toFixed(3)}, at most 14.7 per cent`);
  near(BLK_ALPHA, 2 / 41, 1e-15, "the weight is two over forty-one");
  const zero = foldBlk(prior, 40, 0, 13, 0).blk;
  near(zero, prior * (1 - 2 / 41), 1e-6, "a session with data and no flow is a real zero and lowers the level by one weight");
  let b = prior, n = 40, days = 0;
  while (b < 4 * prior && days < 80) {
    const f = foldBlk(b, n, 5 * prior * 13, 13, 0);
    b = f.blk; n = f.n; days++;
  }
  ok(days >= 25 && days <= 31, `a fivefold step in flow reaches four times the level in ${days} sessions`);
  let c = prior, k = 40, free = 0;
  while (c < 4 * prior && free < 80) { k += 1; c += (2 / 41) * (5 * prior - c); free++; }
  ok(days - free <= 3, `the clip costs ${days - free} sessions against an unclipped average`);
  let g = prior, m = 40;
  for (let i = 0; i < 2; i++) { m += 1; g += Math.max(1 / m, 2 / 41) * (0 - g); }
  m += 1;
  g += Math.max(1 / m, 2 / 41) * (Math.min(8e6 / 13, Math.max(4 * g, 50000)) - g);
  const prev = { v: 2, t: { SYO001: [400, 266000, 900000, 80, 400, "2026-10-16", 627, 40] } };
  const folded = foldNorm(prev, [{ t: "SYO001", prem: 4e6, size: 10 }, { t: "SYO001", prem: 4e6, size: 10 }], "2026-10-21");
  const e = folded.t.SYO001;
  near(e[6] * 1000, g, 1000, "two missed sessions count as two zero sessions before the next one");
  eq(e[7], 43, "and add to the history");
  eq(blocksOf("2026-10-16"), 13, "a full session is thirteen half hours");
  eq(blocksOf("2026-11-27"), 7, "an early close at 13:00 is seven");
  const half = foldNorm({ v: 2, t: { SYO001: [400, 266000, 900000, 80, 400, "2026-11-25", 100, 40] } }, [{ t: "SYO001", prem: 7e6, size: 10 }], "2026-11-27").t.SYO001;
  const dayX = Math.min(7e6 / 7, 4 * 100000 * (1 - 0) + 0);
  ok(half[6] >= 100 && half[6] <= 100 + Math.ceil(dayX / 1000), "an early close divides the session total by seven");
}

{
  const prior = { v: 2, t: {} };
  for (let i = 0; i < 1500; i++) prior.t["SYO" + String(i).padStart(4, "0")] = [123456.78 + i, 123456789.12, 987654321.98, 12345.67, 98765.43, "2026-10-" + String(1 + (i % 15)).padStart(2, "0"), 12345, 99];
  const folded = foldNorm(prior, Array.from({ length: 4000 }, (_, i) => ({ t: "SYX" + String(i % 700).padStart(4, "0"), prem: 100000 + i, size: 10 })), "2026-10-16");
  ok(Object.keys(folded.t).length <= NORM_MAX_NAMES, "no more names than the ledger holds");
  ok(JSON.stringify(folded).length <= NORM_MAX_BYTES, `and no more bytes than the key takes (${JSON.stringify(folded).length})`);
}

{
  const core = loadCore(SRC);
  const grid = [];
  for (const blk of [0, 50000, 200000, 627000, 2000000]) for (const med of [60000, 266000, 600000]) for (const ratio of [1, 3.4, 12]) for (const blkN of [9, 10, 40]) grid.push({ blk, premiumMedian: med, premiumP90: med * ratio, blkN, winN: 40, sizeMedian: 40, sizeP90: 150 });
  let compared = 0;
  const six = (each) => Array.from({ length: 6 }, (_, i) => row("SYO001", 2 + i * 4, { prem: each, k: 60 + i }));
  for (const norm of grid) {
    for (const scale of [1, 1.5]) {
      const b = LIVE.surgeBar(norm, scale);
      const ctx = { norm, sector: null, sectorEtf: null, earnings: scale === 1 ? null : { sessions: 3, inWindow: true } };
      for (const mult of [1.0005, 0.995]) {
        if (b === null) {
          const state = core.live.createState();
          const msgs = core.live.detect(state, six(Math.ceil(mult * 3e6 / 6)), ctx, NOW, { live: true });
          eq(msgs.filter((m) => m.kind === "surge").length, 0, "no bar means no surge in the page copy");
          continue;
        }
        const each = Math.ceil(mult * b.bar / 6);
        const total = each * 6;
        const state = core.live.createState();
        const got = core.live.detect(state, six(each), ctx, NOW, { live: true }).filter((m) => m.kind === "surge").length === 1;
        eq(got, total >= b.bar, `the page copy and the reference agree on a surge at ${mult} of the bar (${JSON.stringify(norm)}, scale ${scale})`);
        compared++;
      }
    }
  }
  ok(compared >= 300, `${compared} bar comparisons between the page copy and the reference leaf`);
}

function simulate(mod, lambda, sigma, sessions, seed) {
  const rng = mulberry32(seed);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
  const poisson = (lam) => { const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= rng(); } while (p > L); return k - 1; };
  const med = 266000;
  const mean = med * Math.exp(sigma * sigma / 2);
  const norm = { premiumMedian: med, premiumP90: med * Math.exp(Z90 * sigma), blk: lambda * mean, blkN: 40 };
  const b = mod.surgeBar(norm);
  let fires = 0, evals = 0;
  for (let s = 0; s < sessions; s++) {
    const wins = [];
    const n = poisson(lambda * 13);
    for (let i = 0; i < n; i++) wins.push({ t: rng() * 390, p: med * Math.exp(sigma * gauss()) });
    wins.sort((a, c) => a.t - c.t);
    let lo = 0, hi = 0, sum = 0;
    for (let m = 20; m <= 390; m++) {
      while (hi < wins.length && wins[hi].t <= m) { sum += wins[hi].p; hi++; }
      while (lo < hi && wins[lo].t <= m - 30) { sum -= wins[lo].p; lo++; }
      evals++;
      if (hi - lo >= 3 && sum >= b.bar) fires++;
    }
  }
  return fires / evals;
}

const worstRate = (mod) => {
  let worst = 0, at = null;
  for (const lambda of [0.5, 1.5, 5, 10]) for (const sigma of [0.6, 0.95, 1.4]) {
    const r = simulate(mod, lambda, sigma, 120, 77 + lambda * 13 + sigma * 7);
    if (r > worst) { worst = r; at = { lambda, sigma }; }
  }
  return { worst, at };
};

{
  const good = worstRate(LIVE);
  ok(good.worst <= 0.02, `the shipped bar fires in at most ${(good.worst * 100).toFixed(2)} per cent of rolling thirty-minute evaluations in every cell of the grid (worst at ${JSON.stringify(good.at)})`);
  const old = simulate({ surgeBar: (n) => ({ bar: Math.max(3 * n.premiumP90 * 30 / 390, 500000) }) }, 1.5, 0.951, 120, 5);
  ok(old > 0.12 && old > 8 * simulate(LIVE, 1.5, 0.951, 120, 5), `the old bar fired in ${(old * 100).toFixed(1)} per cent of evaluations at 1.5 windows a block`);
  const variants = [
    ["z of two", [["surgeZ: 3.5,", "surgeZ: 2,"]]],
    ["three times the level, no spread", [["const own = scale * (norm.blk + L.surgeZ * Math.sqrt(norm.blk * w));", "const own = scale * 3 * norm.blk;"]]],
    ["the old slice of the single-window p90", [["const own = scale * (norm.blk + L.surgeZ * Math.sqrt(norm.blk * w));", "const own = scale * 3 * norm.premiumP90 * 30 / 390;"]]],
    ["the spread read from the median alone", [["const w = med * Math.exp(1.5 * sigma * sigma);", "const w = med;"]]],
  ];
  for (const [name, transforms] of variants) {
    const mod = await loadMutated("shared/flows-oracle-live.js", transforms, { salt: mutate(name) });
    const r = worstRate(mod);
    ok(r.worst > 0.02, `planted wrong build must fail the calibration: ${name} fires in ${(r.worst * 100).toFixed(2)} per cent`);
  }
}

{
  const day = "2026-10-26";
  const independent = (from, days = 30) => {
    let n = 0;
    const t0 = Date.parse(from + "T00:00:00Z");
    for (let i = 1; i <= days; i++) if (isTradingDay(new Date(t0 + i * 86400000).toISOString().slice(0, 10), null)) n++;
    return n;
  };
  for (const d of ["2026-10-26", "2026-11-02", "2026-11-20", "2026-12-01", "2026-12-15", "2027-01-04", "2027-02-10", "2027-06-14", "2026-07-01"]) eq(impliedWindowSessions(d), independent(d), `the sessions of the thirty days after ${d} equal an independent count`);
  ok(impliedWindowSessions("2026-11-20") < impliedWindowSessions("2026-10-26") + 1, "a window with Thanksgiving holds fewer sessions");
  eq(impliedWindowSessions("not a day"), null, "no day, no window");
  eq(impliedWindowSessions(null), null, "none either");
  const target = 0.3 * Math.sqrt(30 / 365);
  let worst = 0;
  const start = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; i < 365; i++) {
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    const s30 = impliedWindowSessions(d);
    worst = Math.max(worst, Math.abs(impliedHorizonMove(0.3, { sessions: s30, asOf: d }) - target));
  }
  ok(worst < 1e-12, `over 365 start dates the move over the 30-day window's own sessions is exactly iv30 x sqrt(30/365) (${worst})`);
  near(target, 0.08601, 5e-6, "which is 8.601 per cent at an implied volatility of 30");
  const s30 = impliedWindowSessions(day);
  let last = 0;
  for (let n = 1; n <= 30; n++) {
    const f = impliedHorizonFactor({ sessions: n, asOf: day });
    ok(f > last, "the factor grows with the horizon");
    last = f;
  }
  eq(impliedHorizonFactor({ sessions: 10, asOf: null }), Math.sqrt(10 / 252), "with no date it is the old 252-session factor, and says nothing more");
  eq(impliedHorizonMove(null, { sessions: 10, asOf: day }), null, "no volatility, no move");
  eq(impliedHorizonMove(0, { sessions: 10, asOf: day }), null, "nor a zero one");
  const base = { spot: 100, impliedMovePerc: 0.05, iv30: 0.3, rv30: 0.25, ivRank: 0.5, ivMomentum: 0, atmVol: 0.3, ivStrip: null, asOf: day, sessions: 10 };
  const move = buildPricedMove(base);
  const want = 0.3 * Math.sqrt((30 / 365) * 10 / s30);
  eq(move.lead.n.impliedPct, Math.round(want * 1000) / 10, "the card's priced move is the implied volatility over the sessions of its own window");
  eq(move.lead.n.windowSessions, s30, "and names the window");
  const realized = Math.round(0.25 * Math.sqrt(10 / 252) * 1000) / 10;
  near(move.impliedMove, want, 1e-4, "and the same figure in full");
  eq(move.lead.n.realizedPct, realized, "while the realized one keeps the 252-session clock its returns were measured on");
  const variants = [
    ["the old 252-session year", [["return Math.sqrt((IMPLIED_WINDOW_DAYS / 365) * sessions / window);", "return Math.sqrt(sessions / TRADING_YEAR);"]]],
    ["calendar days in the horizon", [["return Math.sqrt((IMPLIED_WINDOW_DAYS / 365) * sessions / window);", "return Math.sqrt(sessions * 1.4 / 365);"]]],
    ["the window counted in calendar days", [["const n = sessionsBetween(day, shiftDay(day, IMPLIED_WINDOW_DAYS));", "const n = IMPLIED_WINDOW_DAYS;"]]],
    ["the 30 days read as 31", [["export const IMPLIED_WINDOW_DAYS = 30;", "export const IMPLIED_WINDOW_DAYS = 31;"]]],
  ];
  for (const [name, transforms] of variants) {
    const mod = await loadMutated("shared/flows-features.js", transforms, { salt: mutate(name) });
    let bad = 0;
    for (const d of ["2026-10-26", "2026-11-20", "2027-01-04"]) {
      const s = impliedWindowSessions(d);
      if (Math.abs(mod.impliedHorizonMove(0.3, { sessions: s, asOf: d }) - target) > 1e-9) bad++;
    }
    ok(bad > 0, `planted wrong build must fail the 30-day identity: ${name}`);
  }
}

{
  const front = { vol: 0.35, T: 7 / 365 }, back = { vol: 0.30, T: 37 / 365 };
  const a = assessEvent(front, back);
  eq(a.code, null, "a seven-day front five points over a 37-day back is an event");
  near(a.eventSd, 0.027726, 1e-6, "of 2.77 per cent of the price");
  near(a.resolution.ratio, 7.05, 0.01, "seven times what a half-point quote can resolve");
  const k = (s1) => assessEvent({ vol: s1, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).code;
  eq(k(0.3141), "below-resolution", "3.141 is inside two standard errors of the quotes");
  eq(k(0.3142), null, "3.142 is outside");
  eq(k(0.3001), "below-resolution", "a hundredth of a point is the quote speaking");
  eq(assessEvent({ vol: 0.3001, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).eventSd, null, "and no move is printed for it");
  eq(assessEvent({ vol: 0.70, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).code, "calendar-arbitrage", "a front whose total variance exceeds the back's is inverted");
  eq(assessEvent({ vol: 0.30, T: 7 / 365 }, { vol: 0.35, T: 37 / 365 }).code, "no-premium", "a front under the back has no premium");
  eq(assessEvent({ vol: 0.35, T: 0.5 / 365 }, back).code, "front-too-short", "half a day to the front is too short for the day count");
  eq(assessEvent({ vol: 0.35, T: 7 / 365 }, { vol: 0.30, T: 12 / 365 }).code, "pair-too-close", "five days between the expiries is too close");
  eq(assessEvent({ vol: NaN, T: 7 / 365 }, back).code, "input-absent", "a missing vol is an absent input");
  eq(assessEvent({ ...front, dv: 0.04 }, back).code, "below-resolution", "a front quoted four points wide cannot resolve it");
  eq(assessEvent({ vol: 0.108, T: 1 / 365 }, { vol: 0.10, T: 8 / 365, dv: 0.0025 }).code, "below-resolution", "the z-test and the floor on the half-point default work together");
  const tight = assessEvent({ vol: 0.108, T: 1 / 365, dv: 0.0025 }, { vol: 0.10, T: 8 / 365, dv: 0.0025 });
  eq(tight.code, "immaterial", "a resolved move under a quarter of one percent of the price is immaterial");
  for (const scale of [0.5, 1, 2, 3]) {
    eq(assessEvent({ vol: 0.35, T: 7 * scale / 365 }, { vol: 0.30, T: 37 * scale / 365 }).code, assessEvent({ vol: 0.35, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).code, `scaling both expiries by ${scale} leaves the verdict alone`);
  }
  eq(eventTerms(front, back).eventSd, a.eventSd, "the pure algebra is unchanged under the assessment");
  const mutants = [
    ["no resolution test", [["if (!(gap > need)) return out(\"below-resolution\"", "if (false) return out(\"below-resolution\""]]],
    ["one standard error", [["  z: 2,\n  dv: 0.005,", "  z: 1,\n  dv: 0.005,"]]],
    ["a tenth of a point", [["  dv: 0.005,\n  dvFloor", "  dv: 0.001,\n  dvFloor"]]],
    ["no materiality floor", [["if (!(base.eventSd >= R.minSd))", "if (false)"]]],
    ["no short-front test", [["if (front.T < R.minFront) return out(\"front-too-short\");", ""]]],
    ["the legs' errors not combined", [["Math.sqrt(s1 * s1 * d1 * d1 + s2 * s2 * d2 * d2)", "s1 * d1"]]],
  ];
  const probe = (mod) => [mod.assessEvent({ vol: 0.3001, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).code, mod.assessEvent({ vol: 0.3141, T: 7 / 365 }, { vol: 0.30, T: 37 / 365 }).code,
    mod.assessEvent({ vol: 0.108, T: 1 / 365, dv: 0.0025 }, { vol: 0.10, T: 8 / 365, dv: 0.0025 }).code, mod.assessEvent({ vol: 0.35, T: 0.5 / 365 }, { vol: 0.30, T: 37 / 365 }).code,
    mod.assessEvent({ vol: 0.3142, T: 7 / 365, dv: 0.005 }, { vol: 0.30, T: 37 / 365, dv: 0.0001 }).code];
  const want = probe({ assessEvent });
  for (const [name, transforms] of mutants) {
    const mod = await loadMutated("shared/flows-event-variance.js", transforms, { salt: mutate(name) });
    ok(JSON.stringify(probe(mod)) !== JSON.stringify(want), `planted wrong build must fail the event battery: ${name}`);
  }
}

{
  const UI = bootUI();
  const rng = mulberry32(2026);
  const money = (x) => Math.round(x * 100) / 100;
  let invalid = 0, valid = 0;
  for (let i = 0; i < 6000; i++) {
    const prem = money(1000 + rng() * 5e6);
    const askPrem = rng() < 0.1 ? null : money(prem * rng() * 0.9);
    let bidPrem = rng() < 0.1 ? null : money((prem - (askPrem || 0)) * rng());
    const flip = rng();
    if (flip < 0.15 && bidPrem !== null) bidPrem = money(bidPrem + (prem - (askPrem || 0)) + 0.01 * (1 + Math.floor(rng() * 5)));
    if (flip > 0.97 && askPrem !== null && bidPrem !== null) bidPrem = money(prem - askPrem);
    const r = { prem, askPrem, bidPrem };
    const server = askSplit(r);
    const ledger = windowEntry(r);
    const browser = UI.F.askSplit(r);
    const ledgerInvalid = ledger.ok === false && ledger.why === "sides";
    eq(server.invalid, ledgerInvalid, `the share and the ledger call the same window invalid (${JSON.stringify(r)})`);
    eq(browser.invalid, server.invalid, "and so does the page");
    near(server.ask + server.bid + server.none, prem, 1e-6, "the split of a window, valid or not, adds to its premium");
    near(browser.ask + browser.bid + browser.none, prem, 1e-6, "in the page too");
    if (server.invalid) { invalid++; eq([server.ask, server.bid, server.askStated, server.bidStated], [0, 0, false, false], "an invalid window states no side"); } else valid++;
  }
  ok(invalid > 500 && valid > 3000, `${invalid} invalid windows and ${valid} valid ones compared`);
  eq(askShareRead([{ prem: 100, askPrem: 80, bidPrem: 40 }]).share, null, "100 with 80 and 40 is not scaled to 66.67 and 33.33");
  eq(askShareRead([{ prem: 100, askPrem: 80, bidPrem: 40 }]).invalid, 1, "it is counted");
  eq(askShare([{ prem: 100, askPrem: 60, bidPrem: 40 }]).invalid, 0, "an exact balance is valid");
  eq(askShare([{ prem: 100, askPrem: 60, bidPrem: 40.01 }]).invalid, 1, "a cent over is invalid");
  eq(askSplit({ prem: "100.00", askPrem: "60.00", bidPrem: "40.00" }).invalid, false, "decimal strings are read by their digits");
  eq(askSplit({ prem: "1.005", askPrem: "0.50", bidPrem: "0.50" }).invalid, false, "a premium with a third decimal rounds half to even as the ledger does");
  const mutants = [
    ["the sides are scaled to the premium again", "shared/flows-tape-stats.js", [["if (a + b > T) return { ask: 0, bid: 0, none: T / CENTS, askStated: false, bidStated: false, invalid: true };", "if (a + b > T) return { ask: a * T / (a + b) / CENTS, bid: b * T / (a + b) / CENTS, none: 0, askStated: x !== null, bidStated: y !== null, invalid: false };"]]],
    ["a cent of tolerance", "shared/flows-tape-stats.js", [["if (a + b > T) return", "if (a + b > T + 1) return"]]],
    ["an invalid window stays in the coverage", "shared/flows-tape-stats.js", [["if (part.invalid) { invalid++; continue; }", "if (part.invalid) invalid++;"]]],
    ["an invalid window states its sides", "shared/flows-tape-stats.js", [["return { ask: 0, bid: 0, none: T / CENTS, askStated: false, bidStated: false, invalid: true };", "return { ask: a / CENTS, bid: b / CENTS, none: 0, askStated: x !== null, bidStated: y !== null, invalid: true };"]]],
  ];
  const probe = (mod) => JSON.stringify([mod.askSplit({ prem: 100, askPrem: 80, bidPrem: 40 }), mod.askSplit({ prem: 100, askPrem: 60, bidPrem: 40.01 }), mod.askShareRead([{ prem: 100, askPrem: 80, bidPrem: 40 }, { prem: 100, askPrem: 60, bidPrem: 40 }])]);
  const want = probe({ askSplit, askShareRead });
  for (const [name, file, transforms] of mutants) {
    const mod = await loadMutated(file, transforms, { salt: mutate(name) });
    ok(probe(mod) !== want, `planted wrong build must fail the ask-share battery: ${name}`);
  }
  const bad = bootUI([["if (a + b > T) return { ask: 0, bid: 0, none: T / 100, askStated: false, bidStated: false, invalid: true };", "if (a + b > T) { const k = T / (a + b); return { ask: a * k / 100, bid: b * k / 100, none: 0, askStated: x !== null, bidStated: y !== null, invalid: false }; }"]]);
  ok(bad.F.askSplit({ prem: 100, askPrem: 80, bidPrem: 40 }).invalid === false, "the page copy scaling the sides is a planted wrong build, and it differs");
}

{
  const flatVar = [];
  for (const v of [0.1, 0.3, 1.1, 12.3, 0.1 + 0.2]) for (const n of [3, 40, 252]) {
    const xs = Array(n).fill(v);
    xs[n - 1] = v + Number.EPSILON * Math.max(1, Math.abs(v));
    flatVar.push(sampleVar(xs));
  }
  ok(flatVar.every((x) => x === 0), "a series that differs by a few ulps has no variance");
  ok(sampleVar([1, 1 + 1e-6, 1]) > 0, "one part in a million is real");
  ok(sampleVar([1, 1 + 2e-9, 1]) > 0, "and so are two parts in a billion");
  ok(sampleVar([1e5, 1e5 + 1e-3, 1e5 + 2e-3]) > 0, "a price of 1e5 moving by a tenth of a cent is real data");
  const x = [1, 2, 3, 4, 5];
  const y = [1, 1 + Number.EPSILON, 1 + 2 * Number.EPSILON, 1, 1 + Number.EPSILON];
  eq([pearson(x, y), spearman(x, y)], [null, null], "neither correlation reads rounding noise");
  eq(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1, "a real correlation is untouched");
  eq(pearson(x, x.map((v) => 3 * v + 1)), 1, "an exact line is exactly one");
  eq(pearson([1, 2, 3, 4], [5, Number.NaN, 5, 5]), null, "pairs with a hole are judged on the complete pairs");
  eq(isFlat([]), true, "nothing is flat");
  eq(isFlat([0, 0, 0]), true, "zeros are flat");
  eq(isFlat([0, 2 * Number.EPSILON, 0]), false, "a few ulps around zero is judged against its own scale");
}

{
  const PM = (day, root = null) => settlementOf(root, day);
  eq([PM("2025-01-17", "SPX"), PM("2025-01-17", "SPXW"), PM("2025-01-17", "NDX"), PM("2025-01-17", "NDXP"), PM("2025-01-17", "RUT"), PM("2025-01-17", "RUTW"), PM("2025-01-17", "XSP"), PM("2025-01-17", null), PM("2025-01-17", "ZQZA")], ["am", "pm", "am", "pm", "am", "pm", "pm", "pm", "pm"], "a standard monthly is AM-settled on the index roots without the weekly suffix");
  eq([PM("2025-01-15", "SPX"), PM("2025-01-22", "SPX")], ["pm", "pm"], "and a day that is not a standard monthly is not");
  eq([PM("2025-03-18", "VIX"), PM("2024-06-18", "VIX"), PM("2025-03-19", "VIXW"), PM("2025-03-19", "vix")], ["am", "am", "am", "am"], "VIX options are AM whatever the day");
  eq([PM("2025-04-17", "SPX"), PM("2026-06-18", "SPX"), PM("2025-04-16", "SPX"), PM("2026-06-17", "SPX")], ["am", "am", "pm", "pm"], "the monthly moves to the Thursday when the Friday is a holiday, and the Wednesday is not the monthly");
  const at = (iso) => Date.parse(iso);
  near(yearFraction(at("2025-01-16T21:00:00Z"), "2025-01-17", "SPX") * 31536000, 63000, 1e-6, "17.5 hours from Thursday's close to Friday's open");
  near(yearFraction(at("2025-01-16T21:00:00Z"), "2025-01-17", "SPXW") * 31536000, 86400, 1e-6, "24 hours for the PM series on the same day");
  near(yearFraction(at("2025-01-16T21:00:00Z"), "2025-01-17") * 31536000, 86400, 1e-6, "and for a call that names no root");
  near(yearFraction(at("2025-01-17T14:29:00Z"), "2025-01-17", "SPX") * 31536000, 60, 1e-6, "a minute before the opening quote");
  eq(yearFraction(at("2025-01-17T14:30:00Z"), "2025-01-17", "SPX"), 0, "at it, nothing is left");
  ok(yearFraction(at("2025-01-17T14:31:00Z"), "2025-01-17", "SPX") < 0, "after it, a negative time that every caller tests");
  eq(new Date(expiryUtcMs("2025-03-18", "VIX")).toISOString(), "2025-03-18T13:30:00.000Z", "09:30 in New York is 13:30 UTC in daylight time, 16:30 TRT");
  eq(new Date(expiryUtcMs("2025-01-17", "SPX")).toISOString(), "2025-01-17T14:30:00.000Z", "and 14:30 UTC in standard time, 17:30 TRT");
  eq(new Date(lastTradeMs("2025-01-17", "SPX")).toISOString(), "2025-01-16T21:00:00.000Z", "an AM series last trades at the close before");
  eq(new Date(lastTradeMs("2025-04-17", "SPX")).toISOString(), "2025-04-16T20:00:00.000Z", "a Thursday expiry last trades on Wednesday");
  eq(new Date(lastTradeMs("2025-01-17", "SPXW")).toISOString(), "2025-01-17T21:00:00.000Z", "a PM series at its own close");
  eq([rootOfSymbol("SPXW250117C05000000"), rootOfSymbol("SPX250117P04500000"), rootOfSymbol("garbage"), rootOfSymbol(null)], ["SPXW", "SPX", null, null], "the root is read from the option symbol");
  eq([isMonthly("2025-04-17"), isMonthly("2025-04-16")], [true, false], "the holiday-shifted monthly is a monthly");
  const gap = (expiryUtcMs("2025-01-17", "SPXW") - expiryUtcMs("2025-01-17", "SPX")) / 1000;
  eq(gap, 23400, "the AM and PM series of one day are 6.5 hours apart");
  eq(etDayOf(Date.parse("2025-03-11T02:00:00+03:00")), "2025-03-10", "02:00 TRT is still the evening of the day before in New York");
  const variants = [
    ["the close for everyone", [["return settlementOf(root, expiryDay) === \"am\" ? openUtcMs(expiryDay) : closeUtcMs(expiryDay);", "return closeUtcMs(expiryDay);"]]],
    ["the previous close for an AM series", [["return settlementOf(root, expiryDay) === \"am\" ? openUtcMs(expiryDay) : closeUtcMs(expiryDay);", "return settlementOf(root, expiryDay) === \"am\" ? closeUtcMs(previousSession(expiryDay)) : closeUtcMs(expiryDay);"]]],
    ["a weekly index root is AM", [["if (rule === \"monthly\") return isMonthly(expiryDay) ? \"am\" : \"pm\";", "if (rule === \"monthly\") return \"am\";"]]],
    ["VIX only on a monthly", [["if (rule === \"always\") return parseDay(expiryDay) ? \"am\" : \"pm\";", "if (rule === \"always\") return isMonthly(expiryDay) ? \"am\" : \"pm\";"]]],
    ["the open an hour early", [["return p.t + (9.5 + (usDst(p.y, p.m, p.d) ? 4 : 5)) * 3600000;", "return p.t + (8.5 + (usDst(p.y, p.m, p.d) ? 4 : 5)) * 3600000;"]]],
  ];
  const probe = (mod) => JSON.stringify([mod.yearFraction(at("2025-01-16T21:00:00Z"), "2025-01-17", "SPX"), mod.yearFraction(at("2025-03-17T20:00:00Z"), "2025-03-18", "VIX"),
    mod.yearFraction(at("2025-01-15T21:00:00Z"), "2025-01-15", "SPX"), mod.yearFraction(at("2025-01-16T20:00:00Z"), "2025-01-17", "SPXW")]);
  const want = probe({ yearFraction });
  for (const [name, transforms] of variants) {
    const mod = await loadMutated("shared/flows-quant-time.js", transforms, { salt: mutate(name) });
    ok(probe(mod) !== want, `planted wrong build must fail the AM battery: ${name}`);
  }
}

console.log(`decisions-math: ${checks} checks`);
