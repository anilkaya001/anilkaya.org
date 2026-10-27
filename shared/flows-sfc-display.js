import { roundTable } from "./flows-round.js";

export const MINUS = "−";

export const DASH = "—";

const MAX_E = 7;

export function unitFor(maxAbsCents) {
  const m = Math.abs(maxAbsCents);
  if (!Number.isSafeInteger(m)) throw new RangeError("unitFor takes a safe integer");
  const dollars = Math.floor(m / 100);
  const digits = dollars === 0 ? 0 : String(dollars).length;
  const e = Math.min(MAX_E, Math.max(0, digits - 4));
  const div = e <= 0 ? 0 : e <= 3 ? 3 : e <= 6 ? 6 : 9;
  const names = { 0: "USD", 3: "USD thousands", 6: "USD millions", 9: "USD billions" };
  const step = 10 ** e;
  const shift = e === 0 ? 0 : div - e;
  const stepLabel = step >= 1e9 ? `$${step / 1e9}B` : step >= 1e6 ? `$${step / 1e6}M` : step >= 1e3 ? `$${step / 1e3}k` : `$${step}`;
  return { e, unitCents: step * 100, shift, scaleName: names[e === 0 ? 0 : div], stepLabel };
}

const group = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function formatUnits(units, unit) {
  if (!Number.isSafeInteger(units)) throw new RangeError("formatUnits takes a safe integer");
  const negative = units < 0;
  let s = String(Math.abs(units));
  let frac = "";
  if (unit.shift > 0) {
    s = s.padStart(unit.shift + 1, "0");
    frac = "." + s.slice(-unit.shift);
    s = s.slice(0, -unit.shift);
  }
  return (negative ? MINUS : "") + group(s) + frac;
}

export function cellText(exactCents, units, unit) {
  if (exactCents === 0) return "0";
  if (units === 0) return "~0";
  return formatUnits(units, unit);
}

export function exactDollars(cents) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("exactDollars takes a safe integer");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = group(String(Math.floor(abs / 100)));
  const frac = String(abs % 100).padStart(2, "0");
  return (negative ? MINUS : "") + "$" + whole + "." + frac;
}

export function exactCents(cents) {
  return (cents < 0 ? MINUS : "") + group(String(Math.abs(cents))) + " ¢";
}

export function moneyShort(cents) {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? MINUS : "";
  const dollars = abs / 100;
  if (dollars >= 1e9) return `${sign}$${(dollars / 1e9).toFixed(2)}B`;
  if (dollars >= 1e6) return `${sign}$${(dollars / 1e6).toFixed(2)}M`;
  if (dollars >= 1e3) return `${sign}$${(dollars / 1e3).toFixed(1)}k`;
  return `${sign}$${dollars.toFixed(0)}`;
}

const floorDiv = (n, d) => n / d - (n % d !== 0n && (n < 0n) !== (d < 0n) ? 1n : 0n);

const ceilDiv = (n, d) => -floorDiv(-n, d);

const TIERS = Object.freeze([
  Object.freeze({ min: 0n, step: 100n, decimals: 0, suffix: "" }),
  Object.freeze({ min: 100000n, step: 10000n, decimals: 1, suffix: "k" }),
  Object.freeze({ min: 100000000n, step: 1000000n, decimals: 2, suffix: "M" }),
  Object.freeze({ min: 100000000000n, step: 1000000000n, decimals: 2, suffix: "B" }),
]);

function outwards(cents, direction) {
  if (!Number.isSafeInteger(cents)) throw new RangeError("moneyOut takes a safe integer");
  if (direction !== "down" && direction !== "up") throw new RangeError("moneyOut rounds down or up");
  const c = BigInt(cents);
  const abs = c < 0n ? -c : c;
  let i = 0;
  while (i + 1 < TIERS.length && abs >= TIERS[i + 1].min) i += 1;
  const at = (k) => (direction === "down" ? floorDiv(c, TIERS[k].step) : ceilDiv(c, TIERS[k].step));
  let count = at(i);
  let width = count < 0n ? -count : count;
  while (i + 1 < TIERS.length && width * TIERS[i].step >= TIERS[i + 1].min) {
    i += 1;
    count = at(i);
    width = count < 0n ? -count : count;
  }
  return { count, width, tier: TIERS[i] };
}

export function moneyOut(cents, direction, { plus = false } = {}) {
  const { count, width, tier } = outwards(cents, direction);
  if (count === 0n) return "$0";
  const digits = String(width).padStart(tier.decimals + 1, "0");
  const whole = tier.decimals ? digits.slice(0, -tier.decimals) : digits;
  const frac = tier.decimals ? "." + digits.slice(-tier.decimals) : "";
  return (count < 0n ? MINUS : plus ? "+" : "") + "$" + group(whole) + frac + tier.suffix;
}

export function printedSign(cents, direction) {
  const { count } = outwards(cents, direction);
  return count > 0n ? 1 : count < 0n ? -1 : 0;
}

export function netProof(net, unknown) {
  if (!Number.isSafeInteger(net) || !Number.isSafeInteger(unknown) || unknown < 0) throw new RangeError("netProof takes safe integer cents and a non-negative side unknown");
  if (unknown === 0) return net > 0 ? "up" : net < 0 ? "down" : "even";
  if (printedSign(net - unknown, "down") > 0) return "up";
  if (printedSign(net + unknown, "up") < 0) return "down";
  return "open";
}

const tenthsDown = (n, t) => (n * 1000n) / t;

const tenthsUp = (n, t) => (n * 1000n + t - 1n) / t;

const tenths = (x, up) => {
  if (x >= 490n && x <= 510n) return x % 10n === 0n ? String(x / 10n) : `${x / 10n}.${x % 10n}`;
  return String(up ? (x + 9n) / 10n : x / 10n);
};

const sayBound = (text) => (text.startsWith(">") ? "over " + text.slice(1) : text.startsWith("<") ? "under " + text.slice(1) : text);

export function leanBounds(askCents, bidCents, unknownCents) {
  for (const v of [askCents, bidCents, unknownCents]) if (!Number.isSafeInteger(v) || v < 0) throw new RangeError("leanBounds takes safe non-negative integers");
  const A = BigInt(askCents);
  const B = BigInt(bidCents);
  const U = BigInt(unknownCents);
  const T = A + B + U;
  if (T === 0n) return null;
  if (U === 0n) {
    if (2n * A === T) return { text: "50%", lo: "50", hi: "50", say: "50%", single: true };
    const i = (200n * A + T) / (2n * T);
    const text = i !== 50n ? `${i}%` : 2n * A > T ? ">50%" : "<50%";
    return { text, lo: text.slice(0, -1), hi: text.slice(0, -1), say: sayBound(text), single: true };
  }
  const lo10 = tenthsDown(A, T);
  const hi10 = tenthsUp(A + U, T);
  const lo = 2n * A > T && lo10 === 500n ? ">50" : tenths(lo10, false);
  const hi = 2n * B > T && hi10 === 500n ? "<50" : tenths(hi10, true);
  return { text: `${lo}–${hi}%`, lo, hi, say: `${sayBound(lo)} to ${sayBound(hi)}%`, single: false };
}

export function scaleText(cents) {
  const d = Math.abs(cents) / 100;
  const pick = (v, suffix) => "$" + Number(v.toPrecision(3)) + suffix;
  if (d >= 1e9) return pick(d / 1e9, "B");
  if (d >= 1e6) return pick(d / 1e6, "M");
  if (d >= 1e3) return pick(d / 1e3, "k");
  return pick(d, "");
}

export function niceScale(cents) {
  const m = Math.abs(cents);
  if (!Number.isSafeInteger(m)) throw new RangeError("niceScale takes a safe integer");
  if (m === 0) return 100;
  const base = 10 ** (String(m).length - 1);
  for (const step of [1, 2, 5, 10]) {
    const scale = step * base;
    if (scale >= m) {
      if (!Number.isSafeInteger(scale)) throw new RangeError("niceScale left the safe integers");
      return scale;
    }
  }
  throw new RangeError("niceScale found no step");
}

export function roundGrid(grid, unit) {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (!rows || !cols) return { cells: [], rowTotals: [], colTotals: [], total: 0 };
  const flat = grid.map((row) => row.map((v) => (v === null ? 0 : v)));
  const r = roundTable(flat, unit.unitCents);
  return r;
}

export function caption(unit, kind = "premium") {
  const head = kind === "delta" ? "Delta-dollars, " : "";
  if (unit.e === 0) return `${head}USD, to $1, so totals foot. Hover for exact.`;
  return `${head}${unit.scaleName}, to ${unit.stepLabel}, so totals foot. Hover for exact.`;
}
