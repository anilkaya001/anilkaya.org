import { sliceFromSummary } from "../../shared/flows-quant-card.js";
import { skewMetrics, sliceVolK } from "../../shared/flows-quant-smile.js";

export const SURFACE_EXPIRIES = [
  { expiry: "2026-08-26", dte: 2, sessions: 2, method: "svi", iv0: 0.33 },
  { expiry: "2026-08-28", dte: 4, sessions: 4, method: "svi", iv0: 0.34 },
  { expiry: "2026-08-31", dte: 7, sessions: 5, method: "svi", iv0: 0.35 },
  { expiry: "2026-09-02", dte: 9, sessions: 7, method: "flat", iv0: 0.37 },
  { expiry: "2026-09-04", dte: 11, sessions: 9, method: "flat", iv0: 0.36 },
  { expiry: "2026-09-11", dte: 18, sessions: 14, method: "svi-repaired", iv0: 0.355 },
  { expiry: "2026-09-18", dte: 25, sessions: 19, method: "svi-repaired", iv0: 0.36 },
  { expiry: "2026-09-25", dte: 32, sessions: 24, method: "svi-repaired", iv0: 0.365 },
];
export const SURFACE_GAMMA_DATES = ["2026-08-26", "2026-08-28", "2026-08-31", "2026-09-02", "2026-09-04", "2026-09-09", "2026-09-11", "2026-09-18"];
const SHAPE = { rho: -0.6, m: -0.01, sigma: 0.1 };
const RATE = 0.04;

export const sviParams = (T, iv0, scale = 1) => {
  const w = iv0 * iv0 * T;
  const unit = SHAPE.rho * (0 - SHAPE.m) + Math.sqrt(SHAPE.m * SHAPE.m + SHAPE.sigma * SHAPE.sigma);
  return { a: 0, b: (scale * w) / unit, rho: SHAPE.rho, m: SHAPE.m, sigma: SHAPE.sigma };
};

export function engineExpiry(spec, S, o = {}) {
  const T = spec.dte / 365;
  const F = S * Math.exp(RATE * T);
  const e = { expiry: spec.expiry, dte: spec.dte, sessions: spec.sessions, hSessions: spec.sessions, T: Math.round(T * 1e4) / 1e4, forward: { F: Math.round(F * 1e4) / 1e4, D: Math.exp(-RATE * T), r: RATE, qImpl: 0, pairs: 9, method: "fixed-discount" } };
  if (spec.method === "flat") {
    e.smile = { method: "flat", n: 20, fitInSpread: null, rmseIvPts: null, atmIv: spec.iv0, params: { sigma: spec.iv0 }, rr25: 0, bf25: 0, checks: null };
    return e;
  }
  const params = sviParams(e.T, spec.iv0, o.scale && o.scale[spec.expiry] ? o.scale[spec.expiry] : 1);
  e.smile = { method: spec.method, n: 20, fitInSpread: 0.4, rmseIvPts: 0.5, atmIv: 0, params, rr25: 0, bf25: 0, checks: { ok: true, minG: 0.05 } };
  const slice = sliceFromSummary(e);
  const sk = skewMetrics(slice);
  e.smile.atmIv = Math.round(sliceVolK(slice, 0) * 1e4) / 1e4;
  e.smile.rr25 = Math.round(sk.rr25 * 1e4) / 1e4;
  e.smile.bf25 = Math.round(sk.bf25 * 1e4) / 1e4;
  return e;
}

export function surfaceCard(base, o = {}) {
  const c = JSON.parse(JSON.stringify(base));
  const S = c.panels.pricedMove.spot;
  const specs = o.expiries || SURFACE_EXPIRIES;
  c.engine = { v: 1, engine: "synthetic", asOf: c.sessionDate, spot: S, atr: S * 0.02, rate: RATE, expiries: specs.map((s) => engineExpiry(s, S, o)) };
  const strikes = [];
  for (let i = 0; i < 21; i++) strikes.push(Math.round(S * (0.88 + i * 0.012) * 2) / 2);
  const dates = o.gammaDates || SURFACE_GAMMA_DATES;
  const nullAt = o.nullAt || ((i, j) => (i * 7 + j * 3) % 11 === 0);
  const book = strikes.map((K, i) => dates.map((d, j) => {
    if (nullAt(i, j)) return null;
    const z = (K - S) / (S * 0.05);
    const sign = K >= S ? 1 : -1;
    return Math.round(sign * 4e6 * (1 + 0.4 * j) * Math.exp(-z * z / 2.4) * (1 + 0.15 * ((i * 5 + j) % 4)));
  }));
  c.panels.surface = { status: "ok", asOf: c.sessionDate, spot: S, lead: { say: "x", n: {} }, expiries: dates, strikes, grid: book.map((r) => r.map((v) => (v === null ? null : Math.round(v / 3)))), oi: { source: "oi", basis: "open interest", gamma: book, charm: null, vanna: null }, scaleCap: 1, peak: 1 };
  const m = [0.1, 0.05, 0, -0.05, -0.1];
  const ivExp = [{ expiry: "2026-08-26", days: 2 }, { expiry: "2026-09-18", days: 25 }];
  const at = (e, mm) => {
    const eng = c.engine.expiries.find((x) => x.expiry === e.expiry);
    const slice = sliceFromSummary(eng);
    const K = Math.round(eng.forward.F * Math.exp(mm * Math.sqrt(eng.T) * 2));
    return [K, Math.round(sliceVolK(slice, Math.log(K / eng.forward.F)) * 1e4) / 1e4];
  };
  c.panels.ivSurface = { status: "ok", ivBasis: "synthetic", step: 0.05, atmBand: 0.1, rows: m, expiries: ivExp.map((e) => ({ ...e, atmIv: 0.35, atmM: 0, atmStrike: Math.round(S), atmReason: null, fresh: 5, stale: 0, unknownAge: 0 })),
    iv: m.map((mm) => ivExp.map((e) => at(e, mm)[1])), strike: m.map((mm) => ivExp.map((e) => at(e, mm)[0])) };
  const lv = [["call_wall", 1.02], ["put_wall", 0.97], ["max_pain", 1.045], ["zero_gamma", 0.992]];
  c.panels.levels = { status: "ok", asOf: c.sessionDate, spot: S, atr: S * 0.02, levels: lv.map(([kind, f]) => ({ kind, label: kind, px: Math.round(S * f * 100) / 100, distPct: f - 1, distAtr: (f - 1) * 50 })) };
  return c;
}
