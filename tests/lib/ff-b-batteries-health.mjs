import { readFileSync } from "node:fs";
import { healthState, HEALTH_POLL } from "../../server/ff-health.js";
import { limiter } from "./ff-b-kit.mjs";
import { alice, bob, astOf, seedHit, seedRun, seedWire, NOW } from "./ff-b-world.mjs";
import { statementsOf, classify } from "./ff-b-batteries-isolation.mjs";

const TRUTH = JSON.parse(readFileSync(new URL("../fixtures-ff-contract.json", import.meta.url), "utf8")).health;

const trt = (ms) => new Date(ms + 3 * 3600000).toISOString().slice(11, 16) + " TRT";
const iso = (s) => Date.parse(s);

const OPEN = iso("2026-10-27T13:30:00Z");
const NIGHTLY_DONE = iso("2026-10-26T22:10:00Z");
const DAY = 86400000;

const health = (api, user = alice, headers = {}) => api.call("GET", "/api/ff/health", { user, headers });

const seedBase = (api, { nightly = "2026-10-26", live = null, finished = NIGHTLY_DONE } = {}) => {
  if (nightly) seedRun(api.world.f, { id: "nightly:" + nightly, kind: "nightly", session: nightly, finishedAt: finished });
  if (live) seedRun(api.world.f, { id: "live:" + live.session, kind: "live", session: live.session, status: live.status || "done", finishedAt: live.finishedAt, error: live.error || null, startedAt: live.finishedAt - 5000 });
};

const at = (api, ms) => api.setNow(ms);

export async function truthTable(c, build) {
  void build;
  c.ok(TRUTH.length >= 15, "health table: the contract fixture has its rows", TRUTH.length);
  for (const [i, row] of TRUTH.entries()) {
    const got = healthState({ phase: row.phase, liveAgeS: row.liveAgeS, nightlyLate: row.nightlyLate, error: row.error });
    c.eq(got, row.want, "health table: row " + i + " " + JSON.stringify([row.phase, row.liveAgeS, row.nightlyLate, row.error]) + " is " + row.want);
  }
  for (const age of [0, 1, 299, 300, 599, 600]) c.eq(healthState({ phase: "open", liveAgeS: age, nightlyLate: 0, error: false }), "live", "health table: " + age + " s is live");
  for (const age of [601, 700, 899, 900]) c.eq(healthState({ phase: "open", liveAgeS: age, nightlyLate: 0, error: false }), "degraded", "health table: " + age + " s is degraded");
  for (const age of [901, 1200, 86400]) c.eq(healthState({ phase: "open", liveAgeS: age, nightlyLate: 0, error: false }), "down", "health table: " + age + " s is down");
  c.eq(healthState({ phase: "open", liveAgeS: 901, nightlyLate: 1, error: true }), "down", "health table: down outranks degraded");
  c.eq(healthState({ phase: "closed", liveAgeS: 5000, nightlyLate: 0, error: true }), "degraded", "health table: an error while closed is degraded");
  c.eq(healthState({ phase: "open", liveAgeS: undefined, nightlyLate: 0 }), "unknown", "health table: an undefined age is unknown");
}

export async function endToEnd(c, build) {
  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 120000 } });
    const r = await health(api);
    const v = r.body;
    c.eq([r.status, v.state, v.healthy, v.breathes], [200, "live", true, true], "health: a fresh heartbeat is live");
    c.eq(v.line, "Live · checked 2 min ago", "health: the live line");
    c.eq(v.ageS, { v: 120, text: "2 min ago" }, "health: the age in seconds and words");
    c.eq([v.pollAfterS, v.phase, v.session, v.mode], [60, "open", "2026-10-26", "on"], "health: poll every 60 s while open, the nightly session due, the mode");
    c.eq([v.checkedAt.ms, v.checkedAt.text], [NOW - 120000, trt(NOW - 120000)], "health: checked at in TRT");
    c.eq([v.evaluator.live.lastOkAt.ms, v.evaluator.live.cadenceS, v.evaluator.live.error], [NOW - 120000, 300, false], "health: the live block");
    c.eq([v.evaluator.nightly.session, v.evaluator.nightly.status, v.evaluator.nightly.late, v.evaluator.nightly.finishedAt.text], ["2026-10-26", "done", 0, trt(NIGHTLY_DONE)], "health: the nightly block");
    c.eq(v.reason, null, "health: a live state has no reason");
    c.eq(v.v, 1, "health: the API version");
    c.eq(v.serverNow, NOW, "health: the server's clock");
    c.eq(r.headers.vary, "Cookie", "health: the answer varies on the cookie");
    c.ok(/^W\/"ff-[0-9a-f]+"$/.test(r.headers.etag), "health: a weak ETag", r.headers.etag);
    c.eq(v.routes.wires, { available: true, reason: null }, "health: the wires route is available");
    c.eq(v.routes.arming.available, true, "health: arming is available");
    c.eq(v.switchesReadable, true, "health: the switches were readable");
  }

  for (const [age, state, line] of [
    [0, "live", "Live · checked 0s ago"], [59, "live", "Live · checked 59s ago"], [300, "live", "Live · checked 5 min ago"], [599, "live", "Live · checked 9 min ago"], [600, "live", "Live · checked 10 min ago"],
    [601, "degraded", "Degraded · live loop 5 min late"], [750, "degraded", "Degraded · live loop 8 min late"], [900, "degraded", "Degraded · live loop 10 min late"],
    [901, "down", "Down · no heartbeat since " + trt(NOW - 901000)], [3600, "down", "Down · no heartbeat since " + trt(NOW - 3600000)],
  ]) {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - age * 1000 } });
    const r = await health(api);
    c.eq([r.body.state, r.body.line], [state, line], "health: a heartbeat " + age + " s old is " + state);
    if (state === "degraded") c.eq(r.body.reason, "live_late", "health: degraded for a late loop says live_late (" + age + ")");
    if (state === "down") c.eq(r.body.reason, "no_heartbeat", "health: down for a silent loop says no_heartbeat (" + age + ")");
    c.eq([r.body.healthy, r.body.breathes], [state === "live", state === "live"], "health: only live is healthy and breathes (" + age + ")");
  }

  for (const [session, late, state, line] of [
    ["2026-10-26", 0, "live", null], ["2026-10-23", 1, "degraded", "Degraded · nightly 1 session late"], ["2026-10-22", 2, "down", "Down · nightly missing for 2 sessions"], ["2026-10-21", 3, "down", "Down · nightly missing for 3 sessions"],
  ]) {
    const api = build();
    seedBase(api, { nightly: session, live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    const r = await health(api);
    c.eq(r.body.evaluator.nightly.late, late, "health: a nightly of " + session + " is " + late + " late");
    c.eq(r.body.state, state, "health: a nightly " + late + " late is " + state);
    if (line) c.eq(r.body.line, line, "health: the line for a nightly " + late + " late");
    if (late > 0) c.eq(r.body.reason, late >= 2 ? "nightly_missing" : "nightly_late", "health: the reason for " + late + " late");
  }

  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000, error: "feed timeout" } });
    const r = await health(api);
    c.eq([r.body.state, r.body.reason, r.body.line, r.body.evaluator.live.error], ["degraded", "evaluator_error", "Degraded · evaluator error", true], "health: a recorded evaluator error is degraded");
    c.ok(!r.text.includes("feed timeout"), "health: and the error text is not shown to a member");
  }

  {
    const api = build();
    seedBase(api);
    const r = await health(api);
    c.eq([r.body.state, r.body.reason, r.body.line], ["unknown", "unavailable", "— health unavailable: no heartbeat recorded"], "health: open with no heartbeat two hours in is unknown");
    c.eq(r.body.ageS.reason, "not_measured", "health: the age is absent with its reason");
    c.eq([r.body.healthy, r.body.breathes], [null, false], "health: unknown is neither healthy nor unhealthy and does not breathe");
    at(api, OPEN + 3 * 60000);
    const early = await health(api);
    c.eq([early.body.state, early.body.line], ["live", "Live · first check at 16:35 TRT (scheduled)"], "health: three minutes after the open the first check is awaited");
    at(api, OPEN + 11 * 60000);
    const late = await health(api);
    c.eq(late.body.state, "unknown", "health: eleven minutes after the open with no check is unknown");
  }

  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-26", finishedAt: NOW - 3600000 } });
    const r = await health(api);
    c.eq([r.body.state, r.body.line], ["down", "Down · no heartbeat since " + trt(OPEN)], "health: yesterday's heartbeat counts for nothing, the age runs from the open");
    c.eq(r.body.evaluator.live.lastOkAt.reason, "not_measured", "health: so there is no last ok today");
  }

  {
    const api = build();
    const r = await health(api);
    c.eq([r.body.state, r.body.line, r.body.reasonText], ["unknown", "— health unavailable: no nightly run recorded yet", "no nightly run recorded yet"], "health: an empty run table is unknown");
    c.eq(r.body.evaluator.nightly.finishedAt.reason, "not_measured", "health: with an absent finish time");
    const failed = build();
    seedRun(failed.world.f, { id: "nightly:2026-10-26", kind: "nightly", session: "2026-10-26", status: "failed", error: "boom" });
    at(failed, iso("2026-10-27T22:00:00Z"));
    const f = await health(failed);
    c.eq([f.body.state, f.body.reason, f.body.line], ["down", "nightly_missing", "Down · no completed nightly run recorded"], "health: a failed nightly and no good one is down");
    const silent = build();
    seedRun(silent.world.f, { id: "nightly:2026-10-26", kind: "nightly", session: "2026-10-26", status: "failed", error: "boom" });
    const sr = await health(silent);
    c.eq(sr.body.state, "unknown", "health: while open with no heartbeat the contract's precedence puts unknown first");
    seedRun(failed.world.f, { id: "nightly:2026-10-23", kind: "nightly", session: "2026-10-23", status: "done", finishedAt: iso("2026-10-23T22:00:00Z") });
    at(failed, iso("2026-10-27T22:00:40Z"));
    const fallback = await health(failed);
    c.eq(fallback.body.evaluator.nightly.session, "2026-10-23", "health: the latest completed nightly is used when the newest failed");
    c.eq(fallback.body.evaluator.nightly.late, 1, "health: and it is one session late");
  }

  {
    const api = build();
    seedBase(api);
    at(api, iso("2026-10-27T22:00:00Z"));
    const r = await health(api);
    c.eq([r.body.state, r.body.line, r.body.phase, r.body.pollAfterS], ["resting", "Resting · nightly " + trt(NIGHTLY_DONE), "closed", HEALTH_POLL.closedS], "health: after the close it is resting and polls every 300 s");
    c.eq([r.body.breathes, r.body.healthy], [false, true], "health: resting is healthy and does not breathe");
    c.eq(r.body.ageS.reason, "not_measured", "health: a closed session has no live age");
    const weekend = build();
    seedBase(weekend, { nightly: "2026-10-30", finished: iso("2026-10-30T22:10:00Z") });
    at(weekend, iso("2026-10-31T15:00:00Z"));
    const w = await health(weekend);
    c.eq([w.body.state, w.body.session, w.body.phase], ["resting", "2026-10-30", "closed"], "health: on a Saturday the nightly due is Friday's and the market is closed");
    const stale = build();
    seedBase(stale);
    at(stale, iso("2026-10-31T15:00:00Z"));
    const s = await health(stale);
    c.eq([s.body.state, s.body.evaluator.nightly.late], ["down", 4], "health: a Saturday with Monday's nightly is four sessions late");
  }

  {
    const api = build();
    seedBase(api, { nightly: "2026-10-27", finished: iso("2026-10-27T22:10:00Z") });
    at(api, iso("2026-10-28T01:00:00Z"));
    const r = await health(api);
    c.eq([r.body.state, r.body.session], ["resting", "2026-10-27"], "health: after 20:30 ET the day's own nightly is due and found");
    const stale = build();
    seedBase(stale);
    at(stale, iso("2026-10-28T01:00:00Z"));
    const s = await health(stale);
    c.eq([s.body.state, s.body.line], ["degraded", "Degraded · nightly 1 session late"], "health: and without it the nightly is one session late");
    const before = build();
    seedBase(before);
    at(before, iso("2026-10-28T00:29:00Z"));
    const b = await health(before);
    c.eq(b.body.state, "resting", "health: a minute before the 20:30 ET deadline it is not yet late");
  }

  {
    const winter = build();
    seedBase(winter, { nightly: "2026-11-02", finished: iso("2026-11-02T22:10:00Z") });
    at(winter, iso("2026-11-03T14:33:00Z"));
    const w = await health(winter);
    c.eq([w.body.state, w.body.line], ["live", "Live · first check at 17:35 TRT (scheduled)"], "health: under US winter time the open is 17:30 TRT and the first check 17:35");
    const summer = build();
    seedBase(summer);
    at(summer, iso("2026-10-27T13:33:00Z"));
    const s = await health(summer);
    c.eq(s.body.line, "Live · first check at 16:35 TRT (scheduled)", "health: under summer time the open is 16:30 TRT");
    const spring = build();
    seedBase(spring, { nightly: "2026-03-06", finished: iso("2026-03-06T22:10:00Z") });
    at(spring, iso("2026-03-09T13:33:00Z"));
    const sp = await health(spring);
    c.eq(sp.body.line, "Live · first check at 16:35 TRT (scheduled)", "health: the Monday after the clocks change opens at 16:30 TRT");
    const early = build();
    seedRun(early.world.f, { id: "nightly:2026-11-25", kind: "nightly", session: "2026-11-25", finishedAt: iso("2026-11-25T22:10:00Z") });
    at(early, iso("2026-11-27T18:30:00Z"));
    const e = await health(early);
    c.eq(e.body.phase, "closed", "health: half an hour after an early 13:00 ET close the session is closed");
    const normal = build();
    seedRun(normal.world.f, { id: "nightly:2026-11-27", kind: "nightly", session: "2026-11-27", finishedAt: iso("2026-11-27T22:10:00Z") });
    at(normal, iso("2026-11-30T18:30:00Z"));
    seedRun(normal.world.f, { id: "live:2026-11-30", kind: "live", session: "2026-11-30", finishedAt: iso("2026-11-30T18:28:00Z"), startedAt: iso("2026-11-30T18:27:00Z") });
    const n = await health(normal);
    c.eq([n.body.phase, n.body.state], ["open", "live"], "health: the same time on an ordinary day is open");
    const holiday = build();
    seedRun(holiday.world.f, { id: "nightly:2026-11-25", kind: "nightly", session: "2026-11-25", finishedAt: iso("2026-11-25T22:10:00Z") });
    at(holiday, iso("2026-11-26T15:00:00Z"));
    const h = await health(holiday);
    c.eq([h.body.phase, h.body.state, h.body.session], ["closed", "resting", "2026-11-25"], "health: Thanksgiving is closed and the nightly due is Wednesday's");
  }
}

export async function etagAndCache(c, build) {
  const api = build();
  seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
  const first = await health(api);
  const tag = first.headers.etag;
  api.setNow(NOW + 10000);
  const later = await health(api);
  c.eq(later.headers.etag, tag, "etag: ten seconds later the same state has the same tag although the age moved");
  c.ok(later.body.ageS.v !== first.body.ageS.v, "etag: while the age in the body did move", later.body.ageS.v);
  const hit = await health(api, alice, { "If-None-Match": tag });
  c.eq([hit.status, hit.text, hit.headers.etag], [304, "", tag], "etag: a matching If-None-Match is a 304 with no body");
  const plain = await health(api, alice, { "If-None-Match": tag.replace(/^W\//, "") });
  c.eq(plain.status, 304, "etag: the strong spelling of the same tag matches too");
  const list = await health(api, alice, { "If-None-Match": '"nope", ' + tag });
  c.eq(list.status, 304, "etag: a list of tags matches on any");
  const other = await health(api, alice, { "If-None-Match": 'W/"ff-0"' });
  c.eq(other.status, 200, "etag: a different tag is a full answer");
  c.eq(hit.trips <= 3, true, "etag: a 304 still reads the store, it saves bytes and not rows");

  const w = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
  seedHit(api.world.f, { stream: "alice.one", wire: w.body.wire.id, symbol: "SYA101", key: "e1" });
  const moved = await health(api, alice, { "If-None-Match": tag });
  c.eq(moved.status, 200, "etag: a new hit changes the unread count and so the tag");
  c.ok(moved.headers.etag !== tag, "etag: a different one", moved.headers.etag);
  api.setNow(NOW + 20000);
  const bobs = await health(api, bob);
  c.ok(bobs.headers.etag !== moved.headers.etag || bobs.body.unread.member === moved.body.unread.member, "etag: a tag follows the member's own figures");

  const poll = build();
  seedBase(poll, { live: { session: "2026-10-27", finishedAt: NOW - 30000 } });
  const members = Array.from({ length: 30 }, (_, i) => ({ username: "poller" + String.fromCharCode(97 + (i % 26)) + i + ".x", exp: NOW + DAY, epoch: "1" }));
  const from = poll.world.f.trips.length;
  for (const m of members) await health(poll, m);
  const runReads = statementsOf(poll.world.f, from).filter((s) => ["nightlyLatest", "nightlyDone", "liveLatest", "houseMaxSeq", "switches"].includes((classify(s) || {}).name));
  c.eq(runReads.length, 4, "cache: thirty members polling inside thirty seconds read the shared rows once");
  poll.setNow(NOW + 31000);
  const from2 = poll.world.f.trips.length;
  await health(poll, members[0]);
  const again = statementsOf(poll.world.f, from2).filter((s) => ["nightlyLatest", "liveLatest", "houseMaxSeq", "switches"].includes((classify(s) || {}).name));
  c.eq(again.length, 4, "cache: thirty-one seconds later they are read again");
  const bobMember = members[1];
  poll.setNow(NOW + 40000);
  const mine = await health(poll, bobMember);
  c.eq(mine.body.unread.member, 0, "cache: the member's own part is never shared");
  const wire = await poll.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: bobMember });
  seedHit(poll.world.f, { stream: bobMember.username, wire: wire.body.wire.id, symbol: "SYA101", key: "q1" });
  const seen = await health(poll, bobMember);
  c.eq(seen.body.unread.member, 1, "cache: and a new hit shows at once despite the shared cache");
  const neighbour = await health(poll, members[2]);
  c.eq(neighbour.body.unread.member, 0, "cache: another member's count is unaffected");
}

export async function healthGates(c, build) {
  {
    const seen = [];
    const api = build({ world: { env: { FF_HEALTH: limiter(4, seen) } } });
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await health(api)).status);
    c.eq(codes, [200, 200, 200, 200, 429, 429], "gates: four polls a minute, the fifth is refused");
    const r = await health(api);
    c.eq([r.error.code, r.headers["retry-after"]], ["rate_limited", "60"], "gates: with Retry-After");
    c.ok(seen.every((k) => k === "alice.one"), "gates: the limiter is keyed by the session member", [...new Set(seen)]);
    c.eq(r.trips, 0, "gates: a refused poll reads nothing");
  }
  {
    const api = build({ world: { env: { FF_HEALTH: { limit: async () => { throw new Error("binding down"); } } } } });
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    const r = await health(api);
    c.eq(r.status, 200, "gates: a failing limiter fails open");
    const none = build({ world: { env: { FF_HEALTH: undefined } } });
    c.eq((await health(none)).status, 200, "gates: a missing limiter fails open");
  }
  {
    const api = build({ world: { env: { FF_ROUTE_INBOX: "off", FF_ROUTE_EXPORT: "no", FF_ROUTE_FIRE: undefined } } });
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    const r = await health(api);
    c.eq(r.status, 200, "gates: health answers when a route is off");
    c.eq([r.body.routes.inbox, r.body.routes.export, r.body.routes.fire, r.body.routes.wires.available], [{ available: false, reason: "route_off" }, { available: false, reason: "route_off" }, { available: false, reason: "route_off" }, true], "gates: each route says whether it is available and why not");
  }
  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    api.world.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('channel', 'inbox', 'off', 'drill', ?)").run(NOW);
    api.world.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('channel', 'export', 'hold', 'drill', ?)").run(NOW);
    const r = await health(api);
    c.eq([r.body.routes.inbox, r.body.routes.export], [{ available: false, reason: "channel_off" }, { available: true, reason: null }], "gates: a channel off closes it, a hold does not");
    const inbox = await api.call("GET", "/api/ff/hits", { user: alice });
    c.eq([inbox.status, inbox.error.code, inbox.body.reason, inbox.body.channel], [404, "ff_off", "channel_off", "inbox"], "gates: the inbox refuses with its reason and never an empty list");
    const digest = await api.call("GET", "/api/ff/digest", { user: alice });
    c.eq([digest.status, digest.body.reason], [404, "channel_off"], "gates: the digest rides the inbox channel");
    const exp = await api.call("GET", "/api/ff/export?from=2026-10-20&to=2026-10-27", { user: alice });
    c.eq(exp.status, 200, "gates: a held export channel still exports");
    api.setNow(NOW + 40000);
    api.world.f.db.prepare("UPDATE ff_switches SET state = 'on' WHERE scope = 'channel' AND target = 'inbox'").run();
    const back = await api.call("GET", "/api/ff/hits", { user: alice });
    c.eq(back.status, 200, "gates: lifting the switch reopens the inbox after the cache window");
  }
  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    api.world.f.db.prepare("INSERT INTO ff_switches (scope, target, state, reason, set_at) VALUES ('member', 'alice.one', 'off', 'drill', ?)").run(NOW);
    const r = await health(api);
    c.eq(r.body.routes.arming, { available: false, reason: "member_off" }, "gates: a member switch closes arming");
    const create = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
    c.eq([create.status, create.error.code, create.body.reason], [404, "ff_off", "member_off"], "gates: a new wire is refused with the reason");
    const bobCreate = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: bob });
    c.eq(bobCreate.status, 201, "gates: another member is unaffected");
    const list = await api.call("GET", "/api/ff/wires", { user: alice });
    c.eq(list.status, 200, "gates: reading continues for the member who is switched off");
    const retire = await api.call("PATCH", "/api/ff/wires", { body: { id: bobCreate.body.wire.id, status: "retired" }, user: bob });
    c.eq(retire.status, 200, "gates: retiring is never blocked by a switch");
  }
  {
    const api = build();
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    api.world.f.fail(/FROM ff_switches/);
    const r = await health(api);
    c.eq([r.status, r.body.switchesReadable, r.body.routes.arming], [200, false, { available: false, reason: "switches_unreadable" }], "gates: an unreadable switch table is reported and arming stops");
    const wires = await api.call("GET", "/api/ff/wires", { user: alice });
    c.eq(wires.status, 200, "gates: reading continues");
    const create = await api.call("POST", "/api/ff/wires", { body: { ast: astOf() }, user: alice });
    c.eq([create.status, create.body.reason], [404, "switches_unreadable"], "gates: new wires fail closed");
    const mute = await api.call("POST", "/api/ff/mute", { body: { symbol: "SYA101", mute: true }, user: alice });
    c.eq(mute.status, 200, "gates: a mute is not arming");
  }
  {
    const api = build();
    api.world.f.fail(/FROM ff_run/);
    const r = await health(api);
    c.eq([r.status, r.error && r.error.code], [503, "store_unreadable"], "gates: an unreadable run table is a 503 and not a guess");
  }
  {
    const api = build({ deps: { readClock: async () => { throw new Error("clock row gone"); } } });
    seedBase(api, { live: { session: "2026-10-27", finishedAt: NOW - 60000 } });
    const r = await health(api);
    c.eq([r.status, r.body.state], [200, "live"], "gates: a failing clock row falls back to the calendar");
  }
  {
    const api = build();
    const post = await api.call("POST", "/api/ff/health", { body: {}, user: alice });
    c.eq([post.status, post.error.code], [405, "method_not_allowed"], "gates: health is GET only");
    c.ok(post.headers.allow && post.headers.allow.includes("GET"), "gates: with Allow", post.headers.allow);
  }
}
