/* Contracts for option-sale economics.

   This module is the one that runs ON THE REQUEST PATH, and it is the one
   whose output a user might trade against. Two classes of failure matter
   more here than anywhere else in the repo.

   THE PARSE. A strike read off by 1000x prices a trade that does not exist.
   The vendor's own spec documents the divisor in two places with opposite
   instructions — "multiplied by 1,000" under option_symbol, "divided by
   1,000" under option_chains, in the same regex. Only the example object
   settles it, so the example is pinned here as a test.

   THE RANKING. Sorting a chain by any single number surfaces junk, in a
   different direction depending on the number. The gates are what make the
   answer meaningful, so the tests below assert that junk is EXCLUDED and
   that the exclusion is REPORTED — a screen that quietly drops nine tenths
   of a chain and shows a tidy top ten misrepresents how thin the real
   opportunity set is. */

import assert from "node:assert/strict";
import {
  parseOptionSymbol, daysToExpiry, priceSale, rankChain, ivConvention,
  numOrNull, DEFAULT_GATES, SHARES_PER_CONTRACT, DAYS_PER_YEAR,
} from "../shared/flows-premium.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

/* ---------- the strike divisor, settled by the vendor's own example ---- */
{
  /* UVIX240920C00025000 is the example object in the spec. UVIX is a
     volatility ETF that trades in the teens. Multiplying gives a $25,000,000
     strike; dividing gives $25.00. Only one of those is a listed option. */
  const uvix = parseOptionSymbol("UVIX240920C00025000");
  eq(uvix.strike, 25, "the spec's own example object fixes the divisor at 1000");
  eq(uvix.ticker, "UVIX"); eq(uvix.expiry, "2024-09-20"); eq(uvix.type, "C");

  const p = parseOptionSymbol("AAPL260918P00180000");
  eq(p.strike, 180, "eight strike digits carry three implied decimals");
  eq(p.type, "P");

  // Fractional strikes survive the divisor.
  eq(parseOptionSymbol("SPY260918C00512500").strike, 512.5, "half-dollar strikes round-trip");

  ok(parseOptionSymbol("NOTANOPTION") === null, "an unrecognised symbol is dropped, not guessed");
  ok(parseOptionSymbol("AAPL261318P00180000") === null, "month 13 is rejected");
  ok(parseOptionSymbol("AAPL260918P00000000") === null, "a zero strike is not a strike");
  ok(parseOptionSymbol(null) === null, "a missing symbol is null, not a throw");
}

/* ---------- IV units are decided per chain, never per contract --------- */
{
  /* The individual value is genuinely ambiguous and the population is not.
     This is the same trap iv_rank set: the schema calls it a fraction and
     the wire sends 0-100. Getting it wrong scales every cushion by 100x. */
  const decimal = ivConvention(["0.31", "0.28", "0.44", "0.29"]);
  eq(decimal.divisor, 1, "a chain whose median is 0.29 is a fraction chain");

  const percent = ivConvention(["31", "28", "44", "29"]);
  eq(percent.divisor, 100, "a chain whose median is 29 is a percent chain");

  /* One outlier must not flip the whole chain, which is exactly what a
     max or a mean would do. */
  const withOutlier = ivConvention(["0.31", "0.28", "0.44", "0.29", "480"]);
  eq(withOutlier.divisor, 1, "a single 480 does not turn a fraction chain into a percent chain");

  eq(ivConvention([]).divisor, 1, "an empty chain defaults to fractions rather than throwing");
  ok(/no implied vol/.test(ivConvention([]).basis), "and says why");
}

/* ---------- a sale is priced at the BID, and only when there is one ---- */
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
  ok(p.annualizedIsConvention === true, "annualized carries its own warning label");
  eq(p.breakeven, 167.5, "assigned, the basis is strike minus the premium kept");
  eq(p.days, 24);
  eq(p.oiChange, 200, "open interest change comes from prev_oi, not inferred");

  /* THE CUSHION. log(spot/breakeven) over the option's own implied move for
     its own remaining life. Two quoted numbers, no free parameters. */
  const sigma = 0.28 * Math.sqrt(24 / 365);
  near(p.cushionSigmas, Math.log(180 / 167.5) / sigma, 1e-9,
       "cushion is the move to breakeven in the option's own implied sigmas");

  /* NO BID IS NOT A CHEAP SALE. There is nobody to sell to. A screen that
     prices these ranks a phantom line first, every time. */
  ok(priceSale({ ...base, nbbo_bid: "0" }, { spot: 180, asOf: "2026-08-25" }) === null,
     "a zero bid is unsellable, not free money");
  ok(priceSale({ ...base, nbbo_bid: null }, { spot: 180, asOf: "2026-08-25" }) === null,
     "an absent bid is unpriceable");
  ok(priceSale({ ...base, nbbo_ask: "2.40" }, { spot: 180, asOf: "2026-08-25" }) === null,
     "a crossed book is stale data, not an arbitrage");
  ok(priceSale(base, { spot: 0, asOf: "2026-08-25" }) === null, "no spot, no pricing");

  // 0 DTE has no annual anything: null, not Infinity.
  const zero = priceSale({ ...base, option_symbol: "AAPL260825P00170000" },
                         { spot: 180, asOf: "2026-08-25" });
  ok(zero.annualized === null, "a contract expiring today annualizes to null, never Infinity");
  eq(zero.premium, 250, "and still reports the premium it actually pays");
}

/* ---------- a covered call is a different denominator AND a cap -------- */
{
  const cc = priceSale({
    option_symbol: "AAPL260918C00190000", nbbo_bid: "3.20", nbbo_ask: "3.35",
    implied_volatility: "0.26", open_interest: "950", volume: "400",
  }, { spot: 180, asOf: "2026-08-25" });

  eq(cc.strategy, "cc");
  eq(cc.collateral, 18000, "a covered call's collateral is the shares at SPOT, not the strike");
  eq(cc.breakeven, 176.8, "the premium is the entire downside cushion on shares you already own");
  near(cc.assignedReturn, (190 - 180 + 3.2) / 180, 1e-12, "called away, the return is capped here");

  /* THE CAP IS THE COST, and it is missing from every naive yield screen. */
  const sigma = 0.26 * Math.sqrt(24 / 365);
  near(cc.capSigmas, Math.log(190 / 180) / sigma, 1e-9,
       "capSigmas is how far the market must run before the sale costs more than it paid");
  ok(priceSale({
    option_symbol: "AAPL260918P00170000", nbbo_bid: "2.50", nbbo_ask: "2.60",
    implied_volatility: "0.28", open_interest: "9",
  }, { spot: 180, asOf: "2026-08-25" }).capSigmas === null,
     "a put has no upside cap, so capSigmas is null rather than a manufactured zero");
}

/* ---------- the gates are the ranking, and they are reported ----------- */
{
  const spot = 180, asOf = "2026-08-25";
  /* THE LOTTERY TICKET. Two days out, far out of the money, quoted 0.01 by
     0.30, eleven contracts of open interest. Its annualized yield is the
     largest number on the chain and it is arithmetic on a bid nobody hits.
     A naive "highest premium" screen puts this first. */
  const junk = { option_symbol: "AAPL260827P00120000", nbbo_bid: "0.01", nbbo_ask: "0.30",
                 implied_volatility: "0.90", open_interest: "11", volume: "2" };
  /* THE WIDE ONE. Real size, real premium, but quoted 8.00 by 12.00. The
     bid is a placeholder, so the yield computed off it is fiction. */
  const wide = { option_symbol: "AAPL260918P00160000", nbbo_bid: "8.00", nbbo_ask: "12.00",
                 implied_volatility: "0.35", open_interest: "4000", volume: "900" };
  /* THE THIN ONE. Tight spread, real premium, nobody else in it. */
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

  /* Every exclusion is attributed. A total that does not reconcile means a
     contract vanished silently, which is the failure this whole block is
     about. Each contract is charged to the FIRST gate it fails. */
  const excluded = Object.values(r.gated).reduce((a, b) => a + b, 0);
  eq(excluded + r.priced, r.screened, "every screened contract is either ranked or attributed");

  ok(r.gates.maxSpread === DEFAULT_GATES.maxSpread,
     "the gates that produced this answer ship with it, so they can be argued with");
}

/* ---------- ranking keys, and nulls that must not win ------------------ */
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

  /* A CONTRACT WITH NO CUSHION MEASUREMENT MUST NOT WIN A CUSHION RANKING.
     Descending sort on null is exactly how an unmeasured field floats to the
     top and reads as the strongest result on the page. */
  const noIv = { option_symbol: "XYZ260918P00095000", nbbo_bid: "2.00", nbbo_ask: "2.05",
                 open_interest: "500" };
  const withNull = rankChain([...rows, noIv], { spot, asOf, rankBy: "cushionSigmas" });
  ok(withNull.rows[withNull.rows.length - 1].cushionSigmas === null,
     "an unmeasurable cushion sorts LAST, never first");
  ok(withNull.rows[0].cushionSigmas !== null, "and a measured one leads");
}

/* ---------- strategy filtering -------------------------------- */
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

/* ---------- hygiene ------------------------------------------- */
{
  eq(numOrNull(""), null); eq(numOrNull(null), null); eq(numOrNull("abc"), null);
  eq(numOrNull("2.5"), 2.5); eq(numOrNull(0), 0, "zero is a number, not an absence");
  eq(SHARES_PER_CONTRACT, 100);
  eq(daysToExpiry("2026-09-18", "2026-08-25"), 24);
  eq(daysToExpiry("bad", "2026-08-25"), null, "an unparseable date is null, not NaN days");
  eq(rankChain(null, { spot: 100, asOf: "2026-08-25" }).priced, 0, "a null chain is empty, not a throw");
}

console.log(`✓ flows-premium: ${checks} assertions — the strike divisor from the vendor's own ` +
  `example, per-chain IV units, sale priced at the bid, covered-call caps, and gates that are reported`);
