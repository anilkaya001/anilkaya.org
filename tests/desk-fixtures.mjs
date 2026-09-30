import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import * as QC from "../shared/flows-quant-card.js";
import * as ENG from "../shared/flows-quant-engine.js";
import { closeUtcMs } from "../shared/flows-quant-time.js";
import * as QP from "../scripts/flows-quant-pipeline.mjs";
import * as WORLD from "../shared/flows-quant-world.js";
import { STATE_STRUCTURES } from "../shared/flows-neuron.js";
import { midImpliedVol, sigmaMove } from "../shared/flows-premium.js";

export const REPO = new URL("../", import.meta.url);
const DAY = 86400000;

export const NODE_Q = {
  contractFit: QC.contractFit, contractDiagnosis: QC.contractDiagnosis, codeText: QC.codeText, labSetup: QC.labSetup,
  priceStructure: ENG.priceStructure, closeUtcMs,
};

export function engineBlock(ticker, sessionDate, start = 50, extra = {}) {
  const GARCH = { status: "ok", omega: 0.045, alpha: 0.05, beta: 0.9, nu: 7, lambda: -0.1, avg21Vol: 40, nextVol: 42,
    sigma2Next: Math.pow(0.42, 2) / 252, persistence: 0.95, grade: 3, why: [], converged: true };
  const rng = WORLD.xoshiro128ss(ticker.toLowerCase());
  const closes = [start];
  for (let i = 0; i < 260; i++) closes.push(closes[closes.length - 1] * Math.exp(0.025 * WORLD.normalDraw(rng)));
  const pLaw = QC.compactLaw(QP.garchLaw({ garch: GARCH, ticker, sessionDate, closes, rate: 0.04, paths: 2048 }));
  return { status: "ok", rate: { r: 0.04, method: "constant", n: 0 }, facts: [],
    state: { state: "pinned", direction: null, confidence: 2, ...STATE_STRUCTURES.pinned.rich }, pLaw, event: null, stale: false, ...extra };
}

export const optionSymbol = (ticker, expiry, type, strike) =>
  ticker + expiry.slice(2).replace(/-/g, "") + type + String(Math.round(strike * 1000)).padStart(8, "0");

export function sale({ ticker, spot, asOf, type, strike, expiry, bid, ask, iv = 0.34, oi = 500, volume = 50, contract = true, earnings = false, opposite = null, ivMid = undefined }) {
  const a = ask === undefined ? +(bid + 0.02).toFixed(2) : ask;
  const strategy = type === "P" ? "csp" : "cc";
  const days = Math.round((Date.parse(expiry) - Date.parse(asOf)) / DAY);
  const premium = bid * 100;
  const collateral = (strategy === "csp" ? strike : spot) * 100;
  const intrinsic = Math.max(0, strategy === "csp" ? strike - spot : spot - strike);
  const extrinsic = Math.max(0, bid - intrinsic);
  const yieldOnCollateral = premium / collateral;
  const gross = days > 0 ? yieldOnCollateral * (365 / days) : null;
  const time = days > 0 ? (extrinsic * 100 / collateral) * (365 / days) : null;
  const breakeven = strategy === "csp" ? strike - bid : spot - bid;
  const sigma = days > 0 ? iv * Math.sqrt(days / 365) : null;
  const row = {
    symbol: optionSymbol(ticker, expiry, type, strike), ticker, expiry, type, strike, strategy, days,
    bid, ask: a, mid: (bid + a) / 2, spread: (a - bid) / ((bid + a) / 2), premium, collateral, yieldOnCollateral,
    annualized: contract ? time : gross, annualizedIsConvention: true, breakeven,
    cushionSigmas: sigma ? Math.log(spot / breakeven) / sigma : null,
    capSigmas: strategy === "cc" && sigma ? Math.log(strike / spot) / sigma : null,
    assignedReturn: strategy === "cc" ? (strike - spot + bid) / spot : null,
    moneyness: strike / spot - 1, iv, ivTraded: volume > 0, oi, oiChange: 0, volume,
    crossesEarnings: earnings,
  };
  if (contract) {
    const years = days / 365;
    const mid = midImpliedVol({ spot, strike, type, mid: row.mid, years });
    const vol = ivMid === undefined ? mid : ivMid;
    Object.assign(row, {
      intrinsic, extrinsic, annualizedGross: gross, ivMid: vol,
      cushionSigmas: sigmaMove(spot, breakeven, vol, years), capSigmas: strategy === "cc" ? sigmaMove(strike, spot, vol, years) : null,
    });
  }
  if (opposite) row.opposite = opposite;
  return row;
}

export function chain({ ticker, spot, asOf = "2026-09-29", lines, basis = null, engine = null, source = "stock-state",
  tapeTime = null, contract = true, earnings = null, extra = {} }) {
  const rows = lines.map((l) => sale({ ticker, spot, asOf, contract, ...l }));
  const body = {
    ticker, spot, spotSource: source, asOf, generatedAt: new Date().toISOString(), tapeTime, marketTime: tapeTime ? "regular" : null,
    screened: rows.length + 4, priced: rows.length, truncated: false, rankedBy: "annualized",
    gated: { unpriceable: 0, nonStandard: 0, spread: 2, openInterest: 2, premium: 0, expiry: 0, strategy: 0, ...(contract ? { offMarket: 0 } : {}) },
    ivBasis: "median 0.3400 reads as a fraction", ivSurface: null, earnings,
    engine: engine || { status: "unavailable", reason: "no card is published for " + ticker }, rows,
    ...extra,
  };
  if (basis) body.basis = basis;
  return body;
}

export const NVDA_LINES = [
  ["C", 227.5, "2026-09-30", 1.47], ["C", 227.5, "2026-10-02", 2.77], ["P", 225, "2026-09-30", 0.68],
  ["P", 225, "2026-10-02", 1.78], ["C", 230, "2026-10-02", 1.69], ["C", 230, "2026-09-30", 0.56],
  ["C", 227.5, "2026-10-05", 3.25], ["C", 227.5, "2026-10-07", 3.85], ["C", 227.5, "2026-10-09", 4.65],
].map(([type, strike, expiry, bid]) => ({ type, strike, expiry, bid }));

export function nvdaBefore() {
  return chain({ ticker: "NVDA", spot: 231.02, lines: NVDA_LINES, source: "daily-close", contract: false,
    engine: engineBlock("NVDA", "2026-09-29", 190) });
}

export function nvdaAfter() {
  return chain({ ticker: "NVDA", spot: 227.28, lines: NVDA_LINES, source: "daily-close",
    basis: { status: "rebased", spot: 227.28, printSpot: 231.02, printSource: "daily-close", printNote: "a post-market bar", impliedSpot: 227.28, offMarket: 0 },
    engine: engineBlock("NVDA", "2026-09-29", 190) });
}

const TYPES = { css: "text/css", js: "text/javascript", json: "application/json", woff2: "font/woff2", svg: "image/svg+xml" };

export async function openDesk(browser, { root = REPO, payloads = {}, query = "", viewport = { width: 1440, height: 1000 }, init = null, errors = [], onChain = null } = {}) {
  const pages = await import(pathToFileURL(new URL("shared/flows-pages.js", root).pathname).href);
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => errors.push(String(e && e.message || e)));
  if (init) await page.addInitScript(init);
  const asked = [];
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    const json = (b, status = 200, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(b) });
    if (u.pathname === "/api/flows/chain") {
      const t = u.searchParams.get("t");
      asked.push(u.searchParams);
      if (onChain) { const done = await onChain(route, u); if (done) return; }
      const p = payloads[t];
      if (!p) return json({ error: { code: "chain_empty", message: "none" } }, 404);
      return json(typeof p === "function" ? p(u.searchParams) : p, 200, { "x-chain-age": "0" });
    }
    if (u.pathname.startsWith("/api/")) return json({ status: "pending" });
    if (u.pathname.startsWith("/assets/")) {
      const body = await readFile(new URL("." + u.pathname, root)).catch(() => null);
      if (body === null) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ contentType: (TYPES[u.pathname.split(".").pop()] || "application/octet-stream"), body });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.deskPage({ username: "tester" }) });
  });
  await page.goto("https://x.test/flows/desk/" + query, { waitUntil: "domcontentloaded" });
  return Object.assign(page, { asked });
}
