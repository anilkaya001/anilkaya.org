import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const CHAIN = Object.freeze([
  "server/ff-records.js",
  "server/ff-store.js",
  "server/ff-health.js",
  "server/ff-digest.js",
  "server/ff-export.js",
  "server/ff-preview.js",
  "server/routes/flows-ff.js",
]);

const SPECIFIER = /(\bfrom\s*)(["'])(\.{1,2}\/[^"'\n]+)\2/g;

const count = (text, needle) => {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n += 1;
  return n;
};

export function applyOnce(source, transforms, label) {
  let out = source;
  for (const [from, to] of transforms) {
    const n = count(out, from);
    if (n !== 1) throw new Error("planted build does not apply to " + label + ": " + JSON.stringify(from.slice(0, 90)) + " matched " + n + " times");
    out = out.replace(from, () => to);
  }
  return out;
}

export async function loadChain(mutations = {}, salt = 0) {
  const urls = new Map();
  const modules = {};
  for (const rel of CHAIN) {
    const abs = path.join(ROOT, rel);
    const own = mutations[rel] || [];
    let text = applyOnce(readFileSync(abs, "utf8"), own, rel);
    let touched = own.length > 0;
    text = text.replace(SPECIFIER, (m, head, quote, spec) => {
      const resolved = path.resolve(path.dirname(abs), spec);
      const key = path.relative(ROOT, resolved).split(path.sep).join("/");
      if (urls.has(key)) {
        touched = true;
        return head + quote + urls.get(key) + quote;
      }
      return head + quote + pathToFileURL(resolved).href + quote;
    });
    if (touched) {
      const url = "data:text/javascript;base64," + Buffer.from(text + "\n".repeat(salt)).toString("base64");
      urls.set(rel, url);
      modules[rel] = await import(url);
    } else {
      modules[rel] = await import(pathToFileURL(abs).href);
    }
  }
  return {
    createFfStore: modules["server/ff-store.js"].createFfStore,
    flowsFfRows: modules["server/routes/flows-ff.js"].flowsFfRows,
    modules,
  };
}
