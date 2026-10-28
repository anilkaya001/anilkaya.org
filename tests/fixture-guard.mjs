import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIXTURE_REFUSALS, fixtureHost, fixtureMarked, fixtureNameIn, fixtureRefusal, isFixtureTicker,
} from "../shared/flows-fixture-names.js";
import { ERRORS } from "../server/errors.js";
import { requireTicker } from "../server/http.js";
import { healthChecks, HEALTH_CODES } from "../scripts/flows-legs/health.mjs";
import { nightlyEmit } from "./lib/nightly-emit.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const NIGHTLY = "nightly-token-abcdefghijklmnopqrstuvwxyz";
const LIVE = "live-token-abcdefghijklmnopqrstuvwxyz0123";
const BASE = "https://anilkaya.org";
const LOCAL = "http://127.0.0.1:8787";

const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const source = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const TMP = mkdtempSync(path.join(os.tmpdir(), "fixture-guard-"));
process.on("exit", () => { try { rmSync(TMP, { recursive: true, force: true }); } catch {} });
let copies = 0;
const drop = (root) => rmSync(root, { recursive: true, force: true });
function copyTree(edits = []) {
  const root = path.join(TMP, "c" + copies++);
  for (const dir of ["scripts", "shared", "server"]) cpSync(path.join(ROOT, dir), path.join(root, dir), { recursive: true });
  for (const [rel, from, to] of edits) {
    const file = path.join(root, rel);
    const text = readFileSync(file, "utf8");
    const at = text.indexOf(from);
    assert.ok(at >= 0 && text.indexOf(from, at + 1) < 0, `${rel}: the planted edit ${JSON.stringify(from.slice(0, 60))} must occur exactly once`);
    writeFileSync(file, text.replace(from, () => to));
  }
  return root;
}
const load = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);

{
  const real = [
    ["SYN001", true], ["SYL040", true], ["SYS001", true], ["SYW012", true], ["SYX010", true], ["SYN000", true], ["SYN419", true],
    ["GONE0", true], ["GONE2", true],
    ["SYN", false], ["SYNA", false], ["SYK", false], ["SYY", false], ["SYF", false], ["AAA", false], ["BRK.B", false], ["SOXS", false],
    ["SPCX", false], ["NOPT", false], ["SYN0001", false], ["SYN01", false], ["syn001", false], ["SYN001 ", false], ["XSYN001", false],
    ["GONE", false], ["GONE10", false], ["GONEX", false], ["", false], [null, false], [undefined, false], [1, false],
  ];
  const wrong = {
    "a prefix rule that refuses SYNA": (t) => typeof t === "string" && /^SYN/.test(t),
    "a rule that ignores GONE": (t) => typeof t === "string" && /^SY[A-Z]\d{3}$/.test(t),
    "a rule that ignores case": (t) => typeof t === "string" && /^(?:SY[A-Z]\d{3}|GONE\d)$/i.test(t),
    "a rule that does not anchor": (t) => typeof t === "string" && /SY[A-Z]\d{3}|GONE\d/.test(t),
    "a rule on letters alone": (t) => typeof t === "string" && /^SY[A-Z]{1,4}$/.test(t),
  };
  const misses = (fn) => real.filter(([t, want]) => fn(t) !== want).length;
  eq(misses(isFixtureTicker), 0, "THE NAMESPACE: SYN001, SYL040, SYS001, SYW012, SYX010 and GONE0 are fixtures; SYN, SYNA, SYK, SYY, SYF, AAA, BRK.B, SOXS, SPCX and NOPT are not");
  for (const [name, fn] of Object.entries(wrong)) ok(misses(fn) > 0, `${name} is caught by the table`);

  eq(fixtureNameIn('["NVDA","SYN001"]'), "SYN001", "a whole JSON string in an array is a hit");
  eq(fixtureNameIn('{"SYS012":1}'), "SYS012", "and an object key");
  eq(fixtureNameIn('{"t":"GONE1"}'), "GONE1", "and a value");
  eq(fixtureNameIn('{"headline":"SYS100 launch"}'), null, "a headline that merely says SYS100 is not a whole string");
  eq(fixtureNameIn('{"option":"SYN001261016C00080000"}'), null, "nor is an option symbol that begins with a fixture-shaped root");
  eq(fixtureNameIn(""), null, "an empty body is clean");
  eq(fixtureNameIn(null), null, "and so is null");
  eq(fixtureMarked('{"fixture":true,"a":1}'), true, "a top-level fixture:true is a marker");
  eq(fixtureMarked('{"a":{"fixture":true}}'), false, "a nested one is not");
  eq(fixtureMarked('{"fixture":false}'), false, "nor is fixture:false");
  eq(fixtureMarked('[{"fixture":true}]'), false, "nor an array");
  eq(fixtureMarked("not json {\"fixture\":true"), false, "nor text that does not parse");
  eq(fixtureRefusal("card:SYN001", ""), { code: "fixture_ticker", name: "SYN001" }, "a key naming a fixture ticker is refused");
  eq(fixtureRefusal("hist:GONE1", ""), { code: "fixture_ticker", name: "GONE1" }, "for every ticker kind");
  eq(fixtureRefusal("card:AAPL", '{"fixture":true}'), { code: "fixture_payload", name: null }, "and a stamped body under a real name");
  eq(fixtureRefusal("universe", '{"t":["SYN001"]}'), { code: "fixture_ticker", name: "SYN001" }, "and a body naming one");
  eq(fixtureRefusal("card:SYNA", '{"v":2}'), null, "while a listed symbol is clean");
  eq(fixtureRefusal("news", '{"fixture":true,"rows":["SYN001"]}'), { code: "fixture_ticker", name: "SYN001" }, "the name is reported before the stamp");

  for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "example.test", "a.b.test"]) ok(fixtureHost(host), host + " is a test host");
  for (const host of ["anilkaya.org", "www.anilkaya.org", "anilkaya.workers.dev", "evil.localhost", "attest", "test", "127.0.0.1.evil.com", "localhost.evil.com", "", null, undefined]) {
    ok(!fixtureHost(host), String(host) + " is not a test host");
  }
  ok(Object.isFrozen(FIXTURE_REFUSALS) && Object.values(FIXTURE_REFUSALS).every((e) => Object.isFrozen(e)), "the refusal table is frozen");
  for (const code of ["fixture_ticker", "fixture_payload"]) {
    eq([...ERRORS[code]], [...FIXTURE_REFUSALS[code]], `server/errors.js holds ${code} equal to the leaf's table, at 422`);
    ok(ERRORS[code][0] === 422, code + " is outside PUBLISH_RETRYABLE, so the pipeline does not retry a refusal");
  }
  const leaf = source("shared/flows-fixture-names.js");
  ok(!/^\s*import\b/m.test(leaf), "the leaf imports nothing");
}

{
  const ui = source("assets/js/flows-ui.js");
  const leaf = source("shared/flows-fixture-names.js");
  const grab = (text, re) => { const m = re.exec(text); assert.ok(m, "pattern not found: " + re); return m; };
  const clientToken = grab(ui, /const TOKEN = (\/.*?\/), TICKER = (\/.*?\/);/);
  const leafToken = grab(leaf, /FIXTURE_TOKEN_RE = (\/.*?\/);/)[1];
  const leafTicker = grab(leaf, /FIXTURE_TICKER_RE = (\/.*?\/);/)[1];
  eq(clientToken[1], leafToken, "THE CLIENT'S COPY OF THE TOKEN RULE is the leaf's, character for character");
  eq(clientToken[2], leafTicker, "and of the ticker rule");
  const clientHost = grab(ui, /host = n === "127\.0\.0\.1" \|\| n === "localhost" \|\| \/\\\.test\$\/\.test\(n\);/);
  ok(clientHost, "and of the host rule: loopback or a .test name");
  const drift = (text) => grab(text, /const TOKEN = (\/.*?\/), TICKER = (\/.*?\/);/)[1] !== leafToken;
  ok(drift(ui.replace(/SY\[A-Z\]\\d\{3\}\|GONE\\d\)"/, "SY[A-Z]\\d{3}|GONE\\d{1,2})\"")), "a drifted copy is caught by the same comparison");
  const rt = source("assets/js/flows-rt.js");
  ok(/UI\.fixture\.host/.test(rt) && /stats\.fixture\+\+/.test(rt), "the rail drops fixture frames and counts them");
  ok(/UI\.fixture\.refuses\(t\)/.test(source("assets/js/flows-ticker.js")), "and the ticker page refuses a fixture ?t= before it asks for a card");
}

async function exerciseDoor(root) {
  const bad = [];
  const note = (cond, msg) => { if (!cond) bad.push(msg); };
  const rowsMod = await load(root, "server/routes/flows-ingest.js");
  const liveMod = await load(root, "shared/flows-live-worker.js");
  const httpMod = await load(root, "server/http.js");
  const calls = [];
  const store = {
    read: async () => { calls.push("read"); return null; }, write: async () => { calls.push("write"); },
    remove: async () => { calls.push("remove"); return 1; }, createArchive: async () => { calls.push("archive"); return 1; },
    metadata: async () => ({}), listing: async () => ({}),
  };
  const deps = { store, ensureFlowsTables: async () => { calls.push("ensure"); }, storeGone: () => new Error("gone"), passthrough: () => new Response("{}") };
  const row = rowsMod.flowsIngestRows(deps)[0];
  const call = async (base, q, method, body, token = NIGHTLY) => {
    calls.length = 0;
    const url = new URL(base + "/api/flows/ingest" + q);
    const request = new Request(url, { method, headers: { Authorization: "Bearer " + token }, body });
    try {
      const res = await row.handler({ request, env: { FLOWS_INGEST_TOKEN: NIGHTLY, FLOWS_LIVE_TOKEN: LIVE, DB: {} }, url, ctx: {} });
      const body = await res.clone().json().catch(() => null);
      return { status: res.status, code: body && body.error ? body.error.code : undefined, calls: [...calls] };
    } catch (error) {
      return { status: error.status, code: error.code, calls: [...calls] };
    }
  };
  const synCard = JSON.stringify({ v: 2, ticker: "SYN001" });
  const refusedAt = async (label, base, q, method, body, code) => {
    const r = await call(base, q, method, body);
    note(r.status === 422 && r.code === code && r.calls.length === 0, `${label} must be 422 ${code} with no store call (got ${r.status} ${r.code} [${r.calls}])`);
  };
  await refusedAt("POST card:SYN001", BASE, "?key=card:SYN001", "POST", synCard, "fixture_ticker");
  await refusedAt("GET card:SYN001", BASE, "?key=card:SYN001", "GET", undefined, "fixture_ticker");
  await refusedAt("DELETE card:GONE1", BASE, "?key=card:GONE1", "DELETE", undefined, "fixture_ticker");
  await refusedAt("POST a universe naming SYN001", BASE, "?key=universe", "POST", JSON.stringify({ t: ["NVDA", "SYN001"] }), "fixture_ticker");
  await refusedAt("POST a stamped meta", BASE, "?key=meta", "POST", JSON.stringify({ fixture: true }), "fixture_payload");
  await refusedAt("POST a stamped card under a real name", BASE, "?key=card:AAPL", "POST", JSON.stringify({ fixture: true }), "fixture_payload");
  for (const host of ["https://staging.example.workers.dev", "https://evil.localhost", "https://attest", "https://127.0.0.1.evil.com"]) {
    await refusedAt("POST card:SYN001 on " + host, host, "?key=card:SYN001", "POST", synCard, "fixture_ticker");
  }
  process.env.ALLOW_FIXTURES = "1";
  process.env.FLOWS_ALLOW_FIXTURES = "1";
  await refusedAt("POST card:SYN001 with an environment variable offered as a waiver", BASE, "?key=card:SYN001", "POST", synCard, "fixture_ticker");
  delete process.env.ALLOW_FIXTURES;
  delete process.env.FLOWS_ALLOW_FIXTURES;
  for (const base of [LOCAL, "http://localhost:8787", "https://example.test"]) {
    const w = await call(base, "?key=card:SYN001", "POST", synCard);
    note(w.status === 200 && w.calls.includes("write"), `POST card:SYN001 on ${base} must be stored as before (got ${w.status} ${w.code})`);
    const r = await call(base, "?key=card:SYN001", "GET");
    note(r.status === 200, `GET card:SYN001 on ${base} must read (got ${r.status})`);
    const m = await call(base, "?key=meta", "POST", JSON.stringify({ fixture: true }));
    note(m.status === 200, `a stamped meta on ${base} must be stored (got ${m.status})`);
  }
  const lived = await call(LOCAL, "?key=live:strips", "POST", JSON.stringify({ rows: [["SYN001", 1]] }), LIVE);
  note(lived.code !== "fixture_ticker" && lived.code !== "fixture_payload", `a live body naming SYN001 on loopback must reach checkLiveWrite (got ${lived.status} ${lived.code})`);
  for (const ticker of ["SYNA", "SYK", "AAA", "BRK.B", "SOXS"]) {
    const kept = await call(BASE, "?key=card:" + ticker, "POST", JSON.stringify({ v: 2 }));
    note(kept.status === 200, `card:${ticker} is a real or lookalike symbol and must be stored (got ${kept.status} ${kept.code})`);
  }
  const headline = await call(BASE, "?key=news", "POST", JSON.stringify({ rows: [{ headline: "SYS100 launch", tickers: ["SYK"] }], fixture: false }));
  note(headline.status === 200, `a headline that says SYS100 must be stored (got ${headline.status} ${headline.code})`);

  const answers = [];
  const json = (b, st = 200) => { answers.push([st, b]); return b; };
  const liveBody = JSON.stringify({ readAt: 1, rows: [["SYN001", 1]] });
  let touched = false;
  const guardedDb = new Proxy({}, { get() { touched = true; throw new Error("the store was touched"); } });
  await liveMod.ingestLive({ DB: guardedDb }, "live:strips", "POST", liveBody, 1, { json, host: "anilkaya.org" }).catch(() => {});
  note(answers[0] && answers[0][0] === 422 && answers[0][1].error.code === "fixture_ticker" && !touched, "ingestLive must refuse a fixture row on the production host before any statement");
  await liveMod.ingestLive({ DB: guardedDb }, "live:strips", "POST", JSON.stringify({ fixture: true }), 1, { json, host: "anilkaya.org" }).catch(() => {});
  note(answers[1] && answers[1][0] === 422 && answers[1][1].error.code === "fixture_payload", "and a stamped one");
  await liveMod.ingestLive({ DB: guardedDb }, "live:strips", "POST", liveBody, 1, { json }).catch(() => {});
  note(answers[2] && answers[2][0] === 422, "a caller that passes no host is not waived");
  await liveMod.ingestLive({ DB: {} }, "live:strips", "POST", liveBody, 1, { json, host: "127.0.0.1" }).catch(() => {});
  note(!answers[3] || answers[3][1].error === undefined || answers[3][1].error.code !== "fixture_ticker", "while loopback goes on to checkLiveWrite");

  const refuse = (href, t) => {
    try { httpMod.requireTicker(new URL(href + "?t=" + t)); return false; } catch (error) { return error.code === "invalid_ticker"; }
  };
  note(refuse("https://anilkaya.org/api/flows/card", "SYN001"), "the read side must answer 400 invalid_ticker for a fixture name on the production host");
  note(!refuse("http://127.0.0.1:8787/api/flows/card", "SYN001"), "and read it on loopback");
  note(!refuse("https://anilkaya.org/api/flows/card", "SYNA"), "and read a real symbol");
  return bad;
}

{
  const door = copyTree();
  eq(await exerciseDoor(door), [], "THE WORKER DOOR: every refusal, every waiver and every lookalike behaves on an unmodified copy");

  const T = "server/routes/flows-ingest.js";
  const keyBlock = 'const keyRefusal = contentRefusal(url, key, "");\n    if (keyRefusal) throw keyRefusal;\n\n';
  const bodyBlock = 'const bodyRefusal = contentRefusal(url, key, payload);\n    if (bodyRefusal) throw bodyRefusal;\n\n    await ensureFlowsTables(env);';
  const planted = {
    "the key refusal removed": [[T, keyBlock, ""]],
    "the body refusal removed": [[T, bodyBlock, "await ensureFlowsTables(env);"]],
    "the body refusal moved after the first D1 statement": [[T, bodyBlock, 'await ensureFlowsTables(env);\n    const bodyRefusal = contentRefusal(url, key, payload);\n    if (bodyRefusal) throw bodyRefusal;']],
    "every host waived": [[T, "if (fixtureHost(url.hostname)) return null;", "return null;"]],
    "no host waived": [[T, "if (fixtureHost(url.hostname)) return null;", "if (false) return null;"]],
    "a guard keyed on an environment variable instead of the host": [[T, "if (fixtureHost(url.hostname)) return null;", 'if (process.env.ALLOW_FIXTURES === "1" || fixtureHost(url.hostname)) return null;']],
    "the live route not told its host": [[T, "{ json, host: url.hostname }", "{ json }"]],
    "the live refusal removed": [["shared/flows-live-worker.js", "if (!fixtureHost(host)) {", "if (false) {"]],
    "the live refusal waived for every host": [["shared/flows-live-worker.js", "if (!fixtureHost(host)) {", "if (false && !fixtureHost(host)) {"]],
    "a prefix rule in the leaf": [["shared/flows-fixture-names.js", "/^(?:SY[A-Z]\\d{3}|GONE\\d)$/", "/^SYN/"]],
    "a token rule with no closing quote": [["shared/flows-fixture-names.js", '/"(SY[A-Z]\\d{3}|GONE\\d)"/', '/"(SY[A-Z]\\d{3}|GONE\\d)/']],
    "no loopback hosts": [["shared/flows-fixture-names.js", '["127.0.0.1", "localhost"]', "[]"]],
    "a host rule that takes any name ending in test": [["shared/flows-fixture-names.js", "/\\.test$/.test(name)", "/test$/.test(name)"]],
    "the stamp rule removed": [["shared/flows-fixture-names.js", "if (fixtureMarked(text)) return", "if (false) return"]],
    "the read side not refusing": [["server/http.js", "if (!TICKER_RE.test(ticker) || fixtureRefused(url, ticker))", "if (!TICKER_RE.test(ticker))"]],
  };
  drop(door);
  for (const [name, edits] of Object.entries(planted)) {
    const root = copyTree(edits);
    const bad = await exerciseDoor(root);
    drop(root);
    ok(bad.length > 0, `PLANTED WRONG BUILD (${name}) fails the door battery: ${bad[0] || "NOT CAUGHT"}`);
  }
}

async function exerciseStore(root) {
  const bad = [];
  const note = (cond, msg) => { if (!cond) bad.push(msg); };
  const store = await load(root, "scripts/flows-nightly/store.mjs");
  const taint = await load(root, "scripts/flows-legs/taint.mjs");
  const env = { token: process.env.FLOWS_INGEST_TOKEN, url: process.env.FLOWS_INGEST_URL, exit: process.exitCode };
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push([String(url), init && init.method]); return new Response('{"ok":true}', { status: 200, headers: { "content-type": "application/json" } }); };
  const quiet = console.log;
  const quietWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  process.env.FLOWS_INGEST_TOKEN = "t";
  const attempt = async (label, key, payload, want) => {
    const before = sent.length;
    let code = null;
    try { await store.publish(key, payload); } catch (error) { code = error && error.fixtureLeak === true ? error.code : "other:" + (error && error.message); }
    process.exitCode = env.exit;
    const posted = sent.length - before;
    if (want === null) note(code === null && posted === 1, `${label}: must post once (code ${code}, posts ${posted})`);
    else note(code === want && posted === 0, `${label}: must throw ${want} before the network (code ${code}, posts ${posted})`);
  };
  try {
    taint.clearTaint();
    process.env.FLOWS_INGEST_URL = "https://ingest.example/api/flows/ingest";
    await attempt("a universe naming SYN001", "universe", { t: ["NVDA", "SYN001"] }, "fixture_ticker");
    await attempt("card:SYN001", "card:SYN001", { v: 2 }, "fixture_ticker");
    await attempt("a stamped card under a real name", "card:AAPL", { fixture: true, v: 2 }, "fixture_payload");
    taint.touch("fakeChain");
    await attempt("fake code reached by a live run", "card:AAPL", { v: 2 }, "fixture_code");
    note(taint.tainted() === "fakeChain", "the taint names the first fake that ran");
    taint.clearTaint();
    await attempt("a clean card", "card:AAPL", { v: 2 }, null);
    await attempt("a headline that says SYS100", "news", { rows: [{ headline: "SYS100 launch" }] }, null);
    process.env.FLOWS_INGEST_URL = "http://127.0.0.1:1/api/flows/ingest";
    taint.touch("fakeChain");
    await attempt("a tainted run to a loopback ingest", "card:SYN001", { v: 2 }, null);
    taint.clearTaint();
    note(store.targetRefusal({ FLOWS_UW_BASE_URL: "http://127.0.0.1:9", FLOWS_INGEST_URL: "https://anilkaya.org/api/flows/ingest" }) !== null, "a loopback feed with the production ingest is refused");
    note(store.targetRefusal({ FLOWS_UW_BASE_URL: "http://127.0.0.1:9" }) !== null, "and with the ingest unset, which defaults to production");
    note(store.targetRefusal({ FLOWS_UW_BASE_URL: "https://evil.example", FLOWS_INGEST_URL: "https://anilkaya.org/api/flows/ingest" }) !== null, "and an invalid feed base");
    note(store.targetRefusal({ FLOWS_UW_BASE_URL: "http://127.0.0.1:9", FLOWS_INGEST_URL: "http://127.0.0.1:8" }) === null, "while a loopback pair is allowed");
    note(store.targetRefusal({ FLOWS_UW_BASE_URL: "http://api.test", FLOWS_INGEST_URL: "https://ingest.test/x" }) === null, "and a .test pair");
    note(store.targetRefusal({}) === null && store.targetRefusal({ FLOWS_UW_BASE_URL: "https://api.unusualwhales.com" }) === null, "and the production pair");
  } finally {
    globalThis.fetch = realFetch;
    console.log = quiet;
    console.warn = quietWarn;
    if (env.token === undefined) delete process.env.FLOWS_INGEST_TOKEN; else process.env.FLOWS_INGEST_TOKEN = env.token;
    if (env.url === undefined) delete process.env.FLOWS_INGEST_URL; else process.env.FLOWS_INGEST_URL = env.url;
    process.exitCode = env.exit;
    taint.clearTaint();
  }
  return bad;
}

function run(root, script, args, extraEnv, ms = 60000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, script), ...args], {
      cwd: root, env: { ...process.env, ...extraEnv },
    });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), ms);
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, out }); });
  });
}

async function exerciseStamp(root) {
  const bad = [];
  const dir = path.join(TMP, "emit" + copies++);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(root, "scripts/_dry.mjs"),
    'import { publish } from "./flows-nightly/store.mjs";\nawait publish("card:AAPL", { a: 1 });\nawait publish("list", [1, 2]);\nawait publish("nested", { x: { y: 1 } });\n');
  const r = await run(root, "scripts/_dry.mjs", ["--dry-run", "--emit", path.join(dir, "x.json")], {});
  if (r.status !== 0) bad.push("the dry publish exited " + r.status + ": " + r.out.slice(-200));
  const read = (name) => { try { return JSON.parse(readFileSync(path.join(dir, name), "utf8")); } catch { return undefined; } };
  if (JSON.stringify(read("x-card-AAPL.json")) !== '{"a":1,"fixture":true}') bad.push("an object payload must carry fixture:true");
  if (JSON.stringify(read("x-list.json")) !== "[1,2]") bad.push("an array payload is left as it is");
  if (!read("x-nested.json") || read("x-nested.json").fixture !== true) bad.push("every object payload is stamped");
  return bad;
}

async function exercisePreflight(root) {
  const bad = [];
  const seen = [];
  const vendor = http.createServer((req, res) => { seen.push(req.url); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); });
  await new Promise((r) => vendor.listen(0, "127.0.0.1", r));
  try {
    const base = { UW_API_KEY: "test", FLOWS_INGEST_TOKEN: "test", FLOWS_LIVE_TOKEN: "test", FLOWS_UW_BASE_URL: `http://127.0.0.1:${vendor.address().port}`, FLOWS_ALLOW_INTRADAY: "1" };
    const nightly = await run(root, "scripts/flows-pipeline.mjs", [], { ...base, FLOWS_INGEST_URL: "https://ingest.example/api/flows/ingest" });
    if (nightly.status !== 1 || !/never publishes/.test(nightly.out) || seen.length) bad.push(`the nightly against a fake feed and a real ingest must exit 1 before any feed request (exit ${nightly.status}, ${seen.length} requests)`);
    const unset = await run(root, "scripts/flows-pipeline.mjs", [], { ...base, FLOWS_INGEST_URL: "" });
    if (unset.status !== 1 || !/never publishes/.test(unset.out) || seen.length) bad.push(`and with the ingest unset (production by default) (exit ${unset.status}, ${seen.length} requests)`);
    const live = await run(root, "scripts/flows-pipeline.mjs", ["--live"], { ...base, FLOWS_INGEST_URL: "https://ingest.example/api/flows/ingest" });
    if (live.status !== 1 || !/never publishes/.test(live.out) || seen.length) bad.push(`and so must the live leg (exit ${live.status}, ${seen.length} requests)`);
  } finally {
    await new Promise((r) => vendor.close(r));
  }
  return bad;
}

async function exerciseStages(root) {
  const bad = [];
  const stages = await load(root, "scripts/flows-nightly/stages.mjs");
  const stage = (id, isolation, needs) => Object.freeze({ id, isolation, needs: Object.freeze(needs), publishes: Object.freeze([]) });
  const table = [stage("a", "fatal", []), stage("b", "isolated", ["a"]), stage("c", "isolated", ["b"])];
  const runner = stages.createStageRunner({ table });
  runner.step("a");
  const seen = [];
  let thrown = null;
  try {
    await runner.run("b", async () => { throw Object.assign(new Error("leak"), { fixtureLeak: true, code: "fixture_ticker" }); }, (e) => seen.push(e));
  } catch (error) { thrown = error; }
  if (!thrown || thrown.fixtureLeak !== true || seen.length) bad.push("an isolated stage that hits a fixture leak must rethrow it, not hand it to onError");
  const second = stages.createStageRunner({ table });
  second.step("a");
  const seen2 = [];
  let again = null;
  try { await second.run("b", async () => { throw new Error("ordinary"); }, (e) => seen2.push(e)); } catch (error) { again = error; }
  if (again || seen2.length !== 1) bad.push("while an ordinary failure in an isolated stage is still recorded and survived");
  return bad;
}

{
  const stagesRoot = copyTree();
  eq(await exerciseStore(stagesRoot), [], "THE PIPELINE PUBLISH GUARD: every refusal happens before the network, and every clean or loopback publish still posts");
  eq(await exerciseStamp(stagesRoot), [], "THE DRY-RUN MARKER: every object payload a dry run writes says fixture:true, and an array is left alone");
  eq(await exerciseStages(stagesRoot), [], "A FIXTURE LEAK ABORTS THE RUN even from an isolated stage");
  eq(await exercisePreflight(stagesRoot), [], "THE CONFIGURATION PREFLIGHT: a fake feed with the production ingest exits 1 before the first feed request");

  const S = "scripts/flows-nightly/store.mjs";
  const planted = {
    "the name and stamp rule dropped": [[S, "fixtureRefusal(key, body) || ", ""]],
    "the taint rule dropped": [[S, ' || (taint ? { code: "fixture_code", name: taint } : null)', ""]],
    "every ingest host waived": [[S, "if (fixtureHost(ingestHost(env))) return null;", "return null;"]],
    "the refusal only logged": [[S, "throw fixtureLeakError(leak, `publish ${key}`);", "console.warn(String(leak));"]],
    "the whole check removed": [[S, "const leak = publishRefusal(key, body);\n  if (leak) {\n    process.exitCode = 1;\n    throw fixtureLeakError(leak, `publish ${key}`);\n  }\n", ""]],
    "the check after the network": [[S, "const leak = publishRefusal(key, body);\n  if (leak) {\n    process.exitCode = 1;\n    throw fixtureLeakError(leak, `publish ${key}`);\n  }\n", ""], [S, "  landedKeys.add(key);\n  console.log(`  published", "  const leak = publishRefusal(key, body);\n  if (leak) throw fixtureLeakError(leak, `publish ${key}`);\n  landedKeys.add(key);\n  console.log(`  published"]],
    "the preflight waiving every feed base": [[S, 'if (vendor.status !== "redirect" && vendor.status !== "invalid") return null;', "return null;"]],
    "the preflight waiving an unset ingest": [[S, 'return new URL(env.FLOWS_INGEST_URL || "https://anilkaya.org/api/flows/ingest").hostname;', 'return new URL(env.FLOWS_INGEST_URL || "http://127.0.0.1/api/flows/ingest").hostname;']],
  };
  for (const [name, edits] of Object.entries(planted)) {
    const root = copyTree(edits);
    const bad = [...await exerciseStore(root), ...(/preflight/.test(name) ? await exercisePreflight(root) : [])];
    drop(root);
    ok(bad.length > 0, `PLANTED WRONG BUILD (${name}) fails the publish battery: ${bad[0] || "NOT CAUGHT"}`);
  }
  const noStamp = copyTree([[S, "(plain ? { ...payload, fixture: true } : payload)", "payload"]]);
  ok((await exerciseStamp(noStamp)).length > 0, "PLANTED WRONG BUILD (the dry-run stamp removed) is caught");
  drop(noStamp);
  const noRethrow = copyTree([["scripts/flows-nightly/stages.mjs", " || (error && error.fixtureLeak === true)", ""]]);
  ok((await exerciseStages(noRethrow)).length > 0, "PLANTED WRONG BUILD (an isolated stage swallowing a leak) is caught");
  drop(noRethrow);
  drop(stagesRoot);
}

{
  const day = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  const clock = { payload: { clock: { day, tier1: {} } } };
  const clean = healthChecks({ sessionDate: day, now, clockRead: clock, marketRead: { payload: { rows: [["NVDA", 1]] } } });
  ok(!clean.failures.some((f) => /fixture ticker/.test(f)), "HEALTH: clean live bodies raise no fixture line");
  for (const [slot, key] of [["marketRead", "live:market"], ["focusRead", "live:focus"], ["heartbeatRead", "live:heartbeat"], ["seriesRead", "live:strips:series"], ["clockRead", "clock"]]) {
    const v = healthChecks({ sessionDate: day, now, clockRead: clock, [slot]: { payload: { rows: [["SYN001", 1]], day } } });
    ok(v.failures.some((f) => /names the fixture ticker SYN001/.test(f) && f.includes(key)), `a ${key} body naming SYN001 fails the health gate`);
  }
  const other = healthChecks({ sessionDate: "2000-01-01", now, marketRead: { payload: { rows: [["GONE1"]] } } });
  ok(other.failures.some((f) => /fixture ticker GONE1/.test(f)), "and the check runs even when the live checks do not apply");
  const line = healthChecks({ sessionDate: day, now, marketRead: { payload: { rows: ["SYN001"] } } }).failures.find((f) => /fixture ticker/.test(f));
  const code = HEALTH_CODES.find(([, re]) => re.test(line));
  eq(code && code[0], "fixture-name", "and the issue classifier names it fixture-name");
  ok(!healthChecks({ sessionDate: day, now, marketRead: { payload: { headline: "SYS100 launch" } } }).failures.some((f) => /fixture ticker/.test(f)), "a sentence that says SYS100 does not");
}

{
  const FAKE_MODULES = (f) => f === "scripts/flows-nightly/fixtures.mjs" || f === "scripts/flows-legs/live-day.mjs" || /^scripts\/flows-legs\/(?:fake-vendor|[\w-]+-fake)\.mjs$/.test(f);
  const TOKEN_HOMES = (f) => /^(?:tests|docs)\//.test(f) || /\.md$/.test(f) || FAKE_MODULES(f) || f === "scripts/render-preview.fixtures.json" ||
    f === "scripts/eval-garch-tails.mjs" || f === "shared/flows-fixture-names.js";
  const TOKEN = /\b(?:SY[A-Z]\d{3}|GONE\d)\b/;
  const FAKE_CALL_WINDOW = 4;
  const scan = (files, read) => {
    const problems = [];
    for (const f of files) {
      if (TOKEN_HOMES(f) || !/\.(?:m?js|json|html|css|ya?ml|toml|sql|py)$/.test(f)) continue;
      const m = TOKEN.exec(read(f));
      if (m) problems.push(`${f} spells the fixture name ${m[0]} outside a fixture home`);
    }
    const fakeFiles = files.filter(FAKE_MODULES);
    const names = new Set();
    for (const f of fakeFiles) for (const m of read(f).matchAll(/^export (?:async )?function (\w+)/gm)) names.add(m[1]);
    const calls = new RegExp("\\b(" + [...names].join("|") + ")\\(", "g");
    for (const f of files.filter((x) => /\.(?:m?js)$/.test(x) && !x.startsWith("tests/") && !FAKE_MODULES(x))) {
      const lines = read(f).split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(?:import|export)\b.*\bfrom\b/.test(l)) return;
        for (const m of l.matchAll(calls)) {
          const window = lines.slice(Math.max(0, i - FAKE_CALL_WINDOW), i + 1).join("\n");
          let owner = null;
          for (let j = i; j >= 0 && owner === null; j--) {
            const decl = /^(?:export )?(?:async )?function (\w+)/.exec(lines[j]);
            if (decl) owner = decl[1];
          }
          if (!/\b(?:DRY_RUN|dryRun)\b/.test(window) && !(owner && /^dry/i.test(owner))) problems.push(`${f}:${i + 1} calls ${m[1]} outside a dry-run branch`);
        }
      });
    }
    const fixtures = read("scripts/flows-nightly/fixtures.mjs").split("\n");
    fixtures.forEach((l, i) => {
      const m = /^export (?:async )?function (\w+)\(.*\) \{$/.exec(l);
      if (m && !new RegExp(`^\\s+touch\\("${m[1]}"\\);`).test(fixtures[i + 1] || "")) problems.push(`fixtures.mjs: ${m[1]} does not taint on entry`);
    });
    for (const [file, fn] of [["scripts/flows-legs/fake-vendor.mjs", "makeFakeVendor"], ["scripts/flows-legs/flow-fake.mjs", "makeFlowFakeVendor"],
      ["scripts/flows-legs/flow-fake.mjs", "makeFlowFakeStore"], ["scripts/flows-legs/vol-fake.mjs", "fakeVolVendor"], ["scripts/flows-legs/live-fake.mjs", "fakeLiveVendor"],
      ["scripts/flows-legs/live-fake.mjs", "fakeBoards"]]) {
      const text = read(file);
      if (!new RegExp(`export function ${fn}\\(.*\\) \\{\\n  touch\\("${fn}"\\);`).test(text)) problems.push(`${file}: ${fn} does not taint on entry`);
    }
    for (const f of files.filter((x) => /^(?:scripts|shared|server|assets)\//.test(x) && /\.(?:m?js)$/.test(x) && x !== "scripts/flows-legs/taint.mjs")) {
      if (/\bclearTaint\b/.test(read(f))) problems.push(`${f} clears the taint, which only a test may do`);
    }
    return problems;
  };
  const read = (f) => source(f);
  eq(scan(tracked, read), [], "STATIC CONFINEMENT: no fixture name outside its homes, no fake called outside a dry-run branch, every fake taints on entry, nothing but a test clears the taint");

  const files = tracked.slice();
  const overlay = (patch) => (f) => (f in patch ? patch[f] : read(f));
  const mutations = {
    "a fixture name in the Worker": [{ "worker.js": source("worker.js") + '\nconst x = "SYN001";\n' }, /worker\.js spells the fixture name SYN001/],
    "a fixture name in shared code": [{ "shared/flows-cross.js": source("shared/flows-cross.js") + '\nconst x = ["GONE1"];\n' }, /spells the fixture name GONE1/],
    "a fixture name in the browser": [{ "assets/js/flows-ui.js": source("assets/js/flows-ui.js") + '\nconst x = "SYL040";\n' }, /assets\/js\/flows-ui\.js spells/],
    "a fixture name in a page": [{ "index.html": source("index.html") + "\nSYS001\n" }, /index\.html spells/],
    "a fake called from a section with no dry branch": [{
      "scripts/flows-nightly/sections/market.mjs": source("scripts/flows-nightly/sections/market.mjs") + "\nfunction leak() {\n  return fakeChain(\"AAPL\", 100, 1);\n}\n",
    }, /market\.mjs:\d+ calls fakeChain outside a dry-run branch/],
    "a fake called from the Worker": [{ "shared/flows-live-worker.js": source("shared/flows-live-worker.js") + "\nfunction leak() {\n  return makeFakeVendor({});\n}\n" }, null],
    "a fixtures export that does not taint": [{
      "scripts/flows-nightly/fixtures.mjs": source("scripts/flows-nightly/fixtures.mjs").replace('  touch("fakeChain");\n', ""),
    }, /fakeChain does not taint on entry/],
    "a fake constructor that does not taint": [{
      "scripts/flows-legs/vol-fake.mjs": source("scripts/flows-legs/vol-fake.mjs").replace('  touch("fakeVolVendor");\n', ""),
    }, /fakeVolVendor does not taint on entry/],
    "production code that clears the taint": [{ "scripts/flows-nightly/store.mjs": source("scripts/flows-nightly/store.mjs") + "\nclearTaint();\n" }, /clears the taint/],
  };
  for (const [name, [patch, expected]] of Object.entries(mutations)) {
    const problems = scan(files, overlay(patch));
    ok(problems.length > 0 && (expected === null || problems.some((p) => expected.test(p))), `PLANTED WRONG BUILD (${name}) is caught: ${problems[0] || "NOT CAUGHT"}`);
  }
}

{
  const SAMPLE_WORLD = ["412 outcomes", "41,880", "671.24", "187.42", "7.4x baseline", "reliability 0.97", "0.31 s p50", "1.42B"];
  const homes = tracked.filter((f) => /^(?:assets|shared|server)\//.test(f) && /\.(?:m?js|css|html|json)$/.test(f) || f === "worker.js");
  const hits = [];
  for (const f of homes) {
    const text = source(f);
    for (const s of SAMPLE_WORLD) if (text.includes(s)) hits.push(`${f}: ${s}`);
  }
  eq(hits, [], "VISION SAMPLE WORLD: none of its invented figures is in a served or Worker file");
}

{
  const preview = source("scripts/render-preview.mjs");
  ok(/Fixture data/.test(preview) && /fixtureRibbon/.test(preview) && /ribboned\(html\)/.test(preview), "PREVIEWS: every render-preview page carries the Fixture data ribbon");
  ok(!/preview\.local/.test(preview) && /preview\.test/.test(preview), "and runs on a .test origin, so the client guard treats it as a test host");
}

{
  const dir = await nightlyEmit();
  const emitted = readdirSync(dir).filter((f) => f.endsWith(".json"));
  ok(emitted.length > 300, `THE DRY EMIT: ${emitted.length} payloads`);
  const unstamped = emitted.filter((f) => {
    let body;
    try { body = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { return false; }
    return body && typeof body === "object" && !Array.isArray(body) && body.fixture !== true;
  });
  eq(unstamped, [], "every object payload of the dry emit says fixture:true, real-named cards included");
  const real = emitted.filter((f) => /card-(?:AAPL|NVDA)\.json$/.test(f));
  ok(real.length > 0 && real.every((f) => fixtureRefusal("card:" + f.replace(/^.*card-/, "").replace(".json", ""), readFileSync(path.join(dir, f), "utf8")).code === "fixture_payload"),
    "so the Worker door refuses a real-named fixture card by its stamp");
}

console.log(`✓ fixture-guard: ${checks} assertions — the reserved namespace and its lookalikes, the Worker door (key, body, live and read refusals, waived on loopback and .test hosts only, never by an environment variable), the pipeline's pre-network refusal, taint, dry-run stamp and configuration preflight, the isolated-stage rethrow, the health line, the static confinement scan and the client's copy of the rule, each proved by planted wrong builds`);
