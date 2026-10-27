import fs from "node:fs";
import { touch } from "./taint.mjs";

const FIXTURES = new URL("../../tests/fixtures-macro.json", import.meta.url);

let cached = null;

const load = () => {
  if (!cached) cached = JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  return cached;
};

const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const refuse = (status) => {
  const error = new Error(`HTTP ${status} fixture`);
  throw error;
};

const answer = (res) => {
  if (!res) refuse(404);
  if (res.status !== "ok") refuse(res.why === "429" ? 429 : res.why === "402" ? 402 : Number(res.why) || 500);
  return res.body;
};

export function worldOf(name) {
  const fx = load();
  return { ...fx.worlds.ok, ...(fx.worlds[name] || {}) };
}

export function makeMacroFakeVendor({ world = "ok", sessionDate = null, pm = "pm-ok" } = {}) {
  touch("makeMacroFakeVendor");
  const w = worldOf(world);
  const pmw = load().worlds[pm];
  return async function uw(path, params = {}) {
    let m;
    if ((m = /^\/api\/economy\/([^/]+)$/.exec(path))) {
      if (m[1] === "treasury-yield") return answer(w.treasury[params.maturity]);
      if (m[1] === "fed-funds") return answer(w.treasury["fed-funds"]);
      return answer(w.economy[m[1]]);
    }
    if ((m = /^\/api\/commodities\/([^/]+)$/.exec(path))) return answer(w.commodities[m[1]]);
    if (path === "/api/forex/history") return answer(w.fx[params.from + params.to]);
    if (path === "/api/digital-currencies/history") return answer(w.digital[params.symbol]);
    if ((m = /^\/api\/crypto\/([A-Z]+)-USD\/ohlc\/1d$/.exec(path))) return answer(w.cryptoOhlc[m[1]]);
    if (path === "/api/futures/contracts") return answer(w.futuresContracts);
    if ((m = /^\/api\/futures\/([^/]+)\/stats$/.exec(path))) return answer(w.futuresStats[m[1]]);
    if ((m = /^\/api\/futures\/([^/]+)\/candles$/.exec(path))) {
      const p = Object.keys(w.futuresCandles).find((k) => w.futuresCandles[k].sym === m[1]);
      return answer(p ? w.futuresCandles[p].res : null);
    }
    if (path === "/api/futures/flow") return answer(w.futuresFlow[0]);
    if (path === "/api/market/movers") return answer(w.movers);
    if ((m = /^\/api\/seasonality\/(\d+)\/performers$/.exec(path))) {
      const month = Number(sessionDate ? sessionDate.slice(5, 7) : 10);
      return answer(Number(m[1]) === month ? w.performersThis : w.performersNext);
    }
    if ((m = /^\/api\/seasonality\/([A-Z]+)\/monthly$/.exec(path))) return answer(w.seasonMonthly[m[1]]);
    if ((m = /^\/api\/seasonality\/([A-Z]+)\/year-month$/.exec(path))) return answer(w.seasonYearMonth[m[1]]);
    const p = w.predictions;
    if (path === "/api/predictions/unusual") return answer(p.unusual);
    if (path === "/api/predictions/smart-money") return answer(p.smart);
    if (path === "/api/predictions/whales") return answer(p.whales);
    if (path === "/api/predictions/insiders") return answer(p.insiders);
    if ((m = /^\/api\/predictions\/market\/([^/]+)\/liquidity$/.exec(path))) return answer(p.details[m[1]] && p.details[m[1]].liquidity);
    if ((m = /^\/api\/predictions\/market\/([^/]+)\/positions$/.exec(path))) return answer(p.details[m[1]] && p.details[m[1]].positions);
    if ((m = /^\/api\/predictions\/market\/([^/]+)$/.exec(path))) return answer(p.details[m[1]] && p.details[m[1]].market);
    if (/^\/api\/predictions\/user\//.test(path)) {
      const any = Object.values(p.details)[0];
      return answer(any && any.holders[0]);
    }
    if (path === "/api/private-markets/search") {
      const q = String(params.query || "");
      if (hash(q) % 3 === 0) return { data: { companies: [], investors: [] } };
      return { data: { companies: [], investors: [{ name: q.replace(/\b\w/g, (c) => c.toUpperCase()) + " Inc.", company_count: 3 + (hash(q) % 20) }] } };
    }
    if ((m = /^\/api\/private-markets\/investors\/(.+)$/.exec(path))) return answer(pmw.investor);
    if (path === "/api/private-markets/investors") return answer(pmw.investors);
    if (path === "/api/private-markets/companies") {
      const off = Number(params.offset || 0);
      if (off > 0) return { data: [] };
      return answer(pmw.companies);
    }
    if ((m = /^\/api\/private-markets\/companies\/([^/]+)\/(funding|pricing|investors|management)$/.exec(path))) {
      const d = pmw.details[m[1]];
      return answer(d && d[m[2] === "investors" ? "investorsOf" : m[2]]);
    }
    if ((m = /^\/api\/private-markets\/companies\/([^/]+)$/.exec(path))) return answer(pmw.details[m[1]] && pmw.details[m[1]].company);
    return refuse(404);
  };
}

export function makeLiveFake({ zone = "ok" } = {}) {
  touch("makeLiveFake");
  const live = load().live[zone === "zone" ? "zone" : "ok"];
  return async function uw(path, params = {}) {
    let m;
    if (path === "/api/forex/rate") return answer(live.board.fx[params.from + params.to]);
    if (path === "/api/forex/intraday") return answer(live.fx.intraday);
    if ((m = /^\/api\/crypto\/([A-Z]+-USD)\/state$/.exec(path))) return answer(live.board.crypto[m[1]]);
    if ((m = /^\/api\/crypto\/[A-Z]+-USD\/ohlc\/5m$/.test(path))) return answer(live.crypto.ohlc);
    if (path === "/api/digital-currencies/intraday") return answer(live.crypto.digital);
    if (path === "/api/crypto/whales/recent") return answer(live.crypto.whales);
    if (path === "/api/crypto/whale-transactions") return answer(live.crypto.transfers);
    if (path === "/api/futures/flow") return answer(live.futures.flow);
    if ((m = /^\/api\/futures\/([^/]+)\/trades$/.exec(path))) return answer(live.futures.trades);
    if ((m = /^\/api\/futures\/([^/]+)\/candles$/.exec(path))) return answer(live.futures.candles);
    if ((m = /^\/api\/futures\/([^/]+)\/stats$/.exec(path))) return answer(Object.values(live.board.futures)[0]);
    return refuse(404);
  };
}
