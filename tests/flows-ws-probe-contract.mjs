import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  run, handshake, session, classify, stampMs, stampOf, redactor, CHANNELS, TICKERS, JOIN_STEPS, CONNECTION_STEPS, CONTROL_CHANNEL, FIREHOSES,
  FIREHOSE_SECONDS, PARTS, streamStats, verdictOf, controlTrust, plannedSeconds, createdMinusExecuted, MAX_SECONDS,
} from "../scripts/flows-ws-probe.mjs";

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

const KNOWN = new Set(["market_tide", "price", "gex", "gex_strike", "flow-alerts", "quotes", "net_flow", "news", "option_trades",
  "contract_screener", "lit_trades", "off_lit_trades", "stock_screener"]);

function fakeVendor({ capJoins = 1000, refuse = new Set(["stock_screener"]), control = "refuse" } = {}) {
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
        if (!KNOWN.has(base)) {
          if (control === "refuse") socket.write(frame(JSON.stringify([msg.channel, { response: { error: "unknown channel" }, status: "error" }])));
          if (control === "ack") socket.write(frame(JSON.stringify([msg.channel, { response: {}, status: "ok" }])));
          continue;
        }
        if (refuse.has(base) || joined >= capJoins) {
          socket.write(frame(JSON.stringify([msg.channel, { response: { error: "not permitted" }, status: "error" }])));
          continue;
        }
        joined++;
        socket.write(frame(JSON.stringify([msg.channel, { response: {}, status: "ok" }])));
        if (base === "option_trades") {
          for (let n = 0; n < 5; n++) {
            setTimeout(() => {
              const executed = Date.now() - 120;
              try {
                socket.write(frame(JSON.stringify([msg.channel, { id: n, ticker: "SPY", executed_at: executed,
                  created_at: new Date(executed + 250).toISOString(), premium: "98765.43", secret_value: "do-not-print" }])));
              } catch {}
            }, 80 * (n + 1));
          }
        }
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
  eq(CHANNELS[0], CONTROL_CHANNEL, "the negative control is the first channel of the one list");
  eq(CONTROL_CHANNEL, "w03_nonexistent_channel_zz", "and cannot be a real channel");
  eq([...CHANNELS].sort(), ["contract_screener", "flow-alerts", "gex:SPY", "gex_strike:SPY", "market_tide", "net_flow:SPY", "news",
    "option_trades:NVDA", "option_trades:SPY", "price:NVDA", "price:SPY", "quotes:SPY", CONTROL_CHANNEL].sort(), "one channel list for the rail and the live-flow work");
  eq([...FIREHOSES], ["price", "option_trades", "lit_trades", "off_lit_trades", "stock_screener"], "the five global firehoses are listed apart");
  eq(FIREHOSE_SECONDS, 5, "and listened to for 5 s each");
  ok(!CHANNELS.some((c) => FIREHOSES.includes(c)), "no firehose is also a per-ticker channel");
  const st = streamStats({ arrivals: [1000, 1100, 1200, 1500, 2000], dataBytes: 5000, lags: [10, 20, 30, 40], cx: [250], spanMs: 5000 });
  eq([st.msgPerS, st.bytesPerS, st.activeS], [1, 1000, 5], "messages and bytes a second are counted over the active span");
  eq([st.gapP50Ms, st.gapP95Ms, st.gapSamples], [300, 500, 4], "inter-arrival p50 and p95 come from the gaps between data frames");
  eq([st.lagP50, st.lagP95, st.lagSamples, st.cxP50, st.cxP95], [30, 40, 4, 250, 250], "lag and created-minus-executed are percentiles of their own samples");
  eq(streamStats({ arrivals: [], spanMs: 0 }).msgPerS, null, "no span is no rate, never zero");
  eq(streamStats({ arrivals: [5], dataBytes: 9, spanMs: 1000 }).gapP50Ms, null, "one frame has no inter-arrival");
  eq(stampOf({ executed_at: 1790000000123, created_at: "2026-10-01T14:00:00Z" }).key, "executed_at", "the frame's own trade stamp outranks the vendor's creation stamp");
  eq(stampOf({ created_at: "2026-10-01T14:00:00Z" }).key, "created_at", "a frame with only a creation stamp is measured against it");
  eq(createdMinusExecuted({ executed_at: 1790000000000, created_at: new Date(1790000000250).toISOString() }), 250, "created_at minus executed_at is the vendor's own delay");
  eq(createdMinusExecuted({ executed_at: 1790000000000 }), null, "and null when either is absent");
  eq([verdictOf("a", { acks: { a: "error" } }), verdictOf("a", { acks: { a: "ok" } }), verdictOf("a", { acks: { a: "ok" }, messages: 2 }), verdictOf("a", {})],
    ["refused", "acked-silent", "data", "no-ack"], "a channel is refused, acknowledged but silent, streaming, or never answered");
  eq([controlTrust("refused"), controlTrust("no-ack"), controlTrust("acked-silent"), controlTrust("data")], [true, true, false, false],
    "an acknowledgement is evidence of entitlement only if the control channel was not acknowledged");
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
    const t0 = Date.now();
    const code = await run({ UW_API_KEY: TOKEN, FLOWS_WS_PROBE_URL: v.url, FLOWS_WS_PROBE_SECONDS: "2", FLOWS_WS_PROBE_FIREHOSE_SECONDS: "1" }, (l) => lines.push(l));
    const tookS = (Date.now() - t0) / 1000;
    eq(code, 0, "the probe exits clean");
    const records = lines.map((l) => JSON.parse(l));
    eq(records[0].probe, "start", "it opens with a start record");
    eq(records[records.length - 1].probe, "done", "and closes with done");
    ok(!lines.join("\n").includes(TOKEN), "the token never appears in any output line");
    ok(records.filter((r) => r.probe === "channel").length === CHANNELS.length, "one record per channel");
    ok(!lines.join("\n").includes("do-not-print") && !lines.join("\n").includes("98765.43"), "no payload value reaches the output, only key names");
    eq(records[0].plannedS, plannedSeconds({ seconds: 2, firehoseSeconds: 1 }), "the start record carries the computed duration");
    ok(tookS <= records[0].plannedS, `and the run took ${tookS.toFixed(1)} s, inside the ${records[0].plannedS} s it computed`);
    const chans = records.filter((r) => r.probe === "channel");
    eq(chans.map((r) => r.channels[0]), [...CHANNELS], "channels are probed in the order of the one list, control first");
    eq(chans[0].role, "control", "the first record is marked as the control");
    eq([chans[0].verdict, chans[0].acks[CONTROL_CHANNEL]], ["refused", "error"], "a vendor that refuses the control is classified refused");
    const summary = records.find((r) => r.probe === "channel-verdicts");
    eq([summary.control, summary.acksTrustworthy], ["refused", true], "and its acknowledgements are trusted");
    eq(summary.verdicts["flow-alerts"], "data", "a streaming channel is classified data");
    eq(summary.verdicts["market_tide"], "acked-silent", "an acknowledged channel with no frames is classified silent");
    const ot = chans.find((r) => r.channels[0] === "option_trades:SPY");
    ok(ot.messages === 5 && ot.msgPerS > 0 && ot.bytesPerS > 0, "messages and bytes a second are reported per channel");
    ok(ot.gapP50Ms >= 40 && ot.gapP50Ms <= 400 && ot.gapP95Ms >= ot.gapP50Ms, "inter-arrival p50 and p95 follow the scripted 80 ms stream");
    eq([ot.cxP50, ot.cxP95, ot.cxSamples], [250, 250, 5], "option prints report created_at minus executed_at");
    eq(ot.stampKeys.option_trades, "executed_at", "the stamp the lag was measured against is named");
    ok(ot.lagP50 >= 100 && ot.lagP50 < 3000, "lag is measured against the frame's own stamp");
    ok(ot.keys.option_trades.includes("executed_at") && ot.keys.option_trades.includes("secret_value"), "payload keys are listed by name");
    const fire = records.filter((r) => r.probe === "firehose");
    eq(fire.map((r) => r.channels[0]), [...FIREHOSES], "each of the five firehoses gets its own short session");
    ok(fire.every((r) => r.role === "firehose"), "and is marked as one");
    eq(fire.find((r) => r.channels[0] === "stock_screener").verdict, "refused", "a firehose the key may not join shows as refused");
    eq(fire.find((r) => r.channels[0] === "option_trades").verdict, "data", "and one it may join streams");
    ok(!records.some((r) => r.probe === "channel" && FIREHOSES.includes(r.channels[0])), "no firehose is read as a per-channel record");
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

await Promise.all([["ignore", "no-ack", true], ["ack", "acked-silent", false]].map(async ([mode, verdict, trusted]) => {
  const v = await fakeVendor({ control: mode });
  const lines = [];
  try {
    await run({ UW_API_KEY: TOKEN, FLOWS_WS_PROBE_URL: v.url, FLOWS_WS_PROBE_SECONDS: "2", FLOWS_WS_PROBE_ONLY: "channels" }, (l) => lines.push(l));
    const summary = lines.map((l) => JSON.parse(l)).find((r) => r.probe === "channel-verdicts");
    eq([summary.control, summary.acksTrustworthy], [verdict, trusted],
      `A VENDOR THAT ${mode === "ignore" ? "IGNORES" : "ACKNOWLEDGES"} THE CONTROL CHANNEL is classified ${verdict}, so its acknowledgements ${trusted ? "still mean something" : "mean nothing about entitlement"}`);
  } finally { v.close(); }
}));

{
  const wf = readFileSync(new URL("../.github/workflows/flows-ws-probe.yml", import.meta.url), "utf8");
  const timeoutMin = Number(/timeout-minutes:\s*(\d+)/.exec(wf)[1]);
  const defaultSeconds = Number(/seconds:[\s\S]*?default:\s*"(\d+)"/.exec(wf)[1]);
  ok(defaultSeconds <= MAX_SECONDS && defaultSeconds >= 60, `the dispatched run listens ${defaultSeconds} s per channel`);
  const planned = plannedSeconds({ seconds: defaultSeconds });
  ok(planned > 15 * 60, `the one list takes ${planned} s, more than the 15-minute timeout the old workflow gave it`);
  ok(planned * 1.25 <= timeoutMin * 60, `THE TIMEOUT COVERS THE COMPUTED DURATION: ${timeoutMin} min holds the ${planned} s the list needs with a quarter to spare`);
  ok(PARTS.every((part) => new RegExp(part).test(wf.slice(wf.indexOf("only:"), wf.indexOf("permissions:")))), "the workflow's only input names every part");
  ok(!/\bschedule:|\bpush:|\bpull_request/.test(wf) && /workflow_dispatch:/.test(wf), "and it stays dispatch only");
  ok(plannedSeconds({ seconds: 60, only: ["channels"] }) < plannedSeconds({ seconds: 60 }) && plannedSeconds({ seconds: 5, only: ["handshake"] }) === 30,
    "an only list narrows the computed duration");
}

{
  const lines = [];
  const code = await run({}, (l) => lines.push(l));
  eq(code, 2, "no key is a usage error");
  ok(/not set/.test(lines[0]), "that says why");
}

console.log(`flows-ws-probe-contract: ${checks} checks passed`);
