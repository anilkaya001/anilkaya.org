import { LIVE_BUDGET, VERDICT, isoSec, timeMs } from "../../shared/flows-live.js";
import { easternInstant, prevTradingDay, phaseAt } from "../../shared/flows-freshness.js";
import { liveWindow, runLive, universeReader } from "../../shared/flows-live-pass.js";
import { fakeLiveVendor, fakeBoards, fakeUniverse } from "./live-fake.mjs";

export { boardPlan, FOCUS_FALLBACK, focusStripNames, LIVE_READ_PACE_MS, LIVE_WRITER,
  liveWindow, passOutcome, runLive, universeReader } from "../../shared/flows-live-pass.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const clockFlag = (v) => (v === 0 || v === 1 ? v : null);

export function sessionClock(body) {
  const ownership = body && body.liveOwner === "worker" ? { liveOwner: "worker" } : null;
  const c = body && typeof body === "object" ? body.clock : null;
  if (!ownership && body?.key === "clock" && body.clock === null) return { liveOwner: "actions" };
  if (!c || typeof c !== "object" || typeof c.day !== "string" || !DAY_RE.test(c.day)) return ownership;
  return { day: c.day, trading: clockFlag(c.trading), earlyClose: clockFlag(c.earlyClose), ...ownership };
}

export async function readLiveClock(readOnce, { seen = null, deadlineMs = LIVE_LOOP.clockDeadlineMs,
  retryMs = WATCH_RETRY.delayMs, sleep = realSleep } = {}) {
  let body = null;
  let clock = null;
  try {
    const read = await readWithRetry(readOnce, "clock", { deadlineMs, retryMs, sleep });
    body = read && read.payload ? read.payload : null;
    clock = sessionClock(body);
  } catch {
    clock = null;
  }
  if (clock && seen) {
    try { seen(body); } catch { }
  }
  return clock;
}

export function liveRunVerdict(loop) {
  const passes = loop && Array.isArray(loop.passes) ? loop.passes : [];
  const ran = passes.filter((p) => p && !p.skipped);
  const dead = (p) => !!p.threw || !(p.answered > 0) || !(p.landed > 0);
  const why = [];
  if (ran.length && ran.every(dead)) {
    why.push(`every one of ${ran.length} pass(es) answered no feed call or landed no key`);
  }
  if (loop && loop.exit === "hung") {
    const what = loop.why === "tick-deadline" ? "a watch tick" : "a pass";
    const how = loop.why === "pass-idle" ? "settled no feed or ingest call within its idle limit" : "did not finish within its deadline";
    why.push(loop.chained && loop.chained.sent
      ? `${what} ${how}, so the loop exited and re-dispatched (${loop.chained.why}) to free the ` +
        "concurrency group for its successor"
      : `${what} ${how}, so the loop exited and could not dispatch its successor ` +
        `(${loop.chained ? loop.chained.why : "not sent"}): nothing restarts the loop until a GitHub starter arrives`);
  }
  if (loop && loop.exit === "budget" && !(loop.chained && loop.chained.sent)) {
    why.push("the time budget ran out and the chain dispatch was refused, so nothing keeps the loop going until a " +
      "GitHub starter arrives");
  }
  const breached = loop && loop.watch && Array.isArray(loop.watch.breached) ? loop.watch.breached : [];
  if (breached.length) {
    why.push(`the witness confirmed ${breached.length === 1 ? "a lapse" : "lapses"} in ${breached.join(", ")}`);
  }
  return why.length ? { failed: true, why: why.join("; ") } : { failed: false, why: null };
}

export const LIVE_LOOP = Object.freeze({
  slotMs: 5 * 60 * 1000,
  budgetMs: 340 * 60 * 1000,
  preOpenWaitMs: 240 * 60 * 1000,
  openLagMs: 60 * 1000,
  idleMs: 15 * 60 * 1000,
  chainRetryMs: Object.freeze([15 * 1000, 45 * 1000]),
  githubTimeoutMs: 15 * 1000,
  clockDeadlineMs: 10 * 1000,
  passIdleMs: 90 * 1000,
  passDeadlineMs: 10 * 60 * 1000,
  tickDeadlineMs: 2 * 60 * 1000,
  workflow: "flows-live.yml",
  ref: "main",
});

export function nextSlot(at, slotMs = LIVE_LOOP.slotMs) {
  return (Math.floor(at / slotMs) + 1) * slotMs;
}

export function githubTarget(env = {}) {
  const token = typeof env.GITHUB_TOKEN === "string" ? env.GITHUB_TOKEN.trim() : "";
  if (!token) return { ok: false, why: "no-token" };
  const repo = env.GITHUB_REPOSITORY || "";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return { ok: false, why: "bad-repo" };
  const api = String(env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  if (!/^https:\/\/api\.github\.com$|^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(api)) return { ok: false, why: "bad-base" };
  return { ok: true, token, repo, api };
}

export function githubHeaders(token) {
  return {
    Authorization: "Bearer " + token, Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "anilkaya-flows-live", "Content-Type": "application/json",
  };
}

export const githubSignal = (ms = LIVE_LOOP.githubTimeoutMs) => AbortSignal.timeout(ms);

export const transientRefusal = (r) => !!r && !r.sent &&
  (r.why === "unreachable" || r.status === 408 || r.status === 429 || (Number.isInteger(r.status) && r.status >= 500));

function realSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export const withDeadline = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ failed: true, status: 0, detail: "timeout" }), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); resolve({ failed: true, status: 0, detail: error && error.message ? error.message : String(error) }); });
});

export const WATCH_RETRY = Object.freeze({ delayMs: 1000, statuses: Object.freeze([0, 403, 408, 429]) });

export function challenged(read) {
  if (!read || read.failed !== true || read.final) return false;
  const status = Number(read.status) || 0;
  return WATCH_RETRY.statuses.includes(status) || status >= 500;
}

export async function readWithRetry(readOnce, key, { deadlineMs, retryMs = WATCH_RETRY.delayMs, sleep = realSleep } = {}) {
  const attempt = (ms) => withDeadline(Promise.resolve().then(() => readOnce(key)), ms);
  if (!(deadlineMs > retryMs)) return attempt(deadlineMs);
  const each = Math.floor((deadlineMs - retryMs) / 2);
  const first = await attempt(each);
  if (!challenged(first)) return first;
  await sleep(retryMs);
  return attempt(each);
}

export async function chainDispatch({ env = {}, fetchImpl = fetch, at = Date.now(), workflow = LIVE_LOOP.workflow,
  ref = LIVE_LOOP.ref, inputs = null } = {}) {
  const target = githubTarget(env);
  if (!target.ok) return { sent: false, why: target.why };
  try {
    const res = await fetchImpl(`${target.api}/repos/${target.repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
      method: "POST",
      headers: githubHeaders(target.token),
      body: JSON.stringify({ ref, inputs: inputs || { tick: new Date(at).toISOString(), origin: "chain" } }),
      signal: githubSignal(),
    });
    return { sent: res.status === 204, status: res.status, why: res.status === 204 ? "sent" : "refused" };
  } catch (error) {
    return { sent: false, why: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function chainWithRetry(send, { sleep = null, delays = LIVE_LOOP.chainRetryMs } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last = await send();
  const tries = [last];
  for (const ms of delays) {
    if (last.sent || last.why === "no-token" || last.why === "bad-repo" || last.why === "bad-base") break;
    await wait(ms);
    last = await send();
    tries.push(last);
  }
  return { ...last, attempts: tries.length };
}

const HUNG = Symbol("hung");

export function createProgress(clock = () => Date.now()) {
  let last = 0;
  let quietUntil = 0;
  return Object.freeze({
    settled() { last = clock(); },
    quiet(ms) { quietUntil = Math.max(quietUntil, clock() + Math.max(0, Number(ms) || 0)); },
    lastAt: () => Math.max(last, quietUntil),
  });
}

const underProgress = (work, { idleMs, ceilingMs, lastAt }) => new Promise((resolve, reject) => {
  const started = Date.now();
  const ceiling = started + ceilingMs;
  const due = () => {
    const seen = typeof lastAt === "function" ? Number(lastAt()) : NaN;
    return Math.min(ceiling, Math.max(started, Number.isFinite(seen) ? seen : started) + idleMs);
  };
  let timer = null;
  const check = () => {
    const at = Date.now();
    const end = due();
    if (at >= end) {
      resolve({ hung: HUNG, kind: end >= ceiling ? "ceiling" : "idle", ms: at - started });
      return;
    }
    timer = setTimeout(check, end - at);
  };
  timer = setTimeout(check, due() - started);
  Promise.resolve().then(work).then((value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); });
});

const underDeadline = (work, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(HUNG), ms);
  Promise.resolve().then(work).then((value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); });
});

const nextOpenAt = (at, clock) => {
  const p = phaseAt(at, clock);
  const open = p && p.phase !== "rth" ? p.nextOpen : NaN;
  return Number.isFinite(open) ? open + LIVE_LOOP.openLagMs : NaN;
};

async function keepLoop({ startedAt, refresh, current, currentRead, pass, chain, now, sleep, window, slotMs, budgetMs, idleMs,
  watch, log, warn, passIdleMs, passDeadlineMs, tickDeadlineMs, progress, onHung }) {
  const passes = [];
  let waits = 0;
  let ticks = 0;
  const hung = async (why, what, ms, clock, said = `did not finish within ${ms / 1000} s`) => {
    warn(`live loop: ${what} ${said} — abandoning it, re-dispatching and exiting ` +
      "non-zero so the concurrency group frees for the successor");
    if (typeof onHung === "function") {
      try { onHung({ why, what, ms }); } catch { }
    }
    const chained = await chain({ at: now() });
    log(`live loop: exited on the ${why} after ${passes.length} pass(es) and ${ticks} watch tick(s) — ` +
      `re-dispatched: ${chained.why}${chained.status ? " (" + chained.status + ")" : ""}`);
    if ((why !== "tick-deadline" || !chained.sent) && typeof watch.loopHung === "function") {
      try {
        const told = await underDeadline(() => watch.loopHung({ at: now(), why, what, ms, said, chained }), tickDeadlineMs);
        if (told === HUNG) warn(`live loop: the witness could not report the hung ${what} within ${tickDeadlineMs / 1000} s`);
      } catch (error) {
        warn(`live loop: the witness could not report the hung ${what} — ` +
          `${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`);
      }
    }
    return { exit: "hung", why, passes, waits, ticks, chained, clock, preOpenMs: 0, keep: true,
      watch: typeof watch.summary === "function" ? watch.summary() : null };
  };
  for (;;) {
    await refresh();
    const clock = current();
    const here = window(now(), clock);
    if (here.why === "worker-owner") {
      log("live loop: Cloudflare owns Tier 2; ending the Actions run");
      return { exit: "worker-owner", why: here.why, passes, waits, ticks, chained: null, clock, preOpenMs: 0, keep: true,
        watch: typeof watch.summary === "function" ? watch.summary() : null };
    }
    if (here.run) {
      const index = passes.length;
      let done = null;
      try {
        done = await underProgress(() => pass({ first: index === 0, index, clock }),
          { idleMs: passIdleMs, ceilingMs: passDeadlineMs, lastAt: progress });
      } catch (error) {
        const threw = error instanceof Error ? error.message : String(error);
        warn(`live loop: pass ${index + 1} threw — ${threw.slice(0, 300)}; the loop carries on to the next slot`);
        done = { errored: true, threw: threw.slice(0, 300) };
      }
      if (done && done.hung === HUNG) {
        const idle = done.kind === "idle";
        const ms = idle ? passIdleMs : passDeadlineMs;
        const said = idle ? `settled no feed or ingest call for ${ms / 1000} s` : `did not finish within ${ms / 1000} s`;
        passes.push({ errored: true, hung: true, threw: said });
        return hung(idle ? "pass-idle" : "pass-deadline", `pass ${index + 1}`, ms, clock, said);
      }
      passes.push(done);
    } else if (here.wait) {
      waits++;
      log(`live loop: Tier 1 has closed ${here.phase.day} before ` +
        `${Math.floor(VERDICT.provisionalUntilMin / 60)}:00 ET, when a late feed can still reopen it — no pass, ` +
        "waiting for the next slot");
    }
    let beat = {};
    try {
      const told = await underDeadline(() => watch.tick({ at: now(), clock, clockRead: currentRead(), first: ticks === 0,
        inSession: !!here.run, passes, startedAt, budgetMs }), tickDeadlineMs);
      if (told === HUNG) {
        ticks++;
        return hung("tick-deadline", `watch tick ${ticks}`, tickDeadlineMs, clock);
      }
      beat = told || {};
    } catch (error) {
      warn(`live loop: the watch threw — ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}; ` +
        "the loop carries on");
    }
    ticks++;
    const t = now();
    const busy = !!(here.run || here.wait || beat.busy);
    let wake = nextSlot(t, busy ? slotMs : idleMs);
    const open = nextOpenAt(t, clock);
    if (Number.isFinite(open) && open > t && wake >= open - LIVE_LOOP.openLagMs) wake = open;
    if (wake - startedAt > budgetMs) {
      const chained = await chain({ at: now() });
      log(`live loop: time budget spent after ${passes.length} pass(es) and ${ticks} watch tick(s) — ` +
        `re-dispatched: ${chained.why}${chained.status ? " (" + chained.status + ")" : ""}`);
      if (!chained.sent && typeof watch.chainFailed === "function") {
        try { await watch.chainFailed({ at: now(), chained }); } catch { }
      }
      return { exit: "budget", why: "budget", passes, waits, ticks, chained, clock, preOpenMs: 0, keep: true,
        watch: typeof watch.summary === "function" ? watch.summary() : null };
    }
    await sleep(wake - now());
  }
}

export async function runLiveLoop({ pass, chain, now = () => Date.now(), sleep = realSleep, window = liveWindow,
  readClock = async () => null, initialClock = null, slotMs = LIVE_LOOP.slotMs, budgetMs = LIVE_LOOP.budgetMs, log = console.log,
  warn = console.warn, watch = null, idleMs = LIVE_LOOP.idleMs, clockDeadlineMs = LIVE_LOOP.clockDeadlineMs,
  passIdleMs = LIVE_LOOP.passIdleMs, passDeadlineMs = LIVE_LOOP.passDeadlineMs, tickDeadlineMs = LIVE_LOOP.tickDeadlineMs,
  progress = null, onHung = null } = {}) {
  const startedAt = now();
  const passes = [];
  let clock = null;
  let clockRead = false;
  const refresh = async () => {
    const read = initialClock || await withDeadline(Promise.resolve().then(readClock), clockDeadlineMs);
    initialClock = null;
    clockRead = !!read && !read.failed;
    if (clockRead) clock = read;
    return clock;
  };
  if (watch) {
    return keepLoop({ startedAt, refresh, current: () => clock, currentRead: () => clockRead, pass, chain, now, sleep, window,
      slotMs, budgetMs, idleMs, watch, log, warn, passIdleMs, passDeadlineMs, tickDeadlineMs, progress, onHung });
  }
  await refresh();
  let opening = window(startedAt, clock);
  let preOpenMs = 0;
  if (opening.why === "before-open" && opening.phase && Number.isFinite(opening.phase.open)) {
    const firstAt = opening.phase.open + LIVE_LOOP.openLagMs;
    if (firstAt - startedAt <= LIVE_LOOP.preOpenWaitMs) {
      preOpenMs = firstAt - startedAt;
      log(`live loop: started ${Math.round(preOpenMs / 60000)} min before the open — waiting for it rather than ` +
        "exiting, because a GitHub starter lands anywhere from on time to hours late");
      await sleep(firstAt - now());
      await refresh();
      opening = window(now(), clock);
    }
  }
  if (!opening.run && !opening.wait) {
    log(`live loop: nothing to do (${opening.why}) — a starter that ran outside the session exits without a pass`);
    return { exit: "outside-window", why: opening.why, passes, chained: null, clock, preOpenMs };
  }
  let here = opening;
  let waits = 0;
  for (;;) {
    if (here.run) {
      const index = passes.length;
      try {
        passes.push(await pass({ first: index === 0, index, clock }));
      } catch (error) {
        const threw = error instanceof Error ? error.message : String(error);
        warn(`live loop: pass ${index + 1} threw — ${threw.slice(0, 300)}; the loop carries on to the next slot`);
        passes.push({ errored: true, threw: threw.slice(0, 300) });
      }
    } else {
      waits++;
      log(here.why === "provisional-early-close"
        ? `live loop: Tier 1 has marked ${here.phase.day} an early close the calendar does not list, and takes the mark back ` +
          "if the tide moves again — no pass, waiting for the next slot"
        : `live loop: Tier 1 has closed ${here.phase.day} before ` +
          `${Math.floor(VERDICT.unscheduledUntilMin / 60)}:${String(VERDICT.unscheduledUntilMin % 60).padStart(2, "0")} ET, when a ` +
          "late feed can still reopen it — no pass, waiting for the next slot");
    }
    await refresh();
    const next = nextSlot(now(), slotMs);
    const ahead = window(next, clock);
    if (!ahead.run && !ahead.wait) {
      log(`live loop: the session window closes before ${new Date(next).toISOString()} (${ahead.why}); ` +
        `${passes.length} pass(es)`);
      return { exit: "window-closed", why: ahead.why, passes, waits, chained: null, clock, preOpenMs };
    }
    if (next - startedAt > budgetMs) {
      const chained = await chain({ at: now() });
      log(`live loop: time budget spent after ${passes.length} pass(es) with the session still open — ` +
        `re-dispatched: ${chained.why}${chained.status ? " (" + chained.status + ")" : ""}`);
      return { exit: "budget", why: "budget", passes, waits, chained, clock, preOpenMs };
    }
    await sleep(next - now());
    await refresh();
    here = window(now(), clock);
    if (!here.run && !here.wait) {
      log(`live loop: the session window closed while waiting (${here.why}); ${passes.length} pass(es)`);
      return { exit: "window-closed", why: here.why, passes, waits, chained: null, clock, preOpenMs };
    }
  }
}

export async function dryLiveTicks({ publish, store, shapeNews, log = console.log, warn = console.warn,
  session = "2026-08-24", minutes = [11 * 60 + 7, 11 * 60 + 22] } = {}) {
  const boards = fakeBoards({ sessionDate: prevTradingDay(session, null), session });
  const readStored = async (key) => {
    if (key.startsWith("board:")) return { payload: boards[key.slice(6)] || null };
    const payload = store[key] || (key === "universe" ? fakeUniverse({ boards }) : null);
    return payload ? { payload } : { payload: null, absent: true };
  };
  const universe = universeReader(readStored);
  const results = [];
  for (const m of minutes) {
    const at = easternInstant(session, m);
    let clock = at;
    const now = () => (clock += 250);
    const uw = fakeLiveVendor({ now, session, nullPrev: true });
    log(`live (dry run): tick at ${isoSec(at)} (${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} ET)`);
    results.push(await runLive({ uw, publish, readStored, now, log, warn, shapeNews, origin: "dry-run", force: true, universe }));
  }
  return results;
}

export async function readHeldAlerts(readStored, sessionDate) {
  const live = await readStored("live:alerts");
  const payload = live && live.payload && typeof live.payload === "object" ? live.payload : null;
  if (payload && payload.sessionDate === sessionDate && payload.record && payload.record.date === sessionDate) {
    return { ...live, heldFrom: "live:alerts" };
  }
  return readStored("flowalerts");
}
