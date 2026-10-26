import { quantile } from "../../shared/flows-stats.js";
import { openUtcMs, closeUtcMs, sessionsBetween } from "../../shared/flows-quant-time.js";

export const NORM_KEY = "oracle-norm";
export const NORM_WINDOW = 40;
export const NORM_MAX_NAMES = 1500;
export const NORM_MAX_BYTES = 96 * 1024;
export const BLK_ALPHA = 2 / (NORM_WINDOW + 1);
export const BLK_CLIP = 4;
export const BLK_CLIP_FLOOR = 50000;
export const BLK_SKIP_CAP = 20;
export const BLK_SIGMA_MAX = 1.5;
const Z90 = 1.2815515655446004;

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const r = (v) => (fin(v) ? Math.round(v * 100) / 100 : null);

export function emptyNorm() {
  return { v: 2, window: NORM_WINDOW, day: null, t: {} };
}

const legacyOk = (e) => Array.isArray(e) && e.length === 6 && [0, 1, 2, 3, 4].every((i) => fin(e[i])) && typeof e[5] === "string";
const fullOk = (e) => Array.isArray(e) && e.length === 8 && [0, 1, 2, 3, 4, 6, 7].every((i) => fin(e[i])) && typeof e[5] === "string";
const entryOk = (e) => legacyOk(e) || fullOk(e);

export function blocksOf(day) {
  const open = openUtcMs(day), close = closeUtcMs(day);
  return open === null || close === null ? 13 : (close - open) / 60000 / 30;
}

export function sigmaOf(med, p90) {
  if (!fin(med) || !(med > 0) || !fin(p90) || !(p90 >= med)) return null;
  return Math.min(BLK_SIGMA_MAX, Math.max(0, Math.log(p90 / med) / Z90));
}

export function blockMean(total, blocks) {
  return fin(total) && blocks > 0 ? total / blocks : null;
}

export function robustBlock(count, blocks, med, p90) {
  const sigma = sigmaOf(med, p90);
  if (sigma === null || !(blocks > 0)) return null;
  return (count / blocks) * med * Math.exp(sigma * sigma / 2);
}

export function foldBlk(blk, n, sessionTotal, blocks, gap) {
  let b = blk;
  let k = n;
  const skipped = Math.min(BLK_SKIP_CAP, Math.max(0, gap));
  for (let i = 0; i < skipped; i++) {
    k += 1;
    b += Math.max(1 / k, BLK_ALPHA) * (0 - b);
  }
  const x = sessionTotal / blocks;
  const clipped = Math.min(x, Math.max(BLK_CLIP * b, BLK_CLIP_FLOOR));
  k += 1;
  b += Math.max(1 / k, BLK_ALPHA) * (clipped - b);
  return { blk: b, n: k };
}

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
  const blocks = blocksOf(day);
  for (const [t, list] of prem) {
    const old = out[t];
    if (old && old[5] === day) continue;
    const n = list.length;
    const pm = quantile(list, 0.5), p90 = quantile(list, 0.9);
    const sl = size.get(t);
    const sm = sl.length ? quantile(sl, 0.5) : null, s90 = sl.length ? quantile(sl, 0.9) : null;
    const total = list.reduce((a, b) => a + b, 0);
    const seed = robustBlock(n, blocks, pm, p90);
    if (!old) {
      out[t] = [n, r(pm), r(p90), r(sm === null ? 0 : sm), r(s90 === null ? 0 : s90), day, Math.round((seed === null ? blockMean(total, blocks) : seed) / 1000), 1];
      continue;
    }
    const keep = old[0] * (NORM_WINDOW - 1) / NORM_WINDOW;
    const sum = keep + n;
    const mix = (a, b) => r((a * keep + b * n) / sum);
    let blkK, blkN;
    if (fullOk(old)) {
      const gap = Math.max(0, sessionsBetween(old[5], day) - 1);
      const f = foldBlk(old[6] * 1000, old[7], total, blocks, gap);
      blkK = Math.round(f.blk / 1000);
      blkN = Math.min(99, f.n);
    } else {
      blkK = Math.round((seed === null ? blockMean(total, blocks) : seed) / 1000);
      blkN = 1;
    }
    out[t] = [Math.round(sum), mix(old[1], pm), mix(old[2], p90), sm === null ? old[3] : mix(old[3], sm), s90 === null ? old[4] : mix(old[4], s90), day, blkK, blkN];
  }
  const names = Object.keys(out);
  const byAge = (a, b) => (out[a][5] < out[b][5] ? -1 : out[a][5] > out[b][5] ? 1 : 0);
  if (names.length > NORM_MAX_NAMES) {
    names.sort(byAge);
    for (const t of names.slice(0, names.length - NORM_MAX_NAMES)) delete out[t];
  }
  const body = { v: 2, window: NORM_WINDOW, day, sessionDate: day, t: out };
  if (JSON.stringify(body).length > NORM_MAX_BYTES) {
    const oldest = Object.keys(out).sort(byAge);
    for (const t of oldest) {
      delete out[t];
      if (JSON.stringify(body).length <= NORM_MAX_BYTES) break;
    }
  }
  return body;
}

export function normOf(ledger, ticker) {
  const e = ledger && ledger.t ? ledger.t[ticker] : null;
  if (!entryOk(e)) return null;
  const base = { winN: e[0], premiumMedian: e[1], premiumP90: e[2], sizeMedian: e[3], sizeP90: e[4], callShare: null };
  return fullOk(e) ? { ...base, blk: e[6] * 1000, blkN: e[7] } : { ...base, blk: null, blkN: 0 };
}
