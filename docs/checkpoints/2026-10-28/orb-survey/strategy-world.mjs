import path from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 86400000;
const STUB_HOST = "uw.test";

function erf(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429], p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a[4] * t + a[3]) * t) + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x);
  return Math.sign(x) * y;
}
const ncdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
const npdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

function bs(S, K, vol, T, type, r = 0.04) {
  const sd = vol * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + vol * vol / 2) * T) / sd, d2 = d1 - sd;
  const disc = Math.exp(-r * T);
  const price = type === "C" ? S * ncdf(d1) - K * disc * ncdf(d2) : K * disc * ncdf(-d2) - S * ncdf(-d1);
  const delta = type === "C" ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (S * sd);
  const vega = S * npdf(d1) * Math.sqrt(T) / 100;
  const theta = (-S * npdf(d1) * vol / (2 * Math.sqrt(T)) - (type === "C" ? 1 : -1) * r * K * disc * ncdf(type === "C" ? d2 : -d2)) / 365;
  return { price, delta, gamma, vega, theta };
}

const ymd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
const strikeCode = (k) => String(Math.round(k * 1000)).padStart(8, "0");

export async function strategyWorld(repo, { now, ticker = "NVDA", spot = 186.2, prevClose = 188.12 }) {
  const at = (rel) => pathToFileURL(path.join(repo, rel)).href;
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(r) { return r; } };
  const { FLOWS_COOKIE, sessionEpoch, signFlowsSession } = await import(at("shared/flows-auth.js"));
  const { FIXTURE_ROSTER } = await import(at("tests/lib/fixture-roster.mjs"));
  const worker = (await import(at("worker.js") + "?orb-survey=1")).default;
  const SECRET = "orb-survey-session-secret-0123456789abcdefghijklmnopqrstuvwxyz";
  const member = FIXTURE_ROSTER[0];
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  const token = await signFlowsSession(member, SECRET, 3600 * 24 * 30, sessionEpoch({ SESSION_SECRET: SECRET }));
  const emptyD1 = {
    prepare() { const st = { bind: () => st, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return st; },
    batch: async (list) => list.map(() => ({ results: [] })),
  };
  const env = {
    DB: emptyD1, SESSION_SECRET: SECRET, UW_API_KEY: "stub-key-for-a-stubbed-feed", UW_BASE: "http://" + STUB_HOST, UW_NOW: new Date(nowMs).toISOString(),
    FLOWS_CREDENTIALS: JSON.stringify({ [member]: "x".repeat(43) }),
  };
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const expiries = [4, 11, 25, 53, 88, 116].map((d) => new Date(nowMs + d * DAY).toISOString().slice(0, 10))
    .map((iso) => { const d = new Date(iso + "T12:00:00Z"); const back = (d.getUTCDay() + 2) % 7; return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10); });
  const contracts = (T, expiry, type) => {
    const years = Math.max(1 / 365, (Date.parse(expiry + "T20:00:00Z") - nowMs) / DAY / 365);
    const rows = [];
    for (let k = Math.round(spot * 0.75 / 5) * 5; k <= spot * 1.25; k += 2.5) {
      const vol = 0.46 * (1 + 0.6 * Math.abs(Math.log(k / spot))) + (type === "P" ? 0.02 : 0);
      const g = bs(spot, k, vol, years, type);
      const mid = Math.max(0.02, g.price);
      const half = Math.max(0.01, mid * 0.02);
      rows.push({
        option_symbol: `${T}${ymd(expiry)}${type}${strikeCode(k)}`,
        nbbo_bid: (Math.round((mid - half) * 100) / 100).toFixed(2), nbbo_ask: (Math.round((mid + half) * 100) / 100).toFixed(2),
        implied_volatility: vol.toFixed(4), open_interest: String(Math.round(4000 * Math.exp(-Math.abs(Math.log(k / spot)) * 8))),
        volume: String(Math.round(900 * Math.exp(-Math.abs(Math.log(k / spot)) * 10))),
        delta: g.delta.toFixed(4), gamma: g.gamma.toFixed(5), theta: g.theta.toFixed(4), vega: g.vega.toFixed(4), rho: "0.01",
      });
    }
    return rows;
  };
  const vendor = (url) => {
    const m = url.pathname.match(/\/api\/stock\/([^/]+)\//);
    const T = m ? decodeURIComponent(m[1]) : ticker;
    if (url.pathname.endsWith("/expiry-breakdown")) return { data: expiries.map((e, i) => ({ expires: e, chains: 120 - i * 10, open_interest: 400000 - i * 40000, volume: 90000 - i * 9000 })) };
    if (url.pathname.includes("/ohlc/")) {
      const out = [];
      for (let i = 6; i >= 1; i--) {
        const d = new Date(nowMs - i * DAY).toISOString().slice(0, 10);
        const wd = new Date(d + "T12:00:00Z").getUTCDay();
        if (wd === 0 || wd === 6) continue;
        out.push({ date: d, market_time: "r", open: (spot * 0.99).toFixed(2), high: (spot * 1.01).toFixed(2), low: (spot * 0.98).toFixed(2), close: (i === 1 ? prevClose : spot * (1 - i * 0.003)).toFixed(2), volume: "250000000" });
      }
      return { data: out };
    }
    if (url.pathname.endsWith("/stock-state")) {
      if (T === "SPY") return { data: { close: "561.40", prev_close: "559.90", market_time: "regular", tape_time: new Date(nowMs - 60000).toISOString() } };
      return { data: { close: spot.toFixed(2), prev_close: prevClose.toFixed(2), open: (spot * 0.995).toFixed(2), high: (spot * 1.01).toFixed(2), low: (spot * 0.985).toFixed(2), volume: "180000000", market_time: "regular", tape_time: new Date(nowMs - 60000).toISOString() } };
    }
    if (url.pathname.endsWith("/info")) return { data: { full_name: "Synthetic issuer", sector: "Technology", issue_type: "Common Stock", next_earnings_date: expiries[3], announce_time: "postmarket", beta: "1.70", has_options: true } };
    if (url.pathname.endsWith("/option-contracts")) {
      const e = url.searchParams.get("expiry");
      const type = url.searchParams.get("option_type") === "put" ? "P" : "C";
      const page = Number(url.searchParams.get("page") || 1);
      return { data: page > 1 || !e ? [] : contracts(T, e, type) };
    }
    if (url.pathname.endsWith("/greek-exposure/expiry")) return { data: expiries.map((e) => ({ expiry: e })) };
    return undefined;
  };
  const realFetch = globalThis.fetch;
  if (!globalThis.__orbStubFetch) {
    globalThis.__orbStubFetch = true;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.href || input.url);
      if (url.host !== STUB_HOST) return realFetch(input, init);
      const body = vendor(url);
      if (body === undefined) return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
  }
  return {
    ticker, spot, today, expiries,
    async answer(u) {
      const req = new Request("https://strategy.test" + u.pathname + u.search, { headers: { cookie: FLOWS_COOKIE + "=" + token, "Sec-Fetch-Site": "same-origin", Accept: "application/json" } });
      const res = await worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
      const text = await res.text();
      let body = null;
      try { body = JSON.parse(text); } catch { body = { error: { code: "unreadable", message: text.slice(0, 120) } }; }
      return res.status === 200 ? body : { __status: res.status, ...body };
    },
  };
}
