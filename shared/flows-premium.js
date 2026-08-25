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
export function ivConvention(rawValues) {
  const m = median(rawValues.map(numOrNull).filter((v) => v !== null && v > 0));
  if (m === null) return { divisor: 1, basis: "no implied vol on this chain" };
  /* A decimal chain's median lands in roughly [0.05, 2.0]; a percent chain's
     in [5, 200]. The gap between them is wide and nothing real sits in it, so
     the threshold does not have to be delicate. */
  if (m > 5) return { divisor: 100, basis: `median ${m.toFixed(2)} reads as percent` };
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
} = {}) {
  const g = { ...DEFAULT_GATES, ...gates };
  const list = Array.isArray(contracts) ? contracts : [];
  const { divisor, basis } = ivConvention(list.map((r) => r && r.implied_volatility));

  const gated = { unpriceable: 0, spread: 0, openInterest: 0, premium: 0, expiry: 0, strategy: 0 };
  const rows = [];

  for (const raw of list) {
    const p = priceSale(raw, { spot, asOf, ivDivisor: divisor });
    if (!p) { gated.unpriceable++; continue; }
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
