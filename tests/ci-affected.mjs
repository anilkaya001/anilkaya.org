import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { selectAffected, changedFiles, describeSelection, FULL_PATTERNS } from "./lib/affected.mjs";
import { parseArgs, chooseSuites, UsageError } from "./run.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "ci-affected-")));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));
const files = {
  "shared/leaf.js": "export const leaf = 1;\n",
  "shared/mid.js": "import { leaf } from './leaf.js';\nexport const mid = leaf;\n",
  "shared/lazy.js": "export const lazy = 1;\n",
  "shared/lone.js": "export const lone = 1;\n",
  "tests/s1.mjs": "import { mid } from '../shared/mid.js';\nconsole.log(mid);\n",
  "tests/s2.mjs": "const m = await import('../shared/lazy.js');\nconsole.log(m);\n",
  "tests/s3.mjs": "console.log('pages');\n",
  "tests/f.mjs": "console.log('fast');\n",
  "pages/a.html": "<p>a</p>\n",
  "docs/stray.txt": "x\n",
};
for (let i = 4; i <= 9; i++) files[`tests/s${i}.mjs`] = `console.log(${i});\n`;
for (const [f, text] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  writeFileSync(path.join(root, f), text);
}
const suite = (name, extra = {}) => ({ name, group: "shard", command: `node ${name}.mjs`, covers: [], ...extra });
const suites = [
  suite("f", { group: "fast" }), suite("s1"), suite("s2"), suite("s3", { covers: ["pages/*.html"] }),
  ...[4, 5, 6, 7, 8, 9].map((i) => suite(`s${i}`)),
];
const tracked = Object.keys(files);
const pick = (changed, extra = {}) => selectAffected({ root, suites, changed, tracked, ...extra });
const names = (sel) => [...sel.names].sort();

deep(names(pick(["shared/leaf.js"])), ["f", "s1"], "a leaf selects its transitive dependant and the fast group");
deep(names(pick(["shared/mid.js"])), ["f", "s1"], "a middle module selects its dependant");
deep(names(pick(["shared/lazy.js"])), ["f", "s2"], "a literal dynamic import is followed");
deep(names(pick(["pages/a.html"])), ["f", "s3"], "a covers glob selects its suite");
deep(names(pick(["shared/leaf.js", "pages/a.html"])), ["f", "s1", "s3"], "two changes select the union");
deep(names(pick(["tests/s4.mjs"])), ["f", "s4"], "a suite's own script selects it");
deep(names(pick(["tests/suites/s5.json"])), ["f", "s5"], "a registry file selects its suite");

for (const [file, what] of [
  ["shared/lone.js", "an unmapped module"],
  ["docs/stray.txt", "an unmapped document"],
  ["tests/run.mjs", "the runner"],
  ["tests/lib/anything.mjs", "a test helper"],
  ["tests/package-lock.json", "the lockfile"],
  [".github/workflows/regression.yml", "a workflow"],
  ["wrangler.toml", "the Worker configuration"],
  ["worker.js", "the Worker"],
  ["shared/gone.js", "a deleted file"],
]) {
  const sel = pick([file]);
  ok(sel.full === true && sel.names === null && sel.reason, `${what} selects everything`);
  ok(pick(["shared/leaf.js", file]).full, `${what} among other changes still selects everything`);
}
ok(pick([]).full, "an empty diff selects everything");
ok(pick(null).full, "an unreadable diff selects everything");
ok(pick(["shared/leaf.js"], { fanOut: 0.05 }).full, "a change reaching most suites selects everything");
ok(FULL_PATTERNS.every((p) => p instanceof RegExp), "the fallback table is patterns");

const noCovers = pick(["pages/a.html"], { honourCovers: false });
ok(noCovers.full === true, "mutant: a selector that ignores covers cannot place the file, so it is not the covers-aware answer");
ok(!noCovers.names, "mutant: a selector that ignores covers never reports s3");
const noClosure = pick(["shared/leaf.js"], { transitive: false });
ok(noClosure.full === true, "mutant: a selector that ignores transitive imports cannot place the leaf");
ok(!noClosure.names, "mutant: a selector that ignores transitive imports never reports s1");
ok(pick(["shared/lazy.js"], { transitive: false }).full, "mutant: no import walk cannot find a dynamic import");

deep(describeSelection(pick(["shared/leaf.js"]), suites), ["partial: 2 of 10 suites", "f", "s1"], "the list prints the selection");
ok(describeSelection(pick(["worker.js"]), suites)[0].startsWith("full: "), "the list prints the fallback and its reason");

const vcs = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
vcs("init", "-q", "-b", "main");
vcs("config", "user.email", "t@example.test");
vcs("config", "user.name", "t");
vcs("add", "-A");
vcs("commit", "-qm", "base");
const base = vcs("rev-parse", "HEAD").trim();
writeFileSync(path.join(root, "shared/leaf.js"), "export const leaf = 2;\n");
vcs("commit", "-qam", "change");
deep(changedFiles(root, base), ["shared/leaf.js"], "a diff against the base names the changed file");
ok(changedFiles(root, "no-such-ref") === null, "an unknown base is null, which selects everything");
ok(changedFiles(root, "--output=x") === null, "a flag-shaped base is refused");
ok(changedFiles(root, base, () => { throw new Error("boom"); }) === null, "a failing diff is null");

const o = parseArgs(["--affected", "origin/main", "--shard", "2/6"]);
ok(o.affected === "origin/main" && o.shard.index === 2, "--affected combines with --shard");
for (const bad of [["--affected-list"], ["--affected"], ["--affected", "--bail"], ["--affected", "x", "--only", "a"]]) {
  assert.throws(() => parseArgs(bad), UsageError);
  checks++;
}
const set = new Set(["f", "s1"]);
deep(chooseSuites(suites, parseArgs(["--affected", "x"]), set).map((s) => s.name), ["f", "s1"], "the selection filters the whole set");
deep(chooseSuites(suites, parseArgs(["--group", "fast", "--affected", "x"]), set).map((s) => s.name), ["f"], "the fast group is kept whole");
deep(chooseSuites(suites, parseArgs(["--group", "shard", "--affected", "x"]), new Set(["f"])).map((s) => s.name), [], "a shard with nothing affected runs nothing");
deep(chooseSuites(suites, parseArgs(["--affected", "x"]), null).length, suites.length, "a full fallback keeps every suite");

console.log(`ci-affected: ${checks} checks`);
