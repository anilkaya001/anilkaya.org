export const YEAR_SECONDS = 365 * 86400;
const DAY_MS = 86400000;

const pad = (n) => (n < 10 ? "0" + n : String(n));
export const isoDay = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);

export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, t };
}

const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function nthWeekday(y, m, dow, n) {
  const first = weekday(y, m, 1);
  return 1 + ((dow - first + 7) % 7) + 7 * (n - 1);
}

function lastWeekday(y, m, dow) {
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = weekday(y, m, days);
  return days - ((last - dow + 7) % 7);
}

export function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

function observed(y, m, d, saturdayRule) {
  const w = weekday(y, m, d);
  if (w === 0) { const t = new Date(Date.UTC(y, m - 1, d + 1)); return isoDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); }
  if (w === 6) {
    if (!saturdayRule) return null;
    const t = new Date(Date.UTC(y, m - 1, d - 1));
    return isoDay(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  return isoDay(y, m, d);
}

const HOLIDAY_CACHE = new Map();

export function nyseHolidays(y) {
  if (HOLIDAY_CACHE.has(y)) return HOLIDAY_CACHE.get(y);
  const out = new Set();
  const add = (v) => { if (v) out.add(v); };
  add(observed(y, 1, 1, false));
  add(isoDay(y, 1, nthWeekday(y, 1, 1, 3)));
  add(isoDay(y, 2, nthWeekday(y, 2, 1, 3)));
  const e = easterSunday(y);
  const gf = new Date(Date.UTC(y, e.m - 1, e.d - 2));
  add(isoDay(gf.getUTCFullYear(), gf.getUTCMonth() + 1, gf.getUTCDate()));
  add(isoDay(y, 5, lastWeekday(y, 5, 1)));
  if (y >= 2022) add(observed(y, 6, 19, true));
  add(observed(y, 7, 4, true));
  add(isoDay(y, 9, nthWeekday(y, 9, 1, 1)));
  add(isoDay(y, 11, nthWeekday(y, 11, 4, 4)));
  add(observed(y, 12, 25, true));
  HOLIDAY_CACHE.set(y, out);
  return out;
}

export function isSession(day) {
  const p = parseDay(day);
  if (!p) return false;
  const w = weekday(p.y, p.m, p.d);
  if (w === 0 || w === 6) return false;
  return !nyseHolidays(p.y).has(isoDay(p.y, p.m, p.d));
}

export function sessionsBetween(fromDay, toDay) {
  const a = parseDay(fromDay), b = parseDay(toDay);
  if (!a || !b || b.t <= a.t) return 0;
  let n = 0;
  for (let t = a.t + DAY_MS; t <= b.t; t += DAY_MS) {
    const d = new Date(t);
    if (isSession(isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()))) n++;
  }
  return n;
}

export function calendarDays(fromDay, toDay) {
  const a = parseDay(fromDay), b = parseDay(toDay);
  if (!a || !b) return null;
  return Math.round((b.t - a.t) / DAY_MS);
}

function usDst(y, m, d) {
  const start = nthWeekday(y, 3, 0, 2), end = nthWeekday(y, 11, 0, 1);
  if (m > 3 && m < 11) return true;
  if (m === 3) return d >= start;
  if (m === 11) return d < end;
  return false;
}

export function closeUtcMs(day) {
  const p = parseDay(day);
  if (!p) return null;
  return p.t + (usDst(p.y, p.m, p.d) ? 20 : 21) * 3600000;
}

export function yearFraction(asOfMs, expiryDay) {
  const close = closeUtcMs(expiryDay);
  if (close === null || typeof asOfMs !== "number" || !Number.isFinite(asOfMs)) return null;
  return (close - asOfMs) / (YEAR_SECONDS * 1000);
}

export function isMonthly(day) {
  const p = parseDay(day);
  if (!p) return false;
  const third = nthWeekday(p.y, p.m, 5, 3);
  if (p.d === third) return true;
  const tf = isoDay(p.y, p.m, third);
  return !isSession(tf) && p.d === third - 1;
}

export function etDayOf(ms) {
  const at = (h) => { const d = new Date(ms - h * 3600000); return isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); };
  const est = at(5);
  const p = parseDay(est);
  return usDst(p.y, p.m, p.d) ? at(4) : est;
}
