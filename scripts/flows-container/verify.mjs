import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.version !== "v22.23.5" || process.arch !== "x64" || process.platform !== "linux") {
  throw new Error("This rehearsal requires the pinned linux/amd64 Node 22.23.5 runtime.");
}
if (process.argv.length !== 2) throw new Error("The fixture rehearsal takes no arguments.");

const root = fileURLToPath(new URL("../../", import.meta.url));
const result = spawnSync(process.execPath, ["tests/flows-pipeline-golden.mjs"], {
  cwd: root,
  env: { TZ: "UTC", NODE_OPTIONS: "--require=./scripts/flows-container/offline.cjs" },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
