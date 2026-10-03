import * as D from "../shared/flows-dossier.js";
import * as V from "../shared/flows-dossier-vendor.js";
import { buildContext } from "../shared/flows-neuron.js";
import { earningsHistory } from "../shared/flows-catalysts.js";
import { universeValue } from "../shared/flows-cross.js";
import * as F from "./dossier-fixtures.mjs";

const { NOW, T, SESSION } = F;

const clone = (x) => JSON.parse(JSON.stringify(x));

function reduceAll() {
  const out = {};
  for (const [k, fn] of Object.entries(V.REDUCERS)) out[k] = fn(F.vendorBody(k), T);
  out.earnings = { ok: true, hist: earningsHistory(F.vendorBody("earnings").data, { sessionDate: SESSION }) };
  out.quote = V.quoteExtract({ status: "ok", price: 127.4, prevClose: 125.8, changePct: 0.01272, open: 126.2, high: 128.1, low: 125.9, volume: 2150000, tapeTime: "2026-10-02 14:29:40+00:00" });
  return out;
}

function heldUniverse(ticker) {
  const payload = F.universe();
  const i = payload.t.indexOf(ticker);
  if (i < 0) return null;
  const u = {};
  for (const k of Object.keys(payload.cols)) u[k] = universeValue(payload, ticker, k);
  const pct = {};
  for (const k of Object.keys(payload.pct)) pct[k] = payload.pct[k][i];
  const sec = payload.sec[i];
  return {
    sessionDate: payload.sessionDate, generatedAt: payload.generatedAt, rank: i + 1, n: payload.n,
    sector: sec === null ? null : payload.sectors[sec], sectorTilt: sec === null || payload.sectorTilt[sec] === null ? null : payload.sectorTilt[sec] / 100, u, pct,
  };
}

function heldAll() {
  const cardObj = F.card(T);
  const cx = F.cardX(T);
  if (cardObj.engine && cardObj.engine.status === "split" && cx.engine) cardObj.engine = cx.engine;
  const ev = F.events();
  const rg = F.regime();
  const strip = F.stripsPayload();
  const market = F.marketPayload();
  const stripValues = {};
  strip.fields.forEach((n, i) => { stripValues[n] = strip.rows[T][i]; });
  const alertsPayload = F.alertsPayload();
  const mkRows = market.sectors.rows;
  const etf = mkRows.find((r) => r.etf === "XLK");
  const neuronCtx = buildContext(cardObj, { expectedSession: SESSION });
  return {
    expected: SESSION, card: cardObj, cardX: { sessionDate: cx.sessionDate, generatedAt: cx.generatedAt, short: cx.short, insiders: cx.insiders, earnings: cx.earnings },
    universe: heldUniverse(T),
    regime: { sessionDate: rg.sessionDate, generatedAt: rg.generatedAt, etf: { SPY: { status: "ok", net: 2.4e8, date: SESSION }, QQQ: { status: "ok", net: -1.1e8, date: SESSION }, IWM: { status: "ok", net: 3e7, date: SESSION } },
      zeroDte: { status: "ok", share: 0.38 }, curve: { status: "ok", ts: -0.06, fs: -0.02, shape: "contango" }, corr: { SPY: { status: "ok", rho: 0.41 } } },
    events: { sessionDate: ev.sessionDate, generatedAt: ev.generatedAt, row: ev.rows[0], macro: ev.macro },
    strip: { readAt: Date.parse("2026-10-02T14:25:00.000Z"), session: F.TODAY, values: stripValues },
    market: { readAt: Date.parse("2026-10-02T14:27:00.000Z"), session: F.TODAY, tideStatus: "ok", tideNet: market.last.tideNet, tideLastAt: market.tide.lastAt },
    sectorEtf: { etf: etf.etf, name: etf.name, chg: etf.chg, lean: etf.lean, net: etf.net, asOf: null },
    alerts: { readAt: Date.parse("2026-10-02T14:20:00.000Z"), session: F.TODAY, rows: alertsPayload.rows.filter((r) => r.t === T), age: 600 },
    tape: F.tapePayload(), newsRows: [],
    neuron: { status: "ok", tier: "priced", code: null, why: "Priced by the options engine on this name's own option chain.", context: neuronCtx,
      sessionDate: cardObj.sessionDate, generatedAt: cardObj.generatedAt, behind: 0 },
  };
}

const NONE = Object.freeze({ status: "absent", tier: "none", code: "not-covered", why: "This name is not in the nightly universe.", sessionDate: null, generatedAt: null });

const headline = (h, at, sent = "positive", major = false) => ({ at, h, src: "Reuters", sent, major });

export const ARCHETYPES = Object.freeze(["base", "momentum", "crowded", "quiet", "nocard", "withheld"]);

export function archetypeInputs(name) {
  const held = heldAll();
  let vendor = reduceAll();
  let ticker = T;
  if (name === "momentum") {
    held.cardX.earnings = { ...held.cardX.earnings, next: { d: "2026-10-07", confirmed: true, when: "postmarket" } };
    held.universe.u = { ...held.universe.u, sma50: 0.094, rsi: 72, adx: 31, rv20: 0.34, rvol: 1.9 };
    held.strip.values = { ...held.strip.values, lean: 0.62, net: 9400000, ncp: 12100000, npp: 2700000 };
    const at = (m) => new Date(NOW - m * 60000).toISOString();
    held.newsRows = [
      headline("Example Technologies lifts guidance as cloud demand accelerates", at(30), "positive", true),
      headline("Example Technologies announces a new data-centre region in Frankfurt", at(120)),
      headline("Brokers raise estimates on Example Technologies ahead of results", at(200)),
      headline("Example Technologies expands its partner programme", at(400), "neutral"),
      headline("Example Technologies shares touch a record high", at(600)),
      headline("Options traders position for a big move in Example Technologies", at(900), "neutral"),
    ];
  } else if (name === "crowded") {
    held.cardX.short = clone(held.cardX.short);
    held.cardX.short.interest = { ...held.cardX.short.interest, shares: 52000000, float: 280000000, dtc: 7.5 };
    held.cardX.insiders = { ...held.cardX.insiders, status: "ok", net90: -3200000, buys90: 0, sells90: -3200000, buyCount: 0, sellCount: 5, cluster: false, days: 90, complete: true, lastFiling: "2026-09-20" };
    held.universe.u = { ...held.universe.u, sma50: -0.06, rsi: 41 };
  } else if (name === "quiet") {
    ticker = T;
    held.card.sector = "Utilities";
    held.universe.sector = "Utilities";
    held.universe.u = { ...held.universe.u, rv20: 0.16, rvol: 0.85, adx: 14, sma50: 0.01, rsi: 51 };
    held.universe.pct = { ...held.universe.pct, vrp: 45, iv30: 40, ts: 50, gexAdv: 50, si: 30 };
    held.cardX.earnings = { ...held.cardX.earnings, next: { d: "2026-11-12", confirmed: false, when: "premarket" } };
    held.events = { ...held.events, row: null };
    held.strip.values = { ...held.strip.values, lean: 0.03, net: 120000, ncp: 3100000, npp: 3000000 };
    held.neuron = { ...held.neuron, tier: "family", code: null, context: { ...held.neuron.context, engine: null, state: { ...held.neuron.context.state, state: "undetermined", confidence: 0, brief: null } } };
    held.newsRows = [];
    held.regime = null;
    held.market = null;
    held.sectorEtf = null;
    vendor = { ...vendor, news: { ok: false, reason: "empty" }, analysts: { ok: false, reason: "empty" } };
  } else if (name === "nocard") {
    ticker = "NOCD";
    const keep = { quote: V.quoteExtract({ status: "ok", price: 18.2, prevClose: 17.9, changePct: 0.0168, open: 18, high: 18.4, low: 17.8, volume: 410000, tapeTime: "2026-10-02 14:29:40+00:00" }) };
    vendor = { info: vendor.info, news: V.reduceNews(F.vendorBody("news"), T), ...keep };
    vendor.news = { ...vendor.news, rows: vendor.news.rows.map((r) => ({ ...r, h: r.h.replace("EXMP", "NOCD") })) };
    for (const k of ["profile", "financials", "breakdown", "estimates", "analysts", "earnings", "ownership", "short", "insiders", "levels"]) vendor[k] = { ok: false, reason: "budget", pending: false };
    Object.assign(held, { card: null, cardX: null, universe: null, strip: null, alerts: null, tape: null, events: null, regime: null, market: null, sectorEtf: null, newsRows: [], neuron: NONE });
  } else if (name === "withheld") {
    ticker = "WTHD";
    vendor = {};
    for (const k of Object.keys(V.REDUCERS)) vendor[k] = { ok: false, reason: "plan" };
    vendor.quote = { ok: false, reason: "failed" };
    Object.assign(held, { card: null, cardX: null, universe: null, strip: null, alerts: null, tape: null, events: null, regime: null, market: null, sectorEtf: null, newsRows: [], neuron: NONE });
  }
  return { ticker, now: NOW, expectedSession: SESSION, held, vendor };
}

export function archetype(name) {
  return D.buildDossier(archetypeInputs(name));
}
