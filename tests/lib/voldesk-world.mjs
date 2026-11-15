import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "../../shared/flows-voldesk.js";
import { openMarket } from "./market-fixtures.mjs";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures-voldesk.json"), "utf8"));
export const SHAPES_REAL = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/flows-probe-shapes.json"), "utf8"));
export const DRY_SESSION = "2026-08-24";
export const VIEWPORTS = Object.freeze([[1920, 1080], [1440, 820], [1024, 768], [390, 844]]);

const clone = (x) => JSON.parse(JSON.stringify(x));

function termRowsFor(shape, session) {
  return FX.term[shape].map((r) => ({ ...r, date: session }));
}

export function partsFor(kind, session = DRY_SESSION) {
  const conj = kind !== "unshaped" && kind !== "failed";
  const shapes = conj ? FX.shapes.conjectured : SHAPES_REAL;
  const dayShift = (rows) => rows.map((r) => ({ ...r, date: r.date === FX.session ? session : r.date }));
  const term = {
    SPY: V.termFund(termRowsFor("contango", session), { session }),
    QQQ: V.termFund(termRowsFor("backwardation", session), { session }),
    IWM: V.termFund(termRowsFor("flat", session), { session }),
    DIA: V.termFund(termRowsFor("short", session), { session }),
  };
  const ivrv = {};
  for (const t of V.FUND_TICKERS) {
    const real = dayShift(FX.realized.fresh).map((r, i, a) => ({ ...r, date: new Date(Date.parse(session + "T00:00:00Z") - (a.length - 1 - i) * 86400000).toISOString().slice(0, 10) }));
    const stats = { ...FX.stats.SPY, ticker: t, date: session };
    ivrv[t] = V.ivrvFund(real, { data: stats }, session);
  }
  if (kind === "partial") ivrv.IWM = V.ivrvFund(null, { data: FX.stats.SPY }, session);
  let futures = V.futuresCurve({ data: { latest: FX.vix.rows, history: FX.vix.history } }, shapes, session);
  if (kind === "plan") futures = { status: "plan", why: "plan", points: [], spot: null, roll30: null };
  const today = [V.reduceCharacterTop({ data: FX.character.today }, shapes), V.reduceCharacterTop({ data: FX.character.today.slice().reverse() }, shapes)];
  const prev = {
    meanRev: V.reduceCharacterTop({ data: FX.character.prev }, FX.shapes.conjectured).rows,
    persistent: [],
  };
  const character = V.characterSection(today[0], today[1], kind === "first" || !conj ? null : prev);
  const matrix = { tickers: [...V.CORR_TICKERS], "3M": V.corrMatrix(FX.corr.ok, V.CORR_TICKERS), "1Y": V.corrMatrix(FX.corr.few, V.CORR_TICKERS) };
  if (kind === "asym") matrix["3M"] = V.corrMatrix(FX.corr.asym, V.CORR_TICKERS);
  if (kind === "absent") matrix["3M"] = V.corrMatrix(FX.corr.absent, V.CORR_TICKERS);
  const site = { implied: 0.42, realized21: 0.36, realized63: 0.4, asOf: session };
  const audit = { names: 36, compared: 316, agree: 312, differs: 4, nc: 8, worst: [["NVDA", "delta", 0.059941]], calls: 288 };
  return { term: { funds: term, futures }, ivrv, matrix, site, character, audit, ops: {} };
}

export function payloadFor(kind, session = DRY_SESSION) {
  const p = V.buildVoldesk(partsFor(kind, session), { session, generatedAt: session + "T21:45:00.000Z", test: true });
  return clone(p);
}

export function openVd(browser, { kind = "ok", payload = undefined, viewport = { width: 1440, height: 820 }, hash = "#view=voldesk", status = 200, ...rest } = {}) {
  const body = payload !== undefined ? payload : kind === "pending" ? { status: "pending", why: "not_published" } : payloadFor(kind);
  return openMarket(browser, { rich: true, voldesk: body, voldeskStatus: status, viewport, hash, ...rest });
}
