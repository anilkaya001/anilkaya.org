/* =============================================================
   flows-record.js — the track-record scorer.

   Pure functions over data the pipeline already holds: the dated
   board payloads it archived, and dated closes assembled from the
   enriched names' own candles, the archived rows' published prices,
   and the day's screener. Everything here is arithmetic over
   published closes — no rate, no dividend, no cost model, no free
   parameter — which is the only claim the Track Record page can
   make without inventing one.

   THE CONVENTIONS ARE THE PAYLOAD'S, NOT THE READER'S PROBLEM.
   Every methodological choice this file makes (what a "session" is,
   what happens to a name that vanished, what the hit rate counts)
   is exported as prose in RECORD_NOTES and published verbatim, so
   the numbers arrive with the rules that produced them.
   ============================================================= */

const round = (v, d) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
const fin = (v) => (Number.isFinite(v) ? v : null);

/**
 * The trading calendar: the sorted union of every observed close date.
 *
 * A convention, and a labelled one. The alternative — calendar-day
 * arithmetic — lands "ten sessions later" on a Sunday and scores nothing,
 * or worse, scores the Friday close under a Sunday label. The union of
 * dates that actually carry closes is the only calendar this data can
 * testify to; a market holiday appears here as an absent date, and the
 * k-session offset simply walks past it.
 *
 * @param {Iterable<Iterable<string>>} dateSets — any number of iterables
 *   of "YYYY-MM-DD" strings (candle dates, archived session dates…).
 */
export function tradingCalendar(dateSets) {
  const all = new Set();
  for (const set of dateSets || []) {
    for (const d of set || []) {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) all.add(d);
    }
  }
  return [...all].sort();
}

/**
 * The close k trading sessions after d, resolved on the given calendar.
 *
 * Three outcomes, and they are DIFFERENT FACTS:
 *   { state: "unclosed" }        — d+k is beyond the calendar's end; the
 *                                  horizon has not happened yet. Not scored,
 *                                  not attrition.
 *   { state: "lost" }            — the exit date exists but this name has no
 *                                  close there. It left the screened universe;
 *                                  that IS attrition and is counted, because
 *                                  the names that leave are not a random
 *                                  sample.
 *   { state: "ok", exit, date }  — a measured exit close.
 */
export function forwardClose(closesByTicker, calendar, calendarIdx, ticker, d, k) {
  const i = calendarIdx.get(d);
  if (i === undefined) return { state: "lost" };
  const j = i + k;
  if (j >= calendar.length) return { state: "unclosed" };
  const date = calendar[j];
  const exit = fin(closesByTicker.get(ticker)?.get(date));
  return exit === null ? { state: "lost" } : { state: "ok", exit, date };
}

/**
 * Score one session's two boards at one horizon.
 *
 * ATTRITION IS EXCLUDED FROM THE MEAN, NEVER ZERO-FILLED. A missing exit
 * close is not a 0% return — zero-filling would drag every mean toward
 * zero by exactly the amount of the attrition, and the departed names are
 * disproportionately the ones something happened to. They are counted in
 * `lost` and the mean is taken over the survivors.
 *
 * `hit` counts a long name whose price ROSE and a short name whose price
 * FELL, over the measured names of both sides; a name that closed exactly
 * flat is a miss, not a half-hit — the board leaned and the price did not
 * follow. Null when nothing was measured.
 */
export function scoreSessionAt(rowsBySide, closesByTicker, calendar, calendarIdx, d, k) {
  let names = 0, lost = 0, hits = 0, measured = 0;
  let unclosed = false;
  const legs = {};
  for (const side of ["long", "short"]) {
    const rows = rowsBySide[side] || [];
    let sum = 0, m = 0;
    for (const row of rows) {
      names++;
      const entry = fin(row && row.px);
      if (entry === null || entry <= 0) { lost++; continue; }
      const fc = forwardClose(closesByTicker, calendar, calendarIdx, row.t, d, k);
      if (fc.state === "unclosed") { unclosed = true; continue; }
      if (fc.state === "lost") { lost++; continue; }
      const r = fc.exit / entry - 1;
      sum += r; m++; measured++;
      if (side === "long" ? r > 0 : r < 0) hits++;
    }
    legs[side] = m ? sum / m : null;
  }
  if (unclosed) return { state: "unclosed" };
  return {
    state: "ok",
    long: legs.long,
    short: legs.short,
    /* The spread needs BOTH legs: with one side fully attrited, publishing
       the surviving leg alone as "long minus short" would relabel a one-
       sided return as a spread. */
    ls: legs.long !== null && legs.short !== null ? legs.long - legs.short : null,
    hit: measured ? hits / measured : null,
    lost,
    names,
  };
}

/**
 * The whole record: every archived session at every horizon.
 *
 * `sessions` is the per-session table at the STATED horizon only — the one
 * the boards themselves quote (`horizonSessions`) — newest first, capped.
 * `horizons` is the session-mean of the long-minus-short spread at each
 * horizon, with n counting SESSIONS (the renderer prints "over n scored
 * sessions", so n must count what the mean is over).
 *
 * @param {Array<{d: string, side: string, rows: Array}>} datedBoards
 * @param {Map<string, Map<string, number>>} closesByTicker
 * @param {string[]} calendar — from tradingCalendar()
 */
export function scoreSessions(datedBoards, closesByTicker, calendar, {
  horizons = [1, 5, 10, 21],
  statedK = 10,
  maxSessions = 30,
} = {}) {
  const calendarIdx = new Map(calendar.map((d, i) => [d, i]));

  const byDate = new Map();
  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string" || (b.side !== "long" && b.side !== "short")) continue;
    if (!byDate.has(b.d)) byDate.set(b.d, {});
    byDate.get(b.d)[b.side] = Array.isArray(b.rows) ? b.rows : [];
  }
  const dates = [...byDate.keys()].sort();

  const horizonRows = horizons.map((k) => {
    let sum = 0, n = 0;
    for (const d of dates) {
      const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, k);
      if (s.state === "ok" && s.ls !== null) { sum += s.ls; n++; }
    }
    return { k, ls: n ? round(sum / n, 4) : null, n };
  });

  const sessions = [];
  for (const d of [...dates].reverse()) {
    const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, statedK);
    if (s.state !== "ok") continue;          // the stated horizon has not closed
    sessions.push({
      d,
      long: round(s.long, 4),
      short: round(s.short, 4),
      ls: round(s.ls, 4),
      hit: round(s.hit, 2),
      lost: s.lost,
      names: s.names,
    });
    if (sessions.length >= maxSessions) break;
  }

  return {
    retained: dates.length,
    firstSession: dates.length ? dates[0] : null,
    lastSession: dates.length ? dates[dates.length - 1] : null,
    horizons: horizonRows,
    sessions,
  };
}

/* ---------- the per-feature evidence table ----------------------- */

/**
 * Flatten one archived board row into its numeric feature columns.
 *
 * SCHEMA-DRIVEN: any numeric key the row carries becomes a column, so a
 * field added to boardRow later (skew, term, rvp…) joins this table the
 * day its history starts existing, with no edit here. Two exclusions,
 * each for a reason rather than by taste:
 *   r  — the published rank is the score's own ordering restated
 *        positionally; its IC is the score's IC with extra ties.
 *   px — a price LEVEL. Across names it ranks share prices, which is a
 *        units artifact, not a signal.
 * `fam` explodes to fam.F…fam.O and `pr` to pr.0…pr.2; everything
 * non-numeric (ticker, sparkline, regime string) simply has no number to
 * contribute and drops out on its own.
 */
const IC_EXCLUDE = new Set(["r", "px"]);

export function featureColumnsOf(row) {
  const out = {};
  for (const key of Object.keys(row || {})) {
    if (IC_EXCLUDE.has(key)) continue;
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (key === "fam" && v && typeof v === "object") {
      for (const f of Object.keys(v)) {
        if (typeof v[f] === "number" && Number.isFinite(v[f])) out["fam." + f] = v[f];
      }
    } else if (key === "pr" && Array.isArray(v)) {
      v.forEach((x, i) => {
        if (typeof x === "number" && Number.isFinite(x)) out["pr." + i] = x;
      });
    }
  }
  return out;
}

/**
 * Spearman information coefficients: every archived feature against the
 * k-session forward price return, pooled across sessions and both sides.
 *
 * Spearman BY CONSTRUCTION — pearson over percentile ranks of both
 * columns — because one 40% takeover return would otherwise own the
 * coefficient of every feature. Returns are RAW, not side-signed: a
 * bearish score is negative and should predict a negative return, so the
 * pooling needs no orientation step, and unsigned features (purity,
 * conviction) are measured for whatever monotone relation they actually
 * have across the published extremes.
 *
 * A column is null-with-reason rather than 0 when it cannot be measured:
 * too few pairs, or no variation (a constant column has no ranking to
 * correlate — pearson answers NaN there, and NaN published as 0 would be
 * a confident "no relation" where the truth is "nothing to measure").
 *
 * @param {function} pearson — shared/flows-features.js pearson
 * @param {function} percentileRank — shared/flows-features.js percentileRank
 */
export function icTable(datedBoards, closesByTicker, calendar, {
  k = 10,
  minN = 20,
  pearson,
  percentileRank,
} = {}) {
  if (typeof pearson !== "function" || typeof percentileRank !== "function") {
    throw new Error("icTable needs the pearson and percentileRank helpers");
  }
  const calendarIdx = new Map(calendar.map((d, i) => [d, i]));

  const pairsByKey = new Map();
  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string") continue;
    for (const row of Array.isArray(b.rows) ? b.rows : []) {
      const entry = fin(row && row.px);
      if (entry === null || entry <= 0) continue;
      const fc = forwardClose(closesByTicker, calendar, calendarIdx, row.t, b.d, k);
      if (fc.state !== "ok") continue;
      const y = fc.exit / entry - 1;
      const cols = featureColumnsOf(row);
      for (const key of Object.keys(cols)) {
        if (!pairsByKey.has(key)) pairsByKey.set(key, { xs: [], ys: [] });
        const p = pairsByKey.get(key);
        p.xs.push(cols[key]); p.ys.push(y);
      }
    }
  }

  const cols = [...pairsByKey.keys()].sort().map((key) => {
    const { xs, ys } = pairsByKey.get(key);
    const n = xs.length;
    if (n < minN) {
      return { key, ic: null, n, reason: `fewer than ${minN} measured pairs` };
    }
    const rho = pearson(percentileRank(xs), percentileRank(ys));
    if (!Number.isFinite(rho)) {
      return { key, ic: null, n, reason: "no variation to rank" };
    }
    return { key, ic: round(rho, 3), n };
  });

  return { k, minN, cols };
}

/**
 * The methodology, as prose the payload carries verbatim. Published beside
 * the numbers so the reader holds the rules and the results together —
 * and pinned by tests so a change to the method must change the statement.
 */
export const RECORD_NOTES = {
  method: "spearman = pearson(percentileRank(feature), percentileRank(forward return)); " +
    "returns are close-to-close price returns from each row's published px, raw, not side-signed",
  selection: "archived rows are the published extremes only, so these are ICs conditional " +
    "on selection, not universe ICs",
  overlap: "consecutive sessions share most of a multi-session window, so n counts rows, " +
    "not independent observations — at the 10-session horizon the effective sample is " +
    "roughly n/10",
  calendar: "the trading calendar is the union of observed close dates; a k-session " +
    "horizon walks that calendar, never calendar days",
  attrition: "a name with no close at the exit date is counted in `lost` and excluded " +
    "from every mean — never scored as zero",
};
