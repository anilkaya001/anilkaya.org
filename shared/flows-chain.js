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
import { buildUnusualRows, describeOiBasis } from "./flows-unusual.js";

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

/**
 * The ceiling above which a published implied volatility is not a reading.
 *
 * ivConvention divides by 100 only when a chain's median implied vol is above
 * 5, and the surface's own percent tripwire uses the SAME threshold on a
 * subset of the same numbers — so the two do not fail independently, they fail
 * together. A chain genuinely quoting 3.5 to 4.0 as a FRACTION (a 350–400%
 * vol, which short-dated and distressed names really do print) passes both,
 * and the basis string then vouches for it in writing.
 *
 * 3.0 is 300% annualised. Above that the number goes out as unavailable with
 * its measured value named, rather than onto a board column where it would sit
 * beside ordinary 0.3s and rank first on every sort.
 */
export const ATM_IV_CEILING = 3.0;

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
 * ONE CONTRACT PER STRIKE, AND IT IS THE OUT-OF-THE-MONEY ONE.
 *
 * THIS IS THE MOST IMPORTANT FUNCTION IN THE FILE, and it exists because of a
 * decision made one layer up. The premium desk asks the vendor for
 * `maybe_otm_only`, so it has never seen more than one contract at a strike.
 * This leg deliberately does NOT pass that filter — the at-the-money contract
 * is the surface's most load-bearing input and that filter removes it — and
 * the price of that decision is a put AND a call at every single strike.
 *
 * Handed both, everything downstream breaks in the same silent way. ivSurface's
 * at-the-money tiebreak compares |moneyness| and then strike, and a put and a
 * call at one strike tie on BOTH, so first-seen wins and the whole surface
 * flips on the vendor's row order. Measured on a chain with puts at 0.40 and
 * calls at 0.25: atmIv came back 0.40 or 0.25 depending on nothing but which
 * row arrived first, and the skew — one wing minus the other — came back
 * EXACTLY ZERO, because both wings resolved to the same type. A fifteen-point
 * smile, published as "perfectly symmetric", with no reason field to say
 * otherwise. That is the confident zero this whole codebase is built to refuse.
 *
 * The fix is to choose, once, before anything measures: below spot the
 * out-of-the-money contract is the put, above spot it is the call, and those
 * are also the liquid ones — the in-the-money twin carries the same
 * information under put-call parity behind a wider spread. At the money both
 * are out of the money by no distance at all, so freshness decides and the
 * choice is stated.
 */
function preferOutOfTheMoney(priced) {
  const byKey = new Map();
  let collisions = 0;
  for (const p of priced) {
    const m = numOrNull(p.moneyness);
    if (m === null || !p.expiry || !(p.strike > 0)) continue;
    const key = p.expiry + "@" + p.strike;
    const held = byKey.get(key);
    if (!held) { byKey.set(key, p); continue; }
    collisions++;
    const lm = Math.log1p(m);
    /* Below spot the put is out of the money; above spot the call is. AT the
       money neither is, so the contract that actually traded today wins and
       a call breaks a remaining tie — a stated rule rather than an ordering
       accident. */
    const wantType = lm < 0 ? "P" : lm > 0 ? "C" : null;
    let better;
    if (wantType) better = p.type === wantType && held.type !== wantType;
    else {
      const pf = p.ivTraded === true, hf = held.ivTraded === true;
      better = pf !== hf ? pf : p.type === "C" && held.type !== "C";
    }
    if (better) byKey.set(key, p);
  }
  return { kept: [...byKey.values()], collisions };
}

/**
 * The wing reading at one target moneyness, on contracts of ONE TYPE.
 *
 * `type` is required, not optional. The skew's whole claim is "the put wing
 * against the call wing", and a function that could answer it with two puts is
 * a function that will: see preferOutOfTheMoney above for what that cost.
 * Filtering here as well as there is deliberate belt-and-braces — the
 * de-duplication makes the right type available, this makes taking it
 * structural rather than incidental.
 *
 * FRESHNESS BREAKS TIES BEFORE DISTANCE DOES: `iv` on this vendor is the last
 * transaction's implied volatility, not a quote, so a print from today two
 * strikes off the target beats a print of unknown age sitting exactly on it.
 * Distance then decides, and the lower strike settles what remains — so the
 * answer never depends on the order the vendor happened to send.
 */
function wingAt(priced, targetM, tol, type) {
  let best = null;
  for (const p of priced) {
    if (type && p.type !== type) continue;
    const m = numOrNull(p.moneyness);
    const iv = numOrNull(p.iv);
    if (m === null || iv === null || !(iv > 0)) continue;
    const lm = Math.log1p(m);
    const d = Math.abs(lm - targetM);
    if (d > tol) continue;
    const fresh = p.ivTraded === true;
    let better;
    if (best === null) better = true;
    else if (fresh !== best.fresh) better = fresh;
    else if (d !== best.d) better = d < best.d;
    else better = p.strike < best.strike;
    if (better) best = { d, fresh, iv, m: lm, strike: p.strike, type: p.type, traded: p.ivTraded };
  }
  return best;
}

/**
 * Why a wing was not found, in the three ways it can fail.
 *
 * THE REASON WAS ONE SENTENCE FOR THREE DIFFERENT PROBLEMS. When a skew came
 * back null the payload said "no expiry past 7 days quoted BOTH a put within
 * 0.04 of −0.10 and a call within 0.04 of +0.10" — true, and useless for
 * deciding what to do, because it does not say WHICH wing failed or HOW it
 * failed. A live run measured 37 of 50 names with a reading and thirteen
 * without, and there was no way to tell from the payload whether those
 * thirteen were:
 *
 *   - a strike ladder too coarse to land inside the window, which a slightly
 *     wider tolerance would fix and which costs a little accuracy;
 *   - a wing that is listed but carries no implied volatility, which a wider
 *     tolerance would NOT fix and which is a vendor-coverage fact;
 *   - a side of the chain that is simply not listed at all.
 *
 * Those are three different decisions and the first is the only one a constant
 * can address. So this reports the nearest candidate's distance and the
 * unpriced count, and the next live run settles it with numbers instead of a
 * guess. No behaviour changes here: the skew itself is unchanged, and a
 * diagnostic that altered the reading it explains would be worse than none.
 */
function wingMiss(priced, targetM, tol, type) {
  let listed = 0, unpriced = 0;
  let nearest = null, nearestM = null, nearestStrike = null;
  for (const p of priced) {
    if (type && p.type !== type) continue;
    const m = numOrNull(p.moneyness);
    if (m === null) continue;
    listed++;
    const lm = Math.log1p(m);
    const d = Math.abs(lm - targetM);
    const iv = numOrNull(p.iv);
    if (iv === null || !(iv > 0)) {
      /* INSIDE THE WINDOW AND UNPRICED is the finding that a wider tolerance
         cannot fix, so it is counted separately rather than folded into the
         distance. */
      if (d <= tol) unpriced++;
      continue;
    }
    if (nearest === null || d < nearest) {
      nearest = d; nearestM = round(lm, 4); nearestStrike = round(p.strike, 2);
    }
  }
  return { listed, unpriced, nearest: nearest === null ? null : round(nearest, 4),
    nearestM, nearestStrike };
}

/**
 * What a run's skew misses add up to, and what a wider window would buy.
 *
 * EXTRACTED SO IT CAN BE CHECKED. This lived inline in the pipeline as a log
 * line, which meant the arithmetic that will decide SKEW_TOLERANCE was the
 * one part of the diagnostic nothing tested — and a wrong count here produces
 * a confident, wrong decision about a published constant. The corpus cannot
 * reach it either: all fifty synthetic names carry a skew, so the branch
 * never runs in a dry run.
 *
 * THE THREE GROUPS DO NOT OVERLAP and every wing lands in exactly one, which
 * is the property worth asserting: a wing is unlisted, or listed-and-unpriced,
 * or has a nearest priced candidate — and only that last group is reachable by
 * widening anything. Counting a wing twice would inflate what a wider window
 * appears to buy, which is the specific way this could mislead.
 *
 * `wouldCatch` counts WINGS, not names, and says so: a name needs BOTH wings
 * inside the window, so catching four wings does not mean recovering four
 * readings. Reporting it as names would overstate the gain by up to a factor
 * of two.
 */
export function summariseSkewMisses(misses, { tolerance = SKEW_TOLERANCE } = {}) {
  const list = Array.isArray(misses) ? misses.filter(Boolean) : [];
  let unlisted = 0, unpriced = 0, inside = 0;
  const gaps = [];
  for (const m of list) {
    for (const w of [m.put, m.call]) {
      if (!w || !w.listed) { unlisted++; continue; }
      if (w.nearest === null || w.nearest === undefined) { unpriced++; continue; }
      /* A WING INSIDE THE WINDOW ON A NAME WITH NO READING is the OTHER wing's
         fault, and counting it as a near-miss would suggest a widening that
         changes nothing for this name. Tracked separately so the groups still
         partition. */
      if (w.nearest <= tolerance) { inside++; continue; }
      gaps.push(w.nearest);
    }
  }
  gaps.sort((a, b) => a - b);
  return {
    names: list.length,
    wings: list.length * 2,
    unlisted, unpriced, inside,
    outside: gaps.length,
    gaps,
    tolerance,
    /* How many WINGS a given window would reach. Never names. */
    wouldCatch: (t) => gaps.filter((g) => g <= t).length,
  };
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
    const put = wingAt(e.priced, -targetM, tol, "P");
    const call = wingAt(e.priced, targetM, tol, "C");
    if (!put || !call) continue;
    skew = put.iv - call.iv;
    skewExpiry = col;
    skewBasis = {
      expiry: col.expiry, days: col.days,
      putM: round(put.m, 4), putStrike: round(put.strike, 2), putIv: round(put.iv, 4),
      putType: put.type,
      putTraded: put.traded === true ? 1 : put.traded === false ? 0 : null,
      callM: round(call.m, 4), callStrike: round(call.strike, 2), callIv: round(call.iv, 4),
      callType: call.type,
      callTraded: call.traded === true ? 1 : call.traded === false ? 0 : null,
    };
    break;
  }

  const reachedFloor = anyColumn.some((e) => e.days >= minDays);

  /* WHERE THE MISS ACTUALLY WAS, measured on the first expiry past the floor
     — the one the loop above would have used. Reported only when the skew is
     null, because on a name that HAS a reading the basis beside it already
     says exactly which two contracts were used. */
  let skewMiss = null;
  if (skew === null && reachedFloor) {
    const col = anyColumn.find((e) => e.days >= minDays);
    const e = col ? byExpiry.get(col.expiry) : null;
    if (e) {
      skewMiss = {
        expiry: col.expiry, days: col.days,
        put: wingMiss(e.priced, -targetM, tol, "P"),
        call: wingMiss(e.priced, targetM, tol, "C"),
      };
    }
  }

  /* THE SENTENCE NAMES THE WING AND THE DISTANCE. "Both wings missing" and
     "the call wing missed by 0.003" are different findings, and only the
     second says a wider tolerance would have caught it. */
  const missClause = (side, w) => {
    if (!w) return `${side}: not measured`;
    if (!w.listed) return `${side}: no contract of that type listed on this expiry`;
    if (w.nearest === null) {
      return `${side}: ${w.listed} listed, none carrying an implied volatility`;
    }
    return `${side}: nearest priced strike ${w.nearestStrike} at ln(K/S) ${w.nearestM}, ` +
      `${w.nearest} away from the target (window is ${tol})` +
      (w.unpriced ? `, and ${w.unpriced} inside the window carried no implied volatility` : "");
  };

  const skewReason = skew !== null ? null
    : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
      : `no expiry past ${minDays} days quoted BOTH a put within ${tol} of ` +
        `ln(K/S) = −${targetM} and a call within ${tol} of +${targetM}` +
        (skewMiss
          ? `. On ${skewMiss.expiry} (${skewMiss.days}d) — ` +
            missClause("put wing", skewMiss.put) + "; " +
            missClause("call wing", skewMiss.call) +
            ". A miss inside a tick of the window is a ladder-spacing problem a wider " +
            "tolerance would fix; an unpriced wing is not, and is a fact about coverage."
          : "");

  const rawAtm = nearLevel ? nearLevel.atmIv : null;
  const overCeiling = rawAtm !== null && rawAtm > ATM_IV_CEILING;
  const atmIv = overCeiling ? null : rawAtm;
  const atmReason = atmIv !== null ? null
    : overCeiling
      ? `the at-the-money reading was ${rawAtm.toFixed(2)} (${(rawAtm * 100).toFixed(0)}% ` +
        `annualised), past the ${ATM_IV_CEILING} ceiling this module will vouch for — the ` +
        "per-chain percent convention and the surface's tripwire share one threshold and " +
        "fail together, so a chain quoting in this band is not distinguishable from a " +
        "mis-scaled one"
      : !reachedFloor ? `no listed expiry on this chain reached ${minDays} days`
        : "no expiry past the floor carried an at-the-money contract that traded today";

  /* The term difference inherits the ceiling: if either level is one this
     module will not vouch for, their difference is not one either. */
  const farOver = farLevel && farLevel.atmIv > ATM_IV_CEILING;
  const term = nearLevel && farLevel && !overCeiling && !farOver
    ? farLevel.atmIv - nearLevel.atmIv : null;
  const termReason = term !== null ? null
    : overCeiling || farOver ? atmReason || "an at-the-money level was past the stated ceiling"
      : !nearLevel ? atmReason
        : `no levelled expiry reached ${termFarDays} days, so there is no far leg to difference`;

  return {
    skew: round(skew, 4),
    skewReason,
    skewBasis,
    /* THE MISS AS NUMBERS, not only as prose. The reason string is what a
       reader sees; this is what a run can aggregate across fifty names to
       decide whether the window is one tick too narrow or the wings are
       unpriced. null whenever a skew was found. */
    skewMiss,
    term: round(term, 4),
    termReason,
    termBasis: term !== null
      ? { near: nearLevel.expiry, nearDays: nearLevel.days, nearAtm: round(nearLevel.atmIv, 4),
          far: farLevel.expiry, farDays: farLevel.days, farAtm: round(farLevel.atmIv, 4) }
      : null,
    atmIv: round(atmIv, 4),
    atmExpiry: nearLevel ? nearLevel.expiry : null,
    atmReason,
    relation: `skew = put iv(ln K/S = −${targetM}) − call iv(ln K/S = +${targetM}) on the nearest ` +
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
 * One chain's rows as {p, row} tuples, parsing only what has not been parsed.
 *
 * WHY A TUPLE AND NOT A PARALLEL ARRAY. buildChainPanels parses each contract
 * once and hands the result to four consumers. A parallel array indexed by
 * position would put the whole scheme one filter away from pricing row i with
 * row j's strike — a defect that produces a plausible chain, prices a trade
 * that does not exist, and shows up nowhere until someone checks a symbol
 * against its own strike. The parse travels WITH its row, so there is no index
 * to get wrong.
 *
 * A caller that supplies nothing gets the old behaviour exactly: every entry
 * point here still parses for itself, which is what keeps the desk route and
 * the suites that call these builders directly untouched.
 */
function asParsedPairs(rows, given) {
  if (Array.isArray(given)) return given;
  return (rows || []).map((row) => ({ p: parseOptionSymbol(row && row.option_symbol), row }));
}

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
export function buildTopContracts(rows, {
  spot, ivDivisor = 1, limit = TOP_CONTRACTS,
  /* ALREADY-PARSED {p, row} TUPLES, when the caller has them. See
     asParsedPairs: this is the same chain buildChainPanels has already walked,
     and re-running the symbol regex over it is the single largest avoidable
     cost in the chain shaper. Absent, this parses for itself. */
  parsed: given = null,
} = {}) {
  const parsed = [];
  for (const { p, row } of asParsedPairs(rows, given)) {
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
      /* THE DIFFERENCE OF THE TWO OPEN-INTEREST COUNTS THE VENDOR SENT, and
         nothing more than that. The tempting reading — "volume is what
         churned, this is what stuck, so big volume with no change was opened
         and closed" — requires the two counts to bracket the same span as the
         volume, which describeOiBasis() below TESTS and has refuted on live
         rows: open interest cannot move further across one settlement than
         the volume traded between them, and some contracts did. The vendor
         stamps neither count, so the pairing is not available to assume. */
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
export function buildAggressor(rows, {
  spot, maxStrikes = AGGRESSOR_STRIKES, parsed: given = null,
} = {}) {
  const byStrike = new Map();
  const allStrikes = new Set();
  let reported = 0, unreported = 0;
  for (const { p, row } of asParsedPairs(rows, given)) {
    if (!p) continue;
    allStrikes.add(p.strike);
    const ask = numOrNull(row.ask_volume);
    const bid = numOrNull(row.bid_volume);
    /* VOLUME IS null-OR-A-NUMBER, never `|| 0`. The coerced version summed an
       absent volume field as zero, so a strike showing 800 contracts aggressed
       could publish `vol: 0` beside it — "800 lifted, none traded", which is
       not a reading of anything. */
    const volume = numOrNull(row.volume);
    if (ask === null || bid === null) { if (volume === null || volume > 0) unreported++; continue; }
    if (ask === 0 && bid === 0 && !volume) continue;   // never traded, not a data point
    reported++;
    const k = p.strike;
    if (!byStrike.has(k)) {
      byStrike.set(k, { k, net: 0, vol: 0, volKnown: 0, volMissing: 0, calls: 0, puts: 0 });
    }
    const cell = byStrike.get(k);
    /* A PUT LIFTED AT THE ASK IS BEARISH PRESSURE, a call lifted at the ask is
       bullish, and summing them unsigned would report a busy day as a directional
       one. The ladder counts CONTRACTS AGGRESSED, signed by what the buyer of
       that contract is long: calls positive, puts negative. */
    const signed = (ask - bid) * (p.type === "P" ? -1 : 1);
    cell.net += signed;
    if (volume === null) cell.volMissing++;
    else {
      cell.vol += volume; cell.volKnown++;
      if (p.type === "P") cell.puts += volume; else cell.calls += volume;
    }
  }
  if (!byStrike.size) {
    return dead(unreported
      ? `the vendor reported no aggressor split on any of the ${unreported} contracts that traded`
      : "no contract on this chain carried an aggressor split");
  }

  let ladder = [...byStrike.values()].sort((a, b) => a.k - b.k);
  /* THE POPULATION IS THE CHAIN'S STRIKES, not the ones that happened to carry
     a split. Reporting "3 of 3" on a chain where a fourth strike traded five
     thousand contracts the vendor did not split is a completeness claim the
     data does not support. */
  const total = allStrikes.size;
  const measuredStrikes = ladder.length;
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
      k: round(c.k, 2),
      net: Math.round(c.net),
      /* null, not 0, when nothing at this strike reported a volume. */
      vol: c.volKnown ? Math.round(c.vol) : null,
      /* THE TWO WINGS, KEPT. A strike where a put and a call were each lifted
         sixty-forty nets to zero — and drawn as one number that is
         indistinguishable from a strike where nothing happened at all. The
         zero is the interesting case, and it needs its own evidence beside
         it. */
      calls: c.volKnown ? Math.round(c.calls) : null,
      puts: c.volKnown ? Math.round(c.puts) : null,
      volMissing: c.volMissing || 0,
    })),
    shown: ladder.length,
    measuredStrikes,
    total,
    strikesUnreported: Math.max(0, total - measuredStrikes),
    reported,
    unreported,
    relation: "net = Σ (ask_volume − bid_volume) per strike, in contracts, signed by " +
      "what the buyer is long: calls +, puts −. Contracts with no reported split are " +
      "excluded and counted, never summed as zero; `total` counts strikes on the chain, " +
      "not strikes that reported",
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
export function buildChainPanels(chainRows, {
  spot, asOf, ticker = null,
  /* THE EXPIRY THIS RESPONSE WAS EXPLICITLY ASKED FOR, if it was.

     Passing it is what lifts the truncation refusal below, and it lifts it
     for a reason rather than as a favour: when the vendor was asked for ONE
     expiry and returned that expiry, "the nearest expiry" is no longer being
     inferred from an arbitrary subset — it was chosen upstream, from a
     complete enumeration of the name's expiries, and the response merely
     confirms it. Identification comes from the REQUEST, not from the page. */
  requestedExpiry = null,
} = {}) {
  const all = Array.isArray(chainRows) ? chainRows : [];
  const truncated = all.length >= CHAIN_PAGE_SIZE;

  /* ADJUSTED SERIES ARE A DIFFERENT INSTRUMENT AND THEY WIN EVERY RANKING.
     After a split or a special dividend the vendor lists a second root — AAPL1
     beside AAPL — deliverable on something other than 100 shares. Its strikes
     are on the old scale, so its moneyness is nonsense against today's spot,
     and its volume ranks it first on the tape. Dropped by root, counted, and
     the count is published rather than being an invisible filter. */
  /* PARSED ONCE, HERE, AND THREADED DOWN.

     This filter used to parse every contract and throw the parse away, and so
     did priceSale, buildTopContracts, buildAggressor and buildUnusualRows
     below — five passes of OPTION_SYMBOL_RE plus five trim/upper-case copies
     over the same 500 strings, on every one of the deep names. Measured at
     0.264ms a pass over a full page, which made the four redundant passes
     about a fifth of this function.

     The pairs carry the parse WITH the row, never a parallel array indexed by
     position: a filter or a sort between here and a consumer would silently
     reindex the latter, and pricing one contract with another's strike is the
     class of defect this file already refuses in three other places. */
  const pairs = all.map((row) => ({ p: parseOptionSymbol(row && row.option_symbol), row }));
  /* Named for what it is and NOT `kept`: `kept` is already taken further down
     by preferOutOfTheMoney's surviving priced contracts, and two different
     populations under one name in one function is how a builder ends up handed
     the surface's rows where it wanted the chain's. */
  const parsedRows = ticker ? pairs.filter((x) => x.p && x.p.ticker === ticker) : pairs;
  const rows = ticker ? parsedRows.map((x) => x.row) : all;
  const foreignRows = all.length - rows.length;
  if (!rows.length) {
    const reason = foreignRows
      ? `every one of the ${foreignRows} contracts the vendor returned belongs to an ` +
        `adjusted series, not to ${ticker}`
      : "the vendor returned no contracts for this symbol";
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
  for (const pair of parsedRows) {
    const p = priceSale(pair.row, { spot, asOf, ivDivisor: conv.divisor, parsed: pair.p });
    if (p) priced.push(p);
  }

  /* ONE CONTRACT PER STRIKE BEFORE ANYTHING MEASURES. See
     preferOutOfTheMoney: without this the surface flips on vendor row order
     and the skew publishes a confident zero. */
  const { kept, collisions } = preferOutOfTheMoney(priced);

  const surface = ivSurface(kept, { ivBasis: conv.basis });
  const serial = serialiseSurface(surface);

  const byExpiry = new Map();
  for (const p of kept) {
    if (!p.expiry) continue;
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, { expiry: p.expiry, days: p.days, priced: [] });
    byExpiry.get(p.expiry).priced.push(p);
  }
  let scalars = chainScalars(byExpiry, surface);

  /* A TRUNCATED CHAIN CANNOT VOUCH FOR THE WORD "NEAREST".
     
     Every scalar's stated relation begins "on the nearest expiry" and "the
     nearest listed strike". The vendor's page ceiling is 500 contracts and the
     ticker-scoped endpoint documents NO ordering parameter — a fact this
     repository already learned once on the premium desk — so a chain that
     filled the page is an arbitrary subset, and "nearest" over an arbitrary
     subset is "nearest among whatever arrived", which is not what the relation
     says.
     
     The panels still publish: a surface built from part of a book is a stated
     partial view and the coverage says so. The SCALARS do not, because they go
     onto a board row and into an archive where nothing carries their caveat. */
  /* THE ONE CASE WHERE A FULL PAGE IS STILL IDENTIFIED.

     Verified live on 2026-08-26: /option-contracts DOES accept an `expiry`
     filter. The probe asked PEP for 2026-09-04 and got 58 rows, all of them
     that expiry. So when this response is the answer to a single-expiry
     request AND every contract in it carries that expiry, the subset is not
     arbitrary — it is the expiry that was named, and the naming happened
     against the complete expiry list from /greek-exposure/expiry.

     BOTH HALVES ARE REQUIRED. A request for one expiry that comes back
     carrying several means the filter was ignored, and then the rows are an
     arbitrary page again no matter what was asked for. Checking only the
     request would trust a parameter the vendor is free to drop — which is
     exactly the class of assumption this file has been wrong about five
     times. */
  const answersRequest = requestedExpiry !== null &&
    surface.expiries.length === 1 && surface.expiries[0].expiry === requestedExpiry;

  if (truncated && !answersRequest) {
    const why = `the vendor returned a full page of ${CHAIN_PAGE_SIZE} contracts in no ` +
      "documented order, so this is an arbitrary subset of the book and \"the nearest " +
      "expiry\" cannot be identified within it";
    scalars = {
      ...scalars,
      skew: null, skewReason: why, skewBasis: null,
      term: null, termReason: why, termBasis: null,
      atmIv: null, atmReason: why, atmExpiry: null,
    };
  }

  return {
    status: "ok",
    reason: null,
    truncated,
    /* Whether the scalars survived the truncation check, and why. A reader of
       the payload can otherwise only infer it from the scalars being present. */
    identifiedExpiry: answersRequest ? requestedExpiry : null,
    /* WHAT THE VENDOR SENT, before this file dropped anything — and it is
       published beside rowsSeen because the two are DIFFERENT POPULATIONS and
       the difference reads as a contradiction without it.

       `truncated` is decided on this number (>= CHAIN_PAGE_SIZE) and the
       refusal sentence names CHAIN_PAGE_SIZE, but `rowsSeen` is the count
       AFTER the adjusted-series filter above. So a card can honestly publish
       `truncated: true`, a note saying "a full page of 500 contracts", and
       `rowsSeen: 499` — the vendor sent 500 and one of them was an AAPL1-style
       root deliverable on something other than 100 shares. A careful reader
       who saw only 499 beside the word 500 concluded the sentence was a lie;
       it is not, and this field is what shows that in one line. */
    rowsReturned: all.length,
    /* Rows belonging to THIS ticker's root. Not "rows the vendor sent" — see
       rowsReturned above, and foreignRows for the difference. */
    rowsSeen: rows.length,
    /* THE SURFACE IS BUILT FROM QUOTED CONTRACTS ONLY. priceSale refuses a
       contract with no live bid, so the grid is the sellable book rather than
       the whole chain — a selection, stated here rather than left for a reader
       to infer from a thin column. The tape panels below do NOT inherit it. */
    pricedRows: priced.length,
    /* What the de-duplication and the root filter actually removed, published
       rather than silently applied: a surface built from half the rows the
       vendor sent is a stated selection or it is a lie of omission. */
    surfacedRows: kept.length,
    strikeCollisions: collisions,
    foreignRows,
    ivBasis: conv.basis,
    ivSurface: serial,
    skewTerm: buildSkewTerm(serial, scalars),
    topContracts: buildTopContracts(rows, { spot, ivDivisor: conv.divisor, parsed: parsedRows }),
    aggressor: buildAggressor(rows, { spot, parsed: parsedRows }),
    /* THE UNUSUAL-ACTIVITY FEED'S CONTRIBUTION FROM THIS CHAIN, built HERE
       and not by the caller, because three things it needs exist only in this
       scope and every one of them is a correctness requirement rather than a
       convenience:

         - conv.divisor, the implied-volatility convention decided once from
           THIS chain's own median. It is a local; the returned object has
           only conv.basis. A caller outside would have to re-derive it, which
           is a second answer to a question already answered.
         - `rows`, which is root-FILTERED. An adjusted series (an AAPL1 beside
           an AAPL) is deliverable on something other than 100 shares, and the
           feed multiplies by SHARES_PER_CONTRACT. That multiplication is only
           legal after this filter, and the filter's output never leaves here.
         - `truncated`, so a row can carry whether its own chain was a full
           page rather than the page carrying one flag for a mix of names.

       Not a panel: this does not go on the card. It is collected across every
       name the chain leg reached and published once, under `unusual`. */
    unusualRows: buildUnusualRows(rows, {
      ticker, spot, ivDivisor: conv.divisor, sessionDate: asOf, truncated, parsed: parsedRows,
    }),
    ivDivisor: conv.divisor,
    /* THE OPEN-INTEREST BASIS CHECK, computed here for the same reason the
       feed is: it needs the root-filtered rows, which never leave this scope.
       Pure arithmetic over rows already in memory, so running it on every
       chain costs nothing and the pipeline reports one of them. */
    oiBasis: describeOiBasis(rows),
    /* THE HORIZON TRAVELS WITH THE READING. "Nearest expiry past seven days" is
       eight days out on SPY and ninety on a thin name, so the number alone is
       not comparable across names — carrying the days is what lets anyone
       holding a board row see that, rather than having to know the rule. */
    scalars: {
      skew: scalars.skew, term: scalars.term, atmIv: scalars.atmIv,
      skewDays: scalars.skewBasis ? scalars.skewBasis.days : null,
      atmDays: scalars.termBasis ? scalars.termBasis.nearDays : null,
    },
  };
}

export { SURFACE_MAX_EXPIRIES, SURFACE_MAX_ROWS };
