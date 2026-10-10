#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PRODUCTION_HOSTS = Object.freeze(["anilkaya.org", "www.anilkaya.org"]);
export const FREE_DAILY_REQUESTS = 100000;
export const FREE_BUDGET_SHARE = 0.25;
export const LOGIN_PER_MINUTE = 10;
export const DEFAULTS = Object.freeze({
  users: 20,
  minutes: 30,
  snapMs: 5000,
  boardMs: 60000,
  topics: "px,fl,mk,nw",
  focus: "SPY",
  loginGapMs: Math.ceil(60000 / LOGIN_PER_MINUTE) + 500,
});
export const SNAP_TOPICS = "px,fl,mk";

const isLoopback = (host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";

export function checkTarget(baseUrl, allowHost) {
  let url;
  try { url = new URL(baseUrl); } catch { return { ok: false, reason: "base must be an absolute URL" }; }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    return { ok: false, reason: "base must be https, or http on a loopback address" };
  }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.includes(host) || host.endsWith(".anilkaya.org")) {
    return { ok: false, reason: "refusing to load-test production (" + host + "): this tool only runs against a staging Worker or a local one" };
  }
  if (isLoopback(host)) return { ok: true, url };
  if (/staging/.test(host)) return { ok: true, url };
  if (allowHost && allowHost.toLowerCase() === host) return { ok: true, url };
  return { ok: false, reason: host + " is not a staging host; name it with --allow-host " + host + " if it really is one" };
}

export function parseUsers(raw) {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw.split(",").map((pair) => pair.trim()).filter(Boolean).map((pair) => {
    const at = pair.indexOf(":");
    if (at < 1 || at === pair.length - 1) throw new Error("LOAD_USERS entries are name:password");
    return { name: pair.slice(0, at), password: pair.slice(at + 1) };
  });
}

export function plan({ users, minutes, rung, snapMs, boardMs }) {
  const seconds = minutes * 60;
  const half = rung === "both" ? seconds / 2 : seconds;
  const pollSeconds = rung === "socket" ? 0 : half;
  const socketSeconds = rung === "poll" ? 0 : half;
  const snaps = Math.floor(users * pollSeconds * 1000 / snapMs);
  const boards = Math.floor(users * pollSeconds * 1000 / boardMs);
  const sockets = rung === "poll" ? 0 : users;
  const logins = users;
  const worker = snaps + boards + logins + sockets;
  return {
    users, minutes, rung, pollSeconds, socketSeconds, snaps, boards, logins, sockets,
    workerRequests: worker,
    durableObjectRequests: snaps + sockets,
    freeDailyShare: worker / FREE_DAILY_REQUESTS,
  };
}

export function pct(list, p) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export function tally() {
  const routes = new Map();
  return {
    add(route, status, ms) {
      if (!routes.has(route)) routes.set(route, { n: 0, ok: 0, limited: 0, client: 0, server: 0, failed: 0, ms: [] });
      const r = routes.get(route);
      r.n++;
      if (status === 0) r.failed++;
      else if (status === 429) r.limited++;
      else if (status >= 500) r.server++;
      else if (status >= 400) r.client++;
      else r.ok++;
      if (status !== 0) r.ms.push(ms);
    },
    report() {
      return Object.fromEntries([...routes].sort().map(([route, r]) => [route, {
        requests: r.n, ok: r.ok, limited429: r.limited, client4xx: r.client, server5xx: r.server, failed: r.failed,
        p50ms: pct(r.ms, 0.5), p95ms: pct(r.ms, 0.95), maxMs: r.ms.length ? Math.max(...r.ms) : null,
      }]));
    },
  };
}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const timer = setTimeout(resolve, ms);
  if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export async function signIn(base, user, tally, fetchImpl = fetch, clock = Date.now) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const started = clock();
    let response;
    try {
      response = await fetchImpl(new URL("/flows/login", base), {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base.origin, "Sec-Fetch-Site": "same-origin" },
        body: new URLSearchParams({ username: user.name, password: user.password }).toString(),
      });
      await response.text();
    } catch {
      tally.add("POST /flows/login", 0, 0);
      await sleep(1000);
      continue;
    }
    tally.add("POST /flows/login", response.status, clock() - started);
    if (response.status === 303) {
      const cookie = /flows_session=[^;]+/.exec(response.headers.get("set-cookie") || "");
      return cookie ? cookie[0] : null;
    }
    if (response.status === 429) {
      const wait = Math.min(65, Math.max(1, Number(response.headers.get("retry-after")) || 60));
      await sleep(wait * 1000);
      continue;
    }
    return null;
  }
  return null;
}

async function pollMember(base, cookie, tally, opts, signal, fetchImpl, clock) {
  const timers = [];
  const hit = async (route, path) => {
    const started = clock();
    try {
      const response = await fetchImpl(new URL(path, base), { headers: { Cookie: cookie, Accept: "application/json" } });
      await response.text();
      tally.add(route, response.status, clock() - started);
    } catch {
      tally.add(route, 0, 0);
    }
  };
  const every = (ms, route, path, offset) => (async () => {
    await sleep(offset, signal);
    while (!signal.aborted) {
      await hit(route, path);
      await sleep(ms, signal);
    }
  })();
  timers.push(every(opts.snapMs, "GET /api/rt/snap", "/api/rt/snap?k=" + SNAP_TOPICS, Math.floor(Math.random() * opts.snapMs)));
  timers.push(every(opts.boardMs, "GET /api/flows/board", "/api/flows/board", Math.floor(Math.random() * opts.boardMs)));
  await Promise.all(timers);
}

export function frameTracker() {
  const state = { frames: 0, snapshots: 0, gaps: 0, epochs: new Set(), byTopic: {}, bye: [], bytes: 0 };
  const last = new Map();
  return {
    state,
    accept(text) {
      state.bytes += text.length;
      let frame;
      try { frame = JSON.parse(text); } catch { return; }
      if (!frame || typeof frame !== "object") return;
      state.frames++;
      const topic = String(frame.k);
      state.byTopic[topic] = (state.byTopic[topic] || 0) + 1;
      if (frame.snap === true) state.snapshots++;
      if (topic === "ctl") {
        if (frame.t === "bye") state.bye.push({ reason: frame.reason || (frame.meta && frame.meta.reason) || null, code: frame.code || (frame.meta && frame.meta.code) || null });
        return;
      }
      if (Number.isFinite(frame.ep)) state.epochs.add(frame.ep);
      if (Number.isSafeInteger(frame.sq)) {
        const key = topic + "@" + frame.ep;
        if (last.has(key) && frame.snap !== true && frame.sq !== last.get(key) + 1) state.gaps++;
        last.set(key, frame.sq);
      }
    },
  };
}

async function socketMember(base, cookie, trackers, opts, signal, WebSocketImpl) {
  const wsUrl = new URL("/api/rt/ws", base);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.searchParams.set("k", opts.topics);
  wsUrl.searchParams.set("f", opts.focus);
  const tracker = frameTracker();
  trackers.push(tracker);
  await new Promise((resolve) => {
    let socket;
    try { socket = new WebSocketImpl(wsUrl.toString(), { headers: { Cookie: cookie, Origin: base.origin } }); } catch { tracker.state.openFailed = true; resolve(); return; }
    const finish = () => { try { socket.close(); } catch {} resolve(); };
    socket.addEventListener("message", (event) => tracker.accept(typeof event.data === "string" ? event.data : ""));
    socket.addEventListener("error", () => { tracker.state.errors = (tracker.state.errors || 0) + 1; });
    socket.addEventListener("close", (event) => { tracker.state.closeCode = event.code; resolve(); });
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export async function run(opts, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const WebSocketImpl = deps.WebSocketImpl || globalThis.WebSocket;
  const clock = deps.clock || Date.now;
  const base = opts.base;
  const calls = tally();
  const started = new Date(clock()).toISOString();
  const sessions = [];
  for (let i = 0; i < opts.users; i++) {
    const user = opts.credentials[i % opts.credentials.length];
    const cookie = await signIn(base, user, calls, fetchImpl, clock);
    sessions.push(cookie);
    if (i < opts.users - 1) await sleep(opts.loginGapMs);
  }
  const signedIn = sessions.filter(Boolean);
  const phases = [];
  const pollSeconds = opts.rung === "socket" ? 0 : (opts.rung === "both" ? opts.seconds / 2 : opts.seconds);
  const socketSeconds = opts.rung === "poll" ? 0 : (opts.rung === "both" ? opts.seconds / 2 : opts.seconds);

  if (pollSeconds > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), pollSeconds * 1000);
    await Promise.all(signedIn.map((cookie) => pollMember(base, cookie, calls, opts, controller.signal, fetchImpl, clock)));
    clearTimeout(timer);
    phases.push({ rung: "poll", seconds: pollSeconds, members: signedIn.length });
  }
  const trackers = [];
  if (socketSeconds > 0) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), socketSeconds * 1000);
    await Promise.all(signedIn.map((cookie) => socketMember(base, cookie, trackers, opts, controller.signal, WebSocketImpl)));
    clearTimeout(timer);
    phases.push({ rung: "socket", seconds: socketSeconds, members: signedIn.length });
  }
  const sockets = {
    opened: trackers.length,
    openFailed: trackers.filter((t) => t.state.openFailed).length,
    framesTotal: trackers.reduce((n, t) => n + t.state.frames, 0),
    snapshots: trackers.reduce((n, t) => n + t.state.snapshots, 0),
    sequenceGaps: trackers.reduce((n, t) => n + t.state.gaps, 0),
    bytes: trackers.reduce((n, t) => n + t.state.bytes, 0),
    errors: trackers.reduce((n, t) => n + (t.state.errors || 0), 0),
    bye: trackers.flatMap((t) => t.state.bye),
    closeCodes: trackers.map((t) => t.state.closeCode ?? null),
    framesByTopic: trackers.reduce((acc, t) => { for (const [k, n] of Object.entries(t.state.byTopic)) acc[k] = (acc[k] || 0) + n; return acc; }, {}),
    epochs: new Set(trackers.flatMap((t) => [...t.state.epochs])).size,
  };
  return {
    startedAt: started,
    finishedAt: new Date(clock()).toISOString(),
    base: base.origin,
    users: opts.users,
    signedIn: signedIn.length,
    phases,
    routes: calls.report(),
    sockets,
    dashboard: {
      note: "Read these from the Cloudflare dashboard for the window above and record them next to this report.",
      workerRequests: null,
      durableObjectRequests: null,
      d1RowsRead: null,
      d1RowsWritten: null,
      workerCpuMsP50: null,
      workerCpuMsP99: null,
    },
  };
}

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error("unexpected argument " + arg);
    const key = arg.slice(2);
    if (["priced", "dry-run"].includes(key)) { flags[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error("--" + key + " needs a value");
    flags[key] = value;
  }
  return flags;
}

export async function main(argv, env = process.env, io = { out: (line) => process.stdout.write(line + "\n"), err: (line) => process.stderr.write(line + "\n") }, deps = {}) {
  let flags;
  try { flags = parseArgs(argv); } catch (error) { io.err(error.message); return 2; }
  if (!flags.base) { io.err("usage: staging-load.mjs --base https://staging-host --plan paid|free [--users 20] [--minutes 30] [--rung poll|socket|both] [--priced] [--allow-host host] [--out file] [--dry-run]"); return 2; }
  const target = checkTarget(flags.base, flags["allow-host"]);
  if (!target.ok) { io.err(target.reason); return 2; }
  if (!["paid", "free"].includes(flags.plan)) { io.err("--plan paid|free is required: the load test spends the account's daily caps"); return 2; }
  const rung = flags.rung || "both";
  if (!["poll", "socket", "both"].includes(rung)) { io.err("--rung must be poll, socket or both"); return 2; }
  const users = Number(flags.users || DEFAULTS.users);
  const minutes = Number(flags.minutes || DEFAULTS.minutes);
  const seconds = flags.seconds ? Number(flags.seconds) : minutes * 60;
  if (!Number.isSafeInteger(users) || users < 1 || users > 60) { io.err("--users must be an integer from 1 to 60"); return 2; }
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 4 * 3600) { io.err("--minutes must be between 1 second and four hours"); return 2; }
  const snapMs = Number(flags["snap-ms"] || DEFAULTS.snapMs);
  const boardMs = Number(flags["board-ms"] || DEFAULTS.boardMs);
  if (!(snapMs >= 100) || !(boardMs >= 100)) { io.err("--snap-ms and --board-ms must be at least 100"); return 2; }
  const projected = plan({ users, minutes: seconds / 60, rung, snapMs, boardMs });
  if (flags.plan === "free") {
    if (!flags.priced) { io.err("on the Free plan this run spends the daily caps production shares; read the plan below, then pass --priced"); io.err(JSON.stringify(projected)); return 2; }
    if (projected.freeDailyShare > FREE_BUDGET_SHARE) {
      io.err(`projected ${projected.workerRequests} Worker requests is ${(projected.freeDailyShare * 100).toFixed(0)}% of the Free daily cap of ${FREE_DAILY_REQUESTS}; the limit for a run is ${FREE_BUDGET_SHARE * 100}%`);
      return 2;
    }
  }
  if (flags["dry-run"]) { io.out(JSON.stringify({ dryRun: true, target: target.url.origin, plan: projected })); return 0; }
  let credentials;
  try { credentials = parseUsers(env.LOAD_USERS); } catch (error) { io.err(error.message); return 2; }
  if (credentials.length < 1) { io.err("set LOAD_USERS to name:password pairs for the staging Worker's members (comma-separated)"); return 2; }
  const report = await run({
    base: target.url, users, seconds, rung, snapMs, boardMs, credentials,
    topics: flags.topics || DEFAULTS.topics, focus: flags.focus || DEFAULTS.focus,
    loginGapMs: Number(flags["login-gap-ms"] || DEFAULTS.loginGapMs),
  }, deps);
  report.plan = projected;
  const text = JSON.stringify(report, null, 2);
  if (flags.out) writeFileSync(flags.out, text + "\n", { mode: 0o600 });
  io.out(flags.out ? JSON.stringify({ wrote: flags.out, signedIn: report.signedIn, users }) : text);
  return report.signedIn === users ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main(process.argv.slice(2));
}
