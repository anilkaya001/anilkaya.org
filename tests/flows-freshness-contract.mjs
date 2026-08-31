/* Contracts for shared/flows-freshness.js — the gate that decides which
   cron firings spend vendor calls.

   The instants below are fixed UTC moments chosen to sit on BOTH sides of
   the daylight-saving boundary, because the DST seam is where this
   repository's last clock gate silently skipped runs for half a year: a
   gate tested only in the offset its author's summer happened to be in is
   a gate tested once. */

import assert from "node:assert/strict";
import { easternClock, isRefreshWindow, REFRESH_CADENCE_MINUTES } from "../shared/flows-freshness.js";

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

/* ---------- the published cadence ------------------------------- */
{
  eq(REFRESH_CADENCE_MINUTES, 15,
    "the cadence pages quote matches the wrangler.toml cron — a page promising " +
    "15-minute freshness against a 30-minute cron would be lying politely");
}

console.log(`✓ flows-freshness: ${checks} assertions — an Eastern clock read through the IANA ` +
  `zone rather than an offset table, a window inclusive at both stated edges, the same UTC ` +
  `instant inside in July and outside in January, dead weekends, and a cadence constant the ` +
  `pages can quote without lying`);
