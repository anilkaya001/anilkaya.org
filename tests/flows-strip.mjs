/* =============================================================
   flows-strip.mjs — the comment strip is correct, or it does not ship.

   THE FAILURE THIS GUARDS AGAINST IS NOT A SMALLER FILE, IT IS A WRONG
   ONE. scripts/strip-comments.mjs rewrites every served script in the
   deploy workspace; a scanner that mistakes one regex for a division
   produces a file that is still text and no longer code, the build
   succeeds, and the route is dead in production while every test here
   passed against the unstripped tree. So this suite runs the stripper
   over the real tree and checks three things a size figure cannot:

     1. every output parses
     2. stripping twice is stripping once (no second pass eats code)
     3. the panels DRAW THE SAME DOM, stripped and not

   THE THIRD IS THE ONE THAT MATTERS. Parsing proves the file is code;
   only rendering proves it is the SAME code. Twenty emitted cards
   through thirteen registry drawers plus the score panel is 280
   renders, and the assertion is byte-equality of innerHTML.

   THE CEILINGS IN flows-weight.mjs MEASURE THE REPOSITORY, NOT THE
   DEPLOY, and that is deliberate rather than an oversight: the served
   tree is smaller than every number that file prints. A ceiling
   measured against the stripped output would be a ceiling nobody
   editing this repository could check.
   ============================================================= */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";
import { stripComments, stripTree } from "../scripts/strip-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

/* ---------- 1. every output parses, and nothing is written -------- */
const run = stripTree({ check: true });
eq(run.broken.length, 0,
   `every stripped file parses (${run.broken.join("; ") || "none broken"})`);
ok(run.after < run.before,
   `and the strip removes bytes (${run.before} -> ${run.after})`);
ok(run.after / run.before < 0.85,
   `and removes enough of them to be worth a build step — ` +
   `${(100 * (1 - run.after / run.before)).toFixed(1)}% of assets/js is comment`);

/* ---------- 2. idempotent ----------------------------------------- */
{
  const jsDir = path.join(ROOT, "assets/js");
  for (const f of fs.readdirSync(jsDir).filter((x) => x.endsWith(".js"))) {
    const once = stripComments(fs.readFileSync(path.join(jsDir, f), "utf8"));
    const twice = stripComments(once);
    eq(twice, once, `${f}: stripping twice is stripping once — a second pass ` +
       `that removes more is a pass that is eating code, not comments`);
  }
}

/* ---------- 3. the hand-written traps ----------------------------- */
{
  const cases = [
    ['const s = "// not a comment";', "a line comment inside a string survives"],
    ['const s = "/* not a comment */";', "a block comment inside a string survives"],
    ["const r = /[/*]/g;", "a comment opener inside a regex character class survives"],
    ["const t = `${ { a: '}' }.a }`;", "a brace inside a string inside an interpolation"],
    ["const t = `${ `${ 1 }` }`;", "a template inside an interpolation"],
    ["const d = a / b / c;", "division is not a regex"],
    ['const u = "\\\\";', "an escaped backslash ending a string"],
  ];
  for (const [src, why] of cases) {
    eq(stripComments(src).trim(), src.trim(), why);
  }
  eq(stripComments("a/* x */b").trim(), "a b",
     "a block comment between two tokens leaves a space, never joining them");
  eq(stripComments("let a = 1; // tail\nlet b = 2;").trim(),
     "let a = 1;\nlet b = 2;",
     "a trailing line comment goes and its newline stays — ASI depends on it");

  /* THESE ARE RUN, NOT READ. Every case below produced output that PARSED
     and computed something different, which is exactly the class of defect a
     parse check cannot see: the `return` one returned 42 where the source
     returned undefined, and the size and syntax checks were both happy. So
     each snippet is evaluated on both sides and the RESULTS are compared. */
  const runs = [
    ["a multiline comment after `return` keeps its newline, so automatic " +
     "semicolon insertion still fires and the function still returns undefined",
     "function f(){\n  return /* a\n comment */ 42;\n}\nreturn f();"],
    ["a regex after the `)` of an `if` head is a regex, not a division",
     "const s = \"a/b\"; let r = null; if (s) r = /[/*]/.test(s); return r;"],
    ["a regex straight after `return` is a regex",
     "function g(){ return /[/*]/.source; }\nreturn g();"],
    ["a regex inside a template interpolation is a regex",
     "const s = \"x\"; return `${ /[/*]/.test(s) }`;"],
    ["a template inside an interpolation survives whole",
     "const a = 1; return `${ `${ a }` }`;"],
    ["a regex after `typeof` is a regex",
     "return typeof /[/*]/;"],
    ["two divisions in a row are two divisions",
     "return 10 / 2 / 5;"],
    ["comment syntax inside strings is text",
     "return \"// not\" + \"/* not */\";"],
  ];
  for (const [why, src] of runs) {
    const out = stripComments(src);
    const val = (code) => { try { return String(new Function(code)()); }
                            catch (e) { return "THREW: " + e.message; } };
    eq(val(out), val(src), why);
  }
}

/* ---------- 4. the same DOM, stripped and not --------------------- */
/* THE CORPUS IS GENERATED HERE, NOT ASSUMED TO EXIST. tests/.review-emit is
   in .gitignore, so on a clean checkout — which is every CI run — it is
   absent, and a suite that merely skipped when it was missing would report
   green having proved only that the output parses. That is the weaker half:
   parsing says the file is code, rendering says it is the SAME code. The dry
   run is deterministic and takes a few seconds. */
const emitDir = path.join(ROOT, "tests/.review-emit");
const listCards = () => (fs.existsSync(emitDir)
  ? fs.readdirSync(emitDir).filter((f) => /card/.test(f)) : []);
if (!listCards().length) {
  /* THE DIRECTORY FIRST, AND THIS COST A RED CI RUN. `--emit` writes files
     into the path it is given and does not create it, so on a clean checkout
     the dry run died with ENOENT on its first card while every local run
     passed — the directory was already there from earlier work. A fixture
     bootstrap that only works on a machine that did not need it is not a
     bootstrap. */
  fs.mkdirSync(emitDir, { recursive: true });
  const r = spawnSync(process.execPath,
    ["scripts/flows-pipeline.mjs", "--dry-run", "--emit", "tests/.review-emit/"],
    { cwd: ROOT, encoding: "utf8" });
  ok(r.status === 0,
     `the dry run emits a card corpus to render against ` +
     `(exit ${r.status}${r.stderr ? ": " + r.stderr.trim().split("\n").pop() : ""})`);
}
const cards = listCards().slice(0, 20);
ok(cards.length > 0,
   "there are emitted cards to render — without them this suite proves only that " +
   "the output parses, which is the weaker half");

if (cards.length) {
  const read = (f) => fs.readFileSync(path.join(ROOT, "assets/js", f), "utf8");
  const pair = {
    orig: { p: read("flows-panels.js"), d: read("flows-drawers.js") },
    strip: { p: stripComments(read("flows-panels.js")),
             d: stripComments(read("flows-drawers.js")) },
  };
  const KEYS = ["gamma", "displacement", "surface", "calendar", "pricedMove", "context",
                "levels", "path", "congress", "overlay", "vanna", "charm", "deltaExposure"];
  const browser = await chromium.launch();
  try {
    const render = async (v) => {
      const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.setContent("<div></div>");
      await page.addScriptTag({ content: v.p });
      await page.addScriptTag({ content: v.d });
      const out = [];
      for (const f of cards) {
        const card = JSON.parse(fs.readFileSync(path.join(emitDir, f), "utf8"));
        out.push(await page.evaluate(({ card, KEYS }) => {
          const P = window.FlowsPanels, parts = [], threw = [];
          for (const k of KEYS) {
            const host = document.createElement("div");
            document.body.append(host);
            const key = k === "overlay" ? "scoreOverlay" : k;
            try { P[k](host, (card.panels || {})[key], card, "q"); }
            catch (e) { threw.push(k + ": " + e.message); }
            parts.push(host.innerHTML);
            host.remove();
          }
          const s = document.createElement("div");
          document.body.append(s);
          P.score(s, card, "q");
          parts.push(s.innerHTML);
          s.remove();
          return { parts, threw };
        }, { card, KEYS }));
      }
      await page.close();
      /* A PANEL THAT THREW IS NOT A PANEL THAT RENDERED. The first draft
         pushed the exception text into the compared parts, so a drawer that
         threw in BOTH runs produced two equal strings and the suite passed
         having rendered nothing at all — an equivalence check that is
         satisfied by two identical failures is not one. Throws are collected
         apart and asserted to be zero before the comparison is believed. */
      return { out: out.map((r) => r.parts), errors,
               threw: out.flatMap((r) => r.threw) };
    };
    const A = await render(pair.orig), B = await render(pair.strip);
    eq(A.errors.length, 0, `the unstripped tree renders without a page error (${A.errors[0] || ""})`);
    eq(B.errors.length, 0, `and so does the stripped one (${B.errors[0] || ""})`);
    eq(A.threw.length, 0,
       `no drawer throws on the unstripped tree (${A.threw[0] || "none"}) — a panel ` +
       `that throws in both runs would compare equal and prove nothing`);
    eq(B.threw.length, 0, `and none throws on the stripped one (${B.threw[0] || "none"})`);
    let same = 0, diff = 0, first = null;
    for (let i = 0; i < A.out.length; i++) {
      for (let k = 0; k < A.out[i].length; k++) {
        if (A.out[i][k] === B.out[i][k]) same++;
        else { diff++; if (!first) first = `card ${cards[i]} panel ${KEYS[k] || "score"}`; }
      }
    }
    eq(diff, 0,
       `every panel draws byte-identical DOM stripped and unstripped ` +
       `(${same} identical, ${diff} differing${first ? ", first at " + first : ""}) — ` +
       `a strip that changes what a reader sees is not a strip`);
    ok(same >= 200,
       `and enough panels were actually rendered to mean something (${same})`);
  } finally {
    await browser.close();
  }
}

console.log(`✓ flows-strip: ${checks} assertions — the served comment strip re-parsed file by file, proven idempotent, checked against fifteen shapes that look like comments and are not — eight of them EVALUATED on both sides rather than compared as text, because the defect that made this necessary parsed perfectly and returned a different number, and rendered card by card against the unstripped tree so that equality is of the DRAWN DOM rather than of a byte count`);
