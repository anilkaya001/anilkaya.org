export const MINUS = "−";

export const DASH = "—";

export const NOISE = 1e-9;

export const SCALE_SUFFIX = Object.freeze(["", "K", "M", "B", "T"]);

const SHORT_DP = Object.freeze([0, 0, 1, 2, 2]);

export function fixedHalfUp(a, dp, shift = 0) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(a));
  if (!m) throw new RangeError("fixedHalfUp needs a finite number that is not negative: " + a);
  const digits = m[1] + (m[2] || "");
  const keep = m[1].length + (m[3] ? Number(m[3]) : 0) + shift + dp;
  let n;
  if (keep < 0) n = 0n;
  else if (keep >= digits.length) n = BigInt(digits + "0".repeat(keep - digits.length));
  else n = BigInt(digits.slice(0, keep) || "0") + (digits.charCodeAt(keep) >= 53 ? 1n : 0n);
  const s = n.toString().padStart(dp + 1, "0");
  return dp ? s.slice(0, s.length - dp) + "." + s.slice(s.length - dp) : s;
}

export const unitFloor = (dp) => (dp ? "0." + "0".repeat(dp - 1) + "1" : "1");

const grouped = (s) => s.replace(/^\d+/, (d) => d.replace(/\B(?=(\d{3})+$)/g, ","));

export function formatFixed(v, o) {
  if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
  const { dp = 2, shift = 0, prefix = "", suffix = "", plus = false, group = false } = o || {};
  const a = Math.abs(v);
  if (a < NOISE) return prefix + fixedHalfUp(0, dp) + suffix;
  const sign = v < 0 ? MINUS : v > 0 ? (plus ? "+" : "") : "";
  const s = fixedHalfUp(a, dp, shift);
  if (/^[0.]+$/.test(s)) return sign + "<" + prefix + unitFloor(dp) + suffix;
  return sign + prefix + (group ? grouped(s) : s) + suffix;
}

export const compactDp = (n, i) => (i === 0 ? 0 : n >= 100 ? 0 : n >= 10 ? 1 : i === 1 ? 1 : 2);

export const shortDp = (n, i) => SHORT_DP[i];

export const fixedUnitDp = (dp) => (dp === undefined ? compactDp : (n, i) => (i === 0 ? 0 : dp));

export function formatScaled(v, dpFor, prefix = "", plus = false) {
  if (typeof v !== "number" || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  if (a < NOISE) return prefix + "0";
  const sign = v < 0 ? MINUS : v > 0 ? (plus ? "+" : "") : "";
  let i = 0;
  while (i < 4 && a >= 10 ** (3 * (i + 1))) i++;
  let s, dp;
  for (;;) {
    dp = dpFor(a / 10 ** (3 * i), i);
    s = fixedHalfUp(a, dp, -3 * i);
    const n = Number(s);
    if (n >= 1000 && i < 4) { i++; continue; }
    const d2 = dpFor(n, i);
    if (d2 < dp) { dp = d2; s = fixedHalfUp(a, d2, -3 * i); }
    break;
  }
  if (/^[0.]+$/.test(s)) return sign + "<" + prefix + unitFloor(dp);
  return sign + prefix + s + SCALE_SUFFIX[i];
}

export const wholePercent = (v) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Number(fixedHalfUp(Math.abs(v), 0, 2));
  return v < 0 ? -n : n;
};
