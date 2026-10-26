import { alertKey } from "./flows-alerts.js";
import {
  contributionOf, applyContribution, newBookState, bookWindows, sumBooks, deltaMicroOf, sessionOfWindow, readUniverse,
} from "./flows-sfc.js";

export const HELD_ROWS = 180;

export const SEEN_ROWS = 4096;

export const GONE_ROWS = 32768;

const FIELD_BREAK = "\n";

export const LIVE_FIELDS = Object.freeze([
  "t", "oc", "cp", "k", "exp", "prem", "askPrem", "bidPrem", "size", "px", "ivStart", "ivEnd", "spanStart", "spanEnd", "single", "floor", "rule",
]);

const text = (v) => (typeof v === "string" ? v : "");

export function projectWindow(row) {
  if (row === null || typeof row !== "object" || typeof row.t !== "string" || !row.t) return null;
  const out = {};
  for (const f of LIVE_FIELDS) out[f] = row[f] === undefined ? null : row[f];
  return out;
}

const endOf = (row) => {
  const at = Date.parse(text(row.spanEnd) || text(row.spanStart));
  return Number.isFinite(at) ? at : -Infinity;
};

const premOf = (row) => (typeof row.prem === "number" && Number.isFinite(row.prem) ? row.prem : null);

const byName = (a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (text(a.oc) < text(b.oc) ? -1 : text(a.oc) > text(b.oc) ? 1 : 0);

export function rankOrder(a, b) {
  const pa = premOf(a.row), pb = premOf(b.row);
  if (pa === null && pb === null) {
    const sa = typeof a.row.size === "number" ? a.row.size : -1, sb = typeof b.row.size === "number" ? b.row.size : -1;
    return (sb - sa) || byName(a.row, b.row) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  if (pa === null) return 1;
  if (pb === null) return -1;
  return (pb - pa) || byName(a.row, b.row) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

export function retain(entries, cap = HELD_ROWS) {
  return entries.slice().sort(rankOrder).slice(0, cap);
}

const canonOf = (row) => JSON.stringify(row);

export function newerVersion(a, b) {
  if (a.at !== b.at) return a.at > b.at;
  if (a.end !== b.end) return a.end > b.end;
  return canonOf(a.row) > canonOf(b.row);
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = (1n << 64n) - 1n;

function fnv(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK;
  }
  return h;
}

export function fingerprintOf(rows) {
  let sum = 0n;
  for (const row of rows) sum = (sum + fnv(alertKey(row) + FIELD_BREAK + canonOf(row))) & MASK;
  return rows.length + ":" + sum.toString(16).padStart(16, "0");
}

const BOOK_FIELDS = ["n", "T", "AC", "BC", "AP", "BP", "sided", "covered", "sameDay", "noExposure"];

const COUNT_FIELDS = ["offSession", "noRight", "invalid", "unreadable", "zero", "booked", "rounded", "invalidCents", "noExposure", "noDelta"];

export function diffBooks(a, b) {
  const out = [];
  for (const name of new Set([...a.books.keys(), ...b.books.keys()])) {
    const x = a.books.get(name), y = b.books.get(name);
    if (!x || !y) { out.push(`${name}: book on one side only`); continue; }
    if (x.column !== y.column) out.push(`${name}.column ${x.column} against ${y.column}`);
    for (const f of BOOK_FIELDS) if (x[f] !== y[f]) out.push(`${name}.${f} ${x[f]} against ${y[f]}`);
    for (const r of Object.keys(x.U)) if (x.U[r] !== y.U[r]) out.push(`${name}.U.${r} ${x.U[r]} against ${y.U[r]}`);
    if (x.X !== y.X) out.push(`${name}.X ${x.X} against ${y.X}`);
    if (x.Ub !== y.Ub) out.push(`${name}.Ub ${x.Ub} against ${y.Ub}`);
  }
  for (const f of COUNT_FIELDS) if (a.counts[f] !== b.counts[f]) out.push(`counts.${f} ${a.counts[f]} against ${b.counts[f]}`);
  return out;
}

export function createLedgerBook({
  column, session, deltaMicro = deltaMicroOf, sessionOf = sessionOfWindow, cap = HELD_ROWS, seenCap = SEEN_ROWS,
}) {
  let col = column;
  const win = new Map();
  const gone = new Map();
  let held = new Map();
  let state = newBookState();
  let dirty = false;
  let dropped = 0;
  let baseKeys = new Set();
  let baseEntered = 0;
  const tally = { entered: 0, revised: 0, unchanged: 0, older: 0, offSession: 0, unkeyed: 0 };

  const contribute = (e) => contributionOf(e.row, { deltaMicro, session, sessionOf });

  function put(raw, { at }) {
    const row = projectWindow(raw);
    const key = row === null ? null : alertKey(row);
    if (key === null) { tally.unkeyed += 1; return "unkeyed"; }
    if (session !== null) {
      const day = sessionOf(row);
      if (day !== null && day !== session) { tally.offSession += 1; return "offSession"; }
    }
    const next = { key, row, at: Number.isFinite(at) ? at : -Infinity, end: endOf(row), c: null, applied: false };
    const prior = win.get(key);
    if (!prior) {
      const tomb = gone.get(key);
      if (tomb !== undefined) {
        if (!(next.at > tomb.at || (next.at === tomb.at && next.end > tomb.end))) { tally.older += 1; return "older"; }
        gone.delete(key);
      }
      win.set(key, next);
      tally.entered += 1;
      dirty = true;
      return "entered";
    }
    if (canonOf(prior.row) === canonOf(next.row)) {
      if (next.at > prior.at) prior.at = next.at;
      tally.unchanged += 1;
      return "unchanged";
    }
    if (!newerVersion(next, prior)) { tally.older += 1; return "older"; }
    prior.row = next.row;
    prior.at = next.at;
    prior.end = next.end;
    prior.stale = true;
    if (!prior.applied) prior.c = null;
    tally.revised += 1;
    dirty = true;
    return "revised";
  }

  function settle() {
    if (!dirty) return { added: 0, removed: 0, replaced: 0, names: new Set() };
    dirty = false;
    const ranked = retain(Array.from(win.values()), cap);
    const next = new Map(ranked.map((e) => [e.key, e]));
    const names = new Set();
    let added = 0, removed = 0, replaced = 0;
    for (const [key, e] of held) {
      if (next.has(key) && !e.stale) continue;
      applyContribution(state, e.c, -1, col);
      if (e.c.kind === "booked") names.add(e.c.name);
      e.applied = false;
      if (!next.has(key)) { removed += 1; if (e.stale) { e.c = null; e.stale = false; } } else replaced += 1;
    }
    for (const [key, e] of next) {
      if (e.applied) continue;
      if (e.c === null || e.stale) { e.c = contribute(e); e.stale = false; }
      applyContribution(state, e.c, 1, col);
      if (e.c.kind === "booked") names.add(e.c.name);
      e.applied = true;
      if (!held.has(key)) added += 1;
    }
    held = next;
    if (win.size > seenCap) {
      const spare = Array.from(win.values()).filter((e) => !held.has(e.key)).sort(rankOrder);
      for (let i = spare.length - 1; i >= 0 && win.size > seenCap; i--) {
        const e = spare[i];
        win.delete(e.key);
        gone.delete(e.key);
        gone.set(e.key, { at: e.at, end: e.end });
        if (gone.size > GONE_ROWS) gone.delete(gone.keys().next().value);
        dropped += 1;
      }
    }
    return { added, removed, replaced, names };
  }

  function rebuild(nextColumn = col) {
    col = nextColumn;
    state = newBookState();
    for (const e of held.values()) {
      e.c = contribute(e);
      e.stale = false;
      applyContribution(state, e.c, 1, col);
    }
  }

  const heldEntries = () => Array.from(held.values()).sort(rankOrder);

  function heldRows() {
    return heldEntries().map((e) => e.row);
  }

  function snapshot({ collect = false } = {}) {
    const counts = { ...state.counts, given: held.size, duplicate: 0 };
    const accepted = collect ? heldEntries().filter((e) => e.c.kind === "booked").map((e) => ({ row: e.row, entry: e.c.entry, right: e.c.right })) : [];
    return { books: state.books, counts, accepted };
  }

  function verify() {
    const rows = heldRows();
    const full = bookWindows(rows, { column: col, deltaMicro, session, sessionOf });
    const mine = { books: state.books, counts: { ...state.counts, given: rows.length, duplicate: 0 } };
    const drift = diffBooks(mine, full);
    if (full.counts.given !== mine.counts.given) drift.push(`counts.given ${mine.counts.given} against ${full.counts.given}`);
    return { ok: drift.length === 0, drift, held: rows.length };
  }

  function alignedTotals(include, atMs) {
    const tmp = newBookState();
    for (const e of held.values()) {
      if (e.c.kind !== "booked" || !include(e.c)) continue;
      if (Number.isFinite(atMs) && e.end > atMs) continue;
      applyContribution(tmp, e.c, 1, col);
    }
    return sumBooks(tmp.books);
  }

  function newerThan(include, atMs) {
    let n = 0;
    for (const e of held.values()) if (e.c.kind === "booked" && include(e.c) && Number.isFinite(atMs) && e.end > atMs) n += 1;
    return n;
  }

  function newestEnd() {
    let best = -Infinity;
    for (const e of held.values()) if (e.end > best) best = e.end;
    return Number.isFinite(best) ? best : null;
  }

  function markBase(rows, entered) {
    baseKeys = new Set(rows.map((r) => alertKey(r)).filter((k) => k !== null));
    baseEntered = Number.isFinite(entered) ? entered : baseKeys.size;
  }

  function seenTotal() {
    let fresh = 0;
    for (const key of win.keys()) if (!baseKeys.has(key)) fresh += 1;
    return baseEntered + fresh;
  }

  function heldKeys() {
    return new Set(held.keys());
  }

  return {
    put, settle, rebuild, heldRows, snapshot, verify, alignedTotals, newerThan, newestEnd, markBase, seenTotal, heldKeys,
    fingerprint: () => fingerprintOf(heldRows()),
    stats: () => ({ held: held.size, seen: win.size, dropped, remembered: gone.size, ...tally }),
    column: (name) => col(name),
    cap, session,
  };
}

export function columnOfUniverse(universe) {
  const uni = readUniverse(universe);
  return uni.columnOf;
}
