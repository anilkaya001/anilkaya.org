import { quantile } from "../../shared/flows-stats.js";

export const NORM_KEY = "oracle-norm";
export const NORM_WINDOW = 40;
export const NORM_MAX_NAMES = 1500;

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const r = (v) => (fin(v) ? Math.round(v * 100) / 100 : null);

export function emptyNorm() {
  return { v: 1, window: NORM_WINDOW, day: null, t: {} };
}

const entryOk = (e) => Array.isArray(e) && e.length === 6 && [0, 1, 2, 3, 4].every((i) => fin(e[i])) && typeof e[5] === "string";

export function foldNorm(prior, rows, day) {
  const base = prior && typeof prior === "object" && prior.t && typeof prior.t === "object" ? prior.t : {};
  const out = {};
  for (const [t, e] of Object.entries(base)) if (entryOk(e)) out[t] = e.slice();
  const prem = new Map();
  const size = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.t !== "string" || !fin(row.prem) || row.prem <= 0) continue;
    if (!prem.has(row.t)) { prem.set(row.t, []); size.set(row.t, []); }
    prem.get(row.t).push(row.prem);
    if (fin(row.size) && row.size > 0) size.get(row.t).push(row.size);
  }
  for (const [t, list] of prem) {
    const old = out[t];
    if (old && old[5] === day) continue;
    const n = list.length;
    const pm = quantile(list, 0.5), p90 = quantile(list, 0.9);
    const sl = size.get(t);
    const sm = sl.length ? quantile(sl, 0.5) : null, s90 = sl.length ? quantile(sl, 0.9) : null;
    if (!old) { out[t] = [n, r(pm), r(p90), r(sm === null ? 0 : sm), r(s90 === null ? 0 : s90), day]; continue; }
    const keep = old[0] * (NORM_WINDOW - 1) / NORM_WINDOW;
    const total = keep + n;
    const mix = (a, b) => r((a * keep + b * n) / total);
    out[t] = [Math.round(total), mix(old[1], pm), mix(old[2], p90), sm === null ? old[3] : mix(old[3], sm), s90 === null ? old[4] : mix(old[4], s90), day];
  }
  const names = Object.keys(out);
  if (names.length > NORM_MAX_NAMES) {
    names.sort((a, b) => (out[a][5] < out[b][5] ? -1 : out[a][5] > out[b][5] ? 1 : 0));
    for (const t of names.slice(0, names.length - NORM_MAX_NAMES)) delete out[t];
  }
  return { v: 1, window: NORM_WINDOW, day, sessionDate: day, t: out };
}

export function normOf(ledger, ticker) {
  const e = ledger && ledger.t ? ledger.t[ticker] : null;
  if (!entryOk(e)) return null;
  return { winN: e[0], premiumMedian: e[1], premiumP90: e[2], sizeMedian: e[3], sizeP90: e[4], callShare: null };
}
