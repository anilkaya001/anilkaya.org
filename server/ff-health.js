import { ABSENT_MARK, HEALTH, HEALTH_RULES, HEALTH_UNKNOWN, TIME } from "../shared/ff-contract.js";
import { easternDay, easternInstant, isTradingDay, phaseAt, sessionOpen, shiftDay } from "../shared/flows-freshness.js";
import { tradingSessionsBetween } from "../shared/flows-universe.js";
import { clock as trtClock } from "../shared/flows-time.js";
import { API_VERSION, absent, timeView } from "./ff-records.js";

const DEADLINE_MINUTES = (() => {
  const [h, m] = TIME.nightlyDeadlineEt.split(":").map(Number);
  return h * 60 + m;
})();

export const HEALTH_POLL = Object.freeze({ openS: 60, closedS: 300, sharedTtlMs: 30000, firstCheckAfterOpenMs: 5 * 60000 });

export const ROUTE_FLAGS = Object.freeze({ wires: "FF_ROUTE_WIRES", inbox: "FF_ROUTE_INBOX", fire: "FF_ROUTE_FIRE", export: "FF_ROUTE_EXPORT" });

export const modeOf = (env) => {
  const raw = typeof env.FF_MODE === "string" ? env.FF_MODE.trim().toLowerCase() : "";
  return raw === "on" ? "on" : raw === "shadow" ? "shadow" : "off";
};

export const flagOn = (env, name) => typeof env[name] === "string" && env[name].trim().toLowerCase() === "on";

export function switchState(rows, scope, target) {
  const row = rows.find((r) => r.scope === scope && r.target === target);
  return row ? row.state : "on";
}

export function routesView({ env, switches, memberSwitch }) {
  const mode = modeOf(env);
  const rows = switches.rows;
  const out = {};
  for (const [name, flag] of Object.entries(ROUTE_FLAGS)) {
    let reason = null;
    if (mode === "off") reason = "mode_off";
    else if (!flagOn(env, flag)) reason = "route_off";
    else if (name === "inbox" && switchState(rows, "channel", "inbox") === "off") reason = "channel_off";
    else if (name === "export" && switchState(rows, "channel", "export") === "off") reason = "channel_off";
    out[name] = Object.freeze({ available: reason === null, reason });
  }
  const arming = mode === "off" ? "mode_off" : switches.unreadable || memberSwitch.unreadable ? "switches_unreadable" : memberSwitch.state === "off" ? "member_off" : null;
  out.arming = Object.freeze({ available: arming === null, reason: arming });
  return Object.freeze(out);
}

export function dueNightly(now, row = null) {
  let d = easternDay(now);
  for (let i = 0; d && i < 14; i++) {
    if (isTradingDay(d, row) && easternInstant(d, DEADLINE_MINUTES) <= now) return d;
    d = shiftDay(d, -1);
  }
  return null;
}

export function healthState({ phase, liveAgeS, nightlyLate, error }) {
  const R = HEALTH_RULES;
  const open = phase === "open";
  if (nightlyLate === null || nightlyLate === undefined || (open && (liveAgeS === null || liveAgeS === undefined))) return HEALTH_UNKNOWN;
  if (nightlyLate >= R.nightlyDownLateSessions || (open && liveAgeS > R.degradedMaxAgeS)) return "down";
  if (nightlyLate >= R.nightlyDegradedLateSessions || error === true || (open && liveAgeS > R.liveMaxAgeFactor * R.liveCadenceS)) return "degraded";
  return open ? "live" : "resting";
}

export function agoText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return Math.floor(seconds) + "s ago";
  if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
  return Math.floor(seconds / 3600) + " h ago";
}

export function assessHealth({ now, clockRow = null, runs }) {
  const R = HEALTH_RULES;
  const ph = phaseAt(now, clockRow);
  const open = ph !== null && ph.phase === "rth";
  const today = ph === null ? null : ph.day;
  const due = dueNightly(now, clockRow);
  const nightlyDone = runs.nightlyDone || null;
  const nightlyLatest = runs.nightlyLatest || null;
  const live = runs.live || null;
  let nightlyLate = null;
  let nightlyNone = false;
  let unknownWhy = null;
  if (due === null) unknownWhy = "no session calendar";
  else if (nightlyLatest === null && nightlyDone === null) unknownWhy = "no nightly run recorded yet";
  else if (nightlyDone === null) { nightlyLate = R.nightlyDownLateSessions; nightlyNone = true; }
  else nightlyLate = Math.max(0, tradingSessionsBetween(nightlyDone.session, due) ?? 0);
  const openMs = open ? sessionOpen(ph.day) : NaN;
  const liveToday = live !== null && live.session === today;
  const okAt = live !== null && Number.isFinite(live.finished_at) ? live.finished_at : null;
  const lastOkToday = liveToday && okAt !== null && okAt >= openMs ? okAt : null;
  const graceMs = R.liveMaxAgeFactor * R.liveCadenceS * 1000;
  let liveAgeS = null;
  let waiting = false;
  if (open) {
    const ref = Math.max(openMs, lastOkToday || 0);
    if (live !== null || now - openMs <= graceMs) liveAgeS = Math.max(0, Math.floor((now - ref) / 1000));
    waiting = lastOkToday === null && liveAgeS !== null && liveAgeS <= R.liveMaxAgeFactor * R.liveCadenceS;
    if (liveAgeS === null && unknownWhy === null) unknownWhy = "no heartbeat recorded";
  }
  const error = liveToday && live.error !== null && live.error !== undefined;
  const state = nightlyLate === null ? HEALTH_UNKNOWN : healthState({ phase: open ? "open" : "closed", liveAgeS, nightlyLate, error });
  const finishedAt = nightlyDone !== null && Number.isFinite(nightlyDone.finished_at) ? nightlyDone.finished_at : null;
  let line;
  let reason = null;
  if (state === "live") line = waiting ? "Live · first check at " + trtClock(openMs + HEALTH_POLL.firstCheckAfterOpenMs) + " (scheduled)" : "Live · checked " + agoText(liveAgeS);
  else if (state === "resting") line = finishedAt === null ? "Resting · nightly current" : "Resting · nightly " + trtClock(finishedAt);
  else if (state === "degraded") {
    if (nightlyLate >= R.nightlyDegradedLateSessions) { reason = "nightly_late"; line = "Degraded · nightly " + nightlyLate + " session" + (nightlyLate === 1 ? "" : "s") + " late"; }
    else if (error) { reason = "evaluator_error"; line = "Degraded · evaluator error"; }
    else { reason = "live_late"; line = "Degraded · live loop " + Math.max(1, Math.round((liveAgeS - R.liveCadenceS) / 60)) + " min late"; }
  } else if (state === "down") {
    if (nightlyNone) { reason = "nightly_missing"; line = "Down · no completed nightly run recorded"; }
    else if (nightlyLate >= R.nightlyDownLateSessions) { reason = "nightly_missing"; line = "Down · nightly missing for " + nightlyLate + " sessions"; }
    else { reason = "no_heartbeat"; line = "Down · no heartbeat since " + trtClock(Math.max(openMs, lastOkToday || 0)); }
  } else { reason = "unavailable"; line = ABSENT_MARK + " health unavailable: " + (unknownWhy || "no input"); }
  return {
    state,
    healthy: HEALTH[state].healthy,
    breathes: HEALTH[state].breathes,
    reason,
    reasonText: state === HEALTH_UNKNOWN ? unknownWhy : null,
    line,
    phase: open ? "open" : "closed",
    session: due,
    nightlyLate,
    liveAgeS,
    lastOkAt: lastOkToday,
    nightlyFinishedAt: finishedAt,
    error,
    waiting,
  };
}

export function unreadView({ memberMax, houseMax, member, shadow }) {
  const m = shadow ? 0 : Math.max(0, memberMax - (member ? member.read_seq : 0));
  const h = shadow ? 0 : Math.max(0, houseMax - (member ? member.house_read_seq : 0));
  const total = m + h;
  const cap = HEALTH_RULES.unreadCap;
  return Object.freeze({ house: h, member: m, total, capped: total > cap, label: total > cap ? cap + "+" : String(total) });
}

const mix = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16);
};

export function etagOf(view) {
  const tuple = JSON.stringify([
    view.state, view.reason, view.mode, view.unread.house, view.unread.member, view.checkedAt && view.checkedAt.ms ? view.checkedAt.ms : null,
    view.evaluator.nightly.session, view.evaluator.nightly.status, view.evaluator.live.session, view.evaluator.live.status,
    Object.entries(view.routes).map(([k, r]) => k + ":" + (r.available ? "1" : r.reason)), view.pollAfterS,
  ]);
  return 'W/"ff-' + mix(tuple) + '"';
}

export function healthView({ now, env, assessed, rows, switches, memberRow, memberSwitch }) {
  const mode = modeOf(env);
  const unread = unreadView({ memberMax: rows.memberMax, houseMax: rows.houseMax, member: memberRow, shadow: mode === "shadow" });
  const nightly = rows.nightlyDone;
  const live = rows.live;
  const checkedMs = assessed.lastOkAt || assessed.nightlyFinishedAt;
  const view = {
    v: API_VERSION,
    serverNow: now,
    state: assessed.state,
    healthy: assessed.healthy,
    breathes: assessed.breathes,
    reason: assessed.reason,
    reasonText: assessed.reasonText,
    line: assessed.line,
    phase: assessed.phase,
    session: assessed.session,
    mode,
    checkedAt: checkedMs ? timeView(checkedMs, now) : absent("not_measured", "no completed check recorded"),
    ageS: assessed.liveAgeS === null ? absent("not_measured", "the session is closed") : { v: assessed.liveAgeS, text: agoText(assessed.liveAgeS) },
    evaluator: {
      nightly: {
        session: nightly ? nightly.session : null,
        status: nightly ? nightly.status : null,
        finishedAt: nightly && nightly.finished_at ? timeView(nightly.finished_at, now) : absent("not_measured", "no completed nightly run recorded"),
        late: assessed.nightlyLate,
      },
      live: {
        session: live ? live.session : null,
        status: live ? live.status : null,
        lastOkAt: assessed.lastOkAt ? timeView(assessed.lastOkAt, now) : absent("not_measured", assessed.phase === "open" ? "no check completed yet today" : "the session is closed"),
        cadenceS: HEALTH_RULES.liveCadenceS,
        error: assessed.error,
      },
    },
    unread,
    routes: routesView({ env, switches, memberSwitch }),
    switchesReadable: !switches.unreadable,
    pollAfterS: assessed.phase === "open" ? HEALTH_POLL.openS : HEALTH_POLL.closedS,
  };
  return view;
}

export async function readHealth({ env, store, readClock, cache = null, now, member }) {
  const clockRow = (await Promise.resolve(readClock ? readClock(env.DB) : null).catch(() => null)) || null;
  const ph = phaseAt(now, clockRow);
  const open = ph !== null && ph.phase === "rth";
  const key = "ff-health-shared:" + (open ? "open" : "closed");
  const hit = cache && cache.get(key);
  const sharedP = hit && now - hit.at < HEALTH_POLL.sharedTtlMs ? Promise.resolve(hit.value) : store.healthShared(env, { live: open }).then((value) => {
    if (cache && value) cache.set(key, { at: now, value });
    return value;
  });
  const [mine, shared] = await Promise.all([store.healthMember(env, member, now), sharedP]);
  if (!mine || !shared) return null;
  const rows = { ...shared, memberMax: mine.memberMax };
  const assessed = assessHealth({ now, clockRow, runs: { nightlyLatest: shared.nightlyLatest, nightlyDone: shared.nightlyDone, live: shared.live } });
  return { view: healthView({ now, env, assessed, rows, switches: shared.switches, memberRow: mine.member, memberSwitch: mine.memberSwitch }), assessed, rows };
}
