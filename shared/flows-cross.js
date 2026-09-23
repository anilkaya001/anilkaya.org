export const CROSS_SCHEMA_VERSION = 1;

export const UNIVERSE_BUDGET_BYTES = 100 * 1024;

export const IMPLIED_CORR_MIN_COVERAGE = 0.8;

export const SILENCE = Object.freeze({
  absent: "absent",
  unreadable: "unreadable",
  gated: "plan_gated",
  unread: "not_read",
  stale: "stale",
  few: "too_few",
  unit: "unit_unverified",
  coverage: "low_coverage",
  degenerate: "degenerate",
});

export function vnum(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function vstr(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isoDay(v) {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  if (!ISO_DAY.test(d)) return null;
  const ms = Date.parse(d + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d ? d : null;
}

export function addDays(day, n) {
  const d = isoDay(day);
  if (!d) return null;
  return new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

export function isWeekdayIso(day) {
  const d = isoDay(day);
  if (!d) return false;
  const w = new Date(d + "T00:00:00Z").getUTCDay();
  return w !== 0 && w !== 6;
}

export function nextWeekdayIso(day) {
  let d = addDays(day, 1);
  while (d && !isWeekdayIso(d)) d = addDays(d, 1);
  return d;
}

export function priorWeekdayIso(day) {
  let d = addDays(day, -1);
  while (d && !isWeekdayIso(d)) d = addDays(d, -1);
  return d;
}

export function weekdaysAhead(day, count) {
  const out = [];
  let d = day;
  for (let i = 0; i < count; i++) {
    d = nextWeekdayIso(d);
    if (!d) break;
    out.push(d);
  }
  return out;
}

export function sessionsBetween(from, to) {
  const a = isoDay(from), b = isoDay(to);
  if (!a || !b) return null;
  if (b < a) return null;
  let n = 0;
  for (let d = a; d < b;) {
    d = addDays(d, 1);
    if (isWeekdayIso(d)) n++;
  }
  return n;
}

export function easternDayOfInstant(v) {
  if (typeof v !== "string" || !v) return null;
  if (ISO_DAY.test(v)) return v;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function mean(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function sampleSd(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const s = v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1);
  return Math.sqrt(s);
}

export function medianOf(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const h = v.length >> 1;
  return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
}

export function pctRanks(values) {
  const xs = Array.isArray(values) ? values : [];
  const present = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = present.length;
  return xs.map((x) => {
    if (!Number.isFinite(x) || !n) return null;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (present[mid] <= x) lo = mid + 1; else hi = mid;
    }
    return lo / n;
  });
}

export function pctOf(history, x) {
  if (!Number.isFinite(x)) return null;
  const v = (history || []).filter((h) => Number.isFinite(h));
  if (!v.length) return null;
  return v.filter((h) => h <= x).length / v.length;
}

export function zScores(values, { min = 3 } = {}) {
  const xs = Array.isArray(values) ? values : [];
  const present = xs.filter((x) => Number.isFinite(x));
  if (present.length < min) return xs.map(() => null);
  const m = mean(present);
  const sd = sampleSd(present);
  if (!(sd > 0)) return xs.map(() => null);
  return xs.map((x) => (Number.isFinite(x) ? (x - m) / sd : null));
}

export function ownZ(history, x, { min = 20 } = {}) {
  if (!Number.isFinite(x)) return { z: null, n: 0, mean: null, sd: null, reason: SILENCE.absent };
  const v = (history || []).filter((h) => Number.isFinite(h));
  if (v.length < min) return { z: null, n: v.length, mean: null, sd: null, reason: SILENCE.few };
  const m = mean(v);
  const sd = sampleSd(v);
  if (!(sd > 0)) return { z: null, n: v.length, mean: m, sd, reason: SILENCE.degenerate };
  return { z: (x - m) / sd, n: v.length, mean: m, sd, reason: null };
}

export function compactNumbers(value, { sig = 6 } = {}) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return value;
    if (Math.abs(value) >= 1000) return Math.round(value);
    return Number(value.toPrecision(sig));
  }
  if (Array.isArray(value)) return value.map((v) => compactNumbers(v, { sig }));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = compactNumbers(v, { sig });
    return out;
  }
  return value;
}

export function termSlope(iv30, iv90) {
  const a = vnum(iv30), b = vnum(iv90);
  if (a === null || b === null || !(a > 0) || !(b > 0)) return null;
  return a / b - 1;
}

export function frontStress(iv7, iv30) {
  const a = vnum(iv7), b = vnum(iv30);
  if (a === null || b === null || !(a > 0) || !(b > 0)) return null;
  return a / b - 1;
}

export function ivChange(now, then) {
  const a = vnum(now), b = vnum(then);
  if (a === null || b === null || !(a > 0) || !(b > 0)) return null;
  return a - b;
}

export function ivChangeRel(now, then) {
  const a = vnum(now), b = vnum(then);
  if (a === null || b === null || !(a > 0) || !(b > 0)) return null;
  return (a - b) / b;
}

export function vrpTrailing(iv30, rv) {
  const iv = vnum(iv30), r = vnum(rv);
  if (iv === null || r === null || !(iv > 0) || !(r > 0)) {
    return { vol: null, variance: null, rel: null };
  }
  return { vol: iv - r, variance: iv * iv - r * r, rel: (iv - r) / r };
}

export function dollarVolume(avgShares, close) {
  const v = vnum(avgShares), c = vnum(close);
  if (v === null || c === null || !(v > 0) || !(c > 0)) return null;
  return v * c;
}

export function gexPerAdv(gexPerOnePct, avgShares, close) {
  const g = vnum(gexPerOnePct);
  const adv = dollarVolume(avgShares, close);
  if (g === null || adv === null) return null;
  return g / adv;
}

export function sharesPerAdv(shares, avgShares) {
  const s = vnum(shares), v = vnum(avgShares);
  if (s === null || v === null || !(v > 0)) return null;
  return s / v;
}

export function gammaDollarsPerAdv(cumDirGamma, avgShares, close) {
  const g = vnum(cumDirGamma), c = vnum(close);
  const adv = dollarVolume(avgShares, close);
  if (g === null || c === null || adv === null) return null;
  return (g * c * c * 0.01) / adv;
}

export function vegaDollarsPerAdv(cumDirVega, avgShares, close) {
  const v = vnum(cumDirVega);
  const adv = dollarVolume(avgShares, close);
  if (v === null || adv === null) return null;
  return v / adv;
}

export function netTilt(row) {
  if (!row) return null;
  const c = vnum(row.net_call_premium), p = vnum(row.net_put_premium);
  const cp = vnum(row.call_premium), pp = vnum(row.put_premium);
  if (c === null || p === null || cp === null || pp === null) return null;
  const gross = Math.abs(cp) + Math.abs(pp);
  return gross > 0 ? (c - p) / gross : null;
}

export function sectorTilts(rows) {
  const acc = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const sector = r && vstr(r.sector);
    if (!sector || netTilt(r) === null) continue;
    const a = acc.get(sector) || { net: 0, gross: 0, n: 0 };
    a.net += vnum(r.net_call_premium) - vnum(r.net_put_premium);
    a.gross += Math.abs(vnum(r.call_premium)) + Math.abs(vnum(r.put_premium));
    a.n++;
    acc.set(sector, a);
  }
  const out = new Map();
  for (const [k, a] of acc) out.set(k, a.gross > 0 ? { tilt: a.net / a.gross, n: a.n } : { tilt: null, n: a.n });
  return out;
}

export function bandPosition(close, lower, upper) {
  const c = vnum(close), lo = vnum(lower), hi = vnum(upper);
  if (c === null || lo === null || hi === null || !(hi > lo)) return null;
  return (c - lo) / (hi - lo);
}

export function ratioMinusOne(a, b) {
  const x = vnum(a), y = vnum(b);
  if (x === null || y === null || !(y > 0)) return null;
  return x / y - 1;
}

export function impliedCorrelation(indexVol, members, { minCoverage = IMPLIED_CORR_MIN_COVERAGE } = {}) {
  const sI = vnum(indexVol);
  const list = Array.isArray(members) ? members : [];
  const listedWeight = list.reduce((a, m) => a + (vnum(m && m.w) > 0 ? vnum(m.w) : 0), 0);
  const usable = list
    .map((m) => ({ w: vnum(m && m.w), vol: vnum(m && m.vol) }))
    .filter((m) => m.w !== null && m.w > 0 && m.vol !== null && m.vol > 0);
  const coverage = usable.reduce((a, m) => a + m.w, 0);
  const base = {
    rho: null, indexVol: sI, members: usable.length, listed: list.length,
    coverage: listedWeight > 0 ? coverage / Math.max(1, listedWeight) : null,
    weightSum: listedWeight, avgVol: null, dispersion: null, reason: null,
  };
  if (sI === null || !(sI > 0)) return { ...base, reason: SILENCE.absent };
  if (usable.length < 2) return { ...base, reason: SILENCE.few };
  const cov = base.coverage;
  if (cov === null || cov < minCoverage) return { ...base, reason: SILENCE.coverage };
  let a = 0, b = 0;
  for (const m of usable) {
    const w = m.w / coverage;
    a += w * m.vol;
    b += w * w * m.vol * m.vol;
  }
  const denom = a * a - b;
  if (!(denom > 0)) return { ...base, avgVol: a, reason: SILENCE.degenerate };
  return { ...base, rho: (sI * sI - b) / denom, avgVol: a, dispersion: a - sI };
}

const round = (v, scale) => (v === null || !Number.isFinite(v) ? null : Math.round(v * scale));

const sessionsToEarnings = (row, ctx) => {
  const e = isoDay(row.next_earnings_date);
  if (!e || !ctx.sessionDate) return null;
  return sessionsBetween(ctx.sessionDate, e);
};

export const UNIVERSE_COLUMNS = Object.freeze([
  { key: "px", unit: "usd", scale: 100, prio: 1,
    get: (r) => { const v = vnum(r.close); return v !== null && v > 0 ? v : null; } },
  { key: "chg", unit: "fraction", scale: 1e4, prio: 1,
    get: (r) => ratioMinusOne(r.close, r.prev_close) },
  { key: "mcap", unit: "usd", scale: 1e-8, prio: 2,
    get: (r) => { const v = vnum(r.marketcap); return v !== null && v > 0 ? v : null; } },
  { key: "iv30", unit: "vol", scale: 1e3, prio: 1,
    get: (r) => { const v = vnum(r.volatility_30) ?? vnum(r.iv30d) ?? vnum(r.volatility); return v !== null && v > 0 ? v : null; } },
  { key: "ivp", unit: "pct100", scale: 1, prio: 1,
    get: (r) => { const v = vnum(r.iv_percentile_1y); return v !== null && v >= 0 && v <= 100 ? v : null; } },
  { key: "ts", unit: "fraction", scale: 1e3, prio: 1,
    get: (r) => termSlope(r.volatility_30 ?? r.iv30d, r.volatility_90) },
  { key: "fs", unit: "fraction", scale: 1e3, prio: 2,
    get: (r) => frontStress(r.volatility_7, r.volatility_30 ?? r.iv30d) },
  { key: "dIv1d", unit: "vol", scale: 1e3, prio: 1,
    get: (r) => ivChange(r.iv30d ?? r.volatility_30, r.iv30d_1d) },
  { key: "dIv1w", unit: "vol", scale: 1e3, prio: 2,
    get: (r) => ivChange(r.iv30d ?? r.volatility_30, r.iv30d_1w) },
  { key: "dIv1m", unit: "vol", scale: 1e3, prio: 4,
    get: (r) => ivChange(r.iv30d ?? r.volatility_30, r.iv30d_1m) },
  { key: "rv20", unit: "vol", scale: 1e3, prio: 2,
    get: (r) => { const v = vnum(r.realized_volatility); return v !== null && v > 0 ? v : null; } },
  { key: "vrp", unit: "vol", scale: 1e3, prio: 1,
    get: (r) => vrpTrailing(r.volatility_30 ?? r.iv30d, r.realized_volatility).vol },
  { key: "vrpPost", unit: "vol", scale: 1e3, prio: 4,
    get: (r) => vnum(r.variance_risk_premium) },
  { key: "erq", unit: "ratio", scale: 100, prio: 2,
    get: (r) => { const v = vnum(r.rv_1d_last_12q); return v !== null && v >= 0 ? v : null; } },
  { key: "gexAdv", unit: "fraction", scale: 1e4, prio: 1,
    get: (r) => gexPerAdv(r.gex_gamma_per_one_percent_move_oi, r.avg30_volume, r.close) },
  { key: "gexRatio", unit: "ratio", scale: 100, prio: 5,
    get: (r) => { const v = vnum(r.gex_ratio); return v !== null && v >= 0 ? v : null; } },
  { key: "dDelta", unit: "fraction", scale: 1e4, prio: 2,
    get: (r) => sharesPerAdv(r.cum_dir_delta, r.avg30_volume) },
  { key: "dGamma", unit: "fraction", scale: 1e6, prio: 5,
    get: (r) => gammaDollarsPerAdv(r.cum_dir_gamma, r.avg30_volume, r.close) },
  { key: "dVega", unit: "fraction", scale: 1e6, prio: 3,
    get: (r) => vegaDollarsPerAdv(r.cum_dir_vega, r.avg30_volume, r.close) },
  { key: "si", unit: "fraction", scale: 1e4, prio: 2,
    get: (r) => { const v = vnum(r.short_int); return v !== null && v >= 0 ? v : null; } },
  { key: "ins3m", unit: "fraction", scale: 1e6, prio: 4,
    get: (r) => {
      const b = vnum(r.insider_buy_volume_3m), s = vnum(r.insider_sell_volume_3m);
      const so = vnum(r.shares_outstanding);
      if (b === null || s === null || so === null || !(so > 0)) return null;
      return (b - s) / so;
    } },
  { key: "ed", unit: "sessions", scale: 1, prio: 2, get: (r, ctx) => sessionsToEarnings(r, ctx) },
  { key: "rsi", unit: "index100", scale: 1, prio: 3,
    get: (r) => { const v = vnum(r.rsi_14); return v !== null && v >= 0 && v <= 100 ? v : null; } },
  { key: "adx", unit: "index100", scale: 1, prio: 5,
    get: (r) => { const v = vnum(r.adx_14); return v !== null && v >= 0 && v <= 100 ? v : null; } },
  { key: "bb", unit: "fraction", scale: 100, prio: 4,
    get: (r) => bandPosition(r.close, r.bb_20_2_lower, r.bb_20_2_upper) },
  { key: "atr", unit: "fraction", scale: 1e3, prio: 3,
    get: (r) => { const a = vnum(r.atr_14), c = vnum(r.close); return a !== null && c !== null && c > 0 && a >= 0 ? a / c : null; } },
  { key: "sma50", unit: "fraction", scale: 1e3, prio: 4, get: (r) => ratioMinusOne(r.close, r.sma_50) },
  { key: "rvol", unit: "ratio", scale: 10, prio: 3,
    get: (r) => { const v = vnum(r.relative_volume); return v !== null && v >= 0 ? v : null; } },
  { key: "tilt", unit: "fraction", scale: 100, prio: 2, get: (r) => netTilt(r) },
  { key: "secDiv", unit: "fraction", scale: 100, prio: 3,
    get: (r, ctx) => {
      const own = netTilt(r);
      const sector = ctx.sectorTilts ? ctx.sectorTilts.get(vstr(r.sector)) : undefined;
      return own === null || !sector || sector.tilt === null || sector.n < 3 ? null : own - sector.tilt;
    } },
]);

export const UNIVERSE_PERCENTILES = Object.freeze(["iv30", "ts", "vrp", "gexAdv", "si"]);

export const UNIVERSE_SHOCK = "dIvRel1d";

export function universeColumn(rows, spec, ctx = {}) {
  return rows.map((r) => {
    try {
      const v = spec.get(r || {}, ctx);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  });
}

export function encodeColumn(values, scale) {
  return values.map((v) => round(v, scale));
}

export function decodeColumn(values, scale) {
  return (values || []).map((v) => (Number.isFinite(v) ? v / scale : null));
}

export function buildUniverse(rows, {
  sessionDate = null,
  generatedAt = null,
  budgetBytes = UNIVERSE_BUDGET_BYTES,
  screened = null,
  harvest = null,
  fresh = null,
  columns = UNIVERSE_COLUMNS,
  percentiles = UNIVERSE_PERCENTILES,
} = {}) {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.ticker === "string" && r.ticker)
    .slice()
    .sort((a, b) => (vnum(b.marketcap) ?? -1) - (vnum(a.marketcap) ?? -1) ||
      (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  const tiltsBySector = sectorTilts(list);
  const ctx = { sessionDate, sectorTilts: tiltsBySector };
  const sectors = [];
  const sectorIndex = new Map();
  const sec = list.map((r) => {
    const s = vstr(r.sector);
    if (!s) return null;
    if (!sectorIndex.has(s)) { sectorIndex.set(s, sectors.length); sectors.push(s); }
    return sectorIndex.get(s);
  });

  const raw = {};
  for (const spec of columns) raw[spec.key] = universeColumn(list, spec, ctx);
  const shockRaw = list.map((r) => ivChangeRel(r.iv30d ?? r.volatility_30, r.iv30d_1d));

  const cols = {}, units = {}, counts = {};
  for (const spec of columns) {
    cols[spec.key] = encodeColumn(raw[spec.key], spec.scale);
    units[spec.key] = [spec.unit, spec.scale];
    counts[spec.key] = raw[spec.key].filter((v) => v !== null).length;
  }

  const pct = {};
  for (const key of percentiles) {
    if (!raw[key]) continue;
    pct[key] = pctRanks(raw[key]).map((p) => (p === null ? null : Math.round(p * 100)));
  }
  const shockZ = zScores(shockRaw);

  const payload = {
    v: CROSS_SCHEMA_VERSION,
    generatedAt, sessionDate,
    ...(fresh ? { fresh } : {}),
    status: list.length ? "ok" : "unavailable",
    ...(list.length ? {} : { reason: SILENCE.absent }),
    screened: screened === null ? null : screened,
    n: list.length,
    harvest: harvest || null,
    order: "marketcap desc, then ticker",
    t: list.map((r) => r.ticker),
    sectors,
    sec,
    sectorTilt: sectors.map((k) => {
      const v = tiltsBySector.get(k);
      return v && v.tilt !== null ? Math.round(v.tilt * 100) : null;
    }),
    units,
    cols,
    counts,
    pct,
    pctRule: "pct = #{x_j <= x_i} / n over the names with a value, today included, x100 and rounded",
    shock: {
      key: UNIVERSE_SHOCK,
      unit: "z",
      scale: 10,
      rule: "cross-sectional z of (iv30d - iv30d_1d) / iv30d_1d, sample sd, tagged x (not own history)",
      v: shockZ.map((z) => round(z, 10)),
    },
    shed: [],
    budgetBytes,
  };

  const byPrio = columns.slice().sort((a, b) => b.prio - a.prio || columns.indexOf(b) - columns.indexOf(a));
  let bytes = JSON.stringify(payload).length;
  for (const spec of byPrio) {
    if (bytes <= budgetBytes) break;
    if (spec.prio <= 1) break;
    delete payload.cols[spec.key];
    delete payload.units[spec.key];
    delete payload.counts[spec.key];
    if (payload.pct[spec.key]) delete payload.pct[spec.key];
    payload.shed.push(spec.key);
    bytes = JSON.stringify(payload).length;
  }
  payload.bytes = JSON.stringify(payload).length;
  if (payload.bytes > budgetBytes) {
    payload.status = "unavailable";
    payload.reason = "over_budget";
  }
  return payload;
}

export function universeValue(universe, ticker, key) {
  if (!universe || !Array.isArray(universe.t)) return null;
  const i = universe.t.indexOf(ticker);
  if (i < 0) return null;
  const col = universe.cols && universe.cols[key];
  const unit = universe.units && universe.units[key];
  if (!col || !unit) return null;
  const v = col[i];
  return Number.isFinite(v) ? v / unit[1] : null;
}
