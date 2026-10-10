import { HORIZON_SESSIONS } from "../../../shared/flows-features.js";
import { variation, variationSummary } from "../../../shared/flows-variation.js";
import { scoresRows } from "../../../shared/flows-scores.js";
import { SELECTION_EPOCH, UNIVERSE_NOTES } from "../../../shared/flows-universe.js";
import { DRY_RUN } from "../flags.mjs";
import { DEEP_RULE, EARNINGS_GATE_DAYS, deepNames } from "../vendor-params.mjs";
import { ARCHIVE_DATE_RE, pruneArchive, publish, readStored, retireSession } from "../store.mjs";
import {
  BOARD_SCHEMA_VERSION, boardVariationMeta, featuresVariationInput, sessionRow, toRows, toWatchRows, variationOptions,
} from "../rank.mjs";
import { fakePriorBoard } from "../fixtures.mjs";
import { collectDatedBoards, resolveBoardMemory } from "../archive.mjs";

export async function runBoards(ctx) {
  const {
    stages, sides, sessionDate, screenerByTicker, unique, gate, scored, gateOrigin, focusCarded, variationRun,
    generatedAt, universe, scorable, shareClasses, enriched, tiltByTicker,
  } = ctx;
  stages.step("boards");
  const previous = {};
  const boardMemory = {};
  for (const side of ["long", "short"]) {
    const live = DRY_RUN ? fakePriorBoard(side, sides[side], sessionDate) : null;
    boardMemory[side] = await resolveBoardMemory(side, sessionDate, DRY_RUN
      ? { reader: async (key) => (key === "board:" + side
        ? { payload: live, absent: !live, status: 0 }
        : { payload: null, absent: true, status: 0 }) }
      : {});
    previous[side] = boardMemory[side].rows;
  }

  const sessionRowByTicker = new Map(screenerByTicker);
  for (const e of unique) sessionRowByTicker.set(e.row.ticker, sessionRow(e.row, e.features));

  if (gate.mode === "republish") {
    const retired = await retireSession(sessionDate);
    console.log(`  republish: ${retired.removed.length} archive key(s) deleted` +
      (retired.removed.length ? ` (${retired.removed.join(", ")})` : "") +
      (retired.absent.length ? `, ${retired.absent.length} already absent` : ""));
    if (retired.refused.length) {
      throw new Error(
        `republish_session: the store refused to delete ${retired.refused.map((r) =>
          `${r.key} (HTTP ${r.status})`).join(", ")}` +
        (retired.kept.length ? ` and left ${retired.kept.join(", ")} standing` : "") +
        " — publishing nothing ranked, so the live boards cannot diverge from an archive " +
        "this run was unable to replace. scores is always deleted last, so the session still " +
        "reads as archived, or as partly archived, and a later plain run skips it; dispatch " +
        "with republish_session again to finish the rewrite");
    }
  }

  const published = {};
  const payloads = {};
  const first = scored[0] || {};
  for (const side of ["long", "short"]) {
    published[side] = toRows(sides[side], sessionRowByTicker, previous[side], gateOrigin);
  }

  for (const side of ["long", "short"]) {
    const rows = published[side];
    const memory = boardMemory[side];
    console.log(
      `  board:${side} memory: ${memory.status} — ` + (memory.incumbents
        ? `${rows.filter((r) => r.nw).length} new, ` +
          `${rows.filter((r) => r.hy).length} held on incumbency, of ${rows.length} ` +
          `(${memory.incumbents} incumbent${memory.incumbents === 1 ? "" : "s"} from ` +
          `${memory.sessionDate || "a board carrying no session date"})` +
          (memory.source === "archive" ? ` — read from ${memory.key}` : "")
        : memory.note));
  }

  const deepSet = new Set(deepNames(published).map((d) => d.t));
  const sideOfRow = new Map();
  for (const side of ["long", "short"]) for (const r of published[side] || []) if (r && r.t) sideOfRow.set(r.t, side);
  const deepTickers = [...deepSet, ...focusCarded.filter((t) => !deepSet.has(t))];
  const deepCarded = new Set(deepTickers);
  const uniqueByTicker = new Map(unique.map((e) => [e.features.ticker, e]));
  const boardVariation = (ticker) => {
    const e = uniqueByTicker.get(ticker);
    if (!e) return null;
    try {
      return variationSummary(variation(featuresVariationInput(e, sessionDate),
        variationOptions(variationRun)));
    } catch (error) {
      console.warn(`  variation ${ticker}: ${error.message}`);
      return null;
    }
  };
  for (const side of ["long", "short"]) {
    for (const row of published[side]) {
      if (deepCarded.has(row.t)) row.dp = 1;
      row.variation = boardVariation(row.t);

      row.skew = null;
      row.term = null;
      row.atmIv = null;
      row.skewDays = null;
    }
  }

  for (const side of ["long", "short"]) {
    const rows = published[side];
    payloads[side] = {
      v: BOARD_SCHEMA_VERSION,
      side, generatedAt, sessionDate, rows,

      gateOrigin,
      gateDays: EARNINGS_GATE_DAYS,

      memory: {
        status: boardMemory[side].status,
        sessionDate: boardMemory[side].sessionDate,
        named: boardMemory[side].named,
        incumbents: boardMemory[side].incumbents,
        source: boardMemory[side].source,
        note: boardMemory[side].note,
      },
      universe: universe.length,
      enriched: scorable.length,

      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,
      neutral: sides.neutral,

      cleared: sides[side].length,
      shed: sides[side].length - rows.length,

      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      scoreVariance: first.scoreVariance || null,
      variation: boardVariationMeta(variationRun),
      shareClasses,

      deep: rows.filter((r) => r.dp).length,
      deepRule: DEEP_RULE,
      selection: UNIVERSE_NOTES.rule,
      selectionEpoch: SELECTION_EPOCH,
      status: rows.length ? "ok" : "thin",
    };
    await publish("board:" + side, payloads[side]);
  }

  const archiveWalkPromise = collectDatedBoards(sessionDate, payloads, enriched,

    (sides.neutralRows || []).map((r) => ({ t: r.ticker, s: r.score })))
    .catch((error) => {
      console.warn(`  record archive: the walk failed — ${error.message}`);
      return null;
    });
  const prunePromise = pruneArchive(sessionDate).catch((error) => {
    console.warn(`  prune: ${error.message}`);
    return null;
  });
  const earlyRoster = DRY_RUN ? Promise.resolve(null)
    : readStored("roster", { budget: { spentMs: 0, budgetMs: 5_000 } }).catch(() => null);

  await stages.run("watch", async () => {
    const watchRows = toWatchRows(sides.neutralRows, sessionRowByTicker, tiltByTicker);
    await publish("board:watch", {
      v: BOARD_SCHEMA_VERSION,
      side: "watch", generatedAt, sessionDate,
      rows: watchRows,
      universe: universe.length,
      enriched: scorable.length,
      scored: scored.length,
      dispersion: Number.isFinite(first.dispersion) ? Number(first.dispersion.toFixed(4)) : null,
      deadBand: sides.deadBand,

      neutral: sides.neutral,
      horizonSessions: HORIZON_SESSIONS,
      weights: first.weights || null,
      status: watchRows.length ? "ok" : "thin",
    });
  }, (error) => {
    console.warn(`  watch: ${error.message}`);
  });

  let scoresPayload = null;
  if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
    await stages.run("scores", async () => {
      const scoreRows = scoresRows(sides);
      scoresPayload = {
        v: BOARD_SCHEMA_VERSION, generatedAt, sessionDate,
        deadBand: sides.deadBand,
        selectionEpoch: SELECTION_EPOCH,
        rows: scoreRows,
        status: scoreRows.length ? "ok" : "empty",
      };
      await publish(`scores:${sessionDate}`, scoresPayload);
      console.log(`  scores: ${scoreRows.length} name(s) archived for ${sessionDate}`);
    }, (error) => {
      console.warn(`  scores: ${error.message}`);
    });
  } else {
    console.warn(
      "  scores: no session date, so the pool cannot be archived under a dated key this run");
    stages.skip("scores", "no session date");
  }
  Object.assign(ctx, {
    published, payloads, first, deepSet, sideOfRow, deepTickers, boardVariation, archiveWalkPromise, prunePromise,
    earlyRoster, scoresPayload,
  });
}
