import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MARK = (rel) => "\n@@ source " + rel + " @@\n";
const BOUNDARY = /\n@@ source [^\n]* @@\n/;
const cache = new Map();

const toRel = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

export function moduleSource(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`source-scan: ${rel} does not exist`);
  const text = readFileSync(abs, "utf8");
  cache.set(rel, text);
  return text;
}

const STATIC = /(?:^|[;}])\s*(?:import|export)\b[^;]*?\bfrom\s*(["'])([^"'\n]+)\1|(?:^|[;}])\s*import\s*(["'])([^"'\n]+)\3/gm;
const DYNAMIC = /\bimport\s*\(\s*/g;
const LITERAL = /^(?:"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`\\$]*)`)\s*[,)]/;

export function parseImports(text, label = "source") {
  const found = [];
  for (const m of text.matchAll(STATIC)) found.push({ spec: m[2] || m[4], dynamic: false });
  for (const m of text.matchAll(DYNAMIC)) {
    const rest = text.slice(m.index + m[0].length);
    const lit = LITERAL.exec(rest);
    if (!lit) {
      const line = text.slice(0, m.index).split("\n").length;
      throw new Error(`source-scan: ${label}:${line} has a non-literal import(), which no closure walk can follow`);
    }
    found.push({ spec: lit[1] ?? lit[2] ?? lit[3], dynamic: true });
  }
  return found;
}

export const importsOf = (rel) => parseImports(moduleSource(rel), rel);

export function importEdges(rel) {
  const dir = path.dirname(path.join(ROOT, rel));
  const out = [];
  for (const { spec, dynamic } of importsOf(rel)) {
    if (!spec.startsWith(".")) continue;
    const target = toRel(path.resolve(dir, spec.replace(/[?#].*$/, "")));
    if (!existsSync(path.join(ROOT, target))) throw new Error(`source-scan: ${rel} imports ${spec}, which does not resolve`);
    if (!out.some((e) => e.file === target)) out.push({ file: target, dynamic });
  }
  return out;
}

export function closure(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    for (const { file: next } of importEdges(file)) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  const rest = [...seen].filter((f) => f !== entry).sort();
  return [entry, ...rest];
}

export function treeFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(?:m?js)$/.test(ent.name)) out.push(toRel(p));
    }
  };
  walk(abs);
  return out.sort();
}

export function joinSources(files) {
  return files.map((f) => MARK(f) + moduleSource(f)).join("");
}

export const closureSource = (entry) => joinSources(closure(entry));
export const workerSource = () => closureSource("worker.js");
export const pipelineSource = () => closureSource("scripts/flows-pipeline.mjs");

export const NIGHTLY_ENTRY = "scripts/flows-pipeline.mjs";
export const NIGHTLY_DIR = "scripts/flows-nightly";
export const nightlyFiles = () => [NIGHTLY_ENTRY, ...treeFiles(NIGHTLY_DIR)];
export const nightlySource = () => joinSources(nightlyFiles());
export const nightlySlice = (startMarker, endMarker) => {
  const cut = slice(nightlySource(), startMarker, endMarker);
  if (!cut.trim()) throw new Error(`source-scan: the slice from ${JSON.stringify(startMarker)} is empty`);
  return cut;
};

const globalOf = (pattern) => {
  if (typeof pattern === "string") return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
  if (!(pattern instanceof RegExp)) throw new TypeError("source-scan: a pattern is a string or a RegExp");
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
};

export function count(src, pattern) {
  if (typeof src !== "string") throw new TypeError("source-scan: the source is not a string");
  return [...src.matchAll(globalOf(pattern))].length;
}

export function slice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error(`source-scan: slice start marker not found: ${JSON.stringify(startMarker)}`);
  if (endMarker === undefined) {
    const rest = src.slice(start);
    const edge = rest.search(BOUNDARY);
    return edge < 0 ? rest : rest.slice(0, edge);
  }
  const end = src.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`source-scan: slice end marker not found after the start: ${JSON.stringify(endMarker)}`);
  const cut = src.slice(start, end);
  if (BOUNDARY.test(cut)) {
    throw new Error(`source-scan: slice from ${JSON.stringify(startMarker)} to ${JSON.stringify(endMarker)} crosses a module boundary (${cut.match(BOUNDARY)[0].trim()})`);
  }
  return cut;
}

export function expect(src, pattern, opts = {}) {
  const { min, max = Infinity, why = "" } = opts;
  if (!Number.isInteger(min) || min < 1) {
    throw new Error(`source-scan: expect() needs an integer min of at least 1, so a scan can never pass on an empty match (got ${min})`);
  }
  if (!(max === Infinity || (Number.isInteger(max) && max >= min))) throw new Error(`source-scan: expect() max ${max} is below min ${min}`);
  const n = count(src, pattern);
  if (n < min || n > max) {
    throw new Error(`source-scan: ${pattern} matched ${n} times, expected ${min}..${max}${why ? ": " + why : ""}`);
  }
  return n;
}

export function absent(src, pattern, opts = {}) {
  const { anchor, why = "" } = opts;
  if (anchor === undefined) throw new Error("source-scan: absent() needs a positive anchor that must match the same source");
  expect(src, anchor, { min: 1, why: "the anchor of an absence scan" + (why ? ": " + why : "") });
  const n = count(src, pattern);
  if (n !== 0) throw new Error(`source-scan: ${pattern} matched ${n} times, expected none${why ? ": " + why : ""}`);
  return true;
}

export function where(files, pattern) {
  return files.filter((f) => count(moduleSource(f), pattern) > 0);
}
