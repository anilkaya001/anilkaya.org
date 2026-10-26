export const ORACLE_SECTORS = [
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services",
  "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
];

const ORACLE_FUNDS = new Set(("SPY QQQ IWM DIA XLK XLC XLY XLF XLV XLI XLP XLE XLB XLU XLRE TLT IEF SHY TLH HYG LQD AGG BND JNK TBT TMF " +
  "GLD SLV USO UNG GDX GDXJ COPX DBC PDBC IAU PPLT CPER URA SIL SPX SPXW NDX NDXP RUT RUTW VIX VIXW XSP DJX MRUT " +
  "VXX UVXY SVXY VIXY SVIX UVIX IBIT BITO ETHA FBTC GBTC ETHE ARKB BITX EEM EFA FXI EWZ KWEB EWJ INDA EWY EWT VWO MCHI EWG").split(" "));

const NY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export const oracleDayOf = (iso) => NY.format(new Date(iso));

export function decimalToCents(s) {
  if (s === null || s === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(s).trim());
  if (!m) return null;
  const neg = m[1] === "-";
  const whole = BigInt(m[2]);
  const frac = m[3] || "";
  let cents = whole * 100n + BigInt((frac + "00").slice(0, 2));
  const rest = frac.slice(2);
  let rounded = false;
  if (rest.length) {
    const first = Number(rest[0]);
    const more = /[1-9]/.test(rest.slice(1));
    if (first > 5 || (first === 5 && more)) cents += 1n;
    else if (first === 5 && cents % 2n === 1n) cents += 1n;
    rounded = /[1-9]/.test(rest);
  }
  return { cents: neg ? -cents : cents, neg, rounded };
}

const rhaz = (num, den) => {
  const negative = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  let q = n / d;
  if (2n * (n - q * d) >= d) q += 1n;
  return negative ? -q : q;
};

const ceilPos = (n, d) => {
  let q = n / d;
  if (q * d < n) q += 1n;
  return q;
};

export function oracleColumn(ticker, sectorName) {
  if (ORACLE_FUNDS.has(ticker)) return "Index & ETF";
  return ORACLE_SECTORS.includes(sectorName) ? sectorName : "No sector";
}

export function oracleUniverse(u) {
  const col = new Map();
  const cap = new Map();
  const weights = new Map(ORACLE_SECTORS.map((s) => [s, 0n]));
  u.t.forEach((t, i) => {
    const idx = u.sec[i];
    const sector = typeof idx === "number" && idx >= 0 && idx < u.sectors.length ? u.sectors[idx] : null;
    const c = oracleColumn(t, sector);
    col.set(t, c);
    const m = u.cols.mcap[i];
    if (Number.isInteger(m) && m > 0 && ORACLE_SECTORS.includes(c)) {
      cap.set(t, BigInt(m));
      weights.set(c, weights.get(c) + BigInt(m));
    }
  });
  return { col, cap, weights };
}

export function oracleBook(world) {
  const uni = oracleUniverse(world.universe);
  const names = new Map();
  const counts = { given: 0, unreadable: 0, duplicate: 0, offSession: 0, noRight: 0, zero: 0, invalid: 0, invalidCents: 0n, booked: 0 };
  const premKey = (r) => {
    const c = decimalToCents(r.raw.prem);
    return c === null ? -1n : c.cents;
  };
  const wins = (a, b) => {
    const la = a.lastAt || "", lb = b.lastAt || "";
    if (la !== lb) return la > lb;
    const ra = Number.isFinite(a.reads) ? a.reads : 0, rb = Number.isFinite(b.reads) ? b.reads : 0;
    if (ra !== rb) return ra > rb;
    const pa = a.prem === null ? -1 : a.prem, pb = b.prem === null ? -1 : b.prem;
    if (pa !== pb) return pa > pb;
    return JSON.stringify(a) > JSON.stringify(b);
  };
  const chosen = new Map();
  for (const row of world.rows) {
    counts.given++;
    const key = row.t + "\u0000" + row.oc + "\u0000" + row.spanStart;
    if (chosen.has(key)) {
      counts.duplicate++;
      if (wins(row, chosen.get(key))) chosen.set(key, row);
    } else chosen.set(key, row);
  }
  for (const row of chosen.values()) {
    if (oracleDayOf(row.spanStart) !== world.session) { counts.offSession++; continue; }
    if (row.cp !== "C" && row.cp !== "P") { counts.noRight++; continue; }
    const T = decimalToCents(row.raw.prem);
    if (T === null || T.neg) { counts.unreadable++; continue; }
    const a = decimalToCents(row.raw.askPrem);
    const b = decimalToCents(row.raw.bidPrem);
    const aOk = a !== null && !a.neg;
    const bOk = b !== null && !b.neg;
    const ac = aOk ? a.cents : 0n;
    const bc = bOk ? b.cents : 0n;
    if (ac + bc > T.cents) { counts.invalid++; counts.invalidCents += T.cents; continue; }
    if (T.cents === 0n) { counts.zero++; continue; }
    const stated = aOk && bOk;
    const A = stated ? ac : 0n;
    const B = stated ? bc : 0n;
    const U = T.cents - A - B;
    let reason = null;
    if (U > 0n) reason = !stated ? "ns" : row.single === false ? "leg" : row.floor === true ? "cross" : "btw";
    const name = row.t;
    if (!names.has(name)) {
      names.set(name, {
        ticker: name, column: uni.col.has(name) ? uni.col.get(name) : oracleColumn(name, null), n: 0n, T: 0n, AC: 0n, BC: 0n, AP: 0n, BP: 0n,
        U: { btw: 0n, cross: 0n, leg: 0n, ns: 0n }, X: 0n, Ub: 0n, sided: 0n, covered: 0n, sameDay: 0n,
      });
    }
    const book = names.get(name);
    counts.booked++;
    book.n += 1n;
    book.T += T.cents;
    if (row.cp === "C") { book.AC += A; book.BC += B; } else { book.AP += A; book.BP += B; }
    if (reason) book.U[reason] += U;
    book.sided += A + B;
    if (row.exp === world.session) book.sameDay += T.cents;
    const px = decimalToCents(row.raw.px);
    if (!Number.isInteger(row.size) || row.size <= 0 || px === null || px.neg || px.cents <= 0n) continue;
    const size = BigInt(row.size);
    if (row.d === null) { book.Ub += 100n * size * px.cents; continue; }
    const d = BigInt(row.d);
    const dAbs = d < 0n ? -d : d;
    book.X += rhaz(100n * (A - B) * size * d * px.cents, T.cents * 1000000n);
    book.Ub += ceilPos(100n * U * size * dAbs * px.cents, T.cents * 1000000n);
    book.covered += A + B;
  }
  return { names, counts, uni };
}

export function oracleColumns(book) {
  const cols = new Map();
  for (const n of book.names.values()) {
    if (!cols.has(n.column)) cols.set(n.column, { n: 0n, T: 0n, AC: 0n, BC: 0n, AP: 0n, BP: 0n, U: { btw: 0n, cross: 0n, leg: 0n, ns: 0n }, X: 0n, Ub: 0n, sided: 0n, covered: 0n, sameDay: 0n });
    const c = cols.get(n.column);
    for (const k of ["n", "T", "AC", "BC", "AP", "BP", "X", "Ub", "sided", "covered", "sameDay"]) c[k] += n[k];
    for (const r of ["btw", "cross", "leg", "ns"]) c.U[r] += n.U[r];
  }
  return cols;
}

export function oracleMatrix(t, outside) {
  const post = Array.from({ length: 11 }, () => Array(6).fill(null));
  const put = (r, c, v) => { post[r][c] = (post[r][c] === null ? 0n : post[r][c]) + v; };
  put(0, 0, -t.AC); put(0, 1, t.AC);
  put(1, 0, t.BC); put(1, 1, -t.BC);
  put(2, 0, -t.AP); put(2, 1, t.AP);
  put(3, 0, t.BP); put(3, 1, -t.BP);
  ["btw", "cross", "leg", "ns"].forEach((r, i) => { put(4 + i, 2, -t.U[r]); put(4 + i, 3, t.U[r]); });
  if (outside) {
    put(8, 4, -outside.calls); put(8, 5, outside.calls);
    put(9, 4, -outside.puts); put(9, 5, outside.puts);
  }
  for (let c = 0; c < 6; c++) {
    if (!outside && c >= 4) continue;
    let s = 0n;
    for (let r = 0; r < 10; r++) if (post[r][c] !== null) s += post[r][c];
    post[10][c] = -s;
  }
  return post;
}

export function oracleOutside(tideEntry, t) {
  if (!tideEntry) return null;
  return { calls: BigInt(tideEntry.calls) - (t.AC - t.BC), puts: BigInt(tideEntry.puts) - (t.AP - t.BP) };
}

export function oracleTilt(cols, weights) {
  const weighted = ORACLE_SECTORS.filter((s) => cols.has(s) && weights.get(s) > 0n);
  if (!weighted.length) return null;
  const W = weighted.reduce((a, s) => a + weights.get(s), 0n);
  const X = weighted.reduce((a, s) => a + cols.get(s).X, 0n);
  const Ub = weighted.reduce((a, s) => a + cols.get(s).Ub, 0n);
  const sign = X < 0n ? -1n : 1n;
  const ax = X < 0n ? -X : X;
  const quota = weighted.map((s) => ({ s, num: ax * weights.get(s) }));
  const base = new Map(quota.map((q) => [q.s, q.num / W]));
  let left = ax - [...base.values()].reduce((a, b) => a + b, 0n);
  const remaining = quota.map((q) => ({ ...q, rem: q.num % W }));
  while (left > 0n) {
    let best = null;
    for (const q of remaining) {
      if (best === null || q.rem > best.rem) best = q;
    }
    base.set(best.s, base.get(best.s) + 1n);
    best.rem = -1n;
    left -= 1n;
  }
  const out = new Map();
  for (const s of weighted) {
    const a = sign * base.get(s);
    const R = cols.get(s).X - a;
    const w = weights.get(s);
    const Q = (W - w) * cols.get(s).Ub + w * (Ub - cols.get(s).Ub);
    const Wk = ceilPos(Q, W);
    out.set(s, { a, R, W: Wk, verdict: R === 0n && Wk === 0n ? "at" : R - Wk >= 1n ? "above" : R + Wk <= -1n ? "below" : "undetermined" });
  }
  return { weighted, X, W, rows: out };
}

export function oracleLean(t) {
  const T = t.T, A = t.AC + t.AP, B = t.BC + t.BP;
  if (T === 0n) return { why: "noPremium" };
  const sided = A + B;
  if (sided === 0n) return { why: "noSides", cov: [sided, T] };
  if (5n * sided < 2n * T) return { why: "lowCoverage", cov: [sided, T] };
  if (sided < 25000000n) return { why: "smallClassified", cov: [sided, T] };
  return { why: null, share: [A, sided], cov: [sided, T], lo: [A, T], hi: [T - B, T], side: 2n * A > T ? "buyers" : 2n * B > T ? "sellers" : "undetermined" };
}
