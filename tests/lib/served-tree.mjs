import { execFileSync } from "node:child_process";
import { existsSync, statSync, lstatSync, readFileSync } from "node:fs";
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

const brokenLinks = (root, list) => list.filter((rel) => {
  const abs = path.join(root, rel);
  let link;
  try { link = lstatSync(abs); } catch { return false; }
  return link.isSymbolicLink() && !existsSync(abs);
});

export function assetsIgnorePatterns({ root = ROOT, defaults = true } = {}) {
  const file = path.join(root, IGNORE_FILE);
  const own = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  return [...(defaults ? WRANGLER_DEFAULT_IGNORES : []), ...own];
}

export function candidateFiles({ root = ROOT } = {}) {
  const cached = git(root, ["ls-files", "-z", "--cached"]);
  const others = git(root, ["ls-files", "-z", "--others", "--exclude-standard"]);
  const tracked = regularFiles(root, cached);
  const known = new Set(cached);
  const untracked = regularFiles(root, others).filter((rel) => !known.has(rel));
  const broken = { tracked: brokenLinks(root, cached), untracked: brokenLinks(root, others).filter((rel) => !known.has(rel)) };
  return { tracked, untracked, broken };
}

const ignoredAmong = (root, mode, files, excludes) => {
  const out = new Set();
  for (let i = 0; i < files.length; i += 500) {
    for (const rel of git(root, ["ls-files", "-z", mode, "--ignored", ...excludes, "--", ...files.slice(i, i + 500)])) out.add(rel);
  }
  return out;
};

export function servedFiles({ root = ROOT, defaults = true } = {}) {
  const { tracked, untracked, broken } = candidateFiles({ root });
  const all = [...tracked, ...untracked].sort();
  const file = path.join(root, IGNORE_FILE);
  const excludes = [];
  if (existsSync(file)) excludes.push("--exclude-from=" + file);
  if (defaults) for (const p of WRANGLER_DEFAULT_IGNORES) excludes.push("--exclude=" + p);
  const ignoredBroken = new Set(excludes.length ? [
    ...(broken.tracked.length ? ignoredAmong(root, "--cached", broken.tracked, excludes) : []),
    ...(broken.untracked.length ? ignoredAmong(root, "--others", broken.untracked, excludes) : []),
  ] : []);
  const unignoredBroken = [...broken.tracked, ...broken.untracked].filter((rel) => !ignoredBroken.has(rel)).sort();
  if (unignoredBroken.length) throw new Error(`served tree: ${unignoredBroken.join(", ")} ${unignoredBroken.length === 1 ? "is a symbolic link" : "are symbolic links"} to nothing outside ${IGNORE_FILE}; wrangler stats every unignored entry and a dangling link fails the whole asset upload, so remove the link or ignore it`);
  if (!excludes.length) return all;
  const ignored = new Set([
    ...(tracked.length ? ignoredAmong(root, "--cached", tracked, excludes) : []),
    ...(untracked.length ? ignoredAmong(root, "--others", untracked, excludes) : []),
  ]);
  return all.filter((rel) => !ignored.has(rel));
}
