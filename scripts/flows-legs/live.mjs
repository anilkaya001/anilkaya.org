import {
  LIVE_KEYS, LIVE_BUDGET, SECTOR_TIDES, shapeBreadth, shapeStrips, appendStripSeries, shapeVol,
  indexRows, shapeMovers, shapeLiveTape, gexRotation, shapeGexSeries, mergeGex, mergeLiveAlerts, alertsPagePlan,
  oldestCreated, stripNames, rowsOf, failed, freshEnvelope, timeMs, isoSec, anyAnswered,
} from "../../shared/flows-live.js";
import { phaseAt, closeMinutes, PHASE_MINUTES, LIVE_CLOCK, easternInstant } from "../../shared/flows-freshness.js";
import { fakeLiveVendor, fakeBoards } from "./live-fake.mjs";

export const LIVE_READ_PACE_MS = LIVE_BUDGET.tier2PaceMs;

export const LIVE_WRITER = "flows-live";

export function liveWindow(at) {
  const p = phaseAt(at, null);
  if (!p) return { run: false, why: "no-clock", phase: null };
  if (!p.trading) return { run: false, why: "not-trading", phase: p };
  const closeMin = closeMinutes(p.day, null);
  if (p.minutes < PHASE_MINUTES.open) return { run: false, why: "before-open", phase: p };
  if (p.minutes > closeMin + LIVE_CLOCK.runAfterCloseMin) return { run: false, why: "after-close", phase: p };
  return { run: true, why: "session", phase: p };
}

const rowsOfBoard = (read) => {
  const payload = read && read.payload && typeof read.payload === "object" ? read.payload : null;
  return payload && Array.isArray(payload.rows) ? payload.rows : [];
};

const tickerOf = (r) => (r && typeof r.t === "string" ? r.t.trim().toUpperCase() : null);

export function boardPlan(boards) {
  const long = rowsOfBoard(boards.long);
  const short = rowsOfBoard(boards.short);
  const watch = rowsOfBoard(boards.watch);
  const names = stripNames({
    long: long.map(tickerOf), short: short.map(tickerOf), watch: watch.map(tickerOf),
  });
  const ranked = [...long, ...short]
    .map((r) => ({ t: tickerOf(r), mag: Math.abs(Number(r && r.s)) }))
    .filter((r) => r.t && Number.isFinite(r.mag))
    .sort((a, b) => b.mag - a.mag || (a.t < b.t ? -1 : 1))
    .map((r) => r.t);
  const stage = new Map();
  for (const r of long) if (tickerOf(r)) stage.set(tickerOf(r), "board:long");
  for (const r of short) if (tickerOf(r)) stage.set(tickerOf(r), "board:short");
  return { names, ranked, deep: ranked.slice(0, 50), stage, counts: { long: long.length, short: short.length,
    watch: watch.length } };
}

function firstRowKeys(raw) {
  const rows = rowsOf(raw);
  const inner = rows[0] && Array.isArray(rows[0].data) ? rows[0].data : rows;
  const first = inner.find((r) => r && typeof r === "object");
  return first ? Object.keys(first).slice(0, 24).join(", ") : null;
}

export async function runLive({
  uw, publish, readStored, now = () => Date.now(), log = console.log, warn = console.warn, shapeNews = null,
  origin = null, force = false, writer = LIVE_WRITER,
} = {}) {
  const startedAt = now();
  const window = liveWindow(startedAt);
  if (!force && !window.run) {
    log(`live: nothing to do (${window.why}) — the live layer reads only inside the regular session ` +
      `and ${LIVE_CLOCK.runAfterCloseMin} minutes after it`);
    return { skipped: window.why };
  }
  const session = window.phase.session || window.phase.day;
  const open = easternInstant(session, PHASE_MINUTES.open);

  const beat = await readStored("live:heartbeat");
  const lastBeat = beat && beat.payload && beat.payload.run ? timeMs(beat.payload.run.finishedAt) : NaN;
  if (!force && Number.isFinite(lastBeat) && startedAt - lastBeat < LIVE_BUDGET.tier2HeartbeatSkipMs) {
    log(`live: a run finished ${Math.round((startedAt - lastBeat) / 1000)} s ago — skipping (${origin || "manual"})`);
    return { skipped: "recent" };
  }

  const boards = {};
  for (const side of ["long", "short", "watch"]) boards[side] = await readStored("board:" + side);
  const plan = boardPlan(boards);
  const tick = Math.max(0, Math.floor((startedAt - open) / (15 * 60000)));
  const rotation = gexRotation({ ranked: plan.ranked, deep: plan.deep, tick });
  log(`live: session ${session}, ${plan.names.length} strip name(s) from boards ` +
    `${plan.counts.long}/${plan.counts.short}/${plan.counts.watch}, gex ${rotation.all.length} name(s) (tick ${tick})`);

  const ledger = { calls: 0, failed: 0 };
  const read = async (path, params = {}) => {
    ledger.calls++;
    try {
      return await uw(path, params, { envelope: true });
    } catch (error) {
      ledger.failed++;
      return { __failed: error && error.message ? String(error.message) : String(error) };
    }
  };

  const notes = [];
  const note = (line) => { notes.push(line.slice(0, 240)); log("  NOTE " + line); };
  const unshaped = (label, raw, status) => {
    if (status === "unreadable" && !failed(raw)) note(`${label} returned rows but shaped none — first-row keys: ${firstRowKeys(raw)}`);
  };

  const sectorRaws = {};
  const etfRaws = {};
  await Promise.all([
    ...SECTOR_TIDES.map(async ({ sector }) => {
      sectorRaws[sector] = await read(`/api/market/${encodeURIComponent(sector)}/sector-tide`);
    }),
    ...["IWM", "DIA"].map(async (t) => { etfRaws[t] = await read(`/api/market/${t}/etf-tide`); }),
  ]);
  const [zeroDte, weekly] = await Promise.all([
    read("/api/net-flow/expiry", { expiration: "zero_dte", moneyness: "all", tide_type: "all" }),
    read("/api/net-flow/expiry", { expiration: "weekly", moneyness: "all", tide_type: "all" }),
  ]);
  const strip = await read("/api/screener/stocks", { ticker: plan.names.join(","), limit: 500 });

  const prevAlerts = await readStored("live:alerts");
  const alertPlan = alertsPagePlan(prevAlerts && prevAlerts.payload, session);
  const pages = [];
  let olderThan = null;
  for (let i = 0; i < LIVE_BUDGET.alertPages; i++) {
    const params = { limit: LIVE_BUDGET.alertLimit, newer_than: alertPlan.newerThan };
    if (olderThan) params.older_than = olderThan;
    const body = await read("/api/option-trades/flow-alerts", params);
    const rows = rowsOf(body);
    pages.push({ body, full: rows.length >= LIVE_BUDGET.alertLimit });
    if (i === 0 && body && !failed(body)) {
      note(`flow-alerts cursor: sent newer_than=${alertPlan.newerThan}; vendor echoed newer_than=` +
        `${body.newer_than ?? "absent"} older_than=${body.older_than ?? "absent"}; ${rows.length} row(s)`);
    }
    if (rows.length < LIVE_BUDGET.alertLimit || failed(body)) break;
    olderThan = oldestCreated(rows);
    if (!olderThan) break;
  }

  const gexRaws = {};
  await Promise.all(rotation.all.map(async (t) => {
    gexRaws[t] = await read(`/api/stock/${encodeURIComponent(t)}/spot-exposures`);
  }));

  const [totals, netImpact, darkpool, newsRaw] = await Promise.all([
    read("/api/market/total-options-volume", { limit: 2 }),
    read("/api/market/top-net-impact", { limit: 20 }),
    read("/api/darkpool/recent", { date: session, order_by: "premium", limit: 200 }),
    read("/api/news/headlines", { limit: 100 }),
  ]);
  const at = now();

  const out = {};
  const bytes = {};
  const errors = [];
  const put = async (key, payload, { answered = true } = {}) => {
    if (!answered) {
      bytes[key] = null;
      note(`${key}: not published — no read behind it answered this run, so the held row keeps its own read time`);
      return;
    }
    const text = JSON.stringify(payload);
    const cap = LIVE_KEYS[key].maxBytes;
    if (text.length > cap) {
      errors.push(`${key}: ${text.length} bytes over its ${cap}-byte cap, not published`);
      warn(`  live ${key}: ${text.length} bytes is over its ${cap}-byte cap — not published`);
      bytes[key] = null;
      return;
    }
    try {
      await publish(key, payload);
      out[key] = payload;
      bytes[key] = text.length;
    } catch (error) {
      bytes[key] = null;
      errors.push(`${key}: ${error && error.message ? error.message.slice(0, 200) : String(error)}`);
      warn(`  live ${key}: publish failed — ${error && error.message ? error.message : error}`);
    }
  };

  const breadth = shapeBreadth({ sectors: sectorRaws, etf: etfRaws, zeroDte, weekly }, { at, session, writer });
  for (const [sector, s] of Object.entries(breadth.sectors.rows)) unshaped(`sector-tide ${sector}`, sectorRaws[sector], s.status);
  for (const [name, s] of Object.entries({ "net-flow zero_dte": breadth.dte.zero, "net-flow weekly": breadth.dte.weekly,
    "etf-tide IWM": breadth.etf.IWM, "etf-tide DIA": breadth.etf.DIA })) {
    if (s.check === "disagrees") note(`${name}: the variance-ratio check disagrees with the declared cumulative basis`);
  }
  const disagree = Object.entries(breadth.sectors.rows).filter(([, s]) => s.check === "disagrees").map(([k]) => k);
  if (disagree.length) note(`sector-tide basis check disagrees for ${disagree.join(", ")}`);
  await put("live:breadth", breadth, { answered: anyAnswered([...Object.values(breadth.sectors.rows), breadth.etf.IWM,
    breadth.etf.DIA, breadth.dte.zero, breadth.dte.weekly]) });

  const strips = shapeStrips(strip, { at, session, names: plan.names, writer });
  unshaped("screener strip", strip, strips.status);
  if (strips.status !== "unavailable") {
    const withQuote = rowsOf(strip).filter((r) => r && r.quote_time !== null && r.quote_time !== undefined).length;
    note(`screener strip: ${strips.returned ?? 0}/${plan.names.length} name(s), row date ${strips.rowDate || "absent"}, ` +
      `quote_time set on ${withQuote} row(s)`);
  }
  const stripAnswered = strips.status !== "unavailable";
  await put("live:strips", strips, { answered: stripAnswered });

  const prevSeries = await readStored("live:strips:series");
  const series = appendStripSeries(prevSeries && prevSeries.payload, strips, { at, session, writer });
  await put("live:strips:series", series, { answered: series.appended === true || series.replaced === true });
  await put("live:vol", shapeVol(indexRows(strip), { at, session, writer }), { answered: stripAnswered });
  await put("live:movers", shapeMovers(strips, { at, session, writer }), { answered: stripAnswered });

  const merged = mergeLiveAlerts(prevAlerts && prevAlerts.payload, pages, {
    at, session, writer, stageOf: (t) => plan.stage.get(t) || null,
  });
  if (merged.write) await put("live:alerts", merged.write);
  else log(`  live:alerts: NOT WRITTEN — ${merged.why}; ${merged.read} row(s) read, the held record stands`);

  const gexReads = {};
  for (const [t, raw] of Object.entries(gexRaws)) gexReads[t] = shapeGexSeries(raw, { session, now: at });
  const filled = Object.values(gexReads).filter((g) => g.status === "ok" && g.flowFilled).length;
  const okGex = Object.values(gexReads).filter((g) => g.status === "ok").length;
  if (okGex && !filled) note(`spot-exposures: ${okGex} name(s) shaped and none carried non-zero _vol/_dir legs`);
  const prevGex = await readStored("live:gex");
  await put("live:gex", mergeGex(prevGex && prevGex.payload, gexReads, { at, session, writer, rotation }),
    { answered: anyAnswered(Object.values(gexReads)) });

  const tape = shapeLiveTape({ totals, netImpact, darkpool }, { at, session, writer });
  await put("live:tape", tape, { answered: anyAnswered([tape.totals, tape.netImpact, tape.darkpool]) });

  if (typeof shapeNews === "function") {
    const news = failed(newsRaw)
      ? { status: "unavailable", reason: "vendor-failed", rows: [] }
      : shapeNews(newsRaw, { requested: 100 });
    await put("live:news", {
      v: 1, key: "live:news", session,
      fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:news"].cadenceS, session, writer }),
      ...news,
    }, { answered: !failed(newsRaw) });
  }

  const finishedAt = now();
  const run = {
    origin: origin || "manual", startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(), durationMs: finishedAt - startedAt,
    calls: ledger.calls, failedCalls: ledger.failed, keys: bytes, errors, notes: notes.slice(0, 20),
    names: plan.names.length, gex: rotation, alerts: { mode: merged.mode, read: merged.read, pages: pages.length },
  };
  await put("live:heartbeat", {
    v: 1, key: "live:heartbeat", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:heartbeat"].cadenceS, session, writer }),
    run,
  });
  log(`live: ${ledger.calls} call(s) (${ledger.failed} failed), ${Object.values(bytes).filter((b) => b !== null).length} ` +
    `key(s) published in ${((finishedAt - startedAt) / 1000).toFixed(1)} s`);
  return { run, published: Object.keys(out), bytes };
}

export async function dryLiveTicks({ publish, store, shapeNews, log = console.log, warn = console.warn,
  session = "2026-08-24", minutes = [11 * 60 + 7, 11 * 60 + 22] } = {}) {
  const boards = fakeBoards();
  const readStored = async (key) => {
    if (key.startsWith("board:")) return { payload: boards[key.slice(6)] || null };
    const payload = store[key];
    return payload ? { payload } : { payload: null, absent: true };
  };
  const results = [];
  for (const m of minutes) {
    const at = easternInstant(session, m);
    let clock = at;
    const now = () => (clock += 250);
    const uw = fakeLiveVendor({ now, session });
    log(`live (dry run): tick at ${isoSec(at)} (${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} ET)`);
    results.push(await runLive({ uw, publish, readStored, now, log, warn, shapeNews, origin: "dry-run", force: true }));
  }
  return results;
}

export async function readHeldAlerts(readStored, sessionDate) {
  const live = await readStored("live:alerts");
  const payload = live && live.payload && typeof live.payload === "object" ? live.payload : null;
  if (payload && payload.sessionDate === sessionDate && payload.record && payload.record.date === sessionDate) {
    return { ...live, heldFrom: "live:alerts" };
  }
  return readStored("flowalerts");
}
