import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = path.join(root, "tests");

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + " " + args.join(" ") + " failed.");
  return capture ? result.stdout.trim() : "";
}

if (process.versions.node.split(".")[0] !== "22") throw new Error("The regression baseline uses Node 22.");
const commit = run("git", ["rev-parse", "--verify", "HEAD"], root, true);
const tree = run("git", ["rev-parse", "--verify", "HEAD^{tree}"], root, true);
console.log("Cloudflare staging build", { commit, tree });
run("npm", ["ci", "--no-audit", "--no-fund"], tests);
run(process.execPath, ["run.mjs", "--group", "fast"], tests);
run(process.execPath, ["staging-contract.mjs"], tests);
run(process.execPath, ["scripts/strip-comments.mjs"]);
const directory = mkdtempSync(path.join(tmpdir(), "anilkaya-stage-bundle-"));
try {
  run(process.execPath, ["tests/node_modules/wrangler/bin/wrangler.js", "deploy", "--config", "wrangler.staging.toml", "--dry-run", "--outdir", directory]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("Staging build checks passed", { commit, tree });
