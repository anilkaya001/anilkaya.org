/* =============================================================
   flows-freshness.js — when an intraday refresh is worth a call.

   The nightly pipeline publishes once after the close; two feeds
   (the market tide and the vendor's flow alerts) fill DURING the
   session, so a page reading last night's copy shows a market
   that stopped moving at yesterday's close. The Worker's cron
   fires every 15 minutes around the clock; this module is the
   gate that decides which of those firings should spend vendor
   calls.

   WHY Intl AND NOT AN OFFSET TABLE: the session is defined in
   Eastern wall-clock time and the DST boundary has already bitten
   this repository once (the pipeline's cron gate skipped runs for
   half the year). Intl.DateTimeFormat with an IANA zone answers
   "what time is it in New York" without this file carrying its
   own daylight-saving calendar.
   ============================================================= */

/** Cadence the Worker cron is configured for, published so pages can
    say how stale "fresh" can legitimately be. A choice, not a fact. */
export const REFRESH_CADENCE_MINUTES = 15;

/* The regular session plus a quarter hour of settle at each end:
   09:15..16:15 Eastern. The pre-open quarter exists because the tide
   and the alerts both begin filling with the opening auction and a
   09:30-sharp gate would miss the first tick on a slow cron. */
const OPEN_MINUTES = 9 * 60 + 15;
const CLOSE_MINUTES = 16 * 60 + 15;

/**
 * Eastern wall-clock facts for an instant: weekday and minutes since
 * midnight. Exposed for the contract suite, which feeds it fixed
 * instants on both sides of a DST change.
 */
/**
 * THE EASTERN CALENDAR DAY OF AN INSTANT, which is not the first ten
 * characters of its ISO string.
 *
 * An off-exchange print executed at 19:10 ET on a January Tuesday carries
 * `executed_at` "…T00:10:00Z" — the NEXT UTC day. Slicing the ISO date out of
 * it dates that print to a session that had not started yet, and comparing
 * the result against a sessionDate resolved in America/New_York then reports
 * a feed as belonging to another session when every row is inside this one.
 *
 * This repository has paid for the same confusion twice: daysToEarnings says
 * MEASURED FROM A DATE, NOT FROM AN INSTANT, and a dry-run fixture that used
 * Date.now() against a gate counting from easternNow().date silently changed
 * every result across midnight. A date and an instant are different kinds,
 * and the conversion between them needs a zone.
 *
 * Returns null rather than a coerced today when the input is not a readable
 * instant — an undated row is not a row dated now.
 */
export function easternDay(at) {
  /* ABSENCE REFUSED BEFORE COERCION, and `new Date()` is why this cannot be
     left to the NaN check below. `new Date(null)` is not an invalid date — it
     is the EPOCH, so a row with no timestamp would have been dated 1969-12-31
     and published as a session. The same is true of 0 and of a bare number.

     THE SHAPE IS CHECKED BEFORE THE PARSE for the second reason flows-ui.js
     checks it: Date.parse is lenient enough to be dangerous. "2026-09" comes
     back FINITE and means midnight UTC on the first — whose EASTERN day is
     the 31st of August, a day the caller never sent. And this function
     converts an INSTANT, so a bare "2026-01-05" is not merely lenient but
     wrong: midnight UTC is the previous evening in New York. A timestamp
     needs a time. */
  const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
  const usable = at instanceof Date ||
    (typeof at === "string" && INSTANT.test(at.trim()));
  if (!usable) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((x) => [x.type, x.value]));
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export function easternClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : null;
  };
  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  /* "24" is what hour12:false yields for midnight in some engines. */
  return { weekday, minutes: (hour % 24) * 60 + minute };
}

/**
 * Whether an instant falls inside the refresh window: a weekday,
 * 09:15..16:15 Eastern, whichever offset is in force that day.
 * Holidays are NOT modelled — a holiday refresh spends a handful of
 * calls re-reading a quiet feed, which is cheaper than this module
 * carrying an exchange calendar it would then have to keep true.
 */
export function isRefreshWindow(date) {
  const clock = easternClock(date);
  if (!clock) return false;
  if (clock.weekday === "Sat" || clock.weekday === "Sun") return false;
  return clock.minutes >= OPEN_MINUTES && clock.minutes <= CLOSE_MINUTES;
}
