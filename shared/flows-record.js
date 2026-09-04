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
    /* THE RATIO'S OWN TWO NUMBERS, CARRIED BESIDE IT.

       `hit` alone cannot be pooled across sessions: averaging per-session
       ratios weights a session that measured four names the same as one that
       measured two hundred, which is a mean of ratios and not a rate. The
       counts are what pools, so they leave this function rather than being
       recomputed by anyone who wants a total. */
    hits,
    measured,
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
  epoch = null,
} = {}) {
  const calendarIdx = new Map(calendar.map((d, i) => [d, i]));

  const byDate = new Map();
  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string" || (b.side !== "long" && b.side !== "short")) continue;
    if (!byDate.has(b.d)) byDate.set(b.d, {});
    byDate.get(b.d)[b.side] = Array.isArray(b.rows) ? b.rows : [];
  }
  const dates = [...byDate.keys()].sort();

  /* THE SELECTION EPOCH: THE DATE THE POOL BEING SCORED CHANGED.

     A session's long-minus-short return is the return of the names that board
     published, and which names it published is decided by a selection rule.
     When that rule changes, the boards on either side of the change are two
     different experiments — same column headings, same units, entirely
     different populations. Averaging them produces a number that is finite,
     plausible, renders perfectly, and answers no question anyone asked.

     Before 2026-08-26 the pool was sixty names selected as the extremes of a
     rough tilt composite; after it, a stated market-cap cohort of a hundred.
     Both are honest. Their mean is not.

     So the horizon means are reported for the CURRENT rule, and the earlier
     sessions are reported beside them under their own count rather than
     discarded — discarding them would throw away the only track record that
     exists to avoid explaining a footnote. A run with no epoch, or with every
     session on one side of it, behaves exactly as before. */
  const inEpoch = (d) => !epoch || d >= epoch;
  const currentDates = dates.filter(inEpoch);
  const priorDates = dates.filter((d) => !inEpoch(d));

  /**
   * One population at one horizon: the session-mean of the spread, the
   * spread of that mean, and the pooled hit rate under it.
   *
   * THREE NUMBERS AND THREE DENOMINATORS, AND THE UNITS ARE NOT THE SAME.
   *
   *   ls / n     — the mean of the per-session long-minus-short spreads, over
   *                n SESSIONS. Sessions with one attrited leg have no spread
   *                and are not in it.
   *   sd / se    — the dispersion of those same n session spreads and the
   *                standard error of their mean. This layer replaced a mean
   *                published entirely naked: "+38bp over 22 sessions" and
   *                "+38bp ± 210bp over 22 sessions" are the same mean and
   *                opposite readings, and the page could not tell them apart
   *                because the per-session values were accumulated into a sum
   *                and thrown away. They are kept now.
   *
   *                A SAMPLE STANDARD DEVIATION NEEDS TWO OBSERVATIONS. At
   *                n = 1 it is null, never 0: one session has no measured
   *                dispersion, and a published 0 there would be the confident
   *                zero this repository keeps paying for — it would read as a
   *                mean known exactly.
   *
   *   hit / hitN — the pooled hit rate, counted over NAMES, not sessions, and
   *                pooled from the per-session counts rather than by averaging
   *                per-session ratios (a mean of ratios weights a session that
   *                measured four names like one that measured two hundred).
   *                hitSessions says how many sessions contributed those names,
   *                so the two denominators can never be read as one.
   *
   * Every session that scored contributes its names to the hit rate, including
   * sessions whose spread was withheld for a one-legged board: a name that was
   * measured was measured, and dropping it because the OTHER side attrited
   * would make the hit rate a statement about board completeness.
   */
  const meanOver = (subset, k) => {
    const spreads = [];
    let hits = 0, measured = 0, hitSessions = 0;
    for (const d of subset) {
      const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, k);
      if (s.state !== "ok") continue;
      if (s.ls !== null) spreads.push(s.ls);
      if (s.measured > 0) {
        hits += s.hits; measured += s.measured; hitSessions++;
      }
    }
    const n = spreads.length;
    const mean = n ? spreads.reduce((a, b) => a + b, 0) / n : null;
    let sd = null;
    if (n > 1) {
      const ss = spreads.reduce((a, b) => a + (b - mean) * (b - mean), 0);
      sd = Math.sqrt(ss / (n - 1));
    }
    return {
      ls: mean === null ? null : round(mean, 4),
      n,
      /* Four places, same as the mean they qualify: a dispersion rounded
         coarser than the number it brackets can print "+38bp ± 0bp". */
      sd: sd === null ? null : round(sd, 4),
      se: sd === null ? null : round(sd / Math.sqrt(n), 4),
      hit: measured ? round(hits / measured, 4) : null,
      hitN: measured,
      hitSessions,
    };
  };

  const horizonRows = horizons.map((k) => {
    const cur = meanOver(currentDates, k);
    const row = {
      k, ls: cur.ls, n: cur.n, sd: cur.sd, se: cur.se,
      /* THE PRODUCT'S HEADLINE NUMBER, MEASURED AT LAST. Until this row
         carried it, `hit` existed only per session and nothing pooled it —
         so the one question the page is named for could be answered only by
         a reader eyeballing thirty rows of a column. The footer elsewhere on
         the site asserting a hit rate near 51-52% was asserting a figure
         nobody had computed; this is the computation, and it is published
         with its own denominator in names beside n's denominator in
         sessions. */
      hit: cur.hit, hitN: cur.hitN, hitSessions: cur.hitSessions,
    };
    /* PUBLISHED ONLY WHEN THERE IS SOMETHING ON THE OTHER SIDE. A `prior` key
       that is always present but usually null invites a renderer to draw an
       empty second series on every chart forever.

       AND NEVER POOLED WITH THE CURRENT ONE. The prior population gets its
       own mean, its own dispersion and its own hit rate. Averaging the two
       hit rates into a single headline is the specific mistake that produced
       the 51-52% claim this layer exists to replace: two experiments, one
       number, belonging to neither. */
    if (priorDates.length) {
      const before = meanOver(priorDates, k);
      row.prior = before.ls;
      row.priorN = before.n;
      row.priorSd = before.sd;
      row.priorSe = before.se;
      row.priorHit = before.hit;
      row.priorHitN = before.hitN;
      row.priorHitSessions = before.hitSessions;
    }
    return row;
  });

  const sessions = [];
  for (const d of [...dates].reverse()) {
    const s = scoreSessionAt(byDate.get(d), closesByTicker, calendar, calendarIdx, d, statedK);
    if (s.state !== "ok") continue;          // the stated horizon has not closed
    const row = {
      d,
      long: round(s.long, 4),
      short: round(s.short, 4),
      ls: round(s.ls, 4),
      hit: round(s.hit, 2),
      /* THE HIT RATE'S OWN DENOMINATOR, ON THE ROW THAT STATES IT. `hit`
         is a share of the names this session actually measured, which is
         `names` minus `lost` — arithmetic a reader should not have to do to
         know whether a 0.75 is three of four or a hundred and fifty of two
         hundred.

         IT IS THE DENOMINATOR, NOT A RECONSTRUCTION KIT, and the first draft
         of this comment claimed the second: `hit` is rounded to two places
         for the column that draws it, so hit x measured recovers the hit
         COUNT exactly only while measured stays under a hundred — and a full
         two-sided board measures up to two hundred names. The pooled rate on
         the horizon rows is summed from the unrounded counts inside
         meanOver, never from this column; what this column supports is a
         reader checking a session's rate against its own width, which is the
         question the number was missing. */
      measured: s.measured,
      lost: s.lost,
      names: s.names,
    };
    /* WHICH EXPERIMENT THIS ROW BELONGS TO.

       The horizon means split at the epoch and the per-session table did not,
       so the table mixed two populations under one heading with nothing on
       the row saying which was which — a reader scanning the column had no
       way to see the boundary the numbers above it turn on. The flag is
       published ONLY when an epoch was supplied: absent means "no epoch was
       stated", which is a different fact from `false`, and a renderer must
       not draw one as the other. */
    if (epoch) row.pre = d < epoch;
    sessions.push(row);
    if (sessions.length >= maxSessions) break;
  }

  return {
    retained: dates.length,
    firstSession: dates.length ? dates[0] : null,
    lastSession: dates.length ? dates[dates.length - 1] : null,
    horizons: horizonRows,
    sessions,
    /* The epoch rides along with the counts on either side of it, so the page
       can state the split rather than a reader having to notice it. */
    epoch: epoch || null,
    epochRetained: epoch ? currentDates.length : null,
    priorRetained: epoch ? priorDates.length : null,
    /* HOW MUCH OF THE PRIOR EXPERIMENT THE TABLE ACTUALLY SHOWS.

       `sessions` is newest-first and capped, so on any archive deeper than
       the cap every drawn row is post-epoch and the prior population appears
       in the horizon means and NOWHERE ELSE. A page that says "reported
       separately" while drawing one of the two is not reporting separately;
       this count is what lets it say which half the table it is looking at
       covers. Null when no epoch was stated, for the same reason `pre` is
       absent then. */
    preShown: epoch ? sessions.filter((r) => r.pre).length : null,
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
/**
 * Columns that must not become IC rows, each for a stated reason.
 *
 *   r  — the published rank is the score's own ordering restated positionally.
 *   px — a price LEVEL; across names it ranks share prices, a units artifact.
 *
 * The chain scalars are excluded for a THIRD reason, and it is the one
 * boardRow already states for `im`: they are measured at each name's own
 * nearest listed expiry past a floor, which is eight days out on SPY and
 * ninety on a thin name. Pooled across names they would be a correlation
 * between tenors as much as between skews — "carried for the card and never
 * set beside another name's", exactly as `im` is.
 *
 * They are still ARCHIVED on the board row, because a name against its own
 * history is like-for-like and that percentile is what they exist for. It is
 * only the cross-section that is refused.
 */
const IC_EXCLUDE = new Set(["r", "px", "skew", "term", "atmIv", "skewDays"]);

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
  /* THE DATE THE POOL BEING MEASURED CHANGED — the same constant scoreSessions
     partitions on, and for the same reason.

     This table used to take no epoch at all while the return scorer beside it
     built its whole currentDates/priorDates split to avoid pooling across one.
     So the page's research loop — the surface a reader uses to decide which
     feature is worth anything — was the one place still averaging two
     experiments, and RECORD_NOTES.epoch sat underneath it saying that must not
     be done. Null keeps the pre-existing single-population behaviour exactly. */
  epoch = null,
  /* EVERY HORIZON, NOT ONE. The returns are already reported at four horizons
     and the features were measured at one, so the decay of a coefficient with
     horizon — the thing that says whether a feature leads or merely coincides
     — was not on the wire. Defaults to [k], which is the old behaviour and the
     old payload shape byte for byte. */
  horizons = null,
} = {}) {
  if (typeof pearson !== "function" || typeof percentileRank !== "function") {
    throw new Error("icTable needs the pearson and percentileRank helpers");
  }
  const calendarIdx = new Map(calendar.map((d, i) => [d, i]));
  /* The stated horizon is always in the set and always first: it is the one
     `ic` reports, and the one the board itself quotes. */
  const ks = [k, ...(Array.isArray(horizons) ? horizons : [])]
    .filter((h) => Number.isInteger(h) && h > 0);
  const kSet = [...new Set(ks)];

  /* key -> horizon -> { cur: {xs, ys}, pre: {xs, ys} }.

     THE FEATURE COLUMNS ARE FLATTENED ONCE PER ROW, not once per horizon: the
     flattening walks every key of the row and explodes two nested shapes, and
     doing it inside the horizon loop would repeat that work k times over an
     archive of tens of thousands of rows to produce identical output. */
  const pairsByKey = new Map();
  const bucketFor = (key, h, pre) => {
    let byH = pairsByKey.get(key);
    if (!byH) { byH = new Map(); pairsByKey.set(key, byH); }
    let cell = byH.get(h);
    if (!cell) { cell = { cur: { xs: [], ys: [] }, pre: { xs: [], ys: [] } }; byH.set(h, cell); }
    return pre ? cell.pre : cell.cur;
  };

  for (const b of datedBoards || []) {
    if (!b || typeof b.d !== "string") continue;
    const pre = Boolean(epoch) && b.d < epoch;
    for (const row of Array.isArray(b.rows) ? b.rows : []) {
      const entry = fin(row && row.px);
      if (entry === null || entry <= 0) continue;
      const cols = featureColumnsOf(row);
      const keys = Object.keys(cols);
      if (!keys.length) continue;
      for (const h of kSet) {
        const fc = forwardClose(closesByTicker, calendar, calendarIdx, row.t, b.d, h);
        if (fc.state !== "ok") continue;
        const y = fc.exit / entry - 1;
        for (const key of keys) {
          const p = bucketFor(key, h, pre);
          p.xs.push(cols[key]); p.ys.push(y);
        }
      }
    }
  }

  /** One population at one horizon, as a measured coefficient or a stated refusal. */
  const coefficient = (pair) => {
    const n = pair ? pair.xs.length : 0;
    if (n < minN) return { ic: null, n, reason: `fewer than ${minN} measured pairs` };
    const rho = pearson(percentileRank(pair.xs), percentileRank(pair.ys));
    if (!Number.isFinite(rho)) return { ic: null, n, reason: "no variation to rank" };
    return { ic: round(rho, 3), n };
  };

  const cols = [...pairsByKey.keys()].map((key) => {
    const byH = pairsByKey.get(key);
    const stated = coefficient(byH.get(k) && byH.get(k).cur);
    const out = { key, ic: stated.ic, n: stated.n };
    if (stated.reason) out.reason = stated.reason;

    /* THE PRIOR POPULATION, BESIDE THE CURRENT ONE AND NEVER FOLDED INTO IT.
       Published only where there is something on the other side of the epoch,
       under the same rule the horizon rows use: a key that is present and
       always null teaches a renderer to draw an empty column forever. */
    if (epoch) {
      const before = byH.get(k) && byH.get(k).pre;
      if (before && before.xs.length) {
        const prior = coefficient(before);
        out.priorIc = prior.ic;
        out.priorN = prior.n;
        if (prior.reason) out.priorReason = prior.reason;
      }
    }

    /* THE DECAY CURVE. One coefficient at one horizon cannot say whether a
       feature leads the move or merely coincides with it; four can. Peak is
       by ABSOLUTE value because a feature that predicts reliably downward is
       as informative as one that predicts upward — the sign is the relation,
       the magnitude is the evidence. */
    if (kSet.length > 1) {
      const curve = kSet.slice().sort((a, b) => a - b).map((h) => {
        const c = coefficient(byH.get(h) && byH.get(h).cur);
        return { k: h, ic: c.ic, n: c.n };
      });
      out.curve = curve;
      let peak = null;
      for (const point of curve) {
        if (point.ic === null) continue;
        if (peak === null || Math.abs(point.ic) > Math.abs(peak.ic)) peak = point;
      }
      /* Null with no invented peak when no horizon measured: an unmeasured
         curve has no strongest point, and reporting the stated horizon's null
         as the peak would name a winner from an empty field. */
      out.icPeak = peak ? peak.ic : null;
      out.icPeakK = peak ? peak.k : null;
    }
    return out;
  });

  /* ORDERED BY EVIDENCE, NOT BY THE ALPHABET.

     This sorted `[...pairsByKey.keys()].sort()`, so "chg" and "cnv" headed the
     table by spelling and the strongest column sat wherever the alphabet put
     it — a research table whose first row is decided by orthography is a
     research table nobody reads past. Strength is |ic| because the sign is the
     relation and the magnitude is the evidence.

     Unmeasured columns sort LAST as a block rather than being dropped: "there
     was nothing to measure here" is a finding about coverage and belongs on
     the page, just not above the measurements. Ties fall back to the key so
     the ordering is total and two runs over one archive publish one byte
     string. */
  cols.sort((a, b) => {
    const av = a.ic === null ? -1 : Math.abs(a.ic);
    const bv = b.ic === null ? -1 : Math.abs(b.ic);
    return (bv - av) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });

  const table = { k, minN, cols };
  /* Echoed so a reader holding the payload can see which partition and which
     horizons produced the columns, rather than inferring it from their shape. */
  if (epoch) table.epoch = epoch;
  if (kSet.length > 1) table.horizons = kSet.slice().sort((a, b) => a - b);
  return table;
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
  epoch: "the selection rule that decides which names a board publishes changed on the " +
    "stated date; sessions before it were drawn from a different pool, so their mean is " +
    "reported separately rather than averaged into the current one — same headings, " +
    "same units, a different population",
  dispersion: "every horizon mean carries the sample standard deviation of the session " +
    "spreads behind it and the standard error of that mean, sd / sqrt(n). The standard " +
    "error is a SPREAD, not a test: consecutive sessions share most of a multi-session " +
    "window, so the overlap deflation above applies to it too and no t-statistic or " +
    "p-value is computed from it. A single session has no measured dispersion and " +
    "reports none rather than reporting zero",
  pooled: "the hit rate on each horizon row is pooled over NAMES — every measured name " +
    "on both boards across the scored sessions, counted once each, and summed from the " +
    "per-session counts rather than averaged from the per-session rates, which would " +
    "weight a session that measured four names like one that measured two hundred. Its " +
    "denominator is hitN and counts names; n beside it counts sessions, and the two are " +
    "different quantities. The populations either side of the selection epoch are pooled " +
    "separately: one hit rate averaged across both would belong to neither",
};
