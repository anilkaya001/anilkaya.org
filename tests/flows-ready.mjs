import assert from "node:assert/strict";
import { readiness, healthOf, READY_KEYS, READY_LIMITS } from "../shared/flows-ready.js";
import { PREMARKET_NEWS, premarketNewsOn, premarketNewsDue, premarketNewsTick, shapePremarketNews } from "../shared/flows-live-worker.js";

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const PRE = Date.parse("2026-10-12T11:00:00Z");
const RTH = Date.parse("2026-10-12T15:00:00Z");
const SAT = Date.parse("2026-10-10T12:00:00Z");
const POST = Date.parse("2026-10-12T21:00:00Z");

const entry = (sessionDate) => ({ present: true, sessionDate, generatedAt: null, updatedAt: 1, bytes: 10 });
const keysAt = (day, over = {}) => ({ ...Object.fromEntries(READY_KEYS.map((k) => [k, entry(day)])), ...over });
const clockAt = (at, over = {}) => ({ day: "2026-10-12", trading: 1, tier1At: at - 120000, tier1OkAt: at - 120000, tier1Why: "written", ...over });
const codes = (r) => r.blockers.map((b) => b.code);

{
  const r = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09"), rail: undefined }, PRE);
  eq(r.ok, true, "a landed nightly, fresh keys and a calm pre-market is ready");
  eq(r.blockers, [], "with no blocker");
  eq(r.expected, "2026-10-09", "the expected session on Monday morning is Friday's");
  eq(r.session, "2026-10-12", "and the session being prepared for is Monday's");
  eq(r.phase, "pre", "the phase is the pre-market");
  eq(r.minutesToOpen, 150, "the open is 150 minutes away at 14:00 TRT");
  eq(r.opens.trt, "16:30 TRT", "and it is printed in Türkiye time");
  ok(/opens 16:30 TRT, in 150 minutes/.test(r.said), "the sentence says so: " + r.said);
  eq(r.checks.tier1, "skipped", "Tier 1 is not required before the open");
  eq(r.checks.rail, "skipped", "and the rail is not asked of a member");
  ok(!/ET|EDT|UTC/.test(r.said), "no other zone is named");
}

{
  const r = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { meta: entry("2026-10-08") }), rail: undefined }, PRE);
  eq(codes(r), ["nightly"], "a nightly run record one session behind blocks, alone");
  ok(r.blockers[0].sentence.includes("2026-10-08") && r.blockers[0].sentence.includes("2026-10-09"), "and names both sessions");
  eq(r.ok, false, "not ready");
  const absent = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { meta: { present: false } }), rail: undefined }, PRE);
  eq(codes(absent), ["nightly"], "an unpublished run record blocks");
  const bare = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { meta: entry(null) }), rail: undefined }, PRE);
  eq(codes(bare), ["nightly"], "a record with no session date blocks");
  const ahead = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-12"), rail: undefined }, PRE);
  eq(ahead.ok, true, "a key at or beyond the expected session does not");
}

for (const id of ["universe", "regime", "events"]) {
  const behind = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { [id]: entry("2026-10-08") }), rail: undefined }, PRE);
  eq(codes(behind), [id], id + " one session behind blocks, alone");
  const gone = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { [id]: { present: false } }), rail: undefined }, PRE);
  eq(codes(gone), [id], id + " absent blocks");
  const undef = readiness({ clock: clockAt(PRE), keys: (({ [id]: _, ...rest }) => rest)(keysAt("2026-10-09")), rail: undefined }, PRE);
  eq(codes(undef), [id], id + " missing from the read blocks");
}

for (const side of ["board:long", "board:short"]) {
  const behind = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09", { [side]: entry("2026-10-08") }), rail: undefined }, PRE);
  eq(codes(behind), ["board"], side + " behind is one board blocker");
  ok(behind.blockers[0].sentence.includes(side.slice(6)), "naming the side: " + behind.blockers[0].sentence);
}

{
  const all = readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-08"), rail: undefined }, PRE);
  eq(codes(all).sort(), ["board", "events", "nightly", "regime", "universe"], "a night that never landed lists every key");
  ok(/5 things are blocking/.test(all.said), "and the sentence counts them: " + all.said);
  const none = readiness({ clock: clockAt(PRE), keys: null, rail: undefined }, PRE);
  eq(codes(none), ["store"], "an unreadable store is its own blocker, not five");
  const noClock = readiness({ clock: null, keys: keysAt("2026-10-09"), rail: undefined }, PRE);
  eq(codes(noClock), ["clock"], "a missing clock row blocks");
}

{
  const live = (over) => readiness({ clock: clockAt(RTH, over), keys: keysAt("2026-10-09"), rail: undefined }, RTH);
  eq(live({}).ok, true, "Tier 1 two minutes old in the session is ready");
  eq(live({}).minutesToOpen, 0, "and the open is now");
  eq(live({}).checks.tier1, "ok", "Tier 1 is checked in the session");
  eq(codes(live({ tier1At: null, tier1OkAt: null })), ["tier1"], "a Tier 1 that never ticked blocks");
  eq(codes(live({ tier1At: RTH - READY_LIMITS.tier1TickMs - 1000 })), ["tier1"], "a tick just past the limit blocks");
  eq(live({ tier1At: RTH - READY_LIMITS.tier1TickMs + 1000 }).ok, true, "just inside it does not");
  const bad = live({ tier1OkAt: RTH - READY_LIMITS.tier1OkMs - 1000, tier1Why: "error:vendor 500" });
  eq(codes(bad), ["tier1"], "ticking with no good read blocks");
  ok(bad.blockers[0].sentence.includes("vendor 500"), "and carries the reason: " + bad.blockers[0].sentence);
  eq(live({ tier1Why: "off" }).blockers[0].sentence.includes("switched off"), true, "a Tier 1 switched off says so");
  eq(live({ trading: 0, tier1Why: "holiday", tier1At: null, tier1OkAt: null }).checks.tier1 !== undefined, true, "a holiday verdict is read");
  const early = Date.parse("2026-10-12T13:35:00Z");
  eq(readiness({ clock: clockAt(early, { tier1At: null, tier1OkAt: null }), keys: keysAt("2026-10-09"), rail: undefined }, early).checks.tier1, "skipped",
    "five minutes after the open Tier 1 is still in its grace");
}

{
  const withRail = (rail, at = RTH) => readiness({ clock: clockAt(at), keys: keysAt("2026-10-09"), rail }, at);
  eq(withRail({ mode: "on", reachable: true, degraded: false, rosterError: false }).ok, true, "a healthy rail is ready");
  eq(codes(withRail({ mode: "off", reachable: true })), ["rail"], "a rail switched off blocks");
  eq(codes(withRail({ mode: "on", reachable: false })), ["rail"], "a rail that does not answer blocks");
  eq(codes(withRail(null)), ["rail"], "a rail read that failed blocks");
  eq(codes(withRail({ mode: "on", reachable: true, degraded: true })), ["rail"], "a degraded rail blocks");
  eq(codes(withRail({ mode: "on", reachable: true, rosterError: true })), ["rail"], "a rail with a roster error blocks");
  eq(withRail({ mode: "off", reachable: true }, SAT).checks.rail, "skipped", "on a Saturday the rail is not required");
  eq(withRail({ mode: "off", reachable: true }, Date.parse("2026-10-12T03:00:00Z")).checks.rail, "skipped", "nor before 04:00 ET");
  eq(withRail({ mode: "off", reachable: true }, PRE).checks.rail, "blocked", "but it is required in the pre-market");
}

{
  const r = readiness({ clock: clockAt(SAT, { day: "2026-10-10", trading: 0 }), keys: keysAt("2026-10-09"), rail: undefined }, SAT);
  eq(r.ok, true, "a weekend with Friday landed is ready");
  eq(r.expected, "2026-10-09", "expecting Friday");
  eq(r.session, "2026-10-12", "for Monday's open");
  eq(r.opens.trt, "16:30 TRT", "printed 16:30 TRT");
  ok(r.minutesToOpen > 2 * 24 * 60 - 1, "more than two days away");
  const p = readiness({ clock: clockAt(POST), keys: keysAt("2026-10-09"), rail: undefined }, POST);
  eq(p.expected, "2026-10-09", "between the close and the five-hour grace, the expected session is still Friday's");
  eq(p.ok, true, "so Monday's own nightly is not yet owed");
  const late = Date.parse("2026-10-13T02:00:00Z");
  eq(readiness({ clock: clockAt(late, { day: "2026-10-12" }), keys: keysAt("2026-10-09"), rail: undefined }, late).blockers[0].code, "nightly",
    "after the grace Monday's nightly is owed");
}

{
  const bad = readiness({}, "x");
  eq(bad.ok, false, "a time that cannot be read is never ready");
  eq(codes(bad), ["clock"], "and says so");
  eq(readiness(null, null).ok, false, "null state and time too");
  ok(Object.isFrozen(readiness({ clock: clockAt(PRE), keys: keysAt("2026-10-09") }, PRE)), "the answer is frozen");
}

{
  eq(healthOf(PRE), { ok: true, asOf: "2026-10-12T11:00:00.000Z", session: "2026-10-12" }, "health is three fields: ok, asOf, session");
  eq(Object.keys(healthOf(PRE)).sort(), ["asOf", "ok", "session"], "and nothing else");
  eq(healthOf(SAT).session, null, "a Saturday has no session");
  eq(healthOf("x").ok, false, "an unreadable time is not ok");
}

{
  const at = (iso) => Date.parse(iso);
  eq(premarketNewsDue(at("2026-10-12T08:00:00Z")), true, "04:00 ET on a trading Monday is due");
  eq(premarketNewsDue(at("2026-10-12T13:00:00Z")), true, "09:00 ET is the last firing");
  eq(premarketNewsDue(at("2026-10-12T13:30:00Z")), false, "09:30 ET is the open, not the pre-market");
  eq(premarketNewsDue(at("2026-10-12T07:30:00Z")), false, "03:30 ET is before the window");
  eq(premarketNewsDue(at("2026-10-12T11:15:00Z")), false, "off the half hour is not a firing");
  eq(premarketNewsDue(at("2026-10-10T11:00:00Z")), false, "a Saturday is not due");
  eq(premarketNewsDue(at("2026-11-26T12:00:00Z")), false, "Thanksgiving is not due");
  let firings = 0;
  for (let m = 0; m < 1440; m += 30) if (premarketNewsDue(at("2026-10-12T00:00:00Z") + m * 60000)) firings++;
  eq(firings, PREMARKET_NEWS.maxFiringsPerDay, "a trading day has exactly the declared number of firings");
  for (const [v, want] of [["on", true], [" ON ", true], ["off", false], ["", false], [undefined, false], ["true", false]]) {
    eq(premarketNewsOn({ FLOWS_PREMARKET_NEWS: v }), want, "FLOWS_PREMARKET_NEWS " + JSON.stringify(v) + " fails closed");
  }

  const wire = { data: [
    { headline: "Older", created_at: "2026-10-12T10:00:00Z", tickers: ["nvda"] },
    { headline: "Newer", created_at: "2026-10-12T11:00:00Z", is_major: true },
    { created_at: "2026-10-12T11:30:00Z" },
  ] };
  const shaped = shapePremarketNews(wire, { at: at("2026-10-12T11:00:00Z"), session: "2026-10-12" });
  eq(shaped.rows.map((r) => r.headline), ["Newer", "Older"], "rows are newest first and a row with no headline is dropped");
  eq([shaped.status, shaped.returned, shaped.kept, shaped.key, shaped.session], ["ok", 3, 2, "live:news", "2026-10-12"], "the payload is the live:news shape");
  eq(shapePremarketNews({ data: [] }, { at: 1, session: "2026-10-12" }).status, "quiet", "no rows is quiet");
  eq(shapePremarketNews({ data: [{}] }, { at: 1, session: "2026-10-12" }).status, "unreadable", "rows without headlines are unreadable");

  const writes = [];
  const calls = [];
  const db = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { writes.push([sql, a]); return {}; } }) }) };
  const env = { DB: db, UW_API_KEY: "k", FLOWS_PREMARKET_NEWS: "on" };
  const fetchVendor = async (path, params) => { calls.push([path, params]); return wire; };
  const T = at("2026-10-12T11:00:00Z");
  const done = await premarketNewsTick(env, T, { fetchVendor });
  eq(done.written, true, "a due firing writes");
  eq(calls, [["/api/news/headlines", { limit: 100 }]], "with exactly one vendor call, the news route");
  eq(writes.length, 1, "and exactly one row");
  eq(writes[0][1].slice(0, 1).concat(writes[0][1].slice(2)), ["live:news", T, "2026-10-12", 1800, "worker", "worker@premarket-news", T], "keyed live:news, session Monday, 30-minute cadence, the Worker as writer");
  for (const [label, e, t, f] of [
    ["the switch off", { ...env, FLOWS_PREMARKET_NEWS: "off" }, T, fetchVendor],
    ["an off-tick minute", env, T + 5 * 60000, fetchVendor],
    ["the open", env, at("2026-10-12T13:30:00Z"), fetchVendor],
    ["no key", { ...env, UW_API_KEY: "" }, T, fetchVendor],
    ["no database", { ...env, DB: null }, T, fetchVendor],
  ]) {
    calls.length = 0;
    const r = await premarketNewsTick(e, t, { fetchVendor: f });
    eq([r.written, calls.length, writes.length], [false, 0, 1], label + " makes no call and writes nothing");
  }
  const logs = [];
  const failed = await premarketNewsTick(env, T, { fetchVendor: async () => { throw new Error("boom"); }, log: { warn: (l) => logs.push(l), error: (l) => logs.push(l), log: (l) => logs.push(l) } });
  eq([failed.written, failed.why, writes.length], [false, "vendor-failed", 1], "a failed vendor read writes nothing and says why");
  const quiet = await premarketNewsTick(env, T, { fetchVendor: async () => ({ data: [] }) });
  eq([quiet.written, quiet.why, writes.length], [false, "quiet", 1], "a quiet feed writes nothing");
}

console.log(`flows-ready: ${checks} checks passed`);
