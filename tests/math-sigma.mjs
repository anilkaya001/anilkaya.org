import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as TG from "../shared/flows-targets.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-sigma.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-sigma-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

function cases(M) {
  const bad = [];
  const say = (m) => { if (bad.length < 8) bad.push(m); };
  for (const sc of FX.scenarios) {
    const bars = sc.days.map((d, i) => ({ d, c: sc.closes[i] }));
    for (const order of ["as given", "reversed"]) {
      const input = order === "as given" ? bars : bars.slice().reverse();
      const got = M.sigmaProfile(input);
      const e = sc.expect;
      if (got.ok !== e.ok) { say(`${sc.name} (${order}): ok ${got.ok} where ${e.ok} is right`); continue; }
      if (!e.ok) {
        if (got.reason !== e.reason) say(`${sc.name} (${order}): reason ${got.reason} where ${e.reason} is right`);
        continue;
      }
      if (got.n !== e.n) say(`${sc.name} (${order}): ${got.n} returns where ${e.n} are right`);
      if (!(Math.abs(got.s - e.s) <= 1e-12 * e.s)) say(`${sc.name} (${order}): typical day ${got.s} against ${e.s}`);
      if (got.f2 !== e.f2 || got.f3 !== e.f3) say(`${sc.name} (${order}): ${got.f2} / ${got.f3} sessions beyond 2 and 3 typical days where ${e.f2} / ${e.f3} are right`);
    }
  }
  return bad;
}

eq(cases(TG).join("; "), "", `${FX.scenarios.length} price histories give the typical day as 1.4826 times the median absolute deviation (scipy), the counts beyond two and three typical days over a 252-session year, the silence for a flat or a short history, and the same answer for bars in any order`);
ok(FX.scenarios.some((s) => s.expect.reason === "degenerate") && FX.scenarios.some((s) => s.expect.reason === "history") && FX.scenarios.some((s) => s.expect.ok && s.expect.n === 252) && FX.scenarios.some((s) => s.expect.ok && s.expect.n < 252), "the fixture holds a flat history, a short one, a full window and a part window");

const MUTANTS = [
  ["the scale is the mean absolute deviation", [["SIGMA_REF_SCALE * median(dev.sort())", "SIGMA_REF_SCALE * (dev.reduce((a, b) => a + b, 0) / dev.length)"]]],
  ["the deviations are taken from the mean", [["const m = median(sorted);\n  const dev", "const m = sorted.reduce((a, b) => a + b, 0) / sorted.length;\n  const dev"]]],
  ["the consistency constant is one", [["export const SIGMA_REF_SCALE = 1.4826;", "export const SIGMA_REF_SCALE = 1;"]]],
  ["a zero deviation is a scale", [["if (!(s > 0)) return { ...common, ok: false, sigmaRef: null, reason: \"degenerate\" };", ""]]],
  ["the window is one return too long", [["const first = Math.max(1, list.length - window);", "const first = Math.max(1, list.length - window - 1);"]]],
  ["two typical days are counted as three", [["f2: per(2), f3: per(3)", "f2: per(3), f3: per(3)"]]],
  ["the count is not scaled to a year", [["* EMPIRICAL_SESSIONS) / n)", "* n) / n)"]]],
  ["a short history is accepted", [["export const SIGMA_REF_MIN = 200;", "export const SIGMA_REF_MIN = 100;"]]],
  ["bars out of order are not sorted", [["if (!ordered) {", "if (false) {"]]],
];
for (const [name, transforms] of MUTANTS) {
  let mod;
  try { mod = await loadMutated("shared/flows-targets.js", transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(cases(mod).length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-sigma: ${checks} assertions - the typical day (1.4826 x the median absolute deviation of the last 252 log returns) and the counts of sessions beyond two and three typical days held to scipy over ${FX.scenarios.length} histories, in either bar order, and ${MUTANTS.length} planted wrong builds that each fail`);
