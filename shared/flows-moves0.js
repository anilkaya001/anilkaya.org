import { isTarget } from "./flows-targets.js";

export const MOVE_ID = "move.im1.h1";

export const SESSIONS_PER_YEAR = 252;

export const EVENT_SESSIONS = 21;

export const BEYOND = 3;

export const UNIT = "IV-days";

export const LINE = "A ranking, not a test: no error rate measured.";

export const CAPTION = "IV as of the previous close.";

export const APART = "Earnings within 21 sessions: event not separated.";

export const GRADE_NOTE = "From 30-day IV; no surface.";

export const SECTOR_BEYOND = 2;

export const NARROW_PX = 640;

export const NO_SECTOR = "No sector";

export const LIST_VIEWS = Object.freeze(["names", "sectors"]);

export const STEP_EDGES = Object.freeze([0.5, 1, 2, 3]);

export const SECTORS_LINE = "Each sector's median move, and its names beyond 2 IV-days.";

export const MEDIAN_NOTE = "Median is signed, in IV-days.";

export const BEYOND_NOTE = "Beyond 2 counts names more than 2 IV-days from flat, up or down.";

export const SHARE_NOTE = "Share is that count over the sector's names.";

export const LEFT_OUT_NOTE = "Names reporting within 21 sessions are left out of every row.";

export const PINS_NOTE = "SPY and QQQ are left out by ticker.";

export const WHY_NO_IV = "No implied volatility is published for these names.";

export const WHY_ALL_EVENT = "Every measured name reports within 21 sessions.";

export const X_LINE = "Across: the move in the name's own typical days.";

export const Y_LINE = "Up: the move as a multiple of the implied day.";

export const SIZE_LINE = "Dot area is market cap; the smallest dot when unknown.";

export const REF_LINE = "Dashed lines are reference marks, not a test.";


export const FROZEN_LINE = "Scores held. Resume to apply the latest read.";

export const MIN_DOT_PX = 2.5;

export const TOP_INTERACTIVE = 60;

export const FORBIDDEN_WORDS = Object.freeze(["unusual", "alert", "screen", "rare"]);

export const HEADER_WORDS_MAX = 14;

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const SQRT_YEAR = Math.sqrt(SESSIONS_PER_YEAR);

export function ivDays(chg, iv30p) {
  const c = finite(chg);
  const iv = finite(iv30p);
  if (c === null || iv === null || !(iv > 0)) return null;
  return c / (iv / SQRT_YEAR);
}

export function eventInside(ed) {
  const e = finite(ed);
  return e !== null && e <= EVENT_SESSIONS;
}

export function moveOf(row) {
  if (!row || typeof row.t !== "string" || !row.t) return null;
  const m = ivDays(row.chg, row.iv30p);
  if (m === null) return null;
  const event = eventInside(row.ed);
  return { t: row.t, chg: row.chg, iv30p: row.iv30p, ed: finite(row.ed), m, event, grade: event ? 0 : 1, src: row.src || null };
}

const byTicker = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0);

export function rankMoves(rows, side) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = moveOf(r);
    if (x) out.push(x);
  }
  const keep = side === "down" ? (x) => x.m < 0 : (x) => x.m > 0;
  const order = side === "down" ? (a, b) => a.m - b.m || byTicker(a, b) : (a, b) => b.m - a.m || byTicker(a, b);
  const picked = out.filter(keep);
  return {
    clean: picked.filter((x) => !x.event).sort(order),
    apart: picked.filter((x) => x.event).sort(order),
  };
}

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = v.length >> 1;
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}

export function context(rows) {
  const moves = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const x = moveOf(r);
    if (x) moves.push(x);
  }
  const clean = moves.filter((x) => !x.event);
  const med = median(clean.map((x) => Math.abs(x.m)));
  const beyond = clean.filter((x) => Math.abs(x.m) > BEYOND).length;
  return { ranked: clean.length, apart: moves.length - clean.length, median: med, beyond };
}

export function contextLine(ctx) {
  if (!ctx || ctx.median === null || ctx.median === undefined) return null;
  return "Median |m| " + ctx.median.toFixed(1) + " " + UNIT + "; " + ctx.beyond + " of " + ctx.ranked + " beyond " + BEYOND + ".";
}

export function signedIvDays(m) {
  if (!Number.isFinite(m)) return null;
  const s = m.toFixed(1);
  return (m < 0 ? "−" : m > 0 ? "+" : "") + (m < 0 ? s.slice(1) : s);
}

export function dirOf(m) {
  if (!Number.isFinite(m)) return null;
  return m > 0 ? "up" : m < 0 ? "down" : "flat";
}

export function stepOf(m) {
  if (!Number.isFinite(m)) return null;
  const a = Math.abs(m);
  let n = 0;
  while (n < STEP_EDGES.length && a >= STEP_EDGES[n]) n++;
  return n;
}

export function zOf(chg, sig) {
  const c = finite(chg);
  const s = finite(sig);
  if (c === null || s === null || !(s > 0) || !(c > -1)) return null;
  return Math.log1p(c) / s;
}

export function impliedDay(iv30p) {
  const iv = finite(iv30p);
  return iv === null || !(iv > 0) ? null : iv / SQRT_YEAR;
}

export function impliedMultiple(chg, iv30p) {
  const m = ivDays(chg, iv30p);
  return m === null ? null : Math.abs(m);
}

export function radarPoint(row) {
  const x = moveOf(row);
  if (!x) return null;
  return { ...x, sig: finite(row.sig), z: zOf(row.chg, row.sig), r: Math.abs(x.m), cap: finite(row.cap) > 0 ? row.cap : null };
}

export const DOMAIN_QUANTILE = 0.995;

export function quantileOf(values) {
  if (!values.length) return 0;
  const v = values.slice().sort((a, b) => a - b);
  return v[Math.max(0, Math.ceil(DOMAIN_QUANTILE * v.length) - 1)];
}

export function radarDomain(points) {
  const p = points.filter((x) => x.z !== null);
  return {
    xmax: Math.min(12, Math.max(3, Math.ceil(quantileOf(p.map((x) => Math.abs(x.z)))))),
    ymax: Math.min(10, Math.max(3, Math.ceil(quantileOf(p.map((x) => x.r))))),
  };
}

export const PEER_MIN = 10;

export const PEER_PINS = Object.freeze(["SPY", "QQQ"]);

export const MAD_SCALE = 1.4826;

export const PARTS_LABELS = Object.freeze({
  market: "Market (SPY)",
  peers: "Peers' median",
  peersVsMarket: "Peers vs market",
  nameVsPeers: "Name vs peers",
  nameVsMarket: "Name vs market",
});

export const PARTS_SENTENCES = Object.freeze([
  "Parts of the move: market, peers against market, the name against its peers.",
  "Market is the change in SPY. Peers are the other names in the sector.",
  "Peers need at least 10 names.",
  "SPY and QQQ are left out by ticker.",
  "No fund flag exists, so another fund with a sector counts.",
  "The parts add to the move. They are not beta-adjusted.",
  "Peer spread is 1.48 times the median distance of peers from their median.",
]);

const tenths = (v) => Math.round(v * 1000) + 0;

export function partsOf(rows, t) {
  const list = Array.isArray(rows) ? rows : [];
  const me = list.find((r) => r && r.t === t);
  const chg = me ? finite(me.chg) : null;
  if (chg === null) return null;
  const spy = t === "SPY" ? null : list.find((r) => r && r.t === "SPY");
  const market = spy ? finite(spy.chg) : null;
  let peers = null;
  let peerWhy = null;
  if (PEER_PINS.includes(t)) peerWhy = "A market reference has no peers.";
  else if (!me.sector) peerWhy = "No sector, so no peers.";
  else {
    const v = list
      .filter((r) => r && r !== me && r.t !== t && !PEER_PINS.includes(r.t) && r.sector === me.sector)
      .map((r) => finite(r.chg))
      .filter((x) => x !== null);
    if (v.length < PEER_MIN) peerWhy = v.length + " peers, needs " + PEER_MIN + ".";
    else {
      const s = median(v);
      const d = MAD_SCALE * median(v.map((x) => Math.abs(x - s)));
      peers = { n: v.length, median: s, spread: d, z: d > 0 ? (chg - s) / d : null };
    }
  }
  const levels = [];
  if (market !== null) levels.push(["market", PARTS_LABELS.market, market]);
  if (peers) levels.push(["peers", market !== null ? PARTS_LABELS.peersVsMarket : PARTS_LABELS.peers, peers.median]);
  const parts = [];
  if (levels.length) {
    let from = 0;
    for (const [key, label, v] of levels) {
      parts.push({ key, label, tenths: tenths(v) - from });
      from = tenths(v);
    }
    parts.push({ key: "name", label: peers ? PARTS_LABELS.nameVsPeers : PARTS_LABELS.nameVsMarket, tenths: tenths(chg) - from });
  }
  return { t, chg, total: tenths(chg), market, peers, peerWhy, parts };
}

export function sectorStats(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.t !== "string" || !r.t || PEER_PINS.includes(r.t)) continue;
    const key = typeof r.sector === "string" && r.sector ? r.sector : NO_SECTOR;
    if (!by.has(key)) by.set(key, { name: key, total: 0, measured: 0, ms: [] });
    const b = by.get(key);
    b.total++;
    const m = ivDays(r.chg, r.iv30p);
    if (m === null) continue;
    b.measured++;
    if (!eventInside(r.ed)) b.ms.push(m);
  }
  const out = [...by.values()].map((b) => {
    const n = b.ms.length;
    const beyond = b.ms.filter((m) => Math.abs(m) > SECTOR_BEYOND).length;
    return {
      name: b.name,
      total: b.total,
      measured: b.measured,
      n,
      apart: b.measured - n,
      median: n ? median(b.ms) : null,
      beyond: n ? beyond : null,
      share: n ? beyond / n : null,
      why: n ? null : b.measured === 0 ? WHY_NO_IV : WHY_ALL_EVENT,
    };
  });
  return out.sort((a, b) => (a.median === null) - (b.median === null) || (b.median ?? 0) - (a.median ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function shareText(beyond, n) {
  if (!(n > 0) || !Number.isInteger(beyond) || beyond < 0 || beyond > n) return null;
  const p = Math.round((100 * beyond) / n);
  return beyond > 0 && p === 0 ? "<1%" : p + "%";
}

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export const VIEW_SENTENCES = Object.freeze([
  SECTORS_LINE, MEDIAN_NOTE, BEYOND_NOTE, SHARE_NOTE, LEFT_OUT_NOTE, PINS_NOTE, WHY_NO_IV, WHY_ALL_EVENT,
]);

export const RADAR_SENTENCES = Object.freeze([X_LINE, Y_LINE, SIZE_LINE, REF_LINE, FROZEN_LINE]);

export const HEADER_SENTENCES = Object.freeze([LINE, CAPTION, APART, GRADE_NOTE, ...VIEW_SENTENCES, ...RADAR_SENTENCES, ...PARTS_SENTENCES]);

export const registered = isTarget(MOVE_ID);
