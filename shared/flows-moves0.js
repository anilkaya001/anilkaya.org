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

export const VIEWS = Object.freeze(["field", "map", "sectors"]);

export const STEP_EDGES = Object.freeze([0.5, 1, 2, 3]);

export const MAP_CAP_LINE = "Tile area is market cap; colour is the move in IV-days.";

export const MAP_EQUAL_LINE = "Every tile has the same area; colour is the move in IV-days.";

export const SECTORS_LINE = "Each sector's median move, and its names beyond 2 IV-days.";

export const KEY_EVENT = "Dashed outline: earnings within 21 sessions, event not separated.";

export const MEDIAN_NOTE = "Median is signed, in IV-days.";

export const BEYOND_NOTE = "Beyond 2 counts names more than 2 IV-days from flat, up or down.";

export const SHARE_NOTE = "Share is that count over the sector's names.";

export const LEFT_OUT_NOTE = "Names reporting within 21 sessions are left out of every row.";

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

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export const VIEW_SENTENCES = Object.freeze([
  MAP_CAP_LINE, MAP_EQUAL_LINE, SECTORS_LINE, KEY_EVENT, MEDIAN_NOTE, BEYOND_NOTE, SHARE_NOTE, LEFT_OUT_NOTE,
]);

export const RADAR_SENTENCES = Object.freeze([X_LINE, Y_LINE, SIZE_LINE, REF_LINE, FROZEN_LINE]);

export const HEADER_SENTENCES = Object.freeze([LINE, CAPTION, APART, GRADE_NOTE, ...VIEW_SENTENCES, ...RADAR_SENTENCES]);

export const registered = isTarget(MOVE_ID);
