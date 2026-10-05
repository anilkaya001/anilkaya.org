import { phaseAt, LIVE_CLOCK, easternDay } from "../../shared/flows-freshness.js";
import {
  WITNESS, witnessView, evaluateTier1, evaluateTier2, evaluateNightly, createWitness, createIssueReporter, sessionOf,
} from "./witness.mjs";
import { createNightlyStart, NIGHTLY } from "./starts.mjs";
import { withDeadline } from "./live.mjs";
import { etTime } from "./health.mjs";

export function normalizeRead(read) {
  if (!read || read.failed) return { failed: true, status: read && read.status ? read.status : 0, detail: read && read.detail ? read.detail : null };
  if (read.absent || read.payload === null || read.payload === undefined) return { pending: true };
  return { ok: true, payload: read.payload };
}

export const WATCH_RETRY = Object.freeze({ delayMs: 1000, statuses: Object.freeze([0, 403, 408, 429]) });

export function challenged(read) {
  if (!read || read.failed !== true || read.final) return false;
  const status = Number(read.status) || 0;
  return WATCH_RETRY.statuses.includes(status) || status >= 500;
}

export function keptView(view, at, fresh) {
  if (!view || fresh) return view;
  if (view.clock.day !== easternDay(at)) return null;
  return view.tier1 && view.tier1.why !== "off" ? { ...view, tier1: null } : view;
}

export function tier1Window(at, view) {
  if (!view || (view.tier1 && view.tier1.why === "off")) return false;
  const p = phaseAt(at, view.clock);
  return !!p && p.trading && at >= p.open && at <= p.close + LIVE_CLOCK.tier1AfterCloseMin * 60000;
}

export function tier2Window(at, view) {
  if (!view || (view.tier1 && view.tier1.why === "off")) return false;
  const p = phaseAt(at, view.clock);
  return !!p && p.trading && at - p.open >= WITNESS.tier2StaleMs && at <= p.close + LIVE_CLOCK.runAfterCloseMin * 60000;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function createWatch({ readOnce, latestClock, env = process.env, fetchImpl = fetch, reporter = null,
  readDeadlineMs = WITNESS.readDeadlineMs, retryMs = WATCH_RETRY.delayMs, sleep = realSleep, log = console.log,
  warn = console.warn } = {}) {
  const witness = createWitness({ reporter: reporter || createIssueReporter({ env, fetchImpl }), env, log, warn });
  const nightly = createNightlyStart({ env, fetchImpl, log, warn });
  const state = { landed: null };
  const attempt = (key, ms) => withDeadline(Promise.resolve().then(() => readOnce(key)), ms);
  const read = async (key) => {
    if (!(readDeadlineMs > retryMs)) return normalizeRead(await attempt(key, readDeadlineMs));
    const each = Math.floor((readDeadlineMs - retryMs) / 2);
    const first = await attempt(key, each);
    if (!challenged(first)) return normalizeRead(first);
    await sleep(retryMs);
    return normalizeRead(await attempt(key, each));
  };

  return {
    async tick({ at, clock = null, clockRead = null, first = false }) {
      if (first) {
        await witness.start();
        await witness.clear("chain", { at });
      }
      const kept = witnessView(latestClock());
      const clockFresh = clockRead === null ? !!kept : !!clockRead;
      const view = keptView(kept, at, clockFresh);
      const wclock = view ? view.clock : clock;
      const p = phaseAt(at, wclock);
      const inTier1 = tier1Window(at, view);
      const inTier2 = tier2Window(at, view);
      const landedToday = !!p && !!state.landed && state.landed.day === p.day;
      const wantMeta = first || witness.isOpen("nightly") ||
        (!!p && p.trading && p.minutes >= NIGHTLY.atMin && !landedToday);
      const [market, focus, breadth, meta] = await Promise.all([
        inTier1 ? read("live:market") : null,
        inTier1 ? read("live:focus") : null,
        inTier2 ? read("live:breadth") : null,
        wantMeta ? read("meta") : null,
      ]);
      let metaSession = meta && meta.ok ? sessionOf(meta.payload) : meta && meta.pending ? null : undefined;
      if (p && typeof metaSession === "string" && metaSession >= p.day) state.landed = { day: p.day, session: metaSession };
      else if (metaSession === undefined && landedToday) metaSession = state.landed.session;
      const step = await nightly.step({ at, clock: wclock, metaSession });
      const results = [];
      if (inTier1) results.push(evaluateTier1({ at, view, market, focus }));
      if (inTier2) results.push(evaluateTier2({ at, view, breadth }));
      if (meta) results.push(evaluateNightly({ at, view, meta }));
      const reads = [market, focus, breadth, meta].filter(Boolean);
      const seen = clockFresh || reads.some((r) => !r.failed);
      results.push({
        id: "probe", status: seen ? "ok" : "breach",
        detail: `nothing could be read through the ingest route at ${etTime(at)} (a challenged read is tried twice): ` +
          [clockFresh ? "the clock answered" : "the clock read failed",
            ...reads.map((r) => (r.failed ? (r.status ? "HTTP " + r.status : r.detail || "no answer") : "answered"))].join(", "),
      });
      await witness.apply(results, { at, dispatches: nightly.attempts() });
      return { busy: step.busy, results, step };
    },
    async chainFailed({ at, chained }) {
      await witness.raiseNow("chain", {
        id: "chain", status: "breach",
        detail: `The loop reached the end of its time budget at ${etTime(at)} and could not dispatch its successor: ` +
          `${chained.why}${chained.status ? " (HTTP " + chained.status + ")" : ""}${chained.attempts ? " after " + chained.attempts + " attempt(s)" : ""}.`,
      }, { at });
    },
    summary: () => witness.summary(),
  };
}

export async function witnessDrill({ env = process.env, fetchImpl = fetch, now = Date.now, log = console.log,
  warn = console.warn } = {}) {
  const reporter = createIssueReporter({ env, fetchImpl });
  if (!reporter.enabled) return { ok: false, why: `the job has no usable token (${reporter.why})` };
  const witness = createWitness({ reporter, env, log, warn });
  const at = now();
  await witness.start();
  await witness.raiseNow("drill", { id: "drill", status: "breach",
    detail: "This is a drill: the live workflow was dispatched with drill ticked, to prove that it can open and close an issue." }, { at });
  const opened = witness.summary().issues.drill;
  if (!Number.isInteger(opened)) return { ok: false, why: "the issue could not be opened (see the annotations above)" };
  await witness.clear("drill", { at: now() });
  const closed = !Number.isInteger(witness.summary().issues.drill);
  return closed ? { ok: true, number: opened } : { ok: false, number: opened, why: `issue #${opened} opened but could not be closed` };
}
