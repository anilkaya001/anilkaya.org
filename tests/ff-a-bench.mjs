import { compare, checkBudget, measure, referenceKernel, cpuNow } from "./lib/cpu-budget.mjs";
import { holdsAndPlants } from "./lib/ff-a-kit.mjs";
import { snapshotOf, SECTORS, Store } from "./lib/ff-a-world.mjs";
import { NAMES, worldOf, wiresOf, liveWires, liveWorld, oracleHits } from "./lib/ff-a-bench-world.mjs";
import { benchPlants } from "./lib/ff-a-bench-plants.mjs";

const CEILING = Object.freeze({
  cold: Object.freeze({ median: 120, worst: 170 }),
  warm: Object.freeze({ median: 60, worst: 90 }),
  live: Object.freeze({ median: 55, worst: 80 }),
});

function against(M, R, W, wires, snap, first, second) {
  const sample = [];
  const stride = R.heavy ? 25 : 60;
  for (let i = 0; i < wires.length; i += stride) sample.push(wires[i]);
  sample.push(...wires.filter((w) => w.scope.kind === "universe" && w.persist === 1 && w.anomaly.length && !w.facts.length && !sample.includes(w)).slice(0, 12));
  let checked = 0;
  let fired = 0;
  let ranks = 0;
  for (const w of sample) {
    const spec = { scope: w.scope, all: w.stored.all };
    const { hits: ranked, unknown } = oracleHits(W, spec);
    const want = ranked.map((h) => h.symbol).sort();
    const event = w.edge === "event";
    const scopeSize = w.scope.kind === "universe" ? NAMES : w.scope.kind === "names" ? 25 : W.symbols.filter((_, i) => SECTORS[i % SECTORS.length] === w.scope.sector).length;
    const label = `wire ${w.id.slice(-3)} ${JSON.stringify(spec.all.map((c) => c.m))} persist ${w.persist}`;
    for (const [night, run, due] of [["first", first, event && w.persist === 1], ["second", second, event && w.persist === 2]]) {
      const got = run.hits.filter((h) => h.wire_id === w.id).map((h) => h.symbol).sort();
      const rcpt = run.receipts.find((r) => r.wire_id === w.id);
      R.eq(got.length + rcpt.hits_capped, due ? want.length : 0, `${label}: ${night} night, the hits and the capped are the oracle's ${due ? want.length : 0}`);
      R.ok(got.every((s) => want.includes(s)), `${label}: ${night} night, every hit is one the oracle holds`);
      R.eq(rcpt.names_evaluated + rcpt.names_absent, scopeSize, `${label}: ${night} night, every name is evaluated or absent`);
      R.eq(rcpt.names_absent, unknown, `${label}: ${night} night, the absent names are the oracle's ${unknown}`);
      if (due && want.length) fired++;
      if (night === "first" && due && w.anomaly.length && want.length > 10) {
        const alone = M.engine.evaluate(snap, [w], {});
        R.eq(alone.hits.map((h) => h.symbol).sort(), ranked.slice(0, 10).map((h) => h.symbol).sort(), `${label}: alone, the ten kept are the ten strongest of ${want.length}`);
        R.eq(alone.receipts[0].hits_capped, want.length - 10, `${label}: and the rest are counted`);
        ranks++;
      }
    }
    checked++;
  }
  R.ok(checked >= (R.heavy ? 120 : 50), "oracle sample size " + checked);
  R.ok(fired >= 15, "the sample fires: " + fired);
  R.ok(ranks >= 5, "and some wires have more than ten to choose from: " + ranks);
  R.ok(second.hits.length > 0, "persistence two fires on the second night: " + second.hits.length);
}

function tables(R, snap, first, second) {
  Store.mirror = R.heavy === true;
  const ledger = new Store();
  ledger.apply(first, snap);
  ledger.apply(second, snap);
  Store.mirror = false;
  if (!ledger.db) return;
  const count = (table) => ledger.db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  R.eq([count("ff_hit"), count("ff_state"), count("ff_receipt")], [first.hits.length + second.hits.length, ledger.rows.size, 6000], "the real tables took every row the two nights wrote, constraints and triggers included");
}

function budgets(M, R, W, wires, snap, state, keys, refMs) {
  const lw = liveWires(M, W.rng, W.symbols);
  const ls = liveWorld(M, W);
  const warm = { state, existingKeys: keys };
  const runs = [
    ["cold", `first night, ${wires.length} wires over ${NAMES} names`, () => M.engine.evaluate(snap, wires, {}), { windows: 6, perWindow: 2, warmup: 2 }],
    ["warm", `second night with ${state.length} state rows`, () => M.engine.evaluate(snap, wires, warm), { windows: 6, perWindow: 2, warmup: 2 }],
    ["live", `live tick, ${lw.length} wires over ${NAMES} names and ${W.windows.length} windows`, () => M.engine.evaluate(ls, lw, {}), { windows: 6, perWindow: 4, warmup: 3 }],
  ];
  for (const [kind, label, fn, opts] of runs) {
    fn();
    const t0 = cpuNow();
    fn();
    const one = (cpuNow() - t0) / refMs;
    if (one > 1.2 * CEILING[kind].worst) {
      R.ok(false, `${label}: one run took ${one.toFixed(0)}x the reference, over 1.2 times its ${CEILING[kind].worst}x ceiling, so it is not measured again`);
      continue;
    }
    const r = compare(fn, opts);
    console.log(`  ${label}: ${r.subject.median.toFixed(1)} ms median, ${r.ratio.median.toFixed(1)}x the reference (${r.reference.median.toFixed(1)} ms), costliest window ${r.ratio.worst.toFixed(1)}x`);
    const c = checkBudget(r, CEILING[kind]);
    R.ok(c.ok, `${label}: ${c.failures.join("; ")}`);
  }
}

async function battery(M, R) {
  const W = worldOf(11);
  const wires = wiresOf(M, W.rng, W.symbols);
  const snap = snapshotOf({ kind: "nightly", session: "2026-03-09", symbols: W.symbols, cols: W.cols, n: W.n }, M);
  const refMs = R.heavy ? measure(referenceKernel, { windows: 4, perWindow: 3, warmup: 5 }).median : 0;
  const t0 = cpuNow();
  const first = M.engine.evaluate(snap, wires, {});
  const firstMs = cpuNow() - t0;
  if (R.heavy && firstMs > 6 * CEILING.cold.worst * refMs) {
    R.ok(false, `the first night took ${firstMs.toFixed(0)} ms, ${(firstMs / refMs).toFixed(0)}x the reference: far over its budget, so nothing else is measured`);
    return;
  }
  const state = first.state.upserts.slice();
  const keys = new Set(first.hits.map((h) => h.wire_id + "|" + h.dedupe_key));
  if (R.only !== "timing") {
    R.eq(first.errors, [], "no wire raised an error");
    R.eq(first.receipts.length, 3000, "every wire has a receipt");
    R.ok(first.receipts.every((r) => r.status === "evaluated"), "all are evaluated");
    R.ok(first.hits.length > 150, "the bench world is not empty: " + first.hits.length + " hits");
    const again = M.engine.evaluate(snap, wires.slice().reverse(), {});
    R.eq(JSON.stringify(again), JSON.stringify(first), "the same run in another order is the same run");
    const second = M.engine.evaluate(snapshotOf({ kind: "nightly", session: "2026-03-10", symbols: W.symbols, cols: W.cols, n: W.n }, M), wires, { state, existingKeys: keys });
    against(M, R, W, wires, snap, first, second);
    tables(R, snap, first, second);
    const live = M.engine.evaluate(liveWorld(M, W), liveWires(M, W.rng, W.symbols), {});
    R.eq(live.errors, [], "no live wire raised an error");
    R.ok(live.hits.length > 30, "the live bench fires: " + live.hits.length);
  }
  if (R.heavy) budgets(M, R, W, wires, snap, state, keys, refMs);
}

const only = process.argv.find((a) => a.startsWith("--only="));
const chosen = process.argv.includes("--real-only") ? [] : only ? benchPlants.filter((p) => p.name.includes(only.slice(7))) : benchPlants;
const out = await holdsAndPlants("ff-a-bench", battery, chosen);
console.log(`ff-a-bench: ${out.checks} checks passed`);
