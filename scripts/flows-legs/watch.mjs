import { phaseAt, LIVE_CLOCK } from "../../shared/flows-freshness.js";
import {
  WITNESS, witnessView, evaluateTier1, evaluateNightly, createWitness, createIssueReporter, sessionOf,
} from "./witness.mjs";
import { createNightlyStart, NIGHTLY } from "./starts.mjs";
import { etTime } from "./health.mjs";

const withDeadline = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ failed: true, status: 0, detail: "timeout" }), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); resolve({ failed: true, status: 0, detail: error && error.message ? error.message : String(error) }); });
});

export function normalizeRead(read) {
  if (!read || read.failed) return { failed: true, status: read && read.status ? read.status : 0, detail: read && read.detail ? read.detail : null };
  if (read.absent || read.payload === null || read.payload === undefined) return { pending: true };
  return { ok: true, payload: read.payload };
}

export function tier1Window(at, view) {
  if (!view || (view.tier1 && view.tier1.why === "off")) return false;
  const p = phaseAt(at, view.clock);
  return !!p && p.trading && at >= p.open && at <= p.close + LIVE_CLOCK.tier1AfterCloseMin * 60000;
}

export function createWatch({ readOnce, latestClock, env = process.env, fetchImpl = fetch, reporter = null,
  readDeadlineMs = WITNESS.readDeadlineMs, log = console.log, warn = console.warn } = {}) {
  const witness = createWitness({ reporter: reporter || createIssueReporter({ env, fetchImpl }), env, log, warn });
  const nightly = createNightlyStart({ env, fetchImpl, log, warn });
  const state = { landed: null };
  const read = async (key) => normalizeRead(await withDeadline(Promise.resolve().then(() => readOnce(key)), readDeadlineMs));

  return {
    async tick({ at, clock = null, first = false }) {
      if (first) {
        await witness.start();
        await witness.clear("chain", { at });
      }
      const view = witnessView(latestClock());
      const wclock = view ? view.clock : clock;
      const p = phaseAt(at, wclock);
      const inTier1 = tier1Window(at, view);
      const landedToday = !!p && !!state.landed && state.landed.day === p.day;
      const wantMeta = first || witness.isOpen("nightly") ||
        (!!p && p.trading && p.minutes >= NIGHTLY.atMin && !landedToday);
      const [market, focus, meta] = await Promise.all([
        inTier1 ? read("live:market") : null,
        inTier1 ? read("live:focus") : null,
        wantMeta ? read("meta") : null,
      ]);
      let metaSession = meta && meta.ok ? sessionOf(meta.payload) : meta && meta.pending ? null : undefined;
      if (p && typeof metaSession === "string" && metaSession >= p.day) state.landed = { day: p.day, session: metaSession };
      else if (metaSession === undefined && landedToday) metaSession = state.landed.session;
      const step = await nightly.step({ at, clock: wclock, metaSession });
      const results = [];
      if (inTier1) results.push(evaluateTier1({ at, view, market, focus }));
      if (meta) results.push(evaluateNightly({ at, view, meta }));
      const reads = [market, focus, meta].filter(Boolean);
      const seen = !!view || reads.some((r) => !r.failed);
      results.push({
        id: "probe", status: seen ? "ok" : "breach",
        detail: `nothing could be read through the ingest route at ${etTime(at)}: ` +
          `${reads.map((r) => (r.failed ? (r.status ? "HTTP " + r.status : r.detail || "no answer") : "answered")).join(", ") || "the clock read failed"}`,
      });
      await witness.apply(results, { at, dispatches: nightly.attempts() });
      return { busy: step.busy, wakeAt: step.wakeAt, results, step };
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
