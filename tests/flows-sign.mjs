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

  eq(violationsIn('/* used to test `n >= 0 ? "+" : MINUS`, which was wrong */').length, 0,
     "a comment describing the defect is not accused of it");
  eq(violationsIn('// x = v >= 0 ? "is-pos" : "is-neg"').length, 0,
     "in either comment form");
}

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
     "  FlowsUI.tone() helper. There is NO ALLOW-LIST here on purpose: the\n" +
     "  moment a line can be excused by name, the next defect is one entry from invisible.");
}

{
  const EMITTED = /["'\s](\.?)((?:fc-score|gp-cum|fp-line|fp-line-end|rc-dot|mk-bar|gs-cell)(?:\s|["'])?)/;
  const FAMILIES = ["fc-score", "gp-cum", "fp-line", "fp-line-end", "rc-dot"];
  const MODIFIERS = ["is-pos", "is-neg", "is-flat"];

  const JS_ALL = files.map((f) => readFileSync(new URL(f, JS_DIR), "utf8")).join("\n");
  const emits = (family) => new RegExp(`["'\\s]${family}(?:["'\\s])`).test(JS_ALL);
  for (const family of FAMILIES.filter((f) => !emits(f))) {
    ok(!new RegExp(`\\b${family}\\b`).test(JS_ALL),
       `.${family} is emitted by no Flows renderer any more — the ticker page that drew it was rebuilt on ` +
       "FlowsUI, and its stylesheet rules went with it — so no polarity modifier can land on it unstyled");
  }
  const CSS_DIR = new URL("../assets/css/", import.meta.url);
  const sheets = readdirSync(CSS_DIR).filter((f) => /^flows(-[\w-]+)?\.css$/.test(f)).sort();
  ok(sheets.length > 5, `the polarity rules are read from the shared sheet and every Flows route sheet (${sheets.join(", ")})`);
  const CSS_ALL = sheets.map((f) => readFileSync(new URL(f, CSS_DIR), "utf8")).join("\n");
  for (const family of FAMILIES.filter(emits)) {
    const coloured = new RegExp(`\\.${family}\\s*\\{[^}]*\\b(?:fill|color|background)\\s*:`).test(CSS_ALL);
    for (const mod of MODIFIERS) {
      const rule = new RegExp(`\\.${family}(?:\\.[\\w-]+)*\\.${mod}\\b`).test(CSS_ALL);
      ok(rule || (mod === "is-flat" && coloured),
         `.${family}.${mod} is drawn. A direction needs a rule of its own, which may add a qualifier such as ` +
         "is-clear when only a reading that clears its interval earns the hue; a flat reading may fall back " +
         "to the family's base rule when that rule sets a colour. A polarity modifier on a colourless base " +
         "with no rule draws nothing at all — strictly worse than the wrong tint it replaced");
    }
  }
  if (/["'\s]fd-track["'\s]/.test(JS_ALL)) {
    ok(/\.fd-track i\.is-flat\b/.test(CSS_ALL),
       "and the board's centre-origin bar has one too. A zero score already draws a " +
       "zero-width bar, so the rule adds no ink — it exists so the element stops claiming a " +
       "SIDE, which matters because .is-pos also sets `left: 50%` and a future minimum width " +
       "would have grown it in a direction the reading does not have");
  } else {
    ok(!/\bfd-track\b/.test(JS_ALL),
       "the deck's centre-origin bar is emitted by no renderer any more — the boards draw one ranked row per " +
       "name — so its neutral rule has nothing left to guard");
  }

  const flatRules = [
    ...(CSS_ALL.match(/\.[\w-]+(?:\s+\w+)?\.is-flat\s*\{[^}]*\}/g) || []),
    ...(CSS_ALL.match(/[^{}]*\[data-tone="flat"\][^{}]*\{[^}]*\}/g) || []),
  ];
  ok(flatRules.length >= 5, `the neutral rules exist as a family, as .is-flat classes and as the Depth foundation's data-tone="flat" (${flatRules.length} of them)`);
  for (const r of flatRules) {
    ok(!/--flow-up|--flow-down|--up\b|--down\b|--up-mark|--down-mark/.test(r),
       `a neutral rule never reaches for a directional colour: ${r.trim().slice(0, 70)}`);
  }
}

{
  const ui = readFileSync(new URL("flows-ui.js", JS_DIR), "utf8");
  const at = ui.indexOf("const tone = ");
  ok(at > 0,
     "the shared tone helper exists, so the next new chart has a correct form to reach for " +
     "rather than a two-armed ternary to invent — four call sites in the old panel library each " +
     "wrote their own wrong version");
  const body = ui.slice(at, ui.indexOf("\n", at));
  for (const arm of ["\"up\"", "\"down\"", "\"flat\""]) ok(body.includes(arm), `and it has an ${arm} arm`);
  ok(/num\(v\) === null \? "flat"/.test(body),
     "and an absent value takes no direction: it is flat, and the em dash beside it carries the absence");
  const toneFn = new Function("num", body.replace(/^const tone = /, "return ").replace(/;$/, ""))((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  eq(toneFn(0), "flat", "zero is flat, never a small positive");
  eq(toneFn(null), "flat", "null is flat, never a direction");
  eq(toneFn(-1), "down", "a negative is down");
  eq(toneFn(1), "up", "a positive is up");
  eq(toneFn(0.4, 0.5), "flat", "and a reading inside a dead band is flat");

  const ticker = stripComments(readFileSync(new URL("flows-ticker.js", JS_DIR), "utf8"));
  const lits = new Set(["up", "down", "flat"]);
  for (const m of ticker.matchAll(/"data-tone":\s*([^,}]+)/g)) for (const q of m[1].matchAll(/"([a-z]+)"/g)) lits.add(q[1]);
  for (const m of ticker.matchAll(/\btone:\s*([^,}]+)/g)) for (const q of m[1].matchAll(/"([a-z]+)"/g)) lits.add(q[1]);
  ok(lits.size >= 5, `the ticker page's tone vocabulary was read from its source (${[...lits].join(", ")})`);
  for (const t of lits) {
    ok(new RegExp(`\\[data-tone="${t}"\\]\\s*\\{[^}]*--tone:`).test(CSS),
       `data-tone="${t}", which the ticker page emits, sets a tone in the shared stylesheet — a tone with no rule draws its reading in no colour at all`);
  }
  ok(!/\? "short" : "long"|\? "long" : "short"/.test(ticker.replace(/side === "long_below" \? "long" : "short"|below === "long" \? "short" : "long"/g, "")),
     "and no gamma reading on the ticker page decides long or short in two arms: a strike measured at zero gamma is neither");
}

{
  const PAL = /pal\.(?:pos|neg)\b|\.(?:posT|negT)\b|["'(]--(?:up|down)(?:-mark)?["')]|["']--g-(?:long|short)["']|["']\s*(?:is-(?:pos|neg|more|less|up|down)|st-(?:pos|neg)|up|down)\s*["']/;
  const ZERO_TERNARY = /([<>]=?)\s*0(?![.\d])\s*\?/g;
  const NESTED_ZERO = /(?:[<>]=?|===|!==)\s*0(?![.\d])\s*\?/;
  const CHAINED = /(?:(?:[<>]=?|===|!==)\s*0(?![.\d])|Math\.abs\([^()]*\)\s*<=?\s*[\w.]+)[^;?]*\?(?:[^?:;,()[\]]|\([^()]*\)|\[[^[\]]*\])*:\s*\(?\s*[\w.$]+(?:\([^()]*\))?(?:\[[^\]]*\])*\s*$/;
  const BOUND = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*?(?:<=|>=)\s*0(?![.\d])\s*;/g;
  const armsOf = (src, at) => {
    let depth = 0, quote = null, nest = 0, colon = -1, i = at;
    for (; i < src.length && i - at < 400; i++) {
      const c = src[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
      if (c === "\"" || c === "'" || c === "`") { quote = c; continue; }
      if ("([{".includes(c)) { depth++; continue; }
      if (")]}".includes(c)) { if (depth === 0) break; depth--; continue; }
      if (depth) continue;
      if (c === ";" || c === ",") break;
      if (c === "?") {
        if (src[i + 1] === "?") { i++; continue; }
        if (src[i + 1] === "." && !/\d/.test(src[i + 2] || "")) { i++; continue; }
        nest++;
        continue;
      }
      if (c === ":") { if (nest) { nest--; continue; } if (colon >= 0) break; colon = i; }
    }
    return colon < 0 ? null : [src.slice(at, colon), src.slice(colon + 1, i)];
  };
  const paletteViolationsIn = (src) => {
    const clean = stripComments(src);
    const found = [];
    const at = (i) => clean.slice(0, i).split("\n").length;
    const record = (i) => found.push({ line: at(i), text: src.split("\n")[at(i) - 1].trim().slice(0, 120) });
    for (const m of clean.matchAll(ZERO_TERNARY)) {
      const arms = armsOf(clean, m.index + m[0].length);
      if (!arms) continue;
      const zeroArm = m[1].length === 2 ? arms[0] : arms[1];
      if (!PAL.test(zeroArm) || NESTED_ZERO.test(zeroArm)) continue;
      const from = Math.max(clean.lastIndexOf(";", m.index), clean.lastIndexOf("\n", m.index)) + 1;
      if (CHAINED.test(clean.slice(from, m.index))) continue;
      record(m.index);
    }
    for (const m of clean.matchAll(BOUND)) {
      const use = new RegExp("\\b" + m[1] + "\\s*\\?", "g");
      use.lastIndex = m.index + m[0].length;
      for (let u = use.exec(clean); u; u = use.exec(clean)) {
        const arms = armsOf(clean, u.index + u[0].length);
        if (arms && PAL.test(arms[0]) && !NESTED_ZERO.test(arms[0])) { record(m.index); break; }
      }
    }
    return found;
  };

  const bad = [
    'dots: [{ x: xAt(i), y: mid, color: v >= 0 ? pal.pos : pal.neg }]',
    'fill: cssVar(m >= 0 ? "--up-mark" : "--down-mark")',
    'const dots = [{ x: x(X), y: y(e), color: e <= 0 ? "--down" : "--up" }];',
    'part(fmt(v), null, v >= 0 ? pal.posT : pal.negT)',
    'const pos = v >= 0;\n        s("rect", {\n          x: cx, y: pos ? mid - hh : mid,\n          fill: paint(pos ? pal.pos : pal.neg),\n        }, svg);',
    'const dotC = o.twoTone && si === 0 ? paint(sr.values[li] < 0 ? "--down" : "--up") : color;',
    'dots.push({ x: xAt(i), y: y(v), color: o.twoTone ? (v < 0 ? "--down" : "--up") : sr.color || "--accent" });',
    'fill: cssVar(sg > 0 ? "--up-mark" : "--down-mark"), "fill-opacity": 0.85',
    's("rect", { y: v >= 0 ? mid - hh : mid, class: inside ? "st-in" : v >= 0 ? "st-pos" : "st-neg" }, svg);',
    'h("i", { class: dev >= 0 ? "is-more" : "is-less", style: dev >= 0 ? { left: "50%" } : { right: "50%" } })',
    'h("b", { "data-tone": r.ls === null ? null : r.ls < 0 ? "down" : "up" }, pct(r.ls))',
    'm.popP._gap.dataset.tone = d >= 0 ? "up" : "down";',
    'style: { "--c": val < 0 ? "var(--down-mark)" : "var(--up-mark)", left: "50%" }',
  ];
  for (const src of bad) {
    eq(paletteViolationsIn(src).length, 1,
       `the palette scanner catches a zero test whose zero arm picks a side: ${src.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  const good = [
    'dots: [{ x: xAt(i), y: mid, color: v > 0 ? pal.pos : v < 0 ? pal.neg : "--label-3" }]',
    'fill: cssVar(m > 0 ? "--up-mark" : m < 0 ? "--down-mark" : "--label-3")',
    'const ly = vals[i] >= 0 ? mid - hh - 7 : mid + hh + 14;',
    'const pos = v > 0;\n        s("rect", { fill: paint(pos ? pal.pos : pal.neg) }, svg);',
    'const up = v >= 0;\n        const y = up ? mid - hh : mid;',
    'const dotC = paint(sr.values[li] > 0 ? "--up" : sr.values[li] < 0 ? "--down" : "--label-3");',
    'class: inside || v === 0 ? "st-in" : v > 0 ? "st-pos" : "st-neg"',
    'tone: c === null || c === 0 ? null : c < 0 ? "up" : "down"',
    'return l === null ? null : Math.abs(l) < 0.1 ? ["flat", "Even"] : l > 0 ? ["up", "Bullish"] : ["down", "Bearish"];',
    'meterColor: num(r.diff) !== null && r.diff < 0 ? "--down-mark" : "--label-2"',
    'tone: v >= 0 ? (v > 0 ? "up" : "flat") : "down"',
    'sc !== null && sc > 0 ? h("i", { class: "fu-db-d is-c" }) : null',
    'class: v > 0 ? "is-more" : v < 0 ? "is-less" : "is-flat", at: x?.y ?? 0',
  ];
  for (const src of good) {
    eq(paletteViolationsIn(src).length, 0,
       `and clears the three-way form, a zero already taken by an earlier arm, a zero that lands neutral, and a test that places rather than colours: ${src.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  eq(paletteViolationsIn('// color: v >= 0 ? pal.pos : pal.neg').length, 0,
     "a comment quoting the defect is not accused of it");

  const all = [];
  for (const f of files) {
    for (const v of paletteViolationsIn(readFileSync(new URL(f, JS_DIR), "utf8"))) {
      all.push(`assets/js/${f}:${v.line}  ${v.text}`);
    }
  }
  eq(all.length, 0,
     "no zero test in a Flows renderer sends an exact zero to a directional palette.\n" +
     (all.length ? "  " + all.join("\n  ") + "\n" : "") +
     "  The scan reads every ternary on `v < 0`, `v <= 0`, `v > 0` or `v >= 0` and the arm an exact zero lands in\n" +
     "  (the first for <= and >=, the second for < and >), and every boolean bound by `v >= 0` or `v <= 0` where it\n" +
     "  later picks an arm. It fails when that arm names a directional token: a CSS colour token (--up, --down,\n" +
     "  their -mark forms, --g-long, --g-short, inside var() too), pal.pos/pal.neg/posT/negT, the classes is-pos,\n" +
     "  is-neg, is-more, is-less, is-up, is-down, st-pos, st-neg, or the tones \"up\" and \"down\". A zero already\n" +
     "  taken by an earlier arm of the same chain (`v === 0 ? ... :`, a dead band `Math.abs(v) < k ? ... :`) or a\n" +
     "  nested zero test in the arm clears it. It does not see a zero excluded by an `if` before the ternary, a\n" +
     "  palette held in a plain variable, or a ternary split across lines; those are written three-way anyway.\n" +
     "  Zero takes its own arm and a neutral token: `v > 0 ? pal.pos : v < 0 ? pal.neg : \"--label-3\"`.\n" +
     "  The scan has no allow-list, for the same reason the sign scan has none.");

  const ui = readFileSync(new URL("flows-chart.js", JS_DIR), "utf8");
  const div = ui.slice(ui.indexOf("function diverging("), ui.indexOf("function heatmap("));
  ok(/if \(v === 0\) \{ s\("rect", \{[^}]*height: 1, fill: paint\("--label-3"\), class: "zero" \}/.test(div),
     "diverging draws an exact zero as a 1 px neutral tick on the axis in --label-3, not as a bar with a side");
  ok(/const pos = v > 0;/.test(div), "and the side of a bar is decided by a strict test, after zero has been drawn");
  const heat = ui.slice(ui.indexOf("function heatmap("), ui.indexOf("function gauge("));
  ok(/if \(v === null\) \{ s\("rect", \{ \.\.\.cell, fill: "none", stroke: paint\("--label-4"\)[^}]*"stroke-dasharray"/.test(heat),
     "heatmap draws a null cell as a dashed void with no fill");
  ok(/if \(v === 0\) \{ s\("rect", \{ \.\.\.cell, fill: paint\("--fill-4"\), class: "zero" \}/.test(heat),
     "and an exact zero as a drawn neutral cell: zero is a reading, absence is not");
  const market = stripComments(readFileSync(new URL("flows-market.js", JS_DIR), "utf8"));
  ok(/const pct = \(v, dp\) => F\.pct\(isNum\(v\), dp\);/.test(market),
     "the Market page's percent goes through F.pct, after the reader that admits the vendor's quoted numerics: a fraction " +
     "that rounds to zero prints 0.0%, not -0.0% with a hyphen, and a quoted 0.3412 still prints 34.1%");
  const tk = stripComments(readFileSync(new URL("flows-ticker.js", JS_DIR), "utf8"));
  ok(/keyOf\("--label-4", "void", "Not quoted"\)/.test(tk) && !/keyOf\("--fill-4", "", "Not quoted"\)/.test(tk),
     "the Surface legend keys an unquoted cell as the void the kernel draws for it, not as a filled --fill-4 square, which is now an exact zero");
  ok(/\.ui-key > i\.is-void \{[^}]*background: none;[^}]*border: 1px dashed var\(--c\);/.test(CSS),
     "and the shared stylesheet draws that key unfilled, with a dashed outline in its own colour");
}

console.log(`✓ flows-sign: ${checks} assertions — a rule that lived in one file's comment and ` +
  `was broken in six others, now enforced by structure rather than by review: no sign decided ` +
  `in two arms anywhere in the Flows renderers, a scanner proven against both the defect and ` +
  `its fix so it cannot be silently matching nothing, comments quoting the bad form not ` +
  `accused of it, no allow-list, and every neutral class checked against the stylesheet so a ` +
  `consolidation cannot turn a chart invisible; and no zero test, strict or one-sided, sends an exact ` +
  `zero to a directional colour token, class or tone, so a zero is drawn neutral, never on a side`);
