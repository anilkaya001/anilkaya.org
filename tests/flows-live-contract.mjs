import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  FRESH_CLASSES, REFRESH_CADENCE_MINUTES, PHASE_MINUTES, phaseAt, freshnessState, freshHeaders, expectedNightlySession,
  easternInstant, tier1Due, liveDispatchDue, liveStalled, nightlyDispatchDue, sessionClose, isWeekdayDay, isHoliday,
  LIVE_CLOCK,
} from "../shared/flows-freshness.js";
import * as L from "../shared/flows-live.js";
import * as W from "../shared/flows-live-worker.js";
import * as FAKE from "../scripts/flows-legs/live-fake.mjs";
import {
  readHeldAlerts, boardPlan, liveWindow, runLive, runLiveLoop, chainDispatch, nextSlot, LIVE_LOOP, readLiveClock,
  sessionClock, liveRunVerdict, passOutcome, focusStripNames, FOCUS_FALLBACK,
} from "../scripts/flows-legs/live.mjs";
import {
  healthChecks, runHealthGate, refusalOf, refusalTally, tallyRefusal, tallyAnswer, HEALTH, LAB_SIGN_IN, SIGN_IN_ADVICE,
} from "../scripts/flows-legs/health.mjs";
import * as LAB from "../shared/lab-sign-in.js";
import {
  shapeNews, liveCredential, liveCredentialSource, LIVE_BEARER_MARGIN_MS, resetPublishRetryBudget, intradayRefusal,
} from "../scripts/flows-pipeline.mjs";
import * as O from "../shared/flows-oidc.js";
import { oidcIssuer, tickDb, tier1Bodies, focusDb, focusGroupsSample, productionScreenerBody } from "./live-stubs.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const FX = JSON.parse(read("tests/fixtures-live-probe.json"));

let checks = 0;
const TIMER_SLACK_MS = 50;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const T = (iso) => Date.parse(iso);
const cronField = (field) => field.split(",").flatMap((part) => {
  const [a, b = a] = part.split("-").map(Number);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
});
const cronMinutes = (cron) => {
  const [m, h] = cron.split(" ");
  return cronField(h).flatMap((hh) => cronField(m).map((mm) => hh * 60 + mm));
};

{
  deep(Object.fromEntries(Object.entries(FRESH_CLASSES).map(([k, v]) => [k, [v.cadenceS, v.liveS, v.staleS]])), {
    quote: [5, 20, 90], tape: [60, 150, 600], market: [300, 660, 1500], breadth: [900, 1200, 2700],
    nightly: [0, null, null],
  }, "THE THRESHOLD TABLE is one table in code: quote 5 s (live 20 s, fresh 90 s), tape 60 s (150 s, 10 min), " +
    "market 300 s (11 min, 25 min), breadth 900 s (20 min, 45 min), nightly once per session");
  eq(FRESH_CLASSES.nightly.graceS, 5 * 3600, "and a nightly session is due five hours after its close, 21:00 ET, " +
    "after the 20:08 ET landing measured on 2026-09-24 rather than an hour before it");
  eq(REFRESH_CADENCE_MINUTES, 5, "the cadence the pulse stamp quotes is the Tier 1 clock's");
  for (const [key, spec] of Object.entries(L.LIVE_KEYS)) {
    ok(L.LIVE_KEY_RE.test(key) && spec.cadenceS === FRESH_CLASSES[spec.klass].cadenceS && spec.maxBytes <= 120 * 1024,
      `${key} is a live:* key with its class's cadence and a byte cap under the ingest's 128 KB (${spec.maxBytes})`);
  }
  deep(Object.keys(L.LIVE_KEYS).filter((k) => L.LIVE_KEYS[k].writer === "worker"), ["live:market", "live:focus"],
    "exactly two live keys are written by the Worker itself (live:market from Tier 1, live:focus from the focus " +
    "cron); every other live key has the Actions run as its single writer");
  deep([L.LIVE_KEYS["live:focus"].klass, L.LIVE_KEYS["live:focus"].cadenceS, L.LIVE_KEYS["live:focus"].reads],
    ["market", 300, 1],
    "live:focus is on the market clock (a five-minute cadence, live for 11 minutes) and costs one vendor call a tick");
  eq(L.TIER1_CALLS.length, L.LIVE_BUDGET.tier1Calls, "Tier 1 spends two vendor calls a tick");
  deep(L.TIER1_CALLS.map((c) => c.feed), ["tide", "sectors"],
    "and they are the five-minute market tide and the sector-ETF snapshot: the three 390-row one-minute feeds " +
    "(0DTE net flow, SPY and QQQ etf-tide) left Tier 1 for Tier 2, because parsing and bucketing them filled the " +
    "Workers Free 10 ms CPU cap once the session's rows filled in");
  deep(L.TIER1_CALLS[0].params, { interval_5m: "true" }, "the tide is read at five-minute resolution, 78 rows a session");
  deep([...L.BREADTH_ETFS], ["SPY", "QQQ", "IWM", "DIA"], "Tier 2 carries the four index ETF tides in one shape");
}

{
  const edt = (hm) => T(`2026-09-23T${hm}:00-04:00`);
  const est = (hm) => T(`2026-01-14T${hm}:00-05:00`);
  const cases = [
    [edt("03:59"), "closed"], [edt("04:00"), "pre"], [edt("09:29"), "pre"], [edt("09:30"), "rth"],
    [edt("15:59"), "rth"], [edt("16:00"), "post"], [edt("19:59"), "post"], [edt("20:00"), "closed"],
    [est("09:29"), "pre"], [est("09:30"), "rth"], [est("16:00"), "post"], [est("20:00"), "closed"],
  ];
  for (const [at, want] of cases) {
    eq(phaseAt(at).phase, want, `${new Date(at).toISOString()} is ${want} — phases read on the Eastern clock under EDT and EST alike`);
  }
  eq(new Date(phaseAt(edt("10:00")).endsAt).toISOString(), "2026-09-23T20:00:00.000Z", "an EDT session closes at 20:00Z");
  eq(new Date(phaseAt(est("10:00")).endsAt).toISOString(), "2026-01-14T21:00:00.000Z", "and an EST one at 21:00Z");
  eq(phaseAt(T("2026-09-26T15:00:00Z")).phase, "closed", "a Saturday is closed all day");
  eq(new Date(phaseAt(T("2026-09-26T15:00:00Z")).endsAt).toISOString(), "2026-09-28T08:00:00.000Z",
    "and its phase ends at Monday's 04:00 pre-open");

  const holiday = { day: "2026-09-23", trading: 0 };
  eq(phaseAt(edt("11:00"), holiday).phase, "closed",
    "A TAPE-DERIVED HOLIDAY (flows_clock.trading = 0 for today) is closed through the session, on a day the computed calendar thought traded");
  eq(phaseAt(edt("11:00"), holiday).lastClosed, "2026-09-22", "and its last closed session is the day before");
  const undecided = { day: "2026-09-23", trading: null, earlyClose: null };
  ok(phaseAt(edt("11:00"), undecided).phase === "rth" && phaseAt(edt("11:00"), undecided).trading === true &&
     phaseAt(edt("11:00"), { day: "2026-09-23" }).trading === true,
  "AN UNDECIDED DAY IS A TRADING DAY: the 09:31 tick rolls flows_clock to today with trading NULL until the 09:45 " +
    "probe, and Number(null) is 0 — reading it as a closed day silenced Tier 1 for the rest of 2026-09-24");
  ok(phaseAt(edt("11:00"), { day: "2026-09-23", trading: "0" }).phase === "closed" &&
     phaseAt(edt("11:00"), { day: "2026-09-23", trading: 1 }).phase === "rth",
  "only an explicit 0 closes the day");
  const half = { day: "2026-11-27", earlyClose: 1 };
  eq(phaseAt(T("2026-11-27T13:30:00-05:00"), half).phase, "post", "A TAPE-DERIVED EARLY CLOSE ends the session at 13:00");
  eq(new Date(sessionClose("2026-11-27", half)).toISOString(), "2026-11-27T18:00:00.000Z", "13:00 EST is 18:00Z");
  eq(phaseAt(T("2026-11-27T13:30:00-05:00")).phase, "post",
    "and the day after Thanksgiving is a computed early close even before the tape confirms it");
  eq(phaseAt(T("2026-11-20T13:30:00-05:00")).phase, "rth", "while without the clock's word an ordinary Friday afternoon trades");

  eq(expectedNightlySession(T("2026-09-23T20:59:00-04:00")), "2026-09-22",
    "the nightly for a session is not due until 21:00 ET (close + 5 h)");
  eq(expectedNightlySession(T("2026-09-23T21:00:00-04:00")), "2026-09-23", "and is due from then");
  eq(expectedNightlySession(T("2026-09-26T12:00:00Z")), "2026-09-25", "a weekend expects Friday's");
  eq(expectedNightlySession(T("2026-09-23T20:00:00-04:00"), holiday), "2026-09-22",
    "and a holiday expects the session before it");
}

{
  const at = T("2026-09-23T14:00:00Z");
  const m = (dt, extra = {}) => ({ readAt: at - dt * 1000, cadenceS: 300, session: "2026-09-23", ...extra });
  eq(freshnessState(m(0), at).state, "live", "a market read this instant is live");
  eq(freshnessState(m(660), at).state, "live", "and still live at exactly 11 minutes");
  eq(freshnessState(m(661), at).state, "fresh", "fresh one second later");
  eq(freshnessState(m(1500), at).state, "fresh", "fresh through 25 minutes");
  eq(freshnessState(m(1501), at).state, "stale", "and stale after — two missed ticks and a half");
  const f = freshnessState(m(60), at);
  eq(f.liveUntil, at - 60000 + 660000, "liveUntil = readAt + 11 min, an absolute instant");
  eq(f.staleAt, at - 60000 + 1500000, "staleAt = readAt + 25 min");
  eq(f.phaseEndsAt, T("2026-09-23T20:00:00Z"), "phaseEndsAt is the close");

  const open = T("2026-09-23T13:30:00Z");
  const yday = { readAt: T("2026-09-22T20:03:00Z"), cadenceS: 300, session: "2026-09-22" };
  eq(freshnessState(yday, open + 60000).state, "closed",
    "YESTERDAY'S FINAL READING in the first cadence after the open is closed (awaiting the first tick), not stale");
  eq(freshnessState(yday, open + 60000).reason, "awaiting-first-read", "and says so");
  eq(freshnessState(yday, open + 11 * 60000 + 1).state, "stale", "once the first tick is overdue it is stale");
  eq(freshnessState(yday, T("2026-09-22T23:00:00Z")).state, "closed",
    "after the close, a reading within one cadence of it is the session's final reading: closed");
  eq(freshnessState({ ...yday, readAt: T("2026-09-22T19:00:00Z") }, T("2026-09-22T23:00:00Z")).state, "stale",
    "one that stopped an hour before the close missed the end of the session: stale");
  eq(freshnessState({ cadenceS: 300 }, at).reason, "unstamped", "no readAt is stale, reason unstamped");

  const night = { readAt: "2026-09-22T21:40:00Z", session: "2026-09-22", cadenceS: 0 };
  eq(freshnessState(night, T("2026-09-23T15:00:00Z")).state, "fresh", "last night's session is fresh all day");
  eq(freshnessState(night, T("2026-09-23T23:00:01Z")).state, "fresh",
    "and still fresh at 19:00 ET, while tonight's run is still landing");
  eq(freshnessState(night, T("2026-09-24T01:00:01Z")).state, "stale",
    "and stale from 21:00 ET, when tonight's run was due");
  eq(freshnessState(night, T("2026-09-23T15:00:00Z")).staleAt, T("2026-09-24T01:00:00Z"),
    "its staleAt is that instant, so the browser compares clocks and holds no threshold");
  eq(freshnessState({ readAt: "2026-09-22T21:40:00Z", cadenceS: 0 }, T("2026-09-23T15:00:00Z")).reason, "unsessioned",
    "a nightly payload with no session cannot be judged fresh");

  const q = freshnessState({ readAt: at - 21000, cadenceS: 5, klass: "quote" }, at);
  eq(q.state, "fresh", "a quote 21 s old is fresh, not live");
  const h = freshHeaders(m(30), at).headers;
  for (const name of ["X-Fresh-State", "X-Fresh-Read-At", "X-Fresh-Source", "X-Fresh-Cadence", "X-Fresh-Session",
    "X-Fresh-Live-Until", "X-Fresh-Stale-At", "X-Fresh-Phase-Ends", "X-Server-Now"]) {
    ok(typeof h[name] === "string", `the header set carries ${name}`);
  }
  eq(h["X-Server-Now"], String(at), "X-Server-Now is epoch ms, the one number the browser needs for skew");
}

{
  const day = "2026-09-23";
  const et = (h, m) => easternInstant(day, h * 60 + m);
  ok(!tier1Due(et(9, 29)) && tier1Due(et(9, 31)) && tier1Due(et(16, 6)) && !tier1Due(et(16, 11)),
    "Tier 1 runs from the open to ten minutes past the close — the final reading of the session");
  ok(!tier1Due(et(11, 1), { day, trading: 0 }), "and not at all on a tape-derived holiday");
  eq(liveDispatchDue(et(10, 1)).due, true, "Tier 2 is dispatched at :01");
  eq(liveDispatchDue(et(10, 6)).why, "off-tick", "not at :06");
  eq(liveDispatchDue(et(16, 16)).due, true, "the :16 after the close dispatches the final Tier 2 read");
  eq(liveDispatchDue(et(16, 31)).why, "outside-window", "and :31 after it does not");
  eq(liveDispatchDue(et(10, 16), { liveDispatchedAt: et(10, 10), liveDoneAt: null }).why, "in-flight",
    "a run dispatched six minutes ago that has not landed is still in flight — no pile-up");
  eq(liveDispatchDue(et(10, 16), { liveDispatchedAt: et(10, 10), liveDoneAt: et(10, 11) }).due, true,
    "while one that has landed does not hold the next");
  ok(!liveStalled(et(10, 0), null), "the watchdog waits 45 minutes into the session");
  ok(liveStalled(et(11, 0), et(10, 10)), "then flags a breadth read 50 minutes old");
  ok(!liveStalled(et(11, 0), et(10, 30)), "but not one 30 minutes old");
  eq(nightlyDispatchDue(et(17, 14), null, "2026-09-22").why, "before-window", "the nightly waits for 17:15 ET");
  eq(nightlyDispatchDue(et(17, 30), null, "2026-09-22").due, true, "then dispatches when meta is behind");
  eq(nightlyDispatchDue(et(17, 30), null, day).why, "landed", "and never when today's has landed");
  eq(nightlyDispatchDue(et(17, 45), { nightlyDay: day }, "2026-09-22").why, "dispatched", "once a day");
  const again = nightlyDispatchDue(et(18, 15), { nightlyDay: day }, "2026-09-22");
  ok(again.due && again.redispatch, "and once more at 18:15 if nothing landed");
  eq(nightlyDispatchDue(et(18, 45), { nightlyDay: day, nightlyRedispatchedAt: et(18, 15) }, "2026-09-22").due, false,
    "but never a third time");

  const feeds = (d, now) => ({ tide: FAKE.fakeMarketTide({ session: d, now }), sectors: FAKE.fakeSectorEtfs({ session: d }) });
  const y = feeds("2026-09-22", easternInstant("2026-09-22", 16 * 60));
  const t = feeds(day, et(9, 45));
  eq(L.sectorEtfsDay(t.sectors), day,
    "the sector-ETF snapshot dates itself by prev_date: its rows describe the weekday after the vendor's prev_date");
  eq(L.sectorEtfsDay({ data: [FX.sectorEtfs.full] }), "2026-09-22", "PROBE ROW: prev_date 2026-09-21 is the 09-22 snapshot");
  eq(L.tideSessionState(y, { today: day, afterProbe: true }), 0,
    "THE HOLIDAY VERDICT: after 09:45, when both Tier 1 feeds still carry the previous session, today is not trading");
  eq(L.tideSessionState({ ...t, tide: y.tide }, { today: day, afterProbe: true }), 1,
    "but ONE feed lagging behind the other is not a holiday — the verdict is sticky for the whole day and stops " +
    "Tier 1 and every dispatch, so a single stale market-tide body must not be able to cast it");
  eq(L.tideSessionState({ tide: y.tide, sectors: { __failed: "HTTP 502" } }, { today: day, afterProbe: true }), null,
    "and a lone stale feed with the other unanswered is no verdict yet: the next tick asks again");
  const afterHoliday = { tide: y.tide, sectors: FAKE.fakeSectorEtfs({ session: "2026-09-23" }) };
  eq(L.tideSessionState(afterHoliday, { today: "2026-09-24", afterProbe: true }), null,
    "two stale feeds that disagree on WHICH earlier session they carry (a lagging tide the morning after a holiday) " +
    "are no verdict either: a holiday shows every feed on the same last session");
  eq(L.tideSessionState(t, { today: day, afterProbe: false }), null, "nor is anything decided before 09:45");
}

{
  const tide = L.shapeTideFeed({ data: [FX.marketTide.row], date: FX.marketTide.date }, { session: "2026-09-22" });
  eq(tide.status, "ok", "PROBE ROW: the market-tide row shapes");
  deep(tide.t, ["2026-09-22T13:30:00Z"], "its -04:00 stamp is normalised to UTC");
  deep([tide.ncp[0], tide.npp[0], tide.nv[0]], [12437984, -14365849, 105996],
    "net call and put premium arrive as strings and are coerced; net_volume arrives as a number");
  eq(tide.net[0], 26803833, "net = ncp − npp = 12,437,984 − (−14,365,849) — a put premium sold on net adds to the bull side");

  const nf = L.shapeNetFlowFeed({ data: [FX.netFlowExpiry.block], date: "2026-09-22", expiration: ["zero_dte"] },
    { session: "2026-09-22", expiration: "zero_dte" });
  eq(nf.n, 1, "PROBE BLOCK: four 1-minute net-flow rows fold into one 5-minute bucket");
  deep(nf.t, ["2026-09-22T13:33:00Z"], "sampled at its last minute, because the series is cumulative");
  deep([nf.ncp[0], nf.npp[0], nf.nv[0], nf.px[0], nf.net[0]], [-38898, -1028078, 1565, 774.915, 989180],
    "every value arrives as a string, net_volume included, and net = −38,898.40 − (−1,028,078.20) = 989,179.80");
  deep(nf.echoed, ["zero_dte"], "the expiration echo is kept so a run can see which one combination the vendor honoured");

  const spy = L.shapeTideFeed({ data: [FX.etfTideSpy.row], date: "2026-09-22" }, { session: "2026-09-22", withPx: true });
  deep([spy.net[0], spy.px[0], spy.nv[0]], [-246832, 774.26, 10013],
    "PROBE ROW: SPY etf-tide net = 626,627 − 873,459; its net_volume is a string here, unlike the market tide's");
  const tech = L.shapeTideFeed({ data: [FX.sectorTideTechnology.row], date: "2026-09-22" }, { session: "2026-09-22" });
  eq(tech.net[0], 1538890, "PROBE ROW: Technology sector-tide net = 2,487,087 − 948,197");

  const prior = L.shapeTideFeed({ data: [FX.marketTide.row], date: "2026-09-22" }, { session: "2026-09-23" });
  eq(prior.status, "prior", "a tide whose vendor date is before the session is marked prior, not passed off as today");
  eq(L.shapeTideFeed({ __failed: "HTTP 502" }, { session: "2026-09-23" }).reason, "vendor-failed",
    "a failed feed is unavailable with its reason");
  eq(L.shapeTideFeed({ data: [] }, { session: "2026-09-23" }).status, "quiet", "an empty one is quiet");
  eq(L.shapeTideFeed(undefined, { session: "2026-09-23" }).reason, "not-read", "an unread one says not-read");

  const clipped = L.shapeSectorEtfs({ data: [FX.sectorEtfs.row] }).rows[0];
  ok(clipped.chg === null && clipped.lean === null && clipped.bull === null,
    "ABSENT INPUTS STAY NULL: the probe's SPY row (clipped before prev_close and the premium sides) yields no change " +
    "and no lean, never a zero");
  const full = L.shapeSectorEtfs({ data: [FX.sectorEtfs.full] }).rows[0];
  eq(full.chg, 0.003061, "chg = last / prev_close − 1 = 773.38 / 771.02 − 1");
  eq(full.lean, 0.232978, "lean = (bull − bear) / (bull + bear) on the vendor's own premium sides");
  eq(full.net, 426644583, "net = bull − bear in USD");
  const zero = L.shapeSectorEtfs({ data: [{ ...FX.sectorEtfs.full, bullish_premium: "0", bearish_premium: "0" }] }).rows[0];
  ok(zero.lean === null && zero.net === 0 && zero.leanWhy === "zero-gross",
    "a measured zero on both sides is a measured net of 0 and an undefined lean (0/0), named zero-gross");

  const prem = L.shapeTapePrem({ ticks: { data: [FX.netPremTicks.row] }, alerts: { data: [FX.flowAlerts.row] } },
    { at: T("2026-09-22T20:00:00Z"), session: "2026-09-22" });
  deep([prem.prem.ncp[0], prem.prem.npp[0], prem.prem.net[0], prem.prem.nd[0], prem.prem.cva[0], prem.prem.cvb[0]],
    [1497143, -264970, 1762113, 159715, 13550, 6567],
    "PROBE ROW: net-prem-ticks is per-minute, cumulated over the session; nd rounds the 18-decimal delta string");
  eq(prem.alerts.rows.length, 1, "PROBE ROW: the flow alert shapes (fields cut by the probe's clip are listed as reconstructed)");
  eq(prem.alerts.rows[0].st, null, "and a per-name read publishes no screener stage it never consulted");
  const pre = L.shapeGexSeries({ data: [FX.spotExposures1m.row] }, { session: "2026-09-22" });
  ok(pre.status === "quiet" && pre.reason === "pre-open",
    "PROBE ROW: a 06:30 ET spot-exposures minute is pre-open — quiet with its reason, not a regular-session reading");

  const tape = L.shapeLiveTape({ totals: { data: [FX.totalOptionsVolume.row] }, netImpact: { data: [FX.topNetImpact.row] },
    darkpool: { data: [FX.darkpoolRecent.row] } }, { at: T("2026-09-22T20:00:00Z"), session: "2026-09-22" });
  deep([tape.totals.today.pcVol, tape.totals.today.pcPrem], [0.6597, 0.4365],
    "PROBE ROW: put/call = 25,895,745 / 39,255,508 by volume and 15,142,883,165.20 / 34,694,997,463.09 by premium");
  const halfRow = L.shapeLiveTape({ totals: { data: [{ ...FX.totalOptionsVolume.row, put_volume: null, put_premium: "" }] } },
    { at: T("2026-09-22T20:00:00Z"), session: "2026-09-22" }).totals.today;
  ok(halfRow.putVol === null && halfRow.pcVol === null && halfRow.putPrem === null && halfRow.pcPrem === null,
    "AN ABSENT PUT SIDE is an absent put/call ratio, never 0 (null / n coerces to 0 in JavaScript)");
  eq(tape.netImpact.rows[0].netPrem, 144891918, "top-net-impact's net_premium arrives as a JSON number and is kept");
  eq(tape.darkpool.dropped.extended, 1,
    "PROBE ROW: the recent dark-pool feed leads with an after-hours print (23:59:58Z), which the session window drops");
  eq(tape.darkpool.status, "quiet", "leaving the session's window empty rather than dated by the evening tail");

  const news = shapeNews({ data: [FX.news.row] });
  eq(news.rows.length, 1, "PROBE ROW: the news row shapes through the nightly's own shaper");
}

{
  eq(L.basisCheck([1, 2]), null, "the basis check needs 30 points before it says anything");
  let v = 0;
  const walk = Array.from({ length: 200 }, (_, i) => (v += Math.sin(i * 1.7) + 0.3));
  eq(L.basisCheck(walk), "cumulative", "a random-walk path reads as cumulative (variance ratio < 0.5)");
  const iid = Array.from({ length: 200 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
  eq(L.basisCheck(iid), "increment", "a stationary series reads as increments");
  const rows = Array.from({ length: 6 }, (_, i) => ({ t: new Date(T("2026-09-22T13:30:00Z") + i * 60000).toISOString(), x: i + 1 }));
  const inc = L.bucketSeries(rows, { time: "t", fields: { x: "x" }, basis: "increment", net: null, check: false });
  deep(inc.x, [15, 21], "KNOWN ANSWER: increments 1..6 over 13:30–13:35 cumulate to 15 at the first bucket's last minute and 21 after");
  const cum = L.bucketSeries(rows, { time: "t", fields: { x: "x" }, basis: "cumulative", net: null, check: false });
  deep(cum.x, [5, 6], "while a cumulative series is sampled at each bucket's last row, never summed");
  const gaps = L.bucketSeries([{ t: "2026-09-22T13:30:00Z", x: "" }, { t: "garbage", x: "3" }],
    { time: "t", fields: { x: "x" }, net: null, check: false });
  ok(gaps.n === 0 && gaps.dropped === 2, "a row with an empty value or an unreadable stamp is dropped and counted");
}

{
  const leg = (net, extra = {}) => ({ status: "ok", date: "2026-09-23", net, ...extra });
  eq(L.zeroDteShare(leg([100, -300]), leg([900])).value, 0.25,
    "KNOWN ANSWER: 0DTE share = |−300| / (|−300| + |900|) = 0.25");
  const zz = L.zeroDteShare(leg([0]), leg([0]));
  ok(zz.value === null && zz.reason === "zero-gross", "0 over 0 is undefined, not neutral");
  ok(L.zeroDteShare(leg([]), leg([5])).value === null, "an absent leg gives no share");
  const stale = L.zeroDteShare(leg([-300], { status: "prior", reason: "vendor-prior-session", date: "2026-09-22" }),
    leg([900]));
  ok(stale.value === null && stale.zeroNet === null && stale.reason === "vendor-prior-session",
    "a 0DTE leg that is YESTERDAY'S final reading gives no share for today — the two legs are never mixed across sessions");
  ok(L.zeroDteShare(leg([-300], { date: "2026-09-22" }), leg([900])).value === null,
    "nor do two legs the vendor dated differently");
  const closedTide = L.shapeMarketLive({ tide: { data: [FX.marketTide.row], date: FX.marketTide.date } },
    { at: T("2026-09-23T13:36:00Z"), session: "2026-09-23" });
  ok(closedTide.tide.status === "prior" && closedTide.tide.n === 1 && closedTide.last.tideNet === null,
    "live:market keeps a prior-session tide under its own date, but its `last` block — the headline numbers — " +
    "never carries yesterday's value as today's");

  const row = { ticker: "ZZZ", date: "2026-09-22", close: "110", prev_close: "100", net_call_premium: "3000000", net_put_premium: "1000000",
    bullish_premium: "60", bearish_premium: "20", iv30d: "0.3123", gex_gamma_per_one_percent_move_oi: "12345678" };
  const strips = L.shapeStrips({ data: [row] }, { at: T("2026-09-23T15:00:00Z"), session: "2026-09-23", names: ["ZZZ", "QQQ"] });
  const at = (n) => strips.rows.ZZZ[strips.fields.indexOf(n)];
  deep([at("chg"), at("net"), at("lean"), at("iv30")], [0.1, 2000000, 0.5, 0.3123],
    "KNOWN ANSWERS: chg = 110/100 − 1; net = ncp − npp; lean = (60 − 20)/(60 + 20)");
  ok(at("gVol") === null && at("pcr") === null, "fields the row did not carry are null, not zero");
  deep(strips.missing, ["QQQ"], "a name asked for and not returned is listed as missing");
  eq(strips.status, "prior", "a row dated before the session is a prior-session strip");
  eq(L.shapeStrips({ data: [{ ...row, date: "2026-09-23" }] }, { at: T("2026-09-23T15:00:00Z"), session: "2026-09-23",
    names: ["ZZZ"] }).status, "ok", "and one dated the session itself is the live strip");

  const probe = L.shapeStrips({ data: [FX.screenerLive.row] }, { at: T("2026-09-23T15:00:00Z"), session: "2026-09-22", names: [] });
  eq(probe.status, "unreadable", "the probe's screener row, clipped before `ticker`, cannot be placed and says so");

  const s1 = L.appendStripSeries(null, { status: "ok", fields: strips.fields, rows: { ZZZ: strips.rows.ZZZ } },
    { at: T("2026-09-23T15:07:00Z"), session: "2026-09-23" });
  deep([s1.base.ZZZ, s1.cols.px.ZZZ[0], s1.cols.net.ZZZ[0], s1.cols.gex.ZZZ[0], s1.cols.iv.ZZZ[0]], [110, 0, 2000, 1235, 3123],
    "KNOWN ANSWER: the first read is the base; net in $K, gamma in units of $10K per 1%, IV in basis points");
  const bumped = [...strips.rows.ZZZ];
  bumped[strips.fields.indexOf("px")] = 111.23;
  const s2 = L.appendStripSeries(s1, { status: "ok", fields: strips.fields, rows: { ZZZ: bumped, NEW: bumped } },
    { at: T("2026-09-23T15:22:00Z"), session: "2026-09-23" });
  deep(s2.cols.px.ZZZ, [0, 123], "price is integer cents relative to the session's first read: 111.23 − 110 = 123");
  deep(s2.cols.px.NEW, [null, 0], "a name that enters late is back-filled with nulls, never zeros");
  const s3 = L.appendStripSeries(s2, { status: "ok", fields: strips.fields, rows: { ZZZ: bumped } },
    { at: T("2026-09-23T15:25:00Z"), session: "2026-09-23" });
  ok(s3.t.length === 2 && s3.replaced, "a re-run inside the same 15-minute slot replaces the column instead of adding one");
  const s4 = L.appendStripSeries(s3, { status: "ok", fields: strips.fields, rows: { ZZZ: bumped } },
    { at: T("2026-09-24T14:00:00Z"), session: "2026-09-24" });
  ok(s4.t.length === 1 && s4.reset === "session-boundary", "and the series resets when the session changes");
  const noRead = L.appendStripSeries(s3, { status: "unavailable", reason: "vendor-failed" },
    { at: T("2026-09-23T15:37:00Z"), session: "2026-09-23" });
  ok(!noRead.appended && noRead.t.length === 2, "a failed strip read appends nothing, so no column claims a read that did not happen");

  const vol = L.shapeVol({ SPY: { volatility_7: "0.36", volatility_30: "0.30", volatility_90: "0.33", iv_rank: "41.5" } },
    { at: T("2026-09-23T15:00:00Z"), session: "2026-09-23" });
  deep([vol.index.SPY.slope, vol.index.SPY.front], [0.1, 0.2],
    "KNOWN ANSWERS: term slope = σ90/σ30 − 1 = 0.33/0.30 − 1; front inversion = σ7/σ30 − 1 = 0.36/0.30 − 1");
  eq(vol.index.QQQ.status, "unavailable", "an index the strip did not return is unavailable, not flat");
  const priorVol = L.shapeVol({ SPY: { date: "2026-09-22", volatility_30: "0.30" } },
    { at: T("2026-09-23T15:00:00Z"), session: "2026-09-23" });
  ok(priorVol.index.SPY.status === "prior" && priorVol.index.SPY.date === "2026-09-22",
    "an index row the vendor dated before the session is the prior session's curve, dated, not today's");
  ok(["slope", "front", "steep", "rv", "vrp"].every((k) => typeof vol.units[k] === "string") &&
     /EX-POST/.test(vol.units.vrp) && /volatility_180 \/ volatility_30/.test(vol.units.steep),
  "every derived field names its unit, and the vendor's variance_risk_premium is labelled ex-post (probe §C): a " +
    "reader must not take it for today's premium");
  eq(vol.vix.reason, "plan:volatility_scope_required", "the VIX curve is plan-gated (probe: 403) and says which scope");

  const mv = L.shapeMovers({ status: "ok", fields: strips.fields,
    rows: { AAA: strips.rows.ZZZ, SPY: strips.rows.ZZZ } }, { at: T("2026-09-23T15:00:00Z"), session: "2026-09-23" });
  deep(mv.up.map((r) => r.t), ["AAA"], "movers rank the board's names and leave the index rows out");
}

{
  const rot0 = L.gexRotation({ ranked: ["SPY", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"],
    deep: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"], tick: 0 });
  deep(rot0.fixed, ["A", "B", "C", "D", "E", "F"], "the six largest |score| names are read every tick");
  deep(rot0.index, ["SPY", "QQQ"], "with SPY and QQQ");
  eq(rot0.all.length, 14, "fourteen spot-exposure calls a tick");
  const seen = new Set();
  for (let t = 0; t < 4; t++) for (const n of L.gexRotation({ ranked: rot0.fixed, deep: [...rot0.fixed, ..."GHIJKLMN"], tick: t }).rotating) seen.add(n);
  deep([...seen].sort(), [..."GHIJKLMN"], "and the rotation reaches every other deep name within the hour");

  const at = T("2026-09-23T15:00:00Z");
  const series = { status: "ok", t: ["2026-09-23T14:55:00Z"], px: [100], gOi: [5], gVol: [1], gDir: [0], flowFilled: true,
    last: { at: "2026-09-23T14:55:00Z", px: 100, gOi: 5, gVol: 1, gDir: 0 } };
  const g1 = L.mergeGex(null, { A: series, B: series }, { at, session: "2026-09-23", rotation: { fixed: ["A"], rotating: ["B"] } });
  const g2 = L.mergeGex(g1, { A: series }, { at: at + 15 * 60000, session: "2026-09-23", rotation: { fixed: ["A"], rotating: [] } });
  ok(g2.names.B && g2.names.B.readAt === g1.names.B.readAt && g2.names.B.reason === "rotated-out" && !g2.names.B.t,
    "a rotated-out name keeps its last reading under ITS OWN read time — carried, never re-stamped as new");
  const failedB = L.shapeGexSeries({ __failed: "HTTP 502" }, { session: "2026-09-23" });
  const g2f = L.mergeGex(g1, { A: series, B: failedB }, { at: at + 15 * 60000, session: "2026-09-23",
    rotation: { fixed: ["A"], rotating: ["B"] } });
  ok(g2f.names.B.readAt === g1.names.B.readAt && g2f.names.B.last && g2f.names.B.reason === "vendor-failed" &&
     g2f.names.B.triedAt === new Date(at + 15 * 60000).toISOString(),
  "a name that WAS read this run and failed keeps its last reading under its own read time, but says the re-read " +
    "failed and when — it was not rotated out");
  const g3 = L.mergeGex(g2, {}, { at: at + 3 * 3600000, session: "2026-09-23", rotation: null });
  ok(!g3.names.B, "and it is dropped once it is two hours old");
  const g4 = L.mergeGex(g2, {}, { at: T("2026-09-24T14:00:00Z"), session: "2026-09-24", rotation: null });
  ok(g4.reset === "session-boundary" && !Object.keys(g4.names).length, "a new session starts empty");
  eq(L.shapeGexSeries({ __failed: "HTTP 500" }, { session: "2026-09-23" }).status, "unavailable",
    "a failed spot-exposures read is unavailable");
}

{
  const S = "2026-09-22";
  const page = (rows, full = false) => ({ body: { data: rows, newer_than: S, older_than: "x" }, full });
  const empty = L.mergeLiveAlerts(null, [page([])], { at: T("2026-09-22T15:00:00Z"), session: S });
  ok(empty.write === null && empty.why === "vendor-empty", "THE EMPTY-READ GUARD: an empty read writes nothing");
  const a1 = FAKE.fakeFlowAlerts({ session: S, now: T("2026-09-22T15:00:00Z"), count: 30, seed: "one" });
  const m1 = L.mergeLiveAlerts(null, [page(a1.data)], { at: T("2026-09-22T15:00:00Z"), session: S,
    stageOf: (t) => (t === "NVDA" ? "board:long" : null) });
  eq(m1.write.record.reset, "cold", "the first read of a store starts a record (cold)");
  eq(m1.cursor, L.alertsCursor(a1.data), "and the cursor is the newest created_at read");
  ok(m1.write.rows.every((r) => r.st === "board:long" || r.st === null),
    "the live run's stage map is partial: a board name is placed, every other name is null, never foreign");
  deep(L.alertsPagePlan(m1.write, S), { newerThan: m1.cursor, resumed: true }, "the next run resumes from the cursor");
  deep(L.alertsPagePlan(m1.write, "2026-09-23"), { newerThan: "2026-09-23", resumed: false },
    "and a new session starts from its own date");
  const a2 = FAKE.fakeFlowAlerts({ session: S, now: T("2026-09-22T15:15:00Z"), count: 10, seed: "two", newerThan: m1.cursor });
  const m2 = L.mergeLiveAlerts(m1.write, [page(a2.data)], { at: T("2026-09-22T15:15:00Z"), session: S });
  ok(m2.mode === "merged" && m2.write.record.reads === 2 && m2.write.record.union >= 30,
    "the second read of the session merges into the union rather than replacing it");
  const cappedPages = Array.from({ length: L.LIVE_BUDGET.alertPages }, () => page(a2.data, true));
  const m3 = L.mergeLiveAlerts(m2.write, cappedPages, { at: T("2026-09-22T15:30:00Z"), session: S });
  eq(m3.write.readTruncated, true, "five full pages make the union a floor");
  const cut = L.mergeLiveAlerts(m2.write, [page(a2.data, true), { body: { __failed: "HTTP 502" }, full: false }],
    { at: T("2026-09-22T15:30:00Z"), session: S });
  ok(cut.write.readTruncated === true && cut.write.readCut === "vendor-failed",
    "A PAGED READ CUT SHORT BY A FAILED PAGE is a floor too: the cursor moves past alerts the failed page would have " +
    "returned, so the union can no longer claim to be the session's complete record");
  const m4 = L.mergeLiveAlerts(m3.write, [page(a2.data)], { at: T("2026-09-22T15:45:00Z"), session: S });
  eq(m4.write.readTruncated, true, "and it stays a floor for the rest of the session");
  const m5 = L.mergeLiveAlerts(m4.write, [page(a1.data)], { at: T("2026-09-23T14:00:00Z"), session: "2026-09-23" });
  ok(m5.write.record.reset === "session-boundary" && m5.write.readTruncated === false,
    "a new session resets both the record and the floor");
  ok(JSON.stringify(m4.write).length <= L.LIVE_KEYS["live:alerts"].maxBytes, "the union fits its key");
  const flowalertsKeys = ["v", "generatedAt", "sessionDate", "readAt", "readDay", "refreshed", "rows", "seen",
    "unusable", "shed", "cap", "coverage", "status", "notes", "record", "vendorLimit", "vendorTruncated", "readLimit",
    "readTruncated"];
  ok(flowalertsKeys.every((k) => Object.hasOwn(m4.write, k)),
    "live:alerts carries every field of the nightly flowalerts shape, so pages can read it in place of the nightly row");

  const held = await readHeldAlerts(async (k) => (k === "live:alerts" ? { payload: m4.write } : { payload: { nightly: 1 } }), S);
  eq(held.heldFrom, "live:alerts", "the nightly merges its own read into this session's live union");
  const other = await readHeldAlerts(async (k) => (k === "live:alerts" ? { payload: m4.write } : { payload: { nightly: 1 } }), "2026-09-23");
  deep(other.payload, { nightly: 1 }, "and falls back to the stored nightly feed when the union is another session's");
}

{
  const pulse = { v: 2, sessionDate: "2026-09-22", readAt: "2026-09-22T21:40:00Z", refreshed: "nightly",
    cadenceMinutes: 15, tide: { status: "ok", points: [] }, totals: { status: "ok", rows: [1] } };
  const market = L.shapeMarketLive({ tide: FAKE.fakeMarketTide({ session: "2026-09-23", now: T("2026-09-23T15:00:00Z") }) },
    { at: T("2026-09-23T15:01:00Z"), session: "2026-09-23" });
  const over = L.pulseWithLive(pulse, market);
  ok(over && over.refreshed === "intraday" && over.readDay === "2026-09-23" && over.cadenceMinutes === 5,
    "READ-TIME OVERLAY: the nightly pulse is served with today's live tide, stamped intraday at the 5-minute cadence");
  deep(over.totals, pulse.totals, "and every nightly feed beside the tide is left as the nightly wrote it");
  eq(over.tide.points.length, market.tide.n, "the tide points are the live series");
  const { shapeTide } = await import("../shared/flows-pulse.js");
  const nightlyPoint = shapeTide({ data: [FX.marketTide.row] }).points[0];
  eq(nightlyPoint.t, "2026-09-22T09:30:00-04:00", "the nightly pulse keeps the vendor's own Eastern-offset stamp");
  eq(over.tide.points[0].t, "2026-09-23T09:30:00-04:00",
    "and the overlaid live point uses that same convention, not the UTC the live series is stored in — the market " +
    "page labels a tide point with t.slice(11, 16), which would otherwise read 13:30 for the 09:30 bucket");
  eq(Date.parse(over.tide.points[0].t), Date.parse(market.tide.t[0]), "the instant itself is unchanged");
  eq(L.easternStamp(T("2026-01-14T14:30:00Z")), "2026-01-14T09:30:00-05:00", "and under EST the offset is −05:00");
  eq(L.pulseWithLive({ ...pulse, readAt: "2026-09-23T16:00:00Z" }, market), null,
    "a nightly pulse newer than the live row is not overlaid");
  eq(L.pulseWithLive({ ...pulse, sessionDate: "2026-09-24" }, market), null, "nor is a later session's");
  const lone = { ...market, tide: { ...market.tide, t: market.tide.t.slice(0, 1), ncp: market.tide.ncp.slice(0, 1),
    npp: market.tide.npp.slice(0, 1), nv: market.tide.nv ? market.tide.nv.slice(0, 1) : undefined, n: 1 } };
  const river = { ...pulse, tide: { status: "ok", points: [{ t: "a" }, { t: "b" }, { t: "c" }] } };
  eq(L.pulseWithLive(river, lone), null,
    "A LONE LIVE POINT DOES NOT REPLACE A NIGHTLY RIVER: one reading at the open, or a stalled Tier 1, keeps the " +
    "last session's full tide in the pulse, and pages read the lone point from live:market and date it themselves");
  ok(L.pulseWithLive(pulse, lone)?.tide.points.length === 1,
    "but it still stands in when the nightly pulse has no tide of its own to show");
  ok(L.pulseWithLive(river, market)?.tide.points.length === market.tide.n,
    "and two or more live points replace the nightly river as before");
  ok(L.liveAlertsWin("2026-09-22", "2026-09-23") && !L.liveAlertsWin("2026-09-23", "2026-09-23") &&
    !L.liveAlertsWin("2026-09-23", "2026-09-22"),
    "live:alerts replaces the nightly feed only when it covers a later session than the nightly does");
}

{
  const fresh = (over = {}) => ({ fresh: { v: 1, readAt: "2026-09-23T15:00:00.000Z", session: "2026-09-23", cadenceS: 900,
    source: "actions", writer: "flows-live", ...over } });
  ok(L.checkLiveWrite("live:breadth", fresh(), { source: "actions" }).ok, "a well-formed Tier 2 payload is accepted");
  eq(L.checkLiveWrite("live:market", fresh({ cadenceS: 300, source: "worker" }), { source: "actions" }).code, "wrong_writer",
    "ONE WRITER PER KEY: the Actions token cannot write the Worker's live:market");
  eq(L.checkLiveWrite("live:focus", fresh({ cadenceS: 300, source: "worker" }), { source: "actions" }).code, "wrong_writer",
    "nor its live:focus, even with the envelope the Worker itself writes");
  eq(L.checkLiveWrite("live:breadth", {}, { source: "actions" }).code, "invalid_fresh", "a payload without fresh is refused");
  eq(L.checkLiveWrite("live:breadth", fresh({ cadenceS: 300 }), { source: "actions" }).code, "invalid_fresh",
    "and one promising another key's cadence");
  eq(L.checkLiveWrite("live:nope", fresh(), { source: "actions" }).code, "invalid_key", "an unregistered key is refused");
  eq(L.liveKeyFromParam("market"), "live:market", "?k=market names live:market");
  eq(L.liveKeyFromParam("strips:series"), "live:strips:series", "and strips:series its series");
  eq(L.liveKeyFromParam("board:long"), null, "a nightly key is not reachable through the live route");

  const kinds = [];
  for (const kind of ["live", "nightly"]) {
    for (const key of ["live:breadth", "board:long", "board:long:2026-09-22", "scores:2026-09-22", "card:X", "flowalerts", "meta"]) {
      for (const method of ["GET", "POST", "DELETE"]) kinds.push([kind, key, method, W.ingestScope(key, method, kind).ok]);
    }
  }
  const allowed = kinds.filter((k) => k[3]).map((k) => k.slice(0, 3).join(" "));
  deep(allowed.filter((a) => a.startsWith("live ")), ["live live:breadth GET", "live live:breadth POST", "live board:long GET",
    "live meta GET"],
    "THE LIVE TOKEN reads and writes live:* keys, reads only the board and meta it plans from, and deletes nothing");
  ok(!allowed.includes("nightly live:breadth POST") && allowed.includes("nightly live:breadth GET"),
    "THE NIGHTLY TOKEN can read the live union it merges but cannot write a live key");
}

{
  const session = "2026-09-22";
  const end = easternInstant(session, 16 * 60 + 5);
  const market = L.shapeMarketLive({
    tide: FAKE.fakeMarketTide({ session, now: end }), sectors: FAKE.fakeSectorEtfs({ session }),
  }, { at: end, session });
  const mBytes = JSON.stringify(market).length;
  ok(mBytes <= L.LIVE_KEYS["live:market"].maxBytes && market.tide.n >= 78 && market.sectors.rows.length === 12,
    `a FULL-SESSION live:market (${market.tide.n} tide points, ${market.sectors.rows.length} sector-ETF rows) is ` +
    `${mBytes} bytes, inside its ${L.LIVE_KEYS["live:market"].maxBytes}`);
  ok(mBytes > 0.4 * L.LIVE_KEYS["live:market"].maxBytes, "and genuinely near the cap, so the cap certifies something");
  deep(Object.keys(market).filter((k) => !["v", "key", "session", "fresh", "units"].includes(k)).sort(),
    ["last", "sectors", "tide"], "LIVE:MARKET CARRIES ONLY THE TIDE AND THE SECTOR ETFS (and their headline): the " +
    "0DTE series and the SPY/QQQ ETF tides live in live:breadth now");
  deep(Object.keys(market.last), ["tideNet"], "its `last` block is the tide's alone");
  const sectors = {};
  for (const { sector } of L.SECTOR_TIDES) sectors[sector] = FAKE.fakeSectorTide(sector, { session, now: end });
  const etfRaws = Object.fromEntries(L.BREADTH_ETFS.map((t) => [t, FAKE.fakeEtfTide(t, { session, now: end })]));
  const breadth = L.shapeBreadth({ sectors, etf: etfRaws, zeroDte: FAKE.fakeNetFlow({ session, now: end }),
    weekly: FAKE.fakeNetFlow({ session, now: end, expiration: "weekly" }) }, { at: end, session });
  const bBytes = JSON.stringify(breadth).length;
  ok(bBytes <= L.LIVE_KEYS["live:breadth"].maxBytes && breadth.sectors.t.length >= 78,
    `a full-session live:breadth with eleven aligned sector tides and four ETF tides is ${bBytes} bytes`);
  ok(Math.abs(breadth.etf.SPY.net.at(-1)) > 1e8,
    "and the ETF tides it was sized on carry SPY's real magnitude (a session net in the hundreds of millions)");
  ok(bBytes <= 0.75 * L.LIVE_KEYS["live:breadth"].maxBytes,
    "with a quarter of the cap to spare: an over-cap breadth is refused and freezes for the session");
  for (const t of L.BREADTH_ETFS) {
    const e = breadth.etf[t];
    ok(e.status === "ok" && e.n === 78 && ["t", "ncp", "npp", "nv", "px", "net"].every((f) => e[f].length === 78),
      `live:breadth.etf.${t} is a full-session five-minute tide with price, in the one shape every ETF shares`);
  }
  deep(Object.keys(breadth.sectors.rows).sort(), L.SECTOR_TIDES.map((s) => s.sector).sort(),
    "every one of the vendor's eleven sectors is present, each on the shared time axis");

  const focus = focusStripNames(null);
  deep([focus.source, focus.names.length, focus.names.slice(0, 4)], ["constants", 22, ["GLD", "GDX", "NEM", "AEM"]],
    "WITHOUT A FOCUS PAYLOAD the strip falls back to the shared/flows-focus.js roster: the three metal groups, the Mag 7, " +
    "the metal funds and the miners, 22 names once each");
  const stored = { groups: [{ id: "gold", lead: "GLD", tickers: ["GLD", "GDX"] }, { id: "ndx10", tickers: ["avgo", "COST", "GLD"] },
    { id: "bad", tickers: ["not a ticker", 7] }] };
  deep(focusStripNames(stored), { names: ["GLD", "GDX", "AVGO", "COST"], source: "focus" },
    "WITH ONE, every ticker its groups list, lead first, in order, once, upper-cased — whatever the nightly derived " +
    "for the NDX 10, the strip follows it with no code change");
  eq(focusStripNames({ groups: [{ tickers: Array.from({ length: 60 }, (_, i) => "Q" + i) }] }).names.length,
    L.LIVE_BUDGET.stripFocusMax, "and a runaway focus list is held to its own share, so it can never crowd the boards out");
  deep(focus.names, FOCUS_FALLBACK.slice(0, L.LIVE_BUDGET.stripFocusMax), "the fallback is the constants' roster itself");
  {
    const src = (p) => read(p);
    const importsOf = (text) => [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"|^\s*import\s*"([^"]+)"/gm)]
      .map((m) => m[1] || m[2]);
    deep(importsOf(src("shared/flows-focus.js")), [],
      "shared/flows-focus.js IS A LEAF: it imports nothing, so every module may import its constants without a cycle");
    ok(!importsOf(src("shared/flows-live.js")).some((i) => /flows-focus/.test(i)),
      "and shared/flows-live.js, the builders both writers share, never imports it: the roster enters through the " +
        "two planners, the Actions leg (scripts/flows-legs/live.mjs) and the Worker's focus tick");
    ok(importsOf(src("shared/flows-live-worker.js")).includes("./flows-focus.js") &&
       importsOf(src("scripts/flows-legs/live.mjs")).includes("../../shared/flows-focus.js"),
      "and both planners import the one focusStripNames, so the Worker's live:focus and the Actions strip ask for the " +
        "same names in the same order");
    const rootPath = new URL(".", ROOT).pathname;
    const edges = (file) => importsOf(readFileSync(file, "utf8")).filter((i) => i.startsWith("."))
      .map((i) => new URL(i, "file://" + file).pathname);
    const state = new Map();
    const cycles = [];
    const visit = (f, stack) => {
      if (state.get(f) === 2) return;
      if (state.get(f) === 1) { cycles.push([...stack.slice(stack.indexOf(f)), f].map((x) => x.slice(rootPath.length))); return; }
      state.set(f, 1); stack.push(f);
      for (const g of edges(f)) visit(g, stack);
      stack.pop(); state.set(f, 2);
    };
    for (const entry of ["worker.js", "scripts/flows-pipeline.mjs"]) visit(rootPath + entry, []);
    deep(cycles, [], `NO IMPORT CYCLE from worker.js or the pipeline (${state.size} modules walked): a cycle leaves a ` +
      "const in its temporal dead zone and the Worker throws at module evaluation, taking every route down");
  }
  const fb = FAKE.fakeBoards({ n: 80 });
  const names = L.stripNames({ long: fb.long.rows.map((r) => r.t), short: fb.short.rows.map((r) => r.t),
    watch: fb.watch.rows.map((r) => r.t), focus: focus.names });
  eq(names.length, L.LIVE_BUDGET.stripMax, "the strip takes at most 160 names in one call");
  deep(names.slice(0, 3), ["SPY", "QQQ", "IWM"], "the index rows come first so the vol regime never falls off the end");
  deep(names.slice(3, 3 + focus.names.length), focus.names,
    "THE FOCUS NAMES come next, before any board name, so Gold, Silver, Copper and the Mag 7 are read every pass " +
    "whatever the boards hold — in the same one screener call, zero extra vendor calls");
  eq(L.stripNames({ long: ["GLD", "AAA"], focus: ["GLD"] }).filter((t) => t === "GLD").length, 1,
    "and a focus name that is also on a board is read once");
  const strips = L.shapeStrips(FAKE.fakeScreenerRows(names, { session }), { at: end, session, names });
  const f = strips.fields;
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const logUniform = (lo, hi) => lo * (hi / lo) ** rnd();
  const scale = Object.fromEntries(names.map((t) => [t, { net: logUniform(1e5, 3e8), gex: logUniform(3e6, 7e9) }]));
  const column = (i) => {
    const rows = {};
    for (const [t, r0] of Object.entries(strips.rows)) {
      const r = r0.slice();
      r[f.indexOf("px")] = Math.round(r0[f.indexOf("px")] * (1 + (rnd() - 0.5) * 0.06) * 1e4) / 1e4;
      r[f.indexOf("net")] = Math.round(scale[t].net * ((i + 1) / 28) * (rnd() * 2 - 1));
      r[f.indexOf("gOi")] = Math.round(scale[t].gex * (rnd() * 1.4 - 0.4));
      r[f.indexOf("iv30")] = Math.round(r0[f.indexOf("iv30")] * (0.95 + rnd() * 0.1) * 1e4) / 1e4;
      rows[t] = r;
    }
    return { ...strips, rows };
  };
  let series = null;
  for (let i = 0; i < 28; i++) {
    series = L.appendStripSeries(series, column(i), { at: easternInstant(session, 9 * 60 + 37 + i * 15), session });
  }
  const sBytes = JSON.stringify(series).length;
  const stBytes = JSON.stringify(column(27)).length;
  ok(series.t.length === 28 && series.trimmed === 0 && sBytes <= 0.95 * L.LIVE_KEYS["live:strips:series"].maxBytes,
    `A FULL SESSION of 15-minute columns for 160 names at production magnitudes (session nets to 3e8 and gamma to 7e9 ` +
    `per name, log-uniform, prices moving 3%) is ${sBytes} bytes over ${series.t.length} points, nothing shed, with ` +
    `5% of the ${L.LIVE_KEYS["live:strips:series"].maxBytes}-byte cap to spare`);
  ok(stBytes <= 0.6 * L.LIVE_KEYS["live:strips"].maxBytes,
    `and the 160-name snapshot is ${stBytes} bytes, well inside its ${L.LIVE_KEYS["live:strips"].maxBytes}-byte cap`);
  const squeezed = L.appendStripSeries(series, strips, { at: easternInstant(session, 16 * 60 + 16), session,
    maxBytes: 40 * 1024 });
  ok(JSON.stringify(squeezed).length <= 40 * 1024 && squeezed.trimmed > 0 && squeezed.t.at(-1) === L.isoSec(easternInstant(session, 16 * 60 + 16)) &&
     Object.values(squeezed.cols).every((col) => Object.values(col).every((a) => a.length === squeezed.t.length)),
  `OVER ITS CAP the series sheds its oldest columns (${squeezed.trimmed}) and still lands, every name aligned to the ` +
    "shorter axis — rather than being refused by the publisher and frozen for the rest of the session");

  const reads = {};
  for (const t of ["SPY", "QQQ", ..."ABCDEFGHIJKL"]) reads[t] = L.shapeGexSeries(FAKE.fakeSpotExposures(t, { session, now: end }), { session, now: end });
  const gex = L.mergeGex(null, reads, { at: end, session, rotation: { fixed: [..."ABCDEF"], rotating: [..."GHIJKL"] } });
  const gBytes = JSON.stringify(gex).length;
  ok(gBytes <= L.LIVE_KEYS["live:gex"].maxBytes, `fourteen full-session spot-gamma series fit live:gex (${gBytes} bytes, shed ${gex.shed.length})`);
  const tight = L.mergeGex(null, reads, { at: end, session, rotation: { fixed: [..."ABCDEF"], rotating: [..."GHIJKL"] },
    maxBytes: 40 * 1024 });
  ok(tight.shed.length >= 2 && tight.shed.slice(0, 2).join("") === "LK" &&
     tight.shed.every((t, i) => i < 6 ? "GHIJKL".includes(t) : "ABCDEF".includes(t)),
  `OVER THE CAP, the rotating names' series go first, last-rotated first (${tight.shed.join(", ")}): the six largest ` +
    "|score| names are the ones read every tick, so they are the last to lose their path");
  ok(tight.names.A.t && tight.names.SPY.t && tight.names.QQQ.t && JSON.stringify(tight).length <= 40 * 1024,
    "while the top name and the two index paths survive, and the key fits");

  const tape = L.shapeTickerTape({ ticks: FAKE.fakeNetPremTicks("AAPL", { session, now: end }),
    spot: FAKE.fakeSpotExposures("AAPL", { session, now: end }),
    alerts: FAKE.fakeFlowAlerts({ session, now: end, tickers: ["AAPL"], count: 50 }) },
  { at: end, session, ticker: "AAPL", now: end });
  const tBytes = JSON.stringify(tape).length;
  ok(tBytes <= L.TAPE_SPEC.maxBytes, `a full-session per-ticker tape is ${tBytes} bytes, inside ${L.TAPE_SPEC.maxBytes}`);
  eq(tape.prem.recent.n, 30, "with the last 30 minutes at 1-minute resolution");
  eq(tape.fresh.readAt, new Date(end).toISOString(), "and fresh.readAt the older of its two legs");
  const half = L.assembleTape(tape, L.shapeTapeGex({ spot: FAKE.fakeSpotExposures("AAPL", { session, now: end }) },
    { at: end + 60000, session, now: end + 60000 }), { ticker: "AAPL", session });
  eq(half.fresh.readAt, new Date(end).toISOString(),
    "refreshing one leg leaves fresh.readAt at the OLDER leg — the payload never claims a freshness it only half has");
  eq(L.nextTapeLeg(half), "prem", "and the next refresh takes the older leg");
}

{
  const yday = "2026-09-22";
  const today = "2026-09-23";
  const spotFor = (day, now) => FAKE.fakeSpotExposures("AAPL", { session: day, now });
  const mixed = { data: [...spotFor(yday, easternInstant(yday, 16 * 60)).data,
    ...spotFor(today, easternInstant(today, 8 * 60)).data] };
  const g = L.shapeGexSeries(mixed, { session: yday, now: easternInstant(today, 8 * 60) });
  ok(g.status === "ok" && Date.parse(g.lastAt) <= easternInstant(yday, 16 * 60 + 5) &&
     Date.parse(g.firstAt) >= easternInstant(yday, 9 * 60 + 30),
  "A GAMMA PATH IS ITS SESSION'S REGULAR HOURS: rows from the next morning's pre-market are never sliced into " +
    `yesterday's series (${g.firstAt} to ${g.lastAt})`);
  const later = L.shapeGexSeries(spotFor(today, easternInstant(today, 8 * 60)), { session: yday,
    now: easternInstant(today, 8 * 60) });
  ok(later.status === "unreadable" && later.reason === "vendor-later-session",
    "and rows that belong only to a LATER session than the one asked for are named as such, never called prior");

  const rows = FAKE.fakeFlowAlerts({ session: today, now: easternInstant(today, 11 * 60), tickers: ["AAPL"], count: 6 });
  const other = FAKE.fakeFlowAlerts({ session: yday, now: easternInstant(yday, 15 * 60), tickers: ["AAPL"], count: 4 });
  const tp = L.shapeTapePrem({ ticks: FAKE.fakeNetPremTicks("AAPL", { session: today, now: easternInstant(today, 11 * 60) }),
    alerts: { data: [...rows.data, ...other.data] } }, { at: easternInstant(today, 11 * 60), session: today });
  ok(tp.alerts.outside === 4 && tp.alerts.seen <= 6, "the tape's alerts are its own session's: four from the day " +
    "before are counted as outside and not shown beside today's premium path");

  const held = (session, legs) => JSON.stringify({ session, prem: { readAt: "2026-09-22T19:00:00.000Z" },
    gex: { readAt: "2026-09-22T18:00:00.000Z" }, legs });
  deep(W.tapeLegFor(held(yday), 3, { session: today, rth: true }).leg, "prem",
    "IN SESSION, a tape still holding yesterday re-reads its premium leg first, which dates the new session");
  deep(W.tapeLegFor(held(yday), 3, { session: today, rth: false }).leg, "gex",
    "outside the session the older leg is refreshed as usual");
  const readToday = JSON.stringify({ session: yday, prem: { readAt: new Date(easternInstant(today, 9 * 60 + 40)).toISOString() },
    gex: { readAt: "2026-09-22T18:00:00.000Z" } });
  deep(W.tapeLegFor(readToday, 1, { session: today, rth: true }).leg, "gex",
    "but once the premium leg HAS been read this session and the vendor still dates it yesterday, the gamma leg is " +
    "read next — the tape is never stuck re-reading one leg");

  const calls = [];
  const fetchVendor = async (path, params) => {
    calls.push({ path, params });
    if (/spot-exposures$/.test(path)) {
      return params && params.date ? spotFor(params.date, easternInstant(params.date, 16 * 60)) :
        spotFor(today, easternInstant(today, 8 * 60));
    }
    throw new Error("unexpected " + path);
  };
  const heldTape = L.shapeTickerTape({ ticks: FAKE.fakeNetPremTicks("AAPL", { session: yday, now: easternInstant(yday, 16 * 60) }),
    alerts: { data: [] } }, { at: easternInstant(yday, 16 * 60 + 2), session: yday, ticker: "AAPL" });
  const r = await W.refreshTape({}, "AAPL", easternInstant(today, 8 * 60), { fetchVendor,
    heldText: JSON.stringify(heldTape), heldLegs: 1 });
  const spotCall = calls.find((c) => /spot-exposures$/.test(c.path));
  ok(r && r.leg === "gex" && r.session === yday && spotCall && spotCall.params.date === yday,
    "the gamma leg is read FOR THE TAPE'S OWN SESSION (spot-exposures?date=), so both legs describe one session");
  ok(r.payload.gex.status === "ok" && r.payload.gex.t.every((t) => Date.parse(t) <= easternInstant(yday, 16 * 60 + 5)) &&
     r.legs === 3, "and at 08:00 the next morning yesterday's tape completes with yesterday's regular-hours gamma, " +
    "not this morning's pre-market");
}

{
  const worker = read("worker.js");
  const liveWorker = read("shared/flows-live-worker.js");
  const leg = read("scripts/flows-legs/live.mjs");
  const pipeline = read("scripts/flows-pipeline.mjs");
  const writes = /(INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM)\s+flows_payload/;
  ok(!writes.test(liveWorker),
    "LAYER 1 (code): the Worker's live module never writes flows_payload — only SELECTs the nightly rows it overlays");
  const sched = worker.slice(worker.indexOf("async scheduled(event, env, ctx)"), worker.indexOf("async fetch(request, env, ctx)"));
  ok(!writes.test(sched) && !/refreshFlowsIntraday/.test(worker), "and the scheduled handler writes no nightly row either");
  const puts = [...leg.matchAll(/put\("([^"]+)"/g)].map((m) => m[1]);
  ok(puts.length >= 10 && puts.every((k) => /^live:/.test(k)), `the live leg publishes only live:* keys (${puts.join(", ")})`);
  ok(/if \(LIVE_MODE && !\/\^live:\[a-z\]\+\(\?::\[a-z\]\+\)\?\$\/\.test\(key\)\) \{\s*throw/.test(pipeline),
    "and publish() itself throws on any other key in --live mode, before the network");
  ok(/LIVE_MODE \? await liveCredential\(\) : process\.env\.FLOWS_INGEST_TOKEN/.test(pipeline),
    "LAYER 2 (credential): --live authenticates with a live credential only");
  const credFn = pipeline.slice(pipeline.indexOf("export function liveCredentialSource"), pipeline.indexOf("async function ingestHeaders"));
  ok(credFn.length > 0 && !/FLOWS_INGEST_TOKEN/.test(credFn),
    "and neither the live credential nor its source ever falls back to the nightly token");
  const wf = read(".github/workflows/flows-live.yml");
  ok(!/FLOWS_INGEST_TOKEN|FLOWS_LIVE_TOKEN|GITHUB_DISPATCH_TOKEN/.test(wf) &&
     /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write\s*\n\s*actions: write\s*\n\s*\n/.test(wf),
    "and the live workflow holds no shared secret at all: it proves itself with a GitHub OIDC token minted per run, " +
    "and its only other grant is actions: write, which lets the run's own GITHUB_TOKEN re-dispatch the loop");
  ok(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/.test(wf) && /FLOWS_LIVE_LOOP: "1"/.test(wf),
    "the read step runs the session loop and hands it the run's own token for the chain dispatch — no new secret");
  ok(/LIVE_READY: \$\{\{ secrets\.UW_API_KEY != '' \}\}/.test(wf), "so the vendor key is the only secret it waits for");
  ok(/uses: actions\/checkout@[0-9a-f]{40}\n(?:\s+if: .*\n)?\s+with:\n\s+persist-credentials: false\n/.test(wf),
    "the checkout keeps no credential in .git/config: the job's token can dispatch workflows, and only the chain " +
      "dispatch, which receives it through env, needs it");
  const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  ok(uses.length >= 2 && uses.every((u) => /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(u)),
    `every action in the live job is pinned to a commit SHA (${uses.join(", ")}): id-token: write lets any step mint ` +
    "the live credential, so no step may run code a moved tag could swap");
  const timeout = Number((/timeout-minutes: (\d+)/.exec(wf) || [])[1]);
  const { LIVE_LOOP } = await import("../scripts/flows-legs/live.mjs");
  ok(/concurrency:\s*\n\s*group: flows-live\s*\n\s*cancel-in-progress: false/.test(wf) && timeout < 360 &&
     LIVE_LOOP.budgetMs + 10 * 60000 <= timeout * 60000,
    `one live run at a time (so never more than one loop), ${timeout} minutes at most — under GitHub's six-hour job ` +
    `cap, with the loop's ${LIVE_LOOP.budgetMs / 60000}-minute budget and a pass's overrun inside it`);
  const crons = [...wf.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]);
  const hourly = (from, to, minutes) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .flatMap((h) => minutes.map((m) => `${m} ${h} * * 1-5`));
  deep(crons, hourly(5, 20, [17, 47]),
    "STARTERS, not a schedule, each a cron line of one slot, at :17 and :47 of every hour from 05:17 to 20:47 UTC. " +
      "From 2026-09-23 to 09-25 GitHub created 6 scheduled live runs for 63 slots, the first at 17:50 UTC: 2 from " +
      "Wednesday's one line, 1 from Thursday's one line and 3 from Friday's two, while the nightly's one-slot line " +
      "'30 21' ran all three days, 2 h 19 to 2 h 29 late. Read per line that is one or two runs a day, read per slot " +
      "it is 6 in 63, and three days do not settle which, so the lines are one slot each (a run per line) and half " +
      "an hour apart (a run per slot). A starter at S that GitHub delivers d late waits when S + d falls in the 240 " +
      "minutes before 09:31 ET: 09:31 to 13:31 UTC under EDT, 10:31 to 14:31 UTC under EST. On time, 09:47 to 13:17 " +
      "land in it (EDT) and 10:47 to 14:17 (EST), eight each; 3 h late, 06:47 to 10:17 and 07:47 to 11:17, eight; " +
      "5 h late, 05:17 to 08:17 (EDT, seven, 05:17 being the first) and 05:47 to 09:17 (EST, eight). At least seven " +
      "landings for every delay from 0 to 5 h, checked minute by minute below: at 6 in 63 a slot, 1 - (57/63)^7 = " +
      "0.50 that one of them is delivered, against 0.33 for the four of the hourly lines. From 13:17 the same lines " +
      "restart a loop that died or never started");
  const slots = crons.flatMap(cronMinutes);
  ok(crons.every((c) => / \* \* 1-5$/.test(c)) && slots.length === 32 && slots.every((s) => s % 30 === 17),
    "every starter runs Monday to Friday (GitHub counts weekdays from 0 = Sunday) at 17 minutes past a :00 or :30 " +
      "mark, off the top of the hour, where GitHub's documented load peaks delay and drop schedules");
  ok(crons.every((c) => /^\d+ \d+ \* \* 1-5$/.test(c)) && new Set(crons).size === 32,
    "every starter is a line of its own, so github.event.schedule names exactly one slot and the log can say how " +
      "late GitHub delivered it");
  const waitMs = LIVE_LOOP.preOpenWaitMs;
  const cover = {};
  for (const day of ["2026-09-28", "2027-03-15", "2026-11-02", "2027-03-12"]) {
    const first = easternInstant(day, PHASE_MINUTES.open) + LIVE_LOOP.openLagMs;
    const base = Date.parse(day + "T00:00:00Z");
    let least = [Infinity, null];
    for (let d = 0; d <= 300; d++) {
      const n = slots.filter((s) => {
        const lands = base + (s + d) * 60000;
        return lands <= first && first - lands <= waitMs;
      }).length;
      if (n < least[0]) least = [n, d];
    }
    cover[day] = least;
  }
  deep(Object.fromEntries(Object.entries(cover).map(([day, [n]]) => [day, n])),
    { "2026-09-28": 7, "2027-03-15": 7, "2026-11-02": 8, "2027-03-12": 8 },
    `SEVEN LANDINGS FOR EVERY DELAY: for each delay from 0 to 300 minutes at least seven starters land inside the ` +
      `${waitMs / 60000}-minute wait before 09:31 ET under EDT (2026-09-28, 2027-03-15) and eight under EST ` +
      `(2026-11-02, 2027-03-12); fewest, at which delay: ${JSON.stringify(cover)}. The first to start waits, and ` +
      "the flows-live concurrency group keeps only the newest of the rest pending and cancels the others, so seven " +
      "landings are seven chances at one waiter, not seven waiters");
  const say = wf.slice(wf.indexOf("      - name: Say who dispatched this run"), wf.indexOf("      - name: Read the live layer"));
  ok((wf.match(/\$\{\{ github\.event\.schedule \}\}/g) || []).length === 1 &&
     /FIRED: \$\{\{ github\.event\.schedule \}\}/.test(say) && /cron that fired: '\$\{FIRED:-none\}'/.test(say) &&
     /GH_TOKEN: \$\{\{ github\.token \}\}/.test(say) &&
     /gh api "repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID" --jq \.created_at/.test(say),
  "the run logs the cron that fired, through env rather than into the script, and reads its own created_at from the " +
    "Actions API with the job's token, the only clock that says when GitHub delivered a run that then queued");

  const stepLines = say.split("\n");
  const runAt = stepLines.findIndex((line) => /^\s+run: \|$/.test(line));
  const indent = stepLines[runAt + 1].match(/^ */)[0].length;
  const stepScript = [];
  for (const line of stepLines.slice(runAt + 1)) {
    if (line.trim() && line.match(/^ */)[0].length < indent) break;
    stepScript.push(line.slice(indent));
  }
  const stepDir = mkdtempSync(join(tmpdir(), "flows-live-step-"));
  try {
    mkdirSync(join(stepDir, "bin"));
    writeFileSync(join(stepDir, "step.sh"), stepScript.join("\n"));
    writeFileSync(join(stepDir, "bin", "gh"), [
      "#!/bin/sh",
      'printf \'%s\\n\' "$*" >> "$GH_CALLS"',
      '[ "$1 $2 $3 $4" = "api repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID --jq .created_at" ] || exit 1',
      '[ -n "$GH_TOKEN" ] && [ -n "$FAKE_CREATED" ] || exit 1',
      'printf \'%s\\n\' "$FAKE_CREATED"',
      "",
    ].join("\n"), { mode: 0o755 });
    const calls = join(stepDir, "calls");
    const step = (env) => {
      rmSync(calls, { force: true });
      const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(stepDir, "step.sh")], {
        encoding: "utf8",
        env: { PATH: `${join(stepDir, "bin")}:${process.env.PATH}`, EVENT: "schedule", ORIGIN: "schedule",
          TICK: "none", GH_TOKEN: "ghs_run_token", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org",
          GITHUB_RUN_ID: "36178225980", GH_CALLS: calls, ...env },
      });
      let made = [];
      try { made = readFileSync(calls, "utf8").trim().split("\n"); } catch { made = []; }
      return { status: r.status, out: r.stdout, made };
    };
    const createdS = Math.floor(Date.now() / 1000) - 73 * 60 - 20;
    const slotMin = Math.floor((createdS - 20 * 60) / 60) % 1440;
    const slotName = `${String(Math.floor(slotMin / 60)).padStart(2, "0")}:${String(slotMin % 60).padStart(2, "0")}`;
    const created = new Date(createdS * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const queued = step({ FIRED: `${slotMin % 60} ${Math.floor(slotMin / 60)} * * 1-5`, FAKE_CREATED: created });
    ok(queued.status === 0 && queued.made.length === 1 &&
       queued.made[0] === "api repos/anilkaya001/anilkaya.org/actions/runs/36178225980 --jq .created_at" &&
       queued.out.includes(`GitHub created this run at ${created.slice(11, 19)} UTC, 20 min after its ${slotName} ` +
         "UTC slot; this step ran 73 min after that, the time the run queued for the flows-live concurrency group " +
         "and a runner."),
    "THE DELIVERY LOG MEASURES GITHUB, NOT THE QUEUE: a run GitHub created 20 minutes after its slot that then " +
      "waited 73 minutes behind the running loop (as run 36178225980 waited on 2026-09-25, created 19:12:12, its " +
      "step at 20:25:32) logs 20 minutes of delivery and 73 of queue, where the step's own clock said 93 of delivery " +
      `(the step, run under bash with a stub gh, printed: ${JSON.stringify(queued.out.trim().split("\n").at(-1))})`);
    const blind = step({ FIRED: "17 13 * * 1-5", FAKE_CREATED: "" });
    ok(blind.status === 0 && blind.made.length === 1 && !/GitHub created this run/.test(blind.out) &&
       blind.out.includes("The run's created_at could not be read, so how late GitHub delivered the 13:17 UTC " +
         "starter is left to the Actions API."),
    "and when the Actions API does not answer it says so and the step still succeeds, so a log line never costs a " +
      "session's passes");
    const chained = step({ EVENT: "workflow_dispatch", ORIGIN: "chain", FIRED: "" });
    ok(chained.status === 0 && chained.made.length === 0 && /cron that fired: 'none'/.test(chained.out) &&
       !/created this run|created_at/.test(chained.out),
    "while a dispatched run, which fired no cron, logs its origin and makes no API call");
  } finally {
    rmSync(stepDir, { recursive: true, force: true });
  }

  const migration = read("migrations/0010_flows_live.sql");
  const clockMigration = read("migrations/0011_flows_clock_tier1.sql");
  const verdictMigration = read("migrations/0012_flows_clock_verdict.sql");
  const summaryMigration = read("migrations/0014_flows_clock_summary.sql");
  const schema = read("schema.sql");
  const clockBlock = /CREATE TABLE IF NOT EXISTS flows_clock \([\s\S]*?\n\);\n/;
  ok(schema.includes(migration.replace(clockBlock, "").trim().split("\n\n")[0].trim()) &&
     schema.includes(migration.slice(migration.indexOf("CREATE TABLE IF NOT EXISTS flows_tape"), migration.search(clockBlock)).trim()) &&
     schema.includes(migration.slice(migration.indexOf("CREATE TRIGGER")).trim()),
  "LAYER 3 and 4 (table, storage): schema.sql carries the migration verbatim, flows_clock aside");
  ok(/id\s+TEXT PRIMARY KEY CHECK \(id GLOB 'live:\*'\)/.test(migration), "flows_live refuses any id outside live:*");
  ok(/BEFORE UPDATE ON flows_payload[\s\S]*RAISE\(ABORT, 'flows archive rows are immutable'\)/.test(migration),
    "and a trigger makes the dated archive immutable at the storage layer");
  ok(!/ALTER TABLE/.test(migration), "every statement is IF NOT EXISTS, so applying it twice is safe");
  const alters = (sql) => [...sql.matchAll(/ALTER TABLE flows_clock ADD COLUMN (\w+) (\w+);/g)].map((m) => [m[1], m[2]]);
  const added = [...alters(clockMigration), ...alters(verdictMigration), ...alters(summaryMigration)];
  deep(added, W.CLOCK_ADDED_COLUMNS.map((c) => [...c]),
    "TIER 1 TELEMETRY, THE VERDICT AND THE SUMMARY FIRING: 0011 adds tier1_at, tier1_ok_at and tier1_why, 0012 adds " +
    "closed_probe_at, closed_days and dispatch_why, 0014 adds summary_at, and the Worker's first-use path adds exactly " +
    "those columns to a production table that predates them");
  eq(clockMigration.trim().split("\n").length, alters(clockMigration).length, "and 0011 does nothing else");
  eq(verdictMigration.trim().split("\n").length, alters(verdictMigration).length, "nor does 0012");
  eq(summaryMigration.trim().split("\n").length, alters(summaryMigration).length, "nor does 0014");
  const cols = (sql, table) => {
    const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\)(?:;|")`).exec(sql);
    return body ? body[1].split(",").map((c) => c.trim().split(/\s+/)[0]).filter((c) => /^[a-z_0-9]+$/.test(c)) : [];
  };
  const workerDdl = W.LIVE_SCHEMA_SQL.join(";\n") + ";";
  for (const table of ["flows_live", "flows_tape"]) {
    deep(cols(workerDdl, table), cols(migration, table),
      `the Worker's first-use fallback creates ${table} with exactly the migration's columns`);
  }
  const clockCols = [...cols(migration, "flows_clock"), ...added.map(([c]) => c)];
  deep(cols(workerDdl, "flows_clock"), clockCols,
    "and flows_clock with 0010's columns plus 0011's, 0012's and 0014's, in the order an upgraded production table has them");
  deep(cols(schema, "flows_clock"), clockCols, "as schema.sql declares it");
  const toml = read("wrangler.toml");
  eq(W.cronJob(W.RTH_CRON, T("2026-09-23T15:16:00Z")), "rth", "the market-hours cron runs the Tier 1 tick");
  eq(W.cronJob(W.FOCUS_CRON, T("2026-09-23T15:18:00Z")), "focus", "the focus cron runs the focus tick");
  eq(W.cronJob(W.FOCUS_CRON, T("2026-09-26T15:18:00Z")), "focus",
    "by its string on any day: the tick itself decides whether the session is open");
  eq(W.cronJob(W.HOUSEKEEPING_CRON, T("2026-09-23T15:30:00Z")), "housekeeping", "the half-hour cron runs housekeeping");
  eq(W.cronJob(W.SUMMARY_CRON, T("2026-09-23T15:45:00Z")), "summary", "the quarter-past cron runs the board summary");
  eq(W.SUMMARY_CRON, "15,45 * * * *",
    "THE SUMMARY IS ITS OWN FIRING: refreshing it parses the 118 KB brief, about 8 ms of a cold isolate's 10 ms, so " +
    "it no longer shares the housekeeping firing with the market snapshot and the nightly dispatch, whose D1 writes " +
    "were behind it in the same invocation and died with it when the cap struck");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T15:15:00Z")), "summary",
    "a trigger the deploy left behind runs the summary at the quarter hour, the summary cron's own minutes");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T15:30:00Z")), "housekeeping", "and keeps the half hour for housekeeping");
  eq(W.cronJob("*/15 * * * *", T("2026-09-26T15:15:00Z")), "summary", "on a Saturday too, as the summary cron fires every day");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T03:15:00Z")), "summary", "and outside the 13-21 UTC window");
  eq(W.cronJob("*/15 * * * *", T("2026-09-26T15:30:00Z")), "housekeeping", "the half hour is housekeeping's on any day");
  deep(["15:13", "15:18", "15:16", "15:21", "15:30", "16:00", "15:45", "16:15"].map((hm) => W.cronJob("* * * * *", T(`2026-09-23T${hm}:00Z`))),
    ["focus", "focus", "rth", "rth", "housekeeping", "housekeeping", "summary", "summary"],
    "WITH FOUR CRONS an unknown trigger is routed by its minute: minutes ending in 3 or 8 are the focus tick's, the " +
    "half hour is housekeeping's, the quarter hour is the summary's and every other minute inside the window is " +
    "Tier 1's, so a stale or renamed trigger never runs Tier 1 at the focus tick's minutes or the focus read at Tier 1's");
  deep(["13:03", "21:58", "22:03", "12:58", "22:15", "12:45", "22:30"].map((hm) => W.cronJob("* * * * *", T(`2026-09-25T${hm}:00Z`))),
    ["focus", "focus", "housekeeping", "housekeeping", "summary", "summary", "housekeeping"],
    "inside the 13-21 UTC weekday window only; outside it the quarter hour is still the summary's and every other " +
    "minute is housekeeping's");
  eq(Array.from({ length: 60 }, (_, m) => m).filter((m) => W.cronJob("x", T("2026-09-23T15:00:00Z") + m * 60000) === "focus").join(),
    W.FOCUS_CRON.split(" ")[0].replace(/^(\d+)-(\d+)\/(\d+)$/, (_, a, b, n) =>
      Array.from({ length: Math.floor((b - a) / n) + 1 }, (__, i) => Number(a) + i * n).join()),
    "and the minutes the fallback gives the focus tick are exactly the minutes its cron names");
  {
    const day = T("2026-09-23T00:00:00Z");
    const fires = (step, first = 0) => Array.from({ length: 24 * 60 }, (_, m) => m).filter((m) => m % step === first)
      .map((m) => day + m * 60000);
    const stale = [...fires(5, 1).map((t) => W.cronJob(W.RTH_CRON, t)), ...fires(30).map((t) => W.cronJob(W.HOUSEKEEPING_CRON, t)),
      ...fires(15).map((t) => W.cronJob("*/15 * * * *", t))];
    ok(stale.length === 288 + 48 + 96 && !stale.includes("focus"),
      "BUT A DEPLOY THAT LEAVES THE PREVIOUS TRIGGERS NEVER RUNS THE FOCUS TICK: under the two exact strings the " +
        "handler branches on, or the older */15, no firing lands on a minute ending in 3 or 8, so live:focus is simply " +
        "never written, and the nightly health gate's live:focus check is what says so");
  }
  ok(/const job = FLOWS_LIVE\.cronJob\(event && event\.cron, at\);\s*if \(job === "rth"\)/.test(worker) &&
     /if \(job === "focus"\) \{\s*guard\("flows focus tick failed", \(async \(\) => \{\s*await ensureFlowsTables\(env\);\s*return FLOWS_LIVE\.focusTick\(env, at, \{ fetchVendor: \(p, params\) => uwFetch\(env, p, params\) \}\);/.test(worker),
    "the scheduled handler routes by the job a trigger's instant calls for, not by the trigger's exact string, and " +
    "the focus job reads the vendor through the same uwFetch as Tier 1");
  ok(/if \(job === "summary"\) \{\s*guard\("flows summary refresh failed", summaryFiring\(env, at\)\);\s*return;\s*\}/.test(worker) &&
     !/guard\("flows nightly dispatch failed"[\s\S]*?guard\("flows summary refresh failed"/.test(worker),
    "the summary job is the summary firing's alone and the housekeeping branch no longer carries it");
  const summaryBody = worker.slice(worker.indexOf("async function refreshFlowsSummary("), worker.indexOf("async function summaryFiring("));
  ok(/async function summaryFiring\(env, at\) \{\s*await refreshFlowsSummary\(env, at\);\s*if \(env\.DB\) await FLOWS_LIVE\.clockPatchStatement\(env\.DB, \{ summaryAt: at \}, at\)\.run\(\);\s*\}/.test(worker) &&
     summaryBody.length > 1000 && !/summaryAt/.test(summaryBody),
    "THE FIRING STAMPS summary_at ONLY WHEN THE REFRESH COMPLETED: the scheduled instant is written after refreshFlowsSummary " +
    "resolves and nowhere inside it, so a firing the CPU cap kills or a refresh that throws leaves the stamp where it was, " +
    "and the nightly health gate can tell a cron that never fires from one whose firings die");
  ok(/const \[briefRes, liveRes, priorRes, clockRes\] = await env\.DB\.batch\(\[\s*env\.DB\.prepare\("SELECT updated_at FROM flows_payload WHERE id = 'brief'"\),\s*env\.DB\.prepare\(FLOWS_LIVE\.LIVE_BRIEF_STAMP_SQL\),/.test(summaryBody) &&
     summaryBody.indexOf('const stored = await readFlowsPayload(env, "brief");') > summaryBody.indexOf("if (!retryableGuard(prior.guard, priorAge)) return;") &&
     summaryBody.indexOf("if (!retryableGuard(prior.guard, priorAge)) return;") > 0,
    "and a firing with nothing to do reads the stamp's inputs in one D1 batch, updated_at alone from the brief row, and " +
    "reaches for the 118 KB payload only after the stamp says work is due");
  eq(W.liveBriefStampOf([{ id: "live:market", updated_at: 7 }, { id: "live:alerts", updated_at: 5 }]), "live:alerts@5,live:market@7",
    "the live half of the summary stamp is a pure reduction of the two rows, sorted, so that batch can carry its query");
  eq(W.liveBriefStampOf(null), "", "and no rows is the empty stamp");
  ok(toml.includes(`"${W.RTH_CRON}"`) && toml.includes(`"${W.FOCUS_CRON}"`) && toml.includes(`"${W.HOUSEKEEPING_CRON}"`) &&
     toml.includes(`"${W.SUMMARY_CRON}"`),
    "the four crons the Worker branches on are the four wrangler.toml registers");
  const cronList = (toml.match(/^crons = \[([^\]]*)\]/m) || [null, ""])[1].match(/"[^"]+"/g) || [];
  eq(cronList.length, 4, "four Worker crons, inside the five Workers Free allows an account");
  ok(cronList.length >= 2 && cronList.every((c) => { const f = c.slice(1, -1).trim().split(/\s+/); return f.length === 5 && /^(\*|[A-Za-z]{3}(-[A-Za-z]{3})?(,[A-Za-z]{3}(-[A-Za-z]{3})?)*)$/.test(f[4]); }),
    "EVERY WORKER CRON NAMES ITS WEEKDAYS BY NAME: Cloudflare counts 1 = Sunday to 7 = Saturday, so the numeric 1-5 " +
    "this file carried ran Tier 1 Sunday to Thursday and never on a Friday, as 2026-09-25 showed (" + cronList.join(", ") + ")");
  ok(/\[\[ratelimits\]\][\s\S]*name = "UW_ONDEMAND"[\s\S]*limit = 120, period = 60/.test(toml),
    "and the on-demand vendor guard is bound at 120 calls a minute");
}

{
  const dir = mkdtempSync(join(tmpdir(), "flows-live-"));
  try {
    const out = execFileSync("node", [new URL("scripts/flows-pipeline.mjs", ROOT).pathname, "--live", "--dry-run",
      "--emit", join(dir, "p.json")], { encoding: "utf8" });
    const files = readdirSync(dir).sort();
    const keys = files.map((f) => f.replace(/^p-/, "").replace(/\.json$/, "").replace(/^live-/, "live:"));
    deep(keys.sort(), Object.keys(L.LIVE_KEYS).filter((k) => L.LIVE_KEYS[k].writer === "actions").sort(),
      "--live --dry-run emits every Tier 2 key and nothing else: not live:market or live:focus, which the Worker writes");
    for (const f of files) {
      const text = readFileSync(join(dir, f), "utf8");
      const body = JSON.parse(text);
      const key = body.key;
      ok(body.fresh && body.fresh.v === 1 && body.fresh.source === "actions" && body.fresh.cadenceS === 900,
        `${key} carries the fresh envelope of the Actions writer`);
      ok(text.length <= L.LIVE_KEYS[key].maxBytes, `${key} (${text.length} bytes) is inside its cap`);
    }
    const calls = [...out.matchAll(/live: (\d+) call\(s\)/g)].map((m) => Number(m[1]));
    ok(calls.length === 2 && calls.every((c) => c <= L.LIVE_BUDGET.tier2MaxCalls),
      `each dry tick spends ${calls.join(" and ")} vendor calls, inside the ${L.LIVE_BUDGET.tier2MaxCalls} budget`);
    ok(/sent newer_than=2026-08-24T/.test(out), "and the second tick resumes the alert cursor the first one stored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  {
    const SPEC_PARAMS = {
      "/api/market/sector-tide": ["date"], "/api/market/etf-tide": ["date"],
      "/api/net-flow/expiry": ["date", "moneyness", "tide_type", "expiration"],
      "/api/screener/stocks": ["ticker", "limit", "offset", "date"],
      "/api/option-trades/flow-alerts": ["ticker_symbol", "newer_than", "older_than", "limit"],
      "/api/stock/spot-exposures": ["date"], "/api/market/total-options-volume": ["limit"],
      "/api/market/top-net-impact": ["date", "issue_types[]", "limit"],
      "/api/darkpool/recent": ["limit", "date", "min_premium", "max_premium", "min_size", "max_size", "min_volume",
        "max_volume", "order", "order_by"],
      "/api/news/headlines": ["sources", "search_term", "ticker", "major_only", "limit", "page"],
    };
    const LIMIT_MAX = { "/api/darkpool/recent": 200, "/api/market/top-net-impact": 100, "/api/news/headlines": 100,
      "/api/option-trades/flow-alerts": 200, "/api/screener/stocks": 500 };
    const session = "2026-09-23";
    const at = easternInstant(session, 11 * 60 + 7);
    let clock = at;
    const uw = FAKE.fakeLiveVendor({ now: () => (clock += 250), session });
    const boards = FAKE.fakeBoards();
    await runLive({ uw, now: () => (clock += 250), log: () => {}, warn: () => {}, force: true, shapeNews,
      publish: async () => {},
      readStored: async (k) => (k.startsWith("board:") ? { payload: boards[k.slice(6)] } : { payload: null }) });
    const undocumented = [];
    for (const { path, params } of uw.calls) {
      const route = path.replace(/^\/api\/(market|stock)\/[^/]+\/(sector-tide|etf-tide|spot-exposures)$/, "/api/$1/$2");
      const allowed = SPEC_PARAMS[route] || [];
      for (const name of Object.keys(params)) if (!allowed.includes(name)) undocumented.push(`${route}?${name}`);
      if (LIMIT_MAX[route] && Number(params.limit) > LIMIT_MAX[route]) undocumented.push(`${route} limit ${params.limit}`);
    }
    deep(undocumented, [], "EVERY Tier 2 vendor call sends only query parameters the vendor's spec documents for that " +
      "route, inside the route's documented limit — an undocumented one (darkpool/recent has no newer_than) is " +
      "silently ignored and the read is not the window it claims");
    const dp = uw.calls.find((c) => c.path === "/api/darkpool/recent");
    ok(dp && dp.params.date === session && dp.params.order_by === "premium",
      "the dark-pool read asks for the session's own prints, largest premium first, so the top twenty it keeps are " +
      "the session's largest rather than the last few seconds'");
  }

  {
    const session = "2026-09-23";
    const at = easternInstant(session, 11 * 60 + 7);
    const boards = FAKE.fakeBoards();
    const runWith = async (fails) => {
      let clock = at;
      const fake = FAKE.fakeLiveVendor({ now: () => (clock += 250), session });
      const uw = async (path, params, opts) => {
        if (fails(path)) throw new Error(`${path} -> HTTP 502`);
        return fake(path, params, opts);
      };
      const published = {};
      const result = await runLive({ uw, now: () => (clock += 250), log: () => {}, warn: () => {}, force: true, shapeNews,
        publish: async (k, p) => { published[k] = p; },
        readStored: async (k) => (k.startsWith("board:") ? { payload: boards[k.slice(6)] } : { payload: null }) });
      return { published, result };
    };
    const down = await runWith(() => true);
    deep(Object.keys(down.published), ["live:heartbeat"],
      "A RUN IN WHICH NO VENDOR CALL ANSWERED publishes only its heartbeat: no key is re-stamped as read this " +
      "instant with nothing read behind it, so each goes stale on its own clock and the watchdog can see it");
    ok(Object.entries(down.result.run.keys).every(([k, b]) => k === "live:heartbeat" || b === null),
      "and the heartbeat's ledger names every key it did not publish");
    const noStrip = await runWith((p) => p === "/api/screener/stocks");
    ok(!noStrip.published["live:strips"] && !noStrip.published["live:strips:series"] && !noStrip.published["live:vol"] &&
       !noStrip.published["live:movers"] && noStrip.published["live:breadth"] && noStrip.published["live:gex"],
    "a failed strip read withholds the strip and the three keys built from it, while every key with its own " +
      "answered read is published");

    const statements = [];
    const db = {
      prepare(sql) {
        const st = { sql, args: [], bind(...a) { st.args = a; return st; }, first: async () => null,
          run: async () => ({ meta: { changes: 1 } }) };
        return st;
      },
      batch: async (list) => { statements.push(...list.map((x) => x.sql)); return list.map(() => ({ results: [] })); },
    };
    const tickAt = easternInstant(session, 10 * 60 + 6);
    const dead = await W.rthTick({ DB: db, UW_API_KEY: "k" }, tickAt,
      { fetchVendor: async () => { throw new Error("HTTP 502"); }, log: { error() {} } });
    ok(dead.tier1 && dead.tier1.written === false && dead.tier1.why === "no-feed-answered" &&
       !statements.some((q) => /INSERT INTO flows_live/.test(q)),
    "TIER 1 likewise: when neither of its two feeds answered, live:market is not rewritten");
    let clock = tickAt;
    const fake = FAKE.fakeLiveVendor({ now: () => (clock += 250), session });
    const alive = await W.rthTick({ DB: db, UW_API_KEY: "k" }, tickAt + 5 * 60000,
      { fetchVendor: (p, params) => fake(p, params, { envelope: true }), log: { error() {} } });
    ok(alive.tier1.written === true && statements.some((q) => /INSERT INTO flows_live/.test(q)),
      "while a tick whose feeds answered writes it");
  }

  const plan = boardPlan({ long: { payload: { rows: [{ t: "AAA", s: 90 }, { t: "BBB", s: 10 }] } },
    short: { payload: { rows: [{ t: "CCC", s: -95 }] } }, watch: { payload: null } });
  deep(plan.ranked, ["CCC", "AAA", "BBB"], "the gamma rotation ranks board names by |score|");
  eq(liveWindow(T("2026-09-23T12:00:00Z")).why, "before-open", "the live run exits at once before the open");
  eq(liveWindow(T("2026-09-26T15:00:00Z")).why, "not-trading", "and on a weekend");
  const thanksgiving = easternInstant("2026-11-26", 11 * 60);
  eq(liveWindow(thanksgiving).why, "not-trading",
    "THE COMPUTED NYSE CALENDAR KNOWS A SCHEDULED HOLIDAY: without the Worker's clock, Thanksgiving is not a session");
  eq(liveWindow(thanksgiving, { day: "2026-11-26", trading: 0, earlyClose: null }).why, "not-trading",
    "so the live window takes the Worker's tape-derived clock, and a day it closed is not a session");
  const tuesday = easternInstant("2026-11-24", 11 * 60);
  eq(liveWindow(tuesday).why, "session", "an ordinary Tuesday with no clock is a session");
  eq(liveWindow(tuesday, { day: "2026-11-24", trading: 0, earlyClose: null }).why, "not-trading",
    "and an unscheduled closure the tape proved today is not");
  eq(liveWindow(tuesday, { day: "2026-11-23", trading: 0, earlyClose: null }).why, "session",
    "a verdict for another day is never applied to this one");
  const early = { day: "2026-11-27", trading: 1, earlyClose: 1 };
  ok(liveWindow(easternInstant("2026-11-27", 13 * 60 + 25), early).run &&
     liveWindow(easternInstant("2026-11-27", 13 * 60 + 30), early).why === "after-close" &&
     liveWindow(easternInstant("2026-11-27", 13 * 60 + 30)).why === "after-close" &&
     liveWindow(easternInstant("2026-11-20", 13 * 60 + 30)).run,
  "AN EARLY CLOSE ends the window at 13:25 (13:00 plus the run-after-close), from the computed calendar before the tape " +
    "confirms it, while an ordinary Friday runs on to 16:25");
  const skipped = await runLive({ uw: async () => { throw new Error("no vendor call on a holiday"); },
    publish: async () => {}, readStored: async () => { throw new Error("no store read on a holiday"); },
    now: () => thanksgiving, log: () => {}, clock: { day: "2026-11-26", trading: 0, earlyClose: null } });
  deep(skipped, { skipped: "not-trading" }, "and a single live pass on a closed day spends nothing");
}

{
  const src = read("assets/js/flows-fresh.js");
  const listeners = [];
  const ctx = { window: { FlowsUI: {} }, document: { hidden: false, addEventListener: (t, f) => listeners.push([t, f]),
    removeEventListener() {} }, Date, isFinite, Number, String, Math, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const UI = ctx.window.FlowsUI;
  ok(typeof UI.freshFrom === "function" && typeof UI.heartbeat === "function" && typeof UI.freshAggregate === "function",
    "the client helper attaches to FlowsUI and adds no global of its own");
  {
    const frozenCtx = { window: {}, document: ctx.document, Date, isFinite, Number, String, Math, setTimeout, clearTimeout };
    vm.createContext(frozenCtx);
    vm.runInContext("window.FlowsUI = Object.freeze({ F: Object.freeze({ px: 1 }), chart: Object.freeze({}) });", frozenCtx);
    const before = frozenCtx.window.FlowsUI;
    vm.runInContext('"use strict";\n' + src, frozenCtx);
    const after = frozenCtx.window.FlowsUI;
    ok(typeof after.heartbeat === "function" && typeof after.freshFrom === "function",
      "on the real, frozen FlowsUI the helper still installs: flows-ui.js freezes its object, and assigning to it threw");
    ok(after !== before && after.F === before.F && after.chart === before.chart && Object.isFrozen(after),
      "by publishing a new frozen FlowsUI that keeps every primitive the page already had");
  }
  const at = T("2026-09-23T14:00:00Z");
  const { headers } = freshHeaders({ readAt: at - 60000, cadenceS: 300, session: "2026-09-23" }, at);
  const h = new Headers(headers);
  const f = UI.freshFrom(h);
  const skewed = f.skewMs;
  eq(f.stateAt(at - skewed), "live", "the browser reads the server's state from the headers");
  eq(f.stateAt(at - skewed + 11 * 60000), "fresh", "turns fresh at liveUntil by comparing clocks");
  eq(f.stateAt(at - skewed + 30 * 60000), "stale", "and stale at staleAt, holding no threshold of its own");
  eq(f.nextAt(at - skewed), at - 60000 + 660000 - skewed, "nextAt is the next instant the glyph must change");
  deep(JSON.parse(JSON.stringify(f.forFreshness(at - skewed))), { readAt: new Date(at - 60000).toISOString(), live: true,
    sessionDate: "2026-09-23", source: "worker", state: "live" },
  "and forFreshness() is the object FlowsUI.freshness() takes");
  const bare = new Headers(headers);
  bare.delete("X-Server-Now");
  const noClock = UI.freshFrom(bare);
  ok(noClock.skewMs === 0 && noClock.stateAt(at + 30 * 60000) === "stale",
    "A RESPONSE WITHOUT X-Server-Now leaves the skew at zero and the page's own clock in charge — Number(null) is 0, " +
    "and a server clock of the epoch would pin every glyph at live for good");
  {
    const row = { id: "live:market", payload: JSON.stringify({ key: "live:market", tide: { n: 3 } }), read_at: at - 60000,
      session: "2026-09-23", cadence_s: 300, source: "worker", writer: "worker", updated_at: at - 59000 };
    const env = JSON.parse(W.liveEnvelope(["market", "vol"], [row], at, null).body);
    const mk = UI.liveBody(env, "market");
    deep([mk.key, mk.tide.n, mk.__updatedAt, mk.__ff.stateAt(at - mk.__ff.skewMs), mk.__ff.source, mk.__ff.phase, mk.__ff.serverNow],
      ["live:market", 3, at - 59000, "live", "worker", env.phase.phase, at],
    "liveBody unpacks a held key of the envelope into the body the single-key route produced: the payload itself, " +
      "__updatedAt from the entry, __ff from its fresh entry at the envelope's clock and phase");
    const single = UI.freshFrom(new Headers(W.liveEnvelope(["market"], [row], at, null).headers));
    const view = (f) => [f.state, f.reason, f.klass, f.readAt, f.liveUntil, f.staleAt, f.session, f.source, f.cadenceS, f.phase, f.phaseEndsAt, f.serverNow];
    deep(view(mk.__ff), view(single), "and that __ff reads the same as the one the single key's X-Fresh-* headers give, field for field");
    const vol = UI.liveBody(env, "vol");
    deep([vol.status, vol.__updatedAt, vol.__ff.state, vol.__ff.klass, vol.__ff.stateAt()], ["pending", null, "pending", "breadth", "pending"],
      "a pending key is the { status: \"pending\" } body the soon 404 path produced, with a pending __ff");
    deep([UI.liveBody(env, "strips"), UI.liveBody({ status: "pending" }, "market"), UI.liveBody(null, "market")], [null, null, null],
      "a key the envelope does not carry, a body with no keys, and no body are null, as a failed single read was");
    const bareEntry = UI.liveBody({ keys: { market: { status: "ok", payload: { a: 1 } } } }, "market");
    deep([bareEntry.a, bareEntry.__updatedAt, bareEntry.__ff], [1, null, null],
      "an entry without a fresh object stamps __ff null, as a response without X-Fresh-State did");
  }
  eq(UI.freshAggregate(["live", "fresh"], "rth"), "live", "page aggregate: live if any module is live");
  eq(UI.freshAggregate(["live", "stale"], "rth"), "stale", "stale if any is stale");
  eq(UI.freshAggregate(["fresh", "closed"], "post"), "closed", "closed outside the session when nothing is live");
  eq(UI.freshAggregate([], "rth"), "pending", "and pending before any payload");
  deep([UI.heartbeatInterval("rth", "ticker"), UI.heartbeatInterval("rth", "market"), UI.heartbeatInterval("pre", "x"),
    UI.heartbeatInterval("closed", "x"), UI.heartbeatInterval("rth", "ticker", true)], [20000, 30000, 60000, null, null],
  "one heartbeat per page: 20 s on a ticker in session, 30 s elsewhere, 60 s pre/post, none closed or hidden");
  {
    let clock = 0;
    let seq = 0;
    const timers = new Map();
    const fakeSet = (f, ms) => { const id = ++seq; timers.set(id, { at: clock + (ms || 0), f }); return id; };
    const fakeClear = (id) => { timers.delete(id); };
    const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
    const tick = async (ms) => {
      const end = clock + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        clock = next[1].at;
        next[1].f();
      }
      clock = end;
      await flush();
    };
    const rth = { phase: "rth", session: "2026-09-29", trading: true, endsAt: "2026-09-29T20:00:00.000Z" };
    const run = (answer, withTimeout = true) => {
      const asked = [];
      const vis = [];
      const hctx = {
        window: { FlowsUI: {} }, isFinite, Number, String, Math, setTimeout: fakeSet, clearTimeout: fakeClear,
        Date: class extends Date { static now() { return Date.parse("2026-09-29T15:00:00Z") + clock; } },
        document: { hidden: false, addEventListener: (t, f) => vis.push(f), removeEventListener() {} },
        fetch: (url, init) => {
          const i = asked.length;
          asked.push({ url: String(url), at: clock, signal: !!(init && init.signal) });
          return new Promise((resolve, reject) => {
            if (init && init.signal) init.signal.addEventListener("abort", () => reject(new Error("AbortError")));
            const body = answer(i);
            if (body) resolve({ ok: true, status: 200, json: async () => body });
          });
        },
      };
      if (withTimeout) {
        hctx.AbortSignal = { timeout: (ms) => {
          const fns = [];
          fakeSet(() => fns.forEach((f) => f()), ms);
          return { addEventListener: (t, f) => fns.push(f) };
        } };
      }
      vm.createContext(hctx);
      vm.runInContext(src, hctx);
      return { asked, hb: hctx.window.FlowsUI.heartbeat({ ticker: "NVDA", nightly: ["card:NVDA"], page: "ticker" }), vis };
    };
    const ok200 = () => ({ serverNow: 0, phase: rth, keys: {}, quote: { status: "ok" } });
    {
      clock = 0; timers.clear();
      const r = run(ok200);
      await tick(10 * 60 * 1000);
      const at = r.asked.map((a) => a.at);
      eq(r.asked.length, 31, "A TICKER IN SESSION beats every 20 s: 31 /api/flows/now requests in ten minutes, where the 10 s beat sent 61");
      ok(at.slice(1).every((t, i) => t - at[i] === 20000), `each 20 s after the last (${at.slice(0, 5).join(", ")} ms)`);
      ok(r.asked.every((a) => /[?&]t=NVDA(&|$)/.test(a.url) && /[?&]n=card%3ANVDA(&|$)/.test(a.url)),
        "and every one of them carries the quote beside the card's key, so the price is asked every 20 s as before and no beat " +
          "is spent on a nightly row that cannot move in session");
      r.vis[0]();
      await flush();
      ok(r.asked.length === 32 && /[?&]t=NVDA/.test(r.asked[31].url), "a tab brought back to view beats at once, with the quote");
      r.hb.stop();
    }
    {
      clock = 0; timers.clear();
      const r = run((i) => (i === 1 ? null : ok200()));
      await tick(20000);
      eq(r.asked.length, 2, "A STALLED BEAT: the second beat goes out at 20 s and its response never arrives");
      ok(r.asked.every((a) => a.signal), "every beat's fetch carries a deadline signal");
      await tick(7999);
      eq(r.asked.length, 2, "for 8 s the heartbeat waits on it");
      await tick(1);
      await tick(40000 - 1);
      eq(r.asked.length, 2, "then the deadline aborts it and it counts as a failed beat: the backoff waits twice the beat, 40 s");
      await tick(1);
      eq(r.asked.length, 3, "and the next beat fires, 48 s after the stalled one went out, rather than never");
      await tick(20000);
      eq(r.asked.length, 4, "that beat answers, the backoff clears, and the 20 s cadence resumes");
      r.hb.stop();
    }
    {
      clock = 0; timers.clear();
      const r = run((i) => (i === 1 ? null : ok200()), false);
      await tick(5 * 60 * 1000);
      eq(r.asked.length, 2, "without a deadline (a browser with no AbortSignal.timeout) the same stall is the page's last beat, which is what the deadline repairs");
      r.hb.stop();
    }
  }
  ok(!/localStorage|sessionStorage/.test(src), "and it touches no browser storage");
}

{
  const issuer = await oidcIssuer({ kid: "k1" });
  const other = await oidcIssuer({ kid: "k1" });
  const now = T("2026-09-24T14:00:00Z");
  const s = Math.floor(now / 1000);
  const keys = [issuer.jwk];
  const good = issuer.claims(now);
  const token = await issuer.sign(good);
  deep(await O.verifyLiveOidc(token, keys, now), { ok: true, claims: good },
    "OIDC: a GitHub token for this repository's flows-live.yml on main, with this audience and inside its window, is the live credential");
  const cases = [
    ["iss", "https://token.actions.githubusercontent.com.evil", "iss"],
    ["aud", "https://github.com/anilkaya001", "aud"],
    ["aud", [O.LIVE_OIDC.audience], "aud"],
    ["repository", "someone/anilkaya.org", "repository"],
    ["repository_id", "1", "repository"],
    ["repository_owner_id", "2", "repository"],
    ["workflow_ref", "anilkaya001/anilkaya.org/.github/workflows/flows-pipeline.yml@refs/heads/main", "workflow"],
    ["workflow_ref", "anilkaya001/anilkaya.org/.github/workflows/flows-live.yml@refs/heads/feature", "workflow"],
    ["job_workflow_ref", "someone/else/.github/workflows/x.yml@refs/heads/main", "workflow"],
    ["ref", "refs/heads/feature", "ref"],
    ["event_name", "pull_request", "event"],
    ["event_name", "push", "event"],
    ["runner_environment", "self-hosted", "runner"],
    ["exp", s - 61, "expired"],
    ["iat", s + 120, "early"],
    ["nbf", s + 120, "early"],
    ["exp", s + 3700, "lifetime"],
    ["iat", "0", "time"],
  ];
  for (const [field, value, why] of cases) {
    eq((await O.verifyLiveOidc(await issuer.sign({ ...good, [field]: value }), keys, now)).why, why,
      `OIDC: ${field} = ${JSON.stringify(value)} is refused as ${why}`);
  }
  eq((await O.verifyLiveOidc(token, keys, now + 359_000)).ok, true, "a token is honoured to its exp plus a minute of skew");
  eq((await O.verifyLiveOidc(token, keys, now + 361_000)).why, "expired", "and not a second after");
  eq((await O.verifyLiveOidc(await issuer.sign(good, { alg: "none" }), keys, now)).why, "alg", "alg none is refused");
  eq((await O.verifyLiveOidc(await issuer.sign(good, { alg: "HS256" }), keys, now)).why, "alg",
    "and so is HS256, so the public key can never be used as an HMAC secret");
  eq((await O.verifyLiveOidc(await issuer.sign(good, { kid: "" }), keys, now)).why, "kid", "a token without a key id is refused");
  eq((await O.verifyLiveOidc(await issuer.sign(good, { kid: "k9" }), keys, now)).why, "unknown-kid",
    "and one naming a key GitHub does not publish");
  eq((await O.verifyLiveOidc(await other.sign(good), keys, now)).why, "signature",
    "a token signed by any other key under the same kid is refused on its signature");
  const [h, , sig] = token.split(".");
  const forged = h + "." + Buffer.from(JSON.stringify({ ...good, run_id: "2" })).toString("base64url") + "." + sig;
  eq((await O.verifyLiveOidc(forged, keys, now)).why, "signature", "and a single edited claim breaks the signature");
  for (const bad of ["", "a.b", "a.b.c.d", "a..c", "e30.e30.@@", "x".repeat(9000), token + "="]) {
    eq((await O.verifyLiveOidc(bad, keys, now)).why, "malformed", `a malformed token (${bad.slice(0, 12)}…) is refused before any crypto`);
  }
  ok(!O.looksLikeJwt("test-live-token-abcdefghijklmnopqrstuv") && O.looksLikeJwt(token),
    "a static hex token never takes the OIDC path, and a JWT always does");

  for (const file of ["worker.js", "shared/flows-live-worker.js"]) {
    ok(!/redirect:\s*"error"/.test(read(file)),
      `${file} never asks workerd for redirect "error", which it rejects with a TypeError on every fetch`);
  }
  let hits = 0;
  const logs = [];
  const log = { error: (line) => logs.push(JSON.parse(line)) };
  const served = (list) => async (url, init) => {
    hits++;
    ok(init && init.redirect === "manual", "the JWKS fetch follows no redirect, in the one form workerd accepts");
    return new Response(JSON.stringify({ keys: list }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const kind = async (t, env, opts) => (await W.oidcKind(t, env, { log, ...opts })).kind;
  W.resetJwksMemo();
  eq(await kind(token, {}, { fetchImpl: served(keys), now }), "live", "the Worker grants a verified OIDC token the live role");
  eq(await kind(token, {}, { fetchImpl: served(keys), now: now + 30_000 }), "live", "from its isolate's JWKS memo");
  eq(hits, 1, "one JWKS fetch serves every write in the memo's hour");
  eq(logs.length, 0, "and a token that is honoured logs nothing");
  W.resetJwksMemo(); hits = 0;
  const wrongAud = await W.oidcKind(await issuer.mint(now, { aud: "x" }), {}, { fetchImpl: served(keys), now, log });
  deep([wrongAud.kind, wrongAud.why, wrongAud.unavailable], [null, "aud", false], "a token that fails its claims is refused");
  eq(hits, 0, "before it can cost a JWKS fetch");
  const said = logs.pop();
  deep([said.message, said.why, said.claims.aud, said.claims.workflow_ref, said.claims.event_name],
    ["live OIDC token refused", "aud", "x", O.LIVE_OIDC.workflowRef, "schedule"],
  "and the refusal is logged with its reason and the token's non-secret claims, so a production 401 can be read");
  ok(!JSON.stringify(said).includes(token.split(".")[2]), "while the token itself is never logged");
  W.resetJwksMemo(); hits = 0;
  const rotated = await issuer.sign(good, { kid: "k2" });
  eq((await W.oidcKind(rotated, {}, { fetchImpl: served(keys), now, log })).why, "unknown-kid", "an unknown kid is refused");
  eq(hits, 1, "and a refetch for it waits out the retry window");
  const next = await oidcIssuer({ kid: "k2" });
  eq(await kind(await next.mint(now + 61_000), {}, { fetchImpl: served([issuer.jwk, next.jwk]), now: now + 61_000 }), "live",
    "a minute later the unknown kid refetches the set, so a rotated GitHub key is honoured within the minute");
  eq(hits, 2, "with exactly one more fetch");

  W.resetJwksMemo(); hits = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = async (url, init) => { await gate; return served(keys)(url, init); };
  const racing = [W.oidcKind(token, {}, { fetchImpl: slow, now, log }), W.oidcKind(token, {}, { fetchImpl: slow, now, log })];
  release();
  deep((await Promise.all(racing)).map((r) => r.kind), ["live", "live"],
    "SINGLE FLIGHT: two writes reaching a cold isolate together both wait on the one key-set fetch");
  eq(hits, 1, "and it is fetched once, not refused to the second while the first is in flight");

  W.resetJwksMemo(); hits = 0;
  const never = () => new Promise(() => {});
  W.jwksKeys({}, never, now, false);
  const t0 = Date.now();
  const abandoned = await W.oidcKind(token, {}, { fetchImpl: served(keys), now: now + 1000, log });
  const waited = Date.now() - t0;
  ok(abandoned.unavailable === true && waited >= W.JWKS_WAIT_MS - TIMER_SLACK_MS && waited < W.JWKS_WAIT_MS + 2500,
    `A KEY-SET FETCH ABANDONED BY THE INGEST THAT STARTED IT (a client gone before the 4 s fetch landed) is waited on for ${W.JWKS_WAIT_MS / 1000} s ` +
    `and then dropped (${waited} ms): the second write reports the keys unavailable instead of hanging for the life of the isolate`);
  eq(await kind(token, {}, { fetchImpl: served(keys), now: now + W.JWKS_COLD_RETRY_MS + 1000 }), "live",
    "and the next write inside the cold retry window fetches the set afresh");
  eq(hits, 1, "with one fetch, the dead one never counted");

  W.resetJwksMemo(); logs.length = 0;
  const down = await W.oidcKind(token, {}, { fetchImpl: async () => { throw new Error("down"); }, now, log });
  deep([down.kind, down.why, down.unavailable], [null, "keys-unavailable", true],
    "an unreachable key set fails closed, and says it is an outage rather than a bad credential");
  eq(logs.pop().message, "live OIDC key set unavailable", "in the log as well");
  W.resetJwksMemo();
  eq((await W.oidcKind(token, {}, { fetchImpl: async () => new Response("nope", { status: 503 }), now, log })).unavailable, true,
    "and so does a 5xx");
  hits = 0;
  eq((await W.oidcKind(token, {}, { fetchImpl: served(keys), now: now + 2000, log })).unavailable, true,
    "a cold isolate that has never held the key set waits a few seconds before fetching again");
  eq(await kind(token, {}, { fetchImpl: served(keys), now: now + W.JWKS_COLD_RETRY_MS }), "live",
    `then fetches again after ${W.JWKS_COLD_RETRY_MS / 1000} s, inside the pipeline's own retries, not a minute later`);
  eq(hits, 1, "with one fetch");

  W.resetJwksMemo();
  let asked = null;
  await W.oidcKind(token, {}, { fetchImpl: async (url) => { asked = url; return new Response("{}"); }, now, log });
  eq(asked, O.LIVE_OIDC.jwks, "the key set comes from GitHub's own issuer by default");
  const jw = (v) => W.jwksUrl({ GITHUB_OIDC_JWKS: v });
  deep([jw("https://token.actions.githubusercontent.com/.well-known/jwks"), jw("http://127.0.0.1:8787/.well-known/jwks"),
    jw("http://localhost:9/jwks"), jw("https://evil.example/.well-known/jwks"),
    jw("http://token.actions.githubusercontent.com/.well-known/jwks"), jw("https://token.actions.githubusercontent.com.evil/x"),
    jw("http://10.0.0.1:80/jwks")],
  ["https://token.actions.githubusercontent.com/.well-known/jwks", "http://127.0.0.1:8787/.well-known/jwks",
    "http://localhost:9/jwks", null, null, null, null],
  "the key-set override is the trust root, so it is held to GitHub's own https issuer or a loopback test stub, as the " +
  "dispatch base is");
  W.resetJwksMemo(); hits = 0;
  const hostile = await W.oidcKind(token, { GITHUB_OIDC_JWKS: "https://evil.example/jwks" }, { fetchImpl: served(keys), now, log });
  deep([hostile.kind, hostile.unavailable, hits], [null, true, 0], "and any other override fetches nothing and grants nothing");
  eq(logs.pop().jwks, "bad-override", "saying why");

  const ingestRoute = read("worker.js").slice(read("worker.js").indexOf('if (path === "/api/flows/ingest")'));
  ok(/if \(check\.unavailable\) \{\s*throw new HttpError\(503,/.test(ingestRoute.slice(0, 1500)),
    "the ingest route answers a key-set outage with 503, which the pipeline retries, rather than a 401 it gives up on");
  const spy = { imports: 0, importKey: (...a) => { spy.imports++; return crypto.subtle.importKey(...a); },
    verify: (...a) => crypto.subtle.verify(...a) };
  const jwt = O.decodeJwt(token);
  const fresh = { ...issuer.jwk };
  deep([await O.rsaVerify(jwt, fresh, spy), await O.rsaVerify(jwt, fresh, spy), spy.imports], [true, true, 1],
    "the imported public key is cached beside the key set, so a verified write costs one RSA verify and no re-import");
  eq((await O.verifyLiveOidc(token, async () => null, now)).why, "keys-unavailable",
    "ONE VERIFIER: the Worker's path is verifyLiveOidc with a key resolver, so the claim suite above tests what runs");
  W.resetJwksMemo();
  eq(await W.tokenKind(token, { FLOWS_INGEST_TOKEN: "n", FLOWS_LIVE_TOKEN: "l" }, (a, b) => a === b), null,
    "the static comparison never mistakes a JWT for a configured token");
  deep([W.ingestScope("live:breadth", "POST", "live").ok, W.ingestScope("board:long", "POST", "live").ok,
    W.ingestScope("live:breadth", "DELETE", "live").ok], [true, false, false],
  "and the OIDC role IS the live role: live:* writes only, no nightly key, no delete");

  eq(liveCredentialSource({ FLOWS_LIVE_TOKEN: "x" }), "the live token", "a local --live run may still use a static live token");
  eq(liveCredentialSource({ ACTIONS_ID_TOKEN_REQUEST_URL: "u", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "t" }), "GitHub OIDC",
    "an Actions job with id-token: write proves itself with OIDC");
  eq(liveCredentialSource({ FLOWS_INGEST_TOKEN: "n" }), null, "and the nightly token is never a live credential");
  const requests = [];
  const env = {
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/x/idtoken?api-version=2.0",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "req-token", FLOWS_INGEST_TOKEN: "nightly",
  };
  const idFetch = async (url, init) => {
    requests.push({ url: new URL(url), auth: init.headers.Authorization, redirect: init.redirect });
    return new Response(JSON.stringify({ value: token }), { status: 200 });
  };
  const far = now + 10 * 3600_000;
  eq(await liveCredential({ env, now, fetchImpl: idFetch }), token, "the pipeline mints the OIDC token");
  const first = requests[0];
  deep([requests.length, first.url.searchParams.get("audience"), first.url.searchParams.get("api-version"), first.auth,
    first.redirect], [1, O.LIVE_OIDC.audience, "2.0", "Bearer req-token", "error"],
  "once, for the Worker's audience, on the runner's own request URL and bearer");
  await liveCredential({ env, now: now + 300_000 - LIVE_BEARER_MARGIN_MS - 1000, fetchImpl: idFetch });
  eq(requests.length, 1, "and reuses it while more than a minute of its life is left");
  await liveCredential({ env, now: now + 300_000 - LIVE_BEARER_MARGIN_MS + 1000, fetchImpl: idFetch });
  eq(requests.length, 2, "then mints the next before the Worker could see it expire");
  requests.length = 0;
  const later = now + 3 * 3600_000;
  const pair = await Promise.all([liveCredential({ env, now: later, fetchImpl: idFetch }),
    liveCredential({ env, now: later, fetchImpl: idFetch })]);
  deep([pair[0] === token, pair[1] === token, requests.length], [true, true, 1],
    "SINGLE FLIGHT: two ingest calls that need a fresh token at once share one mint");
  const otherRunner = { ...env, ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/y/idtoken?api-version=2.0" };
  await liveCredential({ env: otherRunner, now: later, fetchImpl: idFetch });
  eq(requests.length, 2, "and a token is bound to the runner that minted it: another request URL mints its own");
  const pipelineSrc = read("scripts/flows-pipeline.mjs");
  const liveModeBody = pipelineSrc.slice(pipelineSrc.indexOf("async function runLiveMode"), pipelineSrc.indexOf("async function main"));
  ok(liveModeBody.length > 0 && !/liveCredential\(/.test(liveModeBody),
    "LAZY: --live mints nothing before runLive decides to run, so an out-of-window or recently-beaten run never " +
    "depends on GitHub's token service");
  await assert.rejects(liveCredential({ env: {}, now: far, fetchImpl: idFetch }), /id-token: write/,
    "a job without the permission fails with the line that fixes it");
  await assert.rejects(liveCredential({ env, now: far, fetchImpl: async () => new Response("no", { status: 403 }) }),
    /HTTP 403/, "and a refused request names its status");
  checks += 2;
}

{
  const S = "2026-09-24";
  const open = easternInstant(S, 9 * 60 + 30);
  const minute = (i, v) => ({ timestamp: new Date(open + i * 60000).toISOString(), ncp: v, npp: v === null ? null : -v });
  const day = (filled) => Array.from({ length: 390 }, (_, i) => minute(i, i < filled ? i + 1 : null));
  const opts = (basis) => ({ fields: { ncp: "ncp", npp: "npp" }, basis, check: false });
  for (const basis of ["cumulative", "level"]) {
    const atOpen = L.bucketSeries(day(1), opts(basis));
    ok(atOpen.n === 1 && atOpen.ncp[0] === 1 && atOpen.t[0] === L.isoSec(open),
      `THE VENDOR PRE-FILLS THE DAY WITH NULLS (${basis}): at 09:31 the one filled minute is kept — the bucket's last ` +
      "row WITH VALUES, not its last row, which is a null placeholder for a minute not yet traded");
    eq(atOpen.dropped, 389, "and the 389 placeholders are counted as dropped, never as values");
    const mid = L.bucketSeries(day(152), opts(basis));
    eq(mid.n, 31, `MID-SESSION (${basis}): 152 filled minutes are 30 complete buckets and the current partial one`);
    deep([mid.ncp.at(-1), mid.t.at(-1)], [152, L.isoSec(open + 151 * 60000)],
      "and the partial bucket is sampled at its latest filled minute, so the headline is this minute's, not five ago");
    const full = L.bucketSeries(day(390), opts(basis));
    ok(full.n === 78 && full.ncp.at(-1) === 390 && full.dropped === 0 && full.net.at(-1) === 780,
      `A FULL DAY (${basis}) is 78 buckets, each at its last minute, net = ncp − npp`);
    const holey = day(12);
    holey[9] = minute(9, null);
    const h = L.bucketSeries(holey, opts(basis));
    deep(h.ncp, [5, 9, 12], "a null minute at a bucket's end is skipped too: 09:35–09:39 is sampled at 09:38's value");
  }
  const tide = FAKE.fakeEtfTide("SPY", { session: S, now: open + 61 * 60000 });
  ok(tide.data.length === 390 && tide.data.at(-1).net_call_premium === null,
    "the fake vendor pre-fills the rest of the day with nulls, as the real one does");
  const shaped = L.shapeTideFeed(tide, { session: S, withPx: true });
  ok(shaped.status === "ok" && shaped.n === 13 && shaped.lastAt === L.isoSec(open + 60 * 60000),
    "so an ETF tide an hour in shapes to thirteen buckets ending at its latest filled minute, not rows-unshaped");
  eq(L.tideLastAt(tide), open + 60 * 60000,
    "and the tape's last instant is the last minute with values, not the pre-filled 15:59 placeholder");
  const blank = { date: S, data: day(0) };
  const early = L.shapeTideFeed(blank, { session: S, withPx: true });
  ok(early.status === "quiet" && early.reason === L.SILENCE.empty && early.n === 0 && early.seen === 390 &&
     early.dropped === 390,
  "BEFORE THE FIRST PRINT a pre-filled feed is every minute a null placeholder: that is quiet (vendor-empty), " +
    "no trade yet, not unreadable — nothing about the feed is broken");
  const dteBlank = L.shapeNetFlowFeed({ date: S, data: [{ expiration: "zero_dte", data: day(0) }] },
    { session: S, expiration: "zero_dte" });
  ok(dteBlank.status === "quiet" && dteBlank.reason === L.SILENCE.empty && dteBlank.expiration === "zero_dte",
    "and so is the 0DTE net flow at 09:30, through the same shaper");
  eq(L.anyAnswered([early]), true, "a quiet feed answered, so the key it feeds is still written with its read time");
  const garbled = L.shapeTideFeed({ date: S, data: [{ timestamp: "not a time", ncp: 1 }, ...day(0).slice(0, 3)] },
    { session: S });
  eq(garbled.status, "unreadable", "while rows the shaper cannot place (a bad timestamp among them) stay unreadable");
  const offHours = L.shapeTideFeed({ date: S, data: [{ timestamp: new Date(open - 3600000).toISOString(), ncp: 1,
    npp: 1 }] }, { session: S });
  eq(offHours.status, "unreadable", "as do rows that all fall outside the session window");
  let noted = [];
  await runLive({ uw: async (path) => (/etf-tide|net-flow|sector-tide/.test(path) ? blank : { data: [] }),
    publish: async () => {}, readStored: async () => ({ payload: null, absent: true }),
    now: (() => { let t = easternInstant(S, 9 * 60 + 31); return () => (t += 50); })(),
    log: (line) => noted.push(line), warn: () => {}, force: true });
  ok(!noted.some((l) => /shaped none/.test(l)),
    "and a live pass at 09:31 logs no 'returned rows but shaped none' for feeds that have simply not printed yet");
}

{
  const S = "2026-09-24";
  const run = async (at, { env = {}, fetchVendor, clockRow = null } = {}) => {
    const db = tickDb();
    const batch = db.batch;
    db.batch = async (list) => {
      const res = await batch(list);
      if (/SELECT \* FROM flows_clock/.test(list[0].sql)) res[0] = { results: clockRow ? [clockRow] : [] };
      return res;
    };
    const out = await W.rthTick({ DB: db, UW_API_KEY: "k", ...env }, at, { fetchVendor, log: { error() {} } });
    const patches = db.statements.filter((st) => /INSERT INTO flows_clock/.test(st.sql));
    const col = (name) => {
      for (let i = patches.length - 1; i >= 0; i--) {
        const cols = /\(([^)]*)\) VALUES/.exec(patches[i].sql)[1].split(", ");
        const j = cols.indexOf(name);
        if (j >= 0) return patches[i].args[j];
      }
      return undefined;
    };
    return { out, db, patches, col };
  };
  const at = easternInstant(S, 10 * 60 + 6);
  const texts = await tier1Bodies({ session: S, at });
  const vendor = async (path) => JSON.parse(texts[path]);
  const ok1 = await run(at, { fetchVendor: vendor });
  ok(/^INSERT INTO flows_clock \(id, tier1_at, updated_at\)/.test(ok1.db.statements[0].sql) && ok1.db.statements[0].args[1] === at,
    "TIER 1 TELEMETRY: the first thing a tick does is stamp tier1_at, alone and cheaply, before any vendor read");
  deep([ok1.col("tier1_why"), ok1.col("tier1_ok_at"), ok1.out.why], ["written", at, "written"],
    "a tick that writes live:market records tier1_why written and moves tier1_ok_at");
  ok(ok1.db.statements.some((st) => /INSERT INTO flows_live/.test(st.sql)) && ok1.out.tier1.written,
    "in the same batch as the live:market write, so the two never disagree");
  const dead = await run(at, { fetchVendor: async () => { throw new Error("HTTP 502"); } });
  deep([dead.col("tier1_why"), dead.col("tier1_ok_at")], ["no-feed-answered", undefined],
    "a tick no feed answered says so, and leaves tier1_ok_at where the last good tick put it");
  const early = await run(easternInstant(S, 9 * 60 + 20), { fetchVendor: vendor });
  deep([early.col("tier1_why"), early.out.why, early.db.statements[0].args[1]], [undefined, "not-due", easternInstant(S, 9 * 60 + 20)],
    "a tick with no Tier 1 work (not-due) stamps tier1_at and leaves tier1_why on the last tick that did the work, " +
      "so a failure before the close is still there when the nightly's health gate reads it");
  {
    const row = { id: 1, day: "2026-09-23", trading: 1, early_close: 0, tier1_why: "written" };
    const whys = [];
    for (let m = 15 * 60 + 56; m <= 17 * 60 + 56; m += 5) {
      const tickAt = easternInstant(S, m);
      const t = await run(tickAt, { env: { UW_API_KEY: "" }, fetchVendor: vendor, clockRow: { ...row } });
      for (const patch of t.patches) {
        const cols = /\(([^)]*)\) VALUES/.exec(patch.sql)[1].split(", ");
        cols.forEach((c, j) => { row[c] = patch.args[j]; });
      }
      whys.push(t.out.why);
    }
    ok(whys[0] === "error:no-key" && whys.includes("not-due") && row.tier1_why === "error:no-key" &&
       row.tier1_at === easternInstant(S, 17 * 60 + 56),
    "A WORKER WITH NO UW_API_KEY, threaded 15:56 to 17:56 ET: the ticks after close + 10 are not-due, and tier1_why " +
      `still reads error:no-key at 17:56 (${whys.filter((w) => w !== "not-due").length} working ticks)`);
    const view = W.ingestClockView(W.normalizeClock(row));
    const H = healthChecks({ sessionDate: S, now: easternInstant(S, 17 * 60 + 58),
      clockRead: { payload: { key: "clock", clock: view }, status: 200 },
      marketRead: { payload: { fresh: { readAt: new Date(easternInstant(S, 15 * 60 + 55)).toISOString() } }, status: 200 },
      heartbeatRead: { payload: { session: S, run: { calls: 39, failedCalls: 0,
        finishedAt: new Date(easternInstant(S, 16 * 60 + 21)).toISOString() } }, status: 200 } });
    ok(H.failures.includes("HEALTH: Tier 1's last tick failed with error:no-key: the Worker has no UW_API_KEY secret " +
      "(wrangler secret put UW_API_KEY)"),
    "and the nightly health gate, reading that clock through the ingest view, names the missing Worker secret");
  }
  {
    const row = { id: 1, day: "2026-09-23", trading: 1, early_close: 0, tape_at: null, tape_moved_at: null };
    const written = [];
    for (let m = 9 * 60 + 31; m <= 10 * 60 + 6; m += 5) {
      const tickAt = easternInstant(S, m);
      const bodies = await tier1Bodies({ session: S, at: tickAt });
      const t = await run(tickAt, { fetchVendor: async (path) => JSON.parse(bodies[path]), clockRow: { ...row } });
      for (const patch of t.patches) {
        const cols = /\(([^)]*)\) VALUES/.exec(patch.sql)[1].split(", ");
        cols.forEach((c, j) => { row[c] = patch.args[j]; });
      }
      written.push([m, t.out.why || t.out.skipped, row.trading]);
    }
    ok(written.every(([, why]) => why === "written") && written[0][2] === null && row.trading === 1 && row.day === S,
      "A SESSION THREADED THROUGH ITS OWN CLOCK ROW: the 09:31 tick rolls the day with trading NULL, and every tick " +
        `after it still writes live:market; the 09:46 probe then records trading = 1 (${written.map(([m, w, tr]) =>
          `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} ${w} ${tr}`).join(", ")})`);
  }
  {
    const GF = "2027-03-26";
    const thread = async (tape) => {
      const row = { id: 1, day: "2027-03-25", trading: 1, early_close: 0, tape_at: null, tape_moved_at: null };
      const seen = [];
      for (let m = 9 * 60 + 31; m <= 10 * 60 + 11; m += 5) {
        const tickAt = easternInstant(GF, m);
        const bodies = await tape(tickAt);
        const t = await run(tickAt, { fetchVendor: async (path) => JSON.parse(bodies[path]), clockRow: { ...row } });
        for (const patch of t.patches) {
          const cols = /\(([^)]*)\) VALUES/.exec(patch.sql)[1].split(", ");
          cols.forEach((c, j) => { row[c] = patch.args[j]; });
        }
        seen.push(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} ${t.out.skipped || t.col("tier1_why") || t.out.why} ${row.day} ${row.trading}`);
      }
      return { row, seen };
    };
    const traded = await thread((tickAt) => tier1Bodies({ session: GF, at: tickAt }));
    ok(traded.seen[0].endsWith("not-due 2027-03-25 1") && traded.row.day === GF && traded.row.trading === 1 &&
       traded.seen.slice(3).every((l) => / written /.test(l)),
      "A COMPUTED HOLIDAY IS PROBED ONCE: on Good Friday the Worker reads the tape in the 09:45 probe window, and a tape " +
      "that shows the day trading records trading = 1, so a wrong or outdated rule can never silence a live session " +
      `(${traded.seen.join(", ")})`);
    const shut = await thread(() => tier1Bodies({ session: "2027-03-25", at: easternInstant("2027-03-25", 16 * 60 + 6) }));
    ok(shut.row.day === GF && shut.row.trading === 0 && shut.seen.slice(4).every((l) => / holiday /.test(l)) &&
       shut.seen.filter((l) => / written /.test(l)).length <= 1,
      "while a tape still on the previous session confirms the holiday at the first probe, and every later tick skips it " +
      `(${shut.seen.join(", ")})`);
    ok(!tier1Due(easternInstant(GF, 9 * 60 + 44)) && tier1Due(easternInstant(GF, 9 * 60 + 45)) &&
       tier1Due(easternInstant(GF, 9 * 60 + 55)) && !tier1Due(easternInstant(GF, 9 * 60 + 56)) &&
       !tier1Due(easternInstant(GF, 11 * 60)) && !tier1Due(easternInstant("2027-03-27", 9 * 60 + 50)),
      "the probe window is 09:45 to 09:55 on a weekday computed holiday only: never later, and never on a weekend");
    ok(!tier1Due(easternInstant(GF, 9 * 60 + 50), { day: GF, trading: 0 }) &&
       !tier1Due(easternInstant(GF, 9 * 60 + 50), { day: "2027-03-25", closedDays: [GF] }),
      "and a day the tape already closed is not probed again");
  }
  const holiday = await run(at, { fetchVendor: vendor, clockRow: { id: 1, day: S, trading: 0 } });
  ok(holiday.out.skipped === "holiday" && holiday.col("tier1_why") === "holiday", "a tape-derived holiday says holiday");
  const off = await run(at, { env: { FLOWS_LIVE_MODE: "off" }, fetchVendor: vendor });
  ok(off.out.skipped === "off" && off.col("tier1_why") === "off" && off.col("tier1_at") === at, "and a switched-off layer says off");
  const noKey = await run(at, { env: { UW_API_KEY: "" }, fetchVendor: vendor });
  eq(noKey.col("tier1_why"), "error:no-key", "a missing vendor key is an error with a short name");
  ok(W.tier1Why("error:" + "Cannot read <b>x</b>\n".repeat(20)).length <= 54, "an error reason is short");
  ok(/^error:[\w .:-]*$/.test(W.tier1Why("error:bad\u0000<chars>")), "and carries no markup or control characters");

  const upgrades = [];
  const fakeDb = (have, fail = null) => ({
    prepare(sql) {
      return {
        all: async () => ({ results: have.map((name) => ({ name })) }),
        run: async () => { if (fail && sql.includes(fail[0])) throw new Error(fail[1]); upgrades.push(sql); return {}; },
      };
    },
  });
  const later = ["closed_probe_at", "closed_days", "dispatch_why", "summary_at"];
  deep(await W.upgradeClockColumns(fakeDb(["id", "day", "tier1_at", "closed_days"])),
    ["tier1_ok_at", "tier1_why", "closed_probe_at", "dispatch_why", "summary_at"],
    "THE PRODUCTION TABLE UPGRADES ITSELF: the first-use path adds only the columns flows_clock lacks");
  deep(upgrades, ["ALTER TABLE flows_clock ADD COLUMN tier1_ok_at INTEGER", "ALTER TABLE flows_clock ADD COLUMN tier1_why TEXT",
    "ALTER TABLE flows_clock ADD COLUMN closed_probe_at INTEGER", "ALTER TABLE flows_clock ADD COLUMN dispatch_why TEXT",
    "ALTER TABLE flows_clock ADD COLUMN summary_at INTEGER"],
  "with one ALTER TABLE ADD COLUMN each");
  deep(await W.upgradeClockColumns(fakeDb(["id"], ["tier1_at", "duplicate column name: tier1_at"])),
    ["tier1_ok_at", "tier1_why", ...later], "a racing isolate that added a column first is tolerated (duplicate column)");
  let threw = false;
  try { await W.upgradeClockColumns(fakeDb(["id"], ["tier1_at", "database is locked"])); } catch { threw = true; }
  ok(threw, "while any other failure surfaces, so the schema is not marked ready and the next request retries");
  ok(/await FLOWS_LIVE\.upgradeClockColumns\(env\.DB\);\s*flowsSchemaReady = true;/.test(read("worker.js")),
    "and ensureFlowsTables marks the schema ready only after the upgrade");
}

{
  const S = "2026-09-24";
  const et = (m) => easternInstant(S, m);
  const sim = (start) => {
    let t = start;
    const sleeps = [];
    return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, sleeps, advance: (ms) => { t += ms; } };
  };
  {
    const c = sim(et(9 * 60 + 31) + 20000);
    const passAt = [];
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, budgetMs: 24 * 3600 * 1000,
      pass: async ({ first }) => { passAt.push([c.now(), first]); c.advance(40000); return {}; },
      chain: async () => { throw new Error("no chain inside the window"); } });
    eq(passAt[0][0], et(9 * 60 + 31) + 20000, "THE LOOP: a pass at once when the run starts");
    ok(passAt.slice(1).every(([t]) => t % LIVE_LOOP.slotMs === 0) && passAt.every(([, f], i) => f === (i === 0)),
      "then one pass on every five-minute slot, the first alone honouring a recent heartbeat");
    ok(c.sleeps.every((ms) => ms > 0 && ms <= LIVE_LOOP.slotMs), "sleeping only to the next slot");
    const last = passAt.at(-1)[0];
    ok(r.exit === "window-closed" && liveWindow(last).run && !liveWindow(nextSlot(last)).run &&
       last === easternInstant(S, 16 * 60 + 25),
    `and it exits when the session window closes, run-after-close included (last pass ${new Date(last).toISOString()})`);
    eq(r.passes.length, 1 + (16 * 60 + 25 - (9 * 60 + 35)) / 5 + 1, "a pass on every slot from the open to 16:25");
  }
  {
    const c = sim(et(9 * 60 + 31));
    const chained = [];
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {},
      pass: async () => { c.advance(45000); return {}; },
      chain: async ({ at }) => { chained.push(at); return { sent: true, why: "sent", status: 204 }; } });
    ok(r.exit === "budget" && chained.length === 1 && chained[0] - et(9 * 60 + 31) <= LIVE_LOOP.budgetMs &&
       liveWindow(chained[0]).run,
    "THE BUDGET: when the next slot would fall past the time budget with the session still open, the run " +
      "re-dispatches itself once and exits");
    ok(r.passes.length > 60 && r.passes.length <= LIVE_LOOP.budgetMs / LIVE_LOOP.slotMs + 1,
      `after ${r.passes.length} passes`);
  }
  {
    const c = sim(et(16 * 60 + 40));
    let passes = 0;
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, pass: async () => { passes++; return {}; },
      chain: async () => { throw new Error("never"); } });
    ok(r.exit === "outside-window" && passes === 0 && c.sleeps.length === 0,
      "A STARTER THAT QUEUED BEHIND A RUNNING LOOP and starts after the window closed exits at once, without a pass");
    const sat = sim(T("2026-09-26T15:00:00Z"));
    const w = await runLiveLoop({ now: sat.now, sleep: sat.sleep, log: () => {}, pass: async () => { passes++; },
      chain: async () => { throw new Error("never"); } });
    ok(w.exit === "outside-window" && w.why === "not-trading" && passes === 0, "as does one on a weekend");
  }
  {
    const early = async (iso, clock = null) => {
      const c = sim(T(iso));
      const passAt = [];
      const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, readClock: async () => clock,
        pass: async () => { passAt.push(c.now()); c.advance(40000); return {}; },
        chain: async ({ at }) => ({ sent: true, why: "sent", status: 204, at }) });
      return { r, passAt };
    };
    const edt = await early("2026-09-28T10:17:00Z");
    ok(edt.passAt[0] === easternInstant("2026-09-28", 9 * 60 + 31) && edt.r.preOpenMs === 194 * 60000 &&
       edt.r.exit === "budget" && edt.r.chained && edt.r.chained.sent,
    "A STARTER THAT LANDS BEFORE THE OPEN WAITS FOR IT (EDT): GitHub delivered Friday 2026-09-25's first starter in the " +
      "afternoon, so a 10:17 UTC starter that arrives on time sleeps 194 minutes, passes from 09:31 ET, and chains " +
      `itself when its budget ends (${edt.passAt.length} passes)`);
    const est = await early("2026-12-07T11:17:00Z");
    ok(est.passAt[0] === easternInstant("2026-12-07", 9 * 60 + 31) && est.r.preOpenMs === 194 * 60000,
      "and the same under EST, where the 11:17 UTC starter is the one 194 minutes before the open");
    const tooEarly = await early("2026-12-07T10:17:00Z");
    ok(tooEarly.r.exit === "outside-window" && tooEarly.r.why === "before-open" && tooEarly.passAt.length === 0 &&
       tooEarly.r.preOpenMs === 0,
    `a starter more than ${LIVE_LOOP.preOpenWaitMs / 60000} minutes early exits at once, leaving the open to a later starter ` +
      "and the job's six-hour cap to the session");
    const holiday = await early("2026-11-26T12:17:00Z");
    ok(holiday.r.exit === "outside-window" && holiday.r.why === "not-trading" && holiday.passAt.length === 0,
      "a starter on a computed NYSE holiday never waits");
    ok(LIVE_LOOP.preOpenWaitMs + 60 * 60000 <= LIVE_LOOP.budgetMs,
      "and a run that waited the longest still has an hour of passes before it chains");
    const sessionSpan = (PHASE_MINUTES.close + LIVE_CLOCK.runAfterCloseMin - (PHASE_MINUTES.open + 1)) * 60000;
    ok(2 * LIVE_LOOP.budgetMs - LIVE_LOOP.preOpenWaitMs >= sessionSpan,
      `and one chain carries it to 16:25: ${(LIVE_LOOP.budgetMs - LIVE_LOOP.preOpenWaitMs) / 60000} minutes of ` +
        `passes, then a chained run's ${LIVE_LOOP.budgetMs / 60000}, cover the ${sessionSpan / 60000} minutes from ` +
        "09:31 to 16:25, so the worst-case wait never costs a second chain");
  }
  {
    const waitMs = LIVE_LOOP.preOpenWaitMs;
    const slots = [...read(".github/workflows/flows-live.yml").matchAll(/cron: "([^"]+)"/g)]
      .flatMap((m) => cronMinutes(m[1]));
    const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const start = async (at) => {
      const c = sim(at);
      const passAt = [];
      const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {},
        pass: async () => { passAt.push(c.now()); c.advance(40000); return {}; },
        chain: async () => ({ sent: true, why: "sent", status: 204 }) });
      return { r, passAt, sleeps: c.sleeps, end: c.now() };
    };
    const wrong = [];
    const landed = {};
    for (const [zone, day] of [["EDT", "2026-09-28"], ["EST", "2026-11-02"]]) {
      const first = easternInstant(day, PHASE_MINUTES.open) + LIVE_LOOP.openLagMs;
      const base = T(day + "T00:00:00Z");
      for (const d of [0, 60, 120, 180, 210, 240, 270, 300]) {
        const key = `${zone} +${d} min`;
        landed[key] = 0;
        for (const s of slots) {
          const at = base + (s + d) * 60000;
          const { r, passAt, sleeps } = await start(at);
          const lead = first - at;
          const label = `${zone} ${hhmm(s)} UTC starter ${d} min late`;
          if (liveWindow(at).run) {
            if (passAt[0] !== at || r.preOpenMs !== 0) wrong.push(label + ": should pass at once");
          } else if (lead >= 0 && lead <= waitMs) {
            if (passAt[0] !== first || r.preOpenMs !== lead || sleeps[0] !== lead) wrong.push(label + ": should wait");
            else landed[key]++;
          } else if (r.exit !== "outside-window" || passAt.length || sleeps.length || r.preOpenMs !== 0) {
            wrong.push(label + ": should exit at once");
          }
        }
      }
    }
    deep(wrong, [], `THE LOOP DOES WHAT THE SCHEDULE ARITHMETIC SAYS, for every one of the ${slots.length} starter slots ` +
      "delivered on time or 1, 2, 3, 3.5, 4, 4.5 or 5 h late, under EDT (2026-09-28) and EST (2026-11-02): a " +
      "starter that lands up to " +
      `${waitMs / 60000} minutes before 09:31 ET sleeps until then and passes at 09:31 exactly, one that lands in the ` +
      "session passes at once, and any other exits at once without a sleep or a pass");
    ok(Object.values(landed).every((n) => n >= 7),
      "so at least seven starters, each run alone, would wait for 09:31 ET at every one of those delays; the " +
        "concurrency group lets the first of them wait and cancels all but the newest of the rest while it is " +
        `pending, so these are chances at the one waiting run, not waiting runs (${JSON.stringify(landed)})`);
    const group = async (landings) => {
      const ran = [];
      let busyUntil = -Infinity;
      let chainedAt = null;
      let pending = null;
      const begin = async (at) => {
        const run = await start(at);
        ran.push({ at, ...run });
        busyUntil = run.end;
        chainedAt = run.r.chained && run.r.chained.sent ? run.end : null;
      };
      const drainTo = async (limit) => {
        while (busyUntil <= limit && (pending !== null || chainedAt !== null)) {
          const next = chainedAt !== null ? busyUntil : pending;
          pending = null;
          chainedAt = null;
          await begin(Math.max(next, busyUntil));
        }
      };
      for (const at of landings) {
        await drainTo(at);
        if (busyUntil > at) pending = at;
        else await begin(at);
      }
      await drainTo(Infinity);
      return ran;
    };
    const queueWrong = [];
    for (const [zone, day] of [["EDT", "2026-09-28"], ["EST", "2026-11-02"]]) {
      const first = easternInstant(day, PHASE_MINUTES.open) + LIVE_LOOP.openLagMs;
      const base = T(day + "T00:00:00Z");
      for (const d of [0, 60, 120, 180, 210, 240, 270, 300]) {
        const ran = await group(slots.map((s) => base + (s + d) * 60000).sort((a, b) => a - b));
        const waiters = ran.filter((x) => x.r.preOpenMs > 0);
        const idle = ran.reduce((sum, x) => sum + x.r.preOpenMs, 0);
        if (waiters.length !== 1 || idle > waitMs || waiters[0].passAt[0] !== first) {
          queueWrong.push(`${zone} +${d} min: ${waiters.length} waiters, ${idle / 60000} min idle`);
        }
      }
    }
    deep(queueWrong, [], "THROUGH THE CONCURRENCY GROUP (one run, and one pending run that a newer one replaces): at " +
      "every one of those delays, under EDT and EST, exactly one run waits, it passes at 09:31 ET, and the day's " +
      `pre-open sleep adds up to at most ${waitMs / 60000} minutes however many starters land`);

    for (const [zone, day] of [["EDT", "2026-09-28"], ["EST", "2026-11-02"]]) {
      const first = easternInstant(day, 9 * 60 + 31);
      const longest = await start(first - waitMs);
      ok(longest.r.preOpenMs === waitMs && longest.sleeps[0] === waitMs && longest.passAt[0] === first &&
         longest.r.exit === "budget" && longest.r.chained.sent &&
         longest.passAt.at(-1) - first >= 60 * 60000 && longest.passAt.at(-1) - first < LIVE_LOOP.budgetMs - waitMs,
      `THE WORST-CASE IDLE (${zone}): a starter that lands exactly ${waitMs / 60000} minutes before 09:31 ET sleeps ` +
        `${waitMs / 60000} minutes, the most any run waits, then passes from 09:31 for ` +
        `${Math.round((longest.passAt.at(-1) - first) / 60000)} minutes before it chains`);
      const early = await start(first - waitMs - 1000);
      ok(early.r.exit === "outside-window" && early.r.why === "before-open" && early.passAt.length === 0 &&
         early.sleeps.length === 0 && early.r.preOpenMs === 0,
      `A STARTER EARLIER THAN THE WAIT WINDOW EXITS AT ONCE (${zone}): one second more than ${waitMs / 60000} minutes ` +
        "before 09:31 ET, no sleep and no pass");
    }

    const holidays = [];
    for (let t = T("2026-09-28T12:00:00Z"); t < T("2028-01-01T00:00:00Z"); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (isWeekdayDay(day) && isHoliday(day)) holidays.push(day);
    }
    deep(holidays, ["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
      "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
    "the computed NYSE calendar names every weekday holiday to the end of 2027, Saturday holidays observed on the " +
      "Friday before (Juneteenth and Christmas 2027) except New Year's Day 2028, and Sunday ones on the Monday after");
    const idle = [];
    for (const day of [...holidays, "2026-10-03", "2026-10-04", "2027-03-13", "2027-03-14"]) {
      const base = T(day + "T00:00:00Z");
      for (const s of slots) {
        for (const d of [0, 180, 300]) {
          const { r, passAt, sleeps } = await start(base + (s + d) * 60000);
          if (r.exit !== "outside-window" || r.why !== "not-trading" || passAt.length || sleeps.length) {
            idle.push(`${day} ${hhmm(s)} UTC +${d} min`);
          }
        }
      }
    }
    deep(idle, [], `WEEKENDS AND COMPUTED HOLIDAYS NEVER WAIT: every starter slot on each of those ${holidays.length} ` +
      "holidays and on four weekend days (the DST switch weekend of 2027-03-13 among them), delivered on time or 3 " +
      "or 5 h late, exits at once with no sleep and no pass");
  }
  {
    const waitMs = LIVE_LOOP.preOpenWaitMs;
    const day = "2026-09-28";
    const first = easternInstant(day, 9 * 60 + 31);
    const boards = FAKE.fakeBoards();
    let t = first - waitMs;
    let store = {};
    const readStored = async (k) => (k.startsWith("board:") ? { payload: boards[k.slice(6)] }
      : { payload: store[k] || null });
    const publish = async (k, p) => { store[k] = p; };
    const uw = FAKE.fakeLiveVendor({ now: () => (t += 250), session: day });
    const loop = async (origin, extra = {}) => {
      const real = [];
      const r = await runLiveLoop({ now: () => t, sleep: async (ms) => { t += Math.max(0, ms); }, log: () => {},
        ...extra,
        pass: async ({ first: firstPass, clock }) => {
          const at = t;
          const res = await runLive({ uw, publish, readStored, shapeNews, origin, skipRecent: firstPass, clock,
            now: () => (t += 250), log: () => {}, warn: () => {} });
          if (!res.skipped) real.push(at);
          return passOutcome(res);
        },
        chain: async ({ at }) => ({ sent: true, why: "sent", status: 204, at }) });
      return { r, real };
    };
    const one = await loop("schedule");
    const lastOne = one.real.at(-1);
    const beat = T(store["live:heartbeat"].run.finishedAt);
    ok(one.r.exit === "budget" && one.r.preOpenMs === waitMs && one.real[0] === first && one.r.chained.sent &&
       one.r.passes.every((p) => !p.skipped),
    `THE CHAIN, END TO END (runLive against the fake vendor and one store): the longest waiter passes from 09:31 ET ` +
      `and chains at ${new Date(one.r.chained.at).toISOString().slice(11, 16)} UTC`);
    const saved = JSON.parse(JSON.stringify(store));
    t = one.r.chained.at + 45000;
    const two = await loop("chain");
    ok(two.r.passes[0].skipped === "recent" && two.real[0] === lastOne + LIVE_LOOP.slotMs,
      "the chained run starts 45 s later, and its first pass reads the heartbeat the last pass wrote under eight " +
        "minutes ago and skips, so the next slot is passed once, by the new run, and none is doubled or lost");
    const expected = [first];
    for (let at = easternInstant(day, 9 * 60 + 35); at <= easternInstant(day, 16 * 60 + 25); at += LIVE_LOOP.slotMs) {
      expected.push(at);
    }
    deep([...one.real, ...two.real], expected,
      "between them the waiter and its one chain pass at 09:31 and on every slot from 09:35 to 16:25, each once");
    ok(two.r.exit === "window-closed" && !two.r.chained && !liveRunVerdict(two.r).failed,
      "the chained run ends with the session window, needing no second chain, and its skipped first pass does not " +
        "fail the job");
    t += 20000;
    const queuedAt = t;
    const queued = await loop("schedule");
    ok(liveWindow(queuedAt).run && queued.real.length === 0 && queued.r.passes.length === 1 &&
       queued.r.passes[0].skipped === "recent" && queued.r.exit === "window-closed" && !queued.r.chained,
    "A STARTER QUEUED BEHIND THE LOOP that GitHub starts 20 s after the loop ends, at " +
      `${new Date(queuedAt).toISOString().slice(11, 19)} UTC and so still inside the 16:25 window, finds the heartbeat ` +
      `${Math.round((queuedAt - T(store["live:heartbeat"].run.finishedAt)) / 1000)} s old, skips its one pass and ` +
      "exits at the next slot without reading the vendor");
    for (const late of [16 * 60 + 26, 17 * 60, 19 * 60 + 12].map((m) => easternInstant(day, m))) {
      t = late;
      const q = await loop("schedule");
      ok(q.r.exit === "outside-window" && q.r.why === "after-close" && q.r.passes.length === 0 && t === late,
        `and one that starts after the window, at ${new Date(late).toISOString().slice(11, 16)} UTC, exits at once ` +
          "without a pass or a sleep");
    }
    store = saved;
    const slowAt = beat + L.LIVE_BUDGET.tier2HeartbeatSkipMs + 1000;
    t = slowAt;
    const slow = await loop("chain", { budgetMs: 1 });
    ok(slow.r.passes.length === 1 && !slow.r.passes[0].skipped && slow.real[0] === slowAt,
      "while a chained run GitHub starts more than eight minutes after the last heartbeat passes at once");
  }
  {
    const TG = "2026-11-24";
    const verdict = easternInstant(TG, 9 * 60 + 46);
    const c = sim(easternInstant(TG, 9 * 60 + 31));
    const passAt = [];
    let reads = 0;
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {},
      readClock: async () => { reads++; return c.now() >= verdict ? { day: TG, trading: 0, earlyClose: null } : { day: TG,
        trading: null, earlyClose: null }; },
      pass: async () => { passAt.push(c.now()); c.advance(40000); return {}; },
      chain: async () => { throw new Error("never chain on a holiday"); } });
    ok(r.exit === "window-closed" && r.why === "not-trading" && passAt.every((t) => t < verdict) && passAt.length === 4 &&
       reads > passAt.length,
    "A TAPE-DERIVED CLOSURE: the loop reads the Worker's clock around every pass, and once Tier 1 has closed the day " +
      `(09:46 on an unscheduled closure) no pass follows and nothing is chained (${passAt.length} passes before the verdict)`);
    ok(r.waits > 0 && c.now() >= easternInstant(TG, L.VERDICT.provisionalUntilMin - 5) &&
       c.now() < easternInstant(TG, L.VERDICT.provisionalUntilMin),
    `and it waits without a pass until ${L.VERDICT.provisionalUntilMin / 60}:00 ET, while Tier 1 can still reopen the ` +
      `day, before it exits (${r.waits} waits)`);
    const tg = sim(easternInstant("2026-11-26", 9 * 60 + 31));
    let tgPasses = 0;
    const scheduled = await runLiveLoop({ now: tg.now, sleep: tg.sleep, log: () => {},
      readClock: async () => ({ day: "2026-11-26", trading: null, earlyClose: null }),
      pass: async () => { tgPasses++; return {}; }, chain: async () => { throw new Error("never chain on a holiday"); } });
    ok(scheduled.why === "not-trading" && tgPasses === 0,
      "while a scheduled NYSE holiday (Thanksgiving) is closed by the computed calendar before any pass, with no verdict needed");
  }
  {
    const S2 = "2026-09-24";
    const closedAt = easternInstant(S2, 10 * 60 + 1);
    const reopenAt = easternInstant(S2, 10 * 60 + 16);
    const c = sim(easternInstant(S2, 9 * 60 + 56));
    const passAt = [];
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, budgetMs: 24 * 3600 * 1000,
      readClock: async () => ({ day: S2, trading: c.now() >= closedAt && c.now() < reopenAt ? 0 : null, earlyClose: null }),
      pass: async () => { passAt.push(c.now()); c.advance(40000); return {}; },
      chain: async () => { throw new Error("no chain inside the window"); } });
    const gap = passAt.filter((t) => t >= closedAt && t < reopenAt);
    ok(r.exit === "window-closed" && r.why === "after-close" && gap.length === 0 && r.waits >= 2 &&
       passAt.includes(easternInstant(S2, 10 * 60 + 20)) && passAt.at(-1) === easternInstant(S2, 16 * 60 + 25),
    "A VERDICT REVERSED (OPS-4): the vendor lags past two probes, Tier 1 closes the day at 10:01 and its 10:16 re-probe " +
      "reopens it; the loop waits through the closed slots instead of exiting, then passes on every slot to 16:25 " +
      `(${r.waits} waits, ${passAt.length} passes)`);
    const late = sim(easternInstant(S2, 10 * 60 + 5));
    const latePasses = [];
    const lr = await runLiveLoop({ now: late.now, sleep: late.sleep, log: () => {}, budgetMs: 24 * 3600 * 1000,
      readClock: async () => ({ day: S2, trading: late.now() >= closedAt && late.now() < reopenAt ? 0 : 1, earlyClose: null }),
      pass: async () => { latePasses.push(late.now()); late.advance(40000); return {}; },
      chain: async () => { throw new Error("no chain inside the window"); } });
    ok(lr.exit === "window-closed" && latePasses[0] === easternInstant(S2, 10 * 60 + 20) && lr.waits >= 2,
      "and a starter that lands while the day is provisionally closed waits for the reopening rather than exiting");
    eq(liveWindow(easternInstant(S2, 10 * 60 + 30), { day: S2, trading: 0, earlyClose: null }).why, "provisional-closed",
      "a closed verdict before 11:00 ET is a wait");
    eq(liveWindow(easternInstant(S2, 11 * 60), { day: S2, trading: 0, earlyClose: null }).why, "not-trading",
      "and final from 11:00 ET, when Tier 1 stops re-probing");
    eq(liveWindow(T("2026-09-26T14:00:00Z"), { day: "2026-09-26", trading: 0, earlyClose: null }).why, "not-trading",
      "a weekend is never a wait");
  }
  {
    const EC = "2026-11-27";
    const c = sim(easternInstant(EC, 9 * 60 + 31));
    const passAt = [];
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {},
      readClock: async () => ({ day: EC, trading: 1, earlyClose: 1 }),
      pass: async () => { passAt.push(c.now()); c.advance(40000); return {}; },
      chain: async () => { throw new Error("never chain after an early close"); } });
    ok(r.exit === "window-closed" && r.why === "after-close" && passAt.at(-1) === easternInstant(EC, 13 * 60 + 25),
      `AN EARLY CLOSE: the last pass is at 13:25, not 16:25 (${new Date(passAt.at(-1)).toISOString()})`);
    const UC = "2026-11-20";
    const verdict = easternInstant(UC, 13 * 60 + 36);
    const d = sim(easternInstant(UC, 12 * 60));
    const late = [];
    const lr = await runLiveLoop({ now: d.now, sleep: d.sleep, log: () => {},
      readClock: async () => ({ day: UC, trading: 1, earlyClose: d.now() >= verdict ? 1 : null }),
      pass: async () => { late.push(d.now()); d.advance(40000); return {}; },
      chain: async () => { throw new Error("never chain after an early close"); } });
    ok(lr.exit === "window-closed" && lr.why === "after-close" && late.at(-1) === easternInstant(UC, 13 * 60 + 35),
      "and on an unscheduled early close, which only the tape can reveal, Tier 1 marks it at 13:36, as its 30-minute " +
        "quiet rule does, and the loop stops at the next slot " +
        `(last pass ${new Date(late.at(-1)).toISOString()})`);
  }
  {
    const c = sim(et(12 * 60));
    const TG = "2026-11-26";
    const late = sim(easternInstant(TG, 12 * 60));
    let passes = 0;
    const w = await runLiveLoop({ now: late.now, sleep: late.sleep, log: () => {}, pass: async () => { passes++; },
      readClock: async () => ({ day: TG, trading: 0, earlyClose: null }),
      chain: async () => { throw new Error("never"); } });
    ok(w.exit === "outside-window" && w.why === "not-trading" && passes === 0,
      "a starter that begins on a day the Worker has already closed exits without a pass");
    let calls = 0;
    const flaky = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, budgetMs: 24 * 3600 * 1000,
      readClock: async () => { calls++; if (calls === 2) return { day: S, trading: 1, earlyClose: 1 }; throw new Error("down"); },
      pass: async () => { c.advance(30000); return {}; }, chain: async () => { throw new Error("never"); } });
    ok(flaky.exit === "window-closed" && flaky.why === "after-close" && flaky.clock.earlyClose === 1,
      "a clock read that fails keeps the last verdict it had, so one blip never forgets an early close");
  }
  {
    const c = sim(et(15 * 60 + 50));
    const warned = [];
    let n = 0;
    const r = await runLiveLoop({ now: c.now, sleep: c.sleep, log: () => {}, warn: (l) => warned.push(l),
      pass: async () => { n++; c.advance(20000); if (n === 2) throw new Error("unexpected vendor body"); return { errored: false }; },
      chain: async () => { throw new Error("never"); } });
    ok(r.exit === "window-closed" && r.passes.length === n && n > 3 && r.passes[1].errored === true &&
       r.passes[1].threw === "unexpected vendor body" && r.passes.slice(2).every((p) => p.errored === false) &&
       warned.length === 1,
    "A PASS THAT THROWS is logged and recorded as errored, and the loop carries on: the next slots still run, so one bad " +
      "vendor body costs one pass, not the rest of the session");
  }
  {
    const at = { day: S, trading: 1, earlyClose: null };
    const asked = [];
    deep(await readLiveClock(async (key) => { asked.push(key); return { payload: { key: "clock", clock: at }, status: 200 }; }),
      at, "THE CLOCK READ is the Worker's flows_clock verdict, through the ingest route under the live credential");
    deep(asked, ["clock"], "one GET of the ingest key clock, not a signed-in page route");
    eq(await readLiveClock(async () => ({ payload: null, failed: true, status: 400 })), null,
      "a Worker that predates the key answers 400, which reads as no clock, so either deploy order works");
    eq(await readLiveClock(async () => { throw new Error("offline"); }), null,
      "and an unreachable Worker reads as no clock too (the loop then keeps its last verdict, or the weekday calendar)");
    deep([sessionClock({ clock: { day: "2026-9-1", trading: 1 } }), sessionClock({ clock: { day: S, trading: "0",
      earlyClose: 7 } })], [null, { day: S, trading: null, earlyClose: null }],
    "a malformed day is no clock, and a flag that is not exactly 0 or 1 is unknown, never a verdict");
    const rowClock = { day: S, trading: null, earlyClose: "1", tier1At: 5, closedDays: "[\"2026-09-07\"]",
      dispatchWhy: "refused:401", liveDoneAt: 9, summaryAt: 7 };
    deep(W.clockView(rowClock), { day: S, trading: null, earlyClose: 1, closedDays: ["2026-09-07"] },
      "the Worker's public view of its clock is the day, its two verdicts (NULL kept as undecided) and the closed days " +
        "the tape proved — what /api/flows/now serves and the calendar reads, with no operations string in it");
    deep(W.ingestClockView(rowClock),
      { day: S, trading: null, earlyClose: 1, closedDays: ["2026-09-07"], tier1: { at: new Date(5).toISOString(), okAt: null,
        why: null }, dispatchWhy: "refused:401", summaryAt: new Date(7).toISOString() },
      "and the ingest clock key, behind the pipeline's credential, adds the Tier 1 telemetry, the last dispatch " +
        "outcome and the summary cron's last completed firing, which the nightly health gate reads");
    const liveSrc = read("shared/flows-live-worker.js");
    ok(/const body = \{ key: "clock", clock: ingestClockView\(clock\) \};/.test(liveSrc) && /\n    clock: clockView\(clock\),\n/.test(liveSrc),
      "serveIngestClock serves the operations view and serveNow the public one");
    const ingestSrc = read("worker.js");
    ok(/if \(key === "clock"\) \{\s*requireMethod\(request, \["GET"\]\);\s*await ensureFlowsTables\(env\);\s*return FLOWS_LIVE\.serveIngestClock\(env, \{ json, lab: tokenKind === "nightly" \}\);/
      .test(ingestSrc) && ingestSrc.indexOf('if (key === "clock")') > ingestSrc.indexOf('if (!tokenKind) throw new HttpError(401'),
    "the ingest route serves the clock to a verified credential only, and to GET only");
    eq(resetPublishRetryBudget(), 0, "the publish retry budget can be reset, and a fresh process has spent none of it");
  }
  {
    const sent = [];
    const fetchImpl = async (url, init) => { sent.push({ url, init }); return { status: 204 }; };
    const at = et(15 * 60 + 11);
    const r = await chainDispatch({ env: { GITHUB_TOKEN: "ghs_run_token", GITHUB_REPOSITORY: "anilkaya001/anilkaya.org" },
      fetchImpl, at });
    ok(r.sent && sent.length === 1, "THE CHAIN DISPATCH is one request");
    eq(sent[0].url, "https://api.github.com/repos/anilkaya001/anilkaya.org/actions/workflows/flows-live.yml/dispatches",
      "to this repository's live workflow");
    ok(sent[0].init.method === "POST" && sent[0].init.headers.Authorization === "Bearer ghs_run_token" &&
       sent[0].init.headers.Accept === "application/vnd.github+json",
    "authenticated with the run's own GITHUB_TOKEN (workflow_dispatch is the documented exception to its no-recursion rule)");
    deep(JSON.parse(sent[0].init.body), { ref: "main", inputs: { tick: new Date(at).toISOString(), origin: "chain" } },
      "on main, saying the chain sent it");
    deep(await chainDispatch({ env: { GITHUB_REPOSITORY: "a/b" }, fetchImpl }), { sent: false, why: "no-token" },
      "without a token it sends nothing");
    eq((await chainDispatch({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "a/b", GITHUB_API_URL: "https://evil.example" },
      fetchImpl })).why, "bad-base", "and never to a host other than the GitHub API");
    eq((await chainDispatch({ env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "a/b" },
      fetchImpl: async () => ({ status: 403 }) })).why, "refused", "a refused dispatch is reported, not thrown");
  }
  const pipeline = read("scripts/flows-pipeline.mjs");
  ok(/pass: async \(\{ first, clock \}\) => \{\s*resetPublishRetryBudget\(\);/.test(pipeline),
    "EACH PASS HAS ITS OWN RETRY BUDGET: the loop resets the 90 s publish/read retry budget at the start of every " +
      "pass, as each separate run had, so a blip at 10:00 cannot leave the 15:00 pass with no retries");
  ok(/readClock = \(\) => readLiveClock\(readStoredOnce\)/.test(pipeline) && /runLiveLoop\(\{\s*readClock,/.test(pipeline) &&
     /const clock = force \? null : await readClock\(\);/.test(pipeline),
  "and --live gates both the loop and a single pass on the Worker's clock");
  ok(/runLive\(\{ uw, publish, readStored, shapeNews, origin, skipRecent: first, clock \}\)/.test(pipeline) &&
     /chainDispatch\(\{ env: process\.env, at \}\)/.test(pipeline) && /process\.env\.FLOWS_LIVE_LOOP !== "1"/.test(pipeline),
  "--live runs the loop when the workflow asks for it, each pass after the first ignoring the heartbeat skip");
}

{
  const T0 = "2026-11-23";
  const closed = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10));
  deep(L.parseClosedDays(JSON.stringify(["2026-11-26", "2026-07-03", "junk", 7, "2026-11-26"])), ["2026-07-03", "2026-11-26"],
    "CLOSED DAYS are a JSON array of ISO days, read back sorted, once each, junk dropped");
  deep([L.parseClosedDays(null), L.parseClosedDays("{not json"), L.parseClosedDays({})], [[], [], []],
    "and an absent or unreadable column is no closed day, never an error");
  const ring = L.withClosedDay(closed(25), "2026-11-26");
  ok(ring.length === L.VERDICT.closedDaysMax && ring.at(-1) === "2026-11-26" && ring[0] === closed(25)[6],
    `at most ${L.VERDICT.closedDaysMax} are kept, newest last`);
  const at = easternInstant("2026-11-24", 9 * 60 + 46);
  deep(L.verdictPatch({ seen: 0, trading: null, closedProbeAt: null, closedDays: [T0], at, today: "2026-11-24" }),
    { closedProbeAt: at }, "A FIRST CLOSED PROBE IS PROVISIONAL: it records when it was seen and leaves trading NULL");
  deep(L.verdictPatch({ seen: 0, trading: null, closedProbeAt: at, closedDays: [], at: at + 10 * 60000, today: "2026-11-24" }),
    {}, "a second one ten minutes later is not yet agreement");
  deep(L.verdictPatch({ seen: 0, trading: null, closedProbeAt: at, closedDays: [T0], at: at + 15 * 60000, today: "2026-11-24" }),
    { trading: 0, closedDays: [T0, "2026-11-24"] },
  "two agreeing probes at least fifteen minutes apart are final: trading = 0, and the day joins closed_days");
  deep(L.verdictPatch({ seen: 1, trading: null, closedProbeAt: at, closedDays: [], at: at + 5 * 60000, today: "2026-11-24" }),
    { trading: 1, closedProbeAt: null }, "ANY feed carrying today settles it at once: trading = 1, the provisional mark cleared");
  deep(L.verdictPatch({ seen: 1, trading: 0, closedProbeAt: at, closedDays: [T0, "2026-11-24"], at: at + 30 * 60000,
    today: "2026-11-24" }), { trading: 1, closedProbeAt: null, closedDays: [T0] },
  "and a final 0 that a later re-probe contradicts is reversed, today leaving closed_days");
  deep(L.verdictPatch({ seen: null, trading: null, closedProbeAt: null, closedDays: [], at, today: "2026-11-24" }), {},
    "no verdict is no change");
  deep(L.verdictPatch({ seen: 0, trading: null, closedProbeAt: null, closedDays: [T0], at: easternInstant("2026-11-26", 9 * 60 + 46),
    today: "2026-11-26" }), { trading: 0, closedProbeAt: null },
  "ON A COMPUTED HOLIDAY ONE CLOSED PROBE IS FINAL: the tape agrees with the calendar, so there is nothing for a second " +
    "probe to overturn, and the probe window ends before one could run; the day stays out of closed_days, which holds " +
    "only the closures the calendar did not know");

  const thread = async (row, ticks) => {
    const log = [];
    for (const { m, day, feeds, calls = null } of ticks) {
      const tickAt = easternInstant(day, m);
      const bodies = await tier1Bodies({ session: feeds, at: tickAt });
      let n = 0;
      const db = tickDb();
      const batch = db.batch;
      db.batch = async (list) => {
        const res = await batch(list);
        if (/SELECT \* FROM flows_clock/.test(list[0].sql)) res[0] = { results: [{ ...row }] };
        return res;
      };
      const out = await W.rthTick({ DB: db, UW_API_KEY: "k" }, tickAt,
        { fetchVendor: async (path) => { n++; return JSON.parse(bodies[path]); }, log: { error() {} } });
      for (const st of db.statements.filter((x) => /INSERT INTO flows_clock/.test(x.sql))) {
        const cols = /\(([^)]*)\) VALUES/.exec(st.sql)[1].split(", ");
        cols.forEach((c, j) => { row[c] = st.args[j]; });
      }
      const wrote = db.statements.some((x) => /INSERT INTO flows_live/.test(x.sql));
      log.push({ m, why: out.why || out.skipped, calls: n, wrote, trading: row.trading });
      if (calls !== null) eq(n, calls, `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} spends ${calls} vendor call(s)`);
    }
    return log;
  };
  const S = "2026-09-24";
  const Y = "2026-09-23";
  const lag = { id: 1, day: Y, trading: 1, early_close: 0, closed_days: JSON.stringify(["2026-09-07"]) };
  const lagLog = await thread(lag, [
    { m: 9 * 60 + 31, day: S, feeds: Y }, { m: 9 * 60 + 46, day: S, feeds: Y }, { m: 9 * 60 + 51, day: S, feeds: S },
    { m: 9 * 60 + 56, day: S, feeds: S },
  ]);
  ok(lag.day === S && lag.trading === 1 && lag.closed_probe_at === null && JSON.parse(lag.closed_days).join() === "2026-09-07" &&
     lagLog.every((t) => t.wrote),
  "THE LAGGING VENDOR (OPS-4): at 09:46 both Tier 1 feeds still carry 09-23 and at 09:51 they carry 09-24 — the day " +
    "ends trading = 1, nothing joined closed_days, and every tick wrote live:market " +
    `(${lagLog.map((t) => `${Math.floor(t.m / 60)}:${String(t.m % 60).padStart(2, "0")} ${t.why} ${t.trading}`).join(", ")})`);
  eq(lagLog[1].trading, null, "the 09:46 closed probe alone never closed the day");

  const TG = "2026-11-24";
  const hol = { id: 1, day: T0, trading: 1, early_close: 0, closed_days: null };
  const holLog = await thread(hol, [
    { m: 9 * 60 + 46, day: TG, feeds: T0 }, { m: 9 * 60 + 51, day: TG, feeds: T0 }, { m: 9 * 60 + 56, day: TG, feeds: T0 },
    { m: 10 * 60 + 1, day: TG, feeds: T0 }, { m: 10 * 60 + 6, day: TG, feeds: T0, calls: 0 },
    { m: 10 * 60 + 16, day: TG, feeds: T0, calls: 2 }, { m: 10 * 60 + 21, day: TG, feeds: T0, calls: 0 },
    { m: 11 * 60 + 1, day: TG, feeds: T0, calls: 0 },
  ]);
  deep(holLog.slice(0, 4).map((t) => t.trading), [null, null, null, 0],
    "AN UNSCHEDULED CLOSURE (a day the calendar thought traded): the 09:46 probe is provisional, 09:51 and 09:56 are too close to it to agree, and at 10:01 the " +
      "second agreeing probe fifteen minutes on makes it final");
  deep(JSON.parse(hol.closed_days), [TG], "and only then does the day join closed_days");
  ok(holLog[4].why === "holiday" && holLog[5].why === "holiday" && !holLog[5].wrote && holLog[6].why === "holiday" &&
     holLog[7].why === "holiday",
  "after it, ticks skip with no vendor call, except a re-probe every third tick until 11:00 (two calls, no write)");

  const late = { id: 1, day: T0, trading: 1, early_close: 0, closed_days: null };
  const lateLog = await thread(late, [
    { m: 9 * 60 + 46, day: S, feeds: Y }, { m: 10 * 60 + 1, day: S, feeds: Y },
    { m: 10 * 60 + 16, day: S, feeds: S, calls: 2 }, { m: 10 * 60 + 21, day: S, feeds: S },
  ]);
  ok(lateLog[1].trading === 0 && lateLog[2].trading === 1 && lateLog[2].wrote && lateLog[3].wrote &&
     JSON.parse(late.closed_days).length === 0,
  "A VENDOR LATE BY HALF AN HOUR: closed at 10:01, the 10:16 re-probe sees today, reopens the day, writes live:market " +
    "and takes the day back out of closed_days");

  const roll = { id: 1, day: TG, trading: 0, early_close: 0, closed_days: JSON.stringify([TG]) };
  await thread(roll, [{ m: 9 * 60 + 31, day: "2026-11-25", feeds: "2026-11-25" }]);
  ok(roll.day === "2026-11-25" && roll.trading === null && JSON.parse(roll.closed_days).join() === TG,
    "the next morning's roll resets the day's verdict and keeps closed_days, which stream E's calendar reads");

  deep([W.dispatchOutcome({ sent: false, why: "no-token" }), W.dispatchOutcome({ sent: true, status: 204, why: "sent" }),
    W.dispatchOutcome({ sent: false, status: 401, why: "refused" }), W.dispatchOutcome({ sent: false, why: "unreachable" })],
  ["no-token", "sent", "refused:401", "unreachable"],
  "EVERY DISPATCH OUTCOME is recorded in flows_clock.dispatch_why, no-token included, so an expired token turns " +
    "the nightly health gate red and a token the owner removed clears the old refusal instead of alerting forever");
  {
    const db = tickDb();
    db.batch = async () => [{ results: [{ id: 1, day: "2026-09-24", trading: 1, dispatch_why: "refused:401" }] },
      { results: [{ session: "2026-09-23" }] }];
    const r = await W.nightlyTick({ DB: db }, easternInstant("2026-09-24", 19 * 60), { log: { error() {} } });
    const patch = db.statements.find((w) => /INSERT INTO flows_clock/.test(w.sql));
    ok(r.due && r.sent.why === "no-token" && patch && /dispatch_why/.test(patch.sql) && patch.args.includes("no-token"),
      "a due nightly dispatch with no token overwrites a stale refused:401 with no-token");
  }

  const clockRow = { id: 1, day: S, trading: 1, early_close: 0 };
  const stallDb = () => {
    const db = tickDb();
    db.batch = async (list) => {
      db.statements.push(...list);
      if (/SELECT \* FROM flows_clock/.test(list[0].sql)) {
        return [{ results: [clockRow] }, { results: [{ read_at: easternInstant(S, 10 * 60 + 10) }] }];
      }
      return list.map(() => ({ results: [] }));
    };
    return db;
  };
  const bodies = await tier1Bodies({ session: S, at: easternInstant(S, 11 * 60 + 1) });
  const errors = [];
  const sent = [];
  const stall = await W.rthTick({ DB: stallDb(), UW_API_KEY: "k" }, easternInstant(S, 11 * 60 + 6),
    { fetchVendor: async (p) => JSON.parse(bodies[p]), fetchImpl: async (u) => { sent.push(u); return { status: 204 }; },
      log: { error: (l) => errors.push(JSON.parse(l)) } });
  ok(stall.watchdog && stall.watchdog.stalled && stall.watchdog.redispatch === null && sent.length === 0 &&
     errors.some((e) => e.message === "live layer stalled" && e.ageMin === 56 && e.canDispatch === false),
  "THE STALL IS LOGGED WITHOUT THE TOKEN: live:breadth 56 minutes old at 11:06 logs 'live layer stalled' " +
    "(canDispatch false) even though no watchdog dispatch can be sent");

  const nightlyAt = (h, m) => easternInstant(S, h * 60 + m);
  const missing = async (at) => {
    const said = [];
    const db = tickDb();
    db.batch = async () => [{ results: [{ id: 1, day: S, trading: 1 }] }, { results: [{ session: Y }] }];
    await W.nightlyTick({ DB: db }, at, { log: { error: (l) => said.push(JSON.parse(l).message) } });
    return said.includes("nightly missing");
  };
  deep([await missing(nightlyAt(19, 0)), await missing(nightlyAt(20, 30)), await missing(nightlyAt(21, 0))],
    [false, false, true],
  `NIGHTLY MISSING at close + ${W.NIGHTLY_MISSING_AFTER_MIN} min (21:00 ET): the scheduled nightly lands about ` +
    "20:00 ET, so the old close + 180 fired falsely every weekday evening");
}

{
  const beat = (session, run) => ({ payload: { v: 1, key: "live:heartbeat", session, run }, status: 200 });
  const S = "2026-09-24";
  const at = (h, m) => easternInstant(S, h * 60 + m);
  const good = {
    sessionDate: S, now: at(20, 5),
    clockRead: { payload: { key: "clock", clock: { day: S, trading: 1, earlyClose: null, closedDays: [],
      tier1: { at: new Date(at(17, 56)).toISOString(), okAt: new Date(at(16, 6)).toISOString(), why: "written" },
      dispatchWhy: null, summaryAt: new Date(at(19, 45)).toISOString() } }, status: 200 },
    marketRead: { payload: { fresh: { readAt: new Date(at(16, 6)).toISOString() } }, status: 200 },
    focusRead: { payload: { key: "live:focus", fresh: { readAt: new Date(at(16, 8)).toISOString() } }, status: 200 },
    heartbeatRead: beat(S, { calls: 39, failedCalls: 0, finishedAt: new Date(at(16, 21)).toISOString() }),
    edge403: 11, retrySpentMs: 6000,
  };
  const H = healthChecks(good);
  ok(H.applies && H.failures.length === 0 && /11 ingest answer\(s\) of HTTP 403/.test(H.notes[0]),
    "THE HEALTH GATE passes a healthy session: Tier 1 wrote through 16:06, the focus cron through 16:08, the last " +
      "Tier 2 pass finished 16:21 and the edge refused eleven ingest requests (the 2026-09-24 count), all absorbed by " +
      "retries");
  const fails = (over) => healthChecks({ ...good, ...over }).failures;
  deep(fails({ heartbeatRead: beat("2026-09-23", { calls: 39, failedCalls: 0, finishedAt: new Date(at(16, 21)).toISOString() }) }),
    [`HEALTH: no live pass for ${S}: the last Tier 2 pass was for ${"2026-09-23"}`], "no Tier 2 pass today is one line");
  deep(fails({ heartbeatRead: { payload: null, absent: true, status: 200 } }),
    [`HEALTH: no live pass for ${S}: live:heartbeat is absent`], "and so is a heartbeat that was never written");
  deep(fails({ heartbeatRead: beat(S, { calls: 39, failedCalls: 39, finishedAt: new Date(at(12, 3)).toISOString() }) }),
    [`HEALTH: the last live pass for ${S} answered no vendor call (39 of 39 failed)`,
      `HEALTH: the last live pass for ${S} finished at 12:03 ET, so Tier 2 stopped before the close`],
  "a dead last pass and a loop that stopped at noon each say so");
  deep(fails({ marketRead: { payload: { fresh: { readAt: new Date(at(9, 31)).toISOString() } }, status: 200 } }),
    ["HEALTH: Tier 1 last wrote live:market at 09:31 ET, not by 15:50 ET"], "a Tier 1 that died after the open");
  eq(HEALTH.focusCron, W.FOCUS_CRON, "the gate names the focus cron the Worker registers, character for character");
  deep(fails({ focusRead: { payload: null, absent: true, status: 200 } }),
    ["HEALTH: live:focus has never been written (is 3-58/5 13-21 * * MON-FRI registered? wrangler triggers deploy)"],
  "LIVE:FOCUS NEVER WRITTEN fails the gate and names the cron to register: a deploy that left the previous triggers " +
    "runs Tier 1 and housekeeping and never the focus tick, and nothing else would say so");
  deep(fails({ focusRead: { payload: { fresh: { readAt: new Date(at(9, 38)).toISOString() } }, status: 200 } }),
    ["HEALTH: the focus cron last wrote live:focus at 09:38 ET, not by 15:50 ET (is 3-58/5 13-21 * * MON-FRI " +
      "registered? its \"live:focus not written\" log lines say why a read was kept)"],
  "a focus cron that stopped writing after the open fails it too");
  deep(fails({ focusRead: { payload: { fresh: { readAt: new Date(easternInstant("2026-09-23", 16 * 60 + 8)).toISOString() } },
    status: 200 } }), ["HEALTH: the focus cron last wrote live:focus at 2026-09-23 16:08 ET, not by 15:50 ET (is " +
      "3-58/5 13-21 * * MON-FRI registered? its \"live:focus not written\" log lines say why a read was kept)"],
  "and so does a row held from an earlier session, dated so");
  deep(fails({ focusRead: { payload: null, failed: true, status: 403 } }), ["HEALTH: live:focus could not be read (HTTP 403)"],
    "an unreadable live:focus is its own failure");
  deep(fails({ focusRead: { payload: { fresh: { readAt: new Date(at(15, 58)).toISOString() } }, status: 200 } }), [],
    "while the last read before the close (15:58) passes: the focus cron's last minutes are 15:58, 16:03 and 16:08");
  const clockWith = (over) => ({ payload: { key: "clock", clock: { ...good.clockRead.payload.clock, ...over } }, status: 200 });
  eq(HEALTH.summaryCron, W.SUMMARY_CRON, "the gate names the summary cron the Worker registers, character for character");
  deep(fails({ clockRead: clockWith({ summaryAt: null }) }),
    ["HEALTH: the summary cron has never completed a firing (is 15,45 * * * * registered? wrangler triggers deploy)"],
  "A SUMMARY CRON THAT NEVER FIRED fails the gate and names the cron to register: the board summary moved off the " +
    "housekeeping firing onto 15,45 * * * *, so a deploy that leaves the previous trigger set runs housekeeping every " +
    "half hour and never refreshes the summary, and until this line nothing said so");
  deep(fails({ clockRead: clockWith({ summaryAt: new Date(at(18, 49)).toISOString() }) }),
    ["HEALTH: the summary cron last completed a firing at 18:49 ET, more than 75 minutes before this check (is 15,45 * * * * " +
      "registered? if it is, its firings are dying: the Worker's logs say)"],
  "and one whose last completed firing is 76 minutes old fails it too: on a 30-minute cadence that is two firings " +
    "lost in a row, so the summary is no longer refreshing");
  deep(fails({ clockRead: clockWith({ summaryAt: new Date(at(18, 50)).toISOString() }) }), [],
    "while 75 minutes passes: one firing killed at the cap is retried by the next and is not a failure");
  deep(fails({ clockRead: clockWith({ summaryAt: new Date(easternInstant("2026-09-23", 19 * 60 + 45)).toISOString() }) }),
    ["HEALTH: the summary cron last completed a firing at 2026-09-23 19:45 ET, more than 75 minutes before this check (is " +
      "15,45 * * * * registered? if it is, its firings are dying: the Worker's logs say)"],
  "a stamp from an earlier day is dated so");
  {
    const { summaryAt, ...older } = good.clockRead.payload.clock;
    const H = healthChecks({ ...good, clockRead: { payload: { key: "clock", clock: older }, status: 200 } });
    ok(summaryAt && H.failures.length === 0 &&
       H.notes.includes("the Worker's clock carries no summary telemetry (a Worker older than this check)"),
      "and a clock with no summaryAt field at all (a Worker older than this check) is a note, not a failure");
  }
  const offNoSummary = healthChecks({ ...good, clockRead: clockWith({ summaryAt: null, tier1: { at: null, okAt: null, why: "off" } }),
    heartbeatRead: { payload: null, absent: true }, focusRead: { payload: null, absent: true } });
  ok(offNoSummary.why === "live-off" && offNoSummary.failures.length === 1 && /summary cron has never/.test(offNoSummary.failures[0]),
    "and the summary check runs before the live-off return: FLOWS_LIVE_MODE off stops Tier 1, the focus tick and the " +
    "dispatch, never the summary cron, so a missing summary cron is reported under the rollback too");
  deep(fails({ clockRead: clockWith({ tier1: { ...good.clockRead.payload.clock.tier1, why: "error:no-key" } }) }),
    ["HEALTH: Tier 1's last tick failed with error:no-key: the Worker has no UW_API_KEY secret (wrangler secret put UW_API_KEY)"],
  "tier1_why error:no-key names the missing Worker secret");
  deep(fails({ clockRead: clockWith({ trading: 0 }) }),
    [`HEALTH: Tier 1 closed ${S} as a holiday, but the vendor printed a ${S} session`],
  "a false holiday verdict is caught the same evening, against the session the nightly just ranked");
  deep(fails({ clockRead: clockWith({ day: "2026-09-23", tier1: { at: new Date(easternInstant("2026-09-23", 21 * 60)).toISOString(),
    okAt: null, why: "written" } }) }), [`HEALTH: Tier 1 never ticked on ${S}: the Worker's clock still holds ${"2026-09-23"}`],
    "a Worker cron that never ran today");
  deep(fails({ clockRead: clockWith({ day: "2026-09-23" }) }),
    [`HEALTH: Tier 1 ticked through 17:56 ET but never read the ${S} session: the Worker's clock still holds 2026-09-23`],
    "and one that ticked all day without ever reading the vendor says that instead");
  deep(fails({ clockRead: clockWith({ dispatchWhy: "refused:401" }) }),
    ["HEALTH: GitHub refused the Worker's dispatch (refused:401): renew GITHUB_DISPATCH_TOKEN"], "an expired dispatch token");
  deep(["refused:403", "refused:404", "refused:422", "refused:409"].map((w) => fails({ clockRead: clockWith({ dispatchWhy: w }) })),
    [[`HEALTH: GitHub refused the Worker's dispatch (refused:403): ${"give GITHUB_DISPATCH_TOKEN Actions read and write on this repository, or renew it"}`],
      ["HEALTH: GitHub refused the Worker's dispatch (refused:404): GITHUB_DISPATCH_TOKEN cannot see this repository or its " +
        "workflow: scope it to this repository (DEPLOY.md 10.0)"],
      ["HEALTH: GitHub refused the Worker's dispatch (refused:422): GitHub rejected the ref or the inputs: check " +
        "FLOWS_LIVE_REF and the workflow's inputs on main"],
      ["HEALTH: GitHub refused the Worker's dispatch (refused:409): check GITHUB_DISPATCH_TOKEN and the workflow (DEPLOY.md 10.0)"]],
  "EVERY 4xx REFUSAL fails the gate, each with its own remedy: a token scoped to the wrong repository (404) or a bad " +
    "ref (422) is as dead as an expired one");
  deep(["no-token", "sent", "unreachable"].map((w) => fails({ clockRead: clockWith({ dispatchWhy: w }) }).length), [0, 0, 0],
    "while no token, a sent dispatch or one unreachable blip is not a token failure");
  deep(fails({ edge403: 30 }), ["HEALTH: the edge answered 30 ingest request(s) with HTTP 403 and retries spent 6 s of the " +
    "90 s budget: add the WAF skip rule for /api/flows/ingest (DEPLOY.md 10.0 item 3)"], "and an edge refusing ingest more than twice the worst night");
  deep(fails({ clockRead: { payload: null, failed: true, status: 403 } }), ["HEALTH: the Worker's clock could not be read (HTTP 403)"],
    "an unreadable clock is itself a failure");
  {
    const answer = async (headers, body) => {
      const res = new Response(body, { status: 403, headers });
      return refusalOf({ headers: res.headers, text: await res.text() });
    };
    const CHALLENGE_PAGE = "<!DOCTYPE html><html lang=\"en-US\"><head><title>Just a moment...</title></head><body>" +
      "<script>(function(){window._cf_chl_opt={cvId: '3',cZone: 'anilkaya.org',cType: 'managed'};}());</script></body></html>";
    const BLOCK_PAGE = "<!DOCTYPE html><title>Attention Required! | Cloudflare</title><div id=\"cf-error-details\">" +
      "<h1>Sorry, you have been blocked</h1><span class=\"cf-error-code\">1010</span></div>";
    const WORKER_403 = JSON.stringify({ error: { code: "nightly_token_scope", message: "The nightly token cannot write live:* keys" } });
    const kinds = {
      challenge: await answer({ "cf-mitigated": "challenge", server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c5d-IAD",
        "content-type": "text/html; charset=UTF-8" }, CHALLENGE_PAGE),
      pageOnly: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c5e-IAD", "content-type": "text/html" }, CHALLENGE_PAGE),
      waf: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c60-ORD", "content-type": "text/plain; charset=UTF-8" },
        "error code: 1020"),
      bic: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c61-DFW", "content-type": "text/html" }, BLOCK_PAGE),
      banned: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c62-SEA" }, "error code: 1006"),
      mitigatedBlock: await answer({ "cf-mitigated": "block", server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c63-IAD" }, ""),
      worker: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c64-IAD", "content-type": "application/json" }, WORKER_403),
      workerShapedChallenge: await answer({ "cf-mitigated": "challenge", server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c65-IAD",
        "content-type": "application/json" }, WORKER_403),
      bare: await answer({ server: "cloudflare", "cf-ray": "8c9d0e1f2a3b4c66-SJC", "content-type": "application/json" }, "{}"),
      proxy: await answer({ server: "squid/5.9", "content-type": "text/html" }, "<h1>Forbidden</h1>"),
      hostile: await answer({ server: "::add-mask::x", "cf-ray": "::set-env name=A::b", "cf-mitigated": "::warning::" }, ""),
    };
    deep(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, [v.kind, v.code]])), {
      challenge: ["challenge", null], pageOnly: ["challenge", null], waf: ["block", "1020"], bic: ["block", "1010"],
      banned: ["block", "1006"], mitigatedBlock: ["block", null], worker: ["worker", "nightly_token_scope"],
      workerShapedChallenge: ["challenge", null], bare: ["unmarked", null], proxy: ["unmarked", null], hostile: ["block", null],
    },
    "EDGE 403s BY KIND, read from the answer itself since nobody can see Security Events: cf-mitigated: challenge or a " +
      "challenge page is a challenge; a Cloudflare error code (1020 a WAF rule, 1010 Browser Integrity Check, 1006 an " +
      "IP ban) or another cf-mitigated value is a block; the Worker's own JSON error is the Worker's, never the edge's, " +
      "unless Cloudflare marked the answer; a 403 with neither is unmarked");
    deep([kinds.challenge.ray, kinds.challenge.server, kinds.challenge.mitigated, kinds.challenge.type, kinds.proxy.ray,
      kinds.proxy.server], ["8c9d0e1f2a3b4c5d-IAD", "cloudflare", "challenge", "text/html", null, "squid/5.9"],
    "and it keeps what identifies the blocker: cf-mitigated, server, cf-ray and the content type");
    ok(!/::/.test(JSON.stringify(kinds.hostile)) && kinds.hostile.ray === "set-envnameAb",
      "every header it keeps is cut to a safe alphabet, so a hostile answer cannot smuggle a workflow command into the log");

    const tally = refusalTally();
    for (let i = 0; i < 20; i++) tallyRefusal(tally, i % 2 ? kinds.challenge : { ...kinds.challenge, ray: `8c9d0e1f2a3b${i}-IAD` });
    tallyRefusal(tally, kinds.waf);
    tallyRefusal(tally, kinds.waf);
    tallyRefusal(tally, kinds.worker);
    deep([tally.count, Object.keys(tally.kinds), tally.kinds.challenge.n, tally.kinds.challenge.rays.length, tally.worker],
      [22, ["challenge", "block 1020"], 20, 3, { nightly_token_scope: 1 }],
    "the tally counts edge 403s by kind with up to three Ray IDs each, and keeps the Worker's own 403s out of the count");
    const night = healthChecks({ ...good, edge403: tally.count, edgeKinds: tally.kinds, worker403: tally.worker });
    ok(night.failures.length === 0 && night.notes[0].startsWith("edge: 22 ingest answer(s) of HTTP 403 [challenge 20 (cf-ray ") &&
       /; block 1020 2 \(cf-ray 8c9d0e1f2a3b4c60-ORD\)\], 6\.0 s of retry budget spent; not counted: 1 JSON 403\(s\) from the Worker itself \(nightly_token_scope 1\)/
         .test(night.notes[0]),
    "THE EDGE LINE SUMMARISES BY KIND: under the threshold it is a note, naming each kind, its count and its Ray IDs, " +
      "with the Worker's own 403s named apart and not counted");
    const worst = refusalTally();
    for (let i = 0; i < 24; i++) tallyRefusal(worst, kinds.challenge);
    const red = healthChecks({ ...good, edge403: worst.count, edgeKinds: worst.kinds, retrySpentMs: 40000 }).failures;
    eq(red[0], "HEALTH: the edge answered 24 ingest request(s) with HTTP 403 and retries spent 40 s of the 90 s budget",
      "at 24 edge 403s the gate turns red with the count");
    ok(red.length === 2 && /^HEALTH: 24 were Cloudflare challenges \(cf-mitigated: challenge; Ray ID 8c9d0e1f2a3b4c5d-IAD\)/.test(red[1]) &&
       /Skip rule for \/api\/flows\/ingest in DEPLOY\.md 10\.0 item 3, with Security Level and Browser Integrity Check ticked/.test(red[1]) &&
       /Bot Fight Mode, which the Free plan cannot skip: turn it off \(Security → Settings → Bot traffic\)$/.test(red[1]),
    "and a CHALLENGE names its remedy: the Skip rule (item 3) with Security Level ticked, and Bot Fight Mode off if " +
      "challenges outlive the rule, because the Free plan cannot skip it");
    const remedyOf = (seen, n = 24) => {
      const t = refusalTally();
      for (let i = 0; i < n; i++) tallyRefusal(t, seen);
      return healthChecks({ ...good, edge403: t.count, edgeKinds: t.kinds }).failures[1];
    };
    ok(/^HEALTH: 24 were Cloudflare blocks \(error 1020; Ray ID 8c9d0e1f2a3b4c60-ORD\): a WAF custom rule blocks the route: the Skip rule .* item 3, placed above that rule/
      .test(remedyOf(kinds.waf)), "a 1020 block names the WAF custom rule and the Skip rule placed above it");
    ok(/^HEALTH: 24 were Cloudflare blocks \(error 1010; .*Browser Integrity Check blocks the route: tick Browser Integrity Check in the Skip rule/
      .test(remedyOf(kinds.bic)), "a 1010 block names Browser Integrity Check");
    ok(/error 1006; .*an IP Access rule bans the runner's address, network or country: remove it \(Security → WAF → Tools\)/
      .test(remedyOf(kinds.banned)), "an IP ban names the IP Access rule");
    ok(/no error code, cf-mitigated: block; .*find the Ray ID in Security → Events/.test(remedyOf(kinds.mitigatedBlock)),
      "an unnumbered block sends the owner to the Ray ID");
    ok(/^HEALTH: 24 were Cloudflare challenges \(a challenge page, no cf-mitigated; Ray ID 8c9d0e1f2a3b4c5e-IAD\), which Bot Fight Mode/
      .test(remedyOf(kinds.pageOnly)) && !/cf-mitigated: challenge/.test(remedyOf(kinds.pageOnly)),
    "a challenge known only from its page says so, and never claims a cf-mitigated header Cloudflare did not send");
    {
      const mixed = refusalTally();
      tallyRefusal(mixed, kinds.pageOnly);
      for (let i = 0; i < 23; i++) tallyRefusal(mixed, kinds.challenge);
      ok(/^HEALTH: 24 were Cloudflare challenges \(cf-mitigated: challenge; Ray ID 8c9d0e1f2a3b4c5e-IAD, 8c9d0e1f2a3b4c5d-IAD\)/
        .test(healthChecks({ ...good, edge403: mixed.count, edgeKinds: mixed.kinds }).failures[1]),
      "and once any challenge in the run carried the header, the line names it");
    }
    ok(/^HEALTH: 24 were 403s with neither a Cloudflare mitigation marker nor the Worker's JSON error \(server cloudflare; Ray ID/
      .test(remedyOf(kinds.bare)), "an unmarked 403 that passed Cloudflare says so, with its Ray ID");
    ok(/^HEALTH: 24 were 403s with no cf-ray \(server squid\/5\.9\), so never through Cloudflare/.test(remedyOf(kinds.proxy)),
      "and one with no cf-ray never reached the edge, so no Cloudflare setting is blamed for it");
    const own = refusalTally();
    for (let i = 0; i < 40; i++) tallyRefusal(own, kinds.worker);
    deep(healthChecks({ ...good, edge403: own.count, edgeKinds: own.kinds, worker403: own.worker }).failures, [],
      "FORTY OF THE WORKER'S OWN 403s are not the edge: they never count toward the threshold");
    deep(fails({ edge403: 0, retrySpentMs: HEALTH.retrySpentMs }), ["HEALTH: ingest retries spent 60 s of the 90 s budget with " +
      "no edge 403: the ingest lines above name each answer; a 429 or 408 with a cf-ray is a Cloudflare rate limiting " +
      "rule or an edge timeout (the Skip rule for /api/flows/ingest in DEPLOY.md 10.0 item 3), and a 5xx or no answer is " +
      "the Worker or D1 failing"],
    "a retry budget spent with no 403 and no answer on record names both causes, and blames neither alone");

    const statusAnswer = (status, headers = {}) => new Response(status === 204 ? null : "", { status, headers });
    const EDGE = { server: "cloudflare" };
    const spentOn = (answers, over = {}) => {
      const t = refusalTally();
      for (const a of answers) tallyAnswer(t, a);
      return { t, v: healthChecks({ ...good, edge403: t.count, edgeKinds: t.kinds, edgeStatuses: t.statuses,
        retrySpentMs: HEALTH.retrySpentMs + 1000, ...over }) };
    };
    const rated = spentOn(Array.from({ length: 6 }, (_, i) => statusAnswer(429, { ...EDGE, "cf-ray": `9a0b1c2d3e4f5a6${i}-IAD` })));
    deep(rated.v.failures, ["HEALTH: ingest retries spent 61 s of the 90 s budget with no edge 403",
      "HEALTH: 6 were HTTP 429s through Cloudflare (Ray ID 9a0b1c2d3e4f5a60-IAD, 9a0b1c2d3e4f5a61-IAD, 9a0b1c2d3e4f5a62-IAD): " +
        "the Worker never answers the ingest route with 429, so a Cloudflare rate limiting rule refused the runner: the " +
        "Skip rule for /api/flows/ingest in DEPLOY.md 10.0 item 3 skips rate limiting rules"],
    "A BUDGET SPENT ON 429s WITH A cf-ray is a Cloudflare rate limiting rule, since the Worker never answers ingest with " +
      "429, and its remedy is the Skip rule's rate limiting component, not the Worker or D1");
    ok(rated.v.failures.every((l) => !/Worker or D1/.test(l)), "and nothing in it blames the Worker or D1");
    const slow = spentOn([statusAnswer(408, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a70-ORD" })]);
    ok(/^HEALTH: 1 was an HTTP 408 through Cloudflare \(Ray ID 9a0b1c2d3e4f5a70-ORD\): the Worker never answers the ingest route with 408, so the edge timed out waiting for the runner's request, or a Cloudflare rule answers 408: the Skip rule .* covers a rate limiting or custom rule/
      .test(slow.v.failures[1]) && slow.v.failures.length === 2, "a 408 with a cf-ray is the edge's timeout or a Cloudflare rule, not the Worker");
    const broken = spentOn([statusAnswer(503, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a80-IAD" }),
      statusAnswer(503, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a81-IAD" }), statusAnswer(500, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a82-IAD" }),
      null, null]);
    deep(broken.v.failures.slice(1), [
      "HEALTH: 3 were HTTP 5xx answers (500 1, 503 2; Ray ID 9a0b1c2d3e4f5a82-IAD, 9a0b1c2d3e4f5a80-IAD, 9a0b1c2d3e4f5a81-IAD): " +
        "the ingest route itself failed, so the Worker or D1 was failing, not a Cloudflare rule; the ingest lines above " +
        "name each answer",
      "HEALTH: 2 were requests with no usable answer (the connection failed or timed out, or the body was not JSON): the " +
        "network between the runner and the edge, or a Worker that never answered; the ingest lines above name each error"],
    "A BUDGET SPENT ON 5xx OR ON NO ANSWER is the Worker or D1, or the network, and never the WAF");
    const bypassed = spentOn([statusAnswer(429, { server: "squid/5.9" }), statusAnswer(502, { server: "squid/5.9" })]);
    deep(bypassed.v.failures.slice(1), ["HEALTH: 2 answer(s) (HTTP 429 1, HTTP 502 1) carried no cf-ray (server squid/5.9), " +
      "so they never passed through Cloudflare: something between the runner and the edge answered them"],
    "and a 429 or 5xx with no cf-ray never reached Cloudflare, so neither a Cloudflare rule nor the Worker is blamed");
    const tallied = (list) => {
      const t = refusalTally();
      for (const [status, headers, text] of list) tallyAnswer(t, new Response(text, { status, headers }), text);
      return healthChecks({ ...good, edge403: 0, edgeStatuses: t.statuses, retrySpentMs: HEALTH.retrySpentMs }).failures.slice(1);
    };
    const capped = tallied([[429, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5aa0-IAD" }, "error code: 1027"],
      [429, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5aa1-IAD" }, "error code: 1027"], [429, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5aa2-IAD" }, "error code: 1015"]]);
    deep(capped, ["HEALTH: 2 were answers with Cloudflare error 1027 (HTTP 429 2; Ray ID 9a0b1c2d3e4f5aa0-IAD, 9a0b1c2d3e4f5aa1-IAD): " +
      "the Workers Free plan's 100,000 requests a day ran out, and every request to the site counts: it resets at 00:00 UTC, " +
      "and Workers Paid removes the cap (DEPLOY.md 10.0 item 5)",
      "HEALTH: 1 was an HTTP 429 through Cloudflare (Ray ID 9a0b1c2d3e4f5aa2-IAD): the Worker never answers the ingest route " +
        "with 429, so a Cloudflare rate limiting rule refused the runner: the Skip rule for /api/flows/ingest in DEPLOY.md " +
        "10.0 item 3 skips rate limiting rules"],
    "A 429 CARRYING ERROR 1027 is the Workers Free plan's daily request cap, which no Skip rule lifts, and is named apart " +
      "from a rate limiting rule's 429, each line with its own Ray IDs");
    ok(/^HEALTH: 1 was an HTTP 5xx answer \(503 1; Ray ID 9a0b1c2d3e4f5ab0-IAD\): the ingest route itself failed, so the Worker or D1 was failing, not a Cloudflare rule; 1 carried error 1102: the Worker ran over its CPU or memory limit; the ingest lines above/
      .test(tallied([[503, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5ab0-IAD" }, "<title>Worker exceeded resource limits</title> Error 1102"]])[0]),
    "and a 5xx carrying error 1102 says the Worker ran over its limit");
    const both = spentOn([statusAnswer(429, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a90-IAD" })],
      { edge403: worst.count, edgeKinds: worst.kinds });
    ok(both.v.failures.length === 3 && /^HEALTH: the edge answered 24/.test(both.v.failures[0]) &&
       /^HEALTH: 24 were Cloudflare challenges/.test(both.v.failures[1]) && /^HEALTH: 1 was an HTTP 429 through Cloudflare/.test(both.v.failures[2]),
    "with 403s and 429s in one run, each kind gets its own line and remedy");
    const quiet = spentOn([statusAnswer(429, { ...EDGE, "cf-ray": "9a0b1c2d3e4f5a91-IAD" }), statusAnswer(503, EDGE), null,
      statusAnswer(404, EDGE), statusAnswer(400, EDGE), statusAnswer(200, EDGE)], { retrySpentMs: 6000 });
    ok(quiet.v.failures.length === 0 &&
       quiet.v.notes[0].endsWith("6.0 s of retry budget spent; other retried answers: no answer 1, HTTP 429 1 (cf-ray " +
         "9a0b1c2d3e4f5a91-IAD), HTTP 503 1 (no cf-ray)") && Object.keys(quiet.t.statuses).join() === "0,429,503",
    "UNDER THE THRESHOLD the edge line names the other retried answers too (429, 408, 5xx and no answer, with their " +
      "Ray IDs), while a 404, 400 or 200, which are never retried, are not tallied");

    const run = refusalTally();
    for (let i = 0; i < 22; i++) tallyRefusal(run, kinds.challenge);
    let spent = 6000;
    const gateLines = [];
    const tallying = async (key) => {
      for (let i = 0; i < 3; i++) { tallyRefusal(run, { ...kinds.challenge, ray: `8c9d0e1f${key.length}${i}-IAD` }); spent += 1000 * (i + 1) ** 2; }
      return { payload: null, failed: true, status: 403 };
    };
    const lastGate = await runHealthGate({ sessionDate: S, now: () => at(20, 5), read: tallying,
      edge: () => ({ ...structuredClone(run), retrySpentMs: spent }), log: (l) => gateLines.push(l), warn: (l) => gateLines.push(l) });
    const edgeLine = gateLines.find((l) => l.startsWith("  edge: ")) || "";
    const edgeCount = Number(/^ {2}edge: (\d+) ingest/.exec(edgeLine)[1]);
    const bracketed = [...edgeLine.slice(edgeLine.indexOf("[")).matchAll(/ (\d+)(?: \(cf-ray [^)]*\))?(?:;|\])/g)]
      .reduce((sum, m) => sum + Number(m[1]), 0);
    deep([edgeCount, bracketed, run.count, lastGate.failures[0]], [34, 34, 34,
      "HEALTH: the edge answered 34 ingest request(s) with HTTP 403 and retries spent 62 s of the 90 s budget"],
    "THE GATE READS THE TALLY AFTER ITS OWN READS: the 403s its clock, live:market, live:focus and live:heartbeat reads " +
      "meet are in the count, the count and the bracketed kinds add up to the same total, and the threshold sees what " +
      "the line shows");
    ok(/, 62\.0 s of retry budget spent/.test(edgeLine), "and the retry budget in the line is read at the same moment");
  }
  const off = healthChecks({ ...good, clockRead: clockWith({ tier1: { at: null, okAt: null, why: "off" } }),
    heartbeatRead: { payload: null, absent: true }, focusRead: { payload: null, absent: true } });
  ok(off.failures.length === 0 && off.why === "live-off", "FLOWS_LIVE_MODE off is a deliberate rollback, not a failure, " +
    "for the focus cron as for Tier 1");
  ok(!healthChecks({ ...good, now: at(15, 30) }).applies && !healthChecks({ ...good, now: easternInstant("2026-09-25", 20 * 60) }).applies &&
     healthChecks({ ...good, now: easternInstant("2026-09-25", 20 * 60), edge403: 40 }).failures.length === 1,
  "the live checks apply only on the evening of the session the run ranked; the edge count applies to every run");
  const early = healthChecks({ ...good, now: at(14, 0),
    clockRead: clockWith({ earlyClose: 1, tier1: { at: new Date(at(13, 56)).toISOString(), okAt: null, why: "written" },
      summaryAt: new Date(at(13, 45)).toISOString() }),
    marketRead: { payload: { fresh: { readAt: new Date(at(13, 6)).toISOString() } }, status: 200 },
    focusRead: { payload: { fresh: { readAt: new Date(at(13, 8)).toISOString() } }, status: 200 },
    heartbeatRead: beat(S, { calls: 39, failedCalls: 0, finishedAt: new Date(at(13, 21)).toISOString() }) });
  ok(early.applies && early.failures.length === 0, "on an early close the checks follow the 13:00 close");

  const lines = [];
  const gateReads = [];
  const gate = await runHealthGate({ sessionDate: S, now: () => at(20, 5),
    read: async (key) => (gateReads.push(key), ({ clock: good.clockRead, "live:market": good.marketRead,
      "live:focus": good.focusRead, "live:heartbeat": good.heartbeatRead })[key]),
    log: (l) => lines.push(l), warn: (l) => lines.push(l) });
  ok(gate.failures.length === 0 && lines[0] === "health gate: checked; 0 failure(s)" &&
     gateReads.join() === "clock,live:market,live:focus,live:heartbeat",
    "runHealthGate reads the clock, live:market, live:focus and live:heartbeat through the ingest route and prints one line");
  const pipeline = read("scripts/flows-pipeline.mjs");
  const tail = pipeline.slice(pipeline.indexOf("async function main()"), pipeline.indexOf("\nexport {\n"));
  ok(/const health = await runHealthGate\(\{ sessionDate, read: readStored, dry: DRY_RUN, edge: edgeSnapshot,\s*annotate: process\.env\.GITHUB_ACTIONS === "true" \}\);\s*if \(health\.failures\.length\) process\.exitCode = 1;\s*\}\s*$/
    .test(tail), "THE NIGHTLY ENDS WITH THE GATE: its last statement runs it and turns the run red on any failure, after " +
    "every key is published, with the edge 403s counted by kind and the Worker's own 403s kept apart");
  ok(/export function edgeSnapshot\(\) \{\s*return \{ \.\.\.structuredClone\(edgeRefusals\), retrySpentMs: publishRetrySpentMs \};\s*\}/
    .test(pipeline), "and it hands the gate a function, so the count, the kinds, the other statuses and the retry budget " +
    "are copied together, after the gate's own reads");
  ok(/heard = refusal \|\| await noteAnswer\(response\);/.test(pipeline) && /if \(!refusal\) await noteAnswer\(response\);/.test(pipeline),
    "the write and the delete tally every retried answer that is not a 403");
  ok(/if \(!response\.ok\) \{\s*await noteAnswer\(response\);/.test(pipeline) &&
     (pipeline.match(/await noteAnswer\(null\);\s*return \{ (?:payload: null, failed: true|ok: false), status: 0/g) || []).length === 2,
  "and so do the read and a request that got no answer at all");
  ok(/async function noteAnswer\(response\) \{\s*if \(response && !retriedStatus\(response\.status\)\) return null;\s*const text = response \? await response\.text\(\)\.catch\(\(\) => ""\) : "";\s*tallyAnswer\(edgeRefusals, response, text\);/
    .test(pipeline), "noteAnswer reads the body of a retried answer only, so a Cloudflare code in it is kept");
  eq((pipeline.match(/refusal = response\.status === 403 \? await noteRefusal\(response\) : null;/g) || []).length, 4,
    "and every ingest read, write and delete classifies a 403 into it, and so does the ledger's metadata probe");
  eq((pipeline.match(/ingestURL\(\) \+ "\?key="/g) || []).length, 3, "which are the pipeline's only three ingest requests");
  ok(/async function noteRefusal\(response\) \{\s*const text = await response\.text\(\)\.catch\(\(\) => ""\);\s*const seen = refusalOf\(\{ headers: response\.headers, text \}\);\s*tallyRefusal\(edgeRefusals, seen\);/
    .test(pipeline), "noteRefusal reads the 403's own headers and body, and tallies what it finds");
  const { republishRepair } = await import("../scripts/flows-legs/health.mjs");
  const repair = republishRepair("2026-09-25");
  ok(/republish_session/.test(repair) && /gh workflow run flows-pipeline\.yml -f republish_session=true/.test(repair) &&
     /^REPAIR \(before 09:30 ET on 2026-09-28;/.test(repair) &&
     (pipeline.match(/console\.warn\(`  \$\{republishRepair\(sessionDate\)\}`\);\s*process\.exitCode = 1;/g) || []).length === 2,
  "ARCHIVE LOST and ARCHIVE INCOMPLETE are each followed by the whole repair, as one line an owner can follow as-is, " +
    "including when it still works: before the next weekday's open (a Friday session until Monday 09:30 ET)");
  {
    const at = (day, h, m) => new Date(easternInstant(day, h * 60 + m));
    ok(!intradayRefusal("2026-09-25", { at: at("2026-09-28", 9, 29) }).refuse &&
       intradayRefusal("2026-09-25", { at: at("2026-09-28", 9, 30) }).refuse,
    "and that deadline is the pipeline's own: the republish runs at 09:29 ET on the next weekday and is refused at 09:30");
  }
  {
    const reads = [];
    const failing = { clock: 1, "live:market": 0, "live:focus": 0, "live:heartbeat": 0 };
    const retrying = async (key) => {
      reads.push(key);
      if (failing[key]-- > 0) return { payload: null, failed: true, status: 403 };
      return ({ clock: good.clockRead, "live:market": good.marketRead, "live:focus": good.focusRead,
        "live:heartbeat": good.heartbeatRead })[key];
    };
    const g = await runHealthGate({ sessionDate: S, now: () => at(20, 5), read: async (key) => {
      let r = await retrying(key);
      for (let i = 0; r.failed && i < 2; i++) r = await retrying(key);
      return r;
    }, log: () => {}, warn: () => {} });
    ok(g.failures.length === 0 && reads.filter((k) => k === "clock").length === 2,
      "A RANDOM EDGE 403 ON A GATE READ is retried (the pipeline passes its retrying readStored), so one refusal the " +
        "retry absorbs never turns a healthy session red");
  }

  const dead = (answered, landed) => ({ skipped: null, answered, landed });
  deep([liveRunVerdict({ passes: [dead(0, 0), dead(0, 0)] }).failed, liveRunVerdict({ passes: [dead(0, 0), dead(30, 9)] }).failed,
    liveRunVerdict({ passes: [{ skipped: "recent" }] }).failed, liveRunVerdict({ passes: [{ errored: true, threw: "x" }] }).failed,
    liveRunVerdict({ passes: [dead(30, 8)], exit: "budget", chained: { sent: false, why: "refused" } }).failed,
    liveRunVerdict({ passes: [{ ...dead(30, 8), errored: true }] }).failed],
  [true, false, false, true, true, false],
  "THE LIVE JOB'S EXIT: red only when every pass answered no vendor call or landed no key (or threw), or when an open " +
    "session's chain dispatch was refused; one over-cap key in a pass that landed the rest stays green");
  deep(passOutcome({ run: { calls: 38, failedCalls: 38, errors: [] }, published: ["live:heartbeat"] }),
    { skipped: null, answered: 0, landed: 0, errored: false }, "a pass whose every read failed answered nothing and landed only its heartbeat");

  const focusRead = { payload: { groups: [{ id: "gold", lead: "GLD", tickers: ["GLD", "GDX"] }] } };
  const plan = boardPlan({ long: { payload: { rows: [{ t: "AAA", s: 90 }] } }, short: { payload: null }, watch: { payload: null } },
    focusRead);
  deep([plan.names, plan.focus.source], [["SPY", "QQQ", "IWM", "GLD", "GDX", "AAA"], "focus"],
    "boardPlan takes the stored focus payload's tickers ahead of the boards");
  let clockAt = easternInstant("2026-09-23", 11 * 60 + 7);
  const uw = FAKE.fakeLiveVendor({ now: () => (clockAt += 250), session: "2026-09-23" });
  const asked = [];
  await runLive({ uw, now: () => (clockAt += 250), log: () => {}, warn: () => {}, force: true, shapeNews,
    publish: async () => {},
    readStored: async (k) => { asked.push(k); return k === "focus" ? focusRead : k.startsWith("board:") ? { payload: FAKE.fakeBoards()[k.slice(6)] } : { payload: null }; } });
  const screen = uw.calls.find((c) => c.path === "/api/screener/stocks");
  ok(asked.includes("focus") && screen.params.ticker.startsWith("SPY,QQQ,IWM,GLD,GDX,SYL001"),
    "a live pass reads the focus key under its live credential and asks the one screener call for the focus names " +
    "right after the index rows");
  ok(W.NIGHTLY_READ_KEYS.includes("focus") && W.ingestScope("focus", "GET", "live").ok && !W.ingestScope("focus", "POST", "live").ok,
    "the live role may READ the focus key it plans from, and nothing more");
}

{
  const DAY = 86400000;
  const T = (iso) => Date.parse(iso);
  const tableless = { prepare: () => ({ first: async () => { throw new Error("D1_ERROR: no such table: users: SQLITE_ERROR"); } }) };
  eq(await LAB.readLabActiveAt(null), null, "no database, no Lab activity");
  eq(await LAB.readLabActiveAt(tableless), null,
    "A FRESH DATABASE with no Lab tables reads as no sign-in on record, not as a failed clock read");
  eq(await LAB.readLabActiveAt({ prepare: () => { throw new Error("boom"); } }), null, "and a prepare that throws is guarded too");
  const labDb = (values) => ({
    prepare: (sql) => ({ first: async () => {
      const hit = Object.entries(values).find(([k]) => sql === k);
      if (!hit) throw new Error("D1_ERROR: no such column: signed_in_at: SQLITE_ERROR");
      return { at: hit[1] };
    } }),
  });
  const Q = Object.fromEntries(LAB.LAB_ACTIVITY.map((q) => [q.sql.split(" FROM ")[1] + ":" + q.sql.split("(")[1].split(")")[0], q.sql]));
  eq(await LAB.readLabActiveAt(labDb({ [Q["users:created_at"]]: T("2026-06-30T12:00:00Z"), [Q["stats:updated_at"]]: T("2026-07-20T12:00:00Z"),
    [Q["progress:updated_at"]]: null })), "2026-06-30T12:00:00.000Z",
  "LAB ACTIVITY is the newest instant the Lab's Google sign-in is known to have been used: a first sign-in (users.created_at) " +
    "counts as itself, while a signed-in write counts thirty days earlier, since the session that made it was issued " +
    "up to thirty days before; a database whose users table predates signed_in_at still answers");
  eq(await LAB.readLabActiveAt(labDb({ [Q["users:created_at"]]: T("2026-06-30T12:00:00Z"), [Q["users:signed_in_at"]]: null,
    [Q["stats:updated_at"]]: null, [Q["progress:updated_at"]]: T("2026-08-15T00:00:00Z") })),
  new Date(T("2026-08-15T00:00:00Z") - 30 * DAY).toISOString(), "a later write moves it, less the session's thirty days");
  eq(await LAB.readLabActiveAt(labDb({ [Q["users:created_at"]]: T("2026-06-30T12:00:00Z"), [Q["users:signed_in_at"]]: T("2026-09-27T08:00:00Z"),
    [Q["stats:updated_at"]]: T("2026-09-01T00:00:00Z"), [Q["progress:updated_at"]]: T("2026-09-01T00:00:00Z") })),
  "2026-09-27T08:00:00.000Z", "and a returning learner's sign-in (users.signed_in_at) counts exactly");
  eq(LAB.LAB_SESSION_MS, 30 * DAY, "the session lifetime the lag stands on");
  const workerSrc = read("worker.js");
  ok(/exp: Date\.now\(\) \+ LAB_SESSION_MS \}/.test(workerSrc) && /cookie\("session", session, \{ maxAge: LAB_SESSION_MS \/ 1000 \}\)/.test(workerSrc),
    "and it is the Lab session's own lifetime, cookie and signed expiry alike, so the two cannot drift apart");
  ok(/await recordSignIn\(env\.DB, user, Date\.now\(\)\);/.test(workerSrc) && !/INSERT INTO users/.test(workerSrc),
    "EVERY GOOGLE SIGN-IN IS RECORDED: the OAuth callback writes users through recordSignIn and nowhere else, so a " +
      "returning learner's sign-in moves the count the alarm reads");

  const run = (failAt) => {
    const sent = [];
    const db = { prepare: (sql) => {
      const stmt = { args: [], bind: (...a) => { stmt.args = a; return stmt; }, run: async () => {
        sent.push(sql);
        if (failAt.includes(sent.length)) {
          throw new Error(sql.includes("signed_in_at") && !sql.startsWith("ALTER")
            ? "D1_ERROR: table users has no column named signed_in_at: SQLITE_ERROR" : "D1_ERROR: no such table: users");
        }
        return { success: true, args: stmt.args };
      } };
      return stmt;
    } };
    return { db, sent };
  };
  const learner = { sub: "g_1", email: "a@b.c", name: "A" };
  {
    const { db, sent } = run([]);
    const out = await LAB.recordSignIn(db, learner, 5);
    deep([sent, out.args], [[LAB.SIGN_IN_SQL], ["g_1", "a@b.c", "A", 5, 5]],
      "a sign-in is one upsert that stamps created_at on the first and signed_in_at on every one");
  }
  {
    const { db, sent } = run([1]);
    await LAB.recordSignIn(db, learner, 5);
    deep(sent, [LAB.SIGN_IN_SQL, LAB.SIGNED_IN_COLUMN_SQL, LAB.SIGN_IN_SQL],
      "a users table that predates the column gets it on the first sign-in after deploy, and the upsert runs again");
  }
  {
    const { db, sent } = run([1, 3]);
    const out = await LAB.recordSignIn(db, learner, 5);
    deep([sent, out.args], [[LAB.SIGN_IN_SQL, LAB.SIGNED_IN_COLUMN_SQL, LAB.SIGN_IN_SQL, LAB.LEGACY_SIGN_IN_SQL], ["g_1", "a@b.c", "A", 5]],
      "and if the column still cannot be written, the old upsert runs, so the bookkeeping can never break a sign-in");
  }
  {
    const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1_ERROR: no such table: users"); } }) }) };
    let threw = null;
    try { await LAB.recordSignIn(db, learner, 5); } catch (error) { threw = error; }
    ok(threw && /no such table: users/.test(threw.message), "while any other failure still fails the sign-in, as before");
  }
  const baselineUsers = /CREATE TABLE IF NOT EXISTS users \(([\s\S]*?)\);/.exec(read("migrations/0001_baseline.sql"))[1];
  const schemaUsers = /CREATE TABLE IF NOT EXISTS users \(([\s\S]*?)\);/.exec(read("schema.sql"))[1];
  const colsOf = (body) => body.split(",").map((c) => c.trim().split(/\s+/)[0]);
  deep([colsOf(schemaUsers), read("migrations/0013_users_signed_in_at.sql")],
    [[...colsOf(baselineUsers), "signed_in_at"], LAB.SIGNED_IN_COLUMN_SQL + ";\n"],
  "0013 adds exactly the column the Worker adds on first use, and schema.sql declares users with it");

  const liveSrc = read("shared/flows-live-worker.js");
  const nowSrc = liveSrc.slice(liveSrc.indexOf("export async function serveNow("), liveSrc.indexOf("export function quoteTtlS("));
  ok(nowSrc.length > 500 && !/labActiveAt|readLabActiveAt|lab-sign-in/.test(nowSrc) && !/labActiveAt/.test(W.clockView.toString()) &&
     !/labActiveAt/.test(W.ingestClockView.toString()),
  "THE PUBLIC VIEW NEVER CARRIES IT: /api/flows/now and both clock views are built without the Lab's sign-in age");
  const clockRow = { id: 1, day: "2026-09-25", trading: 1, tier1_at: T("2026-09-25T21:56:00Z"), dispatch_why: "no-token" };
  const envOf = (lab) => ({ DB: { prepare: (sql) => ({ first: async () => {
    if (/flows_clock/.test(sql)) return clockRow;
    if (sql === Q["users:created_at"]) return { at: lab };
    throw new Error("D1_ERROR: no such column: signed_in_at");
  } }) } });
  const jsonOf = (body) => body;
  const nightlyView = await W.serveIngestClock(envOf(T("2026-06-30T12:00:00Z")), { json: jsonOf, lab: true });
  const liveView = await W.serveIngestClock(envOf(T("2026-06-30T12:00:00Z")), { json: jsonOf });
  deep([nightlyView.labActiveAt, Object.hasOwn(liveView, "labActiveAt"), nightlyView.clock, liveView.clock],
    ["2026-06-30T12:00:00.000Z", false, W.ingestClockView(W.normalizeClock(clockRow)), W.ingestClockView(W.normalizeClock(clockRow))],
  "ONLY THE PIPELINE'S CREDENTIAL READS IT: the ingest clock key adds labActiveAt beside the clock for the nightly token, " +
    "and the live credential's read of the same key carries no such field");
  deep((await W.serveIngestClock({ DB: tableless }, { json: jsonOf, lab: true })), { key: "clock", clock: null, labActiveAt: null },
    "and a fresh database answers null for both");

  {
    const S = "2026-09-25";
    const at = Date.parse("2026-09-25T14:10:00Z");
    const clock = { day: S, trading: 1, closedDays: [] };
    const clockRow = { id: 1, day: S, trading: 1, closed_days: "[]" };
    const rowOf = (id, payload, readAt, klass, source, updatedAt) => ({ id, payload: JSON.stringify(payload), read_at: readAt, session: S,
      cadence_s: FRESH_CLASSES[klass].cadenceS, source, writer: source, updated_at: updatedAt });
    const rows = [
      rowOf("live:market", { key: "live:market", tide: { n: 2 }, fresh: { readAt: new Date(at - 60_000).toISOString() } }, at - 60_000, "market", "worker", at - 59_000),
      rowOf("live:strips", { key: "live:strips", rows: { GLD: [1] } }, at - 120_000, "breadth", "actions", at - 118_000),
    ];
    const metaOf = (r) => ({ readAt: r.read_at, session: r.session, cadenceS: r.cadence_s, source: r.source });
    const fakeDb = () => {
      const seen = [];
      const answer = (sql, args) => (/flows_clock/.test(sql) ? [clockRow]
        : /flows_live WHERE id IN/.test(sql) ? rows.filter((r) => args.includes(r.id)) : rows.filter((r) => r.id === args[0]));
      const st = (sql) => { const x = { sql, args: [], bind(...a) { x.args = a; return x; },
        first: async () => { seen.push({ kind: "first", sql, args: x.args }); return answer(sql, x.args)[0] || null; },
        all: async () => ({ results: answer(sql, x.args) }) }; return x; };
      return { seen, prepare: st, batch: async (list) => { seen.push({ kind: "batch", sqls: list.map((x) => x.sql), args: list.map((x) => x.args) });
        return list.map((x) => ({ results: answer(x.sql, x.args) })); } };
    };
    const jsonOf = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
    class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
    const lk = (k) => new URL("https://anilkaya.org/api/flows/lk?k=" + k);

    deep(W.liveParams(" market, vol,board:long,market,live:strips:series,MARKET"), ["market", "vol", "live:strips:series", "MARKET"],
      "liveParams keeps the params as asked, trimmed, once each, in order, with an unknown key dropped as parseList drops it");
    deep([W.LK_MAX_KEYS, W.liveParams(Object.keys(L.LIVE_KEYS).map((k) => k.slice(5)).join(",")).length], [8, 8],
      "and caps a list at eight keys of the twelve");
    deep(W.liveParams(""), [], "an empty k is no key");

    const { body, headers } = W.liveEnvelope(["market", "vol", "strips"], rows, at, clock);
    const env = JSON.parse(body);
    deep(Object.keys(env), ["serverNow", "phase", "keys"], "THE ENVELOPE: serverNow, phase and keys");
    deep([env.serverNow, env.phase], [at, W.phaseView(phaseAt(at, clock))], "stamped with the instant and the phase view /api/flows/now serves");
    deep(Object.keys(env.keys), ["market", "vol", "strips"], "keyed by the params as asked");
    deep(env.keys.market, { status: "ok", payload: JSON.parse(rows[0].payload), updatedAt: at - 59_000,
      fresh: W.liveEntry(metaOf(rows[0]), at - 59_000, at, clock) },
    "a held key: ok, the row's payload spliced in whole, its updatedAt, and the fresh entry serveNow's place() builds");
    deep(env.keys.vol, { status: "pending", fresh: W.pendingEntry("breadth") }, "an unwritten key: pending, in its class");
    deep(env.keys.vol.fresh, { state: "pending", reason: "unpublished", klass: "breadth" }, "as serveNow says it");
    deep([env.keys.market.fresh.state, env.keys.strips.fresh.state], ["live", "live"],
      "a market read a minute ago and a breadth read two minutes ago are both live inside the session");
    const mk = freshHeaders(metaOf(rows[0]), at, clock).headers, st = freshHeaders(metaOf(rows[1]), at, clock).headers;
    deep([headers["X-Fresh-State"], headers["X-Fresh-Reason"], headers["X-Fresh-Class"], headers["X-Fresh-Source"], headers["X-Fresh-Cadence"]],
      ["pending", "unpublished", "breadth", "actions", "900"],
    "THE AGGREGATE HEADERS ARE THE TIGHTEST READING: X-Fresh-State is the weakest key's (live < fresh < closed < stale < pending), " +
      "and Reason, Class, Source and Cadence are that key's");
    deep([headers["X-Fresh-Read-At"], headers["X-Fresh-Live-Until"], headers["X-Fresh-Stale-At"]],
      [st["X-Fresh-Read-At"], mk["X-Fresh-Live-Until"], mk["X-Fresh-Stale-At"]],
    "Read-At is the oldest read (the strip's), Live-Until and Stale-At the earliest instants at which any key leaves its state (the market's)");
    deep([headers["X-Fresh-Phase"], headers["X-Fresh-Phase-Ends"], headers["X-Server-Now"], headers["X-Payload-Updated"]],
      [mk["X-Fresh-Phase"], mk["X-Fresh-Phase-Ends"], String(at), String(at - 59_000)],
    "Phase, Phase-Ends and Server-Now are the instant's, X-Payload-Updated the newest key's");
    const two = W.liveEnvelope(["strips", "market"], rows, at, clock).headers;
    deep([two["X-Fresh-State"], two["X-Fresh-Class"], two["X-Fresh-Source"]], ["live", "breadth", "actions"],
      "with no weaker key, equal states tie to the first param asked");
    ok(!body.includes("\n") && JSON.parse(body).keys.strips.payload.rows.GLD[0] === 1,
      "the body is assembled by splicing each row's stored JSON text, never parsed and re-serialized");

    const nowDb = fakeDb();
    const now = await (await W.serveNow({ DB: nowDb }, new URL("https://anilkaya.org/api/flows/now?k=market,vol,strips"), at, { json: jsonOf, HttpError })).json();
    deep([now.keys["live:market"], now.keys["live:vol"], now.phase], [env.keys.market.fresh, env.keys.vol.fresh, env.phase],
      "serveNow's entries for the same rows are the envelope's fresh entries, field for field, and its phase the envelope's");

    W.memoClock(clock, at);
    const oneDb = fakeDb();
    const one = await W.serveLiveKey({ DB: oneDb }, lk("market"), at, { json: jsonOf, HttpError });
    const raw = W.liveResponse({ ...metaOf(rows[0]), payload: rows[0].payload, updatedAt: rows[0].updated_at }, at, clock);
    eq(await one.text(), rows[0].payload, "A SINGLE KEY IS UNCHANGED: the raw payload body, byte for byte");
    deep(Object.fromEntries(one.headers), Object.fromEntries(raw.headers), "under the same headers as before");
    deep(oneDb.seen.map((t) => t.kind), ["first"], "read as it always was");
    const dropped = await W.serveLiveKey({ DB: fakeDb() }, lk("market,board:long,"), at, { json: jsonOf, HttpError });
    eq(await dropped.text(), rows[0].payload, "a list that leaves one key after the unknown is dropped is that key's raw body");
    const pend = await W.serveLiveKey({ DB: fakeDb() }, lk("vol"), at, { json: jsonOf, HttpError });
    deep([await pend.json(), pend.headers.get("X-Fresh-State")], [{ key: "live:vol", status: "pending" }, "pending"], "and a pending single key its pending body");

    const manyDb = fakeDb();
    const many = await W.serveLiveKey({ DB: manyDb }, lk("market,vol,strips"), at, { json: jsonOf, HttpError });
    deep([many.status, many.headers.get("Content-Type"), await many.json()], [200, "application/json; charset=utf-8", env],
      "TWO OR MORE KEYS ARE THE ENVELOPE");
    deep(Object.fromEntries(many.headers), Object.fromEntries(new Headers({ "Content-Type": "application/json; charset=utf-8", ...headers })),
      "under the aggregate headers");
    deep(manyDb.seen, [{ kind: "batch", sqls: ["SELECT id, payload, read_at, session, cadence_s, source, writer, updated_at FROM flows_live WHERE id IN (?, ?, ?)"],
      args: [["live:market", "live:vol", "live:strips"]] }], "from one batch of one SELECT with the ids bound in order, the clock memo warm");
    W.memoClock(null, 0);
    const coldDb = fakeDb();
    await W.serveLiveKey({ DB: coldDb }, lk("market,vol"), at, { json: jsonOf, HttpError });
    ok(coldDb.seen.length === 1 && coldDb.seen[0].sqls.length === 2 && /FROM flows_clock/.test(coldDb.seen[0].sqls[1]) && !W.clockDue(at),
      "with the memo stale, the clock row rides the same batch and warms it");
    const dup = await (await W.serveLiveKey({ DB: fakeDb() }, lk("market,live:market"), at, { json: jsonOf, HttpError })).json();
    deep([Object.keys(dup.keys), dup.keys["live:market"]], [["market", "live:market"], dup.keys.market], "two params for one key are two entries of one row");
    let refused = null;
    try { await W.serveLiveKey({ DB: fakeDb() }, lk("board:long,meta"), at, { json: jsonOf, HttpError }); } catch (error) { refused = error; }
    deep([refused && refused.status, refused && refused.code], [400, "invalid_key"], "a list with no live key is the 400 an unknown key always was");
    const broken = { ...fakeDb(), batch: async () => { throw new Error("D1 unavailable"); } };
    let gone = null;
    try { await W.serveLiveKey({ DB: broken }, lk("market,vol"), at, { json: jsonOf, HttpError }); } catch (error) { gone = error; }
    deep([gone && gone.status, gone && gone.code], [503, "store_unreadable"], "and a batch that fails is the 503 /api/flows/now answers");
    W.memoClock(null, 0);
  }

  const S = "2026-09-25";
  const at = (h, m) => easternInstant(S, h * 60 + m);
  const now = at(20, 5);
  const gate = (labActiveAt, over = {}) => healthChecks({ sessionDate: "2026-09-24", now,
    clockRead: { payload: { key: "clock", clock: null, ...(labActiveAt === undefined ? {} : { labActiveAt }) }, status: 200 }, ...over });
  const ago = (days) => new Date(now - days * DAY).toISOString();
  const labLines = (v) => ({ failures: v.failures, warnings: v.warnings, notes: v.notes.filter((n) => n.startsWith("lab:")) });
  const d119 = labLines(gate(ago(119)));
  deep(d119, { failures: [], warnings: [], notes: ["lab: the Lab's Google OAuth client was used within the last 120 days; nothing to do"] },
    "119 DAYS: a note that says nothing needs doing, and nothing more");
  const quietNotes = [0, 1, 30, 89, 119].map((d) => labLines(gate(ago(d))).notes.join("\n"));
  ok(new Set(quietNotes).size === 1 && quietNotes.every((n) => !/\d{4}-\d{2}-\d{2}|days? ago|\b(?:[0-9]|[1-9][0-9]|11[0-9])\b/.test(n)),
    "THE LOG IS PUBLIC, SO UNDER 120 DAYS THE NOTE CARRIES NO DATE AND NO AGE: the same words whether the last Lab " +
      "activity was today or 119 days ago, so a nightly never publishes when a learner last used the Lab");
  const d120 = labLines(gate(ago(120)));
  deep([d120.failures, d120.warnings], [[], [`WARNING: the latest Google sign-in to the Lab on record is ${ago(120).slice(0, 10)}, ` +
    `120 days ago. ${SIGN_IN_ADVICE} This gate turns the nightly red from ${new Date(now + 30 * DAY).toISOString().slice(0, 10)}.`]],
  "120 DAYS: a warning that names the sign-in, the six months, the callback and the day the gate turns red, and the run stays green");
  const d149 = labLines(gate(ago(149)));
  ok(d149.failures.length === 0 && d149.warnings.length === 1 && /149 days ago/.test(d149.warnings[0]), "149 days still only warns");
  const d150 = labLines(gate(ago(150)));
  deep([d150.warnings, d150.failures], [[], [`HEALTH: the latest Google sign-in to the Lab on record is ${ago(150).slice(0, 10)}, ` +
    `150 days ago. ${SIGN_IN_ADVICE} Google deletes it about ${new Date(now + 30 * DAY).toISOString().slice(0, 10)}.`]],
  "150 DAYS: the nightly turns red, which emails the owner, a month before Google's six months run out");
  ok(/^Sign in to the Lab at https:\/\/anilkaya\.org\/lab\/ — Google deletes an OAuth client unused for about six months; keep the callback https:\/\/anilkaya\.org\/auth\/callback registered\.$/
    .test(SIGN_IN_ADVICE), "the advice is the sign-in URL, the six months and the callback that must stay registered");
  ok(/Google may already have deleted it: if sign-in fails with deleted_client or invalid_client, create a Web application OAuth client .*wrangler secret put GOOGLE_CLIENT_ID/
    .test(labLines(gate(ago(LAB_SIGN_IN.goneDays))).failures[0]), "and past six months it also says how to replace a deleted client");
  deep(labLines(gate(null)), { failures: [], warnings: [], notes: ["lab: no Google sign-in to the Lab is on record (no Lab user, or no " +
    "Lab tables), so the OAuth client's idle time cannot be told; one sign-in at https://anilkaya.org/lab/ starts the count"] },
  "NULL (no Lab user, or a fresh database) is a note, not a failure");
  deep(labLines(gate(undefined)).notes, ["lab: the Worker does not report the Lab's last Google sign-in (a Worker older than this check)"],
    "and a Worker that predates the field says so rather than guessing");
  deep(labLines(gate(ago(200), { clockRead: { payload: null, failed: true, status: 503 } })).notes,
    ["lab: the clock could not be read, so the age of the Lab's last Google sign-in is unknown this run"], "as does an unreadable clock");
  const idle = gate(ago(160));
  ok(!idle.applies && idle.failures.length === 1 && /160 days ago/.test(idle.failures[0]),
    "the sign-in age is checked on every run, like the edge count, not only on the evening of the session");
  const production = labLines(healthChecks({ sessionDate: null, now: T("2026-09-27T12:00:00Z"),
    clockRead: { payload: { key: "clock", clock: null, labActiveAt: "2026-06-30T00:00:00.000Z" }, status: 200 } }));
  deep(production.notes, ["lab: the Lab's Google OAuth client was used within the last 120 days; nothing to do"],
    "WITH PRODUCTION'S NEWEST LAB ROW (2026-06-30) today's nightly says only that nothing needs doing");
  const onDay = (iso) => labLines(healthChecks({ sessionDate: null, now: T(iso),
    clockRead: { payload: { key: "clock", clock: null, labActiveAt: "2026-06-30T00:00:00.000Z" }, status: 200 } }));
  ok(onDay("2026-10-27T23:59:59Z").warnings.length === 0 &&
     /^WARNING: the latest Google sign-in to the Lab on record is 2026-06-30, 120 days ago\. .* This gate turns the nightly red from 2026-11-27\.$/
       .test(onDay("2026-10-28T00:00:00Z").warnings[0]) && onDay("2026-11-26T23:59:59Z").failures.length === 0 &&
     /^HEALTH: the latest Google sign-in to the Lab on record is 2026-06-30, 150 days ago\. .* Google deletes it about 2026-12-27\.$/
       .test(onDay("2026-11-27T00:00:00Z").failures[0]),
  "and it warns, with the day and the age, from 2026-10-28, and turns red from 2026-11-27, a month before Google's " +
    "six months end about 2026-12-27");

  const lines = [];
  const warnGate = await runHealthGate({ sessionDate: "2026-09-24", now: () => now, annotate: true,
    read: async (key) => (key === "clock" ? { payload: { key: "clock", clock: null, labActiveAt: ago(130) }, status: 200 }
      : { payload: null, absent: true }),
    log: (l) => lines.push(l), warn: (l) => lines.push(l) });
  ok(warnGate.failures.length === 0 && lines[0] === "health gate: live checks skipped — this run is for 2026-09-24 and today is " +
     "2026-09-25; the live checks describe today; 0 failure(s), 1 warning(s)" &&
     lines.some((l) => l.startsWith("::warning title=Lab sign-in::WARNING: the latest Google sign-in to the Lab on record is ")),
  "in GitHub Actions the warning is an annotation on the run's summary, and the run stays green");
}

{
  const S = "2026-09-24";
  const row = { id: 1, day: "2026-09-23", trading: 1, early_close: 0, live_dispatched_at: null, dispatch_why: null };
  const apply = (db) => {
    for (const st of db.statements.filter((x) => /INSERT INTO flows_clock/.test(x.sql))) {
      const cols = /\(([^)]*)\) VALUES/.exec(st.sql)[1].split(", ");
      cols.forEach((c, j) => { row[c] = st.args[j]; });
    }
  };
  const github = [];
  const errors = [];
  const fetchImpl = async (u) => { github.push(u); return { status: 204 }; };
  const log = { error: (l) => errors.push(JSON.parse(l).message) };
  const dispatches = [];
  for (let m = 9 * 60 + 31; m <= 16 * 60 + 26; m += 5) {
    const db = tickDb();
    db.batch = async (list) => {
      db.statements.push(...list);
      return /SELECT \* FROM flows_clock/.test(list[0].sql) ? [{ results: [{ ...row }] }, { results: [] }] : list.map(() => ({ results: [] }));
    };
    const texts = await tier1Bodies({ session: S, at: easternInstant(S, m) });
    const out = await W.rthTick({ DB: db, UW_API_KEY: "k" }, easternInstant(S, m),
      { fetchVendor: async (p) => JSON.parse(texts[p]), fetchImpl, log });
    if (out.dispatch && out.dispatch.why === "no-token") dispatches.push(m);
    apply(db);
  }
  const nightly = [];
  for (const [h, mi] of [[17, 30], [18, 30]]) {
    const db = tickDb();
    db.batch = async () => [{ results: [{ ...row }] }, { results: [{ session: "2026-09-23" }] }];
    const out = await W.nightlyTick({ DB: db }, easternInstant(S, h * 60 + mi), { fetchImpl, log });
    nightly.push([`${h}:${mi}`, out.due, out.sent && out.sent.sent, out.sent && out.sent.why]);
    apply(db);
  }
  deep(nightly, [["17:30", true, false, "no-token"], ["18:30", true, false, "no-token"]],
    "BOTH NIGHTLY SLOTS ARE DUE AND BOTH TRY: at 17:30 and 18:30 ET the nightly dispatch is due, is attempted, and " +
      "answers no-token without sending");
  ok(dispatches.length === 28 && github.length === 0 && row.dispatch_why === "no-token" && row.live_dispatched_at === null &&
     !errors.some((e) => /dispatch failed/.test(e)),
  "A SESSION WITH NO GITHUB_DISPATCH_TOKEN, 09:31 to 16:26 and both nightly slots: all 28 due Tier 2 dispatches " +
    "(09:31 to 16:16, every 15 minutes) and the nightly's each record no-token, nothing reaches GitHub, live_dispatched_at stays null and no " +
    "'dispatch failed' error is logged");
  const view = W.ingestClockView(W.normalizeClock(row));
  eq(view.dispatchWhy, "no-token", "and the ingest clock view hands the nightly that outcome");
  const at = (h, m) => easternInstant(S, h * 60 + m);
  const reads = {
    clock: { payload: { key: "clock", clock: { ...view, tier1: { at: new Date(at(17, 56)).toISOString(),
      okAt: new Date(at(16, 6)).toISOString(), why: "written" }, summaryAt: new Date(at(19, 45)).toISOString() },
      labActiveAt: new Date(at(12, 0)).toISOString() }, status: 200 },
    "live:market": { payload: { fresh: { readAt: new Date(at(16, 6)).toISOString() } }, status: 200 },
    "live:focus": { payload: { fresh: { readAt: new Date(at(16, 8)).toISOString() } }, status: 200 },
    "live:heartbeat": { payload: { session: S, run: { calls: 39, failedCalls: 0, finishedAt: new Date(at(16, 21)).toISOString() } },
      status: 200 },
  };
  const lines = [];
  const gate = await runHealthGate({ sessionDate: S, now: () => at(20, 5), read: async (k) => reads[k],
    log: (l) => lines.push(l), warn: (l) => lines.push("WARN " + l) });
  ok(gate.applies && gate.failures.length === 0 && gate.warnings.length === 0 && lines[0] === "health gate: checked; 0 failure(s)",
    "THE NIGHTLY STAYS GREEN WITHOUT THE TOKEN: the gate, reading that clock, finds no failure and no warning");
  deep(lines.filter((l) => /GITHUB_DISPATCH_TOKEN|dispatch|refused|renew/i.test(l)),
    ["  dispatch: the Worker has no GITHUB_DISPATCH_TOKEN, so GitHub's own schedules start Tier 2 and the nightly; a " +
      "supported mode, not a failure (DEPLOY.md 10.0 item 1)"],
  "and the one line about dispatch is a note that says what the missing token means, never a refusal or a renewal");
  ok(!lines.some((l) => l.startsWith("WARN ")), "nothing is printed as a warning or a failure");
  const beforeAny = await runHealthGate({ sessionDate: S, now: () => at(20, 5), log: () => {}, warn: () => {},
    read: async (k) => (k === "clock" ? { ...reads.clock, payload: { ...reads.clock.payload,
      clock: { ...reads.clock.payload.clock, dispatchWhy: null } } } : reads[k]) });
  ok(beforeAny.failures.length === 0 && !beforeAny.notes.some((n) => /dispatch/.test(n)),
    "and a clock that has never dispatched at all (dispatch_why null) says nothing about dispatch");
}

{
  const child = (arg) => {
    const out = execFileSync("node", [new URL("tests/live-stubs.mjs", ROOT).pathname, "--tier1-budget", ...arg],
      { encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").pop());
  };
  const colds = Array.from({ length: 10 }, () => child(["cold"]));
  ok(colds.every((c) => c.written), "the budget child's cold ticks each wrote a full-session live:market");
  const coldCpu = colds.reduce((a, c) => a + c.cold, 0) / colds.length;
  const walls = colds.map((c) => c.coldWall).sort((a, b) => a - b);
  const coldWall = (walls[4] + walls[5]) / 2;
  const warm = child([]);
  ok(coldCpu < 7.5,
    `COLD ISOLATE: the first Tier 1 tick of a fresh process (lazy compilation included) over full-session bodies ` +
    `(${warm.bytes} bytes of vendor JSON) takes ${coldCpu.toFixed(2)} ms of ${colds[0].clock} time, the mean of ten ` +
    `processes (the clock ticks in 4 ms steps, so one reading is 4 or 8; the mean is unbiased), under the 10 ms cap`);
  ok(coldWall < 8, `its median wall time, a finer clock and an upper bound on an idle machine, is ${coldWall.toFixed(2)} ms`);
  ok(warm.median < 2.5 && warm.worst < 5,
    `WARM: ${warm.median.toFixed(2)} ms median over windows of ${warm.window} ticks, ${warm.worst.toFixed(2)} ms in the ` +
    "costliest window, garbage collection included");
  ok(warm.payloadBytes <= L.LIVE_KEYS["live:market"].maxBytes, `writing ${warm.payloadBytes} bytes of live:market`);
  console.log(`  tier 1 CPU: cold ${coldCpu.toFixed(2)} ms (${colds[0].clock}, mean of 10), cold wall ${coldWall.toFixed(2)} ms ` +
    `(median), warm ${warm.median.toFixed(2)} ms median, ${warm.worst.toFixed(2)} ms worst window`);
}

{
  const S = "2026-09-23";
  const at = (hm, day = S) => easternInstant(day, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));
  deep(["09:28", "09:33", "15:58", "16:08", "16:13"].map((hm) => W.focusDue(at(hm))), [false, true, true, true, false],
    "THE FOCUS TICK IS DUE while Tier 1 is: from the open to ten minutes past the close, so the session's last read " +
    "is its final reading");
  eq(W.focusDue(at("11:08", "2026-09-26")), false, "never on a weekend");
  const thanks = "2026-11-26";
  ok(tier1Due(at("09:48", thanks)) && !W.focusDue(at("09:48", thanks)) && !W.focusDue(at("11:08", thanks)),
    "and never on a computed holiday, not even in the 09:45 probe window where Tier 1 alone reads the tape to test " +
    "the calendar");
  ok(W.focusDue(at("11:08", thanks), { day: thanks, trading: 1 }), "unless that probe saw the day trade");
  ok(!W.focusDue(at("11:08"), { day: S, trading: 0 }), "and never on a day the tape closed");
  deep(["13:08", "13:13"].map((hm) => W.focusDue(at(hm, "2026-11-27"))), [true, false],
    "an early close ends it ten minutes after 13:00");

  const groups = focusGroupsSample();
  const names = ["GLD", "GDX", "NEM", "AEM", "SLV", "SIL", "PAAS", "WPM", "CPER", "COPX", "FCX", "SCCO", "AAPL", "MSFT",
    "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AVGO", "NFLX", "COST"];
  deep(W.focusNames(JSON.stringify(groups)), { names, source: "focus" },
    "THE FOCUS NAMES come from the stored nightly groups: lead first, in order, once each — the metals, the Mag 7 and " +
    "whatever the nightly derived for the NDX 10, 22 names");
  deep(W.focusNames(JSON.stringify(groups)), focusStripNames({ groups }),
    "exactly the names the Actions strip plans from the same payload");
  deep(W.focusNames(null), { names: [...FOCUS_FALLBACK], source: "constants" },
    "with no stored payload, the shared/flows-focus.js roster");
  eq(W.focusNames("{not json").source, "constants", "and so with an unreadable one");
  eq(W.focusNames(JSON.stringify([{ tickers: Array.from({ length: 60 }, (_, i) => "Q" + i) }])).names.length,
    L.LIVE_BUDGET.stripFocusMax, "a runaway list is capped at the strip's own focus share");

  const calls = [];
  const logs = [];
  const log = { error: (line) => logs.push(JSON.parse(line)) };
  const vendor = (make) => async (path, params) => { calls.push({ path, params }); return make(params); };
  const good = (params) => productionScreenerBody(String(params.ticker).split(","), { session: S, readAt: at("10:07") });
  const writes = (db) => db.statements.filter((x) => /INSERT INTO flows_live/.test(x.sql));
  const env = (db, extra = {}) => ({ DB: db, UW_API_KEY: "k", ...extra });

  for (const [label, t, clock] of [["before the open", at("09:28"), null], ["on a Saturday", at("11:08", "2026-09-26"), null],
    ["in a computed holiday's probe window", at("09:48", thanks), null], ["on a day the tape closed", at("11:08"), { day: S, trading: 0 }]]) {
    const db = focusDb({ groups, clock });
    const r = await W.focusTick(env(db), t, { fetchVendor: vendor(good), log });
    ok(r.why === "not-due" && calls.length === 0 && writes(db).length === 0 && logs.length === 0,
      `${label} the focus tick spends no vendor call and writes nothing`);
  }
  {
    const db = focusDb({ groups });
    const off = await W.focusTick(env(db, { FLOWS_LIVE_MODE: "off" }), at("10:08"), { fetchVendor: vendor(good), log });
    const keyless = await W.focusTick({ DB: db }, at("10:08"), { fetchVendor: vendor(good), log });
    ok(off.skipped === "off" && keyless.why === "no-key" && calls.length === 0 && writes(db).length === 0,
      "FLOWS_LIVE_MODE = off rolls it back with Tier 1, and without the vendor key it reads nothing");
  }

  const db = focusDb({ groups });
  const r = await W.focusTick(env(db), at("10:08"), { fetchVendor: vendor(good), log });
  eq(calls.length, 1, "ONE VENDOR CALL a tick");
  deep(calls[0], { path: "/api/screener/stocks", params: { ticker: names.join(","), limit: 500 } },
    "the screener read the Actions strip makes, for the focus names only");
  ok(read("scripts/flows-legs/live.mjs").includes(
    `read("${W.FOCUS_READ.path}", { ticker: plan.names.join(","), limit: ${W.FOCUS_READ.limit} })`),
  "the same path and parameters as the live leg's strip read, character for character");
  const w = writes(db);
  eq(w.length, 1, "one write");
  const [key, text, readAt, session, cadence, source, writer] = w[0].args;
  deep([key, readAt, session, cadence, source, writer], ["live:focus", at("10:08"), S, 300, "worker", W.FOCUS_WRITER],
    "live:focus, stamped with the cron's scheduled instant, today's Eastern session, the market cadence and the " +
    "Worker as its writer");
  ok(/WHERE excluded\.read_at >= flows_live\.read_at/.test(w[0].sql), "through the same newer-only upsert as live:market");
  const p = JSON.parse(text);
  const strips = L.shapeStrips(good({ ticker: names.join(",") }), { at: at("10:08"), session: S, names });
  deep(p.rows, strips.rows, "A ROW IS EXACTLY A live:strips ROW: the same stripValues over the same vendor row");
  deep(Object.keys(p).sort(), Object.keys(strips).sort(), "in the live:strips envelope, so the page reads both with one picker");
  deep([p.key, p.session, p.status, p.fields.join(), p.fresh.source, p.fresh.cadenceS, p.fresh.readAt, p.fresh.session,
    p.fresh.writer], ["live:focus", S, "ok", L.STRIP_FIELDS.map(([n]) => n).join(), "worker", 300,
    new Date(at("10:08")).toISOString(), S, W.FOCUS_WRITER], "its own key and fresh envelope");
  ok(L.checkLiveWrite("live:focus", p, {}).ok && L.checkLiveWrite("live:focus", p, { source: "actions" }).code === "wrong_writer",
    "an envelope the registry accepts from its writer and refuses from Actions");
  deep([r.written, r.why, r.asked, r.hit, r.source], [true, "written", 22, 22, "focus"], "and the tick says what it did");
  eq(logs.length, 0, "a good tick logs nothing");
  {
    const fdb = focusDb({ groups: null });
    const fr = await W.focusTick(env(fdb), at("10:13"), { fetchVendor: vendor(good), log });
    ok(fr.written && fr.source === "constants" && calls.at(-1).params.ticker === FOCUS_FALLBACK.join(","),
      "BEFORE THE NIGHTLY HAS WRITTEN focus the tick reads the constants' roster and still writes");
  }
  {
    const broken = { ...focusDb({ groups }), batch: async () => { throw new Error("D1 unavailable"); } };
    broken.statements = [];
    const br = await W.focusTick(env(broken), at("10:18"), { fetchVendor: vendor(good), log });
    ok(br.written && br.source === "constants", "an unreadable store falls back to the roster and the computed calendar");
  }

  const other = (n) => productionScreenerBody(Array.from({ length: n }, (_, i) => "ZZ" + i), { session: S, readAt: at("10:07") });
  const cases = [
    ["a vendor call that fails", () => { throw new Error("Market data provider returned an error"); }, "vendor-failed"],
    ["an empty vendor answer", () => ({ data: [] }), "vendor-empty"],
    ["rows from the previous session", (q) => productionScreenerBody(String(q.ticker).split(","), { session: "2026-09-22",
      readAt: at("10:07") }), "vendor-prior-session"],
    ["rows with no price", (q) => ({ data: String(q.ticker).split(",").map((t) => ({ ticker: t, date: S })) }), "none-priced"],
    ["rows for none of the names asked", () => other(3), "none-priced"],
    ["a runaway answer over the cap", (q) => ({ data: [...good(q).data, ...other(200).data] }), "over-cap"],
  ];
  for (const [label, make, why] of cases) {
    const cdb = focusDb({ groups });
    logs.length = 0;
    const cr = await W.focusTick(env(cdb), at("10:23"), { fetchVendor: vendor(make), log });
    ok(cr.written === false && cr.why === why && writes(cdb).length === 0,
      `A FAILED OR EMPTY READ NEVER OVERWRITES THE LAST GOOD VALUE: ${label} writes nothing (${cr.why}), so the held ` +
      "row keeps its own read time, and nothing is ever written as a zero");
    ok(logs.length === 1 && logs[0].message === "live:focus not written" && logs[0].why === why,
      `and logs one JSON error line naming why (${label})`);
  }
  {
    const full = { session: S, read_at: at("10:18"), priced: JSON.stringify(names) };
    const three = (q) => productionScreenerBody(String(q.ticker).split(",").slice(0, 3), { session: S, readAt: at("10:22") });
    const unpricedOne = (q) => { const b = good(q); b.data[5].close = null; return b; };
    const tickWith = async (held, t, make = three) => {
      const hdb = focusDb({ groups, held });
      logs.length = 0;
      const res = await W.focusTick(env(hdb), t, { fetchVendor: vendor(make), log });
      return { ...res, wrote: writes(hdb).length, said: logs.map((l) => l.why) };
    };
    const partial = await tickWith(full, at("10:23"));
    ok(partial.why === "partial" && partial.written === false && partial.wrote === 0 && partial.hit === 3 &&
       partial.lost === 19 && partial.said.join() === "partial" && logs[0].lost.join() === names.slice(3, 13).join(),
    "A PARTIAL READ NEVER REPLACES A FULLER HELD ROW: 3 of 22 names priced while the 10:18 read of all 22 is still " +
      "live writes nothing, so Home keeps showing every name live, and logs one line naming why and the first names lost");
    const lost = await tickWith(full, at("10:23"), unpricedOne);
    ok(lost.why === "partial" && lost.wrote === 0 && lost.hit === 21 && lost.lost === 1, "and so is a read that " +
      "returns every name but lost one name's price, which the held row had");
    const still = await tickWith(full, at("10:28"));
    const aged = await tickWith(full, at("10:33"));
    ok(still.why === "partial" && aged.written === true && aged.wrote === 1 && aged.lost === 0,
      "ONCE THE HELD ROW LEAVES ITS 11-MINUTE LIVE WINDOW the partial read is written: a name the vendor stops " +
        "returning holds the key back for two ticks at most (10:23 and 10:28), never for the rest of the session");
    const yesterday = await tickWith({ ...full, session: "2026-09-22" }, at("10:23"));
    ok(yesterday.written === true && yesterday.wrote === 1, "a held row of an earlier session never holds back today's reads");
    const level = await tickWith({ ...full, priced: JSON.stringify(names.slice(0, 3)) }, at("10:23"));
    const whole = await tickWith(full, at("10:23"), good);
    ok(level.written && whole.written && whole.hit === 22 && whole.said.length === 0,
      "while a read that prices every name the held row priced, or a complete one after a complete one, is written");
    const before = [...new Set([...FOCUS_FALLBACK, ...names, "SPY", "QQQ"])];
    const shrunk = await tickWith({ ...full, priced: JSON.stringify(before) }, at("10:23"), good);
    ok(before.length > names.length && shrunk.written && shrunk.lost === 0 && shrunk.hit === 22,
      "A ROSTER THAT CHANGED MID-SESSION IS NOT A PARTIAL READ: when the nightly focus key lands and the names asked " +
        "change, only a name the held row priced AND this tick asked for counts as lost, so a complete read of the new " +
        "roster is written at once");
    const unread = await tickWith(null, at("10:23"));
    const garbled = await tickWith({ ...full, priced: "[not json" }, at("10:23"));
    ok(unread.written && unread.lost === 0 && garbled.written, "and with no held row, or an unreadable list, the " +
      "first read of any size is written");
  }
  ok(/SELECT session, read_at, \(SELECT json_group_array\(r\.key\) FROM json_each\(payload, '\$\.rows'\)/.test(W.FOCUS_HELD_SQL) &&
     /f\.value = 'px'/.test(W.FOCUS_HELD_SQL) && /id = 'live:focus' AND json_valid\(payload\)/.test(W.FOCUS_HELD_SQL),
  "the held row's priced names are listed in D1, in the same batch as the clock and the groups, with px found by the " +
    "held payload's own field list, so the held rows never reach the isolate");
  const forty =productionScreenerBody(Array.from({ length: L.LIVE_BUDGET.stripFocusMax }, (_, i) => "F" + i),
    { session: S, readAt: at("10:07") });
  const fortyBytes = JSON.stringify(L.shapeStrips(forty, { at: at("10:08"), session: S, key: "live:focus" })).length;
  ok(fortyBytes <= L.LIVE_KEYS["live:focus"].maxBytes && fortyBytes > 0.4 * L.LIVE_KEYS["live:focus"].maxBytes,
    `a full ${L.LIVE_BUDGET.stripFocusMax}-name live:focus is ${fortyBytes} bytes, inside its ` +
    `${L.LIVE_KEYS["live:focus"].maxBytes} and near enough that the cap certifies something`);
}

{
  const child = (arg) => {
    const out = execFileSync("node", [new URL("tests/live-stubs.mjs", ROOT).pathname, "--focus-budget", ...arg],
      { encoding: "utf8" });
    return JSON.parse(out.trim().split("\n").pop());
  };
  const colds = Array.from({ length: 10 }, () => child(["cold"]));
  ok(colds.every((c) => c.written && c.hit === 22 && c.asked === 22 && c.lost === 0),
    "the budget child's cold focus ticks each wrote all 22 focus names, over a held row of the same 22 read five " +
      "minutes earlier, so every tick runs the partial-read guard as every tick after a session's first does");
  const coldCpu = colds.reduce((a, c) => a + c.cold, 0) / colds.length;
  const walls = colds.map((c) => c.coldWall).sort((a, b) => a - b);
  const coldWall = (walls[4] + walls[5]) / 2;
  const warm = child([]);
  ok(warm.rows === 22 && warm.fields >= 202 && warm.bytes / warm.rows > 6000,
    `the vendor body is production-size: ${warm.rows} screener rows of ${warm.fields} fields each, every field the ` +
    `probe recorded on the live screener row, ${warm.bytes} bytes of JSON`);
  ok(coldCpu < 6,
    `COLD ISOLATE: the first focus tick of a fresh process (lazy compilation and the body's JSON.parse included) ` +
    `takes ${coldCpu.toFixed(2)} ms of ${colds[0].clock} time, the mean of ten processes, under 6 ms of the 10 ms cap`);
  ok(coldWall < 8, `its median wall time is ${coldWall.toFixed(2)} ms`);
  ok(warm.median < 2 && warm.worst < 4,
    `WARM: ${warm.median.toFixed(2)} ms median over windows of ${warm.window} ticks, ${warm.worst.toFixed(2)} ms in the ` +
    "costliest window");
  ok(warm.payloadBytes <= L.LIVE_KEYS["live:focus"].maxBytes, `writing ${warm.payloadBytes} bytes of live:focus`);
  console.log(`  focus CPU: cold ${coldCpu.toFixed(2)} ms (${colds[0].clock}, mean of 10), cold wall ${coldWall.toFixed(2)} ms ` +
    `(median), warm ${warm.median.toFixed(2)} ms median, ${warm.worst.toFixed(2)} ms worst window, ${warm.bytes} bytes ` +
    `read, ${warm.payloadBytes} written`);
}

{
  let reads = 0;
  const landed = { id: 1, day: "2026-09-28", trading: 1 };
  const env = { DB: { prepare: () => ({ first: () => (++reads === 1 ? new Promise(() => {}) : new Promise((r) => setTimeout(() => r(landed), 1500))) }) } };
  W.memoClock(null, 0);
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    W.cachedClock(env, t0),
    new Promise((r) => setTimeout(r, 50)).then(() => W.cachedClock(env, Date.now())),
  ]);
  const waited = Date.now() - t0;
  ok(a && a.day === "2026-09-28" && a.trading === 1 && b === a && waited >= 3500 - TIMER_SLACK_MS && waited < 6000,
     `THE CLOCK FLIGHT HAS THE SAME DEADLINE as the schema bootstrap (FLIGHT_WAIT_MS, ${W.FLIGHT_WAIT_MS} ms): a cold read that never settles is abandoned and read again, ` +
     `and both waiters take the read that landed (${waited} ms)`);
  eq(reads, 2, "once, for both waiters: the second's deadline falls while the retry is in the air and it joins the retry rather than starting a third read");
  ok(!W.clockDue(Date.now()), "and the memo is warm from the read that landed");
  W.memoClock(null, 0);
  let late = 0;
  const env2 = { DB: { prepare: () => ({ first: () => (++late === 1 ? new Promise(() => {}) : Promise.resolve(landed)) }) } };
  const t1 = Date.now();
  const [c, d] = await Promise.all([
    W.cachedClock(env2, t1),
    new Promise((r) => setTimeout(r, 1900)).then(() => W.cachedClock(env2, Date.now())),
  ]);
  const w2 = Date.now() - t1;
  ok(c && c.day === "2026-09-28" && d === c && w2 >= 2000 - TIMER_SLACK_MS && w2 < 2700 && late === 2,
     `a late joiner leaves the dead flight the moment the retry lands (${w2} ms), not at its own deadline`);
  W.memoClock(null, 0);
  ok(await W.settledWithin(Promise.resolve(1), 50) === "settled" && await W.settledWithin(Promise.reject(new Error("x")), 50) === "settled" &&
     await W.settledWithin(new Promise(() => {}), 50) === false && await W.settledWithin(new Promise(() => {}), 500, () => true) === "moved",
     "settledWithin says settled on any settlement, moved when the field it watches has moved on, and false at the deadline");
}

console.log(`✓ flows-live: ${checks} assertions — one threshold table in code; phases on the Eastern clock at every ` +
  `boundary under EDT and EST, a tape-derived holiday and early close; states and absolute instants for every class; ` +
  `the Tier 1 and Tier 2 clocks, in-flight dispatch and a once-only nightly retry; probe rows shaped to known answers ` +
  `with absent inputs null, never zero; the 0DTE share, lean, term slope and front inversion, the scaled strip series ` +
  `and its session reset; gamma rotation with carried readings under their own read time; the live alert union with ` +
  `its empty-read guard, cursor, floor and session reset; read-time overlays instead of a second writer; one writer ` +
  `per key and a credential per namespace, the live one a GitHub OIDC token checked claim by claim; full-session byte ceilings; the five-layer archive immutability scan; the ` +
  `--live dry run; buckets sampled at their last row with values under the vendor's pre-filled nulls; Tier 1 in two ` +
  `feeds under the 10 ms CPU cap cold and warm, with D1 telemetry that names every tick's outcome; a holiday verdict ` +
  `that is provisional until two probes fifteen minutes apart agree, re-probed until 11:00, with the closed days kept; ` +
  `the focus names read ahead of the boards in the one strip call; live:focus from the Worker's own third cron, one ` +
  `screener call inside the session window, rows identical to the strip's, never a failed or empty read nor a partial one over a fuller live row, under 6 ms ` +
  `of CPU cold over a production-size body; the nightly health gate and the live job's exit ` +
  `rule; the self-sustaining ` +
  `Tier 2 session loop, its budget and its chain dispatch; starters that land at least seven times in the wait ` +
  `before 09:31 ET for every delivery delay up to five hours, under EDT and EST, each a chance at the one run that ` +
  `waits; a delivery log timed from the run's created_at; and a client helper that only compares clocks`);
