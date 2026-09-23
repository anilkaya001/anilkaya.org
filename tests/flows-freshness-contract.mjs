import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  let compared = 0;
  const misses = [];
  for (let ms = Date.UTC(2024, 0, 1); ms < Date.UTC(2033, 0, 1); ms += 30 * 60000) {
    const p = Object.fromEntries(zone.formatToParts(ms).map((x) => [x.type, x.value]));
    const day = `${p.year}-${p.month}-${p.day}`;
    const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
    const c = easternClock(ms);
    if (easternDay(ms) !== day || c.minutes !== minutes || c.weekday !== p.weekday) {
      if (misses.length < 5) misses.push(new Date(ms).toISOString());
    }
    compared++;
  }
  eq(misses.length, 0,
    `the Eastern clock is arithmetic (the US daylight rule: second Sunday of March to first Sunday of ` +
    `November, 02:00 local) so a cold Worker isolate never pays the 16-23 ms ICU zone load inside its ` +
    `10 ms CPU budget, and it is proven equal to the IANA America/New_York zone at every half hour ` +
    `from 2024 to 2032 (${compared} instants; first misses ${misses.join(", ")}) — a change in the law ` +
    `reaches ICU first and fails here rather than drifting silently`);
}

{
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const crons = (/crons\s*=\s*\[([^\]]*)\]/.exec(toml) || [, ""])[1];
  const rth = /"(\d+)-59\/(\d+) 13-21 \* \* 1-5"/.exec(crons);
  ok(rth, `wrangler.toml carries the market-hours clock (${crons.trim()})`);
  eq(REFRESH_CADENCE_MINUTES, Number(rth[2]),
    "the cadence pages quote matches the wrangler.toml market-hours cron step — a page " +
    "promising 5-minute freshness against a 15-minute clock would be lying politely");
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

console.log(`✓ flows-freshness: ${checks} assertions — an Eastern clock proven equal to the IANA ` +
  `zone at every half hour 2024-2032 rather than a fixed offset, a window inclusive at both stated edges, the same UTC ` +
  `instant inside in July and outside in January, dead weekends, and a cadence constant the ` +
  `pages can quote without lying, and an instant's EASTERN day told from the first ten ` +
  `characters of its ISO stamp — with the epoch refused rather than published as 1969`);
