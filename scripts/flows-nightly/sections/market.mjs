import { buildEvents, EVENTS_NOTES } from "../../../shared/flows-events.js";
import { marketAggregate, MARKET_NOTES } from "../../../shared/flows-market.js";
import { withPrefetched } from "../../flows-legs/universe.mjs";
import { runMarketLegs, windowTickersOf } from "../../flows-legs/market.mjs";
import { makeCardXStore } from "../../flows-legs/card-x.mjs";
import { DEADLINE_MS, EARNINGS_GATE_DAYS } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats } from "../vendor.mjs";
import { publish } from "../store.mjs";
import { BOARD_SCHEMA_VERSION, MOVER_ROWS, buildMovers, daysToEarnings } from "../rank.mjs";

export async function runMarket(ctx) {
  const {
    stages, generatedAt, sessionDate, withTilt, screener, universe, vendor, holdings, screenerDate, harvest,
    universeSource, screenerFilters, eligibleFor, byCard, deepTickers, gateOrigin, tilted, picks, liquid, payloads,
    enriched,
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
  let marketLegs = null;
  await stages.run("market-legs", async () => {
    marketLegs = await runMarketLegs({
      uw: withPrefetched(vendor, new Map([[holdings.path, holdings]])),
      sessionDate, screenerDate, generatedAt, harvest: harvest || universeSource, filters: screenerFilters, eligible: eligibleFor,
      cardedTickers: [...byCard.keys()],
      deepTickers,
      windowTickers: windowTickersOf(withTilt.map((w) => w.row), { origin: sessionDate || gateOrigin }),
      deadline: stats.startedAt + DEADLINE_MS, pool: runPooled, width: poolWidth(2).width, stats,
      log: (line) => console.log(line),
    });
    for (const [t, part] of marketLegs.ownership) {
      cardX.add(t, "short", part.short);
      cardX.add(t, "insiders", part.insiders);
    }
    for (const [t, e] of marketLegs.earnings) cardX.add(t, "earnings", e);
    console.log(`  market legs: ${marketLegs.calls ?? 0} vendor call(s)`);
  }, (error) => {
    console.warn(`  market legs: ${error.message} — universe, regime and card-x were not built this run`);
  });
  if (marketLegs) {
    await stages.run("market-universe", () => publish("universe", marketLegs.universe), (error) => {
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

    await publish("events", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt,

      sessionDate,
      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,
      status: events.shown ? "ok" : "quiet",

      announce: { status: "unavailable", reason: EVENTS_NOTES.announce },
      ...events,
      ...(marketLegs ? marketLegs.eventsAdditions : {}),
      notes: EVENTS_NOTES,
    });
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
