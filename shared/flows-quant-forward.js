import { impliedVolB76, normCdf, normPdf, forwardDelta, black76 } from "./flows-quant-bs.js";
import { openUtcMs, closeUtcMs, YEAR_SECONDS } from "./flows-quant-time.js";

export const FWD_LINES = Object.freeze({
  REL_SPREAD: 0.25,
  WINDOW: 0.05,
  WIDEN_MAX: 0.15,
  WIDEN_PAIRS: 8,
  MAX_PAIRS: 12,
  MIN_PAIRS: 3,
  HALF_CENT: 0.005,
  RATE_SE: 0.02,
  BORROW_SE: 0.03,
  DIV_SE_UNKNOWN: 0.015,
  DIV_SHARE: 0.10,
  Z_TRUST: 3,
  VETO_Z: 4,
  BAND_PLAIN: 0.02,
  BAND_PM: 0.10,
  Z95: 1.96,
  BOUND_FLOOR: 0.51,
  PUT_DELTA_CUT: 0.30,
  CALL_DELTA_CUT: 0.70,
  EEP_SHARE: 0.15,
  EEP_SHIFT: 0.25,
  EEP_SD: 0.15,
  RAMP: 1,
  CARRY_WEIGHT_MIN: 0.05,
  SPOT_SE: 0.00015,
  DECL_SHARE: 0.25,
  DECL_SHARE_UNKNOWN: 1,
  EXPECT_SHARE: 0.5,
  DHAT_UNKNOWN: 0.004,
  SPECIAL_SE: 0.02,
  EX_DIV_MULT: 1.5,
  EX_SOFT_Z: 1.645,
  CAP_DAYS: 2,
  CAP_PM_FLOOR: 0.03,
});

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const SQRT3 = Math.sqrt(3);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const yearMs = YEAR_SECONDS * 1000;

export function dividendFraction({ q, ex }) {
  const g = ex && fin(ex.g) && ex.g > 0 ? ex.g : 91;
  return fin(q) && q > 0 ? q * g / 365 : FWD_LINES.DHAT_UNKNOWN;
}

function discreteOf({ q, T, ex }) {
  const L = FWD_LINES;
  if (!ex || (ex.state !== "declared" && ex.state !== "expected") || !(ex.n >= 1) || ex.irregular === true) return null;
  const g = fin(ex.g) && ex.g > 0 ? ex.g : 91;
  if (!(T <= g / 365)) return null;
  const dHat = dividendFraction({ q, ex });
  const share = ex.state === "expected" ? L.EXPECT_SHARE : fin(q) && q > 0 ? L.DECL_SHARE : L.DECL_SHARE_UNKNOWN;
  return { n: ex.n, dHat, se: share * dHat * ex.n };
}

export function carryOf({ S, r, T, q, ex = null }) {
  const known = fin(q);
  const L = FWD_LINES;
  const base = L.SPOT_SE ** 2 + (L.RATE_SE * T) ** 2 + (L.BORROW_SE * T) ** 2;
  const dis = discreteOf({ q, T, ex });
  if (dis !== null) {
    const F = S * Math.exp(r * T) * (1 - dis.n * dis.dHat);
    return { F, se: F * Math.sqrt(base + dis.se ** 2), known: true, discrete: true, dHat: dis.dHat };
  }
  const F = S * Math.exp((r - (known ? q : 0)) * T);
  const divRel = known ? L.DIV_SHARE * Math.abs(Math.exp(r * T) - Math.exp((r - q) * T)) : 0;
  const unknown = known ? 0 : L.DIV_SE_UNKNOWN * T;
  const special = ex && ex.irregular === true && ex.state === "declared" ? L.SPECIAL_SE : 0;
  const rel = Math.sqrt(base + divRel ** 2 + unknown ** 2 + special ** 2);
  return { F, se: F * rel, known, discrete: false, dHat: null };
}

export function exerciseStrike({ S, D, sigma, r, tau }) {
  if (![S, D, sigma, r, tau].every(fin) || !(S > 0) || !(D > 0) || !(sigma > 0) || !(tau > 0) || D >= S) return null;
  const P = (K) => black76((S - D) * Math.exp(r * tau), Math.exp(-r * tau), K, sigma, tau, "P");
  const gain = (K) => D - K * (1 - Math.exp(-r * tau)) - P(K);
  let lo = 0, hi = 2 * S;
  if (!(gain(lo + 1e-9) > 0)) return null;
  if (gain(hi) >= 0) return hi;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (gain(mid) >= 0) lo = mid; else hi = mid;
  }
  return lo;
}

export function exFrame(outlook, { readMs, expiryMs }) {
  if (!outlook || !fin(readMs) || !fin(expiryMs)) return null;
  const open = outlook.exDate ? openUtcMs(outlook.exDate) : null;
  return {
    state: outlook.state, exDate: outlook.exDate || null, n: outlook.n || 0, g: outlook.g, irregular: outlook.irregular === true, fresh: outlook.fresh === true,
    ageDays: outlook.ageDays, lastExerciseDay: outlook.lastExerciseDay || null,
    tEx: open === null ? null : Math.max(0, (open - readMs) / yearMs),
    tau2: open === null ? null : Math.max(0, (expiryMs - open) / yearMs),
  };
}

export function sigmaAtm(quotes, F, D, T) {
  let best = null;
  for (const q of quotes) {
    if (!q || !fin(q.K) || !(q.K > 0)) continue;
    const call = q.K >= F;
    const bid = call ? q.cb : q.pb, ask = call ? q.ca : q.pa;
    if (!fin(bid) || !fin(ask) || !(bid > 0) || !(ask >= bid)) continue;
    const gap = Math.abs(Math.log(q.K / F));
    if (best === null || gap < best.gap) best = { gap, K: q.K, mid: (bid + ask) / 2, type: call ? "C" : "P" };
  }
  if (best === null) return null;
  const iv = impliedVolB76(F, D, best.K, T, best.mid, best.type, null);
  return fin(iv) && iv > 0 ? iv : null;
}

function qualifies(q) {
  const { cb, ca, pb, pa } = q;
  if (![cb, ca, pb, pa].every(fin)) return null;
  if (!(cb > 0 && pb > 0 && ca >= cb && pa >= pb)) return null;
  const cm = (cb + ca) / 2, pm = (pb + pa) / 2;
  if ((ca - cb) / cm > FWD_LINES.REL_SPREAD || (pa - pb) / pm > FWD_LINES.REL_SPREAD) return null;
  return { K: q.K, cb, ca, pb, pa, cm, pm };
}

export function selectPairs(quotes, { Fc, T, sigma = null, divides = true, skipAtOrBelow = null }) {
  const L = FWD_LINES;
  const all = [];
  for (const q of Array.isArray(quotes) ? quotes : []) {
    if (!q || !fin(q.K) || !(q.K > 0)) continue;
    if (fin(skipAtOrBelow) && q.K <= skipAtOrBelow) continue;
    const p = qualifies(q);
    if (p === null) continue;
    all.push({ ...p, gap: Math.abs(Math.log(p.K / Fc)) });
  }
  const keep = (p) => {
    if (!fin(sigma) || !(sigma > 0)) return true;
    const call = forwardDelta(Fc, p.K, sigma, T, "C");
    if (call < L.PUT_DELTA_CUT) return false;
    return !(divides && call > L.CALL_DELTA_CUT);
  };
  all.sort((a, b) => a.gap - b.gap || a.K - b.K);
  const near = all.filter((p) => p.gap <= L.WINDOW).filter(keep);
  let pick;
  if (near.length >= L.MIN_PAIRS) pick = near.slice(0, L.MAX_PAIRS);
  else pick = all.filter((p) => p.gap <= L.WIDEN_MAX).filter(keep).slice(0, L.WIDEN_PAIRS);
  return pick.sort((a, b) => a.K - b.K);
}

export function parityOf(pairs, D) {
  if (!Array.isArray(pairs) || !pairs.length || !(D > 0)) return null;
  const H = FWD_LINES.HALF_CENT;
  let sw = 0, swf = 0;
  const rows = pairs.map((p) => {
    const hsC = Math.max((p.ca - p.cb) / 2, H), hsP = Math.max((p.pa - p.pb) / 2, H);
    const sigma = Math.sqrt(hsC * hsC + hsP * hsP) / (SQRT3 * D);
    const w = 1 / (sigma * sigma);
    const Fi = p.K + ((p.cb + p.ca) / 2 - (p.pb + p.pa) / 2) / D;
    sw += w;
    swf += w * Fi;
    return { K: p.K, Fi, sigma, w };
  });
  const F = swf / sw;
  const seStat = 1 / Math.sqrt(sw);
  const n = rows.length;
  let chi = 0;
  for (const r of rows) chi += r.w * (r.Fi - F) * (r.Fi - F);
  const birge = n >= 2 ? Math.sqrt(chi / (n - 1)) : null;
  const kBar = rows.reduce((a, r) => a + r.w * r.K, 0) / sw;
  const sys = FWD_LINES.EEP_SHARE * kBar * (1 - D);
  const sePure = seStat * (birge === null ? 1 : Math.max(1, birge));
  const se = Math.sqrt(sePure * sePure + sys * sys);
  let slopeZ = null;
  if (n >= 4) {
    let sxx = 0, sxy = 0;
    for (const r of rows) {
      const dk = r.K - kBar;
      sxx += r.w * dk * dk;
      sxy += r.w * dk * (r.Fi - F);
    }
    if (sxx > 0) {
      const slope = sxy / sxx;
      let res = 0;
      for (const r of rows) res += r.w * (r.Fi - F - slope * (r.K - kBar)) ** 2;
      slopeZ = slope * Math.sqrt(sxx) / Math.max(1, Math.sqrt(res / (n - 2)));
    }
  }
  return { F, se, seStat, sePure, sys, birge, slopeZ, n, rows };
}

export function dDeltaMax(se, F, sigma, T) {
  if (!fin(se) || !fin(F) || !(F > 0) || !fin(sigma) || !(sigma > 0) || !(T > 0)) return null;
  const s = sigma * Math.sqrt(T);
  return Math.max(FWD_LINES.BOUND_FLOOR, s) * (se / F) / s;
}

function exThresholds({ S, r, q, ex, sigma }) {
  const L = FWD_LINES;
  if (!ex || (ex.state !== "declared" && ex.state !== "expected") || !(ex.n >= 1) || !fin(ex.tau2) || !(ex.tau2 > 0) || !fin(sigma) || !(sigma > 0)) return { hard: null, soft: null };
  const amount = Math.max(dividendFraction({ q, ex }), ex.irregular === true ? L.SPECIAL_SE : 0) * S;
  const D = L.EX_DIV_MULT * amount;
  const hard = exerciseStrike({ S, D, sigma, r, tau: ex.tau2 });
  const lift = Math.exp(L.EX_SOFT_Z * sigma * Math.sqrt(Math.max(0, ex.tEx || 0)));
  const soft = exerciseStrike({ S: S * lift, D, sigma, r, tau: ex.tau2 });
  return { hard, soft: soft === null ? hard : Math.max(hard === null ? 0 : hard, soft) };
}

export function chooseForward({ quotes, S, r, T, q, ex = null }) {
  const L = FWD_LINES;
  const D = Math.exp(-r * T);
  const carry = carryOf({ S, r, T, q, ex });
  const sig0 = sigmaAtm(quotes, carry.F, D, T);
  const dividends = !carry.known || q > 0 || carry.discrete;
  const { hard: exK, soft: exKSoft } = exThresholds({ S, r, q, ex, sigma: sig0 });
  const chosen = selectPairs(quotes, { Fc: carry.F, T, sigma: sig0, divides: dividends, skipAtOrBelow: exKSoft });
  const par = parityOf(chosen, D);
  const pairs = chosen.map((p) => [p.K, p.cb, p.ca, p.pb, p.pa]);
  const out = {
    F: carry.F, se: carry.se, src: "carry", n: par ? par.n : 0, z: null, gapBp: null, veto: false,
    Fc: carry.F, seC: carry.se, qKnown: carry.known, Fpar: par ? par.F : null, sePar: par ? par.se : null, birge: par ? par.birge : null,
    sigmaAtm: sig0, dDeltaMax: dDeltaMax(carry.se, carry.F, sig0, T), T, r, D, pairs,
    discrete: carry.discrete === true,
    exState: ex ? ex.state : "none",
    exDate: ex && ex.exDate ? ex.exDate : null,
    exK, exKSoft,
    cap: false,
  };
  const exFresh = ex && ex.state === "none-known" && ex.fresh === true;
  out.cap = T < L.CAP_DAYS / 365 && !exFresh;
  if (!par) return out;
  const z = (par.F - carry.F) / Math.sqrt(par.se * par.se + carry.se * carry.se);
  out.z = z;
  if (par.n < L.MIN_PAIRS) {
    out.cap = T < L.CAP_DAYS / 365 && !exFresh;
    const sv = par.n === 2 ? par.seStat * Math.max(1, Math.abs(par.rows[0].Fi - par.rows[1].Fi) / Math.sqrt(par.rows[0].sigma ** 2 + par.rows[1].sigma ** 2)) : par.seStat;
    const zv = (par.F - carry.F) / Math.sqrt(sv * sv + carry.se * carry.se);
    out.veto = Math.abs(zv) > L.VETO_Z;
    return out;
  }
  const sigPar = sigmaAtm(quotes, par.F, D, T);
  out.sigmaAtm = fin(sigPar) ? sigPar : sig0;
  const lo = L.Z_TRUST - L.RAMP, width = 2 * L.RAMP;
  const early = clamp01((-z - lo) / width) * (par.slopeZ === null ? 1 : clamp01((-par.slopeZ - lo) / width));
  const gap = par.F - carry.F;
  const parF = par.F - early * L.EEP_SHIFT * Math.abs(gap);
  const sePar = early > 0 ? Math.sqrt(par.se * par.se + (early * L.EEP_SD * gap) ** 2) : par.se;
  const shifted = parF - carry.F;
  const seC = Math.sqrt(carry.se * carry.se + Math.max(0, shifted * shifted - sePar * sePar - carry.se * carry.se));
  const wp = 1 / (sePar * sePar), wc = 1 / (seC * seC);
  out.F = (parF * wp + carry.F * wc) / (wp + wc);
  out.se = 1 / Math.sqrt(wp + wc);
  out.sePar = sePar;
  out.seC = seC;
  out.src = wc / (wp + wc) < L.CARRY_WEIGHT_MIN ? "parity" : "blend";
  out.gapBp = (par.F / carry.F - 1) * 1e4;
  out.cap = false;
  out.ee = z < -L.Z_TRUST && par.slopeZ !== null && par.slopeZ < -L.Z_TRUST;
  out.slopeZ = par.slopeZ;
  out.dDeltaMax = dDeltaMax(out.se, out.F, out.sigmaAtm, T);
  return out;
}

export function deltaSensitivity({ F, K, sigma, T, held }) {
  if (!(F > 0) || !(K > 0) || !(sigma > 0) || !(T > 0)) return null;
  const s = sigma * Math.sqrt(T);
  const d1 = Math.log(F / K) / s + s / 2, d2 = d1 - s;
  const g = held === "P" ? normPdf(d1) - d2 * normCdf(-d1) : normPdf(d1) + d2 * normCdf(d1);
  return g / s;
}

export function deltaBand({ F, se, K, sigma, T, held, veto = false, capPm = false, exercise = false }) {
  if (exercise) return { band: "dash", half: null, reason: "exercise" };
  if (veto) return { band: "dash", half: null, reason: "veto" };
  if (!fin(se) || !(se >= 0)) return { band: "dash", half: null, reason: "no-forward" };
  const sens = deltaSensitivity({ F, K, sigma, T, held });
  if (sens === null) return { band: "dash", half: null, reason: "no-sensitivity" };
  const h95 = FWD_LINES.Z95 * Math.abs(sens) * se / F;
  if (h95 <= FWD_LINES.BAND_PLAIN && !capPm) return { band: "plain", half: h95, reason: null };
  const rounded = Math.ceil(h95 * 100 - 1e-9) / 100;
  const half = capPm ? Math.max(FWD_LINES.CAP_PM_FLOOR, rounded) : rounded;
  if (h95 <= FWD_LINES.BAND_PM) return { band: "pm", half, reason: capPm && h95 <= FWD_LINES.BAND_PLAIN ? "capped" : null };
  return { band: "dash", half: null, reason: "wide" };
}

export function quotesByExpiry(rows) {
  const byExpiry = new Map();
  for (const r of rows) {
    let strikes = byExpiry.get(r.expiry);
    if (!strikes) { strikes = new Map(); byExpiry.set(r.expiry, strikes); }
    let q = strikes.get(r.strike);
    if (!q) { q = { K: r.strike, cb: null, ca: null, pb: null, pa: null, putRow: null }; strikes.set(r.strike, q); }
    if (r.type === "C") { q.cb = r.bid; q.ca = r.ask; } else { q.pb = r.bid; q.pa = r.ask; q.putRow = r; }
  }
  const out = new Map();
  for (const [expiry, strikes] of byExpiry) out.set(expiry, Array.from(strikes.values()).sort((a, b) => a.K - b.K));
  return out;
}

export function forwardRecord(expiry, rec) {
  if (!rec) return { expiry, method: "rate-only", pairs: 0, F: null, src: "rate", se: null };
  return {
    expiry, F: rec.F, se: rec.se, src: rec.src, n: rec.n, z: rec.z, gapBp: rec.gapBp, veto: rec.veto,
    Fc: rec.Fc, seC: rec.seC, qKnown: rec.qKnown, Fpar: rec.Fpar, sePar: rec.sePar, birge: rec.birge, sigmaAtm: rec.sigmaAtm, dDeltaMax: rec.dDeltaMax, ee: rec.ee === true, slopeZ: rec.slopeZ === undefined ? null : rec.slopeZ,
    discrete: rec.discrete === true, exState: rec.exState || "none", exDate: rec.exDate || null, exK: rec.exK === undefined ? null : rec.exK, exKSoft: rec.exKSoft === undefined ? null : rec.exKSoft, cap: rec.cap === true,
    T: rec.T, r: rec.r, D: rec.D, pairList: rec.pairs,
    method: rec.src === "parity" || rec.src === "blend" ? "parity" : rec.src, pairs: rec.n,
  };
}
