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

  /* KEYWORDS AFTER WHICH A SLASH OPENS A REGEX, not a division. `return /x/`
     and `typeof /x/` are the common ones; without this list the slash reads
     as a divide and the literal is scanned as code. */
  const REGEX_KEYWORD = /(?:^|[^\w$])(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

  /* A `)` ENDS A VALUE — unless it closed the head of a control statement, in
     which case what follows is a fresh expression and a slash opens a regex:
     `if (x) /re/.test(s)`. Deciding that needs the token BEFORE the matching
     `(`, so this walks back to it. */
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

  /* Is a `/` here a regex literal or a division? Decided from the last
     significant character and, where that is ambiguous, from the token before
     the matching paren. The one shape still out of reach is a slash after an
     identifier that happens to be a keyword-like property name; the tree is
     re-parsed and re-rendered afterwards precisely because this is a
     heuristic and not a parser. */
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
      if (r === "\n") break;              // an unterminated literal is not one
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
        /* THE INTERPOLATION STARTS A FRESH EXPRESSION, so the last significant
           character is the brace and not whatever preceded the template.
           Without this, the regex in `${ /re/.test(s) }` inherited a stale
           value-ish `prev` and was scanned as a division. */
        prev = "{";
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
      /* REGEX INSIDE AN INTERPOLATION, which the first draft did not scan for
         at all: `${ /[/*]/.test(s) }` has a comment opener inside a character
         class, and without this branch the `/*` starts a comment that eats
         the rest of the template. */
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
      /* ONE SPACE, AND EVERY NEWLINE THE COMMENT CONTAINED.
         The space is so `a/*c*\/b` stays `a b` rather than becoming an
         identifier nobody wrote. The NEWLINES are load-bearing in a way that
         cost this script a silent behaviour change: automatic semicolon
         insertion fires on a line terminator, so

             return /* a
                       comment *\/ 42;

         returns UNDEFINED, and collapsing that comment to a single space
         turns it into `return 42`. Both parse; they compute different things,
         and no size check or parse check can tell them apart. `return`,
         `throw`, `break`, `continue`, `yield` and postfix `++`/`--` all read
         the line break, so the count of newlines is preserved exactly. */
      out += " " + "\n".repeat((body.match(/\n/g) || []).length);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { scanString(c); prev = c; continue; }
    if (c === "/" && regexAllowed()) { scanRegex(); continue; }
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
  const staged = [];
  /* TWO PASSES, AND THE SECOND ONLY RUNS IF THE FIRST WAS CLEAN. Writing each
     file as it passed left a workspace half-stripped when a later file failed,
     under an error message that said "nothing written" — a deploy could then
     ship a mix of stripped and unstripped assets from a run that reported
     failure. Everything is staged in memory; one bad file writes none. */
  for (const f of files) {
    const p = path.join(abs, f);
    const src = fs.readFileSync(p, "utf8");
    const out = stripComments(src);
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out);
    /* EVERY OUTPUT IS RE-PARSED BEFORE ANYTHING IS WRITTEN. A scanner that
       gets one regex wrong produces a file that is still text and no longer
       code; the deploy would succeed and the route would be dead. */
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
  /* AN UNKNOWN FLAG IS A REFUSAL, NOT A DEFAULT, and this guard was written
     the minute after the hole it closes was found the hard way.

     This script's write mode REWRITES 47 SOURCE FILES IN PLACE, and its own
     header says it must run in the deploy workspace and never as a commit.
     Argument handling was one `includes("--check")`: every other argument —
     including a misremembered `--out DIR` — fell through to write mode, which
     is the destructive branch. So `strip-comments.mjs --out /tmp/somewhere`,
     typed by someone expecting a copy elsewhere, stripped the repository
     instead. Nothing was lost that time because the tree was committed and
     pushed a minute earlier; that is luck, and luck is not a guard.

     The rule is the one this repository applies to payloads: an input that
     was not understood is refused rather than interpreted generously. */
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
