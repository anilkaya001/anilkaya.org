export const RANK_BUCKETS = Object.freeze([
  Object.freeze([1, 7]), Object.freeze([8, 14]), Object.freeze([15, 42]), Object.freeze([43, 90]), Object.freeze([91, 400]),
]);

const text = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function lineCompare(a, b) {
  const ka = num(a.key), kb = num(b.key);
  if (ka !== kb) {
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka;
  }
  const oa = num(a.oi) === null ? -1 : a.oi, ob = num(b.oi) === null ? -1 : b.oi;
  if (oa !== ob) return ob - oa;
  if (a.strike !== b.strike) return a.strike - b.strike;
  return text(a.expiry, b.expiry) || text(a.symbol, b.symbol);
}

export function bucketOf(days) {
  for (let i = 0; i < RANK_BUCKETS.length; i++) if (days >= RANK_BUCKETS[i][0] && days <= RANK_BUCKETS[i][1]) return i;
  return -1;
}
