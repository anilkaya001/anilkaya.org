export const CENTS = 100;

const isInt = Number.isSafeInteger;

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function centsOf(value, { signed = false } = {}) {
  let negative = false;
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    negative = value < 0;
    const abs = Math.abs(value);
    text = String(abs);
    if (/e/i.test(text)) return abs < 1 ? { cents: 0, rounded: abs > 0 } : null;
  } else if (typeof value === "string") {
    text = value.trim();
    if (text.startsWith("-")) { negative = true; text = text.slice(1); }
  } else return null;
  if (negative && !signed) return null;
  const m = DECIMAL.exec(text);
  if (!m) return null;
  const frac = m[2] || "";
  let cents = Number(m[1]) * CENTS + Number((frac + "00").slice(0, 2));
  let rounded = false;
  if (frac.length > 2) {
    const rest = frac.slice(2);
    const lead = rest[0];
    const tail = /[1-9]/.test(rest.slice(1));
    if (lead > "5" || (lead === "5" && tail)) cents += 1;
    else if (lead === "5" && cents % 2 === 1) cents += 1;
    rounded = /[1-9]/.test(rest);
  }
  if (!isInt(cents)) return null;
  return { cents: negative && cents !== 0 ? -cents : cents, rounded };
}
