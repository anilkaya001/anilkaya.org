export function num(value, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const finite = (xs) => xs.filter((x) => Number.isFinite(x));

export function median(values) {
  const xs = finite(values).slice().sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

export function quantile(values, p) {
  const xs = finite(values).slice().sort((a, b) => a - b);
  if (!xs.length) return NaN;
  if (xs.length === 1) return xs[0];
  const h = (xs.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}

export function mad(values, center) {
  const xs = finite(values);
  if (!xs.length) return NaN;
  const m = Number.isFinite(center) ? center : median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function winsorize(values, p = 0.01) {
  const lo = quantile(values, p);
  const hi = quantile(values, 1 - p);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return values.slice();
  return values.map((x) => (Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : x));
}

export function robustZ(values, { clamp = 3 } = {}) {
  const xs = values.map((v) => (Number.isFinite(v) ? v : NaN));
  const ok = finite(xs);
  if (ok.length < 2) return xs.map(() => 0);

  const m = median(ok);

  const span = (lo, hi, c) => {
    const v = (quantile(ok, hi) - quantile(ok, lo)) / c;
    return Number.isFinite(v) ? v : 0;
  };
  let scale = Math.max(mad(ok, m), span(0.25, 0.75, 1.349), span(0.10, 0.90, 2.563));

  if (!Number.isFinite(scale) || scale <= 1e-12) {
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    const varr = ok.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, ok.length - 1);
    scale = Math.sqrt(varr);
    if (!Number.isFinite(scale) || scale <= 1e-12) return xs.map(() => 0);
    return xs.map((x) => (Number.isFinite(x) ? clampTo((x - mean) / scale, clamp) : 0));
  }
  return xs.map((x) => (Number.isFinite(x) ? clampTo((x - m) / scale, clamp) : 0));
}

function clampTo(x, c) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(Math.max(x, -c), c);
}

export function robustZFused(values, { clamp = 3, winsor = 0.02 } = {}) {
  const N = values.length;

  const buf = new Float64Array(N);
  let n = 0;
  for (let i = 0; i < N; i++) {
    const v = values[i];
    if (Number.isFinite(v)) buf[n++] = v;
  }

  if (n < 2) return new Array(N).fill(0);

  const sorted = buf.slice(0, n);
  sorted.sort();

  const qs = (p) => {
    const h = (n - 1) * Math.min(Math.max(p, 0), 1);
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
  };

  const wlo = qs(winsor);
  const whi = qs(1 - winsor);

  const clipping = Number.isFinite(wlo) && Number.isFinite(whi);
  if (clipping) {

    for (let i = 0; i < n; i++) sorted[i] = Math.min(Math.max(sorted[i], wlo), whi);
    for (let i = 0; i < n; i++) buf[i] = Math.min(Math.max(buf[i], wlo), whi);
  }

  const mid = n >> 1;
  const m = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const devs = new Float64Array(n);
  let dn = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(buf[i] - m);
    if (Number.isFinite(d)) devs[dn++] = d;
  }
  const dv = devs.subarray(0, dn);
  dv.sort();
  const dmid = dn >> 1;
  const madScale = dn === 0
    ? NaN
    : 1.4826 * (dn % 2 ? dv[dmid] : (dv[dmid - 1] + dv[dmid]) / 2);

  const span = (lo, hi, c) => {
    const v = (qs(hi) - qs(lo)) / c;
    return Number.isFinite(v) ? v : 0;
  };

  let scale = Math.max(madScale, span(0.25, 0.75, 1.349), span(0.10, 0.90, 2.563));
  let center = m;

  if (!Number.isFinite(scale) || scale <= 1e-12) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += buf[i];
    const mean = sum / n;
    let ss = 0;
    for (let i = 0; i < n; i++) { const d = buf[i] - mean; ss += d * d; }
    scale = Math.sqrt(ss / Math.max(1, n - 1));
    if (!Number.isFinite(scale) || scale <= 1e-12) return new Array(N).fill(0);
    center = mean;
  }

  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) { out[i] = 0; continue; }
    const w = clipping ? Math.min(Math.max(v, wlo), whi) : v;
    out[i] = clampTo((w - center) / scale, clamp);
  }
  return out;
}

export function invNorm(p) {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function vanDerWaerden(values) {
  const n = values.length;
  if (!n) return [];
  const idx = values.map((v, i) => [Number.isFinite(v) ? v : NaN, i])
                    .filter(([v]) => Number.isFinite(v))
                    .sort((p, q) => p[0] - q[0]);
  const out = new Array(n).fill(0);
  const m = idx.length;
  if (m < 2) return out;

  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && idx[j + 1][0] === idx[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    const z = invNorm(avgRank / (m + 1));
    for (let k = i; k <= j; k++) out[idx[k][1]] = z;
    i = j + 1;
  }
  return out;
}

export function neutralize(y, { numeric = [], groups = [], ridge = 1e-8, minGroup = 3 } = {}) {
  const n = y.length;
  if (!n) return [];

  const cols = [new Array(n).fill(1)];
  for (const c of numeric) {
    if (c.length !== n) throw new Error("neutralize: control length mismatch");
    cols.push(c.map((v) => (Number.isFinite(v) ? v : 0)));
  }
  if (groups.length === n) {

    const counts = new Map();
    for (const g of groups) {
      if (g == null || g === "") continue;
      counts.set(g, (counts.get(g) || 0) + 1);
    }
    const levels = [...counts.keys()].filter((lv) => counts.get(lv) >= minGroup).sort();

    for (const lv of levels.slice(1)) cols.push(groups.map((g) => (g === lv ? 1 : 0)));
  }

  const p = cols.length;
  const target = y.map((v) => (Number.isFinite(v) ? v : 0));
  if (p >= n) return target.slice();

  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += cols[a][i] * cols[b][i];
      XtX[a][b] = XtX[b][a] = s;
    }
    XtX[a][a] += ridge;
    let s = 0;
    for (let i = 0; i < n; i++) s += cols[a][i] * target[i];
    Xty[a] = s;
  }

  const beta = solveSymmetric(XtX, Xty);
  if (!beta) return target.slice();

  return target.map((v, i) => {
    let fit = 0;
    for (let a = 0; a < p; a++) fit += beta[a] * cols[a][i];
    return v - fit;
  });
}

function solveSymmetric(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

export function greekFlowTotals(greekFlowRows) {

  const published = Array.isArray(greekFlowRows);
  let dirNet = 0, dirAbs = 0, otmAbs = 0, vegaAbs = 0, totalAbs = 0, rows = 0;
  for (const r of published ? greekFlowRows : []) {
    const d = num(r.dir_delta_flow);
    dirNet += d;
    dirAbs += Math.abs(d);
    otmAbs += Math.abs(num(r.otm_dir_delta_flow));
    vegaAbs += Math.abs(num(r.total_vega_flow));
    totalAbs += Math.abs(num(r.total_delta_flow));
    rows++;
  }
  return {
    dirNet, dirAbs, otmAbs, vegaAbs, totalAbs, rows,
    silence: rows > 0 ? null : published ? "quiet" : "unavailable",
  };
}

function resolveTotals(greekFlowRows, given) {
  if (given && Number.isFinite(given.totalAbs)) return given;
  if (given && given.totals && Number.isFinite(given.totals.totalAbs)) return given.totals;
  return greekFlowTotals(greekFlowRows);
}

export function flowPurity(greekFlowRows, totals = null) {

  const t = resolveTotals(greekFlowRows, totals);
  if (t.totalAbs <= 0) {
    return { purity: null, dirDelta: 0, dirAbs: 0, dirShare: null, totalAbs: 0 };
  }

  return {
    purity: Math.min(1, t.dirAbs / t.totalAbs),
    dirDelta: t.dirNet,
    dirAbs: t.dirAbs,

    dirShare: Math.max(-1, Math.min(1, t.dirNet / t.totalAbs)),
    totalAbs: t.totalAbs,
  };
}

export function aggressorGamma(strikeRows, { spot = null, materiality = 0.02 } = {}) {
  const ladder = (strikeRows || [])
    .map((r) => {

      const legs = [r.call_gamma_ask, r.call_gamma_bid, r.put_gamma_ask, r.put_gamma_bid];
      const present = legs.some((v) => v !== null && v !== undefined && v !== "");
      return {
        strike: num(r.strike),
        gamma: present ? legs.reduce((a, v) => a + num(v), 0) : null,
      };
    })
    .filter((r) => Number.isFinite(r.strike) && r.strike > 0 && r.gamma !== null)
    .sort((a, b) => a.strike - b.strike);

  let cum = 0, peak = 0;
  for (const row of ladder) {
    cum += row.gamma;
    row.cum = cum;
    peak = Math.max(peak, Math.abs(cum));
  }

  const crossings = gammaCrossings(ladder, { materiality });
  const chosen = pickCrossing(crossings, spot);

  return {
    ladder,
    netGamma: cum,
    peak,
    crossings,
    flip: chosen ? chosen.strike : null,

    flipSide: chosen ? chosen.side : null,

    flipSeparation: chosen ? chosen.separation : null,

    spotGammaShare: spotGammaShare(ladder, spot, peak),
    bandMin: ladder.length ? ladder[0].strike : null,
    bandMax: ladder.length ? ladder[ladder.length - 1].strike : null,
  };
}

export function gammaCrossings(ladder, { materiality = 0.02 } = {}) {
  const rows = ladder || [];
  const n = rows.length;
  if (n < 3) return [];
  let peak = 0;
  for (const r of rows) peak = Math.max(peak, Math.abs(r.cum));
  if (!(peak > 0)) return [];

  const runs = [];
  let sign = 0, extreme = 0, startIdx = 0;
  for (let i = 0; i < n; i++) {
    const c = rows[i].cum;
    const sgn = Math.sign(c);

    if (sgn === 0) { extreme = Math.abs(c) > Math.abs(extreme) ? c : extreme; continue; }
    if (sign === 0) { sign = sgn; extreme = c; startIdx = i; continue; }
    if (sgn === sign) { if (Math.abs(c) > Math.abs(extreme)) extreme = c; continue; }
    runs.push({ sign, extreme, from: startIdx, to: i - 1 });
    sign = sgn; extreme = c; startIdx = i;
  }
  if (sign !== 0) runs.push({ sign, extreme, from: startIdx, to: n - 1 });
  if (runs.length < 2) return [];

  const floor = peak * materiality;
  const out = [];
  for (let k = 1; k < runs.length; k++) {
    const lo = runs[k - 1], hi = runs[k];

    const separation = Math.min(Math.abs(lo.extreme), Math.abs(hi.extreme));
    if (!(separation >= floor)) continue;

    const a = rows[lo.to], b = rows[hi.from];
    const span = Math.abs(a.cum) + Math.abs(b.cum);
    const strike = span > 0
      ? a.strike + (b.strike - a.strike) * (Math.abs(a.cum) / span)
      : a.strike;
    out.push({
      strike,

      side: lo.sign < 0 ? "short_below" : "long_below",
      separation: separation / peak,
    });
  }
  return out;
}

function pickCrossing(crossings, spot) {
  if (!crossings || !crossings.length) return null;
  let best = crossings[0];
  for (const c of crossings) {
    if (c.separation > best.separation) { best = c; continue; }
    if (c.separation === best.separation && spot > 0 &&
        Math.abs(c.strike - spot) < Math.abs(best.strike - spot)) best = c;
  }
  return best;
}

function spotGammaShare(ladder, spot, peak) {
  if (ladder.length < 3 || !(spot > 0) || !(peak > 0)) return null;
  const first = ladder[0], last = ladder[ladder.length - 1];
  if (spot < first.strike || spot > last.strike) return null;
  for (let i = 1; i < ladder.length; i++) {
    const a = ladder[i - 1], b = ladder[i];
    if (spot <= b.strike) {
      const span = b.strike - a.strike;
      const w = span > 0 ? (spot - a.strike) / span : 0;
      return (a.cum + w * (b.cum - a.cum)) / peak;
    }
  }
  return last.cum / peak;
}

export function gammaFlip(ladder, { spot = null, ...opts } = {}) {
  const chosen = pickCrossing(gammaCrossings(ladder, opts), spot);
  return chosen ? chosen.strike : null;
}

export function bookDisplacement(strikeRows, atr) {
  const centroid = (pick) => {
    let wsum = 0, wx = 0;
    for (const r of strikeRows || []) {
      const k = num(r.strike);
      const w = Math.abs(num(r[pick.call])) + Math.abs(num(r[pick.put]));
      if (!(k > 0) || !(w > 0)) continue;
      wsum += w; wx += k * w;
    }
    return wsum > 0 ? { c: wx / wsum, w: wsum } : null;
  };

  const oi = centroid({ call: "call_gamma_oi", put: "put_gamma_oi" });
  const vol = centroid({ call: "call_gamma_vol", put: "put_gamma_vol" });
  if (!oi || !vol || !(atr > 0)) return { displacement: 0, oiCentroid: null, volCentroid: null, weight: 0 };

  return {
    displacement: (vol.c - oi.c) / atr,
    oiCentroid: oi.c,
    volCentroid: vol.c,
    weight: vol.w,
  };
}

export function pathSignature(tickRows) {
  const rows = (tickRows || [])
    .map((r) => ({ t: Date.parse(r.tape_time), d: num(r.net_delta) }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);
  if (rows.length < 3) return { persistence: 0, concentration: 0, centroid: 0.5, net: 0, bars: rows.length };

  const steps = rows.map((r) => r.d);
  const net = steps.reduce((a, b) => a + b, 0);
  const dir = Math.sign(net) || 1;

  const withDir = steps.filter((s) => Math.sign(s) === dir).length;
  const persistence = withDir / steps.length;

  const abs = steps.map(Math.abs).sort((a, b) => b - a);
  const total = abs.reduce((a, b) => a + b, 0);
  const topN = Math.max(1, Math.ceil(abs.length * 0.05));
  const concentration = total > 0 ? abs.slice(0, topN).reduce((a, b) => a + b, 0) / total : 0;

  const span = rows[rows.length - 1].t - rows[0].t;
  let wsum = 0, wt = 0;
  for (let i = 0; i < rows.length; i++) {
    const w = Math.abs(steps[i]);
    if (w <= 0) continue;
    wsum += w;
    wt += w * (span > 0 ? (rows[i].t - rows[0].t) / span : 0.5);
  }
  const centroid = wsum > 0 ? wt / wsum : 0.5;

  return { persistence, concentration, centroid, net, bars: rows.length };
}

export function callGammaLeg(row) {
  return row ? (row.call_gex ?? row.call_gamma) : undefined;
}
export function putGammaLeg(row) {
  return row ? (row.put_gex ?? row.put_gamma) : undefined;
}

export function callVannaLeg(row) { return row ? (row.call_vanna ?? row.call_vex) : undefined; }
export function putVannaLeg(row)  { return row ? (row.put_vanna  ?? row.put_vex)  : undefined; }
export function callCharmLeg(row) { return row ? (row.call_charm ?? row.call_cex) : undefined; }
export function putCharmLeg(row)  { return row ? (row.put_charm  ?? row.put_cex)  : undefined; }
export function callDeltaLeg(row) { return row ? (row.call_delta ?? row.call_dex) : undefined; }
export function putDeltaLeg(row)  { return row ? (row.put_delta  ?? row.put_dex)  : undefined; }

export const GREEK_UNITS = Object.freeze({
  gamma: "dollar-gamma: the change in dealer dollar-delta per 1% move in spot",
  delta: "dollar-delta: the signed directional exposure dealers are carrying",
  charm: "dollar-delta per DAY: how fast that exposure decays with time alone, spot unchanged",
  vanna: "dollar-delta per VOL POINT: how much that exposure moves on a 1-point change in implied volatility, spot unchanged",
});

export function legPresent(rows, reader) {
  for (const r of (rows || [])) {
    const v = reader(r);
    if (v !== null && v !== undefined && v !== "") return true;
  }
  return false;
}

export function greekTermStructure(expiryRows, { name, callLeg, putLeg, asOf = null, cap = 12 } = {}) {
  const src = Array.isArray(expiryRows) ? expiryRows : [];
  const hasCall = legPresent(src, callLeg);
  const hasPut = legPresent(src, putLeg);
  if (!hasCall && !hasPut) {
    return {
      status: "absent",
      reason: `the vendor published no ${name} leg on this response`,
      unit: GREEK_UNITS[name] || null,
      rows: [], legs: { call: false, put: false },
    };
  }

  const base = asOf ? Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z") : NaN;

  const numOrNull = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const rows = [];
  for (const r of src) {
    if (!r || !r.expiry) continue;
    const c = hasCall ? numOrNull(callLeg(r)) : null;
    const p = hasPut ? numOrNull(putLeg(r)) : null;

    if (c === null && p === null) continue;
    const ms = Date.parse(String(r.expiry).slice(0, 10) + "T00:00:00Z");
    const sentDte = numOrNull(r.dte);
    rows.push({
      expiry: String(r.expiry).slice(0, 10),
      call: c,
      put: p,

      dte: sentDte !== null ? sentDte
        : (Number.isFinite(base) && Number.isFinite(ms) ? Math.round((ms - base) / 86400000) : null),
    });
  }
  rows.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  const kept = rows.slice(0, cap);

  const gross = kept.reduce((a, r) => a + Math.abs(r.call ?? 0) + Math.abs(r.put ?? 0), 0);

  return {
    status: kept.length ? "ok" : "quiet",
    reason: kept.length ? null : `the ${name} leg was present but no expiry carried a readable value`,
    unit: GREEK_UNITS[name] || null,

    signConvention:
      "the vendor's own sign on each leg, untouched. The put leg's convention " +
      "differs BY GREEK on this endpoint — put gamma and put charm arrive " +
      "dealer-signed against their call legs while put vanna does not — so the " +
      "two legs are never netted here and the total below is a gross size, not " +
      "a direction.",
    rows: kept,
    grossAbs: gross,
    legs: { call: hasCall, put: hasPut },
    seen: rows.length, cap, shed: Math.max(0, rows.length - kept.length),
  };
}

export function gammaDecayCalendar(expiryRows, { asOf = null } = {}) {
  const rows = (expiryRows || [])
    .map((r) => ({
      expiry: r.expiry,

      gamma: Math.abs(num(callGammaLeg(r))) + Math.abs(num(putGammaLeg(r))),
    }))
    .filter((r) => r.expiry && r.gamma > 0)
    .sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));

  const total = rows.reduce((a, r) => a + r.gamma, 0);
  if (!(total > 0)) {
    return {
      schedule: [], halfLifeExpiry: null, halfLifeDays: null,
      meanLifeDays: null, frontLoad: null,
    };
  }

  const base = asOf ? Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z") : NaN;
  const daysTo = (expiry) => {
    if (!Number.isFinite(base)) return null;
    const t = Date.parse(String(expiry).slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(t) ? Math.round((t - base) / 86400000) : null;
  };

  let cum = 0, halfLifeExpiry = null, halfLifeDays = null;
  let lifeWeighted = 0, lifeWeight = 0;
  const schedule = rows.map((r) => {
    cum += r.gamma;
    const share = r.gamma / total;
    const cumShare = cum / total;
    const days = daysTo(r.expiry);
    if (halfLifeExpiry === null && cumShare >= 0.5) {
      halfLifeExpiry = r.expiry;
      halfLifeDays = days;
    }
    if (days !== null) { lifeWeighted += days * r.gamma; lifeWeight += r.gamma; }
    return { expiry: r.expiry, share, cumShare, days };
  });

  return {
    schedule,
    halfLifeExpiry,
    halfLifeDays,
    meanLifeDays: lifeWeight > 0 ? lifeWeighted / lifeWeight : null,
    frontLoad: schedule.length ? schedule[0].share : null,
  };
}

export function positioningQuality(greekFlowRows, { floor = 1e-6, totals = null } = {}) {
  const t = resolveTotals(greekFlowRows, totals);

  return {

    otmShare: t.dirAbs > floor ? Math.min(1, t.otmAbs / t.dirAbs) : null,
    vegaTilt: t.totalAbs > floor ? t.vegaAbs / t.totalAbs : null,
    hasDirectionalView: Math.abs(t.dirNet) > floor,
  };
}

export function effectiveBreadth(columns) {

  const live = (columns || []).filter(isLiveColumn);
  const n = live.length;
  if (n === 0) return 0;
  if (n === 1) return 1;
  let sum = 0, pairs = 0;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const r = pearson(live[a], live[b]);
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
  }
  const rhoBar = pairs ? sum / pairs : 0;
  return n / (1 + (n - 1) * rhoBar);
}

export function isLiveColumn(column) {
  const xs = (column || []).filter(Number.isFinite);
  if (xs.length < 2) return false;
  const first = xs[0];
  return xs.some((v) => v !== first);
}

export function crossFamilyRedundancy(familyColumns) {
  const keys = Object.keys(familyColumns);
  const k = keys.length;
  const out = {};
  for (const key of keys) out[key] = 1;
  if (k <= 1) return out;
  for (const key of keys) {
    let sum = 0, pairs = 0;
    for (const other of keys) {
      if (other === key) continue;
      const r = pearson(familyColumns[key], familyColumns[other]);
      if (Number.isFinite(r)) { sum += Math.abs(r); pairs++; }
    }
    const rhoBar = pairs ? sum / pairs : 0;
    out[key] = 1 + (k - 1) * rhoBar;
  }
  return out;
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0, sb = 0, m = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    sa += a[i]; sb += b[i]; m++;
  }
  if (m < 2) return NaN;
  const ma = sa / m, mb = sb / m;
  let num_ = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) continue;
    const x = a[i] - ma, y = b[i] - mb;
    num_ += x * y; da += x * x; db += y * y;
  }
  if (da <= 0 || db <= 0) return NaN;
  return num_ / Math.sqrt(da * db);
}

export function calibrateScoreScale(zs, { refQuantile = 0.95, refScore = 80 } = {}) {
  const ref = quantile(zs.map(Math.abs), refQuantile);
  const target = Math.min(Math.max(refScore, 1), 99) / 100;
  if (!Number.isFinite(ref) || ref <= 1e-9) return 1;
  return Math.atanh(target) / ref;
}

export const SCORE_SCALE = Math.atanh(0.80) / 2.0;

export function percentileRank(values) {
  const xs = values || [];
  const idx = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i])) idx.push(i);
  const m = idx.length;
  const out = xs.map(() => null);
  if (!m) return out;
  if (m === 1) { out[idx[0]] = 0.5; return out; }

  idx.sort((a, b) => xs[a] - xs[b]);
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = avgRank / (m + 1);
    i = j + 1;
  }
  return out;
}

export function qualityGate(axes, { floor = 0.2 } = {}) {
  const cols = axes || [];

  const n = cols.reduce((m, c) => Math.max(m, (c || []).length), 0);
  const live = cols.filter(isLiveColumn);
  if (!live.length) return new Array(n).fill(1);

  const ranks = live.map(percentileRank);
  const out = [];
  for (let i = 0; i < n; i++) {
    let sum = 0, k = 0;
    for (const r of ranks) {
      if (r[i] === null) continue;
      sum += r[i]; k++;
    }
    out.push(k ? Math.max(floor, 2 * (sum / k)) : 1);
  }
  return out;
}

export function realizedVol(closes, { window = 30, periodsPerYear = 252 } = {}) {
  const xs = (closes || []).filter((c) => Number.isFinite(c) && c > 0);
  if (xs.length < 3) return null;
  const rets = [];
  for (let i = Math.max(1, xs.length - window); i < xs.length; i++) {
    rets.push(Math.log(xs[i] / xs[i - 1]));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  return Math.sqrt(Math.max(varr, 0) * periodsPerYear);
}

export const HORIZON_SESSIONS = 10;
export const TRADING_YEAR = 252;

export function horizonMove(annualVol, { sessions = HORIZON_SESSIONS, periodsPerYear = TRADING_YEAR } = {}) {
  if (!Number.isFinite(annualVol) || annualVol <= 0) return null;
  if (!(sessions > 0) || !(periodsPerYear > 0)) return null;
  return annualVol * Math.sqrt(sessions / periodsPerYear);
}

export function boundedScore(z, scale) {
  if (!Number.isFinite(z)) return 0;
  return Math.round(100 * Math.tanh(z * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

export const CONVICTION_WEIGHTS = Object.freeze({
  agreement: 0.45,
  coverage: 0.35,
  persistence: 0.20,
});

export function conviction({ familyScores = [], coverage = 1, persistence = 0 }) {

  const present = familyScores.filter((s) => Number.isFinite(s));
  if (!present.length) {
    return { conviction: 0, agreement: 0, agree: 0, breadth: 0, coverage: 0, persistence: 0 };
  }

  const sign = Math.sign(present.reduce((a, b) => a + b, 0)) || 1;
  const agree = present.filter((s) => Math.sign(s) === sign).length;
  const agreement = agree / present.length;

  const cov = Math.min(Math.max(coverage, 0), 1);
  const per = Math.min(Math.max(persistence, 0), 1);
  const value = CONVICTION_WEIGHTS.agreement * agreement +
    CONVICTION_WEIGHTS.coverage * cov +
    CONVICTION_WEIGHTS.persistence * per;

  return {
    conviction: Math.round(100 * Math.min(Math.max(value, 0), 1)),
    agreement,

    agree,
    breadth: present.length,
    coverage: cov,
    persistence: per,
  };
}

export function applyHysteresis(todayRanked, yesterdayIds, { entryRank = 25, exitRank = 35 } = {}) {
  const ranked = todayRanked || [];
  const incumbent = new Set(yesterdayIds || []);
  const taken = new Set();
  const keep = [];

  const byHysteresis = new Set();

  for (let i = 0; i < ranked.length && keep.length < entryRank; i++) {
    keep.push(ranked[i]);
    taken.add(ranked[i]);
  }

  for (let i = entryRank; i < ranked.length && i < exitRank; i++) {
    const id = ranked[i];
    if (incumbent.has(id) && !taken.has(id)) {
      keep.push(id); taken.add(id); byHysteresis.add(id);
    }
  }

  const rankOf = new Map(ranked.map((id, i) => [id, i]));
  const ids = keep.sort((a, b) => rankOf.get(a) - rankOf.get(b));

  const cold = incumbent.size === 0;

  return {
    ids,
    entered: cold ? [] : ids.filter((id) => !incumbent.has(id)),
    returning: cold ? [] : ids.filter((id) => incumbent.has(id)),
    held: ids.filter((id) => byHysteresis.has(id)),
    cold,
  };
}

