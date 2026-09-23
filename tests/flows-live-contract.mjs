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
import { readHeldAlerts, boardPlan, liveWindow, runLive } from "../scripts/flows-legs/live.mjs";
import { shapeNews } from "../scripts/flows-pipeline.mjs";

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
  eq(FRESH_CLASSES.nightly.graceS, 3 * 3600, "and a nightly session is due three hours after its close");
  eq(REFRESH_CADENCE_MINUTES, 5, "the cadence the pulse stamp quotes is the Tier 1 clock's");
  for (const [key, spec] of Object.entries(L.LIVE_KEYS)) {
    ok(L.LIVE_KEY_RE.test(key) && spec.cadenceS === FRESH_CLASSES[spec.klass].cadenceS && spec.maxBytes <= 120 * 1024,
      `${key} is a live:* key with its class's cadence and a byte cap under the ingest's 128 KB (${spec.maxBytes})`);
  }
  eq(Object.values(L.LIVE_KEYS).filter((s) => s.writer === "worker").length, 1,
    "exactly one live key is written by the Worker itself (live:market); every other live key has the Actions run " +
    "as its single writer");
  eq(L.TIER1_CALLS.length, L.LIVE_BUDGET.tier1Calls, "Tier 1 spends five vendor calls a tick");
  eq(L.TIER1_CALLS.length, 5, "and five is the budget the design set");
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
    "A TAPE-DERIVED HOLIDAY (flows_clock.trading = 0 for today) is closed through the session — the repo holds no calendar");
  eq(phaseAt(edt("11:00"), holiday).lastClosed, "2026-09-22", "and its last closed session is the day before");
  const half = { day: "2026-11-27", earlyClose: 1 };
  eq(phaseAt(T("2026-11-27T13:30:00-05:00"), half).phase, "post", "A TAPE-DERIVED EARLY CLOSE ends the session at 13:00");
  eq(new Date(sessionClose("2026-11-27", half)).toISOString(), "2026-11-27T18:00:00.000Z", "13:00 EST is 18:00Z");
  eq(phaseAt(T("2026-11-27T13:30:00-05:00")).phase, "rth", "without the clock's word it is an ordinary afternoon");

  eq(expectedNightlySession(T("2026-09-23T18:59:00-04:00")), "2026-09-22",
    "the nightly for a session is not due until 19:00 ET (close + 3 h)");
  eq(expectedNightlySession(T("2026-09-23T19:00:00-04:00")), "2026-09-23", "and is due from then");
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
  eq(freshnessState(night, T("2026-09-23T23:00:01Z")).state, "stale",
    "and stale from 19:00 ET, when tonight's run was due — three hours, not the old 30");
  eq(freshnessState(night, T("2026-09-23T15:00:00Z")).staleAt, T("2026-09-23T23:00:00Z"),
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

  const feeds = (d, now) => ({ tide: FAKE.fakeMarketTide({ session: d, now }), zeroDte: FAKE.fakeNetFlow({ session: d, now }),
    spy: FAKE.fakeEtfTide("SPY", { session: d, now }), qqq: FAKE.fakeEtfTide("QQQ", { session: d, now }) });
  const y = feeds("2026-09-22", easternInstant("2026-09-22", 16 * 60));
  const t = feeds(day, et(9, 45));
  eq(L.tideSessionState(y, { today: day, afterProbe: true }), 0,
    "THE HOLIDAY VERDICT: after 09:45, when every feed still carries the previous session, today is not trading");
  eq(L.tideSessionState({ ...t, tide: y.tide }, { today: day, afterProbe: true }), 1,
    "but ONE feed lagging behind the others is not a holiday — the verdict is sticky for the whole day and stops " +
    "Tier 1 and every dispatch, so a single stale market-tide body must not be able to cast it");
  eq(L.tideSessionState({ tide: y.tide, zeroDte: { __failed: "HTTP 502" } }, { today: day, afterProbe: true }), null,
    "and a lone stale feed with the rest unanswered is no verdict yet: the next tick asks again");
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
    tide: FAKE.fakeMarketTide({ session, now: end }), zeroDte: FAKE.fakeNetFlow({ session, now: end }),
    spy: FAKE.fakeEtfTide("SPY", { session, now: end }), qqq: FAKE.fakeEtfTide("QQQ", { session, now: end }),
    sectors: FAKE.fakeSectorEtfs({ session }),
  }, { at: end, session });
  const mBytes = JSON.stringify(market).length;
  ok(mBytes <= L.LIVE_KEYS["live:market"].maxBytes && market.tide.n >= 78 && market.zeroDte.n >= 78,
    `a FULL-SESSION live:market (${market.tide.n} tide points, ${market.zeroDte.n} 0DTE points) is ${mBytes} bytes, ` +
    `inside its ${L.LIVE_KEYS["live:market"].maxBytes}`);
  ok(mBytes > 0.4 * L.LIVE_KEYS["live:market"].maxBytes, "and genuinely near the cap, so the cap certifies something");
  const sectors = {};
  for (const { sector } of L.SECTOR_TIDES) sectors[sector] = FAKE.fakeSectorTide(sector, { session, now: end });
  const breadth = L.shapeBreadth({ sectors, etf: { IWM: FAKE.fakeEtfTide("IWM", { session, now: end }),
    DIA: FAKE.fakeEtfTide("DIA", { session, now: end }) }, zeroDte: FAKE.fakeNetFlow({ session, now: end }),
  weekly: FAKE.fakeNetFlow({ session, now: end, expiration: "weekly" }) }, { at: end, session });
  const bBytes = JSON.stringify(breadth).length;
  ok(bBytes <= L.LIVE_KEYS["live:breadth"].maxBytes && breadth.sectors.t.length >= 78,
    `a full-session live:breadth with eleven aligned sector tides is ${bBytes} bytes`);
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
  ok(/LIVE_MODE \? process\.env\.FLOWS_LIVE_TOKEN : process\.env\.FLOWS_INGEST_TOKEN/.test(pipeline),
    "LAYER 2 (credential): --live authenticates with the live token only");
  const wf = read(".github/workflows/flows-live.yml");
  ok(!/FLOWS_INGEST_TOKEN/.test(wf) && /FLOWS_LIVE_TOKEN: \$\{\{ secrets\.FLOWS_LIVE_TOKEN \}\}/.test(wf),
    "and the live workflow's environment does not contain the nightly token at all");
  ok(/concurrency:\s*\n\s*group: flows-live\s*\n\s*cancel-in-progress: false/.test(wf) && /timeout-minutes: 8/.test(wf),
    "one live run at a time, eight minutes at most");
  ok(/cron: "7,22,37,52 13-20 \* \* 1-5"/.test(wf), "with a backup schedule that exits at once outside the session");

  const migration = read("migrations/0010_flows_live.sql");
  const schema = read("schema.sql");
  ok(schema.includes(migration.trim()), "LAYER 3 and 4 (table, storage): schema.sql carries the migration verbatim");
  ok(/id\s+TEXT PRIMARY KEY CHECK \(id GLOB 'live:\*'\)/.test(migration), "flows_live refuses any id outside live:*");
  ok(/BEFORE UPDATE ON flows_payload[\s\S]*RAISE\(ABORT, 'flows archive rows are immutable'\)/.test(migration),
    "and a trigger makes the dated archive immutable at the storage layer");
  ok(!/ALTER TABLE/.test(migration), "every statement is IF NOT EXISTS, so applying it twice is safe");
  const cols = (sql, table) => {
    const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\)(?:;|")`).exec(sql);
    return body ? body[1].split(",").map((c) => c.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c)) : [];
  };
  const workerDdl = W.LIVE_SCHEMA_SQL.join(";\n") + ";";
  for (const table of ["flows_live", "flows_tape", "flows_clock"]) {
    deep(cols(workerDdl, table), cols(migration, table),
      `the Worker's first-use fallback creates ${table} with exactly the migration's columns`);
  }
  const toml = read("wrangler.toml");
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
    "TIER 1 likewise: when none of its five feeds answered, live:market is not rewritten");
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

console.log(`✓ flows-live: ${checks} assertions — one threshold table in code; phases on the Eastern clock at every ` +
  `boundary under EDT and EST, a tape-derived holiday and early close; states and absolute instants for every class; ` +
  `the Tier 1 and Tier 2 clocks, in-flight dispatch and a once-only nightly retry; probe rows shaped to known answers ` +
  `with absent inputs null, never zero; the 0DTE share, lean, term slope and front inversion, the scaled strip series ` +
  `and its session reset; gamma rotation with carried readings under their own read time; the live alert union with ` +
  `its empty-read guard, cursor, floor and session reset; read-time overlays instead of a second writer; one writer ` +
  `per key and a token per namespace; full-session byte ceilings; the five-layer archive immutability scan; the ` +
  `--live dry run; and a client helper that only compares clocks`);
