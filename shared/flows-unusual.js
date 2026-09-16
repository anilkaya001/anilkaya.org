import { parseOptionSymbol, daysToExpiry, SHARES_PER_CONTRACT } from "./flows-premium.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));

export const UA_BANNED_CLAIMS =
  /\b(print|trade|block|sweep|bought|sold|paid|whale|smart money|institutional)\b/ig;

export const UA_MIN_VOLUME = 250;
export const UA_MIN_OI = 100;
export const UA_ROWS = 50;
export const UA_NAMES = 40;
export const UA_PER_NAME_MIN = 2;
export const UA_PER_NAME_MAX = 8;

export function perNameCap(namesSeen, { rows = UA_ROWS, min = UA_PER_NAME_MIN, max = UA_PER_NAME_MAX } = {}) {
  const n = Math.max(1, Math.floor(namesSeen) || 0);
  return Math.min(max, Math.max(min, Math.ceil(rows / n)));
}

export function buildUnusualRows(rows, {
  ticker = null, spot = null, ivDivisor = 1, sessionDate = null, truncated = false,
  minVolume = UA_MIN_VOLUME, minOi = UA_MIN_OI,

  stage = null,

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

  const st = typeof stage === "string" && stage ? stage : null;

  for (const { p: sym, row: raw } of pairs) {
    if (!sym) continue;

    const vol = numOrNull(raw.volume);
    const oi = numOrNull(raw.open_interest);

    if (vol === null || oi === null) continue;
    if (vol < minVolume || oi < minOi) continue;

    const vor = vol / oi;

    const prevOi = numOrNull(raw.prev_oi);
    const bidPx = numOrNull(raw.nbbo_bid);
    const askPx = numOrNull(raw.nbbo_ask);
    const askVol = numOrNull(raw.ask_volume);
    const bidVol = numOrNull(raw.bid_volume);
    const rawIv = numOrNull(raw.implied_volatility);

    const legs = askVol !== null && bidVol !== null ? askVol + bidVol : null;
    const lift = legs !== null && legs > 0 ? askVol / legs : null;

    const row = {
      t: ticker || sym.ticker,
      k: sym.strike,
      expiry: sym.expiry,
      cp: sym.type === "put" || sym.type === "P" ? "P" : "C",
      vol,
      oi,

      doi: prevOi === null ? null : oi - prevOi,
      vor: round(vor, 3),
      bidPx: round(bidPx, 2),
      askPx: round(askPx, 2),

      nlo: bidPx === null || askPx === null ? null : Math.round(vol * bidPx * SHARES_PER_CONTRACT),
      nhi: bidPx === null || askPx === null ? null : Math.round(vol * askPx * SHARES_PER_CONTRACT),
      aggr: askVol === null || bidVol === null ? null : askVol - bidVol,
      lift: round(lift, 3),

      iv: rawIv === null ? null : round(rawIv / div, 4),
      m: s !== null && s > 0 && sym.strike > 0 ? round(Math.log(sym.strike / s), 4) : null,
      dte: daysToExpiry(sym.expiry, sessionDate),

      p: truncated ? 1 : 0,
    };
    if (st !== null) row.st = st;
    out.push(row);
  }
  return out;
}

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

  return {
    rows: kept,
    shown: kept.length,
    eligible: all.length,
    cap,
    perName,
    capBound: kept.length >= cap ? "rows" : (perNameBit ? "perName" : "eligible"),

    aggressorReported: kept.filter((r) => r.aggr !== null).length,
    notionalReported: kept.filter((r) => r.nlo !== null).length,
  };
}

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

    chg: prev !== null && prev > 0 && close !== null && close > 0
      ? round((close - prev) / prev, 5) : null,
    sc: round(numOrNull(t.callSurprise), 3),
    sp: round(numOrNull(t.putSurprise), 3),
    st: bothAvg && bothVol ? round((callVol + putVol) / (callAvg + putAvg), 3) : null,
    putCallRatio: round(numOrNull(t.putCallRatio), 3),
    relVolume: round(numOrNull(t.relVolume), 2),
  };
}

export function rankUnusualNames(withTilt, { cap = UA_NAMES } = {}) {
  const rows = [];
  for (const entry of Array.isArray(withTilt) ? withTilt : []) {
    if (!entry || !entry.row) continue;
    const r = unusualNameRow(entry.row, entry.tilt);
    if (!r.t) continue;
    rows.push(r);
  }

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
