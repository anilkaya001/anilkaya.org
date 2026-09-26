import { horizonMove } from "./flows-features.js";
import { isTradingDay } from "./flows-freshness.js";

const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const round = (v, d) => (v === null ? null : Number(v.toFixed(d)));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const EVENT_ROWS = 200;

export const EVENT_WINDOW_DAYS = 21;

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
  if (days < 0) return null;
  let sessions = 0;
  for (let i = 1; i <= days; i++) {
    if (isTradingDay(new Date(start + i * 86400000).toISOString().slice(0, 10), null)) sessions++;
  }
  return sessions;
}

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

export function eventRow(row, tilt, {
  gateOrigin, features = null, score = null, stage = null,
} = {}) {
  const t = tilt || {};
  const d = ISO.test(String(row && row.next_earnings_date || "")) ? row.next_earnings_date : null;
  const sdte = sessionsToEarnings(d, gateOrigin);

  const dte = calendarDaysTo(d, gateOrigin);
  const iv = numOrNull(t.iv30);
  const close = numOrNull(row && row.close);

  const ev = iv !== null && sdte !== null && sdte > 0
    ? round(horizonMove(iv, { sessions: sdte }), 4) : null;
  const vendorMove = round(numOrNull(t.impliedMovePerc), 4);

  return {
    t: String((row && row.ticker) || ""),
    d,

    dte,
    sdte,

    when: null,
    px: close !== null && close > 0 ? round(close, 2) : null,
    ev,
    im: vendorMove,
    iv: round(iv, 4),

    rv: round(numOrNull(features && features.rv30), 4),
    ivr: round(numOrNull(t.ivRank), 4),
    ivPath: ivPathOf(t),
    rvol: round(numOrNull(t.relVolume), 2),

    evp: vendorMove === null || ev === null || !(ev > 0)
      ? null : round(vendorMove / ev, 2),

    pt: round(numOrNull(t.premiumTilt), 4),
    nt: round(numOrNull(t.netTilt), 4),
    vt: round(numOrNull(t.volTilt), 4),
    sut: round(numOrNull(t.surpriseTilt), 4),
    ot: round(numOrNull(t.oiTilt), 4),
    pcr: round(numOrNull(t.putCallRatio), 2),
    sector: (row && row.sector) || null,

    st: stage || null,
    s: numOrNull(score),
  };
}

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

  const capBound = rows.length > shown.length;
  return {
    rows: shown,
    shown: shown.length,
    inWindow: rows.length,
    capBound,

    lastShownDate: shown.length ? shown[shown.length - 1].d : null,

    beyondCap: rows.length - shown.length,
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

    flow: {
      labels: {
        pt: "premium tilt — bullish minus bearish premium over their gross, a share",
        nt: "net tilt — net call minus net put premium over gross call and put premium, a share",
        vt: "volume tilt — ask-side minus bid-side contracts, calls against puts, " +
          "over total contracts, a share",
        sut: "surprise tilt — the log ratio of the call and put volume surprises, " +
          "each against this name's own 30-day average",
        ot: "open-interest tilt — call minus put open-interest change over the " +
          "standing book, a share",
        pcr: "the vendor's own put/call ratio, passed through",
        rvol: "the vendor's own relative volume, passed through",
      },
      units: "every tilt is a share or a log ratio, so all of them are unit-free " +
        "and comparable across names; none is a dollar amount",
    },
  };
}

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
    "next session after it — the first NYSE trading day that follows — which is the origin " +
    "the earnings gate itself used. The run lands after the close, so the two " +
    "differ by one to three calendar days, and counting from the session itself " +
    "would draw the window a session early and classify every name against a " +
    "gate that never ran.",
  sessions: "Sessions are NYSE trading days on the exchange's published calendar: " +
    "weekends and scheduled holidays are not sessions, and early closes are. A " +
    "closure the exchange did not schedule cannot be known in advance, so a count " +
    "that spans one is one session long until the day has passed.",
  priced: "The priced move scales the name's 30-day implied volatility to the " +
    "sessions between the run and the report, by the square root of time. No " +
    "rate, no dividend, no distribution. It is not a forecast of what the stock " +
    "will do, and it is not this desk's opinion of either. " +
    "IT IS ALSO NOT A QUOTE. Square-root-of-time assumes variance accrues " +
    "evenly across sessions, and a scheduled report is precisely the case that " +
    "violates it: the 30-day implied volatility already contains the event's " +
    "variance, and spreading it evenly over the two sessions before the report " +
    "understates the pre-event move badly. So this column is a CONSTANT-VOL " +
    "BENCHMARK computed by this desk, it is expected to sit below the vendor's " +
    "own event-bracketing quote beside it, and the amount by which it does is " +
    "published as its own column rather than left as a discrepancy.",
  eventPremium: "The event premium is the vendor's own implied move divided by " +
    "the constant-vol benchmark beside it — a ratio of two published numbers, " +
    "unit-free, and the only quantity on this row that is about the REPORT " +
    "rather than about the name's ambient volatility. A reading of 1 means the " +
    "vendor is charging no more than an ordinary stretch of the same length; a " +
    "reading of 3 means it is charging three times that. It is not an average " +
    "of the two horizons, which the note above refuses: an average of two " +
    "numbers quoted to two horizons is quoted to neither, while their ratio is " +
    "quoted to the difference between them, which is the event.",
  flow: "The flow columns are the tilts the screener already carries for every " +
    "eligible name: premium, net premium, aggressed contracts, volume surprise " +
    "and open-interest change, each as a share of that name's own gross, plus " +
    "the vendor's own put/call ratio and relative volume. They were computed on " +
    "every run and published for no name on this page, so the surface built for " +
    "the most event-exposed names in the universe could not say which of them " +
    "was seeing anomalous option activity. They cost no vendor call.",
  cap: "The table publishes the nearest reporters up to a row cap. Because the " +
    "rows are ordered by date, a bound cap does not thin the table — it ENDS " +
    "it, at a date earlier than the window, and everything past that date is " +
    "absent from the drawing rather than sparse in it. Whether the cap bound is " +
    "published beside the last date shown, so an empty right-hand half is never " +
    "attributed to the window when the cap is what stopped it.",
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
