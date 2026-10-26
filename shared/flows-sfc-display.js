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
