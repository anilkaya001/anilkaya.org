import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TEST_DIR, "..");
const WRANGLER = path.join(TEST_DIR, "node_modules", "wrangler", "bin", "wrangler.js");
export const SESSION_SECRET = "test-session-secret-abcdefghijklmnopqrstuvwxyz";

// Flows gate test fixtures. Real values live in Worker secrets; these exist so
// the local harness can exercise the credential path end to end.
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
      env: { ...process.env, NO_COLOR: "1" },
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

async function stopProcess(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
  ]);
  if (exited || child.exitCode != null) return;
  child.kill("SIGKILL");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

async function flowsCredentialsJSON() {
  const { FLOWS_USERNAMES, deriveHash } = await import("../shared/flows-auth.js");
  const map = {};
  for (const username of FLOWS_USERNAMES) {
    map[username] = await deriveHash(username, FLOWS_PASSWORD, FLOWS_PEPPER);
  }
  return JSON.stringify(map);
}

export async function startWorker() {
  const port = await freePort();
  const persist = await mkdtemp(path.join(os.tmpdir(), "anilkaya-worker-test-"));
  try {
    await run(["d1", "execute", "iewt", "--local", "--file", "schema.sql", "--persist-to", persist, "-y"]);
  } catch (error) {
    await rm(persist, { recursive: true, force: true });
    throw error;
  }

  const child = spawn(process.execPath, [
    WRANGLER, "dev", "--local", "--ip", "127.0.0.1", "--port", String(port),
    "--persist-to", persist,
    "--var", "GOOGLE_CLIENT_ID:test-client",
    "--var", "GOOGLE_CLIENT_SECRET:test-secret",
    "--var", `SESSION_SECRET:${SESSION_SECRET}`,
    "--var", `FLOWS_PEPPER:${FLOWS_PEPPER}`,
    "--var", `FLOWS_CREDENTIALS:${await flowsCredentialsJSON()}`,
    "--log-level", "error", "--show-interactive-dev-session=false",
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = capture(child);

  try {
    await waitForPort(port, child, output);
  } catch (error) {
    await stopProcess(child);
    await rm(persist, { recursive: true, force: true });
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
      await rm(persist, { recursive: true, force: true });
    },
  };
}
