import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT = "(?:js|mjs|css|html|sql|toml|yml|yaml|json|md|py|txt)";
const REF = new RegExp("`?((?:[A-Za-z0-9_.\\-]+/)*[A-Za-z0-9_.\\-]+\\." + EXT + ")`?[: ]?:(\\d+)(?:[-\\u2013](\\d+))?", "g");
export const DEFAULT_TARGETS = ["AGENTS.md", "DEPLOY.md", "README.md", "docs/map-2026-10-05.md"];

export function makeResolver(files) {
  const set = new Set(files);
  const byBase = new Map();
  for (const f of files) {
    const b = f.slice(f.lastIndexOf("/") + 1);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  return (p) => {
    const bare = p.replace(/^`|`$/g, "").replace(/^(?:\.\/)+/, "");
    if (set.has(bare)) return bare;
    const cands = byBase.get(bare.slice(bare.lastIndexOf("/") + 1)) || [];
    const suffixed = cands.filter((c) => c.endsWith(bare));
    if (suffixed.length === 1) return suffixed[0];
    if (cands.length === 1) return cands[0];
    return null;
  };
}

export function auditText(text, { files, lineCount }) {
  const resolve = makeResolver(files);
  const set = new Set(files);
  const out = { refs: 0, badFile: [], badLine: [] };
  text.split("\n").forEach((raw, i) => {
    for (const m of raw.matchAll(REF)) {
      out.refs++;
      const target = resolve(m[1]);
      if (target === null) {
        if (m[1].includes("/") || set.has(m[1])) out.badFile.push({ line: i + 1, ref: m[0] });
        else out.refs--;
        continue;
      }
      const lo = Number(m[2]);
      const hi = Number(m[3] || m[2]);
      const n = lineCount(target);
      if (n === null || lo < 1 || hi > n + 1) out.badLine.push({ line: i + 1, ref: m[0], lines: n });
    }
  });
  return out;
}

export function summarise(results) {
  const rows = results.map((r) => ({
    file: r.file,
    refs: r.refs,
    badFile: r.badFile.length,
    badLine: r.badLine.length,
    stale: r.refs ? (r.badFile.length + r.badLine.length) / r.refs : 0,
  }));
  const total = rows.reduce((a, r) => ({ refs: a.refs + r.refs, bad: a.bad + r.badFile + r.badLine }), { refs: 0, bad: 0 });
  return { rows, refs: total.refs, stale: total.bad, share: total.refs ? total.bad / total.refs : 0 };
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const targets = args.filter((a) => !a.startsWith("--"));
  const list = targets.length ? targets : DEFAULT_TARGETS;
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const cache = new Map();
  const lineCount = (rel) => {
    if (!cache.has(rel)) {
      const abs = path.join(ROOT, rel);
      cache.set(rel, existsSync(abs) ? readFileSync(abs, "utf8").split("\n").length : null);
    }
    return cache.get(rel);
  };
  const results = [];
  for (const rel of list) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) { console.error(`audit: ${rel} does not exist`); process.exit(2); }
    results.push({ file: rel, ...auditText(readFileSync(abs, "utf8"), { files, lineCount }) });
  }
  const sum = summarise(results);
  if (json) { console.log(JSON.stringify({ ...sum, details: results }, null, 1)); return; }
  for (const r of sum.rows) console.log(`${r.file.padEnd(32)} refs ${String(r.refs).padStart(5)}  missing file ${String(r.badFile).padStart(4)}  past end ${String(r.badLine).padStart(4)}  stale ${(r.stale * 100).toFixed(1)}%`);
  console.log(`TOTAL refs ${sum.refs} stale ${sum.stale} (${(sum.share * 100).toFixed(1)}%)`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = ["### Reference audit", "", "| Document | References | Missing file | Past end | Stale |", "|---|---|---|---|---|", ...sum.rows.map((r) => `| ${r.file} | ${r.refs} | ${r.badFile} | ${r.badLine} | ${(r.stale * 100).toFixed(1)}% |`), ""].join("\n");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
