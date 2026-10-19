import { OPS } from "../../shared/flows-vendor-ops.js";
import { truthOp } from "./vendor.mjs";
import { world } from "./world.mjs";

const TOKENS = ["AAPL", "NVDA", "SPY", "x1", "tech", "XLK", "gold"];

const filled = (w, path) => path.replace(/\{[a-z_]+\}/g, () => w.pick(TOKENS));

const CLASS_TABLE = [[200, "2xx"], [204, "2xx"], [301, "3xx"], [400, "4xx"], [404, "4xx"], [422, "4xx"], [429, "429"], [500, "5xx"], [502, "5xx"], [503, "5xx"], [599, "5xx"]];

export function meterScenario(seed, mod) {
  const w = world(seed, "meter");
  for (const op of OPS) {
    const path = filled(w, op.path);
    const want = truthOp(path);
    const query = w.chance(0.3) ? "?limit=5&date=2026-08-24" : "";
    const slash = w.chance(0.1) ? "/" : "";
    w.check(mod.opIdOf(path + slash + query) === want, `${path}${slash}${query}: the registered operation is ${want}, the meter says ${mod.opIdOf(path + slash + query)}`);
  }
  w.check(mod.opIdOf("/api/darkpool/recent") === "darkpool-recent" && mod.opIdOf("/api/darkpool/AAPL") === "darkpool", "a literal route wins over a template that would also fit it");
  w.check(mod.opIdOf("/api/not/a/route") === mod.OTHER_OP && mod.opIdOf(undefined) === mod.OTHER_OP, "an unknown or absent path is other");
  for (const [status, cls] of CLASS_TABLE) w.check(mod.classOf(status) === cls, `${status} is ${cls}, not ${mod.classOf(status)}`);
  w.check(mod.classOf(200, "timeout") === "timeout" && mod.classOf(200, "network") === "network" && mod.classOf(0) === "network" && mod.classOf(undefined) === "network", "a kind outranks a status and no status is the network");

  for (const [status, kind, code] of [[404, undefined, "404"], [422, undefined, "422"], [503, undefined, "503"], [429, undefined, "429"], [0, "timeout", "timeout"], [0, "network", "network"], [200, "parse", "parse"], [undefined, undefined, "network"]]) {
    w.check(mod.codeOf(status, kind) === code, `${status} ${kind || ""} is the code ${code}, not ${mod.codeOf(status, kind)}`);
  }
  w.check(mod.classOf(200, "parse") === "network", "an unreadable body is in the network class and keeps its own code");
  for (const [t, shape] of [["AAPL", "plain"], ["BRK.B", "dot"], ["AAPL,MSFT", "list"], ["BF/B", "slash"], ["SYX001", "digit"], ["GOOGLX", "long"], ["", null], [null, null]]) {
    w.check(mod.shapeOf(t) === shape, `${t} is shaped ${shape}, not ${mod.shapeOf(t)}`);
  }
  w.check(mod.tickerOf("/api/stock/BRK.B/nope", {}) === "BRK.B" && mod.tickerOf("/api/option-trades/multi-leg", { ticker_symbol: "AAPL" }) === "AAPL" && mod.tickerOf("/api/market/market-tide", {}) === null,
    "the ticker is read from the path slot or the query, and a market route has none");
  w.check(mod.pageOf({ offset: 500 }) === 500 && mod.pageOf({ page: 2 }) === 2 && mod.pageOf({}) === 0 && mod.pageOf({ offset: "x" }) === 0, "the page is the offset, else the page number, else zero");

  const meter = mod.createCallMeter({ maxOps: 6 });
  const truth = { n: 0, ms: 0, bytes: 0, bad: 0, byOp: new Map() };
  const records = 40 + w.int(60);
  for (let i = 0; i < records; i++) {
    const op = w.pick(OPS).id;
    const [status, cls] = w.pick(CLASS_TABLE);
    const kind = w.chance(0.1) ? w.pick(["timeout", "network", "parse"]) : undefined;
    const ms = w.chance(0.05) ? Number.NaN : w.int(40000);
    const bytes = w.chance(0.3) ? Number.NaN : w.int(5e5);
    const note = { t: w.pick(["plain", "dot", "bogus", "<script>"]), pg: w.pick([0, 500, -1, "x"]), a: w.int(5), ticker: "AAPL", url: "https://x?token=1" };
    const got = meter.record({ op, ms, bytes, status: kind ? 0 : status, kind, note });
    const want = kind === "parse" ? "network" : kind || cls;
    w.check(got === want, `record answers the class it filed: ${want} expected, ${got}`);
    truth.n++;
    truth.ms += Number.isFinite(ms) ? Math.round(ms) : 0;
    truth.bytes += Number.isFinite(bytes) ? Math.round(bytes) : 0;
    if (want !== "2xx") truth.bad++;
    const key = truth.byOp.has(op) || truth.byOp.size < 6 ? op : "other";
    const e = truth.byOp.get(key) || { n: 0, classes: {}, codes: {} };
    e.n++;
    e.classes[want] = (e.classes[want] || 0) + 1;
    if (want !== "2xx") {
      const code = kind || String(status);
      const k = code in e.codes || Object.keys(e.codes).length < mod.FAIL_CODES_MAX ? code : "other";
      e.codes[k] = (e.codes[k] || 0) + 1;
    }
    truth.byOp.set(key, e);
  }
  const snap = meter.snapshot();
  w.check(snap.total.n === truth.n && snap.total.ms === truth.ms && snap.total.bytes === truth.bytes && snap.total.bad === truth.bad,
    `CONSERVATION: the totals ${JSON.stringify(snap.total)} differ from what was recorded ${JSON.stringify({ n: truth.n, ms: truth.ms, bytes: truth.bytes, bad: truth.bad })}`);
  let sum = 0;
  for (const [op, e] of Object.entries(snap.ops)) {
    sum += e.n;
    w.check(Object.values(e.classes).reduce((a, b) => a + b, 0) === e.n, `${op}: its classes add up to its calls`);
    w.check(e.buckets.reduce((a, b) => a + b, 0) === e.n, `${op}: its latency buckets add up to its calls`);
    const t = truth.byOp.get(op);
    w.check(t && t.n === e.n && JSON.stringify(Object.entries(e.classes).sort()) === JSON.stringify(Object.entries(t.classes).sort()), `${op}: its calls and classes match what was recorded`);
    w.check(t && JSON.stringify(Object.entries(e.codes).sort()) === JSON.stringify(Object.entries(t.codes).sort()), `${op}: its failures are filed by exact code: ${JSON.stringify(e.codes)} against ${JSON.stringify(t && t.codes)}`);
    w.check(e.first.length === Math.min(3, Object.values(t ? t.codes : {}).reduce((a, b) => a + b, 0)), `${op}: it keeps the first three failures and no more`);
    for (const f of e.first) {
      w.check(Object.keys(f).every((k) => ["code", "ms", "t", "pg", "a"].includes(k)) && (f.t === undefined || ["plain", "dot"].includes(f.t)) && (f.pg === undefined || f.pg >= 0),
        `${op}: a sample keeps only its code, time, shape, page and attempt, never a ticker, a URL or a value it cannot vouch for: ${JSON.stringify(f)}`);
    }
  }
  w.check(sum === truth.n, "the operations add up to the total");
  w.check(Object.keys(snap.ops).length <= 7, "operations past the cap fold into one");
  const s = mod.summarize(snap, { top: 3 });
  w.check(s.n === truth.n && s.bad === truth.bad && s.slowest.length <= 3, "the summary carries the totals and at most the top three");
  const failing = Object.entries(snap.ops).filter(([, e]) => e.n - (e.classes["2xx"] || 0) > 0);
  w.check(Array.isArray(s.fails) && s.fails.length === failing.length, `EVERY OPERATION WITH A FAILED CALL IS NAMED in the summary, not only the slowest: ${s.fails && s.fails.length} of ${failing.length}`);
  for (const [op, e] of failing) {
    const f = (s.fails || []).find((x) => x.op === op);
    w.check(f && f.bad === e.n - (e.classes["2xx"] || 0) && JSON.stringify(f.codes) === JSON.stringify(e.codes), `${op}: the summary carries its failures by code`);
  }
  w.check(JSON.stringify(s.fails).length <= mod.FAILS_BUDGET_BYTES, `the failure record fits its ${mod.FAILS_BUDGET_BYTES} bytes (${JSON.stringify(s.fails).length})`);
  const wide = { total: { n: 0, ms: 0, bytes: 0, bad: 0 }, ops: {} };
  for (let i = 0; i < 40; i++) {
    const codes = Object.fromEntries(Array.from({ length: 8 }, (_, j) => [String(400 + j), 1 + j]));
    const first = Array.from({ length: 3 }, (_, j) => ({ code: String(400 + j), ms: 30000, t: "plain", pg: 500, a: j }));
    wide.ops["op" + String(i).padStart(2, "0")] = { n: 50, ms: 1, maxMs: 1, bytes: 0, classes: { "2xx": 14 - (i % 7), "4xx": 36 + (i % 7) }, codes, first, buckets: [1] };
  }
  const big = mod.summarize(wide);
  w.check(JSON.stringify(big.fails).length <= mod.FAILS_BUDGET_BYTES && big.fails.length >= 1 && big.fails.length + (big.failsOmitted || 0) === 40,
    `forty failing operations are cut to the budget and the cut is counted (${big.fails.length} kept, ${big.failsOmitted} omitted, ${JSON.stringify(big.fails).length} bytes)`);
  w.check(big.fails.every((f, i, l) => i === 0 || l[i - 1].bad >= f.bad), "the worst failing operations are the ones kept");
  const cost = (x) => x.avgMs * x.n;
  w.check(s.slowest.every((x, i, l) => i === 0 || cost(l[i - 1]) >= cost(x) - l[i - 1].n), "the slowest are ordered by the time they cost");
  for (const e of Object.values(snap.ops)) {
    const p50 = mod.quantileMs(e.buckets, 0.5), p95 = mod.quantileMs(e.buckets, 0.95);
    w.check(p50 === null || p95 === null || p50 <= p95, "the median is never above the 95th percentile");
  }
  const delta = mod.wireDelta({ n: 2, ms: 100, bytes: 10, bad: 1 }, { n: 5, ms: 450, bytes: 30, bad: 1 });
  w.check(JSON.stringify(delta) === JSON.stringify({ n: 3, ms: 350, bytes: 20, bad: 0 }), "a delta is after minus before");
  return { violations: w.violations, checks: w.checks, events: w.events };
}

export function stagesScenario(seed, mod) {
  const w = world(seed, "stages");
  const totals = { n: 0, ms: 0, bytes: 0, bad: 0 };
  const fails = {};
  let clock = 0;
  const runner = mod.createStageRunner({ clock: () => clock, wire: () => ({ ...totals }), fails: () => ({ ...fails }) });
  const order = ["session", "universe", "enrich", "score", "boards"];
  const truth = new Map();
  for (const id of order) {
    runner.step(id);
    const n = w.chance(0.4) ? 0 : 1 + w.int(30);
    const d = { n, ms: n ? w.int(60000) : 0, bytes: n ? w.int(5e6) : 0, bad: n ? w.int(n + 1) : 0, lines: {} };
    for (let i = 0; i < d.bad; i++) {
      const line = w.pick(["multi-leg 422", "multi-leg 500", "nope timeout", "option-contracts 503"]);
      d.lines[line] = (d.lines[line] || 0) + 1;
      fails[line] = (fails[line] || 0) + 1;
    }
    totals.n += d.n; totals.ms += d.ms; totals.bytes += d.bytes; totals.bad += d.bad;
    clock += 1000;
    truth.set(id, d);
    w.log(`stage ${id}: ${d.n} call(s)`);
  }
  runner.finish();
  const by = new Map(runner.records().map((r) => [r.id, r]));
  for (const id of order) {
    const r = by.get(id);
    const d = truth.get(id);
    if (d.n === 0) w.check(!("wire" in r), `${id}: a stage with no call carries no wire field`);
    else w.check(r.wire && r.wire.ms === d.ms && r.wire.kb === Math.round(d.bytes / 1024) && r.wire.bad === d.bad, `${id}: wire ${JSON.stringify(r.wire)} differs from ${JSON.stringify(d)}`);
    if (d.n && d.bad) {
      const want = Object.entries(d.lines).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([line, k]) => `${line}: ${k}`).join(", ");
      w.check(r.wire && r.wire.fail === want, `${id}: a stage with failed calls names each operation and code it lost (${JSON.stringify(r.wire && r.wire.fail)} against ${JSON.stringify(want)})`);
    } else if (d.n) {
      w.check(r.wire && !("fail" in r.wire), `${id}: a clean stage carries no failure line`);
    }
  }
  const skipped = runner.records().filter((r) => r.status === "skipped");
  w.check(skipped.every((r) => !("wire" in r)), "a stage that never ran has no wire field");
  w.check(runner.records().filter((r) => "wire" in r).reduce((a, r) => a + r.wire.ms, 0) === totals.ms, "CONSERVATION: the stages' wire time adds up to the run's");
  return { violations: w.violations, checks: w.checks, events: w.events };
}
