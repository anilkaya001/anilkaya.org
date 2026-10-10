import { parseOptionSymbol } from "./flows-premium.js";
import { easternDay } from "./flows-freshness.js";

export const ACTIVITY_SCHEMA_VERSION = 1;
export const ACTIVITY_CLASSES = Object.freeze(["sweep", "floor", "multileg", "stockMultileg", "cross"]);
export const ACTIVITY_FIELDS = Object.freeze(["sweep_volume", "floor_volume", "multileg_volume", "stock_multi_leg_volume", "cross_volume"]);
export const ACTIVITY_LIMIT = 200;
export const ACTIVITY_ROWS = 30;
export const ACTIVITY_PER_NAME = 3;

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));

export const activityKey = (row) => {
  if (!row || typeof row.t !== "string" || !row.t) return null;
  if (!Number.isFinite(Number(row.k))) return null;
  if (typeof row.expiry !== "string" || !row.expiry) return null;
  if (row.cp !== "C" && row.cp !== "P") return null;
  return `${row.t}|${row.k}|${row.expiry}|${row.cp}`;
};

export function buildActivityRows(rows, { sessionDate = null } = {}) {
  const out = [];
  const refused = { symbol: 0, volume: 0, cls: 0 };
  let offDate = 0, undated = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") { refused.symbol++; continue; }
    const sym = parseOptionSymbol(raw.option_symbol);
    if (!sym) { refused.symbol++; continue; }
    const vol = numOrNull(raw.volume);
    if (vol === null || !(vol > 0)) { refused.volume++; continue; }
    const day = easternDay(typeof raw.last_fill === "string" ? raw.last_fill : null);
    if (sessionDate && day && day !== sessionDate) { offDate++; continue; }
    if (!day) undated++;
    const oi = numOrNull(raw.open_interest);
    const premium = numOrNull(raw.premium);
    const ask = numOrNull(raw.ask_side_volume), bid = numOrNull(raw.bid_side_volume);
    const classified = ask !== null && bid !== null ? ask + bid : null;
    const cls = ACTIVITY_FIELDS.map((f) => {
      const v = numOrNull(raw[f]);
      if (v === null) return null;
      if (v < 0 || v > vol) { refused.cls++; return null; }
      return Math.round(v);
    });
    out.push({
      t: sym.ticker,
      k: sym.strike,
      expiry: sym.expiry,
      cp: sym.type === "P" ? "P" : "C",
      vol: Math.round(vol),
      oi: oi === null ? null : Math.round(oi),
      vor: oi !== null && oi > 0 ? round(vol / oi, 3) : null,
      pm: premium !== null && premium >= 0 ? Math.round(premium) : null,
      lift: classified !== null && classified > 0 ? round(ask / classified, 3) : null,
      cls,
    });
  }
  return { rows: out, seen: list.length, refused, offDate, undated };
}

export function rankActivity(rows, { cap = ACTIVITY_ROWS, perName = ACTIVITY_PER_NAME } = {}) {
  const all = (Array.isArray(rows) ? rows : []).slice();
  all.sort((a, b) => ((b.pm ?? -1) - (a.pm ?? -1)) || (b.vol - a.vol) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)
    || (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0) || (a.k - b.k) || (a.cp < b.cp ? -1 : a.cp > b.cp ? 1 : 0));
  const taken = new Map();
  const kept = [];
  let perNameBit = false;
  for (const row of all) {
    const n = taken.get(row.t) || 0;
    if (n >= perName) { perNameBit = true; continue; }
    taken.set(row.t, n + 1);
    kept.push(row);
    if (kept.length >= cap) break;
  }
  return { rows: kept, shown: kept.length, eligible: all.length, cap, perName, capBound: kept.length >= cap ? "rows" : (perNameBit ? "perName" : "eligible") };
}

export function mergeActivity(contractRows, activityRows) {
  const byKey = new Map();
  for (const a of Array.isArray(activityRows) ? activityRows : []) {
    const id = activityKey(a);
    if (id) byKey.set(id, a);
  }
  let matched = 0;
  const list = Array.isArray(contractRows) ? contractRows : [];
  for (const row of list) {
    const a = byKey.get(activityKey(row));
    if (!a) continue;
    row.cls = a.cls.slice();
    row.pm = a.pm;
    matched++;
  }
  return { matched, contracts: list.length };
}

export function activityBlock({ status, code = null, sessionDate = null, readAt = null, built = null, ranked = null, matched = null } = {}) {
  const base = { v: ACTIVITY_SCHEMA_VERSION, status, code, asOf: sessionDate, readAt, order: ACTIVITY_CLASSES.slice(), limit: ACTIVITY_LIMIT };
  if (status !== "ok" && status !== "quiet") return { ...base, rows: [] };
  return {
    ...base,
    returned: built.seen,
    kept: built.rows.length,
    offDate: built.offDate,
    undated: built.undated,
    refused: built.refused,
    capBound: built.seen >= ACTIVITY_LIMIT,
    matched: matched === null ? null : matched.matched,
    of: matched === null ? null : matched.contracts,
    shown: ranked ? ranked.shown : 0,
    perName: ranked ? ranked.perName : ACTIVITY_PER_NAME,
    rows: ranked ? ranked.rows : [],
  };
}

export const ACTIVITY_NOTES = Object.freeze({
  unit: "Sweep-coded volume, floor-coded volume, multi-leg volume, stock multi-leg volume and cross volume, in contracts, from " +
    "the vendor's dated screen. Each is the part of a contract's volume that carried that exchange condition code. The classes " +
    "can overlap and are never summed.",
  date: "The screen is asked for the session by date and every row's last fill is checked to fall on that Eastern day; a row " +
    "from another day is dropped and counted. Unlike the chain counter beside it, this unit has an as-of day.",
  classes: "A class share does not say who was on either side, why, or whether the volume opened or closed a position.",
  population: "The screen has its own floors, so it is a second, independent selection: a contract can be in it and not in the " +
    "list ranked by volume over open interest, and the other way round. Where a contract is in both, its classes are attached " +
    "to the ranked row.",
});

export const activityBasis = () => [ACTIVITY_NOTES.unit, ACTIVITY_NOTES.date, ACTIVITY_NOTES.classes, ACTIVITY_NOTES.population].join(" ");
