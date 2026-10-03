import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { run, handshake, session, classify, stampMs, redactor, CHANNELS, TICKERS, JOIN_STEPS, CONNECTION_STEPS } from "../scripts/flows-ws-probe.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const TOKEN = "secret-token-4f9c1d";
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
}

function decode(buf) {
  const out = [];
  let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15;
    let len = buf[i + 1] & 127;
    let p = i + 2;
    if (len === 126) { len = buf.readUInt16BE(p); p += 2; }
    const masked = (buf[i + 1] & 128) !== 0;
    const mask = masked ? buf.subarray(p, p + 4) : null;
    if (masked) p += 4;
    if (p + len > buf.length) break;
    const body = Buffer.from(buf.subarray(p, p + len));
    if (mask) for (let k = 0; k < body.length; k++) body[k] ^= mask[k % 4];
    out.push({ op, text: body.toString() });
    i = p + len;
  }
  return { frames: out, rest: buf.subarray(i) };
}

function fakeVendor({ capJoins = 1000, refuse = new Set(["stock_screener"]) } = {}) {
  const server = http.createServer((req, res) => { res.statusCode = 404; res.end("no"); });
  const sockets = new Set();
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    const bearer = (req.headers.authorization || "") === `Bearer ${TOKEN}`;
    if (url.searchParams.get("token") !== TOKEN && !bearer) {
      socket.end(`HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\ninvalid token ${url.searchParams.get("token") || ""}`);
      return;
    }
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nServer: fake\r\n\r\n`);
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let joined = 0;
    let rest = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      const d = decode(Buffer.concat([rest, chunk]));
      rest = d.rest;
      for (const f of d.frames) {
        if (f.op === 8) { socket.end(); return; }
        if (f.op !== 1) continue;
        const msg = JSON.parse(f.text);
        const base = msg.channel.split(":")[0];
        if (refuse.has(base) || joined >= capJoins) {
          socket.write(frame(JSON.stringify([msg.channel, { response: { error: "not permitted" }, status: "error" }])));
          continue;
        }
        joined++;
        socket.write(frame(JSON.stringify([msg.channel, { response: {}, status: "ok" }])));
        if (base === "flow-alerts" || base === "price") {
          for (let n = 0; n < 3; n++) socket.write(frame(JSON.stringify([msg.channel, { id: n, ticker: "SPY", end_time: new Date(Date.now() - 400).toISOString(), total_premium: "1" }])));
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ url: `ws://127.0.0.1:${server.address().port}/socket`, close: () => { sockets.forEach((s) => s.destroy()); server.close(); } });
  }));
}

{
  const r = redactor(TOKEN);
  eq(r(`x ${TOKEN} y ${encodeURIComponent(TOKEN)}`), "x [token] y [token]", "redactor removes the token in both spellings");
  eq(redactor("")("abc"), "abc", "an empty token redacts nothing");
  eq(stampMs({ end_time: "2026-10-01T14:00:00Z" }), Date.parse("2026-10-01T14:00:00Z"), "an ISO stamp reads as milliseconds");
  eq(stampMs({ time: 1790000000 }), 1790000000000, "epoch seconds scale to milliseconds");
  eq(stampMs({ time: 1790000000123 }), 1790000000123, "epoch milliseconds stay");
  eq(stampMs({ none: 1 }), null, "no stamp field reads as null");
  eq(classify('["price:SPY",{"response":{},"status":"ok"}]').kind, "ack", "an ack is recognised");
  eq(classify('["price:SPY",{"price":1}]').kind, "data", "a data frame is recognised");
  eq(classify("not json").kind, "unparsed", "garbage is unparsed");
  ok(CHANNELS.includes("market_tide") && CHANNELS.includes("flow-alerts") && CHANNELS.includes("price:SPY"), "the channels the hub design needs are probed");
  ok(TICKERS.length >= JOIN_STEPS[JOIN_STEPS.length - 1], "enough tickers for the largest join step");
}

{
  const v = await fakeVendor();
  try {
    const good = await handshake(v.url, TOKEN);
    eq([good.outcome, good.status], ["upgraded", 101], "a valid token upgrades");
    const bad = await handshake(v.url, "wrong-one");
    eq([bad.outcome, bad.status], ["refused", 401], "a wrong token is refused with its status");
    ok(!JSON.stringify(bad).includes(TOKEN), "the refusal never carries the real token");
    const bearer = await handshake(v.url, TOKEN, { bearer: true });
    eq(bearer.outcome, "upgraded", "a bearer header upgrades");
    const s = await session(v.url, TOKEN, ["flow-alerts", "stock_screener"], { seconds: 1.5 });
    eq(s.acks["flow-alerts"], "ok", "a permitted join is acknowledged");
    eq(s.acks.stock_screener, "error", "a refused join is recorded as an error ack");
    ok(/not permitted/.test(s.ackDetail.stock_screener), "and its detail is kept");
    ok(s.messages >= 3 && s.firstMsgMs !== null, "data frames are counted with the time of the first");
    ok(s.lagP50 !== null && s.lagP50 >= 0 && s.lagP50 < 5000, "lag is receive time minus the frame's own stamp");
    ok(Array.isArray(s.keys["flow-alerts"]) && s.keys["flow-alerts"].includes("ticker"), "only the key names of a payload are kept");
    ok(!JSON.stringify(s).includes("total_premium\":\"1\""), "no payload value is kept");
  } finally { v.close(); }
}

{
  const v = await fakeVendor({ capJoins: 30 });
  const lines = [];
  try {
    const code = await run({ UW_API_KEY: TOKEN, FLOWS_WS_PROBE_URL: v.url, FLOWS_WS_PROBE_SECONDS: "2" }, (l) => lines.push(l));
    eq(code, 0, "the probe exits clean");
    const records = lines.map((l) => JSON.parse(l));
    eq(records[0].probe, "start", "it opens with a start record");
    eq(records[records.length - 1].probe, "done", "and closes with done");
    ok(!lines.join("\n").includes(TOKEN), "the token never appears in any output line");
    ok(records.filter((r) => r.probe === "channel").length === CHANNELS.length, "one record per channel");
    const sc = records.find((r) => r.probe === "channel" && JSON.stringify(r.channels) === '["stock_screener"]');
    eq(sc.acks.stock_screener, "error", "a channel the key may not join shows as an error");
    const joins = records.filter((r) => r.probe === "joins-per-connection");
    eq(joins.map((j) => j.requested), [...JOIN_STEPS], "every join step is probed");
    eq(joins.map((j) => j.acksOk), [1, 10, 30, 30], "acknowledged joins stop at the vendor's cap");
    const conns = records.filter((r) => r.probe === "concurrent-connections");
    eq(conns.map((c) => c.asked), Array.from({ length: CONNECTION_STEPS - 1 }, (_, i) => i + 2), "connection counts are stepped");
    ok(conns.every((c) => c.opened === c.asked && c.survivors === c.asked), "a permissive vendor holds every connection");
    const hs = records.filter((r) => r.probe.startsWith("handshake"));
    eq(hs.map((h) => h.outcome), ["upgraded", "upgraded", "upgraded"], "all three handshakes are recorded");
  } finally { v.close(); }
}

{
  const lines = [];
  const code = await run({}, (l) => lines.push(l));
  eq(code, 2, "no key is a usage error");
  ok(/not set/.test(lines[0]), "that says why");
}

console.log(`flows-ws-probe-contract: ${checks} checks passed`);
