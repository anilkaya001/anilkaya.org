import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { easternClock, isRefreshWindow, REFRESH_CADENCE_MINUTES, easternDay, lastCompletedSession,
  isTradingDay, isHoliday, isEarlyCloseDay, prevTradingDay, nextTradingDay, phaseAt, expectedNightlySession,
  freshnessState, sessionOpen, easternInstant, closeMinutes, PHASE_MINUTES, FRESH_CLASSES }
  from "../shared/flows-freshness.js";
import { nyseHolidays, nyseEarlyCloses, closeUtcMs, etDayOf } from "../shared/flows-quant-time.js";
import { briefAge } from "../shared/flows-ask.js";
import { sessionsBetween } from "../shared/flows-cross.js";
import { nextSessionAfter } from "../shared/flows-variation.js";
import { serveNow } from "../shared/flows-live-worker.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const same = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

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

const YEAR_NOW = new Date().getUTCFullYear();
const FIRST_YEAR = YEAR_NOW - 1;
const LAST_YEAR = YEAR_NOW + 6;

{
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false,
  });
  const parts = (ms) => Object.fromEntries(zone.formatToParts(ms).map((x) => [x.type, x.value]));
  let compared = 0;
  const misses = [];
  const quantMisses = [];
  for (let ms = Date.UTC(FIRST_YEAR, 0, 1); ms < Date.UTC(LAST_YEAR + 1, 0, 1); ms += 30 * 60000) {
    const p = parts(ms);
    const day = `${p.year}-${p.month}-${p.day}`;
    const minutes = (Number(p.hour) % 24) * 60 + Number(p.minute);
    const c = easternClock(ms);
    if (easternDay(ms) !== day || c.minutes !== minutes || c.weekday !== p.weekday) {
      if (misses.length < 5) misses.push(new Date(ms).toISOString());
    }
    if (etDayOf(ms) !== day && quantMisses.length < 5) quantMisses.push(new Date(ms).toISOString());
    compared++;
  }
  eq(misses.length, 0,
    `the Eastern clock is arithmetic (the US daylight rule: second Sunday of March to first Sunday of ` +
    `November, 02:00 local) so a cold Worker isolate never pays the 16-23 ms ICU zone load inside its ` +
    `10 ms CPU budget, and it is proven equal to the IANA America/New_York zone at every half hour ` +
    `from ${FIRST_YEAR} to ${LAST_YEAR}, a window computed from today's date so it never ages out ` +
    `(${compared} instants; first misses ${misses.join(", ")}) — a change in the law ` +
    `reaches ICU first and fails here rather than drifting silently`);
  eq(quantMisses.length, 0,
    `and the options engine's own day rule (flows-quant-time etDayOf) is held to the same zone at the same ` +
    `instants (first misses ${quantMisses.join(", ")})`);

  const closeMisses = [];
  for (let t = Date.UTC(FIRST_YEAR, 0, 1); t < Date.UTC(LAST_YEAR + 1, 0, 1); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const p = parts(closeUtcMs(day));
    const want = isEarlyCloseDay(day) ? "13:00" : "16:00";
    if (`${p.year}-${p.month}-${p.day}` !== day || `${p.hour}:${p.minute}` !== want) {
      if (closeMisses.length < 5) closeMisses.push(day + " " + p.hour + ":" + p.minute);
    }
    if (easternInstant(day, closeMinutes(day)) !== closeUtcMs(day) && closeMisses.length < 5) closeMisses.push(day + " disagrees");
  }
  eq(closeMisses.length, 0,
    `the engine's expiry close (closeUtcMs, on its own daylight rule usDst) is 16:00 New York on every day from ` +
    `${FIRST_YEAR} to ${LAST_YEAR} and 13:00 on each early close, read back through ICU, and the freshness ` +
    `calendar puts the same close at the same instant (first misses ${closeMisses.join(", ")})`);
}

const NYSE_PUBLISHED = Object.freeze({
  2026: { holidays: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03",
    "2026-09-07", "2026-11-26", "2026-12-25"], early: ["2026-11-27", "2026-12-24"] },
  2027: { holidays: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
    "2027-09-06", "2027-11-25", "2027-12-24"], early: ["2027-11-26"] },
  2028: { holidays: ["2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04",
    "2028-09-04", "2028-11-23", "2028-12-25"], early: ["2028-07-03", "2028-11-24"] },
});

{
  for (const [y, want] of Object.entries(NYSE_PUBLISHED)) {
    same([...nyseHolidays(Number(y))].sort(), want.holidays,
      `the computed ${y} NYSE holidays are the exchange's published list, observed-day rules included ` +
      `(Juneteenth and Independence Day on a Saturday close the Friday, New Year's Day on a Saturday closes nothing)`);
    same([...nyseEarlyCloses(Number(y))].sort(), want.early,
      `and the ${y} 13:00 early closes are its published list: the day after Thanksgiving, and 3 July and 24 December ` +
      `only when they fall Monday to Thursday`);
  }
}

{
  let cases = 0;
  const noonMs = (day) => easternInstant(day, 12 * 60);
  for (let y = 2026; y <= 2032; y++) {
    for (const h of [...nyseHolidays(y)].sort()) {
      ok(!isTradingDay(h) && isHoliday(h), `${h} is closed by the computed calendar, with no clock`);
      const next = nextTradingDay(h);
      const prev = prevTradingDay(next);
      ok(next > h && prev < h && isTradingDay(next) && isTradingDay(prev), `${h} sits between the sessions ${prev} and ${next}`);
      const noon = noonMs(next);
      const nightly = { readAt: easternInstant(prev, 20 * 60 + 8), session: prev, cadenceS: 0 };
      const f = freshnessState(nightly, noon);
      eq(f.state, "fresh",
        `AT 12:00 ET ON ${next}, THE SESSION AFTER THE ${h} HOLIDAY, the ${prev} nightly is fresh (${f.reason}, expected ${f.expected})`);
      eq(expectedNightlySession(noon), prev, `and the nightly expected then is ${prev}, never the holiday`);
      const age = briefAge({ sessionDate: prev }, new Date(noon));
      ok(age.expected === prev && age.stale === false,
        `and the AI brief's age says the same: expected ${age.expected}, not stale`);
      eq(lastCompletedSession(noon), prev, `and the last completed session at that noon is ${prev}`);
      eq(phaseAt(easternInstant(prev, 17 * 60)).nextOpen, sessionOpen(next),
        `the evening of ${prev} opens next on ${next}, skipping ${h}`);
      eq(phaseAt(noonMs(h)).phase, "closed", `and ${h} itself is closed at noon`);
      eq(nextSessionAfter(prev).date, next, "the variation horizon steps over it too");
      eq(sessionsBetween(prev, next), 1, "and the cross-section counts one session across it");
      cases++;
    }
  }
  ok(cases >= 60, `${cases} NYSE holidays from 2026 to 2032 walked`);

  for (let y = 2026; y <= 2032; y++) {
    for (const d of nyseEarlyCloses(y)) {
      eq(phaseAt(easternInstant(d, 13 * 60 + 5)).phase, "post",
        `at 13:05 on the ${d} early close the session is over with no clock at all`);
      eq(phaseAt(easternInstant(d, 12 * 60 + 55)).phase, "rth", "and it traded until 13:00");
    }
  }
}

{
  eq(FRESH_CLASSES.nightly.graceS, 5 * 3600,
    "the nightly is due five hours after the close: runs on 2026-09-23 and 09-24 started 23:48 and 23:56 UTC and " +
    "wrote meta at 00:08 UTC, 20:08 ET, so a three-hour grace called every weekday evening stale for an hour");
  const wed = "2026-09-23";
  eq(expectedNightlySession(easternInstant(wed, 20 * 60 + 59)), "2026-09-22", "at 20:59 ET the evening's run is not yet due");
  eq(expectedNightlySession(easternInstant(wed, 21 * 60)), wed, "and from 21:00 it is");
  eq(expectedNightlySession(easternInstant("2026-11-27", 18 * 60)), "2026-11-27",
    "an early close is due five hours after ITS close, 18:00 ET");
}

{
  const day = "2026-10-14";
  const clock = { day: "2026-10-15", trading: null, earlyClose: null, closedDays: [day] };
  ok(isTradingDay(day) && !isTradingDay(day, clock),
    "A PAST TAPE-PROVEN CLOSURE (flows_clock.closed_days) closes a day the computed calendar thought traded");
  eq(expectedNightlySession(easternInstant("2026-10-15", 12 * 60), clock), "2026-10-13",
    "so the morning after it the nightly expected is the session before the closure");
  eq(prevTradingDay("2026-10-15", clock), "2026-10-13", "and the previous session skips it");
  ok(isTradingDay(day, { closedDays: "2026-10-14" }), "a closed_days value that is not an array is ignored, not trusted");
  ok(!isTradingDay("2026-10-15", { day: "2026-10-15", trading: 0 }) && isTradingDay("2026-10-15", { day: "2026-10-14", trading: 0 }),
    "today's tape verdict closes today and never another day");
  ok(isTradingDay("2026-11-26", { day: "2026-11-26", trading: 1 }),
    "and a tape that saw today trade outranks the computed holiday, so a rule change can never silence a live session");
  eq(closeMinutes("2026-11-20", { day: "2026-11-20", earlyClose: 1 }), PHASE_MINUTES.earlyClose,
    "an unscheduled early close the tape detected is honoured");
}

{
  const env = { DB: { prepare: () => ({ first: async () => null, bind() { return this; } }) } };
  const body = await serveNow(env, new URL("https://x.test/api/flows/now"), easternInstant("2026-11-27", 12 * 60),
    { json: (b) => b, HttpError: Error });
  eq(body.expected, "2026-11-25",
    "/api/flows/now carries the server's expected nightly session, so the page pill stops keeping its own " +
    "weekday calendar: at noon the day after Thanksgiving it is the Wednesday before, not the holiday");
}

{
  const code = [
    "const cpu = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };",
    `const F = await import(${JSON.stringify(new URL("../shared/flows-freshness.js", import.meta.url).href)});`,
    "const at = Date.parse('2026-11-27T17:00:00Z');",
    "const w0 = performance.now(), c0 = cpu();",
    "F.phaseAt(at, null); F.freshnessState({ readAt: at - 3600e3, session: '2026-11-25', cadenceS: 0 }, at, null);",
    "const cold = Math.min(performance.now() - w0, cpu() - c0 + 4);",
    "const N = 5000; const c1 = cpu();",
    "for (let i = 0; i < N; i++) { F.phaseAt(at + i * 60000, null); F.expectedNightlySession(at + i * 60000, null); }",
    "console.log(JSON.stringify({ cold, warmUs: (cpu() - c1) / N * 1000 }));",
  ].join("\n");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
  const m = JSON.parse(r.stdout.trim());
  ok(m.cold < 3, `the calendar's first phase and nightly verdict in a fresh process cost ${m.cold.toFixed(2)} ms, ` +
    "holiday table built once per year, well inside the Worker's 10 ms");
  ok(m.warmUs < 50, `and ${m.warmUs.toFixed(1)} µs per phase plus nightly verdict warm`);
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

{
  const vm = await import("node:vm");
  const src = readFileSync(new URL("../assets/js/flows-ui.js", import.meta.url), "utf8");
  const pill = (iso, answer) => {
    const asked = [];
    let release = null;
    const ctx = {
      console, setTimeout, clearTimeout, setInterval, clearInterval, URL,
      location: { href: "https://x.test/flows/" },
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      document: { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null,
        documentElement: { dataset: {}, style: {} }, hidden: false },
      fetch: (url) => {
        asked.push(String(url));
        return new Promise((resolve) => {
          release = () => resolve({ ok: answer !== null, status: answer ? 200 : 503, headers: { get: () => null },
            clone() { return this; }, json: async () => answer, text: async () => JSON.stringify(answer) });
        });
      },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(`(() => { const Real = Date; const fixed = Real.parse(${JSON.stringify(iso)});
      globalThis.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); }
        static now() { return fixed; } }; })();`, ctx);
    vm.runInContext(src, ctx);
    return { ctx, UI: ctx.window.FlowsUI, asked, release: async () => { if (release) release(); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); } };
  };

  {
    const p = pill("2026-09-23T20:30:00-04:00", null);
    const m = p.UI.freshness.market();
    ok(m.expected === "2026-09-22" && m.source === "local",
      "THE PILL'S OWN FALLBACK waits for the nightly until 21:00 ET, when it really lands (20:08 ET on 2026-09-24), " +
      "rather than calling every evening stale from 17:45");
    eq(pill("2026-09-23T21:00:00-04:00", null).UI.freshness.market().expected, "2026-09-23", "and expects it from 21:00");
  }
  {
    const p = pill("2026-11-27T12:00:00-05:00", { expected: "2026-11-25", phase: { phase: "rth", endsAt: "2026-11-27T18:00:00.000Z" } });
    p.UI.freshness({ sessionDate: "2026-11-25", source: "board" });
    ok(p.asked.length === 1 && /\/api\/flows\/now$/.test(p.asked[0]),
      "the day after Thanksgiving the weekday fallback would call the Wednesday session stale, so the pill asks the server once");
    eq(p.UI.freshness.state(), "fresh", "and while it asks it never flashes stale");
    await p.release();
    const m = p.UI.freshness.market();
    ok(m.expected === "2026-11-25" && m.source === "server" && m.open === true,
      "then it dates the page by the server's expected nightly session and the server's phase, not its own weekday calendar");
    eq(p.UI.freshness.state(), "fresh", "so the Wednesday session is current on the Friday after Thanksgiving, not stale");
    p.UI.freshness({ sessionDate: "2026-11-25", source: "board" });
    eq(p.asked.length, 1, "and it asks no more while the server's answer is fresh");
  }
  {
    const p = pill("2026-11-27T12:00:00-05:00", null);
    p.UI.freshness({ sessionDate: "2026-11-24", source: "board" });
    await p.release();
    eq(p.UI.freshness.state(), "stale", "when the server cannot be reached, the fallback's stale stands: a truly old page still says so");
  }
  {
    const p = pill("2026-09-25T12:00:00-04:00", { expected: "2026-09-24", phase: { phase: "rth", endsAt: "2026-09-25T20:00:00.000Z" } });
    p.ctx.fetch("/api/flows/now?k=market");
    await p.release();
    p.UI.freshness({ sessionDate: "2026-09-16", source: "card", primary: true });
    p.UI.freshness({ sessionDate: "2026-09-24", source: "card-x" });
    eq(p.UI.freshness.state(), "stale",
      "A PRIMARY SOURCE DATES THE PAGE: a 09-16 card with a 09-24 card-x beside it is stale, where the newest-wins rule said " +
      "Sep 24 over MU's nine-day-old price");
    const q = pill("2026-09-25T12:00:00-04:00", null);
    q.UI.freshness({ sessionDate: "2026-09-16", source: "a" });
    q.UI.freshness({ sessionDate: "2026-09-24", source: "b" });
    eq(q.UI.freshness.state(), "fresh", "without a primary the newest session still wins, as before");
  }
}

console.log(`✓ flows-freshness: ${checks} assertions — an Eastern clock and the engine's own day and close rules ` +
  `proven equal to the IANA zone at every half hour ${FIRST_YEAR}-${LAST_YEAR} rather than a fixed offset, one NYSE ` +
  `calendar matching the exchange's published 2026-2028 holidays and early closes, every holiday to 2032 stepped over ` +
  `by the nightly, the brief, the phase, the variation horizon and the session count, a window inclusive at both stated edges, the same UTC ` +
  `instant inside in July and outside in January, dead weekends, and a cadence constant the ` +
  `pages can quote without lying, and an instant's EASTERN day told from the first ten ` +
  `characters of its ISO stamp — with the epoch refused rather than published as 1969`);
