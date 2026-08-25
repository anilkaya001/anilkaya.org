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
  numOrNull, DEFAULT_GATES, SHARES_PER_CONTRACT, DAYS_PER_YEAR, crossesEarnings,
  sizeToBuyingPower, planBuyingPower,
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

/* ---------- earnings crossing, and the tri-state that matters --- */
{
  /* A cushion is a DIFFUSION number. An earnings report is a jump. Two rows
     with identical premium and identical cushion are different trades when one
     outlives a report — so this marks them, and the marking has three states
     rather than two.

     NULL IS NOT FALSE, and the difference points the dangerous way. Answering
     "does not cross" when the truth is "cannot tell" reports a 45-day put as
     event-free on a name whose date the vendor simply does not have. */
  const c = crossesEarnings;

  eq(c("2026-09-18", "2026-08-20", "afterhours"), true,
     "a report before expiry crosses, and the announce time is irrelevant");
  eq(c("2026-09-18", "2026-10-30", "premarket"), false,
     "a report after expiry does not, and the announce time is irrelevant there too");

  /* THE ONLY CASE THE DATE CANNOT SETTLE is a report ON the expiry date. */
  eq(c("2026-09-18", "2026-09-18", "premarket"), true,
     "same day before the open: the report lands while the contract is alive");
  eq(c("2026-09-18", "2026-09-18", "postmarket"), false,
     "same day after the close: it lands after settlement");
  eq(c("2026-09-18", "2026-09-18", "afterhours"), false,
     "and the OTHER spelling of after-the-close means the same thing");

  /* THE VOCABULARY IS UNDOCUMENTED, which is why an unrecognised token is not
     guessed at. /info's announce_time is declared `string` with no enum — only
     the example "premarket" — while its sibling report_time on the earnings
     endpoints documents "premarket, postmarket and unknown". Two fields, one
     concept, different words, and the one read here documents none. */
  eq(c("2026-09-18", "2026-09-18", "unknown"), null,
     "same day with the timing unknown is NULL, not false");
  eq(c("2026-09-18", "2026-09-18", "at_some_point"), null,
     "an unrecognised token is null — the vendor's vocabulary is not pinned");
  eq(c("2026-09-18", "2026-09-18", ""), null, "and an empty token is null");
  eq(c("2026-09-18", "2026-09-18", null), null, "and a missing one");

  /* SHAPE GUARDS. `=== null` catches neither shape that breaks this: an ABSENT
     key makes `undefined < "2026-09-18"` false, so every row reads event-free;
     an EMPTY STRING makes `"" < "2026-09-18"` true, so every row is marked. */
  eq(c("2026-09-18", undefined, "premarket"), null, "an absent date is null, not false");
  eq(c("2026-09-18", "", "premarket"), null, "an empty date is null, not a crossing");
  eq(c("2026-09-18", null, "premarket"), null, "and an explicit null");

  /* SHAPE IS NOT VALIDITY. "2023-13-45" passes a YYYY-MM-DD regex and sorts
     lexicographically BEFORE every real date, so a shape-only check read it as
     "crosses" on every single row. */
  eq(c("2026-09-18", "2023-13-45", "premarket"), null, "month 13 is not a date");
  eq(c("2026-09-18", "2023-10-32", "premarket"), null, "day 32 is not a date");
  eq(c("2026-09-18", "2023-02-30", "premarket"), null, "and neither is 30 February");
  eq(c("2026-09-18", "2024-02-29", "premarket"), true, "but a real leap day is");
  eq(c("2026-09-18", "2023-10-26T13:30:00Z", "premarket"), null,
     "a datetime is not the bare date this comparison requires");
  eq(c("bad-expiry", "2026-08-20", "premarket"), null, "an unusable expiry is null too");
}

/* ---------- buying power: what you can actually collect --------- */
{
  /* THE WHOLE POINT, in one fixture. Two lines at IDENTICAL 3.0% yield. Yield
     is the right way to compare two contracts and the wrong way to plan a
     session, because capital is finite and contracts are indivisible. */
  const amgn = { ticker: "AMGN", collateral: 43000, premium: 1290, yieldOnCollateral: 0.03 };
  const wmb  = { ticker: "WMB",  collateral: 7000,  premium: 210,  yieldOnCollateral: 0.03 };

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

  /* FLOOR, NOT ROUND — and the fixture has to be chosen so the two DISAGREE.
     Every case above divides to a fraction below .5, where floor and round
     give the same answer, so they could not tell an over-allocating build from
     a correct one. $50,000 against a $4,000 requirement is exactly 12.5:
     rounding buys 13 contracts for $52,000 on a $50,000 account. */
  const half = sizeToBuyingPower({ collateral: 4000, premium: 100 }, 50000);
  eq(half.contracts, 12, "12.5 contracts floors to 12 — rounding would overspend the account");
  eq(half.deployed, 48000, "and deploys only what those contracts require");
  ok(half.deployed <= 50000, "deployed capital NEVER exceeds the buying power entered");
  eq(half.idle, 2000, "the remainder is idle, not quietly spent");

  /* ZERO CONTRACTS IS AN ANSWER, NOT AN ABSENCE. "You cannot afford this" is
     exactly what a $5,000 account needs told about a $443 stock; dropping the
     row would leave the reader wondering where it went. */
  const small = sizeToBuyingPower(amgn, 5000);
  eq(small.contracts, 0, "a line larger than the account sizes to zero");
  eq(small.affordable, false, "and says so explicitly");
  eq(small.collectible, 0, "collecting nothing is the honest number here");
  eq(small.idle, 5000, "with the whole account left idle");

  /* Unanswerable inputs are null, never a zero that reads as a real answer. */
  ok(sizeToBuyingPower(amgn, 0) === null, "no buying power is unanswerable, not zero contracts");
  ok(sizeToBuyingPower(amgn, null) === null, "and so is an absent one");
  ok(sizeToBuyingPower(amgn, -100) === null, "and a negative one");
  ok(sizeToBuyingPower({ collateral: 0, premium: 100 }, 50000) === null,
     "a line with no collateral cannot be sized");
  ok(sizeToBuyingPower(null, 50000) === null, "and neither can a missing line");
}

{
  const rows = [
    { ticker: "AMGN", collateral: 43000, premium: 1290 },
    { ticker: "WMB",  collateral: 7000,  premium: 210 },
    { ticker: "HUGE", collateral: 900000, premium: 40000 },
  ];
  const plan = planBuyingPower(rows, 50000);
  eq(plan.buyingPower, 50000);
  eq(plan.affordable, 2, "the line bigger than the account is counted as unaffordable");
  eq(plan.best.ticker, "WMB", "the best line for THIS account is the one that collects most");
  eq(plan.rows.length, 3, "and every row survives, sized — none is silently dropped");
  ok(plan.rows.every((r) => r.sizing !== null), "each carries its own sizing");

  /* HUGE has the largest premium per contract by far and is still not the
     answer, because none of it is reachable. */
  const huge = plan.rows.find((r) => r.ticker === "HUGE");
  eq(huge.sizing.contracts, 0);
  ok(huge.premium > plan.best.premium,
     "the biggest per-contract premium on the chain loses to one the account can actually buy");

  /* With no buying power entered the desk is unchanged — sizing is null and
     nothing is filtered, because the feature is additive. */
  const none = planBuyingPower(rows, null);
  eq(none.buyingPower, null);
  eq(none.rows.length, 3, "every row still present");
  ok(none.rows.every((r) => r.sizing === null), "and none pretends to be sized");
  eq(none.best, null, "with no best line claimed");
  eq(planBuyingPower(null, 50000).rows.length, 0, "a null chain is empty, not a throw");
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
