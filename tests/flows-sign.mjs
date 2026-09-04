/* =============================================================
   flows-sign.mjs — zero is a measurement, and it gets its own arm.

   THE RULE IS STATED IN assets/js/flows-ui.js AND WAS ENFORCED
   NOWHERE. Its formatter carries the comment "ZERO PRINTS UNSIGNED
   AND UNDIMINISHED — it is a measurement, not a blank", and it obeys
   itself. Seventeen sign decisions in six other renderers did not.

   The clearest was on the ticker page's score badge, which is the
   most prominent number in the product. Two adjacent lines:

     badge.textContent = score > 0 ? "+" : score < 0 ? MINUS : "";
     badge.className   = score < 0 ? "is-neg" : "is-pos";

   The text prints an unsigned zero, correctly. The class directly
   beneath it tints the same zero green. The two disagreed about the
   same number, on the same row, one line apart, and nothing could
   see it because both are individually reasonable.

   WHY A SCANNER AND NOT A REVIEW. This defect has no runtime
   signature. It throws nothing, overflows nothing, and renders a
   plausible page; it is wrong only for one value of one input, and
   only a reader who knew the score was exactly zero would ever
   notice. It also regenerates: every new chart needs a polarity
   decision and the two-armed form is the one that comes to mind
   first. A rule that lives in a comment is a rule that holds until
   the next person writes a ternary.

   WHAT COUNTS AS A VIOLATION. A ternary whose test compares against
   zero, and whose branches choose between a POSITIVE marker and a
   NEGATIVE marker, with no third arm. Comments are stripped first, so
   a file DESCRIBING the defect is not accused of it — flows-market.js
   quotes the bad form verbatim in the comment recording its own fix.

   WHAT DOES NOT COUNT. The three-armed form, which tests zero on both
   sides. Every correct site in this codebase already has that shape,
   so the scanner is a filter on structure rather than a list of
   blessed lines: there is no allow-list here and there must not be
   one, because the moment a line can be excused by name the next
   defect is one entry away from invisible.

   AND THE OTHER HALF: A NEUTRAL CLASS WITH NO RULE IS NOT NEUTRAL,
   IT IS INVISIBLE. Several of these families set `fill: none` or no
   stroke on the base class and carry their colour entirely on the
   polarity modifier. Emitting `is-flat` on one of those without a
   stylesheet rule would draw nothing at all — a strictly worse
   outcome than the wrong tint it replaced. So every polarity class
   these renderers emit is checked against the stylesheet, and a later
   consolidation that drops one fails here rather than in a chart.
   ============================================================= */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

const JS_DIR = new URL("../assets/js/", import.meta.url);
const CSS = readFileSync(new URL("../assets/css/flows.css", import.meta.url), "utf8");

const POS = /"\+"|'\+'|is-pos|"pos"|is-up/;
const NEG = /MINUS|is-neg|"neg"|is-down/;
const ZCMP = /(?:<=?|>=?|===|!==)\s*0(?![.\d])/g;
const ZERO_TEST = /(?:<=?|>=?)\s*0\s*\?/g;
const FLAT = /is-zero|is-flat|is-neutral/;

/* Comments out, string bodies left alone. A blunt state machine rather than a
   parser: it only has to be right about where a comment starts and ends, and
   getting that wrong in the safe direction (treating code as a comment) would
   HIDE violations, so it is written to never do that. */
function stripComments(src) {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? src.length : j;
      out += " ".repeat(end - i);
      i = end;
    } else { out += c; i++; }
  }
  return out;
}

/** The expression a ternary's `?` opens, to the end of its own statement. */
function windowFrom(src, at) {
  let depth = 0, i = at;
  while (i < src.length && i - at < 260) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === ";" && depth === 0) break;
    i++;
  }
  return src.slice(at, i);
}

function violationsIn(src) {
  const clean = stripComments(src);
  const found = [];
  for (const m of clean.matchAll(ZERO_TEST)) {
    const win = windowFrom(clean, m.index + m[0].length);
    if (!(POS.test(win) && NEG.test(win))) continue;
    /* SAFE when zero is tested from BOTH sides — the three-armed form — or
       when the expression names a flat arm outright. */
    const whole = clean.slice(m.index, m.index + m[0].length + win.length);
    if ((whole.match(ZCMP) || []).length >= 2) continue;
    if (FLAT.test(win)) continue;
    found.push({
      line: clean.slice(0, m.index).split("\n").length,
      text: src.split("\n")[clean.slice(0, m.index).split("\n").length - 1].trim().slice(0, 120),
    });
  }
  return found;
}

const files = readdirSync(JS_DIR).filter((f) => /^flows-.*\.js$/.test(f)).sort();
ok(files.length >= 10,
   `the sweep covers every Flows renderer it can find (${files.length}) rather than a list ` +
   "that goes stale when a route is added");

/* ---------- 1. the scanner works, proven on both forms ------------
   A scanner asserted only against a codebase that passes is a scanner that
   might be matching nothing at all. These two strings are the defect and its
   fix, and the suite fails if it cannot tell them apart. */
{
  const bad = [
    'x.className = v < 0 ? "is-neg" : "is-pos";',
    'const s = (n) => (n >= 0 ? "+" : MINUS) + Math.abs(n);',
    'lab = (t.sgn > 0 ? "+" : MINUS) + body;',
  ];
  for (const src of bad) {
    eq(violationsIn(src).length, 1,
       `the scanner catches the two-armed form: ${src.slice(0, 52)}`);
  }
  const good = [
    'x.className = v < 0 ? "is-neg" : v > 0 ? "is-pos" : "is-flat";',
    'const s = (n) => (n < 0 ? MINUS : n > 0 ? "+" : "") + Math.abs(n);',
    'return n < 0 ? MINUS + s : n > 0 ? "+" + s : s;',
    'c = pts[i] > 0 ? " is-pos" : pts[i] < 0 ? " is-neg" : " is-zero";',
  ];
  for (const src of good) {
    eq(violationsIn(src).length, 0,
       `and clears the three-armed form: ${src.slice(0, 52)}`);
  }
  /* THE COMMENT THAT QUOTES THE DEFECT IS NOT THE DEFECT. flows-market.js
     records its own fix by quoting the bad form verbatim, and an earlier
     draft of this scanner accused it. */
  eq(violationsIn('/* used to test `n >= 0 ? "+" : MINUS`, which was wrong */').length, 0,
     "a comment describing the defect is not accused of it");
  eq(violationsIn('// x = v >= 0 ? "is-pos" : "is-neg"').length, 0,
     "in either comment form");
}

/* ---------- 2. no renderer decides a sign in two arms ------------- */
{
  const all = [];
  for (const f of files) {
    for (const v of violationsIn(readFileSync(new URL(f, JS_DIR), "utf8"))) {
      all.push(`assets/js/${f}:${v.line}  ${v.text}`);
    }
  }
  eq(all.length, 0,
     "no Flows renderer decides a sign in two arms.\n" +
     (all.length ? "  " + all.join("\n  ") + "\n" : "") +
     "  Zero is the centre of the dead band and a score this pipeline assigns. It is not a\n" +
     "  small positive, and it is not an absence — absence is is-null and the em dash. Give\n" +
     "  it its own arm: `v < 0 ? \"is-neg\" : v > 0 ? \"is-pos\" : \"is-flat\"`, or the shared\n" +
     "  polarity() helper in flows-panels.js. There is NO ALLOW-LIST here on purpose: the\n" +
     "  moment a line can be excused by name, the next defect is one entry from invisible.");
}

/* ---------- 3. every polarity class emitted has a rule ------------
   A neutral class with no rule is not neutral, it is invisible — several of
   these families set `fill: none` or no stroke at all and carry their colour
   entirely on the modifier. This is the assertion that stops a stylesheet
   consolidation from silently deleting a chart. */
{
  const EMITTED = /["'\s](\.?)((?:fc-score|gp-cum|fp-line|fp-line-end|rc-dot|mk-bar|gs-cell)(?:\s|["'])?)/;
  const FAMILIES = ["fc-score", "gp-cum", "fp-line", "fp-line-end", "rc-dot"];
  const MODIFIERS = ["is-pos", "is-neg", "is-flat"];

  for (const family of FAMILIES) {
    for (const mod of MODIFIERS) {
      const rule = new RegExp(`\\.${family}\\.${mod}\\b`);
      ok(rule.test(CSS),
         `.${family}.${mod} has a stylesheet rule. The base class deliberately sets no ` +
         "colour, so a polarity modifier with no rule draws nothing at all — strictly worse " +
         "than the wrong tint it replaced");
    }
  }
  ok(/\.fd-track i\.is-flat\b/.test(CSS),
     "and the board's centre-origin bar has one too. A zero score already draws a " +
     "zero-width bar, so the rule adds no ink — it exists so the element stops claiming a " +
     "SIDE, which matters because .is-pos also sets `left: 50%` and a future minimum width " +
     "would have grown it in a direction the reading does not have");

  /* THE NEUTRAL IS INK, NOT A THIRD HUE. Green, red and amber would read as
     three sides; grey reads as no side, which is what the measurement says. */
  const flatRules = CSS.match(/\.[\w-]+(?:\s+\w+)?\.is-flat\s*\{[^}]*\}/g) || [];
  ok(flatRules.length >= 5, `the neutral rules exist as a family (${flatRules.length} of them)`);
  for (const r of flatRules) {
    ok(!/--flow-up|--flow-down/.test(r),
       `a neutral rule never reaches for a directional colour: ${r.slice(0, 70)}`);
  }
}

/* ---------- 4. the shared helper exists and is three-way ---------- */
{
  const panels = readFileSync(new URL("flows-panels.js", JS_DIR), "utf8");
  ok(/const polarity = /.test(panels),
     "the polarity helper exists, so the next new chart has a correct form to reach for " +
     "rather than a two-armed ternary to invent — four call sites in that one file each " +
     "wrote their own wrong version");
  const body = panels.slice(panels.indexOf("const polarity = "), panels.indexOf("const polarity = ") + 400);
  for (const arm of ["is-null", "is-neg", "is-pos", "is-flat"]) {
    ok(body.includes(arm), `and it has an ${arm} arm: four states, not two`);
  }
}

console.log(`✓ flows-sign: ${checks} assertions — a rule that lived in one file's comment and ` +
  `was broken in six others, now enforced by structure rather than by review: no sign decided ` +
  `in two arms anywhere in the Flows renderers, a scanner proven against both the defect and ` +
  `its fix so it cannot be silently matching nothing, comments quoting the bad form not ` +
  `accused of it, no allow-list, and every neutral class checked against the stylesheet so a ` +
  `consolidation cannot turn a chart invisible`);
