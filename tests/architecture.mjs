import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseImports, ROOT, moduleSource, expect } from "./lib/source-scan.mjs";
import { trackedFiles } from "./lib/suite-registry.mjs";
import { stripComments } from "../scripts/strip-comments.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const t0 = process.hrtime.bigint();

const cache = new Map();
const realTree = {
  files: trackedFiles(ROOT),
  read(rel) {
    if (!cache.has(rel)) cache.set(rel, readFileSync(path.join(ROOT, rel), "utf8"));
    return cache.get(rel);
  },
};

function withEdits(base, edits) {
  const files = new Set(base.files);
  for (const [rel, text] of Object.entries(edits)) {
    if (text === null) files.delete(rel);
    else files.add(rel);
  }
  return {
    files: [...files],
    read: (rel) => (Object.hasOwn(edits, rel) ? edits[rel] : base.read(rel)),
  };
}

const posix = (p) => p.split(path.sep).join("/");
const isModule = (f) => /\.(?:m?js)$/.test(f);
const GRAPH_ROOTS = /^(?:worker\.js|shared\/|server\/|scripts\/)/;
const UNFOLLOWABLE = ["scripts/launch-readiness.mjs", "scripts/render-preview.mjs"];

function graph(tree) {
  const set = new Set(tree.files);
  const nodes = tree.files.filter((f) => isModule(f) && GRAPH_ROOTS.test(f));
  const edges = new Map();
  const bare = new Map();
  const problems = [];
  const unfollowable = [];
  for (const file of nodes) {
    const parsed = importsIn(file, tree.read(file));
    if (parsed.error) { unfollowable.push(file); continue; }
    const specs = parsed.specs;
    const out = [];
    const outside = [];
    for (const { spec, dynamic } of specs) {
      if (!spec.startsWith(".")) { outside.push(spec); continue; }
      const target = posix(path.normalize(path.join(path.dirname(file), spec.replace(/[?#].*$/, ""))));
      if (!set.has(target)) { problems.push(`${file} imports ${spec}, which does not resolve`); continue; }
      out.push({ to: target, dynamic });
    }
    edges.set(file, out);
    bare.set(file, outside);
  }
  return { nodes, edges, bare, problems, unfollowable };
}

function cycles(g) {
  const state = new Map();
  const found = [];
  const visit = (f, stack) => {
    if (state.get(f) === 2) return;
    if (state.get(f) === 1) { found.push([...stack.slice(stack.indexOf(f)), f].join(" -> ")); return; }
    state.set(f, 1);
    stack.push(f);
    for (const { to } of g.edges.get(f) || []) visit(to, stack);
    stack.pop();
    state.set(f, 2);
  };
  const entries = g.nodes.filter((f) => f === "worker.js" || f.startsWith("scripts/") || f.startsWith("shared/") || f.startsWith("server/"));
  for (const e of entries) visit(e, []);
  return { found, walked: state.size };
}

const LAYERS = [
  { name: "worker.js", from: /^worker\.js$/, to: [/^shared\//, /^server\//], bare: [/^cloudflare:/, /^node:/] },
  {
    name: "a route", from: /^server\/routes\/[^/]+\.js$/,
    to: [/^server\/(?:http|store|vendor|ai|config|log|errors|policy)\.js$/, /^shared\//], bare: [],
  },
  { name: "a server service", from: /^server\/(?!routes\/)[^/]+\.js$/, to: [/^server\/(?!routes\/)[^/]+\.js$/, /^shared\//], bare: [] },
  {
    name: "a nightly section", from: /^scripts\/flows-nightly\/sections\/[^/]+\.mjs$/,
    to: [
      /^scripts\/flows-nightly\/(?:store|vendor|vendor-params|rank|archive|fixtures|flags|clock|stages)\.mjs$/,
      /^scripts\/flows-legs\/[^/]+\.mjs$/, /^scripts\/flows-quant-pipeline\.mjs$/, /^shared\//,
    ],
    bare: [/^node:/],
  },
  { name: "shared", from: /^shared\//, to: [/^shared\//], bare: [] },
  { name: "a script", from: /^scripts\//, to: [/^scripts\//, /^shared\//, /^tests\/lib\/suite-registry\.mjs$/], bare: [/^node:/, /^[a-z@]/] },
];

function layers(g) {
  const problems = [];
  for (const file of g.nodes) {
    const rule = LAYERS.find((r) => r.from.test(file));
    if (!rule) { problems.push(`${file} is in no layer of the table`); continue; }
    for (const { to } of g.edges.get(file) || []) {
      if (!rule.to.some((rx) => rx.test(to))) problems.push(`${file} (${rule.name}) imports ${to}, which the layer table does not allow`);
    }
    for (const spec of g.bare.get(file) || []) {
      if (/^cloudflare:/.test(spec) && file !== "worker.js") problems.push(`${file} imports ${spec}: only worker.js may touch the runtime`);
      else if (!rule.bare.some((rx) => rx.test(spec))) problems.push(`${file} (${rule.name}) imports ${spec}, which the layer table does not allow`);
    }
  }
  return problems;
}

function assets(tree) {
  const problems = [];
  for (const file of tree.files.filter((f) => /^assets\/js\/[^/]+\.js$/.test(f))) {
    const text = tree.read(file);
    const parsed = importsIn(file, text);
    if (parsed.error) { problems.push(parsed.error); continue; }
    const specs = parsed.specs;
    if (specs.length || /^export\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*)/m.test(text)) {
      problems.push(`${file} has an import or export statement; assets/js is IIFE-only`);
    }
  }
  return problems;
}

const LEAVES = {
  "shared/flows-focus.js": [],
  "shared/flows-vendor-core.js": [],
  "shared/flows-stats.js": [],
  "shared/flows-dossier.js": ["shared/flows-cross.js", "shared/flows-stats.js"],
  "shared/flows-neuron-screen.js": ["shared/flows-cross.js", "shared/flows-neuron.js", "shared/flows-quant-structures.js"],
  "shared/flows-reading.js": ["shared/flows-ask.js", "shared/flows-dossier.js"],
};

function leaves(g) {
  const problems = [];
  for (const [file, want] of Object.entries(LEAVES)) {
    if (!g.edges.has(file)) { problems.push(`${file} is declared a leaf and is not in the tree`); continue; }
    const got = [...new Set(g.edges.get(file).map((e) => e.to))].sort();
    const extra = (g.bare.get(file) || []);
    if (JSON.stringify(got) !== JSON.stringify([...want].sort()) || extra.length) {
      problems.push(`${file} must import exactly ${JSON.stringify(want)} and imports ${JSON.stringify([...got, ...extra])}`);
    }
  }
  return problems;
}

function lines(text, index) {
  return text.slice(0, index).split("\n").length;
}

function scanLexed(text, { quotes = ['"', "'"], triple = [], line = [], block = [], hashAfterSpace = false, escape = "\\" }) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    let handled = false;
    for (const q of triple) {
      if (text.startsWith(q, i)) {
        const end = text.indexOf(q, i + 3);
        i = end < 0 ? n : end + 3;
        handled = true;
        break;
      }
    }
    if (handled) continue;
    if (quotes.includes(c)) {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (escape && text[j] === escape) j++;
        else if (text[j] === "\n" && c !== "`") break;
        j++;
      }
      i = j + 1;
      continue;
    }
    for (const t of line) if (text.startsWith(t, i) && (!hashAfterSpace || i === 0 || /\s/.test(text[i - 1]))) return i;
    for (const t of block) if (text.startsWith(t, i)) return i;
    i++;
  }
  return -1;
}

const LEXERS = {
  css: (t) => scanLexed(t, { block: ["/*"] }),
  sql: (t) => scanLexed(t, { quotes: ["'", '"', "`"], line: ["--"], block: ["/*"], escape: null }),
  toml: (t) => scanLexed(t, { triple: ['"""', "'''"], line: ["#"], escape: "\\" }),
  python: (t) => {
    const body = t.startsWith("#!") ? "\n" + t.slice(t.indexOf("\n") < 0 ? t.length : t.indexOf("\n")) : t;
    const at = scanLexed(body, { triple: ['"""', "'''"], line: ["#"], escape: "\\" });
    return at < 0 ? -1 : at + (t.length - body.length);
  },
  yaml: (t) => {
    let offset = 0;
    for (const raw of t.split("\n")) {
      let inQuote = null;
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (inQuote) {
          if (c === "\\" && inQuote === '"') i++;
          else if (c === inQuote) inQuote = null;
          continue;
        }
        if ((c === '"' || c === "'") && (i === 0 || /[\s:\-[{,]/.test(raw[i - 1]))) { inQuote = c; continue; }
        if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) return offset + i;
      }
      offset += raw.length + 1;
    }
    return -1;
  },
  ignore: (t) => {
    let offset = 0;
    for (const raw of t.split("\n")) {
      if (/^\s*#/.test(raw)) return offset + raw.indexOf("#");
      offset += raw.length + 1;
    }
    return -1;
  },
};

const htmlInline = (text) => {
  const found = [];
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) found.push({ kind: "css", body: m[1], at: m.index + m[0].indexOf(m[1]) });
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1]);
    if (type && !/^(?:module|text\/javascript|application\/javascript)$/i.test(type[1])) continue;
    found.push({ kind: "js", body: m[2], at: m.index + m[0].indexOf(m[2]) });
  }
  return found;
};

const norm = (t) => t.split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n").replace(/\n{3,}/g, "\n\n");

function jsComment(text) {
  const clean = norm(stripComments(text));
  const raw = norm(text);
  if (clean === raw) return -1;
  const a = clean.split("\n");
  const b = raw.split("\n");
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return b.slice(0, i).join("\n").length + 1;
}

const LANGUAGES = [
  { id: "javascript", pick: (f) => /\.(?:m?js|cjs)$/.test(f), find: (t) => jsComment(t) },
  { id: "css", pick: (f) => /\.css$/.test(f), find: LEXERS.css },
  {
    id: "html", pick: (f) => /\.html$/.test(f),
    find: (t) => {
      const open = t.indexOf("<!--");
      if (open >= 0) return open;
      for (const part of htmlInline(t)) {
        const at = part.kind === "css" ? LEXERS.css(part.body) : jsComment(part.body);
        if (at >= 0) return part.at + at;
      }
      return -1;
    },
  },
  { id: "sql", pick: (f) => /\.sql$/.test(f), find: LEXERS.sql },
  { id: "yaml", pick: (f) => /\.ya?ml$/.test(f), find: LEXERS.yaml },
  { id: "toml", pick: (f) => /\.toml$/.test(f), find: LEXERS.toml },
  { id: "python", pick: (f) => /\.py$/.test(f), find: LEXERS.python },
  { id: "ignore", pick: (f) => /(?:^|\/)\.(?:git|assets)ignore$/.test(f), find: LEXERS.ignore },
];

const memo = (fn) => {
  const seen = new Map();
  return (key, text) => {
    let inner = seen.get(key);
    if (!inner) seen.set(key, (inner = new Map()));
    if (!inner.has(text)) inner.set(text, fn(key, text));
    return inner.get(text);
  };
};
const lexed = memo((lang, text) => lang.find(text));
const importsIn = memo((file, text) => { try { return { specs: parseImports(text, file) }; } catch (error) { return { error: String(error.message) }; } });

function comments(tree) {
  const problems = [];
  const scanned = {};
  for (const file of tree.files) {
    if (file.startsWith("docs/")) continue;
    const lang = LANGUAGES.find((l) => l.pick(file));
    if (!lang) continue;
    scanned[lang.id] = (scanned[lang.id] || 0) + 1;
    const text = tree.read(file);
    const at = lexed(lang, text);
    if (at >= 0) problems.push(`${file}:${lines(text, at)} carries a ${lang.id} comment`);
  }
  return { problems, scanned };
}

const FLOORS = {
  flows: { label: "Flows", safari: 17, chrome: 114, firefox: 125 },
  lab: { label: "Lab and articles", safari: 16.4, chrome: 111, firefox: 113 },
};

const NEVER = Infinity;

const FEATURES = [
  {
    id: "Popover API",
    use: /\.(?:show|hide|toggle)Popover\b|:popover-open|\bpopovertarget\b|\bpopover\s*:\s*["']|["']popover["']\s*:/g,
    guards: [/["']popover["']\s+in\b/, /typeof\s+[\w$.]*(?:show|hide|toggle)Popover/],
    min: { safari: 17, chrome: 114, firefox: 125 },
  },
  { id: "regex lookbehind", use: /\(\?<[=!]/g, guards: [], min: { safari: 16.4, chrome: 62, firefox: 78 } },
  { id: "AbortSignal.timeout", use: /\bAbortSignal\.timeout\b/g, member: "AbortSignal.timeout", min: { safari: 16, chrome: 103, firefox: 100 } },
  { id: "AbortSignal.any", use: /\bAbortSignal\.any\b/g, member: "AbortSignal.any", min: { safari: 17.4, chrome: 116, firefox: 124 } },
  { id: "Array findLast", use: /\.findLast(?:Index)?\b/g, guards: [/typeof\s+[\w$.]+\.findLast/], min: { safari: 15.4, chrome: 97, firefox: 104 } },
  { id: "Array toSorted family", use: /\.(?:toSorted|toReversed|toSpliced)\b/g, guards: [/typeof\s+[\w$.]+\.to(?:Sorted|Reversed|Spliced)/], min: { safari: 16, chrome: 110, firefox: 115 } },
  { id: "Object.groupBy", use: /\b(?:Object|Map)\.groupBy\b/g, member: "Object.groupBy", min: { safari: 17.4, chrome: 117, firefox: 119 } },
  { id: "Promise.withResolvers", use: /\bPromise\.withResolvers\b/g, member: "Promise.withResolvers", min: { safari: 17.4, chrome: 119, firefox: 121 } },
  { id: "Array.fromAsync", use: /\bArray\.fromAsync\b/g, member: "Array.fromAsync", min: { safari: 16.4, chrome: 121, firefox: 115 } },
  { id: "requestIdleCallback", use: /\brequestIdleCallback\b/g, member: "requestIdleCallback", min: { safari: NEVER, chrome: 47, firefox: 55 } },
  { id: "View Transitions", use: /\bstartViewTransition\b/g, member: "startViewTransition", min: { safari: 18, chrome: 111, firefox: NEVER } },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function guardsOf(feature) {
  const out = [...(feature.guards || [])];
  if (feature.member) {
    const m = esc(feature.member);
    const last = esc(feature.member.split(".").pop());
    out.push(
      new RegExp(`${m}\\s*(?:\\?\\.|\\|\\||&&|\\?\\s)`),
      new RegExp(`typeof\\s+${m}`),
      new RegExp(`["']${last}["']\\s+in\\s+${esc(feature.member.split(".")[0])}`),
      new RegExp(`if\\s*\\([^)\\n]*${m}`),
      new RegExp(`${m}\\s*\\)?\\s*(?:\\?\\?|!==|===|!=|==)`),
    );
  }
  return out;
}

const surfaceOf = (file) => (/^assets\/js\/flows-[^/]*\.js$/.test(file) ? "flows" : "lab");

const FEATURE_GUARDS = new Map(FEATURES.map((f) => [f, guardsOf(f)]));

const floorOf = memo((file, text) => {
  const problems = [];
  const seen = {};
  const surface = FLOORS[surfaceOf(file)];
  for (const feature of FEATURES) {
    const guards = FEATURE_GUARDS.get(feature);
    for (const m of text.matchAll(new RegExp(feature.use.source, "g"))) {
      seen[feature.id] = (seen[feature.id] || 0) + 1;
      const above = ["safari", "chrome", "firefox"].filter((b) => feature.min[b] > surface[b]);
      if (!above.length) continue;
      const window = text.slice(Math.max(0, m.index - 600), m.index + m[0].length + 120);
      if (guards.some((g) => g.test(window))) continue;
      const needs = above.map((b) => `${b} ${feature.min[b] === NEVER ? "(never)" : feature.min[b]}`).join(", ");
      problems.push(`${file}:${lines(text, m.index)} uses ${feature.id} unguarded, which needs ${needs}; the ${surface.label} floor is Safari ${surface.safari} / Chrome ${surface.chrome} / Firefox ${surface.firefox}`);
    }
  }
  return { problems, seen };
});

function floor(tree) {
  const problems = [];
  const seen = {};
  for (const file of tree.files.filter((f) => /^assets\/js\/[^/]+\.js$/.test(f))) {
    const got = floorOf(file, tree.read(file));
    problems.push(...got.problems);
    for (const [id, n] of Object.entries(got.seen)) seen[id] = (seen[id] || 0) + n;
  }
  return { problems, seen };
}

const GLOBAL_PROOF = "every global a script under assets/js creates is on the AGENTS.md allowlist";

function run(tree) {
  const g = graph(tree);
  return {
    g,
    resolve: g.problems,
    cycle: cycles(g),
    layer: layers(g),
    asset: assets(tree),
    leaf: leaves(g),
    comment: comments(tree),
    floor: floor(tree),
  };
}

const real = run(realTree);

{
  deep(real.resolve, [], "every relative import in worker.js, shared/ and scripts/ resolves to a tracked file");
  deep(real.g.unfollowable, UNFOLLOWABLE, "the two modules with a non-literal import() are the preview tool and the launch-readiness tool, which no entry point reaches");
  ok(real.g.nodes.length > 100, `the walk covers ${real.g.nodes.length} modules`);
  const edgeCount = [...real.g.edges.values()].reduce((n, e) => n + e.length, 0);
  ok(edgeCount > 200, `and ${edgeCount} import edges, so a cycle test cannot pass on an empty graph`);
  deep(real.cycle.found, [], `NO IMPORT CYCLE from worker.js, the pipeline or any script (${real.cycle.walked} modules walked): a cycle leaves a const in its temporal dead zone and the Worker throws at module evaluation, taking every route down`);
  deep(real.layer, [], "every import respects the layer table: shared/ imports shared/ only, scripts/ never server/, no cloudflare:* outside worker.js");
  deep(real.asset, [], "assets/js carries no import or export statement");
  deep(real.leaf, [], "the declared leaves import exactly their declared set");
  const dynamicLiteral = real.g.nodes.filter((f) => (real.g.edges.get(f) || []).some((e) => e.dynamic));
  ok(dynamicLiteral.length >= 1, `${dynamicLiteral.length} modules use a literal dynamic import(), and the cycle walk follows them`);
}

{
  deep(real.comment.problems, [], "no tracked source file carries a comment, in any of eight languages (docs/ excluded)");
  for (const [lang, floorN] of Object.entries({ javascript: 200, css: 10, html: 8, sql: 8, yaml: 3, toml: 1, python: 2, ignore: 2 })) {
    ok((real.comment.scanned[lang] || 0) >= floorN, `the ${lang} scan read ${real.comment.scanned[lang] || 0} files, at least ${floorN}`);
  }
}

{
  deep(real.floor.problems, [], "no asset script uses an API above its surface's floor without a guard");
  ok((real.floor.seen["Popover API"] || 0) >= 3, `the scan sees the Popover API in ${real.floor.seen["Popover API"] || 0} places`);
  ok((real.floor.seen["regex lookbehind"] || 0) >= 1, "and the lookbehind that sets the Lab floor");
  ok((real.floor.seen["requestIdleCallback"] || 0) >= 1 && (real.floor.seen["View Transitions"] || 0) >= 1, "and the guarded uses of APIs Safari lacks");
  ok((real.floor.seen["AbortSignal.timeout"] || 0) >= 1, "and AbortSignal.timeout, which is inside both floors");
  eq(FLOORS.flows.safari, 17, "the Flows floor is Safari 17 (the Popover API)");
  eq(FEATURES.find((f) => f.id === "Popover API").min.safari, 17, "and the table lists the Popover API at 17");
  eq(FEATURES.find((f) => f.id === "regex lookbehind").min.safari, 16.4, "and the lookbehind at 16.4, the Lab floor");
  expect(moduleSource("tests/contracts.mjs"), GLOBAL_PROOF, { min: 1, why: "contracts.mjs holds the global allowlist against AGENTS.md" });
  expect(moduleSource("AGENTS.md"), "This list is an ALLOWLIST", { min: 1, why: "AGENTS.md states the allowlist the contract reads" });
}

const bad = (list) => list.length > 0;
const mutations = [];
const mutate = (name, edits, pick, expectFail = true) => mutations.push({ name, edits, pick, expectFail });

mutate("a cycle between two shared modules", {
  "shared/zz-a.js": 'import { b } from "./zz-b.js";\nexport const a = b;\n',
  "shared/zz-b.js": 'import { a } from "./zz-a.js";\nexport const b = a;\n',
}, (r) => r.cycle.found);
mutate("a dynamic import closing a cycle", {
  "shared/zz-a.js": 'export const a = () => import("./zz-b.js");\n',
  "shared/zz-b.js": 'import { a } from "./zz-a.js";\nexport const b = a;\n',
}, (r) => r.cycle.found);
mutate("a route importing another route", {
  "server/routes/zz-a.js": 'import { b } from "./zz-b.js";\nexport const a = b;\n',
  "server/routes/zz-b.js": "export const b = 1;\n",
}, (r) => r.layer);
mutate("a service importing a route", {
  "server/zz.js": 'import { b } from "./routes/zz-b.js";\nexport const a = b;\n',
  "server/routes/zz-b.js": "export const b = 1;\n",
}, (r) => r.layer);
mutate("shared/ importing scripts/", {
  "shared/zz.js": 'import { x } from "../scripts/zz.mjs";\nexport const a = x;\n',
  "scripts/zz.mjs": "export const x = 1;\n",
}, (r) => r.layer);
mutate("scripts/ importing server/", {
  "scripts/zz.mjs": 'import { x } from "../server/zz.js";\nexport const a = x;\n',
  "server/zz.js": "export const x = 1;\n",
}, (r) => r.layer);
mutate("scripts/ importing a test helper other than the suite registry", {
  "scripts/zz.mjs": 'import { x } from "../tests/lib/zz.mjs";\nexport const a = x;\n',
  "tests/lib/zz.mjs": "export const x = 1;\n",
}, (r) => r.layer);
mutate("scripts/ importing the suite registry is allowed", {
  "scripts/zz.mjs": 'import { ROOT } from "../tests/lib/suite-registry.mjs";\nexport const a = ROOT;\n',
}, (r) => r.layer, false);
mutate("shared/ importing a node builtin", { "shared/zz.js": 'import fs from "node:fs";\nexport const a = fs;\n' }, (r) => r.layer);
mutate("cloudflare:* in shared/", { "shared/zz.js": 'import { DurableObject } from "cloudflare:workers";\nexport const a = DurableObject;\n' }, (r) => r.layer);
mutate("cloudflare:* in server/", { "server/zz.js": 'import { DurableObject } from "cloudflare:workers";\nexport const a = DurableObject;\n' }, (r) => r.layer);
mutate("cloudflare:* in worker.js alone is allowed", {
  "worker.js": 'import { DurableObject } from "cloudflare:workers";\n' + realTree.read("worker.js"),
}, (r) => r.layer, false);
mutate("an import statement in assets/js", { "assets/js/zz.js": 'import { a } from "./b.js";\n' }, (r) => r.asset);
mutate("a leaf that gains an import", {
  "shared/flows-focus.js": 'import { x } from "./flows-rt.js";\n' + realTree.read("shared/flows-focus.js"),
}, (r) => r.leaf);
mutate("a leaf that loses its declared import", {
  "shared/flows-dossier.js": realTree.read("shared/flows-dossier.js").replace(/^import[^\n]*flows-cross\.js";\n/m, ""),
}, (r) => r.leaf);
mutate("an import that does not resolve", { "shared/zz.js": 'import { x } from "./missing.js";\nexport const a = x;\n' }, (r) => r.resolve);

const COMMENTS = {
  "tests/zz.mjs": "const a = 1; // note\n",
  "assets/css/zz.css": "a { color: red; } /* note */\n",
  "zz.html": "<!doctype html><!-- note --><p>x</p>\n",
  "zz-inline.html": "<!doctype html><script>const a = 1; // note\n</script>\n",
  "zz-style.html": "<!doctype html><style>a { color: red; } /* note */</style>\n",
  "schema/zz.sql": "SELECT 1; -- note\n",
  "schema/zz2.sql": "SELECT 1; /* note */\n",
  ".github/workflows/zz.yml": "on: push # note\n",
  "zz.toml": 'name = "x" # note\n',
  "scripts/zz.py": "x = 1  # note\n",
  ".assetsignore": "# note\nnode_modules/\n",
};
for (const [file, text] of Object.entries(COMMENTS)) {
  mutate(`a comment in ${file}`, { [file]: text }, (r) => r.comment.problems);
}
mutate("a .gitignore comment", { ".gitignore": "# note\n" + realTree.read(".gitignore") }, (r) => r.comment.problems);

mutate("an unguarded AbortSignal.any in a Lab script", {
  "assets/js/zz.js": "(function () { const s = AbortSignal.any([a, b]); })();\n",
}, (r) => r.floor.problems);
mutate("an unguarded AbortSignal.any in a Flows script", {
  "assets/js/flows-zz.js": "(function () { const s = AbortSignal.any([a, b]); })();\n",
}, (r) => r.floor.problems);
mutate("AbortSignal.any?.() passes", {
  "assets/js/flows-zz.js": "(function () { const s = AbortSignal.any?.([a, b]); })();\n",
}, (r) => r.floor.problems, false);
mutate("a typeof guard passes", {
  "assets/js/flows-zz.js": 'if (typeof AbortSignal.any === "function") { const s = AbortSignal.any([a, b]); }\n',
}, (r) => r.floor.problems, false);
mutate("AbortSignal.timeout is inside both floors", {
  "assets/js/zz.js": "(function () { const s = AbortSignal.timeout(1000); })();\n",
}, (r) => r.floor.problems, false);
mutate("the Popover API in a Lab script", {
  "assets/js/zz.js": 'document.getElementById("a").showPopover();\n',
}, (r) => r.floor.problems);
mutate("the Popover API in a Flows script is at its floor", {
  "assets/js/flows-zz.js": 'document.getElementById("a").showPopover();\n',
}, (r) => r.floor.problems, false);
mutate("a guarded Popover API in a Lab script", {
  "assets/js/zz.js": 'if ("popover" in HTMLElement.prototype) document.getElementById("a").showPopover();\n',
}, (r) => r.floor.problems, false);
mutate(":popover-open in a Lab script", { "assets/js/zz.js": 'el.matches(":popover-open");\n' }, (r) => r.floor.problems);
mutate("a lookbehind in a Lab script is at the Lab floor", { "assets/js/zz.js": "const r = /(?<=a)b/;\n" }, (r) => r.floor.problems, false);
mutate("an unguarded requestIdleCallback", { "assets/js/zz.js": "requestIdleCallback(fn);\n" }, (r) => r.floor.problems);
mutate("a guarded requestIdleCallback", { "assets/js/zz.js": "const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));\nidle(fn);\n" }, (r) => r.floor.problems, false);
mutate("toSorted on a Lab script", { "assets/js/zz.js": "const s = list.toSorted();\n" }, (r) => r.floor.problems);

for (const m of mutations) {
  const r = run(withEdits(realTree, m.edits));
  const found = m.pick(r);
  if (m.expectFail) ok(bad(found), `MUTATION: ${m.name} is caught (${found[0] || "nothing"})`);
  else deep(found, [], `MUTATION: ${m.name} is not a violation`);
}

{
  const before = LEXERS;
  const cases = [
    ["css", 'a { content: "/* not */"; background: url(data:image/svg+xml;utf8,<svg xmlns="http://x"/>); }', false],
    ["css", "a { color: red; } /* c */", true],
    ["sql", "INSERT INTO t VALUES ('--', '/* x */', \"a--b\");", false],
    ["sql", "SELECT 1; -- c", true],
    ["sql", "SELECT 1 /* c */", true],
    ["toml", 'a = "x # y"\nb = \'# z\'\nc = """\n# inside\n"""\n', false],
    ["toml", 'a = 1 # c', true],
    ["python", "#!/usr/bin/env python3\nx = '# not'\ny = \"\"\"\n# not\n\"\"\"\n", false],
    ["python", "x = 1  # c", true],
    ["python", "#!/usr/bin/env python3\n# c\n", true],
    ["yaml", 'a: "x # y"\nb: \'# z\'\nc: https://e.org/#frag\nd: don\'t\n', false],
    ["yaml", "a: 1 # c", true],
    ["yaml", "# c\na: 1", true],
    ["ignore", "node_modules/\n*.log\na#b\n", false],
    ["ignore", "node_modules/\n# c\n", true],
  ];
  for (const [lang, src, want] of cases) eq(before[lang](src) >= 0, want, `lexer ${lang}: ${want ? "finds" : "ignores"} ${JSON.stringify(src.slice(0, 40))}`);
  const html = LANGUAGES.find((l) => l.id === "html");
  eq(html.find("<p>a <b>--</b></p><script>const u = 'http://x//y';</script>") >= 0, false, "html: a URL in an inline script is not a comment");
  eq(html.find("<script type=\"application/ld+json\">{\"a\":\"// x\"}</script>") >= 0, false, "html: JSON-LD is not scanned as code");
}

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok(ms < 5000, `the whole suite ran in ${Math.round(ms)} ms`);
console.log(`✓ architecture: ${checks} assertions - import cycles over static and literal dynamic imports, the layer table, declared leaves, no comments in eight languages, the browser floor table, ${mutations.length} recorded mutations that must each be caught or passed, in ${Math.round(ms)} ms`);
