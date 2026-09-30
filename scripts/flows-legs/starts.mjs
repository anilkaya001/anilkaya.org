import { phaseAt } from "../../shared/flows-freshness.js";
import { chainDispatch, transientRefusal } from "./live.mjs";
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
