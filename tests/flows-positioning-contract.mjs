import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  vnum, toMs, sessionWindow, nyOffsetMinutes, etDay, ownHistory, signRun, signFlips, olsSlope,
  packSeries, unpackSeries, dollarGammaPer1pct, gexHistory, volumeHistory, bookLevels, gexLevels,
  flowExpiry, flowStrike, nopeSection, gexPath, oiWalls, pickLifelineContracts, lifeline, darkpoolLevels,
  alertsTape, multiLeg, sessionPrints, sessionPrintParams, readExpiryBreakdown, rowsOf, readCode,
  failedRead, FLOW_CODES, UNITS, TENOR_BUCKETS, POSITIONING_LINES,
} from "../shared/flows-positioning.js";
import { PUT_TO_DEALER } from "../shared/flows-variation.js";
import { shapeDarkpool } from "../shared/flows-pulse.js";
import { indexCrossFeed } from "../shared/flows-card.js";
import {
  readAlertBatch, readMultiLeg, buildHist, histNope, composeCardX, runFlowLeg, FLOW_LEG,
  DEEP_SECTIONS, CROSS_SECTIONS,
} from "../scripts/flows-legs/flow.mjs";
import { makeFlowFakeVendor, makeFlowFakeStore, weekdaysEndingAt } from "../scripts/flows-legs/flow-fake.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FX = JSON.parse(readFileSync(join(HERE, "fixtures-flows-positioning.json"), "utf8"));

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); checks++; };
const near = (a, b, tol, msg) => {
  assert.ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${msg} (got ${a}, want ${b} ± ${tol})`);
  checks++;
};
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);
const SESSION = FX.sessionDate;
const WIN = sessionWindow(SESSION);
const at = (hhmm) => `${SESSION}T${hhmm}:00Z`;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdSample = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };

{
  eq(vnum("20844256.702439"), 20844256.702439, "a decimal string is a number");
  eq(vnum(" 2.5e6 "), 2.5e6, "scientific notation in a string is read, trimmed");
  eq(vnum(144891917.5), 144891917.5, "a JSON number passes through");
  eq(vnum(""), null, "an empty string is absent, never zero");
  eq(vnum(null), null, "null is absent");
  eq(vnum("n/a"), null, "junk is absent");
  eq(vnum(true), null, "a boolean is not a number");
  eq(vnum(Infinity), null, "a non-finite number is absent");
  eq(toMs(1790107195423), 1790107195423, "epoch milliseconds stay milliseconds");
  eq(toMs(1790107195), 1790107195000, "epoch seconds are scaled");
  eq(toMs("2026-09-22T13:30:00.000000Z"), Date.parse("2026-09-22T13:30:00Z"), "six-digit fractions parse");
  eq(toMs("2026-09-22T09:30:00-04:00"), Date.parse("2026-09-22T13:30:00Z"), "an ET offset parses to the same instant");
  eq(toMs(null), null, "no time is absent");
}

{
  eq(nyOffsetMinutes("2026-09-22"), -240, "September is daylight time in New York");
  eq(nyOffsetMinutes("2026-12-01"), -300, "December is standard time");
  eq(WIN.openIso, "2026-09-22T13:30:00.000Z", "the regular session opens 09:30 ET, 13:30Z in daylight time");
  eq(WIN.closeIso, "2026-09-22T20:00:00.000Z", "and closes 16:00 ET, 20:00Z");
  eq(sessionWindow("2026-12-01").openIso, "2026-12-01T14:30:00.000Z", "in standard time the open is 14:30Z");
  eq(sessionWindow("not a day"), null, "no window without a session date");
  eq(etDay(Date.parse("2026-09-23T02:00:00Z")), "2026-09-22", "02:00Z is still the previous Eastern day");
}

{
  const cs = { history: [0.3, 0.35, 0.25, 0.5, 0.45, 0.32], current: 0.4 };
  const h = ownHistory([...cs.history, cs.current], { min: 1 });
  near(h.pct, 0.7142857142857143, 1e-12,
    "own-history percentile is the share of days at or below today, today included (quant case iv.rank-vs-percentile)");
  near(h.z, (0.4 - mean(cs.history)) / sdSample(cs.history), 1e-12,
    "the z-score is today against the prior history's mean and sample standard deviation, today excluded");
  const long = Array.from({ length: 60 }, (_, i) => i + 1).concat([100]);
  const hl = ownHistory(long);
  near(hl.z, (100 - 30.5) / sdSample(long.slice(0, 60)), 1e-12, "sixty prior sessions reach the default minimum");
  eq(hl.pct, 1, "and the highest value sits at the 100th percentile");
  eq(hl.n, 60, "n counts the baseline sessions");
  const short = ownHistory(long.slice(1));
  eq(short.z, null, "fifty-nine prior sessions are short of the minimum");
  eq(short.why, "short-history", "and the silence says why");
  const flat = ownHistory([5, 5, 5, 5, 5], { min: 2 });
  eq(flat.z, null, "a history with no dispersion has no z-score");
  eq(flat.why, "zero-sd", "and says so");
  eq(ownHistory([1, 2, null]).why, "no-today", "no value for the session is no-today, never zero");
  const windowed = ownHistory([1000, 1000, 1, 2, 3, 4], { min: 2, window: 3 });
  near(windowed.z, (4 - 2) / 1, 1e-12, "the window bounds the baseline to the most recent sessions");
}

{
  eq(signRun([3, -1, 2, 5, 7]).run, 3, "persistence counts the sessions of the current sign");
  eq(signRun([3, -1, 2, 5, 7]).sign, 1, "and names the sign");
  eq(signRun([1, 2, null, 3]).run, 1, "a missing session interrupts the run");
  eq(signRun([1, null]).sign, null, "no value today, no run");
  const f = signFlips([1, -2, -3, 0, 4, null, 5, -1]);
  eq(f.flips, 3, "sign changes skip zeros and gaps");
  assert.deepEqual(f.at, [1, 4, 7]); checks++;
  near(olsSlope(Array.from({ length: 20 }, (_, i) => 2 + 3 * i)), 3, 1e-12, "OLS slope of a line is its slope");
  near(olsSlope([1, null, 5, null, 9]), 2, 1e-12, "gaps keep their session index");
  eq(olsSlope([4]), null, "one point has no slope");
}

{
  const values = [2460845.3057, -1055065.5743, null, 0.5, -3.2e7];
  const packed = packSeries(values);
  eq(packed.s, 4, "the exponent is chosen so the largest magnitude keeps four digits");
  const back = unpackSeries(packed);
  eq(back[2], null, "a gap survives packing as a gap");
  for (const i of [0, 1, 4]) near(back[i], values[i], 0.5 * 10 ** packed.s, `value ${i} round-trips within half a step`);
  ok(Math.sign(back[1]) === -1, "the sign of a negative value survives");
  const small = packSeries([0.301775, -0.12, 0.05]);
  eq(small.s, -4, "fractions get a negative exponent");
  near(unpackSeries(small)[0], 0.3018, 1e-12, "and decode to four places");
}

{
  near(dollarGammaPer1pct(0.05 * 1000 * 100, 100, "share"), 500000, 1e-6,
    "share-gamma x 1% x S^2 is dollar gamma per 1% (quant case gex.dollar-gamma-per-1pct)");
  eq(dollarGammaPer1pct(500000, 100, "pct$"), 500000, "a pct$ unit family is already dollars per 1%");
  eq(dollarGammaPer1pct(1, null, "share"), null, "no spot, no dollars");
}

{
  const probe = FX.greekExposure.data[0];
  const one = gexHistory(FX.greekExposure, { sessionDate: probe.date, spot: 250, adv: 1e10 });
  const s = one.section;
  eq(s.status, "ok", "the probe row reads");
  rel(s.net, 3515910.88 - 1055065.5743, 1e-5, "net GEX sums the legs: put gamma arrives already negative");
  rel(s.charm, -23546409.118 + PUT_TO_DEALER.charm * 16324839.2996, 1e-5,
    "net charm applies the run's put convention (PUT_TO_DEALER.charm)");
  rel(s.vanna, 20950552.9115 + PUT_TO_DEALER.vanna * -54858687.1309, 1e-5, "and so does net vanna");
  rel(s.usd1pct, (3515910.88 - 1055065.5743) * 0.01 * 250 * 250, 1e-5, "dollar gamma per 1% scales share-gamma by S^2/100");
  rel(s.adv, (3515910.88 - 1055065.5743) * 0.01 * 250 * 250 / 1e10, 1e-5, "and the hedge is quoted as a share of ADV$");
  eq(s.regime, "long", "a positive book is long gamma");
  eq(s.persist, 1, "one session of history is a run of one");
  eq(s.z, null, "one session has no z-score");
  eq(s.gaps.z, "short-history", "and the gap names why");
  ok(Object.values(s.u).every((u) => u in UNITS), "every unit on the section is a declared unit");
  eq(s.u.net, "shareGamma", "under the documented share family the net book is labelled share-gamma");
  const dollars = gexHistory(FX.greekExposure, { sessionDate: probe.date, spot: 250, adv: 1e10, unit: "pct$" });
  eq(dollars.section.u.net, "usdPer1pct",
    "when the run's unit probe reads the vendor in dollars per 1%, the same number is labelled in dollars, never share-gamma");
  eq(dollars.section.usd1pct, dollars.section.net, "and is carried unscaled into the dollar reading");
  const packedDollars = buildHist({ ticker: "A", sessionDate: probe.date, generatedAt: "x", fresh: null,
    gex: dollars.series, volume: null, nope: [] });
  eq(packedDollars.u.g, "usdPer1pct", "the 1Y history of that book carries the same unit");
  const stale = gexHistory(FX.greekExposure, { sessionDate: SESSION }).section;
  eq(stale.status, "stale", "a series that ends before the session is stale");
  eq(stale.why, "not-session", "with its code");
  eq(stale.asOf, "2025-09-24", "and its own date");
  const undetermined = gexHistory(FX.greekExposure, { sessionDate: probe.date, multipliers: { gamma: 1, charm: null, vanna: -1 } }).section;
  eq(undetermined.charm, null, "an unsettled put convention withholds charm");
  eq(undetermined.gaps.charmZ, "convention-undetermined", "with the convention code");
  ok(undetermined.vanna !== null, "while a settled greek still reads");
  eq(gexHistory(undefined).section.why, "unread", "an unrequested read is unread");
  eq(gexHistory(failedRead("failed")).section.why, "failed", "a failed call is unavailable/failed");
  eq(gexHistory({ rows: [] }).section.status, "unreadable", "a body without data is unreadable, never zero");
  eq(gexHistory({ data: [] }).section.status, "quiet", "an empty series is quiet");

  const days = weekdaysEndingAt(SESSION, 70);
  const rows = days.map((d, i) => ({ date: d, call_gamma: String(1000 + i), put_gamma: String(i < 65 ? -500 : -5000),
    call_charm: "1", put_charm: "1", call_vanna: "1", put_vanna: "1" }));
  rows.push({ date: "2026-09-23", call_gamma: "9e9", put_gamma: "0" });
  const series = gexHistory({ data: rows.slice().reverse() }, { sessionDate: SESSION, min: 60 });
  const g = rows.slice(0, 70).map((r) => Number(r.call_gamma) + Number(r.put_gamma));
  eq(series.series.d[series.series.d.length - 1], SESSION, "a row dated after the session is cut: no look-ahead");
  eq(series.section.regime, "short", "five sessions of heavy put gamma turn the book short");
  eq(series.section.persist, 5, "and the run of the short sign is five sessions");
  eq(series.section.flips, 1, "one regime change over the window");
  near(series.section.z, Number(((g[69] - mean(g.slice(0, 69))) / sdSample(g.slice(0, 69))).toFixed(3)), 1e-9,
    "the GEX z-score is the session against its own prior history");
  near(series.section.longShare, Number((65 / 70).toFixed(4)), 1e-9, "long share is the fraction of sessions long gamma");
}

{
  const probe = FX.optionsVolume.data[0];
  const v = volumeHistory(FX.optionsVolume, { sessionDate: SESSION }).section;
  eq(v.netPrem, -46987757 - 10802282,
    "net premium = net call premium minus net put premium: calls sold and puts bought are both bearish");
  eq(v.bullBear, 214836481 - 270876420, "bull-bear premium is the vendor's two sums differenced, in whole dollars");
  eq(v.volume, 942134 + 339609, "volume sums the legs");
  eq(v.volume, FX.contractHistoric.chains[0].ticker_vol, "and equals the contract feed's whole-name volume that day");
  near(v.pc, Number((339609 / 942134).toFixed(4)), 1e-12, "P/C is puts over calls");
  eq(v.oi, probe.call_open_interest + probe.put_open_interest, "OI sums the legs");
  eq(v.oiSlope, null, "one session has no OI slope");
  eq(v.gaps.oiSlope, "short-history", "and says so");
  const days = weekdaysEndingAt(SESSION, 20);
  const rows = days.map((d, i) => ({ date: d, net_call_premium: "0", net_put_premium: "0", bullish_premium: "1",
    bearish_premium: "1", call_volume: 10, put_volume: 5, call_open_interest: 600 + 30 * i, put_open_interest: 400 + 20 * i }));
  const s = volumeHistory({ data: rows.reverse() }, { sessionDate: SESSION }).section;
  near(s.oiSlope, 50, 1e-9, "the 20-session OI slope is the OLS slope in contracts per session");
  near(s.oiSlopeRel, Number((50 / (1000 + 50 * 9.5)).toFixed(6)), 1e-12, "and relative to the mean OI");
  const zero = volumeHistory({ data: [{ date: SESSION, call_volume: 0, put_volume: 0 }] }, { sessionDate: SESSION }).section;
  eq(zero.pc, null, "no call volume, no ratio");
  eq(zero.gaps.pc, "no-volume", "with the no-volume code");
}

{
  const ladder = [
    { strike: "320", call_gamma_oi: "100", put_gamma_oi: "-900" },
    { strike: "330", call_gamma_oi: "300", put_gamma_oi: "-500" },
    { strike: "340", call_gamma_oi: "800", put_gamma_oi: "-100" },
    { strike: "350", call_gamma_oi: "600", put_gamma_oi: "-50" },
  ];
  const ours = bookLevels(ladder, 339.75);
  eq(ours.callWall, 340, "our call wall is the largest call gamma at or above spot");
  eq(ours.putWall, 320, "our put wall is the largest put gamma at or below spot, on the correct side");
  eq(ours.magnet, 320, "the magnet is the largest net book strike");
  near(ours.flip, 340 + 10 * (300 / 550), 1e-9, "our flip is the book's strike-sum crossing, interpolated");
  const undetermined = bookLevels(ladder, 339.75, { putSign: null });
  eq(undetermined.flip, null, "no put convention, no book flip");
  eq(undetermined.callWall, 340, "while the walls, which need no sign, still read");

  const L = gexLevels(FX.gexLevels, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr, strikes: ladder });
  eq(L.status, "ok", "the probe-shaped object reads from data, not from nearby_flips[]");
  eq(L.flip, 332.83, "vendor levels arrive as strings and are coerced");
  near(L.callWallAtr, Number(((345 - 339.75) / FX.atr).toFixed(3)), 1e-12, "wall distance in ATR");
  near(L.ambiguity, Number(((341.9 - 325) / FX.atr).toFixed(3)), 1e-12, "flip ambiguity = (max - min nearby flips) / ATR");
  near(L.flipGap, Number(((332.83 - (340 + 10 * 300 / 550)) / FX.atr).toFixed(3)), 1e-12,
    "agreement is the vendor flip minus our book flip in ATR");
  eq(L.flipAgree, false, "more than half an ATR apart does not agree");
  eq(L.callWallAgree, false, "vendor 345 against our 340");
  eq(L.putWallAgree, true, "vendor 320 against our 320");
  const one = gexLevels({ data: { ...FX.gexLevels.data, nearby_flips: ["332.83"], gamma_flip: null } },
    { sessionDate: SESSION, spot: FX.spot, atr: FX.atr, strikes: ladder });
  eq(one.ambiguity, null, "a single nearby flip has no spread");
  eq(one.gaps.ambiguity, "single-flip", "and says so");
  eq(one.flip, null, "a null vendor flip stays null");
  eq(one.gaps.flipGap, "no-level", "and the agreement is withheld with the level's code");
  eq(gexLevels({ data: [] }).status, "unreadable", "an array where the object belongs is unreadable");
  const noBook = gexLevels(FX.gexLevels, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr, strikes: [] });
  eq(noBook.ours, null, "a card with no strike rows has no book levels, not a book of nulls");
  eq(noBook.gaps.ours, "empty", "and says the strike read was empty");
  eq(noBook.gaps.callWallAgree, "empty", "so the wall agreement is withheld for that reason");
  eq(noBook.gaps.flipGap, "empty", "and so is the flip gap, rather than blaming a missing crossing");
  eq(gexLevels(FX.gexLevels, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr }).gaps.ours, "unread",
    "no strike read at all is unread");
  const highBook = gexLevels(FX.gexLevels, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr,
    strikes: [{ strike: "300", call_gamma_oi: "5", put_gamma_oi: "-9" }] });
  eq(highBook.gaps.callWallAgree, "no-level", "a book with no strike above spot has no call wall: a missing level, not a missing flip");
  eq(gexLevels(FX.gexLevels, { sessionDate: "2026-09-23" }).why, "not-session", "yesterday's levels are stale");
}

{
  const r = FX.flowPerExpiry[0];
  const npWant = (30418039 - 29518322) - (10079294 - 8351114);
  const e = flowExpiry(FX.flowPerExpiry, { sessionDate: SESSION, readAt: "2026-09-23T10:00:00Z" });
  eq(e.status, "ok", "the bare array reads");
  eq(e.rows[0].np, npWant, "net premium by expiry = (call ask - call bid) - (put ask - put bid)");
  eq(e.rows[0].gross, 66895926 + 20972729, "gross premium is calls plus puts");
  eq(e.rows[0].dte, 1, "days to expiry from the session");
  near(e.otmShare, Number(((38932415 + 12713509) / (66895926 + 20972729)).toFixed(4)), 1e-12, "OTM share of premium");
  eq(e.convictionBucket, "0-7", "the conviction tenor is the bucket with the largest net premium");
  eq(e.convictionDte, 1, "and the |net|-weighted days to expiry");
  eq(e.readAt, "2026-09-23T10:00:00Z", "the route has no date parameter, so the read time is stamped");
  eq(e.mix.length, TENOR_BUCKETS.length, "every tenor bucket is published, empty ones included");
  const two = flowExpiry([{ ...r, expiry: "2026-09-25" }, { ...r, expiry: "2026-12-18",
    call_premium_ask_side: "0", call_premium_bid_side: "0", put_premium_ask_side: "3000000", put_premium_bid_side: "0" }],
  { sessionDate: SESSION });
  near(two.convictionDte, (3 * Math.abs(npWant) + 87 * 3000000) / (Math.abs(npWant) + 3000000), 0.01,
    "conviction DTE weighs each expiry by its |net premium|");
  eq(two.convictionBucket, "46-180", "and the bucket follows the larger net");
  const stale = flowExpiry(FX.flowPerExpiry, { sessionDate: "2026-09-23" });
  eq(stale.status, "unavailable", "a re-run during the next session does not read the partial day as this one");
  eq(stale.vendorDate, "2026-09-22", "and names the date the vendor sent");
  eq(flowExpiry({ data: "x" }).status, "unreadable", "a non-list body is unreadable");
}

{
  const probe = flowStrike(FX.flowPerStrike, { sessionDate: SESSION, spot: FX.spot, iv30: 0.25 });
  eq(probe.strikes, 1, "the probe's strike-5 row parses");
  eq(probe.inBand, 0, "and falls outside the +-25% band around 339.75, as a stray far strike must");
  eq(probe.centroid, null, "no in-band premium, no centroid");
  const row = (k, ca, cb, pa, pb) => ({ date: SESSION, timestamp: `${SESSION}T19:59:55.649000Z`, strike: String(k),
    call_premium_ask_side: String(ca), call_premium_bid_side: String(cb), put_premium_ask_side: String(pa),
    put_premium_bid_side: String(pb), call_premium: String(ca + cb), put_premium: String(pa + pb),
    call_otm_premium: "0", put_otm_premium: "0" });
  const s = flowStrike([row(100, 1.5e6, 0.5e6, 0, 0), row(110, 0, 0, 1e6, 0), row(5, 0, 66820, 9, 50)],
    { sessionDate: SESSION, spot: 100, iv30: 0.3, walls: { call: 110, put: 90 }, wallsFrom: "vendor" });
  eq(s.ladder.length, 2, "the ladder keeps the in-band strikes");
  near(s.centroid, 105, 1e-9, "flow centroid = sum K|NP| / sum |NP|");
  near(s.centroidSigma, Number((Math.log(1.05) / (0.3 * Math.sqrt(30 / 365))).toFixed(3)), 1e-12,
    "and in units of the 30-day implied move");
  eq(s.longPeak, 100, "the largest net buying strike");
  eq(s.shortPeak, 110, "the largest net selling strike");
  eq(s.callWallFlow, -1e6, "flow on the call wall strike");
  eq(s.putWallFlow, null, "no row at the put wall strike is absent, not zero");
  eq(s.gaps.putWallFlow, "no-row", "and says so");
  near(s.wallShare, 0.5, 1e-12, "wall share = |flow on walls| / |flow in band|");
  eq(flowStrike([row(100, 1, 0, 0, 0)], { sessionDate: SESSION, spot: null }).why, "no-spot", "no spot, no band");
  const far = flowStrike([row(100, 1e5, 0, 0, 0), row(110, 0, 0, 1e5, 0), row(60, 9e6, 0, 0, 0)],
    { sessionDate: SESSION, spot: 100, iv30: 0.3, walls: { call: 100, put: 60 }, wallsFrom: "vendor" });
  near(far.wallShare, Number(((1e5 + 9e6) / (2e5 + 9e6)).toFixed(4)), 1e-12,
    "a wall outside the band joins the denominator too, so the wall share is a true fraction (it read 45.5 before)");
  ok(far.wallShare <= 1, "and never exceeds one");
  const same = flowStrike([row(100, 1e5, 0, 0, 0), row(110, 0, 0, 1e5, 0)],
    { sessionDate: SESSION, spot: 100, iv30: 0.3, walls: { call: 100, put: 100 }, wallsFrom: "vendor" });
  near(same.wallShare, 0.5, 1e-12, "walls on one strike are counted once");
  const bare = flowStrike([row(100, 1e5, 0, 0, 0)], { sessionDate: SESSION, spot: 100, iv30: 0.3 });
  eq(bare.gaps.callWall, "no-walls", "no wall to measure against is said in gaps");
  eq(bare.gaps.wallsFrom, "no-walls", "including where the walls would have come from");
  eq(flowStrike(failedRead("refused")).why, "refused", "a refused call carries the refused code");
}

{
  const probe = FX.nope.data[0];
  const n = nopeSection(FX.nope, { sessionDate: SESSION, candle: { open: 338, close: 339.75 } }).section;
  eq(n.close, 0.301775, "the vendor's close NOPE is read from a string");
  near(n.closeCheck, (20844256.702439 - 11861458.951400) / 29766577, 1e-6,
    "and reproduced as (call delta + put delta) / stock volume: the put delta arrives negative");
  eq(n.checkAgrees, true, "the reproduction agrees to 1e-5");
  eq(n.fill, 0.665683, "NOPE fill is carried beside it");
  eq(n.divergence, "none", "positive NOPE on a rising session is not a divergence");
  eq(nopeSection(FX.nope, { sessionDate: SESSION, candle: { open: 341, close: 339.75 } }).section.divergence,
    "bullish-vs-price", "positive NOPE on a falling session is a bullish divergence");
  eq(nopeSection(FX.nope, { sessionDate: SESSION }).section.gaps.divergence, "no-price", "no candle, no divergence");
  const pre = { ...probe, timestamp: "2026-09-22T13:00:00Z", nope: "9" };
  const post = { ...probe, timestamp: "2026-09-22T20:30:00Z", nope: "9" };
  const early = { ...probe, timestamp: "2026-09-22T13:31:00Z", nope: "-0.2" };
  const w = nopeSection({ data: [post, probe, early, pre] }, { sessionDate: SESSION }).section;
  eq(w.close, 0.301775, "rows outside the regular session are cut and the newest RTH minute closes");
  eq(w.low, -0.2, "the low is the session's minimum");
  eq(w.lowM, 1, "at its minute after the open");
  eq(w.highM, 389, "and the high at 15:59 ET");
  const prior = weekdaysEndingAt("2026-09-21", 25).map((d, i) => ({ d, v: (i % 5) / 10 }));
  const z = nopeSection(FX.nope, { sessionDate: SESSION, prior }).section;
  const base = prior.map((p) => p.v);
  near(z.z, Number(((0.301775 - mean(base)) / sdSample(base)).toFixed(3)), 1e-12,
    "NOPE z is today's close against the closes this pipeline has kept");
  eq(z.historyN, 25, "over the kept sessions");
  const future = nopeSection(FX.nope, { sessionDate: SESSION, prior: [{ d: "2026-09-23", v: 5 }, ...prior] }).section;
  eq(future.historyN, 25, "a stored value dated on or after the session never enters the baseline");
  eq(nopeSection(FX.nope, { sessionDate: SESSION, prior: prior.slice(0, 10) }).section.gaps.z, "short-history",
    "fewer than twenty kept sessions is short history");
}

{
  const probe = gexPath(FX.spotExposures, { sessionDate: SESSION });
  eq(probe.status, "unavailable", "the probe's 10:30Z row is pre-market");
  eq(probe.why, "no-rth", "and nothing inside the session is not a reading");
  const base = FX.spotExposures.data[0];
  const mk = (hhmm, g, dir) => ({ ...base, start_time: at(hhmm), time: at(hhmm),
    gamma_per_one_percent_move_oi: String(g), gamma_per_one_percent_move_dir: String(dir),
    gamma_per_one_percent_move_vol: String(dir), charm_per_one_percent_move_oi: String(g * 10) });
  const rows = [mk("13:30", 10, 0), mk("13:31", -5, 0), mk("13:32", -3, 0), mk("19:59", 4, 0), base];
  const p = gexPath({ data: rows }, { sessionDate: SESSION });
  eq(p.minutes, 4, "four RTH minutes, the pre-market row cut");
  eq(p.flips, 2, "two intraday sign flips of the dealer book");
  assert.deepEqual(p.flipM, [1, 389]); checks++;
  eq(p.flowFilled, false, "flow legs that stay zero are reported as unfilled");
  eq(p.gaps.flowFlips, "flow-unfilled", "so the flow clock is withheld with its code");
  eq(p.change, -6, "change is close minus open of the book");
  eq(p.charmClose, 40, "charm at the close is the last RTH minute's value");
  eq(p.charmLastHour, 40, "and the last-hour mean covers 15:00-16:00 ET");
  const filled = gexPath({ data: [mk("13:30", 1, 2), mk("13:40", 1, -2)] }, { sessionDate: SESSION });
  eq(filled.flowFilled, true, "a nonzero flow leg fills the flow clock");
  eq(filled.flowFlips, 1, "and its flips are counted");
}

{
  const probe = oiWalls(FX.oiPerStrike, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr });
  eq(probe.putWall, 5, "the probe's only strike, 5, sits below spot and can only be a put wall");
  eq(probe.callWall, null, "no strike above spot, no call wall");
  eq(probe.gaps.callWall, "no-level", "and says so");
  const rows = [[90, 10, 500], [95, 50, 800], [100, 300, 300], [105, 900, 20], [110, 400, 5]]
    .map(([k, c, p]) => ({ date: SESSION, strike: String(k), call_oi: c, put_oi: p }));
  const w = oiWalls({ data: rows }, { sessionDate: SESSION, spot: 100, atr: 2 });
  eq(w.callWall, 105, "call wall = largest call OI at or above spot");
  eq(w.putWall, 95, "put wall = largest put OI at or below spot");
  eq(w.callWallAtr, 2.5, "in ATR");
  near(w.pcOi, Number((1625 / 1660).toFixed(4)), 1e-12, "P/C by open interest");
  const wrong = oiWalls({ data: [{ date: SESSION, strike: "120", call_oi: 0, put_oi: 9e9 }, ...rows] }, { spot: 100 });
  eq(wrong.putWall, 95, "a huge put OI above spot never becomes the put wall");
}

{
  const picks = pickLifelineContracts([
    { oc: "AAPL261016C00340000", diff: 5000 }, { oc: "AAPL261016P00300000", diff: -9000 },
    { oc: "bad", diff: 1e9 }, { oc: "AAPL260923P00340000", diff: 10020 }, { oc: "AAPL261016C00340000", diff: 5000 },
    { option_symbol: "AAPL261120C00350000", oi_diff_plain: 7000 },
  ]);
  assert.deepEqual(picks.map((p) => p.oc), ["AAPL260923P00340000", "AAPL261120C00350000", "AAPL261016C00340000"]); checks++;
  const base = FX.contractHistoric.chains[0];
  const one = lifeline(FX.contractHistoric, { id: "AAPL261016C00340000", diff: 5000, sessionDate: SESSION });
  eq(one.status, "ok", "rows under chains read");
  eq(one.cp, "C", "the contract's side is parsed from its OCC symbol");
  eq(one.k, 340, "and its strike");
  eq(one.buildStart, null, "one session cannot show a build");
  eq(one.gaps.buildStart, "no-build", "and says so");
  const days = weekdaysEndingAt(SESSION, 5);
  const oi = [100, 90, 150, 300, 600];
  const vol = [1000, 200, 400, 800, 50];
  const ask = [10, 150, 100, 500, 50];
  const rows = days.map((d, i) => ({ ...base, date: d, open_interest: oi[i], volume: vol[i], ask_volume: ask[i],
    sweep_volume: 0, floor_volume: 10 }));
  const l = lifeline({ chains: rows.slice().reverse(), etf_holdings: [] }, { id: "AAPL261016C00340000", sessionDate: SESSION });
  eq(l.buildStart, days[1], "the build starts at the session before the first rise that runs into today");
  eq(l.buildSessions, 3, "and has lasted three sessions");
  eq(l.buildOi, 510, "adding 510 contracts");
  near(l.askShareBuild, Number(((150 + 100 + 500) / (200 + 400 + 800)).toFixed(4)), 1e-12,
    "ask share over the build uses the volume that settled into it (OI is T+1)");
  near(l.floorShareBuild, Number((30 / 1400).toFixed(4)), 1e-12, "and so does the floor share");
  eq(lifeline({ data: [] }, { id: "AAPL261016C00340000" }).status, "unreadable", "rows under data are not the historic shape");
  const longDays = weekdaysEndingAt(SESSION, 45);
  const longRows = longDays.map((d, i) => ({ ...base, date: d, open_interest: i < 5 ? 100 : 100 + (i - 4) * 10,
    volume: 50, ask_volume: 30, sweep_volume: 5, floor_volume: 1 }));
  const long = lifeline({ chains: longRows.slice().reverse() }, { id: "AAPL261016C00340000", sessionDate: SESSION });
  eq(long.buildStart, longDays[4], "a build longer than the drawn 30 sessions is measured over every session fetched");
  eq(long.buildSessions, 40, "forty sessions, not a 29-session build clipped by the chart window");
  eq(long.buildOi, 400, "adding the whole 400 contracts");
  eq(long.d.length, POSITIONING_LINES.LIFE_SESSIONS, "while the drawn series stays the last 30 sessions");
}

{
  const probe = darkpoolLevels(FX.darkpoolLevels, { sessionDate: SESSION, spot: FX.spot, atr: FX.atr });
  eq(probe.status, "quiet", "the probe's 250 print sits 12 ATR from spot");
  eq(probe.why, "outside-band", "so it is banded out, not ranked as a shelf");
  const lv = [[97, 100, 100], [99, 400, 100], [100, 200, 200], [101.5, 300, 0], [104.5, 900, 0]]
    .map(([p, d, l]) => ({ price: String(p), dark_pool_volume: String(d), regular_volume: String(l) }));
  const d = darkpoolLevels({ data: lv, date: SESSION }, { sessionDate: SESSION, spot: 100, atr: 2 });
  assert.deepEqual(d.shelves.map((s) => s.px), [99, 101.5, 100]); checks++;
  near(d.shelves[0].z, Number((150 / Math.sqrt(50000 / 3)).toFixed(3)), 1e-12,
    "shelf strength z is the shelf's dark volume against the in-band levels");
  eq(d.shelves[0].atr, -0.5, "shelf distance in ATR");
  near(d.shelves[0].share, 0.8, 1e-12, "dark share at the level = dark / (dark + lit)");
  near(d.darkShare, Number((1000 / 1400).toFixed(4)), 1e-12, "and across the band");
  eq(d.outside, 1, "the 104.5 level is outside two ATR");
  eq(darkpoolLevels({ data: lv, date: "2026-09-21" }, { sessionDate: SESSION, spot: 100, atr: 2 }).why, "not-session",
    "the envelope date is kept and checked");
  eq(darkpoolLevels({ data: lv }, { sessionDate: SESSION, spot: 100, atr: null }).why, "no-atr", "no ATR, no band");
}

{
  const noLit = darkpoolLevels({ data: [{ price: "100", dark_pool_volume: "500" }, { price: "101", dark_pool_volume: "700" }],
    date: SESSION }, { sessionDate: SESSION, spot: 100, atr: 2 });
  eq(noLit.darkShare, null, "a level with no regular_volume is not 100% dark: the share is withheld");
  eq(noLit.gaps.darkShare, "malformed", "because the confirmed field is missing from the body");
  eq(noLit.shelves[0].share, null, "and so is each shelf's own share");
  eq(noLit.profile[0].lit, null, "the lit volume stays absent, never zero");
  eq(noLit.shelves[0].dark, 700, "while the dark volume the body does carry still ranks the shelves");
  eq(darkpoolLevels({ data: [{ px: "100", volume: "5" }], date: SESSION }, { sessionDate: SESSION, spot: 100, atr: 2 }).status,
    "unreadable", "rows with none of the confirmed level fields are unreadable, not a quiet band");

  const noPuts = oiWalls({ data: [{ date: SESSION, strike: "100", call_oi: 10 }, { date: SESSION, strike: "95", call_oi: 5 }] },
    { sessionDate: SESSION, spot: 100, atr: 2 });
  eq(noPuts.putOi, null, "open interest per strike without put_oi is not zero put OI");
  eq(noPuts.pcOi, null, "so there is no put/call ratio");
  eq(noPuts.gaps.pcOi, "malformed", "and the gap says the field was missing, not that OI summed to zero");
  eq(noPuts.putWall, null, "no put wall either");
  eq(noPuts.gaps.putWall, "malformed", "for the same reason");
  eq(noPuts.callWall, 100, "while the call side still reads");
  eq(oiWalls({ data: [{ date: SESSION, strike: "100" }] }, { sessionDate: SESSION, spot: 100, atr: 2 }).status, "unreadable",
    "a strike list with neither OI field is unreadable");

  const renamed = (r) => { const o = {}; for (const [k, v] of Object.entries(r)) o[k.replace(/premium/g, "prem")] = v; return o; };
  eq(flowExpiry(FX.flowPerExpiry.map(renamed), { sessionDate: SESSION }).status, "unreadable",
    "flow-per-expiry whose premium fields are not the confirmed names is unreadable, never a measured $0 day");
  eq(flowStrike([{ ...renamed(FX.flowPerStrike[0]), strike: "340" }], { sessionDate: SESSION, spot: 339.75, iv30: 0.25 }).status,
    "unreadable", "and so is flow-per-strike");
  const noGamma = FX.greekExposure.data.map((r) => ({ date: r.date, call_gex: undefined, gamma: r.call_gamma }));
  eq(gexHistory({ data: noGamma }, { sessionDate: noGamma[0].date }).section.status, "unreadable",
    "a greek-exposure series with no gamma legs is unreadable, not a flat book with zero flips");
  eq(volumeHistory({ data: [{ date: SESSION, calls: 5 }] }, { sessionDate: SESSION }).section.status, "unreadable",
    "an options-volume series with none of its confirmed fields is unreadable");
}

{
  const probe = FX.flowAlerts.data[0];
  const mk = (i, prem, ask, sweep, opening, type, vol, oi, hhmm = "15:00", t = "AAPL") => ({
    ...probe, id: "a" + i, ticker: t, total_premium: String(prem), total_ask_side_prem: String(ask),
    has_sweep: sweep, all_opening_trades: opening, type, volume: vol, open_interest: oi,
    start_time: Date.parse(at(hhmm)),
  });
  const rows = [mk(1, 100, 80, true, true, "call", 500, 100), mk(2, 300, 60, false, true, "put", 10, 100),
    mk(3, 600, 300, true, false, "call", 50, 100), mk(4, 9e9, 0, true, true, "call", 9, 1, "15:00", "MSFT"),
    mk(5, 9e9, 0, true, true, "call", 9, 1, "12:00"), mk(1, 100, 80, true, true, "call", 500, 100)];
  const a = alertsTape(rows, "aapl", { sessionDate: SESSION, adv: 1e5 });
  eq(a.n, 3, "only this name's alerts inside the session count, each once");
  near(a.askShare, 0.44, 1e-12, "ask share = ask-side premium over premium");
  near(a.sweepShare, 0.7, 1e-12, "sweep share is premium-weighted");
  near(a.openingShare, 0.4, 1e-12, "and so is the opening share");
  near(a.callShare, 0.7, 1e-12, "and the call share");
  near(a.urgency, 100 / 1e5, 1e-12, "urgency = premium that swept into volume above OI, over ADV$");
  eq(a.dots[0].p, 600, "dots are ranked by premium");
  const live = alertsTape(FX.flowAlerts.data, "AAPL", { sessionDate: SESSION, adv: 1e10 });
  eq(live.n, 1, "the probe alert (start_time epoch-ms, 19:59:55Z) is inside the session");
  near(live.askShare, Number((1700 / 25394).toFixed(4)), 1e-12, "and its ask share reads from the string fields");
  eq(live.urgency, 0, "a non-sweep alert adds no urgency even with volume above OI");
  const partial = alertsTape([], "AAPL", { sessionDate: SESSION, complete: false, coverFromM: 300 });
  eq(partial.why, "truncated", "an empty name in a truncated batch is not called quiet for the whole session");
  eq(partial.coverFromM, 300, "and says which part of the session was covered");
  eq(alertsTape(failedRead("deadline"), "AAPL").why, "deadline", "a batch skipped past the deadline says so");
}

{
  const probe = FX.multiLeg.data[0];
  const mk = (i, s, np, tp, dl, vg, opening, dir) => ({ ...probe, id: "m" + i, strategy: s, net_premium: String(np),
    total_premium: String(tp), net_delta: String(dl), net_vega: String(vg), all_opening_legs: opening, direction: dir,
    executed_at: at("15:0" + i) });
  const m = multiLeg([mk(1, "iron_condor", -1000, 3000, 10, -50, true, "short"), mk(2, "iron_condor", 500, 1000, -4, 20, false, "long"),
    mk(3, "straddle", 2000, 2000, 1, 100, true, "long"), { ...mk(4, "straddle", 1, 1, 1, 1, true, "long"), ticker: "MSFT" }],
  "AAPL", { sessionDate: SESSION });
  eq(m.n, 3, "only this name's structures in the session count");
  eq(m.netPrem, 1500, "net premium sums signed nets: credits negative");
  eq(m.grossPrem, 6000, "gross premium sums the totals");
  eq(m.netDelta, 7, "net delta in the vendor's unit");
  eq(m.netVega, 70, "net vega in the vendor's unit");
  near(m.creditShare, Number((1000 / 3500).toFixed(4)), 1e-12, "credit share of |net premium|");
  near(m.openingShare, Number((5000 / 6000).toFixed(4)), 1e-12, "all-opening share of gross premium");
  assert.deepEqual(m.byStrategy.map((s) => [s.s, s.n, s.np, s.tp]), [["iron_condor", 2, -500, 4000], ["straddle", 1, 2000, 2000]]); checks++;
  eq(m.top[0].tp, 3000, "the largest structure leads");
  const live = multiLeg(FX.multiLeg.data, "AAPL", { sessionDate: SESSION });
  eq(live.n, 1, "the probe structure executed 19:59:59Z is inside the session");
  eq(live.netPrem, 2860, "its net premium reads from the string");
  eq(multiLeg([], "AAPL", { truncated: true }).why, "truncated", "a truncated empty read is not a quiet day");
}

{
  const live = FX.darkpool.data[0];
  const rth = (hhmm, prem, extra = {}) => ({ ...live, executed_at: at(hhmm), premium: String(prem),
    ext_hour_sold_codes: null, canceled: false, ...extra });
  const raw = { data: [live, rth("19:59", 100), rth("14:00", 500), rth("16:00", 300),
    rth("15:00", 9e9, { canceled: true }), rth("13:00", 7e9)] };
  const s = sessionPrints(raw, SESSION, { limit: 6 });
  assert.deepEqual(s.data.map((r) => Number(r.premium)), [100, 500, 300],
    "the session cut keeps the vendor's own order, so the market cross can measure what the vendor ranked by"); checks++;
  eq(s.session.capped, true, "and the session record says the vendor filled its page");
  eq(s.session.outside, 2, "the 19:59 ET after-hours print and the 09:00 ET pre-market print are cut");
  eq(s.session.extendedCode, 1, "the vendor's own extended-hours code agrees with the clock on the live row");
  eq(s.session.canceled, 1, "a canceled print is dropped");
  eq(s.session.vendorOrder, "time-or-other", "the vendor sent time order, which is recorded rather than assumed");
  eq(s.vendorCapped, true, "a read that filled its limit is marked capped before the filter shrinks it");
  const shaped = shapeDarkpool({ data: [rth("14:00", 5), rth("14:01", 50), rth("14:02", null)] });
  assert.deepEqual(shaped.rows.map((r) => r.prem), [50, 5, null]); checks++;
  eq(shaped.rankedBy, "premium", "the pulse's print list is ranked by premium, never by arrival");
  const cross = indexCrossFeed("darkpool", s, { limit: 6, tickers: ["AAPL"], sessionDate: SESSION });
  eq(cross.capped, true, "the market cross keeps the vendor's cap after the session filter");
  eq(cross.population, 3, "and ranks only the session's prints");

  const t = (m) => new Date(WIN.close - m * 60000).toISOString();
  const timeOrdered = { data: Array.from({ length: 100 }, (_, i) => ({ ticker: "T" + (i % 7), executed_at: t(1 + i * 2),
    premium: String(1000 + ((i * 37) % 100) * 1000), size: 10, price: "1", canceled: false })) };
  const tp = sessionPrints(timeOrdered, SESSION, { limit: 100 });
  eq(tp.session.vendorOrder, "time-or-other", "a vendor that ignores order_by answers newest first");
  const tc = indexCrossFeed("darkpool", tp, { limit: 100, tickers: ["T1"], sessionDate: SESSION });
  eq(tc.orderedBy, "execution time, newest first",
    "and the cross then says the page was cut by time, never that it was ranked by dollar size");
  eq(tc.cutAt, t(199), "naming how far back the capped page reached");
  eq(tc.cut, null, "with no premium threshold, because the vendor applied none");
  const premOrdered = { data: timeOrdered.data.slice().sort((a, b) => Number(b.premium) - Number(a.premium)) };
  const pp = sessionPrints(premOrdered, SESSION, { limit: 100 });
  eq(pp.session.vendorOrder, "premium", "a vendor that honours order_by=premium is recorded as such");
  const pc = indexCrossFeed("darkpool", pp, { limit: 100, tickers: ["T1"], sessionDate: SESSION });
  eq(pc.orderedBy, "the print's dollar size", "and only then is the cross a premium ranking");
  eq(pc.cut, 1000, "whose last place is the premium cut");
  const rankedPanel = shapeDarkpool(tp);
  ok(rankedPanel.rows.every((r, i) => i === 0 || rankedPanel.rows[i - 1].prem >= r.prem),
    "while the print list itself is still ranked by premium by its shaper");
  const recent = sessionPrints(FX.darkpoolRecent, SESSION, { limit: 100 });
  eq(recent.data.length, 0, "the live recent feed's first row (MRVL 23:59:58Z) is an after-hours print");
  eq(sessionPrints(null, SESSION), null, "an absent read passes through as absent");
  eq(sessionPrints({ __failed: "x" }, SESSION).__failed, "x", "and a failed one as failed");
  const p = sessionPrintParams(SESSION);
  eq(p.newer_than, "2026-09-22T13:30:00.000Z", "the per-name read is windowed to the regular session");
  eq(p.older_than, "2026-09-22T20:00:00.000Z", "on both sides");
  eq(p.order_by, "premium", "and asks for premium order");
  ok(!("newer_than" in sessionPrintParams(SESSION, { windowed: false })),
    "the recent feed, which documents no time window, is not sent one");
}

{
  const live = readExpiryBreakdown(FX.expiryBreakdown);
  assert.deepEqual(live, [{ expiry: "2026-09-23", chains: 96, oi: 75260, volume: 735253 }]); checks++;
  const mixed = readExpiryBreakdown([{ expiry: "2026-10-16", chains: "5" }, { expires: "2026-09-25", volume: 3 },
    { expires: "not a date" }, null]);
  assert.deepEqual(mixed.map((r) => r.expiry), ["2026-09-25", "2026-10-16"]); checks++;
  eq(mixed[1].chains, 5, "the legacy expiry spelling still reads, numbers coerced");
}

{
  eq(rowsOf(FX.flowPerExpiry, "bare").length, 1, "flow-per-expiry is a bare array");
  eq(rowsOf(FX.contractHistoric, "chains").length, 1, "contract history sits under chains");
  eq(rowsOf(FX.contractHistoric, "data"), null, "and is not under data");
  eq(typeof rowsOf(FX.gexLevels, "object").call_wall, "string", "gex-levels is an object under data");
  eq(rowsOf(FX.darkpoolLevels, "data").length, 1, "price levels are under data beside a date");
  eq(readCode(new Error("/api/x -> HTTP 422")), "refused", "a 422 plan refusal is refused");
  eq(readCode(new Error("/api/x -> HTTP 403")), "refused", "a 403 is refused");
  eq(readCode(new Error("/api/x -> HTTP 500")), "failed", "a 500 is a failure");
  eq(readCode(new Error("socket hang up")), "failed", "a network error is a failure");
}

{
  const pages = [];
  const alertRow = (t, ms, id) => ({ ticker: t, start_time: ms, id, total_premium: "1", total_ask_side_prem: "1" });
  const all = Array.from({ length: 437 }, (_, i) => alertRow(i % 2 ? "AAA" : "BBB", WIN.close - 1000 - i * 50000, "x" + i));
  const read = async (path, params) => {
    pages.push(params);
    const hi = toMs(params.older_than);
    return { data: all.filter((r) => r.start_time <= hi).slice(0, params.limit), newer_than: "", older_than: "" };
  };
  const b = await readAlertBatch(read, ["AAA", "BBB"], WIN);
  eq(b.complete, true, "paging backwards with older_than reaches a short page");
  eq(b.pages, 3, "three pages for 437 alerts at 200 a page");
  eq(pages[0].ticker_symbol, "AAA,BBB", "names are batched in one comma-separated read");
  eq(pages[0].newer_than, WIN.openIso, "bounded below by the session open");
  eq(new Set(b.rows.map((r) => r.id)).size, 437, "every alert is reached");
  const capped = await readAlertBatch(read, ["AAA", "BBB"], WIN, { maxPages: 2 });
  eq(capped.complete, false, "a page cap short of the open leaves the batch incomplete");
  ok(capped.coverFromM > 0 && capped.coverFromM < 390, `and names the minute it reached (${capped.coverFromM})`);
  const failed = await readAlertBatch(async () => failedRead("failed"), ["AAA"], WIN);
  eq(failed.rows.__failed, "failed", "a failed first page is a failure, not an empty tape");

  const lagged = Array.from({ length: 1000 }, (_, i) => {
    const s = WIN.close - 2000 - i * 20000;
    return { id: "L" + i, ticker: "AAA", start_time: s, end_time: s + 145, created_at: new Date(s + 5000).toISOString() };
  });
  for (const key of ["created_at", "start_time"]) {
    const stamp = (r) => (key === "created_at" ? toMs(r.created_at) : r.start_time);
    const pager = async (path, params) => ({
      data: lagged.filter((r) => stamp(r) < toMs(params.older_than) && stamp(r) >= toMs(params.newer_than))
        .sort((a, b) => stamp(b) - stamp(a)).slice(0, params.limit),
    });
    const got = await readAlertBatch(pager, ["AAA"], WIN);
    eq(new Set(got.rows.map((r) => r.id)).size, 1000,
      `a vendor that pages on ${key} loses no alert between pages (created_at trails start_time by seconds live)`);
    eq(got.complete, true, `and the ${key}-paged batch is complete only because it is`);
  }

  let calls = 0;
  const mlRead = (sizes) => async (path, params) => {
    calls++;
    return { data: Array.from({ length: sizes[(params.offset || 0) / 500] || 0 }, (_, i) => ({ id: `${params.offset}-${i}` })) };
  };
  calls = 0;
  const two = await readMultiLeg(mlRead([500, 120]), "AAA", WIN);
  eq(two.rows.length, 620, "offset paging reads past the first 500 structures");
  eq(two.truncated, false, "and a short second page is complete");
  eq(calls, 2, "in two calls");
  const full = await readMultiLeg(mlRead([500, 500]), "AAA", WIN);
  eq(full.truncated, true, "two full pages hit the documented offset ceiling and say so");
}

{
  const days = weekdaysEndingAt(SESSION, 252);
  const gex = { d: days, g: days.map((_, i) => 2.46e6 - i * 1e4), c: days.map(() => -3.98e7), v: days.map(() => 7.58e7) };
  const volume = { d: days, np: days.map((_, i) => (i % 2 ? -1 : 1) * 4.7e7), bb: days.map(() => -5.6e7),
    vol: days.map(() => 1281743), pc: days.map(() => 0.3605), oi: days.map((_, i) => 4.6e6 + i) };
  const nope = days.map((d, i) => ({ d, v: ((i % 7) - 3) / 10 }));
  const h = buildHist({ ticker: "AAPL", sessionDate: SESSION, generatedAt: "x", fresh: null, gex, volume, nope });
  const size = JSON.stringify(h).length;
  ok(size <= FLOW_LEG.HIST_CAP, `a full year of every series fits the 16 KB hist budget (${size} bytes)`);
  eq(h.trimmed, 0, "without trimming a session");
  eq(h.d0, days[0], "the axis starts at the oldest session");
  eq(h.dd.length, 252, "one offset per session");
  eq(h.dd[h.dd.length - 1], Math.round((Date.parse(SESSION) - Date.parse(days[0])) / 86400000), "offsets are calendar days");
  const back = histNope({ payload: h }, "2026-09-23");
  eq(back.length, 252, "the NOPE series reads back whole on the next session");
  eq(back[251].d, SESSION, "with its dates");
  near(back[100].v, nope[100].v, 1e-4, "and its values within packing precision");
  eq(histNope({ payload: h }, SESSION).length, 251, "the session's own stored close is never its own history");
  const tight = buildHist({ ticker: "AAPL", sessionDate: SESSION, generatedAt: "x", fresh: null, gex, volume, nope, cap: 8000 });
  ok(tight.trimmed > 0 && JSON.stringify(tight).length <= 8000, "an over-budget hist drops the oldest sessions first");
  const fut = buildHist({ ticker: "A", sessionDate: SESSION, generatedAt: "x", fresh: null, gex: null, volume: null,
    nope: [{ d: "2026-09-23", v: 1 }, { d: SESSION, v: 0.5 }] });
  eq(fut.dd.length, 1, "a stored date after the session never enters the axis");
}

{
  const base = { v: 1, ticker: "AAPL", sessionDate: SESSION, generatedAt: "g", depth: "deep",
    fresh: { v: 1, readAt: "2026-09-22T21:40:00Z", vendorAt: "2026-09-22T20:00:00Z" } };
  const other = { v: 1, ticker: "AAPL", sessionDate: SESSION, cone: { status: "ok", pct: 0.4 },
    fresh: { v: 1, readAt: "2026-09-22T21:35:00Z", vendorAt: "2026-09-22T19:00:00Z" } };
  const c = composeCardX(other, base, { gex: { status: "ok", z: 1 } });
  eq(c.payload.cone.pct, 0.4, "another leg's section on the same key is kept");
  eq(c.payload.gex.z, 1, "beside this leg's");
  eq(c.payload.fresh.readAt, "2026-09-22T21:35:00Z", "readAt is the oldest read in the payload");
  eq(c.payload.fresh.vendorAt, "2026-09-22T20:00:00Z", "vendorAt the newest vendor stamp");
  const stale = composeCardX({ ...other, sessionDate: "2026-09-21" }, base, { gex: { status: "ok" } });
  eq(stale.payload.cone, undefined, "a section from another session is not carried forward");
  const pad = (n) => ({ status: "ok", pad: "x".repeat(n) });
  const shed = composeCardX(null, base, { gex: { status: "ok" }, contracts: pad(30000), multiLeg: pad(30000) }, { budget: 40000 });
  assert.deepEqual(shed.shed, ["contracts"]); checks++;
  eq(shed.payload.contracts.why, "shed", "the shed section is a silence with the shed code");
  eq(shed.payload.multiLeg.status, "ok", "and the next in line survives once under budget");
}

{
  const tickers = ["AAA", "BBB", "CCC"];
  const published = {};
  const vendor = makeFlowFakeVendor({ sessionDate: SESSION, spotOf: () => 150 });
  let calls = 0;
  const summary = await runFlowLeg({
    uw: async (...a) => { calls++; return vendor(...a); },
    readStored: makeFlowFakeStore({ sessionDate: SESSION }),
    publish: async (key, payload) => { published[key] = JSON.parse(JSON.stringify(payload)); },
    stored: (key) => published[key] || null,
    runPooled: async (items, work) => {
      const results = [];
      for (const [i, it] of items.entries()) results.push(await work(it, i));
      return { results, attempted: items.map(() => true) };
    },
    sessionDate: SESSION, generatedAt: "2026-09-22T21:40:00Z",
    deep: tickers, cross: ["DDD"],
    featuresOf: () => ({ spot: 150, atr: 3, dollarVolume: 2e9, iv30: 0.3,
      candles: [[SESSION, 149, 151, 148, 150.5, 1e6]] }),
    strikesOf: () => [{ strike: "140", call_gamma_oi: "10", put_gamma_oi: "-90" }, { strike: "160", call_gamma_oi: "80", put_gamma_oi: "-5" }],
    cardOf: () => ({ panels: { oiDeltas: { status: "ok", rows: [{ oc: "AAA261016C00150000", diff: 900 }] } } }),
  });
  eq(summary.calls, calls, "the leg counts every vendor call it makes");
  for (const t of [...tickers, "DDD"]) {
    ok(published["card-x:" + t] && published["hist:" + t], `${t} publishes both keys`);
  }
  for (const t of tickers) {
    const c = published["card-x:" + t];
    for (const k of DEEP_SECTIONS) ok(c[k] && typeof c[k].status === "string", `${t} carries ${k} with a status`);
    eq(c.depth, "deep", "and is marked deep");
  }
  const x = published["card-x:DDD"];
  for (const k of CROSS_SECTIONS) ok(x[k] && typeof x[k].status === "string", `the cross-section name carries ${k}`);
  ok(!("nope" in x), "and no deep-only section");
  ok(published["hist:AAA"].dd.every((o) => Number.isInteger(o)), "hist offsets are integers");
  ok(summary.calls >= tickers.length * 10, `a deep name costs its reads (${summary.calls} calls for three deep and one cross)`);
}

{
  const days = weekdaysEndingAt("2026-09-21", 200);
  const kept = days.map((_, i) => ((i % 9) - 4) / 10);
  const stored = { v: 1, ticker: "X", sessionDate: days[199], d0: days[0],
    dd: days.map((d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(days[0] + "T00:00:00Z")) / 86400000)),
    nope: { asOf: days[199], ...packSeries(kept) } };
  const answers = {
    "hist:DOWN": async () => ({ payload: null, failed: true, status: 503 }),
    "hist:THROW": async () => { throw new Error("socket hang up"); },
    "hist:GOOD": async () => ({ payload: stored, status: 200 }),
    "hist:XDOWN": async () => ({ payload: null, failed: true, status: 0 }),
    "hist:FRESH": async () => ({ payload: null, absent: true, status: 200 }),
  };
  const published = {};
  const lines = [];
  let clock = Date.parse("2026-09-22T21:40:00Z");
  const summary = await runFlowLeg({
    now: () => new Date((clock += 60000)),
    uw: makeFlowFakeVendor({ sessionDate: SESSION, spotOf: () => 150 }),
    readStored: (key) => answers[key](),
    publish: async (key, payload) => { published[key] = JSON.parse(JSON.stringify(payload)); },
    stored: (key) => published[key] || null,
    runPooled: async (items, work) => {
      const results = [];
      for (const [i, it] of items.entries()) results.push(await work(it, i));
      return { results, attempted: items.map(() => true) };
    },
    sessionDate: SESSION, generatedAt: "2026-09-22T21:40:00Z",
    deep: ["DOWN", "THROW", "GOOD", "FRESH"], cross: ["XDOWN"],
    featuresOf: () => ({ spot: 150, atr: 3, dollarVolume: 2e9, iv30: 0.3, candles: [[SESSION, 149, 151, 148, 150.5, 1e6]] }),
    strikesOf: () => [], cardOf: () => null, log: (l) => lines.push(l),
  });
  for (const t of ["DOWN", "THROW", "XDOWN"]) {
    ok(published["card-x:" + t], `${t}'s card-x still publishes when its history read fails`);
    eq(published["hist:" + t], undefined,
      `but hist:${t} is not rewritten: a failed read-back must never replace 200 kept NOPE closes with one`);
  }
  eq(published["card-x:DOWN"].nope.z, null, "no z-score is drawn from a history that could not be read");
  eq(published["card-x:DOWN"].nope.gaps.z, "history-unread", "and the gap says the history was unread, not short");
  eq(published["card-x:DOWN"].nope.gaps.historyN, "history-unread", "nor is its length reported as zero");
  eq(summary.published.histHeld, 3, "the summary counts the held histories");
  ok(lines.some((l) => /hist:DOWN not rewritten .*HTTP 503/.test(l)), "and the log names the name and the status");
  const good = published["hist:GOOD"];
  eq(good.nope.x.filter((x) => x !== null).length, 201, "a readable history carries its 200 closes forward plus today's");
  eq(published["card-x:GOOD"].nope.historyN, 200, "and the z-score is drawn against all 200");
  eq(published["hist:FRESH"].nope.x.filter((x) => x !== null).length, 1,
    "a name with no stored history yet starts one with today's close");
  eq(published["card-x:FRESH"].nope.gaps.z, "short-history", "and is honestly short of history");
  for (const t of ["DOWN", "THROW", "GOOD", "FRESH"]) {
    eq(published["card-x:" + t].fresh.readAt, "2026-09-22T21:41:00.000Z",
      `card-x:${t} dates its reads from the alert batch, read before any name: readAt is the oldest read inside`);
  }
  ok(published["card-x:XDOWN"].fresh.readAt > "2026-09-22T21:41:00.000Z",
    "a cross-section name carries no alert tape, so its readAt is its own");
}

const CODES = new Set(Object.keys(FLOW_CODES));
const STATUSES = new Set(["ok", "stale", "quiet", "unavailable", "unreadable"]);
const checkSection = (name, s, where) => {
  ok(s && STATUSES.has(s.status), `${where}.${name} has a status from the silence union (got ${s && s.status})`);
  if (s.status !== "ok") ok(CODES.has(s.why), `${where}.${name} ${s.status} carries a declared code (${s.why})`);
  if (s.why) ok(CODES.has(s.why), `${where}.${name} why ${s.why} is declared`);
  for (const [field, code] of Object.entries(s.gaps || {})) {
    ok(CODES.has(code), `${where}.${name}.gaps.${field} = ${code} is a declared code`);
  }
  for (const [field, unit] of Object.entries(s.u || {})) {
    ok(unit in UNITS, `${where}.${name}.u.${field} = ${unit} is a declared unit`);
  }
  for (const [field, value] of Object.entries(s)) {
    if (value === null && !["why", "vendorAt", "readAt", "time", "source", "asOf", "flowFlipM", "f",
      "coverFromM", "cp", "k", "e", "oiChange"].includes(field)) {
      ok(s.gaps && s.gaps[field], `${where}.${name}.${field} is null and says why in gaps`);
    }
  }
};

const dir = mkdtempSync(join(tmpdir(), "flows-positioning-"));
try {
  execFileSync("node", [join(ROOT, "scripts/flows-pipeline.mjs"), "--dry-run", "--emit", join(dir, "p.json")],
    { stdio: "pipe" });
  const files = readdirSync(dir);
  const read = (f) => JSON.parse(readFileSync(join(dir, f), "utf8"));
  const cardX = files.filter((f) => /^p-card-x-/.test(f)).map(read);
  const hists = files.filter((f) => /^p-hist-/.test(f)).map(read);
  const cards = files.filter((f) => /^p-card-(?!x-)/.test(f)).map(read);
  ok(cardX.length === cards.length && cardX.length > 0, `every carded name gets a card-x (${cardX.length} of ${cards.length})`);
  eq(hists.length, cardX.length, "and a hist");
  for (const c of cardX) {
    const bytes = JSON.stringify(c).length;
    ok(bytes <= FLOW_LEG.CARD_X_CAP, `card-x:${c.ticker} is ${bytes} bytes, inside its cap`);
    ok(c.fresh && typeof c.fresh.readAt === "string" && c.fresh.session === c.sessionDate && c.fresh.cadenceS === 0,
      `card-x:${c.ticker} carries the freshness envelope`);
    for (const k of c.depth === "deep" ? DEEP_SECTIONS : CROSS_SECTIONS) checkSection(k, c[k], "card-x:" + c.ticker);
  }
  const kinds = (k) => new Set(cardX.filter((c) => c[k]).map((c) => c[k].status));
  for (const [k, want] of [["flowExpiry", "unavailable"], ["flowStrike", "unavailable"], ["dpLevels", "quiet"]]) {
    ok(kinds(k).has("ok") && kinds(k).has(want), `the dry run exercises ${k} ok and ${want}`);
  }
  ok(cardX.some((c) => c.gexPath && c.gexPath.flowFilled === false), "and a gamma clock whose flow legs stayed zero");
  ok(cardX.some((c) => c.nope && c.nope.z !== null) && cardX.some((c) => c.nope && c.nope.gaps && c.nope.gaps.z === "short-history"),
    "and a NOPE z from kept history beside one still short of it");
  ok(cardX.some((c) => c.multiLeg && c.multiLeg.truncated === true), "and a multi-leg read that hit its ceiling");
  for (const h of hists) {
    const bytes = JSON.stringify(h).length;
    ok(bytes <= FLOW_LEG.HIST_CAP, `hist:${h.ticker} is ${bytes} bytes, inside 16 KB`);
    const last = new Date(Date.parse(h.d0 + "T00:00:00Z") + h.dd[h.dd.length - 1] * 86400000).toISOString().slice(0, 10);
    ok(last <= h.sessionDate, `hist:${h.ticker} ends on or before its session (${last})`);
  }
  for (const c of cards) {
    const dp = c.panels && c.panels.darkpool;
    if (!dp || dp.status !== "ok") continue;
    const win = sessionWindow(c.sessionDate);
    for (const r of dp.rows) {
      const t = Date.parse(r.at);
      ok(t >= win.open && t < win.close, `${c.ticker}'s dark-pool print at ${r.at} is inside the regular session`);
    }
    ok(dp.rows.every((r, i) => i === 0 || dp.rows[i - 1].prem >= r.prem), `${c.ticker}'s prints are ranked by premium`);
    ok(dp.session && dp.session.outside >= 4, `${c.ticker}'s panel says how many out-of-session prints it cut`);
  }
  const pulse = read("p-pulse.json");
  const pwin = sessionWindow(pulse.sessionDate);
  ok(pulse.darkpool.rows.every((r) => Date.parse(r.at) >= pwin.open && Date.parse(r.at) < pwin.close),
    "the pulse's market-wide prints are all inside the regular session");
  ok(pulse.darkpool.rows.every((r, i) => i === 0 || pulse.darkpool.rows[i - 1].prem >= r.prem),
    "and ranked by premium");
  ok(pulse.darkpool.session && pulse.darkpool.session.extendedCode === 8,
    "and the eight after-hours prints at the head of the vendor's answer were cut and counted");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const file of ["shared/flows-positioning.js", "scripts/flows-legs/flow.mjs", "scripts/flows-legs/flow-fake.mjs"]) {
  const src = readFileSync(join(ROOT, file), "utf8");
  ok(!/^\s*\/\//m.test(src) && !/\/\*[\s\S]*?\*\//.test(src), `${file} carries no comments`);
}
eq(POSITIONING_LINES.FLIP_AGREE_ATR, 0.5, "flip agreement is half an ATR");

console.log(`✓ flows-positioning-contract: ${checks} assertions — every positioning and flow metric pinned to a ` +
  `known answer on the live probe's own rows, every absent input a coded silence rather than a zero, the ` +
  `envelopes read by rule (bare arrays, chains, objects under data, dated levels), the dark-pool prints cut to the ` +
  `regular session and ranked by premium, the expiry breakdown read under its live field name, and the ` +
  `card-x and hist keys held to their byte caps on the dry run`);
