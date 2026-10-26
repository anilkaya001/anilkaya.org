import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as TS from "../shared/flows-tape-stats.js";
import { loadMutated } from "./truth/mutants.mjs";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-print.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-print-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

function cases(M) {
  const bad = [];
  for (const [price, bid, ask, tier, why] of FX.rows) {
    const got = M.readQuote(price, bid, ask);
    if (got.tier !== tier || got.why !== why) bad.push(`price ${price} bid ${bid} ask ${ask}: ${got.tier}/${got.why} where the exact fraction says ${tier}/${why}`);
    if (M.tierOf(price, bid, ask) !== tier) bad.push(`tierOf disagrees with readQuote at ${price} ${bid} ${ask}`);
    if (bad.length > 6) break;
  }
  return bad;
}

eq(cases(TS).join("; "), "", `all ${FX.rows.length} quote and price triples classify as the Fraction oracle does, tier and reason`);

const tiers = new Set(FX.rows.map((r) => r[3] + "/" + r[4]));
for (const t of ["A/null", "a/null", "m/null", "b/null", "B/null", "n/locked", "n/crossed", "n/no-offer", "n/no-price", "n/no-quote"]) ok(tiers.has(t), `the fixture holds ${t}`);
ok(FX.rows.some((r) => r[1] === "0.00" && r[3] === "A"), "and a zero bid with a fill at the ask, which is still a buyer paying the offer");
ok(FX.rows.some((r) => r[3] === "A" && r[0] !== r[2] && r[1] === r[2]), "and a fill through a locked offer");

{
  const t = (o) => TS.classifyPrint({ id: "t", executed_at: "2026-10-02T14:59:50Z", option_type: "call", size: 10, price: "1.00", nbbo_bid: "1.00", nbbo_ask: "1.00", premium: "1000", tags: ["mid_side"], report_flags: [], upstream_condition_detail: "auto", canceled: false, ...o });
  const locked = t({});
  eq([locked.tier, locked.why, locked.side, locked.parity, locked.signed], ["n", "locked", 0, "unchecked", false], "a fill at a locked quote has no tier, says why, and signs nothing");
  eq(TS.NO_SIDE_WORDS.locked, "locked quote, side cannot be told", "in the words Opus ruled for it");
  const through = t({ price: "1.01", tags: [] });
  eq([through.tier, through.why, through.side, through.signed], ["A", null, 1, true], "a fill through a locked offer is at the ask and signs +1");
  const zeroBid = t({ price: "0.05", nbbo_bid: "0.00", nbbo_ask: "0.05", tags: [] });
  eq([zeroBid.tier, zeroBid.side], ["A", 1], "a fill at 0.05 on a 0.00 / 0.05 market is at the ask");
  const noOffer = t({ price: "0.01", nbbo_bid: "0.00", nbbo_ask: "0.00", tags: [] });
  eq([noOffer.tier, noOffer.why, noOffer.side], ["n", "no-offer", 0], "a 0.00 / 0.00 market has no offer to be at");
  eq(TS.classifyPrint({ price: "0.15", nbbo_bid: "0.10", nbbo_ask: "0.20", tags: [] }).tier, "m", "0.10 and 0.20 average to 0.15 whatever the float sum says");
}

{
  const src = readFileSync(new URL("../shared/flows-tape-stats.js", import.meta.url), "utf8");
  ok(!/Math\.abs\(p - mid\)/.test(src) && /ticksOf/.test(src), "the midpoint is the decimal statement 2P = A + B on integer ticks, with no tolerance to defend");
}

const MUTANTS = [
  ["the midpoint is a float comparison", [["const t = Math.round(n * TICKS_PER_DOLLAR);", "const t = n;"]]],
  ["the ticks are floored, not rounded", [["const t = Math.round(n * TICKS_PER_DOLLAR);", "const t = Math.floor(n * TICKS_PER_DOLLAR);"]]],
  ["a locked fill at the quote is a midpoint fill", [['if (a === b && p === a) return { tier: "n", why: "locked" };', ""]]],
  ["every locked quote has no side, even a fill through it", [["if (a === b && p === a) return", "if (a === b) return"]]],
  ["a zero bid is no quote", [["b === null || a === null || b < 0", "b === null || a === null || b <= 0"]]],
  ["a crossed quote is read", [['if (a < b) return { tier: "n", why: "crossed" };', ""]]],
  ["a fill at the ask is not at the ask", [["if (p >= a) return", "if (p > a) return"]]],
  ["a fill at the bid is not at the bid", [["if (p <= b) return", "if (p < b) return"]]],
  ["above and below the midpoint are swapped", [['twice > sum ? "a" : "b"', 'twice > sum ? "b" : "a"']]],
  ["a zero ask is a quote", [["if (a <= 0) return", "if (a < 0) return"]]],
  ["a zero price is a fill", [["if (p === null || p <= 0) return", "if (p === null || p < 0) return"]]],
];
for (const [name, transforms] of MUTANTS) {
  let mod;
  try { mod = await loadMutated("shared/flows-tape-stats.js", transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(cases(mod).length > 0, `planted wrong build must fail: ${name}`);
}

console.log(`✓ math-print: ${checks} assertions - ${FX.rows.length} quote and price triples classified on integer ticks as exact fractions do (a locked fill is no side with its own reason, a zero bid stays a quote, a crossed or offerless quote is no quote), and ${MUTANTS.length} planted wrong builds that each fail`);
