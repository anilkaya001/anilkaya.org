import { num } from "../../../shared/flows-features.js";
import { lines as planLines } from "../../../shared/flows-plan-facts.js";
import { priorLedger } from "../../../shared/flows-universe.js";
import {
  DEEPEN, capFromEnv, coverageNights, deepenMode, holdSet, ledgerPayload, planNight, settleNight,
} from "../../../shared/flows-deepen.js";
import { DRY_RUN } from "../flags.mjs";
import { DEADLINE_MS, EARNINGS_GATE_DAYS } from "../vendor-params.mjs";
import { poolWidth, raiseReadPace, runPooled, stats } from "../vendor.mjs";
import { landedKeys, publish, readStored } from "../store.mjs";
import {
  computeFeatures, daysToEarnings, enrich, screenerDollarVolume, screenerTilt, sessionCandles,
} from "../rank.mjs";
import { fakeEnrichment } from "../fixtures.mjs";

export const NONE = Object.freeze({
  mode: "off", names: [], added: new Set(), set: new Set(), carried: new Map(), keep: new Set(), failed: new Set(), plan: null, ledger: null,
});

export async function runDeepenPlan(ctx) {
  const {
    stages, universe, byCard, deepTickers, sessionDate, dating, gateOrigin, earlyRoster,
  } = ctx;
  ctx.deepen = NONE;
  const mode = deepenMode(process.env);
  const read = mode === "off" ? { payload: null } : await readStored(DEEPEN.key);
  const readable = !(read && read.failed);
  let rosterKnown = null;
  if (readable && !DRY_RUN) {
    const prior = await earlyRoster;
    if (prior && !prior.failed && prior.payload) rosterKnown = priorLedger(prior.payload, { sessionDate }).known;
  }
  const rows = (universe || []).filter((r) => r && typeof r.ticker === "string");
  const lines = planLines(process.env);
  const night = planNight({
    mode, cap: capFromEnv(process.env, DRY_RUN ? DEEPEN.dryRunCap : DEEPEN.perNightCap), payload: read ? read.payload : null, readable, sessionDate,
    rows: rows.map((r) => ({ t: r.ticker, w: screenerDollarVolume(r) ?? num(r.marketcap, 0) })),
    board: new Set(deepTickers), rosterKnown,
    dayLine: lines["uw.day"].cap, minuteLine: lines["uw.min"].cap,
    callsSoFar: stats.calls, elapsedMs: Date.now() - stats.startedAt, deadlineMs: DEADLINE_MS,
  });
  const { carried, gov, picked } = night;
  const ledgerBody = readable ? read.payload : null;
  if (!picked.picked.length) {
    const keep = holdSet({ carried, protectAll: night.protectAll, cross: [...byCard.keys()], board: new Set(deepTickers) });
    console.log(`  deepen: no rotation tonight — ${night.why}; ${carried.size} deep read(s) carried` +
      (night.protectAll ? `, and the ${keep.size - carried.size} card(s) of other carded names are left as they stand` : ""));
    stages.detail({ n: 0, carried: carried.size, never: 0 });
    ctx.deepen = {
      ...NONE, mode: night.protectAll ? "protect" : mode, carried, keep, ledger: ledgerBody,
      plan: night.protectAll || mode === "off" ? null : { n: 0, binding: gov.binding, why: night.why },
    };
    return;
  }
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  raiseReadPace(gov.pace.spacingMs);
  const need = picked.picked.filter((t) => !byCard.has(t));
  const lane = poolWidth(2);
  console.log(`  deepen: ${picked.picked.length} name(s) chosen (${picked.never} never read deep, ${picked.waiting} waiting out a failure, ` +
    `${carried.size} carried); ${picked.picked.length - need.length} already enriched, ${need.length} to enrich, ` +
    `${lane.width} in flight — ${gov.why}; pace ${gov.pace.spacingMs}ms (${gov.pace.perMinute}/min)`);
  const built = new Map();
  const enrichFailed = new Set();
  await runPooled(need, async (ticker, i) => {
    const row = byTicker.get(ticker);
    const spot = num(row.close);
    const tilt = screenerTilt(row);
    try {
      let raw;
      if (DRY_RUN) {
        const fake = fakeEnrichment(ticker, spot, 5000 + i, tilt ? tilt.iv30 : null);
        raw = { ...fake, ohlc: sessionCandles(fake.ohlc, sessionDate) };
      } else {
        raw = (await enrich(ticker, spot, sessionDate, dating)).raw;
      }
      const features = computeFeatures({ ...raw, ticker, spot, sessionDate, tilt });
      const dte = daysToEarnings(row, gateOrigin);
      const gate = dte === null || dte < 0 || dte > EARNINGS_GATE_DAYS ? null
        : { earnings: String(row.next_earnings_date).slice(0, 10), dte };
      built.set(ticker, { features, raw, tilt, row, gate });
    } catch (error) {
      enrichFailed.add(ticker);
      console.warn(`  deepen ${ticker}: enrichment failed — ${error.message}`);
    }
  }, { width: lane.width });
  const names = [];
  const added = new Set();
  for (const t of picked.picked) {
    if (byCard.has(t)) { names.push(t); continue; }
    const e = built.get(t);
    if (!e) { enrichFailed.add(t); continue; }
    byCard.set(t, e);
    added.add(t);
    names.push(t);
  }
  const left = picked.neverLeft + enrichFailed.size;
  const nights = coverageNights({ backlog: left, perNight: gov.n });
  console.log(`  deepen: ${names.length} name(s) join tonight's deep build` +
    (enrichFailed.size ? `, ${enrichFailed.size} not enriched (${[...enrichFailed].slice(0, 8).join(", ")})` : "") +
    `; ${left} never read deep yet` + (nights ? `, about ${nights} more night(s) at this size` : ""));
  stages.detail({ n: names.length, carried: carried.size, never: picked.never, failed: enrichFailed.size });
  ctx.deepen = {
    mode, names, added, set: new Set(names), carried, keep: holdSet({ carried, chosen: new Set(names), board: new Set(deepTickers) }), failed: enrichFailed, ledger: ledgerBody,
    plan: { n: names.length, binding: gov.binding, limits: gov.limits, never: picked.never, waiting: picked.waiting, nights, left },
  };
}

export async function runDeepenLedger(ctx) {
  const { sessionDate, generatedAt, deepen, onBoard, universe } = ctx;
  if (!deepen || !deepen.plan) {
    console.log("  deepen ledger: not written (" + (deepen && deepen.mode === "protect"
      ? "the ledger could not be read, so it is left as it stands" : "the rotation did not run") + ")");
    return;
  }
  const deepNow = new Set([...onBoard.keys()].filter((t) => !deepen.set.has(t) && landedKeys.has("card:" + t)));
  const settled = settleNight({
    chosen: deepen.names, enrichFailed: deepen.failed,
    cardLanded: (t) => landedKeys.has("card:" + t), cardXLanded: (t) => landedKeys.has("card-x:" + t),
  });
  const landed = new Set([...deepNow, ...settled.landed]);
  const built = ledgerPayload(deepen.ledger, {
    sessionDate, generatedAt, landed, failed: settled.failed,
    universe: new Set((universe || []).map((r) => r && r.ticker).filter(Boolean)),
    plan: { n: deepen.plan.n, binding: deepen.plan.binding, never: deepen.plan.never ?? 0 },
  });
  if (!built.fits) {
    console.warn(`  deepen ledger: ${built.bytes} bytes, over its ${DEEPEN.ledgerBudgetBytes} cap — not written`);
    return;
  }
  await publish(DEEPEN.key, built.payload);
  console.log(`  deepen ledger: ${built.payload.names} name(s) with a deep read on record, ${landed.size} deep tonight` +
    (settled.failed.size ? `, ${settled.failed.size} to retry` : ""));
}
