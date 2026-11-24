import {
  LIVE_KEYS, LIVE_BUDGET, SECTOR_TIDES, shapeBreadth, shapeStrips, appendStripSeries, shapeVol,
  indexRows, shapeMovers, mergeLiveAlerts, shapeAlertsHead, alertsPagePlan,
  oldestCreated, stripNames, rowsOf, failed, freshEnvelope, timeMs, isoSec, anyAnswered, BREADTH_ETFS, VERDICT,
  nightlySources, priorCloseBase, capUniverse, capChunks, shapeCapTide,
} from "./flows-live.js";
import { FOCUS_STRIP_FALLBACK, focusStripNames as focusNamesOf } from "./flows-focus.js";
import { phaseAt, closeMinutes, inferredEarlyClose, PHASE_MINUTES, LIVE_CLOCK } from "./flows-freshness.js";
import { pathFor } from "./flows-vendor-ops.js";
import { fixedHalfUp } from "./flows-display-round.js";
import { NEWS_VENDOR_LIMIT } from "./flows-news.js";
import { fundsNote } from "./flows-floor-funds-live.js";

export const LIVE_READ_PACE_MS = LIVE_BUDGET.tier2PaceMs;

export const LIVE_WRITER = "flows-live";

export function liveWindow(at, clock = null) {
  const p = phaseAt(at, clock);
  if (clock && clock.liveOwner === "worker") return { run: false, why: "worker-owner", phase: p };
  if (!p) return { run: false, why: "no-clock", phase: null };
  if (!p.trading) {
    const reopenable = !!clock && clock.day === p.day && clock.trading === 0 && p.minutes < VERDICT.unscheduledUntilMin &&
      phaseAt(at, null).trading;
    return reopenable ? { run: false, wait: true, why: "provisional-closed", phase: p }
      : { run: false, why: "not-trading", phase: p };
  }
  const closeMin = closeMinutes(p.day, clock);
  if (p.minutes < PHASE_MINUTES.open) return { run: false, why: "before-open", phase: p };
  if (p.minutes > closeMin + LIVE_CLOCK.runAfterCloseMin) {
    return inferredEarlyClose(p.day, clock) && p.minutes <= PHASE_MINUTES.close + LIVE_CLOCK.runAfterCloseMin
      ? { run: false, wait: true, why: "provisional-early-close", phase: p }
      : { run: false, why: "after-close", phase: p };
  }
  return { run: true, why: "session", phase: p };
}

const rowsOfBoard = (read) => {
  const payload = read && read.payload && typeof read.payload === "object" ? read.payload : null;
  return payload && Array.isArray(payload.rows) ? payload.rows : [];
};

const tickerOf = (r) => (r && typeof r.t === "string" ? r.t.trim().toUpperCase() : null);

export const FOCUS_FALLBACK = FOCUS_STRIP_FALLBACK;

export function focusStripNames(payload, { max = LIVE_BUDGET.stripFocusMax } = {}) {
  return focusNamesOf(payload, max);
}

export function boardPlan(boards, focusRead = null) {
  const long = rowsOfBoard(boards.long);
  const short = rowsOfBoard(boards.short);
  const watch = rowsOfBoard(boards.watch);
  const focus = focusStripNames(focusRead && focusRead.payload && typeof focusRead.payload === "object"
    ? focusRead.payload : null);
  const names = stripNames({
    long: long.map(tickerOf), short: short.map(tickerOf), watch: watch.map(tickerOf), focus: focus.names,
  });
  const ranked = [...long, ...short]
    .map((r) => ({ t: tickerOf(r), mag: Math.abs(Number(r && r.s)) }))
    .filter((r) => r.t && Number.isFinite(r.mag))
    .sort((a, b) => b.mag - a.mag || (a.t < b.t ? -1 : 1))
    .map((r) => r.t);
  const stage = new Map();
  for (const r of long) if (tickerOf(r)) stage.set(tickerOf(r), "board:long");
  for (const r of short) if (tickerOf(r)) stage.set(tickerOf(r), "board:short");
  return { names, ranked, deep: ranked.slice(0, 50), stage, focus, counts: { long: long.length, short: short.length,
    watch: watch.length, focus: focus.names.length } };
}

export function universeReader(readStored) {
  let held = null;
  return async () => {
    if (held) return held;
    let read = null;
    try {
      read = await readStored("universe");
    } catch {
      read = null;
    }
    const list = capUniverse(read && read.payload);
    const why = list.names.length ? null
      : !read || read.failed ? "the stored universe could not be read" + (read && read.status ? ` (HTTP ${read.status})` : "")
        : read.absent || !read.payload ? "no universe is stored yet" : "the stored universe lists no name";
    const out = { ...list, why };
    if (list.names.length) held = out;
    return out;
  };
}

function firstRowKeys(raw) {
  const rows = rowsOf(raw);
  const inner = rows[0] && Array.isArray(rows[0].data) ? rows[0].data : rows;
  const first = inner.find((r) => r && typeof r === "object");
  return first ? Object.keys(first).slice(0, 24).join(", ") : null;
}

export async function runLive({
  uw, publish, readStored, now = () => Date.now(), log = console.log, warn = console.warn, shapeNews = null,
  origin = null, force = false, writer = LIVE_WRITER, skipRecent = true, clock = null, universe = null,
} = {}) {
  const startedAt = now();
  const window = liveWindow(startedAt, clock);
  if (!force && !window.run) {
    log(`live: nothing to do (${window.why}) — the live layer reads only inside the regular session ` +
      `and ${LIVE_CLOCK.runAfterCloseMin} minutes after it`);
    return { skipped: window.why };
  }
  const session = window.phase.session || window.phase.day;

  const beat = await readStored("live:heartbeat");
  const lastBeat = beat && beat.payload && beat.payload.run ? timeMs(beat.payload.run.finishedAt) : NaN;
  if (!force && skipRecent && Number.isFinite(lastBeat) && startedAt - lastBeat < LIVE_BUDGET.tier2HeartbeatSkipMs) {
    log(`live: a run finished ${Math.round((startedAt - lastBeat) / 1000)} s ago — skipping (${origin || "manual"})`);
    return { skipped: "recent" };
  }

  const boards = {};
  for (const side of ["long", "short", "watch"]) boards[side] = await readStored("board:" + side);
  const focusRead = await readStored("focus");
  const plan = boardPlan(boards, focusRead);
  const priorBase = priorCloseBase(nightlySources({
    boards: Object.fromEntries(Object.entries(boards).map(([side, read]) => [side, read && read.payload])),
    focus: focusRead && focusRead.payload,
  }), session, clock);
  const held = typeof universe === "function" ? await universe() : universe;
  const capList = held && Array.isArray(held.names) ? held : { names: [], asked: [], caps: {}, why: "no universe list was handed to the pass" };
  const capAsk = capChunks(Array.isArray(capList.asked) ? capList.asked : capList.names);
  log(`live: session ${session}, ${plan.names.length} strip name(s): ${plan.counts.focus} focus (${plan.focus.source}), ` +
    `boards ${plan.counts.long}/${plan.counts.short}/${plan.counts.watch}; cap tide over ${capList.names.length} universe name(s) ` +
    `in ${capAsk.length} screener call(s)`);

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
      sectorRaws[sector] = await read(pathFor("sector-tide", { sector }));
    }),
    ...BREADTH_ETFS.map(async (t) => { etfRaws[t] = await read(pathFor("etf-tide", { ticker: t })); }),
  ]);
  const [zeroDte, weekly] = await Promise.all([
    read(pathFor("net-flow-expiry"), { expiration: "zero_dte", moneyness: "all", tide_type: "all" }),
    read(pathFor("net-flow-expiry"), { expiration: "weekly", moneyness: "all", tide_type: "all" }),
  ]);
  const capRaws = new Array(capAsk.length).fill(null);
  await Promise.all(capAsk.map(async (chunk, i) => {
    capRaws[i] = await read(pathFor("screener-stocks"), { ticker: chunk.join(","), limit: 500 });
  }));
  const breadthAt = now();
  const strip = await read(pathFor("screener-stocks"), { ticker: plan.names.join(","), limit: 500 });
  const stripAt = now();

  const prevAlerts = await readStored("live:alerts");
  const alertPlan = alertsPagePlan(prevAlerts && prevAlerts.payload, session);
  const pages = [];
  let olderThan = null;
  for (let i = 0; i < LIVE_BUDGET.alertPages; i++) {
    const params = { limit: LIVE_BUDGET.alertLimit, newer_than: alertPlan.newerThan };
    if (olderThan) params.older_than = olderThan;
    const body = await read(pathFor("flow-alerts"), params);
    const rows = rowsOf(body);
    pages.push({ body, full: rows.length >= LIVE_BUDGET.alertLimit });
    if (i === 0 && body && !failed(body)) {
      note(`flow-alerts cursor: sent newer_than=${alertPlan.newerThan}; feed echoed newer_than=` +
        `${body.newer_than ?? "absent"} older_than=${body.older_than ?? "absent"}; ${rows.length} row(s)`);
    }
    if (rows.length < LIVE_BUDGET.alertLimit || failed(body)) break;
    olderThan = oldestCreated(rows);
    if (!olderThan) break;
  }

  const alertsAt = now();

  const newsRaw = await read(pathFor("news"), { limit: NEWS_VENDOR_LIMIT });
  const newsAt = now();
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
    const size = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const cap = LIVE_KEYS[key].maxBytes;
    if (size > cap) {
      errors.push(`${key}: ${size} bytes over its ${cap}-byte cap, not published`);
      warn(`  live ${key}: ${size} bytes is over its ${cap}-byte cap — not published`);
      bytes[key] = null;
      return;
    }
    try {
      await publish(key, payload);
      out[key] = payload;
      bytes[key] = size;
    } catch (error) {
      bytes[key] = null;
      errors.push(`${key}: ${error && error.message ? error.message.slice(0, 200) : String(error)}`);
      warn(`  live ${key}: publish failed — ${error && error.message ? error.message : error}`);
    }
  };

  const capRead = shapeCapTide(capRaws, { at: breadthAt, session, universe: capList });
  const breadth = shapeBreadth({ sectors: sectorRaws, etf: etfRaws, zeroDte, weekly }, { at: breadthAt, session, writer,
    cap: capRead.cap });
  {
    const c = capRead.cap;
    const x = capRead.excluded;
    const asked = capAsk.reduce((n, chunk) => n + chunk.length, 0);
    note(!capList.names.length ? `cap tide: not read — ${capList.why || "no universe list"}`
      : `cap tide: ${c.value === null ? "withheld (" + c.reason + ")" : c.value} over ${c.n} of ${c.of} name(s), coverage ` +
        `${c.coverage === null ? "unknown" : fixedHalfUp(c.coverage, 1, 2) + "%"}; ${capRead.returned} of ${asked} asked name(s) ` +
        `returned in ${capRead.calls} call(s), ${capRead.failed} failed` +
        (asked < capList.names.length ? `; ${capList.names.length - asked} name(s) past the call cap were not asked` : "") +
        (capRead.off ? `; ${capRead.off} row(s) dated before the session held out` : "") +
        (x ? `; no cap ${x.noCap}, missing ${x.missing}, inconsistent ${x.inconsistent}, quiet ${x.quiet}` : ""));
  }
  for (const [sector, s] of Object.entries(breadth.sectors.rows)) unshaped(`sector-tide ${sector}`, sectorRaws[sector], s.status);
  for (const [name, s] of Object.entries({ "net-flow zero_dte": breadth.dte.zero, "net-flow weekly": breadth.dte.weekly,
    ...Object.fromEntries(BREADTH_ETFS.map((t) => ["etf-tide " + t, breadth.etf[t]])) })) {
    if (s.check === "disagrees") note(`${name}: the variance-ratio check disagrees with the declared cumulative basis`);
  }
  const disagree = Object.entries(breadth.sectors.rows).filter(([, s]) => s.check === "disagrees").map(([k]) => k);
  if (disagree.length) note(`sector-tide basis check disagrees for ${disagree.join(", ")}`);
  await put("live:breadth", breadth, { answered: anyAnswered([...Object.values(breadth.sectors.rows),
    ...BREADTH_ETFS.map((t) => breadth.etf[t]), breadth.dte.zero, breadth.dte.weekly]) });

  const strips = shapeStrips(strip, { at: stripAt, session, names: plan.names, writer, base: priorBase, lag: true });
  unshaped("screener strip", strip, strips.status);
  if (strips.status !== "unavailable") {
    const withQuote = rowsOf(strip).filter((r) => r && r.quote_time !== null && r.quote_time !== undefined).length;
    note(`screener strip: ${strips.returned ?? 0}/${plan.names.length} name(s), row date ${strips.rowDate || "absent"}, ` +
      `quote_time set on ${withQuote} row(s)`);
    const lag = strips.lag;
    const ahead = strips.ahead.n ? `; ${strips.ahead.n} row(s) stamped ahead of the read, by up to ${strips.ahead.maxS} s` : "";
    note(lag ? `quote lag: ${lag.n} row(s) stamped, p50 ${lag.p50} s, p90 ${lag.p90} s, max ${lag.max} s${ahead}` +
      (strips.off.n ? `; ${strips.off.n} row(s) dated before the session held out (${Object.keys(strips.off.dates).slice(0, 6).join(", ")})` : "")
      : `quote lag: no row carried a usable quote_time${ahead}`);
    const px = strips.fields.indexOf("px");
    const chg = strips.fields.indexOf("chg");
    const bare = Object.values(strips.rows).filter((v) => v[px] !== null && v[chg] === null).length;
    const fill = strips.prevFill;
    const gaps = `${bare} row(s) keep a null change`;
    const others = priorBase && priorBase.other.length ? `; not used: ${priorBase.other.map(([k, d]) => k + " " + d).join(", ")}` : "";
    note(!priorBase ? "day change: no dated prior session to read a base from"
      : !fill ? `day change: no base offered, ${gaps}`
        : fill.declined ? `day change: the ${fill.date} close disagrees with the feed's prev_close on ` +
          `${fill.agree[1] - fill.agree[0]}/${fill.agree[1]}, nothing filled, ${gaps}${others}`
          : `day change: ${fill.n} null prev_close filled from the ${fill.date} close (${Object.entries(fill.from)
            .map(([k, n]) => k + " " + n).join(", ") || "none"}), feed agrees ${fill.agree[0]}/${fill.agree[1]}, ${gaps}${others}`);
  }
  const stripAnswered = strips.status !== "unavailable";
  await put("live:strips", strips, { answered: stripAnswered });

  const prevSeries = await readStored("live:strips:series");
  const series = appendStripSeries(prevSeries && prevSeries.payload, strips, { at: stripAt, session, writer });
  if (series.trimmed) note(`live:strips:series: ${series.trimmed} oldest column(s) shed to fit its byte cap`);
  await put("live:strips:series", series, { answered: series.appended === true || series.replaced === true });
  await put("live:vol", shapeVol(indexRows(strip), { at: stripAt, session, writer }), { answered: stripAnswered });
  await put("live:movers", shapeMovers(strips, { at: stripAt, session, writer }), { answered: stripAnswered });

  const merged = mergeLiveAlerts(prevAlerts && prevAlerts.payload, pages, {
    at: alertsAt, session, writer, stageOf: (t) => plan.stage.get(t) || null,
  });
  if (merged.write) {
    await put("live:alerts", merged.write);
    const head = typeof bytes["live:alerts"] === "number" ? shapeAlertsHead(merged.write, { writer }) : null;
    if (head) await put("live:alerts:head", head);
  } else log(`  live:alerts: NOT WRITTEN — ${merged.why}; ${merged.read} row(s) read, the held record stands`);

  note(fundsNote(await readStored("live:funds")));

  if (typeof shapeNews === "function") {
    const news = failed(newsRaw)
      ? { status: "unavailable", reason: "vendor-failed", rows: [] }
      : shapeNews(newsRaw, { requested: NEWS_VENDOR_LIMIT });
    await put("live:news", {
      v: 1, key: "live:news", session,
      fresh: freshEnvelope({ readAt: newsAt, source: "actions", cadenceS: LIVE_KEYS["live:news"].cadenceS, session, writer }),
      ...news,
    }, { answered: !failed(newsRaw) });
  }

  const finishedAt = now();
  const run = {
    origin: origin || "manual", startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(), durationMs: finishedAt - startedAt,
    calls: ledger.calls, failedCalls: ledger.failed, keys: bytes, errors, notes: notes.slice(0, 20),
    names: plan.names.length, focus: { n: plan.counts.focus, source: plan.focus.source },
    alerts: { mode: merged.mode, read: merged.read, pages: pages.length },
    quoteLag: strips.lag || null,
    quoteAhead: strips.ahead || null,
    capTide: { n: capRead.cap.n, of: capRead.cap.of, coverage: capRead.cap.coverage, reason: capRead.cap.reason, calls: capRead.calls,
      failed: capRead.failed },
    prevFill: strips.prevFill ? { date: strips.prevFill.date, n: strips.prevFill.n ?? 0, declined: strips.prevFill.declined || null,
      from: strips.prevFill.from || null } : null,
  };
  await put("live:heartbeat", {
    v: 1, key: "live:heartbeat", session,
    fresh: freshEnvelope({ readAt: at, source: "actions", cadenceS: LIVE_KEYS["live:heartbeat"].cadenceS, session, writer }),
    run,
  });
  log(`live: ${ledger.calls} call(s) (${ledger.failed} failed), ${Object.values(bytes).filter((b) => b !== null).length} ` +
    `key(s) published in ${fixedHalfUp(Math.max(0, finishedAt - startedAt), 1, -3)} s`);
  return { run, published: Object.keys(out), bytes };
}

export function passOutcome(result) {
  if (!result || result.skipped) return { skipped: result ? result.skipped : "no-result", answered: 0, landed: 0 };
  const run = result.run || {};
  const answered = Math.max(0, (Number(run.calls) || 0) - (Number(run.failedCalls) || 0));
  const landed = (result.published || []).filter((k) => k !== "live:heartbeat").length;
  return { skipped: null, answered, landed, errored: (run.errors || []).length > 0 };
}
