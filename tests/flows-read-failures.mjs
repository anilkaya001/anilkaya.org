import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCard, applyReadFailures, failedRead, READ_FAILURE_PANELS, READ_FAILURES_MAX } from "../shared/flows-card.js";
import { createCallMeter, opIdOf, classOf, quantileMs, summarize, wireDelta, LATENCY_EDGES_MS, OTHER_OP } from "../shared/flows-call-meter.js";
import { OPS } from "../shared/flows-vendor-ops.js";
import { createStageRunner } from "../scripts/flows-nightly/stages.mjs";
import { stepRateController } from "../scripts/flows-nightly/vendor.mjs";
import { RATE } from "../scripts/flows-nightly/vendor-params.mjs";
import { nightlySource } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url);

const BASE = {
  ticker: "AAA", row: { close: 100, prev_close: 99 }, features: {}, strikes: [], ticks: [], expiries: [], maxPain: [], surface: [],
  chain: null, darkpool: null, oiDeltas: null, termStructure: null, ivRank: null, sessionDate: "2026-08-24", generatedAt: "2026-08-24T22:00:00Z",
};

{
  const plain = buildCard(BASE);
  eq(JSON.stringify(buildCard({ ...BASE, readFailures: [] })), JSON.stringify(plain), "A HEALTHY CARD IS BYTE-IDENTICAL: an empty failure list changes nothing");
  eq(JSON.stringify(buildCard({ ...BASE, readFailures: null })), JSON.stringify(plain), "and so does none");
  ok(!("readFailures" in plain), "and carries no readFailures key");

  const failed = buildCard({ ...BASE, readFailures: [
    { route: "darkpool", status: 503, kind: "http" },
    { route: "spot-exposures-expiry-strike", status: null, kind: "timeout" },
    { route: "max-pain", status: null, kind: "network" },
  ] });
  eq(failed.panels.darkpool.status, "unavailable", "a darkpool read that failed is an unavailable panel");
  eq(failed.panels.darkpool.code, "failed", "with the code failed");
  ok(/darkpool read answered HTTP 503/.test(failed.panels.darkpool.reason) && /failed read and not an empty one/.test(failed.panels.darkpool.reason),
    "whose reason names the route and the HTTP status");
  ok(/spot-exposures-expiry-strike read timed out/.test(failed.panels.surface.reason) && failed.panels.surface.code === "failed", "a timed-out surface read says it timed out");
  eq(failed.panels.oiDeltas.code, undefined, "a panel whose read did not fail keeps its own state");
  eq(failed.readFailures.map((f) => f.route), ["darkpool", "spot-exposures-expiry-strike", "max-pain"], "and the card lists every failed read, the max-pain one included");
  ok(typeof failed.panels.darkpool.note === "string" && failed.panels.darkpool.note.length > 20, "the panel keeps its note");

  const mixed = buildCard({ ...BASE, readFailures: [{ route: "term-structure", status: 502, kind: "http" }] });
  eq(mixed.panels.volContext.code, "failed", "a volatility context with both feeds missing names the failed one");
  const half = buildCard({ ...BASE, termStructure: { data: [] }, readFailures: [{ route: "iv-rank", status: 500, kind: "http" }] });
  ok(half.panels.volContext.code !== "failed" || half.panels.volContext.status !== "ok", "a panel that still read something is never relabelled as failed when it is ok");
}

{
  const card = { panels: { surface: { status: "ok", rows: [1] }, darkpool: { status: "quiet", reason: "none" } } };
  applyReadFailures(card, [{ route: "spot-exposures-expiry-strike", status: 500 }, { route: "darkpool", status: 404 }]);
  eq(card.panels.surface.status, "ok", "an ok panel is never overwritten by a failure record");
  eq(card.panels.darkpool.code, "failed", "a quiet panel whose read failed is failed");
  eq(failedRead({ route: "x", status: 404 }), "the feed's x read answered HTTP 404 on this run, so this is a failed read and not an empty one", "the sentence");
  eq(failedRead({ route: "x" }), "the feed's x read could not be reached on this run, so this is a failed read and not an empty one", "and for a read that never landed");
  const many = { panels: {} };
  applyReadFailures(many, Array.from({ length: 40 }, (_, i) => ({ route: "r" + i, status: 500 })));
  eq(many.readFailures.length, READ_FAILURES_MAX, "the list is capped");
  ok(Object.values(READ_FAILURE_PANELS).every((l) => Object.isFrozen(l)) && Object.isFrozen(READ_FAILURE_PANELS), "and the map is frozen");
  eq(applyReadFailures(null, [{ route: "x" }]), null, "a missing card is returned as it is");
}

{
  eq(opIdOf("/api/stock/AAPL/ohlc/1d"), "ohlc-1d", "a path maps to its registered operation");
  eq(opIdOf("/api/stock/AAPL/ohlc/1d?timeframe=2Y"), "ohlc-1d", "ignoring the query");
  eq(opIdOf("/api/darkpool/recent"), "darkpool-recent", "the literal route wins over a template");
  eq(opIdOf("/api/darkpool/AAPL"), "darkpool", "and the template takes the rest");
  eq(opIdOf("/api/market/XLK/sector-tide"), "sector-tide", "a template in the middle");
  eq(opIdOf("/api/nothing"), OTHER_OP, "an unknown path is other");
  eq(opIdOf(null), OTHER_OP, "and so is no path");
  for (const op of OPS) eq(opIdOf(op.path.replace(/\{[a-z_]+\}/g, "X1")), op.id === "darkpool" ? "darkpool" : op.id, `${op.id} maps to itself`);
  eq([classOf(200), classOf(204), classOf(301), classOf(404), classOf(429), classOf(503), classOf(0), classOf(undefined, "timeout"), classOf(500, "network")],
    ["2xx", "2xx", "3xx", "4xx", "429", "5xx", "network", "timeout", "network"], "classes");

  const meter = createCallMeter({ maxOps: 3 });
  meter.record({ path: "/api/stock/A/max-pain", ms: 120, bytes: 2048, status: 200 });
  meter.record({ path: "/api/stock/B/max-pain", ms: 80.4, bytes: Number.NaN, status: 503 });
  meter.record({ path: "/api/stock/B/max-pain", ms: 30000, kind: "timeout" });
  meter.record({ op: "iv-rank", ms: -4, bytes: -1, status: 200 });
  meter.record({ op: "nope", ms: 10, status: 200 });
  meter.record({ op: "nope2", ms: 10, status: 200 });
  const snap = meter.snapshot();
  eq(snap.total, { n: 6, ms: 30000 + 120 + 80 + 0 + 10 + 10, bytes: 2048, bad: 2 }, "totals count every attempt, a bad number as zero, and the non-2xx ones as bad");
  eq(snap.ops["max-pain"].classes, { "2xx": 1, "5xx": 1, timeout: 1 }, "the classes of one operation");
  eq(snap.ops["max-pain"].maxMs, 30000, "the slowest attempt");
  ok(Object.keys(snap.ops).length <= 4 && snap.ops[OTHER_OP].n === 1, "operations past the cap fold into other");
  eq(quantileMs(snap.ops["max-pain"].buckets, 0.5), 200, "the median falls in its bucket");
  eq(quantileMs(snap.ops["max-pain"].buckets, 1), null, "and a value beyond the last edge has no upper bound");
  eq(quantileMs(new Array(LATENCY_EDGES_MS.length + 1).fill(0), 0.5), null, "no samples, no quantile");
  const s = summarize(snap, { top: 2 });
  eq([s.n, s.bad, s.slowest.length, s.slowest[0].op], [6, 2, 2, "max-pain"], "the summary names the slowest operations");
  eq(wireDelta({ n: 1, ms: 10, bytes: 5, bad: 0 }, { n: 4, ms: 70, bytes: 2053, bad: 1 }), { n: 3, ms: 60, bytes: 2048, bad: 1 }, "a delta");
  meter.reset();
  eq(meter.totals(), { n: 0, ms: 0, bytes: 0, bad: 0 }, "a reset empties the meter");
}

{
  let t = 0;
  let totals = { n: 0, ms: 0, bytes: 0, bad: 0 };
  const runner = createStageRunner({ clock: () => t, wire: () => ({ ...totals }) });
  runner.step("session");
  totals = { n: 3, ms: 900, bytes: 4096, bad: 1 };
  t = 50;
  runner.step("universe");
  t = 60;
  runner.step("enrich");
  runner.finish();
  const rec = runner.records();
  eq(rec[0].wire, { ms: 900, kb: 4, bad: 1 }, "a stage that made calls carries its wire time, kilobytes and failures");
  ok(!("wire" in rec[1]) && !("wire" in rec[2]), "and a stage that made none carries no wire field");
  const dry = createStageRunner({ clock: () => 0 });
  dry.step("session");
  dry.finish();
  ok(!("wire" in dry.records()[0]), "a runner with no meter writes none");
  assert.throws(() => { const r = createStageRunner(); r.step("session"); r.detail({ wire: 1 }); }, /record field/);
  checks++;
}

{
  const meter = createCallMeter();
  for (let i = 0; i < 40; i++) meter.record({ path: "/api/stock/AAPL/option-contracts", ms: 900, status: 200 });
  meter.record({ path: "/api/stock/AAPL/option-contracts", ms: 900, status: 503, note: { t: "plain", pg: 2, a: 0 } });
  meter.record({ path: "/api/option-trades/multi-leg", ms: 80, status: 422, note: { t: "plain", pg: 500, a: 0, ticker: "AAPL", url: "/api/option-trades/multi-leg?ticker_symbol=AAPL" } });
  meter.record({ path: "/api/option-trades/multi-leg", ms: 90, status: 422, note: { t: "dot", pg: 500, a: 0 } });
  meter.record({ path: "/api/option-trades/multi-leg", ms: 70, status: 200, kind: "parse", note: { pg: 0, a: 0 } });
  meter.record({ path: "/api/option-trades/multi-leg", ms: 60, status: 200 });
  const snap = meter.snapshot();
  eq(snap.ops["multi-leg"].codes, { 422: 2, parse: 1 }, "every failed attempt is filed by its exact code: the HTTP status, or timeout, network or parse");
  eq(snap.ops["multi-leg"].classes, { "4xx": 2, network: 1, "2xx": 1 }, "while the class tally keeps its seven classes");
  eq(snap.ops["multi-leg"].first, [{ code: "422", ms: 80, t: "plain", pg: 500, a: 0 }, { code: "422", ms: 90, t: "dot", pg: 500, a: 0 }, { code: "parse", ms: 70, pg: 0, a: 0 }],
    "the first three failures keep their code, time, ticker shape, page and attempt, and never the ticker or the URL");
  const s = summarize(snap, { top: 1 });
  eq(s.slowest.map((o) => o.op), ["option-contracts"], "multi-leg is not among the slowest");
  eq(s.fails.map((f) => [f.op, f.bad, f.codes]), [["multi-leg", 3, { 422: 2, parse: 1 }], ["option-contracts", 1, { 503: 1 }]],
    "BUT THE SUMMARY NAMES EVERY OPERATION THAT FAILED, worst first, with its codes");
  ok(JSON.stringify(s.fails).length < 600, "in a few hundred bytes");

  let wire = { n: 0, ms: 0, bytes: 0, bad: 0 };
  let fails = {};
  const runner = createStageRunner({ clock: () => 0, wire: () => ({ ...wire }), fails: () => ({ ...fails }) });
  runner.step("session");
  wire = { n: 90, ms: 9000, bytes: 0, bad: 3 };
  fails = { "multi-leg 422": 2, "option-contracts 503": 1 };
  runner.step("universe");
  wire = { n: 95, ms: 9500, bytes: 0, bad: 3 };
  runner.finish();
  eq(runner.records()[0].wire.fail, "multi-leg 422: 2, option-contracts 503: 1", "a stage with failed calls says which operation failed and how");
  ok(!("fail" in runner.records()[1].wire), "and a clean stage says nothing");

  let st = { delayMs: 150, floorMs: 150 };
  for (let i = 0; i < 5; i++) st = stepRateController(st, "error");
  eq(st, { delayMs: 150 * RATE.errorBackoffX, floorMs: 150 },
    "five failures in a row slow the pace to four times the floor, not to the 5 s ceiling: one failing call's retries no longer stall every other call");
  eq(stepRateController({ delayMs: 5000, floorMs: 150 }, "error").delayMs, 5000, "and a failure never shortens a backoff a 429 set");
  ok(RATE.errorBackoffX * RATE.floorCeilingMs <= RATE.maxDelayMs, "the error ceiling sits inside the 5 s per-call ceiling at every floor");
}

{
  const src = nightlySource();
  ok(!/\.catch\(\(\) => (\[\]|null)\)/.test(src.slice(src.indexOf("const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw"), src.indexOf("const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw") + 2400)),
    "the card section's per-name reads swallow nothing: every one records its failure");
  ok((src.match(/\.catch\(soft\("/g) || []).length >= 14, "the card, dossier and enrichment reads all record theirs");
  ok(/readFailures: lost,/.test(src) && /readFailures: reads\.readFailures/.test(src), "and hand them to buildCard");
  ok(/\.\.\.\(stats\.calls > 0 \? \{ feed: summarize\(wire\.snapshot\(\)\) \} : \{\}\)/.test(src), "meta carries the wire summary only when the run called the feed");
}

const write = (body) => {
  const dir = mkdtempSync(join(tmpdir(), "flows-fail-"));
  const file = join(dir, "run.mjs");
  writeFileSync(file, body);
  return { dir, file };
};

{
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url.includes("MISSING")) { res.writeHead(404, { "Content-Type": "application/json" }); res.end("{}"); return; }
    if (req.url.includes("BROKEN")) { res.writeHead(503, { "Content-Type": "application/json" }); res.end("{}"); return; }
    if (req.url.includes("HANG")) return;
    res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "14" });
    res.end('{"data":[{}]}\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const vendor = new URL("scripts/flows-nightly/vendor.mjs", ROOT).href;
  const script = `
    const m = await import(${JSON.stringify(vendor)});
    const out = {};
    const limits = () => [m.vendorTimeoutMs("/api/stock/AAPL/max-pain"), m.vendorTimeoutMs("/api/stock/AAPL/option-contracts"),
      m.vendorTimeoutMs("/api/stock/AAPL/ohlc/1d", { timeframe: "2Y" }), m.vendorTimeoutMs("/api/stock/AAPL/ohlc/1d", { timeframe: "1M" })];
    if (process.env.LIMITS === "1") { console.log(JSON.stringify({ limit: limits() })); process.exit(0); }
    const seen = async (name, path) => {
      try { await m.uw(path); out[name] = "answered"; } catch (e) { out[name] = m.readFailure("probe", e); }
    };
    await seen("missing", "/api/stock/MISSING/max-pain");
    await seen("hang", "/api/darkpool/HANG");
    await seen("broken", "/api/stock/BROKEN/oi-change");
    await m.uw("/api/stock/AAPL/ohlc/1d", { timeframe: "2Y" });
    out.snapshot = m.wire.snapshot();
    out.limit = limits();
    console.log(JSON.stringify(out));
    process.exit(0);
  `;
  const run = (env) => new Promise((resolve) => {
    const { dir, file } = write(script);
    const child = spawn(process.execPath, [file], { env: { ...process.env, UW_API_KEY: "k", FLOWS_UW_BASE_URL: `http://127.0.0.1:${port}`, ...env } });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.stderr.on("data", (c) => { out += c; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.on("close", () => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); resolve(out.trim().split("\n").pop()); });
  });
  const r = JSON.parse(await run({ FLOWS_UW_TIMEOUT_MS: "300", FLOWS_UW_NIGHTLY_DEADLINE: "" }));
  eq(r.missing, { route: "probe", status: 404, kind: "http" }, "A 404 reaches the caller as a failure with its status");
  eq(r.hang, { route: "probe", status: null, kind: "timeout" }, "a read that never answers reaches it as a timeout");
  eq(r.broken, { route: "probe", status: 503, kind: "http" }, "a 503 that outlasts the retries reaches it with the status of the last try");
  eq(hits.filter((u) => u.includes("BROKEN")).length, 5, "after the five attempts the client has always made");
  eq(r.snapshot.ops["max-pain"].classes, { "4xx": 1 }, "the meter counted the 404");
  eq(r.snapshot.ops.darkpool.classes, { timeout: 2 }, "the two timed-out tries");
  eq(r.snapshot.ops["oi-change"].classes, { "5xx": 5 }, "the five refused tries");
  eq(r.snapshot.ops["ohlc-1d"].classes, { "2xx": 1 }, "and the healthy read");
  eq(r.snapshot.ops["ohlc-1d"].bytes, 14, "with the length the feed declared");
  eq(r.limit, [300, 300, 300, 300], "an override applies to the nightly too");
  eq(JSON.parse(await run({ LIMITS: "1", FLOWS_UW_TIMEOUT_MS: "" })).limit, [30000, 45000, 45000, 30000],
    "the default is 30 s, 45 s for a chain page and the two-year bars");
  eq(JSON.parse(await run({ LIMITS: "1", FLOWS_UW_TIMEOUT_MS: "5" })).limit, [30000, 45000, 45000, 30000], "and an override below 100 ms is ignored");
  eq(JSON.parse(await run({ LIMITS: "1", FLOWS_UW_TIMEOUT_MS: "", FLOWS_UW_NIGHTLY_DEADLINE: "off" })).limit, [0, 0, 0, 0], "FLOWS_UW_NIGHTLY_DEADLINE=off restores the unbounded client");
  server.close();
}

console.log(`flows-read-failures: ${checks} checks passed`);
