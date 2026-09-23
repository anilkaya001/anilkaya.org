import { black76, impliedVolB76, bsmGreeks, forwardOf, parityForward, touchProbability } from "./flows-quant-bs.js";
import { asSlice, sliceVolK, sliceTotalVariance, sliceSkewSlope, prepareQuotes, fitSlice, skewMetrics } from "./flows-quant-smile.js";
import {
  lawFromSlice, lawLognormal, lawBinned, lawPdf, lawHinge, lawMean, lawQuantile, lawProb,
  interpolateBinned, overlayJumps, driftNeutralBinned, binnedFromLognormal, gaussLegendre,
} from "./flows-quant-density.js";
import {
  STRUCTURE_BY_ID, DELTA_TARGETS, BUCKET_LINES, scoreFamilies, eventBucket, eventAffinity, eventVeto, listedStrikes,
  buildLegs, legGate, liquidityTier, forwardDeltaOnSlice, statePreference,
} from "./flows-quant-structures.js";
import { yearFraction, sessionsBetween, calendarDays, isMonthly, etDayOf } from "./flows-quant-time.js";

export const ENGINE_VERSION = "q1";
export const LOT = 100;
export const ENGINE_LINES = Object.freeze({
  FILL_SHARE: 0.25, SLIPPAGE_BUDGET: 0.2, CURVE_POINTS: 81, MULTI_GRID: 401, VAR_LEVEL: 0.05, VAR_POINTS: 400,
  GRID_Z: Object.freeze([-2, -1, -0.5, 0, 0.5, 1, 2]), GRID_VOL: Object.freeze([-0.05, 0, 0.05]),
  UNDEFINED_CAP: 2, STALE_CAP: 1, TOP_IDEAS: 3, RATE_FALLBACK: 0.04, REG_T_BASE: 0.2, REG_T_FLOOR: 0.1,
  EDGE_COST_MULTIPLE: 2, FIT_CLEAN_IN_SPREAD: 0.8, FIT_FAIR_IN_SPREAD: 0.6, FIT_RMSE_PTS: 1, EVENT_MODE_MAX_DTE: 60,
  FWD_CAL_TOL: 1e-11, FWD_CAL_STEP: 0.01,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const EPS = 1e-12;

export function normaliseLeg(l) {
  const side = l.side === "short" || l.side === -1 ? -1 : 1;
  return { ...l, type: l.type === "S" ? "S" : l.type === "P" ? "P" : "C", side, qty: fin(l.qty) && l.qty > 0 ? l.qty : 1 };
}

export function legPayoff(l, x) {
  if (l.type === "S") return x;
  return l.type === "C" ? Math.max(0, x - l.K) : Math.max(0, l.K - x);
}

export function payoffValue(legs, x) {
  let v = 0;
  for (const l of legs) v += l.side * l.qty * legPayoff(l, x);
  return v;
}

export function payoffPieces(legs) {
  let A = 0, B = 0;
  const h = new Map();
  for (const l of legs) {
    const q = l.side * l.qty;
    if (l.type === "S") { B += q; continue; }
    h.set(l.K, (h.get(l.K) || 0) + q);
    if (l.type === "P") { A += q * l.K; B -= q; }
  }
  const knots = [...h.keys()].sort((a, b) => a - b);
  const hinges = knots.map((k) => h.get(k));
  return { A, B, knots, hinges, slopeRight: B + hinges.reduce((s, v) => s + v, 0) };
}

function levelIntervals(pts, vals, level, slopeRight, tol) {
  const out = [];
  const at = (i) => Math.abs(vals[i] - level) <= tol;
  for (let i = 0; i < pts.length; i++) {
    if (!at(i)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === pts[i - 1] && i > 0 && at(i - 1)) last[1] = pts[i];
    else out.push([pts[i], pts[i]]);
  }
  const n = pts.length - 1;
  if (at(n) && Math.abs(slopeRight) <= EPS) {
    const last = out[out.length - 1];
    if (last && last[1] === pts[n]) last[1] = null;
  }
  return out;
}

export function expiryProfile(legs, cost) {
  const pieces = payoffPieces(legs);
  const pl = (x) => payoffValue(legs, x) - cost;
  const pts = [0, ...pieces.knots.filter((k) => k > 0)];
  const vals = pts.map(pl);
  const sR = pieces.slopeRight;
  const scale = Math.max(1, ...pts.map(Math.abs));
  const tol = 1e-9 * scale;
  const profitUnbounded = sR > EPS, lossUnbounded = sR < -EPS;
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const maxProfit = profitUnbounded ? null : hi;
  const maxLoss = lossUnbounded ? null : lo;
  const maxProfitAt = maxProfit === null ? [] : levelIntervals(pts, vals, hi, sR, tol);
  const maxLossAt = maxLoss === null ? [] : levelIntervals(pts, vals, lo, sR, tol);
  const roots = [];
  const n = pts.length;
  for (let i = 0; i + 1 < n; i++) {
    const a = vals[i], b = vals[i + 1];
    if ((a < -tol && b > tol) || (a > tol && b < -tol)) roots.push(pts[i] + (0 - a) * (pts[i + 1] - pts[i]) / (b - a));
  }
  for (let i = 1; i < n; i++) {
    if (Math.abs(vals[i]) > tol) continue;
    const left = vals[i - 1];
    const right = i + 1 < n ? vals[i + 1] : vals[i] + sR;
    if ((left < -tol && right > tol) || (left > tol && right < -tol)) roots.push(pts[i]);
  }
  const lastV = vals[n - 1];
  if ((lastV < -tol && sR > EPS) || (lastV > tol && sR < -EPS)) roots.push(pts[n - 1] - lastV / sR);
  roots.sort((a, b) => a - b);
  const breakevens = [];
  for (const r of roots) if (!breakevens.length || Math.abs(r - breakevens[breakevens.length - 1]) > tol) breakevens.push(r);
  const bounds = [0, ...breakevens, Infinity];
  const profitIntervals = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const probe = b === Infinity ? a + Math.max(1, a) : (a + b) / 2;
    if (pl(probe) > tol) {
      const last = profitIntervals[profitIntervals.length - 1];
      if (last && last[1] === a) last[1] = b === Infinity ? null : b;
      else profitIntervals.push([a, b === Infinity ? null : b]);
    }
  }
  return {
    pieces, maxProfit, maxLoss, maxProfitAt, maxLossAt, breakevens, profitIntervals, profitUnbounded, lossUnbounded,
    slopeRight: sR, valueAtZero: vals[0], valueRight: lastV,
  };
}

export function lawExpect(law, pieces) {
  let v = pieces.A + pieces.B * lawMean(law);
  for (let i = 0; i < pieces.knots.length; i++) v += pieces.hinges[i] * lawHinge(law, pieces.knots[i]);
  return v;
}

export function lawIntervalsProb(law, intervals) {
  let p = 0;
  for (const [a, b] of intervals) if (b === null || b > a) p += lawProb(law, a, b);
  return p;
}

export function lawIntegrate(law, fn, breaks = []) {
  const { x: gx, w: gw } = gaussLegendre(16);
  if (law.kind === "binned") {
    let s = 0;
    for (const sh of law.shapes) {
      if (sh.mode === "pareto" || sh.mode === "pow") {
        let t = 0;
        for (let i = 0; i < 16; i++) {
          const v = (gx[i] + 1) / 2;
          const x = sh.mode === "pow" ? sh.b * Math.pow(v, 1 / sh.lambda) : sh.a * Math.pow(1 - v, -1 / sh.lambda);
          t += gw[i] / 2 * fn(x);
        }
        s += t;
        continue;
      }
      if (sh.mode === "pt") { s += fn(sh.e); continue; }
      let t = 0;
      for (let i = 0; i < 16; i++) {
        const x = sh.c + gx[i] * sh.w / 2;
        t += gw[i] * sh.w / 2 * fn(x) * (1 + sh.beta * (x - sh.c)) / sh.w;
      }
      if (sh.mode === "tri") t = (1 - sh.theta) * t + sh.theta * fn(sh.e);
      s += t;
    }
    return s * law.p;
  }
  const { xs, ws } = lawNodes(law, breaks);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += ws[i] * fn(xs[i]);
  return s;
}

export function lawNodes(law, breaks = []) {
  const { x: gx, w: gw } = gaussLegendre(16);
  const lo = Math.log(lawQuantile(law, 1e-10)), hi = Math.log(lawQuantile(law, 1 - 1e-10));
  const cuts = [lo, ...breaks.filter((b) => b > 0).map(Math.log).filter((v) => v > lo && v < hi), hi].sort((a, b) => a - b);
  const xs = [], ws = [];
  for (let j = 0; j + 1 < cuts.length; j++) {
    const a = cuts[j], b = cuts[j + 1];
    const panels = Math.max(1, Math.ceil((b - a) / ((hi - lo) / 24)));
    const h = (b - a) / panels;
    for (let p = 0; p < panels; p++) {
      const c = a + (p + 0.5) * h;
      for (let i = 0; i < 16; i++) {
        const x = Math.exp(c + gx[i] * h / 2);
        xs.push(x); ws.push(gw[i] * h / 2 * lawPdf(law, x) * x);
      }
    }
  }
  return { xs, ws };
}

export function structureValue(legs, ctx, x, t, shift) {
  let v = 0;
  const r = ctx.r, qc = ctx.q, dv = shift || 0;
  for (const l of legs) {
    const qty = l.side * l.qty;
    if (l.type === "S") { v += qty * x; continue; }
    const tau = l.T - t;
    if (!(tau > 1e-10)) { v += qty * legPayoff(l, x); continue; }
    const own = ctx.sliceOf(l);
    const perLeg = ctx.spot > 0 && own && own.F > 0 && own.D > 0 && own.T > 0;
    const carry = perLeg ? Math.log(own.F / ctx.spot) / own.T : r - qc, rl = perLeg ? -Math.log(own.D) / own.T : r;
    const F = x * Math.exp(carry * tau);
    const k = Math.log(l.K / F);
    const wOwn = sliceTotalVariance(own, k);
    let wRem;
    if (t <= 0) wRem = wOwn;
    else if (ctx.frontSlice && ctx.frontT < l.T - 1e-12) wRem = wOwn - sliceTotalVariance(ctx.frontSlice, k) * Math.min(1, t / ctx.frontT);
    else wRem = wOwn * (1 - t / l.T);
    const fwd = t > 0 && fin(l.fwdShift) && ctx.frontT > 0 && ctx.frontT < l.T - 1e-12 ? l.fwdShift * Math.min(1, t / ctx.frontT) : 0;
    const sigma = Math.max(0, Math.sqrt(Math.max(0, wRem) / tau) + dv + fwd);
    v += qty * black76(F, Math.exp(-rl * tau), l.K, sigma, tau, l.type);
  }
  return v;
}

export function calibrateBackLegs(legs, ctx, qLaw, S) {
  const frontT = ctx.frontT, D1 = ctx.frontSlice ? ctx.frontSlice.D : 1;
  return legs.map((l) => {
    if (l.type === "S" || !(l.T > frontT + 1e-12)) return l;
    const one = { ...l, side: 1, qty: 1, fwdShift: 0 };
    const target = structureValue([one], ctx, S, 0, 0) / D1;
    const { xs, ws } = lawNodes(qLaw, [l.K]);
    const gap = (d) => {
      const leg = [{ ...one, fwdShift: d }];
      let e = 0;
      for (let i = 0; i < xs.length; i++) e += ws[i] * structureValue(leg, ctx, xs[i], frontT, 0);
      return e - target;
    };
    const tol = ENGINE_LINES.FWD_CAL_TOL * S;
    let a = 0, fa = gap(0);
    if (!fin(fa) || Math.abs(fa) <= tol) return { ...l, fwdShift: 0 };
    let b = fa > 0 ? -ENGINE_LINES.FWD_CAL_STEP : ENGINE_LINES.FWD_CAL_STEP, fb = gap(b);
    for (let g = 0; g < 8 && fin(fb) && Math.sign(fb) === Math.sign(fa); g++) { a = b; fa = fb; b *= 2; fb = gap(b); }
    if (!fin(fb) || Math.sign(fb) === Math.sign(fa)) return { ...l, fwdShift: 0, fwdShiftFailed: true };
    let d = b, fd = fb;
    for (let it = 0; it < 40 && Math.abs(fd) > tol; it++) {
      let m = b - fb * (b - a) / (fb - fa);
      if (!(m > Math.min(a, b) && m < Math.max(a, b))) m = (a + b) / 2;
      const fm = gap(m);
      if (Math.sign(fm) === Math.sign(fa)) { a = m; fa = fm; } else { b = m; fb = fm; }
      d = m; fd = fm;
    }
    return { ...l, fwdShift: d };
  });
}

function multiProfile(legs, ctx, cost, law) {
  const frontT = ctx.frontT;
  const lo = lawQuantile(law, 1e-6), hi = lawQuantile(law, 1 - 1e-6);
  const N = ENGINE_LINES.MULTI_GRID;
  const xs = [];
  for (let i = 0; i < N; i++) xs.push(lo * Math.pow(hi / lo, i / (N - 1)));
  for (const l of legs) if (l.type !== "S" && l.K > lo && l.K < hi) xs.push(l.K);
  xs.sort((a, b) => a - b);
  const V = (x) => structureValue(legs, ctx, x, frontT, 0) - cost;
  const vals = xs.map(V);
  let iMax = 0, iMin = 0;
  for (let i = 1; i < xs.length; i++) { if (vals[i] > vals[iMax]) iMax = i; if (vals[i] < vals[iMin]) iMin = i; }
  let maxP = vals[iMax], maxAt = xs[iMax];
  if (iMax > 0 && iMax < xs.length - 1 && !legs.some((l) => l.K === xs[iMax])) {
    let a = xs[iMax - 1], b = xs[iMax + 1];
    const g = (Math.sqrt(5) - 1) / 2;
    let c = b - g * (b - a), d = a + g * (b - a), fc = V(c), fd = V(d);
    for (let it = 0; it < 100 && b - a > 1e-10 * b; it++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = V(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = V(d); }
    }
    const m = (a + b) / 2, fm = V(m);
    if (fm > maxP) { maxP = fm; maxAt = m; }
  }
  const roots = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = vals[i], b = vals[i + 1];
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      let u = xs[i], w = xs[i + 1], fu = a;
      for (let it = 0; it < 80 && w - u > 1e-12 * w; it++) {
        const m = (u + w) / 2, fm = V(m);
        if ((fm < 0) === (fu < 0)) { u = m; fu = fm; } else w = m;
      }
      roots.push((u + w) / 2);
    }
  }
  const bounds = [0, ...roots, Infinity];
  const profitIntervals = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1];
    const probe = b === Infinity ? Math.max(a * 1.01, hi) : a === 0 ? Math.min(b * 0.99, lo) : (a + b) / 2;
    if (V(probe) > 0) profitIntervals.push([a, b === Infinity ? null : b]);
  }
  return {
    maxProfit: maxP, maxLoss: vals[iMin], maxProfitAt: [[maxAt, maxAt]], maxLossAt: [[xs[iMin], xs[iMin]]], breakevens: roots,
    profitIntervals, profitUnbounded: false, lossUnbounded: false, V,
  };
}

function sliceForT(input, T, S, r, q) {
  const F = fin(input.F) && !fin(input.S) ? input.F : forwardOf(S, r, q, T);
  const D = Math.exp(-r * T);
  if (input.svi) return { method: "svi", T, F, D, params: input.svi };
  if (fin(input.flatVol)) return { method: "flat", T, F, D, params: { sigma: input.flatVol } };
  return null;
}

export function structureMetrics(input) {
  const r = fin(input.r) ? input.r : 0, q = fin(input.q) ? input.q : 0;
  const S = fin(input.S) ? input.S : input.F;
  const legs = input.legs.map(normaliseLeg).map((l) => ({ ...l, T: fin(l.T) ? l.T : input.T }));
  const Ts = [...new Set(legs.filter((l) => l.type !== "S" && fin(l.T)).map((l) => l.T))].sort((a, b) => a - b);
  const slices = new Map();
  for (const T of Ts) { const s = sliceForT(input, T, S, r, q); if (s) slices.set(T, s); }
  const sliceOf = (l) => slices.get(l.T);
  const priced = legs.map((l) => {
    if (l.type === "S") return { ...l, price: fin(l.price) ? l.price : S };
    if (input.priceAt === "given" || fin(l.price)) return l;
    const s = sliceOf(l);
    const vol = sliceVolK(s, Math.log(l.K / s.F));
    return { ...l, price: black76(s.F, s.D, l.K, vol, l.T, l.type) };
  });
  const cost = priced.reduce((acc, l) => acc + l.side * l.qty * l.price, 0);
  const out = {
    netPerShare: cost, netValuePerShare: cost,
    creditPerShare: cost < 0 ? -cost : 0, debitPerShare: cost > 0 ? cost : 0,
    netCredit: cost < 0 ? -cost * LOT : 0, netDebit: cost > 0 ? cost * LOT : 0,
    legPrices: priced.map((l) => l.price),
  };
  const multi = Ts.length > 1;
  const frontT = Ts[0];
  const frontSlice = slices.get(frontT) || null;
  const qLaw = frontSlice ? lawFromSlice(frontSlice) : null;
  const D = frontSlice ? frontSlice.D : 1;
  let pLaw = null;
  if (input.realWorld && frontSlice) {
    const rw = input.realWorld;
    if (rw.kind === "lognormal") pLaw = lawLognormal({ F: rw.driftNeutral === false ? S : frontSlice.F, sigma: rw.vol, T: frontT });
    else if (rw.kind === "binned") pLaw = lawBinned({ S, edges: rw.edges, means: rw.means });
  }
  if (!multi) {
    const prof = expiryProfile(priced, cost);
    Object.assign(out, {
      maxProfit: prof.maxProfit === null ? null : prof.maxProfit * LOT,
      maxLoss: prof.maxLoss === null ? null : prof.maxLoss * LOT,
      maxProfitAt: prof.maxProfitAt, maxLossAt: prof.maxLossAt, breakevens: prof.breakevens,
      profitUnbounded: prof.profitUnbounded, lossUnbounded: prof.lossUnbounded,
      upsideAtInfinity: Math.abs(prof.slopeRight) <= EPS ? prof.valueRight * LOT : prof.slopeRight > 0 ? Infinity : -Infinity,
      upsideRisk: prof.slopeRight < -EPS || (Math.abs(prof.slopeRight) <= EPS && prof.valueRight < 0),
      riskReward: prof.maxProfit !== null && prof.maxLoss !== null && prof.maxLoss < 0 ? prof.maxProfit / -prof.maxLoss : null,
      profitIntervals: prof.profitIntervals,
    });
    if (qLaw) {
      const eq = lawExpect(qLaw, prof.pieces);
      Object.assign(out, {
        discountedExpectedPayoff: D * eq, evQ: (D * eq - cost) * LOT,
        popQ: lawIntervalsProb(qLaw, prof.profitIntervals),
        probMaxProfitQ: lawIntervalsProb(qLaw, prof.maxProfitAt),
        probMaxLossQ: lawIntervalsProb(qLaw, prof.maxLossAt),
      });
    }
    if (pLaw) {
      const ep = lawExpect(pLaw, prof.pieces);
      Object.assign(out, {
        evP: (D * ep - cost) * LOT, edge: (D * (ep - lawExpect(qLaw, prof.pieces))) * LOT,
        popP: lawIntervalsProb(pLaw, prof.profitIntervals),
        probMaxProfitP: lawIntervalsProb(pLaw, prof.maxProfitAt),
      });
    }
    return out;
  }
  const ctx = { sliceOf, frontT, frontSlice, r, q, spot: S };
  const calibrated = qLaw ? calibrateBackLegs(priced, ctx, qLaw, S) : priced;
  priced.splice(0, priced.length, ...calibrated);
  const prof = multiProfile(priced, ctx, cost, qLaw);
  const strikeK = priced.find((l) => l.type !== "S").K;
  Object.assign(out, {
    valueAtStrikePerShare: structureValue(priced, ctx, strikeK, frontT, 0),
    maxProfitPerShare: prof.maxProfit, maxLossPerShare: prof.maxLoss,
    maxProfit: prof.maxProfit * LOT, maxLoss: prof.maxLoss * LOT, maxProfitAt: prof.maxProfitAt, maxLossAt: prof.maxLossAt,
    breakevens: prof.breakevens, profitIntervals: prof.profitIntervals, profitUnbounded: false, lossUnbounded: false,
  });
  if (qLaw) {
    const eq = lawIntegrate(qLaw, (x) => structureValue(priced, ctx, x, frontT, 0), priced.map((l) => l.K));
    Object.assign(out, { discountedExpectedPayoff: D * eq, evQ: (D * eq - cost) * LOT, popQ: lawIntervalsProb(qLaw, prof.profitIntervals) });
  }
  return out;
}

function roundTo(v, dp) {
  if (v === null || v === undefined) return null;
  if (!fin(v)) return null;
  const f = Math.pow(10, dp);
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

const rp = (v) => roundTo(v, 4), r$ = (v) => roundTo(v, 2), rpr = (v) => roundTo(v, 4), rv = (v) => roundTo(v, 4);
const rIntervals = (xs) => xs.map(([a, b]) => [rp(a), b === null ? null : rp(b)]);

export function fitGrade(slice, dependsOnWings) {
  if (!slice) return { g: 0, why: "fit.none" };
  const fis = slice.fitInSpread, rmse = slice.rmseIvPts;
  if (slice.method === "flat") return dependsOnWings ? { g: 1, why: "fit.flat" } : { g: 2, why: "fit.flat" };
  if (slice.method === "svi") {
    if ((fis === null || fis >= ENGINE_LINES.FIT_CLEAN_IN_SPREAD) && (rmse === null || rmse <= ENGINE_LINES.FIT_RMSE_PTS) && !slice.why) return { g: 3, why: null };
    if (fis !== null && fis >= ENGINE_LINES.FIT_FAIR_IN_SPREAD && !slice.why) return { g: 2, why: "fit.in-spread" };
    return { g: 1, why: slice.why || "fit.out-of-spread" };
  }
  if (fis !== null && fis !== undefined && fis < ENGINE_LINES.FIT_FAIR_IN_SPREAD) return { g: 1, why: "fit.out-of-spread" };
  return { g: 2, why: "fit." + (slice.method === "svi-repaired" ? "repaired" : slice.method) };
}

export function edgeGrade(evs, costGap) {
  const xs = evs.filter((e) => e && fin(e.edge));
  if (!xs.length) return { g: 0, why: "edge.none" };
  const signs = new Set(xs.map((e) => Math.sign(e.edge)));
  if (signs.size > 1) return { g: 1, why: "edge.sign-flips" };
  const main = xs[0];
  if (fin(main.evP) && Math.abs(main.evP) >= ENGINE_LINES.EDGE_COST_MULTIPLE * costGap) return { g: 3, why: null };
  return { g: 2, why: "edge.small" };
}

export function eventGrade(ev, sliceMethod, moves) {
  if (!ev || !ev.inside) return { g: 3, why: null };
  if (moves >= 6 && sliceMethod === "mixture") return { g: 3, why: null };
  if (moves >= 3) return { g: 2, why: "event.few-moves" };
  return { g: 1, why: "event.q-equals-p" };
}

export function combineGrade(parts, caps) {
  let g = Math.min(...Object.values(parts).map((p) => p.g));
  const why = Object.keys(parts).sort().map((k) => parts[k].why).filter(Boolean);
  if (caps.undefinedRisk && g > ENGINE_LINES.UNDEFINED_CAP) { g = ENGINE_LINES.UNDEFINED_CAP; why.push("risk.undefined"); }
  if (caps.stale && g > ENGINE_LINES.STALE_CAP) { g = ENGINE_LINES.STALE_CAP; why.push("card.stale"); }
  return { grade: g, gradeParts: Object.fromEntries(Object.keys(parts).sort().map((k) => [k, parts[k].g])), gradeWhy: [...new Set(why)] };
}

function regTCapital(legs, S, costPerShare) {
  const naked = { C: 0, P: 0 };
  const netQty = (type) => legs.filter((l) => l.type === type).reduce((s, l) => s + l.side * l.qty, 0);
  const stock = legs.filter((l) => l.type === "S").reduce((s, l) => s + l.side * l.qty, 0);
  naked.C = Math.max(0, -(netQty("C") + stock));
  naked.P = Math.max(0, -netQty("P"));
  const req = (type) => {
    if (!naked[type]) return 0;
    const shorts = legs.filter((l) => l.type === type && l.side < 0).map((l) => l.K);
    const K = type === "C" ? Math.min(...shorts) : Math.max(...shorts);
    const otm = type === "C" ? Math.max(0, K - S) : Math.max(0, S - K);
    return naked[type] * Math.max(ENGINE_LINES.REG_T_BASE * S - otm, ENGINE_LINES.REG_T_FLOOR * (type === "P" ? K : S)) * LOT;
  };
  return Math.max(req("C"), req("P")) + Math.abs(costPerShare) * LOT;
}

function capitalOf(family, prof, legs, S, cost) {
  if (family.risk === "stock") {
    if (prof.maxLoss !== null) return { kind: "stock", value: -prof.maxLoss * LOT };
    return { kind: "stock", value: cost * LOT };
  }
  if (family.risk === "undefined" || prof.maxLoss === null) return { kind: "reg-t", value: regTCapital(legs, S, cost) };
  return { kind: "defined", value: -prof.maxLoss * LOT };
}

function quantileTable(law, n) {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lawQuantile(law, (i + 0.5) / n);
  return xs;
}

function tailRisk(qtab, legs, cost) {
  const n = qtab.length;
  const pls = new Float64Array(n);
  for (let i = 0; i < n; i++) pls[i] = (payoffValue(legs, qtab[i]) - cost) * LOT;
  pls.sort();
  const m = Math.max(1, Math.round(ENGINE_LINES.VAR_LEVEL * n));
  let s = 0;
  for (let i = 0; i < m; i++) s += pls[i];
  return { var5P: pls[m - 1], cvar5P: s / m };
}

function legDollarGreeks(l, S, r, qc, sigma) {
  if (l.type === "S") { const d = l.side * l.qty * LOT * S; return { delta$: d, gamma$1pct: 0, vegaPt: 0, thetaDay: 0, vannaPt$: 0, charmDay$: 0, deltaAdj$: d }; }
  const g = bsmGreeks({ S, K: l.K, r, q: qc, sigma, T: l.T, type: l.type });
  if (!g) return null;
  const m = l.side * l.qty * LOT;
  return {
    delta$: m * g.delta * S, gamma$1pct: m * g.gamma * S * S * 0.01, vegaPt: m * g.vega * 0.01,
    thetaDay: m * g.theta / 365, vannaPt$: m * g.vanna * 0.01 * S, charmDay$: m * g.charm * S / 365,
    deltaAdj$: m * (g.delta + g.vega * l.dSigmaDS) * S,
  };
}

function lawsFor(ctx, T, sessions, expiry, F, S) {
  const p = ctx.pLaw;
  if (!p) return { main: null, alts: [], grade: 0, why: "model.none" };
  const fwd = F / S;
  const h = Math.max(1, sessions);
  const sdOf = (x) => (p.params && fin(p.params.sigma2Next) ? aggregatedSdLocal(p.params, x) : Math.sqrt(x));
  let bins = null;
  if (Array.isArray(p.knots) && p.knots.length) {
    const ks = p.knots.slice().sort((a, b) => a.h - b.h);
    let lower = ks[0], upper = ks[ks.length - 1];
    for (const k of ks) { if (k.h <= h) lower = k; if (k.h >= h && upper.h >= k.h) upper = k; }
    if (h <= ks[0].h) { lower = ks[0]; upper = ks[0]; }
    if (h >= ks[ks.length - 1].h) { lower = ks[ks.length - 1]; upper = lower; }
    if (lower.h === upper.h) {
      const scale = sdOf(h) / sdOf(lower.h);
      const re = (v) => (v === null ? null : v === 0 ? 0 : Math.exp(Math.log(v) * scale));
      bins = driftNeutralBinned({ edges: lower.edges.map(re), means: lower.means.map(re) }, fwd);
    } else bins = interpolateBinned({ lower, upper, h, sd: sdOf, forwardOverSpot: fwd });
  }
  const ev = ctx.eventFor(expiry);
  const jumps = ev.inside ? ctx.jumps : null;
  const withJumps = (b) => (jumps && jumps.length ? overlayJumps({ bins: b, jumps, forwardOverSpot: fwd }) : b);
  const lnBins = (vol) => binnedFromLognormal({ sigma: vol, T: h / 252, forwardOverSpot: fwd });
  const lognormalOrBinned = (vol) => {
    if (!fin(vol) || !(vol > 0)) return null;
    if (jumps && jumps.length) return lawBinned({ S, ...withJumps(lnBins(vol)) });
    return lawLognormal({ F, sigma: vol, T: h / 252 });
  };
  let main = null;
  if (bins) main = lawBinned({ S, ...withJumps(bins) });
  else if (fin(p.vol)) main = lognormalOrBinned(p.vol);
  const alts = [lognormalOrBinned(p.ewmaVol), lognormalOrBinned(p.coneMedianVol)].filter(Boolean);
  return { main, alts, grade: fin(p.grade) ? p.grade : main ? 1 : 0, why: Array.isArray(p.why) && p.why.length ? p.why[0] : p.model === "ewma" ? "model.ewma" : null };
}

function aggregatedSdLocal(params, h) {
  const persistence = params.alpha + (params.gamma || 0) / 2 + params.beta;
  const longRun = persistence < 1 ? params.omega / (1 - persistence) : params.sigma2Next;
  let avg;
  if (Math.abs(1 - persistence) < 1e-9) avg = params.sigma2Next;
  else avg = longRun + (params.sigma2Next - longRun) * (1 - Math.pow(persistence, h)) / (h * (1 - persistence));
  return Math.sqrt(Math.max(avg, 0) * h);
}

function curveGrid(qLaw, legs, breakevens) {
  const lo = lawQuantile(qLaw, 0.005), hi = lawQuantile(qLaw, 0.995);
  const xs = [];
  const n = ENGINE_LINES.CURVE_POINTS;
  for (let i = 0; i < n; i++) xs.push(lo * Math.pow(hi / lo, i / (n - 1)));
  for (const l of legs) if (l.type !== "S") xs.push(l.K);
  for (const b of breakevens) xs.push(b);
  return [...new Set(xs.map((x) => roundTo(x, 6)))].sort((a, b) => a - b);
}

function priceCandidate(cand, ctx) {
  const fam = cand.fam || STRUCTURE_BY_ID[cand.family];
  const S = ctx.spot;
  const exp = ctx.expiries.get(cand.expiry);
  const legs = cand.legs.map((l) => {
    const e = ctx.expiries.get(l.expiry || cand.expiry);
    const T = e.T;
    if (l.type === "S") return { ...l, T, expiry: e.expiry, bid: S, ask: S, mid: S, model: S, oi: null, vol: null };
    const qt = e.quoteOf(l.type, l.K);
    const k = Math.log(l.K / e.slice.F);
    const iv = sliceVolK(e.slice, k);
    const model = black76(e.slice.F, e.slice.D, l.K, iv, T, l.type);
    const dSigmaDS = -sliceSkewSlope(e.slice, k) / S;
    return {
      ...l, T, expiry: e.expiry, sym: qt ? qt.sym : null, bid: qt ? qt.bid : null, ask: qt ? qt.ask : null,
      mid: qt ? (qt.bid + qt.ask) / 2 : null, model, iv, ivBid: qt ? qt.ivBid : null, ivAsk: qt ? qt.ivAsk : null,
      delta: forwardDeltaOnSlice(e.slice, l.K, l.type), oi: qt ? qt.oi : null, vol: qt ? qt.volume : null,
      spreadRel: qt && qt.bid > 0 ? (qt.ask - qt.bid) / ((qt.bid + qt.ask) / 2) : null, dSigmaDS,
      gate: legGate(qt, l.side),
    };
  });
  if (legs.some((l) => l.type !== "S" && (l.mid === null || !fin(l.model)))) return null;
  const sum = (f) => legs.reduce((s, l) => s + l.side * l.qty * f(l), 0);
  const mid = sum((l) => l.mid);
  const natural = sum((l) => (l.side > 0 ? l.ask : l.bid));
  const fill = mid + ENGINE_LINES.FILL_SHARE * (natural - mid);
  const cost = cand.basis === "mid" ? mid : cand.basis === "natural" ? natural : fill;
  const model = sum((l) => l.model);
  const Ts = [...new Set(legs.filter((l) => l.type !== "S").map((l) => l.T))].sort((a, b) => a - b);
  const multi = Ts.length > 1;
  const front = ctx.expiries.get(legs.filter((l) => l.type !== "S").sort((a, b) => a.T - b.T)[0].expiry);
  const sliceOf = (l) => ctx.expiries.get(l.expiry).slice;
  const vctx = { sliceOf, frontT: front.T, frontSlice: front.slice, r: front.r, q: front.qImpl, spot: S };
  const qLaw = lawFromSlice(front.slice);
  const D = front.slice.D;
  const laws = ctx.lawsOf(front, S);
  if (multi) legs.splice(0, legs.length, ...calibrateBackLegs(legs, vctx, qLaw, S));
  let prof, eQ, ePs;
  if (!multi) {
    prof = expiryProfile(legs, cost);
    if (fam.noUpsideRisk && (prof.lossUnbounded || prof.valueRight < -EPS)) return null;
    eQ = lawExpect(qLaw, prof.pieces);
    ePs = [laws.main, ...laws.alts].map((law) => (law ? lawExpect(law, prof.pieces) : null));
  } else {
    prof = multiProfile(legs, vctx, cost, qLaw);
    const fn = (x) => structureValue(legs, vctx, x, front.T, 0);
    const brk = legs.map((l) => l.K);
    eQ = lawIntegrate(qLaw, fn, brk);
    ePs = [laws.main, ...laws.alts].map((law) => (law ? lawIntegrate(law, fn, brk) : null));
  }
  const evQ = (D * eQ - cost) * LOT;
  const evPs = ePs.map((e) => (e === null ? null : (D * e - cost) * LOT));
  const evP = evPs[0];
  const edges = ePs.map((e) => (e === null ? null : D * (e - eQ) * LOT));
  const pNatural = ePs[0] === null ? null : (D * ePs[0] - natural) * LOT;
  const pBandVals = evPs.filter((v) => v !== null);
  const popQ = lawIntervalsProb(qLaw, prof.profitIntervals);
  const popP = laws.main ? lawIntervalsProb(laws.main, prof.profitIntervals) : null;
  const capital = capitalOf(fam, prof, legs, S, cost);
  const shorts = legs.filter((l) => l.side < 0 && l.type !== "S");
  const touchShortQ = shorts.map((l) => {
    const t = touchProbability({ S, level: l.K, vol: l.iv, T: l.T, r: front.r, q: front.qImpl });
    return t ? t.touch : null;
  });
  const greeks = { delta$: 0, gamma$1pct: 0, vegaPt: 0, thetaDay: 0, vannaPt$: 0, charmDay$: 0, deltaAdj$: 0 };
  for (const l of legs) {
    const e = ctx.expiries.get(l.expiry);
    const g = legDollarGreeks(l, S, e.r, e.qImpl, l.iv);
    if (!g) continue;
    for (const k of Object.keys(greeks)) greeks[k] += fin(g[k]) ? g[k] : 0;
  }
  const gates = legs.filter((l) => l.type !== "S").map((l) => l.gate);
  const slip = Math.abs(natural - mid);
  const budgetBase = fill < 0 ? (prof.maxProfit === null ? Infinity : prof.maxProfit) : fill;
  const overBudget = slip > ENGINE_LINES.SLIPPAGE_BUDGET * Math.abs(budgetBase);
  let liq;
  const failed = gates.find((g) => !g.pass);
  if (failed) liq = { g: 0, why: failed.code };
  else if (overBudget) liq = { g: 1, why: "liq.slippage" };
  else if (gates.every((g) => g.tight)) liq = { g: 3, why: null };
  else liq = { g: 2, why: "liq.not-tight" };
  const dependsOnWings = !(cand.family === "long-straddle");
  const fitG = Math.min(...[...new Set(legs.filter((l) => l.type !== "S").map((l) => l.expiry))]
    .map((ex) => fitGrade(ctx.expiries.get(ex).slice, dependsOnWings).g));
  const fitWhy = [...new Set(legs.filter((l) => l.type !== "S").map((l) => fitGrade(ctx.expiries.get(l.expiry).slice, dependsOnWings).why).filter(Boolean))][0] || null;
  const evB = ctx.eventFor(front.expiry);
  const parts = {
    fit: { g: fitG, why: fitWhy },
    liquidity: liq,
    model: { g: laws.main ? laws.grade : 0, why: laws.main ? laws.why : "model.none" },
    edge: edgeGrade(edges.map((e, i) => ({ edge: e, evP: evPs[i] })).filter((x) => x.edge !== null), Math.abs(natural - fill) * LOT),
    event: eventGrade(evB, front.slice.method, ctx.eventMoves),
  };
  const g = combineGrade(parts, { undefinedRisk: fam.risk === "undefined", stale: !!ctx.stale });
  const out = {
    family: cand.family, risk: fam.risk, dir: cand.dir || fam.dir, expiry: exp.expiry, dte: exp.dte, sessions: exp.sessions, T: rv(exp.T),
    legs: legs.map((l) => ({
      sym: l.sym || null, type: l.type, k: l.type === "S" ? null : l.K, expiry: l.expiry, side: l.side, qty: l.qty,
      bid: rp(l.bid), ask: rp(l.ask), mid: rp(l.mid), model: rp(l.model), iv: l.type === "S" ? null : rv(l.iv),
      ivBid: rv(l.ivBid), ivAsk: rv(l.ivAsk), delta: l.type === "S" ? 1 : rpr(l.delta), oi: fin(l.oi) ? l.oi : null,
      vol: fin(l.vol) ? l.vol : null, spreadRel: rpr(l.spreadRel),
      snapped: (cand.snapped || []).filter((s) => s.K === l.K).map((s) => s.rule)[0] || null,
    })),
    price: { mid: rp(mid), natural: rp(natural), fill: rp(fill), model: rp(model) },
    maxProfit: prof.maxProfit === null ? null : r$(prof.maxProfit * LOT),
    maxLoss: prof.maxLoss === null ? null : r$(prof.maxLoss * LOT),
    profitUnbounded: prof.profitUnbounded, lossUnbounded: prof.lossUnbounded,
    maxProfitAt: rIntervals(prof.maxProfitAt), maxLossAt: rIntervals(prof.maxLossAt),
    breakevens: prof.breakevens.map(rp),
    capital: { kind: capital.kind, value: r$(capital.value) },
    greeks: Object.fromEntries(Object.keys(greeks).map((k) => [k, r$(greeks[k])])),
    prob: {
      popQ: rpr(popQ), popP: rpr(popP),
      pMaxProfitQ: rpr(lawIntervalsProb(qLaw, prof.maxProfitAt)),
      pMaxProfitP: laws.main ? rpr(lawIntervalsProb(laws.main, prof.maxProfitAt)) : null,
      pMaxLossQ: rpr(lawIntervalsProb(qLaw, prof.maxLossAt)),
      pMaxLossP: laws.main ? rpr(lawIntervalsProb(laws.main, prof.maxLossAt)) : null,
      touchShortQ: touchShortQ.map(rpr),
    },
    ev: {
      q: r$(evQ), p: r$(evP), pNatural: r$(pNatural), edge: r$(edges[0]),
      pBand: pBandVals.length ? [r$(Math.min(...pBandVals)), r$(evP), r$(Math.max(...pBandVals))] : null,
    },
    tail: null,
    ...g,
    score: evP !== null && capital.value > 0 ? roundTo(evP / capital.value, 6) : null,
    rules: cand.rules.slice(),
    engine: ENGINE_VERSION,
  };
  return { out, raw: { legs, cost, prof, evQ, evP, laws, qLaw, vctx, front, multi } };
}

export function scenarioGrid(legs, vctx, cost, S, front, levels) {
  const dte = front.dte;
  const days = [0, Math.round(dte / 3), Math.round(2 * dte / 3), dte];
  const atmVol = sliceVolK(front.slice, 0);
  const sd = atmVol * Math.sqrt(dte / 365);
  const spots = ENGINE_LINES.GRID_Z.map((z) => S * Math.exp(z * sd));
  const lo = spots[0], hi = spots[spots.length - 1];
  const extra = [];
  if (levels) for (const key of ["callWall", "putWall", "flip"]) { const v = levels[key]; if (fin(v) && v > lo && v < hi) extra.push(v); }
  const rows = [...spots, ...extra];
  const vols = ENGINE_LINES.GRID_VOL.slice();
  const pnl = rows.map((x) => vols.map((dv) => days.map((d) => {
    const t = Math.min(front.T, d / 365);
    const tt = d >= dte ? front.T : t;
    return r$((structureValue(legs, vctx, x, tt, dv) - cost) * LOT);
  })));
  return { spot: rows.map(rp), vol: vols, days, pnl };
}

function curvesOf(legs, vctx, cost, qLaw, pLaw, prof, front) {
  const xs = curveGrid(qLaw, legs, prof.breakevens);
  const expiry = xs.map((x) => (vctx.frontT && legs.some((l) => l.type !== "S" && l.T > vctx.frontT + 1e-12)
    ? structureValue(legs, vctx, x, front.T, 0) - cost : payoffValue(legs, x) - cost) * LOT);
  const t0 = xs.map((x) => (structureValue(legs, vctx, x, 0, 0) - cost) * LOT);
  const tHalf = xs.map((x) => (structureValue(legs, vctx, x, front.T / 2, 0) - cost) * LOT);
  const scaleMax = (arr) => { const m = Math.max(...arr); return arr.map((v) => (m > 0 ? rpr(v / m) : 0)); };
  return {
    x: xs.map(rp), expiry: expiry.map(r$), t0: t0.map(r$), tHalf: tHalf.map(r$),
    densQ: scaleMax(xs.map((x) => lawPdf(qLaw, x))), densP: pLaw ? scaleMax(xs.map((x) => lawPdf(pLaw, x))) : null,
  };
}

function quoteBook(rows) {
  const m = new Map();
  for (const r of rows) if (r && fin(r.K) && (r.type === "C" || r.type === "P")) m.set(r.type + ":" + r.K, r);
  return (type, K) => m.get(type + ":" + K) || null;
}

function parityInput(rows, S, T) {
  const calls = new Map(), puts = new Map();
  for (const r of rows) {
    if (!r || !fin(r.K) || !fin(r.bid) || !fin(r.ask) || !(r.bid > 0) || !(r.ask >= r.bid)) continue;
    (r.type === "C" ? calls : puts).set(r.K, r);
  }
  const chain = [];
  for (const K of [...calls.keys()].sort((a, b) => a - b)) {
    const c = calls.get(K), p = puts.get(K);
    if (!p) continue;
    chain.push({ K, call: (c.bid + c.ask) / 2, put: (p.bid + p.ask) / 2, spreadCall: c.ask - c.bid, spreadPut: p.ask - p.bid });
  }
  return { S, T, chain };
}

function seedVol(rows, S) {
  let best = null, d = Infinity;
  for (const r of rows) if (fin(r.ivSeed) && r.ivSeed > 0 && Math.abs(r.K - S) < d) { d = Math.abs(r.K - S); best = r.ivSeed; }
  return best === null ? 0.3 : best;
}

export function buildExpiry(input) {
  const { expiry, rows, spot: S, asOfMs, rate, prev } = input;
  const asOfDay = etDayOf(asOfMs);
  const T = yearFraction(asOfMs, expiry);
  if (!(T > 0)) return null;
  const clean = (rows || []).filter((r) => r && fin(r.K) && (r.type === "C" || r.type === "P")).slice()
    .sort((a, b) => a.K - b.K || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  const r0 = fin(rate) ? rate : ENGINE_LINES.RATE_FALLBACK;
  const sigmaSeed = seedVol(clean, S);
  const pin = parityInput(clean, S, T);
  let fwd = parityForward({ ...pin, sigmaSeed, D: Math.exp(-r0 * T) });
  if (!fwd) fwd = { F: forwardOf(S, r0, 0, T), D: Math.exp(-r0 * T), r: r0, q: 0, pairs: 0, method: "rate-only" };
  const q = fwd.q;
  const prepared = prepareQuotes({ F: fwd.F, D: fwd.D, T, rows: clean });
  const slice = fitSlice({ F: fwd.F, D: fwd.D, T, points: prepared.points, prev: prev || null, event: input.event || null });
  if (!slice) return null;
  return expiryFromFit({
    expiry, T, dte: calendarDays(asOfDay, expiry), sessions: sessionsBetween(asOfDay, expiry), monthly: isMonthly(expiry),
    forward: fwd, slice, points: prepared.points, rows: clean,
  });
}

export function expiryFit(e) {
  return {
    expiry: e.expiry, T: e.T, dte: e.dte, sessions: e.sessions, monthly: e.monthly, forward: e.forward, slice: e.slice,
    points: e.points.length,
  };
}

export function expiryFromFit(input) {
  const { expiry, T, forward: fwd, slice } = input;
  const clean = (input.rows || []).filter((r) => r && fin(r.K) && (r.type === "C" || r.type === "P")).slice()
    .sort((a, b) => a.K - b.K || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  const book = quoteBook(clean);
  const quoteCache = new Map();
  return {
    expiry, T, dte: input.dte, sessions: input.sessions, monthly: input.monthly,
    F: fwd.F, D: fwd.D, r: fwd.r, qImpl: fwd.q, forward: fwd, slice,
    points: Array.isArray(input.points) ? input.points : { length: fin(input.points) ? input.points : 0 }, rows: clean,
    callStrikes: listedStrikes(clean, "C"), putStrikes: listedStrikes(clean, "P"),
    quoteOf: (type, K) => {
      const key = type + ":" + K;
      if (quoteCache.has(key)) return quoteCache.get(key);
      const row = book(type, K);
      let q = null;
      if (row) {
        const iv = (price) => (fin(price) && price > 0 ? impliedFromSlice(slice, K, type, price) : null);
        q = { bid: row.bid, ask: row.ask, oi: row.oi, volume: row.volume, sym: row.sym || null, ivBid: iv(row.bid), ivAsk: iv(row.ask) };
      }
      quoteCache.set(key, q);
      return q;
    },
  };
}

function impliedFromSlice(slice, K, type, price) {
  const s = asSlice(slice);
  return impliedVolB76(s.F, s.D, K, s.T, price, type, sliceVolK(s, Math.log(K / s.F)));
}

export function tierOf(expiryCtx) {
  const s = expiryCtx.slice;
  const rels = [];
  for (const r of expiryCtx.rows) {
    if (!fin(r.bid) || !fin(r.ask) || !(r.bid > 0) || !(r.ask >= r.bid)) continue;
    const k = Math.log(r.K / s.F);
    if (r.type === "P" ? k >= 0 : k < 0) continue;
    const d = forwardDeltaOnSlice(s, r.K, "C");
    if (d === null || d < 0.25 || d > 0.75) continue;
    rels.push((r.ask - r.bid) / ((r.bid + r.ask) / 2));
  }
  if (!rels.length) return { tier: null, median: null };
  rels.sort((a, b) => a - b);
  const m = rels.length >> 1;
  const med = rels.length % 2 ? rels[m] : (rels[m - 1] + rels[m]) / 2;
  return { tier: liquidityTier(med), median: med };
}

function chooseExpiry(fam, list, ctx) {
  const ev = ctx.event;
  if (fam.id === "long-calendar" || fam.id === "diagonal") {
    const fronts = list.filter((e) => e.dte >= fam.window.min && e.dte <= fam.window.max);
    for (const f of fronts.sort((a, b) => Math.abs(a.dte - fam.window.target) - Math.abs(b.dte - fam.window.target) || a.T - b.T)) {
      const back = list.filter((e) => (fam.back ? e.dte - f.dte >= fam.back.min && e.dte - f.dte <= fam.back.max
        : e.dte >= fam.backAbs.min && e.dte <= fam.backAbs.max) && e.T > f.T).sort((a, b) => a.T - b.T)[0];
      if (back) return { front: f, back };
    }
    return null;
  }
  if (ctx.eventMode && ev && ev.date && (fam.id === "long-straddle" || fam.id === "long-strangle" || fam.id === "iron-fly")) {
    const after = list.filter((e) => e.expiry > ev.date && e.sessions >= 1 + (ctx.sessionsTo(ev.date) || 0)).sort((a, b) => a.T - b.T)[0];
    if (after && after.dte <= ENGINE_LINES.EVENT_MODE_MAX_DTE) return { front: after, crush: true };
  }
  const inWin = list.filter((e) => e.dte >= fam.window.min && e.dte <= fam.window.max && (!fam.minDte || e.dte >= fam.minDte));
  if (!inWin.length) return null;
  inWin.sort((a, b) => b.points.length - a.points.length || (b.monthly ? 1 : 0) - (a.monthly ? 1 : 0) ||
    Math.abs(a.dte - fam.window.target) - Math.abs(b.dte - fam.window.target) || a.T - b.T);
  return { front: inWin[0] };
}

export function rankStructures(structs, state) {
  const eligible = structs.filter((s) => s.grade >= 1 && fin(s.ev.p) && s.ev.p > 0 && fin(s.score));
  const cmp = (a, b) => b.score - a.score || b.grade - a.grade || (b.prob.popP || 0) - (a.prob.popP || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  eligible.sort(cmp);
  const ideas = [];
  const seen = new Set();
  const pref = (s) => statePreference(state, STRUCTURE_BY_ID[s.family]).preferred;
  const firstPick = eligible.find((s) => s.risk === "defined" && pref(s)) || eligible.find((s) => s.risk === "defined") || null;
  if (firstPick) { ideas.push(firstPick); seen.add(firstPick.family); }
  for (const s of eligible) {
    if (ideas.length >= ENGINE_LINES.TOP_IDEAS) break;
    if (seen.has(s.family)) continue;
    if (!ideas.length && s.risk !== "defined") continue;
    ideas.push(s); seen.add(s.family);
  }
  if (ideas.length) return { ideas: ideas.map((s) => s.id), noTrade: null };
  const all = structs.filter((s) => fin(s.score)).sort(cmp);
  const code = !structs.length ? "candidates.none" : structs.every((s) => !fin(s.ev.p)) ? "model.none"
    : eligible.length ? "risk.undefined-only"
      : structs.some((s) => fin(s.ev.p) && s.ev.p > 0) ? "grade.none" : "ev.none-positive";
  return { ideas: [], noTrade: { code, closest: all.length ? all[0].id : null } };
}

function jumpsFor(event) {
  if (!event) return { jumps: null, count: 0 };
  const hist = (Array.isArray(event.moves) ? event.moves : []).filter(fin);
  if (hist.length >= 6) {
    const p = 1 / (2 * hist.length);
    const jumps = [];
    for (const m of hist.slice().sort((a, b) => a - b)) { const a = Math.log(1 + Math.abs(m)); jumps.push({ x: a, p }, { x: -a, p }); }
    return { jumps, count: hist.length };
  }
  const J = fin(event.jq) ? event.jq : null;
  if (J === null) return { jumps: null, count: hist.length };
  const scale = hist.length >= 3 && fin(event.realizedOverImplied) ? event.realizedOverImplied : 1;
  return { jumps: [{ x: J * scale, p: 0.5 }, { x: -J * scale, p: 0.5 }], count: hist.length };
}

export function setupEngine(input, list) {
  const asOfMs = typeof input.asOf === "number" ? input.asOf : Date.parse(input.asOf);
  const S = input.spot;
  const asOfDay = etDayOf(asOfMs);
  const evIn = input.event && input.event.date ? input.event : null;
  const expiries = new Map(list.map((e) => [e.expiry, e]));
  const facts = { ...(input.facts || {}) };
  const state = input.state || { state: "undetermined", confidence: 0, preferred: ["no position"], avoid: [] };
  const { jumps, count: eventMoves } = jumpsFor(evIn);
  const eventFor = (expiry) => {
    const b = eventBucket(evIn ? { ...evIn, after: asOfDay, ratio: facts["move.event.ratio"] ? facts["move.event.ratio"].v : evIn.ratio } : null, expiry);
    return b;
  };
  const qtabs = new Map();
  const ctx = {
    spot: S, expiries, pLaw: input.pLaw || null, levels: input.levels || null, stale: !!input.stale, curves: !!input.curves,
    eventFor, jumps, eventMoves, event: evIn, eventMode: !!evIn,
    sessionsTo: (d) => sessionsBetween(asOfDay, d),
    qtab: (law, key) => { if (!qtabs.has(key)) qtabs.set(key, quantileTable(law, ENGINE_LINES.VAR_POINTS)); return qtabs.get(key); },
  };
  const lawCache = new Map();
  ctx.lawsOf = (front, spot) => {
    if (!lawCache.has(front.expiry)) lawCache.set(front.expiry, lawsFor(ctx, front.T, front.sessions, front.expiry, front.slice.F, spot));
    return lawCache.get(front.expiry);
  };
  const putSkewPct = facts["skew.rr25.30.pct"] && fin(facts["skew.rr25.30.pct"].v) ? facts["skew.rr25.30.pct"].v : null;
  return { asOfMs, asOfDay, S, evIn, list, expiries, facts, state, ctx, putSkewPct };
}

function detailStructure(st, rw, ctx, S, curves) {
  st.grid = scenarioGrid(rw.legs, rw.vctx, rw.cost, S, rw.front, ctx.levels);
  if (!rw.multi && rw.laws.main) {
    const t = tailRisk(ctx.qtab(rw.laws.main, rw.front.expiry), rw.legs, rw.cost);
    st.tail = { var5P: r$(t.var5P), cvar5P: r$(t.cvar5P) };
  }
  if (curves) st.curves = curvesOf(rw.legs, rw.vctx, rw.cost, rw.qLaw, rw.laws.main, rw.prof, rw.front);
  return st;
}

export function priceStructure(setup, cand, opts = {}) {
  const p = priceCandidate({ rules: [], ...cand }, setup.ctx);
  if (!p) return null;
  const st = { ...p.out };
  if (opts.detail) detailStructure(st, p.raw, setup.ctx, setup.S, !!opts.curves);
  return st;
}

export function structureLegs(setup, familyId, variant, expiry, back) {
  const e = setup.expiries.get(expiry);
  if (!e) return null;
  if (familyId === "long-calendar" || familyId === "diagonal") {
    const b = back ? setup.expiries.get(back) : null;
    return b ? buildMulti(familyId, variant, { front: e, back: b }, setup.state, setup.ctx.levels) : null;
  }
  return buildLegs(familyId, variant, {
    slice: e.slice, callStrikes: e.callStrikes, putStrikes: e.putStrikes, levels: setup.ctx.levels, state: setup.state,
    spot: setup.S, putSkewPct: setup.putSkewPct,
  });
}

export function runEngine(input) {
  const asOfMs = typeof input.asOf === "number" ? input.asOf : Date.parse(input.asOf);
  const S = input.spot;
  const evIn = input.event && input.event.date ? input.event : null;
  const list = [];
  let prev = null;
  const raw = (input.expiries || []).filter((e) => e && typeof e.expiry === "string").slice().sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  let firstAfter = null;
  if (evIn) firstAfter = raw.find((e) => e.expiry >= evIn.date) || null;
  for (const e of raw) {
    const ex = buildExpiry({
      expiry: e.expiry, rows: e.rows, spot: S, asOfMs, rate: input.rate, prev,
      event: evIn && firstAfter && firstAfter.expiry === e.expiry ? { firstAfter: true, sigmaD: null } : null,
    });
    if (!ex) continue;
    list.push(ex);
    prev = ex.slice;
  }
  const setup = setupEngine({ ...input, asOf: asOfMs }, list);
  const { asOfDay, expiries, facts, state, ctx, putSkewPct } = setup;
  const near30 = list.slice().sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30) || a.T - b.T)[0] || null;
  const tier = near30 ? tierOf(near30) : { tier: null, median: null };
  const scored = scoreFamilies({ facts, state, liquidityTier: tier.tier, desk: !!input.desk });
  const eventFor = ctx.eventFor;
  const families = [];
  for (const f of scored.families) {
    const fam = STRUCTURE_BY_ID[f.family];
    const choice = f.veto.length ? null : chooseExpiry(fam, list, ctx);
    const veto = f.veto.slice();
    if (!f.veto.length && !choice) veto.push("expiry.none");
    let score = f.score;
    const rules = f.rules.slice();
    if (choice) {
      const ev = eventFor(choice.front.expiry);
      const crush = !!choice.crush && ev.bucket === "overpriced";
      const v = eventVeto(fam, ev, crush);
      if (v) veto.push(v);
      const ea = eventAffinity(fam.id, ev);
      if (ea.rule) { score += ea.c; rules.push(ea.rule); }
    }
    families.push({ ...f, score, rules, veto, choice });
  }
  families.sort((a, b) => (a.veto.length ? 1 : 0) - (b.veto.length ? 1 : 0) || b.score - a.score || a.n - b.n);
  const top = Number.isInteger(input.topFamilies) && input.topFamilies > 0 ? input.topFamilies : BUCKET_LINES.TOP_FAMILIES;
  const chosen = families.filter((f) => !f.veto.length && f.score > 0).slice(0, top);
  const candidates = [];
  for (const f of chosen) {
    const e = f.choice.front;
    for (const variant of DELTA_TARGETS[f.family] || []) {
      if (candidates.length >= BUCKET_LINES.MAX_CANDIDATES) break;
      let built;
      if (f.family === "long-calendar" || f.family === "diagonal") built = buildMulti(f.family, variant, f.choice, state, input.levels);
      else built = buildLegs(f.family, variant, { slice: e.slice, callStrikes: e.callStrikes, putStrikes: e.putStrikes, levels: input.levels || null, state, spot: S, putSkewPct });
      if (!built) continue;
      const key = f.family + "|" + built.legs.map((l) => (l.expiry || e.expiry) + l.type + l.K + ":" + l.side * l.qty).join(",");
      if (candidates.some((c) => c.key === key)) continue;
      candidates.push({ key, family: f.family, expiry: e.expiry, legs: built.legs, snapped: built.snapped, rules: f.rules, dir: f.dir });
    }
  }
  const structures = [];
  const raws = [];
  candidates.forEach((c, i) => {
    const p = priceCandidate(c, ctx);
    if (!p) return;
    structures.push({ id: "S" + (i + 1), ...p.out });
    raws.push(p.raw);
  });
  const ranking = rankStructures(structures, state);
  const detailed = new Set(input.grids === "all" ? structures.map((x) => x.id) : [...ranking.ideas, ranking.noTrade && ranking.noTrade.closest].filter(Boolean));
  structures.forEach((st, i) => {
    if (!detailed.has(st.id)) return;
    detailStructure(st, raws[i], ctx, S, ctx.curves);
  });
  const out = {
    engine: ENGINE_VERSION, ticker: input.ticker || null, asOf: asOfDay, spot: S,
    liquidity: { tier: tier.tier, medianRelSpread: rpr(tier.median) },
    expiries: list.map((e) => ({
      expiry: e.expiry, dte: e.dte, sessions: e.sessions, T: rv(e.T),
      forward: { F: rp(e.F), D: roundTo(e.D, 8), r: rv(e.r), qImpl: rv(e.qImpl), pairs: e.forward.pairs, method: e.forward.method },
      smile: smileSummary(e.slice),
    })),
    families: families.map((f) => ({ family: f.family, score: roundTo(f.score, 4), rules: f.rules, veto: f.veto, expiry: f.choice ? f.choice.front.expiry : null })),
    structures, ideas: ranking.ideas, noTrade: ranking.noTrade,
  };
  if (input.fits) out.fits = list.map(expiryFit);
  return out;
}

function buildMulti(familyId, variant, choice, state, levels) {
  const f = choice.front, b = choice.back;
  if (!b) return null;
  const both = f.callStrikes.filter((k) => b.callStrikes.includes(k));
  if (!both.length) return null;
  const snap = (K) => { let best = both[0]; for (const k of both) if (Math.abs(k - K) < Math.abs(best - K)) best = k; return best; };
  if (familyId === "long-calendar") {
    const pinned = state && state.state === "pinned" && levels && fin(levels.magnet);
    const K = snap(pinned ? levels.magnet : f.F);
    return { legs: [{ type: "C", K, side: -1, qty: 1, expiry: f.expiry }, { type: "C", K, side: 1, qty: 1, expiry: b.expiry }], snapped: pinned ? [{ K, from: null, rule: "level.magnet" }] : [] };
  }
  const bull = state && state.direction === "bullish";
  const type = bull ? "C" : "P";
  const fs = type === "C" ? f.callStrikes : f.putStrikes, bs = type === "C" ? b.callStrikes : b.putStrikes;
  const st = strikeFrom(f.slice, fs, variant.short, type), lt = strikeFrom(b.slice, bs, variant.long, type);
  if (st === null || lt === null) return null;
  if (type === "C" ? !(st > lt) : !(st < lt)) return null;
  return { legs: [{ type, K: st, side: -1, qty: 1, expiry: f.expiry }, { type, K: lt, side: 1, qty: 1, expiry: b.expiry }], snapped: [] };
}

function strikeFrom(slice, strikes, absDelta, type) {
  let best = null, bd = Infinity;
  for (const K of strikes) {
    const d = forwardDeltaOnSlice(slice, K, type);
    if (d === null) continue;
    const e = Math.abs(Math.abs(d) - absDelta);
    if (e < bd) { bd = e; best = K; }
  }
  return best;
}

function smileSummary(slice) {
  const sk = slice.method === "mixture" ? null : skewMetrics(slice);
  return {
    method: slice.method, n: slice.n || null, fitInSpread: rpr(slice.fitInSpread), rmseIvPts: roundTo(slice.rmseIvPts, 3),
    atmIv: rv(sliceVolK(slice, 0)),
    params: slice.method === "svi" || slice.method === "svi-repaired"
      ? Object.fromEntries(["a", "b", "rho", "m", "sigma"].map((k) => [k, roundTo(slice.params[k], 8)]))
      : Object.fromEntries(Object.keys(slice.params).sort().map((k) => [k, roundTo(slice.params[k], 8)])),
    rr25: sk ? rv(sk.rr25) : null, bf25: sk ? rv(sk.bf25) : null,
    checks: slice.checks && slice.checks.butterfly ? { ok: slice.checks.ok, minG: roundTo(slice.checks.butterfly.minG, 6) } : null,
  };
}
