import { num } from "../../../shared/flows-features.js";
import { buildCard, SURFACE_EXPIRIES } from "../../../shared/flows-card.js";
import { sessionPrints, sessionPrintParams } from "../../../shared/flows-positioning.js";
import { regimeState } from "../../../shared/flows-neuron.js";
import { cardTier } from "../../../shared/flows-neuron-coverage.js";
import * as QP from "../../flows-quant-pipeline.mjs";
import { attachVol, coneThinOf } from "../../flows-legs/vol.mjs";
import { DRY_RUN } from "../flags.mjs";
import { DEADLINE_MS, IV_RANK_PARAMS } from "../vendor-params.mjs";
import { foldCardOutcomes, poolWidth, runPooled, stats, uw } from "../vendor.mjs";
import { ARCHIVE_DATE_RE, publish } from "../store.mjs";
import { easternDayOf } from "../clock.mjs";
import { archiveIdeas, congressRows, ideasPayload, readPxOf, sessionRow, sessionRows, variationOptions } from "../rank.mjs";
import {
  fakeEarnings, fakeIvRank, fakeMaxPain, fakeStockDarkpool, fakeStockOiChange, fakeSurface, fakeTermStructure,
} from "../fixtures.mjs";

export function markGate(card, e) {
  if (!card || !e || !e.gate) return card;
  card.score = null;
  card.conviction = null;
  card.gate = { earnings: e.gate.earnings, dte: e.gate.dte };
  return card;
}

function card0Unusable(row) {
  if (!row || typeof row !== "object") return true;
  return !["call_gamma_ask", "call_gamma_bid", "put_gamma_ask", "put_gamma_bid"]
    .some((k) => row[k] !== undefined && row[k] !== null && row[k] !== "");
}

export const CARD_SELF_CHECK_BYTES = 100 * 1024;

export const CARD_SHED = Object.freeze([
  ["topContracts", "dropped to fit the payload cap — the day's most-traded contracts " +
    "are on the premium desk for this symbol"],
  ["aggressor", "dropped to fit the payload cap"],
  ["ivSurface", "dropped to fit the payload cap"],
  ["skewTerm", "dropped to fit the payload cap"],

  ["darkpool", "dropped to fit the payload cap"],
  ["oiDeltas", "dropped to fit the payload cap"],
  ["volContext", "dropped to fit the payload cap"],

  ["marketRank", "dropped to fit the payload cap — the market-wide feeds it joins are " +
    "published whole on the market pulse page"],
]);

export function shedCardToCap(card, cap = CARD_SELF_CHECK_BYTES) {
  let body = JSON.stringify(card);
  const dropped = [];
  const surface = card.panels && card.panels.surface;
  if (body.length > cap && surface && surface.status === "ok" && surface.oi) {
    surface.oi = null;
    dropped.push("surface.oi");
    body = JSON.stringify(card);
  }
  for (const [key, reason] of CARD_SHED) {
    if (body.length <= cap) break;
    if (!card.panels[key] || card.panels[key].status !== "ok") continue;
    card.panels[key] = { status: "unavailable", reason };
    dropped.push(key);
    body = JSON.stringify(card);
  }
  return { body, dropped };
}

export async function runCards(ctx) {
  const {
    stages, sessionDate, onBoard, byTicker, congressState, quantPass, scoredByTicker, chainByTicker, chainMiss,
    scoreTrack, scoreTrackPremium, first, generatedAt, marketCross, variationRun, screenerReadAt, deepSet, volLeg,
    quantRate, crossSectionTickers,
  } = ctx;
  stages.step("cards");
  let surfaceReported = false;
  const onSession = ARCHIVE_DATE_RE.test(String(sessionDate || "")) ? { date: sessionDate } : {};
  const perNameCut = { names: 0, darkpool: 0, ivRank: 0 };
  const deadline = stats.startedAt + DEADLINE_MS;
  const cardTickers = [...onBoard.keys()];
  const quantStats = { built: 0, withIdeas: 0, split: 0, failed: 0, bytes: [] };
  const neuronTiers = new Map();
  const cardLane = poolWidth(2);
  const ideaByTicker = new Map();
  console.log(`  cards: ${cardTickers.length} name(s), ${cardLane.width} in flight — ${cardLane.why}`);
  const cardsRun = await runPooled(cardTickers, async (ticker, index) => {
    const e = byTicker.get(ticker);

    if (!e) return { status: "unenriched" };
    try {

      const surfaceExpiries = (e.raw.expiries || [])
        .map((r) => (r && r.expiry ? String(r.expiry).slice(0, 10) : null))
        .filter((d) => d && (!sessionDate || d > sessionDate))
        .sort()
        .slice(0, SURFACE_EXPIRIES);

      const spotPx = num(e.features.spot) || num(e.row.close);

      const congress = congressRows(ticker, congressState);
      const quantPrep = quantPass.preps.get(ticker) || null;
      const [maxPain, surface, dpRaw, oiRaw, termRaw, rankRaw, earnRaw] = DRY_RUN
        ? [fakeMaxPain(ticker, spotPx), fakeSurface(ticker, spotPx, surfaceExpiries),
           fakeStockDarkpool(ticker, spotPx), fakeStockOiChange(ticker, spotPx),
           fakeTermStructure(ticker, spotPx, sessionDate ? { date: sessionDate } : {}),
           fakeIvRank(ticker, spotPx, IV_RANK_PARAMS), quantPrep ? fakeEarnings(ticker, sessionDate) : null]
        : await Promise.all([

          uw(`/api/stock/${ticker}/max-pain`, sessionDate ? { date: sessionDate } : {}).catch(() => []),

          surfaceExpiries.length
            ? uw(`/api/stock/${ticker}/spot-exposures/expiry-strike`, {
              "expirations[]": surfaceExpiries,
              ...(sessionDate ? { date: sessionDate } : {}),

              ...(spotPx >= 20
                ? { min_strike: Math.floor(spotPx * 0.75), max_strike: Math.ceil(spotPx * 1.25) }
                : {}),
              limit: 500,
            }).catch(() => [])
            : Promise.resolve([]),

          uw(`/api/darkpool/${ticker}`, { limit: 500, ...onSession, ...sessionPrintParams(sessionDate) })
            .catch(() => null),
          uw(`/api/stock/${ticker}/oi-change`, { limit: 30, ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/volatility/term-structure`, { ...onSession }).catch(() => null),
          uw(`/api/stock/${ticker}/iv-rank`, { ...IV_RANK_PARAMS, ...onSession }).catch(() => null),

          quantPrep ? uw(`/api/earnings/${ticker}`, {}).catch(() => null) : Promise.resolve(null),
        ]);
      const darkpoolCut = sessionRows(dpRaw, (r) => easternDayOf(r && r.executed_at), sessionDate);
      const darkpoolRth = sessionPrints(dpRaw, sessionDate, { limit: 500 });
      const rankCut = sessionRows(rankRaw, (r) => easternDayOf(r && r.date), sessionDate,
        { through: true });
      if (darkpoolCut.cut || rankCut.cut) {
        perNameCut.names++;
        perNameCut.darkpool += darkpoolCut.cut;
        perNameCut.ivRank += rankCut.cut;
      }

      if (!surfaceReported && !DRY_RUN) {
        surfaceReported = true;
        const rows = Array.isArray(surface) ? surface : (surface && surface.data) || [];
        if (!rows.length) {
          console.warn(
            `  NOTE: ${ticker} /spot-exposures/expiry-strike returned no rows for ` +
            `${surfaceExpiries.length} expiries (${surfaceExpiries.slice(0, 3).join(", ")}...). ` +
            "The gamma surface will be unavailable on every card until it does.");
        } else if (card0Unusable(rows[0])) {
          console.warn(
            `  NOTE: ${ticker} /spot-exposures/expiry-strike returned ${rows.length} rows ` +
            "carrying no readable gamma leg. First row: " +
            Object.entries(rows[0]).slice(0, 12)
              .map(([k, v]) => `${k}=${String(v).slice(0, 18)}`).join(" "));
        } else {
          console.log(`  surface: ${ticker} (board position ${index + 1}) ${rows.length} rows ` +
            `over ${surfaceExpiries.length} expiries`);
        }
      }

      const earnings = quantPrep ? QP.earningsFromVendor(earnRaw, { sessionDate }) : null;
      const garch = earnings ? QP.refitGarch(e.features, earnings.mask) : e.features.garch;
      const card = buildCard({
        ticker,
        row: sessionRow(e.row, e.features),
        features: { ...e.features, ...(scoredByTicker.get(ticker) || {}), garch },
        strikes: e.raw.strikes,
        ticks: e.raw.ticks,
        quant: quantPrep ? { zeroGamma: quantPrep.zero } : null,

        expiries: e.raw.expiries,

        surface,
        chain: chainByTicker.get(ticker) || null,
        chainMissing: chainMiss.get(ticker) || null,

        scoreHistory: scoreTrack
          ? {
            sessions: scoreTrack.sessions,
            scores: (scoreTrack.names.find((n) => n && n.t === ticker) || {}).s,
            deadBand: scoreTrack.deadBand,

            premium: scoreTrackPremium ? scoreTrackPremium.get(ticker) : undefined,
          }
          : null,
        weights: first.weights || null,
        maxPain, congress, generatedAt, sessionDate,
        darkpool: darkpoolRth, oiDeltas: oiRaw, termStructure: termRaw, ivRank: rankCut.raw,

        marketCross,
        variation: variationOptions(variationRun),
      });
      card.readPx = readPxOf(e, screenerReadAt);
      if (!deepSet.has(ticker)) card.depth = "focus";
      markGate(card, e);
      attachVol(card, volLeg, ticker, { ivRank: rankCut.raw });
      if (card.panels.darkpool && darkpoolRth && darkpoolRth.session) card.panels.darkpool.session = darkpoolRth.session;

      const { body, dropped } = shedCardToCap(card);
      if (dropped.length) {
        console.warn(`  card ${ticker}: shed ${dropped.join(", ")} to fit the cap`);
      }

      if (body.length > CARD_SELF_CHECK_BYTES) {
        throw new Error(`card is ${(body.length / 1024).toFixed(0)}KB after shedding ` +
          `${dropped.length} panel(s), still over the ingest cap`);
      }
      let engineOut = { card, extra: null, split: false };
      let engineBlock = null;
      if (quantPrep) {
        try {
          const closes = Array.isArray(e.features.candles) ? e.features.candles.map((c) => c && c[4]) : e.features.closes;
          const law = QP.garchLaw({ garch, ticker, sessionDate, closes, rate: quantRate ? quantRate.r : undefined });
          const state = regimeState(card, {});
          const block = QP.engineBlock({
            ticker, sessionDate, spot: spotPx, atr: e.features.atr, card, prep: quantPrep, rate: quantRate,
            garch, law, event: earnings ? earnings.next : null, state, strikes: e.raw.strikes,
            crossSection: quantPass.crossSection.get(ticker) || null, coneThin: coneThinOf(volLeg, ticker),
          });
          engineOut = QP.attachEngine(card, block);
          engineBlock = block;
          const idea = QP.leadIdea(block);
          if (idea) ideaByTicker.set(ticker, idea);
          quantStats.built++;
          if (block && block.ideas.length) quantStats.withIdeas++;
          if (engineOut.split) quantStats.split++;
          quantStats.bytes.push(engineOut.bytes);
        } catch (error) {
          quantStats.failed++;
          console.warn(`  engine ${ticker}: ${error.message} — the card publishes without it`);
        }
      }
      if (engineOut.extra) await publish("card-x:" + ticker, engineOut.extra);
      await publish("card:" + ticker, engineOut.card);
      neuronTiers.set(ticker, cardTier(engineBlock ? { ...card, engine: engineBlock } : card));

      return {
        status: "built",
        gamma: card.panels && card.panels.gamma && card.panels.gamma.status === "ok"
          ? card.panels.gamma.bars
          : null,

        garch: card.panels && card.panels.context && card.panels.context.status === "ok"
          && card.panels.context.garch
          ? card.panels.context.garch
          : null,
      };
    } catch (error) {

      console.warn(`  card ${ticker}: ${error.message}`);
      return { status: "failed" };
    }
  }, {
    width: cardLane.width,

    stopEarly: () => Date.now() > deadline,
  });

  const cards = foldCardOutcomes(cardTickers, cardsRun);
  if (quantStats.built || quantStats.failed) {
    const big = quantStats.bytes.length ? Math.max(...quantStats.bytes) : 0;
    console.log(`  engine: ${quantStats.built} card(s) carry an engine block, ${quantStats.withIdeas} with ranked ideas, ` +
      `${quantStats.split} split to card-x for the ${QP.QUANT_PIPELINE_LINES.INGEST_CAP / 1024}KB ingest cap` +
      (quantStats.failed ? `, ${quantStats.failed} failed` : "") + `; largest card ${(big / 1024).toFixed(1)}KB`);
  }
  if (quantStats.built) {
    await stages.run("ideas", async () => {
      const ideasBody = ideasPayload(ideaByTicker, { sessionDate, generatedAt, built: quantStats.built });
      await publish("ideas", ideasBody);
      console.log(`  ideas: the engine's lead structure for ${ideaByTicker.size} of ${quantStats.built} engine card(s)`);
      const recorded = await archiveIdeas(ideasBody, sessionDate, publish);
      (recorded.state === "written" || recorded.state === "revision" ? console.log : console.warn)(recorded.line);
    }, (error) => {
      console.warn(`  ideas: ${error.message} — the boards draw no idea column this session`);
    });
  } else {
    stages.skip("ideas", "no card carries an engine block");
  }
  if (perNameCut.names) {
    console.log(`  per-name feeds: ${perNameCut.names} card(s) carried rows from outside ` +
      `${sessionDate} — ${perNameCut.darkpool} dark-pool print(s) not on the session and ` +
      `${perNameCut.ivRank} IV-rank row(s) dated after it were cut before the card was built`);
  }
  const { built: cardsBuilt, failed: cardsFailed, skipped: cardsSkipped,
    unenriched, deadlineSkipped, gammaProfiles } = cards;

  const midOf = (xs) => {
    if (!xs.length) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const fitTotal = cards.garchConverged + cards.garchUnconverged + cards.garchUnavailable;
  if (fitTotal > 0) {
    const nu = midOf(cards.garchNu);
    const lam = midOf(cards.garchLambda);
    const per = midOf(cards.garchPersistence);
    console.log(
      "  " + (DRY_RUN ? "[dry-run] " : "") +
      `garch: ${cards.garchConverged} of ${fitTotal} fit(s) converged` +
      (cards.garchUnconverged
        ? `, ${cards.garchUnconverged} ran and did not settle` : "") +
      (cards.garchUnavailable
        ? `, ${cards.garchUnavailable} had too short a history to fit` : "") +
      (nu === null ? "" : `; median tail shape nu ${nu.toFixed(2)}` +
        ` (lower is heavier-tailed; near 30 the tails are the normal's)`) +
      (lam === null ? "" : `, median skew lambda ${lam.toFixed(3)}` +
        ` (negative is a heavier left tail, which is where equities sit)`) +
      (per === null ? "" : `, median persistence ${per.toFixed(3)}`) +

      (cards.garchConverged === 0 && fitTotal > 0
        ? " — NOT ONE FIT SETTLED, which is a fact about the model on this" +
          " cross-section and not about any one name"
        : ""),
    );
  }
  console.log(
    `cards: ${cardsBuilt}/${onBoard.size} built` +
    (cardsFailed ? `, ${cardsFailed} failed` : "") +

    (unenriched ? `, ${unenriched} with no enrichment row to build from` : "") +
    (deadlineSkipped
      ? `, ${deadlineSkipped} skipped past the ${DEADLINE_MS / 60000}min deadline`
      : ""),
  );

  stages.step("cross-cards");
  let extraBuilt = 0, extraFailed = 0, extraSkipped = 0;
  {

    const extraTickers = crossSectionTickers;
    if (extraTickers.length) {
      const unfetched =
        "this name was measured in the run's cross-section but is not on today's board, " +
        "so the run did not spend the per-name vendor calls this panel needs — it was " +
        "never requested, rather than requested and refused, and reloading will not " +
        "produce it";
      const lane = poolWidth(2);
      console.log(`  cross-section cards: ${extraTickers.length} name(s) off the board, ` +
        `${lane.width} in flight — no vendor calls, the enrichment is already in hand`);
      const run = await runPooled(extraTickers, async (ticker) => {
        const e = byTicker.get(ticker);
        if (!e) return { status: "unenriched" };
        try {
          const card = buildCard({
            ticker,
            row: sessionRow(e.row, e.features),
            features: { ...e.features, ...(scoredByTicker.get(ticker) || {}) },
            strikes: e.raw.strikes,
            ticks: e.raw.ticks,
            expiries: e.raw.expiries,

            surface: null, chain: null, maxPain: null,

            congress: congressRows(ticker, congressState),
            darkpool: null, oiDeltas: null, termStructure: null, ivRank: null,
            scoreHistory: scoreTrack
              ? {
                sessions: scoreTrack.sessions,
                scores: (scoreTrack.names.find((n) => n && n.t === ticker) || {}).s,
                deadBand: scoreTrack.deadBand,
                premium: scoreTrackPremium ? scoreTrackPremium.get(ticker) : undefined,
              }
              : null,
            weights: first.weights || null,
            generatedAt, sessionDate,
            marketCross,
            unfetched,
            variation: variationOptions(variationRun),
          });
          card.readPx = readPxOf(e, screenerReadAt);
          markGate(card, e);
          attachVol(card, volLeg, ticker);
          const body = JSON.stringify(card);

          if (body.length > 100 * 1024) {
            throw new Error(`cross-section card is ${(body.length / 1024).toFixed(0)}KB, over the ingest cap`);
          }
          await publish("card:" + ticker, card);
          neuronTiers.set(ticker, cardTier(card));
          return { status: "built" };
        } catch (error) {
          console.warn(`  cross-section card ${ticker}: ${error.message}`);
          return { status: "failed" };
        }
      }, {
        width: lane.width,
        stopEarly: () => Date.now() > deadline,
      });
      for (let i = 0; i < extraTickers.length; i++) {
        const r = run.results[i];
        if (!r) extraSkipped++;
        else if (r.status === "built") extraBuilt++;
        else if (r.status === "failed") extraFailed++;
        else extraSkipped++;
      }
      console.log(
        `  cross-section cards: ${extraBuilt}/${extraTickers.length} built` +
        (extraFailed ? `, ${extraFailed} failed` : "") +
        (extraSkipped ? `, ${extraSkipped} skipped past the deadline` : "") +
        ` — ${cardsBuilt + extraBuilt} name(s) now carry a card for this session`);
    }
  }
  Object.assign(ctx, {
    deadline, cardTickers, neuronTiers, cardsBuilt, cardsFailed, cardsSkipped, deadlineSkipped, gammaProfiles,
    extraBuilt, extraFailed, extraSkipped,
  });
}
