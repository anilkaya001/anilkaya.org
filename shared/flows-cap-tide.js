export const CAP_TIDE_VERSION = 1;

export const CAP_TIDE_MIN_NAMES = 30;

export const CAP_TIDE_MIN_COVERAGE = 0.5;

export const CAP_TIDE_TOP = 5;

export const CAP_TIDE_REASONS = Object.freeze({
  thin: "thin",
  coverage: "coverage",
  unavailable: "unavailable",
});

export const CAP_TIDE_CLASSES = Object.freeze(["noCap", "missing", "inconsistent", "quiet"]);

export const CAP_TIDE_COPY = Object.freeze({
  define: "Each stock's net premium over its total premium, averaged by market value.",
  net: "Net premium is net calls minus net puts.",
  outside: "Index options and funds have no market value and are outside it.",
  scope: "So it is not an index of the whole options market.",
  withheld: "It is withheld under 30 names or under half the market value.",
});

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function capTideNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!DECIMAL.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function exactSum(values) {
  const partials = [];
  for (let x of values) {
    let kept = 0;
    for (let j = 0; j < partials.length; j++) {
      let y = partials[j];
      if (Math.abs(x) < Math.abs(y)) { const swap = x; x = y; y = swap; }
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[kept++] = lo;
      x = hi;
    }
    partials.length = kept;
    partials.push(x);
  }
  let n = partials.length;
  if (!n) return 0;
  let hi = partials[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n];
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
    const twice = lo * 2;
    const up = hi + twice;
    if (twice === up - hi) hi = up;
  }
  return hi;
}

const rounded = (x, places) => {
  const k = 10 ** places;
  const r = Math.round(x * k) / k;
  return r === 0 ? 0 : r;
};

const order = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

function namesOf(rows) {
  const list = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const t = typeof row.ticker === "string" ? row.ticker.trim() : "";
    if (!t) continue;
    list.push({
      t,
      m: capTideNumber(row.marketcap),
      ncp: capTideNumber(row.net_call_premium),
      npp: capTideNumber(row.net_put_premium),
      cp: capTideNumber(row.call_premium),
      pp: capTideNumber(row.put_premium),
    });
  }
  list.sort((a, b) => order(a.t, b.t) || order(a.m, b.m) || order(a.ncp, b.ncp) || order(a.npp, b.npp) ||
    order(a.cp, b.cp) || order(a.pp, b.pp));
  return list.filter((r, i) => i === 0 || r.t !== list[i - 1].t);
}

const threshold = (v, fallback) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback);

export function capTide(rows, options = {}) {
  const o = options && typeof options === "object" ? options : {};
  const minNames = threshold(o.minNames, CAP_TIDE_MIN_NAMES);
  const minCoverage = threshold(o.minCoverage, CAP_TIDE_MIN_COVERAGE);
  const top = Math.floor(threshold(o.top, CAP_TIDE_TOP));
  const names = namesOf(rows);
  const excluded = { noCap: 0, missing: 0, inconsistent: 0, quiet: 0 };
  const caps = [];
  const used = [];
  for (const r of names) {
    if (r.m === null || !(r.m > 0)) { excluded.noCap++; continue; }
    caps.push(r.m);
    if (r.ncp === null || r.npp === null || r.cp === null || r.pp === null) { excluded.missing++; continue; }
    const net = r.ncp - r.npp;
    const gross = r.cp + r.pp;
    if (r.cp < 0 || r.pp < 0 || Math.abs(net) > gross) { excluded.inconsistent++; continue; }
    if (!(gross > 0)) { excluded.quiet++; continue; }
    used.push({ t: r.t, m: r.m, net, tau: net / gross });
  }
  const of = names.length;
  const n = used.length;
  const out = {
    v: CAP_TIDE_VERSION,
    value: null,
    reason: null,
    coverage: null,
    n,
    of,
    effN: null,
    dollarNet: null,
    equal: null,
    excluded,
    top: [],
    min: { names: minNames, coverage: minCoverage },
  };
  if (!of) return { ...out, reason: CAP_TIDE_REASONS.unavailable };
  const capAll = exactSum(caps);
  const capUsed = exactSum(used.map((u) => u.m));
  if (!Number.isFinite(capAll) || !Number.isFinite(capUsed)) return { ...out, reason: CAP_TIDE_REASONS.unavailable };
  const coverage = capAll > 0 ? capUsed / capAll : null;
  out.coverage = coverage === null ? null : rounded(coverage, 6);
  if (n) {
    for (const u of used) {
      u.w = u.m / capUsed;
      u.part = u.w * u.tau;
    }
    out.effN = rounded(1 / exactSum(used.map((u) => u.w * u.w)), 2);
    out.dollarNet = Math.round(exactSum(used.map((u) => u.net))) || 0;
  }
  if (!n || n < minNames) return { ...out, reason: CAP_TIDE_REASONS.thin };
  if (coverage === null || coverage < minCoverage) return { ...out, reason: CAP_TIDE_REASONS.coverage };
  out.value = rounded(exactSum(used.map((u) => u.part)), 6);
  out.equal = rounded(exactSum(used.map((u) => u.tau)) / n, 6);
  out.top = used.slice()
    .sort((a, b) => Math.abs(b.part) - Math.abs(a.part) || order(a.t, b.t))
    .slice(0, top)
    .map((u) => [u.t, rounded(u.w, 6), rounded(u.tau, 6), rounded(u.part, 6)]);
  return out;
}
