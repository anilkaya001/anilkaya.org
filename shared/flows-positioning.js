import { gammaFlip } from "./flows-features.js";
import { PUT_TO_DEALER } from "./flows-variation.js";
import { parseOptionSymbol } from "./flows-premium.js";

export const POSITIONING_VERSION = 1;

export const POSITIONING_LINES = Object.freeze({
  HISTORY_WINDOW: 252,
  HISTORY_MIN: 60,
  NOPE_MIN: 20,
  OI_SLOPE_SESSIONS: 20,
  OI_SLOPE_MIN: 10,
  FLIP_AGREE_ATR: 0.5,
  STRIKE_BAND: 0.25,
  SIGMA_DAYS: 30,
  LADDER_CAP: 40,
  DP_BAND_ATR: 2,
  DP_SHELVES: 3,
  DOWNSAMPLE_MIN: 5,
  LIFE_SESSIONS: 30,
  ALERT_DOTS: 30,
  MULTI_TOP: 12,
  NOPE_AGREE: 1e-5,
  SESSION_MINUTES: 390,
});

export const TENOR_BUCKETS = Object.freeze([
  Object.freeze({ id: "0-7", max: 7 }),
  Object.freeze({ id: "8-45", max: 45 }),
  Object.freeze({ id: "46-180", max: 180 }),
  Object.freeze({ id: "181+", max: Infinity }),
]);

export const FLOW_CODES = Object.freeze({
  unread: "The run did not request this read for the name.",
  failed: "The vendor call failed, so nothing was measured.",
  refused: "The vendor refused the call for this plan.",
  malformed: "The vendor answered with a body that is not the confirmed shape.",
  empty: "The vendor answered with no rows: measured and empty.",
  "not-session": "The vendor dated these rows to a different session.",
  "short-history": "Fewer sessions of history than the statistic needs.",
  "history-unread": "The name's stored history could not be read back this run, so it was neither used nor overwritten.",
  "zero-sd": "The history has no dispersion, so a z-score is undefined.",
  "no-today": "There is no value for the session itself.",
  "no-spot": "No reference price for the session.",
  "no-atr": "No average true range for the session.",
  "no-adv": "No median daily dollar volume for the name.",
  "no-iv": "No 30-day implied volatility for the name.",
  "no-premium": "Premium summed to zero, so the share is undefined.",
  "no-volume": "Volume summed to zero, so the share is undefined.",
  "no-oi": "Open interest summed to zero.",
  "single-flip": "Fewer than two nearby flips, so there is no spread between them.",
  "no-flip": "No zero-gamma crossing was found.",
  "no-level": "The vendor sent no value for this level.",
  "no-row": "No flow row at that strike.",
  "no-walls": "No wall strike to measure flow against.",
  "no-rth": "No row fell inside the regular session.",
  "flow-unfilled": "The flow legs stayed zero through the session; only the open-interest leg is populated.",
  "convention-undetermined": "The run could not settle the vendor's put-leg sign for this greek.",
  "no-price": "No session open and close to compare against.",
  "outside-band": "No level fell inside the band around spot.",
  "no-contracts": "No contract gained open interest to follow.",
  "no-build": "Open interest did not rise into the latest session.",
  truncated: "The read hit the vendor's row ceiling before reaching the session open.",
  deadline: "The run passed its deadline before reaching this name.",
  shed: "Dropped to keep the payload under its byte cap.",
});

export const UNITS = Object.freeze({
  shareGamma: "vendor share-gamma: gamma x open interest x 100, dealer-signed",
  usdPer1pct: "dollars of dealer hedging per 1% move in the underlying",
  usd: "US dollars",
  frac: "fraction (0.25 = 25%)",
  sd: "standard deviations of the name's own history",
  sessions: "trading sessions",
  days: "calendar days",
  px: "underlying price",
  atr: "multiples of the 14-session average true range, signed from spot",
  sigma: "multiples of the 30-day implied move, signed from spot",
  contracts: "option contracts",
  contractsPerSession: "option contracts per session",
  fracPerSession: "fraction of the mean per session",
  ratio: "dimensionless ratio",
  vendor: "the vendor's own unit, carried unchanged",
  min: "minutes after the 09:30 ET open",
  shares: "shares",
  count: "a count",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function vnum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const isDay = (d) => typeof d === "string" && DAY_RE.test(d);

export function dayOf(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, 10);
  return DAY_RE.test(s) ? s : null;
}

export function toMs(v) {
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return null;
    return v > 1e12 ? v : v * 1000;
  }
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

const NY_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
});

function nyParts(ms) {
  const out = {};
  for (const p of NY_PARTS.formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

export function etDay(ms) {
  if (!Number.isFinite(ms)) return null;
  const p = nyParts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nyOffsetMinutes(day) {
  if (!isDay(day)) return null;
  const t = Date.parse(day + "T16:00:00Z");
  const p = nyParts(t);
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return Math.round((local - t) / 60000);
}

export function sessionWindow(day) {
  const offset = nyOffsetMinutes(day);
  if (offset === null) return null;
  const midnight = Date.parse(day + "T00:00:00Z");
  const open = midnight + (9 * 60 + 30 - offset) * 60000;
  const close = midnight + (16 * 60 - offset) * 60000;
  return { day, open, close, openIso: new Date(open).toISOString(), closeIso: new Date(close).toISOString() };
}

export function minuteOf(ms, win) {
  if (!win || !Number.isFinite(ms)) return null;
  return Math.floor((ms - win.open) / 60000);
}

export function inSession(ms, win) {
  return !!win && Number.isFinite(ms) && ms >= win.open && ms < win.close;
}

export function daysBetween(from, to) {
  const a = Date.parse(String(from || "").slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(String(to || "").slice(0, 10) + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const round = (v, dp) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp)));

const usd = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v));

const sig = (v, digits = 6) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toPrecision(digits)));

export function rowsOf(body, rule) {
  if (body === null || body === undefined) return null;
  if (rule === "object") {
    const o = body && typeof body === "object" && !Array.isArray(body) ? body.data : null;
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  }
  if (rule === "chains") return body && typeof body === "object" && Array.isArray(body.chains) ? body.chains : null;
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object" && Array.isArray(body.data)) return body.data;
  return null;
}

export function failedRead(code) {
  return { __failed: code };
}

export function readCode(error) {
  const m = /HTTP (\d{3})/.exec(String(error && error.message ? error.message : error || ""));
  const status = m ? Number(m[1]) : null;
  return status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429 ? "refused" : "failed";
}

export function silence(status, why, extra = {}) {
  return { status, why, ...extra };
}

function gate(body, rule) {
  if (body === undefined) return { quiet: silence("unavailable", "unread") };
  if (body && typeof body === "object" && !Array.isArray(body) && typeof body.__failed === "string") {
    return { quiet: silence("unavailable", body.__failed) };
  }
  const rows = rowsOf(body, rule);
  if (rows === null) return { quiet: silence("unreadable", "malformed") };
  return { rows };
}

export function ownHistory(series, { min = POSITIONING_LINES.HISTORY_MIN, window = POSITIONING_LINES.HISTORY_WINDOW } = {}) {
  const list = Array.isArray(series) ? series : [];
  const today = list.length ? vnum(list[list.length - 1]) : null;
  if (today === null) return { z: null, pct: null, n: 0, why: "no-today" };
  const base = list.slice(Math.max(0, list.length - 1 - window), list.length - 1)
    .map(vnum).filter((v) => v !== null);
  const n = base.length;
  if (n < min) return { z: null, pct: null, n, why: "short-history" };
  let atOrBelow = 1;
  for (const v of base) if (v <= today) atOrBelow++;
  const pct = atOrBelow / (n + 1);
  if (n < 2) return { z: null, pct, n, why: "short-history" };
  const mean = sum(base) / n;
  const sd = Math.sqrt(sum(base.map((v) => (v - mean) ** 2)) / (n - 1));
  if (!(sd > 0)) return { z: null, pct, n, why: "zero-sd" };
  return { z: (today - mean) / sd, pct, n, why: null };
}

export function signRun(values) {
  const list = Array.isArray(values) ? values : [];
  const last = list.length ? vnum(list[list.length - 1]) : null;
  if (last === null) return { sign: null, run: 0 };
  const s = Math.sign(last);
  let run = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const v = vnum(list[i]);
    if (v === null || Math.sign(v) !== s) break;
    run++;
  }
  return { sign: s, run };
}

export function signFlips(values) {
  let prev = 0, flips = 0;
  const at = [];
  (Array.isArray(values) ? values : []).forEach((raw, i) => {
    const v = vnum(raw);
    if (v === null || v === 0) return;
    const s = Math.sign(v);
    if (prev !== 0 && s !== prev) { flips++; at.push(i); }
    prev = s;
  });
  return { flips, at };
}

export function olsSlope(values) {
  const pts = [];
  (Array.isArray(values) ? values : []).forEach((raw, i) => {
    const v = vnum(raw);
    if (v !== null) pts.push([i, v]);
  });
  if (pts.length < 2) return null;
  const mx = sum(pts.map((p) => p[0])) / pts.length;
  const my = sum(pts.map((p) => p[1])) / pts.length;
  const sxx = sum(pts.map((p) => (p[0] - mx) ** 2));
  if (!(sxx > 0)) return null;
  return sum(pts.map((p) => (p[0] - mx) * (p[1] - my))) / sxx;
}

export function packSeries(values) {
  const list = (Array.isArray(values) ? values : []).map(vnum);
  const finite = list.filter((v) => v !== null);
  const max = finite.length ? Math.max(...finite.map(Math.abs)) : 0;
  const s = max > 0 ? Math.floor(Math.log10(max)) - 3 : 0;
  const f = 10 ** Math.abs(s);
  const x = list.map((v) => {
    if (v === null) return null;
    const q = Math.round(s >= 0 ? v / f : v * f);
    return q === 0 ? 0 : q;
  });
  return { s, x };
}

export function unpackSeries(packed) {
  if (!packed || !Array.isArray(packed.x)) return [];
  const s = Number.isInteger(packed.s) ? packed.s : 0;
  const f = 10 ** Math.abs(s);
  return packed.x.map((q) => {
    const v = vnum(q);
    if (v === null) return null;
    return s >= 0 ? v * f : v / f;
  });
}

function dedupeByDay(rows, dayField, sessionDate) {
  const byDay = new Map();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const d = dayOf(r[dayField]);
    if (!d || (isDay(sessionDate) && d > sessionDate)) continue;
    byDay.set(d, r);
  }
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const leg = (c, p, m) => (c === null || p === null || m === null || m === undefined ? null : c + m * p);

export function dollarGammaPer1pct(netShareGamma, spot, unit = "share") {
  const g = vnum(netShareGamma), S = vnum(spot);
  if (g === null) return null;
  if (unit === "pct$") return g;
  return S !== null && S > 0 ? g * 0.01 * S * S : null;
}

export function gexHistory(body, {
  sessionDate = null, spot = null, adv = null, unit = "share", multipliers = PUT_TO_DEALER,
  window = POSITIONING_LINES.HISTORY_WINDOW, min = POSITIONING_LINES.HISTORY_MIN,
} = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return { section: g0.quiet, series: null };
  const m = multipliers || {};
  const days = dedupeByDay(g0.rows, "date", sessionDate).slice(-window);
  const rows = days.map(([d, r]) => ({
    d,
    g: leg(vnum(r.call_gamma ?? r.call_gex), vnum(r.put_gamma ?? r.put_gex), 1),
    c: leg(vnum(r.call_charm), vnum(r.put_charm), m.charm),
    v: leg(vnum(r.call_vanna), vnum(r.put_vanna), m.vanna),
  }));
  if (!rows.length) return { section: silence("quiet", "empty"), series: null };
  if (rows.every((r) => r.g === null)) return { section: silence("unreadable", "malformed"), series: null };
  const g = rows.map((r) => r.g), c = rows.map((r) => r.c), v = rows.map((r) => r.v);
  const last = rows[rows.length - 1];
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };

  const gz = ownHistory(g, { min, window });
  const cz = ownHistory(c, { min, window });
  const vz = ownHistory(v, { min, window });
  const run = signRun(g);
  const finiteG = g.filter((x) => x !== null);
  const usd = last.g === null ? note("usd1pct", "no-today")
    : (dollarGammaPer1pct(last.g, spot, unit) ?? note("usd1pct", "no-spot"));
  const A = vnum(adv);
  const advShare = usd === null ? note("adv", gaps.usd1pct || "no-spot")
    : A !== null && A > 0 ? usd / A : note("adv", "no-adv");
  const same = isDay(sessionDate) ? last.d === sessionDate : null;

  const section = {
    status: same === false ? "stale" : "ok",
    why: same === false ? "not-session" : null,
    asOf: last.d,
    n: rows.length,
    net: sig(last.g) ?? note("net", "no-today"),
    usd1pct: sig(usd),
    adv: sig(advShare),
    z: round(gz.z, 3) ?? note("z", gz.why),
    pct: round(gz.pct, 4) ?? note("pct", gz.why),
    regime: last.g === null ? note("regime", "no-today") : last.g > 0 ? "long" : last.g < 0 ? "short" : "flat",
    persist: run.sign === null ? note("persist", "no-today") : run.run,
    longShare: finiteG.length ? round(finiteG.filter((x) => x > 0).length / finiteG.length, 4) : note("longShare", "empty"),
    flips: signFlips(g).flips,
    charm: m.charm === null || m.charm === undefined ? note("charm", "convention-undetermined") : (sig(last.c) ?? note("charm", "no-today")),
    charmZ: m.charm === null || m.charm === undefined ? note("charmZ", "convention-undetermined") : (round(cz.z, 3) ?? note("charmZ", cz.why)),
    charmPct: m.charm === null || m.charm === undefined ? note("charmPct", "convention-undetermined") : (round(cz.pct, 4) ?? note("charmPct", cz.why)),
    vanna: m.vanna === null || m.vanna === undefined ? note("vanna", "convention-undetermined") : (sig(last.v) ?? note("vanna", "no-today")),
    vannaZ: m.vanna === null || m.vanna === undefined ? note("vannaZ", "convention-undetermined") : (round(vz.z, 3) ?? note("vannaZ", vz.why)),
    vannaPct: m.vanna === null || m.vanna === undefined ? note("vannaPct", "convention-undetermined") : (round(vz.pct, 4) ?? note("vannaPct", vz.why)),
    u: { net: unit === "pct$" ? "usdPer1pct" : "shareGamma", usd1pct: "usdPer1pct", adv: "frac", z: "sd", pct: "frac", persist: "sessions",
      longShare: "frac", flips: "count", charm: "vendor", charmZ: "sd", charmPct: "frac", vanna: "vendor",
      vannaZ: "sd", vannaPct: "frac" },
    gaps,
  };
  return { section, series: { d: rows.map((r) => r.d), g, c, v, unit: section.u.net } };
}

export function volumeHistory(body, {
  sessionDate = null, window = POSITIONING_LINES.HISTORY_WINDOW, min = POSITIONING_LINES.HISTORY_MIN,
  slopeSessions = POSITIONING_LINES.OI_SLOPE_SESSIONS, slopeMin = POSITIONING_LINES.OI_SLOPE_MIN,
} = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return { section: g0.quiet, series: null };
  const days = dedupeByDay(g0.rows, "date", sessionDate).slice(-window);
  const rows = days.map(([d, r]) => {
    const ncp = vnum(r.net_call_premium), npp = vnum(r.net_put_premium);
    const bull = vnum(r.bullish_premium), bear = vnum(r.bearish_premium);
    const cv = vnum(r.call_volume), pv = vnum(r.put_volume);
    const coi = vnum(r.call_open_interest), poi = vnum(r.put_open_interest);
    return {
      d,
      np: ncp !== null && npp !== null ? ncp - npp : null,
      bb: bull !== null && bear !== null ? bull - bear : null,
      vol: cv !== null && pv !== null ? cv + pv : null,
      pc: cv !== null && pv !== null && cv > 0 ? pv / cv : null,
      oi: coi !== null && poi !== null ? coi + poi : null,
    };
  });
  if (!rows.length) return { section: silence("quiet", "empty"), series: null };
  if (rows.every((r) => r.np === null && r.bb === null && r.vol === null && r.oi === null)) {
    return { section: silence("unreadable", "malformed"), series: null };
  }
  const col = (k) => rows.map((r) => r[k]);
  const last = rows[rows.length - 1];
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const hz = {};
  for (const k of ["np", "bb", "vol", "pc"]) hz[k] = ownHistory(col(k), { min, window });

  const tail = col("oi").slice(-slopeSessions);
  const finiteTail = tail.filter((v) => v !== null);
  const slope = finiteTail.length >= slopeMin ? olsSlope(tail) : null;
  const meanOi = finiteTail.length ? sum(finiteTail) / finiteTail.length : null;
  const same = isDay(sessionDate) ? last.d === sessionDate : null;

  const section = {
    status: same === false ? "stale" : "ok",
    why: same === false ? "not-session" : null,
    asOf: last.d,
    n: rows.length,
    netPrem: usd(last.np) ?? note("netPrem", "no-today"),
    netPremZ: round(hz.np.z, 3) ?? note("netPremZ", hz.np.why),
    netPremPct: round(hz.np.pct, 4) ?? note("netPremPct", hz.np.why),
    bullBear: usd(last.bb) ?? note("bullBear", "no-today"),
    bullBearZ: round(hz.bb.z, 3) ?? note("bullBearZ", hz.bb.why),
    bullBearPct: round(hz.bb.pct, 4) ?? note("bullBearPct", hz.bb.why),
    volume: last.vol ?? note("volume", "no-today"),
    volumeZ: round(hz.vol.z, 3) ?? note("volumeZ", hz.vol.why),
    volumePct: round(hz.vol.pct, 4) ?? note("volumePct", hz.vol.why),
    pc: round(last.pc, 4) ?? note("pc", last.vol === null ? "no-today" : "no-volume"),
    pcZ: round(hz.pc.z, 3) ?? note("pcZ", hz.pc.why),
    pcPct: round(hz.pc.pct, 4) ?? note("pcPct", hz.pc.why),
    oi: last.oi ?? note("oi", "no-today"),
    oiSlope: round(slope, 2) ?? note("oiSlope", "short-history"),
    oiSlopeRel: slope !== null && meanOi > 0 ? round(slope / meanOi, 6) : note("oiSlopeRel", slope === null ? "short-history" : "no-oi"),
    u: { netPrem: "usd", netPremZ: "sd", netPremPct: "frac", bullBear: "usd", bullBearZ: "sd", bullBearPct: "frac",
      volume: "contracts", volumeZ: "sd", volumePct: "frac", pc: "ratio", pcZ: "sd", pcPct: "frac",
      oi: "contracts", oiSlope: "contractsPerSession", oiSlopeRel: "fracPerSession" },
    gaps,
  };
  return { section, series: { d: rows.map((r) => r.d), np: col("np"), bb: col("bb"), vol: col("vol"), pc: col("pc"), oi: col("oi") } };
}

export function bookLevels(strikeRows, spot, { putSign = 1 } = {}) {
  const S = vnum(spot);
  const ladder = [];
  for (const r of Array.isArray(strikeRows) ? strikeRows : []) {
    if (!r || typeof r !== "object") continue;
    const k = vnum(r.strike), c = vnum(r.call_gamma_oi), p = vnum(r.put_gamma_oi);
    if (k === null || !(k > 0) || c === null || p === null) continue;
    ladder.push({ strike: k, c, p, gamma: putSign === null ? null : c + putSign * p });
  }
  ladder.sort((a, b) => a.strike - b.strike);
  if (!ladder.length) return { callWall: null, putWall: null, magnet: null, flip: null, rows: 0 };
  let callWall = null, putWall = null, magnet = null, best = { c: 0, p: 0, m: 0 };
  for (const r of ladder) {
    if (S !== null && r.strike >= S && r.c > best.c) { best.c = r.c; callWall = r.strike; }
    if (S !== null && r.strike <= S && Math.abs(r.p) > best.p) { best.p = Math.abs(r.p); putWall = r.strike; }
    if (r.gamma !== null && Math.abs(r.gamma) > best.m) { best.m = Math.abs(r.gamma); magnet = r.strike; }
  }
  let flip = null;
  if (putSign !== null) {
    let cum = 0;
    const book = ladder.map((r) => { cum += r.gamma; return { strike: r.strike, gamma: r.gamma, cum }; });
    flip = gammaFlip(book, { spot: S });
  }
  return { callWall, putWall, magnet, flip, rows: ladder.length };
}

export function gexLevels(body, { sessionDate = null, spot = null, atr = null, strikes = null, putSign = 1 } = {}) {
  const g0 = gate(body, "object");
  if (g0.quiet) return g0.quiet;
  const o = g0.rows;
  const S = vnum(spot), A = vnum(atr);
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const dist = (px, field) => {
    if (px === null) return note(field, "no-level");
    if (S === null || !(S > 0)) return note(field, "no-spot");
    if (A === null || !(A > 0)) return note(field, "no-atr");
    return round((px - S) / A, 3);
  };
  const level = (k, field) => vnum(o[k]) ?? note(field, "no-level");
  const nearby = (Array.isArray(o.nearby_flips) ? o.nearby_flips : []).map(vnum).filter((v) => v !== null);
  const vendor = {
    callWall: level("call_wall", "callWall"),
    putWall: level("put_wall", "putWall"),
    magnet: level("gamma_magnet", "magnet"),
    flip: level("gamma_flip", "flip"),
  };
  const ours = strikes === null ? null : bookLevels(strikes, S, { putSign });
  const ambiguity = nearby.length < 2 ? note("ambiguity", "single-flip")
    : A === null || !(A > 0) ? note("ambiguity", "no-atr")
    : round((Math.max(...nearby) - Math.min(...nearby)) / A, 3);
  const oursFlip = ours ? ours.flip : null;
  const flipGap = vendor.flip === null ? note("flipGap", "no-level")
    : oursFlip === null ? note("flipGap", putSign === null ? "convention-undetermined" : "no-flip")
    : A === null || !(A > 0) ? note("flipGap", "no-atr")
    : round((vendor.flip - oursFlip) / A, 3);
  const agree = (a, b, field) => (a === null || b === null ? note(field, a === null ? "no-level" : "no-flip") : a === b);
  const date = dayOf(o.date);
  const same = isDay(sessionDate) && date ? date === sessionDate : null;
  return {
    status: same === false ? "stale" : "ok",
    why: same === false ? "not-session" : null,
    asOf: date,
    time: typeof o.time === "string" ? o.time : null,
    source: typeof o.source === "string" ? o.source : null,
    spot: S,
    ...vendor,
    callWallAtr: dist(vendor.callWall, "callWallAtr"),
    putWallAtr: dist(vendor.putWall, "putWallAtr"),
    magnetAtr: dist(vendor.magnet, "magnetAtr"),
    flipAtr: dist(vendor.flip, "flipAtr"),
    nearby,
    ambiguity,
    ours: ours ? { callWall: ours.callWall, putWall: ours.putWall, magnet: ours.magnet, flip: round(oursFlip, 4) } : null,
    flipGap,
    flipAgree: flipGap === null ? note("flipAgree", gaps.flipGap) : Math.abs(flipGap) <= POSITIONING_LINES.FLIP_AGREE_ATR,
    callWallAgree: ours ? agree(vendor.callWall, ours.callWall, "callWallAgree") : note("callWallAgree", "unread"),
    putWallAgree: ours ? agree(vendor.putWall, ours.putWall, "putWallAgree") : note("putWallAgree", "unread"),
    u: { callWall: "px", putWall: "px", magnet: "px", flip: "px", callWallAtr: "atr", putWallAtr: "atr",
      magnetAtr: "atr", flipAtr: "atr", nearby: "px", ambiguity: "atr", flipGap: "atr" },
    gaps,
  };
}

function sessionDated(rows, sessionDate) {
  const dates = new Set();
  for (const r of rows) { const d = r && dayOf(r.date); if (d) dates.add(d); }
  const latest = [...dates].sort().pop() || null;
  if (!isDay(sessionDate)) return { keep: rows, latest };
  return { keep: rows.filter((r) => r && dayOf(r.date) === sessionDate), latest };
}

const netPremiumOf = (r) => {
  const ca = vnum(r.call_premium_ask_side), cb = vnum(r.call_premium_bid_side);
  const pa = vnum(r.put_premium_ask_side), pb = vnum(r.put_premium_bid_side);
  return ca === null || cb === null || pa === null || pb === null ? null : (ca - cb) - (pa - pb);
};

const grossOf = (r) => {
  const c = vnum(r.call_premium), p = vnum(r.put_premium);
  return c === null || p === null ? null : c + p;
};

const otmOf = (r) => {
  const c = vnum(r.call_otm_premium), p = vnum(r.put_otm_premium);
  return c === null || p === null ? null : c + p;
};

export function flowExpiry(body, { sessionDate = null, readAt = null } = {}) {
  const g0 = gate(body, "bare");
  if (g0.quiet) return { ...g0.quiet, readAt };
  if (!g0.rows.length) return silence("quiet", "empty", { readAt });
  const { keep, latest } = sessionDated(g0.rows, sessionDate);
  if (!keep.length) return silence("unavailable", "not-session", { vendorDate: latest, readAt });
  const rows = [];
  for (const r of keep) {
    const e = dayOf(r.expiry);
    const dte = e ? daysBetween(sessionDate || latest, e) : null;
    if (!e || dte === null || dte < 0) continue;
    rows.push({ e, dte, np: netPremiumOf(r), gross: grossOf(r), otm: otmOf(r) });
  }
  rows.sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : 0));
  if (!rows.length) return silence("quiet", "empty", { readAt });
  if (rows.every((r) => r.np === null && r.gross === null)) return silence("unreadable", "malformed", { readAt });
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const grossTotal = sum(rows.map((r) => r.gross ?? 0));
  const absNp = sum(rows.map((r) => Math.abs(r.np ?? 0)));
  const mix = TENOR_BUCKETS.map((b, i) => {
    const lo = i === 0 ? -1 : TENOR_BUCKETS[i - 1].max;
    const inB = rows.filter((r) => r.dte > lo && r.dte <= b.max);
    const gross = sum(inB.map((r) => r.gross ?? 0));
    return {
      b: b.id,
      grossShare: grossTotal > 0 ? round(gross / grossTotal, 4) : null,
      np: usd(sum(inB.map((r) => r.np ?? 0))),
      expiries: inB.length,
    };
  });
  let bucket = null, bucketAbs = 0;
  for (const m of mix) if (Math.abs(m.np) > bucketAbs) { bucketAbs = Math.abs(m.np); bucket = m.b; }
  return {
    status: "ok", why: null,
    asOf: sessionDate || latest,
    readAt,
    netTotal: usd(sum(rows.map((r) => r.np ?? 0))),
    grossTotal: usd(grossTotal),
    otmShare: grossTotal > 0 ? round(sum(rows.map((r) => r.otm ?? 0)) / grossTotal, 4) : note("otmShare", "no-premium"),
    convictionDte: absNp > 0 ? round(sum(rows.map((r) => r.dte * Math.abs(r.np ?? 0))) / absNp, 2) : note("convictionDte", "no-premium"),
    convictionBucket: bucket ?? note("convictionBucket", "no-premium"),
    mix,
    rows: rows.map((r) => ({ e: r.e, dte: r.dte, np: usd(r.np), gross: usd(r.gross), otm: usd(r.otm) })),
    u: { netTotal: "usd", grossTotal: "usd", otmShare: "frac", convictionDte: "days", np: "usd", gross: "usd", otm: "usd", dte: "days" },
    gaps,
  };
}

export function flowStrike(body, { sessionDate = null, spot = null, iv30 = null, walls = null, wallsFrom = null,
  band = POSITIONING_LINES.STRIKE_BAND, cap = POSITIONING_LINES.LADDER_CAP } = {}) {
  const g0 = gate(body, "bare");
  if (g0.quiet) return g0.quiet;
  if (!g0.rows.length) return silence("quiet", "empty");
  const { keep, latest } = sessionDated(g0.rows, sessionDate);
  if (!keep.length) return silence("unavailable", "not-session", { vendorDate: latest });
  const S = vnum(spot);
  if (S === null || !(S > 0)) return silence("unavailable", "no-spot");
  const all = [];
  let vendorAt = null;
  for (const r of keep) {
    const k = vnum(r.strike);
    if (k === null || !(k > 0)) continue;
    all.push({ k, np: netPremiumOf(r), gross: grossOf(r), otm: otmOf(r) });
    const t = toMs(r.timestamp);
    if (t !== null && (vendorAt === null || t > vendorAt)) vendorAt = t;
  }
  if (all.length && all.every((r) => r.np === null && r.gross === null)) return silence("unreadable", "malformed");
  all.sort((a, b) => a.k - b.k);
  const inBand = all.filter((r) => r.k >= S * (1 - band) && r.k <= S * (1 + band));
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const abs = sum(inBand.map((r) => Math.abs(r.np ?? 0)));
  const centroid = abs > 0 ? sum(inBand.map((r) => r.k * Math.abs(r.np ?? 0))) / abs : null;
  const iv = vnum(iv30);
  const sigmaMove = iv !== null && iv > 0 ? iv * Math.sqrt(POSITIONING_LINES.SIGMA_DAYS / 365) : null;
  let longPeak = null, shortPeak = null;
  for (const r of inBand) {
    if (r.np !== null && r.np > 0 && (longPeak === null || r.np > longPeak.np)) longPeak = r;
    if (r.np !== null && r.np < 0 && (shortPeak === null || r.np < shortPeak.np)) shortPeak = r;
  }
  const at = (k) => {
    const K = vnum(k);
    if (K === null) return undefined;
    const row = all.find((r) => r.k === K);
    return row ? row.np : null;
  };
  const w = walls || {};
  const callFlow = at(w.call), putFlow = at(w.put);
  const wallAbs = [callFlow, putFlow].filter((v) => v !== undefined && v !== null).map(Math.abs);
  const ladderRows = inBand.length > cap
    ? inBand.slice().sort((a, b) => Math.abs(b.np ?? 0) - Math.abs(a.np ?? 0)).slice(0, cap).sort((a, b) => a.k - b.k)
    : inBand;
  return {
    status: "ok", why: null,
    asOf: sessionDate || latest,
    vendorAt: vendorAt === null ? null : new Date(vendorAt).toISOString(),
    spot: S,
    band,
    strikes: all.length,
    inBand: inBand.length,
    netBand: usd(sum(inBand.map((r) => r.np ?? 0))),
    centroid: sig(centroid) ?? note("centroid", "no-premium"),
    centroidSigma: centroid === null ? note("centroidSigma", "no-premium")
      : sigmaMove === null ? note("centroidSigma", "no-iv") : round(Math.log(centroid / S) / sigmaMove, 3),
    longPeak: longPeak ? longPeak.k : note("longPeak", "no-premium"),
    shortPeak: shortPeak ? shortPeak.k : note("shortPeak", "no-premium"),
    wallsFrom: wallsFrom || null,
    callWall: vnum(w.call),
    putWall: vnum(w.put),
    callWallFlow: callFlow === undefined ? note("callWallFlow", "no-walls") : callFlow === null ? note("callWallFlow", "no-row") : usd(callFlow),
    putWallFlow: putFlow === undefined ? note("putWallFlow", "no-walls") : putFlow === null ? note("putWallFlow", "no-row") : usd(putFlow),
    wallShare: !wallAbs.length ? note("wallShare", callFlow === undefined && putFlow === undefined ? "no-walls" : "no-row")
      : abs > 0 ? round(sum(wallAbs) / abs, 4) : note("wallShare", "no-premium"),
    ladder: ladderRows.map((r) => ({ k: r.k, np: usd(r.np), gross: usd(r.gross), otm: usd(r.otm) })),
    shed: inBand.length - ladderRows.length,
    u: { centroid: "px", centroidSigma: "sigma", longPeak: "px", shortPeak: "px", netBand: "usd",
      callWallFlow: "usd", putWallFlow: "usd", wallShare: "frac", np: "usd", gross: "usd", otm: "usd", k: "px", band: "frac" },
    gaps,
  };
}

function downsample(points, step = POSITIONING_LINES.DOWNSAMPLE_MIN) {
  const byBucket = new Map();
  for (const p of points) byBucket.set(Math.floor(p.m / step), p);
  return [...byBucket.values()].sort((a, b) => a.m - b.m);
}

export function sessionCandle(candles, sessionDate) {
  for (const c of Array.isArray(candles) ? candles : []) {
    if (Array.isArray(c) && c[0] === sessionDate) {
      const open = vnum(c[1]), close = vnum(c[4]);
      if (open !== null && close !== null && open > 0) return { open, close };
    }
  }
  return null;
}

export function nopeSection(body, { sessionDate = null, candle = null, prior = [], priorFailed = false,
  min = POSITIONING_LINES.NOPE_MIN } = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return { section: g0.quiet, close: null };
  if (!g0.rows.length) return { section: silence("quiet", "empty"), close: null };
  const win = sessionWindow(sessionDate);
  const pts = [];
  for (const r of g0.rows) {
    if (!r || typeof r !== "object") continue;
    const t = toMs(r.timestamp);
    if (t === null || (win && !inSession(t, win))) continue;
    const v = vnum(r.nope);
    if (v === null) continue;
    const cd = vnum(r.call_delta), pd = vnum(r.put_delta), sv = vnum(r.stock_vol);
    pts.push({ t, m: win ? minuteOf(t, win) : null, v, fill: vnum(r.nope_fill),
      check: cd !== null && pd !== null && sv !== null && sv > 0 ? (cd + pd) / sv : null });
  }
  if (!pts.length) return { section: silence("unavailable", "no-rth"), close: null };
  pts.sort((a, b) => a.t - b.t);
  const last = pts[pts.length - 1];
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  let hi = pts[0], lo = pts[0];
  for (const p of pts) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; }
  const ret = candle && candle.open > 0 ? candle.close / candle.open - 1 : null;
  const divergence = ret === null ? note("divergence", "no-price")
    : last.v > 0 && ret < 0 ? "bullish-vs-price"
    : last.v < 0 && ret > 0 ? "bearish-vs-price" : "none";
  const history = (Array.isArray(prior) ? prior : [])
    .filter((p) => p && isDay(p.d) && (!isDay(sessionDate) || p.d < sessionDate))
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .map((p) => p.v);
  const hz = priorFailed ? { z: null, pct: null, n: null, why: "history-unread" } : ownHistory([...history, last.v], { min });
  const ds = downsample(pts.filter((p) => p.m !== null));
  return {
    section: {
      status: "ok", why: null,
      asOf: sessionDate,
      vendorAt: new Date(last.t).toISOString(),
      close: round(last.v, 6),
      closeCheck: round(last.check, 6) ?? note("closeCheck", "no-volume"),
      checkAgrees: last.check === null ? note("checkAgrees", "no-volume") : Math.abs(last.check - last.v) <= POSITIONING_LINES.NOPE_AGREE,
      fill: round(last.fill, 6) ?? note("fill", "no-today"),
      high: round(hi.v, 6), highM: hi.m,
      low: round(lo.v, 6), lowM: lo.m,
      sessionReturn: round(ret, 6),
      divergence,
      z: round(hz.z, 3) ?? note("z", hz.why),
      pct: round(hz.pct, 4) ?? note("pct", hz.why),
      historyN: hz.n ?? note("historyN", hz.why),
      m: ds.map((p) => p.m),
      x: ds.map((p) => round(p.v, 4)),
      u: { close: "ratio", closeCheck: "ratio", fill: "ratio", high: "ratio", low: "ratio", highM: "min", lowM: "min",
        sessionReturn: "frac", z: "sd", pct: "frac", m: "min", x: "ratio" },
      gaps,
    },
    close: last.v,
  };
}

export function gexPath(body, { sessionDate = null } = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return g0.quiet;
  if (!g0.rows.length) return silence("quiet", "empty");
  const win = sessionWindow(sessionDate);
  const pts = [];
  for (const r of g0.rows) {
    if (!r || typeof r !== "object") continue;
    const t = toMs(r.start_time) ?? toMs(r.time);
    if (t === null || (win && !inSession(t, win))) continue;
    pts.push({
      t, m: win ? minuteOf(t, win) : null,
      px: vnum(r.price),
      gOi: vnum(r.gamma_per_one_percent_move_oi), gVol: vnum(r.gamma_per_one_percent_move_vol),
      gDir: vnum(r.gamma_per_one_percent_move_dir),
      cOi: vnum(r.charm_per_one_percent_move_oi), vOi: vnum(r.vanna_per_one_percent_move_oi),
    });
  }
  if (!pts.length) return silence("unavailable", "no-rth");
  pts.sort((a, b) => a.t - b.t);
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const filled = pts.some((p) => (p.gVol !== null && p.gVol !== 0) || (p.gDir !== null && p.gDir !== 0));
  const book = signFlips(pts.map((p) => p.gOi));
  const flow = filled ? signFlips(pts.map((p) => p.gDir)) : null;
  const first = pts.find((p) => p.gOi !== null) || null;
  const lastG = [...pts].reverse().find((p) => p.gOi !== null) || null;
  const last = pts[pts.length - 1];
  const lateCut = POSITIONING_LINES.SESSION_MINUTES - 60;
  const lastHour = pts.filter((p) => p.m !== null && p.m >= lateCut && p.cOi !== null).map((p) => p.cOi);
  const ds = downsample(pts.filter((p) => p.m !== null));
  return {
    status: "ok", why: null,
    asOf: sessionDate,
    vendorAt: new Date(last.t).toISOString(),
    minutes: pts.length,
    flowFilled: filled,
    open: first ? sig(first.gOi) : note("open", "empty"),
    close: lastG ? sig(lastG.gOi) : note("close", "empty"),
    change: first && lastG ? sig(lastG.gOi - first.gOi) : note("change", "empty"),
    flips: book.flips,
    flipM: book.at.slice(0, 12).map((i) => pts[i].m),
    flowFlips: flow ? flow.flips : note("flowFlips", "flow-unfilled"),
    flowFlipM: flow ? flow.at.slice(0, 12).map((i) => pts[i].m) : null,
    charmClose: sig(last.cOi) ?? note("charmClose", "no-today"),
    charmLastHour: lastHour.length ? sig(sum(lastHour) / lastHour.length) : note("charmLastHour", "no-rth"),
    vannaClose: sig(last.vOi) ?? note("vannaClose", "no-today"),
    m: ds.map((p) => p.m),
    px: ds.map((p) => round(p.px, 4)),
    g: ds.map((p) => sig(p.gOi, 5)),
    f: filled ? ds.map((p) => sig(p.gDir, 5)) : null,
    c: ds.map((p) => sig(p.cOi, 5)),
    u: { open: "usdPer1pct", close: "usdPer1pct", change: "usdPer1pct", flips: "count", flipM: "min",
      flowFlips: "count", flowFlipM: "min", charmClose: "vendor", charmLastHour: "vendor", vannaClose: "vendor",
      m: "min", px: "px", g: "usdPer1pct", f: "usdPer1pct", c: "vendor" },
    gaps,
  };
}

export function oiWalls(body, { sessionDate = null, spot = null, atr = null, top = 3 } = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return g0.quiet;
  if (!g0.rows.length) return silence("quiet", "empty");
  const S = vnum(spot), A = vnum(atr);
  if (S === null || !(S > 0)) return silence("unavailable", "no-spot");
  const rows = [];
  const dates = new Set();
  for (const r of g0.rows) {
    if (!r || typeof r !== "object") continue;
    const k = vnum(r.strike), c = vnum(r.call_oi), p = vnum(r.put_oi);
    if (k === null || !(k > 0)) continue;
    const d = dayOf(r.date);
    if (d) dates.add(d);
    rows.push({ k, c, p });
  }
  if (!rows.length) return silence("quiet", "empty");
  const callRows = rows.filter((r) => r.c !== null), putRows = rows.filter((r) => r.p !== null);
  if (!callRows.length && !putRows.length) return silence("unreadable", "malformed");
  rows.sort((a, b) => a.k - b.k);
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const above = callRows.filter((r) => r.k >= S).sort((a, b) => b.c - a.c || a.k - b.k);
  const below = putRows.filter((r) => r.k <= S).sort((a, b) => b.p - a.p || b.k - a.k);
  const callWall = above.length && above[0].c > 0 ? above[0] : null;
  const putWall = below.length && below[0].p > 0 ? below[0] : null;
  const missing = (list) => (list.length ? "no-level" : "malformed");
  const dist = (k, field, why) => (k === null ? note(field, why) : A !== null && A > 0 ? round((k - S) / A, 3) : note(field, "no-atr"));
  const callOi = callRows.length ? sum(callRows.map((r) => r.c)) : null;
  const putOi = putRows.length ? sum(putRows.map((r) => r.p)) : null;
  const date = [...dates].sort().pop() || null;
  const same = isDay(sessionDate) && date ? date === sessionDate : null;
  return {
    status: same === false ? "stale" : "ok",
    why: same === false ? "not-session" : null,
    asOf: date,
    spot: S,
    callWall: callWall ? callWall.k : note("callWall", missing(callRows)),
    callWallOi: callWall ? callWall.c : note("callWallOi", missing(callRows)),
    callWallAtr: dist(callWall ? callWall.k : null, "callWallAtr", missing(callRows)),
    putWall: putWall ? putWall.k : note("putWall", missing(putRows)),
    putWallOi: putWall ? putWall.p : note("putWallOi", missing(putRows)),
    putWallAtr: dist(putWall ? putWall.k : null, "putWallAtr", missing(putRows)),
    calls: above.filter((r) => r.c > 0).slice(0, top).map((r) => ({ k: r.k, oi: r.c })),
    puts: below.filter((r) => r.p > 0).slice(0, top).map((r) => ({ k: r.k, oi: r.p })),
    callOi: callOi ?? note("callOi", "malformed"),
    putOi: putOi ?? note("putOi", "malformed"),
    pcOi: callOi === null || putOi === null ? note("pcOi", "malformed")
      : callOi > 0 ? round(putOi / callOi, 4) : note("pcOi", "no-oi"),
    u: { callWall: "px", putWall: "px", callWallOi: "contracts", putWallOi: "contracts", callWallAtr: "atr",
      putWallAtr: "atr", callOi: "contracts", putOi: "contracts", pcOi: "ratio", oi: "contracts", k: "px" },
    gaps,
  };
}

export function pickLifelineContracts(oiRows, { count = 3 } = {}) {
  const out = [];
  const seen = new Set();
  const rows = (Array.isArray(oiRows) ? oiRows : [])
    .map((r) => ({ oc: r && (r.oc || r.option_symbol), diff: vnum(r && (r.diff ?? r.oi_diff_plain)) }))
    .filter((r) => typeof r.oc === "string" && parseOptionSymbol(r.oc) && r.diff !== null && r.diff > 0)
    .sort((a, b) => b.diff - a.diff || (a.oc < b.oc ? -1 : 1));
  for (const r of rows) {
    if (seen.has(r.oc)) continue;
    seen.add(r.oc);
    out.push(r);
    if (out.length >= count) break;
  }
  return out;
}

const shareOf = (part, whole) => (part !== null && whole !== null && whole > 0 ? part / whole : null);

export function lifeline(body, { id, diff = null, sessionDate = null, sessions = POSITIONING_LINES.LIFE_SESSIONS } = {}) {
  const parsed = parseOptionSymbol(id);
  const head = { id, cp: parsed ? parsed.type : null, k: parsed ? parsed.strike : null, e: parsed ? parsed.expiry : null,
    oiChange: vnum(diff) };
  const g0 = gate(body, "chains");
  if (g0.quiet) return { ...head, ...g0.quiet };
  const days = dedupeByDay(g0.rows, "date", sessionDate).slice(-sessions);
  if (!days.length) return { ...head, ...silence("quiet", "empty") };
  const rows = days.map(([d, r]) => {
    const vol = vnum(r.volume);
    return {
      d, oi: vnum(r.open_interest), vol, iv: vnum(r.implied_volatility),
      ask: vnum(r.ask_volume), sw: vnum(r.sweep_volume), fl: vnum(r.floor_volume), ml: vnum(r.multi_leg_volume),
      prem: vnum(r.total_premium),
    };
  });
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const n = rows.length;
  let i = n - 1;
  while (i > 0 && rows[i].oi !== null && rows[i - 1].oi !== null && rows[i].oi > rows[i - 1].oi) i--;
  const built = i < n - 1;
  const traded = built ? rows.slice(i, n - 1) : [];
  const tot = (k) => sum(traded.map((r) => r[k] ?? 0));
  const volBuild = tot("vol");
  const ivs = rows.map((r) => r.iv).filter((v) => v !== null);
  const same = isDay(sessionDate) ? rows[n - 1].d === sessionDate : null;
  return {
    ...head,
    status: same === false ? "stale" : "ok",
    why: same === false ? "not-session" : null,
    asOf: rows[n - 1].d,
    buildStart: built ? rows[i].d : note("buildStart", "no-build"),
    buildSessions: built ? n - 1 - i : 0,
    buildOi: built ? rows[n - 1].oi - rows[i].oi : note("buildOi", "no-build"),
    askShareBuild: !built ? note("askShareBuild", "no-build") : round(shareOf(tot("ask"), volBuild), 4) ?? note("askShareBuild", "no-volume"),
    sweepShareBuild: !built ? note("sweepShareBuild", "no-build") : round(shareOf(tot("sw"), volBuild), 4) ?? note("sweepShareBuild", "no-volume"),
    floorShareBuild: !built ? note("floorShareBuild", "no-build") : round(shareOf(tot("fl"), volBuild), 4) ?? note("floorShareBuild", "no-volume"),
    ivChange: ivs.length >= 2 ? round(ivs[ivs.length - 1] - ivs[0], 4) : note("ivChange", "short-history"),
    d: rows.map((r) => r.d),
    oi: rows.map((r) => r.oi),
    vol: rows.map((r) => r.vol),
    iv: rows.map((r) => round(r.iv, 4)),
    ask: rows.map((r) => round(shareOf(r.ask, r.vol), 3)),
    sw: rows.map((r) => round(shareOf(r.sw, r.vol), 3)),
    fl: rows.map((r) => round(shareOf(r.fl, r.vol), 3)),
    u: { oiChange: "contracts", buildSessions: "sessions", buildOi: "contracts", askShareBuild: "frac",
      sweepShareBuild: "frac", floorShareBuild: "frac", ivChange: "frac", oi: "contracts", vol: "contracts",
      iv: "frac", ask: "frac", sw: "frac", fl: "frac", k: "px" },
    gaps,
  };
}

export function darkpoolLevels(body, { sessionDate = null, spot = null, atr = null,
  bandAtr = POSITIONING_LINES.DP_BAND_ATR, shelves = POSITIONING_LINES.DP_SHELVES } = {}) {
  const g0 = gate(body, "data");
  if (g0.quiet) return g0.quiet;
  if (!g0.rows.length) return silence("quiet", "empty");
  const vendorDate = body && typeof body === "object" && !Array.isArray(body) ? dayOf(body.date) : null;
  if (isDay(sessionDate) && vendorDate && vendorDate !== sessionDate) {
    return silence("unavailable", "not-session", { vendorDate });
  }
  const S = vnum(spot), A = vnum(atr);
  if (S === null || !(S > 0)) return silence("unavailable", "no-spot");
  if (A === null || !(A > 0)) return silence("unavailable", "no-atr");
  const levels = [];
  for (const r of g0.rows) {
    if (!r || typeof r !== "object") continue;
    const px = vnum(r.price), dark = vnum(r.dark_pool_volume), lit = vnum(r.regular_volume);
    if (px === null || !(px > 0) || dark === null) continue;
    levels.push({ px, dark, lit });
  }
  if (!levels.length) return silence("unreadable", "malformed");
  const inBand = levels.filter((l) => Math.abs(l.px - S) <= bandAtr * A).sort((a, b) => a.px - b.px);
  if (!inBand.length) return silence("quiet", "outside-band", { levels: levels.length });
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  const darks = inBand.map((l) => l.dark);
  const mean = sum(darks) / darks.length;
  const sd = darks.length >= 3 ? Math.sqrt(sum(darks.map((d) => (d - mean) ** 2)) / (darks.length - 1)) : null;
  const shareAt = (l) => (l.lit !== null && l.dark + l.lit > 0 ? round(l.dark / (l.dark + l.lit), 4) : null);
  const top = inBand.slice().sort((a, b) => b.dark - a.dark || a.px - b.px).slice(0, shelves);
  const litKnown = inBand.filter((l) => l.lit !== null);
  const darkTotal = sum(litKnown.map((l) => l.dark)), litTotal = sum(litKnown.map((l) => l.lit));
  if (!(sd > 0)) note("z", darks.length < 3 ? "short-history" : "zero-sd");
  if (litKnown.length < inBand.length) note("share", "malformed");
  return {
    status: "ok", why: null,
    asOf: vendorDate || sessionDate,
    spot: S, atr: A, bandAtr,
    levels: levels.length,
    outside: levels.length - inBand.length,
    darkShare: !litKnown.length ? note("darkShare", "malformed")
      : darkTotal + litTotal > 0 ? round(darkTotal / (darkTotal + litTotal), 4) : note("darkShare", "no-volume"),
    shelves: top.map((l) => ({
      px: l.px, dark: l.dark, share: shareAt(l),
      atr: round((l.px - S) / A, 3),
      z: sd > 0 ? round((l.dark - mean) / sd, 3) : null,
    })),
    profile: inBand.map((l) => ({ px: l.px, dark: l.dark, lit: l.lit, share: shareAt(l) })),
    u: { px: "px", dark: "shares", lit: "shares", share: "frac", atr: "atr", z: "sd", darkShare: "frac", bandAtr: "atr" },
    gaps,
  };
}

const truthy = (v) => v === true || v === "true" || v === 1;

export function alertsTape(rows, ticker, { sessionDate = null, adv = null, complete = true, coverFromM = null,
  dots = POSITIONING_LINES.ALERT_DOTS } = {}) {
  if (rows === undefined) return silence("unavailable", "unread");
  if (rows && !Array.isArray(rows) && typeof rows.__failed === "string") return silence("unavailable", rows.__failed);
  if (!Array.isArray(rows)) return silence("unreadable", "malformed");
  const win = sessionWindow(sessionDate);
  const T = String(ticker || "").toUpperCase();
  const seen = new Set();
  const mine = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || String(r.ticker || "").toUpperCase() !== T) continue;
    const t = toMs(r.start_time) ?? toMs(r.created_at);
    if (t === null || (win && !inSession(t, win))) continue;
    const key = r.id || `${r.option_chain}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mine.push({
      t, m: win ? minuteOf(t, win) : null,
      prem: vnum(r.total_premium) ?? 0,
      ask: vnum(r.total_ask_side_prem) ?? 0,
      sweep: truthy(r.has_sweep),
      opening: truthy(r.all_opening_trades),
      call: String(r.type || "").toLowerCase() === "call",
      volOverOi: vnum(r.volume) !== null && vnum(r.open_interest) !== null && vnum(r.volume) > vnum(r.open_interest),
      k: vnum(r.strike), e: dayOf(r.expiry),
    });
  }
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  if (!mine.length) {
    return { status: "quiet", why: complete ? "empty" : "truncated", asOf: sessionDate, n: 0, complete, coverFromM,
      prem: 0, askShare: note("askShare", "no-premium"), sweepShare: note("sweepShare", "no-premium"),
      openingShare: note("openingShare", "no-premium"), callShare: note("callShare", "no-premium"),
      urgency: note("urgency", "no-premium"), dots: [], u: { prem: "usd", urgency: "frac" }, gaps };
  }
  const P = sum(mine.map((a) => a.prem));
  const w = (pred) => (P > 0 ? sum(mine.filter(pred).map((a) => a.prem)) / P : null);
  const A = vnum(adv);
  const urgentPrem = sum(mine.filter((a) => a.sweep && a.volOverOi).map((a) => a.prem));
  return {
    status: "ok", why: complete ? null : "truncated",
    asOf: sessionDate,
    n: mine.length,
    complete,
    coverFromM,
    prem: usd(P),
    askShare: P > 0 ? round(sum(mine.map((a) => a.ask)) / P, 4) : note("askShare", "no-premium"),
    sweepShare: round(w((a) => a.sweep), 4) ?? note("sweepShare", "no-premium"),
    openingShare: round(w((a) => a.opening), 4) ?? note("openingShare", "no-premium"),
    callShare: round(w((a) => a.call), 4) ?? note("callShare", "no-premium"),
    urgency: A !== null && A > 0 ? round(urgentPrem / A, 6) : note("urgency", "no-adv"),
    dots: mine.slice().sort((a, b) => b.prem - a.prem || a.t - b.t).slice(0, dots).map((a) => ({
      m: a.m, p: usd(a.prem), cp: a.call ? "C" : "P", k: a.k, e: a.e,
      a: a.prem > 0 ? round(a.ask / a.prem, 3) : null, sw: a.sweep, op: a.opening,
    })),
    u: { prem: "usd", askShare: "frac", sweepShare: "frac", openingShare: "frac", callShare: "frac", urgency: "frac",
      coverFromM: "min", m: "min", p: "usd", k: "px", a: "frac" },
    gaps,
  };
}

export function multiLeg(rows, ticker, { sessionDate = null, truncated = false, top = POSITIONING_LINES.MULTI_TOP } = {}) {
  if (rows === undefined) return silence("unavailable", "unread");
  if (rows && !Array.isArray(rows) && typeof rows.__failed === "string") return silence("unavailable", rows.__failed);
  if (!Array.isArray(rows)) return silence("unreadable", "malformed");
  const win = sessionWindow(sessionDate);
  const T = String(ticker || "").toUpperCase();
  const seen = new Set();
  const mine = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || String(r.ticker || "").toUpperCase() !== T) continue;
    const t = toMs(r.executed_at);
    if (t === null || (win && !inSession(t, win))) continue;
    const key = r.id || `${t}|${r.strategy}|${r.net_premium}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mine.push({
      t, m: win ? minuteOf(t, win) : null,
      s: typeof r.strategy === "string" ? r.strategy : "other",
      side: typeof r.net_side === "string" ? r.net_side : null,
      dir: typeof r.direction === "string" ? r.direction : null,
      np: vnum(r.net_premium), tp: vnum(r.total_premium) ?? 0,
      size: vnum(r.size), legs: vnum(r.leg_count),
      k: (Array.isArray(r.strikes) ? r.strikes : []).map(vnum).filter((v) => v !== null),
      dte: [vnum(r.min_dte), vnum(r.max_dte)],
      dl: vnum(r.net_delta), vg: vnum(r.net_vega), gm: vnum(r.net_gamma), th: vnum(r.net_theta),
      opening: truthy(r.all_opening_legs),
    });
  }
  const gaps = {};
  const note = (field, code) => { gaps[field] = code; return null; };
  if (!mine.length) {
    return { status: "quiet", why: truncated ? "truncated" : "empty", asOf: sessionDate, n: 0,
      truncated, byStrategy: [], top: [], u: {}, gaps };
  }
  const byS = new Map();
  for (const x of mine) {
    const e = byS.get(x.s) || { s: x.s, n: 0, np: 0, tp: 0 };
    e.n++; e.np += x.np ?? 0; e.tp += x.tp;
    byS.set(x.s, e);
  }
  const absNp = sum(mine.map((x) => Math.abs(x.np ?? 0)));
  const TP = sum(mine.map((x) => x.tp));
  const total = (k) => sig(sum(mine.map((x) => x[k] ?? 0)));
  return {
    status: "ok", why: truncated ? "truncated" : null,
    asOf: sessionDate,
    n: mine.length,
    truncated,
    netPrem: usd(sum(mine.map((x) => x.np ?? 0))),
    grossPrem: usd(TP),
    netDelta: total("dl"),
    netVega: total("vg"),
    netGamma: total("gm"),
    netTheta: total("th"),
    creditShare: absNp > 0 ? round(sum(mine.filter((x) => (x.np ?? 0) < 0).map((x) => Math.abs(x.np))) / absNp, 4) : note("creditShare", "no-premium"),
    openingShare: TP > 0 ? round(sum(mine.filter((x) => x.opening).map((x) => x.tp)) / TP, 4) : note("openingShare", "no-premium"),
    long: mine.filter((x) => x.dir === "long").length,
    short: mine.filter((x) => x.dir === "short").length,
    byStrategy: [...byS.values()].sort((a, b) => b.tp - a.tp || (a.s < b.s ? -1 : 1))
      .map((e) => ({ s: e.s, n: e.n, np: usd(e.np), tp: usd(e.tp) })),
    top: mine.slice().sort((a, b) => b.tp - a.tp || a.t - b.t).slice(0, top).map((x) => ({
      m: x.m, s: x.s, side: x.side, dir: x.dir, np: usd(x.np), tp: usd(x.tp), size: x.size, legs: x.legs,
      k: x.k, dte: x.dte, dl: sig(x.dl), vg: sig(x.vg),
    })),
    u: { netPrem: "usd", grossPrem: "usd", netDelta: "vendor", netVega: "vendor", netGamma: "vendor", netTheta: "vendor",
      creditShare: "frac", openingShare: "frac", np: "usd", tp: "usd", m: "min", k: "px", dte: "days", dl: "vendor", vg: "vendor" },
    gaps,
  };
}

export function sessionPrints(raw, sessionDate, { limit = null } = {}) {
  if (raw === null || raw === undefined) return raw;
  if (typeof raw === "object" && !Array.isArray(raw) && raw.__failed) return raw;
  const list = rowsOf(raw, "data");
  if (list === null) return raw;
  const win = sessionWindow(sessionDate);
  if (!win) return raw;
  const kept = [];
  let outside = 0, canceled = 0, undated = 0, extendedCode = 0;
  const prems = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    prems.push(vnum(r.premium));
    const t = toMs(r.executed_at);
    if (t === null) { undated++; continue; }
    if (!inSession(t, win)) { outside++; if (typeof r.ext_hour_sold_codes === "string" && /extended/i.test(r.ext_hour_sold_codes)) extendedCode++; continue; }
    if (r.canceled === true) { canceled++; continue; }
    kept.push(r);
  }
  const finite = prems.filter((p) => p !== null);
  const byPremium = finite.length > 1 && finite.every((p, i) => i === 0 || finite[i - 1] >= p);
  const lim = vnum(limit);
  const capped = lim !== null && list.length >= lim;
  return {
    data: kept,
    vendorRows: list.length,
    vendorCapped: capped,
    session: {
      open: win.openIso, close: win.closeIso,
      vendorRows: list.length, kept: kept.length, outside, extendedCode, canceled, undated,
      vendorOrder: byPremium ? "premium" : "time-or-other",
      capped,
      rankedBy: "premium",
    },
  };
}

export function sessionPrintParams(sessionDate, { windowed = true } = {}) {
  const win = sessionWindow(sessionDate);
  if (!win) return {};
  return windowed
    ? { date: sessionDate, newer_than: win.openIso, older_than: win.closeIso, order_by: "premium", order: "desc" }
    : { date: sessionDate, order_by: "premium", order: "desc" };
}

export function readExpiryBreakdown(raw) {
  const list = rowsOf(raw, "data") || [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const e = dayOf(row.expiry ?? row.expires);
    if (!e) continue;
    out.push({ expiry: e, chains: vnum(row.chains), oi: vnum(row.open_interest), volume: vnum(row.volume) });
  }
  out.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
  return out;
}

export function freshStamp({ readAt = null, vendorAt = null, sessionDate = null, source = "nightly", cadenceS = 0,
  writer = "flows-pipeline" } = {}) {
  return { v: 1, readAt, vendorAt, source, cadenceS, session: sessionDate, writer };
}
