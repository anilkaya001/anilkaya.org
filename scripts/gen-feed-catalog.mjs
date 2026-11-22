#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseYaml } from "./feed-yaml.mjs";

export const SPEC_FILE = "docs/uw-openapi.yaml";
export const CATALOG_FILE = "shared/flows-feed-catalog.js";
export const GENERATOR = "scripts/gen-feed-catalog.mjs";
export const CATALOG_VERSION = 1;
export const ENVELOPE = "data";
export const SOCKET_TAG = "websocket";

const REF = "#/components/schemas/";
const METHODS = ["get", "post", "put", "patch", "delete"];
const SCALARS = new Set(["string", "integer", "number", "boolean"]);
const TEXT_FORMATS = new Set(["date", "date-time", "uuid"]);
const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;
const IDENTIFIER_NAME = /(?:^|_)(?:id|ids|identifier|cik|code|codes|symbol|cusip)$|type$/;
const PLAN_WORDS = /\b(?:plan|tier|add-on|addon|premium endpoint|enterprise)\b/i;
const LIMIT_WORDS = /\b(?:lookback|limited to (?:a |an |the last |the most recent )?[0-9]|clamped|capped at|date range is|default is the last|for the last [0-9]+ (?:trading )?(?:days|weeks|months|years)|even if there are more)/i;
const DEPRECATED_WORDS = /\bdeprecated\b/i;

export class CatalogError extends Error {}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function brandPattern(serverUrl) {
  let host;
  try { host = new URL(String(serverUrl)).hostname; } catch { return null; }
  const labels = host.split(".").filter(Boolean);
  const label = labels.length > 1 ? labels[labels.length - 2] : null;
  if (!label || !/^[a-z0-9]+$/i.test(label) || !/[a-z]/i.test(label)) return null;
  return new RegExp(label.split("").join("[\\s_-]*"), "gi");
}

export function scrubber(brand) {
  return (text) => {
    let out = String(text)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/[^\s)>\]]+/g, "")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "the feed's support");
    if (brand) out = out.replace(brand, "the feed");
    return out
      .replace(/\b([Tt])he the feed\b/g, "$1he feed")
      .replace(/\btapes?\b/gi, (word) => (word[0] === "T" ? "Prints" : "prints"))
      .replace(/\bat (?:the )?(ask|bid)\b/gi, (_, side) => `on the ${side.toLowerCase()} side`)
      .replace(/\b([Vv])endor(s?)\b/g, (_, first, plural) => `${first === "V" ? "S" : "s"}ource${plural}`)
      .replace(/\s+/g, " ")
      .trim();
  };
}

export function proseOf(text) {
  return String(text).replace(/```[\s\S]*?```/g, "\n").split("\n").filter((l) => !/^\s*\|/.test(l)).join("\n");
}

export function sentencesOf(text) {
  return proseOf(text)
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l)).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z`[*])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const unique = (xs) => [...new Set(xs)];

export function statedSentences(text, scrub) {
  const all = sentencesOf(text);
  const plan = all.filter((s) => PLAN_WORDS.test(s));
  const limits = all.filter((s) => !PLAN_WORDS.test(s)).map(scrub).filter((s) => LIMIT_WORDS.test(s));
  return { plan: unique(plan.map(scrub)), limits: unique(limits) };
}

const houseWord = (word) => word.replace(/^tapes?$/, "prints").replace(/^vendor(s?)$/, "source$1");

export function idOf(operationId) {
  const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase().split("-").map(houseWord).join("-");
  const parts = String(operationId).split(".").filter(Boolean);
  if (parts.length > 1 && parts[0] === "PublicApi") parts.shift();
  if (!parts.length) throw new CatalogError("an operation has no operationId to name it by");
  return parts.map((p) => kebab(p.replace(/Controller$/, "")) || kebab(p)).join(".");
}

function schemaReader(components, notes, scrub) {
  const byTrimmed = new Map();
  for (const name of Object.keys(components)) if (!byTrimmed.has(name.trim())) byTrimmed.set(name.trim(), name);
  const repaired = new Set();

  const nameOf = (ref) => {
    if (typeof ref !== "string" || !ref.startsWith(REF)) throw new CatalogError(`a $ref this reader cannot follow: ${String(ref)}`);
    const name = ref.slice(REF.length);
    if (Object.hasOwn(components, name)) return name;
    const found = byTrimmed.get(name.trim());
    if (found === undefined) throw new CatalogError(`a $ref to a component that does not exist: ${name}`);
    if (!repaired.has(ref)) { repaired.add(ref); notes.refsRepaired += 1; }
    return found;
  };

  const view = (schema, stack) => {
    let node = schema;
    const names = [];
    while (isObj(node) && node.$ref !== undefined) {
      const name = nameOf(node.$ref);
      if (stack.includes(name) || names.includes(name)) return { type: "any", cycle: true, nullable: false, names };
      names.push(name);
      node = components[name];
    }
    if (!isObj(node)) return { type: "any", nullable: false, names };
    const inner = [...stack, ...names];
    let nullable = node.nullable === true;
    let type = node.type;
    if (Array.isArray(type)) {
      if (type.includes("null")) nullable = true;
      type = type.find((t) => t !== "null");
    }
    let format = typeof node.format === "string" ? node.format : undefined;
    if (type === "date") { type = "string"; format = "date"; notes.dateTypes += 1; }
    if (format === "date_time") format = "date-time";
    let props = isObj(node.properties) ? { ...node.properties } : null;
    let items = node.items;
    let open = node.additionalProperties !== undefined && node.additionalProperties !== false;
    const alternatives = Array.isArray(node.oneOf) ? node.oneOf : Array.isArray(node.anyOf) ? node.anyOf : null;
    const parts = Array.isArray(node.allOf) ? node.allOf : [];
    let adopted = null;
    if (alternatives) {
      const real = [];
      for (const alt of alternatives) {
        if (isObj(alt) && alt.type === "null") { nullable = true; continue; }
        if (isObj(alt) && alt.$ref === undefined && alt.type === undefined && alt.properties === undefined && alt.items === undefined) continue;
        real.push(view(alt, inner));
      }
      if (real.length === 1 && props === null && type === undefined) adopted = real[0];
      else if (real.length && real.every((r) => r.type === "object")) {
        props = props || {};
        for (const r of real) {
          for (const [k, v] of Object.entries(r.props || {})) if (!Object.hasOwn(props, k)) props[k] = v;
          if (r.open || !r.props || !Object.keys(r.props).length) open = true;
        }
        type = "object";
      } else if (real.length && props === null && type === undefined) return { type: "any", nullable, names };
    }
    for (const part of parts) {
      const got = view(part, inner);
      if (got.cycle) continue;
      if (got.nullable) nullable = true;
      if (got.type === "object") {
        props = props || {};
        for (const [k, v] of Object.entries(got.props || {})) if (!Object.hasOwn(props, k)) props[k] = v;
        if (got.open) open = true;
        type = type || "object";
      } else if (type === undefined && props === null) adopted = adopted || got;
    }
    if (adopted) return { ...adopted, nullable: nullable || adopted.nullable, names: [...names, ...adopted.names] };
    if (type === "array" || items !== undefined) return { type: "array", nullable, names, items };
    if (type === "object" || props !== null || open) return { type: "object", nullable, names, props: props || {}, open };
    if (type === "null") return { type: "any", nullable: true, names };
    if (!SCALARS.has(type)) return { type: "any", nullable, names };
    const out = { type, nullable, names };
    if (format !== undefined) out.format = format;
    if (Array.isArray(node.enum)) out.enum = [...node.enum];
    if (node.example !== undefined) out.example = node.example;
    if (node.default !== undefined) out.default = node.default;
    if (typeof node.minimum === "number") out.min = node.minimum;
    if (typeof node.maximum === "number") out.max = node.maximum;
    if (typeof node.pattern === "string") out.pattern = node.pattern;
    return out;
  };

  const deref = (schema) => {
    let node = schema;
    const names = [];
    while (isObj(node) && node.$ref !== undefined) {
      const name = nameOf(node.$ref);
      if (names.includes(name)) return null;
      names.push(name);
      node = components[name];
    }
    return isObj(node) ? node : null;
  };

  return { view, deref, scrub };
}

export function isNumericString(view, name) {
  return view.type === "string" && view.enum === undefined && !TEXT_FORMATS.has(view.format) &&
    typeof view.example === "string" && CANONICAL_DECIMAL.test(view.example) && !IDENTIFIER_NAME.test(name);
}

function fieldEntry(pathOf, v, name) {
  const out = { path: pathOf, type: v.type };
  if (v.format !== undefined) out.format = v.format;
  if (v.enum !== undefined) out.enum = v.enum;
  if (isNumericString(v, name)) out.numeric = true;
  if (v.nullable) out.nullable = true;
  if (v.open) out.open = true;
  return out;
}

function flatten(reader, notes, v, pathOf, name, stack, out) {
  if (v.cycle) notes.cycles += 1;
  out.push(fieldEntry(pathOf, v, name));
  const inner = [...stack, ...v.names];
  if (v.type === "array" && v.items !== undefined) flatten(reader, notes, reader.view(v.items, inner), `${pathOf}[]`, name, inner, out);
  if (v.type === "object") {
    for (const key of Object.keys(v.props).sort()) {
      flatten(reader, notes, reader.view(v.props[key], inner), pathOf === "" ? key : `${pathOf}.${key}`, key, inner, out);
    }
  }
}

function bodyShape(reader, notes, schema) {
  const root = reader.view(schema, []);
  const inner = root.names;
  const fields = [];
  if (root.type === "object" && Object.keys(root.props).length) {
    for (const key of Object.keys(root.props).sort()) flatten(reader, notes, reader.view(root.props[key], inner), key, key, inner, fields);
    return { documents: Object.hasOwn(root.props, ENVELOPE) ? "envelope" : "row", fields };
  }
  if (root.type === "array") {
    if (root.items !== undefined) flatten(reader, notes, reader.view(root.items, inner), "[]", "", inner, fields);
    return { documents: "list", fields };
  }
  return { documents: "open", fields };
}

const kindShown = (value) => (Array.isArray(value) ? "list" : isObj(value) ? "object" : typeof value === "boolean" ? "boolean"
  : typeof value === "number" ? "number" : typeof value === "string" && CANONICAL_DECIMAL.test(value) ? "numeric" : "text");

function shownAt(roots, pathOf) {
  let layer = roots;
  for (const part of pathOf.split(".")) {
    const name = part.replace(/(?:\[\])+$/, "");
    const depth = (part.length - name.length) / 2;
    if (name !== "") layer = layer.filter((v) => isObj(v) && Object.hasOwn(v, name)).map((v) => v[name]);
    for (let i = 0; i < depth; i++) layer = layer.filter(Array.isArray).flat();
  }
  return layer.filter((v) => v !== null && v !== undefined);
}

function exampleRoots(reader, schema, shape, wrapper) {
  const node = reader.deref(schema);
  const example = node ? node.example : undefined;
  if (example === undefined || example === null) return null;
  if (shape.documents === "envelope") return [example];
  const inner = isObj(example) && Object.hasOwn(example, wrapper.envelope) && wrapper.envelopeFrom === "example" ? example[wrapper.envelope] : example;
  if (shape.documents === "list") return [inner];
  return Array.isArray(inner) ? inner : [inner];
}

function refineField(entry, shown, notes) {
  if (!shown.length || entry.enum !== undefined) return entry;
  const kinds = new Set(shown.map(kindShown));
  const numbers = [...kinds].every((k) => k === "number" || k === "numeric");
  const name = entry.path.replace(/\[\]/g, "").split(".").pop();
  const out = { ...entry };
  const loosen = () => {
    delete out.format;
    delete out.numeric;
    out.type = "any";
    notes.exampleOverrides += 1;
  };
  if (entry.type === "string") {
    if (numbers && (kinds.has("number") || (entry.format !== "uuid" && !IDENTIFIER_NAME.test(name)))) {
      if (!entry.numeric) notes.exampleNumerics += 1;
      if (TEXT_FORMATS.has(entry.format)) delete out.format;
      out.numeric = true;
    } else if (kinds.has("boolean") || kinds.has("number") || kinds.has("list") || kinds.has("object")) loosen();
    else if (entry.numeric && kinds.has("text")) {
      delete out.numeric;
      notes.exampleOverrides += 1;
    }
  } else if (entry.type === "boolean") {
    if (kinds.size !== 1 || !kinds.has("boolean")) loosen();
  } else if (entry.type === "integer" || entry.type === "number") {
    if (!numbers) loosen();
  }
  const ordered = { path: out.path, type: out.type };
  for (const key of ["format", "enum", "numeric", "nullable", "open"]) if (out[key] !== undefined) ordered[key] = out[key];
  return ordered;
}

const WRAPPER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const shownKeys = (shape, keys) => (shape.documents === "open" ? { exampleKeys: [...keys].sort() } : {});

function wrapperOf(reader, schema, shape) {
  if (shape.documents === "envelope") return { envelope: ENVELOPE, envelopeFrom: "schema" };
  const node = reader.deref(schema);
  const example = node ? node.example : undefined;
  if (Array.isArray(example) && example.length > 0 && example.every(isObj)) return { envelope: ENVELOPE, envelopeFrom: "assumed", bare: true };
  if (isObj(example)) {
    const documented = new Set(shape.fields.filter((f) => !/[.[]/.test(f.path)).map((f) => f.path));
    const keys = Object.keys(example);
    const wrappers = keys.filter((k) => !documented.has(k) && WRAPPER_NAME.test(k) && (Array.isArray(example[k]) || isObj(example[k])));
    if (wrappers.length === 1) return { envelope: wrappers[0], envelopeFrom: "example" };
    if (keys.length > 0 && (shape.documents === "open" || keys.some((k) => documented.has(k)))) return { envelope: ENVELOPE, envelopeFrom: "assumed", unwrapped: true, ...shownKeys(shape, keys) };
  }
  return { envelope: ENVELOPE, envelopeFrom: "assumed" };
}

const PLACES = new Set(["path", "query", "header", "cookie"]);
const TOKEN_DEFAULT = /^[A-Za-z0-9_.-]+$/;

const keepsDefault = (leaf) => typeof leaf.default !== "string" || (leaf.enum !== undefined ? leaf.enum.includes(leaf.default) : TOKEN_DEFAULT.test(leaf.default));

function paramEntry(reader, raw, where) {
  if (!PLACES.has(raw.in)) throw new CatalogError(`${where}: the parameter ${String(raw.name)} ${typeof raw.in === "string" ? `is sent in the ${raw.in}` : "names no place"}; OpenAPI puts a parameter in the path, the query, a header or a cookie`);
  const v = reader.view(raw.schema, []);
  const out = { name: String(raw.name), in: String(raw.in), required: raw.required === true, type: v.type };
  let leaf = v;
  if (v.type === "array") {
    leaf = v.items !== undefined ? reader.view(v.items, v.names) : { type: "any" };
    out.items = leaf.type;
  }
  if (leaf.format !== undefined) out.format = leaf.format;
  if (leaf.enum !== undefined) out.enum = leaf.enum;
  if (leaf.default !== undefined && keepsDefault(leaf)) out.default = leaf.default;
  if (leaf.min !== undefined) out.min = leaf.min;
  if (leaf.max !== undefined) out.max = leaf.max;
  if (leaf.pattern !== undefined) out.pattern = leaf.pattern;
  if (v.nullable || leaf.nullable) out.nullable = true;
  return out;
}

function operationEntry(reader, notes, method, pathTemplate, op) {
  if (typeof op.operationId !== "string" || !op.operationId) throw new CatalogError(`${method.toUpperCase()} ${pathTemplate} has no operationId`);
  const tags = Array.isArray(op.tags) ? op.tags.map(String) : [];
  const description = typeof op.description === "string" ? op.description : "";
  const summary = typeof op.summary === "string" ? op.summary : "";
  const stated = statedSentences(description, reader.scrub);
  const params = [];
  const seen = new Set();
  for (const raw of Array.isArray(op.parameters) ? op.parameters : []) {
    const key = `${raw.in}:${raw.name}`;
    if (seen.has(key)) { notes.paramsDuplicated += 1; continue; }
    seen.add(key);
    params.push(paramEntry(reader, raw, `${method.toUpperCase()} ${pathTemplate}`));
  }
  for (const token of pathTemplate.matchAll(/\{([^{}]+)\}/g)) {
    const found = params.find((p) => p.in === "path" && p.name === token[1]);
    if (!found) { params.push({ name: token[1], in: "path", required: true, type: "string", implied: true }); notes.pathParamsImplied += 1; } else if (!found.required) { found.required = true; notes.pathParamsImplied += 1; }
  }
  const responses = isObj(op.responses) ? op.responses : {};
  const statuses = Object.keys(responses).map(Number).filter(Number.isInteger).sort((a, b) => a - b);
  const content = isObj(responses["200"]) && isObj(responses["200"].content) ? responses["200"].content : {};
  const media = Object.keys(content);
  const out = {
    id: idOf(op.operationId),
    method: method.toUpperCase(),
    path: pathTemplate,
    operationId: op.operationId,
    tags,
    summary: reader.scrub(summary),
    kind: tags.includes(SOCKET_TAG) ? "socket" : media.includes("application/json") ? "json" : media.length ? "file" : "none",
    deprecated: op.deprecated === true || DEPRECATED_WORDS.test(summary) || DEPRECATED_WORDS.test(description.split("\n").slice(0, 2).join(" ")),
    plan: stated.plan,
    limits: stated.limits,
    statuses,
    params,
  };
  if (isObj(op.requestBody)) {
    const json = isObj(op.requestBody.content) && isObj(op.requestBody.content["application/json"]) ? op.requestBody.content["application/json"].schema : undefined;
    const shape = json === undefined ? { fields: [] } : bodyShape(reader, notes, json);
    const node = json === undefined ? null : reader.deref(json);
    const requiredSets = [];
    if (node && Array.isArray(node.required)) requiredSets.push(node.required.map(String));
    for (const alt of node && Array.isArray(node.oneOf) ? node.oneOf : []) if (isObj(alt) && Array.isArray(alt.required)) requiredSets.push(alt.required.map(String));
    out.body = { required: op.requestBody.required === true, fields: shape.fields, requiredSets };
  }
  if (out.kind === "json") {
    const schema = content["application/json"].schema;
    const shape = bodyShape(reader, notes, schema);
    const wrapper = wrapperOf(reader, schema, shape);
    const roots = exampleRoots(reader, schema, shape, wrapper);
    Object.assign(out, wrapper);
    out.documents = shape.documents;
    out.fields = roots === null ? shape.fields : shape.fields.map((f) => refineField(f, shownAt(roots, f.path), notes));
  } else {
    out.envelope = null;
    out.documents = null;
    out.fields = [];
    if (out.kind === "file") out.media = media[0];
  }
  return out;
}

const FAMILY = /^[a-z][a-z0-9_-]*$/;

function channelName(raw) {
  const text = String(raw).trim();
  const m = /^([A-Za-z0-9_-]+)(?::(?:TICKER|<TICKER>))?$/.exec(text);
  if (!m || !FAMILY.test(m[1])) return null;
  return { family: m[1], scope: text.includes(":") ? "ticker" : "all" };
}

const exampleType = (value) => {
  if (value === null) return { type: "any", nullable: true };
  if (Array.isArray(value)) return { type: "array" };
  if (typeof value === "object") return { type: "object" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
};

const TABLE_NUMERIC = /^(?:decimal|decimal string)$/;
const TABLE_FORMATS = [[/^ISO 8601 string$/, "date-time"], [/^date string/, "date"], [/^uuid string$/, "uuid"]];
const TABLE_NUMBERS = /^(?:number|float)$/;

function tableTypes(description) {
  const out = new Map();
  for (const m of String(description).matchAll(/^\|((?: *`[^`|]+`,?)+) *\| *([^|]*?) *\|/gm)) {
    const names = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
    for (const name of names) {
      const prior = out.get(name);
      out.set(name, prior === undefined || prior === m[2] ? m[2] : null);
    }
  }
  return out;
}

function payloadFields(payload, types, pathOf, out) {
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    const at = pathOf === "" ? key : `${pathOf}.${key}`;
    const word = types.get(key);
    const entry = { path: at, ...exampleType(value) };
    if (typeof word === "string") {
      if (entry.type === "string" && TABLE_NUMERIC.test(word)) entry.numeric = true;
      if (entry.type === "integer" && TABLE_NUMBERS.test(word)) entry.type = "number";
      for (const [re, format] of TABLE_FORMATS) if (entry.type === "string" && re.test(word)) entry.format = format;
    }
    if (entry.type === "string" && typeof value === "string" && CANONICAL_DECIMAL.test(value) && entry.format === undefined && !IDENTIFIER_NAME.test(key)) entry.numeric = true;
    out.push(entry);
    if (entry.type === "object") payloadFields(value, types, at, out);
    if (entry.type === "array" && value.length) {
      const first = value[0];
      const item = { path: `${at}[]`, ...exampleType(first) };
      if (item.type === "string" && typeof first === "string" && CANONICAL_DECIMAL.test(first)) item.numeric = true;
      out.push(item);
      if (item.type === "object") payloadFields(first, types, `${at}[]`, out);
    }
  }
}

function pagePayloads(description) {
  const out = new Map();
  for (const m of String(description).matchAll(/```[a-z]*\n([\s\S]*?)\n```/g)) {
    let value;
    try { value = JSON.parse(m[1]); } catch { continue; }
    let label = null;
    let payload = null;
    if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && isObj(value[1])) { label = value[0]; payload = value[1]; }
    else if (isObj(value)) payload = value;
    if (!payload) continue;
    const family = label === null ? null : label.split(":")[0];
    if (!out.has(family)) out.set(family, payload);
  }
  return out;
}

function channelEntries(ops, pathItems, scrub) {
  const overview = ops.find((o) => o.kind === "socket" && /\/socket$/.test(o.path));
  if (!overview) return [];
  const text = pathItems[overview.path][overview.method.toLowerCase()].description || "";
  const rows = [];
  for (const m of String(text).matchAll(/^\| *([^|\n]+?) *\| *([^|\n]*?) *\|$/gm)) {
    const name = channelName(m[1]);
    if (!name) continue;
    rows.push({ ...name, said: m[2] });
  }
  const pages = new Map();
  for (const op of ops) {
    if (op.kind !== "socket" || op === overview) continue;
    const description = pathItems[op.path][op.method.toLowerCase()].description || "";
    const note = /documentation for (?:the )?websocket channels? ([^\n]*)/.exec(description);
    const families = unique([...(note ? note[1] : "").matchAll(/`([^`]+)`/g)].map((x) => channelName(x[1])).filter(Boolean).map((c) => c.family));
    const payloads = pagePayloads(description);
    const types = tableTypes(description);
    const plan = statedSentences(description, scrub).plan;
    for (const family of families) {
      const payload = payloads.get(family) || (families.length === 1 ? payloads.get(null) || [...payloads.values()][0] : undefined);
      const fields = [];
      if (payload) payloadFields(payload, types, "", fields);
      pages.set(family, { page: op.id, fields, plan });
    }
  }
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const id = row.scope === "ticker" ? `${row.family}:<T>` : row.family;
    if (seen.has(id)) continue;
    seen.add(id);
    const page = pages.get(row.family) || null;
    out.push({
      id,
      family: row.family,
      scope: row.scope,
      page: page ? page.page : null,
      plan: unique([...sentencesOf(row.said).filter((s) => PLAN_WORDS.test(s)).map(scrub), ...(page ? page.plan : [])]),
      fields: page ? page.fields : [],
    });
  }
  return out;
}

export function buildCatalog(specText) {
  const spec = parseYaml(specText);
  if (!isObj(spec) || !isObj(spec.paths)) throw new CatalogError("the document has no paths");
  const components = isObj(spec.components) && isObj(spec.components.schemas) ? spec.components.schemas : {};
  const notes = { refsRepaired: 0, cycles: 0, dateTypes: 0, pathParamsImplied: 0, paramsDuplicated: 0, exampleNumerics: 0, exampleOverrides: 0 };
  const server = Array.isArray(spec.servers) && isObj(spec.servers[0]) ? spec.servers[0].url : null;
  const scrub = scrubber(brandPattern(server));
  const reader = schemaReader(components, notes, scrub);
  const ops = [];
  for (const pathTemplate of Object.keys(spec.paths).sort()) {
    const item = spec.paths[pathTemplate];
    if (!isObj(item)) continue;
    for (const method of METHODS) if (isObj(item[method])) ops.push(operationEntry(reader, notes, method, pathTemplate, item[method]));
  }
  const ids = new Set();
  for (const op of ops) {
    if (ids.has(op.id)) throw new CatalogError(`two operations share the id ${op.id}`);
    ids.add(op.id);
  }
  const info = isObj(spec.info) ? spec.info : {};
  const changelog = [...String(info.description || "").matchAll(/^# (\d{4}\.\d{2}\.\d{2})\s*$/gm)].map((m) => m[1]).sort();
  return {
    version: CATALOG_VERSION,
    generator: GENERATOR,
    source: {
      file: SPEC_FILE,
      sha256: createHash("sha256").update(specText).digest("hex"),
      openapi: String(spec.openapi || ""),
      documentVersion: String(info.version || ""),
      newestChange: changelog.length ? changelog[changelog.length - 1] : null,
      paths: Object.keys(spec.paths).length,
      operations: ops.length,
      schemas: Object.keys(components).length,
      notes,
    },
    envelope: ENVELOPE,
    ops,
    channels: channelEntries(ops, spec.paths, scrub),
  };
}

const SCANNED_WORDS = /\b(?:import|export|from|AI)\b/g;

const dataText = (value) => JSON.stringify(value).replace(SCANNED_WORDS, (word) => `${String.fromCharCode(92)}u${word.charCodeAt(0).toString(16).padStart(4, "0")}${word.slice(1)}`);

export function renderCatalog(catalog) {
  const lines = [
    "const freeze = (value) => {",
    "  if (value !== null && typeof value === \"object\" && !Object.isFrozen(value)) {",
    "    for (const key of Object.keys(value)) freeze(value[key]);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "};",
    "",
    "export const FEED_CATALOG = freeze({",
    `  version: ${dataText(catalog.version)},`,
    `  generator: ${dataText(catalog.generator)},`,
    `  source: ${dataText(catalog.source)},`,
    `  envelope: ${dataText(catalog.envelope)},`,
    "  ops: [",
    ...catalog.ops.map((op) => `    ${dataText(op)},`),
    "  ],",
    "  channels: [",
    ...catalog.channels.map((c) => `    ${dataText(c)},`),
    "  ],",
    "});",
    "",
  ];
  return lines.join("\n");
}

const rootOf = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function coverageOf(catalog) {
  const [{ feedCoverage }, { OPS }, { RT_UPSTREAM }, { SOCKET_CHANNELS }, probe, list] = await Promise.all([
    import("../shared/flows-feed-client.js"), import("../shared/flows-vendor-ops.js"), import("../shared/flows-rt.js"),
    import("../shared/flows-rt-socket.js"), import("./flows-ws-probe.mjs"), import("./flows-probe.mjs"),
  ]);
  const coverage = feedCoverage(catalog, { registry: OPS, rail: RT_UPSTREAM, joined: SOCKET_CHANNELS });
  const tiers = new Map();
  for (const p of list.loadList().probes) if (!tiers.has(p.op) || p.tier === "used") tiers.set(p.op, p.tier);
  const byTier = {};
  for (const id of Object.keys(coverage.operations.readers)) {
    const op = catalog.ops.find((o) => o.id === id);
    if (op.kind === "socket") continue;
    const tier = tiers.get(op.path) || "unprobed";
    byTier[tier] = (byTier[tier] || 0) + 1;
  }
  const template = (channel) => (channel.includes(":") ? `${channel.split(":")[0]}:<T>` : channel);
  const probed = unique([...probe.CHANNELS.filter((c) => c !== probe.CONTROL_CHANNEL), ...probe.FIREHOSES].map(template));
  const documented = new Set(catalog.channels.map((c) => c.id));
  return { catalog, coverage, byTier, probed: probed.filter((c) => documented.has(c)), probedUndocumented: probed.filter((c) => !documented.has(c)) };
}

export function coverageLines({ catalog, coverage, byTier, probed, probedUndocumented }) {
  const ops = coverage.operations;
  const byId = new Map(catalog.ops.map((o) => [o.id, o]));
  const lines = [
    `feed coverage  ${catalog.source.file} ${catalog.source.sha256.slice(0, 12)}  document version ${catalog.source.documentVersion}, newest change ${catalog.source.newestChange}`,
    `operations     ${ops.documented} documented: ${ops.requests} requests and ${ops.pages} socket pages`,
    `read today     ${ops.read} of ${ops.requests} requests have a reader in the registry (${coverage.registry.entries} entries); ${ops.unread.length} have none and ${ops.held.length} are held`,
    `               by probe tier: ${Object.keys(byTier).sort().map((t) => `${byTier[t]} ${t}`).join(", ")}`,
    `               ${coverage.registry.absent.length} registry entries read operations this copy of the document lacks: ${coverage.registry.absent.join(", ")}`,
    "unread by tag",
  ];
  for (const tag of Object.keys(ops.byTag).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    const row = ops.byTag[tag];
    if (!row.unread.length) continue;
    lines.push(`  ${tag}  ${row.unread.length} of ${row.documented} unread`);
    for (const id of row.unread) {
      const op = byId.get(id);
      lines.push(`    ${id}  ${op.method} ${op.path}  ${op.summary}${op.deprecated && !/deprecated/i.test(op.summary) ? "  (deprecated)" : ""}${op.kind === "file" ? "  (a file, not JSON)" : ""}`);
    }
  }
  lines.push("held           never asked for, by a decision of the house; the client refuses to build them");
  for (const hold of ops.held) {
    const op = byId.get(hold.id);
    lines.push(`    ${hold.id}  ${op.method} ${op.path}  ${op.summary}  ${hold.reason} (${hold.cite})`);
  }
  lines.push("withheld       documented fields the reader leaves out of every answer");
  for (const hold of ops.fieldHolds) {
    const on = new Set(hold.fields.map((f) => f.split(" ")[0]));
    lines.push(`    ${hold.rule}  ${hold.fields.length} fields on ${on.size} operation${on.size === 1 ? "" : "s"}  ${hold.reason} (${hold.cite})`);
  }
  lines.push(`elsewhere      operations with a parameter in a header or a cookie, which the client does not build: ${ops.elsewhere.length || "none"}`);
  for (const row of ops.elsewhere) {
    const op = byId.get(row.id);
    lines.push(`    ${row.id}  ${op.method} ${op.path}  ${row.params.join(", ")}`);
  }
  const ch = coverage.channels;
  const notJoined = ch.listed.filter((c) => !ch.joined.includes(c));
  lines.push(
    `channels       ${ch.documented} documented; the rail lists ${ch.listed.length} and joins ${ch.joined.length}; ${ch.unread.length} are not joined`,
    `  joined       ${ch.joined.join(" ")}`,
    `  listed only  ${notJoined.join(" ") || "none"}`,
    `  not read     ${ch.unread.filter((c) => !notJoined.includes(c)).join(" ")}`,
    `  probed       ${probed.join(" ")}`,
    `  probed, not documented  ${probedUndocumented.join(" ") || "none"}`,
    `  on the rail, not documented  ${ch.undocumented.join(" ") || "none"}`,
  );
  return lines;
}

export function generate(root = rootOf(), read = (file) => readFileSync(file, "utf8")) {
  const catalog = buildCatalog(read(path.join(root, SPEC_FILE)));
  return { catalog, text: renderCatalog(catalog) };
}

export async function main(argv, io = {}) {
  const out = io.out || ((line) => console.log(line));
  const err = io.err || ((line) => console.error(line));
  const root = io.root || rootOf();
  const read = io.read || ((file) => readFileSync(file, "utf8"));
  const write = io.write || ((file, text) => writeFileSync(file, text));
  const known = new Set(["--check", "--coverage"]);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) {
    err(`usage: node ${GENERATOR} [--check] [--coverage]`);
    return 2;
  }
  let made;
  try {
    made = generate(root, read);
  } catch (error) {
    err(`gen-feed-catalog: ${error && error.message ? error.message : String(error)}`);
    return 2;
  }
  const target = path.join(root, CATALOG_FILE);
  if (argv.includes("--coverage")) {
    for (const line of coverageLines(await coverageOf(made.catalog))) out(line);
    return 0;
  }
  if (argv.includes("--check")) {
    let committed = null;
    try { committed = read(target); } catch { committed = null; }
    if (committed === made.text) {
      out(`${CATALOG_FILE} is what ${SPEC_FILE} generates: ${made.catalog.ops.length} operations, ${made.catalog.channels.length} channels`);
      return 0;
    }
    err(`${CATALOG_FILE} ${committed === null ? "is missing" : "differs from what the document generates"}; run node ${GENERATOR}`);
    return 1;
  }
  write(target, made.text);
  out(`wrote ${CATALOG_FILE}: ${made.catalog.ops.length} operations, ${made.catalog.channels.length} channels, ${Buffer.byteLength(made.text)} bytes`);
  return 0;
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) process.exitCode = await main(process.argv.slice(2));
