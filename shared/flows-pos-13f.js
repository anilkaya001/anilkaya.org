import { centsOf } from "./flows-sides.js";
import { roundTable } from "./flows-round.js";

export const SECTOR_ORDER = Object.freeze([
  "Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
  "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities",
]);

export const TRACK = Object.freeze({ hedge: 40, other: 20, max: 60, keepDays: 90, readMax: 40, readFresh: 20, topN: 5, filingRows: 40 });

const DAY = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isInt = Number.isSafeInteger;

export const isDay = (v) => typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) && new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;

export function daysBetween(from, to) {
  if (!isDay(from) || !isDay(to)) return null;
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);
}

export function addDays(day, n) {
  if (!isDay(day)) return null;
  return new Date(Date.parse(day + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}

export function dollarsOf(value) {
  const c = centsOf(value);
  if (!c) return null;
  const whole = (c.cents + 50) / 100;
  const out = Math.floor(whole);
  return isInt(out) ? out : null;
}

export function quarterBefore(day) {
  if (!isDay(day)) return null;
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const pm = m - 3;
  const py = pm < 1 ? y - 1 : y;
  const mm = pm < 1 ? pm + 12 : pm;
  const last = new Date(Date.UTC(py, mm, 0)).getUTCDate();
  return `${py}-${String(mm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

const byTotal = (a, b) => (b.total - a.total) || (a.cik < b.cik ? -1 : a.cik > b.cik ? 1 : 0);

function candidate(row) {
  if (!row || typeof row !== "object") return null;
  const cik = typeof row.cik === "string" && /^\d{1,12}$/.test(row.cik) ? row.cik : null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 120) : null;
  if (!cik || !name) return null;
  const total = dollarsOf(row.total_value);
  return {
    cik, name, hf: row.is_hedge_fund === true,
    total: total === null ? 0 : total,
    filed: isDay(row.filing_date) ? row.filing_date : null,
    report: isDay(row.date) ? row.date : null,
  };
}

export function trackFilers(list, prior, now) {
  const seen = new Set();
  const rows = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = candidate(raw);
    if (c && !seen.has(c.cik)) { seen.add(c.cik); rows.push(c); }
  }
  const hedge = rows.filter((r) => r.hf).sort(byTotal).slice(0, TRACK.hedge);
  const rest = rows.filter((r) => !r.hf).sort(byTotal).slice(0, TRACK.other);
  const out = [...hedge, ...rest];
  const have = new Set(out.map((r) => r.cik));
  const ledger = prior && prior.filerLedger && typeof prior.filerLedger === "object" ? prior.filerLedger : {};
  const kept = [];
  for (const [cik, e] of Object.entries(ledger)) {
    if (have.has(cik) || !e || typeof e !== "object") continue;
    const age = daysBetween(e.f, now);
    if (age === null || age > TRACK.keepDays) continue;
    kept.push({ cik, name: e.n, hf: e.h === true, total: isInt(e.t) ? e.t : 0, filed: e.f, report: e.r || null, kept: true });
  }
  kept.sort(byTotal);
  return [...out, ...kept].slice(0, TRACK.max);
}

export function planFilers(tracked, ledger, now) {
  const stored = ledger && typeof ledger === "object" ? ledger : {};
  const picked = [];
  for (const f of Array.isArray(tracked) ? tracked : []) {
    if (f.kept) continue;
    const e = stored[f.cik];
    if (!e || !Array.isArray(e.rows) || !e.rows.length) { picked.push({ g: 0, rd: "", f }); continue; }
    if (f.filed && e.f && f.filed > e.f) { picked.push({ g: 1, rd: e.rd || "", f }); continue; }
    const age = daysBetween(e.rd, now);
    if (age !== null && age < TRACK.readFresh) continue;
    picked.push({ g: 2, rd: e.rd || "", f });
  }
  picked.sort((a, b) => (a.g - b.g) || (a.rd < b.rd ? -1 : a.rd > b.rd ? 1 : 0) || byTotal(a.f, b.f));
  return picked.slice(0, TRACK.readMax).map((r) => r.f);
}

export function sectorEntry(rows, now) {
  const list = Array.isArray(rows) ? rows : [];
  const dates = [...new Set(list.map((r) => r && r.report_date).filter(isDay))].sort().reverse().slice(0, 2);
  if (!dates.length) return { qs: [], rows: [], bad: 0, rd: now };
  const out = [];
  let bad = 0;
  for (const r of list) {
    const qi = r ? dates.indexOf(r.report_date) : -1;
    const si = r ? SECTOR_ORDER.indexOf(r.sector) : -1;
    if (qi < 0) continue;
    const ints = [r.value, r.positions, r.positions_increased, r.positions_decreased, r.positions_closed];
    if (si < 0 || !ints.every((x) => isInt(x) && x >= 0)) { bad++; continue; }
    out.push([si, qi, ...ints]);
  }
  return { qs: dates, rows: out, bad, rd: now };
}

function slice(entry, qi) {
  const cells = new Array(SECTOR_ORDER.length).fill(null);
  if (!entry || !Array.isArray(entry.rows)) return cells;
  for (const r of entry.rows) {
    if (r[1] !== qi) continue;
    const c = cells[r[0]] || { value: 0, pos: 0, inc: 0, dec: 0, closed: 0 };
    c.value += r[2]; c.pos += r[3]; c.inc += r[4]; c.dec += r[5]; c.closed += r[6];
    cells[r[0]] = c;
  }
  return cells;
}

function modal(dates) {
  const n = new Map();
  for (const d of dates) n.set(d, (n.get(d) || 0) + 1);
  let best = null;
  for (const [d, c] of n) if (best === null || c > best[1] || (c === best[1] && d > best[0])) best = [d, c];
  return best ? best[0] : null;
}

function largestRemainder(values, total) {
  const floors = values.map((v) => Math.floor(v));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => (b[0] - a[0]) || (a[1] - b[1]));
  for (let k = 0; left > 0 && order.length; k++, left--) floors[order[k % order.length][1]]++;
  return floors;
}

export function rotation(tracked, ledger) {
  const stored = ledger && typeof ledger === "object" ? ledger : {};
  const latest = new Map();
  let unread = 0;
  for (const f of tracked) {
    const e = stored[f.cik];
    if (!e || !Array.isArray(e.rows) || !e.rows.length || !Array.isArray(e.qs) || !e.qs.length) { unread++; continue; }
    latest.set(f.cik, e.qs[0]);
  }
  const Q = modal([...latest.values()]);
  if (Q === null) {
    return { status: "pending", why: "unread", quarter: null, filers: { tracked: tracked.length, compared: 0, notFiled: 0, unread }, sectors: [] };
  }
  const P = quarterBefore(Q);
  let notFiled = 0;
  const used = [];
  for (const f of tracked) {
    if (!latest.has(f.cik)) continue;
    const e = stored[f.cik];
    if (e.qs[0] !== Q) { notFiled++; continue; }
    if (e.qs[1] !== P) { unread++; continue; }
    const now = slice(e, 0);
    const before = slice(e, 1);
    const vNow = now.reduce((a, c) => a + (c ? c.value : 0), 0);
    const vBefore = before.reduce((a, c) => a + (c ? c.value : 0), 0);
    if (vNow <= 0 || vBefore <= 0) { unread++; continue; }
    used.push({ now, before, vNow, vBefore });
  }
  const filers = { tracked: tracked.length, compared: used.length, notFiled, unread };
  const quarter = { now: Q, prior: P };
  if (!used.length) return { status: "quiet", why: "unread", quarter, filers, sectors: [] };
  const S = SECTOR_ORDER.length;
  const meanNow = new Array(S).fill(0);
  const meanBefore = new Array(S).fill(0);
  const agg = SECTOR_ORDER.map(() => ({ inc: 0, dec: 0, closed: 0, pos: 0, valueNow: 0, valuePrior: 0, n: 0 }));
  for (const u of used) {
    for (let s = 0; s < S; s++) {
      const a = u.now[s];
      const b = u.before[s];
      meanNow[s] += (100 * (a ? a.value : 0)) / u.vNow;
      meanBefore[s] += (100 * (b ? b.value : 0)) / u.vBefore;
      if (a) { agg[s].inc += a.inc; agg[s].dec += a.dec; agg[s].closed += a.closed; agg[s].pos += a.pos; agg[s].valueNow += a.value; }
      if (b) agg[s].valuePrior += b.value;
      if ((a && a.value > 0) || (b && b.value > 0)) agg[s].n++;
    }
  }
  const MICRO = 1e6;
  const toInts = (arr) => largestRemainder(arr.map((v) => (v / used.length) * MICRO), 100 * MICRO);
  const a = toInts(meanNow);
  const b = toInts(meanBefore);
  const table = roundTable(a.map((x, i) => [x, b[i]]), MICRO / 100);
  const sectors = SECTOR_ORDER.map((s, i) => {
    const wNow = table.cells[i][0] / 100;
    const wPrior = table.cells[i][1] / 100;
    const g = agg[i];
    return {
      s, wNow, wPrior, dW: Math.round((table.cells[i][0] - table.cells[i][1])) / 100,
      inc: g.inc, dec: g.dec, closed: g.closed, pos: g.pos,
      breadth: g.pos > 0 ? Math.round(((g.inc - g.dec) / g.pos) * 1e4) / 1e4 : null,
      valueNow: g.valueNow, valuePrior: g.valuePrior, n: g.n,
    };
  });
  return { status: "ok", quarter, filers, sectors };
}

export function filingChanges(rows, sectorOf, n = TRACK.topN) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.ticker !== "string" || !r.ticker || !isInt(r.units_change) || r.units_change === 0) continue;
    const px = r.price_on_report === undefined || r.price_on_report === null ? null : centsOf(r.price_on_report);
    const dv = px && px.cents > 0 ? Math.round(Math.abs(r.units_change) * (px.cents / 100)) * Math.sign(r.units_change) : null;
    out.push({ t: r.ticker, sec: (sectorOf && sectorOf[r.ticker]) || null, du: r.units_change, dv });
  }
  out.sort((x, y) => {
    const ax = x.dv === null ? -1 : Math.abs(x.dv);
    const ay = y.dv === null ? -1 : Math.abs(y.dv);
    return (ay - ax) || (Math.abs(y.du) - Math.abs(x.du)) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0);
  });
  return out.slice(0, n);
}

export function filingRows(list, latest, ledger, cap = TRACK.filingRows) {
  const by = new Map();
  for (const raw of [...(Array.isArray(list) ? list : []), ...(Array.isArray(latest) ? latest : [])]) {
    const c = candidate(raw);
    if (!c || !c.filed) continue;
    const prev = by.get(c.cik);
    if (!prev || c.filed > prev.filed || (c.filed === prev.filed && c.report && !prev.report)) by.set(c.cik, { ...prev, ...c, report: c.report || (prev && prev.report) || null });
  }
  const stored = ledger && typeof ledger === "object" ? ledger : {};
  const rows = [...by.values()].sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0) || (a.cik < b.cik ? -1 : 1)).slice(0, cap);
  return rows.map((r) => {
    const e = stored[r.cik];
    return {
      cik: r.cik, filer: r.name, hf: r.hf, filed: r.filed, report: r.report,
      lagD: r.report ? daysBetween(r.report, r.filed) : null,
      top: e && Array.isArray(e.top) ? e.top : null,
    };
  });
}
