import {
  VOL_SCHEMA_VERSION, VOL_WHY, buildConePanel, buildRvPanel, buildVrpPanel, buildTermPanel, buildSkewPanel,
  buildIvDynamics, buildAnomalyPanel, buildSentimentPanel, buildCharacterPanel, characterVote, buildVolRadar,
  pickMonthlyExpiry, regularSessionRows, toBars, exEventSlope, exEventVol, crossSectionPercentiles, volSummary,
  silentPanel, isoDay, candleDay, rowsOf, round, eventDayOf, dayDiff, closeToCloseVol,
} from "../../shared/flows-vol.js";

export const VOL_INDEX_NAMES = Object.freeze(["SPY", "QQQ", "IWM"]);

export const VOL_DEPTH_READS = Object.freeze({
  deep: Object.freeze(["cone", "vrp", "term", "anomaly", "sentiment", "character", "rr25", "rr10"]),
  carded: Object.freeze(["cone", "vrp"]),
  index: Object.freeze(["cone", "vrp", "term", "anomaly", "sentiment", "character", "ivRank", "rr25", "rr10"]),
  fund: Object.freeze(["cone", "vrp", "term", "anomaly", "sentiment", "character", "ivRank", "rr25", "rr10"]),
});

export const VOL_FUND_DEPTHS = Object.freeze(["index", "fund"]);

const isFundDepth = (depth) => VOL_FUND_DEPTHS.includes(depth);

export const VOL_RADAR_KINDS = Object.freeze(["rich", "cheap", "bullish", "bearish"]);

export const CARD_X_CAP = 100 * 1024;

export const VOL_PANELS = Object.freeze(["cone", "rv", "vrp", "term", "skew", "ivDyn", "anomaly", "sentiment", "character"]);

const SHED_ORDER = Object.freeze([
  ["sentiment", "history"], ["character", "history"], ["anomaly", "history"],
  ["vrp", "series"], ["skew", "series"],
]);

const dated = (s) => (s ? { date: s } : {});

export function volRequest(kind, ticker, sessionDate, { expiry = null } = {}) {
  const t = encodeURIComponent(ticker);
  switch (kind) {
    case "cone": return { path: `/api/stock/${t}/interpolated-iv/distribution`, params: dated(sessionDate) };
    case "vrp": return { path: `/api/stock/${t}/volatility/variance-risk-premium`, params: { days: 21, ...dated(sessionDate) } };
    case "term": return { path: `/api/stock/${t}/volatility/term-structure/distribution`, params: dated(sessionDate) };
    case "rr25": return { path: `/api/stock/${t}/historical-risk-reversal-skew`,
      params: { expiry, delta: 25, timeframe: "1Y", ...dated(sessionDate) } };
    case "rr10": return { path: `/api/stock/${t}/historical-risk-reversal-skew`,
      params: { expiry, delta: 10, timeframe: "1Y", ...dated(sessionDate) } };
    case "anomaly": return { path: `/api/stock/${t}/volatility/anomaly`, params: dated(sessionDate) };
    case "sentiment": return { path: `/api/stock/${t}/volatility/option-sentiment`, params: dated(sessionDate) };
    case "character": return { path: `/api/stock/${t}/volatility/character`, params: dated(sessionDate) };
    case "ivRank": return { path: `/api/stock/${t}/iv-rank`, params: { timespan: "1y", ...dated(sessionDate) } };
    case "candles": return { path: `/api/stock/${t}/ohlc/1d`,
      params: { timeframe: "2Y", ...(sessionDate ? { end_date: sessionDate } : {}) } };
    default: throw new Error(`unknown vol read ${kind}`);
  }
}

export function radarRequest(kind, sessionDate) {
  switch (kind) {
    case "rich": return { path: "/api/volatility/anomaly/top", params: { direction: "short_vol", limit: 50, ...dated(sessionDate) } };
    case "cheap": return { path: "/api/volatility/anomaly/top", params: { direction: "long_vol", limit: 50, ...dated(sessionDate) } };
    case "bullish": return { path: "/api/volatility/option-sentiment/top", params: { direction: "bullish", limit: 50, ...dated(sessionDate) } };
    case "bearish": return { path: "/api/volatility/option-sentiment/top", params: { direction: "bearish", limit: 50, ...dated(sessionDate) } };
    default: throw new Error(`unknown radar read ${kind}`);
  }
}

export function yearOfCandles(rows, sessionDate) {
  const list = Array.isArray(rows) ? rows : [];
  const anchor = isoDay(sessionDate) || list.map(candleDay).filter(Boolean).sort().pop();
  if (!anchor) return list;
  const cutoff = String(Number(anchor.slice(0, 4)) - 1) + anchor.slice(4);
  return list.filter((r) => { const d = candleDay(r); return d !== null && d > cutoff; });
}

export function volNames({ deep = [], crossSection = [], byTicker = new Map(), index = VOL_INDEX_NAMES, funds = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (ticker, depth, side) => {
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    const e = byTicker.get(ticker);
    const raw = e && e.raw ? e.raw : null;
    const row = e && e.row ? e.row : null;
    out.push({
      ticker, depth,
      lean: side === "long" ? 1 : side === "short" ? -1 : null,
      candles: raw && Array.isArray(raw.ohlc2y) ? raw.ohlc2y : null,
      listedExpiries: raw && Array.isArray(raw.expiries) ? raw.expiries.map((r) => r && r.expiry).filter(Boolean) : [],
      earnings: row && row.next_earnings_date ? { date: row.next_earnings_date, time: row.er_time || null } : null,
      garch: e && e.features ? e.features.garch || null : null,
    });
  };
  for (const item of deep) {
    if (Array.isArray(item)) add(item[0], "deep", item[1]);
    else add(item, "deep", null);
  }
  for (const t of crossSection) add(t, "carded", null);
  for (const t of index) add(t, "index", null);
  for (const t of funds) add(t, "fund", null);
  return out;
}

export function errorCode(error) {
  const m = /HTTP (\d{3})/.exec(String(error && error.message || ""));
  const http = m ? Number(m[1]) : null;
  return { code: http !== null && http >= 400 && http < 500 && http !== 429 ? "refused" : "read-failed", http };
}

function fromRead(read, build) {
  if (!read) return silentPanel("unavailable", "not-read");
  if (read.error) return silentPanel("unavailable", read.error.code, read.error.http ? { http: read.error.http } : {});
  return build(read.body);
}

const notRead = () => silentPanel("unavailable", "not-read");

function newestStamp(bodies) {
  let best = null;
  for (const b of bodies) {
    const latest = b && b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data.latest : null;
    const s = latest && typeof latest.updated_at === "string" ? latest.updated_at : null;
    if (s && (!best || s > best)) best = s;
  }
  return best;
}

async function readName(name, { call, sessionDate, repair, notes }) {
  const { ticker } = name;
  const kinds = VOL_DEPTH_READS[name.depth] || VOL_DEPTH_READS.carded;
  const phase1 = kinds.filter((k) => k !== "rr25" && k !== "rr10");
  if (!name.candles) phase1.push("candles");
  const reads = {};
  await Promise.all(phase1.map(async (k) => { reads[k] = await call(k, volRequest(k, ticker, sessionDate)); }));

  const candleRows = name.candles || (reads.candles && !reads.candles.error ? rowsOf(reads.candles.body) || [] : []);
  const regular = regularSessionRows(candleRows);
  const repaired = repair ? repair(regular) : { candles: regular, breaks: [] };
  const bars = toBars(Array.isArray(repaired) ? repaired : repaired.candles, { sessionDate });
  const rv = buildRvPanel(bars, { sessionDate, breaks: Array.isArray(repaired) ? null : repaired.breaks });
  if (reads.candles && reads.candles.error && rv.panel.status !== "ok") {
    rv.panel = silentPanel("unavailable", reads.candles.error.code);
  }

  const cone = kinds.includes("cone")
    ? fromRead(reads.cone, (b) => buildConePanel(b, { sessionDate, rolling: rv.rolling })) : notRead();
  const term = kinds.includes("term")
    ? fromRead(reads.term, (b) => buildTermPanel(b, { sessionDate, earnings: name.earnings })) : notRead();

  let skew = notRead();
  if (kinds.includes("rr25")) {
    const listed = [...(name.listedExpiries || [])];
    if (term.status === "ok") for (const e of term.expiries) listed.push(e.expiry);
    const choice = pickMonthlyExpiry(listed, sessionDate);
    if (choice.expiry) {
      const [r25, r10] = await Promise.all([
        call("rr25", volRequest("rr25", ticker, sessionDate, { expiry: choice.expiry })),
        call("rr10", volRequest("rr10", ticker, sessionDate, { expiry: choice.expiry })),
      ]);
      reads.rr25 = r25; reads.rr10 = r10;
      skew = r25.error
        ? silentPanel("unavailable", r25.error.code, { expiry: choice.expiry })
        : buildSkewPanel(r25.body, r10.error ? null : r10.body, { sessionDate, expiry: choice.expiry });
      if (skew.status === "ok") skew = { ...skew, rolled: choice.rolled, expirySource: choice.source };
    } else {
      skew = silentPanel("unavailable", choice.code || "no-monthly");
    }
  }

  const vrp = kinds.includes("vrp")
    ? fromRead(reads.vrp, (b) => buildVrpPanel(b, {
      sessionDate, iv30: cone.status === "ok" ? cone.iv30 : null, bars: rv.bars || null, garch: name.garch,
    })) : notRead();
  const ivDyn = kinds.includes("ivRank")
    ? fromRead(reads.ivRank, (b) => buildIvDynamics(b, { sessionDate }))
    : name.depth === "deep" ? silentPanel("unavailable", "input-absent") : notRead();
  const anomaly = kinds.includes("anomaly")
    ? fromRead(reads.anomaly, (b) => buildAnomalyPanel(b, { sessionDate, ours: cone.status === "ok" ? cone.view : null }))
    : notRead();
  const sentiment = kinds.includes("sentiment")
    ? fromRead(reads.sentiment, (b) => buildSentimentPanel(b, { sessionDate, lean: name.lean })) : notRead();
  const character = kinds.includes("character")
    ? fromRead(reads.character, (b) => buildCharacterPanel(b, {
      sessionDate, ivHalfLife: ivDyn.status === "ok" ? ivDyn.halfLife : null,
    })) : notRead();

  const eventDay = eventDayOf(name.earnings);
  const eventWithin = (days) => !!eventDay && !!sessionDate && eventDay > sessionDate && dayDiff(sessionDate, eventDay) <= days;
  const termSilence = () => ({ value: null, code: term.code === "not-read" ? "not-read" : "input-absent" });
  if (cone.status === "ok") {
    const ex = term.status === "ok" ? exEventSlope(cone, term, sessionDate)
      : !eventWithin(90) ? { value: cone.slope30_90, code: cone.slope30_90 === null ? "input-absent" : null }
        : termSilence();
    cone.slope30_90ExEvent = ex.value;
    if (ex.code) cone.silent.slope30_90ExEvent = ex.code;
  }
  if (vrp.status === "ok") {
    const ex = term.status === "ok"
      ? exEventVol(vrp.exAnte.iv30, 30, term, sessionDate)
      : !eventWithin(30) ? { value: vrp.exAnte.iv30, code: vrp.exAnte.iv30 === null ? "input-absent" : null }
        : termSilence();
    const rv21 = rv.bars && rv.bars.length ? closeToCloseVol(rv.bars, 21) : null;
    vrp.exAnte.iv30ExEvent = round(ex.value, 4);
    vrp.exAnte.vrpExEvent = ex.value !== null && rv21 !== null && vrp.exAnte.rv21 !== null ? round(ex.value - rv21, 5) : null;
    if (vrp.exAnte.vrpExEvent === null) vrp.silent.vrpExEvent = ex.code || "input-absent";
  }

  const stamps = Object.values(reads).map((r) => r && r.at).filter(Boolean).sort();
  if (!notes.candleSource && reads.candles && !name.candles) notes.candleSource = "read";
  return {
    ticker, depth: name.depth,
    readAt: stamps.length ? stamps[0] : null,
    vendorAt: newestStamp(Object.values(reads).map((r) => r && r.body)),
    reads: Object.fromEntries(Object.entries(reads).map(([k, r]) => [k, r.error ? r.error.code : "ok"])),
    panels: { cone, rv: rv.panel, vrp, term, skew, ivDyn, anomaly, sentiment, character },
  };
}

function deadlineEntry(name) {
  const panels = {};
  for (const k of VOL_PANELS) panels[k] = silentPanel("unavailable", "deadline");
  return { ticker: name.ticker, depth: name.depth, readAt: null, vendorAt: null, reads: {}, panels };
}

function brokenEntry(name) {
  const panels = {};
  for (const k of VOL_PANELS) panels[k] = silentPanel("unreadable", "unreadable-body");
  return { ticker: name.ticker, depth: name.depth, readAt: null, vendorAt: null, reads: {}, panels };
}

export async function runVolLeg({
  uw, names = [], sessionDate = null, repair = null, pool = null,
  now = () => new Date().toISOString(), radar = true,
} = {}) {
  const stats = { names: names.length, calls: 0, failed: 0, byRead: {}, depth: {}, broken: [] };
  const notes = {};
  const call = async (kind, req) => {
    stats.calls++;
    const tally = stats.byRead[kind] || (stats.byRead[kind] = { ok: 0, failed: 0 });
    try {
      const body = await uw(req.path, req.params, { envelope: true });
      tally.ok++;
      return { body, at: now(), error: null };
    } catch (error) {
      stats.failed++;
      tally.failed++;
      return { body: null, at: now(), error: errorCode(error) };
    }
  };
  const run = pool || (async (items, work) => {
    const results = [];
    for (let i = 0; i < items.length; i++) results.push(await work(items[i], i));
    return { results };
  });
  const outcome = await run(names, async (name) => {
    try {
      return await readName(name, { call, sessionDate, repair, notes });
    } catch (error) {
      stats.broken.push(`${name.ticker}: ${String((error && error.message) || error).slice(0, 160)}`);
      return brokenEntry(name);
    }
  });
  const results = (outcome && outcome.results) || [];
  const byTicker = new Map();
  names.forEach((name, i) => {
    const entry = results[i] || deadlineEntry(name);
    byTicker.set(name.ticker, entry);
    stats.depth[name.depth] = (stats.depth[name.depth] || 0) + 1;
  });
  const entries = [...byTicker.values()];
  const ok = (p) => p && p.status === "ok";
  const xs = crossSectionPercentiles(entries.filter((e) => !isFundDepth(e.depth)), {
    slope30_90: (e) => (ok(e.panels.cone) ? e.panels.cone.slope30_90 : null),
    richCheap: (e) => (ok(e.panels.cone) ? e.panels.cone.richCheap : null),
    rr25: (e) => (ok(e.panels.skew) ? e.panels.skew.rr25 : null),
    exAnte: (e) => (ok(e.panels.vrp) ? e.panels.vrp.exAnte.vrp : null),
  });
  for (const [e, pct] of xs) {
    if (ok(e.panels.cone)) e.panels.cone.xPct = { slope30_90: pct.slope30_90, richCheap: pct.richCheap };
    if (ok(e.panels.skew)) e.panels.skew.xPct = { rr25: pct.rr25 };
    if (ok(e.panels.vrp)) e.panels.vrp.exAnte.xPct = pct.exAnte;
  }
  let radarSection = null;
  let radarReadAt = null;
  if (radar) {
    const bodies = {};
    const stamps = [];
    for (const kind of VOL_RADAR_KINDS) {
      const r = await call("radar:" + kind, radarRequest(kind, sessionDate));
      bodies[kind] = r.error ? null : r.body;
      stamps.push(r.at);
    }
    radarSection = buildVolRadar(bodies, { sessionDate, carded: names.filter((n) => !isFundDepth(n.depth)).map((n) => n.ticker) });
    radarReadAt = stamps.filter(Boolean).sort()[0] || null;
  }
  return { byTicker, radar: radarSection, radarReadAt, stats, notes, sessionDate };
}

export function attachVol(card, leg, ticker, { ivRank = undefined } = {}) {
  if (!card) return card;
  if (!leg) {
    card.x = { ...(card.x || {}), vol: { v: VOL_SCHEMA_VERSION, status: "unavailable", code: "read-failed", reason: VOL_WHY["read-failed"] } };
    return card;
  }
  const entry = leg.byTicker.get(ticker);
  if (!entry) {
    card.x = { ...(card.x || {}), vol: { v: VOL_SCHEMA_VERSION, status: "unavailable", code: "not-read", reason: VOL_WHY["not-read"] } };
    return card;
  }
  try {
    if (ivRank !== undefined && !isFundDepth(entry.depth)) {
      let dyn;
      try {
        dyn = ivRank === null
          ? silentPanel("unavailable", "read-failed")
          : buildIvDynamics(ivRank, { sessionDate: leg.sessionDate });
      } catch {
        dyn = silentPanel("unreadable", "unreadable-body");
      }
      entry.panels.ivDyn = dyn;
      const hl = dyn.status === "ok" ? dyn.halfLife : null;
      entry.panels.character = characterVote(entry.panels.character, hl);
      const cone = entry.panels.cone;
      if (!leg.notes.ivSourceCheck && dyn.status === "ok" && cone && cone.status === "ok" && cone.iv30 !== null) {
        leg.notes.ivSourceCheck = { ticker, cone30: cone.iv30, ivRank: dyn.iv, asOf: dyn.asOf };
      }
    }
    card.x = { ...(card.x || {}), vol: volSummary(entry.panels, { asOf: leg.sessionDate }) };
  } catch {
    card.x = { ...(card.x || {}), vol: { v: VOL_SCHEMA_VERSION, status: "unreadable", code: "unreadable-body",
      reason: VOL_WHY["unreadable-body"] } };
  }
  return card;
}

function codesIn(value, into) {
  if (!value || typeof value !== "object") return into;
  if (Array.isArray(value)) { for (const v of value) codesIn(v, into); return into; }
  for (const [k, v] of Object.entries(value)) {
    if (k === "code" && typeof v === "string" && VOL_WHY[v]) into.add(v);
    else if (k === "silent" && v && typeof v === "object") {
      for (const c of Object.values(v)) if (typeof c === "string" && VOL_WHY[c]) into.add(c);
    } else if (v && typeof v === "object") codesIn(v, into);
  }
  return into;
}

export function freshEnvelope({ readAt = null, vendorAt = null, sessionDate = null } = {}) {
  return { v: 1, readAt, vendorAt, source: "nightly", cadenceS: 0, session: sessionDate, writer: "flows-pipeline" };
}

export function payloadBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function mergeFresh(a, b) {
  if (!a || typeof a !== "object") return b;
  if (!b || typeof b !== "object") return a;
  const older = (x, y) => (!x ? y : !y ? x : x < y ? x : y);
  const newer = (x, y) => (!x ? y : !y ? x : x > y ? x : y);
  return { ...a, ...b, readAt: older(a.readAt, b.readAt), vendorAt: newer(a.vendorAt, b.vendorAt) };
}

function samePrior(prior, sessionDate) {
  return prior && typeof prior === "object" && !Array.isArray(prior) && prior.sessionDate === sessionDate ? prior : null;
}

export function cardXPayload(entry, { sessionDate = null, generatedAt = null, cap = CARD_X_CAP, prior = null } = {}) {
  const panels = {};
  for (const k of VOL_PANELS) panels[k] = entry.panels[k] ? structuredClone(entry.panels[k]) : notRead();
  const base = samePrior(prior, sessionDate);
  const priorWhy = base && base.why && typeof base.why === "object" && !Array.isArray(base.why) ? base.why : {};
  const build = () => {
    const why = { ...priorWhy };
    for (const c of [...codesIn(panels, new Set())].sort()) why[c] = VOL_WHY[c];
    return {
      ...(base || {}),
      v: VOL_SCHEMA_VERSION, ticker: entry.ticker, scope: entry.depth, sessionDate, generatedAt,
      fresh: mergeFresh(base && base.fresh, freshEnvelope({ readAt: entry.readAt, vendorAt: entry.vendorAt, sessionDate })),
      ...panels,
      why,
    };
  };
  let body = build();
  let bytes = payloadBytes(body);
  const shed = [];
  for (const [panel, field] of SHED_ORDER) {
    if (bytes <= cap) break;
    if (!panels[panel] || panels[panel][field] === undefined || panels[panel][field] === null) continue;
    panels[panel][field] = null;
    panels[panel].shed = [...(panels[panel].shed || []), field];
    shed.push(panel + "." + field);
    body = build();
    bytes = payloadBytes(body);
  }
  return { body, bytes, shed, fits: bytes <= cap };
}

export function regimePayload(leg, { sessionDate = null, generatedAt = null, prior = null } = {}) {
  const base = samePrior(prior, sessionDate);
  const own = freshEnvelope({ readAt: leg && leg.radarReadAt, vendorAt: leg && leg.radar ? leg.radar.vendorAt || null : null, sessionDate });
  return {
    ...(base || {}),
    v: VOL_SCHEMA_VERSION, sessionDate, generatedAt,
    fresh: mergeFresh(base && base.fresh, own),
    volRadar: leg && leg.radar ? leg.radar : { status: "unavailable", code: "not-read", reason: VOL_WHY["not-read"] },
  };
}

export function describeVolLeg(leg) {
  if (!leg) return ["  vol: leg did not run"];
  const entries = [...leg.byTicker.values()];
  const count = (k) => entries.filter((e) => e.panels[k] && e.panels[k].status === "ok").length;
  const depth = Object.entries(leg.stats.depth).map(([k, v]) => `${k} ${v}`).join(", ");
  const lines = [
    `  vol: ${entries.length} name(s) (${depth}), ${leg.stats.calls} call(s), ${leg.stats.failed} failed; ok — ` +
      VOL_PANELS.map((k) => `${k} ${count(k)}`).join(", "),
  ];
  const failing = Object.entries(leg.stats.byRead).filter(([, t]) => t.failed).map(([k, t]) => `${k} ${t.failed}/${t.ok + t.failed}`);
  if (failing.length) lines.push(`  vol: failed reads by route — ${failing.join(", ")}`);
  const broken = leg.stats.broken || [];
  if (broken.length) {
    lines.push(`  vol: ${broken.length} name(s) could not be shaped and publish as unreadable — ${broken.slice(0, 5).join("; ")}`);
  }
  if (leg.radar) {
    const r = leg.radar;
    lines.push(`  vol radar: ${r.status} — rich ${r.rich.seen}, cheap ${r.cheap.seen}, bullish ${r.bullish.seen}, ` +
      `bearish ${r.bearish.seen}; ${r.carded.length} carded name(s) appear` + (r.asOf ? `; dated ${r.asOf}` : ""));
  }
  const chk = leg.notes.ivSourceCheck;
  if (chk) {
    lines.push(`  vol: iv30 source check (${chk.ticker}): interpolated-iv 30d ${chk.cone30} against iv-rank ` +
      `${chk.ivRank} on ${chk.asOf} — the ex-ante VRP history reads the variance-risk-premium iv, so a level gap ` +
      "between these two sources would bias its z");
  }
  return lines;
}

export async function publishVol(leg, { publish, stored = () => null, sessionDate = null, generatedAt = null, log = () => {} } = {}) {
  const outcome = { published: 0, failed: 0, shed: 0, maxBytes: 0, maxTicker: null };
  if (!leg) return outcome;
  try {
    for (const line of describeVolLeg(leg)) log(line);
  } catch (error) {
    log(`  vol: the leg summary could not be written (${error.message})`);
  }
  for (const entry of leg.byTicker.values()) {
    try {
      const { body, bytes, shed, fits } = cardXPayload(entry, { sessionDate, generatedAt, prior: stored("card-x:" + entry.ticker) });
      if (shed.length) { outcome.shed++; log(`  card-x ${entry.ticker}: shed ${shed.join(", ")} to fit the cap`); }
      if (!fits) { outcome.failed++; log(`  card-x ${entry.ticker}: ${(bytes / 1024).toFixed(0)}KB after shedding, over the cap`); continue; }
      await publish("card-x:" + entry.ticker, body);
      outcome.published++;
      if (bytes > outcome.maxBytes) { outcome.maxBytes = bytes; outcome.maxTicker = entry.ticker; }
    } catch (error) {
      outcome.failed++;
      log(`  card-x ${entry.ticker}: ${error.message}`);
    }
  }
  try {
    await publish("regime", regimePayload(leg, { sessionDate, generatedAt, prior: stored("regime") }));
  } catch (error) {
    log(`  regime: ${error.message}`);
  }
  log(`  card-x: ${outcome.published} published, ${outcome.failed} failed, ${outcome.shed} shed` +
    (outcome.maxTicker ? `; largest ${outcome.maxTicker} at ${(outcome.maxBytes / 1024).toFixed(1)}KB of ${CARD_X_CAP / 1024}KB` : ""));
  return outcome;
}
