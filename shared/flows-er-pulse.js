import { rowsOf } from "./flows-rows.js";
import { vnum, isoDay } from "./flows-cross.js";
import { easternInstant } from "./flows-freshness.js";
import { roundTo } from "./flows-er-eps.js";

const HRMIN = /^(\d{1,2}):?(\d{2})(?::\d{2})?$/;

const count = (v) => {
  const n = vnum(v);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
};

const bodyOf = (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) && raw.data && typeof raw.data === "object" ? raw.data : raw);

const minutesOf = (v) => {
  const m = typeof v === "string" || typeof v === "number" ? HRMIN.exec(String(v).trim()) : null;
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
};

export function pulseRead(raw) {
  const d = bodyOf(raw);
  if (!d || typeof d !== "object") return { fail: "unshaped" };
  const intraday = Array.isArray(d.intraday) ? d.intraday.filter((b) => b && typeof b === "object") : [];
  let pick = null;
  if (intraday.length) {
    let best = -1;
    for (const b of intraday) {
      const m = minutesOf(b.hr_min);
      const key = (isoDay(typeof b.trd_dt === "string" ? b.trd_dt : "") || "") + String(m === null ? -1 : 10000 + m);
      if (m !== null && key > String(best)) { pick = b; best = key; }
    }
    if (!pick) pick = intraday[intraday.length - 1];
  } else if (d.latest && typeof d.latest === "object") pick = d.latest;
  if (!pick) return { fail: "empty" };
  const calls = count(pick.call_txn);
  const puts = count(pick.put_txn);
  if (calls === null || puts === null) return { fail: "unshaped" };
  const day = isoDay(typeof pick.trd_dt === "string" ? pick.trd_dt : "");
  const m = minutesOf(pick.hr_min);
  const ms = day && m !== null ? easternInstant(day, m) : null;
  return { ok: true, at: Number.isFinite(ms) ? new Date(ms).toISOString() : null, calls, puts, ratio: calls === 0 ? null : roundTo(puts / calls, 4) };
}

export function natrRead(raw) {
  const rows = rowsOf(raw, "data");
  let best = null;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const day = isoDay(typeof r.date === "string" ? r.date : "");
    if (!day) continue;
    if (!best || day > best.day) best = { day, r };
  }
  if (!best) return { fail: rows.length ? "unshaped" : "empty" };
  const values = best.r.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) return { fail: "unshaped" };
  const key = Object.keys(values).find((k) => /^NATR$/i.test(k));
  const v = key === undefined ? null : vnum(values[key]);
  if (v === null) return { fail: "unshaped" };
  if (v < 0 || v > 100) return { fail: "unit" };
  return { ok: true, natr: roundTo(v, 4), natrAt: best.day };
}
