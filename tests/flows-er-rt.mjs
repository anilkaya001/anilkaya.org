import assert from "node:assert/strict";
import * as RT from "../shared/flows-rt.js";
import * as SOCK from "../shared/flows-rt-socket.js";
import { createHub } from "../shared/flows-rt-hub.js";
import { serveRt, rtTopics, gateTopics, haltsAdmitted } from "../shared/flows-rt-routes.js";
import { HttpError, json } from "../server/http.js";
import { FRESH_CLASSES, easternInstant } from "../shared/flows-freshness.js";
import { createFakeVendor, fetchFor, createFakeVendorSocket, createVirtualTimers } from "./rt-fixtures.mjs";
import { loadMutated } from "./truth/mutants.mjs";

let checks = 0;
let planted = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const DAY = "2026-09-30";
const at = (h, m, day = DAY) => easternInstant(day, h * 60 + m);
const SESSION_NOW = at(11, 0);
const KEY = "sock-key-halts-5e4d3c2b1a";
const iso = (ms) => new Date(ms).toISOString();
const halt = (ticker, state, reason, time) => ({ ticker, state, reason, time: typeof time === "number" ? iso(time).slice(0, 19) + "Z" : time });

{
  deep(RT.RT_TOPIC_KEYS, ["px", "fl", "gx", "mk", "nw", "ht"], "TOPIC TABLE: the halts channel is the sixth data topic");
  deep(RT.RT_DEFAULT_TOPICS, ["px", "fl", "gx", "mk", "nw"], "and a caller that names no topic is given the five polled ones, never the halts");
  deep(RT.RT_SOCKET_ONLY, ["ht"], "the halts channel is the one topic only the socket carries");
  ok(RT.RT_KINDS.includes("ht") && RT.RT_KINDS.at(-1) === "ctl", "the envelope admits it as a kind");
  const spec = RT.RT_TOPICS.ht;
  deep([spec.klass, spec.cadenceMs, spec.extendedMs, spec.merge, spec.key, spec.stamp, spec.barS, spec.rowMax], ["rtNews", null, null, "append", null, "event", 0, 200],
    "ht: the news class, no cadence (it is never polled), appended by id, no stored twin, at most 200 held");
  eq(RT.rtCadenceMs("ht", "rth"), null, "and no cadence in any phase");
  deep(RT.RT_UPSTREAM.ht.rest({ names: ["SPY"], newerThan: null, name: null }), [], "NO REST REQUEST: the topic table gives the halts channel no REST read at all");
  deep(RT.RT_UPSTREAM.ht.channels, ["trading_halts"], "and one socket channel, trading_halts");
  eq(RT.RT_UPSTREAM.ht.scope, "global", "which is global, not per ticker");
  const budget = RT.createBudget();
  deep(Object.keys(budget.minute(SESSION_NOW)), ["px", "fl", "gx", "mk", "nw"], "the call budget is kept per polled topic: the halts channel spends none");
  const off = RT.socketOnlyStream("ht", DAY);
  deep([off.state, off.reason, off.liveUntil, off.readAt, off.klass, off.cadenceS], ["unavailable", "socket-only", null, null, "rtNews", FRESH_CLASSES.rtNews.cadenceS],
    "SOCKET-ONLY: with the channel down the stream entry is unavailable, reason socket-only, with no live window a client could extrapolate");
  deep(RT.checkFrame(RT.frame("ht", { ep: 5, sq: 0, at: SESSION_NOW, snap: true, fresh: off, meta: { since: iso(SESSION_NOW) }, rows: [] })), [], "and a frame carrying it passes the envelope check");
}

{
  const T = SESSION_NOW - 30000;
  const row = SOCK.haltRow(halt("SYH101", "Halted", "LUDP", T));
  deep(row, { id: "SYH101|" + T + "|halted", ts: T, t: "SYH101", state: "halted", reason: "LUDP" }, "SHAPER: a halt is the row [id, ts, t, state, reason], the state lowercased, the id the ticker, time and state");
  deep(SOCK.haltRow(halt("syh102", "resumed", "", T)), { id: "SYH102|" + T + "|resumed", ts: T, t: "SYH102", state: "resumed", reason: null }, "an empty reason is no reason, shown as a dash, and the ticker is uppercased");
  deep(SOCK.haltRow(halt("SYH103", "Trading Paused!", "T1", T)).state, null, "a state that is not a plain word is withheld, never passed through");
  deep(SOCK.haltRow(halt("SYH104", "halted", "<b>x</b>", T)).reason, null, "and so is a reason that is not a short code");
  deep([
    SOCK.haltRow(halt("SYH101261120C00120000", "halted", "LUDP", T)),
    SOCK.haltRow(halt("bad ticker", "halted", "LUDP", T)),
    SOCK.haltRow(halt("SYH105", "halted", "LUDP", "not a time")),
    SOCK.haltRow(halt("SYH106", "halted", "LUDP", "2026-09-30")),
    SOCK.haltRow(null),
    SOCK.haltRow(["trading_halts"]),
  ], [null, null, null, null, null, null], "an option symbol, a malformed ticker, a time that does not parse or carries no time of day, and anything that is not an object are dropped");
  const batch = [halt("SYH101", "halted", "LUDP", T), halt("SYH101261120C00120000", "halted", "LUDP", T), halt("SYH107", "paused", "LUDP", T + 1000)];
  const f = SOCK.shapeSocketFrame("ht", batch, { at: SESSION_NOW, session: DAY });
  deep([f.k, f.items.length, f.meta.read, f.meta.dropped, f.meta.via, f.vendorAt, f.answered], ["ht", 2, 3, 1, "socket", T + 1000, true], "a batch keeps the rows that parse, counts the dropped one, and stamps the newest halt as the feed's time");
  deep(SOCK.channelTopic("trading_halts"), { k: "ht", name: null }, "the channel maps back to the topic");
  deep(SOCK.wantChannels({ topics: new Set(["ht"]), focus: [], gex: [] }).map((w) => w.channel), ["trading_halts"], "a demand for the halts channel joins exactly trading_halts");
  deep(SOCK.wantChannels({ topics: new Set(["px", "fl"]), focus: ["SPY"], gex: [] }).map((w) => w.channel), ["flow-alerts", "price:SPY"], "and a demand without it never joins it");
  eq(SOCK.SOCKET_LIMITS.silentMs.ht, 120000, "the channel is vouched for while the socket has carried anything in the last 120 s");

  const st = RT.createTopicState("ht");
  const once = RT.mergeTopic("ht", st, f);
  eq(once.rows.length, 2, "MERGE: new halts are appended");
  const twice = RT.mergeTopic("ht", st, SOCK.shapeSocketFrame("ht", batch.slice(0, 1), { at: SESSION_NOW + 1000, session: DAY }));
  deep([twice.rows.length, st.ring.length], [0, 2], "a halt sent again is de-duplicated by id");
  eq(twice.meta.dropped, 1, "and the dropped count is cumulative across frames");
  const many = Array.from({ length: 250 }, (_, i) => halt("SYH" + String(200 + i), i % 2 ? "resumed" : "halted", "LUDP", T + 2000 + i * 10));
  const big = RT.createTopicState("ht");
  RT.mergeTopic("ht", big, SOCK.shapeSocketFrame("ht", many, { at: SESSION_NOW, session: DAY }));
  deep([big.ring.length, big.ring[0].t, big.ring.at(-1).t], [200, "SYH250", "SYH449"], "THE 200 CAP: 250 halts leave the newest 200, oldest first");
  deep(RT.snapshotRows("ht", big).length, 200, "and a snapshot carries the same 200");
}

function rig({ env = {}, refuse = new Set(), start = SESSION_NOW, ackSilent = false, make = createHub } = {}) {
  const state = { t: start };
  const vendor = createFakeVendor({ session: DAY, clock: () => state.t });
  const calls = [];
  const inner = fetchFor(vendor);
  const fetchImpl = (url, init) => { calls.push(String(url)); return inner(url, init); };
  const fake = createFakeVendorSocket({ clock: () => state.t, refuse });
  fake.ackSilent = ackSilent;
  const timers = createVirtualTimers(() => state.t);
  const open = [];
  const hub = make({
    env: {
      FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members", FLOWS_RT_UPSTREAM: "socket", FLOWS_RT_SOCKET_HOURS: "session", UW_API_KEY: KEY, UW_BASE: "http://uw.test",
      FLOWS_EVENTRISK: "on", FLOWS_EVENTRISK_HALTS: "on", ...env,
    },
    now: () => state.t, fetchImpl, connect: fake.connect, timers, random: () => 0.5, log: () => {},
    host: { sockets: () => open.filter((s) => s.readyState === 1), wake() {} }, loadRoster: async () => null,
  });
  const join = (topics) => {
    const ws = {
      readyState: 1, att: null, sent: [],
      send(text) { ws.sent.push(JSON.parse(text)); },
      close() { ws.readyState = 3; },
      serializeAttachment(a) { ws.att = JSON.parse(JSON.stringify(a)); },
      deserializeAttachment() { return ws.att; },
    };
    open.push(ws);
    hub.admit(ws, { u: "member-a", exp: Date.now() + 3600e3, uep: null, topics, f: null });
    return ws;
  };
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const run = async (seconds, stepMs = 250) => {
    for (let i = 0; i < seconds * 1000 / stepMs; i++) {
      const d = await hub.tick();
      await settle();
      state.t += stepMs;
      timers.fire(state.t);
      await settle();
      if (d === null) return;
    }
  };
  return { hub, state, fake, calls, join, run };
}

const htFrames = (ws) => ws.sent.filter((x) => x.k === "ht");
const htOf = (ws) => {
  const hello = ws.sent.find((x) => x.k === "ctl" && x.t === "hello");
  return [...(hello ? hello.rows.filter((x) => x.k === "ht") : []), ...htFrames(ws)];
};

async function hubBattery(make) {
  const out = {};
  const r = make({});
  const ws = r.join(["ht"]);
  const hello = ws.sent.find((x) => x.k === "ctl" && x.t === "hello");
  const snap = hello.rows.find((x) => x.k === "ht");
  out.helloSince = snap.meta.since;
  out.helloState = snap.fresh.state;
  out.helloCheck = RT.checkFrame(snap).length;
  await r.run(3);
  out.joined = r.fake.joined();
  out.liveAfterAck = r.hub.freshOf("ht", r.state.t).state;
  const T = r.state.t - 4000;
  r.fake.push("trading_halts", halt("SYH101", "halted", "LUDP", T));
  r.fake.push("trading_halts", halt("SYH101261120C00120000", "halted", "LUDP", T));
  await r.run(1);
  const rows = htFrames(ws).flatMap((x) => x.rows);
  out.rows = rows.map((x) => x.t);
  out.rowShape = rows[0] ? Object.keys(rows[0]).join(",") : null;
  out.frameState = htFrames(ws).at(-1) ? htFrames(ws).at(-1).fresh.state : null;
  out.frameSince = htFrames(ws).at(-1) ? htFrames(ws).at(-1).meta.since : null;
  r.fake.push("trading_halts", halt("SYH101", "halted", "LUDP", T));
  await r.run(1);
  out.afterRepeat = htFrames(ws).flatMap((x) => x.rows).length;
  await r.run(125, 1000);
  out.silentState = r.hub.freshOf("ht", r.state.t).state;
  out.silentReason = r.hub.freshOf("ht", r.state.t).reason;
  out.restCalls = r.calls.length;
  out.status = r.hub.status().topics.ht;
  out.since = new Date(r.hub.startedAt).toISOString();
  const silent = make({ ackSilent: true });
  silent.join(["ht"]);
  await silent.run(3);
  out.unacked = silent.hub.freshOf("ht", silent.state.t).state;
  const refused = make({ refuse: new Set(["trading_halts"]) });
  refused.join(["ht"]);
  await refused.run(3);
  out.refused = refused.hub.freshOf("ht", refused.state.t).state;
  const off = make({ env: { FLOWS_EVENTRISK_HALTS: "off" } });
  off.join(["ht"]);
  await off.run(3);
  out.offJoined = off.fake.joined();
  out.offDemanded = off.hub.status().topics.ht.demanded;
  const rest = make({ env: { FLOWS_RT_UPSTREAM: "rest" } });
  rest.join(["ht"]);
  await rest.run(60, 1000);
  out.restOnly = { calls: rest.calls.length, state: rest.hub.freshOf("ht", rest.state.t).state, connects: rest.fake.connectCalls };
  const closed = make({ start: at(21, 30) });
  closed.join(["ht"]);
  await closed.run(2);
  out.closed = closed.hub.freshOf("ht", closed.state.t).state;
  const snapRig = make({});
  const snapOut = await snapRig.hub.snap(["ht"]);
  out.snapK = snapOut.frames.map((x) => x.k);
  out.snapSince = snapOut.frames[0].meta.since;
  const def = make({});
  const plain = def.join(undefined);
  out.defaultTopics = plain.sent.find((x) => x.k === "ctl" && x.t === "hello").meta.topics;
  return out;
}

const real = await hubBattery(rig);
eq(real.helloCheck, 0, "HUB: the hello carries a clean halts snapshot");
eq(real.helloSince, real.since, "meta.since is the epoch's start, so the page says since when the stream has been watched");
eq(real.helloState, "unavailable", "before the channel is joined and acknowledged the snapshot says socket-only, not quiet");
deep(real.joined, ["trading_halts"], "a socket that names only ht makes the hub join trading_halts and nothing else");
eq(real.liveAfterAck, "live", "LIVE WHEN ACKNOWLEDGED: once the feed acknowledges the join the channel is live, though no halt has come");
deep(real.rows, ["SYH101"], "a streamed halt reaches the socket and an option symbol does not");
eq(real.rowShape, "id,ts,t,state,reason", "each halt row is an object of id, ts, t, state and reason, as the other appended topics' rows are");
eq(real.frameState, "live", "the frame says the channel is live");
eq(real.frameSince, real.since, "and keeps meta.since");
eq(real.afterRepeat, 1, "the same halt sent twice is delivered once");
deep([real.silentState, real.silentReason], ["unavailable", "socket-only"], "SILENCE: 120 s with nothing at all on the socket and the channel is no longer vouched for");
eq(real.restCalls, 0, "NO REST CALL EVER: two minutes of a demanded halts channel make no REST read");
deep([real.status.demanded, real.status.calls.minute, real.status.calls.hour], [true, 0, 0], "the status lists the topic as demanded with no calls");
eq(real.unacked, "unavailable", "UNACKNOWLEDGED: a join the feed never answers leaves the channel socket-only");
eq(real.refused, "unavailable", "REFUSED: a join the feed refuses leaves it socket-only");
deep([real.offJoined, real.offDemanded], [[], false], "HALTS SWITCH OFF: the hub neither demands the topic nor joins the channel");
deep(real.restOnly, { calls: 0, state: "unavailable", connects: 0 }, "REST UPSTREAM: with the socket upstream off the channel is socket-only and nothing is called");
eq(real.closed, "closed", "OUT OF SESSION the channel is closed, never live");
deep(real.snapK, ["ht"], "SNAPSHOT: a snapshot asked for ht answers ht at once, without waiting for data that only a halt brings");
ok(typeof real.snapSince === "string" && !Number.isNaN(Date.parse(real.snapSince)), "and carries meta.since");
deep(real.defaultTopics, ["px", "fl", "gx", "mk", "nw"], "a socket that names no topic is given the five polled ones");

const env = (over = {}) => ({ FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "members", FLOWS_RT_USERS: "owner-1", FLOWS_EVENTRISK: "on", FLOWS_EVENTRISK_HALTS: "on", ...over });
const namespace = () => {
  const seen = [];
  return {
    seen,
    idFromName: (n) => n,
    get: () => ({
      fetch: async (req) => {
        seen.push(new URL(req.url));
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    }),
  };
};

async function routeBattery(serve) {
  const call = async (query, e, user = "member-a") => {
    const ns = namespace();
    const fullEnv = { ...e, PULSE: ns };
    const url = new URL("https://example.test/api/rt/snap" + query);
    try {
      const res = await serve(new Request(url), fullEnv, url, { json, HttpError, getSession: async () => ({ username: user, exp: Date.now() / 1000 + 3600 }), requireSameOrigin: () => {} });
      return { status: res.status, k: ns.seen.length ? ns.seen[0].searchParams.get("k") : null, dropped: res.headers.get("X-RT-Dropped") };
    } catch (error) {
      return { status: error.status, code: error.code, k: ns.seen.length ? ns.seen[0].searchParams.get("k") : null };
    }
  };
  return {
    open: await call("?k=ht", env()),
    haltsOff: await call("?k=ht", env({ FLOWS_EVENTRISK_HALTS: "off" })),
    haltsOffList: await call("?k=px,ht", env({ FLOWS_EVENTRISK_HALTS: "off" })),
    closedMember: await call("?k=ht", env({ FLOWS_EVENTRISK: "owner" })),
    closedOwner: await call("?k=ht", env({ FLOWS_EVENTRISK: "owner" }), "owner-1"),
    riskOff: await call("?k=nw,ht", env({ FLOWS_EVENTRISK: "off" }), "owner-1"),
    none: await call("", env()),
    plain: await call("?k=px,nw", env({ FLOWS_EVENTRISK_HALTS: "off" })),
  };
}

const routes = await routeBattery(serveRt);
deep(routes.open, { status: 200, k: "ht", dropped: null }, "ROUTE: with the console open and the halts switch on a member's snapshot is forwarded with ht");
deep(routes.haltsOff, { status: 400, code: "invalid_topic", k: null }, "with the halts switch off, ht alone is an unknown topic, refused before the object is asked");
deep(routes.haltsOffList, { status: 200, k: "px", dropped: "ht" }, "and in a list it is dropped from what is forwarded, and the snapshot says so in X-RT-Dropped");
deep(routes.closedMember, { status: 400, code: "invalid_topic", k: null }, "A CLOSED MEMBER: with the console the owner's, a member asking for ht is refused");
deep(routes.closedOwner, { status: 200, k: "ht", dropped: null }, "while the owner is let through");
deep(routes.riskOff, { status: 200, k: "nw", dropped: "ht" }, "with the console off, even the owner's ht is dropped");
deep(routes.none, { status: 200, k: "px,fl,gx,mk,nw", dropped: null }, "a snapshot that names no topic is the five polled ones");
deep(routes.plain, { status: 200, k: "px,nw", dropped: null }, "and a list without ht is forwarded as it came, with no drop header");
deep(rtTopics("ht,px"), { ok: true, topics: ["ht", "px"] }, "the topic parser knows ht");
deep([gateTopics(["ht"], false), gateTopics(["px", "ht"], false), gateTopics(["ht"], true)], [{ ok: false }, { ok: true, topics: ["px"], dropped: "ht" }, { ok: true, topics: ["ht"], dropped: null }], "the gate's three answers");
deep([haltsAdmitted(env(), false), haltsAdmitted(env({ FLOWS_EVENTRISK_HALTS: "off" }), true), haltsAdmitted(env({ FLOWS_EVENTRISK: "owner" }), false), haltsAdmitted(env({ FLOWS_EVENTRISK: "owner" }), true)], [true, false, false, true], "admission is the halts switch and the console's own switch together");

const hubTarget = "shared/flows-rt-hub.js";
const rigFrom = (mod) => (opts) => rig({ ...opts, make: mod.createHub });

const sameHub = (a) => a.helloState === real.helloState && a.liveAfterAck === real.liveAfterAck && a.unacked === real.unacked && a.refused === real.refused &&
  a.restCalls === 0 && a.restOnly.calls === 0 && JSON.stringify(a.offJoined) === "[]" && a.silentState === real.silentState && a.afterRepeat === real.afterRepeat;
ok(sameHub(await hubBattery(rigFrom(await loadMutated(hubTarget, [], { salt: 690 })))), "the hub battery run on an unmutated copy of the module agrees with the real one, so the planted builds below are judged by the same probe");

const hubBuilds = [
  ["the channel live while unacknowledged", [["if (k === \"ht\") return acked.get(\"trading_halts\") === \"ok\" && lastMsgAt !== null && at - lastMsgAt <= L.silentMs.ht;", "if (k === \"ht\") return open;"]]],
  ["a REST fallback invented for the halts channel", [
    ["  const ORDER = [\"px\", \"mk\", \"gx\", \"fl\", \"nw\"];\n  const redact", "  const ORDER = [\"px\", \"mk\", \"gx\", \"fl\", \"nw\", \"ht\"];\n  const redact"],
    ["    const calls = RT_UPSTREAM[k].rest(ready.args);", "    const calls = k === \"ht\" ? [{ feed: \"ht\", path: \"/api/news/headlines\", params: {} }] : RT_UPSTREAM[k].rest(ready.args);"],
    ["      const offsets = { px: 0, gx: 250, mk: 500, fl: 750, nw: 1000 };", "      const offsets = { px: 0, gx: 250, mk: 500, fl: 750, nw: 1000, ht: 1250 };"],
  ]],
  ["the halts switch ignored by the hub", [["    if (!this.haltsOn()) want.delete(\"ht\");\n", ""]]],
  ["a silent socket still vouched for", [["if (k === \"ht\") return acked.get(\"trading_halts\") === \"ok\" && lastMsgAt !== null && at - lastMsgAt <= L.silentMs.ht;", "if (k === \"ht\") return acked.get(\"trading_halts\") === \"ok\";"]]],
];
for (const [name, transforms] of hubBuilds) {
  const out = await hubBattery(rigFrom(await loadMutated(hubTarget, transforms, { salt: 710 + planted })));
  ok(!sameHub(out), `PLANTED WRONG BUILD, ${name}: the hub battery fails it`);
  planted++;
}

const routeBuilds = [
  ["ht admitted for a closed member", [["gateTopics(parsed.topics, haltsAdmitted(env, rtIsOwner(sw, session.username)))", "gateTopics(parsed.topics, true)"]]],
  ["the dropped topic not said", [["        if (asked.dropped) res.headers.set(\"X-RT-Dropped\", asked.dropped);\n", ""]]],
];
const sameRoutes = (r) => JSON.stringify(r) === JSON.stringify(routes);
ok(sameRoutes(await routeBattery((await loadMutated("shared/flows-rt-routes.js", [], { salt: 740 })).serveRt)), "the route battery on an unmutated copy agrees with the real one");
for (const [name, transforms] of routeBuilds) {
  const mod = await loadMutated("shared/flows-rt-routes.js", transforms, { salt: 750 + planted });
  ok(!sameRoutes(await routeBattery(mod.serveRt)), `PLANTED WRONG BUILD, ${name}: the route battery fails it`);
  planted++;
}

{
  const T = SESSION_NOW - 30000;
  const sock = await loadMutated("shared/flows-rt-socket.js", [["  if (!TICKER_RE.test(t)) return null;\n  const ts = timeMs(payload.time);", "  if (!t) return null;\n  const ts = timeMs(payload.time);"]], { salt: 770 });
  ok(sock.haltRow(halt("SYH101261120C00120000", "halted", "LUDP", T)) !== null, "PLANTED WRONG BUILD, an option symbol kept: the shaper keeps it, which the check above refuses");
  planted++;
  const rt = await loadMutated("shared/flows-rt.js", [["      ringMax: RT_TOPICS.ht.rowMax, seenMax: RT_LIMITS.seenMax, frameMax: RT_TOPICS.ht.rowMax,", "      ringMax: Infinity, seenMax: RT_LIMITS.seenMax, frameMax: Infinity,"]], { salt: 780 });
  const many = Array.from({ length: 250 }, (_, i) => halt("SYH" + String(200 + i), "halted", "LUDP", T + i * 10));
  const st = rt.createTopicState("ht");
  rt.mergeTopic("ht", st, SOCK.shapeSocketFrame("ht", many, { at: SESSION_NOW, session: DAY }));
  ok(st.ring.length > 200, `PLANTED WRONG BUILD, the 200 cap missing: the ring grows to ${st.ring.length}, which the cap check refuses`);
  planted++;
}

console.log(`✓ flows-er-rt: ${checks} assertions — the halts channel as the rail's sixth topic: no cadence and no REST read, a socket channel the hub joins only while a member asks and the halts switch is on, rows shaped from the feed's trading_halts payload with option symbols and malformed values dropped and counted, appended by id and capped at 200, live while the feed has acknowledged the join and the socket has carried anything in 120 s and socket-only otherwise, closed out of session, the snapshot answered at once with the epoch's start; the route that refuses ht alone and drops it from a list when the console or the halts switch is closed to the caller; and ${planted} planted wrong builds each failed`);
