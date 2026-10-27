import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as V from "../shared/flows-voldesk.js";
import { COPY, say } from "../shared/flows-voldesk-copy.js";
import * as H from "../scripts/flows-legs/health.mjs";
import { OPS, opById } from "../shared/flows-vendor-ops.js";
import { loadMutated } from "./truth/mutants.mjs";
import { nightlyEmit, emitRead } from "./lib/nightly-emit.mjs";
import { CALL_COST } from "../scripts/flows-nightly/vendor-params.mjs";
import { runVolAudit, runVolDesk, rotate, chainFor } from "../scripts/flows-legs/voldesk.mjs";
import { makeVoldeskFake } from "../scripts/flows-legs/voldesk-fake.mjs";
import { clearTaint } from "../scripts/flows-legs/taint.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-voldesk.json"), "utf8"));
const SHAPES_REAL = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/flows-probe-shapes.json"), "utf8"));
const SESSION = FX.session;
const SESSION_DRY = "2026-08-24";
const clone = (x) => JSON.parse(JSON.stringify(x));

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };

function proxied(rows, seen) {
  return rows.map((row) => new Proxy(row, {
    get(target, key) {
      if (typeof key === "string") seen.add(key);
      return target[key];
    },
  }));
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function independentIv(points, d) {
  const p = points.filter((x) => x.dte > 0 && x.iv > 0).sort((a, b) => a.dte - b.dte);
  if (p.length < 2 || d < p[0].dte || d > p[p.length - 1].dte) return null;
  for (let i = 0; i < p.length - 1; i++) {
    if (d >= p[i].dte && d <= p[i + 1].dte) {
      const w0 = p[i].iv ** 2 * p[i].dte, w1 = p[i + 1].iv ** 2 * p[i + 1].dte;
      const w = w0 + (w1 - w0) * (d - p[i].dte) / (p[i + 1].dte - p[i].dte);
      return Math.sqrt(w / d);
    }
  }
  return null;
}

const rowOf = (a, id) => a.rows.find((r) => r[0] === id);
const verdicts = (a) => Object.fromEntries(a.rows.map((r) => [r[0], r[5]]));

function tweak(world, fn) {
  const w = clone(FX.worlds[world].input);
  fn(w);
  return w;
}

function battery(M, HM) {
  const fails = [];
  const check = (name, fn) => {
    try { fn(); } catch (error) { fails.push(name + ": " + String(error.message).split("\n")[0].slice(0, 160)); }
  };
  const st = (c, m) => assert.ok(c, m);
  const se = (a, b, m) => assert.equal(a, b, m);
  const sd = (a, b, m) => assert.deepEqual(a, b, m);
  const auditK = (w) => M.auditName({ exposureSign: true, ...w });

  check("numbers", () => {
    se(M.numOf("0.25", "x").v, 0.25, "decimal");
    se(M.numOf("-1e-3", "x").v, -0.001, "exponent");
    se(M.numOf("", "x").v, null, "empty is not zero");
    se(M.numOf("", "x").why, "type:x", "and says why");
    se(M.numOf("NaN", "x").v, null, "NaN");
    se(M.numOf(null, "x").why, "absent", "null is absent");
    se(M.numOf(0.5, "x").v, 0.5, "a number passes");
    se(M.numOf(Infinity, "x").v, null, "infinity");
    se(M.intOf("12", "oi").v, 12, "integer string");
    se(M.intOf("1.5", "oi").v, null, "fraction");
    se(M.intOf("-3", "oi").v, null, "negative");
    se(M.rangedOf("1.5", "delta", -1, 1).why, "range:delta", "range");
  });

  check("term-variance", () => {
    const pts = [{ dte: 7, iv: 0.2 }, { dte: 30, iv: 0.18 }, { dte: 60, iv: 0.22 }, { dte: 120, iv: 0.3 }, { dte: 365, iv: 0.26 }];
    const t = M.termState(pts);
    near(t.iv30, 0.18, 1e-12, "knot at 30");
    near(t.iv90, independentIv(pts, 90), 1e-12, "total variance at 90");
    const odd = [{ dte: 10, iv: 0.1 }, { dte: 100, iv: 0.5 }];
    near(M.termState(odd).iv90, independentIv(odd, 90), 1e-12, "between 10 and 100");
    const rnd = lcg(7);
    for (let i = 0; i < 400; i++) {
      const dtes = [...new Set(Array.from({ length: 2 + Math.floor(rnd() * 6) }, () => 5 + Math.floor(rnd() * 420)))].sort((a, b) => a - b);
      const curve = dtes.map((dte) => ({ dte, iv: 0.08 + rnd() * 0.5 }));
      const got = M.termState(curve);
      const want30 = independentIv(curve, 30), want90 = independentIv(curve, 90);
      if (want30 === null) se(got.iv30, null, "no extrapolation at 30");
      else near(got.iv30, want30, 1e-9, "iv30");
      if (want90 === null) se(got.iv90, null, "no extrapolation at 90");
      else near(got.iv90, want90, 1e-9, "iv90");
    }
  });

  check("term-edge", () => {
    const short = [{ dte: 7, iv: 0.2 }, { dte: 60, iv: 0.2 }];
    const t = M.termState(short);
    se(t.iv90, null, "90 is past the last point");
    se(t.state, null, "so there is no state");
    se(t.why, "edge", "and it says edge");
    const lowEdge = M.termState([{ dte: 45, iv: 0.2 }, { dte: 120, iv: 0.2 }]);
    se(lowEdge.iv30, null, "30 is before the first point");
  });

  check("term-states", () => {
    const at = (slope) => M.termState([{ dte: 30, iv: 0.2 }, { dte: 90, iv: 0.2 + slope / 100 }]).state;
    se(at(0.4999), "flat", "just under half a point up");
    se(at(0.5), "contango", "half a point up");
    se(at(0.5001), "contango", "over half a point up");
    se(at(-0.4999), "flat", "just under half a point down");
    se(at(-0.5), "backwardation", "half a point down");
    se(at(-0.5001), "backwardation", "over");
    se(at(0), "flat", "flat");
  });

  check("futures-roll", () => {
    const shapes = FX.shapes.conjectured;
    const body = { data: { latest: [
      { expiry: "2026-11-12", price: "18.00", vix: "16.5" },
      { expiry: "2026-12-10", price: "19.26", vix: "16.5" },
      { expiry: "2027-01-14", price: "20.00", vix: "16.5" },
    ], history: [] } };
    const f = M.futuresCurve(body, shapes, "2026-10-23");
    se(f.status, "ok", "ok");
    se(f.front.days, 20, "front days");
    se(f.second.days, 48, "second days");
    near(f.roll30, (19.26 / 18 - 1) * 30 / 28, 1e-12, "roll per 30 days");
    se(f.spot, 16.5, "spot");
    const dup = { data: { latest: [{ expiry: "2026-11-12", price: "18.0" }, { expiry: "2026-11-12", price: "19.0" }, { expiry: "2026-12-10", price: "20" }] } };
    const g = M.futuresCurve(dup, shapes, "2026-10-23");
    se(g.points.length, 2, "duplicate expiries collapse");
    se(g.front.price, 19, "to the later row");
    const same = M.futuresCurve({ data: { latest: [{ expiry: "2026-11-12", price: "18.0" }] } }, shapes, "2026-10-23");
    se(same.roll30, null, "one point has no roll");
    const bad = M.futuresCurve({ data: { latest: [{ expiry: "2026-11-12", price: "-4" }, { expiry: "2026-12-12", price: "0" }] } }, shapes, "2026-10-23");
    se(bad.status, "failed", "non-positive prices are refused");
  });

  check("futures-unshaped", () => {
    const body = FX.vix;
    const real = M.futuresCurve({ data: { latest: body.rows, history: body.history } }, SHAPES_REAL, "2026-10-23");
    se(real.status, "unshaped", "the real manifest lists nothing, so unshaped");
    se(real.points.length, 0, "no points drawn");
    const noPrice = M.futuresCurve({ data: { latest: body.rows } }, FX.shapes.conjecturedNoPrice, "2026-10-23");
    se(noPrice.status, "unshaped", "a missing price key is unshaped");
    se(noPrice.why, "keys", "for its keys");
    const positional = M.futuresCurve({ data: { latest: [["2026-11-12", 18]] } }, FX.shapes.conjectured, "2026-10-23");
    se(positional.status === "ok", false, "no positional fallback");
  });

  check("corr-shape", () => {
    const m = M.corrMatrix(FX.corr.ok, M.CORR_TICKERS);
    se(m.cells.length, 105, "n(n-1)/2 cells");
    se(m.cells[0].length >= 2, true, "each cell has r and rows");
    se(m.cells[M.pairIndex(0, 1, 15)][0] !== undefined, true, "the first pair");
    se(m.minDate, "2026-07-24", "window start");
    se(m.maxDate, SESSION, "window end");
    const swap = M.corrMatrix(FX.corr.ok.slice().reverse(), M.CORR_TICKERS);
    sd(swap.cells, m.cells, "row order of the feed does not matter");
  });

  check("corr-asym", () => {
    const m = M.corrMatrix(FX.corr.asym, M.CORR_TICKERS);
    se(m.cells[0][0], null, "two values for one pair withhold it");
    se(m.cells[0][2], "asym", "and say asym");
  });

  check("corr-absent", () => {
    const m = M.corrMatrix(FX.corr.absent, M.CORR_TICKERS);
    se(m.cells[0][0], null, "a missing pair is null, not zero");
    se(m.cells[0][2], "absent", "absent");
    const oneSide = FX.corr.ok.filter((r) => !(r.fst === "QQQ" && r.snd === "SPY"));
    const one = M.corrMatrix(oneSide, M.CORR_TICKERS);
    se(one.cells[0][0] !== null, true, "one order present is used");
  });

  check("corr-avg-gate", () => {
    const full = M.corrMatrix(FX.corr.ok, M.CORR_TICKERS);
    se(full.sectorN, 55, "55 sector pairs");
    const manual = [];
    const idx = new Map(M.CORR_TICKERS.map((t, i) => [t, i]));
    for (const r of FX.corr.ok) if (idx.get(r.fst) >= 4 && idx.get(r.snd) >= 4 && idx.get(r.fst) < idx.get(r.snd)) manual.push(Number(r.correlation));
    near(full.sectorAvg, manual.reduce((a, b) => a + b, 0) / manual.length, 1e-4, "average of the sector pairs");
    const drop = (n) => {
      const pairs = [...new Set(FX.corr.ok.filter((r) => idx.get(r.fst) >= 4 && idx.get(r.snd) >= 4).map((r) => [r.fst, r.snd].sort().join("|")))].sort();
      const gone = new Set(pairs.slice(0, n));
      return FX.corr.ok.filter((r) => !gone.has([r.fst, r.snd].sort().join("|")));
    };
    const at40 = M.corrMatrix(drop(15), M.CORR_TICKERS);
    se(at40.sectorN, 40, "40 pairs");
    se(at40.sectorAvg !== null, true, "printed at 40");
    const at39 = M.corrMatrix(drop(16), M.CORR_TICKERS);
    se(at39.sectorN, 39, "39 pairs");
    se(at39.sectorAvg, null, "withheld at 39");
    se(M.corrMatrix(FX.corr.few, M.CORR_TICKERS).sectorAvg, null, "and in the few world");
  });

  check("movers-boundary", () => {
    const mk = (hl, label = "moderate") => ({ meanRev: [["T", label, hl, 0.4]], persistent: [] });
    const run = (a, b) => M.characterMovers(mk(a), mk(b)).movers;
    se(run(1.2999, 1).length, 0, "just under 1.3 is not a mover");
    se(run(1.3001, 1).length, 1, "just over 1.3");
    se(run(1, 1.3001).length, 1, "and the other way");
    se(run(1, 1.2999).length, 0, "other way under");
    const label = M.characterMovers(mk(1, "persistent"), mk(1, "moderate")).movers;
    se(label.length, 1, "a label change is a mover");
    se(label[0][5], "label", "kind label");
    const ordered = M.characterMovers(
      { meanRev: [["A", "x", 2, 0.4], ["B", "y", 10, 0.4], ["C", "x", 4, 0.4]], persistent: [] },
      { meanRev: [["A", "x", 1, 0.4], ["B", "x", 10, 0.4], ["C", "x", 1, 0.4]], persistent: [] }).movers;
    sd(ordered.map((r) => r[0]), ["B", "C", "A"], "label changes first, then by log ratio");
    se(M.characterMovers(mk(1), null).movers, null, "no previous night, no movers");
    se(M.characterMovers(mk(1), null).why, "first", "first");
  });

  check("movers-new", () => {
    const today = { meanRev: [["NEW", "persistent", 3, 0.6], ["OLD", "persistent", 3, 0.6]], persistent: [] };
    const prev = { meanRev: [["OLD", "persistent", 3, 0.6]], persistent: [] };
    sd(M.characterMovers(today, prev).movers, [], "a name absent from the previous night is new, never a mover");
    se(M.characterMovers(today, prev).fresh, 1, "and counted");
  });

  check("audit-worlds", () => {
    for (const name of ["agree", "differs", "per1pct", "nounit", "dateoff", "truncated", "spotoff", "selfoff"]) {
      const w = FX.worlds[name];
      const a = auditK(w.input);
      sd(verdicts(a), w.expect.rows, `${name}: every row's verdict`);
      se(a.v, w.expect.v, `${name}: the name verdict`);
      if (w.expect.unit !== undefined) se(a.unit, w.expect.unit, `${name}: the gamma unit`);
    }
    const agree = auditK(FX.worlds.agree.input);
    se(agree.expiry, "2026-11-22", "the expiry nearest 30 days");
    se(agree.rows.length, 9, "nine rows");
    sd(agree.rows.map((r) => r[0]), [...M.ROW_IDS], "in the frozen order");
    se(agree.strikes.length, 5, "five strikes");
    se(agree.n.agree + agree.n.differs + agree.n.nc, 8, "tally counts the eight engine-against-feed rows");
    se(rowOf(agree, "chainSelf") ? true : false, true, "and the feed-against-feed row is kept apart");
  });

  check("audit-sign", () => {
    const d = M.auditName(FX.worlds.agree.input);
    se(rowOf(d, "gexAll")[5], "nc", "gamma exposure is not compared while the sign is unconfirmed");
    se(rowOf(d, "gexAll")[6], "sign", "and says sign");
    se(rowOf(d, "dexExpiry")[5], "nc", "delta exposure the same");
    se(rowOf(d, "dexExpiry")[6], "sign", "with the same reason");
    const neg = tweak("agree", (w) => { for (const r of w.exStrike.rows || w.exStrike) if (r && typeof r === "object" && r.put_gex !== undefined) r.put_gex = "-" + String(r.put_gex).replace("-", ""); });
    const n = M.auditName(neg);
    se(rowOf(n, "gexAll")[6], "sign", "a put-negative world is still not compared");
    const self = tweak("agree", (w) => { for (const r of w.atm.rows || w.atm) if (r && r.open_interest !== undefined) r.open_interest = String(Number(r.open_interest) + 7); });
    const sa = auditK(self);
    se(rowOf(sa, "chainSelf")[5], "differs", "a feed-against-feed difference shows on its own row");
    se(sa.v, auditK(FX.worlds.agree.input).v, "and never moves the name verdict");
  });

  check("audit-failed", () => {
    const f = auditK(FX.worlds.failed.input);
    const stNc = (c, m) => st(c, m);
    se(rowOf(f, "delta")[5], "nc", "a failed read is not compared");
    se(rowOf(f, "delta")[6], "failed", "and says failed");
    const p = auditK(FX.worlds.plan.input);
    se(rowOf(p, "delta")[6], "plan", "plan");
    se(rowOf(p, "oiExpiry")[6], "limited", "limited");
    for (const row of [...f.rows, ...p.rows]) if (row[5] === "nc" && row[0] !== "chainSelf") stNc(row[3] === null, "an nc row never carries a gap");
  });

  check("unit-boundaries", () => {
    const S = 250;
    const gammaScaled = (k) => tweak("agree", (w) => {
      for (const r of w.greeks) r.call_gamma = String(Number(r.call_gamma) * k);
    });
    const base = auditK(FX.worlds.agree.input);
    const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const r0 = med(base.strikes.map((s) => s[6] / s[5]));
    const plain = (target) => auditK(gammaScaled(target / r0));
    se(plain(1.149).unit, "per$", "1.149 of the engine reads as per dollar");
    se(plain(1.151).unit, null, "1.151 matches neither");
    se(plain(1 / 1.149).unit, "per$", "the lower edge");
    se(plain(1 / 1.151).unit, null, "below it");
    se(plain((S / 100) * 1.149).unit, "per1%", "S/100 times 1.149 reads as per 1%");
    se(plain((S / 100) * 1.151).unit, null, "S/100 times 1.151 matches neither");
    se(plain(1 / ((S / 100) * 1.149)).unit, null, "the inverse of S/100 matches neither");
    se(rowOf(plain((S / 100) * 1.149), "gamma")[6], "units", "per 1% is not compared");
    se(rowOf(plain(7), "gamma")[6], "units", "an unknown unit is not compared");
    se(rowOf(plain((S / 100) * 1.149), "gexAll")[6], "units", "nor the gamma exposure");
    se(base.unit, "per$", "baseline");
  });

  check("tol-rows", () => {
    const base = auditK(FX.worlds.agree.input);
    const g0 = (id) => rowOf(base, id)[3];
    const run = (fn) => auditK(tweak("agree", fn));
    const shiftDelta = (s) => (w) => { for (const r of w.greeks) r.call_delta = String(Number(r.call_delta) + s); };
    se(rowOf(run(shiftDelta(0.03 - g0("delta") - 0.0006)), "delta")[5], "agree", "delta just inside");
    se(rowOf(run(shiftDelta(0.03 - g0("delta") + 0.0006)), "delta")[5], "differs", "delta just outside");
    se(rowOf(run(shiftDelta(-0.03 - g0("delta") + 0.0006)), "delta")[5], "agree", "negative delta gap just inside");
    se(rowOf(run(shiftDelta(-0.03 - g0("delta") - 0.0006)), "delta")[5], "differs", "negative delta gap just outside");
    const shiftIv = (pts) => (w) => { for (const r of w.greeks) { r.call_volatility = String(Number(r.call_volatility) + pts / 100); r.put_volatility = String(Number(r.put_volatility) + pts / 100); } };
    se(rowOf(run(shiftIv(1.5 - g0("iv") - 0.02)), "iv")[5], "agree", "iv just inside");
    se(rowOf(run(shiftIv(1.5 - g0("iv") + 0.02)), "iv")[5], "differs", "iv just outside");
    se(rowOf(run(shiftIv(-1.5 - g0("iv") - 0.02)), "iv")[5], "differs", "iv negative outside");
    se(rowOf(run(shiftIv(-1.5 - g0("iv") + 0.02)), "iv")[5], "agree", "iv negative inside");
    const spotAt = (rel) => (w) => { for (const r of w.atm) r.stock_price = String(250 * (1 + rel)); };
    se(rowOf(run(spotAt(0.0024)), "spot")[5], "agree", "spot inside 0.25%");
    se(rowOf(run(spotAt(0.0027)), "spot")[5], "differs", "spot outside");
    const oiE = rowOf(base, "oiExpiry")[1];
    const setOi = (f) => (w) => {
      const hit = w.oiExpiry.find((r) => r.expiry === base.expiry);
      hit.call_oi = f - hit.put_oi;
    };
    se(rowOf(run(setOi(oiE - Math.floor(oiE * 0.01))), "oiExpiry")[5], "agree", "oi at 1%");
    se(rowOf(run(setOi(oiE - Math.floor(oiE * 0.01) - 8)), "oiExpiry")[5], "differs", "oi past 1%");
    const dexE = rowOf(base, "dexExpiry")[1];
    const gross = (() => {
      let g = 0;
      for (const r of FX.worlds.agree.input.exStrikeExpiry) g += Math.abs(Number(r.call_delta)) + Math.abs(Number(r.put_delta));
      return g;
    })();
    const setDex = (f) => (w) => {
      const sum = w.exStrikeExpiry.reduce((s, r) => s + Number(r.call_delta) + Number(r.put_delta), 0);
      w.exStrikeExpiry[0].call_delta = String(Number(w.exStrikeExpiry[0].call_delta) + (f - sum));
    };
    se(rowOf(run(setDex(dexE - 0.0499 * gross)), "dexExpiry")[5], "agree", "dex inside 5% of gross");
    se(rowOf(run(setDex(dexE - 0.0505 * gross)), "dexExpiry")[5], "differs", "dex outside");
    const gexE = rowOf(base, "gexAll")[1];
    const setGex = (rel) => (w) => {
      const f = gexE * (1 - rel);
      const sum = w.exStrike.reduce((s, r) => s + Number(r.call_gex) + Number(r.put_gex), 0) * 250 * 250 / 100;
      const k = f / sum;
      for (const r of w.exStrike) { r.call_gex = String(Number(r.call_gex) * k); r.put_gex = String(Number(r.put_gex) * k); }
    };
    se(rowOf(run(setGex(0.0995)), "gexAll")[5], "agree", "gex inside 10%");
    se(rowOf(run(setGex(0.1005)), "gexAll")[5], "differs", "gex outside");
    const eg = base.strikes.map((s) => s[5]);
    const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const gapFor = (x) => { const f = eg.map((g, i) => (i < 2 ? g * x : g)); return Math.abs(avg(eg) - avg(f)) / Math.max(avg(eg), avg(f)); };
    const solve = (target) => { let lo = 1, hi = 50; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (gapFor(mid) < target) lo = mid; else hi = mid; } return lo; };
    const setGamma = (x) => (w) => {
      const picked = new Map(base.strikes.map((s, i) => [s[0].toFixed(2), eg[i] * (i < 2 ? x : 1)]));
      for (const r of w.greeks) if (picked.has(Number(r.strike).toFixed(2))) r.call_gamma = String(picked.get(Number(r.strike).toFixed(2)));
    };
    se(rowOf(run(setGamma(solve(0.1485))), "gamma")[5], "agree", "gamma inside 15%");
    se(rowOf(run(setGamma(solve(0.1515))), "gamma")[5], "differs", "gamma outside");
  });

  check("choose-expiry", () => {
    const ex = (dte, expiry) => ({ dte, expiry });
    se(M.chooseExpiry([ex(9, "a"), ex(30, "b"), ex(58, "c")]).expiry, "b", "nearest 30");
    se(M.chooseExpiry([ex(5, "a"), ex(6, "b")]), null, "none at 7 days or more");
    se(M.chooseExpiry([ex(7, "a"), ex(60, "b")]).expiry, "a", "7 is allowed and nearer");
    se(M.chooseExpiry([ex(20, "late"), ex(40, "early")]).expiry, "early", "ties go to the earlier expiry (string order)");
    se(M.chooseExpiry([]), null, "empty");
  });

  check("stance-dte", () => {
    const e = M.stanceExtract({ data: FX.stance }, "SYX101", SESSION);
    se(e.rows.length, 3, "top three of the rows with dte up to 14");
    st(e.rows.every((r) => r[4] <= 14), "dte 15 is dropped");
    se(e.rows.some((r) => r[4] === 14), true, "dte 14 is kept");
    se(e.rows[0][5] >= e.rows[1][5], true, "ordered by fit score");
    se(e.rows[0].length, 6, "six fields");
  });

  check("verdict-nc", () => {
    const a = auditK(FX.worlds.nounit.input);
    se(a.n.nc, 2, "nc rows are counted as nc");
    se(a.n.agree, 6, "agree rows as agree");
  });

  check("verdict-few", () => {
    const a = auditK(tweak("agree", (w) => { w.greeks = { why: "failed" }; w.atm = { why: "failed" }; w.oiExpiry = { why: "failed" }; w.volOi = { why: "failed" }; w.exStrike = { why: "failed" }; w.exStrikeExpiry = { why: "failed" }; w.chains = { why: "failed" }; }));
    se(a.v, "nc", "fewer than three compared rows is not agree");
    se(a.why, "few", "and says few");
    const three = auditK(tweak("agree", (w) => { w.greeks = { why: "failed" }; w.exStrike = { why: "failed" }; w.exStrikeExpiry = { why: "failed" }; w.chains = { why: "failed" }; }));
    se(three.n.agree + three.n.differs, 3, "three compared");
    se(three.v, "agree", "agree at three");
    const two = auditK(tweak("agree", (w) => { w.greeks = { why: "failed" }; w.exStrike = { why: "failed" }; w.exStrikeExpiry = { why: "failed" }; w.chains = { why: "failed" }; w.volOi = { why: "failed" }; }));
    se(two.n.agree + two.n.differs, 2, "two compared");
    se(two.v, "nc", "two compared rows are not an agreement");
  });

  check("truncated", () => {
    const a = auditK(FX.worlds.truncated.input);
    for (const id of ["oiExpiry", "oiAll", "dexExpiry", "gexAll"]) {
      se(rowOf(a, id)[5], "nc", `${id} is not compared on a partial chain`);
      se(rowOf(a, id)[6], "partial chain", `${id} says why`);
    }
  });

  check("dateoff", () => {
    const a = auditK(FX.worlds.dateoff.input);
    for (const id of ["delta", "iv", "gamma"]) se(rowOf(a, id)[6], "date", `${id}: a feed row of another session is not compared`);
    const o = auditK(tweak("agree", (w) => { w.oiExpiry.find((r) => r.expiry === "2026-11-22").date = "2026-10-22"; }));
    se(rowOf(o, "oiExpiry")[6], "date", "nor an open interest row of another session");
  });

  check("withheld-greeks", () => {
    const seen = new Set();
    const w = clone(FX.worlds.agree.input);
    for (const k of ["greeks", "chains", "atm", "oiExpiry", "volOi", "exStrike", "exStrikeExpiry"]) w[k] = proxied(w[k], seen);
    auditK(w);
    const allowed = new Set([...opById("greeks").reads, ...opById("option-chains").reads, ...opById("atm-chains").reads, ...opById("oi-per-expiry").reads,
      ...opById("volume-oi-expiry").reads, ...opById("greek-exposure-strike").reads, ...opById("greek-exposure-strike-expiry").reads]);
    const never = [...M.NEVER_READ.greeks, ...M.NEVER_READ.exposure];
    se([...seen].filter((k) => never.includes(k)).length, 0, "no theta, vega, rho, charm or vanna is touched");
    se([...seen].filter((k) => !allowed.has(k)).join(","), "", "and nothing outside the registry's reads");
  });

  check("withheld-stats", () => {
    const seen = new Set();
    const row = { ticker: "SPY", date: SESSION, iv: "0.2", iv_high: "0.3", iv_low: "0.1", rv: "0.15", iv_rank: "55", rv_high: "0.4", rv_low: "0.05" };
    const p = proxied([row], seen)[0];
    const s = M.statsRow({ data: p });
    se(s.status, "ok", "read");
    se([...seen].filter((k) => M.NEVER_READ.stats.includes(k)).length, 0, "iv_rank, rv_high and rv_low are never read");
    const served = JSON.stringify(M.ivrvFund(FX.realized.fresh, { data: row }, SESSION));
    st(!/ivRank|iv_rank|rvHigh|rv_high|rvLow|rv_low/.test(served), "no such key in the served section");
    const above = M.statsRow({ data: { ...row, iv: "0.35" } });
    st(above.ivPlace > 1, "an implied above its year high is not clamped to the top");
    st(M.statsRow({ data: { ...row, iv: "0.05" } }).ivPlace < 0, "nor one below its low to the bottom");
  });

  check("stance-not-served", () => {
    const parts = {
      term: { funds: {}, futures: {} }, ivrv: {}, matrix: {}, character: {}, audit: {}, ops: {},
      stance: [["SYX101C", 0.5, 0.3, 0.4, 5, 4]], fit_score: 4, pop: 0.5,
    };
    const out = M.buildVoldesk(parts, { session: SESSION, generatedAt: "2026-10-23T21:45:00Z", test: true });
    const text = JSON.stringify(out);
    st(!/SYX101C|fit_score|"pop"|stance/.test(text), "the stance rows never enter the voldesk payload");
  });

  check("unshaped-char", () => {
    const real = M.reduceCharacterTop({ data: FX.character.today }, SHAPES_REAL);
    se(real.status, "unshaped", "the real manifest has no entry");
    const conj = M.reduceCharacterTop({ data: FX.character.today }, FX.shapes.conjectured);
    se(conj.status, "ok", "the conjectured manifest reads");
    se(conj.rows.length, 6, "all rows");
    const missing = M.reduceCharacterTop({ data: FX.character.today }, FX.shapes.conjecturedNoPrice);
    se(missing.status, "unshaped", "a key the manifest does not list makes the result unshaped");
    se(M.reduceCharacterTop({ data: FX.character.today.map((r) => ({ ...r, half_life_days: "" })) }, FX.shapes.conjectured).status, "failed", "empty strings are not read as zero");
  });

  check("fitters", () => {
    const a = auditK(FX.worlds.agree.input);
    const va = M.buildVa(a, { at: "2026-10-23T21:45:00Z", session: SESSION });
    st(JSON.stringify(va).length <= M.VA_CAP, "a va fits its 2 KiB");
    const fat = { ...va, strikes: Array.from({ length: 40 }, (_, i) => [i, 1.123456, 1.123456, 0.3, 0.3, 0.00012345, 0.00012345]) };
    st(JSON.stringify(M.fitVa(fat)).length <= M.VA_CAP, "an overlong strikes list is cut to fit");
    const ring = Array.from({ length: 30 }, (_, i) => ({ session: `2026-09-${String(i + 1).padStart(2, "0")}`, rows: { AAA: Array.from({ length: 3 }, () => ["AAA261218C00100000", 0.5, 0.3, 0.4, 5, 4]) } }));
    se(M.fitStance(ring).length, 14, "the ring keeps 14 sessions");
    const big = Array.from({ length: 14 }, (_, i) => ({ session: `2026-10-${String(i + 1).padStart(2, "0")}`, rows: Object.fromEntries(Array.from({ length: 60 }, (_, j) => ["T" + j, [["T" + j + "261218C00100000", 0.5, 0.3, 0.4, 5, 4]]])) }));
    const fitted = M.fitStance(big, 20000);
    st(fitted.length < 14 && fitted.length >= 1, "an over-cap ring drops its oldest sessions");
    se(fitted[0].session, "2026-10-01", "and keeps the newest first");
    const payload = { v: 1, session: SESSION, generatedAt: "x", term: { futures: { points: Array.from({ length: 20 }, (_, i) => [i]) } }, matrix: { "1Y": { cells: Array.from({ length: 105 }, () => [0.1234, 63]) } }, character: { prev: { meanRev: Array.from({ length: 50 }, () => ["AAAA", "moderate", 3.1234, 0.4321]), persistent: [] } } };
    const cut = M.fitVoldesk(payload, 3000);
    sd(cut.shed, ["character.prev", "matrix.1Y", "futures.history"].slice(0, cut.shed.length), "sheds in the stated order");
    se(cut.shed[0], "character.prev", "character.prev first");
  });

  check("fixture-refusal", () => {
    const parts = { term: {}, ivrv: {}, matrix: {}, character: {}, audit: { worst: [["SYX101", "delta", 0.1]] }, ops: {} };
    let threw = false;
    try { M.buildVoldesk(parts, { session: SESSION, generatedAt: "x" }); } catch { threw = true; }
    st(threw, "a fixture name is refused outside the test flag");
    const ok_ = M.buildVoldesk(parts, { session: SESSION, generatedAt: "x", test: true });
    se(ok_.fixture, true, "and stamped inside it");
    const stanceFx = M.buildStance([], new Map([["SYX101", { rows: [["SYX101261218C00100000", 0.5, 0.3, 0.4, 5, 4]] }]]), { session: SESSION, test: true });
    se(stanceFx.fixture, true, "the stance store is stamped too");
    let threw3 = false;
    try { M.buildStance([], new Map([["SYX101", { rows: [["SYX101261218C00100000", 0.5, 0.3, 0.4, 5, 4]] }]]), { session: SESSION }); } catch { threw3 = true; }
    st(threw3, "and refused without the flag");
  });

  check("caps", () => {
    se(M.auditCap({}), 36, "default");
    se(M.auditCap({ FLOWS_VOLAUDIT_CAP: "0" }), 0, "zero");
    se(M.auditCap({ FLOWS_VOLAUDIT_CAP: "500" }), 120, "clamped to 120");
    se(M.auditCap({ FLOWS_VOLAUDIT_CAP: "-4" }), 0, "clamped at zero");
    se(M.auditCap({ FLOWS_VOLAUDIT_CAP: "abc" }), 36, "garbage is the default");
    se(M.marketCalls(36).max, 337, "337 calls at the default cap");
    se(M.marketCalls(120).max, (4 + 120) * 8 + 17, "and at the ceiling");
    se(M.marketCalls(-1).cap, 0, "negative clamps");
  });

  check("health-gap", () => {
    const mk = (differs, agree, extra = {}) => ({ names: 40, agree, differs, nc: 5, calls: 300, ...extra });
    const warn = HM.volAuditChecks(mk(11, 89, { eligible: true }));
    se(warn.failures.length, 0, "11% warns");
    se(warn.warnings.length >= 1, true, "warning");
    const at10 = HM.volAuditChecks(mk(10, 90, { eligible: true }));
    se(at10.warnings.filter((w) => /differs/.test(w)).length, 0, "10% is not past the warn line");
    const at25 = HM.volAuditChecks(mk(25, 75, { eligible: true }));
    se(at25.failures.length, 0, "25% is not past the fail line");
    const fail = HM.volAuditChecks(mk(26, 74, { eligible: true }));
    se(fail.failures.length, 1, "26% with standing fails");
    const noStanding = HM.volAuditChecks(mk(26, 74, { eligible: false }));
    se(noStanding.failures.length, 0, "26% without standing only warns");
    se(noStanding.warnings.some((w) => /engine cross-check differs/.test(w)), true, "with a warning");
    const few = HM.volAuditChecks(mk(20, 20, { eligible: true }));
    se(few.failures.length + few.warnings.length, 0, "under 50 compared rows is a note");
    se(few.notes.some((n) => /reported not judged/.test(n)), true, "a note");
    const shape = HM.volAuditChecks(mk(0, 100, { shape: { greeks: { n: 20, bad: 5 }, "oi-per-expiry": { n: 19, bad: 19 }, "atm-chains": { n: 40, bad: 8 } } }));
    se(shape.warnings.length, 1, "one shape warning");
    st(/greeks 5 of 20/.test(shape.warnings[0]) && !/atm-chains/.test(shape.warnings[0]) && !/oi-per-expiry/.test(shape.warnings[0]), "20 percent is not past the line and 19 attempts are too few");
  });

  check("health-standing", () => {
    const fail = { names: 40, agree: 74, differs: 26, nc: 0, calls: 1, eligible: false };
    se(HM.volAuditChecks(fail).failures.length, 0, "no standing, no failure");
    se(HM.volAuditStanding("fail", { clean: 7, state: "ok" }).eligible, true, "seven clean nights and no failure the night before");
    se(HM.volAuditStanding("fail", { clean: 6, state: "ok" }).eligible, false, "six is not enough");
    se(HM.volAuditStanding("fail", { clean: 9, state: "fail" }).eligible, false, "a failure the night before removes it");
    se(HM.volAuditStanding("ok", { clean: 3 }).clean, 4, "an ok night adds one");
    se(HM.volAuditStanding("warn", { clean: 3 }).clean, 0, "a warn night resets");
    se(HM.volAuditStanding("report", { clean: 3 }).clean, 3, "a report night keeps");
    se(HM.volAuditState({ agree: 100, differs: 10 }), "ok", "9.1% is ok");
    se(HM.volAuditState({ agree: 30, differs: 10 }), "report", "under 50 compared");
  });

  return fails;
}

const real = battery(V, H);
same(real, [], "THE REAL BUILD PASSES EVERY CHECK OF THE BATTERY");

const LEAF = "shared/flows-voldesk.js";
const HEALTH = "scripts/flows-legs/health.mjs";

const MUTANTS = [
  ["interpolate-iv-not-variance", LEAF, [["return Math.sqrt(w / (d / 365));", "return lo.iv + (hi.iv - lo.iv) * (d - lo.dte) / ((hi.dte - lo.dte) || 1);"]], "term-variance"],
  ["extrapolate-term", LEAF, [["if (d < sorted[0].dte || d > sorted[sorted.length - 1].dte) return null;", ""]], "term-edge"],
  ["flat-band-0.05", LEAF, [["export const TERM_FLAT_PTS = 0.5;", "export const TERM_FLAT_PTS = 0.05;"]], "term-states"],
  ["roll-without-days-scaling", LEAF, [["(second.price / front.price - 1) * 30 / (second.days - front.days)", "(second.price / front.price - 1)"]], "futures-roll"],
  ["missing-pair-as-zero", LEAF, [["if (!entries) cell = [null, null, \"absent\"];", "if (!entries) cell = [0, null, \"absent\"];"]], "corr-absent"],
  ["asym-by-averaging", LEAF, [["cell = [null, null, \"asym\"];", "cell = [r4((good[0].r.v + good[1].r.v) / 2), good[0].rows.v];"]], "corr-asym"],
  ["diagonal-stored", LEAF, [["    for (let j = i + 1; j < n; j++) {\n      const entries = seen.get(`${i}:${j}`);", "    for (let j = i; j < n; j++) {\n      const entries = seen.get(`${i}:${j}`);"]], "corr-shape"],
  ["sector-average-under-40", LEAF, [["sectorAvg: sectorN >= SECTOR_PAIRS_MIN ? r4(", "sectorAvg: sectorN >= 1 ? r4("]], "corr-avg-gate"],
  ["mover-on-new-name", LEAF, [["if (!old) { fresh++; continue; }", "if (!old) { fresh++; movers.push({ row: [t, row[1], null, row[2], null, \"new\"], label: true, ratio: 0 }); continue; }"]], "movers-new"],
  ["gamma-rescaled-to-agree", LEAF, [["const fg = avg(fG);", "const fg = avg(fG) / (unit === \"per1%\" ? S / 100 : 1);"], ["if (unit === \"per$\") {\n            const eg", "if (unit === \"per$\" || unit === \"per1%\") {\n            const eg"]], "unit-boundaries"],
  ["gamma-compared-with-unit-null", LEAF, [["if (unit === \"per$\") {\n            const eg", "if (unit === \"per$\" || unit === null) {\n            const eg"]], "unit-boundaries"],
  ["delta-signed-gap-only", LEAF, [["Math.abs(gap) <= tol + 1e-12 ? \"agree\" : \"differs\"]", "gap <= tol + 1e-12 ? \"agree\" : \"differs\"]"]], "tol-rows"],
  ["truncated-chain-compared", LEAF, [["const chainOk = chain && Array.isArray(chain.rows) && !chain.truncated;", "const chainOk = chain && Array.isArray(chain.rows);"]], "truncated"],
  ["other-session-compared", LEAF, [["{ dateOff = true; continue; }", "{ dateOff = true; }"]], "dateoff"],
  ["nc-counted-as-agree", LEAF, [["if (r[0] !== \"chainSelf\") n[r[5]]++;", "if (r[0] !== \"chainSelf\") n[r[5] === \"nc\" ? \"agree\" : r[5]]++;"]], "verdict-nc"],
  ["feed-against-feed-counted", LEAF, [["if (r[0] !== \"chainSelf\") n[r[5]]++;", "n[r[5]]++;"]], "audit-sign"],
  ["exposure-sign-assumed", LEAF, [["export const EXPOSURE_SIGN_KNOWN = false;", "export const EXPOSURE_SIGN_KNOWN = true;"]], "audit-sign"],
  ["iv-place-clamped", LEAF, [["ivPlace: place };", "ivPlace: place === null ? null : Math.min(1, Math.max(0, place)) };"]], "withheld-stats"],
  ["agree-with-two-rows", LEAF, [["compared >= 3 ? \"agree\"", "compared >= 0 ? \"agree\""]], "verdict-few"],
  ["iv-rank-served", LEAF, [["return { status: \"ok\", iv: iv.v, ivHigh: hi.v,", "return { status: \"ok\", ivRank: row.iv_rank, iv: iv.v, ivHigh: hi.v,"], ["? { iv: r6(stats.iv),", "? { ivRank: stats.ivRank, iv: r6(stats.iv),"]], "withheld-stats"],
  ["rv-high-read", LEAF, [["const rv = volOf(row.rv, \"rv\");", "const rv = volOf(row.rv, \"rv\"); void row.rv_high;"]], "withheld-stats"],
  ["stance-copied-into-voldesk", LEAF, [["audit: parts.audit, basis:", "audit: parts.audit, stance: parts.stance, basis:"]], "stance-not-served"],
  ["unschemed-reducer-reads-unlisted-key", LEAF, [["if (!CHAR_KEYS.every((k) => Object.hasOwn(known.set, k))) return { status: \"unshaped\", why: \"keys\", rows: [] };", ""]], "unshaped-char"],
  ["null-string-read-as-zero", LEAF, [["if (typeof value === \"string\" && NUM_RE.test(value)) {", "if (typeof value === \"string\") {"]], "numbers"],
  ["stance-keeps-dte-15", LEAF, [["dte.v > STANCE_DTE) continue;", "dte.v > STANCE_DTE + 1) continue;"]], "stance-dte"],
  ["health-fails-without-standing", HEALTH, [["} else if (state === \"fail\" && volaudit.eligible) {", "} else if (state === \"fail\") {"]], "health-standing"],
  ["fixture-names-allowed", LEAF, [["function leak(payload, test) {\n  if (test) return;", "function leak(payload, test) {\n  return;"]], "fixture-refusal"],
];

const dedupe = new Set();
for (const [id, file, transforms, named] of MUTANTS) {
  ok(!dedupe.has(id), `${id}: a mutant is registered once`);
  dedupe.add(id);
  const mod = await loadMutated(file, transforms, { salt: checks });
  const fails = file === LEAF ? battery(mod, H) : battery(V, mod);
  ok(fails.some((f) => f.startsWith(named + ":")), `PLANTED ${id}: the battery fails its check "${named}" (failed: ${fails.map((f) => f.split(":")[0]).join(", ") || "nothing"})`);
}
eq(MUTANTS.length, 27, "twenty-seven planted wrong builds, the package's twenty-four and three from review");

{
  const ids = OPS.filter((e) => e.reads && e.reads.length === 0).map((e) => e.id);
  same(ids, ["vix-term", "vol-character-top"], "only the two unschemed volatility reads carry an empty read list");
  for (const id of ["vix-term", "vol-character-top", "vol-realized", "vol-stats", "greeks", "option-chains", "atm-chains", "oi-per-expiry", "volume-oi-expiry",
    "greek-exposure-strike", "greek-exposure-strike-expiry", "option-stance", "market-correlations"]) {
    ok(opById(id), `${id} is in the registry`);
  }
  eq(opById("vix-term").plan, "addon:volatility", "the VIX curve names its add-on");
  for (const names of Object.values(V.NEVER_READ)) {
    for (const n of names) {
      for (const id of ["greeks", "greek-exposure-strike", "greek-exposure-strike-expiry", "vol-stats", "option-stance"]) ok(!(opById(id).reads || []).includes(n), `${id} never lists ${n}`);
    }
  }
  eq(V.WITHHELD.length, 6, "the withheld table has six rows");
  ok(V.WITHHELD.every((r) => typeof r.reason === "string" && r.reason.endsWith(".")), "each with a printed reason");
}

{
  eq(FX.provenance.generator, "tests/gen-voldesk-fixtures.py", "the fixtures name their generator");
  eq(FX.provenance.generatorSha256, createHash("sha256").update(fs.readFileSync(path.join(ROOT, "tests/gen-voldesk-fixtures.py"))).digest("hex"), "THE GENERATOR IS UNCHANGED since the fixtures were written: run python3 tests/gen-voldesk-fixtures.py and read the diff");
  eq(FX.provenance.specSha256, createHash("sha256").update(fs.readFileSync(path.join(ROOT, "docs/uw-openapi.yaml"))).digest("hex"), "and the spec is the one they were built to");
  eq(FX.provenance.shapesSha256, createHash("sha256").update(fs.readFileSync(path.join(ROOT, "scripts/flows-probe-shapes.json"))).digest("hex"), "and the shape manifest");
  ok(/not feed data/.test(FX.provenance.nature), "the fixtures say they are not feed data");
  eq(FX.fixture, true, "stamped as fixtures");
}

{
  for (const [k, v] of Object.entries(COPY)) {
    const words = v.replace(/\{[a-z]+\}/g, "x").split(/\s+/).filter(Boolean).length;
    ok(words <= 14, `${k}: at most 14 words (${words})`);
    ok(!/\b(tape|vendor|unusual whales|will|should|expect|likely|forecast|predict)\b/i.test(v), `${k}: no forbidden word`);
    ok(!/\bUW\b/.test(v), `${k}: no provider name`);
  }
  eq(say("ivrv.line", { iv: "14.2%", rv: "11.0%", sign: "+", s: "3.2" }), "Implied 14.2%, realised over 21 sessions 11.0%, spread +3.2 points.", "a sentence fills");
  let threw = false;
  try { say("nope"); } catch { threw = true; }
  ok(threw, "an unknown sentence key is refused");
}

{
  const seen = new Set();
  const rows = proxied(clone(FX.stance), seen);
  V.stanceExtract({ data: rows }, "SYX101", SESSION);
  const allowed = new Set(opById("option-stance").reads);
  eq([...seen].filter((k) => !allowed.has(k)).join(","), "", "the stance extract reads only the registry's fields");
  eq([...seen].filter((k) => V.NEVER_READ.stance.includes(k)).length, 0, "and none of the withheld ones");
}

{
  const scan = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
  const served = fs.readdirSync(path.join(ROOT, "assets/js")).filter((f) => /\.js$/.test(f)).map((f) => "assets/js/" + f).concat(["shared/flows-pages.js", "server/routes/flows-voldesk.js"]);
  for (const f of served) {
    const text = scan(f);
    ok(!text.includes("voldesk-stance"), `${f}: never names the stance store`);
    ok(!/fit_score/.test(text), `${f}: never reads fit_score`);
    ok(!/["']pop["']|\b(?:row|r|o|x|it|item|opt|rec)\.pop\b(?!\()/.test(text), `${f}: never reads pop`);
  }
}

{
  const chain = [
    { option_symbol: "AAA261218C00100000", open_interest: "12" },
    { option_symbol: "AAA261218P00100000", open_interest: 7 },
    { option_symbol: "junk", open_interest: 1 },
    { option_symbol: "AAA261218P00090000", open_interest: "x" },
  ];
  const c = chainFor(chain, false);
  eq(c.rows.length, 2, "chainFor keeps parseable rows with an integer open interest");
  eq(c.rows[0].type, "C", "and reads the type from the symbol");
  eq(chainFor(null, false), null, "no rows, no chain");
  const plan = rotate({ names: ["A", "B", "C", "D"], priorSession: (t) => ({ A: "2026-10-20", B: null, C: "2026-10-10", D: null })[t], liquidity: (t) => ({ B: 1, D: 2 })[t] || 0, cap: 3 });
  same(plan.rotating, ["D", "B", "C"], "never-audited names first by liquidity, then the oldest audit");
  same(plan.fixed, [...V.FUND_TICKERS], "the four funds every night");
  same(rotate({ names: ["A"], cap: 0 }).rotating, [], "a cap of zero rotates nobody");
}

{
  const cards = new Map();
  const fakeCard = clone(FX.worlds.agree.input.card);
  cards.set("SYX101", fakeCard);
  const chain = FX.worlds.agree.input.chain.rows.map((r) => ({ ...r, symbol: "SYX101X" + r.expiry + r.type + r.K }));
  const vendor = makeVoldeskFake({ sessionDate: SESSION, cardOf: (t) => cards.get(t) || null, chainOf: () => ({ rows: chain, truncated: false }) });
  const run = await runVolAudit({
    uw: vendor, session: SESSION, now: "2026-10-23T21:45:00Z", funds: [], names: ["SYX101"], cardOf: (t) => cards.get(t) || null,
    chainOf: () => ({ rows: chain, truncated: false }), cap: 5,
  });
  eq(run.vas.size, 1, "the leg audits a name through the fake");
  eq(run.calls, 8, "in eight calls");
  eq(run.vas.get("SYX101").v, "agree", "and the fake feed agrees with the engine");
  ok(run.stance.get("SYX101").rows.length > 0, "the stance rows are kept for the ring");
  const desk = await runVolDesk({ uw: vendor, session: SESSION, shapes: SHAPES_REAL });
  eq(desk.calls, 17, "seventeen market calls");
  eq(desk.futures.status, "unshaped", "the futures table is unshaped with the real manifest");
  same(desk.chars.map((c) => c.status), ["unshaped", "unshaped"], "so is the character table");
  eq(desk.matrix["3M"].cells.length, 105, "the matrix is assembled");
  for (const t of V.FUND_TICKERS) ok(["ok", "partial"].includes(desk.term[t].status), `${t}: a term structure`);
  eq(desk.term.DIA.points.length, 5, "DIA stops at 90 days, so five points");
  eq(desk.term.DIA.state, "flat", "and its state is still read, inside the last point");
  eq(desk.term.QQQ.state, "backwardation", "QQQ is inverted in the fake");
  clearTaint();
  const calls = vendor.calls.length;
  ok(calls >= 25, `the fake counted ${calls} calls`);
  const cap = await runVolAudit({ uw: vendor, session: SESSION, now: "x", funds: [], names: ["SYX101"], cardOf: () => null, chainOf: () => null, cap: 5 });
  eq(cap.vas.size, 0, "a name without an engine is skipped and counted");
  eq(cap.skipped.engine, 1, "as engine");
  eq(CALL_COST.voldesk, V.marketCalls(V.VOLAUDIT_CAP).max, "CALL_COST.voldesk follows from the audit shape");
}

{
  const emit = nightlyEmit();
  const dv = emitRead(emit, "voldesk");
  ok(dv && dv.fixture === true, "the dry-run emit carries a voldesk payload, stamped as a fixture");
  eq(dv.v, 1, "version 1");
  same(Object.keys(dv.term.funds), [...V.FUND_TICKERS], "four funds");
  eq(dv.term.futures.status, "unshaped", "futures honestly unshaped");
  eq(dv.character.status, "unshaped", "character honestly unshaped");
  eq(dv.matrix["3M"].cells.length, 105, "a full matrix");
  ok(dv.audit.names > 0 && dv.audit.compared > 0, "the audit ran");
  const st = emitRead(emit, "voldesk-stance");
  ok(st && Array.isArray(st.ring) && st.ring.length === 1, "the stance ring holds tonight");
  ok(JSON.stringify(dv).length <= V.VOLDESK_CAP, "within its cap");
  ok(JSON.stringify(st).length <= V.STANCE_CAP, "stance within its cap");
  const withVa = fs.readdirSync(emit).filter((f) => f.startsWith("-card-x-")).map((f) => JSON.parse(fs.readFileSync(path.join(emit, f), "utf8"))).filter((c) => c.va);
  ok(withVa.length > 0, "an audited name's card-x carries a va section");
  ok(withVa.every((c) => c.va.rows.length === 9 && JSON.stringify(c.va).length <= V.VA_CAP), "each with nine rows, within 2 KiB");
  ok(withVa.every((c) => c.va.session === SESSION_DRY), "and tonight's session");
  const meta = emitRead(emit, "meta");
  ok(meta.volaudit && meta.volaudit.names === dv.audit.names, "meta.volaudit carries the summary");
  ok(meta.stages.some((s) => s.id === "vol-audit") && meta.stages.some((s) => s.id === "voldesk"), "both stages are recorded");

  const off = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "wp3-off-"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", off + path.sep], {
      cwd: ROOT, env: { ...process.env, FLOWS_DRY_NOW: "2026-08-24T21:45:00Z", FLOWS_VOLDESK_BUILD: "off" }, stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
    ok(!fs.existsSync(path.join(off, "-voldesk.json")) && !fs.existsSync(path.join(off, "-voldesk-stance.json")), "SWITCH OFF: neither payload is written");
    const files = fs.readdirSync(emit).filter((f) => f !== ".emit-complete");
    let same_ = 0;
    for (const f of files) {
      if (/^-voldesk/.test(f) || f === "-meta.json") continue;
      const a = JSON.parse(fs.readFileSync(path.join(emit, f), "utf8"));
      const b = JSON.parse(fs.readFileSync(path.join(off, f), "utf8"));
      if (/^-card-x-/.test(f)) { delete a.va; delete a.bytes; delete b.bytes; if (a.shed) a.shed = a.shed.filter((x) => x !== "va.soft"); }
      assert.deepEqual(a, b, `${f}: identical with the build off`);
      same_++;
    }
    ok(same_ > 100, `SWITCH OFF: ${same_} payloads equal the on run apart from the va section`);
    const m = JSON.parse(fs.readFileSync(path.join(off, "-meta.json"), "utf8"));
    ok(!m.volaudit, "meta carries no volaudit");
    ok(m.stages.filter((s) => /vol-audit|voldesk/.test(s.id)).every((s) => s.status === "skipped"), "both stages are skipped");
  } finally {
    fs.rmSync(off, { recursive: true, force: true });
  }
}

console.log(`flows-voldesk: ${checks} assertions`);
