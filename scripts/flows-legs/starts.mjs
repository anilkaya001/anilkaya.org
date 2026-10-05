import { phaseAt } from "../../shared/flows-freshness.js";
import { chainDispatch, transientRefusal, liveWindow, LIVE_LOOP } from "./live.mjs";
import { etTime } from "./health.mjs";
import { annotation } from "./witness.mjs";

export const NIGHTLY = Object.freeze({
  workflow: "flows-pipeline.yml",
  origin: "live-loop",
  atMin: 17 * 60 + 30,
  retryMin: 18 * 60 + 15,
  retryGapMs: 30 * 60 * 1000,
  firstTries: 3,
  softRetries: 6,
  softUntilMin: 20 * 60 + 30,
});

export function nightlyStartDue({ at, clock = null, metaSession = null, attempts = [] } = {}) {
  const p = phaseAt(at, clock);
  if (!p) return { due: false, why: "no-clock" };
  if (!p.trading) return { due: false, why: "not-trading" };
  if (p.minutes < NIGHTLY.atMin) return { due: false, why: "before-window" };
  if (typeof metaSession === "string" && metaSession >= p.day) return { due: false, why: "landed" };
  let lastSent = -1;
  attempts.forEach((a, i) => { if (a.sent) lastSent = i; });
  const sentCount = attempts.filter((a) => a.sent).length;
  if (!sentCount && attempts.length < NIGHTLY.firstTries) return { due: true, why: "first" };
  const idle = sentCount ? "dispatched" : "refused";
  if (sentCount >= 2) return { due: false, why: idle };
  const last = attempts[attempts.length - 1];
  const retries = sentCount ? attempts.length - 1 - lastSent : attempts.length - NIGHTLY.firstTries;
  if (p.minutes < NIGHTLY.retryMin || at - last.at < NIGHTLY.retryGapMs) return { due: false, why: idle };
  if (retries === 0) return { due: true, why: "retry" };
  if (retries <= NIGHTLY.softRetries && transientRefusal(last) && p.minutes <= NIGHTLY.softUntilMin) {
    return { due: true, why: "retry" };
  }
  return { due: false, why: idle };
}

export function createNightlyStart({ env = process.env, fetchImpl = fetch, log = console.log, warn = console.warn } = {}) {
  const st = { day: null, attempts: [], landedNoted: false };
  return {
    attempts: () => st.attempts.map((a) => ({ ...a })),
    async step({ at, clock = null, metaSession }) {
      const p = phaseAt(at, clock);
      if (p && st.day !== p.day) {
        st.day = p.day;
        st.attempts = [];
        st.landedNoted = false;
      }
      const due = nightlyStartDue({ at, clock, metaSession, attempts: st.attempts });
      let dispatched = null;
      if (due.due) {
        dispatched = await chainDispatch({ env, fetchImpl, at, workflow: NIGHTLY.workflow,
          inputs: { origin: NIGHTLY.origin } });
        st.attempts.push({ at, sent: !!dispatched.sent, status: dispatched.status || null, why: dispatched.why });
        const line = `starts: dispatch of ${NIGHTLY.workflow} (${due.why}) at ${etTime(at)} — ${dispatched.why}` +
          `${dispatched.status ? " (HTTP " + dispatched.status + ")" : ""}`;
        if (dispatched.sent) log(line);
        else warn(annotation("warning", "Nightly start", line));
      }
      const landed = !!p && typeof metaSession === "string" && metaSession >= p.day;
      if (landed && st.attempts.some((a) => a.sent) && !st.landedNoted) {
        st.landedNoted = true;
        log(`starts: the ${p.day} nightly has landed (meta holds ${metaSession}) at ${etTime(at)}`);
      }
      const trading = !!p && p.trading;
      return { ...due, dispatched, busy: trading && p.minutes >= NIGHTLY.atMin && !landed };
    },
  };
}

export const STANDBY = Object.freeze({
  workflow: LIVE_LOOP.workflow,
  origin: "standby",
  crashSlackMs: 15 * 60 * 1000,
  crashLimit: 3,
  crashWindowMs: 6 * 60 * 60 * 1000,
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function standbyTick(startedAt, crashes = []) {
  return [startedAt, ...crashes].map((ms) => new Date(ms).toISOString()).join(" ");
}

export function readStandbyTick(tick) {
  if (typeof tick !== "string" || tick.length > 200) return null;
  const parts = tick.trim().split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 1 + STANDBY.crashLimit || !parts.every((p) => ISO_RE.test(p))) return null;
  const ms = parts.map((p) => Date.parse(p));
  if (!ms.every(Number.isFinite)) return null;
  return { from: ms[0], crashes: ms.slice(1) };
}

export function crashRestart({ origin = null, tick = null, startedAt, budgetMs = LIVE_LOOP.budgetMs } = {}) {
  if (origin !== STANDBY.origin) return { standby: false, crash: false, crashes: [], stoodDown: false, dueAt: null };
  const prior = readStandbyTick(tick);
  if (!prior) return { standby: true, crash: false, crashes: [], stoodDown: false, dueAt: null, why: "no-tick" };
  const dueAt = prior.from + budgetMs;
  const crash = startedAt < dueAt - STANDBY.crashSlackMs;
  const crashes = [...prior.crashes, ...(crash ? [startedAt] : [])]
    .filter((t) => t <= startedAt && startedAt - t < STANDBY.crashWindowMs)
    .sort((a, b) => a - b)
    .slice(-STANDBY.crashLimit);
  return { standby: true, crash, crashes, stoodDown: crash && crashes.length >= STANDBY.crashLimit, dueAt };
}

export function standbyDue({ at, clock = null, tried = false, stoodDown = false } = {}) {
  if (stoodDown) return { due: false, why: "stood-down" };
  if (tried) return { due: false, why: "pending" };
  const w = liveWindow(at, clock);
  if (w.run || w.wait) return { due: false, why: "session" };
  return { due: true, why: "off-session" };
}

export function createStandby({ env = process.env, fetchImpl = fetch, log = console.log, warn = console.warn } = {}) {
  const st = { startedAt: null, begun: null, tried: null };
  const begin = ({ startedAt, budgetMs = LIVE_LOOP.budgetMs }) => {
    st.startedAt = startedAt;
    st.begun = crashRestart({ origin: env.FLOWS_LIVE_ORIGIN || null, tick: env.FLOWS_LIVE_TICK || null, startedAt, budgetMs });
    if (st.begun.crash) {
      warn(annotation("warning", "Crash restart",
        `starts: this loop is a crash restart: its standby started at ${etTime(startedAt)}, ` +
        `${Math.round((st.begun.dueAt - startedAt) / 60000)} min before the loop that sent it was due to hand over at ` +
        `${etTime(st.begun.dueAt)}, so that loop died without handing over (${st.begun.crashes.length} crash restart(s) in the last ` +
        `${STANDBY.crashWindowMs / 3600000} h)`));
    }
    return st.begun;
  };
  return {
    begin,
    state: () => ({ startedAt: st.startedAt, ...(st.begun || {}), tried: st.tried ? { ...st.tried } : null }),
    async step({ at, clock = null }) {
      if (!st.begun) begin({ startedAt: at });
      const due = standbyDue({ at, clock, tried: !!st.tried, stoodDown: st.begun.stoodDown });
      if (!due.due) return { ...due, dispatched: null };
      const dispatched = await chainDispatch({ env, fetchImpl, at, workflow: STANDBY.workflow,
        inputs: { tick: standbyTick(st.startedAt, st.begun.crashes), origin: STANDBY.origin } });
      st.tried = { at, sent: !!dispatched.sent, status: dispatched.status || null, why: dispatched.why };
      const line = `starts: standby dispatch of ${STANDBY.workflow} at ${etTime(at)}, pending behind this loop until it ` +
        `ends — ${dispatched.why}${dispatched.status ? " (HTTP " + dispatched.status + ")" : ""}`;
      if (dispatched.sent) log(line);
      else warn(annotation("warning", "Standby", line));
      return { ...due, dispatched };
    },
  };
}
