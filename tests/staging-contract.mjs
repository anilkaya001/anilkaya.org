import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unstable_readConfig } from "wrangler";
import { servedFiles } from "./lib/served-tree.mjs";
import {
  baseOf, checkHealth, checkPage, probeOnce, smoke, nextState, readState, messageFor, notify, main as probeMain,
} from "../scripts/ops-probe.mjs";
import {
  PRODUCTION_HOSTS, checkTarget, parseUsers, plan, pct, tally, frameTracker, signIn, run as loadRun, main as loadMain,
  FREE_DAILY_REQUESTS, FREE_BUDGET_SHARE, DEFAULTS,
} from "../scripts/staging-load.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const quiet = () => {
  const lines = { out: [], err: [] };
  return { lines, io: { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) } };
};

{
  const quietWarn = process.emitWarning;
  process.emitWarning = () => {};
  let staging, production;
  try {
    staging = unstable_readConfig({ config: path.join(ROOT, "wrangler.staging.toml") });
    production = unstable_readConfig({ config: path.join(ROOT, "wrangler.toml") });
  } finally { process.emitWarning = quietWarn; }

  ok(staging.name === "anilkaya-staging" && staging.name !== production.name, "the staging Worker has a name of its own");
  eq(staging.main && path.basename(staging.main), "worker.js", "and runs the same entrypoint");
  eq(staging.compatibility_date, production.compatibility_date, "on the same compatibility date, so it describes the runtime that serves the site");
  eq(staging.assets, production.assets, "serves the same static bundle with the same routing");
  const stagingDb = staging.d1_databases[0];
  const productionDb = production.d1_databases[0];
  ok(stagingDb.binding === "DB" && productionDb.binding === "DB", "both bind the database as DB");
  ok(stagingDb.database_name !== productionDb.database_name && stagingDb.database_id !== productionDb.database_id,
     "staging has its own D1 database: its name and id are not production's");
  ok(staging.d1_databases.length === 1, "and binds no second database");
  eq(staging.durable_objects.bindings, production.durable_objects.bindings, "staging has its own PULSE binding to the same Pulse class");
  eq(staging.migrations, production.migrations, "and the Durable Object migration that creates it");
  ok(!staging.triggers || !staging.triggers.crons || staging.triggers.crons.length === 0,
     "staging registers no Cron Trigger: the limit is per account and production uses four");
  ok(!staging.routes || staging.routes.length === 0, "staging has no route or custom domain");
  ok(!staging.ai, "staging binds no Workers AI: a load test cannot spend neurons");
  eq(staging.ratelimits.map((r) => r.name).sort(), production.ratelimits.map((r) => r.name).sort(),
     "every rate-limit binding production has, staging has");
  const mine = new Set(staging.ratelimits.map((r) => r.namespace_id));
  ok(production.ratelimits.every((r) => !mine.has(r.namespace_id)), "under namespaces of their own, so a flood on staging never counts against production");
  for (const r of staging.ratelimits) {
    const twin = production.ratelimits.find((p) => p.name === r.name);
    eq(r.simple, twin.simple, `${r.name} has production's limit and period`);
  }
  eq(staging.vars.FLOWS_LIVE_MODE, "off", "staging never dispatches the live or nightly workflows");
  ok(!("FLOWS_LIVE_REPO" in staging.vars) && !("FLOWS_NIGHTLY_WORKFLOW" in staging.vars) && !("FLOWS_LIVE_WORKFLOW" in staging.vars),
     "and names no repository or workflow to dispatch");
  eq(staging.vars.FLOWS_READ_MODE, "off", "and its readings are the deterministic ones");
  eq(staging.vars.FLOWS_RT_MODE, "on", "the rail is on, so the socket rung can be measured");
  eq(staging.vars.FLOWS_RT_AUDIENCE, "members", "for members, so simulated members can open sockets");
  const text = readFileSync(path.join(ROOT, "wrangler.staging.toml"), "utf8");
  ok(!/^\s*(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|SESSION_SECRET|FLOWS_PEPPER|FLOWS_CREDENTIALS|UW_API_KEY|FLOWS_INGEST|FLOWS_GITHUB)\w*\s*=/m.test(text),
     "the staging file carries no secret: its own are set with wrangler secret put");
  ok(!/^\s*(#|\/\/)/m.test(text), "and no comment, as in every source file");
  const assetsIgnore = readFileSync(path.join(ROOT, ".assetsignore"), "utf8");
  ok(/^wrangler\.\*\.toml$/m.test(assetsIgnore) || /^wrangler\.staging\.toml$/m.test(assetsIgnore), ".assetsignore keeps the staging config out of the static bundle");
  ok(!servedFiles().includes("wrangler.staging.toml"), "so it is not in the served tree");
}

const server = async (handler) => {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const open = new Set();
  s.on("connection", (socket) => { open.add(socket); socket.on("close", () => open.delete(socket)); });
  return { s, url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((resolve) => { for (const socket of open) socket.destroy(); s.close(resolve); }) };
};

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};
const html = (res, title = "Sign in") => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  res.end(`<!doctype html><title>${title}</title><p>x`);
};

{
  eq(baseOf("https://anilkaya.org/some/path?x=1#y").toString(), "https://anilkaya.org/", "a base is reduced to its origin");
  assert.throws(() => baseOf("ftp://x"), /http/); checks++;
  assert.throws(() => baseOf("https://user:pw@x.test"), /credentials/); checks++;
  assert.throws(() => baseOf("nonsense"), /absolute/); checks++;

  const state = { mode: "up" };
  const hits = [];
  const s = await server((req, res) => {
    hits.push(req.url);
    if (req.url === "/api/health") {
      if (state.mode === "down") return sendJson(res, 500, { error: { code: "x" } });
      if (state.mode === "degraded") return sendJson(res, 200, { ok: false, version: { id: "abc" } });
      if (state.mode === "slow") return;
      if (state.mode === "text") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("fine"); }
      if (state.mode === "garbage") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{nope"); }
      return sendJson(res, 200, { ok: true, version: { id: "abc", tag: "t" } });
    }
    if (req.url === "/flows/login/") {
      if (state.mode === "page-down") { res.writeHead(502); return res.end("bad gateway"); }
      if (state.mode === "no-title") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<p>hello"); }
      return html(res);
    }
    if (req.url === "/api/me") return sendJson(res, 200, { user: null });
    res.writeHead(404); res.end();
  });
  const base = baseOf(s.url);
  try {
    const run = (extra = {}) => probeOnce({ base, timeoutMs: 400, ...extra });
    let r = await run();
    ok(r.ok && r.checks.length === 2 && r.checks.every((c) => c.ok && c.status === 200 && Number.isFinite(c.ms)), "a healthy Worker passes both checks");
    state.mode = "down"; r = await run();
    ok(!r.ok && r.checks[0].reason === "status 500" && r.checks[1].ok, "a 500 from health fails that check alone and names the status");
    state.mode = "degraded"; r = await run();
    ok(!r.ok && /ok is false/.test(r.checks[0].reason), "ok: false is a failure");
    state.mode = "text"; r = await run();
    ok(!r.ok && /not JSON/.test(r.checks[0].reason), "a non-JSON health body is a failure");
    state.mode = "garbage"; r = await run();
    ok(!r.ok && /unreadable/.test(r.checks[0].reason), "an unreadable body is a failure");
    state.mode = "slow"; const t0 = Date.now(); r = await run();
    ok(!r.ok && r.checks[0].reason === "timeout" && Date.now() - t0 < 3000, "a hung health route is a timeout at the deadline, not a hang");
    state.mode = "page-down"; r = await run();
    ok(!r.ok && r.checks[0].ok && /status 502/.test(r.checks[1].reason), "a failing page is a failure of the page check alone");
    state.mode = "no-title"; r = await run();
    ok(!r.ok && /no title/.test(r.checks[1].reason), "a page with no title is a failure");
    state.mode = "up";
    r = await probeOnce({ base, healthPath: "/api/me", timeoutMs: 400 });
    ok(r.ok, "the health path is configurable, and a body with no ok field passes on a 200 JSON answer (/api/me)");
    const dead = await server(() => {});
    const deadBase = baseOf(dead.url);
    await dead.close();
    r = await probeOnce({ base: deadBase, timeoutMs: 400 });
    ok(!r.ok && r.checks.every((c) => c.reason === "network"), "a refused connection is a network failure on both checks");

    let st = { fails: 0, down: false, since: null };
    const steps = [];
    for (const good of [false, false, false, true, true, false, true]) {
      const { next, event } = nextState(st, good, 2, "T");
      steps.push([event, next.fails]);
      st = next;
    }
    eq(steps, [[null, 1], ["down", 2], [null, 3], ["recovered", 0], [null, 0], [null, 1], [null, 0]],
       "two consecutive failures open an incident once, a recovery closes it once, and a single blip never alerts");
    eq(nextState({ fails: 0, down: false, since: null }, false, 1, "T").event, "down", "--fail-after 1 alerts on the first failure");

    const hooks = [];
    const hook = await server((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => { hooks.push({ url: req.url, body: JSON.parse(body) }); res.writeHead(204); res.end(); });
    });
    const dir = mkdtempSync(path.join(tmpdir(), "probe-"));
    const stateFile = path.join(dir, "state.json");
    const env = { PROBE_WEBHOOK_URL: hook.url + "/hook/secret-path-4f9c" };
    try {
      const { lines, io } = quiet();
      const argv = ["probe", "--base", s.url, "--timeout", "400", "--state", stateFile];
      state.mode = "down";
      eq(await probeMain(argv, env, io), 1, "a failing probe exits 1");
      eq(hooks.length, 0, "the first failure alerts nobody");
      eq(await probeMain(argv, env, io), 1, "the second also exits 1");
      eq(hooks.length, 1, "and the second opens the incident with one webhook post");
      ok(/is not answering: health: status 500/.test(hooks[0].body.text) && hooks[0].body.text.includes(new URL(s.url).host), "naming the host and the failing check");
      ok(!JSON.stringify(hooks[0].body).includes("secret-path-4f9c"), "and never the webhook address");
      eq(await probeMain(argv, env, io), 1, "a third failure");
      eq(hooks.length, 1, "does not alert again");
      state.mode = "up";
      eq(await probeMain(argv, env, io), 0, "a healthy probe exits 0");
      eq(hooks.length, 2, "and posts the recovery once");
      ok(/answering again/.test(hooks[1].body.text), "in words");
      eq(await probeMain(argv, env, io), 0, "and stays quiet afterwards");
      eq(hooks.length, 2, "with nothing more posted");
      ok(!lines.out.join("").includes("secret-path-4f9c") && !lines.err.join("").includes("secret-path-4f9c"), "the webhook address is in no output");
      const last = JSON.parse(lines.out[lines.out.length - 1]);
      ok(last.ok === true && Array.isArray(last.checks) && last.event === null, "each run prints one JSON line");
      ok((statSync(stateFile).mode & 0o777) === 0o600, "the state file is private");
      eq(readState(path.join(dir, "missing.json")), { fails: 0, down: false, since: null }, "a missing or unreadable state file is a clean start");
      const bare = quiet();
      eq(await probeMain(["probe", "--base", s.url, "--timeout", "400"], {}, bare.io), 0, "with no webhook configured and no state file, the probe still runs and reports");
      eq(await probeMain(["probe"], {}, bare.io), 2, "a missing base is a usage error");
      eq(await probeMain(["probe", "--base", s.url, "--fail-after", "0"], {}, bare.io), 2, "and so is a fail-after outside 1..60");
      eq(await probeMain(["probe", "--base", s.url, "--timeout", "5"], {}, bare.io), 2, "and a timeout below 100 ms");
      eq(await probeMain(["nonsense", "--base", s.url], {}, bare.io), 2, "and an unknown command");
      eq(await notify("", "x"), false, "no webhook means no post");
      eq(await notify("http://127.0.0.1:9/nope", "x"), false, "and an unreachable webhook is a false, never a throw");
      ok(messageFor("down", s.url, { checks: [{ ok: false, name: "page", reason: "timeout" }, { ok: true, name: "health" }] }, null).includes("page: timeout"), "the alert lists only the failing checks");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await hook.close();
    }
  } finally {
    await s.close();
  }
}

{
  const mutate = { drop: null, logout: 405, board: 401, rail: 404, versionCache: "public, max-age=3600", cssCache: "public, max-age=31536000, immutable", hsts: true, redirect: true };
  const SECURITY = {
    "Strict-Transport-Security": "max-age=31536000", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY", "Cross-Origin-Opener-Policy": "same-origin", "Permissions-Policy": "geolocation=()", "X-Permitted-Cross-Domain-Policies": "none",
  };
  const s = await server((req, res) => {
    const headers = { ...SECURITY };
    if (!mutate.hsts) delete headers["Strict-Transport-Security"];
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html", "Cache-Control": "no-cache", "Content-Security-Policy": "default-src 'self'" }); return res.end("<title>x</title>"); }
    if (url.pathname === "/lab/course") {
      if (!mutate.redirect) { res.writeHead(200); return res.end("ok"); }
      res.writeHead(308, { Location: "/lab/ordinary-least-squares/" }); return res.end();
    }
    if (url.pathname === "/lab/ordinary-least-squares/") { res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" }); return res.end('<title>OLS</title><link rel="canonical" href="https://anilkaya.org/x"><script type="application/ld+json">{}</script>'); }
    if (url.pathname === "/api/me") return sendJson(res, 200, { user: null });
    if (url.pathname === "/api/no-such-route") return sendJson(res, 404, { error: { code: "not_found", message: "x" } });
    if (url.pathname === "/auth/logout") return sendJson(res, mutate.logout, { error: { code: "method_not_allowed" } }, { Allow: "POST" });
    if (url.pathname === "/api/flows/board") return sendJson(res, mutate.board, { error: { code: "unauthorized" } });
    if (url.pathname === "/api/rt/snap") return sendJson(res, mutate.rail, { error: { code: "rt_off" } });
    if (url.pathname === "/assets/version.txt") { res.writeHead(200, { "Cache-Control": mutate.versionCache, "Content-Type": "text/plain" }); return res.end("246\n"); }
    if (url.pathname === "/assets/css/base.css") { res.writeHead(200, { ...headers, "Cache-Control": mutate.cssCache, "Content-Type": "text/css" }); return res.end("body{}"); }
    res.writeHead(404); res.end();
  });
  const base = baseOf(s.url);
  try {
    let r = await smoke(base, { timeoutMs: 2000 });
    ok(r.ok && r.checks.length === 10, `a Worker that keeps its contract passes all ${r.checks.length} smoke checks`);
    const failing = async (name, change, restore, pattern) => {
      change();
      const out = await smoke(base, { timeoutMs: 2000 });
      restore();
      ok(!out.ok && out.checks.some((c) => !c.ok && pattern.test(c.reason)), `smoke catches ${name}`);
    };
    await failing("a missing HSTS header", () => { mutate.hsts = false; }, () => { mutate.hsts = true; }, /strict-transport-security/);
    await failing("a legacy course URL that stopped redirecting", () => { mutate.redirect = false; }, () => { mutate.redirect = true; }, /status 200/);
    await failing("a GET logout that works", () => { mutate.logout = 200; }, () => { mutate.logout = 405; }, /GET logout/);
    await failing("an ungated Flows API", () => { mutate.board = 200; }, () => { mutate.board = 401; }, /anonymous board/);
    await failing("an ungated rail", () => { mutate.rail = 200; }, () => { mutate.rail = 404; }, /rail snapshot/);
    await failing("a versioned asset that lost its immutable policy", () => { mutate.cssCache = "public, max-age=3600"; }, () => { mutate.cssCache = "public, max-age=31536000, immutable"; }, /not immutable/);
    await failing("a version token with the wrong lifetime", () => { mutate.versionCache = "public, max-age=60"; }, () => { mutate.versionCache = "public, max-age=3600"; }, /one hour/);
    const { lines, io } = quiet();
    eq(await probeMain(["smoke", "--base", s.url], {}, io), 0, "the smoke command exits 0 on a conforming Worker");
    ok(JSON.parse(lines.out[0]).checks.length === 10, "and prints its checks as one JSON line");
  } finally {
    await s.close();
  }
}

{
  const prod = ["https://anilkaya.org", "https://www.anilkaya.org/", "https://ANILKAYA.ORG", "https://staging.anilkaya.org", "https://x.anilkaya.org/path"];
  for (const u of prod) ok(!checkTarget(u, new URL(u).hostname).ok && /production/.test(checkTarget(u, new URL(u).hostname).reason), `${u} is refused, even when named with --allow-host`);
  ok(checkTarget("https://anilkaya-staging.example.workers.dev").ok, "a staging workers.dev host is accepted");
  ok(checkTarget("http://127.0.0.1:8787").ok && checkTarget("http://localhost:8787").ok, "loopback http is accepted");
  ok(!checkTarget("http://anilkaya-staging.example.workers.dev").ok, "plain http to a remote host is refused");
  ok(!checkTarget("https://example.com").ok && /--allow-host example\.com/.test(checkTarget("https://example.com").reason), "a host that is not obviously staging needs --allow-host");
  ok(checkTarget("https://example.com", "example.com").ok, "and with it is accepted");
  ok(!checkTarget("https://example.com", "other.com").ok, "but only for the host it names");
  ok(!checkTarget("not a url").ok, "garbage is refused");
  eq([...PRODUCTION_HOSTS], ["anilkaya.org", "www.anilkaya.org"], "the production hosts are the two this repository serves");

  eq(parseUsers("a:b,c:d:e"), [{ name: "a", password: "b" }, { name: "c", password: "d:e" }], "LOAD_USERS splits on the first colon");
  assert.throws(() => parseUsers("nocolon"), /name:password/); checks++;
  eq(parseUsers(""), [], "an empty list is empty");

  const p = plan({ users: 20, minutes: 30, rung: "both", snapMs: 5000, boardMs: 60000 });
  eq([p.snaps, p.boards, p.logins, p.sockets], [3600, 300, 20, 20], "20 members for 30 minutes, half on the poll rung: 3,600 snapshots, 300 board reads, 20 sign-ins, 20 sockets");
  eq(p.workerRequests, 3940, "3,940 Worker requests in all");
  ok(Math.abs(p.freeDailyShare - 3940 / FREE_DAILY_REQUESTS) < 1e-12, "priced as a share of the Free daily cap");
  const poll = plan({ users: 20, minutes: 30, rung: "poll", snapMs: 5000, boardMs: 60000 });
  eq([poll.snaps, poll.boards, poll.sockets], [7200, 600, 0], "the poll rung alone for the whole window");
  eq(pct([5, 1, 3, 2, 4], 0.5), 3, "the median");
  eq(pct([], 0.95), null, "of nothing is nothing");
  const t = tally();
  t.add("GET /x", 200, 10); t.add("GET /x", 429, 20); t.add("GET /x", 503, 30); t.add("GET /x", 404, 40); t.add("GET /x", 0, 0);
  eq(t.report()["GET /x"], { requests: 5, ok: 1, limited429: 1, client4xx: 1, server5xx: 1, failed: 1, p50ms: 30, p95ms: 40, maxMs: 40 }, "the tally separates ok, limited, client, server and failed requests");

  const f = frameTracker();
  for (const frame of [
    { k: "px", ep: 1, sq: 4, snap: true }, { k: "px", ep: 1, sq: 5 }, { k: "px", ep: 1, sq: 7 }, { k: "fl", ep: 1, sq: 1 },
    { k: "px", ep: 2, sq: 1 }, { k: "ctl", t: "hello" }, { k: "ctl", t: "bye", reason: "cap", code: 4009 },
  ]) f.accept(JSON.stringify(frame));
  f.accept("not json");
  eq([f.state.frames, f.state.snapshots, f.state.gaps, f.state.epochs.size], [7, 1, 1, 2], "frames, snapshots, one gap (5 to 7) and two epochs are counted");
  eq(f.state.bye, [{ reason: "cap", code: 4009 }], "and a bye is recorded with its code");

  const none = quiet();
  const noNet = () => { throw new Error("no network"); };
  const dry = async (argv, env = {}) => loadMain(argv, env, none.io, { fetchImpl: noNet, WebSocketImpl: noNet });
  eq(await dry(["--base", "https://anilkaya.org", "--plan", "paid"]), 2, "main refuses production");
  ok(none.lines.err.some((l) => /production/.test(l)), "and says why");
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev"]), 2, "a plan is required");
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "free"]), 2, "the Free plan is refused until the run is priced");
  const big = plan({ users: 60, minutes: 120, rung: "poll", snapMs: 5000, boardMs: 60000 });
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "free", "--priced", "--users", "60", "--minutes", "120", "--rung", "poll", "--dry-run"]), 2,
     `and priced, a run that would spend over ${FREE_BUDGET_SHARE * 100}% of the Free daily cap (${big.workerRequests} requests) is still refused`);
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "paid", "--users", "60", "--minutes", "120", "--rung", "poll", "--dry-run"]), 0, "the same run is accepted on the Paid plan");
  none.lines.out.length = 0;
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "free", "--priced", "--users", "5", "--minutes", "5", "--dry-run"]), 0, "a small run on Free is accepted once priced");
  eq(JSON.parse(none.lines.out[0]).dryRun, true, "and a dry run only prints the plan");
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "paid", "--users", "61"]), 2, "more than 60 members is refused");
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "paid", "--rung", "x"]), 2, "an unknown rung is refused");
  eq(await dry(["--base", "https://anilkaya-staging.x.workers.dev", "--plan", "paid"], {}), 2, "without LOAD_USERS a real run is refused");
  eq(DEFAULTS.users, 20, "the default is 20 simulated members");
  eq(DEFAULTS.minutes, 30, "for 30 minutes");
  ok(DEFAULTS.loginGapMs * 10 >= 60000, "and sign-ins are paced under the 10 a minute per-address login limit");
}

{
  const logins = [];
  const sessions = new Map();
  const frames = [];
  let loginWindow = { start: Date.now(), n: 0 };
  const s = await server((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/flows/login" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        logins.push({ at: Date.now(), name: form.get("username") });
        const now = Date.now();
        if (now - loginWindow.start > 1500) loginWindow = { start: now, n: 0 };
        loginWindow.n++;
        if (loginWindow.n > 3) { res.writeHead(429, { "Retry-After": "1", "Content-Type": "text/html" }); return res.end("<title>x</title>"); }
        if (form.get("password") !== "pw-" + form.get("username")) { res.writeHead(401); return res.end("no"); }
        const token = crypto.randomBytes(8).toString("hex");
        sessions.set(token, form.get("username"));
        res.writeHead(303, { Location: "/flows/", "Set-Cookie": `flows_session=${token}; Path=/; HttpOnly` });
        res.end();
      });
      return;
    }
    const cookie = /flows_session=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
    if (!cookie || !sessions.has(cookie)) return sendJson(res, 401, { error: { code: "unauthorized" } });
    if (url.pathname === "/api/rt/snap") return sendJson(res, 200, [{ v: 1, k: "px", sq: 1, rows: [] }]);
    if (url.pathname === "/api/flows/board") return sendJson(res, 200, { ok: true });
    res.writeHead(404); res.end();
  });
  s.s.on("upgrade", (req, socket) => {
    const cookie = /flows_session=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
    if (!cookie || !sessions.has(cookie)) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("error", () => {});
    const send = (obj) => {
      const body = Buffer.from(JSON.stringify(obj));
      socket.write(Buffer.concat([Buffer.from([0x81, body.length]), body]));
    };
    frames.push(req.url);
    send({ v: 1, k: "ctl", t: "hello", sq: 0 });
    send({ v: 1, k: "px", ep: 5, sq: 10, snap: true, rows: [] });
    send({ v: 1, k: "px", ep: 5, sq: 11, rows: [] });
    send({ v: 1, k: "px", ep: 5, sq: 13, rows: [] });
  });
  try {
    const base = new URL(s.url);
    const users = Array.from({ length: 6 }, (_, i) => ({ name: "m" + i, password: "pw-m" + i }));
    const none = quiet();
    const dir = mkdtempSync(path.join(tmpdir(), "load-"));
    try {
      const out = path.join(dir, "report.json");
      const t0 = Date.now();
      const code = await loadMain(
        ["--base", s.url, "--plan", "paid", "--users", "6", "--seconds", "3", "--rung", "both", "--snap-ms", "200", "--board-ms", "500", "--login-gap-ms", "0", "--out", out],
        { LOAD_USERS: users.map((u) => u.name + ":" + u.password).join(",") }, none.io,
      );
      const report = JSON.parse(readFileSync(out, "utf8"));
      eq(code, 0, `a run against a conforming server signs every member in and exits 0 (${Date.now() - t0} ms)`);
      eq(report.signedIn, 6, "all six members signed in");
      ok(logins.length > 6, `the 429 on sign-in was waited out and retried (${logins.length} attempts for 6 members)`);
      ok(report.routes["POST /flows/login"].limited429 > 0 && report.routes["POST /flows/login"].ok === 6, "and the report counts the limited attempts apart from the six successes");
      ok(report.routes["GET /api/rt/snap"].requests >= 6 && report.routes["GET /api/rt/snap"].ok === report.routes["GET /api/rt/snap"].requests, "the poll rung read snapshots");
      ok(report.routes["GET /api/flows/board"].requests >= 6, "and the board");
      ok(Number.isFinite(report.routes["GET /api/rt/snap"].p95ms), "with latency percentiles");
      eq(report.phases.map((p) => p.rung), ["poll", "socket"], "both rungs ran, one after the other");
      eq(report.sockets.opened, 6, "six sockets opened on the socket rung");
      ok(report.sockets.framesTotal >= 6 * 4, `and frames were counted (${report.sockets.framesTotal})`);
      eq(report.sockets.sequenceGaps, 6, "one sequence gap per socket was found (11 to 13)");
      eq(report.sockets.snapshots, 6, "and one snapshot");
      ok(report.sockets.framesByTopic.px === 6 * 3 && report.sockets.framesByTopic.ctl === 6, "by topic");
      ok(frames.every((u) => /k=px%2Cfl%2Cmk%2Cnw/.test(u) && /f=SPY/.test(u)), "the sockets asked for the four topics and a focus ticker");
      eq(Object.keys(report.dashboard).filter((k) => report.dashboard[k] === null).length, 6, "the dashboard readings are left for the owner to fill in");
      ok(!JSON.stringify(report).includes("pw-m0"), "no password is in the report");
      ok((statSync(out).mode & 0o777) === 0o600, "and the report file is private");
      eq(report.plan.users, 6, "the report carries the plan it was run under");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const calls = tally();
    const cookie = await signIn(base, { name: "m1", password: "wrong" }, calls);
    eq(cookie, null, "a wrong password is a 401 and not retried forever");
    ok(calls.report()["POST /flows/login"].client4xx >= 1, "and counted");

    const closedSession = await loadRun({
      base, users: 2, seconds: 1, rung: "socket", snapMs: 200, boardMs: 500, credentials: [{ name: "m1", password: "pw-m1" }], loginGapMs: 0,
      topics: "px", focus: "SPY",
    }, { WebSocketImpl: class { constructor() { throw new Error("blocked"); } } });
    eq(closedSession.sockets.openFailed, 2, "a socket that cannot be opened is counted, not thrown");
  } finally {
    await s.close();
  }
}

console.log(`✓ staging: ${checks} checks`);
