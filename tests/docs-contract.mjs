import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, trackedFiles } from "./lib/suite-registry.mjs";
import { buildAll, assign, exportsOf, replaceRegions, suiteMatrix, REGIONS, DOMAINS } from "../scripts/gen-docs.mjs";
import { auditText, makeResolver, summarise } from "../scripts/map/audit.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const t0 = process.hrtime.bigint();

const disk = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const tracked = trackedFiles(ROOT);
const manifest = JSON.parse(disk("tests/suites.json"));
const matrix = suiteMatrix(ROOT, manifest, new Set([...tracked, "docs/index.md"]));
const real = buildAll({ root: ROOT, tracked, matrix });

deep(real.problems, [], "docs/modules.json names every tracked file, has no dead row, and AGENTS.md carries every generated region");
eq(disk("AGENTS.md"), real.agents, "AGENTS.md equals what scripts/gen-docs.mjs writes; run node scripts/gen-docs.mjs");
eq(disk("docs/index.md"), real.index, "docs/index.md equals what scripts/gen-docs.mjs writes; run node scripts/gen-docs.mjs");
eq(buildAll({ root: ROOT, tracked, matrix }).index, real.index, "the index is deterministic");

const overlay = (edits, extra = {}) => buildAll({
  root: ROOT,
  tracked: extra.tracked || tracked,
  matrix,
  withIndex: extra.withIndex === true,
  read: (rel) => (Object.hasOwn(edits, rel) ? edits[rel] : disk(rel)),
});

const agentsEdit = (label, edit) => {
  const text = edit(disk("AGENTS.md"));
  ok(text !== disk("AGENTS.md"), `${label}: the edit changed AGENTS.md`);
  const out = overlay({ "AGENTS.md": text });
  ok(out.problems.length > 0 || out.agents !== text, `${label}: a hand edit to a generated region is not left standing`);
};
const inputMoves = (label, file, edit, which = "agents") => {
  const text = edit(disk(file));
  ok(text !== disk(file), `${label}: the edit changed ${file}`);
  const out = overlay({ [file]: text }, { withIndex: which === "index" });
  ok(out.problems.length > 0 || out[which] !== real[which], `${label}: changing ${file} moves the generated ${which}, so a committed copy would be stale`);
};

const agents = disk("AGENTS.md");
for (const name of REGIONS) {
  ok(new RegExp(`<!-- gen:${name} -->[\\s\\S]*<!-- /gen:${name} -->`).test(agents), `AGENTS.md has the ${name} region`);
}

agentsEdit("review count 106 to 96", (t) => t.replace(/review bank holds \d+ items/, "review bank holds 96 items"));
agentsEdit("a course count", (t) => t.replace(/holds \d+ courses/, "holds 7 courses"));
agentsEdit("a global dropped from the allowlist", (t) => t.replace("`Lab`, ", ""));
agentsEdit("a suite name dropped from the list", (t) => t.replace(/^contracts( +)run/m, "run"));
agentsEdit("a file-map row removed", (t) => t.replace(/^\| `index\.html` \|.*\n/m, ""));
agentsEdit("a file-map role reworded", (t) => t.replace("Landing page and particle-field hero.", "The landing page."));
agentsEdit("a suite count", (t) => t.replace(/registers \d+ suites/, "registers 100 suites"));
agentsEdit("a region marker deleted", (t) => t.replace("<!-- gen:courses -->", ""));
agentsEdit("a region duplicated", (t) => t.replace("<!-- /gen:globals -->", "<!-- /gen:globals -->\n<!-- gen:globals --><!-- /gen:globals -->"));

inputMoves("a course renamed", "assets/js/course-catalog.js", (t) => t.replace("id: \"ols\"", "id: \"olsx\""));
inputMoves("a review item dropped", "assets/data/review-bank.json", (t) => { const j = JSON.parse(t); j.items.pop(); return JSON.stringify(j); });
inputMoves("a suite reclassified", "tests/suites.json", (t) => t.replace('"name": "contracts", "class": "N"', '"name": "contracts", "class": "W"'));
inputMoves("a global added", "docs/globals.json", (t) => t.replace('"Lab"', '"Lab","Zed"'));
inputMoves("a role reworded", "docs/modules.json", (t) => t.replace("Landing page and particle-field hero.", "Home page."), "index");
inputMoves("a file moved to another domain", "docs/modules.json", (t) => t.replace('"role":"Landing page and particle-field hero.","domain":"site"', '"role":"Landing page and particle-field hero.","domain":"lab"'), "index");

{
  const stray = overlay({}, { tracked: [...tracked, "shared/flows-stray.js"], withIndex: true });
  ok(stray.problems.some((p) => p.includes("shared/flows-stray.js")), "a tracked file with no row fails and is named");
  eq(stray.index, null, "no index is written while a file is unclassified");
}
{
  const rows = JSON.parse(disk("docs/modules.json"));
  rows.push({ paths: ["shared/flows-ghost.js"], role: "Nothing.", domain: "flows-server" });
  const dead = overlay({ "docs/modules.json": JSON.stringify(rows) });
  ok(dead.problems.some((p) => p.includes("shared/flows-ghost.js")), "a row that matches no file fails and is named");
}
{
  const rows = JSON.parse(disk("docs/modules.json"));
  rows[0].domain = "nowhere";
  const bad = overlay({ "docs/modules.json": JSON.stringify(rows) });
  ok(bad.problems.length > 0, "a row with an unknown domain fails");
}
{
  const rows = JSON.parse(disk("docs/modules.json"));
  const without = rows.filter((r) => !r.paths.includes("shared/flows-rt-hub.js"));
  const out = overlay({ "docs/modules.json": JSON.stringify(without) });
  ok(out.problems.some((p) => p.includes("shared/flows-rt-hub.js")), "removing a module's row fails");
}

{
  const rows = [
    { paths: ["a/*.js"], role: "r", domain: "tests" },
    { paths: ["a/b.js"], role: "r", domain: "tests" },
    { paths: ["a/b*.js"], role: "r", domain: "tests" },
    { paths: ["a/*.js"], role: "r", domain: "tests" },
  ];
  const files = new Set(["a/b.js", "a/bc.js", "a/z.js"]);
  const { best, dead, uncovered } = assign(rows, files);
  eq(best.get("a/b.js").row, 1, "an exact path beats every glob");
  eq(best.get("a/bc.js").row, 2, "the glob with more literal characters wins");
  eq(best.get("a/z.js").row, 0, "equal globs go to the earlier row");
  deep(dead, [], "no row is dead when each matches a file");
  deep(uncovered, [], "every file is covered");
  const part = assign([{ paths: ["a/b.js", "q/*.js"], role: "r", domain: "tests" }], new Set(["a/b.js", "a/c.js"]));
  deep(part.uncovered, ["a/c.js"], "an uncovered file is listed");
  eq(part.dead.length, 1, "a glob that matches nothing is dead");
}

{
  deep(exportsOf("export function a() {}\nexport async function b() {}\nexport const C = 1;\nexport class D {}\nexport { e, f as g };\nexport default x;\nconst h = 1;\n"), ["C", "D", "a", "b", "default", "e", "g"], "every export form is read");
  deep(exportsOf("const a = 1;\nfunction b() {}\n// export function c() {}\n"), [], "an unexported name and an indented mention are not exports");
}

{
  const globalsJson = JSON.parse(disk("docs/globals.json")).production;
  const para = agents.match(/production globals are\s+deliberate:([\s\S]*?)The rail's browser/);
  ok(para, "AGENTS.md states the allowlist where contracts.mjs reads it");
  const listed = [...para[1].matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
  deep(listed, globalsJson, "the allowlist paragraph lists exactly docs/globals.json, in order");
  eq(new Set(globalsJson).size, globalsJson.length, "no global is listed twice");
  const longest = Math.max(...agents.split("\n").slice(agents.split("\n").findIndex((l) => l.includes("<!-- gen:globals -->")), agents.split("\n").findIndex((l) => l.includes("<!-- /gen:globals -->"))).map((l) => l.length));
  ok(longest <= 82, "the generated allowlist is wrapped");
}

{
  const rows = JSON.parse(disk("docs/modules.json"));
  const shown = rows.filter((r) => r.show);
  const table = agents.slice(agents.indexOf("<!-- gen:filemap -->"), agents.indexOf("<!-- /gen:filemap -->")).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Path"));
  eq(table.length, shown.length, "the file map has one line per row that carries a show cell");
  for (const r of rows) ok(!/\|/.test(r.role) && !(r.show && /\|/.test(r.show)), `row ${r.paths[0]} has no pipe in a cell`);
  for (const r of rows) eq(new Set(r.paths).size, r.paths.length, `row ${r.paths[0]} names no path twice`);
  const domains = new Set(DOMAINS.map(([d]) => d));
  for (const r of rows) ok(domains.has(r.domain) && r.role.endsWith("."), `row ${r.paths[0]} has a known domain and a sentence for a role`);
}

{
  const idx = real.index;
  const all = [...new Set([...tracked, "docs/index.md"])];
  for (const f of all) ok(idx.includes(`| \`${f}\` |`), `the index lists ${f}`);
  const rows = idx.split("\n").filter((l) => l.startsWith("| `"));
  eq(rows.length, all.length, "the index lists every file once");
  ok(idx.includes("`shared/flows-rt-hub.js#RtHub`"), "an export is an anchor of the form file#symbol");
  const hubLine = idx.split("\n").find((l) => l.startsWith("| `shared/flows-rt-routes.js` |"));
  ok(/\| [^|]*\brt\b[^|]*\|$/.test(hubLine), "the suites column names the suite that reaches shared/flows-rt-routes.js");
  const archLine = idx.split("\n").find((l) => l.startsWith("| `tests/architecture.mjs` |"));
  ok(archLine && archLine.includes("architecture"), "a suite file lists its own suite");
  ok(!/\*\*/.test(idx.split("\n").filter((l) => l.startsWith("| `")).join("\n")), "no ** cover leaks into a suites column");
  ok(!existsSync(path.join(ROOT, "map.md")), "the system map no longer sits at the repository root");
  ok(tracked.includes("docs/map-2026-10-05.md") && !tracked.includes("map.md"), "the frozen map is tracked under docs/ and map.md is not");
  ok(disk("docs/map-2026-10-05.md").startsWith("# anilkaya.org: system map"), "the frozen map keeps its title");
  ok(idx.includes("`docs/map-2026-10-05.md`"), "the index names the frozen map");
}

{
  const files = ["worker.js", "shared/a.js", "tests/lib/a.mjs", "docs/map-2026-10-05.md"];
  const lines = { "worker.js": 100, "shared/a.js": 10, "tests/lib/a.mjs": 5 };
  const lineCount = (f) => lines[f] ?? null;
  const text = [
    "see `worker.js:50` and worker.js:100",
    "range `shared/a.js:3-9` is fine, `shared/a.js:3-12` is not",
    "bare a.mjs:5 resolves by basename, a.mjs:6 is one past the end and allowed, a.mjs:7 is not",
    "`missing/file.js:4` names no file; version.txt:3 is not a path; `tests/lib/a.mjs:0` is not a line",
  ].join("\n");
  const r = auditText(text, { files, lineCount });
  eq(r.badFile.length, 1, "one reference names no file");
  eq(r.badLine.length, 3, "three references point past the end or before the start");
  eq(r.refs, 9, "the references counted");
  deep(r.badFile[0], { line: 4, ref: "`missing/file.js:4" }, "the missing file is reported with its line");
  const s = summarise([{ file: "x", ...r }, { file: "y", refs: 0, badFile: [], badLine: [] }]);
  eq(s.refs, 9, "the summary adds references");
  eq(s.stale, 4, "the summary adds stale references");
  ok(Math.abs(s.share - 4 / 9) < 1e-12, "the stale share is the ratio");
  eq(s.rows[1].stale, 0, "a document with no references is not stale");
  const resolve = makeResolver(["a/x.js", "b/x.js", "c/y.js"]);
  eq(resolve("c/y.js"), "c/y.js", "an exact path resolves");
  eq(resolve("y.js"), "c/y.js", "a unique basename resolves");
  eq(resolve("x.js"), null, "an ambiguous basename does not");
  eq(resolve("b/x.js"), "b/x.js", "a suffix disambiguates");
}

{
  const out = JSON.parse(execFileSync("node", ["scripts/map/audit.mjs", "--json", "AGENTS.md", "docs/map-2026-10-05.md"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  ok(out.refs > 1000 && out.share >= 0 && out.share < 1, `the audit runs on the frozen map and reports a stale share (${(out.share * 100).toFixed(1)}% of ${out.refs} references)`);
  eq(out.details.length, 2, "the audit reports each document");
}

{
  const text = "<!-- gen:courses -->old<!-- /gen:courses -->";
  const out = replaceRegions(text, { courses: "NEW", globals: "", "suites-local": "", filemap: "", "suites-server": "" });
  eq(out.text, "<!-- gen:courses -->NEW<!-- /gen:courses -->", "a region's content is replaced and its markers kept");
  eq(out.problems.length, 4, "each missing region is reported");
}

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`✓ docs: ${checks} assertions - AGENTS.md's generated sections and docs/index.md equal the generator, every tracked file has a row, ${real.modules.length} rows, the reference audit, in ${Math.round(ms)} ms`);
