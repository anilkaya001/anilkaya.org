import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ledgerView, parseScope } from "../shared/flows-sfc-view.js";
import { bookWindows, readUniverse, SECTORS, deltaMicroOf, sumBooks, COLUMNS } from "../shared/flows-sfc.js";
import { buildBook, notLive, baseParity, createLiveLedger, ledgerLiveMode, ledgerLiveOn, tideSlice, universeSlice, ALL_SCOPE } from "../shared/flows-ledger-live.js";
import { stripModel, verdictOf, createSamples, ageText, nextTickMs, countFrame, trtClock, textHash, hubAgeS, RT_WINDOWS } from "../shared/flows-ledger-strip.js";
import { alertKey } from "../shared/flows-alerts.js";
import { FRESH_CLASSES } from "../shared/flows-freshness.js";
import { storedInput, NOW_INTRADAY } from "./lib/sfc-stored.mjs";
import { makeWorld } from "./lib/sfc-world.mjs";
import { lintText } from "./lib/copy-lint.mjs";
import { mulberry32 } from "./lib/sfc-rng.mjs";
import { liveWorld, serverBook, streamRow } from "./lib/ledger-live-world.mjs";
import { buildLedgerBundle, LEDGER_BUNDLE_OUT } from "../scripts/build-flows-ledger-bundle.mjs";
import { project } from "./lib/ledger-stream.mjs";
import { loadMutated } from "./truth/mutants.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const plain = (v) => JSON.parse(JSON.stringify(v));

{
  eq([ledgerLiveMode({}), ledgerLiveMode({ FLOWS_LEDGER_LIVE: "on" }), ledgerLiveMode({ FLOWS_LEDGER_LIVE: " OWNER " }), ledgerLiveMode({ FLOWS_LEDGER_LIVE: "maybe" }), ledgerLiveMode({ FLOWS_LEDGER_LIVE: "off" }), ledgerLiveMode(null)],
    ["off", "on", "owner", "off", "off", "off"], "the switch is on, owner or off, and anything else fails closed");
  eq([ledgerLiveOn({ FLOWS_LEDGER_LIVE: "on" }, false), ledgerLiveOn({ FLOWS_LEDGER_LIVE: "owner" }, true), ledgerLiveOn({ FLOWS_LEDGER_LIVE: "owner" }, false), ledgerLiveOn({ FLOWS_LEDGER_LIVE: "owner" }, undefined), ledgerLiveOn({}, true)],
    [true, true, false, false, false], "on opens it to a member, owner to the owner alone, unset to nobody");
  const wrangler = fs.readFileSync(path.join(ROOT, "wrangler.toml"), "utf8");
  ok(/^FLOWS_LEDGER_LIVE = "owner"$/m.test(wrangler), "wrangler.toml ships the live switch at owner");
}

{
  const w = makeWorld(88, { tickers: 22, perName: 7, pathologies: false });
  const input = storedInput(w);
  const view = ledgerView({ ...input, now: NOW_INTRADAY });
  const book = buildBook({ at: NOW_INTRADAY, view, live: input.live, nightly: input.nightly, breadth: input.breadth, universe: input.universe, clock: input.clock });
  eq([book.v, book.status, book.serverNow, book.session, book.period], [1, "ok", NOW_INTRADAY, w.session, "intraday"], "the book names its version, its time, its session and the period it was built for");
  eq(book.rows.length, input.live.payload.rows.length, "it carries every held row of the record");
  ok(book.rows.every((r) => Object.keys(r).length === 19 && "la" in r && "dm" in r), "each row is the seventeen fields the ledger reads, the read time and the server's delta");
  ok(JSON.stringify(book).length < 200000, "and the whole book is small: " + JSON.stringify(book).length + " bytes for " + book.rows.length + " rows");
  eq(book.record, { date: w.session, everEntered: input.live.payload.record.everEntered }, "the record's date and entered count travel with it");
  ok(baseParity(book).ok, "the browser's build of the book equals the server's view, by hash");
  eq(book.viewHash, textHash(JSON.stringify(view)), "which is the hash of the server's own view");
  const bump = (mut) => { const b = plain(book); mut(b); return baseParity(b).ok; };
  eq([
    bump((b) => { b.rows[0].prem += 1; }), bump((b) => { b.rows[1].askPrem = 0; b.rows[1].bidPrem = 0; }), bump((b) => { b.universe.t.pop(); }),
    bump((b) => { b.breadth.sectors.rows[SECTORS[0]].ncp[b.breadth.sectors.rows[SECTORS[0]].ncp.length - 1] += 100; }), bump((b) => { b.serverNow += 60000; }), bump((b) => { b.rows.pop(); }),
  ], [false, false, false, false, false, false], "a premium, a side, a universe row, a tide, the clock or a missing window each break the parity hash");
  eq(bump((b) => { b.rows[0].dm = 1; b.rows[0].la = 5; }), true, "the server's delta and read time are not part of the hash: they are checked per window");
  const live = createLiveLedger();
  ok(live.applyBase(book).ok, "the live ledger takes the book");
  eq(live.deltaCheck(book), [], "and its delta for every window equals the server's");
  const bad = plain(book);
  bad.rows[3].dm = (bad.rows[3].dm || 0) + 1;
  eq(live.deltaCheck(bad).length, 1, "a delta that differs by one micro unit names that window");
  eq(live.engine().stats().held, book.rows.length, "all rows are held when they are fewer than 180");
  const mine = plain(live.view({ now: NOW_INTRADAY, aligned: false }));
  const server = plain(view);
  eq(mine, server, "the incremental view with the tide left unaligned equals the server's view to the last cell");
  for (const key of ["sector:Energy", "sector:Technology", "name:" + book.rows[0].t]) {
    const scope = parseScope(key);
    eq(plain(live.view({ now: NOW_INTRADAY, scope, aligned: false })), plain(ledgerView({ ...input, now: NOW_INTRADAY, scope })), "and so does the view of " + key);
  }
  eq(notLive({ at: 5, view: { period: { id: "session" }, why: "x" } }), { v: 1, status: "not-live", serverNow: 5, period: "session", why: "x" }, "a period that is not the live one is answered as not live");
  const slim = tideSlice(input.breadth.payload);
  ok(!("dte" in slim) && !("net" in slim.sectors.rows[SECTORS[0]]), "the tide slice leaves out what the ledger never reads");
  eq(universeSlice(null), null, "an absent universe stays absent");
}

{
  let bad = 0;
  let aligned = 0;
  for (let i = 0; i < 25; i++) {
    const seed = 6000 + i;
    const w = liveWorld(seed, { tickers: 30, perName: 6 });
    const book = serverBook(w);
    const live = createLiveLedger();
    live.applyBase(book);
    const rnd = mulberry32(seed);
    const rows = Array.from({ length: 40 }, (_, j) => streamRow(w, rnd, j, NOW_INTRADAY - 60000 + j * 1000, { spanEnd: new Date(NOW_INTRADAY - 90000 + j * 1000).toISOString() }));
    for (let at = 0; at < rows.length; at += 7) {
      live.put(rows.slice(at, at + 7), { at: NOW_INTRADAY - 60000 + at * 1000 });
      live.settle();
      const held = live.engine().heldRows();
      const uni = readUniverse(book.universe);
      const scratch = bookWindows(held, { column: uni.columnOf, session: w.session });
      const want = plain(ledgerView({
        now: NOW_INTRADAY, scope: ALL_SCOPE, period: null,
        live: { payload: { rows: held, record: { date: w.session, everEntered: live.seenTotal() } }, readAt: live.readAt(), session: w.session },
        nightly: null, breadth: { payload: book.breadth }, universe: book.universe, clock: book.clock, booked: scratch,
      }));
      const got = plain(live.view({ now: NOW_INTRADAY, aligned: false }));
      if (JSON.stringify(got) !== JSON.stringify(want)) bad++;
      if (!live.verify().ok) bad++;
    }
    const v = live.view({ now: NOW_INTRADAY, aligned: true });
    if (v.status === "ok" && v.align.on) aligned++;
    const tide = readTideAt(book.breadth);
    const held = live.engine().heldRows();
    const uni = readUniverse(book.universe);
    let newer = 0;
    for (const r of held) if (Date.parse(r.spanEnd) > tide) newer++;
    if (v.status === "ok" && v.align.newer !== newer) bad++;
  }
  eq(bad, 0, "after every batch of 25 streams the live view equals the view built from scratch on the same held rows, and the live books verify");
  ok(aligned === 25, "and each aligned view says so");
}

function readTideAt(breadth) {
  const block = breadth.sectors;
  const rows = block.rows;
  let best = -Infinity;
  for (const s of SECTORS) {
    const feed = rows[s];
    if (!feed || !Array.isArray(feed.ncp)) continue;
    for (let i = feed.ncp.length - 1; i >= 0; i--) {
      if (feed.ncp[i] === null || feed.npp[i] === null) continue;
      best = Math.max(best, Date.parse(block.t[i]));
      break;
    }
  }
  return best;
}

{
  const w = liveWorld(77, { tickers: 30, perName: 6 });
  const book = serverBook(w);
  const live = createLiveLedger();
  live.applyBase(book);
  const at = readTideAt(book.breadth);
  const view = live.view({ now: NOW_INTRADAY, aligned: true });
  const unaligned = live.view({ now: NOW_INTRADAY, aligned: false });
  const uni = readUniverse(book.universe);
  const held = live.engine().heldRows();
  let want = 0n;
  let wantCalls = 0;
  let wantPuts = 0;
  for (const sector of SECTORS) {
    const tide = w.tide[sector];
    if (!tide) continue;
    const rows = held.filter((r) => uni.columnOf(r.t) === sector && Date.parse(r.spanEnd) <= at);
    const { books } = bookWindows(rows, { column: uni.columnOf, session: w.session });
    const t = sumBooks(books);
    wantCalls += tide.calls - (t.AC - t.BC);
    wantPuts += tide.puts - (t.AP - t.BP);
  }
  eq(view.sectors.exact.outside, wantCalls + wantPuts, "the aligned Outside held windows is the tide less only the held windows that ended by the tide's last bar, worked independently");
  ok(view.sectors.exact.outside !== unaligned.sectors.exact.outside, "which is not what subtracting every held window gives");
  ok(view.align.newer > 0 && view.align.on === true && view.align.at === at, "and the view says how many held windows are newer than the bar: " + view.align.newer);
  eq(unaligned.align, { on: false, at: null, atText: null, newer: null }, "an unaligned view says it is not aligned");
  ok(view.checks.items.filter((c) => ["rows", "columns", "sides", "sectors"].includes(c.id)).every((c) => c.state === "pass"), "every row and column still closes with the tide aligned");
}

{
  const f = (state, over = {}) => ({ nowPerf: 1000, nowMs: 9e12, mode: "socket", pollMs: 5000, hidden: false, catching: false, closed: null, paused: null, hub: { atMs: 5e12, readAtMs: 5e12 - 1000, perf: 800 }, serverReadAtMs: null, lag: { n: 0, p50: null, p95: null }, transit: null, newestEndMs: null, held: 180, seen: 300, pageOnly: 0, parity: { state: "pending" }, drift: { runs: 0, count: 0, at: null }, tide: null, ...over });
  eq(hubAgeS({ atMs: 5000, readAtMs: 4000, perf: 100 }, 600), 1.5, "the hub's read age is the gap between its send and its read plus the time since the frame arrived");
  eq(hubAgeS(null, 5), null, "no frame, no age");
  const rt = FRESH_CLASSES.rt;
  eq([RT_WINDOWS.liveS, RT_WINDOWS.staleS], [rt.liveS, rt.staleS], "the windows are the rail's own freshness class: " + rt.liveS + " and " + rt.staleS);
  const v = (age) => verdictOf({ mode: "socket", ageS: age }).state;
  eq([v(0), v(15), v(15.01), v(60), v(60.01), v(null)], ["live", "live", "delayed", "delayed", "stale", "pending"], "live to 15 s, delayed to 60 s, stale after");
  eq(verdictOf({ mode: "socket", ageS: 2, hidden: true }).state, "hidden", "a hidden tab says it is paused");
  eq(verdictOf({ mode: "socket", ageS: 2, closed: { reason: "weekend" } }).state, "closed", "a closed market says closed, never stale");
  eq(verdictOf({ mode: "socket", ageS: 2, paused: "x" }).state, "paused", "a paused ledger says so over everything");
  eq(verdictOf({ mode: "off", serverAgeS: 30 }).state, "server", "with the rail off the page names the server copy");
  eq(verdictOf({ mode: "socket", ageS: 200, catching: true }).state, "catching", "a page refetching after a hidden tab says it is catching up");
  const quiet = stripModel(f("live"));
  eq([quiet.verdict.state, quiet.chips[0].value], ["live", "Socket · hub read 1.2 s ago"], "a quiet market with a healthy hub is live: the verdict reads the connection, not the last alert");
  const old = stripModel(f("old", { hub: { atMs: 5e12, readAtMs: 5e12 - 30000, perf: 800 } }));
  eq(old.verdict.state, "delayed", "a hub read 30 s old is delayed");
  ok(/live under 15 s/.test(old.chips[0].value), "and says where live ends");
  const stale = stripModel(f("stale", { hub: { atMs: 5e12, readAtMs: 5e12 - 90000, perf: 800 } }));
  eq(stale.verdict.state, "stale", "a hub read 90 s old is stale");
  ok(/figures to \d\d:\d\d:\d\d TRT/.test(stale.chips[0].value), "and names the time the figures are to");
  const poll = stripModel(f("poll", { mode: "poll", transit: { n: 5, p50: 100, p95: 200 } }));
  ok(/^Polling 5 s/.test(poll.chips[0].value) && /not measured while polling/.test(poll.chips[3].value), "polling names its interval and measures no transit");
  const sock = stripModel(f("sock", { transit: { n: 12, p50: 300, p95: 900 }, lag: { n: 42, p50: 6000, p95: 11000 } }));
  eq([sock.chips[2].value, sock.chips[3].value], ["6.0 s p50 · 11 s p95 · n 42", "+0.3 s over best seen · n 12 · estimate"], "socket latency prints the feed to hub spread and the hub to screen excess");
  const off = stripModel(f("off", { mode: "off", serverReadAtMs: 9e12 - 5000, hub: null }));
  ok(/^as of \d\d:\d\d:\d\d TRT$/.test(off.chips[0].value) && off.verdict.word === "Server copy", "with the rail off the strip names the time of the server's copy");
  const few = stripModel(f("few", { lag: { n: 7, p50: 6000, p95: 11000 } }));
  eq(few.chips[2].value, "6.0 s p50 · n 7", "under twenty samples the spread is not printed: a 95th percentile of seven numbers is their largest");
  const held = stripModel(f("held", { holdText: "held while you select text" }));
  ok(/ · held while you select text$/.test(held.chips[0].value), "a held repaint is said in the strip, never hidden behind Live");
  eq(off.chips[2].value, "— rail off", "and measures no feed lag");
  const paused = stripModel(f("paused", { paused: "Live ledger paused.", parity: { state: "mismatch", text: "x" } }));
  eq([paused.verdict.state, paused.chips[5].tone], ["paused", "bad"], "a mismatch pauses the ledger and fails the check chip");
  const drift = stripModel(f("d", { drift: { runs: 3, count: 2, events: 1, at: 1, rebuiltAt: 5e12 } }));
  ok(drift.chips[5].tone === "bad" && /^drift 1 · rebuilt \d\d:\d\d:\d\d TRT$/.test(drift.chips[5].value), "any drift fails the check chip and says it was rebuilt: " + drift.chips[5].value);
  const clean = stripModel(f("c", { drift: { runs: 4, count: 0, at: 1 }, parity: { state: "ok", at: 5e12 } }));
  ok(/server match/.test(clean.chips[5].value) && /drift 0/.test(clean.chips[5].value) && clean.chips[5].tone === "ok", "a clean check says server match and drift 0");
  const tide = stripModel(f("t", { tide: { atMs: 5e12, newer: 3 } }));
  ok(/3 newer held windows not in it/.test(tide.chips[6].value), "the tide chip counts the held windows newer than the bar");
  const lines = [];
  for (const mode of ["socket", "poll", "off", "heartbeat"]) for (const age of [0.2, 14, 30, 90, 4000]) for (const flag of [{}, { hidden: true }, { catching: true }, { closed: { reason: "weekend" } }, { paused: "Live ledger paused." }]) {
    const m = stripModel(f("x", { mode, hub: { atMs: 5e12, readAtMs: 5e12 - age * 1000, perf: 800 }, lag: { n: 9, p50: 6000, p95: 9000 }, transit: { n: 9, p50: 100, p95: 300 }, newestEndMs: 5e12, tide: { atMs: 5e12, newer: 1 }, parity: { state: "ok", at: 5e12 }, drift: { runs: 2, count: 0, at: 1 }, ...flag }));
    for (const c of m.chips) lines.push(c.label + ". " + c.value + ".", c.title);
    lines.push(m.verdict.word + ".");
  }
  const hits = lintText([...new Set(lines.filter(Boolean))].join("\n")).map((h) => `${h.rule} ${JSON.stringify(h.match)} :: ${h.sentence.slice(0, 80)}`);
  eq(hits, [], "every sentence of the strip passes the copy rules");
  ok(new Set(lines).size > 40, "and there are enough distinct ones for that to mean something: " + new Set(lines).size);
}

{
  const s = createSamples(4);
  for (const v of [5, 1, 9, 3, 7, 11]) s.add(v);
  s.add(NaN);
  s.add(null);
  eq(s.summary(), { n: 4, p50: 7, p95: 11 }, "the sample ring keeps the latest four and ignores what is not a number");
  eq(createSamples().summary(), { n: 0, p50: null, p95: null }, "an empty ring answers null, never zero");
  eq([ageText(0.04), ageText(9.96), ageText(10), ageText(59.9), ageText(60), ageText(3599), ageText(7200), ageText(NaN)], ["0.0 s", "10.0 s", "10 s", "59 s", "1 min", "59 min", "2 h", null], "ages print in tenths under ten seconds, then whole units");
  ok(nextTickMs(0) <= 255 && nextTickMs(9.9) <= 255 && nextTickMs(30.2) <= 1005 && nextTickMs(90) <= 60005, "the next repaint is due at the next display step, so a text is written only when it changes");
  eq(trtClock(Date.UTC(2026, 9, 23, 15, 4, 5, 678), { millis: true }), "18:04:05.678 TRT", "TRT is three hours ahead of UTC, to the millisecond when asked");
  eq(trtClock(Date.UTC(2026, 9, 23, 15, 4, 5)), "18:04 TRT", "and to the minute by default");
  eq(trtClock(NaN), null, "no time is no text");
}

{
  const fmt = (c) => (c < 0 ? "−" : "") + (Math.abs(c) / 100).toFixed(2);
  for (const [a, b] of [[-40, 60], [60, -40], [0, -1], [12231000000, 12231000001], [-5, 5], [0, 0], [7, 7], [123456789, 1]]) {
    eq(fmt(countFrame(a, b, 1)), fmt(b), `the last frame of ${a} to ${b} is exact`);
    eq(fmt(countFrame(a, b, 2)), fmt(b), "and so is a frame past the end");
    for (let p = 0; p <= 1; p += 0.05) {
      const v = countFrame(a, b, p);
      ok(Number.isInteger(v) && !Object.is(v, -0) && v >= Math.min(a, b) && v <= Math.max(a, b), `every frame of ${a} to ${b} is an integer cent between them, never negative zero (${v})`);
    }
  }
  eq([countFrame(0, 100, 0), countFrame(0, 100, -1), countFrame(NaN, 5, 0.5), countFrame(5, NaN, 0.5)], [0, 0, 5, NaN], "the first frame is the start and a missing end is returned as it is");
  let last = -Infinity;
  let mono = true;
  for (let p = 0; p <= 1; p += 0.01) { const v = countFrame(0, 1000, p); if (v < last) mono = false; last = v; }
  ok(mono, "an increase never steps backwards on the way");
}

{
  const built = await buildLedgerBundle();
  const committed = fs.readFileSync(path.join(ROOT, LEDGER_BUNDLE_OUT), "utf8");
  ok(built === committed, "the committed bundle is what the build produces from the shared modules");
  ok(!/^\s*\/[/*]/m.test(committed) && committed.startsWith("\"use strict\";"), "and it carries no banner");
  const sandbox = { FlowsUI: {} };
  sandbox.window = sandbox;
  new Function("window", committed)(sandbox);
  const kit = sandbox.FlowsUI.ledgerKit;
  ok(kit && typeof kit.createLiveLedger === "function" && typeof kit.baseParity === "function" && typeof kit.stripModel === "function", "it attaches ledgerKit to FlowsUI and adds no global");
  ok(Object.isFrozen(sandbox.FlowsUI) && Object.isFrozen(kit), "both frozen");
  const w = makeWorld(88, { tickers: 22, perName: 7, pathologies: false });
  const input = storedInput(w);
  const view = ledgerView({ ...input, now: NOW_INTRADAY });
  const book = buildBook({ at: NOW_INTRADAY, view, live: input.live, nightly: input.nightly, breadth: input.breadth, universe: input.universe, clock: input.clock });
  ok(kit.baseParity(plain(book)).ok, "the bundled build agrees with the module's hash of the server's view");
  eq(kit.parseScope("sector:Energy").kind, "sector", "and it parses a scope the way the route does");
  const size = committed.length;
  console.log(`  bundle ${size} bytes`);
}

{
  const w = liveWorld(31, { tickers: 24, perName: 6 });
  const book = serverBook(w);
  const live = createLiveLedger();
  live.applyBase(book);
  const t0 = process.hrtime.bigint();
  let n = 0;
  for (let i = 0; i < 40; i++) { live.view({ now: NOW_INTRADAY }); n++; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / n;
  console.log(`  one live view ${ms.toFixed(2)} ms over ${book.rows.length} windows`);
  ok(Number.isFinite(ms) && n === 40, "a whole view was built from the live books forty times");
  const keys = new Set(book.rows.map((r) => alertKey(r)));
  eq(live.heldKeys().size, keys.size, "the held keys are the book's keys");
  eq(project(book.rows[0]).t, book.rows[0].t, "projection keeps the ticker");
  const seen = live.seenTotal();
  ok(seen >= book.rows.length, "the seen count is never below the held count: " + seen);
}

{
  const STRIP = "shared/flows-ledger-strip.js";
  const stripBattery = async (M) => {
    const failed = [];
    const note = (name, good) => { if (!good && !failed.includes(name)) failed.push(name); };
    const base = (over = {}) => ({ nowPerf: 1000, nowMs: 9e12, mode: "socket", pollMs: 5000, hidden: false, catching: false, closed: null, paused: null, hub: { atMs: 5e12, readAtMs: 5e12 - 1000, perf: 800 }, serverReadAtMs: null, lag: { n: 0, p50: null, p95: null }, transit: null, newestEndMs: null, held: 10, seen: 12, pageOnly: 0, parity: { state: "ok", at: 1 }, drift: { runs: 1, count: 0, events: 0, at: 1, rebuiltAt: null }, tide: null, ...over });
    note("frame-age", M.hubAgeS({ atMs: 5000, readAtMs: 4000, perf: 100 }, 600) === 1.5);
    note("stale-as-live", M.stripModel(base({ hub: { atMs: 5e12, readAtMs: 5e12 - 120000, perf: 800 } })).verdict.state === "stale" && M.stripModel(base({ hub: { atMs: 5e12, readAtMs: 5e12 - 30000, perf: 800 } })).verdict.state === "delayed");
    note("quiet-live", M.stripModel(base({ newestEndMs: 9e12 - 6 * 3600 * 1000 })).verdict.state === "live");
    note("frozen-frame", M.stripModel(base({ nowPerf: 800 + 100000 })).verdict.state === "stale");
    note("hidden", M.stripModel(base({ hidden: true })).verdict.state === "hidden");
    note("p95-few", !/p95/.test(M.stripModel(base({ lag: { n: 7, p50: 6000, p95: 11000 } })).chips[2].value) && /p95/.test(M.stripModel(base({ lag: { n: 42, p50: 6000, p95: 11000 } })).chips[2].value));
    return failed;
  };
  eq(await stripBattery(await import("../shared/flows-ledger-strip.js")), [], "the strip's model passes every check of its battery");
  const PLANTS = [
    ["a frame older than the stale line is shown as live", "stale-as-live", [['if (ageS <= RT_WINDOWS.liveS) return { state: "live", tone: "ok", word: "Live" };', 'if (ageS <= 1e9) return { state: "live", tone: "ok", word: "Live" };']]],
    ["a frame that stopped keeps the age it had", "frozen-frame", [["return Math.max(0, (hub.atMs - hub.readAtMs + (nowPerf - hub.perf)) / 1000);", "return Math.max(0, (hub.atMs - hub.readAtMs) / 1000);"]]],
    ["the verdict is read from the newest window, not from the hub", "quiet-live", [["const ageS = hubAgeS(m.hub, nowPerf);", "const ageS = Number.isFinite(m.newestEndMs) ? Math.max(0, (m.nowMs - m.newestEndMs) / 1000) : null;"]]],
    ["a hidden tab is not said to be paused", "hidden", [['if (hidden) return { state: "hidden", tone: "idle", word: "Paused while hidden" };', ""]]],
    ["a spread is printed from seven samples", "p95-few", [["else if (lag.n < SPREAD_MIN) lagValue", "else if (false) lagValue"]]],
    ["the time since the frame arrived is counted twice", "frame-age", [["return Math.max(0, (hub.atMs - hub.readAtMs + (nowPerf - hub.perf)) / 1000);", "return Math.max(0, (hub.atMs - hub.readAtMs + (nowPerf - hub.perf) * 2) / 1000);"]]],
  ];
  for (const [title, expect, transforms] of PLANTS) {
    const M = await loadMutated(STRIP, transforms, { salt: expect.length + title.length });
    const failed = await stripBattery(M);
    ok(failed.includes(expect), `${title} fails its check ${expect}; failed: ${failed.join(", ") || "none"}`);
  }
}

console.log(`✓ flows-ledger-live: ${checks} assertions`);
