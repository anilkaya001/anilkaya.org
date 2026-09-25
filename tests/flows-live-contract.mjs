import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import {
  FRESH_CLASSES, REFRESH_CADENCE_MINUTES, PHASE_MINUTES, phaseAt, freshnessState, freshHeaders, expectedNightlySession,
  easternInstant, tier1Due, liveDispatchDue, liveStalled, nightlyDispatchDue, sessionClose,
} from "../shared/flows-freshness.js";
import * as L from "../shared/flows-live.js";
import * as W from "../shared/flows-live-worker.js";
import * as FAKE from "../scripts/flows-legs/live-fake.mjs";
import {
  readHeldAlerts, boardPlan, liveWindow, runLive, runLiveLoop, chainDispatch, nextSlot, LIVE_LOOP, readLiveClock,
  sessionClock,
} from "../scripts/flows-legs/live.mjs";
import {
  shapeNews, liveCredential, liveCredentialSource, LIVE_BEARER_MARGIN_MS, resetPublishRetryBudget,
} from "../scripts/flows-pipeline.mjs";
import * as O from "../shared/flows-oidc.js";
import { oidcIssuer, tickDb, tier1Bodies } from "./live-stubs.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const FX = JSON.parse(read("tests/fixtures-live-probe.json"));

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const T = (iso) => Date.parse(iso);

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
  eq(Object.values(L.LIVE_KEYS).filter((s) => s.writer === "worker").length, 1,
    "exactly one live key is written by the Worker itself (live:market); every other live key has the Actions run " +
    "as its single writer");
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

  const names = L.stripNames(FAKE.fakeBoards({ n: 60 }) && {
    long: FAKE.fakeBoards({ n: 60 }).long.rows.map((r) => r.t), short: FAKE.fakeBoards({ n: 60 }).short.rows.map((r) => r.t),
    watch: FAKE.fakeBoards({ n: 60 }).watch.rows.map((r) => r.t) });
  eq(names.length, L.LIVE_BUDGET.stripMax, "the strip takes at most 120 names in one call");
  deep(names.slice(0, 3), ["SPY", "QQQ", "IWM"], "the index rows come first so the vol regime never falls off the end");
  const strips = L.shapeStrips(FAKE.fakeScreenerRows(names, { session }), { at: end, session, names });
  let series = null;
  for (let i = 0; i < 28; i++) {
    series = L.appendStripSeries(series, strips, { at: easternInstant(session, 9 * 60 + 37 + i * 15), session });
  }
  const sBytes = JSON.stringify(series).length;
  ok(series.t.length === 27 + 1 && sBytes <= L.LIVE_KEYS["live:strips:series"].maxBytes,
    `a full session of 15-minute columns for 120 names is ${sBytes} bytes (${series.t.length} points)`);
  ok(JSON.stringify(strips).length <= L.LIVE_KEYS["live:strips"].maxBytes, "and the snapshot fits its key");
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
  deep(crons, ["31 13,14 * * 1-5", "3 15-20 * * 1-5"],
    "STARTERS, not a schedule: 13:31 and 14:31 UTC start the loop at the open under EDT and EST, and every hour at :03 " +
    "from 15:03 to 20:03 restarts it if GitHub dropped a starter or a run died, so a dropped slot costs an hour at most " +
    "— a starter that queues behind a running loop exits at once when it finally starts outside the window");

  const migration = read("migrations/0010_flows_live.sql");
  const clockMigration = read("migrations/0011_flows_clock_tier1.sql");
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
  const added = [...clockMigration.matchAll(/ALTER TABLE flows_clock ADD COLUMN (\w+) (\w+);/g)].map((m) => [m[1], m[2]]);
  deep(added, W.CLOCK_ADDED_COLUMNS.map((c) => [...c]),
    "TIER 1 TELEMETRY: 0011 adds tier1_at, tier1_ok_at and tier1_why to flows_clock, and the Worker's first-use path " +
    "adds exactly those columns to a production table that predates them");
  eq(clockMigration.trim().split("\n").length, added.length, "and 0011 does nothing else");
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
    "and flows_clock with 0010's columns plus 0011's, in the order an upgraded production table has them");
  deep(cols(schema, "flows_clock"), clockCols, "as schema.sql declares it");
  const toml = read("wrangler.toml");
  eq(W.cronJob(W.RTH_CRON, T("2026-09-23T15:16:00Z")), "rth", "the market-hours cron runs the Tier 1 tick");
  eq(W.cronJob(W.HOUSEKEEPING_CRON, T("2026-09-23T15:30:00Z")), "housekeeping", "the half-hour cron runs housekeeping");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T15:15:00Z")), "rth",
    "a trigger the deploy left behind still drives Tier 1 inside the session window, off the half hour");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T15:30:00Z")), "housekeeping", "and keeps the half hour for housekeeping");
  eq(W.cronJob("*/15 * * * *", T("2026-09-26T15:15:00Z")), "housekeeping", "never on a Saturday");
  eq(W.cronJob("*/15 * * * *", T("2026-09-23T03:15:00Z")), "housekeeping", "and never outside the 13-21 UTC window");
  ok(/FLOWS_LIVE\.cronJob\(event && event\.cron, at\) === "rth"/.test(worker),
    "the scheduled handler routes by the job a trigger's instant calls for, not by the trigger's exact string");
  ok(toml.includes(`"${W.RTH_CRON}"`) && toml.includes(`"${W.HOUSEKEEPING_CRON}"`),
    "the two crons the Worker branches on are the two wrangler.toml registers");
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
    deep(keys.sort(), Object.keys(L.LIVE_KEYS).filter((k) => k !== "live:market").sort(),
      "--live --dry-run emits every Tier 2 key and nothing else");
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
  eq(UI.freshAggregate(["live", "fresh"], "rth"), "live", "page aggregate: live if any module is live");
  eq(UI.freshAggregate(["live", "stale"], "rth"), "stale", "stale if any is stale");
  eq(UI.freshAggregate(["fresh", "closed"], "post"), "closed", "closed outside the session when nothing is live");
  eq(UI.freshAggregate([], "rth"), "pending", "and pending before any payload");
  deep([UI.heartbeatInterval("rth", "ticker"), UI.heartbeatInterval("rth", "market"), UI.heartbeatInterval("pre", "x"),
    UI.heartbeatInterval("closed", "x"), UI.heartbeatInterval("rth", "ticker", true)], [10000, 30000, 60000, null, null],
  "one heartbeat per page: 10 s on a ticker in session, 30 s elsewhere, 60 s pre/post, none closed or hidden");
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
  eq(early.col("tier1_why"), "not-due", "a tick before the open is not-due");
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
  deep(await W.upgradeClockColumns(fakeDb(["id", "day", "tier1_at"])), ["tier1_ok_at", "tier1_why"],
    "THE PRODUCTION TABLE UPGRADES ITSELF: the first-use path adds only the telemetry columns flows_clock lacks");
  deep(upgrades, ["ALTER TABLE flows_clock ADD COLUMN tier1_ok_at INTEGER", "ALTER TABLE flows_clock ADD COLUMN tier1_why TEXT"],
    "with one ALTER TABLE ADD COLUMN each");
  deep(await W.upgradeClockColumns(fakeDb(["id"], ["tier1_at", "duplicate column name: tier1_at"])), ["tier1_ok_at", "tier1_why"],
    "a racing isolate that added a column first is tolerated (duplicate column)");
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
    const tg = sim(easternInstant("2026-11-26", 9 * 60 + 31));
    let tgPasses = 0;
    const scheduled = await runLiveLoop({ now: tg.now, sleep: tg.sleep, log: () => {},
      readClock: async () => ({ day: "2026-11-26", trading: null, earlyClose: null }),
      pass: async () => { tgPasses++; return {}; }, chain: async () => { throw new Error("never chain on a holiday"); } });
    ok(scheduled.why === "not-trading" && tgPasses === 0,
      "while a scheduled NYSE holiday (Thanksgiving) is closed by the computed calendar before any pass, with no verdict needed");
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
    deep(W.clockView({ day: S, trading: null, earlyClose: "1", tier1At: 5 }), { day: S, trading: null, earlyClose: 1 },
      "the Worker's view of its clock is the day and its two verdicts, NULL kept as undecided, nothing else");
    const ingestSrc = read("worker.js");
    ok(/if \(key === "clock"\) \{\s*requireMethod\(request, \["GET"\]\);\s*await ensureFlowsTables\(env\);\s*return FLOWS_LIVE\.serveIngestClock\(env, \{ json \}\);/
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

console.log(`✓ flows-live: ${checks} assertions — one threshold table in code; phases on the Eastern clock at every ` +
  `boundary under EDT and EST, a tape-derived holiday and early close; states and absolute instants for every class; ` +
  `the Tier 1 and Tier 2 clocks, in-flight dispatch and a once-only nightly retry; probe rows shaped to known answers ` +
  `with absent inputs null, never zero; the 0DTE share, lean, term slope and front inversion, the scaled strip series ` +
  `and its session reset; gamma rotation with carried readings under their own read time; the live alert union with ` +
  `its empty-read guard, cursor, floor and session reset; read-time overlays instead of a second writer; one writer ` +
  `per key and a credential per namespace, the live one a GitHub OIDC token checked claim by claim; full-session byte ceilings; the five-layer archive immutability scan; the ` +
  `--live dry run; buckets sampled at their last row with values under the vendor's pre-filled nulls; Tier 1 in two ` +
  `feeds under the 10 ms CPU cap cold and warm, with D1 telemetry that names every tick's outcome; the self-sustaining ` +
  `Tier 2 session loop, its budget and its chain dispatch; and a client helper that only compares clocks`);
