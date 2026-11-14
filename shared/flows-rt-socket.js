import { STRIP_FIELDS, TICKER_RE, lagSeconds, timeMs } from "./flows-live.js";
import { RT_REST_SHAPE } from "./flows-rt.js";

export const SOCKET_LIMITS = Object.freeze({
  pxMax: 8,
  gxMax: 3,
  joinMax: 16,
  flushMs: 250,
  ackMs: 10000,
  messageBytesMax: 32768,
  backoffMs: Object.freeze([1000, 2000, 4000, 8000, 16000, 30000]),
  silentMs: Object.freeze({ fl: 8000, gx: 20000, nw: 60000, ht: 120000 }),
  pendingMax: Object.freeze({ px: 64, fl: 150, gx: 8, nw: 100, ht: 200 }),
  handlerBudgetMs: 0.05,
  closeNormal: 1000,
});

export const SOCKET_TOPICS = Object.freeze(["px", "fl", "gx", "nw", "ht"]);

export const SOCKET_CHANNELS = Object.freeze({
  px: Object.freeze({ scope: "ticker", channel: (t) => `price:${t}`, template: "price:<T>", max: SOCKET_LIMITS.pxMax }),
  gx: Object.freeze({ scope: "ticker", channel: (t) => `gex:${t}`, template: "gex:<T>", max: SOCKET_LIMITS.gxMax }),
  fl: Object.freeze({ scope: "global", channel: () => "flow-alerts", template: "flow-alerts", max: 1 }),
  nw: Object.freeze({ scope: "global", channel: () => "news", template: "news", max: 1 }),
  ht: Object.freeze({ scope: "global", channel: () => "trading_halts", template: "trading_halts", max: 1 }),
});

export const SOCKET_HOURS = Object.freeze({
  rth: Object.freeze(["rth"]),
  session: Object.freeze(["pre", "rth", "post"]),
});

export const socketPath = "/socket";

export function socketUrl(base, key) {
  if (typeof key !== "string" || !key || typeof base !== "string") return null;
  let u;
  try { u = new URL(base); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = socketPath;
  u.search = "";
  u.hash = "";
  u.searchParams.set("token", key);
  return u.toString();
}

export function socketWindowOk(hours, phaseName) {
  return (SOCKET_HOURS[hours] || SOCKET_HOURS.rth).includes(phaseName);
}

export function wantChannels({ topics, focus = [], gex = [] }) {
  const out = [];
  const has = (k) => topics instanceof Set ? topics.has(k) : Array.isArray(topics) && topics.includes(k);
  const seen = new Set();
  const add = (k, name, channel) => {
    if (seen.has(channel)) return;
    seen.add(channel);
    out.push({ k, name, channel });
  };
  if (has("fl")) add("fl", null, SOCKET_CHANNELS.fl.channel());
  if (has("nw")) add("nw", null, SOCKET_CHANNELS.nw.channel());
  if (has("ht")) add("ht", null, SOCKET_CHANNELS.ht.channel());
  if (has("px")) for (const t of focus.slice(0, SOCKET_CHANNELS.px.max)) if (TICKER_RE.test(t)) add("px", t, SOCKET_CHANNELS.px.channel(t));
  if (has("gx")) for (const t of gex.slice(0, SOCKET_CHANNELS.gx.max)) if (TICKER_RE.test(t)) add("gx", t, SOCKET_CHANNELS.gx.channel(t));
  return out;
}

export function channelTopic(channel) {
  if (typeof channel !== "string") return null;
  if (channel === "flow-alerts") return { k: "fl", name: null };
  if (channel === "news") return { k: "nw", name: null };
  if (channel === "trading_halts") return { k: "ht", name: null };
  const i = channel.indexOf(":");
  if (i <= 0) return null;
  const head = channel.slice(0, i);
  const name = channel.slice(i + 1);
  if (!TICKER_RE.test(name)) return null;
  if (head === "price") return { k: "px", name };
  if (head === "gex") return { k: "gx", name };
  return null;
}

export function parseMessage(text) {
  if (typeof text !== "string") return { kind: "other" };
  let msg;
  try { msg = JSON.parse(text); } catch { return { kind: "other" }; }
  if (!Array.isArray(msg) || msg.length < 2 || typeof msg[0] !== "string") return { kind: "other" };
  const [channel, payload] = msg;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { kind: "other" };
  if (typeof payload.status === "string" && "response" in payload) {
    const detail = payload.response && typeof payload.response === "object" ? payload.response.error : payload.response;
    return { kind: "ack", channel, status: payload.status, detail: typeof detail === "string" ? detail.slice(0, 80) : null };
  }
  return { kind: "data", channel, payload };
}

export function backoffMs(attempt, random = Math.random) {
  const steps = SOCKET_LIMITS.backoffMs;
  const base = steps[Math.min(steps.length - 1, Math.max(0, attempt))];
  return Math.round(base * (0.8 + 0.4 * random()));
}

const PX_AT = 2 + STRIP_FIELDS.findIndex(([n]) => n === "px");
const PREV_AT = 2 + STRIP_FIELDS.findIndex(([n]) => n === "prev");
const CHG_AT = 2 + STRIP_FIELDS.findIndex(([n]) => n === "chg");
const VOL_AT = 2 + STRIP_FIELDS.findIndex(([n]) => n === "vol");
const QA_AT = 2 + STRIP_FIELDS.length - 1;

const roundTo = (v, places) => {
  const m = 10 ** places;
  return Math.round(v * m) / m;
};

const finite = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function patchPxRow(base, tick, at) {
  if (!Array.isArray(base) || base.length !== 2 + STRIP_FIELDS.length) return null;
  if (!tick || typeof tick !== "object") return null;
  const close = finite(tick.close);
  const time = timeMs(tick.time);
  if (close === null || !(close > 0) || !Number.isFinite(time)) return null;
  if (base[1] !== null && !(time > base[1])) return null;
  const row = base.slice();
  row[1] = time;
  row[PX_AT] = roundTo(close, 4);
  const prev = row[PREV_AT];
  row[CHG_AT] = prev !== null && prev !== 0 ? roundTo(close / prev - 1, 6) : row[CHG_AT];
  const vol = finite(tick.vol);
  if (vol !== null && vol >= 0) row[VOL_AT] = Math.round(vol);
  row[QA_AT] = lagSeconds(at, time);
  return row;
}

export function mergePxRow(rest, held) {
  if (!Array.isArray(rest) || !Array.isArray(held) || rest.length !== held.length) return rest;
  if (rest[1] === null || held[1] === null || !(held[1] > rest[1])) return rest;
  const row = rest.slice();
  row[1] = held[1];
  row[PX_AT] = held[PX_AT];
  const prev = row[PREV_AT];
  row[CHG_AT] = prev !== null && prev !== 0 && held[PX_AT] !== null ? roundTo(held[PX_AT] / prev - 1, 6) : held[CHG_AT];
  row[VOL_AT] = held[VOL_AT];
  row[QA_AT] = held[QA_AT];
  return row;
}

const upper = (t) => (typeof t === "string" ? t.trim().toUpperCase() : "");

export function gexBody(payload) {
  return { data: [{ ...payload, start_time: payload.timestamp }] };
}

export function newsBody(payloads) {
  return {
    data: payloads.map((p) => ({
      headline: p.headline, created_at: p.timestamp, source: p.source, tickers: p.tickers,
      tags: [], is_major: null, sentiment: null,
    })),
  };
}

const HALT_STATE_RE = /^[a-z_]{1,20}$/;

const HALT_REASON_RE = /^[A-Z0-9]{0,6}$/;

export function haltRow(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const t = upper(payload.ticker);
  if (!TICKER_RE.test(t)) return null;
  const ts = timeMs(payload.time);
  if (!Number.isFinite(ts)) return null;
  const word = typeof payload.state === "string" ? payload.state.trim().toLowerCase() : "";
  const state = HALT_STATE_RE.test(word) ? word : null;
  const code = typeof payload.reason === "string" ? payload.reason.trim() : null;
  const reason = code !== null && code !== "" && HALT_REASON_RE.test(code) ? code : null;
  return { id: t + "|" + ts + "|" + (state || ""), ts, t, state, reason };
}

export function shapeHalts(batch, { at }) {
  const items = [];
  let dropped = 0;
  let newest = null;
  for (const p of Array.isArray(batch) ? batch : []) {
    const row = haltRow(p);
    if (!row) { dropped++; continue; }
    items.push(row);
    if (newest === null || row.ts > newest) newest = row.ts;
  }
  return { k: "ht", readAt: at, items, vendorAt: newest, meta: { read: Array.isArray(batch) ? batch.length : 0, dropped, via: "socket" }, full: {}, answered: true };
}

export function shapeSocketFrame(k, batch, { at, session, stageOf = null }) {
  if (k === "ht") return shapeHalts(batch, { at });
  if (k === "fl") {
    const out = RT_REST_SHAPE.fl({ data: batch }, { stageOf, cursor: null });
    return { k, readAt: at, ...out, meta: { ...out.meta, via: "socket" } };
  }
  if (k === "nw") {
    const out = RT_REST_SHAPE.nw(newsBody(batch), { at });
    return { k, readAt: at, ...out, meta: { ...out.meta, via: "socket" } };
  }
  if (k === "gx") {
    const items = [];
    let vendorAt = null;
    let polled = null;
    for (const [name, payload] of batch) {
      const out = RT_REST_SHAPE.gx(gexBody(payload), { name, at, session });
      polled = name;
      for (const it of out.items) {
        items.push(it);
        if (it[1] !== null && (vendorAt === null || it[1] > vendorAt)) vendorAt = it[1];
      }
    }
    return { k, readAt: at, items, vendorAt, meta: { polled, status: "ok", reason: null, via: "socket" }, full: {}, answered: true };
  }
  return null;
}

export function shapePxTicks(ticks, held, { at }) {
  const items = [];
  let vendorAt = null;
  for (const [t, tick] of ticks) {
    const row = patchPxRow(held.get(t), tick, at);
    if (!row) continue;
    held.set(t, row);
    items.push(row);
    if (vendorAt === null || row[1] > vendorAt) vendorAt = row[1];
  }
  return { k: "px", readAt: at, items, vendorAt, meta: { status: "ok", reason: null, via: "socket" }, full: {}, answered: true };
}

export function tickerOfPayload(payload) {
  return payload && typeof payload === "object" ? upper(payload.ticker) : "";
}
