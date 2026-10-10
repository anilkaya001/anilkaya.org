#!/usr/bin/env node

import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const KEY_ENV = "UW_API_KEY";
export const URL_ENV = "FLOWS_WS_PROBE_URL";
export const SECONDS_ENV = "FLOWS_WS_PROBE_SECONDS";
export const ONLY_ENV = "FLOWS_WS_PROBE_ONLY";
export const FIREHOSE_ENV = "FLOWS_WS_PROBE_FIREHOSE_SECONDS";
export const DEFAULT_URL = "wss://api.unusualwhales.com/socket";
export const DEFAULT_SECONDS = 12;
export const MAX_SECONDS = 60;
export const CONTROL_CHANNEL = "w03_nonexistent_channel_zz";
export const CHANNELS = Object.freeze([
  CONTROL_CHANNEL, "option_trades:SPY", "option_trades:NVDA", "price:SPY", "price:NVDA", "quotes:SPY", "gex:SPY",
  "gex_strike:SPY", "net_flow:SPY", "flow-alerts", "news", "market_tide", "contract_screener",
]);
export const FIREHOSES = Object.freeze(["price", "option_trades", "lit_trades", "off_lit_trades", "stock_screener"]);
export const FIREHOSE_SECONDS = 5;
export const CONTROL_SECONDS = 8;
export const SAMPLE_CAP = 50000;
export const HANDSHAKE_TIMEOUT_S = 10;
export const HOLD_TIMEOUT_S = 8;
export const HOLD_SETTLE_S = 3;
export const SESSION_SLACK_S = 1;
export const PARTS = Object.freeze(["handshake", "channels", "firehoses", "connections", "joins"]);
export const TICKERS = Object.freeze([
  "SPY", "QQQ", "IWM", "DIA", "NVDA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "TSLA", "AVGO", "AMD", "NFLX", "COST",
  "JPM", "XOM", "GLD", "SLV", "COPX", "GDX", "XLE", "XLF", "XLK", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE",
  "XLC", "SMH", "ARKK", "TLT", "HYG", "USO", "UVXY", "SQQQ", "TQQQ", "SOXL", "BAC", "WFC", "GS", "MS", "C", "V", "MA",
  "UNH", "LLY", "ABBV", "MRK", "PFE", "CVX", "COP", "SLB", "OXY", "KO", "PEP", "WMT", "HD",
]);
export const JOIN_STEPS = Object.freeze([1, 10, 30, 60]);
export const CONNECTION_STEPS = 4;
export const HEADER_ECHO = Object.freeze(["server", "cf-ray", "date", "www-authenticate", "sec-websocket-protocol", "content-type"]);
export const SAMPLE_CHARS = 160;

const pct = (list, p) => {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
};

export function redactor(token) {
  return (text) => (token ? String(text).split(token).join("[token]").split(encodeURIComponent(token)).join("[token]") : String(text));
}

export const STAMP_KEYS = Object.freeze(["time", "timestamp", "executed_at", "end_time", "quote_time", "tape_time", "last_time", "ts", "created_at"]);

function valueMs(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export function stampOf(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of STAMP_KEYS) {
    const ms = valueMs(payload[key]);
    if (ms !== null) return { key, ms };
  }
  return null;
}

export function stampMs(payload) {
  const found = stampOf(payload);
  return found ? found.ms : null;
}

export function createdMinusExecuted(payload) {
  if (!payload || typeof payload !== "object") return null;
  const created = valueMs(payload.created_at);
  const executed = valueMs(payload.executed_at);
  return created !== null && executed !== null ? created - executed : null;
}

const rate = (n, spanMs) => (spanMs > 0 ? Math.round((n / (spanMs / 1000)) * 100) / 100 : null);

export function streamStats({ arrivals = [], dataBytes = 0, lags = [], cx = [], spanMs = 0 } = {}) {
  const sorted = [...arrivals].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  return {
    activeS: spanMs > 0 ? Math.round(spanMs / 10) / 100 : 0,
    msgPerS: rate(arrivals.length, spanMs), bytesPerS: rate(dataBytes, spanMs),
    gapP50Ms: pct(gaps, 0.5), gapP95Ms: pct(gaps, 0.95), gapSamples: gaps.length,
    lagP50: pct(lags, 0.5), lagP95: pct(lags, 0.95), lagSamples: lags.length,
    cxP50: pct(cx, 0.5), cxP95: pct(cx, 0.95), cxSamples: cx.length,
  };
}

export function verdictOf(channel, { acks = {}, messages = 0 } = {}) {
  const ack = acks[channel];
  if (messages > 0) return "data";
  if (ack === undefined) return "no-ack";
  return ack === "ok" ? "acked-silent" : "refused";
}

export function controlTrust(verdict) {
  return verdict === "refused" || verdict === "no-ack";
}

export function plannedSeconds({ seconds = DEFAULT_SECONDS, only = [], firehoseSeconds = FIREHOSE_SECONDS } = {}) {
  const s = Math.min(MAX_SECONDS, Math.max(2, Number(seconds) || DEFAULT_SECONDS));
  const wants = (name) => only.length === 0 || only.includes(name);
  let total = 0;
  if (wants("handshake")) total += 3 * HANDSHAKE_TIMEOUT_S;
  if (wants("channels")) total += CHANNELS.reduce((sum, c) => sum + (c === CONTROL_CHANNEL ? Math.min(s, CONTROL_SECONDS) : s) + SESSION_SLACK_S, 0);
  if (wants("firehoses")) total += FIREHOSES.length * (firehoseSeconds + SESSION_SLACK_S);
  if (wants("connections")) total += (CONNECTION_STEPS - 1) * (HOLD_TIMEOUT_S + HOLD_SETTLE_S);
  if (wants("joins")) total += JOIN_STEPS.length * (Math.max(6, Math.floor(s / 2)) + SESSION_SLACK_S);
  return total;
}

export function classify(text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return { kind: "unparsed" }; }
  if (!Array.isArray(msg) || msg.length < 2) return { kind: "other" };
  const [channel, payload] = msg;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.status === "string" && "response" in payload) {
    return { kind: "ack", channel, status: payload.status, detail: payload.response };
  }
  return { kind: "data", channel, payload };
}

export function handshake(url, token, { origin = null, bearer = false, timeoutMs = HANDSHAKE_TIMEOUT_S * 1000, redact = redactor(token) } = {}) {
  return new Promise((resolve) => {
    const target = new URL(url);
    if (!bearer && token) target.searchParams.set("token", token);
    const lib = target.protocol === "wss:" || target.protocol === "https:" ? https : http;
    const headers = {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
    };
    if (bearer) headers.Authorization = `Bearer ${token}`;
    if (origin) headers.Origin = origin;
    const t0 = Date.now();
    let done = false;
    const finish = (out) => { if (!done) { done = true; resolve({ ...out, ms: Date.now() - t0 }); } };
    const req = lib.request({
      protocol: target.protocol === "wss:" ? "https:" : target.protocol === "ws:" ? "http:" : target.protocol,
      hostname: target.hostname, port: target.port || undefined, path: target.pathname + target.search, method: "GET", headers,
    });
    const echo = (res) => Object.fromEntries(HEADER_ECHO.filter((h) => res.headers[h] !== undefined).map((h) => [h, redact(res.headers[h])]));
    req.setTimeout(timeoutMs, () => { finish({ outcome: "timeout" }); req.destroy(); });
    req.on("upgrade", (res, socket) => { finish({ outcome: "upgraded", status: res.statusCode, headers: echo(res) }); socket.destroy(); });
    req.on("response", (res) => {
      const chunks = [];
      res.on("data", (c) => { if (chunks.join("").length < 600) chunks.push(String(c)); });
      res.on("end", () => finish({ outcome: "refused", status: res.statusCode, headers: echo(res), body: redact(chunks.join("")).slice(0, 300) }));
    });
    req.on("error", (e) => finish({ outcome: "error", error: redact(e.message) }));
    req.end();
  });
}

function socketUrl(url, token) {
  const target = new URL(url);
  if (token) target.searchParams.set("token", token);
  return target.toString();
}

export function session(url, token, channels, { seconds = DEFAULT_SECONDS, redact = redactor(token), Socket = globalThis.WebSocket } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out = {
      channels: channels.length > 3 ? { count: channels.length } : channels, acks: {}, ackDetail: {}, messages: 0, bytes: 0,
      dataBytes: 0, firstMsgMs: null, openMs: null, keys: {}, stampKeys: {}, closed: null, error: null,
    };
    const arrivals = [];
    const lags = [];
    const cx = [];
    let openedAt = null;
    let ws;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      const spanMs = openedAt === null ? 0 : Date.now() - openedAt;
      const { dataBytes, ...rest } = out;
      resolve({ ...rest, ...streamStats({ arrivals, dataBytes, lags, cx, spanMs }) });
    };
    const timer = setTimeout(finish, seconds * 1000);
    try { ws = new Socket(socketUrl(url, token)); } catch (e) { out.error = redact(e.message); clearTimeout(timer); resolve(out); return; }
    ws.addEventListener("open", () => {
      openedAt = Date.now();
      out.openMs = openedAt - t0;
      for (const channel of channels) ws.send(JSON.stringify({ channel, msg_type: "join" }));
    });
    ws.addEventListener("message", (event) => {
      const now = Date.now();
      const text = typeof event.data === "string" ? event.data : String(event.data);
      const size = Buffer.byteLength(text);
      out.bytes += size;
      const m = classify(text);
      if (m.kind === "ack") {
        out.acks[m.channel] = m.status;
        if (m.status !== "ok") out.ackDetail[m.channel] = redact(JSON.stringify(m.detail)).slice(0, SAMPLE_CHARS);
        return;
      }
      if (m.kind !== "data") return;
      out.messages += 1;
      out.dataBytes += size;
      if (out.firstMsgMs === null) out.firstMsgMs = now - t0;
      const base = String(m.channel).split(":")[0];
      const sample = Array.isArray(m.payload) ? m.payload[0] : m.payload;
      if (!out.keys[base] && sample && typeof sample === "object") out.keys[base] = Object.keys(sample).slice(0, 30);
      if (arrivals.length >= SAMPLE_CAP) return;
      arrivals.push(now);
      const stamp = stampOf(sample);
      if (stamp !== null) {
        lags.push(now - stamp.ms);
        if (!out.stampKeys[base]) out.stampKeys[base] = stamp.key;
      }
      const gap = createdMinusExecuted(sample);
      if (gap !== null) cx.push(gap);
    });
    ws.addEventListener("error", (e) => { out.error = redact((e && (e.message || e.type)) || "error"); });
    ws.addEventListener("close", (e) => { out.closed = { code: e.code, reason: redact(e.reason || "") }; finish(); });
  });
}

export function holdConnections(url, token, count, { redact = redactor(token), Socket = globalThis.WebSocket, settleMs = HOLD_SETTLE_S * 1000 } = {}) {
  return new Promise((resolve) => {
    const held = [];
    let refused = null;
    let pending = count;
    const settle = () => {
      pending -= 1;
      if (pending > 0) return;
      setTimeout(() => {
        const survivors = held.filter((w) => w.readyState === 1).length;
        held.forEach((w) => { try { w.close(); } catch {} });
        resolve({ asked: count, opened: held.length, survivors, refused });
      }, settleMs);
    };
    for (let i = 0; i < count; i++) {
      let ws;
      try { ws = new Socket(socketUrl(url, token)); } catch (e) { refused = refused || { connection: i + 1, why: redact(e.message) }; settle(); continue; }
      const timer = setTimeout(() => { refused = refused || { connection: i + 1, why: "timeout" }; settle(); }, HOLD_TIMEOUT_S * 1000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ channel: "market_tide", msg_type: "join" }));
      });
      ws.addEventListener("message", (event) => {
        const m = classify(typeof event.data === "string" ? event.data : String(event.data));
        if (m.kind !== "ack") return;
        clearTimeout(timer);
        if (m.status === "ok") held.push(ws);
        else refused = refused || { connection: i + 1, why: m.status };
        settle();
      });
      ws.addEventListener("error", () => { clearTimeout(timer); refused = refused || { connection: i + 1, why: "error" }; settle(); });
      ws.addEventListener("close", (e) => { clearTimeout(timer); if (!held.includes(ws)) { refused = refused || { connection: i + 1, why: `closed ${e.code}` }; } });
    }
  });
}

export async function run(env = process.env, out = (line) => console.log(line)) {
  const token = env[KEY_ENV] || "";
  if (!token) {
    out(JSON.stringify({ probe: "error", reason: `${KEY_ENV} is not set` }));
    return 2;
  }
  const url = env[URL_ENV] || DEFAULT_URL;
  const seconds = Math.min(MAX_SECONDS, Math.max(2, Number(env[SECONDS_ENV]) || DEFAULT_SECONDS));
  const firehoseSeconds = Math.min(FIREHOSE_SECONDS, Math.max(1, Number(env[FIREHOSE_ENV]) || FIREHOSE_SECONDS));
  const only = String(env[ONLY_ENV] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const redact = redactor(token);
  const say = (record) => out(redact(JSON.stringify(record)));
  const wants = (name) => only.length === 0 || only.includes(name);
  say({ probe: "start", endpoint: url.replace(/\?.*$/, ""), seconds, plannedS: plannedSeconds({ seconds, only, firehoseSeconds }), node: process.version,
    at: new Date().toISOString() });
  if (wants("handshake")) {
    say({ probe: "handshake-query-token", ...(await handshake(url, token, { redact })) });
    say({ probe: "handshake-bearer-header", ...(await handshake(url, token, { bearer: true, redact })) });
    say({ probe: "handshake-origin-site", ...(await handshake(url, token, { origin: "https://anilkaya.org", redact })) });
  }
  if (wants("channels")) {
    const verdicts = {};
    for (const channel of CHANNELS) {
      const control = channel === CONTROL_CHANNEL;
      const result = await session(url, token, [channel], { seconds: control ? Math.min(seconds, CONTROL_SECONDS) : seconds, redact });
      const verdict = verdictOf(channel, result);
      verdicts[channel] = verdict;
      say({ probe: "channel", role: control ? "control" : "channel", verdict, ...result });
    }
    const control = verdicts[CONTROL_CHANNEL];
    say({ probe: "channel-verdicts", control, acksTrustworthy: controlTrust(control), verdicts });
  }
  if (wants("firehoses")) {
    for (const channel of FIREHOSES) {
      const result = await session(url, token, [channel], { seconds: firehoseSeconds, redact });
      say({ probe: "firehose", role: "firehose", verdict: verdictOf(channel, result), ...result });
    }
  }
  if (wants("connections")) {
    for (let n = 2; n <= CONNECTION_STEPS; n++) say({ probe: "concurrent-connections", ...(await holdConnections(url, token, n, { redact })) });
  }
  if (wants("joins")) {
    for (const n of JOIN_STEPS) {
      const result = await session(url, token, TICKERS.slice(0, n).map((t) => `price:${t}`), { seconds: Math.max(6, Math.floor(seconds / 2)), redact });
      const acked = Object.values(result.acks).filter((s) => s === "ok").length;
      say({ probe: "joins-per-connection", requested: n, acksOk: acked,
        otherAcks: Object.entries(result.acks).filter(([, s]) => s !== "ok").slice(0, 3), ...result, acks: undefined, ackDetail: undefined });
    }
  }
  say({ probe: "done", at: new Date().toISOString() });
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(await run());
}
