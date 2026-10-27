const TRIGGER = /^[=+\-@\t\r]/;

export const DASH = "—";

export function textCell(s) {
  const v = TRIGGER.test(s) ? "'" + s : s;
  return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v;
}

export function ratioDigits(num, den, dp) {
  const n = BigInt(num);
  const d = BigInt(den);
  if (d <= 0n || n < 0n) throw new RangeError("ratioDigits needs a positive denominator and a non-negative numerator");
  const s = 10n ** BigInt(dp);
  const q = (2n * n * s + d) / (2n * d);
  return (q / s).toString() + (dp > 0 ? "." + (q % s).toString().padStart(dp, "0") : "");
}

export function fixed(x, dp) {
  const t = x.toFixed(dp);
  return /^-0(?:\.0*)?$/.test(t) ? t.slice(1) : t;
}

export function absentCell(entries) {
  return entries.map(([key, reason]) => key + ":" + reason + ";").join("");
}
