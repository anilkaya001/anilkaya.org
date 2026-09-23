import {
  gexHistory, volumeHistory, gexLevels, flowExpiry, flowStrike, nopeSection, gexPath, oiWalls,
  pickLifelineContracts, lifeline, darkpoolLevels, alertsTape, multiLeg, rowsOf, failedRead, readCode,
  sessionWindow, sessionCandle, packSeries, unpackSeries, freshStamp, toMs, minuteOf, isDay, silence,
  POSITIONING_VERSION,
} from "../../shared/flows-positioning.js";
import { putMultipliers } from "../../shared/flows-variation.js";

export const FLOW_LEG = Object.freeze({
  ALERT_BATCH: 10,
  ALERT_LIMIT: 200,
  ALERT_MAX_PAGES: 8,
  MULTI_LIMIT: 500,
  MULTI_MAX_OFFSET: 500,
  LIFELINES: 3,
  LIFE_LIMIT: 60,
  CARD_X_CAP: 100 * 1024,
  FLOW_BUDGET: 48 * 1024,
  HIST_CAP: 16 * 1024,
  NOPE_KEEP: 252,
  HIST_TRIM_STEP: 21,
  POOL_MAX: 3,
});

export const DEEP_SECTIONS = Object.freeze([
  "gex", "volume", "gexLevels", "flowExpiry", "flowStrike", "nope", "gexPath",
  "contracts", "dpLevels", "alerts", "multiLeg",
]);

export const CROSS_SECTIONS = Object.freeze(["gex", "volume", "oiWalls"]);

export const SHED_ORDER = Object.freeze([
  "contracts", "multiLeg", "alerts", "gexPath", "flowStrike", "nope", "flowExpiry", "dpLevels", "oiWalls",
]);

const chunk = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

const bytes = (v) => JSON.stringify(v).length;

export async function readAlertBatch(read, names, win, { limit = FLOW_LEG.ALERT_LIMIT, maxPages = FLOW_LEG.ALERT_MAX_PAGES } = {}) {
  const rows = [];
  let pages = 0, olderThan = win.closeIso, complete = false, failed = null, coverFrom = null;
  while (pages < maxPages) {
    const body = await read("/api/option-trades/flow-alerts", {
      ticker_symbol: names.join(","), limit, newer_than: win.openIso, older_than: olderThan,
    });
    pages++;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.__failed === "string") {
      failed = body.__failed;
      break;
    }
    const got = rowsOf(body, "data");
    if (got === null) { failed = "malformed"; break; }
    let oldest = null;
    for (const r of got) {
      rows.push(r);
      const t = toMs(r && r.start_time) ?? toMs(r && r.created_at);
      if (t !== null && (oldest === null || t < oldest)) oldest = t;
    }
    if (oldest !== null) coverFrom = coverFrom === null ? oldest : Math.min(coverFrom, oldest);
    if (got.length < limit || oldest === null || oldest <= win.open) { complete = true; break; }
    const next = new Date(oldest).toISOString();
    if (next === olderThan) break;
    olderThan = next;
  }
  if (failed && !rows.length) return { rows: failedRead(failed), complete: false, pages, coverFromM: null };
  return {
    rows, complete, pages,
    coverFromM: complete ? 0 : coverFrom === null ? null : Math.max(0, minuteOf(coverFrom, win)),
  };
}

export async function readMultiLeg(read, ticker, win, { limit = FLOW_LEG.MULTI_LIMIT, maxOffset = FLOW_LEG.MULTI_MAX_OFFSET } = {}) {
  const rows = [];
  let truncated = false, calls = 0;
  for (let offset = 0; offset <= maxOffset; offset += limit) {
    const body = await read("/api/option-trades/multi-leg", {
      ticker_symbol: ticker, limit, newer_than: win.openIso, older_than: win.closeIso,
      ...(offset ? { offset } : {}),
    });
    calls++;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.__failed === "string") {
      if (!rows.length) return { rows: body, truncated: false, calls };
      truncated = true;
      break;
    }
    const got = rowsOf(body, "data");
    if (got === null) {
      if (!rows.length) return { rows: null, truncated: false, calls };
      truncated = true;
      break;
    }
    for (const r of got) rows.push(r);
    truncated = got.length >= limit;
    if (!truncated) break;
  }
  return { rows, truncated, calls };
}

export function buildHist({ ticker, sessionDate, generatedAt, fresh, gex, volume, nope, cap = FLOW_LEG.HIST_CAP }) {
  const nopeDays = (nope || []).map((p) => p.d);
  const axis = [...new Set([...(gex ? gex.d : []), ...(volume ? volume.d : []), ...nopeDays])]
    .filter((d) => isDay(d) && (!isDay(sessionDate) || d <= sessionDate)).sort()
    .slice(-FLOW_LEG.NOPE_KEEP);
  const align = (days, values) => {
    const at = new Map(days.map((d, i) => [d, values[i]]));
    return axis.map((d) => (at.has(d) ? at.get(d) : null));
  };
  const cols = {
    g: gex ? align(gex.d, gex.g) : null, c: gex ? align(gex.d, gex.c) : null, v: gex ? align(gex.d, gex.v) : null,
    np: volume ? align(volume.d, volume.np) : null, bb: volume ? align(volume.d, volume.bb) : null,
    vol: volume ? align(volume.d, volume.vol) : null, pc: volume ? align(volume.d, volume.pc) : null,
    oi: volume ? align(volume.d, volume.oi) : null,
    nope: nope && nope.length ? align(nopeDays, nope.map((p) => p.v)) : null,
  };
  const make = (start) => {
    const pk = (xs) => (xs ? packSeries(xs.slice(start)) : null);
    const days = axis.slice(start);
    const d0 = days.length ? days[0] : null;
    return {
      v: POSITIONING_VERSION, ticker, sessionDate, generatedAt, fresh,
      d0,
      dd: days.map((d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(d0 + "T00:00:00Z")) / 86400000)),
      gex: gex ? { asOf: gex.d[gex.d.length - 1] || null, g: pk(cols.g), c: pk(cols.c), v: pk(cols.v) } : null,
      volume: volume ? {
        asOf: volume.d[volume.d.length - 1] || null,
        np: pk(cols.np), bb: pk(cols.bb), vol: pk(cols.vol), pc: pk(cols.pc), oi: pk(cols.oi),
      } : null,
      nope: cols.nope ? { asOf: nopeDays[nopeDays.length - 1] || null, ...pk(cols.nope) } : null,
      u: { dd: "days", g: "shareGamma", c: "vendor", v: "vendor", np: "usd", bb: "usd", vol: "contracts", pc: "ratio",
        oi: "contracts", nope: "ratio" },
      trimmed: start,
    };
  };
  let start = 0;
  let payload = make(start);
  while (bytes(payload) > cap && start < axis.length) {
    start = Math.min(axis.length, start + FLOW_LEG.HIST_TRIM_STEP);
    payload = make(start);
  }
  return payload;
}

export function histNope(read, sessionDate) {
  const p = read && read.payload;
  if (!p || !p.nope || !Array.isArray(p.nope.x)) return [];
  if (!Array.isArray(p.dd) || !isDay(p.d0) || p.dd.length !== p.nope.x.length) return [];
  const base = Date.parse(p.d0 + "T00:00:00Z");
  const days = p.dd.map((o) => (Number.isInteger(o) ? new Date(base + o * 86400000).toISOString().slice(0, 10) : null));
  const values = unpackSeries(p.nope);
  const out = [];
  days.forEach((d, i) => {
    if (isDay(d) && (!isDay(sessionDate) || d < sessionDate) && values[i] !== null) out.push({ d, v: values[i] });
  });
  return out;
}

export function mergeFresh(a, b) {
  if (!a) return b;
  if (!b) return a;
  const older = (x, y) => (!x ? y : !y ? x : x < y ? x : y);
  const newer = (x, y) => (!x ? y : !y ? x : x > y ? x : y);
  return { ...a, readAt: older(a.readAt, b.readAt), vendorAt: newer(a.vendorAt, b.vendorAt) };
}

export function composeCardX(existing, base, sections, { cap = FLOW_LEG.CARD_X_CAP, budget = FLOW_LEG.FLOW_BUDGET } = {}) {
  const mine = { ...sections };
  const shed = [];
  const shedOne = (limitFn) => {
    for (const key of SHED_ORDER) {
      if (!limitFn()) return;
      if (!mine[key] || mine[key].status !== "ok" && mine[key].status !== "stale") continue;
      mine[key] = silence("unavailable", "shed");
      shed.push(key);
    }
  };
  shedOne(() => bytes(mine) > budget);
  const prior = existing && typeof existing === "object" && existing.sessionDate === base.sessionDate ? existing : null;
  const build = () => ({
    ...(prior || {}),
    ...base,
    fresh: mergeFresh(prior && prior.fresh, base.fresh),
    ...mine,
    flowShed: shed,
  });
  let payload = build();
  shedOne(() => bytes(payload = build()) > cap);
  payload = build();
  return { payload, shed, bytes: bytes(payload) };
}

const vendorAtOf = (sections) => {
  let at = null;
  for (const s of Object.values(sections)) {
    const v = s && typeof s.vendorAt === "string" ? s.vendorAt : null;
    if (v && (at === null || v > at)) at = v;
  }
  return at;
};

export async function runFlowLeg(ctx) {
  const {
    uw, publish, stored = () => null, readStored = async () => ({ payload: null, absent: true }),
    runPooled, deadline = Infinity, sessionDate, generatedAt, deep = [], cross = [],
    featuresOf = () => null, strikesOf = () => null, cardOf = () => null, variation = null,
    width = 2, log = () => {}, now = () => new Date(),
  } = ctx;
  const win = sessionWindow(sessionDate);
  const dated = isDay(sessionDate) ? { date: sessionDate } : {};
  const unit = variation && variation.unit && variation.unit.used === "pct$" ? "pct$" : "share";
  const multipliers = variation && variation.probe ? putMultipliers(variation.probe) : putMultipliers(null);
  const putSign = variation && variation.strikeSign && "sign" in variation.strikeSign ? variation.strikeSign.sign : 1;
  const meter = { calls: 0, failed: 0 };
  const read = async (path, params) => {
    meter.calls++;
    try {
      return await uw(path, params, { envelope: true });
    } catch (error) {
      meter.failed++;
      return failedRead(readCode(error));
    }
  };
  const past = () => Date.now() > deadline;
  const tally = {};
  const count = (sections) => {
    for (const [k, s] of Object.entries(sections)) {
      const t = tally[k] || (tally[k] = {});
      const st = (s && s.status) || "none";
      t[st] = (t[st] || 0) + 1;
    }
  };
  const published = { cardX: 0, hist: 0, failed: 0, shed: 0 };

  const alertBatches = new Map();
  let alertPages = 0;
  if (win) {
    const batches = chunk(deep, FLOW_LEG.ALERT_BATCH);
    const run = await runPooled(batches, async (names) => {
      const b = await readAlertBatch(read, names, win);
      alertPages += b.pages;
      for (const n of names) alertBatches.set(n, b);
      return b;
    }, { width: Math.min(width, FLOW_LEG.POOL_MAX), stopEarly: past });
    batches.forEach((names, i) => {
      if (!run.attempted[i]) for (const n of names) alertBatches.set(n, { rows: failedRead("deadline"), complete: false });
    });
  }

  const emit = async (ticker, depth, sections, hist) => {
    const readAt = hist.readAt;
    const fresh = freshStamp({ readAt, vendorAt: vendorAtOf(sections), sessionDate });
    const base = { v: POSITIONING_VERSION, ticker, sessionDate, generatedAt, depth, fresh };
    const card = composeCardX(stored("card-x:" + ticker), base, sections);
    if (card.shed.length) published.shed++;
    count(sections);
    const h = buildHist({
      ticker, sessionDate, generatedAt, fresh,
      gex: hist.gex, volume: hist.volume, nope: hist.nope,
    });
    try {
      await publish("card-x:" + ticker, card.payload);
      published.cardX++;
      await publish("hist:" + ticker, h);
      published.hist++;
      return { status: "built", shed: card.shed, bytes: card.bytes };
    } catch (error) {
      published.failed++;
      log(`  flow ${ticker}: ${error.message}`);
      return { status: "failed" };
    }
  };

  const deepName = async (ticker) => {
    const f = featuresOf(ticker) || {};
    const readAt = now().toISOString();
    const [gexRaw, volRaw, levelsRaw, expRaw, strikeRaw, nopeRaw, pathRaw, dpRaw, ml, prior] = await Promise.all([
      read(`/api/stock/${ticker}/greek-exposure`, { timeframe: "1Y", ...dated }),
      read(`/api/stock/${ticker}/options-volume`, { limit: 252 }),
      read(`/api/stock/${ticker}/gex-levels`, { source: "oi", ...dated }),
      read(`/api/stock/${ticker}/flow-per-expiry`, {}),
      read(`/api/stock/${ticker}/flow-per-strike`, dated),
      read(`/api/stock/${ticker}/nope`, dated),
      read(`/api/stock/${ticker}/spot-exposures`, dated),
      read(`/api/darkpool/${ticker}/price-levels`, dated),
      win ? readMultiLeg(read, ticker, win) : Promise.resolve({ rows: undefined, truncated: false }),
      Promise.resolve().then(() => readStored("hist:" + ticker)).catch(() => null),
    ]);
    const card = cardOf(ticker);
    const oiPanel = card && card.panels && card.panels.oiDeltas;
    const picks = oiPanel && oiPanel.status === "ok"
      ? pickLifelineContracts(oiPanel.rows, { count: FLOW_LEG.LIFELINES }) : null;
    const lives = picks && picks.length
      ? await Promise.all(picks.map((p) => read(`/api/option-contract/${p.oc}/historic`, { limit: FLOW_LEG.LIFE_LIMIT })))
      : [];

    const gex = gexHistory(gexRaw, { sessionDate, spot: f.spot, adv: f.dollarVolume, unit, multipliers });
    const volume = volumeHistory(volRaw, { sessionDate });
    const levels = gexLevels(levelsRaw, { sessionDate, spot: f.spot, atr: f.atr, strikes: strikesOf(ticker), putSign });
    const vendorWalls = levels.callWall !== undefined && (levels.callWall !== null || levels.putWall !== null);
    const walls = vendorWalls ? { call: levels.callWall, put: levels.putWall }
      : levels.ours ? { call: levels.ours.callWall, put: levels.ours.putWall } : null;
    const nope = nopeSection(nopeRaw, {
      sessionDate, candle: sessionCandle(f.candles, sessionDate), prior: histNope(prior, sessionDate),
    });
    const batch = alertBatches.get(ticker) || { rows: undefined, complete: false, coverFromM: null };
    const sections = {
      gex: gex.section,
      volume: volume.section,
      gexLevels: levels,
      flowExpiry: flowExpiry(expRaw, { sessionDate, readAt }),
      flowStrike: flowStrike(strikeRaw, {
        sessionDate, spot: f.spot, iv30: f.iv30, walls, wallsFrom: walls ? (vendorWalls ? "vendor" : "book") : null,
      }),
      nope: nope.section,
      gexPath: gexPath(pathRaw, { sessionDate }),
      contracts: picks === null ? silence("unavailable", "unread")
        : !picks.length ? silence("quiet", "no-contracts")
        : { status: "ok", why: null, rows: picks.map((p, i) => lifeline(lives[i], { id: p.oc, diff: p.diff, sessionDate })) },
      dpLevels: darkpoolLevels(dpRaw, { sessionDate, spot: f.spot, atr: f.atr }),
      alerts: alertsTape(batch.rows, ticker, {
        sessionDate, adv: f.dollarVolume, complete: batch.complete, coverFromM: batch.coverFromM,
      }),
      multiLeg: multiLeg(ml.rows, ticker, { sessionDate, truncated: ml.truncated }),
    };
    const nopeHistory = histNope(prior, sessionDate);
    if (nope.close !== null && isDay(sessionDate)) nopeHistory.push({ d: sessionDate, v: nope.close });
    return emit(ticker, "deep", sections, {
      readAt, gex: gex.series, volume: volume.series, nope: nopeHistory.slice(-FLOW_LEG.NOPE_KEEP),
    });
  };

  const crossName = async (ticker) => {
    const f = featuresOf(ticker) || {};
    const readAt = now().toISOString();
    const [gexRaw, volRaw, oiRaw, prior] = await Promise.all([
      read(`/api/stock/${ticker}/greek-exposure`, { timeframe: "1Y", ...dated }),
      read(`/api/stock/${ticker}/options-volume`, { limit: 252 }),
      read(`/api/stock/${ticker}/oi-per-strike`, dated),
      Promise.resolve().then(() => readStored("hist:" + ticker)).catch(() => null),
    ]);
    const gex = gexHistory(gexRaw, { sessionDate, spot: f.spot, adv: f.dollarVolume, unit, multipliers });
    const volume = volumeHistory(volRaw, { sessionDate });
    const sections = {
      gex: gex.section,
      volume: volume.section,
      oiWalls: oiWalls(oiRaw, { sessionDate, spot: f.spot, atr: f.atr }),
    };
    return emit(ticker, "cross", sections, {
      readAt, gex: gex.series, volume: volume.series, nope: histNope(prior, sessionDate).slice(-FLOW_LEG.NOPE_KEEP),
    });
  };

  const lane = Math.max(1, Math.min(width, FLOW_LEG.POOL_MAX));
  const deepRun = await runPooled(deep, (t) => deepName(t).catch((e) => {
    published.failed++;
    log(`  flow ${t}: ${e.message}`);
    return { status: "failed" };
  }), { width: lane, stopEarly: past });
  const crossRun = await runPooled(cross, (t) => crossName(t).catch((e) => {
    published.failed++;
    log(`  flow ${t}: ${e.message}`);
    return { status: "failed" };
  }), { width: lane, stopEarly: past });

  const skipped = deepRun.attempted.filter((a) => !a).length + crossRun.attempted.filter((a) => !a).length;
  const sizes = [...deepRun.results, ...crossRun.results].filter((r) => r && r.bytes).map((r) => r.bytes);
  const summary = {
    deep: deep.length, cross: cross.length,
    calls: meter.calls, failedCalls: meter.failed, alertPages,
    published, skipped,
    maxCardXBytes: sizes.length ? Math.max(...sizes) : null,
    sections: tally,
  };
  log(`  flow leg: ${deep.length} deep + ${cross.length} cross-section name(s), ${meter.calls} vendor ` +
    `call(s) (${meter.failed} failed), ${alertPages} flow-alert page(s)`);
  log(`  flow leg: card-x ${published.cardX} and hist ${published.hist} published, ${published.failed} failed, ` +
    `${published.shed} shed a section to fit, ${skipped} skipped past the deadline` +
    (summary.maxCardXBytes ? `, largest card-x ${summary.maxCardXBytes} bytes` : ""));
  log("  flow sections: " + Object.entries(tally).map(([k, t]) =>
    `${k} ${Object.entries(t).map(([s, n]) => `${s}:${n}`).join("/")}`).join(" · "));
  return summary;
}
