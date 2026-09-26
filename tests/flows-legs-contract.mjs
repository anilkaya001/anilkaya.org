import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  vnum, isoDay, addDays, sessionsBetween, nextWeekdayIso, pctRanks, pctOf, zScores, ownZ, termSlope, frontStress,
  ivChange, vrpTrailing, gexPerAdv, sharesPerAdv, gammaDollarsPerAdv, vegaDollarsPerAdv, netTilt,
  sectorTilts, bandPosition, impliedCorrelation, compactNumbers, buildUniverse, universeValue,
  decodeColumn, UNIVERSE_COLUMNS, UNIVERSE_BUDGET_BYTES, SILENCE,
} from "../shared/flows-cross.js";
import {
  seriesPoints, sessionNet, parseNetFlow, zeroDteShare, buildZeroDte, tideSummary, greekFlowTotals,
  groupAlignment, groupMembers, fundFlowSummary, putCallHistory, volCurveFromScreener, shapeDailyReport,
  shapeOptionsPulse, holdingsMembers, vendorGate, downsample,
} from "../shared/flows-regime.js";
import {
  latestShortInterest, borrowSummary, shortVolumeSummary, insiderSummary, squeezePressure, HTB_FEE,
} from "../shared/flows-ownership.js";
import {
  reactionDay, earningsHistory, historyDigest, shapeEarningsCalendar, reactionGauge,
  shapeEconomicCalendar, macroTag, parseFdaTarget, shapeFdaCalendar, sessionCloseInstant,
} from "../shared/flows-catalysts.js";
import { rowsOf, read } from "../scripts/flows-legs/common.mjs";
import {
  harvestScreener, readShortInterest, readInsiders, readIndexRows, harvestBlock, readHoldings, withPrefetched,
  fetchMissingMembers, readFocusRows, HOLDINGS_PATH,
} from "../scripts/flows-legs/universe.mjs";
import { volNames, VOL_DEPTH_READS, runVolLeg } from "../scripts/flows-legs/vol.mjs";
import { fakeVolVendor } from "../scripts/flows-legs/vol-fake.mjs";
import { readRegime, assembleRegime, REGIME_CALLS } from "../scripts/flows-legs/regime.mjs";
import { ownershipParts } from "../scripts/flows-legs/ownership.mjs";
import { assembleCatalysts, readCatalysts, calendarPlan, EVENTS_ADDITIONS_BUDGET_BYTES } from "../scripts/flows-legs/events.mjs";
import { runMarketLegs, windowTickersOf, MARKET_LEG_CALLS } from "../scripts/flows-legs/market.mjs";
import { makeCardXStore, cardXPayload, composeCardXPayload, publishCardX, CARD_X_BUDGET_BYTES } from "../scripts/flows-legs/card-x.mjs";
import { buildIndexDossiers, shedToFit, dossierRoster } from "../scripts/flows-legs/index-dossier.mjs";
import { makeFakeVendor } from "../scripts/flows-legs/fake-vendor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-flows-legs-probe.json"), "utf8"));
const probe = (id) => FX.probes[id].sample;
const S = FX.session;

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const near = (a, b, eps, msg) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= eps, `${msg} — got ${a}, want ${b}`); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

{
  eq(vnum("0.312"), 0.312, "a decimal string is a number");
  eq(vnum(" 1.5 "), 1.5, "padded strings are trimmed");
  eq(vnum("2.5e6"), 2500000, "scientific notation parses");
  eq(vnum(""), null, "an empty string is absent, never zero");
  eq(vnum(null), null, "null stays null");
  eq(vnum("abc"), null, "text is absent");
  eq(vnum(true), null, "a boolean is not a number");
  eq(vnum("1e400"), null, "an overflow is absent rather than Infinity");
  eq(isoDay("2026-09-22T13:30:00Z"), "2026-09-22", "an instant yields its date part");
  eq(isoDay("2026-02-30"), null, "an impossible date is refused");
  eq(sessionsBetween("2026-09-18", "2026-09-22"), 2, "Friday to Tuesday is two sessions");
  eq(sessionsBetween("2026-09-22", "2026-09-22"), 0, "the same day is zero sessions");
  eq(sessionsBetween("2026-09-22", "2026-09-18"), null, "a date in the past is null, not negative");
  eq(nextWeekdayIso("2026-09-25"), "2026-09-28", "the session after a Friday is Monday");
}

{
  deep(pctRanks([1, 2, 2, 3]), [0.25, 0.75, 0.75, 1], "pct = #{x_j <= x_i}/n, ties share the upper count (quant spec A3)");
  deep(pctRanks([null, 5, NaN]), [null, 1, null], "absent inputs stay absent and do not enter n");
  eq(pctOf([1, 2, 3, 4], 3), 0.75, "a value's percentile in a history includes itself");
  eq(pctOf([], 3), null, "no history, no percentile");
  const z = zScores([1, 2, 3, null]);
  near(z[0], -1, 1e-12, "sample-sd z of the low value");
  eq(z[3], null, "an absent value has no z");
  deep(zScores([4, 4, 4]), [null, null, null], "a degenerate cross-section returns null rather than 0");
  const oz = ownZ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 25);
  near(oz.z, (25 - 10.5) / Math.sqrt(35), 1e-12, "own-history z against the prior values, sample sd");
  eq(ownZ([1, 2, 3], 5).reason, SILENCE.few, "too little history is a named silence");
  eq(ownZ([1, 2], null).reason, SILENCE.absent, "no current value is absent");
}

{
  near(termSlope(0.30, 0.25), 0.2, 1e-12, "TS = IV30/IV90 - 1 (quant spec B1)");
  near(frontStress(0.33, 0.30), 0.1, 1e-12, "FS = IV7/IV30 - 1");
  eq(termSlope(null, 0.25), null, "an absent tenor gives an absent slope");
  eq(termSlope(0.3, 0), null, "a zero denominator is absent, never infinite");
  near(ivChange("0.312", "0.339"), -0.027, 1e-12, "IV momentum in vol points, probe NVDA iv30d vs iv30d_1w");
  const v = vrpTrailing(0.312, 0.25);
  near(v.vol, 0.062, 1e-12, "VRP_vol = IV30 - RV");
  near(v.variance, 0.312 * 0.312 - 0.0625, 1e-12, "VRP_var = IV30^2 - RV^2 (quant spec D4 units)");
  near(v.rel, 0.062 / 0.25, 1e-12, "VRP_rel = VRP_vol / RV");
  deep(vrpTrailing(0.3, null), { vol: null, variance: null, rel: null }, "absent RV silences all three");
  near(gexPerAdv(1e8, 1e6, 50), 2, 1e-12, "GEX $/1% over ADV $ (quant spec F1 normalisation)");
  near(gammaDollarsPerAdv(1000, 1e6, 100), 0.001, 1e-15,
    "gamma*contracts*100 * S^2 * 0.01 over ADV $ — the F1 identity gamma*OI*100*S*0.01*S = gamma*OI*S^2");
  near(sharesPerAdv(-677914, 135220632.8), -677914 / 135220632.8, 1e-15, "delta demand as a share of ADV shares");
  near(vegaDollarsPerAdv(-743026, 1e6, 100), -0.00743026, 1e-12, "vega demand as a share of ADV $");
  eq(gexPerAdv(1e8, 0, 50), null, "a zero ADV silences the ratio");
  near(netTilt({ net_call_premium: "3000000", net_put_premium: "-1000000", call_premium: "6000000", put_premium: "2000000" }),
    0.5, 1e-12, "tilt = (ncp - npp)/(|call premium| + |put premium|)");
  eq(netTilt({ net_call_premium: "1", net_put_premium: "1", call_premium: "0", put_premium: "0" }), null,
    "zero gross premium is undefined, not neutral");
  const st = sectorTilts([
    { sector: "Energy", net_call_premium: 2, net_put_premium: 0, call_premium: 3, put_premium: 1 },
    { sector: "Energy", net_call_premium: 0, net_put_premium: 2, call_premium: 1, put_premium: 3 },
    { sector: "Energy", net_call_premium: 4, net_put_premium: 0, call_premium: 4, put_premium: 0 },
  ]);
  near(st.get("Energy").tilt, 4 / 12, 1e-12, "the sector tilt is a ratio of sums, not a mean of ratios");
  near(bandPosition(105, 100, 110), 0.5, 1e-12, "Bollinger position");
}

{
  const sI = Math.sqrt(0.25 * 0.04 + 0.25 * 0.09 + 2 * 0.25 * 0.5 * 0.2 * 0.3);
  const two = impliedCorrelation(sI, [{ w: 0.5, vol: 0.2 }, { w: 0.5, vol: 0.3 }]);
  near(two.rho, 0.5, 1e-12, "implied correlation recovers the rho an index was built with (two names)");
  near(two.dispersion, 0.25 - sI, 1e-12, "and the dispersion sum(w*s) - sI");
  const s3 = Math.sqrt(3 * (1 / 9) * 0.04 + 0.3 * 6 * (1 / 9) * 0.04);
  near(impliedCorrelation(s3, [{ w: 1 / 3, vol: 0.2 }, { w: 1 / 3, vol: 0.2 }, { w: 1 / 3, vol: 0.2 }]).rho, 0.3, 1e-12,
    "and three equal names at rho 0.3");
  near(impliedCorrelation(sI, [{ w: 0.45, vol: 0.2 }, { w: 0.45, vol: 0.3 }, { w: 0.1, vol: null }]).rho,
    impliedCorrelation(sI, [{ w: 0.5, vol: 0.2 }, { w: 0.5, vol: 0.3 }]).rho, 1e-12,
    "weights are renormalised over the covered members");
  eq(impliedCorrelation(sI, [{ w: 0.3, vol: 0.2 }, { w: 0.3, vol: 0.3 }]).reason, SILENCE.coverage,
    "a holdings list that lists only 60% of the fund is silenced, even though every listed name has an IV");
  eq(impliedCorrelation(sI, [{ w: 0.3, vol: 0.2 }, { w: 0.7, vol: null }]).reason, SILENCE.few,
    "one covered member cannot carry a correlation");
  eq(impliedCorrelation(sI, [{ w: 0.3, vol: 0.2 }, { w: 0.3, vol: 0.2 }, { w: 0.4, vol: null }]).reason, SILENCE.coverage,
    "60% weight coverage is below the 80% floor and is silenced");
  eq(impliedCorrelation(null, [{ w: 0.5, vol: 0.2 }, { w: 0.5, vol: 0.3 }]).reason, SILENCE.absent,
    "no index IV, no correlation");
  deep(compactNumbers({ a: 0.123456789, b: 1234.56, c: [3, null, "x"] }), { a: 0.123457, b: 1235, c: [3, null, "x"] },
    "published floats keep six significant digits and dollar magnitudes round to integers");
}

{
  const row = probe("screener-tickers");
  eq(vnum(row.volatility_30), 0.312, "the probe's NVDA row carries volatility_30 as a string");
  const rows = [
    { ...row, ticker: "NVDA", marketcap: "5.5e12", close: "228.87", sector: "Technology" },
    { ticker: "AAA", marketcap: "2e9", close: "10", prev_close: "9.5", sector: "Technology",
      volatility_7: "0.5", volatility_30: "0.4", volatility_90: "0.32", iv30d: "0.4", iv30d_1d: "0.38",
      realized_volatility: "0.3", short_int: "0.086", next_earnings_date: "2026-09-25" },
    { ticker: "BBB", marketcap: "3e9", close: "20", sector: "Energy", iv30d: "0.2" },
  ];
  const u = buildUniverse(rows, { sessionDate: S, generatedAt: "t" });
  deep(u.t, ["NVDA", "BBB", "AAA"], "the columns are ordered by market cap, largest first");
  eq(u.status, "ok", "a readable cross-section is ok");
  const iv = decodeColumn(u.cols.iv30, u.units.iv30[1]);
  near(iv[0], 0.312, 1e-9, "the NVDA probe IV decodes back through the published scale");
  eq(universeValue(u, "AAA", "ts"), 0.25, "AAA term slope 0.40/0.32 - 1 decodes to 0.25");
  eq(universeValue(u, "AAA", "fs"), 0.25, "front stress 0.5/0.4 - 1");
  eq(universeValue(u, "AAA", "si"), 0.086, "short interest keeps its fraction");
  eq(universeValue(u, "AAA", "ed"), 3, "three sessions from Tuesday to Friday's report");
  eq(universeValue(u, "AAA", "chg"), 0.0526, "one-day change in basis points");
  eq(u.cols.ts[1], null, "BBB has no 90-day IV, so its slope is null — never a 0 that reads as flat");
  eq(u.cols.vrp[1], null, "and no RV, so no VRP");
  eq(u.counts.ts, 1, "the column count says how many names carry a value");
  ok(Array.isArray(u.pct.iv30) && u.pct.iv30.every((v) => v === null || (v >= 0 && v <= 100)),
    "percentiles are published 0..100");
  eq(u.pct.iv30[1], 33, "BBB's 0.20 is the lowest of three IVs: 1/3");
  ok(u.shock && u.shock.rule.includes("cross-sectional"), "the IV shock z says it is cross-sectional, not own history");
  const tiny = buildUniverse(rows, { sessionDate: S, budgetBytes: u.bytes - 300 });
  ok(tiny.bytes <= u.bytes - 300 && tiny.status === "ok", `shedding brings the payload under the budget (${tiny.bytes})`);
  ok(tiny.shed.length > 0, `a tight budget sheds columns (${tiny.shed.join(", ")})`);
  const prioOf = new Map(UNIVERSE_COLUMNS.map((c) => [c.key, c.prio]));
  ok(tiny.shed.every((k) => prioOf.get(k) > 1), "a priority-1 column is never shed");
  const order = tiny.shed.map((k) => prioOf.get(k));
  ok(order.every((p, i) => i === 0 || order[i - 1] >= p), "columns are shed from the lowest priority up");
  ok(!("iv30" in Object.fromEntries(tiny.shed.map((k) => [k, 1]))), "IV30 survives");
  const none = buildUniverse([], { sessionDate: S });
  eq(none.status, "unavailable", "an empty harvest is unavailable, not an empty ok");
  eq(none.reason, SILENCE.absent, "and an empty read is a measured absence");
  eq(buildUniverse([], { sessionDate: S, harvest: harvestBlock({ rows: [], errors: ["HTTP 500"] }) }).reason, SILENCE.unreadable,
    "while an empty harvest whose read failed is unreadable, not quiet");
  const refused = buildUniverse(rows, { sessionDate: S, budgetBytes: 400 });
  eq(refused.status, "unavailable", "a universe still over budget after shedding every sheddable column is unavailable");
  eq(refused.reason, "over_budget", "and says why");
  ok(!("cols" in refused) && !("t" in refused), "and carries no columns, so the refusal itself fits under the ingest cap");
  ok(refused.bytes < 1024 && refused.overBytes > 400, `it is ${refused.bytes} bytes and names the ${refused.overBytes} it would have been`);
  const partial = harvestBlock({ rows: [{}, {}], calls: 2, pages: 1, limit: 500, errors: ["/api/screener/stocks -> HTTP 502"] });
  deep([partial.errors, partial.complete, partial.rows], [1, false, 2],
    "a harvest whose second page failed says it is incomplete rather than passing for the whole cross-section");
  eq(harvestBlock({ rows: [], truncated: false, repeated: false, errors: [] }).complete, true, "a clean harvest is complete");
}

{
  const spec = FX.specScreenerRow.row;
  const row = { ...spec, rsi_14: 61.25, adx_14: 23.5, bb_20_2_lower: 200.5, bb_20_2_upper: 220.5, atr_14: 6.37, sma_50: 190.4 };
  const f = (k) => Number(row[k]);
  const want = {
    px: f("close"), chg: f("close") / f("prev_close") - 1, mcap: f("marketcap"), iv30: f("volatility_30"),
    ivp: f("iv_percentile_1y"), ts: f("volatility_30") / f("volatility_90") - 1, fs: f("volatility_7") / f("volatility_30") - 1,
    dIv1d: f("iv30d") - f("iv30d_1d"), dIv1w: f("iv30d") - f("iv30d_1w"), dIv1m: f("iv30d") - f("iv30d_1m"),
    rv20: f("realized_volatility"), vrp: f("volatility_30") - f("realized_volatility"), vrpPost: f("variance_risk_premium"),
    erq: f("rv_1d_last_12q"), gexAdv: f("gex_gamma_per_one_percent_move_oi") / (f("avg30_volume") * f("close")),
    gexRatio: f("gex_ratio"), dDelta: f("cum_dir_delta") / f("avg30_volume"),
    dGamma: (f("cum_dir_gamma") * f("close") * f("close") * 0.01) / (f("avg30_volume") * f("close")),
    dVega: f("cum_dir_vega") / (f("avg30_volume") * f("close")),
    ins3m: (f("insider_buy_volume_3m") - f("insider_sell_volume_3m")) / f("shares_outstanding"),
    rsi: 61.25, adx: 23.5, bb: (f("close") - 200.5) / 20, atr: 6.37 / f("close"), sma50: f("close") / 190.4 - 1,
    rvol: f("relative_volume"),
    tilt: (f("net_call_premium") - f("net_put_premium")) / (Math.abs(f("call_premium")) + Math.abs(f("put_premium"))),
  };
  const u = buildUniverse([row], { sessionDate: row.date });
  for (const [k, v] of Object.entries(want)) {
    const scale = u.units[k][1];
    ok(Number.isFinite(v), `the spec row carries every input of ${k}`);
    near(universeValue(u, "NVDA", k), Math.round(v * scale) / scale, 1e-9,
      `${k} re-derived by hand from the vendor's own NVDA row, through its published scale`);
  }
  eq(universeValue(u, "NVDA", "ed"), sessionsBetween(row.date, row.next_earnings_date), "ed counts weekdays to next_earnings_date");
  eq(row.short_int, "0", "the vendor's NVDA row reads short_int '0', where NVDA's float is about 1% short");
  eq(universeValue(u, "NVDA", "si"), null, "so a zero short_int is the vendor's placeholder and publishes as absent, not a measured 0");
  eq(u.counts.si, 0, "and it does not enter the column's count or its percentile");

  const tonight = { ...row, next_earnings_date: row.date };
  eq(universeValue(buildUniverse([{ ...tonight, er_time: "postmarket" }], { sessionDate: row.date }), "NVDA", "ed"), 0,
    "a report after the session's close is 0 sessions away");
  eq(universeValue(buildUniverse([{ ...tonight, er_time: "premarket" }], { sessionDate: row.date }), "NVDA", "ed"), null,
    "a report before the session's open is behind the session, never 'tonight'");
  const blank = buildUniverse([{ ...row, volatility_30: "", volatility_90: "0.4" }], { sessionDate: row.date });
  near(universeValue(blank, "NVDA", "ts"), f("iv30d") / 0.4 - 1, 1e-3,
    "an empty volatility_30 string falls back to iv30d instead of silencing the slope");

  ok(UNIVERSE_BUDGET_BYTES <= 100 * 1024 && UNIVERSE_BUDGET_BYTES < 128 * 1024, "the universe budget sits under the ingest cap");
}

{
  const nf = FX.probes["net-flow-expiry"].sample;
  const zero = { data: [{ ...nf, moneyness: "all", tide_type: "all" }], date: S, expiration: ["zero_dte"], moneyness: ["all"], tide_type: ["all"] };
  const parsed = parseNetFlow(zero);
  eq(parsed.series[0].points.length, nf.data.filter((r) => r.net_call_premium !== undefined).length,
    "the inner rows of the probe envelope are read, not the outer array, and a row with no premium is skipped");
  near(sessionNet(parsed), -38898.4 + 1028078.2, 1e-6, "net = ncp - npp at the last minute of the cumulative series");
  const weekly = { ...zero, data: [{ moneyness: "all", tide_type: "all", data: [{ timestamp: "2026-09-22T13:33:00Z", net_call_premium: "100000", net_put_premium: "-300000" }] }], expiration: ["weekly"] };
  const zd = buildZeroDte({ zero, weekly, sessionDate: S });
  near(zd.share, 989179.8 / (989179.8 + 400000), 1e-9, "0DTE share = |np0| / (|np0| + |npw|)");
  eq(zd.sameSession, true, "the envelope date is checked against the session");
  eq(buildZeroDte({ zero, sessionDate: S }).share, null, "without the weekly read the share is absent");
  eq(zeroDteShare(0, 0), null, "0/0 is undefined, not a share");
  eq(buildZeroDte({ zero: null }).reason, SILENCE.unread, "no read is a named silence");
  const path0 = downsample(parsed.series[0].points, { stepMinutes: 5 });
  eq(path0.pts[path0.pts.length - 1][0], 3, "the downsampled path always keeps the last minute");
}

{
  const tide = tideSummary([probe("sector-tide-technology")], { sessionDate: S });
  near(tide.net, 2487087 - 948197, 1e-6, "sector tide net = ncp - npp");
  eq(tide.dir, 1, "and carries its sign");
  eq(tide.sameSession, true, "and its date");
  eq(tideSummary([], {}).status, "quiet", "no rows is quiet");
  const g = greekFlowTotals([probe("group-flow-mag7")]);
  near(g.delta, 190120.64588741100, 1e-6, "group directional delta sums the per-minute rows");
  near(g.purity, 190120.64588741100 / 1865865.8091589327, 1e-12, "purity = |dir delta| / |total delta|");
  near(g.net, 1164800 + 1440028, 1e-6, "group net premium = ncp - npp");
  const al = groupAlignment(10, [{ cum_dir_delta: 5 }, { cum_dir_delta: -3 }, { cum_dir_delta: 2 }, { cum_dir_delta: 0 }]);
  deep([al.members, al.agree], [3, 2], "alignment counts members with a sign and those agreeing with the group");
  eq(groupAlignment(0, [{ cum_dir_delta: 5 }]).reason, SILENCE.absent, "a flat group has no sign to agree with");
  eq(groupMembers("semi", [{ ticker: "NVDA", industry_type: "Semiconductors" }, { ticker: "X", industry_type: "Banks" }]).length, 1,
    "semi membership is read off industry_type");
  eq(groupMembers("mag7", [{ ticker: "AAPL" }, { ticker: "X" }]).length, 1, "mag7 is a fixed list");

  const flows = Array.from({ length: 100 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10),
    change_prem: String(i + 1), change: i + 1, close: "1",
  }));
  const ff = fundFlowSummary(flows.slice().reverse(), { sessionDate: "2026-12-31" });
  near(ff.cum20Usd, 1810, 1e-9, "the latest 20-session sum of change_prem");
  near(ff.z20, 810 / (20 * Math.sqrt((80 * 81) / 12)), 1e-9, "z against the earlier 20-session sums, sample sd");
  eq(fundFlowSummary(flows, { sessionDate: "2026-01-10" }).z20, null, "ten sessions cannot carry a 20-session z");
  const probeFlow = fundFlowSummary([probe("etf-flow-spy")], { sessionDate: S });
  eq(probeFlow.changeShares, 3700000, "the probe SPY in-outflow row reads change as shares");
  eq(probeFlow.changeUsd, 2863800000, "and change_prem as dollars");

  const tov = probe("total-options-volume");
  const hist = Array.from({ length: 80 }, (_, i) => ({ date: new Date(Date.UTC(2026, 4, 1) + i * 86400000).toISOString().slice(0, 10), call_volume: 100, put_volume: 50 + (i % 5), call_premium: "10", put_premium: "5" }));
  const pc = putCallHistory([...hist, tov], { sessionDate: S });
  near(pc.pcVolume.now, 25895745 / 39255508, 1e-12, "the probe session's P/C volume ratio");
  ok(pc.pcVolume.z !== null && pc.pcVolume.reason === null, "and a z against the prior sessions");
  eq(putCallHistory([tov], { sessionDate: "2026-09-21" }).status, "quiet", "a row dated after the session is cut, never read ahead");
}

{
  const row = probe("screener-tickers");
  const c = volCurveFromScreener(row);
  eq(c.status, "ok", "the probe row carries some fixed tenors");
  eq(c.ts, null, "volatility_90 is not in the probe sample, so the slope is null rather than 0");
  const full = volCurveFromScreener({ volatility_7: "0.14", volatility_30: "0.15", volatility_90: "0.16", steepness_180_30: "1.1", iv_percentile_1y: "12.5" });
  near(full.ts, 0.15 / 0.16 - 1, 1e-12, "VIX-fallback term slope from SPY's screener IVs");
  eq(full.shape, "contango", "an upward curve is contango");
  eq(full.frontInverted, false, "and the front is not inverted");
  eq(volCurveFromScreener(null).status, "unavailable", "no index row, no curve");

  const dr = shapeDailyReport({ date: S, skew: [probe("daily-report")], vol: { richest: [], cheapest: [] }, flow: { bullish: [{ ticker: "AAPL", net_premium: 2.5e6 }], bearish: [] },
    catalysts: { data: [], counts_by_type: {}, date_min: S, date_max: S }, stock_movers: [1, 2], unusual_options: [1], tide: { data: [], date: S } }, { sessionDate: S });
  const sk = dr.skew[0];
  eq(sk.t, "SPXW", "the anomaly row's ticker");
  near(sk.score, -70.12234762979683, 1e-9, "score arrives as a string and is coerced");
  deep(sk.c.ivp, [2.3, -0.954], "components keep raw and value");
  deep(sk.c.vrpz, [null, null], "a null component stays null");
  deep(sk.c.regime, [-2.92928721836439, -1, 0.5], "regime carries crash_probability");
  eq(dr.unshaped.stock_movers, 2, "unprobed groups are counted, not parsed");
  eq(dr.catalysts.status, "quiet", "an empty catalyst list is quiet");
  eq(shapeDailyReport(null).status, "unavailable", "an unreadable body is unavailable");

  const op = shapeOptionsPulse(FX.probes["options-pulse-total"].sample && { data: { latest: probe("options-pulse-total"), intraday: [probe("options-pulse-total")] }, date: S }, { sessionDate: S });
  near(op.pcTxn, 112818 / 366905, 1e-12, "put/call transactions from the probe latest row");
  ok(/unverified/.test(op.meaning), "the gauge's scale is marked unverified");
  const hm = holdingsMembers([probe("etf-holdings-qqq")]);
  near(hm.members[0].w, 0.08288174, 1e-12, "holdings weight arrives in percent and is divided by 100");
  eq(hm.asOf, "2026-09-21", "the weights carry their own date");
  deep(vendorGate(new Error("/api/volatility/vix-term-structure -> HTTP 403")), { status: 403, gated: true }, "a 403 is a plan gate");
  deep(vendorGate(new Error("/x -> HTTP 500")), { status: 500, gated: false }, "a 500 is not");
}

{
  const si = latestShortInterest([probe("short-screener")], { sessionDate: S });
  const aapl = si.byTicker.get("AAPL");
  near(aapl.si, 0.006528065187922719, 1e-15, "si_float is a fraction string");
  eq(aapl.dtc, 1.57, "days to cover is coerced");
  eq(aapl.stale, true, "a 2021 settlement is stale by the session");
  const cut = latestShortInterest([{ symbol: "Z", market_date: "2026-09-30", si_float: "0.1" }], { sessionDate: S });
  eq(cut.future, 1, "a settlement dated after the session is cut and counted");
  eq(cut.byTicker.size, 0, "and never read");

  const b = borrowSummary([probe("shorts-data:AAPL")], { sessionDate: S });
  eq(b.fee, 0.0025, "the fee arrives in percent (0.25) and is published as a fraction");
  eq(b.rebate, 0.0363, "the rebate likewise");
  eq(b.availCensored, true, "10,000,000 available shares reads as the vendor's cap");
  eq(b.htb, false, "0.25% is not hard to borrow");
  eq(b.dFee5, null, "one snapshot day has no 5-session change");
  const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22"];
  const snaps = days.map((d, i) => ({ timestamp: d + "T15:00:00Z", fee_rate: String(1 + i), rebate_rate: "1", short_shares_available: 100 }));
  const b7 = borrowSummary(snaps.reverse(), { sessionDate: S });
  near(b7.dFee5, 0.07 - 0.02, 1e-12, "dFee5 compares the last day's snapshot with five sessions earlier, rows sorted locally");
  eq(b7.htb, true, `a 7% fee clears the ${HTB_FEE * 100}% hard-to-borrow line`);
  eq(borrowSummary([{ timestamp: "2026-09-23T15:00:00Z", fee_rate: "1" }], { sessionDate: S }).status, "quiet",
    "a snapshot after the session is never read");

  const svRows = Array.from({ length: 61 }, (_, i) => ({ market_date: new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10), short_volume_ratio: String(i < 60 ? 0.5 + (i % 2 ? 0.02 : -0.02) : 0.6) }));
  const sv = shortVolumeSummary(svRows, { sessionDate: S });
  near(sv.z, (0.6 - 0.5) / Math.sqrt(0.0004 * 60 / 59), 1e-9, "short-volume ratio z against the 60 sessions before it");
  eq(shortVolumeSummary([probe("shorts-volume:AAPL")], { sessionDate: S }).ratio, 0.5679624989742062, "the probe ratio string is coerced");
  eq(shortVolumeSummary([probe("shorts-volume:AAPL")], { sessionDate: S }).reason, SILENCE.few, "one session is too few for a z");
  deep(rowsOf({ si: [probe("shorts-volume:AAPL")] }), [], "the default unwrap would read the si envelope as empty — the trap");
  eq(rowsOf({ si: [probe("shorts-volume:AAPL")] }, "si").length, 1, "the leg reads the rows under si");

  const ins = probe("insider-transactions");
  const one = insiderSummary([ins, ins], { sessionDate: S });
  eq(one.n, 1, "the same transaction twice is deduplicated by id");
  near(one.net90, -1366000 * 219.7251, 1e-6, "net 90-day dollars = signed shares x price");
  eq(one.buyers, 0, "a sale has no buyers");
  eq(one.cluster, false, "and no cluster");
  const buy = (who, d) => ({ id: who + d, ticker: "T", transaction_code: "P", amount: 100, price: "10", owner_name: who, transaction_date: d, filing_date: d });
  eq(insiderSummary([buy("A", "2026-09-01"), buy("B", "2026-09-10"), buy("C", "2026-09-20")], { sessionDate: S }).cluster, true,
    "three distinct buyers inside 30 days are a cluster");
  eq(insiderSummary([buy("A", "2026-07-01"), buy("B", "2026-08-01"), buy("C", "2026-09-01")], { sessionDate: S }).cluster, false,
    "three buyers spread over two months are not");
  const late = insiderSummary([{ ...buy("A", "2026-09-22"), filing_date: "2026-09-24" }], { sessionDate: S });
  eq(late.future, 1, "a filing after the session is not read");
  eq(late.status, "quiet", "and leaves the name quiet");
  const planned = insiderSummary([{ ...ins, is_10b5_1: true, id: "p" }], { sessionDate: S });
  eq(planned.net90ExPlan, 0, "10b5-1 plan sales are excluded from the ex-plan net");
  const mixed = insiderSummary([
    { ...ins, id: "award", transaction_code: "A", amount: 50000, price: "0" },
    { ...ins, id: "unsigned", amount: 1000, price: "200" },
    { ...buy("X", "2026-09-10"), id: "free", price: "0" },
  ], { sessionDate: S });
  eq(mixed.otherCodes, 1, "a grant (code A) that slips through the vendor filter is counted and left out");
  eq(mixed.n, 2, "so only purchases and sales are transactions");
  near(mixed.net90, -200000, 1e-9, "a sale reported with a positive share count still subtracts: the code sets the sign");
  eq(mixed.buys90, null, "a purchase with no price leaves the buy dollars absent, not a measured 0");
  eq(mixed.unpriced, 1, "and is counted as unpriced");
  eq(insiderSummary([{ ...ins, id: "s1" }], { sessionDate: S }).buys90, 0, "while a window with no purchase at all reads 0 bought");

  const sq = squeezePressure([{ t: "A", si: 0.1, dtc: 1, fee: 0.01 }, { t: "B", si: 0.2, dtc: 2, fee: 0.02 },
    { t: "C", si: 0.3, dtc: 3, fee: null }, { t: "D", si: 0.4, dtc: 4, fee: 0.04 }]);
  const fm = 0.07 / 3;
  const fsd = Math.sqrt(((0.01 - fm) ** 2 + (0.02 - fm) ** 2 + (0.04 - fm) ** 2) / 2);
  near(sq.get("A").pressure, 2 * (-0.15 / Math.sqrt(0.05 / 3)) + (0.01 - fm) / fsd, 1e-12,
    "squeeze = z(SI) + z(DTC) + z(fee), each a sample-sd z across the deep names");
  eq(sq.get("C").pressure, null, "a missing fee silences the pressure rather than scoring it 0");
  const fresh = ["N1", "N2", "N3"].map((t, i) => ({ symbol: t, market_date: "2026-09-15", si_float: String(0.05 * (i + 1)), days_to_cover: String(i + 1) }));
  const staleParts = ownershipParts({
    tickers: ["OLD", "N1", "N2", "N3"], deepTickers: ["OLD", "N1", "N2", "N3"], sessionDate: S,
    shortInterestRows: [{ symbol: "OLD", market_date: "2026-06-30", si_float: "0.3", days_to_cover: "9" }, ...fresh],
  }).parts;
  eq(staleParts.get("OLD").short.interest.stale, true, "an 84-day-old settlement is stale");
  eq(staleParts.get("OLD").short.squeeze.zSi, null, "and never enters the squeeze z as if it were today's short interest");
  near(staleParts.get("N1").short.squeeze.zSi, -1, 1e-12, "the z is taken across the three fresh settlements alone");
}

{
  eq(reactionDay("2026-09-22", "premarket"), "2026-09-22", "a premarket report reacts the same day");
  eq(reactionDay("2026-09-25", "postmarket"), "2026-09-28", "a Friday postmarket report reacts Monday");
  eq(reactionDay("2026-09-25", "unknown"), "2026-09-28", "an unknown time is treated as after the close");
  const est = probe("earnings:AAPL");
  const hist = [est];
  for (let q = 0; q < 8; q++) {
    const d = new Date(Date.UTC(2026, 6, 1) - q * 91 * 86400000).toISOString().slice(0, 10);
    hist.push({ report_date: d, report_time: "postmarket", source: "company", expected_move_perc: "0.05",
      post_earnings_move_1d: String(q % 2 ? 0.1 : -0.025), post_earnings_move_1w: String(q % 2 ? 0.12 : -0.02),
      pre_earnings_move_1w: "0.01", long_straddle_1d: String(q % 2 ? 0.5 : -0.4), long_straddle_1w: "0.1" });
  }
  const h = earningsHistory(hist, { sessionDate: S });
  eq(h.status, "ok", "eight reports with a move and an expected move clear the six-report floor");
  eq(h.next.d, "2026-10-29", "the estimate row is the next report");
  eq(h.next.confirmed, false, "and it is flagged as an estimate");
  near(h.medianRatio, (0.5 + 2) / 2, 1e-12, "median |m1d|/em over ratios 2 and 0.5");
  eq(h.beat, 0.5, "half the reports beat the implied move");
  eq(h.ls1dHit, 0.5, "half the long straddles paid on day one");
  near(h.drift, (0.02 + (-0.005)) / 2, 1e-12, "drift = median sign(m1d)*(m1w - m1d)");
  const recent = earningsHistory([{ report_date: "2026-09-18", report_time: "postmarket", expected_move_perc: "0.05",
    post_earnings_move_1d: "0.04", post_earnings_move_1w: "0.05", long_straddle_1w: "0.2" }], { sessionDate: S });
  eq(recent.masked, 2, "a one-week window that ends after the session is withheld, so a re-run cannot see ahead");
  eq(recent.events[0][4], null, "its 1w move is null");
  eq(recent.events[0][3], 0.04, "while the 1d move, known by the session, is kept");
  eq(recent.status, "thin", "one report is thin");
  eq(earningsHistory([{ report_date: "2026-01-01", expected_move_perc: "5" , post_earnings_move_1d: "3" }], { sessionDate: S }).reason,
    SILENCE.unit, "an expected move above 1 means the unit is not the fraction the probe saw");
  eq(historyDigest(h).n, 8, "the digest keeps the count");

  const kbh = shapeEarningsCalendar([probe("earnings-afterhours")], { sessionDate: S });
  near(kbh.rows[0].em, 0.08223296974686149, 1e-15, "calendar expected move is a fraction");
  eq(kbh.rows[0].emUsd, 4, "and expected_move is dollars");
  eq(kbh.rows[0].realized, null, "a report the same evening has no reaction yet");
  const rg = reactionGauge([{ t: "A", em: 0.05, realized: 0.1 }, { t: "B", em: 0.1, realized: -0.05 }]);
  near(rg.medianRatio, 1.25, 1e-12, "the market-wide reaction gauge is the median |realized|/expected");

  const econ = shapeEconomicCalendar([probe("economic-calendar"), { time: "2026-09-22T12:30:00Z", event: "CPI m/m", prev: "0.2" }], { sessionDate: S });
  eq(econ.rows.length, 1, "a release before the session's close is dropped");
  eq(econ.past, 1, "and counted");
  eq(econ.rows[0].sd, 3, "Tuesday to Friday is three sessions");
  eq(econ.rows[0].prev, 51.7, "prev is coerced when numeric");
  eq(econ.rows[0].forecast, 47.1, "and forecast");
  eq(macroTag("FOMC Rate Decision"), "fomc", "FOMC is tagged");
  eq(macroTag("Nonfarm Payrolls"), "nfp", "payrolls are tagged");
  eq(macroTag("Consumer Price Index (MoM)"), "cpi", "CPI is tagged");
  eq(sessionCloseInstant("2026-09-22"), Date.parse("2026-09-22T20:00:00Z"), "the close is 20:00Z in daylight time");
  eq(sessionCloseInstant("2026-12-15"), Date.parse("2026-12-15T21:00:00Z"), "and 21:00Z in standard time");

  deep(parseFdaTarget("2025-MID"), { from: "2025-04-01", to: "2025-09-30", p: "mid", raw: "2025-MID" }, "the probe's free-text target parses to a window");
  deep(parseFdaTarget("2026-Q4"), { from: "2026-10-01", to: "2026-12-31", p: "quarter", raw: "2026-Q4" }, "a quarter");
  eq(parseFdaTarget("Q3 2026").from, "2026-07-01", "a quarter written the other way round");
  eq(parseFdaTarget("2026-H1").to, "2026-06-30", "a half");
  eq(parseFdaTarget("2026-02").to, "2026-02-28", "a month ends on its last day");
  eq(parseFdaTarget("2026-11-05").p, "day", "an exact date");
  eq(parseFdaTarget("TBD").p, "unparsed", "free text that names no window is kept as unparsed");
  eq(parseFdaTarget(""), null, "an empty target is absent");
  const fda = shapeFdaCalendar([probe("fda-calendar")], { sessionDate: S });
  eq(fda.outside, 1, "the probe's 2021 row targeting 2025-MID is outside the window");
  eq(fda.status, "quiet", "so the leg is quiet rather than showing a stale catalyst");
}

{
  const pages = [Array.from({ length: 500 }, (_, i) => ({ ticker: "P0_" + i })), Array.from({ length: 415 }, (_, i) => ({ ticker: "P1_" + i }))];
  const seen = [];
  const uw = async (p, params) => { seen.push(params.offset); return pages[params.offset] || []; };
  const h = await harvestScreener(uw, { filters: { min_marketcap: 1e9 }, date: S });
  eq(h.rows.length, 915, "the universe is 915 names in two calls, as the probe measured");
  deep(seen, [0, 1], "offset is a page index: 0, then 1");
  eq(h.truncated, false, "a short second page ends the harvest");
  const stuck = await harvestScreener(async () => pages[0], {});
  eq(stuck.repeated, true, "a vendor that ignores offset is detected on the first repeated page");
  eq(stuck.rows.length, 500, "and the repeat adds nothing");
  const broken = await harvestScreener(async () => { throw new Error("/api/screener/stocks -> HTTP 500"); }, {});
  eq(broken.errors.length, 1, "a failed read is recorded, so the pipeline falls back to the sweep");

  const old = await readShortInterest(async () => [{ symbol: "A", market_date: "2021-06-15" }], ["A"], { sessionDate: S });
  eq(old.minHonoured, false, "rows older than min_market_date reveal the parameter was ignored");

  let call = 0;
  const insUw = async (p, params, opts) => {
    ok(opts && opts.envelope === true, "the insider read asks for the envelope so has_more is visible");
    call++;
    return call === 1 ? { data: [{ id: "a", ticker: "A" }], has_more: true } : { data: [{ id: "a", ticker: "A" }], has_more: true };
  };
  const ir = await readInsiders(insUw, ["A"], { sessionDate: S });
  eq(ir.rows.length, 1, "a page that repeats the last one ends paging and is deduplicated");
  eq(ir.calls, 2, "after exactly one extra call");

  const batches = [];
  const shortUw = async (p, params) => {
    const names = params.tickers.split(",");
    batches.push(names);
    if (batches.length === 1) throw new Error("/api/short_screener -> HTTP 502");
    if (batches.length === 2) return Array.from({ length: 500 }, (_, i) => ({ symbol: names[0], market_date: S, si_float: String(i / 1e4) }));
    return names.map((t) => ({ symbol: t, market_date: S, si_float: "0.05" }));
  };
  const names = Array.from({ length: 6 }, (_, i) => "N" + i);
  const sr = await readShortInterest(shortUw, names, { sessionDate: S, batch: 2 });
  deep([sr.unread.get("N0").reason, sr.unread.get("N1").reason, sr.unread.get("N0").http], [SILENCE.unreadable, SILENCE.unreadable, 502],
    "names in a failed short-interest batch are unreadable, never a measured absence");
  eq(sr.unread.has("N2"), false, "a name that did arrive in a truncated batch was read");
  ok(sr.unread.get("N3").reason === SILENCE.unreadable && /row limit/.test(sr.unread.get("N3").detail),
    "while its batch-mate crowded out by the 500-row limit is unreadable, with the limit named");
  eq(sr.unread.has("N4"), false, "a whole batch reads cleanly");
  const late = await readShortInterest(shortUw, ["Z1"], { sessionDate: S, deadline: Date.now() - 1 });
  eq(late.unread.get("Z1").reason, SILENCE.unread, "a batch skipped at the deadline is not_read");

  const pagesSeen = [];
  const insPaged = async (p, params) => {
    const page = params.page || 0;
    pagesSeen.push([params.ticker_symbol, page]);
    if (params.ticker_symbol === "A,B") return { data: [{ id: "1", ticker: "A" }], has_more: false };
    if (params.ticker_symbol === "C,D") throw new Error("/api/insider/transactions -> HTTP 500");
    if (page === 0) return { data: [{ id: "e0", ticker: "E" }], has_more: true };
    throw new Error("/api/insider/transactions -> HTTP 500");
  };
  const paged = await readInsiders(insPaged, ["A", "B", "C", "D", "E", "F"], { sessionDate: S, batch: 2 });
  deep([paged.unread.has("A"), paged.unread.get("C").reason, paged.unread.get("D").reason], [false, SILENCE.unreadable, SILENCE.unreadable],
    "a first page that fails leaves its names unreadable");
  deep([paged.partial.has("E"), paged.partial.has("F"), paged.unread.has("E")], [true, true, false],
    "and a later page that fails leaves them read but incomplete");

  const parts2 = ownershipParts({
    tickers: ["C", "E", "N0"], deepTickers: [], sessionDate: S, insiderRows: paged.rows,
    shortUnread: sr.unread, insiderUnread: paged.unread, insiderPartial: paged.partial,
  });
  deep([parts2.parts.get("N0").short.interest.reason, parts2.parts.get("N0").short.status],
    [SILENCE.unreadable, "unavailable"], "the part says the short interest was unreadable, not quiet");
  eq(parts2.parts.get("C").insiders.reason, SILENCE.unreadable, "and the insider part likewise");
  eq(parts2.parts.get("E").insiders.complete, false, "while a name from an unfinished batch is flagged incomplete");

  const idx = await readIndexRows(async () => [{ ticker: "SPY" }, { ticker: "QQQ" }], {});
  deep(idx.missing, ["IWM"], "a missing index row is named");
  const r403 = await read(async () => { throw new Error("/api/volatility/vix-term-structure -> HTTP 403"); }, "/x");
  eq(r403.gated, true, "a 403 read is recorded as a plan gate");
}

{
  const screener = Array.from({ length: 60 }, (_, i) => ({
    ticker: "T" + String(i).padStart(2, "0"), close: String(20 + i), prev_close: String(19.5 + i),
    marketcap: String(2e9 + i * 1e9), sector: i % 2 ? "Technology" : "Energy", issue_type: "Common Stock",
    iv30d: String(0.2 + i / 200), iv30d_1d: "0.25", iv30d_1w: "0.26", iv30d_1m: "0.27",
    net_call_premium: String(1e6 * (i % 5)), net_put_premium: String(5e5 * (i % 3)), call_premium: "4000000", put_premium: "3000000",
    call_volume: 5000, put_volume: 4000, next_earnings_date: i % 4 ? null : "2026-09-24",
  }));
  const vendor = makeFakeVendor({ sessionDate: S, screenerRows: screener });
  const raw = await readRegime(vendor, { sessionDate: S });
  eq(raw.calls, REGIME_CALLS, `the regime leg makes exactly its modelled ${REGIME_CALLS} calls`);
  const index = await readIndexRows(vendor, { date: S });
  const { regime, catalysts } = assembleRegime(raw, { sessionDate: S, generatedAt: "t", indexRows: index.rows, harvestRows: vendor.augmented, universeRows: vendor.augmented });
  eq(regime.volCurve.vendor.reason, SILENCE.gated, "the VIX curve's 403 is published as a plan gate");
  eq(regime.volCurve.vendor.code, "volatility_scope_required", "with the probe's refusal code");
  eq(regime.volCurve.status, "ok", "and the screener fallback carries the curve");
  eq(regime.zeroDte.status, "ok", "the 0DTE leg reads its four net-flow envelopes");
  ok(regime.zeroDte.share > 0 && regime.zeroDte.share < 1, "and publishes a share in (0,1)");
  eq(regime.sectors.rows.length, 11, "all eleven sector tides are reported, read or not");
  eq(regime.impliedCorrelation.byIndex.SPY.status, "ok", "SPY implied correlation is measured over the holdings");
  ok(regime.bytes < 60 * 1024, `the regime payload is ${regime.bytes} bytes, under its 60KB budget`);
  ok(catalysts && catalysts.status === "ok", "the daily report's catalysts are handed to events");

  const legs = await runMarketLegs({
    uw: vendor, sessionDate: S, screenerDate: S, generatedAt: "t",
    eligible: (r) => r.issue_type !== "ETF", cardedTickers: screener.slice(0, 30).map((r) => r.ticker),
    deepTickers: screener.slice(0, 10).map((r) => r.ticker),
    windowTickers: windowTickersOf(screener, { origin: nextWeekdayIso(S) }),
  });
  eq(legs.universe.status, "ok", "the universe publishes");
  eq(legs.universe.n, 60, "over every eligible harvested name");
  eq(legs.universe.harvest.complete, true, "from a complete harvest");

  const screenerReads = [];
  const counting = async (p, params, opts) => {
    if (p === "/api/screener/stocks" && !params.ticker) screenerReads.push(params);
    return vendor(p, params, opts);
  };
  const swept = await runMarketLegs({
    uw: counting, sessionDate: S, screenerDate: S, generatedAt: "t",
    harvest: { rows: vendor.augmented, calls: 9, pages: 9, limit: 50, truncated: true, repeated: false, errors: [], dated: true, source: "sweep" },
    eligible: () => true, cardedTickers: [], deepTickers: [], windowTickers: [],
  });
  eq(screenerReads.length, 0, "a universe handed the pipeline's own read never harvests the screener a second time");
  const early = "2026-09-22T21:31:02.000Z";
  const stamped = await runMarketLegs({
    uw: vendor, sessionDate: S, screenerDate: S, generatedAt: "t",
    harvest: { rows: vendor.augmented, calls: 2, pages: 2, limit: 500, errors: [], dated: true, readAt: early },
    eligible: () => true, cardedTickers: [], deepTickers: [], windowTickers: [],
  });
  deep([stamped.universe.fresh.readAt, stamped.regime.fresh.readAt], [early, early],
    "the market keys are stamped with the screener read they are built on, the oldest read inside them (freshness 3.8)");
  deep([swept.universe.harvest.source, swept.universe.harvest.complete, swept.universe.n], ["sweep", false, 60],
    "and says it came from the cap-band sweep, whose truncated leaf makes it incomplete");
  ok(legs.universe.bytes <= UNIVERSE_BUDGET_BYTES, "inside its budget");
  eq(legs.ownership.size, 30, "every carded name gets an ownership part");
  eq(legs.ownership.get("T00").short.borrow.status, "ok", "a deep name carries its borrow read");
  eq(legs.ownership.get("T20").short.borrow.reason, SILENCE.unread, "a carded-only name says the borrow was not read");
  ok(legs.ownership.get("T00").short.squeeze.pressure !== undefined, "and deep names carry the squeeze composite");
  for (const k of ["macro", "fda", "earningsCalendar", "catalysts", "history"]) {
    ok(k in legs.eventsAdditions, `events gains ${k}`);
  }
  ok(legs.earnings.size >= 10, "every deep name gets an earnings history read");
  ok(MARKET_LEG_CALLS > 0 && MARKET_LEG_CALLS < 400, `the modelled leg cost is ${MARKET_LEG_CALLS} calls`);
  eq(calendarPlan(S).length, 13, "the calendar reads two reaction days, tonight and ten upcoming routes");

  const emittedEventsBase = () => ({ rows: "x".repeat(32 * 1024) });
  const season = (step, i) => Array.from({ length: 120 }, (_, k) => ({
    ...probe("earnings-afterhours"), symbol: `E${i}_${k}`, report_date: step.date,
    report_time: step.route === "premarket" ? "premarket" : "postmarket", marketcap: String(1e12 - k * 1e9),
    full_name: "A COMPANY WITH A LONG REGISTERED NAME INCORPORATED", sector: "Consumer Cyclical",
  }));
  const peak = { calls: 0, earnings: new Map(),
    calendar: calendarPlan(S).map((step, i) => ({ ...step, res: { ok: true, body: season(step, i) } })),
    econ: { ok: true, body: Array.from({ length: 60 }, (_, k) => ({ ...probe("economic-calendar"), event: "Event " + k })) },
    fda: { ok: true, body: Array.from({ length: 80 }, (_, k) => ({ ...probe("fda-calendar"), ticker: "F" + k, drug: "Drug " + k,
      unique_identifier: "u" + k, target_date: addDays(S, 10 + k), has_options: true, marketcap: "2000000000",
      indication: "an indication long enough to reach the sixty-character cap on the published row" })) } };
  const unfitted = assembleCatalysts(peak, { sessionDate: S, budgetBytes: 1e9 }).additions;
  const fullEvents = JSON.stringify({ ...emittedEventsBase(), ...unfitted }).length;
  ok(fullEvents > 128 * 1024,
    `an earnings-season calendar (120 reporters on each of 11 routes) and a full FDA window beside the 32KB the events rows and notes already take would put events at ${fullEvents} bytes, over the 128KB ingest cap`);
  const fitted = assembleCatalysts(peak, { sessionDate: S }).additions;
  ok(JSON.stringify(fitted).length <= EVENTS_ADDITIONS_BUDGET_BYTES,
    `the additions shed to ${JSON.stringify(fitted).length} bytes, inside their ${EVENTS_ADDITIONS_BUDGET_BYTES}-byte budget`);
  ok(JSON.stringify({ ...emittedEventsBase(), ...fitted }).length < 128 * 1024, "so events stays under the ingest cap in the busiest week");
  eq(fitted.earningsCalendar.tonight.rows.length, 40, "tonight's reporters are the last to be trimmed");
  const far = fitted.earningsCalendar.sessions[fitted.earningsCalendar.sessions.length - 1];
  const near1 = fitted.earningsCalendar.sessions[0];
  ok(far.afterhours.rows.length <= near1.premarket.rows.length, "the farthest session is trimmed first");
  eq(far.afterhours.shed, far.afterhours.seen - far.afterhours.rows.length, "and every trimmed route counts what it shed");
  ok(fitted.additionsBudget.shed.length > 0 && fitted.additionsBudget.bytes <= EVENTS_ADDITIONS_BUDGET_BYTES,
    "the shed list travels with the payload");

  deep(windowTickersOf([{ ticker: "TNT", next_earnings_date: S, marketcap: "1" }, { ticker: "NXT", next_earnings_date: nextWeekdayIso(S), marketcap: "2" }],
    { origin: S }), ["TNT", "NXT"], "a name reporting after tonight's close is inside the window, first");

  const lateRaw = await readRegime(vendor, { sessionDate: S, deadline: Date.now() - 1 });
  eq(lateRaw.calls, 0, "past the deadline the regime leg spends no call");
  const lateRegime = assembleRegime(lateRaw, { sessionDate: S, generatedAt: "t" }).regime;
  deep([lateRegime.zeroDte.reason, lateRegime.sectors.rows[0].reason, lateRegime.volCurve.vendor.reason, lateRegime.optionsPulse.reason],
    [SILENCE.unread, SILENCE.unread, SILENCE.unread, SILENCE.unread],
    "and every arm it skipped says not_read (pending), never unreadable: nothing failed, nothing was asked");
  const lateCat = assembleCatalysts(await readCatalysts(vendor, { sessionDate: S, earningsTickers: ["T00"], deadline: Date.now() - 1 }),
    { sessionDate: S });
  deep([lateCat.additions.macro.reason, lateCat.additions.fda.reason, lateCat.additions.earningsCalendar.reason],
    [SILENCE.unread, SILENCE.unread, SILENCE.unread], "the catalyst reads skipped at the deadline are not_read too");

  const parts = ownershipParts({ tickers: ["X"], deepTickers: ["X"], deep: new Map([["X", {
    borrow: { ok: false, gated: true, status: 403 }, volume: { ok: true, body: { si: [probe("shorts-volume:AAPL")] } } }]]),
    sessionDate: S });
  eq(parts.parts.get("X").short.borrow.reason, SILENCE.gated, "a refused borrow read is a plan gate, not zero borrow");
  eq(parts.parts.get("X").short.volume.ratio, 0.5679624989742062, "the si envelope is read through the leg");
}

{
  const store = makeCardXStore();
  store.add("AAA", "insiders", { dots: Array.from({ length: 5000 }, (_, i) => ["2026-09-01", i, "S", null, 0]) });
  store.add("AAA", "short", { status: "ok" });
  const p = cardXPayload("AAA", store.get("AAA"), { sessionDate: S });
  ok(p.bytes <= CARD_X_BUDGET_BYTES, `an oversized card-x sheds to ${p.bytes} bytes`);
  deep(p.shed, ["insiders.dots"], "shedding starts with the insider dots");
  eq(p.fresh.cadenceS, 0, "card-x carries the nightly freshness envelope");

  const small = makeCardXStore();
  small.add("BBB", "short", { status: "ok", si: 0.04 });
  const held = { v: 1, ticker: "BBB", sessionDate: S, scope: "deep", cone: { status: "ok" }, gex: { status: "ok" },
    shed: ["rv.series"], fresh: { v: 1, readAt: "2026-08-24T20:10:00.000Z", vendorAt: "2026-08-24T20:00:00.000Z" } };
  const own = cardXPayload("BBB", small.get("BBB"), { sessionDate: S, readAt: "2026-08-24T21:40:00.000Z" });
  const merged = composeCardXPayload(held, own);
  ok(merged.cone && merged.gex && merged.short && merged.scope === "deep",
     "the ownership parts join the vol and flow sections already written for the session, they never replace them");
  eq(merged.fresh.readAt, "2026-08-24T20:10:00.000Z", "the composed dossier dates itself by its oldest read");
  deep(merged.shed, ["rv.series"], "and keeps the other writers' shed list");
  {
    const { bytes, ...rest } = merged;
    eq(bytes, JSON.stringify(rest).length, "its byte count is measured on the composed payload, not on one writer's part");
  }
  const stale = composeCardXPayload({ ...held, sessionDate: "2026-08-21" }, own);
  ok(!stale.cone && !stale.gex && stale.short, "a dossier from another session is replaced, not merged into tonight's");
  const written = {};
  const res = await publishCardX(small, async (k, v) => { written[k] = v; }, {
    sessionDate: S, readAt: "2026-08-24T21:40:00.000Z", stored: (k) => (k === "card-x:BBB" ? held : null) });
  ok(res.written === 1 && written["card-x:BBB"].cone && written["card-x:BBB"].short,
     "publishCardX composes with what this run already published under the same key");

  const built = [];
  const out = await buildIndexDossiers({
    tickers: ["SPY", "QQQ", "IWM"], indexRows: new Map([["SPY", { close: "774.26" }], ["QQQ", { close: "600" }]]),
    enrich: async (t) => { if (t === "QQQ") throw new Error("boom"); return {}; },
    features: () => ({}), perName: async () => ({}), chain: async () => null,
    card: ({ ticker }) => ({ ticker, depth: "board", panels: { surface: { status: "ok", big: "x".repeat(200000) } } }),
    publish: async (key, card) => built.push([key, card.depth, card.panels.surface.status]),
  });
  deep(built, [["card:SPY", "index", "unavailable"]], "an index dossier is published as depth index, shedding to fit");
  deep(out.failed, ["QQQ"], "a failed read fails that dossier alone");
  deep(out.skipped, ["IWM"], "a missing screener row skips the dossier");
  const hidden = await buildIndexDossiers({
    tickers: ["SPY"], indexRows: new Map([["SPY", { close: null, missing_periscope: true }]]),
    enrich: async () => { throw new Error("enrich must not run without a spot"); },
    features: () => ({}), perName: async () => ({}), chain: async () => null, card: () => ({}), publish: async () => {},
  });
  deep([hidden.skipped, hidden.failed], [["SPY"], []], "a row whose close is hidden is skipped before any vendor call, never built at spot 0");
  eq(shedToFit({ panels: {} }).dropped.length, 0, "a small card sheds nothing");

  const roster = dossierRoster({ index: ["SPY", "QQQ", "IWM"], funds: ["GLD", "SPY", "COPX"] });
  deep(roster.tickers, ["SPY", "QQQ", "IWM", "GLD", "COPX"], "the dossier roster is the indices then the funds, each once");
  const funds = [];
  const cardDepths = {};
  const fundOut = await buildIndexDossiers({
    tickers: roster.tickers, depthOf: (t) => roster.depth.get(t),
    indexRows: new Map(roster.tickers.map((t) => [t, { close: "100" }])),
    enrich: async () => ({}), features: () => ({}), perName: async () => ({}), chain: async () => null,
    card: ({ ticker, depth }) => { cardDepths[ticker] = depth; return { ticker, depth: "board", panels: {} }; },
    publish: async (key, card) => funds.push([key, card.depth]),
  });
  deep(funds, [["card:SPY", "index"], ["card:QQQ", "index"], ["card:IWM", "index"], ["card:GLD", "fund"], ["card:COPX", "fund"]],
    "fund dossiers go through the same path and are published as depth fund; the indices stay index");
  deep(fundOut.depth, { SPY: "index", QQQ: "index", IWM: "index", GLD: "fund", COPX: "fund" }, "and the run is told which depth each got");
  deep(cardDepths, { SPY: "index", QQQ: "index", IWM: "index", GLD: "fund", COPX: "fund" },
    "the card builder is told the depth too, so a fund's missing-chain reason names a fund chain and not an index one");
}

{
  deep([...VOL_DEPTH_READS.fund], [...VOL_DEPTH_READS.index], "a fund's vol reads are an index's: cone, term, skew, IV rank and the rest");
  const names = volNames({ deep: [["AAA", "long"]], crossSection: ["BBB"], funds: ["GLD", "SPY"] });
  deep(names.map((n) => [n.ticker, n.depth]), [["AAA", "deep"], ["BBB", "carded"], ["SPY", "index"], ["QQQ", "index"], ["IWM", "index"], ["GLD", "fund"]],
    "the vol roster adds the funds at depth fund after the indices, and never twice");
  const leg = await runVolLeg({ uw: fakeVolVendor({ sessionDate: S, names }), names, sessionDate: S, radar: true });
  const gld = leg.byTicker.get("GLD");
  ok(gld && gld.panels.term.status === "ok" && gld.panels.skew.status !== undefined && gld.panels.cone.status === "ok",
     "a fund gets cone, term and skew, so its card-x carries the vol module a stock dossier does");
  ok(!leg.radar || !leg.radar.carded.includes("GLD"), "and a fund never joins the stock cross-section's radar or percentiles");
}

{
  const calls = [];
  const base = async (p, params, opts) => {
    calls.push(p);
    if (p === HOLDINGS_PATH) return { data: [{ ticker: "NVDA", weight: "8", type: "stock", updated: S }] };
    if (p === "/api/screener/stocks") {
      const want = String(params.ticker || "").split(",");
      return want.filter((t) => t !== "GHOST").map((t) => ({ ticker: t, close: "10", marketcap: "5e8" }));
    }
    return opts && opts.envelope ? { data: [] } : [];
  };
  base.calls = calls;
  const h = await readHoldings(base);
  ok(h.ok && h.rows.length === 1 && h.calls === 1, "the QQQ holdings are read once, before selection");
  const wrapped = withPrefetched(base, new Map([[h.path, h]]));
  const again = await wrapped(HOLDINGS_PATH, {}, { envelope: true });
  eq(calls.filter((p) => p === HOLDINGS_PATH).length, 1,
     "the regime leg's own holdings read is served from that read — the NDX 10 costs no second call");
  eq(again.data[0].ticker, "NVDA", "with the same body");
  ok(wrapped.calls === calls, "and the wrapper keeps the vendor's own properties");
  const failed = withPrefetched(base, new Map([[HOLDINGS_PATH, { ok: false, error: "/api/etfs/QQQ/holdings -> HTTP 403" }]]));
  const r = await read(failed, HOLDINGS_PATH, {}, { envelope: true });
  ok(!r.ok && r.gated, "a failed prefetch replays as the same failure, gate included, rather than a silent empty");

  const m = await fetchMissingMembers(base, ["AAA", "PAAS", "GHOST"], new Set(["AAA"]), { date: S });
  deep(m.asked, ["GHOST", "PAAS"], "only the guaranteed names the harvest did not return are asked for");
  eq(m.calls, 1, "in one screener call by ticker");
  deep(m.rows.map((x) => x.ticker), ["PAAS"], "a name the harvest's market-cap filter dropped (the TECK case) comes back by ticker");
  deep(m.missing, ["GHOST"], "and a name the screener does not know is named, not invented");
  const none = await fetchMissingMembers(base, ["AAA"], new Set(["AAA"]));
  eq(none.calls, 0, "nothing missing costs nothing");
  const f = await readFocusRows(base, ["GLD", "NVDA", "GLD"]);
  ok(f.rows.size === 2 && f.calls === 1 && typeof f.readAt === "string", "the focus read is one call for every focus ticker, deduped");
}

{
  const worker = fs.readFileSync(path.join(ROOT, "worker.js"), "utf8");
  ok(/\^universe\$\|\^regime\$/.test(worker), "the ingest allowlist accepts universe and regime");
  ok(/\/\^\(card\|card-x\|hist\):\/\.exec\(key\)/.test(worker), "and card-x:<T> under the ticker rule");
  ok(worker.includes('path === "/api/flows/universe" || path === "/api/flows/regime"'), "both read routes exist");
  ok(worker.includes('path === "/api/flows/card-x"'), "and the per-name card-x route");
  const legs = fs.readdirSync(path.join(ROOT, "scripts/flows-legs")).map((f) => fs.readFileSync(path.join(ROOT, "scripts/flows-legs", f), "utf8"));
  for (const src of legs) ok(!/\/\/|\/\*/.test(src.replace(/https?:\/\/\S+/g, "")), "leg modules carry no comments");
  const pipe = fs.readFileSync(path.join(ROOT, "scripts/flows-pipeline.mjs"), "utf8");
  ok(pipe.includes("harvest: harvest || universeSource"),
    "when the harvest is refused the market legs are handed the sweep's rows, not left to read the screener again");
  ok(/try \{\s*await publish\(key, marketLegs\[key\]\);/.test(pipe) && !/for \(const key of \["universe", "regime"\]\) await publish/.test(pipe),
    "universe and regime publish one at a time, so a refused universe cannot take the regime and every card-x down with it");
  const own = fs.readFileSync(path.join(ROOT, "scripts/flows-legs/ownership.mjs"), "utf8");
  ok(/volume-and-ratio`, \{\}, \{ envelope: true \}/.test(own), "volume-and-ratio is read with the envelope, never the data unwrap");
}

console.log(`✓ flows-legs: ${checks} assertions — every universe, regime, ownership and catalyst formula checked ` +
  `against a known answer, the probe's own rows parsed through the leg code as fixtures, absent inputs published as ` +
  `named silences rather than zeros, the si and has_more envelopes read where the default unwrap would drop them, the ` +
  `VIX gate published as a gate with the screener curve beside it, look-ahead cut at the session on every dated read, ` +
  `and each new key inside its byte budget`);
