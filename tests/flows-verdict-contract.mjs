import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as W from "../shared/flows-live-worker.js";
import { VERDICT, verdictReprobeUntilMin, tideLastAt } from "../shared/flows-live.js";
import { easternInstant, phaseAt, tier1Due, closeMinutes, inferredEarlyClose, PHASE_MINUTES } from "../shared/flows-freshness.js";
import { fakeLiveVendor, fakeMarketTide } from "../scripts/flows-legs/live-fake.mjs";
import { liveWindow, runLiveLoop, sessionClock } from "../scripts/flows-legs/live.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const MIN = 60000;
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const quiet = { error() {}, warn() {} };

function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
  };
  const D1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; },
        first: async () => exec(sql, st.args).results[0] ?? null,
        all: async () => exec(sql, st.args),
        run: async () => exec(sql, st.args) };
      return st;
    },
    batch: async (list) => {
      db.exec("BEGIN");
      try {
        const out = list.map((s) => exec(s.sql, s.args));
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { D1, db };
}

const prevWeekday = (day) => {
  let d = new Date(Date.parse(day + "T00:00:00Z") - 86400000);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(d.getTime() - 86400000);
  return d.toISOString().slice(0, 10);
};

function world({ day, feed, startMin = 9 * 60 + 31 }) {
  const { D1, db } = sqliteD1();
  W.memoClock(null, 0);
  const env = { DB: D1, UW_API_KEY: "k" };
  let t = easternInstant(day, startMin);
  let nextTick = t;
  const trail = [];
  const calls = [];
  const fetchAt = (at) => async (path, params) => {
    calls.push(at);
    const shown = feed(at);
    return fakeLiveVendor({ session: shown.session, now: shown.now })(path, params, { envelope: true });
  };
  const clockRow = () => {
    const row = db.prepare("SELECT * FROM flows_clock WHERE id = 1").get();
    return row ? W.normalizeClock(row) : null;
  };
  const marketReadAt = () => {
    const row = db.prepare("SELECT read_at FROM flows_live WHERE id = 'live:market'").get();
    return row ? Number(row.read_at) : null;
  };
  const tickAt = async (at) => {
    const before = calls.length;
    W.memoClock(null, 0);
    await W.rthTick(env, at, { fetchVendor: fetchAt(at), log: quiet });
    const c = clockRow();
    trail.push({ at, min: Math.round((at - easternInstant(day, 0)) / MIN), trading: c ? c.trading : null,
      early: c ? c.earlyClose : null, closedDays: c ? c.closedDays : [], calls: calls.length - before, wrote: marketReadAt() === at });
  };
  const runTicksUntil = async (until) => {
    while (nextTick <= until) { const at = nextTick; nextTick += 5 * MIN; await tickAt(at); }
  };
  return {
    db, trail, calls, clockRow, marketReadAt,
    now: () => t,
    sleep: async (ms) => { const to = t + ms; await runTicksUntil(to); t = to; },
    advance: async (ms) => { const to = t + ms; await runTicksUntil(to); t = to; },
    runTo: async (min) => { await runTicksUntil(easternInstant(day, min)); t = Math.max(t, easternInstant(day, min)); },
    readClock: async () => { const c = clockRow(); return c ? sessionClock({ clock: W.clockView(c) }) : null; },
  };
}

const DAYS = { edt: "2026-09-22", est: "2026-11-24", early: "2026-11-20", holiday: "2026-11-26", calendarEarly: "2026-11-27" };

{
  eq(VERDICT.provisionalUntilMin, 11 * 60, "a calendar holiday's verdict stays provisional to 11:00 ET, as before");
  eq(VERDICT.unscheduledUntilMin, 15 * 60 + 45, "and a closure the calendar does not list to 15:45 ET, a quarter hour before the close");
  eq(verdictReprobeUntilMin(DAYS.edt), VERDICT.unscheduledUntilMin, "the deadline is read per day: an ordinary Tuesday gets the long one");
  eq(verdictReprobeUntilMin(DAYS.holiday), VERDICT.provisionalUntilMin, "Thanksgiving the short one");
  eq(verdictReprobeUntilMin("2026-09-26"), VERDICT.provisionalUntilMin, "and a Saturday");
  ok(inferredEarlyClose(DAYS.early, { day: DAYS.early, earlyClose: 1 }) && !inferredEarlyClose(DAYS.early, { day: DAYS.early, earlyClose: null }) &&
     !inferredEarlyClose(DAYS.calendarEarly, { day: DAYS.calendarEarly, earlyClose: 1 }) && !inferredEarlyClose(DAYS.early, { day: "2026-11-19", earlyClose: 1 }) &&
     !inferredEarlyClose(DAYS.early, null),
    "AN INFERRED EARLY CLOSE is the clock's mark on a day the calendar does not list, for that day only");
  const half = { day: DAYS.early, earlyClose: 1 };
  eq(closeMinutes(DAYS.early, half), PHASE_MINUTES.earlyClose, "while the mark stands the phase clock treats the day as closed at 13:00");
  ok(tier1Due(easternInstant(DAYS.early, 15 * 60 + 56), half) && tier1Due(easternInstant(DAYS.early, 16 * 60 + 10), half) &&
     !tier1Due(easternInstant(DAYS.early, 16 * 60 + 11), half),
    "but Tier 1 keeps asking until 16:10 on an inferred day, so a tide that moves again can take the mark back");
  const calendarHalf = { day: DAYS.calendarEarly, earlyClose: 1 };
  ok(tier1Due(easternInstant(DAYS.calendarEarly, 13 * 60 + 10), calendarHalf) && !tier1Due(easternInstant(DAYS.calendarEarly, 13 * 60 + 11), calendarHalf),
    "and stops at 13:10 on a day the calendar lists, where there is nothing to take back");
}

{
  const day = DAYS.edt;
  const prev = prevWeekday(day);
  const closeAt = easternInstant(prev, 16 * 60);
  const firstProbe = 9 * 60 + 46;
  const lastReprobe = (() => { let m = 0; for (let x = firstProbe; x < VERDICT.unscheduledUntilMin; x += 15) m = x; return m; })();
  eq(lastReprobe, 15 * 60 + 31, "the last re-probe tick before 15:45 is 15:31");
  const lagUntil = (R) => (at) => (R !== null && at >= easternInstant(day, R) ? { session: day, now: at } : { session: prev, now: closeAt });
  const recoveries = [];
  for (let m = 9 * 60 + 31; m <= 15 * 60 + 55; m += 5) recoveries.push(m);
  recoveries.push(null);
  const summary = [];
  for (const R of recoveries) {
    const w = world({ day, feed: lagUntil(R) });
    await w.runTo(16 * 60 + 11);
    const ticks = w.trail;
    const label = R === null ? "a vendor that never recovers" : "a vendor that recovers at " + hhmm(R);
    const closedAt = ticks.find((t) => t.trading === 0);
    if (closedAt) ok(closedAt.min >= 10 * 60 + 1, `${label}: the day is never closed before two probes fifteen minutes apart (${hhmm(closedAt.min)})`);
    const reopened = ticks.find((t) => t.trading === 1);
    const reachable = R !== null && R <= lastReprobe;
    if (reachable) {
      const limit = R <= 10 * 60 + 1 ? Math.max(R + 5, firstProbe) : R + 15;
      ok(reopened && reopened.min >= R && reopened.min <= limit,
        `A VENDOR THAT LAGS BUT RECOVERS IS NEVER A LOST DAY: with ${label} Tier 1 reopens the day by ${hhmm(limit)} (${reopened ? hhmm(reopened.min) : "never"})`);
      ok(!reopened.closedDays.includes(day), `${label}: the day leaves the closed list when it reopens`);
      const after = ticks.filter((t) => t.min >= reopened.min && t.min <= 16 * 60 + 6);
      ok(after.every((t) => t.trading === 1 && t.wrote), `${label}: and from then on every tick trades and writes live:market to the close`);
      ok(ticks.filter((t) => t.trading === 0 && t.min > closedAt.min).every((t) => !t.wrote),
        `${label}: nothing was written while the day stood closed, after the tick that closed it`);
    } else {
      ok(!reopened && ticks.at(-1).trading === 0 && ticks.filter((t) => t.trading === 0 && t.min > closedAt.min && t.wrote).length === 0,
        `${label}: past the last re-probe the closure stands and nothing is written after the tick that closed it`);
      const late = ticks.filter((t) => t.min >= VERDICT.unscheduledUntilMin && t.min <= 16 * 60 + 11).reduce((n, t) => n + t.calls, 0);
      eq(late, 0, `${label}: and Tier 1 asks the vendor nothing from 15:45 to the close`);
    }
    summary.push([R, ticks.reduce((n, t) => n + t.calls, 0)]);
  }
  const worst = Math.max(...summary.filter(([R]) => R === null || R > lastReprobe).map(([, n]) => n));
  ok(worst <= 60, `THE COST OF A REAL CLOSURE is bounded: ${worst} vendor calls in a day (the seven ticks that make the verdict, then a probe every quarter hour to 15:45, two calls each)`);
  const reopenedWorst = Math.max(...summary.filter(([R]) => R !== null && R <= lastReprobe).map(([, n]) => n));
  ok(reopenedWorst <= 2 * 82, `and a day that reopens costs no more than an ordinary one, ${reopenedWorst} of at most ${2 * 82}`);
}

{
  const day = DAYS.est;
  const prev = prevWeekday(day);
  const closeAt = easternInstant(prev, 16 * 60);
  for (const R of [10 * 60 + 40, 12 * 60 + 5, 14 * 60 + 50]) {
    const w = world({ day, feed: (at) => (at >= easternInstant(day, R) ? { session: day, now: at } : { session: prev, now: closeAt }) });
    await w.runTo(16 * 60 + 11);
    const reopened = w.trail.find((t) => t.trading === 1);
    ok(reopened && reopened.min - R <= 15 && w.trail.find((t) => t.min === 16 * 60 + 6).wrote,
      `under EST the same holds: a vendor back at ${hhmm(R)} reopens the day at ${reopened ? hhmm(reopened.min) : "never"}`);
  }
}

{
  const day = DAYS.holiday;
  const prev = prevWeekday(day);
  const w = world({ day, feed: () => ({ session: prev, now: easternInstant(prev, 16 * 60) }) });
  await w.runTo(16 * 60 + 11);
  const closed = w.trail.find((t) => t.trading === 0);
  ok(closed && closed.min === 9 * 60 + 46, "A CALENDAR HOLIDAY closes at the first probe, with no agreement to wait for");
  const after = w.trail.filter((t) => t.min >= 11 * 60).reduce((n, t) => n + t.calls, 0);
  eq(after, 0, "and its re-probes end at 11:00: not one vendor call after it");
  eq(w.trail.reduce((n, t) => n + t.calls, 0), 2 * 5, "five probes in all, two calls each, as before");
  ok(w.trail.filter((t) => t.min > 9 * 60 + 46).every((t) => !t.wrote), "and nothing is written after the tick that closed it");
}

{
  const day = DAYS.edt;
  const healthy = world({ day, feed: (at) => ({ session: day, now: at }) });
  await healthy.runTo(16 * 60 + 11);
  ok(healthy.trail.every((t) => t.early === null && t.trading !== 0), "A HEALTHY DAY IS NEVER MARKED: no early close, no closure, at any tick");
  ok(healthy.trail.filter((t) => t.min >= 9 * 60 + 31 && t.min <= 16 * 60 + 6).every((t) => t.wrote), "and every tick to the close writes");
  ok(healthy.trail.filter((t) => t.min > 16 * 60 + 10).every((t) => t.calls === 0), "with no call after the close's ten minutes");
}

{
  const day = DAYS.early;
  const verdictFrozen = (S, R) => (at) => ({ session: day, now: at < easternInstant(day, S) || (R !== null && at >= easternInstant(day, R)) ? at : easternInstant(day, S) });
  const stalls = [12 * 60, 12 * 60 + 30, 12 * 60 + 55, 13 * 60 + 5, 13 * 60 + 10, 13 * 60 + 15, 13 * 60 + 20];
  const recoveries = [];
  for (let m = 13 * 60 + 11; m <= 16 * 60 + 5; m += 10) recoveries.push(m);
  recoveries.push(null);
  let flaggedRuns = 0, cleared = 0, runs = 0;
  let worstCalls = 0;
  for (const S of stalls) {
    for (const R of recoveries) {
      if (R !== null && R <= S) continue;
      runs++;
      const w = world({ day, feed: verdictFrozen(S, R) });
      await w.runTo(16 * 60 + 11);
      const ticks = w.trail;
      const label = `a tide frozen from ${hhmm(S)} ${R === null ? "to the end" : "until " + hhmm(R)}`;
      const first = ticks.find((t) => t.early === 1);
      const lastBar = tideLastAt(fakeMarketTide({ session: day, now: easternInstant(day, S) }));
      if (first) {
        flaggedRuns++;
        ok(first.min >= 13 * 60 + 30 && first.at - lastBar >= 30 * MIN && (R === null || first.at < easternInstant(day, R)),
          `${label}: the mark is set only at a tick after 13:30 that finds the tide still frozen at least 30 minutes on (${hhmm(first.min)})`);
      }
      if (lastBar > easternInstant(day, 13 * 60 + 5)) ok(!first, `${label}: a tide whose last bar is past 13:05 is never read as an early close`);
      if (R !== null && R <= 13 * 60 + 30 + 1) ok(!first, `${label}: a stall that ends by the first tick able to mark it marks nothing`);
      if (first && R !== null) {
        const back = ticks.find((t) => t.at >= easternInstant(day, R));
        cleared++;
        ok(back.early === null && back.wrote && back.trading === 1,
          `AN EARLY-CLOSE MARK IS TAKEN BACK: ${label}, the first tick after the tide moves (${hhmm(back.min)}) clears it and writes live:market`);
        ok(ticks.filter((t) => t.at >= back.at && t.min <= 16 * 60 + 6).every((t) => t.early === null && t.wrote),
          `${label}: and the session then runs to the close as any other`);
      }
      if (first && R === null) {
        ok(ticks.filter((t) => t.at >= first.at).every((t) => t.early === 1), `${label}: with no tide to contradict it the mark stands to the close`);
        const rounds = ticks.filter((t) => t.min > 13 * 60 + 10 && t.calls > 0).length;
        ok(rounds >= 35, `${label}: while Tier 1 keeps asking (${rounds} rounds after 13:10) so it can be taken back`);
      }
      if (first) ok(ticks.filter((t) => t.min > 16 * 60 + 10).every((t) => t.calls === 0), `${label}: and stops at 16:10`);
      worstCalls = Math.max(worstCalls, ticks.reduce((n, t) => n + t.calls, 0));
    }
  }
  ok(flaggedRuns > 20 && cleared > 10, `the sweep exercised the rule: ${runs} scenarios, ${flaggedRuns} marked, ${cleared} taken back`);
  ok(worstCalls <= 2 * 82, `the worst day costs ${worstCalls} vendor calls, two per tick, all day`);
}

{
  const day = DAYS.calendarEarly;
  const w = world({ day, feed: (at) => ({ session: day, now: Math.min(at, easternInstant(day, 13 * 60)) }) });
  await w.runTo(16 * 60 + 11);
  ok(w.trail.every((t) => t.early === null), "A CALENDAR EARLY CLOSE never sets the mark: the day after Thanksgiving is already 13:00");
  ok(w.trail.filter((t) => t.min > 13 * 60 + 10).every((t) => t.calls === 0), "and Tier 1 stops at 13:10 there, as it always did");
}

{
  const day = DAYS.early;
  const half = { day, trading: 1, earlyClose: 1 };
  eq(liveWindow(easternInstant(day, 14 * 60), half).why, "provisional-early-close",
    "THE LOOP WAITS OUT AN INFERRED EARLY CLOSE instead of leaving for the day: a mark Tier 1 can take back is a wait");
  ok(liveWindow(easternInstant(day, 14 * 60), half).wait === true && liveWindow(easternInstant(day, 14 * 60), half).run === false, "with no pass");
  eq(liveWindow(easternInstant(day, 13 * 60 + 20), half).why, "session", "the slots to 13:25 still pass");
  eq(liveWindow(easternInstant(day, 16 * 60 + 26), half).why, "after-close", "and the wait ends with the ordinary window at 16:25");
  eq(liveWindow(easternInstant(day, 14 * 60), { day, trading: 1, earlyClose: null }).run, true, "with no mark 14:00 is a session pass");
  eq(liveWindow(easternInstant(DAYS.calendarEarly, 14 * 60), { day: DAYS.calendarEarly, trading: 1, earlyClose: 1 }).why, "after-close",
    "and on a day the calendar lists it is over at 13:25 as before");
  eq(liveWindow(easternInstant(DAYS.edt, 14 * 60), { day: DAYS.edt, trading: 0, earlyClose: null }).why, "provisional-closed",
    "a closed verdict is still a wait at 14:00 on an ordinary day");
  eq(liveWindow(easternInstant(DAYS.edt, 15 * 60 + 45), { day: DAYS.edt, trading: 0, earlyClose: null }).why, "not-trading", "and final from 15:45");
  eq(liveWindow(easternInstant(DAYS.holiday, 10 * 60 + 30), { day: DAYS.holiday, trading: 0, earlyClose: null }).why, "not-trading",
    "while a calendar holiday is never a wait");
}

{
  const day = DAYS.edt;
  const prev = prevWeekday(day);
  const R = 13 * 60 + 12;
  const w = world({ day, feed: (at) => (at >= easternInstant(day, R) ? { session: day, now: at } : { session: prev, now: easternInstant(prev, 16 * 60) }),
    startMin: 9 * 60 + 31 });
  const passes = [];
  const r = await runLiveLoop({ now: w.now, sleep: w.sleep, log: () => {}, warn: () => {}, budgetMs: 24 * 3600 * 1000, readClock: w.readClock,
    pass: async () => { passes.push(w.now()); await w.advance(40000); return {}; },
    chain: async () => { throw new Error("no chain inside the window"); } });
  const at = (m) => easternInstant(day, m);
  const shut = w.trail.find((t) => t.trading === 0);
  const back = w.trail.find((t) => t.trading === 1);
  ok(shut && back && back.min - R <= 15, `THE LOOP AND TIER 1 TOGETHER, on a vendor that lags to ${hhmm(R)}: closed at ${hhmm(shut.min)}, reopened at ${hhmm(back.min)}`);
  ok(passes.filter((t) => t >= at(shut.min + 1) && t < back.at).length === 0 && passes.some((t) => t > back.at) && passes.at(-1) === at(16 * 60 + 25) &&
     r.exit === "window-closed" && r.waits > 0,
    `no pass while the day was closed, passes again from the first slot after the reopening, to 16:25 (${passes.length} passes, ${r.waits} waits)`);
}

{
  const day = DAYS.edt;
  const prev = prevWeekday(day);
  const w = world({ day, feed: () => ({ session: prev, now: easternInstant(prev, 16 * 60) }) });
  const passes = [];
  const r = await runLiveLoop({ now: w.now, sleep: w.sleep, log: () => {}, warn: () => {}, budgetMs: 24 * 3600 * 1000, readClock: w.readClock,
    pass: async () => { passes.push(w.now()); await w.advance(40000); return {}; },
    chain: async () => { throw new Error("never chain on a closed day"); } });
  ok(r.exit === "window-closed" && r.why === "not-trading" && w.now() >= easternInstant(day, VERDICT.unscheduledUntilMin - 5) &&
     w.now() < easternInstant(day, VERDICT.unscheduledUntilMin + 5) && passes.every((t) => t < easternInstant(day, 10 * 60 + 1)),
    `A REAL UNSCHEDULED CLOSURE: the loop waits to ${hhmm(VERDICT.unscheduledUntilMin)} for a vendor that never comes back, then leaves without a pass after the verdict (${r.waits} waits)`);
}

{
  const day = DAYS.early;
  const S = 12 * 60 + 55;
  const R = 14 * 60 + 33;
  const w = world({ day, feed: (at) => ({ session: day, now: at >= easternInstant(day, S) && at < easternInstant(day, R) ? easternInstant(day, S) : at }),
    startMin: 9 * 60 + 31 });
  const passes = [];
  const r = await runLiveLoop({ now: w.now, sleep: w.sleep, log: () => {}, warn: () => {}, budgetMs: 24 * 3600 * 1000, readClock: w.readClock,
    pass: async () => { passes.push(w.now()); await w.advance(40000); return {}; },
    chain: async () => { throw new Error("no chain inside the window"); } });
  const marked = w.trail.find((t) => t.early === 1);
  const cleared = w.trail.find((t) => t.at >= easternInstant(day, R));
  ok(marked && marked.min === 13 * 60 + 31 && cleared.early === null, `THE LOOP AFTER A FALSE EARLY CLOSE: marked at ${hhmm(marked.min)}, taken back at ${hhmm(cleared.min)}`);
  const held = passes.filter((t) => t > marked.at && t < cleared.at);
  ok(held.length === 0 && passes.some((t) => t > cleared.at) && passes.at(-1) === easternInstant(day, 16 * 60 + 25) && r.exit === "window-closed",
    `no pass while it stood, passes on every slot after (${passes.length} passes, last ${new Date(passes.at(-1)).toISOString()})`);
}

console.log(`flows-verdict-contract: ${checks} checks passed`);
