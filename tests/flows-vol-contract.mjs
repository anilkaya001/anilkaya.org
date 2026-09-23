import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  vnum, round, rvEstimators, ivRankPercentile, varianceRiskPremium, eventVariance, forwardVol, yangZhang,
  parkinsonVol, gapShare, closeToCloseVol, rollingVol, ols, zAgainst, buildRvPanel, buildConePanel, buildTermPanel,
  buildSkewPanel, buildIvDynamics, buildVrpPanel, buildAnomalyPanel, buildSentimentPanel, buildCharacterPanel,
  characterVote, buildVolRadar, pickMonthlyExpiry, isStandardMonthly, regularSessionRows, toBars, exEventSlope, exEventVol,
  crossSectionPercentiles, volSummary, volVote, viewOfRichCheap, halfLifeClass, eventDayOf, VOL_WHY, RICH_CHEAP_WEIGHTS,
  RV_WINDOWS, MIN_HISTORY, TERM_MIN_SAMPLES, SKEW_ROLL_DTE, addDays, dayDiff,
} from "../shared/flows-vol.js";
import {
  runVolLeg, volNames, attachVol, cardXPayload, regimePayload, publishVol, volRequest, radarRequest, yearOfCandles,
  errorCode, VOL_DEPTH_READS, VOL_INDEX_NAMES, VOL_PANELS, CARD_X_CAP,
} from "../scripts/flows-legs/vol.mjs";
import { fakeVolVendor, fakeListedExpiries, weekdaysEnding } from "../scripts/flows-legs/vol-fake.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };
const near = (a, b, tol, m) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); n++; };

const FX = JSON.parse(readFileSync(new URL("./fixtures-vol-probe.json", import.meta.url), "utf8"));
const S = FX.session;

{
  const r = rvEstimators({ closes: [100, 101, 99.5, 100.5, 102, 101],
    highLow: [[101.5, 99], [102, 100.2], [101, 99.1], [101.2, 99.8], [102.6, 100.4]] });
  near(r.closeToClose, 0.21292724883866165, 1e-10, "rv.estimators: close-to-close sample sd x sqrt(252)");
  near(r.zeroMeanRms, 0.19305031003860926, 1e-10, "rv.estimators: zero-mean RMS");
  near(r.parkinson, 0.18892508278422787, 1e-10, "rv.estimators: Parkinson high-low");
  const q = ivRankPercentile([0.3, 0.35, 0.4, 0.25, 0.5, 0.45, 0.32], 0.4);
  near(q.rank, 0.6, 1e-12, "iv.rank-vs-percentile: rank is the position in the min-max range");
  near(q.percentile, 0.7142857142857143, 1e-12, "iv.rank-vs-percentile: percentile counts today in");
  const v = varianceRiskPremium(0.418, 0.356);
  near(v.volPoints, 0.062, 1e-12, "vrp.variance-and-vol-units: vol points");
  near(v.variance, 0.047988, 1e-12, "vrp.variance-and-vol-units: variance");
  near(v.relativeToForecast, 0.17415730337078653, 1e-12, "vrp.variance-and-vol-units: relative to the forecast");
  near(v.ratioVar, 1.3786453730589572, 1e-12, "vrp.variance-and-vol-units: variance ratio");
  eq(varianceRiskPremium(0.418, null).volPoints, null, "a VRP with no forecast is absent, never zero");
  const e = eventVariance({ vol: 0.6, T: 0.0273972602739726 }, { vol: 0.45, T: 0.10410958904109589 });
  near(e.diffusiveVol, 0.3824264635194589, 1e-10, "event.earnings-jump-from-term: diffusive vol");
  near(e.eventSd, 0.07652557992960028, 1e-10, "event.earnings-jump-from-term: event sd");
  near(e.eventMeanAbs, 0.06105857873231369, 1e-10, "event.earnings-jump-from-term: mean absolute move");
  const none = eventVariance({ vol: 0.4, T: 0.0273972602739726 }, { vol: 0.45, T: 0.10410958904109589 });
  eq(none.eventSd, null, "event.no-premium: a front that is not elevated has no event variance, reported absent");
  eq(none.code, "no-premium", "and says which silence it is");
}

{
  const raw = [[100.0, 101.2, 99.4, 100.8], [101.1, 102.0, 100.5, 101.6], [101.0, 101.9, 99.8, 100.2],
    [100.6, 101.4, 99.9, 101.1], [101.9, 103.0, 101.5, 102.7], [102.2, 102.9, 101.0, 101.4],
    [101.8, 102.5, 100.9, 102.1], [102.6, 103.8, 102.2, 103.5]];
  const bars = raw.map((b, i) => ({ d: "2026-01-" + String(i + 1).padStart(2, "0"), o: b[0], h: b[1], l: b[2], c: b[3] }));
  near(yangZhang(bars, 5).vol, 0.1769544087627407197, 1e-12, "Yang-Zhang over five sessions matches the mpmath reference");
  near(yangZhang(bars, 7).vol, 0.18663616551437454162, 1e-12, "and over seven");
  near(gapShare(bars, 5).share, 0.17827061836998814439, 1e-12, "the overnight gap share is var(ln O/C-1) / var(ln C/C-1)");
  near(closeToCloseVol(bars, 5), 0.17952949427090954076, 1e-12, "close-to-close over five returns");
  near(parkinsonVol(bars, 5).vol, 0.15215037483476557746, 1e-12, "Parkinson over five sessions");
  eq(yangZhang(bars, 8).vol, null, "a window with no prior close for its first overnight return is absent");
  eq(yangZhang(bars, 8).code, "short-history", "and says so");
  const gapped = bars.map((b, i) => (i === 6 ? { ...b, o: null } : b));
  eq(yangZhang(gapped, 5).code, "input-absent", "a missing open silences Yang-Zhang instead of reading as zero");
  near(forwardVol({ vol: 0.4, T: 24 / 365 }, { vol: 0.36, T: 59 / 365 }).vol, 0.32977914687603537781, 1e-12,
    "forward vol between two expiries from total variance");
  eq(forwardVol({ vol: 0.5, T: 24 / 365 }, { vol: 0.3, T: 59 / 365 }).code, "calendar-arbitrage",
    "total variance falling across expiries is flagged, not rooted");
  const fit = ols([0.30, 0.32, 0.31, 0.35, 0.33, 0.36, 0.34, 0.33, 0.31, 0.32, 0.30],
    [0.32, 0.31, 0.35, 0.33, 0.36, 0.34, 0.33, 0.31, 0.32, 0.30, 0.29]);
  near(fit.slope, 0.44366197183098591549, 1e-12, "AR(1) slope by OLS");
  near(-Math.LN2 / Math.log(fit.slope), 0.85290232716748470658, 1e-10, "and its half-life -ln2/ln(phi)");
}

{
  const a = 0.01;
  const r = Array.from({ length: 300 }, (_, i) => (i % 2 ? -a : a));
  const vols = rollingVol(r, 10);
  near(vols[vols.length - 1].vol, a * Math.sqrt(10 / 9) * Math.sqrt(252), 1e-12,
    "an alternating +-a series has rolling vol a*sqrt(n/(n-1))*sqrt(252) exactly (running sums, not re-summed)");
  const bars = [];
  let c = 100;
  for (let i = 0; i < 520; i++) {
    const d = addDays("2024-06-03", i);
    c *= Math.exp(0.012 * Math.sin(i * 1.3) + 0.004 * Math.cos(i * 0.7));
    bars.push({ d, o: c * 0.999, h: c * 1.01, l: c * 0.99, c });
  }
  const { panel, rolling } = buildRvPanel(bars, { sessionDate: bars[bars.length - 1].d });
  eq(panel.status, "ok", "the realized cone builds from two years of bars");
  for (const w of RV_WINDOWS) {
    const row = panel.cone.find((x) => x.n === w);
    near(row.now, round(closeToCloseVol(bars, w), 4), 1e-9, `RV${w} today equals the direct close-to-close vol`);
    const sorted = rolling.get(w);
    ok(sorted.length === row.count && row.count <= 504 - w + 1, `RV${w} rolls over at most two years (${row.count} windows)`);
    const exact = closeToCloseVol(bars, w);
    near(row.pct, round(sorted.filter((v) => v <= exact + 1e-12).length / sorted.length, 4), 1e-9,
      `RV${w}'s percentile is the share of its own two-year windows at or below today`);
    ok(row.min <= row.p10 && row.p10 <= row.p25 && row.p25 <= row.p50 && row.p50 <= row.p75 && row.p75 <= row.p90 && row.p90 <= row.max,
      `RV${w}'s cone quantiles are ordered`);
  }
  const cut = buildRvPanel(bars, { sessionDate: bars[400].d });
  eq(cut.panel.asOf, bars[400].d, "bars after the session are never read (no look-ahead)");
  const short = buildRvPanel(bars.slice(-40), { sessionDate: bars[bars.length - 1].d });
  eq(short.panel.cone.find((x) => x.n === 252).now, null, "a window longer than the history is absent");
  eq(short.panel.cone.find((x) => x.n === 21).pct, null, "a cone with under sixty windows publishes no percentile");
  eq(short.panel.silent["cone.21.pct"], "short-history", "and names the silence");
}

{
  const p = FX.probes;
  const rows = regularSessionRows([
    p["ohlc-1d:AAPL"].row,
    { close: "338.00", high: "341.2", low: "336.1", open: "339.5", date: "2026-09-22", volume: 48211000, total_volume: 48211000, market_time: "r" },
    { close: "338.4", high: "338.9", low: "337.8", open: "338.0", date: "2026-09-22", volume: 91000, total_volume: 91000, market_time: "po" },
    { close: "339.1", high: "339.3", low: "338.6", open: "338.9", date: "2026-09-22", volume: 60000, total_volume: 60000, market_time: "pr" },
  ]);
  eq(rows.length, 2, "a day with a regular-session row keeps it alone; a pre-market-only day (the probe row) is kept for its date");
  ok(rows.some((r) => r.market_time === "pr" && r.date === "2026-09-23"), "the verbatim probe row (09-23 pre-market) survives as the only row of its day");
  const bars = toBars(rows, { sessionDate: S });
  eq(bars.length, 1, "and the session cut drops it, since 09-23 is after the 09-22 session");
  eq(bars[0].c, 338, "the regular session's close is the bar's close, read from a decimal string");

  const cone = buildConePanel({ data: [p["iv-dist:AAPL"].row] }, { sessionDate: S });
  eq(cone.status, "ok", "the live interpolated-iv/distribution row parses");
  const t7 = cone.tenors[0];
  eq(t7.days, 7, "days arrives as a number");
  eq(t7.iv, 0.221, "volatility is a decimal string read as vol");
  eq(t7.pct, 0.2191, "percentile is 0-1 on this route and is read without rescaling");
  near(t7.iqrPos, (0.221 - 0.2255) / (0.2735 - 0.2255), 1e-4, "IQR position (iv-q1)/(q3-q1), negative below the box");
  near(t7.rangePos, (0.221 - 0.138) / (0.501 - 0.138), 1e-4, "range position (iv-min)/(max-min)");
  eq(t7.lowSample, false, "251 samples clear the 200 floor");
  eq(cone.richCheap, null, "with one tenor the rich/cheap score is absent, not a guess from what arrived");
  eq(cone.silent.richCheap, "input-absent", "and names the silence");
  eq(cone.sameSession, true, "the row is dated on the session");
  const nv = buildConePanel({ data: [p["iv-dist:NVDA"].row] }, { sessionDate: S });
  eq(nv.tenors[0].pct, 0.0438, "NVDA's 7-day percentile reads as published");

  const term = buildTermPanel({ data: [p["term-structure-dist:AAPL"].row] }, { sessionDate: S });
  eq(term.status, "ok", "the live term-structure/distribution row parses");
  eq(term.expiries[0].expiry, "2026-09-23", "expiry read");
  eq(term.expiries[0].dte, 1, "days to expiry counted from the session");
  eq(term.expiries[0].samples, 11, "a weekly listed two weeks ago carries eleven samples");
  eq(term.expiries[0].pct, null, `and under the ${TERM_MIN_SAMPLES}-sample floor its percentile is withheld`);
  eq(term.expiries[0].pctRaw, 0.7273, "while the raw vendor value stays on the row for the disclosure");
  eq(term.silent["expiry.2026-09-23.pct"], "few-samples", "with its silence named");
  eq(term.eventMove.sd, null, "no event move from one expiry");

  const rr25 = { data: [p["rr-skew-25:AAPL"].row] };
  const rr10 = { data: [p["rr-skew-10:AAPL"].row] };
  const skew = buildSkewPanel(rr25, rr10, { sessionDate: S, expiry: "2026-10-16" });
  eq(skew.status, "ok", "the live risk-reversal rows parse");
  eq(skew.rr25, 0.00695, "RR25 is put minus call in decimal vol, as published");
  eq(skew.rr10, 0.0761, "RR10 on the same date");
  near(skew.crash, 0.076103795391265 / 0.00695051315237605, 1e-3, "crash premium is RR10/RR25 on the same date");
  eq(skew.dte, dayDiff("2026-02-19", "2026-10-16"), "and the row's maturity is counted to the fixed expiry");
  eq(skew.z, null, "one row is no history, so there is no z");
  eq(skew.silent.z, "short-history", "and the silence says why");
  const same = buildSkewPanel({ data: [p["rr-skew-025:AAPL"].row] }, null, { sessionDate: S, expiry: "2026-10-16" });
  eq(same.rr25, skew.rr25, "delta=0.25 echoes delta 25 and reads identically, as the probe settled");
  const wrong = buildSkewPanel({ data: [{ ...p["rr-skew-25:AAPL"].row, delta: 10 }] }, null, { sessionDate: S, expiry: "2026-10-16" });
  eq(wrong.status, "quiet", "a row whose echoed delta is not the one asked for is not read as 25-delta");

  const vrp = buildVrpPanel({ data: [p["vrp:AAPL"].row] }, { sessionDate: S });
  eq(vrp.status, "ok", "the live variance-risk-premium row parses");
  eq(vrp.latest.rp, 0.00397, "risk_premium is iv minus the realized vol that followed, in decimal vol");
  near(vrp.latest.variance, 0.232 * 0.232 - 0.228031 * 0.228031, 1e-6, "the variance premium iv^2-rv^2 is computed, not delivered");
  eq(vrp.latest.realizedDate, "2025-10-21", "the realized window ENDS at realized_date, twenty sessions after the iv date");
  eq(vrp.latest.rank, 0.4699, "rank is 0-1");
  eq(vrp.hitRate, null, "one completed window is no hit rate");
  eq(vrp.silent.hitRate, "short-history", "and says so");

  const dyn = buildIvDynamics({ data: [p["iv-rank:AAPL"].row] }, { sessionDate: S });
  eq(dyn.vendorRank, 0.1622, "iv_rank_1y is 0-100 on this route and is published as a fraction");
  eq(dyn.halfLife, null, "one row is no AR(1)");

  const anomalyBody = { data: { history: [p["vol-anomaly:AAPL"].row],
    latest: { ...p["vol-anomaly-top"].row, ticker: "AAPL", date: S } } };
  const an = buildAnomalyPanel(anomalyBody, { sessionDate: S, ours: "rich" });
  eq(an.status, "ok", "the {data:{history,latest}} envelope is read");
  eq(an.direction, "short_vol", "direction read");
  eq(an.view, "rich", "short_vol is the vendor calling vol rich");
  eq(an.vote, 1, "and agrees with a rich cone");
  eq(an.components.vrpZ.std, 0.4854, "component objects are carried with their own fields");
  eq(an.components.regime.crashProbability, 0.5, "including the regime's crash probability");
  eq(an.history.d[0], "2026-06-09", "the history rows are dated");
  eq(buildAnomalyPanel(anomalyBody, { sessionDate: S, ours: "cheap" }).vote, -1, "a cheap cone disagrees");
  eq(buildAnomalyPanel(anomalyBody, { sessionDate: S, ours: null }).vote, null, "no cone reading is no vote");

  const se = buildSentimentPanel({ data: { history: [p["vol-sentiment:AAPL"].row],
    latest: { ...p["vol-sentiment-top"].row, ticker: "AAPL" } } }, { sessionDate: S, lean: 1 });
  eq(se.direction, "bullish", "sentiment direction read");
  eq(se.lean, 1, "bullish is +1");
  eq(se.vote, 1, "and agrees with a long board side");
  eq(se.vwks, 0.2027, "vwks is a decimal string");
  eq(se.components.avar.norm, 1, "components carry norm and value");

  const ch = buildCharacterPanel({ data: { history: [p["vol-character:AAPL"].row],
    latest: { ...p["vol-character:AAPL"].row, ticker: "AAPL", ar1_b: "0.97", entropy_negative: "0.4",
      entropy_conditional: "1.2", sample_size: 250, entropy_samples: 240, updated_at: S + "T23:00:00Z" } } },
  { sessionDate: "2026-06-09", ivHalfLife: 25 });
  eq(ch.character, "moderate", "the character label is read");
  eq(ch.halfLifeDays, 28.58, "half_life_days is a decimal string");
  eq(ch.hurst, 0.6165, "hurst_rv read");
  eq(ch.vote, 0, "a moderate vendor class is a neutral vote");

  const radar = buildVolRadar({
    rich: { data: [p["vol-anomaly-top"].row], date: S, direction: "short_vol" },
    cheap: { data: [], date: S, direction: "long_vol" },
    bullish: { data: [p["vol-sentiment-top"].row], date: S },
    bearish: null,
  }, { sessionDate: S, carded: ["SOXS"] });
  eq(radar.status, "ok", "the radar reads the {data, date, direction} and {data, date} envelopes");
  eq(radar.rich.rows[0].t, "SOXS", "rich names come from short_vol");
  eq(radar.rich.rows[0].score, 52.263, "with the vendor score");
  eq(radar.rich.rows[0].vrpZ, 0.9329, "and its components");
  eq(radar.rich.rows[0].carded, true, "joined to the carded names");
  eq(radar.cheap.status, "quiet", "an empty side is quiet");
  eq(radar.bearish.status, "unavailable", "a failed side is unavailable");
  eq(radar.bullish.rows[0].vwks, 0.2027, "sentiment rows carry vwks");
  eq(radar.asOf, S, "the radar is dated by the vendor's envelope");
  deepEq(radar.carded, ["SOXS"]);
}

function deepEq(a, b) { assert.deepStrictEqual(a, b); n++; }

{
  eq(buildConePanel(null).status, "unavailable", "a failed read is unavailable");
  eq(buildConePanel(null).code, "read-failed", "with its code");
  eq(buildConePanel({ data: "x" }).status, "unreadable", "a body that is not rows is unreadable, not quiet");
  eq(buildConePanel({ data: [] }).status, "quiet", "no rows is quiet");
  eq(buildConePanel({ unexpected: 1 }).code, "unreadable-body", "an envelope without data is unreadable");
  eq(buildConePanel({ data: [{ days: 30, volatility: "0.3", date: "2026-09-23" }] }, { sessionDate: S }).code, "after-session",
    "rows dated after the session are cut, and a feed of only those is quiet with its reason");
  const tenor = (days, pct, iv = 0.3) => ({ days, volatility: String(iv), percentile: String(pct), q1: "0.25", q3: "0.35",
    min: "0.2", max: "0.5", median: "0.3", samples: 251, date: S });
  const full = buildConePanel({ data: [tenor(7, 0.2191, 0.33), tenor(30, 0.55), tenor(60, 0.61), tenor(90, 0.70, 0.3),
    tenor(180, 0.40), tenor(365, 0.35)] }, { sessionDate: S });
  near(full.richCheap, 0.083, 1e-9, "rich/cheap = weighted mean of (pct-0.5) at 0.4/0.3/0.2/0.1 across 30/60/90/180");
  near(full.coneShape, 0.2191 - 0.35, 1e-9, "cone shape = pct7 - pct365");
  near(full.slope30_90, 0, 1e-9, "the 30/90 slope is iv30/iv90 - 1");
  near(full.front7_30, 0.1, 1e-9, "the front stress is iv7/iv30 - 1");
  eq(full.view, "neutral", "0.083 is inside the +-0.15 band, so the cone takes no side");
  deepEq(Object.keys(RICH_CHEAP_WEIGHTS).map(Number), [30, 60, 90, 180]);
  const odd = buildConePanel({ data: [tenor(30, 55)] }, { sessionDate: S });
  eq(odd.tenors[0].pct, null, "a percentile outside 0-1 on a 0-1 route is refused, not rescaled by guess");
  eq(odd.pctOutOfRange, 1, "and counted");
  const implausible = buildConePanel({ data: [tenor(30, 0.5, 9.14)] }, { sessionDate: S });
  eq(implausible.status, "quiet", "an implausible iv (9.14) is dropped rather than published");
}

{
  const base = (expiry, iv, pct, samples = 251) => ({ expiry, volatility: String(iv), percentile: String(pct), samples,
    q1: String(iv - 0.02), median: String(iv), q3: String(iv + 0.02), min: String(iv - 0.05), max: String(iv + 0.05), date: S });
  const term = buildTermPanel({ data: [
    base("2026-10-02", 0.30, 0.40), base("2026-10-16", 0.31, 0.45), base("2026-10-23", 0.52, 0.95),
    base("2026-11-20", 0.42, 0.42), base("2026-12-18", 0.40, 0.40), base("2026-09-18", 0.2, 0.5),
  ] }, { sessionDate: S, earnings: { date: "2026-10-21", time: "postmarket" } });
  eq(term.expired, 1, "an expiry on or before the session is dropped");
  eq(term.earnings.eventDay, "2026-10-22", "a post-market report moves the stock the next session");
  const ev = term.expiries.find((x) => x.expiry === "2026-10-23");
  ok(ev.event && ev.eventFirst, "the first expiry after the event day contains it");
  near(ev.premium, 0.95 - (0.45 + 0.42) / 2, 1e-9, "premium = pct - median of the neighbouring pcts");
  eq(ev.kink, true, "and above 0.3 it is a kink");
  eq(term.eventKink.expiry, "2026-10-23", "the event kink is the kink that contains earnings");
  const T1 = dayDiff(S, "2026-10-23") / 365, T2 = dayDiff(S, "2026-11-20") / 365;
  const e = eventVariance({ vol: 0.52, T: T1 }, { vol: 0.42, T: T2 });
  ok(e.eventSd > 0, "the fixture carries a real event premium");
  near(term.eventMove.sd, e.eventSd, 1e-4, "the event move is sqrt(w1 - sd^2 T1) from the event expiry and the next");
  near(term.eventMove.meanAbs, e.eventMeanAbs, 1e-4, "with its mean absolute move");
  const f = term.expiries.find((x) => x.expiry === "2026-10-16");
  near(f.fwd, forwardVol({ vol: 0.30, T: dayDiff(S, "2026-10-02") / 365 }, { vol: 0.31, T: dayDiff(S, "2026-10-16") / 365 }).vol, 1e-4,
    "each expiry carries the forward vol from the one before it");
  eq(term.expiries[0].fwd, null, "the first expiry has no forward");
  const lone = buildTermPanel({ data: [base("2026-10-23", 0.52, 0.95)] },
    { sessionDate: S, earnings: { date: "2026-10-21", time: "premarket" } });
  eq(lone.eventMove.sd, null, "an event expiry with nothing after it has no event move");
  eq(lone.silent.eventMove, "single-expiry", "and says so");
  const past = buildTermPanel({ data: [base("2026-10-23", 0.52, 0.95), base("2026-11-20", 0.36, 0.42)] },
    { sessionDate: S, earnings: { date: "2026-09-10", time: "premarket" } });
  eq(past.earnings, null, "an earnings date already behind the session is not an upcoming event");
  eq(past.silent.eventMove, "no-event", "and the move is silent as no-event");
  const flat = buildTermPanel({ data: [base("2026-10-23", 0.30, 0.5), base("2026-11-20", 0.36, 0.42)] },
    { sessionDate: S, earnings: { date: "2026-10-21", time: "premarket" } });
  eq(flat.silent.eventMove, "no-premium", "a front below the back carries no event variance");
  eq(eventDayOf({ date: "2026-10-23", time: "postmarket" }), "2026-10-26", "a Friday after-close report moves Monday");
  eq(eventDayOf({ date: "2026-10-21", time: "unknown" }), "2026-10-21", "an unknown time is read as the day itself");

  const cone = buildConePanel({ data: [30, 90].map((d) => ({ days: d, volatility: d === 30 ? "0.60" : "0.40",
    percentile: "0.5", q1: "0.3", q3: "0.4", min: "0.2", max: "0.6", median: "0.35", samples: 251, date: S })) }, { sessionDate: S });
  const ex = exEventSlope(cone, term, S);
  const j = term.eventMove.sd;
  near(ex.value, round(Math.sqrt((0.60 ** 2 * 30 / 365 - j * j) / (30 / 365)) / Math.sqrt((0.40 ** 2 * 90 / 365 - j * j) / (90 / 365)) - 1, 4), 1e-3,
    "the ex-event slope strips the event variance from every tenor that spans the event");
  near(exEventVol(0.60, 30, term, S).value, Math.sqrt((0.36 * 30 / 365 - j * j) / (30 / 365)), 1e-12,
    "the ex-event vol removes the event's total variance J^2 from the tenor that spans it");
  eq(exEventVol(0.60, 20, term, S).value, 0.60, "a tenor that ends before the event keeps its vol");
  eq(exEventVol(0.60, 30, lone, S).code, "single-expiry", "an event with no measured move leaves it absent, with the reason");
  eq(exEventSlope(cone, past, S).value, cone.slope30_90, "with no upcoming event the ex-event slope is the slope");
  eq(exEventSlope(cone, lone, S).value, null, "an event inside the tenor with no measured move leaves the ex-event slope absent");
}

{
  eq(pickMonthlyExpiry(["2026-09-25", "2026-10-02", "2026-10-16", "2026-11-20"], S).expiry, "2026-10-16",
    "the ~30-day standard monthly the probe used is chosen");
  const rolled = pickMonthlyExpiry(["2026-10-16", "2026-11-20"], "2026-10-10");
  eq(rolled.expiry, "2026-11-20", `a monthly under ${SKEW_ROLL_DTE} days is rolled to the next`);
  eq(rolled.rolled, true, "and the roll is recorded");
  eq(pickMonthlyExpiry(["2026-06-18", "2026-07-17"], "2026-06-01").expiry, "2026-06-18",
    "when the third Friday is a holiday (Juneteenth 2026) the listed Thursday is the monthly");
  ok(!isStandardMonthly("2026-06-18", new Set(["2026-06-19"])), "but not when the Friday itself is listed");
  const cal = pickMonthlyExpiry([], "2026-10-10");
  eq(cal.expiry, "2026-11-20", "with nothing listed the third Friday is computed");
  eq(cal.source, "calendar", "and the source says so");
  eq(pickMonthlyExpiry(["2026-09-25", "2026-10-02"], S).code, "no-monthly", "listed weeklies alone give no monthly");
}

{
  const expiry = "2026-12-18";
  const rows25 = [], rows10 = [];
  for (let i = 0; i < 70; i++) {
    const dte = 100 - i;
    const rr = 0.03 - 0.004 * Math.log(dte) + 0.002 * Math.sin(1.7 * i);
    const d = addDays(expiry, -dte);
    rows25.push({ date: d, ticker: "T", delta: 25, risk_reversal: String(rr) });
    rows10.push({ date: d, ticker: "T", delta: 10, risk_reversal: String(rr * 3) });
  }
  const today = addDays(expiry, -30);
  const rrNow = 0.03 - 0.004 * Math.log(30) + 0.006;
  rows25.push({ date: today, ticker: "T", delta: 25, risk_reversal: String(rrNow) });
  rows10.push({ date: today, ticker: "T", delta: 10, risk_reversal: String(rrNow * 3) });
  rows25.push({ date: addDays(today, 1), ticker: "T", delta: 25, risk_reversal: "0.9" });
  const skew = buildSkewPanel({ data: rows25 }, { data: rows10 }, { sessionDate: today, expiry });
  eq(skew.asOf, today, "the row after the session is cut");
  eq(skew.cutAfter, 1, "and counted");
  near(skew.zRaw, 4.6124308994073048734, 1e-3, "raw skew z = (RR25 - mean)/sd over the prior rows");
  near(skew.z, 4.2333083356610189768, 1e-3, "maturity-adjusted z = today's residual of RR25 on ln(dte), over the residual sd");
  eq(skew.zBasis, "maturity-adjusted", "and the headline z says which basis it is");
  near(skew.maturitySlope, -0.0039027798509351101185, 1e-5, "the fitted maturity slope is published");
  near(skew.mom5, 0.0076521681078669765825, 1e-5, "5-session momentum RR25_t - RR25_t-5");
  near(skew.crash, 3, 1e-3, "crash premium RR10/RR25");
  eq(skew.dte, 30, "today's maturity");
  eq(skew.dteFirst, 100, "and the oldest row's, so the shrinking maturity is visible");
  eq(skew.series.d.length, 60, "the sparkline keeps sixty sessions");
  const calls = buildSkewPanel({ data: rows25.map((r) => ({ ...r, risk_reversal: String(-Math.abs(Number(r.risk_reversal))) })) },
    { data: rows10 }, { sessionDate: today, expiry });
  eq(calls.crash, null, "a call-bid (negative) RR25 has no crash ratio");
  eq(calls.silent.crash, "sign-mismatch", "and says why");
  const noTen = buildSkewPanel({ data: rows25 }, null, { sessionDate: today, expiry });
  eq(noTen.rr10, null, "a failed 10-delta read leaves RR10 absent");
  eq(noTen.silent.crash, "input-absent", "and the crash ratio silent");
  eq(buildSkewPanel({ data: rows25 }, null, { sessionDate: today, expiry: null }).code, "no-monthly", "no expiry, no skew");
}

{
  const rows = [];
  for (let i = 0; i < 80; i++) {
    rows.push({
      date: addDays("2026-01-05", i), updated_at: "x",
      volatility: String(0.30 + 0.04 * Math.sin(i / 6) + 0.01 * Math.cos(1.9 * i)),
      close: String(100 * Math.exp(0.01 * Math.sin(i / 4) - 0.002 * i)),
      iv_rank_1y: "50",
    });
  }
  const dyn = buildIvDynamics({ data: rows.slice().reverse() }, { sessionDate: rows[79].date });
  near(dyn.phi, 0.9108415856618970071, 1e-4, "AR(1) phi over the year of daily iv (rows sorted locally)");
  near(dyn.halfLife, 7.4223657404894640979, 1e-2, "IV half-life = -ln2/ln(phi) in sessions");
  near(dyn.longRun, 0.30324995975400705113, 1e-4, "long-run iv c/(1-phi)");
  near(dyn.volOfVol, 0.012664585880416473855, 1e-5, "vol-of-vol = sd of the last sixty daily iv changes");
  near(dyn.volOfVolRel, 0.692476493627988619, 1e-4, "and its relative form sd(dln iv) x sqrt(252)");
  near(dyn.spotVolCorr, -0.053169898909124305887, 1e-3, "spot-vol correlation of dln S against d iv");
  near(dyn.rank, 0.80455467025543337463, 1e-4, "iv rank over the year");
  near(dyn.pct, 0.8375, 1e-9, "iv percentile, today included");
  eq(dyn.view, "mean-reverting", "a 7.4-session half-life reads as mean-reverting");
  eq(halfLifeClass(7.42), "mean-reverting", "a half-life under ten sessions is mean-reverting");
  eq(halfLifeClass(25), "moderate", "between ten and forty it is moderate");
  eq(halfLifeClass(60), "persistent", "above forty it is persistent");
  const up = buildIvDynamics({ data: rows.map((r, i) => ({ ...r, volatility: String(0.2 + i * 0.001) })) }, { sessionDate: rows[79].date });
  eq(up.halfLife, null, "a trending iv has no half-life");
  ok(["not-mean-reverting", "oscillating", "degenerate"].includes(up.silent.halfLife), `and names why (${up.silent.halfLife})`);
}

{
  const session = "2026-09-22";
  const days = weekdaysEnding(session, 300);
  const bars = days.map((d, i) => ({ d, o: 100, h: 101, l: 99, c: 100 * Math.exp(0.01 * Math.sin(i * 0.9)) }));
  const vrpRows = [];
  for (let i = 0; i < days.length - 20; i++) {
    const iv = 0.25 + 0.02 * Math.sin(i / 9);
    vrpRows.push({ date: days[i], ticker: "T", rank: "0.5", implied_volatility: String(iv),
      realized_volatility: String(iv - (i % 3 === 0 ? -0.01 : 0.02)), realized_volatility_days: 21, implied_volatility_days: 30,
      realized_date: days[i + 20], risk_premium: String(i % 3 === 0 ? -0.01 : 0.02) });
  }
  vrpRows.push({ date: days[days.length - 5], implied_volatility: "0.3", realized_volatility: "0.2", realized_date: "2026-10-20",
    risk_premium: "0.1", rank: "0.9" });
  const vrp = buildVrpPanel({ data: vrpRows }, { sessionDate: session, iv30: 0.27, bars,
    garch: { status: "ok", avg21Vol: 20, alpha: 0.05, converged: true } });
  eq(vrp.lookAhead, 1, "a row whose realized window ends after the session is counted as look-ahead");
  ok(vrp.latest.realizedDate <= session, "and the latest ex-post reading is the last COMPLETED window");
  const win = vrpRows.filter((r) => r.realized_date <= session).slice(-252);
  near(vrp.hitRate, win.filter((r) => Number(r.risk_premium) > 0).length / win.length, 1e-4,
    "the seller hit rate is the share of the last 252 completed windows with rp > 0");
  near(vrp.exAnte.rv21, closeToCloseVol(bars, 21), 1e-4, "ex-ante RV21 is the trailing close-to-close vol at the session");
  near(vrp.exAnte.vrp, 0.27 - closeToCloseVol(bars, 21), 1e-4, "ex-ante VRP = iv30 today - trailing RV21");
  ok(vrp.exAnte.n >= MIN_HISTORY, `its z is taken against ${vrp.exAnte.n} reconstructed ex-ante values`);
  const hist = [];
  for (const r of vrpRows) {
    const i = days.indexOf(r.date);
    if (i >= 21 && r.date < session) hist.push(Number(r.implied_volatility) - closeToCloseVol(bars.slice(0, i + 1), 21));
  }
  const zz = zAgainst(0.27 - closeToCloseVol(bars, 21), hist.slice(-252));
  near(vrp.exAnte.z, zz.z, 2e-3, "and the z matches a direct reconstruction, with no row at or after the session in its history");
  near(vrp.garch.volPoints, 0.07, 1e-9, "VRP against the GARCH 21-session forecast, in vol points");
  eq(vrp.garch.weak, false, "a converged fit with alpha >= 0.01 is not weak");
  const noIv = buildVrpPanel({ data: vrpRows }, { sessionDate: session, iv30: null, bars });
  eq(noIv.exAnte.vrp, null, "without today's iv30 the ex-ante VRP is absent, never zero");
  eq(noIv.silent.exAnte, "input-absent", "and its silence is named");
  eq(noIv.silent.garch, "input-absent", "as is the GARCH comparison");
  const short = buildVrpPanel({ data: vrpRows.slice(-30) }, { sessionDate: session, iv30: 0.27, bars });
  eq(short.hitRate, null, "under sixty completed windows there is no hit rate");
  const after = buildVrpPanel({ data: [{ ...vrpRows[0], date: "2026-09-23" }] }, { sessionDate: session });
  eq(after.code, "after-session", "a feed dated wholly after the session is quiet with its reason");
}

{
  eq(volVote("rich", "rich"), 1, "same view agrees");
  eq(volVote("rich", "cheap"), -1, "opposite views disagree");
  eq(volVote("neutral", "rich"), 0, "a neutral side is a zero vote");
  eq(volVote(null, "rich"), null, "a missing side is no vote");
  eq(viewOfRichCheap(0.2), "rich", "above +0.15 the cone is rich");
  eq(viewOfRichCheap(-0.2), "cheap", "below -0.15 cheap");
  eq(viewOfRichCheap(null), null, "no score, no view");
  const panel = { status: "ok", view: "mean-reverting", silent: {} };
  eq(characterVote(panel, 5).vote, 1, "a fast iv half-life agrees with a mean-reverting vendor class");
  eq(characterVote(panel, 80).vote, -1, "a slow one disagrees");
  eq(characterVote(panel, null).silent.vote, "no-counterpart", "no iv half-life is no counterpart");
  const x = crossSectionPercentiles(Array.from({ length: 12 }, (_, i) => ({ v: i })), { v: (e) => e.v });
  eq([...x.values()][11].v, 1, "the largest of twelve names sits at the top of the cross-section");
  const few = crossSectionPercentiles(Array.from({ length: 5 }, (_, i) => ({ v: i })), { v: (e) => e.v });
  eq([...few.values()][0].v, null, "under ten names there is no cross-sectional percentile");
}

{
  const rows = [
    { date: "2024-09-21", close: "1" }, { date: "2025-09-22", close: "1" }, { date: "2025-09-23", close: "1" },
    { date: "2026-09-22", close: "1" }, { start_time: "2026-01-02T14:30:00Z", close: "1" }, { close: "1" },
  ];
  deepEq(yearOfCandles(rows, "2026-09-22").map((r) => r.date || r.start_time.slice(0, 10)),
    ["2025-09-23", "2026-09-22", "2026-01-02"]);
  eq(errorCode(new Error("/api/x -> HTTP 403")).code, "refused", "a 4xx is a refusal");
  eq(errorCode(new Error("/api/x -> HTTP 403")).http, 403, "with its status");
  eq(errorCode(new Error("/api/x -> HTTP 500")).code, "read-failed", "a 5xx after retries is a failed read");
  eq(errorCode(new Error("socket hang up")).code, "read-failed", "as is a network error");
  eq(errorCode(new Error("/api/x -> HTTP 429")).code, "read-failed", "and a 429 is not the vendor refusing the route");
}

{
  const session = "2026-09-22";
  const candlesAAA = (await fakeVolVendor({ sessionDate: session })("/api/stock/AAA/ohlc/1d", { timeframe: "2Y", end_date: session })).data;
  const byTicker = new Map([
    ["AAA", { raw: { expiries: fakeListedExpiries(session).map((e) => ({ expiry: e })), ohlc2y: candlesAAA },
      row: { next_earnings_date: "2026-10-20", er_time: "postmarket" },
      features: { garch: { status: "ok", avg21Vol: 30, alpha: 0.04, converged: true } } }],
  ]);
  const deep = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III", "JJJ", "KKK"].map((t, i) => [t, i % 2 ? "long" : "short"]);
  const names = volNames({ deep, crossSection: ["LLL", "MMM", "AAA"], byTicker });
  eq(names.length, 11 + 2 + VOL_INDEX_NAMES.length, "a name already deep is not read twice as carded");
  eq(names.find((x) => x.ticker === "AAA").earnings.date, "2026-10-20", "the screener's earnings date rides with the name");
  const fake = fakeVolVendor({ sessionDate: session, names });
  const seen = [];
  const recorder = async (path, params, opts) => {
    seen.push({ path, params: { ...params }, opts });
    if (path.startsWith("/api/stock/DDD/volatility/anomaly")) throw new Error(path + " -> HTTP 403");
    if (path.startsWith("/api/stock/EEE/volatility/option-sentiment")) return { data: "not rows" };
    if (path.startsWith("/api/stock/FFF/historical-risk-reversal-skew") && params.delta === 10) throw new Error(path + " -> HTTP 500");
    return fake(path, params, opts);
  };
  const leg = await runVolLeg({ uw: recorder, names, sessionDate: session, now: () => "2026-09-22T21:40:00.000Z" });
  ok(seen.every((c) => c.opts && c.opts.envelope === true), "every vol read asks uw() for the whole envelope");
  ok(seen.filter((c) => c.path.startsWith("/api/stock/")).every((c) => c.params.date === session || c.params.end_date === session),
    "every per-name read is dated at the session");
  ok(seen.filter((c) => /variance-risk-premium$/.test(c.path)).every((c) => c.params.days === 21),
    "the VRP is read at days=21 (the probe-confirmed horizon)");
  const rr = seen.filter((c) => /historical-risk-reversal-skew$/.test(c.path));
  ok(rr.length && rr.every((c) => (c.params.delta === 25 || c.params.delta === 10) && c.params.timeframe === "1Y" && isStandardMonthly(c.params.expiry, new Set())),
    "risk reversals are read at delta 25 and 10 on a standard monthly, over 1Y");
  eq(seen.filter((c) => /iv-rank$/.test(c.path)).length, VOL_INDEX_NAMES.length,
    "the leg reads iv-rank only for the index names; a deep name's comes from the card leg's own read");
  ok(seen.filter((c) => /iv-rank$/.test(c.path)).every((c) => c.params.timespan === "1y"), "and over 1y");
  eq(seen.filter((c) => /ohlc\/1d$/.test(c.path)).length, names.length - 1,
    "two-year candles are read only for names that arrived without them (AAA brought the enrichment's)");
  eq(seen.filter((c) => c.path === "/api/stock/AAA/ohlc/1d").length, 0, "so AAA spends no candle call");
  ok(seen.filter((c) => /ohlc\/1d$/.test(c.path)).every((c) => c.params.timeframe === "2Y"), "and over 2Y");
  const perDepth = (t) => seen.filter((c) => c.path.startsWith(`/api/stock/${t}/`) && !/ohlc/.test(c.path)).length;
  eq(perDepth("LLL"), VOL_DEPTH_READS.carded.length, "a carded name costs its two reads");
  eq(perDepth("BBB"), VOL_DEPTH_READS.deep.length, "a deep name costs its eight");
  eq(seen.filter((c) => c.path.startsWith("/api/volatility/")).length, 4, "the market radar is four reads");
  deepEq(seen.filter((c) => c.path === "/api/volatility/anomaly/top").map((c) => c.params.direction).sort(), ["long_vol", "short_vol"]);
  eq(leg.stats.calls, seen.length, "the leg counts every call it made");

  const e = (t) => leg.byTicker.get(t);
  eq(e("DDD").panels.anomaly.status, "unavailable", "a refused anomaly read is unavailable");
  eq(e("DDD").panels.anomaly.code, "refused", "as a refusal");
  eq(e("DDD").panels.anomaly.http, 403, "with the status that refused it");
  eq(e("EEE").panels.sentiment.status, "unreadable", "a sentiment body that is not the composite shape is unreadable");
  eq(e("FFF").panels.skew.rr10, null, "a failed 10-delta read leaves RR10 absent on an otherwise read skew");
  eq(e("FFF").panels.skew.status, "ok", "without silencing the 25-delta reading");
  eq(e("LLL").panels.term.code, "not-read", "a carded name's term structure is not read, and says so");
  eq(e("AAA").panels.term.earnings.date, "2026-10-20", "the deep name's term structure sees its earnings date");
  ok(e("AAA").panels.term.eventMove.sd > 0, "and prices an event move from it");
  eq(e("AAA").panels.vrp.garch.forecast, 0.3, "the GARCH forecast arrives in percent and is published as a decimal");
  ok(e("AAA").panels.vrp.exAnte.iv30ExEvent < e("AAA").panels.vrp.exAnte.iv30,
    "an earnings date inside thirty days is stripped from iv30 before the ex-ante VRP is read ex-event");
  near(e("AAA").panels.vrp.exAnte.vrpExEvent, e("AAA").panels.vrp.exAnte.iv30ExEvent - e("AAA").panels.vrp.exAnte.rv21, 1e-4,
    "and the ex-event VRP is that iv less the same trailing RV21");
  eq(e("LLL").panels.vrp.exAnte.vrpExEvent, e("LLL").panels.vrp.exAnte.vrp,
    "a carded name with no earnings inside thirty days needs no term read: its ex-event VRP is its VRP");
  eq(e("SPY").panels.ivDyn.status, "ok", "an index name's IV dynamics come from the leg's own 1y read");
  eq(e("BBB").panels.ivDyn.code, "not-read", "a deep name's wait for the card leg");
  ok(e("AAA").panels.cone.xPct.richCheap !== undefined, "cross-sectional percentiles are attached");
  eq(e("SPY").panels.cone.xPct.richCheap, null, "and the index names are kept out of the equity cross-section");
  eq(e("AAA").readAt, "2026-09-22T21:40:00.000Z", "each name carries the instant it was read");

  const card = { ticker: "BBB", panels: {} };
  attachVol(card, leg, "BBB", { ivRank: { data: Array.from({ length: 251 }, (_, i) => ({
    date: addDays("2025-09-01", i), volatility: String(0.3 + 0.02 * Math.sin(i / 5)), iv_rank_1y: "40", close: "100" })) } });
  eq(e("BBB").panels.ivDyn.status, "ok", "the card leg's 1y iv-rank rows complete the deep name's IV dynamics");
  ok(card.x && card.x.vol && card.x.vol.v === 1, "and the card carries a compact vol summary under x.vol");
  eq(card.x.vol.ivDyn.halfLife, e("BBB").panels.ivDyn.halfLife, "that reads the same number the dossier publishes");
  ok(card.x.vol.votes.character !== undefined, "the character vote is re-cast with the IV half-life");
  const cardNull = { panels: {} };
  attachVol(cardNull, leg, "CCC", { ivRank: null });
  eq(e("CCC").panels.ivDyn.code, "read-failed", "a failed card-leg iv-rank read is a failed IV dynamics, not an empty one");
  const stray = { panels: {} };
  attachVol(stray, leg, "NOPE");
  eq(stray.x.vol.code, "not-read", "a card the leg never read says so rather than carrying nothing");
  const bytesBefore = JSON.stringify(card).length;
  ok(bytesBefore < 2048, `the card summary is small (${bytesBefore} bytes with an empty card)`);

  const out = cardXPayload(e("AAA"), { sessionDate: session, generatedAt: "2026-09-22T21:45:00.000Z" });
  ok(out.fits && out.bytes < CARD_X_CAP, `the deep dossier fits the cap (${out.bytes} bytes)`);
  deepEq(VOL_PANELS.filter((k) => !(k in out.body)), []);
  eq(out.body.scope, "deep", "the dossier states its scope");
  eq(out.body.fresh.readAt, "2026-09-22T21:40:00.000Z", "and carries the freshness envelope with the read instant");
  eq(out.body.fresh.cadenceS, 0, "on the nightly cadence");
  for (const code of Object.keys(out.body.why)) eq(out.body.why[code], VOL_WHY[code], `the ${code} silence is explained once on the payload`);
  const tiny = cardXPayload(e("AAA"), { sessionDate: session, cap: 8 * 1024 });
  ok(tiny.shed.length > 0 && tiny.shed[0] === "sentiment.history", "over the cap the histories are shed first, sentiment first");
  const dossierDDD = cardXPayload(e("DDD"), { sessionDate: session }).body;
  eq(dossierDDD.why.refused, VOL_WHY.refused, "a refused read's silence is in the dossier's legend");

  const rg = regimePayload(leg, { sessionDate: session, generatedAt: "g" });
  eq(rg.volRadar.status, "ok", "the regime carries the vol radar");
  ok(JSON.stringify(rg).length < 16 * 1024, "and stays small");

  const published = new Map();
  const outcome = await publishVol(leg, { publish: async (k, v) => { published.set(k, v); }, sessionDate: session, generatedAt: "g" });
  eq(outcome.published, names.length, "one dossier per name is published");
  ok(published.has("regime") && published.has("card-x:SPY") && published.has("card-x:LLL"), "under card-x:<T> and regime");

  const stopped = await runVolLeg({ uw: fake, names: names.slice(0, 3), sessionDate: session, radar: false,
    pool: async (items, work) => ({ results: [await work(items[0])] }) });
  eq(stopped.byTicker.get(names[1].ticker).panels.cone.code, "deadline", "a name the pool never reached is marked deadline");
  eq(stopped.radar, null, "and the radar can be left off");
  eq(volSummary(stopped.byTicker.get(names[1].ticker).panels).iv30, null, "a deadline name summarises to nulls, never zeros");
}

{
  const req = volRequest("rr25", "BRK.B", S, { expiry: "2026-10-16" });
  eq(req.path, "/api/stock/BRK.B/historical-risk-reversal-skew", "tickers with a dot stay in the path");
  deepEq(req.params, { expiry: "2026-10-16", delta: 25, timeframe: "1Y", date: S });
  deepEq(radarRequest("bearish", S).params, { direction: "bearish", limit: 50, date: S });
  eq(vnum("2.5e6"), 2.5e6, "scientific notation strings parse");
  eq(vnum(""), null, "an empty string is absent");
  eq(vnum("0.000000000042138"), 4.2138e-11, "long decimal strings parse");
  eq(round(-0.00001, 3), 0, "rounding never publishes a negative zero");
}

console.log(`✓ flows-vol: ${n} assertions — every quant-spec known answer for the volatility family, Yang-Zhang, ` +
  "Parkinson, the gap share, forward vol, the AR(1) half-life and the maturity-adjusted skew z against an mpmath " +
  "reference, every live probe row parsed with its string numbers and 0-1 percentiles, each silence carried as a named " +
  "code rather than a zero, no row at or after the session read into a history, and the leg's reads, its failure arms, " +
  "the card summary, the dossier's cap and the regime radar exercised against the fake vendor");
