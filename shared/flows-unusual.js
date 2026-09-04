/* =============================================================
   flows-unusual.js — the unusual-activity feed.

   WHAT THIS IS NOT, FIRST, BECAUSE IT DECIDES EVERYTHING ELSE.

   The recognisable Unusual Whales surface is a PER-TRADE feed:
   individual prints with a size, a timestamp, an execution price
   and a sweep flag. Its source is /api/option-trades/flow-alerts,
   and this repo's pipeline asserts that endpoint is not reachable
   on the key it holds — an assertion with no status code, no probe
   and no provenance behind it. The probe in the pipeline exists to
   settle that; this file is what can honestly be built meanwhile.

   The affordable source is the option chain the pipeline already
   buys for every board name. Those rows are CONTRACT AGGREGATES:
   one row per listed strike, carrying a volume counter, an open
   interest, a previous open interest, a two-sided quote and an
   aggressor split. There is no size, no timestamp, no execution
   price and no sweep flag anywhere in them.

   TWO REFUSALS FOLLOW, AND THEY ARE THE SPINE OF THIS FILE.

   REFUSAL 1 — THE UNIT. `volume` is every contract that changed
   hands at that strike, summed. It is not a trade. So nothing built
   here may ever say print, trade, block, sweep, order, bought, sold
   or paid, and the vocabulary is enforced by a test rather than by
   good intentions.

   REFUSAL 2 — THE DATE, and it is the load-bearing one.
   /option-contracts sends no date and accepts none. The pipeline
   runs at 05:15 America/New_York, four and a quarter hours before
   the opening bell, so AT READ TIME TODAY HAS NOT HAPPENED. The
   counter's span is therefore unobserved: it may be yesterday's
   session, it may be a running total, it may be something else. The
   pipeline already carries this doubt in writing beside the chain
   leg. So nothing here may say "today", "this session" or "the
   day's". What is published is `readAt` — when the chain was read —
   and an explicit `volumeAsOf: null` with the reason beside it.
   Attaching sessionDate to the counter would be choosing a date,
   which is a free parameter on the single most important quantity
   on the page.

   THE ONE PLACE sessionDate IS LEGAL is `dte`, and it is published
   as `dteAnchor: "sessionDate"` so a reader can see that the
   horizon is measured from the last completed session rather than
   from the counter's own unknown date or from now.
   ============================================================= */

import { parseOptionSymbol, daysToExpiry, SHARES_PER_CONTRACT } from "./flows-premium.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));

/* ---------- the labelled choices ------------------------------- */

/**
 * The floors, and why each exists.
 *
 * Both are CHOICES and are published as such. Neither is a threshold on a
 * measurement — they are the boundary of the population being ranked, which
 * is a different kind of decision and has to be visible to be argued with.
 */
export const UA_MIN_VOLUME = 250;
export const UA_MIN_OI = 100;
export const UA_ROWS = 50;
export const UA_NAMES = 40;
export const UA_PER_NAME_MIN = 2;
export const UA_PER_NAME_MAX = 8;

/**
 * How many contracts one name may contribute.
 *
 * DERIVED FROM THE BOARD SIZE, NOT FIXED, and both halves are published.
 * A fixed cap of four is unreachable at a small board — eleven names times
 * four is forty-four, against a fifty-row feed — so the page would show a
 * "shown: 50" it could never produce. Worse, the reader could not tell which
 * limit actually bit: the row cap or the per-name cap. Deriving it makes the
 * binding constraint a fact the payload states rather than one a reader has
 * to infer from two numbers that happen to be equal.
 */
export function perNameCap(namesSeen, { rows = UA_ROWS, min = UA_PER_NAME_MIN, max = UA_PER_NAME_MAX } = {}) {
  const n = Math.max(1, Math.floor(namesSeen) || 0);
  return Math.min(max, Math.max(min, Math.ceil(rows / n)));
}

/* ---------- the contract feed ---------------------------------- */

/**
 * One chain's contribution to the feed.
 *
 * CALLED FROM INSIDE buildChainPanels, and that placement is the whole
 * design rather than a convenience. Three things it needs exist only there:
 *
 *   - `ivDivisor`, decided ONCE PER CHAIN from that chain's own median. It is
 *     a local in buildChainPanels and is not on the returned object, so any
 *     caller outside would have to re-derive it — which is exactly the
 *     "second answer to the same question" this codebase keeps paying for.
 *   - the ROOT-FILTERED rows. buildChainPanels drops adjusted series (an
 *     AAPL1 beside an AAPL, deliverable on something other than 100 shares)
 *     into a local it never returns. The notional bracket below multiplies by
 *     SHARES_PER_CONTRACT, which is only legal after that filter. Computing
 *     here is what makes "reused, not reimplemented" literally true.
 *   - `truncated`, which marks a chain the vendor returned a full page for.
 *
 * @param {Array} rows — root-filtered chain rows
 * @param {object} opts — { ticker, spot, ivDivisor, sessionDate, truncated }
 */
export function buildUnusualRows(rows, {
  ticker = null, spot = null, ivDivisor = 1, sessionDate = null, truncated = false,
  minVolume = UA_MIN_VOLUME, minOi = UA_MIN_OI,
  /* ALREADY-PARSED {p, row} TUPLES from buildChainPanels, which has walked
     this same chain to build them. The feed used to re-run the option-symbol
     regex over every contract a fourth time; the tuple carries the parse with
     its own row so there is no index to misalign. Absent, this parses for
     itself, which is what every direct caller and every fixture does. */
  parsed = null,
} = {}) {
  const out = [];
  const s = numOrNull(spot);
  const div = numOrNull(ivDivisor) || 1;

  const pairs = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(rows) ? rows : []).map((row) => ({
      p: parseOptionSymbol(row && row.option_symbol), row,
    }));

  for (const { p: sym, row: raw } of pairs) {
    if (!sym) continue;

    const vol = numOrNull(raw.volume);
    const oi = numOrNull(raw.open_interest);
    /* BOTH FLOORS ARE MEMBERSHIP TESTS, NOT MEASUREMENTS. A contract with no
       volume field is not a quiet contract — it is a contract the vendor did
       not report on, and the two must not share a fate. Below the floors the
       row is simply not in the population; it is counted in `eligible` and
       nothing is claimed about it. */
    if (vol === null || oi === null) continue;
    if (vol < minVolume || oi < minOi) continue;

    /* THE RANKING KEY, and it is finite BY CONSTRUCTION rather than by a
       guard bolted on afterwards: minOi is what makes the denominator
       positive, so vor can never be Infinity and never needs a special case
       that a reader would have to trust. */
    const vor = vol / oi;

    const prevOi = numOrNull(raw.prev_oi);
    const bidPx = numOrNull(raw.nbbo_bid);
    const askPx = numOrNull(raw.nbbo_ask);
    const askVol = numOrNull(raw.ask_volume);
    const bidVol = numOrNull(raw.bid_volume);
    const rawIv = numOrNull(raw.implied_volatility);

    /* THE AGGRESSOR SHARE, over what was REPORTED and said so. The two legs
       need not sum to `volume` — the vendor reports a split for the contracts
       it classified and a total for all of them — so this is a share of the
       classified subset. Null when either leg is absent or the pair sums to
       zero, never 0.5, because "balanced" and "unreported" are different
       facts and only one of them is a reading. */
    const legs = askVol !== null && bidVol !== null ? askVol + bidVol : null;
    const lift = legs !== null && legs > 0 ? askVol / legs : null;

    out.push({
      t: ticker || sym.ticker,
      k: sym.strike,
      expiry: sym.expiry,
      cp: sym.type === "put" || sym.type === "P" ? "P" : "C",
      vol,
      oi,
      /* One settlement's change. Positive means contracts stuck between two
         settlements; it does NOT say on which side, and the page says so. */
      doi: prevOi === null ? null : oi - prevOi,
      vor: round(vor, 3),
      bidPx: round(bidPx, 2),
      askPx: round(askPx, 2),
      /* A BRACKET, NOT A PREMIUM AND NOT A BOUND. This endpoint holds no
         execution price, so vol x mid x 100 would invent one. Both ends are
         null together when either side of the quote is missing — half a
         bracket is not a narrower bracket, it is an unbounded one. */
      nlo: bidPx === null || askPx === null ? null : Math.round(vol * bidPx * SHARES_PER_CONTRACT),
      nhi: bidPx === null || askPx === null ? null : Math.round(vol * askPx * SHARES_PER_CONTRACT),
      aggr: askVol === null || bidVol === null ? null : askVol - bidVol,
      lift: round(lift, 3),
      /* PER-ROW, WITH ITS CHAIN'S CONVENTION REACHABLE IN `coverage`. This
         feed sorts contracts from many chains into one column and the divisor
         is a per-chain decision, so this number reads DOWN a name and not
         ACROSS the table. It is never a ranking key and never a chart
         channel, for exactly that reason. */
      iv: rawIv === null ? null : round(rawIv / div, 4),
      m: s !== null && s > 0 && sym.strike > 0 ? round(Math.log(sym.strike / s), 4) : null,
      dte: daysToExpiry(sym.expiry, sessionDate),
      /* This name's chain filled the vendor's page, so its contribution is an
         arbitrary subset of its own book. Carried per row because the feed
         mixes names and a page-level flag could not say which rows it applied
         to. */
      p: truncated ? 1 : 0,
    });
  }
  return out;
}

/**
 * Rank the pooled feed and apply both caps.
 *
 * TIES BROKEN BY VOLUME, AND THE PRIMARY KEY IS A CHOICE. Ranking by the
 * notional bracket ranks by contract price and puts deep in-the-money lines
 * on top; ranking by raw volume ranks by how big the name is. Both are
 * defensible and neither is THE answer, so the key is published with
 * `choice: true` beside its relation.
 */
export function rankUnusual(rows, { namesSeen = 0, cap = UA_ROWS } = {}) {
  const all = (Array.isArray(rows) ? rows : []).slice();
  const perName = perNameCap(namesSeen, { rows: cap });

  all.sort((a, b) => (b.vor - a.vor) || (b.vol - a.vol) ||
    (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const taken = new Map();
  const kept = [];
  let perNameBit = false;
  for (const row of all) {
    const n = taken.get(row.t) || 0;
    if (n >= perName) { perNameBit = true; continue; }
    taken.set(row.t, n + 1);
    kept.push(row);
    if (kept.length >= cap) break;
  }

  /* WHICH CAP ACTUALLY BIT, published rather than inferable. At a small board
     the row cap is unreachable and the per-name cap is doing all the work; at
     a large one it is the reverse. A reader looking at "shown: 44" against
     "cap: 50" cannot tell which without this. */
  return {
    rows: kept,
    shown: kept.length,
    eligible: all.length,
    cap,
    perName,
    capBound: kept.length >= cap ? "rows" : (perNameBit ? "perName" : "eligible"),
    /* WHAT `eligible` COUNTS, said here because the number is easy to misread
       on the page. It is the population AFTER the volume and open-interest
       floors — the contracts that could have been shown — not every contract
       the vendor sent. So "50 of 5,953" sits beside a coverage list whose row
       counts sum to far more than 5,953, and the two are not in conflict: the
       difference is contracts the floors excluded, about which nothing is
       claimed. A page printing both had better say so. */
    aggressorReported: kept.filter((r) => r.aggr !== null).length,
    notionalReported: kept.filter((r) => r.nlo !== null).length,
  };
}

/* ---------- the name-level surprise ---------------------------- */

/**
 * One name's volume against its own thirty-day average.
 *
 * THIS PANEL SEES THE WHOLE ELIGIBLE UNIVERSE, not the board. The contract
 * feed above can only cover names whose chain was bought — a few dozen — and
 * that is the honest ceiling of a design that spends no vendor call. This
 * panel is built from the screener rows the pipeline already holds for every
 * eligible name, which is an order of magnitude more coverage for the same
 * zero calls. It is the reason the page is not simply the board again.
 *
 * `callSurprise` and `putSurprise` come from screenerTilt, which computes
 * them with the null-on-absent-average guard. `st` is new arithmetic and is
 * labelled as such: it is null when EITHER average is missing, because the
 * numerator counts both sides and a zero on one side would inflate the ratio
 * without saying so.
 */
export function unusualNameRow(row, tilt) {
  const t = tilt || {};
  const callAvg = numOrNull(row && row.avg_30_day_call_volume);
  const putAvg = numOrNull(row && row.avg_30_day_put_volume);
  const callVol = numOrNull(row && row.call_volume);
  const putVol = numOrNull(row && row.put_volume);
  const bothAvg = callAvg !== null && putAvg !== null && callAvg > 0 && putAvg > 0;
  const bothVol = callVol !== null && putVol !== null;

  const close = numOrNull(row && row.close);
  const prev = numOrNull(row && row.prev_close);

  return {
    t: String((row && row.ticker) || ""),
    px: close !== null && close > 0 ? round(close, 2) : null,
    /* A FRACTION of the prior close, spelled exactly as moverRow and boardRow
       spell it — 0.0412 is +4.12%. No prior close means the move is UNKNOWN,
       not zero. This is the third surface to publish this quantity and all
       three had better agree on both the name and the units. */
    chg: prev !== null && prev > 0 && close !== null && close > 0
      ? round((close - prev) / prev, 5) : null,
    sc: round(numOrNull(t.callSurprise), 3),
    sp: round(numOrNull(t.putSurprise), 3),
    st: bothAvg && bothVol ? round((callVol + putVol) / (callAvg + putAvg), 3) : null,
    putCallRatio: round(numOrNull(t.putCallRatio), 3),
    relVolume: round(numOrNull(t.relVolume), 2),
  };
}

/** Rank names by combined surprise, refusing to rank a name that has none. */
export function rankUnusualNames(withTilt, { cap = UA_NAMES } = {}) {
  const rows = [];
  for (const entry of Array.isArray(withTilt) ? withTilt : []) {
    if (!entry || !entry.row) continue;
    const r = unusualNameRow(entry.row, entry.tilt);
    if (!r.t) continue;
    rows.push(r);
  }
  /* A NAME WITH NO MEASURED SURPRISE IS NOT A NAME WITH A SURPRISE OF ZERO,
     and it must not be ranked as one. It is counted in `unranked` and left
     out of the ordering — the same discipline the watch list applies. */
  const ranked = rows.filter((r) => r.st !== null);
  ranked.sort((a, b) => (b.st - a.st) || (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return {
    rows: ranked.slice(0, cap),
    shown: Math.min(ranked.length, cap),
    ranked: ranked.length,
    universe: rows.length,
    unranked: rows.length - ranked.length,
    cap,
  };
}

/* ---------- the two diagnostics -------------------------------- */

/**
 * What the flow-alerts endpoint actually answered.
 *
 * TWELVE OUTCOMES, AND THE COUNT IS THE POINT. This probe exists to
 * write a permanent answer into a comment that has asserted for months, with
 * no evidence, that the endpoint is unreachable on this key. An answer that
 * collapses "throttled" into "refused" would write the wrong permanent
 * answer, which is worse than having none — the assertion would then have
 * provenance and still be wrong.
 */
export function describeFlowAlerts(result) {
  const r = result || {};
  if (r.dryRun) {
    return { verdict: "not-probed",
      line: "flow-alerts: not probed — this was a dry run." };
  }
  if (r.network || r.status === -1) {
    return { verdict: "network",
      line: `flow-alerts: the request never completed (${r.raw || "no message"}). ` +
        "This is NOT a refusal and settles nothing." };
  }
  const status = Number(r.status);
  if (status === 429) {
    return { verdict: "throttled",
      line: "flow-alerts: 429. THROTTLED, NOT REFUSED — the question is still " +
        "unanswered and the assertion in the pipeline must not be touched on this." };
  }
  if (status === 401 || status === 403) {
    return { verdict: "refused",
      line: `flow-alerts: ${status}. The key does not carry this endpoint, and that ` +
        `claim now has provenance. Body: ${String(r.raw || "").slice(0, 200)}` };
  }
  if (status === 404) {
    return { verdict: "not-found",
      line: "flow-alerts: 404. The PATH is wrong, which is not the same as the key " +
        "being refused — the market-wide spelling is a guess. Try the per-ticker " +
        "sibling /api/stock/{t}/flow-alerts in a later run." };
  }
  if (status === 400 || status === 422) {
    return { verdict: "bad-request",
      line: `flow-alerts: ${status}. The request SHAPE is wrong, not the key. ` +
        `Body: ${String(r.raw || "").slice(0, 200)}` };
  }
  if (status !== 200) {
    return { verdict: "other",
      line: `flow-alerts: HTTP ${status}, which is none of the outcomes this probe ` +
        `anticipates. Body: ${String(r.raw || "").slice(0, 200)}` };
  }
  if (r.parsed === false) {
    return { verdict: "unparsable",
      line: `flow-alerts: 200 but the body is not JSON. Raw: ${String(r.raw || "").slice(0, 200)}` };
  }
  const body = r.body;
  const keys = (o) => Object.keys(o || {}).slice(0, 24).join(", ");
  if (Array.isArray(body)) {
    return body.length
      ? { verdict: "reachable",
          line: `flow-alerts: REACHABLE — 200 with a bare array of ${body.length}. ` +
            `First row keys: ${keys(body[0])}` }
      : { verdict: "empty",
          line: "flow-alerts: 200 with an empty array. Accepted and empty, which is " +
            "neither reachable-with-data nor refused." };
  }
  if (body && Array.isArray(body.data)) {
    return body.data.length
      ? { verdict: "reachable",
          line: `flow-alerts: REACHABLE — 200 with {data:[${body.data.length}]}; uw() ` +
            `would have worked. First row keys: ${keys(body.data[0])}` }
      : { verdict: "empty",
          line: "flow-alerts: 200 with an empty {data:[]}. Accepted and empty." };
  }
  if (body && typeof body === "object") {
    const arrayKey = Object.keys(body).find((k) => Array.isArray(body[k]));
    if (arrayKey) {
      return { verdict: "reachable-other-shape",
        line: `flow-alerts: REACHABLE, but under key "${arrayKey}" — uw() would have ` +
          `silently returned [] for this body. Top-level keys: ${keys(body)}` };
    }
    return { verdict: "unknown-shape",
      line: `flow-alerts: 200 with an object carrying no array. Top-level keys: ${keys(body)}` };
  }
  return { verdict: "unknown-shape",
    line: "flow-alerts: 200 with a body that is neither an array nor an object." };
}

/**
 * Whether open interest and volume can be describing the same span.
 *
 * THE ZERO BRANCH IS INCONCLUSIVE AND SAYS SO, which is the whole reason this
 * function is worth writing carefully. Open interest cannot move further
 * across one settlement than the volume traded between those settlements. So
 * finding any contract where it did FALSIFIES the hypothesis that the pair
 * and the counter are aligned in time. Finding none proves nothing: it is
 * equally consistent with an intraday-updated denominator, with an aligned
 * same-session pair, and with an ordinary quiet stretch.
 *
 * Writing the zero branch as evidence would be a confident inference from a
 * measurement that does not entail it — the exact failure mode the rest of
 * this file exists to prevent.
 */
export function describeOiBasis(rows, { minVolume = UA_MIN_VOLUME, dryRun = false } = {}) {
  let seen = 0, exceeded = 0;
  for (const raw of Array.isArray(rows) ? rows : []) {
    const vol = numOrNull(raw && raw.volume);
    const oi = numOrNull(raw && raw.open_interest);
    const prev = numOrNull(raw && raw.prev_oi);
    if (vol === null || oi === null || prev === null) continue;
    if (vol < minVolume) continue;
    seen++;
    if (Math.abs(oi - prev) > vol) exceeded++;
  }
  const tag = dryRun ? "[dry-run] " : "";
  if (!seen) {
    return { seen: 0, exceeded: 0, exceedShare: null, verdict: "no-data",
      line: `${tag}oi basis: no contract carried volume, open interest and a previous ` +
        "open interest together, so nothing could be checked." };
  }
  const share = exceeded / seen;
  if (exceeded > 0) {
    return { seen, exceeded, exceedShare: round(share, 4), verdict: "falsified",
      line: `${tag}oi basis: ${exceeded} of ${seen} contracts showed an open-interest ` +
        `change LARGER than their own volume. Open interest cannot move further across ` +
        `one settlement than the volume traded between them, so the pair and the counter ` +
        `are NOT aligned in time. This verdict now travels with the card: the chain's ` +
        `top-contracts panel publishes these counts and prints them beside the column ` +
        `they judge, so a reader of the page sees what this line sees.` +
        (dryRun ? " On synthetic rows this number is two unrelated fixture formulas" +
          " disagreeing, and is not evidence about the vendor." : "") };
  }
  return { seen, exceeded: 0, exceedShare: 0, verdict: "inconclusive",
    line: `${tag}oi basis: 0 of ${seen} contracts showed an open-interest change ` +
      "exceeding their own volume. This is INCONCLUSIVE — it is consistent with an " +
      "intraday denominator, with an aligned same-session pair, and with a quiet " +
      "stretch. It is not evidence either way." };
}

/* ---------- the prose, published verbatim ---------------------- */

/**
 * Every methodological choice this file makes, as prose, published with the
 * numbers rather than living in a comment only a maintainer reads.
 */
export const UNUSUAL_NOTES = Object.freeze({
  unit: "A contract counter, not a trade. The vendor reports one row per listed " +
    "strike with a volume total, an open interest and a quote — no size, no " +
    "timestamp, no execution price, no sweep flag. Nothing here says who traded, " +
    "or why.",
  date: "This endpoint accepts no date parameter and returns no as-of stamp, and " +
    "the pipeline reads it roughly four hours before the opening bell. The " +
    "counter's span is therefore unobserved. readAt is when it was read; it is " +
    "not a claim about what it counts.",
  rank: "vor = volume / open_interest. A ratio of two counts, finite by " +
    "construction because a minimum open interest is what defines the population. " +
    "Ranking instead by the notional bracket would rank by contract price and put " +
    "deep in-the-money lines on top; ranking by raw volume would rank by how big " +
    "the name is. Both are defensible; this is a choice.",
  lift: "lift = ask_volume / (ask_volume + bid_volume). The reported legs need not " +
    "sum to the volume total — this is a share of what the vendor classified, not " +
    "of what traded. Absent on either leg it is withheld, never printed as balanced.",
  notional: "nlo = volume × bid × 100, nhi = volume × ask × 100. The quote is the " +
    "one standing when the chain was read; the counter carries no date and may " +
    "cover a different span entirely. This is a scale for the money involved, not " +
    "a bound on it, and it is not a bound in either direction.",
  iv: "Implied volatility as the vendor quoted it on this name's own chain, " +
    "divided by the convention that chain's median implies. Two rows from two " +
    "names may sit on two conventions, so this column reads down a name and not " +
    "across the table. Each name's divisor and basis are in coverage.",
  oi: "Open interest as the vendor reported it on this response, undated. " +
    "Positive open-interest change means contracts stuck between two settlements; " +
    "it does not say on which side.",
  zeroOi: "The chain request excludes strikes with no open interest, so a strike " +
    "opened between settlements never arrives and is invisible here.",
  /* "READ", NOT "BOUGHT". The word meant bought FROM THE VENDOR, and in any
     other file it would be unambiguous — but it sits two lines from a volume
     column on a page whose first refusal is that a counter is not a purchase.
     A reader scanning this sentence beside that column has every reason to
     take it the other way, which is the exact misreading the refusal exists
     to prevent. */
  names: "The contract feed can only cover names whose option chain was read — " +
    "a few dozen. The name panel is built from the screener rows held for every " +
    "eligible name, which is why it exists: ten times that coverage or more, " +
    "for the same zero vendor calls.",
  refusals: "No delta, no probability, no expected value, no fair premium: each " +
    "needs a risk-free rate and a dividend yield, which this desk does not invent. " +
    "No “bullish bet” or “bearish bet”: a call taken at the offer is " +
    "equally a collar leg, a short-stock hedge, a closing purchase or a dealer " +
    "hedge. No “smart money”: the tape carries no counterparty identity at " +
    "any tier.",
});
