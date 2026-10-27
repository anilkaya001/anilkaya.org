import { killMatrix } from "./ff-b-killer.mjs";
import { MUTANTS } from "./ff-b-mutants.mjs";

export async function runMatrix(group, floor) {
  const planted = MUTANTS.filter((mu) => mu.group === group);
  const ids = new Set(planted.map((mu) => mu.id));
  const problems = [];
  if (ids.size !== planted.length) problems.push("planted builds of group " + group + " share an id");
  if (planted.length < floor) problems.push("group " + group + " plants " + planted.length + " wrong builds, at least " + floor + " are held");
  const started = Date.now();
  const { results, baseline } = await killMatrix(group);
  for (const [name, b] of baseline) {
    if (b.checks === 0) problems.push("detector " + name + " ran no check on the correct build");
    if (b.failed.length) problems.push("detector " + name + " fails the correct build: " + b.failed.slice(0, 3).join("; "));
  }
  const survivors = results.filter((r) => !r.killed);
  for (const r of survivors) problems.push("planted build " + r.id + " survived " + r.detect.join(", "));
  const throwOnly = results.filter((r) => r.killed && r.throwOnly).length;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (problems.length) {
    for (const p of problems.slice(0, 40)) console.log("FAIL " + p);
    console.log("ff-b-mutants-" + group + ": " + problems.length + " problems, " + results.length + " planted builds, " + survivors.length + " survivors");
    process.exitCode = 1;
    return;
  }
  console.log("ff-b-mutants-" + group + ": " + results.length + " planted builds, all killed (" + throwOnly + " by a throw), " + baseline.size + " detectors clean on the correct build, " + seconds + " s");
}
