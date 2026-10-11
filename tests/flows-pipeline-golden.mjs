import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nightlyEmit, emitFiles, DRY_NOW } from "./lib/nightly-emit.mjs";
import { pinStamp, stampNow, stampDate, stampPinned } from "../scripts/flows-legs/stamp.mjs";
import { pipelineSource, count, absent, expect } from "./lib/source-scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const MANIFEST = path.join(HERE, "fixtures-pipeline-golden.json");
const WRITE = process.argv.includes("--write");
const against = process.argv.includes("--against") ? process.argv[process.argv.indexOf("--against") + 1] : null;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const throws = (fn, pattern, msg) => { assert.throws(fn, pattern, msg); checks++; };

const sha = (buffer, n) => createHash("sha256").update(buffer).digest("hex").slice(0, n);

const kindOf = (name) => {
  const m = /^-(card-x|card|hist)-/.exec(name);
  return m ? `-${m[1]}-*` : null;
};

export function digest(dir) {
  const files = {};
  const keys = {};
  const kinds = {};
  for (const name of emitFiles(dir)) {
    const bytes = readFileSync(path.join(dir, name));
    files[name] = sha(bytes, 16);
    let body = null;
    try { body = JSON.parse(bytes.toString("utf8")); } catch { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body)) continue;
    const perKey = {};
    for (const [k, v] of Object.entries(body)) perKey[k] = sha(JSON.stringify(v), 8);
    const kind = kindOf(name);
    if (kind) {
      const bucket = kinds[kind] || (kinds[kind] = {});
      for (const [k, h] of Object.entries(perKey)) (bucket[k] || (bucket[k] = [])).push(h);
    } else {
      keys[name] = perKey;
    }
  }
  for (const [kind, bucket] of Object.entries(kinds)) {
    keys[kind] = {};
    for (const [k, list] of Object.entries(bucket)) keys[kind][k] = sha(list.join(","), 8);
  }
  return { files, keys };
}

function leaves(a, b, at, out, cap) {
  if (out.length >= cap) return;
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) { out.push(at); return; }
  if (a && typeof a === "object") {
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...names].sort()) {
      if (!(k in a) || !(k in b)) { out.push(`${at}.${k}`); continue; }
      leaves(a[k], b[k], `${at}.${k}`, out, cap);
    }
  } else if (a !== b) out.push(at);
}

function explain(dir, base) {
  const lines = [];
  for (const name of emitFiles(dir)) {
    const other = path.join(base, name);
    if (!existsSync(other)) { lines.push(`${name}: not in ${base}`); continue; }
    const a = readFileSync(path.join(dir, name), "utf8");
    const b = readFileSync(other, "utf8");
    if (a === b) continue;
    const out = [];
    try { leaves(JSON.parse(a), JSON.parse(b), "$", out, 6); } catch { out.push("(not JSON)"); }
    lines.push(`${name}: ${out.join(", ")}`);
    if (lines.length >= 20) break;
  }
  return lines;
}

{
  const keep = process.env.FLOWS_DRY_NOW;
  try {
    eq(pinStamp(undefined, { dryRun: true }), null, "no value pins nothing");
    eq(stampPinned(), false, "and the stamp is the wall clock");
    const before = Date.now();
    const free = Date.parse(stampNow());
    ok(free >= before && free <= Date.now() + 5, "unpinned, stampNow is the current instant");
    eq(pinStamp("2026-08-24T21:45:00Z", { dryRun: false }), null, "a value without --dry-run is ignored");
    eq(stampPinned(), false, "and nothing is pinned");
    eq(pinStamp("2026-08-24T21:45:00Z", { dryRun: true }), "2026-08-24T21:45:00.000Z", "with --dry-run the value pins");
    eq(stampNow(), "2026-08-24T21:45:00.000Z", "stampNow returns the pinned instant");
    eq(stampDate().getTime(), Date.parse("2026-08-24T21:45:00Z"), "and stampDate the same instant as a Date");
    const first = stampNow();
    const spin = Date.now() + 5;
    while (Date.now() < spin);
    eq(stampNow(), first, "time passing moves nothing");
    pinStamp("2026-08-24T21:45:00.250Z", { dryRun: true });
    eq(stampNow(), "2026-08-24T21:45:00.250Z", "milliseconds are honoured");
    for (const bad of ["yesterday", "2026-08-24", "2026-08-24T21:45:00", "2026-13-40T21:45:00Z", "1724535900000", "2026-08-24T21:45:00+02:00"]) {
      throws(() => pinStamp(bad, { dryRun: true }), /FLOWS_DRY_NOW/, `${JSON.stringify(bad)} is refused, not guessed at`);
    }
    eq(stampPinned(), false, "a refused value leaves the clock unpinned");
    eq(pinStamp("", { dryRun: true }), null, "an empty value is no value");
  } finally {
    pinStamp(null);
    if (keep === undefined) delete process.env.FLOWS_DRY_NOW;
  }
}

{
  const src = pipelineSource();
  absent(src, "new Date().toISOString()", { anchor: "stampNow()", why: "a payload stamp must come from stampNow so FLOWS_DRY_NOW pins it" });
  absent(src, /readAt\s*=\s*\(\)\s*=>\s*new Date\(/, { anchor: "stampNow", why: "a leg's default read clock is the stamp clock" });
  expect(src, /pinStamp\(process\.env\.FLOWS_DRY_NOW, \{ dryRun: DRY_RUN \}\)/, { min: 1, max: 1, why: "the pipeline pins once, from --dry-run" });
  checks += 3;
}

const dir = nightlyEmit();
const names = emitFiles(dir);
ok(names.length > 400, `the dry run emitted ${names.length} payloads`);
for (const required of ["-meta.json", "-universe.json", "-board-long.json", "-brief.json", "-card-NVDA.json", "-news.json", "-unusual.json"]) {
  ok(names.includes(required), `${required} is in the emit`);
}

const stamped = JSON.parse(readFileSync(path.join(dir, "-meta.json"), "utf8"));
eq(stamped.generatedAt, new Date(Date.parse(DRY_NOW)).toISOString(), "generatedAt is the pinned instant");
{
  const late = [];
  let seen = 0;
  const scan = (v, at, file) => {
    if (typeof v === "string") {
      if (/(?:generatedAt|readAt|ReadAt|refreshedAt)$/.test(at) && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
        seen++;
        if (Date.parse(v) > Date.parse(DRY_NOW)) late.push(`${file}${at}=${v}`);
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${at}[${i}]`, file));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) scan(x, `${at}.${k}`, file);
  };
  for (const name of names) scan(JSON.parse(readFileSync(path.join(dir, name), "utf8")), "", name);
  ok(seen > 500, `${seen} stamp fields were found across the emit`);
  ok(late.length === 0, `no generatedAt or readAt is later than the pinned clock (${late.slice(0, 3).join("; ")})`);
}

if (against) {
  const lines = explain(dir, against);
  console.log(lines.length ? lines.join("\n") : `no payload differs from ${against}`);
}

const now = digest(dir);

if (WRITE) {
  writeFileSync(MANIFEST, JSON.stringify({ schema: 1, now: DRY_NOW, count: names.length, files: now.files, keys: now.keys }, null, 0) + "\n");
  console.log(`wrote ${path.relative(ROOT, MANIFEST)}: ${names.length} payloads`);
  process.exit(0);
}

{
  const second = mkdtempSync(path.join(os.tmpdir(), "flows-golden-"));
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", second + path.sep], {
      cwd: ROOT, env: { ...process.env, FLOWS_DRY_NOW: DRY_NOW }, stdio: ["ignore", "ignore", "pipe"], maxBuffer: 64 * 1024 * 1024,
    });
    const other = emitFiles(second);
    assert.deepEqual(other, names);
    checks++;
    const differ = names.filter((n) => !readFileSync(path.join(dir, n)).equals(readFileSync(path.join(second, n))));
    ok(differ.length === 0, `two emits with the same FLOWS_DRY_NOW are byte-identical (${differ.slice(0, 5).join(", ")})`);
  } finally {
    rmSync(second, { recursive: true, force: true });
  }
}

const golden = JSON.parse(readFileSync(MANIFEST, "utf8"));
eq(golden.schema, 1, "the manifest is schema 1");
eq(golden.now, DRY_NOW, "and was struck at the CI clock");
eq(golden.count, Object.keys(golden.files).length, "its count is its file list");
{
  const added = names.filter((n) => !(n in golden.files));
  const removed = Object.keys(golden.files).filter((n) => !names.includes(n));
  const changed = names.filter((n) => n in golden.files && golden.files[n] !== now.files[n]);
  const report = [];
  if (added.length) report.push(`new payloads: ${added.slice(0, 8).join(", ")}${added.length > 8 ? ` (+${added.length - 8})` : ""}`);
  if (removed.length) report.push(`payloads gone: ${removed.slice(0, 8).join(", ")}${removed.length > 8 ? ` (+${removed.length - 8})` : ""}`);
  if (changed.length) {
    report.push(`${changed.length} payload(s) changed, first: ${changed.slice(0, 8).join(", ")}`);
    const seen = new Set();
    for (const n of changed) {
      const key = kindOf(n) || n;
      if (seen.has(key)) continue;
      seen.add(key);
      const was = golden.keys[key] || {};
      const is = now.keys[key] || {};
      const moved = [...new Set([...Object.keys(was), ...Object.keys(is)])].filter((k) => was[k] !== is[k]).sort();
      report.push(`  ${key}: top-level keys changed: ${moved.join(", ") || "(none; the bytes differ outside any key)"}`);
      if (seen.size >= 12) break;
    }
  }
  ok(report.length === 0,
    `the emit equals the golden manifest; if the change is intended, run node flows-pipeline-golden.mjs --write and commit it, and use --against <emit dir of the old tree> to see the leaf paths:\n${report.join("\n")}`);
}

console.log(`✓ flows-pipeline-golden: ${checks} assertions — FLOWS_DRY_NOW pins every payload stamp and only under --dry-run, two emits at one clock are byte-identical, and the ${names.length} emitted payloads hash to the committed manifest`);
