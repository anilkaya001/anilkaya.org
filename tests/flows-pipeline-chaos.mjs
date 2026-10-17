import assert from "node:assert/strict";
import { boot, freshVendor, simEnv } from "./pipeline-sim/index.mjs";
import { clientScenario } from "./pipeline-sim/client.mjs";
import { cardScenario } from "./pipeline-sim/cards.mjs";
import { storeScenario } from "./pipeline-sim/store.mjs";
import { contractsScenario } from "./pipeline-sim/contracts.mjs";
import { meterScenario, stagesScenario } from "./pipeline-sim/meter.mjs";

simEnv();
const time = boot();

const DEEP = process.env.FLOWS_TRUTH_DEEP === "1";
const SEEDS = Number(process.env.FLOWS_CHAOS_SEEDS) || (DEEP ? 20000 : 300);
const ROOT = new URL("../", import.meta.url);
const load = (p) => import(new URL(p, ROOT).href);

const rank = await load("scripts/flows-nightly/rank.mjs");
const stages = await load("scripts/flows-nightly/stages.mjs");
const card = await load("shared/flows-card.js");
const coverage = await load("shared/flows-coverage.js");
const contracts = await load("shared/flows-contracts.js");
const products = await load("shared/flows-products.js");
const meter = await load("shared/flows-call-meter.js");

const FAMILIES = [
  ["client", async (seed) => clientScenario(seed, await freshVendor(), { time })],
  ["cards", (seed) => cardScenario(seed, { time, rank, card, coverage })],
  ["cards-plan", (seed) => cardScenario(seed, { card, coverage, reads: "plan" })],
  ["store", (seed) => storeScenario(seed, coverage)],
  ["contracts", (seed) => contractsScenario(seed, contracts, { card, products })],
  ["meter", (seed) => meterScenario(seed, meter)],
  ["stages", (seed) => stagesScenario(seed, stages)],
];

const failures = [];
const tally = new Map(FAMILIES.map(([name]) => [name, { seeds: 0, checks: 0, events: 0, bad: 0 }]));
const started = process.hrtime.bigint();
for (let seed = 0; seed < SEEDS; seed++) {
  for (const [name, run] of FAMILIES) {
    const result = await run(seed);
    const t = tally.get(name);
    t.seeds++;
    t.checks += result.checks;
    t.events += result.events;
    if (result.violations.length) {
      t.bad++;
      failures.push({ family: name, seed, violation: result.violations[0], count: result.violations.length });
    }
  }
}
const wallMs = Number(process.hrtime.bigint() - started) / 1e6;

const again = await storeScenario(7, coverage);
const twice = await storeScenario(7, coverage);
assert.deepEqual([again.checks, again.events, again.violations.length], [twice.checks, twice.events, twice.violations.length], "a seed replays to the same world");
const c1 = await contractsScenario(11, contracts, { card, products });
const c2 = await contractsScenario(11, contracts, { card, products });
assert.deepEqual([c1.checks, c1.events], [c2.checks, c2.events], "and so does a seed of the contract world");

time.uninstall();

let checks = 0;
console.log(`pipeline chaos: ${SEEDS} seeds${DEEP ? " (deep)" : ""} of ${FAMILIES.length} worlds, ${(wallMs / 1000).toFixed(1)} s`);
for (const [name, t] of tally) {
  checks += t.checks;
  console.log(`  ${name.padEnd(11)} ${String(t.seeds).padStart(6)} seeds ${String(t.checks).padStart(9)} checks ${String(t.events).padStart(8)} events ${t.bad ? t.bad + " FAILED" : "clean"}`);
}
if (failures.length) {
  for (const f of failures.slice(0, 5)) {
    console.error(`\nVIOLATION in ${f.family}, seed ${f.seed} (${f.count} in all): ${f.violation.message}`);
    console.error(f.violation.trace.map((l) => "    " + l).join("\n"));
  }
  console.error(`\nreplay one with: FLOWS_CHAOS_SEEDS=${failures[0].seed + 1} node tests/flows-pipeline-chaos.mjs`);
  assert.fail(`${failures.length} of ${SEEDS * FAMILIES.length} runs broke an invariant`);
}
assert.ok(checks > 1000, "the harness checked something: " + checks);
console.log(`flows-pipeline-chaos: ${checks} checks passed`);
