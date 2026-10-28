import { touch } from "./taint.mjs";
import { readList } from "../../shared/flows-floor-funds.js";

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export const FUNDS_FAKE_SCREENER_GAPS = Object.freeze(["UNG", "SIL", "PPLT"]);

export const FUNDS_FAKE_EMPTY_ROOT = "XSP";

function figures(ticker) {
  const rnd = mulberry(seedOf("funds:" + ticker));
  const scale = Math.pow(10, 4 + Math.floor(rnd() * 4));
  return {
    call_premium: String(Math.round(scale * (0.6 + rnd()))),
    put_premium: String(Math.round(scale * (0.4 + rnd()))),
    call_volume: Math.round(200 + (rnd() * scale) / 40),
    put_volume: Math.round(150 + (rnd() * scale) / 40),
    bullish_premium: String(Math.round(scale * (0.3 + rnd()))),
    bearish_premium: String(Math.round(scale * (0.3 + rnd()))),
  };
}

export function fakeFundsRead(path, params, session) {
  touch("fakeFundsRead");
  const p = String(path);
  if (p === "/api/screener/stocks") {
    const asked = String((params && params.ticker) || "").split(",").filter(Boolean);
    return {
      data: asked
        .filter((t) => !FUNDS_FAKE_SCREENER_GAPS.includes(t) && t !== FUNDS_FAKE_EMPTY_ROOT)
        .map((t) => ({ ticker: t, issue_type: "ETF", full_name: t + " fund", ...figures(t) })),
    };
  }
  let m = /^\/api\/stock\/([^/]+)\/options-volume$/.exec(p);
  if (m) {
    const t = decodeURIComponent(m[1]);
    return { data: t === FUNDS_FAKE_EMPTY_ROOT ? [] : [{ ...figures(t), date: session }] };
  }
  m = /^\/api\/etfs\/([^/]+)\/info$/.exec(p);
  if (m) {
    const t = decodeURIComponent(m[1]);
    const rnd = mulberry(seedOf("info:" + t));
    return {
      data: {
        name: t + " Fund Trust", etf_company: "Fixture Funds", aum: String(Math.round(1e9 + rnd() * 1e11)),
        expense_ratio: "0.0945", holdings_count: Math.round(20 + rnd() * 480), has_options: true,
      },
    };
  }
  if (/^\/api\/etfs\/[^/]+\/weights$/.test(p)) {
    return {
      sector: [{ sector: "Technology", weight: "0.3" }, { sector: "Financial Services", weight: "0.2" }, { sector: "Healthcare", weight: "0.1" }, { sector: "Energy", weight: "0.05" }],
      country: [{ country: "United States", weight: "0.9" }, { country: "Ireland", weight: "0.04" }, { country: "Other", weight: "0.02" }],
    };
  }
  m = /^\/api\/etfs\/([^/]+)\/in-outflow$/.exec(p);
  if (m) {
    const rnd = mulberry(seedOf("flow:" + decodeURIComponent(m[1])));
    return { data: [{ date: session, change: Math.round((rnd() - 0.5) * 2e6), change_prem: "1000", close: "100", volume: 1000 }] };
  }
  if (p === "/api/stock-directory/ticker-exchanges") return { data: readList().map((ticker) => ({ ticker, exchange: "nyse" })) };
  throw new Error("fakeFundsRead: no fake for " + p);
}
