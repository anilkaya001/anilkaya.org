import { clock as trtClock } from "./flows-time.js";
import { phaseAt, expectedNightlySession, tier1Due, easternDay } from "./flows-freshness.js";

export const READY_KEYS = Object.freeze(["meta", "universe", "board:long", "board:short", "regime", "events"]);

export const READY_LIMITS = Object.freeze({
  tier1TickMs: 11 * 60 * 1000,
  tier1OkMs: 16 * 60 * 1000,
  tier1GraceMs: 11 * 60 * 1000,
});

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dayOf = (v) => (typeof v === "string" && DAY_RE.test(v) ? v : null);
const said = (ms) => trtClock(ms);
const minutesWord = (m) => (m === 1 ? "1 minute" : m + " minutes");

function keyBlocker(id, label, entry, expected) {
  if (!entry || entry.present === false) {
    return { code: id, sentence: label + " has not been published for the " + expected + " session." };
  }
  const session = dayOf(entry.sessionDate);
  if (session === null) {
    return { code: id, sentence: label + " carries no session date, so it cannot be tied to the " + expected + " close." };
  }
  if (session < expected) {
    return { code: id, sentence: label + " is still the " + session + " session; the " + expected + " one has not landed." };
  }
  return null;
}

const KEY_LABELS = Object.freeze({
  meta: "The nightly's run record",
  universe: "The universe",
  board: "The boards",
  regime: "The regime",
  events: "The events calendar",
});

export function readiness(state, now) {
  const at = num(now);
  const s = state && typeof state === "object" ? state : {};
  const row = s.clock && typeof s.clock === "object" ? s.clock : null;
  const phase = at === null ? null : phaseAt(at, row);
  const blockers = [];
  const checks = {};
  const block = (id, code, sentence) => {
    blockers.push({ code, sentence });
    checks[id] = "blocked";
  };

  if (phase === null) {
    return Object.freeze({
      ok: false, asOf: null, session: null, expected: null, phase: null, opens: null, minutesToOpen: null,
      blockers: Object.freeze([Object.freeze({ code: "clock", sentence: "The time could not be read, so nothing can be judged." })]),
      checks: Object.freeze({ clock: "blocked" }), said: "Readiness cannot be judged.",
    });
  }

  const expected = expectedNightlySession(at, row);
  const openMs = phase.phase === "rth" ? at : phase.nextOpen;
  const hasOpen = Number.isFinite(openMs);
  const minutesToOpen = hasOpen ? Math.max(0, Math.ceil((openMs - at) / 60000)) : null;
  const session = hasOpen ? easternDay(openMs) : null;
  const opens = hasOpen ? Object.freeze({ ms: openMs, trt: said(openMs), session }) : null;

  if (row === null) block("clock", "clock", "The session clock row could not be read, so the live checks run on the calendar alone.");
  else checks.clock = "ok";

  const keys = s.keys && typeof s.keys === "object" ? s.keys : null;
  if (keys === null) {
    block("keys", "store", "The stored keys could not be read, so the nightly cannot be confirmed.");
  } else if (expected === null) {
    block("nightly", "nightly", "No expected session could be worked out from the calendar.");
  } else {
    const nightly = keyBlocker("nightly", KEY_LABELS.meta, keys.meta, expected);
    if (nightly) block("nightly", "nightly", nightly.sentence);
    else checks.nightly = "ok";
    for (const id of ["universe", "regime", "events"]) {
      const b = keyBlocker(id, KEY_LABELS[id], keys[id], expected);
      if (b) block(id, id, b.sentence);
      else checks[id] = "ok";
    }
    const boards = ["board:long", "board:short"].map((k) => [k, keyBlocker("board", KEY_LABELS.board + " (" + k.slice(6) + ")", keys[k], expected)]);
    const bad = boards.find(([, b]) => b !== null);
    if (bad) block("board", "board", bad[1].sentence);
    else checks.board = "ok";
  }

  const tier1Needed = phase.phase === "rth" && tier1Due(at, row) && at - phase.open >= READY_LIMITS.tier1GraceMs;
  if (!tier1Needed) checks.tier1 = "skipped";
  else {
    const why = row && typeof row.tier1Why === "string" ? row.tier1Why : "";
    const tickAt = row ? num(row.tier1At) : null;
    const okAt = row ? num(row.tier1OkAt) : null;
    if (why === "holiday") checks.tier1 = "skipped";
    else if (why === "off") block("tier1", "tier1", "Live Tier 1 is switched off, so no price is being refreshed.");
    else if (tickAt === null || at - tickAt > READY_LIMITS.tier1TickMs) {
      block("tier1", "tier1", tickAt === null
        ? "Live Tier 1 has never ticked."
        : "Live Tier 1 last ticked at " + said(tickAt) + ", " + minutesWord(Math.floor((at - tickAt) / 60000)) + " ago.");
    } else if (okAt === null || at - okAt > READY_LIMITS.tier1OkMs) {
      block("tier1", "tier1", "Live Tier 1 ticks but its last good read was " +
        (okAt === null ? "never" : "at " + said(okAt)) + (why.startsWith("error:") ? " (" + why.slice(6) + ")" : "") + ".");
    } else checks.tier1 = "ok";
  }

  const railNeeded = phase.trading && phase.phase !== "closed";
  const rail = s.rail;
  if (!railNeeded || rail === undefined) checks.rail = "skipped";
  else if (rail === null || rail.reachable === false) block("rail", "rail", "The real-time rail did not answer.");
  else if (rail.mode !== "on") block("rail", "rail", "The real-time rail is switched off, so pages fall back to polling.");
  else if (rail.degraded) block("rail", "rail", "The real-time rail is degraded and is serving from polling.");
  else if (rail.rosterError) block("rail", "rail", "The real-time rail could not read its roster.");
  else checks.rail = "ok";

  const ok = blockers.length === 0;
  const when = opens === null ? "" : phase.phase === "rth" ? " The US session is open." : " The US session opens " + opens.trt +
    (minutesToOpen === null ? "" : ", in " + minutesWord(minutesToOpen)) + ".";
  const head = ok ? "Flows is ready." : blockers.length === 1 ? "One thing is blocking: " + blockers[0].sentence
    : blockers.length + " things are blocking.";
  return Object.freeze({
    ok, asOf: new Date(at).toISOString(), session, expected, phase: phase.phase, opens, minutesToOpen,
    blockers: Object.freeze(blockers.map((b) => Object.freeze(b))), checks: Object.freeze(checks), said: head + when,
  });
}

export function healthOf(now, clockRow = null) {
  const at = num(now);
  const phase = at === null ? null : phaseAt(at, clockRow);
  return Object.freeze({ ok: phase !== null, asOf: at === null ? null : new Date(at).toISOString(), session: phase ? phase.session : null });
}
