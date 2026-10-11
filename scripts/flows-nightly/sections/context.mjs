import { indexMarketCross, CROSS_FEEDS } from "../../../shared/flows-card.js";
import { FOCUS_FUNDS } from "../../../shared/flows-focus.js";
import { runVolLeg, volNames } from "../../flows-legs/vol.mjs";
import { fakeVolVendor } from "../../flows-legs/vol-fake.mjs";
import { INDEX_TICKERS } from "../../flows-legs/universe.mjs";
import { DRY_RUN } from "../flags.mjs";
import { DEADLINE_MS, MARKET_CROSS_LIMIT } from "../vendor-params.mjs";
import { poolWidth, runPooled, stats, uw } from "../vendor.mjs";
import { readDayOf } from "../clock.mjs";
import { repairCandles } from "../rank.mjs";
import { fakeCongress } from "../fixtures.mjs";

export async function runContext(ctx) {
  const {
    stages, deepTickers, sideOfRow, byCard, scored, politicalFilings, POLITICAL_WINDOW_DAYS, crossRaws, marketLegs,
    sessionDate,
  } = ctx;
  stages.step("congress");
  const onBoard = new Map();
  for (const t of deepTickers) onBoard.set(t, sideOfRow.get(t) || null);
  const byTicker = byCard;
  const scoredByTicker = new Map(scored.map((r) => [r.ticker, r]));

  const crossSectionTickers = [...byTicker.keys()].filter((t) => !onBoard.has(t));
  const cardedTickers = [...onBoard.keys()].concat(crossSectionTickers);
  const carded = new Set(cardedTickers);

  const congressByTicker = new Map();

  let congressRead = "not attempted";
  let congressTapeRows = 0;
  const congressNamesRead = new Set();
  if (onBoard.size) {
    let marketWide = 0;
    try {

      const recent = DRY_RUN
        ? [...onBoard.keys(), ...crossSectionTickers.filter((_, i) => i % 2 === 0)]
          .flatMap((t) => fakeCongress(t))
        : await uw("/api/congress/recent-trades", { limit: 100 });

      const identity = (r) => `${(r && r.politician_id) || (r && r.name) || ""}|` +
        `${(r && r.ticker) || ""}|${(r && r.transaction_date) || ""}|` +
        `${(r && r.filed_at_date) || ""}|${(r && r.amounts) || ""}|${(r && r.mid_value) || ""}`;
      const merged = [];
      const seenFiling = new Set();
      for (const row of [...(politicalFilings || []), ...recent]) {
        const key = identity(row);
        if (seenFiling.has(key)) continue;
        seenFiling.add(key);
        merged.push(row);
      }
      marketWide = merged.length;
      congressTapeRows = merged.length;

      congressRead = "ok";
      for (const row of merged) {
        const t = row && (row.ticker || row.symbol);
        if (!t || !carded.has(t)) continue;
        if (!congressByTicker.has(t)) congressByTicker.set(t, []);
        congressByTicker.get(t).push(row);
      }
      const boardMatched = [...congressByTicker.keys()].filter((t) => onBoard.has(t)).length;
      console.log(
        `  congress: ${merged.length} disclosure(s) market-wide ` +
        `(${recent.length} from this leg's own page` +
        (politicalFilings
          ? `, ${politicalFilings.length} joined from the political leg's ${POLITICAL_WINDOW_DAYS}-day ladder ` +
            `— the two windows are now one, so a card can no longer deny what /flows/political/ ranks`
          : `; the political ladder read nothing to join, so this card window is the shallow one`) +
        `), ${boardMatched} of ${onBoard.size} board name(s) matched` +
        (crossSectionTickers.length
          ? `, and ${congressByTicker.size - boardMatched} of ${crossSectionTickers.length} ` +
            "cross-section name(s) from the same tape, at no further call"
          : ""));
    } catch (error) {
      congressRead = "failed";
      console.warn(`  congress: market-wide read failed — ${error.message}`);
    }

    if (!marketWide && !DRY_RUN && Date.now() < stats.startedAt + DEADLINE_MS) {
      let recovered = 0;
      for (const ticker of onBoard.keys()) {
        if (Date.now() > stats.startedAt + DEADLINE_MS) break;
        const rows = await uw("/api/congress/recent-trades", { ticker, limit: 50 })
          .then((read) => { congressNamesRead.add(ticker); return read; })
          .catch(() => []);
        if (rows.length) { congressByTicker.set(ticker, rows); recovered++; }
      }
      console.warn(
        `  congress: fell back to ${onBoard.size} per-name calls; ${recovered} name(s) ` +
        `carry disclosures. A panel built from a failed read is a confident zero, ` +
        `which costs more than the calls do.`);
    }
  }
  const congressState = { byTicker: congressByTicker, read: congressRead,
    tapeRows: congressTapeRows, namesRead: congressNamesRead };

  const marketCross = indexMarketCross({
    oiChange: crossRaws ? crossRaws.oiChange : null,
    darkpool: crossRaws ? crossRaws.darkpool : null,
    limits: { oiChange: MARKET_CROSS_LIMIT, darkpool: MARKET_CROSS_LIMIT },
    tickers: cardedTickers.concat(marketLegs ? INDEX_TICKERS.filter((t) => marketLegs.indexRows.has(t)) : [], FOCUS_FUNDS),
    sessionDate,
  });
  const crossReadDay = crossRaws && crossRaws.readAt ? readDayOf(crossRaws.readAt) : null;
  for (const feed of CROSS_FEEDS) {
    const f = marketCross[feed];
    if (f.status !== "ok") {
      console.warn(`  cross ${feed}: ${f.status} — ${f.reason}`);
      continue;
    }
    console.log(
      `  cross ${feed}: ${f.coverage.in} of ${f.coverage.of} deep name(s) appear in ` +
      `${f.population} row(s) of ${f.requested} requested, covering ${f.names} name(s)` +

      (f.asOf
        ? `; the feed dates itself ${f.asOf}` +
          (f.sameSession === false ? ` — NOT this run's session (${sessionDate})` : "") +
          (f.asOfSessions > 1 ? ` and spans ${f.asOfSessions} sessions` : "")
        : "; the feed states no date of its own") +
      (crossReadDay ? `; read on ${crossReadDay} Eastern` : "") +
      `; order ${f.ordered ? f.ordered + " by " + f.orderedBy : "not measurable from the rows"}`);
    if (f.coverage.of && f.coverage.in * 5 < f.coverage.of) {
      console.warn(
        `  cross ${feed}: this join reaches ${f.coverage.in} of ${f.coverage.of} deep names. ` +
        "The other cards will say they did not make a market-wide selection, which is true " +
        "of each of them and is not a finding about any of them.");
    }
  }

  let volLeg = null;
  await stages.run("vol-leg", async () => {
    const volRoster = volNames({ deep: [...onBoard.entries()], crossSection: crossSectionTickers, byTicker,
      funds: FOCUS_FUNDS.filter((t) => !INDEX_TICKERS.includes(t)) });
    volLeg = await runVolLeg({
      uw: DRY_RUN ? fakeVolVendor({ sessionDate, names: volRoster }) : uw,
      names: volRoster, sessionDate, repair: repairCandles,
      pool: (items, work) => runPooled(items, work, {
        width: poolWidth(4).width, stopEarly: () => Date.now() > stats.startedAt + DEADLINE_MS }),
    });
  }, (error) => {
    console.warn(`  vol: the leg failed (${error.message}); every card carries x.vol as unavailable and no card-x is written`);
  });
  Object.assign(ctx, { onBoard, byTicker, scoredByTicker, crossSectionTickers, congressState, marketCross, volLeg });
}
