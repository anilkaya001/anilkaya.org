import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const ROOT = new URL("../", import.meta.url).pathname;
const SKIP = /(^|\/)(node_modules|\.git|tests|docs)(\/|$)|\.bundle\.js$/;

function walk(dir, out) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir ? dir + "/" + name : name;
    if (SKIP.test(rel)) continue;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(js|mjs)$/.test(name)) out[rel] = readFileSync(join(ROOT, rel), "utf8");
  }
  return out;
}

const FAMILIES = [
  { name: "Abramowitz and Stegun 26.2.17 normal CDF", re: /0\.2316419|0\.319381530|1\.781477937|1\.821255978|1\.330274429/, allowed: [] },
  { name: "Abramowitz and Stegun 7.1.26 erf", re: /0\.3275911|0\.254829592|1\.061405429|1\.453152027|1\.421413741/, allowed: [] },
  { name: "Acklam inverse normal", re: /3\.969683028665376e\+?01|39\.69683028665376/, allowed: ["shared/flows-quant-bs.js"] },
  { name: "Cody erfc rational", re: /3\.1611237438705656|0\.18577770618460315|1\.85777706184603153e-1/, allowed: ["shared/flows-quant-bs.js"] },
];

export function findDuplicates(files) {
  const out = [];
  for (const f of FAMILIES) {
    const where = Object.keys(files).filter((p) => f.re.test(files[p])).sort();
    const stray = where.filter((p) => !f.allowed.includes(p));
    if (stray.length) out.push(`${f.name}: ${stray.join(", ")}`);
  }
  const pdf = Object.keys(files).filter((p) => /0\.3989422804014327/.test(files[p])).sort();
  const known = ["shared/flows-quant-bs.js", "shared/flows-quant-dealer.js"];
  const stray = pdf.filter((p) => !known.includes(p));
  if (stray.length) out.push(`a standard normal density constant outside the two audited kernels: ${stray.join(", ")}`);
  return out;
}

const files = {};
for (const dir of ["shared", "assets/js", "scripts", "server"]) walk(dir, files);
files["worker.js"] = readFileSync(join(ROOT, "worker.js"), "utf8");
ok(Object.keys(files).length > 150, `the scan reads ${Object.keys(files).length} source files`);
eq(findDuplicates(files), [], "no second normal CDF, erf or inverse normal exists in the tree: the Abramowitz and Stegun constants are in no file, and the Acklam and Cody tables are in flows-quant-bs.js alone");
ok(/3\.1611237438705656/.test(files["shared/flows-quant-bs.js"]) && /3\.969683028665376e\+?01|39\.69683028665376/.test(files["shared/flows-quant-bs.js"]), "and the scan can see the Cody and Acklam tables where they live");

const PLANTED = [
  ["an A&S 26.2.17 normal CDF", "const b1 = 0.319381530, p = 0.2316419;"],
  ["an A&S 7.1.26 erf", "const a1 = 0.254829592, p = 0.3275911;"],
  ["a second Acklam table", "const a = [-3.969683028665376e+01, 2.209460984245205e+02];"],
  ["a second Acklam table in decimal form", "const A = [-39.69683028665376, 220.9460984245205];"],
  ["a second Cody erf table", "const A = [3.1611237438705656, 113.86415415105016];"],
];
for (const [what, text] of PLANTED) {
  ok(findDuplicates({ ...files, "shared/planted.js": text }).length > 0, `planted wrong build must fail: ${what}`);
}
ok(findDuplicates({ ...files, "shared/planted.js": "const k = 0.3989422804014327;" }).length > 0, "planted wrong build must fail: a third copy of the normal density constant");

console.log(`✓ math-duplicates: ${checks} assertions - one normal CDF, one inverse normal and no Abramowitz and Stegun constants in the tree (the second Acklam table that flows-features.js carried now calls flows-quant-bs.js), and ${PLANTED.length + 1} planted copies that each fail`);
