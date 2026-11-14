import { filingRow, parseBand, sideOf } from "./flows-political.js";
import { sessionsBetween } from "./flows-calendar.js";
import { daysBetween, dollarsOf, isDay } from "./flows-pos-13f.js";

export const LAYER_CAPS = Object.freeze({ lateRows: 200, lateKept: 100, unusualRows: 60, topUnusual: 12, whoPerName: 6, over45: 45 });

export const UNUSUAL_TAGS = Object.freeze({
  committee_conflict: Object.freeze({ code: "cc", word: "Committee tie" }),
  first_person_to_trade: Object.freeze({ code: "fp", word: "First to trade" }),
  low_marketcap: Object.freeze({ code: "lm", word: "Small company" }),
  unusual_industry: Object.freeze({ code: "ui", word: "Unusual industry" }),
  unusually_large_trade: Object.freeze({ code: "ul", word: "Large trade" }),
  fec_donation_conflict: Object.freeze({ code: "fd", word: "Donation tie" }),
});

export const TAG_CODES = Object.freeze({
  ...Object.fromEntries(Object.values(UNUSUAL_TAGS).map((t) => [t.code, t.word])),
  other: "Other flag",
});

const HONORIFICS = new Set(["hon", "rep", "sen", "mr", "mrs", "ms", "dr", "representative", "senator"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

export function initialsOf(name) {
  if (typeof name !== "string") return "?";
  const folded = name.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const words = folded.split(/\s+/).map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean)
    .filter((w) => !HONORIFICS.has(w.toLowerCase()) && !SUFFIXES.has(w.toLowerCase()));
  if (!words.length) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return words[0][0].toUpperCase() + words[words.length - 1][0].toUpperCase();
}

const CHAMBER = Object.freeze({ house: "H", senate: "S", executive: "X" });

export function chamberCode(value) {
  return typeof value === "string" && Object.hasOwn(CHAMBER, value.toLowerCase()) ? CHAMBER[value.toLowerCase()] : null;
}

export function identityKey(row) {
  return [row.id || row.who || "", row.t || "", row.txnDate || "", row.filedDate || "", row.lo ?? "", row.hi ?? ""].join("|");
}

export function mergeById(a, b) {
  const seen = new Set();
  const out = [];
  for (const r of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    const id = r && typeof r.id === "string" ? r.id : null;
    if (id === null) { out.push(r); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

export function mergeByIdentity(groups) {
  const seen = new Set();
  const out = [];
  for (const [src, rows] of groups) {
    for (const raw of Array.isArray(rows) ? rows : []) {
      const row = filingRow(raw);
      if (!row || !row.t || !isDay(row.txnDate) || !isDay(row.filedDate)) continue;
      const key = identityKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ row, src });
    }
  }
  return out;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function byTicker(rows) {
  const by = {};
  for (const r of rows) {
    const e = by[r.t] || { n: 0, who: new Set(), lags: [], filers: new Set() };
    e.n++;
    e.who.add(r.who);
    e.filers.add(r.pid || r.who);
    if (r.lagS !== null) e.lags.push(r.lagS);
    by[r.t] = e;
  }
  const out = {};
  for (const [t, e] of Object.entries(by)) {
    out[t] = {
      n: e.n, filers: e.filers.size,
      maxS: e.lags.length ? Math.max(...e.lags) : null,
      medS: e.lags.length ? median(e.lags) : null,
      who: [...e.who].sort().slice(0, LAYER_CAPS.whoPerName),
    };
  }
  return out;
}

function rowCore(row, src, chambers, idNames) {
  const lagD = daysBetween(row.txnDate, row.filedDate);
  return {
    t: row.t, side: row.side, lo: row.lo, hi: row.hi, txn: row.txnDate, filed: row.filedDate,
    lagS: sessionsBetween(row.txnDate, row.filedDate),
    lagD, over45: lagD !== null && lagD > LAYER_CAPS.over45,
    who: initialsOf(row.who || (idNames && row.id ? idNames[row.id] : null)), ch: row.id && chambers ? chamberCode(chambers[row.id]) : null,
    src, pid: row.id || row.who,
  };
}

export function lateRows(groups, { chambers = null, trader = null, idNames = null } = {}) {
  const merged = mergeByIdentity(groups);
  const rows = merged.map(({ row, src }) => rowCore(row, src, chambers, idNames))
    .sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0) || (a.txn < b.txn ? -1 : 1));
  const kept = rows.slice(0, LAYER_CAPS.lateRows);
  const filedDates = kept.map((r) => r.filed);
  const filers = filerShares(trader, chambers);
  const outRows = kept.map(({ pid, ...r }) => r);
  return {
    rows: outRows,
    byT: byTicker(kept),
    filers,
    window: filedDates.length ? { from: filedDates.reduce((a, b) => (a < b ? a : b)), to: filedDates.reduce((a, b) => (a > b ? a : b)) } : null,
    seen: rows.length,
  };
}

export function tagCodes(tags, counter) {
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    const known = typeof t === "string" && Object.hasOwn(UNUSUAL_TAGS, t) ? UNUSUAL_TAGS[t].code : "other";
    if (known === "other" && counter) counter.other++;
    if (!out.includes(known)) out.push(known);
  }
  return out;
}

const r4 = (x) => Math.round(x * 1e4) / 1e4;

function priceOf(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

export function spyReturn(spy, txn) {
  if (!Array.isArray(spy) || !spy.length || !isDay(txn)) return null;
  const sorted = spy.filter((p) => p && isDay(p.date) && priceOf(p.close) !== null).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!sorted.length) return null;
  let base = null;
  for (const p of sorted) if (p.date <= txn) base = p;
  if (!base) return null;
  const last = sorted[sorted.length - 1];
  return r4(last.close / base.close - 1);
}

export function unusualRows(groups, chart, { chambers = null, idNames = null } = {}) {
  const spy = chart && Array.isArray(chart.spy_prices) ? chart.spy_prices : [];
  const trades = new Map();
  for (const t of chart && Array.isArray(chart.trades) ? chart.trades : []) if (t && typeof t.id === "string") trades.set(t.id, t);
  const ids = mergeById(...groups.map((g) => (Array.isArray(g) ? g : [])).slice(0, 2));
  const counter = { other: 0 };
  const out = [];
  for (const raw of ids) {
    const row = filingRow({ ...raw, filed_at_date: raw.filing_date, txn_type: raw.transaction_type, amounts: raw.amount, name: raw.politician_name });
    if (!row || !row.t || !isDay(row.txnDate) || !isDay(row.filedDate)) continue;
    const core = rowCore(row, "cg", chambers, idNames);
    const t = trades.get(raw.id);
    const p0 = t ? priceOf(t.price_at_trade) : null;
    const p1 = t ? priceOf(t.price_current) : null;
    const r = p0 !== null && p1 !== null ? r4(p1 / p0 - 1) : null;
    const rSpy = spyReturn(spy, row.txnDate);
    const { pid, src, ...rest } = core;
    out.push({
      id: raw.id, ...rest, tags: tagCodes(raw.unusual_activity_tags, counter), r, rSpy,
      ex: r !== null && rSpy !== null ? r4(r - rSpy) : null, pid,
    });
  }
  out.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0) || (a.id < b.id ? -1 : 1));
  const kept = out.slice(0, LAYER_CAPS.unusualRows);
  const byT = {};
  for (const r of kept) {
    const e = byT[r.t] || { n: 0, tags: [], who: new Set() };
    e.n++;
    for (const c of r.tags) if (!e.tags.includes(c)) e.tags.push(c);
    e.who.add(r.pid);
    byT[r.t] = e;
  }
  const byOut = Object.fromEntries(Object.entries(byT).map(([t, e]) => [t, { n: e.n, tags: e.tags.sort(), filers: e.who.size }]));
  const top = Object.entries(byOut).map(([t, e]) => ({ t, n: e.n })).sort((a, b) => (b.n - a.n) || (a.t < b.t ? -1 : 1)).slice(0, LAYER_CAPS.topUnusual);
  return { rows: kept.map(({ pid, ...r }) => r), byT: byOut, top, seen: out.length, other: counter.other };
}

export function moneyRows(companies, cycle, contributions, candidates) {
  const byT = {};
  let usable = 0;
  for (const c of Array.isArray(companies) ? companies : []) {
    if (!c || typeof c.ticker !== "string" || !c.ticker) continue;
    const num = (v) => (v === null || v === undefined ? null : dollarsOf(v));
    const cnt = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
    const entry = {
      pac: num(c.pac_total), pacN: cnt(c.pac_count), pacC: cnt(c.pac_contribution_count),
      dem: num(c.dem_total), rep: num(c.rep_total), other: num(c.other_total), lobby: num(c.lobbying_total),
      emp: num(c.employee_total_estimated), cands: null,
    };
    const k = contributions && contributions[c.ticker];
    if (k && Array.isArray(k.data)) entry.cands = new Set(k.data.map((d) => d && d.candidate_id).filter(Boolean)).size;
    byT[c.ticker] = entry;
    usable++;
  }
  const n = candidates && Array.isArray(candidates.data) ? candidates.data.length : null;
  return { cycle: Number.isSafeInteger(cycle) ? cycle : null, byT, candidates: n, usable };
}

export function heldRows(portfolios) {
  const byT = {};
  let n = 0;
  for (const p of Array.isArray(portfolios) ? portfolios : []) {
    const rows = p && Array.isArray(p.data) ? p.data : null;
    if (!rows) continue;
    n++;
    const seen = new Set();
    for (const acct of rows) {
      for (const h of acct && Array.isArray(acct.stock_holdings) ? acct.stock_holdings : []) {
        if (h && typeof h.ticker === "string" && h.ticker) seen.add(h.ticker);
      }
    }
    for (const t of seen) byT[t] = (byT[t] || 0) + 1;
  }
  return { byT, portfolios: n || null };
}

export function filerShares(trader, chambers = null) {
  const filers = [];
  for (const entry of Array.isArray(trader) ? trader : []) {
    const rows = Array.isArray(entry.rows) ? entry.rows : [];
    const all = rows.length;
    const late = rows.filter((raw) => {
      const r = filingRow(raw);
      if (!r || !isDay(r.txnDate) || !isDay(r.filedDate)) return false;
      const d = daysBetween(r.txnDate, r.filedDate);
      return d !== null && d > LAYER_CAPS.over45;
    }).length;
    filers.push({ who: initialsOf(entry.name), ch: entry.id && chambers ? chamberCode(chambers[entry.id]) : null, late, all, share: all > 0 ? Math.round((late / all) * 1e4) / 1e4 : null });
  }
  filers.sort((a, b) => (b.late - a.late) || (a.who < b.who ? -1 : a.who > b.who ? 1 : 0));
  return filers;
}

export { parseBand, sideOf };
