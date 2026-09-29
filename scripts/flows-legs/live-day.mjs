import { easternInstant } from "../../shared/flows-freshness.js";
import { runLiveLoop, chainDispatch, chainWithRetry, readLiveClock, liveRunVerdict, LIVE_LOOP } from "./live.mjs";
import { createWatch } from "./watch.mjs";
import { fakeWorld } from "./live-world-fake.mjs";
import { etTime } from "./health.mjs";

export const DRY_DAY = "2026-09-29";
export const DRY_WEEKEND = "2026-10-03";

const at = (h, m, day = DRY_DAY) => easternInstant(day, h * 60 + m);
const HOUR = 60 * 60 * 1000;

async function drive(world, { budgetMs, notes }) {
  const env = world.env();
  let body = null;
  const watch = createWatch({
    readOnce: world.readOnce, latestClock: () => body, env, fetchImpl: world.github.fetchImpl,
    log: (line) => notes.push(line), warn: (line) => notes.push(line),
  });
  const loop = await runLiveLoop({
    now: world.now, sleep: world.sleep, budgetMs, log: () => {}, warn: (line) => notes.push(line), watch,
    readClock: () => readLiveClock(world.readOnce, { seen: (b) => { body = b; } }),
    pass: async () => {
      world.advance(20000);
      return { skipped: null, answered: 38, landed: 10 };
    },
    chain: ({ at: when }) => chainWithRetry(() => chainDispatch({ env, fetchImpl: world.github.fetchImpl, at: when }),
      { sleep: world.sleep }),
  });
  return { loop, verdict: liveRunVerdict(loop) };
}

const pipelineSends = (world) => world.github.record.dispatches.filter((d) => d.workflow === "flows-pipeline.yml");
const chainSends = (world) => world.github.record.dispatches.filter((d) => d.workflow === "flows-live.yml");
const issueOf = (world, id) => world.github.record.created.find((c) => c.title.startsWith(`[flows-witness:${id}]`)) || null;
const minutesOf = (ms, day = DRY_DAY) => Math.round((ms - easternInstant(day, 0)) / 60000);

export const DRY_SCENARIOS = Object.freeze([
  {
    name: "a healthy afternoon: the loop dispatches the nightly at 17:30 ET and watches it land",
    world: () => fakeWorld({ day: DRY_DAY, start: at(15, 50) }),
    budgetMs: 8 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const sends = pipelineSends(w);
      if (sends.length !== 1) problems.push(`expected one nightly dispatch, saw ${sends.length}`);
      else {
        if (minutesOf(sends[0].at) !== 17 * 60 + 30) problems.push(`the nightly went at ${etTime(sends[0].at)}, not 17:30 ET`);
        if (!sends[0].inputs || sends[0].inputs.origin !== "live-loop" || Object.keys(sends[0].inputs).length !== 1) {
          problems.push(`the nightly's inputs were ${JSON.stringify(sends[0].inputs)}, not just origin live-loop`);
        }
        if (sends[0].status !== 204) problems.push("the nightly dispatch was not accepted");
      }
      if (r.verdict.failed) problems.push(`the run was red: ${r.verdict.why}`);
      if (w.github.record.created.length) problems.push("a healthy day opened an issue");
      if (chainSends(w).length !== 1) problems.push(`expected one chain dispatch, saw ${chainSends(w).length}`);
      if (r.loop.passes.length !== 8) problems.push(`expected 8 passes from 15:50 to 16:25, saw ${r.loop.passes.length}`);
      return problems;
    },
  },
  {
    name: "Tier 1 stops at 11:00 ET and returns at 12:10: one issue opens, then closes itself",
    world: () => fakeWorld({ day: DRY_DAY, start: at(9, 20), tier1Down: [[at(11, 0), at(12, 10)]] }),
    budgetMs: 3.5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const made = issueOf(w, "tier1");
      if (!made) return ["no tier1 issue was opened"];
      if (w.github.record.created.length !== 1) problems.push(`expected one issue, saw ${w.github.record.created.length}`);
      const lag = (made.at - at(11, 0)) / 60000;
      if (!(lag >= 25 && lag <= 40)) problems.push(`the issue opened ${lag.toFixed(0)} min after the stall, not within 25 to 40`);
      if (!/@anilkaya001/.test(made.body)) problems.push("the issue does not mention the owner");
      const closed = w.github.record.closed.find((c) => c.number === 100);
      if (!closed) problems.push("the issue was not closed on recovery");
      else if (closed.at < at(12, 10)) problems.push("the issue closed before Tier 1 returned");
      if (!r.verdict.failed) problems.push("the run stayed green through a confirmed lapse");
      return problems;
    },
  },
  {
    name: "the nightly never lands: two dispatches, then an issue at 21:00 ET",
    world: () => fakeWorld({ day: DRY_DAY, start: at(17, 0), landOnDispatch: Infinity }),
    budgetMs: 5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const sends = pipelineSends(w);
      const stamps = sends.map((s) => minutesOf(s.at));
      if (stamps.join() !== [17 * 60 + 30, 18 * 60 + 15].join()) problems.push(`dispatches at ${sends.map((s) => etTime(s.at)).join(", ")}, not 17:30 and 18:15`);
      const made = issueOf(w, "nightly");
      if (!made) return [...problems, "no nightly issue was opened"];
      const opened = minutesOf(made.at);
      if (!(opened >= 21 * 60 && opened <= 21 * 60 + 5)) problems.push(`the issue opened at ${etTime(made.at)}, not within five minutes of 21:00 ET`);
      if (!/sent \(HTTP 204\)/.test(made.body)) problems.push("the issue does not list the loop's dispatches");
      if (!r.verdict.failed) problems.push("the run stayed green with the nightly missing");
      return problems;
    },
  },
  {
    name: "GitHub refuses the nightly dispatch: it is retried, then the 21:00 ET issue says so",
    world: () => fakeWorld({ day: DRY_DAY, start: at(17, 0), github: { dispatchStatus: 403 } }),
    budgetMs: 5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const sends = pipelineSends(w);
      if (sends.length !== 4 || sends.some((s) => s.status !== 403)) problems.push(`expected four refused attempts, saw ${sends.map((s) => s.status).join(", ")}`);
      const made = issueOf(w, "nightly");
      if (!made) return [...problems, "no nightly issue was opened"];
      if (!/refused \(HTTP 403\)/.test(made.body)) problems.push("the issue does not say the dispatch was refused");
      return problems;
    },
  },
  {
    name: "the chain dispatch is refused: three tries, then an issue that says nothing keeps the loop alive",
    world: () => fakeWorld({ day: DRY_DAY, start: at(12, 0), github: { chainStatus: 403 } }),
    budgetMs: 30 * 60 * 1000,
    expect: (r, w) => {
      const problems = [];
      if (chainSends(w).length !== 3) problems.push(`expected three chain attempts, saw ${chainSends(w).length}`);
      if (!issueOf(w, "chain")) problems.push("no chain issue was opened");
      if (!r.verdict.failed) problems.push("the run stayed green after its chain broke");
      return problems;
    },
  },
  {
    name: "the ingest route goes dark for an hour: the witness says it cannot see, then recovers",
    world: () => fakeWorld({ day: DRY_DAY, start: at(9, 20), readFail: [[at(10, 0), at(11, 0)]] }),
    budgetMs: 2 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const made = issueOf(w, "probe");
      if (!made) return ["no probe issue was opened"];
      if (issueOf(w, "tier1") || issueOf(w, "nightly")) problems.push("a read failure was taken for a freshness verdict");
      if (!w.github.record.closed.length) problems.push("the probe issue was not closed when reads returned");
      return problems;
    },
  },
  {
    name: "a weekend afternoon: no pass, no vendor call, one clock read per quarter hour and one meta read at the start",
    world: () => fakeWorld({ day: DRY_WEEKEND, start: at(12, 0, DRY_WEEKEND), tier1Down: [] }),
    budgetMs: LIVE_LOOP.budgetMs,
    expect: (r, w) => {
      const problems = [];
      if (r.loop.passes.length) problems.push(`${r.loop.passes.length} pass(es) on a Saturday`);
      const asked = w.stat.reads.map((x) => x.key);
      const other = asked.filter((k) => k !== "clock");
      if (other.join() !== "meta") problems.push(`read ${[...new Set(other)].join(", ") || "nothing"} beside the clock on a Saturday, not meta once at the start`);
      if (asked.filter((k) => k === "clock").length !== r.loop.ticks) problems.push("the clock was not read exactly once a tick");
      const calls = w.github.record.calls.map((c) => c.method + " " + c.path.split("/").pop());
      if (calls.length !== 2) problems.push(`GitHub was called ${calls.length} times (${calls.join(", ")}), not twice (the open-issue list and the chain)`);
      if (r.loop.exit !== "budget" || !r.loop.chained.sent) problems.push("the loop did not hand over at its budget");
      return problems;
    },
  },
  {
    name: "overnight into the open: the first pass is at 09:31 ET sharp, with no starter",
    world: () => fakeWorld({ day: DRY_DAY, start: at(4, 0) }),
    budgetMs: LIVE_LOOP.budgetMs,
    expect: (r, w) => {
      const problems = [];
      if (!r.loop.passes.length) return ["no pass ran"];
      const firstRead = w.stat.reads.find((x) => x.at >= at(9, 30));
      if (!firstRead || minutesOf(firstRead.at) !== 9 * 60 + 31) problems.push(`the first read inside the session was at ${firstRead ? etTime(firstRead.at) : "never"}, not 09:31 ET`);
      if (w.github.record.created.length) problems.push("a healthy morning opened an issue");
      return problems;
    },
  },
]);

export async function dryLiveDay({ log = console.log, warn = console.warn, scenarios = DRY_SCENARIOS } = {}) {
  const results = [];
  const problems = [];
  for (const scenario of scenarios) {
    const world = scenario.world();
    const notes = [];
    const run = await drive(world, { budgetMs: scenario.budgetMs, notes });
    const found = scenario.expect(run, world);
    const record = world.github.record;
    const summary = {
      name: scenario.name, exit: run.loop.exit, passes: run.loop.passes.length, ticks: run.loop.ticks,
      nightlyDispatches: pipelineSends(world).map((d) => ({ at: d.at, status: d.status, inputs: d.inputs })),
      chainDispatches: chainSends(world).map((d) => ({ at: d.at, status: d.status })),
      issues: record.created.map((c) => ({ number: c.number, title: c.title, at: c.at })),
      comments: record.comments.length, closed: record.closed.length,
      reads: world.stat.reads.length, githubCalls: record.calls.length,
      failed: run.verdict.failed, why: run.verdict.why, problems: found,
    };
    results.push({ ...summary, world, notes });
    log(`live day (dry run): ${scenario.name}`);
    log(`  ${summary.passes} pass(es), ${summary.ticks} watch tick(s), exit ${summary.exit}; nightly dispatches ` +
      `${summary.nightlyDispatches.length ? summary.nightlyDispatches.map((d) => etTime(d.at) + " " + d.status).join(", ") : "none"}; ` +
      `chain ${summary.chainDispatches.map((d) => d.status).join(", ") || "none"}; ` +
      `issues ${summary.issues.map((i) => "#" + i.number).join(", ") || "none"} (${summary.comments} comment(s), ${summary.closed} closed); ` +
      `${summary.reads} store read(s), ${summary.githubCalls} GitHub call(s); run ${summary.failed ? "RED" : "green"}`);
    for (const line of found) {
      warn(`  PROBLEM: ${line}`);
      problems.push(`${scenario.name}: ${line}`);
    }
  }
  return { scenarios: results, problems };
}
