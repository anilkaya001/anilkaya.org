import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { productOf } from "../../shared/flows-products.js";

export function keyOfFile(file) {
  if (!file.startsWith("-") || !file.endsWith(".json")) return null;
  const base = file.slice(1, -5);
  const candidates = [base];
  for (let i = 0; i < base.length; i++) if (base[i] === "-") candidates.push(base.slice(0, i) + ":" + base.slice(i + 1));
  return candidates.find((c) => productOf(c) !== null) || null;
}

export function emitKeys(dir) {
  const out = new Map();
  const unknown = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const key = keyOfFile(file);
    if (key === null) unknown.push(file);
    else out.set(key, JSON.parse(readFileSync(join(dir, file), "utf8")));
  }
  return { keys: out, unknown };
}

export const emitFile = (dir, key) => {
  const file = join(dir, "-" + key.replace(":", "-") + ".json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
};
