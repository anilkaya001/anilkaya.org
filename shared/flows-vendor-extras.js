import { isoDay, addDays, vnum } from "./flows-cross.js";
import { isTradingDay } from "./flows-freshness.js";
import { unwrap } from "./flows-vendor-core.js";

export const EXTRAS_VERSION = 1;

export const DAY_S = 86400;

export const PARTS = Object.freeze({
  info: Object.freeze({ group: "dx", op: "info", rv: 1, refreshS: 5 * DAY_S, maxS: 10 * DAY_S }),
  profile: Object.freeze({ group: "dx", op: "profile", rv: 1, refreshS: 5 * DAY_S, maxS: 10 * DAY_S }),
  financials: Object.freeze({ group: "dx", op: "financials", rv: 1, refreshS: 5 * DAY_S, maxS: 10 * DAY_S }),
  breakdown: Object.freeze({ group: "dx", op: "fundamental-breakdown", rv: 1, refreshS: 14 * DAY_S, maxS: 28 * DAY_S }),
  estimates: Object.freeze({ group: "dx", op: "earnings-estimates", rv: 1, refreshS: 3 * DAY_S, maxS: 7 * DAY_S }),
  analysts: Object.freeze({ group: "dx", op: "analysts", rv: 1, refreshS: 2 * DAY_S, maxS: 4 * DAY_S }),
  ownership: Object.freeze({ group: "dx", op: "ownership", rv: 2, refreshS: 10 * DAY_S, maxS: 21 * DAY_S }),
  dividends: Object.freeze({ group: "vx", op: "dividends", rv: 1, refreshS: 3 * DAY_S, maxS: 7 * DAY_S }),
  splits: Object.freeze({ group: "vx", op: "splits", rv: 1, refreshS: 14 * DAY_S, maxS: 28 * DAY_S }),
  etf: Object.freeze({ group: "vx", op: "etf-exposure", rv: 1, refreshS: 7 * DAY_S, maxS: 14 * DAY_S }),
  ivp: Object.freeze({ group: "vx", op: "interpolated-iv", rv: 1, refreshS: 20 * 3600, maxS: 3 * DAY_S }),
});

export const SLOW_IDS = Object.freeze(Object.keys(PARTS).filter((id) => id !== "ivp"));

export const NIGHTLY_IDS = Object.freeze(["ivp"]);

export const GROUPS = Object.freeze({
  dx: Object.freeze(Object.keys(PARTS).filter((id) => PARTS[id].group === "dx")),
  vx: Object.freeze(Object.keys(PARTS).filter((id) => PARTS[id].group === "vx")),
});

export const SECTION_BYTES = Object.freeze({ dx: 24 * 1024, vx: 8 * 1024 });

export const SLOW_CAP = 2000;

export const SLOW_CAP_MAX = 6000;

export const EXTRAS_SWITCH = "FLOWS_EXTRAS";

export const EXTRAS_CAP_ENV = "FLOWS_EXTRAS_CAP";

export function extrasMode(env = {}) {
  const raw = String((env && env[EXTRAS_SWITCH]) ?? "").trim().toLowerCase();
  return raw === "off" ? "off" : "on";
}

export function extrasCap(env = {}, fallback = SLOW_CAP) {
  const raw = env ? env[EXTRAS_CAP_ENV] : undefined;
  if (raw === undefined || raw === null || String(raw).trim() === "") return Math.min(fallback, SLOW_CAP_MAX);
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return Math.min(fallback, SLOW_CAP_MAX);
  return Math.min(Math.floor(n), SLOW_CAP_MAX);
}

export const SHED_ORDER = Object.freeze(["financials", "breakdown", "ownership", "analysts", "estimates", "profile", "info", "etf", "splits", "dividends", "ivp"]);

export const FAIL_REASONS = Object.freeze(["unshaped", "missing", "type", "empty", "plan", "limited", "failed", "deadline", "cap", "size", "unread"]);

export const UNIT_STATUS = Object.freeze({
  "dividends.ex_date": Object.freeze({ state: "stated", unit: "date" }),
  "dividends.declaration_date": Object.freeze({ state: "stated", unit: "date" }),
  "dividends.record_date": Object.freeze({ state: "stated", unit: "date" }),
  "dividends.payment_date": Object.freeze({ state: "stated", unit: "date" }),
  "dividends.amount": Object.freeze({ state: "withheld", why: "unit" }),
  "splits.effective_date": Object.freeze({ state: "stated", unit: "date" }),
  "splits.split_factor": Object.freeze({ state: "withheld", why: "unit" }),
  "interpolated-iv.days": Object.freeze({ state: "stated", unit: "days" }),
  "interpolated-iv.percentile": Object.freeze({ state: "stated", unit: "pctile" }),
  "interpolated-iv.volatility": Object.freeze({ state: "withheld", why: "unit" }),
  "interpolated-iv.implied_move_perc": Object.freeze({ state: "withheld", why: "unit" }),
  "etf-exposure.etf": Object.freeze({ state: "stated", unit: "ticker" }),
  "etf-exposure.shares": Object.freeze({ state: "stated", unit: "shares" }),
  "etf-exposure.weight": Object.freeze({ state: "withheld", why: "unit" }),
  "etf-exposure.full_name": Object.freeze({ state: "withheld", why: "third-party text" }),
  "etf-exposure.last_price": Object.freeze({ state: "withheld", why: "ambiguous" }),
  "etf-exposure.prev_price": Object.freeze({ state: "withheld", why: "ambiguous" }),
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const fail = (reason) => ({ ok: false, reason });

const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function dayWithin(day, today, { backDays = 3660, aheadDays = 400 } = {}) {
  const d = isoDay(typeof day === "string" ? day : "");
  if (!d) return null;
  const t = isoDay(today);
  if (!t) return d;
  return d >= addDays(t, -backDays) && d <= addDays(t, aheadDays) ? d : null;
}

function rowsOfKey(raw, key) {
  const d = unwrap(raw);
  if (Array.isArray(d)) return d.filter(isObj);
  if (isObj(d) && Array.isArray(d[key])) return d[key].filter(isObj);
  return null;
}

function rowsOfList(raw) {
  const d = unwrap(raw);
  if (Array.isArray(d)) return d.filter(isObj);
  return isObj(raw) && Array.isArray(raw.data) ? raw.data.filter(isObj) : null;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export const CADENCE_BANDS = Object.freeze([["monthly", 25, 35], ["quarterly", 80, 100], ["semiannual", 170, 195], ["annual", 350, 380]]);

export const CADENCE_MIN_GAPS = 3;

export const CADENCE_LOOKBACK = 8;

export function cadenceOf(exDates) {
  const ds = [...new Set(arr(exDates).filter((d) => isoDay(d)))].sort();
  const recent = ds.slice(-CADENCE_LOOKBACK);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) gaps.push(daysBetween(recent[i - 1], recent[i]));
  if (gaps.length < CADENCE_MIN_GAPS) return { cadence: "insufficient", gapDays: gaps.length ? median(gaps) : null, gaps: gaps.length };
  const m = median(gaps);
  const band = CADENCE_BANDS.find(([, lo, hi]) => m >= lo && m <= hi);
  return { cadence: band ? band[0] : "irregular", gapDays: m, gaps: gaps.length };
}

export const EXPECTED_SLACK_DAYS = 10;

export function reduceDividends(raw, { today = null } = {}) {
  const rows = rowsOfKey(raw, "dividends");
  if (rows === null) return fail("unshaped");
  const t = isoDay(today);
  const events = [];
  const seen = new Set();
  let bad = 0;
  for (const r of rows) {
    const ex = dayWithin(r.ex_date, t);
    if (!ex) { bad++; continue; }
    if (seen.has(ex)) continue;
    seen.add(ex);
    const amount = vnum(r.amount);
    events.push({
      ex,
      decl: dayWithin(r.declaration_date, t),
      rec: dayWithin(r.record_date, t),
      pay: dayWithin(r.payment_date, t),
      raw: amount,
    });
  }
  if (rows.length && !events.length) return fail("type:ex_date");
  events.sort((a, b) => (a.ex < b.ex ? -1 : a.ex > b.ex ? 1 : 0));
  const past = t ? events.filter((e) => e.ex <= t) : events;
  const declared = t ? events.filter((e) => e.ex > t) : [];
  const exDates = past.map((e) => e.ex);
  const cad = cadenceOf(exDates);
  const lastEx = exDates.length ? exDates[exDates.length - 1] : null;
  let expected = null;
  if (!declared.length && lastEx && cad.gapDays !== null && ["monthly", "quarterly", "semiannual", "annual"].includes(cad.cadence)) {
    const centre = addDays(lastEx, Math.round(cad.gapDays));
    expected = { from: addDays(centre, -EXPECTED_SLACK_DAYS), to: addDays(centre, EXPECTED_SLACK_DAYS) };
  }
  const x = {
    ok: true,
    rv: PARTS.dividends.rv,
    none: events.length === 0,
    n: events.length,
    lastEx,
    nextEx: declared.length ? declared[0].ex : null,
    declared: declared.slice(0, 4).map((e) => ({ ex: e.ex, decl: e.decl, rec: e.rec, pay: e.pay })),
    history: past.slice(-8).reverse().map((e) => ({ ex: e.ex, decl: e.decl, rec: e.rec, pay: e.pay })),
    cadence: cad.cadence,
    gapDays: cad.gapDays,
    expected,
    amountUnit: "withheld",
    rawAmounts: past.slice(-4).reverse().map((e) => e.raw),
  };
  if (bad) x.bad = bad;
  return x;
}

export function reduceSplits(raw, { today = null } = {}) {
  const rows = rowsOfKey(raw, "splits");
  if (rows === null) return fail("unshaped");
  const t = isoDay(today);
  const events = [];
  const seen = new Set();
  let bad = 0;
  for (const r of rows) {
    const d = dayWithin(r.effective_date, t, { backDays: 20000 });
    if (!d) { bad++; continue; }
    if (seen.has(d)) continue;
    seen.add(d);
    events.push({ d, raw: vnum(r.split_factor) });
  }
  if (rows.length && !events.length) return fail("type:effective_date");
  events.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
  const upcoming = t ? events.filter((e) => e.d > t).map((e) => e.d).reverse() : [];
  const past = t ? events.filter((e) => e.d <= t) : events;
  const x = {
    ok: true,
    rv: PARTS.splits.rv,
    none: events.length === 0,
    n: events.length,
    last: past.length ? past[0].d : null,
    upcoming: upcoming.slice(0, 3),
    events: events.slice(0, 6).map((e) => ({ d: e.d, raw: e.raw })),
    factorUnit: "withheld",
  };
  if (bad) x.bad = bad;
  return x;
}

export const IV_TENOR_DAYS = Object.freeze({ min: 1, max: 1100 });

export const P30_WINDOW_DAYS = 10;

export function reduceIvPercentile(raw) {
  const rows = rowsOfList(raw);
  if (rows === null) return fail("unshaped");
  if (!rows.length) return fail("empty");
  const dated = rows.map((r) => ({ d: isoDay(typeof r.date === "string" ? r.date : ""), days: vnum(r.days), p: vnum(r.percentile) }));
  const days = dated.map((r) => r.d).filter(Boolean).sort();
  if (!days.length) return fail("type:date");
  const latest = days[days.length - 1];
  let bad = 0;
  const tenors = [];
  const seen = new Set();
  for (const r of dated) {
    if (r.d !== latest) continue;
    const okDays = r.days !== null && Number.isInteger(r.days) && r.days >= IV_TENOR_DAYS.min && r.days <= IV_TENOR_DAYS.max;
    const okPct = r.p !== null && r.p >= 0 && r.p <= 100;
    if (!okDays || !okPct || seen.has(r.days)) { bad++; continue; }
    seen.add(r.days);
    tenors.push([r.days, Math.round(r.p * 10) / 10]);
  }
  if (!tenors.length) return fail("type:percentile");
  tenors.sort((a, b) => a[0] - b[0]);
  let near = null;
  for (const t of tenors) if (Math.abs(t[0] - 30) <= P30_WINDOW_DAYS && (near === null || Math.abs(t[0] - 30) < Math.abs(near[0] - 30))) near = t;
  const x = { ok: true, rv: PARTS.ivp.rv, date: latest, tenors: tenors.slice(0, 16), p30: near ? near[1] : null, d30: near ? near[0] : null };
  if (bad) x.bad = bad;
  return x;
}

export const ETF_TOP = 10;

export function reduceEtfExposure(raw) {
  const rows = rowsOfList(raw);
  if (rows === null) return fail("unshaped");
  if (!rows.length) return fail("empty");
  let dropped = 0;
  const list = [];
  for (const r of rows) {
    const t = typeof r.etf === "string" ? r.etf.trim().toUpperCase() : "";
    if (!TICKER.test(t)) { dropped++; continue; }
    const w = vnum(r.weight);
    const sh = vnum(r.shares);
    list.push({ t, w: w === null ? -Infinity : w, sh: sh !== null && sh >= 0 ? Math.round(sh) : null });
  }
  if (!list.length) return fail("type:etf");
  list.sort((a, b) => (b.w - a.w) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const known = list.filter((e) => e.sh !== null);
  const x = {
    ok: true,
    rv: PARTS.etf.rv,
    n: list.length,
    top: list.slice(0, ETF_TOP).map((e) => [e.t, e.sh]),
    sharesSum: known.length ? known.reduce((s, e) => s + e.sh, 0) : null,
    sharesRows: known.length,
    weightUnit: "withheld",
  };
  if (dropped) x.dropped = dropped;
  return x;
}

export const REDUCERS_X = Object.freeze({
  dividends: reduceDividends, splits: reduceSplits, ivp: reduceIvPercentile, etf: reduceEtfExposure,
});

const priorTradingDay = (day) => {
  let d = addDays(day, -1);
  for (let i = 0; i < 12 && d && !isTradingDay(d); i++) d = addDays(d, -1);
  return d;
};

export const EXERCISE_WORDS = Object.freeze({
  declared: "Ex-dividend before expiry: early assignment is possible if the call is in the money.",
  expected: "A dividend may go ex-dividend before this expiry; none is declared yet (inferred from the payer's usual schedule).",
  none: "No ex-dividend date is declared before this expiry; the vendor's list can be incomplete.",
  unknown: "Ex-dividend dates are not held for this name.",
});

export function exercisePressure({ exDates = null, expected = null, expiry = null, today = null } = {}) {
  const t = isoDay(today);
  const e = isoDay(expiry);
  if (!t || !e || !Array.isArray(exDates)) return { state: "unknown", exDate: null, lastExerciseDay: null, note: EXERCISE_WORDS.unknown };
  const inside = exDates.map((d) => isoDay(d)).filter((d) => d && d > t && d <= e).sort();
  if (inside.length) {
    const ex = inside[0];
    return { state: "declared", exDate: ex, lastExerciseDay: priorTradingDay(ex), note: EXERCISE_WORDS.declared };
  }
  if (expected && isoDay(expected.from) && isoDay(expected.to) && expected.to > t && expected.from <= e) {
    return { state: "expected", exDate: null, lastExerciseDay: null, window: { from: expected.from, to: expected.to }, note: EXERCISE_WORDS.expected };
  }
  return { state: "none-known", exDate: null, lastExerciseDay: null, note: EXERCISE_WORDS.none };
}

export const NOTICE_DAYS = 10;

export const FRESH_NOTICE_DAYS = 3;

export const DEFAULT_GAP_DAYS = 91;

export const SPECIAL_GAP_SHARE = 0.6;

export function dividendOutlook({ x = null, expiry = null, today = null, ageDays = null } = {}) {
  const t = isoDay(today);
  const e = isoDay(expiry);
  const none = { state: "unknown", exDate: null, n: 0, g: DEFAULT_GAP_DAYS, irregular: false, fresh: false, ageDays: null, lastExerciseDay: null };
  if (!t || !e || !isObj(x) || x.ok !== true || !isNum(ageDays) || ageDays < 0) return none;
  const fresh = ageDays <= FRESH_NOTICE_DAYS;
  const regular = ["monthly", "quarterly", "semiannual", "annual"].includes(x.cadence) && isNum(x.gapDays) && x.gapDays > 0;
  const g = regular ? x.gapDays : DEFAULT_GAP_DAYS;
  const past = arr(x.history).map((h) => (isObj(h) ? isoDay(h.ex) : null)).filter(Boolean).sort();
  const lastEx = past.length ? past[past.length - 1] : isoDay(x.lastEx);
  const declared = arr(x.declared).map((h) => (isObj(h) ? isoDay(h.ex) : null)).filter((d) => d && d > t && d <= e).sort();
  const base = { g, fresh, ageDays };
  if (declared.length) {
    const first = declared[0];
    const gap = lastEx && lastEx < first ? daysBetween(lastEx, first) : null;
    return { ...base, state: "declared", exDate: first, n: declared.length, irregular: gap !== null && gap < SPECIAL_GAP_SHARE * g, lastExerciseDay: priorTradingDay(first) };
  }
  if (regular && lastEx) {
    const projected = addDays(lastEx, Math.round(g));
    const notBefore = addDays(t, Math.max(0, NOTICE_DAYS - Math.floor(ageDays)));
    if (projected && projected > notBefore && projected <= e && projected > t) {
      return { ...base, state: "expected", exDate: projected, n: 1, irregular: false, lastExerciseDay: priorTradingDay(projected) };
    }
  }
  return { ...base, state: "none-known", exDate: null, n: 0, irregular: false, lastExerciseDay: null };
}

export function exDatesOf(x) {
  if (!isObj(x) || x.ok !== true) return null;
  const out = [];
  for (const h of arr(x.history)) if (isObj(h) && isoDay(h.ex)) out.push(h.ex);
  for (const h of arr(x.declared)) if (isObj(h) && isoDay(h.ex)) out.push(h.ex);
  return [...new Set(out)].sort();
}

export function exSplit(x, today) {
  const t = isoDay(today);
  const all = exDatesOf(x);
  if (!t || all === null) return { next: null, last: null, future: [], known: all !== null };
  const future = all.filter((d) => d > t);
  const past = all.filter((d) => d <= t);
  return { next: future[0] || null, last: past.length ? past[past.length - 1] : null, future, known: true };
}

export function partState(part, id, now) {
  const spec = PARTS[id];
  if (!spec || !isObj(part) || !isNum(part.at)) return "missing";
  if (part.rv !== spec.rv) return "outdated";
  const age = (now - part.at) / 1000;
  if (!(age >= -DAY_S)) return "outdated";
  if (age <= spec.refreshS) return "fresh";
  if (age <= spec.maxS) return "stale";
  return "expired";
}

export const usable = (part, id, now) => {
  const s = partState(part, id, now);
  return s === "fresh" || s === "stale";
};

export function fnv32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function urgency(part, id, now) {
  const s = partState(part, id, now);
  if (s === "fresh") return -1;
  if (s === "stale" && part.shed === 1) return -1;
  if (s !== "stale") return Infinity;
  return ((now - part.at) / 1000) / PARTS[id].maxS;
}

export function planSlow({ names, priors, now, cap = SLOW_CAP, ids = SLOW_IDS }) {
  const due = [];
  let fresh = 0;
  for (const t of names) {
    const sections = priors && priors.get ? priors.get(t) : null;
    for (const id of ids) {
      const group = PARTS[id].group;
      const part = sections && isObj(sections[group]) && isObj(sections[group].parts) ? sections[group].parts[id] : null;
      const u = urgency(part, id, now);
      if (u < 0) { fresh++; continue; }
      due.push({ t, id, u, h: fnv32(t + "|" + id) });
    }
  }
  const rank = (u) => (u === Infinity ? 1e9 : u);
  due.sort((a, b) => (rank(b.u) - rank(a.u)) || (a.h - b.h) || (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id < b.id ? -1 : 1));
  const picked = due.slice(0, Math.max(0, cap));
  return { picked, deferred: due.length - picked.length, due: due.length, fresh };
}

const stubOf = (part) => ({ at: part.at, rv: part.rv, shed: 1 });

export function mergeParts({ prior = null, got = {}, miss = {}, group, now }) {
  const parts = {};
  const gone = {};
  const priorParts = isObj(prior) && isObj(prior.parts) ? prior.parts : {};
  for (const id of GROUPS[group]) {
    const fresh = got[id];
    if (isObj(fresh) && isNum(fresh.at) && fresh.rv === PARTS[id].rv && (isObj(fresh.x) || fresh.shed === 1)) { parts[id] = fresh; continue; }
    const old = priorParts[id];
    if (isObj(old) && usable(old, id, now) && (isObj(old.x) || old.shed === 1)) { parts[id] = old; if (miss[id]) gone[id] = miss[id]; continue; }
    if (miss[id]) gone[id] = miss[id];
  }
  return { parts, miss: gone };
}

export function sectionOf({ parts, miss, group }) {
  const ids = GROUPS[group];
  const have = ids.filter((id) => parts[id]);
  const shown = have.filter((id) => !parts[id].shed && parts[id].x && parts[id].x.ok === true);
  const status = !have.length ? "unavailable" : shown.length === ids.length ? "ok" : "partial";
  return { v: EXTRAS_VERSION, status, parts, ...(Object.keys(miss || {}).length ? { miss } : {}) };
}

export function fitSection(section, group, budget = SECTION_BYTES[group]) {
  const out = { ...section, parts: { ...section.parts } };
  const size = () => JSON.stringify(out).length;
  const shed = [];
  for (const id of SHED_ORDER) {
    if (size() <= budget) break;
    const p = out.parts[id];
    if (!p || p.shed || PARTS[id].group !== group) continue;
    out.parts[id] = stubOf(p);
    shed.push(id);
  }
  if (shed.length) out.shed = shed;
  out.bytes = size();
  return out;
}

export function shedNextPart(payload) {
  for (const id of SHED_ORDER) {
    const group = PARTS[id].group;
    const section = payload && isObj(payload[group]) && isObj(payload[group].parts) ? payload[group] : null;
    const part = section ? section.parts[id] : null;
    if (!isObj(part) || part.shed === 1) continue;
    section.parts = { ...section.parts, [id]: stubOf(part) };
    section.shed = [...new Set([...(Array.isArray(section.shed) ? section.shed : []), id])];
    section.status = "partial";
    delete section.bytes;
    return id;
  }
  return null;
}

export function hasLiveParts(section) {
  return isObj(section) && isObj(section.parts) && Object.values(section.parts).some((p) => isObj(p) && p.shed !== 1);
}

export function stubSection(section, group) {
  if (!isObj(section) || !isObj(section.parts)) return section;
  const parts = {};
  const shed = [];
  for (const [id, p] of Object.entries(section.parts)) {
    if (!PARTS[id] || PARTS[id].group !== group || !isObj(p)) continue;
    parts[id] = p.shed === 1 ? p : stubOf(p);
    if (p.shed !== 1) shed.push(id);
  }
  const out = { ...section, parts, status: "partial" };
  delete out.bytes;
  if (shed.length) out.shed = [...new Set([...(Array.isArray(section.shed) ? section.shed : []), ...shed])];
  return out;
}

export function usableX(section, id, now) {
  const part = isObj(section) && isObj(section.parts) ? section.parts[id] : null;
  if (!part || part.shed === 1) return null;
  const state = partState(part, id, now);
  if (state !== "fresh" && state !== "stale") return null;
  if (!isObj(part.x)) return null;
  return { x: part.x, at: part.at, state };
}

export function outcomeTally(rows) {
  const out = {};
  for (const r of rows) {
    const e = out[r.id] || (out[r.id] = { attempted: 0, ok: 0, empty: 0, plan: 0, unshaped: 0, missing: 0, type: 0, failed: 0, limited: 0, skipped: 0 });
    if (r.skipped) { e.skipped++; continue; }
    e.attempted++;
    const why = String(r.why || "ok");
    if (why === "ok") e.ok++;
    else if (why === "empty") e.empty++;
    else if (why === "plan") e.plan++;
    else if (why === "limited") e.limited++;
    else if (why === "failed") e.failed++;
    else if (why === "unshaped") e.unshaped++;
    else if (why.startsWith("missing")) e.missing++;
    else if (why.startsWith("type")) e.type++;
    else e.failed++;
  }
  return out;
}

export const HEALTH_LINES = Object.freeze({ warn: 0.05, fail: 0.2, minAttempted: 50, matureNights: 7 });

export function shapeHealth(tally, lines = HEALTH_LINES) {
  const out = {};
  for (const [id, e] of Object.entries(tally || {})) {
    const bad = e.unshaped + e.missing + e.type;
    const rate = e.attempted ? bad / e.attempted : 0;
    const state = e.attempted < lines.minAttempted ? "report" : rate > lines.fail ? "fail" : rate > lines.warn ? "warn" : "ok";
    out[id] = { attempted: e.attempted, bad, rate: Math.round(rate * 1000) / 1000, state };
  }
  return out;
}

export function extrasStanding(health, prior, lines = HEALTH_LINES) {
  const priorClean = isObj(prior) && isObj(prior.clean) ? prior.clean : {};
  const priorHealth = isObj(prior) && isObj(prior.health) ? prior.health : {};
  const clean = {};
  const eligible = [];
  for (const [id, h] of Object.entries(health || {})) {
    const before = Number.isInteger(priorClean[id]) && priorClean[id] > 0 ? priorClean[id] : 0;
    const wasFailing = isObj(priorHealth[id]) && priorHealth[id].state === "fail";
    if (h.state === "ok") clean[id] = Math.min(before + 1, 99);
    else if (h.state === "report") clean[id] = Math.min(before, 99);
    else clean[id] = 0;
    if (h.state === "fail" && before >= lines.matureNights && !wasFailing) eligible.push(id);
  }
  return { clean, eligible };
}
