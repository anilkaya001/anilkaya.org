import { easternInstant } from "../../shared/flows-freshness.js";
import { runLiveLoop, chainDispatch, chainWithRetry, readLiveClock, liveRunVerdict, liveWindow, LIVE_LOOP } from "./live.mjs";
import { STANDBY, readStandbyTick } from "./starts.mjs";
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
    readOnce: world.readOnce, latestClock: () => body, env, fetchImpl: world.github.fetchImpl, sleep: world.sleep,
    log: (line) => notes.push(line), warn: (line) => notes.push(line),
  });
  const loop = await runLiveLoop({
    now: world.now, sleep: world.sleep, budgetMs, log: () => {}, warn: (line) => notes.push(line), watch,
    readClock: () => readLiveClock(world.readOnce, { seen: (b) => { body = b; }, sleep: world.sleep }),
    pass: async () => {
      world.advance(20000);
      return { skipped: null, answered: 38, landed: 10 };
    },
    chain: ({ at: when }) => chainWithRetry(() => chainDispatch({ env, fetchImpl: world.github.fetchImpl, at: when }),
      { sleep: world.sleep }),
  });
  return { loop, verdict: liveRunVerdict(loop) };
}

const LOST = Symbol("runner-lost");

async function driveRuns(world, { budgetMs, notes, until, lostMs, deathAt = () => Infinity }) {
  const group = world.github.queue;
  let run = group.start({ origin: "chain", tick: new Date(world.now()).toISOString() }, world.now());
  const runs = [];
  while (run) {
    const env = { ...world.env(), FLOWS_LIVE_ORIGIN: run.inputs.origin, FLOWS_LIVE_TICK: run.inputs.tick || "" };
    const dies = deathAt(run, runs.length);
    let body = null;
    let ticks = 0;
    const watch = createWatch({
      readOnce: world.readOnce, latestClock: () => body, env, fetchImpl: world.github.fetchImpl, sleep: world.sleep,
      log: (line) => notes.push(line), warn: (line) => notes.push(line),
    });
    const counted = { ...watch, tick: (args) => { ticks++; return watch.tick(args); } };
    const sleep = async (ms) => {
      if (world.now() + ms >= dies) {
        world.advance(Math.max(0, dies - world.now()));
        throw LOST;
      }
      return world.sleep(ms);
    };
    let loop = null;
    try {
      loop = await runLiveLoop({
        now: world.now, sleep, budgetMs, log: () => {}, warn: (line) => notes.push(line), watch: counted,
        readClock: () => readLiveClock(world.readOnce, { seen: (b) => { body = b; }, sleep: world.sleep }),
        pass: async () => {
          world.advance(20000);
          return { skipped: null, answered: 38, landed: 10 };
        },
        chain: ({ at: when }) => chainWithRetry(() => chainDispatch({ env, fetchImpl: world.github.fetchImpl, at: when }),
          { sleep: world.sleep }),
      });
    } catch (error) {
      if (error !== LOST) throw error;
    }
    const summary = watch.summary();
    runs.push({
      id: run.id, origin: run.inputs.origin, tick: run.inputs.tick || null, startedAt: run.startedAt, endedAt: world.now(),
      died: !loop, ticks, loop, standby: summary.standby, open: summary.open,
      verdict: loop ? liveRunVerdict(loop) : { failed: true, why: "the runner was lost" },
    });
    if (!loop) world.advance(lostMs);
    run = world.now() < until ? group.finish(world.now()) : null;
  }
  const last = runs[runs.length - 1];
  const red = runs.filter((r) => r.verdict.failed);
  return {
    runs,
    loop: { exit: last.died ? "lost" : last.loop.exit, passes: runs.flatMap((r) => (r.loop ? r.loop.passes : [])),
      ticks: runs.reduce((n, r) => n + r.ticks, 0) },
    verdict: { failed: red.length > 0, why: red.map((r) => `run ${r.id}: ${r.verdict.why}`).join("; ") || null },
  };
}

const pipelineSends = (world) => world.github.record.dispatches.filter((d) => d.workflow === "flows-pipeline.yml");
const liveSends = (world) => world.github.record.dispatches.filter((d) => d.workflow === "flows-live.yml");
const standbySends = (world) => liveSends(world).filter((d) => d.inputs && d.inputs.origin === STANDBY.origin);
const chainSends = (world) => liveSends(world).filter((d) => !d.inputs || d.inputs.origin !== STANDBY.origin);
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
      const standbys = standbySends(w);
      if (standbys.length !== 1 || liveWindow(standbys[0].at, null).run || standbys[0].at > at(17, 30)) {
        problems.push(`expected one standby on the first tick after the Tier 2 window, saw ${standbys.map((d) => etTime(d.at)).join(", ") || "none"}`);
      }
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
    name: "GitHub fails the nightly dispatch for two hours (503, then no answer): it is retried every half hour and lands before 21:00 ET",
    world: () => fakeWorld({ day: DRY_DAY, start: at(17, 0), github: {
      dispatchStatus: (when) => (when < at(18, 30) ? 503 : when < at(19, 30) ? 0 : 204) } }),
    budgetMs: 5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const sends = pipelineSends(w);
      const seen = sends.map((s) => s.status).join();
      if (seen !== "503,503,503,503,0,0,204") problems.push(`the dispatch answers were ${seen}, not 503 x4, then no answer x2, then 204`);
      if (w.landedAt() === null || w.landedAt() >= at(21, 0)) problems.push("the nightly did not land before 21:00 ET");
      if (sends.some((s) => s.at > at(20, 30))) problems.push("a dispatch went out after 20:30 ET");
      if (w.github.record.created.length) problems.push("a nightly that landed at 20:00 ET opened an issue");
      if (r.verdict.failed) problems.push(`the run was red: ${r.verdict.why}`);
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
    name: "the clock read is challenged for three ticks while every other read answers: the witness keeps its last good clock, still reads Tier 1 and Tier 2, and opens nothing",
    world: () => fakeWorld({ day: DRY_DAY, start: at(10, 30), clockFail: [[at(11, 0), at(11, 14)]] }),
    budgetMs: 1.5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const during = w.stat.reads.filter((x) => x.at >= at(11, 0) && x.at < at(11, 15));
      const count = (key) => during.filter((x) => x.key === key).length;
      if (count("clock") !== 6) problems.push(`the clock was read ${count("clock")} time(s) while challenged, not twice (a try and its retry) on each of three ticks`);
      for (const key of ["live:market", "live:focus", "live:breadth"]) {
        if (count(key) !== 3) problems.push(`${key} was read ${count(key)} time(s) while the clock was challenged, not once a tick`);
      }
      if (w.github.record.created.length) problems.push(`a challenged clock opened ${w.github.record.created.map((c) => c.title).join("; ")}`);
      if (r.verdict.failed) problems.push(`the run was red: ${r.verdict.why}`);
      return problems;
    },
  },
  {
    name: "an evening after the nightly landed, the clock read is challenged once on each of three idle ticks: its retry answers, and nothing opens",
    world: () => fakeWorld({ day: DRY_DAY, start: at(18, 30), landAt: at(17, 45), clockFlaky: [[at(19, 0), at(19, 40)]] }),
    budgetMs: 2 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const during = w.stat.reads.filter((x) => x.at >= at(19, 0) && x.at <= at(19, 40));
      const clock = during.filter((x) => x.key === "clock").length;
      if (clock !== 6) problems.push(`the clock was read ${clock} time(s) over three challenged idle ticks, not twice a tick (a try and its retry)`);
      const other = during.filter((x) => x.key !== "clock").map((x) => x.key);
      if (other.length) problems.push(`the idle evening read ${[...new Set(other)].join(", ")} beside the clock`);
      if (w.github.record.created.length) problems.push(`a clock read that its retry answered opened ${w.github.record.created.map((c) => c.title).join("; ")}`);
      if (r.verdict.failed) problems.push(`the run was red: ${r.verdict.why}`);
      return problems;
    },
  },
  {
    name: "every read is challenged for three ticks: each is tried twice, and the probe still opens on the third",
    world: () => fakeWorld({ day: DRY_DAY, start: at(9, 50), readFail: [[at(10, 0), at(10, 14)]] }),
    budgetMs: 1.5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const made = issueOf(w, "probe");
      if (!made) return ["no probe issue was opened"];
      if (w.github.record.created.length !== 1) problems.push(`expected only the probe issue, saw ${w.github.record.created.map((c) => c.title).join("; ")}`);
      if (made.at < at(10, 10) || made.at >= at(10, 15)) problems.push(`the probe issue opened at ${etTime(made.at)}, not on the third challenged tick`);
      const market = w.stat.reads.filter((x) => x.key === "live:market" && x.at >= at(10, 0) && x.at < at(10, 15)).length;
      if (market !== 6) problems.push(`live:market was read ${market} time(s) over three challenged ticks, not twice a tick`);
      const clock = w.stat.reads.filter((x) => x.key === "clock" && x.at >= at(10, 0) && x.at < at(10, 15)).length;
      if (clock !== 6) problems.push(`the loop's clock read was made ${clock} time(s) over three ticks, not twice a tick (a try and its retry)`);
      if (!w.github.record.closed.length) problems.push("the probe issue was not closed when reads returned");
      return problems;
    },
  },
  {
    name: "an intermittent feed (live:focus down half of every hour): one issue, reopened on each flap rather than one issue per flap",
    world: () => fakeWorld({ day: DRY_DAY, start: at(9, 20), focusDown: [10, 11, 12, 13, 14].map((h) => [at(h, 0), at(h, 30)]) }),
    budgetMs: 6.5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const record = w.github.record;
      if (record.created.length !== 1) problems.push(`${record.created.length} issues were opened, not one`);
      if (record.reopened.length < 3) problems.push(`the issue was reopened ${record.reopened.length} time(s), not on each flap`);
      if (record.closed.length < 4) problems.push(`the issue was closed ${record.closed.length} time(s), not after each outage`);
      if (record.closed.some((c) => record.reopened.some((o) => o.at > c.at && o.at - c.at < 15 * 60 * 1000))) {
        problems.push("an issue was reopened within 15 minutes of its close");
      }
      if (!r.verdict.failed) problems.push("the run stayed green through confirmed lapses");
      return problems;
    },
  },
  {
    name: "Tier 2 stops publishing while its passes run: breadth goes 45 minutes old, one issue, closed once it returns",
    world: () => fakeWorld({ day: DRY_DAY, start: at(9, 20), breadthDown: [[at(10, 50), at(12, 30)]] }),
    budgetMs: 4.5 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const made = issueOf(w, "tier2");
      if (!made) return ["no tier2 issue was opened"];
      if (w.github.record.created.length !== 1) problems.push(`expected one issue, saw ${w.github.record.created.length}`);
      if (made.at < at(11, 31) || made.at > at(11, 45)) problems.push(`the issue opened at ${etTime(made.at)}, not within 45 to 60 minutes of the last write`);
      const closed = w.github.record.closed.find((c) => c.number === made.number);
      if (!closed || closed.at < at(12, 30)) problems.push("the issue was not closed after breadth returned");
      if (!r.verdict.failed) problems.push("the run stayed green through a confirmed lapse");
      return problems;
    },
  },
  {
    name: "one pending answer from meta on a hop's first tick, and a meta that stays pending for an hour of the evening",
    world: () => fakeWorld({ day: DRY_DAY, start: at(10, 2), metaPending: [[at(10, 0), at(10, 4)], [at(17, 40), at(18, 40)]] }),
    budgetMs: 9 * HOUR,
    expect: (r, w) => {
      const problems = [];
      const made = w.github.record.created.filter((c) => c.title.startsWith("[flows-witness:nightly]"));
      if (made.length !== 1) return [`${made.length} nightly issues opened, not one (the first pending answer must open none, the hour-long one exactly one)`];
      if (made[0].at < at(17, 40)) problems.push("the single pending answer at 10:02 ET opened an issue");
      if (!/answered pending/.test(made[0].body)) problems.push("the issue does not say the store answered pending");
      if (!w.github.record.closed.length) problems.push("the issue was not closed when meta was readable again");
      return problems;
    },
  },
  {
    name: "the nightly lands after midnight: the issue opened at 21:00 ET is closed within a tick of it",
    world: () => fakeWorld({ day: DRY_DAY, start: at(21, 30), landOnDispatch: Infinity, landAt: at(24, 20) }),
    budgetMs: 4 * HOUR,
    expect: (r, w) => {
      const problems = [];
      if (!issueOf(w, "nightly")) return ["no nightly issue was opened"];
      const closed = w.github.record.closed[0];
      if (!closed) problems.push("the issue stayed open after the nightly landed at 00:20 ET");
      else if (closed.at < at(24, 20) || closed.at > at(24, 40)) problems.push(`the issue closed at ${etTime(closed.at)}, not within a tick of 00:20 ET`);
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
      if (calls.length !== 3) problems.push(`GitHub was called ${calls.length} times (${calls.join(", ")}), not three times (the open-issue list, the standby and the chain)`);
      if (standbySends(w).length !== 1 || standbySends(w)[0].at !== at(12, 0, DRY_WEEKEND)) problems.push("the standby was not sent on the first tick");
      if (r.loop.exit !== "budget" || !r.loop.chained.sent) problems.push("the loop did not hand over at its budget");
      return problems;
    },
  },
  {
    name: "the runner is lost at 02:00 ET on a Saturday: the standby pending behind the loop replaces it at once, and the next hand-over replaces the standby",
    world: () => fakeWorld({ day: DRY_WEEKEND, start: at(0, 30, DRY_WEEKEND) }),
    budgetMs: LIVE_LOOP.budgetMs,
    runs: { until: at(10, 0, DRY_WEEKEND), lostMs: 10 * 60 * 1000, deathAt: (run, i) => (i === 0 ? at(2, 0, DRY_WEEKEND) : Infinity) },
    expect: (r, w) => {
      const problems = [];
      const [lost, standby, next] = r.runs;
      if (r.runs.length !== 3) return [`expected three runs (the lost one, its standby, the standby's hand-over), saw ${r.runs.length}`];
      if (!lost.died || lost.endedAt !== at(2, 0, DRY_WEEKEND)) problems.push("the first runner was not lost at 02:00 ET");
      if (standby.origin !== STANDBY.origin || standby.startedAt !== at(2, 10, DRY_WEEKEND)) {
        problems.push(`the successor was ${standby.origin} at ${etTime(standby.startedAt)}, not the standby the moment GitHub let the lost job go (02:10 ET)`);
      }
      if (!standby.standby.crash || standby.standby.crashes.length !== 1) problems.push("the standby did not count itself a crash restart");
      if (standby.died || standby.loop.exit !== "budget" || !standby.loop.chained.sent) problems.push("the standby did not run to its own hand-over");
      if (next.origin !== "chain" || next.startedAt !== standby.endedAt || next.standby.crash) problems.push("the standby's hand-over did not start the next run at once");
      const cancelled = w.github.record.cancelled;
      const handovers = chainSends(w).map((d) => d.at);
      const sent = readStandbyTick(cancelled.length ? cancelled[0].inputs.tick : null);
      if (cancelled.length !== 2 || cancelled.some((c) => c.inputs.origin !== STANDBY.origin || !handovers.includes(c.cancelledAt)) ||
          !sent || sent.from !== standby.startedAt || sent.crashes.join() !== String(standby.startedAt)) {
        problems.push("each standby a live loop left pending was not replaced by that loop's own hand-over (one running, one pending, newest wins), " +
          "or the restarted loop's standby did not carry its start and its crash");
      }
      const standbys = standbySends(w);
      if (standbys.length !== 3 || standbys.some((d, i) => d.at !== r.runs[i].startedAt)) problems.push(`expected one standby on each run's first tick, saw ${standbys.length}`);
      if (w.github.record.created.length) problems.push(`one lost runner opened ${w.github.record.created.map((c) => c.title).join("; ")}`);
      return problems;
    },
  },
  {
    name: "a crash loop: every run dies 20 minutes in, and the third crash restart within six hours sends no standby and raises chain",
    world: () => fakeWorld({ day: DRY_WEEKEND, start: at(1, 0, DRY_WEEKEND) }),
    budgetMs: LIVE_LOOP.budgetMs,
    runs: { until: at(12, 0, DRY_WEEKEND), lostMs: 10 * 60 * 1000, deathAt: (run) => run.startedAt + 20 * 60 * 1000 },
    expect: (r, w) => {
      const problems = [];
      const starts = r.runs.map((x) => `${x.origin} ${etTime(x.startedAt)}`).join(", ");
      if (r.runs.length !== 4) return [`expected four runs (the first and three crash restarts), saw ${starts}`];
      if (r.runs.slice(1).some((x) => x.origin !== STANDBY.origin || !x.standby.crash)) problems.push(`the restarts were ${starts}, not three crash-restarted standbys`);
      if (r.runs.map((x) => x.standby.crashes.length).join() !== "0,1,2,3") problems.push("the crash count was not carried from each standby to the next");
      if (!r.runs[3].standby.stoodDown || r.runs.slice(0, 3).some((x) => x.standby.stoodDown)) problems.push("the third crash restart did not stand the standby down");
      if (standbySends(w).length !== 3 || standbySends(w).some((d) => d.at >= r.runs[3].startedAt)) problems.push(`expected three standbys and none from the third crash restart, saw ${standbySends(w).length}`);
      const made = w.github.record.created;
      if (made.length !== 1 || !made[0].title.startsWith("[flows-witness:chain]") || made[0].at !== r.runs[3].startedAt ||
          !/restarted from its standby 3 times in the last 6 hours/.test(made[0].body)) {
        problems.push(`expected one chain issue opened on the third crash restart's first tick, saw ${made.map((c) => c.title + " at " + etTime(c.at)).join("; ") || "none"}`);
      }
      if (w.github.queue.running() || w.github.queue.pending() || w.github.record.closed.length) problems.push("something restarted the loop after the stand-down, or the chain issue closed");
      if (!r.verdict.failed) problems.push("the crash loop stayed green");
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
    const run = scenario.runs
      ? await driveRuns(world, { budgetMs: scenario.budgetMs, notes, ...scenario.runs })
      : await drive(world, { budgetMs: scenario.budgetMs, notes });
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
