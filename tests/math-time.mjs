import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bootUI } from "./lib/ui-boot.mjs";
import { isTradingDay, closeMinutes, easternOffsetMinutes, easternDay } from "../shared/flows-freshness.js";
import { isSession, nyseEarlyCloses, etDayOf, closeUtcMs, yearFraction, YEAR_SECONDS } from "../shared/flows-quant-time.js";
import { loadMutated } from "./truth/mutants.mjs";
import { boundaries } from "../shared/flows-time.js";

const HERE = new URL("./", import.meta.url);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.equal(a, b, m); checks++; };

const FX = JSON.parse(readFileSync(new URL("fixtures-math-time.json", HERE), "utf8"));
eq(FX.provenance.generatorSha256, createHash("sha256").update(readFileSync(new URL("gen-math-time-fixtures.py", HERE))).digest("hex"),
  "the fixture was written by this version of the generator");

const closed = new Set(FX.holidays);
const DAY = 864e5;
let sessions = 0;
for (let t = Date.UTC(2015, 0, 1); t <= Date.UTC(2031, 11, 31); t += DAY) {
  const d = new Date(t).toISOString().slice(0, 10);
  const weekday = new Date(t).getUTCDay() % 6 !== 0;
  const want = weekday && !closed.has(d);
  if (isTradingDay(d) !== want || isSession(d) !== want) assert.fail(`${d}: production says ${isTradingDay(d)} / ${isSession(d)}, the exchange calendar says ${want}`);
  checks++;
  if (!want) continue;
  sessions++;
  const early = FX.early[d] === 780;
  if (closeMinutes(d) !== (early ? 780 : 960)) assert.fail(`${d}: close at ${closeMinutes(d)} where the exchange calendar closes at ${early ? 780 : 960}`);
  if (nyseEarlyCloses(Number(d.slice(0, 4))).has(d) !== early) assert.fail(`${d}: the early-close table disagrees with the exchange calendar`);
  checks += 2;
}
eq(sessions, FX.sessionCount, "the production calendar finds the same number of sessions from 2015 to 2031 as exchange_calendars");
ok(Object.keys(FX.early).length === 37, "and the same 37 early closes");

for (const [ms, day, offset] of FX.instants) {
  eq(easternOffsetMinutes(ms), offset, `the Eastern offset at ${new Date(ms).toISOString()} is ${offset}`);
  eq(easternDay(ms), day, `the Eastern day at ${new Date(ms).toISOString()} is ${day}`);
  eq(etDayOf(ms), day, `and so is the quant clock's at ${new Date(ms).toISOString()}`);
}

const spanOf = (daylight, early) => FX.trtSpans.find((s) => s.usDaylightTime === daylight && s.earlyClose === early);
const dstRows = new Map(FX.dst.map((r) => [r.year, r]));
let spans = 0;
for (let t = Date.UTC(2017, 0, 1); t <= Date.UTC(2031, 11, 31); t += DAY) {
  const d = new Date(t).toISOString().slice(0, 10);
  if (!isTradingDay(d)) continue;
  const y = Number(d.slice(0, 4)), row = dstRows.get(y);
  const daylight = d >= row.usDaylightFrom && d < row.usStandardFrom;
  const span = spanOf(daylight, FX.early[d] === 780);
  const b = boundaries(d);
  const midnight = t - 3 * 3600000;
  eq(b.open.ms, midnight + span.openTrtMin * 60000, `${d}: the open is at ${span.openTrtMin} minutes TRT`);
  eq(b.close.ms, midnight + span.closeTrtMin * 60000, `${d}: the close is at ${span.closeTrtMin} minutes TRT`);
  eq(b.close.nextDay, span.closeTrtMin >= 1440, `${d}: the winter close falls on the next TRT calendar day, and only then`);
  spans++;
}
ok(spans > 3600, "every session from 2017 to 2031 has its TRT open and close checked against zoneinfo");
eq(spanOf(false, false).closeTrtMin, 1440, "in US standard time the regular close is 00:00 TRT, the next calendar day");
eq(spanOf(true, false).openTrtMin, 990, "and in US daylight time the open is 16:30 TRT");

function yearBattery(M) {
  const bad = [];
  let n = 0;
  for (const [minute, list] of Object.entries(FX.closesUtc)) {
    for (const d of list) {
      const want = Date.parse(d + "T00:00:00Z") + Number(minute) * 60000;
      n++;
      if (M.closeUtcMs(d) !== want) { if (bad.length < 6) bad.push(`${d}: the close is ${M.closeUtcMs(d)} where the exchange closes at ${want}`); continue; }
      if (n % 7 !== 0) continue;
      const week = M.yearFraction(want - 7 * DAY, d);
      if (week !== 7 / 365 && bad.length < 6) bad.push(`${d}: a week before the close is ${week} years, not 7/365`);
      const minuteBefore = M.yearFraction(want - 60000, d);
      if (minuteBefore !== 1 / 525600 && bad.length < 6) bad.push(`${d}: a minute before the close is ${minuteBefore} years, not 1/525600`);
      if (M.yearFraction(want, d) !== 0 && bad.length < 6) bad.push(`${d}: at the close the time left is ${M.yearFraction(want, d)}`);
      if (!(M.yearFraction(want + 60000, d) < 0) && bad.length < 6) bad.push(`${d}: a minute after the close the time left is not negative`);
    }
  }
  return bad;
}
eq(yearBattery({ closeUtcMs, yearFraction }).join("; "), "", "the time to expiry runs to the exchange's own close of the expiry day (16:00 New York, 13:00 on the 37 early closes), in whole minutes over 525,600, and is negative after it");
eq(YEAR_SECONDS, 365 * 86400, "and a year is 365 days of 86,400 seconds, the implied-volatility convention");
for (const [name, transforms] of [
  ["the close is taken at 21:00 UTC whatever the day", [["export function yearFraction(asOfMs, expiryDay) {\n  const close = closeUtcMs(expiryDay);", "export function yearFraction(asOfMs, expiryDay) {\n  const close = Date.parse(expiryDay + \"T21:00:00Z\");"]]],
  ["the year is 252 days", [["export const YEAR_SECONDS = 365 * 86400;", "export const YEAR_SECONDS = 252 * 86400;"]]],
  ["the time left is measured in whole days", [["return (close - asOfMs) / (YEAR_SECONDS * 1000);", "return Math.round((close - asOfMs) / 86400000) * 86400 / YEAR_SECONDS;"]]],
]) {
  let mod;
  try { mod = await loadMutated("shared/flows-quant-time.js", transforms, { salt: Math.floor(Math.random() * 1e6) }); } catch (e) { assert.fail(`the planted build '${name}' did not load: ${e.message}`); }
  ok(yearBattery(mod).length > 0, `planted wrong build must fail: ${name}`);
}

const UI = bootUI();
{
  const printAt = (iso) => Date.parse(iso);
  const lastRegular = printAt("2026-01-15T20:59:59Z"), close = printAt("2026-01-15T21:00:00Z"), after = printAt("2026-01-15T22:00:00Z"), late = printAt("2026-01-16T00:59:59Z");
  eq(UI.F.trtDay(lastRegular), "2026-01-15", "a print at 15:59:59 EST is 23:59:59 TRT on the 15th");
  eq(UI.F.trtDay(close), "2026-01-16", "the close, 16:00 EST, is already the 16th in TRT");
  eq(UI.F.trtDay(after), "2026-01-16", "and so is an after-hours print");
  for (const [what, at] of [["the last regular print", lastRegular], ["the close", close], ["an after-hours print", after], ["the last after-hours print", late]]) {
    eq(UI.F.etDay(at), "2026-01-15", `${what} belongs to the 15th session by the New York day`);
    eq(easternDay(at), "2026-01-15", `and by the server's Eastern day`);
  }
  eq(UI.F.etDay(printAt("2026-01-16T01:00:00Z")), "2026-01-15", "01:00 UTC on the 16th is 20:00 EST on the 15th: still the 15th");
  eq(UI.F.etDay(printAt("2026-01-16T05:00:00Z")), "2026-01-16", "and 05:00 UTC is midnight in New York: the 16th begins");
  eq(UI.F.etDay(printAt("2026-07-15T20:00:00Z")), "2026-07-15", "in daylight time the close is 20:00 UTC and is the 15th");
  eq(UI.F.trtDay(printAt("2026-07-15T21:30:00Z")), "2026-07-16", "while an after-hours print at 17:30 EDT is already the 16th in TRT");
  eq(UI.F.etDay(printAt("2026-07-15T21:30:00Z")), "2026-07-15", "and still the 15th session");
  eq(UI.F.etDay("not a date"), null, "an unreadable instant has no day");
  eq(UI.F.etDay(null), null, "and neither has a missing one");
  eq(UI.F.etDay(printAt("2026-03-08T06:59:59Z")), "2026-03-08", "the instant before the spring change is the 8th");
  eq(UI.F.etDay(printAt("2026-11-01T05:59:59Z")), "2026-11-01", "and the instant before the autumn change is the 1st");
}

{
  const live = readFileSync(new URL("../assets/js/flows-ticker-live.js", import.meta.url), "utf8");
  ok(live.includes(": F.etDay(at) }") && !/session:[^\n]*F\.trtDay/.test(live), "the live layer keys a quote's session by the New York day when the frame names none, never by the TRT date");
  const bad = bootUI([["etDay: (v) => { const t = instant(v); return t === null ? null : nyClock(new Date(t)).date; },", "etDay: (v) => F.trtDay(v),"]]);
  ok(bad.F.etDay(Date.parse("2026-01-15T21:00:00Z")) !== "2026-01-15", "a New York day taken from the TRT date lands the closing print on the next session (planted wrong build)");
  const wrongOffset = bootUI([["timeZone: \"America/New_York\", year: \"numeric\"", "timeZone: \"Europe/Istanbul\", year: \"numeric\""]]);
  ok(wrongOffset.F.etDay(Date.parse("2026-01-15T21:00:00Z")) !== "2026-01-15", "and so does a New York clock set to Istanbul (planted wrong build)");
}

console.log(`✓ math-time: ${checks} assertions - the hand-written NYSE calendar, early closes, US daylight rule and Eastern day against exchange_calendars and the IANA zone from 2015 to 2031, the TRT open and close of every session since 2017 (16:30 to 23:00 in US daylight time, 17:30 to 00:00 after it), the time to expiry in whole minutes to the exchange's own close over a 365-day year, and the closing print kept in the New York session whatever its TRT date`);
