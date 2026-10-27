import { battery, failures, lintProblems } from "./ff-d-model.mjs";
import { loadModel } from "./lib/ff-d-model-load.mjs";

const PLANTS = [
  ["rounds negatives toward plus infinity", [["function round(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }", "function round(x) { return Math.round(x); }"]]],
  ["rounds twice, to the step and then to the grid", [["var g = round(Math.round(x / units[unit].xStep * 1e9) / 1e9);", "var g = round(scaled(x, unit) / gridUnits(unit));"]]],
  ["trusts float division on a tie", [["var g = round(Math.round(x / units[unit].xStep * 1e9) / 1e9);", "var g = round(x / units[unit].xStep);"]]],
  ["accepts k, m and b on a sigma", [["if (m[2] && unit !== \"usd\" && unit !== \"contracts\") return null;", ""]]],
  ["lets a nightly-only quantity go live", [["function cadenceAllowed(state, cadence) {\n      if (cadence === state.cadence)", "function cadenceAllowed(state, cadence) {\n      return { ok: true, reason: null };\n      if (cadence === state.cadence)"]]],
  ["allows == on an anomaly", [["if (c.op === \"==\" && m.kind !== \"anomaly\") base.push(\"==\");", "base.push(\"==\");"]]],
  ["drops the range check", [["if (!isNum(c.x) || c.x < m.range[0] || c.x > m.range[1])", "if (!isNum(c.x))"]]],
  ["counts the second clause on a metric as too many", [["if (per[k] > lim.clausesPerMetric)", "if (per[k] >= lim.clausesPerMetric)"]]],
  ["does not clamp a stepped threshold", [["return Math.min(b[1], Math.max(b[0], g));", "return g;"]]],
  ["swaps the live and nightly hold ranges", [["return cadence === \"live\" ? lim.persistLive : lim.persistNightly;", "return cadence === \"live\" ? lim.persistNightly : lim.persistLive;"]]],
  ["drops the quiet period from the sentence", [["+ hold + \", then \" + quiet;", "+ hold + \".\";"]]],
  ["leaves symbols unsorted in the AST", [["symbols: sc.symbols.slice().sort() };\n      if (sc.kind === \"sector\")", "symbols: sc.symbols.slice() };\n      if (sc.kind === \"sector\")"]]],
  ["prints dollars raw", [["case \"usd\": return F.scaled(v, compactDp, \"$\", false);", "case \"usd\": return \"$\" + v;"]]],
  ["removes the last condition", [["if (state.clauses.length <= lim.clausesMin) return state;", "if (state.clauses.length <= 0) return state;"]]],
  ["mixes a sector quantity with a window quantity", [["if (m.subject === \"sector\" && subs.some(function (s) { return s !== \"sector\"; })) return", "if (false) return"]]],
  ["lets a sector quantity watch named stocks", [["if (kind === \"names\" && state.clauses.some(", "if (false && state.clauses.some("]]],
  ["leaves the hold unclamped when the cadence changes", [["out.persist = Math.min(pr[1], Math.max(pr[0], out.persist));", ""]]],
  ["takes any quiet period", [["if (cooldownChoices(state.cadence).indexOf(n) < 0) return state;\n      var out = clone(state);\n      out.cooldown = n;", "var out = clone(state);\n      out.cooldown = n;"]]],
  ["keeps a nightly quiet period on a live wire", [["if (cooldownChoices(cadence).indexOf(out.cooldown) < 0) out.cooldown = lim.cooldownDefault[cadence];", ""]]],
  ["does not check names against the universe", [["else if (ctx.symbols) {", "else if (false) {"]]],
  ["lets a sector quantity watch names in validation", [["if (subs.sector && sc.kind === \"names\") add(", "if (false) add("]]],
  ["lets a live wire read two sources", [["if (state.cadence === \"live\" && (anomaly || Object.keys(keys).length > 1)) add(", "if (false) add("]]],
  ["allows a name twice", [["else if (new Set(s).size !== s.length)", "else if (false)"]]],
];

let survivors = 0;
for (const [name, patches] of PLANTS) {
  const before = failures.length;
  let built;
  try {
    built = loadModel(patches);
  } catch (err) {
    console.log("PLANT DID NOT APPLY: " + name + ": " + err.message);
    survivors++;
    continue;
  }
  try {
    battery(built, "plant");
  } catch (err) {
    failures.push("threw: " + err.message);
  }
  const killed = failures.length - before;
  failures.length = before;
  if (killed === 0) {
    survivors++;
    console.log("SURVIVED: " + name);
  }
}
const LINT = [
  ["a line comment", "x.js", "(function () {\n  \"use strict\";\n  var a = 1; // note\n})();"],
  ["a block comment", "x.css", "a { color: var(--x); } /* note */"],
  ["a hex colour", "x.css", "a { color: #fff; }"],
  ["an rgb colour", "x.css", "a { color: rgb(1, 2, 3); }"],
  ["a named colour", "x.css", "a { color: red; }"],
  ["the word tape", "x.js", "(function () {\n  \"use strict\";\n  var t = \"the tape\";\n})();"],
  ["innerHTML", "assets/js/x.js", "(function () {\n  \"use strict\";\n  e.innerHTML = a;\n})();"],
  ["browser storage", "assets/js/x.js", "(function () {\n  \"use strict\";\n  localStorage.a = 1;\n})();"],
  ["a route outside the four", "assets/js/x.js", "(function () {\n  \"use strict\";\n  get(\"/api/flows/chain?t=A\");\n})();"],
  ["a time computed in the browser", "assets/js/x.js", "(function () {\n  \"use strict\";\n  var n = Date.now();\n})();"],
  ["a fetch of its own", "assets/js/flows-ff-fire.js", "(function () {\n  \"use strict\";\n  fetch(\"/api/ff/preview\");\n})();"],
  ["the sigma glyph", "assets/js/x.js", "(function () {\n  \"use strict\";\n  var u = \"3\u03c3\";\n})();"],
  ["an import", "assets/js/x.js", "(function () {\n  \"use strict\";\n  import(\"./a.js\");\n})();"],
  ["a script that is not strict", "assets/js/x.js", "(function () {\n  var a = 1;\n})();"],
];
for (const [name, file, text] of LINT) {
  if (lintProblems(file, text).length === 0) {
    survivors++;
    console.log("LINT MISSED: " + name);
  }
}
console.log(PLANTS.length + LINT.length + " planted wrong builds, " + survivors + " survived");
process.exit(survivors ? 1 : 0);
