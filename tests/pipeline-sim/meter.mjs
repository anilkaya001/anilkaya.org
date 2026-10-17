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

  const meter = mod.createCallMeter({ maxOps: 6 });
  const truth = { n: 0, ms: 0, bytes: 0, bad: 0, byOp: new Map() };
  const records = 40 + w.int(60);
  for (let i = 0; i < records; i++) {
    const op = w.pick(OPS).id;
    const [status, cls] = w.pick(CLASS_TABLE);
    const kind = w.chance(0.1) ? w.pick(["timeout", "network"]) : undefined;
    const ms = w.chance(0.05) ? Number.NaN : w.int(40000);
    const bytes = w.chance(0.3) ? Number.NaN : w.int(5e5);
    const got = meter.record({ op, ms, bytes, status: kind ? 0 : status, kind });
    const want = kind || cls;
    w.check(got === want, `record answers the class it filed: ${want} expected, ${got}`);
    truth.n++;
    truth.ms += Number.isFinite(ms) ? Math.round(ms) : 0;
    truth.bytes += Number.isFinite(bytes) ? Math.round(bytes) : 0;
    if (want !== "2xx") truth.bad++;
    const key = truth.byOp.has(op) || truth.byOp.size < 6 ? op : "other";
    const e = truth.byOp.get(key) || { n: 0, classes: {} };
    e.n++;
    e.classes[want] = (e.classes[want] || 0) + 1;
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
  }
  w.check(sum === truth.n, "the operations add up to the total");
  w.check(Object.keys(snap.ops).length <= 7, "operations past the cap fold into one");
  const s = mod.summarize(snap, { top: 3 });
  w.check(s.n === truth.n && s.bad === truth.bad && s.slowest.length <= 3, "the summary carries the totals and at most the top three");
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
  let clock = 0;
  const runner = mod.createStageRunner({ clock: () => clock, wire: () => ({ ...totals }) });
  const order = ["session", "universe", "enrich", "score", "boards"];
  const truth = new Map();
  for (const id of order) {
    runner.step(id);
    const n = w.chance(0.4) ? 0 : 1 + w.int(30);
    const d = { n, ms: n ? w.int(60000) : 0, bytes: n ? w.int(5e6) : 0, bad: n ? w.int(n + 1) : 0 };
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
  }
  const skipped = runner.records().filter((r) => r.status === "skipped");
  w.check(skipped.every((r) => !("wire" in r)), "a stage that never ran has no wire field");
  w.check(runner.records().filter((r) => "wire" in r).reduce((a, r) => a + r.wire.ms, 0) === totals.ms, "CONSERVATION: the stages' wire time adds up to the run's");
  return { violations: w.violations, checks: w.checks, events: w.events };
}
