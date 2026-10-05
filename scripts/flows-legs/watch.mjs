import { phaseAt, LIVE_CLOCK, easternDay } from "../../shared/flows-freshness.js";
import {
  WITNESS, witnessView, evaluateTier1, evaluateTier2, evaluateNightly, createWitness, createIssueReporter, sessionOf,
} from "./witness.mjs";
import { createNightlyStart, createStandby, NIGHTLY, STANDBY } from "./starts.mjs";
import { readWithRetry, WATCH_RETRY, challenged, LIVE_LOOP } from "./live.mjs";
import { etTime } from "./health.mjs";

export function normalizeRead(read) {
  if (!read || read.failed) return { failed: true, status: read && read.status ? read.status : 0, detail: read && read.detail ? read.detail : null };
  if (read.absent || read.payload === null || read.payload === undefined) return { pending: true };
  return { ok: true, payload: read.payload };
}

export { WATCH_RETRY, challenged };

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
  const standby = createStandby({ env, fetchImpl, log, warn });
  const state = { landed: null };
  const read = async (key) => normalizeRead(await readWithRetry(readOnce, key, { deadlineMs: readDeadlineMs, retryMs, sleep }));

  return {
    async tick({ at, clock = null, clockRead = null, first = false, startedAt = null, budgetMs = LIVE_LOOP.budgetMs }) {
      if (first) {
        await witness.start();
        const begun = standby.begin({ startedAt: Number.isFinite(startedAt) ? startedAt : at, budgetMs });
        if (begun.stoodDown) {
          await witness.raiseNow("chain", {
            id: "chain", status: "breach",
            detail: `The live loop has restarted from its standby ${begun.crashes.length} times in the last ` +
              `${STANDBY.crashWindowMs / 3600000} hours (${begun.crashes.map((t) => etTime(t)).join(", ")}), each more than ` +
              `${STANDBY.crashSlackMs / 60000} minutes before the loop that sent it was due to hand over, so each of those loops ` +
              "died without handing over: a lost runner, a killed process or a crash. This loop sends no standby, so when it dies " +
              "too nothing restarts it until its own hand-over at the end of its budget or a GitHub starter. Read the failed " +
              "flows-live runs before it for how each ended.",
          }, { at });
        } else await witness.clear("chain", { at });
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
      const stood = await standby.step({ at, clock: wclock });
      const results = [];
      if (inTier1) results.push(evaluateTier1({ at, view, market, focus }));
      if (inTier2) results.push(evaluateTier2({ at, view, breadth }));
      if (meta) results.push(evaluateNightly({ at, view, meta }));
      const reads = [market, focus, breadth, meta].filter(Boolean);
      const seen = clockFresh || reads.some((r) => !r.failed);
      results.push({
        id: "probe", status: seen ? "ok" : "breach",
        detail: `nothing could be read through the ingest route at ${etTime(at)} (the clock read and each challenged key read are tried twice): ` +
          [clockFresh ? "the clock answered" : "the clock read failed",
            ...reads.map((r) => (r.failed ? (r.status ? "HTTP " + r.status : r.detail || "no answer") : "answered"))].join(", "),
      });
      await witness.apply(results, { at, dispatches: nightly.attempts() });
      return { busy: step.busy, results, step, standby: stood };
    },
    async chainFailed({ at, chained }) {
      await witness.raiseNow("chain", {
        id: "chain", status: "breach",
        detail: `The loop reached the end of its time budget at ${etTime(at)} and could not dispatch its successor: ` +
          `${chained.why}${chained.status ? " (HTTP " + chained.status + ")" : ""}${chained.attempts ? " after " + chained.attempts + " attempt(s)" : ""}.`,
      }, { at });
    },
    async loopHung({ at, why, what, ms, said = `did not finish within ${ms / 1000} s`, chained }) {
      const status = chained.status ? " (HTTP " + chained.status + ")" : "";
      const tries = chained.attempts ? " after " + chained.attempts + " attempt(s)" : "";
      const handed = chained.sent
        ? `dispatched its successor${status}`
        : `could not dispatch its successor: ${chained.why}${status}${tries}. Nothing restarts the loop until a GitHub starter ` +
          "arrives, because the Worker's watchdog re-dispatches only when it holds GITHUB_DISPATCH_TOKEN";
      const still = " While each successor's first pass hangs too, this issue stays open; the first watch tick of a loop whose " +
        "pass finishes closes it.";
      const cause = why === "pass-idle"
        ? "Every vendor call carries a 20 s deadline and settles inside it, so a vendor that is slow or timing out never does " +
          "this: something without a deadline stalled (an ingest request, the credential request or the runner)." + still
        : why === "pass-deadline"
          ? "The pass was still settling calls at its ceiling. Only a pass in which nearly every vendor call times out comes " +
            "close to it, so the run's `vendor request(s) timed out` count says which: near the pass's call count, the vendor " +
            "stalled; small, the pass was looping." + still
          : "The watch's own reads or GitHub calls stalled; the next loop's first watch tick closes this issue.";
      await witness.raiseNow("chain", {
        id: "chain", status: "breach",
        detail: `${what[0].toUpperCase()}${what.slice(1)} of the live loop ${said} at ` +
          `${etTime(at)}, so the loop abandoned it, ${handed}, and exited red to free the concurrency group. ${cause}`,
      }, { at });
    },
    summary: () => ({ ...witness.summary(), standby: standby.state() }),
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
