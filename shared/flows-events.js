/* =============================================================
   flows-events.js — what the universe reports next, and what the
   option market is charging into it.

   THE PART NO OTHER PAGE CAN SAY. The pipeline's earnings gate
   removes every name reporting inside a short window before the
   board is scored, for a good reason: the composite is a
   PREDICTIVE ranking and a name with a scheduled binary event is
   not being priced by the same process as one without. But those
   names are, by construction, the MOST EVENT-EXPOSED in the
   universe — and until now the product discarded them into a single
   number in a log line. This page is where they go.

   ZERO VENDOR CALLS. Every field is on the wire already:
   screenerTilt() is computed for every eligible name and then
   thrown away for all but the enriched, and next_earnings_date is
   read once to filter and never published.

   ============================================================
   THE TWO CLOCKS, WHICH IS THE CORRECTION THAT MATTERS MOST.

   sessionDate and the earnings gate DO NOT SHARE AN ORIGIN.

     - daysToEarnings() is called with Date.now() — the RUN's wall
       clock, about 05:15 America/New_York.
     - sessionDate is the last COMPLETED session, which at 05:15 is
       always the previous trading day: yesterday on a normal
       morning, Friday on a Monday.

   So a page that counts days from sessionDate draws the gate window
   ONE TO THREE DAYS EARLY and classifies every name against a gate
   that is not the one that ran. Worse, it does so invisibly: a
   fixture built from sessionDate agrees with the code perfectly,
   and only the live drawing is wrong.

   Both are published, and which quantity uses which is stated:
   every PRICE describes sessionDate, every DAY COUNT uses
   gateOrigin.
   ============================================================= */

import { horizonMove } from "./flows-features.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** How many rows the table publishes, and how far ahead it looks. */
export const EVENT_ROWS = 60;

/**
 * The window, in CALENDAR DAYS — and the unit in the name is load-bearing.
 *
 * TWO HORIZONS LIVE ON THIS PAGE AND THEY ARE NOT THE SAME QUANTITY.
 *
 *   dte  — CALENDAR days to the report. This is what the earnings gate
 *          counts (daysToEarnings is a plain millisecond subtraction), so it
 *          is the only unit in which "inside the gate" is a true statement,
 *          and the only one the window and the chart's axis may use.
 *   sdte — trading SESSIONS to the report, weekdays only. This is what the
 *          priced move needs, because horizonMove scales by sqrt(sessions /
 *          trading year) and feeding it calendar days overstates every move
 *          that crosses a weekend by sqrt(7/5) — about 18%.
 *
 * The first draft of this file filtered `sdte > EVENT_WINDOW_DAYS`: sessions
 * compared against a constant named days. It also would have had the chart
 * hatch a gate band measured in calendar days across marks placed in
 * sessions, so a name gated at 12 calendar days would have been drawn at 8
 * and appeared to sit OUTSIDE the band that removed it. Both numbers were
 * individually correct and the comparison between them was not, which is why
 * the unit is in the name now.
 */
export const EVENT_WINDOW_DAYS = 21;

/**
 * Trading sessions between two dates, counting weekdays only.
 *
 * A CONVENTION, AND A LABELLED ONE. The alternative — calendar days — is
 * what the vendor's own horizon fields use, and mixing the two is how a
 * five-calendar-day horizon becomes a three-session one without anybody
 * noticing. `ev` below scales an annualised volatility by sqrt(sessions /
 * trading year), so the unit of `sessions` has to be a SESSION or the move
 * is wrong by sqrt(7/5) at every weekend it crosses.
 *
 * MARKET HOLIDAYS ARE NOT REMOVED, and that is stated rather than fixed:
 * this file holds no holiday calendar, and inventing one would be a free
 * parameter. A count that is right to within one session per quarter is
 * honest; a count that silently assumes a calendar nobody published is not.
 *
 * Returns null rather than 0 for an unparseable or absent date — "reports
 * today" and "no date on the wire" are different facts.
 */
export function calendarDaysTo(earningsDate, origin) {
  if (!ISO.test(String(earningsDate || "")) || !ISO.test(String(origin || ""))) return null;
  const end = Date.parse(earningsDate + "T00:00:00Z");
  const start = Date.parse(origin + "T00:00:00Z");
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.round((end - start) / 86400000);
  return days < 0 ? null : days;
}

export function sessionsToEarnings(earningsDate, origin) {
  if (!ISO.test(String(earningsDate || "")) || !ISO.test(String(origin || ""))) return null;
  const end = Date.parse(earningsDate + "T00:00:00Z");
  const start = Date.parse(origin + "T00:00:00Z");
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.round((end - start) / 86400000);
  if (days < 0) return null;                 // already reported; not this page's row
  let sessions = 0;
  for (let i = 1; i <= days; i++) {
    const dow = new Date(start + i * 86400000).getUTCDay();
    if (dow !== 0 && dow !== 6) sessions++;
  }
  return sessions;
}

/**
 * The four-point implied-volatility path, reconstructed exactly as the card
 * reconstructs it.
 *
 * THE −1w POINT IS NOT ON THE WIRE. screenerTilt exposes `ivMomentum`, which
 * is `iv30 − iv30d_1w`, and never `iv30d_1w` itself. So the point is
 * `iv30 − ivMomentum`, and only when BOTH are finite. A fixture that invents
 * a `tilt.iv30d_1w` passes every test in this file while every live value
 * comes back null — which is why this is written once, here, rather than
 * inline at a call site.
 *
 * Oldest first, and the labels are stated ONCE in the payload header rather
 * than repeated on every row: four `{h,v}` pairs cost ~300 bytes a row, and
 * sixty rows of them is a fifth of the payload spent on the same four
 * strings.
 */
export const IV_PATH_LABELS = Object.freeze(["−1m", "−1w", "−1d", "now"]);

export function ivPathOf(tilt) {
  const t = tilt || {};
  const iv30 = numOrNull(t.iv30);
  const mom = numOrNull(t.ivMomentum);
  return [
    numOrNull(t.iv30d1m),
    iv30 !== null && mom !== null ? round(iv30 - mom, 4) : null,
    numOrNull(t.iv30d1d),
    iv30,
  ];
}

/**
 * One name's row.
 *
 * `ev` IS A PRICE, NOT A FORECAST, and it is the only derived quantity here.
 * horizonMove scales an annualised volatility to a horizon by the square
 * root of time — no rate, no dividend, no distribution, no free parameter.
 * It says what the option market is CHARGING for the sessions between now
 * and the report, which is a different claim from what the stock will do,
 * and the payload's prose says so in those words.
 *
 * `im` is the VENDOR's own implied move to its own next expiry, passed
 * through and labelled as the vendor's. The two are deliberately both
 * published and deliberately not reconciled: they are quoted to different
 * horizons, and averaging them would produce a number quoted to neither.
 */
export function eventRow(row, tilt, {
  gateOrigin, features = null, score = null, stage = null,
} = {}) {
  const t = tilt || {};
  const d = ISO.test(String(row && row.next_earnings_date || "")) ? row.next_earnings_date : null;
  const sdte = sessionsToEarnings(d, gateOrigin);
  /* THE GATE'S OWN NUMBER WHEN THE CALLER HAS IT, and a local computation
     only as a fallback.

     daysToEarnings() rounds `(earnings_at_midnight − Date.now()) / a day`, so
     its answer depends on the TIME OF DAY the run happens: late in the day it
     shaves most of a day off. calendarDaysTo() measures from midnight of the
     Eastern date. The two agree at some hours and differ by one at others —
     and when they differ, a row can be labelled `gated` while the `dte` beside
     it reads 13 against a stated gate of 12, which is a contradiction a reader
     is entitled to take as a bug in the gate rather than in the arithmetic.
     Measured on a 20:52 UTC dry run: exactly that, on the boundary rows.

     There is no right answer to "which rounding is correct" — there is only
     "which number did the gate actually use", and this is how the page gets
     that one instead of a second opinion about it. */
  /* ONE ORIGIN, ONE COMPUTATION, AND NO PASSTHROUGH.

     This briefly took the gate's own count as a parameter, because
     daysToEarnings rounded against Date.now() while this counted from
     midnight — two origins about 21 hours apart, which published a row
     labelled `gated` beside a dte of 13 against a stated gate of 12 and,
     worse, let the WEEKDAY count overtake the CALENDAR count containing it on
     8 of 60 rows. A subset cannot be larger than its superset; the contract
     suite refused to pass and was right to.

     The passthrough was the wrong fix for the right problem. It made this
     page's number agree with the gate's by TRUSTING the caller, which left
     the guard in buildEvents resting on a convention nothing enforced — an
     undated name with a supplied count was seated on the calendar and counted
     as undated at the same time. The root cause was upstream: the gate was a
     function of the minute the runner fired rather than of the date.

     daysToEarnings measures from an ISO date now, and from THIS date. So the
     gate's count and this one are the same arithmetic against the same
     origin, the passthrough is redundant, and the whole class of defect goes
     with it. A reader holding the payload can now reproduce every dte from
     the gateOrigin it publishes, which was never true before. */
  const dte = calendarDaysTo(d, gateOrigin);
  const iv = numOrNull(t.iv30);
  const close = numOrNull(row && row.close);

  return {
    t: String((row && row.ticker) || ""),
    d,
    /* BOTH HORIZONS, because they answer different questions and one of them
       is the gate's. See EVENT_WINDOW_DAYS. */
    dte,
    sdte,
    /* THE ANNOUNCE TIME IS NOT ON THE SCREENER, and this page does not spend
       44 calls to find it. Null with a published reason beats a column
       populated for the first fortnight and blank after, which invites
       exactly the wrong inference about the names in the blank half. */
    when: null,
    px: close !== null && close > 0 ? round(close, 2) : null,
    ev: iv !== null && sdte !== null && sdte > 0
      ? round(horizonMove(iv, { sessions: sdte }), 4) : null,
    im: round(numOrNull(t.impliedMovePerc), 4),
    iv: round(iv, 4),
    /* REALIZED VOLATILITY IS ENRICHED-ONLY, so most rows withhold it. That
       is a coverage fact, not a measurement, and the header counts how many
       rows carry one so the column can say what it is missing. */
    rv: round(numOrNull(features && features.rv30), 4),
    ivr: round(numOrNull(t.ivRank), 4),
    ivPath: ivPathOf(t),
    rvol: round(numOrNull(t.relVolume), 2),
    sector: (row && row.sector) || null,
    /* WHERE THIS NAME STOPPED IN THE FUNNEL, which is the column this page
       exists for. "gated" means the board was FORBIDDEN from holding an
       opinion on it — not that it had none. */
    st: stage || null,
    s: numOrNull(score),
  };
}

/**
 * The published surface: every name reporting inside the window, nearest
 * first, with the funnel stage each one reached.
 *
 * SORTED BY DATE AND THEN BY TICKER, never by `ev`. Ranking by the priced
 * move would make this a leaderboard of expensive options, which is a
 * different page and a claim this one does not make: the question is what
 * reports next, and a calendar sorted by anything but time stops being one.
 */
export function buildEvents(withTilt, {
  gateOrigin,
  sessionDate = null,
  windowDays = EVENT_WINDOW_DAYS,
  cap = EVENT_ROWS,
  stageOf = () => null,
  featuresOf = () => null,
  scoreOf = () => null,
} = {}) {
  const rows = [];
  let dated = 0;
  for (const entry of Array.isArray(withTilt) ? withTilt : []) {
    if (!entry || !entry.row) continue;
    const row = eventRow(entry.row, entry.tilt, {
      gateOrigin,
      features: featuresOf(entry.row.ticker),
      score: scoreOf(entry.row.ticker),
      stage: stageOf(entry.row.ticker),
    });
    if (!row.t) continue;
    if (row.d) dated++;
    /* A NAME WITH NO EARNINGS DATE IS NOT A NAME REPORTING FAR AWAY. It is
       counted in `undated` and left out entirely; seating it at the end of a
       calendar would put a name nobody has scheduled after one scheduled in
       three weeks, which reads as an ordering. `dte` is what is tested
       because `dte` is what the window MEANS — and eventRow guarantees it is
       null whenever the date is, rather than that guarantee living here. */
    if (row.dte === null) continue;
    if (row.dte > windowDays) continue;
    rows.push(row);
  }
  rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)));

  const shown = rows.slice(0, cap);
  const byStage = {};
  for (const r of shown) {
    const k = r.st || "unclassified";
    byStage[k] = (byStage[k] || 0) + 1;
  }
  return {
    rows: shown,
    shown: shown.length,
    inWindow: rows.length,
    dated,
    undated: (Array.isArray(withTilt) ? withTilt.length : 0) - dated,
    universe: Array.isArray(withTilt) ? withTilt.length : 0,
    cap,
    windowDays,
    gateOrigin: gateOrigin || null,
    sessionDate,
    byStage,
    rvMeasured: shown.filter((r) => r.rv !== null).length,
    evMeasured: shown.filter((r) => r.ev !== null).length,
    ivPath: { labels: [...IV_PATH_LABELS], sameAs: "the card's ivStrip, same quantity and order" },
  };
}

/* ---------- the prose, published verbatim ---------------------- */

export const EVENTS_NOTES = Object.freeze({
  purpose: "Which names in the screened universe report next, what the option " +
    "market is charging into that report, and where each one stopped in the " +
    "board's own funnel.",
  gate: "The board's composite is a predictive ranking, and a name with a " +
    "scheduled binary event is not being priced by the same process as one " +
    "without — so the pipeline removes those names before scoring. They are, by " +
    "construction, the most event-exposed names in the universe. Until this page " +
    "existed they were reported as a single number in a log line and discarded. " +
    "A name marked gated is one the board was FORBIDDEN from holding an opinion " +
    "on; it is not a name the board found nothing in.",
  clocks: "Two clocks, and they do not share an origin. Every PRICE here " +
    "describes the last completed session. Every DAY COUNT is measured from the " +
    "run's own Eastern date, which is the origin the earnings gate itself used — " +
    "at 05:15 those differ by one to three days, and counting from the wrong one " +
    "would draw the window early and classify every name against a gate that " +
    "never ran.",
  sessions: "Sessions are counted as weekdays. Market holidays are not removed: " +
    "this desk holds no holiday calendar and inventing one would be a free " +
    "parameter. The count is right to within about one session a quarter, and " +
    "saying so beats a number that assumes a calendar nobody published.",
  priced: "The priced move scales the name's 30-day implied volatility to the " +
    "sessions between the run and the report, by the square root of time. No " +
    "rate, no dividend, no distribution. It is what the option market is " +
    "CHARGING for that stretch, which is not a forecast of what the stock will " +
    "do, and it is not this desk's opinion of either.",
  vendorMove: "The vendor's own implied move is quoted to the vendor's own next " +
    "expiry, which is a different horizon from the one beside it. Both are " +
    "published and neither is reconciled into the other: an average of two " +
    "numbers quoted to two horizons is quoted to neither.",
  announce: "Whether a name reports before the open or after the close is not on " +
    "the screener. The endpoints that carry it are scoped to a single date, so " +
    "covering this window would cost forty-four calls — a twelve per cent " +
    "increase on the run for one column. It is withheld rather than half-filled, " +
    "because a column populated for the first fortnight and blank after invites " +
    "the wrong inference about everything in the blank half.",
  order: "Sorted by date, then by name. Never by the priced move: that would " +
    "make this a leaderboard of expensive options, which is a different page and " +
    "a claim this one does not make.",
  coverage: "Realized volatility is measured only for the enriched names, so " +
    "most rows withhold it. The count of rows that carry one is published beside " +
    "the column rather than left to be inferred from the em dashes.",
});
