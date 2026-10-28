import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseOptionSymbol, daysToExpiry, priceSale, rankChain, ivConvention,
  numOrNull, DEFAULT_GATES, SHARES_PER_CONTRACT, DAYS_PER_YEAR, crossesEarnings,
  sizeToBuyingPower, planBuyingPower,
  ivSurface, SURFACE_ROW_STEPS, SURFACE_MAX_EXPIRIES,
  intrinsic, impossibleQuote, optionRoot, hasNoEarnings, PRICING_RATE, OFF_MARKET_TOLERANCE,
  deskSmiles, deskCarry, forwardPlan, forwardGapLimit, midImpliedVol, FORWARD_MIN_PAIRS, FORWARD_MAX_LOG_GAP, FORWARD_GAP_FLOOR,
  isRealDate, reportPrecedesSale, saleDayOf,
} from "../shared/flows-premium.js";
import { loadMutated } from "./truth/mutants.mjs";
import { ENGINE_LINES } from "../shared/flows-quant-engine.js";
import { black76 } from "../shared/flows-quant-bs.js";
import { yearFraction } from "../shared/flows-quant-time.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

{

  const uvix = parseOptionSymbol("UVIX240920C00025000");
  eq(uvix.strike, 25, "the spec's own example object fixes the divisor at 1000");
  eq(uvix.ticker, "UVIX"); eq(uvix.expiry, "2024-09-20"); eq(uvix.type, "C");

  const p = parseOptionSymbol("AAPL260918P00180000");
  eq(p.strike, 180, "eight strike digits carry three implied decimals");
  eq(p.type, "P");

  eq(parseOptionSymbol("SPY260918C00512500").strike, 512.5, "half-dollar strikes round-trip");

  ok(parseOptionSymbol("NOTANOPTION") === null, "an unrecognised symbol is dropped, not guessed");
  ok(parseOptionSymbol("AAPL261318P00180000") === null, "month 13 is rejected");
  ok(parseOptionSymbol("AAPL260918P00000000") === null, "a zero strike is not a strike");
  ok(parseOptionSymbol(null) === null, "a missing symbol is null, not a throw");
}

{

  const decimal = ivConvention(["0.31", "0.28", "0.44", "0.29"]);
  eq(decimal.divisor, 1, "a chain whose median is 0.29 is a fraction chain");

  const percent = ivConvention(["31", "28", "44", "29"]);
  eq(percent.divisor, 100, "a chain whose median is 29 is a percent chain");

  const withOutlier = ivConvention(["0.31", "0.28", "0.44", "0.29", "480"]);
  eq(withOutlier.divisor, 1, "a single 480 does not turn a fraction chain into a percent chain");

  eq(ivConvention([]).divisor, 1, "an empty chain defaults to fractions rather than throwing");
  ok(/no implied vol/.test(ivConvention([]).basis), "and says why");

  eq(ivConvention(["800", "900", "950"]).divisor, 1,
     "WITHOUT EVIDENCE a median past the sanity ceiling (500) is left undivided: 8.00 would be an 8% vol read from a number that is 800% either way, and a guess in that range is not offered");
  eq(ivConvention(["5.1", "5.2", "5.3"]).divisor, 100, "just past the old threshold and inside the band still reads as percent when nothing contradicts it");
  eq(ivConvention(["4.9", "4.8", "5"]).divisor, 1, "and at or below it as a fraction");

  const own = [0.31, 0.28, 0.44, 0.29, 0.33];
  const fractionOfFive = ivConvention(["5.5", "5.6", "5.4", "5.7", "5.3"],
    { pairs: [[5.5, 5.2], [5.6, 5.9], [5.4, 5.1], [5.7, 5.5], [5.3, 5.6]] });
  eq(fractionOfFive.divisor, 1,
     "A FRACTION CHAIN WHOSE MEDIAN IS 5.5 STAYS A FRACTION when the quotes' own vols agree with it (the old rule divided by 100, making cushion 100x too large)");
  ok(/reads as a fraction/.test(fractionOfFive.basis), "and says which reading it took");
  const lowVolPercent = ivConvention(["3.1", "2.8", "4.4", "2.9", "3.3"], { pairs: own.map((v) => [v * 10, v / 10]) });
  eq(lowVolPercent.divisor, 100,
     "A PERCENT CHAIN OF A LOW-VOL FUND (median 3.1) IS STILL DETECTED when the quotes' own vols are a hundredth of it (the old rule read it as 310%)");
  ok(/reads as percent/.test(lowVolPercent.basis), "and says so");
  eq(ivConvention(["31", "28"], { pairs: [[31, 0.31], [28, 0.28]] }).divisor, 100,
     "fewer than five paired quotes is not evidence, so the band rule decides");
  eq(ivConvention(["0.31", "0.28"], { pairs: [] }).divisor, 1, "and an empty evidence list changes nothing");
}

{
  const base = {
    option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
    implied_volatility: "0.28", open_interest: "1200", prev_oi: "1000", volume: "340",
  };
  const p = priceSale(base, { spot: 180, asOf: "2026-08-25" });

  eq(p.premium, 250, "premium is the BID times 100 — the mid is a number nobody must trade at");
  eq(p.collateral, 17000, "a cash-secured put's collateral is the strike, not spot");
  near(p.yieldOnCollateral, 250 / 17000, 1e-12, "yield is on the collateral actually tied up");
  near(p.annualized, (250 / 17000) * (DAYS_PER_YEAR / 24), 1e-12, "annualization is simple 365/days");
  eq(p.annualizedGross, p.annualized, "an out-of-the-money line's premium is all time value, so the two annualizations are one number");
  eq(p.intrinsic, 0, "and it carries no intrinsic value");
  eq(p.extrinsic, 2.5, "so its extrinsic value is the whole bid");
  ok(p.annualizedIsConvention === true, "annualized carries its own warning label");
  eq(p.breakeven, 167.5, "assigned, the basis is strike minus the premium kept");
  eq(p.days, 24);
  eq(p.oiChange, 200, "open interest change comes from prev_oi, not inferred");

  ok(p.ivMid > 0.1 && p.ivMid < 0.6, `the volatility the cushion is measured in is inverted from the mid (${p.ivMid})`);
  near(p.iv, 0.28, 1e-12, "while the feed's own figure ships beside it, unchanged");
  const sigma = p.ivMid * Math.sqrt(24 / 365);
  near(p.cushionSigmas, Math.log(180 / 167.5) / sigma, 1e-9,
       "cushion is the move to breakeven in the QUOTE's implied sigmas, the same volatility that delta and the chance of profit use");
  const rival = priceSale({ ...base, implied_volatility: "0.90" }, { spot: 180, asOf: "2026-08-25" });
  eq(rival.cushionSigmas, p.cushionSigmas,
     "and the feed's last-trade volatility does not enter it: a stale 90% print beside a 28% market moves nothing");

  ok(priceSale({ ...base, nbbo_bid: "0" }, { spot: 180, asOf: "2026-08-25" }) === null,
     "a zero bid is unsellable, not free money");
  ok(priceSale({ ...base, nbbo_bid: null }, { spot: 180, asOf: "2026-08-25" }) === null,
     "an absent bid is unpriceable");
  ok(priceSale({ ...base, nbbo_ask: "2.40" }, { spot: 180, asOf: "2026-08-25" }) === null,
     "a crossed book is stale data, not an arbitrage");
  ok(priceSale(base, { spot: 0, asOf: "2026-08-25" }) === null, "no spot, no pricing");

  const zero = priceSale({ ...base, option_symbol: "AAPL260825P00170000" },
                         { spot: 180, asOf: "2026-08-25" });
  ok(zero.annualized === null, "a contract expiring today annualizes to null, never Infinity");
  eq(zero.premium, 250, "and still reports the premium it actually pays");
}

{
  const cc = priceSale({
    option_symbol: "AAPL260918C00190000", nbbo_bid: "3.20", nbbo_ask: "3.35",
    implied_volatility: "0.26", open_interest: "950", volume: "400",
  }, { spot: 180, asOf: "2026-08-25" });

  eq(cc.strategy, "cc");
  eq(cc.collateral, 18000, "a covered call's collateral is the shares at SPOT, not the strike");
  eq(cc.breakeven, 176.8, "the premium is the entire downside cushion on shares you already own");
  near(cc.assignedReturn, (190 - 180 + 3.2) / 180, 1e-12, "called away, the return is capped here");

  const sigma = cc.ivMid * Math.sqrt(24 / 365);
  near(cc.capSigmas, Math.log(190 / 180) / sigma, 1e-9,
       "capSigmas is how far the market must run before the sale costs more than it paid");
  ok(priceSale({
    option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
    implied_volatility: "0.28", open_interest: "9",
  }, { spot: 180, asOf: "2026-08-25" }).capSigmas === null,
     "a put has no upside cap, so capSigmas is null rather than a manufactured zero");
}

{
  const spot = 180, asOf = "2026-08-25";

  const junk = { option_symbol: "AAPL260827P00120000", nbbo_bid: "0.01", nbbo_ask: "0.30",
                 implied_volatility: "0.90", open_interest: "11", volume: "2" };

  const wide = { option_symbol: "AAPL260918P00160000", nbbo_bid: "8.00", nbbo_ask: "12.00",
                 implied_volatility: "0.35", open_interest: "4000", volume: "900" };

  const thin = { option_symbol: "AAPL260918P00165000", nbbo_bid: "1.80", nbbo_ask: "1.85",
                 implied_volatility: "0.30", open_interest: "12", volume: "5" };
  const good = { option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
                 implied_volatility: "0.28", open_interest: "1200", prev_oi: "1000", volume: "340" };

  const r = rankChain([junk, wide, thin, good], { spot, asOf });
  eq(r.priced, 1, "three of four contracts are unsellable in practice");
  eq(r.rows[0].symbol, good.option_symbol, "the one real line wins");
  eq(r.screened, 4, "the chain's true size is reported alongside what survived");

  ok(r.gated.premium >= 1, "the lottery ticket is excluded and counted");
  ok(r.gated.spread >= 1, "the wide quote is excluded and counted");
  ok(r.gated.openInterest >= 1, "the thin line is excluded and counted");

  const excluded = Object.values(r.gated).reduce((a, b) => a + b, 0);
  eq(excluded + r.priced, r.screened, "every screened contract is either ranked or attributed");

  ok(r.gates.maxSpread === DEFAULT_GATES.maxSpread,
     "the gates that produced this answer ship with it, so they can be argued with");
}

{
  const spot = 100, asOf = "2026-08-25";
  const rows = [
    { option_symbol: "XYZ260918P00090000", nbbo_bid: "1.00", nbbo_ask: "1.05",
      implied_volatility: "0.40", open_interest: "500" },
    { option_symbol: "XYZ261218P00080000", nbbo_bid: "3.00", nbbo_ask: "3.10",
      implied_volatility: "0.40", open_interest: "500" },
  ];
  const byPremium = rankChain(rows, { spot, asOf, rankBy: "premium" });
  eq(byPremium.rows[0].premium, 300, "by dollars, the bigger, longer-dated position wins");

  const byAnnual = rankChain(rows, { spot, asOf, rankBy: "annualized" });
  eq(byAnnual.rows[0].days, 24, "by annualized yield, the near-dated one wins — a different answer");
  eq(byAnnual.rankedBy, "annualized", "the ranking key ships with the ranking");

  eq(rankChain(rows, { spot, asOf, rankBy: "nonsense" }).rankedBy, "annualized",
     "an unknown ranking key falls back to the documented default, not to insertion order");

  const noIv = { option_symbol: "XYZ260918P00095000", nbbo_bid: "2.00", nbbo_ask: "2.05",
                 open_interest: "500" };
  const measured = rankChain([...rows, noIv], { spot, asOf, rankBy: "cushionSigmas" });
  ok(measured.rows.every((r) => r.cushionSigmas !== null),
     "a line the feed quoted no volatility for still has a cushion: it is measured in the volatility of its own mid");

  const belowFloor = { option_symbol: "XYZ260918P00105000", nbbo_bid: "4.40", nbbo_ask: "4.99",
                       implied_volatility: "0.40", open_interest: "500" };
  const withNull = rankChain([...rows, belowFloor], { spot, asOf, rankBy: "cushionSigmas" });
  const floored = withNull.rows.find((r) => r.strike === 105);
  ok(floored && floored.ivMid === null && floored.cushionSigmas === null,
     "a quote whose mid sits under the exercise floor has no volatility to invert, so its cushion is null");
  ok(withNull.rows[withNull.rows.length - 1].cushionSigmas === null,
     "an unmeasurable cushion sorts LAST, never first");
  ok(withNull.rows[0].cushionSigmas !== null, "and a measured one leads");
}

{
  const rows = [
    { option_symbol: "XYZ260918P00090000", nbbo_bid: "1.00", nbbo_ask: "1.05",
      implied_volatility: "0.40", open_interest: "500" },
    { option_symbol: "XYZ260918C00110000", nbbo_bid: "1.20", nbbo_ask: "1.25",
      implied_volatility: "0.40", open_interest: "500" },
  ];
  const puts = rankChain(rows, { spot: 100, asOf: "2026-08-25", strategy: "csp" });
  eq(puts.priced, 1, "a cash-secured-put screen shows puts");
  eq(puts.rows[0].type, "P");
  eq(puts.gated.strategy, 1, "and reports the calls it set aside");
  eq(rankChain(rows, { spot: 100, asOf: "2026-08-25", strategy: "cc" }).rows[0].type, "C");
  eq(rankChain(rows, { spot: 100, asOf: "2026-08-25" }).priced, 2, "both, by default");
}

{

  const c = crossesEarnings;

  eq(c("2026-09-18", "2026-08-20", "afterhours"), true,
     "a report before expiry crosses, and the announce time is irrelevant");
  eq(c("2026-09-18", "2026-10-30", "premarket"), false,
     "a report after expiry does not, and the announce time is irrelevant there too");

  eq(c("2026-09-18", "2026-09-18", "premarket"), true,
     "same day before the open: the report lands while the contract is alive");
  eq(c("2026-09-18", "2026-09-18", "postmarket"), false,
     "same day after the close: it lands after settlement");
  eq(c("2026-09-18", "2026-09-18", "afterhours"), false,
     "and the OTHER spelling of after-the-close means the same thing");

  eq(c("2026-09-18", "2026-09-18", "unknown"), null,
     "same day with the timing unknown is NULL, not false");
  eq(c("2026-09-18", "2026-09-18", "at_some_point"), null,
     "an unrecognised token is null — the feed's vocabulary is not pinned");
  eq(c("2026-09-18", "2026-09-18", ""), null, "and an empty token is null");
  eq(c("2026-09-18", "2026-09-18", null), null, "and a missing one");

  eq(c("2026-09-18", undefined, "premarket"), null, "an absent date is null, not false");
  eq(c("2026-09-18", "", "premarket"), null, "an empty date is null, not a crossing");
  eq(c("2026-09-18", null, "premarket"), null, "and an explicit null");

  eq(c("2026-09-18", "2023-13-45", "premarket"), null, "month 13 is not a date");
  eq(c("2026-09-18", "2023-10-32", "premarket"), null, "day 32 is not a date");
  eq(c("2026-09-18", "2023-02-30", "premarket"), null, "and neither is 30 February");
  eq(c("2026-09-18", "2024-02-29", "premarket"), true, "but a real leap day is");
  eq(c("2026-09-18", "2023-10-26T13:30:00Z", "premarket"), null,
     "a datetime is not the bare date this comparison requires");
  eq(c("bad-expiry", "2026-08-20", "premarket"), null, "an unusable expiry is null too");
}

{

  const standard = { option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
                     implied_volatility: "0.28", open_interest: "1200", volume: "9" };
  const adjusted = { ...standard, option_symbol: "AAPL1260918P00170000" };

  const r = rankChain([standard, adjusted], { spot: 180, asOf: "2026-08-25", ticker: "AAPL" });
  eq(r.priced, 1, "the adjusted series is excluded");
  eq(r.gated.nonStandard, 1, "and counted under its own reason, not hidden in unpriceable");
  eq(r.rows[0].symbol, "AAPL260918P00170000", "only the standard contract is ranked");

  const excluded = Object.values(r.gated).reduce((a, b) => a + b, 0);
  eq(excluded + r.priced, r.screened, "the gate partition still accounts for everything");

  eq(rankChain([standard], { spot: 180, asOf: "2026-08-25", ticker: " aapl " }).priced, 1,
     "the comparison normalises case and padding rather than dropping a good row");

  const unchecked = rankChain([standard, adjusted], { spot: 180, asOf: "2026-08-25" });
  eq(unchecked.priced, 2, "with nothing to compare against, no contract is excluded");
  eq(unchecked.gated.nonStandard, 0, "and none is claimed to be");
}

{

  const amgn = { ticker: "AMGN", collateral: 43000, premium: 1290, extrinsic: 12.9, yieldOnCollateral: 0.03 };
  const wmb  = { ticker: "WMB",  collateral: 7000,  premium: 210,  extrinsic: 2.1, yieldOnCollateral: 0.03 };

  const a = sizeToBuyingPower(amgn, 50000);
  const w = sizeToBuyingPower(wmb, 50000);
  eq(a.contracts, 1, "a $43,000 requirement fits once into $50,000");
  eq(w.contracts, 7, "a $7,000 requirement fits seven times");
  eq(a.collectible, 1290);
  eq(w.collectible, 1470, "the SAME yield collects more when the line is smaller");
  ok(w.collectible > a.collectible,
     "so ranking by collectible reverses the ranking by yield — which is the feature");

  eq(a.idle, 7000, "and the capital integer division leaves behind is reported");
  eq(w.idle, 1000);
  eq(a.deployed, 43000, "deployed is what the contracts actually tie up");
  near(w.yieldOnDeployed, 1470 / 49000, 1e-12,
       "yield on DEPLOYED capital, which differs from the line's yield whenever there is a remainder");

  const half = sizeToBuyingPower({ collateral: 4000, premium: 100, extrinsic: 1 }, 50000);
  eq(half.contracts, 12, "12.5 contracts floors to 12 — rounding would overspend the account");
  eq(half.deployed, 48000, "and deploys only what those contracts require");
  ok(half.deployed <= 50000, "deployed capital NEVER exceeds the buying power entered");
  eq(half.idle, 2000, "the remainder is idle, not quietly spent");

  const small = sizeToBuyingPower(amgn, 5000);
  eq(small.contracts, 0, "a line larger than the account sizes to zero");
  eq(small.affordable, false, "and says so explicitly");
  eq(small.collectible, 0, "collecting nothing is the honest number here");
  eq(small.idle, 5000, "with the whole account left idle");

  ok(sizeToBuyingPower(amgn, 0) === null, "no buying power is unanswerable, not zero contracts");
  ok(sizeToBuyingPower(amgn, null) === null, "and so is an absent one");
  ok(sizeToBuyingPower(amgn, -100) === null, "and a negative one");
  ok(sizeToBuyingPower({ collateral: 0, premium: 100 }, 50000) === null,
     "a line with no collateral cannot be sized");
  ok(sizeToBuyingPower(null, 50000) === null, "and neither can a missing line");
}

{
  const rows = [
    { ticker: "AMGN", collateral: 43000, premium: 1290, extrinsic: 12.9 },
    { ticker: "WMB",  collateral: 7000,  premium: 210, extrinsic: 2.1 },
    { ticker: "HUGE", collateral: 900000, premium: 40000, extrinsic: 400 },
  ];
  const plan = planBuyingPower(rows, 50000);
  eq(plan.buyingPower, 50000);
  eq(plan.affordable, 2, "the line bigger than the account is counted as unaffordable");
  eq(plan.best.ticker, "WMB", "the best line for THIS account is the one that collects most");
  eq(plan.rows.length, 3, "and every row survives, sized — none is silently dropped");
  ok(plan.rows.every((r) => r.sizing !== null), "each carries its own sizing");

  const huge = plan.rows.find((r) => r.ticker === "HUGE");
  eq(huge.sizing.contracts, 0);
  ok(huge.premium > plan.best.premium,
     "the biggest per-contract premium on the chain loses to one the account can actually buy");

  const none = planBuyingPower(rows, null);
  eq(none.buyingPower, null);
  eq(none.rows.length, 3, "every row still present");
  ok(none.rows.every((r) => r.sizing === null), "and none pretends to be sized");
  eq(none.best, null, "with no best line claimed");
  eq(planBuyingPower(null, 50000).rows.length, 0, "a null chain is empty, not a throw");
}

{
  const spot = 100, asOf = "2026-08-24";
  const C = (sym, bid, ask, iv, oi, volume) => ({
    option_symbol: sym, nbbo_bid: String(bid), nbbo_ask: String(ask),
    implied_volatility: String(iv), open_interest: String(oi), volume: String(volume),
  });

  const front = [
    C("CCC260918P00085000", 0.80, 0.85, 0.46, 150, 150),
    C("CCC260918P00090000", 1.40, 1.48, 0.38, 220, 220),
    C("CCC260918P00095000", 2.30, 2.40, 0.32, 400, 400),

    C("CCC260918C00100000", 2.10, 2.20, 0.30, 900, 0),

    C("CCC260918C00102000", 1.60, 1.68, 0.305, 700, 300),
    C("CCC260918C00105000", 1.05, 1.10, 0.31, 500, 500),
    C("CCC260918C00110000", 0.55, 0.60, 0.35, 300, 300),
    C("CCC260918C00115000", 0.30, 0.34, 0.41, 120, 120),
  ];

  const middle = [
    C("CCC261016P00078000", 0.65, 0.72, 0.44, 300, 300),
    C("CCC261016P00095000", 2.90, 3.05, 0.33, 260, 0),
    C("CCC261016C00100000", 3.10, 3.25, 0.28, 340, 0),
    C("CCC261016C00110000", 1.05, 1.15, 0.31, 180, 0),
  ];

  const back = [
    C("CCC261218P00080000", 1.50, 1.62, 0.40, 90, 90),
    C("CCC261218P00090000", 3.20, 3.35, 0.34, 140, 140),
    C("CCC261218C00100000", 5.10, 5.30, 0.24, 260, 260),
    C("CCC261218C00110000", 2.05, 2.18, 0.23, 110, 110),
    C("CCC261218C00120000", 1.10, 1.20, 0.32, 70, 70),
  ];
  const chain = [...front, ...middle, ...back];

  const ranked = rankChain(chain, { spot, asOf, ticker: "CCC" });
  const s = ranked.ivSurface;
  eq(s.status, "ok", "the chain the desk already fetched carries a surface, at no extra call");
  eq(s.expiriesShown, 3, "one column per expiry");

  const column = (surface, j) => surface.grid.map((r) => r[j]).filter(Boolean).reverse();

  {

    const thin = C("CCC260918P00080000", 0.45, 0.50, 0.55, 11, 40);
    const withThin = rankChain([...chain, thin], { spot, asOf, ticker: "CCC" });
    ok(!withThin.rows.some((r) => r.strike === 80 && r.expiry === "2026-09-18"),
       "the thin contract is gated out of the sellable table");
    eq(withThin.gated.openInterest, ranked.gated.openInterest + 1,
       "and counted under the gate that dropped it");
    ok(withThin.ivSurface.grid.flat().some((c) => c && c.strike === 80 && c.expiry === "2026-09-18"),
       "and it is STILL on the surface — the gate says it is not worth selling, not that its quoted vol is fiction");

    const callsOnly = rankChain(chain, { spot, asOf, ticker: "CCC", strategy: "cc" });
    ok(callsOnly.rows.every((r) => r.type === "C"), "a covered-call screen ranks only calls");
    ok(callsOnly.ivSurface.grid.flat().some((c) => c && c.type === "P"),
       "and its surface still carries the put wing — half a smile is a different smile");
    eq(callsOnly.ivSurface.placed, s.placed,
       "the Sell toggle changes the table and leaves the surface alone");

    const adjusted = { ...front[1], option_symbol: "CCC1260918P00090000" };
    const withAdjusted = rankChain([...chain, adjusted], { spot, asOf, ticker: "CCC" });
    eq(withAdjusted.gated.nonStandard, 1, "the adjusted series is excluded from the ranking");
    eq(withAdjusted.ivSurface.placed, s.placed,
       "and from the surface — its strike is struck against an unknown deliverable, so strike over spot is not a moneyness");
  }

  {
    const ivs = column(s, 0).map((c) => c.iv);
    const low = Math.min(...ivs);
    const at = ivs.indexOf(low);
    ok(at > 0 && at < ivs.length - 1,
       `the front expiry's volatility bottoms strictly INSIDE its strike range (${ivs.map((v) => (v * 100).toFixed(1)).join(" ")})`);
    ok(ivs[0] > low && ivs[ivs.length - 1] > low,
       "and rises into BOTH wings — a monotone skew cannot represent this chain");

    ok(new Set(ivs.map((v) => v.toFixed(4))).size >= 5,
       "each cell carries its own contract's quoted volatility, not its column's level");
  }

  {
    const levels = s.expiries.map((e) => e.atmIv);
    near(levels[0], 0.305, 1e-12, "the front's at-the-money level is the 102 call's 30.5");
    ok(levels[2] !== null && levels[0] > levels[2],
       `the front is bid over the back (${(levels[0] * 100).toFixed(1)} against ${(levels[2] * 100).toFixed(1)}) — two expiries at different levels`);
    near(levels[2], 0.24, 1e-12, "and the back's is the 100 call's 24.0");
  }

  {
    const e = s.expiries[0];
    eq(e.atmStrike, 102,
       "the level is the 102 call, which traded today — NOT the 100 that sits exactly at the money and has not");
    near(e.atmIv, 0.305, 1e-12,
       "so the front level is 30.5, the number a build that ignored freshness would miss by half a vol point");
    ok(Math.abs(e.atmM) > 0 && Math.abs(e.atmM) <= s.atmBand,
       "and the contract it came from is inside the band an at-the-money quote may sit in");
  }

  {
    const e = s.expiries[1];
    eq(e.atmIv, null,
       "an expiry whose only print today is 24.8% out gets no at-the-money level at all");
    ok(/nearest contract that traded today is 24\.8%/.test(e.atmReason || ""),
       `and says exactly how far out it was (${e.atmReason})`);
    ok(/outside the 10% band/.test(e.atmReason || ""),
       "and names the band, because the band is a choice rather than a measurement");
    const cells = column(s, 1);
    ok(cells.length >= 3, "its contracts are still on the surface");
    ok(cells.every((c) => c.skew === null),
       "and every one of them carries a NULL skew rather than a zero — an unknown position on the smile is not the middle of it");
    ok(cells.every((c) => c.iv > 0),
       "while still carrying the volatility that was actually quoted, which is an observable either way");
  }

  {

    let row = -1;
    for (let i = 0; i < s.grid.length; i++) {
      const c = s.grid[i][0];
      if (c && c.strike === 90) { row = i; break; }
    }
    ok(row >= 0, "the front expiry's 90 put is on the grid");
    const f = s.grid[row][0], b = s.grid[row][2];
    ok(f && b, "and the back expiry's 90 put shares its row — the same moneyness at two tenors, which is the comparison the axis exists for");
    ok(f.iv > b.iv,
       `10% below the money the FRONT quotes the higher volatility (${(f.iv * 100).toFixed(1)} against ${(b.iv * 100).toFixed(1)})`);
    ok(f.skew < b.skew,
       `and the BACK carries the steeper skew (${(f.skew * 100).toFixed(1)} against ${(b.skew * 100).toFixed(1)}) — a surface shaded on the raw level reads this row backwards`);
    near(f.skew, 0.38 - 0.305, 1e-12, "the front's skew is measured against the FRONT's own level");
    near(b.skew, 0.34 - 0.24, 1e-12, "and the back's against the BACK's, never against one chain-wide number");
  }

  {
    const crowded = s.grid.flat().filter((c) => c && c.crowd > 1);
    eq(crowded.length, 1, "the 100 and the 102 call fall in one row of one column");
    eq(s.crowded, 1, "and the surface counts the contract that lost the cell");
    near(crowded[0].iv, 0.305, 1e-12,
       "the cell shows the 102's 30.5 — the print from today, NOT the 30.25 mean of the two");
    eq(crowded[0].strike, 102, "and names which contract it is showing");
  }

  {
    eq(s.stale, 3, "three cells on this chain have not traded today");
    eq(s.fresh, s.placed - s.stale - s.unknownAge, "and the ages partition the cells drawn");
    ok(s.grid.flat().filter(Boolean).every((c) => c.traded === true || c.traded === false || c.traded === null),
       "every cell states which of the three it is rather than leaving it to be inferred");
    for (const e of s.expiries) {
      if (e.atmIv === null) continue;
      ok(e.fresh > 0,
         `${e.expiry}'s level came from a column that has a print today`);
    }
  }

  {
    const negatives = s.grid.flat().filter((c) => c && c.skew !== null && c.skew < 0);
    eq(negatives.length, 1, "exactly one cell on this chain quotes BELOW its expiry's at-the-money vol");
    near(negatives[0].skew, 0.23 - 0.24, 1e-12, "the back 110 call, a vol point under the money");
  }

  {
    const asPercent = chain.map((c) => ({
      ...c, implied_volatility: String(Number(c.implied_volatility) * 100),
    }));
    const p = rankChain(asPercent, { spot, asOf, ticker: "CCC" });
    ok(/reads as percent/.test(p.ivBasis), `the percent chain is recognised as one (${p.ivBasis})`);
    ok(/reads as a fraction/.test(ranked.ivBasis), `and the fraction chain as one (${ranked.ivBasis})`);

    eq(p.ivSurface.status, "ok", "the percent chain still builds a surface");
    eq(p.ivSurface.placed, s.placed, "with the same cells");
    let worst = 0, worstAt = "";
    for (let i = 0; i < s.grid.length; i++) {
      for (let j = 0; j < s.grid[i].length; j++) {
        const a = s.grid[i][j], b = p.ivSurface.grid[i][j];
        ok((a === null) === (b === null), "the two conventions place the same cells");
        if (!a) continue;
        const d = Math.abs(a.iv - b.iv);
        if (d > worst) { worst = d; worstAt = `${a.strike} ${a.expiry}`; }
      }
    }
    ok(worst <= 1e-12,
       `a chain quoted in percent draws the IDENTICAL surface to one quoted in fractions (worst cell ${worstAt} off by ${worst})`);
    for (let j = 0; j < s.expiries.length; j++) {
      const a = s.expiries[j].atmIv, b = p.ivSurface.expiries[j].atmIv;
      ok(a === null ? b === null : Math.abs(a - b) <= 1e-12,
         `and the same at-the-money level on ${s.expiries[j].expiry}`);
    }
    ok(/percent/.test(p.ivSurface.ivBasis || ""),
       "and the surface carries the evidence for the units it is in, so the answer is auditable");
  }

  {

    const priced = [
      { expiry: "2026-09-18", days: 25, strike: 95, type: "P", moneyness: -0.05, iv: 32, ivTraded: true, volume: 10, oi: 100 },
      { expiry: "2026-09-18", days: 25, strike: 100, type: "C", moneyness: 0, iv: 30, ivTraded: true, volume: 10, oi: 100 },
      { expiry: "2026-09-18", days: 25, strike: 105, type: "C", moneyness: 0.05, iv: 31, ivTraded: true, volume: 10, oi: 100 },
    ];
    const refused = ivSurface(priced);
    eq(refused.status, "empty",
       "implied volatility that reaches the surface on a percent scale is REFUSED, not drawn");
    ok(/100x/.test(refused.reason || ""),
       `and the reason names the size of the error it stopped (${refused.reason})`);
    eq(refused.placed, 0, "with nothing drawn");

    const fine = ivSurface(priced.map((r) => ({ ...r, iv: r.iv / 100 })));
    eq(fine.status, "ok", "the same chain as fractions draws");

    const raw = ivSurface(chain);
    eq(raw.status, "empty",
       "raw feed rows build no surface at all — the module reads the divided field and no raw one");
    eq(raw.placed, 0, "so there is no way to draw an undivided surface by accident");
  }

  {

    const noVol = { option_symbol: "CCC260918P00082000", nbbo_bid: "0.55", nbbo_ask: "0.60",
                    open_interest: "300", volume: "50" };
    const r = rankChain([...chain, noVol], { spot, asOf, ticker: "CCC" });
    ok(!r.ivSurface.grid.flat().some((c) => c && c.strike === 82),
       "a contract the feed quoted no implied volatility for is ABSENT from the surface");
    eq(r.ivSurface.placed, s.placed,
       "rather than drawn as a zero-volatility cell, which would be the palest cell on the chart and a lie");
  }

  {
    const noVolume = { option_symbol: "CCC260918C00122000", nbbo_bid: "0.20", nbbo_ask: "0.24",
                       implied_volatility: "0.48", open_interest: "300" };
    const r = rankChain([...chain, noVolume], { spot, asOf, ticker: "CCC" });
    const cell = r.ivSurface.grid.flat().find((c) => c && c.strike === 122);
    ok(cell, "a contract with no volume field is still placed");
    eq(cell.traded, null,
       "and its age is NULL — 'no volume field' and 'zero volume today' are different facts");
    eq(r.ivSurface.unknownAge, 1, "counted apart from the ones known not to have traded");
  }
}

{

  const at = (m, iv, expiry, traded) => ({
    expiry, days: 30, strike: 100 * Math.exp(m), type: m < 0 ? "P" : "C",
    moneyness: Math.expm1(m), iv, ivTraded: traded === undefined ? true : traded,
    volume: 10, oi: 100,
  });

  const mirror = ivSurface([
    at(-0.25, 0.40, "2026-09-18"), at(0.25, 0.40, "2026-09-18"),
    at(-0.125, 0.34, "2026-09-18"), at(0.125, 0.34, "2026-09-18"),
    at(0, 0.30, "2026-09-18"),
  ]);
  eq(mirror.status, "ok", "the mirrored chain builds");
  eq(mirror.step, 0.05, "and lands on the 5% band of the stated ladder");
  ok(SURFACE_ROW_STEPS.includes(mirror.step), "which is a width from the published ladder, not a derived one");

  const rowOfStrike = (surface, strike) => {
    for (let i = 0; i < surface.grid.length; i++) {
      for (const c of surface.grid[i]) {
        if (c && Math.abs(c.strike - strike) < 1e-9) return surface.rows[i].k;
      }
    }
    return null;
  };
  const up = rowOfStrike(mirror, 100 * Math.exp(0.125));
  const down = rowOfStrike(mirror, 100 * Math.exp(-0.125));
  eq(up, 3, "a strike exactly two and a half bands above the money rounds out to the third");
  eq(down, -3,
     "and one exactly two and a half bands BELOW rounds out to the third as well — a bare Math.round biases one wing of every smile");

  const centre = rowOfStrike(mirror, 100);
  eq(centre, 0, "and the money itself is a row rather than a boundary between two");
}

{
  const many = [];
  for (let w = 1; w <= 14; w++) {
    const month = String(((w - 1) % 12) + 1).padStart(2, "0");
    const day = String(((w * 2) % 27) + 1).padStart(2, "0");
    many.push({
      expiry: `2027-${month}-${day}`, days: w * 14, strike: 100, type: "C",
      moneyness: 0, iv: 0.2 + w * 0.005, ivTraded: true, volume: 5, oi: 100,
    });
  }
  const s = ivSurface(many);
  eq(s.expiriesShown, SURFACE_MAX_EXPIRIES, "a chain with more expiries than fit is windowed");
  eq(s.expiriesTotal, 14, "and says how many there were");
  eq(s.expiries[0].days, 14, "the NEAREST expiry is kept");
  eq(s.expiries[s.expiries.length - 1].days, 196,
     "and so is the FURTHEST — a term structure missing its back end is a different and much weaker statement");
  for (let i = 1; i < s.expiries.length; i++) {
    ok(s.expiries[i].days > s.expiries[i - 1].days, "columns run nearest-first");
  }
}

{
  const dead = [
    { expiry: "2026-09-18", days: 25, strike: 95, type: "P", moneyness: -0.05, iv: 0.32, ivTraded: false, volume: 0, oi: 400 },
    { expiry: "2026-09-18", days: 25, strike: 100, type: "C", moneyness: 0, iv: 0.30, ivTraded: false, volume: 0, oi: 900 },
  ];
  const s = ivSurface(dead);
  eq(s.status, "ok", "a fully stale expiry still draws its quoted volatilities");
  eq(s.expiries[0].atmIv, null, "but it gets no level");
  ok(/nothing on this expiry traded today/.test(s.expiries[0].atmReason || ""),
     `and says so in those words rather than as a distance (${s.expiries[0].atmReason})`);
  eq(s.stale, 2, "with both cells marked as prints of unknown age");
  ok(s.grid.flat().filter(Boolean).every((c) => c.skew === null),
     "and no cell claims a position on a smile the surface has no reference for");
}

{
  eq(numOrNull(""), null); eq(numOrNull(null), null); eq(numOrNull("abc"), null);
  eq(numOrNull("2.5"), 2.5); eq(numOrNull(0), 0, "zero is a number, not an absence");
  eq(SHARES_PER_CONTRACT, 100);
  eq(daysToExpiry("2026-09-18", "2026-08-25"), 24);
  eq(daysToExpiry("bad", "2026-08-25"), null, "an unparseable date is null, not NaN days");
  eq(rankChain(null, { spot: 100, asOf: "2026-08-25" }).priced, 0, "a null chain is empty, not a throw");
}

{
  const golden = JSON.parse(readFileSync(new URL("./fixtures-desk-golden.json", import.meta.url), "utf8"));
  eq(golden.length, 15, "the independent fixture holds fifteen lines, the screenshot's nine among them");
  const asOf = "2026-09-29";
  const expiry = (days) => new Date(Date.parse(asOf + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
  const symbol = (g) => `NVDA${expiry(g.days).slice(2).replace(/-/g, "")}${g.kind}${String(Math.round(g.strike * 1000)).padStart(8, "0")}`;
  let itm = 0;
  for (const g of golden) {
    const p = priceSale({
      option_symbol: symbol(g), nbbo_bid: String(g.bid), nbbo_ask: String(g.ask),
      implied_volatility: String(g.iv), open_interest: "1000",
    }, { spot: g.spot, asOf, midIv: false });
    const label = `${g.kind} ${g.strike} ${g.days}d`;
    near(p.premium, g.premium, 1e-9, `${label}: premium is 100 x the bid, as scipy's reference has it`);
    near(p.collateral, g.collateral, 1e-9, `${label}: collateral`);
    near(p.breakeven, g.breakeven, 1e-9, `${label}: breakeven`);
    near(p.moneyness, g.moneyness, 1e-12, `${label}: moneyness`);
    near(p.spread, g.spread, 1e-12, `${label}: spread`);
    near(p.intrinsic, g.intrinsic, 1e-9, `${label}: intrinsic value`);
    near(p.yieldGross, g.yieldOnCollateral, 1e-12, `${label}: premium over collateral`);
    near(p.annualizedGross, g.annualized, 1e-9, `${label}: the gross annualization is the reference's`);
    near(p.extrinsic, Math.max(0, g.extrinsic), 1e-9, `${label}: extrinsic value is the bid less intrinsic, never below zero`);
    near(p.yieldOnCollateral, Math.max(0, g.extrinsicYield), 1e-12, `${label}: the yield is on TIME value`);
    near(p.annualized, Math.max(0, g.extrinsicAnnualized), 1e-9, `${label}: and so is the annualization`);
    if (g.assignedReturn === null) ok(p.assignedReturn === null, `${label}: a put has no called-away return`);
    else near(p.assignedReturn, g.assignedReturn, 1e-12, `${label}: called-away return`);
    ok(p.annualized <= p.annualizedGross + 1e-12, `${label}: annualized never exceeds the gross figure`);
    if (g.intrinsic === 0) near(p.annualized, p.annualizedGross, 1e-12, `${label}: and equals it exactly when the line is out of the money`);
    else { itm++; ok(p.annualized < p.annualizedGross, `${label}: and is strictly below it when the line is in the money`); }
    eq(impossibleQuote(g.kind, g.spot, g.strike, g.ask), g.ask < g.intrinsic - 0.01 - 1e-9,
       `${label}: the impossible-quote test is the reference's own arithmetic on the ask`);
  }
  ok(itm >= 8, `${itm} of the fifteen lines are in the money, so the in-the-money branch is exercised`);

  const sep30 = golden[0], oct5 = golden[6];
  ok(impossibleQuote(sep30.kind, sep30.spot, sep30.strike, sep30.ask), "the 227.5 call for 1.47/1.49 against a 231.02 spot is impossible: its ask is 2.03 under the exercise value");
  ok(impossibleQuote(oct5.kind, oct5.spot, oct5.strike, oct5.ask), "and so is the 6-day 227.5 call at 3.25/3.27, although its bid is only 0.27 short");
  ok(!impossibleQuote("C", 231.02, 227.5, 3.87), "while the 8-day line at 3.85/3.87 is a market: its ask clears the exercise value");
}

{
  const iv = JSON.parse(readFileSync(new URL("./fixtures-desk-golden-iv.json", import.meta.url), "utf8"));
  eq(iv.rate, PRICING_RATE, "the fixture's rate is the rate the desk prices with");
  eq(PRICING_RATE, ENGINE_LINES.RATE_FALLBACK, "which is the engine's own fallback, so the server and the page invert the mid at one rate");
  const asOf = "2026-09-29";
  const expiry = (days) => new Date(Date.parse(asOf + "T00:00:00Z") + days * 864e5).toISOString().slice(0, 10);
  const rowOf = (g) => ({
    option_symbol: `NVDA${expiry(g.days).slice(2).replace(/-/g, "")}${g.kind}${String(Math.round(g.strike * 1000)).padStart(8, "0")}`,
    nbbo_bid: String(g.bid), nbbo_ask: String(g.ask), implied_volatility: "0.9", open_interest: "1000",
  });
  for (const g of iv.rows) {
    const p = priceSale(rowOf(g), { spot: g.spot, asOf });
    const label = `${g.kind} ${g.strike} ${g.days}d`;
    near(p.ivMid, g.ivMid, 2e-6, `${label}: the mid inverts to the volatility that priced it (scipy's brentq)`);
    near(p.cushionSigmas, g.cushionSigmas, 5e-5, `${label}: cushion in the quote's own sigmas, to scipy`);
    if (g.capSigmas === null) ok(p.capSigmas === null, `${label}: no cap on a put`);
    else near(p.capSigmas, g.capSigmas, 5e-5, `${label}: cap in the quote's own sigmas, to scipy`);
  }

  const ladder = iv.ladder.map((g) => ({ g, row: rowOf(g) }));
  const priced = ladder.map(({ g, row }) => priceSale(row, { spot: g.spot, asOf }));
  priced.forEach((p, i) => {
    const g = ladder[i].g;
    near(p.annualizedGross, g.annualizedGross, 1e-9, `${g.strike}C: the gross annualization`);
    near(p.annualized, g.annualized, 1e-9, `${g.strike}C: the annualization of its TIME value`);
    near(p.yieldOnCollateral, g.yieldOnCollateral, 1e-12, `${g.strike}C: the yield on its time value`);
    near(p.intrinsic, g.intrinsic, 1e-9, `${g.strike}C: intrinsic value`);
    near(p.extrinsic, g.extrinsic, 1e-9, `${g.strike}C: extrinsic value`);
  });
  ok(priced[0].annualizedGross > 6 && priced[0].annualized < 0.1,
     `the deepest in-the-money call shows ${(priced[0].annualizedGross * 100).toFixed(0)}% gross and ${(priced[0].annualized * 100).toFixed(0)}% on what it actually earns`);

  const chain = ladder.map(({ row }) => row);
  const byTime = rankChain(chain, { spot: 227.28, asOf, ticker: "NVDA", rankBy: "annualized" });
  assert.deepEqual(byTime.rows.map((r) => r.strike), [225, 230, 220, 215]); checks++;
  const shuffled = rankChain([...chain].reverse(), { spot: 227.28, asOf, ticker: "NVDA", rankBy: "annualized" });
  assert.deepEqual(shuffled.rows.map((r) => r.strike), [225, 230, 220, 215]); checks++;
  const gross = [...byTime.rows].sort((a, b) => b.annualizedGross - a.annualizedGross).map((r) => r.strike);
  assert.deepEqual(gross, [215, 220, 225, 230]); checks++;
  eq(byTime.rows[0].strike, 225,
     "RANKED ON TIME VALUE the 225 call leads; ranked on the old gross figure the 215 call, all intrinsic, led every table");
  ok(byTime.rows.every((r, i, a) => i === 0 || a[i - 1].annualized >= r.annualized), "and the order is monotone in the figure the column shows");
  eq(rankChain(chain, { spot: 227.28, asOf, ticker: "NVDA", rankBy: "yieldOnCollateral" }).rows[0].strike, 225,
     "yield on collateral ranks the same way");
  eq(rankChain(chain, { spot: 227.28, asOf, ticker: "NVDA", rankBy: "premium" }).rows[0].strike, 215,
     "while premium in dollars stays gross: a dollar is a dollar, and the contract with the largest bid pays it");
}

{
  const spot = 231.02, asOf = "2026-09-29";
  const C = (sym, bid, ask) => ({ option_symbol: sym, nbbo_bid: String(bid), nbbo_ask: String(ask), implied_volatility: "0.35", open_interest: "900", volume: "50" });
  const rows = [
    C("NVDA260930C00227500", 1.47, 1.49),
    C("NVDA260930C00230000", 0.56, 0.58),
    C("NVDA261002C00230000", 1.69, 1.71),
    C("NVDA260930P00225000", 0.68, 0.70),
    C("NVDA261007C00227500", 3.85, 3.87),
  ];
  const r = rankChain(rows, { spot, asOf, ticker: "NVDA" });
  eq(r.gated.offMarket, 2, "the two calls whose ASK is under the exercise value are counted under their own gate");
  ok(!r.rows.some((x) => x.symbol === "NVDA260930C00227500" || x.symbol === "NVDA260930C00230000"),
     "and never ranked, so an impossible quote cannot top a table");
  eq(r.priced, 3, "the other three are priced");
  const excluded = Object.values(r.gated).reduce((a, b) => a + b, 0);
  eq(excluded + r.priced, r.screened, "and the partition still accounts for every contract");
  ok(r.rows.every((x) => x.annualized <= x.annualizedGross), "the extrinsic figure never exceeds the gross one on any ranked line");
  const eightDay = r.rows.find((x) => x.symbol === "NVDA261007C00227500");
  ok(eightDay && eightDay.annualized < eightDay.annualizedGross / 3,
     "and the 8-day in-the-money call, a real market, is ranked on its 33 cents of time value rather than on its 3.85 bid");

  eq(impossibleQuote("C", 100, 96, 3.99), false, "an ask exactly 0.01 under the exercise value is inside the tolerance");
  eq(impossibleQuote("C", 100, 96, 3.98), true, "and 0.02 under it is not");
  eq(impossibleQuote("P", 100, 104, 4.01), false, "a put's exercise value is the strike less the spot");
  eq(impossibleQuote("P", 100, 104, 3.98), true, "and its floor binds the same way");
  eq(impossibleQuote("C", 231.02, 227.5, 3.51), false, "the tolerance is not defeated by floating-point noise in 231.02 - 227.5");
  eq(impossibleQuote("C", 100, 105, 0.01), false, "an out-of-the-money quote has no floor to violate");
  eq(impossibleQuote("C", 100, 96, 0), false, "an absent ask is not a violation, it is no quote");
  eq(intrinsic("C", 231.02, 227.5), 231.02 - 227.5, "intrinsic of a call is spot less strike");
  eq(intrinsic("P", 100, 104), 4, "of a put strike less spot");
  eq(intrinsic("C", 100, 104), 0, "and never negative");
  eq(OFF_MARKET_TOLERANCE, 0.01, "the tolerance is a cent");
}

{
  const cc = (sym, bid) => ({ option_symbol: sym, nbbo_bid: String(bid), nbbo_ask: String(bid + 0.02), implied_volatility: "0.30", open_interest: "500" });
  const equal = [
    cc("XYZ260918C00105000", 1.00), cc("XYZ261016C00105000", 1.00), cc("XYZ260918C00104000", 1.00), cc("XYZ260918C00106000", 1.00),
  ];
  const forward = rankChain(equal, { spot: 100, asOf: "2026-08-25", rankBy: "premium" }).rows.map((r) => r.symbol);
  const backward = rankChain([...equal].reverse(), { spot: 100, asOf: "2026-08-25", rankBy: "premium" }).rows.map((r) => r.symbol);
  assert.deepEqual(forward, backward); checks++;
  eq(forward.length, 4, "four equal-premium lines are ranked");
  const slots = rankChain(equal, { spot: 100, asOf: "2026-08-25", rankBy: "premium" }).rows;
  ok(slots[0].annualized >= slots[1].annualized && slots[1].annualized >= slots[2].annualized,
     "a tie on the ranking key falls to the annualized figure, then to expiry, then to strike, not to the feed's row order");
  assert.deepEqual(forward, ["XYZ260918C00104000", "XYZ260918C00105000", "XYZ260918C00106000", "XYZ261016C00105000"]); checks++;
}

{
  const cc = { option_symbol: "BRKB260918C00520000", nbbo_bid: "3.20", nbbo_ask: "3.30", implied_volatility: "0.2", open_interest: "900" };
  const put = { option_symbol: "BRKB260918P00480000", nbbo_bid: "2.20", nbbo_ask: "2.30", implied_volatility: "0.2", open_interest: "900" };
  for (const t of ["BRK.B", "BRK-B", "brk.b", "BRKB"]) {
    const r = rankChain([cc, put], { spot: 500, asOf: "2026-08-25", ticker: t });
    eq(r.priced, 2, `${t}: a dotted or dashed ticker matches its dotless option root`);
    eq(r.gated.nonStandard, 0, `${t}: and nothing is gated as an adjusted series`);
  }
  const adjusted = { ...cc, option_symbol: "BRKB1260918C00520000" };
  eq(rankChain([cc, adjusted], { spot: 500, asOf: "2026-08-25", ticker: "BRK.B" }).gated.nonStandard, 1,
     "an adjusted BRK.B series is still set aside");
  eq(optionRoot(" brk.b "), "BRKB", "the root drops punctuation and case");
  eq(optionRoot(null), "", "and a missing ticker has no root");
}

{
  const c = crossesEarnings;
  eq(c("2026-10-09", "2026-08-27", "afterhours", { asOf: "2026-09-29" }), null,
     "A REPORT THAT ALREADY PRINTED is null, not true: a stale next_earnings_date made every line read as crossing an event");
  eq(c("2026-10-09", "2026-08-27", "afterhours"), true, "without a read date the answer is the calendar's, as before");
  eq(c("2026-10-09", "2026-09-29", "afterhours", { asOf: "2026-09-29" }), true, "a report dated today has not been ruled out");
  eq(c("2026-10-09", "2026-10-02", "premarket", { asOf: "2026-09-29" }), true, "a report before expiry still crosses");
  eq(c("2026-10-09", "2026-10-20", "premarket", { asOf: "2026-09-29" }), false, "and one after it still does not");
  eq(c("2026-10-09", "2026-10-09", "premarket", { asOf: "2026-09-29" }), true, "same-day before the open crosses");
  eq(c("2026-10-09", "2026-10-09", "afterhours", { asOf: "2026-09-29" }), false, "and after the close does not");
  eq(c("2026-10-09", "2026-08-27", "afterhours", { asOf: "garbage" }), true, "an unusable read date is ignored rather than trusted");
  eq(hasNoEarnings("ETF"), true, "an ETF has no earnings");
  eq(hasNoEarnings("Index Fund"), true, "nor does a fund");
  eq(hasNoEarnings("Common Stock"), false, "a common stock does");
  eq(hasNoEarnings(null), false, "and an unstated issue type is unknown, not a fund");
}

{
  const one = sizeToBuyingPower({ collateral: 1.1 * 100, premium: 10, extrinsic: 0.1 }, 110);
  eq(one.contracts, 1, "110 of buying power buys the 1.1 x 100 collateral once: floating point made the collateral 110.00000000000001 and the answer zero");
  eq(one.deployed, 110, "deploying exactly 110");
  eq(one.idle, 0, "with nothing idle");
  eq(one.collectible, 10, "and collecting the premium once");
  eq(sizeToBuyingPower({ collateral: 1.09 * 100, premium: 5 }, 109).contracts, 1, "1.09 x 100 = 109.00000000000001 against 109 buys one");
  eq(sizeToBuyingPower({ collateral: 1.09 * 100, premium: 5 }, 108.99).contracts, 0, "and a cent short buys none");
  let wrong = 0, cases = 0;
  for (let cents = 100; cents < 50000; cents += 37) {
    for (const strike of [1.09, 2.3, 4.35, 19.99, 47, 231.02, 412.7]) {
      const collateral = strike * 100;
      const bp = (Math.round(collateral * 100) * 3 + (cents % 7)) / 100;
      const want = Math.floor(Math.round(bp * 100) / Math.round(collateral * 100));
      cases++;
      if (sizeToBuyingPower({ collateral, premium: 1 }, bp).contracts !== want) wrong++;
    }
  }
  eq(wrong, 0, `${cases} budgets against float collateral all size as integer cents do`);
  const noise = sizeToBuyingPower({ collateral: 23102, premium: 147.00000000000003, extrinsic: 1.47 }, 50000);
  eq(noise.collectible, 294, "a premium carrying float noise collects a whole number of cents");
  eq(noise.idle, 50000 - 2 * 23102, "and the idle cash is exact");
  near(noise.yieldOnDeployed, 294 / 46204, 1e-12, "with the yield on what is deployed");
}

{
  const row = { option_symbol: "XYZ261001P00100000", nbbo_bid: "0.89", nbbo_ask: "0.93", implied_volatility: "0.40", open_interest: "900", volume: "60" };
  const read = priceSale(row, { spot: 100, asOf: "2026-09-30", readMs: Date.parse("2026-09-30T14:00:00Z") });
  const days = priceSale(row, { spot: 100, asOf: "2026-09-30" });
  near(read.ivMid, 0.3927450257, 1e-6, "at 10:00 the day before an expiry the option has 1.25 days to run, and its mid inverts to 39.27% (scipy 1.17.1 brentq at T = 1.25/365, F = S e^{rT}, r = 4%)");
  near(read.cushionSigmas, 0.3889650274, 1e-6, "and the cushion is measured over that time: 0.38897 SD");
  near(days.ivMid, 0.4384430599, 1e-6, "while a caller with no read instant gets the whole day, T = 1/365, and reads 43.84%");
  ok(Math.abs(read.ivMid - days.ivMid) > 0.04, "four and a half volatility points apart, which is the error whole days made");
}

{
  const spot = 100, asOf = "2026-08-25", readMs = Date.parse("2026-08-25T18:10:00Z");
  const q = (sym, bid, ask, oi = 500) => ({ option_symbol: sym, nbbo_bid: String(bid), nbbo_ask: String(ask), implied_volatility: "0.30", open_interest: String(oi), volume: "40" });
  const chain = [
    q("XYZ260918C00095000", "5.75", "6.35"), q("XYZ260918P00095000", "0.62", "0.68"),
    q("XYZ260918C00105000", "0.85", "0.91"), q("XYZ260918P00105000", "5.20", "5.80"),
    q("XYZ260918C00100000", "2.60", "2.70"), q("XYZ260918P00100000", "2.40", "2.50"),
    q("XYZ260918C00090000", "10.2", "10.9", 900), q("XYZ260918P00090000", "0.20", "0.27", 40),
    q("XYZ260918C00102000", "1.55", "1.62"),
    q("XYZ261016C00095000", "6.6", "7.1"),
  ];
  const r = rankChain(chain, { spot, asOf, readMs, ticker: "XYZ", limit: 50 });
  const row = (type, strike, expiry = "2026-09-18") => r.rows.find((x) => x.type === type && x.strike === strike && x.expiry === expiry);
  const two = (o) => (o ? { bid: o.bid, ask: o.ask } : o);
  const same = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
  same(two(row("C", 95).opposite), { bid: 0.62, ask: 0.68 }, "an in-the-money call arrives with the bid and ask of the put struck beside it");
  same(two(row("P", 105).opposite), { bid: 0.85, ask: 0.91 }, "an in-the-money put with the call's");
  ok(row("P", 95).opposite === undefined && row("C", 105).opposite === undefined, "an out-of-the-money line carries none, since it is read from its own quote");
  ok(row("C", 100).opposite !== undefined, "a call struck at the money is inside the forward the rate alone gives, so it carries its put");
  ok(row("P", 100).opposite === undefined, "a put struck at the money is not in the money");
  same(two(row("C", 90).opposite), { bid: 0.2, ask: 0.27 }, "the other side is taken even when it is too thin to be a line of its own (open interest 40), since what it lends is its price");
  ok(row("C", 102).opposite === undefined, "a call above the forward the rate gives (100.66 for three weeks) carries none, and there is no put to take at 102 anyway");
  ok(row("C", 95, "2026-10-16").opposite === undefined, "and an in-the-money line whose strike has no put on its expiry carries none rather than another expiry's");
  ok(Object.keys(row("C", 95).opposite).sort().join() === "ask,bid", "and the quote holds a bid and an ask and nothing else");
  const off = rankChain([q("XYZ260918C00095000", "5.75", "6.35"), q("XYZ260918P00095000", "0", "0.05")], { spot, asOf, readMs, ticker: "XYZ", limit: 50 });
  ok(off.rows.every((x) => x.opposite === undefined), "a put with no bid is not a quote to read a volatility from, so the call carries nothing");
  const cut = rankChain(chain, { spot, asOf, readMs, ticker: "XYZ", limit: 1, rankBy: "premium" });
  ok(cut.rows.length === 1 && cut.rows[0].strike === 90 && cut.rows[0].type === "C", "ranked by premium and cut to one line, the deepest in-the-money call is what is kept");
  same(two(cut.rows[0].opposite), { bid: 0.2, ask: 0.27 }, "and it still takes its put from the whole chain, not from the lines that were kept");

  const svi = (a) => ({ a, b: 0.05, rho: -0.4, m: 0, sigma: 0.1 });
  const smiles = deskSmiles([
    { expiry: "2026-09-18", T: 0.0658, dte: 24, forward: { F: 100 }, smile: { method: "svi", n: 12, atmIv: 0.4, params: svi(0.0055), checks: { ok: true } } },
    { expiry: "2026-10-16", T: 0.1425, smile: { method: "svi-repaired", params: svi(0.008) } },
    { expiry: "2026-11-20", T: 0.2384, smile: { method: "mixture", params: { w: 0.5 } } },
    { expiry: "2027-04-16", T: 0.55, smile: { method: "mixture", params: svi(0.02) } },
    { expiry: "2027-05-21", T: 0.65, smile: { method: "flat", params: svi(0.02) } },
    { expiry: "2026-12-18", T: 0.315, smile: { method: "flat", params: { sigma: 0.4 } } },
    { expiry: "2027-01-15", T: 0.39, smile: { method: "svi", params: { a: 0.01, b: 0.05 } } },
    { expiry: "2027-02-19", T: 0, smile: { method: "svi", params: svi(0.01) } },
    { expiry: "2027-03-19", T: "0.5", smile: { method: "svi", params: { ...svi(0.01), rho: "-0.3" } } },
    null, { expiry: "x" },
  ]);
  same(smiles.map((e) => e.expiry), ["2026-09-18", "2026-10-16", "2027-03-19"], "of a card's expiries only the ones whose smile is an SVI with all five parameters and a positive year fraction go to the desk, and a mixture or a flat slice is left out even when it carries five parameters of its own");
  same(smiles[0], { expiry: "2026-09-18", T: 0.0658, smile: { method: "svi", params: svi(0.0055) } }, "cut to the expiry, its year fraction, the method and the five parameters");
  ok(smiles[2].T === 0.5 && smiles[2].smile.params.rho === -0.3, "numbers that arrived as text are numbers when they leave");
  same(deskSmiles(undefined), [], "and a card with no expiries sends none");
  ok(JSON.stringify(smiles[0]).length < 170, `at ${JSON.stringify(smiles[0]).length} bytes an expiry`);
}

{
  const spot = 100, readMs = Date.parse("2026-08-25T18:10:00Z"), asOf = "2026-08-25";
  const expiry = "2027-02-21", T = yearFraction(readMs, expiry);
  ok(Math.abs(T * 365 - 180) < 1, `the expiry is 180 days out (${(T * 365).toFixed(2)})`);
  const r = PRICING_RATE, q = 0.03, sigma = 0.30;
  const D = Math.exp(-r * T), trueF = spot * Math.exp((r - q) * T);
  const sym = (type, K) => `XYZ${expiry.slice(2).replace(/-/g, "")}${type}${String(Math.round(K * 1000)).padStart(8, "0")}`;
  const quote = (type, K, half = 0.02, iv = sigma) => {
    const mid = black76(trueF, D, K, iv, T, type);
    return { option_symbol: sym(type, K), nbbo_bid: (mid - half).toFixed(9), nbbo_ask: (mid + half).toFixed(9), implied_volatility: String(iv), open_interest: "500", volume: "40" };
  };
  const strikes = [85, 90, 95, 100, 105, 110, 115];
  const paired = strikes.flatMap((K) => [quote("C", K), quote("P", K)]);
  const otm = strikes.map((K) => quote(K < spot ? "P" : "C", K));
  const wide = { gates: { minOi: 0, maxSpread: 1, minPremium: 0 } };
  const rank = (rows, extra = {}) => rankChain(rows, { spot, asOf, readMs, ticker: "XYZ", limit: 50, ...wide, ...extra });
  const row = (res, type, K) => res.rows.find((x) => x.type === type && x.strike === K);
  const pts = (x) => Math.abs(x) * 100;

  const old = midImpliedVol({ spot, strike: 90, type: "P", mid: (Number(paired[2 * 1 + 1].nbbo_bid) + Number(paired[2 * 1 + 1].nbbo_ask)) / 2, years: T, rate: r });
  near(old - sigma, 0.0168, 0.0008, `AT q = 3% AND 180 DAYS THE RATE-ONLY FORWARD READS THE 90 PUT ${pts(old - sigma).toFixed(2)} VOL POINTS TOO HIGH, the bias the audit measured`);

  const parity = rank(paired);
  const p90 = row(parity, "P", 90), c110 = row(parity, "C", 110);
  near(p90.ivMid, sigma, 1e-6, "WITH THE CHAIN'S OWN PUT-CALL PARITY THE 90 PUT'S MID INVERTS TO 0.3000");
  near(c110.ivMid, sigma, 1e-6, "and the 110 call's, which the rate-only forward read 2.1 points low");
  eq(parity.forwards.length, 1, "one forward is disclosed for the one expiry on the chain");
  eq(parity.forwards[0].method, "parity", "built from the chain's parity");
  eq(parity.forwards[0].expiry, expiry, "for that expiry");
  ok(parity.forwards[0].pairs >= FORWARD_MIN_PAIRS, `from ${parity.forwards[0].pairs} call-put pairs`);
  ok(JSON.stringify(parity.forwards).length < 80, `at ${JSON.stringify(parity.forwards).length} bytes an expiry`);
  for (const x of parity.rows) near(x.ivMid, sigma, 1e-6, `${x.type} ${x.strike}: every line of the paired chain reads the one volatility that priced it`);

  const flipped = rank([...paired].reverse());
  near(row(flipped, "P", 90).ivMid, sigma, 1e-6, "and the order the feed sends the rows in does not matter");
  eq(rank(paired, { carry: 0.05 }).forwards[0].method, "parity", "a carry handed in is only a fallback: parity wins over it");
  near(row(rank(paired, { carry: 0.05 }), "P", 90).ivMid, sigma, 1e-6, "and does not move the volatility");

  const carried = rank(otm, { carry: q });
  near(row(carried, "P", 90).ivMid, sigma, 1e-6, "ON AN OUT-OF-THE-MONEY-ONLY CHAIN, WHICH HAS NO PAIRS, THE CARD'S 3% CARRY PLACES THE FORWARD: the 90 put reads 0.3000");
  near(row(carried, "C", 110).ivMid, sigma, 1e-6, "and the 110 call");
  eq(carried.forwards[0].method, "carry", "disclosed as the carry");
  eq(carried.forwards[0].pairs, 0, "with no pairs");

  const bare = rank(otm);
  eq(bare.forwards[0].method, "rate-only", "with no carry the forward is the rate alone, as it was");
  near(row(bare, "P", 90).ivMid - sigma, 0.0168, 0.0008, "and the 90 put is 1.68 points high, the figure before this change");
  near(row(bare, "C", 110).ivMid - sigma, -0.0210, 0.0010, "and the 110 call 2.10 points low");
  near(row(rank(otm, { carry: 0 }), "P", 90).ivMid, row(bare, "P", 90).ivMid, 1e-12, "a carry of zero is the rate alone");
  near(row(rank(otm, { carry: NaN }), "P", 90).ivMid, row(bare, "P", 90).ivMid, 1e-12, "and so is one that is not a number");

  const twoPairs = rank([quote("C", 100), quote("P", 100), quote("C", 105), quote("P", 105), quote("P", 95), quote("C", 110)], { carry: q });
  eq(twoPairs.forwards[0].method, "carry", "two pairs are not enough to place a forward: the carry does");
  near(row(twoPairs, "P", 95).ivMid, sigma, 1e-6, "and still reads 0.3000");

  const floored = (type, K) => ({ option_symbol: sym(type, K), nbbo_bid: "0.01", nbbo_ask: "0.01", implied_volatility: "0.3", open_interest: "500", volume: "1" });
  const wings = rank([...paired, floored("C", 60), floored("P", 60), floored("C", 150), floored("P", 150)], { gates: { minOi: 0, maxSpread: 1, minPremium: 0 } });
  near(row(wings, "P", 90).ivMid, sigma, 1e-6, "pairs floored at a cent on the far wings are not used, so they cannot move the forward");

  const lifted = (K) => { const x = quote("P", K); return { ...x, nbbo_bid: String(Number(x.nbbo_bid) + 20), nbbo_ask: String(Number(x.nbbo_ask) + 20) }; };
  const skew = [...paired.filter((x) => !/P\d+$/.test(x.option_symbol)), ...strikes.map(lifted)];
  const far = rank(skew, { carry: q });
  eq(far.forwards[0].method, "carry", `a parity forward more than ${FORWARD_MAX_LOG_GAP * 100}% from the rate forward is not believed: the carry stands`);

  const gappy = rank(paired.map((x) => ({ ...x, nbbo_ask: String(Number(x.nbbo_bid) * 3) })), { carry: q });
  eq(gappy.forwards[0].method, "carry", "pairs whose spreads are wider than half their mid are not used");

  const quoteAt = (type, K, F, half = 0.02, iv = sigma) => {
    const mid = black76(F, D, K, iv, T, type);
    return { option_symbol: sym(type, K), nbbo_bid: (mid - half).toFixed(9), nbbo_ask: (mid + half).toFixed(9), implied_volatility: String(iv), open_interest: "500", volume: "40" };
  };
  const rowsAt = (ks, F) => ks.flatMap((K) => [quoteAt("C", K, F), quoteAt("P", K, F)]);
  const nearTen = [90, 92.5, 95, 97.5, 100, 102.5, 105, 107.5, 110, 112.5];
  const farWings = [75, 77.5, 80, 82.5, 85, 87.5, 115, 117.5, 120, 122.5, 125];
  const driftF = trueF * 1.03;
  const crowded = rank([...rowsAt(nearTen, trueF), ...rowsAt(farWings, driftF)]);
  eq(crowded.forwards[0].method, "parity", "a chain of twenty-one paired strikes places a parity forward");
  eq(crowded.forwards[0].pairs, 10, "FROM THE TEN PAIRS NEAREST THE MONEY and no more");
  near(row(crowded, "P", 95).ivMid, sigma, 1e-6, "so the wings priced off a forward 3% higher do not move it: the 95 put reads 0.3000");
  near(row(crowded, "C", 105).ivMid, sigma, 1e-6, "nor the 105 call");

  const tight = (type, K) => ({ option_symbol: sym(type, K), nbbo_bid: "0.035", nbbo_ask: "0.045", implied_volatility: "0.3", open_interest: "500", volume: "1" });
  const cheap = rank([...rowsAt([90, 95, 105, 110], trueF), tight("C", 100), tight("P", 100)]);
  eq(cheap.forwards[0].method, "parity", "a pair at the money whose legs both mid at four cents with a one-cent spread weighs 2,500 against the 156 of a good pair");
  eq(cheap.forwards[0].pairs, 4, "AND IS NOT ONE OF THE PAIRS: the mid floor leaves it out");
  near(row(cheap, "P", 95).ivMid, sigma, 1e-6, "so it cannot pull the forward: the 95 put reads 0.3000");

  const shortExpiry = "2026-09-01", Ts = yearFraction(readMs, shortExpiry);
  ok(Ts * 365 > 6 && Ts * 365 < 8, `the short expiry is a week out (${(Ts * 365).toFixed(2)} days)`);
  const Ds = Math.exp(-r * Ts), restF = spot * Math.exp(r * Ts);
  const symS = (type, K) => `XYZ${shortExpiry.slice(2).replace(/-/g, "")}${type}${String(Math.round(K * 1000)).padStart(8, "0")}`;
  const quoteS = (type, K, F) => {
    const mid = black76(F, Ds, K, sigma, Ts, type);
    return { option_symbol: symS(type, K), nbbo_bid: (mid - 0.01).toFixed(9), nbbo_ask: (mid + 0.01).toFixed(9), implied_volatility: String(sigma), open_interest: "500", volume: "40" };
  };
  const weekRows = (F) => [97, 98, 99, 100, 101, 102, 103].flatMap((K) => [quoteS("C", K, F), quoteS("P", K, F)]);
  const week = rank(weekRows(restF * Math.exp(-0.001)));
  eq(week.forwards[0].method, "parity", "a week out, a parity forward a tenth of a percent from the rate forward is believed");
  const stale = rank(weekRows(restF * 1.05));
  eq(stale.forwards[0].method, "rate-only", "BUT ONE 5% FROM IT IS NOT: a week of carry cannot move a forward that far, so it is a stale or one-sided book");
  eq(rank(weekRows(restF * 1.05), { carry: 0.03 }).forwards[0].method, "carry", "and the card's carry stands in for it");
  eq(forwardGapLimit(7 / 365) < 0.035, true, "the gap allowed a week out is under 3.5%");
  near(forwardGapLimit(2), FORWARD_MAX_LOG_GAP, 0, "and it never exceeds the cap");
  ok(forwardGapLimit(0) === FORWARD_GAP_FLOOR, "with a floor at expiry");

  eq(rank(otm, { carry: 0.2 }).forwards[0].method, "carry", "a 20% carry over 180 days is a 10% forward shift, inside the cap");
  eq(rank(otm, { carry: 0.4 }).forwards[0].method, "rate-only", "A 40% CARRY IS NOT BELIEVED: 20% over 180 days is past the cap");
  eq(rank(otm, { carry: -0.4 }).forwards[0].method, "rate-only", "nor is a negative one of that size");
  eq(rank(otm, { carry: 3 }).forwards[0].method, "rate-only", "nor 300%");
  near(row(rank(otm, { carry: 3 }), "P", 90).ivMid, row(bare, "P", 90).ivMid, 1e-12, "and the line reads as it did on the rate alone");

  const plan = forwardPlan([], { spot, readMs });
  deep(plan("2027-02-21"), { F: null, method: "rate-only", pairs: 0 }, "an empty chain has no forward and says so");
  eq(forwardPlan(null, { spot, readMs })("x").method, "rate-only", "nor does a missing one");
  near(midImpliedVol({ spot, strike: 90, type: "P", mid: 3, years: T, rate: r, forward: spot * Math.exp(r * T) }), midImpliedVol({ spot, strike: 90, type: "P", mid: 3, years: T, rate: r }), 1e-12, "a forward equal to the rate forward is the old inversion");
  ok(midImpliedVol({ spot, strike: 90, type: "P", mid: 3, years: T, rate: r, forward: trueF }) < midImpliedVol({ spot, strike: 90, type: "P", mid: 3, years: T, rate: r }), "and a lower forward lowers a put's volatility");
}

{
  const facts = (v, g) => [{ id: "rv.30", v: 0.2, u: "frac", g: 3 }, { id: "carry.implied", v, u: "frac", g }];
  eq(deskCarry(facts(0.03, 3), "ok"), 0.03, "a coherent chain takes the card's carry at grade 3");
  eq(deskCarry(facts(0.03, 2), "ok"), 0.03, "and at grade 2");
  eq(deskCarry(facts(0.03, 1), "ok"), null, "but not at grade 1");
  eq(deskCarry(facts(0.03, 0), "ok"), null, "nor at grade 0, which is the rate-only forward the card itself used");
  eq(deskCarry(facts(0.03, 3), "rebased"), null, "A REBASED CHAIN TAKES NO CARRY: the rebased spot has absorbed it over the nearest expiries, and counting it again would double it");
  eq(deskCarry(facts(0.03, 3), "mismatch"), null, "a mismatch takes none");
  eq(deskCarry(facts(0.03, 3), "unchecked"), null, "nor does a chain whose check failed");
  eq(deskCarry(facts(null, 3), "ok"), null, "a null carry is none");
  eq(deskCarry(facts(0, 3), "ok"), 0, "a zero carry is zero");
  eq(deskCarry([{ id: "rv.30", v: 0.2, g: 3 }], "ok"), null, "a card without the fact has none");
  eq(deskCarry(null, "ok"), null, "a card without facts has none");
  eq(deskCarry({ "carry.implied": { v: 0.03, g: 3 } }, "ok"), null, "and only the list the desk is sent counts");
}


{
  const row = (type, strike, bid, expiry = "2026-11-20") => ({
    option_symbol: "SYX" + expiry.slice(2).replace(/-/g, "") + type + String(Math.round(strike * 1000)).padStart(8, "0"),
    nbbo_bid: bid, nbbo_ask: (Number(bid) + 0.05).toFixed(2), open_interest: "500", implied_volatility: "0.3",
  });
  const price = (mod, type, strike, bid, spot) => mod.priceSale(row(type, strike, bid), { spot, asOf: "2026-10-26", midIv: false });

  let residue = 0, cases = 0;
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 4000; i++) {
    const spotC = 100 + Math.floor(rnd() * 80000), strikeHalf = 2 + Math.floor(rnd() * 1800);
    const spot = spotC / 100, strike = strikeHalf / 2;
    for (const type of ["C", "P"]) {
      const intrC = Math.max(0, type === "C" ? spotC - strikeHalf * 50 : strikeHalf * 50 - spotC);
      if (intrC === 0) continue;
      const p = price({ priceSale }, type, strike, (intrC / 100).toFixed(2), spot);
      cases++;
      if (!p || !Object.is(p.extrinsic, 0) || p.annualized !== 0 || p.yieldOnCollateral !== 0) residue++;
    }
  }
  ok(cases > 3000, `${cases} in-the-money lines whose bid is exactly their intrinsic value`);
  eq(residue, 0, "EVERY ONE HAS EXACTLY ZERO TIME VALUE and a zero annualised yield: S - K in doubles left 7e-15 on four in eleven of them (471.26 spot, 410.5 strike, 60.76 bid)");
  const hit = price({ priceSale }, "C", 410.5, "60.76", 471.26);
  ok(Object.is(hit.extrinsic, 0) && Object.is(hit.assignedReturn, 0), "the buy-write's return if called is +0 there, never -1e-16 printed as -0.0%");
  const itm = price({ priceSale }, "C", 95, "5.10", 100.0001);
  near(itm.intrinsic, 5.0001, 1e-12, "a spot with four decimals keeps its intrinsic value");
  near(itm.extrinsic, 0.0999, 1e-12, "and the time value is what is left of the bid");
  const otm = price({ priceSale }, "C", 105, "0.40", 100);
  eq(otm.intrinsic, 0, "an out-of-the-money call has no intrinsic value");
  near(otm.extrinsic, 0.4, 1e-12, "and its whole bid is time value, never more than the bid");
  const under = price({ priceSale }, "P", 120, "19.00", 100);
  ok(Object.is(under.extrinsic, 0) && under.annualized === 0, "a bid below intrinsic value has exactly +0 time value");
  near(price({ priceSale }, "P", 100, "2.00", 100).yieldOnCollateral, 0.02, 1e-12, "at the money the yield is the bid over the strike");

  near(price({ priceSale }, "C", 95, "5.005", 100).extrinsic, 0.005, 1e-12, "half a cent of time value on a 5.00 intrinsic is kept, not swept up with the float noise");

  const floatSub = await loadMutated("shared/flows-premium.js", [["Math.max(0, withoutNoise(bid - inherent))", "Math.max(0, bid - inherent)"]]);
  const wide = await loadMutated("shared/flows-premium.js", [["const QUOTE_NOISE = 1e-9;", "const QUOTE_NOISE = 1e-2;"]]);
  const probe = (mod) => {
    const a = price(mod, "C", 410.5, "60.76", 471.26), b = price(mod, "C", 95, "5.005", 100);
    return !Object.is(a.extrinsic, 0) || Math.abs(b.extrinsic - 0.005) > 1e-12;
  };
  ok(probe(floatSub), "PLANTED WRONG BUILD: plain float subtraction of the intrinsic value is caught");
  ok(probe(wide), "PLANTED WRONG BUILD: a noise threshold wide enough to swallow half a cent of time value is caught");
  ok(!probe({ priceSale }), "and the shipped build passes the same probe");
}

{
  const c = crossesEarnings, pre = reportPrecedesSale;
  const at = (iso) => Date.parse(iso);
  const read = (asOf, iso) => ({ asOf, readMs: at(iso) });

  eq(isRealDate("2024-02-29"), true, "a leap day is a date");
  eq(isRealDate("2025-02-29"), false, "a non-leap 29 February is not");
  eq(isRealDate("2026-13-45"), false, "month 13 is not");
  eq(isRealDate("2026-4-5"), false, "and an unpadded one is not the grammar");

  eq(saleDayOf(at("2026-10-15T13:29:00Z")), "2026-10-15", "before the close a sale can still be made today");
  eq(saleDayOf(at("2026-10-15T20:01:00Z")), "2026-10-16", "after the 16:00 ET close (20:00Z in summer) the first sale is the next session");
  eq(saleDayOf(at("2026-11-05T20:59:00Z")), "2026-11-05", "in winter the close is 21:00Z: a read at 20:59Z can still sell");
  eq(saleDayOf(at("2026-11-05T21:01:00Z")), "2026-11-06", "and one at 21:01Z cannot");
  eq(saleDayOf(at("2026-10-17T15:00:00Z")), "2026-10-19", "a Saturday read sells on Monday");
  eq(saleDayOf(at("2026-11-27T17:59:00Z")), "2026-11-27", "the day after Thanksgiving closes at 13:00 ET (18:00Z): 17:59Z can sell");
  eq(saleDayOf(at("2026-11-27T18:01:00Z")), "2026-11-30", "and 18:01Z cannot");
  eq(saleDayOf(null), null, "with no read time there is no sale day");
  eq(saleDayOf(at("2026-11-27T18:30:00Z")), "2026-11-30", "13:30 EST on the Friday after Thanksgiving is past the 13:00 early close");
  eq(saleDayOf(at("2026-03-06T20:30:00Z")), "2026-03-06", "15:30 EST on a Friday can still sell");
  eq(saleDayOf(at("2026-03-09T20:30:00Z")), "2026-03-10", "16:30 EDT after the clocks changed is past the close");
  eq(saleDayOf(at("2026-12-24T18:30:00Z")), "2026-12-28", "Christmas Eve closes early and the 25th is a holiday: the next sale is Monday the 28th");
  eq(saleDayOf(at("2027-07-05T15:00:00Z")), "2027-07-06", "the 2027 holiday table is in force: Independence Day falls on a Sunday, so Monday 5 July 2027 is closed");
  eq(saleDayOf(at("2027-07-02T15:00:00Z")), "2027-07-02", "and the Friday before it is an ordinary session");

  const BMO = (when, expiry = "2026-10-23") => c(expiry, "2026-10-15", "premarket", read("2026-10-15", when));
  eq(BMO("2026-10-15T13:29:00Z"), null, "A PRE-MARKET REPORT, READ AT 09:29 ET ON THE DAY: no sale can precede it, so it is not a crossing and not a clear line either (null)");
  eq(BMO("2026-10-15T13:31:00Z"), null, "and the same at 09:31 ET, after the open: one report, one answer either side of the bell");
  eq(BMO("2026-10-15T18:00:00Z"), null, "and at lunchtime");
  eq(c("2026-10-23", "2026-10-15", "premarket", read("2026-10-14", "2026-10-14T15:00:00Z")), true, "read the day before, the same report is ahead of the sale and crosses");
  eq(c("2026-10-15", "2026-10-15", "premarket", read("2026-10-14", "2026-10-14T15:00:00Z")), true, "an option expiring on the report day, pre-market report, crosses it");
  eq(c("2026-10-14", "2026-10-15", "premarket", read("2026-10-13", "2026-10-13T15:00:00Z")), false, "and one expiring the day before does not");
  eq(c("2026-10-23", "2026-10-15", "afterhours", read("2026-10-15", "2026-10-15T19:59:00Z")), true, "AN AFTER-CLOSE REPORT READ AT 15:59 ET crosses: the sale is today, the report is tonight");
  eq(c("2026-10-15", "2026-10-15", "postmarket", read("2026-10-15", "2026-10-15T19:59:00Z")), false, "an option expiring that day settles before it");
  eq(c("2026-10-23", "2026-10-15", "afterhours", read("2026-10-15", "2026-10-15T20:01:00Z")), null, "read at 16:01 ET the next possible sale follows the report: null");
  eq(c("2026-11-12", "2026-11-05", "afterhours", read("2026-11-05", "2026-11-05T20:59:00Z")), true, "winter, 15:59 ET: crosses");
  eq(c("2026-11-12", "2026-11-05", "afterhours", read("2026-11-05", "2026-11-05T21:01:00Z")), null, "winter, 16:01 ET: null (a fixed 20:00Z close would have said crosses)");
  eq(c("2026-12-04", "2026-11-27", "afterhours", read("2026-11-27", "2026-11-27T18:01:00Z")), null, "on the early-close Friday 13:01 ET is already after the close");
  eq(c("2026-10-30", "2026-10-19", "premarket", read("2026-10-17", "2026-10-17T15:00:00Z")), null, "read on the Saturday before a Monday pre-market report: the first sale follows it");
  eq(c("2026-10-30", "2026-10-19", "afterhours", read("2026-10-17", "2026-10-17T15:00:00Z")), true, "but a Monday after-close report is still ahead of Monday's sale");
  eq(c("2026-10-23", "2026-10-15", "", read("2026-10-15", "2026-10-15T15:00:00Z")), null, "AN UNKNOWN ANNOUNCE TIME on the sale day is null: the report may precede the sale");
  eq(c("2026-10-23", "2026-10-15", "at_some_point", read("2026-10-15", "2026-10-15T15:00:00Z")), null, "so is an unrecognised token");
  eq(c("2026-10-23", "2026-10-16", "", read("2026-10-15", "2026-10-15T15:00:00Z")), true, "an unknown time the next day still crosses an option expiring after it");
  eq(c("2026-10-23", "2026-10-14", "premarket", read("2026-10-15", "2026-10-15T15:00:00Z")), null, "a report dated before the read keeps its stale-date answer");
  eq(c("2026-10-23", "2026-10-15", "premarket"), true, "WITHOUT A READ TIME the answer is the calendar's, as before");

  eq(pre("2026-10-15", "premarket", read("2026-10-15", "2026-10-15T15:00:00Z")), true, "the flag says the report precedes every possible sale");
  eq(pre("2026-03-10", null, read("2026-03-10", "2026-03-10T15:00:00Z")), null, "an unknown announce time on the sale day is undetermined, not printed");
  eq(pre("2026-03-13", "postmarket", read("2026-03-12", "2026-03-16T14:00:00Z")), true, "THE SALE DAY COMES FROM THE READ CLOCK: read on Monday 16 March, a Friday 13 March report is behind it whatever session date the chain carries");
  eq(c("2026-03-20", "2026-03-13", "postmarket", read("2026-03-12", "2026-03-16T14:00:00Z")), null, "and no line is said to cross it");
  eq(pre("2026-10-15", "afterhours", read("2026-10-15", "2026-10-15T15:00:00Z")), false, "not for an after-close report read before the close");
  eq(pre("2026-10-15", "afterhours", read("2026-10-15", "2026-10-15T20:30:00Z")), true, "and it does once the close has passed");
  eq(pre("2026-10-22", "premarket", read("2026-10-15", "2026-10-15T15:00:00Z")), false, "a report next week does not");
  eq(pre("2026-10-15", "premarket", {}), null, "no read time, no answer");
  eq(pre("garbage", "premarket", read("2026-10-15", "2026-10-15T15:00:00Z")), null, "an unusable date is null");

  const noClose = await loadMutated("shared/flows-premium.js", [["if (isSession(day) && readMs < closeUtcMs(day)) return day;", "if (isSession(day)) return day;"]]);
  const readClock = await loadMutated("shared/flows-premium.js", [["return when === \"before\" ? true : when === \"after\" ? false : null;", "return when === \"before\" ? readMs >= Date.parse(sale + \"T13:30:00Z\") : when === \"after\" ? false : null;"]]);
  const probe = (mod) => {
    const bad = [];
    if (mod.crossesEarnings("2026-10-23", "2026-10-15", "afterhours", read("2026-10-15", "2026-10-15T20:01:00Z")) !== null) bad.push("close");
    if (mod.crossesEarnings("2026-10-23", "2026-10-15", "premarket", read("2026-10-15", "2026-10-15T13:29:00Z")) !== null) bad.push("narrow");
    if (mod.crossesEarnings("2026-10-23", "2026-10-15", "", read("2026-10-15", "2026-10-15T15:00:00Z")) !== null) bad.push("unknown");
    if (mod.crossesEarnings("2026-11-12", "2026-11-05", "afterhours", read("2026-11-05", "2026-11-05T21:01:00Z")) !== null) bad.push("winter");
    return bad;
  };
  deep(probe({ crossesEarnings }), [], "the shipped rule passes the probe");
  ok(probe(noClose).length > 0, "PLANTED WRONG BUILD: ignoring the close (a sale day that never rolls) is caught: " + probe(noClose));
  ok(probe(readClock).length > 0, "PLANTED WRONG BUILD: the narrow rule (null only after the open, true before) is caught at 09:29 ET: " + probe(readClock));
}


{
  const otm = { collateral: 10000, premium: 120, extrinsic: 1.2, id: "otm" };
  const itmDeep = { collateral: 10000, premium: 1500, extrinsic: 0.05, id: "deep" };
  const under = { collateral: 10000, premium: 1400, extrinsic: 0, id: "under" };
  const z = sizeToBuyingPower(itmDeep, 100000);
  eq(z.contracts, 10, "ten contracts fit");
  eq(z.collectible, 15000, "the cash in is the whole bid");
  near(z.timeValue, 50, 1e-9, "of which 50 dollars is time value");
  near(z.intrinsicValue, 14950, 1e-9, "and the rest is in-the-money value that is not income");
  near(z.yieldOnDeployed, 50 / 100000, 1e-12, "so the return on what is deployed is 0.05%, not the 15% the cash suggests");
  const o = sizeToBuyingPower(otm, 100000);
  near(o.yieldOnDeployed, 1200 / 100000, 1e-12, "an out-of-the-money line earns its whole bid and nothing changes for it");
  eq(o.intrinsicValue, 0, "with no in-the-money value");
  const plan = planBuyingPower([itmDeep, under, otm], 100000);
  eq(plan.best.id, "otm", "THE BEST DEPLOYMENT IS THE LINE THAT EARNS THE MOST TIME VALUE, not the one that brings in the most cash (a 15.00 bid on a 14.95 intrinsic value used to win)");
  eq(plan.affordable, 3, "all three are affordable");
  eq(planBuyingPower([itmDeep, under].map((r, i) => ({ ...r, extrinsic: 0, id: "z" + i })), 100000).best, null, "when no line has time value left there is no best line");
  const tie = planBuyingPower([{ collateral: 20000, premium: 100, extrinsic: 1, id: "wide" }, { collateral: 10000, premium: 100, extrinsic: 1, id: "narrow" }], 40000);
  eq(tie.best.id, "narrow", "equal time value goes to the smaller deployment");
  eq(planBuyingPower([{ collateral: 10000, premium: 100, extrinsic: 1, id: "a" }, { collateral: 10000, premium: 100, extrinsic: 1, id: "b" }], 40000).best.id, "a", "and a full tie goes to the first");
  const bare = sizeToBuyingPower({ collateral: 10000, premium: 150 }, 100000);
  deep([bare.timeValue, bare.timeValueC, bare.intrinsicValue, bare.yieldOnDeployed], [null, null, null, null], "a row that carries no time value figure has none: it is not assumed to be all time value");
  eq(planBuyingPower([{ collateral: 10000, premium: 150, id: "bare" }], 100000).best, null, "and is never the best line");
  eq(sizeToBuyingPower({ collateral: 10000, premium: 150, extrinsic: -0.5 }, 100000).timeValueC, 0, "a negative time value is clamped to exactly zero, and the in-the-money part never exceeds the cash");
  const byGross = await loadMutated("shared/flows-premium.js", [["if (r.sizing.timeValueC > 0 && (best === null || betterDeployment(r.sizing, best.sizing))) best = r;", "if (best === null || r.sizing.collectible > best.sizing.collectible) best = r;"]]);
  eq(byGross.planBuyingPower([itmDeep, under, otm], 100000).best.id, "deep", "PLANTED WRONG BUILD: choosing by gross cash picks the in-the-money line, and the assertions above fail it");
  const yieldGross = await loadMutated("shared/flows-premium.js", [["yieldOnDeployed: deployedCents > 0 && timeValueCents !== null ? timeValueCents / deployedCents : null,", "yieldOnDeployed: deployedCents > 0 ? collectibleCents / deployedCents : null,"]]);
  ok(Math.abs(yieldGross.sizeToBuyingPower(itmDeep, 100000).yieldOnDeployed - 50 / 100000) > 0.1, "PLANTED WRONG BUILD: a yield on gross cash is 15% for a line that earns 0.05%, and the assertion above fails it");

  const readMs = Date.parse("2026-10-26T15:00:00Z");
  const chain = [["C", 100, "2.50"], ["P", 100, "2.40"], ["C", 105, "0.95"], ["P", 105, "5.60"], ["C", 95, "6.10"], ["P", 95, "0.60"]].map(([type, strike, bid]) => ({
    option_symbol: "SYX" + "261120" + type + String(strike * 1000).padStart(8, "0"), nbbo_bid: bid, nbbo_ask: (Number(bid) + 0.05).toFixed(2), open_interest: "500", implied_volatility: "0.3",
  }));
  const ranked = rankChain(chain, { spot: 100, asOf: "2026-10-26", readMs, ticker: "SYX", limit: 10 });
  const one = ranked.forwards.find((f) => f.expiry === "2026-11-20");
  eq(one.method, "parity", "the three strikes place a parity forward");
  ok(Number.isFinite(one.F) && one.F > 99 && one.F < 102, "and the payload names it (" + one.F + ")");
  const few = rankChain(chain.slice(0, 2), { spot: 100, asOf: "2026-10-26", readMs, ticker: "SYX", limit: 10, gates: { minOi: 0, maxSpread: 1, minPremium: 0 } });
  deep([few.forwards[0].method, few.forwards[0].F], ["rate-only", null], "with too few pairs the forward is the rate alone and no figure is named");
}

console.log(`✓ flows-premium: ${checks} assertions — the strike divisor from the feed's own ` +
  `example, per-chain IV units, sale priced at the bid, covered-call caps, gates that are reported, ` +
  `and an implied volatility surface whose smile survives the units, the gates and the stale prints`);
