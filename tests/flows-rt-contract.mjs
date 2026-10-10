import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import * as RT from "../shared/flows-rt.js";
import {
  RtHub, createHub, createRestUpstream, hubConfig, loadRosterFromD1, RT_BOARDS_SQL, rtClock,
} from "../shared/flows-rt-hub.js";
import { rtTopics } from "../shared/flows-rt-routes.js";
import { vendorBase, vendorBaseInfo, vendorRedirected, vendorUrl, unwrap as vendorUnwrap, classifyStatus, retryAfterMs as vendorRetryAfterMs, VENDOR_BASE_DEFAULT } from "../shared/flows-vendor-core.js";
import {
  FRESH_CLASSES, freshnessState, classOf, easternInstant, sessionOpen, phaseAt,
} from "../shared/flows-freshness.js";
import {
  LIVE_KEYS, STRIP_FIELDS, TIER1_CALLS, LIVE_BUDGET, shapeStrips, shapeGexSeries, shapeMarketLive, mergeGex, mergeLiveAlerts,
  alertsCursor, gexRotation, timeMs,
} from "../shared/flows-live.js";
import { liveEntry } from "../shared/flows-live-worker.js";
import { buildFlowAlerts } from "../shared/flows-alerts.js";
import { FOCUS_STRIP_FALLBACK } from "../shared/flows-focus.js";
import { boardPlan } from "../scripts/flows-legs/live.mjs";
import { shapeNews } from "../scripts/flows-pipeline.mjs";
import { fakeBoards } from "../scripts/flows-legs/live-fake.mjs";
import { createFakeVendor, fetchFor, ALERT_EVERY_MS } from "./rt-fixtures.mjs";
import { moduleSource, workerSource, expect } from "./lib/source-scan.mjs";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const DAY = "2026-09-30";
const at = (h, m, day = DAY) => easternInstant(day, h * 60 + m);
const TOPICS = RT.RT_TOPIC_KEYS;
const cpuMs = () => { const u = process.threadCpuUsage(); return (u.user + u.system) / 1000; };

const rtFlat = (o) => JSON.stringify(Object.keys(o).sort());

{
  deep(RT.RT_TOPIC_KEYS, ["px", "fl", "gx", "mk", "nw"], "five data topics");
  deep(RT.RT_KINDS, ["px", "fl", "gx", "mk", "nw", "ctl"], "five data topics and the control channel");
  deep(RT.RT_CTL, ["hello", "hb", "resync", "degraded", "closed", "bye"], "six control frames");
  deep(RT.RT_ENVELOPE_KEYS, ["v", "k", "ep", "sq", "at", "snap", "fresh", "meta", "rows"], "the envelope keys, in order");
  for (const [name, v] of Object.entries({ RT_TOPICS: RT.RT_TOPICS, RT_LIMITS: RT.RT_LIMITS, RT_CLOSE: RT.RT_CLOSE, RT_ROW_FIELDS: RT.RT_ROW_FIELDS })) {
    ok(Object.isFrozen(v), `${name} is frozen`);
  }
  for (const k of TOPICS) ok(Object.isFrozen(RT.RT_TOPICS[k]) && FRESH_CLASSES[RT.RT_TOPICS[k].klass], `${k} is a frozen topic with a freshness class`);
  deep(TOPICS.map((k) => RT.RT_TOPICS[k].cadenceMs), [5000, 5000, 15000, 10000, 30000], "px 5 s, fl 5 s, gx 15 s a focus name, mk 10 s, nw 30 s");
  deep(TOPICS.map((k) => RT.RT_TOPICS[k].klass), ["rt", "rt", "rtSlow", "rtSlow", "rtNews"], "classes follow the cadence");
  deep(RT.RT_ROW_FIELDS.px, ["t", "qt", ...STRIP_FIELDS.map(([n]) => n)], "px rows are the strip row behind a ticker and a vendor quote time");
  eq(RT.RT_ROW_FIELDS.px.length, 25, "twenty-five columns");
  deep(RT.RT_ROW_FIELDS.gx, ["t", "at", "px", "gOi", "gVol", "gDir", "flow", "lagS"], "gx rows");
  for (const k of TOPICS) {
    eq(LIVE_KEYS[RT.RT_TOPICS[k].key] !== undefined, true, `${k} names a live key that exists (${RT.RT_TOPICS[k].key}), so every row has a stored twin`);
  }

  const f = RT.frame("px", { ep: 5, sq: 3, at: 7, fresh: { state: "live" }, rows: [1] });
  deep(Object.keys(f), ["v", "k", "ep", "sq", "at", "fresh", "meta", "rows"], "a data frame carries its keys in the contract order");
  deep(Object.keys(RT.frame("px", { ep: 5, sq: 3, at: 7, snap: true })), ["v", "k", "ep", "sq", "at", "snap", "meta", "rows"], "a snapshot adds snap");
  const c = RT.ctlFrame("hb", { ep: 5, at: 7 });
  deep(Object.keys(c), ["v", "k", "ep", "sq", "at", "t", "meta", "rows"], "a control frame names its type in t");
  eq(c.sq, 0, "and is not sequenced");
  deep(RT.checkFrame(f), ["fresh.reason", "fresh.klass", "fresh.cadenceS", "fresh.source", "fresh.session", "fresh.updatedAt", "fresh.readAt", "fresh.liveUntil", "fresh.staleAt"], "checkFrame names every missing key of the fresh entry");
  deep(RT.checkFrame(c), [], "a control frame is clean");
  ok(RT.checkFrame({ v: 2, k: "zz", ep: 0, sq: -1, at: 0, meta: [], rows: {} }).length >= 6, "and a malformed frame is refused many ways");
}

{
  deep(FRESH_CLASSES.rt, { cadenceS: 5, liveS: 15, staleS: 60, source: "hub", extended: true }, "rt: cadence 5, live 15, stale 60");
  deep(FRESH_CLASSES.rtSlow, { cadenceS: 10, liveS: 30, staleS: 120, source: "hub", extended: true }, "rtSlow: cadence 10, live 30, stale 120");
  deep(FRESH_CLASSES.rtNews, { cadenceS: 30, liveS: 75, staleS: 300, source: "hub", extended: true }, "rtNews: cadence 30, live 75, stale 300");
  eq(classOf({ cadenceS: 5 }), "quote", "a bare cadence of 5 is still the quote class");
  eq(classOf({ cadenceS: 10 }), "tape", "and a bare 10 still falls to tape: the hub classes are named, never inferred");
  eq(classOf({ klass: "rtSlow" }), "rtSlow", "a named class is honoured");

  const noon = at(11, 0);
  const s = (readOffset, nowOffset, klass = "rt", when = noon) => freshnessState({ klass, readAt: when - readOffset, session: DAY }, when + nowOffset);
  eq(s(0, 5000).state, "live", "rt is live 5 s after the read");
  eq(s(0, 15000).state, "live", "and at 15 s, the line");
  eq(s(0, 16000).state, "fresh", "fresh past 15 s");
  eq(s(0, 60000).state, "fresh", "fresh to 60 s");
  eq(s(0, 61000).state, "stale", "stale after 60 s");
  eq(s(0, 29000, "rtSlow").state, "live", "rtSlow live to 30 s");
  eq(s(0, 121000, "rtSlow").state, "stale", "stale after 120 s");
  eq(s(0, 74000, "rtNews").state, "live", "rtNews live to 75 s");
  const pre = at(8, 0);
  eq(freshnessState({ klass: "rt", readAt: pre - 2000, session: DAY }, pre).state, "live", "pre-market: the stream class applies its live window");
  eq(freshnessState({ klass: "market", readAt: pre - 2000, session: DAY }, pre).state, "closed", "while a legacy class stays closed in the same minute");
  const post = at(17, 0);
  eq(freshnessState({ klass: "rt", readAt: post - 2000, session: DAY }, post).state, "live", "post-market: live too");
  eq(freshnessState({ klass: "rt", readAt: post - 2000, session: DAY }, post + 3 * 60000).state, "stale", "and a dead pipe goes stale in post-market, not closed");
  const night = at(21, 0);
  const closedNight = freshnessState({ klass: "rt", readAt: at(19, 59), session: DAY }, night);
  eq(closedNight.state, "closed", "after 20:00 the day's last read is closed");
  eq(closedNight.reason, "session-final", "session-final");
  const sat = easternInstant("2026-10-03", 11 * 60);
  eq(freshnessState({ klass: "rt", readAt: at(19, 59, "2026-10-02"), session: "2026-10-02" }, sat).state, "closed", "a Saturday after Friday's last read is closed");
  eq(freshnessState({ klass: "rt", readAt: at(19, 59), session: DAY }, sat).state, "stale", "and a Saturday after a read that predates Friday's close is stale, not closed");
  const early = easternInstant(DAY, 4 * 60) + 5000;
  eq(freshnessState({ klass: "rt", readAt: at(19, 59, "2026-09-29"), session: "2026-09-29" }, early).reason, "awaiting-first-read", "at 04:00:05 the previous evening's read waits for the first read of the day");
  eq(freshnessState({ klass: "rt", readAt: at(19, 59, "2026-09-29"), session: "2026-09-29" }, early + 60000).state, "stale", "and a minute on, with still no read, it is stale");
}

{
  const now = at(11, 0);
  const meta = { readAt: now, session: DAY, cadenceS: 5, source: "hub", klass: "rt" };
  const stored = liveEntry(meta, now, now, null);
  const entry = RT.streamEntry({ k: "px", readAt: now, vendorAt: now - 1000, session: DAY, now, updatedAt: now });
  eq(rtFlat(entry), rtFlat(stored), "streamEntry has exactly the keys entryOf() writes for a stored live key");
  deep(entry, { ...stored, source: "hub" }, "and the same values for the same instant");

  const E = (vendorAgeS, k = "px", stamped = true) => RT.streamEntry({
    k, readAt: now, vendorAt: stamped ? now - vendorAgeS * 1000 : null, session: DAY, now, updatedAt: now,
  });
  eq(E(3).state, "live", "px: a vendor stamp 3 s behind the read is live");
  eq(E(15).state, "live", "15 s is the line");
  const lag = E(30);
  deep([lag.state, lag.reason, lag.liveUntil], ["fresh", "vendor-lag", null], "30 s of vendor lag is fresh, reason vendor-lag, with no live window left to extrapolate");
  const dead = E(100);
  deep([dead.state, dead.reason], ["stale", "vendor-lag"], "100 s is stale: past the stale line the age of the data decides");
  const un = E(0, "px", false);
  deep([un.state, un.reason, un.liveUntil], ["fresh", "vendor-unstamped", null], "a frame with no vendor stamp cannot claim live");
  const ahead = RT.streamEntry({ k: "px", readAt: now, vendorAt: now + 120000, session: DAY, now, updatedAt: now });
  deep([ahead.state, ahead.reason], ["fresh", "vendor-skew"], "a stamp two minutes in the future is skew, not freshness");
  eq(E(60, "gx").state, "live", "gx: a minute bar is allowed its bar width on top of the live line");
  eq(E(100, "gx").state, "fresh", "gx past 90 s is fresh with vendor-lag");
  eq(E(200, "gx").state, "stale", "past 180 s stale");
  eq(E(300, "mk").state, "live", "mk: five-minute bars are allowed five minutes");
  eq(E(600, "mk").reason, "vendor-lag", "and 10 minutes behind is not live");
  eq(E(9999, "fl").state, "live", "an event topic is judged by its poll, not by the age of its newest event");
  eq(E(9999, "nw", false).state, "live", "neither news");
  eq(RT.pendingStream("px").state, "pending", "a topic with no read is pending");
  deep(RT.pendingStream("px"), { state: "pending", reason: "unpublished", klass: "rt" }, "in the shape the stored keys use");

  const fresh = readFileSync(new URL("../assets/js/flows-fresh.js", import.meta.url), "utf8");
  const ctx = { window: { FlowsUI: {} }, document: { hidden: false }, console, Date, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(fresh, ctx);
  const UI = ctx.window.FlowsUI;
  const frame = RT.frame("px", { ep: 1, sq: 1, at: Date.now(), fresh: RT.streamEntry({ k: "px", readAt: now, vendorAt: now - 1000, session: DAY, now, updatedAt: now }) });
  const ff = UI.freshFrom(frame.fresh, { serverNow: now });
  ok(ff && typeof ff.stateAt === "function", "FlowsUI.freshFrom accepts the entry");
  const skew = ff.skewMs;
  eq(ff.stateAt(now - skew + 10000), "live", "and extrapolates live inside the window");
  eq(ff.stateAt(now - skew + 30000), "fresh", "fresh past it");
  eq(ff.stateAt(now - skew + 90000), "stale", "and stale past 60 s with no further frame, with no message needed to say so");
  const lagged = UI.freshFrom(RT.streamEntry({ k: "px", readAt: now, vendorAt: now - 30000, session: DAY, now, updatedAt: now }), { serverNow: now });
  eq(lagged.stateAt(now - lagged.skewMs + 1000), "fresh", "a vendor-lag entry stays fresh to the client's clock: liveUntil is null so it is never promoted");

  const h = RT.entryHeaders(entry, now, phaseAt(now));
  eq(h["X-Fresh-State"], "live", "X-Fresh-State");
  eq(h["X-Fresh-Class"], "rt", "X-Fresh-Class");
  eq(h["X-Fresh-Source"], "hub", "X-Fresh-Source");
  eq(h["X-Fresh-Phase"], "rth", "X-Fresh-Phase");
  eq(h["X-Server-Now"], String(now), "X-Server-Now");
  eq(RT.worstEntry([entry, dead, lag]).state, "stale", "the worst entry wins the header");
  eq(RT.worstEntry([RT.pendingStream("px"), entry]).state, "pending", "pending is worse than live");
}

{
  const m = (o) => RT.parseClientMessage(JSON.stringify(o));
  deep(m({ t: "sub", k: ["px", "fl"], f: "nvda" }), { ok: true, msg: { t: "sub", k: ["px", "fl"], f: "NVDA" } }, "sub with a ticker is normalised");
  deep(m({ t: "sub", k: ["px", "px"] }), { ok: true, msg: { t: "sub", k: ["px"], f: undefined } }, "sub dedupes topics and leaves the focus alone when f is absent");
  deep(m({ t: "sub", k: [], f: null }), { ok: true, msg: { t: "sub", k: [], f: null } }, "sub may clear everything");
  deep(m({ t: "p", sq: { px: 12, fl: 0 } }), { ok: true, msg: { t: "p", sq: { px: 12, fl: 0 } } }, "p reports sequences");
  deep(m({ t: "rs", k: "px" }), { ok: true, msg: { t: "rs", k: "px" } }, "rs asks for one topic");
  const bad = [
    ["sub with unknown topic", { t: "sub", k: ["zz"] }], ["sub with ctl", { t: "sub", k: ["ctl"] }], ["sub extra key", { t: "sub", k: [], x: 1 }],
    ["sub bad ticker", { t: "sub", k: [], f: "no way" }], ["sub k not array", { t: "sub", k: "px" }], ["p negative", { t: "p", sq: { px: -1 } }],
    ["p fractional", { t: "p", sq: { px: 1.5 } }], ["p unknown", { t: "p", sq: { zz: 1 } }], ["p array", { t: "p", sq: [] }],
    ["rs unknown", { t: "rs", k: "zz" }], ["rs ctl", { t: "rs", k: "ctl" }], ["type", { t: "ping" }], ["array", [1]], ["no type", {}],
  ];
  for (const [name, msg] of bad) eq(m(msg).ok, false, `refused: ${name}`);
  eq(RT.parseClientMessage("not json").ok, false, "refused: not JSON");
  eq(RT.parseClientMessage(new ArrayBuffer(4)).ok, false, "refused: binary");
  eq(RT.parseClientMessage("null").ok, false, "refused: null");
  eq(RT.parseClientMessage(JSON.stringify({ t: "sub", k: ["px"], f: "A".repeat(300) })).why, "too-big", "refused: over 256 bytes");
  eq(RT.parseClientMessage(JSON.stringify({ t: "sub", k: [], f: "é".repeat(130) })).why, "too-big", "bytes, not characters, are counted");
  ok(JSON.stringify({ t: "p", sq: { px: 999999, fl: 999999, gx: 999999, mk: 999999, nw: 999999 } }).length < 256, "the largest honest progress report fits in 256 bytes");
  deep(rtTopics("px,fl"), { ok: true, topics: ["px", "fl"] }, "the snap route parses topics");
  deep(rtTopics(null).topics, TOPICS, "and defaults to all five");
  eq(rtTopics("px,zz").ok, false, "and refuses an unknown one");
  eq(rtTopics(",").ok, false, "and an empty list");
}

{
  const seq = RT.createSeq();
  const f = (k, sq, extra = {}) => ({ v: 1, k, ep: 10, sq, at: 1, meta: {}, rows: [], ...extra });
  eq(seq.accept(f("px", 4, { snap: true })).verdict, "epoch", "the first frame of an epoch, a snapshot, opens it");
  eq(seq.accept(f("px", 5)).verdict, "ok", "the next sq is ok");
  eq(seq.accept(f("fl", 9, { snap: true })).verdict, "snap", "another topic's snapshot sets its own baseline");
  eq(seq.accept(f("fl", 10)).verdict, "ok", "fl continues from its own counter");
  eq(seq.accept(f("px", 6)).verdict, "ok", "px is unaffected by fl frames between its own");
  const gap = seq.accept(f("px", 9));
  deep([gap.verdict, gap.missed], ["gap", 2], "a jump of three is a gap of two missed frames");
  eq(seq.accept(f("px", 9)).verdict, "dup", "a repeat is a duplicate");
  eq(seq.accept(f("px", 8)).verdict, "dup", "and an older frame");
  eq(seq.accept(f("zz", 3)).verdict, "orphan", "a delta for a topic with no snapshot is an orphan");
  eq(seq.accept({ ...f("px", 1), ep: 11, snap: true }).verdict, "epoch", "a new epoch resets every topic");
  eq(seq.accept({ ...f("fl", 1), ep: 11 }).verdict, "orphan", "and a topic not yet snapshotted in it is an orphan");
  eq(seq.accept({ v: 1, k: "ctl", ep: 11, sq: 0, at: 1, t: "hb", meta: {}, rows: [] }).verdict, "ctl", "control frames carry no sequence");

  let shared = 0;
  const per = RT.createCounter();
  const sharedSeq = RT.createSeq();
  const perSeq = RT.createSeq();
  const sharedGaps = { n: 0 };
  const perGaps = { n: 0 };
  sharedSeq.accept({ v: 1, k: "px", ep: 1, sq: 0, at: 1, snap: true, meta: {}, rows: [] });
  perSeq.accept({ v: 1, k: "px", ep: 1, sq: 0, at: 1, snap: true, meta: {}, rows: [] });
  perSeq.accept({ v: 1, k: "fl", ep: 1, sq: 0, at: 1, snap: true, meta: {}, rows: [] });
  sharedSeq.accept({ v: 1, k: "fl", ep: 1, sq: 0, at: 1, snap: true, meta: {}, rows: [] });
  for (let i = 0; i < 1000; i++) {
    const k = i % 3 ? "px" : "fl";
    shared++;
    if (sharedSeq.accept({ v: 1, k, ep: 1, sq: shared, at: 1, meta: {}, rows: [] }).verdict === "gap") sharedGaps.n++;
    if (perSeq.accept({ v: 1, k, ep: 1, sq: per.next(k), at: 1, meta: {}, rows: [] }).verdict === "gap") perGaps.n++;
  }
  ok(sharedGaps.n > 600, `one shared counter manufactures ${sharedGaps.n} false gaps in 1000 frames`);
  eq(perGaps.n, 0, "per-topic counters manufacture none");
}

{
  const b = RT.createBudget({ perMinute: 240 });
  const t0 = 1_000_000_000;
  for (let i = 0; i < 240; i++) ok(b.take("gx", t0 + i), `call ${i + 1} of 240 is admitted`);
  eq(b.take("px", t0 + 500), false, "the 241st call in the minute is refused");
  eq(b.used(t0 + 500), 240, "and the window holds 240");
  eq(b.take("px", t0 + 59 * 1000), false, "still refused 59 s on");
  eq(b.take("px", t0 + 61 * 1000), true, "and admitted once the minute has rolled");
  const b2 = RT.createBudget({ perMinute: 10 });
  ok(b2.take("mk", t0, 2) && b2.take("px", t0 + 1000, 8), "a multi-call topic takes its whole cost at once");
  eq(b2.take("nw", t0 + 2000, 1), false, "and a poll that does not fit is refused whole");
  deep(b2.minute(t0 + 2000), { px: 8, fl: 0, gx: 0, mk: 2, nw: 0 }, "per-topic calls in the last minute");
  deep(b2.hour(t0 + 2000), { px: 8, fl: 0, gx: 0, mk: 2, nw: 0 }, "and in the last hour");
  deep(b2.minute(t0 + 90 * 1000), { px: 0, fl: 0, gx: 0, mk: 0, nw: 0 }, "the minute view forgets");
  deep(b2.hour(t0 + 90 * 1000), { px: 8, fl: 0, gx: 0, mk: 2, nw: 0 }, "the hour view remembers");
  deep(b2.hour(t0 + 61 * 60 * 1000), { px: 0, fl: 0, gx: 0, mk: 0, nw: 0 }, "for an hour");
  const lag = RT.createLagStats(100);
  for (let i = 1; i <= 100; i++) lag.add(i * 10);
  deep(lag.summary(), { n: 100, p50: 500, p95: 950, max: 1000 }, "lag percentiles by nearest rank");
  for (let i = 0; i < 100; i++) lag.add(5);
  deep(lag.summary(), { n: 100, p50: 5, p95: 5, max: 5 }, "a full ring forgets its oldest");
  deep(RT.createLagStats().summary(), { n: 0, p50: null, p95: null, max: null }, "an empty ring says null, not zero");
  lag.add(NaN);
  eq(lag.summary().n, 100, "a non-number is ignored");
}

const SESSION_NOW = at(10, 0);

{
  const clock = () => SESSION_NOW;
  const vendor = createFakeVendor({ session: DAY, clock });
  const names = ["SPY", "QQQ", "IWM", "GLD", "NVDA", "AAPL", "TSLA", "SYL001"];
  const raw = vendor.screener({ ticker: names.join(",") });
  const st = RT.createPxState();
  RT.setPxNames(st, names);
  const out = RT.applyPx(st, raw, { at: SESSION_NOW, session: DAY, names });
  const shaped = shapeStrips(raw, { at: SESSION_NOW, session: DAY, names, writer: "flows-live", key: "live:strips" });
  eq(out.rows.length, names.length, "px: every name arrives as a row");
  for (const row of out.rows) {
    deep(row.slice(2), shaped.rows[row[0]], `px ${row[0]}: the row behind the ticker and quote time is the live:strips row, value for value`);
    const src = raw.data.find((r) => r.ticker === row[0]);
    eq(row[1], src.quote_time, `px ${row[0]}: the second column is the vendor's quote time`);
  }
  deep(RT.RT_ROW_FIELDS.px.slice(2), shaped.fields, "and the columns are the live:strips fields in order");
  eq(out.vendorAt, shaped.fresh.vendorAt ? timeMs(shaped.fresh.vendorAt) : null, "px: the frame's vendor instant is the strips' own");
  deep(RT.snapshotPx(st).map((r) => r[0]), names.slice().sort(), "px: a snapshot is every held row, by ticker");

  const again = RT.applyPx(st, raw, { at: SESSION_NOW + 5000, session: DAY, names });
  eq(again.rows.length, 0, "px conflation: the same quotes read again send no rows, though qa has grown");
  const moved = JSON.parse(JSON.stringify(raw));
  moved.data[0].close = (Number(moved.data[0].close) + 1).toFixed(4);
  moved.data[0].quote_time += 2000;
  const one = RT.applyPx(st, moved, { at: SESSION_NOW + 5000, session: DAY, names });
  deep(one.rows.map((r) => r[0]), [moved.data[0].ticker.toUpperCase()], "and one moved quote sends one row");
  const older = JSON.parse(JSON.stringify(raw));
  older.data[0].close = "1.0000";
  const stale = RT.applyPx(st, older, { at: SESSION_NOW + 6000, session: DAY, names });
  eq(stale.rows.length, 0, "latest wins by vendor time: an older quote after a newer one is ignored");
  eq(RT.snapshotPx(st).find((r) => r[0] === moved.data[0].ticker)[2], Number(moved.data[0].close), "and the held row is the newer");
  RT.setPxNames(st, names.slice(0, 3));
  eq(RT.snapshotPx(st).length, 3, "a name that leaves the roster leaves the map");
  const wide = RT.createPxState();
  const many = Array.from({ length: 300 }, (_, i) => "N" + String(i).padStart(3, "0"));
  RT.setPxNames(wide, many);
  RT.applyPx(wide, vendor.screener({ ticker: many.join(",") }), { at: SESSION_NOW, session: DAY, names: many });
  eq(wide.rows.size, RT.RT_TOPICS.px.rowMax, "px: the map is capped by construction, not by luck");

  const g = RT.createGexState();
  const spot = await vendor.handle("/api/stock/NVDA/spot-exposures");
  const gOut = RT.applyGex(g, "NVDA", spot.body, { at: SESSION_NOW, session: DAY });
  const series = shapeGexSeries(spot.body, { session: DAY, now: SESSION_NOW });
  deep(gOut.rows[0].slice(2, 6), [series.last.px, series.last.gOi, series.last.gVol, series.last.gDir], "gx: the row is shapeGexSeries().last");
  eq(gOut.rows[0][1], timeMs(series.last.at), "gx: stamped with the vendor's bar");
  eq(gOut.rows[0][6], series.flowFilled ? 1 : 0, "gx: flow flag");
  const merged = mergeGex(null, { NVDA: series }, { at: SESSION_NOW, session: DAY, writer: "flows-live", rotation: gexRotation({ ranked: ["NVDA"], deep: [], tick: 0 }) });
  const stored = merged.names.NVDA.last;
  deep([stored.px, stored.gOi, stored.gVol, stored.gDir], gOut.rows[0].slice(2, 6), "and it is the same last tuple mergeGex stores in live:gex");
  eq(merged.names.NVDA.lagS, gOut.rows[0][7], "with the same lag");
  eq(RT.applyGex(g, "NVDA", spot.body, { at: SESSION_NOW + 1000, session: DAY }).rows.length, 0, "gx: the same bar again is not a change");
  const quiet = RT.applyGex(g, "NVDA", { data: [] }, { at: SESSION_NOW, session: DAY });
  deep([quiet.rows.length, quiet.meta.status], [0, "quiet"], "gx: an empty answer is quiet, said in meta, held row untouched");
  eq(RT.snapshotGex(g).length, 1, "and the held row stands");
  const early = RT.applyGex(g, "AAPL", spot.body, { at: at(8, 0), session: DAY });
  eq(early.meta.status, "quiet", "gx: pre-open the series is quiet with the vendor's own reason");

  const tide = await vendor.handle("/api/market/market-tide");
  const sectors = await vendor.handle("/api/market/sector-etfs");
  const mk = RT.createMarketState();
  const mkOut = RT.applyMarket(mk, { tide: tide.body, sectors: sectors.body }, { at: SESSION_NOW, session: DAY });
  const live = shapeMarketLive({ tide: tide.body, sectors: sectors.body }, { at: SESSION_NOW, session: DAY, writer: "worker@tier1" });
  const sec = mkOut.rows.filter((r) => r.id !== "tide");
  deep(sec.map(({ id, ...r }) => r), live.sectors.rows, "mk: sector rows are the live:market sector rows, key for key");
  const tideRow = mkOut.rows.find((r) => r.id === "tide");
  const i = live.tide.n - 1;
  deep([tideRow.t, tideRow.ncp, tideRow.npp, tideRow.net, tideRow.nv], [live.tide.t[i], live.tide.ncp[i], live.tide.npp[i], live.tide.net[i], live.tide.nv[i]], "mk: the tide row is the last point of the stored series");
  eq(RT.applyMarket(mk, { tide: tide.body, sectors: sectors.body }, { at: SESSION_NOW + 10000, session: DAY }).rows.length, 0, "mk: unchanged readings send nothing");
  const failedBoth = RT.applyMarket(RT.createMarketState(), { tide: { __failed: "x" }, sectors: { __failed: "x" } }, { at: SESSION_NOW, session: DAY });
  eq(failedBoth.answered, false, "mk: both feeds failing is not an answer");
  const failedOne = RT.applyMarket(RT.createMarketState(), { tide: { __failed: "x" }, sectors: sectors.body }, { at: SESSION_NOW, session: DAY });
  deep([failedOne.answered, failedOne.meta.tide.status, failedOne.rows.length > 0], [true, "unavailable", true], "mk: one feed answering is an answer, and says which one is silent");
  deep(TIER1_CALLS.map((c) => [c.feed, c.path]), [["tide", "/api/market/market-tide"], ["sectors", "/api/market/sector-etfs"]], "mk polls exactly Tier 1's two calls");
}

{
  const clock = () => SESSION_NOW;
  const vendor = createFakeVendor({ session: DAY, clock });
  const raw = vendor.alerts({ limit: 200, newer_than: DAY });
  const stage = (t) => (t === "NVDA" ? "board:long" : null);
  const st = RT.createFlowState();
  const out = RT.applyFlow(st, raw, { session: DAY, stageOf: stage });
  const built = buildFlowAlerts(raw.data, { stageOf: stage, stageComplete: false, cap: raw.data.length });
  const strip = (r) => { const { id, ts, ...rest } = r; return rest; };
  const key = (r) => `${r.t}|${r.oc}|${r.spanStart}`;
  const byKey = new Map(built.rows.map((r) => [key(r), r]));
  eq(out.rows.length, built.rows.length, "fl: as many rows as the live:alerts shaper keeps");
  for (const r of out.rows) deep(strip(r), byKey.get(key(r)), `fl ${r.id}: the row is the live:alerts row, field for field`);
  deep(out.rows.map((r) => r.ts), out.rows.map((r) => r.ts).slice().sort((a, b) => a - b), "fl: rows ascend by vendor time so a client appends");
  ok(out.rows.every((r) => typeof r.id === "string" && Number.isFinite(r.ts)), "fl: every row carries the vendor's alert id and an epoch ts");
  const live = mergeLiveAlerts(null, [{ body: raw, full: false }], { at: SESSION_NOW, session: DAY, stageOf: stage, writer: "flows-live" });
  eq(out.meta.cursor, live.cursor, "fl: the cursor is mergeLiveAlerts' cursor");
  eq(out.meta.cursor, alertsCursor(raw.data), "and alertsCursor's");
  eq(RT.applyFlow(st, raw, { session: DAY, stageOf: stage }).rows.length, 0, "fl: the same page again adds nothing: dedupe by alert id");
  eq(RT.flowQuery(st, DAY), new Date(timeMs(out.meta.cursor) - RT.RT_LIMITS.flowOverlapMs).toISOString(), "the next question reaches back 30 s behind the cursor to catch a late alert");
  eq(RT.flowQuery(RT.createFlowState(), DAY), DAY, "and the first question of a session is the session day, as Tier 2 asks it");
  const later = createFakeVendor({ session: DAY, clock: () => SESSION_NOW + 9000 });
  const next = later.alerts({ limit: 200, newer_than: RT.flowQuery(st, DAY) });
  const nextOut = RT.applyFlow(st, next, { session: DAY, stageOf: stage });
  ok(nextOut.rows.length > 0 && nextOut.rows.length < next.data.length, `fl: the overlap re-reads ${next.data.length - nextOut.rows.length} alerts and sends only the ${nextOut.rows.length} new ones`);
  ok(nextOut.rows.every((r) => !out.rows.some((o) => o.id === r.id)), "none of them twice");
  eq(st.ring.length, Math.min(RT.RT_TOPICS.fl.rowMax, out.rows.length + nextOut.rows.length), "and the ring holds the newest 200 of both");
  eq(st.ring[st.ring.length - 1].id, nextOut.rows[nextOut.rows.length - 1].id, "ending at the newest alert");

  const big = RT.createFlowState();
  const many = createFakeVendor({ session: DAY, clock: () => SESSION_NOW + 3600e3 });
  let total = 0;
  for (let round = 0; round < 8; round++) {
    const rows = [];
    for (let n = round * 160; n < round * 160 + 160; n++) rows.push(many.alertAt(n));
    total += RT.applyFlow(big, { data: rows }, { session: DAY }).rows.length;
  }
  eq(total, 1280, "fl: 1280 distinct alerts all pass once");
  ok(big.ring.length <= RT.RT_TOPICS.fl.rowMax, `fl: the ring never exceeds ${RT.RT_TOPICS.fl.rowMax} (${big.ring.length})`);
  ok(big.seen.size <= RT.RT_LIMITS.seenMax, `fl: the dedupe memory never exceeds ${RT.RT_LIMITS.seenMax} (${big.seen.size})`);
  eq(big.ring[big.ring.length - 1].id, many.alertAt(1279).id, "fl: the ring keeps the newest");

  const truncated = RT.createFlowState();
  RT.applyFlow(truncated, { data: [many.alertAt(1)] }, { session: DAY });
  const flood = RT.applyFlow(truncated, { data: Array.from({ length: 200 }, (_, i) => many.alertAt(100 + i)) }, { session: DAY });
  deep([flood.meta.truncated, truncated.truncations], [true, 1], "fl: a full page with no overlap with what we hold says truncated");
  const cappedFrame = RT.mergeAppend([], new Map(), Array.from({ length: 250 }, (_, i) => ({ id: "x" + i, ts: i, row: { id: "x" + i } })), { ringMax: 200, seenMax: 1000, frameMax: 200 });
  deep([cappedFrame.rows.length, cappedFrame.dropped, cappedFrame.rows[0].id], [200, 50, "x50"], "fl: a frame is capped at 200 rows, the oldest dropped, and the drop is counted");
  const noId = RT.applyFlow(RT.createFlowState(), { data: [{ ...many.alertAt(5), id: undefined }, { ...many.alertAt(5), id: undefined }] }, { session: DAY });
  eq(noId.rows.length, 1, "fl: an alert with no id is keyed like the live record keys it, so a repeat is still a repeat");

  const news = vendor.news();
  const ns = RT.createNewsState();
  const nOut = RT.applyNews(ns, news, { at: SESSION_NOW });
  const piped = shapeNews(news, { cap: 100 }).rows;
  const norm = (r) => `${r.createdAtMs}|${r.headline}`;
  const nMap = new Map(piped.map((r) => [norm(r), r]));
  eq(nOut.rows.length, Math.min(piped.length, RT.RT_TOPICS.nw.rowMax), "nw: the ring holds as many rows as the nightly shaper's cap");
  for (const r of nOut.rows) {
    const { id, ts, ...rest } = r;
    deep(rest, nMap.get(norm(r)), `nw ${r.createdAtMs}: the row is the pipeline's news row`);
  }
  eq(RT.applyNews(ns, news, { at: SESSION_NOW + 30000 }).rows.length, 0, "nw: the same headlines again add nothing");
  const fresher = createFakeVendor({ session: DAY, clock: () => SESSION_NOW + 45000 }).news();
  ok(RT.applyNews(ns, fresher, { at: SESSION_NOW + 45000 }).rows.length >= 2, "nw: new headlines arrive as rows");
  ok(ns.ring.length <= RT.RT_TOPICS.nw.rowMax, "nw: the ring is bounded");
  eq(RT.newsRow({ headline: "  " }, 1), null, "nw: a headline-less row is unusable, as in the pipeline");
}

{
  const plan = (boards) => RT.rosterPlan({ long: boards.long.rows, short: boards.short.rows, watch: boards.watch.rows, focusPayload: null });
  const boards = fakeBoards({ n: 40 });
  const mine = plan(boards);
  const theirs = boardPlan({ long: { payload: boards.long }, short: { payload: boards.short }, watch: { payload: boards.watch } }, null);
  deep(mine.names, theirs.names, "the hub's roster is the names Tier 2's plan builds from the same boards");
  deep(mine.ranked, theirs.ranked, "with the same ranking");
  deep(mine.deep, theirs.deep, "and the same deep set");
  deep(Array.from(mine.stage.entries()), Array.from(theirs.stage.entries()), "and the same stages");
  ok(mine.names.length <= LIVE_BUDGET.stripMax, `at most ${LIVE_BUDGET.stripMax} names (${mine.names.length})`);
  const bare = RT.rosterPlan({});
  deep(bare.names.slice(3), FOCUS_STRIP_FALLBACK.slice(0, bare.names.length - 3), "with no boards the roster is the indices and the constant focus names");
  const base = RT.gexBase(mine, DAY, at(10, 0));
  const ref = gexRotation({ ranked: mine.ranked, deep: mine.deep, tick: Math.floor((at(10, 0) - sessionOpen(DAY)) / (15 * 60000)) });
  deep(base.names, ref.all, "gx rotates the set Tier 2 reads: indices, six fixed, six rotating");
  eq(base.names.length, 2 + LIVE_BUDGET.gexFixed + LIVE_BUDGET.gexRotating, "fourteen names");
  const seen = [];
  for (let i = 0; i < 14; i++) seen.push(RT.gexPick(i, base.names, []));
  deep(seen, base.names, "with no focus the pointer walks the set in order");
  const withFocus = [];
  for (let i = 0; i < 16; i++) withFocus.push(RT.gexPick(i, base.names, ["ZZZZ"]));
  deep(withFocus.filter((x) => x === "ZZZZ").length, 4, "a focus ticker takes one call in four");
  deep(withFocus.filter((x) => x !== "ZZZZ"), base.names.slice(0, 12), "and the roster order is undisturbed");
  eq(RT.gexPick(0, [], []), null, "nothing to ask is null");
  deep(RT.pickFocus(["NVDA", "NVDA", "aapl", "bad ticker", "TSLA", null]), ["NVDA", "TSLA"], "focus tickers are counted and validated");
  eq(RT.pickFocus(Array.from({ length: 30 }, (_, i) => "T" + i)).length, RT.RT_LIMITS.focusMax, "and capped");
  ok(RT.TICKER_RE.test("BRK.B"), "share-class tickers pass");
}

const never = new Promise(() => {});
const plainPlan = (names = ["SPY", "QQQ"], extra = {}) => ({
  topics: new Set(TOPICS),
  ready: () => true,
  session: () => DAY,
  names: () => names,
  gex: () => ({ names: ["NVDA"], focus: [] }),
  base: () => null,
  stage: () => null,
  ...extra,
});

const upstreamOf = (vendor, { clock, key = "uw-key", random = () => 0.5, perMinute = 240, scale = 1, timeoutMs = 4000, base = "http://uw.test" } = {}) => {
  const calls = [];
  const inner = fetchFor(vendor);
  const fetchImpl = async (url, init) => { calls.push({ url: new URL(String(url)), init }); return inner(url, init); };
  const cfg = hubConfig({ UW_API_KEY: key, UW_BASE: base, FLOWS_RT_MODE: "on", FLOWS_RT_SCALE: String(scale) });
  const frames = [];
  const errors = [];
  const up = createRestUpstream({ cfg, fetchImpl, now: clock, random, budget: RT.createBudget({ perMinute }), timeoutMs });
  return { up, calls, frames, errors, handlers: { onFrame: (f) => frames.push(f), onError: (e) => errors.push(e) }, cfg };
};

{
  let t = SESSION_NOW;
  const vendor = createFakeVendor({ session: DAY, clock: () => t });
  const u = upstreamOf(vendor, { clock: () => t });
  u.up.start(plainPlan(["SPY", "QQQ", "IWM"]), u.handlers);
  await u.up.tick(t);
  eq(u.calls.length, 1, "adapter: at the first instant only px is due");
  t += 500; await u.up.tick(t);
  t += 250; await u.up.tick(t);
  t += 250; await u.up.tick(t);
  eq(u.calls.length, 6, "adapter: staggered starts, then one call each for gx, fl, news and two for the market (6 calls)");
  const by = (re) => u.calls.filter((c) => re.test(c.url.pathname));
  const pxc = by(/screener/)[0];
  eq(pxc.url.origin, "http://uw.test", "adapter: the vendor base is UW_BASE");
  eq(pxc.url.searchParams.get("ticker"), "SPY,QQQ,IWM", "adapter: px asks the roster in one call");
  eq(pxc.url.searchParams.get("limit"), "500", "with limit 500, as Tier 1's focus read does");
  eq(pxc.init.headers.Authorization, "Bearer uw-key", "adapter: bearer auth");
  eq(pxc.init.headers.Accept, "application/json", "adapter: JSON");
  eq(by(/spot-exposures/)[0].url.pathname, "/api/stock/NVDA/spot-exposures", "adapter: gx asks one name per call");
  const flc = by(/flow-alerts/)[0];
  deep([flc.url.searchParams.get("limit"), flc.url.searchParams.get("newer_than")], ["200", DAY], "adapter: fl asks the newest page of 200 since the cursor");
  eq(by(/news/)[0].url.searchParams.get("limit"), "100", "adapter: news asks 100 headlines");
  deep(by(/market-tide|sector-etfs/).map((c) => c.url.pathname + c.url.search), TIER1_CALLS.map((c) => c.path + (c.path.includes("tide") ? "?interval_5m=true" : "")), "adapter: the market is Tier 1's two calls with Tier 1's params");
  eq(u.frames.length, 6 - 1, "adapter: every answered poll delivers one frame (the market's two calls are one)");
  const mkFrame = u.frames.find((f) => f.k === "mk");
  ok(mkFrame.items.some((r) => r.id === "tide") && mkFrame.items.filter((r) => r.etf).length >= 11, "adapter: the market frame carries the tide row and the sector rows, already shaped");
  deep(Object.keys(mkFrame).filter((x) => x !== "ms").sort(), RT.RT_UPSTREAM_API.frame.slice().sort(), "adapter: every frame it delivers has exactly the neutral frame's keys, plus the duration");
  ok(u.frames.every((f) => Array.isArray(f.items) && f.answered === true && f.raw === undefined && f.raws === undefined), "adapter: no raw vendor body leaves the adapter");
  ok(u.frames.every((f) => f.readAt >= SESSION_NOW && Number.isInteger(f.ms)), "adapter: frames carry the receive instant and the duration");
  const before = u.calls.length;
  t += 1000; await u.up.tick(t);
  eq(u.calls.length - before, 0, "adapter: a second later nothing is due, because gx asks each focus name every 15 s");
  u.up.stop();
  const quietCalls = u.calls.length;
  t += 60000; await u.up.tick(t);
  eq(u.calls.length, quietCalls, "adapter: stopped, it calls nothing");
}

{
  let t = SESSION_NOW;
  const vendor = createFakeVendor({ session: DAY, clock: () => t });
  vendor.delayMs = 120;
  const u = upstreamOf(vendor, { clock: () => t });
  u.up.start({ ...plainPlan(), topics: new Set(["px"]) }, u.handlers);
  const first = u.up.tick(t);
  const second = u.up.tick(t);
  await Promise.all([first, second]);
  eq(u.calls.length, 1, "adapter: a poll still in flight is never overlapped by another of the same topic");
  eq(u.frames.length, 1, "adapter: and delivers once");
  u.up.stop();

  const slow = createFakeVendor({ session: DAY, clock: () => t });
  slow.delayMs = 400;
  const s = upstreamOf(slow, { clock: () => t, timeoutMs: 60 });
  s.up.start({ ...plainPlan(), topics: new Set(["px"]) }, s.handlers);
  await s.up.tick(t);
  deep([s.errors.length, s.errors[0].code], [1, "timeout"], "adapter: a call that outlives its deadline is a timeout error");
  eq(s.frames.length, 0, "adapter: and delivers no frame");
  s.up.stop();

  const hang = createFakeVendor({ session: DAY, clock: () => t });
  const h = upstreamOf(hang, { clock: () => t });
  h.up.start({ ...plainPlan(), topics: new Set(["px"]) }, h.handlers);
  hang.delayMs = 200;
  const pending = h.up.tick(t);
  h.up.stop();
  await pending;
  eq(h.frames.length + h.errors.length, h.errors.length, "adapter: stopping while a call is out delivers no frame");
  h.up.start({ ...plainPlan(), topics: new Set(["px"]) }, h.handlers);
  hang.delayMs = 0;
  await h.up.tick(t + 10000);
  eq(h.frames.length, 1, "adapter: and a restarted run is not poisoned by the old one");
  h.up.stop();
}

{
  let t = SESSION_NOW;
  const vendor = createFakeVendor({ session: DAY, clock: () => t });
  vendor.fault = "429";
  const u = upstreamOf(vendor, { clock: () => t, random: () => 0.5 });
  u.up.start({ ...plainPlan(), topics: new Set(["px", "fl"]) }, u.handlers);
  await u.up.tick(t);
  ok(u.errors.some((e) => e.code === "http_429"), "adapter: a 429 is reported as http_429");
  const pausedUntil = u.up.state().pausedUntil;
  ok(pausedUntil >= t + 5000 * 0.8 && pausedUntil <= t + 5000 * 1.2, `adapter: the first pause is five seconds, jittered (${pausedUntil - t} ms)`);
  const n = u.calls.length;
  t += 2000; await u.up.tick(t);
  eq(u.calls.length, n, "adapter: while paused no topic calls the vendor");
  ok(u.up.paused(t), "adapter: and says it is paused");
  t = pausedUntil + 1; await u.up.tick(t);
  ok(u.calls.length > n, "adapter: it calls again when the pause ends");
  const second = u.up.state().pausedUntil - t;
  ok(second >= 10000 * 0.8 - 1500 && second <= 10000 * 1.2 + 1, `adapter: a second 429 doubles the pause (${second} ms)`);
  vendor.retryAfterS = 90;
  t = u.up.state().pausedUntil + 1;
  await u.up.tick(t);
  const honoured = u.up.state().pausedUntil - t;
  ok(honoured >= 90000 * 0.8 - 2000, `adapter: Retry-After is honoured (${honoured} ms)`);
  vendor.retryAfterS = 100000;
  t = u.up.state().pausedUntil + 1;
  await u.up.tick(t);
  ok(u.up.state().pausedUntil - t <= RT.RT_LIMITS.pause429MaxMs * 1.2 + 1, "adapter: but never past the two-minute ceiling");
  vendor.fault = null;
  t = u.up.state().pausedUntil + 1;
  await u.up.tick(t);
  eq(u.up.state().n429, 0, "adapter: a success clears the 429 count");
  u.up.stop();

  const five = createFakeVendor({ session: DAY, clock: () => t });
  five.fault = "500";
  t = SESSION_NOW;
  const f = upstreamOf(five, { clock: () => t, random: () => 0.5 });
  f.up.start({ ...plainPlan(), topics: new Set(["px"]) }, f.handlers);
  const dues = [];
  for (let i = 0; i < 6; i++) {
    await f.up.tick(t);
    dues.push(f.up.state().topics.px.due - t);
    t = f.up.state().topics.px.due;
  }
  deep(dues, [10000, 15000, 15000, 15000, 15000, 15000], "adapter: failures back off 10 s, then 15 s and no longer, so a recovered vendor is noticed inside the degrade line");
  ok(f.errors.every((e) => e.code === "http_5xx" && e.status === 500), "adapter: 5xx errors carry their status");
  f.up.stop();

  const garbage = createFakeVendor({ session: DAY, clock: () => t });
  garbage.fault = "garbage";
  const g = upstreamOf(garbage, { clock: () => t });
  g.up.start({ ...plainPlan(), topics: new Set(["px"]) }, g.handlers);
  await g.up.tick(t);
  eq(g.errors[0].code, "parse", "adapter: a 200 that is not JSON is a parse error");
  g.up.stop();

  t = SESSION_NOW;
  const none = upstreamOf(createFakeVendor({ session: DAY, clock: () => t }), { clock: () => t, key: "" });
  none.up.start(plainPlan(), none.handlers);
  await none.up.tick(t);
  deep([none.calls.length, none.errors[0].code], [0, "no-key"], "adapter: no key, no calls, and the reason is named");
  none.up.stop();

  t = SESSION_NOW;
  const tight = upstreamOf(createFakeVendor({ session: DAY, clock: () => t }), { clock: () => t, perMinute: 3 });
  tight.up.start(plainPlan(), tight.handlers);
  for (let i = 0; i < 4; i++) { await tight.up.tick(t); t += 1100; }
  ok(tight.calls.length <= 3, `adapter: the local budget caps vendor calls (${tight.calls.length} of 3 allowed)`);
  ok(tight.errors.some((e) => e.code === "budget"), "adapter: and a refused poll is reported as budget");
  tight.up.stop();

  t = SESSION_NOW;
  const partial = createFakeVendor({ session: DAY, clock: () => t });
  const realHandle = partial.handle.bind(partial);
  partial.handle = async (path, params) => (path.includes("sector-etfs") ? { status: 500, body: {} } : realHandle(path, params));
  const p = upstreamOf(partial, { clock: () => t });
  p.up.start({ ...plainPlan(), topics: new Set(["mk"]) }, p.handlers);
  await p.up.tick(SESSION_NOW + 600);
  deep([p.frames.length, p.errors.length, p.frames[0].meta.sectors.status, p.frames[0].meta.tide.status], [1, 0, "unavailable", "ok"], "adapter: one market feed failing still delivers the other, marking the silent one");
  p.up.stop();
}

const mkSocket = (user = "anilkaya", exp = Date.now() + 3600e3) => {
  const ws = {
    readyState: 1, att: null, closed: null, sent: [], user, exp,
    send(text) { ws.sent.push(JSON.parse(text)); },
    close(code, reason) { ws.closed = [code, reason]; ws.readyState = 3; },
    serializeAttachment(a) { ws.att = JSON.parse(JSON.stringify(a)); },
    deserializeAttachment() { return ws.att; },
  };
  return ws;
};

function rig({ start = SESSION_NOW, env = {}, roster = async () => null, vendorOver = null, scale = 1 } = {}) {
  const state = { t: start };
  const vendor = createFakeVendor({ session: DAY, clock: () => state.t });
  if (vendorOver) vendorOver(vendor);
  const sockets = [];
  const wakes = [];
  const logs = [];
  const hub = createHub({
    env: { FLOWS_RT_MODE: "on", UW_API_KEY: "k", UW_BASE: "http://uw.test", FLOWS_RT_SCALE: String(scale), ...env },
    now: () => state.t, fetchImpl: fetchFor(vendor), random: () => 0.5, log: (e) => logs.push(e),
    host: { sockets: () => sockets.filter((s) => s.readyState === 1), wake: (ms) => wakes.push(ms) },
    loadRoster: roster,
  });
  const join = (user = "anilkaya", opts = {}) => {
    const ws = mkSocket(user, opts.exp);
    sockets.push(ws);
    const admitted = hub.admit(ws, { u: user, exp: ws.exp, topics: opts.topics || TOPICS, f: opts.f || null });
    return { ws, admitted };
  };
  const run = async (seconds, step = 1000) => {
    for (let i = 0; i < seconds * 1000 / step; i++) { const d = await hub.tick(); state.t += step; if (d === null) return; }
  };
  return { hub, state, vendor, sockets, wakes, logs, join, run };
}

const dataOf = (ws, k) => ws.sent.filter((f) => f.k === k);
const ctlOf = (ws, t) => ws.sent.filter((f) => f.k === "ctl" && f.t === t);
const seqOk = (ws) => {
  const seq = RT.createSeq();
  const verdicts = {};
  for (const f of ws.sent) {
    if (f.k === "ctl") for (const inner of f.t === "hello" ? f.rows : []) seq.accept(inner);
    else {
      const v = seq.accept(f).verdict;
      verdicts[v] = (verdicts[v] || 0) + 1;
    }
  }
  return verdicts;
};

{
  const r = rig();
  await r.run(30);
  eq(r.vendor.calls.length, 0, "demand: with no socket and no snapshot request, thirty seconds of ticks make zero vendor calls");
  eq(await r.hub.tick(), null, "demand: and the tick says there is nothing to schedule");
  eq(r.hub.running, false, "demand: the hub is not running");

  const { ws, admitted } = r.join("anilkaya", { f: "NVDA" });
  eq(admitted, true, "a socket is admitted");
  eq(r.hub.running, true, "and starts the hub");
  const hello = ws.sent[0];
  deep([hello.k, hello.t, hello.sq, hello.meta.transport, hello.meta.upstream, hello.meta.cold], ["ctl", "hello", 0, "ws", "rest", true], "hello comes first: transport ws, upstream rest, cold");
  eq(hello.ep, r.hub.ep, "hello carries the epoch");
  deep(hello.rows.map((f) => f.k), TOPICS, "hello carries a snapshot frame per subscribed topic");
  ok(hello.rows.every((f) => f.snap === true && f.fresh.state === "pending" && f.sq === 0 && f.ep === hello.ep && RT.checkFrame(f).length === 0), "each is a clean pending snapshot while the hub is cold");
  await r.run(20);
  ok(r.vendor.calls.length > 0, "demand: a socket makes the hub poll");
  const verdicts = seqOk(ws);
  ok(!verdicts.gap && !verdicts.dup && !verdicts.orphan, `sequences are clean across five topics: ${JSON.stringify(verdicts)}`);
  for (const k of TOPICS) ok(dataOf(ws, k).length >= 1, `${k} frames flowed`);
  for (const k of TOPICS) {
    const frames = dataOf(ws, k);
    eq(frames[0].snap, true, `${k}: the first frame the socket sees is a snapshot, because it connected cold`);
    ok(frames.slice(1).every((f) => !f.snap), `${k}: and the rest are deltas`);
    deep(frames.map((f) => f.sq), frames.map((_, i) => frames[0].sq + i), `${k}: sq rises by one per frame`);
    ok(frames.every((f) => f.ep === hello.ep && RT.checkFrame(f).length === 0), `${k}: every frame is a clean envelope in the epoch`);
  }
  const cold = r.hub.counter.all();
  ok(cold.gx > cold.nw && cold.px > cold.nw, "per-topic counters advance at their own rates");

  const late = r.join("anilkaya");
  const lateHello = late.ws.sent[0];
  eq(lateHello.meta.cold, false, "a second socket joins a warm hub and is told so");
  for (const f of lateHello.rows) eq(f.sq, r.hub.counter.peek(f.k), `${f.k}: its snapshot is at the topic's current sq, so the next delta is the next number`);
  await r.run(12);
  const v2 = seqOk(late.ws);
  ok(!v2.gap && !v2.dup && !v2.orphan, `and its sequences are clean from the first delta: ${JSON.stringify(v2)}`);

  r.hub.onClose(ws);
  r.sockets.splice(r.sockets.indexOf(ws), 1);
  eq(r.hub.demand(r.state.t), true, "one socket left: still demanded");
  r.hub.onClose(late.ws);
  r.sockets.length = 0;
  eq(r.hub.demand(r.state.t), false, "no socket left: no demand");
  const before = r.vendor.calls.length;
  eq(await r.hub.tick(), null, "the next tick stops the hub");
  r.state.t += 30000;
  await r.run(30);
  eq(r.vendor.calls.length, before, "demand: after the last socket closes the vendor is not called again");
  eq(r.hub.running, false, "stopped");
  eq(r.hub.topics.fl.state.ring.length, 0, "and memory is released");
}

{
  const r = rig();
  const out = await r.hub.snap(["px", "mk"]);
  eq(out.frames.length, 2, "snap: two topics, two frames");
  ok(out.frames.every((f) => f.snap === true && RT.checkFrame(f).length === 0), "snap: clean snapshot envelopes");
  ok(r.wakes.length > 0, "snap: a request wakes the hub's alarm");
  eq(out.frames[0].fresh.state, "pending", "snap: the first request finds a cold hub and says pending, not a guess");
  await r.run(15);
  ok(r.vendor.calls.length > 0, "snap: and the hub polls for the next requests");
  deep(Array.from(new Set(r.vendor.calls.map((c) => c.path))).sort(), ["/api/market/market-tide", "/api/market/sector-etfs", "/api/screener/stocks"], "snap: only the topics a snapshot named are polled");
  const warm = await r.hub.snap(["px", "mk"]);
  ok(warm.frames.every((f) => f.fresh.state === "live"), "snap: warm, both are live");
  eq(warm.headers["X-Fresh-State"], "live", "snap: X-Fresh-State is the worst entry");
  eq(warm.headers["X-Fresh-Class"], "rt", "snap: X-Fresh-Class");
  ok(warm.headers["X-Server-Now"], "snap: X-Server-Now");
  const waiting = r.hub.snap(["fl", "nw"]);
  await r.run(2);
  const joined = await waiting;
  ok(joined.frames.every((f) => f.fresh.state === "live" && f.meta.cold !== true), "snap: a topic no one polled joins the demand and is answered once its first poll lands");
  const gxAt = Date.now();
  const cold = await r.hub.snap(["gx"]);
  ok(Date.now() - gxAt < 1000, `snap: gx with no focus answers at once, with nothing to wait for (${Date.now() - gxAt} ms)`);
  deep([cold.frames[0].k, cold.frames[0].meta.cold, cold.frames[0].fresh.state], ["gx", true, "pending"], "snap: and answers cold");
  const again = await r.hub.snap(["px", "mk", "fl", "gx", "nw"]);
  deep(again.frames.map((f) => f.k), ["px", "mk", "fl", "gx", "nw"], "snap: five topics in the order asked");
  ok(again.frames.every((f) => f.fresh.state === (f.k === "gx" ? "pending" : "live")), "snap: four warm topics are live and gx, with no focus to read, is pending");
  await r.run(5);
  eq(r.vendor.count(/spot-exposures/), 0, "snap: and a gx snapshot without a focus never calls the vendor");
  const calls = r.vendor.calls.length;
  await r.run(50);
  ok(r.vendor.calls.length > calls, "snap: polling continues inside the 60-second linger");
  await r.run(30);
  const settled = r.vendor.calls.length;
  await r.run(20);
  eq(r.vendor.calls.length, settled, "snap: and stops once the last request is 60 s old");
  eq(r.hub.running, false, "snap: the hub is stopped");
}

{
  const sat = easternInstant("2026-10-03", 11 * 60);
  const r = rig({ start: sat });
  const { ws } = r.join();
  await r.run(65);
  eq(r.vendor.calls.length, 0, "closed: a Saturday makes no vendor call");
  const closed = ctlOf(ws, "closed");
  eq(closed.length, 1, "closed: the socket is told once, on connect, and never again while the reason stands");
  deep([closed[0].meta.reason, closed[0].meta.phase], ["weekend", "closed"], "closed: reason weekend");
  eq(closed[0].meta.nextOpenAt, new Date(easternInstant("2026-10-05", 4 * 60)).toISOString(), "closed: the next open is Monday 04:00 ET");
  ok(closed[0].meta.nextRthOpenAt, "closed: and the regular open follows");
  ok(ctlOf(ws, "hb").length >= 1 && ctlOf(ws, "hb").length <= 3, `closed: a slow heartbeat (${ctlOf(ws, "hb").length} in 65 s)`);
  eq(ctlOf(ws, "hb")[0].meta.upstream, "closed", "closed: the heartbeat says why it is quiet");
  const d = await r.hub.tick();
  ok(d >= 1000 && d <= RT.RT_LIMITS.closedTickMs, `closed: the next alarm is at most ${RT.RT_LIMITS.closedTickMs / 1000} s away (${d} ms)`);
  r.state.t = easternInstant("2026-10-05", 4 * 60 + 1);
  await r.run(12);
  ok(r.vendor.calls.length > 0, "closed: Monday 04:01 ET the pre-market opens and the hub polls");
  const after = ws.sent.slice(-40).filter((f) => f.k === "px");
  ok(after.length > 0, "closed: and px frames flow");
  eq(after[0].fresh.klass, "rt", "closed: stream class in the pre-market");

  const night = rig({ start: at(20, 0, DAY) + 1000 });
  const n = night.join();
  await night.run(5);
  eq(night.vendor.calls.length, 0, "closed: 20:00:01 ET makes no vendor call");
  eq(ctlOf(n.ws, "closed")[0].meta.reason, "overnight", "closed: reason overnight");

  const hol = rig({ start: at(10, 0), roster: async () => ({ clock: { day: DAY, trading: 0, earlyClose: null, closedDays: [] }, boards: {}, focus: null }) });
  const h = hol.join();
  await hol.run(5);
  eq(hol.vendor.calls.length, 0, "closed: a day the clock row marks closed (a holiday the calendar did not know) makes no call");
  eq(ctlOf(h.ws, "closed")[0].meta.reason, "holiday", "closed: reason holiday");

  const pre = rig({ start: at(8, 0) });
  const p = pre.join();
  await pre.run(8);
  ok(pre.vendor.calls.length > 0, "extended hours: 08:00 ET polls");
  const px = dataOf(p.ws, "px").slice(-1)[0];
  deep([px.fresh.state, px.fresh.klass], ["live", "rt"], "extended hours: a fresh vendor stamp makes a pre-market frame live");
  const post = rig({ start: at(19, 55) });
  post.join();
  await post.run(8);
  ok(post.vendor.calls.length > 0, "extended hours: 19:55 ET polls");
  await post.run(400);
  const lastCalls = post.vendor.calls.length;
  await post.run(20);
  eq(post.vendor.calls.length, lastCalls, "extended hours: and after 20:00 ET it has stopped");
}

{
  const stamp = (r) => dataOf(r.ws, "px").slice(-1)[0];
  const lagged = rig({ vendorOver: (v) => { v.lagMs = 40000; } });
  const a = lagged.join();
  await lagged.run(8);
  deep([stamp(a).fresh.state, stamp(a).fresh.reason, stamp(a).fresh.liveUntil], ["fresh", "vendor-lag", null], "lag guard: a vendor 40 s behind makes the frame fresh with vendor-lag, though the hub read it a moment ago");
  const dead = rig({ vendorOver: (v) => { v.lagMs = 120000; } });
  const b = dead.join();
  await dead.run(8);
  deep([stamp(b).fresh.state, stamp(b).fresh.reason], ["stale", "vendor-lag"], "lag guard: two minutes behind is stale");
  const blank = rig({ vendorOver: (v) => { v.quoteStamps = false; } });
  const c = blank.join();
  await blank.run(8);
  deep([stamp(c).fresh.state, stamp(c).fresh.reason], ["fresh", "vendor-unstamped"], "lag guard: a vendor that stamps nothing cannot be called live");
  const good = rig();
  const d = good.join();
  await good.run(8);
  eq(stamp(d).fresh.state, "live", "lag guard: a vendor within 15 s is live");
  const lagS = good.hub.status().topics.px.rowLagMs;
  ok(lagS.n > 0 && lagS.p50 >= 0 && lagS.p95 <= 3000, `status: row lag p50 ${lagS.p50} ms, p95 ${lagS.p95} ms over ${lagS.n} rows`);
}

{
  const r = rig();
  const a = r.join();
  await r.run(10);
  r.vendor.fault = "500";
  await r.run(30);
  const deg = ctlOf(a.ws, "degraded");
  eq(deg.length >= 1, true, "degraded: a dead vendor is announced");
  eq(deg[0].meta.reason, "http_5xx", "degraded: with its reason");
  ok(deg[0].meta.k.includes("px"), "degraded: and the topics that are down");
  eq(deg.length, 1, "degraded: once per episode, not once per tick or per topic that joins it");
  const hbDown = ctlOf(a.ws, "hb").filter((f) => f.meta.upstream === "down");
  ok(hbDown.length > 0, "degraded: the heartbeat says the upstream is down");
  const sqBefore = r.hub.counter.peek("px");
  r.vendor.fault = null;
  const epBefore = r.hub.ep;
  await r.run(20);
  const rs = ctlOf(a.ws, "resync");
  ok(rs.length >= 1 && rs.some((f) => f.meta.reason === "recovered"), "recovery: a resync ctl follows the vendor's return");
  eq(r.hub.ep, epBefore, "recovery: the epoch is unchanged, because the hub never restarted");
  const snaps = dataOf(a.ws, "px").filter((f) => f.snap && f.sq > sqBefore);
  ok(snaps.length >= 1, "recovery: and a fresh snapshot follows with a higher sq");
  eq(r.hub.degraded, null, "recovery: the hub is no longer degraded");
  const v = seqOk(a.ws);
  ok(!v.gap && !v.dup && !v.orphan, `recovery: sequences stay clean through the outage: ${JSON.stringify(v)}`);

  const lim = rig({ vendorOver: (v) => { v.fault = "429"; v.retryAfterS = 20; } });
  const b = lim.join();
  await lim.run(4);
  const d429 = ctlOf(b.ws, "degraded");
  ok(d429.length >= 1 && d429[0].meta.reason === "vendor-throttled", "429: degraded at once, reason vendor-throttled");
  ok(d429[0].meta.retryAt, "429: with the instant the hub will try again");
  const calls = lim.vendor.calls.length;
  await lim.run(10);
  eq(lim.vendor.calls.length, calls, "429: no vendor call during the pause");
  eq(lim.hub.budget.used(lim.state.t) <= 6, true, "429: the pause cost a handful of calls, not a storm");
  lim.vendor.fault = null;
  lim.vendor.retryAfterS = null;
  await lim.run(60);
  eq(ctlOf(b.ws, "degraded").length, 1, "429: one degraded frame for the whole episode, not one per tick or per topic");
  ok(ctlOf(b.ws, "resync").some((f) => f.meta.reason === "recovered"), "429: and a resync once the vendor answers again");
  eq(lim.hub.degraded, null, "429: the episode ends");
  const scaled = rig({ scale: 0.2 });
  eq(scaled.hub.budget.perMinute, 1200, "the call budget is per real minute: a test that runs cadences five times faster is allowed five times the calls");
  eq(rig().hub.budget.perMinute, 240, "and 240 at production speed");
}

{
  const r = rig();
  const a = r.join();
  await r.run(8);
  const old = a.ws.sent.length;
  a.ws.closed = null;
  r.hub.onMessage(a.ws, JSON.stringify({ t: "sub", k: ["px"] }));
  eq(a.ws.sent.length, old, "sub: dropping four topics sends nothing: the one kept is already held");
  await r.run(12);
  const after = a.ws.sent.slice(old);
  deep(Array.from(new Set(after.filter((f) => f.k !== "ctl").map((f) => f.k))), ["px"], "sub: only px frames follow");
  r.hub.onMessage(a.ws, JSON.stringify({ t: "sub", k: ["px", "mk"] }));
  const added = a.ws.sent.slice(-1)[0];
  deep([added.k, added.snap, added.fresh.state], ["mk", true, "live"], "sub: adding a topic sends its snapshot at once");
  r.hub.onMessage(a.ws, JSON.stringify({ t: "sub", k: ["px", "mk"], f: "nvda" }));
  eq(a.ws.att.f, "NVDA", "sub: the focus ticker is kept in the attachment, which survives hibernation");
  await r.run(3);
  deep(r.hub.focus, ["NVDA"], "sub: and reaches the hub's focus set");
  r.vendor.calls.length = 0;
  await r.run(30);
  eq(r.vendor.count(/spot-exposures/), 0, "sub: a focus ticker on a socket that does not ask gx costs no gx call");
  ok(r.vendor.paramsOf(/screener/).every((p) => p.ticker.split(",").includes("NVDA")), "sub: and joins the px read");
  const n = a.ws.sent.length;
  r.state.t += 10000;
  r.hub.onMessage(a.ws, JSON.stringify({ t: "rs", k: "px" }));
  eq(a.ws.sent.length, n + 1, "rs: a resync request returns a snapshot");
  r.hub.onMessage(a.ws, JSON.stringify({ t: "rs", k: "px" }));
  eq(a.ws.sent.length, n + 1, "rs: a second inside two seconds is ignored");
  r.hub.onMessage(a.ws, JSON.stringify({ t: "rs", k: "fl" }));
  eq(a.ws.sent.length, n + 1, "rs: a topic the socket never subscribed to is ignored");

  const lag = r.join();
  await r.run(30);
  r.hub.onMessage(lag.ws, JSON.stringify({ t: "p", sq: { px: 0 } }));
  deep(lag.ws.closed, [RT.RT_CLOSE.laggard, "laggard"], "p: a client more than ten frames behind is closed with 4008");
  eq(ctlOf(lag.ws, "bye").slice(-1)[0].meta.code, 4008, "p: after a bye frame that says so");
  const keep = r.join();
  await r.run(2);
  r.hub.onMessage(keep.ws, JSON.stringify({ t: "p", sq: { px: r.hub.counter.peek("px") } }));
  eq(keep.ws.closed, null, "p: a client that is keeping up is left alone");

  for (const [name, payload] of [["binary", new ArrayBuffer(8)], ["not json", "{"], ["unknown type", JSON.stringify({ t: "zz" })], ["oversize", "x".repeat(300)], ["bad topic", JSON.stringify({ t: "sub", k: ["nope"] })]]) {
    const w = r.join();
    r.hub.onMessage(w.ws, payload);
    eq(w.ws.closed && w.ws.closed[0], RT.RT_CLOSE.tooBig, `invalid message (${name}) closes the socket with 1009`);
    r.hub.onClose(w.ws);
    r.sockets.splice(r.sockets.indexOf(w.ws), 1);
  }
  const flood = r.join();
  for (let i = 0; i < RT.RT_LIMITS.messageBurst + 2; i++) r.hub.onMessage(flood.ws, JSON.stringify({ t: "p", sq: { px: r.hub.counter.peek("px") } }));
  eq(flood.ws.closed && flood.ws.closed[0], RT.RT_CLOSE.policy, "a flood of valid messages is closed with 1008");

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) r.hub.onMessage(keep.ws, JSON.stringify({ t: "p", sq: { px: r.hub.counter.peek("px") } }));
  const perMsg = Number(process.hrtime.bigint() - t0) / 2000 / 1000;
  ok(perMsg < 200, `a client message costs ${perMsg.toFixed(1)} µs, constant in the number of sockets`);
}

{
  const r = rig({ start: at(10, 0) });
  const a = r.join("anilkaya", { topics: ["px"], f: "NVDA" });
  await r.run(60);
  const m = r.hub.budget.minute(r.state.t);
  deep([m.gx, m.fl, m.mk, m.nw], [0, 0, 0, 0], `demand: a px-only socket with a focus ticker, for 60 s, calls no gx, fl, mk or nw (${JSON.stringify(m)})`);
  ok(m.px >= 11 && m.px <= 13, `demand: and px about every 5 s (${m.px} calls)`);
  deep(Array.from(new Set(r.vendor.calls.map((c) => c.path))), ["/api/screener/stocks"], "demand: the only vendor route read is the screener");
  ok(r.vendor.paramsOf(/screener/).every((p) => p.ticker.split(",").includes("NVDA")), "demand: and the focus ticker still joins the px read");
  const st = r.hub.status();
  deep(Object.keys(st.topics), TOPICS.slice(), "status: still lists all five topics");
  deep(TOPICS.map((k) => st.topics[k].demanded), [true, false, false, false, false], "status: and says which are demanded");
  deep(Array.from(r.hub.plan.topics), ["px"], "demand: the plan's topics are the union of what sockets ask");
  r.hub.lastBroadcastAt = 0;
  r.hub.beat(r.state.t, false);
  deep(Object.keys(ctlOf(a.ws, "hb").slice(-1)[0].meta.topics), ["px"], "hb: a heartbeat speaks only for demanded topics");

  const fl0 = r.vendor.count(/flow-alerts/);
  r.hub.onMessage(a.ws, JSON.stringify({ t: "sub", k: ["px", "fl"], f: "NVDA" }));
  await r.run(1);
  eq(r.vendor.count(/flow-alerts/) - fl0, 1, "demand: a sub that adds fl polls fl at the next tick");
  ok(dataOf(a.ws, "fl").some((f) => f.rows.length > 0), "demand: and its rows reach the socket");

  const waiting = r.hub.snap(["mk"]);
  await r.run(1);
  const mkSnap = await waiting;
  ok(mkSnap.frames[0].rows.length > 0 && mkSnap.frames[0].meta.cold !== true && mkSnap.frames[0].fresh.state !== "pending", "demand: a /snap?k=mk adds mk and answers from its first poll");
  const mk0 = r.vendor.count(/market-tide/);
  await r.run(50);
  ok(r.vendor.count(/market-tide/) - mk0 >= 4, `demand: mk stays polled inside the snapshot's linger (${r.vendor.count(/market-tide/) - mk0} polls in 50 s)`);
  await r.run(15);
  const mk1 = r.vendor.count(/market-tide/);
  const px1 = r.vendor.count(/screener/);
  await r.run(30);
  eq(r.vendor.count(/market-tide/), mk1, "demand: and stops once the snapshot request is 60 s old");
  ok(r.vendor.count(/screener/) > px1 && r.hub.running, "demand: while the socket's own topics go on");
  eq(r.hub.status().topics.mk.demanded, false, "status: mk is no longer demanded");
}

{
  const r = rig({
    start: at(10, 0),
    vendorOver: (v) => {
      const inner = v.handle;
      v.handle = async (path, params) => (v.flDown && path === "/api/option-trades/flow-alerts" ? { status: 500, body: { error: "down" } } : inner(path, params));
    },
  });
  const a = r.join("anilkaya", { topics: ["px", "fl"] });
  await r.run(10);
  r.vendor.flDown = true;
  await r.run(30);
  deep(r.hub.degraded && r.hub.degraded.k, ["fl"], "drop: a failing fl alone holds the hub degraded");
  deep(ctlOf(a.ws, "degraded").slice(-1)[0].meta.k, ["fl"], "drop: and says so to the socket");
  const n = a.ws.sent.length;
  const flCalls = r.vendor.count(/flow-alerts/);
  r.hub.onMessage(a.ws, JSON.stringify({ t: "sub", k: ["px"] }));
  await r.run(1);
  eq(r.hub.degraded, null, "drop: dropping the failing topic ends the episode at the next tick");
  ok(a.ws.sent.slice(n).some((f) => f.k === "ctl" && f.t === "resync" && f.meta.reason === "recovered"), "drop: with the recovered control frame the client clears its banner on");
  deep([r.hub.topics.fl.fails, r.hub.topics.fl.lastError, r.hub.upstream.state().topics.fl.fails], [0, null, 0], "drop: its failures and last error are forgotten");
  await r.run(30);
  eq(r.hub.degraded, null, "drop: and the vendor still failing fl cannot bring it back");
  eq(r.vendor.count(/flow-alerts/), flCalls, "drop: because fl is no longer polled");
  eq(ctlOf(a.ws, "degraded").length, 1, "drop: one degraded frame in all");
  r.hub.lastBroadcastAt = 0;
  r.hub.beat(r.state.t, false);
  const hb = ctlOf(a.ws, "hb").slice(-1)[0];
  deep([Object.keys(hb.meta.topics), hb.meta.degraded, hb.meta.upstream], [["px"], null, "up"], "drop: the next heartbeat carries px alone, up, and no degraded episode");
}

{
  const r = rig({ start: at(10, 0) });
  r.join("anilkaya", { topics: ["gx"], f: "NVDA" });
  await r.run(60);
  const m = r.hub.budget.minute(r.state.t);
  ok(m.gx >= 3 && m.gx <= 5, `gx: one focus name is read about every 15 s (${m.gx} calls in a minute)`);
  eq(m.px + m.fl + m.mk + m.nw, 0, "gx: and a gx-only socket polls nothing else");
  deep(Array.from(new Set(r.vendor.calls.map((c) => c.path))), ["/api/stock/NVDA/spot-exposures"], "gx: only the focus ticker, no roster rotation");
  r.join("other.user", { topics: ["gx", "px"], f: "TSLA" });
  r.join("third.user", { topics: ["gx"], f: "AAPL" });
  r.join("fourth.user", { topics: ["gx"], f: "MSFT" });
  r.join("fifth.user", { topics: ["px"], f: "AMD" });
  await r.run(5);
  deep(r.hub.plan.gex().names, ["AAPL", "MSFT", "NVDA"], "gx: at most three focus names, and only those of sockets that ask gx");
  const from = r.state.t;
  await r.run(60);
  const recent = r.vendor.calls.filter((c) => c.at >= from && /spot-exposures/.test(c.path)).map((c) => c.path.split("/")[3]);
  const per = Object.fromEntries(["AAPL", "MSFT", "NVDA", "TSLA", "AMD"].map((t) => [t, recent.filter((x) => x === t).length]));
  ok(per.AAPL >= 3 && per.AAPL <= 5 && per.MSFT >= 3 && per.MSFT <= 5 && per.NVDA >= 3 && per.NVDA <= 5, `gx: each of the three is read about every 15 s (${JSON.stringify(per)})`);
  eq(per.TSLA + per.AMD, 0, "gx: a fourth gx name and a px-only focus cost no gx call");
}

{
  const r = rig({ env: { FLOWS_RT_USER_CAP: "3" } });
  const socks = [r.join("anilkaya"), r.join("anilkaya"), r.join("anilkaya")];
  ok(socks.every((s) => s.admitted), "cap: three sockets for one user");
  const fourth = r.join("anilkaya");
  eq(fourth.admitted, false, "cap: the fourth is refused");
  deep(fourth.ws.closed, [RT.RT_CLOSE.cap, "connection-cap"], "cap: with code 4009 and a reason");
  eq(ctlOf(fourth.ws, "bye")[0].meta.reason, "connection-cap", "cap: after a bye frame");
  eq(r.join("other.user").admitted, true, "cap: another user is unaffected");
  const expired = r.join("anilkaya", { exp: Date.now() - 1000 });
  eq(expired.admitted, false, "cap: and still over the cap");
  const r2 = rig();
  const e = r2.join("anilkaya", { exp: Date.now() + 1500 });
  await r2.run(2);
  eq(e.ws.closed, null, "expiry: a live session stays");
  await new Promise((res) => setTimeout(res, 1600));
  await r2.run(2);
  deep(e.ws.closed, [RT.RT_CLOSE.expired, "session-expired"], "expiry: a socket outliving its session is closed with 4001 at the next tick");
}

{
  const r = rig();
  const a = r.join();
  await r.run(6);
  const off = createHub({ env: { FLOWS_RT_MODE: "off", UW_API_KEY: "k" }, now: () => r.state.t, host: { sockets: () => [a.ws], wake() {} } });
  a.ws.readyState = 1;
  eq(await off.tick(), null, "kill switch: mode off ticks to nothing");
  deep(a.ws.closed, [RT.RT_CLOSE.off, "rt-off"], "kill switch: and closes every socket with 4011");
  for (const v of [undefined, "", "off", "OFF", "true", "1", "yes", "onn", null, 1]) eq(hubConfig({ FLOWS_RT_MODE: v }).mode, "off", `kill switch: ${JSON.stringify(v)} is off`);
  for (const v of ["on", "ON", " on ", "On"]) eq(hubConfig({ FLOWS_RT_MODE: v }).mode, "on", `kill switch: ${JSON.stringify(v)} is on`);
  for (const v of [undefined, "", "owner", "everyone", "public", "MEMBERS "]) {
    eq(hubConfig({ FLOWS_RT_AUDIENCE: v }).audience, v === "MEMBERS " ? "members" : "owner", `audience: ${JSON.stringify(v)} -> ${v === "MEMBERS " ? "members" : "owner"}`);
  }
  deep(RT.rtSwitches({}), { mode: "off", audience: "owner", users: ["anilkaya"], hint: null }, "switches: an empty environment is off, owner-only, and the owner is anilkaya");
  deep(RT.rtSwitches({ FLOWS_RT_USERS: "A_b, c.d ,x" }).users, ["a_b", "c.d"], "switches: FLOWS_RT_USERS is lower-cased and validated like member names");
  deep(RT.rtSwitches({ FLOWS_RT_USERS: "" }).users, [], "switches: an explicit empty list admits nobody");
  eq(RT.rtSwitches({ FLOWS_RT_HINT: "enam" }).hint, "enam", "switches: a valid location hint");
  eq(RT.rtSwitches({ FLOWS_RT_HINT: "mars" }).hint, null, "switches: an invalid one is dropped");
  ok(RT.rtAdmits(RT.rtSwitches({}), "anilkaya") && !RT.rtAdmits(RT.rtSwitches({}), "firatgok"), "owner audience admits the owner and refuses a member");
  ok(RT.rtAdmits(RT.rtSwitches({ FLOWS_RT_AUDIENCE: "members" }), "firatgok"), "members audience admits a member");
  ok(!RT.rtIsOwner(RT.rtSwitches({ FLOWS_RT_AUDIENCE: "members" }), "firatgok"), "but never makes a member the owner");
  eq(hubConfig({ UW_BASE: "http://x.test", UW_NOW: "2026-09-30T14:00:00Z", FLOWS_RT_SCALE: "0.2" }).scale, 0.2, "test scale: honoured only while UW_BASE redirects the vendor");
  eq(hubConfig({ UW_NOW: "2026-09-30T14:00:00Z", FLOWS_RT_SCALE: "0.2" }).scale, 1, "and ignored in production");
  ok(Number.isNaN(hubConfig({ UW_NOW: "2026-09-30T14:00:00Z" }).pinned), "a pinned clock is ignored in production too");
  const pinned = rtClock({ UW_BASE: "http://x.test", UW_NOW: "2026-09-30T14:00:00Z" });
  const p0 = pinned();
  await new Promise((res) => setTimeout(res, 30));
  ok(pinned() - p0 >= 20 && pinned() - p0 < 400, "a pinned clock advances with real time");
  eq(hubConfig({ UW_BASE: "http://x.test" }).base, "http://x.test", "UW_BASE redirects the vendor");
  eq(hubConfig({}).base, "https://api.unusualwhales.com", "and the default is production");
  eq(hubConfig({ FLOWS_RT_CALLS_PER_MIN: "5000" }).callsPerMinute, 1200, "the call budget is clamped");
  eq(hubConfig({}).callsPerMinute, 240, "240 calls a minute by default");
}

{
  const r = rig({ start: at(19, 58, "2026-09-29"), env: {} });
  const a = r.join();
  await r.run(5);
  const epBefore = r.hub.ep;
  const flBefore = r.hub.topics.fl.state;
  r.state.t = at(4, 1, DAY);
  await r.run(8);
  const rs = ctlOf(a.ws, "resync").filter((f) => f.meta.reason === "session");
  eq(rs.length, 1, "session: crossing into the next trading day sends one resync, reason session");
  ok(r.hub.ep > epBefore, "session: and the epoch changes, so every client discards what it holds");
  eq(r.hub.session, DAY, "session: the hub follows the new session day");
  ok(r.hub.topics.fl.state !== flBefore, "session: every topic's memory is rebuilt, so yesterday's alert ring and cursor cannot leak into today");
  ok(dataOf(a.ws, "px").filter((f) => f.ep === r.hub.ep && f.snap).length >= 1, "session: the new epoch opens with snapshots");
}

{
  const r = rig();
  const a = r.join();
  await r.run(10);
  const sentBefore = a.ws.sent.length;
  const woken = createHub({
    env: { FLOWS_RT_MODE: "on", UW_API_KEY: "k", UW_BASE: "http://uw.test" },
    now: () => r.state.t, fetchImpl: fetchFor(r.vendor), random: () => 0.5,
    host: { sockets: () => [a.ws], wake() {} }, loadRoster: async () => null,
  });
  const epOld = r.hub.ep;
  for (let i = 0; i < 6; i++) { await woken.tick(); r.state.t += 1000; }
  ok(woken.ep > epOld, "hibernation: a hub rebuilt around a surviving socket starts a new epoch");
  const fresh = a.ws.sent.slice(sentBefore);
  eq(fresh.filter((f) => f.k === "ctl" && f.t === "resync" && f.meta.reason === "restart").length, 1, "hibernation: and tells the socket to resync, reason restart");
  const snaps = fresh.filter((f) => f.snap && f.k !== "ctl");
  ok(snaps.length >= 4 && snaps.every((f) => f.ep === woken.ep), "hibernation: the first frame of each topic in the new epoch is a snapshot");
  eq(woken.sockState(a.ws).topics.size, 5, "hibernation: the subscriptions come back from the attachment");
}

{
  const writes = [];
  const reads = [];
  const db = new DatabaseSync(":memory:");
  db.exec(read("schema.sql"));
  const boards = fakeBoards({ n: 40, sessionDate: "2026-09-29", session: "2026-09-29" });
  const put = (id, payload) => db.prepare("INSERT INTO flows_payload (id, payload, updated_at) VALUES (?, ?, ?)").run(id, JSON.stringify(payload), 1);
  put("board:long", boards.long);
  put("board:short", boards.short);
  put("board:watch", boards.watch);
  put("focus", { sessionDate: "2026-09-29", groups: [
    { id: "gold", lead: "GLD", tickers: ["GLD", "GDX", "NEM"] }, { id: "mag7", tickers: ["AAPL", "MSFT", "NVDA"] },
  ], closes: { GLD: [100, 101, 102], NVDA: [500, 501, 502] } });
  db.prepare("INSERT INTO flows_clock (id, day, trading) VALUES (1, ?, 1)").run(DAY);
  const sqlD1 = {
    prepare(sql) {
      const st = { sql, args: [], bind(...a) { st.args = a; return st; } };
      return st;
    },
    batch: async (list) => {
      reads.push(list.map((s) => s.sql));
      return list.map((s) => {
        if (!/^\s*SELECT/i.test(s.sql)) writes.push(s.sql);
        return { results: db.prepare(s.sql).all(...s.args).map((x) => ({ ...x })) };
      });
    },
  };
  const loaded = await loadRosterFromD1({ DB: sqlD1 });
  eq(reads.length, 1, "roster: the whole read is one D1 round trip");
  eq(reads[0].length, 3, "roster: of three statements (the clock, the three boards, the focus groups)");
  deep(loaded.boards.long.rows.slice(0, 2), [{ t: "SYL001", s: 95, px: boards.long.rows[0].px }, { t: "SYL002", s: 94, px: boards.long.rows[1].px }], "roster: board rows come back as ticker, score and last close");
  eq(loaded.boards.long.sessionDate, "2026-09-29", "roster: with the board's session");
  eq(loaded.boards.watch.rows.length, 12, "roster: all three boards");
  deep(loaded.focus.closes.NVDA, 502, "roster: the focus closes are the last close per name");
  eq(loaded.clock.day, DAY, "roster: the clock row is normalised the way Tier 1 reads it");
  const rp = RT.rosterPlan({ long: loaded.boards.long.rows, short: loaded.boards.short.rows, watch: loaded.boards.watch.rows, focusPayload: { groups: loaded.focus.groups } });
  const ref = boardPlan({ long: { payload: boards.long }, short: { payload: boards.short }, watch: { payload: boards.watch } },
    { payload: { groups: loaded.focus.groups } });
  deep(rp.names, ref.names, "roster: the plan built from D1 is Tier 2's plan from the same payloads, focus names first after the indices");
  ok(rp.names.includes("NVDA") && rp.names.includes("GLD"), "roster: focus names are in");

  const r = rig({ start: at(10, 0), roster: (env) => loadRosterFromD1(env), env: { DB: sqlD1 } });
  const a = r.join();
  await r.run(10);
  const readsAfter = reads.length;
  eq(readsAfter, 2, "roster: the hub reads it once when it starts (plus the explicit read above)");
  const px = r.vendor.paramsOf(/screener/)[0].ticker.split(",");
  deep(px.slice(0, rp.names.length), rp.names, "roster: the first px call asks exactly the roster");
  await r.run(400);
  eq(reads.length - readsAfter, 1, "roster: and again after five minutes, not more often");
  eq(writes.length, 0, "no D1 write of any kind");
  const priorBase = r.hub.base;
  ok(priorBase && priorBase.date === "2026-09-29" && Object.hasOwn(priorBase.close, "NVDA"), "roster: the prior-close base for the day change comes from the focus closes");
  r.hub.onClose(a.ws);

  const broken = rig({ start: at(10, 0), roster: async () => { throw new Error("D1 down"); } });
  const b = broken.join();
  await broken.run(8);
  ok(broken.vendor.calls.length > 0, "roster: a D1 failure leaves the hub polling the constant roster");
  ok(broken.hub.rosterError && /D1 down/.test(broken.hub.rosterError.message), "roster: and says why in status");
  ok(broken.logs.length === 1, "roster: logged once, not every tick");
  void b;
}

{
  const boards = fakeBoards({ n: 60 });
  const good = { clock: null, boards: { long: { rows: boards.long.rows }, short: { rows: boards.short.rows }, watch: { rows: boards.watch.rows } }, focus: null };
  const baseNames = RT.rosterPlan({}).names;
  const fullNames = RT.rosterPlan({ long: boards.long.rows, short: boards.short.rows, watch: boards.watch.rows, focusPayload: null }).names;
  ok(baseNames.length >= 20 && fullNames.length >= baseNames.length + 20, `retry: the base roster (${baseNames.length}) and the boards' roster (${fullNames.length}) are told apart by their size`);
  const askedAt = (r, i) => r.vendor.paramsOf(/screener/).at(i).ticker.split(",");
  const callsSince = (r, n) => r.vendor.paramsOf(/screener/).slice(n).map((p) => p.ticker.split(",").length);

  {
    let reads = 0;
    const r = rig({ start: at(10, 0), roster: () => { reads++; return reads === 1 ? new Promise(() => {}) : Promise.resolve(good); } });
    const a = r.join();
    const t0 = r.state.t;
    await r.run(25);
    eq(reads, 1, "retry: a roster read that never answers is read once while the first thirty seconds run");
    ok(r.hub.rosterError && /roster timeout/.test(r.hub.rosterError.message), "retry: and the timeout is the stated reason");
    eq(r.hub.status().roster.n, baseNames.length, "retry: the hub holds the base names meanwhile");
    const early = r.vendor.paramsOf(/screener/);
    ok(early.length >= 4 && early.every((p) => p.ticker === baseNames.join(",")), `retry: every px poll of those thirty seconds asks the base names (${early.length} polls)`);
    await r.run(10);
    eq(r.state.t - t0, 35000, "retry: thirty-five seconds of fake time have passed");
    eq(reads, 2, "retry: the read is repeated about thirty seconds after the failure, not five minutes");
    eq(r.hub.rosterError, null, "retry: and the success clears the error");
    deep(askedAt(r, -1), fullNames, "retry: px then asks the boards' roster");
    eq(r.hub.status().roster.n, fullNames.length, "retry: status shows it");
    const seen = r.vendor.paramsOf(/screener/).length;
    await r.run(250);
    eq(reads, 2, "retry: after a success the five-minute cadence holds, no read in the next four minutes");
    ok(callsSince(r, seen).every((n) => n === fullNames.length), "retry: and every poll in them asks the boards' roster");
    await r.run(60);
    eq(reads, 3, "retry: the next read comes five minutes after the one that succeeded");
    r.hub.onClose(a.ws);
  }

  {
    let reads = 0;
    const r = rig({ start: at(10, 0), roster: () => { reads++; return reads === 1 ? Promise.reject(new Error("D1 down")) : Promise.resolve(good); } });
    r.join();
    await r.run(10);
    eq(reads, 1, "retry: a roster read that throws is not repeated inside thirty seconds");
    eq(r.hub.status().roster.n, baseNames.length, "retry: the base names meanwhile");
    await r.run(25);
    eq(reads, 2, "retry: it is repeated after thirty seconds");
    eq(r.hub.status().roster.n, fullNames.length, "retry: and the boards' roster replaces the base names");
  }

  {
    let reads = 0;
    const r = rig({ start: at(10, 0), roster: () => { reads++; return reads === 2 ? Promise.reject(new Error("D1 busy")) : Promise.resolve(good); } });
    r.join();
    await r.run(10);
    eq(reads, 1, "retry: a good first read");
    await r.run(300);
    eq(reads, 2, "retry: and its five-minute refresh is attempted");
    ok(r.hub.rosterError && /D1 busy/.test(r.hub.rosterError.message), "retry: a failed refresh says why");
    eq(r.hub.status().roster.n, fullNames.length, "retry: a failed refresh keeps the roster the hub holds");
    await r.run(40);
    eq(reads, 3, "retry: a failed refresh is repeated after thirty seconds, not five minutes");
    eq(r.hub.rosterError, null, "retry: and the error clears");
  }

  {
    let reads = 0;
    const r = rig({ start: at(10, 0), scale: 0.2, roster: () => { reads++; return reads === 1 ? Promise.reject(new Error("D1 down")) : Promise.resolve(good); } });
    r.join();
    await r.run(4);
    eq(reads, 1, "retry: at a test scale of 0.2 the retry has not fallen due after four seconds");
    await r.run(4);
    eq(reads, 2, "retry: and it has after eight, the thirty seconds scaled with every other cadence");
  }
}

{
  const r = rig({ start: at(10, 0) });
  const a = r.join("anilkaya", { f: "NVDA" });
  await r.run(2000, 1000);
  const st = r.hub.status();
  ok(st.topics.fl.held <= 200 && st.topics.nw.held <= 60 && st.topics.px.held <= 200 && st.topics.gx.held <= 64 && st.topics.mk.held <= 16, `memory: held rows stay bounded after 2000 ticks (${JSON.stringify(Object.fromEntries(Object.entries(st.topics).map(([k, v]) => [k, v.held])))})`);
  ok(r.hub.topics.fl.state.seen.size <= RT.RT_LIMITS.seenMax && r.hub.topics.nw.state.seen.size <= RT.RT_LIMITS.seenMax, "memory: dedupe memory stays bounded");
  ok(st.calls.minuteTotal <= 240, `calls: never more than the budget in a minute (${st.calls.minuteTotal})`);
  const perMin = st.topics;
  ok(perMin.px.calls.minute <= 13 && perMin.fl.calls.minute <= 13 && perMin.gx.calls.minute <= 5 && perMin.mk.calls.minute <= 14 && perMin.nw.calls.minute <= 3,
    `calls: a minute of calls by topic is px ${perMin.px.calls.minute}, fl ${perMin.fl.calls.minute}, gx ${perMin.gx.calls.minute}, mk ${perMin.mk.calls.minute} (two calls a poll), nw ${perMin.nw.calls.minute}`);
  const hour = Object.values(st.topics).reduce((n, t) => n + t.calls.hour, 0);
  ok(hour < 240 * 60, `calls: an hour of calls is ${hour}, under the 240 a minute ceiling`);
  eq(st.upstream.kind, "rest", "status: the upstream kind");
  eq(st.killSwitches.FLOWS_RT_MODE, "on", "status: the kill switches are readable");
  deep(st.sockets.byUser, { anilkaya: 1 }, "status: sockets by user");
  ok(st.topics.px.lagMs.n > 0 && st.topics.gx.lagMs.n > 0 && st.topics.mk.lagMs.n > 0, "status: vendor lag is sampled per topic");
  ok(st.topics.px.lastFrameAgeMs <= 5000, "status: last-frame age");
  ok(Object.values(st.topics).every((t) => t.sq === r.hub.counter.peek(Object.keys(st.topics).find((k) => st.topics[k] === t))), "status: per-topic sequence");
  eq(st.topics.px.lastError, null, "status: no error, no lastError");
  r.vendor.fault = "500";
  await r.run(20);
  const bad = r.hub.status();
  eq(bad.topics.px.lastError.code, "http_5xx", "status: the last upstream error per topic");
  ok(bad.degraded && bad.degraded.reason === "http_5xx", "status: and the degraded episode");
  void a;
}

{
  const state = { t: at(10, 0) };
  const gen = { t: at(10, 0) };
  const vendor = createFakeVendor({ session: DAY, clock: () => gen.t });
  const roster = fakeBoards({ n: 60 });
  const names = RT.rosterPlan({ long: roster.long.rows, short: roster.short.rows, watch: roster.watch.rows }).names;
  const bodies = new Map();
  const served = new Map();
  const stepOf = (path) => (path.includes("spot-exposures") ? 14000 : path.includes("news") ? 30000 : path.includes("market") ? 10000 : 5000);
  const cached = async (url) => {
    const u = new URL(String(url));
    const key = u.pathname + (u.pathname.includes("flow-alerts") ? "" : u.search);
    const n = served.get(key) || 0;
    served.set(key, n + 1);
    const slot = key + "#" + n;
    if (!bodies.has(slot)) {
      gen.t = at(10, 0) + n * stepOf(u.pathname);
      const out = await vendor.handle(u.pathname, Object.fromEntries(u.searchParams.entries()));
      bodies.set(slot, JSON.stringify(out.body));
    }
    return new Response(bodies.get(slot), { status: 200 });
  };
  const perTopic = {};
  const snapshots = {};
  for (const k of TOPICS) {
    const only = (o) => {
      const u = createRestUpstream(o);
      return { ...u, start: (p, h) => u.start({ ...p, topics: new Set([k]) }, h) };
    };
    const build = () => {
      const ws = mkSocket();
      const hub = new RtHub({
        env: { FLOWS_RT_MODE: "on", UW_API_KEY: "k", UW_BASE: "http://uw.test" }, now: () => state.t, random: () => 0.5,
        host: { sockets: () => [ws], wake() {} }, upstreamFactory: (o) => only({ ...o, fetchImpl: cached }),
        loadRoster: async () => ({ clock: null, boards: { long: { rows: roster.long.rows }, short: { rows: roster.short.rows }, watch: { rows: roster.watch.rows } }, focus: null }),
      });
      hub.admit(ws, { u: "anilkaya", exp: Date.now() + 3600e3, topics: [k], f: k === "gx" ? "NVDA" : null });
      return { ws, hub };
    };
    const step = RT.RT_TOPICS[k].cadenceMs;
    const WARM = 20;
    const MEASURED = 120;
    served.clear();
    state.t = at(10, 0);
    const prep = build();
    for (let i = 0; i < WARM + MEASURED; i++) { await prep.hub.tick(); state.t += step; }
    served.clear();
    state.t = at(10, 0);
    const { ws, hub } = build();
    for (let i = 0; i < WARM; i++) { await hub.tick(); state.t += step; }
    ws.sent.length = 0;
    const polls0 = hub.topics[k].polls;
    const start = cpuMs();
    for (let i = 0; i < MEASURED; i++) { await hub.tick(); state.t += step; }
    const cpu = cpuMs() - start;
    const polls = hub.topics[k].polls - polls0;
    const frames = ws.sent.filter((f) => f.k === k);
    const bytes = frames.reduce((n, f) => n + JSON.stringify(f).length, 0);
    perTopic[k] = { polls, cpu: cpu / Math.max(1, polls), bytes: bytes / Math.max(1, frames.length), rows: frames.reduce((n, f) => n + f.rows.length, 0) / Math.max(1, frames.length) };
    snapshots[k] = JSON.stringify(hub.snapshotFrame(k, state.t)).length;
  }
  ok(names.length >= 150, `measurement roster is ${names.length} names, near the 160 cap`);
  for (const k of TOPICS) {
    const m = perTopic[k];
    ok(m.polls >= 100, `${k}: measured over ${m.polls} polls`);
    ok(m.cpu < 25, `${k}: ${m.cpu.toFixed(2)} ms of CPU per poll (parse, shape, merge, serialise, send)`);
  }
  ok(perTopic.px.rows > 5, `px: the measured polls carry ${perTopic.px.rows.toFixed(0)} changed rows on average, so this is the busy path`);
  console.log("rt cpu per poll (ms): " + TOPICS.map((k) => `${k} ${perTopic[k].cpu.toFixed(2)}`).join(", "));
  console.log("rt bytes per delta frame: " + TOPICS.map((k) => `${k} ${Math.round(perTopic[k].bytes)} (${perTopic[k].rows.toFixed(1)} rows)`).join(", "));
  console.log("rt snapshot bytes: " + TOPICS.map((k) => `${k} ${snapshots[k]}`).join(", "));
  ok(snapshots.px < 64 * 1024, `px snapshot for ${names.length} names is ${snapshots.px} bytes, under 64 KiB`);
}

{
  const { serveRt } = await import("../shared/flows-rt-routes.js");
  class HttpError extends Error {
    constructor(status, code, message, headers) { super(message); Object.assign(this, { status, code, headers }); }
  }
  const json = (body, status = 200) => ({ status, body });
  const sameOrigin = (request) => {
    const origin = request.headers.get("Origin");
    if (origin !== null && new URL(origin).origin !== new URL(request.url).origin) throw new HttpError(403, "forbidden", "Same-origin request required");
  };
  const forwarded = [];
  const gets = [];
  const stub = {
    fetch: async (req) => {
      forwarded.push({ url: new URL(req.url), headers: Object.fromEntries(req.headers.entries()) });
      return new Response(JSON.stringify({ running: false, topics: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  };
  const ns = { idFromName: (n) => ({ n }), get: (id, opts) => { gets.push({ id, opts }); return stub; } };
  const on = { FLOWS_RT_MODE: "on", PULSE: ns, FLOWS_RT_USERS: "anilkaya", FLOWS_RT_HINT: "enam" };
  const owner = { username: "anilkaya", exp: 1790780000000 };
  const member = { username: "firatgok", exp: 1790780000000 };
  const call = async (path, { env = on, session = owner, headers = {}, method = "GET" } = {}) => {
    const request = new Request("https://anilkaya.org" + path, { method, headers });
    try {
      return await serveRt(request, env, new URL(request.url), { json, HttpError, getSession: async () => session, requireSameOrigin: sameOrigin });
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, code: error.code, headers: error.headers };
      throw error;
    }
  };
  const WS = { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==", "Sec-WebSocket-Version": "13" };

  for (const path of ["/api/rt/ws", "/api/rt/snap", "/api/rt/status"]) {
    for (const env of [{ ...on, FLOWS_RT_MODE: "off" }, { ...on, FLOWS_RT_MODE: undefined }, { ...on, FLOWS_RT_MODE: "true" }, { ...on, PULSE: undefined }, { ...on, PULSE: {} }]) {
      const r = await call(path, { env, session: null });
      deep([r.status, r.code], [404, "rt_off"], `${path}: off, unset, mistyped or without a binding answers 404 rt_off, even to an anonymous caller, and never throws`);
    }
    const anon = await call(path, { session: null, headers: path === "/api/rt/ws" ? WS : {} });
    deep([anon.status, anon.code], [401, "unauthorized"], `${path}: no session is 401`);
    const post = await call(path, { method: "POST" });
    deep([post.status, post.code, post.headers.Allow], [405, "method_not_allowed", "GET"], `${path}: POST is 405 with Allow`);
  }
  eq((await call("/api/rt/nope")).status, 404, "an unknown path under /api/rt/ is a 404");
  deep([(await call("/api/rt/ws", { session: member, headers: WS })).code, (await call("/api/rt/snap", { session: member })).code, (await call("/api/rt/status", { session: member })).code],
    ["rt_forbidden", "rt_forbidden", "forbidden"], "audience owner: a member is refused on all three routes");
  eq((await call("/api/rt/ws", { headers: {} })).status, 426, "a GET without Upgrade is 426");
  eq((await call("/api/rt/ws", { headers: { ...WS, Origin: "https://evil.example" } })).status, 403, "a cross-origin upgrade is 403");
  eq((await call("/api/rt/ws", { headers: { ...WS, Origin: "https://anilkaya.org" } })).status, 200, "a same-origin upgrade is forwarded");
  eq((await call("/api/rt/ws?f=no%20way", { headers: WS })).status, 400, "a bad focus ticker is 400 before the object is touched");
  eq((await call("/api/rt/ws?k=zz", { headers: WS })).code, "invalid_topic", "an unknown topic is refused");
  eq((await call("/api/rt/snap?k=px,zz")).status, 400, "and on snap");

  forwarded.length = 0;
  gets.length = 0;
  await call("/api/rt/ws?k=px,mk&f=nvda", { headers: { ...WS, Cookie: "flows_session=secret", "X-RT-User": "spoof", "x-rt-exp": "9", Authorization: "Bearer x" } });
  const fw = forwarded[0];
  eq(fw.url.pathname, "/ws", "ws: forwarded to the object's /ws");
  deep([fw.url.searchParams.get("k"), fw.url.searchParams.get("f")], ["px,mk", "NVDA"], "ws: topics and focus are passed validated and normalised");
  deep([fw.headers["x-rt-user"], fw.headers["x-rt-exp"]], ["anilkaya", "1790780000000"], "ws: the verified user and expiry replace anything the client sent");
  eq(fw.headers.cookie, undefined, "ws: the cookie never reaches the object");
  eq(fw.headers.upgrade, "websocket", "ws: the upgrade headers do");
  deep(gets[0], { id: { n: RT.RT_OBJECT_NAME }, opts: { locationHint: "enam" } }, "ws: one named object, with the location hint");
  await call("/api/rt/snap?k=px,fl");
  eq(forwarded[1].url.pathname + forwarded[1].url.search, "/snap?k=px%2Cfl", "snap: forwarded with its topics");
  await call("/api/rt/snap");
  eq(forwarded[2].url.searchParams.get("k"), TOPICS.join(","), "snap: all five by default");
  const st = await call("/api/rt/status");
  deep([st.status, st.body.running, st.body.worker], [200, false, { mode: "on", audience: "owner", users: ["anilkaya"], hint: "enam", binding: true }], "status: the object's view plus the Worker's switches");
  const members = { ...on, FLOWS_RT_AUDIENCE: "members" };
  eq((await call("/api/rt/ws", { env: members, session: member, headers: WS })).status, 200, "audience members: a member connects");
  eq((await call("/api/rt/snap", { env: members, session: member })).status, 200, "and reads the snapshot");
  eq((await call("/api/rt/status", { env: members, session: member })).status, 403, "but status stays owner-only");
  eq((await call("/api/rt/status", { env: { ...on, FLOWS_RT_USERS: "" }, session: owner })).status, 403, "and an empty owner list admits nobody, the owner included");
  eq((await call("/api/rt/snap", { env: { ...on, FLOWS_RT_AUDIENCE: "public" }, session: member })).status, 403, "an unknown audience word falls back to owner");
  const broken = { ...on, PULSE: { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error("overloaded"); } }) } };
  deep([(await call("/api/rt/snap", { env: broken })).status, (await call("/api/rt/snap", { env: broken })).code], [503, "rt_unavailable"], "an object that throws is a 503, not a 500");
}

{
  deep(Object.fromEntries(TOPICS.map((k) => [k, RT.RT_UPSTREAM[k].channels])), {
    px: ["price:<T>", "stock_screener"], fl: ["flow-alerts"], gx: ["gex:<T>"], mk: ["market_tide", "net_flow:<T>"], nw: ["news"],
  }, "seam: one table maps each topic to the vendor channels a socket upstream would join");
  deep(Object.fromEntries(TOPICS.map((k) => [k, RT.RT_UPSTREAM[k].scope])), { px: "ticker", fl: "global", gx: "ticker", mk: "global", nw: "global" }, "seam: and says which are per-ticker");
  ok(Object.isFrozen(RT.RT_UPSTREAM) && TOPICS.every((k) => Object.isFrozen(RT.RT_UPSTREAM[k]) && typeof RT.RT_UPSTREAM[k].rest === "function"), "seam: frozen, each with its REST request builder beside its channels");
  deep(RT.RT_UPSTREAM.px.rest({ names: ["A", "B"] }).map((c) => [c.path, c.params.ticker, c.params.limit]), [["/api/screener/stocks", "A,B", 500]], "seam: px REST request");
  deep(RT.RT_UPSTREAM.mk.rest().map((c) => c.path), TIER1_CALLS.map((c) => c.path), "seam: mk REST requests are Tier 1's");
  deep(RT.RT_UPSTREAM_API.methods, ["start(plan, handlers)", "stop()", "tick(now)", "paused(now)", "state()"], "seam: the adapter's method list is part of the contract");
  deep(RT.RT_UPSTREAM_API.frame, ["k", "readAt", "items", "vendorAt", "meta", "full", "answered"], "seam: and so is the neutral frame");

  const rest = createRestUpstream({ cfg: hubConfig({ UW_BASE: "http://x.test", UW_API_KEY: "k" }), budget: RT.createBudget() });
  deep(["kind", "start", "stop", "tick", "paused", "state"].filter((m) => !(m in rest)), [], "seam: the REST adapter implements every method of the interface");

  const live = Object.keys(RT.RT_REST_SHAPE);
  deep(live, TOPICS, "seam: a REST shaper per topic turns a vendor body into the neutral frame");

  const src = read("shared/flows-rt-hub.js");
  const hubBody = src.slice(src.indexOf("export class RtHub"), src.indexOf("export function createHub"));
  for (const token of ["fetch", "/api/", "newer_than", "Authorization", "Retry-After", "http_4", "http_5", "cfg.base", "cfg.key", "interval_5m", "up.raw", "screener", "spot-exposures"]) {
    ok(!hubBody.includes(token), `seam: the hub never mentions '${token}': nothing REST leaks into it`);
  }
  const pulseBody = src.slice(src.indexOf("export class Pulse"));
  ok(!/\bfetchImpl\b|\/api\//.test(pulseBody), "seam: nor does the Durable Object class beyond its own request routes");

  const pushed = { handlers: null, started: 0, stopped: 0, plan: null };
  const pushUpstream = () => ({
    kind: "push",
    start(plan, handlers) { pushed.handlers = handlers; pushed.plan = plan; pushed.started++; },
    stop() { pushed.stopped++; },
    async tick() {},
    paused: () => false,
    state: () => ({ running: true }),
  });
  const state = { t: SESSION_NOW };
  const sockets = [];
  const hub = new RtHub({
    env: { FLOWS_RT_MODE: "on" }, now: () => state.t, upstreamFactory: pushUpstream,
    host: { sockets: () => sockets, wake() {} }, loadRoster: async () => null,
  });
  const ws = mkSocket();
  sockets.push(ws);
  hub.admit(ws, { u: "anilkaya", exp: Date.now() + 3600e3, f: "NVDA" });
  await hub.tick();
  eq(pushed.started, 1, "seam: a push upstream is started once with the plan");
  deep(Object.keys(pushed.plan).sort(), ["base", "gex", "names", "ready", "session", "stage", "topics"], "seam: the plan is the contract's");
  ok(pushed.plan.ready() && pushed.plan.session() === DAY && pushed.plan.names().length >= 25, "seam: the plan answers without any REST state");
  deep([Array.from(pushed.plan.topics), pushed.plan.gex().names], [TOPICS.slice(), ["NVDA"]], "seam: the plan's topics are the demanded ones and gx names only the focus ticker");
  const names = pushed.plan.names();
  const row = (t, qt, px) => [t, qt, px, 100, 0.01, ...new Array(RT.RT_ROW_FIELDS.px.length - 5).fill(null)];
  state.t += 1000;
  pushed.handlers.onFrame({
    k: "px", readAt: state.t, items: [row(names[0], state.t - 500, 101.5), row(names[1], state.t - 900, 55.25), row("NOTINROSTER", state.t, 1)],
    vendorAt: state.t - 500, meta: { status: "ok" }, full: {}, answered: true,
  });
  const px1 = ws.sent.filter((f) => f.k === "px").slice(-1)[0];
  deep([px1.snap, px1.rows.length, px1.rows.find((r) => r[0] === names[0])[2], px1.fresh.state], [true, 2, 101.5, "live"], "seam: a pushed px frame is merged, bounded to the roster, and broadcast with a lag-guarded freshness");
  state.t += 1000;
  pushed.handlers.onFrame({ k: "px", readAt: state.t, items: [row(names[0], state.t - 400, 102.25)], vendorAt: state.t - 400, meta: { status: "ok" }, full: {}, answered: true });
  pushed.handlers.onFrame({ k: "px", readAt: state.t, items: [row(names[0], state.t - 5000, 90)], vendorAt: state.t - 400, meta: { status: "ok" }, full: {}, answered: true });
  const px2 = ws.sent.filter((f) => f.k === "px").slice(-2);
  deep([px2[0].snap, px2[0].rows.map((r) => r[2]), px2[1].rows.length], [undefined, [102.25], 0], "seam: the hub's latest-wins rule, not the upstream's, drops the older quote that arrives after a newer one");
  deep(px2.map((f) => f.sq), [px2[0].sq, px2[0].sq + 1], "seam: one sequence number per delivered frame");
  const alert = (i) => ({ ...hubAlertRow(i), id: "w" + i, ts: state.t + i });
  function hubAlertRow(i) { return { t: "NVDA", oc: "NVDA260930C00100000", cp: "C", k: 100, exp: DAY, prem: 1000 * i, size: 1, trades: 1, askPrem: null, bidPrem: null, sweep: null, floor: null, single: null, opening: null, oi: null, voi: null, ivStart: null, ivEnd: null, px: 100, spanStart: null, spanEnd: null, rule: null, st: null }; }
  pushed.handlers.onFrame({ k: "fl", readAt: state.t, items: [alert(3), alert(1), alert(2)], vendorAt: null, meta: { cursor: "c1", read: 3, unusable: 0 }, full: {}, answered: true });
  pushed.handlers.onFrame({ k: "fl", readAt: state.t, items: [alert(2), alert(4)], vendorAt: null, meta: { cursor: "c2", read: 2, unusable: 0 }, full: {}, answered: true });
  const fls = ws.sent.filter((f) => f.k === "fl");
  deep(fls[0].rows.map((r) => r.id), ["w1", "w2", "w3"], "seam: pushed alerts arrive ascending by time whatever order the upstream delivered them");
  deep(fls[1].rows.map((r) => r.id), ["w4"], "seam: and the hub dedupes by alert id across frames");
  eq(fls[1].meta.cursor, "c2", "seam: an upstream's own cursor is passed through opaquely");
  pushed.handlers.onError({ k: "px", at: state.t, code: "closed", status: null });
  eq(hub.topics.px.fails, 1, "seam: an upstream error is counted against the topic");
  pushed.handlers.onFrame({ k: "mk", readAt: state.t, items: [], vendorAt: null, meta: {}, full: {}, answered: false });
  eq(hub.topics.mk.hasData, false, "seam: an unanswered frame is a failure, not data");
  hub.onClose(ws);
  sockets.length = 0;
  await hub.tick();
  eq(pushed.stopped >= 2, true, "seam: with no demand the hub stops the upstream");
  void names;
}

{
  const { Pulse } = await import("../shared/flows-rt-hub.js");
  const env = { FLOWS_RT_MODE: "on", UW_API_KEY: "k", UW_BASE: "http://uw.test", UW_NOW: "2026-09-30T14:00:00Z", FLOWS_RT_SCALE: "0.2" };
  const sockets = [];
  const alarms = [];
  let deleted = 0;
  let autoResponse = 0;
  const ctx = {
    getWebSockets: () => sockets.filter((x) => x.readyState === 1),
    setWebSocketAutoResponse: () => { autoResponse++; },
    storage: {
      getAlarm: async () => (alarms.length ? alarms[alarms.length - 1] : null),
      setAlarm: async (t) => { alarms.push(t); },
      deleteAlarm: async () => { deleted++; alarms.length = 0; },
    },
  };
  globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.request = a; this.response = b; } };
  const clockOf = rtClock(env);
  const offset = clockOf() - Date.now();
  const vendor = createFakeVendor({ session: DAY, clock: () => Date.now() + offset });
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchFor(vendor);
  try {
    const pulse = new Pulse(ctx, env);
    eq(autoResponse, 1, "pulse: the ping/pong auto-response is installed, so liveness costs no wake-up");
    eq(alarms.length, 0, "pulse: constructed with no socket it sets no alarm");
    const ws = mkSocket();
    sockets.push(ws);
    ok(pulse.hub.admit(ws, { u: "anilkaya", exp: Date.now() + 3600e3 }), "pulse: a socket is admitted");
    await pulse.arm(10);
    eq(alarms.length, 1, "pulse: and arms exactly one alarm");
    await pulse.arm(5000);
    eq(alarms.length, 1, "pulse: a later wish does not push the alarm back");
    for (let i = 0; i < 16; i++) {
      await pulse.alarm();
      await new Promise((r) => setTimeout(r, 220));
    }
    ok(alarms.length > 1, "pulse: every alarm sets the next one");
    const next = alarms[alarms.length - 1] - Date.now();
    ok(next > -400 && next < 1500, `pulse: about a tick ahead (${next} ms at scale 0.2)`);
    ok(dataOf(ws, "px").length >= 2 && dataOf(ws, "fl").length >= 2, "pulse: alarms drive the polls and the frames reach the socket");
    eq(vendor.count(/spot-exposures/), 0, "pulse: a socket with no focus ticker costs no gx call");

    const snap = await pulse.fetch(new Request("https://pulse.internal/snap?k=px,fl"));
    const frames = await snap.json();
    deep([snap.status, snap.headers.get("cache-control"), snap.headers.get("x-fresh-source"), frames.map((f) => f.k)], [200, "no-store", "hub", ["px", "fl"]], "pulse: /snap answers the envelopes with X-Fresh headers");
    const st = await (await pulse.fetch(new Request("https://pulse.internal/status"))).json();
    deep([st.running, st.sockets.n, st.topics.px.hasData], [true, 1, true], "pulse: /status is the hub's status");
    eq((await pulse.fetch(new Request("https://pulse.internal/nope"))).status, 404, "pulse: an unknown path is 404");
    eq((await pulse.fetch(new Request("https://pulse.internal/ws"))).status, 426, "pulse: /ws without an Upgrade header is 426");
    eq((await pulse.fetch(new Request("https://pulse.internal/ws", { headers: { Upgrade: "websocket" } }))).status, 401, "pulse: and without the Worker's verified user it is 401");

    pulse.webSocketMessage(ws, JSON.stringify({ t: "p", sq: { px: pulse.hub.counter.peek("px") } }));
    eq(ws.closed, null, "pulse: a good message is accepted");
    const bad = mkSocket();
    sockets.push(bad);
    pulse.hub.admit(bad, { u: "anilkaya", exp: Date.now() + 3600e3 });
    pulse.webSocketMessage(bad, "x".repeat(300));
    eq(bad.closed && bad.closed[0], 1009, "pulse: a bad message closes with 1009");
    pulse.webSocketClose(bad, 1009);
    eq(pulse.hub.running, true, "pulse: one socket closing leaves the hub running for the other");
    ws.readyState = 3;
    const before = deleted;
    pulse.webSocketClose(ws, 1005);
    eq(pulse.hub.running, true, "pulse: the last socket closing does not stop a hub a snapshot reader asked for less than a minute ago");
    pulse.hub.lastSnapAt = -Infinity;
    pulse.release();
    eq(pulse.hub.running, false, "pulse: with no snapshot reader either, it stops");
    eq(deleted, before + 1, "pulse: and deletes the alarm, so nothing wakes an idle object");
    const calls = vendor.calls.length;
    await pulse.alarm();
    eq(vendor.calls.length, calls, "pulse: a stray alarm after that polls nothing and sets no new one");
    eq(alarms.length, 0, "pulse: no alarm left");

    const survivor = mkSocket();
    sockets.push(survivor);
    survivor.att = { u: "anilkaya", exp: Date.now() + 3600e3, k: ["px", "mk"], f: "AAPL" };
    const woken = new Pulse(ctx, env);
    await new Promise((r) => setTimeout(r, 10));
    eq(alarms.length, 1, "pulse: an object that wakes with a surviving socket arms its alarm at once");
    await woken.alarm();
    eq(survivor.sent.filter((f) => f.k === "ctl" && f.t === "resync").length, 1, "pulse: and tells the survivor to resync");
    deep(Array.from(woken.hub.sockState(survivor).topics), ["px", "mk"], "pulse: the survivor's topics and focus come back from its attachment");
    eq(woken.hub.sockState(survivor).f, "AAPL", "pulse: its focus ticker too");
    woken.webSocketError(survivor);
    eq(woken.hub.running, false, "pulse: a socket error is a close");

    const off = new Pulse(ctx, { ...env, FLOWS_RT_MODE: "off" });
    const gone = await off.fetch(new Request("https://pulse.internal/status"));
    deep([gone.status, (await gone.json()).error.code], [404, "rt_off"], "pulse: with the switch off the object answers 404 rt_off");
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.WebSocketRequestResponsePair;
  }
}

{
  const PROD = "https://api.unusualwhales.com";
  const allowed = [
    ["https://api.unusualwhales.com", PROD, "default"],
    ["https://api.unusualwhales.com/", PROD, "default"],
    ["https://api.unusualwhales.com:443", PROD, "default"],
    ["http://127.0.0.1:8787", "http://127.0.0.1:8787", "redirect"],
    ["https://127.0.0.1:8787", "https://127.0.0.1:8787", "redirect"],
    ["http://127.0.0.1", "http://127.0.0.1", "redirect"],
    ["http://localhost:3000", "http://localhost:3000", "redirect"],
    ["http://uw.test", "http://uw.test", "redirect"],
    ["https://uw.test", "https://uw.test", "redirect"],
    ["http://vendor.test/", "http://vendor.test", "redirect"],
    ["http://a.b.test:9000", "http://a.b.test:9000", "redirect"],
  ];
  for (const [raw, base, status] of allowed) {
    deep(vendorBaseInfo(raw), { base, status }, `vendor base: ${raw} is ${status}`);
  }
  const refused = [
    "https://evil.example", "http://evil.example", "https://api.unusualwhales.com.evil.example", "http://api.unusualwhales.com",
    "https://evil.example/api.unusualwhales.com", "https://api.unusualwhales.com@evil.example", "https://user:pw@api.unusualwhales.com",
    "http://127.0.0.1@evil.example", "http://127.0.0.1.evil.example", "http://localhost.evil.example", "http://test", "http://uw.test.evil.example",
    "http://evil.example/uw.test", "http://uw.test/x", "http://uw.test?x=1", "http://uw.test#x", "ftp://uw.test", "file:///etc/passwd", "javascript:alert(1)",
    "//uw.test", "uw.test", " http://uw.test", "http://uw.test ", "http://[::1]:8787", "http://0.0.0.0:8787", "http://169.254.169.254", "http://10.0.0.1",
    "http://uw.TEST.evil.example", "http://xn--uw.test.evil", "https://api.unusualwhales.com/api", "http://" + "a".repeat(250) + ".test", 12, {}, [], true,
  ];
  for (const raw of refused) {
    deep(vendorBaseInfo(raw), { base: PROD, status: "invalid" }, `vendor base: ${JSON.stringify(raw).slice(0, 60)} is ignored and reported invalid`);
  }
  for (const raw of [undefined, null, ""]) deep(vendorBaseInfo(raw), { base: PROD, status: "unset" }, `vendor base: ${JSON.stringify(raw)} is unset`);
  eq(vendorBase({ UW_BASE: "https://evil.example" }), PROD, "vendorBase: a refused base is the default");
  eq(vendorBase({}), VENDOR_BASE_DEFAULT, "vendorBase: no env var is the default");
  eq(vendorBase(undefined), VENDOR_BASE_DEFAULT, "vendorBase: no env is the default");
  ok(vendorRedirected({ UW_BASE: "http://uw.test" }) && !vendorRedirected({ UW_BASE: PROD }) && !vendorRedirected({ UW_BASE: "https://evil.example" }) && !vendorRedirected({}),
    "vendorRedirected: only a loopback or .test base redirects");
  const evil = hubConfig({ UW_BASE: "https://evil.example", UW_API_KEY: "k", UW_NOW: "2026-09-30T14:00:00Z", FLOWS_RT_SCALE: "0.2" });
  eq(evil.base, PROD, "hub: a hostile UW_BASE leaves the vendor at production");
  eq(evil.redirected, false, "hub: and does not count as a redirect");
  eq(evil.scale, 1, "hub: so it does not unlock the test scale");
  ok(Number.isNaN(evil.pinned), "hub: nor the pinned clock");
  eq(evil.baseStatus, "invalid", "hub: and is reported invalid");
  eq(hubConfig({ UW_BASE: PROD, FLOWS_RT_SCALE: "0.2" }).scale, 1, "hub: the production URL spelled out does not unlock the test scale either");
  const upstreamBase = (e) => createRestUpstream({ cfg: hubConfig({ UW_API_KEY: "k", ...e }), budget: RT.createBudget() }).state().base;
  eq(upstreamBase({ UW_BASE: "https://evil.example" }), "invalid", "upstream: the rail reports the refused base");
  eq(upstreamBase({}), "production", "upstream: production when none is set");
  eq(upstreamBase({ UW_BASE: "http://uw.test" }), "redirected", "upstream: redirected for a test base");
  eq(vendorUrl("http://uw.test", "/api/x", { a: 1, b: "", c: null, d: undefined, e: "z y" }).href, "http://uw.test/api/x?a=1&e=z+y", "vendorUrl: drops empty parameters and encodes the rest");
  eq(vendorUrl(PROD, "/api/x").href, PROD + "/api/x", "vendorUrl: no parameters");
  deep(vendorUnwrap({ data: [1] }), [1], "unwrap: the data envelope around an array");
  deep(vendorUnwrap({ data: { a: 1 } }), { a: 1 }, "unwrap: the data envelope around an object");
  deep(vendorUnwrap({ data: "x" }), { data: "x" }, "unwrap: a scalar payload is left whole");
  deep(vendorUnwrap([1]), [1], "unwrap: a bare array is left whole");
  eq(vendorUnwrap(null), null, "unwrap: null");
  deep([200, 204, 301, 400, 404, 429, 500, 503].map(classifyStatus), [null, null, "http_4xx", "http_4xx", "http_4xx", "http_429", "http_5xx", "http_5xx"], "classify: status to the rail's codes");
  deep(["7", "0", "", "  ", "abc", undefined].map((v) => vendorRetryAfterMs(v, 0)), [7000, 0, null, null, null, null], "retryAfterMs: seconds");
  eq(vendorRetryAfterMs("Thu, 01 Jan 1970 00:00:09 GMT", 4000), 5000, "retryAfterMs: an HTTP date is a delay from now");
  eq(vendorRetryAfterMs("Thu, 01 Jan 1970 00:00:01 GMT", 4000), 0, "retryAfterMs: a date in the past is zero");
}

{
  const files = ["shared/flows-rt.js", "shared/flows-rt-hub.js", "shared/flows-rt-routes.js", "tests/rt-fixtures.mjs", "tests/flows-rt-contract.mjs", "tests/flows-rt-server.mjs"];
  for (const f of files) {
    let src = "";
    try { src = read(f); } catch { continue; }
    const lines = src.split("\n");
    const commented = lines.filter((l) => /^\s*\/\//.test(l) || /\/\*/.test(l));
    eq(commented.length, 0, `${f}: no comment lines (the repository carries none)`);
  }
  for (const f of ["shared/flows-rt.js", "shared/flows-rt-hub.js", "shared/flows-rt-routes.js"]) {
    const src = read(f);
    ok(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/.test(src.replace(/Update/g, "")), `${f}: no SQL that writes`);
    ok(!/env\.AI\b|\.run\(/.test(src), `${f}: no model call and no D1 run()`);
    ok(!/UW_ONDEMAND/.test(src), `${f}: the on-demand rate limit is never consumed`);
    ok(!/console\.(log|warn|info|debug)/.test(src), `${f}: no chatter; only structured errors`);
  }
  eq(expect(moduleSource("worker.js"), /export \{ Pulse \} from "\.\/shared\/flows-rt-hub\.js"/, { min: 1, max: 1 }), 1, "worker.js, the entry, exports the Pulse class");
  ok(expect(workerSource(), /path\.startsWith\("\/api\/rt\/"\)/, { min: 1 }) >= 1, "the Worker routes /api/rt/ inside route(), so the finalizer sees every response");
  const toml = read("wrangler.toml");
  ok(/\[\[durable_objects\.bindings\]\]\nname = "PULSE"\nclass_name = "Pulse"/.test(toml), "wrangler.toml binds PULSE to Pulse");
  ok(/\[\[migrations\]\]\ntag = "v1"\nnew_sqlite_classes = \["Pulse"\]/.test(toml), "wrangler.toml declares the SQLite-backed class migration");
  ok(/FLOWS_RT_MODE = "on"/.test(toml) && /FLOWS_RT_AUDIENCE = "members"/.test(toml), "wrangler.toml: mode on, audience members");
  const shippedEnv = Object.fromEntries(["FLOWS_RT_MODE", "FLOWS_RT_AUDIENCE", "FLOWS_RT_USERS", "FLOWS_RT_HINT"].map((k) => [k, new RegExp("^" + k + ' = "([^"]*)"$', "m").exec(toml)?.[1]]));
  const shipped = RT.rtSwitches(shippedEnv);
  deep([shipped.mode, shipped.audience, shipped.users, shipped.hint], ["on", "members", ["anilkaya"], "enam"], "wrangler.toml: the Worker reads mode on, audience members, owner anilkaya, hint enam");
  ok(RT.rtAdmits(shipped, "firatgok") && !RT.rtIsOwner(shipped, "firatgok"), "wrangler.toml: the shipped audience admits a signed-in member who is not an owner, and never makes them one");
  ok(RT.rtAdmits(shipped, "anilkaya") && RT.rtIsOwner(shipped, "anilkaya"), "wrangler.toml: and still admits the owner, who alone reads status");
  ok(!RT.rtAdmits(RT.rtSwitches({ ...shippedEnv, FLOWS_RT_AUDIENCE: "owner" }), "firatgok"), "wrangler.toml: setting the audience back to owner refuses that member again");
  ok(!/\bhead_sampling_rate\s*=\s*0\b/.test(toml), "observability is unchanged");
  const cron = /crons\s*=\s*\[([^\]]*)\]/.exec(toml)[1];
  ok(cron.includes("1-59/5 13-21") && cron.includes("3-58/5 13-21") && cron.includes("*/30 * * * *") && cron.includes("15,45 * * * *"), "the four crons are untouched: Tier 1 stays the fallback");
  eq(read("wrangler.toml").includes("FLOWS_LIVE_MODE = \"actions\""), true, "and so is the live mode");
}

console.log(`✓ flows-rt: ${checks} assertions — the real-time rail's pure half: a frozen envelope and topic table whose rows equal the stored live-key shapers' rows value for value, per-topic sequences with a gap detector (and the false gaps a shared counter breeds), latest-wins and append-dedupe merges bounded by construction, three freshness classes with a lag guard, a 240-call budget, a REST adapter proven against a stub vendor (deadline, 429 pause with Retry-After and jitter, backoff, no overlap, no key), and a hub driven on a fake clock through demand, closed sessions, degrade and recovery, hibernation and the kill switches`);
