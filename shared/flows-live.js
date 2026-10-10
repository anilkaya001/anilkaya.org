import {
  FRESH_CLASSES, easternDay, sessionOpen, easternInstant, easternOffsetMinutes, PHASE_MINUTES, nextWeekdayDay, isTradingDay,
  prevTradingDay,
} from "./flows-freshness.js";
import { buildFlowAlerts, mergeAlerts } from "./flows-alerts.js";
import { rowsOf } from "./flows-rows.js";

export const LIVE_KEY_RE = /^live:[a-z]+(?::[a-z]+)?$/;

const spec = (klass, writer, maxBytes, reads) => Object.freeze({
  klass, writer, maxBytes, cadenceS: FRESH_CLASSES[klass].cadenceS, reads,
});

export const LIVE_KEYS = Object.freeze({
  "live:market": spec("market", "worker", 16 * 1024, 2),
  "live:focus": spec("market", "worker", 16 * 1024, 1),
  "live:breadth": spec("breadth", "actions", 96 * 1024, 17),
  "live:strips": spec("breadth", "actions", 64 * 1024, 1),
  "live:strips:series": spec("breadth", "actions", 112 * 1024, 0),
  "live:alerts": spec("breadth", "actions", 120 * 1024, 5),
  "live:alerts:head": spec("breadth", "actions", 8 * 1024, 0),
  "live:vol": spec("breadth", "actions", 8 * 1024, 0),
  "live:movers": spec("breadth", "actions", 8 * 1024, 0),
  "live:news": spec("breadth", "actions", 32 * 1024, 1),
  "live:heartbeat": spec("breadth", "actions", 8 * 1024, 0),
});

export const TAPE_SPEC = spec("tape", "ondemand", 32 * 1024, 2);

export const LIVE_BUDGET = Object.freeze({
  tier1Calls: 2,
  tier1TimeoutMs: 6000,
  tier2PaceMs: 333,
  tier2MaxCalls: 48,
  tier2HeartbeatSkipMs: 8 * 60 * 1000,
  stripMax: 160,
  stripFocusMax: 40,
  gexFixed: 6,
  gexRotating: 6,
  gexIndex: Object.freeze(["SPY", "QQQ"]),
  gexKeepMs: 2 * 3600 * 1000,
  alertLimit: 200,
  alertPages: 5,
  alertsPerTape: 20,
  alertsHeadRows: 20,
  seriesPoints: 30,
  tapeLeaseMs: 20 * 1000,
  tapeUsableMs: 30 * 60 * 1000,
  tapeWaitMs: 3000,
  tapePreTtlMs: 15 * 60 * 1000,
  tapeRetentionMs: 7 * 86400 * 1000,
  quoteTtlS: Object.freeze({ rth: 5, pre: 30, post: 30, closed: 6 * 3600 }),
  quoteKeepS: 6 * 3600,
  ondemandPerMinute: 120,
});

export const SECTOR_TIDES = Object.freeze([
  Object.freeze({ sector: "Basic Materials", etf: "XLB" }),
  Object.freeze({ sector: "Communication Services", etf: "XLC" }),
  Object.freeze({ sector: "Consumer Cyclical", etf: "XLY" }),
  Object.freeze({ sector: "Consumer Defensive", etf: "XLP" }),
  Object.freeze({ sector: "Energy", etf: "XLE" }),
  Object.freeze({ sector: "Financial Services", etf: "XLF" }),
  Object.freeze({ sector: "Healthcare", etf: "XLV" }),
  Object.freeze({ sector: "Industrials", etf: "XLI" }),
  Object.freeze({ sector: "Real Estate", etf: "XLRE" }),
  Object.freeze({ sector: "Technology", etf: "XLK" }),
  Object.freeze({ sector: "Utilities", etf: "XLU" }),
]);

export const SECTOR_ETF_NAMES = Object.freeze({
  XLB: "Materials", XLC: "Communication Services", XLE: "Energy", XLF: "Financials",
  XLI: "Industrials", XLK: "Information Technology", XLP: "Consumer Staples",
  XLRE: "Real Estate", XLU: "Utilities", XLV: "Health Care", XLY: "Consumer Discretionary",
  SPY: "S&P 500",
});

export const INDEX_NAMES = Object.freeze(["SPY", "QQQ", "IWM"]);

export const BREADTH_ETFS = Object.freeze(["SPY", "QQQ", "IWM", "DIA"]);

export const TIER1_CALLS = Object.freeze([
  Object.freeze({ feed: "tide", path: "/api/market/market-tide", params: Object.freeze({ interval_5m: "true" }) }),
  Object.freeze({ feed: "sectors", path: "/api/market/sector-etfs", params: Object.freeze({}) }),
]);

export const SILENCE = Object.freeze({
  notRead: "not-read",
  failed: "vendor-failed",
  empty: "vendor-empty",
  unshaped: "rows-unshaped",
  prior: "vendor-prior-session",
  plan: "plan:volatility_scope_required",
  missing: "name-not-returned",
  rotated: "rotated-out",
  zeroGross: "zero-gross",
  noBase: "no-base",
  preOpen: "pre-open",
  later: "vendor-later-session",
  otherSession: "other-session",
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function vnum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function timeMs(v) {
  if (typeof v === "string") {
    if (v.length >= 16 && (v.charCodeAt(10) === 84 || v.charCodeAt(10) === 32) && v.charCodeAt(4) === 45) {
      const direct = Date.parse(v);
      if (Number.isFinite(direct)) return direct;
      return Date.parse(v.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"));
    }
    const s = v.trim();
    return /^\d{9,13}(\.\d+)?$/.test(s) ? timeMs(Number(s)) : NaN;
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v <= 0) return NaN;
    return v > 1e12 ? v : v * 1000;
  }
  return NaN;
}

export const isoSec = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) + "Z" : null);

export function easternStamp(ms) {
  if (!Number.isFinite(ms)) return null;
  const off = easternOffsetMinutes(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return new Date(ms + off * 60000).toISOString().slice(0, 19) +
    (off < 0 ? "-" : "+") + pad(Math.floor(Math.abs(off) / 60)) + ":" + pad(Math.abs(off) % 60);
}

const round = (v, dp) => {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export function failed(raw) {
  return !!(raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.__failed === "string");
}

export { rowsOf };

export function envelopeDate(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.date === "string" &&
    DAY_RE.test(raw.date) ? raw.date : null;
}

export function anyAnswered(feeds) {
  return (Array.isArray(feeds) ? feeds : []).some((f) => f && typeof f.status === "string" && f.status !== "unavailable");
}

export function marketFeeds(payload) {
  const p = payload || {};
  return [p.tide, p.sectors];
}

export function feedSilence(raw) {
  if (raw === undefined || raw === null) return { status: "unavailable", reason: SILENCE.notRead };
  if (failed(raw)) return { status: "unavailable", reason: SILENCE.failed, detail: raw.__failed.slice(0, 160) };
  if (!rowsOf(raw).length) return { status: "quiet", reason: SILENCE.empty };
  return null;
}

const variance = (xs) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
};

export function basisCheck(values) {
  const xs = values.filter((v) => v !== null && Number.isFinite(v));
  if (xs.length < 30) return null;
  const level = variance(xs);
  if (!(level > 0)) return null;
  const diffs = [];
  for (let i = 1; i < xs.length; i++) diffs.push(xs[i] - xs[i - 1]);
  return variance(diffs) / level < 0.5 ? "cumulative" : "increment";
}

export function bucketSeries(rows, {
  time = "timestamp", fields = {}, basis = "cumulative", bucketMin = 5, from = null, to = null,
  tail = null, dp = {}, net = ["ncp", "npp"], check = true, recentRows = 0,
} = {}) {
  const names = Object.keys(fields);
  const width = names.length;
  const cols = names.map((n) => fields[n]);
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, bucketMin) * 60000;
  let stampTs = [];
  let stampIdx = [];
  let dropped = 0;
  let sorted = true;
  let prev = -Infinity;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const ts = r && typeof r === "object" ? timeMs(r[time]) : NaN;
    if (!Number.isFinite(ts)) { dropped++; continue; }
    if ((from !== null && ts < from) || (to !== null && ts > to)) continue;
    if (ts < prev) sorted = false;
    prev = ts;
    stampTs.push(ts);
    stampIdx.push(i);
  }
  if (!sorted) {
    const order = stampTs.map((_, j) => j).sort((a, b) => stampTs[a] - stampTs[b] || stampIdx[a] - stampIdx[b]);
    stampTs = order.map((j) => stampTs[j]);
    stampIdx = order.map((j) => stampIdx[j]);
  }
  const n = stampTs.length;

  const kept = [];
  const recent = [];
  let seenCheck = null;
  let seen = 0;
  let lastKey = null;
  if (basis === "increment") {
    const running = new Array(width).fill(null);
    const primary = [];
    for (let j = 0; j < n; j++) {
      const r = list[stampIdx[j]];
      let any = false;
      for (let c = 0; c < width; c++) {
        const v = vnum(r[cols[c]]);
        if (v !== null) { running[c] = (running[c] === null ? 0 : running[c]) + v; any = true; }
        if (c === 0 && check) primary.push(v);
      }
      if (!any) { dropped++; continue; }
      seen++;
      const key = Math.floor(stampTs[j] / size);
      const snap = { ts: stampTs[j], row: running.slice() };
      if (key === lastKey) kept[kept.length - 1] = snap;
      else kept.push(snap);
      lastKey = key;
      if (recentRows > 0) {
        recent.push(snap);
        if (recent.length > recentRows) recent.shift();
      }
    }
    if (check) seenCheck = basisCheck(primary);
  } else {
    for (let j = 0; j < n; j++) {
      const r = list[stampIdx[j]];
      let row = null;
      for (let c = 0; c < width; c++) {
        const v = vnum(r[cols[c]]);
        if (v === null) continue;
        if (row === null) row = new Array(width).fill(null);
        row[c] = v;
      }
      if (row === null) { dropped++; continue; }
      const key = Math.floor(stampTs[j] / size);
      const snap = { ts: stampTs[j], row };
      if (key === lastKey) kept[kept.length - 1] = snap;
      else kept.push(snap);
      lastKey = key;
    }
    seen = n;
    if (check && basis !== "level" && width) {
      const primary = new Array(n);
      for (let j = 0; j < n; j++) primary[j] = vnum(list[stampIdx[j]][cols[0]]);
      seenCheck = basisCheck(primary);
    }
  }
  const trimmed = Number.isFinite(tail) && tail > 0 && kept.length > tail ? kept.slice(-tail) : kept;
  const netA = net ? names.indexOf(net[0]) : -1;
  const netB = net ? names.indexOf(net[1]) : -1;
  const block = (snaps) => {
    const out = { t: snaps.map((k) => isoSec(k.ts)) };
    for (let c = 0; c < width; c++) {
      const d = Object.hasOwn(dp, names[c]) ? dp[names[c]] : 0;
      out[names[c]] = snaps.map((k) => round(k.row[c], d));
    }
    if (netA >= 0 && netB >= 0) {
      out.net = snaps.map((k) => (k.row[netA] !== null && k.row[netB] !== null ? Math.round(k.row[netA] - k.row[netB]) : null));
    }
    return out;
  };
  const main = block(trimmed);
  const series = {
    basis,
    check: seenCheck === null ? null : (seenCheck === basis ? "agrees" : "disagrees"),
    n: trimmed.length, seen, dropped, ...main,
    firstAt: trimmed.length ? isoSec(trimmed[0].ts) : null,
    lastAt: trimmed.length ? isoSec(trimmed[trimmed.length - 1].ts) : null,
  };
  if (recentRows > 0) series.recent = { n: recent.length, ...block(recent) };
  return series;
}

const TIDE_FIELDS = Object.freeze({ ncp: "net_call_premium", npp: "net_put_premium", nv: "net_volume" });
const PX_TIDE_FIELDS = Object.freeze({ ...TIDE_FIELDS, px: "underlying_price" });

function rthWindow(day) {
  if (typeof day !== "string" || !DAY_RE.test(day)) return { from: null, to: null };
  return { from: sessionOpen(day), to: easternInstant(day, PHASE_MINUTES.close + 5) };
}

export function shapeTideFeed(raw, { session, withPx = false, bucketMin = 5, check = true } = {}) {
  const silent = feedSilence(raw);
  if (silent) return { ...silent, date: null, n: 0 };
  const rows = rowsOf(raw);
  const lastRow = rows.length ? rows[rows.length - 1] : null;
  const date = envelopeDate(raw) ||
    (lastRow && typeof lastRow.date === "string" && DAY_RE.test(lastRow.date) ? lastRow.date : null) ||
    easternDay(timeMs(lastRow && lastRow.timestamp));
  const series = bucketSeries(rows, {
    time: "timestamp", fields: withPx ? PX_TIDE_FIELDS : TIDE_FIELDS, basis: "cumulative",
    bucketMin, ...rthWindow(date), dp: { px: 4 }, check,
  });
  if (!series.n) {
    const blank = series.seen > 0 && series.dropped === series.seen;
    return { status: blank ? "quiet" : "unreadable", reason: blank ? SILENCE.empty : SILENCE.unshaped, date, ...series };
  }
  const prior = typeof session === "string" && date && date < session;
  return { status: prior ? "prior" : "ok", reason: prior ? SILENCE.prior : null, date, ...series };
}

export function netFlowRows(raw) {
  const outer = rowsOf(raw);
  const block = outer.find((b) => b && typeof b === "object" && Array.isArray(b.data)) || null;
  return block ? block.data : [];
}

export function shapeNetFlowFeed(raw, { session, expiration, check = true } = {}) {
  const silent = feedSilence(raw);
  if (silent) return { ...silent, expiration, date: null, n: 0 };
  const inner = netFlowRows(raw);
  if (!inner.length) return { status: "quiet", reason: SILENCE.empty, expiration, date: envelopeDate(raw), n: 0 };
  const echoed = raw && Array.isArray(raw.expiration) ? raw.expiration.filter((x) => typeof x === "string") : [];
  const out = shapeTideFeed({ data: inner, date: envelopeDate(raw) }, { session, withPx: true, check });
  return { ...out, expiration, echoed };
}

export function shapeSectorEtfs(raw) {
  const silent = feedSilence(raw);
  if (silent) return { ...silent, rows: [] };
  const rows = [];
  for (const r of rowsOf(raw)) {
    const etf = r && typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
    if (!Object.hasOwn(SECTOR_ETF_NAMES, etf)) continue;
    const px = vnum(r.last);
    const prev = vnum(r.prev_close);
    const bull = vnum(r.bullish_premium);
    const bear = vnum(r.bearish_premium);
    const gross = bull !== null && bear !== null ? bull + bear : null;
    rows.push({
      etf, name: SECTOR_ETF_NAMES[etf],
      px, prev,
      chg: px !== null && prev !== null && prev !== 0 ? round(px / prev - 1, 6) : null,
      callPrem: round(vnum(r.call_premium), 0), putPrem: round(vnum(r.put_premium), 0),
      bull: round(bull, 0), bear: round(bear, 0),
      net: bull !== null && bear !== null ? Math.round(bull - bear) : null,
      lean: gross !== null && gross !== 0 ? round((bull - bear) / gross, 6) : null,
      leanWhy: gross === 0 ? SILENCE.zeroGross : null,
      callVol: vnum(r.call_volume), putVol: vnum(r.put_volume), vol: vnum(r.volume),
    });
  }
  rows.sort((a, b) => (a.etf < b.etf ? -1 : a.etf > b.etf ? 1 : 0));
  if (!rows.length) return { status: "unreadable", reason: SILENCE.unshaped, rows };
  return { status: "ok", reason: null, rows };
}

export function freshEnvelope({ readAt, vendorAt = null, source, cadenceS, session, writer }) {
  const r = typeof readAt === "number" ? readAt : timeMs(readAt);
  const v = vendorAt === null ? NaN : (typeof vendorAt === "number" ? vendorAt : timeMs(vendorAt));
  return {
    v: 1,
    readAt: Number.isFinite(r) ? new Date(r).toISOString() : null,
    vendorAt: Number.isFinite(v) ? isoSec(v) : null,
    source, cadenceS, session: typeof session === "string" && DAY_RE.test(session) ? session : null,
    writer: typeof writer === "string" && writer ? writer.slice(0, 80) : null,
  };
}

function newestAt(list) {
  let best = NaN;
  for (const s of list) {
    const t = s && typeof s.lastAt === "string" ? timeMs(s.lastAt) : NaN;
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return best;
}

const lastOf = (s, f) => (s && Array.isArray(s[f]) && s[f].length ? s[f][s[f].length - 1] : null);
const lastOk = (s, f) => (s && s.status === "ok" ? lastOf(s, f) : null);

export function shapeMarketLive(raws, { at, session, writer = "worker", check = false } = {}) {
  const r = raws || {};
  const tide = shapeTideFeed(r.tide, { session, check });
  const sectors = shapeSectorEtfs(r.sectors);
  const vendorAt = newestAt([tide]);
  return {
    v: 1, key: "live:market", session,
    fresh: freshEnvelope({ readAt: at, vendorAt, source: "worker", cadenceS: LIVE_KEYS["live:market"].cadenceS,
      session, writer }),
    units: {
      ncp: "USD, net call premium, ask side minus bid side, cumulative over the session",
      npp: "USD, net put premium, ask side minus bid side, cumulative (positive = puts bought)",
      net: "USD, ncp - npp (positive = bullish premium), cumulative",
      nv: "contracts, vendor net volume, cumulative",
      t: "ISO-8601 UTC of the sampled vendor row (the last row with values inside each 5-minute bucket)",
      chg: "ratio, last / prev_close - 1", lean: "ratio in [-1, 1], (bull - bear) / (bull + bear)",
    },
    tide, sectors,
    last: { tideNet: lastOk(tide, "net") },
  };
}

function feedDay(raw, rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return envelopeDate(raw) || (last && typeof last.date === "string" && DAY_RE.test(last.date) ? last.date : null) ||
    easternDay(timeMs(last && last.timestamp));
}

export function sectorEtfsDay(raw) {
  if (raw === undefined || raw === null || failed(raw)) return null;
  const count = new Map();
  for (const r of rowsOf(raw)) {
    const d = r && typeof r.prev_date === "string" && DAY_RE.test(r.prev_date) ? r.prev_date : null;
    if (d) count.set(d, (count.get(d) || 0) + 1);
  }
  let best = null;
  for (const [d, n] of count) if (best === null || n > best[1] || (n === best[1] && d > best[0])) best = [d, n];
  return best ? nextWeekdayDay(best[0]) : null;
}

export function tideSessionState(raws, { today, afterProbe }) {
  if (!afterProbe || !raws || typeof raws !== "object") return null;
  const days = [];
  for (const [raw, nested] of [[raws.tide, false], [raws.zeroDte, true], [raws.spy, false], [raws.qqq, false]]) {
    if (raw === undefined || raw === null || failed(raw)) continue;
    const d = feedDay(raw, nested ? netFlowRows(raw) : rowsOf(raw));
    if (d) days.push(d);
  }
  const sectorDay = sectorEtfsDay(raws.sectors);
  if (sectorDay) days.push(sectorDay);
  if (days.includes(today)) return 1;
  return days.length >= 2 && days.every((d) => d === days[0] && d < today) ? 0 : null;
}

export const VERDICT = Object.freeze({
  provisionalUntilMin: 11 * 60,
  unscheduledUntilMin: 15 * 60 + 45,
  agreeMs: 15 * 60 * 1000,
  reprobeEveryMin: 15,
  closedDaysMax: 20,
});

export const verdictReprobeUntilMin = (day) => (isTradingDay(day, null) ? VERDICT.unscheduledUntilMin : VERDICT.provisionalUntilMin);

export function parseClosedDays(value) {
  let list = value;
  if (typeof value === "string") {
    try { list = JSON.parse(value); } catch { list = null; }
  }
  if (!Array.isArray(list)) return [];
  const days = Array.from(new Set(list.filter((d) => typeof d === "string" && DAY_RE.test(d)))).sort();
  return days.slice(-VERDICT.closedDaysMax);
}

export function withClosedDay(list, day, closed = true) {
  const held = parseClosedDays(list).filter((d) => d !== day);
  if (closed && typeof day === "string" && DAY_RE.test(day)) held.push(day);
  return parseClosedDays(held);
}

export function verdictPatch({ seen, trading = null, closedProbeAt = null, closedDays = [], at, today }) {
  if (seen === 1) {
    const patch = { trading: 1, closedProbeAt: null };
    if (trading === 0 || parseClosedDays(closedDays).includes(today)) patch.closedDays = withClosedDay(closedDays, today, false);
    return patch;
  }
  if (seen !== 0 || trading !== null) return {};
  if (!isTradingDay(today, null)) return { trading: 0, closedProbeAt: null };
  const first = Number(closedProbeAt);
  if (!(Number.isFinite(first) && first > 0 && first <= at)) return { closedProbeAt: at };
  if (at - first < VERDICT.agreeMs) return {};
  return { trading: 0, closedDays: withClosedDay(closedDays, today, true) };
}

export function tideLastAt(raw) {
  const rows = rowsOf(raw);
  let best = NaN;
  for (const r of rows) {
    if (!r || (vnum(r.net_call_premium) === null && vnum(r.net_put_premium) === null)) continue;
    const t = timeMs(r.timestamp);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return best;
}

function alignBlock(entries) {
  const keyOf = (iso) => Math.floor(timeMs(iso) / 300000);
  const axis = new Map();
  for (const [, s] of entries) {
    if (!s || !Array.isArray(s.t)) continue;
    for (const iso of s.t) {
      const k = keyOf(iso);
      if (Number.isFinite(k) && !axis.has(k)) axis.set(k, iso);
    }
  }
  const keys = Array.from(axis.keys()).sort((a, b) => a - b);
  const index = new Map(keys.map((k, i) => [k, i]));
  const rows = {};
  for (const [name, s] of entries) {
    const base = { status: s.status, reason: s.reason || null, date: s.date || null, n: s.n || 0 };
    if (!Array.isArray(s.t) || !s.t.length) { rows[name] = base; continue; }
    const fill = () => new Array(keys.length).fill(null);
    const ncp = fill(), npp = fill(), net = fill();
    s.t.forEach((iso, i) => {
      const j = index.get(keyOf(iso));
      if (j === undefined) return;
      ncp[j] = s.ncp[i]; npp[j] = s.npp[i]; net[j] = s.net ? s.net[i] : null;
    });
    rows[name] = { ...base, check: s.check, ncp, npp, net };
  }
  return { t: keys.map((k) => axis.get(k)), rows };
}

export function zeroDteShare(zero, weekly) {
  const off = [zero, weekly].find((s) => !s || s.status !== "ok");
  if (off) return { value: null, zeroNet: null, weeklyNet: null, date: null, reason: (off && off.reason) || SILENCE.notRead };
  if (zero.date !== weekly.date) return { value: null, zeroNet: null, weeklyNet: null, date: null, reason: SILENCE.prior };
  const date = zero.date || null;
  const z = lastOf(zero, "net");
  const w = lastOf(weekly, "net");
  if (z === null || w === null) return { value: null, zeroNet: z, weeklyNet: w, date, reason: SILENCE.unshaped };
  const denom = Math.abs(z) + Math.abs(w);
  if (denom === 0) return { value: null, zeroNet: z, weeklyNet: w, date, reason: SILENCE.zeroGross };
  return { value: round(Math.abs(z) / denom, 6), zeroNet: z, weeklyNet: w, date, reason: null };
}

export function shapeBreadth(raws, { at, session, writer } = {}) {
  const r = raws || {};
  const sectorEntries = SECTOR_TIDES.map(({ sector, etf }) => {
    const s = shapeTideFeed(r.sectors ? r.sectors[sector] : undefined, { session });
    return [sector, { ...s, etf }];
  });
  const block = alignBlock(sectorEntries);
  for (const [sector, s] of sectorEntries) block.rows[sector].etf = s.etf;
  const etf = {};
  for (const t of BREADTH_ETFS) etf[t] = shapeTideFeed(r.etf ? r.etf[t] : undefined, { session, withPx: true });
  const zero = shapeNetFlowFeed(r.zeroDte, { session, expiration: "zero_dte" });
  const weekly = shapeNetFlowFeed(r.weekly, { session, expiration: "weekly" });
  const vendorAt = newestAt([...sectorEntries.map(([, s]) => s), ...BREADTH_ETFS.map((t) => etf[t]), zero, weekly]);
  return {
    v: 1, key: "live:breadth", session,
    fresh: freshEnvelope({ readAt: at, vendorAt, source: "actions", cadenceS: LIVE_KEYS["live:breadth"].cadenceS,
      session, writer }),
    units: {
      ncp: "USD, cumulative net call premium (ask - bid)", npp: "USD, cumulative net put premium (ask - bid)",
      net: "USD, ncp - npp", share: "ratio in [0, 1], |net 0DTE| / (|net 0DTE| + |net weekly|)",
    },
    sectors: block, etf,
    dte: { zero, weekly, share: zeroDteShare(zero, weekly) },
  };
}

export const STRIP_FIELDS = Object.freeze([
  ["px", "close", "USD"], ["prev", "prev_close", "USD"], ["chg", null, "ratio, px / prev - 1"],
  ["ncp", "net_call_premium", "USD"], ["npp", "net_put_premium", "USD"],
  ["net", null, "USD, ncp - npp"], ["bull", "bullish_premium", "USD"], ["bear", "bearish_premium", "USD"],
  ["lean", null, "ratio in [-1, 1], (bull - bear) / (bull + bear)"],
  ["cv", "call_volume", "contracts"], ["pv", "put_volume", "contracts"],
  ["cvAsk", "call_volume_ask_side", "contracts"], ["pvAsk", "put_volume_ask_side", "contracts"],
  ["iv30", "iv30d", "fraction"], ["ivRank", "iv_rank", "0-100"], ["im", "implied_move_perc", "fraction"],
  ["gOi", "gex_gamma_per_one_percent_move_oi", "USD per 1% move"],
  ["gVol", "gex_gamma_per_one_percent_move_vol", "USD per 1% move"],
  ["gDir", "gex_gamma_per_one_percent_move_dir", "USD per 1% move"],
  ["pcr", "put_call_ratio", "ratio"], ["rvol", "relative_volume", "ratio"],
  ["vol", "stock_volume", "shares"],
  ["qa", null, "seconds, the read instant minus the vendor's quote_time; null when the row has no stamp or one after the read"],
].map((x) => Object.freeze(x)));

const STRIP_DP = Object.freeze({ px: 4, prev: 4, chg: 6, lean: 6, iv30: 4, ivRank: 2, im: 4, pcr: 4, rvol: 4 });

export const QUOTE_SKEW_MS = 60 * 1000;

export function lagSeconds(readAtMs, stamp) {
  const q = timeMs(stamp);
  if (!Number.isFinite(q) || !Number.isFinite(readAtMs)) return null;
  const d = readAtMs - q;
  return d < -QUOTE_SKEW_MS ? null : Math.max(0, Math.round(d / 1000));
}

const stripAt = (name) => STRIP_FIELDS.findIndex(([n]) => n === name);

const QA_AT = STRIP_FIELDS.length - 1;

const STRIP_SOURCE = STRIP_FIELDS.map(([, field]) => field);

const STRIP_PLACES = STRIP_FIELDS.map(([n]) => (Object.hasOwn(STRIP_DP, n) ? STRIP_DP[n] : 0));

const [PX, PREV, CHG, NCP, NPP, NET, BULL, BEAR, LEAN] = ["px", "prev", "chg", "ncp", "npp", "net", "bull", "bear", "lean"].map(stripAt);

export function stripValues(row, { at = NaN, fill = null } = {}) {
  const v = new Array(STRIP_FIELDS.length).fill(null);
  for (let i = 0; i < v.length; i++) if (STRIP_SOURCE[i]) v[i] = vnum(row[STRIP_SOURCE[i]]);
  if (v[PREV] === null && fill > 0) v[PREV] = fill;
  v[CHG] = v[PX] !== null && v[PREV] !== null && v[PREV] !== 0 ? v[PX] / v[PREV] - 1 : null;
  v[QA_AT] = lagSeconds(at, row.quote_time);
  v[NET] = v[NCP] !== null && v[NPP] !== null ? v[NCP] - v[NPP] : null;
  const gross = v[BULL] !== null && v[BEAR] !== null ? v[BULL] + v[BEAR] : null;
  v[LEAN] = gross !== null && gross !== 0 ? (v[BULL] - v[BEAR]) / gross : null;
  for (let i = 0; i < v.length; i++) v[i] = round(v[i], STRIP_PLACES[i]);
  return v;
}

export const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export const upperTicker = (t) => (typeof t === "string" ? t.trim().toUpperCase() : "");

export function stripNames({ long = [], short = [], watch = [], focus = [] } = {}, { max = LIVE_BUDGET.stripMax } = {}) {
  const out = [];
  const seen = new Set();
  const add = (t) => {
    const s = upperTicker(t);
    if (!TICKER_RE.test(s) || seen.has(s) || out.length >= max) return;
    seen.add(s); out.push(s);
  };
  for (const t of INDEX_NAMES) add(t);
  for (const t of (Array.isArray(focus) ? focus : []).slice(0, LIVE_BUDGET.stripFocusMax)) add(t);
  const lists = [long, short, watch].map((l) => (Array.isArray(l) ? l : []));
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) add(l[i]);
  return out;
}

export const FILL_AGREE = Object.freeze({ tol: 0.0005, minChecked: 5, share: 0.9 });

export const OFF_ROWS_KEPT = 20;

export function nightlySources({ boards = {}, focus = null } = {}) {
  const day = (v) => (typeof v === "string" && DAY_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  const out = [];
  if (focus && typeof focus === "object") {
    const close = {};
    const held = focus.closes && typeof focus.closes === "object" ? focus.closes : {};
    for (const [t, c] of Object.entries(held)) close[t] = Array.isArray(c) ? c[c.length - 1] : c;
    out.push({ name: "focus", sessionDate: day(focus.sessionDate), close });
  }
  for (const side of ["long", "short", "watch"]) {
    const b = boards && boards[side] && typeof boards[side] === "object" ? boards[side] : null;
    const close = {};
    for (const r of b && Array.isArray(b.rows) ? b.rows : []) {
      const t = r && typeof r.t === "string" ? r.t.trim().toUpperCase() : "";
      if (t && !Object.hasOwn(close, t)) close[t] = r.px;
    }
    out.push({ name: "board:" + side, sessionDate: b ? day(b.sessionDate) : null, close });
  }
  return out;
}

export function priorCloseBase(sources, session, clock = null) {
  const want = typeof session === "string" && DAY_RE.test(session) ? prevTradingDay(session, clock) : null;
  if (!want) return null;
  const close = {};
  const from = {};
  const other = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || typeof s.name !== "string") continue;
    if (s.sessionDate !== want) { if (s.sessionDate) other.push([s.name, s.sessionDate]); continue; }
    for (const [t, v] of Object.entries(s.close && typeof s.close === "object" ? s.close : {})) {
      const x = vnum(v);
      if (x === null || !(x > 0) || Object.hasOwn(close, t)) continue;
      close[t] = x;
      from[t] = s.name;
    }
  }
  return { date: want, close, from, other };
}

function quantile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] : null;
}

export function lagSummary(values) {
  const xs = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return xs.length ? { n: xs.length, p50: quantile(xs, 0.5), p90: quantile(xs, 0.9), max: xs[xs.length - 1] } : null;
}

export function shapeStrips(raw, { at, session, names = [], writer, key = "live:strips", base = null, lag = false } = {}) {
  const silent = feedSilence(raw);
  const shape = {
    v: 1, key, session,
    fields: STRIP_FIELDS.map(([n]) => n),
    units: Object.fromEntries(STRIP_FIELDS.map(([n, , u]) => [n, u])),
    basis: "vendor screener, one call for every name; a null prev_close is filled from the last dated nightly close " +
      "(prevFill); a row the vendor dated before the session is held out (off, missing) and stands as an all-null row",
  };
  const atMs = typeof at === "number" ? at : timeMs(at);
  const freshOf = (vendorAt) => freshEnvelope({ readAt: at, vendorAt, source: LIVE_KEYS[key].writer,
    cadenceS: LIVE_KEYS[key].cadenceS, session, writer });
  if (silent) return { ...shape, fresh: freshOf(null), ...silent, rows: {}, asked: names.length, missing: names.slice(), ahead: { n: 0, maxS: 0 } };
  const seen = new Set();
  const parsed = [];
  const dates = {};
  const list = rowsOf(raw);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const t = r && typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
    if (!t || seen.has(t)) continue;
    seen.add(t);
    const d = typeof r.date === "string" && DAY_RE.test(r.date) ? r.date : null;
    if (d) dates[d] = (dates[d] || 0) + 1;
    parsed.push({ t, r, d });
  }
  const rowDate = Object.entries(dates).sort((a, b) => b[1] - a[1])[0];
  const prior = rowDate && typeof session === "string" && rowDate[0] < session;
  const cut = !prior && typeof session === "string" ? session : null;
  const close = base && base.close && typeof base.close === "object" ? base.close : {};
  let checked = 0;
  let agreed = 0;
  for (let i = 0; base && i < parsed.length; i++) {
    const e = parsed[i];
    const vp = vnum(e.r.prev_close);
    if (vp === null || !(vp > 0) || !Object.hasOwn(close, e.t) || (cut && e.d && e.d < cut)) continue;
    checked++;
    if (Math.abs(vp / close[e.t] - 1) <= FILL_AGREE.tol) agreed++;
  }
  const declined = checked >= FILL_AGREE.minChecked && agreed < FILL_AGREE.share * checked;
  const rows = {};
  const offDates = {};
  const filled = [];
  const from = {};
  const held = new Set();
  let wanted = null;
  let offN = 0;
  let newest = NaN;
  let aheadN = 0;
  let aheadMax = 0;
  for (let i = 0; i < parsed.length; i++) {
    const e = parsed[i];
    if (cut && e.d && e.d < cut) {
      offN++;
      if (offN <= OFF_ROWS_KEPT) offDates[e.t] = e.d;
      if (!wanted) wanted = new Set(names);
      if (wanted.has(e.t)) {
        rows[e.t] = new Array(STRIP_FIELDS.length).fill(null);
        held.add(e.t);
      }
      continue;
    }
    const usable = base && !declined && Object.hasOwn(close, e.t) && vnum(e.r.prev_close) === null;
    const values = stripValues(e.r, { at: atMs, fill: usable ? close[e.t] : null });
    rows[e.t] = values;
    if (usable) {
      filled.push(e.t);
      from[base.from[e.t]] = (from[base.from[e.t]] || 0) + 1;
    }
    if (values[QA_AT] !== null) {
      const q = timeMs(e.r.quote_time);
      if (!(q <= newest)) newest = q;
    } else if (Number.isFinite(atMs)) {
      const q = timeMs(e.r.quote_time);
      if (q > atMs) {
        aheadN++;
        aheadMax = Math.max(aheadMax, Math.round((q - atMs) / 1000));
      }
    }
  }
  const missing = names.filter((t) => !Object.hasOwn(rows, t) || held.has(t));
  const shaped = Object.keys(rows).length - held.size;
  return {
    ...shape, fresh: freshOf(Number.isFinite(newest) ? Math.min(newest, atMs) : null),
    status: !shaped ? "unreadable" : prior ? "prior" : "ok",
    reason: !shaped ? SILENCE.unshaped : prior ? SILENCE.prior : null,
    rowDate: rowDate ? rowDate[0] : null,
    asked: names.length, returned: shaped, missing,
    lag: lag ? lagSummary(Object.values(rows).map((v) => v[QA_AT])) : null,
    ahead: { n: aheadN, maxS: aheadMax },
    off: { n: offN, dates: offDates },
    prevFill: base ? (declined ? { date: base.date, declined: "disagrees", agree: [agreed, checked] }
      : { date: base.date, n: filled.length, from, agree: [agreed, checked], tickers: filled }) : null,
    rows,
  };
}

export const SERIES_SCALE = Object.freeze({ px: 0.01, net: 1000, gex: 10000, iv: 0.0001 });

const LAG_COLS = Object.freeze(["p50", "p90", "max", "ahead"]);

const lagValue = (strips, c) => (c === "ahead" ? (strips.ahead ? strips.ahead.n : null) : strips.lag ? strips.lag[c] : null);

export function appendStripSeries(prev, strips, { at, session, writer, max = LIVE_BUDGET.seriesPoints,
  maxBytes = LIVE_KEYS["live:strips:series"].maxBytes } = {}) {
  const fields = strips && Array.isArray(strips.fields) ? strips.fields : STRIP_FIELDS.map(([n]) => n);
  const idx = (n) => fields.indexOf(n);
  const same = prev && typeof prev === "object" && prev.session === session && Array.isArray(prev.t);
  const out = {
    v: 1, key: "live:strips:series", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:strips:series"].cadenceS,
      session, writer }),
    scale: SERIES_SCALE,
    units: {
      px: "integer x 0.01 USD, relative to base[T] (the first read of the session)",
      net: "integer x 1000 USD, ncp - npp", gex: "integer x 10000 USD per 1% move (gamma, OI)",
      iv: "integer x 0.0001, iv30d fraction", t: "ISO-8601 UTC read instant of each column",
      lag: "seconds, the median (p50), 90th percentile (p90) and largest (max) of read instant minus the rows' quote_time, per column; " +
        "ahead: how many rows carried a quote_time later than the read by more than the skew allowance, per column",
    },
    reset: same ? null : (prev ? "session-boundary" : "cold"),
    t: same ? prev.t.slice() : [],
    base: same && prev.base ? { ...prev.base } : {},
    lag: Object.fromEntries(LAG_COLS.map((c) => [c, same && prev.lag && Array.isArray(prev.lag[c]) ? prev.lag[c].slice() : []])),
    cols: {},
  };
  for (const c of ["px", "net", "gex", "iv"]) {
    out.cols[c] = {};
    const held = same && prev.cols && prev.cols[c] ? prev.cols[c] : {};
    for (const [t, arr] of Object.entries(held)) if (Array.isArray(arr)) out.cols[c][t] = arr.slice();
  }
  const usable = strips && strips.status === "ok" && strips.rows && typeof strips.rows === "object";
  if (!usable) return { ...out, appended: false, why: strips ? strips.reason || strips.status : SILENCE.notRead };
  const stamp = isoSec(typeof at === "number" ? at : timeMs(at));
  const slot = (iso) => Math.floor(timeMs(iso) / (15 * 60000));
  const replace = out.t.length && slot(out.t[out.t.length - 1]) === slot(stamp);
  if (replace) out.t[out.t.length - 1] = stamp;
  else out.t.push(stamp);
  const width = out.t.length;
  const at_ = width - 1;
  for (const c of LAG_COLS) {
    const held = out.lag[c];
    while (held.length < width) held.push(null);
    held.length = width;
    const value = lagValue(strips, c);
    held[at_] = Number.isFinite(value) ? value : null;
  }
  const names = new Set([...Object.keys(strips.rows), ...Object.keys(out.cols.px)]);
  for (const t of names) {
    const row = strips.rows[t] || null;
    const px = row ? row[idx("px")] : null;
    if (px !== null && px !== undefined && !Object.hasOwn(out.base, t)) out.base[t] = px;
    const vals = {
      px: px !== null && px !== undefined && Object.hasOwn(out.base, t) ? Math.round((px - out.base[t]) / SERIES_SCALE.px) : null,
      net: row && row[idx("net")] !== null ? Math.round(row[idx("net")] / SERIES_SCALE.net) : null,
      gex: row && row[idx("gOi")] !== null ? Math.round(row[idx("gOi")] / SERIES_SCALE.gex) : null,
      iv: row && row[idx("iv30")] !== null ? Math.round(row[idx("iv30")] / SERIES_SCALE.iv) : null,
    };
    for (const c of ["px", "net", "gex", "iv"]) {
      const arr = out.cols[c][t] || [];
      while (arr.length < width) arr.push(null);
      arr.length = width;
      arr[at_] = vals[c];
      out.cols[c][t] = arr;
    }
  }
  const dropOldest = (drop) => {
    out.t = out.t.slice(drop);
    for (const c of LAG_COLS) out.lag[c] = out.lag[c].slice(drop);
    for (const c of Object.keys(out.cols)) {
      for (const t of Object.keys(out.cols[c])) out.cols[c][t] = out.cols[c][t].slice(drop);
    }
  };
  if (out.t.length > max) dropOldest(out.t.length - max);
  let trimmed = 0;
  while (out.t.length > 1 && JSON.stringify(out).length > maxBytes - 64) {
    dropOldest(1);
    trimmed++;
  }
  return { ...out, trimmed, appended: !replace, replaced: !!replace };
}

export function shapeVol(indexRaw, { at, session, writer } = {}) {
  const out = {
    v: 1, key: "live:vol", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:vol"].cadenceS, session, writer }),
    units: {
      iv: "fraction (annualised implied volatility at the tenor)",
      slope: "ratio, v90 / v30 - 1 (positive = upward-sloping curve, contango)",
      front: "ratio, v7 / v30 - 1 (positive = inverted front)", ivRank: "0-100",
      steep: "ratio, vendor steepness_180_30 = volatility_180 / volatility_30 (1 = flat)",
      rv: "fraction, vendor realized_volatility (20-session close-to-close, annualised)",
      vrp: "vol points, vendor variance_risk_premium: EX-POST, a past date's implied vol less the realized vol " +
        "that followed it; not an ex-ante premium",
    },
    vix: { status: "unavailable", reason: SILENCE.plan },
    index: {},
  };
  const raws = indexRaw && typeof indexRaw === "object" ? indexRaw : {};
  for (const t of INDEX_NAMES) {
    const r = raws[t];
    if (!r) { out.index[t] = { status: "unavailable", reason: SILENCE.missing }; continue; }
    const iv = {};
    for (const d of [1, 5, 7, 14, 30, 60, 90, 180, 365]) iv["v" + d] = round(vnum(r["volatility_" + d]), 4);
    const ratio = (a, b) => (a !== null && b !== null && b !== 0 ? round(a / b - 1, 6) : null);
    const date = typeof r.date === "string" && DAY_RE.test(r.date) ? r.date : null;
    const prior = !!date && typeof session === "string" && date < session;
    out.index[t] = {
      status: prior ? "prior" : "ok", reason: prior ? SILENCE.prior : null, date, ...iv,
      iv30: round(vnum(r.iv30d), 4), ivRank: round(vnum(r.iv_rank), 2),
      slope: ratio(iv.v90, iv.v30), front: ratio(iv.v7, iv.v30),
      steep: round(vnum(r.steepness_180_30), 6), rv: round(vnum(r.realized_volatility), 4),
      vrp: round(vnum(r.variance_risk_premium), 6),
    };
  }
  return out;
}

export function indexRows(raw) {
  const out = {};
  for (const r of rowsOf(raw)) {
    const t = r && typeof r.ticker === "string" ? r.ticker.trim().toUpperCase() : "";
    if (INDEX_NAMES.includes(t) && !Object.hasOwn(out, t)) out[t] = r;
  }
  return out;
}

export function shapeMovers(strips, { at, session, writer, n = 8 } = {}) {
  const base = {
    v: 1, key: "live:movers", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:movers"].cadenceS, session, writer }),
    basis: "the names in live:strips (focus, board and watch), ranked by the session change against the prior close " +
      "(the vendor's, else the last dated nightly close); a name with neither is unranked; not the whole market",
    units: { chg: "ratio", px: "USD", rvol: "ratio", net: "USD, ncp - npp" },
  };
  if (!strips || strips.status !== "ok") {
    return { ...base, status: strips ? strips.status : "unavailable", reason: strips ? strips.reason : SILENCE.notRead,
      up: [], down: [], active: [] };
  }
  const f = strips.fields;
  const at_ = (row, name) => row[f.indexOf(name)];
  const rows = Object.entries(strips.rows)
    .filter(([t]) => !INDEX_NAMES.includes(t))
    .map(([t, row]) => ({ t, chg: at_(row, "chg"), px: at_(row, "px"), rvol: at_(row, "rvol"), net: at_(row, "net") }));
  const byChg = rows.filter((r) => r.chg !== null).sort((a, b) => b.chg - a.chg || (a.t < b.t ? -1 : 1));
  const byVol = rows.filter((r) => r.rvol !== null).sort((a, b) => b.rvol - a.rvol || (a.t < b.t ? -1 : 1));
  return {
    ...base, status: rows.length ? "ok" : "quiet", reason: rows.length ? null : SILENCE.empty,
    ranked: byChg.length, unranked: rows.length - byChg.length,
    up: byChg.filter((r) => r.chg > 0).slice(0, n),
    down: byChg.filter((r) => r.chg < 0).reverse().slice(0, n),
    active: byVol.slice(0, n),
  };
}

export function gexRotation({ ranked = [], deep = [], tick = 0 } = {}, {
  fixed = LIVE_BUDGET.gexFixed, rotating = LIVE_BUDGET.gexRotating, index = LIVE_BUDGET.gexIndex,
} = {}) {
  const uniq = (xs) => Array.from(new Set(xs.filter((x) => typeof x === "string" && x)));
  const top = uniq(ranked).filter((t) => !index.includes(t)).slice(0, fixed);
  const pool = uniq(deep).filter((t) => !top.includes(t) && !index.includes(t));
  const pick = [];
  if (pool.length) {
    const start = ((Math.floor(tick) * rotating) % pool.length + pool.length) % pool.length;
    for (let i = 0; i < Math.min(rotating, pool.length); i++) pick.push(pool[(start + i) % pool.length]);
  }
  return { fixed: top, rotating: pick, index: index.slice(), all: uniq([...index, ...top, ...pick]) };
}

const GEX_FIELDS = Object.freeze({
  px: "price", gOi: "gamma_per_one_percent_move_oi", gVol: "gamma_per_one_percent_move_vol",
  gDir: "gamma_per_one_percent_move_dir",
});

export function shapeGexSeries(raw, { session, now = null } = {}) {
  const silent = feedSilence(raw);
  if (silent) return { ...silent, n: 0 };
  const { from, to: end } = rthWindow(session);
  const to = Number.isFinite(now) && end !== null ? Math.min(now, end) : (Number.isFinite(now) ? now : end);
  const s = bucketSeries(rowsOf(raw), { time: "start_time", fields: GEX_FIELDS, basis: "level", bucketMin: 5,
    from, to, dp: { px: 4 }, net: null });
  if (!s.n) {
    const any = bucketSeries(rowsOf(raw), { time: "start_time", fields: GEX_FIELDS, basis: "level", net: null });
    if (!any.n) return { status: "unreadable", reason: SILENCE.unshaped, n: 0 };
    const lastDay = easternDay(timeMs(any.lastAt));
    if (typeof session === "string" && lastDay && lastDay > session) {
      return { status: "unreadable", reason: SILENCE.later, n: 0, lastAt: any.lastAt };
    }
    return lastDay === session
      ? { status: "quiet", reason: SILENCE.preOpen, n: 0, lastAt: any.lastAt }
      : { status: "prior", reason: SILENCE.prior, n: 0, lastAt: any.lastAt };
  }
  const flows = ["gVol", "gDir"].map((f) => s[f].some((v) => v !== null && v !== 0));
  return { status: "ok", reason: null, ...s, flowFilled: flows[0] || flows[1],
    last: { at: s.lastAt, px: lastOf(s, "px"), gOi: lastOf(s, "gOi"), gVol: lastOf(s, "gVol"), gDir: lastOf(s, "gDir") } };
}

export function mergeGex(prev, reads, { at, session, writer, rotation, keepMs = LIVE_BUDGET.gexKeepMs,
  maxBytes = 64 * 1024 } = {}) {
  const now = typeof at === "number" ? at : timeMs(at);
  const same = prev && typeof prev === "object" && prev.session === session && prev.names;
  const names = {};
  if (same) {
    for (const [t, held] of Object.entries(prev.names)) {
      if (!held || !held.last || !Number.isFinite(timeMs(held.readAt))) continue;
      if (now - timeMs(held.readAt) > keepMs) continue;
      names[t] = { readAt: held.readAt, status: held.status, reason: SILENCE.rotated, last: held.last,
        flowFilled: held.flowFilled ?? null, lagS: held.lagS ?? null };
    }
  }
  let newest = NaN;
  for (const [t, s] of Object.entries(reads || {})) {
    const readAt = new Date(now).toISOString();
    if (s.status !== "ok") {
      names[t] = names[t] ? { ...names[t], reason: s.reason || s.status, triedAt: readAt }
        : { readAt, status: s.status, reason: s.reason, last: null };
      continue;
    }
    const stamped = timeMs(s.last && s.last.at);
    if (Number.isFinite(stamped) && !(stamped <= newest)) newest = stamped;
    names[t] = { readAt, status: "ok", reason: null, flowFilled: s.flowFilled, last: s.last, lagS: lagSeconds(now, s.last && s.last.at),
      t: s.t, px: s.px, gOi: s.gOi, gVol: s.gVol, gDir: s.gDir };
  }
  const out = {
    v: 1, key: "live:gex", session,
    fresh: freshEnvelope({ readAt: now, vendorAt: Number.isFinite(newest) ? Math.min(newest, now) : null, source: "actions",
      cadenceS: FRESH_CLASSES.breadth.cadenceS, session, writer }),
    units: {
      gOi: "USD of dealer gamma per 1% move, open-interest book (put legs arrive negative; net = call + put)",
      gVol: "USD per 1% move, today's volume book", gDir: "USD per 1% move, directionalised book",
      px: "USD", t: "ISO-8601 UTC, 5-minute buckets inside the regular session",
      lagS: "seconds, this name's read instant minus the vendor's newest row for it; a carried name keeps the lag of its own read",
    },
    rotation: rotation || null,
    reset: same ? null : (prev ? "session-boundary" : "cold"),
    names,
  };
  const shedOrder = [...(rotation ? rotation.fixed : []), ...(rotation ? rotation.rotating : [])].reverse();
  let size = JSON.stringify(out).length;
  const shed = [];
  for (const t of shedOrder) {
    if (size <= maxBytes) break;
    const n = out.names[t];
    if (!n || !n.t) continue;
    delete n.t; delete n.px; delete n.gOi; delete n.gVol; delete n.gDir;
    shed.push(t);
    size = JSON.stringify(out).length;
  }
  out.shed = shed;
  return out;
}

export function alertsCursor(rawRows, prior = null) {
  let best = prior ? timeMs(prior) : NaN;
  for (const r of Array.isArray(rawRows) ? rawRows : []) {
    const t = timeMs(r && r.created_at);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

export function oldestCreated(rawRows) {
  let best = NaN;
  for (const r of Array.isArray(rawRows) ? rawRows : []) {
    const t = timeMs(r && r.created_at);
    if (Number.isFinite(t) && !(t >= best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : null;
}

export function alertsPagePlan(prev, session) {
  const same = prev && typeof prev === "object" && prev.sessionDate === session &&
    typeof prev.cursor === "string" && prev.cursor;
  return { newerThan: same ? prev.cursor : session, resumed: !!same };
}

export function mergeLiveAlerts(prev, pages, { at, session, stageOf = null, writer, readLimit = null } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const rawRows = [];
  let lastFull = false;
  for (const p of list) {
    const rows = rowsOf(p && p.body);
    for (const r of rows) rawRows.push(r);
    lastFull = !!(p && p.full);
  }
  const stageMap = typeof stageOf === "function" ? stageOf : () => null;
  const held = prev && typeof prev === "object" && prev.sessionDate === session ? prev : null;
  const prevStage = new Map(((held && held.rows) || []).map((r) => [r.t, r.st]));
  const alerts = buildFlowAlerts(rawRows, {
    stageOf: (t) => stageMap(t) || prevStage.get(t) || null,
    stageComplete: false,
    cap: rawRows.length || 1,
  });
  const readAt = new Date(typeof at === "number" ? at : timeMs(at)).toISOString();
  const cursor = alertsCursor(rawRows, held && held.cursor);
  if (!(alerts.status === "ok" && alerts.rows.length)) {
    return { write: null, mode: "declined", why: rawRows.length ? SILENCE.unshaped : SILENCE.empty,
      read: rawRows.length, cursor: held ? held.cursor : null };
  }
  const merged = mergeAlerts(held || prev || null, alerts, { at: readAt, sessionDate: session });
  if (!merged.rows.length) {
    return { write: null, mode: "declined", why: SILENCE.unshaped, read: rawRows.length, cursor };
  }
  const truncatedNow = lastFull && list.length >= LIVE_BUDGET.alertPages;
  const last = list.length ? list[list.length - 1] : null;
  const cutShort = list.length > 1 && !!last && failed(last.body);
  return {
    mode: merged.record.reset ? "reset" : "merged",
    read: rawRows.length,
    cursor,
    write: {
      v: 2, key: "live:alerts", session,
      generatedAt: readAt, sessionDate: session, readAt, readDay: easternDay(readAt), refreshed: "intraday",
      fresh: freshEnvelope({ readAt, vendorAt: cursor, source: "actions", cadenceS: LIVE_KEYS["live:alerts"].cadenceS,
        session, writer }),
      ...merged,
      vendorLimit: LIVE_BUDGET.alertLimit,
      vendorTruncated: truncatedNow,
      readLimit: readLimit === null ? LIVE_BUDGET.alertLimit * LIVE_BUDGET.alertPages : readLimit,
      readTruncated: truncatedNow || cutShort || (!merged.record.reset && !!held && held.readTruncated === true),
      readCut: cutShort ? SILENCE.failed : null,
      cursor, pages: list.length,
    },
  };
}

export function shapeAlertsHead(alerts, { writer, cap = LIVE_BUDGET.alertsHeadRows } = {}) {
  const a = alerts && typeof alerts === "object" ? alerts : null;
  const f = a && a.fresh && typeof a.fresh === "object" ? a.fresh : null;
  if (!a || !f || !Array.isArray(a.rows)) return null;
  const spec_ = LIVE_KEYS["live:alerts:head"];
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v) => (typeof v === "string" && v ? v : null);
  const usable = a.rows
    .filter((r) => r && typeof r === "object" && typeof r.t === "string" && r.t && n(r.prem) !== null)
    .sort((x, y) => (y.prem - x.prem) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0) || ((x.oc || "") < (y.oc || "") ? -1 : 1));
  const pick = (r) => ({
    t: r.t, oc: text(r.oc), cp: text(r.cp), k: n(r.k), exp: text(r.exp),
    prem: r.prem, askPrem: n(r.askPrem), bidPrem: n(r.bidPrem), size: n(r.size), trades: n(r.trades),
    sweep: r.sweep === true, opening: r.opening === true, px: n(r.px), firstAt: text(r.firstAt),
  });
  const build = (rows) => ({
    v: 1, key: "live:alerts:head", session: f.session,
    fresh: freshEnvelope({ readAt: f.readAt, vendorAt: f.vendorAt, source: spec_.writer, cadenceS: spec_.cadenceS,
      session: f.session, writer }),
    basis: "vendor-flagged windows, largest premium first",
    status: rows.length ? "ok" : "quiet",
    cap, seen: usable.length, shed: usable.length - rows.length,
    premium: usable.reduce((sum, r) => sum + r.prem, 0),
    truncated: a.vendorTruncated === true || a.readTruncated === true,
    cursor: text(a.cursor),
    rows,
  });
  let rows = usable.slice(0, Math.max(0, cap)).map(pick);
  let out = build(rows);
  while (rows.length && JSON.stringify(out).length > spec_.maxBytes) {
    rows = rows.slice(0, -1);
    out = build(rows);
  }
  return out;
}

export const TAPE_LEGS = Object.freeze(["prem", "gex"]);

const TAPE_PREM = Object.freeze({ ncp: "net_call_premium", npp: "net_put_premium", nd: "net_delta",
  cv: "call_volume", pv: "put_volume", cva: "call_volume_ask_side", cvb: "call_volume_bid_side",
  pva: "put_volume_ask_side", pvb: "put_volume_bid_side" });

export function shapeTapePrem(raws, { at, session, now = null, alertsCap = LIVE_BUDGET.alertsPerTape, check = false } = {}) {
  const r = raws || {};
  const { from } = rthWindow(session);
  const to = Number.isFinite(now) ? now : null;
  let prem;
  const ps = feedSilence(r.ticks);
  if (ps) prem = { ...ps, n: 0 };
  else {
    const s = bucketSeries(rowsOf(r.ticks), { time: "tape_time", fields: TAPE_PREM, basis: "increment", bucketMin: 5,
      from, to, recentRows: 30, check });
    prem = s.n ? { status: "ok", reason: null, ...s } : { status: "unreadable", reason: SILENCE.unshaped, n: 0 };
  }
  let alerts;
  const as = feedSilence(r.alerts);
  if (as) alerts = { ...as, rows: [] };
  else {
    const inSession = [];
    let outside = 0;
    for (const row of rowsOf(r.alerts)) {
      const day = easternDay(timeMs(row && row.created_at));
      if (day && typeof session === "string" && day !== session) outside++;
      else inSession.push(row);
    }
    const built = buildFlowAlerts(inSession, { stageOf: () => null, stageComplete: false, cap: alertsCap });
    const status = !inSession.length ? "quiet" : built.status;
    alerts = { status, reason: status === "ok" ? null : (!inSession.length ? SILENCE.otherSession : SILENCE.unshaped),
      rows: built.rows, seen: built.seen, shed: built.shed, outside, coverage: built.coverage };
  }
  const atMs = typeof at === "number" ? at : timeMs(at);
  const readAt = new Date(atMs).toISOString();
  return { prem: { ...prem, readAt, lagS: lagSeconds(atMs, prem.lastAt) }, alerts: { ...alerts, readAt } };
}

export function shapeTapeGex(raws, { at, session, now = null } = {}) {
  const gex = shapeGexSeries((raws || {}).spot, { session, now: Number.isFinite(now) ? now : null });
  const atMs = typeof at === "number" ? at : timeMs(at);
  return { gex: { ...gex, readAt: new Date(atMs).toISOString(), lagS: lagSeconds(atMs, gex.lastAt) } };
}

export function nextTapeLeg(held) {
  if (!held || typeof held !== "object") return "prem";
  const age = (leg) => {
    const f = held[leg];
    const t = f && typeof f.readAt === "string" ? timeMs(f.readAt) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  return age("gex") < age("prem") ? "gex" : "prem";
}

export function assembleTape(held, legs, { ticker, session }) {
  const base = held && typeof held === "object" && held.session === session ? held : {};
  const parts = {
    prem: legs.prem || base.prem || { status: "pending", reason: SILENCE.notRead, n: 0, readAt: null },
    alerts: legs.alerts || base.alerts || { status: "pending", reason: SILENCE.notRead, rows: [], readAt: null },
    gex: legs.gex || base.gex || { status: "pending", reason: SILENCE.notRead, n: 0, readAt: null },
  };
  const reads = [parts.prem.readAt, parts.gex.readAt].map((x) => (typeof x === "string" ? timeMs(x) : NaN));
  const known = reads.filter(Number.isFinite);
  const oldest = known.length === 2 ? Math.min(...known) : known.length ? known[0] : NaN;
  const vendorAt = newestAt([parts.prem, parts.gex]);
  return {
    v: 1, key: "tape", ticker, session,
    fresh: freshEnvelope({ readAt: oldest, vendorAt, source: "ondemand", cadenceS: TAPE_SPEC.cadenceS, session,
      writer: "worker@tape" }),
    legs: TAPE_LEGS,
    units: {
      ncp: "USD, cumulative net call premium over the session (ask - bid)",
      npp: "USD, cumulative net put premium (positive = puts bought)", net: "USD, ncp - npp",
      nd: "delta (shares-equivalent), cumulative directional delta flow", cv: "contracts, cumulative",
      cva: "contracts, cumulative call volume on the ask", cvb: "contracts, cumulative call volume on the bid",
      gOi: "USD of dealer gamma per 1% move (OI book)", px: "USD",
      recent: "the last 30 one-minute points of the same cumulative paths",
      readAt: "each leg carries its own read instant; fresh.readAt is the older of prem and gex",
    },
    ...parts,
  };
}

export function shapeTickerTape(raws, { at, session, ticker, now = null, alertsCap = LIVE_BUDGET.alertsPerTape,
  check = false } = {}) {
  return assembleTape(null, {
    ...shapeTapePrem(raws, { at, session, now, alertsCap, check }),
    ...shapeTapeGex(raws, { at, session, now }),
  }, { ticker, session });
}

export function pulseWithLive(pulse, market) {
  if (!pulse || typeof pulse !== "object" || !market || typeof market !== "object") return null;
  const tide = market.tide;
  if (!tide || tide.status !== "ok" || !Array.isArray(tide.t) || !tide.t.length) return null;
  const nightlyPoints = pulse.tide && Array.isArray(pulse.tide.points) ? pulse.tide.points.length : 0;
  if (tide.t.length < 2 && nightlyPoints >= 2) return null;
  const readAt = market.fresh && market.fresh.readAt;
  if (typeof readAt !== "string") return null;
  const liveDay = tide.date || market.session;
  const nightlyDay = typeof pulse.sessionDate === "string" ? pulse.sessionDate : null;
  if (nightlyDay && liveDay && liveDay < nightlyDay) return null;
  if (typeof pulse.readAt === "string" && Date.parse(pulse.readAt) >= Date.parse(readAt)) return null;
  const points = tide.t.map((t, i) => ({ t: easternStamp(timeMs(t)), callPrem: tide.ncp[i], putPrem: tide.npp[i],
    vol: tide.nv ? tide.nv[i] : null }));
  return {
    ...pulse,
    tide: { status: "ok", points, seen: tide.seen ?? points.length, cap: points.length, shed: 0, date: liveDay },
    readAt, readDay: easternDay(readAt), refreshed: "intraday",
    cadenceMinutes: LIVE_KEYS["live:market"].cadenceS / 60,
    live: { key: "live:market", session: market.session, tideDate: liveDay },
  };
}

export function liveAlertsWin(nightlySession, liveSession) {
  if (typeof liveSession !== "string" || !DAY_RE.test(liveSession)) return false;
  if (typeof nightlySession !== "string" || !DAY_RE.test(nightlySession)) return true;
  return liveSession > nightlySession;
}

export function liveNewsWins(nightly, liveSession, liveReadAt) {
  if (typeof liveSession !== "string" || !DAY_RE.test(liveSession) || !Number.isFinite(liveReadAt)) return false;
  const day = nightly && typeof nightly.session === "string" && DAY_RE.test(nightly.session) ? nightly.session : null;
  if (!day || liveSession !== day) return !day || liveSession > day;
  const read = timeMs(nightly.readAt);
  return !Number.isFinite(read) || liveReadAt > read;
}

export function newsWithLive(news, { session, readAt, cadenceS }) {
  if (!news || typeof news !== "object" || news.status !== "ok" || !Array.isArray(news.rows) || !news.rows.length) return null;
  const at = new Date(readAt).toISOString();
  return { ...news, sessionDate: session, generatedAt: at, readAt: at, readDay: easternDay(readAt), refreshed: "intraday",
    cadenceMinutes: cadenceS / 60, live: { key: "live:news", session } };
}

export function liveFeedsForBrief({ pulse = null, market = null, alerts = null, alertsSession = null,
  nightlyAlertsSession = null } = {}) {
  const feeds = {};
  const p = pulseWithLive(pulse, market);
  if (p) feeds.pulse = p;
  if (alerts && liveAlertsWin(nightlyAlertsSession, alertsSession)) feeds.flowalerts = alerts;
  return feeds;
}

export function liveKeyFromParam(k) {
  const raw = typeof k === "string" ? k.trim().toLowerCase() : "";
  const key = raw.startsWith("live:") ? raw : "live:" + raw;
  return LIVE_KEY_RE.test(key) && Object.hasOwn(LIVE_KEYS, key) ? key : null;
}

export function checkLiveWrite(key, body, { source } = {}) {
  const spec_ = Object.hasOwn(LIVE_KEYS, key) ? LIVE_KEYS[key] : null;
  if (!spec_) return { ok: false, status: 400, code: "invalid_key", message: "Unknown live key" };
  if (source && spec_.writer !== source) {
    return { ok: false, status: 403, code: "wrong_writer", message: `${key} has one writer: ${spec_.writer}` };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, code: "invalid_payload", message: "A live payload is a JSON object" };
  }
  const f = body.fresh;
  if (!f || typeof f !== "object" || f.v !== 1) {
    return { ok: false, status: 400, code: "invalid_fresh", message: "A live payload carries fresh.v = 1" };
  }
  const readAt = timeMs(f.readAt);
  if (!Number.isFinite(readAt)) return { ok: false, status: 400, code: "invalid_fresh", message: "fresh.readAt is not an instant" };
  if (typeof f.session !== "string" || !DAY_RE.test(f.session)) {
    return { ok: false, status: 400, code: "invalid_fresh", message: "fresh.session is not a YYYY-MM-DD day" };
  }
  if (f.cadenceS !== spec_.cadenceS) {
    return { ok: false, status: 400, code: "invalid_fresh", message: `fresh.cadenceS must be ${spec_.cadenceS} for ${key}` };
  }
  if (f.source !== spec_.writer) {
    return { ok: false, status: 400, code: "invalid_fresh", message: `fresh.source must be ${spec_.writer}` };
  }
  return { ok: true, meta: { readAt, session: f.session, cadenceS: spec_.cadenceS, source: f.source,
    writer: typeof f.writer === "string" && f.writer ? f.writer.slice(0, 80) : spec_.writer } };
}

export function nightlyFreshMeta(row) {
  if (!row) return null;
  const readIso = typeof row.read_iso === "string" ? row.read_iso : null;
  const session = typeof row.session === "string" && DAY_RE.test(row.session.slice(0, 10))
    ? row.session.slice(0, 10) : null;
  return { readAt: readIso, session, cadenceS: 0, source: "nightly", klass: "nightly" };
}
