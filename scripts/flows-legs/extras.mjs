import { read, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { REDUCERS } from "../../shared/flows-dossier-vendor.js";
import { sanitizeText } from "../../shared/flows-dossier.js";
import {
  PARTS, NIGHTLY_IDS, SLOW_CAP, REDUCERS_X, ER_IDS, planSlow, partState, mergeParts, sectionOf, fitSection, outcomeTally, shapeHealth, usableX,
} from "../../shared/flows-vendor-extras.js";
import { reduceStockEarnings, reduceFin } from "../../shared/flows-er-eps.js";
import { sessionsBetween } from "../../shared/flows-calendar.js";

export const PRIOR_WIDTH = 4;

export const TEXT_FIELDS = Object.freeze({ info: ["desc"], profile: ["desc"] });

const DESC_CAP = 900;

export const SOURCES = Object.freeze({
  info: Object.freeze({ path: (t) => pathFor("info", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS.info(body) }),
  profile: Object.freeze({ path: (t) => pathFor("profile", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS.profile(body) }),
  financials: Object.freeze({ path: (t) => pathFor("financials", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS.financials(body) }),
  breakdown: Object.freeze({ path: (t) => pathFor("fundamental-breakdown", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS.breakdown(body) }),
  estimates: Object.freeze({ path: (t) => pathFor("earnings-estimates", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS.estimates(body) }),
  analysts: Object.freeze({ path: () => pathFor("analysts"), params: (t) => ({ ticker: t, limit: 30 }), reduce: (body, t) => REDUCERS.analysts(body, t) }),
  ownership: Object.freeze({ path: (t) => pathFor("ownership", { ticker: t }), params: () => ({ limit: 25, order: "value", order_direction: "desc" }), reduce: (body) => REDUCERS.ownership(body) }),
  dividends: Object.freeze({ path: (t) => pathFor("dividends", { ticker: t }), params: () => ({}), reduce: (body, t, o) => REDUCERS_X.dividends(body, { today: o.sessionDate }) }),
  splits: Object.freeze({ path: (t) => pathFor("splits", { ticker: t }), params: () => ({}), reduce: (body, t, o) => REDUCERS_X.splits(body, { today: o.sessionDate }) }),
  etf: Object.freeze({ path: (t) => pathFor("etf-exposure", { ticker: t }), params: () => ({}), reduce: (body) => REDUCERS_X.etf(body) }),
  ivp: Object.freeze({ path: (t) => pathFor("interpolated-iv", { ticker: t }), params: (t, o) => (o.sessionDate ? { date: o.sessionDate } : {}), reduce: (body) => REDUCERS_X.ivp(body) }),
  eps: Object.freeze({ path: (t) => pathFor("stock-earnings", { ticker: t }), params: () => ({}), reduce: (body) => erX(reduceStockEarnings(body)) }),
  fin: Object.freeze({ path: (t) => pathFor("income-statements", { ticker: t }), params: () => ({}), reduce: (body) => erX(reduceFin(body, null, null)), multi: true }),
});

function erX(r) {
  return r && r.fail ? { ok: false, reason: r.fail } : { ok: true, ...r };
}

export const FIN_PATHS = Object.freeze([
  (t) => pathFor("income-statements", { ticker: t }),
  (t) => pathFor("balance-sheets", { ticker: t }),
  (t) => pathFor("cash-flows", { ticker: t }),
]);

export const ER_REFRESH_NEAR_S = 20 * 3600;

export function erRefreshOf(sessionDate) {
  return (id, t, prior) => {
    if (id !== "eps" || !prior) return null;
    const last = prior.earnings && Array.isArray(prior.earnings.events) && prior.earnings.events[0] ? prior.earnings.events[0][0] : null;
    const next = prior.earnings && prior.earnings.next ? prior.earnings.next.d : null;
    const rd = last && sessionDate ? sessionsBetween(last, sessionDate) : null;
    const ed = next && sessionDate ? sessionsBetween(sessionDate, next) : null;
    return (rd !== null && rd >= 0 && rd <= 2) || (ed !== null && ed >= 0 && ed <= 1) ? ER_REFRESH_NEAR_S : null;
  };
}

export function scrub(id, x) {
  const fields = TEXT_FIELDS[id];
  if (!fields || !x || x.ok !== true) return x;
  const out = { ...x };
  for (const f of fields) {
    if (typeof out[f] !== "string") continue;
    const clean = sanitizeText(out[f], { cap: DESC_CAP });
    out[f] = clean.text === null ? null : clean.text;
  }
  return out;
}

export function failureOf(res) {
  if (res.status === 429) return "limited";
  if ([401, 402, 403, 404, 422].includes(res.status)) return "plan";
  return "failed";
}

export function judge(id, x) {
  if (x && x.ok === true) return { store: true, why: "ok" };
  const reason = String((x && x.reason) || "unshaped");
  if (reason === "empty") return { store: true, why: "empty" };
  return { store: false, why: reason };
}

export async function readPriors(names, { readPrior, pool = null, width = PRIOR_WIDTH, withEr = false } = {}) {
  const priors = new Map();
  const failed = new Set();
  if (typeof readPrior !== "function") return { priors, failed, read: 0 };
  const work = async (t) => {
    const res = await readPrior(t);
    if (res && res.payload && typeof res.payload === "object") {
      const p = res.payload;
      priors.set(t, {
        dx: p.dx && typeof p.dx === "object" ? p.dx : null, vx: p.vx && typeof p.vx === "object" ? p.vx : null,
        ...(withEr ? { er: p.er && typeof p.er === "object" ? p.er : null, earnings: p.earnings && typeof p.earnings === "object" ? p.earnings : null } : {}),
      });
    } else if (res && res.absent) priors.set(t, { dx: null, vx: null, ...(withEr ? { er: null, earnings: null } : {}) });
    else failed.add(t);
  };
  const list = [...new Set(names)];
  if (pool) await pool(list, work, { width });
  else for (const t of list) await work(t);
  for (const t of list) if (!priors.has(t) && !failed.has(t)) failed.add(t);
  return { priors, failed, read: priors.size };
}

export async function runExtras({
  uw, names = [], sessionDate = null, now = Date.now(), deadline = null, pool = null, width = 1, cap = SLOW_CAP,
  readPrior = null, priorWidth = PRIOR_WIDTH, log = () => {}, only = null, er = null,
} = {}) {
  const list = [...new Set(names)].sort();
  const erList = er ? [...new Set([...list, ...(Array.isArray(er.names) ? er.names : [])])].sort() : list;
  const o = { sessionDate };
  const { priors, failed: priorFailed } = await readPriors(erList, { readPrior, pool, width: priorWidth, withEr: !!er });
  const slowIds = only ? only.filter((id) => PARTS[id] && !NIGHTLY_IDS.includes(id)) : undefined;
  const plan = planSlow({ names: list, priors, now, cap, ...(slowIds ? { ids: slowIds } : {}) });
  const nightly = (only ? only.filter((id) => NIGHTLY_IDS.includes(id)) : NIGHTLY_IDS).flatMap((id) => list.filter((t) => {
    const sec = priors.get(t);
    const part = sec && sec[PARTS[id].group] && sec[PARTS[id].group].parts ? sec[PARTS[id].group].parts[id] : null;
    return partState(part, id, now) !== "fresh";
  }).map((t) => ({ t, id })));
  const jobs = [...plan.picked.map((p) => ({ t: p.t, id: p.id })), ...nightly];
  const got = new Map();
  const miss = new Map();
  const rows = [];
  let calls = 0;
  const put = (map, t, id, v) => { if (!map.has(t)) map.set(t, {}); map.get(t)[id] = v; };
  const work = async (job) => {
    if (pastDeadline(deadline)) { rows.push({ id: job.id, skipped: true }); put(miss, job.t, job.id, { why: "deadline", at: now }); return; }
    const src = SOURCES[job.id];
    let res;
    if (src.multi) {
      const got3 = [];
      for (const pathOf of FIN_PATHS) {
        calls++;
        got3.push(await read(uw, pathOf(job.t), {}, { envelope: true }));
      }
      const live = got3.filter((r) => r.ok);
      if (!live.length) res = got3[0];
      else res = { ok: true, finBodies: got3.map((r) => (r.ok ? r.body : null)) };
    } else {
      calls++;
      res = await read(uw, src.path(job.t), src.params(job.t, o), { envelope: true });
    }
    if (!res.ok) {
      const why = failureOf(res);
      rows.push({ id: job.id, why });
      if (why === "plan") put(got, job.t, job.id, { at: now, rv: PARTS[job.id].rv, x: { ok: false, reason: "plan" } });
      else put(miss, job.t, job.id, { why, at: now });
      return;
    }
    let x;
    try { x = scrub(job.id, res.finBodies ? erX(reduceFin(res.finBodies[0], res.finBodies[1], res.finBodies[2])) : src.reduce(res.body, job.t, o)); } catch { x = { ok: false, reason: "unshaped" }; }
    const verdict = judge(job.id, x);
    rows.push({ id: job.id, why: verdict.why });
    if (verdict.store) put(got, job.t, job.id, { at: now, rv: PARTS[job.id].rv, x });
    else put(miss, job.t, job.id, { why: verdict.why, at: now });
  };
  if (pool) await pool(jobs, work, { width, stopEarly: () => pastDeadline(deadline) });
  else for (const j of jobs) await work(j);
  let erPlan = null;
  if (er && (!only || only.some((id) => ER_IDS.includes(id)))) {
    const refresh = erRefreshOf(sessionDate);
    const finUnusable = (t) => {
      const prior = priors.get(t) || {};
      const dx = mergeParts({ prior: prior.dx, got: got.get(t) || {}, miss: miss.get(t) || {}, group: "dx", now });
      return usableX({ parts: dx.parts }, "financials", now) === null;
    };
    erPlan = planSlow({
      names: erList, priors, now, cap: er.cap, ids: only ? only.filter((id) => ER_IDS.includes(id)) : ER_IDS,
      scopeOf: (id, t) => id !== "fin" || finUnusable(t),
      refreshOf: (id, t) => refresh(id, t, priors.get(t)),
    });
    const erJobs = erPlan.picked.map((p) => ({ t: p.t, id: p.id }));
    if (pool) await pool(erJobs, work, { width, stopEarly: () => pastDeadline(deadline) });
    else for (const j of erJobs) await work(j);
  }
  const tally = outcomeTally(rows);
  const sections = new Map();
  const own = new Set(list);
  for (const t of erList) {
    const prior = priors.get(t) || { dx: null, vx: null };
    const out = {};
    for (const group of er ? (own.has(t) ? ["dx", "vx", "er"] : ["er"]) : ["dx", "vx"]) {
      const merged = mergeParts({ prior: prior[group], got: got.get(t) || {}, miss: miss.get(t) || {}, group, now });
      if (!Object.keys(merged.parts).length && !Object.keys(merged.miss).length) continue;
      out[group] = fitSection(sectionOf({ ...merged, group }), group);
    }
    if (out.dx || out.vx || out.er) sections.set(t, out);
  }
  const health = shapeHealth(tally);
  const failing = Object.entries(health).filter(([, h]) => h.state === "fail").map(([id]) => id);
  log(`  extras: ${calls} call(s) for ${list.length} name(s): ${plan.picked.length} of ${plan.due} due slow part(s) read` +
    (plan.deferred ? `, ${plan.deferred} deferred by the ${cap}-call cap` : "") + `, ${nightly.length} implied-volatility read(s)` +
    (priorFailed.size ? `, ${priorFailed.size} prior card-x unread` : "") +
    (failing.length ? `; SHAPE FAILING ${failing.join(", ")}` : ""));
  return { sections, tally, health, calls, ...(erPlan ? { er: { due: erPlan.due, picked: erPlan.picked.length, deferred: erPlan.deferred, spent: erPlan.spent } } : {}), plan: { due: plan.due, picked: plan.picked.length, deferred: plan.deferred, fresh: plan.fresh }, priorFailed: priorFailed.size, failing };
}

