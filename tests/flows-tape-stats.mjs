import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  TIERS, SIDE_TAGS, TIER_TAGS, SIDE_WORDS, FLAGS, MULTI_LEG_CODES, LARGE_PRINT_MULTIPLE, ASK_SHARE_RULE, WINDOWS_S,
  num, tierOf, sideTagOf, upstreamCodes, sweepOf, classifyPrint, flagNames, hasFlag, largeAt, largeLabel, parityOf,
  aggregate, reconciles, askShare, askShareRead,
} from "../shared/flows-tape-stats.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const deep = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const near = (a, b, m, tol = 1e-9) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); checks++; };
const t0 = process.hrtime.bigint();

const SOURCE = readFileSync(new URL("../shared/flows-tape-stats.js", import.meta.url), "utf8");

const NOW = Date.parse("2026-10-02T15:00:00Z");
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();
const print = (o = {}) => ({
  id: "t0", executed_at: at(10), option_type: "call", size: 10, price: "1.10", nbbo_bid: "1.00", nbbo_ask: "1.10",
  premium: "1100", tags: ["ask_side"], report_flags: [], upstream_condition_detail: "auto", canceled: false, ...o,
});

{
  const grid = [
    ["1.12", "A"], ["1.10", "A"], ["1.09", "a"], ["1.06", "a"], ["1.05", "m"], ["1.04", "b"], ["1.01", "b"], ["1.00", "B"], ["0.95", "B"],
  ];
  for (const [price, tier] of grid) eq(tierOf(price, "1.00", "1.10"), tier, `bid 1.00 ask 1.10: a fill at ${price} is tier ${tier}`);
  eq(tierOf(1.1, 1, 1.1), "A", "numbers read like their strings");
  eq(tierOf("1.00", "1.00", "1.00"), "m", "a locked market fills at the midpoint, which is the bid and the ask");
  eq(tierOf("1.00", "1.10", "1.00"), "n", "a crossed market has no side to read");
  eq(tierOf("0.05", "0.00", "0.05"), "A", "a zero bid is a quote: a fill at the ask is still at the ask");
  eq(tierOf("0.025", "0.00", "0.05"), "m", "and the midpoint of it is 0.025");
  eq(tierOf("0.01", "0.00", "0.05"), "b", "and a fill under it is below the midpoint");
  eq(tierOf("0.20", "0.10", "0.30"), "m", "0.1 and 0.3 average to 0.2 without float noise deciding the tier");
  for (const [price, bid, ask] of [[null, "1", "2"], ["1.5", null, "2"], ["1.5", "1", null], ["", "1", "2"], ["x", "1", "2"], ["1.5", "1", "NaN"],
    ["0", "1", "2"], ["-1", "1", "2"], ["1.5", "-1", "2"], ["1.5", "1", "0"], [undefined, undefined, undefined], [{}, [], true]]) {
    eq(tierOf(price, bid, ask), "n", `no usable quote or price (${JSON.stringify([price, bid, ask])}) is tier n`);
  }
  deep([...TIERS], ["A", "a", "m", "b", "B", "n"], "six tiers, strongest ask first");
  deep(Object.keys(TIER_TAGS), [...TIERS], "each tier has the vendor tag it should agree with");
  deep(Object.keys(SIDE_WORDS), [...TIERS], "and the words that describe it");
}

{
  eq(num(" 1.5 "), 1.5, "a padded numeric string is a number");
  eq(num(""), null, "an empty string is absent, not zero");
  eq(num(null), null, "null is absent");
  eq(num(NaN), null, "NaN is absent");
  eq(num("1e3"), 1000, "exponent notation is read");
  eq(num(true), null, "a boolean is not a number");
}

{
  eq(sideTagOf(["ask_side"]), "ask_side", "the vendor's side tag");
  eq(sideTagOf(["index", "bid_side", "china"]), "bid_side", "among the classification tags");
  eq(sideTagOf("mid_side"), "mid_side", "as a string");
  eq(sideTagOf(["ASK_SIDE"]), "ask_side", "case does not matter");
  eq(sideTagOf(["ask_side", "ask_side"]), "ask_side", "a repeated tag is one tag");
  eq(sideTagOf(["ask_side", "bid_side"]), null, "two different sides is no side");
  eq(sideTagOf(["dividend", "index"]), null, "classification tags are not sides");
  eq(sideTagOf(undefined), null, "absent tags");
  eq(sideTagOf(null), null, "null tags");
  eq(sideTagOf([]), null, "no tags");
  deep([...SIDE_TAGS], ["ask_side", "bid_side", "mid_side", "no_side"], "the four sides the vendor documents");
}

{
  const t = (o) => classifyPrint(print(o));
  const agreeAsk = t({ price: "1.12", tags: ["ask_side"] });
  deep([agreeAsk.side, agreeAsk.tier, agreeAsk.parity, agreeAsk.basis, agreeAsk.signed], [1, "A", "agree", "tag", true], "ask_side at the ask: +1, the tag and the tier agree");
  const weakAsk = t({ price: "1.07", tags: ["ask_side"] });
  deep([weakAsk.side, weakAsk.tier, weakAsk.parity], [1, "a", "agree"], "ask_side above the midpoint: still +1 with the weaker tier a");
  const bid = t({ price: "1.00", tags: ["bid_side"] });
  deep([bid.side, bid.tier, bid.parity], [-1, "B", "agree"], "bid_side at the bid: -1");
  const weakBid = t({ price: "1.03", tags: ["bid_side"] });
  deep([weakBid.side, weakBid.tier, weakBid.parity], [-1, "b", "agree"], "bid_side under the midpoint: -1 with tier b");
  const mid = t({ price: "1.05", tags: ["mid_side"] });
  deep([mid.side, mid.tier, mid.parity, mid.signed], [0, "m", "agree", false], "mid_side at the midpoint: unsigned");
  for (const [tag, price, tier] of [["ask_side", "1.05", "m"], ["ask_side", "1.00", "B"], ["bid_side", "1.10", "A"], ["mid_side", "1.08", "a"], ["mid_side", "1.02", "b"], ["bid_side", "1.05", "m"]]) {
    const r = t({ tags: [tag], price });
    deep([r.side, r.tier, r.parity, r.basis, r.signed], [0, tier, "disagree", "conflict", false], `${tag} against a fill at tier ${tier}: the evidence conflicts, so the print is unsigned and says so`);
  }
  const none = t({ tags: ["no_side"], price: "1.12" });
  deep([none.side, none.parity, none.signed], [0, "unchecked", false], "no_side is honoured even when the quote would have named one");
  const untagged = t({ tags: [], price: "1.12" });
  deep([untagged.side, untagged.tag, untagged.basis, untagged.parity], [1, null, "tier", "unchecked"], "no side tag: the tier decides and the parity is unchecked");
  eq(t({ tags: undefined, price: "1.00" }).side, -1, "absent tags fall back to the tier too");
  eq(t({ tags: [], price: "1.05" }).side, 0, "the midpoint has no side");
  const noQuote = t({ nbbo_bid: null, nbbo_ask: null, tags: ["ask_side"] });
  deep([noQuote.side, noQuote.tier, noQuote.parity, noQuote.basis], [1, "n", "unchecked", "tag"], "a tag with no quote to check it against is taken as the vendor's word, unchecked");
  deep([t({ nbbo_bid: null, tags: [] }).side, t({ nbbo_bid: null, tags: [] }).basis], [0, "none"], "no tag and no quote: no side");
  eq(t({ premium: null }).signed, false, "a print with no premium cannot enter a signed total");
  eq(t({ premium: null }).premium, null, "and its premium stays null, not zero");
  eq(t({ size: "x" }).size, null, "an unreadable size is null");
  eq(t({ option_type: "put" }).right, "p", "puts");
  eq(t({ option_type: "call" }).right, "c", "calls");
  eq(t({ option_type: "other" }).right, null, "anything else is no right");
  eq(parityOf("ask_side", "A"), "agree", "parity helper agree");
  eq(parityOf("ask_side", "B"), "disagree", "parity helper disagree");
  eq(parityOf(null, "A"), "unchecked", "parity helper without a tag");
  eq(parityOf("ask_side", "n"), "unchecked", "parity helper without a quote");
}

{
  const sw = (o) => sweepOf(print(o));
  deep(sw({ report_flags: ["intermarket_sweep"], upstream_condition_detail: "auto" }), { sweep: true, reportFlag: true, upstreamCode: false }, "REST: report_flags names the sweep");
  deep(sw({ report_flags: [], upstream_condition_detail: "slan,isoi" }), { sweep: true, reportFlag: false, upstreamCode: true }, "REST: the upstream code isoi names it when the flag does not");
  deep(sw({ report_flags: [], upstream_condition_detail: "auto", trade_code: "slan,isoi" }), { sweep: true, reportFlag: false, upstreamCode: true }, "socket: trade_code carries the same codes");
  deep(sw({ report_flags: ["intermarket_sweep"], upstream_condition_detail: "isoi" }), { sweep: true, reportFlag: true, upstreamCode: true }, "both encodings at once");
  deep(sw({ report_flags: ["opening"], upstream_condition_detail: "auto" }), { sweep: false, reportFlag: false, upstreamCode: false }, "neither");
  eq(sw({ report_flags: [], upstream_condition_detail: "", trade_code: "intermarket_sweep" }).sweep, false, "the equity print's trade_code enum is not an option sweep: it would never have flagged one");
  eq(sw({ report_flags: [], upstream_condition_detail: "intermarket_sweep" }).sweep, false, "nor is it one in the REST upstream field");
  eq(sw({ report_flags: [], upstream_condition_detail: "xisoix" }).sweep, false, "a code is a whole token, not a substring");
  eq(sw({ report_flags: [], upstream_condition_detail: "isoix" }).sweep, false, "a longer code that starts with it is another code");
  eq(sw({ report_flags: [], upstream_condition_detail: "slan, isoi " }).sweep, true, "spaces around commas are tolerated");
  eq(sw({ report_flags: [], upstream_condition_detail: "ISOI" }).sweep, true, "case does not matter: the filter list spells it Isoi");
  eq(sw({ report_flags: "opening,intermarket_sweep" }).sweep, true, "report_flags as a comma string");
  eq(sw({ report_flags: ["INTERMARKET_SWEEP"] }).sweep, true, "report flags in any case");
  eq(sw({ report_flags: null, upstream_condition_detail: null }).sweep, false, "nulls");
  eq(sw({ report_flags: undefined, upstream_condition_detail: undefined }).sweep, false, "absent fields");
  eq(sw({ report_flags: [3, null, {}], upstream_condition_detail: 7 }).sweep, false, "garbage in the fields");
  deep(sweepOf(null), { sweep: false, reportFlag: false, upstreamCode: false }, "no print");
  deep(sweepOf("isoi"), { sweep: false, reportFlag: false, upstreamCode: false }, "a string is not a print");
  deep(upstreamCodes({ upstream_condition_detail: "SLAN,isoi", trade_code: "isoi,auto" }), ["slan", "isoi", "auto"], "codes are lower-cased, split and de-duplicated across both fields");
  eq(classifyPrint(print({ report_flags: [], upstream_condition_detail: "isoi" })).sweepVia, "upstream_code", "the row says which encoding carried the sweep");
  eq(classifyPrint(print({ report_flags: ["intermarket_sweep"] })).sweepVia, "report_flags", "report_flags");
  eq(classifyPrint(print({ report_flags: ["intermarket_sweep"], upstream_condition_detail: "isoi" })).sweepVia, "both", "both");
  eq(classifyPrint(print()).sweepVia, null, "and null when it is not a sweep");
  ok(hasFlag(classifyPrint(print({ report_flags: [], upstream_condition_detail: "isoi" })).flags, "sweep"), "the sweep bit is set from the upstream code alone");
}

{
  const f = (o, opts) => classifyPrint(print(o), opts).flags;
  for (const code of MULTI_LEG_CODES) ok(hasFlag(f({ upstream_condition_detail: "auto," + code }), "multiLeg"), `upstream code ${code} marks a multi-leg print`);
  eq(MULTI_LEG_CODES.length, 14, "the fourteen Ml and Tl codes the spec lists");
  ok(hasFlag(f({ is_multi_leg: true }), "multiLeg"), "is_multi_leg marks one");
  ok(!hasFlag(f({ is_multi_leg: false }), "multiLeg"), "false does not");
  ok(!hasFlag(f({ multi_vol: 500 }), "multiLeg"), "multi_vol is the contract's day total, not a property of this print");
  ok(hasFlag(f({ report_flags: ["extended_hours"] }), "extended"), "extended hours by report flag");
  ok(hasFlag(f({ upstream_condition_detail: "exht" }), "extended"), "extended hours by upstream code");
  ok(hasFlag(f({ canceled: true }), "canceled"), "canceled");
  ok(!hasFlag(f({ canceled: "true" }), "canceled"), "only a boolean true cancels");
  for (const tag of ["dividend", "arbitrage"]) ok(hasFlag(f({ tags: ["ask_side", tag] }), "excluded"), `tag ${tag} is excluded`);
  for (const tag of ["china", "index", "volatility"]) ok(!hasFlag(f({ tags: ["ask_side", tag] }), "excluded"), `tag ${tag} is classification, not exclusion`);
  eq(f({}), 0, "a plain print carries no flag");
  deep(flagNames(FLAGS.sweep | FLAGS.large), ["sweep", "large"], "flag names");
  deep(flagNames(0), [], "no flags");
  const bits = Object.values(FLAGS);
  ok(bits.every((b) => Number.isInteger(Math.log2(b))) && new Set(bits).size === bits.length, "each flag is its own bit");

  eq(largeAt(25000), 25000 * LARGE_PRINT_MULTIPLE, "a large print is a stated multiple of the floor");
  eq(LARGE_PRINT_MULTIPLE, 10, "ten times");
  for (const floor of [null, undefined, 0, -1, NaN, "x", ""]) {
    eq(largeAt(floor), null, `floor ${JSON.stringify(floor)}: no floor, no large print`);
    ok(!hasFlag(f({ premium: "9999999" }, { floor }), "large"), `and nothing is large against floor ${JSON.stringify(floor)}`);
  }
  ok(!hasFlag(f({ premium: "249999.99" }, { floor: 25000 }), "large"), "just under ten floors");
  ok(hasFlag(f({ premium: "250000" }, { floor: 25000 }), "large"), "exactly ten floors");
  ok(hasFlag(f({ premium: 400000 }, { floor: "25000" }), "large"), "a string floor and a number premium");
  ok(!hasFlag(f({ premium: null }, { floor: 25000 }), "large"), "no premium, no large print");
  eq(largeLabel(25000), "premium at least 10 times the tape's floor of $25,000", "the label states the multiple and the floor");
  eq(largeLabel(null), null, "and there is no label without a floor");

  for (const [name, o] of [["multi-leg", { upstream_condition_detail: "mlet" }], ["dividend", { tags: ["ask_side", "dividend"] }], ["arbitrage", { tags: ["bid_side", "arbitrage"], price: "1.00" }], ["canceled", { canceled: true }]]) {
    const r = classifyPrint(print(o));
    deep([r.side, r.signed], [0, false], `a ${name} print never enters a signed total`);
  }
  eq(classifyPrint(print({ upstream_condition_detail: "mlet" })).tier, "A", "but its tier is still read");
}

{
  const tape = [
    print({ id: "c-ask-a", executed_at: at(10), option_type: "call", premium: "100000" }),
    print({ id: "p-bid-a", executed_at: at(50), option_type: "put", price: "1.00", tags: ["bid_side"], premium: "40000" }),
    print({ id: "multi", executed_at: at(20), option_type: "call", premium: "60000", upstream_condition_detail: "mlet" }),
    print({ id: "div", executed_at: at(30), option_type: "call", premium: "7000", tags: ["ask_side", "dividend"] }),
    print({ id: "noprem", executed_at: at(15), premium: null }),
    print({ id: "canceled", executed_at: at(5), premium: "999999", canceled: true }),
    print({ id: "future", executed_at: at(-5), premium: "888888" }),
    print({ id: "undated", executed_at: null, premium: "777777" }),
    print({ id: "c-ask-b", executed_at: at(70), option_type: "call", premium: "30000" }),
    print({ id: "p-ask-b", executed_at: at(200), option_type: "put", premium: "20000" }),
    print({ id: "c-bid-b", executed_at: at(400), option_type: "call", price: "1.00", tags: ["bid_side"], premium: "10000" }),
    print({ id: "c-mid-b", executed_at: at(800), option_type: "call", price: "1.05", tags: ["mid_side"], premium: "5000" }),
    print({ id: "old", executed_at: at(5000), option_type: "call", premium: "123456" }),
  ];
  const w = aggregate(tape, { now: NOW });
  deep(Object.keys(w).map(Number), [...WINDOWS_S], "rolling windows of one, five and fifteen minutes");
  const one = w[60];
  deep([one.n, one.canceled, one.undated, one.unpriced], [5, 1, 1, 1], "60 s: five live prints, the canceled one counted and left out, the undated one counted and left out, the unpriced one counted");
  near(one.gross, 207000, "60 s gross premium");
  near(one.askPrem, 100000, "60 s premium at the ask");
  near(one.bidPrem, 40000, "60 s premium at the bid");
  near(one.otherPrem, 67000, "60 s premium unclassified: multi-leg and excluded");
  near(one.callSigned, 100000, "60 s calls signed");
  near(one.putSigned, -40000, "60 s puts signed");
  near(one.unclassifiedShare, 67000 / 207000, "60 s unclassified share");
  near(one.share, 100000 / 140000, "60 s ask share of the sided premium");
  near(one.classified, 140000 / 207000, "60 s share of premium that is sided");
  eq(one.lean, "ask", "60 s leans ask: 0.714 of the sided premium and 0.676 of the whole");
  deep([one.multiLeg, one.excluded, one.sweeps, one.large], [1, 1, 0, 0], "60 s counts of the flags");
  const five = w[300];
  near(five.askPrem, 150000, "300 s premium at the ask");
  near(five.bidPrem, 40000, "300 s premium at the bid");
  near(five.otherPrem, 67000, "300 s unclassified");
  near(five.callSigned, 130000, "300 s calls signed");
  near(five.putSigned, -20000, "300 s puts signed: a put at the ask is +20000 against -40000");
  const fifteen = w[900];
  near(fifteen.askPrem, 150000, "900 s premium at the ask");
  near(fifteen.bidPrem, 50000, "900 s premium at the bid");
  near(fifteen.otherPrem, 72000, "900 s unclassified now holds the midpoint print");
  near(fifteen.gross, 272000, "900 s gross");
  near(fifteen.callSigned, 120000, "900 s calls signed");
  eq(fifteen.n, 9, "900 s print count; the 5000 s old print is outside every window");
  for (const win of Object.values(w)) ok(reconciles(win), "asked + bid + unclassified reconcile to gross");
  const flagged = aggregate([print({ report_flags: [], upstream_condition_detail: "isoi", premium: "300000" }), print({ id: "p2", report_flags: ["intermarket_sweep"], premium: "1000" })], { now: NOW, floor: 25000 });
  deep([flagged[60].sweeps, flagged[60].large], [2, 1], "sweeps from both encodings are counted, and a large print is ten floors");
  const conflict = aggregate([print({ price: "1.05", tags: ["ask_side"] })], { now: NOW });
  deep([conflict[60].conflicts, conflict[60].askPrem, conflict[60].otherPrem], [1, 0, 1100], "a parity conflict is counted and left unclassified");
  const empty = aggregate([], { now: NOW });
  deep([empty[60].n, empty[60].gross, empty[60].unclassifiedShare, empty[60].share, empty[60].lean], [0, 0, null, null, null], "an empty tape has no shares, not zeros");
  const noClock = aggregate([print()], {});
  eq(noClock[60].n, 0, "without a clock nothing is placed in a window");
  eq(noClock[60].undated, 1, "and is counted as undated");
  deep(Object.keys(aggregate([print()], { now: NOW, windowsS: [10, 20] })).map(Number), [10, 20], "windows are a parameter");
  eq(aggregate("nope", { now: NOW })[60].n, 0, "a non-array tape is an empty tape");
  eq(aggregate([null, 3, "x", []], { now: NOW })[60].n, 0, "and rows that are not prints are not prints");
}

{
  let seed = 20261011;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const junk = [null, undefined, "", "x", "1.5", 2, -1, NaN, {}, [], true];
  const tape = [];
  for (let i = 0; i < 3000; i++) {
    const bid = rnd() * 3;
    const ask = bid + rnd();
    const p = {
      id: "r" + i,
      executed_at: rnd() < 0.05 ? pick(junk) : at(rnd() * 1200),
      option_type: pick(["call", "put", "x", null]),
      price: rnd() < 0.1 ? pick(junk) : (bid + (ask - bid) * (rnd() * 1.4 - 0.2)).toFixed(2),
      nbbo_bid: rnd() < 0.1 ? pick(junk) : bid.toFixed(2),
      nbbo_ask: rnd() < 0.1 ? pick(junk) : ask.toFixed(2),
      size: pick([1, 5, 50, "x", null]),
      premium: rnd() < 0.1 ? pick(junk) : String(Math.round(rnd() * 500000)),
      tags: pick([["ask_side"], ["bid_side"], ["mid_side"], ["no_side"], [], null, ["ask_side", "dividend"], ["bid_side", "arbitrage"], ["ask_side", "bid_side"], "ask_side", 5]),
      report_flags: pick([[], ["intermarket_sweep"], ["opening"], null, "x", 5]),
      upstream_condition_detail: pick(["auto", "slan,isoi", "mlet", "exht", "", null, 7]),
      trade_code: pick([undefined, "isoi", "slan", null]),
      canceled: pick([false, false, false, true, null]),
      is_multi_leg: pick([undefined, true, false]),
    };
    tape.push(p);
  }
  let bad = 0;
  for (const p of tape) {
    const r = classifyPrint(p, { floor: 25000 });
    const good = [-1, 0, 1].includes(r.side) && TIERS.includes(r.tier) && Number.isInteger(r.flags) && r.flags >= 0 && r.flags < 64 &&
      ["agree", "disagree", "unchecked"].includes(r.parity) && (!r.signed || (r.side !== 0 && r.premium !== null)) &&
      (r.parity !== "disagree" || r.side === 0);
    if (!good) bad++;
  }
  eq(bad, 0, "3000 random prints, junk fields among them: every row keeps its invariants and nothing throws");
  const w = aggregate(tape, { now: NOW, floor: 25000 });
  for (const [seconds, win] of Object.entries(w)) {
    ok(reconciles(win), `${seconds} s: asked + bid + unclassified equal gross within 1e-9 on a random tape`);
    ok(win.askPrem >= 0 && win.bidPrem >= 0 && win.otherPrem >= 0, `${seconds} s: no negative bucket`);
    ok(win.unclassifiedShare === null || (win.unclassifiedShare >= 0 && win.unclassifiedShare <= 1), `${seconds} s: the unclassified share is a share`);
  }
  ok(w[900].n >= w[300].n && w[300].n >= w[60].n, "a longer window never holds fewer prints");
  ok(w[900].gross >= w[300].gross - 1e-6 && w[300].gross >= w[60].gross - 1e-6, "nor less premium");
}

{
  const rows = [
    [{ askPrem: 75, bidPrem: 25, prem: 100 }, 0.75, 1, "ask"],
    [{ askPrem: 60, bidPrem: 20, prem: 100 }, 0.75, 0.8, "ask"],
    [{ askPrem: 65, bidPrem: 35, prem: 100 }, 0.65, 1, "ask"],
    [{ askPrem: 35, bidPrem: 65, prem: 100 }, 0.35, 1, "bid"],
    [{ askPrem: 34, bidPrem: 66, prem: 100 }, 0.34, 1, "bid"],
    [{ askPrem: 64, bidPrem: 36, prem: 100 }, 0.64, 1, "mixed"],
    [{ askPrem: 36, bidPrem: 64, prem: 100 }, 0.36, 1, "mixed"],
    [{ askPrem: 50, bidPrem: 50, prem: 100 }, 0.5, 1, "mixed"],
    [{ askPrem: 30, bidPrem: 10, prem: 100 }, 0.75, 0.4, "thin"],
    [{ askPrem: 25, bidPrem: 25, prem: 100 }, 0.5, 0.5, "mixed"],
    [{ askPrem: 26, bidPrem: 14, prem: 80 }, 0.65, 0.5, "ask"],
    [{ askPrem: 14, bidPrem: 26, prem: 80 }, 0.35, 0.5, "bid"],
    [{ askPrem: 39, bidPrem: 10, prem: 100 }, 39 / 49, 0.49, "thin"],
    [{ askPrem: 3996, bidPrem: 1000, prem: 10000 }, 3996 / 4996, 0.4996, "ask"],
    [{ askPrem: 3504, bidPrem: 6496, prem: 10000 }, 0.3504, 1, "bid"],
    [{ askPrem: 6496, bidPrem: 3504, prem: 10000 }, 0.6496, 1, "ask"],
    [{ askPrem: 6449, bidPrem: 3551, prem: 10000 }, 0.6449, 1, "mixed"],
    [{ askPrem: 0, bidPrem: 0, prem: 100 }, null, 0, "thin"],
    [{ askPrem: 900, bidPrem: 700, prem: 1000 }, 0.5625, 1, "mixed"],
    [{ askPrem: 1500, bidPrem: 100, prem: 1000 }, 0.9375, 1, "ask"],
    [{ askPrem: 10, bidPrem: 0, prem: 0 }, null, null, null],
    [{ askPrem: 10, bidPrem: 10 }, null, null, null],
    [{ askPrem: 5, bidPrem: 5, prem: null }, null, null, null],
    [{ askPrem: 250000, prem: 250000 }, null, null, null],
    [{ askPrem: null, bidPrem: 5, prem: 10 }, null, null, null],
    [{ askPrem: 10, bidPrem: 0, prem: 10 }, 1, 1, "ask"],
    [{ askPrem: 0, bidPrem: 10, prem: 10 }, 0, 1, "bid"],
    [{ askPrem: -1, bidPrem: 10, prem: 10 }, null, null, null],
    [{ askPrem: "x", bidPrem: 10, prem: 10 }, null, null, null],
    [{ askPrem: "", bidPrem: 10, prem: 10 }, null, null, null],
    [{ askPrem: "60", bidPrem: "20", prem: "100" }, 0.75, 0.8, "ask"],
    [{}, null, null, null],
    [null, null, null, null],
    [[{ askPrem: 200000, bidPrem: 50000, prem: 250000 }, { askPrem: 10000, bidPrem: 80000, prem: 90000 }], 210000 / 340000, 1, "mixed"],
    [[{ askPrem: 100, bidPrem: 0, prem: 100 }, { prem: 1000 }], 1, 100 / 1100, "thin"],
    [[{ askPrem: 600, bidPrem: 200, prem: 800 }, { askPrem: 200, prem: 200 }], 0.75, 0.8, "ask"],
    [[{ askPrem: 1500, bidPrem: 500, prem: 1000 }, { prem: 1000 }], 0.75, 0.5, "ask"],
    [[{ askPrem: 30, bidPrem: 0, prem: 100 }, { askPrem: 0, bidPrem: 10, prem: 100 }], 0.75, 0.2, "thin"],
    [[{ prem: 100 }, { askPrem: 5, prem: 10 }], null, null, null],
  ];
  const check = (row, share, classified, side, label) => {
    const r = askShareRead(row);
    if (share === null) eq(r.share, null, `${label}: share null`); else near(r.share, share, `${label}: share`, 1e-12);
    if (classified === null) eq(r.classified, null, `${label}: classified null`); else near(r.classified, classified, `${label}: classified`, 1e-12);
    eq(r.side, side, `${label}: side ${side}`);
    eq(r.lean, side === "ask" || side === "bid" ? side : null, `${label}: lean is the coloured sides only`);
    deep(askShare(row), { share: r.share, classified: r.classified }, `${label}: askShare is the same pair`);
  };
  for (const [row, share, classified, side] of rows) check(row, share, classified, side, JSON.stringify(row));
  deep({ ...ASK_SHARE_RULE }, { askAt: 0.65, bidAt: 0.35, classifiedMin: 0.5 }, "the colour rule: 0.65 and 0.35 of the sided premium, at least half the premium sided, read as the whole percents printed");
  eq(askShare(undefined).share, null, "no row");
  const path = new URL("./fixtures-ask-share.json", import.meta.url);
  if (existsSync(path)) {
    const table = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(table) ? table : table.cases || [];
    ok(list.length > 0, "the client's known-answer table has cases");
    for (const c of list) check(c.rows, c.share, c.classified, c.side, "table " + c.name);
    console.log(`  ask-share: ${list.length} case(s) of tests/fixtures-ask-share.json hold on the server helper`);
  } else {
    console.log("  ask-share: tests/fixtures-ask-share.json is not in this tree yet; the inline table above stands alone");
  }
}

{
  const banned = /\b(bought|sold|buyer|seller|whale|smart money|institutional|paid)\b/i;
  for (const [tier, text] of Object.entries(SIDE_WORDS)) {
    ok(!banned.test(text), `tier ${tier}: "${text}" says where the print was struck, never who bought or sold`);
  }
  ok(/^at or above the ask$/.test(SIDE_WORDS.A) && /^at or below the bid$/.test(SIDE_WORDS.B), "the strong tiers use the lexicon's phrases");
  ok(!banned.test(largeLabel(25000)), "and the large-print label");
  ok(!/\bimport\b|\brequire\(/.test(SOURCE), "the classifier is a leaf: it imports nothing");
  ok(!/Date\.now|new Date\(\)|Math\.random|process\.|globalThis/.test(SOURCE), "and reads no clock, no randomness and no environment: the caller passes the time");
}

const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`✓ flows-tape-stats: ${checks} assertions — six side tiers from the NBBO against the vendor's side tag with the disagreement counted and left unsigned, a sweep read from the report flag or the upstream code isoi and never from the equity enum, a large print only as ten times a stated floor, multi-leg, canceled, dividend and arbitrage prints kept out of every signed total, and rolling windows whose asked, bid and unclassified premium reconcile to gross within 1e-9, in ${ms.toFixed(0)} ms`);
