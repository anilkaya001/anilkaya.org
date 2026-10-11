import http from "node:http";
import crypto from "node:crypto";
import { makeRng } from "./truth/rng.mjs";
import { w9World } from "./truth/intraday.mjs";
import { w3Hawkes } from "./truth/worlds.mjs";
import { sessionOpen } from "../shared/flows-freshness.js";
import { createFakeVendor } from "./rt-fixtures.mjs";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MINUTE = 60000;
const TICKERS = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "MSFT", "AMZN", "META", "GOOGL"];
const PERISCOPE_FRAMES = 3;
const PERISCOPE_ROWS = 4;

const isoMicro = (ms) => new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");

export const CHAOS_DEFAULTS = Object.freeze({
  lagSpikes: [],
  clockSkewMs: 0,
  duplicateRate: 0,
  reorderWithinMs: 0,
  malformedRate: 0,
  silentChannels: [],
  dropPeriscopeFrame: null,
  maxJoinsPerConnection: 100,
  maxConnections: 8,
  refuse: ["stock_screener"],
  drops: [],
  stalls: [],
  rest429: [],
  restPerMinute: Infinity,
  restFault: null,
});

export function createMarketSim(opts = {}) {
  const o = { seed: "rt-sim", session: "2026-09-30", names: 24, chaos: {}, ...opts };
  const chaos = { ...CHAOS_DEFAULTS, ...o.chaos };
  const open = sessionOpen(o.session);
  const world = w9World({
    names: o.names, sessions: 1, seed: `${o.seed}|market`, innovation: "t", jumpRate: 0.05, headlineRate: 0.6, headlineCausedProbability: 0.3,
    flowAnomalies: 4, badTickRate: 0.05, keepTruth: false,
  });
  const day = world.session(0);
  const tickers = Array.from({ length: o.names }, (_, i) => TICKERS[i] || "SYN" + String(i).padStart(3, "0"));
  const indexOf = new Map(tickers.map((t, i) => [t, i]));
  const root = makeRng(`${o.seed}|log`);
  const p0 = tickers.map((_, i) => 40 + ((i * 37) % 360));
  const log = [];
  let seq = 0;
  const push = (ev) => log.push({ ...ev, seq: seq++ });

  const rPx = root.child("px");
  const cum = new Float64Array(o.names);
  const pxBy = tickers.map(() => []);
  for (let m = 0; m < day.bars; m++) {
    for (let i = 0; i < o.names; i++) {
      cum[i] += day.inc[i * day.bars + m];
      const quoteTime = open + m * MINUTE + Math.floor(rPx.uniform() * 5000);
      const lag = 150 + Math.floor(rPx.uniform() * 700);
      const price = p0[i] * Math.exp(cum[i]);
      const ev = { at: quoteTime + lag, ch: "px", name: i, quoteTime, price: Number(price.toFixed(4)) };
      push(ev);
      pxBy[i].push(ev);
    }
  }

  const rFlow = root.child("flow");
  const flowNames = new Set(day.labels.flowAnomalies.map((f) => f.name));
  for (let i = 0; i < o.names; i++) if (rFlow.uniform() < 0.3) flowNames.add(i);
  let alertId = 0;
  const alertEvents = [];
  for (const i of [...flowNames].sort((a, b) => a - b)) {
    const anomaly = day.labels.flowAnomalies.find((f) => f.name === i);
    const h = w3Hawkes({ seed: `${o.seed}|hawkes|${i}`, mu: anomaly ? 0.12 : 0.03, branching: 0.5 + 0.3 * rFlow.uniform(), beta: 1, markSigma: 0.8 });
    for (let k = 0; k < h.times.length; k++) {
      const start = open + Math.floor(h.times[k] * MINUTE);
      alertEvents.push({ at: start + 900, ch: "alert", name: i, start, premium: Math.round(40000 * (0.5 + h.marks[k]) * (anomaly ? 3 : 1)), cp: k % 2 ? "C" : "P", strike: 100 + ((i * 7 + k) % 40) * 5 });
    }
  }
  alertEvents.sort((a, b) => a.at - b.at || a.name - b.name);
  alertEvents.forEach((ev) => { ev.id = "A" + String(alertId++).padStart(6, "0"); push(ev); });

  const newsEvents = [];
  day.labels.headlines.forEach((h, k) => {
    const at = open + h.minute * MINUTE + 5000;
    const ev = { at, ch: "news", name: h.name, kind: h.kind, index: k };
    newsEvents.push(ev);
    push(ev);
  });

  for (let m = 0; m < day.bars; m++) push({ at: open + m * MINUTE + 2000, ch: "tide", minute: m, value: Number((day.factor[m] * 1e6).toFixed(2)) });

  for (let m = 0; m < day.bars; m++) {
    for (let f = 0; f < PERISCOPE_FRAMES; f++) push({ at: open + m * MINUTE + 1000 + f * 40, ch: "periscope", snapshot: m, frame: f, of: PERISCOPE_FRAMES });
  }

  log.sort((a, b) => a.at - b.at || a.seq - b.seq);
  const digest = () => crypto.createHash("sha256").update(JSON.stringify(log)).digest("hex");

  let nowMs = open;
  const clock = { now: () => nowMs };
  const lagAt = (t) => chaos.lagSpikes.reduce((acc, s) => acc + (t >= s.from && t < s.to ? s.extraMs : 0), 0);
  const skew = (v) => v + chaos.clockSkewMs;

  const render = (ev) => {
    if (ev.ch === "px") return { ticker: tickers[ev.name], price: ev.price, time: skew(ev.quoteTime), volume: 100 + (ev.name * 13) % 900 };
    if (ev.ch === "alert") return alertRow(ev);
    if (ev.ch === "news") return newsRow(ev);
    if (ev.ch === "tide") return { time: skew(open + ev.minute * MINUTE), net_call_premium: ev.value, net_put_premium: -ev.value / 2 };
    return { snapshot: ev.snapshot, frame: ev.frame, of: ev.of, rows: Array.from({ length: PERISCOPE_ROWS }, (_, r) => ({ strike: 5000 + r * 5 + ev.frame * 20, gamma: ((ev.snapshot + r) % 7) - 3 })) };
  };

  const alertRow = (ev) => {
    const t = tickers[ev.name];
    const exp = o.session.replace(/-/g, "").slice(2);
    return {
      id: ev.id, ticker: t, option_chain: `${t}${exp}${ev.cp}${String(ev.strike * 1000).padStart(8, "0")}`,
      created_at: isoMicro(skew(ev.at)), start_time: skew(ev.start), end_time: skew(ev.start + 500),
      total_premium: String(ev.premium), total_size: 10 + (ev.name % 90), trade_count: 1 + (ev.name % 7),
      total_ask_side_prem: String(Math.round(ev.premium * 0.6)), total_bid_side_prem: String(Math.round(ev.premium * 0.3)),
      has_sweep: ev.id.endsWith("0"), has_floor: false, has_singleleg: true, all_opening_trades: false,
      open_interest: 1000 + ev.name, volume_oi_ratio: "1.5", iv_start: "0.30", iv_end: "0.31", underlying_price: String(p0[ev.name]),
      strike: String(ev.strike), expiry: o.session, alert_rule: "RepeatedHits",
    };
  };

  const newsRow = (ev) => ({
    meta: {}, source: ev.index % 3 ? "Business Wire" : "Benzinga", created_at: new Date(skew(ev.at)).toISOString().slice(0, 19) + "Z",
    tags: ["tag-" + (ev.index % 3)], tickers: [tickers[ev.name]], headline: `Synthetic ${ev.kind} headline ${ev.index} on ${tickers[ev.name]}`,
    is_major: ev.index % 10 === 0, sentiment: ["neutral", "positive", "negative"][ev.index % 3],
  });

  const base = createFakeVendor({ session: o.session, clock: () => nowMs });
  const visible = (ev) => ev.at + lagAt(ev.at) <= nowMs;
  const restCalls = [];
  const minuteWindow = [];

  const gate = (path) => {
    restCalls.push({ path, at: nowMs });
    minuteWindow.push(nowMs);
    while (minuteWindow.length && minuteWindow[0] <= nowMs - MINUTE) minuteWindow.shift();
    const w = chaos.rest429.find((r) => nowMs >= r.from && nowMs < r.to);
    if (w) return { status: 429, body: { error: "rate" }, headers: { "Retry-After": String(w.retryAfterS ?? 5) } };
    if (minuteWindow.length > chaos.restPerMinute) return { status: 429, body: { error: "rate" }, headers: { "Retry-After": "5" } };
    if (chaos.restFault === "500") return { status: 500, body: { error: "down" } };
    if (chaos.restFault === "garbage") return { status: 200, body: "<html>not json</html>", raw: true };
    return null;
  };

  const rest = async (path, params = {}) => {
    const refused = gate(path);
    if (refused) return refused;
    if (path === "/api/screener/stocks") {
      const body = base.screener(params);
      for (const row of body.data) {
        const i = indexOf.get(row.ticker);
        if (i === undefined) continue;
        let last = null;
        for (const ev of pxBy[i]) { if (visible(ev)) last = ev; else break; }
        if (last) { row.close = last.price.toFixed(4); row.quote_time = skew(last.quoteTime); }
      }
      return { status: 200, body };
    }
    if (path === "/api/option-trades/flow-alerts") {
      const since = params.newer_than && /T/.test(params.newer_than) ? Date.parse(params.newer_than) : -Infinity;
      const limit = Math.min(Number(params.limit) || 200, 200);
      const rows = [];
      for (let k = alertEvents.length - 1; k >= 0 && rows.length < limit; k--) {
        const ev = alertEvents[k];
        if (!visible(ev)) continue;
        const row = alertRow(ev);
        if (Date.parse(row.created_at) <= since) break;
        rows.push(row);
      }
      return { status: 200, body: { data: rows, newer_than: params.newer_than || o.session, older_than: rows.length ? rows[rows.length - 1].created_at : null } };
    }
    if (path === "/api/news/headlines") {
      const rows = newsEvents.filter(visible).slice(-100).reverse().map(newsRow);
      return { status: 200, body: { data: rows } };
    }
    return base.handle(path, params);
  };

  const fetchImpl = async (input) => {
    const u = new URL(String(input));
    const out = await rest(u.pathname, Object.fromEntries(u.searchParams.entries()));
    return new Response(out.raw ? out.body : JSON.stringify(out.body), { status: out.status, headers: out.headers || {} });
  };

  const httpHandler = async (req, res) => {
    const u = new URL(req.url, "http://sim");
    const out = await rest(u.pathname, Object.fromEntries(u.searchParams.entries()));
    res.writeHead(out.status, { "Content-Type": "application/json", ...(out.headers || {}) });
    res.end(out.raw ? out.body : JSON.stringify(out.body));
  };

  const conns = [];
  let cursor = 0;
  let connSeq = 0;

  const connect = ({ token = "sim-token" } = {}) => {
    const live = conns.filter((c) => !c.closed).length;
    if (live >= chaos.maxConnections) return { error: { status: 429, reason: "connection cap" } };
    const id = connSeq++;
    const handlers = { message: [], close: [] };
    const c = {
      id, token, closed: false, joined: new Map(), queue: [], sent: 0, rng: root.child(`conn${id}`), openedAt: nowMs,
      onMessage: (fn) => handlers.message.push(fn),
      onClose: (fn) => handlers.close.push(fn),
      emit: (text) => { c.sent++; for (const fn of handlers.message) fn(text); },
      shut: (code) => { if (c.closed) return; c.closed = true; for (const fn of handlers.close) fn({ code }); },
      send: (text) => {
        if (c.closed) return;
        let msg;
        try { msg = JSON.parse(text); } catch { return; }
        if (msg.msg_type !== "join" || typeof msg.channel !== "string") return;
        const baseCh = msg.channel.split(":")[0];
        if (chaos.refuse.includes(baseCh) || c.joined.size >= chaos.maxJoinsPerConnection) {
          c.emit(JSON.stringify([msg.channel, { response: { error: "not permitted" }, status: "error" }]));
          return;
        }
        c.joined.set(msg.channel, nowMs);
        c.emit(JSON.stringify([msg.channel, { response: {}, status: "ok" }]));
      },
      close: () => c.shut(1000),
    };
    conns.push(c);
    return c;
  };

  const channelsOf = (ev) => {
    if (ev.ch === "px") return [`price:${tickers[ev.name]}`, "price"];
    if (ev.ch === "alert") return ["flow-alerts"];
    if (ev.ch === "news") return ["news"];
    if (ev.ch === "tide") return ["market_tide"];
    return ["periscope:SPX"];
  };

  const schedule = (c, ev) => {
    const matched = channelsOf(ev).filter((ch) => c.joined.has(ch) && c.joined.get(ch) <= ev.at);
    for (const ch of matched) {
      if (chaos.silentChannels.includes(ch.split(":")[0])) continue;
      if (ev.ch === "periscope" && chaos.dropPeriscopeFrame && chaos.dropPeriscopeFrame.snapshot === ev.snapshot && chaos.dropPeriscopeFrame.frame === ev.frame) continue;
      const text = JSON.stringify([ch, render(ev)]);
      const jitter = chaos.reorderWithinMs > 0 ? Math.floor(c.rng.uniform() * chaos.reorderWithinMs) : 0;
      const at = ev.at + lagAt(ev.at) + jitter;
      const body = chaos.malformedRate > 0 && c.rng.uniform() < chaos.malformedRate ? text.slice(0, Math.max(2, Math.floor(text.length / 2))) : text;
      c.queue.push({ at, seq: c.queue.length ? c.queue[c.queue.length - 1].seq + 1 : 0, text: body, eventAt: ev.at });
      if (chaos.duplicateRate > 0 && c.rng.uniform() < chaos.duplicateRate) c.queue.push({ at: at + Math.floor(c.rng.uniform() * 500), seq: c.queue[c.queue.length - 1].seq + 1, text: body, eventAt: ev.at });
    }
  };

  const advanceTo = (t) => {
    if (t < nowMs) throw new Error("the virtual clock only moves forward");
    while (cursor < log.length && log[cursor].at <= t) {
      const ev = log[cursor++];
      for (const c of conns) if (!c.closed) schedule(c, ev);
    }
    nowMs = t;
    for (const c of conns) {
      if (c.closed) continue;
      const drop = chaos.drops.find((d) => d.conn === c.id && t >= d.at);
      const stalled = chaos.stalls.some((s) => s.conn === c.id && t >= s.from && t < s.to);
      const ready = stalled ? [] : c.queue.filter((q) => q.at <= t).sort((a, b) => a.at - b.at || a.seq - b.seq);
      if (drop) {
        const cut = ready.filter((q) => q.at <= drop.at);
        for (const q of cut) c.emit(q.text);
        c.queue = [];
        c.shut(1006);
        continue;
      }
      if (ready.length) {
        const set = new Set(ready);
        c.queue = c.queue.filter((q) => !set.has(q));
        for (const q of ready) c.emit(q.text);
      }
    }
  };

  const frameText = (text) => {
    const body = Buffer.from(text);
    const head = body.length < 126 ? Buffer.from([0x81, body.length]) : body.length < 65536
      ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(body.length), 2); return h; })();
    return Buffer.concat([head, body]);
  };

  const decodeFrames = (buf) => {
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
  };

  const listen = () => new Promise((resolve) => {
    const server = http.createServer(httpHandler);
    const sockets = new Set();
    server.on("upgrade", (req, socket) => {
      const url = new URL(req.url, "http://sim");
      const token = url.searchParams.get("token") || (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!token) { socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); return; }
      const c = connect({ token });
      if (c.error) { socket.end(`HTTP/1.1 ${c.error.status} Too Many Requests\r\nConnection: close\r\n\r\n`); return; }
      const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + GUID).digest("base64");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => { sockets.delete(socket); c.shut(1000); });
      c.onMessage((text) => { if (!socket.destroyed) socket.write(frameText(text)); });
      c.onClose(() => { if (!socket.destroyed) socket.destroy(); });
      let rest = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        const d = decodeFrames(Buffer.concat([rest, chunk]));
        rest = d.rest;
        for (const f of d.frames) {
          if (f.op === 8) { socket.end(); return; }
          if (f.op === 1) c.send(f.text);
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ url: `ws://127.0.0.1:${port}/socket`, httpUrl: `http://127.0.0.1:${port}`, close: () => { sockets.forEach((s) => s.destroy()); server.close(); } });
    });
  });

  return {
    seed: o.seed, session: o.session, open, tickers, log, digest, chaos, clock, advanceTo,
    advance: (ms) => advanceTo(nowMs + ms), rest, fetch: fetchImpl, httpHandler, connect, listen, restCalls,
    world: day, alerts: alertEvents, news: newsEvents, pxBy, base,
  };
}
