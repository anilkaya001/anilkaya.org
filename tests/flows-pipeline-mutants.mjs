import assert from "node:assert/strict";
import { PIPELINE_MUTANTS, runPipelineKillMatrix } from "./truth/pipeline-mutants.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

ok(PIPELINE_MUTANTS.length >= 46, "the kill matrix holds " + PIPELINE_MUTANTS.length + " planted wrong builds");
ok(new Set(PIPELINE_MUTANTS.map((m) => m.id)).size === PIPELINE_MUTANTS.length, "each is registered once");
const targets = new Set(PIPELINE_MUTANTS.map((m) => m.target));
ok(targets.size >= 7, "across " + targets.size + " production modules: " + [...targets].join(", "));
const detectors = new Set(PIPELINE_MUTANTS.map((m) => m.detector));
ok(detectors.size === 8, "and every detector has a mutant to prove it: " + [...detectors].join(", "));

const rows = await runPipelineKillMatrix();
const survived = [];
for (const r of rows) {
  ok(r.armed, `${r.id}: its target is in the tree`);
  ok(r.baselineOk, `${r.id}: the detector passes the correct build (${r.baselineNote})`);
  if (!r.killed) survived.push(r);
  else ok(true, `${r.id}: killed (${r.mutatedNote})`);
}
console.log(`  ${rows.filter((r) => r.killed).length} of ${rows.length} planted wrong builds killed`);
for (const r of rows) console.log(`    ${r.killed ? "killed  " : "SURVIVED"} ${r.id}${r.killed ? "" : ": " + r.mutatedNote}`);
assert.deepEqual(survived.map((r) => r.id), [], "EVERY PLANTED WRONG BUILD IS KILLED BY THE DETECTOR THAT IS MEANT TO KILL IT");
checks++;
console.log(`flows-pipeline-mutants: ${checks} checks passed`);
