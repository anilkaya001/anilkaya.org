import { normCdf, bsmGreeks } from "./flows-quant-bs.js";
import { sliceVol, sliceDeltaStrike, sliceDnsStrike, asSlice } from "./flows-quant-smile.js";
import { riskNeutralQuantile, impliedMove, ONE_SIGMA_LOW, ONE_SIGMA_HIGH } from "./flows-quant-density.js";

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const W = (min, max, target) => Object.freeze({ min, max, target });

export const STRUCTURES = Object.freeze([
  { n: 1, id: "long-call", neuron: "long call", kin: [], risk: "defined", dir: "bull", vol: "long", premium: "debit", window: W(30, 90, 60), legs: 1 },
  { n: 2, id: "long-put", neuron: "long put", kin: [], risk: "defined", dir: "bear", vol: "long", premium: "debit", window: W(30, 90, 60), legs: 1 },
  { n: 3, id: "short-put", neuron: null, kin: ["put credit spread"], risk: "undefined", dir: "bull", vol: "short", premium: "credit", window: W(14, 45, 30), legs: 1, desk: true },
  { n: 4, id: "covered-call", neuron: "covered call", kin: [], risk: "stock", dir: "bull", vol: "short", premium: "credit", window: W(14, 45, 30), legs: 2, desk: true },
  { n: 5, id: "call-debit-spread", neuron: "call debit spread", kin: [], risk: "defined", dir: "bull", vol: "long", premium: "debit", window: W(21, 60, 45), legs: 2 },
  { n: 6, id: "put-debit-spread", neuron: "put debit spread", kin: [], risk: "defined", dir: "bear", vol: "long", premium: "debit", window: W(21, 60, 45), legs: 2 },
  { n: 7, id: "put-credit-spread", neuron: "put credit spread", kin: [], risk: "defined", dir: "bull", vol: "short", premium: "credit", window: W(14, 45, 30), legs: 2 },
  { n: 8, id: "call-credit-spread", neuron: "call credit spread", kin: [], risk: "defined", dir: "bear", vol: "short", premium: "credit", window: W(14, 45, 30), legs: 2 },
  { n: 9, id: "long-straddle", neuron: "long straddle", kin: [], risk: "defined", dir: "neutral", vol: "long", premium: "debit", window: W(21, 60, 40), legs: 2 },
  { n: 10, id: "long-strangle", neuron: "long strangle", kin: [], risk: "defined", dir: "neutral", vol: "long", premium: "debit", window: W(21, 60, 40), legs: 2 },
  { n: 11, id: "short-strangle", neuron: null, kin: ["iron condor"], risk: "undefined", dir: "neutral", vol: "short", premium: "credit", window: W(21, 45, 35), minDte: 10, legs: 2 },
  { n: 12, id: "iron-condor", neuron: "iron condor", kin: [], risk: "defined", dir: "neutral", vol: "short", premium: "credit", window: W(21, 45, 35), minDte: 10, legs: 4 },
  { n: 13, id: "iron-fly", neuron: null, kin: ["iron condor"], risk: "defined", dir: "neutral", vol: "short", premium: "credit", window: W(21, 45, 35), minDte: 10, legs: 4, eventCrush: true },
  { n: 14, id: "long-butterfly", neuron: null, kin: ["iron condor"], risk: "defined", dir: "neutral", vol: "short", premium: "debit", window: W(14, 45, 30), legs: 3 },
  { n: 15, id: "broken-wing-butterfly", neuron: null, kin: [], risk: "defined", dir: "state", vol: "short", premium: "either", window: W(14, 45, 30), legs: 3 },
  { n: 16, id: "long-calendar", neuron: "calendar spread", kin: [], risk: "defined", dir: "neutral", vol: "mixed", premium: "debit", window: W(21, 35, 28), back: W(21, 63, 35), legs: 2, multiExpiry: true },
  { n: 17, id: "diagonal", neuron: null, kin: ["calendar spread"], risk: "defined", dir: "state", vol: "mixed", premium: "debit", window: W(14, 35, 28), backAbs: W(45, 120, 75), legs: 2, multiExpiry: true },
  { n: 18, id: "risk-reversal", neuron: null, kin: [], risk: "undefined", dir: "state", vol: "mixed", premium: "either", window: W(30, 90, 45), legs: 2 },
  { n: 19, id: "collar", neuron: "collar", kin: [], risk: "stock", dir: "neutral", vol: "mixed", premium: "either", window: W(30, 90, 45), legs: 3, desk: true },
  { n: 20, id: "put-ratio", neuron: null, kin: ["put credit spread"], risk: "undefined", dir: "bull", vol: "short", premium: "either", window: W(21, 60, 40), legs: 2 },
  { n: 21, id: "call-ratio", neuron: null, kin: ["call credit spread"], risk: "undefined", dir: "bear", vol: "short", premium: "either", window: W(21, 60, 40), legs: 2 },
  { n: 22, id: "jade-lizard", neuron: null, kin: ["put credit spread", "call credit spread"], risk: "undefined", dir: "bull", vol: "short", premium: "credit", window: W(21, 45, 30), legs: 3, noUpsideRisk: true },
  { n: 23, id: "no-position", neuron: "no position", kin: [], risk: "none", dir: "neutral", vol: "none", premium: "none", window: null, legs: 0 },
].map((s) => Object.freeze({ ...s, kin: Object.freeze(s.kin) })));

export const STRUCTURE_BY_ID = Object.freeze(Object.fromEntries(STRUCTURES.map((s) => [s.id, s])));

export const DELTA_TARGETS = Object.freeze({
  "long-call": [{ c: 0.40 }, { c: 0.30 }, { c: 0.50 }],
  "long-put": [{ p: 0.40 }, { p: 0.30 }, { p: 0.50 }],
  "short-put": [{ p: 0.25 }, { p: 0.20 }, { p: 0.30 }],
  "covered-call": [{ c: 0.25 }, { c: 0.30 }],
  "call-debit-spread": [{ long: 0.45, short: 0.20 }, { long: 0.50, short: 0.20 }, { long: 0.45, short: 0.25 }],
  "put-debit-spread": [{ long: 0.45, short: 0.20 }, { long: 0.50, short: 0.20 }, { long: 0.45, short: 0.25 }],
  "put-credit-spread": [{ short: 0.25, long: 0.10 }, { short: 0.20, long: 0.10 }, { short: 0.30, long: 0.10 }],
  "call-credit-spread": [{ short: 0.25, long: 0.10 }, { short: 0.20, long: 0.10 }, { short: 0.30, long: 0.10 }],
  "long-straddle": [{ dns: true }],
  "long-strangle": [{ c: 0.25, p: 0.25 }],
  "short-strangle": [{ c: 0.16, p: 0.16 }, { c: 0.20, p: 0.20 }, { c: 0.12, p: 0.12 }],
  "iron-condor": [{ short: 0.16, wing: 0.05 }, { short: 0.12, wing: 0.03 }, { short: 0.20, wing: 0.08 }],
  "iron-fly": [{ dns: true, wingMad: 1 }, { dns: true, wingMad: 0.75 }, { dns: true, wingMad: 1.5 }],
  "long-butterfly": [{ pin: true, wingMad: 1 }, { pin: true, wingMad: 0.75 }, { pin: true, wingMad: 1.5 }],
  "broken-wing-butterfly": [{ pin: true, near: 1, far: 3 }, { pin: true, near: 1, far: 2 }],
  "long-calendar": [{ atm: true }],
  "diagonal": [{ short: 0.30, long: 0.50 }],
  "risk-reversal": [{ c: 0.25, p: 0.25 }],
  "collar": [{ p: 0.25, c: 0.25 }, { p: 0.20, c: 0.30 }],
  "put-ratio": [{ long: 0.35, short: 0.18 }, { long: 0.35, short: 0.15 }, { long: 0.40, short: 0.20 }],
  "call-ratio": [{ long: 0.35, short: 0.18 }, { long: 0.35, short: 0.15 }, { long: 0.40, short: 0.20 }],
  "jade-lizard": [{ p: 0.25, c: 0.20 }, { p: 0.20, c: 0.15 }, { p: 0.30, c: 0.25 }],
});

const A = (low, mid, high) => ({ low, mid, high });
const V = (cheap, fair, rich) => ({ cheap, fair, rich });
const TS = (contango, flat, backwardation) => ({ contango, flat, backwardation });
const SK = (flat, normal, steep) => ({ flat, normal, steep });
const EV = (none, underpriced, fair, overpriced) => ({ none, underpriced, fair, overpriced });
const LQ = (a, b, c) => ({ A: a, B: b, C: c });
const ROW = (iv, vrp, term, skew, event, liq) => Object.freeze({ iv, vrp, term, skew, event, liq });

export const AFFINITY = Object.freeze({
  "long-call": ROW(A(2, 0, -2), V(2, 0, -2), TS(1, 0, -1), SK(0, 0, 1), EV(0, 1, 0, -2), LQ(1, 0, 0)),
  "long-put": ROW(A(2, 0, -2), V(2, 0, -2), TS(1, 0, -1), SK(1, 0, -1), EV(0, 1, 0, -2), LQ(1, 0, 0)),
  "short-put": ROW(A(-2, 0, 2), V(-2, 0, 2), TS(0, 0, 1), SK(-1, 0, 2), EV(0, -2, -1, -1), LQ(1, 0, 0)),
  "covered-call": ROW(A(-1, 1, 2), V(-1, 0, 1), TS(0, 0, 0), SK(1, 0, 0), EV(0, -1, 0, 0), LQ(1, 0, 0)),
  "call-debit-spread": ROW(A(1, 1, -1), V(1, 0, -1), TS(0, 0, 0), SK(0, 0, 0), EV(0, 1, 0, -1), LQ(1, 0, 0)),
  "put-debit-spread": ROW(A(1, 1, -1), V(1, 0, -1), TS(0, 0, 0), SK(1, 0, -1), EV(0, 1, 0, -1), LQ(1, 0, 0)),
  "put-credit-spread": ROW(A(-2, 1, 2), V(-2, 0, 2), TS(0, 0, 1), SK(-1, 0, 2), EV(0, -2, -1, 0), LQ(1, 0, 0)),
  "call-credit-spread": ROW(A(-2, 1, 2), V(-2, 0, 2), TS(0, 0, 1), SK(1, 0, -1), EV(0, -2, -1, 0), LQ(1, 0, 0)),
  "long-straddle": ROW(A(2, 0, -2), V(2, 0, -2), TS(1, 0, -1), SK(0, 0, 0), EV(0, 2, 0, -2), LQ(1, 0, 0)),
  "long-strangle": ROW(A(2, 0, -2), V(2, 0, -2), TS(1, 0, -1), SK(0, 0, 0), EV(0, 2, 0, -2), LQ(0, 0, 0)),
  "short-strangle": ROW(A(-2, 0, 2), V(-2, -1, 2), TS(0, 0, 1), SK(0, 0, 0), EV(0, -2, -2, 0), LQ(1, 0, 0)),
  "iron-condor": ROW(A(-2, 1, 2), V(-2, 0, 2), TS(0, 0, 1), SK(0, 0, 0), EV(0, -2, -2, 0), LQ(1, 0, 0)),
  "iron-fly": ROW(A(-1, 1, 2), V(-2, 0, 2), TS(0, 0, 1), SK(0, 0, 0), EV(0, -2, 0, 2), LQ(1, 0, 0)),
  "long-butterfly": ROW(A(1, 0, 0), V(0, 0, 1), TS(0, 0, 0), SK(0, 0, 0), EV(0, -1, 0, 1), LQ(1, 0, 0)),
  "broken-wing-butterfly": ROW(A(0, 0, 1), V(0, 0, 1), TS(0, 0, 0), SK(-1, 0, 2), EV(0, -1, 0, 0), LQ(1, 0, 0)),
  "long-calendar": ROW(A(1, 0, -1), V(1, 0, -1), TS(-1, 0, 2), SK(0, 0, 0), EV(0, 0, 0, 1), LQ(1, 0, 0)),
  "diagonal": ROW(A(1, 0, 0), V(1, 0, -1), TS(-1, 0, 2), SK(0, 0, 0), EV(0, 0, 0, 1), LQ(1, 0, 0)),
  "risk-reversal": ROW(A(0, 0, 0), V(0, 0, 0), TS(0, 0, 0), SK(-1, 0, 2), EV(0, -1, 0, -1), LQ(1, 0, 0)),
  "collar": ROW(A(0, 0, 0), V(0, 0, 0), TS(0, 0, 0), SK(2, 0, -1), EV(0, 0, 0, 0), LQ(1, 0, 0)),
  "put-ratio": ROW(A(-1, 0, 1), V(-1, 0, 1), TS(0, 0, 0), SK(-1, 0, 2), EV(0, -2, -1, 0), LQ(1, 0, 0)),
  "call-ratio": ROW(A(-1, 0, 1), V(-1, 0, 1), TS(0, 0, 0), SK(2, 0, -1), EV(0, -2, -1, 0), LQ(1, 0, 0)),
  "jade-lizard": ROW(A(-2, 1, 2), V(-1, 0, 1), TS(0, 0, 0), SK(-1, 0, 2), EV(0, -2, -1, 0), LQ(1, 0, 0)),
  "no-position": ROW(A(0, 0, 0), V(0, 0, 0), TS(0, 0, 0), SK(0, 0, 0), EV(0, 0, 0, 0), LQ(0, 0, 0)),
});

export const BUCKET_LINES = Object.freeze({
  IV_LOW: 0.25, IV_HIGH: 0.75, VRP_CHEAP: -0.10, VRP_RICH: 0.10, TERM_CONTANGO: -0.03, TERM_BACK: 0.03,
  SKEW_FLAT: 0.2, SKEW_STEEP: 0.8, EVENT_UNDER: 0.8, EVENT_OVER: 1.25, LIQ_A: 0.05, LIQ_B: 0.12,
  TOP_FAMILIES: 5, MAX_CANDIDATES: 24,
});

const factOf = (facts, id) => {
  const f = facts && facts[id];
  if (!f || typeof f !== "object") return { v: null, g: 0 };
  return { v: fin(f.v) ? f.v : null, g: fin(f.g) ? Math.max(0, Math.min(3, f.g)) : 0 };
};

export function bucketsOf(facts, liquidityTier) {
  const iv = factOf(facts, "iv.pct.30"), vrp = factOf(facts, "vrp.rel.21");
  const term = factOf(facts, "term.slope.30_90.exEvent"), skew = factOf(facts, "skew.rr25.30.pct");
  const L = BUCKET_LINES;
  return {
    iv: { bucket: iv.v === null ? null : iv.v < L.IV_LOW ? "low" : iv.v > L.IV_HIGH ? "high" : "mid", g: iv.g },
    vrp: { bucket: vrp.v === null ? null : vrp.v <= L.VRP_CHEAP ? "cheap" : vrp.v >= L.VRP_RICH ? "rich" : "fair", g: vrp.g },
    term: { bucket: term.v === null ? null : term.v < L.TERM_CONTANGO ? "contango" : term.v > L.TERM_BACK ? "backwardation" : "flat", g: term.g },
    skew: { bucket: skew.v === null ? null : skew.v <= L.SKEW_FLAT ? "flat" : skew.v >= L.SKEW_STEEP ? "steep" : "normal", g: skew.g },
    liq: { bucket: liquidityTier || null, g: liquidityTier ? 3 : 0 },
  };
}

export function eventBucket(event, expiryDay) {
  if (!event || !event.date || !expiryDay || !(event.date <= expiryDay) || !(event.after === undefined || event.date > event.after)) {
    return { bucket: "none", g: 3, inside: false };
  }
  const ratio = fin(event.ratio) ? event.ratio : null;
  const g = fin(event.g) ? event.g : ratio === null ? 1 : 2;
  const bucket = ratio === null ? "fair" : ratio <= BUCKET_LINES.EVENT_UNDER ? "underpriced" : ratio >= BUCKET_LINES.EVENT_OVER ? "overpriced" : "fair";
  return { bucket, g, inside: true };
}

export function liquidityTier(medianRelSpread) {
  if (!fin(medianRelSpread)) return null;
  return medianRelSpread <= BUCKET_LINES.LIQ_A ? "A" : medianRelSpread <= BUCKET_LINES.LIQ_B ? "B" : "C";
}

export function statePreference(state, family) {
  const s = state && typeof state === "object" ? state : null;
  if (!s) return { preferred: false, avoided: false };
  const names = [family.neuron, ...family.kin].filter(Boolean);
  const avoid = Array.isArray(s.avoid) ? s.avoid : [];
  const pref = Array.isArray(s.preferred) ? s.preferred : [];
  return {
    preferred: family.neuron !== null && pref.includes(family.neuron),
    avoided: names.some((x) => avoid.includes(x)),
  };
}

export function familyDirection(family, state) {
  if (family.dir !== "state") return family.dir;
  const d = state && state.direction;
  return d === "bullish" ? "bull" : d === "bearish" ? "bear" : null;
}

export function scoreFamilies(input) {
  const { facts, state } = input;
  const b = bucketsOf(facts, input.liquidityTier);
  const conf = state && fin(state.confidence) ? Math.max(0, Math.min(3, state.confidence)) : 0;
  const st = state && typeof state.state === "string" ? state.state : "undetermined";
  const dirState = state && state.direction === "bullish" ? "bull" : state && state.direction === "bearish" ? "bear" : null;
  const vrpCheap = b.vrp.bucket === "cheap";
  const out = [];
  for (const fam of STRUCTURES) {
    if (fam.id === "no-position") continue;
    const aff = AFFINITY[fam.id];
    const rules = [];
    let score = 0;
    const veto = [];
    const pref = statePreference(state, fam);
    if (pref.avoided) veto.push("state.avoid");
    if (fam.desk && !input.desk) veto.push("family.desk-only");
    if (st === "undetermined" && !(vrpCheap && (fam.id === "long-straddle" || fam.id === "long-strangle"))) veto.push("state.undetermined");
    if (b.liq.bucket === "C" && fam.n >= 11 && fam.n <= 22) veto.push("liq.tier-c");
    const dir = familyDirection(fam, state);
    if (fam.dir === "state" && dir === null) veto.push("dir.none");
    if (dirState && dir && dir !== "neutral" && dir !== dirState) veto.push("dir.against");
    if (pref.preferred) { const c = 2 * conf / 3; score += c; rules.push("state." + st); }
    for (const axis of ["iv", "vrp", "term", "skew", "liq"]) {
      const bk = b[axis];
      if (!bk.bucket) continue;
      const a = aff[axis][bk.bucket];
      if (!a) continue;
      const c = a * bk.g / 3;
      if (c === 0) continue;
      score += c;
      rules.push(axis + "." + bk.bucket + (c < 0 ? "−" : ""));
    }
    out.push({ family: fam.id, n: fam.n, score, rules, veto, preferred: pref.preferred, dir });
  }
  out.sort((x, y) => y.score - x.score || x.n - y.n);
  return { buckets: b, families: out };
}

export function eventAffinity(familyId, ev) {
  const a = AFFINITY[familyId];
  if (!a || !ev || !ev.bucket) return { c: 0, rule: null };
  const v = a.event[ev.bucket] || 0;
  if (!v) return { c: 0, rule: null };
  const c = v * (fin(ev.g) ? ev.g : 1) / 3;
  return { c, rule: "event." + ev.bucket + (c < 0 ? "−" : "") };
}

export function eventVeto(family, ev, crushMode) {
  if (!ev || !ev.inside) return null;
  if (family.vol === "short" || family.premium === "credit") {
    if (family.eventCrush && crushMode) return null;
    return "event.inside";
  }
  return null;
}

export function listedStrikes(rows, type) {
  const set = new Set();
  for (const r of rows || []) {
    if (!r || !fin(r.K) || (type && r.type !== type)) continue;
    if (fin(r.bid) && fin(r.ask) && r.bid > 0 && r.ask >= r.bid) set.add(r.K);
  }
  return [...set].sort((a, b) => a - b);
}

export function snapStrike(strikes, K, mode = "nearest") {
  if (!strikes.length || !fin(K)) return null;
  let best = null, bestD = Infinity;
  for (const s of strikes) {
    if (mode === "up" && s < K - 1e-9) continue;
    if (mode === "down" && s > K + 1e-9) continue;
    const d = Math.abs(s - K);
    if (d < bestD - 1e-12 || (Math.abs(d - bestD) <= 1e-12 && s < best)) { best = s; bestD = d; }
  }
  return best;
}

export function stepFrom(strikes, K, steps) {
  const i = strikes.indexOf(K);
  if (i < 0) return null;
  const j = i + steps;
  return j >= 0 && j < strikes.length ? strikes[j] : null;
}

export function forwardDeltaOnSlice(slice, K, type) {
  const s = asSlice(slice);
  const vol = sliceVol(s, K);
  if (!(vol > 0)) return null;
  const nu = vol * Math.sqrt(s.T);
  const d1 = Math.log(s.F / K) / nu + nu / 2;
  return type === "P" ? normCdf(d1) - 1 : normCdf(d1);
}

export function strikeAtDelta(slice, strikes, absDelta, type, mode = "nearest") {
  const t = sliceDeltaStrike(slice, type === "P" ? -absDelta : absDelta, type);
  if (!t) return null;
  const K = snapStrike(strikes, t.K, mode);
  return K === null ? null : { K, target: t.K, delta: forwardDeltaOnSlice(slice, K, type) };
}

export function oneSigmaBand(slice) {
  return [riskNeutralQuantile(slice, ONE_SIGMA_LOW), riskNeutralQuantile(slice, ONE_SIGMA_HIGH)];
}

export function pinTarget(slice, levels, strikes) {
  const atr = levels && fin(levels.atr) ? levels.atr : null;
  const s = asSlice(slice);
  if (levels && fin(levels.magnet)) return { K: snapStrike(strikes, levels.magnet), from: "level.magnet" };
  if (levels && fin(levels.maxPain) && atr !== null && fin(levels.spot) && Math.abs(levels.maxPain - levels.spot) <= 0.5 * atr) {
    return { K: snapStrike(strikes, levels.maxPain), from: "level.maxPain" };
  }
  return { K: snapStrike(strikes, riskNeutralQuantile(s, 0.5)), from: "rnd.median" };
}

export function madWidth(slice) {
  const m = impliedMove(slice);
  return m ? m.meanAbsMove : null;
}

export function buildLegs(familyId, variant, ctx) {
  const { slice, callStrikes, putStrikes, levels, state } = ctx;
  const s = asSlice(slice);
  const snapped = [];
  const leg = (type, K, side, qty = 1) => ({ type, K, side, qty });
  const C = (d, mode) => strikeAtDelta(s, callStrikes, d, "C", mode);
  const P = (d, mode) => strikeAtDelta(s, putStrikes, d, "P", mode);
  const pinned = state && state.state === "pinned";
  const amplifying = state && (state.state === "amplifying" || state.state === "squeeze");
  const flip = levels && fin(levels.flip) ? levels.flip : null;
  const S = ctx.spot;
  const wallSnap = (type, K) => {
    if (!pinned || !levels) return K;
    const wall = type === "C" ? levels.callWall : levels.putWall;
    if (!fin(wall)) return K;
    const strikes = type === "C" ? callStrikes : putStrikes;
    const dW = forwardDeltaOnSlice(s, wall, type), dK = forwardDeltaOnSlice(s, K, type);
    if (dW === null || dK === null || Math.abs(Math.abs(dW) - Math.abs(dK)) > 0.05) return K;
    const Kw = snapStrike(strikes, wall, type === "C" ? "up" : "down");
    if (Kw !== null && Kw !== K) snapped.push({ K: Kw, from: K, rule: type === "C" ? "wall.call" : "wall.put" });
    return Kw === null ? K : Kw;
  };
  const flipSnap = (type, K) => {
    if (!amplifying || flip === null || !fin(S)) return K;
    const strikes = type === "C" ? callStrikes : putStrikes;
    if (type === "C" && flip > S && K <= flip) {
      const Kf = strikes.find((x) => x > flip);
      if (Kf !== undefined) { snapped.push({ K: Kf, from: K, rule: "flip.beyond" }); return Kf; }
    }
    if (type === "P" && flip < S && K >= flip) {
      const Kf = [...strikes].reverse().find((x) => x < flip);
      if (Kf !== undefined) { snapped.push({ K: Kf, from: K, rule: "flip.beyond" }); return Kf; }
    }
    return K;
  };
  const shortSnap = (type, K) => flipSnap(type, wallSnap(type, K));
  const targetWall = (type, lo, hi) => {
    if (!levels) return null;
    const wall = type === "C" ? levels.callWall : levels.putWall;
    if (!fin(wall)) return null;
    const d = forwardDeltaOnSlice(s, wall, type);
    if (d === null || Math.abs(d) < lo || Math.abs(d) > hi) return null;
    return snapStrike(type === "C" ? callStrikes : putStrikes, wall);
  };
  const out = (legs) => (legs.some((l) => !fin(l.K)) ? null : { legs, snapped });
  switch (familyId) {
    case "long-call": { const c = C(variant.c); return c && out([leg("C", c.K, 1)]); }
    case "long-put": { const p = P(variant.p); return p && out([leg("P", p.K, 1)]); }
    case "short-put": { const p = P(variant.p); return p && out([leg("P", shortSnap("P", p.K), -1)]); }
    case "covered-call": { const c = C(variant.c); return c && out([leg("S", S, 1), leg("C", shortSnap("C", c.K), -1)]); }
    case "call-debit-spread": {
      const l = C(variant.long); if (!l) return null;
      let sK = targetWall("C", 0.15, 0.35);
      if (sK !== null) snapped.push({ K: sK, from: null, rule: "wall.target" });
      if (sK === null) { const sh = C(variant.short); sK = sh ? sh.K : null; }
      if (sK === null || !(sK > l.K)) return null;
      return out([leg("C", l.K, 1), leg("C", sK, -1)]);
    }
    case "put-debit-spread": {
      const l = P(variant.long); if (!l) return null;
      let sK = targetWall("P", 0.15, 0.35);
      if (sK !== null) snapped.push({ K: sK, from: null, rule: "wall.target" });
      if (sK === null) { const sh = P(variant.short); sK = sh ? sh.K : null; }
      if (sK === null || !(sK < l.K)) return null;
      return out([leg("P", l.K, 1), leg("P", sK, -1)]);
    }
    case "put-credit-spread": {
      const sh = P(variant.short); if (!sh) return null;
      const sK = shortSnap("P", sh.K);
      const lo = P(variant.long);
      let lK = lo ? lo.K : null;
      if (lK === null || !(lK < sK)) lK = stepFrom(putStrikes, sK, -2) ?? stepFrom(putStrikes, sK, -1);
      if (lK === null || !(lK < sK)) return null;
      return out([leg("P", sK, -1), leg("P", lK, 1)]);
    }
    case "call-credit-spread": {
      const sh = C(variant.short); if (!sh) return null;
      const sK = shortSnap("C", sh.K);
      const lo = C(variant.long);
      let lK = lo ? lo.K : null;
      if (lK === null || !(lK > sK)) lK = stepFrom(callStrikes, sK, 2) ?? stepFrom(callStrikes, sK, 1);
      if (lK === null || !(lK > sK)) return null;
      return out([leg("C", sK, -1), leg("C", lK, 1)]);
    }
    case "long-straddle": {
      const dns = sliceDnsStrike(s); if (!dns) return null;
      const K = snapStrike(callStrikes.filter((x) => putStrikes.includes(x)), dns.K);
      return K === null ? null : out([leg("C", K, 1), leg("P", K, 1)]);
    }
    case "long-strangle": {
      const c = C(variant.c), p = P(variant.p);
      return c && p && c.K > p.K ? out([leg("P", p.K, 1), leg("C", c.K, 1)]) : null;
    }
    case "short-strangle": {
      const c = C(variant.c), p = P(variant.p);
      if (!c || !p) return null;
      const cK = shortSnap("C", c.K), pK = shortSnap("P", p.K);
      return cK > pK ? out([leg("P", pK, -1), leg("C", cK, -1)]) : null;
    }
    case "iron-condor": {
      const sc = C(variant.short), sp = P(variant.short), wc = C(variant.wing), wp = P(variant.wing);
      if (!sc || !sp || !wc || !wp) return null;
      let cK = shortSnap("C", sc.K), pK = shortSnap("P", sp.K);
      const band = oneSigmaBand(s);
      if (pK > band[0]) { const k2 = snapStrike(putStrikes, band[0], "down"); if (k2 !== null && k2 !== pK) { snapped.push({ K: k2, from: pK, rule: "band.one-sigma" }); pK = k2; } }
      if (cK < band[1]) { const k2 = snapStrike(callStrikes, band[1], "up"); if (k2 !== null && k2 !== cK) { snapped.push({ K: k2, from: cK, rule: "band.one-sigma" }); cK = k2; } }
      let wcK = wc.K, wpK = wp.K;
      if (!(wcK > cK)) wcK = stepFrom(callStrikes, cK, 1);
      if (!(wpK < pK)) wpK = stepFrom(putStrikes, pK, -1);
      if (wcK === null || wpK === null || !(pK < cK)) return null;
      return out([leg("P", wpK, 1), leg("P", pK, -1), leg("C", cK, -1), leg("C", wcK, 1)]);
    }
    case "iron-fly": {
      const dns = sliceDnsStrike(s), mad = madWidth(s);
      if (!dns || !(mad > 0)) return null;
      const both = callStrikes.filter((x) => putStrikes.includes(x));
      const K = snapStrike(both, dns.K);
      if (K === null) return null;
      let up = snapStrike(callStrikes, K + variant.wingMad * mad), dn = snapStrike(putStrikes, K - variant.wingMad * mad);
      if (!(up > K)) up = stepFrom(callStrikes, K, 1);
      if (!(dn < K)) dn = stepFrom(putStrikes, K, -1);
      if (up === null || dn === null) return null;
      return out([leg("P", dn, 1), leg("P", K, -1), leg("C", K, -1), leg("C", up, 1)]);
    }
    case "long-butterfly": {
      const mad = madWidth(s);
      const pin = pinned ? pinTarget(s, { ...levels, spot: S }, callStrikes) : { K: snapStrike(callStrikes, riskNeutralQuantile(s, 0.5)), from: "rnd.median" };
      if (pin.K === null || !(mad > 0)) return null;
      if (pin.from !== "rnd.median") snapped.push({ K: pin.K, from: null, rule: pin.from });
      const w = mad * variant.wingMad;
      let lo = snapStrike(callStrikes, pin.K - w), hi = snapStrike(callStrikes, pin.K + w);
      if (!(lo < pin.K)) lo = stepFrom(callStrikes, pin.K, -1);
      if (!(hi > pin.K)) hi = stepFrom(callStrikes, pin.K, 1);
      if (lo === null || hi === null) return null;
      const dLo = pin.K - lo, dHi = hi - pin.K;
      if (Math.abs(dLo - dHi) > 1e-9) { const d = Math.min(dLo, dHi); lo = snapStrike(callStrikes, pin.K - d); hi = snapStrike(callStrikes, pin.K + d); }
      if (!(lo < pin.K && hi > pin.K)) return null;
      return out([leg("C", lo, 1), leg("C", pin.K, -1, 2), leg("C", hi, 1)]);
    }
    case "broken-wing-butterfly": {
      const dir = familyDirection(STRUCTURE_BY_ID[familyId], state);
      if (!dir) return null;
      const type = ctx.putSkewPct !== null && ctx.putSkewPct >= 0.7 ? "P" : dir === "bull" ? "C" : "P";
      const strikes = type === "C" ? callStrikes : putStrikes;
      const wall = levels ? (dir === "bull" ? levels.callWall : levels.putWall) : null;
      let body = fin(wall) ? snapStrike(strikes, wall) : null;
      if (body !== null) snapped.push({ K: body, from: null, rule: "wall.target" });
      if (body === null) { const t = strikeAtDelta(s, strikes, 0.35, type); body = t ? t.K : null; }
      if (body === null) return null;
      const sgn = type === "C" ? 1 : -1;
      const near = stepFrom(strikes, body, -sgn * variant.near), far = stepFrom(strikes, body, sgn * variant.far);
      if (near === null || far === null) return null;
      return out([leg(type, near, 1), leg(type, body, -1, 2), leg(type, far, 1)]);
    }
    case "risk-reversal": {
      const dir = familyDirection(STRUCTURE_BY_ID[familyId], state);
      const c = C(variant.c), p = P(variant.p);
      if (!dir || !c || !p) return null;
      return dir === "bull" ? out([leg("P", shortSnap("P", p.K), -1), leg("C", c.K, 1)])
        : out([leg("P", p.K, 1), leg("C", shortSnap("C", c.K), -1)]);
    }
    case "collar": {
      const c = C(variant.c), p = P(variant.p);
      if (!c || !p) return null;
      return out([leg("S", S, 1), leg("P", p.K, 1), leg("C", c.K, -1)]);
    }
    case "put-ratio": {
      const l = P(variant.long), sh = P(variant.short);
      if (!l || !sh || !(sh.K < l.K)) return null;
      return out([leg("P", l.K, 1), leg("P", shortSnap("P", sh.K), -1, 2)]);
    }
    case "call-ratio": {
      const l = C(variant.long), sh = C(variant.short);
      if (!l || !sh || !(sh.K > l.K)) return null;
      let sK = sh.K;
      if (levels && fin(levels.callWall) && sK < levels.callWall) {
        const k2 = snapStrike(callStrikes, levels.callWall, "up");
        if (k2 !== null) { snapped.push({ K: k2, from: sK, rule: "wall.call" }); sK = k2; }
      }
      return out([leg("C", l.K, 1), leg("C", sK, -1, 2)]);
    }
    case "jade-lizard": {
      const p = P(variant.p), c = C(variant.c);
      if (!p || !c) return null;
      const pK = shortSnap("P", p.K), cK = shortSnap("C", c.K);
      let wK = stepFrom(callStrikes, cK, 1);
      if (wK === null) return null;
      return out([leg("P", pK, -1), leg("C", cK, -1), leg("C", wK, 1)]);
    }
    default: return null;
  }
}

export function legGate(q, side) {
  if (!q || !fin(q.bid) || !fin(q.ask) || !(q.bid > 0) || !(q.ask >= q.bid)) return { pass: false, code: "liq.one-sided" };
  const mid = (q.bid + q.ask) / 2, sp = q.ask - q.bid;
  const rel = sp / mid;
  let spreadOk;
  if (mid >= 1) spreadOk = rel <= 0.10;
  else if (mid >= 0.30) spreadOk = rel <= 0.15;
  else spreadOk = sp <= 0.05 + 1e-9;
  if (!spreadOk) return { pass: false, code: "liq.spread" };
  const oi = fin(q.oi) ? q.oi : 0;
  if (oi < (side < 0 ? 250 : 100)) return { pass: false, code: "liq.oi" };
  return { pass: true, code: null, rel, tight: rel <= 0.05 && oi >= 500 };
}

export function dollarGammaPer1pct(input) {
  const { gamma, oi, S } = input || {};
  const dollars = gamma * oi * 100 * S * 0.01 * S;
  return { dollars, vendorFormula: gamma * oi * S * S };
}

export function maxPain(input) {
  const strikes = input.strikes || [];
  const callOi = input.callOi || [], putOi = input.putOi || [];
  const payoutByStrike = {};
  let best = null, bestV = Infinity;
  for (const X of strikes.slice().sort((a, b) => a - b)) {
    let v = 0;
    for (let i = 0; i < strikes.length; i++) {
      v += (callOi[i] || 0) * Math.max(0, X - strikes[i]) + (putOi[i] || 0) * Math.max(0, strikes[i] - X);
    }
    payoutByStrike[String(X)] = v;
    if (v < bestV) { bestV = v; best = X; }
  }
  return { maxPain: best, payoutByStrike };
}

export function wallsFromBook(input) {
  const { spot } = input;
  const rows = (input.rows || []).filter((r) => r && fin(r.strike)).slice().sort((a, b) => a.strike - b.strike);
  let callWall = null, putWall = null, magnet = null, cBest = -Infinity, pBest = -Infinity, mBest = -Infinity;
  for (const r of rows) {
    const cg = fin(r.callGammaOi) ? r.callGammaOi : 0, pg = fin(r.putGammaOi) ? r.putGammaOi : 0;
    if (r.strike >= spot && cg > cBest) { cBest = cg; callWall = r.strike; }
    if (r.strike <= spot && Math.abs(pg) > pBest) { pBest = Math.abs(pg); putWall = r.strike; }
    if (Math.abs(cg + pg) > mBest) { mBest = Math.abs(cg + pg); magnet = r.strike; }
  }
  return { callWall, putWall, magnet, gex: rows.reduce((s, r) => s + (fin(r.callGammaOi) ? r.callGammaOi : 0) + (fin(r.putGammaOi) ? r.putGammaOi : 0), 0) };
}

export function gammaProfile(input) {
  const { spot, contracts } = input;
  const points = input.points || 121, span = input.span || 0.15;
  const r = fin(input.r) ? input.r : 0, q = fin(input.q) ? input.q : 0;
  const grid = [], gex = [];
  for (let i = 0; i < points; i++) {
    const x = spot * (1 - span + 2 * span * i / (points - 1));
    let g = 0;
    for (const c of contracts) {
      const gr = bsmGreeks({ S: x, K: c.K, r, q, sigma: c.sigma, T: c.T, type: c.type });
      if (!gr) continue;
      const sgn = c.type === "C" ? 1 : -1;
      g += sgn * c.oi * 100 * gr.gamma * x * x * 0.01;
    }
    grid.push(x); gex.push(g);
  }
  const flips = [];
  for (let i = 1; i < points; i++) {
    if ((gex[i - 1] < 0) !== (gex[i] < 0)) {
      const t = gex[i - 1] / (gex[i - 1] - gex[i]);
      flips.push(grid[i - 1] + t * (grid[i] - grid[i - 1]));
    }
  }
  flips.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot) || a - b);
  return { grid, gex, flip: flips.length ? flips[0] : null, flips };
}
