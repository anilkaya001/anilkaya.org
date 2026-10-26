import assert from "node:assert/strict";
import {
  centsOf, windowEntry, tally, leanRead, askShareCompat, printEntry, REASON_LABELS, REASON_HOVERS, WINDOW_REASONS, PRINT_REASONS, LEAN_WHY,
  CLASSIFIED_FLOOR_CENTS,
} from "../shared/flows-sides.js";
import { askShareRead, classifyPrint } from "../shared/flows-tape-stats.js";
import { mulberry32 } from "./lib/sfc-rng.mjs";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

{
  const cases = [
    [1234567.89, 123456789, false], ["1234567.89", 123456789, false], [0, 0, false], ["0", 0, false], [186705, 18670500, false],
    [0.1, 10, false], [0.07, 7, false], [19.99, 1999, false], [4503599627370.49, 450359962737049, false],
    ["12.345", 1234, true], ["12.355", 1236, true], ["12.3400", 1234, false], ["12.3450", 1234, true], ["12.34500001", 1235, true], ["12.346", 1235, true],
    ["0.005", 0, true], ["0.015", 2, true], ["0.025", 2, true], ["0.0050", 0, true], [1e-7, 0, true], [5e-324, 0, true],
  ];
  for (const [v, cents, rounded] of cases) {
    const r = centsOf(v);
    ok(r !== null && r.cents === cents && r.rounded === rounded, `${JSON.stringify(v)} is ${cents} cents (rounded ${rounded}), got ${JSON.stringify(r)}`);
  }
  for (const v of [-1, "-1", NaN, Infinity, "abc", "", null, undefined, {}, [], "1e3", "1,000", true, 1e21, 9e15, "90071992547409.93"]) {
    eq(centsOf(v), null, `${String(v)} is not a premium`);
  }
  eq(centsOf(-12.5, { signed: true }), { cents: -1250, rounded: false }, "a signed reading keeps its sign");
  eq(centsOf("-0.001", { signed: true }), { cents: 0, rounded: true }, "and never produces a negative zero");
  ok(Object.is(centsOf(-0.001, { signed: true }).cents, 0), "negative zero is zero");
  eq(centsOf(" 5 "), { cents: 500, rounded: false }, "a padded string");
  let sum = 0;
  for (let i = 0; i < 1000000; i++) sum += centsOf(1234.57).cents;
  eq(sum, 123457000000, "a million premiums of $1,234.57 add up to exactly 123,457,000,000 cents");
  let float = 0;
  for (let i = 0; i < 1000000; i++) float += 1234.57;
  ok(float !== 1234570000, "where the float sum of the same dollars is not exact");
}

const W = (prem, ask, bid, extra = {}) => ({ prem, askPrem: ask, bidPrem: bid, ...extra });

{
  eq(windowEntry(W(1000, 600, 300)), { ok: true, T: 100000, A: 60000, B: 30000, U: 10000, reason: "btw", stated: true, rounded: false }, "a stated window: the rest is not at the bid or ask");
  eq(windowEntry(W(1000, 600, 400)).reason, null, "no remainder, no reason");
  eq(windowEntry(W(1000, 600, 300, { single: false })).reason, "leg", "no single-leg trade: spread package legs");
  eq(windowEntry(W(1000, 600, 300, { floor: true })).reason, "cross", "a floor trade: floor reason");
  eq(windowEntry(W(1000, 600, 300, { single: false, floor: true })).reason, "leg", "multi-leg outranks floor");
  eq(windowEntry(W(1000, 600, 300, { single: null, floor: null })).reason, "btw", "an unknown flag is not a reason");
  eq(windowEntry(W(1000, 600, 300, { single: true, floor: false })).reason, "btw", "single leg, no floor");
  const ns = windowEntry(W(1000, 600, null, { single: false, floor: true }));
  eq([ns.A, ns.B, ns.U, ns.reason, ns.stated], [0, 0, 100000, "ns", false], "an absent bid books the whole premium to ns and the stated ask nowhere else, whatever the flags");
  eq(windowEntry(W(1000, undefined, 100)).reason, "ns", "an absent ask is ns too");
  eq(windowEntry(W(1000, -5, 100)).reason, "ns", "a negative side is absent and counted as ns");
  eq(windowEntry(W(1000, 700, 400)), { ok: false, why: "sides", T: 100000, rounded: false }, "sides above the premium make the window invalid");
  eq(windowEntry(W(1000, 1200, null)).why, "sides", "a stated side above the premium is invalid even when the other is absent");
  eq(windowEntry(W(1000, 600, 400.01)).why, "sides", "and a cent too many is invalid, not clamped");
  eq(windowEntry(W(null, 1, 1)).why, "premium", "no premium is unreadable");
  eq(windowEntry(W(-5, 0, 0)).why, "premium", "a negative premium is unreadable");
  eq(windowEntry(W("x", 0, 0)).why, "premium", "so is text");
  eq(windowEntry(W(0, 0, 0)), { ok: true, T: 0, A: 0, B: 0, U: 0, reason: null, stated: true, rounded: false }, "a zero-premium window is valid and empty");
  eq(windowEntry(W(0, 5, 0)).why, "sides", "a zero premium with a side is invalid");
  eq(windowEntry(null).why, "premium", "a missing row is unreadable");
  const exact = windowEntry(W("100.005", "40.005", "30"));
  eq([exact.T, exact.A, exact.rounded], [10000, 4000, true], "rounding at ingest is counted and half-even (100.005 to 100.00, 40.005 to 40.00)");
}

{
  const rows = [W(1000, 600, 300), W(500, 100, null), W(300, 200, 200), W(0, 0, 0), W(null, 1, 1), W(100, 70, 30, { floor: true })];
  const { totals, counts } = tally(rows.map(windowEntry));
  eq(counts, { given: 6, zero: 1, invalid: 1, invalidCents: 30000, unreadable: 1, rounded: 0 }, "the counts name every window that did not book");
  eq(totals, { n: 3, T: 160000, A: 67000, B: 33000, U: { btw: 10000, cross: 0, leg: 0, ns: 50000 } }, "the totals of the windows that booked");
  eq(totals.A + totals.B + totals.U.btw + totals.U.cross + totals.U.leg + totals.U.ns, totals.T, "bought + sold + no-side premium is the total, exactly");
}

const cents = (k) => k * 100000;

{
  const r = leanRead({ T: cents(1450), A: cents(900), B: cents(300) });
  eq([r.pct.lo, r.pct.hi, r.pct.share, r.pct.coverage, r.side, r.why], [62, 80, 75, 83, "buyers", null], "the worked example: 62-80% bounds, 75% share, 83% classified, buyers");
  ok(Math.abs(r.lo - 18 / 29) < 1e-15 && Math.abs(r.hi - 23 / 29) < 1e-15 && Math.abs(r.share - 0.75) < 1e-15 && Math.abs(r.coverage - 24 / 29) < 1e-15, "with exact ratios 18/29, 23/29, 3/4 and 24/29");
  ok(r.lo <= r.share && r.share <= r.hi, "the share sits inside the bounds");
  eq(leanRead({ T: cents(24000), A: cents(24000), B: 0 }).pct, { share: 100, coverage: 100, lo: 100, hi: 100 }, "fully stated one-sided premium is one figure");
}

{
  const w1 = { T: cents(1000), A: cents(200), B: cents(800) };
  const w2 = { T: cents(100), A: cents(90), B: cents(10) };
  const mean = (20 / 100 + 9 / 10) / 2;
  ok(mean > 0.5, "the mean of the window shares reads as buyers (Simpson)");
  const pooled = leanRead({ T: w1.T + w2.T, A: w1.A + w2.A, B: w1.B + w2.B });
  eq([pooled.side, pooled.pct.share, pooled.pct.lo, pooled.pct.hi, pooled.pct.coverage], ["sellers", 26, 26, 27, 100], "and the pooled ratio reads sellers: 29/110");
}

{
  const rows = [W(1000000, 600000, 500000), W(500000, 300000, 100000)];
  const { totals, counts } = tally(rows.map(windowEntry));
  eq([counts.invalid, counts.invalidCents], [1, 100000000], "the invalid window is counted with its premium");
  const r = leanRead(totals);
  eq([r.pct.share, r.pct.coverage, r.pct.lo, r.pct.hi, r.side], [75, 80, 60, 80, "buyers"], "and left out of every sum");
  const legacy = askShareCompat(rows);
  ok(Math.abs(legacy.share - 93 / 154) < 1e-9 && Math.abs(legacy.classified - 14 / 15) < 1e-9 && legacy.side === "mixed", "the compatible read scales it by 10/11, as the legacy read does");
  const real = askShareRead(rows);
  ok(Math.abs(real.share - legacy.share) < 1e-12 && Math.abs(real.classified - legacy.classified) < 1e-12 && real.side === legacy.side, "and agrees with askShareRead on the same rows");
}

{
  const rows = [W(500000, 300000, 100000), W(400000, 200000, null)];
  const { totals } = tally(rows.map(windowEntry));
  eq(totals.U, { btw: 10000000, cross: 0, leg: 0, ns: 40000000 }, "rows: ns 40,000,000 and btw 10,000,000 cents");
  const r = leanRead(totals);
  eq([r.pct.share, r.pct.coverage, r.pct.lo, r.pct.hi, r.side], [75, 44, 33, 89, "undetermined"], "share 75%, coverage 44%, bounds 33-89%, undetermined");
  const legacy = askShareRead(rows);
  ok(Math.abs(legacy.share - r.share) < 1e-12 && Math.abs(legacy.classified - r.coverage) < 1e-12 && legacy.side === "thin", "askShareRead has the same share and classified, and calls it thin");
  const mine = askShareCompat(rows);
  eq([mine.side, mine.lean], [legacy.side, legacy.lean], "the compatible read agrees with the legacy side too");
}

{
  const zero = leanRead({ T: 0, A: 0, B: 0 });
  eq([zero.share, zero.coverage, zero.side, zero.why, zero.reason], [null, null, null, "noPremium", LEAN_WHY.noPremium], "no premium: everything null");
  const none = leanRead({ T: cents(500), A: 0, B: 0 });
  eq([none.share, none.side, none.why, none.coverage, none.pct.lo, none.pct.hi], [null, null, "noSides", 0, 0, 100], "premium with no stated side: share null, bounds 0 to 100");
  const thin = leanRead({ T: cents(1000), A: cents(300), B: cents(99) });
  eq([thin.why, thin.share, thin.pct.coverage], ["lowCoverage", null, 40], "coverage just under 40% is gated (399/1000)");
  const edge = leanRead({ T: cents(1000), A: cents(300), B: cents(100) });
  eq([edge.why, edge.pct.share], [null, 75], "and exactly 40% passes");
  const small = leanRead({ T: cents(300), A: cents(200), B: cents(49) });
  eq([small.why, small.reason], ["smallClassified", LEAN_WHY.smallClassified], "under $250k stated is gated");
  const floor = leanRead({ T: cents(300), A: cents(200), B: cents(50) });
  eq([floor.why, floor.side], [null, "buyers"], "exactly $250k stated passes");
  eq(CLASSIFIED_FLOOR_CENTS, 25000000, "the floor is $250,000 in cents");
  const half = leanRead({ T: cents(1000), A: cents(500), B: cents(400) });
  eq(half.side, "undetermined", "exactly half of the total is not buyers");
  const half2 = leanRead({ T: cents(1000), A: cents(501), B: cents(399) });
  eq(half2.side, "buyers", "a cent over half is");
  const big = leanRead({ T: 9007199254740990, A: 4503599627370496, B: 4503599627370494 });
  eq(big.side, "buyers", "near 2^53 cents the integer tests are exact");
  eq(leanRead({ T: cents(1000), A: cents(100), B: cents(600) }).side, "sellers", "sellers by 2B > T");
}

{
  const rnd = mulberry32(5150);
  let compared = 0;
  for (let n = 0; n < 4000; n++) {
    const count = 1 + Math.floor(rnd() * 12);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const T = 1 + Math.floor(rnd() * 5e8);
      const stated = rnd() < 0.85;
      const a = Math.floor(rnd() * T * 0.8);
      const b = Math.floor(rnd() * (T - a) * 0.9);
      const cap = rnd() < 0.5 ? null : rnd() < 0.5 ? b : null;
      rows.push({ prem: T / 100, askPrem: stated || rnd() < 0.5 ? a / 100 : null, bidPrem: stated ? b / 100 : cap === null ? null : cap / 100 });
    }
    const entries = rows.map(windowEntry);
    const { totals } = tally(entries);
    if (totals.T === 0) continue;
    const mine = leanRead(totals);
    const legacy = askShareRead(rows);
    if (legacy.classified === null) {
      ok(mine.coverage === 0 || mine.coverage === null || totals.A + totals.B === 0, "no stated pair: no share");
      continue;
    }
    ok(Math.abs(legacy.classified - mine.coverage) < 1e-12, `coverage equals classified (${legacy.classified} vs ${mine.coverage})`);
    if (mine.why !== "noSides") ok(legacy.share === null ? totals.A + totals.B === 0 : Math.abs(legacy.share - Number(totals.A) / Number(totals.A + totals.B)) < 1e-12, "share equals the legacy share");
    ok(mine.lo <= (mine.why === "noSides" ? 1 : mine.hi) + 1e-15, "lo is never above hi");
    if (mine.share !== null) ok(mine.lo - 1e-15 <= mine.share && mine.share <= mine.hi + 1e-15, "the share sits inside the bounds");
    compared++;
  }
  ok(compared > 3000, `${compared} random sets of windows compared with askShareRead`);
}

{
  const rnd = mulberry32(77);
  let held = 0;
  for (let n = 0; n < 3000; n++) {
    const wins = 1 + Math.floor(rnd() * 8);
    const rows = [];
    let trueBuy = 0, T = 0;
    for (let i = 0; i < wins; i++) {
      const prem = 1000 + Math.floor(rnd() * 90000);
      const buy = Math.floor(rnd() * (prem + 1));
      const a = Math.floor(buy * rnd());
      const b = Math.floor((prem - buy) * rnd());
      rows.push({ prem: prem / 100, askPrem: a / 100, bidPrem: rnd() < 0.2 ? null : b / 100 });
      trueBuy += buy; T += prem;
    }
    const { totals } = tally(rows.map(windowEntry));
    const r = leanRead(totals);
    ok(r.lo * T <= trueBuy + 1e-6 && trueBuy <= r.hi * T + 1e-6 || rows.some((x) => x.bidPrem === null), "the true buyer share is inside the proven bounds when every side is stated");
    held++;
  }
  ok(held === 3000, "3,000 hidden-truth worlds");
}

{
  const enc = (o) => classifyPrint({ price: o.price, nbbo_bid: 1, nbbo_ask: 2, premium: o.premium, option_type: "call", ...o.rest });
  const entry = (o, extra = {}) => ({ ...enc(o), ...extra });
  eq(printEntry(entry({ price: 2, premium: 500 })).reason, null, "a print at the ask is a bought print");
  const at = printEntry(entry({ price: 2, premium: 500 }));
  eq([at.A, at.B, at.U], [50000, 0, 0], "booked as ask side");
  const bid = printEntry(entry({ price: 1, premium: 500 }));
  eq([bid.A, bid.B, bid.U], [0, 50000, 0], "and a print at the bid as bid side");
  eq(printEntry(entry({ price: 1.5, premium: 500 })).reason, "mid", "a midpoint print");
  eq(printEntry(classifyPrint({ price: 1.5, premium: 500 })).reason, "nq", "a print without a quote");
  eq(printEntry(entry({ price: 2, premium: 500, rest: { is_multi_leg: true } })).reason, "leg", "a multi-leg print is a leg whatever its side");
  eq(printEntry(entry({ price: 2, premium: 500 }, { cross: true })).reason, "cross", "a print the caller marks as crossed");
  eq(printEntry(entry({ price: 1.9, premium: 500, rest: { tags: ["bid_side"] } })).reason, "disagree", "tag and tier that disagree");
  eq(printEntry(entry({ price: 2, premium: 500, rest: { canceled: true } })).why, "canceled", "a canceled print is dropped");
  eq(printEntry(entry({ price: 2, premium: 500, rest: { tags: ["dividend"] } })).why, "excluded", "a dividend print is dropped");
  eq(printEntry(entry({ price: 2, premium: null })).why, "premium", "a print with no premium is unreadable");
  eq(printEntry(entry({ price: 1.5, premium: 500, rest: { tags: ["ask_side"] } })).reason, "disagree", "a tag cannot sign a midpoint print: the two checks disagree");
  for (const r of PRINT_REASONS) ok(typeof REASON_LABELS.print[r] === "string" && typeof REASON_HOVERS.print[r] === "string", `print reason ${r} has a label and a hover`);
  for (const r of WINDOW_REASONS) ok(typeof REASON_LABELS.window[r] === "string" && typeof REASON_HOVERS.window[r] === "string", `window reason ${r} has a label and a hover`);
  for (const text of [...Object.values(REASON_HOVERS.window), ...Object.values(REASON_HOVERS.print), ...Object.values(LEAN_WHY)]) {
    ok(text.split(/\s+/).length < 14, `a sentence under fourteen words: ${text}`);
  }
}

console.log(`✓ flows-sides: ${checks} assertions - exact cents ingest, the window reasons and their priority, the pooled lean read with proven bounds, its agreement with askShareRead on 4,000 random sets and its three stated differences, print-level reasons`);
