import assert from "node:assert/strict";
import { loadMutated } from "./truth/mutants.mjs";
import * as ASK from "../shared/flows-ask.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const POSITIVE = [
  "It'll hold the call wall.", "Dealers'll keep pinning the strike.", "The wall won't break.", "Spot shan't reach the flip.",
  "Price shall rise.", "The move is unlikely.", "It is gonna move.", "Analysts foresee a rally.", "A break is imminent.",
  "A squeeze is inevitable.", "Spot ought to hold.", "The name is due for a pullback.", "More volatility is in store.",
  "The stock is on course to double.", "Spot is on pace to break out.", "The report is about to land.", "It's about to report.",
  "They're about to hedge.", "Premium will rise.", "It is likely to hold.", "A target is set.", "The odds favour a break.",
];
const NEGATIVE = [
  "The put-call ratio is at odds with the dealer lean.", "Calls and puts are in balance.", "Spot sits at the gamma flip.",
  "Open interest grew across the strikes.", "The report was due last week.", "The name was about to report when the data stopped.",
  "Implied volatility rose against realised volatility.", "Dealers are long gamma on the vendor's convention.",
  "Net premium was positive for the session.", "The put wall holds the lowest strike.", "Volume is above its median.",
];
const curly = (s) => s.replace(/'/g, "’");
const verdict = (mod, s) => mod.guardAnswer(s, [], { modals: true, smallIntegers: false });

function battery(mod) {
  const bad = [];
  for (const s of POSITIVE) for (const form of [s, curly(s)]) {
    const v = verdict(mod, form);
    if (v.ok || !v.forecast) bad.push("not refused as a forecast: " + form);
  }
  for (const s of NEGATIVE) {
    const v = verdict(mod, s);
    if (!v.ok) bad.push("refused though it describes: " + s + " (" + v.rejected.join(", ") + ")");
  }
  const full = verdict(mod, "４２ contracts traded.");
  if (full.ok) bad.push("a fullwidth numeral passes the figure check");
  return bad;
}

const base = battery(ASK);
assert.deepEqual(base, [], "the shipped guard passes its own battery:\n" + base.join("\n"));
checks += POSITIVE.length * 2 + NEGATIVE.length + 1;

ok(typeof ASK.FORECAST_ALT === "string" && ASK.FORECAST_ALT.includes("won't") && ASK.guardText("don’t") === "don't" && ASK.guardText("１２") === "12", "the lexicon is one exported source and the text is normalised before it is read: curly apostrophes become straight and fullwidth digits ASCII");

const MUTANTS = [
  ["contractions of will dropped", [["|\\\\w+'ll|won't|shan't", ""]]],
  ["typographic apostrophes not normalised", [["const text = guardText(answer);", 'const text = typeof answer === "string" ? answer : "";']]],
  ["fullwidth digits not normalised", [[".normalize(\"NFKC\")", ""]]],
  ["unlikely dropped", [["|likely|unlikely|", "|likely|"]]],
  ["at odds counted as a forecast", [["(?<!at )odds", "odds"]]],
  ["about to dropped", [["|(?:is|are) about to|'s about to|'re about to", ""]]],
  ["due for dropped", [["|due for|", "|"]]],
  ["shall dropped", [["will|should|shall|", "will|should|"]]],
];
for (const [name, transforms] of MUTANTS) {
  const mod = await loadMutated("shared/flows-ask.js", transforms);
  const fails = battery(mod);
  ok(fails.length > 0, `planted wrong build "${name}" passed the battery`);
}

console.log(`flows-guard-lexicon: ${checks} checks, ${MUTANTS.length} planted wrong builds killed`);
