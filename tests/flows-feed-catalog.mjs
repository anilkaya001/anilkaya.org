import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadMutated } from "./truth/mutants.mjs";
import { closure, treeFiles, importsOf, moduleSource, parseImports } from "./lib/source-scan.mjs";
import { bindingReads } from "./lib/ai-guard.mjs";
import { servedFiles } from "./lib/served-tree.mjs";
import * as generator from "../scripts/gen-feed-catalog.mjs";
import * as yaml from "../scripts/feed-yaml.mjs";
import * as feed from "../shared/flows-feed-client.js";
import { FEED_CATALOG } from "../shared/flows-feed-catalog.js";
import * as fixtureGenerator from "./gen-feed-fixtures.mjs";
import { digestSpec, diffDigests } from "../scripts/uw-spec-diff.mjs";
import { OPS, pathFor } from "../shared/flows-vendor-ops.js";
import { VENDOR_BASE_DEFAULT, vendorUrl, unwrap } from "../shared/flows-vendor-core.js";
import { RT_UPSTREAM } from "../shared/flows-rt.js";
import { SOCKET_CHANNELS, parseMessage, channelTopic } from "../shared/flows-rt-socket.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const SPEC = read(generator.SPEC_FILE);
const ORACLE = JSON.parse(read("tests/fixtures-feed-catalog-oracle.json"));
const FIXTURES = JSON.parse(read(fixtureGenerator.FIXTURE_FILE));
const OBSERVATION = JSON.parse(read("scripts/flows-probe-shapes.json"));
const SHAPES = OBSERVATION.ops;
const BRAND = generator.brandPattern(VENDOR_BASE_DEFAULT);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const fixedNumber = (n) => {
  const text = n.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" || text === "" ? "0" : text;
};
const canon = (v) => (v === null ? "null" : v === true ? "true" : v === false ? "false" : typeof v === "number" ? `#${fixedNumber(v)}` : typeof v === "string" ? JSON.stringify(v)
  : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`);
const digest = (v) => sha256(Buffer.from(canon(v), "utf8")).slice(0, 16);
const treeText = (v) => (Array.isArray(v) ? `[${v.map(treeText).join(",")}]` : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${treeText(v[k])}`).join(",")}}` : JSON.stringify(v));

function scannedOperations(specText) {
  const lines = specText.split("\n");
  const start = lines.indexOf("paths:");
  const found = [];
  let route = null;
  let routes = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length && !line.startsWith(" ")) break;
    const p = /^ {2}(?:'([^']+)'|"([^"]+)"|(\/[^\s:]+)):\s*$/.exec(line);
    if (p) { route = p[1] || p[2] || p[3]; routes++; continue; }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m && route) found.push(`${m[1].toUpperCase()} ${route}`);
  }
  return { routes, operations: found };
}

const refusal = (fn) => {
  try { fn(); } catch (error) {
    return error && error.name === "FeedRequestError" ? { param: error.param, reason: error.reason, message: error.message } : { param: null, reason: `threw ${error && error.name}`, message: String(error && error.message) };
  }
  return null;
};

const valuesAt = (roots, fieldPath) => {
  let layer = roots;
  for (const part of fieldPath.split(".")) {
    const name = part.replace(/(\[\])+$/, "");
    const depth = (part.length - name.length) / 2;
    if (name !== "") layer = layer.filter(isObj).map((v) => v[name]);
    for (let i = 0; i < depth; i++) layer = layer.filter(Array.isArray).flat();
  }
  return layer;
};

const sameShape = (a, b, numericLeaves, where = "") => {
  if (a === null || b === null) return a === b ? null : `${where}: a null became ${JSON.stringify(b)}`;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return `${where}: a list changed length`;
    for (let i = 0; i < a.length; i++) { const bad = sameShape(a[i], b[i], numericLeaves, `${where}[]`); if (bad) return bad; }
    return null;
  }
  if (isObj(a)) {
    if (!isObj(b) || Object.keys(a).join() !== Object.keys(b).join()) return `${where}: the keys changed`;
    for (const k of Object.keys(a)) { const bad = sameShape(a[k], b[k], numericLeaves, where === "" ? k : `${where}.${k}`); if (bad) return bad; }
    return null;
  }
  if (numericLeaves.has(where) && typeof a === "string") return typeof b === "number" && b === Number(a) ? null : `${where}: the numeric string ${a} came back as ${JSON.stringify(b)}`;
  return a === b ? null : `${where}: ${JSON.stringify(a)} came back as ${JSON.stringify(b)}`;
};

function catalogProblems(gen, { specText = SPEC } = {}) {
  const problems = [];
  const need = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  let catalog;
  try { catalog = gen.buildCatalog(specText); } catch (error) { return [`the generator threw: ${error.message}`]; }
  const scanned = scannedOperations(specText);
  const keys = catalog.ops.map((o) => `${o.method} ${o.path}`);
  need(JSON.stringify(keys.slice().sort()) === JSON.stringify(scanned.operations.slice().sort()), `the catalog's operations are not the document's: ${keys.length} against ${scanned.operations.length} counted on the document's own lines`);
  need(catalog.source.paths === scanned.routes && catalog.source.operations === scanned.operations.length, "the source block does not carry the document's path and operation counts");
  need(catalog.source.sha256 === sha256(specText), "the source block does not carry the document's sha256");
  need(new Set(catalog.ops.map((o) => o.id)).size === catalog.ops.length, "two operations share an id");

  const digestOf = digestSpec(specText);
  need(Object.keys(digestOf.ops).length === catalog.ops.length, "the existing document reader counts another number of operations");
  const scrub = generator.scrubber(generator.brandPattern(VENDOR_BASE_DEFAULT));
  for (const o of catalog.ops) {
    const key = `${o.method} ${o.path}`;
    const old = digestOf.ops[key];
    if (!old) { problems.push(`${key} is not an operation the existing document reader finds`); continue; }
    need(old.id === o.operationId, `${key}: the operationId differs from the existing reader's`);
    need(o.id === generator.idOf(o.operationId) && /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(o.id), `${key}: the id ${o.id} is not the operationId's stable form`);
    const mine = o.params.filter((p) => !p.implied).map((p) => `${p.in}:${p.name}=${p.required}`).sort().join(",");
    const theirs = Object.entries(old.params).map(([k, v]) => `${k}=${v}`).sort().join(",");
    need(mine === theirs, `${key}: the parameters or their required flags differ from the existing reader's`);
    if (o.kind !== "socket") need(JSON.stringify(o.plan) === JSON.stringify([...new Set(old.plan.map(scrub))]), `${key}: the plan sentences differ from the existing reader's`);
    need(o.deprecated === (old.deprecated || /\bdeprecated\b/i.test(o.summary)), `${key}: the deprecation differs from the existing reader's`);

    const want = ORACLE.ops[key];
    if (!want) { problems.push(`${key} is not in the oracle`); continue; }
    need(digest([o.kind, o.statuses, o.documents, o.envelope, o.envelopeFrom ?? null, o.bare === true]) === want.shape, `${key}: kind, statuses, what the schema documents or how the answer is wrapped differ from the oracle`);
    need(digest(o.params) === want.params, `${key}: the typed parameters differ from the oracle (${o.params.length} against ${want.n[0]})`);
    need(digest(o.fields) === want.fields, `${key}: the response fields differ from the oracle (${o.fields.length} against ${want.n[1]})`);
    need((o.body === undefined) === (want.body === undefined) && (o.body === undefined || digest(o.body) === want.body), `${key}: the request body differs from the oracle`);

    const paths = o.fields.map((f) => f.path);
    need(new Set(paths).size === paths.length, `${key}: a response field is listed twice`);
    for (const f of o.fields) {
      if (f.numeric) need(f.type === "string", `${key}: ${f.path} is marked numeric and is not a string`);
      if (f.numeric) need(!/(?:^|_)(?:id|ids|identifier|cik|code|codes|symbol|cusip)$|type$/.test(f.path.replace(/\[\]/g, "").split(".").pop()), `${key}: ${f.path} names an identifier and is marked numeric`);
    }
    need(o.kind === "json"
      ? typeof o.envelope === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(o.envelope) && ["schema", "example", "assumed"].includes(o.envelopeFrom) && ["envelope", "row", "list", "open"].includes(o.documents) &&
        (o.documents !== "envelope" || (o.envelope === catalog.envelope && o.envelopeFrom === "schema")) && (o.bare === undefined || (o.bare === true && o.documents !== "envelope" && o.envelopeFrom === "assumed"))
      : o.envelope === null && o.envelopeFrom === undefined && o.bare === undefined && o.documents === null && o.fields.length === 0, `${key}: the wrapper and the kind disagree`);
    for (const token of o.path.matchAll(/\{([^{}]+)\}/g)) need(o.params.some((p) => p.in === "path" && p.name === token[1] && p.required), `${key}: the path token ${token[1]} has no required path parameter`);
  }
  const count = (f) => catalog.ops.reduce((n, o) => n + f(o), 0);
  const counted = {
    operations: catalog.ops.length, json: count((o) => Number(o.kind === "json")), file: count((o) => Number(o.kind === "file")), socket: count((o) => Number(o.kind === "socket")),
    none: count((o) => Number(o.kind === "none")), params: count((o) => o.params.length), fields: count((o) => o.fields.length),
    numeric: count((o) => o.fields.filter((f) => f.numeric).length), nullable: count((o) => o.fields.filter((f) => f.nullable).length),
    paths: catalog.source.paths, schemas: catalog.source.schemas, channels: catalog.channels.length,
  };
  need(JSON.stringify(Object.keys(counted).sort().map((k) => [k, counted[k]])) === JSON.stringify(Object.keys(ORACLE.counts).sort().map((k) => [k, ORACLE.counts[k]])), `the totals differ from the oracle's: ${JSON.stringify(counted)}`);

  const byId = new Map(catalog.ops.map((o) => [o.id, o]));
  need(JSON.stringify(catalog.channels.map((c) => c.id).sort()) === JSON.stringify(Object.keys(ORACLE.channels).sort()), "the channels are not the ones the oracle reads off the document");
  for (const c of catalog.channels) {
    const want = ORACLE.channels[c.id];
    if (!want) continue;
    const page = c.page === null ? null : byId.has(c.page) ? byId.get(c.page).path : "?";
    need(digest([c.family, c.scope, page]) === want.shape, `channel ${c.id}: family, scope or page differ from the oracle`);
    need(digest(c.fields) === want.fields, `channel ${c.id}: the payload fields differ from the oracle (${c.fields.length} against ${want.n})`);
    need(c.id === (c.scope === "ticker" ? `${c.family}:<T>` : c.family), `channel ${c.id}: the id is not the family and its scope`);
  }
  const documented = new Map(catalog.channels.map((c) => [c.id, c]));
  for (const [topic, row] of Object.entries(RT_UPSTREAM)) {
    for (const channel of row.channels) {
      const c = documented.get(channel);
      need(Boolean(c) && (c.scope === "ticker") === channel.endsWith(":<T>"), `the rail's topic ${topic} lists ${channel}, which the catalog does not document in that form`);
    }
  }
  for (const [topic, row] of Object.entries(SOCKET_CHANNELS)) {
    const c = documented.get(row.template);
    need(Boolean(c) && (c.scope === "ticker") === (row.scope === "ticker"), `the hub joins ${row.template} for ${topic}, which the catalog does not document with that scope`);
    need(Boolean(c) && c.fields.length > 0, `the hub joins ${row.template}, and the catalog holds no payload field for it`);
  }

  for (const [view, name, want] of NUMERIC_CASES) need(gen.isNumericString(view, name) === want, `a ${JSON.stringify(view)} named ${name} ${want ? "is not marked as a number in text" : "is marked as a number in text"}`);
  for (const [operationId, want] of ID_CASES) {
    let got;
    try { got = gen.idOf(operationId); } catch (error) { got = error instanceof gen.CatalogError ? "refused" : `threw ${error.name}`; }
    need(got === want, `the operationId ${JSON.stringify(operationId)} is named ${got}, not ${want}`);
  }
  for (const [url, want] of BRAND_CASES) {
    const made = gen.brandPattern(url);
    need((made === null ? null : made.source) === want, `the provider's name is read off ${url} as ${made && made.source}`);
  }
  const tinyScrub = gen.scrubber(gen.brandPattern(TINY.servers[0].url));
  for (const [raw, want] of SCRUB_CASES) need(tinyScrub(raw) === want, `the sentence ${JSON.stringify(raw)} is kept as ${JSON.stringify(tinyScrub(raw))}`);
  for (const [raw, want] of STATED_CASES) need(JSON.stringify(gen.statedSentences(raw, tinyScrub)) === JSON.stringify(want), `the plan and limit sentences of ${JSON.stringify(raw)} are ${JSON.stringify(gen.statedSentences(raw, tinyScrub))}`);
  let tiny = null;
  try { tiny = gen.buildCatalog(yaml.dumpYaml(TINY)); } catch (error) { problems.push(`the generator threw on the small document: ${error.message}`); }
  if (tiny) {
    need(canon({ ...tiny.source, sha256: null, file: null }) === canon(TINY_CATALOG.source), `the small document's source block is ${JSON.stringify(tiny.source)}`);
    need(canon(tiny.ops) === canon(TINY_CATALOG.ops), `the small document's operations are ${JSON.stringify(tiny.ops)}`);
    need(canon(tiny.channels) === canon(TINY_CATALOG.channels), `the small document's channels are ${JSON.stringify(tiny.channels)}`);
  }
  for (const [title, edit, want] of WRAPPER_CASES) {
    const doc = structuredClone(TINY);
    edit(doc.components.schemas["Tiny row "]);
    let made = null;
    try { made = gen.buildCatalog(yaml.dumpYaml(doc)).ops.find((o) => o.method === "GET" && o.path === "/api/tiny/{name}/rows") || { envelope: "no such operation" }; } catch (error) { made = { envelope: String(error.message) }; }
    need(canon({ envelope: made.envelope, envelopeFrom: made.envelopeFrom, ...(made.bare === undefined ? {} : { bare: made.bare }) }) === canon(want), `${title}: the answer is taken to be wrapped as ${JSON.stringify([made.envelope, made.envelopeFrom, made.bare])}`);
  }
  for (const [title, edit] of REFUSED_DOCUMENTS) {
    const doc = structuredClone(TINY);
    edit(doc);
    let refused = false;
    try { gen.buildCatalog(yaml.dumpYaml(doc)); } catch (error) { refused = error instanceof gen.CatalogError; }
    need(refused, `a document with ${title} is not refused`);
  }

  const text = gen.renderCatalog(catalog);
  const proseOnly = JSON.stringify([catalog.ops.map((o) => [o.summary, o.plan, o.limits]), catalog.channels.map((c) => c.plan)]);
  need(!BRAND.test(text), "the provider is named in the catalog"); BRAND.lastIndex = 0;
  need(!/https?:\/\//.test(text) && !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(proseOnly), "the catalog carries an address");
  for (const [what, rendered, made] of [["catalog", text, catalog], ["small document's catalog", tiny ? gen.renderCatalog(tiny) : "", tiny]]) {
    if (!made) continue;
    const literals = rendered.match(/"(?:[^"\\\n]|\\.)*"/g) || [];
    need(!literals.some((lit) => /\btapes?\b/i.test(lit) && /\s/.test(lit)), `a sentence in the ${what} uses a word the house rules retire`);
    need(!/\bat (?:the )?(?:ask|bid)\b/i.test(rendered), `a sentence in the ${what} says at the ask or at the bid`);
    need(!literals.some((lit) => /(?<![\w./@:$\\-])[Vv]endor(?:'s|s'|s)?(?![\w/@(-]|\.\w)/.test(lit) && /\s/.test(lit)), `a sentence in the ${what} names the source by its trade`);
    let imports;
    try { imports = parseImports(rendered, what); } catch (error) { imports = [String(error.message)]; }
    need(imports.length === 0, `the repository's import scanner reads the ${what}'s data as a module statement: ${JSON.stringify(imports).slice(0, 160)}`);
    const guard = bindingReads([what], () => rendered);
    need(guard.reads.length === 0 && guard.tests.length === 0, `the model-call guard reads the ${what}'s data as the model binding: ${JSON.stringify(guard.reads.concat(guard.tests)).slice(0, 160)}`);
    let evaluated = null;
    try { evaluated = new Function(`${rendered.replace("export const FEED_CATALOG = ", "const FEED_CATALOG = ")}\nreturn FEED_CATALOG;`)(); } catch (error) { evaluated = String(error.message); }
    need(canon(evaluated) === canon(made), `the rendered ${what} does not evaluate to the catalog that was built`);
  }
  const lines = text.split("\n");
  need(lines.filter((l) => l.startsWith("    {\"id\":")).length === catalog.ops.length + catalog.channels.length, "the rendered module does not hold one operation or channel a line");
  const verbs = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  need(catalog.ops.every((o, i, all) => i === 0 || all[i - 1].path < o.path || (all[i - 1].path === o.path && verbs.indexOf(all[i - 1].method) < verbs.indexOf(o.method))), "the operations are not in the order of their paths");
  return problems;
}

async function checkProblems(gen) {
  const problems = [];
  const need = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const fresh = gen.renderCatalog(gen.buildCatalog(SPEC));
  const edited = SPEC.replace("  /api/stock/{ticker}/max-pain:\n", "  /api/stock/{ticker}/max-pain-v2:\n");
  const stale = generator.renderCatalog(generator.buildCatalog(edited));
  const run = async (argv, files) => {
    const written = [];
    const lines = [];
    const code = await gen.main(argv, {
      root: "/virtual", out: (l) => lines.push(l), err: (l) => lines.push(l),
      read: (file) => { const rel = path.relative("/virtual", file); if (!Object.hasOwn(files, rel)) throw new Error("ENOENT"); return files[rel]; },
      write: (file, body) => written.push([path.relative("/virtual", file), body]),
    });
    return { code, written, lines };
  };
  const current = await run(["--check"], { [generator.SPEC_FILE]: SPEC, [generator.CATALOG_FILE]: fresh });
  need(current.code === 0 && current.written.length === 0, "--check does not pass the catalog the document generates");
  need((await run(["--check"], { [generator.SPEC_FILE]: SPEC, [generator.CATALOG_FILE]: stale })).code === 1, "--check passes a stale catalog (one built before an operation was renamed)");
  need((await run(["--check"], { [generator.SPEC_FILE]: SPEC, [generator.CATALOG_FILE]: `${fresh}\n` })).code === 1, "--check passes a catalog with a byte added");
  need((await run(["--check"], { [generator.SPEC_FILE]: SPEC })).code === 1, "--check passes with no catalog committed");
  need((await run(["--check"], { [generator.SPEC_FILE]: edited, [generator.CATALOG_FILE]: fresh })).code === 1, "--check passes when the document moved and the catalog did not");
  const wrote = await run([], { [generator.SPEC_FILE]: SPEC });
  need(wrote.code === 0 && wrote.written.length === 1 && wrote.written[0][0] === generator.CATALOG_FILE && wrote.written[0][1] === fresh, "a plain run does not write exactly the catalog the document generates");
  need((await run(["--bogus"], { [generator.SPEC_FILE]: SPEC })).code === 2, "an unknown flag is not a usage error");
  need((await run(["--check"], { [generator.SPEC_FILE]: "openapi: 3.0.0\n", [generator.CATALOG_FILE]: fresh })).code === 2, "a document with no paths is not refused");
  return problems;
}

const MINI = Object.freeze({
  version: 1, generator: "test", source: {}, envelope: "data", channels: [
    { id: "px:<T>", family: "px", scope: "ticker", page: null, plan: [], fields: [{ path: "close", type: "string", numeric: true }, { path: "ticker", type: "string" }, { path: "time", type: "integer" }, { path: "legs", type: "array" }, { path: "legs[]", type: "object" }, { path: "legs[].k", type: "string", numeric: true }] },
    { id: "all", family: "all", scope: "all", page: null, plan: [], fields: [] },
  ],
  ops: [
    { id: "t.rows", method: "GET", path: "/x/{name}/rows", kind: "json", params: [
      { name: "name", in: "path", required: true, type: "string" }, { name: "side", in: "query", required: false, type: "string", enum: ["call", "put"] },
      { name: "limit", in: "query", required: false, type: "integer", min: 1, max: 500, default: 50 }, { name: "ratio", in: "query", required: false, type: "number", min: 0, max: 1 },
      { name: "live", in: "query", required: false, type: "boolean" }, { name: "day", in: "query", required: true, type: "string", format: "date" },
      { name: "tags[]", in: "query", required: false, type: "array", items: "string", enum: ["a", "b", "c"] }, { name: "ids", in: "query", required: false, type: "array", items: "integer" },
      { name: "quarter", in: "query", required: false, type: "string", pattern: "^[0-9]{4}Q[1-4]$" }, { name: "free", in: "query", required: false, type: "any" },
    ], envelope: "data", documents: "row", fields: [
      { path: "any", type: "any" }, { path: "b", type: "boolean" }, { path: "f", type: "number", nullable: true }, { path: "id", type: "string" }, { path: "legs", type: "array" }, { path: "legs[]", type: "object" },
      { path: "legs[].k", type: "string", numeric: true }, { path: "meta", type: "object", open: true }, { path: "n", type: "integer" }, { path: "px", type: "string", numeric: true }, { path: "s", type: "string" },
    ] },
    { id: "t.env", method: "GET", path: "/x/env", kind: "json", params: [], envelope: "data", documents: "envelope", fields: [{ path: "data", type: "array" }, { path: "data[]", type: "object" }, { path: "data[].v", type: "string", numeric: true }, { path: "date", type: "string" }] },
    { id: "t.list", method: "GET", path: "/x/list", kind: "json", params: [], envelope: "data", documents: "list", fields: [{ path: "[]", type: "string" }] },
    { id: "t.open", method: "GET", path: "/x/open", kind: "json", params: [], envelope: "data", documents: "open", fields: [] },
    { id: "t.chain", method: "GET", path: "/x/chain", kind: "json", params: [], envelope: "chains", documents: "row", fields: [{ path: "px", type: "string", numeric: true }] },
    { id: "t.wired", method: "GET", path: "/x/wired", kind: "json", params: [], envelope: "data", documents: "row", fields: [{ path: "flag", type: "string" }, { path: "px", type: "string", numeric: true }] },
    { id: "t.file", method: "GET", path: "/x/file/{day}", kind: "file", params: [{ name: "day", in: "path", required: true, type: "string", format: "date" }], envelope: null, documents: null, fields: [] },
    { id: "t.page", method: "GET", path: "/x/socket/px", kind: "socket", params: [], envelope: null, documents: null, fields: [] },
    { id: "t.write", method: "POST", path: "/x/write", kind: "json", params: [], body: { required: false, fields: [{ path: "name", type: "string" }, { path: "status", type: "string", enum: ["active", "paused"] }, { path: "config", type: "object" }, { path: "input", type: "string" }], requiredSets: [["name", "config"], ["name", "input"]] }, envelope: "data", documents: "open", fields: [] },
  ],
});

function clientProblems(lib, catalog = FEED_CATALOG) {
  const problems = [];
  const need = (cond, msg) => { checks++; if (!cond) problems.push(msg); };
  const same = (a, b, msg) => need(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} is not ${JSON.stringify(b)}`);
  let client;
  let documented;
  let mini;
  try { client = lib.createFeedClient(catalog); documented = lib.createFeedClient(catalog, { wire: {} }); mini = lib.createFeedClient(MINI, { wire: MINI_WIRE }); } catch (error) { return [`the client could not be made: ${error.message}`]; }
  const refused = (fn, param, reason, msg) => { const r = refusal(fn); need(r !== null && r.param === param && r.reason === reason, `${msg}: wanted a refusal naming ${param} (${reason}), got ${r ? `${r.param} (${r.reason})` : "a built request"}`); };

  same(mini.request("t.rows", { name: "a b", day: "2026-10-02" }), { id: "t.rows", method: "GET", path: "/x/a%20b/rows", query: [["day", "2026-10-02"]], search: "?day=2026-10-02" }, "a request is the method, the path with its parameter encoded, and the query");
  for (const hostile of ["A/B", "BRK.B", "a b", "x?y=1#z", "50%", "é", "..", "{name}"]) {
    const built = mini.request("t.rows", { name: hostile, day: "2026-10-02" });
    need(built.path === `/x/${encodeURIComponent(hostile)}/rows` && built.path.split("/").length === 4 && decodeURIComponent(built.path.split("/")[2]) === hostile, `the path parameter ${hostile} is not encoded as one segment (${built.path})`);
  }
  same(mini.request("t.rows", { name: "n", day: "2026-10-02", side: "put", limit: 500, ratio: 0.25, live: false, "tags[]": ["a", "c"], ids: [3, 4], quarter: "2026Q3", free: "z y" }).query,
    [["side", "put"], ["limit", "500"], ["ratio", "0.25"], ["live", "false"], ["day", "2026-10-02"], ["tags[]", "a"], ["tags[]", "c"], ["ids", "3"], ["ids", "4"], ["quarter", "2026Q3"], ["free", "z y"]], "the query is in the documented order, a list repeats its name");
  need(mini.request("t.rows", { name: "n", day: "2026-10-02", "tags[]": ["a", "c"], free: "z y" }).search === "?day=2026-10-02&tags%5B%5D=a&tags%5B%5D=c&free=z+y", "the search string is not form-encoded");
  same(mini.request("t.rows", { name: "n", day: "2026-10-02", side: undefined, limit: null, "tags[]": [], free: "" }).query, [["day", "2026-10-02"]], "an absent, null or empty optional parameter is left out");
  refused(() => mini.request("t.rows", { day: "2026-10-02" }), "name", "missing", "a missing path parameter");
  refused(() => mini.request("t.rows", { name: "", day: "2026-10-02" }), "name", "missing", "an empty path parameter");
  refused(() => mini.request("t.rows", { name: "n" }), "day", "missing", "a missing required query parameter");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", side: "both" }), "side", "enum", "a value outside the enum");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", "tags[]": ["a", "z"] }), "tags[]", "enum", "a list item outside the enum");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", "tags[]": "a" }), "tags[]", "type", "a scalar where a list is documented");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", ids: [1, "2"] }), "ids", "type", "a string in a list of integers");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", limit: "50" }), "limit", "type", "a string where an integer is documented");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", limit: 1.5 }), "limit", "type", "a fraction where an integer is documented");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", limit: 0 }), "limit", "min", "an integer below the minimum");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", limit: 501 }), "limit", "max", "an integer above the maximum");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", ratio: Number.NaN }), "ratio", "type", "a number that is not finite");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", ratio: 1.01 }), "ratio", "max", "a number above the maximum");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", live: "true" }), "live", "type", "a string where a boolean is documented");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-02-30" }), "day", "format", "a day that is not on the calendar");
  refused(() => mini.request("t.rows", { name: "n", day: "02/10/2026" }), "day", "format", "a day in another notation");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", quarter: "Q3 2026" }), "quarter", "pattern", "a value outside the documented pattern");
  refused(() => mini.request("t.rows", { name: 7, day: "2026-10-02" }), "name", "type", "a number where a string is documented");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02", sdie: "put" }), "sdie", "unknown", "a parameter the operation does not document");
  refused(() => mini.request("t.rows", "name=n"), null, "params", "parameters that are not an object");
  refused(() => mini.request("t.nope", {}), null, "unknown-operation", "an operation that is not in the catalog");
  refused(() => mini.request("t.page", {}), null, "not-a-request", "a socket page asked for as a request");
  refused(() => mini.request("t.write", {}), null, "write", "a write built without being asked for");
  refused(() => mini.request("t.write", {}, { write: true, body: { name: "n" } }), "config", "missing", "a body that satisfies no required set");
  refused(() => mini.request("t.write", {}, { write: true, body: { name: "n", input: "x", status: "gone" } }), "status", "enum", "a body value outside the enum");
  refused(() => mini.request("t.write", {}, { write: true, body: { name: "n", input: "x", extra: 1 } }), "extra", "unknown", "a body field that is not documented");
  refused(() => mini.request("t.write", {}, { write: true, body: { name: 5, input: "x" } }), "name", "type", "a body value of another type");
  refused(() => mini.request("t.rows", { name: "n", day: "2026-10-02" }, { body: { a: 1 } }), null, "body", "a body given to an operation that takes none");
  same(mini.request("t.write", {}, { write: true, body: { name: "n", input: "x", status: "paused" } }), { id: "t.write", method: "POST", path: "/x/write", query: [], search: "", body: { name: "n", input: "x", status: "paused" } }, "a write that is asked for is built with its body");
  same(mini.request("t.file", { day: "2026-10-02" }).path, "/x/file/2026-10-02", "a file operation is a request like any other");

  const got = (id, body) => mini.read(id, body);
  const rows = (row) => ({ data: [row] });
  same(got("t.rows", rows({ px: "12.50", n: "7", f: null, s: "x", b: true, id: "007", legs: [{ k: "1e3" }, { k: null }], meta: { z: "1" }, any: "0012", extra: "1" })),
    { ok: true, data: [{ px: 12.5, n: 7, f: null, s: "x", b: true, id: "007", legs: [{ k: 1000 }, { k: null }], meta: { z: "1" }, any: "0012", extra: "1" }], rows: [{ px: 12.5, n: 7, f: null, s: "x", b: true, id: "007", legs: [{ k: 1000 }, { k: null }], meta: { z: "1" }, any: "0012", extra: "1" }], meta: {}, undocumented: ["extra"] },
    "a row is read: numeric strings become numbers, a null stays null, an identifier stays text, a free-form object and an untyped field pass through, an undocumented key is kept and named");
  for (const [value, want, why] of [["", null, "an empty numeric string is an absent value"], [null, null, "a null stays null"], [0, 0, "a zero stays zero"], ["0", 0, "the string 0 is zero"], ["-0.0", 0, "minus zero is zero"],
    ["9007199254740991", 9007199254740991, "the largest exact integer is read"], ["-12.5e-1", -1.25, "an exponent is read"], [3.5, 3.5, "a number where a numeric string is documented is a number"]]) {
    const r = got("t.rows", rows({ px: value, s: "k" }));
    need(r.ok === true && Object.is(r.rows[0].px, want), `${why}: ${JSON.stringify(value)} read as ${r.ok ? JSON.stringify(r.rows[0].px) : r.reason}`);
  }
  for (const value of ["abc", "1,234", " 12", "12 ", "0012", "+1", ".5", "1.", "NaN", "Infinity", "1e400", "9007199254740993", "0x10", true, {}, []]) {
    same(got("t.rows", rows({ px: value, s: "k" })), { ok: false, reason: "type:px" }, `a numeric field holding ${JSON.stringify(value)} is named, not guessed`);
  }
  const absent = got("t.rows", rows({ s: "only" }));
  need(absent.ok === true && !Object.hasOwn(absent.rows[0], "px") && !Object.hasOwn(absent.rows[0], "n") && Object.keys(absent.rows[0]).join() === "s", "an absent field is invented by the reader");
  same(got("t.rows", rows({ n: "x" })), { ok: false, reason: "type:n" }, "a non-numeric string where an integer is documented");
  same(got("t.rows", rows({ n: 7.5 })).ok, true, "a fraction where an integer is documented is still a number");
  same(got("t.rows", rows({ s: 5 })), { ok: false, reason: "type:s" }, "a number where text is documented");
  same(got("t.rows", rows({ b: "true" })), { ok: false, reason: "type:b" }, "a string where a boolean is documented");
  same(got("t.rows", rows({ legs: {} })), { ok: false, reason: "type:legs" }, "an object where a list is documented");
  same(got("t.rows", rows({ legs: [5] })), { ok: false, reason: "type:legs[]" }, "a scalar where a row is documented");
  same(got("t.rows", rows({ legs: [{ k: [] }] })), { ok: false, reason: "type:legs[].k" }, "a list where a nested numeric is documented");
  same(got("t.rows", rows({ meta: 5 })), { ok: false, reason: "type:meta" }, "a scalar where an object is documented");
  for (const body of ["text", null, undefined, 5, [1], [null], [[{ px: "1" }]], { rows: [] }, { data: 5 }, { data: "x" }, { data: [1] }, { data: [null] }]) same(got("t.rows", body), { ok: false, reason: "unshaped" }, `the body ${JSON.stringify(body)} is not the documented shape`);
  for (const body of [{ data: [] }, { data: null }, { data: {} }, []]) same(got("t.rows", body), { ok: false, reason: "empty" }, `the body ${JSON.stringify(body)} holds no row`);
  same(got("t.rows", [{ px: "1.5", s: "bare" }]), { ok: true, data: [{ px: 1.5, s: "bare" }], rows: [{ px: 1.5, s: "bare" }], meta: {}, undocumented: [] }, "a bare list of rows is the rows");
  same(got("t.list", ["a"]), { ok: true, data: ["a"], rows: ["a"], meta: {}, undocumented: [] }, "a bare documented list is read");
  same(got("t.env", [{ v: "1" }]), { ok: false, reason: "unshaped" }, "a bare list where the document describes the whole answer");
  same(got("t.chain", { chains: [{ px: "2.5" }] }), { ok: true, data: [{ px: 2.5 }], rows: [{ px: 2.5 }], meta: {}, undocumented: [] }, "an answer under the key the document shows is read");
  same(got("t.chain", { data: [{ px: "2.5" }] }), { ok: false, reason: "unshaped" }, "the same answer under another key is not");
  same(got("t.wired", { si: [{ flag: true, px: "3" }] }), { ok: true, data: [{ flag: true, px: 3 }], rows: [{ flag: true, px: 3 }], meta: {}, undocumented: [] }, "an observed wrapper and a field the wire types otherwise are read as observed");
  same(got("t.wired", { data: [{ flag: "x", px: "3" }] }), { ok: false, reason: "unshaped" }, "the documented wrapper is not accepted where another was observed");
  same(got("t.wired", { si: [{ flag: true, px: "x" }] }), { ok: false, reason: "type:px" }, "the other fields of an observed operation keep their types");
  same([mini.envelope("t.wired"), mini.envelope("t.chain"), mini.envelope("t.rows")], ["si", "chains", "data"], "the client says which key it unwraps");
  same(lib.createFeedClient(MINI, { wire: {} }).read("t.wired", { data: [{ flag: true, px: "3" }] }), { ok: false, reason: "type:flag" }, "without the observation the declared type is held");
  same(lib.createFeedClient(MINI, { wire: {} }).read("t.wired", { data: [{ flag: "y", px: "3" }] }).ok, true, "and the documented wrapper is the one read");
  same(got("t.rows", { data: { px: "1", s: "one" }, has_more: false }), { ok: true, data: { px: 1, s: "one" }, rows: [{ px: 1, s: "one" }], meta: { has_more: false }, undocumented: [] }, "a single row is one row, and what sits beside the envelope is kept");
  same(got("t.env", { data: [{ v: "1.5" }, { v: "" }], date: "2026-10-02", more: 1 }), { ok: true, data: [{ v: 1.5 }, { v: null }], rows: [{ v: 1.5 }, { v: null }], meta: { date: "2026-10-02", more: 1 }, undocumented: ["more"] }, "a documented envelope is read whole");
  same(got("t.env", { date: "2026-10-02" }), { ok: false, reason: "unshaped" }, "a documented envelope without its data");
  same(got("t.env", { data: { v: "1" } }), { ok: false, reason: "type:data" }, "an object where the envelope documents a list");
  same(got("t.env", { data: [{ v: "1" }], date: 20261002 }), { ok: false, reason: "type:date" }, "a mistyped field beside the envelope");
  same(got("t.list", { data: ["a", "b"] }), { ok: true, data: ["a", "b"], rows: ["a", "b"], meta: {}, undocumented: [] }, "a documented list is read");
  same(got("t.list", { data: ["a", 1] }), { ok: false, reason: "type:[]" }, "a mistyped list item");
  same(got("t.list", { data: {} }), { ok: false, reason: "unshaped" }, "an object where a list is documented");
  same(got("t.open", { data: { anything: [1, "2", null] } }), { ok: true, data: { anything: [1, "2", null] }, rows: [{ anything: [1, "2", null] }], meta: {}, undocumented: [] }, "a free-form answer passes through untouched");
  same(got("t.open", { data: 7 }), { ok: false, reason: "unshaped" }, "a scalar where a free-form answer is documented");
  refused(() => mini.read("t.file", {}), null, "not-a-request", "a file read as JSON");
  const polluted = JSON.parse("{\"data\":[{\"__proto__\":{\"x\":1},\"px\":\"1\",\"s\":\"k\"}]}");
  const clean = got("t.rows", polluted);
  need(clean.ok && Object.getPrototypeOf(clean.rows[0]) === Object.prototype && Object.hasOwn(clean.rows[0], "__proto__") && clean.rows[0].x === undefined, "a __proto__ key reaches the prototype");
  const input = rows({ px: "1.50", legs: [{ k: "2" }] });
  const before = JSON.stringify(input);
  got("t.rows", input);
  need(JSON.stringify(input) === before, "reading changes the body it was given");

  same(mini.join("px:<T>", "SYX101"), { channel: "px:SYX101", message: "{\"channel\":\"px:SYX101\",\"msg_type\":\"join\"}" }, "a per-name channel is joined with its name");
  same(mini.join("all"), { channel: "all", message: "{\"channel\":\"all\",\"msg_type\":\"join\"}" }, "a channel for every name is joined as it is");
  refused(() => mini.join("px:<T>"), "ticker", "ticker", "a per-name channel joined without a name");
  refused(() => mini.join("px:<T>", "syx101"), "ticker", "ticker", "a name not in capitals");
  refused(() => mini.join("px:<T>", "A B"), "ticker", "ticker", "a name with a space");
  refused(() => mini.join("all", "SYX101"), "ticker", "ticker", "a name given to a channel that takes none");
  refused(() => mini.join("nope"), null, "unknown-channel", "a channel the document does not list");
  same(mini.frame("[\"px:SYX101\",{\"close\":\"12.50\",\"ticker\":\"SYX101\",\"time\":5,\"legs\":[{\"k\":\"\"}],\"new\":1}]"),
    { ok: true, kind: "data", channel: "px:<T>", family: "px", ticker: "SYX101", payload: { close: 12.5, ticker: "SYX101", time: 5, legs: [{ k: null }], new: 1 }, undocumented: ["new"] }, "a frame is read through its channel");
  same(mini.frame(["px:SYX101", { response: {}, status: "ok" }]), { ok: true, kind: "ack", channel: "px:SYX101", status: "ok" }, "an acknowledgement is not data");
  for (const text of ["not json", "{}", "[1,2]", "[\"px:SYX101\"]", "[\"px:SYX101\",5]", "[\"nope\",{\"a\":1}]", "[\"px:syx\",{\"a\":1}]", "[\"px\",{\"a\":1}]"]) same(mini.frame(text), { ok: false, reason: "unshaped" }, `the frame ${text} is not a documented frame`);
  same(mini.frame("[\"px:SYX101\",{}]"), { ok: false, reason: "empty" }, "a frame with an empty payload");
  same(mini.frame("[\"px:SYX101\",{\"close\":{}}]"), { ok: false, reason: "type:close" }, "a mistyped payload field");
  refused(() => lib.createFeedClient({ ...MINI, version: 2 }).op("t.rows"), null, "threw Error", "a catalog of another version");

  for (const o of catalog.ops) {
    const key = `${o.method} ${o.path}`;
    const fx = FIXTURES.ops[key];
    if (!fx) { problems.push(`${key} has no fixture`); continue; }
    if (o.kind === "socket") { refused(() => client.request(o.id, {}), null, "not-a-request", `${key}: a socket page`); continue; }
    const options = o.method === "GET" ? undefined : { write: true, body: fx.requestBody };
    let built;
    try { built = client.request(o.id, fx.request.params, options); } catch (error) { problems.push(`${key}: the fixture's parameters are refused (${error.message})`); continue; }
    need(built.method === o.method && built.path === fx.request.path && built.search === fx.request.search, `${key}: the request is not the one the fixture generator builds (${built.path}${built.search})`);
    const lean = client.request(o.id, fx.request.required, options);
    need(lean.path === fx.request.path && lean.search === fx.request.searchRequired, `${key}: the request with only its required parameters differs (${lean.path}${lean.search})`);
    const template = o.path.split("/");
    const segments = built.path.split("/");
    need(segments.length === template.length && !/[{}]/.test(built.path) && template.every((part, i) => {
      const token = /^\{(.+)\}$/.exec(part);
      return token ? decodeURIComponent(segments[i]) === String(fx.request.params[token[1]]) : part === segments[i];
    }), `${key}: a path parameter is not exactly one segment of ${built.path}`);
    const url = new URL(VENDOR_BASE_DEFAULT + built.path + built.search);
    need(url.pathname === built.path && JSON.stringify([...url.searchParams]) === JSON.stringify(built.query), `${key}: the request does not survive being parsed as a URL`);
    if (!o.params.some((p) => p.type === "array")) {
      const scalars = Object.fromEntries(o.params.filter((p) => p.in === "query" && fx.request.params[p.name] !== undefined).map((p) => [p.name, fx.request.params[p.name]]));
      need(vendorUrl(VENDOR_BASE_DEFAULT, built.path, scalars).href === url.href, `${key}: the request differs from the one the existing URL builder makes`);
    }
    for (const p of o.params) {
      const without = { ...fx.request.params };
      delete without[p.name];
      if (p.required) refused(() => client.request(o.id, without, options), p.name, "missing", `${key} without ${p.name}`);
      else need(refusal(() => client.request(o.id, without, options)) === null, `${key}: leaving out the optional ${p.name} is refused`);
      const leaf = p.type === "array" ? p.items : p.type;
      const wrap = (v) => ({ ...fx.request.params, [p.name]: p.type === "array" ? [v] : v });
      if (p.enum !== undefined) refused(() => client.request(o.id, wrap(leaf === "integer" || leaf === "number" ? 987654321 : "not a documented value"), options), p.name, "enum", `${key}: ${p.name} outside its enum`);
      if (leaf === "integer") refused(() => client.request(o.id, wrap("7"), options), p.name, "type", `${key}: ${p.name} given as text`);
      if (leaf === "number") refused(() => client.request(o.id, wrap("0.5"), options), p.name, "type", `${key}: ${p.name} given as text`);
      if (leaf === "boolean") refused(() => client.request(o.id, wrap("true"), options), p.name, "type", `${key}: ${p.name} given as text`);
      if (leaf === "string") refused(() => client.request(o.id, wrap(7), options), p.name, "type", `${key}: ${p.name} given as a number`);
      if (p.type === "array") refused(() => client.request(o.id, { ...fx.request.params, [p.name]: "one" }, options), p.name, "type", `${key}: ${p.name} given as one value`);
      if (p.min !== undefined && p.enum === undefined) refused(() => client.request(o.id, wrap(p.min - 1), options), p.name, "min", `${key}: ${p.name} below its minimum`);
      if (p.max !== undefined && p.enum === undefined) refused(() => client.request(o.id, wrap(p.max + 1), options), p.name, "max", `${key}: ${p.name} above its maximum`);
      if (p.format === "date" && p.enum === undefined) refused(() => client.request(o.id, wrap("2026-02-30"), options), p.name, "format", `${key}: ${p.name} given a day that does not exist`);
      if (p.pattern !== undefined) refused(() => client.request(o.id, wrap("no match"), options), p.name, "pattern", `${key}: ${p.name} outside its pattern`);
      if (p.in === "path" && leaf === "string" && p.enum === undefined && p.format === undefined && p.pattern === undefined) {
        const hostile = client.request(o.id, wrap("A/B c?#"), options);
        need(hostile.path.split("/").length === template.length && hostile.path.includes(encodeURIComponent("A/B c?#")), `${key}: ${p.name} is not encoded as one segment`);
      }
    }
    refused(() => client.request(o.id, { ...fx.request.params, no_such_parameter: 1 }, options), "no_such_parameter", "unknown", `${key} with an undocumented parameter`);
    if (o.method !== "GET") refused(() => client.request(o.id, fx.request.params), null, "write", `${key} without write`);

    if (o.kind !== "json") { refused(() => client.read(o.id, {}), null, "not-a-request", `${key}: a file read as JSON`); continue; }
    const result = documented.read(o.id, fx.body);
    if (!result.ok) { problems.push(`${key}: the fixture does not read back (${result.reason})`); continue; }
    need(fx.envelope === o.envelope && (fx.bare === true) === (o.bare === true), `${key}: the catalog and the fixture generator disagree on how the answer is wrapped (${o.envelope} against ${fx.envelope})`);
    const numeric = new Set(o.fields.filter((f) => f.type === "integer" || f.type === "number" || f.numeric).map((f) => f.path));
    const marked = o.fields.filter((f) => f.numeric).map((f) => f.path);
    need(fx.numeric.every((p) => marked.includes(p)), `${key}: the fixture generator finds numbers in text where the catalog marks none (${fx.numeric.filter((p) => !marked.includes(p))})`);
    const nullable = new Set(o.fields.filter((f) => f.nullable).map((f) => f.path));
    need(fx.nulls.every((p) => nullable.has(p)), `${key}: the fixture holds a null where the catalog documents none`);
    const enveloped = o.documents === "envelope";
    const inner = enveloped ? fx.body[o.envelope] : fx.bare ? fx.body : fx.body[fx.envelope];
    const whole = enveloped ? Object.fromEntries(Object.keys(fx.body).map((k) => [k, k === o.envelope ? result.data : result.meta[k]])) : result.data;
    const compared = o.documents === "row" ? new Set([...numeric].map((p) => `[].${p}`)) : numeric;
    const bad = o.documents === "open" ? (JSON.stringify(result.data) === JSON.stringify(inner) ? null : "a free-form answer changed") : sameShape(enveloped ? fx.body : inner, whole, compared);
    need(bad === null, `${key}: the fixture did not read back faithfully (${bad})`);
    const roots = o.documents === "row" ? result.rows : [whole];
    const sources = o.documents === "row" ? inner : [enveloped ? fx.body : inner];
    for (const p of marked) {
      const before = valuesAt(sources, p).filter((v) => v !== null);
      const after = valuesAt(roots, p).filter((v) => v !== null);
      need(before.length > 0 && after.length === before.length && after.every((v) => typeof v === "number") && before.every((v) => typeof v === (fx.numeric.includes(p) ? "string" : "number")), `${key}: ${p} is marked as a number in text and the fixture or the reader disagrees`);
    }
    for (const p of fx.nulls) need(valuesAt(roots, p).some((v) => v === null), `${key}: the null at ${p} did not survive`);
    need(!JSON.stringify(result).includes("undefined") && result.undocumented.length === 0, `${key}: the reader names undocumented keys in a fixture built from the document (${result.undocumented.slice(0, 3)})`);
    if (fx.envelope === catalog.envelope && !fx.bare) need(Array.isArray(unwrap(fx.body)) === Array.isArray(result.data), `${key}: the reader and the existing unwrap disagree on the container`);
    need(documented.read(o.id, { not_the_wrapper: inner }).ok === false, `${key}: an answer wrapped under another key is read`);
    if (fx.bare) need(documented.read(o.id, { [o.envelope]: fx.body }).ok === true, `${key}: the same rows under the usual key are not read`);
    need(result.rows.length === (Array.isArray(result.data) ? result.data.length : 1), `${key}: rows is not the list of rows`);
  }

  for (const c of catalog.channels) {
    const fx = FIXTURES.channels[c.id];
    if (c.scope === "ticker") {
      const joined = client.join(c.id, FIXTURES.tickers[0]);
      need(joined.channel === `${c.family}:${FIXTURES.tickers[0]}` && joined.message === JSON.stringify({ channel: joined.channel, msg_type: "join" }), `channel ${c.id}: the join message is not the one the hub sends`);
      refused(() => client.join(c.id), "ticker", "ticker", `channel ${c.id} joined without a name`);
    } else {
      need(client.join(c.id).channel === c.id && client.join(c.id).message === JSON.stringify({ channel: c.id, msg_type: "join" }), `channel ${c.id}: the join message is not the one the hub sends`);
      refused(() => client.join(c.id, FIXTURES.tickers[0]), "ticker", "ticker", `channel ${c.id} joined with a name`);
    }
    if (!fx) { need(c.fields.length === 0, `channel ${c.id} has payload fields and no fixture frame`); continue; }
    const text = JSON.stringify(fx.frame);
    const frame = client.frame(text);
    if (!frame.ok) { problems.push(`channel ${c.id}: the fixture frame does not read (${frame.reason})`); continue; }
    need(frame.kind === "data" && frame.channel === c.id && frame.family === c.family && frame.ticker === (c.scope === "ticker" ? FIXTURES.tickers[0] : null), `channel ${c.id}: the frame is filed under another channel`);
    need(parseMessage(text).kind === "data" && parseMessage(text).channel === fx.frame[0], `channel ${c.id}: the hub's own parser reads the fixture frame differently`);
    for (const p of fx.numeric) {
      const values = valuesAt([frame.payload], p);
      need(values.length > 0 && values.every((v) => typeof v === "number"), `channel ${c.id}: ${p} is left as text`);
    }
    const numericFields = new Set(c.fields.filter((f) => f.numeric).map((f) => f.path));
    need(fx.numeric.every((p) => numericFields.has(p)), `channel ${c.id}: the fixture generator finds numeric strings the catalog does not mark`);
    const blank = c.fields.filter((f) => f.numeric && valuesAt([fx.frame[1]], f.path).includes(""));
    for (const f of blank) need(valuesAt([frame.payload], f.path).includes(null) && !valuesAt([frame.payload], f.path).includes(0), `channel ${c.id}: the empty ${f.path} did not become a null`);
    need(frame.undocumented.length === 0 && JSON.stringify(client.frame(fx.frame)) === JSON.stringify(frame), `channel ${c.id}: the frame names undocumented keys or reads differently when already parsed`);
    const ack = client.frame(JSON.stringify([fx.frame[0], { response: {}, status: "ok" }]));
    need(ack.ok && ack.kind === "ack" && ack.status === "ok" && parseMessage(JSON.stringify([fx.frame[0], { response: {}, status: "ok" }])).kind === "ack", `channel ${c.id}: an acknowledgement is read as data`);
  }
  for (const [topic, row] of Object.entries(SOCKET_CHANNELS)) {
    const name = row.channel(FIXTURES.tickers[0]);
    const joined = refusal(() => client.join(row.template, row.scope === "ticker" ? FIXTURES.tickers[0] : undefined)) === null ? client.join(row.template, row.scope === "ticker" ? FIXTURES.tickers[0] : undefined) : null;
    need(joined !== null && joined.channel === name, `the hub's ${topic} channel ${name} is not what the client joins`);
    const mapped = channelTopic(name);
    need(mapped !== null && mapped.k === topic, `the hub files ${name} under another topic than ${topic}`);
  }

  const join = lib.registryJoin(catalog, OPS);
  const wireOnly = [];
  const byRoute = new Map(catalog.ops.map((o) => [`${o.method} ${o.path}`, o]));
  const scanned = new Set(scannedOperations(SPEC).operations);
  for (const e of OPS) {
    const o = byRoute.get(`${e.method} ${e.op}`);
    need(Boolean(o) === scanned.has(`${e.method} ${e.op}`), `registry entry ${e.id}: the join and the document disagree on whether ${e.op} is documented`);
    need(join.absent.includes(e.id) === !o, `registry entry ${e.id} is filed wrongly by the join`);
    if (!o) { need(e.liveOnly === true, `registry entry ${e.id} reads an operation the catalog lacks and is not marked live only`); continue; }
    need(join.readers.get(o.id).includes(e.id), `registry entry ${e.id} is not among the readers of ${o.id}`);
    if (o.kind === "socket") { need(e.envelope === null && join.pages.includes(e.id), `registry entry ${e.id} points at a socket page and carries an envelope`); continue; }
    need(e.liveOnly === false && e.method === o.method && e.op === o.path && e.envelope === catalog.envelope, `registry entry ${e.id} and the catalog disagree on method or path`);
    need(client.envelope(o.id) === (OTHER_WRAPPERS[e.id] || e.envelope) && (o.bare === true) === BARE_LISTS.includes(e.id), `registry entry ${e.id}: the registry's column says ${e.envelope}, the client unwraps ${client.envelope(o.id)}${o.bare ? " or a bare list" : ""}`);
    need(e.deprecated === o.deprecated, `registry entry ${e.id} and the catalog disagree on deprecation`);
    const fixed = lib.registryParams(e);
    if (fixed === null) { problems.push(`registry entry ${e.id}: its call path is not an instance of ${o.path}`); continue; }
    const fx = FIXTURES.ops[`${o.method} ${o.path}`];
    const tokens = [...e.path.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    const params = { ...fx.request.required, ...fixed };
    const built = refusal(() => client.request(o.id, params)) === null ? client.request(o.id, params) : null;
    need(built !== null && built.path === pathFor(e.id, Object.fromEntries(tokens.map((t) => [t, params[t]]))), `registry entry ${e.id}: the client and the registry build different paths (${built && built.path})`);
    if (e.reads && o.documents !== "open") {
      const names = new Set(o.fields.flatMap((f) => f.path.replace(/\[\]/g, "").split(".")));
      names.add(o.envelope);
      const observed = new Set(Object.values((SHAPES[e.op] && SHAPES[e.op].sets) || {}).flatMap((set) => Object.keys(set)));
      const unlisted = e.reads.filter((r) => !names.has(r));
      need(unlisted.every((r) => observed.has(r)), `registry entry ${e.id} reads names that neither the document nor the observed wire lists: ${unlisted.filter((r) => !observed.has(r)).join(", ")}`);
      wireOnly.push(...unlisted.map((r) => `${e.id}.${r}`));
    }
  }
  need(JSON.stringify(wireOnly) === JSON.stringify(WIRE_ONLY_READS), `the names the registry reads that are on the wire and not in the document are ${JSON.stringify(wireOnly)}`);

  const expectedWire = {};
  for (const seen of observedOps(catalog)) {
    const { o } = seen;
    if (seen.bare) need(o.documents !== "envelope", `${seen.route}: the wire answers a bare list where the document describes a whole answer`);
    else if (seen.wrapper !== o.envelope) (expectedWire[o.id] = expectedWire[o.id] || {}).envelope = seen.wrapper;
    const byPath = new Map(o.fields.map((f) => [f.path, f]));
    const clash = [...new Set(seen.cells.filter((c) => byPath.has(c.path) && contradicts(byPath.get(c.path), c.token)).map((c) => c.path))].sort();
    if (clash.length) (expectedWire[o.id] = expectedWire[o.id] || {}).untyped = clash;
    for (const pick of [0, 1, -1]) {
      const got = client.read(o.id, bodyFromSets(seen.sets, pick));
      need(got.ok === true, `${seen.route}: an answer shaped like the observed wire does not read (${got.reason})`);
    }
  }
  need(canon(lib.FEED_WIRE) === canon(expectedWire), `the table of observed deviations is ${JSON.stringify(lib.FEED_WIRE)}; the committed observation implies ${JSON.stringify(expectedWire)}`);
  for (const [id, readers] of join.readers) for (const r of readers) need(OPS.some((e) => e.id === r && `${e.method} ${e.op}` === `${catalog.ops.find((o) => o.id === id).method} ${catalog.ops.find((o) => o.id === id).path}`), `the join gives ${id} a reader that is not a registry entry for it`);
  const coverage = lib.feedCoverage(catalog, { registry: OPS, rail: RT_UPSTREAM, joined: SOCKET_CHANNELS });
  const requests = catalog.ops.filter((o) => o.kind === "json" || o.kind === "file");
  const readPaths = new Set(OPS.filter((e) => e.envelope !== null).map((e) => `${e.method} ${e.op}`));
  const readNow = requests.filter((o) => readPaths.has(`${o.method} ${o.path}`));
  need(coverage.operations.documented === catalog.ops.length && coverage.operations.requests === requests.length && coverage.operations.pages === catalog.ops.length - requests.length, "the coverage totals are not the catalog's");
  need(coverage.operations.read === readNow.length && JSON.stringify(coverage.operations.unread) === JSON.stringify(requests.filter((o) => !readPaths.has(`${o.method} ${o.path}`)).map((o) => o.id)), "the coverage does not count the operations the registry reads");
  need(coverage.operations.read + coverage.operations.unread.length === coverage.operations.requests, "read and unread do not add up to the requests");
  need(Object.values(coverage.operations.byTag).reduce((n, row) => n + row.documented, 0) === requests.length && Object.values(coverage.operations.byTag).reduce((n, row) => n + row.unread.length, 0) === coverage.operations.unread.length, "the tags do not add up");
  need(JSON.stringify(coverage.registry.absent) === JSON.stringify(OPS.filter((e) => !scanned.has(`${e.method} ${e.op}`)).map((e) => e.id)) && coverage.registry.entries === OPS.length, "the coverage does not name the registry entries the document lacks");
  const listed = new Set(Object.values(RT_UPSTREAM).flatMap((row) => row.channels));
  const joinedNow = new Set(Object.values(SOCKET_CHANNELS).map((row) => row.template));
  need(JSON.stringify(coverage.channels.listed) === JSON.stringify(catalog.channels.filter((c) => listed.has(c.id)).map((c) => c.id)) && JSON.stringify(coverage.channels.joined) === JSON.stringify(catalog.channels.filter((c) => joinedNow.has(c.id)).map((c) => c.id)), "the coverage does not count the rail's channels");
  need(coverage.channels.joined.length + coverage.channels.unread.length === catalog.channels.length && coverage.channels.undocumented.length === 0, "joined and unread channels do not add up, or the rail joins a channel the document does not list");
  return problems;
}

const NUMERIC_CASES = [
  [{ type: "string", example: "12.50" }, "price", true], [{ type: "string", example: "0" }, "volume", true], [{ type: "string", example: "-0.5" }, "delta", true], [{ type: "string", example: "1e-7" }, "gamma", true],
  [{ type: "string", example: "3.2" }, "bid", true], [{ type: "string", example: "12" }, "paid", true], [{ type: "string", example: "0012" }, "zip", false], [{ type: "string", example: "+1" }, "change", false],
  [{ type: "string", example: ".5" }, "ratio", false], [{ type: "string", example: "1." }, "ratio", false], [{ type: "string", example: "1,234" }, "volume", false], [{ type: "string", example: "" }, "volume", false],
  [{ type: "string", example: "12 " }, "volume", false], [{ type: "string", example: "0x10" }, "volume", false], [{ type: "string", example: "320193" }, "cik", false], [{ type: "string", example: "4" }, "formtype", false],
  [{ type: "string", example: "12" }, "sector_code", false], [{ type: "string", example: "12" }, "id", false], [{ type: "string", example: "12" }, "alert_id", false], [{ type: "string", example: "12", enum: ["12", "13"] }, "level", false],
  [{ type: "string", example: "2026", format: "date" }, "year", false], [{ type: "string", example: "2026", format: "date-time" }, "year", false], [{ type: "string", example: "1", format: "uuid" }, "key", false],
  [{ type: "string", example: 12 }, "volume", false], [{ type: "string" }, "volume", false], [{ type: "integer", example: "12" }, "volume", false], [{ type: "any", example: "12" }, "volume", false],
];

const ID_CASES = [
  ["PublicApi.TickerController.greeks", "ticker.greeks"], ["PublicApi.OptionTradeController.full_tape", "option-trade.full-tape"], ["PublicApi.NasdaqPulseController.top", "nasdaq-pulse.top"],
  ["PublicApi.ETFController.in_outflow", "etf.in-outflow"], ["Other.Thing.do_it", "other.thing.do-it"], ["PublicApi.Controller.index", "controller.index"], ["solo", "solo"], ["", "refused"], ["...", "refused"],
];

const BRAND_CASES = [
  ["https://api.samplebrand.test", "s[\\s_-]*a[\\s_-]*m[\\s_-]*p[\\s_-]*l[\\s_-]*e[\\s_-]*b[\\s_-]*r[\\s_-]*a[\\s_-]*n[\\s_-]*d"], ["https://ab.test/path?x=1", "a[\\s_-]*b"], ["http://localhost:8787", null], ["http://127.0.0.1:8787", null], ["https://10.20.30.40", null],
  ["https://api.sample-brand.test", null], ["not an address", null], [null, null],
];

const SCRUB_CASES = [
  ["Sample Brand data", "the feed data"], ["The Sample Brand rows and the Sample Brand plan", "The feed rows and the feed plan"], ["sample_brand, SAMPLEBRAND and Sample-Brand", "the feed, the feed and the feed"], ["a sample of brands", "a sample of brands"],
  ["See [the page](https://samplebrand.test/a?b=1) now", "See the page now"], ["Read https://docs.example.test/x first", "Read first"], ["Write to help@samplebrand.test today", "Write to the feed's support today"],
  ["Full Tape and tape and tapes", "Full Prints and prints and prints"], ["Bought at the ask, sold At Bid, atlas at asking", "Bought on the ask side, sold on the bid side, atlas at asking"],
  ["The vendor's rows, Vendors and vendored code", "The source's rows, Sources and vendored code"], ["a taper, an untaped roll", "a taper, an untaped roll"], ["  two   spaces\nand a line  ", "two spaces and a line"],
];

const STATED_CASES = [
  ["Returns rows. It needs the Pro plan.\n\nHistory is limited to 30 days.\n", { plan: ["It needs the Pro plan."], limits: ["History is limited to 30 days."] }],
  ["| plan | not a sentence |\n\n```\nthe plan inside code\n```\n\n# Plan heading\nNothing stated here.\n", { plan: [], limits: [] }],
  ["The Sample Brand enterprise tier is limited to 5 rows. The same again. The Sample Brand enterprise tier is limited to 5 rows.", { plan: ["The feed enterprise tier is limited to 5 rows."], limits: [] }],
  ["Results are capped at 500 even if there are more. The date range is clamped. Limited to latest filings.", { plan: [], limits: ["Results are capped at 500 even if there are more.", "The date range is clamped."] }],
];

const TINY = {
  openapi: "3.0.0",
  info: { title: "Tiny", version: "9", description: "# 2026.03.04\n\nNewer.\n\n# 2025.01.02\n\nOlder.\n" },
  servers: [{ url: "https://api.samplebrand.test" }],
  paths: {
    "/api/tiny/{name}/rows": {
      get: {
        operationId: "PublicApi.TinyThingController.list_rows", tags: ["tiny"], summary: "Sample Brand tape rows", description: "Returns rows. It needs the Pro plan.\n\nHistory is limited to 30 days.\n",
        parameters: [{ name: "from", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 9, default: 3 } }, { name: "limit", in: "query", schema: { type: "string" } }, { name: "day", in: "query", required: true, schema: { type: "date" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Tiny row" } } } }, 422: { description: "bad" } },
      },
      delete: { operationId: "PublicApi.TinyThingController.drop", tags: ["tiny"], summary: "Drop (DEPRECATED)", responses: { 204: { description: "gone" } } },
    },
    "/api/tiny/file": { get: { operationId: "PublicApi.TinyThingController.file", tags: ["tiny"], summary: "File for AI: import (zip); export from 'here', sold at the ask by a vendor", responses: { 200: { description: "ok", content: { "application/zip": { schema: { type: "string", format: "binary" } } } } } } },
  },
  components: { schemas: { "Tiny row ": { type: "object",
    example: { rows: [
      { zip: "0012", bid: "1.25", vol: 925, rate: "0.42", flag: true, prev: "69.4", on: "yes", code_id: "12", legs: [{ k: "5" }], level: null },
      { zip: "0013", bid: "2", vol: 926, rate: "0.5", flag: false, prev: "0.0%", on: "no", code_id: "13", legs: [], level: null },
    ] },
    properties: {
      zip: { type: "string", example: "0012" }, bid: { type: "string", example: "1.25" }, self: { $ref: "#/components/schemas/Tiny row" }, seen: { type: "string", format: "date_time", nullable: true },
      level: { oneOf: [{ type: "integer" }, { type: "null" }] }, bag: { type: "object", additionalProperties: { type: "string" } }, legs: { type: "array", items: { type: "object", properties: { k: { type: "string", example: "5" } } } },
      vol: { type: "string" }, rate: { type: "date" }, flag: { type: "string" }, prev: { type: "string", example: "69.4" }, on: { type: "boolean" }, code_id: { type: "string" },
    } } } },
};

const TINY_CATALOG = {
  source: { file: null, sha256: null, openapi: "3.0.0", documentVersion: "9", newestChange: "2026.03.04", paths: 2, operations: 3, schemas: 1, notes: { refsRepaired: 1, cycles: 1, dateTypes: 2, pathParamsImplied: 2, paramsDuplicated: 1, exampleNumerics: 2, exampleOverrides: 3 } },
  ops: [
    { id: "tiny-thing.file", method: "GET", path: "/api/tiny/file", operationId: "PublicApi.TinyThingController.file", tags: ["tiny"], summary: "File for AI: import (zip); export from 'here', sold on the ask side by a source", kind: "file", deprecated: false, plan: [], limits: [], statuses: [200], params: [], envelope: null, documents: null, fields: [], media: "application/zip" },
    { id: "tiny-thing.list-rows", method: "GET", path: "/api/tiny/{name}/rows", operationId: "PublicApi.TinyThingController.list_rows", tags: ["tiny"], summary: "the feed prints rows", kind: "json", deprecated: false,
      plan: ["It needs the Pro plan."], limits: ["History is limited to 30 days."], statuses: [200, 422],
      params: [{ name: "from", in: "query", required: false, type: "string" }, { name: "limit", in: "query", required: false, type: "integer", default: 3, min: 1, max: 9 }, { name: "day", in: "query", required: true, type: "string", format: "date" }, { name: "name", in: "path", required: true, type: "string", implied: true }],
      envelope: "rows", envelopeFrom: "example", documents: "row", fields: [
        { path: "bag", type: "object", open: true }, { path: "bid", type: "string", numeric: true }, { path: "code_id", type: "string" }, { path: "flag", type: "any" }, { path: "legs", type: "array" }, { path: "legs[]", type: "object" },
        { path: "legs[].k", type: "string", numeric: true }, { path: "level", type: "integer", nullable: true }, { path: "on", type: "any" }, { path: "prev", type: "string" }, { path: "rate", type: "string", numeric: true },
        { path: "seen", type: "string", format: "date-time", nullable: true }, { path: "self", type: "any" }, { path: "vol", type: "string", numeric: true }, { path: "zip", type: "string" },
      ] },
    { id: "tiny-thing.drop", method: "DELETE", path: "/api/tiny/{name}/rows", operationId: "PublicApi.TinyThingController.drop", tags: ["tiny"], summary: "Drop (DEPRECATED)", kind: "none", deprecated: true, plan: [], limits: [], statuses: [204],
      params: [{ name: "name", in: "path", required: true, type: "string", implied: true }], envelope: null, documents: null, fields: [] },
  ],
  channels: [],
};

const WRAPPER_CASES = [
  ["an example that is the rows themselves", (row) => { row.example = row.example.rows; }, { envelope: "data", envelopeFrom: "assumed", bare: true }],
  ["an example under data", (row) => { row.example = { data: row.example.rows, date: "2026-03-04" }; }, { envelope: "data", envelopeFrom: "example" }],
  ["an example that is one row", (row) => { row.example = row.example.rows[0]; }, { envelope: "data", envelopeFrom: "assumed" }],
  ["an example with two candidate wrappers", (row) => { row.example = { rows: row.example.rows, more: [] }; }, { envelope: "data", envelopeFrom: "assumed" }],
  ["an example whose one list is a documented field", (row) => { row.example = { legs: [{ k: "5" }] }; }, { envelope: "data", envelopeFrom: "assumed" }],
  ["no example", (row) => { delete row.example; }, { envelope: "data", envelopeFrom: "assumed" }],
  ["a schema that documents data", (row) => { row.properties = { data: { type: "array", items: { type: "object", properties: { k: { type: "string" } } } } }; row.example = { rows: [] }; }, { envelope: "data", envelopeFrom: "schema" }],
];

const REFUSED_DOCUMENTS = [
  ["two operations of one name", (doc) => { doc.paths["/api/tiny/file"].get.operationId = "PublicApi.TinyThingController.drop"; }],
  ["an operation with no operationId", (doc) => { delete doc.paths["/api/tiny/file"].get.operationId; }],
  ["a reference to a schema that does not exist", (doc) => { doc.components.schemas["Tiny row "].properties.self = { $ref: "#/components/schemas/Nowhere" }; }],
  ["a reference outside the document", (doc) => { doc.components.schemas["Tiny row "].properties.self = { $ref: "other.yaml#/Thing" }; }],
  ["no paths", (doc) => { delete doc.paths; }],
];

const WIRE_ONLY_READS = [
  "spot-exposures.start_time", "screener-stocks.gex_gamma_per_one_percent_move_oi", "screener-stocks.gex_gamma_per_one_percent_move_vol", "screener-stocks.gex_gamma_per_one_percent_move_dir", "screener-stocks.stock_volume",
  "screener-stocks.full_name", "flow-alerts.start_time", "flow-alerts.end_time", "flow-alerts.iv_start", "flow-alerts.iv_end", "sector-etfs.last", "etf-holdings.type", "etf-holdings.weight", "etf-tide.underlying_price",
  "ownership.units_changed",
];
const OTHER_WRAPPERS = Object.freeze({ "contract-historic": "chains", "shorts-volume": "si" });
const BARE_LISTS = Object.freeze(["flow-per-strike", "strike-flow-intraday"]);
const MINI_WIRE = Object.freeze({ "t.wired": { envelope: "si", untyped: ["flag"] } });

function observedOps(catalog) {
  const byRoute = new Map(catalog.ops.map((o) => [`${o.method} ${o.path}`, o]));
  const out = [];
  for (const [route, entry] of Object.entries(SHAPES)) {
    const o = byRoute.get(`GET ${route}`);
    const labels = Object.keys(entry.sets);
    if (!o || o.kind !== "json" || !labels.length) continue;
    const tops = [...new Set(labels.map((l) => l.split(".")[0]))];
    assert.equal(tops.map((t) => t.replace(/\[\]$/, "")).filter((t, i, all) => all.indexOf(t) === i).length, 1, `${route}: the observation holds one answer`);
    const bare = tops[0] === "[]";
    const cells = [];
    for (const label of labels) {
      const rest = label.split(".").slice(1).join(".");
      for (const [key, token] of Object.entries(entry.sets[label])) {
        const inRow = rest === "" ? key : `${rest}.${key}`;
        cells.push({ path: o.documents === "envelope" ? `${label}.${key}` : o.documents === "list" ? `[].${inRow}` : inRow, token });
      }
    }
    out.push({ route, o, bare, wrapper: bare ? null : tops[0].replace(/\[\]$/, ""), cells, sets: entry.sets });
  }
  return out;
}

function contradicts(field, token) {
  const seen = token.split("|").filter((t) => t !== "null");
  const allowed = field.type === "any" ? null : field.type === "string" ? (field.numeric ? ["str#", "num"] : ["str", "str#"])
    : field.type === "integer" || field.type === "number" ? ["num", "str#"] : field.type === "boolean" ? ["bool"] : field.type === "array" ? ["arr"] : ["obj"];
  return allowed !== null && seen.some((t) => !allowed.includes(t));
}

function bodyFromSets(sets, pick) {
  const body = {};
  let bare = null;
  const value = (token) => {
    const parts = token.split("|");
    const seen = parts.filter((t) => t !== "null");
    const t = (pick < 0 && parts.includes("null")) || !seen.length ? "null" : seen[Math.min(Math.max(pick, 0), seen.length - 1)];
    return t === "num" ? 1.5 : t === "str" ? "text" : t === "str#" ? "12.5" : t === "bool" ? true : t === "arr" ? [] : t === "obj" ? {} : null;
  };
  const holders = (label) => {
    const parts = label.split(".");
    let layer = [body];
    if (parts[0] === "[]") { bare = bare || [{}]; layer = bare; parts.shift(); }
    for (const part of parts) {
      const name = part.replace(/\[\]$/, "");
      layer = layer.map((h) => {
        if (part.endsWith("[]")) { if (!Array.isArray(h[name]) || !h[name].length) h[name] = [{}]; return h[name][0]; }
        if (!isObj(h[name])) h[name] = {};
        return h[name];
      });
    }
    return layer;
  };
  for (const label of Object.keys(sets).sort((a, b) => a.split(".").length - b.split(".").length || (a < b ? -1 : 1))) {
    for (const h of holders(label)) for (const [k, token] of Object.entries(sets[label])) if (!Object.hasOwn(h, k)) h[k] = value(token);
  }
  return bare || body;
}

{
  const tree = yaml.parseYaml(SPEC, { nodes: true });
  const blob = Buffer.from(treeText(tree), "utf8");
  eq(sha256(blob), ORACLE.tree.sha256, "THE DOCUMENT IS READ AS PyYAML READS IT: the node tree of docs/uw-openapi.yaml (every key, every scalar's text and whether it was quoted) hashes to the value the Python oracle recorded");
  eq(blob.length, ORACLE.tree.bytes, "and has the same length");
  eq(ORACLE.provenance.specSha256, sha256(fs.readFileSync(path.join(ROOT, generator.SPEC_FILE))), "THE ORACLE WAS BUILT FROM THIS DOCUMENT: if docs/uw-openapi.yaml moved, run python3 tests/gen-feed-catalog-oracle.py and read the diff");
  eq(ORACLE.provenance.generatorSha256, sha256(fs.readFileSync(path.join(ROOT, ORACLE.provenance.generator))), "and by this version of its generator: a changed script without a regenerate fails here");
  ok(/^6\./.test(ORACLE.provenance.pyyaml) && ORACLE.provenance.generator === "tests/gen-feed-catalog-oracle.py", `the oracle names its generator and the PyYAML it ran on (${ORACLE.provenance.pyyaml})`);
  ok(!/\d{5}/.test(JSON.stringify({ ...ORACLE, provenance: null, tree: null, counts: null }).replace(/"[0-9a-f]{16}"/g, "\"\"")), "the oracle holds hashes and counts, no value of the document");

  for (const [text, want] of [["", null], ["~", null], ["null", null], ["Null", null], ["true", true], ["False", false], ["12", 12], ["-7", -7], ["+3", 3], ["0o17", 15], ["0x1F", 31], ["1.5", 1.5], [".5", 0.5], ["1e3", 1000],
    ["-.inf", -Infinity], ["yes", "yes"], ["No", "No"], ["on", "on"], ["2024-01-01", "2024-01-01"], ["2024-12-11T14:00:00Z", "2024-12-11T14:00:00Z"], ["1_000", "1_000"], ["1:30", "1:30"], ["0b11", "0b11"], ["nul", "nul"], ["TRUE", true]]) {
    ok(Object.is(yaml.resolvePlain(text), want), `a plain ${JSON.stringify(text)} resolves as YAML 1.2 says (${JSON.stringify(want)})`);
  }
  ok(Number.isNaN(yaml.resolvePlain(".nan")), "and .nan is not a number");
  const good = "a:\n  - b: 1\n    c: 'x'\n  - |\n    two\n    lines\nd: {}\ne: []\nf: \"q\\n\"\ng:\nh: text # note\n";
  deep(yaml.parseYaml(good), { a: [{ b: 1, c: "x" }, "two\nlines\n"], d: {}, e: [], f: "q\n", g: null, h: "text" }, "the reader handles the layout the document uses");
  for (const [bad, why] of [["a: [1, 2]\n", "a flow list"], ["a: {b: 1}\n", "a flow mapping"], ["a: &x 1\n", "an anchor"], ["a: *x\n", "an alias"], ["a: !!str 1\n", "a tag"], ["a: 1\na: 2\n", "a duplicate key"],
    ["a: >\n  folded\n", "a folded scalar"], ["a: 'open\n", "an unclosed quote"], ["a: 1\n---\nb: 2\n", "a second document"], ["a:\n\t- 1\n", "a tab in the indentation"], ["a: b: c\n", "a mapping inside a plain scalar"],
    ["a: 1\n  b: 2\n", "a line indented under a scalar"], ["%YAML 1.2\n---\na: 1\n", "a directive"], ["a: \"\\q\"\n", "an unknown escape"], ["? a\n: b\n", "a complex key"], ["a: plain\n  continued\n", "a plain scalar on two lines"]]) {
    assert.throws(() => yaml.parseYaml(bad), yaml.YamlError, `the reader refuses ${why} instead of guessing`); checks++;
  }
  const hostile = {
    "": "", " lead": "trail ", 200: 200, "a: b": "x # y", "it's": "it's: fine", multi: "a\n  b\n", noeol: "a\nb", keep: "a\n\n\n", only: "\n", two: "\n\n", lead: "  indented first\nsecond\n", tab: "a\tb", cr: "a\r\nb",
    list: [null, true, false, 1.5, -2, "3", "true", "null", "~", [], {}, [[1, 2], ["x"]], { z: 1, a: [{ k: "v\n" }] }],
    words: ["yes", "No", "=", "<<", "- x", "? y", ":", "#x", "*x", "&x", "!x", "@x", "`x", "%x", "{x", "[x", "]x", ",x", "|x", ">x", "'x", "\"x", "---", "...", "0x1F", "0o17", "1e5", ".inf", ".nan", "+1", "1.", ".5", "2024-01-01", "a:", "a :b", "url: http://x", "http://x/#frag", "a #b"],
    nul: null, deep: { a: { b: { c: [{ d: null, e: "x\ny\n" }] } } }, unicode: "\u0394 \u2192 \u2265", ctl: "a\u0001b", seqblock: ["x\ny\n", "  lead\n", "p\nq"], "key\nnl": 1, "'q'": "'", "\"dq\"": "\"",
  };
  const dumped = yaml.dumpYaml(hostile);
  deep(yaml.parseYaml(dumped), hostile, "A HOSTILE DOCUMENT SURVIVES THE WRITER AND THE READER: empty strings, edge spaces, block scalars with and without a final line break, quoted look-alikes, nulls and nested lists");
  eq(yaml.dumpYaml(yaml.parseYaml(dumped)), dumped, "and writing what was read gives the same bytes");
  const whole = yaml.parseYaml(SPEC);
  const rewritten = yaml.dumpYaml(whole);
  deep(yaml.parseYaml(rewritten), whole, "THE DOCUMENT SURVIVES A REWRITE: reading docs/uw-openapi.yaml, writing it in the committed layout and reading it again gives the same document");
  eq(yaml.dumpYaml(yaml.parseYaml(rewritten)), rewritten, "the rewrite is a fixed point");
  ok(diffDigests(digestSpec(SPEC), digestSpec(rewritten)).empty, "and the existing line reader finds the same operations, parameters, deprecations and plan sentences in the rewrite, so a document served as JSON can be compared after it is rewritten");
  const moved = rewritten.split("\n").filter((line, i) => line !== SPEC.split("\n")[i]).length;
  ok(rewritten.split("\n").length >= SPEC.split("\n").length - 2 && moved < SPEC.split("\n").length, `the rewrite keeps the committed layout: ${rewritten.split("\n").length} lines against ${SPEC.split("\n").length}`);
}

{
  const problems = catalogProblems(generator);
  deep(problems, [], "THE CATALOG IS THE DOCUMENT, OPERATION FOR OPERATION: counted on the document's own lines, held to the existing reader on ids, parameters, required flags, plan sentences and deprecations, and to the Python oracle on every typed parameter and response field");
  deep(await checkProblems(generator), [], "--check passes the catalog the document generates and fails a stale one, a missing one and one with a byte added");
  eq(read(generator.CATALOG_FILE), generator.renderCatalog(generator.buildCatalog(SPEC)), "THE COMMITTED CATALOG IS GENERATED: shared/flows-feed-catalog.js is byte for byte what the generator writes from the committed document");
  deep(FEED_CATALOG, generator.buildCatalog(SPEC), "and the module evaluates to the catalog the generator built");
  const frozen = (v) => v === null || typeof v !== "object" || (Object.isFrozen(v) && Object.values(v).every(frozen));
  ok(frozen(FEED_CATALOG), "every object and list in it is frozen");
  eq(read(fixtureGenerator.FIXTURE_FILE), fixtureGenerator.renderFixtures(fixtureGenerator.buildFixtures(SPEC)), "THE FIXTURES ARE GENERATED: tests/fixtures-feed-catalog.json is byte for byte what its generator writes from the committed document");
  eq(FIXTURES.provenance.generator, fixtureGenerator.GENERATOR, "the fixture file names its generator");
  eq(FIXTURES.provenance.specSha256, sha256(fs.readFileSync(path.join(ROOT, generator.SPEC_FILE))), "and the document it was built from");
  ok(/synthetic/.test(FIXTURES.provenance.nature) && /not data from the feed/.test(FIXTURES.provenance.nature) && !/verbatim|live probe|probe-report/i.test(JSON.stringify(FIXTURES.provenance)), "it says it is synthetic and not data from the feed");
  eq(Object.keys(FIXTURES.ops).length, FEED_CATALOG.ops.length, "there is a fixture entry for every operation");
  const tickers = new Set();
  JSON.stringify(FIXTURES, (key, value) => { if (typeof value === "string") for (const m of value.matchAll(/\b[A-Z]{2,5}[0-9]{0,3}\b/g)) if (/^SY[A-Z][0-9]{3}$/.test(m[0])) tickers.add(m[0]); return value; });
  deep([...tickers].sort(), [...fixtureGenerator.TICKERS], "every invented ticker in the fixtures is in the reserved fixture namespace");
  ok(!BRAND.test(JSON.stringify(FIXTURES)) && !BRAND.test(JSON.stringify(ORACLE)), "neither fixture names the provider"); BRAND.lastIndex = 0;
}

{
  deep(clientProblems(feed), [], "THE CLIENT BUILDS AND READS THROUGH THE CATALOG: a valid request for every operation, every bad parameter refused by name, every fixture read back with nulls kept and numeric strings coerced, every channel joined and framed as the hub does, and the registry agreed with on every operation both describe");
  const loaded = await feed.loadFeedClient();
  ok(loaded.catalog === FEED_CATALOG && Object.isFrozen(loaded), "loadFeedClient hands back a frozen client over the committed catalog");
}

let plantedCount = 0;

const GENERATOR_MUTANTS = [
  ["an operation dropped", [["const METHODS = [\"get\", \"post\", \"put\", \"patch\", \"delete\"];", "const METHODS = [\"get\"];"]]],
  ["a required flag flipped", [["required: raw.required === true, type: v.type };", "required: raw.required !== true, type: v.type };"]]],
  ["a numeric string left as text", [["  if (isNumericString(v, name)) out.numeric = true;", "  if (false) out.numeric = true;"]]],
  ["an identifier marked numeric", [["CANONICAL_DECIMAL.test(view.example) && !IDENTIFIER_NAME.test(name);", "CANONICAL_DECIMAL.test(view.example);"]]],
  ["a leading-zero code marked numeric", [["const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;", "const CANONICAL_DECIMAL = /^-?[0-9]+(?:\\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;"]]],
  ["nullability dropped", [["  if (v.nullable) out.nullable = true;\n  if (v.open) out.open = true;", "  if (v.open) out.open = true;"]]],
  ["a null alternative read as a type", [["        if (isObj(alt) && alt.type === \"null\") { nullable = true; continue; }\n", ""]]],
  ["an enum dropped from a parameter", [["  if (leaf.enum !== undefined) out.enum = leaf.enum;\n  if (leaf.default", "  if (leaf.default"]]],
  ["bounds dropped from a parameter", [["  if (leaf.min !== undefined) out.min = leaf.min;\n", ""]]],
  ["a row schema called an envelope", [["    return { documents: Object.hasOwn(root.props, ENVELOPE) ? \"envelope\" : \"row\", fields };", "    return { documents: \"envelope\", fields };"]]],
  ["nested fields not walked", [["  if (v.type === \"array\" && v.items !== undefined) flatten(reader, notes, reader.view(v.items, inner), `${pathOf}[]`, name, inner, out);\n", ""]]],
  ["the date type not normalised", [["    if (type === \"date\") { type = \"string\"; format = \"date\"; notes.dateTypes += 1; }\n", ""]]],
  ["the provider named", [["    if (brand) out = out.replace(brand, \"the feed\");\n", ""]]],
  ["an address left in a sentence", [["      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g, \"the feed's support\");", ";"]]],
  ["the wrapper the document's example shows ignored", [["    if (wrappers.length === 1) return { envelope: wrappers[0], envelopeFrom: \"example\" };\n", ""]]],
  ["a documented field taken for the wrapper", [["Object.keys(example).filter((k) => !documented.has(k) && WRAPPER_NAME.test(k)", "Object.keys(example).filter((k) => WRAPPER_NAME.test(k)"]]],
  ["an example of bare rows not noticed", [["  if (Array.isArray(example) && example.length > 0 && example.every(isObj)) return { envelope: ENVELOPE, envelopeFrom: \"assumed\", bare: true };\n", ""]]],
  ["the example's word on a field's kind ignored", [["roots === null ? shape.fields : shape.fields.map((f) => refineField(f, shownAt(roots, f.path), notes));", "shape.fields;"]]],
  ["a declared date kept over a number in the example", [["      if (TEXT_FORMATS.has(entry.format)) delete out.format;\n", ""]]],
  ["an identifier counted as a number because its example is digits", [["(kinds.has(\"number\") || (entry.format !== \"uuid\" && !IDENTIFIER_NAME.test(name)))", "(kinds.has(\"number\") || entry.format !== \"uuid\")"]]],
  ["text in the example not unmarking a number", [["    else if (entry.numeric && kinds.has(\"text\")) {\n      delete out.numeric;\n      notes.exampleOverrides += 1;\n    }\n", ""]]],
  ["a declared type kept over a contradicting example", [["    } else if (kinds.has(\"boolean\") || kinds.has(\"number\") || kinds.has(\"list\") || kinds.has(\"object\")) loosen();\n", "    }\n"]]],
  ["a retired phrase left in a sentence", [["      .replace(/\\bat (?:the )?(ask|bid)\\b/gi, (_, side) => `on the ${side.toLowerCase()} side`)\n", ""]]],
  ["the source named by its trade", [["      .replace(/\\b([Vv])endor(s?)\\b/g, (_, first, plural) => `${first === \"V\" ? \"S\" : \"s\"}ource${plural}`)\n", ""]]],
  ["data that the import scanner and the model-call guard misread", [["JSON.stringify(value).replace(SCANNED_WORDS,", "JSON.stringify(value).replace(/\\bnever\\b/g,"]]],
  ["a retired word left in a title", [["      .replace(/\\btapes?\\b/gi, (word) => (word[0] === \"T\" ? \"Prints\" : \"prints\"))\n", ""]]],
  ["a deprecation missed", [["    deprecated: op.deprecated === true || DEPRECATED_WORDS.test(summary) || DEPRECATED_WORDS.test(description.split(\"\\n\").slice(0, 2).join(\" \")),", "    deprecated: op.deprecated === true,"]]],
  ["a plan sentence dropped", [["  return { plan: unique(plan.map(scrub)), limits: unique(limits) };", "  return { plan: [], limits: unique(limits) };"]]],
  ["a channel's scope flipped", [["  return { family: m[1], scope: text.includes(\":\") ? \"ticker\" : \"all\" };", "  return { family: m[1], scope: text.includes(\":\") ? \"all\" : \"ticker\" };"]]],
  ["a channel dropped", [["    if (seen.has(id)) continue;\n    seen.add(id);", "    if (seen.has(id) || row.family === \"news\") continue;\n    seen.add(id);"]]],
  ["channel payloads not read", [["      if (payload) payloadFields(payload, types, \"\", fields);\n", ""]]],
  ["an id that is not the operationId's", [["  return parts.map((p) => kebab(p.replace(/Controller$/, \"\")) || kebab(p)).join(\".\");", "  return parts.map((p) => kebab(p)).join(\".\");"]]],
  ["a file called JSON", [["media.includes(\"application/json\") ? \"json\" : media.length ? \"file\" : \"none\",", "media.length ? \"json\" : \"none\","]]],
];

for (const [title, transforms] of GENERATOR_MUTANTS) {
  const planted = await loadMutated("scripts/gen-feed-catalog.mjs", transforms, { salt: ++plantedCount });
  const problems = catalogProblems(planted);
  ok(problems.length > 0, `PLANTED WRONG BUILD, ${title}: the catalog checks must fail it`);
}
{
  const stale = await loadMutated("scripts/gen-feed-catalog.mjs", [["    if (committed === made.text) {", "    if (committed !== null) {"]], { salt: ++plantedCount });
  ok((await checkProblems(stale)).length > 0, "PLANTED WRONG BUILD, a stale catalog passing --check: the check of the check must fail it");
  const blind = await loadMutated("scripts/gen-feed-catalog.mjs", [["    err(`${CATALOG_FILE} ${committed === null ? \"is missing\" : \"differs from what the document generates\"}; run node ${GENERATOR}`);\n    return 1;", "    return 0;"]], { salt: ++plantedCount });
  ok((await checkProblems(blind)).length > 0, "PLANTED WRONG BUILD, --check that reports and still exits 0: it must fail");
}

const CLIENT_MUTANTS = [
  ["a null turned into zero", [["  if (value === null) return null;\n  const entry = node.entry;", "  if (value === null) return 0;\n  const entry = node.entry;"]]],
  ["an empty numeric string turned into zero", [["  if (value === \"\") return { ok: true, value: null };", "  if (value === \"\") return { ok: true, value: 0 };"]]],
  ["a numeric string left as text", [["  if (entry.type === \"integer\" || entry.type === \"number\" || (entry.type === \"string\" && entry.numeric === true)) {", "  if (entry.type === \"integer\" || entry.type === \"number\") {"]]],
  ["any text coerced with Number", [["  if (!DECIMAL.test(value)) return { ok: false };\n", ""]]],
  ["an integer too large to hold read anyway", [["  if (WHOLE.test(value) && !Number.isSafeInteger(n)) return { ok: false };\n", ""]]],
  ["a path parameter not encoded", [["      return encodeURIComponent(segments.get(name));", "      return segments.get(name);"]]],
  ["an enum not enforced", [["  if (p.enum !== undefined && !p.enum.map(String).includes(text)) refuse(\"enum\", `is not one of the documented values (${p.enum.join(\", \")})`);\n", ""]]],
  ["a required parameter not enforced", [["        if (p.required) throw new FeedRequestError(o.id, p.name, \"missing\", \"is missing\");\n", ""]]],
  ["a minimum not enforced", [["    if (p.min !== undefined && value < p.min) refuse(\"min\", `is below the documented minimum ${p.min}`);\n", ""]]],
  ["a maximum not enforced", [["    if (p.max !== undefined && value > p.max) refuse(\"max\", `is above the documented maximum ${p.max}`);\n", ""]]],
  ["an undocumented parameter accepted", [["      if (!known.has(key)) throw new FeedRequestError(o.id, key, \"unknown\", \"is not a documented parameter\");\n", ""]]],
  ["a parameter's type not checked", [["    if (typeof value !== \"number\" || !Number.isFinite(value) || (leafType === \"integer\" && !Number.isSafeInteger(value))) refuse(\"type\", `must be ${leafType === \"integer\" ? \"an integer\" : \"a number\"}`);\n", ""]]],
  ["a calendar day not checked", [["    if (p.format === \"date\" && !realDay(value)) refuse(\"format\", \"must be a calendar day written YYYY-MM-DD\");\n", ""]]],
  ["a list joined with commas", [["          query.push([p.name, paramText(o, p, item, p.items)]);\n        }\n        continue;", "          paramText(o, p, item, p.items);\n        }\n        query.push([p.name, raw.join(\",\")]);\n        continue;"]]],
  ["a write built without being asked", [["    if (o.method !== \"GET\" && opts.write !== true) throw new FeedRequestError(o.id, null, \"write\", `is a ${o.method}; it is built only when the caller passes write: true`);\n", ""]]],
  ["a socket page built as a request", [["    if (o.kind === \"socket\" || o.kind === \"none\") throw new FeedRequestError(o.id, null, \"not-a-request\", \"is a socket channel page, not a request\");\n", ""]]],
  ["a body without its envelope read", [["    if (!bare && (!isObj(body) || !Object.hasOwn(body, key))) return fail(\"unshaped\");", "    if (!bare && !isObj(body)) return fail(\"unshaped\");\n    if (!bare && !Object.hasOwn(body, key)) body = { [key]: body };"]]],
  ["an observed wrapper ignored", [["    return note && typeof note.envelope === \"string\" ? note.envelope : o.envelope;", "    return o.envelope;"]]],
  ["a field the wire types otherwise still held to the document", [["    return o.fields.map((f) => (note.untyped.includes(f.path) ? { path: f.path, type: \"any\" } : f));", "    return o.fields;"]]],
  ["a bare list of rows not read", [["    const bare = Array.isArray(body) && o.documents !== \"envelope\";", "    const bare = false;"]]],
  ["a bare list read where the whole answer is documented", [["    const bare = Array.isArray(body) && o.documents !== \"envelope\";", "    const bare = Array.isArray(body);"]]],
  ["the table of observed deviations emptied", [["  \"short.short-volume-and-ratio\": Object.freeze({ envelope: \"si\" }),\n", ""]]],
  ["an empty answer not named", [["    if (isEmpty(data)) return fail(\"empty\");\n", ""]]],
  ["a mistyped field passed through", [["    if (typeof value !== \"string\") throw new Mistyped(entry.path);\n    return value;\n  }\n  if (entry.type === \"boolean\") {", "    return value;\n  }\n  if (entry.type === \"boolean\") {"]]],
  ["a type failure that names no field", [["      if (error instanceof Mistyped) return fail(`type:${error.at}`);\n      throw error;\n    }\n    if (isEmpty(data))", "      if (error instanceof Mistyped) return fail(\"type\");\n      throw error;\n    }\n    if (isEmpty(data))"]]],
  ["an undocumented key dropped", [["      if (!free) strays.add(base + key);\n      put(out, key, value[key]);", "      if (!free) strays.add(base + key);"]]],
  ["a __proto__ key assigned", [["const put = (target, key, value) => Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });", "const put = (target, key, value) => { target[key] = value; };"]]],
  ["a per-name channel joined without a name", [["      if (typeof ticker !== \"string\" || !SYMBOL.test(ticker)) throw new FeedRequestError(c.id, \"ticker\", \"ticker\", \"must be a symbol in capitals\");\n", ""]]],
  ["another join message", [["export const FEED_JOIN = \"join\";", "export const FEED_JOIN = \"subscribe\";"]]],
  ["an acknowledgement read as data", [["    if (typeof payload.status === \"string\" && Object.hasOwn(payload, \"response\")) return { ok: true, kind: \"ack\", channel: name, status: payload.status };\n", ""]]],
  ["a frame filed under any channel", [["    return entry && SYMBOL.test(ticker) ? { entry, ticker } : null;", "    return entry ? { entry, ticker } : null;"]]],
  ["a join that ignores the method", [["  const byRoute = new Map(catalog.ops.map((o) => [`${o.method} ${o.path}`, o]));\n  const readers = new Map(catalog.ops.map((o) => [o.id, []]));", "  const byRoute = new Map(catalog.ops.map((o) => [`GET ${o.path}`, o]));\n  const readers = new Map(catalog.ops.map((o) => [o.id, []]));"]]],
  ["socket pages counted as requests", [["  const requests = catalog.ops.filter((o) => o.kind === \"json\" || o.kind === \"file\");\n  const read = requests.filter", "  const requests = catalog.ops;\n  const read = requests.filter"]]],
  ["a listed channel counted as joined", [["      joined: catalog.channels.filter((c) => joinedChannels.has(c.id)).map((c) => c.id),", "      joined: catalog.channels.filter((c) => railChannels.has(c.id)).map((c) => c.id),"]]],
  ["a fixed path segment not recovered", [["    if (call[i] !== template[i]) fixed[m[1]] = decodeURIComponent(call[i]);", "    if (call[i] !== template[i]) fixed[m[1]] = template[i];"]]],
];

for (const [title, transforms] of CLIENT_MUTANTS) {
  const planted = await loadMutated("shared/flows-feed-client.js", transforms, { salt: ++plantedCount });
  const problems = clientProblems(planted);
  ok(problems.length > 0, `PLANTED WRONG BUILD, ${title}: the client checks must fail it`);
}

{
  const worker = closure("worker.js");
  ok(worker.length > 100 && !worker.includes("shared/flows-feed-catalog.js") && !worker.includes("shared/flows-feed-client.js"), `THIS SLICE CHANGES NOTHING THE WORKER RUNS: neither the catalog nor the client is in worker.js's import closure (${worker.length} modules)`);
  const importers = [];
  for (const file of [...treeFiles("shared"), ...treeFiles("server"), ...treeFiles("scripts"), "worker.js"]) {
    for (const m of moduleSource(file).matchAll(/(\bimport\s*\(\s*|\bfrom\s*|\bimport\s*)["'`][^"'`\n]*flows-feed-catalog\.js["'`]/g)) importers.push(`${file}${m[1].includes("(") ? " (lazy)" : ""}`);
  }
  deep(importers, ["shared/flows-feed-client.js (lazy)"], "THE CATALOG IS ONLY EVER IMPORTED LAZILY: one literal dynamic import, in the client, so a Worker that carries the catalog does not evaluate it at start-up");
  deep(importsOf("shared/flows-feed-catalog.js"), [], "the catalog imports nothing");
  deep(importsOf("shared/flows-feed-client.js").filter((s) => !s.dynamic), [], "and the client has no static import, so it is a leaf");
  const sliceFiles = [generator.CATALOG_FILE, "shared/flows-feed-client.js", "scripts/gen-feed-catalog.mjs", "scripts/feed-yaml.mjs", "scripts/feed-spec-refresh.mjs", "tests/gen-feed-fixtures.mjs", "tests/gen-feed-catalog-oracle.py",
    fixtureGenerator.FIXTURE_FILE, "tests/fixtures-feed-catalog-oracle.json", ".github/workflows/feed-spec-refresh.yml"];
  const served = new Set(servedFiles());
  ok(served.size > 50 && served.has("index.html") && sliceFiles.every((f) => fs.existsSync(path.join(ROOT, f)) && !served.has(f)), "none of the slice's files is uploaded with the static bundle");
  const bytes = fs.statSync(path.join(ROOT, generator.CATALOG_FILE)).size;
  const zipped = gzipSync(fs.readFileSync(path.join(ROOT, generator.CATALOG_FILE))).length;
  ok(bytes < 450 * 1024 && zipped < 60 * 1024, `the catalog stays small enough to carry: ${bytes} bytes, ${zipped} gzipped (limits 450 KiB and 60 KiB)`);
  for (const file of sliceFiles) {
    ok(!BRAND.test(read(file)), `${file} does not name the provider`); BRAND.lastIndex = 0;
  }
  const wired = feed.createFeedClient(FEED_CATALOG);
  const seenOps = observedOps(FEED_CATALOG);
  let strayKeys = 0;
  let strayOps = 0;
  for (const seen of seenOps) {
    const got = wired.read(seen.o.id, bodyFromSets(seen.sets, 0));
    ok(got.ok === true, `an answer shaped like the wire observed for ${seen.route} reads through the client`);
    if (got.undocumented.length) { strayOps += 1; strayKeys += got.undocumented.length; }
  }
  ok(seenOps.length >= 60 && Object.keys(SHAPES).length - seenOps.length < 10, `THE READER TAKES THE WIRE AS IT WAS OBSERVED: ${seenOps.length} of the ${Object.keys(SHAPES).length} operations in the committed observation of ${OBSERVATION.observed} are in the document with a shape on record, and every one reads`);
  ok(/rowsOf\(d\.volume\.body, "si"\)/.test(read("scripts/flows-legs/ownership.mjs")), "production reads short volume under si, as the observation and the deviation table say");
  ok(/if \(rule === "chains"\) return body && typeof body === "object" && Array\.isArray\(body\.chains\) \? body\.chains : null;/.test(read("shared/flows-positioning.js")), "production reads a contract's history under chains, as the document's example shows");
  const lines = generator.coverageLines(await generator.coverageOf(FEED_CATALOG));
  const coverage = feed.feedCoverage(FEED_CATALOG, { registry: OPS, rail: RT_UPSTREAM, joined: SOCKET_CHANNELS });
  ok(lines.some((l) => l.includes(`${coverage.operations.read} of ${coverage.operations.requests} requests have a reader`)) && lines.some((l) => l.includes(`${FEED_CATALOG.channels.length} documented; the rail lists ${coverage.channels.listed.length} and joins ${coverage.channels.joined.length}`)),
    "the coverage report prints the counts the join computes");
  for (const id of coverage.operations.unread) ok(lines.some((l) => l.includes(`    ${id}  `)), `the coverage report lists the unread ${id}`);
  ok(!lines.some((l) => BRAND.test(l)), "and names no provider"); BRAND.lastIndex = 0;
  console.log(`✓ flows-feed-catalog: ${checks} checks. ${FEED_CATALOG.source.operations} operations on ${FEED_CATALOG.source.paths} paths (${coverage.operations.requests} requests, ${coverage.operations.pages} socket pages), ${FEED_CATALOG.channels.length} channels; ` +
    `the registry reads ${coverage.operations.read} of the ${coverage.operations.requests} requests and ${coverage.registry.absent.length} operations this copy of the document lacks; the hub joins ${coverage.channels.joined.length} of ${FEED_CATALOG.channels.length} channels; ` +
    `${seenOps.length} observed operations read, with ${strayKeys} keys on ${strayOps} of them on the wire and not in the document; ` +
    `catalog ${bytes} bytes (${zipped} gzipped); ${GENERATOR_MUTANTS.length + 2} planted generator builds and ${CLIENT_MUTANTS.length} planted client builds fail`);
}
