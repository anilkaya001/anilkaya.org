import { execFileSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const IGNORE_FILE = ".assetsignore";
export const WRANGLER_DEFAULT_IGNORES = Object.freeze(["/.assetsignore", "/_redirects", "/_headers"]);

const git = (root, args) => execFileSync("git", ["--literal-pathspecs", ...args], {
  cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
}).split("\0").filter(Boolean);

const regularFiles = (root, list) => list.filter((rel) => {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return false;
  return statSync(abs).isFile();
});

export function assetsIgnorePatterns({ root = ROOT, defaults = true } = {}) {
  const file = path.join(root, IGNORE_FILE);
  const own = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  return [...(defaults ? WRANGLER_DEFAULT_IGNORES : []), ...own];
}

export function candidateFiles({ root = ROOT } = {}) {
  const tracked = regularFiles(root, git(root, ["ls-files", "-z", "--cached"]));
  const known = new Set(tracked);
  const untracked = regularFiles(root, git(root, ["ls-files", "-z", "--others", "--exclude-standard"])).filter((rel) => !known.has(rel));
  return { tracked, untracked };
}

const ignoredAmong = (root, mode, files, excludes) => {
  const out = new Set();
  for (let i = 0; i < files.length; i += 500) {
    for (const rel of git(root, ["ls-files", "-z", mode, "--ignored", ...excludes, "--", ...files.slice(i, i + 500)])) out.add(rel);
  }
  return out;
};

export function servedFiles({ root = ROOT, defaults = true } = {}) {
  const { tracked, untracked } = candidateFiles({ root });
  const all = [...tracked, ...untracked].sort();
  const file = path.join(root, IGNORE_FILE);
  const excludes = [];
  if (existsSync(file)) excludes.push("--exclude-from=" + file);
  if (defaults) for (const p of WRANGLER_DEFAULT_IGNORES) excludes.push("--exclude=" + p);
  if (!excludes.length) return all;
  const ignored = new Set([
    ...(tracked.length ? ignoredAmong(root, "--cached", tracked, excludes) : []),
    ...(untracked.length ? ignoredAmong(root, "--others", untracked, excludes) : []),
  ]);
  return all.filter((rel) => !ignored.has(rel));
}
