import { execFile, spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TEST_DIR, "..");
const WRANGLER = path.join(TEST_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
export const SESSION_SECRET = "test-session-secret-abcdefghijklmnopqrstuvwxyz";

const SANDBOX = process.env.FLOWS_TEST_SANDBOX === "1";
const childEnv = () => ({
  ...process.env,
  NO_COLOR: "1",
  ...(SANDBOX ? { CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false" } : {}),
});

export const FLOWS_PEPPER = "test-flows-pepper-abcdefghijklmnopqrstuvwxyz";
export const FLOWS_PASSWORD = "test-flows-password";
export const FLOWS_TEST_USER = "anilkaya";

function capture(child) {
  let output = "";
  const add = (chunk) => { output = (output + chunk.toString()).slice(-30000); };
  child.stdout?.on("data", add);
  child.stderr?.on("data", add);
  return () => output;
}

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRANGLER, ...args], {
      cwd: REPO_ROOT,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    const output = capture(child);
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output()) : reject(new Error(output() || `wrangler exited ${code}`)));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function waitForPort(port, child, output) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    const started = Date.now();
    const poll = () => {
      if (child.exitCode != null) return reject(new Error(output() || `wrangler exited ${child.exitCode}`));
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started > 30000) reject(new Error("wrangler startup timeout\n" + output()));
        else setTimeout(poll, 100);
      });
    };
    poll();
  });
}

const LIVE_GROUPS = new Set();

function signalGroup(child, signal) {

  try { process.kill(-child.pid, signal); return; } catch {   }
  try { child.kill(signal); } catch {   }
}

function sweepGroups() {

  for (const child of LIVE_GROUPS) {
    try { process.kill(-child.pid, "SIGKILL"); } catch {   }
  }
}

let sweepArmed = false;
function armSweep() {
  if (sweepArmed) return;
  sweepArmed = true;
  process.on("exit", sweepGroups);

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const onSignal = () => {
      sweepGroups();
      process.off(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }
}

async function stopProcess(child) {
  LIVE_GROUPS.delete(child);
  if (child.exitCode != null) {

    signalGroup(child, "SIGKILL");
    return;
  }
  signalGroup(child, "SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (!exited && child.exitCode == null) {
    signalGroup(child, "SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }

  signalGroup(child, "SIGKILL");
}

async function flowsCredentialsJSON() {
  const { FLOWS_USERNAMES, deriveHash } = await import("../shared/flows-auth.js");
  const map = {};
  for (const username of FLOWS_USERNAMES) {
    map[username] = await deriveHash(username, FLOWS_PASSWORD, FLOWS_PEPPER);
  }
  return JSON.stringify(map);
}

async function stageServedTree(stage) {
  const { stdout } = await promisify(execFile)(
    "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  for (const relative of stdout.split("\0")) {
    if (!relative || (relative.startsWith(".") && relative.includes("/"))) continue;
    const source = path.join(REPO_ROOT, relative);
    const info = await lstat(source).catch(() => null);
    if (!info?.isFile()) continue;
    const target = path.join(stage, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

export async function startWorker({ extraVars = [] } = {}) {
  const port = await freePort();
  const persist = await mkdtemp(path.join(os.tmpdir(), "anilkaya-worker-test-"));
  const scratch = [persist];
  const cleanup = () => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true })));
  let served = REPO_ROOT;
  try {
    await run(["d1", "execute", "iewt", "--local", "--file", "schema.sql", "--persist-to", persist, "-y"]);
    if (SANDBOX) {
      served = await mkdtemp(path.join(os.tmpdir(), "anilkaya-worker-tree-"));
      scratch.push(served);
      await stageServedTree(served);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  armSweep();
  const child = spawn(process.execPath, [
    WRANGLER, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
    "--persist-to", persist,
    "--var", "GOOGLE_CLIENT_ID:test-client",
    "--var", "GOOGLE_CLIENT_SECRET:test-secret",
    "--var", `SESSION_SECRET:${SESSION_SECRET}`,
    "--var", `FLOWS_PEPPER:${FLOWS_PEPPER}`,
    "--var", `FLOWS_CREDENTIALS:${await flowsCredentialsJSON()}`,

    "--var", "FLOWS_SESSION_EPOCH:1",

    "--var", "FLOWS_ASK_MODEL:",
    "--var", "FLOWS_ASK_FALLBACK_MODEL:",
    ...extraVars.flatMap((v) => ["--var", v]),
    "--log-level", "error", "--show-interactive-dev-session=false",
  ], {
    cwd: served,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],

    detached: true,
  });
  LIVE_GROUPS.add(child);
  const output = capture(child);

  try {
    await waitForPort(port, child, output);

    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(120000) })
      .catch(() => {});
  } catch (error) {
    await stopProcess(child);
    await cleanup();
    throw error;
  }

  return {
    baseURL: `http://127.0.0.1:${port}`,
    output,
    async d1(command) {
      return run(["d1", "execute", "iewt", "--local", "--command", command, "--persist-to", persist, "-y"]);
    },
    async stop() {
      await stopProcess(child);
      await cleanup();
    },
  };
}
