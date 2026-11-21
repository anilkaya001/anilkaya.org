import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { addSessions } from "../../shared/flows-calendar.js";
import { addDays } from "../../shared/flows-cross.js";
import { natrRead, pulseRead } from "../../shared/flows-er-pulse.js";
import { GRAMMAR_TARGETS } from "../../shared/flows-er-feed.js";
import { HALT_DAYS } from "../../shared/flows-er-payload.js";

export const WEEKLY_S = 7 * 86400;
export const REFUSED_RETRY_S = 7 * 86400;
export const NATR_NAMES = 60;
export const PULSE_NAMES = 40;
export const DELISTED_MAX = 5;
export const SCHEDULE_AHEAD_DAYS = 3;
export const ALERT_TYPES = Object.freeze(["trading_state", "earnings", "economic_release", "fda"]);
export const SECTOR_ENUM = Object.freeze(["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy", "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"]);

export const ROUTES = Object.freeze({
  "calendar-ipo": () => pathFor("calendar-ipo"),
  "listings-active": () => pathFor("listings-active"),
  "listings-delisted": () => pathFor("listings-delisted"),
  "potus-schedule": () => pathFor("potus-schedule"),
  "potus-posts": () => pathFor("potus-posts"),
  "alerts-fired": () => pathFor("alerts-fired"),
  "alerts-config": () => pathFor("alerts-config"),
  "alerts-filters": () => pathFor("alerts-filters"),
  "alerts-grammar": () => pathFor("alerts-grammar"),
  "tech-natr": (p) => pathFor("tech-natr", p),
  "stock-options-pulse": (p) => pathFor("stock-options-pulse", p),
  "sector-tickers": (p) => pathFor("sector-tickers", p),
});

export function failureOf(res) {
  if (res.status === 429) return "limited";
  if ([401, 402, 403, 404, 422].includes(res.status)) return "plan";
  return "failed";
}

const ageS = (iso, now) => {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? (now - ms) / 1000 : Infinity;
};

export function sectorList(raw) {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.data) ? raw.data : null;
  if (rows === null) return null;
  const out = [];
  for (const r of rows) {
    const t = typeof r === "string" ? r : r && typeof r === "object" && typeof r.ticker === "string" ? r.ticker : null;
    if (t === null) return null;
    const u = t.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(u)) out.push(u);
  }
  return [...new Set(out)].sort();
}

export function sectorsPayload(lists, { readAt, keep = null, fixture = false, budget = 96 * 1024 }) {
  const seen = new Set();
  const sectors = {};
  const refused = [];
  const dropped = {};
  let dup = 0;
  for (const name of SECTOR_ENUM) {
    const l = lists[name];
    if (!l) { refused.push(name); continue; }
    const fresh = [];
    for (const t of l) {
      if (seen.has(t)) { dup++; continue; }
      seen.add(t);
      fresh.push(t);
    }
    sectors[name] = fresh;
  }
  const textOf = () => Object.fromEntries(Object.entries(sectors).map(([k, v]) => [k, v.join(",")]));
  const size = () => JSON.stringify({ v: 1, readAt, sectors: textOf(), n: 0, refused, dup, dropped }).length;
  if (size() > budget && keep) {
    for (const k of Object.keys(sectors)) {
      const before = sectors[k].length;
      sectors[k] = sectors[k].filter((t) => keep.has(t));
      if (before !== sectors[k].length) dropped[k] = before - sectors[k].length;
    }
  }
  return {
    v: 1, readAt, ...(fixture ? { fixture: true } : {}), sectors: textOf(),
    n: Object.values(sectors).reduce((a, v) => a + v.length, 0), refused, dup, ...(Object.keys(dropped).length ? { dropped } : {}),
  };
}

export function deliveryPlan({ sessionDate, prior, priorSectors, now }) {
  const issues = prior && prior.issues && typeof prior.issues === "object" ? prior.issues : null;
  const feed = prior && prior.feed && typeof prior.feed === "object" ? prior.feed : null;
  const activeDue = !issues || ageS(issues.activeReadAt, now) >= WEEKLY_S;
  const filtersDue = !feed || ageS(feed.readAt, now) >= WEEKLY_S;
  const sectorsDue = !priorSectors || ageS(priorSectors.readAt, now) >= WEEKLY_S;
  const have = new Set(issues && issues.delisted && Array.isArray(issues.delisted.days) ? issues.delisted.days : []);
  const dates = [];
  for (let k = 0; k < DELISTED_MAX; k++) {
    const d = addSessions(sessionDate, -k);
    if (!d || have.has(d)) continue;
    if (k > 0 && have.size && d <= [...have].sort().pop()) continue;
    dates.push(d);
  }
  const schedule = [];
  for (let k = 0; k <= SCHEDULE_AHEAD_DAYS; k++) schedule.push(addDays(sessionDate, k));
  return { activeDue, filtersDue, sectorsDue, delisted: dates, schedule };
}

export function refusedNow(prior, now) {
  const refused = prior && prior.basis && prior.basis.refused && typeof prior.basis.refused === "object" ? prior.basis.refused : {};
  const out = {};
  for (const [id, r] of Object.entries(refused)) if (r && Number.isFinite(r.since) && (now - r.since) / 1000 < REFUSED_RETRY_S) out[id] = r;
  return out;
}

export async function runEventRiskReads({
  uw, sessionDate, now = Date.now(), prior = null, priorSectors = null, windowNames = [], pulseNames = [], deadline = null, pool = null, width = 1,
  log = () => {},
} = {}) {
  const plan = deliveryPlan({ sessionDate, prior, priorSectors, now });
  const refused = refusedNow(prior, now);
  const failed = {};
  const refusedOut = { ...refused };
  let calls = 0;
  const reads = {};
  const bump = (id) => { failed[id] = (failed[id] || 0) + 1; };

  const one = async (id, params = {}, pathParams = {}) => {
    if (refused[id]) return { status: "plan", skipped: true };
    if (pastDeadline(deadline)) return { status: "failed", why: "deadline" };
    calls++;
    const res = await read(uw, ROUTES[id](pathParams), params, { envelope: true });
    if (res.ok) return { status: "ok", body: res.body };
    const why = failureOf(res);
    if (why === "plan") refusedOut[id] = { status: res.status, since: now };
    else bump(id);
    return { status: why };
  };

  reads.ipo = await one("calendar-ipo");
  reads.active = plan.activeDue ? await one("listings-active", { status: "active" }) : { status: "skipped" };
  reads.delisted = [];
  for (const d of plan.delisted) {
    const r = await one("listings-delisted", { status: "delisted", date: d });
    reads.delisted.push({ ...r, date: d });
  }
  reads.schedule = [];
  for (const d of plan.schedule) reads.schedule.push({ ...(await one("potus-schedule", { date: d })), date: d });
  reads.posts = await one("potus-posts", { limit: 200, page: 0 });
  const fromIso = new Date(now - HALT_DAYS * 86400000).toISOString();
  reads.fired = await one("alerts-fired", { limit: 500, "noti_types[]": ALERT_TYPES, newer_than: fromIso });
  reads.configs = await one("alerts-config");
  if (plan.filtersDue) {
    reads.filters = await one("alerts-filters");
    reads.grammar = await one("alerts-grammar");
    reads.grammarTargets = {};
    for (const target of GRAMMAR_TARGETS) reads.grammarTargets[target] = await one("alerts-grammar", { target });
  }

  const natr = new Map();
  const pulse = new Map();
  const lists = {};
  const jobs = [
    ...windowNames.slice(0, NATR_NAMES).map((t) => ({ kind: "natr", t })),
    ...pulseNames.slice(0, PULSE_NAMES).map((t) => ({ kind: "pulse", t })),
    ...(plan.sectorsDue ? SECTOR_ENUM.map((s) => ({ kind: "sector", s })) : []),
  ];
  const work = async (job) => {
    if (job.kind === "natr") {
      const r = await one("tech-natr", { interval: "daily", time_period: 14 }, { ticker: job.t });
      natr.set(job.t, r.status === "ok" ? natrRead(r.body) : { fail: r.status });
    } else if (job.kind === "pulse") {
      const r = await one("stock-options-pulse", { date: sessionDate }, { ticker: job.t });
      pulse.set(job.t, r.status === "ok" ? pulseRead(r.body) : { fail: r.status });
    } else {
      const r = await one("sector-tickers", {}, { sector: job.s });
      const l = r.status === "ok" ? sectorList(r.body) : null;
      if (l) lists[job.s] = l;
    }
  };
  if (pool) await pool(jobs, work, { width, stopEarly: () => pastDeadline(deadline) });
  else for (const j of jobs) await work(j);

  log(`  eventrisk: ${calls} call(s); ${windowNames.length} window name(s), ${natr.size} NATR, ${pulse.size} pulse` +
    (plan.sectorsDue ? `, sectors ${Object.keys(lists).length}/${SECTOR_ENUM.length}` : "") +
    (Object.keys(failed).length ? `; failed ${Object.entries(failed).map(([k, v]) => k + " " + v).join(", ")}` : ""));
  return { reads, natr, pulse, sectors: plan.sectorsDue ? lists : null, plan, calls, failed, refused: refusedOut };
}
