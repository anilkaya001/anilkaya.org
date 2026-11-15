import { fixedHalfUp } from "./flows-display-round.js";
import { rowsOrNull } from "./flows-rows.js";
import { vnum, isoDay } from "./flows-cross.js";

export const EPS_ROWS = 12;
export const JOIN_DAYS = 3;
export const UNIT_TOL = 0.0005;

export function roundTo(v, dp) {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const neg = v < 0;
  const s = fixedHalfUp(Math.abs(v), dp);
  const n = Number(s);
  return neg && n !== 0 ? -n : n;
}

const HUNDREDTHS = /^([+-])?(\d{1,15})(?:\.(\d+))?$/;

export function hundredthsOf(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    value = String(value);
    if (/e/i.test(value)) return null;
  }
  if (typeof value !== "string") return null;
  const m = HUNDREDTHS.exec(value.trim());
  if (!m) return null;
  const frac = m[3] || "";
  let mag = BigInt(m[2]) * 10000n + BigInt((frac + "0000").slice(0, 4));
  if (frac.length > 4 && frac.charCodeAt(4) >= 53) mag += 1n;
  const n = Number(mag);
  if (!Number.isSafeInteger(n)) return null;
  return m[1] === "-" && n !== 0 ? -n : n;
}

export function surpriseOf(repC, estC) {
  if (!Number.isSafeInteger(repC) || !Number.isSafeInteger(estC) || estC === 0) return null;
  return roundTo((repC - estC) / Math.abs(estC), 6);
}

const whenOf = (v) => {
  if (typeof v !== "string") return null;
  const w = v.trim().toLowerCase();
  if (w === "premarket" || w === "bmo") return "pre";
  if (w === "postmarket" || w === "amc") return "post";
  return null;
};

const TYPED = Object.freeze(["report_type", "fiscal_date_ending", "report_date", "report_time", "reported_eps", "estimated_eps", "surprise_percentage"]);

const okType = (v) => v === null || v === undefined || typeof v === "string" || typeof v === "number";

export function reduceStockEarnings(raw) {
  const rows = rowsOrNull(raw, "data");
  if (rows === null) return { fail: "unshaped" };
  const list = [];
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { fail: "unshaped" };
    for (const k of TYPED) if (!okType(r[k])) return { fail: "type:" + k };
    if (typeof r.report_type !== "string" || r.report_type.trim().toLowerCase() !== "quarterly") continue;
    const fe = isoDay(typeof r.fiscal_date_ending === "string" ? r.fiscal_date_ending : "");
    if (!fe) continue;
    const repC = hundredthsOf(r.reported_eps);
    const estC = hundredthsOf(r.estimated_eps);
    const sx = surpriseOf(repC, estC);
    const feed = vnum(r.surprise_percentage);
    const unit = sx === null || feed === null ? null : Math.abs(feed / 100 - sx) <= UNIT_TOL ? 1 : 0;
    list.push([fe, isoDay(typeof r.report_date === "string" ? r.report_date : ""), whenOf(r.report_time), repC, estC, sx, unit]);
  }
  list.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  if (!list.length) return { fail: "empty" };
  return { ok: true, rows: list.slice(0, EPS_ROWS) };
}

const dayNumber = (d) => Date.parse(d + "T00:00:00Z") / 86400000;

function nearest(rows, d, dateOf) {
  const t = dayNumber(d);
  let best = null;
  let gap = Infinity;
  for (const r of rows) {
    const rd = dateOf(r);
    if (!rd) continue;
    const g = Math.abs(dayNumber(rd) - t);
    if (g > JOIN_DAYS) continue;
    if (g < gap || (g === gap && rd < dateOf(best))) { best = r; gap = g; }
  }
  return best;
}

export function joinSurprise(events, epsRows, finEps) {
  const out = [];
  const eps = Array.isArray(epsRows) ? epsRows : [];
  const fin = Array.isArray(finEps) ? finEps : [];
  for (const ev of Array.isArray(events) ? events : []) {
    if (!Array.isArray(ev)) continue;
    const d = isoDay(ev[0]);
    if (!d) continue;
    const em = vnum(ev[2]);
    const m1d = vnum(ev[3]);
    let sx = null;
    const a = nearest(eps, d, (r) => r[1]);
    if (a) sx = a[5];
    else {
      const b = nearest(fin, d, (r) => r && r.rd);
      if (b) sx = surpriseOf(hundredthsOf(b.rep === null || b.rep === undefined ? null : String(b.rep)), hundredthsOf(b.est === null || b.est === undefined ? null : String(b.est)));
    }
    out.push([d, em, m1d, sx]);
  }
  return out;
}

export const FIN_ROWS = 8;

const wholeUnits = (v) => {
  const n = vnum(v);
  return n !== null && Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
};

function statementRows(raw, fields) {
  const rows = rowsOrNull(raw, "data");
  if (rows === null) return { fail: "unshaped" };
  const by = new Map();
  let currency = null;
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { fail: "unshaped" };
    for (const k of ["report_type", "fiscal_date_ending", "reported_currency", ...fields]) if (!okType(r[k])) return { fail: "type:" + k };
    if (typeof r.report_type !== "string" || r.report_type.trim().toLowerCase() !== "quarterly") continue;
    const fe = isoDay(typeof r.fiscal_date_ending === "string" ? r.fiscal_date_ending : "");
    if (!fe) continue;
    if (currency === null && typeof r.reported_currency === "string" && /^[A-Za-z]{3}$/.test(r.reported_currency.trim())) currency = r.reported_currency.trim().toUpperCase();
    by.set(fe, fields.map((f) => wholeUnits(r[f])));
  }
  return { ok: true, by, currency };
}

export function reduceFin(income, balance, cashflows) {
  const inc = statementRows(income, ["total_revenue", "gross_profit", "operating_income", "net_income"]);
  const bal = statementRows(balance, ["cash_and_short_term_investments", "short_long_term_debt_total", "total_shareholder_equity"]);
  const cf = statementRows(cashflows, ["operating_cashflow", "capital_expenditures"]);
  const parts = [inc, bal, cf];
  const good = parts.filter((p) => p.ok);
  if (!good.length) return { fail: parts.map((p) => p.fail).find((f) => f && f.startsWith("type")) || "unshaped" };
  const days = new Set();
  for (const p of good) for (const d of p.by.keys()) days.add(d);
  if (!days.size) return { fail: "empty" };
  const q = [...days].sort().reverse().slice(0, FIN_ROWS).map((d) => [
    d,
    ...(inc.ok && inc.by.has(d) ? inc.by.get(d) : [null, null, null, null]),
    ...(cf.ok && cf.by.has(d) ? cf.by.get(d) : [null, null]),
    ...(bal.ok && bal.by.has(d) ? bal.by.get(d) : [null, null, null]),
  ]);
  return { ok: true, cur: (inc.ok && inc.currency) || (bal.ok && bal.currency) || (cf.ok && cf.currency) || null, q };
}
