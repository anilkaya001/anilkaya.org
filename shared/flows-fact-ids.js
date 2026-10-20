import { BUCKET_LINES } from "./flows-quant-structures.js";

const ORIGIN = "2026-09-23";

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

const IV_CLAIM = { hi: BUCKET_LINES.IV_HIGH, lo: BUCKET_LINES.IV_LOW, strict: true };
const SKEW_CLAIM = { hi: BUCKET_LINES.SKEW_STEEP, lo: BUCKET_LINES.SKEW_FLAT, strict: false };

const CM_RULE = "the weaker of the two bracketing slices' fit grades, capped at 2 when the maturity is extrapolated; 0 and withheld when no slice reaches it";
const CM_MEANING = (d) => "At-the-money implied volatility interpolated in total variance to a constant " + d + "-day maturity from the fitted expiry slices";

export const FACT_IDS = deepFreeze({
  "iv.cm.7": { meaning: CM_MEANING(7), unit: "vol", tenor: "7 days, constant maturity", gradeRule: CM_RULE, since: ORIGIN },
  "iv.cm.30": { meaning: CM_MEANING(30), unit: "vol", tenor: "30 days, constant maturity", gradeRule: CM_RULE, since: ORIGIN },
  "iv.cm.90": { meaning: CM_MEANING(90), unit: "vol", tenor: "90 days, constant maturity", gradeRule: CM_RULE, since: ORIGIN },
  "iv.rank.1y": {
    meaning: "Min-max rank of the 30-day implied volatility within its own past year, from the priced-move panel: 0 at the one-year low, 1 at the one-year high",
    unit: "frac", tenor: "30-day implied volatility, 1 year lookback", gradeRule: "2 when the panel carries a rank between 0 and 1; 0 and withheld otherwise",
    claimLines: IV_CLAIM, since: ORIGIN,
  },
  "iv.pct.30": {
    meaning: "The same min-max rank as iv.rank.1y, stored under a percentile-looking id before iv.pctile.30.1y existed: a rank and not a percentile, kept for stored cards until it is retired",
    unit: "frac", tenor: "30-day implied volatility, 1 year lookback", gradeRule: "2 when the panel carries a rank between 0 and 1; 0 and withheld otherwise",
    claimLines: IV_CLAIM, since: ORIGIN, retired: { since: "2026-10-11", by: "iv.pctile.30.1y" },
  },
  "iv.pctile.30.1y": {
    meaning: "Percentile of today's 30-day implied volatility within its own past year of readings, as the volatility cone reports it from its 251-sample history",
    unit: "frac", tenor: "30-day implied volatility, 1 year lookback",
    gradeRule: "2, or 1 when the cone is thin; 0 and withheld when the cone carries no percentile",
    claimLines: IV_CLAIM, since: "2026-10-11",
  },
  "term.slope.30_90": {
    meaning: "The 30-day constant-maturity implied volatility over the 90-day one, less 1: positive when the front is the richer end",
    unit: "frac", tenor: "30 to 90 days", gradeRule: "the weaker of iv.cm.30 and iv.cm.90", since: ORIGIN,
  },
  "term.front.7_30": {
    meaning: "The 7-day constant-maturity implied volatility over the 30-day one, less 1: positive when the very front is bid",
    unit: "frac", tenor: "7 to 30 days", gradeRule: "the weaker of iv.cm.7 and iv.cm.30", since: ORIGIN,
  },
  "term.slope.30_90.exEvent": {
    meaning: "term.slope.30_90 with the variance of the earnings jump removed from every maturity that spans the event date",
    unit: "frac", tenor: "30 to 90 days", gradeRule: "term.slope.30_90's grade, capped at 1 when an event inside 90 days could not be removed", since: ORIGIN,
  },
  "skew.rr25.30": {
    meaning: "25-delta risk reversal: the 25-delta put's implied volatility less the 25-delta call's, on the expiry nearest 30 days",
    unit: "vol", tenor: "expiry nearest 30 days", gradeRule: "the slice's fit grade, 0 for a flat slice", since: ORIGIN,
  },
  "skew.bf25.30": {
    meaning: "25-delta butterfly: the mean of the 25-delta put and call implied volatilities less the at-the-money one, on the expiry nearest 30 days",
    unit: "vol", tenor: "expiry nearest 30 days", gradeRule: "the slice's fit grade, 0 for a flat slice", since: ORIGIN,
  },
  "skew.rr25.30.pct": {
    meaning: "Share of the names screened that night whose 25-delta risk reversal sits at or below this name's: a rank among screened names, not a history of the name's own",
    unit: "frac", tenor: "expiry nearest 30 days", gradeRule: "2 when at least ten names were screened; 0 and withheld otherwise",
    claimLines: SKEW_CLAIM, since: ORIGIN,
  },
  "carry.implied": {
    meaning: "Continuous carry rate the option chain implies through put-call parity, annualised: the dividend-yield-like term of the forward",
    unit: "frac", tenor: "expiry nearest 75 days between 45 and 120, else the one nearest 30",
    gradeRule: "0 when the forward is rate-only, 3 with three or more parity pairs, else 2", since: ORIGIN,
  },
  "garch.avg.21": {
    meaning: "Average annualised volatility the fitted GARCH model forecasts over the next 21 sessions",
    unit: "vol", tenor: "next 21 sessions", gradeRule: "the fit's own grade, 1 when it did not converge, 2 otherwise; 0 and withheld with no fit", since: ORIGIN,
  },
  "garch.halfLife": {
    meaning: "Sessions for a volatility shock to decay by half under the fitted GARCH persistence",
    unit: "sessions", tenor: null, gradeRule: "the fit's grade, as garch.avg.21", since: ORIGIN,
  },
  "garch.grade": {
    meaning: "The GARCH fit's own robustness grade, 0 to 3, carried as a count",
    unit: "count", tenor: null, gradeRule: "3 when there is a fit, 0 and withheld otherwise", since: ORIGIN,
  },
  "vrp.var.21": {
    meaning: "Implied variance at 30 days, earnings removed when known, less the GARCH average variance of the next 21 sessions, annualised",
    unit: "var", tenor: "30-day implied against the next 21 sessions", gradeRule: "the weakest of iv.cm.30 and the GARCH grade, capped at 1 when an event inside 30 days is not removed", since: ORIGIN,
  },
  "vrp.vol.21": {
    meaning: "Implied volatility at 30 days, earnings removed when known, less the GARCH average volatility of the next 21 sessions",
    unit: "vol", tenor: "30-day implied against the next 21 sessions", gradeRule: "as vrp.var.21", since: ORIGIN,
  },
  "vrp.rel.21": {
    meaning: "vrp.vol.21 as a share of the GARCH average volatility: how much richer implied volatility is than the model's forecast, relative",
    unit: "frac", tenor: "30-day implied against the next 21 sessions", gradeRule: "as vrp.var.21", since: ORIGIN,
  },
  "rv.cc.21": {
    meaning: "Close-to-close realised volatility over the last 21 sessions, from the priced-move panel's rv30 field",
    unit: "vol", tenor: "trailing 21 sessions", gradeRule: "2 when the panel carries it; 0 and withheld otherwise", since: ORIGIN,
  },
  "vrp.trailing.21": {
    meaning: "30-day constant-maturity implied volatility less the trailing 21-session realised volatility, a backward-looking premium",
    unit: "vol", tenor: "30-day implied against the trailing 21 sessions", gradeRule: "always 1 when present, because realised volatility looks back", since: ORIGIN,
  },
  "level.callWall": {
    meaning: "Strike at or above spot with the largest call gamma open interest in the vendor's strike book",
    unit: "px", tenor: null, gradeRule: "3 when a book is held; 0 and withheld otherwise", since: ORIGIN,
  },
  "level.putWall": {
    meaning: "Strike at or below spot with the largest absolute put gamma open interest in the vendor's strike book",
    unit: "px", tenor: null, gradeRule: "3 when a book is held; 0 and withheld otherwise", since: ORIGIN,
  },
  "level.magnet": {
    meaning: "Strike with the largest absolute dealer-book gamma, calls plus signed puts, on the vendor's convention (dealers long calls, short puts)",
    unit: "px", tenor: null, gradeRule: "3 when the put signs agree; 0 and withheld when they are mixed or no book is held", since: ORIGIN,
  },
  "level.flip": {
    meaning: "Price at which the dealer gamma profile recomputed from the chain crosses zero, on the vendor's convention (dealers long calls, short puts)",
    unit: "px", tenor: null,
    gradeRule: "the profile's coverage grade capped at 2 because the sign convention is the vendor's, and capped at 1 when the sign at spot contradicts the book gamma", since: ORIGIN,
  },
  "level.flip.count": {
    meaning: "How many times the recomputed dealer gamma profile changes sign across the price grid",
    unit: "count", tenor: null, gradeRule: "as level.flip", since: ORIGIN,
  },
  "level.strikeSumCrossing": {
    meaning: "Price at which gamma summed strike by strike changes sign, from the card",
    unit: "px", tenor: null, gradeRule: "2 when the card carries a crossing; 0 and withheld otherwise", since: ORIGIN,
  },
  "level.maxPain": {
    meaning: "Max-pain strike of the expiry the card's levels panel names",
    unit: "px", tenor: null, gradeRule: "2, or 1 when the expiry is thin; 0 and withheld when the panel has none", since: ORIGIN,
  },
  "level.flowPeakLong": {
    meaning: "Strike with the largest net long gamma from today's option flow, from the card's gamma panel",
    unit: "px", tenor: "today's flow", gradeRule: "1 when the panel carries it; 0 and withheld otherwise", since: ORIGIN,
  },
  "level.flowPeakShort": {
    meaning: "Strike with the largest net short gamma from today's option flow, from the card's gamma panel",
    unit: "px", tenor: "today's flow", gradeRule: "1 when the panel carries it; 0 and withheld otherwise", since: ORIGIN,
  },
  "gex.book": {
    meaning: "Dealers' book gamma in dollars per 1% move of the underlying, on the vendor's convention (dealers long calls, short puts)",
    unit: "usdPer1pct", tenor: null, gradeRule: "2 when a book gamma is held; 0 and withheld otherwise", since: ORIGIN,
  },
  "gex.flow": {
    meaning: "Net gamma of today's option flow in dollars per 1% move of the underlying, on the vendor's convention",
    unit: "usdPer1pct", tenor: "today's flow", gradeRule: "1 when held; 0 and withheld otherwise", since: ORIGIN,
  },
  "event.days": {
    meaning: "Calendar days from the card's session to the next listed earnings date",
    unit: "days", tenor: null, gradeRule: "3 when the date is confirmed, 2 when estimated, 0 and withheld with none listed", since: ORIGIN,
  },
  "event.confirmed": {
    meaning: "1 when the next earnings date is confirmed, 0 when it is estimated",
    unit: "count", tenor: null, gradeRule: "3 when an event is listed; 0 and withheld otherwise", since: ORIGIN,
  },
  "move.event.hist.medianAbs": {
    meaning: "Median absolute one-day move over the name's past earnings reactions, from at least three of them",
    unit: "frac", tenor: "past earnings reactions", gradeRule: "3 from six or more reactions, 2 from three to five; 0 and withheld with fewer", since: ORIGIN,
  },
  "move.event": {
    meaning: "Option-implied mean absolute earnings move: the jump the two expiries around the event price beyond diffusion",
    unit: "frac", tenor: "the event", gradeRule: "3 when the term fit has a spare degree of freedom and a clean residual, 2 when a jump is priced, 1 when the shape is unidentified or the fit carries a residual or reason; 0 and withheld otherwise", since: ORIGIN,
  },
  "move.event.ratio": {
    meaning: "move.event over move.event.hist.medianAbs: the earnings move the options price against the name's own history",
    unit: "ratio", tenor: "the event", gradeRule: "2 from six or more past reactions, else 1, and never above the grade of move.event; 0 and withheld without both inputs", since: ORIGIN,
  },
});

export const FACT_FAMILIES = deepFreeze({
  "move.mad.": {
    meaning: "Mean-absolute-deviation implied move to the expiry named by the suffix, as a fraction of spot, on the expiry nearest 30 days",
    unit: "frac", tenor: "to the expiry in the suffix", gradeRule: "the slice's fit grade", since: ORIGIN,
  },
});

export function factEntry(id) {
  if (typeof id !== "string") return null;
  if (Object.hasOwn(FACT_IDS, id)) return FACT_IDS[id];
  for (const prefix of Object.keys(FACT_FAMILIES)) if (id.startsWith(prefix) && id.length > prefix.length) return FACT_FAMILIES[prefix];
  return null;
}

export function retiredIds() {
  return Object.freeze(Object.keys(FACT_IDS).filter((id) => FACT_IDS[id].retired));
}

export function claimLinesOf() {
  const out = {};
  for (const id of Object.keys(FACT_IDS)) if (FACT_IDS[id].claimLines && !FACT_IDS[id].retired) out[id] = FACT_IDS[id].claimLines;
  return Object.freeze(out);
}

export const CLAIM_LINES = claimLinesOf();
