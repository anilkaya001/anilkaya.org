import { buildDossier, renderDossierForModel, DEFAULT_BUDGET_TOKENS, cleanLabel, tms, isoOf, VENDOR_ROUTES } from "./flows-dossier.js";
import { REDUCERS, quoteExtract, unwrap } from "./flows-dossier-vendor.js";
import { buildContext, neuronTier } from "./flows-neuron.js";
import { screenReading, SCREEN_LINES } from "./flows-neuron-screen.js";
import { earningsHistory } from "./flows-catalysts.js";
import { UNIVERSE_COLUMNS, UNIVERSE_PERCENTILES, sessionsBetween } from "./flows-cross.js";
import { SECTOR_TIDES } from "./flows-live.js";
import { batchWithClock, ondemandAllowed, memoizedClock } from "./flows-live-worker.js";
import { expectedNightlySession, freshHeaders } from "./flows-freshness.js";

export const DOSSIER_SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS flows_dossier_cache (ticker TEXT NOT NULL CHECK (length(ticker) BETWEEN 1 AND 10), " +
  "kind TEXT NOT NULL, fetched_at INTEGER NOT NULL CHECK (fetched_at > 0), " +
  "payload TEXT NOT NULL CHECK (length(payload) <= 8192), PRIMARY KEY (ticker, kind)) WITHOUT ROWID";

export const CACHE_KINDS = Object.freeze(["identity", "fundamentals", "analysts", "earnings", "positioning"]);

export const CACHE_TTL_S = Object.freeze({
  identity: 24 * 3600, fundamentals: 24 * 3600, analysts: 6 * 3600, earnings: 12 * 3600, positioning: 24 * 3600,
});

export const FAST_TTL_S = Object.freeze({ news: 300, levels: 60, quote: 5 });

export const BUDGET = Object.freeze({ maxCalls: 9, sourceMs: 2500, deadlineMs: 3000, payloadBytes: 8192 });

export const NONE_WHY = "This name is not in the nightly universe, so no dealer positioning or option chain is held for it; the ticker page can read a quote for it on demand and nothing more.";

export const SOURCES = Object.freeze([
  { id: "info", kind: "identity", prio: 1, maxBytes: 32768, path: (t) => "/api/stock/" + t + "/info", params: () => ({}) },
  { id: "quote", kind: null, fast: true, prio: 2 },
  { id: "news", kind: null, fast: true, prio: 3, maxBytes: 98304, path: () => "/api/news/headlines", params: (t) => ({ ticker: t, limit: 12 }) },
  { id: "analysts", kind: "analysts", prio: 4, maxBytes: 98304, path: () => "/api/screener/analysts", params: (t) => ({ ticker: t, limit: 30 }) },
  { id: "financials", kind: "fundamentals", prio: 5, maxBytes: 262144, path: (t) => "/api/stock/" + t + "/financials", params: () => ({}) },
  { id: "ownership", kind: "positioning", prio: 6, maxBytes: 131072, path: (t) => "/api/institution/" + t + "/ownership",
    params: () => ({ limit: 25, order: "value", order_direction: "desc" }) },
  { id: "earnings", kind: "earnings", prio: 7, maxBytes: 131072, path: (t) => "/api/earnings/" + t, params: () => ({}) },
  { id: "profile", kind: "identity", prio: 8, maxBytes: 32768, path: (t) => "/api/companies/" + t + "/profile", params: () => ({}) },
  { id: "estimates", kind: "earnings", prio: 9, maxBytes: 65536, path: (t) => "/api/companies/" + t + "/earnings-estimates", params: () => ({}) },
  { id: "breakdown", kind: "fundamentals", prio: 10, maxBytes: 262144, path: (t) => "/api/stock/" + t + "/fundamental-breakdown", params: () => ({}) },
  { id: "levels", kind: null, fast: true, prio: 11, maxBytes: 131072, path: (t) => "/api/darkpool/" + t + "/price-levels", params: () => ({}) },
  { id: "short", kind: "positioning", prio: 12, maxBytes: 32768, path: (t) => "/api/shorts/" + t + "/interest-float/v2", params: () => ({}) },
  { id: "insiders", kind: "positioning", prio: 13, maxBytes: 65536, path: (t) => "/api/insider/" + t + "/ticker-flow", params: () => ({ limit: 60 }) },
]);

const SOURCE_BY_ID = Object.freeze(Object.fromEntries(SOURCES.map((s) => [s.id, s])));

const REDUCE_PLAIN = new Set(["info", "profile", "financials", "breakdown", "estimates", "ownership", "short", "insiders", "levels"]);

export const REDUCE_TICKER = new Set(["analysts", "news"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const tryParse = (text, fallback = null) => {
  if (text === null || text === undefined) return fallback;
  if (typeof text !== "string") return text;
  try { return JSON.parse(text); } catch { return fallback; }
};

const UNIVERSE_KEYS = Object.freeze(UNIVERSE_COLUMNS.map((c) => c.key));

export const DOSSIER_SQL = Object.freeze({
  card: "SELECT payload, updated_at, json_extract(payload, '$.sessionDate') AS session, " +
    "COALESCE(json_extract(payload, '$.readAt'), json_extract(payload, '$.generatedAt')) AS read_iso FROM flows_payload WHERE id = ?",
  cardX: "SELECT updated_at, json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.generatedAt') AS generated, " +
    "json_extract(payload, '$.engine') AS engine, json_extract(payload, '$.short') AS short, json_extract(payload, '$.insiders') AS insiders, " +
    "json_extract(payload, '$.earnings') AS earnings FROM flows_payload WHERE id = ?",
  universe: "SELECT p.updated_at AS updated_at, json_extract(p.payload, '$.sessionDate') AS session, json_extract(p.payload, '$.generatedAt') AS generated, " +
    "json_extract(p.payload, '$.n') AS n, json_extract(p.payload, '$.units') AS units, x.i AS i, " +
    UNIVERSE_KEYS.map((k) => "json_extract(p.payload, '$.cols." + k + "[' || x.i || ']') AS c_" + k).join(", ") + ", " +
    UNIVERSE_PERCENTILES.map((k) => "json_extract(p.payload, '$.pct." + k + "[' || x.i || ']') AS p_" + k).join(", ") + ", " +
    "json_extract(p.payload, '$.sectors[' || json_extract(p.payload, '$.sec[' || x.i || ']') || ']') AS sector, " +
    "json_extract(p.payload, '$.sectorTilt[' || json_extract(p.payload, '$.sec[' || x.i || ']') || ']') AS sector_tilt " +
    "FROM flows_payload p, (SELECT length(pre) - length(replace(pre, ',', '')) AS i FROM " +
    "(SELECT substr(t, 1, instr(t, '\"' || ?1 || '\"')) AS pre FROM (SELECT json_extract(payload, '$.t') AS t FROM flows_payload WHERE id = 'universe') " +
    "WHERE instr(t, '\"' || ?1 || '\"') > 0)) x WHERE p.id = 'universe'",
  regime: "SELECT updated_at, json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.generatedAt') AS generated, " +
    ["SPY", "QQQ", "IWM"].map((t) => "json_object('status', json_extract(payload, '$.etfTide.byEtf." + t + ".status'), 'net', json_extract(payload, '$.etfTide.byEtf." + t +
      ".net'), 'date', json_extract(payload, '$.etfTide.byEtf." + t + ".date')) AS " + t.toLowerCase()).join(", ") + ", " +
    "json_object('status', json_extract(payload, '$.zeroDte.status'), 'share', json_extract(payload, '$.zeroDte.share')) AS zero, " +
    "json_object('status', json_extract(payload, '$.volCurve.byIndex.SPY.status'), 'ts', json_extract(payload, '$.volCurve.byIndex.SPY.ts'), " +
    "'fs', json_extract(payload, '$.volCurve.byIndex.SPY.fs'), 'shape', json_extract(payload, '$.volCurve.byIndex.SPY.shape')) AS curve, " +
    "json_object('status', json_extract(payload, '$.impliedCorrelation.byIndex.SPY.status'), 'rho', json_extract(payload, '$.impliedCorrelation.byIndex.SPY.rho')) AS corr " +
    "FROM flows_payload WHERE id = 'regime'",
  events: "SELECT updated_at, json_extract(payload, '$.sessionDate') AS session, json_extract(payload, '$.generatedAt') AS generated, " +
    "json_extract(payload, '$.macro') AS macro, json_extract(payload, '$.rows[' || (SELECT (length(pre) - length(replace(pre, '{\"t\":\"', ''))) / 6 FROM " +
    "(SELECT substr(r, 1, instr(r, '{\"t\":\"' || ?1 || '\"')) AS pre FROM (SELECT json_extract(payload, '$.rows') AS r FROM flows_payload WHERE id = 'events') " +
    "WHERE instr(r, '{\"t\":\"' || ?1 || '\"') > 0)) || ']') AS row FROM flows_payload WHERE id = 'events'",
  roster: "SELECT json_extract(payload, '$.depth.\"' || ? || '\"') AS depth FROM flows_payload WHERE id = 'roster'",
  strips: "SELECT read_at, session, json_extract(payload, '$.rows.\"' || ?1 || '\"') AS row, json_extract(payload, '$.fields') AS fields FROM flows_live WHERE id = 'live:strips'",
  market: "SELECT read_at, session, json_extract(payload, '$.tide.status') AS tide_status, json_extract(payload, '$.last.tideNet') AS tide_net, " +
    "json_extract(payload, '$.tide.lastAt') AS tide_last, json_extract(payload, '$.sectors.rows') AS sectors FROM flows_live WHERE id = 'live:market'",
  alerts: "SELECT read_at, session, CASE WHEN instr(payload, '\"t\":\"' || ?1 || '\"') > 0 THEN json_extract(payload, '$.rows') END AS rows FROM flows_live WHERE id = 'live:alerts'",
  liveNews: "SELECT read_at, session, CASE WHEN instr(payload, '\"' || ?1 || '\"') > 0 THEN json_extract(payload, '$.rows') END AS rows FROM flows_live WHERE id = 'live:news'",
  news: "SELECT updated_at, json_extract(payload, '$.sessionDate') AS session, CASE WHEN instr(payload, '\"' || ?1 || '\"') > 0 THEN json_extract(payload, '$.rows') END AS rows FROM flows_payload WHERE id = 'news'",
  tape: "SELECT payload, read_at, session FROM flows_tape WHERE ticker = ?",
  cache: "SELECT kind, fetched_at, payload FROM flows_dossier_cache WHERE ticker = ?1 AND kind IN ('identity', 'fundamentals', 'analysts', 'earnings', 'positioning')",
});

export const DOSSIER_WRITE_SQL =
  "INSERT INTO flows_dossier_cache (ticker, kind, fetched_at, payload) VALUES (?, ?, ?, ?) " +
  "ON CONFLICT(ticker, kind) DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload";

export function dossierStatements(db, ticker) {
  const q = (name, ...binds) => db.prepare(DOSSIER_SQL[name]).bind(...binds);
  return [
    q("card", "card:" + ticker), q("cardX", "card-x:" + ticker), q("universe", ticker), q("regime"), q("events", ticker), q("roster", ticker),
    q("strips", ticker), q("market"), q("alerts", ticker), q("liveNews", ticker), q("news", ticker), q("tape", ticker), q("cache", ticker),
  ];
}

const STATEMENT_NAMES = Object.freeze(["card", "cardX", "universe", "regime", "events", "roster", "strips", "market", "alerts", "liveNews", "news", "tape", "cache"]);

const first = (res) => (res && res.results && res.results[0] ? res.results[0] : null);

export function decodeUniverse(row) {
  if (!row || row.i === null || row.i === undefined) return null;
  const units = tryParse(row.units, {}) || {};
  const u = {};
  for (const k of UNIVERSE_KEYS) {
    const raw = row["c_" + k];
    const scale = Array.isArray(units[k]) ? Number(units[k][1]) : NaN;
    u[k] = isNum(raw) && Number.isFinite(scale) && scale !== 0 ? raw / scale : null;
  }
  const pct = {};
  for (const k of UNIVERSE_PERCENTILES) pct[k] = isNum(row["p_" + k]) ? row["p_" + k] : null;
  return {
    sessionDate: typeof row.session === "string" ? row.session.slice(0, 10) : null,
    generatedAt: typeof row.generated === "string" ? row.generated : null,
    rank: Number(row.i) + 1, n: Number(row.n) || null,
    sector: typeof row.sector === "string" ? row.sector : null,
    sectorTilt: isNum(row.sector_tilt) ? row.sector_tilt / 100 : null,
    u, pct,
  };
}

function decodeStrip(row, readAt, session, fields) {
  const list = tryParse(row, null);
  const names = tryParse(fields, null);
  if (!Array.isArray(list) || !Array.isArray(names)) return null;
  const values = {};
  names.forEach((name, i) => { values[name] = isNum(list[i]) ? list[i] : null; });
  return { readAt: Number(readAt), session, values };
}

function decodeMarket(row, ticker, sector) {
  if (!row) return { market: null, sectorEtf: null };
  const tideNet = isNum(row.tide_net) ? row.tide_net : null;
  const market = { readAt: Number(row.read_at), session: row.session, tideStatus: row.tide_status || null, tideNet, tideLastAt: typeof row.tide_last === "string" ? row.tide_last : null };
  const rows = arr(tryParse(row.sectors, []));
  const entry = SECTOR_TIDES.find((s) => s.sector === sector);
  const hit = entry ? rows.find((r) => r && r.etf === entry.etf) : null;
  const sectorEtf = hit ? { etf: hit.etf, name: typeof hit.name === "string" ? hit.name : null, chg: isNum(hit.chg) ? hit.chg : null,
    lean: isNum(hit.lean) ? hit.lean : null, net: isNum(hit.net) ? hit.net : null, asOf: null } : null;
  return { market, sectorEtf };
}

function decodeRegime(row) {
  if (!row) return null;
  const etf = {};
  for (const [key, name] of [["spy", "SPY"], ["qqq", "QQQ"], ["iwm", "IWM"]]) etf[name] = tryParse(row[key], null);
  return {
    sessionDate: typeof row.session === "string" ? row.session.slice(0, 10) : null,
    generatedAt: typeof row.generated === "string" ? row.generated : null,
    etf, zeroDte: tryParse(row.zero, null), curve: tryParse(row.curve, null), corr: { SPY: tryParse(row.corr, null) },
  };
}

function decodeEvents(row) {
  if (!row) return null;
  return {
    sessionDate: typeof row.session === "string" ? row.session.slice(0, 10) : null,
    generatedAt: typeof row.generated === "string" ? row.generated : null,
    macro: tryParse(row.macro, null), row: tryParse(row.row, null),
  };
}

function newsRowsFrom(rows, ticker) {
  const out = [];
  for (const r of arr(tryParse(rows, []))) {
    if (!isObj(r) || !arr(r.tickers).includes(ticker)) continue;
    const at = typeof r.createdAt === "string" ? isoOf(tms(r.createdAt)) : null;
    const headline = typeof r.headline === "string" ? r.headline.slice(0, 260) : null;
    if (!at || !headline) continue;
    out.push({ at, h: headline, src: cleanLabel(r.source, 28), sent: ["positive", "negative", "neutral"].includes(r.sentiment) ? r.sentiment : null, major: typeof r.major === "boolean" ? r.major : null });
  }
  return out;
}

export function neuronView({ ticker, card, universe, roster, expected }) {
  if (card && (card.status === "pending" || !isObj(card.panels))) {
    return { status: "pending", tier: null, code: null, why: null, note: "The card for " + ticker + " has not landed yet.", sessionDate: null, generatedAt: null };
  }
  if (card) {
    const context = buildContext(card, { expectedSession: expected });
    const tag = neuronTier(card, context);
    const sessionDate = typeof card.sessionDate === "string" ? card.sessionDate.slice(0, 10) : null;
    const gap = expected && sessionDate ? sessionsBetween(sessionDate, expected) : 0;
    const generatedAt = typeof card.generatedAt === "string" ? card.generatedAt : null;
    if (gap !== null && gap >= SCREEN_LINES.EXPIRED_SESSIONS) {
      return { status: "ok", tier: "expired", code: "expired.sessions", why: "Expired: this card describes " + sessionDate + ", " + gap + " sessions before the last close.",
        context: null, sessionDate, generatedAt, behind: gap };
    }
    return { status: "ok", tier: tag.tier, code: tag.code, why: tag.why, context, sessionDate, generatedAt, behind: gap === null ? 0 : gap };
  }
  if (universe) {
    const age = universe.sessionDate && expected ? sessionsBetween(universe.sessionDate, expected) : 0;
    const screen = screenReading({ ticker, u: universe.u, pct: universe.pct, sector: universe.sector, sessionDate: universe.sessionDate,
      expectedSession: expected, behind: age === null ? 0 : age });
    const readable = screen.status === "ok";
    return {
      status: "ok", tier: readable ? screen.tier : "unpriceable", code: readable ? screen.noIdeaCode : "screen.no-inputs",
      why: readable ? screen.why : "The screener row carries none of the inputs a reading is built on.",
      screen: readable ? screen : null, sessionDate: universe.sessionDate, generatedAt: universe.generatedAt, behind: age === null ? 0 : age,
    };
  }
  if (roster) {
    return { status: "pending", tier: null, code: "scheduled", why: null, note: "A card for " + ticker + " is built by tonight's run, so there is nothing to read yet.", sessionDate: null, generatedAt: null };
  }
  return { status: "absent", tier: "none", code: "not-covered", why: NONE_WHY, sessionDate: null, generatedAt: null };
}

function mergeEngine(card, x) {
  if (!card || !isObj(card.engine) || card.engine.status !== "split") return card;
  const block = x && isObj(x.engine) && x.sessionDate === card.sessionDate ? x.engine : null;
  card.engine = block || { status: "unreadable", key: card.engine.key };
  return card;
}

function decodeCache(rows) {
  const out = {};
  for (const r of arr(rows)) {
    if (!r || !CACHE_KINDS.includes(r.kind)) continue;
    const body = tryParse(r.payload, null);
    if (isObj(body) && isObj(body.parts)) out[r.kind] = { fetchedAt: Number(r.fetched_at), parts: body.parts };
  }
  return out;
}

export function planFetches({ ticker, known, own, cache, fast, held, now, maxCalls = BUDGET.maxCalls }) {
  const need = [];
  const skip = (id, why) => ({ id, why });
  const skipped = [];
  const cardX = held.cardX;
  const cardXOk = cardX && cardX.sessionDate && held.expected && sessionsBetween(cardX.sessionDate, held.expected) !== null && sessionsBetween(cardX.sessionDate, held.expected) < 2;
  const cardGap = held.card && held.expected ? sessionsBetween(String(held.card.sessionDate).slice(0, 10), held.expected) : null;
  const strip = held.strip;
  const stripFresh = strip && isNum(strip.values.px) && isNum(strip.values.qa) && strip.values.qa <= 120 && Number.isFinite(strip.readAt) && now - strip.readAt <= 20 * 60 * 1000;
  const darkHeld = held.card && held.card.panels && isObj(held.card.panels.darkpool) && held.card.panels.darkpool.status === "ok" && cardGap !== null && cardGap < 2;
  const reduced = !known;
  for (const src of SOURCES) {
    if (reduced && !["info", "quote", "news"].includes(src.id)) { skipped.push(skip(src.id, "outside-universe")); continue; }
    if (src.id === "quote" && stripFresh) { skipped.push(skip(src.id, "strip-fresh")); continue; }
    if (src.id === "earnings" && cardXOk && isObj(cardX.earnings) && ["ok", "thin"].includes(cardX.earnings.status)) { skipped.push(skip(src.id, "held-card-x")); continue; }
    if (src.id === "levels" && darkHeld) { skipped.push(skip(src.id, "held-card")); continue; }
    if (src.id === "short" && cardXOk && isObj(cardX.short) && isObj(cardX.short.interest) && cardX.short.interest.shares !== undefined) { skipped.push(skip(src.id, "held-card-x")); continue; }
    if (src.id === "insiders" && cardXOk && isObj(cardX.insiders) && cardX.insiders.status && cardX.insiders.status !== "unavailable") { skipped.push(skip(src.id, "held-card-x")); continue; }
    const ttl = src.fast ? FAST_TTL_S[src.id] : CACHE_TTL_S[src.kind];
    const part = src.fast ? fast[src.id] : cache[src.kind] && cache[src.kind].parts[src.id];
    const at = part && isNum(part.at) ? part.at : null;
    if (src.id === "quote") { need.push({ src, state: "missing", ttl }); continue; }
    if (at !== null && now - at < ttl * 1000) continue;
    need.push({ src, state: at === null ? "missing" : "stale", ttl });
  }
  need.sort((a, b) => a.src.prio - b.src.prio);
  const picked = need.slice(0, maxCalls);
  const queued = need.slice(maxCalls).map((n) => n.src.id);
  return { picked, queued, skipped };
}

function reduceBody(src, body, ticker, expected) {
  if (src.id === "earnings") {
    const rows = unwrap(body);
    const list = Array.isArray(rows) ? rows.filter(isObj) : isObj(rows) ? [rows] : null;
    if (list === null) return { ok: false, reason: "unshaped" };
    if (!list.length) return { ok: false, reason: "empty" };
    const hist = earningsHistory(list, { sessionDate: expected });
    if (hist.status === "quiet" && !arr(hist.events).length) return { ok: false, reason: "empty" };
    return { ok: true, hist };
  }
  const fn = REDUCERS[src.id];
  return REDUCE_TICKER.has(src.id) ? fn(body, ticker) : fn(body);
}

function failureOf(error) {
  const code = error && error.code;
  const up = error && error.upstream;
  if (code === "chain_rate_limited" || up === 429) return { ok: false, reason: "limited", transient: true };
  if (code === "chain_unconfigured") return { ok: false, reason: "unconfigured", transient: true };
  if (code === "chain_too_large") return { ok: false, reason: "large", transient: false };
  if (up === 401 || up === 402 || up === 403 || up === 404 || up === 422) return { ok: false, reason: "plan", transient: false };
  return { ok: false, reason: "failed", transient: true };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readFast(id, ticker, now) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (!cache) return null;
  const hit = await cache.match(new Request("https://flows-dossier.internal/" + id + "/" + ticker, { method: "GET" })).catch(() => null);
  if (!hit) return null;
  const body = await hit.json().catch(() => null);
  return body && isNum(body.at) && isObj(body.x) ? body : null;
}

function writeFast(id, ticker, at, x) {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (!cache) return Promise.resolve();
  const response = new Response(JSON.stringify({ at, x }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "max-age=" + FAST_TTL_S[id] } });
  return cache.put(new Request("https://flows-dossier.internal/" + id + "/" + ticker, { method: "GET" }), response).catch(() => {});
}

const flights = new Map();

export function assembleDossier(env, ctx, ticker, deps, opts = {}) {
  const existing = flights.get(ticker);
  if (existing) return existing;
  const flight = runAssembly(env, ctx, ticker, deps, opts).finally(() => { if (flights.get(ticker) === flight) flights.delete(ticker); });
  flights.set(ticker, flight);
  return flight;
}

async function runAssembly(env, ctx, ticker, deps, opts) {
  const now = isNum(opts.now) ? opts.now : Date.now();
  const budget = { ...BUDGET, ...(opts.budget || {}) };
  const trace = { trips: 0, vendorCalls: 0, calls: [], pending: [], queued: [], skipped: [], stale: [], wrote: [], failed: false, own: opts.own === true };
  const statements = env.DB ? dossierStatements(env.DB, ticker) : [];
  const read = env.DB ? await batchWithClock(env.DB, statements, now) : { results: null, clock: memoizedClock(now) };
  trace.trips = 1;
  const clock = read.clock;
  const expected = expectedNightlySession(now, clock);
  const rows = {};
  if (read.results) STATEMENT_NAMES.forEach((name, i) => { rows[name] = read.results[i]; });
  else trace.failed = true;

  let card = null;
  const cardRow = first(rows.card);
  if (cardRow && cardRow.payload) card = tryParse(cardRow.payload, null);
  const xRow = first(rows.cardX);
  const cardX = xRow ? {
    sessionDate: typeof xRow.session === "string" ? xRow.session.slice(0, 10) : null,
    generatedAt: typeof xRow.generated === "string" ? xRow.generated : null,
    engine: tryParse(xRow.engine, null), short: tryParse(xRow.short, null), insiders: tryParse(xRow.insiders, null), earnings: tryParse(xRow.earnings, null),
  } : null;
  if (card) card = mergeEngine(card, cardX);
  const universe = decodeUniverse(first(rows.universe));
  const rosterRow = first(rows.roster);
  const rosterDepth = rosterRow && typeof rosterRow.depth === "string" ? rosterRow.depth : null;
  const known = Boolean(card || universe || rosterDepth);
  const sector = (card && card.sector) || (universe && universe.sector) || null;

  const neuron = neuronView({ ticker, card, universe, roster: rosterDepth, expected });
  const stripRow = first(rows.strips);
  let strip = stripRow ? decodeStrip(stripRow.row, stripRow.read_at, stripRow.session, stripRow.fields) : null;
  const liveBehind = {};
  if (strip && expected && strip.session < expected) { liveBehind.strip = "live:strips describes " + strip.session + ", the last close is " + expected; strip = null; }
  const { market, sectorEtf } = decodeMarket(first(rows.market), ticker, sector);
  const alertsRow = first(rows.alerts);
  let alerts = null;
  if (alertsRow) {
    const list = arr(tryParse(alertsRow.rows, [])).filter((r) => isObj(r) && r.t === ticker);
    if (!expected || alertsRow.session >= expected) alerts = { readAt: Number(alertsRow.read_at), session: alertsRow.session, rows: list, age: Math.max(0, Math.round((now - Number(alertsRow.read_at)) / 1000)) };
  }
  const tapeRow = first(rows.tape);
  let tape = null;
  if (tapeRow && tapeRow.payload) {
    const parsed = tryParse(tapeRow.payload, null);
    if (isObj(parsed) && (!expected || (parsed.session || tapeRow.session) >= expected)) tape = parsed;
  }
  const newsRows = [
    ...newsRowsFrom(first(rows.liveNews) && first(rows.liveNews).rows, ticker),
    ...newsRowsFrom(first(rows.news) && first(rows.news).rows, ticker),
  ];
  const cache = decodeCache(rows.cache && rows.cache.results);
  const held = {
    expected, card, cardX, universe, regime: decodeRegime(first(rows.regime)), events: decodeEvents(first(rows.events)),
    strip, market, sectorEtf, alerts, tape, newsRows, neuron, liveBehind,
  };
  const events = held.events;
  if (events && events.row && events.row.t !== ticker) events.row = null;

  const fast = {};
  const extracts = {};
  const fastIds = SOURCES.filter((src) => src.fast && src.id !== "quote").map((src) => src.id);
  const fastHits = await Promise.all(fastIds.map((id) => readFast(id, ticker, now)));
  fastIds.forEach((id, i) => { fast[id] = fastHits[i]; });

  let admitted = known || opts.own === true;
  if (!known && opts.own === true && typeof deps.admit === "function") {
    const verdict = await Promise.resolve(deps.admit(ticker)).catch(() => null);
    if (verdict === false) admitted = false;
  }
  const plan = admitted
    ? planFetches({ ticker, known, own: opts.own === true, cache, fast, held, now, maxCalls: budget.maxCalls })
    : { picked: [], queued: [], skipped: SOURCES.map((s) => ({ id: s.id, why: "not-admitted" })) };
  trace.skipped = plan.skipped;
  trace.queued = plan.queued;

  for (const src of SOURCES) {
    const part = src.fast ? fast[src.id] : cache[src.kind] && cache[src.kind].parts[src.id];
    if (part && isObj(part.x)) {
      extracts[src.id] = part.x;
      if (!src.fast && now - part.at >= CACHE_TTL_S[src.kind] * 1000) trace.stale.push(src.id);
    }
  }
  for (const id of plan.queued) if (!extracts[id]) extracts[id] = { pending: true, reason: "budget" };

  const results = {};
  const tasks = [];
  const settled = [];
  for (const { src, state } of plan.picked) {
    const run = (async () => {
      if (src.id === "quote") {
        const body = await deps.quote(ticker);
        return quoteExtract(body);
      }
      if (!(await deps.allowed(env))) return { ok: false, reason: "limited", transient: true };
      trace.vendorCalls++;
      trace.calls.push(src.path(ticker));
      try {
        const body = await deps.fetchVendor(src.path(ticker), src.params(ticker), { maxBytes: src.maxBytes });
        return reduceBody(src, body, ticker, expected);
      } catch (error) {
        return failureOf(error);
      }
    })().then((x) => { results[src.id] = { x, at: Date.now() }; return x; }, () => { results[src.id] = { x: { ok: false, reason: "failed", transient: true }, at: Date.now() }; });
    settled.push(run);
    if (state === "missing") tasks.push({ src, run });
  }
  const timers = [];
  const guard = (src, run) => Promise.race([run, new Promise((resolve) => { timers.push(setTimeout(resolve, budget.sourceMs)); })]);
  const awaited = tasks.map(({ src, run }) => guard(src, run));
  const overall = new Promise((resolve) => { timers.push(setTimeout(resolve, budget.deadlineMs)); });
  if (awaited.length) await Promise.race([Promise.all(awaited), overall]);
  for (const t of timers) clearTimeout(t);

  for (const { src, state } of plan.picked) {
    const done = results[src.id];
    if (done) {
      if (done.x.ok === true || (done.x.ok === false && done.x.transient !== true)) extracts[src.id] = done.x;
      else if (state === "missing") extracts[src.id] = { pending: done.x.reason === "limited", reason: done.x.reason === "limited" ? "limited" : done.x.reason, ok: false };
    } else if (state === "missing") {
      extracts[src.id] = { pending: true, reason: "timeout" };
      trace.pending.push(src.id);
    }
  }
  const persist = Promise.all(settled).then(() => persistParts({ env, ticker, plan, results, cache, trace, now: Date.now(), deps }));
  if (settled.length) {
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(persist.catch(() => {}));
    else await persist.catch(() => {});
  }

  const dossier = buildDossier({
    ticker, now, expectedSession: expected, held, vendor: extracts,
  });
  return { dossier, trace, neuron, known, admitted, clock, held };
}

async function persistParts({ env, ticker, plan, results, cache, trace, now }) {
  const byKind = new Map();
  for (const { src } of plan.picked) {
    const done = results[src.id];
    if (!done) continue;
    const storable = done.x.ok === true || (done.x.ok === false && done.x.transient !== true);
    if (!storable || src.id === "quote") continue;
    if (src.fast) {
      await writeFast(src.id, ticker, done.at, done.x);
      trace.wrote.push("cache:" + src.id);
      continue;
    }
    if (!byKind.has(src.kind)) byKind.set(src.kind, {});
    const { transient, ...x } = done.x;
    byKind.get(src.kind)[src.id] = { at: done.at, x };
  }
  if (!byKind.size || !env.DB) return;
  const statements = [];
  for (const [kind, fresh] of byKind) {
    const parts = { ...((cache[kind] && cache[kind].parts) || {}), ...fresh };
    let payload = JSON.stringify({ v: 1, parts });
    if (payload.length > BUDGET.payloadBytes) {
      const bySize = Object.entries(parts).sort((a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length);
      for (const [id] of bySize) {
        if (payload.length <= BUDGET.payloadBytes) break;
        delete parts[id];
        payload = JSON.stringify({ v: 1, parts });
      }
    }
    if (payload.length > BUDGET.payloadBytes) continue;
    statements.push(env.DB.prepare(DOSSIER_WRITE_SQL).bind(ticker, kind, now, payload));
    trace.wrote.push("d1:" + kind);
  }
  if (statements.length) await env.DB.batch(statements).catch(() => { trace.wrote.push("d1:failed"); });
}

export function dossierFresh(result, now) {
  const { dossier, neuron, held } = result;
  const metas = [];
  if (held.card && neuron && neuron.generatedAt) metas.push({ readAt: neuron.generatedAt, session: neuron.sessionDate, klass: "nightly", source: "nightly", cadenceS: 0 });
  else if (held.universe && held.universe.generatedAt) metas.push({ readAt: held.universe.generatedAt, session: held.universe.sessionDate, klass: "nightly", source: "nightly", cadenceS: 0 });
  if (held.strip && Number.isFinite(held.strip.readAt)) metas.push({ readAt: held.strip.readAt, session: held.strip.session, klass: "breadth", source: "actions", cadenceS: 900 });
  const rank = { live: 0, fresh: 1, closed: 2, stale: 3, pending: 4 };
  let worst = null;
  for (const meta of metas) {
    const f = freshHeaders(meta, now, result.clock);
    if (!worst || rank[f.headers["X-Fresh-State"]] > rank[worst.headers["X-Fresh-State"]]) worst = f;
  }
  return worst ? worst.headers : null;
}

export { renderDossierForModel, DEFAULT_BUDGET_TOKENS, VENDOR_ROUTES };
