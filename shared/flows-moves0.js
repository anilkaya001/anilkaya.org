import { isTarget } from "./flows-targets.js";

export const MOVE_ID = "move.im1.h1";

export const SESSIONS_PER_YEAR = 252;

export const EVENT_SESSIONS = 21;

export const BEYOND = 3;

export const UNIT = "IV-days";

export const LINE = "A ranking, not a test: no error rate measured.";

export const CAPTION = "IV as of the previous close.";

export const APART = "Earnings within 30 days: event not separated.";

export const GRADE_NOTE = "From 30-day IV; no surface.";

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

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export const HEADER_SENTENCES = Object.freeze([LINE, CAPTION, APART, GRADE_NOTE]);

export const registered = isTarget(MOVE_ID);
