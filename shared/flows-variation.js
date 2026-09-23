export const PUT_TO_DEALER = Object.freeze({ gamma: 1, delta: -1, vanna: -1, charm: -1 });

export const VARIATION_LINES = Object.freeze({
  MIN_IV_CHANGES: 20,
  IV_GAP_DAYS: 4,
  MIN_KC_NAMES: 30,
  KC_IQR_MAX: 0.6,
  KC_DTE_MIN: 2,
  KC_DTE_MAX: 11,
  PROBE_DTE_MAX: 11,
  PROBE_SHARE: 0.85,
  PROBE_MIN_ROWS: 20,
  PROBE_PLUS_PLUS: 0.05,
  UNIT_MIN_SPOT: 40,
  UNIT_MIN_NAMES: 5,
  UNIT_MAJORITY: 2 / 3,
  VANNA_AGREE: 0.25,
  VANNA_MIN_NAMES: 3,
  ADV_SESSIONS: 20,
  ADV_MIN: 10,
  RV_WINDOW: 21,
  TRADING_YEAR: 252,
  LINEAR_MOVE: 0.05,
  DRIFT_SD: 1,
  BOOK_STRONG: 0.2,
  RATE: 0.04,
});

export const VARIATION_VOTES = false;

export const DEALER_ASSUMPTION =
  "dealer-signed under the vendor's convention (dealers long every call, short every put)";

export const VARIATION_STATEMENTS = Object.freeze({
  firstOrder:
    "First order: each channel is a slope. Gamma is the change in dealer delta per one-sigma " +
    "spot move with speed ignored, vanna per vol point with no second-order vol term, and " +
    "charm the drift over the session with spot and volatility held where they closed.",
  parallelShift:
    "Parallel shift: one vol move is applied to every expiry at once, including the far " +
    "months, although a 30-day implied volatility moves more than a two-year one.",
  linear:
    "Linear approximation: rows whose price is five percent or more from spot sit outside the " +
    "range a first-order gamma describes, and they are marked as such.",
  spot:
    "Spot is the run's own price, which can be a session later than the greeks it multiplies.",
  bookAndFlow:
    "The open-interest book assumes dealers are long every call and short every put; the " +
    "flow ladder signs each trade by its aggressor. The two assumptions disagree about the " +
    "same contracts, so they are published side by side and never added.",
});

export const SILENCE_KINDS = Object.freeze(["pending", "unreadable", "quiet", "unavailable"]);

const fin = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DAY_MS = 86400000;
const dayMs = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)
  ? Date.parse(d.slice(0, 10) + "T00:00:00Z") : NaN);
const isoDay = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const round = (v, digits) => (v === null || v === undefined || !Number.isFinite(v)
  ? null : Number(v.toFixed(digits)));
const dollars = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v));

export function daysBetween(fromDay, toDay) {
  const a = dayMs(fromDay), b = dayMs(toDay);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / DAY_MS) : null;
}

export function medianOf(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function quantileOf(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const h = (xs.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}

function sampleSd(xs) {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

function pearsonOf(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let s = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    s += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? s / Math.sqrt(da * db) : null;
}

const SQRT2PI = Math.sqrt(2 * Math.PI);
export function normPdf(x) { return Math.exp(-0.5 * x * x) / SQRT2PI; }
export function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.5 * z);
  const erfc = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 +
    t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 +
    t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? 1 - erfc / 2 : erfc / 2;
}

export function blackScholesGreeks({ spot, strike, days, vol, rate = 0, type = "C" }) {
  const S = fin(spot), K = fin(strike), d = fin(days), s = fin(vol), r = fin(rate) ?? 0;
  if (!(S > 0) || !(K > 0) || !(d > 0) || !(s > 0)) return null;
  const tau = d / 365;
  const sq = Math.sqrt(tau);
  const d1 = (Math.log(S / K) + (r + 0.5 * s * s) * tau) / (s * sq);
  const d2 = d1 - s * sq;
  const pdf = normPdf(d1);
  const call = type !== "P";
  const charmYear = -pdf * (2 * r * tau - d2 * s * sq) / (2 * tau * s * sq);
  return {
    delta: call ? normCdf(d1) : normCdf(d1) - 1,
    gamma: pdf / (S * s * sq),
    vanna: -pdf * d2 / s,
    charmPerDay: charmYear / 365,
    d1, d2,
  };
}

export function nextSessionAfter(sessionDate) {
  const t = dayMs(sessionDate);
  if (!Number.isFinite(t)) return null;
  for (let h = 1; h <= 7; h++) {
    const dow = new Date(t + h * DAY_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      return { date: new Date(t + h * DAY_MS).toISOString().slice(0, 10), h,
        rule: "the next weekday; the pipeline holds no holiday calendar" };
    }
  }
  return null;
}

const LEG = {
  gamma: ["call_gex", "call_gamma", "put_gex", "put_gamma"],
  delta: ["call_delta", "call_dex", "put_delta", "put_dex"],
  vanna: ["call_vanna", "call_vex", "put_vanna", "put_vex"],
  charm: ["call_charm", "call_cex", "put_charm", "put_cex"],
};
const pickLeg = (row, a, b) => fin(row[a] ?? row[b]);
export function vendorLegs(row, greek) {
  const k = LEG[greek];
  if (!row || !k) return { call: null, put: null };
  return { call: pickLeg(row, k[0], k[1]), put: pickLeg(row, k[2], k[3]) };
}

function expiryDte(row, asOf) {
  const e = isoDay(row && row.expiry);
  if (!e) return null;
  if (asOf) return daysBetween(asOf, e);
  return fin(row.dte);
}

export function conventionProbe(names, { asOf = null, dteMax = VARIATION_LINES.PROBE_DTE_MAX } = {}) {
  const tally = () => ({ opposite: 0, same: 0, plusPlus: 0, oppositeRows: 0, rows: 0 });
  const t = { call: tally(), put: tally() };
  for (const name of Array.isArray(names) ? names : []) {
    const at = name && (name.asOf || asOf);
    for (const row of (name && Array.isArray(name.rows) ? name.rows : [])) {
      const dte = expiryDte(row, at);
      if (dte === null || dte < 1 || dte > dteMax) continue;
      const vn = vendorLegs(row, "vanna"), ch = vendorLegs(row, "charm");
      for (const leg of ["call", "put"]) {
        const v = vn[leg], c = ch[leg];
        if (v === null || c === null || v === 0 || c === 0) continue;
        const w = Math.abs(c);
        const x = t[leg];
        x.rows++;
        if (Math.sign(v) !== Math.sign(c)) { x.opposite += w; x.oppositeRows++; }
        else { x.same += w; if (v > 0) x.plusPlus += w; }
      }
    }
  }
  const L = VARIATION_LINES;
  const verdict = (x) => {
    const total = x.opposite + x.same;
    if (x.rows < L.PROBE_MIN_ROWS || !(total > 0)) return "undetermined";
    if (x.opposite / total >= L.PROBE_SHARE) return "raw";
    if (x.same / total >= L.PROBE_SHARE && x.plusPlus / total >= L.PROBE_PLUS_PLUS) return "negated";
    return "undetermined";
  };
  const share = (x) => (x.opposite + x.same > 0 ? round(x.opposite / (x.opposite + x.same), 4) : null);
  return {
    call: verdict(t.call),
    put: verdict(t.put),
    oppositeShare: { call: share(t.call), put: share(t.put) },
    countShare: {
      call: t.call.rows ? round(t.call.oppositeRows / t.call.rows, 4) : null,
      put: t.put.rows ? round(t.put.oppositeRows / t.put.rows, 4) : null,
    },
    plusPlusShare: {
      call: t.call.opposite + t.call.same > 0 ? round(t.call.plusPlus / (t.call.opposite + t.call.same), 4) : null,
      put: t.put.opposite + t.put.same > 0 ? round(t.put.plusPlus / (t.put.opposite + t.put.same), 4) : null,
    },
    rows: { call: t.call.rows, put: t.put.rows },
    weight: "|charm|, pooled across every name",
    dteMax,
  };
}

export function putMultipliers(probe) {
  const p = probe && typeof probe === "object" ? probe : null;
  if (!p) return { ...PUT_TO_DEALER, source: "the vendor's documented convention; no probe ran" };
  const callOk = p.call === "raw";
  return {
    gamma: PUT_TO_DEALER.gamma,
    delta: PUT_TO_DEALER.delta,
    vanna: callOk && (p.put === "raw" || p.put === "negated") ? PUT_TO_DEALER.vanna : null,
    charm: !callOk ? null : p.put === "raw" ? PUT_TO_DEALER.charm : p.put === "negated" ? 1 : null,
    source: "the run's convention probe",
  };
}

export function estimateKc(names, { asOf = null } = {}) {
  const L = VARIATION_LINES;
  const ks = [];
  for (const name of Array.isArray(names) ? names : []) {
    if (!name) continue;
    const at = name.asOf || asOf;
    const termBy = new Map();
    for (const tr of Array.isArray(name.term) ? name.term : []) {
      const e = isoDay(tr && tr.expiry), v = fin(tr && tr.vol);
      if (e && v !== null && v > 0) termBy.set(e, v);
    }
    const fallback = fin(name.iv30);
    for (const row of Array.isArray(name.rows) ? name.rows : []) {
      const dte = expiryDte(row, at);
      if (dte === null || dte < L.KC_DTE_MIN || dte > L.KC_DTE_MAX) continue;
      const vn = vendorLegs(row, "vanna").call, ch = vendorLegs(row, "charm").call;
      if (vn === null || ch === null || !(vn > 0) || !(ch < 0)) continue;
      const sigma = termBy.get(isoDay(row.expiry)) ?? fallback;
      if (!(sigma > 0)) continue;
      const k = (ch / vn) / (-sigma / (2 * dte));
      if (Number.isFinite(k) && k > 0) ks.push(k);
    }
  }
  const n = ks.length;
  const value = medianOf(ks);
  const q1 = quantileOf(ks, 0.25), q3 = quantileOf(ks, 0.75);
  const iqrRatio = value && q1 !== null && q3 !== null ? (q3 - q1) / value : null;
  const base = { value: round(value, 3), n, q1: round(q1, 3), q3: round(q3, 3), iqrRatio: round(iqrRatio, 3),
    rule: `median over every name's expiries with ${L.KC_DTE_MIN} to ${L.KC_DTE_MAX} days left, ` +
      "call vanna above zero and call charm below it" };
  if (n < L.MIN_KC_NAMES) {
    return { ...base, status: "unavailable",
      reason: `${n} expiry reading${n === 1 ? "" : "s"} in the window; the charm scale needs ${L.MIN_KC_NAMES}` };
  }
  if (!(iqrRatio <= L.KC_IQR_MAX)) {
    return { ...base, status: "unavailable",
      reason: `the readings disagree: their interquartile range is ${round(iqrRatio * 100, 0)}% of the median, over the ${L.KC_IQR_MAX * 100}% line` };
  }
  return { ...base, status: "ok" };
}

export function unitFamily(pairs) {
  const L = VARIATION_LINES;
  let share = 0, pct = 0;
  const logs = [];
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const S = fin(p && p.spot), oi = fin(p && p.callGammaOi), gex = fin(p && p.callGex);
    if (!(S >= L.UNIT_MIN_SPOT) || !(oi > 0) || !(gex > 0)) continue;
    const ratio = oi / gex;
    const dShare = Math.abs(Math.log(ratio / (0.01 * S * S)));
    const dPct = Math.abs(Math.log(ratio));
    if (dShare < dPct) share++; else pct++;
    logs.push(Math.log(ratio / (0.01 * S * S)));
  }
  const n = share + pct;
  const family = n < L.UNIT_MIN_NAMES ? "unresolved"
    : share / n >= L.UNIT_MAJORITY ? "share"
    : pct / n >= L.UNIT_MAJORITY ? "pct$"
    : "unresolved";
  const med = medianOf(logs);
  return {
    family, n, share, pct,
    medianShareRatio: med === null ? null : round(Math.exp(med), 3),
    minSpot: L.UNIT_MIN_SPOT,
    used: family === "pct$" ? "pct$" : "share",
    source: family === "unresolved"
      ? "the vendor's documented share unit; the probe could not classify enough names"
      : family === "share" ? "the vendor's documented share unit, confirmed by the probe"
      : "the probe found dollars per 1% move, against the vendor's documentation",
  };
}

export function chainCallVanna(rows, { spot, asOf, expiry, rate = VARIATION_LINES.RATE } = {}) {
  const S = fin(spot);
  const e = isoDay(expiry);
  if (!(S > 0) || !e || !asOf) return null;
  const days = daysBetween(asOf, e);
  if (!(days > 0)) return null;
  let value = 0, contracts = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.type !== "C" || isoDay(r.expiry) !== e) continue;
    let iv = fin(r.iv);
    const oi = fin(r.oi), K = fin(r.strike);
    if (iv === null || oi === null || K === null || !(oi > 0) || !(iv > 0)) continue;
    if (iv > 3) iv /= 100;
    const g = blackScholesGreeks({ spot: S, strike: K, days, vol: iv, rate, type: "C" });
    if (!g) continue;
    value += g.vanna * oi * 100;
    contracts++;
  }
  return contracts ? { value, contracts, expiry: e, days } : null;
}

export function vannaScale(samples) {
  const L = VARIATION_LINES;
  const ratios = [];
  for (const s of Array.isArray(samples) ? samples : []) {
    const v = fin(s && s.vendor), m = fin(s && s.model);
    if (v === null || m === null || !(m > 0) || !(v > 0)) continue;
    ratios.push(v / m);
  }
  const n = ratios.length;
  const ratio = medianOf(ratios);
  if (n < L.VANNA_MIN_NAMES) {
    return { status: "unmeasured", ratio: round(ratio, 4), n,
      reason: `${n} name${n === 1 ? "" : "s"} carried a complete single-expiry chain to check the vendor's vanna against; the check needs ${L.VANNA_MIN_NAMES}` };
  }
  const agree = Math.abs(ratio - 1) <= L.VANNA_AGREE;
  return {
    status: agree ? "agree" : "disagree", ratio: round(ratio, 4), n,
    ...(agree ? {} : { reason: `the vendor's vanna is ${round(ratio, 2)} times the Black-Scholes vanna of the same chain, outside the ${L.VANNA_AGREE * 100}% band` }),
  };
}

export function dealerNets(expiryRows, { asOf = null, h = 1, multipliers = PUT_TO_DEALER, cap = null } = {}) {
  const rows = (Array.isArray(expiryRows) ? expiryRows : []).filter((r) => r && isoDay(r.expiry));
  const front = Math.max(h, 1);
  const sum = () => ({ call: 0, put: 0, rows: 0, halfLegs: 0 });
  const acc = { gamma: sum(), delta: sum(), vanna: sum(), charm: sum() };
  const gross = { gamma: 0 };
  const charmFront = { expiries: 0, call: 0, put: 0 };
  const rollOff = { expiries: 0, call: 0, put: 0 };
  let live = 0, seen = 0;
  const sorted = rows.slice().sort((a, b) => (isoDay(a.expiry) < isoDay(b.expiry) ? -1 : 1));
  const kept = cap === null ? sorted : sorted.slice(0, cap);
  for (const row of kept) {
    const dte = expiryDte(row, asOf);
    if (dte === null) continue;
    seen++;
    if (dte < h) {
      const d = vendorLegs(row, "delta");
      if (d.call !== null || d.put !== null) {
        rollOff.expiries++;
        rollOff.call += d.call ?? 0;
        rollOff.put += d.put ?? 0;
      }
      continue;
    }
    live++;
    for (const greek of ["gamma", "delta", "vanna", "charm"]) {
      const g = vendorLegs(row, greek);
      if (g.call === null && g.put === null) continue;
      if (greek === "charm" && dte <= front) {
        charmFront.expiries++;
        charmFront.call += g.call ?? 0;
        charmFront.put += g.put ?? 0;
        continue;
      }
      const a = acc[greek];
      a.call += g.call ?? 0;
      a.put += g.put ?? 0;
      a.rows++;
      if (g.call === null || g.put === null) a.halfLegs++;
      if (greek === "gamma") gross.gamma += Math.abs(g.call ?? 0) + Math.abs(g.put ?? 0);
    }
  }
  const net = (greek) => {
    const a = acc[greek];
    const m = multipliers ? multipliers[greek] : null;
    if (!a.rows || m === null || m === undefined) return null;
    return a.call + m * a.put;
  };
  const md = multipliers ? multipliers.delta : null;
  const mc = multipliers ? multipliers.charm : null;
  return {
    gamma: net("gamma"), delta: net("delta"), vanna: net("vanna"), charm: net("charm"),
    gammaGross: acc.gamma.rows ? gross.gamma : null,
    legs: Object.fromEntries(Object.entries(acc).map(([k, a]) =>
      [k, { call: a.call, put: a.put, expiries: a.rows, halfLegs: a.halfLegs }])),
    charmFront: charmFront.expiries
      ? { expiries: charmFront.expiries, value: mc === null || mc === undefined ? null : charmFront.call + mc * charmFront.put }
      : null,
    rollOff: rollOff.expiries
      ? { expiries: rollOff.expiries, delta: md === null || md === undefined ? null : rollOff.call + md * rollOff.put }
      : null,
    expiries: { live, seen, read: rows.length },
    h, front,
  };
}

export function cardNets(card, { h = 1, multipliers = PUT_TO_DEALER } = {}) {
  const P = card && card.panels ? card.panels : {};
  const asRows = [];
  const byExpiry = new Map();
  const put = (key, greek) => {
    const p = P[key];
    if (!p || p.status !== "ok" || !Array.isArray(p.rows)) return;
    for (const r of p.rows) {
      const e = isoDay(r && r.expiry);
      if (!e) continue;
      const row = byExpiry.get(e) || { expiry: e, dte: fin(r.dte) };
      const k = LEG[greek];
      row[k[0]] = fin(r.call);
      row[k[2]] = fin(r.put);
      byExpiry.set(e, row);
    }
  };
  put("vanna", "vanna");
  put("charm", "charm");
  put("deltaExposure", "delta");
  for (const row of byExpiry.values()) asRows.push(row);
  const nets = dealerNets(asRows, { asOf: null, h, multipliers });
  const drawn = (key) => {
    const p = P[key];
    return p && p.status === "ok" ? { drawn: Array.isArray(p.rows) ? p.rows.length : 0, seen: fin(p.seen) } : null;
  };
  return { ...nets, gamma: null, gammaGross: null,
    fallback: { vanna: drawn("vanna"), charm: drawn("charm"), delta: drawn("deltaExposure") } };
}

function candleRows(candles, sessionDate) {
  const out = [];
  for (const c of Array.isArray(candles) ? candles : []) {
    if (!Array.isArray(c)) continue;
    const d = isoDay(c[0]);
    if (!d || (sessionDate && d > sessionDate)) continue;
    const close = fin(c[4]);
    if (close === null || !(close > 0)) continue;
    out.push({ d, close, volume: fin(c[5]) });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out;
}

export function realizedFromCloses(closes, window = VARIATION_LINES.RV_WINDOW) {
  const xs = closes.filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < window + 1) return null;
  const rets = [];
  for (let i = xs.length - window; i < xs.length; i++) rets.push(Math.log(xs[i] / xs[i - 1]));
  const s = sampleSd(rets);
  return s === null ? null : s * Math.sqrt(VARIATION_LINES.TRADING_YEAR);
}

export function sessionSigma({ garch = null, candles = null, closes = null, closeDates = null, iv30 = null, sessionDate = null } = {}) {
  const L = VARIATION_LINES;
  const root = Math.sqrt(L.TRADING_YEAR);
  const implied = fin(iv30) !== null && iv30 > 0 ? round(iv30 / root, 6) : null;
  const g = garch && typeof garch === "object" ? garch : null;
  let garchWhy = null;
  if (g && g.status === "ok" && fin(g.nextVol) !== null && g.nextVol > 0) {
    const dates = Array.isArray(g.dates) ? g.dates : [];
    const last = dates.length ? isoDay(dates[dates.length - 1]) : null;
    if (g.converged === false) garchWhy = "the GARCH fit did not converge";
    else if (g.dist !== "skewt") garchWhy = "the GARCH fit predates the skewed-t innovations";
    else if (!last) garchWhy = "the GARCH fit carries no dates to show where its window ends";
    else if (sessionDate && last > sessionDate) garchWhy = `the GARCH fit includes a bar dated ${last}, after the session`;
    else {
      return { daily: round(g.nextVol / 100 / root, 6), annual: round(g.nextVol / 100, 6), source: "garch",
        implied, why: null };
    }
  }
  let series = candleRows(candles, sessionDate).map((r) => r.close);
  if (series.length < L.RV_WINDOW + 1 && Array.isArray(closes) && Array.isArray(closeDates)) {
    const kept = [];
    for (let i = 0; i < closes.length; i++) {
      const d = isoDay(closeDates[i]);
      const c = fin(closes[i]);
      if (!d || c === null || !(c > 0) || (sessionDate && d > sessionDate)) continue;
      kept.push(c);
    }
    if (kept.length > series.length) series = kept;
  }
  const rv = realizedFromCloses(series);
  if (rv !== null && rv > 0) {
    return { daily: round(rv / root, 6), annual: round(rv, 6), source: "realized", implied,
      why: garchWhy || (g ? null : "no GARCH fit on the card") };
  }
  return { daily: null, annual: null, source: null, implied,
    reason: "no converged GARCH level and no realized volatility from closes dated on or before the session" };
}

export function volOfVol(rows, sessionDate) {
  const L = VARIATION_LINES;
  const asc = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ d: isoDay(r && r.date), vol: fin(r && r.vol), close: fin(r && r.close) }))
    .filter((r) => r.d && r.vol !== null && r.close !== null && r.close > 0 && (!sessionDate || r.d <= sessionDate))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  const dv = [], dr = [];
  for (let i = 1; i < asc.length; i++) {
    const gap = daysBetween(asc[i - 1].d, asc[i].d);
    if (gap === null || gap < 1 || gap > L.IV_GAP_DAYS) continue;
    dv.push(100 * (asc[i].vol - asc[i - 1].vol));
    dr.push(Math.log(asc[i].close / asc[i - 1].close));
  }
  const n = dv.length;
  if (n < L.MIN_IV_CHANGES) {
    return { sigmaV: null, rho: null, n,
      reason: `${n} daily implied-volatility change${n === 1 ? "" : "s"} on the card; a vol-of-vol needs ${L.MIN_IV_CHANGES}` };
  }
  return { sigmaV: round(sampleSd(dv), 6), rho: round(pearsonOf(dv, dr), 6), n };
}

export function typicalDollarVolume(candles, sessionDate) {
  const L = VARIATION_LINES;
  const rows = candleRows(candles, sessionDate)
    .filter((r) => r.volume !== null && r.volume > 0)
    .slice(-L.ADV_SESSIONS);
  if (rows.length < L.ADV_MIN) {
    return { adv: null, sessions: rows.length,
      reason: `${rows.length} session${rows.length === 1 ? "" : "s"} with volume dated on or before the session; a typical day needs ${L.ADV_MIN}` };
  }
  return { adv: dollars(medianOf(rows.map((r) => r.close * r.volume))), sessions: rows.length };
}

export function cardVariationInput(card, { expiries = null } = {}) {
  const c = card && typeof card === "object" ? card : {};
  const P = c.panels && typeof c.panels === "object" ? c.panels : {};
  const ctx = P.context && P.context.status === "ok" ? P.context : {};
  const pm = P.pricedMove && P.pricedMove.status === "ok" ? P.pricedMove : {};
  const lv = P.levels && P.levels.status === "ok" ? P.levels : {};
  const vc = P.volContext && P.volContext.status === "ok" ? P.volContext : null;
  const regime = c.regime && typeof c.regime === "object" ? c.regime : {};
  return {
    ticker: typeof c.ticker === "string" ? c.ticker : null,
    sessionDate: isoDay(c.sessionDate),
    spot: fin(lv.spot) ?? fin(pm.spot),
    iv30: fin(pm.iv30),
    gammaFlow: fin(regime.flowGamma) ?? fin(regime.netGamma),
    gammaBookRaw: fin(regime.bookGammaRaw),
    candles: Array.isArray(ctx.candles) ? ctx.candles : null,
    closes: Array.isArray(ctx.closes) ? ctx.closes : null,
    closeDates: Array.isArray(ctx.closeDates) ? ctx.closeDates : null,
    garch: ctx.garch || null,
    ivRankRows: vc && vc.ivRank && Array.isArray(vc.ivRank.rows) ? vc.ivRank.rows : null,
    expiries: Array.isArray(expiries) ? expiries : null,
    card: c,
  };
}

const signWord = (flow) => (flow > 0 ? "buy" : "sell");

function sayer() {
  const n = {};
  const pin = (key, value, digits) => {
    const shown = Number(value.toFixed(digits));
    n[key] = shown;
    return value.toFixed(digits);
  };
  const money = (key, v) => {
    const m = Math.abs(v);
    if (m >= 1e9) return "$" + pin(key, m / 1e9, 2) + "B";
    if (m >= 1e6) return "$" + pin(key, m / 1e6, 2) + "M";
    if (m >= 1e3) return "$" + pin(key, m / 1e3, 1) + "k";
    return "$" + pin(key, m, 2);
  };
  const pct = (key, frac) => pin(key, Math.abs(frac) * 100, 2) + "%";
  const whole = (key, v) => pin(key, v, 0);
  return { n, pin, money, pct, whole };
}

export function variation(input, opts = {}) {
  const L = VARIATION_LINES;
  const x = input && typeof input === "object" ? input : {};
  const sessionDate = isoDay(x.sessionDate);
  const next = opts.next || nextSessionAfter(sessionDate) || { date: null, h: 1, rule: "one calendar day, no session date on the card" };
  const h = fin(opts.h) ?? next.h;
  const probe = opts.probe || null;
  const mult = putMultipliers(probe);
  const kc = opts.kc && typeof opts.kc === "object" ? opts.kc : null;
  const unit = opts.unit && typeof opts.unit === "object" ? opts.unit
    : { family: "unresolved", used: "share", source: "the vendor's documented share unit; no probe ran" };
  const scale = opts.vannaScale && typeof opts.vannaScale === "object" ? opts.vannaScale
    : { status: "unmeasured", ratio: null, n: 0, reason: "no chain check ran for this card" };
  const S = fin(x.spot);
  const silences = [];
  const silent = (channel, kind, code, reason) => silences.push({ channel, kind, code, reason });

  let nets, netsSource;
  if (Array.isArray(x.expiries) && x.expiries.length) {
    nets = dealerNets(x.expiries, { asOf: sessionDate, h, multipliers: mult });
    netsSource = "every expiry the vendor published, before the drawn ladder's cap";
  } else if (x.card) {
    nets = cardNets(x.card, { h, multipliers: mult });
    const f = nets.fallback || {};
    const d = f.vanna || f.charm || f.delta;
    netsSource = d ? `the card's drawn ladder: ${d.drawn}${d.seen !== null && d.seen !== d.drawn ? " of " + d.seen : ""} expiries` : "no expiry ladder on the card";
  } else {
    nets = dealerNets([], { asOf: sessionDate, h, multipliers: mult });
    netsSource = "no expiry ladder";
  }

  const family = unit.used === "pct$" ? "pct$" : "share";
  const toDollars = (v) => (v === null || S === null ? null : family === "pct$" ? v * 100 : v * S);
  const gammaPerPct = (g) => (g === null || S === null ? null : family === "pct$" ? g : g * S * S / 100);

  const gBookRaw = nets.gamma !== null ? nets.gamma : fin(x.gammaBookRaw);
  const gBook = gammaPerPct(gBookRaw);
  const gBookGross = nets.gammaGross !== null ? gammaPerPct(nets.gammaGross) : null;
  const gFlow = fin(x.gammaFlow);

  const sigma = sessionSigma({ garch: x.garch, candles: x.candles, closes: x.closes, closeDates: x.closeDates,
    iv30: x.iv30, sessionDate });
  const vov = volOfVol(x.ivRankRows, sessionDate);
  const adv = typicalDollarVolume(x.candles, sessionDate);
  const A = adv.adv;
  const ofAdv = (v) => (v === null || !(A > 0) ? null : round(v / A, 6));

  const gammaSource = gBook !== null ? "book" : gFlow !== null ? "flow" : null;
  const gUsed = gammaSource === "book" ? gBook : gammaSource === "flow" ? gFlow : null;

  const conventions = {
    putToDealer: { gamma: mult.gamma, delta: mult.delta, vanna: mult.vanna, charm: mult.charm },
    dealer: DEALER_ASSUMPTION,
    probe: probe ? { call: probe.call, put: probe.put, oppositeShare: probe.oppositeShare, rows: probe.rows } : null,
    kc: kc ? { value: kc.value, n: kc.n, iqrRatio: kc.iqrRatio, status: kc.status } : null,
    unit: { family: unit.family, used: family, n: fin(unit.n), source: unit.source || null },
    vannaScale: { status: scale.status, ratio: fin(scale.ratio), n: fin(scale.n) },
    sigma: sigma.source,
    horizon: { h, nextSession: next.date || null, rule: next.rule || null },
    nets: netsSource,
    statements: VARIATION_STATEMENTS,
  };

  const inputs = {
    spot: S,
    sigmaDaily: sigma.daily,
    sigmaAnnual: sigma.annual,
    sigmaSource: sigma.source,
    sigmaDollars: sigma.daily !== null && S !== null ? round(sigma.daily * S, 4) : null,
    impliedDaily: sigma.implied,
    sigmaV: vov.sigmaV,
    rho: vov.rho,
    ivChanges: vov.n,
    iv30: fin(x.iv30),
    adv: A,
    advSessions: adv.sessions,
    gammaBook: dollars(gBook),
    gammaBookGross: dollars(gBookGross),
    gammaFlow: dollars(gFlow),
    deltaNet: nets.delta === null ? null : round(nets.delta, 2),
    vannaNet: nets.vanna === null ? null : round(nets.vanna, 2),
    charmNet: nets.charm === null ? null : round(nets.charm, 2),
    deltaDollars: dollars(toDollars(nets.delta)),
    expiries: nets.expiries,
    charmFront: nets.charmFront,
    rollOff: nets.rollOff ? { expiries: nets.rollOff.expiries, delta: nets.rollOff.delta === null ? null : round(nets.rollOff.delta, 2),
      dollars: dollars(toDollars(nets.rollOff.delta)),
      what: "delta held in options that expire before the next session; context, not a flow" } : null,
  };

  if (S === null || !(S > 0)) {
    return { status: "unavailable", reason: "no spot price to turn delta into dollars", asOf: sessionDate,
      inputs, conventions, silences: [{ channel: "gamma", kind: "unavailable", code: "no-spot", reason: "no spot price" }] };
  }
  if (sigma.daily === null) {
    return { status: "unavailable", reason: sigma.reason, asOf: sessionDate, inputs, conventions,
      silences: [{ channel: "gamma", kind: "unavailable", code: "no-sigma", reason: sigma.reason }] };
  }
  if (gammaSource === null) {
    const why = "neither the open-interest gamma book nor the day's flow ladder is on this card";
    return { status: "unavailable", reason: why, asOf: sessionDate, inputs, conventions,
      silences: [{ channel: "gamma", kind: "unavailable", code: "no-gamma", reason: why }] };
  }

  const a = gUsed * 100 * sigma.daily;
  const aFlow = gFlow === null ? null : gFlow * 100 * sigma.daily;
  if (gammaSource !== "book") {
    silent("book", "unavailable", "no-book", "the dealer-signed open-interest gamma book is not on this card, so the gamma channel is today's flow alone and no share of variance is drawn");
  }

  let v = null;
  if (nets.vanna === null) {
    if (mult.vanna === null) silent("vanna", "unavailable", "vanna-unnetted", "the put leg's sign convention could not be settled this run, so vanna is not netted");
    else silent("vanna", "unavailable", "vanna-absent", "no vanna leg on the expiry ladder");
  } else if (scale.status !== "agree") {
    if (scale.status === "disagree") silent("vanna", "unavailable", "vanna-disagree", scale.reason);
    else silent("vanna", "unavailable", "vanna-unchecked", "the vendor's vanna scale was not checked against a chain this run" + (scale.reason ? ": " + scale.reason : ""));
  } else if (nets.vanna === 0) {
    silent("vanna", "quiet", "vanna-zero", "vanna nets to exactly zero across the live expiries");
    v = 0;
  } else {
    v = toDollars(nets.vanna) / 100;
  }
  let b = null;
  if (v !== null && vov.sigmaV !== null) b = v * vov.sigmaV;
  else if (v !== null) silent("vannaSize", "unavailable", "few-iv-changes", vov.reason);

  let c = null;
  if (nets.charm === null) {
    if (mult.charm === null) silent("charm", "unavailable", "charm-unnetted", "the put leg's charm convention could not be settled this run, so charm is not netted");
    else silent("charm", "unavailable", "charm-absent", "no charm leg on the expiries that outlive the next session");
  } else if (!kc || kc.status !== "ok" || !(kc.value > 0)) {
    silent("charm", "unavailable", "kc-unmeasured", "the charm scale was not measured this run" + (kc && kc.reason ? ": " + kc.reason : ""));
  } else {
    c = toDollars(nets.charm) / kc.value * h;
  }
  if (A === null) silent("adv", "unavailable", "adv-short", adv.reason);

  const book = gammaSource === "book";
  const rho = vov.rho;
  let variance = null;
  if (book) {
    const bb = b === null ? 0 : b;
    const r = b === null || rho === null ? 0 : rho;
    const V = a * a + bb * bb + 2 * a * bb * r;
    const sd = Math.sqrt(Math.max(V, 0));
    variance = {
      sd: dollars(sd),
      shares: {
        gamma: V > 0 ? round(a * a / V, 6) : null,
        vanna: b === null ? null : V > 0 ? round(b * b / V, 6) : null,
        cross: b === null || rho === null ? null : V > 0 ? round(2 * a * b * rho / V, 6) : null,
      },
      driftInSd: c === null || !(sd > 0) ? null : round(c / sd, 4),
      basis: b === null ? "gamma alone: the vol channel's size is silent, so its share and the cross term are not drawn" : "gamma, vanna and their co-movement",
    };
  } else {
    silent("variance", "unavailable", "no-book", "the share of variance and the drift in standard deviations need the open-interest book, not today's flow alone");
  }

  let grid = null;
  if (book) {
    const iv30 = fin(x.iv30);
    const ks = [-2, -1, 0, 1, 2], kv = [-1, 0, 1];
    const cols = kv.map((k) => ({ kV: k,
      vol: k === 0 ? (iv30 === null ? null : round(iv30, 4))
        : vov.sigmaV === null || iv30 === null ? null : round(iv30 + k * vov.sigmaV / 100, 4) }));
    const rows = ks.map((k) => ({ kS: k, price: round(S * Math.exp(k * sigma.daily), 2),
      linear: Math.abs(k * sigma.daily) >= L.LINEAR_MOVE }));
    const cells = ks.map((kS) => kv.map((kV) => {
      if (kV !== 0 && b === null) return null;
      const flow = -(a * kS + (b === null ? 0 : b) * kV + (c === null ? 0 : c));
      return { flow: dollars(flow), pctAdv: ofAdv(flow) };
    }));
    grid = { rows, cols, cells,
      charmIncluded: c !== null,
      volSilent: b === null ? (vov.reason || "the vol channel is silent") : null };
  }

  const channels = {
    gamma: { perSigma: dollars(a), pctAdv: ofAdv(a), source: gammaSource,
      perPct: dollars(gUsed) },
    flow: aFlow === null ? null : { perSigma: dollars(aFlow), pctAdv: ofAdv(aFlow), perPct: dollars(gFlow),
      what: "gamma dealers added today, signed by aggressor" },
    vanna: v === null ? null : { perPoint: dollars(v), pctAdvPerPoint: ofAdv(v),
      perSigma: dollars(b), pctAdvPerSigma: ofAdv(b) },
    charm: c === null ? null : { perSession: dollars(c), pctAdv: ofAdv(c), hedge: dollars(-c) },
  };

  const lead = variationLead({ ticker: x.ticker, S, sigma, a, aFlow, v, b, c, vov, variance, A, book });
  const robustness = variationRobustness({ book, flow: gFlow !== null, sigma, b, c, v, kc });

  return {
    status: "ok",
    asOf: sessionDate,
    lead,
    gammaPerSigma: dollars(a),
    gammaSource,
    vannaPerPoint: dollars(v),
    charmPerSession: dollars(c),
    driftInSd: variance ? variance.driftInSd : null,
    gammaShare: variance ? variance.shares.gamma : null,
    vannaShare: variance ? variance.shares.vanna : null,
    crossShare: variance ? variance.shares.cross : null,
    sigmaSource: sigma.source,
    advPct: c === null || !(A > 0) ? null : round(c / A * 100, 4),
    robustness,
    inputs, channels, variance, grid, silences, conventions,
  };
}

function variationRobustness({ book, flow, sigma, b, c, v }) {
  if (!book && !flow) return { r: 0, why: "no gamma on the card" };
  if (!book) return { r: 1, why: "only the gamma dealers added today; the open-interest book is not on this card" };
  const gaps = [];
  if (sigma.source !== "garch") gaps.push("the spot sigma is realized, not a converged skewed-t GARCH level");
  if (v === null) gaps.push("vanna is silent");
  else if (b === null) gaps.push("the size of a typical vol move is silent");
  if (c === null) gaps.push("charm is silent");
  if (!flow) gaps.push("the day's flow ladder is missing");
  return gaps.length
    ? { r: 2, why: gaps.join("; ") }
    : { r: 3, why: "the book and the day's flow, a converged skewed-t sigma, a measured vol-of-vol and a measured charm scale" };
}

function variationLead({ ticker, S, sigma, a, aFlow, v, b, c, vov, variance, A, book }) {
  const T = ticker || "the stock";
  const k = sayer();
  const sigmaDollars = sigma.daily * S;
  if (!book) {
    const parts = [];
    parts.push("No open-interest book on this card, so no share of variance: today's trading added gamma worth " +
      k.money("flowPerSigma", aFlow === null ? a : aFlow) + " of hedging per one-sigma move (" +
      k.money("sigmaDollars", sigmaDollars) + ")");
    if (v !== null) parts.push("each vol point moves dealer delta " + k.money("vannaPerPoint", v));
    if (c !== null) parts.push("charm carries " + (c < 0 ? "−" : "+") + k.money("charmPerSession", c) + " of dealer delta over the session");
    return { say: parts.join("; ") + ".", n: k.n };
  }
  if (ticker) k.n.ticker = ticker;
  const spotPart = "a one-sigma rise in " + T + " (" + k.money("sigmaDollars", sigmaDollars) + ") has dealers " +
    signWord(-a) + " " + k.money("gammaPerSigma", a);
  let say;
  if (c !== null) {
    say = "Next session, time alone moves dealer hedges to " + signWord(-c) + " " + k.money("charmPerSession", c) +
      " of " + T + (A > 0 ? " (" + k.pct("charmPctAdv", c / A) + " of a typical day)" : "") + "; " + spotPart;
  } else {
    say = "Next session, " + spotPart;
  }
  if (b !== null) {
    const sh = variance.shares;
    say += ", a one-sigma vol move " + k.money("vannaPerSigma", b) + " — by share of the variance, spot " + k.whole("gammaSharePct", sh.gamma * 100) +
      "%, volatility " + k.whole("vannaSharePct", sh.vanna * 100) + "%, their co-movement " +
      (sh.cross < 0 ? "−" : "") + k.whole("crossSharePct", Math.abs(sh.cross) * 100) + "%" +
      (sh.cross < 0 ? ": the two channels offset each other, so the parts exceed the whole." : ".");
  } else if (v !== null) {
    say += "; each vol point moves it " + k.money("vannaPerPoint", v) + ", but the card carries " + k.whole("ivChanges", vov.n) +
      " daily implied-volatility change" + (vov.n === 1 ? "" : "s") + ", too few to say how large a typical vol move is.";
  } else {
    say += "; the vol channel is silent on this card.";
  }
  if (variance && variance.driftInSd !== null) {
    say += " The time drift is " + k.pin("driftInSd", Math.abs(variance.driftInSd), 1) + " sd of the random part.";
  }
  return { say, n: k.n };
}

export function variationSummary(panel) {
  const p = panel && typeof panel === "object" ? panel : null;
  if (!p || p.status !== "ok") {
    const code = p && Array.isArray(p.silences) && p.silences[0] ? p.silences[0].code : "no-panel";
    return { gammaPerSigmaPctAdv: null, charmPctAdv: null, vannaPerPointPctAdv: null, driftInSd: null,
      gammaSource: null, why: { all: code } };
  }
  const ch = p.channels || {};
  const why = {};
  const codeOf = (...channels) => {
    for (const channel of channels) {
      const s = (p.silences || []).find((q) => q.channel === channel);
      if (s) return s.code;
    }
    return null;
  };
  const g = ch.gamma && fin(ch.gamma.pctAdv) !== null ? ch.gamma.pctAdv : null;
  if (g === null) why.gammaPerSigmaPctAdv = codeOf("adv") || "adv-short";
  const cc = ch.charm && fin(ch.charm.pctAdv) !== null ? ch.charm.pctAdv : null;
  if (cc === null) why.charmPctAdv = codeOf("charm", "adv") || "adv-short";
  const vv = ch.vanna && fin(ch.vanna.pctAdvPerPoint) !== null ? ch.vanna.pctAdvPerPoint : null;
  if (vv === null) why.vannaPerPointPctAdv = codeOf("vanna", "adv") || "adv-short";
  const d = p.variance && fin(p.variance.driftInSd) !== null ? p.variance.driftInSd : null;
  if (d === null) why.driftInSd = codeOf("variance", "charm") || "no-drift";
  return {
    gammaPerSigmaPctAdv: g, charmPctAdv: cc, vannaPerPointPctAdv: vv, driftInSd: d,
    gammaSource: p.gammaSource || null,
    ...(Object.keys(why).length ? { why } : {}),
  };
}

export const VARIATION_CODES = Object.freeze({
  "no-panel": "no hedging panel was built for this name",
  "no-spot": "no spot price to turn delta into dollars",
  "no-sigma": "no converged GARCH level and no realized volatility from closes dated on or before the session",
  "no-gamma": "neither the open-interest gamma book nor the day's flow ladder is on the card",
  "no-book": "the open-interest gamma book is not on the card, so no share of variance and no drift in standard deviations",
  "vanna-unnetted": "the put leg's sign convention could not be settled this run, so vanna is not netted",
  "vanna-absent": "no vanna leg on the expiry ladder",
  "vanna-unchecked": "the vendor's vanna scale was not checked against an option chain this run",
  "vanna-disagree": "the vendor's vanna disagrees with the Black-Scholes vanna of the same chain by more than a quarter",
  "vanna-zero": "vanna nets to exactly zero across the live expiries",
  "few-iv-changes": "too few daily implied-volatility changes to size a typical vol move",
  "charm-unnetted": "the put leg's charm convention could not be settled this run, so charm is not netted",
  "charm-absent": "no charm leg on the expiries that outlive the next session",
  "kc-unmeasured": "the charm scale was not measured this run",
  "adv-short": "too few dated sessions with volume to name a typical day",
  "no-drift": "no drift reading",
});

export function scoreVarianceShares(cols, weights, gate, residual, { families = null } = {}) {
  const names = Object.keys(cols || {});
  const n = Array.isArray(residual) ? residual.length : 0;
  if (!n || !names.length) return null;
  const fam = families || {};
  const live = (col) => {
    const xs = (col || []).filter(Number.isFinite);
    return xs.length >= 2 && xs.some((v) => v !== xs[0]);
  };
  const liveBy = {};
  for (const k of names) {
    const f = fam[k];
    if (!f) continue;
    liveBy[f] = (liveBy[f] || 0) + (live(cols[k]) ? 1 : 0);
  }
  let wTotal = 0;
  for (const f of Object.keys(weights || {})) if (Number.isFinite(weights[f])) wTotal += weights[f];
  const g = (gate || []).map((v) => (Number.isFinite(v) ? v : 0));
  const gBar = g.reduce((s, v) => s + v, 0) / n;
  const z = (v) => (Number.isFinite(v) ? v : 0);
  const omega = {};
  for (const k of names) {
    const f = fam[k];
    const w = f && Number.isFinite(weights && weights[f]) ? weights[f] : 0;
    omega[k] = wTotal > 0 && live(cols[k]) && liveBy[f] > 0 ? (w / wTotal) / liveBy[f] : 0;
  }
  const blended = new Array(n).fill(0);
  for (const k of names) for (let i = 0; i < n; i++) blended[i] += omega[k] * z(cols[k][i]);
  const r = residual.map(z);
  const rBar = r.reduce((s, v) => s + v, 0) / n;
  let varR = 0;
  for (let i = 0; i < n; i++) varR += (r[i] - rBar) * (r[i] - rBar);
  varR /= n;
  const cov = (c) => {
    const m = c.reduce((s, v) => s + v, 0) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (c[i] - m) * (r[i] - rBar);
    return s / n;
  };
  const shares = {};
  const famShares = {};
  for (const k of names) {
    const ck = cols[k].map((v) => omega[k] * gBar * z(v));
    shares[k] = varR > 0 ? round(cov(ck) / varR, 6) : null;
    const f = fam[k] || k;
    if (shares[k] !== null) famShares[f] = (famShares[f] || 0) + cov(ck) / varR;
  }
  const cg = g.map((gi, i) => (gi - gBar) * blended[i]);
  shares.gate = varR > 0 ? round(cov(cg) / varR, 6) : null;
  const bBar = blended.reduce((s, v) => s + v, 0) / n;
  let varB = 0;
  for (let i = 0; i < n; i++) varB += (blended[i] - bBar) * (blended[i] - bBar);
  varB /= n;
  const blendedFam = {};
  for (const k of names) {
    const f = fam[k] || k;
    const ck = cols[k].map((v) => omega[k] * z(v));
    const m = ck.reduce((s, v) => s + v, 0) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (ck[i] - m) * (blended[i] - bBar);
    blendedFam[f] = (blendedFam[f] || 0) + (varB > 0 ? s / n / varB : 0);
  }
  return {
    basis: "shares of the residual score's cross-sectional variance: each column's covariance with the residual over its variance, so they sum to one because the residual maker is symmetric and idempotent",
    names: n,
    columns: shares,
    families: Object.fromEntries(Object.entries(famShares).map(([k, v]) => [k, round(v, 6)])),
    gate: shares.gate,
    weights: Object.fromEntries(names.map((k) => [k, round(omega[k], 6)])),
    blended: {
      basis: "shares of the blended score's variance before the quality gate and the neutralisation",
      families: Object.fromEntries(Object.entries(blendedFam).map(([k, v]) => [k, round(v, 6)])),
    },
  };
}
