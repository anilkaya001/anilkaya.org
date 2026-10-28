import assert from "node:assert/strict";
import { FLOWS_COOKIE, sessionEpoch, signFlowsSession } from "../shared/flows-auth.js";
import { FIXTURE_ROSTER } from "./lib/fixture-roster.mjs";
import { fakeD1 } from "./lib/d1-fake.mjs";
import { nightlyEmit } from "./lib/nightly-emit.mjs";
import { emitKeys } from "./lib/emit-keys.mjs";
import { moduleSource, workerSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };

const SESSION_SECRET = "meter-session-secret-abcdefghijklmnopqrstuvwxyz";
const OWNER = FIXTURE_ROSTER[0];
let instance = 0;

const realFetch = globalThis.fetch;
const vendorLog = [];
globalThis.fetch = async (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.origin !== "http://vendor.test") return realFetch(input, init);
  vendorLog.push(u.pathname);
  if (u.pathname.includes("/BOOM/")) return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
  if (u.pathname.includes("/SLOW/")) {
    const signal = init && init.signal;
    return new Promise((resolve, reject) => { if (signal) signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))); });
  }
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
};

async function client(extra = {}, D1 = undefined) {
  const env = { SESSION_SECRET, FLOWS_READ_MODE: "off", FLOWS_CREDENTIALS: JSON.stringify({ [OWNER]: "x".repeat(43) }), UW_API_KEY: "stub", UW_BASE: "http://vendor.test",
    FLOWS_RT_USERS: OWNER, ...(D1 ? { DB: D1 } : {}), ...extra };
  const token = await signFlowsSession(OWNER, env.SESSION_SECRET, 3600, sessionEpoch(env));
  const worker = (await import("../worker.js?meter=" + (++instance))).default;
  return async (route, init = {}) => {
    const ctx = { waitUntil: () => {} };
    const res = await worker.fetch(new Request("https://anilkaya.org" + route, { ...init, headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin" } }), env, ctx);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { res, body, text };
  };
}

{
  const off = await client({});
  const a = await off("/api/me");
  eq(a.res.status, 200, "an API route answers");
  eq(a.res.headers.get("Server-Timing"), null, "AND WITH THE METER OFF NO RESPONSE CARRIES A TIMING HEADER: the answer is byte for byte what it was");
  const on = await client({ FLOWS_METER: "on" });
  const b = await on("/api/me");
  ok(/^total;dur=\d+$/.test(b.res.headers.get("Server-Timing")), "with it on an API response carries total;dur: " + b.res.headers.get("Server-Timing"));
  const nope = await on("/api/zz");
  ok(nope.res.status === 404 && /^total;dur=\d+$/.test(nope.res.headers.get("Server-Timing")), "an error answer is timed too");
  const anon = await (async () => {
    const worker = (await import("../worker.js?meter=" + (++instance))).default;
    const res = await worker.fetch(new Request("https://anilkaya.org/api/flows/board"), { SESSION_SECRET, FLOWS_METER: "on", FLOWS_READ_MODE: "off" }, { waitUntil() {} });
    return res;
  })();
  ok(anon.status === 401 && /^total;dur=/.test(anon.headers.get("Server-Timing") || ""), "and so is a refused one");
  const other = await (async () => {
    const worker = (await import("../worker.js?meter=" + (++instance))).default;
    return worker.fetch(new Request("https://anilkaya.org/lab/"), { SESSION_SECRET, FLOWS_METER: "on", ASSETS: { fetch: async () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } }) } }, { waitUntil() {} });
  })();
  eq(other.headers.get("Server-Timing"), null, "a page is never timed: the header is for the API alone");
  const odd = await client({ FLOWS_METER: "ON " });
  ok(/^total;dur=/.test((await odd("/api/me")).res.headers.get("Server-Timing") || ""), "the switch is read the way the others are, trimmed and case-blind");
  const wrong = await client({ FLOWS_METER: "yes" });
  eq((await wrong("/api/me")).res.headers.get("Server-Timing"), null, "and any other word is off");
}

{
  const { keys } = emitKeys(nightlyEmit());
  const f = fakeD1();
  for (const [key, payload] of keys) if (!key.startsWith("live:")) f.put(key, payload);
  const on = await client({ FLOWS_METER: "on", FLOWS_COVERAGE: "on" }, f.D1);
  const empty = await on("/api/flows/coverage");
  eq(empty.res.status, 200, "the owner reads the coverage");
  eq(empty.body.calls.n, 0, "before any feed call the meter reports none");
  const base = vendorLog.length;
  const a = await on("/api/flows/chain?t=NVDA");
  ok(vendorLog.length > base, "a chain read reaches the stub feed: " + vendorLog.slice(base).join(","));
  const after = await (await client({ FLOWS_METER: "on", FLOWS_COVERAGE: "on" }, f.D1))("/api/flows/coverage");
  eq(after.body.calls.n, 0, "a second Worker instance has its own, empty, meter: the state is per isolate");
  const again = await on("/api/flows/coverage");
  ok(again.body.calls.n >= 1, `the instance that made the call counts it (${again.body.calls.n} call(s))`);
  ok(again.body.calls.slowest.every((s) => typeof s.op === "string" && Number.isFinite(s.avgMs)) && again.body.calls.slowest.length >= 1 && again.body.calls.slowest.every((s) => s.op !== "other") && again.body.calls.slowest.some((s) => s.op === "option-contracts"), "by registered operation: " + again.body.calls.slowest.map((s) => s.op).join(","));
  const boom = await on("/api/flows/chain?t=BOOM");
  const withBad = await on("/api/flows/coverage");
  ok(withBad.body.calls.bad >= 1 && withBad.body.calls.slowest.some((s) => (s.classes["5xx"] || 0) >= 1), "a 503 from the feed is counted as a 5xx");
  ok(boom.res.status >= 500 || boom.res.status === 429 || boom.res.status === 404, "and still reaches the reader as the error it was: " + boom.res.status);

  const quiet = await client({ FLOWS_COVERAGE: "on" }, f.D1);
  await quiet("/api/flows/chain?t=NVDA");
  const unmetered = await quiet("/api/flows/coverage");
  ok(!("calls" in unmetered.body), "WITH THE METER OFF THE REPORT CARRIES NO CALL FIGURES and the feed path is untouched");
}

{
  const src = workerSource();
  const own = moduleSource("worker.js");
  ok(/vendorMeter: createCallMeter\(\),/.test(own), "the meter lives in the Worker's one state object");
  ok(!/^(let|var) /m.test(own), "and no top-level mutable binding was added");
  ok(/async function uwFetchUnmetered\(/.test(src) && /if \(!meterOn\(env\)\) return uwFetchUnmetered\(/.test(src), "the unmetered body is the old one, reached first when the switch is off");
  ok(/error\.code === "chain_unconfigured"/.test(src), "a missing key is not counted as a feed call");
}

globalThis.fetch = realFetch;
console.log(`flows-meter-worker: ${checks} checks passed`);
