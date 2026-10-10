import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const DRY_NOW = "2026-08-24T21:45:00Z";
export const EMIT_MARK = ".emit-complete";

const memo = new Map();
const owned = new Set();
let hooked = false;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (entry.isFile() && /\.(mjs|js|json)$/.test(entry.name)) out.push(file);
  }
}

export function sourceFingerprint(root = ROOT) {
  const files = [];
  for (const sub of ["scripts", "shared"]) {
    const dir = path.join(root, sub);
    if (existsSync(dir)) walk(dir, files);
  }
  files.sort();
  const hash = createHash("sha256");
  for (const file of files) {
    const st = statSync(file);
    hash.update(`${path.relative(root, file)}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
  }
  hash.update(process.version);
  return hash.digest("hex").slice(0, 32);
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => {
    for (const dir of owned) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
}

export function nightlyEmit({ now = DRY_NOW, dir = process.env.FLOWS_EMIT_DIR || null, root = ROOT } = {}) {
  const key = `${dir || ""}\0${now}`;
  if (memo.has(key)) return memo.get(key);
  const finger = JSON.stringify({ now, source: sourceFingerprint(root) });
  let target = dir;
  if (!target) {
    target = mkdtempSync(path.join(os.tmpdir(), "flows-emit-"));
    owned.add(target);
    hook();
  }
  const mark = path.join(target, EMIT_MARK);
  const fresh = existsSync(mark) && readFileSync(mark, "utf8") === finger;
  if (!fresh) {
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    try {
      execFileSync(process.execPath, [path.join(root, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", target + path.sep], {
        cwd: root,
        env: { ...process.env, FLOWS_DRY_NOW: now },
        stdio: ["ignore", "ignore", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      console.error("the dry-run emitter itself failed, so nothing below is measurable");
      console.error(String(error.stderr || error.message));
      process.exit(1);
    }
    writeFileSync(mark, finger);
  }
  memo.set(key, target);
  return target;
}

export function emitFiles(dir) {
  return readdirSync(dir).filter((f) => f !== EMIT_MARK).sort();
}

export function emitRead(dir, key) {
  const file = path.join(dir, "-" + key.replace(":", "-") + ".json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}
