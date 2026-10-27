import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const GROUP = Object.freeze([
  "shared/flows-sides.js", "shared/flows-round.js", "shared/flows-sfc.js", "shared/flows-sfc-time.js", "shared/flows-sfc-tide.js",
  "shared/flows-sfc-display.js", "shared/flows-sfc-stock.js", "shared/flows-sfc-copy.js", "shared/flows-sfc-view.js", "shared/flows-ledger-book.js",
]);

const SPECIFIER = /(\bfrom\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

const count = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
};

export function applyOnce(source, transforms, label) {
  let out = source;
  for (const [from, to] of transforms) {
    const n = count(out, from);
    if (n !== 1) throw new Error(`plant did not apply to ${label}: ${JSON.stringify(from.slice(0, 70))} matched ${n} times`);
    out = out.replace(from, () => to);
  }
  return out;
}

const depsOf = (file, source) => {
  const dir = path.dirname(file);
  const out = [];
  for (const m of source.matchAll(SPECIFIER)) {
    const target = path.posix.normalize(path.posix.join(dir, m[3]));
    if (GROUP.includes(target)) out.push(target);
  }
  return out;
}

export async function loadVariant(plant = null, salt = "") {
  const mutated = new Map();
  for (const m of plant ? (Array.isArray(plant) ? plant : [plant]) : []) mutated.set(m.file, m.transforms);
  const sources = new Map(GROUP.map((f) => [f, readFileSync(path.join(ROOT, f), "utf8")]));
  const graph = new Map(GROUP.map((f) => [f, depsOf(f, sources.get(f))]));
  const varied = new Set(mutated.keys());
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of GROUP) if (!varied.has(f) && graph.get(f).some((d) => varied.has(d))) { varied.add(f); grew = true; }
  }
  const urls = new Map();
  const build = (file) => {
    if (urls.has(file)) return urls.get(file);
    let text = sources.get(file);
    if (mutated.has(file)) text = applyOnce(text, mutated.get(file), file);
    text = text.replace(SPECIFIER, (all, head, quote, spec) => {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (GROUP.includes(target) && varied.has(target)) return head + quote + build(target) + quote;
      return head + quote + pathToFileURL(path.join(ROOT, target)).href + quote;
    });
    const url = "data:text/javascript;base64," + Buffer.from(text + "\n" + "\n".repeat(salt.length)).toString("base64");
    urls.set(file, url);
    return url;
  };
  const load = (file) => import(varied.has(file) ? build(file) : pathToFileURL(path.join(ROOT, file)).href);
  const [sides, round, sfc, time, tide, display, stock, copy, view, book] = await Promise.all(GROUP.map(load));
  return { sides, round, sfc, time, tide, display, stock, copy, view, book };
}
