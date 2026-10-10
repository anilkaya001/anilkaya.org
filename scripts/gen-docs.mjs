import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { trackedFiles, walkImports, entriesOf, globMatches } from "../tests/lib/suite-registry.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const GENERATED = ["AGENTS.md", "docs/index.md"];
export const REGIONS = ["courses", "globals", "suites-local", "filemap", "suites-server"];
export const DOMAINS = [
  ["site", "The landing page, articles and site-wide assets"],
  ["lab", "The Econometrics Lab: courses, review, placement, projects and their storage"],
  ["worker", "The Worker, its configuration, schema and migrations"],
  ["flows-server", "Flows logic shared by the Worker, the pipeline and the browser bundles"],
  ["flows-rail", "The real-time rail"],
  ["flows-pipeline", "The nightly pipeline, the live leg and their tools"],
  ["flows-client", "Flows pages, scripts and styles"],
  ["tooling", "Generators and authoring tools"],
  ["tests", "Suites, helpers and fixtures"],
  ["ci", "GitHub Actions workflows"],
  ["config", "Repository configuration"],
  ["docs", "Documents and the generated index"],
];
const WIDTH = 80;
const MAX_SUITES_SHOWN = 6;

const wrap = (words, indent, width = WIDTH) => {
  const lines = [];
  let line = indent;
  for (const w of words) {
    if (line.trim() && line.length + 1 + w.length > width) { lines.push(line); line = indent + w; }
    else line += (line.trim() ? " " : "") + w;
  }
  if (line.trim()) lines.push(line);
  return lines.join("\n");
};

const columns = (names, per = 4, pad = 26) => {
  const out = [];
  for (let i = 0; i < names.length; i += per) out.push(names.slice(i, i + per).map((n) => n.padEnd(pad)).join("").trimEnd());
  return out.join("\n");
};

const isExact = (g) => !/[*?]/.test(g);
const literalLength = (g) => g.replace(/[*?]/g, "").length;

function loadCatalog(read) {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(read("assets/js/course-catalog.js"), context, { filename: "assets/js/course-catalog.js" });
  return { topics: context.window.TOPIC_META, paths: context.window.LEARNING_PATHS };
}

function coursesRegion(read) {
  const { topics, paths } = loadCatalog(read);
  const stages = topics.reduce((n, t) => n + t.stages, 0);
  const review = JSON.parse(read("assets/data/review-bank.json")).items.length;
  const skills = JSON.parse(read("assets/data/skill-graph.json")).skills.length;
  const variants = JSON.parse(read("assets/data/challenge-bank.json")).items.length;
  const cells = topics.map((t) => `${t.id} ${t.stages}`);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(" · "));
  const byModules = new Map();
  for (const t of topics) byModules.set(t.modules, [...(byModules.get(t.modules) || []), t.id]);
  const modules = [...byModules.entries()].sort((a, b) => a[0] - b[0]).map(([n, ids]) => `${n} modules: ${ids.map((i) => `\`${i}\``).join(", ")}`).join("; ");
  return [
    "",
    `\`window.TOPIC_META\` in the lightweight \`course-catalog.js\` holds ${topics.length} courses`,
    `(${stages} stages in all, which \`tests/contracts.mjs\` and \`tests/academy-contract.mjs\``,
    "pin):",
    "",
    "```text",
    ...rows,
    "```",
    "",
    wrap(`Courses by module count, each module owning ordered stages: ${modules}.`.split(" "), ""),
    `The generated review bank holds ${review} items, the skill graph ${skills} skills,`,
    `the challenge bank ${variants} variants, and \`LEARNING_PATHS\` ${paths.length} guided paths.`,
    "",
  ].join("\n");
}

function globalsRegion(globals) {
  const names = globals.production.map((n) => `\`${n}\``);
  const tokens = names.slice(0, -1).map((n) => `${n},`);
  tokens.push("and", `${names[names.length - 1]}.`);
  return "\n" + wrap(tokens, "  ", WIDTH) + "\n  ";
}

function suitesLocalRegion(manifest) {
  const by = (c) => manifest.suites.filter((s) => s.class === c).map((s) => s.name);
  const n = by("N");
  const c = by("C");
  const w = by("W");
  return [
    "",
    `\`tests/suites.json\` registers ${manifest.suites.length} suites: ${n.length} that need only Node (N), ${c.length} that also`,
    `need Playwright's Chromium (C) and ${w.length} that boot workerd (W). The class is derived from`,
    "each suite's import closure, so this list cannot drift from it. A name is the",
    "`test:<name>` script in `tests/package.json`: run one with `npm run test:<name>` or",
    "`node run.mjs --only <name>` from `tests/`.",
    "",
    "Confirmed to run with no server and no browser (N):",
    "",
    "```",
    columns(n),
    "```",
    "",
    "Confirmed to run with no server but with Chromium (C; set `PLAYWRIGHT_BROWSERS_PATH`):",
    "",
    "```",
    columns(c),
    "```",
    "",
  ].join("\n");
}

function suitesServerRegion(manifest) {
  const w = manifest.suites.filter((s) => s.class === "W").map((s) => s.name);
  return [
    "",
    "Confirmed to need one (W; set `FLOWS_TEST_SANDBOX=1` in the agent sandbox):",
    "",
    "```",
    columns(w),
    "```",
    "",
  ].join("\n");
}

function fileMapRegion(modules) {
  return [
    "",
    "| Path | Role |",
    "|---|---|",
    ...modules.filter((m) => m.show).map((m) => `| ${m.show} | ${m.role} |`),
    "",
  ].join("\n");
}

export function replaceRegions(text, regions) {
  const problems = [];
  let out = text;
  for (const name of REGIONS) {
    const rx = new RegExp(`(<!-- gen:${name} -->)([\\s\\S]*?)(<!-- /gen:${name} -->)`);
    const m = out.match(rx);
    if (!m) { problems.push(`AGENTS.md has no <!-- gen:${name} --> region`); continue; }
    if ((out.match(new RegExp(`<!-- gen:${name} -->`, "g")) || []).length !== 1) { problems.push(`AGENTS.md has more than one gen:${name} region`); continue; }
    out = out.replace(rx, (_, a, _b, c) => a + regions[name] + c);
  }
  return { text: out, problems };
}

export function assign(modules, tracked) {
  const best = new Map();
  const dead = [];
  modules.forEach((row, i) => {
    for (const g of row.paths) {
      let hit = false;
      for (const f of tracked) {
        if (!globMatches(g, f)) continue;
        hit = true;
        const score = [isExact(g) ? 1 : 0, literalLength(g), -i];
        const cur = best.get(f);
        if (!cur || score[0] > cur.score[0] || (score[0] === cur.score[0] && (score[1] > cur.score[1] || (score[1] === cur.score[1] && score[2] > cur.score[2])))) best.set(f, { row: i, glob: g, score });
      }
      if (!hit) dead.push(`${row.paths.join(", ")}: "${g}" matches no file`);
    }
  });
  const uncovered = [...tracked].filter((f) => !best.has(f)).sort();
  return { best, dead, uncovered };
}

const EXPORT_DECL = /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

export function exportsOf(text) {
  const out = new Set();
  for (const m of text.matchAll(EXPORT_DECL)) out.add(m[1]);
  for (const m of text.matchAll(EXPORT_LIST)) {
    for (const part of m[1].split(",")) {
      const piece = part.trim();
      if (!piece) continue;
      const as = piece.split(/\s+as\s+/);
      out.add((as[1] || as[0]).trim());
    }
  }
  if (/^export\s+default\b/m.test(text)) out.add("default");
  return [...out].sort();
}

export function suiteMatrix(root, manifest, tracked) {
  const matrix = new Map();
  const add = (file, name) => { if (!matrix.has(file)) matrix.set(file, new Set()); matrix.get(file).add(name); };
  for (const suite of manifest.suites) {
    const scan = walkImports(root, entriesOf(suite.files || []));
    for (const f of scan.files) add(f, suite.name);
    for (const g of suite.covers || []) {
      if (g === "**") continue;
      for (const f of tracked) if (globMatches(g, f)) add(f, suite.name);
    }
  }
  return matrix;
}

function indexText({ modules, tracked, best, read, matrix }) {
  const files = [...tracked].sort();
  const out = [
    "# Module index",
    "",
    "Generated by `node scripts/gen-docs.mjs` from `docs/modules.json`, `docs/globals.json`,",
    "`tests/suites.json`, the import graph and the sources themselves. Do not edit it:",
    "`tests/docs-contract.mjs` regenerates it and fails on any difference. The frozen",
    "system map is `docs/map-2026-10-05.md`; it is a snapshot, and `node scripts/map/audit.mjs`",
    "reports how many of its `path:line` references still resolve.",
    "",
    `${files.length} files in ${modules.length} rows. A file belongs to the most specific row that names it (an exact path, else the glob with the most literal characters).`,
    "",
    "The suites column lists the suites whose import closure reaches the file or whose `covers`",
    "in `tests/suites.json` name it, from `tests/suites.json`'s own fields; `**` covers are left out.",
    "",
  ];
  const byDomain = new Map(DOMAINS.map(([d]) => [d, new Map()]));
  for (const f of files) {
    const hit = best.get(f);
    const row = modules[hit.row];
    const rows = byDomain.get(row.domain);
    if (!rows) throw new Error(`docs/modules.json: unknown domain "${row.domain}"`);
    if (!rows.has(hit.row)) rows.set(hit.row, []);
    rows.get(hit.row).push(f);
  }
  out.push("## Domains", "");
  for (const [d, label] of DOMAINS) {
    const rows = byDomain.get(d);
    const n = [...rows.values()].reduce((a, v) => a + v.length, 0);
    out.push(`- [${d}](#${d}): ${label} (${n} files)`);
  }
  out.push("");
  for (const [d, label] of DOMAINS) {
    const rows = byDomain.get(d);
    out.push(`## ${d}`, "", `${label}.`, "");
    for (const i of [...rows.keys()].sort((a, b) => a - b)) {
      const row = modules[i];
      const listed = rows.get(i);
      out.push(`### ${row.paths.map((p) => `\`${p}\``).join(", ")}`, "", row.role, "", "| File | Exports | Suites |", "|---|---|---|");
      for (const f of listed) {
        let ex = "";
        if (/\.(?:m?js)$/.test(f) && !f.startsWith("assets/")) ex = exportsOf(read(f)).map((s) => `\`${f}#${s}\``).join(", ");
        const suites = [...(matrix.get(f) || [])].sort();
        const shown = suites.length > MAX_SUITES_SHOWN ? `${suites.slice(0, MAX_SUITES_SHOWN).join(", ")} and ${suites.length - MAX_SUITES_SHOWN} more` : suites.join(", ");
        out.push(`| \`${f}\` | ${ex} | ${shown} |`);
      }
      out.push("");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

export function buildAll({ root = ROOT, tracked = trackedFiles(root), read, matrix, withIndex = true } = {}) {
  const rd = read || ((rel) => readFileSync(path.join(root, rel), "utf8"));
  const problems = [];
  const all = new Set([...tracked, ...GENERATED]);
  const modules = JSON.parse(rd("docs/modules.json"));
  const globals = JSON.parse(rd("docs/globals.json"));
  const manifest = JSON.parse(rd("tests/suites.json"));
  const { best, dead, uncovered } = assign(modules, all);
  for (const f of uncovered) problems.push(`${f} is a tracked file that no row of docs/modules.json names`);
  for (const d of dead) problems.push(`docs/modules.json row ${d}`);
  for (const [i, row] of modules.entries()) {
    if (!Array.isArray(row.paths) || !row.paths.length || typeof row.role !== "string" || !row.role || !DOMAINS.some(([d]) => d === row.domain)) problems.push(`docs/modules.json row ${i} needs paths, a role and a known domain`);
  }
  const regions = {
    courses: coursesRegion(rd),
    globals: globalsRegion(globals),
    "suites-local": suitesLocalRegion(manifest),
    filemap: fileMapRegion(modules),
    "suites-server": suitesServerRegion(manifest),
  };
  const replaced = replaceRegions(rd("AGENTS.md"), regions);
  problems.push(...replaced.problems);
  let index = null;
  if (withIndex && !problems.length) {
    index = indexText({ modules, tracked: all, best, read: rd, matrix: matrix || suiteMatrix(root, manifest, all) });
  }
  return { agents: replaced.text, index, problems, modules, best };
}

function main() {
  const check = process.argv.includes("--check");
  const out = buildAll();
  if (out.problems.length) {
    console.error(out.problems.map((p) => `gen-docs: ${p}`).join("\n"));
    process.exit(1);
  }
  const drift = [];
  for (const [rel, text] of [["AGENTS.md", out.agents], ["docs/index.md", out.index]]) {
    let current = null;
    try { current = readFileSync(path.join(ROOT, rel), "utf8"); } catch {}
    if (current === text) continue;
    if (check) drift.push(rel);
    else writeFileSync(path.join(ROOT, rel), text);
  }
  if (drift.length) {
    console.error(`gen-docs: ${drift.join(" and ")} differ from the generator; run node scripts/gen-docs.mjs`);
    process.exit(1);
  }
  console.log(check ? "gen-docs: AGENTS.md and docs/index.md are current" : "gen-docs: wrote AGENTS.md and docs/index.md");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
