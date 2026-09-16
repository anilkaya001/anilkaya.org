import assert from "node:assert/strict";
import {
  parseOptionSymbol, daysToExpiry, priceSale, rankChain, ivConvention,
  numOrNull, DEFAULT_GATES, SHARES_PER_CONTRACT, DAYS_PER_YEAR, crossesEarnings,
  sizeToBuyingPower, planBuyingPower,
  ivSurface, SURFACE_ROW_STEPS, SURFACE_MAX_EXPIRIES,
} from "../shared/flows-premium.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };

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
  ok(p.annualizedIsConvention === true, "annualized carries its own warning label");
  eq(p.breakeven, 167.5, "assigned, the basis is strike minus the premium kept");
  eq(p.days, 24);
  eq(p.oiChange, 200, "open interest change comes from prev_oi, not inferred");

  const sigma = 0.28 * Math.sqrt(24 / 365);
  near(p.cushionSigmas, Math.log(180 / 167.5) / sigma, 1e-9,
       "cushion is the move to breakeven in the option's own implied sigmas");

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

  const sigma = 0.26 * Math.sqrt(24 / 365);
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
  const withNull = rankChain([...rows, noIv], { spot, asOf, rankBy: "cushionSigmas" });
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
     "an unrecognised token is null — the vendor's vocabulary is not pinned");
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

  const half = sizeToBuyingPower({ collateral: 4000, premium: 100 }, 50000);
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
       "raw vendor rows build no surface at all — the module reads the divided field and no raw one");
    eq(raw.placed, 0, "so there is no way to draw an undivided surface by accident");
  }

  {

    const noVol = { option_symbol: "CCC260918P00082000", nbbo_bid: "0.55", nbbo_ask: "0.60",
                    open_interest: "300", volume: "50" };
    const r = rankChain([...chain, noVol], { spot, asOf, ticker: "CCC" });
    ok(!r.ivSurface.grid.flat().some((c) => c && c.strike === 82),
       "a contract the vendor quoted no implied volatility for is ABSENT from the surface");
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

console.log(`✓ flows-premium: ${checks} assertions — the strike divisor from the vendor's own ` +
  `example, per-chain IV units, sale priced at the bid, covered-call caps, gates that are reported, ` +
  `and an implied volatility surface whose smile survives the units, the gates and the stale prints`);
