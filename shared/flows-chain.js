/* =============================================================
   flows-chain.js — the option chain, turned into card panels.

   ONE VENDOR CALL PER BOARD NAME buys the whole listed book: every
   strike, every expiry, a quote, an implied volatility, today's
   volume, open interest and its prior, and the aggressor split
   (ask_volume / bid_volume). Until now the section spent that call
   only on the on-demand premium desk, for one ticker at a time,
   and the daily board never saw a chain at all.

   Everything here is arithmetic over quoted numbers. Nothing needs
   a risk-free rate or a dividend yield, so nothing here is the
   25-delta skew, an assignment probability, or a fair value — those
   stay refused. What is published instead is stated in the units
   the vendor quotes and labelled where a choice was made.

   THE MODULE REUSES shared/flows-premium.js RATHER THAN
   REIMPLEMENTING IT. parseOptionSymbol knows the strike divisor,
   ivConvention decides percent-or-fraction once per chain, priceSale
   applies it, and ivSurface already builds the strike x expiry grid
   with its ATM rule, its crowding rule and its percent tripwire. A
   second implementation of any of those is a second answer to the
   same question.
   ============================================================= */

import {
  parseOptionSymbol, ivConvention, priceSale, ivSurface,
  SURFACE_MAX_EXPIRIES, SURFACE_MAX_ROWS,
} from "./flows-premium.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

/* ---------- the choices, named and exported ---------------------- */

/** The vendor documents `limit` on /option-contracts as maximum=500. */
export const CHAIN_PAGE_SIZE = 500;

/**
 * The wings the skew scalar is measured between: ln(K/S) = -/+ 0.10.
 *
 * A LABELLED CHOICE, and it exists because the conventional one is refused.
 * A 25-delta skew needs a delta, a delta needs a risk-free rate and a dividend
 * yield, and this project has never invented either. Fixed log-moneyness needs
 * only the strike and the spot, both quoted. It is a different quantity from
 * 25-delta skew and is never called by that name.
 */
export const SKEW_MONEYNESS = 0.10;

/**
 * How far from the target moneyness a contract may sit and still stand for it.
 *
 * NO INTERPOLATION. An interpolated wing vol is a number nobody quoted, on a
 * page whose whole discipline is that every published figure is recoverable
 * from an observable. The nearest listed strike inside this band is used, and
 * the actual moneyness it sat at is published beside the reading so a reader
 * can see how good the stand-in was.
 */
export const SKEW_TOLERANCE = 0.04;

/**
 * The nearest expiry the skew and the front ATM may be read from.
 *
 * A contract expiring tomorrow has an implied volatility dominated by the
 * hours left in it, and its wings are quoted in pennies where one tick moves
 * the vol by ten points. Seven days is far enough out that the number means
 * something about the surface rather than about the clock.
 */
export const SKEW_MIN_DAYS = 7;

/** How many expiries apart the term-structure scalar is measured. */
export const TERM_MIN_DAYS = 7;
export const TERM_FAR_DAYS = 45;

export const TOP_CONTRACTS = 10;
export const AGGRESSOR_STRIKES = 30;

const dead = (reason) => ({ status: "unavailable", reason });

/* ---------- the surface, serialised for a card ------------------- */

/**
 * ivSurface()'s grid as parallel arrays.
 *
 * An array of objects would carry the key names on every cell: 17 rows x 8
 * columns x five keys is over a thousand repeated strings in a payload with a
 * hard 100KB self-check. Four parallel matrices carry the same information at
 * a fraction of the bytes, and the renderer reads them by index like every
 * other grid in this section.
 */
export function serialiseSurface(surface) {
  if (!surface || surface.status !== "ok") {
    return { status: "unavailable", reason: (surface && surface.reason) || "no surface was built" };
  }
  const iv = [], skew = [], traded = [], strike = [];
  for (const row of surface.grid) {
    iv.push(row.map((c) => (c ? round(c.iv, 4) : null)));
    skew.push(row.map((c) => (c ? round(c.skew, 4) : null)));
    /* 1 / 0 / null, not true / false / null: three states in one byte each,
       and the third one is load-bearing — "the vendor sent no volume field"
       is not "this contract did not trade". */
    traded.push(row.map((c) => (c ? (c.traded === true ? 1 : c.traded === false ? 0 : null) : null)));
    strike.push(row.map((c) => (c ? round(c.strike, 2) : null)));
  }
  return {
    status: "ok",
    ivBasis: surface.ivBasis || null,
    step: surface.step,
    atmBand: surface.atmBand,
    rows: surface.rows.map((r) => round(r.m, 4)),
    expiries: surface.expiries.map((e) => ({
      expiry: e.expiry, days: e.days,
      atmIv: round(e.atmIv, 4),
      atmM: round(e.atmM, 4),
      atmStrike: round(e.atmStrike, 2),
      atmReason: e.atmReason,
      fresh: e.fresh, stale: e.stale, unknownAge: e.unknownAge,
    })),
    iv, skew, traded, strike,
    placed: surface.placed, fresh: surface.fresh, stale: surface.stale,
    unknownAge: surface.unknownAge, crowded: surface.crowded,
    levelled: surface.levelled,
    expiriesShown: surface.expiriesShown, expiriesTotal: surface.expiriesTotal,
    rowsShown: surface.rowsShown, rowsTotal: surface.rowsTotal,
    skewCap: round(surface.skewCap, 4), clipped: surface.clipped,
  };
}

/* ---------- the two scalars, and the term line ------------------- */

/**
 * The wing reading at one target moneyness on one expiry's contracts.
 *
 * Returns the nearest listed contract inside the tolerance band, or null.
 * FRESHNESS BREAKS TIES BEFORE DISTANCE DOES: `iv` on this vendor is the last
 * transaction's implied volatility, not a quote, so a print from today two
 * strikes off the target beats a print of unknown age sitting exactly on it.
 * The chosen contract's own age travels with the reading rather than being
 * averaged away.
 */
function wingAt(priced, targetM, tol) {
  let best = null;
  for (const p of priced) {
    const m = numOrNull(p.moneyness);
    const iv = numOrNull(p.iv);
    if (m === null || iv === null || !(iv > 0)) continue;
    const lm = Math.log1p(m);
    const d = Math.abs(lm - targetM);
    if (d > tol) continue;
    const fresh = p.ivTraded === true;
    const better = best === null
      || (fresh !== best.fresh ? fresh : d < best.d);
    if (better) best = { d, fresh, iv, m: lm, strike: p.strike, type: p.type, traded: p.ivTraded };
  }
  return best;
}

/**
 * skew, term and the front at-the-money level.
 *
 * skew = iv(ln K/S = −0.10) − iv(ln K/S = +0.10), in volatility points.
 * POSITIVE MEANS THE PUT WING IS BID OVER THE CALL WING, which is the ordinary
 * shape of an equity smile; a negative reading is the unusual one and is what
 * makes this column worth a look. It needs no at-the-money reference at all —
 * it is one quoted vol minus another.
 *
 * atmIv and term are read OFF THE SURFACE'S OWN LEVELS rather than recomputed.
 * The surface has a strict rule for what may be an at-the-money reference (a
 * contract that traded TODAY, inside a stated band) because every skew cell in
 * a column is measured against it. Computing a second at-the-money number here
 * under a looser rule would publish two answers to one question and let the
 * scalar disagree with the panel drawn directly above it.
 *
 * term = far ATM − near ATM, in volatility points, with BOTH expiries
 * published beside it: "the front is bid over January" and "the front is bid
 * over next week" are different statements and the scalar cannot tell them
 * apart on its own.
 *
 * None of the three is ever zero by default. Zero skew is a real and notable
 * reading — a symmetric smile — so manufacturing it for a name whose wings
 * were never quoted would put "perfectly symmetric" on a chain nobody quoted.
 */
export function chainScalars(pricedByExpiry, surface, {
  targetM = SKEW_MONEYNESS,
  tol = SKEW_TOLERANCE,
  minDays = SKEW_MIN_DAYS,
  termFarDays = TERM_FAR_DAYS,
} = {}) {
  const byExpiry = new Map();
  for (const e of pricedByExpiry.values()) byExpiry.set(e.expiry, e);

  /* The surface's levelled columns, nearest first — the only at-the-money
     readings this module will vouch for. */
  const levels = (surface && surface.status === "ok" ? surface.expiries : [])
    .filter((e) => e.days !== null && e.atmIv !== null)
    .sort((a, b) => a.days - b.days);
  const anyColumn = (surface && surface.status === "ok" ? surface.expiries : [])
    .filter((e) => e.days !== null)
    .sort((a, b) => a.days - b.days);

  const nearLevel = levels.find((e) => e.days >= minDays) || null;
  const farLevel = levels.find((e) => nearLevel && e.days >= Math.max(termFarDays, nearLevel.days + 1)) || null;

  /* The skew is measured on the nearest expiry past the floor that has both
     wings quoted — it does not need a level, so a column the surface could not
     level can still carry a skew. */
  let skew = null, skewBasis = null, skewExpiry = null;
  for (const col of anyColumn) {
    if (col.days < minDays) continue;
    const e = byExpiry.get(col.expiry);
    if (!e) continue;
    const put = wingAt(e.priced, -targetM, tol);
    const call = wingAt(e.priced, targetM, tol);
    if (!put || !call) continue;
    skew = put.iv - call.iv;
    skewExpiry = col;
    skewBasis = {
      expiry: col.expiry, days: col.days,
      putM: round(put.m, 4), putStrike: round(put.strike, 2), putIv: round(put.iv, 4),
      putTraded: put.traded === true ? 1 : put.traded === false ? 0 : null,
      callM: round(call.m, 4), callStrike: round(call.strike, 2), callIv: round(call.iv, 4),
      callTraded: call.traded === true ? 1 : call.traded === false ? 0 : null,
    };
    break;
  }

  const reachedFloor = anyColumn.some((e) => e.days >= minDays);
  const skewReason = skew !== null ? null
    : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
      : `no expiry past ${minDays} days had a quoted contract within ${tol} of BOTH ` +
        `ln(K/S) = −${targetM} and +${targetM}`;

  const atmIv = nearLevel ? nearLevel.atmIv : null;
  const atmReason = atmIv !== null ? null
    : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
      : "no expiry past the floor carried an at-the-money contract that traded today";

  const term = nearLevel && farLevel ? farLevel.atmIv - nearLevel.atmIv : null;
  const termReason = term !== null ? null
    : !nearLevel ? atmReason
      : `no levelled expiry reached ${termFarDays} days, so there is no far leg to difference`;

  return {
    skew: round(skew, 4),
    skewReason,
    skewBasis,
    term: round(term, 4),
    termReason,
    termBasis: term !== null
      ? { near: nearLevel.expiry, nearDays: nearLevel.days, nearAtm: round(nearLevel.atmIv, 4),
          far: farLevel.expiry, farDays: farLevel.days, farAtm: round(farLevel.atmIv, 4) }
      : null,
    atmIv: round(atmIv, 4),
    atmExpiry: nearLevel ? nearLevel.expiry : null,
    atmReason,
    relation: `skew = iv(ln K/S = −${targetM}) − iv(ln K/S = +${targetM}) on the nearest ` +
      `expiry at or past ${minDays} days carrying both wings; nearest listed strike within ` +
      `${tol} of each target, freshness before distance, no interpolation. ` +
      `+ means the put wing is bid over the call wing. ` +
      `term = at-the-money iv at the nearest levelled expiry past ${termFarDays} days ` +
      `minus the nearest past ${minDays} days, both levels the surface's own.`,
    choice: true,
  };
}


/**
 * The term structure as a line: every expiry's at-the-money level.
 *
 * Read straight off ivSurface's own per-expiry levels, so the panel and the
 * surface above it cannot disagree about what "at the money" meant.
 */
export function buildSkewTerm(surface, scalars) {
  if (!surface || surface.status !== "ok") {
    return dead((surface && surface.reason) || "no surface was built for this chain");
  }
  const points = surface.expiries.map((e) => ({
    expiry: e.expiry,
    days: e.days,
    atmIv: round(e.atmIv, 4),
    reason: e.atmIv === null ? e.atmReason : null,
  }));
  const levelled = points.filter((p) => p.atmIv !== null).length;
  return {
    status: "ok",
    points,
    levelled,
    atmBand: surface.atmBand,
    ...scalars,
  };
}

/* ---------- the tape: contracts and the aggressor ladder --------- */

/**
 * The day's most-traded contracts.
 *
 * PARSED DIRECTLY, NOT THROUGH priceSale. priceSale exists to price a SALE
 * and refuses any contract without a live bid — correct there, wrong here: a
 * far out-of-the-money call quoted 0.00 bid that traded twenty thousand times
 * this morning is the single most interesting line on the chain, and pricing
 * discipline would delete it.
 *
 * `aggr` is ask_volume - bid_volume IN CONTRACTS. It is a pure observable: the
 * vendor counts each print against the side of the book it hit. It is NOT
 * dollarised here — that would need a price basis, which is a choice, and the
 * choice belongs beside the number that used it rather than buried in a total.
 */
export function buildTopContracts(rows, { spot, ivDivisor = 1, limit = TOP_CONTRACTS } = {}) {
  const parsed = [];
  for (const row of rows || []) {
    const p = parseOptionSymbol(row && row.option_symbol);
    if (!p) continue;
    const volume = numOrNull(row.volume);
    if (volume === null || !(volume > 0)) continue;      // "did not trade" is not a top contract
    const ivRaw = numOrNull(row.implied_volatility);
    const oi = numOrNull(row.open_interest);
    const prevOi = numOrNull(row.prev_oi);
    const ask = numOrNull(row.ask_volume);
    const bid = numOrNull(row.bid_volume);
    parsed.push({
      k: round(p.strike, 2),
      expiry: p.expiry,
      cp: p.type,
      vol: volume,
      oi,
      /* Open-interest CHANGE is what stuck overnight; volume is what churned.
         A contract with huge volume and no OI change was opened and closed. */
      doi: oi !== null && prevOi !== null ? oi - prevOi : null,
      bidPx: round(numOrNull(row.nbbo_bid), 2),
      askPx: round(numOrNull(row.nbbo_ask), 2),
      iv: ivRaw !== null && ivRaw > 0 ? round(ivRaw / ivDivisor, 4) : null,
      /* null, never 0, when the vendor sent no aggressor split: "balanced"
         and "not reported" are different facts and only one is a reading. */
      aggr: ask !== null && bid !== null ? ask - bid : null,
      m: spot > 0 ? round(Math.log(p.strike / spot), 4) : null,
    });
  }
  if (!parsed.length) return dead("no contract on this chain reported volume today");
  parsed.sort((a, b) => b.vol - a.vol);
  const shown = parsed.slice(0, limit);
  return {
    status: "ok",
    rows: shown,
    shown: shown.length,
    total: parsed.length,
    aggressorReported: shown.filter((r) => r.aggr !== null).length,
    relation: "aggr = ask_volume − bid_volume, in contracts, as the vendor counted each " +
      "print against the side of the book it hit; not dollarised",
  };
}

/**
 * Net aggressor volume by strike, summed across expiries.
 *
 * The same signed-bar form the redesigned gamma panel uses, deliberately: a
 * reader who has learned to read one strike ladder can read the other. What
 * differs is what is being counted — dealer gamma there, lifted contracts
 * here — and the two disagreeing at a strike is itself the interesting case.
 *
 * A STRIKE WITH NO REPORTED SPLIT IS ABSENT, NOT ZERO. Summing only the
 * contracts that carried ask_volume and bid_volume, and publishing how many
 * did, keeps a chain the vendor reported thinly from rendering as a flat and
 * confident "no aggression anywhere".
 */
export function buildAggressor(rows, { spot, maxStrikes = AGGRESSOR_STRIKES } = {}) {
  const byStrike = new Map();
  let reported = 0, unreported = 0;
  for (const row of rows || []) {
    const p = parseOptionSymbol(row && row.option_symbol);
    if (!p) continue;
    const ask = numOrNull(row.ask_volume);
    const bid = numOrNull(row.bid_volume);
    const volume = numOrNull(row.volume) || 0;
    if (ask === null || bid === null) { if (volume > 0) unreported++; continue; }
    if (ask === 0 && bid === 0 && volume === 0) continue;   // never traded, not a data point
    reported++;
    const k = p.strike;
    if (!byStrike.has(k)) byStrike.set(k, { k, net: 0, vol: 0, calls: 0, puts: 0 });
    const cell = byStrike.get(k);
    /* A PUT LIFTED AT THE ASK IS BEARISH PRESSURE, a call lifted at the ask is
       bullish, and summing them unsigned would report a busy day as a directional
       one. The ladder counts CONTRACTS AGGRESSED, signed by what the buyer of
       that contract is long: calls positive, puts negative. */
    const signed = (ask - bid) * (p.type === "P" ? -1 : 1);
    cell.net += signed;
    cell.vol += volume;
    if (p.type === "P") cell.puts += volume; else cell.calls += volume;
  }
  if (!byStrike.size) {
    return dead(unreported
      ? `the vendor reported no aggressor split on any of the ${unreported} contracts that traded`
      : "no contract on this chain carried an aggressor split");
  }

  let ladder = [...byStrike.values()].sort((a, b) => a.k - b.k);
  const total = ladder.length;
  /* KEPT NEAREST THE MONEY, because that is where hedging happens and where
     the gamma ladder beside it is measured. The count says how much was cut. */
  if (spot > 0 && ladder.length > maxStrikes) {
    ladder = ladder
      .slice()
      .sort((a, b) => Math.abs(Math.log(a.k / spot)) - Math.abs(Math.log(b.k / spot)))
      .slice(0, maxStrikes)
      .sort((a, b) => a.k - b.k);
  } else if (ladder.length > maxStrikes) {
    ladder = ladder.slice(0, maxStrikes);
  }

  return {
    status: "ok",
    bars: ladder.map((c) => ({
      k: round(c.k, 2), net: Math.round(c.net), vol: Math.round(c.vol),
    })),
    shown: ladder.length,
    total,
    reported,
    unreported,
    relation: "net = Σ (ask_volume − bid_volume) per strike, in contracts, signed by " +
      "what the buyer is long: calls +, puts −. Contracts with no reported split are " +
      "excluded and counted, never summed as zero",
  };
}

/* ---------- the orchestrator ------------------------------------- */

/**
 * Everything one chain response becomes.
 *
 * Degradation is total and stated at every level: an unusable chain returns
 * four unavailable panels with a reason, a chain that prices but has no
 * aggressor split returns a live surface beside an unavailable ladder, and
 * nothing anywhere returns a zero it did not measure.
 */
export function buildChainPanels(chainRows, { spot, asOf } = {}) {
  const rows = Array.isArray(chainRows) ? chainRows : [];
  const truncated = rows.length >= CHAIN_PAGE_SIZE;
  if (!rows.length) {
    const reason = "the vendor returned no contracts for this symbol";
    return {
      status: "unavailable", reason, truncated: false, rowsSeen: 0,
      ivSurface: dead(reason), skewTerm: dead(reason),
      topContracts: dead(reason), aggressor: dead(reason),
      scalars: { skew: null, term: null, atmIv: null },
    };
  }
  if (!(spot > 0)) {
    const reason = "no spot price was resolved for this name, so no moneyness could be measured";
    return {
      status: "unavailable", reason, truncated, rowsSeen: rows.length,
      ivSurface: dead(reason), skewTerm: dead(reason),
      topContracts: dead(reason), aggressor: dead(reason),
      scalars: { skew: null, term: null, atmIv: null },
    };
  }

  /* ONE CONVENTION PER CHAIN, decided from its own median, exactly as the desk
     does it. A chain quoted in percent and a chain quoted as a fraction differ
     by 100x, the vendor is not consistent about which, and every number below
     is downstream of getting it right once. */
  const conv = ivConvention(rows.map((r) => numOrNull(r && r.implied_volatility)));
  const priced = [];
  for (const row of rows) {
    const p = priceSale(row, { spot, asOf, ivDivisor: conv.divisor });
    if (p) priced.push(p);
  }

  const surface = ivSurface(priced, { ivBasis: conv.basis });
  const serial = serialiseSurface(surface);

  const byExpiry = new Map();
  for (const p of priced) {
    if (!p.expiry) continue;
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, { expiry: p.expiry, days: p.days, priced: [] });
    byExpiry.get(p.expiry).priced.push(p);
  }
  const scalars = chainScalars(byExpiry, surface);

  return {
    status: "ok",
    reason: null,
    truncated,
    rowsSeen: rows.length,
    /* THE SURFACE IS BUILT FROM QUOTED CONTRACTS ONLY. priceSale refuses a
       contract with no live bid, so the grid is the sellable book rather than
       the whole chain — a selection, stated here rather than left for a reader
       to infer from a thin column. The tape panels below do NOT inherit it. */
    pricedRows: priced.length,
    ivBasis: conv.basis,
    ivSurface: serial,
    skewTerm: buildSkewTerm(serial, scalars),
    topContracts: buildTopContracts(rows, { spot, ivDivisor: conv.divisor }),
    aggressor: buildAggressor(rows, { spot }),
    scalars: { skew: scalars.skew, term: scalars.term, atmIv: scalars.atmIv },
  };
}

export { SURFACE_MAX_EXPIRIES, SURFACE_MAX_ROWS };
