import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const ORDER = Object.freeze(["ff-session", "ff-stats", "ff-ids", "ff-sentence", "ff-grammar", "ff-house", "ff-engine"]);

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

const occurrences = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
};

export function applyOnce(source, transforms, label) {
  let out = source;
  for (const [from, to] of transforms) {
    const n = occurrences(out, from);
    if (n !== 1) throw new Error(`plant did not apply to ${label}: ${JSON.stringify(from.slice(0, 90))} matched ${n} times`);
    out = out.replace(from, () => to);
  }
  return out;
}

const dataUrl = (text) => "data:text/javascript;base64," + Buffer.from(text).toString("base64");

export async function loadGraph(overrides = {}, salt = 0) {
  const urls = {};
  for (const name of ORDER) {
    const file = path.join(ROOT, "shared", name + ".js");
    let source = readFileSync(file, "utf8");
    if (overrides[name]) source = applyOnce(source, overrides[name], name);
    source = source.replace(SPECIFIER, (m, head, quote, spec) => {
      const base = path.basename(spec, ".js");
      if (urls[base]) return head + quote + urls[base] + quote;
      return head + quote + pathToFileURL(path.resolve(path.dirname(file), spec)).href + quote;
    });
    urls[name] = dataUrl(source + "\n".repeat(salt));
  }
  const mods = {};
  for (const name of ORDER) mods[name.slice(3)] = await import(urls[name]);
  return mods;
}

export async function loadReal() {
  const mods = {};
  for (const name of ORDER) mods[name.slice(3)] = await import(pathToFileURL(path.join(ROOT, "shared", name + ".js")).href);
  return mods;
}
