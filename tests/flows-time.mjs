import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { instantOf, clock, stamp, day, when, axisMinutes, tick, boundaries, sessionSaid, phaseSaid, nextOpenSaid,
  TRT_OFFSET_MIN, TRT_LABEL } from "../shared/flows-time.js";
import { workerSource, expect } from "./lib/source-scan.mjs";
import { phaseAt, isTradingDay, isEarlyCloseDay, shiftDay, nextTradingDay, sessionClose, sessionOpen, easternInstant,
  PHASE_MINUTES } from "../shared/flows-freshness.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };
const same = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

eq(TRT_OFFSET_MIN, 180, "TRT is fixed at UTC+3");
eq(TRT_LABEL, "TRT", "the label is the literal TRT");

{
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2029, 0, 1);
  let n = 0;
  for (let t = start; t < end; t += 1800000) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const want = p.year + "-" + p.month + "-" + p.day + " " + p.hour + ":" + p.minute + " TRT";
    if (stamp(t) !== want) assert.equal(stamp(t), want, "TRT equals Europe/Istanbul at " + new Date(t).toISOString());
    n++;
  }
  checks += n;
  eq(clock(Date.UTC(2026, 9, 12, 13, 31)), "16:31 TRT", "13:31Z is 16:31 TRT");
  eq(clock(Date.UTC(2026, 9, 12, 13, 31), false), "16:31", "the zone can be left off");
  eq(stamp("2026-10-11T22:30:00Z"), "2026-10-12 01:30 TRT", "late UTC lands on the next TRT day");
  eq(day("2026-10-11T22:30:00Z"), "2026-10-12", "and its TRT day");
  eq(day(new Date("2026-10-11T20:59:59Z")), "2026-10-11", "one second before TRT midnight");
  eq(day(new Date("2026-10-11T21:00:00Z")), "2026-10-12", "at TRT midnight");
  eq(stamp("2026-10-11T22:30:00+02:00"), "2026-10-11 23:30 TRT", "an explicit offset is honoured");
  eq(clock("2026-10-11T22:30:00.123456Z"), "01:30 TRT", "fractional seconds parse");
  eq(when("2026-10-11T22:30:00Z", "2026-10-11T23:00:00Z"), "01:30 TRT", "same TRT day drops the date");
  eq(when("2026-10-11T22:30:00Z", "2026-10-11T10:00:00Z"), "2026-10-12 01:30 TRT", "another day keeps the date");
  eq(when("2026-10-11T22:30:00Z", "junk"), "2026-10-12 01:30 TRT", "an unreadable now keeps the date");
}

{
  const bad = [null, undefined, NaN, Infinity, -Infinity, -1, 0, -0, "", "2026-10-11", "2026-10-11T10:00:00",
    "2026-10-11 10:00", "2026-13-01T10:00:00Z", "2026-02-30T10:00:00Z", "2026-10-11T25:00:00Z", "2026-10-11T10:60:00Z",
    "2026-10-11T10:00:00+25:00", "junk", {}, [], true, new Date(NaN), 1e20, "10:00 TRT", 8.64e15];
  for (const v of bad) {
    eq(instantOf(v), null, "instantOf refuses " + String(v));
    eq(clock(v), null, "clock prints nothing for " + String(v));
    eq(stamp(v), null, "stamp prints nothing for " + String(v));
    eq(day(v), null, "day prints nothing for " + String(v));
    eq(when(v, Date.now()), null, "when prints nothing for " + String(v));
  }
  eq(axisMinutes(Date.UTC(2026, 9, 12), "2026-02-30"), null, "an impossible session day has no axis");
  eq(axisMinutes(Date.UTC(2026, 9, 12), "2026-10"), null, "a partial session day has no axis");
  eq(axisMinutes("2026-10-12", "2026-10-12"), null, "a date-only instant has no axis");
  eq(tick(NaN), null, "tick of NaN");
  eq(tick("5"), null, "tick of a string");
  eq(boundaries("2026-10-10", null), null, "a Saturday has no boundaries");
  eq(boundaries("2026-07-03", null), null, "a holiday has no boundaries");
  eq(boundaries("junk", null), null, "junk has no boundaries");
  eq(sessionSaid("2026-10-10", null), null, "no wording for a closed day");
  eq(nextOpenSaid(null), null, "no next open without a phase");
  eq(nextOpenSaid({ nextOpen: NaN }), null, "NaN next open prints nothing");
  eq(instantOf(1), 1, "a positive number is an instant");
  eq(instantOf(new Date(5)), 5, "a Date is an instant");
  eq(instantOf("2026-10-11T10:00:00Z"), Date.UTC(2026, 9, 11, 10), "a Z string is an instant");
}

const table = {
  "2026-03-06": ["12:00", "17:30", "00:00", "04:00"],
  "2026-03-09": ["11:00", "16:30", "23:00", "03:00"],
  "2026-10-30": ["11:00", "16:30", "23:00", "03:00"],
  "2026-11-02": ["12:00", "17:30", "00:00", "04:00"],
  "2026-11-27": ["12:00", "17:30", "21:00", "04:00"],
  "2026-12-24": ["12:00", "17:30", "21:00", "04:00"],
  "2027-03-12": ["12:00", "17:30", "00:00", "04:00"],
  "2027-03-15": ["11:00", "16:30", "23:00", "03:00"],
  "2027-11-05": ["11:00", "16:30", "23:00", "03:00"],
  "2027-11-08": ["12:00", "17:30", "00:00", "04:00"],
};
for (const [d, [pre, open, close, post]] of Object.entries(table)) {
  const b = boundaries(d, null);
  ok(b !== null, d + " is a trading day");
  eq(b.pre.trt, pre, d + " pre");
  eq(b.open.trt, open, d + " open");
  eq(b.close.trt, close, d + " close");
  eq(b.post.trt, post, d + " post");
}
for (const d of ["2026-03-06", "2026-03-09", "2026-10-30", "2026-11-02", "2027-03-12", "2027-03-15", "2027-11-05", "2027-11-08"]) {
  const b = boundaries(d, null);
  eq(b.early, false, d + " is a full day");
  eq(b.close.nextDay, b.close.trt === "00:00", d + " close crosses TRT midnight only in winter");
  eq(b.open.nextDay, false, d + " open is the same TRT day");
}
{
  const thanksgiving = boundaries("2026-11-27", null);
  eq(thanksgiving.early, true, "the day after Thanksgiving closes early");
  eq(thanksgiving.close.nextDay, false, "an early winter close stays on the same TRT day");
  const x = boundaries("2026-12-24", null);
  eq(x.early, true, "Christmas Eve closes early");
  eq(x.open.trt, "17:30", "and opens at 17:30 TRT");
  const inferred = boundaries("2026-10-30", { day: "2026-10-30", trading: 1, earlyClose: 1 });
  eq(inferred.early, true, "an inferred early close from the clock row");
  eq(inferred.close.trt, "20:00", "closes 20:00 TRT in summer");
  const winterInferred = boundaries("2026-11-02", { day: "2026-11-02", trading: 1, earlyClose: 1 });
  eq(winterInferred.close.trt, "21:00", "closes 21:00 TRT in winter");
  eq(boundaries("2026-11-02", { day: "2026-11-02", trading: 0 }), null, "a clock row that says closed has none");
}

eq(sessionSaid("2026-10-12", null), "Regular 16:30-23:00 TRT", "summer wording");
eq(sessionSaid("2026-11-02", null), "Regular 17:30-00:00 TRT", "winter wording never prints 24:00");
eq(sessionSaid("2026-11-27", null), "Regular 17:30-21:00 TRT", "early close wording");
eq(phaseSaid("pre", "2026-10-12", null), "Pre-market 11:00-16:30 TRT", "summer pre-market wording");
eq(phaseSaid("post", "2026-10-12", null), "After hours 23:00-03:00 TRT", "summer after-hours wording");
eq(phaseSaid("pre", "2026-11-02", null), "Pre-market 12:00-17:30 TRT", "winter pre-market wording");
eq(phaseSaid("post", "2026-11-02", null), "After hours 00:00-04:00 TRT", "winter after-hours wording");
eq(phaseSaid("post", "2026-11-27", null), "After hours 21:00-04:00 TRT", "early close after-hours wording");
eq(phaseSaid("rth", "2026-10-12", null), "Regular 16:30-23:00 TRT", "rth wording");
eq(phaseSaid("closed", "2026-10-10", null), "Closed", "closed wording");
eq(phaseSaid("weird", "2026-10-12", null), null, "an unknown phase has no wording");
eq(phaseSaid("pre", "2026-10-10", null), null, "no pre-market wording on a Saturday");

{
  const fri = phaseAt(Date.parse("2026-10-10T01:00:00Z"));
  eq(fri.phase, "closed", "Friday 21:00 Eastern is closed");
  eq(nextOpenSaid(fri), "opens Mon 16:30 TRT", "from Friday after close the next open is Monday summer");
  const winterFri = phaseAt(Date.parse("2026-11-07T02:00:00Z"));
  eq(nextOpenSaid(winterFri), "opens Mon 17:30 TRT", "and Monday winter");
  const sunday = phaseAt(Date.parse("2026-11-01T12:00:00Z"));
  eq(nextOpenSaid(sunday), "opens Mon 17:30 TRT", "from the Sunday of the change");
  const holiday = phaseAt(Date.parse("2026-12-25T15:00:00Z"));
  eq(nextOpenSaid(holiday), "opens Mon 17:30 TRT", "from a Friday holiday the next open is Monday");
  const lateTrt = phaseAt(Date.parse("2026-11-04T23:00:00Z"));
  eq(nextOpenSaid(lateTrt), "opens Thu 17:30 TRT", "after a winter close, midnight TRT, the next open is the next day");
}

{
  let days = 0;
  let nextDayCloses = 0;
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
  const wall = (ms) => hhmm.format(new Date(ms));
  for (let d = "2026-01-01"; d < "2028-01-01"; d = shiftDay(d, 1)) {
    if (!isTradingDay(d, null)) {
      eq(boundaries(d, null), null, d + " closed has no boundaries");
      continue;
    }
    days++;
    const b = boundaries(d, null);
    ok(b.pre.ms < b.open.ms && b.open.ms < b.close.ms && b.close.ms < b.post.ms, d + " order");
    eq(b.open.ms, sessionOpen(d), d + " open is the engine's");
    eq(b.close.ms, sessionClose(d, null), d + " close is the engine's");
    eq(b.pre.trt, wall(b.pre.ms), d + " pre equals Intl");
    eq(b.open.trt, wall(b.open.ms), d + " open equals Intl");
    eq(b.close.trt, wall(b.close.ms), d + " close equals Intl");
    eq(b.post.trt, wall(b.post.ms), d + " post equals Intl");
    eq(day(b.open.ms), d, d + " opens on its own TRT day");
    eq(b.early, isEarlyCloseDay(d), d + " early flag");
    const summer = b.open.trt === "16:30";
    eq(b.open.trt, summer ? "16:30" : "17:30", d + " open is one of the two");
    eq(b.close.trt, b.early ? (summer ? "20:00" : "21:00") : (summer ? "23:00" : "00:00"), d + " close by season");
    eq(b.close.nextDay, b.close.trt === "00:00", d + " nextDay");
    if (b.close.nextDay) nextDayCloses++;
    let prev = -Infinity;
    for (let ms = b.open.ms; ms <= b.close.ms; ms += 60000) {
      const m = axisMinutes(ms, d);
      if (!(m > prev)) assert.fail(d + " axis not increasing at " + new Date(ms).toISOString());
      prev = m;
    }
    checks++;
    eq(axisMinutes(b.open.ms, d), (summer ? 16 : 17) * 60 + 30, d + " axis at the open");
    eq(axisMinutes(b.close.ms, d) % 1440, b.close.trt === "00:00" ? 0 : Number(b.close.trt.slice(0, 2)) * 60, d + " axis at the close");
    eq(tick(axisMinutes(b.close.ms, d)), b.close.trt, d + " the close tick");
    eq(tick(axisMinutes(b.open.ms, d)), b.open.trt, d + " the open tick");
  }
  ok(days > 480, "two years of sessions swept: " + days);
  ok(nextDayCloses > 100, "winter closes at TRT midnight were swept: " + nextDayCloses);
  eq(axisMinutes(sessionClose("2026-11-02", null), "2026-11-02"), 1440, "the winter close is minute 1440 of its session day");
  eq(tick(1440), "00:00", "1440 prints 00:00");
  eq(tick(1500), "01:00", "1500 prints 01:00");
  eq(tick(-60), "23:00", "a negative minute wraps");
  eq(tick(90), "01:30", "90 prints 01:30");
}

{
  const d = "2026-11-09";
  const n = nextTradingDay("2026-11-06", null);
  eq(n, d, "the Monday after a Friday");
  eq(easternInstant(d, PHASE_MINUTES.open), sessionOpen(d), "the engine's open equals the Eastern instant");
}

{
  const probe = `
    const m = await import(${JSON.stringify(pathToFileURL(new URL("../shared/flows-time.js", import.meta.url).pathname).href)});
    const ins = [Date.UTC(2026,9,11,22,30), "2026-03-08T07:30:00Z", "2026-11-01T05:59:59Z", new Date("2027-03-14T07:00:00Z"), 1767225600000];
    const out = [];
    for (const v of ins) out.push(m.clock(v), m.stamp(v), m.day(v), m.when(v, ins[0]), m.axisMinutes(v, "2026-10-11"));
    for (const d of ["2026-03-06","2026-03-09","2026-11-02","2026-11-27","2027-11-08"]) {
      out.push(JSON.stringify(m.boundaries(d, null)), m.sessionSaid(d, null), m.phaseSaid("pre", d, null), m.phaseSaid("post", d, null));
    }
    out.push(m.instantOf("2026-10-11"), m.tick(1500));
    process.stdout.write(JSON.stringify(out));
  `;
  const run = (tz) => {
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
    assert.equal(r.status, 0, tz + " child: " + r.stderr);
    return r.stdout;
  };
  const base = run("UTC");
  ok(base.length > 100, "the probe printed");
  for (const tz of ["America/New_York", "Europe/Istanbul", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata"]) {
    eq(run(tz), base, "output under TZ=" + tz + " equals UTC");
  }
}

{
  const w = workerSource();
  checks += expect(w, /const ASK_NOT_TICKERS = new Set\(\[[^\]]*"TRT"[^\]]*\]\)/, { min: 1, max: 1, why: "TRT is a real ticker, so Ask must not read the zone label as one" });
}

console.log(`✓ flows-time: ${checks} assertions — TRT as fixed UTC+3 arithmetic proven equal to Europe/Istanbul at every half hour 2026-2028, ` +
  `the regular session's open, close and the pre and post bounds in TRT derived from the exchange clock (16:30-23:00 in US summer time, ` +
  `17:30-00:00 in standard time, early closes 20:00 and 21:00), a session-anchored axis strictly increasing across TRT midnight over every ` +
  `trading day of 2026-2027, hostile inputs printing nothing, and the same output under five process time zones`);
