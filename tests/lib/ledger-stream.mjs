import { makeWorld } from "./sfc-world.mjs";
import { mulberry32, pick, between, chance } from "./sfc-rng.mjs";
import { alertKey } from "../../shared/flows-alerts.js";
import { LIVE_FIELDS } from "../../shared/flows-ledger-book.js";

export const keyOf = (row) => alertKey(row);

export function project(row) {
  const out = {};
  for (const f of LIVE_FIELDS) out[f] = row[f] === undefined ? null : row[f];
  return out;
}

const cents = (n) => Math.round(n * 100) / 100;

export function reviseRow(row, mode, rnd) {
  const k = mode === "up" ? 1.1 + rnd() * 0.4 : 0.6 + rnd() * 0.3;
  const next = { ...row };
  for (const f of ["prem", "askPrem", "bidPrem"]) if (typeof next[f] === "number") next[f] = cents(next[f] * k);
  if (typeof next.askPrem === "number" && typeof next.bidPrem === "number" && typeof next.prem === "number" && next.askPrem + next.bidPrem > next.prem) {
    next.askPrem = cents(next.prem * 0.5);
    next.bidPrem = cents(next.prem * 0.4);
  }
  if (mode === "up" && typeof row.spanEnd === "string") next.spanEnd = new Date(Date.parse(row.spanEnd) + 60000).toISOString();
  return next;
}

export function makeEvents(seed, { tickers = 40, perName = 12, revise = 0.2, down = 0.4, resend = 0.15, world = null } = {}) {
  const w = world || makeWorld(seed, { tickers, perName, pathologies: false });
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const events = [];
  let at = 1_700_000_000_000;
  const dByKey = new Map();
  const originals = new Map();
  for (const row of w.rows) {
    at += between(rnd, 200, 4000);
    const key = keyOf(row);
    if (key === null) continue;
    dByKey.set(key, row.d);
    originals.set(key, row);
    events.push({ row, at, kind: "first" });
    if (chance(rnd, revise)) {
      const mode = chance(rnd, down) ? "down" : "up";
      at += between(rnd, 500, 90000);
      events.push({ row: reviseRow(row, mode, rnd), at, kind: mode });
    }
    if (chance(rnd, resend)) events.push({ row, at: at + between(rnd, 0, 3000), kind: "resend" });
  }
  return { world: w, events, dByKey, originals };
}

export function shuffle(list, seed) {
  const rnd = mulberry32(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function batches(list, seed, max = 9) {
  const rnd = mulberry32(seed);
  const out = [];
  for (let i = 0; i < list.length;) {
    const n = between(rnd, 1, max);
    out.push(list.slice(i, i + n));
    i += n;
  }
  return out;
}

export function expectedHeld(events, cap = 180) {
  const best = new Map();
  for (const ev of events) {
    const row = project(ev.row);
    const key = keyOf(row);
    if (key === null) continue;
    const end = Date.parse(row.spanEnd || row.spanStart);
    const cand = { key, row, at: ev.at, end: Number.isFinite(end) ? end : -Infinity, canon: JSON.stringify(row) };
    const prior = best.get(key);
    if (!prior) { best.set(key, cand); continue; }
    if (cand.at !== prior.at ? cand.at > prior.at : cand.end !== prior.end ? cand.end > prior.end : cand.canon > prior.canon) best.set(key, cand);
  }
  const list = Array.from(best.values());
  list.sort((a, b) => {
    const pa = a.row.prem, pb = b.row.prem;
    if (pa !== pb) return pb - pa;
    if (a.row.t !== b.row.t) return a.row.t < b.row.t ? -1 : 1;
    if ((a.row.oc || "") !== (b.row.oc || "")) return (a.row.oc || "") < (b.row.oc || "") ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return list.slice(0, cap).map((e) => e.row);
}

export { makeWorld, mulberry32, pick, between, chance };
