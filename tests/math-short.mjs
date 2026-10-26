import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as OWN from "../shared/flows-ownership.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-short.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-short-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

const SESSION = "2026-10-02";

function cases(M) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  const near = (got, want, what, tol = 1e-12) => {
    if (want === null) { if (got !== null) say(`${what}: ${got} where there is none`); return; }
    const w = Number(want);
    if (got === null || !(Math.abs(got - w) <= tol * Math.max(1, Math.abs(w)))) say(`${what}: ${got} against ${w}`);
  };
  for (const sc of FX.scenarios) {
    const got = M.shortVolumeSummary(sc.rows, { sessionDate: SESSION, window: FX.window, min: FX.min });
    const e = sc.expect;
    near(got.ratio, e.ratio, `${sc.name}: latest ratio`);
    near(got.z, e.z, `${sc.name}: z`, 1e-9);
    near(got.mean60, e.mean60, `${sc.name}: mean of the prior sessions`);
    near(got.sd60, e.sd60, `${sc.name}: sample standard deviation`, 1e-9);
    if (got.n !== e.n) say(`${sc.name}: ${got.n} prior sessions where ${e.n} are right`);
    if ((got.reason || null) !== e.reason) say(`${sc.name}: reason ${got.reason} where ${e.reason} is right`);
    near(got.ratio5, e.ratio5, `${sc.name}: five-session ratio`);
    if (got.ratio5Basis !== e.ratio5Basis) say(`${sc.name}: basis ${got.ratio5Basis} where ${e.ratio5Basis} is right`);
    if (got.ratio5Why !== e.ratio5Why) say(`${sc.name}: ratio5 reason ${got.ratio5Why} where ${e.ratio5Why} is right`);
    if ("avg5" in got) say(`${sc.name}: the mean-of-ratios field is still published`);
    if (Number.isNaN(got.z) || got.z === Infinity || got.z === -Infinity) say(`${sc.name}: z is not finite`);
  }
  return bad;
}

eq(cases(OWN).join("; "), "", `${FX.scenarios.length} short-volume histories give the exact pooled five-session ratio, the sample z against the prior sessions and the right silence`);
ok(FX.scenarios[0].expect.ratio5Basis === "pooled" && Math.abs(Number(FX.scenarios[0].expect.ratio5) - 9400 / 14000) < 1e-15, "the first history has a heavy day among thin ones: pooled 9,400 of 14,000 is 0.6714 where the mean of the five ratios is 0.26");
ok(["pooled", "mean"].every((b) => FX.scenarios.some((s) => s.expect.ratio5Basis === b)) && FX.scenarios.some((s) => s.expect.reason === "degenerate") && FX.scenarios.some((s) => s.expect.reason === "too_few"), "and the fixture holds both bases, a flat history and a thin one");
{
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ market_date: `2026-09-${String(10 + i).padStart(2, "0")}`, short_volume: 100 + i, total_volume: 1000, short_volume_ratio: "0.1" }));
  const four = OWN.shortVolumeSummary(rows(4), { sessionDate: "2026-09-30" });
  eq([four.ratio5, four.ratio5Basis, four.ratio5Why], [null, null, "too_few"], "four sessions are not a five-session ratio and say so, never a figure over three days");
}

const MUTANTS = [
  ["the five-session figure is the mean of daily ratios", [["if (five.every((x) => x.sv !== null && x.tv !== null && x.tv > 0)) {", "if (false) {"]]],
  ["a zero-volume day is pooled", [["x.sv !== null && x.tv !== null && x.tv > 0", "x.sv !== null && x.tv !== null"]]],
  ["fewer than five sessions still give a figure", [["if (five.length < SVR_FIVE) return", "if (five.length < 1) return"]]],
  ["the basis is always named pooled", [['ratio5Basis: "mean"', 'ratio5Basis: "pooled"']]],
  ["the latest day is part of its own comparison window", [["list.slice(0, -1).slice(-window)", "list.slice(-window)"]]],
  ["the minimum history is ignored", [["ownZ(prior, latest.ratio, { min })", "ownZ(prior, latest.ratio, { min: 2 })"]]],
  ["a session with an impossible row is pooled", [["if (five.some((x) => x.invalid)) return noFive(SILENCE.unreadable);", ""]]],
  ["a gap inside the five sessions is pooled across", [["for (let i = 1; i < five.length; i++) if (sessionsBetween(five[i - 1].d, five[i].d) !== 1) return noFive(SILENCE.coverage);", ""]]],
  ["short volume above total volume is believed", [["(svRaw !== null && tvRaw !== null && svRaw > tvRaw)", "false"]]],
  ["a ratio stated in percent is believed", [["(stated < 0 || stated > 1)", "stated < 0"]]],
  ["the old mean-of-ratios field is kept beside the new one", [["...pooledFive(list),", "...pooledFive(list), avg5: mean(list.slice(-5).map((x) => x.ratio)),"]]],
];
for (const [name, transforms] of MUTANTS) {
  let mod;
  try { mod = await loadMutated("shared/flows-ownership.js", transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(cases(mod).length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-short: ${checks} assertions - the five-session short-volume ratio is the pooled sum of short over the sum of total when five sessions carry both counts, the mean of the five stated ratios otherwise with its basis named, and nothing under five sessions; the z is the sample deviation against the sixty sessions before the latest; and ${MUTANTS.length} planted wrong builds that each fail`);
