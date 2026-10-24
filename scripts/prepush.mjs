import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = path.join(ROOT, "tests");
const ALWAYS = ["contracts", "docs", "flows-weight", "architecture", "run", "lib-contract", "server-kernel", "server-rt", "server-pages", "server-router", "route-matrix"];
const RULES = [
  [/^assets\/css\/(flows|base)[^/]*\.css$|^shared\/flows-pages\.js$/, ["flows-pages-render", "flows-glass-render", "flows-overview", "flows-home-onescreen", "flows-kit"]],
  [/^assets\/js\/flows-(overview|home)[^/]*\.js$|^assets\/css\/flows-home\.css$/, ["flows-overview", "flows-home-onescreen", "flows-home-below-render", "flows-home-composition", "flows-pages-render"]],
  [/^assets\/js\/flows-market[^/]*\.js$/, ["flows-market-onescreen", "flows-market-below-render", "flows-pages-render"]],
  [/^assets\/js\/flows-ticker[^/]*\.js$|^assets\/css\/flows-ticker\.css$/, ["flows-ticker", "flows-glance-render", "flows-pages-render"]],
  [/^assets\/js\/flows-(unusual|feed|net)[^/]*\.js$/, ["flows-feeds-onescreen", "flows-net-render", "flows-flow-below-render", "flows-pages-render"]],
  [/^assets\/js\/flows-desk[^/]*\.js$|^assets\/css\/flows-desk\.css$/, ["flows-desk-client", "flows-desk-onescreen", "flows-desk-calls-render"]],
  [/^tests\/suites\/|^tests\/run/, ["run"]],
  [/^worker\.js$|^server\//, ["route-matrix", "flows-worker", "server-router"]],
  [/^scripts\/flows-/, ["pipeline", "flows-legs", "flows-pipeline-chaos"]]
];

const arg = (name) => process.argv.includes(name);
const base = process.argv.find((a) => a.startsWith("--base="))?.slice(7) || "origin/main";
const jobs = Number((process.argv.find((a) => a.startsWith("--jobs=")) || "").slice(7)) || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
const changed = [...new Set([...git("diff", "--name-only", `${base}...HEAD`), ...git("diff", "--name-only"), ...git("ls-files", "--others", "--exclude-standard")])];

const known = new Set(fs.readdirSync(path.join(TESTS, "suites")).map((f) => f.replace(/\.json$/, "")));
const picked = new Set(ALWAYS);
for (const file of changed) for (const [re, suites] of RULES) if (re.test(file)) suites.forEach((s) => picked.add(s));

let affected = [];
try {
  const out = execFileSync("node", ["run.mjs", "--affected", base, "--affected-list"], { cwd: TESTS, encoding: "utf8" }).trim();
  if (out.startsWith("partial:")) affected = out.slice(8).split(/[\s,]+/).filter(Boolean);
} catch {
  affected = [];
}
affected.forEach((s) => picked.add(s));

const plan = [...picked].filter((s) => known.has(s));
const unknown = [...picked].filter((s) => !known.has(s));
if (unknown.length) console.error(`not in the registry, skipped: ${unknown.join(", ")}`);
console.log(`${changed.length} changed files against ${base}; ${plan.length} suites: ${plan.join(" ")}`);
if (arg("--list")) process.exit(0);

const env = { ...process.env };
if (!env.NODE_PATH && fs.existsSync(path.join(TESTS, "node_modules", "axe-core"))) env.NODE_PATH = path.join(TESTS, "node_modules");

const results = [];
const queue = plan.slice();
const run = (name) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("node", ["run.mjs", "--only", name], { cwd: TESTS, env, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (d) => { tail = (tail + d).slice(-4000); };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", (code) => {
      const row = { name, code, seconds: Math.round((Date.now() - started) / 1000), tail };
      results.push(row);
      console.log(`${code === 0 ? "pass" : "FAIL"} ${name} ${row.seconds}s`);
      resolve();
    });
  });
const worker = async () => { while (queue.length) await run(queue.shift()); };
await Promise.all(Array.from({ length: jobs }, worker));

const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.log(`\n--- ${r.name}\n${r.tail.split("\n").slice(-25).join("\n")}`);
console.log(failed.length ? `\n${failed.length} of ${results.length} suites failed: ${failed.map((r) => r.name).join(" ")}` : `\nall ${results.length} suites passed`);
process.exit(failed.length ? 1 : 0);
