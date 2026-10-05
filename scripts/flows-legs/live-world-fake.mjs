import { easternInstant, closeMinutes, PHASE_MINUTES, LIVE_CLOCK, prevTradingDay } from "../../shared/flows-freshness.js";

const iso = (ms) => new Date(ms).toISOString();
const BOT = "github-actions[bot]";
const inside = (t, spans) => spans.some(([from, to]) => t >= from && t < to);

export function fakeGithub({ now = () => Date.now(), dispatchStatus = 204, chainStatus = 204, writeStatus = 201, listStatus = 200,
  seed = [], loseCreates = 0 } = {}) {
  const record = { dispatches: [], created: [], comments: [], closed: [], reopened: [], calls: [], cancelled: [] };
  const queue = liveGroup({ now, record });
  const issues = seed.map((it) => ({ state: "open", author: BOT, ...it }));
  let next = 100 + issues.length;
  let lost = loseCreates;
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    record.calls.push({ method, path: u.pathname, at: now() });
    const dispatch = /\/actions\/workflows\/([^/]+)\/dispatches$/.exec(u.pathname);
    if (dispatch && method === "POST") {
      const entry = { workflow: dispatch[1], inputs: body && body.inputs, ref: body && body.ref, at: now() };
      const wanted = dispatch[1] === "flows-live.yml" ? chainStatus : dispatchStatus;
      const status = typeof wanted === "function" ? wanted(entry.at) : wanted;
      record.dispatches.push({ ...entry, status });
      if (status === 0) throw new Error("fetch failed");
      if (status === 204 && dispatch[1] === "flows-live.yml") queue.dispatched(entry);
      return reply(status, null);
    }
    if (/\/issues$/.test(u.pathname) && method === "GET") {
      return reply(listStatus, issues.filter((it) => it.state === "open")
        .map((it) => ({ number: it.number, title: it.title, updated_at: iso(it.updatedAt), state: "open",
          user: { login: it.author, type: it.author.endsWith("[bot]") ? "Bot" : "User" },
          ...(it.pull_request ? { pull_request: {} } : {}) })));
    }
    if (/\/issues$/.test(u.pathname) && method === "POST") {
      if (writeStatus >= 300) return reply(writeStatus, { message: "refused" });
      const made = { number: next++, title: body.title, body: body.body, state: "open", updatedAt: now(), author: BOT };
      issues.push(made);
      record.created.push({ number: made.number, title: made.title, body: made.body, at: now() });
      if (lost > 0) {
        lost--;
        throw new Error("The operation was aborted");
      }
      return reply(201, { number: made.number });
    }
    const comment = /\/issues\/(\d+)\/comments$/.exec(u.pathname);
    if (comment && method === "POST") {
      const found = issues.find((it) => it.number === Number(comment[1]));
      if (writeStatus >= 300 || !found) return reply(writeStatus >= 300 ? writeStatus : 404, { message: "refused" });
      found.updatedAt = now();
      record.comments.push({ number: found.number, body: body.body, at: now() });
      return reply(201, { id: record.comments.length });
    }
    const patch = /\/issues\/(\d+)$/.exec(u.pathname);
    if (patch && method === "PATCH") {
      const found = issues.find((it) => it.number === Number(patch[1]));
      if (writeStatus >= 300 || !found) return reply(writeStatus >= 300 ? writeStatus : 404, { message: "refused" });
      found.state = body.state;
      found.updatedAt = now();
      if (body.state === "closed") record.closed.push({ number: found.number, at: now(), reason: body.state_reason });
      if (body.state === "open") record.reopened.push({ number: found.number, at: now() });
      return reply(200, { number: found.number, state: found.state });
    }
    return reply(404, { message: "unrouted " + method + " " + u.pathname });
  };
  return { fetchImpl, record, issues, queue };
}

export function liveGroup({ now = () => Date.now(), record = { cancelled: [] } } = {}) {
  const runs = [];
  const state = { running: null, pending: null };
  const begin = (run, at) => {
    const started = { ...run, id: runs.length + 1, startedAt: at, endedAt: null };
    runs.push(started);
    state.running = started;
    return started;
  };
  return {
    runs,
    running: () => state.running,
    pending: () => state.pending,
    start: (inputs, at = now()) => begin({ inputs, at }, at),
    dispatched(entry) {
      if (!state.running) return begin(entry, entry.at);
      if (state.pending) record.cancelled.push({ ...state.pending, cancelledAt: entry.at });
      state.pending = { inputs: entry.inputs, at: entry.at };
      return state.pending;
    },
    finish(at = now()) {
      if (state.running) state.running.endedAt = at;
      state.running = null;
      const next = state.pending;
      state.pending = null;
      return next ? begin(next, at) : null;
    },
  };
}

export function fakeWorld({ day, start, landOnDispatch = 15 * 60 * 1000, landAt = null, tier1Down = [], marketDown = [],
  focusDown = [], breadthDown = [], metaPending = [], readFail = [], clockFail = [], clockFlaky = [], summaryAgeMs = 10 * 60 * 1000, github = {} } = {}) {
  let t = start;
  const prev = prevTradingDay(day, null);
  const open = easternInstant(day, PHASE_MINUTES.open);
  const close = easternInstant(day, closeMinutes(day, null));
  const lastTickAt = close + LIVE_CLOCK.tier1AfterCloseMin * 60000;
  const stat = { reads: [], sleeps: [] };
  const gh = fakeGithub({ now: () => t, ...github });

  const ticks = (minute) => {
    const out = [];
    for (let x = open + minute * 60000; x <= lastTickAt; x += 5 * 60000) out.push(x);
    return out;
  };
  const tier1Ticks = ticks(1);
  const focusTicks = ticks(3);
  const breadthTicks = [];
  for (let x = open + 60000; x <= close + LIVE_CLOCK.runAfterCloseMin * 60000; x += 5 * 60000) breadthTicks.push(x);
  const priorFinal = easternInstant(prev, closeMinutes(prev, null)) + 6 * 60000;
  const lastUp = (list, down, at) => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i] <= at && !inside(list[i], down)) return list[i];
    return priorFinal;
  };
  const tickAt = (at) => lastUp(tier1Ticks, tier1Down, at);
  const marketAt = (at) => lastUp(tier1Ticks, [...tier1Down, ...marketDown], at);
  const focusAt = (at) => lastUp(focusTicks, [...tier1Down, ...focusDown], at);
  const breadthAt = (at) => lastUp(breadthTicks, breadthDown, at);

  const dispatchedAt = () => {
    const sent = gh.record.dispatches.find((d) => d.workflow === "flows-pipeline.yml" && d.status === 204);
    return sent ? sent.at : null;
  };
  const landedAt = () => {
    const viaDispatch = dispatchedAt() !== null && Number.isFinite(landOnDispatch) ? dispatchedAt() + landOnDispatch : null;
    const list = [landAt, viaDispatch].filter((v) => v !== null && Number.isFinite(v));
    return list.length ? Math.min(...list) : null;
  };
  const metaSession = () => {
    const at = landedAt();
    return at !== null && t >= at ? day : prev;
  };

  const clockBody = () => ({
    key: "clock",
    clock: {
      day, trading: 1, earlyClose: null, closedDays: [],
      tier1: { at: iso(tickAt(t)), okAt: iso(marketAt(t)), why: "written" },
      dispatchWhy: "no-token", summaryAt: iso(t - summaryAgeMs),
    },
  });

  let lastClockAt = -Infinity;
  const readOnce = async (key) => {
    stat.reads.push({ key, at: t });
    const clockGap = key === "clock" ? t - lastClockAt : 0;
    if (key === "clock") lastClockAt = t;
    if (inside(t, readFail)) return { payload: null, failed: true, status: 403 };
    if (key === "clock" && (inside(t, clockFail) || (inside(t, clockFlaky) && clockGap > 2000))) {
      return { payload: null, failed: true, status: 403 };
    }
    if (key === "clock") return { payload: clockBody(), status: 200 };
    if (key === "live:market") return { payload: { key, fresh: { readAt: iso(marketAt(t)) } }, status: 200 };
    if (key === "live:focus") return { payload: { key, fresh: { readAt: iso(focusAt(t)) } }, status: 200 };
    if (key === "live:breadth") return { payload: { key, fresh: { readAt: iso(breadthAt(t)) } }, status: 200 };
    if (key === "meta") {
      if (inside(t, metaPending)) return { payload: null, absent: true, status: 200 };
      return { payload: { sessionDate: metaSession(), generatedAt: iso(t) }, status: 200 };
    }
    return { payload: null, absent: true, status: 200 };
  };

  return {
    day, prev, open, close, github: gh, stat,
    now: () => t,
    sleep: async (ms) => { stat.sleeps.push(ms); t += Math.max(0, ms); },
    advance: (ms) => { t += ms; },
    readOnce, latestClock: () => (inside(t, readFail) ? null : clockBody()),
    landedAt, dispatchedAt,
    env: () => ({
      GITHUB_TOKEN: "ghs_fake", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org", GITHUB_REPOSITORY_OWNER: "anilkaya001",
      GITHUB_RUN_ID: "36600000001", GITHUB_SERVER_URL: "https://github.com",
    }),
  };
}
