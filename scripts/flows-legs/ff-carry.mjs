import { PAYLOADS } from "../../shared/ff-contract.js";
import { prevSession } from "../../shared/ff-session.js";

export const FF_CARRY_VERSION = 1;

export const FF_CARRY_KEY = PAYLOADS.carry.key;

export const FF_CARRY_CAP = PAYLOADS.carry.maxBytes;

export const CARRY_ROWS = 180;

export const CARRY_FIELDS = Object.freeze(["t", "oc", "cp", "k", "exp", "prem", "size", "oi", "voi", "px", "spanStart"]);

const finite = (x) => typeof x === "number" && Number.isFinite(x);

const byRank = (a, b) => b.prem - a.prem || (a.t < b.t ? -1 : a.t > b.t ? 1 : a.oc < b.oc ? -1 : a.oc > b.oc ? 1 : 0);

export function carryRowOf(row) {
  const out = {};
  for (const f of CARRY_FIELDS) out[f] = row[f] === undefined ? null : row[f];
  return out;
}

export function carryWindows(alerts) {
  const rows = alerts && Array.isArray(alerts.rows) ? alerts.rows : [];
  return rows
    .filter((r) => r && r.opening === true && typeof r.t === "string" && typeof r.oc === "string" && finite(r.prem) && finite(r.size) && r.size > 0)
    .sort(byRank)
    .slice(0, CARRY_ROWS)
    .map(carryRowOf);
}

export function resolveCarried(stored, session) {
  const none = (reason, from = null) => ({ windows: [], from, reason });
  if (!stored || typeof stored !== "object" || !Array.isArray(stored.windows) || typeof stored.sessionDate !== "string") return none("missing");
  const prev = prevSession(session);
  if (prev === null) return none("missing");
  if (stored.sessionDate === prev) return { windows: stored.windows, from: prev, reason: null };
  if (stored.sessionDate === session) {
    const p = stored.prior;
    if (p && p.sessionDate === prev && Array.isArray(p.windows)) return { windows: p.windows, from: prev, reason: null };
    return none("same_session", stored.sessionDate);
  }
  return none(stored.sessionDate > session ? "same_session" : "stale", stored.sessionDate);
}

export function buildCarry({ sessionDate, generatedAt, alerts, carried = null }) {
  const windows = carryWindows(alerts);
  const priorRows = carried && carried.from && Array.isArray(carried.windows) ? carried.windows.map(carryRowOf) : [];
  const make = () => ({
    v: FF_CARRY_VERSION, sessionDate, generatedAt, windows,
    ...(priorRows.length ? { prior: { sessionDate: carried.from, windows: priorRows } } : {}),
  });
  let payload = make();
  while (JSON.stringify(payload).length > FF_CARRY_CAP && priorRows.length) {
    priorRows.length = Math.floor(priorRows.length / 2);
    payload = make();
  }
  while (JSON.stringify(payload).length > FF_CARRY_CAP && windows.length) {
    windows.pop();
    payload = make();
  }
  return payload;
}
