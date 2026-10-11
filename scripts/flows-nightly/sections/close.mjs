import { num } from "../../../shared/flows-features.js";
import { neuronCoverage } from "../../../shared/flows-neuron-coverage.js";
import { NDX_100, NDX_AS_OF } from "../../../shared/flows-universe.js";
import { FOCUS_FUNDS } from "../../../shared/flows-focus.js";
import { INDEX_TICKERS } from "../../flows-legs/universe.mjs";
import { dryLiveTicks } from "../../flows-legs/live.mjs";
import { runHealthGate, republishRepair } from "../../flows-legs/health.mjs";
import { reportHealth } from "../../flows-legs/witness.mjs";
import { DRY_RUN } from "../flags.mjs";
import { healthRecord } from "../stages.mjs";
import { CALL_BUDGET, CALL_OVERRUN_MARGIN, RATE, callModel } from "../vendor-params.mjs";
import { delayFloorMs, delayMs, describeFloorVerdict, permits, stats } from "../vendor.mjs";
import {
  ARCHIVE_DATE_RE, LEDGER_LIST_KINDS, bindStages, edgeSnapshot, landedKeys, listStored, probeStored, publish,
  publishedStore, readStored,
} from "../store.mjs";
import { PIPELINE_CADENCE } from "../clock.mjs";
import { shapeNews } from "../rank.mjs";
import { dryRosterList, dryRosterProbe, dryRosterReader } from "../fixtures.mjs";
import {
  LEDGER_PROBE_RETRY_BUDGET_MS, ensureArchived, pickPriorRoster, plainRedispatchSaid, retireAndRoster,
} from "../archive.mjs";

export function describeGammaRange(profiles) {
  const decades = [];
  for (const bars of profiles || []) {
    const mags = (Array.isArray(bars) ? bars : [])
      .map((b) => Math.abs(num(b && b.g, NaN)))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (mags.length < 5) continue;
    decades.push(Math.log10(Math.max(...mags) / Math.min(...mags)));
  }
  if (!decades.length) {
    return { names: 0, median: null, p90: null,
      line: "gamma range: no name carried five non-zero strikes, so the axis " +
        "question is not measurable on this run." };
  }
  decades.sort((a, b) => a - b);
  const at = (p) => decades[Math.min(decades.length - 1, Math.floor(p * decades.length))];
  const median = at(0.5), p90 = at(0.9);
  const verdict = median >= 3.5
    ? "SYMLOG IS EARNED — a linear cap would collapse the wings, and the axis " +
      "note is describing the data rather than apologising for a choice."
    : "SYMLOG MAY NOT BE EARNED at this range: a declared cap with clip marks " +
      "would leave the wings readable and let bar length mean magnitude again. " +
      "Worth re-measuring before changing anything.";
  return {
    names: decades.length, median: Number(median.toFixed(2)), p90: Number(p90.toFixed(2)),
    line: `gamma range: per-name dealer gamma spans ${median.toFixed(2)} orders of ` +
      `magnitude at the median and ${p90.toFixed(2)} at the 90th, over ` +
      `${decades.length} name(s). The symlog axis justifies itself on "four or five". ` +
      verdict,
  };
}

export async function runClose(ctx) {
  const {
    stages, sessionDate, generatedAt, crossSectionTickers, onBoard, deepSet, dossierBuilt, focusDeep, screener,
    guaranteed, earlyRoster, deadline, gammaProfiles, prunePromise, scoresPayload, payloads, marketLegs, universe,
    neuronTiers, enriched, liquid, cardsBuilt, cardsFailed, cardsSkipped, extraBuilt, membership, ndxAge, ndx,
    focusCarded, byCard, coverageNotes, gate, intraday, screenerReadAt, screenerTruncated, dating, variationRun,
    deepTickers, vendor, extraFailed, deadlineSkipped, extraSkipped,
  } = ctx;
  let rosterSummary = null;
  let rosterThrew = false;
  const probeBudget = { spentMs: 0, budgetMs: LEDGER_PROBE_RETRY_BUDGET_MS };
  await stages.run("roster", async () => {
    rosterSummary = await retireAndRoster({
      sessionDate, generatedAt,
      depth: new Map([
        ...crossSectionTickers.map((t) => [t, "cross"]),
        ...[...onBoard.keys()].map((t) => [t, deepSet.has(t) ? "board" : "focus"]),
        ...dossierBuilt,
      ]),
      exempt: new Set([...INDEX_TICKERS, ...FOCUS_FUNDS, ...focusDeep]),
      candidates: [...new Set([...screener.map((r) => r && r.ticker).filter(Boolean), ...guaranteed, ...FOCUS_FUNDS,
        ...INDEX_TICKERS, ...NDX_100])],
      reader: DRY_RUN ? dryRosterReader(sessionDate)
        : (key) => readStored(key, { budget: probeBudget }),
      probeMany: DRY_RUN ? dryRosterProbe(sessionDate)
        : (keys) => probeStored(keys, { budget: probeBudget }),
      lister: DRY_RUN ? dryRosterList(sessionDate)
        : () => listStored(LEDGER_LIST_KINDS, { budget: probeBudget }),
      prior: DRY_RUN ? await dryRosterReader(sessionDate)("roster")
        : pickPriorRoster(await readStored("roster", { budget: probeBudget }), await earlyRoster,
          { log: (line) => console.warn(line) }),
      deadline,
    });
  }, (error) => {
    rosterThrew = true;
    console.warn(`  roster: ${error.message} — the retire step stopped before the roster was written; the stored ` +
      "roster stays at its older session, so the next run finds the gap and probes the store");
  });

  console.log("  " + (DRY_RUN ? "[dry-run] " : "") + describeGammaRange(gammaProfiles).line +
    (DRY_RUN
      ? " ON SYNTHETIC ROWS THIS SETTLES NOTHING: the fixture spans about 1.7" +
        " orders of magnitude, so it does not exhibit the problem symlog exists" +
        " to solve. Only a live run answers this."
      : ""));

  stages.step("archive-check");
  const pruned = await prunePromise;
  if (pruned === null) console.warn("  prune: the sweep did not complete this run");

  if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    const archive = await ensureArchived({
      [`scores:${sessionDate}`]: scoresPayload,
      [`board:long:${sessionDate}`]: payloads.long,
      [`board:short:${sessionDate}`]: payloads.short,
    }, { landed: landedKeys, write: publish });
    const lost = archive.filter((a) => a.state === "lost");
    const repaired = archive.filter((a) => a.state === "repaired");
    const held = archive.filter((a) => a.state === "held");
    if (repaired.length) {
      console.log(`  archive check: ${repaired.map((a) => a.key).join(", ")} was missing and ` +
        "has now been written from this run's payload");
    }
    if (held.length) {
      console.warn(`  archive check: ${held.map((a) => a.key).join(", ")} already held an ` +
        "earlier run's payload for this session, which the archive keeps");
    }
    if (lost.length) {
      console.warn(`  ARCHIVE LOST: ${lost.map((a) => `${a.key} (${a.detail})`).join("; ")} — ` +
        `the record has no copy of what this run published for ${sessionDate}. Dispatch the ` +
        "workflow with republish_session to rewrite scores, board:long and board:short " +
        "together; " + plainRedispatchSaid(archive) + ". The run finishes publishing and " +
        "then exits non-zero, so the loss turns the workflow red instead of scrolling past in " +
        "a green log.");
      console.warn(`  ${republishRepair(sessionDate)}`);
      process.exitCode = 1;
    } else if (!repaired.length && !held.length) {
      console.log(`  archive check: scores, board:long and board:short are all written for ${sessionDate}`);
    }
  }

  let neuronLedger = null;
  await stages.run("neuron-ledger", async () => {
    neuronLedger = neuronCoverage({ universe: marketLegs ? marketLegs.universe : null, eligible: universe.length, cards: neuronTiers,
      held: rosterSummary ? rosterSummary.heldKeys : {}, sessionDate });
    const L = neuronLedger;
    console.log(`  neuron coverage: ${L.universe} universe name(s) — priced ${L.priced}, stand-aside ${L.standAside}, family ${L.family}, screen ${L.screen}` +
      `, unpriceable ${L.unpriceable}, expired ${L.expired}, stale ${L.stale}, missing ${L.missing}; screen ideas: ${L.screenIdeas.family} family, ${L.screenIdeas.none} No position` +
      `; engine ${L.engine.built} of ${L.engine.expected} deep card(s)` + (L.absentInputs.length ? `; inputs absent from the payload: ${L.absentInputs.join(", ")}` : ""));
  }, (error) => {
    console.warn(`  neuron coverage: ${error.message} — the ledger is not published this run`);
  });

  let metaBody = null;
  try {
    metaBody = {
      generatedAt, sessionDate,
      universe: universe.length,
      enriched: enriched.length,
      liquid: liquid.length,
      cardsBuilt, cardsFailed, cardsSkipped,
      ...(neuronLedger ? { neuron: neuronLedger } : {}),

      crossSectionCards: extraBuilt,
      cardsTotal: cardsBuilt + extraBuilt,
      apiCalls: stats.calls,
      coverage: {
        membership: { source: membership.source, asOf: membership.asOf, members: membership.members.length,
          fallback: membership.fallback, constantAsOf: NDX_AS_OF, constantAgeDays: ndxAge.days },
        ndx10: { tickers: ndx.tickers, source: ndx.source },
        focusDeep: focusCarded.length,
        gatedCarded: [...byCard.values()].filter((e) => e.gate).length,
        dossiers: Object.fromEntries(["index", "fund"].map((d) => [d, [...dossierBuilt.values()].filter((v) => v === d).length])),
        retired: rosterSummary ? rosterSummary.retired : null,
        held: rosterSummary ? rosterSummary.held : null,
      },
      warnings: coverageNotes,

      schedule: {
        cadence: PIPELINE_CADENCE,
        gate: gate.mode,
        intraday: intraday ? intraday.allowed : false,
        screenerReadAt,
        screenerTruncatedBands: screenerTruncated,
        endDateHonoured: dating.endDateHonoured,
      },
      variation: {
        convention: variationRun.probe,
        kc: variationRun.kc,
        unit: variationRun.unit,
        vannaScale: variationRun.vannaScale,
        strikeBook: variationRun.strikeSign,
        next: variationRun.next,
        votes: false,
      },
    };
    publishedStore.meta = metaBody;
  } catch (error) {
    console.warn(`  meta: ${error.message}`);
  }

  await stages.run("brief", async () => {
    const { buildBrief, briefStoreFrom } = await import("../../../shared/flows-brief.js");
    const { buildFactIndex } = await import("../../../shared/flows-ask.js");
    const { assess, assessStoreFrom } = await import("../../../shared/flows-warnings.js");

    const index = buildFactIndex(publishedStore);

    const alarm = assess(assessStoreFrom(publishedStore));
    if (alarm.warnings.length) {
      console.log(`  warnings: ${alarm.warnings.length} raised from ${alarm.checked} checks that could run`);
      for (const w of alarm.warnings) console.log(`    [${w.severity}] ${w.say}`);
    } else {
      console.log(`  warnings: none, from ${alarm.checked} checks that could run`);
    }

    const BRIEF_BYTE_BUDGET = 120 * 1024;
    const { shedCardFacts, CARD_CORE_FACTS } = await import("../../../shared/flows-ask.js");
    const base = {
      generatedAt, sessionDate,
      ...buildBrief(briefStoreFrom(publishedStore)),
      silences: index.silences,
      warnings: alarm.warnings,
      warningsChecked: alarm.checked,

      warningsQuestions: alarm.questions,
    };
    const over = (facts) => JSON.stringify({ ...base, facts }).length - BRIEF_BYTE_BUDGET;
    const indexed = index.cardNames || [];
    const priority = [...focusCarded, ...deepTickers.filter((t) => !focusDeep.has(t))];
    const briefOrder = [...priority.filter((t) => indexed.includes(t)), ...indexed.filter((t) => !priority.includes(t))];
    const shed = shedCardFacts(index.facts, briefOrder, over, { lean: CARD_CORE_FACTS });
    const cardCount = shed.facts.filter((f) => typeof f.source === "string" && f.source.startsWith("card:")).length;
    console.log(`  brief: ${shed.facts.length} facts, ${cardCount} of them per-name over ` +
      `${shed.namesIndexed.indexed} of ${shed.namesIndexed.of} carded names` +
      (shed.leaned.length ? `; ${shed.leaned.length} lean (${CARD_CORE_FACTS.join(", ")} only, to stay under ` +
        `${BRIEF_BYTE_BUDGET} bytes: the weakest ${shed.leaned.join(", ")}; focus names are leaned last)` : "") +
      (shed.namesIndexed.shed ? ` (${shed.namesIndexed.shed} shed to stay under ${BRIEF_BYTE_BUDGET} bytes: ` +
        `the weakest board name(s) ${briefOrder.slice(briefOrder.length - shed.namesIndexed.shed).join(", ")}; ` +
        "focus names are kept first)" : ""));
    await publish("brief", { ...base, facts: shed.facts, namesIndexed: shed.namesIndexed });
  }, (error) => {
    console.warn(`  brief: ${error.message}`);
  });

  if (DRY_RUN) {
    stages.step("live-dry");
    console.log("live layer (dry run of the --live mode: two synthetic Tier 2 ticks; a real nightly never writes live:*)");
    await dryLiveTicks({ publish, store: publishedStore, shapeNews });
  }

  const elapsed = (Date.now() - stats.startedAt) / 1000;
  console.log(
    `\ndone in ${elapsed.toFixed(1)}s — ${stats.calls} API calls` +
    `, ${stats.retries} retries, ${stats.rateLimited} rate-limited` +
    `, achieved ${(stats.calls / Math.max(elapsed, 1)).toFixed(2)} req/s` +
    ` (final inter-call delay ${Math.round(delayMs)}ms` +

    `, learned floor ${Math.round(delayFloorMs)}ms` +
    (delayFloorMs > RATE.minDelayMs ? "" : ", never raised") + ")",
  );
  console.log("Record the achieved rate: the vendor documents no limit, so this is how the real one gets discovered.");

  {
    const shape = {
      enriched: enriched.length, deep: onBoard.size, cross: crossSectionTickers.length,
      dossiers: dossierBuilt.size, earnings: marketLegs && marketLegs.earnings ? marketLegs.earnings.size : 0,
    };
    const model = callModel(shape);
    console.log(`calls: modelled ${model.total} for this run's shape (${Object.entries(shape).map(([k, v]) => `${k} ${v}`).join(", ")}) — ` +
      Object.entries(model.legs).map(([k, v]) => `${k} ${Math.round(v)}`).join(", ") +
      `; nominal budget ${CALL_BUDGET}` + (DRY_RUN ? `; the dry-run fixtures answered ${vendor.calls.length} market, coverage and focus read(s)` : ""));
    const ceiling = Math.max(CALL_BUDGET, Math.ceil(model.total * (1 + CALL_OVERRUN_MARGIN)));
    if (stats.calls > ceiling) {
      const over = stats.calls - model.total;
      console.warn(
        `BUDGET: ${stats.calls} attempts against ${model.total} modelled for this run's shape — ` +
        `${over} over (${((over / model.total) * 100).toFixed(1)}%). ` +
        `${stats.rateLimited} of those attempts were 429 retries rather than distinct calls. ` +
        "The budget is what DEADLINE_MS was sized against; a run that exceeds it is " +
        "spending time the chain and card legs were promised.",
      );
    }
  }

  const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
  if (!stats.calls) {

    console.log(
      "wall clock: no vendor call was made, so queueing, wire time and backoff were not " +
      "measured this run — these are absent readings rather than zero ones, and nothing " +
      "about the floor can be concluded from them.");
  } else {
    console.log(
      `wall clock over ${secs(elapsed * 1000)} elapsed, summed per caller: ` +
      `queued ${secs(stats.permitWaitMs)}` +
      ` | wire ${secs(stats.networkMs)}` +
      ` | refused ${secs(stats.rateLimitWaitMs)}` +
      ` (the queue itself was pushed back ${secs(stats.rateLimitQueueMs)}, which is the ` +
      `run-seconds the refusals actually cost)` +
      ` | peak in flight ${permits.stats().peakInFlight}` +
      ` | per call: ${Math.round(stats.permitWaitMs / stats.calls)}ms queued, ` +
      `${Math.round(stats.networkMs / stats.calls)}ms wire`);
  }
  if (stats.networkMs > 0 && permits.stats().peakInFlight <= 1) {
    console.log(
      "  peak in flight was 1, so no round trip ever overlapped another: the vendor answers " +
      "faster than the floor issues permits. That is the expected shape at a high floor and it " +
      "means the saving here is the serial delay+network stacking, not concurrency.");
  }

  const verdict = describeFloorVerdict(stats);
  if (verdict) console.log("  " + verdict);

  stages.step("gate");
  const health = await runHealthGate({ sessionDate, read: readStored, dry: DRY_RUN, edge: edgeSnapshot,
    annotate: process.env.GITHUB_ACTIONS === "true",
    night: {
      cardsFailed: cardsFailed + extraFailed, deadlineSkipped: deadlineSkipped + extraSkipped,
      planned: byCard.size + dossierBuilt.size, rostered: rosterSummary ? rosterSummary.rostered : null,
      rosterWritten: rosterSummary ? rosterSummary.written : (rosterThrew ? false : undefined), enriched: enriched.length,
      neuron: neuronLedger,
    } });
  stages.finish();
  bindStages(null);
  if (health.failures.length) process.exitCode = 1;

  if (metaBody) {
    const outside = stages.outside();
    try {
      await publish("meta", {
        ...metaBody,
        stages: stages.records(),
        ...(outside.length ? { stagesOutside: outside.slice(0, 5) } : {}),
        health: healthRecord(health),
      });
    } catch (error) {
      console.warn(`  meta: ${error.message}`);
    }
  }
  await reportHealth({ failures: health.failures, applies: health.applies, dry: DRY_RUN, env: process.env });
}
