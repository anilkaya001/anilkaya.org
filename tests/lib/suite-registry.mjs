import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const LAUNCHER = "tests/lib/browser.mjs";
export const CLASSES = ["N", "C", "W"];
export const GROUPS = ["fast", "shard"];
const SERVER = "tests/worker-server.mjs";
const STATIC = /(?:^|[;}])\s*(?:import|export)\b[^;]*?\bfrom\s*(["'])([^"'\n]+)\1|(?:^|[;}])\s*import\s*(["'])([^"'\n]+)\3/gm;
const DYNAMIC = /\bimport\s*\(\s*(?:"([^"\n]+)"|'([^'\n]+)')\s*\)/g;
const LITERAL = /(["'`])((?:\.{1,2}\/)*[A-Za-z0-9_@][A-Za-z0-9_.@\-/]*\.[A-Za-z0-9]{1,8})\1/g;
const FIELD_ORDER = ["name", "class", "group", "timing", "medianS", "timeoutS", "files", "covers"];

const posix = (p) => p.split(path.sep).join("/");

export function trackedFiles(root = ROOT) {
  const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean).filter((f) => existsSync(path.join(root, f)));
}

export function scriptFiles(command) {
  if (typeof command !== "string") return [];
  return [...command.matchAll(/(?:^|&&)\s*node\s+((?:--\S+\s+)*)(\S+\.mjs)/g)].map((m) => m[2]);
}

const specsOf = (text) => {
  const out = [];
  for (const m of text.matchAll(STATIC)) out.push(m[2] || m[4]);
  for (const m of text.matchAll(DYNAMIC)) out.push(m[1] || m[2]);
  return out;
};

export function walkImports(root, entries) {
  const seen = new Set();
  const bare = new Set();
  const queue = [];
  const add = (rel) => { if (!seen.has(rel)) { seen.add(rel); queue.push(rel); } };
  for (const e of entries) add(e);
  while (queue.length) {
    const rel = queue.shift();
    const abs = path.join(root, rel);
    if (rel === LAUNCHER || !existsSync(abs) || !/\.(?:m?js)$/.test(rel)) continue;
    const text = readFileSync(abs, "utf8");
    for (const spec of specsOf(text)) {
      if (!spec.startsWith(".")) { bare.add(spec); continue; }
      const target = posix(path.relative(root, path.resolve(path.dirname(abs), spec.replace(/[?#].*$/, ""))));
      if (existsSync(path.join(root, target))) add(target);
    }
  }
  return { files: seen, bare };
}

export function entriesOf(files) {
  return files.map((f) => (f.startsWith("../") ? f.slice(3) : "tests/" + f));
}

export function classOf(scan) {
  if (scan.files.has(SERVER)) return "W";
  if ([...scan.bare].some((b) => /^playwright(?:-core)?(?:\/|$)/.test(b))) return "C";
  return "N";
}

const globRx = (glob) => {
  let rx = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") { rx += ".*"; i++; if (glob[i + 1] === "/") i++; }
    else if (c === "*") rx += "[^/]*";
    else if (c === "?") rx += "[^/]";
    else rx += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + rx + "$");
};

export const globMatches = (glob, file) => globRx(glob).test(file);

export function literalReads(root, scan, tracked) {
  const set = new Set(tracked);
  const out = new Set();
  for (const rel of scan.files) {
    if (!rel.startsWith("tests/") || !/\.(?:m?js)$/.test(rel) || rel === LAUNCHER) continue;
    if (!existsSync(path.join(root, rel))) continue;
    const text = readFileSync(path.join(root, rel), "utf8");
    for (const m of text.matchAll(LITERAL)) {
      const lit = m[2];
      if (lit.includes("node_modules")) continue;
      const bare = lit.replace(/^(?:\.{1,2}\/)+/, "");
      const found = [bare, "tests/" + bare].find((c) => set.has(c));
      if (found && !scan.files.has(found)) out.add(found);
    }
  }
  return [...out].sort();
}

export function scanSuite(root, suite, command, tracked) {
  const files = scriptFiles(command);
  const scan = walkImports(root, entriesOf(files));
  return { files, scan, class: classOf(scan), reads: literalReads(root, scan, tracked) };
}

const listDir = (root, dir) => {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".mjs")).sort().map((f) => `${dir}/${f}`);
};

export function checkRegistry({ root = ROOT, manifest, pkg, tracked = trackedFiles(root) }) {
  const problems = [];
  const suites = Array.isArray(manifest && manifest.suites) ? manifest.suites : [];
  const scripts = (pkg && pkg.scripts) || {};
  const reached = new Set();
  const named = new Set();
  for (const s of suites) {
    const at = `suites.json: ${s.name}`;
    const command = scripts[`test:${s.name}`];
    if (typeof command !== "string") { problems.push(`${at} has no test:${s.name} script`); continue; }
    const got = scanSuite(root, s, command, tracked);
    for (const f of got.files) named.add(f.startsWith("../") ? f.slice(3) : "tests/" + f);
    for (const f of got.scan.files) reached.add(f);
    if (!Array.isArray(s.files) || s.files.join("\n") !== got.files.join("\n")) {
      problems.push(`${at} lists files ${JSON.stringify(s.files)}, but its script runs ${JSON.stringify(got.files)}`);
    }
    for (const f of got.files) {
      if (!existsSync(path.join(root, f.startsWith("../") ? f.slice(3) : "tests/" + f))) problems.push(`${at} runs ${f}, which does not exist`);
    }
    if (!CLASSES.includes(s.class)) problems.push(`${at} has class ${JSON.stringify(s.class)}, not N, C or W`);
    else if (s.class !== got.class) problems.push(`${at} is class ${s.class}, but its import closure makes it ${got.class} (${got.class === "W" ? "it imports tests/worker-server.mjs" : got.class === "C" ? "it imports playwright and boots no server" : "it imports neither playwright nor the worker server"})`);
    if (!GROUPS.includes(s.group)) problems.push(`${at} has group ${JSON.stringify(s.group)}, not fast or shard`);
    if (typeof s.timing !== "boolean") problems.push(`${at} has no boolean timing flag`);
    if (!Array.isArray(s.covers) || s.covers.some((c) => typeof c !== "string" || !c)) { problems.push(`${at} has no covers array of globs`); continue; }
    for (const c of s.covers) {
      if (!tracked.some((f) => globMatches(c, f))) problems.push(`${at} covers ${c}, which matches no file`);
    }
    for (const read of got.reads) {
      if (!s.covers.some((c) => globMatches(c, read))) problems.push(`${at} reads ${read} outside its import closure, and no covers entry names it`);
    }
  }
  const support = Array.isArray(manifest && manifest.support) ? manifest.support : null;
  if (!support) problems.push("suites.json: no support array naming the helper files");
  const supportSet = new Set(support || []);
  for (const f of [...listDir(root, "tests"), ...listDir(root, "tests/lib")]) {
    if (named.has(f)) {
      if (supportSet.has(f.slice(6))) problems.push(`suites.json: ${f.slice(6)} is both a suite file and in support`);
      continue;
    }
    if (!supportSet.has(f.slice(6))) problems.push(`${f} is in no suite's files and not in the support list, so nothing registers it`);
  }
  for (const f of supportSet) {
    if (!existsSync(path.join(root, "tests", f))) problems.push(`suites.json: support lists ${f}, which does not exist`);
    else if (!reached.has("tests/" + f)) problems.push(`suites.json: support lists tests/${f}, which no suite's import closure reaches`);
  }
  return problems;
}

const line = (s) => {
  const keys = [...FIELD_ORDER.filter((k) => s[k] !== undefined), ...Object.keys(s).filter((k) => !FIELD_ORDER.includes(k))];
  return "    {" + keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(s[k])}`).join(", ") + "}";
};

export function serialize(manifest) {
  const head = Object.keys(manifest).filter((k) => k !== "suites" && k !== "support");
  const parts = head.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k])}`);
  parts.push(`  "suites": [\n${manifest.suites.map(line).join(",\n")}\n  ]`);
  if (manifest.support) parts.push(`  "support": ${JSON.stringify(manifest.support)}`);
  return "{\n" + parts.join(",\n") + "\n}\n";
}

export function syncRegistry({ root = ROOT, manifest, pkg, tracked = trackedFiles(root) }) {
  const scripts = pkg.scripts || {};
  const named = new Set();
  const suites = manifest.suites.map((s) => {
    const command = scripts[`test:${s.name}`];
    const got = scanSuite(root, s, command, tracked);
    for (const f of got.files) named.add(f.startsWith("../") ? f.slice(3) : "tests/" + f);
    const covers = [...new Set([...(Array.isArray(s.covers) ? s.covers : []), ...got.reads])]
      .filter((c) => tracked.some((f) => globMatches(c, f))).sort();
    return { ...s, class: got.class, group: s.group || "shard", timing: s.timing === true, files: got.files, covers };
  });
  const support = [...listDir(root, "tests"), ...listDir(root, "tests/lib")].filter((f) => !named.has(f)).map((f) => f.slice(6));
  return { ...manifest, version: 2, suites, support };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifestPath = path.join(ROOT, "tests", "suites.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "tests", "package.json"), "utf8"));
  if (process.argv.includes("--write")) {
    writeFileSync(manifestPath, serialize(syncRegistry({ manifest, pkg })));
    console.log("suites.json rewritten");
  } else {
    const problems = checkRegistry({ manifest, pkg });
    for (const p of problems) console.error(p);
    process.exit(problems.length ? 1 : 0);
  }
}
