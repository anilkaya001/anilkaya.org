import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERRORS, errorEntry } from "../server/errors.js";
import * as K from "../server/http.js";
import { logFailure } from "../server/log.js";
import { ARCHIVE_REFUSALS } from "../shared/flows-archive.js";
import { TICKER_RE } from "../shared/flows-live.js";
import { workerSource, expect, absent, treeFiles, moduleSource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

class RefError extends Error {
  constructor(status, code, message, headers, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.details = details;
  }
}
const refJson = (value, status = 200, headers) => {
  const out = new Headers(headers);
  out.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers: out });
};
const refApiError = (status, code, message, headers, details) => refJson({ error: { code, message }, ...(details || {}) }, status, headers);
const refRedirect = (location, status = 302, cookies = []) => {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status, headers });
};
function refRequireMethod(request, allowed) {
  if (!allowed.includes(request.method)) throw new RefError(405, "method_not_allowed", "Method not allowed", { Allow: allowed.join(", ") });
}
function refRequireSameOrigin(request) {
  const expectedOrigin = new URL(request.url).origin;
  const suppliedOrigin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  let originMatches = true;
  if (suppliedOrigin !== null) {
    try { originMatches = new URL(suppliedOrigin).origin === expectedOrigin; } catch { originMatches = false; }
  }
  if (!originMatches || (fetchSite !== null && fetchSite.trim().toLowerCase() !== "same-origin")) {
    throw new RefError(403, "forbidden", "Same-origin request required");
  }
}
function refRequireMutationOwner(request, userId) {
  if (request.headers.get("X-IEWT-Owner") !== userId) throw new RefError(409, "account_changed", "Signed-in account changed; refresh and try again");
}
function refRequireReadOwnerIfPresent(request, userId) {
  const owner = request.headers.get("X-IEWT-Owner");
  if (owner !== null && owner !== userId) throw new RefError(409, "account_changed", "Signed-in account changed; refresh and try again");
}
async function refReadBounded(request, maxBytes, message) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RefError(413, "payload_too_large", message);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) throw new RefError(413, "payload_too_large", message);
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function refReadJSON(request) {
  const contentType = request.headers.get("Content-Type") || "";
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new RefError(415, "unsupported_media_type", "Content-Type must be application/json");
  if (!request.body) throw new RefError(400, "invalid_json", "A JSON body is required");
  const bytes = await refReadBounded(request, 16 * 1024, "JSON body is too large");
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new RefError(400, "invalid_json", "Body must be a valid JSON object");
  }
}

const shape = (e) => ({ name: e.constructor === RefError || e instanceof K.HttpError ? "HttpError" : e.constructor.name, status: e.status, code: e.code, message: e.message, headers: e.headers, details: e.details });
const outcome = async (fn) => {
  try { return { value: await fn() }; } catch (e) { return { thrown: shape(e) }; }
};
const resp = async (r) => ({ status: r.status, headers: [...r.headers].sort(), body: r.body === null ? null : await r.text() });
const same = async (label, a, b) => {
  const [x, y] = [await outcome(a), await outcome(b)];
  if (x.value instanceof Response && y.value instanceof Response) eq(await resp(x.value), await resp(y.value), label);
  else eq(x, y, label);
};

const entries = Object.entries(ERRORS);
ok(entries.length >= 45, "the table holds every code the Worker closure throws");
ok(Object.isFrozen(ERRORS) && entries.every(([, v]) => Object.isFrozen(v)), "the table and its entries are frozen");
for (const [code, [status, message]] of entries) {
  ok(/^[a-z][a-z0-9_]*$/.test(code), `code ${code} is snake_case`);
  ok(Number.isInteger(status) && status >= 400 && status <= 599, `${code} has an error status`);
  ok(typeof message === "string" && message.length > 0 && message.length < 200, `${code} has a short default message`);
  const made = K.HttpError.of(code);
  eq(shape(made), shape(new RefError(status, code, message)), `HttpError.of(${code}) equals the constructor with the table's status and message`);
  ok(made instanceof Error && made instanceof K.HttpError, `${code} builds a K.HttpError`);
  const headers = { "Retry-After": "30" };
  const details = { generation: 3 };
  eq(shape(K.HttpError.of(code, "custom", headers, details)), shape(new RefError(status, code, "custom", headers, details)), `${code}: message, headers and details pass through`);
  eq(errorEntry(code), [status, message], `errorEntry(${code})`);
}
eq(errorEntry("nope"), null, "an unknown code has no entry");
eq(errorEntry("toString"), null, "an inherited property is not a code");
assert.throws(() => K.HttpError.of("nope"), TypeError);
checks++;
assert.throws(() => K.HttpError.of("constructor"), TypeError);
checks++;

const scanned = ["worker.js", ...treeFiles("shared"), ...treeFiles("server")];
const literal = /new HttpError\(\s*(\d{3}),\s*"([a-z_]+)"/g;
let sites = 0;
for (const file of scanned) {
  for (const m of moduleSource(file).matchAll(literal)) {
    sites++;
    const known = errorEntry(m[2]);
    ok(known !== null, `${file}: code ${m[2]} is in the table`);
    eq(known[0], Number(m[1]), `${file}: ${m[2]} is thrown with the table's status`);
  }
}
ok(sites >= 60, `the scan saw ${sites} literal throw sites`);
for (const refusal of Object.values(ARCHIVE_REFUSALS)) {
  const known = errorEntry(refusal.code);
  ok(known !== null && known[0] === refusal.status, `${refusal.code} is in the table with the archive's status`);
}
for (const [code, status] of [["store_quota", 503], ["internal_error", 500], ["reset_required", 409], ["too_large", 413], ["chain_timeout", 504]]) {
  eq(errorEntry(code)[0], status, `${code} keeps its status`);
}

const src = moduleSource("worker.js");
ok(workerSource().includes("@@ source server/http.js @@"), "the Worker closure reaches the kernel");
for (const name of ["class HttpError", "function requireMethod", "function requireSameOrigin", "function requireMutationOwner",
  "function requireReadOwnerIfPresent", "async function readBounded", "async function readJSON", "function keepAlive",
  "const apiError =", "const redirect =", "const json =", "const MAX_JSON_BYTES"]) {
  absent(src, name, { anchor: "function requireSessionSecret", why: `${name} lives in server/http.js only` });
}
absent(src, /caches\.default/, { anchor: "edgeCache.handle()", why: "the Cache API is reached through the kernel" });
absent(src, /\.internal[/`"]/, { anchor: 'internalKey("class"', why: "internal cache keys are built by internalKey" });
absent(src, "error instanceof Error ? error.message : String(error)", { anchor: "errorText(error)", why: "one text rule for caught values" });
absent(src, "console.error(JSON.stringify", { anchor: 'logFailure("error"', why: "failure logs go through server/log.js" });
absent(src, "console.warn(JSON.stringify", { anchor: 'logFailure("warn"', why: "failure logs go through server/log.js" });
expect(src, /from "\.\/server\/http\.js"/, { min: 1, max: 1, why: "worker.js imports the kernel once" });
const kernelFiles = treeFiles("server");
eq(kernelFiles, ["server/ai.js", "server/errors.js", "server/http.js", "server/log.js", "server/router.js", "server/routes/flows-ai.js", "server/routes/flows-desk.js", "server/routes/flows-ingest.js", "server/routes/flows-read.js", "server/schema.js", "server/store.js"], "server/ holds the kernel, the table, the log, the router and the flows-read, flows-desk and flows-ai families");
for (const f of kernelFiles) {
  ok(!/^(?:let|var)\s/m.test(moduleSource(f)), `${f} declares no top-level mutable binding`);
  ok(!/\/\/|\/\*/.test(moduleSource(f).replace(/https?:\/\/[^\s"'`]+/g, "")), `${f} carries no comments`);
}
ok(readFileSync(new URL("../.assetsignore", import.meta.url), "utf8").split(/\r?\n/).includes("server/"), ".assetsignore keeps server/ out of the static bundle");

for (const body of [{ a: 1 }, [], "text", null]) {
  await same("json " + JSON.stringify(body), () => K.json(body, 201, { "X-A": "1" }), () => refJson(body, 201, { "X-A": "1" }));
}
await same("json defaults", () => K.json({ ok: true }), () => refJson({ ok: true }));
for (const args of [[400, "c", "m"], [409, "c", "m", { "Retry-After": "5" }, { generation: 4 }], [500, "internal_error", "Internal server error"], [503, "c", "m", undefined, {}]]) {
  await same("apiError " + args.join("|"), () => K.apiError(...args), () => refApiError(...args));
}
for (const args of [["https://anilkaya.org/lab/"], ["/x", 308], ["/y", 302, ["a=1; Path=/", "b=; Max-Age=0"]]]) {
  await same("redirect " + args[0], () => K.redirect(...args), () => refRedirect(...args));
}

const req = (method, url = "https://anilkaya.org/api/x", headers = {}, body) => new Request(url, { method, headers, body });
for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
  for (const allowed of [["GET"], ["GET", "HEAD"], ["PUT", "DELETE"], []]) {
    await same(`requireMethod ${method} in ${allowed}`, () => K.requireMethod(req(method), allowed), () => refRequireMethod(req(method), allowed));
  }
}
const origins = [null, "https://anilkaya.org", "https://anilkaya.org/", "https://www.anilkaya.org", "http://anilkaya.org", "https://evil.example", "null", "not a url", "", "https://anilkaya.org:8443"];
const sites_ = [null, "same-origin", " Same-Origin ", "SAME-ORIGIN", "same-site", "cross-site", "none", ""];
for (const origin of origins) {
  for (const site of sites_) {
    const headers = {};
    if (origin !== null) headers.Origin = origin;
    if (site !== null) headers["Sec-Fetch-Site"] = site;
    const make = () => req("POST", "https://anilkaya.org/api/x", headers);
    await same(`requireSameOrigin ${origin} ${site}`, () => K.requireSameOrigin(make()), () => refRequireSameOrigin(make()));
  }
}
for (const owner of [null, "g_1", "g_2", "", "G_1"]) {
  const headers = owner === null ? {} : { "X-IEWT-Owner": owner };
  await same(`requireMutationOwner ${owner}`, () => K.requireMutationOwner(req("PUT", undefined, headers), "g_1"), () => refRequireMutationOwner(req("PUT", undefined, headers), "g_1"));
  await same(`requireReadOwnerIfPresent ${owner}`, () => K.requireReadOwnerIfPresent(req("GET", undefined, headers), "g_1"), () => refRequireReadOwnerIfPresent(req("GET", undefined, headers), "g_1"));
}

const stream = (chunks) => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
const post = (chunks, headers = {}) => new Request("https://anilkaya.org/api/x", { method: "POST", headers, body: chunks === null ? undefined : stream(chunks), duplex: "half" });
const bodies = [null, [""], ["abc"], ["a".repeat(10)], ["a".repeat(11)], ["a".repeat(5), "b".repeat(6)], ["a".repeat(5), "b".repeat(5)], ["x".repeat(20000)]];
for (const chunks of bodies) {
  for (const declared of [undefined, "5", "10", "11", "abc", "-1"]) {
    const headers = declared === undefined ? {} : { "Content-Length": declared };
    const out = await Promise.all([outcome(async () => [...(await K.readBounded(post(chunks, headers), 10, "too big"))]), outcome(async () => [...(await refReadBounded(post(chunks, headers), 10, "too big"))])]);
    eq(out[0], out[1], `readBounded ${JSON.stringify(chunks && chunks.map((c) => c.length))} declared ${declared}`);
  }
}
const JSON_CT = { "Content-Type": "application/json" };
const jsonCases = [
  [null, JSON_CT], [[""], JSON_CT], [['{"a":1}'], JSON_CT], [['{"a":1}'], { "Content-Type": "application/json; charset=utf-8" }],
  [['{"a":1}'], { "Content-Type": "Application/JSON " }], [['{"a":1}'], { "Content-Type": "text/plain" }], [['{"a":1}'], {}],
  [["[1]"], JSON_CT], [['"s"'], JSON_CT], [["null"], JSON_CT], [["{bad"], JSON_CT], [['{"a":"' + "x".repeat(17000) + '"}'], JSON_CT],
  [['{"a"', ":1}"], JSON_CT], [['{"a":"' + "x".repeat(16300) + '"}'], JSON_CT],
];
for (const [chunks, headers] of jsonCases) {
  await same("readJSON " + JSON.stringify(headers) + " " + (chunks ? chunks.join("").length : "none"), () => K.readJSON(post(chunks, headers)), () => refReadJSON(post(chunks, headers)));
}
eq(K.MAX_JSON_BYTES, 16 * 1024, "JSON bodies are capped at 16 KiB");

const urlOf = (q) => new URL("https://anilkaya.org/api/flows/card" + q);
const refTicker = (url, name = "t") => String(url.searchParams.get(name) || "").trim().toUpperCase();
for (const q of ["", "?t=", "?t=nvda", "?t=%20nvda%20", "?t=BRK.B", "?t=BRK-B", "?t=1ABC", "?t=ABCDEFGHIJK", "?t=ABCDEFGHIJ", "?t=a b", "?t=%00", "?t=NVDA&t=AMD", "?x=NVDA", "?t=%E2%82%AC", "?t=tsla%0a"]) {
  eq(K.tickerParam(urlOf(q)), refTicker(urlOf(q)), "tickerParam " + q);
  const expected = TICKER_RE.test(refTicker(urlOf(q))) ? { value: refTicker(urlOf(q)) } : { thrown: { name: "HttpError", status: 400, code: "invalid_ticker", message: "Unknown ticker", headers: undefined, details: undefined } };
  eq(await outcome(() => K.requireTicker(urlOf(q))), expected, "requireTicker " + q);
}
eq(K.tickerParam(urlOf("?s=nvda"), "s"), "NVDA", "tickerParam reads another parameter name");

eq(K.errorText(new Error("boom")), "boom", "errorText of an Error");
eq(K.errorText(new TypeError("t")), "t", "errorText of a subclass");
eq(K.errorText("plain"), "plain", "errorText of a string");
eq(K.errorText(null), "null", "errorText of null");
eq(K.errorText(undefined), "undefined", "errorText of undefined");
eq(K.errorText({ message: "x" }), "[object Object]", "errorText of a plain object");
eq(K.errorText(7), "7", "errorText of a number");

const waited = [];
const promise = Promise.resolve(1);
ok(K.keepAlive({ waitUntil: (p) => waited.push(p) }, promise) === promise && waited[0] === promise, "keepAlive registers and returns the promise");
for (const ctx of [undefined, null, {}, { waitUntil: 1 }]) ok(K.keepAlive(ctx, promise) === promise, "keepAlive tolerates " + JSON.stringify(ctx));

const keys = [
  ["class", "HYG", "https://flows-class.internal/HYG"], ["tape-admit", "BRK.B", "https://flows-tape-admit.internal/BRK.B"],
  ["screen", "NVDA", "https://flows-screen.internal/NVDA"], ["info", "TSLA", "https://flows-info.internal/TSLA"],
  ["index", "SPY", "https://flows-index.internal/SPY"], ["lastgood", "api/flows/board?side=long", "https://flows-lastgood.internal/api/flows/board?side=long"],
  ["chain", "AAPL?strategy=csp&rank=annualized", "https://flows-chain.internal/AAPL?strategy=csp&rank=annualized"],
  ["strategy", "AAPL/2026-10-16?engine=1", "https://flows-strategy.internal/AAPL/2026-10-16?engine=1"],
];
for (const [ns, path, url] of keys) {
  const key = K.internalKey(ns, path);
  eq([key.url, key.method], [url, "GET"], "internalKey " + ns);
}

const realCaches = globalThis.caches;
const restore = () => { if (realCaches === undefined) delete globalThis.caches; else globalThis.caches = realCaches; };
delete globalThis.caches;
eq(K.edgeCache.handle(), null, "no Cache API is a null handle");
eq(await K.edgeCache.get(K.internalKey("class", "A")), null, "get without a Cache API is null");
await K.edgeCache.put(K.internalKey("class", "A"), new Response("x"));
checks++;
globalThis.caches = {};
eq(K.edgeCache.handle(), null, "a Cache API with no default is a null handle");
const store = new Map();
const calls = [];
const fake = {
  match: async (k) => { calls.push(["match", k.url]); if (k.url.endsWith("/BOOM")) throw new Error("match failed"); return store.get(k.url); },
  put: async (k, r) => { calls.push(["put", k.url]); if (k.url.endsWith("/BOOM")) throw new Error("put failed"); store.set(k.url, r); },
};
globalThis.caches = { default: fake };
ok(K.edgeCache.handle() === fake, "the handle is caches.default, read at call time");
eq(await K.edgeCache.get(K.internalKey("class", "A")), undefined, "a miss is falsy");
await K.edgeCache.put(K.internalKey("class", "A"), new Response("kept"));
ok((await (await K.edgeCache.get(K.internalKey("class", "A"))).text()) === "kept", "a put is read back");
eq(await K.edgeCache.get(K.internalKey("class", "BOOM")), null, "a failing match is a miss");
eq(await K.edgeCache.put(K.internalKey("class", "BOOM"), new Response("x")), undefined, "a failing put is swallowed");
eq(calls.map((c) => c[0]), ["match", "put", "match", "match", "put"], "one cache call per operation");
restore();

const logged = [];
const real = { error: console.error, warn: console.warn };
console.error = (line) => logged.push(["error", line]);
console.warn = (line) => logged.push(["warn", line]);
try {
  const boom = new Error("boom");
  logFailure("error", "neuron failed", { ticker: "NVDA" }, boom);
  logFailure("warn", "flows schema bootstrap failed", {}, boom);
  logFailure("error", "request failed", { method: "GET", path: "/api/x" }, "plain");
  logFailure("warn", "ai spend not recorded", { model: "m" }, undefined);
} finally {
  console.error = real.error;
  console.warn = real.warn;
}
eq(logged, [
  ["error", JSON.stringify({ message: "neuron failed", ticker: "NVDA", error: "boom" })],
  ["warn", JSON.stringify({ message: "flows schema bootstrap failed", error: "boom" })],
  ["error", JSON.stringify({ message: "request failed", method: "GET", path: "/api/x", error: "plain" })],
  ["warn", JSON.stringify({ message: "ai spend not recorded", model: "m", error: "undefined" })],
], "each failure log keeps its legacy key order and text");
expect(src, /logFailure\("(?:error|warn)", /, { min: 7, why: "the seven failure sites use the log module" });

console.log(`server-kernel: ${checks} checks`);
