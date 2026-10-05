import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", "tests", "docs"]);
const REFERENCE = /(\/assets\/[^"'()\s?#]+)\?v=(\d+)/g;
const SHELL = /(<html\b[^>]*\bdata-asset-version=")(\d+)(")/g;
const PAGES = "shared/flows-pages.js";
const CONSTANT = /^(export const ASSET_VERSION = ")(\d+)(";)$/gm;

function token(root, rel) {
  const text = readFileSync(path.join(root, rel), "utf8").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${rel} must hold one integer, found ${JSON.stringify(text)}`);
  return Number(text);
}

function htmlFiles(root, dir = "") {
  const out = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) out.push(...htmlFiles(root, rel)); }
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

export function referenceFiles(root) {
  const cssDir = path.join(root, "assets/css");
  const css = existsSync(cssDir)
    ? readdirSync(cssDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".css")).map((e) => `assets/css/${e.name}`)
    : [];
  return [...htmlFiles(root), ...css].sort();
}

export function plan(root = DEFAULT_ROOT, { to } = {}) {
  const from = token(root, "assets/version.txt");
  const fonts = token(root, "assets/fonts-version.txt");
  const next = to ?? from + 1;
  if (!Number.isSafeInteger(next) || next < from) throw new Error(`the new asset version ${next} must be an integer no lower than ${from}`);
  if (fonts > next) throw new Error(`assets/fonts-version.txt (${fonts}) runs ahead of the asset version ${next}`);
  const writes = new Map();
  const moved = [];
  const fontsReset = [];
  for (const rel of referenceFiles(root)) {
    const before = readFileSync(path.join(root, rel), "utf8");
    const after = before
      .replace(REFERENCE, (all, asset, v) => {
        const want = asset.endsWith(".woff2") ? fonts : next;
        if (Number(v) === want) return all;
        (asset.endsWith(".woff2") ? fontsReset : moved).push({ file: rel, asset, from: Number(v), to: want });
        return `${asset}?v=${want}`;
      })
      .replace(SHELL, (all, head, v, tail) => {
        if (Number(v) === next) return all;
        moved.push({ file: rel, asset: "data-asset-version", from: Number(v), to: next });
        return `${head}${next}${tail}`;
      });
    if (after !== before) writes.set(rel, after);
  }
  const pages = readFileSync(path.join(root, PAGES), "utf8");
  const hits = [...pages.matchAll(CONSTANT)];
  if (hits.length !== 1) throw new Error(`${PAGES} must declare ASSET_VERSION exactly once, found ${hits.length}`);
  if (Number(hits[0][2]) !== next) {
    moved.push({ file: PAGES, asset: "ASSET_VERSION", from: Number(hits[0][2]), to: next });
    writes.set(PAGES, pages.replace(CONSTANT, (all, head, v, tail) => `${head}${next}${tail}`));
  }
  if (next !== from) writes.set("assets/version.txt", `${next}\n`);
  return { from, to: next, fonts, writes, moved, fontsReset };
}

export function apply(result, root = DEFAULT_ROOT) {
  for (const [rel, text] of result.writes) writeFileSync(path.join(root, rel), text);
  return result;
}

function main(argv) {
  const args = argv.slice(2);
  let root = DEFAULT_ROOT, check = false, to;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") check = true;
    else if (args[i] === "--root") root = path.resolve(args[++i]);
    else if (args[i] === "--to") to = Number(args[++i]);
    else throw new Error(`unknown argument ${args[i]}; usage: node scripts/bump-assets.mjs [--check] [--to N] [--root DIR]`);
  }
  if (check) {
    const current = token(root, "assets/version.txt");
    const result = plan(root, { to: current });
    const stale = [...result.moved, ...result.fontsReset];
    for (const s of stale) console.error(`${s.file}: ${s.asset} at ${s.from}, expected ${s.to}`);
    if (stale.length) { console.error(`bump-assets --check: ${stale.length} reference(s) off their token`); return 1; }
    console.log(`bump-assets --check: every CSS and JavaScript reference at ?v=${current}, every font at ?v=${result.fonts}`);
    return 0;
  }
  const result = apply(plan(root, { to }), root);
  console.log(`bump-assets: asset version ${result.from} -> ${result.to}; ${result.moved.length} reference(s) moved in ${result.writes.size} file(s); fonts stay at ?v=${result.fonts}` +
    (result.fontsReset.length ? `, ${result.fontsReset.length} font reference(s) set back to it` : ""));
  for (const f of result.fontsReset) console.log(`  font reset: ${f.file}: ${f.asset} ${f.from} -> ${f.to}`);
  console.log("bump-assets: the course generator was not run; run node scripts/generate-course-payloads.mjs yourself when a Lab source it bundles changed");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv); } catch (error) { console.error("bump-assets: " + error.message); process.exitCode = 1; }
}
