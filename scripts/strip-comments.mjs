#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = "";

  const REGEX_KEYWORD = /(?:^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

  function parenIsControlHead(upto) {
    let depth = 0;
    let j = upto;
    for (; j >= 0; j--) {
      if (src[j] === ")") depth++;
      else if (src[j] === "(") { depth--; if (depth === 0) break; }
    }
    if (j < 0) return false;
    const before = src.slice(Math.max(0, j - 12), j).trimEnd();
    return /(?:^|[^\w$])(if|while|for|with)$/.test(before);
  }

  const isValueEnd = (c) => /[A-Za-z0-9_$)\]]/.test(c);

  function regexAllowed() {
    if (!prev) return true;
    if (prev === ")") return parenIsControlHead(i - 1);
    if (!isValueEnd(prev)) return true;
    return REGEX_KEYWORD.test(src.slice(Math.max(0, i - 14), i).trimEnd());
  }

  function scanRegex() {
    out += src[i]; i++;
    let inClass = false;
    while (i < n) {
      const r = src[i];
      if (r === "\\") { out += r + (src[i + 1] ?? ""); i += 2; continue; }
      if (r === "\n") break;
      if (r === "[") inClass = true;
      else if (r === "]") inClass = false;
      out += r; i++;
      if (r === "/" && !inClass) break;
    }
    prev = "/";
  }

  function scanString(quote) {
    out += src[i]; i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
      if (quote === "`" && c === "$" && src[i + 1] === "{") {
        out += "${"; i += 2;

        prev = "{";
        scanBalanced();
        continue;
      }
      out += c; i++;
      if (c === quote) return;
    }
  }

  function scanBalanced() {
    let depth = 1;
    while (i < n && depth > 0) {
      const c = src[i], d = src[i + 1];
      if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2; out += " "; continue;
      }
      if (c === '"' || c === "'" || c === "`") { scanString(c); prev = c; continue; }

      if (c === "/" && regexAllowed()) { scanRegex(); continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { out += "}"; i++; return; } }
      out += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }

  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      i += 2;
      const from = i;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      const body = src.slice(from, i);
      i += 2;

      out += " " + "\n".repeat((body.match(/\n/g) || []).length);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { scanString(c); prev = c; continue; }
    if (c === "/" && regexAllowed()) { scanRegex(); continue; }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  return out
    .split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function stripTree({ check = false, dir = "assets/js" } = {}) {
  const abs = path.join(ROOT, dir);
  const files = fs.readdirSync(abs).filter((f) => f.endsWith(".js")).sort();
  let before = 0, after = 0;
  const broken = [];
  const staged = [];

  for (const f of files) {
    const p = path.join(abs, f);
    const src = fs.readFileSync(p, "utf8");
    const out = stripComments(src);
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out);

    try { new Function(out); } catch (e) { broken.push(`${f}: ${e.message}`); continue; }
    staged.push([p, out]);
  }
  if (!check && broken.length === 0) {
    for (const [p, out] of staged) fs.writeFileSync(p, out);
  }
  return { files: files.length, before, after, broken, wrote: check || broken.length ? 0 : staged.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {

  const KNOWN = new Set(["--check"]);
  const unknown = process.argv.slice(2).filter((a) => !KNOWN.has(a));
  if (unknown.length) {
    console.error("strip-comments: unknown argument" + (unknown.length > 1 ? "s" : "") +
      ": " + unknown.join(" "));
    console.error("  usage: node scripts/strip-comments.mjs [--check]");
    console.error("  There is no --out: this script rewrites assets/js in place, which is");
    console.error("  why it belongs in a deploy workspace and never in a commit. Run it with");
    console.error("  --check to measure, or from a disposable checkout to produce stripped files.");
    process.exit(2);
  }
  const check = process.argv.includes("--check");
  const r = stripTree({ check });
  const saved = r.before - r.after;
  if (r.broken.length) {
    console.error("strip-comments: output did not parse, nothing written for:");
    for (const b of r.broken) console.error("  " + b);
    process.exit(1);
  }
  console.log(
    `strip-comments: ${r.files} files, ${r.before} -> ${r.after} B ` +
    `(-${(saved / 1024).toFixed(2)} KiB, ${(100 * saved / r.before).toFixed(1)}%)` +
    (check ? " [check only, nothing written]" : ""));
}
