import { isFixtureTicker } from "./flows-fixture-names.js";

export const MEMBER_LIMITS = Object.freeze({
  watchlistMax: 200,
  idleVisitMs: 30 * 60 * 1000,
  seenStepMs: 60 * 1000,
  exportsPer24h: 50,
  exportRowsMax: 1000,
  exportLogDays: 90,
  exportLogListMax: 200,
  rejectedShown: 20,
});

export const DAY_MS = 86400000;

export const WATCHLIST_REASONS = Object.freeze({
  format: "not a ticker symbol",
  fixture: "a reserved test name",
  universe: "not in the universe",
});

const RAW_RE = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/;

export const MEMBER_ID_RE = /^[a-z0-9_.-]{3,32}$/;

export function normalizeWatchlist(raw, { known, fixtureHost = false } = {}) {
  if (!Array.isArray(raw)) return { ok: false, code: "shape" };
  if (raw.length > MEMBER_LIMITS.watchlistMax * 4) return { ok: false, code: "too_many", distinct: null };
  const names = [];
  const seen = new Set();
  const rejected = [];
  for (const item of raw) {
    const text = typeof item === "string" ? item.trim() : null;
    if (text === null || !RAW_RE.test(text)) {
      rejected.push({ ticker: text === null ? null : text.slice(0, 12), reason: WATCHLIST_REASONS.format });
      continue;
    }
    const name = text.toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    if (isFixtureTicker(name) && !fixtureHost) {
      rejected.push({ ticker: name, reason: WATCHLIST_REASONS.fixture });
      continue;
    }
    if (known instanceof Set && !known.has(name)) {
      rejected.push({ ticker: name, reason: WATCHLIST_REASONS.universe });
      continue;
    }
    names.push(name);
  }
  if (rejected.length) {
    return { ok: false, code: "rejected", rejectedCount: rejected.length, rejected: rejected.slice(0, MEMBER_LIMITS.rejectedShown) };
  }
  if (names.length > MEMBER_LIMITS.watchlistMax) return { ok: false, code: "too_many", distinct: names.length };
  names.sort();
  return { ok: true, names };
}

export const etagOf = (version) => '"w' + version + '"';

const IF_MATCH_RE = /^"w(0|[1-9][0-9]{0,14})"$/;

export function parseIfMatch(header) {
  if (header === null || header === undefined) return { state: "missing" };
  const match = IF_MATCH_RE.exec(String(header).trim());
  return match ? { state: "ok", version: Number(match[1]) } : { state: "invalid" };
}

export function visitStep(row, now, limits = MEMBER_LIMITS) {
  const seen = row && Number.isSafeInteger(row.seenMs) ? row.seenMs : null;
  const visit = row && Number.isSafeInteger(row.visitMs) ? row.visitMs : null;
  const prev = row && Number.isSafeInteger(row.prevSeenMs) ? row.prevSeenMs : null;
  if (seen === null) return { wrote: true, newVisit: true, seenMs: now, visitMs: now, prevSeenMs: prev };
  const gap = now - seen;
  if (!(gap >= limits.seenStepMs)) return { wrote: false, newVisit: false, seenMs: seen, visitMs: visit, prevSeenMs: prev };
  const fresh = gap >= limits.idleVisitMs;
  return { wrote: true, newVisit: fresh, seenMs: now, visitMs: fresh ? now : visit, prevSeenMs: fresh ? seen : prev };
}

export function moveZ(chg, sig) {
  if (typeof sig !== "number" || !Number.isFinite(sig)) return { z: null, why: "short_history" };
  if (!(sig > 0)) return { z: null, why: "zero_scale" };
  if (typeof chg !== "number" || !Number.isFinite(chg) || !(chg > -1)) return { z: null, why: "no_change" };
  return { z: Math.log1p(chg) / sig, why: null };
}

export function modeOf(value) {
  const mode = String(value === undefined || value === null ? "" : value).trim().toLowerCase();
  return mode === "on" || mode === "owner" ? mode : "off";
}
