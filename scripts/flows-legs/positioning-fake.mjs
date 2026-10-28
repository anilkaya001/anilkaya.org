import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OPS } from "../../shared/flows-vendor-ops.js";
import { touch } from "./taint.mjs";

const FIXTURE = fileURLToPath(new URL("../../tests/fixtures-positioning-vendor.json", import.meta.url));

let loaded = null;

export function positioningFixture() {
  touch("positioning-fake");
  if (loaded === null) loaded = JSON.parse(readFileSync(FIXTURE, "utf8"));
  return loaded;
}

const compile = (path) => {
  const names = [];
  const source = path.split("/").map((seg) => {
    const m = /^\{([a-z_]+)\}$/.exec(seg);
    if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    names.push(m[1]);
    return "([^/]+)";
  }).join("/");
  return { re: new RegExp("^" + source + "$"), names };
};

const MATCHERS = OPS.filter((o) => o.path.startsWith("/api/")).map((o) => ({ id: o.id, ...compile(o.path) }))
  .sort((a, b) => a.names.length - b.names.length || b.re.source.length - a.re.source.length);

export function positioningRoute(path) {
  for (const m of MATCHERS) {
    const hit = m.re.exec(path);
    if (hit) return { id: m.id, params: Object.fromEntries(m.names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) };
  }
  return null;
}

const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const pick = (table, key) => {
  if (Object.hasOwn(table, key)) return table[key];
  const keys = Object.keys(table).sort();
  return keys.length ? table[keys[hash(key) % keys.length]] : { data: [] };
};

export function fakePositioningUw() {
  const fx = positioningFixture();
  return async function uw(path) {
    touch("positioning-fake");
    const hit = positioningRoute(path);
    if (!hit) throw new Error(`${path} -> HTTP 404`);
    const entry = fx.ops[hit.id];
    if (!entry) throw new Error(`${path} -> HTTP 404`);
    if (entry.body) return entry.body;
    if (entry.byName) return Object.hasOwn(entry.byName, hit.params.name) ? entry.byName[hit.params.name] : { data: [] };
    if (entry.bySector) return Object.hasOwn(entry.bySector, hit.params.sector) ? entry.bySector[hit.params.sector] : { data: [] };
    if (entry.byId) return pick(entry.byId, hit.params.politician_id);
    if (entry.byTicker) return pick(entry.byTicker, hit.params.ticker || "");
    return { data: [] };
  };
}
