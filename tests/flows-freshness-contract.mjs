import assert from "node:assert/strict";
import { easternClock, isRefreshWindow, REFRESH_CADENCE_MINUTES, easternDay, lastCompletedSession }
  from "../shared/flows-freshness.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };

{
  const summer = easternClock(new Date("2026-07-08T13:31:00Z"));
  eq(summer.weekday, "Wed", "a July instant lands on the right Eastern weekday");
  eq(summer.minutes, 9 * 60 + 31, "and 13:31Z is 09:31 Eastern under daylight time");

  const winter = easternClock(new Date("2026-01-14T13:31:00Z"));
  eq(winter.minutes, 8 * 60 + 31,
    "the SAME UTC wall-clock is 08:31 Eastern in January — the hour the gate " +
    "must not treat as equal to July's");

  eq(easternClock("not a date"), null, "an unreadable instant is null, not NaN minutes");
}

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

{
  ok(!isRefreshWindow(new Date("2026-07-11T14:00:00Z")), "a Saturday refreshes nothing");
  ok(!isRefreshWindow(new Date("2026-07-12T14:00:00Z")), "nor a Sunday");
  ok(!isRefreshWindow(new Date("garbage")), "an invalid date refuses rather than throwing");
}

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

  for (const v of [null, undefined, 0, "", "   ", false, "Thursday", "2026-09", NaN]) {
    eq(easternDay(v), null,
      `an unusable instant (${JSON.stringify(v)}) is null, never a coerced day — ` +
      `new Date(null) is the epoch and would have dated it 1969-12-31`);
  }
}

{
  eq(REFRESH_CADENCE_MINUTES, 15,
    "the cadence pages quote matches the wrangler.toml cron — a page promising " +
    "15-minute freshness against a 30-minute cron would be lying politely");
}

{
  eq(lastCompletedSession(new Date("2026-07-08T21:00:00Z")), "2026-07-08",
    "Wednesday 17:00 ET: today's session has closed and settled, so today");
  eq(lastCompletedSession(new Date("2026-07-08T18:00:00Z")), "2026-07-07",
    "Wednesday 14:00 ET: today is still open, so yesterday");
  eq(lastCompletedSession(new Date("2026-07-08T20:15:00Z")), "2026-07-07",
    "the 16:15 settle edge itself still counts the day as open — the same edge the " +
    "refresh window keeps inclusive");
  eq(lastCompletedSession(new Date("2026-07-11T15:00:00Z")), "2026-07-10",
    "Saturday: the Friday before");
  eq(lastCompletedSession(new Date("2026-07-13T12:00:00Z")), "2026-07-10",
    "Monday 08:00 ET: still Friday, across the weekend");
  eq(lastCompletedSession(new Date("2026-01-14T21:30:00Z")), "2026-01-14",
    "Wednesday 16:30 ET in January — closed under standard time, where the same UTC " +
    "instant would still be open in July");
  eq(lastCompletedSession(new Date("2026-07-14T02:30:00Z")), "2026-07-13",
    "22:30 ET on Monday is Tuesday in UTC and is still Monday's session in New York");
  eq(lastCompletedSession("nope"), null, "an unreadable instant is null");
}

console.log(`✓ flows-freshness: ${checks} assertions — an Eastern clock read through the IANA ` +
  `zone rather than an offset table, a window inclusive at both stated edges, the same UTC ` +
  `instant inside in July and outside in January, dead weekends, and a cadence constant the ` +
  `pages can quote without lying, and an instant's EASTERN day told from the first ten ` +
  `characters of its ISO stamp — with the epoch refused rather than published as 1969`);
