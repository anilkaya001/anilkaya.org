import { execFileSync } from "node:child_process";
import path from "node:path";
import { globMatches, scanSuite, trackedFiles } from "./suite-registry.mjs";

export const FULL_PATTERNS = [
  /^tests\/run\.mjs$/,
  /^tests\/lib\//,
  /^tests\/package(?:-lock)?\.json$/,
  /^\.github\//,
  /^wrangler[^/]*\.toml$/,
  /^worker\.js$/,
  /^\.assetsignore$/,
  /^_headers$/,
];
export const FAN_OUT_LIMIT = 0.4;
const SUITE_FILE = /^tests\/suites\/([^/]+)\.json$/;

export function changedFiles(root, base, run = execFileSync) {
  if (typeof base !== "string" || !base || base.startsWith("-")) return null;
  try {
    const out = run("git", ["diff", "--name-only", "-z", `${base}...HEAD`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

export function mapSuites(root, suites, tracked) {
  return suites.map((s) => {
    const got = scanSuite(root, s, s.command, tracked);
    return { name: s.name, group: s.group || "shard", files: got.scan.files, covers: Array.isArray(s.covers) ? s.covers : [] };
  });
}

const full = (reason) => ({ full: true, reason, names: null });

export function selectAffected({ root, suites, changed, tracked = trackedFiles(root), patterns = FULL_PATTERNS, fanOut = FAN_OUT_LIMIT, honourCovers = true, transitive = true }) {
  if (!Array.isArray(changed)) return full("the changed files could not be read");
  if (!changed.length) return full("no changed file was found");
  const map = mapSuites(root, suites, tracked);
  if (!transitive) for (const m of map) m.files = new Set([...m.files].filter((f) => /^tests\/[^/]+\.mjs$/.test(f)));
  const names = new Set(map.filter((m) => m.group === "fast").map((m) => m.name));
  const known = new Set(map.map((m) => m.name));
  for (const f of changed) {
    if (patterns.some((p) => p.test(f))) return full(`${f} is shared by every suite`);
    const own = SUITE_FILE.exec(f);
    const hits = map.filter((m) => m.files.has(f) || (honourCovers && m.covers.some((c) => globMatches(c, f))));
    if (own && known.has(own[1])) hits.push(map.find((m) => m.name === own[1]));
    if (!hits.length) return full(`${f} maps to no suite`);
    if (hits.length > fanOut * map.length) return full(`${f} reaches ${hits.length} of ${map.length} suites`);
    for (const h of hits) names.add(h.name);
  }
  return { full: false, reason: null, names };
}

export function describeSelection(sel, suites) {
  if (sel.full) return [`full: ${sel.reason}`];
  const picked = suites.filter((s) => sel.names.has(s.name)).map((s) => s.name);
  return [`partial: ${picked.length} of ${suites.length} suites`, ...picked];
}

export const rootOf = (dir) => path.resolve(dir, "..");
