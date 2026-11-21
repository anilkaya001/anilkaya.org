import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { failureEntry, failureLine, emitFailure, errorText } from "../shared/flows-log.js";
import { logFailure, failureEntry as serverEntry } from "../server/log.js";
import * as K from "../server/http.js";
import * as W from "../shared/flows-live-worker.js";
import { askModels } from "../shared/flows-ai.js";
import { readingSafe } from "../shared/flows-reading-worker.js";
import { easternInstant } from "../shared/flows-freshness.js";
import { workerSource, moduleSource, expect, treeFiles } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const HEAD = ["event", "message", "level", "route", "code"];

{
  const e = failureEntry("error", "neuron failed", { ticker: "NVDA" }, new Error("boom"));
  eq(Object.keys(e), [...HEAD, "ticker", "error"], "the shape is event, message, level, route, code, the caller's fields, then error");
  eq([e.event, e.message, e.level, e.route, e.code, e.error], ["neuron failed", "neuron failed", "error", null, null, "boom"],
    "message is the event's alias and an unknown route and code are null, never absent");
  const bare = failureEntry("warn", "flight abandoned", { flight: "clock", waitMs: 5 });
  eq(Object.keys(bare), [...HEAD, "flight", "waitMs", "error"], "a line with no error still ends in error");
  eq([bare.level, bare.error], ["warn", null], "and the error is null, not the text undefined");
  eq(failureEntry("error", "x", {}, undefined).error, null, "an undefined error is null");
  eq(failureEntry("error", "x", {}, null).error, null, "and so is a null one");
  eq(failureEntry("error", "x", {}, "plain").error, "plain", "a string error keeps its text");
  eq(failureEntry("error", "x", {}, new TypeError("t")).error, "t", "a subclass keeps its message");
  eq(failureEntry("error", "x", {}, { message: "m" }).error, "[object Object]", "a plain object is stringified as errorText does");
  eq(failureEntry("error", "x", { error: "from fields" }).error, "from fields", "an error key in the fields is the error when none is passed");
  eq(failureEntry("error", "x", { error: "from fields" }, "argument").error, "argument", "and the argument wins over it");
  eq(failureEntry("error", "request failed", { method: "GET", path: "/api/x" }, "e").route, "/api/x", "the route is the path when the caller gives a path");
  eq(failureEntry("error", "x", { route: "tier1", path: "/p" }).route, "tier1", "and a named route wins over the path");
  eq(failureEntry("error", "x", {}, K.HttpError.of("forbidden")).code, "forbidden", "the code is an error's own string code");
  eq(failureEntry("error", "x", { code: "chain.absent" }, new Error("e")).code, "chain.absent", "or the caller's");
  eq(failureEntry("error", "x", {}, Object.assign(new Error("e"), { code: 7 })).code, null, "a numeric code is not a code");
  const spoof = failureEntry("error", "real", { event: "spoof", message: "spoof", level: "info", route: 5, code: 6, error: "e1" }, "e2");
  eq([spoof.event, spoof.message, spoof.level, spoof.route, spoof.code, spoof.error], ["real", "real", "error", null, null, "e2"],
    "a field cannot rewrite the reserved keys");
  eq(Object.keys(spoof), [...HEAD, "error"], "and does not add a second copy");
  eq(failureEntry("info", "x", {}).level, "error", "a level that is not warn or error is error");
  eq(failureEntry("warn", "x", null).level, "warn", "null fields are allowed");
  eq(failureEntry("error", 42, {}).event, "42", "an event is a string");
}

{
  const line = failureLine("error", "neuron failed", { ticker: "NVDA" }, new Error("boom"));
  ok(!/\n/.test(line), "a line is one line");
  eq(JSON.parse(line), failureEntry("error", "neuron failed", { ticker: "NVDA" }, new Error("boom")), "and parses back to the entry");
  const circular = {};
  circular.self = circular;
  const fallback = JSON.parse(failureLine("error", "cyclic", { circular }, "e"));
  eq([fallback.event, fallback.level, fallback.error], ["cyclic", "error", "log entry could not be serialised"], "an entry that cannot be serialised still logs its event");
  const big = JSON.parse(failureLine("warn", "big", { n: 1n }));
  eq([big.event, big.level], ["big", "warn"], "a BigInt field does not throw");
}

{
  const calls = [];
  const sink = { error: (l) => calls.push(["error", l]), warn: (l) => calls.push(["warn", l]) };
  emitFailure(sink, "warn", "a", {}, "x");
  emitFailure(sink, "error", "b");
  emitFailure(sink, "info", "c");
  eq(calls.map((c) => [c[0], JSON.parse(c[1]).event]), [["warn", "a"], ["error", "b"], ["error", "c"]], "one call on the sink's own level, with a bad level sent to error");
  eq(emitFailure({}, "error", "d"), undefined, "a sink with no method is ignored");
  eq(emitFailure({ error() { throw new Error("sink"); } }, "error", "d"), undefined, "and a sink that throws is swallowed: logging never fails a request");
  eq(emitFailure(null, "error", "d"), undefined, "as is no sink");
}

{
  const logged = [];
  const real = { error: console.error, warn: console.warn };
  console.error = (line) => logged.push(["error", line]);
  console.warn = (line) => logged.push(["warn", line]);
  try {
    logFailure("error", "neuron failed", { ticker: "NVDA" }, new Error("boom"));
    logFailure("warn", "flows schema bootstrap failed", {}, new Error("boom"));
  } finally {
    console.error = real.error;
    console.warn = real.warn;
  }
  eq(logged.map(([level, line]) => [level, Object.keys(JSON.parse(line))]), [
    ["error", [...HEAD, "ticker", "error"]],
    ["warn", [...HEAD, "error"]],
  ], "logFailure writes the console at call time on the level it was given");
  ok(serverEntry === failureEntry && K.errorText === errorText, "the server module and the kernel re-export the leaf's builder and text rule");
}

const capture = () => {
  const lines = [];
  const sink = { error: (l) => lines.push(JSON.parse(l)), warn: (l) => lines.push(JSON.parse(l)) };
  return { lines, sink };
};
const withConsole = async (run) => {
  const real = { error: console.error, warn: console.warn };
  const { lines, sink } = capture();
  console.error = sink.error;
  console.warn = sink.warn;
  try { await run(); } finally { console.error = real.error; console.warn = real.warn; }
  return lines;
};
const SHAPE = (line, event, extra = []) => {
  eq(Object.keys(line).slice(0, 5), HEAD, event + ": the head of the shape");
  eq(Object.keys(line).at(-1), "error", event + ": ends in error");
  eq([line.event, line.message], [event, event], event + ": event and its alias");
  for (const k of extra) ok(k in line, event + ": carries " + k);
};

{
  const lines = await withConsole(async () => {
    W.flightAbandoned("clock", Date.now() - 1500, 1, 0);
    const db = { batch: async (list) => { if (list.length > 1) throw new Error("no such column: t1_over_ms"); return []; }, prepare: () => ({ run: async () => ({}) }) };
    await W.batchWithLedger(db, [{ run: async () => ({}) }], { sql: "x" });
    await readingSafe({}, {}, "NVDA", null, {});
  });
  eq(lines.map((l) => l.event), ["flight abandoned", "ledger statement refused", "reading unavailable"], "the console sites in the live and reading modules each logged once");
  SHAPE(lines[0], "flight abandoned", ["flight", "waitMs", "abandoned", "recovered"]);
  eq([lines[0].level, lines[0].error], ["warn", null], "the abandoned flight is a warning with no error");
  SHAPE(lines[1], "ledger statement refused");
  eq([lines[1].level, lines[1].error], ["warn", "no such column: t1_over_ms"], "the refused ledger statement names the column");
  SHAPE(lines[2], "reading unavailable", ["ticker"]);
  eq(lines[2].ticker, "NVDA", "and the reading names its ticker");
}

{
  const { lines, sink } = capture();
  const ai = { run: async () => { throw new Error("boom") } };
  await askModels(ai, ["@cf/meta/llama-3.1-8b-instruct", "@cf/zai-org/glm-4.7-flash"], [{ role: "user", content: "x" }], {}, undefined, sink);
  eq(lines.length, 1, "a failover logs once");
  SHAPE(lines[0], "ai failover", ["from", "to", "why"]);
  eq(lines[0].error, "boom", "with the model's error");
}

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
function sqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const reads = /^\s*(SELECT|PRAGMA|WITH)/i;
  const exec = (sql, args) => {
    const st = db.prepare(sql);
    if (reads.test(sql)) return { results: st.all(...args), meta: {} };
    return { results: [], meta: { changes: st.run(...args).changes } };
  };
  return {
    db,
    D1: {
      prepare(sql) {
        const st = { sql, args: [], bind(...a) { st.args = a; return st; },
          first: async () => exec(sql, st.args).results[0] ?? null,
          all: async () => exec(sql, st.args),
          run: async () => exec(sql, st.args) };
        return st;
      },
      batch: async (list) => list.map((s) => exec(s.sql, s.args)),
    },
  };
}

{
  const day = "2026-09-22";
  const { D1 } = sqliteD1();
  W.memoClock(null, 0);
  const env = { DB: D1, UW_API_KEY: "k" };
  const t = capture();
  const at = easternInstant(day, 10 * 60);
  await W.rthTick(env, at, { fetchVendor: async () => { throw new Error("feed down"); }, log: t.sink });
  const unanswered = t.lines.find((l) => l.event === "live:market not written: no feed feed answered");
  ok(!!unanswered, "a Tier 1 read no feed answered logs through the leaf");
  SHAPE(unanswered, "live:market not written: no feed feed answered", ["statuses"]);
  eq(unanswered.error, null, "with no error: the feeds failed one by one, not the tick");

  const m = capture();
  const stale = { ...D1, batch: async () => [{ results: [{ id: 1, day, trading: 1 }] }, { results: [{ session: "2026-09-21" }] }] };
  await W.nightlyTick({ DB: stale }, easternInstant(day, 21 * 60), { log: m.sink });
  const missing = m.lines.find((l) => l.event === "nightly missing");
  ok(!!missing, "a nightly that has not landed by 21:00 ET logs");
  SHAPE(missing, "nightly missing", ["today", "metaSession"]);

  const f = capture();
  W.memoClock(null, 0);
  await W.focusTick(env, easternInstant(day, 10 * 60), { fetchVendor: async () => ({ data: [] }), log: f.sink });
  const notWritten = f.lines.find((l) => l.event === "live:focus not written");
  if (notWritten) SHAPE(notWritten, "live:focus not written", ["why", "asked", "hit"]);
  ok(f.lines.every((l) => l.event && Object.keys(l).slice(0, 5).join() === HEAD.join()), "and every line the focus tick wrote has the shape");
}

{
  const worker = (await import("../worker.js?log=1")).default;
  const lines = await withConsole(async () => {
    const env = { ASSETS: { fetch: async () => { throw new Error("assets exploded"); } } };
    const res = await worker.fetch(new Request("https://anilkaya.org/articles/"), env, { waitUntil() {} });
    eq(res.status, 500, "an unexpected throw is a 500 through the finaliser");
    await res.text();
  });
  const line = lines.find((l) => l.event === "request failed");
  ok(!!line, "and the Worker logs it once");
  SHAPE(line, "request failed", ["method", "path"]);
  eq([line.route, line.method, line.level, line.error], ["/articles/", "GET", "error", "assets exploded"], "with the path as the route, the method, and the error");
}

{
  const w = workerSource();
  const files = ["worker.js", ...treeFiles("shared"), ...treeFiles("server")];
  for (const file of files) {
    const text = moduleSource(file);
    ok(!/(?:console|log)\.(?:error|warn)\(\s*JSON\.stringify\(/.test(text.replace(/console\.error\(JSON\.stringify\(entry\)\)/g, "")),
      file + " writes no failure line by hand");
  }
  expect(w, /\bemitFailure\(/, { min: 15, why: "the injected-sink and console sites go through the leaf" });
  expect(w, /\blogFailure\("(?:error|warn)", /, { min: 7, why: "and the Worker's own sites through the server module" });
  expect(moduleSource("shared/flows-rt-hub.js"), /failureEntry\("error", message, fields, error\)/, { min: 1, max: 1, why: "the rail's one-per-minute log builds the same entry before its redaction" });
  expect(moduleSource("shared/flows-rt-hub.js"), /const entry = failureEntry\("error", message, fields, error\);\n\s+this\.log\(this\.redact\.deep\(entry\)\);/, { min: 1, max: 1, why: "and redacts the whole built entry before it is written" });
  const events = [...w.matchAll(/\b(?:emitFailure\((?:log|console), "(?:error|warn)", |logFailure\("(?:error|warn)", )"([^"]+)"/g)].map((m) => m[1]);
  ok(events.length >= 20 && events.every((e) => e.trim() === e && e.length > 3), "the event names found in the source are plain strings: " + events.length);
  ok(!/\.\.\.(?:sent|entry)\b/.test(w.slice(w.indexOf("export function failureEntry"))), "the leaf spreads no caller object into the head of the line");
}

console.log("server-log: " + checks + " checks");
