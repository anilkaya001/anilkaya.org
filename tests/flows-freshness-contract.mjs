/* Contracts for shared/flows-freshness.js — the gate that decides which
   cron firings spend vendor calls.

   The instants below are fixed UTC moments chosen to sit on BOTH sides of
   the daylight-saving boundary, because the DST seam is where this
   repository's last clock gate silently skipped runs for half a year: a
   gate tested only in the offset its author's summer happened to be in is
   a gate tested once. */

import assert from "node:assert/strict";
import { easternClock, isRefreshWindow, REFRESH_CADENCE_MINUTES, easternDay} from "../shared/flows-freshness.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

/* ---------- the clock itself ----------------------------------- */
{
  const summer = easternClock(new Date("2026-07-08T13:31:00Z")); // EDT = UTC-4
  eq(summer.weekday, "Wed", "a July instant lands on the right Eastern weekday");
  eq(summer.minutes, 9 * 60 + 31, "and 13:31Z is 09:31 Eastern under daylight time");

  const winter = easternClock(new Date("2026-01-14T13:31:00Z")); // EST = UTC-5
  eq(winter.minutes, 8 * 60 + 31,
    "the SAME UTC wall-clock is 08:31 Eastern in January — the hour the gate " +
    "must not treat as equal to July's");

  eq(easternClock("not a date"), null, "an unreadable instant is null, not NaN minutes");
}

/* ---------- the window, on both sides of the DST seam ----------- */
{
  ok(isRefreshWindow(new Date("2026-07-08T13:31:00Z")), "summer 09:31 ET is inside");
  ok(!isRefreshWindow(new Date("2026-07-08T13:14:00Z")), "summer 09:14 ET is before the window");
  ok(isRefreshWindow(new Date("2026-07-08T13:15:00Z")), "the 09:15 edge is inclusive");
  ok(isRefreshWindow(new Date("2026-07-08T20:15:00Z")), "and so is the 16:15 close-settle edge");
  ok(!isRefreshWindow(new Date("2026-07-08T20:16:00Z")), "16:16 ET is outside");

  ok(isRefreshWindow(new Date("2026-01-14T14:31:00Z")), "winter 09:31 ET is inside");
  ok(!isRefreshWindow(new Date("2026-01-14T13:31:00Z")),
    "winter 08:31 ET is OUTSIDE even though the same UTC instant was inside in " +
    "July — the assertion that catches an offset table gone stale");
  ok(isRefreshWindow(new Date("2026-01-14T21:15:00Z")), "winter 16:15 ET is inside");
  ok(!isRefreshWindow(new Date("2026-01-14T21:16:00Z")), "winter 16:16 ET is not");
}

/* ---------- weekends and junk ----------------------------------- */
{
  ok(!isRefreshWindow(new Date("2026-07-11T14:00:00Z")), "a Saturday refreshes nothing");
  ok(!isRefreshWindow(new Date("2026-07-12T14:00:00Z")), "nor a Sunday");
  ok(!isRefreshWindow(new Date("garbage")), "an invalid date refuses rather than throwing");
}

/* ---------- an instant's Eastern DAY, which is not its ISO prefix ----

   A DATE AND AN INSTANT ARE DIFFERENT KINDS. Off-exchange prints are
   reported to 20:00 ET, so a print executed at 19:10 ET on a winter evening
   carries an `executed_at` whose UTC date is the NEXT day. Slicing ten
   characters off that stamp dates the print to a session that had not begun,
   and comparing the result against a sessionDate resolved in America/New_York
   then reports a feed as belonging to another session when every row is
   inside this one.

   This is the third time this repository has paid for the same confusion —
   daysToEarnings carries the warning, a dry-run fixture measured from
   Date.now() against a gate counting from an Eastern date, and the
   cross-section join dated its whole dark-pool feed to tomorrow. */
{
  eq(easternDay("2026-01-06T00:10:00Z"), "2026-01-05",
    "19:10 ET on 2026-01-05 under EST is the FIFTH's session, though its UTC stamp " +
    "reads the sixth — the ISO prefix of that instant is the wrong day");
  eq(easternDay("2026-07-07T00:10:00Z"), "2026-07-06",
    "and 20:10 ET on 2026-07-06 under EDT is the sixth's, so the answer is read " +
    "through the zone rather than a fixed offset");
  eq(easternDay("2026-01-05T14:30:00Z"), "2026-01-05",
    "a mid-session instant is its own day, which is the case that made the bug " +
    "invisible until the feed ran late");
  eq(easternDay(new Date("2026-01-06T00:10:00Z")), "2026-01-05",
    "a Date object answers the same as its ISO string");

  /* ABSENCE REFUSED BEFORE COERCION. `new Date(null)` is not an invalid date,
     it is the EPOCH — so a row with no timestamp would be dated 1969-12-31
     and published as a session. The NaN check alone does not catch it. */
  for (const v of [null, undefined, 0, "", "   ", false, "Thursday", "2026-09", NaN]) {
    eq(easternDay(v), null,
      `an unusable instant (${JSON.stringify(v)}) is null, never a coerced day — ` +
      `new Date(null) is the epoch and would have dated it 1969-12-31`);
  }
}

/* ---------- the published cadence ------------------------------- */
{
  eq(REFRESH_CADENCE_MINUTES, 15,
    "the cadence pages quote matches the wrangler.toml cron — a page promising " +
    "15-minute freshness against a 30-minute cron would be lying politely");
}

console.log(`✓ flows-freshness: ${checks} assertions — an Eastern clock read through the IANA ` +
  `zone rather than an offset table, a window inclusive at both stated edges, the same UTC ` +
  `instant inside in July and outside in January, dead weekends, and a cadence constant the ` +
  `pages can quote without lying, and an instant's EASTERN day told from the first ten ` +
  `characters of its ISO stamp — with the epoch refused rather than published as 1969`);
