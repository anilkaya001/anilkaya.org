import { windowEntry, centsOf } from "./flows-sides.js";
import { alertKey } from "./flows-alerts.js";
import { bsmGreeks } from "./flows-quant-bs.js";
import { yearFraction, rootOfSymbol } from "./flows-quant-time.js";
import { PRICING_RATE } from "./flows-premium.js";
import { easternDay } from "./flows-freshness.js";

export const SECTORS = Object.freeze([
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
  "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]);

export const FUNDS_COLUMN = "Index & ETF";

export const NO_SECTOR = "No sector";

export const COLUMNS = Object.freeze([...SECTORS, FUNDS_COLUMN, NO_SECTOR]);

export const FUND_TICKERS = Object.freeze(new Set([
  "SPY", "QQQ", "IWM", "DIA",
  "XLK", "XLC", "XLY", "XLF", "XLV", "XLI", "XLP", "XLE", "XLB", "XLU", "XLRE",
  "TLT", "IEF", "SHY", "TLH", "HYG", "LQD", "AGG", "BND", "JNK", "TBT", "TMF",
  "GLD", "SLV", "USO", "UNG", "GDX", "GDXJ", "COPX", "DBC", "PDBC", "IAU", "PPLT", "CPER", "URA", "SIL",
  "SPX", "SPXW", "NDX", "NDXP", "RUT", "RUTW", "VIX", "VIXW", "XSP", "DJX", "MRUT",
  "VXX", "UVXY", "SVXY", "VIXY", "SVIX", "UVIX",
  "IBIT", "BITO", "ETHA", "FBTC", "GBTC", "ETHE", "ARKB", "BITX",
  "EEM", "EFA", "FXI", "EWZ", "KWEB", "EWJ", "INDA", "EWY", "EWT", "VWO", "MCHI", "EWG",
]));

export const TIDE_ETFS = Object.freeze(["SPY", "QQQ", "IWM", "DIA"]);

export function columnOf(ticker, sectorName) {
  if (FUND_TICKERS.has(ticker)) return FUNDS_COLUMN;
  if (typeof sectorName === "string" && SECTORS.includes(sectorName)) return sectorName;
  return NO_SECTOR;
}

const isInt = Number.isSafeInteger;

const plus = (a, b) => {
  const s = a + b;
  if (!isInt(s)) throw new RangeError("a ledger sum left the safe integers");
  return s;
};

export const safe = (v) => {
  const n = Number(v);
  if (!isInt(n)) throw new RangeError("a ledger figure left the safe integers");
  return n;
};

export function readUniverse(universe) {
  const u = universe !== null && typeof universe === "object" ? universe : {};
  const names = Array.isArray(u.t) ? u.t : [];
  const sectors = Array.isArray(u.sectors) ? u.sectors : [];
  const sec = Array.isArray(u.sec) ? u.sec : [];
  const caps = u.cols && Array.isArray(u.cols.mcap) ? u.cols.mcap : [];
  const columnByTicker = new Map();
  const capByTicker = new Map();
  const weights = new Map(SECTORS.map((s) => [s, 0]));
  const members = new Map(SECTORS.map((s) => [s, []]));
  names.forEach((ticker, i) => {
    if (typeof ticker !== "string" || !ticker) return;
    const index = sec[i];
    const sector = Number.isInteger(index) && index >= 0 && index < sectors.length ? sectors[index] : null;
    const column = columnOf(ticker, sector);
    columnByTicker.set(ticker, column);
    if (members.has(column)) members.get(column).push(ticker);
    const cap = caps[i];
    if (isInt(cap) && cap > 0 && SECTORS.includes(column)) {
      capByTicker.set(ticker, cap);
      weights.set(column, plus(weights.get(column), cap));
    }
  });
  return {
    columnOf: (ticker) => (columnByTicker.has(ticker) ? columnByTicker.get(ticker) : columnOf(ticker, null)),
    known: (ticker) => columnByTicker.has(ticker),
    capOf: (ticker) => (capByTicker.has(ticker) ? capByTicker.get(ticker) : null),
    weights,
    members,
    names: names.length,
  };
}

const MICRO = 1000000;

const SIGMA_MAX = 5;

const T_FLOOR = 60 / (365 * 86400);

export function deltaMicroOf(row, { rate = PRICING_RATE } = {}) {
  if (row === null || typeof row !== "object") return null;
  const S = Number(row.px);
  const K = Number(row.k);
  const iv = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= SIGMA_MAX ? v : null);
  const sigma = iv(row.ivEnd) ?? iv(row.ivStart);
  const end = Date.parse(typeof row.spanEnd === "string" && row.spanEnd ? row.spanEnd : row.spanStart);
  if (!(S > 0) || !(K > 0) || sigma === null || !Number.isFinite(end) || typeof row.exp !== "string") return null;
  const day = easternDay(end);
  if (!day || row.exp < day) return null;
  let T = yearFraction(end, row.exp, typeof row.t === "string" ? row.t : null);
  if (T === null || !Number.isFinite(T)) return null;
  if (!(T > T_FLOOR)) T = T_FLOOR;
  const g = bsmGreeks({ S, K, r: rate, q: 0, sigma, T, type: row.cp === "P" ? "P" : "C" });
  if (!g || !Number.isFinite(g.delta)) return null;
  return Math.sign(g.delta) * Math.round(Math.abs(g.delta) * MICRO);
}

const rhaz = (num, den) => {
  const negative = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
};

const ceilDiv = (num, den) => (num + den - 1n) / den;

const text = (v) => (typeof v === "string" ? v : "");

function newerRead(a, b) {
  const la = text(a.lastAt), lb = text(b.lastAt);
  if (la !== lb) return la > lb;
  const ra = Number.isFinite(a.reads) ? a.reads : 0, rb = Number.isFinite(b.reads) ? b.reads : 0;
  if (ra !== rb) return ra > rb;
  const pa = Number.isFinite(a.prem) ? a.prem : -1, pb = Number.isFinite(b.prem) ? b.prem : -1;
  if (pa !== pb) return pa > pb;
  return JSON.stringify(a) > JSON.stringify(b);
}

const newBook = (ticker, column) => ({
  ticker, column, n: 0, T: 0, AC: 0, BC: 0, AP: 0, BP: 0,
  U: { btw: 0, cross: 0, leg: 0, ns: 0 }, X: 0n, Ub: 0n, sided: 0, covered: 0, sameDay: 0, noExposure: 0,
});

const emptyCounts = () => ({
  given: 0, unreadable: 0, duplicate: 0, offSession: 0, noRight: 0, zero: 0, invalid: 0, invalidCents: 0, rounded: 0, booked: 0, noExposure: 0, noDelta: 0,
});

export function sessionOfWindow(row) {
  const at = typeof row.spanStart === "string" && row.spanStart ? row.spanStart : typeof row.spanEnd === "string" ? row.spanEnd : null;
  return at === null ? null : easternDay(at);
}

export function bookWindows(rows, { column, deltaMicro = deltaMicroOf, session = null, sessionOf = sessionOfWindow, collect = false } = {}) {
  const books = new Map();
  const accepted = [];
  const counts = emptyCounts();
  const latest = new Map();
  const queue = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    counts.given += 1;
    if (row === null || typeof row !== "object" || typeof row.t !== "string" || !row.t) { counts.unreadable += 1; continue; }
    const key = alertKey(row);
    if (key === null) { queue.push(row); continue; }
    if (latest.has(key)) {
      counts.duplicate += 1;
      if (newerRead(row, latest.get(key))) latest.set(key, row);
    } else {
      latest.set(key, row);
      queue.push(key);
    }
  }
  for (const item of queue) {
    const row = typeof item === "string" ? latest.get(item) : item;
    if (session !== null) {
      const day = sessionOf(row);
      if (day !== null && day !== session) { counts.offSession += 1; continue; }
    }
    const right = row.cp === "C" ? "C" : row.cp === "P" ? "P" : null;
    if (right === null) { counts.noRight += 1; continue; }
    const entry = windowEntry(row);
    if (entry.rounded) counts.rounded += 1;
    if (!entry.ok) {
      if (entry.why === "sides") { counts.invalid += 1; counts.invalidCents = plus(counts.invalidCents, entry.T); } else counts.unreadable += 1;
      continue;
    }
    if (entry.T === 0) { counts.zero += 1; continue; }
    const name = row.t;
    if (!books.has(name)) books.set(name, newBook(name, column(name)));
    const book = books.get(name);
    book.n += 1;
    counts.booked += 1;
    if (collect) accepted.push({ row, entry, right });
    book.T = plus(book.T, entry.T);
    if (right === "C") { book.AC = plus(book.AC, entry.A); book.BC = plus(book.BC, entry.B); } else { book.AP = plus(book.AP, entry.A); book.BP = plus(book.BP, entry.B); }
    if (entry.reason !== null) book.U[entry.reason] = plus(book.U[entry.reason], entry.U);
    book.sided = plus(book.sided, entry.A + entry.B);
    if (session !== null && row.exp === session) book.sameDay = plus(book.sameDay, entry.T);
    const size = row.size;
    const price = centsOf(row.px);
    if (!isInt(size) || size <= 0 || price === null || price.cents <= 0) { book.noExposure += 1; counts.noExposure += 1; continue; }
    const S = BigInt(price.cents);
    const P = BigInt(entry.T);
    const delta = deltaMicro(row);
    if (delta === null || !Number.isInteger(delta) || Math.abs(delta) > MICRO) {
      book.Ub += 100n * BigInt(size) * S;
      counts.noDelta += 1;
      continue;
    }
    const d = BigInt(delta);
    const dAbs = d < 0n ? -d : d;
    book.X += rhaz(100n * BigInt(entry.A - entry.B) * BigInt(size) * d * S, P * BigInt(MICRO));
    book.Ub += ceilDiv(100n * BigInt(entry.U) * BigInt(size) * dAbs * S, P * BigInt(MICRO));
    book.covered = plus(book.covered, entry.A + entry.B);
  }
  return { books, counts, accepted };
}

export function sumBooks(books, include = () => true) {
  const out = emptyTotals();
  for (const book of books.values()) {
    if (!include(book)) continue;
    out.names += 1;
    out.n += book.n;
    for (const k of ["T", "AC", "BC", "AP", "BP", "sided", "covered", "sameDay", "noExposure"]) out[k] = plus(out[k], book[k]);
    for (const r of Object.keys(out.U)) out.U[r] = plus(out.U[r], book.U[r]);
    out.X += book.X;
    out.Ub += book.Ub;
  }
  return out;
}

export const unsidedOf = (t) => t.U.btw + t.U.cross + t.U.leg + t.U.ns;

export const netTakerPremium = (t) => (t.AC + t.AP) - (t.BC + t.BP);

export function apportion(total, weights) {
  const t = BigInt(total);
  const w = weights.map((x) => BigInt(x));
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) return null;
  const abs = t < 0n ? -t : t;
  const floors = w.map((x) => (abs * x) / sum);
  const rems = w.map((x) => (abs * x) % sum);
  let left = abs - floors.reduce((a, b) => a + b, 0n);
  const order = w.map((_, i) => i).sort((p, q) => (rems[q] > rems[p] ? 1 : rems[q] < rems[p] ? -1 : p - q));
  for (let i = 0; left > 0n; i++, left--) floors[order[i]] += 1n;
  return floors.map((x) => (t < 0n ? -x : x));
}

export const TILT_COVERAGE = Object.freeze({ num: 80, den: 100 });

export function tiltOf(columns, weights) {
  const weighted = COLUMNS.filter((c) => columns.has(c) && (weights.get(c) || 0) > 0 && SECTORS.includes(c));
  const out = new Map();
  for (const c of COLUMNS) {
    const t = columns.get(c);
    out.set(c, { column: c, X: t ? t.X : 0n, U: t ? t.Ub : 0n, weight: weights.get(c) || 0, weighted: weighted.includes(c), a: null, R: null, W: null, verdict: null });
  }
  if (!weighted.length) return { rows: out, weighted, sum: null, total: null };
  const w = weighted.map((c) => BigInt(weights.get(c)));
  const Wt = w.reduce((a, b) => a + b, 0n);
  const Xt = weighted.reduce((a, c) => a + out.get(c).X, 0n);
  const Ut = weighted.reduce((a, c) => a + out.get(c).U, 0n);
  const a = apportion(Xt, w);
  let sum = 0n;
  weighted.forEach((c, i) => {
    const row = out.get(c);
    row.a = a[i];
    row.R = row.X - a[i];
    sum += row.R;
    const Q = (Wt - w[i]) * row.U + w[i] * (Ut - row.U);
    row.W = ceilDiv(Q, Wt);
    row.verdict = row.R === 0n && row.W === 0n ? "at" : row.R - row.W >= 1n ? "above" : row.R + row.W <= -1n ? "below" : "undetermined";
  });
  return { rows: out, weighted, sum, total: Xt };
}

export function tiltCoverage(columns, weights) {
  let covered = 0;
  let all = 0;
  for (const c of SECTORS) {
    const t = columns.get(c);
    if (!t || !((weights.get(c) || 0) > 0)) continue;
    covered = plus(covered, t.covered);
    all = plus(all, t.sided);
  }
  const passes = all > 0 && 100 * covered >= 80 * all;
  return { covered, all, passes, pct: all > 0 ? Math.floor((100 * covered) / all) : null };
}

export function drillSector(books, column, members, capOf) {
  const seen = new Set(members);
  const extra = [...books.values()].filter((b) => b.column === column && !seen.has(b.ticker)).map((b) => b.ticker);
  const tickers = [...members, ...extra].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
  const capped = tickers.filter((t) => capOf(t) !== null);
  const bookOf = (t) => books.get(t) || null;
  const Xk = capped.reduce((a, t) => a + (bookOf(t) ? bookOf(t).X : 0n), 0n);
  const alloc = capped.length ? apportion(Xk, capped.map((t) => capOf(t))) : null;
  const capSum = capped.reduce((a, t) => a + capOf(t), 0);
  const rows = tickers.map((ticker) => {
    const i = capped.indexOf(ticker);
    const b = bookOf(ticker);
    const x = b ? b.X : 0n;
    return { ticker, book: b, cap: capOf(ticker), a: i >= 0 && alloc ? alloc[i] : null, R: i >= 0 && alloc ? x - alloc[i] : null, share: i >= 0 && capSum > 0 ? capOf(ticker) / capSum : null };
  });
  const sum = alloc ? rows.reduce((a, r) => a + (r.R === null ? 0n : r.R), 0n) : null;
  return { rows, capped: capped.length, uncapped: tickers.length - capped.length, sum, Xk };
}

export const MATRIX_COLUMNS = Object.freeze(["TK", "LP", "BN", "SN", "TO", "LO"]);

export const MATRIX_ROWS = Object.freeze(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10", "r11"]);

export function buildMatrix(t, outside) {
  const absent = !outside || outside.calls === null || outside.puts === null || outside.calls === undefined || outside.puts === undefined;
  const blank = () => [null, null, null, null, null, null];
  const row = (patch) => { const r = blank(); for (const [i, v] of patch) r[i] = v; return r; };
  const rows = [
    row([[0, -t.AC], [1, t.AC]]),
    row([[0, t.BC], [1, -t.BC]]),
    row([[0, -t.AP], [1, t.AP]]),
    row([[0, t.BP], [1, -t.BP]]),
    row([[2, -t.U.btw], [3, t.U.btw]]),
    row([[2, -t.U.cross], [3, t.U.cross]]),
    row([[2, -t.U.leg], [3, t.U.leg]]),
    row([[2, -t.U.ns], [3, t.U.ns]]),
    absent ? blank() : row([[4, -outside.calls], [5, outside.calls]]),
    absent ? blank() : row([[4, -outside.puts], [5, outside.puts]]),
  ];
  const balancing = blank();
  for (let c = 0; c < 6; c++) {
    if (absent && c >= 4) continue;
    let s = 0n;
    for (const r of rows) if (r[c] !== null) s += BigInt(r[c]);
    balancing[c] = s === 0n ? 0 : safe(-s);
  }
  rows.push(balancing);
  return { rows, absentOutside: absent };
}

export function matrixSums(matrix) {
  const rowSums = matrix.rows.map((r) => safe(r.reduce((a, v) => (v === null ? a : a + BigInt(v)), 0n)));
  const colSums = [0, 1, 2, 3, 4, 5].map((c) => safe(matrix.rows.reduce((a, r) => (r[c] === null ? a : a + BigInt(r[c])), 0n)));
  return { rowSums, colSums };
}

export const emptyTotals = () => ({
  n: 0, T: 0, AC: 0, BC: 0, AP: 0, BP: 0, U: { btw: 0, cross: 0, leg: 0, ns: 0 }, X: 0n, Ub: 0n, sided: 0, covered: 0, sameDay: 0, noExposure: 0, names: 0,
});

export function outsideOf(tide, t) {
  if (!tide) return null;
  const calls = tide.calls;
  const puts = tide.puts;
  if (!isInt(calls) || !isInt(puts)) return null;
  return { calls: plus(calls, -(t.AC - t.BC)), puts: plus(puts, -(t.AP - t.BP)) };
}

export function outsideAll(columns, tides) {
  let calls = 0n;
  let puts = 0n;
  const measured = [];
  for (const c of SECTORS) {
    const o = outsideOf(tides.get(c) || null, columns.get(c) || emptyTotals());
    if (o === null) continue;
    calls += BigInt(o.calls);
    puts += BigInt(o.puts);
    measured.push(c);
  }
  return measured.length ? { calls: safe(calls), puts: safe(puts), measured } : null;
}

export const PERIODS = Object.freeze(["intraday", "session", "five"]);
