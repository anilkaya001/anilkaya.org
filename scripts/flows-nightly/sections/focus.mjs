import { num } from "../../../shared/flows-features.js";
import { buildCard, SURFACE_EXPIRIES } from "../../../shared/flows-card.js";
import { runFlowLeg } from "../../flows-legs/flow.mjs";
import { makeFlowFakeVendor, makeFlowFakeStore } from "../../flows-legs/flow-fake.mjs";
import { buildChainPanels, CHAIN_PAGE_SIZE, CHAIN_MAX_PAGES, mergeChainPages } from "../../../shared/flows-chain.js";
import { regimeState } from "../../../shared/flows-neuron.js";
import * as QP from "../../flows-quant-pipeline.mjs";
import {
  FOCUS_FUNDS, focusTickers, focusGroups, focusCloses, FOCUS_BUDGET_BYTES,
} from "../../../shared/flows-focus.js";
import { buildFocusPayload } from "../../flows-legs/focus.mjs";
import { attachVol, coneThinOf, publishVol } from "../../flows-legs/vol.mjs";
import { INDEX_TICKERS, readFocusRows } from "../../flows-legs/universe.mjs";
import { publishCardX } from "../../flows-legs/card-x.mjs";
import { buildIndexDossiers, dossierRoster } from "../../flows-legs/index-dossier.mjs";
import { DRY_RUN } from "../flags.mjs";
import { IV_RANK_PARAMS } from "../vendor-params.mjs";
import { poolWidth, readFailure, runPooled, uw } from "../vendor.mjs";
import { pathFor } from "../../../shared/flows-vendor-ops.js";
import { ARCHIVE_DATE_RE, flushHeld, hold, publish, publishedStore, readStored } from "../store.mjs";
import { easternDayOf } from "../clock.mjs";
import {
  computeFeatures, congressRows, enrich, readPxOf, screenerTilt, sessionCandles, sessionRow, sessionRows,
  variationOptions,
} from "../rank.mjs";
import {
  fakeChain, fakeEnrichment, fakeIvRank, fakeMaxPain, fakeStockDarkpool, fakeStockOiChange, fakeSurface,
  fakeTermStructure, tickerSeed,
} from "../fixtures.mjs";

function indexDossierDeps({ sessionDate, dating, generatedAt, screenerReadAt, congressState, marketCross, variationRun, volLeg = null, quantRate = null, deadline = null }) {
  const preps = new Map();
  const engineStats = { built: 0, withIdeas: 0, failed: 0, pages: 0 };
  const onSession = ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? { date: sessionDate } : {};
  return {
    enrich: async (ticker, spot, row) => {
      if (!DRY_RUN) return (await enrich(ticker, spot, sessionDate, dating)).raw;
      const fake = fakeEnrichment(ticker, spot, 9000 + tickerSeed(ticker), num(row.iv30d) || null);
      return { ...fake, ohlc: sessionCandles(fake.ohlc, sessionDate) };
    },
    features: (raw, ticker, spot, row) =>
      computeFeatures({ ...raw, ticker, spot, sessionDate, tilt: screenerTilt(row) }),
    perName: async (ticker, spot, raw) => {
      const expiries = (raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d > sessionDate)).sort().slice(0, SURFACE_EXPIRIES);
      const lost = [...(raw.readFailures || [])];
      const soft = (route, fallback) => (error) => {
        lost.push(readFailure(route, error));
        return fallback;
      };
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spot), fakeSurface(ticker, spot, expiries), fakeStockDarkpool(ticker, spot),
          fakeStockOiChange(ticker, spot), fakeTermStructure(ticker, spot, onSession), fakeIvRank(ticker, spot, IV_RANK_PARAMS)]
        : await Promise.all([
          uw(pathFor("max-pain", { ticker }), onSession).catch(soft("max-pain", [])),
          expiries.length
            ? uw(pathFor("spot-exposures-expiry-strike", { ticker }), {
              "expirations[]": expiries, ...onSession,
              min_strike: Math.floor(spot * 0.9), max_strike: Math.ceil(spot * 1.1), limit: 500,
            }).catch(soft("spot-exposures-expiry-strike", []))
            : Promise.resolve([]),
          uw(pathFor("darkpool", { ticker }), { limit: 60, ...onSession }).catch(soft("darkpool", null)),
          uw(pathFor("oi-change", { ticker }), { limit: 30, ...onSession }).catch(soft("oi-change", null)),
          uw(pathFor("term-structure", { ticker }), { ...onSession }).catch(soft("term-structure", null)),
          uw(pathFor("iv-rank", { ticker }), { ...IV_RANK_PARAMS, ...onSession }).catch(soft("iv-rank", null)),
        ]);
      return {
        maxPain, surface,
        darkpool: sessionRows(dpRaw, (r) => easternDayOf(r && r.executed_at), sessionDate).raw,
        oiDeltas: oiRaw, termStructure: termRaw,
        ivRank: sessionRows(rankRaw, (r) => easternDayOf(r && r.date), sessionDate, { through: true }).raw,
        readFailures: lost,
      };
    },
    engineStats,
    chain: async (ticker, spot, raw, features) => {
      const readPage = async (page) => {
        const rows = DRY_RUN
          ? (page ? [] : fakeChain(ticker, spot, 9500 + tickerSeed(ticker)))
          : await uw(pathFor("option-contracts", { ticker }), {
            exclude_zero_oi_chains: "true", limit: CHAIN_PAGE_SIZE, ...(page ? { page } : {}),
          });
        return Array.isArray(rows) ? rows : [];
      };
      const first = await readPage(0).catch(() => []);
      if (!first.length) return null;
      const pages = [first];
      let nextPage = 1;
      while (pages[pages.length - 1].length >= CHAIN_PAGE_SIZE && pages.length < CHAIN_MAX_PAGES &&
             !(deadline && Date.now() > deadline)) {
        let next;
        try { next = await readPage(nextPage); } catch { break; }
        nextPage++;
        if (nextPage === 2 && next.length && mergeChainPages([first, next]).duplicates === next.length) continue;
        pages.push(next);
        if (mergeChainPages(pages).duplicates) break;
      }
      engineStats.pages += nextPage;
      const merged = mergeChainPages(pages);
      const whole = pages.length > 1 ? merged.complete : first.length < CHAIN_PAGE_SIZE;
      if (quantRate) {
        try {
          const pass = QP.preparePass({
            rowsByTicker: new Map([[ticker, merged.rows]]), sessionDate, rate: quantRate, spotOf: () => spot,
            atrOf: () => (features && features.atr) || null, expiriesOf: () => (raw && raw.expiries) || [],
            gammaUnit: variationRun.unit.used,
          });
          const prep = pass.preps.get(ticker);
          if (prep) preps.set(ticker, { prep, crossSection: pass.crossSection.get(ticker) || null });
        } catch (error) {
          console.warn(`  quant ${ticker}: ${error.message}`);
        }
      }
      return buildChainPanels(merged.rows, {
        spot, asOf: sessionDate, ticker, ...(whole ? {} : { complete: false, pages: pages.length }),
      });
    },
    engine: ({ ticker, card, raw, features }) => {
      const held = preps.get(ticker);
      if (!held || !quantRate) return null;
      try {
        const closes = Array.isArray(features.candles) ? features.candles.map((c) => c && c[4]) : features.closes;
        const law = QP.garchLaw({ garch: features.garch, ticker, sessionDate, closes, rate: quantRate.r });
        const block = QP.engineBlock({
          ticker, sessionDate, spot: num(features.spot) || null, atr: features.atr, card, prep: held.prep, rate: quantRate,
          garch: features.garch, law, event: null, state: regimeState(card, {}), strikes: raw.strikes,
          crossSection: held.crossSection, coneThin: coneThinOf(volLeg, ticker),
        });
        if (!block) return null;
        engineStats.built++;
        if (block.ideas && block.ideas.length) engineStats.withIdeas++;
        return QP.attachEngine(card, block);
      } catch (error) {
        engineStats.failed++;
        console.warn(`  engine ${ticker}: ${error.message} — the card publishes without it`);
        return null;
      }
    },
    card: ({ ticker, row, raw, features, reads, chain, depth = "index" }) => {
      const card = buildCard({
        ticker, row: { ...sessionRow(row, features), nm: typeof row.full_name === "string" && row.full_name.trim() ? row.full_name.trim().slice(0, 60) : null }, features,
        strikes: raw.strikes, ticks: raw.ticks, expiries: raw.expiries,
        surface: reads.surface, chain,
        quant: preps.has(ticker) ? { zeroGamma: preps.get(ticker).prep.zero } : null,
        chainMissing: chain ? null : `the ${depth === "fund" ? "fund" : "index"} chain page could not be read this run`,
        scoreHistory: null, weights: null,
        maxPain: reads.maxPain, congress: congressRows(ticker, congressState), generatedAt, sessionDate,
        darkpool: reads.darkpool, oiDeltas: reads.oiDeltas, termStructure: reads.termStructure, ivRank: reads.ivRank,
        marketCross, variation: variationOptions(variationRun), readFailures: reads.readFailures,
      });
      card.readPx = readPxOf({ row, features }, screenerReadAt);
      attachVol(card, volLeg, ticker);
      return card;
    },
  };
}

export async function runFocus(ctx) {
  const {
    stages, volLeg, sessionDate, generatedAt, byTicker, deadline, cardTickers, crossSectionTickers, variationRun, ndx,
    vendor, screenerDate, marketLegs, dating, screenerReadAt, congressState, marketCross, enriched, screener, cardX, deepen,
  } = ctx;
  stages.step("vol-flow");
  const flowDeep = cardTickers.filter((t) => byTicker.has(t));
  const flowKeys = new Set([...flowDeep, ...crossSectionTickers].map((t) => "card-x:" + t));
  await publishVol(volLeg, {
    publish: async (key, body) => (flowKeys.has(key) ? hold(key, body) : publish(key, body)),
    stored: (key) => publishedStore[key] || null, sessionDate, generatedAt, log: (line) => console.log(line) });
  const flow = await runFlowLeg({
    uw: DRY_RUN
      ? makeFlowFakeVendor({ sessionDate, spotOf: (t) => byTicker.get(t) && byTicker.get(t).features.spot })
      : uw,
    readStored: DRY_RUN ? makeFlowFakeStore({ sessionDate }) : readStored,
    publish, stored: (key) => publishedStore[key] || null, runPooled,
    deadline, sessionDate, generatedAt,
    deep: flowDeep, cross: crossSectionTickers,
    featuresOf: (t) => (byTicker.get(t) || {}).features, strikesOf: (t) => ((byTicker.get(t) || {}).raw || {}).strikes,
    cardOf: (t) => publishedStore["card:" + t] || null, variation: variationRun,
    width: poolWidth(3).width, log: (line) => console.log(line),
  });
  const flushed = await flushHeld({ log: (line) => console.warn(line) });
  console.log(`  card-x: ${flushed.held} vol payload(s) held for the flow leg's merged write, ${flushed.landed} landed with it` +
    (flushed.flushed ? `, ${flushed.flushed} written on their own` : "") + (flushed.failed ? `, ${flushed.failed} failed` : ""));
  const ml = flow && flow.multiLeg;
  if (ml && (ml.firstBad || ml.laterBad)) {
    stages.detail({ mlNames: ml.names, mlFull: ml.full, mlFirstBad: ml.firstBad, mlLaterBad: ml.laterBad });
  }
  if (flushed.flushed || flushed.failed) stages.detail({ volFlushed: flushed.flushed, volFailed: flushed.failed });
  stages.step("dossiers");
  const focusAsk = focusTickers({ groups: focusGroups(ndx) });
  const focusRead = await readFocusRows(vendor, [...new Set([...focusAsk, ...FOCUS_FUNDS])], { date: screenerDate });
  console.log(`  focus read: ${focusRead.rows.size} of ${focusAsk.length + FOCUS_FUNDS.filter((t) => !focusAsk.includes(t)).length} ` +
    `row(s) in ${focusRead.calls} call(s)` + (focusRead.missing.length ? `, missing ${focusRead.missing.join(", ")}` : "") +
    (focusRead.ok ? "" : ` — FAILED (${focusRead.error})`));
  const fundRows = new Map();
  for (const t of FOCUS_FUNDS) {
    const row = focusRead.rows.get(t) || (marketLegs && marketLegs.indexRows.get(t));
    if (row) fundRows.set(t, row);
  }
  {
    const lost = FOCUS_FUNDS.filter((t) => !fundRows.has(t));
    if (lost.length && Date.now() < deadline) {
      const again = await readFocusRows(vendor, lost, { date: screenerDate });
      for (const [t, row] of again.rows) fundRows.set(t, row);
      console.log(`  fund rows: ${lost.length} not in the focus read (${lost.join(", ")}), read again in ${again.calls} call(s): ` +
        `${again.rows.size} returned` + (again.ok ? "" : ` — FAILED (${again.error})`));
    }
  }
  const dossierFeatures = new Map();
  const dossierBuilt = new Map();
  {
    const roster = dossierRoster({ index: INDEX_TICKERS, funds: FOCUS_FUNDS });
    const rows = new Map(marketLegs ? marketLegs.indexRows : []);
    for (const [t, row] of fundRows) if (!rows.has(t)) rows.set(t, row);
    const deps = indexDossierDeps({ sessionDate, dating, generatedAt, screenerReadAt, congressState, marketCross, variationRun, volLeg, quantRate: ctx.quantRate || null, deadline });
    const dossiers = await buildIndexDossiers({
      tickers: roster.tickers, depthOf: (t) => roster.depth.get(t), indexRows: rows, deadline,
      ...deps,
      features: (raw, ticker, spot, row) => {
        const f = deps.features(raw, ticker, spot, row);
        dossierFeatures.set(ticker, f);
        return f;
      },
      publish, log: (line) => console.warn(line),
    });
    for (const [t, d] of Object.entries(dossiers.depth)) dossierBuilt.set(t, d);
    const say = (depth) => {
      const want = roster.tickers.filter((t) => roster.depth.get(t) === depth);
      const built = want.filter((t) => dossiers.built.includes(t));
      const failed = want.filter((t) => dossiers.failed.includes(t));
      const skipped = want.filter((t) => dossiers.skipped.includes(t));
      return `${built.length} of ${want.length} ${depth} built` + (built.length ? ` (${built.join(", ")})` : "") +
        (failed.length ? `, failed ${failed.join(", ")}` : "") + (skipped.length ? `, skipped ${skipped.join(", ")}` : "");
    };
    console.log(`  dossiers: ${say("index")}; ${say("fund")}` +
      Object.entries(dossiers.shed).map(([t, keys]) => `; ${t} shed ${keys.join(", ")}`).join(""));
    console.log(`  dossiers: engine ran on ${deps.engineStats.built} of ${dossiers.built.length}, ${deps.engineStats.withIdeas} with a structure` +
      (deps.engineStats.failed ? `, ${deps.engineStats.failed} failed` : "") + `, ${deps.engineStats.pages} chain page call(s)`);
  }
  if (ctx.auditHooks) {
    if (ctx.auditHooks.on) await stages.run("vol-audit", () => ctx.auditHooks.run(), (error) => ctx.auditHooks.failed(error));
    else stages.skip("vol-audit", "FLOWS_VOLDESK_BUILD is off");
  }
  if (typeof ctx.beforeFocus === "function") await ctx.beforeFocus();
  {
    const featuresFor = new Map(enriched.map((e) => [e.features.ticker, e.features]));
    for (const [t, f] of dossierFeatures) featuresFor.set(t, f);
    await stages.run("focus", async () => {
      const askSet = new Set(focusAsk);
      const held = new Map(fundRows);
      for (const r of screener) if (r && askSet.has(r.ticker) && !held.has(r.ticker)) held.set(r.ticker, r);
      const focusPayload = buildFocusPayload({
        ndx, rows: focusRead.rows, read: focusRead, sessionDate, generatedAt, readAt: focusRead.readAt,
        closesOf: (t) => focusCloses(featuresFor.get(t), sessionDate),
        backfill: held, backfillFrom: "harvest", backfillReadAt: screenerReadAt,
      });
      await publish("focus", focusPayload);
      console.log(`  focus: ${focusPayload.status}, ${Object.keys(focusPayload.rows).length} row(s) over ` +
        `${focusPayload.groups.length} group(s), ${Object.keys(focusPayload.closes || {}).length} with closes` +
        (focusPayload.missing.length ? `, missing ${focusPayload.missing.join(", ")}` : "") +
        (focusPayload.backfill ? `, ${focusPayload.backfill.tickers.length} filled from the run's own harvest (${focusPayload.backfill.why})` : "") +
        `, ${focusPayload.bytes || JSON.stringify(focusPayload).length} bytes of ${FOCUS_BUDGET_BYTES}`);
    }, (error) => {
      console.warn(`  focus: ${error.message}`);
    });
  }
  {
    stages.step("card-x");
    const cx = await publishCardX(cardX, publish, {
      generatedAt, sessionDate, readAt: marketLegs ? marketLegs.readAt : null,
      stored: (key) => publishedStore[key] || null, log: (line) => console.warn(line),
      skip: deepen ? deepen.keep : new Set(),
    });
    console.log(`  card-x: ${cx.written} written` + (cx.kept ? `, ${cx.kept} deep read(s) kept as they stand` : "") + (cx.failed ? `, ${cx.failed} failed` : "") +
      (cx.over ? `, ${cx.over} over the cap` : "") + `, largest ${cx.largest} bytes, ${cx.largestWire} counted for the soft limit`);
  }
  Object.assign(ctx, { dossierBuilt });
}
