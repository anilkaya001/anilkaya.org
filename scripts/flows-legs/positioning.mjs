import { read, rowsOf, pastDeadline } from "./common.mjs";
import { pathFor } from "../../shared/flows-vendor-ops.js";
import { SECTOR_ORDER, TRACK, daysBetween, planFilers, trackFilers } from "../../shared/flows-pos-13f.js";

export const REFUSAL_DAYS = 7;

export const ACTIVITY_MAX = 12;

export const ACTIVITY_V1_MAX = 3;

export const PLAN_STATUSES = Object.freeze([401, 402, 403, 404, 422]);

export function kindOf(res) {
  if (res.ok) return "ok";
  if (res.status === 429) return "failed";
  if (PLAN_STATUSES.includes(res.status)) return "plan";
  return "failed";
}

export function carryRefusals(prior, sessionDate, days = REFUSAL_DAYS) {
  const stored = prior && prior.basis && prior.basis.refused && typeof prior.basis.refused === "object" ? prior.basis.refused : {};
  const out = {};
  for (const [id, r] of Object.entries(stored)) {
    if (!r || !Number.isInteger(r.status) || typeof r.since !== "string") continue;
    const age = daysBetween(r.since, sessionDate);
    if (age !== null && age >= 0 && age < days) out[id] = { status: r.status, since: r.since };
  }
  return out;
}

export function makeAsker({ uw, sessionDate, deadline = null, refused = {}, failed = {}, wasRefused = {} }) {
  const state = { calls: 0 };
  const ask = async (id, params = {}, pathParams = {}) => {
    if (refused[id]) return { ok: false, kind: "plan", status: refused[id].status, skipped: true };
    if (pastDeadline(deadline)) {
      failed[id] = (failed[id] || 0) + 1;
      return { ok: false, kind: "budget", status: null, skipped: true };
    }
    state.calls++;
    const res = await read(uw, pathFor(id, pathParams), params, { envelope: true });
    if (res.ok) return { ok: true, rows: rowsOf(res.body), body: res.body };
    const kind = kindOf(res);
    if (id === "inst-activity" && (res.status === 404 || res.status === 410)) return { ok: false, kind: "gone", status: res.status };
    if (kind === "plan") {
      const before = wasRefused[id];
      refused[id] = { status: res.status, since: before && before.status === res.status ? before.since : sessionDate };
    } else failed[id] = (failed[id] || 0) + 1;
    return { ok: false, kind, status: res.status };
  };
  return { ask, state };
}

const gone = (res) => res.status === 404 || res.status === 410;

export async function readPositioning({
  uw, sessionDate, prior = null, deadline = null, pool = null, width = 1, log = () => {},
} = {}) {
  const wasRefused = carryRefusals(prior, sessionDate);
  const refused = { ...wasRefused };
  const failed = {};
  const { ask, state } = makeAsker({ uw, sessionDate, deadline, refused, failed, wasRefused });
  const each = async (items, work) => {
    if (pool) await pool(items, work, { width, stopEarly: () => pastDeadline(deadline) });
    else for (const item of items) await work(item);
  };

  const [listRes, latestRes] = await Promise.all([
    ask("inst-list", { limit: 100, order: "total_value", order_direction: "desc" }),
    ask("inst-latest", { limit: 100, order: "filing_date", order_direction: "desc" }),
  ]);
  const list = listRes.ok ? listRes.rows : [];
  const latest = latestRes.ok ? latestRes.rows : [];
  const tracked = trackFilers(list, prior, sessionDate);
  const ledger = prior && prior.filerLedger && typeof prior.filerLedger === "object" ? prior.filerLedger : {};

  const sectorsByCik = {};
  const toRead = planFilers(tracked, ledger, sessionDate);
  await each(toRead, async (f) => {
    const res = await ask("inst-sectors", { limit: 40 }, { name: f.name });
    sectorsByCik[f.cik] = res.ok ? res.rows : { __failed: res.kind };
  });

  const activityByCik = {};
  const holdingsByCik = {};
  const fresh = tracked
    .filter((f) => !f.kept && f.filed && (!ledger[f.cik] || !ledger[f.cik].f || f.filed > ledger[f.cik].f))
    .sort((a, b) => (b.total - a.total) || (a.cik < b.cik ? -1 : 1))
    .slice(0, ACTIVITY_MAX);
  let v1Used = 0;
  await each(fresh, async (f) => {
    const stored = ledger[f.cik];
    const params = { limit: 200, ...(stored && stored.r ? { start_date: stored.r } : {}) };
    let res = await ask("inst-activity", params, { name: f.name });
    if (!res.ok && gone(res) && v1Used < ACTIVITY_V1_MAX) {
      v1Used++;
      res = await ask("inst-activity-v1", params, { name: f.name });
    }
    if (res.ok && res.rows.length) { activityByCik[f.cik] = res.rows; return; }
    const hold = await ask("inst-holdings", { limit: 100, order: "value", order_direction: "desc" }, { name: f.name });
    if (hold.ok) holdingsByCik[f.cik] = hold.rows;
    else if (!res.ok) activityByCik[f.cik] = { __failed: res.kind };
  });

  const insiderBySector = {};
  await each(SECTOR_ORDER, async (s) => {
    const res = await ask("insider-sector", { limit: 120 }, { sector: s });
    if (res.ok) insiderBySector[s] = res.rows;
  });

  log(`  positioning: ${state.calls} call(s): ${tracked.length} filer(s) tracked, ${toRead.length} sector read(s), ${fresh.length} activity read(s)` +
    (Object.keys(refused).length ? `, refused ${Object.keys(refused).join(" ")}` : "") +
    (Object.keys(failed).length ? `, failed ${Object.keys(failed).join(" ")}` : ""));
  return { list, latest, sectorsByCik, activityByCik, holdingsByCik, insiderBySector, calls: state.calls, refused, failed, tracked: tracked.length, limits: TRACK };
}
