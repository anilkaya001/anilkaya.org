import { parseOptionSymbol } from "../shared/flows-premium.js";

const fin = (v) => typeof v === "number" && Number.isFinite(v);

export const SC_PAGE_SIZE = 500;
export const SC_MAX_PAGES = 24;
export const SC_PAGES_DEFAULT = 12;
export const SC_WAVE = 4;
export const SC_CHAIN_TTL_MS = 60000;
export const SC_CHAIN_KEEP = 2;

const REFUSED = Symbol("refused");

export async function gatherPages({ first, page, unwrap, refused, maxPages = SC_MAX_PAGES, wave = SC_WAVE, size = SC_PAGE_SIZE }) {
  const rows = unwrap(first).slice();
  let pages = 1, failed = 0, budget = false;
  let more = rows.length >= size;
  while (more && pages < maxPages) {
    const n = Math.min(wave, maxPages - pages);
    const base = pages;
    const got = await Promise.all(Array.from({ length: n }, (_, i) => page(base + 1 + i).then(unwrap, (e) => (refused(e) ? REFUSED : null))));
    more = true;
    for (const part of got) {
      pages++;
      if (part === REFUSED) { budget = true; more = false; continue; }
      if (part === null) { failed++; more = false; continue; }
      for (const r of part) rows.push(r);
      if (part.length < size) more = false;
    }
  }
  return { rows, pages, failed, budget, truncated: more && pages >= maxPages };
}

export function chainCacheGet(map, key, now) {
  const hit = map.get(key);
  if (!hit) return null;
  if (now - hit.at >= SC_CHAIN_TTL_MS) { map.delete(key); return null; }
  return hit;
}

export function chainCachePut(map, key, value, now) {
  map.delete(key);
  map.set(key, { ...value, at: now });
  while (map.size > SC_CHAIN_KEEP) map.delete(map.keys().next().value);
}

export function singleFlight(flights, key, run) {
  const held = flights.get(key);
  if (held) return held;
  const promise = Promise.resolve().then(run).finally(() => { if (flights.get(key) === promise) flights.delete(key); });
  flights.set(key, promise);
  return promise;
}

export const VENDOR_MIN_ROWS_FOR_ROW_LEVEL = 200;
export const VENDOR_MIN_EXPIRY_ROWS = 10;

const oiOf = (row) => {
  const v = row && row.open_interest;
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function vendorCheck(rows, { spot = null, pages = 1, failed = 0, truncated = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = new Set();
  const byExpiry = new Map();
  const sequence = [];
  let dups = 0, zeroOi = 0, missingOi = 0, parsed = 0;
  for (const r of list) {
    const p = parseOptionSymbol(r && r.option_symbol);
    if (p === null) continue;
    parsed++;
    if (seen.has(r.option_symbol)) dups++;
    seen.add(r.option_symbol);
    const oi = oiOf(r);
    if (oi === null) missingOi++;
    else if (oi === 0) zeroOi++;
    let g = byExpiry.get(p.expiry);
    if (!g) { g = { n: 0, zero: 0, lo: Infinity, hi: -Infinity }; byExpiry.set(p.expiry, g); }
    g.n++;
    if (oi === 0) g.zero++;
    if (p.strike < g.lo) g.lo = p.strike;
    if (p.strike > g.hi) g.hi = p.strike;
    sequence.push({ expiry: p.expiry, strike: p.strike });
  }
  const runs = [];
  for (const s of sequence) {
    const last = runs[runs.length - 1];
    if (last && last.expiry === s.expiry) last.hi = Math.max(last.hi, s.strike);
    else runs.push({ expiry: s.expiry, hi: s.strike });
  }
  const distinct = new Set(runs.map((r) => r.expiry)).size;
  let order = "single";
  if (runs.length > 1) {
    if (distinct < runs.length) {
      let rising = 0;
      for (let i = 1; i < sequence.length; i++) if (sequence[i].strike >= sequence[i - 1].strike) rising++;
      order = rising >= 0.95 * (sequence.length - 1) ? "strike" : "mixed";
    } else {
      let up = true, down = true;
      for (let i = 1; i < runs.length; i++) {
        if (runs[i].expiry <= runs[i - 1].expiry) up = false;
        if (runs[i].expiry >= runs[i - 1].expiry) down = false;
      }
      order = up ? "asc" : down ? "desc" : "mixed";
    }
  }
  const boundary = truncated && runs.length ? runs[runs.length - 1].expiry : null;
  let zeroExpiries = 0;
  for (const [expiry, g] of byExpiry) {
    if (expiry === boundary || g.n < VENDOR_MIN_EXPIRY_ROWS || g.zero !== g.n) continue;
    if (fin(spot) && !(g.lo < spot && g.hi > spot)) continue;
    zeroExpiries++;
  }
  let honoured = null;
  if (zeroExpiries > 0) honoured = false;
  else if (parsed >= VENDOR_MIN_ROWS_FOR_ROW_LEVEL && zeroOi === 0) honoured = true;
  const out = { honoured, zeroOi, missingOi, zeroExpiries, order, dups, holes: failed, rows: parsed, pages, expiries: byExpiry.size };
  if (truncated) {
    out.partial = boundary;
    out.unseen = order === "asc" ? "after" : order === "desc" ? "before" : order === "strike" ? "strikes-above" : "unknown";
    if (order === "strike") out.aboveStrike = Math.max(...sequence.map((s) => s.strike));
  }
  return out;
}

export function vendorAnomalies(check) {
  if (!check) return [];
  const out = [];
  if (check.honoured === false) out.push("zero-oi-filter-ignored");
  if (check.order === "mixed") out.push("order-mixed");
  if (check.order === "strike") out.push("order-by-strike");
  if (check.dups > 0) out.push("duplicate-symbols");
  if (check.holes > 0) out.push("page-failed");
  return out;
}
