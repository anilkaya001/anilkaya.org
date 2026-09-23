#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE = "https://api.unusualwhales.com";
export const BASE_ENV = "FLOWS_UW_BASE_URL";
export const KEY_ENV = "UW_API_KEY";
export const TICKERS_ENV = "FLOWS_PROBE_TICKERS";
export const FILTER_ENV = "FLOWS_PROBE_FILTER";
export const LIST_PATH = fileURLToPath(new URL("./flows-probe-list.json", import.meta.url));
export const DEFAULT_TICKERS = Object.freeze(["AAPL", "NVDA"]);
export const MAX_TICKERS = 10;
export const MIN_GAP_MS = 250;
export const SAMPLE_ROWS = 5;
export const SAMPLE_CHARS = 700;
export const CALL_TIMEOUT_MS = 30_000;
export const MAX_LIMITED_RETRIES = 3;
export const MAX_RETRY_AFTER_MS = 30_000;
export const MONTHLY_MIN_DAYS = 14;
export const CLOSE_MINUTES = 16 * 60;
export const REDACTED = "[redacted]";
export const TIERS = Object.freeze(["used", "1", "2"]);
export const CLASSES = Object.freeze(["ok", "empty", "4xx", "5xx", "network", "other", "skipped"]);
export const SESSION_PROBE = Object.freeze({
  id: "session:SPY",
  tier: "used",
  op: "/api/stock/{ticker}/ohlc/{candle_size}",
  path: "/api/stock/SPY/ohlc/1d",
  query: Object.freeze({ timeframe: "1M" }),
});

const MAX_NESTED = 6;
const MAX_EXTRAS = 4;
const MAX_NAMES = 40;
const LINE_WIDTH = 118;
const DAY_MS = 86_400_000;
const TOKEN = /\{([A-Za-z0-9-]+)\}/g;
const DATE_TOKEN = /\{(date|date-\d{1,4}d|next-session|weekly|monthly|monthly2)\}/;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const LIMIT_HEADER = /rate-?limit|retry-after|quota|remaining|reset|req-?count|req-?limit|req-per|counter/i;
const NEVER_HEADER = /authorization|cookie|api-?key|secret|password/i;
const NUMERIC = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/;

export class UsageError extends Error {}

const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function isDay(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const t = Date.parse(text + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === text;
}

export function addDays(day, n) {
  return new Date(Date.parse(day + "T12:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
}

const weekdayOf = (day) => new Date(day + "T12:00:00Z").getUTCDay();
const isWeekday = (day) => weekdayOf(day) !== 0 && weekdayOf(day) !== 6;

export function previousWeekday(day) {
  let d = addDays(day, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

export function nextWeekday(day) {
  let d = addDays(day, 1);
  while (!isWeekday(d)) d = addDays(d, 1);
  return d;
}

export function fridayAfter(day) {
  let d = addDays(day, 1);
  while (weekdayOf(d) !== 5) d = addDays(d, 1);
  return d;
}

export function thirdFriday(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return new Date(Date.UTC(year, month - 1, 15 + ((12 - first) % 7))).toISOString().slice(0, 10);
}

export function monthlyAtLeast(day, minDays) {
  let year = Number(day.slice(0, 4));
  let month = Number(day.slice(5, 7));
  for (;;) {
    const friday = thirdFriday(year, month);
    if ((Date.parse(friday) - Date.parse(day)) / DAY_MS >= minDays) return friday;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
}

export function dateTokens(session) {
  const monthly = monthlyAtLeast(session, MONTHLY_MIN_DAYS);
  return {
    date: session,
    "next-session": nextWeekday(session),
    weekly: fridayAfter(session),
    monthly,
    monthly2: monthlyAtLeast(monthly, 1),
  };
}

export function easternClock(at) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

export function sessionGuess(at) {
  const { date, minutes } = easternClock(at);
  return isWeekday(date) && minutes >= CLOSE_MINUTES ? date : previousWeekday(date);
}

export function sessionFromCandles(rows, at) {
  const { date, minutes } = easternClock(at);
  const days = [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String((isObj(row) && (row.start_time || row.end_time || row.date)) || "").slice(0, 10))
    .filter(isDay))].sort();
  const complete = days.filter((d) => d < date || (d === date && minutes >= CLOSE_MINUTES));
  return complete.length ? complete[complete.length - 1] : null;
}

export function fillTokens(text, values, { strict = true } = {}) {
  return String(text).replace(TOKEN, (whole, name) => {
    if (Object.hasOwn(values, name)) return values[name];
    const back = /^date-(\d{1,4})d$/.exec(name);
    if (back && values.date) return addDays(values.date, -Number(back[1]));
    if (strict) throw new Error(`unknown token ${whole}`);
    return whole;
  });
}

const mapQuery = (query, fn) => Object.fromEntries(Object.entries(query || {})
  .map(([k, v]) => [k, Array.isArray(v) ? v.map(fn) : fn(v)]));

const templateStrings = (p) => [p.path, ...Object.values(p.query || {}).flat()].map(String);

export function parseTickers(text) {
  const list = String(text || "").split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const tickers = list.length ? [...new Set(list)] : [...DEFAULT_TICKERS];
  for (const t of tickers) {
    if (!TICKER.test(t)) throw new UsageError(`not a ticker: ${JSON.stringify(t)}`);
  }
  if (tickers.length > MAX_TICKERS) {
    throw new UsageError(`${tickers.length} tickers; the probe takes at most ${MAX_TICKERS}`);
  }
  return tickers;
}

export function parseArgs(argv, env = {}) {
  const raw = { tickers: env[TICKERS_ENV] || "", filter: env[FILTER_ENV] || "", date: "", list: LIST_PATH };
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") { dryRun = true; continue; }
    const inline = /^--(tickers|filter|date|list)=(.*)$/s.exec(arg);
    if (inline) { raw[inline[1]] = inline[2]; continue; }
    const named = /^--(tickers|filter|date|list)$/.exec(arg);
    if (named) {
      if (i + 1 >= argv.length) throw new UsageError(`${arg} needs a value`);
      raw[named[1]] = argv[++i];
      continue;
    }
    throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (raw.date && !isDay(raw.date)) throw new UsageError(`--date must be YYYY-MM-DD, got ${JSON.stringify(raw.date)}`);
  return { dryRun, tickers: parseTickers(raw.tickers), filter: String(raw.filter || "").trim(), date: raw.date, list: raw.list };
}

export function validateList(list) {
  if (!isObj(list) || list.version !== 1 || !Array.isArray(list.probes)) {
    throw new Error("probe list: expected { version: 1, probes: [...] }");
  }
  const seen = new Map();
  for (const p of list.probes) {
    if (!isObj(p) || typeof p.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) {
      throw new Error(`probe list: bad id ${JSON.stringify(p && p.id)}`);
    }
    if (seen.has(p.id)) throw new Error(`probe list: duplicate id ${p.id}`);
    if (!TIERS.includes(p.tier)) throw new Error(`probe list: ${p.id} has tier ${JSON.stringify(p.tier)}`);
    if (typeof p.op !== "string" || !p.op.startsWith("/api/")) throw new Error(`probe list: ${p.id} names no spec operation`);
    if (typeof p.path !== "string" || !p.path.startsWith("/api/")) throw new Error(`probe list: ${p.id} path must start with /api/`);
    if (p.query !== undefined && !isObj(p.query)) throw new Error(`probe list: ${p.id} query must be an object`);
    for (const v of Object.values(p.query || {})) {
      const values = Array.isArray(v) ? v : [v];
      if (!values.length || values.some((x) => typeof x !== "string")) {
        throw new Error(`probe list: ${p.id} query values must be strings or arrays of strings`);
      }
    }
    for (const [name, spec] of Object.entries(p.bind || {})) {
      if (!isObj(spec) || !seen.has(spec.from)) {
        throw new Error(`probe list: ${p.id} binds {${name}} from ${JSON.stringify(spec && spec.from)}, which is not an earlier probe`);
      }
      if (typeof spec.field !== "string" || !spec.field) throw new Error(`probe list: ${p.id} binds {${name}} from no field`);
      if (!p.path.includes(`{${name}}`)) throw new Error(`probe list: ${p.id} binds {${name}} but its path never uses it`);
    }
    seen.set(p.id, p);
  }
  const ops = new Set(list.probes.map((p) => p.op));
  for (const [op, names] of Object.entries(list.expect || {})) {
    if (!ops.has(op)) throw new Error(`probe list: expect names ${op}, which no probe exercises`);
    if (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== "string" || !n)) {
      throw new Error(`probe list: expect for ${op} must be a non-empty list of names`);
    }
  }
  return list;
}

export function loadList(file = LIST_PATH) {
  return validateList(JSON.parse(readFileSync(file, "utf8")));
}

export function expandProbes(list, tickers) {
  const byId = new Map(list.probes.map((p) => [p.id, p]));
  const scoped = (p) => templateStrings(p).some((s) => s.includes("{t}")) ||
    Object.values(p.bind || {}).some((b) => scoped(byId.get(b.from)));
  const out = [];
  for (const p of list.probes) {
    const perTicker = scoped(p);
    for (const t of perTicker ? tickers : [null]) {
      const values = t ? { t, tickers: tickers.join(",") } : { tickers: tickers.join(",") };
      const fill = (s) => fillTokens(s, values, { strict: false });
      out.push({
        id: t ? `${p.id}:${t}` : p.id,
        base: p.id,
        tier: p.tier,
        op: p.op,
        ticker: t,
        path: fill(p.path),
        query: mapQuery(p.query, fill),
        bind: Object.fromEntries(Object.entries(p.bind || {}).map(([name, b]) => [name, {
          from: t && scoped(byId.get(b.from)) ? `${b.from}:${t}` : b.from,
          field: b.field,
          maxBy: b.maxBy || null,
        }])),
        expect: (list.expect && list.expect[p.op]) || null,
      });
    }
  }
  return out;
}

export function selectProbes(instances, filter) {
  const terms = String(filter || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const picked = new Set(instances
    .filter((p) => !terms.length || terms.some((term) => `${p.id} ${p.path}`.toLowerCase().includes(term)))
    .map((p) => p.id));
  for (const p of [...instances].reverse()) {
    if (picked.has(p.id)) for (const b of Object.values(p.bind)) picked.add(b.from);
  }
  return instances.filter((p) => picked.has(p.id));
}

export function needsSession(probes) {
  return probes.some((p) => templateStrings(p).some((s) => DATE_TOKEN.test(s)));
}

export function finalizeProbe(p, dates) {
  const values = { ...dates };
  for (const name of Object.keys(p.bind)) values[name] = `{${name}}`;
  const fill = (s) => fillTokens(s, values);
  return { ...p, path: fill(p.path), query: mapQuery(p.query, fill) };
}

export function buildUrl(base, path, query = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") url.searchParams.append(k, String(item));
      }
      continue;
    }
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

export function vendorHeaders(key) {
  return { Authorization: "Bearer " + key, Accept: "application/json" };
}

const DISPLAYED = { "%5B": "[", "%5D": "]", "%7B": "{", "%7D": "}", "%2C": ",", "%3A": ":" };

export function displayUrl(url, { relative = false } = {}) {
  const u = new URL(url);
  return ((relative ? "" : u.origin) + u.pathname + u.search)
    .replace(/%(5B|5D|7B|7D|2C|3A)/gi, (hex) => DISPLAYED[hex.toUpperCase()]);
}

export function pickBound(rows, spec) {
  const usable = (Array.isArray(rows) ? rows : []).filter((row) => isObj(row) &&
    (typeof row[spec.field] === "string" || typeof row[spec.field] === "number") && String(row[spec.field]) !== "");
  if (!usable.length) return null;
  if (!spec.maxBy) return String(usable[0][spec.field]);
  const weight = (row) => { const n = Number(row[spec.maxBy]); return Number.isFinite(n) ? n : -Infinity; };
  return String(usable.reduce((best, row) => (weight(row) > weight(best) ? row : best))[spec.field]);
}

export function makeRedactor(secret) {
  const variants = [];
  if (typeof secret === "string" && secret.length) {
    for (const v of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
      if (v && !variants.includes(v)) variants.push(v);
    }
    variants.sort((a, b) => b.length - a.length);
  }
  return (text) => {
    let out = String(text);
    for (const v of variants) out = out.split(v).join(REDACTED);
    return out.replace(/(bearer\s+)(?!\[redacted\])[^\s"',;]+/gi, `$1${REDACTED}`);
  };
}

export function clip(text, max) {
  const s = String(text);
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

export function isNumericString(value) {
  return typeof value === "string" && NUMERIC.test(value);
}

export function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "arr";
  if (typeof value === "string") return isNumericString(value) ? "str#" : "str";
  if (typeof value === "number") return "num";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "object") return "obj";
  return typeof value;
}

export function unionKeys(rows, limit = SAMPLE_ROWS) {
  const sample = (Array.isArray(rows) ? rows : []).slice(0, limit);
  const objects = sample.filter(isObj);
  const fields = new Map();
  for (const row of objects) {
    for (const [key, value] of Object.entries(row)) {
      const field = fields.get(key) || { key, types: [], present: 0 };
      const type = typeOf(value);
      if (!field.types.includes(type)) field.types.push(type);
      field.present += 1;
      fields.set(key, field);
    }
  }
  const scalars = [];
  for (const row of sample) {
    if (!isObj(row) && !scalars.includes(typeOf(row))) scalars.push(typeOf(row));
  }
  return { sampled: sample.length, objects: objects.length, fields: [...fields.values()], scalars };
}

export function formatField(field, objects) {
  return `${field.key}:${field.types.join("|")}${field.present < objects ? "?" : ""}`;
}

export function locateRows(body) {
  if (Array.isArray(body)) return { at: "$", rows: body, single: false };
  if (!isObj(body)) return { at: null, rows: [], single: false };
  if (Array.isArray(body.data)) return { at: "data", rows: body.data, single: false };
  const arrays = Object.entries(body).filter(([, v]) => Array.isArray(v));
  if (isObj(body.data)) {
    for (const [k, v] of Object.entries(body.data)) if (Array.isArray(v)) arrays.push([`data.${k}`, v]);
  }
  if (arrays.length) {
    const score = ([, v]) => (v.some(isObj) ? 1e12 : 0) + v.length;
    const [at, rows] = arrays.reduce((best, entry) => (score(entry) > score(best) ? entry : best));
    return { at, rows, single: false };
  }
  if (isObj(body.data)) return { at: "data", rows: [body.data], single: true };
  return { at: "$", rows: [body], single: true };
}

export function rowsLabel(located) {
  if (located.at === null) return "none";
  if (located.at === "$") return located.single ? "$" : "[]";
  return located.single ? located.at : `${located.at}[]`;
}

export function envelopeObjects(body, located) {
  if (!isObj(body) || (located.at === "$" && located.single)) return [];
  const out = [];
  const consider = (key, value) => {
    if (isObj(value) && key !== located.at && !String(located.at).startsWith(key + ".")) out.push([key, value]);
  };
  for (const [k, v] of Object.entries(body)) consider(k, v);
  if (isObj(body.data) && located.at !== "data") {
    for (const [k, v] of Object.entries(body.data)) consider(`data.${k}`, v);
  }
  return out.slice(0, MAX_EXTRAS);
}

export function envelopeShape(body, located = locateRows(body)) {
  if (located.at === "$" && located.single && isObj(body)) return `{${Object.keys(body).length}}`;
  const render = (value, path, depth) => {
    if (Array.isArray(value)) return `[${value.length}]`;
    if (!isObj(value)) return typeOf(value);
    const entries = Object.entries(value);
    if (depth >= 2 || (path && path === located.at)) return `{${entries.length}}`;
    const parts = entries.slice(0, 12)
      .map(([k, v]) => `${k}:${render(v, path ? `${path}.${k}` : k, depth + 1)}`);
    if (entries.length > 12) parts.push(`+${entries.length - 12}`);
    return `{${parts.join(",")}}`;
  };
  return render(body, "", 0);
}

function nestedSets(rows, label) {
  const sample = rows.slice(0, SAMPLE_ROWS).filter(isObj);
  const keys = [...new Set(sample.flatMap((row) => Object.keys(row)))];
  const out = [];
  for (const key of keys) {
    const values = sample.map((row) => row[key]);
    const array = values.find((v) => Array.isArray(v) && v.some(isObj));
    if (array) { out.push({ label: `${label}.${key}[]`, rows: array }); continue; }
    const objects = values.filter(isObj);
    if (objects.length) out.push({ label: `${label}.${key}`, rows: objects });
  }
  return out;
}

export function fieldSets(body, located = locateRows(body)) {
  const label = rowsLabel(located);
  const sets = [{ label, rows: located.rows }];
  for (const [key, value] of envelopeObjects(body, located)) sets.push({ label: key, rows: [value] });
  const nested = [];
  for (const set of sets) nested.push(...nestedSets(set.rows, set.label));
  return [...sets, ...nested.slice(0, MAX_NESTED)]
    .map((set) => ({ label: set.label, union: unionKeys(set.rows) }));
}

export function collectKeys(value, depth = 5, into = new Set()) {
  if (depth < 0) return into;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, SAMPLE_ROWS)) collectKeys(v, depth - 1, into);
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) { into.add(k); collectKeys(v, depth - 1, into); }
  }
  return into;
}

export function specDiff(expect, body, sets) {
  if (!expect) return null;
  const live = collectKeys(body);
  const documented = new Set(expect);
  const rowKeys = [...new Set(sets.flatMap((set) => set.union.fields.map((f) => f.key)))];
  return {
    documented: expect.length,
    unseen: expect.filter((k) => !live.has(k)),
    undocumented: rowKeys.filter((k) => !documented.has(k)),
  };
}

export function limitHeaders(headers, redact) {
  const out = [];
  if (!headers || typeof headers.forEach !== "function") return out;
  headers.forEach((value, name) => {
    if (LIMIT_HEADER.test(name) && !NEVER_HEADER.test(name)) {
      out.push([redact(name.toLowerCase()), clip(redact(String(value)), 80)]);
    }
  });
  return out.sort(([a], [b]) => a.localeCompare(b));
}

export function headerNames(headers, redact) {
  const out = [];
  if (!headers || typeof headers.forEach !== "function") return out;
  headers.forEach((_, name) => out.push(redact(name.toLowerCase())));
  return [...new Set(out)].sort();
}

export function vendorError(body, text, redact) {
  if (isObj(body)) {
    const parts = [];
    for (const k of ["code", "reason", "error", "msg", "message", "detail"]) {
      const v = body[k];
      if (typeof v === "string" || typeof v === "number") parts.push(`${k}=${clip(redact(String(v)), 160)}`);
    }
    return parts.length ? parts.join("  ") : clip(redact(JSON.stringify(body)), 240);
  }
  const flat = redact(String(text || "")).replace(/\s+/g, " ").trim();
  return flat ? clip(flat, 240) : "(empty body)";
}

const vendorCode = (body) => {
  if (!isObj(body)) return "";
  const code = body.code ?? (isObj(body.error) ? body.error.code : undefined) ?? body.reason;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
};

export function classify(result) {
  if (result.skipped) return "skipped";
  if (!result.status) return "network";
  if (result.status >= 200 && result.status < 300) return result.empty ? "empty" : "ok";
  if (result.status >= 400 && result.status < 500) return "4xx";
  if (result.status >= 500) return "5xx";
  return "other";
}

export function analyse(probe, call, redact) {
  const result = {
    id: probe.id, tier: probe.tier, op: probe.op, url: call.url,
    status: call.status, ms: call.ms, bytes: call.bytes, limited: call.limited || 0,
    error: call.error ? redact(call.error) : null,
    limits: limitHeaders(call.headers, redact),
    headerNames: headerNames(call.headers, redact),
    rows: [],
  };
  if (!call.status) { result.cls = classify(result); return result; }
  let body = null;
  try {
    body = JSON.parse(call.text);
    result.parsed = true;
  } catch {
    result.parsed = false;
  }
  if (call.status < 200 || call.status >= 300 || !result.parsed) {
    result.errorSummary = vendorError(result.parsed ? body : null, call.text, redact);
    result.code = result.parsed ? redact(vendorCode(body)) : "";
    result.empty = !result.parsed;
    result.cls = classify(result);
    return result;
  }
  const located = locateRows(body);
  const sets = fieldSets(body, located);
  result.rows = located.rows;
  result.rowCount = located.rows.length;
  result.rowsLabel = rowsLabel(located);
  result.envelope = envelopeShape(body, located);
  result.sets = sets;
  result.empty = !sets.some((set) => set.union.fields.length || set.union.scalars.length);
  result.spec = result.empty ? null : specDiff(probe.expect, body, sets);
  result.sample = located.rows.length ? clip(redact(JSON.stringify(located.rows[0])), SAMPLE_CHARS) : null;
  result.cls = classify(result);
  return result;
}

export function makePacer(gapMs, { now, sleep }) {
  let last = -Infinity;
  return async () => {
    const wait = last + gapMs - now();
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

export function retryAfterMs(value, attempt) {
  const seconds = Number(value);
  if (value !== null && value !== undefined && value !== "" && Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_AFTER_MS);
}

export async function callVendor(url, { fetchImpl, key, pace, now, sleep }) {
  let limited = 0;
  for (;;) {
    await pace();
    const started = now();
    let response;
    let text;
    try {
      response = await fetchImpl(url, {
        headers: vendorHeaders(key),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      return {
        url, status: 0, ms: now() - started, limited,
        error: `${(error && error.name) || "Error"}: ${(error && error.message) || String(error)}`,
      };
    }
    const ms = now() - started;
    if (response.status === 429 && limited < MAX_LIMITED_RETRIES) {
      limited += 1;
      await sleep(retryAfterMs(response.headers.get("retry-after"), limited));
      continue;
    }
    return { url, status: response.status, ms, limited, headers: response.headers, text, bytes: Buffer.byteLength(text) };
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function wrapTokens(tokens, indent, width = LINE_WIDTH) {
  const lines = [];
  let line = indent;
  for (const token of tokens) {
    if (line.length > indent.length && line.length + 2 + token.length > width) {
      lines.push(line);
      line = indent;
    }
    line += (line.length > indent.length ? "  " : "") + token;
  }
  if (line.length > indent.length) lines.push(line);
  return lines;
}

export function wrapLabelled(label, tokens, width = LINE_WIDTH) {
  const wrapped = wrapTokens(tokens, " ".repeat(label.length), width);
  return wrapped.length ? [label + wrapped[0].slice(label.length), ...wrapped.slice(1)] : [label.trimEnd()];
}

const nameList = (names) => names.length > MAX_NAMES
  ? [...names.slice(0, MAX_NAMES), `+${names.length - MAX_NAMES} more`]
  : names;

export function renderBlock(result, { showHeaderNames = false } = {}) {
  const head = [`== ${result.id}`, `[${result.tier}]`];
  if (result.cls === "skipped") return [[...head, "skipped", result.reason].join("  ")];
  head.push(result.status ? String(result.status) : "no response", `${result.ms} ms`);
  if (Number.isFinite(result.bytes)) head.push(formatBytes(result.bytes));
  if (result.limited) head.push(`after ${result.limited} x 429`);
  const lines = [head.join("  "), `   GET ${displayUrl(result.url, { relative: true })}`];
  if (result.cls === "network") return [...lines, `   error ${result.error}`];
  if (result.limits.length) lines.push(...wrapLabelled("   limits ", result.limits.map(([n, v]) => `${n}=${v}`)));
  if (showHeaderNames && result.headerNames.length) lines.push(...wrapLabelled("   headers ", result.headerNames));
  if (result.status < 200 || result.status >= 300) return [...lines, `   error ${result.errorSummary}`];
  if (!result.parsed) return [...lines, `   body is not JSON: ${result.errorSummary}`];
  lines.push(`   envelope ${result.envelope}  rows ${result.rowCount} at ${result.rowsLabel}`);
  for (const set of result.sets) {
    const u = set.union;
    if (u.fields.length) {
      lines.push(`   fields ${set.label}  ${u.fields.length} keys over ${u.objects} of ${u.sampled} sampled`);
      lines.push(...wrapTokens(u.fields.map((f) => formatField(f, u.objects)), "     "));
    }
    if (u.scalars.length) lines.push(`   values ${set.label}  ${u.scalars.join("|")} over ${u.sampled} sampled`);
  }
  if (result.empty) {
    lines.push("   spec unchecked: no rows arrived");
  } else if (result.spec) {
    const s = result.spec;
    lines.push(s.unseen.length
      ? `   spec ${s.unseen.length} of ${s.documented} documented names UNSEEN`
      : `   spec all ${s.documented} documented names seen`);
    if (s.unseen.length) lines.push(...wrapTokens(nameList(s.unseen), "     "));
    if (s.undocumented.length) {
      lines.push(`   spec ${s.undocumented.length} undocumented`);
      lines.push(...wrapTokens(nameList(s.undocumented), "     "));
    }
  } else {
    lines.push("   spec shape undocumented");
  }
  if (result.sample) lines.push(`   sample ${result.sample}`);
  return lines;
}

export function summarise(results) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, []]));
  for (const r of results) counts[r.cls].push(r);
  const drift = results.filter((r) => r.spec && r.spec.unseen.length);
  return { counts, drift };
}

export function renderSummary(results, { session, elapsedMs }) {
  const { counts, drift } = summarise(results);
  const calls = results.filter((r) => r.cls !== "skipped").length;
  const limited = results.reduce((n, r) => n + (r.limited || 0), 0);
  const lines = [`== summary  session ${session}  ${calls} calls  ${limited} x 429  ${(elapsedMs / 1000).toFixed(1)} s`];
  const describe = (r) => {
    if (r.cls === "skipped") return `${r.id} (${r.reason})`;
    if (r.cls === "4xx" || r.cls === "5xx" || r.cls === "other") return `${r.id} ${r.status}${r.code ? " " + r.code : ""}`;
    if (r.cls === "empty" && r.parsed === false) return `${r.id} (not JSON)`;
    return r.id;
  };
  const row = (name, entries) => wrapLabelled(`   ${name.padEnd(8)}${String(entries.length).padStart(4)}  `,
    name === "ok" ? [] : entries);
  for (const cls of CLASSES) {
    const list = counts[cls];
    if (list.length || ["ok", "empty", "4xx", "5xx"].includes(cls)) lines.push(...row(cls, list.map(describe)));
  }
  if (drift.length) lines.push(...row("drift", drift.map((r) => `${r.id} (${r.spec.unseen.length} unseen)`)));
  return lines;
}

export function exitCode(results) {
  const called = results.filter((r) => r.cls !== "skipped");
  if (!called.length) return 1;
  return called.some((r) => r.cls === "ok" || r.cls === "empty") ? 0 : 1;
}

export async function runProbe(options, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const log = deps.log || ((line) => console.log(line));
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clock = deps.clock || (() => new Date());
  const key = options.key || "";
  const base = options.base || DEFAULT_BASE;
  const tickers = options.tickers || [...DEFAULT_TICKERS];
  const list = options.list || loadList();
  const redact = makeRedactor(key);
  const emit = (line) => log(redact(line));
  const started = now();

  const selected = selectProbes(expandProbes(list, tickers), options.filter);
  if (!selected.length) throw new UsageError(`no probe matches filter ${JSON.stringify(options.filter)}`);
  if (!options.dryRun && !key) {
    throw new UsageError(`${KEY_ENV} is not set; --dry-run lists the probes without calling`);
  }

  emit(`flows-probe  base ${base}  tickers ${tickers.join(",")}  filter ${options.filter ? JSON.stringify(options.filter) : "(all)"}  ` +
    `${selected.length} probes${options.dryRun ? "  dry run" : ""}`);
  emit("   key:type  str# = a number sent as a string  ? = absent from some sampled rows  " +
    "spec = names the OpenAPI spec documents for the operation");

  const results = [];
  const ctx = { fetchImpl, key, pace: makePacer(MIN_GAP_MS, { now, sleep }), now, sleep };
  let shownHeaderNames = false;
  const record = (result) => {
    results.push(result);
    const showHeaderNames = !shownHeaderNames && result.headerNames && result.headerNames.length > 0;
    if (showHeaderNames) shownHeaderNames = true;
    for (const line of renderBlock(result, { showHeaderNames })) emit(line);
  };

  let session = options.date || "";
  let source = "--date";
  if (!session) {
    if (options.dryRun || !needsSession(selected)) {
      session = sessionGuess(clock());
      source = "Eastern calendar";
    } else {
      const probe = { ...SESSION_PROBE, bind: {}, expect: (list.expect && list.expect[SESSION_PROBE.op]) || null };
      const call = await callVendor(buildUrl(base, probe.path, probe.query), ctx);
      const result = analyse(probe, call, redact);
      const found = result.cls === "ok" ? sessionFromCandles(result.rows, clock()) : null;
      result.rows = null;
      record(result);
      session = found || sessionGuess(clock());
      source = found ? "latest complete SPY daily candle" : "Eastern calendar; the candles named no complete session";
    }
  }
  const dates = dateTokens(session);
  emit(`   session ${session} (${source})  next ${dates["next-session"]}  weekly ${dates.weekly}  ` +
    `monthly ${dates.monthly}  monthly2 ${dates.monthly2}`);
  const probes = selected.map((p) => finalizeProbe(p, dates));

  if (options.dryRun) {
    for (const p of probes) {
      emit(`${p.id}  [${p.tier}]  GET ${displayUrl(buildUrl(base, p.path, p.query))}`);
      for (const [name, b] of Object.entries(p.bind)) {
        emit(`   {${name}} = ${b.field} of the ${b.maxBy ? `max-${b.maxBy} row` : "first row"} of ${b.from}`);
      }
    }
    emit(`== dry run  ${probes.length} probes, no calls made`);
    return { results, code: 0, session, probes };
  }

  const sources = new Set(probes.flatMap((p) => Object.values(p.bind).map((b) => b.from)));
  const kept = new Map();
  for (const p of probes) {
    let path = p.path;
    let missing = null;
    for (const [name, b] of Object.entries(p.bind)) {
      const value = pickBound(kept.get(b.from), b);
      if (value === null) { missing = `no ${b.field} from ${b.from}`; break; }
      path = path.split(`{${name}}`).join(encodeURIComponent(value));
    }
    if (missing) {
      record({ id: p.id, tier: p.tier, op: p.op, skipped: true, reason: missing, cls: "skipped" });
      continue;
    }
    const call = await callVendor(buildUrl(base, path, p.query), ctx);
    const result = analyse(p, call, redact);
    if (sources.has(p.id)) kept.set(p.id, result.rows);
    result.rows = null;
    record(result);
  }
  for (const line of renderSummary(results, { session, elapsedMs: now() - started })) emit(line);
  const code = exitCode(results);
  emit(code === 0
    ? "== exit 0: the probe is informational; at least one call answered"
    : "== exit 1: no call answered, so the key, the plan or the network is broken");
  return { results, code, session, probes };
}

async function main() {
  const key = process.env[KEY_ENV] || "";
  const redact = makeRedactor(key);
  try {
    const options = parseArgs(process.argv.slice(2), process.env);
    const { code } = await runProbe({
      ...options,
      key,
      base: process.env[BASE_ENV] || DEFAULT_BASE,
      list: loadList(options.list),
    });
    process.exitCode = code;
  } catch (error) {
    console.error(redact(`flows-probe: ${error && error.message ? error.message : String(error)}`));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) await main();
