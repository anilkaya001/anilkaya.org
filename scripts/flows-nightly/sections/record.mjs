import { percentileRank, pearson, HORIZON_SESSIONS } from "../../../shared/flows-features.js";
import { scoreSessions, icTable, RECORD_NOTES } from "../../../shared/flows-record.js";
import { scoresRows, buildScoreTrack, boardsToScoreRows } from "../../../shared/flows-scores.js";
import { evaluateConviction, CONVICTION_LABELS } from "../../../shared/flows-conviction.js";
import { SELECTION_EPOCH } from "../../../shared/flows-universe.js";
import { DRY_RUN } from "../flags.mjs";
import { DEADLINE_MS } from "../vendor-params.mjs";
import { stats, uw } from "../vendor.mjs";
import { ARCHIVE_DATE_RE, publish } from "../store.mjs";
import {
  BOARD_SCHEMA_VERSION, SECTOR_ETFS, TRIX_FULL_SCALE_BP, TRIX_SERIES, TRIX_SPAN, TRIX_WARMUP, sectorTrix,
  sessionCandles,
} from "../rank.mjs";
import { fakeSectorCandles } from "../fixtures.mjs";
import { buildRecordBreaks, buildRecordCloses, recordCalendar } from "../archive.mjs";

const RECORD_HORIZONS = [1, 5, 10, 21];

const RECORD_IC_MIN_N = 20;

const RECORD_MAX_SESSIONS = 30;

export async function runRecord(ctx) {
  const { stages, archiveWalkPromise, enriched, sessionDate, generatedAt, sides, dating } = ctx;
  let archiveWalk = null;
  await stages.run("record", async () => {
    archiveWalk = await archiveWalkPromise;
    if (!archiveWalk) throw new Error("the dated-archive walk returned nothing to score");
    const { boards: datedBoards, probed: archiveProbed, failed: archiveFailed = 0,
      absent: archiveAbsent = 0, recovered: archiveRecovered = 0,
      statuses: archiveStatuses = [], abandoned: archiveAbandoned = false } = archiveWalk;
    const recordCloses = buildRecordCloses(enriched, datedBoards, sessionDate);
    const recordBreaks = buildRecordBreaks(enriched);
    const calendar = recordCalendar(enriched, datedBoards, sessionDate);
    const closeSources = recordCloses.sources || { boardPx: 0, boardPxRefused: 0 };
    console.log(`  record closes: ${recordCloses.size} name(s) from candles cut at ` +
      `${sessionDate}; ${closeSources.boardPx} archived board price(s) used as closes, ` +
      `${closeSources.boardPxRefused} refused because their archive was not written ` +
      "between that session's close and the next open");
    const rec = scoreSessions(datedBoards, recordCloses, calendar, {
      horizons: RECORD_HORIZONS,
      statedK: HORIZON_SESSIONS,
      maxSessions: RECORD_MAX_SESSIONS,

      epoch: SELECTION_EPOCH,
      breaks: recordBreaks,
    });
    const features = icTable(datedBoards, recordCloses, calendar, {
      k: HORIZON_SESSIONS, minN: RECORD_IC_MIN_N, pearson, percentileRank,
      breaks: recordBreaks,
      through: sessionDate,
      hrSessions: HORIZON_SESSIONS,
    });
    let conviction;
    try {
      conviction = evaluateConviction(datedBoards, recordCloses, calendar, {
        epoch: SELECTION_EPOCH, breaks: recordBreaks, through: sessionDate,
      });
    } catch (error) {
      console.warn(`  conviction: ${error.message} — the record publishes without a verdict`);
      conviction = {
        v: 1, status: "unavailable", verdict: "pending", label: CONVICTION_LABELS.pending, addBreadth: false,
        reason: "the evaluation failed on this run", horizons: [],
      };
    }
    await publish("record", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,
      status: "ok",
      statedHorizon: HORIZON_SESSIONS,
      conviction,
      archiveProbed,

      archiveFailed, archiveAbsent, archiveRecovered,
      archiveStatuses, archiveAbandoned,
      attrition: RECORD_NOTES.attrition,
      epochNote: RECORD_NOTES.epoch,
      closeBasis: {
        candlesThrough: sessionDate,
        boardPx: closeSources.boardPx,
        boardPxRefused: closeSources.boardPxRefused,
        rule: "Forward returns are scored from daily closes cut at this session, never " +
          "from a bar still trading. An archived board's price is used as a close only " +
          "when that archive was written between its session's close and the next " +
          "open; a price read while a later session traded is refused, and a name " +
          "with no other close for that date is counted lost rather than scored on it.",
      },
      ...rec,
      features: {
        k: features.k,
        minN: features.minN,
        sessionMinN: features.sessionMinN,
        rankedFrom: features.rankedFrom,
        ranked: features.ranked,
        through: features.through || null,
        method: RECORD_NOTES.method,
        perSession: RECORD_NOTES.perSession,
        ranking: RECORD_NOTES.ranking,
        selection: RECORD_NOTES.selection,
        overlap: RECORD_NOTES.overlap,
        calendar: RECORD_NOTES.calendar,
        cols: features.cols,
      },
    });
    {
      const stated = (conviction.horizons || []).find((h) => h.k === conviction.horizon);
      console.log(`  conviction: ${conviction.verdict} (${conviction.label})` +
        (stated ? `, ${stated.rows} rows over ${stated.sessions} session(s) at k=${stated.k}` +
          (stated.slope ? `, slope ${stated.slope.b} (${stated.slope.lo} to ${stated.slope.hi})` : "") : "") +
        (conviction.reason ? `; ${conviction.reason}` : ""));
    }
    const measuredCols = features.cols.filter((c) => c.ic !== null).length;
    const sessionCols = features.cols.filter((c) => c.icMean !== null);
    console.log(
      `  record: ${rec.retained} retained session(s) of ${archiveProbed} dated key(s) probed` +
      (archiveFailed ? ` (${archiveFailed} READ FAILED, so "retained" is a floor` +
        `${archiveAbandoned ? " and the walk was abandoned" : ""})` : "") + ", " +
      `${rec.sessions.length} scored at k=${HORIZON_SESSIONS}; ` +
      `features ${measuredCols}/${features.cols.length} measured pooled, ` +
      `${sessionCols.length} per session over ` +
      `${sessionCols.length ? Math.max(...sessionCols.map((c) => c.icSessions)) : 0} session(s), ` +
      `${features.ranked} ranked (a rank needs ${features.rankedFrom} sessions)` +
      (features.unscaled ? `; ${features.unscaled} row(s) had no entry volatility to scale by` : ""));

    if (rec.horizons && rec.horizons.length) {
      const leg = (ls, n) => ls === null || !n
        ? null : `${(ls * 10000).toFixed(1)}bp over ${n}`;
      console.log("  record horizons: " + rec.horizons.map((h) => {
        const cur = leg(h.ls, h.n), prior = leg(h.prior, h.priorN);
        if (!cur && !prior) return `k=${h.k} unmeasured`;
        return `k=${h.k} ` + [cur && `current ${cur}`, prior && `prior-rule ${prior}`]
          .filter(Boolean).join(", ");
      }).join("; "));
    }
  }, (error) => {
    console.warn(`  record: ${error.message}`);
  });

  let scoreTrack = null;

  let scoreTrackPremium = null;

  await stages.run("scoretrack", async () => {
    const walked = archiveWalk || { boards: [], scoreDays: [] };
    const dayMap = new Map();
    for (const sd of walked.scoreDays || []) {
      dayMap.set(sd.d, { d: sd.d, rows: sd.rows, source: "scores" });
    }
    const boardsByDate = new Map();
    for (const b of walked.boards || []) {
      if (!boardsByDate.has(b.d)) boardsByDate.set(b.d, []);
      boardsByDate.get(b.d).push(b.rows);
    }
    for (const [d, lists] of boardsByDate) {
      if (!dayMap.has(d)) dayMap.set(d, { d, rows: boardsToScoreRows(lists), source: "boards" });
    }
    if (ARCHIVE_DATE_RE.test(String(sessionDate || ""))) {
      dayMap.set(sessionDate, { d: sessionDate, rows: scoresRows(sides), source: "scores" });
    }

    const { premium: premiumByName, ...track } = buildScoreTrack([...dayMap.values()], {
      deadBand: sides.deadBand,
      epoch: SELECTION_EPOCH,
    });
    await publish("scoretrack", {
      v: BOARD_SCHEMA_VERSION,
      generatedAt, sessionDate,

      archive: {
        probed: walked.probed || 0,
        failed: walked.failed || 0,
        abandoned: !!walked.abandoned,
      },
      ...track,
    });
    console.log(
      `  scoretrack: ${track.names.length} name(s) over ${track.sessions.length} session(s) ` +
      `(${track.sources.full} full, ${track.sources.boardsOnly} board-only)` +
      (track.namesShed ? `; ${track.namesShed} name(s) shed for the size cap` : ""));

    scoreTrack = track;
    scoreTrackPremium = premiumByName;
  }, (error) => {
    console.warn(`  scoretrack: ${error.message}`);
  });

  if (Date.now() > stats.startedAt + DEADLINE_MS) {
    console.warn(
      `  sector:trix: past the ${DEADLINE_MS / 60000}min deadline — not spending ` +
      `${SECTOR_ETFS.length} calls on a surface that would land after the cards were abandoned`);
    stages.skip("sector-trix", "past the deadline");
  } else {
    await stages.run("sector-trix", async () => {

      const candlesByEtf = new Map();
      for (const { etf } of SECTOR_ETFS) {
        const candles = DRY_RUN
          ? fakeSectorCandles(etf)
          : await uw(`/api/stock/${etf}/ohlc/1d`, {

            timeframe: "1Y",
            ...(sessionDate && dating.endDate ? { end_date: sessionDate } : {}),
          }).catch(() => []);
        candlesByEtf.set(etf, sessionCandles(candles, sessionDate));
      }

      const sectors = sectorTrix(candlesByEtf);
      const measured = sectors.filter((s) => s.trix !== null).length;
      await publish("sector:trix", {
        v: BOARD_SCHEMA_VERSION,
        generatedAt, sessionDate,

        span: TRIX_SPAN,
        price: "log",
        seriesSessions: TRIX_SERIES,
        warmupSessions: TRIX_WARMUP,
        scaling: {
          rule: "fixed-clamp",
          choice: true,
          neutral: 50,
          fullScaleBp: TRIX_FULL_SCALE_BP,
          relation: "trix = 50 + 50 * clamp(trixBp / fullScaleBp, -1, +1)",
          rejected: "cross-sectional min-max (one 0 and one 100 every day, so a " +
            "flat market renders as a violent rotation) and own-history percentile " +
            "(rescales each sector by its own volatility, so the eleven bars stop " +
            "sharing an axis)",
        },

        basis: "SPDR Select Sector ETFs, not GICS index levels",
        sectors,
        measured,
        status: measured ? "ok" : "unavailable",
      });
      console.log(`  sector:trix: ${measured}/${SECTOR_ETFS.length} sectors measured`);
      for (const s of sectors) {
        if (s.reason) console.warn(`    ${s.sector} (${s.etf}): not measured — ${s.reason}`);
      }
    }, (error) => {
      console.warn(`  sector:trix: ${error.message}`);
    });
  }
  Object.assign(ctx, { scoreTrack, scoreTrackPremium });
}
