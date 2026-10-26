export const PACK_KEY = "pk";
export const PACK_VERSION = 1;
export const PACK_PREFIX = '{"pk":1,';
export const PACK_ANY_PREFIX = '{"pk":';
export const PACK_SKIP = Object.freeze({ 1: Object.freeze(["engine", "short", "insiders", "earnings", "dx", "vx"]) });
export const PACK_RESERVED = Object.freeze(["pk", "d0", "dd", "__proto__"]);
export const PACK_MIN_DAYS = 3;
export const SOFT_BYTES_PLACEHOLDER = 99999;

const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(PACK_RESERVED);

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function dayNumber(text) {
  if (typeof text !== "string" || !DAY_RE.test(text)) return null;
  const ms = Date.parse(text + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text ? ms / DAY_MS : null;
}

const dayText = (n) => new Date(n * DAY_MS).toISOString().slice(0, 10);

function gapsOf(list) {
  if (!Array.isArray(list) || list.length < PACK_MIN_DAYS) return null;
  const first = dayNumber(list[0]);
  if (first === null) return null;
  const gaps = [];
  let prev = first;
  for (let i = 1; i < list.length; i++) {
    const at = dayNumber(list[i]);
    if (at === null || at < prev) return null;
    gaps.push(at - prev);
    prev = at;
  }
  return gaps;
}

function daysOf(first, gaps) {
  let at = dayNumber(first);
  if (at === null || !Array.isArray(gaps)) return null;
  const out = [first];
  for (const g of gaps) {
    if (!Number.isInteger(g) || g < 0) return null;
    at += g;
    out.push(dayText(at));
  }
  return out;
}

function hasReserved(v) {
  if (Array.isArray(v)) return v.some(hasReserved);
  if (!isObject(v)) return false;
  for (const k of Object.keys(v)) if (RESERVED.has(k) || hasReserved(v[k])) return true;
  return false;
}

function lower(v, tally) {
  if (Array.isArray(v)) return v.map((x) => lower(x, tally));
  if (!isObject(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    const gaps = k === "d" ? gapsOf(x) : null;
    if (gaps !== null) {
      out.d0 = x[0];
      out.dd = gaps;
      tally.lists++;
    } else out[k] = lower(x, tally);
  }
  return out;
}

function lift(v) {
  if (Array.isArray(v)) return v.map(lift);
  if (!isObject(v)) return v;
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === "dd" && Object.hasOwn(v, "d0")) continue;
    if (k === "d0" && Object.hasOwn(v, "dd")) {
      const days = daysOf(x, v.dd);
      if (days === null) throw new Error("flows-card-pack: a packed day list does not decode");
      out.d = days;
    } else out[k] = lift(x);
  }
  return out;
}

export const isPacked = (v) => isObject(v) && v[PACK_KEY] === PACK_VERSION;

export const isPackedText = (text) => typeof text === "string" && text.startsWith(PACK_PREFIX);

export const carriesMarker = (value) => isObject(value) && Object.hasOwn(value, PACK_KEY);

export function packCardX(payload) {
  if (!isObject(payload) || Object.hasOwn(payload, PACK_KEY)) return payload;
  const skip = PACK_SKIP[PACK_VERSION];
  const keys = Object.keys(payload);
  for (const k of keys) {
    if (k === "d0" || k === "dd" || k === "__proto__") return payload;
    if (!skip.includes(k) && hasReserved(payload[k])) return payload;
  }
  const out = { [PACK_KEY]: PACK_VERSION };
  const tally = { lists: 0 };
  for (const k of keys) out[k] = skip.includes(k) ? payload[k] : lower(payload[k], tally);
  return tally.lists > 0 ? out : payload;
}

export function unpackCardX(payload) {
  if (!isPacked(payload)) return payload;
  const skip = PACK_SKIP[PACK_VERSION];
  const out = {};
  for (const [k, x] of Object.entries(payload)) {
    if (k === PACK_KEY) continue;
    out[k] = skip.includes(k) ? x : lift(x);
  }
  return out;
}

export function packText(text) {
  if (typeof text !== "string" || isPackedText(text)) return text;
  let value;
  try { value = JSON.parse(text); } catch { return text; }
  const packed = packCardX(value);
  if (packed === value) return text;
  const out = JSON.stringify(packed);
  try {
    return JSON.stringify(unpackCardX(JSON.parse(out))) === text ? out : text;
  } catch {
    return text;
  }
}

export function unpackText(text) {
  if (typeof text !== "string" || !text.startsWith(PACK_ANY_PREFIX)) return text;
  try {
    const value = JSON.parse(text);
    return isPacked(value) ? JSON.stringify(unpackCardX(value)) : null;
  } catch {
    return null;
  }
}

export const utf8Length = (text) => new TextEncoder().encode(text).length;

export function storedBytes(payload) {
  return utf8Length(JSON.stringify(packCardX({ ...payload, bytes: SOFT_BYTES_PLACEHOLDER })));
}
