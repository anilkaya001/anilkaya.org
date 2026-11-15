import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { sessionsBetween, addSessions } from "../../shared/flows-calendar.js";
import {
  PM_NAMES_CAP, PM_PLAN_SLEEP_SESSIONS, PM_REFRESH_S, PM_COMPANY_FRESH_S, normalizeName, queryOf, pmCap, statusFiling, investorMatch, companiesOf,
  pmCardSection, pmSectionState, companyList, reduceCompany, reduceFunding, reducePricing, leadersOf, topEntry, sectorOrder, nextSector,
  sectorEntry, investorsTop,
} from "../../shared/flows-private.js";
import { unwrap } from "../../shared/flows-vendor-core.js";

const PATH = {
  "pm-search": (p) => pathFor("pm-search", p),
  "pm-investor": (p) => pathFor("pm-investor", p),
  "pm-companies": (p) => pathFor("pm-companies", p),
  "pm-company": (p) => pathFor("pm-company", p),
  "pm-funding": (p) => pathFor("pm-funding", p),
  "pm-pricing": (p) => pathFor("pm-pricing", p),
  "pm-management": (p) => pathFor("pm-management", p),
  "pm-investors-of": (p) => pathFor("pm-investors-of", p),
  "pm-investors": (p) => pathFor("pm-investors", p),
};

export const PM_SWITCH = "FLOWS_PM_CAP";

export const pmCapOf = (env = process.env) => pmCap(env[PM_SWITCH]);

const fail = (res) => ({ status: statusFiling(res.status), why: String(res.status === null || res.status === undefined ? "network" : res.status) });

export function makeGetter({ uw, deadline, budget }) {
  const state = { calls: 0, planHit: false, tally: {} };
  const get = async (op, pathParams, params) => {
    if (state.calls >= budget) return { status: "failed", why: "cap" };
    if (pastDeadline(deadline)) return { status: "failed", why: "deadline" };
    state.calls++;
    const res = await read(uw, PATH[op](pathParams || {}), params || {}, { envelope: true });
    const slot = state.tally[op] || (state.tally[op] = { n: 0, bad: 0 });
    slot.n++;
    if (res.ok) return { status: "ok", body: res.body };
    slot.bad++;
    const f = fail(res);
    if (f.status === "plan") state.planHit = true;
    return f;
  };
  return { get, state };
}

export function dueNames(candidates, now, cap = PM_NAMES_CAP) {
  const never = [];
  const aged = [];
  for (const c of candidates) {
    const s = pmSectionState(c.pm, now);
    if (s === "fresh") continue;
    if (s === "missing" || s === "expired") never.push(c);
    else aged.push(c);
  }
  aged.sort((a, b) => a.pm.at - b.pm.at);
  return [...never, ...aged].slice(0, cap);
}

export async function runPrivateNames({ uw, candidates = [], session, now = Date.now(), deadline = null, budget = PM_NAMES_CAP * 2, sleeping = false, log = () => {} } = {}) {
  const sections = new Map();
  if (sleeping) return { sections, calls: 0, tally: {}, plan: false, asleep: true };
  const { get, state } = makeGetter({ uw, deadline, budget });
  const due = dueNames(candidates, now);
  for (const c of due) {
    if (state.planHit) break;
    const q = queryOf(c.cardX);
    const keep = (why) => {
      if (c.pm && pmSectionState(c.pm, now) !== "expired" && c.pm.match) sections.set(c.ticker, { ...c.pm });
      else sections.set(c.ticker, pmCardSection({ at: now, session, match: null, why }));
    };
    if (!q.query) { sections.set(c.ticker, pmCardSection({ at: now, session, match: null, why: "short" })); continue; }
    const found = await get("pm-search", {}, { query: q.query, limit: 20 });
    if (found.status !== "ok") { keep(found.status === "plan" ? "plan" : "failed"); continue; }
    const hit = investorMatch(found.body, q.query);
    if (!hit.match) { sections.set(c.ticker, pmCardSection({ at: now, session, match: null, why: hit.why })); continue; }
    const inv = await get("pm-investor", { name: hit.match.name }, {});
    if (inv.status !== "ok") { keep(inv.status === "plan" ? "plan" : "failed"); continue; }
    sections.set(c.ticker, pmCardSection({ at: now, session, match: hit.match, companies: companiesOf(inv.body) }));
  }
  log(`  pm names: ${sections.size} of ${due.length} due, ${state.calls} call(s)`);
  return { sections, calls: state.calls, tally: state.tally, plan: state.planHit, asleep: false, due: due.length };
}

export function sleepingUntil(prior, session) {
  const until = prior && prior.basis && typeof prior.basis.sleepUntil === "string" ? prior.basis.sleepUntil : null;
  if (!until) return false;
  const gap = sessionsBetween(session, until);
  return gap !== null && gap > 0;
}

export const wakeSession = (session) => addSessions(session, PM_PLAN_SLEEP_SESSIONS);

export async function runPrivateSectors({ uw, session, now = Date.now(), prior = null, sectors = [], cap = 150, used = 0, deadline = null, log = () => {} } = {}) {
  const budget = Math.max(0, cap - used);
  const order = sectorOrder(sectors);
  const out = { sectors: { ...(prior && prior.sectors ? prior.sectors : {}) }, investors: prior && prior.investors ? prior.investors : { asOf: null, n: 0, top: [] }, calls: 0, tally: {}, plan: false, sector: null };
  if (!order.length || budget <= 0) return out;
  const { get, state } = makeGetter({ uw, deadline, budget });
  const sector = nextSector(order, prior);
  out.sector = sector;
  const before = out.sectors[sector] || { cursor: 0, profiled: 0, listed: 0, top: [], complete: null };
  const cursor = before.cursor || 0;
  const page = await get("pm-companies", {}, { sector, limit: 200, offset: cursor });
  const finish = () => { out.calls = state.calls; out.tally = state.tally; out.plan = state.planHit; return out; };
  if (page.status !== "ok") {
    out.sectors[sector] = { ...before, status: page.status === "plan" ? "plan" : "failed" };
    return finish();
  }
  const list = companyList(page.body);
  if (!list.length && cursor === 0) {
    out.sectors[sector] = sectorEntry({ status: "unmatched", listed: 0, cursor: 0, profiled: 0, complete: session, top: [] });
    return finish();
  }
  const known = new Map((before.top || []).map((e) => [e[0], e]));
  const details = new Map();
  let profiled = 0;
  for (const c of list) {
    if (state.calls >= budget - 8) break;
    const prev = known.get(c.npm);
    if (prev && before.complete && sessionAge(before.complete, session) * 86400 < PM_COMPANY_FRESH_S && prev[2] !== null) {
      details.set(c.npm, { company: { ok: true, totalFunding: prev[2], investorCount: prev[3], price: prev[4], priceDate: prev[5] }, pricing: { price: prev[4], priceDate: prev[5], chg1y: prev[6] }, lastRound: prev[7], leaders: prev[8], kept: true });
      continue;
    }
    const r = await get("pm-company", { npm_ticker: c.npm }, {});
    if (r.status !== "ok") { if (r.status === "plan") break; continue; }
    details.set(c.npm, { company: reduceCompany(r.body) });
    profiled++;
  }
  const ranked = list.filter((c) => details.has(c.npm)).sort((a, b) => ((details.get(b.npm).company.totalFunding ?? -1) - (details.get(a.npm).company.totalFunding ?? -1)));
  for (const c of ranked.slice(0, 6)) {
    const d = details.get(c.npm);
    if (d.kept) continue;
    const f = await get("pm-funding", { npm_ticker: c.npm }, { limit: 20 });
    if (f.status === "ok") d.lastRound = reduceFunding(f.body);
    const p = await get("pm-pricing", { npm_ticker: c.npm }, { start_date: new Date(Date.parse(session + "T00:00:00Z") - 400 * 86400000).toISOString().slice(0, 10) });
    if (p.status === "ok") d.pricing = reducePricing(p.body);
    const m = await get("pm-management", { npm_ticker: c.npm }, { limit: 50 });
    if (m.status === "ok") d.leaders = leadersOf(m.body);
    if (!(d.company.investorCount > 0)) {
      const iv = await get("pm-investors-of", { npm_ticker: c.npm }, { limit: 200 });
      if (iv.status === "ok") { const rows = unwrap(iv.body); d.company = { ...d.company, investorCount: Array.isArray(rows) ? rows.length : null }; }
    }
  }
  const top = list.filter((c) => details.has(c.npm)).map((c) => topEntry(c, details.get(c.npm)));
  const full = list.length >= 200;
  const nextCursor = full ? cursor + 200 : 0;
  out.sectors[sector] = sectorEntry({
    status: "ok", listed: cursor + list.length, cursor: nextCursor, profiled: (before.profiled || 0) * (cursor ? 1 : 0) + profiled + [...details.values()].filter((d) => d.kept).length,
    complete: full ? before.complete || null : session, top,
  });
  const investorsAge = out.investors.asOf ? sessionAge(out.investors.asOf, session) : Infinity;
  if (investorsAge >= 7 && state.calls < budget) {
    const iv = await get("pm-investors", {}, { limit: 500 });
    if (iv.status === "ok") out.investors = investorsTop(iv.body, session);
  }
  log(`  pm sector ${sector}: ${list.length} listed, ${profiled} profiled, ${state.calls} call(s)`);
  return finish();
}

function sessionAge(from, to) {
  return Math.max(0, Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000));
}

export { normalizeName, PM_REFRESH_S };
