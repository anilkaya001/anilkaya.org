import { pathFor } from "../../shared/flows-vendor-ops.js";
import { fault, createVendor, ORIGIN, truthOp } from "./vendor.mjs";
import { tickers, world } from "./world.mjs";

export const CALLS = Object.freeze([
  ["max-pain", {}], ["darkpool", { limit: 500 }], ["oi-change", { limit: 30 }], ["term-structure", {}], ["iv-rank", { timespan: "1y" }],
  ["earnings", {}], ["option-contracts", { limit: 500 }], ["spot-exposures-expiry-strike", { limit: 500 }], ["ohlc-1d", { timeframe: "2Y" }],
  ["ohlc-1d", { timeframe: "1M" }], ["net-prem-ticks", {}], ["greek-flow", {}],
]);

export const SPEC = Object.freeze({ attempts: 5, deadline: 30000, longDeadline: 45000, floorMin: 60, floorCeiling: 400 });

const SCRIPTS = [
  [4, (w) => [fault.ok(1 + w.int(5))]],
  [3, () => [fault.empty()]],
  [1, () => [fault.http(404)]],
  [1, () => [fault.http(422)]],
  [2, (w) => [fault.http(w.pick([500, 502, 503]))]],
  [1, () => [fault.rate(1)]],
  [1, () => [fault.stall()]],
  [1, () => [fault.malformed()]],
  [1, () => [fault.slow(2000)]],
  [1, () => [fault.slow(40000)]],
  [2, (w) => [fault.http(w.pick([500, 503])), fault.ok(2)]],
  [1, () => [fault.rate(2), fault.ok(2)]],
  [1, () => [fault.stall(), fault.ok(2)]],
  [1, () => [fault.http(500), fault.http(503), fault.ok(1)]],
  [1, () => [fault.empty()]],
];

export function expectation(script, long) {
  const deadline = long ? SPEC.longDeadline : SPEC.deadline;
  let timeouts = 0;
  for (let attempt = 0; attempt < SPEC.attempts; attempt++) {
    const f = script[Math.min(attempt, script.length - 1)];
    const done = (extra) => ({ attempts: attempt + 1, ...extra });
    switch (f.kind) {
      case "ok": return done({ result: "rows", rows: f.rows });
      case "empty": return done({ result: "rows", rows: 0 });
      case "slow":
        if (f.ms < deadline) return done({ result: "rows", rows: 1 });
        if (++timeouts > 1) return done({ result: "fail", kind: "timeout", status: null });
        break;
      case "stall":
        if (++timeouts > 1) return done({ result: "fail", kind: "timeout", status: null });
        break;
      case "http":
        if (f.status >= 500) { if (attempt === SPEC.attempts - 1) return done({ result: "fail", kind: "http", status: f.status }); break; }
        return done({ result: "fail", kind: "http", status: f.status });
      case "rate":
        break;
      case "malformed": return done({ result: "fail", kind: "parse", status: null });
      default: throw new Error("no expectation for " + f.kind);
    }
  }
  return { attempts: SPEC.attempts, result: "fail", kind: "http", status: 429 };
}

const diffOps = (before, after) => {
  const out = {};
  for (const [op, e] of Object.entries(after.ops)) {
    const was = before.ops[op] ? before.ops[op].classes : {};
    for (const [cls, n] of Object.entries(e.classes)) {
      const d = n - (was[cls] || 0);
      if (d) { out[op] = out[op] || {}; out[op][cls] = d; }
    }
  }
  return out;
};

export async function clientScenario(seed, mod, { time, calls = 24, width = 3 } = {}) {
  const w = world(seed, "client");
  const names = tickers(w, 8);
  const scripts = new Map();
  const plan = [];
  const batches = [];
  for (let i = 0; i < calls; i++) {
    const [op, params] = w.pick(CALLS);
    const ticker = w.pick(names) + String(i);
    const path = pathFor(op, { ticker });
    const script = w.weighted(SCRIPTS)(w);
    scripts.set(path, script);
    const long = op === "option-contracts" || (op === "ohlc-1d" && params.timeframe === "2Y");
    plan.push({ i, op, ticker, path, params, script, long, expected: expectation(script, long) });
  }
  for (let i = 0; i < plan.length; i += width) batches.push(plan.slice(i, i + width));

  const vendor = createVendor({ time, scripts });
  const realFetch = globalThis.fetch;
  globalThis.fetch = vendor.fetch;
  const before = mod.wire.snapshot();
  const results = new Map();
  const started = time.now();
  let hung = false;
  try {
    for (const batch of batches) {
      const run = Promise.all(batch.map(async (c) => {
        const at = time.now();
        w.log(`call ${c.i} ${c.op} ${c.ticker} ${c.script.map((f) => f.kind + (f.status ? f.status : "")).join(">")}`);
        try {
          const rows = await mod.uw(c.path, c.params);
          results.set(c.i, { ok: true, rows: Array.isArray(rows) ? rows : null, took: time.now() - at });
        } catch (error) {
          results.set(c.i, { ok: false, error, took: time.now() - at });
        }
      }));
      const out = await time.drive(run);
      if (out.hung) { hung = true; w.log("the batch never settled"); break; }
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  w.check(!hung, "LIVENESS: a call to a vendor that stalls must settle (the run hung after " + results.size + " of " + plan.length + " calls)");
  for (const c of plan) {
    const got = results.get(c.i);
    if (!got) continue;
    const want = c.expected;
    const label = `${c.op} ${c.ticker} script ${c.script.map((f) => f.kind).join(">")}`;
    const attempts = vendor.attemptsOn(c.path);
    w.check(attempts === want.attempts, `${label}: ${want.attempts} attempt(s) expected, the client made ${attempts}`);
    if (want.result === "rows") {
      w.check(got.ok && Array.isArray(got.rows) && got.rows.length === want.rows, `${label}: ${want.rows} row(s) expected, got ${got.ok ? JSON.stringify(got.rows).slice(0, 60) : "an error " + String(got.error && got.error.message)}`);
      if (want.rows === 0) w.check(got.ok, `${label}: A CLEAN EMPTY ANSWER IS NOT A FAILURE`);
    } else {
      w.check(!got.ok, `${label}: a failure expected, the call answered`);
      if (!got.ok) {
        const seen = mod.readFailure(c.op, got.error);
        w.check(seen.kind === want.kind && seen.status === want.status, `${label}: failure ${want.kind} ${want.status} expected, read as ${seen.kind} ${seen.status}`);
      }
    }
    const bound = SPEC.attempts * ((c.long ? SPEC.longDeadline : SPEC.deadline) + 5000 + 30000);
    w.check(got.took <= bound, `${label}: took ${got.took} ms of virtual time, past the ${bound} ms a call may take`);
    if (c.script[0].kind === "stall") w.check(got.took >= (c.long ? SPEC.longDeadline : SPEC.deadline), `${label}: a stalled call returned after ${got.took} ms, before its deadline`);
  }

  const after = mod.wire.snapshot();
  const delta = after.total.n - before.total.n;
  w.check(delta === vendor.requests.length, `CONSERVATION: the vendor saw ${vendor.requests.length} attempts and the meter counted ${delta}`);
  const seen = diffOps(before, after);
  const truth = vendor.classes();
  w.check(JSON.stringify(sortKeys(seen)) === JSON.stringify(sortKeys(truth)), `the meter's classes by operation differ from what the vendor answered: meter ${JSON.stringify(sortKeys(seen))} vendor ${JSON.stringify(sortKeys(truth))}`);
  for (const [op] of Object.entries(seen)) w.check(truth[op] !== undefined, `the meter names an operation the vendor never served: ${op}`);
  const codes = {};
  for (const [op, e] of Object.entries(after.ops)) {
    const was = before.ops[op] ? before.ops[op].codes || {} : {};
    for (const [code, n] of Object.entries(e.codes || {})) {
      const d = n - (was[code] || 0);
      if (d) { codes[op] = codes[op] || {}; codes[op][code] = d; }
    }
  }
  w.check(JSON.stringify(sortKeys(codes)) === JSON.stringify(sortKeys(vendor.codes())), `the meter's exact failure codes by operation differ from what the vendor answered: meter ${JSON.stringify(sortKeys(codes))} vendor ${JSON.stringify(sortKeys(vendor.codes()))}`);
  for (const e of Object.values(after.ops)) {
    for (const f of e.first || []) {
      w.check(typeof f.code === "string" && Number.isInteger(f.ms) && Number.isInteger(f.pg) && Number.isInteger(f.a) && f.a < SPEC.attempts && Object.keys(f).every((k) => ["code", "ms", "t", "pg", "a"].includes(k)),
        `a failure sample carries its code, time, page and attempt and nothing else: ${JSON.stringify(f)}`);
    }
  }
  w.check(mod.delayFloorMs >= SPEC.floorMin && mod.delayFloorMs <= SPEC.floorCeiling, `the rate floor ${mod.delayFloorMs} ms left [${SPEC.floorMin}, ${SPEC.floorCeiling}]`);
  w.check(time.now() - started >= 0, "time never runs backwards");
  w.log(`${plan.length} calls, ${vendor.requests.length} attempts, ${time.now() - started} ms of virtual time`);
  return { violations: w.violations, checks: w.checks, events: w.events, requests: vendor.requests.length };
}

function sortKeys(value) {
  if (Array.isArray(value) || value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
}

export { ORIGIN, truthOp };
