#!/usr/bin/env node
/* =============================================================
   strip-comments.mjs — remove comments from the SERVED copy of the
   JavaScript, and from nothing else.

   WHY THIS EXISTS, IN THE NUMBERS THAT JUSTIFY IT. The ticker route
   ships 403k of JavaScript and 46.1% of it is comment; the market,
   ask and unusual routes each sit at their ceiling with zero bytes
   of headroom. Measured over assets/js: 2,310,246 B becomes
   1,536,285 B, so 755.82 KiB — a third of the tree — is prose the
   browser parses and no reader ever sees.

   IT IS THE RIGHT REDUCTION, AND THAT IS NOT THE SAME AS THE BIGGEST.
   Gzip already handles transfer, so shrinking the wire was never the
   argument; what a comment costs at run time is PARSE, on the
   reader's own CPU, and stripping is the only thing that touches it.
   tests/flows-weight.mjs makes that distinction in its header and
   this script is the other half of it.

   THE REPOSITORY KEEPS EVERY COMMENT. This runs in the deploy
   workspace, never as a commit: sources are the argument for the
   code and deleting them to save bytes is the trade this project
   refuses everywhere else. `--check` runs the whole thing in memory
   and writes nothing, which is what CI uses.

   HOW IT IS WIRED, AND WHY IT CANNOT LIVE IN wrangler.toml.
   Cloudflare documents twice that Workers Builds "does not honor the
   configurations set in Custom Builds within your Wrangler
   configuration file", so a [build] section here would never run and
   the deploy would silently ship unstripped bytes behind a diff
   claiming the win. It goes in the dashboard instead:

     Workers Builds -> Settings -> Build command
       node scripts/strip-comments.mjs

   VERIFYING IT ACTUALLY RAN, from outside:

     curl -s https://anilkaya.org/assets/js/flows-panels.js | head -3

   An unstripped deploy opens with this file's own banner comment; a
   stripped one opens with `(function () {`.
   ============================================================= */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Remove comments from one JavaScript source.
 *
 * A SCANNER RATHER THAN A REGEX, because the three things that look like
 * comments and are not — a `//` inside a string, a `/*` inside a regex
 * character class, a `${}` holding either — are exactly the cases a regex
 * gets wrong, and getting one wrong here corrupts a served asset.
 *
 * THE TEMPLATE BRANCH RECURSES. An interpolation can hold a string holding a
 * brace, or another template holding another interpolation; counting braces
 * without tracking quotes ends the template early and everything after it is
 * scanned in the wrong state. This walks `${` … `}` with the same state
 * machine, at depth.
 *
 * REGEX-OR-DIVIDE IS DECIDED BY THE LAST SIGNIFICANT CHARACTER, the standard
 * heuristic: a `/` after a value (identifier, digit, `)`, `]`) is division,
 * and after an operator or the start of a statement it opens a literal. The
 * one shape it cannot see is a regex after `)`, as in `if (x) /re/.test(s)`,
 * which is why `--check` re-parses every output and the equivalence suite
 * renders both trees and diffs the DOM.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = "";                         // last significant char

  const isValueEnd = (c) => /[A-Za-z0-9_$)\]]/.test(c);

  function scanString(quote) {
    out += src[i]; i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += c + (src[i + 1] ?? ""); i += 2; continue; }
      if (quote === "`" && c === "$" && src[i + 1] === "{") {
        out += "${"; i += 2;
        scanBalanced();
        continue;
      }
      out += c; i++;
      if (c === quote) return;
    }
  }

  /* One `${ … }` interpolation, in full scanner state so a brace inside a
     string inside it cannot end it early. */
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
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      /* ONE SPACE, NOT NOTHING. `a/* c *\/b` is `a b`, and joining the two
         halves would invent an identifier that was never written. */
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { scanString(c); prev = c; continue; }
    if (c === "/" && !isValueEnd(prev || "\n")) {
      out += c; i++;
      let inClass = false;
      while (i < n) {
        const r = src[i];
        if (r === "\\") { out += r + (src[i + 1] ?? ""); i += 2; continue; }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        out += r; i++;
        if (r === "/" && !inClass) break;
      }
      prev = "/"; continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }

  /* Trailing whitespace and the blank runs the removed blocks leave behind.
     Never the newlines themselves: automatic semicolon insertion depends on
     them, and a file that only parses because of a line break is a file this
     script must not join up. */
  return out
    .split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/* ---------- the run ---------------------------------------------- */

export function stripTree({ check = false, dir = "assets/js" } = {}) {
  const abs = path.join(ROOT, dir);
  const files = fs.readdirSync(abs).filter((f) => f.endsWith(".js")).sort();
  let before = 0, after = 0;
  const broken = [];
  for (const f of files) {
    const p = path.join(abs, f);
    const src = fs.readFileSync(p, "utf8");
    const out = stripComments(src);
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out);
    /* EVERY OUTPUT IS RE-PARSED BEFORE IT IS WRITTEN. A scanner that gets one
       regex wrong produces a file that is still text and no longer code; the
       deploy would succeed and the route would be dead. */
    try { new Function(out); } catch (e) { broken.push(`${f}: ${e.message}`); continue; }
    if (!check) fs.writeFileSync(p, out);
  }
  return { files: files.length, before, after, broken };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
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
