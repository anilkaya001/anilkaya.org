/* =============================================================
   flows-premium.js — option-sale economics for the on-demand desk.

   Pure functions, no I/O, no dependencies. Unlike flows-features.js
   this module DOES run on the request path: the chain route parses a
   vendor response and prices it inside the Worker's CPU budget. That
   budget is the design constraint, and it was measured rather than
   assumed — auth HMAC + parse 250KB + price 500 contracts + emit the
   top 120 costs 2.29ms of roughly 10ms. Everything here is a single
   pass with no allocation per field.

   THE IDENTIFICATION BAR, restated because this module is where it
   is most tempting to break. A published quantity must be recoverable
   from observables by a stated relation with no free parameters, or
   be labelled a choice. Applied to option selling:

     MEASURED. Premium received, bid/ask spread, collateral, yield on
     collateral, breakeven, downside cushion, upside cap, open-interest
     change, and which side of the market is lifting. All of these are
     arithmetic on quoted numbers.

     A STATED CONVENTION, labelled as one. Annualization. 365/days
     simple scaling is a convention, not a forecast, and a 3-day
     contract annualized at 900% is not a claim that anyone earns 900%.
     It is carried as `annualizedIsConvention: true` so no caller can
     print it as a return.

     REFUSED. Probability of assignment, expected value, and any
     "fair" premium. Each needs a distribution, which needs a risk-free
     rate and a dividend yield, which are two free parameters this
     project does not get to choose quietly. The vendor gives delta
     only per EXPIRY (/greeks, call_delta and put_delta), never per
     contract, so there is no observable to borrow instead.

   What replaces the refused probability is `cushionSigmas`: the move
   to breakeven divided by the move the option's own implied vol prices
   over its own remaining life. It is a ratio of two quoted numbers, so
   it clears the bar. It is NOT a probability and must never be printed
   as one — a 1.5-sigma cushion says the market prices this strike 1.5
   of its own implied moves away, and says nothing about the odds.

   The vendor's option_symbol strike is DIVIDED by 1000, not multiplied.
   The spec documents both, in two places, in the same regex. The
   example object settles it: UVIX240920C00025000 is a $25.00 strike on
   a volatility ETF that trades in the teens, not a $25,000 one.
   ============================================================= */

/** UW returns numbers as JSON strings. Parse defensively; null, never NaN. */
export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/* One contract is 100 shares. Named because a bare 100 in a premium
   formula reads like a percentage and has been mistaken for one. */
export const SHARES_PER_CONTRACT = 100;

/* Annualization convention: simple, 365 calendar days. Not compounded,
   because compounding a 3-day premium 121 times is a claim about
   reinvestment nobody made. */
export const DAYS_PER_YEAR = 365;

/* =============================================================
   OPTION SYMBOL

   ^(?<symbol>[\w]*)(?<expiry>\d{6})(?<type>[PC])(?<strike>\d{8})$

   The strike's eight digits carry three implied decimals.
   ============================================================= */
const OPTION_SYMBOL_RE = /^([A-Z0-9]+)(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;

/** Parse an OCC-style option_symbol. Returns null on anything unexpected —
 *  a symbol this does not recognise is dropped from the chain rather than
 *  guessed at, because a misparsed strike prices a trade that does not exist. */
export function parseOptionSymbol(symbol) {
  if (typeof symbol !== "string") return null;
  const m = OPTION_SYMBOL_RE.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  const [, ticker, yy, mm, dd, type, strikeDigits] = m;
  const month = Number(mm), day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strikeDigits) / 1000;
  if (!(strike > 0)) return null;
  /* Two-digit years are unambiguous here for the same reason they are on a
     listed chain: options are not written 75 years out. 20xx always. */
  return { ticker, expiry: `20${yy}-${mm}-${dd}`, type, strike };
}

/** Whole calendar days from `asOf` to `expiry`, or null if either is unusable.
 *  Calendar rather than trading days: the premium decays over weekends too,
 *  and the annualization convention above is stated in calendar days. */
export function daysToExpiry(expiry, asOf) {
  const a = Date.parse(String(asOf).slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(String(expiry).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/* =============================================================
   IMPLIED VOL UNITS

   `iv_rank` on this vendor is 0-100 while its own schema calls it a
   fraction, and a card nearly shipped saying a name sat at "1352% of
   its year". `implied_volatility` carries the same ambiguity and the
   same cost: get it wrong by 100x and every cushion is off by 100x.

   The decision is made ONCE PER CHAIN, from the median, never per
   contract. A single contract at 0.42 is genuinely ambiguous — 42%
   as a fraction, or 0.42% as a percent. Five hundred contracts whose
   median is 0.42 are a decimal chain, and whose median is 42 are a
   percent chain. The population resolves what the individual cannot.
   ============================================================= */

/** Median of the finite values, or null. */
function median(values) {
  const ok = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!ok.length) return null;
  const mid = ok.length >> 1;
  return ok.length % 2 ? ok[mid] : (ok[mid - 1] + ok[mid]) / 2;
}

/** Decide the whole chain's IV convention from its median.
 *  Returns { divisor, basis } — basis names the evidence so the answer is
 *  auditable rather than a constant someone has to trust. */
/* A decimal chain's median lands in roughly [0.05, 2.0]; a percent chain's in
   [5, 200]. The gap between them is wide and nothing real sits in it, so the
   threshold does not have to be delicate.

   IT IS A NAMED CONSTANT BECAUSE IT HAS TWO USERS. ivConvention() decides the
   divisor with it; ivSurface() below re-tests the ALREADY-DIVIDED values with
   it as a tripwire, and refuses to draw a surface whose numbers still read as
   percent. Two bare 5s in two files is how one of them gets tuned and the
   other silently disagrees — at which point the tripwire stops tripping and
   the failure it exists to catch ships. */
export const IV_PERCENT_THRESHOLD = 5;

export function ivConvention(rawValues) {
  const m = median(rawValues.map(numOrNull).filter((v) => v !== null && v > 0));
  if (m === null) return { divisor: 1, basis: "no implied vol on this chain" };
  if (m > IV_PERCENT_THRESHOLD) return { divisor: 100, basis: `median ${m.toFixed(2)} reads as percent` };
  return { divisor: 1, basis: `median ${m.toFixed(4)} reads as a fraction` };
}

/* =============================================================
   PRICING ONE SALE

   Everything below is arithmetic on the quoted bid. Selling AT THE
   BID is the conservative assumption and the only one that is
   observable: the mid is a number nobody is obliged to trade at, and
   pricing a desk off the mid quietly credits the seller with half the
   spread on every line. On a chain where spreads run 10% wide that is
   the difference between a strategy and a spreadsheet.
   ============================================================= */

/**
 * Price one contract as a SHORT position opened at the bid.
 *
 * `strategy` is "csp" (cash-secured put) or "cc" (covered call). It sets
 * what the collateral is, and therefore what the yield is a yield ON:
 *   csp — cash set aside to buy 100 shares at the strike.
 *   cc  — 100 shares already owned, valued at spot.
 * These are different denominators and a desk that mixes them is
 * comparing two different numbers under one heading.
 *
 * Returns null when the contract cannot be priced from quotes alone.
 */
export function priceSale(row, { spot, asOf, ivDivisor = 1 } = {}) {
  const parsed = parseOptionSymbol(row && row.option_symbol);
  if (!parsed) return null;
  if (!(spot > 0)) return null;

  const bid = numOrNull(row.nbbo_bid);
  const ask = numOrNull(row.nbbo_ask);
  /* A zero or absent bid is not a cheap sale, it is NO sale: there is nobody
     to sell to. Dropping these is why the board cannot rank a phantom line
     first. A crossed book (ask below bid) is stale data, not an arbitrage. */
  if (bid === null || !(bid > 0)) return null;
  if (ask === null || !(ask >= bid)) return null;

  const strategy = parsed.type === "P" ? "csp" : "cc";
  const days = daysToExpiry(parsed.expiry, asOf);
  if (days === null || days < 0) return null;

  const premium = bid * SHARES_PER_CONTRACT;
  const mid = (bid + ask) / 2;
  const spread = mid > 0 ? (ask - bid) / mid : null;

  const collateral = strategy === "csp"
    ? parsed.strike * SHARES_PER_CONTRACT
    : spot * SHARES_PER_CONTRACT;
  const yieldOnCollateral = collateral > 0 ? premium / collateral : null;

  /* Annualized is a CONVENTION (365/days, simple). Flagged, never a return.
     Undefined at 0 DTE rather than infinite: a contract expiring today has
     no annual anything. */
  const annualized = yieldOnCollateral !== null && days > 0
    ? yieldOnCollateral * (DAYS_PER_YEAR / days)
    : null;

  /* BREAKEVEN, and it means a different thing per strategy.
       csp — the effective purchase price if assigned: you buy at the strike
             but keep the premium, so your basis is strike - bid.
       cc  — the price below which the shares you already own have lost more
             than the premium covers: spot - bid. */
  const breakeven = strategy === "csp" ? parsed.strike - bid : spot - bid;

  /* The move to breakeven, in units of the move THIS option's own implied
     vol prices over its OWN remaining life. A ratio of two quoted numbers,
     so it clears the identification bar. It is not a probability.

     BUT THE VOL IS A FILL, NOT A QUOTE. The vendor's schema names this field
     `Option Contract Last Transaction IV` and describes it as "the implied
     volatility for the last transaction". On a contract that last traded four
     sessions ago it is a four-session-old number, and a cushion computed from
     it is that stale too — rendered, until now, in the same typeface as a
     cushion on a line that traded twenty thousand times this morning.

     Today's volume dates it, and the desk was already parsing volume and
     throwing it away. `ivTraded` is that evidence, carried so the renderer can
     mark the cell. The cushion is NOT withheld when the vol is old: it is
     still the best available reading and withholding it would be a worse lie
     than showing it unqualified. It is qualified instead. */
  const ivRaw = numOrNull(row.implied_volatility);
  const iv = ivRaw !== null && ivRaw > 0 ? ivRaw / ivDivisor : null;
  const sigma = iv !== null && days > 0 ? iv * Math.sqrt(days / DAYS_PER_YEAR) : null;
  const logToBreakeven = breakeven > 0 ? Math.log(spot / breakeven) : null;
  const cushionSigmas = sigma !== null && sigma > 0 && logToBreakeven !== null
    ? logToBreakeven / sigma
    : null;

  /* A covered call gives up the upside above the strike. That cap is the
     real cost of the premium and it is missing from every "highest yield"
     screen: capSigmas is how far the market must run, in its own implied
     moves, before the sale starts costing more than it paid. */
  const capSigmas = strategy === "cc" && sigma !== null && sigma > 0 && parsed.strike > 0
    ? Math.log(parsed.strike / spot) / sigma
    : null;
  const assignedReturn = strategy === "cc"
    ? (parsed.strike - spot + bid) / spot
    : null;

  const oi = numOrNull(row.open_interest);
  const prevOi = numOrNull(row.prev_oi);

  return {
    symbol: row.option_symbol,
    ticker: parsed.ticker,
    expiry: parsed.expiry,
    type: parsed.type,
    strike: parsed.strike,
    strategy,
    days,
    bid, ask, mid, spread,
    premium,
    collateral,
    yieldOnCollateral,
    annualized,
    annualizedIsConvention: true,
    breakeven,
    cushionSigmas,
    capSigmas,
    assignedReturn,
    moneyness: parsed.strike / spot - 1,
    iv,
    /* Did this contract trade today? If so the IV above is today's fill. If
       not, it is the last one, of unknown age. null when volume is absent
       rather than false, because "no volume field" and "zero volume" are
       different facts. */
    ivTraded: (() => {
      const v = numOrNull(row.volume);
      return v === null ? null : v > 0;
    })(),
    oi,
    oiChange: oi !== null && prevOi !== null ? oi - prevOi : null,
    volume: numOrNull(row.volume),
    /* WHO IS LIFTING. Selling into demand and selling into a bid that is
       backing away are the same premium and not the same trade. These come
       from the chain response directly; nothing is inferred. */
    askVolume: numOrNull(row.ask_volume),
    bidVolume: numOrNull(row.bid_volume),
  };
}

/* =============================================================
   RANKING A CHAIN

   "Show me the highest premium I can get" has an answer that is
   always wrong if taken literally, and it is wrong in two different
   directions depending on which number you sort by:

     Sort by PREMIUM DOLLARS and the top of the list is whatever is
     deepest in the money and furthest out in time. Of course it pays
     the most; it is the biggest position. It is not the best sale.

     Sort by ANNUALIZED YIELD and the top of the list is a far
     out-of-the-money contract expiring in two days, quoted 0.01 bid
     0.30 ask, with eleven contracts of open interest. The 900%
     annualized number is arithmetic on a bid nobody will hit.

   So the gates below are not decoration, they are what makes the
   ranking mean anything. Every one of them is REPORTED: a screen that
   silently drops 90% of a chain and shows a clean top ten is lying by
   omission about how thin the real opportunity set is.
   ============================================================= */

/* =============================================================
   ADJUSTED CONTRACTS CANNOT BE PRICED, so they are not priced.

   Every dollar on this desk multiplies by 100 — premium, collateral,
   breakeven, and everything derived from them. That multiplier is the
   standard deliverable, and it is NOT universal: after a split, a
   merger or a special dividend, the OCC issues an adjusted series
   whose contract may deliver a different share count, or shares plus
   cash. Those series carry a suffixed root — AAPL1, AAPL2 — while the
   ordinary ones carry the bare ticker.

   The vendor exposes no deliverable field and no shares-per-contract,
   so an adjusted contract's economics are not recoverable from this
   response at all. Multiplying it by 100 anyway would put a
   confidently wrong dollar figure in every money column of that row,
   and nothing on the page could reveal it.

   So the root is compared against the ticker that was ASKED FOR, and
   a mismatch is excluded and counted like any other gate. Dropping a
   row the desk cannot price is the small cost; the alternative is
   pricing it wrongly, which is not a cost the reader can see.
   ============================================================= */

export const DEFAULT_GATES = Object.freeze({
  /* Wider than this and the bid is not a price, it is a placeholder. 15% of
     mid is loose for SPY and tight for a $3 biotech; it is a starting gate,
     reported so it can be argued with. */
  maxSpread: 0.15,
  /* Open interest is the closest thing to proof somebody else has traded
     this line. Volume alone can be one print. */
  minOi: 100,
  /* Below five dollars a contract the premium is smaller than the round
     trip, whatever the annualized number says. */
  minPremium: 5,
  minDays: 1,
  maxDays: 400,
});

export const RANK_KEYS = Object.freeze(["annualized", "premium", "yieldOnCollateral", "cushionSigmas"]);

/**
 * Price and rank a whole chain response.
 *
 * Returns { rows, gated, screened, priced, ivBasis, rankedBy } where `gated`
 * counts every exclusion by reason and `screened` is how many contracts the
 * vendor sent. rows.length / screened is the honest headline: how much of
 * this chain is actually sellable.
 *
 * EACH CONTRACT IS CHARGED TO THE FIRST GATE IT FAILS, not to every gate it
 * would fail. That is what makes the counts reconcile — excluded + priced ===
 * screened, which the tests assert — but it means the reasons are a partition
 * and not a tally: the lottery ticket below is counted once under `premium`
 * even though its spread and its open interest are both hopeless too. Read
 * "900 too wide" as "900 whose FIRST disqualification was the spread", never
 * as "900 whose spread is the only problem".
 */
export function rankChain(contracts, {
  spot, asOf, gates = {}, rankBy = "annualized", limit = 120, strategy = "both",
  ticker = null,
} = {}) {
  const g = { ...DEFAULT_GATES, ...gates };
  const list = Array.isArray(contracts) ? contracts : [];
  const { divisor, basis } = ivConvention(list.map((r) => r && r.implied_volatility));

  const gated = {
    unpriceable: 0, nonStandard: 0, spread: 0, openInterest: 0,
    premium: 0, expiry: 0, strategy: 0,
  };
  /* Only checkable when the caller says what it asked for. No ticker, no
     check — asserted rather than assumed, because a silent skip here is the
     same wrong number arriving by a different route. */
  const want = typeof ticker === "string" && ticker ? ticker.trim().toUpperCase() : null;
  const rows = [];
  /* THE SURFACE IS TAKEN BEFORE THE SALE GATES, and that is the whole reason
     it is collected here rather than rebuilt in the page from the ranked rows.

     Every gate below is a statement about whether a contract is worth SELLING
     — the spread is too wide to get filled, the open interest says nobody else
     is in it, the premium is smaller than the round trip, the tenor is outside
     the window, the strategy toggle is on the other side. None of them is a
     statement about whether the vol printed on that contract is real, and they
     fall hardest on exactly the wings a smile is read for. A surface drawn
     from the survivors would show a skew with both its tails cut off and no
     sign that they had been, which is a smile-shaped lie.

     The one exclusion the surface DOES inherit is priceSale() returning null,
     which needs a two-sided quote, and the adjusted-series check below, whose
     strike is struck against an unknown deliverable and is therefore not a
     moneyness at all. Both are stated on the page. */
  const forSurface = [];

  for (const raw of list) {
    const p = priceSale(raw, { spot, asOf, ivDivisor: divisor });
    if (!p) { gated.unpriceable++; continue; }
    /* An adjusted series — AAPL1 against a request for AAPL — delivers an
       unknown share count, so its every dollar figure would be fiction. */
    if (want !== null && p.ticker !== want) { gated.nonStandard++; continue; }
    forSurface.push(p);
    if (strategy !== "both" && p.strategy !== strategy) { gated.strategy++; continue; }
    if (p.days < g.minDays || p.days > g.maxDays) { gated.expiry++; continue; }
    if (p.premium < g.minPremium) { gated.premium++; continue; }
    if (p.oi === null || p.oi < g.minOi) { gated.openInterest++; continue; }
    if (p.spread === null || p.spread > g.maxSpread) { gated.spread++; continue; }
    rows.push(p);
  }

  const key = RANK_KEYS.includes(rankBy) ? rankBy : "annualized";
  /* Nulls sort LAST regardless of direction. A contract with no cushion
     measurement must not win a cushion ranking by virtue of having no
     number, which is what a naive descending sort on null does. */
  rows.sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });

  return {
    rows: rows.slice(0, limit),
    gated,
    screened: list.length,
    priced: rows.length,
    ivBasis: basis,
    rankedBy: key,
    gates: g,
    /* Ships with the ranking because it was already paid for: the same parse,
       the same priceSale() pass, the same per-chain IV convention. It costs no
       vendor call and no second fetch — see the module comment above. */
    ivSurface: ivSurface(forSurface, { ivBasis: basis }),
  };
}


/* =============================================================
   THE IMPLIED VOLATILITY SURFACE

   Every contract the vendor returns on /option-contracts carries an
   implied volatility next to its strike and its expiry, and until now
   priceSale() spent all of it on one scalar — the sigma underneath
   cushionSigmas and capSigmas — and threw the rest of the surface
   away. The whole strike x expiry grid was already in the response,
   already parsed, already priced. It cost nothing to keep.

   WHAT A SELLER READS OFF IT, and why a bare grid of levels does not
   answer either question:

     THE SMILE, across strikes at one expiry. Choosing between two
     strikes IS choosing between two points on a smile, and the desk
     was ranking them by premium without ever showing that the wing
     pays more because it is quoted at a higher vol.

     THE TERM STRUCTURE, at one moneyness across tenors. Whether the
     front is bid relative to the back is the difference between "this
     week is expensive" and "this name is expensive".

   These are a LEVEL and a SHAPE and they need different treatment,
   because the level swamps the shape. On a name whose front month
   trades 45 and whose January trades 26, a heatmap of raw vol paints
   the whole front column dark and the whole back column light, and
   the smile — the thing being chosen between — is invisible inside
   each column. So the two are separated and both are published:

     THE CELL'S SHADE is the contract's vol MINUS its own expiry's
     at-the-money vol. A difference of two quoted numbers on the same
     expiry, so it clears the identification bar, and it is the smile
     with the level divided out.

     THE CELL'S NUMBER is the quoted vol itself, unmodified, printed
     where the cell is wide enough to hold it.

     THE LEVEL is published separately as each expiry's at-the-money
     quote — one number per column, which read left to right IS the
     term structure.

   WHAT IS NOT HERE, and would be easy to add and wrong. No fitted
   smile, no interpolated surface, no model vol, no delta. Every one
   of those inverts or reprices an option, which needs a risk-free
   rate and a dividend yield, which are the two free parameters this
   project has refused everywhere else — the same refusal that keeps
   assignment probability, expected value and fair premium off the
   desk. A quoted implied volatility is an OBSERVABLE: the vendor
   published it, we display it and we difference it against another
   number the vendor published on the same expiry. Nothing here
   inverts anything.

   (The vendor computed those IVs with rate and dividend assumptions
   of its own that it does not disclose. That is precisely the reason
   they are only ever compared against each other, never against
   anything computed here: differences within one vendor's convention
   are meaningful, a difference across two conventions is noise.)

   AND DELTA IS NOT AVAILABLE AS A MONEYNESS AXIS. A delta-space
   surface is the better chart and cannot be drawn: this vendor gives
   delta only per EXPIRY (/greeks, call_delta and put_delta), never
   per contract. See the module header. Log-moneyness is the axis
   that IS recoverable.

   WHAT IT COSTS, MEASURED RATHER THAN ASSUMED, because this runs on
   the request path inside a 10ms Worker CPU budget. Over a synthetic
   1,010-contract chain across ten expiries: rankChain 2.27ms with the
   surface in it, of which the surface leg is 0.36ms — 16% of a pass
   that was already the expensive part of the route. It is a single
   sweep of the rows priceSale has already built, with no second parse
   and no second regex; the only sorts are over the 88 shaded cells
   and the ten distinct expiries, never over the chain. It serialises
   to about 15KB, alongside a rows array that is already larger.

   ZERO ADDITIONAL VENDOR CALLS, which is the other budget. The chain
   route opens four of its six permitted simultaneous connections and
   this adds none: every number here was in the response the desk had
   already paid for.
   ============================================================= */

/* Columns. Eight expiries is what the gamma surface windows to and it is
   the same reason: past that the labels collide and the reader is scanning
   rather than reading. */
export const SURFACE_MAX_EXPIRIES = 8;

/* Rows. Odd, so that the at-the-money band is a row rather than a boundary
   between two — a smile is read for its symmetry about that row, and a grid
   with no centre row makes the reader interpolate one. */
export const SURFACE_MAX_ROWS = 17;

/* The ladder of row widths, in log-moneyness. A STATED LADDER RATHER THAN AN
   ARBITRARY DIVISION: rows whose width is (range / 17) are a different width
   on every symbol and every session, so the same reader comparing AAPL to
   NVDA is comparing two different axes without being told. These are round
   numbers a person can hold — half a percent, one, two, two and a half, five,
   ten — and the surface says which one it used. */
export const SURFACE_ROW_STEPS = Object.freeze([0.005, 0.01, 0.02, 0.025, 0.05, 0.10]);

/* HOW FAR FROM THE MONEY A CONTRACT MAY BE AND STILL BE CALLED THE LEVEL.
   This is a CHOICE and it is labelled as one. The at-the-money quote is what
   every cell in its column is measured against, so it has to actually be at
   the money: on a thin chain the nearest contract that traded today can be
   30% out, and calling that "the level" would tilt an entire column's smile
   by the amount of its own skew. Past this band the expiry gets NO level and
   its column carries no shade — the vols are still printed, because they were
   still quoted. */
export const ATM_BAND_LOG = 0.10;

/* The shade scale is capped at a high quantile of |skew| rather than at the
   maximum, for the reason the gamma surface caps its colour: one 90-vol
   lottery ticket on the far wing otherwise compresses every real reading into
   the bottom eighth of the scale. Cells past the cap are marked, not
   flattened silently. The floor stops a genuinely flat surface — every strike
   within a vol point of the money — from being amplified into a dramatic
   picture of nothing. */
export const SKEW_CAP_QUANTILE = 0.9;
export const SKEW_CAP_FLOOR = 0.01;

/** Row index for a log-moneyness, symmetric about zero.
 *
 *  Math.round() alone rounds ties toward +Infinity, so -6.5 lands on -6 while
 *  +6.5 lands on +7 — a half-row bias applied to one wing of a smile and not
 *  the other, on a chart whose entire purpose is comparing the two wings. The
 *  magnitude is rounded and the sign reapplied instead. */
function rowOf(m, step) {
  const k = Math.round(Math.abs(m) / step);
  return m < 0 ? -k : k;
}

/**
 * Build the strike x expiry implied-volatility surface for one chain.
 *
 * `priced` is priceSale() output — NOT raw vendor rows. That is load-bearing
 * rather than a convenience: a priced row's `iv` has already been through
 * ivConvention()'s per-chain divisor, and a raw row's `implied_volatility` has
 * not. This function reads `iv` and no raw field at all, so handing it raw
 * rows produces an EMPTY surface rather than one that is 100x off on the
 * symbols where the vendor happens to quote percent and correct on the rest —
 * which is the worst available failure, because it renders perfectly.
 *
 * The tripwire below catches the other direction: values that reached here
 * still on a percent scale, whatever route they took.
 */
export function ivSurface(priced, {
  maxExpiries = SURFACE_MAX_EXPIRIES,
  maxRows = SURFACE_MAX_ROWS,
  ivBasis = null,
} = {}) {
  const empty = (reason) => ({
    status: "empty", reason, ivBasis,
    expiries: [], rows: [], grid: [],
    step: null, atmBand: ATM_BAND_LOG,
    placed: 0, fresh: 0, stale: 0, unknownAge: 0, crowded: 0, levelled: 0,
    expiriesShown: 0, expiriesTotal: 0, rowsShown: 0, rowsTotal: 0,
    skewCap: null, clipped: 0,
  });

  const list = Array.isArray(priced) ? priced : [];
  const usable = [];
  for (const p of list) {
    if (!p) continue;
    const iv = numOrNull(p.iv);
    /* A CONTRACT WITH NO IMPLIED VOLATILITY IS A HOLE IN THE SURFACE, not a
       zero-vol quote. Both would draw as the palest possible cell and only one
       of them is a reading. */
    if (iv === null || !(iv > 0)) continue;
    const mn = numOrNull(p.moneyness);
    if (mn === null || !(mn > -1)) continue;
    /* LOG-MONEYNESS, ln(K/S), from the moneyness priceSale already computed:
       ln(1 + (K/S - 1)). Log rather than the raw ratio because the axis exists
       to be compared ACROSS expiries and across symbols, and only in log space
       is a strike 10% above spot the same distance from the money as one 10%
       below. It is also the space cushionSigmas already works in — that column
       divides log(spot/breakeven) by an implied move — so the page does not
       carry two different definitions of "how far out". */
    usable.push({ src: p, iv, m: Math.log1p(mn) });
  }
  if (!usable.length) return empty("no contract on this chain carries both a quoted implied volatility and a strike");

  /* THE TRIPWIRE. ivConvention() decided this chain's divisor once, from its
     median, and priceSale() applied it. If what arrives here still reads as a
     percent chain then the convention did not run, or ran on a different set
     of numbers than these — and the consequence is not a wobble, it is every
     vol on the page off by exactly 100x. Silence is not an option and neither
     is drawing it: a surface labelled 3000% is at least visibly wrong, but a
     surface where the SHADES are right and only the printed numbers are wrong
     is not, and the shades are differences so they survive the scaling. */
  const med = median(usable.map((u) => u.iv));
  if (med !== null && med > IV_PERCENT_THRESHOLD) {
    return empty(`implied volatility reached the surface on a percent scale (median ${med.toFixed(2)}); ` +
      "the per-chain convention did not run, and drawing this would be wrong by 100x");
  }

  /* ---- columns: expiries, nearest first --------------------------- */
  const byExpiry = new Map();
  for (const u of usable) {
    const key = u.src.expiry;
    if (!key) continue;
    let e = byExpiry.get(key);
    if (!e) { e = { expiry: key, days: numOrNull(u.src.days), items: [] }; byExpiry.set(key, e); }
    e.items.push(u);
  }
  const allExpiries = Array.from(byExpiry.values()).sort((a, b) => {
    if (a.days !== null && b.days !== null && a.days !== b.days) return a.days - b.days;
    return a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0;
  });
  if (!allExpiries.length) return empty("no contract on this chain carries a usable expiry");

  /* WINDOWED FIRST AND LAST, THEN EVENLY. A term structure whose right-hand
     end is missing is not a term structure — dropping the tail would turn "the
     front is bid over January" into "the front is bid over October", which is
     a different and much weaker statement. So the nearest and the furthest
     expiry are always kept and the middle is thinned at an even stride. */
  let columns = allExpiries;
  if (allExpiries.length > maxExpiries) {
    const picked = new Set();
    for (let i = 0; i < maxExpiries; i++) {
      picked.add(Math.round((i * (allExpiries.length - 1)) / (maxExpiries - 1)));
    }
    columns = Array.from(picked).sort((a, b) => a - b).map((i) => allExpiries[i]);
  }

  /* ---- rows: a stated ladder over the shown columns only ---------- */
  let lo = Infinity, hi = -Infinity;
  for (const e of columns) for (const u of e.items) { if (u.m < lo) lo = u.m; if (u.m > hi) hi = u.m; }
  /* The range is taken over the SHOWN columns, not over every expiry. A single
     windowed-out two-year LEAP whose strikes run to +90% would otherwise
     stretch the row ladder around contracts that are not on the chart, and
     flatten every column that is. */

  let step = SURFACE_ROW_STEPS[SURFACE_ROW_STEPS.length - 1];
  for (const candidate of SURFACE_ROW_STEPS) {
    if (rowOf(hi, candidate) - rowOf(lo, candidate) + 1 <= maxRows) { step = candidate; break; }
  }
  let rowLo = rowOf(lo, step), rowHi = rowOf(hi, step);
  const rowsTotal = rowHi - rowLo + 1;
  /* Even the coarsest ladder step can overflow on a chain that runs from a
     deep put wing to a far call wing. The rows kept are the ones nearest the
     money, because that is where a sale is written, and the count says how
     much was cut. */
  if (rowsTotal > maxRows) {
    const half = Math.floor(maxRows / 2);
    rowLo = Math.max(rowLo, -half);
    rowHi = Math.min(rowHi, rowLo + maxRows - 1);
  }
  const rowIndices = [];
  for (let k = rowHi; k >= rowLo; k--) rowIndices.push(k);   // high strikes at the top, price-ladder order

  /* ---- the level: each expiry's at-the-money quote ---------------- */
  /* THE REFERENCE MUST HAVE TRADED TODAY, and this is the single most
     load-bearing decision in the module.

     `iv` on this vendor is the LAST TRANSACTION's implied volatility, not a
     quote — the module header and the cushion column both say so. A stale CELL
     is one number of unknown age, marked, and the reader can discount it. A
     stale REFERENCE is different in kind: every other cell in that column is
     measured against it, so one four-session-old print silently shifts a whole
     column's smile and there is no marker on any of the cells it moved. That
     is an undetectable error in an aggregate, which is exactly the class of
     thing this desk refuses.

     So: the level is the contract nearest the money that traded TODAY, and if
     there is none inside the band the expiry has NO level. `ivTraded === null`
     — the vendor sent no volume field — does not qualify either: "no evidence
     it is fresh" and "evidence it is fresh" are not the same fact, and only
     one of them may seed a reference. */
  for (const e of columns) {
    let ref = null, anyFresh = false, nearestFresh = null;
    for (const u of e.items) {
      if (u.src.ivTraded !== true) continue;
      anyFresh = true;
      if (nearestFresh === null || Math.abs(u.m) < Math.abs(nearestFresh.m)) nearestFresh = u;
      if (Math.abs(u.m) > ATM_BAND_LOG) continue;
      const closer = ref === null || Math.abs(u.m) < Math.abs(ref.m) ||
        (Math.abs(u.m) === Math.abs(ref.m) && u.src.strike < ref.src.strike);
      if (closer) ref = u;
    }
    e.atmIv = ref ? ref.iv : null;
    e.atmM = ref ? ref.m : null;
    e.atmStrike = ref ? ref.src.strike : null;
    e.atmType = ref ? ref.src.type : null;
    e.atmReason = ref ? null
      : !anyFresh
        ? "nothing on this expiry traded today, so it has no level this surface will vouch for"
        : `the nearest contract that traded today is ${(Math.abs(nearestFresh.m) * 100).toFixed(1)}% ` +
          `from the money, outside the ${(ATM_BAND_LOG * 100).toFixed(0)}% band an at-the-money quote may sit in`;
    e.fresh = 0; e.stale = 0; e.unknownAge = 0;
  }

  /* ---- cells ------------------------------------------------------ */
  const grid = rowIndices.map(() => columns.map(() => null));
  const rowAt = new Map();
  rowIndices.forEach((k, i) => rowAt.set(k, i));

  let placed = 0, fresh = 0, stale = 0, unknownAge = 0, crowded = 0, dropped = 0;
  columns.forEach((e, col) => {
    for (const u of e.items) {
      const k = rowOf(u.m, step);
      const rowIdx = rowAt.get(k);
      if (rowIdx === undefined) { dropped++; continue; }
      const centre = k * step;
      const held = grid[rowIdx][col];
      if (held === null) {
        grid[rowIdx][col] = { pick: u, crowd: 1 };
        continue;
      }
      /* TWO CONTRACTS IN ONE ROW OF ONE COLUMN. Adjacent strikes land in the
         same band whenever the ladder is finer than the row width, and near
         the money an out-of-the-money put and an out-of-the-money call are
         both there at once.

         THE CELL IS NOT AN AVERAGE. Averaging two quoted vols produces a
         number nobody quoted, on a page whose whole discipline is that every
         published figure is recoverable from an observable. One of the two is
         SHOWN and the cell says it was crowded — freshness first, because a
         print from today a third of a row off centre beats a print of unknown
         age dead on it, then distance from the row's centre, then the lower
         strike so the answer does not depend on the vendor's ordering. */
      held.crowd++;
      crowded++;
      const a = u, b = held.pick;
      const af = a.src.ivTraded === true, bf = b.src.ivTraded === true;
      let better;
      if (af !== bf) better = af;
      else {
        const ad = Math.abs(a.m - centre), bd = Math.abs(b.m - centre);
        better = ad !== bd ? ad < bd : a.src.strike < b.src.strike;
      }
      if (better) held.pick = a;
    }
  });

  const skews = [];
  grid.forEach((row) => {
    row.forEach((slot, col) => {
      if (slot === null) return;
      const u = slot.pick, e = columns[col];
      const traded = u.src.ivTraded === true ? true : u.src.ivTraded === false ? false : null;
      if (traded === true) { fresh++; e.fresh++; }
      else if (traded === false) { stale++; e.stale++; }
      else { unknownAge++; e.unknownAge++; }
      placed++;
      const skew = e.atmIv !== null ? u.iv - e.atmIv : null;
      if (skew !== null) skews.push(Math.abs(skew));
      row[col] = {
        iv: u.iv,
        skew,
        m: u.m,
        strike: u.src.strike,
        type: u.src.type,
        expiry: e.expiry,
        traded,
        volume: numOrNull(u.src.volume),
        oi: numOrNull(u.src.oi),
        crowd: slot.crowd,
      };
    });
  });

  /* The cap, from a quantile of what is actually on the chart. */
  let skewCap = null, clipped = 0;
  if (skews.length) {
    const sorted = skews.slice().sort((a, b) => a - b);
    const at = sorted[Math.floor(SKEW_CAP_QUANTILE * (sorted.length - 1))];
    skewCap = Math.max(SKEW_CAP_FLOOR, at);
    for (const s of skews) if (s > skewCap) clipped++;
  }

  return {
    status: "ok",
    reason: null,
    /* The evidence for the units these numbers are in, carried so the answer
       is auditable rather than a scale someone has to trust. */
    ivBasis,
    step,
    atmBand: ATM_BAND_LOG,
    rows: rowIndices.map((k) => ({ k, m: k * step })),
    expiries: columns.map((e) => ({
      expiry: e.expiry, days: e.days,
      atmIv: e.atmIv, atmM: e.atmM, atmStrike: e.atmStrike, atmType: e.atmType,
      atmReason: e.atmReason,
      fresh: e.fresh, stale: e.stale, unknownAge: e.unknownAge,
    })),
    grid,
    placed, fresh, stale, unknownAge, crowded, dropped,
    levelled: columns.filter((e) => e.atmIv !== null).length,
    expiriesShown: columns.length,
    expiriesTotal: allExpiries.length,
    rowsShown: rowIndices.length,
    rowsTotal,
    skewCap, clipped,
  };
}

/* =============================================================
   EARNINGS CROSSING

   A cushion is a DIFFUSION number. cushionSigmas divides the move
   to breakeven by the move the option's own implied vol prices over
   its own remaining life, and that arithmetic assumes the underlying
   wanders. An earnings report is not a wander, and a contract that
   outlives one is a different trade from a contract that does not —
   identical premium, identical cushion, and the cushion means less on
   one of them.

   The comparison is exact and needs no model: both operands are bare
   ISO YYYY-MM-DD strings, so a lexicographic comparison IS a date
   comparison. next_earnings_date is documented `e.g. 2023-10-26` and
   parseOptionSymbol builds expiry as `20${yy}-${mm}-${dd}` from
   zero-padded captures.

   THE ANNOUNCE TIME VOCABULARY IS NOT KNOWN, and this is the fourth
   time this vendor's documentation has been the risk. /info's
   `announce_time` is declared `string` with NO enum — only the
   example "premarket". Its sibling `report_time`, on the earnings
   endpoints, documents "premarket, postmarket and unknown". So two
   fields for one concept use different words and the one read here
   documents none of them.

   The design therefore never depends on recognising the token. The
   token is consulted ONLY when the report falls exactly ON the expiry
   date, which is the one case a date comparison cannot settle:

     earnings <  expiry   ->  true   (crosses; no token needed)
     earnings >  expiry   ->  false  (does not; no token needed)
     earnings == expiry   ->  the token decides, and if it is not a
                              word this code recognises, the answer is
                              NULL rather than a guess.

   Null is a rendered state, not a silent false. Answering "no
   earnings risk" when the truth is "cannot tell" is the confident
   zero this project exists to refuse, and it points the dangerous way
   for a seller.
   ============================================================= */

/* SHAPE IS NOT VALIDITY. A regex alone accepts "2023-13-45", which is not a
   date — and because it sorts lexicographically BEFORE every real one, it read
   as "crosses" on every row. The round trip through Date rejects it: an
   out-of-range component either fails to parse or normalises to a different
   string. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isRealDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === s;
}

/* Words that place the report AFTER the session close. BOTH spellings are
   accepted because the vendor uses each of them for this concept somewhere,
   and which one `announce_time` uses is exactly what is undocumented. */
const AFTER_CLOSE = new Set(["postmarket", "afterhours", "aftermarket", "after_hours"]);
const BEFORE_OPEN = new Set(["premarket", "beforeopen", "before_open"]);

/**
 * Does a contract expiring on `expiry` outlive the next earnings report?
 *
 * Returns true, false, or null — null meaning "cannot be determined", which
 * covers a missing date, a malformed one, and a same-day report whose timing
 * is stated in a word this code does not recognise.
 */
export function crossesEarnings(expiry, earningsDate, announceTime) {
  /* SHAPE-GUARDED, not null-checked. `=== null` catches neither of the two
     shapes that actually break this: an ABSENT key makes
     `undefined < "2026-01-16"` false, so every row silently reads event-free;
     an EMPTY STRING makes `"" < "2026-01-16"` true, so every row is marked as
     crossing. Both are string comparisons that succeed and lie. */
  if (!isRealDate(expiry)) return null;
  if (!isRealDate(earningsDate)) return null;

  if (earningsDate < expiry) return true;
  if (earningsDate > expiry) return false;

  /* Exactly on the expiry date. A report before the open lands while the
     contract is still alive; one after the close lands after it settles. */
  const token = String(announceTime || "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (BEFORE_OPEN.has(token)) return true;
  if (AFTER_CLOSE.has(token)) return false;
  return null;
}

/* =============================================================
   BUYING POWER — what you can actually collect, not what a line pays

   The desk ranks by yield, which is the right way to compare two
   contracts and the wrong way to plan a session. A 3% yield on a
   $38,000 collateral requirement and a 3% yield on a $4,700 one are
   the same number and completely different trades when the capital
   is finite. "Greatest premium collectible" is the question a seller
   actually has, and it cannot be answered without knowing the size
   of the account.

   THE ARITHMETIC IS INTEGER DIVISION AND NOTHING ELSE:

     contracts = floor(buyingPower / collateral)
     collectible = contracts * premium
     deployed = contracts * collateral
     idle = buyingPower - deployed

   No free parameters, so it clears the identification bar. What it
   does NOT do is model margin, and that omission is deliberate and
   labelled rather than papered over.

   THE CASH-SECURED ASSUMPTION IS A CHOICE, AND IT IS THE CONSERVATIVE
   ONE. A cash-secured put reserves the whole strike; a broker
   offering margin will reserve far less and let the same capital
   write several times the contracts. Modelling that would need a
   broker's margin formula — Reg-T, portfolio margin, house
   requirements all differ — which is a free parameter per account.
   So this reports what CASH secures, states that it is doing so, and
   under-counts rather than over-counts. A desk that flatters the
   account is worse than one that under-promises.

   A COVERED CALL IS NOT BOUGHT WITH CASH, which makes `contracts`
   mean something different on that side: it is how many hundred-share
   lots the capital would BUY at spot, not how much cash is set aside.
   A seller who already owns the shares has a different constraint
   entirely — their limit is the position, not the account. Both are
   reported so neither is mistaken for the other.
   ============================================================= */

/** Contracts affordable, and what they collect. Null when unanswerable. */
export function sizeToBuyingPower(row, buyingPower) {
  const bp = numOrNull(buyingPower);
  if (bp === null || !(bp > 0)) return null;
  if (!row || !(row.collateral > 0) || !(row.premium > 0)) return null;

  const contracts = Math.floor(bp / row.collateral);
  const deployed = contracts * row.collateral;
  return {
    contracts,
    /* Zero contracts is a REAL ANSWER, not an absence: this line costs more
       than the account holds. It is reported rather than dropped, because
       "you cannot afford this" is exactly what a seller with $5,000 needs to
       know about a $443 stock, and silently omitting the row would leave them
       wondering where it went. */
    affordable: contracts > 0,
    collectible: contracts * row.premium,
    deployed,
    idle: bp - deployed,
    /* Yield on the capital ACTUALLY committed, which is not the line's yield
       whenever integer division leaves a remainder. */
    yieldOnDeployed: deployed > 0 ? (contracts * row.premium) / deployed : null,
  };
}

/** The same, applied across a ranked chain, plus the totals a session needs. */
export function planBuyingPower(rows, buyingPower) {
  const bp = numOrNull(buyingPower);
  const list = Array.isArray(rows) ? rows : [];
  if (bp === null || !(bp > 0)) {
    return { buyingPower: null, rows: list.map((r) => ({ ...r, sizing: null })), affordable: 0, best: null };
  }
  const out = list.map((r) => ({ ...r, sizing: sizeToBuyingPower(r, bp) }));
  const affordable = out.filter((r) => r.sizing && r.sizing.affordable);
  /* The single line that collects the most from THIS account — which is
     frequently not the highest-yielding line, and that gap is the whole
     reason this exists. */
  let best = null;
  for (const r of affordable) {
    if (best === null || r.sizing.collectible > best.sizing.collectible) best = r;
  }
  return { buyingPower: bp, rows: out, affordable: affordable.length, best };
}
