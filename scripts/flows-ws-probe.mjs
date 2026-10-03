#!/usr/bin/env node

import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const KEY_ENV = "UW_API_KEY";
export const URL_ENV = "FLOWS_WS_PROBE_URL";
export const SECONDS_ENV = "FLOWS_WS_PROBE_SECONDS";
export const ONLY_ENV = "FLOWS_WS_PROBE_ONLY";
export const DEFAULT_URL = "wss://api.unusualwhales.com/socket";
export const DEFAULT_SECONDS = 12;
export const MAX_SECONDS = 60;
export const CHANNELS = Object.freeze([
  "market_tide", "price:SPY", "gex:SPY", "flow-alerts", "quotes:SPY", "net_flow:SPY", "news",
  "trading_halts", "option_trades:SPY", "interval_flow", "stock_screener",
]);
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

export function stampMs(payload) {
  if (!payload || typeof payload !== "object") return null;
  for (const key of ["time", "timestamp", "executed_at", "end_time", "quote_time", "tape_time", "last_time", "ts"]) {
    const v = payload[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v > 1e12 ? v : v * 1000;
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
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

export function handshake(url, token, { origin = null, bearer = false, timeoutMs = 10000, redact = redactor(token) } = {}) {
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
      firstMsgMs: null, openMs: null, keys: {}, closed: null, error: null,
    };
    const lag = [];
    let ws;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve({ ...out, lagP50: pct(lag, 0.5), lagP95: pct(lag, 0.95), lagSamples: lag.length });
    };
    const timer = setTimeout(finish, seconds * 1000);
    try { ws = new Socket(socketUrl(url, token)); } catch (e) { out.error = redact(e.message); clearTimeout(timer); resolve(out); return; }
    ws.addEventListener("open", () => {
      out.openMs = Date.now() - t0;
      for (const channel of channels) ws.send(JSON.stringify({ channel, msg_type: "join" }));
    });
    ws.addEventListener("message", (event) => {
      const now = Date.now();
      const text = typeof event.data === "string" ? event.data : String(event.data);
      out.bytes += text.length;
      const m = classify(text);
      if (m.kind === "ack") {
        out.acks[m.channel] = m.status;
        if (m.status !== "ok") out.ackDetail[m.channel] = redact(JSON.stringify(m.detail)).slice(0, SAMPLE_CHARS);
        return;
      }
      if (m.kind !== "data") return;
      out.messages += 1;
      if (out.firstMsgMs === null) out.firstMsgMs = now - t0;
      const base = String(m.channel).split(":")[0];
      const sample = Array.isArray(m.payload) ? m.payload[0] : m.payload;
      if (!out.keys[base] && sample && typeof sample === "object") out.keys[base] = Object.keys(sample).slice(0, 30);
      const ts = stampMs(sample);
      if (ts !== null) lag.push(now - ts);
    });
    ws.addEventListener("error", (e) => { out.error = redact((e && (e.message || e.type)) || "error"); });
    ws.addEventListener("close", (e) => { out.closed = { code: e.code, reason: redact(e.reason || "") }; finish(); });
  });
}

export function holdConnections(url, token, count, { redact = redactor(token), Socket = globalThis.WebSocket, settleMs = 3000 } = {}) {
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
      const timer = setTimeout(() => { refused = refused || { connection: i + 1, why: "timeout" }; settle(); }, 8000);
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
  const only = String(env[ONLY_ENV] || "").split(",").map((s) => s.trim()).filter(Boolean);
  const redact = redactor(token);
  const say = (record) => out(redact(JSON.stringify(record)));
  const wants = (name) => only.length === 0 || only.includes(name);
  say({ probe: "start", endpoint: url.replace(/\?.*$/, ""), seconds, node: process.version, at: new Date().toISOString() });
  if (wants("handshake")) {
    say({ probe: "handshake-query-token", ...(await handshake(url, token, { redact })) });
    say({ probe: "handshake-bearer-header", ...(await handshake(url, token, { bearer: true, redact })) });
    say({ probe: "handshake-origin-site", ...(await handshake(url, token, { origin: "https://anilkaya.org", redact })) });
  }
  if (wants("channels")) {
    for (const channel of CHANNELS) say({ probe: "channel", ...(await session(url, token, [channel], { seconds, redact })) });
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
