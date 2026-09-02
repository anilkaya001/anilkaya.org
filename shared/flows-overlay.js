/* =============================================================
   flows-overlay.js — the daily-close score laid over the price it
   was scored against, joined BY DATE and never by index.

   WHY THIS IS A MODULE AND NOT TEN LINES IN A RENDERER.

   Two series arrive from two different payloads, built by two
   different legs of the pipeline, on two different schedules:

     - the card's `context` panel carries `closes` and `closeDates`,
       cut to the last 42 sessions of whatever OHLC the vendor
       returned for this name;
     - `scoretrack` carries `sessions[].d` and, per name, a score
       array index-aligned to those sessions, assembled from the
       dated board archive.

   Both are about forty long. Both are ordered oldest first. Zipping
   them by index therefore produces a chart that looks entirely
   correct and is fiction — and it would keep looking correct on
   every name, every day, until someone checked a date. That is the
   defect this repository has paid for more than once, and the only
   defence against it is to make the join a named, tested operation
   rather than a `for` loop inside a drawing function.

   THE EMPTY INTERSECTION IS A READING. The two windows genuinely can
   fail to overlap: a name new to the board has scores for a week and
   closes for two months, and the archive's window and the OHLC
   window are trimmed by different rules. An empty overlap is not an
   error and not an absence — it is a measured fact with two spans
   attached, and it gets its own status so the page can say which
   spans failed to meet instead of drawing nothing.

   NULLS INSIDE THE OVERLAP SURVIVE. A session the archive never
   recorded for this name is a hole in the score line, and a hole is
   drawn as a break. Interpolating it would invent a score on a day
   nobody scored; substituting zero would invent a NEUTRAL score,
   which is worse, because zero is a reading this system publishes
   and defends.
   ============================================================= */

/** Absence-tested numeric read. Number(null) is 0 and that is the bug. */
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A YYYY-MM-DD day key, or null. Anything else is not a date. */
function dayKey(v) {
  if (typeof v !== "string") return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export const OVERLAY_NOTES = Object.freeze({
  join: "The two series are matched by session date. They are not zipped by " +
    "position: both are about forty points long and both run oldest first, so " +
    "an index join would draw a plausible chart out of two windows that need " +
    "not describe the same days.",
  gap: "A break in the score line is a session the archive holds no score for " +
    "this name — the name was off the board, or that day's board was never " +
    "written. The line breaks rather than bridging, because a bridged gap is a " +
    "score nobody computed and a zero would be a NEUTRAL score, which is a " +
    "reading this system publishes and means.",
  axes: "Two units on one date axis. Price is in dollars and has no meaningful " +
    "zero; the score is bounded to plus or minus one hundred and its zero is the " +
    "centre of the dead band. They are drawn against separate scales and the " +
    "score's zero is marked, so the two lines crossing means nothing at all.",
  window: "The overlap is the intersection of the price window and the score " +
    "window, and either can be the shorter. Sessions outside it are counted and " +
    "named rather than silently dropped.",
});

/**
 * Join a name's score history onto its price history, by date.
 *
 * @param {object}   input
 * @param {number[]} input.closes      Daily closes, oldest first.
 * @param {string[]} input.closeDates  Dates for those closes, index-aligned.
 * @param {object[]} input.sessions    scoretrack sessions, each carrying `d`.
 * @param {Array}    input.scores      Scores index-aligned to `sessions`.
 * @param {number|null} input.deadBand The band, in score units, or null.
 *
 * @returns {object} status "ok" | "quiet" | "unavailable", with a reason on
 *   the two silent forms and, on "ok", `rows` oldest first plus the counts
 *   that explain what was left out.
 */
export function joinScoreToPrice({
  closes = null, closeDates = null, sessions = null, scores = null, deadBand = null,
} = {}) {
  const unavailable = (reason) => ({ status: "unavailable", reason });

  /* THE THREE ABSENCES ARE THREE DIFFERENT SENTENCES, and each names the
     payload that was missing rather than "no data". A reader who is told
     which half is absent knows whether to wait for the next pipeline run or
     to stop expecting this panel on this name at all. */
  if (!Array.isArray(closes) || !Array.isArray(closeDates)) {
    return unavailable(
      "this card carries no dated price history — closes and their dates are " +
      "published together, and a card built before that pairing shipped has the " +
      "prices without the days to hang them on");
  }
  if (!Array.isArray(sessions) || !Array.isArray(scores)) {
    return unavailable(
      "the score track was not read for this name in this run, so there is no " +
      "score history to lay over the price");
  }

  /* Price side, keyed by day. A close with no date cannot be joined and is
     counted, not guessed at. */
  const priceByDay = new Map();
  let undatedCloses = 0;
  for (let i = 0; i < closes.length; i++) {
    const c = numOrNull(closes[i]);
    const d = dayKey(closeDates[i]);
    if (c === null || !(c > 0)) continue;
    if (d === null) { undatedCloses++; continue; }
    priceByDay.set(d, c);
  }

  /* Score side. A session with no date is the same problem from the other
     direction. A score of null inside the window is NOT skipped here — it is
     a hole the chart must draw as a break, so it has to survive the join. */
  const scoreByDay = new Map();
  let undatedSessions = 0;
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const d = dayKey(s && s.d);
    if (d === null) { undatedSessions++; continue; }
    scoreByDay.set(d, numOrNull(scores[i]));
  }

  const priceDays = [...priceByDay.keys()].sort();
  const scoreDays = [...scoreByDay.keys()].sort();

  if (!priceDays.length) {
    return unavailable(
      "no close on this card carried both a price and a date, so nothing could " +
      "be placed on a date axis");
  }
  if (!scoreDays.length) {
    return unavailable(
      "the score track carried no dated session, so its scores cannot be placed " +
      "against anything");
  }

  const span = (days) => ({ from: days[0], to: days[days.length - 1], sessions: days.length });
  const priceSpan = span(priceDays);
  const scoreSpan = span(scoreDays);

  /* THE JOIN. Ordered by the price side's own days, because price is the
     continuous series here and the one whose x-axis the chart is drawn on. */
  const rows = [];
  for (const d of priceDays) {
    if (!scoreByDay.has(d)) continue;
    rows.push({ d, close: priceByDay.get(d), score: scoreByDay.get(d) });
  }

  if (!rows.length) {
    /* MEASURED EMPTINESS, not an absence. Both windows were read and they
       describe disjoint spans — which is an ordinary state for a name new to
       the board, and a state whose two spans are the whole explanation. */
    return {
      status: "quiet",
      reason: "the price window and the score window do not share a single session",
      priceSpan, scoreSpan,
      overlap: 0,
      undatedCloses, undatedSessions,
    };
  }

  /* WHAT IS INSIDE THE OVERLAP BUT UNSCORED. Counted so the panel can say
     "eleven of forty sessions have no score" rather than leaving a reader to
     infer it from the gaps in a line. */
  let scored = 0;
  for (const r of rows) if (r.score !== null) scored++;

  return {
    status: "ok",
    rows,
    overlap: rows.length,
    scored,
    /* A GAP COUNT, not a gap ratio: eleven holes in forty is a different
       object from 27.5%, and the reader can form the ratio if they want it. */
    gaps: rows.length - scored,
    priceSpan,
    scoreSpan,
    /* Sessions each side holds that the other does not. These are what make
       the overlap shorter than either window, and naming both is what stops
       "42 closes" beside "31 points" reading as lost data. */
    priceOnly: priceDays.length - rows.length,
    scoreOnly: scoreDays.length - rows.length,
    undatedCloses, undatedSessions,
    deadBand: numOrNull(deadBand),
    notes: OVERLAY_NOTES,
  };
}

/**
 * One name's score row out of the scoretrack payload.
 *
 * SEPARATE FROM THE JOIN so that "this name is not in the track" and "these
 * two windows do not meet" cannot be confused: the first is an absence and
 * the second is a measurement, and a single function returning null for both
 * would force the caller to guess which it had.
 */
export function scoreRowFor(track, ticker) {
  if (!track || !Array.isArray(track.names) || typeof ticker !== "string") return null;
  const want = ticker.toUpperCase();
  for (const row of track.names) {
    if (row && typeof row.t === "string" && row.t.toUpperCase() === want) return row;
  }
  return null;
}
