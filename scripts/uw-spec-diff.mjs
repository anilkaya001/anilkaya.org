#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const PATH_LINE = /^ {2}(?:'([^']+)'|"([^"]+)"|(\/[^\s:]+)):\s*$/;
const METHOD_LINE = /^ {4}([a-z]+):\s*$/;
const PLAN_WORDS = /\b(?:plan|tier|add-on|addon|premium endpoint|enterprise)\b/i;
const DEPRECATED_WORDS = /\bdeprecated\b/i;

export class SpecError extends Error {}

const unquote = (s) => s.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");

const sentences = (text) => text
  .split(/\n\s*\n/)
  .map((p) => p.split("\n").filter((l) => !/^\s*#{1,6}\s/.test(l)).join(" ").replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z`[*])/))
  .map((s) => s.trim())
  .filter((s) => s && PLAN_WORDS.test(s));

function block(lines, from, indent) {
  const out = [];
  let i = from;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { out.push(""); i++; continue; }
    const lead = line.length - line.trimStart().length;
    if (lead < indent) break;
    out.push(line.slice(indent));
    i++;
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return { text: out.join("\n"), next: i };
}

function readParameters(lines, from) {
  const params = [];
  let i = from;
  let item = null;
  const close = () => { if (item) params.push(item); item = null; };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    const lead = line.length - line.trimStart().length;
    if (lead < 8) break;
    const dash = /^ {8}- (.*)$/.exec(line);
    if (dash) {
      close();
      item = { name: null, in: null, required: false, ref: null };
      absorb(item, dash[1]);
    } else if (item && lead === 10) {
      absorb(item, line.trim());
    }
    i++;
  }
  close();
  return { params, next: i };
}

function absorb(item, text) {
  const m = /^([A-Za-z$_]+):\s*(.*)$/.exec(text);
  if (!m) return;
  const value = unquote(m[2]);
  if (m[1] === "name") item.name = value;
  else if (m[1] === "in") item.in = value;
  else if (m[1] === "required") item.required = value === "true";
  else if (m[1] === "$ref") item.ref = value.split("/").pop();
}

export function digestSpec(text) {
  if (typeof text !== "string" || !text.length) throw new SpecError("the spec is empty");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l === "paths:");
  if (start < 0) throw new SpecError("the spec has no top-level paths: section");
  const ops = {};
  let path = null;
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.length && !line.startsWith(" ")) break;
    const p = PATH_LINE.exec(line);
    if (p) { path = p[1] || p[2] || p[3]; i++; continue; }
    const m = METHOD_LINE.exec(line);
    if (m && path && METHODS.has(m[1])) {
      const key = `${m[1].toUpperCase()} ${path}`;
      const op = { id: null, deprecated: false, params: {}, plan: [] };
      i++;
      while (i < lines.length) {
        const inner = lines[i];
        if (inner.trim() === "") { i++; continue; }
        const lead = inner.length - inner.trimStart().length;
        if (lead < 6) break;
        if (lead === 6) {
          const id = /^ {6}operationId:\s*(.+)$/.exec(inner);
          if (id) op.id = unquote(id[1]);
          if (/^ {6}deprecated:\s*true\s*$/.test(inner)) op.deprecated = true;
          if (/^ {6}parameters:\s*$/.test(inner)) {
            const got = readParameters(lines, i + 1);
            for (const prm of got.params) {
              const label = prm.name ? `${prm.in || "?"}:${prm.name}` : `ref:${prm.ref || "?"}`;
              op.params[label] = prm.required;
            }
            i = got.next;
            continue;
          }
          const desc = /^ {6}description:\s*(.*)$/.exec(inner);
          if (desc) {
            if (/^[|>][-+]?$/.test(desc[1].trim())) {
              const got = block(lines, i + 1, 8);
              if (DEPRECATED_WORDS.test(got.text.split("\n").slice(0, 2).join(" "))) op.deprecated = true;
              op.plan.push(...sentences(got.text));
              i = got.next;
              continue;
            }
            if (DEPRECATED_WORDS.test(desc[1])) op.deprecated = true;
            op.plan.push(...sentences(unquote(desc[1])));
          }
        }
        i++;
      }
      op.plan = [...new Set(op.plan)];
      ops[key] = op;
      continue;
    }
    i++;
  }
  if (!Object.keys(ops).length) throw new SpecError("no operation was found under paths:; the document is not in the layout this reader knows");
  let changelog = [];
  let infoPlan = [];
  const info = lines.indexOf("info:");
  if (info >= 0) {
    for (let j = info + 1; j < lines.length && (lines[j] === "" || lines[j].startsWith("  ")); j++) {
      if (!/^ {2}description:\s*[|>][-+]?\s*$/.test(lines[j])) continue;
      const body = block(lines, j + 1, 4).text;
      const cut = body.indexOf("## Changelog");
      infoPlan = sentences(cut >= 0 ? body.slice(0, cut) : body);
      changelog = body.split("\n").map((l) => /^# (\d{4}\.\d{2}\.\d{2})\s*$/.exec(l)).filter(Boolean).map((m) => m[1]);
      break;
    }
  }
  return { sha256: createHash("sha256").update(text).digest("hex"), ops, changelog, infoPlan };
}

const sorted = (xs) => [...xs].sort();

export function diffDigests(a, b) {
  const aKeys = Object.keys(a.ops);
  const bKeys = Object.keys(b.ops);
  const added = sorted(bKeys.filter((k) => !Object.hasOwn(a.ops, k)));
  const removed = sorted(aKeys.filter((k) => !Object.hasOwn(b.ops, k)));
  const changed = [];
  for (const key of sorted(aKeys.filter((k) => Object.hasOwn(b.ops, k)))) {
    const x = a.ops[key];
    const y = b.ops[key];
    const entry = { key };
    const ax = Object.keys(x.params);
    const by = Object.keys(y.params);
    const paramsAdded = sorted(by.filter((p) => !ax.includes(p)));
    const paramsRemoved = sorted(ax.filter((p) => !by.includes(p)));
    const required = sorted(ax.filter((p) => by.includes(p) && x.params[p] !== y.params[p]));
    if (paramsAdded.length) entry.paramsAdded = paramsAdded;
    if (paramsRemoved.length) entry.paramsRemoved = paramsRemoved;
    if (required.length) entry.requiredFlipped = required.map((p) => `${p} ${x.params[p]}->${y.params[p]}`);
    if (x.deprecated !== y.deprecated) entry.deprecated = [x.deprecated, y.deprecated];
    if (x.id !== y.id) entry.id = [x.id, y.id];
    const planAdded = y.plan.filter((s) => !x.plan.includes(s));
    const planRemoved = x.plan.filter((s) => !y.plan.includes(s));
    if (planAdded.length) entry.planAdded = planAdded;
    if (planRemoved.length) entry.planRemoved = planRemoved;
    if (Object.keys(entry).length > 1) changed.push(entry);
  }
  const infoAdded = b.infoPlan.filter((s) => !a.infoPlan.includes(s));
  const infoRemoved = a.infoPlan.filter((s) => !b.infoPlan.includes(s));
  const changelog = b.changelog.filter((v) => !a.changelog.includes(v));
  return {
    added, removed, changed, infoAdded, infoRemoved, changelog,
    empty: !added.length && !removed.length && !changed.length && !infoAdded.length && !infoRemoved.length && !changelog.length,
  };
}

export function formatDiff(diff, { from = "old", to = "new" } = {}) {
  const out = [`uw-spec-diff  ${from} -> ${to}`];
  if (diff.empty) { out.push("no difference in operations, parameters, deprecations, plan sentences or changelog"); return out; }
  for (const k of diff.added) out.push(`+ operation ${k}`);
  for (const k of diff.removed) out.push(`- operation ${k}`);
  for (const c of diff.changed) {
    out.push(`~ ${c.key}`);
    if (c.id) out.push(`    operationId ${c.id[0]} -> ${c.id[1]}`);
    for (const p of c.paramsAdded || []) out.push(`    + parameter ${p}`);
    for (const p of c.paramsRemoved || []) out.push(`    - parameter ${p}`);
    for (const p of c.requiredFlipped || []) out.push(`    required ${p}`);
    if (c.deprecated) out.push(`    deprecated ${c.deprecated[0]} -> ${c.deprecated[1]}`);
    for (const s of c.planAdded || []) out.push(`    + plan sentence: ${s}`);
    for (const s of c.planRemoved || []) out.push(`    - plan sentence: ${s}`);
  }
  for (const s of diff.infoAdded) out.push(`+ plan sentence (info): ${s}`);
  for (const s of diff.infoRemoved) out.push(`- plan sentence (info): ${s}`);
  for (const v of diff.changelog) out.push(`+ changelog ${v}`);
  return out;
}

export function main(argv, io = { read: (f) => readFileSync(f, "utf8"), out: (l) => console.log(l), err: (l) => console.error(l) }) {
  const files = argv.filter((a) => !a.startsWith("--"));
  const check = argv.includes("--check");
  if (files.length !== 2) {
    io.err("usage: node scripts/uw-spec-diff.mjs <old.yaml> <new.yaml> [--check]");
    return 2;
  }
  let a;
  let b;
  try {
    a = digestSpec(io.read(files[0]));
    b = digestSpec(io.read(files[1]));
  } catch (error) {
    io.err(`uw-spec-diff: ${error && error.message ? error.message : String(error)}`);
    return 2;
  }
  const diff = diffDigests(a, b);
  for (const line of formatDiff(diff, { from: files[0], to: files[1] })) io.out(line);
  return check && !diff.empty ? 1 : 0;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
