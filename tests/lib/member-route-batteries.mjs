import { ok, eq } from "./member-batteries.mjs";
import * as W from "./member-world.mjs";
import * as X from "./member-export-world.mjs";
import * as SN from "./member-since-batteries.mjs";
import { parseCsv, HEAD_MOVES, HEAD_UNUSUAL, NOW } from "./member-export-batteries.mjs";

const DAY = 86400000;
const B = await import("../../shared/flows-export-build.js");
const SI = await import("../../shared/flows-since.js");

const exportPayloads = () => ({
  ...X.sources(),
  events: X.eventsPayload([{ t: "SYA201", sdte: 3, d: "2026-10-28" }]),
  political: X.politicalPayload([{ t: "SYA301", buys: 5, sells: 2 }]),
});

async function fresh(modules, { payloads = exportPayloads(), env = {}, at = NOW, owners } = {}) {
  const now = W.clock(at);
  const world = await W.build({ modules, payloads, env, now, ...(owners ? { owners } : {}) });
  world.post = (body, opts = {}) => world.call("me.export", { method: "POST", body, ...opts });
  world.log = (opts = {}) => world.call("me.exports", opts);
  return world;
}

const ok200 = (r, m) => eq(r.status, 200, m + " (status " + r.status + " " + (r.json && r.json.error ? r.json.error.code : "") + ")");
const code = (r) => (r.json && r.json.error ? r.json.error.code : null);
const MOVES = { page: "moves", format: "csv" };
const BIG = { MEMBER_EXPORT: W.limiter(100000) };

export async function exportRouteBattery(modules) {
  const w = await fresh(modules, { env: BIG });
  const r = await w.post(MOVES);
  ok200(r, "a Moves CSV export");
  const built = B.buildExport("moves", X.sources(), { now: NOW, format: "csv" });
  eq(Buffer.from(r.bytes).toString("utf8"), built.body, "the route sends exactly what the builder built from the stored nightly rows");
  eq([...r.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "and the file starts with the byte order mark");
  eq([r.headers.get("content-type"), r.headers.get("content-disposition")], ["text/csv; charset=utf-8", 'attachment; filename="flows-moves-2026-10-24-TRT.csv"'], "the type and a file name dated in TRT");
  eq([r.headers.get("x-export-rows"), r.headers.get("x-export-available"), r.headers.get("x-export-truncated"), r.headers.get("x-export-method"), r.headers.get("x-content-type-options")], ["8", "8", "0", "flows-export-1", "nosniff"], "the counts, the method version and nosniff");
  eq(parseCsv(r.text)[0], HEAD_MOVES, "the header is the allowlist between the envelope");
  const j = await w.post({ page: "unusual", format: "json" });
  ok200(j, "an Unusual JSON export");
  eq([j.headers.get("content-type"), j.headers.get("content-disposition")], ["application/json; charset=utf-8", 'attachment; filename="flows-unusual-2026-10-24-TRT.json"'], "JSON has its own type and extension, and the oldest source dates the file");
  eq(j.json.meta.columns.map((c) => c.key), HEAD_UNUSUAL, "and its columns");

  const log = await w.log();
  ok200(log, "the export log");
  eq(log.json.exports, [
    { page: "unusual", rows: 5, cols: HEAD_UNUSUAL, atMs: NOW },
    { page: "moves", rows: 8, cols: HEAD_MOVES, atMs: NOW },
  ], "the member sees both, newest first, with the columns and the row count and nothing else");
  eq([log.json.window, log.json.retentionDays, log.json.formats], [{ used: 2, cap: 50, freesAtMs: null }, 90, ["csv", "json"]], "the window, the retention and the formats");
  eq(log.json.pages, {
    moves: { open: true }, unusual: { open: true },
    events: { open: false, hold: "held_event_dates", why: "held until event dates are cleared" },
    political: { open: false, hold: "held_licence", why: "held pending licence review" },
  }, "which pages are open and why the others are held, in words");
  const stored = W.allRows(w.f).member_export;
  eq(stored.map((x) => [x.member_id, x.page, x.n_rows, x.cols, x.at_ms]), [[W.ALICE, "moves", 8, HEAD_MOVES.join(","), NOW], [W.ALICE, "unusual", 5, HEAD_UNUSUAL.join(","), NOW]], "the log row holds the member, the page, the count and the column names");
  ok(!/SYA\d{3}/.test(W.everything(w.f)), "no ticker, in any row of any table, comes from an export");

  for (const [body, label] of [[{}, "an empty body"], [{ page: "moves" }, "no format"], [{ format: "csv" }, "no page"], [{ page: "sector", format: "csv" }, "a page that is not allowed"], [{ page: "moves", format: "xlsx" }, "a format that is not allowed"], [{ page: "moves", format: "csv", limit: 5 }, "an extra key"], [{ page: ["moves"], format: "csv" }, "a page given as a list"], [{ page: "__proto__", format: "csv" }, "a page named for a prototype"]]) {
    const bad = await w.post(body);
    eq([bad.status, code(bad)], [400, "invalid_export"], label + " is refused");
  }
  eq(code(await w.post(null, { raw: "{", })), "invalid_json", "a body that is not JSON is refused");
  eq(code(await w.post(MOVES, { contentType: "text/plain" })), "unsupported_media_type", "and so is a body that is not declared JSON");
  eq((await w.log()).json.window.used, 2, "none of those was logged");

  for (const page of ["events", "political"]) {
    const held = await w.post({ page, format: "csv" });
    eq([held.status, code(held), held.json.hold], [403, "export_held", page === "events" ? "held_event_dates" : "held_licence"], page + " is held, and says which hold");
  }
  eq((await w.log()).json.window.used, 2, "a held page costs nothing");

  eq(code(await w.post(MOVES, { session: null })), "unauthorized", "no session is 401");
  eq(code(await w.post(MOVES, { session: { username: "x y" } })), "unauthorized", "a member id that is not valid is 401");
  const cross = await w.post(MOVES, { same: false, headers: { Origin: "https://evil.test" } });
  eq([cross.status, code(cross)], [403, "forbidden"], "a request from another origin is refused");
  const bare = await w.post(MOVES, { same: false });
  eq([bare.status, code(bare)], [403, "forbidden"], "and so is one with neither origin header");

  eq((await w.call("me.exports", { env: { ...w.env, FLOWS_EXPORTS: "off" } })).status, 404, "off hides the log");
  for (const [mode, expected] of [["off", 404], ["", 404], [undefined, 404], ["yes", 404], ["ON", 200], [" on ", 200]]) {
    const r2 = await w.post(MOVES, { env: { ...w.env, FLOWS_EXPORTS: mode } });
    eq(r2.status, expected, "FLOWS_EXPORTS " + JSON.stringify(mode) + " is " + expected);
  }
  const ownerOnly = { ...w.env, FLOWS_EXPORTS: "owner" };
  eq([(await w.post(MOVES, { env: ownerOnly })).status, code(await w.post(MOVES, { env: ownerOnly }))], [403, "forbidden"], "owner mode refuses a member");
  eq((await w.post(MOVES, { env: ownerOnly, session: { username: W.OWNER } })).status, 200, "and admits the owner");
  eq((await w.post(MOVES, { env: { ...w.env, FLOWS_MEMBER_STATE: "off" } })).status, 200, "the member-state switch does not close exports");
  eq((await w.post(MOVES, { env: { ...w.env, DB: undefined } })).status, 503, "no database is a 503");
}

export async function exportCapBattery(modules) {
  const w = await fresh(modules, { env: BIG });
  const t0 = NOW;
  for (let i = 0; i < 50; i += 1) {
    w.now.set(t0 + i * 1000);
    ok200(await w.post({ page: "unusual", format: "json" }), "export " + (i + 1));
  }
  w.now.set(t0 + 50000);
  const r = await w.post(MOVES);
  eq([r.status, code(r), r.headers.get("retry-after"), r.json.freesAtMs], [429, "export_limit", String((DAY - 50000) / 1000), t0 + DAY], "the 51st is refused, with the second the oldest ages out");
  eq(r.json.serverNow, t0 + 50000, "and the body carries the server's own clock, so a page never judges a day by a skewed device clock");
  const view = await w.log();
  eq(view.json.window, { used: 50, cap: 50, freesAtMs: t0 + DAY }, "and the log says the same");
  eq(view.json.exports.length, 50, "fifty rows are listed");
  w.now.set(t0 + DAY - 1500);
  eq((await w.post(MOVES)).headers.get("retry-after"), "2", "a wait of a second and a half is announced as two seconds");
  w.now.set(t0 + DAY - 1);
  const edge = await w.post(MOVES);
  eq([edge.status, edge.headers.get("retry-after")], [429, "1"], "one millisecond before, the wait rounds up to one second");
  w.now.set(t0 + DAY);
  ok200(await w.post(MOVES), "at the instant the oldest is 24 hours old, one more is allowed");
  eq((await w.log()).json.window.used, 50, "and the window is full again");
  eq((await w.post(MOVES)).headers.get("retry-after"), String(1), "the next frees one second after the one that followed it");
  const bob = await w.post(MOVES, { session: { username: W.BOB } });
  ok200(bob, "another member is unaffected");
  eq((await w.log({ session: { username: W.BOB } })).json.exports.length, 1, "and sees only their own export");
  eq((await w.log()).json.exports.every((e) => e.cols.length > 0), true, "while the first member sees only theirs");

  const p = await fresh(modules, { env: BIG });
  for (let i = 0; i < 45; i += 1) {
    p.now.set(NOW + i * 1000);
    ok200(await p.post({ page: "unusual", format: "csv" }), "setup " + (i + 1));
  }
  p.now.set(NOW + 60000);
  const results = await Promise.all(Array.from({ length: 60 }, () => p.post(MOVES)));
  const statuses = results.map((x) => x.status);
  eq([statuses.filter((s) => s === 200).length, statuses.filter((s) => s === 429).length], [5, 55], "sixty requests at once from forty-five logged: exactly five succeed");
  eq((await p.log()).json.window.used, 50, "and the log holds fifty, never more");
  eq(W.allRows(p.f).member_export.length, 50, "in the table too");

  const o = await fresh(modules, { env: BIG });
  const ins = o.f.db.prepare("INSERT INTO member_export (member_id, page, n_rows, cols, at_ms) VALUES (?, ?, ?, ?, ?)");
  for (let i = 51; i >= 0; i -= 1) ins.run(W.ALICE, "moves", 1, "ticker", NOW - i * 1000);
  const over = await o.post(MOVES);
  eq([over.status, over.headers.get("retry-after"), over.json.freesAtMs], [429, String((DAY - 49000) / 1000), NOW - 49000 + DAY], "with 52 in the window the wait is for the third oldest to age out, which brings the count to 49");
  const laterDay = await fresh(modules, { env: BIG, at: Date.parse("2026-10-26T10:00:00.000Z") });
  eq((await laterDay.post(MOVES)).headers.get("content-disposition"), 'attachment; filename="flows-moves-2026-10-24-TRT.csv"', "the file is named for the day of its data, not the day it was asked for");

  const m = await fresh(modules);
  for (let i = 0; i < 10; i += 1) ok200(await m.post(MOVES), "burst " + (i + 1));
  const eleventh = await m.post(MOVES);
  eq([eleventh.status, code(eleventh), eleventh.headers.get("retry-after")], [429, "rate_limited", "60"], "the eleventh in a minute is the rate limit, not the daily cap");
  eq(W.allRows(m.f).member_export.length, 10, "and is not logged");
  eq([...new Set(m.limits.export.calls)], [W.ALICE], "the limiter is keyed by the member");
  eq(m.limits.export.calls.length, 11, "once for each request");
}

export async function exportWindowBattery(modules) {
  const w = await fresh(modules, { env: BIG });
  for (const age of [91 * DAY, 90 * DAY + 1000, 90 * DAY, 90 * DAY - 1000, 89 * DAY]) {
    w.now.set(NOW - age);
    ok200(await w.post(MOVES), "an export " + age + " ms ago");
  }
  w.now.set(NOW);
  const log = await w.log();
  eq(log.json.exports.map((e) => e.atMs), [NOW - 89 * DAY, NOW - 90 * DAY + 1000, NOW - 90 * DAY], "the log shows 90 days back: 90 days exactly and 90 days less a second are in, 90 days and a second and 91 days are not");
  eq(log.json.window.used, 0, "none counts against the 24-hour cap");
  const swept = await w.store.housekeeping(w.env, NOW, [W.KEY]);
  eq(swept.pruned, 2, "the 03:00 sweep removes what is past 90 days, down to the second");
  eq(W.allRows(w.f).member_export.map((x) => x.at_ms), [NOW - 90 * DAY, NOW - 90 * DAY + 1000, NOW - 89 * DAY], "and nothing else: a row of exactly 90 days and one a second younger stay");
  const insert = w.f.db.prepare("INSERT INTO member_export (member_id, page, n_rows, cols, at_ms) VALUES (?, ?, ?, ?, ?)");
  for (let i = 0; i < 205; i += 1) insert.run(W.BOB, "moves", i, "ticker", NOW - 60 * DAY + i);
  const many = await w.log({ session: { username: W.BOB } });
  eq([many.json.exports.length, many.json.exports[0].rows, many.json.exports[199].rows], [200, 204, 5], "at most 200 rows are listed, newest first");
  const del = await w.call("me.state", { method: "DELETE" });
  eq(del.json.kept.exports, 3, "deleting saved state keeps the member's export record");
  eq((await w.log()).json.exports.length, 3, "and the log still shows it");
}

export async function exportTruncationBattery(modules) {
  const names = Array.from({ length: 1001 }, (_, i) => ({ t: "SYB" + String(i).padStart(3, "0"), cols: { sig: 0.02, chg: 0.001, ed: null } }));
  const w = await fresh(modules, { payloads: { universe: X.columnStore(names) } });
  const r = await w.post(MOVES);
  ok200(r, "an export of 1,001 names");
  eq([r.headers.get("x-export-rows"), r.headers.get("x-export-available"), r.headers.get("x-export-truncated")], ["1000", "1001", "1"], "is cut to 1,000 and says so in its headers");
  eq(r.headers.get("content-disposition"), 'attachment; filename="flows-moves-2026-10-24-TRT-cut-1000-of-1001.csv"', "the cut is in the file name");
  const grid = parseCsv(r.text);
  eq([grid.length, grid[grid.length - 1][0]], [1002, "Cut at 1,000 of 1,001 rows, in the order of this file. The rest are not in it."], "the file has a header, 1,000 rows and a last line that says where it was cut");
  const json = JSON.parse((await w.post({ page: "moves", format: "json" })).text);
  eq([json.meta.rows, json.meta.available, json.meta.truncated, json.rows.length], [1000, 1001, true, 1000], "and the JSON says it in its meta and has no note line");
  eq((await w.log()).json.exports[0].rows, 1000, "the log records the rows sent");
  const missing = await fresh(modules, { payloads: { universe: null } });
  const empty = await missing.post(MOVES);
  ok200(empty, "an export when the universe is not stored");
  eq([empty.headers.get("x-export-rows"), parseCsv(empty.text).length], ["0", 1], "has a header and no rows");
}

export async function sinceRouteBattery(modules) {
  const prevMs = SN.PREV + 5 * 60000;
  const w0 = SN.worldOf(prevMs);
  const payloads = { universe: w0.universe, scoretrack: w0.track, events: w0.events, flowalerts: w0.alerts };
  const limits = () => ({ MEMBER_STATE_READ: W.limiter(100000), MEMBER_STATE_WRITE: W.limiter(100000) });
  const visits = async (world) => {
    await world.call("me.visit", { method: "POST" });
    world.now.set(prevMs);
    await world.call("me.visit", { method: "POST" });
    world.now.set(NOW);
    return world.call("me.visit", { method: "POST" });
  };
  const lim = limits();
  const w = await fresh(modules, { payloads, env: lim, at: SN.PREV });
  const since = (opts) => w.call("me.since", opts);
  const first = await since();
  ok200(first, "Since before any visit");
  eq([first.json.state, first.json.groups, first.json.lastVisitMs], ["first", [], null], "is the first-visit state");
  await w.call("me.visit", { method: "POST" });
  eq((await since()).json.state, "first", "after one ping it is still the first visit");
  w.now.set(prevMs);
  await w.call("me.visit", { method: "POST" });
  eq((await since()).json.state, "first", "and a ping in the same visit leaves it so");
  w.now.set(NOW);
  const second = await w.call("me.visit", { method: "POST" });
  eq([second.json.visit.firstVisit, second.json.visit.newVisit, second.json.visit.previousEndedMs], [false, true, prevMs], "a visit after more than 30 minutes is a new one, and remembers where the last ended");
  const got = await since();
  ok200(got, "Since after the second visit");
  const expected = SI.sinceModel({ now: NOW, prevSeenMs: prevMs, universe: w0.universe, track: w0.track, events: w0.events, alerts: w0.alerts });
  eq(got.json, JSON.parse(JSON.stringify(expected)), "is exactly the model run on the stored nightly rows and the previous visit's last ping");
  eq([got.json.lastVisitMs, got.json.state], [prevMs, "some"], "whose last visit is that ping, not the start of the visit");
  w.now.set(NOW + 10000);
  const quick = await w.call("me.visit", { method: "POST" });
  eq([quick.json.visit.previousEndedMs, quick.json.visit.newVisit, quick.json.visit.lastSeenMs], [prevMs, false, NOW], "a ping ten seconds into a visit neither moves the baseline nor writes the last-seen time");
  eq((await since()).json.lastVisitMs, prevMs, "and Since still compares with the previous visit");
  const before = JSON.stringify(W.allRows(w.f));
  w.now.set(NOW + 60000);
  const again = await since();
  eq([again.json.lastVisitMs, again.json.state], [prevMs, got.json.state], "reading it again in the same visit moves nothing");
  eq(JSON.stringify(W.allRows(w.f)), before, "and writes nothing");
  eq([lim.MEMBER_STATE_READ.calls.length, lim.MEMBER_STATE_WRITE.calls.length], [6, 4], "six reads of Since went through the read limiter and the four pings through the write limiter");

  const liveBody = X.flowPayload([X.win("SYL001", 2000000, 1500000, 100000, {}), X.win("SYL001", 1000000, 700000, 100000, {}), X.win("SYL002", 900000, 600000, 100000, {})].map((r) => ({ ...r, firstAt: SN.ISO(NOW - 1000) })), { readAt: SN.ISO(NOW - 500) });
  const liveRow = (session) => ({ rows: [{ id: "live:alerts", payload: JSON.stringify(liveBody), session }] });
  const names = (r) => (r.json.groups.find((g) => g.id === "flow") || { lines: [] }).lines.map((l) => l.t);
  const nightly = ["SYF001", "SYF005", "SYF006", "SYF004", "SYF002"];
  eq(names(got), nightly, "the nightly record names these");
  const run = async (live, label, expected2) => {
    const now = W.clock(SN.PREV);
    const lw = await W.build({ modules, payloads, env: limits(), now, live });
    await visits(lw);
    eq(names(await lw.call("me.since")), expected2, label);
  };
  await run(liveRow("2026-10-23"), "a live alerts row of the same session replaces the nightly record", ["SYL001", "SYL002"]);
  await run(liveRow("2026-10-24"), "and so does a newer one", ["SYL001", "SYL002"]);
  await run(liveRow("2026-10-22"), "an older one does not", nightly);
  await run(async () => { throw new Error("store down"); }, "a live read that fails leaves the nightly record", nightly);
  await run({ rows: [{ id: "live:alerts", payload: "{not json", session: "2026-10-23" }] }, "a live row that is not JSON leaves the nightly record", nightly);
  await run({ rows: [] }, "no live row leaves the nightly record", nightly);

  w.flowsStore.readMany = async () => null;
  eq(code(await since()), "store_unreadable", "an unreadable store is a 503, not an empty answer");
  eq((await since({ env: { ...w.env, FLOWS_MEMBER_STATE: "off" } })).status, 404, "off hides it");
  eq(code(await since({ session: null })), "unauthorized", "and no session is 401");
  eq((await since({ same: false, headers: { Origin: "https://evil.test" } })).status, 403, "another origin is refused");
}
