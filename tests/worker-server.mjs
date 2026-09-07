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

/* =============================================================
   THE HARNESS LEAKED A SPINNING WORKERD ON EVERY RUN, AND THE KILL
   THAT WAS SUPPOSED TO STOP IT WAS AIMED ONE LEVEL TOO HIGH.

   `wrangler dev` is a supervisor: it spawns `workerd` (the runtime) and
   `esbuild` (the bundler) as its OWN children. `child.kill()` signals
   wrangler and nothing else, so on any path where wrangler does not pass the
   signal on — a SIGKILL, or a wrangler already wedged — both grandchildren
   are reparented to init and keep running. Observed here, not theorised: two
   orphaned pairs from two earlier runs, 430 and 535 seconds old, holding a
   two-core box at load 2 and pushing the next suite's first request past
   undici's 300-second headers timeout. That reads exactly like a hang and is
   not one, which is why it survived so long: the symptom appears in the NEXT
   run, and a session's own logs look clean.

   The fix is to signal the process GROUP. `detached: true` makes the child a
   group leader, and `process.kill(-pid, sig)` then reaches every descendant,
   so the runtime dies with its supervisor. It also makes the group survive
   this process, which is why the exit hook below exists: a suite that throws
   before its `finally` — or is interrupted — must not leave the box worse
   than it found it. Registered on spawn, removed on stop, and swept
   synchronously on exit, because an async cleanup in an `exit` handler never
   runs.
   ============================================================= */
const LIVE_GROUPS = new Set();

function signalGroup(child, signal) {
  /* The group first, the process second. Once the child has exited, its
     group id is no longer valid and process.kill throws ESRCH — expected,
     not exceptional, so it is swallowed rather than reported. */
  try { process.kill(-child.pid, signal); return; } catch { /* fall through */ }
  try { child.kill(signal); } catch { /* already gone */ }
}

let sweepArmed = false;
function armSweep() {
  if (sweepArmed) return;
  sweepArmed = true;
  /* SIGKILL and not SIGTERM: this runs as the process is leaving, there is no
     time left to wait for a graceful stop, and a wrangler that ignores the
     TERM is exactly the case that produced the orphans. */
  process.on("exit", () => {
    for (const child of LIVE_GROUPS) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
  });
}

async function stopProcess(child) {
  LIVE_GROUPS.delete(child);
  if (child.exitCode != null) {
    /* THE SUPERVISOR CAN EXIT WITHOUT ITS RUNTIME. A wrangler that crashed
       leaves workerd behind exactly as a killed one does, so the group is
       swept even on the path that used to return immediately. */
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
  /* AND ONE MORE, AFTER THE SUPERVISOR IS GONE. wrangler exiting is not
     workerd exiting: the whole defect is that the two are separate processes,
     so the group gets a final sweep whether or not the parent went quietly.
     Signalling an already-empty group throws ESRCH and is swallowed. */
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

export async function startWorker({ extraVars = [] } = {}) {
  const port = await freePort();
  const persist = await mkdtemp(path.join(os.tmpdir(), "anilkaya-worker-test-"));
  try {
    await run(["d1", "execute", "iewt", "--local", "--file", "schema.sql", "--persist-to", persist, "-y"]);
  } catch (error) {
    await rm(persist, { recursive: true, force: true });
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
    /* The production epoch in wrangler.toml is a revocation lever that gets
       bumped on rotation; the harness pins its own so the fixtures'
       self-signed sessions stay valid across bumps. Epoch mismatch behavior
       has its own contracts in flows-auth and flows-worker. */
    "--var", "FLOWS_SESSION_EPOCH:1",
    /* NO MODEL, DELIBERATELY. Local Wrangler inference bills the SAME
       account-wide 10,000-neuron-per-day Workers AI allowance as
       production, so a suite that reached a model would spend a shared
       budget every time CI ran and would make its own result depend on a
       quota that another process could exhaust. Empty is a supported
       configuration — /api/flows/ask answers with the deterministic
       reading and a sentence saying no model is configured — so this
       exercises a real branch rather than stubbing one out. */
    "--var", "FLOWS_ASK_MODEL:",
    ...extraVars.flatMap((v) => ["--var", v]),
    "--log-level", "error", "--show-interactive-dev-session=false",
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    /* Its own process group, so stopProcess can reach workerd and esbuild.
       See the block above stopProcess for what this fixes and how it was
       observed. */
    detached: true,
  });
  LIVE_GROUPS.add(child);
  const output = capture(child);

  try {
    await waitForPort(port, child, output);
    /* The port accepting connections is not the worker being ready: wrangler
       compiles the bundle on the FIRST request, and on this hardware that
       first response has been measured at 32 seconds — past the 30-second
       navigation timeout the browser suites give their first page.goto, which
       made both fail on exactly the cold run and pass on every retry. Paying
       the compile here, once, keeps "the worker is up" true in the sense
       every caller actually means. A warm-up failure is not fatal: the
       suites' own requests will then report the real error. */
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(120000) })
      .catch(() => {});
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
