import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { startWorker, SESSION_SECRET } from "./worker-server.mjs";
import { signFlowsSession } from "../shared/flows-auth.js";
import { checkFrame, createSeq, RT_TOPIC_KEYS, RT_CLOSE, RT_ROW_FIELDS } from "../shared/flows-rt.js";
import { createFakeVendor, vendorHandler } from "./rt-fixtures.mjs";
import { fakeBoards } from "../scripts/flows-legs/live-fake.mjs";
import { easternDay, easternInstant, nextTradingDay } from "../shared/flows-freshness.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const deep = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const INGEST = "test-ingest-token-abcdefghijklmnopqrstuv";
const KEY = "test-uw-key";
const DAY = "2026-09-30";
const SATURDAY = "2026-10-03T15:00:00Z";
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

const RX = Symbol("rx");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, ms, label) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + label);
    await sleep(25);
  }
}

async function startVendor(vendor) {
  const handler = vendorHandler(vendor);
  const seen = { unauthorised: 0, authorised: 0 };
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== "Bearer " + KEY) {
      seen.unauthorised++;
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ reason: "malformed_token" }));
      return;
    }
    seen.authorised++;
    handler(req, res).catch(() => { res.writeHead(500); res.end("{}"); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

function connect(baseURL, cookie, { query = "", headers = {} } = {}) {
  const frames = [];
  const state = { opened: false, closed: null, error: null, bye: null };
  const ws = new WebSocket(baseURL.replace(/^http/, "ws") + "/api/rt/ws" + query, { headers: { Cookie: cookie, ...headers } });
  ws.onopen = () => { state.opened = true; };
  ws.onmessage = (e) => {
    const f = JSON.parse(String(e.data));
    f[RX] = Date.now();
    frames.push(f);
    if (f.k === "ctl" && f.t === "bye") {
      state.bye = f.meta;
      setTimeout(() => { try { ws.close(); } catch { return; } }, 50);
    }
  };
  ws.onclose = (e) => { state.closed = { code: e.code, reason: e.reason }; };
  ws.onerror = (e) => { state.error = e.message || "error"; };
  const c = {
    ws, frames, state,
    send: (x) => ws.send(typeof x === "string" || x instanceof ArrayBuffer ? x : JSON.stringify(x)),
    close: () => { try { ws.close(); } catch { return; } },
    data: (k) => frames.filter((f) => f.k === k),
    ctl: (t) => frames.filter((f) => f.k === "ctl" && f.t === t),
  };
  return c;
}

function rawUpgrade(baseURL, path, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(baseURL);
    const req = http.request({
      host: u.hostname, port: u.port, path, method: "GET",
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), "Sec-WebSocket-Version": "13", ...headers },
    });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve({ status: res.statusCode, headers: res.headers }); });
    req.on("response", (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const cookieFor = async (user, ttl = 3600) => "flows_session=" + await signFlowsSession(user, SESSION_SECRET, ttl, "1", 0);

const statusOf = async (base, cookie) => {
  const res = await fetch(base + "/api/rt/status", { headers: { Cookie: cookie } });
  return { res, body: await res.json() };
};

const cleanFrames = (c, label) => {
  const bad = c.frames.map((f) => [f, checkFrame(f)]).filter(([, p]) => p.length);
  eq(bad.length, 0, `${label}: every frame is a clean envelope (${bad.length ? JSON.stringify(bad[0][1]) : "none bad"})`);
};

const seqVerdicts = (c) => {
  const seq = createSeq();
  const v = {};
  for (const f of c.frames) {
    if (f.k === "ctl") { if (f.t === "hello") for (const inner of f.rows) seq.accept(inner); continue; }
    const r = seq.accept(f).verdict;
    v[r] = (v[r] || 0) + 1;
  }
  return v;
};

const OWNER = await cookieFor("anilkaya");
const MEMBER = await cookieFor("firatgok");

const hubClock = { offset: 0 };
const wallOf = (hubMs) => hubMs - hubClock.offset;

async function runMain() {
  const vendor = createFakeVendor({ session: DAY, clock: () => Date.now() + hubClock.offset });
  const uw = await startVendor(vendor);
  const server = await startWorker({
    extraVars: [`UW_API_KEY:${KEY}`, `UW_BASE:${uw.base}`, "UW_NOW:2026-09-30T14:00:00Z", "FLOWS_RT_SCALE:0.2", `FLOWS_INGEST_TOKEN:${INGEST}`],
  });
  const base = server.baseURL;
  const opened = [];
  try {
    {
      const s0 = await statusOf(base, OWNER);
      eq(s0.res.status, 200, "status: the owner reads it");
      hubClock.offset = s0.body.now - Date.now();
      eq(s0.body.running, false, "idle: with nobody connected the hub is not running");
      deep(s0.body.worker, { mode: "on", audience: "owner", users: ["anilkaya"], hint: "enam", binding: true }, "status: carries the Worker's switches");
      eq(s0.body.phase.phase, "rth", "the harness clock is pinned to 10:00 ET on a Wednesday");
      eq(vendor.calls.length, 0, "idle: no viewer, no vendor call");
    }

    {
      const anonWs = await rawUpgrade(base, "/api/rt/ws", {});
      eq(anonWs.status, 401, "anonymous: the upgrade is refused with 401, before any Durable Object is woken");
      deep(JSON.parse(anonWs.body).error, { code: "unauthorized", message: "Authentication required" }, "anonymous: in the project's JSON error envelope");
      eq(anonWs.headers["cache-control"], "no-store", "anonymous: no-store on the refusal");
      for (const path of ["/api/rt/snap", "/api/rt/status"]) {
        const res = await fetch(base + path);
        eq(res.status, 401, `anonymous: ${path} is 401`);
        eq(res.headers.get("cache-control"), "no-store", `anonymous: ${path} is no-store`);
        eq(res.headers.get("x-content-type-options"), "nosniff", `anonymous: ${path} carries the security headers`);
      }
      const memberWs = await rawUpgrade(base, "/api/rt/ws", { Cookie: MEMBER });
      eq(memberWs.status, 403, "member: audience owner refuses a signed-in member at the upgrade");
      const memberSnap = await fetch(base + "/api/rt/snap", { headers: { Cookie: MEMBER } });
      deep([memberSnap.status, (await memberSnap.json()).error.code], [403, "rt_forbidden"], "member: and the snapshot route");
      eq((await fetch(base + "/api/rt/status", { headers: { Cookie: MEMBER } })).status, 403, "member: and status");
      const learn = await signFlowsSession("anilkaya", "wrong-secret", 3600, "1", 0);
      eq((await rawUpgrade(base, "/api/rt/ws", { Cookie: "flows_session=" + learn })).status, 401, "a session signed with another secret is anonymous");
      eq((await fetch(base + "/api/rt/ws", { headers: { Cookie: OWNER } })).status, 426, "owner: a plain GET of the socket route is 426");
      eq((await fetch(base + "/api/rt/ws", { method: "POST", headers: { Cookie: OWNER } })).status, 405, "owner: POST is 405");
      const evil = await rawUpgrade(base, "/api/rt/ws", { Cookie: OWNER, Origin: "https://evil.example" });
      eq(evil.status, 403, "origin: a cross-origin upgrade is refused");
      const site = await rawUpgrade(base, "/api/rt/ws", { Cookie: OWNER, "Sec-Fetch-Site": "cross-site" });
      eq(site.status, 403, "origin: and so is Sec-Fetch-Site cross-site");
      const evilClient = connect(base, OWNER, { headers: { Origin: "https://evil.example" } });
      await until(() => evilClient.state.closed || evilClient.state.error, 5000, "a refused cross-origin socket");
      eq(evilClient.state.opened, false, "origin: a client from another origin never opens");
      eq(vendor.calls.length, 0, "refused connections never wake the hub: still no vendor call");
      const page = await fetch(base + "/flows/", { headers: { Cookie: OWNER } });
      ok((page.headers.get("content-security-policy") || "").includes("connect-src 'self' wss://anilkaya.org"), "csp: HTML allows the secure socket to the apex explicitly");
    }

    {
      const up = await rawUpgrade(base, "/api/rt/ws", { Cookie: OWNER });
      eq(up.status, 101, "owner: the upgrade through the Worker's finalizer is 101");
      ok(up.headers["sec-websocket-accept"], "101: with its accept token");
      eq(up.headers["x-content-type-options"], "nosniff", "101: the finalizer's security headers are on the switch");
      eq(up.headers["cache-control"], "no-store", "101: no-store");
      ok(up.headers["strict-transport-security"] && up.headers["x-frame-options"] === "DENY", "101: all seven headers");
      eq(up.headers["content-security-policy"], undefined, "101: no CSP on a non-document");
      await until(async () => (await statusOf(base, OWNER)).body.running === false, 8000, "the abandoned raw socket to be released");
    }

    for (const side of ["long", "short", "watch"]) {
      const boards = fakeBoards({ n: 20, sessionDate: "2026-09-29", session: "2026-09-29" });
      const res = await fetch(base + "/api/flows/ingest?key=board:" + side, {
        method: "POST", headers: { Authorization: "Bearer " + INGEST, "Content-Type": "application/json" },
        body: JSON.stringify({ side, status: "ok", generatedAt: new Date().toISOString(), sessionDate: "2026-09-29", rows: boards[side].rows }),
      });
      eq(res.status, 200, `seed: board:${side} stored`);
    }

    const c1 = connect(base, OWNER, { query: "?f=nvda" });
    opened.push(c1);
    await until(() => c1.frames.length > 0, 8000, "the hello");
    const hello = c1.frames[0];
    deep([hello.k, hello.t, hello.meta.transport, hello.meta.upstream, hello.meta.mode, hello.meta.audience], ["ctl", "hello", "ws", "rest", "on", "owner"], "owner: hello is the first frame, over a websocket, from a REST upstream");
    deep(hello.rows.map((f) => f.k), RT_TOPIC_KEYS, "hello: a snapshot frame for each of the five topics");
    eq(hello.meta.f, "NVDA", "hello: the focus ticker from the query, upper-cased");
    ok(hello.rows.every((f) => f.snap === true && f.ep === hello.ep), "hello: snapshots in the hello's epoch");

    await until(() => RT_TOPIC_KEYS.every((k) => c1.data(k).some((f) => f.rows.length)), 15000, "rows on all five topics");
    await until(() => c1.data("px").filter((f) => !f.snap).length >= 3 && c1.data("fl").filter((f) => !f.snap).length >= 3 &&
      RT_TOPIC_KEYS.every((k) => c1.data(k).some((f) => !f.snap)), 25000, "a few delta frames");
    ok(c1.state.opened, "the socket is open");
    cleanFrames(c1, "c1");
    const v = seqVerdicts(c1);
    ok(!v.gap && !v.dup && !v.orphan, `c1: per-topic sequences are clean through real workerd: ${JSON.stringify(v)}`);
    for (const k of RT_TOPIC_KEYS) {
      const frames = c1.data(k);
      const deltas = frames.filter((f) => !f.snap);
      ok(deltas.length >= 1, `${k}: delta frames follow the snapshot, so a socket keeps its identity between events (${deltas.length} deltas of ${frames.length})`);
      deep(frames.map((f) => f.sq), frames.map((_, i) => frames[0].sq + i), `${k}: sq rises by exactly one per frame`);
      ok(frames.every((f) => f.ep === hello.ep), `${k}: one epoch`);
    }
    const px = c1.data("px").find((f) => f.rows.length);
    eq(px.rows[0].length, RT_ROW_FIELDS.px.length, "px: a row is ticker, quote time and the 23 strip values");
    deep(px.meta.cols, RT_ROW_FIELDS.px, "px: the snapshot names its columns");
    ok(px.rows.some((r) => r[0] === "SYL001") && px.rows.some((r) => r[0] === "NVDA"), "px: the roster is the boards seeded in D1 plus the focus names");
    const pxCall = vendor.paramsOf(/screener/)[0].ticker.split(",");
    ok(pxCall.includes("SYL001") && pxCall.includes("NVDA") && pxCall.length >= 60, `px: the vendor was asked for the roster in one call (${pxCall.length} names)`);
    ok(new Set(vendor.calls.filter((c) => /screener/.test(c.path)).map((c) => c.params.ticker)).size === 1, "px: the same call every time");
    eq(px.fresh.klass, "rt", "px: freshness class rt");
    ok(["live", "fresh"].includes(px.fresh.state), `px: a stamped vendor read is ${px.fresh.state}`);
    eq(uw.seen.unauthorised, 0, "the vendor key travelled as a bearer token on every call");
    ok(vendor.calls.some((c) => c.path === "/api/stock/NVDA/spot-exposures"), "gx: the focus ticker is read");
    const fl = c1.data("fl").find((f) => f.rows.length);
    ok(fl.rows.every((r) => typeof r.id === "string" && Number.isFinite(r.ts) && typeof r.prem === "number"), "fl: alert rows carry id, ts and the live:alerts fields");
    ok(fl.rows.some((r) => r.st === "board:long" || r.st === "board:short" || r.st === null), "fl: the stage comes from the boards in D1");
    const mk = c1.data("mk").find((f) => f.snap && f.rows.length);
    ok(mk.rows.some((r) => r.id === "tide") && mk.rows.filter((r) => r.etf).length >= 11, "mk: the tide and the sector ETFs");

    const c2 = connect(base, OWNER, { query: "?k=px,fl" });
    opened.push(c2);
    await until(() => c2.frames.length > 0, 8000, "the second hello");
    const hello2 = c2.frames[0];
    deep([hello2.meta.cold, hello2.rows.map((f) => f.k)], [false, ["px", "fl"]], "second socket: a warm hub, and only the topics asked for");
    ok(hello2.rows.every((f) => f.rows.length > 0 && f.fresh.state !== "pending"), "second socket: the hello carries real snapshots");
    ok(hello2.ep === hello.ep, "second socket: the same epoch");
    await until(() => c2.data("px").length >= 3, 8000, "deltas on the second socket");
    const v2 = seqVerdicts(c2);
    ok(!v2.gap && !v2.dup && !v2.orphan, `second socket: sequences are clean from the first delta: ${JSON.stringify(v2)}`);
    eq(c2.data("gx").length + c2.data("mk").length + c2.data("nw").length, 0, "second socket: nothing arrives for a topic it did not ask for");

    {
      const lat = [];
      const hop = [];
      for (const f of c1.data("fl")) {
        if (f.snap) continue;
        hop.push(f[RX] - wallOf(f.at));
        for (const r of f.rows) lat.push(f[RX] - wallOf(r.ts));
      }
      ok(lat.length >= 3, `latency: ${lat.length} alerts measured`);
      console.log(`rt e2e (scale 0.2, fl polled every 1 s): alert created -> client p50 ${pct(lat, 0.5)} ms, p95 ${pct(lat, 0.95)} ms; hub send -> client p50 ${pct(hop, 0.5)} ms, p95 ${pct(hop, 0.95)} ms`);
      ok(pct(hop, 0.95) < 500, `latency: hub to client on loopback is ${pct(hop, 0.95)} ms at p95`);
    }

    {
      const { res, body } = await statusOf(base, OWNER);
      eq(res.status, 200, "status: owner");
      eq(body.running, true, "status: running while sockets are connected");
      deep(body.sockets.byUser, { anilkaya: 2 }, "status: sockets by user");
      eq(body.upstream.kind, "rest", "status: upstream kind");
      deep(body.killSwitches, { FLOWS_RT_MODE: "on", FLOWS_RT_AUDIENCE: "owner" }, "status: kill switches");
      for (const k of RT_TOPIC_KEYS) {
        const t = body.topics[k];
        ok(t.hasData && t.sq > 0 && t.frames > 0 && t.lastFrameAgeMs !== null && t.calls.minute > 0, `status ${k}: sq ${t.sq}, ${t.frames} frames, last frame ${t.lastFrameAgeMs} ms ago, ${t.calls.minute} calls in the last minute`);
      }
      ok(body.topics.px.rowLagMs.n > 0 && body.topics.px.rowLagMs.p95 !== null, `status: px vendor lag p50 ${body.topics.px.rowLagMs.p50} ms, p95 ${body.topics.px.rowLagMs.p95} ms`);
      ok(body.topics.gx.lagMs.n > 0 && body.topics.mk.lagMs.n > 0, "status: gx and mk lag are sampled");
      ok(body.calls.minuteTotal > 0 && body.calls.perMinute === 1200, "status: calls against the budget (240 a minute, scaled by the harness clock to 1200)");
      ok(body.roster.n >= 60, `status: roster of ${body.roster.n} names from D1`);
      deep(body.roster.focus, ["NVDA"], "status: the focus set");
    }

    {
      const bin = connect(base, OWNER);
      opened.push(bin);
      await until(() => bin.frames.length > 0, 8000, "hello for the message test");
      bin.send(new Uint8Array([1, 2, 3]).buffer);
      await until(() => bin.state.closed, 5000, "close on binary");
      eq(bin.state.closed.code, RT_CLOSE.tooBig, "message: a binary frame closes the socket with 1009");
      const junk = connect(base, OWNER);
      opened.push(junk);
      await until(() => junk.frames.length > 0, 8000, "hello for the junk test");
      junk.send("x".repeat(300));
      await until(() => junk.state.closed, 5000, "close on oversize");
      eq(junk.state.closed.code, RT_CLOSE.tooBig, "message: 300 bytes closes with 1009");
      const odd = connect(base, OWNER);
      opened.push(odd);
      await until(() => odd.frames.length > 0, 8000, "hello for the type test");
      odd.send({ t: "nope" });
      await until(() => odd.state.closed, 5000, "close on unknown type");
      eq(odd.state.closed.code, RT_CLOSE.tooBig, "message: an unknown type closes with 1009");

      c2.send({ t: "sub", k: ["px"] });
      await sleep(200);
      const mark = c2.frames.length;
      await until(() => c2.frames.length > mark + 2, 8000, "frames after sub");
      ok(c2.frames.slice(mark).filter((f) => f.k !== "ctl").every((f) => f.k === "px"), "sub: after narrowing to px only px frames arrive");
      c2.send({ t: "sub", k: ["px", "mk"] });
      await until(() => c2.data("mk").some((f) => f.snap), 5000, "an mk snapshot after sub");
      ok(true, "sub: adding mk delivers its snapshot at once");
      const before = c2.data("px").filter((f) => f.snap).length;
      c2.send({ t: "rs", k: "px" });
      await until(() => c2.data("px").filter((f) => f.snap).length > before, 5000, "a px snapshot after rs");
      ok(true, "rs: a resync request returns a px snapshot");
      c2.send({ t: "p", sq: { px: 0 } });
      await until(() => c2.state.closed, 5000, "a laggard to be closed");
      eq(c2.state.closed.code, RT_CLOSE.laggard, "p: a client reporting itself far behind is closed with 4008");
    }

    {
      const cap = [];
      for (let i = 0; i < 2; i++) {
        const c = connect(base, OWNER);
        cap.push(c);
        opened.push(c);
        await until(() => c.frames.length > 0, 8000, `cap socket ${i + 1}`);
      }
      await sleep(300);
      ok(cap.every((c) => !c.state.bye && !c.state.closed), "cap: with c1 open, two more fit under three");
      const four = connect(base, OWNER);
      opened.push(four);
      await until(() => four.state.bye, 8000, "the fourth socket to be told to go");
      deep([four.state.bye.code, four.state.bye.reason], [RT_CLOSE.cap, "connection-cap"], "cap: the fourth gets a bye frame with 4009 and the reason");
      ok(four.ctl("hello").length === 0, "cap: and never received a hello");
      const held = (await statusOf(base, OWNER)).body.sockets;
      deep([held.n, held.byUser.anilkaya], [3, 3], "cap: the server counts three sockets for the user, the refused one released");
      for (const c of cap) c.close();
      await sleep(300);
    }

    {
      const snap = await fetch(base + "/api/rt/snap?k=px,fl,mk", { headers: { Cookie: OWNER } });
      eq(snap.status, 200, "snap: the owner reads it");
      eq(snap.headers.get("cache-control"), "no-store", "snap: no-store");
      eq(snap.headers.get("x-content-type-options"), "nosniff", "snap: through the finalizer");
      for (const h of ["x-fresh-state", "x-fresh-reason", "x-fresh-class", "x-fresh-read-at", "x-fresh-source", "x-fresh-cadence", "x-fresh-session", "x-fresh-live-until", "x-fresh-stale-at", "x-fresh-phase", "x-server-now"]) {
        ok(snap.headers.has(h), `snap: ${h} is set`);
      }
      eq(snap.headers.get("x-fresh-source"), "hub", "snap: X-Fresh-Source is hub");
      eq(snap.headers.get("x-fresh-phase"), "rth", "snap: X-Fresh-Phase");
      const frames = await snap.json();
      deep(frames.map((f) => f.k), ["px", "fl", "mk"], "snap: an array of envelopes, in the order asked");
      ok(frames.every((f) => f.snap === true && checkFrame(f).length === 0 && f.rows.length > 0), "snap: clean snapshots, from the hub's memory");
      eq((await fetch(base + "/api/rt/snap?k=px,zz", { headers: { Cookie: OWNER } })).status, 400, "snap: an unknown topic is 400");
    }

    {
      const c = connect(base, OWNER);
      opened.push(c);
      await until(() => c.data("px").some((f) => f.rows.length), 8000, "a healthy px before the outage");
      const sqBefore = c.frames[c.frames.length - 1].ep;
      vendor.fault = "500";
      const deg = await until(() => c.ctl("degraded")[0], 20000, "a degraded frame");
      eq(deg.meta.reason, "http_5xx", "outage: degraded names its reason");
      ok(deg.meta.k.includes("px"), "outage: and the topics that are down");
      const hbs = await until(() => c.ctl("hb").filter((f) => f.meta.upstream === "down")[0], 10000, "a heartbeat that says the upstream is down");
      ok(hbs.meta.degraded && hbs.meta.topics.px.fresh, "outage: the heartbeat carries per-topic freshness");
      const st = (await statusOf(base, OWNER)).body;
      eq(st.topics.px.lastError.code, "http_5xx", "outage: status shows the last upstream error per topic");
      ok(st.degraded && st.degraded.reason === "http_5xx", "outage: and the degraded episode");
      const mark = c.frames.length;
      vendor.fault = null;
      await until(() => c.ctl("resync").some((f) => f.meta.reason === "recovered"), 25000, "a resync after recovery");
      await until(() => c.frames.slice(mark).some((f) => f.k === "px" && f.snap), 8000, "a px snapshot after recovery");
      ok(c.frames.slice(mark).filter((f) => f.k !== "ctl").every((f) => f.ep === sqBefore), "recovery: same epoch, because the hub never restarted");
      const vv = seqVerdicts(c);
      ok(!vv.gap && !vv.dup, `recovery: sequences clean through the outage: ${JSON.stringify(vv)}`);

      vendor.fault = "429";
      vendor.retryAfterS = 2;
      const d429 = await until(() => c.ctl("degraded").find((f) => f.meta.reason === "vendor-throttled"), 15000, "a 429 degrade");
      ok(d429.meta.retryAt, "429: degraded at once with the instant of the next try");
      const quietAt = vendor.calls.length;
      await sleep(900);
      ok(vendor.calls.length - quietAt <= 2, `429: the pause holds the hub off the vendor (${vendor.calls.length - quietAt} calls in 0.9 s)`);
      vendor.fault = null;
      vendor.retryAfterS = null;
      const mark2 = c.ctl("resync").length;
      await until(() => c.ctl("resync").length > mark2, 25000, "recovery from the 429");
      c.close();
    }

    {
      await sleep(13000);
      for (const c of opened) c.close();
      await sleep(1200);
      const calls = vendor.calls.length;
      await sleep(2500);
      eq(vendor.calls.length, calls, "idle: after the last socket closes the vendor is not called again");
      const s = (await statusOf(base, OWNER)).body;
      deep([s.running, s.sockets.n], [false, 0], "idle: status says the hub stopped");
      const hitsAt = vendor.calls.length;
      const warm = await fetch(base + "/api/rt/snap?k=px,mk", { headers: { Cookie: OWNER } });
      const first = await warm.json();
      eq(first.length, 2, "snap: a request with no socket wakes the hub");
      await until(() => vendor.calls.length > hitsAt + 3, 8000, "polling to begin for a snapshot reader");
      const second = await (await fetch(base + "/api/rt/snap?k=px,mk", { headers: { Cookie: OWNER } })).json();
      ok(second.every((f) => f.rows.length > 0 && f.fresh.state !== "pending"), "snap: the next request is served from warm memory");
      let last = vendor.calls.length;
      let stable = 0;
      const end = Date.now() + 30000;
      while (Date.now() < end && stable < 3) {
        await sleep(1000);
        stable = vendor.calls.length === last ? stable + 1 : 0;
        last = vendor.calls.length;
      }
      ok(stable >= 3, "snap: polling stops by itself some seconds after the last request (60 s of demand at scale 1)");
    }

    {
      const short = await cookieFor("anilkaya", 3);
      const c = connect(base, short);
      await until(() => c.frames.length > 0, 8000, "hello for the short session");
      await until(() => c.state.bye, 12000, "the session to expire");
      deep([c.state.bye.code, c.state.bye.reason], [RT_CLOSE.expired, "session-expired"], "expiry: a socket outliving its session gets a bye frame with 4001");
      await until(async () => (await statusOf(base, OWNER)).body.running === false, 8000, "the hub to stop after its only socket expired");
      ok(true, "expiry: and with no socket left the hub stops");
    }
  } finally {
    for (const c of opened) c.close();
    await server.stop();
    await uw.close();
  }
}

async function runClosed() {
  const vendor = createFakeVendor({ session: "2026-10-02", clock: () => Date.now() + hubClock.offset });
  const uw = await startVendor(vendor);
  const server = await startWorker({ extraVars: [`UW_API_KEY:${KEY}`, `UW_BASE:${uw.base}`, `UW_NOW:${SATURDAY}`, "FLOWS_RT_SCALE:0.2"] });
  try {
    const c = connect(server.baseURL, OWNER);
    await until(() => c.ctl("closed")[0], 8000, "a closed frame");
    const closed = c.ctl("closed")[0];
    deep([closed.meta.reason, closed.meta.phase], ["weekend", "closed"], "closed: a Saturday says weekend");
    const monday = new Date(easternInstant(nextTradingDay(easternDay(Date.parse(SATURDAY))), 4 * 60)).toISOString();
    eq(closed.meta.nextOpenAt, monday, `closed: and when it resumes: ${closed.meta.nextOpenAt} (the next trading day's 04:00 ET)`);
    await until(() => c.ctl("hb")[0], 8000, "a closed heartbeat");
    eq(c.ctl("hb")[0].meta.upstream, "closed", "closed: the heartbeat says the upstream is closed, not down");
    await sleep(2000);
    eq(vendor.calls.length, 0, "closed: a whole socket's lifetime on a Saturday makes zero vendor calls");
    const snap = await (await fetch(server.baseURL + "/api/rt/snap?k=px", { headers: { Cookie: OWNER } })).json();
    ok(snap.some((f) => f.k === "ctl" && f.t === "closed"), "closed: the snapshot route says so too");
    eq(vendor.calls.length, 0, "closed: and still no vendor call");
    c.close();
  } finally {
    await server.stop();
    await uw.close();
  }
}

async function runOff() {
  const server = await startWorker({ extraVars: ["FLOWS_RT_MODE:off"] });
  try {
    for (const path of ["/api/rt/ws", "/api/rt/snap", "/api/rt/status"]) {
      for (const cookie of [null, OWNER]) {
        const res = await rawUpgrade(server.baseURL, path, cookie ? { Cookie: cookie } : {});
        deep([res.status, JSON.parse(res.body).error.code, res.headers["cache-control"]], [404, "rt_off", "no-store"], `off: ${path} ${cookie ? "owner" : "anonymous"} answers JSON 404 rt_off`);
      }
    }
    const c = connect(server.baseURL, OWNER);
    await until(() => c.state.closed || c.state.error, 5000, "a refused socket");
    eq(c.state.opened, false, "off: no socket opens");
    eq((await fetch(server.baseURL + "/api/me")).status, 200, "off: the rest of the Worker is untouched");
  } finally {
    await server.stop();
  }
}

async function runCadence() {
  const vendor = createFakeVendor({ session: DAY, clock: () => Date.now() + hubClock.offset });
  const uw = await startVendor(vendor);
  const server = await startWorker({ extraVars: [`UW_API_KEY:${KEY}`, `UW_BASE:${uw.base}`, "UW_NOW:2026-09-30T14:00:00Z"] });
  const base = server.baseURL;
  try {
    hubClock.offset = (await statusOf(base, OWNER)).body.now - Date.now();
    const c = connect(base, OWNER, { query: "?f=nvda" });
    await until(() => c.data("px").some((f) => f.rows.length) && c.data("fl").some((f) => f.rows.length), 20000, "first frames at production cadence");
    await sleep(2000);
    const t0 = vendor.calls.length;
    const startedAt = Date.now();
    await sleep(60000);
    const window = vendor.calls.slice(t0);
    const per = (re) => window.filter((x) => re.test(x.path)).length;
    const secs = (Date.now() - startedAt) / 1000;
    const rates = { px: per(/screener/), fl: per(/flow-alerts/), gx: per(/spot-exposures/), mk: per(/market-tide|sector-etfs/), nw: per(/news/) };
    console.log(`rt vendor calls in ${secs.toFixed(0)} s at production cadence: ${JSON.stringify(rates)} (${window.length} total)`);
    ok(rates.px >= 11 && rates.px <= 13, `cadence: px about every 5 s (${rates.px} calls a minute)`);
    ok(rates.fl >= 11 && rates.fl <= 13, `cadence: fl about every 5 s (${rates.fl})`);
    ok(rates.gx >= 3 && rates.gx <= 5, `cadence: gx reads the one focus name about every 15 s (${rates.gx})`);
    ok(window.filter((x) => /spot-exposures/.test(x.path)).every((x) => x.path === "/api/stock/NVDA/spot-exposures"), "cadence: and no other name");
    ok(rates.mk >= 10 && rates.mk <= 14, `cadence: mk every 10 s, two calls a poll (${rates.mk})`);
    ok(rates.nw >= 1 && rates.nw <= 3, `cadence: news every 30 s (${rates.nw})`);
    ok(window.length <= 240, `cadence: under the 240-call budget (${window.length})`);
    const lat = [];
    const hop = [];
    for (const f of c.data("fl")) {
      if (f.snap) continue;
      hop.push(f[RX] - wallOf(f.at));
      for (const r of f.rows) lat.push(f[RX] - wallOf(r.ts));
    }
    const pxLag = (await statusOf(base, OWNER)).body.topics.px;
    console.log(`rt e2e (production cadence): alert created -> client p50 ${pct(lat, 0.5)} ms, p95 ${pct(lat, 0.95)} ms over ${lat.length} alerts; hub send -> client p50 ${pct(hop, 0.5)} ms, p95 ${pct(hop, 0.95)} ms; px quote age at the hub p50 ${pxLag.rowLagMs.p50} ms, p95 ${pxLag.rowLagMs.p95} ms`);
    ok(lat.length >= 20, `cadence: ${lat.length} alerts measured`);
    ok(pct(lat, 0.95) < 8000, `cadence: an alert reaches the client within ${pct(lat, 0.95)} ms at p95, one poll interval plus the hop`);
    c.close();
  } finally {
    await server.stop();
    await uw.close();
  }
}

await runMain();
await runClosed();
await runOff();
await runCadence();

console.log(`✓ flows-rt-server: ${checks} assertions — real workerd, persisted Durable Object storage, a fake vendor on loopback and real WebSocket clients: 401 without a session, 403 for a member under the owner audience, a cross-origin upgrade refused, the 101 through the finalizer with its security headers, hello and snapshots then deltas with per-topic sq rising by one, a warm second socket, messages validated (1009), sub, rs, laggard (4008), the connection cap (4009), expiry (4001), a vendor outage that degrades and recovers with a resync, a 429 pause, polling that stops when the last socket closes, the snapshot route with X-Fresh headers, owner-only status, a closed Saturday that costs no vendor call, the kill switch, and the vendor call rate at production cadence`);
