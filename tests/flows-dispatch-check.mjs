import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_OWNER, FIXTURE_MEMBER } from "./lib/fixture-roster.mjs";
import { memoClock } from "../shared/flows-live-worker.js";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { flowsDispatchRows } from "../server/routes/flows-dispatch.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const SECRET = "dispatch-check-session-secret-abcdefghijklmnopqrstuvwxyz";
const TOKEN = ["ghp", "DispatchCheckSecretTokenValue0123456789"].join("_");
const URL_BASE = "https://anilkaya.org";
const PATH = "/api/flows/dispatch-check";
const realFetch = globalThis.fetch;
const realNow = Date.now;
const realConsole = { error: console.error, warn: console.warn };

const tokens = {
  owner: await signFlowsSession(FIXTURE_OWNER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
  member: await signFlowsSession(FIXTURE_MEMBER, SECRET, 3600, sessionEpoch({ SESSION_SECRET: SECRET })),
};

const envOf = (D1, extra = {}) => ({
  DB: D1, SESSION_SECRET: SECRET, FLOWS_PEPPER: "dispatch-check-pepper", FLOWS_READ_MODE: "off",
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  FLOWS_CREDENTIALS: JSON.stringify({ [FIXTURE_OWNER]: "x".repeat(43), [FIXTURE_MEMBER]: "y".repeat(43) }),
  ...extra,
});

let instance = 0;
const loadWorker = async () => (await import("../worker.js?dispatch=" + (++instance))).default;

function scripted(readStep, dispatchStep) {
  const calls = [];
  const answer = (step) => {
    if (step === "throw") throw new TypeError("network down " + TOKEN);
    return new Response(step === 204 ? null : step === 200 ? '{"id":1}' : "{}", { status: step });
  };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init && init.method, headers: init && init.headers, body: init && init.body });
    return answer(init && init.method === "POST" ? dispatchStep : readStep);
  };
  return calls;
}

async function call(worker, env, { principal = "owner", method = "POST", headers = {} } = {}) {
  const h = { "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", ...headers };
  if (principal !== "anon") h.cookie = FLOWS_COOKIE + "=" + tokens[principal];
  const bg = [];
  const res = await worker.fetch(new Request(URL_BASE + PATH, { method, headers: h, body: method === "POST" ? "{}" : undefined }), env,
    { waitUntil: (p) => bg.push(Promise.resolve(p).catch(() => {})) });
  const text = await res.text();
  await Promise.all(bg);
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { res, text, body };
}

const dispatchWhy = (f) => {
  const r = f.db.prepare("SELECT dispatch_why FROM flows_clock WHERE id = 1").get();
  return r ? r.dispatch_why : undefined;
};

console.error = console.warn = () => {};
try {
  {
    const f = fakeD1({ latencyMs: 0 });
    memoClock(null, 0);
    const worker = await loadWorker();
    const calls = scripted(200, 204);
    const env = envOf(f.D1, { GITHUB_DISPATCH_TOKEN: TOKEN });
    const anon = await call(worker, env, { principal: "anon" });
    eq(anon.res.status, 401, "anonymous is 401");
    const member = await call(worker, env, { principal: "member" });
    eq(member.res.status, 403, "a member is 403");
    eq(member.body.error.code, "owner_only", "with owner_only");
    const cross = await call(worker, env, { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } });
    eq(cross.res.status, 403, "a cross-origin owner call is 403");
    const get = await call(worker, env, { method: "GET" });
    eq(get.res.status, 405, "GET is 405");
    eq(calls.length, 0, "none of those reached GitHub");
    eq(dispatchWhy(f), undefined, "and none wrote the clock");
  }

  const matrix = [
    { name: "read 200, dispatch 204", read: 200, dispatch: 204, ok: true, readWhy: "ok", sent: true, why: "sent", outcome: "sent" },
    { name: "read 401, dispatch 401", read: 401, dispatch: 401, ok: false, readWhy: "bad-token", sent: false, why: "refused", outcome: "refused:401" },
    { name: "read 403, dispatch 403", read: 403, dispatch: 403, ok: false, readWhy: "no-access", sent: false, why: "refused", outcome: "refused:403" },
    { name: "read 404, dispatch 404", read: 404, dispatch: 404, ok: false, readWhy: "no-access", sent: false, why: "refused", outcome: "refused:404" },
    { name: "read 200, dispatch 403", read: 200, dispatch: 403, ok: false, readWhy: "ok", sent: false, why: "refused", outcome: "refused:403" },
    { name: "read 500, dispatch 204", read: 500, dispatch: 204, ok: false, readWhy: "unexpected", sent: true, why: "sent", outcome: "sent" },
    { name: "network error on both", read: "throw", dispatch: "throw", ok: false, readWhy: "unreachable", sent: false, why: "unreachable", outcome: "unreachable" },
  ];
  for (const c of matrix) {
    const f = fakeD1({ latencyMs: 0 });
    memoClock(null, 0);
    const worker = await loadWorker();
    const calls = scripted(c.read, c.dispatch);
    const env = envOf(f.D1, { GITHUB_DISPATCH_TOKEN: "  " + TOKEN + "  " });
    const r = await call(worker, env);
    eq(r.res.status, 200, c.name + ": answered 200");
    eq(r.res.headers.get("Cache-Control"), "no-store", c.name + ": no-store");
    eq(r.body.ok, c.ok, c.name + ": ok");
    eq(r.body.read.why, c.readWhy, c.name + ": read why");
    eq(r.body.read.status, typeof c.read === "number" ? c.read : null, c.name + ": read status");
    eq(r.body.dispatch.sent, c.sent, c.name + ": dispatch sent");
    eq(r.body.dispatch.why, c.why, c.name + ": dispatch why");
    eq(r.body.dispatch.status, typeof c.dispatch === "number" ? c.dispatch : null, c.name + ": dispatch status");
    eq(r.body.repo, "anilkaya001/anilkaya.org", c.name + ": repo");
    eq(r.body.workflow, "flows-live.yml", c.name + ": workflow");
    ok(Number.isFinite(Date.parse(r.body.at)), c.name + ": at is an instant");
    eq(r.body.recorded, true, c.name + ": recorded");
    eq(dispatchWhy(f), c.outcome, c.name + ": flows_clock.dispatch_why");
    ok(!r.text.includes(TOKEN) && !/bearer|authorization|ghp_/i.test(r.text), c.name + ": no token or header value in the body");
    for (const [k, v] of r.res.headers) ok(!String(v).includes(TOKEN), c.name + ": header " + k + " carries no token");
    eq(calls.length, 2, c.name + ": two GitHub calls");
    eq(calls[0].method, "GET", c.name + ": the read is a GET");
    eq(calls[0].url, "https://api.github.com/repos/anilkaya001/anilkaya.org/actions/workflows/flows-live.yml", c.name + ": the read URL");
    eq(calls[1].method, "POST", c.name + ": the dispatch is a POST");
    ok(calls[1].url.endsWith("/actions/workflows/flows-live.yml/dispatches"), c.name + ": the dispatch URL");
    eq(JSON.parse(calls[1].body).inputs, { origin: "manual", drill: "true" }, c.name + ": the drill inputs");
    eq(calls[0].headers.Authorization, "Bearer " + TOKEN, c.name + ": the Worker's token is what is sent");
  }

  {
    const f = fakeD1({ latencyMs: 0 });
    memoClock(null, 0);
    const worker = await loadWorker();
    const calls = scripted(200, 204);
    const r = await call(worker, envOf(f.D1));
    eq(r.res.status, 200, "no token: 200");
    eq(r.body.ok, false, "not ok");
    eq(r.body.read.why, "no-token", "read says no-token");
    eq(r.body.dispatch.why, "no-token", "dispatch says no-token");
    eq(r.body.recorded, false, "nothing recorded");
    eq(calls.length, 0, "no GitHub call");
    eq(dispatchWhy(f), undefined, "clock untouched");
  }

  {
    const f = fakeD1({ latencyMs: 0 });
    memoClock(null, 0);
    const worker = await loadWorker();
    scripted(200, 204);
    const env = envOf(f.D1, { GITHUB_DISPATCH_TOKEN: TOKEN });
    const first = await call(worker, env);
    eq(first.res.status, 200, "first call");
    const second = await call(worker, env);
    eq(second.res.status, 429, "a second call inside 60 s is 429");
    eq(second.res.headers.get("Retry-After"), "60", "with Retry-After 60");
    eq(second.body.error.code, "rate_limited", "rate_limited");
    const base = realNow();
    Date.now = () => base + 61000;
    const third = await call(worker, env);
    Date.now = realNow;
    eq(third.res.status, 200, "after 60 s it is allowed again");
  }

  {
    const f = fakeD1({ latencyMs: 0 });
    memoClock(null, 0);
    const worker = await loadWorker();
    scripted(200, 204);
    f.db.exec("DROP TABLE IF EXISTS flows_clock");
    const r = await call(worker, envOf(f.D1, { GITHUB_DISPATCH_TOKEN: TOKEN }));
    ok(r.res.status === 200 && r.body.dispatch.sent === true, "a store that cannot record still returns the check");
  }

  const SOURCE = readFileSync(new URL("../server/routes/flows-dispatch.js", import.meta.url), "utf8");

  async function build(transform) {
    const text = transform(SOURCE).replace('"../http.js"', JSON.stringify(new URL("../server/http.js", import.meta.url).href));
    const mod = await import("data:text/javascript;base64," + Buffer.from(text).toString("base64"));
    return mod.flowsDispatchRows;
  }

  async function judge(factory) {
    const failures = [];
    const note = (cond, why) => { if (!cond) failures.push(why); };
    const secret = "ghp_judge_secret";
    const stage = (over = {}) => {
      let claimed = 0;
      const trace = { checks: 0, recorded: [] };
      const deps = {
        ensureFlowsTables: async () => {},
        check: async () => { trace.checks++; return { read: { status: 200, why: "ok" }, dispatch: { sent: true, status: 204, why: "sent" }, repo: "o/r", workflow: "w.yml", outcome: "sent" }; },
        record: async (env, why, at) => { trace.recorded.push(why); return true; },
        isOwner: (env, name) => name === "owner",
        claim: () => (claimed++ === 0),
        now: () => 1790000000000,
        ...over,
      };
      const [row] = factory(deps);
      const run = async (name, origin) => {
        const headers = new Headers(origin ? { Origin: origin } : {});
        try {
          const res = await row.handler({ request: new Request("https://anilkaya.org" + PATH, { method: "POST", headers }), env: { GITHUB_DISPATCH_TOKEN: secret }, session: { username: name } });
          return { status: res.status, text: await res.text() };
        } catch (error) {
          return { status: error && error.status, code: error && error.code, text: "" };
        }
      };
      return { run, trace };
    };
    {
      const s = stage();
      const r = await s.run("owner");
      note(r.status === 200, "owner is answered");
      note(!r.text.includes(secret), "the body carries no token");
      note(s.trace.checks === 1 && s.trace.recorded[0] === "sent", "the owner's check runs and is recorded");
    }
    {
      const s = stage();
      const r = await s.run("member");
      note(r.status === 403 && s.trace.checks === 0, "a member is refused before any check");
    }
    {
      const s = stage();
      const r = await s.run("owner", "https://evil.example");
      note(r.status === 403 && s.trace.checks === 0, "a cross-origin call is refused before any check");
    }
    {
      const s = stage();
      await s.run("owner");
      const r = await s.run("owner");
      note(r.status === 429 && s.trace.checks === 1, "a second call is rate limited without a check");
    }
    {
      const s = stage({ check: async () => ({ read: { status: null, why: "no-token" }, dispatch: { sent: false, status: null, why: "no-token" }, repo: null, workflow: "w.yml", outcome: null }) });
      const r = await s.run("owner");
      note(r.status === 200 && s.trace.recorded.length === 0, "no token writes nothing");
    }
    {
      const s = stage({ ensureFlowsTables: async () => { throw new Error("store"); } });
      const r = await s.run("owner");
      note(r.status === 200, "a store failure does not fail the check");
    }
    return failures;
  }

  eq(await judge(flowsDispatchRows), [], "the shipped row passes every judgement");

  const MUTANTS = [
    ["no same-origin check", (s) => s.replace("    requireSameOrigin(request);\n", "")],
    ["no owner check", (s) => s.replace('    if (!isOwner(env, session.username)) throw HttpError.of("owner_only");\n', "")],
    ["no rate limit", (s) => s.replace('    if (!claim(at)) throw HttpError.of("rate_limited", undefined, { "Retry-After": "60" });\n', "")],
    ["owner check after the check", (s) => s.replace('    if (!isOwner(env, session.username)) throw HttpError.of("owner_only");\n', "").replace("    const result = await check(env);\n", '    const result = await check(env);\n    if (!isOwner(env, session.username)) throw HttpError.of("owner_only");\n')],
    ["token in the body", (s) => s.replace("repo: result.repo,", "repo: result.repo + env.GITHUB_DISPATCH_TOKEN,")],
    ["records a no-token outcome", (s) => s.replace("if (result.outcome) {", "if (true) {")],
    ["a store failure fails the check", (s) => s.replace("      } catch {\n        recorded = false;\n      }", "      } finally {\n      }")],
  ];
  for (const [name, transform] of MUTANTS) {
    const transformed = transform(SOURCE);
    ok(transformed !== SOURCE, "mutant " + name + " changes the source");
    const factory = await build(transform);
    const failures = await judge(factory);
    ok(failures.length > 0, "PLANTED WRONG BUILD FAILS: " + name);
  }
} finally {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  console.error = realConsole.error;
  console.warn = realConsole.warn;
}

console.log("flows-dispatch-check: " + checks + " checks passed");
