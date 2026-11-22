#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml } from "../scripts/feed-yaml.mjs";

export const GENERATOR = "tests/gen-feed-fixtures.mjs";
export const SPEC_FILE = "docs/uw-openapi.yaml";
export const FIXTURE_FILE = "tests/fixtures-feed-catalog.json";
export const TICKERS = Object.freeze(["SYX101", "SYX102"]);
export const DAY = "2026-10-02";
export const INSTANT = "2026-10-02T14:30:00Z";
export const CONTRACT = "SYX101261218C00100000";

const rootOf = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "#/components/schemas/";
const VERBS = ["get", "post", "put", "patch", "delete"];
const DECIMAL_TEXT = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;
const NAMES_AN_IDENTIFIER = /(?:^|_)(?:id|ids|identifier|cik|code|codes|symbol|cusip)$|type$/;
const TICKER_NAME = /^(?:ticker|tickers|ticker_symbol|ticker_symbols|symbol|symbols|underlying_symbol|underlying|npm_ticker)(?:\[\])?$/;
const PATTERN_SAMPLES = new Map([["^[0-9]{4}Q[1-4]$", "2026Q3"], ["^\\d{4}-(Q[1-4]|H[1-2]|MID|LATE|\\d{2}-\\d{2})$", "2026-Q3"]]);

const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const seedOf = (text) => createHash("sha256").update(text).digest().readUInt32BE(0);

function world(spec) {
  const pool = plain(spec.components) && plain(spec.components.schemas) ? spec.components.schemas : {};
  const trimmed = new Map(Object.keys(pool).map((k) => [k.trim(), k]));

  const follow = (schema, trail = []) => {
    let at = schema;
    const visited = [];
    while (plain(at) && typeof at.$ref === "string") {
      const wanted = at.$ref.slice(PREFIX.length);
      const key = Object.hasOwn(pool, wanted) ? wanted : trimmed.get(wanted.trim());
      if (key === undefined) throw new Error(`no component for ${at.$ref}`);
      if (trail.includes(key) || visited.includes(key)) return { at: null, trail: [...trail, ...visited], loop: true };
      visited.push(key);
      at = pool[key];
    }
    return { at: plain(at) ? at : null, trail: [...trail, ...visited], loop: false };
  };

  const shapeOf = (schema, trail = []) => {
    const got = follow(schema, trail);
    if (got.loop || got.at === null) return { kind: "any", trail: got.trail, nullable: false };
    const node = got.at;
    let nullable = node.nullable === true;
    const choices = node.oneOf || node.anyOf;
    const fragments = Array.isArray(node.allOf) ? node.allOf : [];
    let kind = node.type === "date" ? "string" : node.type;
    let format = node.type === "date" ? "date" : node.format === "date_time" ? "date-time" : node.format;
    let members = plain(node.properties) ? { ...node.properties } : null;
    let free = node.additionalProperties !== undefined && node.additionalProperties !== false;
    let stand = null;
    if (Array.isArray(choices)) {
      const live = [];
      for (const c of choices) {
        if (plain(c) && c.type === "null") { nullable = true; continue; }
        if (plain(c) && c.$ref === undefined && c.type === undefined && c.properties === undefined && c.items === undefined) continue;
        live.push(shapeOf(c, got.trail));
      }
      if (live.length === 1 && members === null && kind === undefined) stand = live[0];
      else if (live.length && live.every((l) => l.kind === "object")) {
        members = members || {};
        for (const l of live) {
          for (const [k, v] of Object.entries(l.members || {})) if (!Object.hasOwn(members, k)) members[k] = v;
          if (l.free || !l.members || !Object.keys(l.members).length) free = true;
        }
        kind = "object";
      } else if (live.length && members === null && kind === undefined) return { kind: "any", trail: got.trail, nullable };
    }
    for (const f of fragments) {
      const part = shapeOf(f, got.trail);
      if (part.nullable) nullable = true;
      if (part.kind === "object") {
        members = members || {};
        for (const [k, v] of Object.entries(part.members || {})) if (!Object.hasOwn(members, k)) members[k] = v;
        if (part.free) free = true;
        kind = kind || "object";
      } else if (kind === undefined && members === null && part.kind !== "any") stand = stand || part;
    }
    if (stand) return { ...stand, nullable: nullable || stand.nullable };
    if (kind === "array" || node.items !== undefined) return { kind: "array", trail: got.trail, nullable, each: node.items };
    if (kind === "object" || members !== null || free) return { kind: "object", trail: got.trail, nullable, members: members || {}, free };
    if (kind === "null") return { kind: "any", trail: got.trail, nullable: true };
    if (!["string", "integer", "number", "boolean"].includes(kind)) return { kind: "any", trail: got.trail, nullable };
    return { kind, trail: got.trail, nullable, format, options: Array.isArray(node.enum) ? node.enum : null, example: node.example, low: node.minimum, high: node.maximum, fallback: node.default, pattern: node.pattern };
  };

  const rootOf = (schema) => follow(schema).at;

  return { shapeOf, rootOf };
}

const kindSeen = (value) => (Array.isArray(value) ? "list" : plain(value) ? "object" : typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number"
  : typeof value === "string" && DECIMAL_TEXT.test(value) ? "numeric" : "text");

function seenAt(tops, where) {
  let layer = tops;
  for (const part of where.split(".")) {
    const name = part.replace(/(?:\[\])+$/, "");
    const depth = (part.length - name.length) / 2;
    if (name !== "") layer = layer.filter((v) => plain(v) && Object.hasOwn(v, name)).map((v) => v[name]);
    for (let i = 0; i < depth; i++) layer = layer.filter(Array.isArray).flat();
  }
  return [...new Set(layer.filter((v) => v !== null && v !== undefined).map(kindSeen))];
}

function wrapperShown(sample, members, freeForm) {
  if (Array.isArray(sample) && sample.length && sample.every(plain)) return { key: "data", bare: true, shown: false };
  if (plain(sample)) {
    const present = Object.keys(sample);
    const named = present.filter((k) => !Object.hasOwn(members, k) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && (Array.isArray(sample[k]) || plain(sample[k])));
    if (named.length === 1) return { key: named[0], bare: false, shown: true };
    if (present.length && (freeForm || present.some((k) => Object.hasOwn(members, k)))) return { key: "data", bare: false, shown: false, alone: true, ...(freeForm ? { keys: [...present].sort() } : {}) };
  }
  return { key: "data", bare: false, shown: false };
}

const inventKind = (value, name) => (Array.isArray(value) ? [] : plain(value) ? {} : typeof value === "boolean" ? true : typeof value === "number" ? 7 : value === null ? null : `sample ${name}`);

const carriesNumber = (shape, name) => shape.kind === "string" && shape.options === null && !["date", "date-time", "uuid"].includes(shape.format) &&
  typeof shape.example === "string" && DECIMAL_TEXT.test(shape.example) && !NAMES_AN_IDENTIFIER.test(name);

function inventScalar(shape, name, where, row) {
  const seed = seedOf(`${where}#${row}`);
  if (shape.kind === "any") return `sample ${name || "value"}`;
  if (shape.kind === "boolean") return row % 2 === 0;
  if (shape.kind === "integer") return 100 + (seed % 9000);
  if (shape.kind === "number") return (1000 + (seed % 900000)) / 100;
  if (shape.options) return shape.options[row % shape.options.length];
  if (shape.format === "date") return DAY;
  if (shape.format === "date-time") return INSTANT;
  if (shape.format === "uuid") return `00000000-0000-4000-8000-${String(seed % 1000000000000).padStart(12, "0")}`;
  if (carriesNumber(shape, name)) return ((1000 + (seed % 900000)) / 100).toFixed(2);
  if (TICKER_NAME.test(name)) return TICKERS[row % TICKERS.length];
  if (name === "option_symbol" || name === "option_chain_id") return CONTRACT;
  return `sample ${name || "text"} ${row + 1}`;
}

function inventBody(w, schema, name, where, row, trail, marks) {
  const shape = w.shapeOf(schema, trail);
  if (shape.kind === "array") {
    if (shape.each === undefined) return [];
    return [0, 1].map((r) => inventBody(w, shape.each, name, `${where}[]`, r, shape.trail, marks));
  }
  if (shape.kind === "object") {
    const out = {};
    const keys = Object.keys(shape.members).sort();
    if (!keys.length) return { sample_key: `sample ${name || "value"}` };
    for (const key of keys) out[key] = inventBody(w, shape.members[key], key, where === "" ? key : `${where}.${key}`, row, shape.trail, marks);
    return out;
  }
  if (shape.nullable && row === 1 && where.includes("[]")) { marks.nulls.add(where); return null; }
  const seen = marks.tops && shape.options === null ? seenAt(marks.tops, where) : [];
  const seed = seedOf(`${where}#${row}`);
  const figures = seen.length > 0 && seen.every((k) => k === "number" || k === "numeric");
  if (shape.kind === "string" && figures) {
    if (seen.includes("number")) return 100 + (seed % 9000);
    if (shape.format !== "uuid" && !NAMES_AN_IDENTIFIER.test(name)) { marks.numeric.add(where); return ((1000 + (seed % 900000)) / 100).toFixed(2); }
  }
  if (shape.kind === "string" && seen.includes("boolean")) return row % 2 === 0;
  if (shape.kind === "boolean" && seen.length > 0 && !(seen.length === 1 && seen[0] === "boolean")) return `sample ${name} ${row + 1}`;
  if (shape.kind === "string" && seen.length > 0 && !figures && carriesNumber(shape, name)) return `sample ${name} ${row + 1}`;
  if (carriesNumber(shape, name)) marks.numeric.add(where);
  return inventScalar(shape, name, where, row);
}

function inventParam(shape, name) {
  if (shape.pattern !== undefined) {
    if (!PATTERN_SAMPLES.has(shape.pattern)) throw new Error(`no sample for the parameter pattern ${shape.pattern}`);
    return PATTERN_SAMPLES.get(shape.pattern);
  }
  if (shape.options) return shape.options[0];
  if (shape.kind === "boolean") return true;
  if (shape.kind === "integer" || shape.kind === "number") {
    let value = typeof shape.fallback === "number" ? shape.fallback : typeof shape.low === "number" ? shape.low : shape.kind === "integer" ? 1 : 1.5;
    if (typeof shape.low === "number" && value < shape.low) value = shape.low;
    if (typeof shape.high === "number" && value > shape.high) value = shape.high;
    return value;
  }
  if (shape.format === "date") return DAY;
  if (shape.format === "date-time") return INSTANT;
  if (TICKER_NAME.test(name)) return TICKERS[0];
  if (name === "id") return CONTRACT;
  return `sample ${name.replace(/\[\]$/, "")}`;
}

function inventRequest(w, route, op) {
  const params = {};
  const required = {};
  const pairs = [];
  const pairsRequired = [];
  const segments = {};
  const elsewhere = [];
  for (const p of Array.isArray(op.parameters) ? op.parameters : []) {
    if (p.in !== "path" && p.in !== "query") { elsewhere.push(`${p.in} ${p.name}`); continue; }
    const shape = w.shapeOf(p.schema);
    let value;
    if (shape.kind === "array") {
      const each = shape.each === undefined ? { kind: "any" } : w.shapeOf(shape.each, shape.trail);
      value = each.options ? each.options.slice(0, 2) : TICKER_NAME.test(p.name) ? [...TICKERS] : [`sample ${p.name.replace(/\[\]$/, "")} a`, `sample ${p.name.replace(/\[\]$/, "")} b`];
    } else value = inventParam(shape, p.name);
    params[p.name] = value;
    const texts = (Array.isArray(value) ? value : [value]).map(String);
    if (p.in === "path") segments[p.name] = texts[0];
    else for (const t of texts) pairs.push([p.name, t]);
    if (p.required === true || p.in === "path") {
      required[p.name] = value;
      if (p.in !== "path") for (const t of texts) pairsRequired.push([p.name, t]);
    }
  }
  const built = route.split("/").map((part) => {
    const token = /^\{(.+)\}$/.exec(part);
    return token ? encodeURIComponent(segments[token[1]]) : part;
  }).join("/");
  const query = (list) => (list.length ? `?${new URLSearchParams(list).toString()}` : "");
  return { params, path: built, search: query(pairs), required, searchRequired: query(pairsRequired), ...(elsewhere.length ? { elsewhere } : {}) };
}

function socketFrames(spec) {
  const frames = {};
  for (const route of Object.keys(spec.paths).sort()) {
    const op = spec.paths[route].get;
    if (!plain(op) || !Array.isArray(op.tags) || !op.tags.includes("websocket")) continue;
    const text = String(op.description || "");
    const note = /documentation for (?:the )?websocket channels? ([^\n]*)/.exec(text);
    if (!note) continue;
    const named = [...note[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].replace(/:<TICKER>$/, ":<T>"));
    const samples = new Map();
    for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)) {
      let parsed;
      try { parsed = JSON.parse(m[1]); } catch { continue; }
      if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === "string" && plain(parsed[1])) {
        const family = parsed[0].split(":")[0];
        if (!samples.has(family)) samples.set(family, parsed[1]);
      } else if (plain(parsed) && !samples.has("")) samples.set("", parsed);
    }
    const families = [...new Set(named.map((n) => n.split(":")[0]))];
    for (const channel of named) {
      const family = channel.split(":")[0];
      const sample = samples.get(family) || (families.length === 1 ? samples.get("") || [...samples.values()][0] : undefined);
      if (!sample) continue;
      const numeric = [];
      const reshape = (value, key, where, row) => {
        if (value === null) return null;
        if (Array.isArray(value)) return value.length ? [reshape(value[0], key, `${where}[]`, 0), reshape(value[0], key, `${where}[]`, 1)] : [];
        if (typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, reshape(value[k], k, where === "" ? k : `${where}.${k}`, row)]));
        const seed = seedOf(`${channel} ${where}#${row}`);
        if (typeof value === "boolean") return row % 2 === 0;
        if (typeof value === "number") return Number.isInteger(value) ? 100 + (seed % 9000) : (1000 + (seed % 900000)) / 100;
        if (value === "") return "";
        if (key === "ticker" || key === "tickers" || key === "symbol" || key === "underlying_symbol") return TICKERS[0];
        if (DECIMAL_TEXT.test(value) && !NAMES_AN_IDENTIFIER.test(key)) { numeric.push(where); return ((1000 + (seed % 900000)) / 100).toFixed(2); }
        return `sample ${key} ${row + 1}`;
      };
      const payload = reshape(sample, "", "", 0);
      frames[channel] = { frame: [channel.replace("<T>", TICKERS[0]), payload], numeric: [...new Set(numeric)].sort() };
    }
  }
  return frames;
}

export function buildFixtures(specText) {
  const spec = parseYaml(specText);
  const w = world(spec);
  const ops = {};
  for (const route of Object.keys(spec.paths).sort()) {
    for (const verb of VERBS) {
      const op = spec.paths[route][verb];
      if (!plain(op)) continue;
      const key = `${verb.toUpperCase()} ${route}`;
      const entry = {};
      const socket = Array.isArray(op.tags) && op.tags.includes("websocket");
      if (!socket) entry.request = inventRequest(w, route, op);
      const ok = plain(op.responses) && plain(op.responses["200"]) && plain(op.responses["200"].content) ? op.responses["200"].content["application/json"] : undefined;
      if (plain(ok)) {
        const marks = { numeric: new Set(), nulls: new Set(), tops: null };
        const root = w.shapeOf(ok.schema);
        const node = w.rootOf(ok.schema);
        const sample = node ? node.example : undefined;
        const enveloped = root.kind === "object" && Object.hasOwn(root.members, "data");
        const rowDocumented = root.kind === "object" && !enveloped && Object.keys(root.members).length > 0;
        const wrap = enveloped ? { key: "data", bare: false, shown: false } : wrapperShown(sample, root.kind === "object" ? root.members : {}, !rowDocumented && root.kind !== "array");
        if (sample !== undefined && sample !== null) {
          const inner = !enveloped && wrap.shown ? sample[wrap.key] : sample;
          marks.tops = enveloped ? [sample] : [rowDocumented && !Array.isArray(inner) ? [inner] : inner];
        }
        let rows;
        if (enveloped) rows = null;
        else if (rowDocumented) rows = wrap.alone ? inventBody(w, ok.schema, "", "[]", 0, [], marks) : [0, 1].map((r) => inventBody(w, ok.schema, "", "[]", r, [], marks));
        else if (root.kind === "array") rows = root.each === undefined ? [...TICKERS] : [0, 1].map((r) => inventBody(w, root.each, "", "[]", r, root.trail, marks));
        else rows = wrap.keys ? Object.fromEntries(wrap.keys.map((k) => [k, inventKind(sample[k], k)])) : { sample_key: "sample value", sample_list: [1, 2] };
        const strip = (p) => (rowDocumented ? p.replace(/^\[\]\.?/, "") : p);
        entry.envelope = wrap.key;
        if (wrap.bare) entry.bare = true;
        if (wrap.alone) entry.unwrapped = true;
        if (wrap.keys) entry.exampleKeys = wrap.keys;
        entry.body = enveloped ? inventBody(w, ok.schema, "", "", 0, [], marks) : wrap.bare || wrap.alone ? rows : { [wrap.key]: rows };
        entry.numeric = [...marks.numeric].map(strip).sort();
        entry.nulls = [...marks.nulls].map(strip).sort();
      }
      ops[key] = entry;
    }
  }
  return {
    provenance: {
      generator: GENERATOR,
      spec: SPEC_FILE,
      specSha256: createHash("sha256").update(specText).digest("hex"),
      nature: "synthetic bodies built from the 200 response schema of every operation in the committed document, and synthetic socket frames built from the payload samples on its channel pages, with invented values and invented tickers; spec-derived, not observed on the wire, not data from the feed",
    },
    tickers: [...TICKERS],
    ops,
    channels: socketFrames(spec),
  };
}

export function renderFixtures(fixtures) {
  const lines = ["{", `"provenance": ${JSON.stringify(fixtures.provenance)},`, `"tickers": ${JSON.stringify(fixtures.tickers)},`, "\"ops\": {"];
  const keys = Object.keys(fixtures.ops);
  keys.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(fixtures.ops[k])}${i + 1 < keys.length ? "," : ""}`));
  lines.push("},", "\"channels\": {");
  const names = Object.keys(fixtures.channels);
  names.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(fixtures.channels[k])}${i + 1 < names.length ? "," : ""}`));
  lines.push("}", "}", "");
  return lines.join("\n");
}

export function main(argv, io = {}) {
  const out = io.out || ((line) => console.log(line));
  const err = io.err || ((line) => console.error(line));
  const root = io.root || rootOf();
  const text = renderFixtures(buildFixtures(readFileSync(path.join(root, SPEC_FILE), "utf8")));
  const target = path.join(root, FIXTURE_FILE);
  if (argv.includes("--check")) {
    let committed = null;
    try { committed = readFileSync(target, "utf8"); } catch { committed = null; }
    if (committed === text) { out(`${FIXTURE_FILE} is what ${SPEC_FILE} generates`); return 0; }
    err(`${FIXTURE_FILE} ${committed === null ? "is missing" : "differs from what the document generates"}; run node ${GENERATOR}`);
    return 1;
  }
  writeFileSync(target, text);
  out(`wrote ${FIXTURE_FILE}: ${Buffer.byteLength(text)} bytes`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
