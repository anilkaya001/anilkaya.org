import { buildEvents, fitEvents, EVENTS_NOTES } from "../../../shared/flows-events.js";
import { marketAggregate, MARKET_NOTES } from "../../../shared/flows-market.js";
import { withPrefetched } from "../../flows-legs/universe.mjs";
import { runMarketLegs, windowTickersOf } from "../../flows-legs/market.mjs";
import { makeCardXStore } from "../../flows-legs/card-x.mjs";
import { CALL_BUDGET, CALL_COST, CALL_OVERRUN_MARGIN, DEADLINE_MS, EARNINGS_GATE_DAYS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats, uw } from "../vendor.mjs";
import { sigmaProfile, tallyReasons } from "../../../shared/flows-targets.js";
import { publish, readStored } from "../store.mjs";
import { DRY_RUN } from "../flags.mjs";
import { pathFor } from "../../../shared/flows-vendor-ops.js";
import { num } from "../../../shared/flows-features.js";
import { runSigmaLedger } from "../../flows-legs/sigma-ledger.mjs";
import { decodeLedger, recentReporters } from "../../../shared/flows-reports.js";
import { extrasCap, extrasMode } from "../../../shared/flows-vendor-extras.js";
import { BOARD_SCHEMA_VERSION, MOVER_ROWS, barsInHand, buildMovers, candleDate, candlesAscending, daysToEarnings, repairCandles, sessionCandles, sessionRow } from "../rank.mjs";

export async function runMarket(ctx) {
  const {
    stages, generatedAt, sessionDate, withTilt, screener, universe, vendor, holdings, screenerDate, harvest,
    universeSource, screenerFilters, eligibleFor, byCard, deepTickers, gateOrigin, tilted, picks, liquid, payloads,
    enriched, deepen,
  } = ctx;
  await stages.run("market", async () => {
    await publish("market", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      ...marketAggregate(
        withTilt.map((w) => w.row),
        new Map(withTilt.map((w) => [w.row.ticker, w.tilt])),
        { screened: screener.length },
      ),
      notes: MARKET_NOTES,
      status: "ok",
    });
  }, (error) => {
    console.warn(`  market: ${error.message}`);
  });

  let moversPayload = null;
  await stages.run("movers", async () => {
    const movers = buildMovers(withTilt);
    moversPayload = {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      universe: universe.length,
      cap: MOVER_ROWS,
      ranked: movers.ranked,
      priced: movers.priced,
      unrankedChange: movers.unrankedChange,
      unrankedPremium: movers.unrankedPremium,
      risers: movers.risers,
      fallers: movers.fallers,
      premium: movers.premium,
      status: (movers.risers.length || movers.fallers.length) ? "ok" : "thin",
    };
    await publish("movers", moversPayload);
    console.log(
      `  movers: ${movers.risers.length} up, ${movers.fallers.length} down of ` +
      `${movers.ranked} ranked` +
      (movers.unrankedChange ? `, ${movers.unrankedChange} with no prior close` : "") +
      `; premium ${movers.premium.bullish.length}/${movers.premium.bearish.length} of ${movers.priced}` +
      (movers.unrankedPremium ? `, ${movers.unrankedPremium} unquoted` : ""));
  }, (error) => {
    console.warn(`  movers: ${error.message}`);
  });

  const cardX = makeCardXStore();
  const sigma = new Map();
  const sigmaResults = [];
  for (const [t, entry] of byCard) {
    const held = barsInHand(entry);
    const r = held ? sigmaProfile(held.bars, { breaks: held.breaks }) : { ok: false, reason: "history" };
    sigmaResults.push(r);
    if (r.ok) sigma.set(t, r);
  }
  const tally = tallyReasons(sigmaResults);
  console.log(`  sigma: ${tally.forecast} of ${sigmaResults.length} carded name(s) forecast` +
    (Object.keys(tally.notForecast).length ? `, not forecast ${JSON.stringify(tally.notForecast)}` : ""));
  let sigmaLedger = null;
  let sigmaBasis = null;
  try {
    const priorRegime = await readStored("regime");
    if (priorRegime.failed) {
      console.warn(`  sigma ledger: the previous regime row could not be read (HTTP ${priorRegime.status || 0}); tonight carries only the ${sigma.size} fresh name(s)`);
    } else {
      const ledgerRun = await runSigmaLedger({
        sessionDate,
        universe: new Set(withTilt.map((w) => w.row && w.row.ticker).filter(Boolean)),
        fresh: sigma,
        prior: priorRegime.payload || null,
        rotate: CALL_COST.sigmaLedger,
        stop: () => Date.now() > stats.startedAt + DEADLINE_MS * 0.5 || stats.calls >= CALL_BUDGET * (1 + CALL_OVERRUN_MARGIN),
        fetchBars: DRY_RUN ? null : async (ticker) => {
          const raw = await uw(pathFor("ohlc-1d", { ticker }), {
            timeframe: "1Y",
            ...(sessionDate && ctx.dating && ctx.dating.endDate ? { end_date: sessionDate } : {}),
          });
          const cut = sessionCandles(raw, sessionDate);
          return {
            bars: candlesAscending(cut)
              .map((c) => ({ d: candleDate(c), h: num(c.high, null), l: num(c.low, null), c: num(c.close, null) }))
              .filter((b) => b.d),
            breaks: repairCandles(cut).breaks.map((b) => b.date).filter(Boolean),
          };
        },
      });
      for (const [t, r] of ledgerRun.sigma) if (!sigma.has(t)) sigma.set(t, r);
      sigmaLedger = ledgerRun.ledger;
      sigmaBasis = ledgerRun.basis;
      console.log(`  sigma ledger: ${sigmaBasis.covered} of ${sigmaBasis.universe} name(s) covered (${sigmaBasis.fresh} fresh, ${sigmaBasis.rotated} read tonight, ${sigmaBasis.short} short of history, oldest ${sigmaBasis.oldest || "none"})`);
    }
  } catch (error) {
    console.warn(`  sigma ledger: ${error.message}`);
  }
  let priorReports = null;
  let reportsWritable = false;
  if (sessionDate) {
    const got = await readStored("reports");
    if (got.failed) {
      console.warn(`  reports ledger: the previous ledger could not be read (HTTP ${got.status || 0}); tonight's rd comes from the reaction reads alone and the stored ledger is left as it is`);
      priorReports = decodeLedger(null);
    } else {
      priorReports = decodeLedger(got.payload || null);
      reportsWritable = true;
    }
  }
  let marketLegs = null;
  await stages.run("market-legs", async () => {
    marketLegs = await runMarketLegs({
      reports: priorReports ? { prior: priorReports } : null,
      uw: withPrefetched(vendor, new Map([[holdings.path, holdings]])),
      sessionDate, screenerDate, generatedAt, harvest: harvest || universeSource, filters: screenerFilters, eligible: eligibleFor,
      cardedTickers: [...byCard.keys()],
      readTickers: [...byCard.keys()].filter((t) => !(deepen && deepen.keep.has(t))),
      rowOf: (r) => (r && byCard.has(r.ticker) ? sessionRow(r, byCard.get(r.ticker).features) : r),
      sigma,
      deepTickers,
      windowTickers: windowTickersOf(withTilt.map((w) => w.row), { origin: sessionDate || gateOrigin }),
      deadline: stats.startedAt + DEADLINE_MS, pool: runPooled, width: poolWidth(2).width, stats,
      extras: extrasMode(process.env) === "off" ? null : { readPrior: (t) => readStored("card-x:" + t), cap: extrasCap(process.env) },
      log: (line) => console.log(line),
    });
    for (const [t, part] of marketLegs.ownership) {
      cardX.add(t, "short", part.short);
      cardX.add(t, "insiders", part.insiders);
    }
    for (const [t, e] of marketLegs.earnings) cardX.add(t, "earnings", e);
    if (marketLegs.extras) {
      for (const [t, sec] of marketLegs.extras.sections) {
        if (sec.dx) cardX.add(t, "dx", sec.dx);
        if (sec.vx) cardX.add(t, "vx", sec.vx);
      }
    }
    console.log(`  market legs: ${marketLegs.calls ?? 0} vendor call(s)`);
  }, (error) => {
    console.warn(`  market legs: ${error.message} — universe, regime and card-x were not built this run`);
  });
  if (marketLegs) {
    if (sigmaBasis) marketLegs.universe = { ...marketLegs.universe, sigmaBasis };
    if (sigmaLedger) marketLegs.regime = { ...marketLegs.regime, sigmaLedger };
    await stages.run("market-universe", async () => {
      await publish("universe", marketLegs.universe);
      if (reportsWritable && marketLegs.reports) await publish("reports", marketLegs.reports.payload);
      else console.warn(`  reports: the ledger was not written (${reportsWritable ? "none was built" : "the previous one could not be read"}) and stays as it was`);
    }, (error) => {
      console.warn(`  universe: ${error.message} — the other market keys are published regardless`);
    });
    await stages.run("market-regime", () => publish("regime", marketLegs.regime), (error) => {
      console.warn(`  regime: ${error.message} — the other market keys are published regardless`);
    });
  } else {
    stages.skip("market-universe", "the market legs did not run");
    stages.skip("market-regime", "the market legs did not run");
  }

  await stages.run("events", async () => {

    const stageByTicker = new Map();
    for (const { row } of withTilt) if (row && row.ticker) stageByTicker.set(row.ticker, "screened");
    for (const { row } of tilted) if (row && row.ticker) stageByTicker.set(row.ticker, "eligible");
    for (const p of picks) if (p && p.row && p.row.ticker) stageByTicker.set(p.row.ticker, "enriched");
    for (const e of liquid) if (e && e.row && e.row.ticker) stageByTicker.set(e.row.ticker, "liquid");
    for (const side of ["long", "short"]) {
      for (const r of (payloads[side] && payloads[side].rows) || []) {
        if (r && r.t) stageByTicker.set(r.t, side === "long" ? "board:long" : "board:short");
      }
    }

    for (const { row } of withTilt) {
      if (!row || !row.ticker) continue;
      const dte = daysToEarnings(row, gateOrigin);
      if (dte !== null && dte >= 0 && dte <= EARNINGS_GATE_DAYS) {
        stageByTicker.set(row.ticker, "gated");
      }
    }

    const featuresByTicker = new Map();
    for (const e of enriched) {
      if (e && e.row && e.row.ticker) featuresByTicker.set(e.row.ticker, e.features);
    }
    const scoreByTicker = new Map();
    for (const side of ["long", "short"]) {
      for (const r of (payloads[side] && payloads[side].rows) || []) {
        if (r && r.t && Number.isFinite(r.s)) scoreByTicker.set(r.t, r.s);
      }
    }

    const events = buildEvents(withTilt, {
      gateOrigin,
      sessionDate,
      stageOf: (t) => stageByTicker.get(t) || null,
      featuresOf: (t) => featuresByTicker.get(t) || null,
      scoreOf: (t) => (scoreByTicker.has(t) ? scoreByTicker.get(t) : null),
    });

    const eventsPayload = fitEvents({
      v: BOARD_SCHEMA_VERSION,
      generatedAt,

      sessionDate,
      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,
      status: events.shown ? "ok" : "quiet",

      announce: { status: "unavailable", reason: EVENTS_NOTES.announce },
      ...events,
      recent: recentReporters(marketLegs ? marketLegs.universe : null),
      ...(marketLegs ? marketLegs.eventsAdditions : {}),
      notes: EVENTS_NOTES,
    });
    await publish("events", eventsPayload);
    if (eventsPayload.shedRows) console.warn(`  events: ${eventsPayload.shedRows} far-dated row(s) shed to stay under the ingest cap`);
    const gatedShown = events.byStage.gated || 0;
    console.log(
      `  events: ${events.shown} of ${events.inWindow} names reporting within ` +
      `${events.windowDays} days, of ${events.universe} screened` +
      (events.undated ? ` (${events.undated} carry no earnings date)` : "") +
      `; ${gatedShown} of them the board was gated out of, ` +
      `${events.evMeasured} with a priced move, ${events.rvMeasured} with realized vol`);
  }, (error) => {
    console.warn(`  events: ${error.message}`);
  });
  Object.assign(ctx, { moversPayload, cardX, marketLegs });
}
