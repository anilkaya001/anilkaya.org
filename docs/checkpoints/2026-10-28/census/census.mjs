import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [, , rootArg, specFile, outFile] = process.argv; const root = path.resolve(rootArg);
const spec = JSON.parse(fs.readFileSync(specFile, "utf8")).info;
const norm = (p) => p.replace(/\{[^}]*\}/g, "{}");
const specByNorm = new Map();
for (const p of Object.keys(spec)) { if (specByNorm.has(norm(p))) throw new Error("spec norm clash " + p); specByNorm.set(norm(p), p); }
const reg = await import(pathToFileURL(path.join(root, "shared/flows-vendor-ops.js")).href);
const OPS = reg.OPS;
const regSrc = fs.readFileSync(path.join(root, "shared/flows-vendor-ops.js"), "utf8");
if (/^\s*import\s/m.test(regSrc)) throw new Error("registry imports something");
const IMPORT_RE = /(?:^|[^.\w$])(?:import|export)\s*(?:[\w*{}\s,$]+?\s*from\s*)?["']([^"']+)["']|(?:^|[^.\w$])import\(\s*["']([^"']+)["']\s*\)/gm;
const closure = new Set();
const visit = (file) => {
  if (closure.has(file)) return;
  if (!fs.existsSync(file)) { console.error("missing", file); return; }
  closure.add(file);
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith(".")) continue;
    visit(path.resolve(path.dirname(file), spec));
  }
};
visit(path.join(root, "worker.js"));
const workerClosure = new Set(closure);
visit(path.join(root, "scripts/flows-pipeline.mjs"));
const rel = (f) => path.relative(root, f);
const FAKE = /(-fake\.mjs|fake-vendor\.mjs|\/fixtures\.mjs|live-day\.mjs|live-world-fake\.mjs|taint\.mjs)$/;
const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
const declared = new Set([...walk(path.join(root, "server")), ...walk(path.join(root, "shared")), ...walk(path.join(root, "scripts/flows-nightly")), ...walk(path.join(root, "scripts/flows-legs")), path.join(root, "scripts/flows-pipeline.mjs"), path.join(root, "worker.js")].filter((f) => /\.(m?js)$/.test(f) && !FAKE.test(f)));
const prod = new Set([...closure].filter((f) => !FAKE.test(f)));
const declaredNotReached = [...declared].filter((f) => !closure.has(f)).map(rel);
const closureOutsideDeclared = [...prod].filter((f) => !declared.has(f)).map(rel);
const files = [...new Set([...prod, ...declared])].filter((f) => !f.endsWith("shared/flows-vendor-ops.js"));
const srcs = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const entries = OPS.map((e) => {
  const target = e.op || e.path;
  const specPath = specByNorm.get(norm(target)) || null;
  const pathInSpec = specByNorm.get(norm(e.path)) || null;
  const mentions = [];
  const re = new RegExp(`(["'\`])${e.id.replace(/[-]/g, "\\-")}\\1`, "g");
  for (const [f, s] of srcs) {
    const lines = s.split("\n");
    lines.forEach((ln, i) => { if (re.test(ln)) mentions.push({ file: rel(f), line: i + 1, reached: closure.has(f), text: ln.trim().slice(0, 240) }); re.lastIndex = 0; });
  }
  return { id: e.id, path: e.path, op: e.op || null, method: e.method, liveOnly: !!e.liveOnly, limiter: e.limiter, specPath, pathInSpec, inSpecCounted: !!specPath && !e.liveOnly, mentions };
});
const out = { root, nEntries: OPS.length, closureSize: closure.size, workerClosure: workerClosure.size, declaredNotReached, closureOutsideDeclared, methods: [...new Set(OPS.map((e) => e.method))], entries };
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
const counted = entries.filter((e) => e.inSpecCounted);
const distinct = new Set(counted.map((e) => e.specPath));
console.log(`${root}: entries=${OPS.length} methods=${out.methods} inSpecCounted=${counted.length} distinctSpecPaths=${distinct.size} liveOnly=${entries.filter((e) => e.liveOnly).map((e) => e.id)} notInSpecNonLive=${entries.filter((e) => !e.liveOnly && !e.specPath).map((e) => e.id)} noMentions=${entries.filter((e) => !e.mentions.length).map((e) => e.id)} noReachedMentions=${entries.filter((e) => !e.mentions.some((m) => m.reached)).map((e) => e.id)}`);
console.log("  declared-but-unreached files:", declaredNotReached.length, JSON.stringify(declaredNotReached));
console.log("  closure files outside declared prod dirs:", JSON.stringify(closureOutsideDeclared));
